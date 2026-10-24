"""The departures board: the next courses anyone could actually join."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def board(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    madina = Area.objects.create(region=region, name="Madina", slug="madina", centroid=ACCRA)
    tema = Area.objects.create(region=region, name="Tema", slug="tema", centroid=ACCRA)
    welding = Trade.objects.create(name="Welding", slug="welding", colour="spark")
    hair = Trade.objects.create(name="Hairdressing", slug="hairdressing", colour="coral")
    today = timezone.localdate()

    def course(name, area, trade, status=Provider.Status.PUBLISHED):
        provider = Provider.objects.create(
            name=name,
            slug=name.lower().replace(" ", "-"),
            area=area,
            location=ACCRA,
            contact_phone="+233240000901",
            status=status,
        )
        return Programme.objects.create(
            provider=provider, trade=trade, title=f"{trade.name} basics", fee=500, duration_weeks=8
        )

    def intake(programme, days, **extra):
        return Intake.objects.create(
            programme=programme, start_date=today + timedelta(days=days), **extra
        )

    ama = course("Ama Braids", madina, hair)
    kofi = course("Kofi Welding", tema, welding)
    hidden = course("Draft Works", madina, welding, status=Provider.Status.DRAFT)
    intake(ama, 20)
    intake(kofi, 5, places_offered=10, places_remaining=3)
    intake(kofi, 2, places_offered=10, places_remaining=0)  # full
    intake(ama, 1, is_open=False)  # closed
    intake(ama, -3)  # already started
    intake(hidden, 3)  # not published
    return {"today": today}


def get(client, **params):
    response = client.get(reverse("upcoming-intakes"), params)
    assert response.status_code == 200
    return response.json()


@pytest.mark.django_db
def test_only_what_a_trainee_could_join_soonest_first(client, board):
    rows = get(client)

    assert [(row["provider"], row["places_remaining"]) for row in rows] == [
        ("Kofi Welding", 3),
        ("Ama Braids", None),
    ]
    assert rows[0] | {"start_date": None} == {
        "start_date": None,
        "places_remaining": 3,
        "course": "Welding basics",
        "trade": "Welding",
        "trade_colour": "spark",
        "provider": "Kofi Welding",
        "area": "Tema",
        "area_slug": "tema",
        "slug": "kofi-welding",
    }


@pytest.mark.django_db
def test_narrowed_like_a_search_and_limited(client, board):
    assert [row["provider"] for row in get(client, trade="hairdressing")] == ["Ama Braids"]
    assert [row["provider"] for row in get(client, area="tema")] == ["Kofi Welding"]
    assert len(get(client, region="greater-accra", limit=1)) == 1
    assert len(get(client, limit="lots")) == 2
