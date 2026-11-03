from django.contrib import admin
from django.utils import timezone

from .models import AppToken, CustomerAccount


@admin.register(CustomerAccount)
class CustomerAccountAdmin(admin.ModelAdmin):
    """Everyone who has signed in. Read-mostly: switching one off is the only
    change staff make here; what they buy and sell lives on their orders."""

    list_display = ("phone", "display_name", "email", "is_active", "created_at", "last_seen_at")
    list_filter = ("is_active",)
    search_fields = ("phone", "display_name", "email")
    readonly_fields = ("user", "phone", "phone_verified_at", "email_verified_at", "created_at")
    fields = (*readonly_fields, "display_name", "email", "delivery_address", "is_active")

    def has_add_permission(self, request):
        return False


@admin.register(AppToken)
class AppTokenAdmin(admin.ModelAdmin):
    """Each phone signed in to the app. Revoke one for a lost or stolen phone:
    that phone is signed out at its next request. The token itself is never
    stored, only its hash, so there is nothing here to copy."""

    list_display = ("user", "device", "created_at", "last_used_at", "revoked_at")
    list_filter = (("revoked_at", admin.EmptyFieldListFilter),)
    search_fields = ("user__username", "device", "user__customer_account__phone")
    readonly_fields = ("user", "device", "created_at", "last_used_at", "revoked_at")
    exclude = ("key_hash",)
    actions = ["revoke"]

    @admin.action(description="Sign these phones out")
    def revoke(self, request, queryset):
        count = queryset.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        self.message_user(request, f"{count} phone(s) signed out.")

    def has_add_permission(self, request):
        return False
