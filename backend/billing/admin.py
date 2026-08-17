from django.contrib import admin

from .models import Subscription


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    """Deliberately plain. Section 12 lists willingness to pay as untested and
    the tiers as hypotheses, so this exists to be changed without a rebuild.

    There is no payment integration in version 1: subscriptions are collected
    offline, usually by mobile money, and recorded here.
    """

    list_display = ("provider", "tier", "price", "period_start", "period_end", "state")
    list_filter = ("tier", "state", "period_end")
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider", "recorded_by")
    date_hierarchy = "period_end"
