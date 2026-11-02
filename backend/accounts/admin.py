from django.contrib import admin

from .models import CustomerAccount


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
