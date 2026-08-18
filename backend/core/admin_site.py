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
                worth indexing, and where the field team should go next

Charts are inline SVG rendered here on the server — see core/charts.py for why.
Money and subscription figures are shown to superusers only.
"""

from collections import OrderedDict
from datetime import datetime, time, timedelta

from django.contrib.admin import AdminSite
from django.db.models import Avg, Count, F, Q, Sum
from django.utils import timezone

from . import charts

VERIFICATION_MAX_AGE_DAYS = 365
CONFIRMATION_DUE_DAYS = 90
CONFIRMATION_STALE_DAYS = 120
MIN_LISTINGS_FOR_GENERATED_PAGE = 3
REPLY_WINDOW_HOURS = 48
TREND_WEEKS = 12
TREND_MONTHS = 6


class SkillsHubAdminSite(AdminSite):
    index_template = "admin/skillshub_index.html"

    def index(self, request, extra_context=None):
        context = {**(extra_context or {}), "panel": self.build_panel(request)}
        return super().index(request, extra_context=context)

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _weekly(queryset, field, weeks=TREND_WEEKS):
        """Counts per week, oldest first, with empty weeks kept as zero.

        Gaps matter here: a week with no enquiries is a real observation about
        demand, and dropping it would draw a flattering line.
        """
        now = timezone.now()
        start = (now - timedelta(weeks=weeks - 1)).date()
        start -= timedelta(days=start.weekday())

        buckets = OrderedDict()
        for i in range(weeks):
            buckets[start + timedelta(weeks=i)] = 0

        # Comparing a DateTimeField against a bare date makes Django build a
        # naive datetime, which warns under USE_TZ and silently shifts the
        # boundary by the UTC offset. Build an aware bound instead, and read
        # each value back in local time so a Friday-evening enquiry in Accra
        # does not land in Saturday's bucket.
        tz = timezone.get_current_timezone()
        lower = datetime.combine(start, time.min, tzinfo=tz)

        rows = queryset.filter(**{f"{field}__gte": lower})
        for value in rows.values_list(field, flat=True):
            day = timezone.localtime(value).date() if isinstance(value, datetime) else value
            monday = day - timedelta(days=day.weekday())
            if monday in buckets:
                buckets[monday] += 1

        labels = [d.strftime("%-d %b") if hasattr(d, "strftime") else str(d) for d in buckets]
        return list(buckets.values()), labels

    @staticmethod
    def _monthly(queryset, field, months=TREND_MONTHS):
        today = timezone.now().date()
        buckets = OrderedDict()
        year, month = today.year, today.month
        keys = []
        for _ in range(months):
            keys.append((year, month))
            month -= 1
            if month == 0:
                month, year = 12, year - 1
        for key in reversed(keys):
            buckets[key] = 0

        earliest = min(buckets)
        cutoff = datetime(earliest[0], earliest[1], 1).date()
        for value in queryset.filter(**{f"{field}__gte": cutoff}).values_list(field, flat=True):
            day = timezone.localtime(value).date() if isinstance(value, datetime) else value
            key = (day.year, day.month)
            if key in buckets:
                buckets[key] += 1

        labels = [datetime(y, m, 1).strftime("%b") for y, m in buckets]
        return list(buckets.values()), labels

    # -- the panel ---------------------------------------------------------

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

        # --- Pipeline -------------------------------------------------------
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
        pipeline_bar = charts.stacked_bar(
            [
                ("Draft", pipeline["draft"], charts.MUTED),
                ("Awaiting approval", pipeline["pending"], charts.WARN),
                ("Published", pipeline["published"], charts.GOOD),
                ("Suspended", pipeline["suspended"], charts.BAD),
            ]
        )

        published = Provider.objects.filter(status=Provider.Status.PUBLISHED)
        published_count = pipeline["published"]

        # --- Verification ---------------------------------------------------
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
        visited = published_count - never_visited

        # --- Freshness -------------------------------------------------------
        due_confirmation = published.filter(
            Q(last_confirmed_at__lt=now - timedelta(days=CONFIRMATION_DUE_DAYS))
            | Q(last_confirmed_at__isnull=True)
        ).count()
        shown_as_stale = published.filter(
            Q(last_confirmed_at__lt=now - timedelta(days=CONFIRMATION_STALE_DAYS))
            | Q(last_confirmed_at__isnull=True)
        ).count()

        # --- Demand -----------------------------------------------------------
        enquiries_30 = Enquiry.objects.filter(created_at__gte=last_30)
        enquiry_count = enquiries_30.count()
        prior_count = Enquiry.objects.filter(
            created_at__gte=prior_30, created_at__lt=last_30
        ).count()
        replied = enquiries_30.filter(
            outcome__replied=True,
            outcome__replied_at__lte=F("created_at") + timedelta(hours=REPLY_WINDOW_HOURS),
        ).count()

        enquiry_series, enquiry_labels = self._weekly(Enquiry.objects.all(), "created_at")
        enrolment_series, enrolment_labels = self._monthly(Enrolment.objects.all(), "started_on")

        enrolments_30 = Enrolment.objects.filter(started_on__gte=last_30.date())
        enrolment_stats = enrolments_30.aggregate(
            n=Count("id"), fees=Sum("fee_paid"), avg=Avg("fee_paid")
        )

        # --- Leakage -----------------------------------------------------------
        total_enrolments = Enrolment.objects.count()
        attributed = Enrolment.objects.filter(enquiry__isnull=False).count()

        # --- Year two -----------------------------------------------------------
        completions = Enrolment.objects.filter(completed_on__isnull=False).count()
        attested = Enrolment.objects.exclude(provider_attestation="not_asked").count()
        recommended = Enrolment.objects.filter(provider_attestation="recommended").count()
        attestation_rate = round(recommended / attested * 100) if attested else None

        # --- Quality --------------------------------------------------------------
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
        complete = published_count - sum(quality.values())

        # --- Coverage grid ----------------------------------------------------------
        trades = list(Trade.objects.filter(is_active=True).order_by("display_order", "name"))
        areas = list(Area.objects.select_related("region").order_by("region__name", "name"))
        counts = {
            (row["programmes__trade"], row["area"]): row["n"]
            for row in published.values("programmes__trade", "area").annotate(
                n=Count("id", distinct=True)
            )
        }
        matrix = [[counts.get((t.id, a.id), 0) for a in areas] for t in trades]
        pairs_total = len(trades) * len(areas)
        pairs_indexable = sum(
            1 for row in matrix for v in row if v >= MIN_LISTINGS_FOR_GENERATED_PAGE
        )

        # --- Rankings -------------------------------------------------------------------
        top_trades = [
            (t["programmes__trade__name"], t["n"])
            for t in published.values("programmes__trade__name")
            .annotate(n=Count("id", distinct=True))
            .order_by("-n")[:6]
            if t["programmes__trade__name"]
        ]
        top_areas = [
            (a["area__name"], a["n"])
            for a in published.values("area__name")
            .annotate(n=Count("id", distinct=True))
            .order_by("-n")[:6]
        ]
        enquiry_by_trade = [
            (e["programme__trade__name"], e["n"])
            for e in Enquiry.objects.values("programme__trade__name")
            .annotate(n=Count("id"))
            .order_by("-n")[:6]
            if e["programme__trade__name"]
        ]

        panel = {
            "pipeline": pipeline,
            "pipeline_bar": pipeline_bar,
            "verification": {
                "never_visited": never_visited,
                "due_revisit": due_revisit,
                "expiring_soon": expiring_soon,
                "visited": visited,
                "published": published_count,
                "ring": charts.ring(visited, published_count),
            },
            "freshness": {
                "due_confirmation": due_confirmation,
                "shown_as_stale": shown_as_stale,
                "fresh": published_count - shown_as_stale,
                "published": published_count,
                "ring": charts.ring(
                    published_count - shown_as_stale,
                    published_count,
                    colour=charts.GOOD if not shown_as_stale else charts.WARN,
                ),
            },
            "demand": {
                "enquiries_30": enquiry_count,
                "enquiries_prior_30": prior_count,
                "change_pct": (
                    round((enquiry_count - prior_count) / prior_count * 100)
                    if prior_count
                    else None
                ),
                "replied_in_window": replied,
                "response_rate": round(replied / enquiry_count * 100) if enquiry_count else None,
                "enrolments_30": enrolment_stats["n"],
                "enrolment_fees_30": enrolment_stats["fees"],
                "average_fee": enrolment_stats["avg"],
                "enquiry_chart": charts.column_chart(enquiry_series, enquiry_labels),
                "enquiry_spark": charts.sparkline(enquiry_series, enquiry_labels),
                "enrolment_chart": charts.column_chart(
                    enrolment_series, enrolment_labels, colour=charts.GOOD
                ),
            },
            "leakage": {
                "total": total_enrolments,
                "attributed": attributed,
                "attributed_pct": (
                    round(attributed / total_enrolments * 100) if total_enrolments else None
                ),
                "bar": charts.stacked_bar(
                    [
                        ("Through the platform", attributed, charts.GOOD),
                        (
                            "Found the workshop directly",
                            total_enrolments - attributed,
                            charts.MUTED,
                        ),
                    ]
                ),
            },
            "year_two": {
                "completions": completions,
                "attested": attested,
                "recommended": recommended,
                "attestation_rate": attestation_rate,
                "inflated": attestation_rate is not None and attestation_rate >= 95,
            },
            "quality": quality,
            "quality_bar": charts.stacked_bar(
                [
                    ("Complete", max(complete, 0), charts.GOOD),
                    ("Missing something", sum(quality.values()), charts.WARN),
                ]
            ),
            "coverage": {
                "indexable": pairs_indexable,
                "total": pairs_total,
                "threshold": MIN_LISTINGS_FOR_GENERATED_PAGE,
                "heatmap": charts.heatmap(
                    [t.name for t in trades],
                    [a.name for a in areas],
                    matrix,
                    MIN_LISTINGS_FOR_GENERATED_PAGE,
                ),
            },
            "rankings": {
                "trades": charts.bar_list(top_trades),
                "areas": charts.bar_list(top_areas),
                "enquiry_trades": charts.bar_list(enquiry_by_trade, colour=charts.GOOD),
            },
            "is_super": request.user.is_superuser,
        }

        if request.user.is_superuser:
            active = Subscription.objects.filter(state="active", period_end__gte=today)
            paying = active.filter(price__gt=0).count()
            panel["revenue"] = {
                "active": active.count(),
                "paying": paying,
                "free": active.count() - paying,
                "monthly_value": active.aggregate(v=Sum("price"))["v"],
                "bar": charts.stacked_bar(
                    [
                        ("Paying", paying, charts.GOOD),
                        ("Free listing", active.count() - paying, charts.MUTED),
                    ]
                ),
            }

        return panel
