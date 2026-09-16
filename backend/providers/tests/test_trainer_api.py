"""Security and lifecycle tests for trainer-created provider profiles."""

from datetime import timedelta
from hashlib import sha256

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.gis.geos import Point
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
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
        # The trainer's own identity. A verified phone proves someone holds a
        # SIM; these are what the confirming admin decides on.
        "full_name": "Emmanuel Safo",
        "role": "owner",
        "id_document_type": "ghana_card",
        "id_document_number": "GHA-000111222-3",
        "name": "Safo Welding Academy",
        "owner_name": "Emmanuel Safo",
        "contact_phone": "+233240000001",
        "area_id": catalogue["area"].pk,
        "address": "1 Workshop Road",
        "landmark": "Behind the community market",
        "latitude": 5.6037,
        "longitude": -0.1870,
        "declared_accurate": True,
        "site_visit_consent": True,
        "data_consent": True,
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
                "is_open": True,
            },
        },
    }
    payload.update(overrides)
    return payload


def attach_review_files(provider, user):
    """The photographs and identity document a submission cannot go without.

    submission_blockers requires two workshop photographs and one identity
    document before a listing reaches the review queue, because an admin
    looking at a name and a pin has nothing to decide on. Uploading them
    through the API in every test would be six extra requests of setup, so
    they are created directly.
    """
    from io import BytesIO

    from django.core.files.base import ContentFile
    from PIL import Image

    from providers.models import ProviderEvidence, ProviderPhoto

    def jpeg(colour):
        buffer = BytesIO()
        Image.new("RGB", (40, 30), colour).save(buffer, format="JPEG")
        return ContentFile(buffer.getvalue())

    for index, colour in enumerate(("red", "blue")):
        photo = ProviderPhoto(provider=provider, uploaded_by=user, display_order=index)
        photo.image.save(f"workshop-{index}.jpg", jpeg(colour), save=True)

    evidence = ProviderEvidence(
        provider=provider,
        kind=ProviderEvidence.Kind.ID_DOCUMENT,
        uploaded_by=user,
    )
    evidence.file.save("id.jpg", jpeg("green"), save=True)


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

    assert body == {
        "authenticated": True,
        "phone": PHONE,
        "account_status": "pending",
        "account_note": "",
        "profile": None,
    }
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
    # Seeded from the offer, because a new intake has had no enrolments yet.
    assert intake.places_remaining == 15
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

    # places_remaining is the counter that moves as trainees enrol, so it is
    # not a field the profile form owns. Posting it is refused outright rather
    # than quietly ignored.
    invalid = profile_payload(catalogue)
    invalid["programme"]["intake"]["places_remaining"] = 20
    response = csrf_client.put(
        reverse("trainer-profile"),
        invalid,
        content_type="application/json",
        **authenticated_csrf(csrf_client),
    )
    assert response.status_code == 400
    assert response.json()["programme"]["intake"]["places_remaining"]
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
    # Photographs and an ID document, which a submission now needs.
    attach_review_files(Provider.objects.get(), TrainerAccount.objects.get().user)
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
    # Photographs and an ID document, which a submission now needs.
    attach_review_files(Provider.objects.get(), TrainerAccount.objects.get().user)
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
    # The profile read carries the readiness checklist beside the profile;
    # both are None for a trainer who has not started one.
    assert csrf_client.get(reverse("trainer-profile")).json() == {
        "profile": None,
        "blockers": None,
    }


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

    # The action stops to collect a reason rather than returning the submission
    # straight away, so this first post is the confirmation page.
    confirm = client.post(
        changelist,
        {"action": "return_for_changes", "_selected_action": [provider.pk]},
    )
    assert confirm.status_code == 200
    assert list(confirm.context["queryset"]) == [provider]
    provider.refresh_from_db()
    assert provider.status == Provider.Status.PENDING_APPROVAL

    # A note too short to act on is refused, so nobody can click through the
    # page and send the trainer away with nothing to change.
    terse = client.post(
        changelist,
        {
            "action": "return_for_changes",
            "_selected_action": [provider.pk],
            "apply": "1",
            "note": "no",
        },
    )
    assert terse.status_code == 200
    assert terse.context["form"].errors["note"]
    provider.refresh_from_db()
    assert provider.status == Provider.Status.PENDING_APPROVAL

    note = "The fee reads GH¢120. If the course costs GH¢1,200 please correct it."
    client.post(
        changelist,
        {
            "action": "return_for_changes",
            "_selected_action": [provider.pk],
            "apply": "1",
            "note": note,
        },
    )
    provider.refresh_from_db()
    assert provider.status == Provider.Status.CHANGES_REQUESTED
    # The reviewer's own words reach the trainer, not a fixed sentence.
    assert provider.review_note == note
    returned_history = provider.history.filter(
        status=Provider.Status.CHANGES_REQUESTED,
        history_type="~",
    ).latest()
    assert returned_history.history_user == lead
    assert returned_history.history_change_reason == "Changes requested during review"


@pytest.mark.django_db
def test_editing_a_profile_does_not_reset_places_already_taken(csrf_client, monkeypatch, catalogue):
    """A half-full course must not read as empty after an unrelated edit.

    places_remaining is an operational counter, not a profile field, and the
    trainer's form has no idea what it should be. Every save used to post the
    number offered straight back into it.
    """
    login_trainer(csrf_client, monkeypatch)
    url = reverse("trainer-profile")
    headers = authenticated_csrf(csrf_client)

    csrf_client.put(url, profile_payload(catalogue), content_type="application/json", **headers)
    intake = Intake.objects.get()
    assert intake.places_remaining == 15

    # Four trainees enrol.
    Intake.objects.filter(pk=intake.pk).update(places_remaining=11)

    renamed = profile_payload(catalogue, name="Safo Welding Institute")
    response = csrf_client.put(url, renamed, content_type="application/json", **headers)
    assert response.status_code == 200, response.content

    intake.refresh_from_db()
    assert intake.places_remaining == 11


@pytest.mark.django_db
def test_lowering_the_offer_clamps_rather_than_breaking_the_check_constraint(
    csrf_client, monkeypatch, catalogue
):
    login_trainer(csrf_client, monkeypatch)
    url = reverse("trainer-profile")
    headers = authenticated_csrf(csrf_client)

    csrf_client.put(url, profile_payload(catalogue), content_type="application/json", **headers)
    intake = Intake.objects.get()

    smaller = profile_payload(catalogue)
    smaller["programme"]["intake"]["places_offered"] = 8
    response = csrf_client.put(url, smaller, content_type="application/json", **headers)
    assert response.status_code == 200, response.content

    intake.refresh_from_db()
    assert intake.places_offered == 8
    assert intake.places_remaining == 8


@pytest.mark.django_db
def test_a_returned_profile_can_be_saved_without_touching_a_stale_intake_date(
    csrf_client, monkeypatch, catalogue, django_user_model
):
    """The intake date that expired during the review must not block the fix.

    A trainer submits in March with an April intake and is asked for changes in
    May. Rejecting any non-future date would make every save fail on a field
    they were never asked to revisit, with no way to work out why.
    """
    login_trainer(csrf_client, monkeypatch)
    url = reverse("trainer-profile")
    headers = authenticated_csrf(csrf_client)

    csrf_client.put(url, profile_payload(catalogue), content_type="application/json", **headers)
    provider = Provider.objects.get()
    attach_review_files(provider, TrainerAccount.objects.get().user)
    csrf_client.post(reverse("trainer-profile-submit"), content_type="application/json", **headers)

    lead = django_user_model.objects.create_user("lead-stale", is_staff=True)
    request_provider_changes(provider, actor=lead, note="Please correct the fee before we publish.")

    # The intake date slips into the past while the submission sits in review.
    stale = timezone.localdate() - timedelta(days=3)
    Intake.objects.update(start_date=stale)

    unchanged = profile_payload(catalogue, name="Safo Welding Academy")
    unchanged["programme"]["intake"]["start_date"] = stale.isoformat()
    response = csrf_client.put(url, unchanged, content_type="application/json", **headers)
    assert response.status_code == 200, response.content

    # A different past date is still refused: the exemption is for the date
    # already stored, not for past dates in general.
    moved = profile_payload(catalogue)
    moved["programme"]["intake"]["start_date"] = (
        timezone.localdate() - timedelta(days=1)
    ).isoformat()
    refused = csrf_client.put(url, moved, content_type="application/json", **headers)
    assert refused.status_code == 400
    assert refused.json()["programme"]["intake"]["start_date"]


@pytest.mark.django_db
def test_suspending_a_trainer_account_locks_out_a_live_session(csrf_client, monkeypatch, catalogue):
    """Suspension has to bite on the next request, not the next login.

    The flag is read through the IsActiveTrainer permission on every trainer
    request, so an open browser tab stops working immediately and no session
    flush is needed. Until the admin existed nothing could set it at all.
    """
    login_trainer(csrf_client, monkeypatch)
    url = reverse("trainer-profile")
    headers = authenticated_csrf(csrf_client)

    csrf_client.put(url, profile_payload(catalogue), content_type="application/json", **headers)
    assert csrf_client.get(url).status_code == 200

    TrainerAccount.objects.update(is_active=False)

    assert csrf_client.get(url).status_code == 403
    blocked = csrf_client.put(
        url, profile_payload(catalogue), content_type="application/json", **headers
    )
    assert blocked.status_code == 403
    # The session endpoint reports the account as signed out rather than 500ing.
    assert csrf_client.get(reverse("trainer-session-me")).json()["authenticated"] is False


def _lose_the_slug_race(monkeypatch, *, skip_validation):
    """Make the first save attempt collide, as a concurrent trainer would.

    `skip_validation` picks which of the two real races is simulated. Django's
    full_clean runs validate_unique, so a row committed before that SELECT
    surfaces as a ValidationError; one committed in the gap between it and the
    INSERT reaches the database and surfaces as an IntegrityError. Both happen,
    and catching only the second left the usual case broken.
    """
    from providers import trainer_profiles

    real_unique_slug = trainer_profiles._unique_slug
    attempts = {"n": 0}

    def racing_slug(**kwargs):
        attempts["n"] += 1
        if attempts["n"] == 1:
            return "accra-welding-works"
        return real_unique_slug(**kwargs)

    monkeypatch.setattr(trainer_profiles, "_unique_slug", racing_slug)

    if skip_validation:
        real_validate_unique = Provider.validate_unique
        checks = {"n": 0}

        def blind_validate_unique(self, exclude=None):
            checks["n"] += 1
            if checks["n"] == 1:
                return  # The other row is not committed yet, so this sees nothing.
            return real_validate_unique(self, exclude=exclude)

        monkeypatch.setattr(Provider, "validate_unique", blind_validate_unique)

    return attempts


@pytest.mark.parametrize("skip_validation", [False, True], ids=["at_validation", "at_insert"])
@pytest.mark.django_db
def test_two_workshops_with_one_name_in_one_area_both_get_a_slug(
    catalogue, monkeypatch, skip_validation
):
    """The slug is picked with a SELECT, so the winner is decided by the insert.

    Two owners registering "Accra Welding Works" in the same area at the same
    moment can both be told the same slug is free. Without the retry the loser
    got a 500 on their first save.
    """
    from providers import trainer_profiles

    first = Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=PHONE,
    )
    attempts = _lose_the_slug_race(monkeypatch, skip_validation=skip_validation)

    second = Provider(
        name="Accra Welding Works",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=OTHER_PHONE,
    )
    with transaction.atomic():
        trainer_profiles._save_with_unique_slug(
            second, area=catalogue["area"], actor=None, reason="Trainer created profile draft"
        )

    second.refresh_from_db()
    assert attempts["n"] == 2
    assert second.pk != first.pk
    assert second.slug != first.slug


@pytest.mark.django_db
def test_a_validation_error_that_is_not_a_slug_clash_is_not_retried_away(catalogue):
    """Retrying must not swallow a real problem with the record."""
    from providers import trainer_profiles

    provider = Provider(
        name="x" * 300,  # Longer than the column allows.
        area=catalogue["area"],
        location=ACCRA,
        contact_phone=PHONE,
    )
    with pytest.raises(DjangoValidationError) as raised, transaction.atomic():
        trainer_profiles._save_with_unique_slug(
            provider, area=catalogue["area"], actor=None, reason="Trainer created profile draft"
        )
    assert "name" in raised.value.error_dict
    assert Provider.objects.count() == 0
