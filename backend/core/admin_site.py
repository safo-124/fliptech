"""The super admin panel: an oversight dashboard on the back-office home page.

The Django admin gives per-model CRUD, which is what a field officer needs. It
does not answer the questions the founder and operations lead actually ask:
where is the pipeline stuck, which listings are going stale, is the enrolment
number real, and is the graduate record being captured.

Every panel here maps to something the product documentation names as a risk
rather than to whatever happened to be easy to count:

  Pipeline      Section 09's onboarding flow, including the approval step
  Verification  Section 12: "verification does not scale" — this is the cap
  Freshness     Section 12: staleness is the largest ongoing operating cost
  Demand        Section 07: enquiries and the enrolment number that decides
                retention
  Leakage       Section 12 accepts leakage; this measures it instead of
                assuming it
  Year two      Section 08: completions and attestations, which cannot be
                reconstructed later
  Coverage      Section 04: which generated pages have enough inventory to be
                worth indexing

Money and subscription figures are shown to superusers only. Everything else is
operational and useful to any staff member.
"""

from datetime import timedelta

from django.contrib.admin import AdminSite
from django.db.models import Avg, Count, F, Q, Sum
from django.utils import timezone

VERIFICATION_MAX_AGE_DAYS = 365
CONFIRMATION_DUE_DAYS = 90
CONFIRMATION_STALE_DAYS = 120
MIN_LISTINGS_FOR_GENERATED_PAGE = 3
REPLY_WINDOW_HOURS = 48


class SkillsHubAdminSite(AdminSite):
    index_template = "admin/skillshub_index.html"

    def index(self, request, extra_context=None):
        context = {**(extra_context or {}), "panel": self.build_panel(request)}
        return super().index(request, extra_context=context)

    def build_panel(self, request):
        from billing.models import Subscription
        from catalog.models import Trade
        from enquiries.models import Enquiry, Enrolment
        from geography.models import Area
        from providers.models import Provider, Verification

        now = timezone.now()
        today = now.date()
        last_30 = now - timedelta(days=30)
        prior_30 = now - timedelta(days=60)

        # --- Pipeline -----------------------------------------------------
        by_status = dict(
            Provider.objects.values_list("status")
            .annotate(n=Count("id"))
            .values_list("status", "n")
        )
        pipeline = {
            "draft": by_status.get(Provider.Status.DRAFT, 0),
            "pending": by_status.get(Provider.Status.PENDING_APPROVAL, 0),
            "published": by_status.get(Provider.Status.PUBLISHED, 0),
            "suspended": by_status.get(Provider.Status.SUSPENDED, 0),
        }

        published = Provider.objects.filter(status=Provider.Status.PUBLISHED)

        # --- Verification queue -------------------------------------------
        never_visited = published.filter(verifications__isnull=True).count()
        stale_cutoff = today - timedelta(days=VERIFICATION_MAX_AGE_DAYS)
        due_revisit = (
            published.filter(verifications__isnull=False)
            .exclude(verifications__visited_on__gte=stale_cutoff)
            .distinct()
            .count()
        )
        expiring_soon = (
            Verification.objects.filter(
                expires_on__gte=today, expires_on__lte=today + timedelta(days=30)
            )
            .values("provider")
            .distinct()
            .count()
        )

        # --- Freshness ------------------------------------------------------
        due_confirmation = published.filter(
            Q(last_confirmed_at__lt=now - timedelta(days=CONFIRMATION_DUE_DAYS))
            | Q(last_confirmed_at__isnull=True)
        ).count()
        shown_as_stale = published.filter(
            Q(last_confirmed_at__lt=now - timedelta(days=CONFIRMATION_STALE_DAYS))
            | Q(last_confirmed_at__isnull=True)
        ).count()

        # --- Demand ---------------------------------------------------------
        enquiries_30 = Enquiry.objects.filter(created_at__gte=last_30)
        enquiries_prior = Enquiry.objects.filter(created_at__gte=prior_30, created_at__lt=last_30)
        replied = enquiries_30.filter(
            outcome__replied=True,
            outcome__replied_at__lte=F("created_at") + timedelta(hours=REPLY_WINDOW_HOURS),
        ).count()
        enquiry_count = enquiries_30.count()

        enrolments_30 = Enrolment.objects.filter(started_on__gte=last_30.date())
        enrolment_stats = enrolments_30.aggregate(
            n=Count("id"), fees=Sum("fee_paid"), avg=Avg("fee_paid")
        )

        # --- Leakage ---------------------------------------------------------
        # Section 12 accepts leakage as a fact. It is still worth measuring:
        # the ratio is the honest answer to "what is the platform actually
        # doing for me" when a provider asks at renewal.
        total_enrolments = Enrolment.objects.count()
        attributed = Enrolment.objects.filter(enquiry__isnull=False).count()

        # --- The year-two asset ----------------------------------------------
        completions = Enrolment.objects.filter(completed_on__isnull=False).count()
        attested = Enrolment.objects.exclude(provider_attestation="not_asked").count()
        recommended = Enrolment.objects.filter(provider_attestation="recommended").count()
        # Attestation inflation: a workshop that recommends every graduate makes
        # the signal worthless within one cohort.
        attestation_rate = round(recommended / attested * 100) if attested else None

        # --- Data quality ------------------------------------------------------
        quality = {
            "no_photo": published.filter(photos__isnull=True).count(),
            "no_programme": published.filter(programmes__isnull=True).count(),
            "no_government_record": published.filter(government_status__isnull=True).count(),
            "no_upcoming_intake": published.exclude(
                programmes__intakes__start_date__gte=today,
                programmes__intakes__is_open=True,
            )
            .distinct()
            .count(),
        }

        # --- Coverage -----------------------------------------------------------
        # How many trade-and-area pages have enough inventory to be worth
        # indexing. Ninety thin pages is the Section 04 failure.
        trades = list(Trade.objects.filter(is_active=True).values_list("id", "name"))
        areas = list(Area.objects.values_list("id", "name"))
        counts = {
            (row["programmes__trade"], row["area"]): row["n"]
            for row in published.values("programmes__trade", "area").annotate(
                n=Count("id", distinct=True)
            )
        }
        pairs_total = len(trades) * len(areas)
        pairs_indexable = sum(
            1
            for trade_id, _ in trades
            for area_id, _ in areas
            if counts.get((trade_id, area_id), 0) >= MIN_LISTINGS_FOR_GENERATED_PAGE
        )

        panel = {
            "pipeline": pipeline,
            "verification": {
                "never_visited": never_visited,
                "due_revisit": due_revisit,
                "expiring_soon": expiring_soon,
            },
            "freshness": {"due_confirmation": due_confirmation, "shown_as_stale": shown_as_stale},
            "demand": {
                "enquiries_30": enquiry_count,
                "enquiries_prior_30": enquiries_prior.count(),
                "replied_in_window": replied,
                "response_rate": round(replied / enquiry_count * 100) if enquiry_count else None,
                "enrolments_30": enrolment_stats["n"],
                "enrolment_fees_30": enrolment_stats["fees"],
                "average_fee": enrolment_stats["avg"],
            },
            "leakage": {
                "total": total_enrolments,
                "attributed": attributed,
                "attributed_pct": round(attributed / total_enrolments * 100)
                if total_enrolments
                else None,
            },
            "year_two": {
                "completions": completions,
                "attested": attested,
                "attestation_rate": attestation_rate,
            },
            "quality": quality,
            "coverage": {
                "indexable": pairs_indexable,
                "total": pairs_total,
                "threshold": MIN_LISTINGS_FOR_GENERATED_PAGE,
            },
            "is_super": request.user.is_superuser,
        }

        if request.user.is_superuser:
            active = Subscription.objects.filter(state="active", period_end__gte=today)
            panel["revenue"] = {
                "active": active.count(),
                "paying": active.filter(price__gt=0).count(),
                "monthly_value": active.aggregate(v=Sum("price"))["v"],
            }

        return panel
