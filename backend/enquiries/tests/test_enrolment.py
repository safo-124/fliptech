"""Tests for the leakage fix.

Section 12 accepts that most enrolments never pass through an enquiry. These
tests pin the consequence: a graduate record must be creatable without one, and
completion and attestation must not be reachable only via EnquiryOutcome.
"""

import pytest
from django.contrib.gis.geos import Point

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
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    return Programme.objects.create(
        provider=provider, trade=trade, title="Arc welding", fee=1200, duration_weeks=12
    )


@pytest.mark.django_db
def test_enrolment_records_a_graduate_who_never_filed_an_enquiry(programme):
    """The walk-in trainee. This is the majority case, per Section 12."""
    enrolment = Enrolment.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone="+233201112222",
        started_on="2026-02-01",
        completed_on="2026-05-01",
        provider_attestation=Enrolment.Attestation.RECOMMENDED,
        attested_on="2026-05-02",
    )

    assert enrolment.enquiry is None
    assert enrolment.is_graduate
    assert Enrolment.objects.filter(completed_on__isnull=False).count() == 1


@pytest.mark.django_db
def test_enrolment_links_back_to_an_enquiry_when_there_was_one(programme):
    enquiry = Enquiry.objects.create(
        provider=programme.provider, programme=programme, trainee_phone="+233201112222"
    )
    enrolment = Enrolment.objects.create(
        provider=programme.provider,
        programme=programme,
        enquiry=enquiry,
        trainee_phone="+233201112222",
        started_on="2026-02-01",
    )

    assert enquiry.enrolment == enrolment
    assert not enrolment.is_graduate


@pytest.mark.django_db
def test_enquiry_outcome_carries_no_completion_or_attestation(programme):
    """If these ever reappear here, the graduate pool silently shrinks to the
    attributed minority. That is the failure this assertion exists to catch."""
    enquiry = Enquiry.objects.create(
        provider=programme.provider, programme=programme, trainee_phone="+233201112222"
    )
    outcome = EnquiryOutcome.objects.create(enquiry=enquiry, enrolled=True)

    fields = {f.name for f in outcome._meta.get_fields()}
    assert "completed_on" not in fields
    assert "provider_attestation" not in fields


@pytest.mark.django_db
def test_reference_code_is_unambiguous_when_read_aloud(programme):
    enquiry = Enquiry.objects.create(
        provider=programme.provider, programme=programme, trainee_phone="+233201112222"
    )

    assert enquiry.reference_code.startswith("SH-")
    # No characters that are misread over a phone call.
    assert not set(enquiry.reference_code[3:]) & set("AEIOU01")


@pytest.mark.django_db
def test_intake_drives_the_starts_filter(programme):
    Intake.objects.create(programme=programme, start_date="2026-09-01", places_offered=12)
    Intake.objects.create(programme=programme, start_date="2026-11-01", places_offered=12)

    upcoming = Intake.objects.filter(start_date__gte="2026-10-01")

    assert upcoming.count() == 1
