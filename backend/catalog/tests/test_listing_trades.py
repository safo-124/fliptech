"""The categories as the choice on the course and product forms
(catalog/listing.py, /api/trades/choices/)."""

import pytest
from django.urls import reverse

from catalog.listing import category_trade, listing_trades
from catalog.models import Trade, TradeCategory


@pytest.fixture
def categories(db):
    TradeCategory.objects.all().delete()
    return [
        TradeCategory.objects.create(
            name="Engineering & Technical Trades", slug="engineering", icon="cog", display_order=1
        ),
        TradeCategory.objects.create(
            name="Hospitality & Culinary Arts", slug="hospitality", icon="chef", display_order=5
        ),
        TradeCategory.objects.create(
            name="Retired", slug="retired", is_active=False, display_order=9
        ),
    ]


@pytest.mark.django_db
def test_each_active_category_gets_one_trade_of_its_own_name(categories):
    engineering, hospitality, _retired = categories
    welding = Trade.objects.create(name="Welding", slug="welding", category=engineering)

    trades = listing_trades()

    assert [trade.name for trade in trades] == [
        "Engineering & Technical Trades",
        "Hospitality & Culinary Arts",
    ]
    assert trades[0].category == engineering
    assert trades[1].colour == Trade.Colour.LEAF
    # Asking again makes nothing new, and the specific trades are untouched.
    listing_trades()
    assert Trade.objects.filter(category=engineering).count() == 2
    welding.refresh_from_db()
    assert welding.category == engineering


@pytest.mark.django_db
def test_a_switched_off_category_trade_is_switched_back_on(categories):
    trade = category_trade(categories[0])
    Trade.objects.filter(pk=trade.pk).update(is_active=False)

    assert category_trade(categories[0]).is_active


@pytest.mark.django_db
def test_the_choices_endpoint_lists_the_categories_in_order(client, categories):
    response = client.get(reverse("trade-choices"))

    assert response.status_code == 200
    body = response.json()
    assert [trade["name"] for trade in body] == [
        "Engineering & Technical Trades",
        "Hospitality & Culinary Arts",
    ]
    assert body[0]["category"]["name"] == "Engineering & Technical Trades"
    assert {"id", "slug"} <= set(body[0])
