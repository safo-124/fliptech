"""Signing in from the mobile app with a bearer token."""

import pytest
from django.test import Client
from django.urls import reverse

from accounts.models import AppToken
from accounts.tests.test_accounts import JSON, PHONE, sign_in
from enquiries import otp

OTHER = "+233241116666"


@pytest.fixture(autouse=True)
def codes(monkeypatch):
    """A known code and no texts sent, as in test_accounts.py."""
    from django.core.cache import cache

    cache.clear()
    monkeypatch.setattr(otp, "send_sms", lambda to, m: None)
    monkeypatch.setattr(otp, "send_email", lambda *a: None)
    monkeypatch.setattr(otp, "_generate_code", lambda: "135791")


def app_sign_in(client, phone=PHONE, **extra):
    challenge = client.post(reverse("app-request-code"), {"phone": phone}, content_type=JSON)
    assert challenge.status_code == 200
    return client.post(
        reverse("app-verify-code"),
        {
            "challenge_id": challenge.json()["challenge_id"],
            "phone": phone,
            "code": "135791",
            **extra,
        },
        content_type=JSON,
    )


def bearer(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.fixture
def app():
    # A strict client, as a browser would be: CSRF enforced. The app must
    # get through without a CSRF token because it sends a bearer one.
    return Client(enforce_csrf_checks=True)


@pytest.mark.django_db
def test_the_app_signs_in_with_a_code_and_gets_a_token_not_a_cookie(app):
    reply = app_sign_in(app, name="Ama Owusu", device="Tecno Spark 20")
    assert reply.status_code == 200, reply.content
    body = reply.json()
    assert body["authenticated"] is True
    assert body["token"].startswith("flt_")
    assert body["account"]["display_name"] == "Ama Owusu"
    assert "sessionid" not in reply.cookies
    stored = AppToken.objects.get()
    assert stored.device == "Tecno Spark 20"
    assert body["token"] not in stored.key_hash  # only a hash is kept

    me = Client().get(reverse("account"), **bearer(body["token"])).json()
    assert me["authenticated"] is True
    assert me["account"]["phone"] == PHONE


@pytest.mark.django_db
def test_a_token_needs_no_csrf_token_to_change_things(app):
    token = app_sign_in(app).json()["token"]
    changed = app.patch(
        reverse("account"), {"display_name": "Kofi"}, content_type=JSON, **bearer(token)
    )
    assert changed.status_code == 200
    assert changed.json()["account"]["display_name"] == "Kofi"

    # Becoming a trainee from the app, for its courses.
    became = app.post(reverse("account-add-role", args=["trainee"]), **bearer(token))
    assert became.status_code == 201
    assert became.json()["roles"]["trainee"] is not None
    mine = app.get(reverse("my-courses"), **bearer(token)).json()
    assert mine["signed_in"] is True


@pytest.mark.django_db
def test_an_unknown_or_revoked_token_is_simply_signed_out(app):
    token = app_sign_in(app).json()["token"]
    assert (
        Client().get(reverse("account"), **bearer("flt_made-up")).json()["authenticated"] is False
    )

    out = app.post(reverse("app-sign-out"), **bearer(token))
    assert out.status_code == 200
    assert AppToken.objects.get().revoked_at is not None
    assert Client().get(reverse("account"), **bearer(token)).json()["authenticated"] is False


@pytest.mark.django_db
def test_a_disabled_account_cannot_use_its_token(app):
    token = app_sign_in(app).json()["token"]
    AppToken.objects.get().user.__class__.objects.update(is_active=False)
    assert Client().get(reverse("account"), **bearer(token)).json()["authenticated"] is False


@pytest.mark.django_db
def test_the_token_wins_over_a_browser_session_on_the_same_request(app):
    token = app_sign_in(app, phone=PHONE).json()["token"]
    browser = Client()
    sign_in(browser, phone=OTHER)
    assert browser.get(reverse("account")).json()["account"]["phone"] == OTHER
    assert browser.get(reverse("account"), **bearer(token)).json()["account"]["phone"] == PHONE


@pytest.mark.django_db
def test_two_phones_are_two_sign_ins_and_one_can_be_signed_out(app):
    first = app_sign_in(app, device="Phone A").json()["token"]
    second = app_sign_in(app, device="Phone B").json()["token"]
    app.post(reverse("app-sign-out"), **bearer(first))
    assert Client().get(reverse("account"), **bearer(first)).json()["authenticated"] is False
    assert Client().get(reverse("account"), **bearer(second)).json()["authenticated"] is True
