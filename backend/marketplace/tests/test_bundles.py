"""Learn and buy: a workshop's course and kit, one payment, course unlocked."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from accounts.models import CustomerAccount
from courses import paystack
from courses.models import CourseOffer, CoursePurchase
from geography.models import Area, Region
from marketplace import payments
from marketplace.models import Order, Product, SellerAccount
from providers.models import Provider

JSON = "application/json"
BUYER = "+233201112222"


@pytest.fixture(autouse=True)
def paystack_on(settings, monkeypatch):
    settings.PAYSTACK_SECRET_KEY = "sk_test_secret"
    settings.MARKETPLACE_HOLD_PAYMENTS = False
    settings.MARKETPLACE_COMMISSION_PERCENT = 5
    settings.PUBLIC_SITE_URL = "https://skills.example"
    calls = []

    def fake(method, path, payload=None, *, query=None):
        calls.append((method, path, payload))
        if path == "/transaction/initialize":
            return {"authorization_url": "https://checkout.paystack.test/x"}
        return {}

    monkeypatch.setattr(paystack, "_call", fake)
    monkeypatch.setattr(payments, "send_sms", lambda *a, **k: None)
    return calls


@pytest.fixture
def workshop_shop(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(
        region=region, name="Tema", slug="tema", centroid=Point(0.0, 5.67, srid=4326)
    )
    provider = Provider.objects.create(
        name="Tema Tailoring",
        slug="tema-tailoring",
        area=area,
        location=Point(0.0, 5.67, srid=4326),
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )
    CourseOffer.objects.create(provider=provider, price="100.00", paystack_subaccount="ACCT_c")
    seller = SellerAccount.objects.create(
        user=django_user_model.objects.create_user("tema-shop"),
        phone="+233201110800",
        phone_verified_at=timezone.now(),
        business_name="Tema Tailoring",
        area=area,
        provider=provider,
        paystack_subaccount="ACCT_s",
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    kit = [
        Product.objects.create(
            seller=seller,
            name=name,
            slug=name.lower().replace(" ", "-"),
            price=price,
            status=Product.Status.PUBLISHED,
            published_at=timezone.now() - timedelta(days=1),
        )
        for name, price in (("Scissors", "60.00"), ("Tape measure", "20.00"))
    ]
    return seller, provider, kit


def as_seller(seller):
    client = Client()
    client.force_login(seller.user)
    return client


@pytest.mark.django_db
def test_a_workshop_sells_its_course_and_kit_together(workshop_shop, django_user_model):
    seller, provider, (scissors, tape) = workshop_shop
    made = as_seller(seller).post(
        reverse("seller-bundles"),
        {
            "title": "Start tailoring",
            "percent_off": 20,
            "includes_course": True,
            "items": [{"product": scissors.pk, "quantity": 1}, {"product": tape.pk, "quantity": 2}],
        },
        content_type=JSON,
    )
    assert made.status_code == 201, made.json()
    bundle = made.json()
    # 60 + 2 x 20 + course 100 = 200, less 20%.
    assert bundle["full_price"] == "200.00"
    assert bundle["price"] == "160.00"
    assert bundle["saving"] == "40.00"
    assert bundle["course"]["path"] == "/learn/tema/tema-tailoring"
    assert bundle["buy_online"] is True

    listed = Client().get(reverse("course-bundles", args=["tema", "tema-tailoring"])).json()
    assert [b["title"] for b in listed["results"]] == ["Start tailoring"]

    buyer = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("buyer-kofi"),
        phone=BUYER,
        phone_verified_at=timezone.now(),
    )
    client = Client()
    client.force_login(buyer.user)
    paid = client.post(
        reverse("bundle-order", args=[bundle["id"]]),
        {"phone": BUYER, "name": "Kofi", "fulfilment": "pickup"},
        content_type=JSON,
    )
    assert paid.status_code == 201, paid.json()
    order = Order.objects.get(reference=paid.json()["reference"])
    assert order.amount_pesewas == 16000
    assert order.discount_code == "Bundle"
    assert order.items.count() == 2
    # The course's share of the money, after its share of the discount.
    assert order.course_pesewas == 8000

    payments.confirm_order(
        order.reference, {"status": "success", "amount": 16000, "currency": "GHS"}
    )
    purchase = CoursePurchase.objects.get(provider=provider)
    assert purchase.status == "paid"
    assert str(purchase.trainee.phone) == BUYER
    # Confirming twice does not unlock it twice.
    payments.confirm_order(
        order.reference, {"status": "success", "amount": 16000, "currency": "GHS"}
    )
    assert CoursePurchase.objects.filter(provider=provider).count() == 1


@pytest.mark.django_db
def test_bundles_hold_only_the_shops_own_products(workshop_shop, django_user_model):
    seller, _, (scissors, _) = workshop_shop
    other = SellerAccount.objects.create(
        user=django_user_model.objects.create_user("other-shop"),
        phone="+233201110801",
        phone_verified_at=timezone.now(),
        business_name="Other",
        area=seller.area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    theirs = Product.objects.create(
        seller=other, name="Needle", slug="needle", price="5.00", status=Product.Status.PUBLISHED
    )
    refused = as_seller(seller).post(
        reverse("seller-bundles"),
        {"title": "Mixed", "items": [{"product": scissors.pk}, {"product": theirs.pk}]},
        content_type=JSON,
    )
    assert refused.status_code == 400
    # A shop with no workshop has no bundles.
    assert (
        as_seller(other)
        .post(
            reverse("seller-bundles"),
            {"title": "X", "items": [{"product": theirs.pk}]},
            content_type=JSON,
        )
        .status_code
        == 409
    )


@pytest.mark.django_db
def test_a_bundle_with_a_sold_out_product_cannot_be_bought(workshop_shop):
    seller, _, (scissors, _) = workshop_shop
    bundle = (
        as_seller(seller)
        .post(
            reverse("seller-bundles"),
            {"title": "Kit", "items": [{"product": scissors.pk}]},
            content_type=JSON,
        )
        .json()
    )
    scissors.availability = Product.Availability.SOLD_OUT
    scissors.save()
    shown = Client().get(reverse("bundle-detail", args=[bundle["id"]])).json()
    assert shown["buy_online"] is False
    assert "Scissors" in shown["problem"]
