"""Integration contracts for the Provider operations screens.

The custom templates deliberately sit on top of Django's admin primitives.
These tests pin both layers: the stable product hooks used by the theme and the
native DOM that Django's actions, filters, GIS, autocomplete, and inline
JavaScript require.
"""

import re
from html import unescape
from urllib.parse import parse_qs, urlsplit

import pytest
from django.contrib.auth.models import Permission
from django.contrib.gis.geos import Point
from django.contrib.staticfiles import finders
from django.templatetags.static import static
from django.urls import reverse

from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


@pytest.fixture
def provider(area):
    return Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PENDING_APPROVAL,
    )


@pytest.fixture
def boss(client, django_user_model):
    user = django_user_model.objects.create_superuser("ui-boss", password="test-pass-1234")
    client.force_login(user)
    return user


def template_names(response):
    return {template.name for template in response.templates if template.name}


@pytest.mark.django_db
def test_provider_changelist_keeps_modern_and_native_admin_contracts(client, provider, boss):
    response = client.get(reverse("admin:providers_provider_changelist"))

    assert response.status_code == 200
    assert "admin/providers/provider/change_list.html" in template_names(response)

    content = response.content.decode()
    assert 'id="content-main" class="pc-page"' in content
    assert 'aria-label="Provider work queues"' in content
    assert 'aria-label="Provider list summary"' in content

    # These are not merely styling hooks. Django 5.2's actions.js dereferences
    # each one when a result row has an action checkbox.
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

    # Keep the stock search and filter shapes so query parameters, including a
    # selected work queue, survive searches and filter changes.
    assert 'id="changelist-search"' in content
    assert 'id="searchbar"' in content
    assert 'id="changelist-filter"' in content
    assert 'aria-labelledby="changelist-filter-header"' in content
    assert "data-filter-title=" in content

    # ExportActionMixin must still wrap the custom base template and provide
    # both ways of exporting data.
    assert reverse("admin:providers_provider_export") in content
    assert 'class="export_link"' in content
    assert 'value="export_admin_action"' in content

    for asset in (
        "core/admin_provider_changelist.css",
        "core/admin_provider_changelist.js",
    ):
        assert finders.find(asset) is not None
        assert static(asset) in content

    # Selection and state must be announced in words, not only through colour.
    assert f"Select this object for an action - {provider.name}" in content
    assert "Pending approval" in content
    assert "Not visited" in content


@pytest.mark.django_db
def test_valid_work_queue_drives_context_results_and_accessible_active_state(
    client, area, provider, boss
):
    Provider.objects.create(
        name="Published Workshop",
        slug="published-workshop",
        area=area,
        location=ACCRA,
        contact_phone="+233241234568",
        status=Provider.Status.PUBLISHED,
    )

    response = client.get(
        reverse("admin:providers_provider_changelist"),
        {"queue": "awaiting_approval"},
    )

    assert response.status_code == 200
    assert response.context["provider_work_queue"].key == "awaiting_approval"
    assert response.context["cl"].result_count == 1
    assert list(response.context["cl"].result_list) == [provider]

    links = {item["key"]: item for item in response.context["provider_queue_links"]}
    assert len(links) == 9
    assert links["awaiting_approval"]["active"] is True
    assert "queue=awaiting_approval" in links["awaiting_approval"]["url"]
    assert all(not item["active"] for key, item in links.items() if key != "awaiting_approval")

    content = response.content.decode()
    assert 'class="pc-queue-link is-active"' in content
    assert 'aria-current="page"' in content
    assert "Awaiting approval" in content
    assert "Submitted listings waiting for an operations lead" in content


@pytest.mark.django_db
def test_unknown_work_queue_is_an_unfiltered_accessible_fallback(client, area, provider, boss):
    Provider.objects.create(
        name="Published Workshop",
        slug="published-workshop",
        area=area,
        location=ACCRA,
        contact_phone="+233241234568",
        status=Provider.Status.PUBLISHED,
    )

    response = client.get(
        reverse("admin:providers_provider_changelist"),
        {"queue": "not-a-real-queue"},
    )

    assert response.status_code == 200
    assert response.context["provider_work_queue"] is None
    assert response.context["cl"].result_count == 2
    assert response.context["provider_all_url"] == "?"
    assert all(not item["active"] for item in response.context["provider_queue_links"])

    content = response.content.decode()
    assert "Provider work queue" in content
    assert re.search(
        r'<a href="\?"\s+class="pc-queue-link is-active"\s+aria-current="page">',
        content,
    )
    assert "Review, verify, publish, and keep every provider listing current" in content


@pytest.mark.django_db
def test_queue_switching_and_search_preserve_deliberate_filters(client, provider, boss):
    response = client.get(
        reverse("admin:providers_provider_changelist"),
        {
            "queue": "awaiting_approval",
            "q": "Accra",
            "status__exact": Provider.Status.PENDING_APPROVAL,
        },
    )

    assert response.status_code == 200
    assert response.context["cl"].result_count == 1

    links = {item["key"]: item for item in response.context["provider_queue_links"]}
    switched = parse_qs(urlsplit(links["never_visited"]["url"]).query)
    assert switched == {
        "q": ["Accra"],
        "queue": ["never_visited"],
        "status__exact": [Provider.Status.PENDING_APPROVAL],
    }

    content = response.content.decode()
    assert '<input type="hidden" name="queue" value="awaiting_approval">' in content
    assert '<input type="hidden" name="status__exact" value="pending_approval">' in content
    export_match = re.search(r'<a href="([^"]+)" class="export_link"', content)
    assert export_match is not None
    export_params = parse_qs(urlsplit(unescape(export_match.group(1))).query)
    assert export_params == {
        "q": ["Accra"],
        "queue": ["awaiting_approval"],
        "status__exact": [Provider.Status.PENDING_APPROVAL],
    }


@pytest.mark.django_db
def test_provider_change_form_keeps_workflow_media_inlines_and_uploader_contracts(
    client, provider, boss
):
    response = client.get(reverse("admin:providers_provider_change", args=[provider.pk]))

    assert response.status_code == 200
    assert "admin/providers/provider/change_form.html" in template_names(response)

    content = response.content.decode()
    assert "provider-workflow-page--change" in content
    assert 'id="provider_form"' in content
    assert 'enctype="multipart/form-data"' in content
    assert 'id="provider-profile-heading"' in content
    assert 'id="provider-records-heading"' in content
    assert 'id="provider-photos-heading"' in content
    assert 'class="provider-save-dock"' in content
    assert 'aria-label="Provider summary"' in content

    # GIS, autocomplete, prepopulation, and Django's change-form bootstrap all
    # depend on their media and constants remaining in the inherited template.
    assert "gis/js/OLMapWidget.js" in content
    assert "admin/js/autocomplete.js" in content
    assert 'id="id_location_div_map"' in content
    assert 'id="django-admin-prepopulated-fields-constants"' in content
    assert 'id="django-admin-form-add-constants"' in content

    inline_types = {
        "verifications": "tabular",
        "government_status": "stacked",
        "evidence": "tabular",
        "subscriptions": "tabular",
    }
    for prefix, inline_type in inline_types.items():
        assert f'id="{prefix}-group"' in content
        assert f'data-inline-type="{inline_type}"' in content
        assert f'id="id_{prefix}-TOTAL_FORMS"' in content

    upload_url = reverse("admin:providers_provider_upload_photo", args=[provider.pk])
    base_url = reverse("admin:providers_provider_photos_base", args=[provider.pk])
    assert "data-photo-uploader" in content
    assert f'data-upload-url="{upload_url}"' in content
    assert f'data-base-url="{base_url}"' in content
    assert 'class="shp-input"' in content
    assert 'accept="image/*" multiple capture="environment"' in content
    assert 'aria-label="Choose workshop photographs"' in content
    assert 'class="shp-status" role="status" aria-live="polite" aria-atomic="true"' in content
    assert static("providers/photo_uploader.js") in content

    assert 'class="historylink"' in content
    assert 'name="_save"' in content
    assert 'name="_continue"' in content
    assert 'name="_addanother"' in content

    assert finders.find("core/admin_provider_form.css") is not None
    assert static("core/admin_provider_form.css") in content


@pytest.mark.django_db
def test_provider_add_form_explains_photo_lock_without_initializing_uploader(client, boss):
    response = client.get(reverse("admin:providers_provider_add"))

    assert response.status_code == 200
    content = response.content.decode()
    assert "provider-workflow-page--add" in content
    assert 'id="provider_form"' in content
    assert 'aria-label="Provider onboarding steps"' in content
    assert "shp--locked" in content
    assert "Save the provider first" in content
    assert "data-photo-uploader" not in content
    assert 'class="shp-input"' not in content
    assert static("providers/photo_uploader.js") not in content
    assert 'id="provider-photos-heading"' in content
    assert 'name="_save"' in content


@pytest.mark.django_db
def test_view_only_staff_gets_a_read_only_provider_and_no_upload_capability(
    client, django_user_model, provider
):
    viewer = django_user_model.objects.create_user(
        "provider-viewer",
        password="test-pass-1234",
        is_staff=True,
    )
    viewer.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="providers",
            codename="view_provider",
        )
    )
    client.force_login(viewer)

    response = client.get(reverse("admin:providers_provider_change", args=[provider.pk]))

    assert response.status_code == 200
    content = response.content.decode()
    assert "provider-workflow-page--change" in content
    assert "data-photo-uploader" not in content
    assert "data-upload-url" not in content
    assert "data-base-url" not in content
    assert 'class="shp-input"' not in content
    assert static("providers/photo_uploader.js") not in content
    assert 'name="_save"' not in content
    assert 'class="deletelink"' not in content
    assert 'class="provider-save-dock"' not in content

    # Hiding controls is usability, not authorization. The endpoint itself
    # remains closed when a request is forged manually.
    upload_url = reverse("admin:providers_provider_upload_photo", args=[provider.pk])
    assert client.post(upload_url, {}).status_code == 403
