"""The 90-day freshness prompt from Section 09, sent by a person for now.

The phone number, greeting and dashboard link are shared with the "listing is
live" notice and live in providers/owner_messages.py.

Section 09 says every provider is prompted on WhatsApp to confirm fees and
intake dates every 90 days. A business-initiated WhatsApp message needs Cloud
API credentials nobody has yet, and SMS is not built. A wa.me link needs
neither: it opens WhatsApp on the officer's own phone with the message already
typed, and they press send. So the work is split:

* A nightly command (queue_freshness_prompts) decides who is due and puts a
  ListingConfirmation row in the queue. Deciding needs no one; sending does.
* The back office lists the queue. Each Send button stamps the row as prompted
  and opens WhatsApp.

When a real sender exists, it replaces the button and nothing else: the queue,
the schedule and the record stay as they are.

The 30-day "unconfirmed" flag is not computed here. It is is_listing_stale on
Provider, 120 days after the last confirmation, which is the 90-day prompt plus
the 30 days Section 09 allows for a reply.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from enquiries.whatsapp import chat_url

from . import queues
from .models import ListingConfirmation, Provider
from .owner_messages import dashboard_lines, greeting, owner_phone

# A prompt that has gone unanswered this long is sent again. Matches the window
# after which the listing is shown as unconfirmed, so the reminder goes out on
# the day trainees start seeing the warning.
REPROMPT_AFTER_DAYS = queues.CONFIRMATION_STALE_DAYS - queues.CONFIRMATION_DUE_DAYS

QUEUED_NOTE = "Queued by the nightly freshness check."


def waiting_to_send():
    """Queued prompts nobody has sent yet, for listings that are still due.

    Filtered on the provider being due as well as the row being unsent, so a
    listing confirmed by phone between the nightly run and the officer opening
    the page does not ask the owner a question they have already answered.
    """
    due = queues.due_confirmation(Provider.objects.all())
    return (
        ListingConfirmation.objects.filter(
            prompted_at__isnull=True,
            responded_at__isnull=True,
            provider__in=due,
        )
        .select_related("provider", "provider__area")
        .order_by("provider__last_confirmed_at", "created_at", "pk")
    )


@transaction.atomic
def queue_prompts(now=None):
    """Queue a prompt for every listing due one. Returns (queued, withdrawn).

    Safe to run any number of times: a listing with a prompt already waiting,
    or one sent or answered within the reprompt window, is left alone.
    """
    now = now or timezone.now()
    due = queues.due_confirmation(Provider.objects.all())

    # Rows nobody sent for listings that stopped being due — confirmed some
    # other way, suspended, or unpublished. Left in place they would never
    # show (waiting_to_send filters them out) but would block a future prompt.
    withdrawn, _ = (
        ListingConfirmation.objects.filter(prompted_at__isnull=True, responded_at__isnull=True)
        .exclude(provider__in=due)
        .delete()
    )

    recent = now - timedelta(days=REPROMPT_AFTER_DAYS)
    already_in_hand = ListingConfirmation.objects.filter(
        Q(prompted_at__isnull=True, responded_at__isnull=True)
        | Q(prompted_at__gte=recent)
        | Q(responded_at__gte=recent)
    ).values("provider_id")

    to_queue = due.exclude(pk__in=already_in_hand)
    rows = [
        ListingConfirmation(
            provider=provider,
            channel=ListingConfirmation.Channel.WHATSAPP,
            note=QUEUED_NOTE,
        )
        for provider in to_queue
    ]
    ListingConfirmation.objects.bulk_create(rows)
    return len(rows), withdrawn


def prompt_message(provider):
    text = (
        f"{greeting(provider)}this is {settings.BRAND_NAME} Skills Hub. Every three months "
        f"we check that each listing is still right, so trainees see the real price.\n\n"
        f"Are the fees and intake dates for {provider.name} still correct? Reply YES if "
        f"nothing has changed, or tell us what is different."
    )
    return text + dashboard_lines(provider)


def prompt_url(provider):
    return chat_url(owner_phone(provider), prompt_message(provider))


def mark_sent(confirmation, *, actor, now=None):
    """Stamp a queued prompt as sent. False if someone else sent it first.

    Conditional, so two officers working the same queue on two phones cannot
    both message one owner and both be recorded as the sender.
    """
    now = now or timezone.now()
    updated = ListingConfirmation.objects.filter(
        pk=confirmation.pk, prompted_at__isnull=True
    ).update(prompted_at=now, prompted_by=actor)
    if updated:
        confirmation.prompted_at = now
        confirmation.prompted_by = actor
    return bool(updated)


def open_prompt(provider):
    """The prompt sent to this owner that is still waiting for an answer."""
    return (
        ListingConfirmation.objects.filter(
            provider=provider, prompted_at__isnull=False, responded_at__isnull=True
        )
        .order_by("-prompted_at")
        .first()
    )
