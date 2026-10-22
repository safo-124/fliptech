"""Links from the back office to the public site.

In production the two share a domain, so a relative link happened to work; in
development the back office is on :8000 and every such link was a Django 404.
These hold the links to PUBLIC_SITE_URL, and hold the provider page — the one
staff edit most — to having a way to its public listing at all.
"""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.test import RequestFactory
from django.urls import reverse

from catalog.models import Intake, Programme, Trade
from core.site_links import provider_page_url, public_site_url
from geography.models import Area, Region
from providers.models import Provider
from trainees.admin import trainee_dashboard_url

ACCRA = Point(-0.1870, 5.6037, srid=4326)
SITE = "https://skills.example"


@pytest.fixture
def site(settings):
    settings.PUBLIC_SITE_URL = SITE
    return SITE


@pytest.fixture
def world(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Tema", slug="tema", centroid=ACCRA)
    trade = Trade.objects.create(name="Welding", slug="welding")

    def provider(slug, status):
        return Provider.objects.create(
            name=slug.replace("-", " ").title(),
            slug=slug,
            area=area,
            location=ACCRA,
            contact_phone="+233241234567",
            status=status,
        )

    live = provider("tema-welding-works", Provider.Status.PUBLISHED)
    draft = provider("draft-welding", Provider.Status.DRAFT)
    programme = Programme.objects.create(
        provider=live, trade=trade, title="Arc welding", fee=1200, duration_weeks=12
    )
    intake = Intake.objects.create(programme=programme, start_date=date.today() + timedelta(30))
    return {
        "trade": trade,
        "live": live,
        "draft": draft,
        "programme": programme,
        "intake": intake,
    }


@pytest.fixture
def boss(client, django_user_model):
    client.force_login(django_user_model.objects.create_superuser("boss", password="pw-12345678"))
    return client


# --- the helper ----------------------------------------------------------------


def test_links_are_built_on_the_public_site(site):
    assert public_site_url("/") == f"{SITE}/"
    assert public_site_url("trades/welding") == f"{SITE}/trades/welding"
    assert public_site_url("/trades/welding") == f"{SITE}/trades/welding"


def test_a_trailing_slash_or_a_path_prefix_on_the_setting_is_kept_right(settings):
    settings.PUBLIC_SITE_URL = "https://skills.example/hub/"
    assert public_site_url("trades/welding") == "https://skills.example/hub/trades/welding"


def test_without_a_public_address_the_link_stays_relative(settings):
    """Still right wherever the site and the back office share a domain."""
    settings.PUBLIC_SITE_URL = ""
    assert public_site_url("trades/welding") == "/trades/welding"
    assert public_site_url("/") == "/"


def test_a_development_link_keeps_the_loopback_name_staff_used(settings):
    """localhost and 127.0.0.1 are different sites to a browser; mixing them
    loses the staff session cookie that support mode needs."""
    settings.PUBLIC_SITE_URL = "http://127.0.0.1:3000"
    request = RequestFactory().get("/", HTTP_HOST="localhost:8000")

    assert public_site_url("trainee", request) == "http://localhost:3000/trainee"
    assert trainee_dashboard_url(request) == "http://localhost:3000/trainee"


def test_only_a_published_provider_has_a_page(site, world):
    assert provider_page_url(world["live"]) == f"{SITE}/tema/tema-welding-works"
    assert provider_page_url(world["draft"]) is None


# --- the back office ------------------------------------------------------------


@pytest.mark.django_db
def test_view_site_in_the_top_bar_goes_to_the_public_site(boss, site):
    page = boss.get(reverse("admin:index")).content.decode()

    assert f'href="{SITE}/"' in page


@pytest.mark.django_db
def test_a_published_provider_page_links_to_its_listing(boss, site, world):
    page = boss.get(reverse("admin:providers_provider_change", args=[world["live"].pk]))

    assert page.context["absolute_url"] == f"{SITE}/tema/tema-welding-works"
    assert f'href="{SITE}/tema/tema-welding-works"' in page.content.decode()


@pytest.mark.django_db
def test_a_draft_provider_page_has_no_link_to_a_page_that_does_not_exist(boss, site, world):
    page = boss.get(reverse("admin:providers_provider_change", args=[world["draft"].pk]))

    assert page.context["has_absolute_url"] is False


@pytest.mark.django_db
def test_catalog_pages_link_to_the_public_site(boss, site, world):
    trade = boss.get(reverse("admin:catalog_trade_change", args=[world["trade"].pk]))
    programme = boss.get(reverse("admin:catalog_programme_change", args=[world["programme"].pk]))
    intake = boss.get(reverse("admin:catalog_intake_change", args=[world["intake"].pk]))

    assert trade.context["absolute_url"] == f"{SITE}/trades/welding"
    assert programme.context["absolute_url"] == f"{SITE}/tema/tema-welding-works"
    assert intake.context["absolute_url"] == f"{SITE}/tema/tema-welding-works"


@pytest.mark.django_db
def test_an_inactive_trade_has_no_page_to_link_to(boss, site, world):
    Trade.objects.filter(pk=world["trade"].pk).update(is_active=False)

    page = boss.get(reverse("admin:catalog_trade_change", args=[world["trade"].pk]))

    assert page.context["has_absolute_url"] is False
