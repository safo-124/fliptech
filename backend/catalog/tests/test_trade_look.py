"""Each trade's colour and painted picture, and the trade a result card shows."""

import importlib
from io import BytesIO

import pytest
from django.apps import apps
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from catalog.models import Programme, Trade
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    return Area.objects.create(region=region, name="Madina", slug="madina", centroid=ACCRA)


def workshop(area, name, *courses):
    provider = Provider.objects.create(
        name=name,
        slug=name.lower().replace(" ", "-"),
        area=area,
        location=ACCRA,
        contact_phone="+233240000701",
        status=Provider.Status.PUBLISHED,
    )
    for trade, fee in courses:
        Programme.objects.create(
            provider=provider, trade=trade, title=f"{trade.name} course", fee=fee, duration_weeks=12
        )
    return provider


@pytest.mark.django_db
def test_existing_trades_are_given_the_colour_of_their_material():
    migration = importlib.import_module("catalog.migrations.0004_trade_colour_and_picture")
    names = {
        "Hairdressing": ["salon"],
        "Fashion design": [],
        "Arc welding": [],
        "Auto mechanics": ["fitter"],
        "Solar installation": [],
        "Furniture making": [],
        "Plumbing": ["pipe fitting"],
        "Catering": [],
        "Photography": [],
    }
    for index, (name, synonyms) in enumerate(names.items()):
        Trade.objects.create(name=name, slug=f"trade-{index}", synonyms=synonyms)

    migration.colour_existing_trades(apps, None)

    assert dict(Trade.objects.values_list("name", "colour")) == {
        "Hairdressing": "coral",
        "Fashion design": "dye",
        "Arc welding": "spark",
        "Auto mechanics": "steel",
        "Solar installation": "signal",
        "Furniture making": "timber",
        "Plumbing": "clay",
        "Catering": "leaf",
        "Photography": "violet",
    }


@pytest.mark.django_db
def test_a_card_is_labelled_with_its_cheapest_course_unless_a_trade_is_searched(client, area):
    welding = Trade.objects.create(name="Welding", slug="welding", colour="spark")
    plumbing = Trade.objects.create(name="Plumbing", slug="plumbing", colour="clay")
    workshop(area, "Two Trades Works", (welding, 900), (plumbing, 500))

    [card] = client.get(reverse("provider-list")).json()["results"]
    assert card["trade"] == {"name": "Plumbing", "slug": "plumbing", "colour": "clay"}

    [card] = client.get(reverse("provider-list"), {"trade": "welding"}).json()["results"]
    assert card["trade"] == {"name": "Welding", "slug": "welding", "colour": "spark"}


@pytest.mark.django_db
def test_the_trade_api_carries_its_colour_and_picture(client):
    Trade.objects.create(name="Tailoring", slug="tailoring", colour="dye")

    trade = client.get(reverse("trade-detail", args=["tailoring"])).json()

    assert trade["colour"] == "dye"
    assert trade["picture"] is None


def painting(mode="RGB"):
    buffer = BytesIO()
    image = Image.new(mode, (1600, 1600), (200, 90, 40, 0) if mode == "RGBA" else "orange")
    image.save(buffer, format="PNG")
    return SimpleUploadedFile("signboard.png", buffer.getvalue(), content_type="image/png")


@pytest.mark.django_db
@pytest.mark.parametrize(("mode", "extension"), [("RGB", ".jpg"), ("RGBA", ".png")])
def test_a_painted_picture_is_resized_and_keeps_a_transparent_background(
    settings, tmp_path, mode, extension
):
    settings.MEDIA_ROOT = tmp_path
    trade = Trade.objects.create(name="Welding", slug="welding", picture=painting(mode))

    assert trade.picture.name.endswith(extension)
    with Image.open(trade.picture.path) as stored:
        assert max(stored.size) == 1024
