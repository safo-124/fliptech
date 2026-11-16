"""A first-time visitor buying something: Buy now, the bag, Order from the maker."""

import pytest
from django.urls import reverse

from accounts.models import CustomerAccount
from accounts.tests.test_accounts import JSON, PHONE, codes, shop, sign_in  # noqa: F401
from courses import paystack
from enquiries.models import PhoneVerification
from marketplace.models import Order, Product, SellerAccount

PAYSTACK_URL = "https://checkout.paystack.test/abc"


@pytest.fixture
def paystack_on(settings, monkeypatch):
    settings.PAYSTACK_SECRET_KEY = "sk_test"
    calls = []

    def call(*args, **kwargs):
        calls.append((args, kwargs))
        return {"authorization_url": PAYSTACK_URL}

    monkeypatch.setattr(paystack, "_call", call)
    return calls


def verify_inline(client, phone=PHONE):
    """The checkout's own code step: no Register page, no password."""
    asked = client.post(reverse("otp-request"), {"phone": phone}, content_type=JSON).json()
    assert asked["verified"] is False and asked["code_sent"] is True
    verified = client.post(
        reverse("otp-verify"),
        {"phone": phone, "code": "135791", "context": "marketplace"},
        content_type=JSON,
    )
    assert verified.status_code == 200, verified.content
    return verified.json()


def pay_bag(client, seller, product, **extra):
    return client.post(
        reverse("shop-order-create", args=[seller.pk]),
        {
            "items": [{"product": product.pk, "quantity": extra.pop("quantity", 1)}],
            "phone": PHONE,
            "name": "Esi",
            "fulfilment": "pickup",
            **extra,
        },
        content_type=JSON,
    )


@pytest.mark.django_db
def test_a_stranger_checks_out_the_bag_verifying_inline_and_reaches_paystack(
    client,
    shop,  # noqa: F811
    paystack_on,  # noqa: F811
):
    seller, product = shop

    # Before verifying: refused, nothing charged.
    assert pay_bag(client, seller, product).status_code == 403
    verify_inline(client)
    response = pay_bag(client, seller, product)

    assert response.status_code == 201, response.content
    assert response.json()["authorization_url"] == PAYSTACK_URL
    # Verifying made the account, silently.
    assert CustomerAccount.objects.filter(phone=PHONE).exists()
    order = Order.objects.get()
    assert (order.status, order.buyer_phone) == ("pending", PHONE)


@pytest.mark.django_db
def test_a_signed_in_buyer_with_that_number_needs_no_code(client, shop, paystack_on):  # noqa: F811
    seller, product = shop
    sign_in(client)
    before = PhoneVerification.objects.count()

    asked = client.post(reverse("otp-request"), {"phone": PHONE}, content_type=JSON).json()
    response = pay_bag(client, seller, product)

    assert asked == {"verified": True, "code_sent": False}
    assert PhoneVerification.objects.count() == before
    assert response.status_code == 201, response.content


@pytest.mark.django_db
def test_a_seller_cannot_buy_or_order_their_own_item(client, shop, paystack_on):  # noqa: F811
    seller, product = shop
    client.force_login(seller.user)

    bought = client.post(
        reverse("product-order-create", args=[product.pk]),
        {"phone": str(seller.phone), "name": "Me", "fulfilment": "pickup"},
        content_type=JSON,
    )
    ordered = client.post(
        reverse("product-direct-order", args=[product.pk]),
        {"phone": str(seller.phone), "name": "Me"},
        content_type=JSON,
    )

    assert (bought.status_code, bought.json()["code"]) == (403, "own_item")
    assert (ordered.status_code, ordered.json()["code"]) == (403, "own_item")
    assert not Order.objects.exists()


@pytest.fixture
def unchecked_shop(shop):  # noqa: F811
    """A shop that cannot take payment on the site yet."""
    seller, product = shop
    SellerAccount.objects.filter(pk=seller.pk).update(paystack_subaccount="")
    seller.refresh_from_db()
    return seller, product


@pytest.mark.django_db
def test_order_from_the_maker_reaches_the_sellers_orders(client, unchecked_shop, paystack_on):
    seller, product = unchecked_shop
    detail = client.get(reverse("product-detail", args=[product.pk])).json()
    assert detail["buy_online"] is False
    # Buy now is refused for this maker; ordering from them is not.
    verify_inline(client)
    refused = client.post(
        reverse("product-order-create", args=[product.pk]),
        {"phone": PHONE, "name": "Esi", "fulfilment": "pickup"},
        content_type=JSON,
    )
    assert refused.status_code == 409

    response = client.post(
        reverse("product-direct-order", args=[product.pk]),
        {
            "phone": PHONE,
            "name": "Esi",
            "quantity": 2,
            "fulfilment": "pickup",
            "note": "Blue please",
        },
        content_type=JSON,
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["plan"] == Order.Plan.DIRECT
    assert body["conversation_id"]  # the order is the first message in the chat
    assert not paystack_on  # nothing charged
    order = Order.objects.get()
    assert (order.quantity, order.amount_pesewas) == (2, 20000)
    seller_client = client.__class__()
    seller_client.force_login(seller.user)
    listed = seller_client.get(reverse("seller-orders")).json()["results"]
    assert [row["reference"] for row in listed] == [order.reference]


@pytest.mark.django_db
def test_order_from_the_maker_needs_a_verified_number(client, unchecked_shop):
    _seller, product = unchecked_shop

    response = client.post(
        reverse("product-direct-order", args=[product.pk]),
        {"phone": PHONE, "name": "Esi"},
        content_type=JSON,
    )

    assert response.status_code == 403
    assert not Order.objects.exists()


@pytest.mark.django_db
def test_stock_limits_and_sold_out(client, shop, unchecked_shop, paystack_on):  # noqa: F811
    seller, product = shop
    Product.objects.filter(pk=product.pk).update(stock=2)
    verify_inline(client)

    too_many = client.post(
        reverse("product-direct-order", args=[product.pk]),
        {"phone": PHONE, "name": "Esi", "quantity": 3},
        content_type=JSON,
    )
    assert too_many.status_code == 409
    assert "Only 2" in too_many.json()["detail"]

    Product.objects.filter(pk=product.pk).update(availability=Product.Availability.SOLD_OUT)
    sold_out = client.post(
        reverse("product-direct-order", args=[product.pk]),
        {"phone": PHONE, "name": "Esi"},
        content_type=JSON,
    )
    assert sold_out.status_code == 409
    assert "sold out" in sold_out.json()["detail"]


@pytest.mark.django_db
def test_buy_now_is_held_to_the_stock_too(client, shop, paystack_on):  # noqa: F811
    seller, product = shop
    Product.objects.filter(pk=product.pk).update(stock=1)
    verify_inline(client)

    response = pay_bag(client, seller, product, quantity=2)

    assert response.status_code == 409
    assert "Only 1" in response.json()["detail"]


@pytest.mark.django_db
def test_a_failed_payment_leaves_the_order_unpaid_and_the_seller_untold(
    client,
    shop,  # noqa: F811
    paystack_on,
    monkeypatch,  # noqa: F811
):
    seller, product = shop
    verify_inline(client)
    reference = pay_bag(client, seller, product).json()["reference"]
    monkeypatch.setattr(
        paystack, "verify", lambda ref: {"status": "failed", "amount": 10000, "reference": ref}
    )

    after = client.post(reverse("order-detail", args=[reference])).json()

    assert after["status"] != "paid"
    seller_client = client.__class__()
    seller_client.force_login(seller.user)
    assert seller_client.get(reverse("seller-orders")).json()["results"] == []
