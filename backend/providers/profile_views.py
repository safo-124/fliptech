"""Counting profile views for the workshop dashboard (Screen 5).

A view is counted when the profile page tells the API it was opened in a
browser. The page itself is server-rendered and cached for five minutes, so the
server cannot count views from page requests: most of them never reach Django.

What counts, and what does not:

* One visitor, one provider, one day: once. Reloading the page, or coming back
  to it in the afternoon, is still one person looking. The visitor is
  recognised by a salted hash of their connection and browser, kept in the
  cache until the end of the day and never written to the database.
* Staff and the workshop's own trainer do not count. An owner checking their
  own listing ten times is not interest from trainees.
* Crawlers that announce themselves do not count. Most never run the page's
  JavaScript anyway, so they never send the beacon.

The number is a floor, not an exact audience: a visitor with JavaScript off is
not counted. That is the honest direction to be wrong in on a dashboard that
justifies a subscription.
"""

import hashlib
import re
from datetime import datetime, time, timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import F, Min, Sum
from django.utils import timezone

from .models import ProfileViewDay

BOT_PATTERN = re.compile(r"bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget", re.I)


def _seconds_until_tomorrow(now):
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=now.tzinfo)
    return max(int((tomorrow - now).total_seconds()), 60)


def _visitor_key(provider_id, day, client_ip, user_agent):
    """A cache key that recognises a returning visitor without naming them.

    Salted with the secret key, so the cache never holds anything that maps
    back to an address, and keyed by day, so the same visitor tomorrow is a
    different key.
    """
    raw = f"{settings.SECRET_KEY}|{provider_id}|{day.isoformat()}|{client_ip}|{user_agent}"
    return "profile-view:" + hashlib.sha256(raw.encode()).hexdigest()


def is_excluded(user, provider, user_agent):
    """True for a view that is not a trainee looking."""
    if user_agent and BOT_PATTERN.search(user_agent):
        return True
    if user is None or not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    return provider.trainer_memberships.filter(trainer__user=user).exists()


def record_view(provider, *, client_ip, user_agent, user=None):
    """Count one view. Returns True when it was counted."""
    if is_excluded(user, provider, user_agent):
        return False

    now = timezone.localtime()
    day = now.date()
    key = _visitor_key(provider.pk, day, client_ip, user_agent)
    # add() is atomic: two beacons from one page load cannot both win it.
    if not cache.add(key, 1, timeout=_seconds_until_tomorrow(now)):
        return False

    row, _ = ProfileViewDay.objects.get_or_create(provider=provider, day=day)
    ProfileViewDay.objects.filter(pk=row.pk).update(views=F("views") + 1)
    return True


def views_since(provider, since_day):
    total = ProfileViewDay.objects.filter(provider=provider, day__gte=since_day).aggregate(
        total=Sum("views")
    )["total"]
    return total or 0


def counting_started_on():
    """The first day any view was counted, or None before the first.

    The dashboard uses it to say "counted since 3 November" while the
    counter is younger than the dashboard's window, rather than letting a
    week of counting read as a slow month.
    """
    return ProfileViewDay.objects.aggregate(first=Min("day"))["first"]
