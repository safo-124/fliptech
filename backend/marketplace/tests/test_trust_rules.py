"""Trust and safety, stock, pay on collection, the account bag and
addresses, price drops, disputes and the seller's payouts."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.gis.geos import Point
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from accounts.models import CustomerAccount, SavedProduct
from courses import paystack
from geography.models import Area, Region
from marketplace import alerts, payments
from marketplace.models import Order, Product, SellerAccount

JSON = "application/json"
BUYER = "+233201112222"


@pytest.fixture
def texts(monkeypatch, settings):
    settings.PAYSTACK_SECRET_KEY = "sk_test_secret"
    settings.PUBLIC_SITE_URL = "https://skills.example"
    sent = []

    def record(to, message):
        sent.append((str(to), message))

    def fake(method, path, payload=None, *, query=None):
        if path == "/transaction/initialize":
            return {"authorization_url": "https://checkout.paystack.test/x"}
        return {}

    monkeypatch.setattr(paystack, "_call", fake)
    for module in (alerts, payments):
        monkeypatch.setattr(module, "send_sms", record)
    from marketplace import stock

    monkeypatch.setattr(stock, "send_sms", record)
    return sent


@pytest.fixture
def seller(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(
        region=region, name="Adenta", slug="adenta", centroid=Point(-0.18, 5.6, srid=4326)
    )
    return SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-ama"),
        phone="+233201110800",
        phone_verified_at=timezone.now(),
        business_name="Ama Tools",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
        paystack_subaccount="ACCT_a",
        paystack_recipient="RCP_a",
    )


@pytest.fixture
def buyer(db, django_user_model):
    account = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("buyer-kofi"),
        phone=BUYER,
        phone_verified_at=timezone.now(),
    )
    client = Client()
    client.force_login(account.user)
    client.account = account
    return client


def product(seller, name, price="100.00", **extra):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price=price,
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=1),
        **extra,
    )


def order_of(client, seller, items, **extra):
    return client.post(
        reverse("shop-order-create", args=[seller.pk]),
        {"items": items, "phone": BUYER, "name": "Kofi", "fulfilment": "pickup", **extra},
        content_type=JSON,
    )


def pay(order):
    return payments.confirm_order(
        order.reference, {"status": "success", "amount": order.amount_pesewas, "currency": "GHS"}
    )


@pytest.mark.django_db
def test_payments_need_the_id_check(seller, buyer, texts, settings, client):
    settings.MARKETPLACE_REQUIRE_ID = True
    kit = product(seller, "Spanner")
    assert client.get(reverse("product-detail", args=[kit.pk])).json()["buy_online"] is False
    assert (
        client.get(reverse("product-detail", args=[kit.pk])).json()["seller"]["level"]
        == "confirmed"
    )
    refused = order_of(buyer, seller, [{"product": kit.pk, "quantity": 1}])
    assert refused.status_code == 409

    seller.id_status = SellerAccount.IdStatus.CHECKED
    seller.save()
    detail = client.get(reverse("product-detail", args=[kit.pk])).json()
    assert detail["buy_online"] is True
    assert detail["seller"]["level"] == "payments"
    assert order_of(buyer, seller, [{"product": kit.pk, "quantity": 1}]).status_code == 201
    assert [
        r["name"]
        for r in client.get(reverse("product-list"), {"pay_online": "1"}).json()["results"]
    ] == ["Spanner"]


@pytest.mark.django_db
def test_sellers_send_their_id(seller, settings, tmp_path):
    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    settings.MEDIA_ROOT = str(tmp_path)
    path = tmp_path / "id.jpg"
    Image.new("RGB", (400, 300), "white").save(path)
    client = Client()
    client.force_login(seller.user)
    with open(path, "rb") as handle:
        sent = client.post(
            reverse("seller-id"),
            {"document": SimpleUploadedFile("id.jpg", handle.read(), "image/jpeg")},
        )
    assert sent.status_code == 201, sent.content
    assert sent.json()["status"] == "submitted"
    seller.refresh_from_db()
    assert seller.id_document


@pytest.mark.django_db
def test_new_sellers_and_large_orders_are_held(seller, buyer, texts, settings):
    settings.MARKETPLACE_HOLD_FIRST_ORDERS = 1
    settings.MARKETPLACE_HOLD_ABOVE = 300
    small, large = product(seller, "Pliers", "50.00"), product(seller, "Generator", "900.00")
    first = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": small.pk, "quantity": 1}]).json()[
            "reference"
        ]
    )
    assert first.payout == Order.Payout.HELD
    pay(first)
    second = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": small.pk, "quantity": 1}]).json()[
            "reference"
        ]
    )
    assert second.payout == Order.Payout.SPLIT
    big = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": large.pk, "quantity": 1}]).json()[
            "reference"
        ]
    )
    assert big.payout == Order.Payout.HELD


@pytest.mark.django_db
def test_new_sellers_are_capped_until_they_have_completed_orders(seller, buyer, texts, settings):
    settings.MARKETPLACE_NEW_SELLER_LIMIT = 500
    settings.MARKETPLACE_NEW_SELLER_ORDERS = 1
    dear = product(seller, "Welder", "800.00")
    refused = order_of(buyer, seller, [{"product": dear.pk, "quantity": 1}])
    assert refused.status_code == 409
    assert "GH₵500" in refused.json()["detail"]
    cheap = product(seller, "Gloves", "40.00")
    done = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": cheap.pk, "quantity": 1}]).json()[
            "reference"
        ]
    )
    done = pay(done)
    done.stage = Order.Stage.RECEIVED
    done.save()
    again = order_of(buyer, seller, [{"product": dear.pk, "quantity": 1}])
    assert again.status_code == 201, again.json()


@pytest.mark.django_db(transaction=True)
def test_stock_goes_down_warns_and_sells_out(seller, buyer, texts, settings, client):
    settings.MARKETPLACE_LOW_STOCK = 2
    kit = product(seller, "Saw", stock=4)
    assert client.get(reverse("product-detail", args=[kit.pk])).json()["few_left"] == 4
    too_many = order_of(buyer, seller, [{"product": kit.pk, "quantity": 5}])
    assert too_many.status_code == 409
    assert "Only 4 Saw left" in too_many.json()["detail"]

    first = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": kit.pk, "quantity": 2}]).json()["reference"]
    )
    pay(first)
    kit.refresh_from_db()
    assert kit.stock == 2
    assert any("Running low: Saw (2 left)" in message for _, message in texts)

    rest = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": kit.pk, "quantity": 2}]).json()["reference"]
    )
    pay(rest)
    kit.refresh_from_db()
    assert kit.stock == 0
    assert kit.availability == Product.Availability.SOLD_OUT
    assert any("Sold out now: Saw" in message for _, message in texts)


@pytest.mark.django_db(transaction=True)
def test_pay_on_collection(seller, buyer, texts):
    kit = product(seller, "Toolbox", "200.00")
    body = {
        "items": [{"product": kit.pk, "quantity": 1}],
        "fulfilment": "pickup",
        "pay_at_collection": True,
    }
    url = reverse("shop-price", args=[seller.pk])
    assert buyer.post(url, body, content_type=JSON).status_code == 400  # not offered

    seller.collect_deposit_percent = 20
    seller.save()
    priced = buyer.post(url, body, content_type=JSON).json()
    assert priced["plan"] == "collect"
    assert priced["pay_now"] == "40.00"
    assert priced["balance"] == "160.00"
    assert buyer.post(url, {**body, "fulfilment": "delivery"}, content_type=JSON).status_code == 400

    made = order_of(
        buyer, seller, [{"product": kit.pk, "quantity": 1}], pay_at_collection=True
    ).json()
    order = Order.objects.get(reference=made["reference"])
    assert order.amount_pesewas == 4000
    assert order.plan == Order.Plan.COLLECT
    pay(order)
    order.refresh_from_db()
    assert order.fully_paid
    assert any("GH₵160.00 in cash" in message for _, message in texts)


@pytest.mark.django_db(transaction=True)
def test_disputes_get_the_sellers_side_then_staff_decide(seller, buyer, texts):
    kit = product(seller, "Drill")
    order = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": kit.pk, "quantity": 1}]).json()["reference"]
    )
    pay(order)
    reported = buyer.post(
        reverse("order-problem", args=[order.reference]),
        {"problem": "It does not turn on"},
        content_type=JSON,
    )
    assert reported.status_code == 200
    assert any(to == "+233201110800" and "Reply within 48 hours" in m for to, m in texts)

    shop = Client()
    shop.force_login(seller.user)
    replied = shop.post(
        reverse("seller-order-reply", args=[order.reference]),
        {"reply": "It needs charging first"},
        content_type=JSON,
    )
    assert replied.status_code == 200
    assert replied.json()["problem_reply"] == "It needs charging first"
    assert any(to == BUYER and "replied about order" in m for to, m in texts)


@pytest.mark.django_db
def test_the_bag_and_addresses_follow_the_account(seller, buyer):
    saw, drill = product(seller, "Saw"), product(seller, "Drill")
    put = buyer.put(
        reverse("account-bag"),
        {"items": [{"product": saw.pk, "quantity": 2}, {"product": 99999}]},
        content_type=JSON,
    )
    assert [(row["name"], row["quantity"]) for row in put.json()["items"]] == [("Saw", 2)]
    added = buyer.post(
        reverse("account-bag"),
        {"add": [{"product": saw.pk, "quantity": 1}, {"product": drill.pk, "quantity": 1}]},
        content_type=JSON,
    ).json()["items"]
    assert [(row["name"], row["quantity"]) for row in added] == [("Saw", 3), ("Drill", 1)]
    assert added[0]["seller"]["business_name"] == "Ama Tools"

    for address in ("House 4, Adenta", "Shop 9, Madina", "house 4, adenta"):
        buyer.post(reverse("account-addresses"), {"address": address}, content_type=JSON)
    listed = buyer.get(reverse("account-addresses")).json()["results"]
    assert [row["address"] for row in listed] == ["House 4, Adenta", "Shop 9, Madina"]


@pytest.mark.django_db
def test_saved_things_that_get_cheaper_are_texted_once(seller, buyer, texts):
    kit = product(seller, "Grinder", "300.00")
    buyer.put(reverse("account-saved"), {"add": [kit.pk]}, content_type=JSON)
    assert SavedProduct.objects.get().price_seen == Decimal("300.00")
    assert alerts.tell_price_drops() == 0
    kit.price = Decimal("250.00")
    kit.save()
    assert alerts.tell_price_drops() == 1
    assert any(to == BUYER and "Grinder (now GH₵250)" in m for to, m in texts)
    assert alerts.tell_price_drops() == 0


@pytest.mark.django_db
def test_sellers_see_where_their_money_is(seller, buyer, texts, settings):
    settings.MARKETPLACE_HOLD_FIRST_ORDERS = 1
    kit = product(seller, "Level", "100.00")
    held = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": kit.pk, "quantity": 1}]).json()["reference"]
    )
    pay(held)
    split = Order.objects.get(
        reference=order_of(buyer, seller, [{"product": kit.pk, "quantity": 1}]).json()["reference"]
    )
    pay(split)
    shop = Client()
    shop.force_login(seller.user)
    found = shop.get(reverse("seller-payouts")).json()
    states = {row["reference"]: row["state"] for row in found["results"]}
    assert states == {held.reference: "held", split.reference: "paid_out"}
    assert found["totals"]["held"] == found["totals"]["paid_out"] == "95.00"
