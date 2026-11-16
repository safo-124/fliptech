"""What counts as a listed course: one rule for every public page.

A course is listed when it is switched on, its trade is switched on, and its
workshop is published. "Starting soon", the trade counts, the training list
and a workshop's own page all use this, so a course taken down (by the
trainer, by staff, or by `hide_listing`) leaves all of them together instead
of lingering in one count.
"""

from django.db.models import Q


def listed_course_q(prefix=""):
    """The filter, with `prefix` for the path to the course, e.g. "programmes__"."""
    from providers.models import Provider

    return Q(
        **{
            f"{prefix}is_active": True,
            f"{prefix}trade__is_active": True,
            f"{prefix}provider__status": Provider.Status.PUBLISHED,
        }
    )


def is_listed(programme):
    """The same rule for one course already in hand (no query when prefetched)."""
    from providers.models import Provider

    return (
        programme.is_active
        and programme.trade.is_active
        and programme.provider.status == Provider.Status.PUBLISHED
    )


def with_a_listed_course(workshops):
    """Only workshops someone could join: at least one listed course.

    Search, the map and the home page's count use this, so a workshop with
    no course yet (or whose courses were all taken down) is not shown as a
    card with no fee, no length and no trade. Its own page stays reachable.
    """
    from django.db.models import Exists, OuterRef

    from catalog.models import Programme

    return workshops.filter(
        Exists(Programme.objects.filter(listed_course_q(), provider=OuterRef("pk")))
    )
