"""Regression tests for catalogue state at the public API boundary."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from geography.models import Area, Region
from providers.models import Provider


@pytest.fixture
def public_catalogue(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    area = Area.objects.create(
        region=region,
        name="Accra",
        slug="accra",
        centroid=Point(-0.1870, 5.6037, srid=4326),
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    provider = Provider.objects.create(
        name="Accra Skills Centre",
        slug="accra-skills-centre",
        area=area,
        location=Point(-0.1870, 5.6037, srid=4326),
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )
    return {"area": area, "provider": provider, "trade": trade}


def make_programme(public_catalogue, *, title, is_active=True, fee=1200, duration_weeks=12):
    return Programme.objects.create(
        provider=public_catalogue["provider"],
        trade=public_catalogue["trade"],
        title=title,
        fee=fee,
        duration_weeks=duration_weeks,
        is_active=is_active,
    )


@pytest.mark.django_db
def test_provider_card_metrics_ignore_inactive_programmes(public_catalogue, client):
    active = make_programme(
        public_catalogue,
        title="Current welding course",
        fee=1200,
        duration_weeks=12,
    )
    Intake.objects.create(programme=active, start_date=timezone.localdate() + timedelta(days=30))

    archived = make_programme(
        public_catalogue,
        title="Archived welding course",
        is_active=False,
        fee=1,
        duration_weeks=1,
    )
    Intake.objects.create(programme=archived, start_date=timezone.localdate() + timedelta(days=1))

    card = client.get("/api/providers/").json()["results"][0]

    assert card["lowest_fee"] == "1200.00"
    assert card["shortest_duration_weeks"] == 12
    assert card["next_intake"] == (timezone.localdate() + timedelta(days=30)).isoformat()


@pytest.mark.django_db
def test_provider_card_next_intake_ignores_sold_out_but_allows_unknown_places(
    public_catalogue, client
):
    programme = make_programme(public_catalogue, title="Current welding course")
    Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=5),
        places_remaining=0,
    )
    available = Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=10),
        places_remaining=None,
    )

    card = client.get("/api/providers/").json()["results"][0]

    assert card["next_intake"] == available.start_date.isoformat()


@pytest.mark.django_db
def test_provider_profile_excludes_inactive_programmes_and_unavailable_intakes(
    public_catalogue, client
):
    active = make_programme(public_catalogue, title="Current welding course")
    visible_intake = Intake.objects.create(
        programme=active,
        start_date=timezone.localdate() + timedelta(days=30),
    )
    Intake.objects.create(
        programme=active,
        start_date=timezone.localdate() + timedelta(days=31),
        is_open=False,
    )
    Intake.objects.create(
        programme=active,
        start_date=timezone.localdate() - timedelta(days=1),
    )

    archived = make_programme(
        public_catalogue,
        title="Archived welding course",
        is_active=False,
    )
    Intake.objects.create(programme=archived, start_date=timezone.localdate() + timedelta(days=1))

    body = client.get(
        reverse(
            "provider-by-slug",
            args=[public_catalogue["area"].slug, public_catalogue["provider"].slug],
        )
    ).json()

    assert [programme["title"] for programme in body["programmes"]] == ["Current welding course"]
    assert [intake["id"] for intake in body["programmes"][0]["intakes"]] == [visible_intake.pk]


@pytest.mark.django_db
def test_profile_excludes_sold_out_intakes_and_orders_available_intakes(public_catalogue, client):
    programme = make_programme(public_catalogue, title="Current welding course")
    later = Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=20),
        places_remaining=2,
    )
    sold_out = Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=5),
        places_remaining=0,
    )
    earlier = Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=10),
        places_remaining=None,
    )

    body = client.get(
        reverse(
            "provider-by-slug",
            args=[public_catalogue["area"].slug, public_catalogue["provider"].slug],
        )
    ).json()

    intake_ids = [intake["id"] for intake in body["programmes"][0]["intakes"]]
    assert intake_ids == [earlier.pk, later.pk]
    assert sold_out.pk not in intake_ids


@pytest.mark.django_db
def test_trade_provider_count_uses_active_programmes_on_published_providers(
    public_catalogue, client
):
    make_programme(public_catalogue, title="Current welding course")
    make_programme(public_catalogue, title="Second current course")

    archived_provider = Provider.objects.create(
        name="Archived Catalogue Centre",
        slug="archived-catalogue-centre",
        area=public_catalogue["area"],
        location=Point(-0.18, 5.61, srid=4326),
        contact_phone="+233241234568",
        status=Provider.Status.PUBLISHED,
    )
    Programme.objects.create(
        provider=archived_provider,
        trade=public_catalogue["trade"],
        title="Archived course",
        fee=500,
        duration_weeks=6,
        is_active=False,
    )

    draft_provider = Provider.objects.create(
        name="Draft Centre",
        slug="draft-centre",
        area=public_catalogue["area"],
        location=Point(-0.17, 5.62, srid=4326),
        contact_phone="+233241234569",
        status=Provider.Status.DRAFT,
    )
    Programme.objects.create(
        provider=draft_provider,
        trade=public_catalogue["trade"],
        title="Draft course",
        fee=700,
        duration_weeks=8,
    )

    trade = client.get("/api/trades/").json()["results"][0]

    assert trade["slug"] == "welding"
    assert trade["provider_count"] == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "query",
    [
        {"starts_before": lambda: timezone.localdate() + timedelta(days=14)},
        {"starts_after": lambda: timezone.localdate() - timedelta(days=14)},
    ],
)
def test_intake_date_filters_ignore_inactive_programmes(public_catalogue, client, query):
    archived = make_programme(
        public_catalogue,
        title="Archived welding course",
        is_active=False,
    )
    Intake.objects.create(
        programme=archived,
        start_date=timezone.localdate() + timedelta(days=7),
    )

    params = {name: value().isoformat() for name, value in query.items()}
    response = client.get("/api/providers/", params)

    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
def test_starts_after_does_not_resurface_a_past_open_intake(public_catalogue, client):
    active = make_programme(public_catalogue, title="Current welding course")
    Intake.objects.create(
        programme=active,
        start_date=timezone.localdate() - timedelta(days=1),
    )

    response = client.get(
        "/api/providers/",
        {"starts_after": (timezone.localdate() - timedelta(days=14)).isoformat()},
    )

    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    "params",
    [
        {"starts_before": lambda: timezone.localdate() + timedelta(days=14)},
        {"starts_after": lambda: timezone.localdate()},
    ],
)
def test_intake_date_filters_ignore_sold_out_intakes(public_catalogue, client, params):
    programme = make_programme(public_catalogue, title="Current welding course")
    Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=7),
        places_remaining=0,
    )

    query = {name: value().isoformat() for name, value in params.items()}
    response = client.get("/api/providers/", query)

    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    "params",
    [
        {"starts_before": lambda: timezone.localdate() + timedelta(days=14)},
        {"starts_after": lambda: timezone.localdate()},
    ],
)
def test_intake_date_filters_allow_unknown_remaining_places(public_catalogue, client, params):
    programme = make_programme(public_catalogue, title="Current welding course")
    Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=7),
        places_remaining=None,
    )

    query = {name: value().isoformat() for name, value in params.items()}
    response = client.get("/api/providers/", query)

    assert response.status_code == 200
    assert [provider["slug"] for provider in response.json()["results"]] == [
        public_catalogue["provider"].slug
    ]


@pytest.mark.django_db
def test_text_search_ignores_trades_from_inactive_programmes(public_catalogue, client):
    archived = make_programme(
        public_catalogue,
        title="Archived welding course",
        is_active=False,
    )
    archived.trade.synonyms = ["fabrication"]
    archived.trade.save(update_fields=["synonyms"])

    response = client.get("/api/providers/", {"q": "fabrication"})

    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    "params",
    [
        {"trade": "legacy-craft"},
        {"q": "heritagework"},
    ],
)
def test_search_filters_do_not_discover_inactive_trades(public_catalogue, client, params):
    inactive_trade = Trade.objects.create(
        name="Legacy Craft",
        slug="legacy-craft",
        synonyms=["heritagework"],
        is_active=False,
    )
    Programme.objects.create(
        provider=public_catalogue["provider"],
        trade=inactive_trade,
        title="Still marked active",
        fee=800,
        duration_weeks=8,
        is_active=True,
    )

    response = client.get("/api/providers/", params)

    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
def test_cards_and_profiles_hide_programmes_from_inactive_trades(public_catalogue, client):
    inactive_trade = Trade.objects.create(
        name="Legacy Craft",
        slug="legacy-craft",
        is_active=False,
    )
    programme = Programme.objects.create(
        provider=public_catalogue["provider"],
        trade=inactive_trade,
        title="Still marked active",
        fee=800,
        duration_weeks=8,
        is_active=True,
    )
    Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=7),
    )

    card = client.get("/api/providers/").json()["results"][0]
    profile = client.get(
        reverse(
            "provider-by-slug",
            args=[public_catalogue["area"].slug, public_catalogue["provider"].slug],
        )
    ).json()

    assert card["lowest_fee"] is None
    assert card["shortest_duration_weeks"] is None
    assert card["next_intake"] is None
    assert profile["programmes"] == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    "params",
    [
        {"max_fee": "1000"},
        {"starts_before": lambda: (timezone.localdate() + timedelta(days=14)).isoformat()},
        {"starts_after": lambda: timezone.localdate().isoformat()},
    ],
)
def test_fee_and_date_filters_ignore_programmes_from_inactive_trades(
    public_catalogue, client, params
):
    inactive_trade = Trade.objects.create(
        name="Legacy Craft",
        slug="legacy-craft",
        is_active=False,
    )
    programme = Programme.objects.create(
        provider=public_catalogue["provider"],
        trade=inactive_trade,
        title="Still marked active",
        fee=800,
        duration_weeks=8,
        is_active=True,
    )
    Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=7),
    )
    resolved_params = {
        name: value() if callable(value) else value for name, value in params.items()
    }

    response = client.get("/api/providers/", resolved_params)

    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
def test_generated_summary_ignores_inactive_trades(public_catalogue, client):
    inactive_trade = Trade.objects.create(
        name="Legacy Craft",
        slug="legacy-craft",
        is_active=False,
    )
    Programme.objects.create(
        provider=public_catalogue["provider"],
        trade=inactive_trade,
        title="Still marked active",
        fee=800,
        duration_weeks=8,
        is_active=True,
    )

    response = client.get(
        "/api/pages/summary/",
        {"trade": inactive_trade.slug, "area": public_catalogue["area"].slug},
    )

    assert response.status_code == 200
    assert response.json()["provider_count"] == 0
    assert response.json()["lowest_fee"] is None
