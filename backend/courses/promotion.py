"""Paid promotion for courses: where a sponsored course shows, what may be
sponsored, and what a boost brought back.

A boost (CourseBoost, a week or a month, bought in the Course Studio) gives a
course sponsored spots, always labelled "Sponsored", on the same rules as
products (marketplace/promotion.py, whose picking and slotting this shares):

* the home page's course row, on the website and in the app: up to
  HOME_SLOTS at the front, picked at random from every course with a boost
  running, so each paying trainer gets seen (`sponsored`);
* the /learn list in its default order: at most one in every eight, which
  ones rotating each hour (`slotted_page`).

A sponsored card leads with the course's free first lesson: a "Watch free
lesson" button that opens it ready to play, rather than the sales page.

"Featured" is staff's own pick (CourseOffer.featured_until): first in the
list and in the /learn spotlight. Paying never makes a course "Featured".

What may be sponsored (`boost_problem`): a live workshop, at least
MIN_LESSONS lessons on show, a summary, and no lesson waiting on a viewer's
report. A course with an open report also drops out of its spots until staff
have dealt with it (`showable`).
What the trainer gets back (`boost_results`): plays, people who started the
course, and sales, while the boost ran.
"""

from decimal import Decimal

from django.db.models import Count, Exists, Min, OuterRef, Sum
from django.utils import timezone
from django.utils.translation import gettext as _

from marketplace import promotion as shared

HOME_SLOTS = 2
MIN_LESSONS = 3


def running(now=None):
    """Paid boosts whose sponsored spots run right now."""
    from .models import CourseBoost

    now = now or timezone.now()
    return CourseBoost.objects.filter(
        status=CourseBoost.Status.PAID, starts_at__lte=now, ends_at__gt=now
    )


def is_sponsored():
    """For annotating workshops: True while one of its boosts is running."""
    return Exists(running().filter(provider=OuterRef("pk")))


def _open_report():
    from providers.models import ProviderVideo, VideoReport

    return Exists(
        VideoReport.objects.filter(
            video__provider=OuterRef("pk"),
            video__status=ProviderVideo.Status.APPROVED,
            resolved_at__isnull=True,
        )
    )


def showable(courses):
    """Sponsored courses worth a spot right now: none with an open report."""
    return courses.filter(sponsored=True).exclude(_open_report())


def sponsored(courses, limit=HOME_SLOTS):
    """Up to `limit` sponsored courses, picked at random."""
    return shared.sponsored(courses, limit, showable=showable)


def slotted_page(courses, page, page_size):
    """One page of the course list, sponsored courses in their spots."""
    return shared.slotted_page(courses, page, page_size, showable=showable)


def boost_problem(provider):
    """Why this workshop's course may not be sponsored yet, in the trainer's
    words, or None."""
    from providers.models import ProviderVideo, VideoReport

    from .access import offer_for

    if provider.status != provider.Status.PUBLISHED:
        return _(
            "Your workshop is not live yet, so the course is not listed. Sponsor it once it is."
        )
    count = provider.videos.shown().count()
    if count < MIN_LESSONS:
        return _(
            "Sponsor a course once it has at least %(least)d lessons on show. Yours has %(count)d."
        ) % {"least": MIN_LESSONS, "count": count}
    offer = offer_for(provider)
    if offer is None or not offer.summary.strip():
        return _(
            "Write a short summary first, under Course details. It is what people read before they press play."
        )
    if VideoReport.objects.filter(
        video__provider=provider,
        video__status=ProviderVideo.Status.APPROVED,
        resolved_at__isnull=True,
    ).exists():
        return _(
            "A lesson has a viewer's report staff have not looked at yet. You can sponsor the course once they have."
        )
    return None


def boost_results(boost):
    """What a boost brought while it ran (so far, if it still is): lesson
    plays, people who started the course, and sales with what they came to."""
    from .models import CoursePurchase, LessonPlayDay, LessonProgress

    now = timezone.now()
    if boost.starts_at is None or boost.starts_at > now:
        return {"plays": 0, "started": 0, "sales": 0, "sold": "0.00"}
    end = min(boost.ends_at or now, now)
    first, last = timezone.localdate(boost.starts_at), timezone.localdate(end)
    plays = (
        LessonPlayDay.objects.filter(
            provider_id=boost.provider_id, day__gte=first, day__lte=max(first, last)
        ).aggregate(total=Sum("plays"))["total"]
        or 0
    )
    # Started: their first lesson of this course was during the boost.
    started = (
        LessonProgress.objects.filter(provider_id=boost.provider_id)
        .order_by()
        .values("trainee")
        .annotate(first=Min("created_at"))
        .filter(first__gte=boost.starts_at, first__lte=end)
        .count()
    )
    sales = CoursePurchase.objects.filter(
        provider_id=boost.provider_id,
        status=CoursePurchase.Status.PAID,
        paid_at__gte=boost.starts_at,
        paid_at__lte=end,
    ).aggregate(count=Count("id"), total=Sum("amount_pesewas"))
    return {
        "plays": plays,
        "started": started,
        "sales": sales["count"] or 0,
        "sold": f"{Decimal(sales['total'] or 0) / 100:.2f}",
    }
