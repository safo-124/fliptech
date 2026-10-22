"""The "places for a group" filter, for Section 03's NGO programme officer.

They are placing a cohort and give up without a way to filter by capacity. The
filter has to read the most specific number a listing has, and must not let a
large class in one trade qualify a workshop for another.
"""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point

from catalog.models import Intake, Programme, Trade
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


@pytest.fixture
def trades(db):
    return {
        "welding": Trade.objects.create(name="Welding", slug="welding", synonyms=["welder"]),
        "tailoring": Trade.objects.create(name="Tailoring", slug="tailoring"),
    }


def provider(area, slug):
    return Provider.objects.create(
        name=slug.replace("-", " ").title(),
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )


def programme(owner, trade, *, capacity=None, is_active=True):
    return Programme.objects.create(
        provider=owner,
        trade=trade,
        title=f"{trade.name} course",
        fee=1000,
        duration_weeks=12,
        capacity=capacity,
        is_active=is_active,
    )


def intake(course, *, remaining=None, offered=None, days_ahead=30, is_open=True):
    return Intake.objects.create(
        programme=course,
        start_date=date.today() + timedelta(days=days_ahead),
        places_offered=offered,
        places_remaining=remaining,
        is_open=is_open,
    )


def slugs(client, **params):
    response = client.get("/api/providers/", params)
    assert response.status_code == 200
    return {row["slug"] for row in response.json()["results"]}


@pytest.mark.django_db
def test_places_remaining_on_an_upcoming_intake_decides(client, area, trades):
    roomy = provider(area, "roomy")
    intake(programme(roomy, trades["welding"], capacity=4), remaining=12, offered=20)
    nearly_full = provider(area, "nearly-full")
    intake(programme(nearly_full, trades["welding"], capacity=30), remaining=3, offered=30)

    # Remaining beats both offered and capacity: a class of 30 with 3 seats
    # left cannot take 10 people.
    assert slugs(client, places=10) == {"roomy"}


@pytest.mark.django_db
def test_offered_then_capacity_are_used_when_remaining_is_unknown(client, area, trades):
    by_offered = provider(area, "by-offered")
    intake(programme(by_offered, trades["welding"], capacity=2), offered=15)
    by_capacity = provider(area, "by-capacity")
    intake(programme(by_capacity, trades["welding"], capacity=15))
    too_small = provider(area, "too-small")
    intake(programme(too_small, trades["welding"], capacity=5))

    assert slugs(client, places=10) == {"by-offered", "by-capacity"}


@pytest.mark.django_db
def test_a_course_with_no_date_set_counts_by_class_size(client, area, trades):
    programme(provider(area, "no-date-yet"), trades["welding"], capacity=20)
    programme(provider(area, "no-size-given"), trades["welding"])

    assert slugs(client, places=10) == {"no-date-yet"}


@pytest.mark.django_db
def test_past_closed_and_inactive_courses_do_not_count(client, area, trades):
    intake(programme(provider(area, "past"), trades["welding"]), remaining=20, days_ahead=-5)
    intake(programme(provider(area, "closed"), trades["welding"]), remaining=20, is_open=False)
    intake(
        programme(provider(area, "inactive"), trades["welding"], is_active=False),
        remaining=20,
    )
    # A past intake with room does not make the programme "undated" either:
    # the class capacity still applies to it, and here there is none.
    assert slugs(client, places=10) == set()


@pytest.mark.django_db
def test_with_a_trade_the_seats_must_be_in_that_trade(client, area, trades):
    mixed = provider(area, "mixed")
    intake(programme(mixed, trades["welding"]), remaining=2)
    intake(programme(mixed, trades["tailoring"]), remaining=25)
    welders = provider(area, "welders")
    intake(programme(welders, trades["welding"]), remaining=25)

    assert slugs(client, places=10) == {"mixed", "welders"}
    assert slugs(client, places=10, trade="welding") == {"welders"}
    # The trade is matched the way the trade filter matches it, synonyms too.
    assert slugs(client, places=10, trade="welder") == {"welders"}


@pytest.mark.django_db
def test_no_group_size_means_no_filter(client, area, trades):
    programme(provider(area, "any"), trades["welding"])

    assert slugs(client) == {"any"}
    assert slugs(client, places=0) == {"any"}


@pytest.mark.django_db
def test_a_non_number_is_rejected(client, area):
    assert client.get("/api/providers/", {"places": "lots"}).status_code == 400
