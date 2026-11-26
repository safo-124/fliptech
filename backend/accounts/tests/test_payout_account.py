"""One payout account per person, checked by name before it is saved."""

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone

from accounts.models import PayoutAccount
from accounts.payout import bank_for_network, guess_network, local_number, names_match
from accounts.tests.test_accounts import JSON, codes, shop  # noqa: F401
from courses import paystack
from courses.models import CourseOffer
from marketplace.trust import holds_payment
from providers.models import ProviderMembership, TrainerAccount
from providers.tests.test_api import world  # noqa: F401

BANKS = [
    {"code": "MTN", "name": "MTN Mobile Money", "type": "mobile_money"},
    {"code": "VOD", "name": "Telecel Cash", "type": "mobile_money"},
    {"code": "ATL", "name": "AirtelTigo Money", "type": "mobile_money"},
    {"code": "GCB", "name": "GCB Bank", "type": "ghipss"},
]


@pytest.fixture
def paystack_fake(settings, monkeypatch):
    settings.PAYSTACK_SECRET_KEY = "sk_test"
    state = {"name": "EMMANUEL A. SAFO", "calls": []}

    def call(method, path, payload=None, *, query=None):
        state["calls"].append((method, path, payload, query))
        if path == "/bank":
            kind = (query or {}).get("type")
            return [b for b in BANKS if b["type"] == kind]
        if path == "/bank/resolve":
            if not state["name"]:
                raise paystack.PaystackError("Could not resolve account name.")
            return {"account_name": state["name"], "account_number": query["account_number"]}
        if path.startswith("/subaccount"):
            return {"subaccount_code": "ACCT_person"}
        if path == "/transferrecipient":
            return {"recipient_code": "RCP_person"}
        return {}

    monkeypatch.setattr(paystack, "_call", call)
    from django.core.cache import cache

    cache.delete("paystack:payout-banks")
    return state


def test_the_network_is_guessed_from_the_first_digits():
    assert local_number("+233241234567") == "0241234567"
    assert guess_network("+233241234567") == "mtn"
    assert guess_network("+233201234567") == "telecel"
    assert guess_network("+233561234567") == "airteltigo"
    assert guess_network("+233301234567") == ""
    assert bank_for_network(BANKS, "telecel") == "VOD"


def test_names_are_matched_by_the_words_in_them():
    assert names_match("EMMANUEL A. SAFO", "Emmanuel Acheampong Safo")
    assert names_match("KOFI", "Kofi")
    assert not names_match("AMA MENSAH", "Emmanuel Acheampong Safo")
    assert not names_match("", "Emmanuel Safo")


def signed_in(client, shop):  # noqa: F811
    seller, _product = shop
    client.force_login(seller.user)
    return seller


@pytest.mark.django_db
def test_it_starts_from_their_own_number_and_network(client, shop, paystack_fake):  # noqa: F811
    signed_in(client, shop)

    body = client.get(reverse("payout-account")).json()

    # The shop's phone is +233201110800: a Telecel number.
    assert body["account"] is None
    assert body["suggestion"] == {"number": "0201110800", "network": "telecel", "bank_code": "VOD"}


@pytest.mark.django_db
def test_check_shows_the_name_paystack_has(client, shop, paystack_fake):  # noqa: F811
    signed_in(client, shop)

    body = client.post(
        reverse("payout-account-check"),
        {"bank_code": "MTN", "account_number": "0241234567"},
        content_type=JSON,
    ).json()

    assert body == {
        "name": "EMMANUEL A. SAFO",
        "bank_name": "MTN Mobile Money",
        "account_last4": "4567",
    }


@pytest.mark.django_db
def test_saving_copies_it_to_the_shop(client, shop, paystack_fake):  # noqa: F811
    seller = signed_in(client, shop)

    response = client.put(
        reverse("payout-account"),
        {"bank_code": "MTN", "account_number": "0241234567", "confirmed_name": "EMMANUEL A. SAFO"},
        content_type=JSON,
    )

    assert response.status_code == 200, response.content
    payout = PayoutAccount.objects.get()
    # A seller with no checked ID name: nothing to compare, nothing held for it.
    assert (payout.account_name, payout.name_check) == ("EMMANUEL A. SAFO", "no_id")
    assert payout.account_last4 == "4567" and not payout.needs_staff
    seller.refresh_from_db()
    assert (seller.paystack_subaccount, seller.paystack_recipient) == ("ACCT_person", "RCP_person")
    assert seller.payout_account_name == "EMMANUEL A. SAFO"


@pytest.mark.django_db
def test_a_name_that_changed_since_the_check_is_refused(client, shop, paystack_fake):  # noqa: F811
    signed_in(client, shop)

    response = client.put(
        reverse("payout-account"),
        {"bank_code": "MTN", "account_number": "0241234567", "confirmed_name": "AMA MENSAH"},
        content_type=JSON,
    )

    assert response.status_code == 409 and response.json()["code"] == "name_changed"
    assert not PayoutAccount.objects.exists()


@pytest.mark.django_db
def test_a_name_paystack_cannot_give_holds_the_shops_money_for_staff(
    client,
    shop,  # noqa: F811
    paystack_fake,
):
    seller = signed_in(client, shop)
    paystack_fake["name"] = ""

    client.put(
        reverse("payout-account"),
        {"bank_code": "MTN", "account_number": "0241234567", "confirmed_name": "Ama Owusu"},
        content_type=JSON,
    )

    payout = PayoutAccount.objects.get()
    assert payout.name_check == "unknown" and payout.needs_staff
    seller.refresh_from_db()
    assert holds_payment(seller, 1000)


@pytest.mark.django_db
def test_a_trainers_name_is_compared_with_their_id_and_a_mismatch_keeps_the_course_off(
    client,
    world,  # noqa: F811
    paystack_fake,
    admin_client,
):
    user = get_user_model().objects.create_user("trainer-esi")
    trainer = TrainerAccount.objects.create(
        user=user,
        phone="+233241119000",
        full_name="Esi Boateng",
        approval_status=TrainerAccount.Approval.CONFIRMED,
    )
    provider = world["near"]
    ProviderMembership.objects.create(
        trainer=trainer, provider=provider, role=ProviderMembership.Role.OWNER
    )
    client.force_login(user)

    client.put(
        reverse("payout-account"),
        {"bank_code": "MTN", "account_number": "0241119000", "confirmed_name": "EMMANUEL A. SAFO"},
        content_type=JSON,
    )

    payout = PayoutAccount.objects.get()
    assert (payout.id_name, payout.name_check) == ("Esi Boateng", "different")
    offer = CourseOffer.objects.get(provider=provider)
    assert offer.paystack_subaccount == "" and offer.payout_account_name == "EMMANUEL A. SAFO"

    # Staff look, and are satisfied: the course can sell.
    admin_client.post(
        reverse("admin:accounts_payoutaccount_changelist"),
        {"action": "clear_name", "_selected_action": [payout.pk]},
    )
    payout.refresh_from_db()
    assert payout.staff_cleared_at is not None and not payout.needs_staff
    assert CourseOffer.objects.get(provider=provider).paystack_subaccount == "ACCT_person"


@pytest.mark.django_db
def test_a_matching_name_needs_nobody(client, world, paystack_fake):  # noqa: F811
    user = get_user_model().objects.create_user("trainer-emma")
    TrainerAccount.objects.create(
        user=user,
        phone="+233241119001",
        full_name="Emmanuel Acheampong Safo",
        approval_status=TrainerAccount.Approval.CONFIRMED,
    )
    client.force_login(user)

    client.put(
        reverse("payout-account"),
        {"bank_code": "MTN", "account_number": "0241119001", "confirmed_name": "EMMANUEL A. SAFO"},
        content_type=JSON,
    )

    payout = PayoutAccount.objects.get()
    assert payout.name_check == "matches" and not payout.needs_staff
    assert payout.staff_cleared_at is None
    assert timezone.now()


def test_banks_failing_does_not_hide_momo(settings, monkeypatch):
    """Paystack listing banks can fail on its own: MoMo is still offered."""
    from django.core.cache import cache

    from courses import paystack

    settings.PAYSTACK_SECRET_KEY = "sk_test"
    cache.delete("paystack:payout-banks")

    def call(method, path, payload=None, *, query=None):
        if query["type"] == "ghipss":
            raise paystack.PaystackError("Banks are down")
        return [{"code": "MTN", "name": "MTN", "active": True}]

    monkeypatch.setattr(paystack, "_call", call)

    assert paystack.payout_banks() == [{"code": "MTN", "name": "MTN", "type": "mobile_money"}]
