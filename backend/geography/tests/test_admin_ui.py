"""Admin UI contracts for region launch and area search geography."""

from decimal import Decimal

import pytest
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.contrib.gis.geos import Point
from django.contrib.staticfiles import finders
from django.db import connection
from django.templatetags.static import static
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from catalog.models import Programme, Trade
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def geography_inventory(db):
    region = Region.objects.create(
        name="Greater Accra",
        slug="greater-accra",
        is_launched=True,
    )
    ready = Area.objects.create(
        region=region,
        name="Accra",
        slug="accra",
        centroid=ACCRA,
    )
    missing = Area.objects.create(
        region=region,
        name="Tema",
        slug="tema",
    )
    provider = Provider.objects.create(
        name="Accra Skills Workshop",
        slug="accra-skills-workshop",
        area=ready,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    Programme.objects.create(
        provider=provider,
        trade=trade,
        title="Arc welding",
        fee=Decimal("800.00"),
        duration_weeks=8,
    )
    return {"region": region, "ready": ready, "missing": missing}


@pytest.fixture
def boss(client, django_user_model):
    user = django_user_model.objects.create_superuser("geography-boss", password="test-pass-1234")
    client.force_login(user)
    return user


def template_names(response):
    return {template.name for template in response.templates if template.name}


def assert_native_changelist(content, *, has_filters=False):
    assert 'id="changelist"' in content
    assert 'id="changelist-form"' in content
    assert 'id="result_list"' in content
    assert 'id="changelist-search"' in content
    assert 'id="searchbar"' in content
    assert 'name="_selected_action"' in content
    if has_filters:
        assert 'id="changelist-filter"' in content
        assert 'aria-labelledby="changelist-filter-header"' in content


@pytest.mark.django_db
def test_region_changelist_is_a_native_launch_readiness_workspace(
    client, geography_inventory, boss
):
    response = client.get(reverse("admin:geography_region_changelist"))

    assert response.status_code == 200
    assert "admin/geography/region/change_list.html" in template_names(response)
    workspace = response.context["geography_workspace"]
    assert workspace["kind"] == "regions"
    assert workspace["matching"] == 1
    assert {metric["label"]: metric["value"] for metric in workspace["metrics"]} == {
        "Launched": 1,
        "Areas": 2,
        "Centroids ready": 1,
        "Published providers": 1,
    }

    content = response.content.decode()
    assert "data-geography-changelist" in content
    assert 'aria-label="Filtered geography inventory"' in content
    assert 'aria-label="Inventory readiness rule"' in content
    assert 'name="form-0-is_launched"' in content
    assert "Live · thin" in content
    assert_native_changelist(content, has_filters=True)
    for asset in ("core/admin_geography.css", "core/admin_geography.js"):
        assert finders.find(asset) is not None
        assert static(asset) in content


@pytest.mark.django_db
def test_area_changelist_explains_centroid_and_inventory_readiness(
    client, geography_inventory, boss
):
    response = client.get(reverse("admin:geography_area_changelist"))

    assert response.status_code == 200
    assert "admin/geography/area/change_list.html" in template_names(response)
    workspace = response.context["geography_workspace"]
    assert workspace["kind"] == "areas"
    assert workspace["matching"] == 2

    content = response.content.decode()
    assert "Search origin" in content
    assert "radius search blocked" in content
    assert "Thin inventory" in content
    assert "Needs centroid" in content
    assert_native_changelist(content)


@pytest.mark.django_db
def test_area_form_keeps_the_gis_widget_and_modern_workflow(client, geography_inventory, boss):
    area = geography_inventory["ready"]
    response = client.get(reverse("admin:geography_area_change", args=[area.pk]))

    assert response.status_code == 200
    assert "admin/geography/area/change_form.html" in template_names(response)
    content = response.content.decode()
    assert 'id="area_form"' in content
    assert "data-geography-form-header" in content
    assert 'id="geo-map-note-heading"' in content
    assert "Fallback search origin is ready" in content
    assert 'id="id_centroid_div_map"' in content
    assert "gis/js/OLMapWidget.js" in content
    assert 'id="django-admin-prepopulated-fields-constants"' in content
    assert 'class="geo-save-dock"' in content
    assert f"<h2>{area}</h2>" not in content
    assert 'name="_save"' in content


@pytest.mark.django_db
def test_legacy_empty_centroid_is_missing_not_ready(client, rf, geography_inventory, boss):
    empty_area = Area.objects.create(
        region=geography_inventory["region"],
        name="Legacy Empty Point",
        slug="legacy-empty-point",
        centroid=Point(srid=4326),
    )

    response = client.get(reverse("admin:geography_area_changelist"))
    metrics = {
        metric["label"]: metric["value"]
        for metric in response.context["geography_workspace"]["metrics"]
    }
    assert metrics["Centroids ready"] == 1

    request = rf.get("/")
    request.user = boss
    area_admin = admin.site._registry[Area]
    row = area_admin.get_queryset(request).get(pk=empty_area.pk)
    assert area_admin.has_centroid(row) is False
    assert "Missing" in str(area_admin.centroid_status(row))
    assert "Needs centroid" in str(area_admin.page_readiness(row))

    region_admin = admin.site._registry[Region]
    region = region_admin.get_queryset(request).get(pk=geography_inventory["region"].pk)
    assert region.admin_centroid_count == 1


@pytest.mark.django_db
def test_geography_row_summaries_do_not_issue_per_object_queries(rf, geography_inventory, boss):
    checks = (
        (
            admin.site._registry[Region],
            ("launch_readiness", "inventory_summary", "centroid_coverage"),
        ),
        (
            admin.site._registry[Area],
            ("centroid_status", "inventory_summary", "page_readiness"),
        ),
    )

    for model_admin, display_methods in checks:
        request = rf.get("/")
        request.user = boss
        with CaptureQueriesContext(connection) as queries:
            rows = list(model_admin.get_queryset(request))
            for row in rows:
                for method in display_methods:
                    str(getattr(model_admin, method)(row))
        assert len(queries) == 1


@pytest.mark.django_db
def test_view_only_region_staff_gets_no_launch_or_save_controls(
    client, django_user_model, geography_inventory
):
    viewer = django_user_model.objects.create_user(
        "geography-viewer",
        password="test-pass-1234",
        is_staff=True,
    )
    viewer.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="geography",
            codename="view_region",
        )
    )
    client.force_login(viewer)

    region = geography_inventory["region"]
    response = client.get(reverse("admin:geography_region_change", args=[region.pk]))

    assert response.status_code == 200
    content = response.content.decode()
    assert 'class="geo-readonly-bar"' in content
    assert 'name="is_launched"' not in content
    assert 'name="_save"' not in content
    assert 'class="deletelink"' not in content
