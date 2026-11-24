"""load_ghana_places: all of Ghana, added without touching what is there."""

from io import StringIO

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command

from geography.bounds import inside_ghana
from geography.management.commands.load_ghana_places import PLACES, slug_of
from geography.models import Area, Region


def run(*args):
    out = StringIO()
    call_command("load_ghana_places", *args, stdout=out)
    return out.getvalue()


def test_every_town_is_in_ghana_with_its_own_slug():
    assert len(PLACES) == 16
    slugs = [slug_of(town) for towns in PLACES.values() for town, _lat, _lng in towns]
    assert len(slugs) == len(set(slugs))
    assert not set(slugs) & {slug_of(region) for region in PLACES}
    for towns in PLACES.values():
        for town, latitude, longitude in towns:
            assert inside_ghana(latitude, longitude), town


@pytest.mark.django_db
def test_without_apply_nothing_is_saved():
    output = run()

    assert "Would add 16 regions" in output
    assert not Region.objects.exists()
    assert not Area.objects.exists()


@pytest.mark.django_db
def test_apply_adds_every_region_live_and_keeps_existing_places():
    accra = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    # An existing area under its own spelling and slug is left exactly as it is.
    tema = Area.objects.create(
        region=accra, name="Tema", slug="tema-community-1", centroid=Point(0.01, 5.67, srid=4326)
    )
    ashanti = Region.objects.create(name="Ashanti", slug="ashanti", is_launched=False)

    run("--apply")

    assert Region.objects.count() == 16
    assert not Region.objects.filter(is_launched=False).exists()
    ashanti.refresh_from_db()
    assert ashanti.is_launched
    tema.refresh_from_db()
    assert tema.slug == "tema-community-1"
    assert accra.areas.filter(name="Tema").count() == 1
    kumasi = Area.objects.get(slug="kumasi")
    assert kumasi.region == ashanti
    assert kumasi.centroid is not None

    # Running it again adds nothing.
    count = Area.objects.count()
    assert "Added 0 regions and 0 areas" in run("--apply")
    assert Area.objects.count() == count


@pytest.mark.django_db
def test_keep_launch_leaves_the_switch_alone():
    Region.objects.create(name="Ashanti", slug="ashanti", is_launched=False)

    run("--apply", "--keep-launch")

    assert not Region.objects.get(slug="ashanti").is_launched
    assert Area.objects.filter(slug="kumasi").exists()
