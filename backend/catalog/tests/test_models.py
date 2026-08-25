"""Catalog model invariants used by every admin and API surface."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.gis.geos import Point
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from geography.models import Area, Region
from providers.models import Provider


@pytest.mark.django_db
def test_intake_places_remaining_cannot_exceed_places_offered():
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra")
    provider = Provider.objects.create(
        name="Accra Skills",
        slug="accra-skills",
        area=area,
        location=Point(-0.187, 5.604, srid=4326),
        contact_phone="+233241234567",
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    programme = Programme.objects.create(
        provider=provider,
        trade=trade,
        title="Arc welding",
        fee=Decimal("800.00"),
        duration_weeks=8,
    )
    intake = Intake(
        programme=programme,
        start_date=timezone.localdate() + timedelta(days=14),
        places_offered=12,
        places_remaining=13,
    )

    with pytest.raises(ValidationError) as error:
        intake.full_clean()

    assert error.value.message_dict["places_remaining"] == [
        "Places remaining cannot exceed places offered."
    ]


@pytest.mark.django_db
def test_database_rejects_impossible_intake_availability():
    region = Region.objects.create(name="Ashanti", slug="ashanti")
    area = Area.objects.create(region=region, name="Kumasi", slug="kumasi")
    provider = Provider.objects.create(
        name="Kumasi Skills",
        slug="kumasi-skills",
        area=area,
        location=Point(-1.624, 6.688, srid=4326),
        contact_phone="+233241234568",
    )
    trade = Trade.objects.create(name="Carpentry", slug="carpentry")
    programme = Programme.objects.create(
        provider=provider,
        trade=trade,
        title="Furniture making",
        fee=Decimal("900.00"),
        duration_weeks=10,
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        Intake.objects.create(
            programme=programme,
            start_date=timezone.localdate() + timedelta(days=21),
            places_offered=10,
            places_remaining=11,
        )
