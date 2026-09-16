"""Email one-time codes: signing in with one, and attaching one to an account.

The security properties are what this file is really about. An address is a
second door into an account that already exists, so the tests check that it
cannot become a way to create an account, to enter someone else's, to discover
who is registered, or to reuse a code issued for a different purpose.
"""

import pytest
from django.urls import reverse
from django.utils import timezone

from enquiries import email_otp
from enquiries.models import EmailVerification
from trainees.auth import account_for_verified_phone
from trainees.models import TraineeAccount

PHONE = "+233241112222"
OTHER_PHONE = "+233242223333"
EMAIL = "ada@example.com"
CODE = "123456"


@pytest.fixture
def fixed_code(monkeypatch):
    monkeypatch.setattr(email_otp, "_generate_code", lambda: CODE)
    return CODE


@pytest.fixture
def account(db):
    """A trainee who signed in by phone and then added an address."""
    trainee = account_for_verified_phone(phone=PHONE, verified_at=timezone.now())
    trainee.email = EMAIL
    trainee.email_verified_at = timezone.now()
    trainee.save(update_fields=["email", "email_verified_at", "updated_at"])
    return trainee


def request_url():
    return reverse("trainee-email-otp-request")


def verify_url():
    return reverse("trainee-email-otp-verify")


# --------------------------------------------------------------------------
# Signing in


def test_a_verified_address_signs_into_its_own_account(client, account, fixed_code):
    assert (
        client.post(request_url(), {"email": EMAIL}, content_type="application/json").status_code
        == 200
    )
    challenge = EmailVerification.objects.latest("created_at")

    response = client.post(
        verify_url(),
        {"challenge_id": str(challenge.challenge_id), "email": EMAIL, "code": CODE},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    account.refresh_from_db()
    assert account.email_verified_at is not None


def test_the_code_is_never_stored_in_plaintext(client, account, fixed_code):
    client.post(request_url(), {"email": EMAIL}, content_type="application/json")

    challenge = EmailVerification.objects.latest("created_at")
    assert CODE not in challenge.code_hash
    assert challenge.code_hash != CODE


def test_an_address_on_no_account_cannot_create_one(client, db, fixed_code):
    """Email never creates an account.

    The phone is the identity because it is what a workshop replies to on
    WhatsApp. An account made from an address alone would have nowhere to send
    an enquiry.
    """
    before = TraineeAccount.objects.count()
    client.post(request_url(), {"email": "nobody@example.com"}, content_type="application/json")
    challenge = EmailVerification.objects.latest("created_at")

    response = client.post(
        verify_url(),
        {"challenge_id": str(challenge.challenge_id), "email": "nobody@example.com", "code": CODE},
        content_type="application/json",
    )

    assert response.status_code == 403
    assert TraineeAccount.objects.count() == before


def test_requesting_a_code_says_nothing_about_who_is_registered(client, account, fixed_code):
    """Otherwise this endpoint tests addresses one request at a time."""
    known = client.post(request_url(), {"email": EMAIL}, content_type="application/json")
    unknown = client.post(
        request_url(), {"email": "stranger@example.com"}, content_type="application/json"
    )

    assert known.status_code == unknown.status_code == 200
    assert set(known.json()) == set(unknown.json())


# --------------------------------------------------------------------------
# The rules that keep one code doing one job


def test_a_code_for_adding_an_address_cannot_be_used_to_sign_in(client, account, fixed_code):
    """Purpose isolation.

    A code proving ownership of a new address must not also open the account
    that address is being added to — otherwise adding an address to someone
    else's account and signing into it are the same request.
    """
    email_otp.request_code(EMAIL, purpose=EmailVerification.Purpose.ADD_TO_ACCOUNT)
    challenge = EmailVerification.objects.latest("created_at")

    response = client.post(
        verify_url(),
        {"challenge_id": str(challenge.challenge_id), "email": EMAIL, "code": CODE},
        content_type="application/json",
    )

    assert response.status_code == 400


def test_a_code_works_once(client, account, fixed_code):
    client.post(request_url(), {"email": EMAIL}, content_type="application/json")
    challenge = EmailVerification.objects.latest("created_at")
    payload = {"challenge_id": str(challenge.challenge_id), "email": EMAIL, "code": CODE}

    assert client.post(verify_url(), payload, content_type="application/json").status_code == 200
    client.logout()
    assert client.post(verify_url(), payload, content_type="application/json").status_code == 400


def test_addresses_are_matched_regardless_of_capitalisation(client, account, fixed_code):
    """Otherwise the daily cap is per capitalisation, and so is the account."""
    client.post(request_url(), {"email": "ADA@Example.COM"}, content_type="application/json")
    challenge = EmailVerification.objects.latest("created_at")

    assert challenge.email == EMAIL
    response = client.post(
        verify_url(),
        {"challenge_id": str(challenge.challenge_id), "email": "Ada@EXAMPLE.com", "code": CODE},
        content_type="application/json",
    )
    assert response.status_code == 200


def test_the_daily_cap_counts_one_address_however_it_is_typed(db, fixed_code):
    for _ in range(email_otp.MAX_PER_EMAIL_PER_DAY):
        email_otp.request_code(EMAIL)

    with pytest.raises(Exception) as caught:
        email_otp.request_code("ADA@EXAMPLE.COM")
    assert "Too many codes" in str(caught.value)


def test_a_wrong_code_is_refused_and_eventually_locked_out(client, account, fixed_code, settings):
    client.post(request_url(), {"email": EMAIL}, content_type="application/json")
    challenge = EmailVerification.objects.latest("created_at")
    wrong = {"challenge_id": str(challenge.challenge_id), "email": EMAIL, "code": "000000"}

    for _ in range(settings.OTP_MAX_ATTEMPTS):
        assert client.post(verify_url(), wrong, content_type="application/json").status_code == 400

    # The right code no longer helps once the attempts are spent.
    right = {"challenge_id": str(challenge.challenge_id), "email": EMAIL, "code": CODE}
    assert client.post(verify_url(), right, content_type="application/json").status_code == 400


def test_a_switched_off_account_cannot_be_entered_by_email(client, account, fixed_code):
    account.is_active = False
    account.save(update_fields=["is_active"])

    client.post(request_url(), {"email": EMAIL}, content_type="application/json")
    challenge = EmailVerification.objects.latest("created_at")

    response = client.post(
        verify_url(),
        {"challenge_id": str(challenge.challenge_id), "email": EMAIL, "code": CODE},
        content_type="application/json",
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------
# Attaching an address


def test_an_address_already_on_another_account_is_refused_before_any_mail_is_sent(
    client, account, fixed_code
):
    """The conflict check runs first on purpose.

    The other order sends mail to the owner of an existing address, triggered
    by a stranger, telling them nothing they can act on.
    """
    other = account_for_verified_phone(phone=OTHER_PHONE, verified_at=timezone.now())
    client.force_login(other.user)
    before = EmailVerification.objects.count()

    response = client.post(
        reverse("trainee-add-email-request"),
        {"email": EMAIL},
        content_type="application/json",
    )

    assert response.status_code == 409
    assert EmailVerification.objects.count() == before
