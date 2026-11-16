"""The home page's trust strip counts only what a visitor could find."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from catalog.models import Programme, Trade
from geography.models import Area, Region
from providers.models import Provider, ProviderVideo, Verification

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


def workshop(area, slug, status=Provider.Status.PUBLISHED):
    provider = Provider.objects.create(
        name=slug,
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233240000601",
        status=status,
    )
    # A course to join: a workshop with none is not counted (catalog/listed.py).
    trade, _ = Trade.objects.get_or_create(slug="welding", defaults={"name": "Welding"})
    Programme.objects.create(
        provider=provider, trade=trade, title="Basics", fee=500, duration_weeks=8
    )
    return provider


def visit(provider, officer, outcome, expires_on=None):
    return Verification.objects.create(
        provider=provider,
        officer=officer,
        visited_on=timezone.localdate(),
        checks_performed="Premises and tools.",
        outcome=outcome,
        expires_on=expires_on,
    )


@pytest.mark.django_db
def test_only_what_a_visitor_could_find_is_counted(client, area, django_user_model):
    officer = django_user_model.objects.create_user("officer", is_staff=True)
    yesterday = timezone.localdate() - timedelta(days=1)

    live = workshop(area, "live")
    visit(live, officer, Verification.Outcome.PASSED)
    visit(live, officer, Verification.Outcome.PASSED_WITH_NOTES)  # still one workshop
    lapsed = workshop(area, "lapsed")
    visit(lapsed, officer, Verification.Outcome.PASSED, expires_on=yesterday)
    # A passed visit that has lapsed and a later failed one do not add up to
    # a current pass.
    visit(lapsed, officer, Verification.Outcome.FAILED)
    draft = workshop(area, "draft", status=Provider.Status.DRAFT)
    visit(draft, officer, Verification.Outcome.PASSED)

    ProviderVideo.objects.create(provider=live, title="Shown", status=ProviderVideo.Status.APPROVED)
    ProviderVideo.objects.create(
        provider=live, title="Waiting", status=ProviderVideo.Status.PENDING
    )
    ProviderVideo.objects.create(
        provider=draft, title="Hidden listing", status=ProviderVideo.Status.APPROVED
    )

    stats = client.get(reverse("site-stats")).json()

    assert stats == {"workshops": 2, "visited": 1, "lessons": 1, "products": 0}


@pytest.mark.django_db
def test_a_workshop_with_no_course_is_not_counted(client, area):
    Provider.objects.create(
        name="Empty",
        slug="empty",
        area=area,
        location=ACCRA,
        contact_phone="+233240000602",
        status=Provider.Status.PUBLISHED,
    )

    assert client.get(reverse("site-stats")).json()["workshops"] == 0
