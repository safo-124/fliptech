"""Site search: reading what was meant, ordering, the report, nearby help and
training alerts."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from accounts.models import CustomerAccount
from catalog.models import Programme, Trade
from geography.models import Area, Region
from providers.models import Provider
from search import alerts
from search.models import SearchLog, TrainingAlert
from search.understand import understand

ACCRA = Point(-0.1870, 5.6037, srid=4326)
MADINA = Point(-0.1660, 5.6830, srid=4326)
TEMA = Point(0.0166, 5.6698, srid=4326)


@pytest.fixture
def places(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra", is_launched=True)
    return {
        "accra": Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA),
        "madina": Area.objects.create(region=region, name="Madina", slug="madina", centroid=MADINA),
        "tema": Area.objects.create(region=region, name="Tema", slug="tema", centroid=TEMA),
    }


@pytest.fixture
def trades(db):
    return {
        "welding": Trade.objects.create(
            name="Welding", slug="welding", synonyms=["welder", "fabrication"]
        ),
        "tailoring": Trade.objects.create(
            name="Tailoring", slug="tailoring", synonyms=["sewing", "seamstress"]
        ),
        "mechanics": Trade.objects.create(
            name="Auto mechanics", slug="auto-mechanics", synonyms=["fitter", "car repair"]
        ),
    }


def workshop(area, name, trade, point, fee="1000", published_at=None):
    provider = Provider.objects.create(
        name=name,
        slug=name.lower().replace(" ", "-"),
        area=area,
        location=point,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
        published_at=published_at or timezone.now() - timedelta(days=30),
    )
    Programme.objects.create(
        provider=provider,
        trade=trade,
        title=f"{trade.name} course",
        fee=Decimal(fee),
        duration_weeks=12,
    )
    return provider


@pytest.mark.django_db
@pytest.mark.parametrize(
    "typed, trade, area, words",
    [
        ("welder tema", "welding", "tema", ""),
        ("sewing classes in madina", "tailoring", "madina", ""),
        ("weldng", "welding", None, ""),
        ("mechanics", "auto-mechanics", None, ""),
        ("Accra welding works", "welding", "accra", "works"),
        # Half of the synonym "car repair" is not enough.
        ("phone repair", None, None, "phone repair"),
    ],
)
def test_a_search_is_read_for_its_trade_and_place(places, trades, typed, trade, area, words):
    understood = understand(typed)
    assert (understood.trade.slug if understood.trade else None) == trade
    assert (understood.area.slug if understood.area else None) == area
    assert understood.words == words


@pytest.mark.django_db
def test_the_training_search_filters_by_the_trade_and_place_it_read(client, places, trades):
    workshop(places["tema"], "Tema Metal Shop", trades["welding"], TEMA)
    workshop(places["accra"], "Accra Metal Shop", trades["welding"], ACCRA)
    workshop(places["tema"], "Tema Sewing Room", trades["tailoring"], TEMA)

    found = client.get("/api/providers/", {"q": "welder in tema"}).json()

    assert [p["name"] for p in found["results"]] == ["Tema Metal Shop"]
    assert SearchLog.objects.get().query == "welder in tema"


@pytest.mark.django_db
def test_sort_cheapest_soonest_and_nearest(client, places, trades):
    workshop(places["tema"], "Tema Welding", trades["welding"], TEMA, fee="900")
    workshop(places["accra"], "Accra Welding", trades["welding"], ACCRA, fee="1500")
    workshop(places["madina"], "Madina Welding", trades["welding"], MADINA, fee="600")

    def names(**params):
        return [p["name"] for p in client.get("/api/providers/", params).json()["results"]]

    assert names(trade="welding", sort="cheapest") == [
        "Madina Welding",
        "Tema Welding",
        "Accra Welding",
    ]
    # Nearest with no point measures from the area chosen.
    assert names(trade="welding", area="", q="welding accra", sort="nearest")[0] == "Accra Welding"
    assert names(trade="welding", area="accra", sort="nearest") == ["Accra Welding"]


@pytest.mark.django_db
def test_site_search_returns_each_section_and_nearby_help(client, places, trades):
    workshop(places["madina"], "Madina Welding", trades["welding"], MADINA)
    workshop(places["accra"], "Accra Welding", trades["welding"], ACCRA)

    body = client.get(reverse("search"), {"q": "welding tema", "log": "1"}).json()

    assert body["understood"]["trade"]["slug"] == "welding"
    assert body["understood"]["area"]["slug"] == "tema"
    assert body["workshops"]["count"] == 0
    # Nothing in Tema: the closest welding workshops instead, nearest first.
    assert [p["name"] for p in body["nearby"]] == ["Madina Welding", "Accra Welding"]
    assert {"workshops", "courses", "products", "shops"} <= body.keys()
    log = SearchLog.objects.get()
    assert (log.query, log.scope, log.results) == ("welding tema", "all", 0)


@pytest.mark.django_db
def test_site_search_logs_only_when_asked(client, places, trades):
    client.get(reverse("search"), {"q": "weld"})
    assert not SearchLog.objects.exists()


@pytest.mark.django_db
def test_suggestions_offer_the_trade_in_the_place(client, places, trades):
    workshop(places["tema"], "Tema Welding", trades["welding"], TEMA)

    items = client.get(reverse("search-suggest"), {"q": "welder tema"}).json()["results"]

    assert items[0] == {
        "kind": "trade_area",
        "label": "Welding in Tema",
        "trade": "welding",
        "area": "tema",
    }
    assert client.get(reverse("search-suggest"), {"q": "w"}).json()["results"] == []


@pytest.mark.django_db
def test_nearby_lists_what_else_is_taught_in_the_area(client, places, trades):
    workshop(places["tema"], "Tema Sewing", trades["tailoring"], TEMA)
    workshop(places["madina"], "Madina Welding", trades["welding"], MADINA)

    body = client.get(reverse("search-nearby"), {"trade": "welding", "area": "tema"}).json()

    assert [p["name"] for p in body["nearby"]] == ["Madina Welding"]
    assert [t["slug"] for t in body["trades_here"]] == ["tailoring"]


@pytest.fixture
def buyer(db):
    user = get_user_model().objects.create_user("buyer-ama")
    return CustomerAccount.objects.create(
        user=user, phone="+233201112233", phone_verified_at=timezone.now()
    )


@pytest.mark.django_db
def test_training_alert_is_kept_once_and_texted_when_a_workshop_opens(
    client, places, trades, buyer, monkeypatch, settings
):
    settings.PUBLIC_SITE_URL = "https://skills.example"
    sent = []
    monkeypatch.setattr(
        "marketplace.alerts.send_sms", lambda to, message: sent.append((str(to), message))
    )
    assert client.post(reverse("search-alerts"), {"trade": "welding"}).status_code == 403

    client.force_login(buyer.user)
    made = client.post(
        reverse("search-alerts"),
        {"trade": "welding", "area": "tema"},
        content_type="application/json",
    )
    assert made.status_code == 201
    again = client.post(
        reverse("search-alerts"),
        {"trade": "welding", "area": "tema"},
        content_type="application/json",
    )
    assert again.status_code == 200
    assert TrainingAlert.objects.count() == 1

    # Nothing new yet: no text.
    assert alerts.tell_training_alerts() == 0
    workshop(
        places["madina"],
        "Madina Welding",
        trades["welding"],
        MADINA,
        published_at=timezone.now() + timedelta(minutes=1),
    )
    assert alerts.tell_training_alerts(timezone.now() + timedelta(minutes=2)) == 0

    workshop(
        places["tema"],
        "Tema Welding",
        trades["welding"],
        TEMA,
        published_at=timezone.now() + timedelta(minutes=3),
    )
    assert alerts.tell_training_alerts(timezone.now() + timedelta(minutes=4)) == 1
    assert sent == [
        (
            "+233201112233",
            f"{settings.BRAND_NAME}: a new welding workshop in Tema: Tema Welding. "
            "https://skills.example/tema/tema-welding",
        )
    ]

    alert = TrainingAlert.objects.get()
    assert client.delete(reverse("search-alert", args=[alert.pk])).status_code == 204
    assert not TrainingAlert.objects.exists()


@pytest.mark.django_db
def test_the_search_report_lists_searches_that_found_nothing(admin_client):
    SearchLog.objects.create(query="phone repair", scope="all", results=0)
    SearchLog.objects.create(query="phone repair", scope="training", results=0)
    SearchLog.objects.create(query="welding", scope="all", results=7)

    page = admin_client.get(reverse("admin:search_searchlog_changelist"))

    assert page.status_code == 200
    assert [row["query"] for row in page.context["empty_searches"]] == ["phone repair"]
    assert page.context["top_searches"][0]["query"] == "phone repair"
