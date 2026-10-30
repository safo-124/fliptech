from django.contrib import admin

from .models import CourseOffer, CoursePurchase


@admin.register(CourseOffer)
class CourseOfferAdmin(admin.ModelAdmin):
    """Each workshop's course price and where its sales are paid.

    Read-only: the trainer sets these from their dashboard, and the payout
    account is created at Paystack, which is the only place it can change.
    """

    list_display = ("provider", "price", "payout_bank_name", "payout_account_last4", "updated_at")
    search_fields = ("provider__name",)
    readonly_fields = [field.name for field in CourseOffer._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(CoursePurchase)
class CoursePurchaseAdmin(admin.ModelAdmin):
    """Every attempt to buy a course, and what Paystack said about it.

    Read-only, so a course is never marked paid by hand: only Paystack's
    confirmation does that. Refunds happen in the Paystack dashboard.
    """

    list_display = ("reference", "provider", "trainee", "amount", "status", "channel", "paid_at")
    list_filter = ("status", "channel")
    search_fields = ("reference", "provider__name", "trainee__phone")
    readonly_fields = [field.name for field in CoursePurchase._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
