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

CACHE_KEY = "back-office:sidebar:v7"
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

    from providers.admin_outbox import waiting_count

    messages_waiting = waiting_count()

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

    from providers.models import TrainerAccount

    trainer_changelist = reverse("admin:providers_traineraccount_changelist")
    trainers_waiting = TrainerAccount.objects.filter(
        approval_status=TrainerAccount.Approval.PENDING, is_active=True
    ).count()

    from enquiries import check_ins
    from providers.models import Complaint, ProviderVideo

    check_ins_due = check_ins.summary().due
    complaints_new = Complaint.objects.filter(status=Complaint.Status.NEW).count()
    videos_waiting = ProviderVideo.objects.filter(status=ProviderVideo.Status.PENDING).count()

    return {
        "check_ins_due": check_ins_due,
        "complaints_new": complaints_new,
        "videos_waiting": videos_waiting,
        "trainer_queues": (
            [
                {
                    "key": "trainers_to_confirm",
                    "label": "Trainers to confirm",
                    "count": trainers_waiting,
                    "url": f"{trainer_changelist}?approval_status__exact=pending",
                    "model_url": trainer_changelist,
                }
            ]
            if trainers_waiting
            else []
        ),
        "queues": [
            {
                "key": queue.key,
                "label": queue.label,
                "count": counts[queue.key],
                "url": f"{changelist}?queue={queue.key}",
            }
            for queue in work.SIDEBAR_QUEUES
            if counts[queue.key]
        ]
        + (
            # Not a provider filter but its own page: each row is a WhatsApp
            # message to send, not a listing to edit. See admin_outbox.py.
            [
                {
                    "key": "owner_messages",
                    "label": "Messages to send",
                    "count": messages_waiting,
                    "url": reverse("admin:providers_provider_messages"),
                }
            ]
            if messages_waiting
            else []
        ),
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


def _codes_to_send(user):
    """Sign-in codes waiting for staff to send them by hand. See core/relay.py.

    Counted on every request rather than from the cached snapshot: a code is
    worth something for ten minutes and somebody is usually waiting for it, so
    a badge a minute behind is a badge that matters. It is one indexed count,
    and only when codes are being relayed at all.

    Listed even with nothing waiting, unlike the other queues. Staff open this
    page because somebody says they are waiting for a code, often before it
    has arrived, and a link that appears only once there is something in it is
    a link nobody can find at that moment.
    """
    if settings.SMS_PROVIDER != "backoffice" or not user.has_perm("core.view_relayedtext"):
        return []
    from core.relay import waiting

    count = waiting().count()
    return [
        {
            "key": "codes_to_send",
            "label": "Codes to send",
            "count": count,
            "url": reverse("admin:core_relayedtext_changelist"),
        }
    ]


def _complaints_queue(count):
    """Reports from the "Report a problem" link nobody has dealt with yet."""
    if not count:
        return []
    return [
        {
            "key": "complaints_new",
            "label": "New complaints",
            "count": count,
            "url": f"{reverse('admin:providers_complaint_changelist')}?status__exact=new",
        }
    ]


def _videos_queue(count):
    """Teaching videos waiting to be watched before they show. See ProviderVideo."""
    if not count:
        return []
    return [
        {
            "key": "videos_waiting",
            "label": "Videos to review",
            "count": count,
            "url": f"{reverse('admin:providers_providervideo_changelist')}?status__exact=pending",
        }
    ]


def _check_ins_queue(count):
    """Paying workshops still to be asked this month. See enquiries/check_ins.py.

    Its own page rather than a filter, like Messages to send: each row is a
    conversation to have, not a record to edit.
    """
    if not count:
        return []
    return [
        {
            "key": "check_ins_due",
            "label": "Check-ins due",
            "count": count,
            "url": reverse("admin:enquiries_monthlycheckin_due"),
        }
    ]


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
            "code_queues": _codes_to_send(user),
            # Custom links must follow the same permission boundary as
            # AdminSite's native app list. The cached counts are global, but
            # each request receives only the queues that user may open.
            "queues": [
                # A report about a workshop, possibly about a trainee's safety,
                # goes first.
                *(
                    _complaints_queue(snapshot["complaints_new"])
                    if user.has_perm("providers.view_complaint")
                    else []
                ),
                *(snapshot["queues"] if can_view_providers else []),
                # Only for whoever can approve one: the queue is a decision.
                *(
                    _videos_queue(snapshot["videos_waiting"])
                    if user.has_perm("providers.change_providervideo")
                    else []
                ),
                *(
                    _check_ins_queue(snapshot["check_ins_due"])
                    if user.has_perm("enquiries.view_monthlycheckin")
                    else []
                ),
            ],
            "enquiry_queues": (snapshot["enquiry_queues"] if can_view_enquiries else []),
            "programme_queues": (snapshot["programme_queues"] if can_view_programmes else []),
            "intake_queues": snapshot["intake_queues"] if can_view_intakes else [],
            "catalog_queues": [
                *(snapshot["programme_queues"] if can_view_programmes else []),
                *(snapshot["intake_queues"] if can_view_intakes else []),
            ],
            "published": snapshot["published"] if can_view_providers else 0,
            # Only people who can act on a sign-up are nagged about it.
            "trainer_queues": (
                snapshot["trainer_queues"] if user.has_perm("providers.confirm_trainer") else []
            ),
        }
    }
