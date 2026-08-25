"""Tests for the back-office sidebar's work queues.

The queues exist so that a count is also a route to the work. That only holds
if the number on the badge and the number of rows behind the link are produced
by the same query — which is the one thing worth pinning here, because the two
are read on different screens and nothing else would ever catch them drifting
apart.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Permission
from django.contrib.gis.geos import Point
from django.db import connection
from django.urls import resolve, reverse
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from enquiries.models import Enquiry
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


@pytest.fixture
def boss(client, django_user_model):
    user = django_user_model.objects.create_superuser("boss", password="test-pass-1234")
    client.force_login(user)
    return user


def make(area, slug, status):
    return Provider.objects.create(
        name=slug.replace("-", " ").title(),
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=status,
    )


def sidebar(client):
    """The queues as the sidebar would render them, from any back-office page."""
    response = client.get(reverse("admin:index"))
    return {q["label"]: q for q in response.context["back_office"]["queues"]}


def enquiry_sidebar(client):
    response = client.get(reverse("admin:index"))
    return {q["label"]: q for q in response.context["back_office"]["enquiry_queues"]}


def catalog_sidebar(client):
    response = client.get(reverse("admin:index"))
    return {q["label"]: q for q in response.context["back_office"]["catalog_queues"]}


def make_programme(provider, trade, title):
    return Programme.objects.create(
        provider=provider,
        trade=trade,
        title=title,
        fee="1200.00",
        duration_weeks=12,
    )


@pytest.mark.django_db
def test_a_queue_badge_links_to_exactly_the_rows_it_counted(client, area, boss):
    make(area, "pending-one", Provider.Status.PENDING_APPROVAL)
    make(area, "pending-two", Provider.Status.PENDING_APPROVAL)
    make(area, "published-one", Provider.Status.PUBLISHED)

    queue = sidebar(client)["Awaiting approval"]
    assert queue["count"] == 2

    listed = client.get(queue["url"]).context["cl"].result_count
    assert listed == queue["count"]


@pytest.mark.django_db
def test_an_empty_queue_is_not_shown_at_all(client, area, boss):
    make(area, "published-one", Provider.Status.PUBLISHED)

    labels = sidebar(client)
    assert "Awaiting approval" not in labels
    # The same provider has never been visited, so that queue is present. An
    # empty sidebar would mean the counts had simply stopped working.
    assert labels["Never visited"]["count"] == 1


@pytest.mark.django_db
def test_enquiry_follow_up_badge_links_to_exactly_the_rows_it_counted(client, area, boss):
    provider = make(area, "published-one", Provider.Status.PUBLISHED)
    Enquiry.objects.create(
        provider=provider,
        programme=None,
        trainee_phone="+233241234567",
        state=Enquiry.State.FAILED,
    )
    Enquiry.objects.create(
        provider=provider,
        programme=None,
        trainee_phone="+233241234568",
        state=Enquiry.State.FAILED,
    )
    Enquiry.objects.create(
        provider=provider,
        programme=None,
        trainee_phone="+233241234569",
        state=Enquiry.State.SENT,
    )

    queue = enquiry_sidebar(client)["Delivery failed"]
    assert queue["count"] == 2
    assert client.get(queue["url"]).context["cl"].result_count == queue["count"]


@pytest.mark.django_db
def test_enquiry_sidebar_links_follow_admin_permissions(client, area, django_user_model):
    provider = make(area, "published-one", Provider.Status.PUBLISHED)
    Enquiry.objects.create(
        provider=provider,
        programme=None,
        trainee_phone="+233241234567",
        state=Enquiry.State.FAILED,
    )
    user = django_user_model.objects.create_user(
        "enquiry-viewer", password="test-pass-1234", is_staff=True
    )
    user.user_permissions.add(
        Permission.objects.get(content_type__app_label="enquiries", codename="view_enquiry")
    )
    client.force_login(user)

    response = client.get(reverse("admin:index"))
    back_office = response.context["back_office"]
    assert back_office["queues"] == []
    assert back_office["published"] == 0
    assert back_office["enquiry_queues"][0]["label"] == "Delivery failed"

    content = response.content.decode()
    assert reverse("admin:enquiries_enquiry_changelist") in content
    assert reverse("admin:providers_provider_changelist") not in content


@pytest.mark.django_db
def test_catalog_readiness_badges_link_to_exactly_the_rows_they_counted(client, area, boss):
    provider = make(area, "published-one", Provider.Status.PUBLISHED)
    trade = Trade.objects.create(name="Welding", slug="welding")
    no_future = make_programme(provider, trade, "Past cohort only")
    future = make_programme(provider, trade, "Future cohorts")
    today = timezone.localdate()

    Intake.objects.create(
        programme=no_future,
        start_date=today - timedelta(days=1),
        places_offered=12,
        places_remaining=4,
        is_open=True,
    )
    Intake.objects.create(
        programme=future,
        start_date=today + timedelta(days=7),
        places_offered=12,
        places_remaining=0,
        is_open=True,
    )
    Intake.objects.create(
        programme=future,
        start_date=today + timedelta(days=14),
        places_offered=12,
        places_remaining=None,
        is_open=True,
    )

    queues = catalog_sidebar(client)
    expected_counts = {
        "No future intake": 1,
        "Past but still open": 1,
        "Full but still open": 1,
        "Availability missing": 1,
    }

    assert {label: queues[label]["count"] for label in expected_counts} == expected_counts
    for label, expected_count in expected_counts.items():
        response = client.get(queues[label]["url"])
        assert response.context["cl"].result_count == expected_count


@pytest.mark.django_db
def test_catalog_sidebar_links_follow_model_permissions(client, area, django_user_model):
    provider = make(area, "published-one", Provider.Status.PUBLISHED)
    trade = Trade.objects.create(name="Plumbing", slug="plumbing")
    programme = make_programme(provider, trade, "Domestic plumbing")
    Intake.objects.create(
        programme=programme,
        start_date=timezone.localdate() - timedelta(days=1),
        is_open=True,
    )

    programme_viewer = django_user_model.objects.create_user(
        "programme-viewer", password="test-pass-1234", is_staff=True
    )
    programme_viewer.user_permissions.add(
        Permission.objects.get(content_type__app_label="catalog", codename="view_programme")
    )
    client.force_login(programme_viewer)

    programme_response = client.get(reverse("admin:index"))
    programme_context = programme_response.context["back_office"]
    programme_queues = programme_context["catalog_queues"]
    assert [queue["label"] for queue in programme_queues] == ["No future intake"]
    assert programme_context["intake_queues"] == []
    assert reverse("admin:catalog_programme_changelist") in programme_response.content.decode()
    assert reverse("admin:catalog_intake_changelist") not in programme_response.content.decode()

    intake_viewer = django_user_model.objects.create_user(
        "intake-viewer", password="test-pass-1234", is_staff=True
    )
    intake_viewer.user_permissions.add(
        Permission.objects.get(content_type__app_label="catalog", codename="view_intake")
    )
    client.force_login(intake_viewer)

    intake_response = client.get(reverse("admin:index"))
    intake_context = intake_response.context["back_office"]
    intake_queues = intake_context["catalog_queues"]
    assert [queue["label"] for queue in intake_queues] == ["Past but still open"]
    assert intake_context["programme_queues"] == []
    assert reverse("admin:catalog_intake_changelist") in intake_response.content.decode()
    assert reverse("admin:catalog_programme_changelist") not in intake_response.content.decode()


@pytest.mark.django_db
def test_current_catalog_queue_is_visibly_selected(client, area, boss):
    provider = make(area, "published-one", Provider.Status.PUBLISHED)
    trade = Trade.objects.create(name="Tailoring", slug="tailoring")
    make_programme(provider, trade, "Dressmaking")

    url = reverse("admin:catalog_programme_changelist") + "?queue=active_no_future_intake"
    content = client.get(url).content.decode()

    assert 'class="sb-item sb-queue sb-queue--catalog is-active"' in content
    assert 'id="sb-catalog-queues-label"' in content
    assert "Catalog readiness" in content


@pytest.mark.django_db
def test_the_footer_meter_reports_unconfirmed_listings(client, area, boss):
    make(area, "published-one", Provider.Status.PUBLISHED)
    make(area, "draft-one", Provider.Status.DRAFT)

    response = client.get(reverse("admin:index"))
    back_office = response.context["back_office"]

    # Drafts are not published listings and so are not part of the ratio.
    assert back_office["published"] == 1
    assert back_office["confirmed"] == 0
    assert back_office["confirmed_pct"] == 0


@pytest.mark.django_db
def test_the_queues_are_not_computed_outside_the_back_office(rf, area, boss):
    """Every template render goes through this, so the guard is the whole cost.

    Asserted with zero queries rather than an empty return value, because the
    return value would still be empty if the counts had run and been thrown
    away.
    """
    from django.test.utils import CaptureQueriesContext

    from core.context_processors import back_office

    make(area, "pending-one", Provider.Status.PENDING_APPROVAL)

    request = rf.get("/api/providers/")
    request.user = boss
    request.resolver_match = resolve("/api/providers/")

    with CaptureQueriesContext(connection) as queries:
        assert back_office(request) == {}
    assert len(queries) == 0


@pytest.mark.django_db
def test_non_staff_users_never_receive_or_compute_back_office_queues(rf, area, django_user_model):
    from django.test.utils import CaptureQueriesContext

    from core.context_processors import back_office

    make(area, "pending-one", Provider.Status.PENDING_APPROVAL)
    user = django_user_model.objects.create_user("non-staff", password="test-pass-1234")
    user.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="providers",
            codename="view_provider",
        )
    )
    request = rf.get(reverse("admin:index"))
    request.user = user
    request.resolver_match = resolve(reverse("admin:index"))

    with CaptureQueriesContext(connection) as queries:
        assert back_office(request) == {}
    assert len(queries) == 0


@pytest.mark.django_db
def test_sidebar_renders_the_modern_navigation_structure(client, area, boss):
    make(area, "published-one", Provider.Status.PUBLISHED)

    response = client.get(reverse("admin:index"))
    content = response.content.decode()

    assert 'id="nav-filter"' in content
    assert "data-nav-search-item" in content
    assert 'data-sidebar-app="providers"' in content
    assert 'class="sb-app-trigger"' in content
    assert 'class="sb-foot"' in content
    assert 'role="progressbar"' in content
    assert 'aria-current="page"' in content  # Overview on the dashboard.


@pytest.mark.django_db
def test_current_queue_and_model_are_visibly_selected(client, area, boss):
    make(area, "pending-one", Provider.Status.PENDING_APPROVAL)

    url = reverse("admin:providers_provider_changelist") + "?queue=awaiting_approval"
    content = client.get(url).content.decode()

    assert 'class="sb-item sb-queue is-active"' in content
    assert 'class="sb-app-model model-provider is-active"' in content
    assert 'aria-current="page"' in content


@pytest.mark.django_db
def test_app_landing_pages_keep_the_sidebar(client, boss):
    response = client.get(reverse("admin:app_list", kwargs={"app_label": "providers"}))

    assert response.status_code == 200
    assert b'id="nav-sidebar"' in response.content
    assert b'data-sidebar-app="providers"' in response.content


@pytest.mark.django_db
def test_navigation_uses_djangos_permission_filtered_app_list(client, django_user_model):
    user = django_user_model.objects.create_user("viewer", password="test-pass-1234", is_staff=True)
    user.user_permissions.add(
        Permission.objects.get(content_type__app_label="providers", codename="view_provider")
    )
    client.force_login(user)

    content = client.get(reverse("admin:index")).content.decode()

    assert reverse("admin:providers_provider_changelist") in content
    assert reverse("admin:auth_user_changelist") not in content
    assert reverse("admin:billing_subscription_changelist") not in content
