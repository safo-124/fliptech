"""WhatsApp messages staff send to workshop owners from the back office.

Two messages go to owners today, and both are queued by the system and sent by
a person with a wa.me link: business-initiated WhatsApp needs Cloud API
credentials nobody has yet, and SMS is not built. When a real sender exists it
replaces the Send button and nothing else.

* "Your listing is live" — Section 09's last onboarding step, queued when a
  listing is published. It lives here.
* The 90-day check of fees and intake dates — see providers/freshness.py,
  which uses the helpers below for the number and the links.
"""

from urllib.parse import urljoin

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from enquiries.whatsapp import chat_url

from .dashboard import make_dashboard_token
from .models import OwnerNotice, Provider


def owner_phone(provider):
    """The owner's own number when staff recorded one, else the listing's."""
    return provider.owner_phone or provider.contact_phone


def site_link(path):
    """An absolute link on the public site, or None when it has no address.

    None when PUBLIC_SITE_URL is unset: a relative path in a WhatsApp message
    is a link to nowhere, and it is better to leave the line out.
    """
    base = settings.PUBLIC_SITE_URL
    if not base:
        return None
    return urljoin(base.rstrip("/") + "/", path.lstrip("/"))


def dashboard_link(provider):
    """The owner's tokenised dashboard, which needs no sign-in."""
    return site_link(f"dashboard/{make_dashboard_token(provider)}")


def listing_link(provider):
    """The public profile, at the address Section 04 gives it."""
    return site_link(f"{provider.area.slug}/{provider.slug}")


def dashboard_lines(provider):
    """The dashboard paragraph both messages end with, or "" without a site."""
    link = dashboard_link(provider)
    if not link:
        return ""
    days = settings.DASHBOARD_TOKEN_TTL_SECONDS // 86400
    return (
        f"\n\nYou can see your listing and the enquiries you have received here "
        f"(the link works for {days} days):\n{link}"
    )


def greeting(provider):
    return f"Hello {provider.owner_name}, " if provider.owner_name else "Hello, "


# --- "Your listing is live" ---------------------------------------------------


def queue_live_notice(provider):
    """Queue the notice for a listing that has just been published.

    Called inside publish_provider's transaction. One waiting notice per
    listing: publishing again before anyone sent the first does not ask staff
    to message the owner twice.
    """
    notice, _ = OwnerNotice.objects.get_or_create(
        provider=provider,
        kind=OwnerNotice.Kind.LISTING_LIVE,
        sent_at=None,
    )
    return notice


def live_notices_waiting():
    """Unsent notices for listings that are still live.

    A listing suspended before anyone told the owner it was live should not
    produce a message saying it is.
    """
    return (
        OwnerNotice.objects.filter(
            kind=OwnerNotice.Kind.LISTING_LIVE,
            sent_at__isnull=True,
            provider__status=Provider.Status.PUBLISHED,
        )
        .select_related("provider", "provider__area")
        .order_by("created_at", "pk")
    )


def live_message(provider):
    text = (
        f"{greeting(provider)}this is {settings.BRAND_NAME} Skills Hub. Your listing for "
        f"{provider.name} is now live, so trainees can find you and send enquiries."
    )
    link = listing_link(provider)
    if link:
        text += (
            f"\n\nPlease check it is right — the fees, start dates and photographs are what "
            f"trainees will see:\n{link}"
        )
    text += "\n\nIf anything is wrong, reply here and we will fix it."
    return text + dashboard_lines(provider)


def live_url(provider):
    return chat_url(owner_phone(provider), live_message(provider))


@transaction.atomic
def mark_live_sent(notice, *, actor, now=None):
    """Stamp a notice as sent. False if someone else sent it first."""
    now = now or timezone.now()
    updated = OwnerNotice.objects.filter(pk=notice.pk, sent_at__isnull=True).update(
        sent_at=now, sent_by=actor
    )
    if updated:
        notice.sent_at = now
        notice.sent_by = actor
    return bool(updated)
