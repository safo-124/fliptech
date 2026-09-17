"""Signing in to the back office with an emailed code.

This is the highest-value door in the product, so the tests are mostly about
what it refuses: it must never create a user, never let a non-staff account
through, never confirm which addresses belong to staff, and never work at all
unless it has been deliberately switched on.
"""

import pytest
from django.urls import reverse

from enquiries import email_otp
from enquiries.models import EmailVerification

STAFF_EMAIL = "officer@fliiptech.test"
CODE = "123456"


@pytest.fixture
def enabled(settings):
    settings.STAFF_EMAIL_LOGIN_ENABLED = True
    return settings


@pytest.fixture
def fixed_code(monkeypatch):
    monkeypatch.setattr(email_otp, "_generate_code", lambda: CODE)
    return CODE


@pytest.fixture
def officer(db, django_user_model):
    return django_user_model.objects.create_user(
        "officer", email=STAFF_EMAIL, password="irrelevant-here", is_staff=True
    )


def url():
    return reverse("staff-email-login")


def send_code(client, email=STAFF_EMAIL):
    return client.post(url(), {"step": "email", "email": email})


def submit_code(client, *, email=STAFF_EMAIL, code=CODE, challenge_id):
    return client.post(
        url(),
        {"step": "code", "email": email, "code": code, "challenge_id": challenge_id},
    )


def latest_challenge_id():
    return str(EmailVerification.objects.latest("created_at").challenge_id)


# --------------------------------------------------------------------------
# Off unless switched on


def test_the_route_is_closed_by_default(client, db):
    """Default off is the point, not an oversight.

    It trades a password plus an axes lockout for control of a mailbox.
    """
    response = client.get(url())
    assert response.status_code == 302
    assert reverse("admin:login") in response["Location"]


def test_no_code_is_issued_while_it_is_closed(client, officer, fixed_code):
    send_code(client)
    assert EmailVerification.objects.count() == 0


# --------------------------------------------------------------------------
# The happy path


def test_a_staff_address_receives_a_code_and_signs_in(client, enabled, officer, fixed_code):
    assert send_code(client).status_code == 200
    challenge = EmailVerification.objects.latest("created_at")
    assert challenge.purpose == EmailVerification.Purpose.STAFF_ACCESS
    assert CODE not in challenge.code_hash

    response = submit_code(client, challenge_id=str(challenge.challenge_id))

    assert response.status_code == 302
    assert response["Location"] == reverse("admin:index")
    assert client.session.get("_auth_user_id") == str(officer.pk)


# --------------------------------------------------------------------------
# What it refuses


def test_an_unknown_address_gets_the_same_screen_and_no_code(client, enabled, officer, fixed_code):
    """Otherwise this page reports which addresses can reach the back office."""
    known = send_code(client)
    unknown = send_code(client, email="stranger@example.com")

    assert known.status_code == unknown.status_code == 200
    # One code, for the real address only.
    assert EmailVerification.objects.count() == 1
    assert EmailVerification.objects.get().email == STAFF_EMAIL


def test_a_non_staff_user_with_that_address_is_refused(
    client, enabled, db, django_user_model, fixed_code
):
    """A trainee who happens to share an address is not staff."""
    django_user_model.objects.create_user("trainee", email=STAFF_EMAIL, is_staff=False)

    send_code(client)

    assert EmailVerification.objects.count() == 0


def test_a_switched_off_staff_account_is_refused(client, enabled, officer, fixed_code):
    officer.is_active = False
    officer.save(update_fields=["is_active"])

    send_code(client)

    assert EmailVerification.objects.count() == 0


def test_staff_access_is_revoked_between_the_code_and_the_sign_in(
    client, enabled, officer, fixed_code
):
    """The account is re-read after the code is checked.

    A code sits in an inbox for minutes. Someone removed from staff in that
    window must not still be able to spend it.
    """
    send_code(client)
    challenge_id = latest_challenge_id()

    officer.is_staff = False
    officer.save(update_fields=["is_staff"])

    response = submit_code(client, challenge_id=challenge_id)

    assert response.status_code == 200
    assert "_auth_user_id" not in client.session


def test_a_wrong_code_does_not_sign_anyone_in(client, enabled, officer, fixed_code):
    send_code(client)

    response = submit_code(client, code="000000", challenge_id=latest_challenge_id())

    assert response.status_code == 200
    assert "_auth_user_id" not in client.session


def test_a_code_cannot_be_spent_twice(client, enabled, officer, fixed_code):
    send_code(client)
    challenge_id = latest_challenge_id()

    assert submit_code(client, challenge_id=challenge_id).status_code == 302
    client.logout()
    assert submit_code(client, challenge_id=challenge_id).status_code == 200
    assert "_auth_user_id" not in client.session


def test_a_trainee_code_cannot_open_the_back_office(client, enabled, officer, fixed_code):
    """Purpose isolation, across the whole product.

    A code issued for a trainee sign-in must not be spendable here, even when
    the same address happens to be a staff address.
    """
    email_otp.request_code(STAFF_EMAIL, purpose=EmailVerification.Purpose.TRAINEE_ACCESS)

    response = submit_code(client, challenge_id=latest_challenge_id())

    assert response.status_code == 200
    assert "_auth_user_id" not in client.session


def test_submitting_a_code_without_ever_requesting_one_fails(client, enabled, officer):
    """The unknown-address path leaves the challenge blank. It must not pass."""
    response = client.post(
        url(), {"step": "code", "email": STAFF_EMAIL, "code": CODE, "challenge_id": ""}
    )

    assert response.status_code == 200
    assert "_auth_user_id" not in client.session
