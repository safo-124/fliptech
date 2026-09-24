"""What has actually happened lately, newest first.

The dashboard was all state and no events: you could see how many listings
await approval, never that one was submitted an hour ago, by whom, or that a
trainer was confirmed this morning. Django's own "recent actions" card covers
only changes made through the admin, so everything a trainer or trainee did
themselves — signing up, submitting a listing, confirming it is current — was
invisible.

Built from each model's own event timestamps rather than from django-simple-
history. The history tables record every field change, including ones nobody
would call an event ("provider updated" when a phone number gained a space),
and reconstructing meaning from them means diffing consecutive rows per record.
The timestamps below already mark the moments a person would name, and they
are indexed.

Permission-scoped the same way the People row is: a field officer sees the
listing work, not who signed up as a trainee.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone


class Event:
    """One thing that happened.

    A tiny class rather than a dict so that sorting cannot silently compare
    the wrong field, and so the template has one shape to render.
    """

    __slots__ = ("at", "kind", "what", "who", "url")

    def __init__(self, at, kind, what, who=None, url=None):
        self.at = at
        self.kind = kind
        self.what = what
        self.who = who
        self.url = url


def _name(user):
    if user is None:
        return None
    return user.get_full_name() or user.get_username()


def _provider_url(provider_id):
    return reverse("admin:providers_provider_change", args=[provider_id])


def _listings(since, limit):
    from providers.models import ListingConfirmation, Provider, Verification

    events = []

    published = Provider.objects.filter(published_at__gte=since).order_by("-published_at")[:limit]
    for provider in published:
        events.append(
            Event(
                provider.published_at,
                "published",
                f"{provider.name} went live",
                None,
                _provider_url(provider.pk),
            )
        )

    # Submitted but not yet published, so a listing that went straight through
    # does not appear twice saying nearly the same thing.
    submitted = Provider.objects.filter(
        submitted_at__gte=since, published_at__isnull=True
    ).order_by("-submitted_at")[:limit]
    for provider in submitted:
        events.append(
            Event(
                provider.submitted_at,
                "submitted",
                f"{provider.name} was submitted for review",
                None,
                _provider_url(provider.pk),
            )
        )

    visits = (
        Verification.objects.filter(created_at__gte=since)
        .select_related("provider", "officer")
        .order_by("-created_at")[:limit]
    )
    for visit in visits:
        events.append(
            Event(
                visit.created_at,
                "visited",
                f"Site visit recorded for {visit.provider.name}",
                _name(visit.officer),
                _provider_url(visit.provider_id),
            )
        )

    confirmations = (
        ListingConfirmation.objects.filter(responded_at__gte=since)
        .select_related("provider", "confirmed_by")
        .order_by("-responded_at")[:limit]
    )
    for confirmation in confirmations:
        events.append(
            Event(
                confirmation.responded_at,
                "confirmed",
                f"{confirmation.provider.name} confirmed their details are current",
                _name(confirmation.confirmed_by),
                _provider_url(confirmation.provider_id),
            )
        )

    return events


def _owners(since, limit):
    from providers.models import TrainerAccount

    events = []
    accounts = TrainerAccount.objects.filter(created_at__gte=since).order_by("-created_at")[:limit]
    for account in accounts:
        events.append(
            Event(
                account.created_at,
                "signup",
                f"{account.full_name or account.phone} signed up as a trainer",
                None,
                reverse("admin:providers_traineraccount_change", args=[account.pk]),
            )
        )

    decided = (
        TrainerAccount.objects.filter(approval_decided_at__gte=since)
        .select_related("approval_decided_by")
        .order_by("-approval_decided_at")[:limit]
    )
    for account in decided:
        events.append(
            Event(
                account.approval_decided_at,
                "decision",
                f"{account.full_name or account.phone} was {account.get_approval_status_display().lower()}",
                _name(account.approval_decided_by),
                reverse("admin:providers_traineraccount_change", args=[account.pk]),
            )
        )
    return events


def _trainees(since, limit):
    from trainees.models import TraineeAccount

    accounts = TraineeAccount.objects.filter(created_at__gte=since).order_by("-created_at")[:limit]
    return [
        Event(
            account.created_at,
            "signup",
            f"{account.display_name or account.phone} signed up as a trainee",
            None,
            reverse("admin:trainees_traineeaccount_change", args=[account.pk]),
        )
        for account in accounts
    ]


def _enquiries(since, limit):
    from enquiries.models import Enquiry

    enquiries = (
        Enquiry.objects.filter(created_at__gte=since)
        .select_related("provider")
        .order_by("-created_at")[:limit]
    )
    return [
        Event(
            enquiry.created_at,
            "enquiry",
            f"Enquiry {enquiry.reference_code} to {enquiry.provider.name}",
            None,
            reverse("admin:enquiries_enquiry_change", args=[enquiry.pk]),
        )
        for enquiry in enquiries
    ]


def recent(user, *, days=14, limit=25):
    """The feed, already sorted and trimmed.

    Each source is capped before merging, so one very busy source — enquiries,
    usually — cannot crowd everything else out of the query, only out of the
    result, which is what "newest first" is supposed to mean.
    """
    since = timezone.now() - timedelta(days=days)
    events = []

    if user.has_perm("providers.view_provider"):
        events += _listings(since, limit)
    if user.has_perm("providers.view_traineraccount"):
        events += _owners(since, limit)
    if user.has_perm("trainees.view_traineeaccount"):
        events += _trainees(since, limit)
    if user.has_perm("enquiries.view_enquiry"):
        events += _enquiries(since, limit)

    # None sorts badly against datetimes, and a null timestamp here would mean
    # a row whose event never happened, so it is not an event.
    events = [event for event in events if event.at is not None]
    events.sort(key=lambda event: event.at, reverse=True)
    return events[:limit]
