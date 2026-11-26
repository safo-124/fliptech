"""One payment for a basket with several sellers in it."""

from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from accounts.tests.test_accounts import JSON, PHONE, codes, shop, sign_in  # noqa: F401
from courses import paystack
from marketplace import checkout as checkout_module
from marketplace import payments, payouts
from marketplace.models import CheckoutPayment, Order, Product, SellerAccount
from marketplace.tests.test_basket import add, basket
from marketplace.tests.test_first_purchase import PAYSTACK_URL, paystack_on  # noqa: F401


@pytest.fixture
def two_shops(shop, django_user_model):  # noqa: F811
    seller, product = shop
    other = SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-kofi"),
        phone="+233201110801",
        phone_verified_at=timezone.now(),
        business_name="Kofi Woodworks",
        area=seller.area,
        approval_status=SellerAccount.Approval.CONFIRMED,
        paystack_subaccount="ACCT_kofi",
        delivery_fee=Decimal("20.00"),
    )
    stool = Product.objects.create(
        seller=other, name="Stool", slug="stool", price="200.00", status=Product.Status.PUBLISHED
    )
    return (seller, product), (other, stool)


@pytest.fixture
def texts(monkeypatch):
    sent = []
    monkeypatch.setattr(checkout_module, "send_sms", lambda to, m, **k: sent.append((str(to), m)))
    monkeypatch.setattr(payments, "send_sms", lambda to, m, **k: sent.append((str(to), m)))
    return sent


def pay_all(client, groups, **extra):
    return client.post(
        reverse("basket-checkout-all"),
        {"phone": PHONE, "name": "Esi", "groups": groups, **extra},
        content_type=JSON,
    )


def started(paystack_on):  # noqa: F811
    """The payload of the transaction/initialize call."""
    return next(args[2] for args, _ in paystack_on if args[1] == "/transaction/initialize")


@pytest.mark.django_db
def test_one_payment_makes_an_order_per_seller_and_splits_it(client, two_shops, paystack_on):  # noqa: F811
    (ama, bag), (kofi, stool) = two_shops
    sign_in(client)
    add(client, bag, 2)
    add(client, stool, 1)

    response = pay_all(
        client,
        [{"seller": ama.pk, "fulfilment": "pickup"}, {"seller": kofi.pk, "fulfilment": "delivery"}],
        note="Opposite the Madina market",
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["kind"] == "pay" and body["authorization_url"] == PAYSTACK_URL
    payment = CheckoutPayment.objects.get()
    assert body["reference"] == payment.reference and payment.reference.startswith("fg-")
    orders = {o.seller_id: o for o in payment.orders.all()}
    assert orders[ama.pk].amount_pesewas == 20000
    # Kofi delivers: GH₵200 and GH₵20 delivery. The address goes to him only.
    assert orders[kofi.pk].amount_pesewas == 22000
    assert orders[kofi.pk].note == "Opposite the Madina market" and orders[ama.pk].note == ""
    assert payment.amount_pesewas == 42000
    sent = started(paystack_on)
    assert sent["amount"] == 42000 and sent["reference"] == payment.reference
    # Each seller gets their part less Fliiptech's 5% of the goods; delivery is theirs.
    shares = {s["subaccount"]: s["share"] for s in sent["split"]["subaccounts"]}
    assert shares == {"ACCT_ama": 20000 - 1000, "ACCT_kofi": 22000 - 1000}
    assert sent["split"]["type"] == "flat" and "subaccount" not in sent


@pytest.mark.django_db
def test_a_held_seller_is_left_out_of_the_split(client, two_shops, paystack_on, settings):  # noqa: F811
    (ama, bag), (kofi, stool) = two_shops
    # Kofi is new: his first orders are held until the buyer has them.
    settings.MARKETPLACE_HOLD_FIRST_ORDERS = 3
    SellerAccount.objects.filter(pk=kofi.pk).update(paystack_recipient="RCP_kofi")
    sign_in(client)
    add(client, bag)
    add(client, stool)

    pay_all(client, [{"seller": ama.pk}, {"seller": kofi.pk}])

    orders = {o.seller_id: o for o in Order.objects.all()}
    assert orders[kofi.pk].payout == Order.Payout.HELD
    assert orders[ama.pk].payout == Order.Payout.SPLIT
    shares = started(paystack_on)["split"]["subaccounts"]
    assert [s["subaccount"] for s in shares] == ["ACCT_ama"]


@pytest.mark.django_db
def test_paystack_confirming_it_pays_every_order_and_sends_one_receipt(
    client,
    two_shops,
    paystack_on,  # noqa: F811
    texts,
    django_capture_on_commit_callbacks,
):
    (ama, bag), (kofi, stool) = two_shops
    sign_in(client)
    add(client, bag)
    add(client, stool)
    reference = pay_all(client, [{"seller": ama.pk}, {"seller": kofi.pk}]).json()["reference"]

    with django_capture_on_commit_callbacks(execute=True):
        checkout_module.confirm_checkout(
            reference, {"status": "success", "amount": 30000, "currency": "GHS"}
        )

    payment = CheckoutPayment.objects.get()
    assert payment.status == "paid"
    assert set(payment.orders.values_list("status", flat=True)) == {"paid"}
    buyer_texts = [m for to, m in texts if to == PHONE]
    assert len(buyer_texts) == 1 and reference in buyer_texts[0]
    # Each seller is told about their own order.
    assert {to for to, _m in texts} >= {str(ama.phone), str(kofi.phone)}
    # Back on the receipt page, the paid things leave the basket.
    receipt = client.get(reverse("checkout-receipt", args=[reference])).json()
    assert receipt["status"] == "paid" and len(receipt["orders"]) == 2
    client.post(reverse("checkout-receipt", args=[reference]))
    assert basket(client)["count"] == 0


@pytest.mark.django_db
def test_a_charge_for_the_wrong_amount_pays_nothing(client, two_shops, paystack_on, texts):  # noqa: F811
    (ama, bag), (kofi, stool) = two_shops
    sign_in(client)
    add(client, bag)
    add(client, stool)
    reference = pay_all(client, [{"seller": ama.pk}, {"seller": kofi.pk}]).json()["reference"]

    checkout_module.confirm_checkout(
        reference, {"status": "success", "amount": 100, "currency": "GHS"}
    )

    assert CheckoutPayment.objects.get().status == "failed"
    assert set(Order.objects.values_list("status", flat=True)) == {"failed"}
    assert basket(client)["count"] == 2


@pytest.mark.django_db
def test_refunding_one_seller_gives_back_only_their_part(client, two_shops, paystack_on, texts):  # noqa: F811
    (ama, bag), (kofi, stool) = two_shops
    sign_in(client)
    add(client, bag)
    add(client, stool)
    reference = pay_all(client, [{"seller": ama.pk}, {"seller": kofi.pk}]).json()["reference"]
    checkout_module.confirm_checkout(
        reference, {"status": "success", "amount": 30000, "currency": "GHS"}
    )
    kofis = Order.objects.get(seller=kofi)
    paystack_on.clear()

    payouts.refund(kofis)

    args, _ = paystack_on[-1]
    assert args[1] == "/refund"
    assert args[2] == {"transaction": reference, "amount": 20000}
    assert Order.objects.get(seller=kofi).stage == Order.Stage.REFUNDED
    assert Order.objects.get(seller=ama).stage == Order.Stage.NEW


@pytest.mark.django_db
def test_a_maker_paid_directly_cannot_be_in_the_one_payment(client, two_shops, paystack_on):  # noqa: F811
    (ama, bag), (kofi, stool) = two_shops
    SellerAccount.objects.filter(pk=kofi.pk).update(paystack_subaccount="")
    sign_in(client)
    add(client, bag)
    add(client, stool)

    response = pay_all(client, [{"seller": ama.pk}, {"seller": kofi.pk}])

    assert response.status_code == 409 and response.json()["code"] == "direct"
    assert not CheckoutPayment.objects.exists() and not Order.objects.exists()


@pytest.mark.django_db
def test_delivery_needs_an_address_and_an_unverified_phone_cannot_pay(
    client,
    two_shops,
    paystack_on,  # noqa: F811
):
    (ama, bag), (kofi, stool) = two_shops
    add(client, bag)

    no_address = pay_all(client, [{"seller": kofi.pk, "fulfilment": "delivery"}])
    stranger = pay_all(client, [{"seller": ama.pk}])

    assert no_address.status_code == 400 and "note" in no_address.json()
    assert stranger.status_code == 403
    assert paystack.enabled()
