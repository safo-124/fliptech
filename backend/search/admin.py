from datetime import timedelta

from django.contrib import admin
from django.db.models import Avg, Count, Max
from django.utils import timezone

from .models import SearchLog, TrainingAlert

REPORT_DAYS = 30


class FoundNothing(admin.SimpleListFilter):
    title = "results"
    parameter_name = "found"

    def lookups(self, request, model_admin):
        return [("none", "Found nothing"), ("some", "Found something")]

    def queryset(self, request, queryset):
        if self.value() == "none":
            return queryset.filter(results=0)
        if self.value() == "some":
            return queryset.filter(results__gt=0)
        return queryset


@admin.register(SearchLog)
class SearchLogAdmin(admin.ModelAdmin):
    """Every search, with a report on top: the most common searches over the
    last 30 days, and the ones that found nothing. The second list is the
    useful one: it says which trainers to recruit and which words to add to a
    trade's synonyms."""

    list_display = ("query", "scope", "results", "source", "created_at")
    list_filter = (FoundNothing, "scope", "source")
    search_fields = ("query",)
    date_hierarchy = "created_at"
    readonly_fields = ("query", "scope", "results", "source", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        since = timezone.now() - timedelta(days=REPORT_DAYS)
        recent = SearchLog.objects.filter(created_at__gte=since)
        top = (
            recent.values("query")
            .annotate(times=Count("id"), average=Avg("results"), last=Max("created_at"))
            .order_by("-times", "query")[:20]
        )
        nothing = (
            recent.filter(results=0)
            .values("query")
            .annotate(times=Count("id"), last=Max("created_at"))
            .order_by("-times", "query")[:20]
        )
        extra_context = {
            **(extra_context or {}),
            "report_days": REPORT_DAYS,
            "top_searches": top,
            "empty_searches": nothing,
            "total_searches": recent.count(),
            "empty_total": recent.filter(results=0).count(),
        }
        return super().changelist_view(request, extra_context=extra_context)


@admin.register(TrainingAlert)
class TrainingAlertAdmin(admin.ModelAdmin):
    """Who asked to be texted when a workshop opens. Also demand: a pile of
    alerts for one trade in one area is a place to recruit."""

    list_display = ("trade", "area", "account", "created_at", "last_told_at")
    list_filter = ("trade", "area")
    search_fields = ("account__phone", "trade__name", "area__name")
    readonly_fields = ("account", "trade", "area", "created_at", "checked_at", "last_told_at")
