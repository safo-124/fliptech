"""Back in stock, following a shop, deposits for made-to-order work, away
mode, copying, earnings, listing tips, search, featured shops and holding a
new seller's first payments."""

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

from accounts.models import CustomerAccount
from courses import paystack
from enquiries import otp
from geography.models import Area, Region
from marketplace import alerts, payments
from marketplace.models import (
    Order,
    PaymentStatus,
    Product,
    ProductPhoto,
    SellerAccount,
    SellerPayment,
    ShopFollow,
    StockAlert,
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

    for module in (otp, payments, alerts):
        monkeypatch.setattr(module, "send_sms", record)
    monkeypatch.setattr(otp, "_generate_code", lambda: "246802")
    return box


@pytest.fixture
def seller(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)
    return SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-ama"),
        phone="+233201110800",
        phone_verified_at=timezone.now(),
        business_name="Ama Tailoring",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
        paystack_subaccount="ACCT_ama",
        paystack_recipient="RCP_ama",
    )


def product(seller, name, price="100.00", **extra):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price=price,
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=30),
        **extra,
    )


def verify_phone(client, phone=BUYER):
    client.post(reverse("otp-request"), {"phone": phone}, content_type=JSON)
    client.post(
        reverse("otp-verify"),
        {"phone": phone, "code": "246802", "context": "marketplace"},
        content_type=JSON,
    )


def as_seller(client, seller):
    client.force_login(seller.user)
    return client


def pay(calls, amount):
    calls.answers["/transaction/verify"] = {
        "status": "success",
        "amount": amount,
        "currency": "GHS",
    }


def webhook(client, data):
    body = json.dumps({"event": "charge.success", "data": data}).encode()
    signature = hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()
    return client.post(
        reverse("paystack-webhook"), body, content_type=JSON, HTTP_X_PAYSTACK_SIGNATURE=signature
    )


# --------------------------------------------------------------------------
# Back in stock


@pytest.mark.django_db
def test_waiting_buyers_are_texted_once_when_it_is_back(
    client, seller, texts, django_capture_on_commit_callbacks
):
    gone = product(seller, "Kaftan", availability=Product.Availability.SOLD_OUT)
    url = reverse("product-stock-alert", args=[gone.pk])

    stranger = client.post(url, {"phone": BUYER}, content_type=JSON)
    verify_phone(client)
    asked = client.post(url, {"phone": BUYER}, content_type=JSON)
    seller_client = as_seller(client.__class__(), seller)
    with django_capture_on_commit_callbacks(execute=True):
        seller_client.patch(
            reverse("seller-product", args=[gone.pk]),
            {"availability": "available"},
            content_type=JSON,
        )
        seller_client.patch(
            reverse("seller-product", args=[gone.pk]), {"price": "120.00"}, content_type=JSON
        )

    assert stranger.status_code == 403
    assert asked.status_code == 201
    back = [message for to, message in texts if to == BUYER and "is back" in message]
    assert len(back) == 1 and f"/marketplace/{gone.pk}" in back[0]
    assert StockAlert.objects.get().notified_at is not None


@pytest.mark.django_db
def test_only_a_sold_out_product_can_be_waited_for(client, seller, texts):
    ready = product(seller, "Shirt")
    verify_phone(client)

    response = client.post(
        reverse("product-stock-alert", args=[ready.pk]), {"phone": BUYER}, content_type=JSON
    )

    assert response.status_code == 409


# --------------------------------------------------------------------------
# Following a shop


@pytest.mark.django_db
def test_followers_hear_about_new_products_once_a_day(client, seller, texts):
    verify_phone(client)  # Signs in to a customer account.
    url = reverse("shop-follow", args=[seller.pk])

    followed = client.post(url)
    old = product(seller, "Old shirt")
    old.published_at = timezone.now() - timedelta(days=5)
    old.save()
    ShopFollow.objects.update(created_at=timezone.now() - timedelta(days=2))
    new = product(seller, "New dress")
    new.published_at = timezone.now() - timedelta(hours=1)
    new.save()

    call_command("marketplace_daily", stdout=StringIO(), stderr=StringIO())
    call_command("marketplace_daily", stdout=StringIO(), stderr=StringIO())

    assert followed.json() == {"following": True, "followers": 1, "signed_in": True}
    told = [message for to, message in texts if "has something new" in message]
    assert len(told) == 1 and "Ama Tailoring" in told[0]


@pytest.mark.django_db
def test_following_needs_an_account(client, seller):
    response = client.post(reverse("shop-follow", args=[seller.pk]))

    assert response.status_code == 403
    assert not ShopFollow.objects.exists()


# --------------------------------------------------------------------------
# Deposits for made-to-order work


def deposit_order(client, seller, calls, texts):
    seller.deposit_percent = 40
    seller.save()
    dress = product(seller, "Wedding dress", price="1000.00", availability="made_to_order")
    verify_phone(client)
    response = client.post(
        reverse("product-order-create", args=[dress.pk]),
        {"phone": BUYER, "name": "Esi", "fulfilment": "pickup"},
        content_type=JSON,
    )
    assert response.status_code == 201, response.content
    return Order.objects.get(reference=response.json()["reference"])


@pytest.mark.django_db
def test_a_made_to_order_dress_is_bought_with_a_deposit(client, seller, calls, texts):
    order = deposit_order(client, seller, calls, texts)

    init = calls[-1][2]
    assert order.plan == Order.Plan.DEPOSIT
    assert init["amount"] == 40000  # 40% of GH₵1000.
    assert order.balance_pesewas == 60000
    # 5% of GH₵1000 is GH₵50: GH₵20 now, GH₵30 with the balance.
    assert init["transaction_charge"] == 2000
    assert order.commission_pesewas == 5000 and order.balance_commission_pesewas == 3000

    pay(calls, 40000)
    paid = client.post(reverse("order-detail", args=[order.reference])).json()
    assert paid["status"] == "paid" and paid["balance_status"] == "waiting"
    assert paid["amount"] == "1000.00" and paid["deposit"] == "400.00"


@pytest.mark.django_db
def test_deposit_texts_say_it_is_a_deposit(
    client, seller, calls, texts, django_capture_on_commit_callbacks
):
    order = deposit_order(client, seller, calls, texts)
    pay(calls, 40000)

    with django_capture_on_commit_callbacks(execute=True):
        client.post(reverse("order-detail", args=[order.reference]))

    to_seller = [m for to, m in texts if to == str(seller.phone)]
    to_buyer = [m for to, m in texts if to == BUYER and "deposit" in m]
    assert any("GH₵400.00 deposit paid, GH₵600.00 to come" in m for m in to_seller)
    assert any("GH₵400.00 deposit (GH₵600.00 due when it is ready)" in m for m in to_buyer)


@pytest.mark.django_db
def test_the_balance_is_asked_for_when_ready_and_then_it_can_be_handed_over(
    client, seller, calls, texts, django_capture_on_commit_callbacks
):
    order = deposit_order(client, seller, calls, texts)
    pay(calls, 40000)
    client.post(reverse("order-detail", args=[order.reference]))
    shop = as_seller(client.__class__(), seller)
    seller_url = reverse("seller-order", args=[order.reference])

    too_soon = shop.patch(seller_url, {"stage": "delivered"}, content_type=JSON)
    with django_capture_on_commit_callbacks(execute=True):
        ready = shop.patch(seller_url, {"stage": "ready"}, content_type=JSON)
    started = client.post(reverse("order-balance", args=[order.reference]))
    order.refresh_from_db()
    balance_init = calls[-1][2]
    with django_capture_on_commit_callbacks(execute=True):
        webhook(
            client,
            {
                "status": "success",
                "reference": order.balance_reference,
                "amount": 60000,
                "currency": "GHS",
            },
        )
        handed = shop.patch(seller_url, {"stage": "delivered"}, content_type=JSON)

    assert too_soon.status_code == 409
    assert ready.json()["balance_status"] == "due"
    assert any("Pay the balance of GH₵600.00" in message for _, message in texts)
    assert started.status_code == 201
    assert balance_init["amount"] == 60000
    assert balance_init["subaccount"] == "ACCT_ama" and balance_init["transaction_charge"] == 3000
    assert handed.json()["stage"] == "delivered"
    assert any("was handed over" in message for to, message in texts if to == BUYER)


@pytest.mark.django_db
def test_a_short_balance_payment_does_not_count(client, seller, calls, texts):
    order = deposit_order(client, seller, calls, texts)
    pay(calls, 40000)
    client.post(reverse("order-detail", args=[order.reference]))
    as_seller(client.__class__(), seller).patch(
        reverse("seller-order", args=[order.reference]), {"stage": "ready"}, content_type=JSON
    )
    client.post(reverse("order-balance", args=[order.reference]))
    order.refresh_from_db()

    webhook(
        client,
        {
            "status": "success",
            "reference": order.balance_reference,
            "amount": 100,
            "currency": "GHS",
        },
    )

    order.refresh_from_db()
    assert order.balance_status == Order.Balance.DUE


@pytest.mark.django_db
def test_without_deposits_made_to_order_is_ask_only(client, seller):
    product(seller, "Dress", availability="made_to_order")

    card = client.get(reverse("product-list")).json()["results"][0]

    assert card["buy_online"] is False


# --------------------------------------------------------------------------
# Away mode, copying, earnings, tips


@pytest.mark.django_db
def test_away_mode_turns_buy_now_off_until_the_date(client, seller, calls, texts):
    shirt = product(seller, "Shirt")
    seller.away_until = timezone.localdate() + timedelta(days=3)
    seller.away_note = "At a trade fair"
    seller.save()
    verify_phone(client)

    card = client.get(reverse("product-list")).json()["results"][0]
    order = client.post(
        reverse("product-order-create", args=[shirt.pk]),
        {"phone": BUYER, "name": "Esi", "fulfilment": "pickup"},
        content_type=JSON,
    )

    assert card["buy_online"] is False and card["seller"]["away_note"] == "At a trade fair"
    assert order.status_code == 409 and "away" in order.json()["detail"]

    seller.away_until = timezone.localdate() - timedelta(days=1)
    seller.save()
    assert client.get(reverse("product-list")).json()["results"][0]["buy_online"] is True


@pytest.mark.django_db
def test_a_product_is_copied_as_a_draft_with_its_photos(client, seller):
    shirt = product(seller, "Shirt", description="Cotton")
    ProductPhoto.objects.create(product=shirt, image="products/shirt.jpg", exif_stripped=True)

    response = as_seller(client, seller).post(reverse("seller-product-copy", args=[shirt.pk]))

    copy = Product.objects.exclude(pk=shirt.pk).get()
    assert response.status_code == 201
    assert copy.status == Product.Status.DRAFT and copy.name == "Shirt (copy)"
    assert copy.description == "Cotton"
    assert list(copy.photos.values_list("image", flat=True)) == ["products/shirt.jpg"]


@pytest.mark.django_db
def test_earnings_add_up_and_download(client, seller):
    Order.objects.create(
        reference="fo-earn1",
        seller=seller,
        product_name="Shirt",
        unit_price="100.00",
        amount_pesewas=10000,
        commission_pesewas=500,
        buyer_phone=BUYER,
        buyer_name="Esi",
        status=PaymentStatus.PAID,
        paid_at=timezone.now(),
    )
    as_seller(client, seller)

    month = client.get(reverse("seller-earnings")).json()
    csv = client.get(reverse("seller-earnings"), {"download": "csv"})

    assert month["totals"] == {
        "orders": 1,
        "sales": "100.00",
        "fliiptech": "5.00",
        "yours": "95.00",
    }
    assert csv["Content-Type"].startswith("text/csv")
    assert "fo-earn1" in csv.content.decode()


@pytest.mark.django_db
def test_listing_tips_say_what_is_missing(client, seller):
    bare = Product.objects.create(seller=seller, name="Bag", slug="bag")

    tips = as_seller(client, seller).get(reverse("seller-product", args=[bare.pk])).json()["tips"]

    assert tips == ["add_photo", "add_price", "describe", "trade"]


# --------------------------------------------------------------------------
# Search, featured shops, holding a new seller's payments


@pytest.mark.django_db
def test_search_finds_plurals_and_ranks_the_name_first(client, seller):
    named = product(seller, "Leather bag")
    described = product(seller, "Purse", description="Goes with any bag you own")
    product(seller, "Stool")

    found = client.get(reverse("product-list"), {"q": "bags"}).json()["results"]

    assert [card["id"] for card in found] == [named.pk, described.pk]


@pytest.mark.django_db
def test_featured_shops_are_shop_plan_shops_with_something_on_show(client, seller):
    product(seller, "Shirt")
    now = timezone.now()
    SellerPayment.objects.create(
        reference="fm-plan",
        seller=seller,
        kind=SellerPayment.Kind.PLAN_MONTH,
        amount_pesewas=3000,
        status=PaymentStatus.PAID,
        starts_at=now,
        ends_at=now + timedelta(days=30),
    )

    shops = client.get(reverse("sellers-featured")).json()["results"]

    assert [shop["business_name"] for shop in shops] == ["Ama Tailoring"]


@pytest.mark.django_db
def test_a_new_sellers_first_orders_are_held(client, seller, calls, texts, settings):
    settings.MARKETPLACE_HOLD_FIRST_ORDERS = 1
    shirt = product(seller, "Shirt")
    verify_phone(client)
    body = {"phone": BUYER, "name": "Esi", "fulfilment": "pickup"}

    first = client.post(reverse("product-order-create", args=[shirt.pk]), body, content_type=JSON)
    held_init = calls[-1][2]
    pay(calls, 10000)
    client.post(reverse("order-detail", args=[first.json()["reference"]]))
    client.post(reverse("product-order-create", args=[shirt.pk]), body, content_type=JSON)
    split_init = calls[-1][2]

    assert "subaccount" not in held_init
    assert Order.objects.get(reference=first.json()["reference"]).payout == Order.Payout.HELD
    assert split_init["subaccount"] == "ACCT_ama"


@pytest.mark.django_db
def test_a_buyers_account_was_made_by_proving_the_number(client, seller, texts):
    verify_phone(client)

    assert CustomerAccount.objects.filter(phone=BUYER).exists()


# --------------------------------------------------------------------------
# Refreshing cached pages


@pytest.mark.django_db
def test_a_change_asks_the_frontend_to_refresh_once_per_save(
    client, seller, settings, monkeypatch, django_capture_on_commit_callbacks
):
    from marketplace import page_refresh

    # Made before refreshing is switched on, so nothing is queued yet.
    shirt = product(seller, "Shirt")
    settings.FRONTEND_REVALIDATE_URL = "http://frontend.test/revalidate"
    settings.FRONTEND_REVALIDATE_SECRET = "s3cret"
    sent = []
    monkeypatch.setattr(
        page_refresh,
        "_send",
        lambda: sent.append(1),
    )

    class Now:
        """Runs the thread's work at once, in the test."""

        def __init__(self, target, daemon):
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(page_refresh.threading, "Thread", Now)

    with django_capture_on_commit_callbacks(execute=True):
        as_seller(client, seller).patch(
            reverse("seller-product", args=[shirt.pk]),
            {"price": "90.00", "availability": "made_to_order"},
            content_type=JSON,
        )
    after_edit = len(sent)
    with django_capture_on_commit_callbacks(execute=True):
        # A sign-in only touches fields no buyer sees.
        seller.save(update_fields=["phone_verified_at", "updated_at"])

    # Several rows changed in one save, one request.
    assert after_edit == 1
    assert len(sent) == 1


@pytest.mark.django_db
def test_a_rolled_back_change_does_not_stop_later_refreshes(seller, settings, monkeypatch):
    from django.db import transaction

    from marketplace import page_refresh

    settings.FRONTEND_REVALIDATE_URL = "http://frontend.test/revalidate"
    settings.FRONTEND_REVALIDATE_SECRET = "s3cret"
    queued = []
    real = transaction.on_commit
    monkeypatch.setattr(
        page_refresh.transaction,
        "on_commit",
        lambda fn: queued.append(fn) or real(fn),
    )

    try:
        with transaction.atomic():
            product(seller, "Shirt")
            raise RuntimeError("rolled back")
    except RuntimeError:
        pass
    product(seller, "Dress")

    assert len(queued) == 2


@pytest.mark.django_db
def test_no_refresh_is_asked_for_when_not_set_up(seller, settings, monkeypatch):
    from marketplace import page_refresh

    settings.FRONTEND_REVALIDATE_URL = ""
    called = []
    monkeypatch.setattr(page_refresh.transaction, "on_commit", lambda fn: called.append(fn))

    product(seller, "Shirt")

    assert called == []
