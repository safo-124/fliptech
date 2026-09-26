"""A phone sign-in code, delivered by text and by email.

An SMS on a prepaid Ghanaian network is not reliable, which is why email
sign-in exists at all. Copying the code to the address already on the account
means somebody whose text never arrives does not have to discover the other
door — they just read their email.

The things worth holding down: it is one code and not two, an unproven address
never receives one, and the email never decides whether the sign-in works.
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from enquiries import otp
from enquiries.models import EmailVerification, PhoneVerification
from providers.models import TrainerAccount
from providers.trainer_auth import account_for_verified_phone as trainer_for_phone
from trainees.auth import account_for_verified_phone as trainee_for_phone

TRAINEE_PHONE = "+233201110055"
TRAINER_PHONE = "+233201110066"


@pytest.fixture
def sent(monkeypatch):
    """Capture both channels without touching a backend.

    Clears the rate-limit cache too: django-ratelimit counts per IP in the
    shared cache, so without this one test's requests throttle the next.
    """
    from django.core.cache import cache

    cache.clear()
    box = {"sms": [], "email": []}
    monkeypatch.setattr(otp, "send_sms", lambda to, message: box["sms"].append((str(to), message)))
    monkeypatch.setattr(
        otp, "send_email", lambda to, subject, body: box["email"].append((str(to), subject, body))
    )
    return box


def code_from(text):
    """The six digits, wherever in the message they sit."""
    import re

    return re.search(r"\b(\d{4,8})\b", text).group(1)


@pytest.fixture
def trainee(db):
    account = trainee_for_phone(phone=TRAINEE_PHONE, verified_at=timezone.now())
    account.email = "ama@example.com"
    account.email_verified_at = timezone.now()
    account.save(update_fields=["email", "email_verified_at"])
    return account


@pytest.fixture
def trainer(db):
    account = trainer_for_phone(phone=TRAINER_PHONE, verified_at=timezone.now())
    account.email = "kofi@example.com"
    account.email_verified_at = timezone.now()
    account.approval_status = TrainerAccount.Approval.CONFIRMED
    account.save(update_fields=["email", "email_verified_at", "approval_status"])
    return account


# --------------------------------------------------------------------------
# One code, two deliveries


@pytest.mark.django_db
def test_the_same_code_goes_to_both(sent):
    otp.request_code("+233201110077", email="someone@example.com")

    assert len(sent["sms"]) == 1
    assert len(sent["email"]) == 1
    assert code_from(sent["sms"][0][1]) == code_from(sent["email"][0][2])


@pytest.mark.django_db
def test_it_is_one_challenge_not_two(sent):
    """Two challenges would leave two live codes for one sign-in, and only
    whichever arrived second would work."""
    otp.request_code("+233201110077", email="someone@example.com")

    assert PhoneVerification.objects.count() == 1
    assert EmailVerification.objects.count() == 0


@pytest.mark.django_db
def test_the_code_from_the_email_signs_you_in(sent):
    """The copy has to be usable, not just delivered."""
    challenge = otp.request_code(
        "+233201110077",
        email="someone@example.com",
        purpose=PhoneVerification.Purpose.TRAINEE_ACCESS,
    )
    emailed = code_from(sent["email"][0][2])

    verified = otp.verify_code(
        "+233201110077",
        emailed,
        purpose=PhoneVerification.Purpose.TRAINEE_ACCESS,
        challenge_id=challenge.challenge_id,
    )

    assert verified.verified_at is not None


@pytest.mark.django_db
def test_no_address_means_no_email(sent):
    otp.request_code("+233201110077")

    assert len(sent["sms"]) == 1
    assert sent["email"] == []


@pytest.mark.django_db
def test_a_failing_mail_server_does_not_break_sign_in(monkeypatch, sent):
    """The text has already gone. Failing the request over a slow mail server
    would take away the code that did arrive."""

    def boom(*args, **kwargs):
        raise RuntimeError("smtp is down")

    monkeypatch.setattr(otp, "send_email", boom)

    challenge = otp.request_code("+233201110077", email="someone@example.com")

    assert challenge is not None
    assert len(sent["sms"]) == 1


# --------------------------------------------------------------------------
# Which address, if any


@pytest.mark.django_db
def test_a_trainee_signing_in_is_copied_in(client, trainee, sent):
    client.post(
        reverse("trainee-otp-request"),
        {"phone": TRAINEE_PHONE},
        content_type="application/json",
    )

    assert [to for to, _, _ in sent["email"]] == ["ama@example.com"]


@pytest.mark.django_db
def test_a_trainer_signing_in_is_copied_in(client, trainer, sent):
    client.post(
        reverse("trainer-otp-request"),
        {"phone": TRAINER_PHONE},
        content_type="application/json",
    )

    assert [to for to, _, _ in sent["email"]] == ["kofi@example.com"]


@pytest.mark.django_db
def test_an_unproven_address_gets_nothing(client, trainee, sent):
    """Typing an address is not proving it. Sending a sign-in code to an
    unverified one would hand the account to whoever typed it."""
    trainee.email_verified_at = None
    trainee.save(update_fields=["email_verified_at"])

    client.post(
        reverse("trainee-otp-request"),
        {"phone": TRAINEE_PHONE},
        content_type="application/json",
    )

    assert sent["email"] == []


@pytest.mark.django_db
def test_a_switched_off_account_gets_nothing(client, trainee, sent):
    trainee.is_active = False
    trainee.save(update_fields=["is_active"])

    client.post(
        reverse("trainee-otp-request"),
        {"phone": TRAINEE_PHONE},
        content_type="application/json",
    )

    assert sent["email"] == []


@pytest.mark.django_db
def test_the_response_does_not_say_whether_an_address_exists(client, trainee, sent):
    """Otherwise anyone holding a phone number could learn whether it has an
    address attached, by reading one response."""
    with_email = client.post(
        reverse("trainee-otp-request"),
        {"phone": TRAINEE_PHONE},
        content_type="application/json",
    ).json()

    PhoneVerification.objects.all().delete()
    without = client.post(
        reverse("trainee-otp-request"),
        {"phone": "+233201110099"},
        content_type="application/json",
    ).json()

    assert sorted(with_email) == sorted(without)


@pytest.mark.django_db
def test_copies_do_not_eat_the_email_door_quota(client, trainee, sent):
    """A second delivery is not a second request. Counting it would mean five
    phone sign-ins locked somebody out of the email door they never used."""
    # Three, not five: the view allows 5/m from one address and the point
    # here is the quota, not the throttle.
    for _ in range(3):
        PhoneVerification.objects.filter(phone=TRAINEE_PHONE).update(
            created_at=timezone.now() - timedelta(days=2)
        )
        client.post(
            reverse("trainee-otp-request"),
            {"phone": TRAINEE_PHONE},
            content_type="application/json",
        )

    assert EmailVerification.objects.count() == 0
    assert len(sent["email"]) == 3
