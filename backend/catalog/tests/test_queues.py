from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from catalog.models import Intake, Programme, Trade
from catalog.queues import (
    INTAKE_ALL,
    INTAKE_QUEUES,
    INTAKE_QUEUES_BY_KEY,
    INTAKE_WORKBENCH_QUEUES,
    PROGRAMME_ALL,
    PROGRAMME_QUEUES,
    PROGRAMME_QUEUES_BY_KEY,
    PROGRAMME_WORKBENCH_QUEUES,
    TRADE_ALL,
    TRADE_QUEUES,
    TRADE_QUEUES_BY_KEY,
    TRADE_WORKBENCH_QUEUES,
    intake_counts,
    programme_counts,
    trade_counts,
)
from geography.models import Area, Region
from providers.models import Provider


@pytest.fixture
def provider(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(
        region=region,
        name="Accra",
        slug="accra",
        centroid=Point(-0.1870, 5.6037, srid=4326),
    )
    return Provider.objects.create(
        name="Accra Skills Centre",
        slug="accra-skills-centre",
        area=area,
        location=area.centroid,
        contact_phone="+233241234567",
    )


def make_trade(name: str, **overrides) -> Trade:
    values = {
        "name": name,
        "slug": name.lower().replace(" ", "-"),
        "description": f"Learn {name.lower()}.",
        "synonyms": [f"{name.lower()} work"],
        "is_active": True,
    }
    values.update(overrides)
    return Trade.objects.create(**values)


def make_programme(provider: Provider, trade: Trade, title: str, **overrides) -> Programme:
    values = {
        "provider": provider,
        "trade": trade,
        "title": title,
        "fee": "1200.00",
        "duration_weeks": 12,
        "weekly_schedule": "Monday to Thursday",
        "capacity": 20,
        "is_active": True,
    }
    values.update(overrides)
    return Programme.objects.create(**values)


def make_intake(programme: Programme, days: int, **overrides) -> Intake:
    values = {
        "programme": programme,
        "start_date": timezone.localdate() + timedelta(days=days),
        "places_offered": 20,
        "places_remaining": 10,
        "is_open": True,
    }
    values.update(overrides)
    return Intake.objects.create(**values)


def ids(queue, queryset):
    return set(queue.narrow(queryset).values_list("pk", flat=True))


def expected_counts(all_queue, queues, queryset):
    return {
        all_queue.key: queryset.order_by().values("pk").distinct().count(),
        **{queue.key: queue.count(queryset) for queue in queues},
    }


def test_queue_metadata_contracts_are_complete_and_ordered():
    assert (PROGRAMME_ALL, *PROGRAMME_QUEUES) == PROGRAMME_WORKBENCH_QUEUES
    assert (INTAKE_ALL, *INTAKE_QUEUES) == INTAKE_WORKBENCH_QUEUES
    assert (TRADE_ALL, *TRADE_QUEUES) == TRADE_WORKBENCH_QUEUES

    assert tuple(PROGRAMME_QUEUES_BY_KEY) == tuple(queue.key for queue in PROGRAMME_QUEUES)
    assert tuple(INTAKE_QUEUES_BY_KEY) == tuple(queue.key for queue in INTAKE_QUEUES)
    assert tuple(TRADE_QUEUES_BY_KEY) == tuple(queue.key for queue in TRADE_QUEUES)

    assert tuple(PROGRAMME_QUEUES_BY_KEY) == (
        "active_no_future_intake",
        "missing_schedule",
        "missing_capacity",
        "instalment_details_missing",
        "inactive_with_open_intake",
    )
    assert tuple(INTAKE_QUEUES_BY_KEY) == (
        "upcoming_open",
        "starting_soon",
        "past_open",
        "full_open",
        "availability_missing",
    )
    assert tuple(TRADE_QUEUES_BY_KEY) == (
        "active_without_active_programme",
        "missing_description",
        "missing_synonyms",
        "inactive_with_active_programme",
    )


@pytest.mark.django_db
def test_programme_queues_handle_dates_contradictions_and_related_rows(
    provider, django_assert_num_queries
):
    trade = make_trade("Carpentry")

    no_intake = make_programme(provider, trade, "No intake")
    split_intakes = make_programme(provider, trade, "Split intake states")
    make_intake(split_intakes, -1)
    make_intake(split_intakes, 7, is_open=False)

    future_open = make_programme(provider, trade, "Future intake")
    make_intake(future_open, 0)
    make_intake(future_open, 7)

    missing_timetable = make_programme(provider, trade, "Missing timetable", weekly_schedule="")
    make_intake(missing_timetable, 4)
    missing_seats = make_programme(provider, trade, "Missing capacity", capacity=None)
    make_intake(missing_seats, 5)
    missing_payment_note = make_programme(
        provider,
        trade,
        "Missing instalment note",
        instalments_allowed=True,
        instalment_note="",
    )
    make_intake(missing_payment_note, 6)
    complete_payment_note = make_programme(
        provider,
        trade,
        "Complete instalment note",
        instalments_allowed=True,
        instalment_note="Half before classes begin",
    )
    make_intake(complete_payment_note, 8)

    inactive_open = make_programme(provider, trade, "Inactive and open", is_active=False)
    make_intake(inactive_open, -3)
    make_intake(inactive_open, 9)

    base = Programme.objects.all()
    assert ids(PROGRAMME_QUEUES_BY_KEY["active_no_future_intake"], base) == {
        no_intake.pk,
        split_intakes.pk,
    }
    assert ids(PROGRAMME_QUEUES_BY_KEY["missing_schedule"], base) == {missing_timetable.pk}
    assert ids(PROGRAMME_QUEUES_BY_KEY["missing_capacity"], base) == {missing_seats.pk}
    assert ids(PROGRAMME_QUEUES_BY_KEY["instalment_details_missing"], base) == {
        missing_payment_note.pk
    }
    assert ids(PROGRAMME_QUEUES_BY_KEY["inactive_with_open_intake"], base) == {inactive_open.pk}

    # A joined base queryset contains repeated programme rows. Queue narrowing
    # and the aggregate helper must still agree on distinct model records.
    joined_base = Programme.objects.filter(intakes__isnull=False)
    expected = expected_counts(PROGRAMME_ALL, PROGRAMME_QUEUES, joined_base)
    with django_assert_num_queries(1):
        actual = programme_counts(joined_base)
    assert actual == expected


@pytest.mark.django_db
def test_intake_queues_use_inclusive_boundaries_and_exact_availability_rules(
    provider, django_assert_num_queries
):
    trade = make_trade("Welding")
    programme = make_programme(provider, trade, "Practical welding")

    today = make_intake(programme, 0)
    day_14 = make_intake(programme, 14)
    day_15 = make_intake(programme, 15)
    past = make_intake(programme, -1)
    closed = make_intake(programme, 3, is_open=False)

    full_future = make_intake(programme, 16, places_remaining=0)
    full_past = make_intake(programme, -2, places_remaining=0)
    missing_future = make_intake(programme, 17, places_remaining=None)
    missing_past = make_intake(programme, -3, places_remaining=None)

    base = Intake.objects.all()
    assert ids(INTAKE_QUEUES_BY_KEY["upcoming_open"], base) == {
        today.pk,
        day_14.pk,
        day_15.pk,
        full_future.pk,
        missing_future.pk,
    }
    assert ids(INTAKE_QUEUES_BY_KEY["starting_soon"], base) == {today.pk, day_14.pk}
    assert ids(INTAKE_QUEUES_BY_KEY["past_open"], base) == {
        past.pk,
        full_past.pk,
        missing_past.pk,
    }
    assert ids(INTAKE_QUEUES_BY_KEY["full_open"], base) == {full_future.pk, full_past.pk}
    assert ids(INTAKE_QUEUES_BY_KEY["availability_missing"], base) == {missing_future.pk}
    assert closed.pk not in set().union(*(ids(queue, base) for queue in INTAKE_QUEUES))

    expected = expected_counts(INTAKE_ALL, INTAKE_QUEUES, base)
    with django_assert_num_queries(1):
        actual = intake_counts(base)
    assert actual == expected


@pytest.mark.django_db
def test_trade_queues_are_distinct_across_multiple_programmes(provider, django_assert_num_queries):
    unused = make_trade("Masonry")

    inactive_programmes_only = make_trade("Plumbing")
    make_programme(provider, inactive_programmes_only, "Old plumbing", is_active=False)

    offered = make_trade("Tailoring")
    make_programme(provider, offered, "Dressmaking")
    make_programme(provider, offered, "Industrial sewing")

    incomplete = make_trade("Electrical", description="", synonyms=[])
    make_programme(provider, incomplete, "Domestic electrical")

    inactive_but_offered = make_trade("Painting", is_active=False)
    make_programme(provider, inactive_but_offered, "Decorative painting")
    make_programme(provider, inactive_but_offered, "Spray painting")

    base = Trade.objects.all()
    assert ids(TRADE_QUEUES_BY_KEY["active_without_active_programme"], base) == {
        unused.pk,
        inactive_programmes_only.pk,
    }
    assert ids(TRADE_QUEUES_BY_KEY["missing_description"], base) == {incomplete.pk}
    assert ids(TRADE_QUEUES_BY_KEY["missing_synonyms"], base) == {incomplete.pk}
    assert ids(TRADE_QUEUES_BY_KEY["inactive_with_active_programme"], base) == {
        inactive_but_offered.pk
    }

    joined_base = Trade.objects.filter(programmes__isnull=False)
    expected = expected_counts(TRADE_ALL, TRADE_QUEUES, joined_base)
    with django_assert_num_queries(1):
        actual = trade_counts(joined_base)
    assert actual == expected
