"""Enquiries, outcomes and enrolments.

Two things here are field work rather than software, and the admin exists to
make that field work recordable:

* Enrolments are collected by asking the provider each month. Section 07 says
  outright that if this number cannot be produced honestly, the subscription
  model is in trouble, and it is better to know in month four than month
  fourteen.
* Completion and attestation are asked in the same conversation. Nothing in
  version 1 reads them, and they cannot be reconstructed later.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db.models import Case, CharField, Count, DecimalField, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.http import Http404, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html
from django.utils.timesince import timesince
from django.views.decorators.http import require_POST
from import_export.admin import ExportActionMixin

from . import check_ins, queues
from .models import Enquiry, EnquiryOutcome, Enrolment, MonthlyCheckIn, PhoneVerification


def trainee_account_link(obj):
    """A link to the trainee account. The account page checks its own permission."""
    if not obj or not obj.trainee_id:
        return "No account"
    return format_html(
        '<a href="{}">Open trainee account</a>',
        reverse("admin:trainees_traineeaccount_change", args=[obj.trainee_id]),
    )


class EnquiryOutcomeInline(admin.StackedInline):
    model = EnquiryOutcome
    extra = 1
    max_num = 1
    can_delete = False
    fields = ("replied", "replied_at", "visited", "enrolled", "note", "recorded_by")
    readonly_fields = ("recorded_by",)
    verbose_name_plural = "Outcome (reported by a human — the conversation is on WhatsApp)"


class EnquiryWorkQueueFilter(admin.SimpleListFilter):
    """Expose the same operational stages as the workbench queue tabs."""

    title = "work queue"
    parameter_name = "queue"

    def lookups(self, request, model_admin):
        return [(queue.key, queue.label) for queue in queues.QUEUES]

    def queryset(self, request, queryset):
        queue = queues.QUEUES_BY_KEY.get(self.value())
        return queue.narrow(queryset) if queue else queryset


def _admin_urls(request, parameter_name):
    """Build switch/reset URLs while retaining Django popup selection data."""
    base_params = request.GET.copy()
    base_params.pop("p", None)

    all_params = base_params.copy()
    all_params.pop(parameter_name, None)
    all_url = f"?{all_params.urlencode()}" if all_params else "?"

    reset_params = request.GET.copy()
    for key in tuple(reset_params):
        if key not in {"_popup", "_to_field"}:
            reset_params.pop(key)
    reset_url = f"?{reset_params.urlencode()}" if reset_params else "?"
    return base_params, all_url, reset_url


@admin.register(Enquiry)
class EnquiryAdmin(admin.ModelAdmin):
    list_display = (
        "reference_code",
        "provider",
        "programme",
        "trainee_summary",
        "state_summary",
        "outcome_summary",
        "age_summary",
    )
    list_filter = (
        EnquiryWorkQueueFilter,
        "state",
        "created_at",
        "provider__area__region",
    )
    search_fields = (
        "reference_code",
        "trainee_phone",
        "trainee_name",
        "provider__name",
        "programme__title",
    )
    search_help_text = "Search by reference, trainee phone or name, provider, or programme."
    autocomplete_fields = ("provider", "programme", "intake")
    date_hierarchy = "created_at"
    inlines = [EnquiryOutcomeInline]
    list_select_related = (
        "provider",
        "provider__area",
        "provider__area__region",
        "programme",
        "programme__trade",
        "intake",
        "outcome",
        "outcome__recorded_by",
        "enrolment",
    )
    actions = ("mark_as_spam", "restore_spam_to_workflow")
    change_list_template = "admin/enquiries/enquiry/change_list.html"
    change_form_template = "admin/enquiries/enquiry/change_form.html"

    # An enquiry is a record of something a trainee did. Staff annotate the
    # outcome; they do not rewrite who sent it, what they sent, or where it was
    # directed. Delivery state remains editable for operational correction.
    readonly_fields = (
        "reference_code",
        "provider",
        "programme",
        "intake",
        "trainee_phone",
        "trainee_name",
        "message",
        "phone_verified_at",
        "trainee_account",
        "workshop_alert",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        (
            "Source",
            {
                "fields": (
                    "reference_code",
                    "provider",
                    "programme",
                    "intake",
                    "created_at",
                    "updated_at",
                ),
                "description": "Captured from the trainee's original submission and not editable.",
            },
        ),
        (
            "Trainee submission",
            {
                "fields": (
                    "trainee_phone",
                    "trainee_name",
                    "message",
                    "phone_verified_at",
                    "trainee_account",
                )
            },
        ),
        ("Delivery", {"fields": ("state", "workshop_alert")}),
    )

    @admin.display(description="Trainee account")
    def trainee_account(self, obj):
        return trainee_account_link(obj)

    @admin.display(description="Workshop told")
    def workshop_alert(self, obj):
        """Whether an officer has sent the workshop its WhatsApp alert yet."""
        notice = obj.owner_alerts.select_related("sent_by").first()
        if notice is None:
            return "—"
        if notice.sent_at is None:
            return format_html(
                'Not yet — waiting on <a href="{}">Messages to send</a>',
                reverse("admin:providers_provider_messages"),
            )
        sent = timezone.localtime(notice.sent_at).strftime("%d %b %Y, %H:%M")
        return f"{sent}, by {notice.sent_by}" if notice.sent_by else sent

    def get_queryset(self, request):
        """Annotate the furthest honest outcome for fast display and sorting."""
        return (
            super()
            .get_queryset(request)
            .annotate(
                admin_outcome_stage=Case(
                    When(state=Enquiry.State.SPAM, then=Value("excluded")),
                    When(
                        Q(enrolment__isnull=False) | Q(outcome__enrolled=True),
                        then=Value("enrolled"),
                    ),
                    When(outcome__visited=True, then=Value("visited")),
                    When(outcome__replied=True, then=Value("replied")),
                    When(state=Enquiry.State.SENT, then=Value("awaiting_reply")),
                    default=Value("not_recorded"),
                    output_field=CharField(),
                )
            )
        )

    def changelist_view(self, request, extra_context=None):
        """Publish stable queue metadata for the modern changelist template."""
        current_key = request.GET.get(EnquiryWorkQueueFilter.parameter_name)
        current_queue = queues.QUEUES_BY_KEY.get(current_key)
        count_map = queues.counts(self.get_queryset(request))
        base_params, all_url, reset_url = _admin_urls(
            request, EnquiryWorkQueueFilter.parameter_name
        )

        queue_links = []
        for queue in queues.QUEUES:
            params = base_params.copy()
            params[EnquiryWorkQueueFilter.parameter_name] = queue.key
            queue_links.append(
                {
                    "key": queue.key,
                    "label": queue.label,
                    "description": queue.description,
                    "tone": queue.tone,
                    "count": count_map[queue.key],
                    "url": f"?{params.urlencode()}",
                    "active": current_queue is queue,
                }
            )

        all_link = {
            "key": queues.ALL.key,
            "label": queues.ALL.label,
            "description": queues.ALL.description,
            "tone": queues.ALL.tone,
            "count": count_map[queues.ALL.key],
            "url": all_url,
            "active": current_queue is None,
        }
        workbench = {
            "title": current_queue.label if current_queue else queues.ALL.label,
            "description": (current_queue.description if current_queue else queues.ALL.description),
            "current_key": current_queue.key if current_queue else queues.ALL.key,
            "matching": count_map[current_queue.key]
            if current_queue
            else count_map[queues.ALL.key],
            "total": count_map[queues.ALL.key],
            "queues": [all_link, *queue_links],
        }

        context = {
            "enquiry_workbench": workbench,
            # Compatibility keys keep the template contract parallel with the
            # Provider workbench and allow incremental template rollout.
            "enquiry_work_queue": current_queue,
            "enquiry_queue_links": queue_links,
            "enquiry_all_url": all_url,
            "enquiry_reset_url": reset_url,
            "enquiry_queue_description": workbench["description"],
        }
        context.update(extra_context or {})
        response = super().changelist_view(request, extra_context=context)
        if hasattr(response, "context_data") and response.context_data.get("cl"):
            workbench["matching"] = response.context_data["cl"].result_count
            workbench["total"] = response.context_data["cl"].full_result_count
        return response

    @admin.display(description="Trainee", ordering="trainee_name")
    def trainee_summary(self, obj):
        if obj.trainee_name:
            return format_html(
                '<span class="eq-trainee"><strong>{}</strong><small>{}</small></span>',
                obj.trainee_name,
                obj.trainee_phone,
            )
        return format_html('<span class="eq-trainee"><strong>{}</strong></span>', obj.trainee_phone)

    @admin.display(description="Delivery", ordering="state")
    def state_summary(self, obj):
        tones = {
            Enquiry.State.PENDING_VERIFICATION: "warning",
            Enquiry.State.SENT: "info",
            Enquiry.State.FAILED: "attention",
            Enquiry.State.SPAM: "muted",
        }
        return format_html(
            '<span class="eq-state eq-state-pill eq-state--{} eq-state-pill--{}">'
            '<span class="eq-state__dot" aria-hidden="true"></span>{}</span>',
            tones[obj.state],
            obj.state,
            obj.get_state_display(),
        )

    @admin.display(description="Outcome", ordering="admin_outcome_stage")
    def outcome_summary(self, obj):
        stages = {
            "enrolled": ("positive", "Enrolled"),
            "visited": ("positive", "Visited"),
            "replied": ("info", "Replied"),
            "awaiting_reply": ("warning", "Awaiting reply"),
            "excluded": ("muted", "Excluded"),
            "not_recorded": ("muted", "Not recorded"),
        }
        tone, label = stages[obj.admin_outcome_stage]
        return format_html('<span class="eq-outcome eq-outcome--{}">{}</span>', tone, label)

    @admin.display(description="Age", ordering="created_at")
    def age_summary(self, obj):
        """Show response SLA for active work, not age-as-alarm for finished work."""
        now = timezone.now()
        local_created = timezone.localtime(obj.created_at)
        exact_created = local_created.strftime("%d %b %Y, %H:%M")
        outcome = getattr(obj, "outcome", None)

        if obj.admin_outcome_stage == "replied" and outcome and outcome.replied_at:
            response_time = outcome.replied_at - obj.created_at
            tone = "positive" if response_time <= timedelta(hours=48) else "attention"
            label = timesince(obj.created_at, outcome.replied_at, depth=1)
            exact_reply = timezone.localtime(outcome.replied_at).strftime("%d %b %Y, %H:%M")
            return format_html(
                '<time class="eq-age eq-age--{}" datetime="{}" '
                'title="Received {} · replied {}">Replied in {}</time>',
                tone,
                outcome.replied_at.isoformat(),
                exact_created,
                exact_reply,
                label,
            )

        if obj.admin_outcome_stage == "replied":
            return format_html(
                '<time class="eq-age eq-age--neutral" datetime="{}" '
                'title="Received {}">Reply time not recorded</time>',
                obj.created_at.isoformat(),
                exact_created,
            )

        elapsed = now - obj.created_at
        label = timesince(obj.created_at, now, depth=1)
        if obj.admin_outcome_stage == "awaiting_reply":
            tone = "overdue" if elapsed > timedelta(hours=48) else "warning"
            return format_html(
                '<time class="eq-age eq-age--{}" datetime="{}" '
                'title="Received {}">Waiting {}</time>',
                tone,
                obj.created_at.isoformat(),
                exact_created,
                label,
            )

        tone = "muted" if obj.admin_outcome_stage == "excluded" else "neutral"
        return format_html(
            '<time class="eq-age eq-age--{}" datetime="{}" title="Received {}">'
            "Received {} ago</time>",
            tone,
            obj.created_at.isoformat(),
            exact_created,
            label,
        )

    @admin.action(description="Mark selected enquiries as spam", permissions=("change",))
    def mark_as_spam(self, request, queryset):
        updated = queryset.exclude(state=Enquiry.State.SPAM).update(state=Enquiry.State.SPAM)
        skipped = queryset.count() - updated
        self.message_user(request, f"{updated} enquiry(s) marked as spam.")
        if skipped:
            self.message_user(request, f"{skipped} already marked as spam.", messages.WARNING)

    @admin.action(
        description="Restore selected spam to the enquiry workflow",
        permissions=("change",),
    )
    def restore_spam_to_workflow(self, request, queryset):
        spam = queryset.filter(state=Enquiry.State.SPAM)
        verified = spam.filter(phone_verified_at__isnull=False).count()
        unverified = spam.filter(phone_verified_at__isnull=True).count()
        updated = spam.update(
            state=Case(
                When(phone_verified_at__isnull=False, then=Value(Enquiry.State.SENT)),
                default=Value(Enquiry.State.PENDING_VERIFICATION),
                output_field=CharField(),
            )
        )
        skipped = queryset.count() - updated
        self.message_user(
            request,
            f"{updated} enquiry(s) restored: {verified} returned to sent and "
            f"{unverified} to awaiting verification.",
        )
        if skipped:
            self.message_user(
                request, f"{skipped} skipped because they were not spam.", messages.WARNING
            )

    def save_formset(self, request, form, formset, change):
        """Attribute every human-reported outcome to the staff member saving it."""
        instances = formset.save(commit=False)
        for deleted in formset.deleted_objects:
            deleted.delete()
        for instance in instances:
            if isinstance(instance, EnquiryOutcome):
                if not instance.recorded_by_id:
                    instance.recorded_by = request.user
                if instance.replied and instance.replied_at is None:
                    instance.replied_at = timezone.now()
            instance.save()
        formset.save_m2m()

    def has_add_permission(self, request):
        return False


@admin.register(Enrolment)
class EnrolmentAdmin(ExportActionMixin, admin.ModelAdmin):
    """The monthly provider conversation, recorded.

    Note the enquiry field is optional and usually empty: Section 12 accepts
    that most enrolments never pass through the platform. An enrolment with no
    enquiry is the normal case, not a data error.
    """

    list_display = (
        "trainee_summary",
        "provider",
        "programme",
        "started_on",
        "fee_summary",
        "progress_summary",
        "attestation_summary",
        "source_summary",
    )
    list_filter = (
        "provider_attestation",
        "started_on",
        "completed_on",
        "provider__area__region",
    )
    search_fields = (
        "trainee_phone",
        "trainee_name",
        "provider__name",
        "programme__title",
    )
    search_help_text = "Search by trainee phone or name, provider, or programme."
    autocomplete_fields = ("provider", "programme", "intake", "enquiry")
    date_hierarchy = "started_on"
    list_select_related = (
        "provider",
        "provider__area",
        "provider__area__region",
        "programme",
        "programme__trade",
        "intake",
        "enquiry",
        "recorded_by",
    )
    readonly_fields = ("trainee_account", "recorded_by", "created_at", "updated_at")
    change_list_template = "admin/enquiries/enrolment/change_list.html"
    change_form_template = "admin/enquiries/enrolment/change_form.html"

    fieldsets = (
        ("Who and what", {"fields": ("provider", "programme", "intake", "enquiry")}),
        (
            "Trainee",
            {
                "fields": (
                    "trainee_phone",
                    "trainee_name",
                    "trainee_account",
                    "started_on",
                    "fee_paid",
                ),
                "description": (
                    "The trainee account is linked automatically when the phone number matches one."
                ),
            },
        ),
        (
            "Asked during the monthly visit",
            {
                "fields": ("completed_on", "provider_attestation", "attested_on"),
                "description": (
                    "Two questions: did this person finish the programme and when, and "
                    "would you recommend them for paid work. Nothing in version 1 reads "
                    "these. They are the entire foundation of employer matching in year "
                    "two, and they cannot be collected retrospectively."
                ),
            },
        ),
        ("Record", {"fields": ("recorded_by", "created_at", "updated_at")}),
    )

    def changelist_view(self, request, extra_context=None):
        _, _, reset_url = _admin_urls(request, "queue")
        context = {"enrolment_reset_url": reset_url}
        context.update(extra_context or {})
        response = super().changelist_view(request, extra_context=context)

        if hasattr(response, "context_data") and response.context_data.get("cl"):
            cl = response.context_data["cl"]
            summary = cl.queryset.order_by().aggregate(
                completed=Count("pk", filter=Q(completed_on__isnull=False)),
                attested=Count(
                    "pk",
                    filter=~Q(provider_attestation=Enrolment.Attestation.NOT_ASKED),
                ),
                platform=Count("pk", filter=Q(enquiry__isnull=False)),
                fee_total=Coalesce(
                    Sum("fee_paid"),
                    Value(Decimal("0.00")),
                    output_field=DecimalField(max_digits=14, decimal_places=2),
                ),
            )
            summary.update(matching=cl.result_count, total=cl.full_result_count)
            response.context_data["enrolment_summary"] = summary
            # Temporary US-spelling compatibility for templates deployed
            # during the admin redesign; both names reference the same data.
            response.context_data["enrollment_summary"] = summary
        return response

    @admin.display(description="Trainee", ordering="trainee_name")
    def trainee_summary(self, obj):
        if obj.trainee_name:
            return format_html(
                '<span class="er-trainee"><strong>{}</strong><small>{}</small></span>',
                obj.trainee_name,
                obj.trainee_phone,
            )
        return format_html('<span class="er-trainee"><strong>{}</strong></span>', obj.trainee_phone)

    @admin.display(description="Fee paid", ordering="fee_paid")
    def fee_summary(self, obj):
        if obj.fee_paid is None:
            return format_html('<span class="er-fee er-fee--neutral">{}</span>', "Not recorded")
        return format_html(
            '<span class="er-fee er-fee--positive">GH₵ {}</span>',
            f"{obj.fee_paid:,.2f}",
        )

    @admin.display(description="Progress", ordering="completed_on")
    def progress_summary(self, obj):
        if obj.completed_on:
            return format_html(
                '<span class="er-status er-status--positive"><strong>Completed</strong>'
                "<small>{}</small></span>",
                obj.completed_on.strftime("%d %b %Y"),
            )
        return format_html('<span class="er-status er-status--warning">{}</span>', "In training")

    @admin.display(description="Attestation", ordering="provider_attestation")
    def attestation_summary(self, obj):
        tones = {
            Enrolment.Attestation.NOT_ASKED: "warning",
            Enrolment.Attestation.RECOMMENDED: "positive",
            Enrolment.Attestation.NOT_RECOMMENDED: "attention",
        }
        return format_html(
            '<span class="er-attestation er-attestation--{}">{}</span>',
            tones[obj.provider_attestation],
            obj.get_provider_attestation_display(),
        )

    @admin.display(description="Source", ordering="enquiry")
    def source_summary(self, obj):
        if obj.enquiry_id:
            return format_html(
                '<span class="er-source er-source--positive">{}</span>',
                "Platform enquiry",
            )
        return format_html(
            '<span class="er-source er-source--neutral">{}</span>', "Provider reported"
        )

    @admin.display(description="Trainee account")
    def trainee_account(self, obj):
        return trainee_account_link(obj)

    def save_model(self, request, obj, form, change):
        if not obj.recorded_by_id:
            obj.recorded_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(PhoneVerification)
class PhoneVerificationAdmin(admin.ModelAdmin):
    """The code log, for answering "I never got my code".

    Read-only, and the code hash is never shown. Held by the operations lead and
    superusers only: it is a list of phone numbers and when they were active.
    """

    list_display = ("phone", "purpose", "created_at", "expires_at", "attempts", "verified_at")
    list_filter = ("purpose", "created_at")
    search_fields = ("phone",)
    date_hierarchy = "created_at"
    fields = (
        "phone",
        "purpose",
        "created_at",
        "expires_at",
        "attempts",
        "verified_at",
        "ip_address",
    )
    readonly_fields = fields

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(MonthlyCheckIn)
class MonthlyCheckInAdmin(admin.ModelAdmin):
    """The record of each month's conversation with each paying workshop.

    The list is the history. The work is on the "Check-ins due" page, which
    the sidebar links to: who still needs asking this month, a WhatsApp link
    to ask them, and one tap to record what they said. See check_ins.py.
    """

    list_display = ("provider", "month", "outcome", "checked_by", "updated_at")
    list_filter = ("outcome", "month")
    search_fields = ("provider__name",)
    date_hierarchy = "month"
    list_select_related = ("provider", "checked_by")
    autocomplete_fields = ("provider",)
    readonly_fields = ("checked_by", "created_at", "updated_at")
    fields = ("provider", "month", "outcome", "note", "checked_by", "created_at", "updated_at")

    def get_urls(self):
        return [
            path(
                "due/",
                self.admin_site.admin_view(self.due_view),
                name="enquiries_monthlycheckin_due",
            ),
            path(
                "due/<int:provider_id>/<str:outcome>/",
                self.admin_site.admin_view(require_POST(self.record_view)),
                name="enquiries_monthlycheckin_record",
            ),
            *super().get_urls(),
        ]

    def save_model(self, request, obj, form, change):
        obj.checked_by = request.user
        super().save_model(request, obj, form, change)

    def due_view(self, request):
        if not request.user.has_perm("enquiries.view_monthlycheckin"):
            raise PermissionDenied
        from providers.owner_messages import greeting, owner_phone

        from .whatsapp import chat_url

        today = timezone.localdate()
        month = check_ins.month_start(today)
        missed = set(check_ins.missed_last_month(today).values_list("pk", flat=True))
        latest = {}
        for row in MonthlyCheckIn.objects.filter(month__lt=month).order_by("month"):
            latest[row.provider_id] = row
        this_month = {
            row.provider_id: row
            for row in MonthlyCheckIn.objects.filter(month=month).select_related("checked_by")
        }

        due = []
        for provider in check_ins.due(today).select_related("area").order_by("name"):
            ask = (
                f"{greeting(provider)}this is {settings.BRAND_NAME} Skills Hub with our monthly "
                f"check-in for {provider.name}. Did anyone start a course with you in "
                f"{month:%B}? Did anyone finish one, and would you recommend them for paid work?"
            )
            due.append(
                {
                    "provider": provider,
                    "phone": owner_phone(provider),
                    "ask_url": chat_url(owner_phone(provider), ask),
                    "last": latest.get(provider.pk),
                    "not_reached": this_month.get(provider.pk),
                    "missed_last_month": provider.pk in missed,
                    "recorded": check_ins.enrolments_recorded(provider, month),
                    "add_enrolment": (
                        f"{reverse('admin:enquiries_enrolment_add')}?provider={provider.pk}"
                    ),
                }
            )
        done = [
            row for row in this_month.values() if row.outcome != MonthlyCheckIn.Outcome.NOT_REACHED
        ]
        return TemplateResponse(
            request,
            "admin/enquiries/monthlycheckin/due.html",
            {
                **self.admin_site.each_context(request),
                "title": f"Monthly check-ins, {month:%B %Y}",
                "opts": self.model._meta,
                "month": month,
                "due": due,
                "done": sorted(done, key=lambda row: row.provider.name),
                "paying": check_ins.paying_providers(today).count(),
                "outcomes": MonthlyCheckIn.Outcome,
                "can_record": request.user.has_perm("enquiries.add_monthlycheckin"),
            },
        )

    def record_view(self, request, provider_id, outcome):
        if not request.user.has_perm("enquiries.add_monthlycheckin"):
            raise PermissionDenied
        if outcome not in MonthlyCheckIn.Outcome.values:
            raise Http404
        provider = get_object_or_404(check_ins.paying_providers(), pk=provider_id)
        try:
            check_in = check_ins.record(provider, outcome, actor=request.user)
        except check_ins.CheckInRefused as refusal:
            self.message_user(request, str(refusal), level=messages.WARNING)
        else:
            self.message_user(request, f"{provider.name}: {check_in.get_outcome_display()}.")
        return HttpResponseRedirect(reverse("admin:enquiries_monthlycheckin_due"))
