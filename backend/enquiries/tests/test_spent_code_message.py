"""Telling a spent code apart from one that was never requested.

Both find nothing unverified, so both used to answer "no code was requested".
Somebody who had just signed in, pressed Back and submitted the form again was
told they had never asked for a code — sending them round the loop hunting for
a message they had already read and used.
"""

import pytest

from enquiries import email_otp, otp
from enquiries.models import EmailVerification, PhoneVerification

PHONE = "+233201110123"
EMAIL = "ama@example.com"


@pytest.fixture(autouse=True)
def silent(monkeypatch):
    """Nothing here is about delivery."""
    monkeypatch.setattr(otp, "send_sms", lambda *a, **k: True)
    monkeypatch.setattr(otp, "send_email", lambda *a, **k: True)
    monkeypatch.setattr(email_otp, "send_email", lambda *a, **k: True)


# --------------------------------------------------------------------------
# Phone


@pytest.mark.django_db
def test_a_spent_phone_code_says_so(monkeypatch):
    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    challenge = otp.request_code(PHONE)
    otp.verify_code(PHONE, "123456", challenge_id=challenge.challenge_id)

    with pytest.raises(otp.OTPError, match="already been used"):
        otp.verify_code(PHONE, "123456", challenge_id=challenge.challenge_id)


@pytest.mark.django_db
def test_a_number_that_never_asked_still_says_that():
    """The other branch has to keep working, or this is just a reworded lie."""
    with pytest.raises(otp.OTPError, match="No code was requested"):
        otp.verify_code("+233209999999", "123456")


@pytest.mark.django_db
def test_a_spent_code_does_not_mask_a_live_one(monkeypatch):
    """A second, unused challenge is what should be found — not the message
    about the first one."""
    monkeypatch.setattr(otp, "_generate_code", lambda: "111111")
    first = otp.request_code(PHONE)
    otp.verify_code(PHONE, "111111", challenge_id=first.challenge_id)

    monkeypatch.setattr(otp, "_generate_code", lambda: "222222")
    otp.request_code(PHONE)

    verified = otp.verify_code(PHONE, "222222")

    assert verified.verified_at is not None


# --------------------------------------------------------------------------
# Email


@pytest.mark.django_db
def test_a_spent_email_code_says_so(monkeypatch):
    monkeypatch.setattr(email_otp, "_generate_code", lambda: "654321")
    challenge = email_otp.request_code(EMAIL)
    email_otp.verify_code(EMAIL, "654321", challenge_id=challenge.challenge_id)

    with pytest.raises(otp.OTPError, match="already been used"):
        email_otp.verify_code(EMAIL, "654321", challenge_id=challenge.challenge_id)


@pytest.mark.django_db
def test_an_address_that_never_asked_still_says_that():
    with pytest.raises(otp.OTPError, match="No code was requested"):
        email_otp.verify_code("nobody@example.com", "654321")


@pytest.mark.django_db
def test_a_spent_code_for_one_purpose_does_not_speak_for_another(monkeypatch):
    """Purposes are kept apart so a code proving a new address cannot be
    replayed as a sign-in. The message must respect the same boundary."""
    monkeypatch.setattr(email_otp, "_generate_code", lambda: "999888")
    challenge = email_otp.request_code(EMAIL, purpose=EmailVerification.Purpose.ADD_TO_ACCOUNT)
    email_otp.verify_code(
        EMAIL,
        "999888",
        purpose=EmailVerification.Purpose.ADD_TO_ACCOUNT,
        challenge_id=challenge.challenge_id,
    )

    # Nothing was ever requested for sign-in, and the spent add-to-account
    # code must not be reported as if it were.
    with pytest.raises(otp.OTPError, match="No code was requested"):
        email_otp.verify_code(EMAIL, "999888", purpose=EmailVerification.Purpose.TRAINEE_ACCESS)


@pytest.mark.django_db
def test_the_rows_are_untouched_by_the_second_attempt(monkeypatch):
    """Reporting the state must not change it."""
    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    challenge = otp.request_code(PHONE)
    otp.verify_code(PHONE, "123456", challenge_id=challenge.challenge_id)
    before = PhoneVerification.objects.get(pk=challenge.pk)

    with pytest.raises(otp.OTPError):
        otp.verify_code(PHONE, "123456", challenge_id=challenge.challenge_id)

    after = PhoneVerification.objects.get(pk=challenge.pk)
    assert after.attempts == before.attempts
    assert after.verified_at == before.verified_at
