"""Tests for the super admin panel.

Each assertion checks a number the panel exists to surface, not merely that the
page renders. A dashboard that quietly reports zero is worse than no dashboard.
"""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from enquiries.models import Enquiry, EnquiryOutcome, Enrolment
from geography.models import Area, Region
from providers.models import Provider, Verification

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def world(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    trade = Trade.objects.create(name="Welding", slug="welding")
    officer = django_user_model.objects.create_user("officer")

    def provider(slug, status):
        return Provider.objects.create(
            name=slug.replace("-", " ").title(),
            slug=slug,
            area=area,
            location=ACCRA,
            contact_phone="+233241234567",
            status=status,
        )

    published = provider("published-one", Provider.Status.PUBLISHED)
    provider("draft-one", Provider.Status.DRAFT)
    provider("pending-one", Provider.Status.PENDING_APPROVAL)
    provider("pending-two", Provider.Status.PENDING_APPROVAL)

    programme = Programme.objects.create(
        provider=published, trade=trade, title="Arc welding", fee=1200, duration_weeks=12
    )
    Intake.objects.create(programme=programme, start_date=date.today() + timedelta(days=20))

    return {"published": published, "programme": programme, "officer": officer, "area": area}


def panel_for(client, django_user_model, username="boss", superuser=True):
    maker = (
        django_user_model.objects.create_superuser
        if superuser
        else django_user_model.objects.create_user
    )
    user = maker(username, password="test-pass-1234")
    if not superuser:
        user.is_staff = True
        user.save()
    client.force_login(user)
    response = client.get(reverse("admin:index"))
    return response, response.context["panel"]


@pytest.mark.django_db
def test_pipeline_counts_are_broken_out_by_status(client, django_user_model, world):
    response, panel = panel_for(client, django_user_model)

    assert response.status_code == 200
    assert panel["pipeline"]["pending"] == 2
    assert panel["pipeline"]["draft"] == 1
    assert panel["pipeline"]["published"] == 1


@pytest.mark.django_db
def test_a_published_provider_with_no_site_visit_is_surfaced(client, django_user_model, world):
    """Section 12 calls verification the cap on honest growth."""
    _, panel = panel_for(client, django_user_model)

    assert panel["verification"]["never_visited"] == 1

    Verification.objects.create(
        provider=world["published"],
        visited_on=date.today(),
        officer=world["officer"],
        checks_performed="Saw the workshop.",
        outcome=Verification.Outcome.PASSED,
    )
    _, panel = panel_for(client, django_user_model, username="boss2")

    assert panel["verification"]["never_visited"] == 0


@pytest.mark.django_db
def test_an_old_visit_is_flagged_for_revisit(client, django_user_model, world):
    Verification.objects.create(
        provider=world["published"],
        visited_on=date.today() - timedelta(days=400),
        officer=world["officer"],
        checks_performed="Saw the workshop.",
        outcome=Verification.Outcome.PASSED,
    )
    _, panel = panel_for(client, django_user_model)

    assert panel["verification"]["due_revisit"] == 1


@pytest.mark.django_db
def test_an_unconfirmed_listing_counts_as_stale(client, django_user_model, world):
    _, panel = panel_for(client, django_user_model)
    assert panel["freshness"]["shown_as_stale"] == 1

    world["published"].last_confirmed_at = timezone.now()
    world["published"].save()
    _, panel = panel_for(client, django_user_model, username="boss2")

    assert panel["freshness"]["shown_as_stale"] == 0


@pytest.mark.django_db
def test_leakage_is_measured_rather_than_assumed(client, django_user_model, world):
    """Two enrolments, one of which came through an enquiry."""
    enquiry = Enquiry.objects.create(
        provider=world["published"], programme=world["programme"], trainee_phone="+233201112222"
    )
    Enrolment.objects.create(
        provider=world["published"],
        programme=world["programme"],
        enquiry=enquiry,
        trainee_phone="+233201112222",
        started_on=date.today(),
    )
    Enrolment.objects.create(
        provider=world["published"],
        programme=world["programme"],
        trainee_phone="+233203334444",
        started_on=date.today(),
    )

    _, panel = panel_for(client, django_user_model)

    assert panel["leakage"]["total"] == 2
    assert panel["leakage"]["attributed"] == 1
    assert panel["leakage"]["attributed_pct"] == 50


@pytest.mark.django_db
def test_response_rate_only_counts_replies_inside_the_window(client, django_user_model, world):
    quick = Enquiry.objects.create(
        provider=world["published"], programme=world["programme"], trainee_phone="+233201112222"
    )
    slow = Enquiry.objects.create(
        provider=world["published"], programme=world["programme"], trainee_phone="+233203334444"
    )
    EnquiryOutcome.objects.create(
        enquiry=quick, replied=True, replied_at=quick.created_at + timedelta(hours=2)
    )
    EnquiryOutcome.objects.create(
        enquiry=slow, replied=True, replied_at=slow.created_at + timedelta(hours=72)
    )

    _, panel = panel_for(client, django_user_model)

    assert panel["demand"]["enquiries_30"] == 2
    assert panel["demand"]["replied_in_window"] == 1
    assert panel["demand"]["response_rate"] == 50


@pytest.mark.django_db
def test_attestation_inflation_is_visible(client, django_user_model, world):
    """A workshop that recommends everyone makes the signal worthless."""
    for phone in ("+233201110001", "+233201110002", "+233201110003"):
        Enrolment.objects.create(
            provider=world["published"],
            programme=world["programme"],
            trainee_phone=phone,
            started_on=date.today() - timedelta(days=100),
            completed_on=date.today() - timedelta(days=1),
            provider_attestation=Enrolment.Attestation.RECOMMENDED,
        )

    _, panel = panel_for(client, django_user_model)

    assert panel["year_two"]["completions"] == 3
    assert panel["year_two"]["attested"] == 3
    assert panel["year_two"]["attestation_rate"] == 100


@pytest.mark.django_db
def test_listing_quality_flags_a_published_provider_with_no_photo(client, django_user_model, world):
    _, panel = panel_for(client, django_user_model)

    assert panel["quality"]["no_photo"] == 1
    assert panel["quality"]["no_government_record"] == 1
    assert panel["quality"]["no_programme"] == 0  # it has one


@pytest.mark.django_db
def test_coverage_counts_only_combinations_above_the_threshold(client, django_user_model, world):
    """One provider in the only trade/area pair is below the threshold of 3."""
    _, panel = panel_for(client, django_user_model)

    assert panel["coverage"]["total"] == 1
    assert panel["coverage"]["indexable"] == 0
    assert panel["coverage"]["threshold"] == 3


@pytest.mark.django_db
def test_revenue_is_superuser_only(client, django_user_model, world):
    """Staff see the operational panels; money is restricted."""
    _, staff_panel = panel_for(client, django_user_model, username="staff", superuser=False)
    assert "revenue" not in staff_panel
    assert staff_panel["pipeline"]["pending"] == 2

    _, super_panel = panel_for(client, django_user_model, username="boss", superuser=True)
    assert "revenue" in super_panel
