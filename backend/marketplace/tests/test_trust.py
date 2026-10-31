"""The marketplace's second round: telling sellers at once, trust signals,
richer orders, quote requests, and buyer protection.

Buyer protection moves money, so its tests are about what must never
happen: paying a seller twice, paying one while a problem is open, or
paying before the buyer has the goods or the waiting days have passed.
"""

import hashlib
import hmac
import json
from datetime import timedelta
from io import StringIO

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from catalog.models import Trade
from courses import paystack
from enquiries import otp
from geography.models import Area, Region
from marketplace import payments, quotes, seller_messages
from marketplace.funnel import funnel_by_trade
from marketplace.models import (
    DiscountCode,
    Order,
    PaymentStatus,
    Product,
    ProductEnquiry,
    ProductOption,
    ProductReport,
    QuoteLead,
    QuoteRequest,
    SellerAccount,
    SellerPayment,
)

ACCRA = Point(-0.1870, 5.6037, srid=4326)
SECRET = "sk_test_secret"
BUYER = "+233201112222"
JSON = "application/json"


@pytest.fixture(autouse=True)
def paystack_on(settings, tmp_path):
    from django.core.cache import cache

    cache.clear()
    settings.MEDIA_ROOT = str(tmp_path)
    settings.PAYSTACK_SECRET_KEY = SECRET
    settings.PUBLIC_SITE_URL = "https://skills.example"


@pytest.fixture
def calls(monkeypatch):
    class Calls(list):
        answers = None

    made = Calls()
    made.answers = answers = {
        "/transaction/initialize": {"authorization_url": "https://checkout.paystack.test/x"},
        "/transfer": {"status": "success"},
        "/refund": {"status": "processed"},
    }

    def fake(method, path, payload=None, *, query=None):
        made.append((method, path, payload, query))
        for prefix, answer in answers.items():
            if path == prefix or path.startswith(prefix + "/"):
                return answer(payload) if callable(answer) else answer
        return {}

    monkeypatch.setattr(paystack, "_call", fake)
    return made


@pytest.fixture
def texts(monkeypatch):
    box = []

    def record(to, message):
        box.append((str(to), message))

    monkeypatch.setattr(otp, "send_sms", record)
    monkeypatch.setattr(otp, "_generate_code", lambda: "246802")
    monkeypatch.setattr(payments, "send_sms", record)
    monkeypatch.setattr(quotes, "send_sms", record)
    monkeypatch.setattr("core.sms.send_sms", record)
    return box


@pytest.fixture
def world(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)
    tailoring = Trade.objects.create(name="Tailoring", slug="tailoring")

    def seller(name, phone, **extra):
        return SellerAccount.objects.create(
            user=django_user_model.objects.create_user(f"seller-{phone[-4:]}"),
            phone=phone,
            phone_verified_at=timezone.now(),
            business_name=name,
            area=area,
            approval_status=SellerAccount.Approval.CONFIRMED,
            paystack_subaccount="ACCT_" + phone[-4:],
            paystack_recipient="RCP_" + phone[-4:],
            **extra,
        )

    ama = seller("Ama Crafts", "+233201110800")
    kofi = seller("Kofi Tailors", "+233201110801")
    return {"area": area, "tailoring": tailoring, "ama": ama, "kofi": kofi}


def product(seller, name, price="100.00", **extra):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price=price,
        status=Product.Status.PUBLISHED,
        **extra,
    )


def verify_phone(client, phone=BUYER):
    client.post(reverse("otp-request"), {"phone": phone}, content_type=JSON)
    client.post(reverse("otp-verify"), {"phone": phone, "code": "246802"}, content_type=JSON)


def as_seller(client, seller):
    client.force_login(seller.user)
    return client


def webhook(client, payload):
    body = json.dumps(payload).encode()
    signature = hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()
    return client.post(
        reverse("paystack-webhook"), body, content_type=JSON, HTTP_X_PAYSTACK_SIGNATURE=signature
    )


def pay_order(client, calls, reference, amount):
    calls.answers["/transaction/verify"] = {
        "status": "success",
        "amount": amount,
        "currency": "GHS",
    }
    return client.post(reverse("order-detail", args=[reference]))


# --------------------------------------------------------------------------
# Sellers told at once


@pytest.mark.django_db
def test_a_question_texts_the_seller_straight_away(
    client, world, texts, django_capture_on_commit_callbacks
):
    bag = product(world["ama"], "Bag")
    verify_phone(client)

    with django_capture_on_commit_callbacks(execute=True):
        client.post(
            reverse("product-enquiry-create", args=[bag.pk]),
            {"phone": BUYER, "message": "Blue?"},
            content_type=JSON,
        )

    to_seller = [m for to, m in texts if to == str(world["ama"].phone)]
    assert len(to_seller) == 1 and "Blue?" in to_seller[0] and BUYER in to_seller[0]


# --------------------------------------------------------------------------
# Reports


@pytest.mark.django_db
def test_anyone_can_report_a_product_and_staff_can_take_it_down(client, world, admin_client):
    bag = product(world["ama"], "Bag")

    response = client.post(
        reverse("product-report", args=[bag.pk]),
        {"reason": "scam", "details": "Asked me to pay first"},
        content_type=JSON,
    )
    report = ProductReport.objects.get()
    admin_client.post(
        reverse("admin:marketplace_productreport_changelist"),
        {"action": "take_down_products", "_selected_action": [report.pk]},
    )

    assert response.status_code == 201
    bag.refresh_from_db()
    report.refresh_from_db()
    assert bag.status == Product.Status.SUSPENDED
    assert report.state == ProductReport.State.CLOSED


# --------------------------------------------------------------------------
# The reply badge


def asked(seller, hours_ago, replied_after_hours=None):
    created = timezone.now() - timedelta(hours=hours_ago)
    enquiry = ProductEnquiry.objects.create(
        seller=seller,
        product_name="Bag",
        buyer_phone=BUYER,
        phone_verified_at=created,
    )
    replied = (
        created + timedelta(hours=replied_after_hours) if replied_after_hours is not None else None
    )
    ProductEnquiry.objects.filter(pk=enquiry.pk).update(created_at=created, replied_at=replied)
    return enquiry


@pytest.mark.django_db
def test_a_seller_who_usually_replies_within_a_day_gets_the_badge(client, world):
    ama, kofi = world["ama"], world["kofi"]
    product(ama, "Bag")
    product(kofi, "Shirt")
    for hours in (30, 50, 70):
        asked(ama, hours, replied_after_hours=2)
    asked(kofi, 30, replied_after_hours=2)
    asked(kofi, 50)  # Never answered.
    asked(kofi, 70, replied_after_hours=40)  # Too slow.

    cards = {c["seller"]["id"]: c for c in client.get(reverse("product-list")).json()["results"]}

    assert cards[ama.pk]["seller"]["replies_fast"] is True
    assert cards[kofi.pk]["seller"]["replies_fast"] is False


@pytest.mark.django_db
def test_the_seller_marks_a_question_replied(client, world):
    enquiry = asked(world["ama"], 1)
    url = reverse("seller-enquiry-replied", args=[enquiry.pk])

    other = as_seller(client, world["kofi"]).post(url)
    mine = as_seller(client, world["ama"]).post(url)

    assert other.status_code == 404
    assert mine.status_code == 200
    enquiry.refresh_from_db()
    assert enquiry.replied_at is not None


# --------------------------------------------------------------------------
# Options, sale prices, delivery and codes


@pytest.mark.django_db
def test_options_have_their_own_price_and_one_must_be_chosen(client, world):
    shirt = product(world["kofi"], "Shirt", price="100.00")
    as_seller(client, world["kofi"]).put(
        reverse("seller-product-options", args=[shirt.pk]),
        {"options": [{"label": "M"}, {"label": "XL", "price": "120.00"}]},
        content_type=JSON,
    )
    xl = ProductOption.objects.get(label="XL")
    price = reverse("shop-price", args=[world["kofi"].pk])

    unchosen = client.post(price, {"items": [{"product": shirt.pk}]}, content_type=JSON)
    chosen = client.post(
        price, {"items": [{"product": shirt.pk, "option": xl.pk, "quantity": 2}]}, content_type=JSON
    )

    assert unchosen.status_code == 400
    assert chosen.json()["total"] == "240.00"
    detail = client.get(reverse("product-detail", args=[shirt.pk])).json()
    assert [(o["label"], o["price"]) for o in detail["options"]] == [
        ("M", "100.00"),
        ("XL", "120.00"),
    ]


@pytest.mark.django_db
def test_a_sale_price_shows_only_when_it_was_higher(client, world):
    sale = product(world["ama"], "Sale bag", price="80.00", was_price="100.00")
    odd = product(world["ama"], "Odd bag", price="80.00", was_price="50.00")

    cards = {c["id"]: c for c in client.get(reverse("product-list")).json()["results"]}

    assert cards[sale.pk]["was_price"] == "100.00"
    assert cards[odd.pk]["was_price"] is None


@pytest.mark.django_db
def test_delivery_and_a_code_are_priced_on_the_server(client, world):
    ama = world["ama"]
    ama.delivery_fee = "20.00"
    ama.save()
    DiscountCode.objects.create(seller=ama, code="SALE10", percent=10)
    DiscountCode.objects.create(
        seller=ama, code="OLD", percent=50, ends_on=timezone.localdate() - timedelta(days=1)
    )
    bag = product(ama, "Bag", price="100.00")
    url = reverse("shop-price", args=[ama.pk])
    body = {"items": [{"product": bag.pk, "quantity": 2}], "fulfilment": "delivery"}

    with_code = client.post(url, {**body, "code": "sale10"}, content_type=JSON).json()
    expired = client.post(url, {**body, "code": "OLD"}, content_type=JSON)

    assert with_code["subtotal"] == "200.00"
    assert with_code["discount"] == "20.00"
    assert with_code["delivery"] == "20.00"
    assert with_code["total"] == "200.00"
    assert expired.status_code == 400


@pytest.mark.django_db
def test_a_bag_from_one_shop_is_one_payment_with_commission_on_the_goods(
    client, world, calls, texts
):
    ama = world["ama"]
    ama.delivery_fee = "20.00"
    ama.save()
    bag = product(ama, "Bag", price="100.00")
    purse = product(ama, "Purse", price="50.00")
    stool = product(world["kofi"], "Stool", price="10.00")
    verify_phone(client)
    body = {
        "phone": BUYER,
        "name": "Esi",
        "fulfilment": "delivery",
        "note": "Adenta, near the police station",
    }

    mixed = client.post(
        reverse("shop-order-create", args=[ama.pk]),
        {**body, "items": [{"product": bag.pk}, {"product": stool.pk}]},
        content_type=JSON,
    )
    response = client.post(
        reverse("shop-order-create", args=[ama.pk]),
        {**body, "items": [{"product": bag.pk}, {"product": purse.pk, "quantity": 2}]},
        content_type=JSON,
    )

    assert mixed.status_code == 409  # Kofi's stool is not Ama's.
    assert response.status_code == 201, response.content
    order = Order.objects.get()
    assert order.amount_pesewas == 22000
    assert order.commission_pesewas == 1000  # 5% of GH₵200, not of delivery.
    assert order.quantity == 3 and order.items.count() == 2
    assert calls[-1][2]["transaction_charge"] == 1000


# --------------------------------------------------------------------------
# Quote requests


@pytest.mark.django_db
def test_a_quote_request_reaches_makers_in_the_trade_without_the_buyers_number(
    client, world, texts, calls, django_capture_on_commit_callbacks, settings
):
    settings.MARKETPLACE_LEAD_LIMIT = 1
    kofi, ama = world["kofi"], world["ama"]
    product(kofi, "Shirt", trade=world["tailoring"])
    product(ama, "Bag")  # No trade: not a tailor.
    verify_phone(client)

    with django_capture_on_commit_callbacks(execute=True):
        made = client.post(
            reverse("quote-create"),
            {
                "trade": "tailoring",
                "title": "60 school uniforms",
                "details": "Blue and white, sizes 6 to 12",
                "name": "Mrs Owusu",
                "phone": BUYER,
            },
            content_type=JSON,
        )
    listed = as_seller(client, kofi).get(reverse("seller-quotes")).json()["results"]
    nothing_for_ama = as_seller(client, ama).get(reverse("seller-quotes")).json()["results"]

    assert made.status_code == 201 and made.json()["makers"] == 1
    assert [to for to, m in texts if "quote" in m] == [str(kofi.phone)]
    assert listed[0]["title"] == "60 school uniforms"
    assert listed[0]["buyer_phone"] is None
    assert nothing_for_ama == []


@pytest.mark.django_db
def test_unlocking_a_quote_costs_the_lead_fee_unless_on_the_shop_plan(
    client, world, calls, texts, django_capture_on_commit_callbacks
):
    kofi = world["kofi"]
    product(kofi, "Shirt", trade=world["tailoring"])
    quote = QuoteRequest.objects.create(
        trade=world["tailoring"], title="Uniforms", details="x", buyer_name="B", buyer_phone=BUYER
    )
    url = reverse("seller-quote-unlock", args=[quote.pk])

    pay = as_seller(client, kofi).post(url)
    payment = SellerPayment.objects.get(kind=SellerPayment.Kind.LEAD)
    assert pay.status_code == 201 and payment.amount_pesewas == 500
    assert not QuoteLead.objects.exists()

    with django_capture_on_commit_callbacks(execute=True):
        payments.confirm_seller_payment(
            payment.reference, {"status": "success", "amount": 500, "currency": "GHS"}
        )
    after = as_seller(client, kofi).get(reverse("seller-quotes")).json()["results"][0]

    assert after["unlocked"] is True and after["buyer_phone"] == BUYER
    assert any("Kofi Tailors saw your request" in m for to, m in texts if to == BUYER)


@pytest.mark.django_db
def test_on_the_plan_a_quote_unlocks_for_free(client, world, calls):
    kofi = world["kofi"]
    product(kofi, "Shirt", trade=world["tailoring"])
    now = timezone.now()
    SellerPayment.objects.create(
        reference="fm-plan",
        seller=kofi,
        kind=SellerPayment.Kind.PLAN_MONTH,
        amount_pesewas=3000,
        status=PaymentStatus.PAID,
        starts_at=now,
        ends_at=now + timedelta(days=30),
    )
    quote = QuoteRequest.objects.create(
        trade=world["tailoring"], title="Uniforms", details="x", buyer_name="B", buyer_phone=BUYER
    )

    response = as_seller(client, kofi).post(reverse("seller-quote-unlock", args=[quote.pk]))

    assert response.json()["buyer_phone"] == BUYER
    assert calls == []


# --------------------------------------------------------------------------
# Verified maker


@pytest.mark.django_db
def test_a_paid_visit_then_staff_mark_the_badge(client, world, calls, admin_client):
    ama = world["ama"]
    product(ama, "Bag")

    response = as_seller(client, ama).post(reverse("seller-verification"))
    payment = SellerPayment.objects.get(kind=SellerPayment.Kind.VERIFICATION)
    payments.confirm_seller_payment(
        payment.reference, {"status": "success", "amount": 8000, "currency": "GHS"}
    )
    admin_client.post(
        reverse("admin:marketplace_selleraccount_changelist"),
        {"action": "mark_verified", "_selected_action": [ama.pk]},
    )

    assert response.status_code == 201
    card = client.get(reverse("product-list")).json()["results"][0]
    assert card["seller"]["verified"] is True


# --------------------------------------------------------------------------
# Buyer protection


@pytest.fixture
def held(settings):
    settings.MARKETPLACE_HOLD_PAYMENTS = True
    settings.MARKETPLACE_RELEASE_DAYS = 3


def paid_held_order(client, world, calls):
    bag = product(world["ama"], "Bag", price="100.00")
    verify_phone(client)
    response = client.post(
        reverse("product-order-create", args=[bag.pk]),
        {"phone": BUYER, "name": "Esi", "fulfilment": "pickup"},
        content_type=JSON,
    )
    reference = response.json()["reference"]
    pay_order(client, calls, reference, 10000)
    return Order.objects.get(reference=reference)


def transfers(calls):
    return [payload for method, path, payload, _ in calls if path == "/transfer"]


@pytest.mark.django_db
def test_a_held_payment_goes_to_fliiptech_and_waits(client, world, calls, texts, held):
    order = paid_held_order(client, world, calls)

    init = next(payload for _, path, payload, _ in calls if path == "/transaction/initialize")
    assert "subaccount" not in init
    assert order.payout == Order.Payout.HELD
    assert transfers(calls) == []


@pytest.mark.django_db
def test_the_buyer_confirming_pays_the_seller_once(client, world, calls, texts, held):
    order = paid_held_order(client, world, calls)
    url = reverse("order-received", args=[order.reference])

    first = client.post(url)
    client.post(url)  # A second tap.
    call_command("marketplace_daily", stdout=StringIO(), stderr=StringIO())

    assert first.json()["payout"] == "released"
    [sent] = transfers(calls)
    assert sent["amount"] == 9500  # Less Fliiptech's 5%.
    assert sent["recipient"] == "RCP_0800"
    assert sent["reference"] == "fp-" + order.reference.split("-", 1)[1]


@pytest.mark.django_db
def test_without_confirmation_it_is_released_days_after_handover(client, world, calls, texts, held):
    order = paid_held_order(client, world, calls)
    as_seller(client, world["ama"]).patch(
        reverse("seller-order", args=[order.reference]),
        {"stage": "delivered"},
        content_type=JSON,
    )

    call_command("marketplace_daily", stdout=StringIO(), stderr=StringIO())
    assert transfers(calls) == []

    Order.objects.filter(pk=order.pk).update(delivered_at=timezone.now() - timedelta(days=4))
    call_command("marketplace_daily", stdout=StringIO(), stderr=StringIO())
    assert len(transfers(calls)) == 1


@pytest.mark.django_db
def test_a_problem_freezes_the_money_until_staff_decide(
    client, world, calls, texts, held, admin_client
):
    order = paid_held_order(client, world, calls)
    client.post(
        reverse("order-problem", args=[order.reference]),
        {"problem": "It never came"},
        content_type=JSON,
    )
    Order.objects.filter(pk=order.pk).update(delivered_at=timezone.now() - timedelta(days=10))

    client.post(reverse("order-received", args=[order.reference]))
    call_command("marketplace_daily", stdout=StringIO(), stderr=StringIO())
    assert transfers(calls) == []

    admin_client.post(
        reverse("admin:marketplace_order_changelist"),
        {"action": "refund_buyer", "_selected_action": [order.pk]},
    )
    order.refresh_from_db()
    assert order.stage == Order.Stage.REFUNDED and order.payout == Order.Payout.REFUNDED
    assert any(path == "/refund" for _, path, _, _ in calls)
    assert transfers(calls) == []


@pytest.mark.django_db
def test_a_pending_transfer_is_finished_by_paystacks_webhook(client, world, calls, texts, held):
    calls.answers["/transfer"] = {"status": "pending"}
    order = paid_held_order(client, world, calls)
    client.post(reverse("order-received", args=[order.reference]))
    order.refresh_from_db()
    assert order.payout == Order.Payout.SENDING

    webhook(
        client,
        {"event": "transfer.success", "data": {"reference": order.transfer_reference}},
    )

    order.refresh_from_db()
    assert order.payout == Order.Payout.RELEASED and order.released_at is not None


@pytest.mark.django_db
def test_a_transfer_that_needs_an_otp_says_how_to_fix_it(client, world, calls, texts, held):
    calls.answers["/transfer"] = {"status": "otp"}
    order = paid_held_order(client, world, calls)

    client.post(reverse("order-received", args=[order.reference]))

    order.refresh_from_db()
    assert order.payout == Order.Payout.FAILED
    assert "OTP" in order.transfer_note


# --------------------------------------------------------------------------
# Saved for later, and the funnel


@pytest.mark.django_db
def test_saved_products_are_fetched_by_id(client, world):
    keep = product(world["ama"], "Keep")
    product(world["ama"], "Other")

    response = client.get(reverse("product-list"), {"ids": f"{keep.pk},abc"})

    assert [card["id"] for card in response.json()["results"]] == [keep.pk]


@pytest.mark.django_db
def test_the_funnel_counts_by_trade(client, world):
    shirt = product(world["kofi"], "Shirt", trade=world["tailoring"])
    client.post(reverse("product-viewed", args=[shirt.pk]), HTTP_USER_AGENT="Phone")
    ProductEnquiry.objects.create(
        seller=world["kofi"],
        product=shirt,
        product_name="Shirt",
        buyer_phone=BUYER,
        phone_verified_at=timezone.now(),
    )

    [row] = [row for row in funnel_by_trade() if row["trade"] == "Tailoring"]

    assert (row["live"], row["views"], row["questions"], row["ask_rate"]) == (1, 1, 1, "100%")


@pytest.mark.django_db
def test_seller_messages_still_queue_the_whatsapp_reminder(client, world, texts):
    bag = product(world["ama"], "Bag")
    verify_phone(client)
    client.post(
        reverse("product-enquiry-create", args=[bag.pk]), {"phone": BUYER}, content_type=JSON
    )

    assert seller_messages.alerts_waiting().count() == 1
