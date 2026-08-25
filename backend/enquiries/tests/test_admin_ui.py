"""Admin UI contracts for enquiry follow-up and monthly enrolment reporting."""

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth.models import Permission
from django.contrib.gis.geos import Point
from django.contrib.staticfiles import finders
from django.templatetags.static import static
from django.urls import reverse
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from enquiries.models import Enquiry, EnquiryOutcome, Enrolment
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def programme(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    provider = Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    return Programme.objects.create(
        provider=provider,
        trade=trade,
        title="Arc welding",
        fee=Decimal("1200.00"),
        duration_weeks=12,
    )


@pytest.fixture
def intake(programme):
    return Intake.objects.create(
        programme=programme,
        start_date=date(2026, 9, 1),
        places_offered=16,
    )


@pytest.fixture
def enquiry(programme, intake):
    return Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        intake=intake,
        trainee_phone="+233201112222",
        trainee_name="Ama Boateng",
        message="Can I join the September intake?",
        state=Enquiry.State.SENT,
        phone_verified_at=timezone.now(),
    )


@pytest.fixture
def enrolments(programme, intake, enquiry):
    attributed = Enrolment.objects.create(
        provider=programme.provider,
        programme=programme,
        intake=intake,
        enquiry=enquiry,
        trainee_phone=enquiry.trainee_phone,
        trainee_name=enquiry.trainee_name,
        started_on=date(2026, 9, 1),
        fee_paid=Decimal("1200.00"),
        completed_on=date(2026, 12, 1),
        provider_attestation=Enrolment.Attestation.RECOMMENDED,
        attested_on=date(2026, 12, 2),
    )
    direct = Enrolment.objects.create(
        provider=programme.provider,
        programme=programme,
        intake=intake,
        trainee_phone="+233201113333",
        trainee_name="Direct Trainee",
        started_on=date(2026, 10, 1),
    )
    return attributed, direct


@pytest.fixture
def boss(client, django_user_model):
    user = django_user_model.objects.create_superuser("outcomes-boss", password="test-pass-1234")
    client.force_login(user)
    return user


def template_names(response):
    return {template.name for template in response.templates if template.name}


def assert_native_changelist_contract(content):
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


@pytest.mark.django_db
def test_enquiry_changelist_is_an_accessible_native_operations_inbox(client, enquiry, boss):
    response = client.get(reverse("admin:enquiries_enquiry_changelist"))

    assert response.status_code == 200
    assert "admin/enquiries/enquiry/change_list.html" in template_names(response)
    assert response.context["enquiry_workbench"]["total"] == 1

    content = response.content.decode()
    assert "data-enquiry-workbench" in content
    assert 'aria-label="Enquiry work queues"' in content
    assert 'aria-label="Enquiry list summary"' in content
    assert_native_changelist_contract(content)
    assert "eq-state--info" in content
    assert "eq-outcome--warning" in content
    assert 'class="eq-age eq-age--warning"' in content
    assert 'title="Received ' in content

    for asset in ("core/admin_enquiry.css", "core/admin_enquiry.js"):
        assert finders.find(asset) is not None
        assert static(asset) in content


@pytest.mark.django_db
def test_enquiry_queue_context_matches_results_and_unknown_values_fall_back(client, enquiry, boss):
    changelist = reverse("admin:enquiries_enquiry_changelist")
    queued = client.get(changelist, {"queue": "sent_awaiting_reply"})

    assert queued.status_code == 200
    assert queued.context["enquiry_work_queue"].key == "sent_awaiting_reply"
    assert queued.context["cl"].result_count == 1
    links = {item["key"]: item for item in queued.context["enquiry_queue_links"]}
    assert links["sent_awaiting_reply"]["active"] is True
    assert 'class="eq-queue-link eq-queue-link--info is-active"' in queued.content.decode()
    assert 'aria-current="page"' in queued.content.decode()

    unknown = client.get(changelist, {"queue": "not-a-real-queue"})
    assert unknown.status_code == 200
    assert unknown.context["enquiry_work_queue"] is None
    assert unknown.context["cl"].result_count == 1
    assert all(not item["active"] for item in unknown.context["enquiry_queue_links"])


@pytest.mark.django_db
def test_enquiry_change_form_separates_locked_source_and_human_outcome(client, enquiry, boss):
    response = client.get(reverse("admin:enquiries_enquiry_change", args=[enquiry.pk]))

    assert response.status_code == 200
    assert "admin/enquiries/enquiry/change_form.html" in template_names(response)
    content = response.content.decode()
    assert 'id="enquiry_form"' in content
    assert "data-enquiry-form-header" in content
    assert "data-enquiry-lifecycle" in content
    assert "data-enquiry-source" in content
    assert "data-enquiry-outcome" in content
    assert 'aria-label="Enquiry summary"' in content
    assert 'id="eq-routing-heading"' in content
    assert 'id="eq-outcome-heading"' in content
    assert 'id="outcome-group"' in content
    assert 'id="id_outcome-TOTAL_FORMS"' in content
    assert 'data-inline-type="stacked"' in content
    assert "Can I join the September intake?" in content
    assert f"<h2>{enquiry}</h2>" not in content
    assert 'name="_save"' in content
    assert 'id="django-admin-form-add-constants"' in content

    # Enquiries originate in the public journey and cannot be manufactured in
    # the back office.
    assert client.get(reverse("admin:enquiries_enquiry_add")).status_code == 403


@pytest.mark.django_db
def test_saving_a_human_outcome_records_the_staff_member_and_reply_time(client, enquiry, boss):
    response = client.post(
        reverse("admin:enquiries_enquiry_change", args=[enquiry.pk]),
        {
            "state": Enquiry.State.SENT,
            "outcome-TOTAL_FORMS": "1",
            "outcome-INITIAL_FORMS": "0",
            "outcome-MIN_NUM_FORMS": "0",
            "outcome-MAX_NUM_FORMS": "1",
            "outcome-0-id": "",
            "outcome-0-enquiry": str(enquiry.pk),
            "outcome-0-replied": "on",
            "outcome-0-note": "Provider confirmed a WhatsApp reply.",
            "_save": "Save",
        },
    )

    assert response.status_code == 302
    outcome = EnquiryOutcome.objects.get(enquiry=enquiry)
    assert outcome.replied is True
    assert outcome.replied_at is not None
    assert outcome.recorded_by == boss


@pytest.mark.django_db
def test_spam_restore_returns_each_enquiry_to_its_honest_workflow_state(
    client, programme, enquiry, boss
):
    unverified = Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone="+233201114444",
        state=Enquiry.State.PENDING_VERIFICATION,
    )
    changelist = reverse("admin:enquiries_enquiry_changelist")
    selected = [str(enquiry.pk), str(unverified.pk)]

    response = client.post(
        changelist,
        {
            "action": "mark_as_spam",
            "_selected_action": selected,
            "select_across": "0",
            "index": "0",
        },
    )
    assert response.status_code == 302
    assert set(
        Enquiry.objects.filter(pk__in=(enquiry.pk, unverified.pk)).values_list("state", flat=True)
    ) == {Enquiry.State.SPAM}

    response = client.post(
        changelist,
        {
            "action": "restore_spam_to_workflow",
            "_selected_action": selected,
            "select_across": "0",
            "index": "0",
        },
    )
    assert response.status_code == 302
    enquiry.refresh_from_db()
    unverified.refresh_from_db()
    assert enquiry.state == Enquiry.State.SENT
    assert unverified.state == Enquiry.State.PENDING_VERIFICATION


@pytest.mark.django_db
def test_view_only_staff_can_review_an_enquiry_but_cannot_record_an_outcome(
    client, django_user_model, enquiry
):
    viewer = django_user_model.objects.create_user(
        "enquiry-viewer",
        password="test-pass-1234",
        is_staff=True,
    )
    viewer.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="enquiries",
            codename="view_enquiry",
        )
    )
    client.force_login(viewer)

    response = client.get(reverse("admin:enquiries_enquiry_change", args=[enquiry.pk]))

    assert response.status_code == 200
    content = response.content.decode()
    assert 'class="eq-readonly-bar"' in content
    assert 'name="_save"' not in content
    assert 'name="outcome-0-replied"' not in content
    assert 'class="deletelink"' not in content


@pytest.mark.django_db
def test_enrolment_changelist_reports_outcomes_fees_and_native_export(client, enrolments, boss):
    response = client.get(reverse("admin:enquiries_enrolment_changelist"))

    assert response.status_code == 200
    assert "admin/enquiries/enrolment/change_list.html" in template_names(response)
    summary = response.context["enrolment_summary"]
    assert response.context["enrollment_summary"] is summary
    assert summary == {
        "completed": 1,
        "attested": 1,
        "platform": 1,
        "fee_total": Decimal("1200.00"),
        "matching": 2,
        "total": 2,
    }
    assert response.context["enrolment_reset_url"] == "?"

    content = response.content.decode()
    assert "data-enrolment-changelist" in content
    assert 'aria-label="Enrolment reporting summary"' in content
    assert 'id="er-monthly-note-heading"' in content
    assert_native_changelist_contract(content)
    assert reverse("admin:enquiries_enrolment_export") in content
    assert 'class="export_link"' in content
    assert 'value="export_admin_action"' in content
    assert "er-status--positive" in content
    assert "er-status--warning" in content
    assert "er-attestation--positive" in content
    assert "er-attestation--warning" in content
    assert "er-source--positive" in content
    assert "er-source--neutral" in content
    assert "er-fee--positive" in content
    assert "er-fee--neutral" in content

    for asset in ("core/admin_enrolment.css", "core/admin_enrolment.js"):
        assert finders.find(asset) is not None
        assert static(asset) in content


@pytest.mark.django_db
def test_filtered_enrolment_summary_distinguishes_zero_fees_from_missing_data(
    client, enrolments, boss
):
    response = client.get(
        reverse("admin:enquiries_enrolment_changelist"),
        {"q": "Direct Trainee"},
    )

    assert response.status_code == 200
    summary = response.context["enrolment_summary"]
    assert summary["matching"] == 1
    assert summary["total"] == 2
    assert summary["fee_total"] == Decimal("0.00")
    assert response.context["enrolment_reset_url"] == "?"
    content = response.content.decode()
    assert "GH₵0" in content
    assert f'href="{response.context["enrolment_reset_url"]}"' in content


@pytest.mark.django_db
def test_enrolment_change_and_add_forms_keep_native_fields_and_live_signals(
    client, enrolments, boss
):
    attributed, _ = enrolments
    change = client.get(reverse("admin:enquiries_enrolment_change", args=[attributed.pk]))

    assert change.status_code == 200
    assert "admin/enquiries/enrolment/change_form.html" in template_names(change)
    content = change.content.decode()
    assert "enrolment-reporting-page--change" in content
    assert 'id="enrolment_form"' in content
    assert 'aria-label="Enrolment summary"' in content
    assert 'aria-label="Enrolment status"' in content
    assert 'id="er-record-fields-heading"' in content
    assert "data-enrolment-form-signals" in content
    assert 'id="er-completion-live" role="status" aria-live="polite"' in content
    assert 'id="er-attestation-live" role="status" aria-live="polite"' in content
    assert 'id="er-source-live" role="status" aria-live="polite"' in content
    assert 'class="er-save-dock"' in content
    assert 'aria-label="Save enrolment"' in content
    assert 'name="_save"' in content
    assert 'name="_continue"' in content
    assert 'name="_addanother"' in content
    assert "admin/js/autocomplete.js" in content
    assert 'id="django-admin-form-add-constants"' in content
    assert f"<h2>{attributed}</h2>" not in content
    assert static("core/admin_enrolment.css") in content
    assert static("core/admin_enrolment.js") in content

    add = client.get(reverse("admin:enquiries_enrolment_add"))
    assert add.status_code == 200
    add_content = add.content.decode()
    assert "enrolment-reporting-page--add" in add_content
    assert 'aria-label="Monthly reporting steps"' in add_content
    assert "Record every trainee the provider reports" in add_content
    assert 'class="er-save-dock"' in add_content


@pytest.mark.django_db
def test_view_only_staff_sees_enrolment_signals_without_a_save_dock(
    client, django_user_model, enrolments
):
    attributed, _ = enrolments
    viewer = django_user_model.objects.create_user(
        "enrolment-viewer",
        password="test-pass-1234",
        is_staff=True,
    )
    viewer.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="enquiries",
            codename="view_enrolment",
        )
    )
    client.force_login(viewer)

    response = client.get(reverse("admin:enquiries_enrolment_change", args=[attributed.pk]))

    assert response.status_code == 200
    content = response.content.decode()
    assert "data-enrolment-form-signals" in content
    assert 'class="er-save-dock"' not in content
    assert 'name="_save"' not in content
    assert 'class="deletelink"' not in content
