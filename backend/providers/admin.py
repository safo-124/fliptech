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

from datetime import timedelta

from django.contrib import admin, messages
from django.contrib.gis.admin import GISModelAdmin
from django.db.models import Prefetch
from django.urls import path
from django.utils import timezone
from django.utils.html import format_html
from import_export.admin import ExportActionMixin
from simple_history.admin import SimpleHistoryAdmin

from . import admin_upload, queues
from .lifecycle import (
    ProviderTransitionError,
    publish_provider,
    request_provider_changes,
    submit_provider,
)
from .models import (
    GovernmentStatus,
    ListingConfirmation,
    Provider,
    ProviderEvidence,
    ProviderPhoto,
    Suspension,
    Verification,
)

# The queue definitions stay in queues.py because they also drive the sidebar
# and dashboard counts. This copy is deliberately presentation-only: it gives
# an officer enough context to understand why a filtered list exists without
# moving query logic into the template.
PROVIDER_QUEUE_DESCRIPTIONS = {
    "awaiting_approval": (
        "Submitted listings waiting for an operations lead to complete the second review."
    ),
    "never_visited": "Published providers that do not yet have a recorded Fliiptech site visit.",
    "due_revisit": "Published providers whose most recent site visit is more than a year old.",
    "shown_as_stale": (
        "Listings currently shown to trainees as unconfirmed because their details are overdue."
    ),
    "due_confirmation": "Published providers due for the regular 90-day fees and intake check.",
    "no_photo": "Published listings that still need a useful workshop photograph.",
    "no_programme": "Published providers with no training programme attached.",
    "no_upcoming_intake": "Published providers with no open intake scheduled in the future.",
}


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


class WorkQueueFilter(admin.SimpleListFilter):
    """Turns each sidebar badge into a changelist you can actually work through.

    The definitions are in providers/queues.py so that the number on the badge
    and the number of rows here cannot drift apart. Django validates nothing
    about the raw query value, so an unknown key falls through to the unfiltered
    list rather than raising on a hand-edited URL.
    """

    title = "work queue"
    parameter_name = "queue"

    def lookups(self, request, model_admin):
        return [(queue.key, queue.label) for queue in queues.QUEUES]

    def queryset(self, request, queryset):
        queue = queues.QUEUES_BY_KEY.get(self.value())
        return queue.narrow(queryset) if queue else queryset


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
        "status_summary",
        "trust_summary",
        "last_confirmed_at",
        "freshness",
    )
    list_filter = (WorkQueueFilter, "status", "area__region", "area", "created_at")
    search_fields = ("name", "owner_name", "address", "contact_phone")
    autocomplete_fields = ("area",)
    prepopulated_fields = {"slug": ("name",)}
    date_hierarchy = "created_at"
    list_select_related = ("area", "area__region", "government_status")
    search_help_text = "Search by provider, owner, address, or contact phone."

    # ExportActionMixin notices this custom base during ModelAdmin
    # initialisation and layers its export object-tool template on top of it.
    # That preserves django-import-export rather than replacing its link.
    change_list_template = "admin/providers/provider/change_list.html"

    # No photo inline: photographs are handled by the background uploader on
    # the change form, which uploads each one separately so a dropped
    # connection cannot lose the whole visit. See admin_upload.py.
    inlines = [
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
                "fields": (
                    "status",
                    "submitted_at",
                    "published_at",
                    "last_confirmed_at",
                    "review_note",
                ),
                "description": (
                    "Status is changed with the publish and suspend actions, not by hand, "
                    "so that the approval step and the reason for a suspension are recorded."
                ),
            },
        ),
    )
    readonly_fields = ("status", "submitted_at", "published_at", "review_note")
    actions = ["submit_for_approval", "publish_listings", "return_for_changes"]
    change_form_template = "admin/providers/provider/change_form.html"

    def get_queryset(self, request):
        """Fetch the signals displayed in each row without an N+1 query.

        Verification history remains intact; ``to_attr`` simply gives the
        changelist a pre-sorted in-memory view from which it reads the latest
        visit. The one-to-one government record is covered by
        ``list_select_related`` above.
        """
        return (
            super()
            .get_queryset(request)
            .prefetch_related(
                Prefetch(
                    "verifications",
                    queryset=Verification.objects.order_by("-visited_on"),
                    to_attr="admin_verifications",
                )
            )
        )

    def changelist_view(self, request, extra_context=None):
        """Add queue navigation without replacing ChangeList behaviour."""
        current_key = request.GET.get(WorkQueueFilter.parameter_name)
        current_queue = queues.QUEUES_BY_KEY.get(current_key)

        # Switching queues keeps deliberate search and field filters, but a
        # page number cannot be carried across because the next queue may have
        # fewer pages. Unknown queue values are presented as the unfiltered
        # list, matching WorkQueueFilter.queryset().
        base_params = request.GET.copy()
        base_params.pop("p", None)

        queue_links = []
        for queue in queues.QUEUES:
            params = base_params.copy()
            params[WorkQueueFilter.parameter_name] = queue.key
            queue_links.append(
                {
                    "key": queue.key,
                    "label": queue.label,
                    "url": f"?{params.urlencode()}",
                    "active": current_queue is queue,
                }
            )

        all_params = base_params.copy()
        all_params.pop(WorkQueueFilter.parameter_name, None)
        all_url = f"?{all_params.urlencode()}" if all_params else "?"

        # A popup changelist must keep its selection contract even when an
        # empty-state link clears every actual search/filter parameter.
        reset_params = request.GET.copy()
        for key in tuple(reset_params):
            if key not in {"_popup", "_to_field"}:
                reset_params.pop(key)
        reset_url = f"?{reset_params.urlencode()}" if reset_params else "?"

        context = {
            "provider_work_queue": current_queue,
            "provider_queue_links": queue_links,
            "provider_all_url": all_url,
            "provider_reset_url": reset_url,
            "provider_queue_description": PROVIDER_QUEUE_DESCRIPTIONS.get(
                current_queue.key if current_queue else "",
                "Review, verify, publish, and keep every provider listing current from one workspace.",
            ),
        }
        context.update(extra_context or {})
        return super().changelist_view(request, extra_context=context)

    def get_urls(self):
        """Endpoints the background uploader posts to.

        Registered on the ModelAdmin rather than in config/urls.py so they sit
        behind the admin's own staff-only wrapper and inherit its URL
        namespace.
        """
        custom = [
            path(
                "<int:provider_id>/photos/upload/",
                self.admin_site.admin_view(admin_upload.upload_photo),
                name="providers_provider_upload_photo",
            ),
            path(
                "<int:provider_id>/photos/<int:photo_id>/delete/",
                self.admin_site.admin_view(admin_upload.delete_photo),
                name="providers_provider_delete_photo",
            ),
            path(
                "<int:provider_id>/photos/<int:photo_id>/caption/",
                self.admin_site.admin_view(admin_upload.caption_photo),
                name="providers_provider_caption_photo",
            ),
            # The uploader builds "<base><photo_id>/delete/" client-side, so it
            # needs the prefix as a resolvable URL rather than a string it
            # assembles from parts.
            path(
                "<int:provider_id>/photos/",
                self.admin_site.admin_view(admin_upload.photos_base),
                name="providers_provider_photos_base",
            ),
        ]
        return custom + super().get_urls()

    @admin.display(description="Status", ordering="status")
    def status_summary(self, obj):
        """Render a compact state that remains meaningful without colour."""
        return format_html(
            '<span class="pc-status pc-status--{}"><span class="pc-status-dot" '
            'aria-hidden="true"></span>{}</span>',
            obj.status,
            obj.get_status_display(),
        )

    @admin.display(description="Trust signals", ordering="status")
    def trust_summary(self, obj):
        """Two badges, never merged. Structural rule 1 in DATA_MODEL.md.

        The site visit and the government record are rendered as separate
        statements, and either may be absent. Collapsing them into a single
        trusted flag is the change most likely to create a legal problem later.
        """
        visits = getattr(obj, "admin_verifications", ())
        visit = visits[0] if visits else None
        visit_text = f"Visited {visit.visited_on:%b %Y}" if visit else "Not visited"
        recent_cutoff = timezone.localdate() - timedelta(days=queues.VERIFICATION_MAX_AGE_DAYS)
        if visit is None:
            visit_tone = "attention"
        elif visit.visited_on < recent_cutoff:
            visit_tone = "warning"
        else:
            visit_tone = "positive"

        government = getattr(obj, "government_status", None)
        gov_text = (
            government.get_registration_status_display() if government else "CTVET: not claimed"
        )
        if government is None:
            government_tone = "neutral"
        elif government.registration_status == GovernmentStatus.Status.REGISTERED:
            government_tone = "positive"
        elif government.registration_status == GovernmentStatus.Status.NOT_REGISTERED:
            government_tone = "attention"
        else:
            government_tone = "neutral"

        return format_html(
            '<span class="pc-trust-stack">'
            '<span class="pc-signal pc-signal--{}"><span class="pc-signal-dot" '
            'aria-hidden="true"></span>{}</span>'
            '<span class="pc-signal pc-signal--{}"><span class="pc-signal-dot" '
            'aria-hidden="true"></span>{}</span>'
            "</span>",
            visit_tone,
            visit_text,
            government_tone,
            gov_text,
        )

    @admin.display(description="Freshness", ordering="last_confirmed_at")
    def freshness(self, obj):
        if obj.status != Provider.Status.PUBLISHED:
            tone, label = "neutral", "Not live"
        elif obj.is_listing_stale:
            tone, label = "attention", "Check needed"
        else:
            tone, label = "positive", "Current"
        return format_html(
            '<span class="pc-freshness pc-freshness--{}">{}</span>',
            tone,
            label,
        )

    @admin.action(description="Submit selected for approval")
    def submit_for_approval(self, request, queryset):
        updated = 0
        for provider in queryset:
            try:
                submit_provider(provider, actor=request.user)
            except ProviderTransitionError:
                continue
            updated += 1
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

        updated = 0
        skipped = 0
        for provider in queryset:
            try:
                publish_provider(provider, actor=request.user)
            except ProviderTransitionError:
                skipped += 1
                continue
            updated += 1
        self.message_user(request, f"{updated} listing(s) published.")
        if skipped:
            self.message_user(
                request,
                f"{skipped} skipped: only listings pending approval can be published.",
                level=messages.WARNING,
            )

    @admin.action(description="Return selected for trainer changes")
    def return_for_changes(self, request, queryset):
        if not request.user.has_perm("providers.publish_provider"):
            self.message_user(
                request,
                "Returning a submission needs the operations lead permission.",
                level=messages.ERROR,
            )
            return

        updated = 0
        skipped = 0
        note = "Please update the profile details and submit it for review again."
        for provider in queryset:
            try:
                request_provider_changes(provider, actor=request.user, note=note)
            except ProviderTransitionError:
                skipped += 1
                continue
            updated += 1
        self.message_user(request, f"{updated} provider submission(s) returned for changes.")
        if skipped:
            self.message_user(
                request,
                f"{skipped} skipped: only listings pending approval can be returned.",
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
            provider = Provider.objects.get(pk=obj.provider_id)
            provider.status = Provider.Status.SUSPENDED
            provider._history_user = request.user
            provider._change_reason = f"Suspended: {obj.reason}"
            provider.save(update_fields=["status", "updated_at"])


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
