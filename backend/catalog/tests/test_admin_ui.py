"""Integration contracts for the Catalog operations workspaces.

The custom screens deliberately retain Django's changelist, form, action,
autocomplete, history, and inline machinery.  These tests pin those native
contracts alongside the catalog-specific queues and readiness signals.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.contrib.gis.geos import Point
from django.contrib.messages import get_messages
from django.contrib.staticfiles import finders
from django.templatetags.static import static
from django.test import RequestFactory
from django.urls import reverse
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def catalog(db):
    """A small catalog containing each operationally important state."""
    today = timezone.localdate()
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    provider = Provider.objects.create(
        name="Accra Skills Workshop",
        slug="accra-skills-workshop",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )

    ready_trade = Trade.objects.create(
        name="Welding",
        slug="welding",
        synonyms=["welder", "fabrication"],
        description="Learn practical metal joining and fabrication skills.",
    )
    orphan_trade = Trade.objects.create(name="Tailoring", slug="tailoring")
    inactive_trade = Trade.objects.create(
        name="Plumbing",
        slug="plumbing",
        synonyms=["pipe fitter"],
        description="Install and repair water systems.",
        is_active=False,
    )

    ready_programme = Programme.objects.create(
        provider=provider,
        trade=ready_trade,
        title="Arc welding",
        fee=Decimal("1200.00"),
        duration_weeks=12,
        hours_per_week=24,
        weekly_schedule="Mon-Thu, 8am to 2pm",
        capacity=16,
    )
    no_future_programme = Programme.objects.create(
        provider=provider,
        trade=ready_trade,
        title="Advanced fabrication",
        fee=Decimal("1600.00"),
        duration_weeks=10,
        weekly_schedule="Friday and Saturday",
        capacity=10,
    )
    inactive_open_programme = Programme.objects.create(
        provider=provider,
        trade=ready_trade,
        title="Retired welding course",
        fee=Decimal("900.00"),
        duration_weeks=8,
        weekly_schedule="Weekends",
        capacity=8,
        is_active=False,
    )
    inactive_trade_programme = Programme.objects.create(
        provider=provider,
        trade=inactive_trade,
        title="Domestic plumbing",
        fee=Decimal("1000.00"),
        duration_weeks=9,
        weekly_schedule="Mon-Wed",
        capacity=12,
    )

    future = Intake.objects.create(
        programme=ready_programme,
        start_date=today + timedelta(days=30),
        places_offered=16,
        places_remaining=7,
    )
    past_open = Intake.objects.create(
        programme=ready_programme,
        start_date=today - timedelta(days=5),
        places_offered=16,
        places_remaining=4,
    )
    full_open = Intake.objects.create(
        programme=ready_programme,
        start_date=today + timedelta(days=7),
        places_offered=16,
        places_remaining=0,
    )
    availability_missing = Intake.objects.create(
        programme=ready_programme,
        start_date=today + timedelta(days=10),
        places_offered=16,
        places_remaining=None,
    )
    inactive_programme_intake = Intake.objects.create(
        programme=inactive_open_programme,
        start_date=today + timedelta(days=20),
        places_offered=8,
        places_remaining=3,
    )
    inactive_trade_intake = Intake.objects.create(
        programme=inactive_trade_programme,
        start_date=today + timedelta(days=40),
        places_offered=12,
        places_remaining=5,
    )

    return {
        "provider": provider,
        "ready_trade": ready_trade,
        "orphan_trade": orphan_trade,
        "inactive_trade": inactive_trade,
        "ready_programme": ready_programme,
        "no_future_programme": no_future_programme,
        "inactive_open_programme": inactive_open_programme,
        "inactive_trade_programme": inactive_trade_programme,
        "future": future,
        "past_open": past_open,
        "full_open": full_open,
        "availability_missing": availability_missing,
        "inactive_programme_intake": inactive_programme_intake,
        "inactive_trade_intake": inactive_trade_intake,
    }


@pytest.fixture
def boss(client, django_user_model):
    user = django_user_model.objects.create_superuser("catalog-boss", password="test-pass-1234")
    client.force_login(user)
    return user


def template_names(response):
    return {template.name for template in response.templates if template.name}


def queue_links(response):
    return {item["key"]: item for item in response.context["catalog_workspace"]["queues"]}


def assert_native_changelist_contract(content):
    # Django's actions and list-editable JavaScript dereference these elements.
    assert 'id="changelist"' in content
    assert 'id="changelist-form"' in content
    assert 'id="result_list"' in content
    assert 'id="action-toggle"' in content
    assert 'class="action-select"' in content
    assert 'name="_selected_action"' in content
    assert 'name="action"' in content
    assert 'name="index"' in content
    assert 'class="action-counter"' in content
    assert 'class="select-across"' in content
    assert 'id="changelist-search"' in content
    assert 'id="searchbar"' in content
    assert 'id="changelist-filter"' in content
    assert 'aria-labelledby="changelist-filter-header"' in content
    assert "data-filter-title=" in content
    assert 'name="form-TOTAL_FORMS"' in content


@pytest.mark.django_db
def test_trade_workspace_filters_real_queue_and_keeps_list_editable_contracts(
    client, catalog, boss
):
    response = client.get(
        reverse("admin:catalog_trade_changelist"),
        {"queue": "active_without_active_programme"},
    )

    assert response.status_code == 200
    assert "admin/catalog/trade/change_list.html" in template_names(response)
    workspace = response.context["catalog_workspace"]
    assert workspace["current_queue"].key == "active_without_active_programme"
    assert workspace["matching"] == 1
    assert workspace["total"] == 3
    assert response.context["cl"].result_count == 1
    assert list(response.context["cl"].result_list) == [catalog["orphan_trade"]]

    links = queue_links(response)
    assert links["all"]["count"] == 3
    assert links["active_without_active_programme"]["count"] == 1
    assert links["active_without_active_programme"]["active"] is True

    content = response.content.decode()
    assert 'data-catalog-kind="trades"' in content
    assert 'aria-label="Catalog work queues"' in content
    assert 'aria-current="page"' in content
    assert "No active programme" in content
    assert "Needs content" in content
    assert 'name="form-0-display_order"' in content
    assert 'name="form-0-is_active"' in content
    assert_native_changelist_contract(content)

    for asset in ("core/admin_catalog.css", "core/admin_catalog.js"):
        assert finders.find(asset) is not None
        assert static(asset) in content


@pytest.mark.django_db
def test_programme_workspace_queue_counts_results_and_provider_quick_link(client, catalog, boss):
    response = client.get(
        reverse("admin:catalog_programme_changelist"),
        {"queue": "active_no_future_intake"},
    )

    assert response.status_code == 200
    assert "admin/catalog/programme/change_list.html" in template_names(response)
    workspace = response.context["catalog_workspace"]
    assert workspace["current_queue"].key == "active_no_future_intake"
    assert workspace["matching"] == 1
    assert workspace["total"] == 4
    assert list(response.context["cl"].result_list) == [catalog["no_future_programme"]]

    links = queue_links(response)
    assert links["all"]["count"] == 4
    assert links["active_no_future_intake"]["count"] == 1
    assert links["inactive_with_open_intake"]["count"] == 1

    content = response.content.decode()
    assert 'data-catalog-kind="programmes"' in content
    assert "No future intake" in content
    assert "Advanced fabrication" in content
    assert "Accra Skills Workshop" in content
    assert reverse("admin:providers_provider_change", args=[catalog["provider"].pk]) in content
    assert 'name="form-0-is_active"' in content
    assert_native_changelist_contract(content)


@pytest.mark.django_db
def test_queue_counts_follow_preserved_search_and_filter_state(client, catalog, boss):
    changelist = reverse("admin:catalog_programme_changelist")
    response = client.get(
        changelist,
        {
            "queue": "active_no_future_intake",
            "q": "Arc welding",
            "is_active__exact": "1",
        },
    )

    assert response.status_code == 200
    links = queue_links(response)
    assert links["all"]["count"] == 1
    assert links["active_no_future_intake"]["count"] == 0
    assert response.context["cl"].result_count == 0

    all_response = client.get(f"{changelist}{links['all']['url']}")
    assert all_response.context["cl"].result_count == links["all"]["count"]
    assert all_response.context["cl"].queryset.get() == catalog["ready_programme"]


@pytest.mark.django_db
def test_intake_workspace_exposes_lifecycle_availability_and_exact_queue_counts(
    client, catalog, boss
):
    changelist = reverse("admin:catalog_intake_changelist")
    response = client.get(changelist)

    assert response.status_code == 200
    assert "admin/catalog/intake/change_list.html" in template_names(response)
    workspace = response.context["catalog_workspace"]
    assert workspace["matching"] == 6
    assert workspace["total"] == 6
    links = queue_links(response)
    assert links["all"]["count"] == 6
    assert links["upcoming_open"]["count"] == 5
    assert links["past_open"]["count"] == 1
    assert links["full_open"]["count"] == 1
    assert links["availability_missing"]["count"] == 1

    content = response.content.decode()
    assert 'data-catalog-kind="intakes"' in content
    assert "Past · still open" in content
    assert "Full · still open" in content
    assert "Unconfirmed" in content
    assert "0 remaining" in content
    assert 'name="form-0-is_open"' in content
    assert_native_changelist_contract(content)

    queued = client.get(changelist, {"queue": "past_open"})
    assert queued.status_code == 200
    assert queued.context["catalog_workspace"]["current_queue"].key == "past_open"
    assert queued.context["cl"].result_count == 1
    assert list(queued.context["cl"].result_list) == [catalog["past_open"]]


@pytest.mark.django_db
def test_trade_form_keeps_prepopulation_inventory_facts_and_native_save_controls(
    client, catalog, boss
):
    response = client.get(reverse("admin:catalog_trade_change", args=[catalog["ready_trade"].pk]))

    assert response.status_code == 200
    assert "admin/catalog/trade/change_form.html" in template_names(response)
    content = response.content.decode()
    assert 'id="trade_form"' in content
    assert 'data-catalog-model="trade"' in content
    assert 'aria-label="Trade inventory summary"' in content
    assert "Trade and discovery details" in content
    assert "Write for the words people use" in content
    assert 'id="django-admin-prepopulated-fields-constants"' in content
    assert 'id="django-admin-form-add-constants"' in content
    assert 'class="cat-save-dock"' in content
    assert 'name="_save"' in content
    assert 'name="_continue"' in content
    assert 'name="_addanother"' in content


@pytest.mark.django_db
def test_programme_form_keeps_autocomplete_history_intakes_and_provider_link(client, catalog, boss):
    programme = catalog["ready_programme"]
    response = client.get(reverse("admin:catalog_programme_change", args=[programme.pk]))

    assert response.status_code == 200
    assert "admin/catalog/programme/change_form.html" in template_names(response)
    content = response.content.decode()
    assert 'id="programme_form"' in content
    assert 'data-catalog-model="programme"' in content
    assert 'aria-label="Programme lifecycle summary"' in content
    assert "Decision-ready before active" in content
    assert "admin/js/autocomplete.js" in content
    assert 'id="intakes-group"' in content
    assert 'data-inline-type="tabular"' in content
    assert 'id="id_intakes-TOTAL_FORMS"' in content
    assert 'class="historylink"' in content
    assert reverse("admin:providers_provider_change", args=[catalog["provider"].pk]) in content
    assert "Open provider" in content
    assert 'class="cat-save-dock"' in content
    assert 'name="_save"' in content
    assert 'name="_continue"' in content
    assert 'name="_addanother"' in content


@pytest.mark.django_db
def test_intake_form_keeps_autocomplete_quick_links_zero_places_and_lifecycle(
    client, catalog, boss
):
    intake = catalog["full_open"]
    response = client.get(reverse("admin:catalog_intake_change", args=[intake.pk]))

    assert response.status_code == 200
    assert "admin/catalog/intake/change_form.html" in template_names(response)
    content = response.content.decode()
    assert 'id="intake_form"' in content
    assert 'data-catalog-model="intake"' in content
    assert 'aria-label="Intake availability summary"' in content
    assert "Full · still open" in content
    assert "Keep capacity honest" in content
    assert "admin/js/autocomplete.js" in content
    assert (
        reverse("admin:catalog_programme_change", args=[catalog["ready_programme"].pk]) in content
    )
    assert reverse("admin:providers_provider_change", args=[catalog["provider"].pk]) in content
    assert "Open programme" in content
    assert "Open provider" in content
    assert ">0</dd>" in content
    assert 'class="cat-save-dock"' in content
    assert 'name="_save"' in content


@pytest.mark.django_db
@pytest.mark.parametrize("model_name", ("trade", "programme", "intake"))
def test_view_only_staff_gets_permission_safe_read_only_catalog_forms(
    client, django_user_model, catalog, model_name
):
    objects = {
        "trade": catalog["ready_trade"],
        "programme": catalog["ready_programme"],
        "intake": catalog["future"],
    }
    viewer = django_user_model.objects.create_user(
        f"{model_name}-viewer",
        password="test-pass-1234",
        is_staff=True,
    )
    viewer.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="catalog",
            codename=f"view_{model_name}",
        )
    )
    client.force_login(viewer)

    response = client.get(
        reverse(f"admin:catalog_{model_name}_change", args=[objects[model_name].pk])
    )

    assert response.status_code == 200
    content = response.content.decode()
    assert 'class="cat-readonly-bar"' in content
    assert "Read-only record" in content
    assert 'class="cat-save-dock"' not in content
    assert 'name="_save"' not in content
    assert 'class="deletelink"' not in content
    if model_name == "programme":
        assert "Open provider" not in content
    elif model_name == "intake":
        assert "Open programme" not in content
        assert "Open provider" not in content

    if model_name in {"programme", "intake"}:
        provider_url = reverse(
            "admin:providers_provider_change",
            args=[catalog["provider"].pk],
        )
        list_response = client.get(reverse(f"admin:catalog_{model_name}_changelist"))
        assert list_response.status_code == 200
        assert provider_url not in list_response.content.decode()


@pytest.mark.django_db
def test_catalog_display_methods_use_only_preloaded_annotations(
    catalog, boss, django_assert_num_queries
):
    request = RequestFactory().get("/back-office/catalog/")
    request.user = boss

    trade_admin = admin.site._registry[Trade]
    with django_assert_num_queries(1):
        trades = list(trade_admin.get_queryset(request))
    with django_assert_num_queries(0):
        for trade in trades:
            trade_admin.inventory_summary(trade)
            trade_admin.search_readiness(trade)

    programme_admin = admin.site._registry[Programme]
    with django_assert_num_queries(1):
        programmes = list(programme_admin.get_queryset(request))
    with django_assert_num_queries(0):
        for programme in programmes:
            programme_admin.provider_summary(programme)
            programme_admin.offering_summary(programme)
            programme_admin.schedule_summary(programme)
            programme_admin.intake_summary(programme)
            programme_admin.demand_summary(programme)

    intake_admin = admin.site._registry[Intake]
    with django_assert_num_queries(1):
        intakes = list(intake_admin.get_queryset(request))
    with django_assert_num_queries(0):
        for intake in intakes:
            intake_admin.provider_summary(intake)
            intake_admin.lifecycle_status(intake)
            intake_admin.availability_summary(intake)
            intake_admin.demand_summary(intake)


@pytest.mark.django_db
def test_bulk_open_skips_past_and_full_intakes(client, catalog, boss):
    eligible = catalog["future"]
    past = catalog["past_open"]
    full = catalog["full_open"]
    Intake.objects.filter(pk__in=(eligible.pk, past.pk, full.pk)).update(is_open=False)

    response = client.post(
        reverse("admin:catalog_intake_changelist"),
        {
            "action": "open_intakes",
            "_selected_action": [str(eligible.pk), str(past.pk), str(full.pk)],
            "select_across": "0",
            "index": "0",
        },
        follow=True,
    )

    assert response.status_code == 200
    eligible.refresh_from_db()
    past.refresh_from_db()
    full.refresh_from_db()
    assert eligible.is_open is True
    assert past.is_open is False
    assert full.is_open is False
    messages = [str(message) for message in get_messages(response.wsgi_request)]
    assert "Opened 1 intake(s)." in messages
    assert "Skipped 2 past or full intake(s)." in messages


@pytest.mark.django_db
def test_programme_status_actions_write_the_history_trail(client, catalog, boss):
    programme = catalog["inactive_open_programme"]
    history_before = programme.history.count()

    response = client.post(
        reverse("admin:catalog_programme_changelist"),
        {
            "action": "activate_programmes",
            "_selected_action": [str(programme.pk)],
            "select_across": "0",
            "index": "0",
        },
        follow=True,
    )

    assert response.status_code == 200
    programme.refresh_from_db()
    assert programme.is_active is True
    assert programme.history.count() == history_before + 1
    latest = programme.history.latest()
    assert latest.history_user == boss
    assert latest.history_change_reason == "Activated from Catalog admin."
