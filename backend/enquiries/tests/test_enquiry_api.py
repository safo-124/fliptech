"""Tests for the enquiry flow.

The caps are tested as carefully as the happy path, because each code is a paid
SMS and SMS pumping fraud is a direct cash loss rather than a nuisance.
"""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from enquiries.models import Enquiry, PhoneVerification
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PHONE = "+233241112222"


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


def last_code_for(phone):
    """The console SMS backend logs the code; tests read the hash side instead."""
    return PhoneVerification.objects.filter(phone=phone).latest("created_at")


@pytest.mark.django_db
def test_code_is_never_stored_in_plaintext(client, programme):
    client.post("/api/enquiries/request-code/", {"phone": PHONE})

    verification = last_code_for(PHONE)
    assert verification.code_hash
    assert len(verification.code_hash) > 20
    # No field anywhere holds the digits themselves.
    assert not any(
        str(getattr(verification, f.name)).isdigit()
        and len(str(getattr(verification, f.name))) == 6
        for f in verification._meta.fields
        if f.name not in ("id",)
    )


@pytest.mark.django_db
def test_wrong_code_is_rejected_and_counted(client, programme):
    client.post("/api/enquiries/request-code/", {"phone": PHONE})

    response = client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": "000000"})

    assert response.status_code == 400
    assert last_code_for(PHONE).attempts == 1


@pytest.mark.django_db
def test_code_is_burned_after_five_wrong_attempts(client, programme, settings):
    client.post("/api/enquiries/request-code/", {"phone": PHONE})
    for _ in range(settings.OTP_MAX_ATTEMPTS):
        client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": "000000"})

    response = client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": "000000"})

    assert "Too many incorrect attempts" in response.json()["detail"]


@pytest.mark.django_db
def test_expired_code_is_refused(client, programme, monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    otp.request_code(PHONE)
    verification = last_code_for(PHONE)
    verification.expires_at = timezone.now() - timedelta(seconds=1)
    verification.save()

    response = client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": "123456"})

    assert response.status_code == 400
    assert "expired" in response.json()["detail"]


@pytest.mark.django_db
def test_daily_cap_per_number_stops_sms_pumping(client, programme, settings, monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    for _ in range(settings.OTP_MAX_PER_PHONE_PER_DAY):
        otp.request_code(PHONE)

    with pytest.raises(otp.OTPError, match="Too many codes"):
        otp.request_code(PHONE)


@pytest.mark.django_db
def test_a_verified_number_can_enquire_and_gets_a_whatsapp_handover(client, programme, monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    otp.request_code(PHONE)
    client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": "123456"})

    response = client.post(
        "/api/enquiries/",
        {"phone": PHONE, "programme_id": programme.pk, "message": "Do you take beginners?"},
    )
    body = response.json()

    assert response.status_code == 201
    assert body["reference_code"].startswith("SH-")
    assert body["whatsapp_url"].startswith("https://wa.me/233240000000")
    assert body["reference_code"] in body["whatsapp_url"]
    assert Enquiry.objects.get().state == Enquiry.State.SENT


@pytest.mark.django_db
def test_an_unverified_number_cannot_enquire(client, programme):
    response = client.post("/api/enquiries/", {"phone": PHONE, "programme_id": programme.pk})

    assert response.status_code == 403
    assert Enquiry.objects.count() == 0


@pytest.mark.django_db
def test_second_provider_in_the_same_session_costs_no_extra_sms(client, programme, monkeypatch):
    """Screen 4 encourages enquiring with three providers. That must not be
    three SMS."""
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    otp.request_code(PHONE)
    client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": "123456"})
    codes_sent_before = PhoneVerification.objects.count()

    response = client.post("/api/enquiries/request-code/", {"phone": PHONE})

    assert response.json() == {"verified": True, "code_sent": False}
    assert PhoneVerification.objects.count() == codes_sent_before


@pytest.mark.django_db
def test_enquiry_is_refused_for_an_unpublished_listing(client, programme, monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    otp.request_code(PHONE)
    client.post("/api/enquiries/verify-code/", {"phone": PHONE, "code": "123456"})
    programme.provider.status = Provider.Status.SUSPENDED
    programme.provider.save()

    response = client.post("/api/enquiries/", {"phone": PHONE, "programme_id": programme.pk})

    assert response.status_code == 400
