"""Security and lifecycle tests for trainer-created provider profiles."""

from datetime import timedelta
from hashlib import sha256

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.gis.geos import Point
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import Client, RequestFactory
from django.urls import reverse
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from core.network import canonical_client_ip
from enquiries.models import PhoneVerification
from enquiries.otp import request_code
from geography.models import Area, Region
from providers.admin import ProviderAdmin
from providers.lifecycle import request_provider_changes
from providers.models import Provider, ProviderMembership, TrainerAccount
from providers.trainer_auth import TrainerAccountDisabled, account_for_verified_phone

PHONE = "+233241112222"
OTHER_PHONE = "+233242223333"
CODE = "123456"
ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def catalogue(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(
        region=region,
        name="Accra",
        slug="accra",
        centroid=ACCRA,
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    return {"area": area, "trade": trade}


@pytest.fixture
def csrf_client():
    return Client(enforce_csrf_checks=True)


def csrf_headers(client):
    client.get(reverse("trainer-session-me"))
    return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}


def profile_payload(catalogue, **overrides):
    payload = {
        "name": "Safo Welding Academy",
        "owner_name": "Emmanuel Safo",
        "contact_phone": "+233240000001",
        "area_id": catalogue["area"].pk,
        "address": "1 Workshop Road",
        "latitude": 5.6037,
        "longitude": -0.1870,
        "programme": {
            "trade_id": catalogue["trade"].pk,
            "title": "Practical arc welding",
            "fee": "1200.00",
            "instalments_allowed": True,
            "instalment_note": "Two payments",
            "duration_weeks": 12,
            "hours_per_week": 30,
            "weekly_schedule": "Monday to Thursday",
            "capacity": 15,
            "intake": {
                "start_date": (timezone.localdate() + timedelta(days=30)).isoformat(),
                "places_offered": 15,
                "places_remaining": 12,
                "is_open": True,
            },
        },
    }
    payload.update(overrides)
    return payload


def login_trainer(client, monkeypatch, phone=PHONE):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: CODE)
    headers = csrf_headers(client)
    requested = client.post(
        reverse("trainer-otp-request"),
        {"phone": phone},
        content_type="application/json",
        **headers,
    )
    assert requested.status_code == 200, requested.content
    challenge_id = requested.json()["challenge_id"]
    verified = client.post(
        reverse("trainer-otp-verify"),
        {"challenge_id": challenge_id, "phone": phone, "code": CODE},
        content_type="application/json",
        **headers,
    )
    assert verified.status_code == 200, verified.content
    return verified.json(), challenge_id


def authenticated_csrf(client):
    return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}


def distinct_phone(index):
    return f"+2332411122{index:02d}"


@pytest.mark.django_db
def test_anonymous_trainer_auth_posts_require_csrf(csrf_client, monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: CODE)
    url = reverse("trainer-otp-request")

    assert (
        csrf_client.post(url, {"phone": PHONE}, content_type="application/json").status_code == 403
    )

    response = csrf_client.post(
        url,
        {"phone": PHONE},
        content_type="application/json",
        **csrf_headers(csrf_client),
    )
    assert response.status_code == 200
    assert "challenge_id" in response.json()


@pytest.mark.django_db
def test_trainer_challenge_is_public_purpose_scoped_and_single_use(
    csrf_client, monkeypatch, catalogue
):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: CODE)
    headers = csrf_headers(csrf_client)

    trainee_challenge = request_code(PHONE)
    wrong_purpose = csrf_client.post(
        reverse("trainer-otp-verify"),
        {"challenge_id": str(trainee_challenge.challenge_id), "phone": PHONE, "code": CODE},
        content_type="application/json",
        **headers,
    )
    assert wrong_purpose.status_code == 400
    assert TrainerAccount.objects.count() == 0

    requested = csrf_client.post(
        reverse("trainer-otp-request"),
        {"phone": PHONE},
        content_type="application/json",
        **headers,
    )
    challenge_id = requested.json()["challenge_id"]
    challenge = PhoneVerification.objects.get(challenge_id=challenge_id)
    assert challenge.purpose == PhoneVerification.Purpose.TRAINER_ACCESS

    first = csrf_client.post(
        reverse("trainer-otp-verify"),
        {"challenge_id": challenge_id, "phone": PHONE, "code": CODE},
        content_type="application/json",
        **headers,
    )
    replay = csrf_client.post(
        reverse("trainer-otp-verify"),
        {"challenge_id": challenge_id, "phone": PHONE, "code": CODE},
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )

    assert first.status_code == 200
    assert replay.status_code == 400
    assert TrainerAccount.objects.count() == 1


@pytest.mark.django_db
def test_expired_trainer_challenge_is_rejected(csrf_client, monkeypatch):
    _, challenge_id = login_trainer(csrf_client, monkeypatch, phone=OTHER_PHONE)
    # Use a second challenge so the assertion is about expiry, not replay.
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: CODE)
    headers = authenticated_csrf(csrf_client)
    requested = csrf_client.post(
        reverse("trainer-otp-request"),
        {"phone": PHONE},
        content_type="application/json",
        **headers,
    )
    challenge = PhoneVerification.objects.get(challenge_id=requested.json()["challenge_id"])
    challenge.expires_at = timezone.now() - timedelta(seconds=1)
    challenge.save(update_fields=["expires_at"])

    response = csrf_client.post(
        reverse("trainer-otp-verify"),
        {"challenge_id": str(challenge.challenge_id), "phone": PHONE, "code": CODE},
        content_type="application/json",
        **headers,
    )
    assert response.status_code == 400
    assert "expired" in response.json()["detail"]
    assert challenge_id != str(challenge.challenge_id)


@pytest.mark.django_db
def test_trainer_login_rotates_to_httponly_revocable_session(csrf_client, monkeypatch):
    anonymous_session = csrf_client.session
    anonymous_session["before_login"] = True
    anonymous_session.save()
    old_key = anonymous_session.session_key

    body, _ = login_trainer(csrf_client, monkeypatch)
    new_key = csrf_client.session.session_key
    account = TrainerAccount.objects.select_related("user").get()

    assert body == {"authenticated": True, "phone": PHONE, "profile": None}
    assert old_key != new_key
    assert account.user.is_staff is False
    assert account.user.has_usable_password() is False
    assert csrf_client.cookies["sessionid"]["httponly"] is True
    assert csrf_client.cookies["sessionid"]["samesite"] == "Lax"

    response = csrf_client.post(
        reverse("trainer-logout"),
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )
    assert response.json() == {"authenticated": False, "profile": None}
    assert not Session.objects.filter(session_key=new_key).exists()
    assert csrf_client.get(reverse("trainer-session-me")).json()["authenticated"] is False


@pytest.mark.django_db
def test_first_login_never_adopts_a_preexisting_privileged_user(
    csrf_client, monkeypatch, django_user_model
):
    # This is the deterministic username used by the earlier implementation.
    # Pre-creating it as a superuser must not turn a phone OTP into staff login.
    fingerprint = sha256(PHONE.encode()).hexdigest()[:40]
    privileged = django_user_model.objects.create_superuser(
        username=f"trainer-{fingerprint}",
        password="staff-password-1234",
    )

    body, _ = login_trainer(csrf_client, monkeypatch)
    account = TrainerAccount.objects.select_related("user").get(phone=PHONE)
    privileged.refresh_from_db()

    assert body["authenticated"] is True
    assert account.user_id != privileged.pk
    assert account.user.is_staff is False
    assert account.user.is_superuser is False
    assert account.user.has_usable_password() is False
    assert privileged.is_staff is True
    assert privileged.is_superuser is True
    assert not TrainerAccount.objects.filter(user=privileged).exists()
    assert int(csrf_client.session["_auth_user_id"]) == account.user_id


@pytest.mark.django_db
@pytest.mark.parametrize("grant", ["group", "permission"])
def test_existing_trainer_identity_with_permissions_fails_closed(django_user_model, grant):
    user = django_user_model.objects.create_user(f"linked-{grant}")
    user.set_unusable_password()
    user.save(update_fields=["password"])
    account = TrainerAccount.objects.create(
        user=user,
        phone=PHONE,
        phone_verified_at=timezone.now(),
    )
    if grant == "group":
        user.groups.add(Group.objects.create(name="Unexpected trainer group"))
    else:
        user.user_permissions.add(
            Permission.objects.get(
                content_type__app_label="providers",
                codename="view_provider",
            )
        )

    with pytest.raises(TrainerAccountDisabled):
        account_for_verified_phone(phone=account.phone, verified_at=timezone.now())


@pytest.mark.django_db
def test_loopback_proxy_clients_have_independent_minute_rate_buckets(csrf_client, monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: CODE)
    cache.clear()
    headers = csrf_headers(csrf_client)
    url = reverse("trainer-otp-request")
    first_ip = "198.51.100.21"
    second_ip = "198.51.100.22"

    responses = [
        csrf_client.post(
            url,
            {"phone": distinct_phone(index)},
            content_type="application/json",
            REMOTE_ADDR="127.0.0.1",
            HTTP_X_FORWARDED_FOR=first_ip,
            **headers,
        )
        for index in range(1, 7)
    ]
    other_client = csrf_client.post(
        url,
        {"phone": distinct_phone(7)},
        content_type="application/json",
        REMOTE_ADDR="127.0.0.1",
        HTTP_X_FORWARDED_FOR=second_ip,
        **headers,
    )

    assert [response.status_code for response in responses] == [200, 200, 200, 200, 200, 429]
    assert other_client.status_code == 200
    assert PhoneVerification.objects.filter(ip_address=first_ip).count() == 5
    assert PhoneVerification.objects.filter(ip_address=second_ip).count() == 1


@pytest.mark.django_db
def test_canonical_proxy_ip_is_shared_with_daily_otp_cap(csrf_client, monkeypatch, settings):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: CODE)
    settings.OTP_MAX_PER_IP_PER_DAY = 1
    cache.clear()
    headers = csrf_headers(csrf_client)
    url = reverse("trainer-otp-request")
    proxy = {
        "REMOTE_ADDR": "127.0.0.1",
        "HTTP_X_FORWARDED_FOR": "203.0.113.31",
    }

    first = csrf_client.post(
        url,
        {"phone": distinct_phone(20)},
        content_type="application/json",
        **proxy,
        **headers,
    )
    # Clear only the per-minute cache. The database-backed daily cap must still
    # recognise the same canonical XFF address.
    cache.clear()
    capped = csrf_client.post(
        url,
        {"phone": distinct_phone(21)},
        content_type="application/json",
        **proxy,
        **headers,
    )
    independent = csrf_client.post(
        url,
        {"phone": distinct_phone(22)},
        content_type="application/json",
        REMOTE_ADDR="127.0.0.1",
        HTTP_X_FORWARDED_FOR="203.0.113.32",
        **headers,
    )

    assert first.status_code == 200
    assert capped.status_code == 429
    assert "connection today" in capped.json()["detail"]
    assert independent.status_code == 200


def test_forwarded_address_is_ignored_from_a_nonloopback_peer():
    request = RequestFactory().get(
        "/api/trainer/auth/request-code/",
        REMOTE_ADDR="203.0.113.40",
        HTTP_X_FORWARDED_FOR="198.51.100.99",
    )
    assert canonical_client_ip(request) == "203.0.113.40"

    proxied = RequestFactory().get(
        "/api/trainer/auth/request-code/",
        REMOTE_ADDR="::1",
        HTTP_X_FORWARDED_FOR="192.0.2.10, 198.51.100.41",
    )
    assert canonical_client_ip(proxied) == "198.51.100.41"

    bridge_proxy = RequestFactory().get(
        "/api/trainer/auth/request-code/",
        REMOTE_ADDR="172.22.0.4",
        HTTP_X_FORWARDED_FOR="198.51.100.42",
    )
    assert canonical_client_ip(bridge_proxy) == "198.51.100.42"


@pytest.mark.django_db
def test_profile_put_atomically_creates_owned_draft_programme_and_intake(
    csrf_client, monkeypatch, catalogue
):
    login_trainer(csrf_client, monkeypatch)
    response = csrf_client.put(
        reverse("trainer-profile"),
        profile_payload(catalogue),
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )

    assert response.status_code == 200, response.content
    body = response.json()["profile"]
    provider = Provider.objects.get()
    account = TrainerAccount.objects.get()
    programme = Programme.objects.get(provider=provider)
    intake = Intake.objects.get(programme=programme)

    assert provider.status == Provider.Status.DRAFT
    assert str(provider.owner_phone) == PHONE
    assert provider.slug == "safo-welding-academy"
    assert ProviderMembership.objects.get(trainer=account).provider == provider
    assert programme.title == "Practical arc welding"
    assert intake.places_remaining == 12
    assert body["editable"] is True
    assert body["programme"]["fee"] == "1200.00"
    assert provider.history.latest().history_user == account.user
    assert programme.history.latest().history_user == account.user


@pytest.mark.django_db
def test_profile_rejects_mass_assignment_and_rolls_back_nested_errors(
    csrf_client, monkeypatch, catalogue
):
    login_trainer(csrf_client, monkeypatch)
    malicious = profile_payload(
        catalogue, status=Provider.Status.PUBLISHED, owner_phone=OTHER_PHONE
    )
    response = csrf_client.put(
        reverse("trainer-profile"),
        malicious,
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )
    assert response.status_code == 400
    assert set(response.json()) >= {"status", "owner_phone"}
    assert Provider.objects.count() == 0
    assert Programme.objects.count() == 0

    invalid = profile_payload(catalogue)
    invalid["programme"]["intake"]["places_remaining"] = 20
    response = csrf_client.put(
        reverse("trainer-profile"),
        invalid,
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )
    assert response.status_code == 400
    assert Provider.objects.count() == 0
    assert Programme.objects.count() == 0


@pytest.mark.django_db
def test_profile_put_updates_in_place_and_one_to_one_ownership_is_structural(
    csrf_client, monkeypatch, catalogue, django_user_model
):
    login_trainer(csrf_client, monkeypatch)
    url = reverse("trainer-profile")
    headers = authenticated_csrf(csrf_client)
    first = csrf_client.put(
        url,
        profile_payload(catalogue),
        content_type="application/json",
        **headers,
    ).json()["profile"]
    changed = profile_payload(catalogue, name="Updated Academy")
    changed["programme"]["title"] = "Updated welding"
    second = csrf_client.put(url, changed, content_type="application/json", **headers).json()[
        "profile"
    ]

    assert first["id"] == second["id"]
    assert Provider.objects.count() == Programme.objects.count() == 1
    assert Provider.objects.get().slug == "updated-academy"

    other_user = django_user_model.objects.create_user("other-trainer")
    other_account = TrainerAccount.objects.create(
        user=other_user,
        phone=OTHER_PHONE,
        phone_verified_at=timezone.now(),
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        ProviderMembership.objects.create(
            trainer=other_account,
            provider=Provider.objects.get(),
        )


@pytest.mark.django_db
def test_submitted_profile_is_locked_and_excluded_until_admin_approval(
    csrf_client, monkeypatch, catalogue
):
    login_trainer(csrf_client, monkeypatch)
    headers = authenticated_csrf(csrf_client)
    csrf_client.put(
        reverse("trainer-profile"),
        profile_payload(catalogue),
        content_type="application/json",
        **headers,
    )
    submitted = csrf_client.post(
        reverse("trainer-profile-submit"),
        content_type="application/json",
        **headers,
    )
    provider = Provider.objects.get()

    assert submitted.status_code == 200
    assert submitted.json()["profile"]["status"] == Provider.Status.PENDING_APPROVAL
    assert submitted.json()["profile"]["editable"] is False
    assert provider.submitted_at is not None
    submitted_history = provider.history.filter(
        status=Provider.Status.PENDING_APPROVAL,
        history_type="~",
    ).latest()
    assert submitted_history.history_user == TrainerAccount.objects.get().user
    assert submitted_history.history_change_reason == "Submitted for approval"

    locked_payload = profile_payload(catalogue, name="Should not save")
    locked = csrf_client.put(
        reverse("trainer-profile"),
        locked_payload,
        content_type="application/json",
        **headers,
    )
    assert locked.status_code == 409
    provider.refresh_from_db()
    assert provider.name == "Safo Welding Academy"
    assert csrf_client.get("/api/providers/").json()["count"] == 0
    assert (
        csrf_client.get(
            reverse("provider-by-slug", args=[provider.area.slug, provider.slug])
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_changes_requested_unlocks_only_the_owner_and_can_be_resubmitted(
    csrf_client, monkeypatch, catalogue, django_user_model
):
    login_trainer(csrf_client, monkeypatch)
    headers = authenticated_csrf(csrf_client)
    csrf_client.put(
        reverse("trainer-profile"),
        profile_payload(catalogue),
        content_type="application/json",
        **headers,
    )
    csrf_client.post(reverse("trainer-profile-submit"), content_type="application/json", **headers)
    provider = Provider.objects.get()
    reviewer = django_user_model.objects.create_superuser("reviewer")
    request_provider_changes(provider, actor=reviewer, note="Clarify the weekly schedule.")

    session = csrf_client.get(reverse("trainer-session-me")).json()
    assert session["profile"]["status"] == Provider.Status.CHANGES_REQUESTED
    assert session["profile"]["review_note"] == "Clarify the weekly schedule."
    assert session["profile"]["editable"] is True

    revised = profile_payload(catalogue)
    revised["programme"]["weekly_schedule"] = "Monday-Friday, 8am-2pm"
    assert (
        csrf_client.put(
            reverse("trainer-profile"),
            revised,
            content_type="application/json",
            **headers,
        ).status_code
        == 200
    )
    resubmitted = csrf_client.post(
        reverse("trainer-profile-submit"),
        content_type="application/json",
        **headers,
    ).json()["profile"]
    assert resubmitted["status"] == Provider.Status.PENDING_APPROVAL
    assert resubmitted["review_note"] == ""


@pytest.mark.django_db
def test_a_second_trainer_session_never_sees_the_first_owners_profile(
    csrf_client, monkeypatch, catalogue
):
    login_trainer(csrf_client, monkeypatch, PHONE)
    csrf_client.put(
        reverse("trainer-profile"),
        profile_payload(catalogue),
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )
    csrf_client.post(
        reverse("trainer-logout"),
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )

    login_trainer(csrf_client, monkeypatch, OTHER_PHONE)
    assert csrf_client.get(reverse("trainer-profile")).json() == {"profile": None}


@pytest.mark.django_db
def test_provider_admin_form_excludes_lifecycle_fields(django_user_model, catalogue):
    from django.contrib import admin

    provider = Provider.objects.create(
        name="Pending Academy",
        slug="pending-academy",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=PHONE,
        status=Provider.Status.PENDING_APPROVAL,
    )
    user = django_user_model.objects.create_user("officer", is_staff=True)
    request = RequestFactory().post("/back-office/providers/provider/1/change/")
    request.user = user
    model_admin = ProviderAdmin(Provider, admin.site)
    form_class = model_admin.get_form(request, obj=provider)

    assert "status" not in form_class.base_fields
    assert "published_at" not in form_class.base_fields
    assert "submitted_at" not in form_class.base_fields
    assert "review_note" not in form_class.base_fields


@pytest.mark.django_db
def test_direct_admin_change_post_cannot_mass_assign_published_status(
    client, django_user_model, catalogue, staff_groups
):
    provider = Provider.objects.create(
        name="Pending Academy",
        slug="pending-academy",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=PHONE,
        status=Provider.Status.PENDING_APPROVAL,
    )
    officer = django_user_model.objects.create_user("direct-post-officer", is_staff=True)
    officer.groups.add(staff_groups["officer"])
    client.force_login(officer)

    response = client.post(
        reverse("admin:providers_provider_change", args=[provider.pk]),
        {
            "name": provider.name,
            "slug": provider.slug,
            "area": provider.area_id,
            "address": "Updated by field officer",
            "location": "POINT (-0.187 5.6037)",
            "owner_name": "Owner",
            "owner_phone": "",
            "contact_phone": str(provider.contact_phone),
            "last_confirmed_at_0": "",
            "last_confirmed_at_1": "",
            # The malicious field is not part of the ModelForm and must never
            # be applied merely because it is present in POST data.
            "status": Provider.Status.PUBLISHED,
            "verifications-TOTAL_FORMS": "0",
            "verifications-INITIAL_FORMS": "0",
            "verifications-MIN_NUM_FORMS": "0",
            "verifications-MAX_NUM_FORMS": "1000",
            "government_status-TOTAL_FORMS": "0",
            "government_status-INITIAL_FORMS": "0",
            "government_status-MIN_NUM_FORMS": "0",
            "government_status-MAX_NUM_FORMS": "1",
            "evidence-TOTAL_FORMS": "0",
            "evidence-INITIAL_FORMS": "0",
            "evidence-MIN_NUM_FORMS": "0",
            "evidence-MAX_NUM_FORMS": "1000",
            "subscriptions-TOTAL_FORMS": "0",
            "subscriptions-INITIAL_FORMS": "0",
            "subscriptions-MIN_NUM_FORMS": "0",
            "subscriptions-MAX_NUM_FORMS": "1000",
            "_save": "Save",
        },
    )

    assert response.status_code == 302, (
        response.context and response.context["adminform"].form.errors
    )
    provider.refresh_from_db()
    assert provider.address == "Updated by field officer"
    assert provider.status == Provider.Status.PENDING_APPROVAL


@pytest.fixture
def staff_groups(db):
    from django.core.management import call_command

    call_command("setup_groups", verbosity=0)
    return {
        "officer": Group.objects.get(name="Field officer"),
        "lead": Group.objects.get(name="Operations lead"),
    }


@pytest.mark.django_db
def test_admin_publish_is_permission_gated_audited_and_never_revives_suspended(
    client, django_user_model, catalogue, staff_groups
):
    pending = Provider.objects.create(
        name="Pending Academy",
        slug="pending-academy",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=PHONE,
        status=Provider.Status.PENDING_APPROVAL,
    )
    suspended = Provider.objects.create(
        name="Suspended Academy",
        slug="suspended-academy",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=OTHER_PHONE,
        status=Provider.Status.SUSPENDED,
    )
    officer = django_user_model.objects.create_user("field", is_staff=True)
    officer.groups.add(staff_groups["officer"])
    lead = django_user_model.objects.create_user("lead", is_staff=True)
    lead.groups.add(staff_groups["lead"])
    url = reverse("admin:providers_provider_changelist")

    client.force_login(officer)
    client.post(url, {"action": "publish_listings", "_selected_action": [pending.pk]})
    pending.refresh_from_db()
    assert pending.status == Provider.Status.PENDING_APPROVAL

    client.force_login(lead)
    client.post(
        url,
        {
            "action": "publish_listings",
            "_selected_action": [pending.pk, suspended.pk],
        },
    )
    pending.refresh_from_db()
    suspended.refresh_from_db()
    assert pending.status == Provider.Status.PUBLISHED
    published_history = pending.history.filter(
        status=Provider.Status.PUBLISHED,
        history_type="~",
    ).latest()
    assert published_history.history_user == lead
    assert published_history.history_change_reason == "Approved and published"
    assert suspended.status == Provider.Status.SUSPENDED


@pytest.mark.django_db
def test_admin_return_for_changes_is_audited_and_awaiting_queue_still_matches(
    client, django_user_model, catalogue, staff_groups
):
    provider = Provider.objects.create(
        name="Pending Academy",
        slug="pending-academy",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=PHONE,
        status=Provider.Status.PENDING_APPROVAL,
    )
    lead = django_user_model.objects.create_user("lead", is_staff=True)
    lead.groups.add(staff_groups["lead"])
    client.force_login(lead)
    changelist = reverse("admin:providers_provider_changelist")

    queued = client.get(changelist, {"queue": "awaiting_approval"})
    assert list(queued.context["cl"].result_list) == [provider]

    client.post(
        changelist,
        {"action": "return_for_changes", "_selected_action": [provider.pk]},
    )
    provider.refresh_from_db()
    assert provider.status == Provider.Status.CHANGES_REQUESTED
    assert provider.review_note
    returned_history = provider.history.filter(
        status=Provider.Status.CHANGES_REQUESTED,
        history_type="~",
    ).latest()
    assert returned_history.history_user == lead
    assert returned_history.history_change_reason == "Changes requested during review"
