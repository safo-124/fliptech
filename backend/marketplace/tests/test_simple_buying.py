"""Buying simply (marketplace/rules.py): online only, paid in full,
collected, and every payment held until the buyer has the goods."""

from decimal import Decimal

import pytest
from django.urls import reverse

from accounts.tests.test_accounts import JSON, PHONE, codes, shop, sign_in  # noqa: F401
from marketplace.models import Order, Product
from marketplace.selling_views import BasketError, price_basket
from marketplace.tests.test_basket import add
from marketplace.tests.test_first_purchase import paystack_on  # noqa: F401


@pytest.fixture
def simple(settings):
    settings.MARKETPLACE_ONLINE_ONLY = True
    settings.MARKETPLACE_EXTRAS = False
    settings.MARKETPLACE_DELIVERY = False
    settings.MARKETPLACE_HOLD_PAYMENTS = True


@pytest.fixture
def payable_shop(shop):  # noqa: F811
    seller, product = shop
    seller.paystack_recipient = "RCP_ama"
    seller.delivery_fee = Decimal("20.00")
    seller.deposit_percent = 30
    seller.collect_deposit_percent = 20
    seller.save()
    return seller, product


@pytest.mark.django_db
def test_products_are_shown_but_bought_only_once_the_seller_can_be_paid(
    client,
    simple,
    shop,  # noqa: F811
    settings,
):
    seller, product = shop
    settings.PAYSTACK_SECRET_KEY = "sk_test"

    def card():
        found = client.get(reverse("product-list")).json()["results"]
        return next(p for p in found if p["id"] == product.pk)

    # Listed without a MoMo number (a split subaccount is not enough while
    # payments are held), but not for sale.
    assert card()["buy_online"] is False

    seller.paystack_recipient = "RCP_ama"
    seller.save()
    assert card()["buy_online"] is True


@pytest.mark.django_db
def test_made_to_order_is_paid_in_full(simple, payable_shop):
    seller, product = payable_shop
    Product.objects.filter(pk=product.pk).update(availability=Product.Availability.MADE_TO_ORDER)

    priced = price_basket(
        seller, {"items": [{"product": product.pk, "quantity": 2}], "fulfilment": "pickup"}
    )

    assert priced["plan"] == Order.Plan.FULL
    assert priced["pay_now"] == 20000 and priced["balance"] == 0


@pytest.mark.django_db
@pytest.mark.parametrize(
    "extra, words",
    [
        ({"code": "SAVE10"}, "Discount codes"),
        ({"fulfilment": "delivery"}, "Delivery is not available"),
        ({"pay_at_collection": True}, "payment on collection"),
    ],
)
def test_codes_delivery_and_paying_on_collection_are_off(simple, payable_shop, extra, words):
    seller, product = payable_shop
    data = {"items": [{"product": product.pk, "quantity": 1}], "fulfilment": "pickup", **extra}

    with pytest.raises(BasketError, match=words):
        price_basket(seller, data)


@pytest.mark.django_db
def test_buyers_see_no_delivery_deposit_or_collect_option(client, codes, simple, payable_shop):  # noqa: F811
    seller, product = payable_shop
    card = client.get(reverse("product-list")).json()["results"][0]["seller"]

    assert card["delivery_fee"] is None and card["delivery_area"] == ""
    assert card["deposit_percent"] is None and card["collect_deposit_percent"] is None

    sign_in(client)
    add(client, product)
    group = client.get(reverse("basket")).json()["groups"][0]
    assert group["delivery"] is None and group["totals"]["delivery"] is None
    assert group["takes_payments"] is False  # Paystack is off in this test


@pytest.mark.django_db
def test_no_order_to_pay_the_maker_directly(client, codes, simple, shop):  # noqa: F811
    seller, product = shop
    sign_in(client)
    add(client, product)

    response = client.post(
        reverse("basket-checkout", args=[seller.pk]),
        {"phone": PHONE, "name": "Esi", "fulfilment": "pickup"},
        content_type=JSON,
    )

    assert response.status_code in (404, 409), response.content
    assert not Order.objects.exists()


@pytest.mark.django_db
def test_every_payment_is_held(client, codes, simple, payable_shop, paystack_on):  # noqa: F811
    seller, product = payable_shop
    sign_in(client)
    add(client, product)

    response = client.post(
        reverse("basket-checkout-all"),
        {"phone": PHONE, "name": "Esi", "groups": [{"seller": seller.pk, "fulfilment": "pickup"}]},
        content_type=JSON,
    )

    assert response.status_code == 201, response.content
    order = Order.objects.get()
    assert order.payout == Order.Payout.HELD and order.amount_pesewas == 10000
    started = next(args[2] for args, _ in paystack_on if args[1] == "/transaction/initialize")
    # All of it to Fliiptech's account; nothing split to the seller yet.
    assert not started.get("split") and "subaccount" not in started
