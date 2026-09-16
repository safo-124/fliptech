"""The work queues: the back office's to-do list, defined once.

Section 12 names staleness and unscalable verification as the two things that
kill a directory, and Section 09 puts a second pair of eyes on publishing.
Those are the queues below.

Each one has to be *reachable*, not merely counted. A badge with no route to
the work is decoration, so every queue is also a changelist filter — clicking
the count in the sidebar lands on exactly the rows it counted.

The same definitions drive three surfaces:

    sidebar badges      core/context_processors.py
    changelist filter   providers/admin.py (WorkQueueFilter)
    dashboard numbers   core/admin_site.py

They live here rather than in any one of them because a sidebar that says five
and a changelist that then shows four teaches an officer to distrust the panel.
That distrust is unrecoverable, and it is caused by exactly this kind of
duplicated `.filter()` drifting apart over a few commits.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from django.db.models import Q, QuerySet
from django.utils import timezone

# A site visit older than a year is not evidence about the workshop today.
VERIFICATION_MAX_AGE_DAYS = 365
# Providers are asked to confirm fees and intakes quarterly.
CONFIRMATION_DUE_DAYS = 90
# Past this, the public listing says so rather than implying the price holds.
CONFIRMATION_STALE_DAYS = 120


def published(queryset: QuerySet) -> QuerySet:
    """Only published listings, which is what every queue but one is about.

    A draft with no photograph is not a problem; a published one is.
    """
    from .models import Provider

    return queryset.filter(status=Provider.Status.PUBLISHED)


def awaiting_approval(queryset: QuerySet) -> QuerySet:
    from .models import Provider

    return queryset.filter(status=Provider.Status.PENDING_APPROVAL)


def submitted_by_owner(queryset: QuerySet) -> QuerySet:
    """Awaiting approval, and written by the workshop owner rather than staff.

    These need a closer read: nobody from the field team has seen the workshop
    or typed the fees.
    """
    return awaiting_approval(queryset).filter(trainer_memberships__isnull=False).distinct()


def never_visited(queryset: QuerySet) -> QuerySet:
    return published(queryset).filter(verifications__isnull=True)


def due_revisit(queryset: QuerySet) -> QuerySet:
    cutoff = timezone.localdate() - timedelta(days=VERIFICATION_MAX_AGE_DAYS)
    return (
        published(queryset)
        .filter(verifications__isnull=False)
        .exclude(verifications__visited_on__gte=cutoff)
        .distinct()
    )


def due_confirmation(queryset: QuerySet) -> QuerySet:
    cutoff = timezone.now() - timedelta(days=CONFIRMATION_DUE_DAYS)
    return published(queryset).filter(
        Q(last_confirmed_at__lt=cutoff) | Q(last_confirmed_at__isnull=True)
    )


def shown_as_stale(queryset: QuerySet) -> QuerySet:
    cutoff = timezone.now() - timedelta(days=CONFIRMATION_STALE_DAYS)
    return published(queryset).filter(
        Q(last_confirmed_at__lt=cutoff) | Q(last_confirmed_at__isnull=True)
    )


def no_photo(queryset: QuerySet) -> QuerySet:
    return published(queryset).filter(photos__isnull=True)


def no_programme(queryset: QuerySet) -> QuerySet:
    return published(queryset).filter(programmes__isnull=True)


def no_upcoming_intake(queryset: QuerySet) -> QuerySet:
    return (
        published(queryset)
        .exclude(
            programmes__intakes__start_date__gte=timezone.localdate(),
            programmes__intakes__is_open=True,
        )
        .distinct()
    )


@dataclass(frozen=True)
class Queue:
    """One pile of work.

    `sidebar` is False for a queue that is worth filtering a changelist by but
    would be noise as a badge — see the note on the 90-day check below.
    """

    key: str
    label: str
    narrow: Callable[[QuerySet], QuerySet]
    sidebar: bool = True

    def queryset(self, base: QuerySet | None = None) -> QuerySet:
        from .models import Provider

        return self.narrow(Provider.objects.all() if base is None else base)

    def count(self, base: QuerySet | None = None) -> int:
        return self.queryset(base).count()


# Ordered by how much a delay costs. An unapproved provider is a workshop
# waiting on us and a trainee who cannot find them; a missing photograph is a
# weaker listing. The sidebar renders them in this order.
QUEUES: tuple[Queue, ...] = (
    Queue("awaiting_approval", "Awaiting approval", awaiting_approval),
    # A subset of the queue above, so a filter rather than a second badge.
    Queue("submitted_by_owner", "Submitted by owner", submitted_by_owner, sidebar=False),
    Queue("never_visited", "Never visited", never_visited),
    Queue("due_revisit", "Visit over a year old", due_revisit),
    Queue("shown_as_stale", "Shown as unconfirmed", shown_as_stale),
    # Everything shown as unconfirmed is also due a check, so as a badge this
    # would sit directly under an identical-looking number — and on a young
    # database, where nothing has been confirmed yet, the two are exactly equal
    # and the sidebar looks broken. The proportion still due is the meter in the
    # sidebar footer, which says the same thing once.
    Queue("due_confirmation", "Due a 90-day check", due_confirmation, sidebar=False),
    Queue("no_photo", "No photograph", no_photo),
    Queue("no_programme", "No programme", no_programme),
    Queue("no_upcoming_intake", "No upcoming intake", no_upcoming_intake),
)

QUEUES_BY_KEY: dict[str, Queue] = {queue.key: queue for queue in QUEUES}
SIDEBAR_QUEUES: tuple[Queue, ...] = tuple(queue for queue in QUEUES if queue.sidebar)
