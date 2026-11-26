from django.contrib import admin, messages
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin
from django.core.exceptions import PermissionDenied
from django.utils import timezone

from core.name_check_admin import NameCheckMixin

from .models import AppToken, CustomerAccount, PayoutAccount
from .removal_admin import UserRemovalAdmin

User = get_user_model()
if admin.site.is_registered(User):
    admin.site.unregister(User)


@admin.register(User)
class LoginAdmin(UserRemovalAdmin, UserAdmin):
    """Django's own user admin, with Delete running accounts/removal.py so a
    login's shop or workshop leaves the website with it."""


@admin.register(CustomerAccount)
class CustomerAccountAdmin(NameCheckMixin, admin.ModelAdmin):
    name_check_field = "display_name"
    """Everyone who has signed in. Read-mostly: switching one off is the only
    change staff make here; what they buy and sell lives on their orders."""

    list_display = (
        "phone",
        "display_name",
        "name_check",
        "email",
        "is_active",
        "created_at",
        "last_seen_at",
    )
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


@admin.register(PayoutAccount)
class PayoutAccountAdmin(admin.ModelAdmin):
    """Where people's money goes, and the ones staff must look at first.

    A name that did not match the one on their ID, or one Paystack could not
    give, keeps the person's shop money held and their course off sale until
    someone here is satisfied the account is theirs ("Name checked").
    """

    list_display = (
        "user",
        "account_name",
        "bank_name",
        "account_last4",
        "check_label",
        "updated_at",
    )
    list_filter = ("name_check", "bank_type", ("staff_cleared_at", admin.EmptyFieldListFilter))
    search_fields = ("account_name", "id_name", "user__username", "account_last4")
    ordering = ("-updated_at",)
    actions = ("clear_name",)
    readonly_fields = (
        "user",
        "bank_code",
        "bank_name",
        "bank_type",
        "account_last4",
        "account_name",
        "id_name",
        "name_check",
        "staff_cleared_at",
        "staff_cleared_by",
        "paystack_subaccount",
        "paystack_recipient",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request):
        # Made by the person, with Paystack's name for it; never typed here.
        return False

    @admin.display(description="Name", ordering="name_check")
    def check_label(self, obj):
        if obj.needs_staff:
            return f"Needs a look: {obj.get_name_check_display()}"
        if obj.staff_cleared_at:
            return "Checked by staff"
        return obj.get_name_check_display()

    @admin.action(description="Name checked: this account is theirs")
    def clear_name(self, request, queryset):
        if not request.user.has_perm("accounts.clear_payout_name"):
            raise PermissionDenied
        from marketplace import payouts

        from .payout import copy_to_roles

        cleared = 0
        for payout in queryset.filter(staff_cleared_at__isnull=True):
            payout.staff_cleared_at = timezone.now()
            payout.staff_cleared_by = request.user
            payout.save(update_fields=["staff_cleared_at", "staff_cleared_by", "updated_at"])
            copy_to_roles(payout)
            # Held orders that only waited on this go out now if they are due.
            for order in payouts.due_for_release().filter(seller__user=payout.user):
                payouts.release(order)
            cleared += 1
        self.message_user(
            request,
            f"{cleared} payout account(s) checked. Their course can sell and held money is sent "
            "when due.",
            level=messages.SUCCESS if cleared else messages.INFO,
        )
