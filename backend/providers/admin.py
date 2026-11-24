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
from django.conf import settings
from django.contrib import admin, messages
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.contrib.gis.admin import GISModelAdmin
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Prefetch, Q
from django.http import Http404, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.html import format_html, format_html_join
from django.views.decorators.http import require_POST
from import_export.admin import ExportActionMixin
from simple_history.admin import SimpleHistoryAdmin

from accounts.removal_admin import ProviderRemovalAdmin, TrainerRemovalAdmin
from core.ranged import serve_private_file
from core.site_links import provider_page_url

from . import admin_upload, queues, video_uploads
from .admin_outbox import OwnerMessagesAdminMixin
from .lifecycle import (
    ProviderTransitionError,
    UnconfirmedTrainerError,
    publish_provider,
    request_provider_changes,
    submit_provider,
    suspend_complained_about,
)
from .models import (
    Complaint,
    GovernmentStatus,
    IdNumberClash,
    ListingConfirmation,
    OwnerNotice,
    Provider,
    ProviderEvidence,
    ProviderMembership,
    ProviderPhoto,
    ProviderVideo,
    Suspension,
    TrainerAccount,
    TrainerIdPhoto,
    Verification,
    VideoReport,
)
from .videos import decide

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


class ReviewFlagFilter(admin.SimpleListFilter):
    """Listings with something for staff to look at: placeholder text in a
    public field, or numbers that do not add up (providers/review_flags.py).
    Worked out in Python, so it reads every listing: fine at today's size."""

    title = "review flags"
    parameter_name = "flags"

    def lookups(self, request, model_admin):
        return [("yes", "Has review flags")]

    def queryset(self, request, queryset):
        if self.value() != "yes":
            return queryset
        from .review_flags import flags_for

        flagged = [
            provider.pk
            for provider in queryset.prefetch_related("programmes")
            if flags_for(provider)
        ]
        return queryset.filter(pk__in=flagged)


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
class ProviderAdmin(
    ProviderRemovalAdmin,
    OwnerMessagesAdminMixin,
    ExportActionMixin,
    SimpleHistoryAdmin,
    GISModelAdmin,
):
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
        "photos_waiting",
        "trust_summary",
        "last_confirmed_at",
        "freshness",
    )
    list_filter = (
        WorkQueueFilter,
        ReviewFlagFilter,
        "status",
        "area__region",
        "area",
        "created_at",
    )
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
        (
            "Review flags",
            {
                "fields": ("review_flags",),
                "description": (
                    "For staff only: placeholder text, and numbers that do not add up. The "
                    "trainer is not stopped by these; ask them to fix what is wrong."
                ),
            },
        ),
        (
            "Workshop",
            {
                "fields": ("name", "slug", "area", "address", "landmark", "directions", "location"),
                "description": (
                    "The landmark is private, for the field officer. The directions are public: "
                    "they lead the listing's 'find the gate' card."
                ),
            },
        ),
        ("Contact", {"fields": ("owner_name", "owner_phone", "contact_phone")}),
        (
            "The master",
            {
                "fields": (
                    "lead_trainer_name",
                    "in_trade_since",
                    "apprentices_trained",
                    "teaching_languages",
                ),
                "description": (
                    "Public: the portrait strip on the listing. Upload the portrait itself as a "
                    "photo of kind 'The lead trainer'."
                ),
            },
        ),
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
                    "photos_waiting",
                    "submitted_at",
                    "published_at",
                    "last_confirmed_at",
                    "review_note",
                    "videos_blocked",
                ),
                "description": (
                    "Status is changed with the publish and suspend actions, not by hand, "
                    "so that the approval step and the reason for a suspension are recorded."
                ),
            },
        ),
    )
    readonly_fields = (
        "review_flags",
        "status",
        "photos_waiting",
        "submitted_at",
        "published_at",
        "review_note",
        "declared_accurate_at",
        "site_visit_consent_at",
    )

    @admin.display(description="Review flags")
    def review_flags(self, obj):
        """Placeholder text and numbers that do not add up, for staff only:
        the trainer is never stopped by these (providers/review_flags.py)."""
        from .review_flags import flags_for

        if obj is None or obj.pk is None:
            return "-"
        flags = flags_for(obj)
        if not flags:
            return "None."
        return format_html_join("", "<p>⚠ {}</p>", ((flag,) for flag in flags))

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        # Setting it back to 0 lets the workshop's videos go live unwatched
        # again: a decision for whoever can block and approve videos.
        if not request.user.has_perm("providers.change_providervideo"):
            readonly.append("videos_blocked")
        return readonly

    actions = [
        "submit_for_approval",
        "publish_listings",
        "return_for_changes",
        "approve_listing_photos",
        "hide_listing_photos",
    ]
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
            # "Photos waiting" in each row, in the same query.
            .annotate(
                admin_photos_waiting=Count(
                    "photos", filter=Q(photos__approved_at__isnull=True), distinct=True
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
            # WhatsApp messages to owners. See admin_outbox.py.
            *self.outbox_urls(),
        ]
        return custom + super().get_urls()

    def view_on_site(self, obj):
        """Where "View on site" goes: the listing as trainees see it, once published.

        The page staff edit most had no way to it, while its own courses and
        intakes did. A draft has no public page yet, so it gets no link.
        """
        return provider_page_url(obj)

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

    @admin.display(description="Photos waiting")
    def photos_waiting(self, obj):
        """Photos not yet shown on the site. Publishing approves them; one
        added after that waits here until approved under Photos."""
        if obj is None or obj.pk is None:
            return "—"
        waiting = getattr(obj, "admin_photos_waiting", None)
        if waiting is None:
            waiting = obj.photos.filter(approved_at__isnull=True).count()
        if not waiting:
            return "None"
        note = (
            "approved when published"
            if obj.status != Provider.Status.PUBLISHED
            else "not shown until approved"
        )
        return format_html(
            '<span class="pc-signal pc-signal--attention"><span class="pc-signal-dot" '
            'aria-hidden="true"></span>{} waiting · {}</span>',
            waiting,
            note,
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
        """Drafts (and listings sent back for changes) go to the approval queue.

        Anything else is skipped, and the message says why and what to do
        instead: a bare "0 submitted" read as the button not working, when the
        listings were simply waiting for the next step already."""
        updated = 0
        waiting, live, other = [], [], []
        for provider in queryset:
            try:
                submit_provider(provider, actor=request.user)
            except ProviderTransitionError:
                if provider.status == Provider.Status.PENDING_APPROVAL:
                    waiting.append(provider.name)
                elif provider.status == Provider.Status.PUBLISHED:
                    live.append(provider.name)
                else:
                    other.append(provider.name)
                continue
            updated += 1
        if updated:
            self.message_user(request, f"{updated} provider(s) submitted for approval.")
        if waiting:
            self.message_user(
                request,
                "Already submitted and waiting for approval: "
                + ", ".join(waiting)
                + '. To approve, choose "Publish selected listings" instead.',
                level=messages.WARNING,
            )
        if live:
            self.message_user(
                request,
                "Already published, so there is nothing to submit: " + ", ".join(live) + ".",
                level=messages.WARNING,
            )
        if other:
            self.message_user(
                request,
                "Not submitted, because only a draft or a listing returned for changes can be: "
                + ", ".join(other)
                + ".",
                level=messages.WARNING,
            )

    @admin.action(description="Approve every photo on the selected listings")
    def approve_listing_photos(self, request, queryset):
        """After looking at a listing's photos (the review panel or Photos list)."""
        from django.utils import timezone

        count = ProviderPhoto.objects.filter(
            provider__in=queryset, approved_at__isnull=True
        ).update(approved_at=timezone.now(), approved_by=request.user)
        self.message_user(request, f"{count} photo(s) approved and now shown on the site.")

    @admin.action(description="Hide every photo on the selected listings")
    def hide_listing_photos(self, request, queryset):
        count = ProviderPhoto.objects.filter(
            provider__in=queryset, approved_at__isnull=False
        ).update(approved_at=None, approved_by=None)
        self.message_user(request, f"{count} photo(s) hidden. They stay on the record.")

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
        photos = 0
        unconfirmed = []
        for provider in queryset:
            try:
                published = publish_provider(provider, actor=request.user)
                photos += published.photos_approved
            except UnconfirmedTrainerError:
                unconfirmed.append(provider.name)
                continue
            except ProviderTransitionError:
                skipped += 1
                continue
            updated += 1
        self.message_user(
            request,
            f"{updated} listing(s) published"
            + (f", and {photos} photo(s) approved with them and now shown." if photos else "."),
        )
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


@admin.register(Complaint)
class ComplaintAdmin(admin.ModelAdmin):
    """Reports from the "Report a problem" link on every listing.

    What the reporter wrote is read-only: it is the record, and the reason a
    suspension can point to. Staff set the status and a note, or suspend the
    listing with the action below, which links the two. Held by the operations
    lead and superusers: a report can carry the reporter's phone number.
    """

    list_display = (
        "reference",
        "provider",
        "category",
        "urgent",
        "status",
        "created_at",
    )
    list_filter = ("status", "category", "created_at")
    search_fields = ("reference", "provider__name", "detail")
    list_select_related = ("provider",)
    actions = ("suspend_listing",)
    fields = (
        "reference",
        "provider",
        "category",
        "detail",
        "reporter_name",
        "reporter_phone",
        "created_at",
        "status",
        "resolution_note",
        "suspension",
        "handled_by",
        "handled_at",
    )
    readonly_fields = (
        "reference",
        "provider",
        "category",
        "detail",
        "reporter_name",
        "reporter_phone",
        "created_at",
        "suspension",
        "handled_by",
        "handled_at",
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_suspend_permission(self, request):
        return request.user.has_perm("providers.add_suspension")

    @admin.display(description="Urgent", boolean=True)
    def urgent(self, obj):
        return obj.is_urgent

    def save_model(self, request, obj, form, change):
        if "status" in form.changed_data:
            obj.handled_by = request.user
            obj.handled_at = timezone.now()
        super().save_model(request, obj, form, change)

    @admin.action(description="Suspend the listing", permissions=["suspend"])
    def suspend_listing(self, request, queryset):
        for complaint in queryset.select_related("provider"):
            suspend_complained_about(complaint, actor=request.user)
        self.message_user(
            request,
            "Suspended, with each complaint recorded as the reason. Lift a suspension from "
            "Suspensions when the workshop has put things right.",
        )


@admin.register(Suspension)
class SuspensionAdmin(admin.ModelAdmin):
    """Moderation. Section 09 requires the reason to be logged, so it is required."""

    list_display = ("provider", "reason", "raised_by", "started_at", "lifted_at")
    list_filter = ("started_at", "lifted_at")
    search_fields = ("provider__name", "reason")
    autocomplete_fields = ("provider", "raised_by")
    readonly_fields = ("complaints_behind",)

    @admin.display(description="Complaints behind it")
    def complaints_behind(self, obj):
        if obj.pk is None:
            return "—"
        complaints = obj.complaints.all()
        if not complaints:
            return "None: raised by staff directly."
        return format_html_join(
            ", ",
            '<a href="{}">{}</a>',
            (
                (reverse("admin:providers_complaint_change", args=[c.pk]), c.reference)
                for c in complaints
            ),
        )

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
        "prompted_by",
        "responded_at",
        "channel",
        "fees_confirmed",
        "intakes_confirmed",
    )
    list_filter = ("channel", "fees_confirmed", "intakes_confirmed", "prompted_at")
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider", "confirmed_by")
    readonly_fields = ("prompted_by",)

    def save_model(self, request, obj, form, change):
        # Whoever records the owner's answer is the one vouching for it.
        if obj.responded_at and obj.confirmed_by_id is None:
            obj.confirmed_by = request.user
        # Clearing "prompted at" puts a prompt back in the queue, for an
        # officer who opened WhatsApp and backed out without sending.
        if obj.prompted_at is None:
            obj.prompted_by = None
        super().save_model(request, obj, form, change)
        if obj.responded_at and obj.fees_confirmed and obj.intakes_confirmed:
            Provider.objects.filter(pk=obj.provider_id).update(last_confirmed_at=obj.responded_at)


@admin.register(OwnerNotice)
class OwnerNoticeAdmin(admin.ModelAdmin):
    """The record of owners told their listing is live, or that someone enquired.

    Created by publishing or by an enquiry, sent from Messages to send. The only edit is
    clearing "sent at", which puts a notice back in the queue for an officer
    who opened WhatsApp and backed out without sending.
    """

    list_display = ("provider", "kind", "created_at", "sent_at", "sent_by")
    list_filter = ("kind", "sent_at")
    search_fields = ("provider__name",)
    fields = ("provider", "kind", "enquiry", "created_at", "sent_at", "sent_by")
    readonly_fields = ("provider", "kind", "enquiry", "created_at", "sent_by")
    list_select_related = ("provider", "sent_by")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        if obj.sent_at is None:
            obj.sent_by = None
        super().save_model(request, obj, form, change)


class PhotoApprovalFilter(admin.SimpleListFilter):
    title = "approval"
    parameter_name = "approval"

    def lookups(self, request, model_admin):
        return (("waiting", "Waiting for approval"), ("approved", "Shown on the site"))

    def queryset(self, request, queryset):
        if self.value() == "waiting":
            return queryset.filter(approved_at__isnull=True)
        if self.value() == "approved":
            return queryset.filter(approved_at__isnull=False)
        return queryset


@admin.register(ProviderPhoto)
class ProviderPhotoAdmin(admin.ModelAdmin):
    """Every workshop photo, to approve, hide or delete one at a time.

    A photo is on public pages only once approved. "Waiting for approval"
    lists the ones to look at; tick them and choose an action. To remove one
    photo for good, open it and press Delete, or tick it and choose "Delete
    selected". Also where staff pair a 'before' with the finished work: set
    the kind to "The same work, before" and choose the work photo it goes with.
    """

    list_display = (
        "thumbnail",
        "provider",
        "kind",
        "approval",
        "caption",
        "uploaded_by",
        "created_at",
    )
    list_display_links = ("thumbnail", "provider")
    list_filter = (PhotoApprovalFilter, "kind", "exif_stripped")
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider",)
    raw_id_fields = ("shows_before_of",)
    readonly_fields = ("preview", "exif_stripped", "approved_at", "approved_by", "uploaded_by")
    actions = ("approve_photos", "hide_photos")
    list_select_related = ("provider", "uploaded_by")

    @admin.display(description="Photo")
    def thumbnail(self, obj):
        if not obj.image:
            return "—"
        return format_html(
            '<img src="{}" alt="" style="width:72px;height:54px;object-fit:cover;border-radius:6px">',
            obj.image.url,
        )

    @admin.display(description="Photo")
    def preview(self, obj):
        if not obj or not obj.image:
            return "—"
        return format_html(
            '<img src="{}" alt="" style="max-width:420px;max-height:320px;border-radius:8px">',
            obj.image.url,
        )

    @admin.display(description="On the site", boolean=False, ordering="approved_at")
    def approval(self, obj):
        if obj.is_approved:
            return format_html('<span style="color:#15803d;font-weight:600">Approved</span>')
        return format_html('<span style="color:#b45309;font-weight:600">Waiting</span>')

    @admin.action(description="Approve: show these photos on the site")
    def approve_photos(self, request, queryset):
        from django.utils import timezone

        count = queryset.filter(approved_at__isnull=True).update(
            approved_at=timezone.now(), approved_by=request.user
        )
        self.message_user(request, f"{count} photo(s) approved and now shown on the site.")

    @admin.action(description="Hide: take these photos off the site (keeps them)")
    def hide_photos(self, request, queryset):
        count = queryset.filter(approved_at__isnull=False).update(
            approved_at=None, approved_by=None
        )
        self.message_user(
            request, f"{count} photo(s) hidden from the site. Delete them to remove for good."
        )

    def get_fields(self, request, obj=None):
        fields = [
            "preview",
            "provider",
            "kind",
            "shows_before_of",
            "image",
            "caption",
            "display_order",
            "exif_stripped",
            "uploaded_by",
            "approved_at",
            "approved_by",
        ]
        return fields if obj else [f for f in fields if f not in ("preview",)]

    def save_model(self, request, obj, form, change):
        # A photo staff add here is one they chose, so it is approved.
        if not change and obj.approved_at is None:
            obj.approve(request.user)
        if obj.uploaded_by_id is None:
            obj.uploaded_by = request.user
        super().save_model(request, obj, form, change)


class ProviderVideoForm(forms.ModelForm):
    """Staff can upload a video for a workshop, as the trainer would.

    For the field officer who collects a course on a visit, over the office
    connection, rather than leaving a workshop to send hours of video on
    mobile data. A browser form takes the file in one request, which is fine
    on office Wi-Fi and is why trainers use the piece-by-piece upload instead.
    """

    file = forms.FileField(
        required=False,
        help_text="The video as filmed. It is prepared for phones, then goes on the listing "
        "(or waits for review, if this workshop's videos do).",
    )

    class Meta:
        model = ProviderVideo
        fields = ("provider", "title", "status", "review_note")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Only the review decisions are offered: the states before them are
        # the uploader's and the encoder's to set, not a reviewer's.
        if "status" in self.fields:
            self.fields["status"].choices = [
                choice
                for choice in ProviderVideo.Status.choices
                if choice[0] in ProviderVideo.REVIEWABLE
            ]

    def clean(self):
        cleaned = super().clean()
        if self.instance.pk is None:
            upload = cleaned.get("file")
            if upload is None:
                self.add_error("file", "Choose the video to upload.")
            elif upload.size > settings.VIDEO_MAX_UPLOAD_BYTES:
                self.add_error(
                    "file",
                    f"That file is larger than {settings.VIDEO_MAX_UPLOAD_BYTES // 1024**3} GB.",
                )
        if (
            cleaned.get("status") == ProviderVideo.Status.REJECTED
            and not (cleaned.get("review_note") or "").strip()
        ):
            self.add_error(
                "review_note",
                "Say which guideline it breaks. The workshop sees this note, and "
                '"blocked" on its own gives them nothing to fix.',
            )
        return cleaned


class VideoNeedsStaffFilter(admin.SimpleListFilter):
    """What is left to do: the back office's video queue links here."""

    title = "needs staff"
    parameter_name = "needs"

    def lookups(self, request, model_admin):
        return (
            ("all", "Anything to do"),
            ("unwatched", "Live, not yet watched"),
            ("reported", "Reported"),
            ("pending", "Waiting for review"),
        )

    def queryset(self, request, queryset):
        match self.value():
            case "all":
                return queryset.needing_staff()
            case "unwatched":
                return queryset.unwatched()
            case "reported":
                return queryset.reported()
            case "pending":
                return queryset.filter(status=ProviderVideo.Status.PENDING)
        return queryset


@admin.register(ProviderVideo)
class ProviderVideoAdmin(admin.ModelAdmin):
    """Teaching videos. Each goes on its listing once prepared, and staff
    watch it afterwards (settings.VIDEO_PUBLISH_WITHOUT_REVIEW).

    "Needs staff: anything to do" lists the videos live but not yet watched,
    the ones viewers reported, and the ones waiting for review (a workshop
    with two videos blocked waits again). Once watched, keep it with the
    "Watched: keep on the listing" action. Block one on its page: set the
    status to Blocked and write a note the workshop will read; it comes off
    the listing at once, and the workshop is told. What to check: it is the workshop's own
    video rather than someone else's reposted; anyone on camera, such as the
    client whose hair is being done, can be seen to be taking part willingly; no
    child appears without a guardian; chemicals, heat and tools are handled
    safely; and it teaches something, rather than only advertising.

    A long lesson does not need watching end to end. Watch the start, then
    skip to a few points through it: the player can jump anywhere.
    """

    form = ProviderVideoForm
    list_display = (
        "thumbnail",
        "title",
        "provider",
        "status",
        "watched",
        "open_reports",
        "length",
        "created_at",
    )
    list_display_links = ("thumbnail", "title")
    list_filter = (VideoNeedsStaffFilter, "status")
    search_fields = ("title", "provider__name")
    list_select_related = ("provider",)
    autocomplete_fields = ("provider",)
    actions = ("approve_videos",)

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                open_report_count=Count("reports", filter=Q(reports__resolved_at__isnull=True))
            )
        )

    def get_fields(self, request, obj=None):
        if obj is None:
            return ["provider", "file", "title"]
        fields = ["player", "provider", "title", "reports_list"]
        fields += ["youtube_link"] if obj.is_youtube else ["length", "sizes", "failure_reason"]
        fields += ["added_by", "created_at", "guidelines_agreed_at"]
        fields += ["status", "review_note", "reviewed_by", "reviewed_at"]
        return fields

    def get_readonly_fields(self, request, obj=None):
        readonly = [
            "player",
            "reports_list",
            "youtube_link",
            "length",
            "sizes",
            "failure_reason",
            "added_by",
            "created_at",
            "guidelines_agreed_at",
            "reviewed_by",
            "reviewed_at",
        ]
        if obj is not None:
            readonly.append("provider")
            # Nothing to decide on until it has been prepared.
            if obj.status not in ProviderVideo.REVIEWABLE:
                readonly += ["status", "review_note"]
        return readonly

    def get_urls(self):
        return [
            path(
                "<int:pk>/watch/<str:which>/",
                self.admin_site.admin_view(self.watch),
                name="providers_providervideo_watch",
            ),
            *super().get_urls(),
        ]

    def watch(self, request, pk, which):
        """A private file of a video under review, for staff only.

        Approved files are public and the player uses their public address;
        this is for everything before that, which is in private storage and
        has no address of its own.
        """
        if which not in ("360", "720", "poster"):
            raise Http404
        video = get_object_or_404(ProviderVideo, pk=pk)
        if not self.has_view_permission(request, video):
            raise PermissionDenied
        file = getattr(video, f"review_{which}")
        if not file:
            raise Http404
        return serve_private_file(request, file)

    def _file_url(self, obj, which):
        public = getattr(obj, f"public_{which}")
        if public:
            return public.url
        if getattr(obj, f"review_{which}"):
            return reverse("admin:providers_providervideo_watch", args=[obj.pk, which])
        return None

    @admin.display(description="Preview")
    def thumbnail(self, obj):
        src = obj.thumbnail_url if obj.is_youtube else self._file_url(obj, "poster")
        if src is None:
            return obj.get_status_display()
        return format_html(
            '<img src="{}" alt="" width="120" height="68" loading="lazy" '
            'style="object-fit:cover;border-radius:6px;background:#000">',
            src,
        )

    @admin.display(description="Video")
    def player(self, obj):
        if obj.is_youtube:
            return format_html(
                '<iframe src="{}" title="{}" width="480" height="270" '
                'style="max-width:100%;border:0;border-radius:8px" '
                'allow="encrypted-media; picture-in-picture; fullscreen" '
                'referrerpolicy="strict-origin-when-cross-origin"></iframe>',
                obj.embed_url,
                obj.title,
            )
        # The sharper copy when there is one: a reviewer is checking detail,
        # on the office connection.
        src = self._file_url(obj, "720") or self._file_url(obj, "360")
        if src is None:
            return f"Nothing to watch yet: {obj.get_status_display().lower()}."
        return format_html(
            '<video src="{}" poster="{}" controls preload="metadata" width="480" '
            'style="max-width:100%;border-radius:8px;background:#000"></video>',
            src,
            self._file_url(obj, "poster") or "",
        )

    @admin.display(description="Watched by staff")
    def watched(self, obj):
        if obj.status != ProviderVideo.Status.APPROVED or obj.is_youtube:
            return "—"
        return "Yes" if obj.reviewed_at else "Not yet"

    @admin.display(description="Reports", ordering="open_report_count")
    def open_reports(self, obj):
        count = getattr(obj, "open_report_count", None)
        if count is None:
            count = obj.reports.filter(resolved_at__isnull=True).count()
        return count or "—"

    @admin.display(description="Reports from viewers")
    def reports_list(self, obj):
        reports = list(obj.reports.select_related("reporter")[:20])
        if not reports:
            return "None."
        return format_html(
            '<ul style="margin:0;padding-left:1.2em">{}</ul>',
            format_html_join(
                "",
                "<li><strong>{}</strong>{} <small>({}{})</small></li>",
                (
                    (
                        report.get_reason_display(),
                        f": {report.note}" if report.note else "",
                        timezone.localtime(report.created_at).strftime("%d %b %Y"),
                        ", dealt with" if report.resolved_at else "",
                    )
                    for report in reports
                ),
            ),
        )

    @admin.display(description="Length")
    def length(self, obj):
        if obj.duration_seconds is None:
            return "—"
        minutes, seconds = divmod(obj.duration_seconds, 60)
        hours, minutes = divmod(minutes, 60)
        return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"

    @admin.display(description="Files")
    def sizes(self, obj):
        parts = [
            f"{quality}p {size / 1024**2:.1f} MB"
            for quality, size in ((360, obj.size_360), (720, obj.size_720))
            if size
        ]
        return ", ".join(parts) or "—"

    @admin.display(description="On YouTube")
    def youtube_link(self, obj):
        return format_html(
            '<a href="{}" target="_blank" rel="noopener noreferrer">{}</a>',
            obj.watch_url,
            obj.watch_url,
        )

    def save_model(self, request, obj, form, change):
        if obj.pk is None:
            upload = form.cleaned_data["file"]
            obj.added_by = request.user
            obj.status = ProviderVideo.Status.UPLOADING
            obj.upload_name = upload.name[:255]
            obj.upload_size = upload.size
            obj.save()
            # Into the same place a trainer's pieces go, so the encoder needs
            # to know nothing about where a video came from.
            with open(video_uploads.work_path(obj), "wb") as handle:
                for piece in upload.chunks():
                    handle.write(piece)
            obj.upload_received = upload.size
            obj.status = ProviderVideo.Status.QUEUED
            obj.save(update_fields=["upload_received", "status", "updated_at"])
            return
        if "status" in form.changed_data:
            # decide() moves the files, and needs to know where they are now.
            decision = obj.status
            obj.status = form.initial["status"]
            decide(obj, decision, by=request.user, note=obj.review_note)
            return
        super().save_model(request, obj, form, change)

    @admin.action(description="Watched: keep on the listing", permissions=["change"])
    def approve_videos(self, request, queryset):
        """Approve the ones waiting, mark the live ones as watched, and close
        any reports on them. A blocked one selected here is unblocked."""
        kept = 0
        for video in queryset.filter(status__in=ProviderVideo.REVIEWABLE):
            decide(video, ProviderVideo.Status.APPROVED, by=request.user)
            kept += 1
        self.message_user(
            request,
            f"{kept} video(s) marked as watched and kept. They show on their listings, "
            "if the listing itself is published. Videos still uploading or being "
            "prepared are left as they are.",
        )


@admin.register(VideoReport)
class VideoReportAdmin(admin.ModelAdmin):
    """Viewers' reports, read-only. They are dealt with on the video itself:
    keeping or blocking it closes every open report on it."""

    list_display = ("video", "reason", "note", "reporter", "created_at", "resolved_at")
    list_filter = ("reason", ("resolved_at", admin.EmptyFieldListFilter))
    search_fields = ("video__title", "video__provider__name", "note")
    list_select_related = ("video", "video__provider", "reporter")
    readonly_fields = ("video", "reporter", "reason", "note", "created_at", "resolved_at")
    fields = readonly_fields

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ProviderEvidence)
class ProviderEvidenceAdmin(admin.ModelAdmin):
    """Private evidence. Deliberately not linked from any public view."""

    list_display = ("provider", "kind", "verification", "exif_stripped", "created_at")
    list_filter = ("kind", "exif_stripped")
    search_fields = ("provider__name",)
    autocomplete_fields = ("provider", "verification")
    readonly_fields = ("exif_stripped",)


@admin.register(TrainerAccount)
class TrainerAccountAdmin(TrainerRemovalAdmin, admin.ModelAdmin):
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

        A POST rather than a link because this changes state: a GET that
        confirms an account would be followed by every crawler and prefetcher
        that ever sees the page.

        A button with formaction, not a form of its own. The whole result
        table already sits inside the changelist's form, and HTML has no
        nested forms: the parser drops the inner <form> tag, so the button
        submitted the changelist instead and nothing was confirmed. Then the
        inner </form> closed the changelist's form early, cutting every row
        below the first off from the bulk actions. formaction sends the
        changelist's own form, CSRF token included, to the confirm URL.
        """
        if obj.approval_status == TrainerAccount.Approval.CONFIRMED:
            return format_html('<span class="row-decided">Confirmed</span>')

        return format_html(
            '<span class="row-decide">'
            '<button type="submit" class="row-confirm" formaction="{}" formmethod="post">'
            "Confirm</button>"
            "</span>"
            '<a class="row-review" href="{}">Review</a>',
            reverse("admin:providers_traineraccount_confirm", args=[obj.pk]),
            reverse("admin:providers_traineraccount_change", args=[obj.pk]),
        )

    def get_urls(self):
        return [
            path(
                "<int:pk>/confirm/",
                self.admin_site.admin_view(self.confirm_one),
                name="providers_traineraccount_confirm",
            ),
            path(
                "<int:pk>/id-photo/",
                self.admin_site.admin_view(self.id_photo),
                name="providers_traineraccount_id_photo",
            ),
            *super().get_urls(),
        ]

    def id_photo(self, request, pk):
        """The trainer's ID photo, for staff who can see this account, and nobody else.

        Private storage has no address of its own (Section 10: identity
        documents are never publicly served), so the picture on the page is
        fetched through here, behind the admin's login and this permission.
        """
        from .identity import id_file

        account = get_object_or_404(TrainerAccount, pk=pk)
        if not self.has_view_permission(request, account):
            raise PermissionDenied
        file = id_file(account, self._owned_provider_object(account))
        if not file:
            raise Http404
        response = serve_private_file(request, file)
        # Not kept in the browser's cache, which outlives the admin session.
        response["Cache-Control"] = "private, no-store"
        return response

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
        from .identity import has_id_on_file

        if not has_id_on_file(obj, self._owned_provider_object(obj)):
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

    @admin.display(description="ID check")
    def identity_document_link(self, obj):
        """The ID photo beside what was typed and what was read, and what to look at twice.

        Confirming asks whether this is a real person who is who they say. That
        used to mean opening the photo on another page and holding the typed
        name and number in your head; now they sit side by side, with the card
        reader's result (TrainerIdPhoto) between them.

        The reading is the trainer's help, not evidence: a fake card reads as
        well as a real one. The flags say where to look, not what to decide.

        The picture comes through id_photo, behind this admin's permission.
        Section 10 requires identity documents are never publicly served, and
        private storage has no address of its own.
        """
        from .id_numbers import id_number_problem
        from .id_reading import names_match
        from .identity import id_file, latest_id_photo

        provider = self._owned_provider_object(obj)
        if id_file(obj, provider) is None:
            return "No ID photo yet. The trainer cannot send for review without one."
        scan = latest_id_photo(obj)
        src = reverse("admin:providers_traineraccount_id_photo", args=[obj.pk])
        picture = format_html(
            '<a href="{}" target="_blank" rel="noopener">'
            '<img src="{}" alt="Photo of the trainer\'s ID" '
            'style="max-width:440px;width:100%;border:1px solid #ccc;border-radius:6px"></a>'
            "<br><small>Click to open it full size.</small>",
            src,
            src,
        )

        def verdict(same):
            if same is None:
                return ""
            return format_html(
                '<strong style="color:{}">{}</strong>',
                "#15803d" if same else "#b91c1c",
                "Same" if same else "Different",
            )

        nothing_read = (
            "Not read: the card reader is not installed"
            if scan and scan.reading == TrainerIdPhoto.Reading.UNAVAILABLE
            else "Nothing read"
        )
        rows = []
        if scan is not None:
            typed_number, read_number = obj.id_document_number, scan.read_number
            name_same = names_match(obj.full_name, scan.read_name)
            rows = [
                (
                    "ID type",
                    obj.get_id_document_type_display() or "—",
                    scan.get_document_type_display() or "—",
                    verdict(
                        obj.id_document_type == scan.document_type
                        if obj.id_document_type and scan.document_type
                        else None
                    ),
                ),
                (
                    "Number",
                    typed_number or "—",
                    read_number or nothing_read,
                    verdict(typed_number == read_number if typed_number and read_number else None),
                ),
                ("Name", obj.full_name or "—", scan.read_name or nothing_read, verdict(name_same)),
            ]
        table = (
            format_html(
                '<table style="margin-top:12px;max-width:640px"><thead><tr><th></th>'
                "<th>Typed by them</th><th>Read from the card</th><th></th></tr></thead>"
                "<tbody>{}</tbody></table>",
                format_html_join(
                    "",
                    "<tr><th>{}</th><td>{}</td><td>{}</td><td>{}</td></tr>",
                    rows,
                ),
            )
            if rows
            else format_html(
                "<p><small>{}</small></p>",
                "Photo sent before the card reader existed: compare it with the name and "
                "number above by eye.",
            )
        )

        flags = []
        for clash in obj.id_clashes_against.select_related("account"):
            flags.append(
                format_html(
                    'The account <a href="{}">{}</a> tried to use this ID number ({}).',
                    reverse("admin:providers_traineraccount_change", args=[clash.account_id]),
                    clash.account.phone,
                    timezone.localtime(clash.updated_at).strftime("%d %b %Y"),
                )
            )
        for clash in obj.id_clashes.select_related("other_account"):
            flags.append(
                format_html(
                    'This account tried {}, which is on <a href="{}">{}</a> ({}). It was refused.',
                    clash.number,
                    reverse("admin:providers_traineraccount_change", args=[clash.other_account_id]),
                    clash.other_account.phone,
                    timezone.localtime(clash.updated_at).strftime("%d %b %Y"),
                )
            )
        problem = id_number_problem(obj.id_document_type, obj.id_document_number)
        if obj.id_document_number and problem:
            flags.append(format_html("The number does not fit the rules: {}", problem))
        if scan is not None:
            if obj.id_document_number and scan.read_number:
                if obj.id_document_number != scan.read_number:
                    flags.append("The number typed is not the number read from the card.")
            elif obj.id_document_number:
                flags.append("The number was typed by hand, not read from the photo.")
            if names_match(obj.full_name, scan.read_name) is False:
                flags.append("The name typed is not the name read from the card.")
        flag_list = (
            format_html(
                '<ul style="margin:12px 0 0;padding-left:18px;color:#b45309">{}</ul>',
                format_html_join("", "<li>{}</li>", ((flag,) for flag in flags)),
            )
            if flags
            else ""
        )
        return format_html("{}{}{}", picture, table, flag_list)

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


@admin.register(IdNumberClash)
class IdNumberClashAdmin(admin.ModelAdmin):
    """ID numbers someone tried on a second account. Each was refused.

    One card, one account. A row here is either the same person who lost the
    phone they signed up with, or someone using another person's card, and
    only a person can tell which: open both accounts and compare their ID
    photos. Read-only, because it is a record of what happened.
    """

    list_display = ("number", "document_type", "tried_by", "already_on", "updated_at")
    list_filter = ("document_type",)
    search_fields = ("number", "account__phone", "other_account__phone")
    ordering = ("-updated_at",)
    readonly_fields = (
        "number",
        "document_type",
        "tried_by",
        "already_on",
        "created_at",
        "updated_at",
    )
    fields = readonly_fields

    def _trainer_link(self, account):
        return format_html(
            '<a href="{}">{}</a>',
            reverse("admin:providers_traineraccount_change", args=[account.pk]),
            account.full_name or account.phone,
        )

    @admin.display(description="Tried by", ordering="account__phone")
    def tried_by(self, obj):
        return self._trainer_link(obj.account)

    @admin.display(description="Already on", ordering="other_account__phone")
    def already_on(self, obj):
        return self._trainer_link(obj.other_account)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
