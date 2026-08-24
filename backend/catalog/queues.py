"""Operational work queues for trades, programmes, and intakes.

The catalog admin renders overlapping views of the same inventory: readiness
problems, contradictory states, and time-sensitive intake windows.  Keeping
the predicates and labels here means a workbench count and the changelist it
opens cannot drift apart.

Date-based predicates deliberately call ``timezone.localdate()`` when they are
used, rather than at module import time.  A long-running Django process will
therefore roll its queues over at midnight without needing a restart.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from django.db.models import Count, Exists, OuterRef, Q, QuerySet
from django.utils import timezone


@dataclass(frozen=True, slots=True)
class CatalogQueue:
    """Metadata and the canonical queryset predicate for one work queue."""

    key: str
    label: str
    description: str
    tone: str
    narrower: Callable[[QuerySet], QuerySet]

    def narrow(self, queryset: QuerySet) -> QuerySet:
        return self.narrower(queryset)

    def count(self, queryset: QuerySet) -> int:
        return self.narrow(queryset).count()


def _all(queryset: QuerySet) -> QuerySet:
    return queryset


# Programme predicates -----------------------------------------------------


def _future_open_intakes():
    from .models import Intake

    return Intake.objects.filter(
        programme_id=OuterRef("pk"),
        is_open=True,
        start_date__gte=timezone.localdate(),
    )


def _open_intakes():
    from .models import Intake

    return Intake.objects.filter(programme_id=OuterRef("pk"), is_open=True)


def active_no_future_intake(queryset: QuerySet) -> QuerySet:
    """Active programmes with no open intake today or later."""
    return queryset.filter(is_active=True).filter(~Exists(_future_open_intakes())).distinct()


def missing_schedule(queryset: QuerySet) -> QuerySet:
    return queryset.filter(weekly_schedule="").distinct()


def missing_capacity(queryset: QuerySet) -> QuerySet:
    return queryset.filter(capacity__isnull=True).distinct()


def instalment_details_missing(queryset: QuerySet) -> QuerySet:
    return queryset.filter(instalments_allowed=True, instalment_note="").distinct()


def inactive_with_open_intake(queryset: QuerySet) -> QuerySet:
    """Inactive programmes that still advertise any intake as open."""
    return queryset.filter(is_active=False).filter(Exists(_open_intakes())).distinct()


PROGRAMME_ALL = CatalogQueue(
    "all",
    "All programmes",
    "Every programme in the catalog, including inactive records.",
    "neutral",
    _all,
)

PROGRAMME_QUEUES: tuple[CatalogQueue, ...] = (
    CatalogQueue(
        "active_no_future_intake",
        "No future intake",
        "Active programmes with no open intake scheduled for today or later.",
        "attention",
        active_no_future_intake,
    ),
    CatalogQueue(
        "missing_schedule",
        "Schedule missing",
        "Programmes whose weekly timetable has not been recorded.",
        "warning",
        missing_schedule,
    ),
    CatalogQueue(
        "missing_capacity",
        "Capacity missing",
        "Programmes whose teaching capacity has not been recorded.",
        "warning",
        missing_capacity,
    ),
    CatalogQueue(
        "instalment_details_missing",
        "Instalment details missing",
        "Programmes allowing instalments without explaining the payment arrangement.",
        "warning",
        instalment_details_missing,
    ),
    CatalogQueue(
        "inactive_with_open_intake",
        "Inactive with an open intake",
        "Inactive programmes that still have at least one intake marked open.",
        "attention",
        inactive_with_open_intake,
    ),
)

PROGRAMME_WORKBENCH_QUEUES: tuple[CatalogQueue, ...] = (PROGRAMME_ALL, *PROGRAMME_QUEUES)
PROGRAMME_QUEUES_BY_KEY: dict[str, CatalogQueue] = {queue.key: queue for queue in PROGRAMME_QUEUES}


def programme_counts(queryset: QuerySet) -> dict[str, int]:
    """Return every programme workbench count in one exact aggregate query."""
    annotated = queryset.order_by().annotate(
        _catalog_queue_has_future_open_intake=Exists(_future_open_intakes()),
        _catalog_queue_has_open_intake=Exists(_open_intakes()),
    )
    return annotated.aggregate(
        all=Count("pk", distinct=True),
        active_no_future_intake=Count(
            "pk",
            filter=Q(is_active=True, _catalog_queue_has_future_open_intake=False),
            distinct=True,
        ),
        missing_schedule=Count("pk", filter=Q(weekly_schedule=""), distinct=True),
        missing_capacity=Count("pk", filter=Q(capacity__isnull=True), distinct=True),
        instalment_details_missing=Count(
            "pk",
            filter=Q(instalments_allowed=True, instalment_note=""),
            distinct=True,
        ),
        inactive_with_open_intake=Count(
            "pk",
            filter=Q(is_active=False, _catalog_queue_has_open_intake=True),
            distinct=True,
        ),
    )


# Intake predicates --------------------------------------------------------


def upcoming_open(queryset: QuerySet) -> QuerySet:
    return queryset.filter(is_open=True, start_date__gte=timezone.localdate()).distinct()


def starting_soon(queryset: QuerySet) -> QuerySet:
    today = timezone.localdate()
    return queryset.filter(
        is_open=True,
        start_date__range=(today, today + timedelta(days=14)),
    ).distinct()


def past_open(queryset: QuerySet) -> QuerySet:
    return queryset.filter(is_open=True, start_date__lt=timezone.localdate()).distinct()


def full_open(queryset: QuerySet) -> QuerySet:
    return queryset.filter(is_open=True, places_remaining=0).distinct()


def availability_missing(queryset: QuerySet) -> QuerySet:
    return queryset.filter(
        is_open=True,
        start_date__gte=timezone.localdate(),
        places_remaining__isnull=True,
    ).distinct()


INTAKE_ALL = CatalogQueue(
    "all",
    "All intakes",
    "Every dated intake, including closed and historical records.",
    "neutral",
    _all,
)

INTAKE_QUEUES: tuple[CatalogQueue, ...] = (
    CatalogQueue(
        "upcoming_open",
        "Upcoming and open",
        "Open intakes starting today or later.",
        "positive",
        upcoming_open,
    ),
    CatalogQueue(
        "starting_soon",
        "Starting within 14 days",
        "Open intakes starting from today through the next 14 days, inclusive.",
        "info",
        starting_soon,
    ),
    CatalogQueue(
        "past_open",
        "Past but still open",
        "Intakes whose start date has passed but are still marked open.",
        "attention",
        past_open,
    ),
    CatalogQueue(
        "full_open",
        "Full but still open",
        "Open intakes reporting that no places remain.",
        "attention",
        full_open,
    ),
    CatalogQueue(
        "availability_missing",
        "Availability missing",
        "Upcoming open intakes whose remaining places have not been recorded.",
        "warning",
        availability_missing,
    ),
)

INTAKE_WORKBENCH_QUEUES: tuple[CatalogQueue, ...] = (INTAKE_ALL, *INTAKE_QUEUES)
INTAKE_QUEUES_BY_KEY: dict[str, CatalogQueue] = {queue.key: queue for queue in INTAKE_QUEUES}


def intake_counts(queryset: QuerySet) -> dict[str, int]:
    """Return every intake workbench count in one aggregate query."""
    today = timezone.localdate()
    soon_cutoff = today + timedelta(days=14)
    return queryset.order_by().aggregate(
        all=Count("pk", distinct=True),
        upcoming_open=Count("pk", filter=Q(is_open=True, start_date__gte=today), distinct=True),
        starting_soon=Count(
            "pk",
            filter=Q(is_open=True, start_date__range=(today, soon_cutoff)),
            distinct=True,
        ),
        past_open=Count("pk", filter=Q(is_open=True, start_date__lt=today), distinct=True),
        full_open=Count("pk", filter=Q(is_open=True, places_remaining=0), distinct=True),
        availability_missing=Count(
            "pk",
            filter=Q(
                is_open=True,
                start_date__gte=today,
                places_remaining__isnull=True,
            ),
            distinct=True,
        ),
    )


# Trade predicates ---------------------------------------------------------


def _active_programmes():
    from .models import Programme

    return Programme.objects.filter(trade_id=OuterRef("pk"), is_active=True)


def active_without_active_programme(queryset: QuerySet) -> QuerySet:
    return queryset.filter(is_active=True).filter(~Exists(_active_programmes())).distinct()


def missing_description(queryset: QuerySet) -> QuerySet:
    return queryset.filter(description="").distinct()


def missing_synonyms(queryset: QuerySet) -> QuerySet:
    return queryset.filter(synonyms=[]).distinct()


def inactive_with_active_programme(queryset: QuerySet) -> QuerySet:
    return queryset.filter(is_active=False).filter(Exists(_active_programmes())).distinct()


TRADE_ALL = CatalogQueue(
    "all",
    "All trades",
    "Every trade in the catalog, including inactive records.",
    "neutral",
    _all,
)

TRADE_QUEUES: tuple[CatalogQueue, ...] = (
    CatalogQueue(
        "active_without_active_programme",
        "No active programme",
        "Active trades not offered by any active programme.",
        "attention",
        active_without_active_programme,
    ),
    CatalogQueue(
        "missing_description",
        "Description missing",
        "Trades without copy for their public explainer page.",
        "warning",
        missing_description,
    ),
    CatalogQueue(
        "missing_synonyms",
        "Search synonyms missing",
        "Trades without alternative search terms.",
        "warning",
        missing_synonyms,
    ),
    CatalogQueue(
        "inactive_with_active_programme",
        "Inactive with an active programme",
        "Inactive trades still referenced by at least one active programme.",
        "attention",
        inactive_with_active_programme,
    ),
)

TRADE_WORKBENCH_QUEUES: tuple[CatalogQueue, ...] = (TRADE_ALL, *TRADE_QUEUES)
TRADE_QUEUES_BY_KEY: dict[str, CatalogQueue] = {queue.key: queue for queue in TRADE_QUEUES}


def trade_counts(queryset: QuerySet) -> dict[str, int]:
    """Return every trade workbench count in one exact aggregate query."""
    annotated = queryset.order_by().annotate(
        _catalog_queue_has_active_programme=Exists(_active_programmes())
    )
    return annotated.aggregate(
        all=Count("pk", distinct=True),
        active_without_active_programme=Count(
            "pk",
            filter=Q(is_active=True, _catalog_queue_has_active_programme=False),
            distinct=True,
        ),
        missing_description=Count("pk", filter=Q(description=""), distinct=True),
        missing_synonyms=Count("pk", filter=Q(synonyms=[]), distinct=True),
        inactive_with_active_programme=Count(
            "pk",
            filter=Q(is_active=False, _catalog_queue_has_active_programme=True),
            distinct=True,
        ),
    )
