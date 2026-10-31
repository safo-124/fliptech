"""The marketplace's measured and paid parts.

Numbers a seller sees, the order buyers see products in, boosts and the Shop
plan, paying a seller on the site, and reviews. The money tests hold the rule
paid courses hold: nothing is granted until Paystack confirms a charge for
exactly what was asked.
"""

import hashlib
import hmac
import json
from datetime import timedelta
from io import BytesIO, StringIO

import pytest
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from courses import paystack
from enquiries import otp
from geography.models import Area, Region
from marketplace.management.commands import marketplace_daily
from marketplace.models import (
    Order,
    PaymentStatus,
    Product,
    ProductEnquiry,
    SellerAccount,
    SellerNotice,
    SellerPayment,
    SellerReview,
)
from marketplace.reviews import token_for

ACCRA = Point(-0.1870, 5.6037, srid=4326)
TEMA = Point(-0.0166, 5.6698, srid=4326)
SECRET = "sk_test_secret"
BUYER = "+233201112222"


@pytest.fixture(autouse=True)
def paystack_on(settings, tmp_path):
    from django.core.cache import cache

    cache.clear()
    settings.MEDIA_ROOT = str(tmp_path)
    settings.PAYSTACK_SECRET_KEY = SECRET
    settings.PUBLIC_SITE_URL = "https://skills.example"
    settings.MARKETPLACE_FREE_PRODUCT_LIMIT = 2


@pytest.fixture
def calls(monkeypatch):
    """Paystack, faked: records each call and answers as Paystack would."""

    class Calls(list):
        answers = None

    made = Calls()
    made.answers = answers = {
        "/transaction/initialize": {"authorization_url": "https://checkout.paystack.test/x"},
    }

    def fake(method, path, payload=None, *, query=None):
        made.append((method, path, payload, query))
        for prefix, answer in answers.items():
            if path.startswith(prefix):
                return answer(payload) if callable(answer) else answer
        return {}

    monkeypatch.setattr(paystack, "_call", fake)
    return made


@pytest.fixture
def texts(monkeypatch):
    box = []
    monkeypatch.setattr(otp, "send_sms", lambda to, m: box.append((str(to), m)))
    monkeypatch.setattr(otp, "_generate_code", lambda: "246802")
    monkeypatch.setattr(marketplace_daily, "send_sms", lambda to, m: box.append((str(to), m)))
    from marketplace import payments

    monkeypatch.setattr(payments, "send_sms", lambda to, m: box.append((str(to), m)))
    return box


@pytest.fixture
def areas(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return (
        Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA),
        Area.objects.create(region=region, name="Tema", slug="tema", centroid=TEMA),
    )


def make_seller(django_user_model, area, *, name, phone, subaccount=""):
    return SellerAccount.objects.create(
        user=django_user_model.objects.create_user(f"seller-{phone[-4:]}"),
        phone=phone,
        phone_verified_at=timezone.now(),
        business_name=name,
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
        paystack_subaccount=subaccount,
    )


def make_product(seller, name, price="100.00", **extra):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price=price,
        status=Product.Status.PUBLISHED,
        **extra,
    )


@pytest.fixture
def shop(db, django_user_model, areas):
    ama = make_seller(
        django_user_model, areas[0], name="Ama Crafts", phone="+233201110800", subaccount="ACCT_ama"
    )
    kofi = make_seller(django_user_model, areas[1], name="Kofi Wood", phone="+233201110801")
    return ama, kofi


def ids(response):
    return [item["id"] for item in response.json()["results"]]


def as_seller(client, seller):
    client.force_login(seller.user)
    return client


def pay(reference, amount, *, status="success", currency="GHS"):
    return {
        "status": status,
        "reference": reference,
        "amount": amount,
        "currency": currency,
        "channel": "mobile_money",
    }


def webhook(client, data):
    body = json.dumps({"event": "charge.success", "data": data}).encode()
    signature = hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()
    return client.post(
        reverse("paystack-webhook"),
        body,
        content_type="application/json",
        HTTP_X_PAYSTACK_SIGNATURE=signature,
    )


def verify_phone(client, phone=BUYER):
    client.post(reverse("otp-request"), {"phone": phone}, content_type="application/json")
    client.post(
        reverse("otp-verify"), {"phone": phone, "code": "246802"}, content_type="application/json"
    )


# --------------------------------------------------------------------------
# Numbers


@pytest.mark.django_db
def test_a_product_view_is_counted_once_a_day_and_never_the_sellers_own(client, shop):
    ama, _ = shop
    bag = make_product(ama, "Ankara Bag")
    url = reverse("product-viewed", args=[bag.pk])

    for _ in range(3):
        assert client.post(url, HTTP_USER_AGENT="Phone").status_code == 204
    client.post(url, HTTP_USER_AGENT="Googlebot/2.1")
    as_seller(client, ama).post(url, HTTP_USER_AGENT="Seller phone")

    stats = as_seller(client, ama).get(reverse("seller-stats")).json()

    assert stats["totals"]["views"] == 1
    assert stats["products"][0] == {
        "id": bag.pk,
        "name": "Ankara Bag",
        "status": "published",
        "views_7d": 1,
        "views_30d": 1,
        "enquiries_30d": 0,
        "sold_30d": 0,
        "boosted_until": None,
    }


@pytest.mark.django_db
def test_stats_are_only_the_signed_in_sellers(client, shop):
    ama, kofi = shop
    make_product(kofi, "Stool")

    stats = as_seller(client, ama).get(reverse("seller-stats")).json()

    assert stats["products"] == []
    assert client.logout() is None
    assert client.get(reverse("seller-stats")).status_code in (401, 403)


# --------------------------------------------------------------------------
# Sorting and near me


@pytest.mark.django_db
def test_buyers_can_sort_by_price_and_by_distance(client, shop):
    ama, kofi = shop
    bag = make_product(ama, "Bag", price="200.00")
    stool = make_product(kofi, "Stool", price="50.00")
    ask = make_product(kofi, "Table", price=None)

    by_price = client.get(reverse("product-list"), {"sort": "price"})
    by_price_down = client.get(reverse("product-list"), {"sort": "-price"})
    # Standing in Tema: Kofi is there, Ama is in Adenta.
    nearest = client.get(reverse("product-list"), {"sort": "nearest", "near": "5.6698,-0.0166"})

    assert ids(by_price) == [stool.pk, bag.pk, ask.pk]
    assert ids(by_price_down) == [bag.pk, stool.pk, ask.pk]
    assert ids(nearest)[-1] == bag.pk
    cards = {card["id"]: card for card in nearest.json()["results"]}
    assert cards[stool.pk]["distance_km"] == 0.0
    assert 15 < cards[bag.pk]["distance_km"] < 25


@pytest.mark.django_db
def test_a_point_outside_ghana_is_ignored(client, shop):
    make_product(shop[0], "Bag")

    response = client.get(reverse("product-list"), {"sort": "nearest", "near": "51.5,-0.12"})

    assert response.status_code == 200
    assert response.json()["results"][0]["distance_km"] is None


# --------------------------------------------------------------------------
# Boosts


def running_boost(seller, product, days=7):
    now = timezone.now()
    return SellerPayment.objects.create(
        reference=f"fm-test-{product.pk}-{days}",
        seller=seller,
        kind=SellerPayment.Kind.BOOST_WEEK,
        product=product,
        amount_pesewas=1500,
        status=PaymentStatus.PAID,
        paid_at=now,
        starts_at=now,
        ends_at=now + timedelta(days=days),
    )


@pytest.mark.django_db
def test_a_boosted_product_comes_first_and_says_sponsored(client, shop):
    ama, kofi = shop
    old = make_product(kofi, "Old Stool")
    make_product(ama, "New Bag")
    running_boost(kofi, old)

    response = client.get(reverse("product-list"))

    assert ids(response)[0] == old.pk
    first, second = response.json()["results"]
    assert first["sponsored"] is True and second["sponsored"] is False


@pytest.mark.django_db
def test_an_ended_boost_no_longer_counts(client, shop):
    ama, kofi = shop
    old = make_product(kofi, "Old Stool")
    new = make_product(ama, "New Bag")
    boost = running_boost(kofi, old)
    boost.ends_at = timezone.now() - timedelta(minutes=1)
    boost.save()

    assert ids(client.get(reverse("product-list"))) == [new.pk, old.pk]


@pytest.mark.django_db
def test_buying_a_boost_pays_fliiptech_and_starts_only_when_paystack_confirms(client, shop, calls):
    ama, _ = shop
    bag = make_product(ama, "Bag")

    response = as_seller(client, ama).post(
        reverse("seller-boost"),
        {"product": bag.pk, "kind": "boost_week"},
        content_type="application/json",
    )

    assert response.status_code == 201
    payload = calls[-1][2]
    assert payload["amount"] == 1500
    # Fliiptech's own money: no subaccount, no split.
    assert "subaccount" not in payload and "transaction_charge" not in payload
    assert payload["callback_url"].startswith("https://skills.example/sell/shop?payment=fm-")
    payment = SellerPayment.objects.get()
    assert payment.status == PaymentStatus.PENDING and payment.starts_at is None
    assert client.get(reverse("product-list")).json()["results"][0]["sponsored"] is False

    # Less than asked unlocks nothing.
    calls.answers["/transaction/verify/"] = pay(payment.reference, 1000)
    client.post(reverse("seller-payment-verify", args=[payment.reference]))
    payment.refresh_from_db()
    assert payment.status == PaymentStatus.FAILED


@pytest.mark.django_db
def test_a_boost_confirmed_by_webhook_runs_for_a_week(client, shop, calls):
    ama, _ = shop
    bag = make_product(ama, "Bag")
    as_seller(client, ama).post(
        reverse("seller-boost"),
        {"product": bag.pk, "kind": "boost_week"},
        content_type="application/json",
    )
    payment = SellerPayment.objects.get()

    assert webhook(client, pay(payment.reference, 1500)).status_code == 200
    webhook(client, pay(payment.reference, 1500))  # Paystack retries.

    payment.refresh_from_db()
    assert payment.status == PaymentStatus.PAID
    assert payment.ends_at - payment.starts_at == timedelta(days=7)
    assert client.get(reverse("product-list")).json()["results"][0]["sponsored"] is True


@pytest.mark.django_db
def test_a_second_boost_starts_where_the_first_ends(shop):
    ama, _ = shop
    bag = make_product(ama, "Bag")
    first = running_boost(ama, bag)
    second = SellerPayment(
        reference="fm-second",
        seller=ama,
        kind=SellerPayment.Kind.BOOST_MONTH,
        product=bag,
        amount_pesewas=4000,
    )

    second.start()

    assert second.starts_at == first.ends_at
    assert second.ends_at == first.ends_at + timedelta(days=30)


@pytest.mark.django_db
def test_only_your_own_visible_product_can_be_boosted(client, shop, calls):
    ama, kofi = shop
    stool = make_product(kofi, "Stool")

    response = as_seller(client, ama).post(
        reverse("seller-boost"),
        {"product": stool.pk, "kind": "boost_week"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert not SellerPayment.objects.exists()


# --------------------------------------------------------------------------
# The Shop plan


def running_plan(seller):
    now = timezone.now()
    return SellerPayment.objects.create(
        reference=f"fm-plan-{seller.pk}",
        seller=seller,
        kind=SellerPayment.Kind.PLAN_MONTH,
        amount_pesewas=3000,
        status=PaymentStatus.PAID,
        paid_at=now,
        starts_at=now,
        ends_at=now + timedelta(days=30),
    )


def publish(client, product):
    return client.post(reverse("seller-product-publish", args=[product.pk]))


@pytest.mark.django_db
def test_a_free_shop_is_limited_and_the_plan_lifts_the_limit(client, shop):
    ama, _ = shop
    make_product(ama, "One")
    make_product(ama, "Two")
    third = Product.objects.create(seller=ama, name="Three", slug="three", price="10.00")
    as_seller(client, ama)

    refused = publish(client, third)
    running_plan(ama)
    allowed = publish(client, third)

    assert refused.status_code == 409 and refused.json()["code"] == "free_limit"
    assert allowed.status_code == 200


@pytest.mark.django_db
def test_without_payments_there_is_no_limit(client, shop, settings):
    settings.PAYSTACK_SECRET_KEY = ""
    ama, _ = shop
    make_product(ama, "One")
    make_product(ama, "Two")
    third = Product.objects.create(seller=ama, name="Three", slug="three", price="10.00")

    assert publish(as_seller(client, ama), third).status_code == 200


@pytest.mark.django_db
def test_the_plan_gives_one_free_boost_a_month(client, shop, calls):
    ama, _ = shop
    bag = make_product(ama, "Bag")
    running_plan(ama)
    as_seller(client, ama)
    url = reverse("seller-boost")

    first = client.post(
        url, {"product": bag.pk, "use_plan_credit": True}, content_type="application/json"
    )
    second = client.post(
        url, {"product": bag.pk, "use_plan_credit": True}, content_type="application/json"
    )

    assert first.status_code == 201
    assert first.json()["plan"]["free_boost_available"] is False
    assert second.status_code == 409
    assert calls == []  # Nothing went to Paystack.


@pytest.mark.django_db
def test_the_banner_shows_only_while_the_plan_runs(client, shop):
    ama, _ = shop
    make_product(ama, "Bag")
    buffer = BytesIO()
    Image.new("RGB", (60, 20), "blue").save(buffer, format="JPEG")
    upload = SimpleUploadedFile("banner.jpg", buffer.getvalue(), content_type="image/jpeg")

    response = as_seller(client, ama).put(
        reverse("seller-banner"),
        encode_multipart(BOUNDARY, {"image": upload}),
        content_type=MULTIPART_CONTENT,
    )
    client.logout()
    without_plan = client.get(reverse("seller-detail", args=[ama.pk])).json()
    running_plan(ama)
    with_plan = client.get(reverse("seller-detail", args=[ama.pk])).json()

    assert response.status_code == 200, response.content
    assert without_plan["banner"] is None and without_plan["on_plan"] is False
    assert with_plan["banner"].endswith(".jpg") and with_plan["on_plan"] is True


@pytest.mark.django_db
def test_a_shop_plan_shop_comes_above_a_free_one(client, shop):
    ama, kofi = shop
    planned = make_product(kofi, "Old Stool")
    make_product(ama, "New Bag")
    running_plan(kofi)

    assert ids(client.get(reverse("product-list")))[0] == planned.pk


@pytest.mark.django_db
def test_the_daily_job_reminds_a_seller_once_before_the_plan_ends(shop, texts):
    ama, _ = shop
    plan = running_plan(ama)
    plan.ends_at = timezone.now() + timedelta(days=2)
    plan.save()

    call_command("marketplace_daily", stdout=StringIO())
    call_command("marketplace_daily", stdout=StringIO())

    reminders = [message for to, message in texts if to == str(ama.phone)]
    assert len(reminders) == 1 and "Shop plan ends" in reminders[0]


# --------------------------------------------------------------------------
# Paying a seller on the site


def order(client, product, **body):
    return client.post(
        reverse("product-order-create", args=[product.pk]),
        {"phone": BUYER, "name": "Esi Mensah", "fulfilment": "pickup", **body},
        content_type="application/json",
    )


@pytest.mark.django_db
def test_buy_now_is_offered_only_when_the_seller_can_be_paid(client, shop):
    ama, kofi = shop
    bag = make_product(ama, "Bag")
    stool = make_product(kofi, "Stool")
    gone = make_product(ama, "Gone", availability=Product.Availability.SOLD_OUT)
    ask = make_product(ama, "Ask", price=None)

    cards = {card["id"]: card for card in client.get(reverse("product-list")).json()["results"]}

    assert cards[bag.pk]["buy_online"] is True
    assert not any(cards[p.pk]["buy_online"] for p in (stool, gone, ask))


@pytest.mark.django_db
def test_paying_needs_a_verified_phone(client, shop, calls, texts):
    bag = make_product(shop[0], "Bag")

    response = order(client, bag)

    assert response.status_code == 403
    assert not Order.objects.exists()


@pytest.mark.django_db
def test_an_order_is_split_to_the_seller_with_fliiptechs_commission(client, shop, calls, texts):
    ama, _ = shop
    bag = make_product(ama, "Bag", price="100.00")
    verify_phone(client)

    response = order(client, bag, quantity=2)

    assert response.status_code == 201, response.content
    payload = calls[-1][2]
    assert payload["amount"] == 20000
    assert payload["subaccount"] == "ACCT_ama"
    # 5% of GH₵200, in pesewas, to Fliiptech; the rest to Ama.
    assert payload["transaction_charge"] == 1000
    assert payload["bearer"] == "subaccount"
    saved = Order.objects.get()
    assert payload["callback_url"] == f"https://skills.example/marketplace/order/{saved.reference}"
    assert saved.status == PaymentStatus.PENDING


@pytest.mark.django_db
def test_delivery_needs_an_address(client, shop, calls, texts):
    bag = make_product(shop[0], "Bag")
    verify_phone(client)

    response = order(client, bag, fulfilment="delivery")

    assert response.status_code == 400
    assert "note" in response.json()


@pytest.mark.django_db
def test_a_confirmed_order_alerts_the_seller_and_texts_the_buyer_once(
    client, shop, calls, texts, django_capture_on_commit_callbacks
):
    ama, _ = shop
    bag = make_product(ama, "Bag", price="100.00")
    verify_phone(client)
    reference = order(client, bag).json()["reference"]
    calls.answers["/transaction/verify/"] = pay(reference, 10000)

    with django_capture_on_commit_callbacks(execute=True):
        back = client.post(reverse("order-detail", args=[reference]))
        webhook(client, pay(reference, 10000))

    assert back.json()["status"] == "paid"
    assert back.json()["seller_phone"] == str(ama.phone)
    assert SellerNotice.objects.filter(kind=SellerNotice.Kind.NEW_ORDER).count() == 1
    receipts = [message for to, message in texts if to == BUYER and "you paid" in message]
    assert len(receipts) == 1
    seller_orders = as_seller(client, ama).get(reverse("seller-orders")).json()["results"]
    assert [row["reference"] for row in seller_orders] == [reference]


@pytest.mark.django_db
def test_a_short_payment_does_not_pay_for_an_order(client, shop, calls, texts):
    bag = make_product(shop[0], "Bag", price="100.00")
    verify_phone(client)
    reference = order(client, bag).json()["reference"]

    webhook(client, pay(reference, 100))

    assert Order.objects.get().status == PaymentStatus.FAILED
    assert not SellerNotice.objects.exists()


@pytest.mark.django_db
def test_an_order_is_only_shown_to_the_browser_that_made_it(client, shop, calls, texts):
    from django.test import Client

    bag = make_product(shop[0], "Bag")
    verify_phone(client)
    reference = order(client, bag).json()["reference"]

    assert client.get(reverse("order-detail", args=[reference])).status_code == 200
    assert Client().get(reverse("order-detail", args=[reference])).status_code == 404


@pytest.mark.django_db
def test_the_seller_marks_an_order_handed_over(client, shop):
    ama, kofi = shop
    paid = Order.objects.create(
        reference="fo-handover",
        seller=ama,
        product_name="Bag",
        unit_price="100.00",
        amount_pesewas=10000,
        buyer_phone=BUYER,
        buyer_name="Esi",
        status=PaymentStatus.PAID,
        paid_at=timezone.now(),
    )
    url = reverse("seller-order", args=[paid.reference])

    other = as_seller(client, kofi).patch(
        url, {"stage": "delivered"}, content_type="application/json"
    )
    mine = as_seller(client, ama).patch(
        url, {"stage": "delivered"}, content_type="application/json"
    )

    assert other.status_code == 404
    assert mine.json()["stage"] == "delivered"


@pytest.mark.django_db
def test_payout_setup_creates_a_subaccount(client, shop, calls):
    _, kofi = shop
    calls.answers["/bank"] = [{"code": "MTN", "name": "MTN Mobile Money", "active": True}]
    calls.answers["/subaccount"] = {"subaccount_code": "ACCT_kofi"}

    response = as_seller(client, kofi).put(
        reverse("seller-payout"),
        {"bank_code": "MTN", "account_number": "024 000 0801", "account_name": "Kofi Mensah"},
        content_type="application/json",
    )

    assert response.status_code == 200, response.content
    kofi.refresh_from_db()
    assert kofi.paystack_subaccount == "ACCT_kofi" and kofi.payout_account_last4 == "0801"


# --------------------------------------------------------------------------
# Reviews


def enquiry(seller, days_ago, phone=BUYER):
    made = ProductEnquiry.objects.create(
        seller=seller,
        product_name="Bag",
        buyer_phone=phone,
        buyer_name="Esi Mensah",
        phone_verified_at=timezone.now(),
    )
    ProductEnquiry.objects.filter(pk=made.pk).update(
        created_at=timezone.now() - timedelta(days=days_ago)
    )
    made.refresh_from_db()
    return made


@pytest.mark.django_db
def test_buyers_are_texted_a_review_link_once(shop, texts):
    ama, kofi = shop
    enquiry(ama, days_ago=4)
    enquiry(kofi, days_ago=5)  # Same buyer: one text a day.
    enquiry(ama, days_ago=1, phone="+233201113333")  # Too soon.
    enquiry(ama, days_ago=40, phone="+233201114444")  # Too long ago.

    call_command("marketplace_daily", stdout=StringIO())
    call_command("marketplace_daily", stdout=StringIO())
    call_command("marketplace_daily", stdout=StringIO())

    links = [(to, message) for to, message in texts if "/marketplace/review/" in message]
    assert [to for to, _ in links] == [BUYER, BUYER]
    assert ProductEnquiry.objects.filter(review_requested_at__isnull=False).count() == 2


@pytest.mark.django_db
def test_a_review_through_the_link_counts_once_and_shows_on_the_shop(client, shop):
    ama, _ = shop
    asked = enquiry(ama, days_ago=4)
    url = reverse("seller-review", args=[token_for(enquiry=asked)])

    first = client.post(
        url, {"rating": 4, "comment": "Lovely bag", "bought": True}, content_type="application/json"
    )
    again = client.post(url, {"rating": 1}, content_type="application/json")
    shop_page = client.get(reverse("seller-detail", args=[ama.pk])).json()

    assert first.status_code == 201
    assert again.status_code == 409
    assert shop_page["seller"]["rating"] == {"average": 4.0, "count": 1}
    [review] = shop_page["reviews"]
    assert review["comment"] == "Lovely bag" and review["buyer_name"] == "Esi"
    assert "phone" not in json.dumps(review)


@pytest.mark.django_db
def test_a_made_up_review_link_is_refused(client, shop):
    response = client.post(
        reverse("seller-review", args=["not-a-token"]),
        {"rating": 5},
        content_type="application/json",
    )

    assert response.status_code == 404
    assert not SellerReview.objects.exists()


@pytest.mark.django_db
def test_a_hidden_review_does_not_count(client, shop):
    ama, _ = shop
    asked = enquiry(ama, days_ago=4)
    client.post(
        reverse("seller-review", args=[token_for(enquiry=asked)]),
        {"rating": 1},
        content_type="application/json",
    )
    SellerReview.objects.update(visibility=SellerReview.Visibility.HIDDEN)

    shop_page = client.get(reverse("seller-detail", args=[ama.pk])).json()

    assert shop_page["seller"]["rating"] is None and shop_page["reviews"] == []
