import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse

from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)
TEMA = Point(0.0166, 5.6698, srid=4326)
KUMASI = Point(-1.6244, 6.6885, srid=4326)
TAMALE = Point(-0.8393, 9.4034, srid=4326)


def create_provider(*, name, slug, area, status):
    return Provider.objects.create(
        name=name,
        slug=slug,
        area=area,
        location=area.centroid,
        contact_phone="+233241234567",
        status=status,
    )


@pytest.fixture
def geography_world(db):
    greater_accra = Region.objects.create(
        name="Greater Accra",
        slug="greater-accra",
        is_launched=True,
    )
    northern = Region.objects.create(
        name="Northern",
        slug="northern",
        is_launched=True,
    )
    ashanti = Region.objects.create(
        name="Ashanti",
        slug="ashanti",
        is_launched=False,
    )

    accra = Area.objects.create(
        region=greater_accra,
        name="Accra",
        slug="accra",
        centroid=ACCRA,
    )
    tema = Area.objects.create(
        region=greater_accra,
        name="Tema",
        slug="tema",
        centroid=TEMA,
    )
    tamale = Area.objects.create(
        region=northern,
        name="Tamale",
        slug="tamale",
        centroid=TAMALE,
    )
    kumasi = Area.objects.create(
        region=ashanti,
        name="Kumasi",
        slug="kumasi",
        centroid=KUMASI,
    )

    create_provider(
        name="Accra Published One",
        slug="accra-published-one",
        area=accra,
        status=Provider.Status.PUBLISHED,
    )
    create_provider(
        name="Accra Published Two",
        slug="accra-published-two",
        area=accra,
        status=Provider.Status.PUBLISHED,
    )
    create_provider(
        name="Accra Draft",
        slug="accra-draft",
        area=accra,
        status=Provider.Status.DRAFT,
    )
    create_provider(
        name="Tema Suspended",
        slug="tema-suspended",
        area=tema,
        status=Provider.Status.SUSPENDED,
    )
    create_provider(
        name="Kumasi Published",
        slug="kumasi-published",
        area=kumasi,
        status=Provider.Status.PUBLISHED,
    )

    return {
        "greater_accra": greater_accra,
        "northern": northern,
        "ashanti": ashanti,
        "accra": accra,
        "tema": tema,
        "tamale": tamale,
        "kumasi": kumasi,
    }


@pytest.mark.django_db
def test_region_areas_match_the_area_api_published_provider_counts(client, geography_world):
    area_response = client.get(reverse("area-list"))
    region_response = client.get(reverse("region-list"))

    assert area_response.status_code == 200
    assert region_response.status_code == 200

    public_areas = {area["slug"]: area for area in area_response.json()["results"]}
    regions = {region["slug"]: region for region in region_response.json()["results"]}
    nested_areas = {area["slug"]: area for region in regions.values() for area in region["areas"]}

    assert public_areas["accra"]["provider_count"] == 2
    assert public_areas["tema"]["provider_count"] == 0
    assert public_areas["kumasi"]["provider_count"] == 1
    assert nested_areas["accra"] == public_areas["accra"]
    assert nested_areas["tema"] == public_areas["tema"]
    assert nested_areas["tamale"] == public_areas["tamale"]


@pytest.mark.django_db
def test_region_list_prefetches_nested_area_inventory_in_constant_queries(
    client,
    geography_world,
    django_assert_num_queries,
):
    # Pagination count + regions + one annotated area prefetch. Adding regions
    # and areas must not add serializer queries.
    with django_assert_num_queries(3):
        response = client.get(reverse("region-list"))

    assert response.status_code == 200
    assert len(response.json()["results"]) == 2


@pytest.mark.django_db
def test_public_region_api_exposes_only_launched_regions_but_keeps_area_discovery(
    client,
    geography_world,
):
    regions = client.get(reverse("region-list"))

    assert regions.status_code == 200
    assert [region["slug"] for region in regions.json()["results"]] == [
        "greater-accra",
        "northern",
    ]
    assert all(region["is_launched"] for region in regions.json()["results"])

    hidden_detail = client.get(reverse("region-detail", args=["ashanti"]))
    assert hidden_detail.status_code == 404

    # /api/areas/ powers the location picker and remains complete. The launch
    # gate applies specifically to public region landing pages.
    areas = client.get(reverse("area-list"))
    assert "kumasi" in {area["slug"] for area in areas.json()["results"]}
