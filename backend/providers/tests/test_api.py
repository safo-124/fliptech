"""API tests for search, the profile, the SEO page data and the dashboard."""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from billing.models import Subscription
from catalog.models import Intake, Programme, Trade
from geography.models import Area, Region
from providers.dashboard import make_dashboard_token
from providers.models import GovernmentStatus, Provider, Verification
from providers.views import ProviderViewSet

ACCRA = Point(-0.1870, 5.6037, srid=4326)
MADINA = Point(-0.1660, 5.6830, srid=4326)
TEMA = Point(0.0166, 5.6698, srid=4326)


@pytest.fixture
def world(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    accra = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    tema = Area.objects.create(region=region, name="Tema", slug="tema", centroid=TEMA)
    welding = Trade.objects.create(name="Welding", slug="welding", synonyms=["welder"])
    tailoring = Trade.objects.create(name="Tailoring", slug="tailoring", synonyms=["sewing"])

    def provider(name, slug, area, point, trade, fee, weeks, days_ahead=30):
        p = Provider.objects.create(
            name=name,
            slug=slug,
            area=area,
            location=point,
            contact_phone="+233241234567",
            status=Provider.Status.PUBLISHED,
        )
        prog = Programme.objects.create(
            provider=p, trade=trade, title=f"{trade.name} course", fee=fee, duration_weeks=weeks
        )
        Intake.objects.create(
            programme=prog, start_date=date.today() + timedelta(days=days_ahead), places_offered=10
        )
        return p

    near = provider("Accra Welding Works", "accra-welding-works", accra, ACCRA, welding, 1200, 12)
    mid = provider("Madina Welding Works", "madina-welding-works", accra, MADINA, welding, 900, 16)
    far = provider("Tema Welding Works", "tema-welding-works", tema, TEMA, welding, 1500, 10)
    sew = provider("Accra Tailoring Centre", "accra-tailoring", accra, ACCRA, tailoring, 700, 8)

    return {"near": near, "mid": mid, "far": far, "sew": sew, "accra": accra}


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_search_card_carries_fee_duration_and_next_intake(client, world):
    """The single most important layout decision in the product."""
    response = client.get("/api/providers/")

    assert response.status_code == 200
    card = next(r for r in response.json()["results"] if r["slug"] == "accra-welding-works")
    assert card["lowest_fee"] == "1200.00"
    assert card["shortest_duration_weeks"] == 12
    assert card["next_intake"] is not None


@pytest.mark.django_db
def test_radius_search_orders_by_distance_and_drops_the_far_workshop(client, world):
    response = client.get("/api/providers/", {"lat": 5.6037, "lng": -0.1870, "radius_km": 10})

    slugs = [r["slug"] for r in response.json()["results"]]
    assert "tema-welding-works" not in slugs
    assert slugs.index("accra-welding-works") < slugs.index("madina-welding-works")
    assert response.json()["results"][0]["distance_m"] == 0


@pytest.mark.django_db
def test_lat_without_lng_is_rejected(client, world):
    assert client.get("/api/providers/", {"lat": 5.6}).status_code == 400


@pytest.mark.django_db
def test_bbox_filter_powers_the_map_view(client, world):
    # A rectangle around Accra and Madina but excluding Tema.
    response = client.get("/api/providers/", {"bbox": "-0.30,5.50,-0.10,5.75"})

    slugs = {r["slug"] for r in response.json()["results"]}
    assert "tema-welding-works" not in slugs
    assert "accra-welding-works" in slugs


@pytest.mark.django_db
def test_trade_filter_matches_a_synonym(client, world):
    """Someone filters on "welder"; the trade is called "Welding"."""
    response = client.get("/api/providers/", {"trade": "welder"})

    slugs = {r["slug"] for r in response.json()["results"]}
    assert "accra-tailoring" not in slugs
    assert len(slugs) == 3


@pytest.mark.django_db
def test_fee_ceiling_keeps_a_provider_with_one_affordable_course(client, world):
    response = client.get("/api/providers/", {"max_fee": 1000})

    slugs = {r["slug"] for r in response.json()["results"]}
    assert slugs == {"madina-welding-works", "accra-tailoring"}


@pytest.mark.django_db
def test_verified_only_uses_the_site_visit_not_the_government_record(
    client, world, django_user_model
):
    """The two trust signals are never combined into one filter."""
    officer = django_user_model.objects.create_user("officer")
    Verification.objects.create(
        provider=world["near"],
        visited_on=date.today(),
        officer=officer,
        checks_performed="Saw the workshop and the equipment.",
        outcome=Verification.Outcome.PASSED,
    )
    # A CTVET registration on a provider that was never visited must NOT satisfy
    # the verified filter.
    GovernmentStatus.objects.create(
        provider=world["far"], registration_status=GovernmentStatus.Status.REGISTERED
    )

    response = client.get("/api/providers/", {"verified_only": "true"})

    slugs = {r["slug"] for r in response.json()["results"]}
    assert slugs == {"accra-welding-works"}


@pytest.mark.django_db
def test_unpublished_providers_are_never_returned(client, world):
    world["near"].status = Provider.Status.DRAFT
    world["near"].save()

    slugs = {r["slug"] for r in client.get("/api/providers/").json()["results"]}
    assert "accra-welding-works" not in slugs


@pytest.mark.django_db
def test_provider_ordering_has_a_unique_tiebreaker_for_list_and_distance_search(world):
    factory = APIRequestFactory()
    view = ProviderViewSet()

    view.request = Request(factory.get("/api/providers/"))
    assert view.get_queryset().query.order_by == ("name", "pk")

    view.request = Request(factory.get("/api/providers/", {"lat": "5.6037", "lng": "-0.1870"}))
    assert view.get_queryset().query.order_by == ("distance", "name", "pk")


# --------------------------------------------------------------------------
# Profile
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_profile_keeps_the_two_trust_signals_apart(client, world, django_user_model):
    officer = django_user_model.objects.create_user("officer")
    Verification.objects.create(
        provider=world["near"],
        visited_on=date.today(),
        officer=officer,
        checks_performed="Saw the workshop and the equipment.",
        outcome=Verification.Outcome.PASSED,
    )

    response = client.get(reverse("provider-by-slug", args=["accra", "accra-welding-works"]))
    body = response.json()

    assert response.status_code == 200
    assert body["verifications"][0]["checks_performed"].startswith("Saw the workshop")
    # No government record exists, and the API says so rather than staying silent.
    assert body["government_status"]["registration_status"] == "not_claimed"
    assert body["government_status_detail"] is None
    assert "is_verified" not in body


@pytest.mark.django_db
def test_profile_lists_programmes_with_upcoming_intakes(client, world):
    body = client.get(reverse("provider-by-slug", args=["accra", "accra-welding-works"])).json()

    programme = body["programmes"][0]
    assert programme["fee"] == "1200.00"
    assert len(programme["intakes"]) == 1


# --------------------------------------------------------------------------
# Generated page data
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_summary_computes_the_fee_range_paragraph(client, world):
    response = client.get("/api/pages/summary/", {"trade": "welding", "region": "greater-accra"})
    body = response.json()

    assert body["provider_count"] == 3
    assert body["lowest_fee"] == "900.00"
    assert body["highest_fee"] == "1500.00"
    assert body["has_enough_inventory_to_index"] is True


@pytest.mark.django_db
def test_summary_flags_a_thin_page_as_not_worth_indexing(client, world):
    """Ninety empty pages for one region is the failure Section 04 warns about."""
    response = client.get("/api/pages/summary/", {"trade": "tailoring", "area": "accra"})
    body = response.json()

    assert body["provider_count"] == 1
    assert body["has_enough_inventory_to_index"] is False


@pytest.mark.django_db
def test_unlaunched_region_has_no_summary_but_area_and_search_stay_public(client, world):
    region = world["accra"].region
    region.is_launched = False
    region.save(update_fields=["is_launched"])

    region_summary = client.get(
        "/api/pages/summary/",
        {"trade": "welding", "region": region.slug},
    )
    area_summary = client.get(
        "/api/pages/summary/",
        {"trade": "welding", "area": world["accra"].slug},
    )
    search = client.get("/api/providers/", {"region": region.slug, "trade": "welding"})

    assert region_summary.status_code == 404
    assert area_summary.status_code == 200
    assert area_summary.json()["provider_count"] == 2
    assert search.status_code == 200
    assert {provider["slug"] for provider in search.json()["results"]} == {
        "accra-welding-works",
        "madina-welding-works",
        "tema-welding-works",
    }


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_dashboard_token_opens_only_its_own_listing(client, world):
    token = make_dashboard_token(world["near"])
    Subscription.objects.create(
        provider=world["near"],
        tier=Subscription.Tier.STANDARD,
        price=120,
        period_start=date.today() - timedelta(days=1),
        period_end=date.today() + timedelta(days=30),
    )

    body = client.get(reverse("provider-dashboard", args=[token])).json()

    assert body["provider"]["slug"] == "accra-welding-works"
    assert body["subscription"]["price"] == "120.00"


@pytest.mark.django_db
def test_dashboard_rejects_a_tampered_token(client, world):
    token = make_dashboard_token(world["near"])
    response = client.get(reverse("provider-dashboard", args=[token[:-4] + "aaaa"]))

    assert response.status_code == 403


@pytest.mark.django_db
def test_dashboard_reports_unmeasurable_numbers_as_null_not_zero(client, world):
    """Profile views need an analytics source the stack does not have yet.

    Returning null says "not measured". Returning 0 would say "nobody looked",
    which is a different and false claim to put in front of a paying provider.
    """
    body = client.get(
        reverse("provider-dashboard", args=[make_dashboard_token(world["near"])])
    ).json()

    assert body["profile_views"] is None
    assert body["response_rate"] is None  # no enquiries yet
    assert "monthly visit" in body["enrolments_basis"]
