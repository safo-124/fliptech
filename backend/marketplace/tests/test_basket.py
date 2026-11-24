"""The shared shopping basket: one set of rules for the website and the app."""

from decimal import Decimal

import pytest
from django.urls import reverse

from accounts.models import CustomerAccount
from accounts.tests.test_accounts import JSON, PHONE, codes, shop, sign_in  # noqa: F401
from marketplace.models import Basket, BasketLine, Order, Product, SellerAccount
from marketplace.tests.test_first_purchase import (  # noqa: F401
    PAYSTACK_URL,
    paystack_on,
    unchecked_shop,
    verify_inline,
)


def add(client, product, quantity=1, token=None, **extra):
    headers = {"HTTP_X_BASKET_TOKEN": token} if token else {}
    return client.post(
        reverse("basket-items"),
        {"product": product.pk, "quantity": quantity, **extra},
        content_type=JSON,
        **headers,
    )


def basket(client, token=None):
    headers = {"HTTP_X_BASKET_TOKEN": token} if token else {}
    return client.get(reverse("basket"), **headers).json()


def checkout(client, seller, token=None, **extra):
    headers = {"HTTP_X_BASKET_TOKEN": token} if token else {}
    return client.post(
        reverse("basket-checkout", args=[seller.pk]),
        {"phone": PHONE, "name": "Esi", "fulfilment": "pickup", **extra},
        content_type=JSON,
        **headers,
    )


def a_second_product(seller, **fields):
    return Product.objects.create(
        seller=seller,
        name=fields.pop("name", "Spokeshave"),
        price=fields.pop("price", Decimal("50.00")),
        status=Product.Status.PUBLISHED,
        **fields,
    )


@pytest.mark.django_db
def test_signed_out_a_device_token_holds_the_basket(client, shop):  # noqa: F811
    seller, product = shop

    first = add(client, product, 2).json()
    token = first["token"]

    assert token and first["count"] == 2
    # The token is the only way back to it: the next add sends it, and no new one is made.
    again = add(client, product, 1, token=token).json()
    assert again["token"] is None and again["count"] == 3
    assert Basket.objects.count() == 1
    assert Basket.objects.get().token_hash != token  # only a hash is kept
    # Another device without the token sees nothing.
    assert basket(client)["groups"] == []


@pytest.mark.django_db
def test_the_basket_is_grouped_by_seller_with_what_checkout_needs(client, shop):  # noqa: F811
    seller, product = shop
    product.refresh_from_db()
    SellerAccount.objects.filter(pk=seller.pk).update(
        delivery_fee=Decimal("15.00"), delivery_area="Kumasi"
    )
    token = add(client, product, 2).json()["token"]

    group = basket(client, token)["groups"][0]

    assert group["seller"]["id"] == seller.pk
    assert group["seller"]["business_name"] == seller.business_name
    assert "verified" in group["seller"] and "area" in group["seller"]
    assert group["delivery"] == {"fee": "15.00", "area": "Kumasi"}
    assert "takes_payments" in group
    line = group["lines"][0]
    assert line["quantity"] == 2 and line["available"] is True
    assert Decimal(line["line_total"]) == product.price * 2
    assert Decimal(group["subtotal"]) == product.price * 2
    assert Decimal(group["totals"]["delivery"]["total"]) == product.price * 2 + 15


@pytest.mark.django_db
def test_quantity_is_held_to_the_stock(client, shop):  # noqa: F811
    seller, product = shop
    Product.objects.filter(pk=product.pk).update(stock=3)

    added = add(client, product, 5).json()
    token = added["token"]
    line = added["groups"][0]["lines"][0]
    too_many = client.patch(
        reverse("basket-line", args=[line["id"]]),
        {"quantity": 4},
        content_type=JSON,
        HTTP_X_BASKET_TOKEN=token,
    )
    zero = client.patch(
        reverse("basket-line", args=[line["id"]]),
        {"quantity": 0},
        content_type=JSON,
        HTTP_X_BASKET_TOKEN=token,
    )
    fine = client.patch(
        reverse("basket-line", args=[line["id"]]),
        {"quantity": 2},
        content_type=JSON,
        HTTP_X_BASKET_TOKEN=token,
    )

    assert (line["quantity"], line["max_quantity"]) == (3, 3)
    assert added["notice"] == "Only 3 left."
    assert too_many.status_code == 400 and too_many.json()["detail"] == "Only 3 left."
    assert zero.status_code == 400
    assert fine.json()["groups"][0]["lines"][0]["quantity"] == 2


@pytest.mark.django_db
def test_adding_when_every_one_left_is_in_the_basket_says_so(client, shop):  # noqa: F811
    seller, product = shop
    Product.objects.filter(pk=product.pk).update(stock=2)

    first = add(client, product, 2).json()
    again = add(client, product, 1, token=first["token"]).json()

    assert first["added"] == 2 and first["notice"] == ""
    # Nothing went in: the page must not say "Added to your basket".
    assert again["added"] == 0
    assert again["notice"] == "You already have all 2 in your basket."
    assert again["groups"][0]["lines"][0]["quantity"] == 2


@pytest.mark.django_db
def test_a_seller_cannot_put_their_own_product_in_the_basket(client, shop):  # noqa: F811
    seller, product = shop
    client.force_login(seller.user)

    response = add(client, product)

    assert (response.status_code, response.json()["code"]) == (403, "own_item")
    assert not BasketLine.objects.exists()


@pytest.mark.django_db
def test_sold_out_or_withdrawn_lines_stay_but_count_for_nothing(client, shop):  # noqa: F811
    seller, product = shop
    other = a_second_product(seller)
    token = add(client, product, 1).json()["token"]
    add(client, other, 2, token=token)

    Product.objects.filter(pk=product.pk).update(availability=Product.Availability.SOLD_OUT)
    Product.objects.filter(pk=other.pk).update(status=Product.Status.DRAFT)
    shown = basket(client, token)

    lines = shown["groups"][0]["lines"]
    assert [line["available"] for line in lines] == [False, False]
    assert {line["unavailable_reason"] for line in lines} == {"No longer available"}
    assert shown["count"] == 0
    assert shown["groups"][0]["subtotal"] == "0.00"
    # A sold-out product cannot be added afresh.
    Product.objects.filter(pk=other.pk).update(status=Product.Status.PUBLISHED, stock=0)
    assert add(client, other, token=token).status_code == 409


@pytest.mark.django_db
def test_signing_in_merges_the_device_basket_adding_up_to_the_stock(client, shop):  # noqa: F811
    seller, product = shop
    Product.objects.filter(pk=product.pk).update(stock=4)
    other = a_second_product(seller)
    # The account already has 3 of the product.
    sign_in(client)
    add(client, product, 3)
    client.logout()

    token = add(client, product, 2).json()["token"]
    add(client, other, 1, token=token)
    sign_in(client)
    merged = client.post(reverse("basket-merge"), {"token": token}, content_type=JSON).json()

    quantities = {line["product"]: line["quantity"] for line in merged["groups"][0]["lines"]}
    assert quantities == {product.pk: 4, other.pk: 1}  # 3 + 2, held to the 4 left
    assert Basket.objects.count() == 1
    assert Basket.objects.get().account == CustomerAccount.objects.get(phone=PHONE)


@pytest.mark.django_db
def test_a_signed_in_request_that_still_sends_the_token_is_merged_by_itself(client, shop):  # noqa: F811
    seller, product = shop
    token = add(client, product, 2).json()["token"]
    sign_in(client)

    shown = basket(client, token)

    assert shown["count"] == 2
    assert Basket.objects.get().account is not None
    assert Basket.objects.filter(token_hash__isnull=False).count() == 0


@pytest.mark.django_db
def test_a_changed_price_stops_checkout_once_and_says_so(client, shop, paystack_on):  # noqa: F811
    seller, product = shop
    product.refresh_from_db()
    old = product.price
    sign_in(client)
    add(client, product, 1)
    Product.objects.filter(pk=product.pk).update(price=old + 10)

    first = checkout(client, seller)
    second = checkout(client, seller)

    assert first.status_code == 409 and first.json()["code"] == "price_changed"
    flagged = first.json()["basket"]["groups"][0]["lines"][0]["price_changed"]
    assert flagged == {"from": f"{old:.2f}", "to": f"{old + 10:.2f}"}
    assert second.status_code == 201, second.content
    assert Order.objects.get().amount_pesewas == int((old + 10) * 100)


@pytest.mark.django_db
def test_checkout_with_a_seller_who_takes_payments_starts_paystack_and_keeps_the_basket(
    client,
    shop,  # noqa: F811
    paystack_on,  # noqa: F811
):
    seller, product = shop
    token = add(client, product, 2).json()["token"]

    unverified = checkout(client, seller, token=token)
    verify_inline(client)  # the code on the checkout page signs them in...
    paid = checkout(client, seller, token=token)

    assert unverified.status_code == 403
    assert paid.status_code == 201, paid.content
    assert paid.json()["kind"] == "pay"
    assert paid.json()["authorization_url"] == PAYSTACK_URL
    order = Order.objects.get()
    assert (order.status, order.quantity) == ("pending", 2)
    # ...and the device basket joined the new account's, still full until paid.
    assert basket(client)["count"] == 2


@pytest.mark.django_db
def test_a_failed_payment_leaves_the_basket_and_a_paid_one_empties_it(client, shop, paystack_on):  # noqa: F811
    seller, product = shop
    sign_in(client)
    add(client, product, 1)
    reference = checkout(client, seller).json()["reference"]

    Order.objects.filter(reference=reference).update(status="failed")
    client.post(reverse("order-detail", args=[reference]))
    assert basket(client)["count"] == 1

    Order.objects.filter(reference=reference).update(status="paid")
    client.post(reverse("order-detail", args=[reference]))
    assert basket(client)["count"] == 0


@pytest.mark.django_db
def test_checkout_with_a_maker_paid_directly_sends_the_order(client, unchecked_shop, paystack_on):  # noqa: F811
    seller, product = unchecked_shop
    other = a_second_product(seller)
    sign_in(client)
    add(client, product, 1)
    add(client, other, 2)

    group = basket(client)["groups"][0]
    sent = checkout(client, seller, note="Saturday morning")

    assert group["takes_payments"] is False
    assert group["totals"]["pickup"]["plan"] == "direct"
    assert sent.status_code == 201, sent.content
    body = sent.json()
    assert body["kind"] == "direct" and body["plan"] == "direct"
    order = Order.objects.get()
    assert (order.plan, order.quantity, order.status) == ("direct", 3, "pending")
    assert order.items.count() == 2
    assert body["conversation_id"]  # the order opened the chat
    # Sent, so it leaves the basket.
    assert basket(client)["count"] == 0


@pytest.mark.django_db
def test_made_to_order_lines_say_the_days_and_the_deposit(client, shop, paystack_on):  # noqa: F811
    seller, product = shop
    product.refresh_from_db()
    SellerAccount.objects.filter(pk=seller.pk).update(deposit_percent=40)
    Product.objects.filter(pk=product.pk).update(
        availability=Product.Availability.MADE_TO_ORDER, make_days=10
    )
    sign_in(client)
    add(client, product, 1)

    group = basket(client)["groups"][0]
    line = group["lines"][0]

    assert group["takes_payments"] is True
    assert line["made_to_order"]["deposit"] == f"{product.price * 40 / 100:.2f}"
    assert group["totals"]["pickup"]["plan"] == "deposit"
    assert line["made_to_order"]["days"] == 10


@pytest.mark.django_db
def test_lines_can_be_removed_and_the_basket_cleared(client, shop):  # noqa: F811
    seller, product = shop
    other = a_second_product(seller)
    sign_in(client)
    add(client, product)
    line_id = add(client, other).json()["groups"][0]["lines"][1]["id"]

    after_remove = client.delete(reverse("basket-line", args=[line_id])).json()
    cleared = client.delete(reverse("basket")).json()

    assert [line["product"] for line in after_remove["groups"][0]["lines"]] == [product.pk]
    assert cleared["groups"] == [] and cleared["count"] == 0


@pytest.mark.django_db
def test_the_app_uses_the_same_basket_with_its_token(client, shop):  # noqa: F811
    from accounts.app_auth import issue_token

    seller, product = shop
    sign_in(client)
    add(client, product, 2)
    user = CustomerAccount.objects.get(phone=PHONE).user
    app = client.__class__()

    shown = app.get(reverse("basket"), HTTP_AUTHORIZATION=f"Bearer {issue_token(user)}").json()

    assert shown["count"] == 2


@pytest.mark.django_db
def test_a_browser_gets_its_csrf_cookie_from_the_basket_before_changing_it(shop):  # noqa: F811
    from django.test import Client

    seller, product = shop
    browser = Client(enforce_csrf_checks=True)

    refused = add(browser, product)
    browser.get(reverse("basket"))
    token = browser.cookies["csrftoken"].value
    added = browser.post(
        reverse("basket-items"),
        {"product": product.pk, "quantity": 1},
        content_type=JSON,
        HTTP_X_CSRFTOKEN=token,
    )

    assert refused.status_code == 403
    assert added.status_code == 200 and added.json()["count"] == 1


@pytest.mark.django_db
def test_a_seller_says_how_many_days_a_made_to_order_item_takes(client, shop):  # noqa: F811
    seller, product = shop
    client.force_login(seller.user)

    response = client.patch(
        reverse("seller-product", args=[product.pk]),
        {"availability": "made_to_order", "make_days": 7},
        content_type=JSON,
    )
    shown = client.get(reverse("product-detail", args=[product.pk])).json()

    assert response.status_code == 200, response.content
    assert response.json()["make_days"] == 7
    assert shown["make_days"] == 7
