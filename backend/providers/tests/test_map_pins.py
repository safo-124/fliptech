"""The home page's map of Ghana: every listed workshop as a pin."""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from geography.models import Area, Region
from marketplace.models import Product, SellerAccount
from providers.models import Provider

KUMASI = Point(-1.624, 6.688, srid=4326)
URL = "/api/providers/pins/"


@pytest.fixture
def place(db):
    region = Region.objects.create(name="Ashanti", slug="ashanti", is_launched=True)
    return Area.objects.create(region=region, name="Kumasi", slug="kumasi", centroid=KUMASI)


@pytest.fixture
def trade(db):
    return Trade.objects.create(name="Hairdressing", slug="hairdressing")


def workshop(name, area, trade, *, listed=True, status=Provider.Status.PUBLISHED):
    provider = Provider.objects.create(
        name=name,
        slug=name.lower().replace(" ", "-"),
        area=area,
        location=KUMASI,
        contact_phone="+233241234567",
        status=status,
    )
    if listed:
        course = Programme.objects.create(
            provider=provider, trade=trade, title="Hair course", fee=500, duration_weeks=8
        )
        Intake.objects.create(
            programme=course, start_date=date.today() + timedelta(days=20), places_offered=5
        )
    return provider


def shop_for(provider, django_user_model, *, status=Product.Status.PUBLISHED):
    seller = SellerAccount.objects.create(
        user=django_user_model.objects.create_user(f"seller-{provider.pk}"),
        phone=f"+2332011106{provider.pk:02d}",
        phone_verified_at=timezone.now(),
        business_name=provider.name,
        area=provider.area,
        provider=provider,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    Product.objects.create(seller=seller, name="Comb", slug=f"comb-{provider.pk}", status=status)
    return seller


@pytest.mark.django_db
def test_every_listed_workshop_is_a_pin_with_where_and_what(client, place, trade):
    for n in range(25):  # more than one page of search results
        workshop(f"Salon {n}", place, trade)

    response = client.get(URL)

    assert response.status_code == 200
    pins = response.json()
    assert len(pins) == 25
    pin = pins[0]
    assert pin["region"] == "Ashanti" and pin["region_slug"] == "ashanti"
    assert pin["area_slug"] == "kumasi"
    assert pin["trade"]["name"] == "Hairdressing"
    assert (pin["lat"], pin["lng"]) == (pytest.approx(6.688), pytest.approx(-1.624))
    assert pin["has_shop"] is False
    assert pin["joined"]


@pytest.mark.django_db
def test_drafts_and_workshops_with_nothing_to_join_are_left_off(client, place, trade):
    workshop("Draft Salon", place, trade, status=Provider.Status.DRAFT)
    workshop("Empty Salon", place, trade, listed=False)
    workshop("Real Salon", place, trade)

    assert [pin["name"] for pin in client.get(URL).json()] == ["Real Salon"]


@pytest.mark.django_db
def test_newest_first(client, place, trade):
    old = workshop("Old Salon", place, trade)
    Provider.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=30))
    workshop("New Salon", place, trade)

    assert [pin["name"] for pin in client.get(URL).json()] == ["New Salon", "Old Salon"]


@pytest.mark.django_db
def test_a_shop_counts_only_with_something_on_sale(client, place, trade, django_user_model):
    selling = workshop("Selling Salon", place, trade)
    shop_for(selling, django_user_model)
    drafting = workshop("Drafting Salon", place, trade)
    shop_for(drafting, django_user_model, status=Product.Status.DRAFT)

    pins = {pin["name"]: pin["has_shop"] for pin in client.get(URL).json()}

    assert pins == {"Selling Salon": True, "Drafting Salon": False}
