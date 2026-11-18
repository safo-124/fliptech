"""Signing in with a phone number or email and a password, while SMS codes
cannot be relied on; reset and confirmation links by email; notices by email."""

import re

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from accounts.models import CustomerAccount
from accounts.tests.test_accounts import JSON, PHONE, codes, sign_in  # noqa: F401
from marketplace.models import SellerAccount

PASSWORD = "Kente-loom-2026"
EMAIL = "esi@example.com"


@pytest.fixture
def mail(monkeypatch):
    """Every email sent, as (to, subject, body)."""
    import core.mail

    sent = []

    def capture(to, subject, body):
        sent.append((str(to), subject, body))
        return True

    monkeypatch.setattr(core.mail, "send_email", capture)
    return sent


def register(client, **extra):
    body = {"phone": "024 111 5555", "email": EMAIL, "password": PASSWORD, "name": "Esi", **extra}
    return client.post(reverse("account-register"), body, content_type=JSON)


def password_sign_in(client, login, password=PASSWORD):
    return client.post(
        reverse("account-sign-in"), {"login": login, "password": password}, content_type=JSON
    )


def link_parts(body):
    match = re.search(r"uid=([^&\s]+)&token=([^\s]+)", body)
    return match.group(1), match.group(2)


@pytest.mark.django_db(transaction=True)
def test_registering_makes_the_account_signs_in_and_sends_a_confirmation_link(client, mail):
    response = register(client)

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["authenticated"] is True and body["joined"] is True
    account = CustomerAccount.objects.get(phone=PHONE)
    assert (account.email, account.display_name) == (EMAIL, "Esi")
    # The number is not proven: no code was typed.
    assert account.phone_verified_at is None
    assert body["account"]["phone_verified"] is False
    assert body["account"]["has_password"] is True
    assert body["account"]["email_verified"] is False
    assert body["sign_in"] == {"code": False}
    assert [to for to, _s, _b in mail] == [EMAIL]
    assert "/account/confirm-email?uid=" in mail[0][2]


@pytest.mark.django_db(transaction=True)
def test_the_email_is_optional_when_registering(client, mail):
    no_email = client.post(
        reverse("account-register"),
        {"phone": "024 111 5555", "password": PASSWORD},
        content_type=JSON,
    )
    client.logout()
    blank_email = register(client, phone="0244445555", email="")

    assert no_email.status_code == 201, no_email.content
    assert blank_email.status_code == 201, blank_email.content
    # Two accounts without an email do not collide on the unique column.
    assert list(CustomerAccount.objects.values_list("email", flat=True)) == [None, None]
    assert mail == []  # nothing to confirm
    client.logout()
    assert password_sign_in(client, "0241115555").status_code == 200


@pytest.mark.django_db
def test_registering_refuses_a_taken_number_or_email_and_a_weak_password(client, mail):
    sign_in(client)  # this number already has an account (made with a code)
    client.logout()
    CustomerAccount.objects.update(email="taken@example.com")

    taken_phone = register(client, email="new@example.com")
    taken_email = register(client, phone="0244445555", email="TAKEN@example.com")
    weak = register(client, phone="0244445556", email="other@example.com", password="12345678")

    assert taken_phone.status_code == 400
    assert "already has an account" in taken_phone.json()["phone"][0]
    assert "already has an account" in taken_email.json()["email"][0]
    assert weak.status_code == 400 and weak.json()["password"]


@pytest.mark.django_db
def test_signing_in_with_the_phone_however_typed_or_the_email(client, mail):
    register(client)
    for login in ("024 111 5555", "+233241115555", "esi@EXAMPLE.com"):
        other = Client()
        response = password_sign_in(other, login)
        assert response.status_code == 200, (login, response.content)
        assert response.json()["account"]["phone"] == PHONE
        assert other.get(reverse("account")).json()["authenticated"] is True


@pytest.mark.django_db
def test_a_wrong_password_says_the_same_as_an_unknown_account(client, mail):
    register(client)
    other = Client()

    wrong = password_sign_in(other, EMAIL, "not-the-password")
    unknown = password_sign_in(other, "nobody@example.com")

    assert wrong.status_code == unknown.status_code == 400
    assert wrong.json()["detail"] == unknown.json()["detail"]
    assert other.get(reverse("account")).json()["authenticated"] is False


@pytest.mark.django_db
def test_too_many_wrong_passwords_lock_the_account_for_a_while(client, mail, settings):
    settings.AXES_ENABLED = True
    register(client)
    other = Client()
    for _attempt in range(5):
        password_sign_in(other, EMAIL, "wrong-password")

    locked = password_sign_in(other, EMAIL)

    assert locked.status_code == 400
    assert "Too many wrong tries" in locked.json()["detail"]


@pytest.mark.django_db
def test_staff_never_sign_in_through_the_public_door(client, mail):
    staff = get_user_model().objects.create_user("staffer", password=PASSWORD, is_staff=True)
    CustomerAccount.objects.create(
        user=staff, phone=PHONE, phone_verified_at=timezone.now(), email="staff@example.com"
    )

    by_phone = password_sign_in(client, PHONE)
    by_email = password_sign_in(client, "staff@example.com")
    by_username = password_sign_in(client, "staffer")

    assert by_phone.status_code == by_email.status_code == by_username.status_code == 400
    assert client.get(reverse("account")).json()["authenticated"] is False


@pytest.mark.django_db
def test_forgot_password_emails_a_link_that_sets_a_new_one_once(client, mail):
    register(client)
    mail.clear()
    other = Client()

    asked = other.post(
        reverse("account-password-forgot"), {"login": "0241115555"}, content_type=JSON
    )
    unknown = other.post(
        reverse("account-password-forgot"), {"login": "nobody@example.com"}, content_type=JSON
    )

    assert asked.json() == unknown.json()  # says nothing about who has an account
    assert [to for to, _s, _b in mail] == [EMAIL]
    uid, token = link_parts(mail[0][2])
    reset = other.post(
        reverse("account-password-reset"),
        {"uid": uid, "token": token, "password": "New-loom-2027"},
        content_type=JSON,
    )
    again = Client().post(
        reverse("account-password-reset"),
        {"uid": uid, "token": token, "password": "Another-one-2028"},
        content_type=JSON,
    )

    assert reset.status_code == 200 and reset.json()["authenticated"] is True
    # The link proved the address.
    assert reset.json()["account"]["email_verified"] is True
    assert again.status_code == 400
    assert password_sign_in(Client(), EMAIL, PASSWORD).status_code == 400
    assert password_sign_in(Client(), EMAIL, "New-loom-2027").status_code == 200


@pytest.mark.django_db(transaction=True)
def test_the_confirmation_link_confirms_the_email(client, mail):
    register(client)
    uid, token = link_parts(mail[0][2])

    confirmed = Client().post(
        reverse("account-email-confirm"), {"uid": uid, "token": token}, content_type=JSON
    )
    bad = Client().post(
        reverse("account-email-confirm"), {"uid": uid, "token": "nope"}, content_type=JSON
    )

    assert confirmed.json() == {"confirmed": True, "email": EMAIL}
    assert CustomerAccount.objects.get().email_verified_at is not None
    assert bad.json() == {"confirmed": True, "email": EMAIL}  # already confirmed: says so


@pytest.mark.django_db
def test_an_account_made_with_a_code_sets_a_password_then_changing_it_asks_for_it(client, mail):
    sign_in(client)
    assert client.get(reverse("account")).json()["account"]["has_password"] is False

    first = client.post(reverse("account-password"), {"password": PASSWORD}, content_type=JSON)
    change_without = client.post(
        reverse("account-password"), {"password": "New-loom-2027"}, content_type=JSON
    )
    change_with = client.post(
        reverse("account-password"),
        {"current_password": PASSWORD, "password": "New-loom-2027"},
        content_type=JSON,
    )

    assert first.status_code == 200 and first.json()["account"]["has_password"] is True
    assert change_without.status_code == 400
    assert change_with.status_code == 200
    # Still signed in here.
    assert client.get(reverse("account")).json()["authenticated"] is True
    # And the phone code still works for an account with a password.
    client.logout()
    assert sign_in(client).json()["authenticated"] is True


@pytest.mark.django_db
def test_a_seller_without_a_customer_account_signs_in_with_a_password(client, mail):
    from core.identities import create_dedicated_user

    user = create_dedicated_user(get_user_model(), prefix="seller")
    user.set_password(PASSWORD)
    user.save()
    SellerAccount.objects.create(
        user=user,
        business_name="Kofi Tools",
        phone=PHONE,
        phone_verified_at=timezone.now(),
        email="kofi@example.com",
    )

    response = password_sign_in(client, "kofi@example.com")

    assert response.status_code == 200, response.content
    assert CustomerAccount.objects.get(user=user).phone == PHONE


@pytest.mark.django_db
def test_the_app_registers_and_signs_in_with_a_password_for_a_token(client, mail):
    registered = client.post(
        reverse("app-register"),
        {"phone": "0241115555", "email": EMAIL, "password": PASSWORD, "device": "Tecno"},
        content_type=JSON,
    )
    signed_in = Client().post(
        reverse("app-sign-in"), {"login": EMAIL, "password": PASSWORD}, content_type=JSON
    )
    token = signed_in.json()["token"]
    me = Client().get(reverse("account"), HTTP_AUTHORIZATION=f"Bearer {token}")

    assert registered.status_code == 201 and registered.json()["token"]
    assert signed_in.status_code == 200
    assert me.json()["account"]["email"] == EMAIL


@pytest.mark.django_db
def test_notices_go_to_a_confirmed_email_and_chats_at_most_hourly(client, mail):
    from django.core.cache import cache

    from appsupport.notify import notify

    cache.clear()
    register(client)
    CustomerAccount.objects.update(email_verified_at=timezone.now())
    mail.clear()

    notify(PHONE, "Fliiptech: your order is ready. https://x/marketplace/order/fo-1", sms="never")
    notify(PHONE, "Fliiptech: Kofi wrote to you.", link="/account/chats/4", sms="never")
    notify(PHONE, "Fliiptech: Kofi wrote again.", link="/account/chats/4", sms="never")

    assert [to for to, _s, _b in mail] == [EMAIL, EMAIL]
    assert "your order is ready" in mail[0][2]


@pytest.mark.django_db
def test_no_email_to_an_unconfirmed_address(client, mail):
    from appsupport.notify import notify

    register(client)
    mail.clear()

    notify(PHONE, "Fliiptech: your order is ready.", sms="never")

    assert mail == []
