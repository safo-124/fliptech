"""Operational queues for the enquiry follow-up funnel.

The admin header, list filter, and counts all consume these definitions. Keeping
the predicates together prevents a tab labelled "3" from opening a list of 4,
and makes the stages explicit: replied and visited only include enquiries that
have not already progressed to a later stage.
"""

from dataclasses import dataclass

from django.db.models import Count, Q, QuerySet


@dataclass(frozen=True)
class EnquiryQueue:
    key: str
    label: str
    description: str
    tone: str
    condition: Q | None = None

    def narrow(self, queryset: QuerySet) -> QuerySet:
        if self.condition is None:
            return queryset
        return queryset.filter(self.condition)


ALL = EnquiryQueue(
    "all",
    "All enquiries",
    "Every enquiry received from trainees, including completed follow-up and spam.",
    "neutral",
)

# The state values are strings here on purpose. queues.py can be imported as
# lightweight metadata without importing the model module back into itself.
AWAITING_VERIFICATION = EnquiryQueue(
    "awaiting_verification",
    "Awaiting verification",
    "Trainees who have not yet completed phone verification.",
    "warning",
    Q(state="pending_verification"),
)

DELIVERY_FAILED = EnquiryQueue(
    "delivery_failed",
    "Delivery failed",
    "Messages that did not reach the provider and need a delivery check.",
    "attention",
    Q(state="failed"),
)

SENT_AWAITING_REPLY = EnquiryQueue(
    "sent_awaiting_reply",
    "Sent · awaiting reply",
    "Delivered enquiries with no human-reported reply or later outcome yet.",
    "info",
    Q(state="sent", enrolment__isnull=True)
    & (
        Q(outcome__isnull=True)
        | Q(
            outcome__replied=False,
            outcome__visited=False,
            outcome__enrolled=False,
        )
    ),
)

REPLIED = EnquiryQueue(
    "replied",
    "Replied",
    "Provider replies that have not yet progressed to a visit or enrolment.",
    "info",
    ~Q(state="spam")
    & Q(
        outcome__replied=True,
        outcome__visited=False,
        outcome__enrolled=False,
        enrolment__isnull=True,
    ),
)

VISITED = EnquiryQueue(
    "visited",
    "Visited",
    "Trainees reported as having visited, but not yet enrolled.",
    "positive",
    ~Q(state="spam") & Q(outcome__visited=True, outcome__enrolled=False, enrolment__isnull=True),
)

ENROLLED = EnquiryQueue(
    "enrolled",
    "Enrolled",
    "Enquiries reported as enrolled or linked to a recorded enrolment.",
    "positive",
    ~Q(state="spam") & (Q(outcome__enrolled=True) | Q(enrolment__isnull=False)),
)

SPAM = EnquiryQueue(
    "spam",
    "Spam",
    "Enquiries deliberately excluded from operational follow-up.",
    "muted",
    Q(state="spam"),
)

QUEUES: tuple[EnquiryQueue, ...] = (
    AWAITING_VERIFICATION,
    DELIVERY_FAILED,
    SENT_AWAITING_REPLY,
    REPLIED,
    VISITED,
    ENROLLED,
    SPAM,
)
WORKBENCH_QUEUES: tuple[EnquiryQueue, ...] = (ALL, *QUEUES)
QUEUES_BY_KEY = {queue.key: queue for queue in QUEUES}


def counts(queryset: QuerySet) -> dict[str, int]:
    """Return all tab counts with one aggregate query."""
    expressions = {ALL.key: Count("pk")}
    expressions.update({queue.key: Count("pk", filter=queue.condition) for queue in QUEUES})
    return queryset.order_by().aggregate(**expressions)
