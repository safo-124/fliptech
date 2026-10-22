"""Sign-in codes sent by a person, until the server can send texts itself.

There is no SMS gateway yet: Arkesel and Hubtel both need a registered sender
ID. For showing the product to people, SMS_PROVIDER=backoffice puts each text
in the back office instead, where staff copy the code to the person on
WhatsApp or by text from their own phone. Switching to a real gateway later is
the one setting; nothing else changes.

A code in the database is a working sign-in for as long as it is valid. Two
things keep that small:

* Only staff with the core.view_relayedtext permission see the page — the
  operations lead and superusers. Anyone who can read it can sign in as anyone
  whose code it shows, so it is not a field officer's page.
* The message body is wiped once the code has expired. The row stays, as the
  record of who was sent a code and who passed it on, without the code.
"""

import re
from datetime import timedelta

from django.conf import settings
from django.db.models import Exists, OuterRef
from django.utils import timezone

from .models import RelayedText

CODE_PATTERN = re.compile(r"\b(\d{4,8})\b")


def lifetime():
    """How long a code in a text is worth anything. Matches the code's own expiry."""
    return timedelta(seconds=settings.OTP_TTL_SECONDS)


def wipe_expired(now=None):
    """Blank the body of every text whose code can no longer be used."""
    now = now or timezone.now()
    return (
        RelayedText.objects.filter(created_at__lt=now - lifetime()).exclude(body="").update(body="")
    )


def queue_text(to, body):
    wipe_expired()
    return RelayedText.objects.create(to=str(to), body=body)


def current(now=None):
    """Texts whose code still works, newest first: waiting ones and sent ones.

    Only the newest text to a number counts. Asking for another code makes the
    last one useless — verify_code only tries the newest — so sending the
    older one would hand somebody a code the server now refuses.
    """
    now = now or timezone.now()
    newer = RelayedText.objects.filter(to=OuterRef("to"), created_at__gt=OuterRef("created_at"))
    return (
        RelayedText.objects.filter(created_at__gte=now - lifetime())
        .exclude(Exists(newer))
        .select_related("relayed_by")
    )


def waiting(now=None):
    return current(now).filter(relayed_at__isnull=True)


def code_in(body):
    """The code a text carries, for showing large. None if it carries none."""
    match = CODE_PATTERN.search(body or "")
    return match.group(1) if match else None


def mark_sent(text, *, actor, now=None):
    """Record that somebody passed the text on. False if it was already."""
    now = now or timezone.now()
    updated = RelayedText.objects.filter(pk=text.pk, relayed_at__isnull=True).update(
        relayed_at=now, relayed_by=actor
    )
    return bool(updated)
