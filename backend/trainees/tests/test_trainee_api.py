"""Trainee accounts: sign-in, own data only, and the enquiry flow link."""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.test import Client
from django.urls import reverse

from catalog.models import Intake, Programme, Trade
from enquiries.models import Enquiry, EnquiryOutcome, Enrolment, PhoneVerification
from geography.models import Area, Region
from providers.models import Provider, TrainerAccount
from trainees.auth import TraineeAccountDisabled, account_for_verified_phone
from trainees.models import SavedProvider, TraineeAccount

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PHONE = "+233241112222"
OTHER = "+233242223333"
CODE = "123456"


@pytest.fixture
def programme(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    provider = Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233240000000",
        status=Provider.Status.PUBLISHED,
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    prog = Programme.objects.create(
        provider=provider, trade=trade, title="Arc welding", fee=1200, duration_weeks=12
    )
    Intake.objects.create(programme=prog, start_date=date.today() + timedelta(days=30))
    return prog


@pytest.fixture
def fixed_code(monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: CODE)


@pytest.fixture
def csrf_client():
    return Client(enforce_csrf_checks=True)


def csrf_headers(client):
    client.get(reverse("trainee-session-me"))
    return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}


def sign_in(client, phone=PHONE):
    headers = csrf_headers(client)
    challenge = client.post(
        reverse("trainee-otp-request"),
        {"phone": phone},
        content_type="application/json",
        **headers,
    ).json()
    response = client.post(
        reverse("trainee-otp-verify"),
        {"challenge_id": challenge["challenge_id"], "phone": phone, "code": CODE},
        content_type="application/json",
        **csrf_headers(client),
    )
    assert response.status_code == 200, response.content
    return response


# --- sign-in -------------------------------------------------------------------


@pytest.mark.django_db
def test_session_is_anonymous_before_sign_in(client):
    body = client.get(reverse("trainee-session-me")).json()
    assert body == {"authenticated": False, "account": None, "support": None}


@pytest.mark.django_db
def test_sign_in_creates_an_unprivileged_account(csrf_client, fixed_code):
    body = sign_in(csrf_client).json()

    assert body["authenticated"] is True
    assert body["account"]["phone"] == PHONE
    assert body["support"] is None
    account = TraineeAccount.objects.get(phone=PHONE)
    assert not account.user.is_staff
    assert not account.user.has_usable_password()
    assert PhoneVerification.objects.get(phone=PHONE).purpose == "trainee_access"


@pytest.mark.django_db
def test_sign_in_requires_csrf(csrf_client, fixed_code):
    response = csrf_client.post(
        reverse("trainee-otp-request"), {"phone": PHONE}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_wrong_code_does_not_sign_in(csrf_client, fixed_code):
    headers = csrf_headers(csrf_client)
    challenge = csrf_client.post(
        reverse("trainee-otp-request"),
        {"phone": PHONE},
        content_type="application/json",
        **headers,
    ).json()
    response = csrf_client.post(
        reverse("trainee-otp-verify"),
        {"challenge_id": challenge["challenge_id"], "phone": PHONE, "code": "000000"},
        content_type="application/json",
        **headers,
    )
    assert response.status_code == 400
    assert not TraineeAccount.objects.exists()


@pytest.mark.django_db
def test_switched_off_account_cannot_sign_in(csrf_client, fixed_code):
    sign_in(csrf_client)
    TraineeAccount.objects.filter(phone=PHONE).update(is_active=False)

    other = Client(enforce_csrf_checks=True)
    headers = csrf_headers(other)
    challenge = other.post(
        reverse("trainee-otp-request"),
        {"phone": PHONE},
        content_type="application/json",
        **headers,
    ).json()
    response = other.post(
        reverse("trainee-otp-verify"),
        {"challenge_id": challenge["challenge_id"], "phone": PHONE, "code": CODE},
        content_type="application/json",
        **headers,
    )
    assert response.status_code == 403
    # And the live session in the first browser stops working at once.
    assert csrf_client.get(reverse("trainee-enquiries")).status_code == 403


@pytest.mark.django_db
def test_privileged_user_behind_an_account_is_refused(db):
    from django.utils import timezone

    account = account_for_verified_phone(phone=PHONE, verified_at=timezone.now())
    account.user.is_staff = True
    account.user.save()
    with pytest.raises(TraineeAccountDisabled):
        account_for_verified_phone(phone=PHONE, verified_at=timezone.now())


@pytest.mark.django_db
def test_trainer_session_is_not_a_trainee_session(client):
    from django.utils import timezone

    from providers.trainer_auth import account_for_verified_phone as trainer_login

    trainer = trainer_login(phone=PHONE, verified_at=timezone.now())
    client.force_login(trainer.user)
    assert client.get(reverse("trainee-enquiries")).status_code == 403
    assert isinstance(trainer, TrainerAccount)


@pytest.mark.django_db
def test_logout_ends_the_session(csrf_client, fixed_code):
    sign_in(csrf_client)
    csrf_client.post(reverse("trainee-logout"), **csrf_headers(csrf_client))
    assert csrf_client.get(reverse("trainee-enquiries")).status_code == 403


# --- own data only -------------------------------------------------------------


@pytest.mark.django_db
def test_history_is_linked_on_first_sign_in(csrf_client, fixed_code, programme):
    mine = Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone=PHONE,
        state=Enquiry.State.SENT,
    )
    EnquiryOutcome.objects.create(enquiry=mine, replied=True, visited=True)
    Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone=OTHER,
        state=Enquiry.State.SENT,
    )
    Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone=PHONE,
        state=Enquiry.State.SPAM,
    )
    Enrolment.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone=PHONE,
        started_on=date.today(),
        provider_attestation=Enrolment.Attestation.RECOMMENDED,
    )

    sign_in(csrf_client)

    enquiries = csrf_client.get(reverse("trainee-enquiries")).json()
    assert [row["reference_code"] for row in enquiries] == [mine.reference_code]
    assert enquiries[0]["status"] == "visited"
    assert enquiries[0]["provider"]["name"] == "Accra Welding Works"
    assert enquiries[0]["whatsapp_url"].startswith("https://wa.me/233240000000")

    enrolments = csrf_client.get(reverse("trainee-enrolments")).json()
    assert len(enrolments) == 1
    # The provider's private judgement is never shown to the trainee.
    assert "provider_attestation" not in enrolments[0]


@pytest.mark.django_db
def test_enrolment_recorded_later_links_itself(csrf_client, fixed_code, programme):
    sign_in(csrf_client)
    Enrolment.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone=PHONE,
        started_on=date.today(),
    )
    assert len(csrf_client.get(reverse("trainee-enrolments")).json()) == 1


@pytest.mark.django_db
def test_account_details_can_be_updated_but_not_the_phone(csrf_client, fixed_code):
    sign_in(csrf_client)
    response = csrf_client.patch(
        reverse("trainee-account"),
        {"display_name": "Ama", "preferred_channel": "telegram", "phone": OTHER},
        content_type="application/json",
        **csrf_headers(csrf_client),
    )
    assert response.status_code == 200
    account = TraineeAccount.objects.get()
    assert (account.display_name, account.preferred_channel, str(account.phone)) == (
        "Ama",
        "telegram",
        PHONE,
    )


@pytest.mark.django_db
def test_save_and_remove_a_provider(csrf_client, fixed_code, programme):
    sign_in(csrf_client)
    headers = csrf_headers(csrf_client)
    provider = programme.provider

    first = csrf_client.post(
        reverse("trainee-saved"),
        {"provider_id": provider.pk},
        content_type="application/json",
        **headers,
    )
    again = csrf_client.post(
        reverse("trainee-saved"),
        {"provider_id": provider.pk},
        content_type="application/json",
        **headers,
    )
    assert (first.status_code, again.status_code) == (201, 200)
    assert SavedProvider.objects.count() == 1

    listed = csrf_client.get(reverse("trainee-saved")).json()
    assert listed[0]["provider"]["is_listed"] is True

    removed = csrf_client.delete(reverse("trainee-saved-detail", args=[provider.pk]), **headers)
    assert removed.status_code == 204
    assert not SavedProvider.objects.exists()


@pytest.mark.django_db
def test_unpublished_provider_cannot_be_saved(csrf_client, fixed_code, programme):
    sign_in(csrf_client)
    Provider.objects.update(status=Provider.Status.DRAFT)
    response = csrf_client.post(
        reverse("trainee-saved"),
        {"provider_id": programme.provider_id},
        content_type="application/json",
        **csrf_headers(csrf_client),
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_close_account_keeps_the_provider_record(csrf_client, fixed_code, programme):
    enquiry = Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone=PHONE,
        state=Enquiry.State.SENT,
    )
    sign_in(csrf_client)
    headers = csrf_headers(csrf_client)

    refused = csrf_client.post(
        reverse("trainee-account-close"), {}, content_type="application/json", **headers
    )
    assert refused.status_code == 400

    closed = csrf_client.post(
        reverse("trainee-account-close"),
        {"confirm": True},
        content_type="application/json",
        **headers,
    )
    assert closed.status_code == 200
    assert not TraineeAccount.objects.exists()
    enquiry.refresh_from_db()
    assert enquiry.trainee is None
    assert str(enquiry.trainee_phone) == PHONE
    assert csrf_client.get(reverse("trainee-enquiries")).status_code == 403


# --- enquiry flow ----------------------------------------------------------------


@pytest.mark.django_db
def test_enquiry_verification_creates_account_and_signs_in(client, programme):
    client.post("/api/enquiries/request-code/", {"phone": PHONE})
    PhoneVerification.objects.update(code_hash=_hash(CODE))
    verified = client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": CODE}).json()
    assert verified == {"verified": True, "signed_in": True}

    sent = client.post(
        "/api/enquiries/",
        {"phone": PHONE, "programme_id": programme.pk},
        content_type="application/json",
    )
    assert sent.status_code == 201
    account = TraineeAccount.objects.get(phone=PHONE)
    assert Enquiry.objects.get().trainee == account
    assert len(client.get(reverse("trainee-enquiries")).json()) == 1


@pytest.mark.django_db
def test_signed_in_trainee_skips_the_code(csrf_client, fixed_code, programme):
    sign_in(csrf_client)
    # Older than the one-hour trust window: only the session vouches now.
    PhoneVerification.objects.update(verified_at=date(2020, 1, 1))
    headers = csrf_headers(csrf_client)

    requested = csrf_client.post(
        "/api/enquiries/request-code/",
        {"phone": PHONE},
        content_type="application/json",
        **headers,
    ).json()
    assert requested == {"verified": True, "code_sent": False}
    assert PhoneVerification.objects.count() == 1

    sent = csrf_client.post(
        "/api/enquiries/",
        {"phone": PHONE, "programme_id": programme.pk},
        content_type="application/json",
        **headers,
    )
    assert sent.status_code == 201


@pytest.mark.django_db
def test_signed_in_trainee_cannot_enquire_for_another_number(csrf_client, fixed_code, programme):
    sign_in(csrf_client)
    response = csrf_client.post(
        "/api/enquiries/",
        {"phone": OTHER, "programme_id": programme.pk},
        content_type="application/json",
        **csrf_headers(csrf_client),
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_enquiry_verification_does_not_replace_a_staff_session(
    client, programme, django_user_model
):
    staff = django_user_model.objects.create_user("officer", password="pw", is_staff=True)
    client.force_login(staff)
    client.post("/api/enquiries/request-code/", {"phone": PHONE})
    PhoneVerification.objects.update(code_hash=_hash(CODE))
    body = client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": CODE}).json()
    assert body == {"verified": True, "signed_in": False}
    assert int(client.session["_auth_user_id"]) == staff.pk


def _hash(code):
    from django.contrib.auth.hashers import make_password

    return make_password(code)


@pytest.mark.django_db
def test_dev_frontend_origin_can_post_after_sign_in(fixed_code, programme, settings):
    """The Next.js dev server is another origin; a signed-in POST must pass CSRF."""
    settings.CSRF_TRUSTED_ORIGINS = ["http://127.0.0.1:3000"]
    browser = Client(enforce_csrf_checks=True)
    sign_in(browser)
    response = browser.post(
        "/api/enquiries/",
        {"phone": PHONE, "programme_id": programme.pk},
        content_type="application/json",
        HTTP_ORIGIN="http://127.0.0.1:3000",
        **csrf_headers(browser),
    )
    assert response.status_code == 201


def test_debug_default_trusts_the_local_frontend():
    from django.conf import settings as live

    if live.DEBUG:
        assert "http://127.0.0.1:3000" in live.CSRF_TRUSTED_ORIGINS
