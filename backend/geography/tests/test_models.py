import pytest
from django.contrib.gis.geos import Point
from django.core.exceptions import ValidationError

from geography.models import Area, Region


@pytest.mark.django_db
def test_region_slug_cannot_reuse_an_existing_area_slug():
    owner = Region.objects.create(name="Greater Accra", slug="greater-accra")
    Area.objects.create(region=owner, name="Tema", slug="tema")

    region = Region(name="Tema Region", slug="tema")

    with pytest.raises(ValidationError) as error:
        region.full_clean()

    assert error.value.message_dict["slug"] == [
        "This slug is already used by an area, and both share the URL namespace."
    ]


@pytest.mark.django_db
def test_area_slug_cannot_reuse_an_existing_region_slug():
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area(region=region, name="Greater Accra Central", slug="greater-accra")

    with pytest.raises(ValidationError) as error:
        area.full_clean()

    assert error.value.message_dict["slug"] == [
        "This slug is already used by a region, and both share the URL namespace."
    ]


@pytest.mark.django_db
def test_existing_region_and_area_can_keep_their_own_slugs():
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Tema", slug="tema")

    region.full_clean()
    area.full_clean()


@pytest.mark.django_db
def test_area_rejects_an_empty_fallback_point():
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area(
        region=region,
        name="Empty Point",
        slug="empty-point",
        centroid=Point(srid=4326),
    )

    with pytest.raises(ValidationError) as error:
        area.full_clean()

    assert error.value.message_dict["centroid"] == [
        "Set a real point or leave the fallback search origin blank."
    ]
