"""Marketplace filters (sold by trainers or makers, price, paying online,
delivery, verified, on sale, one shop) and the trainers-who-sell list."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from marketplace.models import Product, SellerAccount
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture(autouse=True)
def paystack_on(settings):
    settings.PAYSTACK_SECRET_KEY = "sk_test_secret"
    settings.MARKETPLACE_HOLD_PAYMENTS = False


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


@pytest.fixture
def workshop(area):
    return Provider.objects.create(
        name="Adenta Tailoring Institute",
        slug="adenta-tailoring",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )


def shop(django_user_model, area, name, phone, **extra):
    return SellerAccount.objects.create(
        user=django_user_model.objects.create_user(name.lower().replace(" ", "-")),
        phone=phone,
        phone_verified_at=timezone.now(),
        business_name=name,
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
        **extra,
    )


def product(seller, name, price="100.00", **extra):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price=price,
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=3),
        **extra,
    )


@pytest.fixture
def shops(django_user_model, area, workshop):
    trainer = shop(
        django_user_model,
        area,
        "Adenta Tailoring",
        "+233201110801",
        provider=workshop,
        paystack_subaccount="ACCT_t",
        delivery_fee="15.00",
        verified_at=timezone.now(),
    )
    maker = shop(django_user_model, area, "Kofi Beads", "+233201110802")
    return trainer, maker


def names(client, **params):
    response = client.get(reverse("product-list"), params)
    assert response.status_code == 200
    return sorted(row["name"] for row in response.json()["results"])


@pytest.mark.django_db
def test_sold_by_trainers_or_makers(client, shops):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(maker, "Bead bracelet")
    assert names(client, sold_by="trainers") == ["Kente shirt"]
    assert names(client, sold_by="makers") == ["Bead bracelet"]
    assert names(client) == ["Bead bracelet", "Kente shirt"]


@pytest.mark.django_db
def test_one_workshop_or_one_shop(client, shops, workshop):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(maker, "Bead bracelet")
    assert names(client, workshop=workshop.pk) == ["Kente shirt"]
    assert names(client, seller=maker.pk) == ["Bead bracelet"]
    assert names(client, workshop="nonsense") == ["Bead bracelet", "Kente shirt"]


@pytest.mark.django_db
def test_price_range_is_inclusive_and_drops_ask_for_price(client, shops):
    trainer, _ = shops
    product(trainer, "Cheap", price="20.00")
    product(trainer, "Middle", price="100.00")
    product(trainer, "Dear", price="500.00")
    product(trainer, "Ask me", price=None)
    assert names(client, min_price="100") == ["Dear", "Middle"]
    assert names(client, max_price="100") == ["Cheap", "Middle"]
    # Swapped bounds are read the right way round; junk is ignored.
    assert names(client, min_price="500", max_price="20") == ["Cheap", "Dear", "Middle"]
    assert len(names(client, min_price="abc")) == 4


@pytest.mark.django_db
def test_seller_flags(client, shops):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(maker, "Bead bracelet")
    assert names(client, delivers="1") == ["Kente shirt"]
    assert names(client, verified="true") == ["Kente shirt"]


@pytest.mark.django_db
def test_on_sale_means_a_real_reduction(client, shops):
    trainer, _ = shops
    product(trainer, "Reduced", price="80.00", was_price="100.00")
    product(trainer, "Not really", price="100.00", was_price="90.00")
    product(trainer, "Full price")
    assert names(client, on_sale="1") == ["Reduced"]


@pytest.mark.django_db
def test_pay_online_matches_the_buy_now_rule(client, shops, settings):
    trainer, maker = shops
    product(trainer, "Ready", availability=Product.Availability.AVAILABLE)
    product(trainer, "Made to order, no deposit", availability=Product.Availability.MADE_TO_ORDER)
    product(trainer, "No price", price=None)
    product(maker, "Cannot be paid")
    assert names(client, pay_online="1") == ["Ready"]
    rows = client.get(reverse("product-list"), {"pay_online": "1"}).json()["results"]
    assert all(row["buy_online"] for row in rows)

    trainer.deposit_percent = 30
    trainer.save()
    assert names(client, pay_online="1") == ["Made to order, no deposit", "Ready"]

    trainer.away_until = timezone.localdate() + timedelta(days=2)
    trainer.save()
    assert names(client, pay_online="1") == []

    settings.PAYSTACK_SECRET_KEY = ""
    assert names(client, pay_online="1") == []


@pytest.mark.django_db
def test_trainers_who_sell(client, shops, workshop):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(trainer, "Smock")
    product(maker, "Bead bracelet")
    hidden = product(trainer, "Draft")
    hidden.status = Product.Status.DRAFT
    hidden.save()

    response = client.get(reverse("sellers-trainers"))
    assert response.status_code == 200
    rows = response.json()["results"]
    assert [row["business_name"] for row in rows] == ["Adenta Tailoring"]
    assert rows[0]["product_count"] == 2
    assert rows[0]["workshop"]["slug"] == workshop.slug


@pytest.mark.django_db
def test_a_workshop_shop_with_nothing_on_show_is_not_listed(client, shops):
    trainer, _ = shops
    draft = product(trainer, "Draft")
    draft.status = Product.Status.DRAFT
    draft.save()
    assert client.get(reverse("sellers-trainers")).json()["results"] == []
