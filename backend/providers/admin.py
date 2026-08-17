"""The back office.

Section 05 says the deciding factor for Django was the admin, and Section 09
says it must work on a phone over a mobile connection during a site visit. Both
shape this module:

* Inlines are ordered so a field officer can complete a provider top to bottom
  in one pass, and the ones not needed during a visit are collapsed.
* Publishing is a separate permission from editing, implementing the second
  pair of eyes that Section 09 requires.
* Verification and government status are never presented as one field.
"""

from django.contrib import admin, messages
from django.contrib.gis.admin import GISModelAdmin
from django.utils import timezone
from django.utils.html import format_html
from import_export.admin import ExportActionMixin
from simple_history.admin import SimpleHistoryAdmin

from .models import (
    GovernmentStatus,
    ListingConfirmation,
    Provider,
    ProviderEvidence,
    ProviderPhoto,
    Suspension,
    Verification,
)


class ProviderPhotoInline(admin.TabularInline):
    model = ProviderPhoto
    extra = 1
    fields = ("image", "caption", "display_order", "exif_stripped")
    readonly_fields = ("exif_stripped",)


class ProviderEvidenceInline(admin.TabularInline):
    model = ProviderEvidence
    extra = 0
    fields = ("kind", "file", "note", "exif_stripped")
    readonly_fields = ("exif_stripped",)
    classes = ("collapse",)
    verbose_name_plural = "Private evidence (never publicly served)"


class GovernmentStatusInline(admin.StackedInline):
    model = GovernmentStatus
    extra = 0
    can_delete = False
    verbose_name_plural = "Government status (recorded separately from verification)"


class VerificationInline(admin.TabularInline):
    model = Verification
    extra = 0
    fields = ("visited_on", "officer", "outcome", "expires_on")
    show_change_link = True
    classes = ("collapse",)


class SubscriptionInline(admin.TabularInline):
    from billing.models import Subscription

    model = Subscription
    extra = 0
    fields = ("tier", "price", "period_start", "period_end", "state")
    classes = ("collapse",)


@admin.register(Provider)
class ProviderAdmin(ExportActionMixin, SimpleHistoryAdmin, GISModelAdmin):
    """Provider onboarding, the screen a field officer lives in.

    ExportActionMixin is here for a specific reason: Section 03 names "no way to
    export a list" as what makes an NGO programme officer give up, and Section
    11's budget-cut plan is to sell the verified provider database to exactly
    those buyers.
    """

    list_display = (
        "name",
        "area",
        "status",
        "trust_summary",
        "last_confirmed_at",
        "freshness",
    )
    list_filter = ("status", "area__region", "area", "created_at")
    search_fields = ("name", "owner_name", "address", "contact_phone")
    autocomplete_fields = ("area",)
    prepopulated_fields = {"slug": ("name",)}
    date_hierarchy = "created_at"
    list_select_related = ("area", "area__region")

    inlines = [
        ProviderPhotoInline,
        VerificationInline,
        GovernmentStatusInline,
        ProviderEvidenceInline,
        SubscriptionInline,
    ]

    fieldsets = (
        ("Workshop", {"fields": ("name", "slug", "area", "address", "location")}),
        ("Contact", {"fields": ("owner_name", "owner_phone", "contact_phone")}),
        (
            "Listing",
            {
                "fields": ("status", "published_at", "last_confirmed_at"),
                "description": (
                    "Status is changed with the publish and suspend actions, not by hand, "
                    "so that the approval step and the reason for a suspension are recorded."
                ),
            },
        ),
    )
    readonly_fields = ("published_at",)
    actions = ["submit_for_approval", "publish_listings"]

    @admin.display(description="Trust", ordering="status")
    def trust_summary(self, obj):
        """Two badges, never merged. Structural rule 1 in DATA_MODEL.md.

        The site visit and the government record are rendered as separate
        statements, and either may be absent. Collapsing them into a single
        trusted flag is the change most likely to create a legal problem later.
        """
        visit = obj.verifications.first()
        visit_text = f"Visited {visit.visited_on:%b %Y}" if visit else "Not visited"

        government = getattr(obj, "government_status", None)
        gov_text = (
            government.get_registration_status_display() if government else "CTVET: not claimed"
        )

        return format_html("{}<br><small>{}</small>", visit_text, gov_text)

    @admin.display(description="Freshness", boolean=True)
    def freshness(self, obj):
        return not obj.is_listing_stale

    @admin.action(description="Submit selected for approval")
    def submit_for_approval(self, request, queryset):
        updated = queryset.filter(status=Provider.Status.DRAFT).update(
            status=Provider.Status.PENDING_APPROVAL
        )
        self.message_user(request, f"{updated} provider(s) submitted for approval.")

    @admin.action(description="Publish selected listings")
    def publish_listings(self, request, queryset):
        """The second pair of eyes. Gated on its own permission."""
        if not request.user.has_perm("providers.publish_provider"):
            self.message_user(
                request,
                "Publishing needs the operations lead permission. "
                "A listing is approved by someone other than the officer who drafted it.",
                level=messages.ERROR,
            )
            return

        publishable = queryset.filter(status=Provider.Status.PENDING_APPROVAL)
        skipped = queryset.count() - publishable.count()

        updated = publishable.update(
            status=Provider.Status.PUBLISHED,
            published_at=timezone.now(),
            last_confirmed_at=timezone.now(),
        )
        self.message_user(request, f"{updated} listing(s) published.")
        if skipped:
            self.message_user(
                request,
                f"{skipped} skipped: only listings pending approval can be published.",
                level=messages.WARNING,
            )


@admin.register(Verification)
class VerificationAdmin(SimpleHistoryAdmin):
    """The verification queue."""

    list_display = ("provider", "visited_on", "officer", "outcome", "expires_on", "due_for_revisit")
    list_filter = ("outcome", "visited_on", "officer")
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider", "officer")
    date_hierarchy = "visited_on"

    @admin.display(description="Due for revisit", boolean=True)
    def due_for_revisit(self, obj):
        """Section 09 flags a verification older than 12 months."""
        from datetime import timedelta

        return obj.visited_on < (timezone.now().date() - timedelta(days=365))

    def save_model(self, request, obj, form, change):
        if not change and not obj.officer_id:
            obj.officer = request.user
        super().save_model(request, obj, form, change)


@admin.register(GovernmentStatus)
class GovernmentStatusAdmin(SimpleHistoryAdmin):
    list_display = ("provider", "registration_status", "accreditation_status", "documented_on")
    list_filter = ("registration_status", "accreditation_status")
    search_fields = ("provider__name", "registration_number")
    autocomplete_fields = ("provider",)


@admin.register(Suspension)
class SuspensionAdmin(admin.ModelAdmin):
    """Moderation. Section 09 requires the reason to be logged, so it is required."""

    list_display = ("provider", "reason", "raised_by", "started_at", "lifted_at")
    list_filter = ("started_at", "lifted_at")
    search_fields = ("provider__name", "reason")
    autocomplete_fields = ("provider", "raised_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.raised_by = obj.raised_by or request.user
            if not obj.started_at:
                obj.started_at = timezone.now()
        super().save_model(request, obj, form, change)
        # Suspending the record suspends the listing.
        if obj.lifted_at is None:
            Provider.objects.filter(pk=obj.provider_id).update(status=Provider.Status.SUSPENDED)


@admin.register(ListingConfirmation)
class ListingConfirmationAdmin(admin.ModelAdmin):
    """The 90-day freshness cycle from Section 09."""

    list_display = (
        "provider",
        "prompted_at",
        "responded_at",
        "channel",
        "fees_confirmed",
        "intakes_confirmed",
    )
    list_filter = ("channel", "fees_confirmed", "intakes_confirmed", "prompted_at")
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider", "confirmed_by")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if obj.responded_at and obj.fees_confirmed and obj.intakes_confirmed:
            Provider.objects.filter(pk=obj.provider_id).update(last_confirmed_at=obj.responded_at)


@admin.register(ProviderPhoto)
class ProviderPhotoAdmin(admin.ModelAdmin):
    list_display = ("provider", "caption", "display_order", "exif_stripped", "created_at")
    list_filter = ("exif_stripped",)
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider",)
    readonly_fields = ("exif_stripped",)


@admin.register(ProviderEvidence)
class ProviderEvidenceAdmin(admin.ModelAdmin):
    """Private evidence. Deliberately not linked from any public view."""

    list_display = ("provider", "kind", "verification", "exif_stripped", "created_at")
    list_filter = ("kind", "exif_stripped")
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider", "verification")
    readonly_fields = ("exif_stripped",)
