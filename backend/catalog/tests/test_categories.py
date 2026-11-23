"""Trade categories: the groups people browse by, what is live in each, and
the category filter on training, the shop and search."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from catalog.models import Programme, Trade, TradeCategory
from geography.models import Area, Region
from marketplace.models import Product, SellerAccount
from marketplace.views import browse
from providers.models import Provider
from search.understand import understand

TEMA = Point(0.0166, 5.6698, srid=4326)


@pytest.fixture
def tema(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    return Area.objects.create(region=region, name="Tema", slug="tema", centroid=TEMA)


@pytest.fixture
def groups(db):
    # The migration's own categories are replaced by these, so each test
    # knows exactly what is there.
    TradeCategory.objects.all().delete()
    engineering = TradeCategory.objects.create(
        name="Engineering & Technical Trades",
        slug="engineering-technical",
        icon="cog",
        synonyms=["engineering", "technical"],
        display_order=0,
    )
    fashion = TradeCategory.objects.create(
        name="Fashion, Beauty & Leather Craft",
        slug="fashion-beauty-leather",
        icon="scissors",
        synonyms=["fashion", "beauty", "leather"],
        display_order=10,
    )
    digital = TradeCategory.objects.create(
        name="Digital & Creative Skills", slug="digital-creative", icon="laptop", display_order=20
    )
    welding = Trade.objects.create(
        name="Welding", slug="welding", synonyms=["welder"], category=engineering
    )
    tailoring = Trade.objects.create(
        name="Tailoring", slug="tailoring", synonyms=["sewing"], category=fashion
    )
    return {
        "engineering": engineering,
        "fashion": fashion,
        "digital": digital,
        "welding": welding,
        "tailoring": tailoring,
    }


def workshop(area, name, trade):
    provider = Provider.objects.create(
        name=name,
        slug=name.lower().replace(" ", "-"),
        area=area,
        location=TEMA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=30),
    )
    Programme.objects.create(
        provider=provider,
        trade=trade,
        title=f"{trade.name} course",
        fee=Decimal("900"),
        duration_weeks=8,
    )
    return provider


def shop_item(area, name, trade, number):
    seller = SellerAccount.objects.create(
        user=get_user_model().objects.create_user(f"seller-{number}"),
        phone=f"+23320111080{number}",
        phone_verified_at=timezone.now(),
        business_name=f"Shop {number}",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price="150.00",
        trade=trade,
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=1),
    )


@pytest.mark.django_db
def test_each_category_says_what_is_live_in_it(client, tema, groups):
    workshop(tema, "Tema Metal Shop", groups["welding"])

    rows = {row["slug"]: row for row in client.get(reverse("trade-category-list")).json()}

    engineering = rows["engineering-technical"]
    assert (engineering["live"], engineering["provider_count"]) == (True, 1)
    assert engineering["trades"] == [
        {"slug": "welding", "name": "Welding", "colour": "violet", "provider_count": 1}
    ]
    # A trade with nothing listed, and a category with no trade, are not live:
    # the site hides them.
    assert rows["fashion-beauty-leather"]["live"] is False
    assert rows["digital-creative"]["live"] is False
    assert rows["digital-creative"]["trades"] == []
    assert list(rows) == ["engineering-technical", "fashion-beauty-leather", "digital-creative"]


@pytest.mark.django_db
def test_a_shop_item_makes_its_category_live(client, tema, groups):
    shop_item(tema, "Sewing kit", groups["tailoring"], 1)

    fashion = client.get(reverse("trade-category-detail", args=["fashion-beauty-leather"])).json()

    assert (fashion["live"], fashion["product_count"], fashion["provider_count"]) == (True, 1, 0)


@pytest.mark.django_db
def test_a_switched_off_category_is_not_listed(client, groups):
    TradeCategory.objects.filter(slug="digital-creative").update(is_active=False)

    slugs = [row["slug"] for row in client.get(reverse("trade-category-list")).json()]

    assert "digital-creative" not in slugs


@pytest.mark.django_db
def test_trades_say_their_category(client, groups):
    Trade.objects.create(name="Pottery", slug="pottery")

    rows = {row["slug"]: row for row in client.get(reverse("trade-list")).json()["results"]}

    assert rows["welding"]["category"] == {
        "slug": "engineering-technical",
        "name": "Engineering & Technical Trades",
        "icon": "cog",
    }
    # Not placed yet: still listed as a trade, in no category.
    assert rows["pottery"]["category"] is None


@pytest.mark.django_db
def test_training_and_the_shop_filter_by_category(client, tema, groups):
    workshop(tema, "Tema Metal Shop", groups["welding"])
    workshop(tema, "Tema Sewing Room", groups["tailoring"])
    shop_item(tema, "Welding gloves", groups["welding"], 1)
    shop_item(tema, "Sewing kit", groups["tailoring"], 2)

    found = client.get("/api/providers/", {"category": "fashion-beauty-leather"}).json()
    assert [p["name"] for p in found["results"]] == ["Tema Sewing Room"]

    items = browse({"category": "engineering-technical"})
    assert [p.name for p in items] == ["Welding gloves"]


@pytest.mark.django_db
def test_a_search_for_a_category_word_finds_its_trades(client, tema, groups):
    workshop(tema, "Tema Metal Shop", groups["welding"])
    workshop(tema, "Ama Sewing Room", groups["tailoring"])

    understood = understand("beauty classes in tema")
    assert understood.trade is None
    assert understood.category == groups["fashion"]
    assert understood.area == tema
    assert understood.words == ""
    # A trade named wins over its category.
    assert understand("sewing beauty").trade == groups["tailoring"]

    found = client.get("/api/providers/", {"q": "beauty"}).json()
    assert [p["name"] for p in found["results"]] == ["Ama Sewing Room"]

    body = client.get(reverse("search"), {"q": "beauty"}).json()
    assert body["understood"]["category"]["slug"] == "fashion-beauty-leather"
    assert [t["slug"] for t in body["trades"]] == ["tailoring"]
    assert [w["name"] for w in body["workshops"]["results"]] == ["Ama Sewing Room"]
