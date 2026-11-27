"""Shops and paid promotion: the Shops view, sponsored spots on the home page
and in the marketplace list, what may be boosted, and what a boost brought."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from marketplace.models import (
    PaymentStatus,
    Product,
    ProductPhoto,
    ProductViewDay,
    SellerAccount,
    SellerPayment,
)
from marketplace.promotion import SLOT_EVERY, boost_problem, boost_views


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(
        region=region, name="Tema", slug="tema", centroid=Point(0.0166, 5.6698, srid=4326)
    )


def shop(django_user_model, area, name, phone):
    return SellerAccount.objects.create(
        user=django_user_model.objects.create_user(name.lower().replace(" ", "-")),
        phone=phone,
        phone_verified_at=timezone.now(),
        business_name=name,
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )


def item(seller, name, photo=True, days_old=1, **fields):
    product = Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price="100.00",
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=days_old),
        **fields,
    )
    Product.objects.filter(pk=product.pk).update(
        created_at=timezone.now() - timedelta(days=days_old)
    )
    if photo:
        ProductPhoto.objects.create(
            product=product, image=f"products/{product.slug}.jpg", exif_stripped=True
        )
    return product


def boost(product, days=7):
    now = timezone.now()
    return SellerPayment.objects.create(
        reference=f"fm-{product.pk}",
        seller=product.seller,
        kind=SellerPayment.Kind.BOOST_WEEK,
        product=product,
        amount_pesewas=1500,
        status=PaymentStatus.PAID,
        paid_at=now,
        starts_at=now - timedelta(days=1),
        ends_at=now + timedelta(days=days),
    )


@pytest.mark.django_db
def test_the_shops_view_lists_every_shop_with_its_photos(client, area, django_user_model):
    ama = shop(django_user_model, area, "Ama Beads", "+233201110801")
    kofi = shop(django_user_model, area, "Kofi Tools", "+233201110802")
    for n in range(3):
        item(kofi, f"Spanner {n}")
    item(ama, "Bead necklace")
    shop(django_user_model, area, "Empty Shop", "+233201110803")

    rows = client.get(reverse("sellers")).json()["results"]

    assert [row["business_name"] for row in rows] == ["Kofi Tools", "Ama Beads"]
    assert (rows[0]["product_count"], len(rows[0]["photos"])) == (3, 3)
    assert rows[0]["is_trainer"] is False


@pytest.mark.django_db
def test_the_home_slideshow_takes_shops_with_three_items_and_a_photo_trainers_first(
    client, area, django_user_model
):
    from providers.models import Provider

    kofi = shop(django_user_model, area, "Kofi Tools", "+233201110802")
    for n in range(3):
        item(kofi, f"Spanner {n}")
    ama = shop(django_user_model, area, "Ama Beads", "+233201110801")
    for n in range(3):
        item(ama, f"Bead {n}")
    ama.provider = Provider.objects.create(
        name="Ama Beads Workshop",
        slug="ama-beads",
        area=area,
        location=area.centroid,
        status=Provider.Status.PUBLISHED,
    )
    ama.save()
    small = shop(django_user_model, area, "Two Things", "+233201110803")
    item(small, "Cup 0")
    item(small, "Cup 1")
    bare = shop(django_user_model, area, "No Pictures", "+233201110804")
    for n in range(3):
        item(bare, f"Plain {n}", photo=False)

    rows = client.get(reverse("sellers-hero")).json()["results"]

    assert [row["business_name"] for row in rows] == ["Ama Beads", "Kofi Tools"]
    assert rows[0]["is_trainer"] is True and rows[0]["photo"].endswith(".jpg")
    assert (rows[1]["is_trainer"], rows[1]["product_count"]) == (False, 3)
    assert len(client.get(reverse("sellers-hero"), {"limit": 1}).json()["results"]) == 1


@pytest.mark.django_db
def test_the_home_page_gets_at_most_two_sponsored_products(client, area, django_user_model):
    seller = shop(django_user_model, area, "Kofi Tools", "+233201110802")
    for n in range(3):
        boost(item(seller, f"Boosted {n}"))
    boost(item(seller, "No photo", photo=False))
    boost(item(seller, "Gone", availability=Product.Availability.SOLD_OUT))
    item(seller, "Ordinary")

    shown = client.get(reverse("products-sponsored")).json()["results"]

    assert len(shown) == 2
    assert {row["name"] for row in shown} <= {"Boosted 0", "Boosted 1", "Boosted 2"}


@pytest.mark.django_db
def test_the_list_gives_sponsored_items_at_most_one_spot_in_eight(client, area, django_user_model):
    seller = shop(django_user_model, area, "Kofi Tools", "+233201110802")
    boosted = {boost(item(seller, f"Boosted {n}", days_old=50 + n)).product.name for n in range(4)}
    for n in range(30):
        item(seller, f"Item {n:02d}", days_old=n + 1)

    first = client.get(reverse("product-list")).json()
    second = client.get(reverse("product-list"), {"page": 2}).json()
    names = [row["name"] for row in first["results"]]

    assert first["count"] == 34
    # Spots at 0, 8 and 16 on a page of 20: the boosted ones fill them.
    spots = [names[i] for i in range(0, 20, SLOT_EVERY)]
    assert set(spots) <= boosted and len(spots) == 3
    assert all(name not in boosted for i, name in enumerate(names) if i % SLOT_EVERY)
    # Nothing on page one comes round again on page two.
    assert not set(names) & {row["name"] for row in second["results"]}
    # A sort the buyer chose is kept as chosen.
    newest = client.get(reverse("product-list"), {"sort": "newest"}).json()["results"]
    assert newest[0]["name"] == "Item 00"


@pytest.mark.django_db
def test_only_a_product_with_a_photo_that_can_be_bought_is_boosted(area, django_user_model):
    seller = shop(django_user_model, area, "Kofi Tools", "+233201110802")

    assert "photo" in boost_problem(item(seller, "No photo", photo=False))
    assert "sold out" in boost_problem(
        item(seller, "Gone", availability=Product.Availability.SOLD_OUT)
    )
    assert boost_problem(item(seller, "Spanner")) is None


@pytest.mark.django_db
def test_a_seller_sees_the_views_a_boost_brought(area, django_user_model):
    seller = shop(django_user_model, area, "Kofi Tools", "+233201110802")
    spanner = item(seller, "Spanner")
    paid = boost(spanner)
    today = timezone.localdate()
    ProductViewDay.objects.create(product=spanner, day=today, views=12)
    ProductViewDay.objects.create(product=spanner, day=today - timedelta(days=1), views=5)
    # Before the boost: not counted.
    ProductViewDay.objects.create(product=spanner, day=today - timedelta(days=10), views=99)

    assert boost_views(paid) == 17
