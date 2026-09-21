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

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.contrib.gis.admin import GISModelAdmin
from django.core.exceptions import PermissionDenied
from django.db.models import Prefetch
from django.http import HttpResponseRedirect
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.html import format_html, format_html_join
from django.views.decorators.http import require_POST
from import_export.admin import ExportActionMixin
from simple_history.admin import SimpleHistoryAdmin

from . import admin_upload, queues
from .lifecycle import (
    ProviderTransitionError,
    UnconfirmedTrainerError,
    publish_provider,
    request_provider_changes,
    submit_provider,
)
from .models import (
    GovernmentStatus,
    ListingConfirmation,
    Provider,
    ProviderEvidence,
    ProviderMembership,
    ProviderPhoto,
    Suspension,
    TrainerAccount,
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
    "submitted_by_owner": (
        "Listings the workshop owner wrote and submitted themselves. Nobody from the field "
        "team has seen the workshop, so check the fees and photographs closely."
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


class ProviderMembershipInline(admin.TabularInline):
    """Who submitted this listing, on the record the lead is reviewing.

    Without it the back office cannot tell a listing a field officer drafted
    from one a workshop owner submitted through the trainer portal, which is
    the first thing you want to know when deciding whether to trust it.

    Ownership is never edited here. It is created by the trainer's first save
    and is structural — see the unique constraints on ProviderMembership.
    """

    model = ProviderMembership
    extra = 0
    max_num = 0
    can_delete = False
    fields = ("trainer_link", "role", "created_at")
    readonly_fields = fields
    verbose_name_plural = "Submitted by (trainer portal)"

    @admin.display(description="Trainer")
    def trainer_link(self, obj):
        return format_html(
            '<a href="{}">{}</a>',
            reverse("admin:providers_traineraccount_change", args=[obj.trainer_id]),
            obj.trainer.phone,
        )

    def has_add_permission(self, request, obj=None):
        return False


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


class ReturnForChangesForm(forms.Form):
    """The reason a submission is going back, in the reviewer's own words."""

    note = forms.CharField(
        label="What does the trainer need to change?",
        widget=forms.Textarea(
            attrs={
                "rows": 5,
                "placeholder": (
                    "Be specific enough to act on. For example: the fee is listed as "
                    "GH¢120 — if the course costs GH¢1,200 please correct it, and add "
                    "the landmark to the address so an officer can find the workshop."
                ),
            }
        ),
        max_length=1000,
        help_text=(
            "This is the only thing the trainer sees. It replaces any previous note, "
            "and it is recorded against the listing's history with your name."
        ),
    )

    def clean_note(self):
        note = self.cleaned_data["note"].strip()
        if len(note) < 15:
            raise forms.ValidationError(
                "Write a sentence the trainer can act on — a few words will send them "
                "back with nothing to change."
            )
        return note


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
        ProviderMembershipInline,
        VerificationInline,
        GovernmentStatusInline,
        ProviderEvidenceInline,
        SubscriptionInline,
    ]

    fieldsets = (
        ("Workshop", {"fields": ("name", "slug", "area", "address", "landmark", "location")}),
        ("Contact", {"fields": ("owner_name", "owner_phone", "contact_phone")}),
        (
            "What the trainer told us",
            {
                "fields": (
                    "year_established",
                    "premises_tenure",
                    "trainer_count",
                    "trainee_count",
                    "declared_accurate_at",
                    "site_visit_consent_at",
                ),
                "description": (
                    "Self-reported by whoever submitted the listing, and not checked by "
                    "anyone. Confirming a listing says it is a real workshop run by the "
                    "person who submitted it — it is not a Fliiptech verification and it "
                    "must not be recorded as one. A site visit is the only thing that "
                    "creates a Verification."
                ),
            },
        ),
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
    readonly_fields = (
        "status",
        "submitted_at",
        "published_at",
        "review_note",
        "declared_accurate_at",
        "site_visit_consent_at",
    )
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
        unconfirmed = []
        for provider in queryset:
            try:
                publish_provider(provider, actor=request.user)
            except UnconfirmedTrainerError:
                unconfirmed.append(provider.name)
                continue
            except ProviderTransitionError:
                skipped += 1
                continue
            updated += 1
        self.message_user(request, f"{updated} listing(s) published.")
        if unconfirmed:
            self.message_user(
                request,
                "Not published, because the trainer who submitted it is not confirmed yet: "
                + ", ".join(unconfirmed)
                + ". Confirm the trainer under Trainer accounts first.",
                level=messages.WARNING,
            )
        if skipped:
            self.message_user(
                request,
                f"{skipped} skipped: only listings pending approval can be published.",
                level=messages.WARNING,
            )

    @admin.action(description="Return selected for trainer changes")
    def return_for_changes(self, request, queryset):
        """Send a submission back with a reason the trainer can act on.

        This is the one step in the review loop that has to carry a sentence
        written by a person. The note is the only thing the trainer sees, and a
        fixed "please update your details" tells them nothing — they resubmit
        the same profile and the loop never converges.

        So the action stops on an intermediate page to collect it, the way
        Django's own delete_selected confirms first. Django resolves a
        select-across into the full queryset before calling an action, so
        re-posting its ids on the confirm form preserves the whole selection.
        """
        if not request.user.has_perm("providers.publish_provider"):
            self.message_user(
                request,
                "Returning a submission needs the operations lead permission.",
                level=messages.ERROR,
            )
            return None

        if "apply" in request.POST:
            form = ReturnForChangesForm(request.POST)
            if form.is_valid():
                note = form.cleaned_data["note"]
                updated = 0
                skipped = 0
                for provider in queryset:
                    try:
                        request_provider_changes(provider, actor=request.user, note=note)
                    except ProviderTransitionError:
                        skipped += 1
                        continue
                    updated += 1
                self.message_user(
                    request, f"{updated} provider submission(s) returned for changes."
                )
                if skipped:
                    self.message_user(
                        request,
                        f"{skipped} skipped: only listings pending approval can be returned.",
                        level=messages.WARNING,
                    )
                return None
        else:
            form = ReturnForChangesForm()

        return TemplateResponse(
            request,
            "admin/providers/provider/return_for_changes.html",
            {
                **self.admin_site.each_context(request),
                "title": "Return submissions for changes",
                "opts": self.model._meta,
                "queryset": queryset,
                "returnable": [
                    provider
                    for provider in queryset
                    if provider.status == Provider.Status.PENDING_APPROVAL
                ],
                "form": form,
                "media": self.media + form.media,
                "action_checkbox_name": ACTION_CHECKBOX_NAME,
            },
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


@admin.register(TrainerAccount)
class TrainerAccountAdmin(admin.ModelAdmin):
    """Workshop owners who submit their own listing.

    This exists so the disable path is reachable. `TrainerAccount.is_active` is
    checked on every trainer request and on every login, but until there was a
    screen to turn it off, the whole fail-closed branch in trainer_auth was
    unreachable in production — the only thing that could set the flag was a
    test.

    Nothing here is editable by hand. The identity is created by phone
    verification and the phone is the account, so renaming or repointing one
    would silently hand someone else's listing to a different number.
    """

    # Six columns, not eight. The previous set overflowed the table on a
    # laptop, so the right-hand columns sat behind a horizontal scrollbar —
    # which on a queue you are meant to act from is the same as not being
    # there. Role and ID type moved to the detail page; they inform the
    # decision but are not how you find the row.
    list_display = (
        "phone",
        "full_name",
        "approval_summary",
        "decide",
        "owned_provider",
        "created_at",
    )
    list_filter = ("approval_status", "is_active", "role", "id_document_type")
    search_fields = ("phone", "full_name", "id_document_number", "memberships__provider__name")
    ordering = ("-created_at",)
    actions = (
        "confirm_trainers",
        "decline_trainers",
        "suspend_trainer_access",
        "restore_trainer_access",
    )
    readonly_fields = (
        "user",
        "phone",
        "phone_verified_at",
        "identity_document_link",
        "listing_review",
        "data_consent_at",
        "approval_status",
        "approval_decided_at",
        "approval_decided_by",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        (None, {"fields": ("phone", "is_active", "user", "phone_verified_at")}),
        (
            "Who this is",
            {
                "fields": (
                    "full_name",
                    "role",
                    "id_document_type",
                    "id_document_number",
                    "identity_document_link",
                    "data_consent_at",
                ),
                "description": (
                    "A verified phone proves someone holds a SIM, not that they are who "
                    "they say or that they speak for this workshop. Check the name and "
                    "the document against each other before confirming."
                ),
            },
        ),
        (
            "Their listing",
            {
                "fields": ("listing_review",),
                "description": (
                    "Read-only. Confirming this account says a real person runs a real "
                    "workshop — it is not a Fliiptech site visit, and only a visit "
                    "creates one of those."
                ),
            },
        ),
        (
            "Confirmation",
            {
                "fields": (
                    "approval_status",
                    "approval_note",
                    "approval_decided_at",
                    "approval_decided_by",
                ),
                "description": (
                    "Anyone can sign up as a trainer. Use the Confirm or Decline actions on "
                    "the list to decide. A declined trainer cannot sign in and sees the note."
                ),
            },
        ),
        ("Record", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="Sign-up", ordering="approval_status")
    @admin.display(description="Decision")
    def decide(self, obj):
        """One click to confirm, from the row.

        Confirm only. Declining blocks someone from listing the workshop they
        make a living from, and the note explaining why is on the detail page —
        a one-click decline from a list is how that note ends up empty. So yes
        is one click and no is a deliberate trip to the record.

        A form rather than a link because this changes state: a GET that
        confirms an account would be followed by every crawler and prefetcher
        that ever sees the page.
        """
        if obj.approval_status == TrainerAccount.Approval.CONFIRMED:
            return format_html('<span class="row-decided">Confirmed</span>')

        return format_html(
            '<form method="post" action="{}" class="row-decide">'
            '<input type="hidden" name="csrfmiddlewaretoken" value="{}">'
            '<button type="submit" class="row-confirm">Confirm</button>'
            "</form>"
            '<a class="row-review" href="{}">Review</a>',
            reverse("admin:providers_traineraccount_confirm", args=[obj.pk]),
            get_token(self._request) if self._request else "",
            reverse("admin:providers_traineraccount_change", args=[obj.pk]),
        )

    def changelist_view(self, request, extra_context=None):
        # The row buttons need a CSRF token, and admin.display gets no request.
        self._request = request
        return super().changelist_view(request, extra_context=extra_context)

    _request = None

    def get_urls(self):
        return [
            path(
                "<int:pk>/confirm/",
                self.admin_site.admin_view(self.confirm_one),
                name="providers_traineraccount_confirm",
            ),
            *super().get_urls(),
        ]

    @method_decorator(require_POST)
    def confirm_one(self, request, pk):
        """Confirm a single trainer from the list.

        Permission-checked here as well as in get_actions: a URL is reachable
        by anyone who can guess it, and the bulk action being hidden from the
        menu does not stop a POST.
        """
        if not request.user.has_perm("providers.confirm_trainer"):
            raise PermissionDenied

        account = get_object_or_404(TrainerAccount, pk=pk)
        self._decide(
            request,
            TrainerAccount.objects.filter(pk=account.pk),
            status=TrainerAccount.Approval.CONFIRMED,
            verb="confirmed",
        )
        return HttpResponseRedirect(
            request.META.get("HTTP_REFERER") or reverse("admin:providers_traineraccount_changelist")
        )

    @admin.display(description="ID on file")
    def identity_summary(self, obj):
        """Whether an identity document exists, without linking to it here.

        A changelist is the wrong place for a link to someone's Ghana Card: it
        renders for every row and invites a careless click. The link lives on
        the detail page, behind the same view.
        """
        provider = self._owned_provider_object(obj)
        if provider is None:
            return "—"
        has_id = ProviderEvidence.objects.filter(
            provider=provider, kind=ProviderEvidence.Kind.ID_DOCUMENT
        ).exists()
        if not has_id:
            return format_html('<span style="color:#b45309">Not uploaded</span>')
        label = obj.get_id_document_type_display() or "Document"
        return format_html('<span style="color:#15803d">{}</span>', label)

    @admin.display(description="What they submitted")
    def listing_review(self, obj):
        """The listing itself, on the page where the decision is made.

        Confirming a trainer asks one question: is this a real person running
        a real workshop. The evidence for it lived on the provider record —
        a different page, reached by a link, in another app section. So the
        decision was either made without looking, or made across three tabs.

        Read-only and deliberately not an inline. An inline invites editing
        someone else's listing from the approval screen, which is a different
        job with a different audit trail.
        """
        provider = self._owned_provider_object(obj)
        if provider is None:
            return format_html(
                '<p class="review-empty">No listing yet. '
                "Nothing has been submitted for this account.</p>"
            )

        photos = list(provider.photos.all())
        by_kind = {
            ProviderPhoto.Kind.WORKSHOP: [
                p for p in photos if p.kind == ProviderPhoto.Kind.WORKSHOP
            ],
            ProviderPhoto.Kind.WORK: [p for p in photos if p.kind == ProviderPhoto.Kind.WORK],
        }

        facts = format_html_join(
            "",
            '<div class="review-fact"><dt>{}</dt><dd>{}</dd></div>',
            (
                ("Workshop", provider.name),
                ("Area", provider.area.name),
                ("Address", provider.address or "—"),
                # The landmark is how a field officer finds the place, so it
                # belongs next to the address rather than buried on the record.
                ("Landmark", provider.landmark or "— none given —"),
                ("Contact", str(provider.contact_phone)),
                ("Status", provider.get_status_display()),
            ),
        )

        programmes = provider.programmes.all()
        courses = format_html_join(
            "",
            "<li>{} · GHS {} · {} weeks</li>",
            ((p.trade.name, p.fee, p.duration_weeks) for p in programmes),
        ) or format_html("<li>No course added yet.</li>")

        return format_html(
            '<div class="review-panel">'
            '<div class="review-head">{logo}<dl class="review-facts">{facts}</dl></div>'
            '<p class="review-label">The workshop ({n_workshop})</p>{workshop}'
            '<p class="review-label">Their work ({n_work})</p>{work}'
            '<p class="review-label">Courses</p><ul class="review-courses">{courses}</ul>'
            '<p class="review-open"><a href="{url}">Open the full listing</a></p>'
            "</div>",
            logo=(
                format_html('<img class="review-logo" src="{}" alt="">', provider.logo.url)
                if provider.logo
                else format_html('<span class="review-nologo">No logo</span>')
            ),
            facts=facts,
            n_workshop=len(by_kind[ProviderPhoto.Kind.WORKSHOP]),
            workshop=self._thumbs(by_kind[ProviderPhoto.Kind.WORKSHOP]),
            n_work=len(by_kind[ProviderPhoto.Kind.WORK]),
            work=self._thumbs(by_kind[ProviderPhoto.Kind.WORK]),
            courses=courses,
            url=reverse("admin:providers_provider_change", args=[provider.pk]),
        )

    @staticmethod
    def _thumbs(photos):
        """Thumbnails, or a plain statement that there are none.

        Saying "none" matters as much as showing them: a submission with no
        photograph of the work is one the reviewer should push back on, and an
        empty row reads as a rendering fault rather than an answer.
        """
        if not photos:
            return format_html('<p class="review-empty">None uploaded.</p>')
        return format_html(
            '<div class="review-thumbs">{}</div>',
            format_html_join(
                "",
                '<a href="{}" target="_blank" rel="noopener"><img src="{}" alt="{}"></a>',
                ((p.image.url, p.image.url, p.caption or "Uploaded photo") for p in photos),
            ),
        )

    @admin.display(description="Identity document")
    def identity_document_link(self, obj):
        """A link to the private file, or a plain statement that there is none.

        Section 10 requires identity documents are never publicly served, so
        this points at the permission-checked evidence view rather than at
        storage. PRIVATE_MEDIA_ROOT is not under the directory the web server
        is pointed at, so there is no public URL to link to even by accident.
        """
        provider = self._owned_provider_object(obj)
        if provider is None:
            return "No listing yet."
        evidence = (
            ProviderEvidence.objects.filter(
                provider=provider, kind=ProviderEvidence.Kind.ID_DOCUMENT
            )
            .order_by("-created_at")
            .first()
        )
        if evidence is None:
            return "Not uploaded yet. The trainer cannot submit for review without one."
        return format_html(
            '<a href="{}" target="_blank" rel="noopener">Open identity document</a>'
            "<br><small>Uploaded {}</small>",
            reverse("admin:providers_providerevidence_change", args=[evidence.pk]),
            evidence.created_at.strftime("%d %b %Y"),
        )

    def _owned_provider_object(self, obj):
        membership = obj.memberships.select_related("provider").first()
        return membership.provider if membership else None

    def approval_summary(self, obj):
        # Inline colours: this changelist does not load the provider stylesheet.
        colour = {
            TrainerAccount.Approval.PENDING: "#b45309",
            TrainerAccount.Approval.CONFIRMED: "#15803d",
            TrainerAccount.Approval.DECLINED: "#b91c1c",
        }[obj.approval_status]
        return format_html(
            '<strong style="color:{}">{}</strong>',
            colour,
            obj.get_approval_status_display(),
        )

    def _decide(self, request, queryset, *, status, verb):
        if not request.user.has_perm("providers.confirm_trainer"):
            self.message_user(
                request,
                "Confirming trainers needs the confirm trainer permission "
                "(super admin by default).",
                level=messages.ERROR,
            )
            return
        changed = list(queryset.exclude(approval_status=status))
        now = timezone.now()
        for account in changed:
            account.approval_status = status
            account.approval_decided_at = now
            account.approval_decided_by = request.user
            account.save(
                update_fields=[
                    "approval_status",
                    "approval_decided_at",
                    "approval_decided_by",
                    "updated_at",
                ]
            )
            self.log_change(request, account, f"Trainer sign-up {verb}.")
        self.message_user(request, f"{len(changed)} trainer sign-up(s) {verb}.")

    @admin.action(description="Confirm selected trainers")
    def confirm_trainers(self, request, queryset):
        """The super admin's yes. Their submitted listings can then be published."""
        self._decide(request, queryset, status=TrainerAccount.Approval.CONFIRMED, verb="confirmed")

    @admin.action(description="Decline selected trainers")
    def decline_trainers(self, request, queryset):
        """Blocks sign-in. Write the reason in the note on the account first."""
        self._decide(request, queryset, status=TrainerAccount.Approval.DECLINED, verb="declined")

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not request.user.has_perm("providers.confirm_trainer"):
            actions.pop("confirm_trainers", None)
            actions.pop("decline_trainers", None)
        return actions

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("user")
            .prefetch_related("memberships__provider")
        )

    @admin.display(description="Listing")
    def owned_provider(self, obj):
        memberships = list(obj.memberships.all())
        if not memberships:
            return format_html(
                '<span class="pc-freshness pc-freshness--neutral">No profile yet</span>'
            )
        provider = memberships[0].provider
        return format_html(
            '<a href="{}">{}</a> <span class="pc-freshness pc-freshness--neutral">{}</span>',
            reverse("admin:providers_provider_change", args=[provider.pk]),
            provider.name,
            provider.get_status_display(),
        )

    def has_add_permission(self, request):
        # An account is created by verifying a phone number, never by hand.
        return False

    def _set_active(self, request, queryset, *, active, verb):
        if not request.user.has_perm("providers.change_traineraccount"):
            self.message_user(
                request,
                "Changing trainer access needs the trainer account permission.",
                level=messages.ERROR,
            )
            return

        # Logged one at a time rather than with a bulk update. Cutting off
        # someone's access to their own listing is exactly the decision that
        # should carry a name and a timestamp, and a queryset .update() records
        # nothing at all.
        changed = list(queryset.exclude(is_active=active))
        for account in changed:
            account.is_active = active
            account.save(update_fields=["is_active", "updated_at"])
            self.log_change(request, account, f"Trainer access {verb}.")
        self.message_user(request, f"{len(changed)} trainer account(s) {verb}.")

    @admin.action(description="Suspend trainer access")
    def suspend_trainer_access(self, request, queryset):
        """Locks the account out immediately, including any live session.

        No session flush is needed: every trainer request re-reads this flag
        through the IsActiveTrainer permission, so an open browser tab stops
        working on its next request rather than at its next login.

        The listing itself is untouched. Suspending a listing is a separate
        decision with its own recorded reason — see the Suspension model.
        """
        self._set_active(request, queryset, active=False, verb="suspended")

    @admin.action(description="Restore trainer access")
    def restore_trainer_access(self, request, queryset):
        self._set_active(request, queryset, active=True, verb="restored")
