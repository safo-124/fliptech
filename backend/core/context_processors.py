"""Context the back-office sidebar needs on every page, not just the dashboard.

The dashboard builds its numbers in core/admin_site.py, but the sidebar is
rendered by admin/base.html on every screen in the back office. An officer
halfway through editing a provider should still be able to see that four more
are awaiting approval, and an enquiry officer should see failed deliveries and
unanswered handovers. That is the point of putting the queues in the sidebar
rather than leaving them on the home page.

Three things keep that from being expensive:

* it runs only for a staff user on an `admin:` view, so the public API and the
  login screen never touch it;
* the counts are the same for everyone, so they are cached globally rather than
  per user;
* empty queues are dropped here rather than in the template, so a clean back
  office renders no list at all;
* provider, enquiry, programme, and intake links are permission-filtered per
  request even though their shared count snapshot is cached globally.

The cache means a count can be up to a minute stale. That is the right trade
for a to-do list — but it is why the sidebar total is never used as the
authority for anything, only as a prompt to go and look.
"""

from django.conf import settings
from django.core.cache import cache
from django.urls import reverse

CACHE_KEY = "back-office:sidebar:v3"
CACHE_SECONDS = 60


def _snapshot():
    from catalog import queues as catalog_work
    from catalog.models import Intake, Programme
    from enquiries import queues as enquiry_work
    from enquiries.models import Enquiry
    from providers import queues as work
    from providers.models import Provider

    base = Provider.objects.all()
    changelist = reverse("admin:providers_provider_changelist")

    counts = {queue.key: queue.count(base) for queue in work.QUEUES}
    published = work.published(base).count()

    enquiry_counts = enquiry_work.counts(Enquiry.objects.all())
    enquiry_changelist = reverse("admin:enquiries_enquiry_changelist")
    enquiry_attention_keys = {
        "awaiting_verification",
        "delivery_failed",
        "sent_awaiting_reply",
    }

    programme_changelist = reverse("admin:catalog_programme_changelist")
    programme_counts = catalog_work.programme_counts(Programme.objects.all())
    programme_attention_keys = {"active_no_future_intake"}

    intake_changelist = reverse("admin:catalog_intake_changelist")
    intake_counts = catalog_work.intake_counts(Intake.objects.all())
    intake_attention_keys = {
        "past_open",
        "full_open",
        "availability_missing",
    }

    return {
        "queues": [
            {
                "key": queue.key,
                "label": queue.label,
                "count": counts[queue.key],
                "url": f"{changelist}?queue={queue.key}",
            }
            for queue in work.SIDEBAR_QUEUES
            if counts[queue.key]
        ],
        "enquiry_queues": [
            {
                "key": queue.key,
                "label": queue.label,
                "count": enquiry_counts[queue.key],
                "url": f"{enquiry_changelist}?queue={queue.key}",
                "model_url": enquiry_changelist,
            }
            for queue in enquiry_work.QUEUES
            if queue.key in enquiry_attention_keys and enquiry_counts[queue.key]
        ],
        "programme_queues": [
            {
                "key": queue.key,
                "label": queue.label,
                "count": programme_counts[queue.key],
                "url": f"{programme_changelist}?queue={queue.key}",
                "model_url": programme_changelist,
            }
            for queue in catalog_work.PROGRAMME_QUEUES
            if queue.key in programme_attention_keys and programme_counts[queue.key]
        ],
        "intake_queues": [
            {
                "key": queue.key,
                "label": queue.label,
                "count": intake_counts[queue.key],
                "url": f"{intake_changelist}?queue={queue.key}",
                "model_url": intake_changelist,
            }
            for queue in catalog_work.INTAKE_QUEUES
            if queue.key in intake_attention_keys and intake_counts[queue.key]
        ],
        "published": published,
        # Confirmed inside the quarterly window: the one number that says
        # whether the directory is being maintained or is quietly rotting.
        "confirmed": published - counts["due_confirmation"],
        "confirmed_pct": (
            round((published - counts["due_confirmation"]) / published * 100) if published else 0
        ),
    }


def back_office(request):
    match = getattr(request, "resolver_match", None)
    if match is None or match.app_name != "admin":
        return {}

    user = getattr(request, "user", None)
    if user is None or not user.is_active or not user.is_staff:
        return {}

    can_view_providers = user.has_perm("providers.view_provider")
    can_view_enquiries = user.has_perm("enquiries.view_enquiry")
    can_view_programmes = user.has_perm("catalog.view_programme")
    can_view_intakes = user.has_perm("catalog.view_intake")
    if not any(
        (
            can_view_providers,
            can_view_enquiries,
            can_view_programmes,
            can_view_intakes,
        )
    ):
        return {}

    snapshot = cache.get_or_set(CACHE_KEY, _snapshot, CACHE_SECONDS)

    return {
        "back_office": {
            "brand": settings.BRAND_NAME,
            **snapshot,
            # Custom links must follow the same permission boundary as
            # AdminSite's native app list. The cached counts are global, but
            # each request receives only the queues that user may open.
            "queues": snapshot["queues"] if can_view_providers else [],
            "enquiry_queues": (snapshot["enquiry_queues"] if can_view_enquiries else []),
            "programme_queues": (snapshot["programme_queues"] if can_view_programmes else []),
            "intake_queues": snapshot["intake_queues"] if can_view_intakes else [],
            "catalog_queues": [
                *(snapshot["programme_queues"] if can_view_programmes else []),
                *(snapshot["intake_queues"] if can_view_intakes else []),
            ],
            "published": snapshot["published"] if can_view_providers else 0,
        }
    }
