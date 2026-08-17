"""Tests for the two claims Section 05 makes about the database.

These are not model smoke tests. Each one asserts a product behaviour that the
technology choices in the documentation were justified by, so that if someone
later swaps the backend or drops an extension, the failure is loud.
"""

import pytest
from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.contrib.postgres.search import TrigramSimilarity

from catalog.models import Trade
from geography.models import Area, Region
from providers.models import GovernmentStatus, Provider, Verification

# Real coordinates, so the distances mean something.
ACCRA = Point(-0.1870, 5.6037, srid=4326)
MADINA = Point(-0.1660, 5.6830, srid=4326)
TEMA = Point(0.0166, 5.6698, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


def make_provider(area, name, slug, point):
    return Provider.objects.create(
        name=name,
        slug=slug,
        area=area,
        location=point,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )


@pytest.mark.django_db
def test_radius_search_orders_by_distance_and_excludes_the_far_workshop(area):
    """ "Which providers are within ten kilometres of a point", as one query."""
    make_provider(area, "Accra Welding Works", "accra-welding-works", ACCRA)
    make_provider(area, "Madina Welding Works", "madina-welding-works", MADINA)
    make_provider(area, "Tema Welding Works", "tema-welding-works", TEMA)

    results = (
        Provider.objects.annotate(distance=Distance("location", ACCRA))
        .filter(distance__lte=D(km=10))
        .order_by("distance")
    )

    assert [p.name for p in results] == ["Accra Welding Works", "Madina Welding Works"]
    # Ranked by distance, not by who paid most, which is what keeps it defensible.
    assert results[0].distance.m < results[1].distance.m


@pytest.mark.django_db
def test_trigram_finds_a_workshop_when_the_search_word_is_not_the_listed_word(area):
    """Someone types "welder". The workshop is called "Welding Works"."""
    make_provider(area, "Accra Welding Works", "accra-welding-works", ACCRA)
    make_provider(area, "Accra Tailoring Centre", "accra-tailoring-centre", ACCRA)

    results = (
        Provider.objects.annotate(similarity=TrigramSimilarity("name", "welder"))
        .filter(similarity__gt=0.15)
        .order_by("-similarity")
    )

    assert [p.name for p in results] == ["Accra Welding Works"]


@pytest.mark.django_db
def test_trade_synonyms_are_stored_as_a_searchable_array(db):
    trade = Trade.objects.create(name="Welding", slug="welding", synonyms=["welder", "fabrication"])
    trade.refresh_from_db()

    assert "welder" in trade.synonyms
    assert Trade.objects.filter(synonyms__contains=["fabrication"]).count() == 1


@pytest.mark.django_db
def test_a_provider_can_be_verified_with_no_government_record(area, django_user_model):
    """Structural rule 1: the two are independent and both states are expressible."""
    officer = django_user_model.objects.create_user("officer")
    provider = make_provider(area, "Accra Welding Works", "accra-welding-works", ACCRA)

    Verification.objects.create(
        provider=provider,
        visited_on="2026-08-01",
        officer=officer,
        checks_performed="Visited the workshop, saw the equipment, confirmed the fee schedule.",
        outcome=Verification.Outcome.PASSED,
    )

    assert provider.verifications.count() == 1
    assert not hasattr(provider, "government_status") or provider.government_status is None
    # And crucially, there is no single trusted flag to conflate them with.
    assert not hasattr(provider, "is_verified")


@pytest.mark.django_db
def test_a_provider_can_hold_a_government_record_with_no_site_visit(area):
    provider = make_provider(area, "Tema Welding Works", "tema-welding-works", TEMA)
    GovernmentStatus.objects.create(
        provider=provider,
        registration_status=GovernmentStatus.Status.REGISTERED,
        registration_number="CTVET/2026/0001",
    )

    assert provider.verifications.count() == 0
    assert provider.government_status.registration_status == "registered"


@pytest.mark.django_db
def test_government_status_can_say_not_claimed(area):
    """A field that can say no is what makes it mean anything when it says yes."""
    provider = make_provider(area, "Accra Welding Works", "accra-welding-works", ACCRA)
    status = GovernmentStatus.objects.create(provider=provider)

    assert status.registration_status == GovernmentStatus.Status.NOT_CLAIMED
    assert status.get_registration_status_display() == "Not claimed"
