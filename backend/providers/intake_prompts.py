"""Asking a trainer for the next start date, once a course's last one passes.

A listed course whose intakes are all in the past shows "Ask the provider"
for its next intake and leaves "Starting soon" (catalog listing queries only
count dates from today on). Nobody can join a date that has gone, and
nothing says one is coming, so the trainer is texted once with a link to add
the next date.

Once for each intake that passes: `Programme.next_date_asked_at` is set when
the text goes, and the course is asked again only if a later date is added
and that one passes too. Run nightly by queue_freshness_prompts
(deploy/fliptech-freshness.timer); running it twice texts nobody twice.

Only trainers who hold the listing are texted. A workshop nobody has claimed
is staff's to keep up to date (providers/freshness.py).
"""

import logging

from django.conf import settings
from django.db import transaction
from django.db.models import Count, F, Max, Q
from django.utils import timezone
from django.utils.translation import gettext as _

from catalog.listed import listed_course_q
from catalog.models import Programme
from core.sms import send_sms

logger = logging.getLogger(__name__)


def due(today=None):
    """Listed courses whose last intake has passed, with none to come, not
    yet asked about that intake."""
    today = today or timezone.localdate()
    return (
        Programme.objects.filter(listed_course_q())
        .annotate(
            last_date=Max("intakes__start_date"),
            coming=Count("intakes", filter=Q(intakes__start_date__gte=today)),
        )
        .filter(last_date__lt=today, coming=0)
        .filter(Q(next_date_asked_at__isnull=True) | Q(next_date_asked_at__date__lt=F("last_date")))
        .select_related("provider")
    )


def _phones(provider):
    return [
        str(membership.trainer.phone)
        for membership in provider.trainer_memberships.select_related("trainer")
        if membership.trainer.is_active and membership.trainer.phone
    ]


def _text(to, message):
    from appsupport.notify import notify

    try:
        notify(to, message, link="/trainer/dashboard", send=send_sms)
    except Exception:  # noqa: BLE001 - one failed text must not stop the rest
        logger.exception("Could not text a trainer for a course's next date")


def ask_for_next_dates(today=None):
    """Text the trainers of each course that is due. Returns how many courses."""
    asked = 0
    link = f"{settings.PUBLIC_SITE_URL.rstrip('/')}/trainer/dashboard"
    for programme in due(today):
        phones = _phones(programme.provider)
        if not phones:
            continue
        message = _(
            "%(brand)s: the last start date for %(course)s has passed, so trainees are told to "
            "ask you. When does the next group start? Add the date: %(link)s"
        ) % {"brand": settings.BRAND_NAME, "course": programme.title, "link": link}
        with transaction.atomic():
            Programme.objects.filter(pk=programme.pk).update(next_date_asked_at=timezone.now())
            for phone in phones:
                transaction.on_commit(lambda to=phone, text=message: _text(to, text))
        asked += 1
    return asked
