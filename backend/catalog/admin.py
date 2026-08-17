"""Trades, programmes and intakes.

Fee, duration and next intake are what Screen 1 puts on the card, so those are
the fields the back office must make quick to enter and quick to audit.
"""

from django.contrib import admin

from .models import Intake, Programme, Trade


class IntakeInline(admin.TabularInline):
    model = Intake
    extra = 1
    fields = ("start_date", "places_offered", "places_remaining", "is_open")


@admin.register(Trade)
class TradeAdmin(admin.ModelAdmin):
    list_display = ("name", "display_order", "programme_count", "is_active")
    list_editable = ("display_order", "is_active")
    prepopulated_fields = {"slug": ("name",)}
    search_fields = ("name", "synonyms")

    fieldsets = (
        (None, {"fields": ("name", "slug", "display_order", "is_active")}),
        (
            "Search",
            {
                "fields": ("synonyms",),
                "description": (
                    "Alternative words people type: welder, fabrication, sewing, fitter. "
                    "These are what make search find a workshop whose listed name uses a "
                    "different word."
                ),
            },
        ),
        ("Public page", {"fields": ("description",)}),
    )

    @admin.display(description="Programmes")
    def programme_count(self, obj):
        return obj.programmes.count()


@admin.register(Programme)
class ProgrammeAdmin(admin.ModelAdmin):
    list_display = ("title", "provider", "trade", "fee", "duration_weeks", "next_intake")
    list_filter = ("trade", "is_active", "instalments_allowed")
    search_fields = ("title", "provider__name")
    autocomplete_fields = ("provider", "trade")
    inlines = [IntakeInline]
    list_select_related = ("provider", "trade")

    fieldsets = (
        (None, {"fields": ("provider", "trade", "title", "is_active")}),
        ("Cost", {"fields": ("fee", "instalments_allowed", "instalment_note")}),
        ("Time", {"fields": ("duration_weeks", "hours_per_week", "weekly_schedule", "capacity")}),
    )

    @admin.display(description="Next intake")
    def next_intake(self, obj):
        from django.utils import timezone

        intake = obj.intakes.filter(start_date__gte=timezone.now().date(), is_open=True).first()
        return intake.start_date if intake else "—"


@admin.register(Intake)
class IntakeAdmin(admin.ModelAdmin):
    list_display = ("programme", "start_date", "places_offered", "places_remaining", "is_open")
    list_filter = ("is_open", "start_date")
    search_fields = ("programme__title", "programme__provider__name")
    autocomplete_fields = ("programme",)
    date_hierarchy = "start_date"
