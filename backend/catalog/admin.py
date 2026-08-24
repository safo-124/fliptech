"""Operational administration for trades, programmes, and dated intakes.

Trade words drive discovery, programme fee and duration drive comparison, and
an open future intake gives a trainee something concrete to act on. These
workspaces surface readiness and demand directly instead of making staff open
every record to discover what needs attention.
"""

from copy import copy
from datetime import timedelta

from django.contrib import admin, messages
from django.contrib.admin.views.main import IncorrectLookupParameters
from django.db.models import (
    BooleanField,
    Case,
    CharField,
    Count,
    OuterRef,
    Q,
    Subquery,
    Value,
    When,
)
from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin
from simple_history.utils import bulk_update_with_history

from providers.models import Provider

from . import queues
from .models import Intake, Programme, Trade

QUEUE_PARAMETER = "queue"


def _reset_url(request):
    """Clear list state while retaining Django's popup selection contract."""
    params = request.GET.copy()
    for key in tuple(params):
        if key not in {"_popup", "_to_field"}:
            params.pop(key)
    return f"?{params.urlencode()}" if params else "?"


def _queue_workspace(
    request,
    *,
    kind,
    title,
    description,
    guidance,
    all_queue,
    queue_options,
    queues_by_key,
    count_map,
):
    """Build queue tabs without losing deliberate search and filter state."""
    current = queues_by_key.get(request.GET.get(QUEUE_PARAMETER))
    base_params = request.GET.copy()
    base_params.pop("p", None)
    all_params = base_params.copy()
    all_params.pop(QUEUE_PARAMETER, None)

    links = [
        {
            "key": all_queue.key,
            "label": all_queue.label,
            "description": all_queue.description,
            "tone": all_queue.tone,
            "count": count_map[all_queue.key],
            "url": f"?{all_params.urlencode()}" if all_params else "?",
            "active": current is None,
        }
    ]
    for queue in queue_options:
        params = base_params.copy()
        params[QUEUE_PARAMETER] = queue.key
        links.append(
            {
                "key": queue.key,
                "label": queue.label,
                "description": queue.description,
                "tone": queue.tone,
                "count": count_map[queue.key],
                "url": f"?{params.urlencode()}",
                "active": current is queue,
            }
        )

    return {
        "kind": kind,
        "eyebrow": "Catalog operations",
        "title": title,
        "description": description,
        "guidance": guidance,
        "matching": count_map[current.key] if current else count_map[all_queue.key],
        "total": count_map[all_queue.key],
        "reset_url": _reset_url(request),
        "current_queue": current,
        "queues": links,
        "metrics": (),
    }


def _filtered_ids(queryset):
    return queryset.order_by().values("pk")


def _trade_metrics(queryset):
    summary = Trade.objects.filter(pk__in=Subquery(_filtered_ids(queryset))).aggregate(
        active=Count("pk", filter=Q(is_active=True), distinct=True),
        active_programmes=Count("programmes", filter=Q(programmes__is_active=True), distinct=True),
        published_providers=Count(
            "programmes__provider",
            filter=Q(
                programmes__is_active=True,
                programmes__provider__status=Provider.Status.PUBLISHED,
            ),
            distinct=True,
        ),
        search_ready=Count(
            "pk",
            filter=Q(is_active=True) & ~Q(description="") & ~Q(synonyms=[]),
            distinct=True,
        ),
    )
    return (
        {"label": "Active trades", "value": summary["active"], "tone": "positive"},
        {
            "label": "Active programmes",
            "value": summary["active_programmes"],
            "tone": "neutral",
        },
        {
            "label": "Published providers",
            "value": summary["published_providers"],
            "tone": "info",
        },
        {"label": "Search-ready", "value": summary["search_ready"], "tone": "positive"},
    )


def _programme_metrics(queryset):
    today = timezone.localdate()
    soon = today + timedelta(days=30)
    summary = Programme.objects.filter(pk__in=Subquery(_filtered_ids(queryset))).aggregate(
        active=Count("pk", filter=Q(is_active=True), distinct=True),
        published=Count(
            "pk",
            filter=Q(is_active=True, provider__status=Provider.Status.PUBLISHED),
            distinct=True,
        ),
        future_ready=Count(
            "pk",
            filter=Q(
                is_active=True,
                intakes__is_open=True,
                intakes__start_date__gte=today,
            ),
            distinct=True,
        ),
        starting_soon=Count(
            "pk",
            filter=Q(
                is_active=True,
                intakes__is_open=True,
                intakes__start_date__range=(today, soon),
            ),
            distinct=True,
        ),
    )
    return (
        {"label": "Active", "value": summary["active"], "tone": "positive"},
        {
            "label": "On published providers",
            "value": summary["published"],
            "tone": "neutral",
        },
        {
            "label": "Future intake ready",
            "value": summary["future_ready"],
            "tone": "info",
        },
        {
            "label": "Starting in 30 days",
            "value": summary["starting_soon"],
            "tone": "positive",
        },
    )


def _intake_metrics(queryset):
    today = timezone.localdate()
    soon = today + timedelta(days=14)
    summary = Intake.objects.filter(pk__in=Subquery(_filtered_ids(queryset))).aggregate(
        upcoming=Count("pk", filter=Q(is_open=True, start_date__gte=today)),
        starting_soon=Count("pk", filter=Q(is_open=True, start_date__range=(today, soon))),
        past_open=Count("pk", filter=Q(is_open=True, start_date__lt=today)),
        availability_known=Count(
            "pk",
            filter=Q(
                is_open=True,
                start_date__gte=today,
                places_remaining__isnull=False,
            ),
        ),
    )
    return (
        {"label": "Upcoming and open", "value": summary["upcoming"], "tone": "positive"},
        {
            "label": "Starting in 14 days",
            "value": summary["starting_soon"],
            "tone": "info",
        },
        {"label": "Past but open", "value": summary["past_open"], "tone": "attention"},
        {
            "label": "Availability known",
            "value": summary["availability_known"],
            "tone": "neutral",
        },
    )


class CatalogQueueFilter(admin.SimpleListFilter):
    title = "work queue"
    parameter_name = QUEUE_PARAMETER
    queue_options = ()
    queues_by_key = {}

    def lookups(self, request, model_admin):
        return [(queue.key, queue.label) for queue in self.queue_options]

    def queryset(self, request, queryset):
        queue = self.queues_by_key.get(self.value())
        return queue.narrow(queryset) if queue else queryset


class TradeQueueFilter(CatalogQueueFilter):
    queue_options = queues.TRADE_QUEUES
    queues_by_key = queues.TRADE_QUEUES_BY_KEY


class ProgrammeQueueFilter(CatalogQueueFilter):
    queue_options = queues.PROGRAMME_QUEUES
    queues_by_key = queues.PROGRAMME_QUEUES_BY_KEY


class IntakeQueueFilter(CatalogQueueFilter):
    queue_options = queues.INTAKE_QUEUES
    queues_by_key = queues.INTAKE_QUEUES_BY_KEY


class IntakeInline(admin.TabularInline):
    model = Intake
    extra = 1
    fields = ("start_date", "places_offered", "places_remaining", "is_open")
    show_change_link = True
    verbose_name_plural = "Dated intakes"


class CatalogWorkspaceMixin:
    """Finish shared workbench data after Django builds its ChangeList."""

    workspace_metrics = staticmethod(lambda queryset: ())

    def get_queue_scope_queryset(self, request):
        """Apply search and native filters without narrowing to one queue.

        Queue-card counts then describe exactly what each preserved link will
        open, even when an officer combines a queue with text search, region,
        trade, date, or another native Django filter.
        """
        secondary_keys = set(request.GET) - {
            QUEUE_PARAMETER,
            "p",
            "_popup",
            "_to_field",
        }
        if not secondary_keys:
            return self.get_queryset(request)

        scoped_request = copy(request)
        scoped_request.GET = request.GET.copy()
        scoped_request.GET.pop(QUEUE_PARAMETER, None)
        scoped_request.GET.pop("p", None)
        try:
            return self.get_changelist_instance(scoped_request).queryset
        except IncorrectLookupParameters:
            # Django's real ChangeList will redirect invalid lookups to ?e=1.
            # Keep enough context available for that response to render.
            return self.get_queryset(request)

    def changelist_view(self, request, extra_context=None):
        context = {
            "catalog_workspace": self.build_workspace(
                request,
                queryset=self.get_queue_scope_queryset(request),
            )
        }
        context.update(extra_context or {})
        response = super().changelist_view(request, extra_context=context)
        if hasattr(response, "context_data") and response.context_data.get("cl"):
            cl = response.context_data["cl"]
            workspace = response.context_data["catalog_workspace"]
            workspace["matching"] = cl.result_count
            workspace["total"] = cl.full_result_count
            workspace["metrics"] = self.workspace_metrics(cl.queryset)
        return response


@admin.register(Trade)
class TradeAdmin(CatalogWorkspaceMixin, admin.ModelAdmin):
    list_display = (
        "name",
        "inventory_summary",
        "search_readiness",
        "display_order",
        "is_active",
    )
    list_editable = ("display_order", "is_active")
    list_filter = (TradeQueueFilter, "is_active")
    prepopulated_fields = {"slug": ("name",)}
    search_fields = ("name", "slug", "synonyms")
    search_help_text = "Search by trade name, public slug, or alternative search word."
    readonly_fields = ("created_at", "updated_at")
    actions = ("activate_trades", "deactivate_trades")
    change_list_template = "admin/catalog/trade/change_list.html"
    change_form_template = "admin/catalog/trade/change_form.html"
    workspace_metrics = staticmethod(_trade_metrics)
    fieldsets = (
        ("Trade identity", {"fields": ("name", "slug")}),
        (
            "Search language",
            {
                "fields": ("synonyms",),
                "description": (
                    "Add words trainees actually use, such as welder, fabrication, sewing, "
                    "or fitter. Enter one lowercase term per item."
                ),
            },
        ),
        (
            "Public explanation",
            {
                "fields": ("description",),
                "description": "Explain the work plainly for the public trade page.",
            },
        ),
        ("Publication", {"fields": ("display_order", "is_active")}),
        ("Record", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                admin_programme_count=Count("programmes", distinct=True),
                admin_active_programme_count=Count(
                    "programmes", filter=Q(programmes__is_active=True), distinct=True
                ),
                admin_provider_count=Count("programmes__provider", distinct=True),
                admin_published_provider_count=Count(
                    "programmes__provider",
                    filter=Q(
                        programmes__is_active=True,
                        programmes__provider__status=Provider.Status.PUBLISHED,
                    ),
                    distinct=True,
                ),
            )
        )

    def build_workspace(self, request, queryset=None):
        queryset = self.get_queryset(request) if queryset is None else queryset
        return _queue_workspace(
            request,
            kind="trades",
            title="Trade discovery readiness",
            description=(
                "Keep public trade vocabulary useful and see whether each category has "
                "active programmes on published providers."
            ),
            guidance={
                "title": "Useful categories before more categories",
                "description": (
                    "An active trade needs a plain-language description, useful search "
                    "synonyms, and at least one active programme."
                ),
                "tone": "info",
            },
            all_queue=queues.TRADE_ALL,
            queue_options=queues.TRADE_QUEUES,
            queues_by_key=queues.TRADE_QUEUES_BY_KEY,
            count_map=queues.trade_counts(queryset),
        )

    @admin.display(description="Inventory", ordering="admin_active_programme_count")
    def inventory_summary(self, obj):
        return format_html(
            '<span class="cat-stack"><strong>{} active programme{}</strong>'
            "<small>{} total · {} published provider{}</small></span>",
            obj.admin_active_programme_count,
            "" if obj.admin_active_programme_count == 1 else "s",
            obj.admin_programme_count,
            obj.admin_published_provider_count,
            "" if obj.admin_published_provider_count == 1 else "s",
        )

    @admin.display(description="Search readiness")
    def search_readiness(self, obj):
        synonyms = len(obj.synonyms or [])
        if obj.description and synonyms:
            tone, label = "positive", "Ready"
            detail = f"{synonyms} search term{'s' if synonyms != 1 else ''}"
        elif not obj.description and not synonyms:
            tone, label, detail = "attention", "Needs content", "description and synonyms missing"
        elif not obj.description:
            tone, label, detail = "warning", "Needs description", f"{synonyms} search terms"
        else:
            tone, label, detail = "warning", "Needs synonyms", "search language missing"
        return format_html(
            '<span class="cat-status cat-status--{}"><strong>{}</strong><small>{}</small></span>',
            tone,
            label,
            detail,
        )

    def view_on_site(self, obj):
        return f"/trades/{obj.slug}"

    @admin.action(description="Activate selected trades", permissions=("change",))
    def activate_trades(self, request, queryset):
        changed = queryset.update(is_active=True)
        self.message_user(request, f"Activated {changed} trade(s).", messages.SUCCESS)

    @admin.action(description="Deactivate selected trades", permissions=("change",))
    def deactivate_trades(self, request, queryset):
        changed = queryset.update(is_active=False)
        self.message_user(request, f"Deactivated {changed} trade(s).", messages.SUCCESS)


@admin.register(Programme)
class ProgrammeAdmin(CatalogWorkspaceMixin, SimpleHistoryAdmin):
    list_display = (
        "title",
        "provider_summary",
        "offering_summary",
        "schedule_summary",
        "intake_summary",
        "demand_summary",
        "is_active",
    )
    list_editable = ("is_active",)
    list_filter = (
        ProgrammeQueueFilter,
        "trade",
        "is_active",
        "instalments_allowed",
        "provider__area__region",
    )
    search_fields = ("title", "provider__name", "provider__contact_phone", "trade__name")
    search_help_text = "Search by programme, provider, contact phone, or trade."
    autocomplete_fields = ("provider", "trade")
    inlines = (IntakeInline,)
    list_select_related = ("provider", "provider__area", "provider__area__region", "trade")
    readonly_fields = ("created_at", "updated_at")
    actions = ("activate_programmes", "deactivate_programmes")
    change_list_template = "admin/catalog/programme/change_list.html"
    change_form_template = "admin/catalog/programme/change_form.html"
    workspace_metrics = staticmethod(_programme_metrics)
    fieldsets = (
        (
            "Offering",
            {
                "fields": ("provider", "trade", "title", "is_active"),
                "description": "Provider and trade decide where this course appears publicly.",
            },
        ),
        (
            "Cost",
            {
                "fields": ("fee", "instalments_allowed", "instalment_note"),
                "description": "Show the full fee and explain any instalment arrangement.",
            },
        ),
        (
            "Time and capacity",
            {
                "fields": ("duration_weeks", "hours_per_week", "weekly_schedule", "capacity"),
                "description": (
                    "A concrete weekly schedule and capacity help staff confirm availability "
                    "before publishing the next intake."
                ),
            },
        ),
        ("Record", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    def get_queryset(self, request):
        today = timezone.localdate()
        next_intake = Intake.objects.filter(
            programme_id=OuterRef("pk"), is_open=True, start_date__gte=today
        ).order_by("start_date", "pk")
        return (
            super()
            .get_queryset(request)
            .select_related("provider", "provider__area", "provider__area__region", "trade")
            .annotate(
                admin_next_intake=Subquery(next_intake.values("start_date")[:1]),
                admin_next_places_offered=Subquery(next_intake.values("places_offered")[:1]),
                admin_next_places_remaining=Subquery(next_intake.values("places_remaining")[:1]),
                admin_can_view_provider=Value(
                    request.user.has_perm("providers.view_provider"),
                    output_field=BooleanField(),
                ),
                admin_intake_count=Count("intakes", distinct=True),
                admin_future_intake_count=Count(
                    "intakes",
                    filter=Q(intakes__is_open=True, intakes__start_date__gte=today),
                    distinct=True,
                ),
                admin_enquiry_count=Count("enquiries", distinct=True),
                admin_enrolment_count=Count("enrolments", distinct=True),
            )
        )

    def build_workspace(self, request, queryset=None):
        queryset = self.get_queryset(request) if queryset is None else queryset
        return _queue_workspace(
            request,
            kind="programmes",
            title="Programme readiness",
            description=(
                "Audit what providers teach, what it costs, how long it takes, and whether "
                "trainees have a real future intake to choose."
            ),
            guidance={
                "title": "Decision-ready before active",
                "description": (
                    "Fee and duration are required. Attention therefore focuses on schedule, "
                    "capacity, instalment detail, and future intakes."
                ),
                "tone": "info",
            },
            all_queue=queues.PROGRAMME_ALL,
            queue_options=queues.PROGRAMME_QUEUES,
            queues_by_key=queues.PROGRAMME_QUEUES_BY_KEY,
            count_map=queues.programme_counts(queryset),
        )

    @admin.display(description="Provider", ordering="provider__name")
    def provider_summary(self, obj):
        if not obj.admin_can_view_provider:
            return format_html(
                '<span class="cat-stack"><strong>{}</strong><small>{}, {}</small></span>',
                obj.provider.name,
                obj.provider.area.name,
                obj.provider.area.region.name,
            )
        url = reverse("admin:providers_provider_change", args=[obj.provider_id])
        return format_html(
            '<span class="cat-stack"><a href="{}"><strong>{}</strong></a>'
            "<small>{}, {}</small></span>",
            url,
            obj.provider.name,
            obj.provider.area.name,
            obj.provider.area.region.name,
        )

    @admin.display(description="Offering", ordering="fee")
    def offering_summary(self, obj):
        fee = f"{obj.fee:,.2f}".rstrip("0").rstrip(".")
        return format_html(
            '<span class="cat-stack"><strong>{}</strong><small>GH₵{} · {} week{}</small></span>',
            obj.trade.name,
            fee,
            obj.duration_weeks,
            "" if obj.duration_weeks == 1 else "s",
        )

    @admin.display(description="Schedule")
    def schedule_summary(self, obj):
        if obj.weekly_schedule:
            detail = (
                f"{obj.hours_per_week} hours/week"
                if obj.hours_per_week is not None
                else "weekly hours not set"
            )
            return format_html(
                '<span class="cat-stack"><strong>{}</strong><small>{}</small></span>',
                obj.weekly_schedule,
                detail,
            )
        return format_html(
            '<span class="cat-status cat-status--warning"><strong>{}</strong><small>{}</small></span>',
            "Schedule missing",
            "add days and times",
        )

    @admin.display(description="Next intake", ordering="admin_next_intake")
    def intake_summary(self, obj):
        if obj.admin_next_intake is None:
            return format_html(
                '<span class="cat-status cat-status--attention"><strong>{}</strong>'
                "<small>{} intake{} recorded</small></span>",
                "No future intake",
                obj.admin_intake_count,
                "" if obj.admin_intake_count == 1 else "s",
            )
        date = obj.admin_next_intake.strftime("%d %b %Y")
        remaining = obj.admin_next_places_remaining
        if remaining is None:
            tone, detail = "warning", "availability unconfirmed"
        elif remaining == 0:
            tone, detail = "warning", "full · close or update"
        else:
            tone, detail = "positive", f"{remaining} place{'s' if remaining != 1 else ''} left"
        return format_html(
            '<span class="cat-status cat-status--{}"><strong>{}</strong><small>{}</small></span>',
            tone,
            date,
            detail,
        )

    @admin.display(description="Demand", ordering="admin_enquiry_count")
    def demand_summary(self, obj):
        return format_html(
            '<span class="cat-stack"><strong>{} enquir{}</strong><small>{} enrolment{}</small></span>',
            obj.admin_enquiry_count,
            "y" if obj.admin_enquiry_count == 1 else "ies",
            obj.admin_enrolment_count,
            "" if obj.admin_enrolment_count == 1 else "s",
        )

    def view_on_site(self, obj):
        return f"/{obj.provider.area.slug}/{obj.provider.slug}"

    @admin.action(description="Activate selected programmes", permissions=("change",))
    def activate_programmes(self, request, queryset):
        programmes = list(queryset.filter(is_active=False))
        changed = self._set_active_with_history(
            programmes,
            is_active=True,
            user=request.user,
            reason="Activated from Catalog admin.",
        )
        self.message_user(request, f"Activated {changed} programme(s).", messages.SUCCESS)

    @admin.action(description="Deactivate selected programmes", permissions=("change",))
    def deactivate_programmes(self, request, queryset):
        programmes = list(queryset.filter(is_active=True))
        changed = self._set_active_with_history(
            programmes,
            is_active=False,
            user=request.user,
            reason="Deactivated from Catalog admin.",
        )
        self.message_user(request, f"Deactivated {changed} programme(s).", messages.SUCCESS)

    @staticmethod
    def _set_active_with_history(programmes, *, is_active, user, reason):
        if not programmes:
            return 0
        changed_at = timezone.now()
        for programme in programmes:
            programme.is_active = is_active
            programme.updated_at = changed_at
        return bulk_update_with_history(
            programmes,
            Programme,
            fields=("is_active", "updated_at"),
            default_user=user,
            default_change_reason=reason,
        )


@admin.register(Intake)
class IntakeAdmin(CatalogWorkspaceMixin, admin.ModelAdmin):
    list_display = (
        "programme",
        "provider_summary",
        "start_date",
        "lifecycle_status",
        "availability_summary",
        "demand_summary",
        "is_open",
    )
    list_editable = ("is_open",)
    list_filter = (
        IntakeQueueFilter,
        "is_open",
        "programme__trade",
        "programme__provider__area__region",
        "start_date",
    )
    search_fields = (
        "programme__title",
        "programme__provider__name",
        "programme__provider__contact_phone",
        "programme__trade__name",
    )
    search_help_text = "Search by programme, provider, contact phone, or trade."
    autocomplete_fields = ("programme",)
    date_hierarchy = "start_date"
    list_select_related = (
        "programme",
        "programme__provider",
        "programme__provider__area",
        "programme__provider__area__region",
        "programme__trade",
    )
    readonly_fields = ("created_at", "updated_at")
    actions = ("open_intakes", "close_intakes")
    change_list_template = "admin/catalog/intake/change_list.html"
    change_form_template = "admin/catalog/intake/change_form.html"
    workspace_metrics = staticmethod(_intake_metrics)
    fieldsets = (
        (
            "Start",
            {
                "fields": ("programme", "start_date", "is_open"),
                "description": "Only open future intakes are shown to trainees.",
            },
        ),
        (
            "Availability",
            {
                "fields": ("places_offered", "places_remaining"),
                "description": (
                    "Update remaining places whenever the provider confirms availability. "
                    "A zero-place intake should be closed or corrected."
                ),
            },
        ),
        ("Record", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related(
                "programme",
                "programme__provider",
                "programme__provider__area",
                "programme__provider__area__region",
                "programme__trade",
            )
            .annotate(
                admin_can_view_provider=Value(
                    request.user.has_perm("providers.view_provider"),
                    output_field=BooleanField(),
                ),
                admin_enquiry_count=Count("enquiries", distinct=True),
                admin_enrolment_count=Count("enrolments", distinct=True),
                admin_lifecycle=Case(
                    When(is_open=False, then=Value("muted")),
                    When(
                        is_open=True, start_date__lt=timezone.localdate(), then=Value("attention")
                    ),
                    When(is_open=True, places_remaining=0, then=Value("warning")),
                    When(is_open=True, start_date=timezone.localdate(), then=Value("info")),
                    default=Value("positive"),
                    output_field=CharField(),
                ),
                admin_lifecycle_label=Case(
                    When(is_open=False, then=Value("Closed")),
                    When(
                        is_open=True,
                        start_date__lt=timezone.localdate(),
                        then=Value("Past · still open"),
                    ),
                    When(is_open=True, places_remaining=0, then=Value("Full · still open")),
                    When(is_open=True, start_date=timezone.localdate(), then=Value("Starts today")),
                    default=Value("Open"),
                    output_field=CharField(),
                ),
            )
        )

    def build_workspace(self, request, queryset=None):
        queryset = self.get_queryset(request) if queryset is None else queryset
        return _queue_workspace(
            request,
            kind="intakes",
            title="Intake availability",
            description=(
                "Keep start dates and remaining places current so trainees do not enquire "
                "about a course that has already started or filled up."
            ),
            guidance={
                "title": "Open dates are promises",
                "description": (
                    "An intake is actionable when it is open, starts today or later, and has "
                    "honest availability information."
                ),
                "tone": "attention",
            },
            all_queue=queues.INTAKE_ALL,
            queue_options=queues.INTAKE_QUEUES,
            queues_by_key=queues.INTAKE_QUEUES_BY_KEY,
            count_map=queues.intake_counts(queryset),
        )

    @admin.display(description="Provider and trade", ordering="programme__provider__name")
    def provider_summary(self, obj):
        if not obj.admin_can_view_provider:
            return format_html(
                '<span class="cat-stack"><strong>{}</strong><small>{} · {}</small></span>',
                obj.programme.provider.name,
                obj.programme.trade.name,
                obj.programme.provider.area.name,
            )
        provider_url = reverse("admin:providers_provider_change", args=[obj.programme.provider_id])
        return format_html(
            '<span class="cat-stack"><a href="{}"><strong>{}</strong></a>'
            "<small>{} · {}</small></span>",
            provider_url,
            obj.programme.provider.name,
            obj.programme.trade.name,
            obj.programme.provider.area.name,
        )

    @admin.display(description="Lifecycle", ordering="start_date")
    def lifecycle_status(self, obj):
        today = timezone.localdate()
        if not obj.is_open:
            tone, label, detail = "muted", "Closed", obj.start_date.strftime("%d %b %Y")
        elif obj.start_date < today:
            tone, label, detail = "attention", "Past · still open", "close this intake"
        elif obj.places_remaining == 0:
            tone, label, detail = "warning", "Full · still open", "close or update places"
        elif obj.start_date == today:
            tone, label, detail = "info", "Starts today", "confirm availability"
        else:
            tone, label, detail = "positive", "Open", "future start"
        return format_html(
            '<span class="cat-status cat-status--{}"><strong>{}</strong><small>{}</small></span>',
            tone,
            label,
            detail,
        )

    @admin.display(description="Availability", ordering="places_remaining")
    def availability_summary(self, obj):
        offered, remaining = obj.places_offered, obj.places_remaining
        if offered is None and remaining is None:
            tone, label, detail = "warning", "Unknown", "confirm places"
        elif remaining is None:
            tone, label, detail = "warning", "Unconfirmed", f"{offered} offered"
        elif offered is None:
            tone, label, detail = "info", f"{remaining} remaining", "total not set"
        else:
            tone = "attention" if remaining == 0 else "positive"
            label, detail = f"{remaining} remaining", f"of {offered} offered"
        return format_html(
            '<span class="cat-status cat-status--{}"><strong>{}</strong><small>{}</small></span>',
            tone,
            label,
            detail,
        )

    @admin.display(description="Demand", ordering="admin_enquiry_count")
    def demand_summary(self, obj):
        return format_html(
            '<span class="cat-stack"><strong>{} enquir{}</strong><small>{} enrolment{}</small></span>',
            obj.admin_enquiry_count,
            "y" if obj.admin_enquiry_count == 1 else "ies",
            obj.admin_enrolment_count,
            "" if obj.admin_enrolment_count == 1 else "s",
        )

    def view_on_site(self, obj):
        provider = obj.programme.provider
        return f"/{provider.area.slug}/{provider.slug}"

    @admin.action(description="Open selected future intakes", permissions=("change",))
    def open_intakes(self, request, queryset):
        selected = queryset.count()
        eligible = queryset.filter(start_date__gte=timezone.localdate()).exclude(places_remaining=0)
        changed = eligible.update(is_open=True)
        skipped = selected - changed
        self.message_user(request, f"Opened {changed} intake(s).", messages.SUCCESS)
        if skipped:
            self.message_user(
                request,
                f"Skipped {skipped} past or full intake(s).",
                messages.WARNING,
            )

    @admin.action(description="Close selected intakes", permissions=("change",))
    def close_intakes(self, request, queryset):
        changed = queryset.update(is_open=False)
        self.message_user(request, f"Closed {changed} intake(s).", messages.SUCCESS)
