"""The monthly check-in with each paying workshop.

Once a month an officer asks every paying workshop who started a course, who
finished, and whether they would recommend each graduate for paid work. The
answers become Enrolment rows; the conversation itself becomes a
MonthlyCheckIn, so that "we asked and nobody enrolled" is a record rather than
an absence.

"Paying" means what the dashboard's subscription card means by it: an active
subscription, running today, at a price above zero. Free listings are not
asked, because the renewal conversation this feeds does not exist for them.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from .models import Enrolment, MonthlyCheckIn


class CheckInRefused(Exception):
    """Raised with a message safe to show the officer."""


def month_start(day=None):
    day = day or timezone.localdate()
    return day.replace(day=1)


def previous_month(day=None):
    return (month_start(day) - timedelta(days=1)).replace(day=1)


def paying_providers(today=None):
    from billing.models import Subscription
    from providers.models import Provider

    today = today or timezone.localdate()
    return Provider.objects.filter(
        status=Provider.Status.PUBLISHED,
        subscriptions__state=Subscription.State.ACTIVE,
        subscriptions__period_start__lte=today,
        subscriptions__period_end__gte=today,
        subscriptions__price__gt=0,
    ).distinct()


def _answered(month):
    """Workshops that gave an answer for a month. Not reaching them is not one."""
    return (
        MonthlyCheckIn.objects.filter(month=month)
        .exclude(outcome=MonthlyCheckIn.Outcome.NOT_REACHED)
        .values("provider")
    )


def due(today=None):
    """Paying workshops with no answer yet this month, including any not reached."""
    month = month_start(today)
    return paying_providers(today).exclude(pk__in=_answered(month))


def missed_last_month(today=None):
    """Workshops that were paying last month and gave no answer for it.

    Paying on the last day of the month, so a workshop that only started
    paying this month was never due last month and is not counted.
    """
    last_day = month_start(today) - timedelta(days=1)
    return paying_providers(last_day).exclude(pk__in=_answered(previous_month(today)))


def enrolments_recorded(provider, month):
    """Enrolments staff recorded for this workshop during the month."""
    return Enrolment.objects.filter(provider=provider, created_at__date__gte=month).count()


@transaction.atomic
def record(provider, outcome, *, actor, today=None, note=""):
    """Record this month's check-in, replacing an earlier answer for the month.

    "Enrolments reported" needs the enrolments themselves recorded first: a
    check-in that says enrolments were reported, with none in the database,
    is the kind of number this exists to stop.
    """
    month = month_start(today)
    if outcome == MonthlyCheckIn.Outcome.REPORTED and not enrolments_recorded(provider, month):
        raise CheckInRefused(
            f"No enrolments have been recorded for {provider.name} this month. "
            "Add them first, then mark the check-in done."
        )
    check_in, _ = MonthlyCheckIn.objects.update_or_create(
        provider=provider,
        month=month,
        defaults={"outcome": outcome, "checked_by": actor, "note": note},
    )
    return check_in


@dataclass(frozen=True)
class Summary:
    month: date
    paying: int
    answered: int
    not_reached: int
    missed_last_month: int

    @property
    def due(self):
        return self.paying - self.answered

    @property
    def done_pct(self):
        return round(self.answered / self.paying * 100) if self.paying else None


def summary(today=None):
    """This month's progress, for the dashboard card and the sidebar count."""
    month = month_start(today)
    paying = paying_providers(today)
    this_month = MonthlyCheckIn.objects.filter(month=month, provider__in=paying)
    return Summary(
        month=month,
        paying=paying.count(),
        answered=this_month.exclude(outcome=MonthlyCheckIn.Outcome.NOT_REACHED).count(),
        not_reached=this_month.filter(outcome=MonthlyCheckIn.Outcome.NOT_REACHED).count(),
        missed_last_month=missed_last_month(today).count(),
    )
