"""Trainees and support sessions in the back office.

Trainee phone numbers are personal data of people who are often young, so the
model is not in the field officer group at all; the operations lead and
superusers see it. Three things are deliberately not ordinary admin actions:

* accounts are never added by hand, only by a phone proving itself;
* "Open dashboard" needs a reason and starts a logged, expiring session;
* erasure is a separate screen with its own permission and a typed
  confirmation, never the stock delete button.
"""

from urllib.parse import urljoin, urlsplit, urlunsplit

from django.conf import settings
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import Count
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from django.views.decorators.http import require_POST
from simple_history.admin import SimpleHistoryAdmin

from enquiries.models import Enquiry, Enrolment

from .erasure import erase_personal_data
from .models import SavedProvider, SupportSession, SupportSessionEvent, TraineeAccount
from .support import (
    active_support_session,
    end_support_session,
    staff_can_support,
    start_support_session,
)

LOOPBACK_HOSTS = {"localhost", "127.0.0.1"}


def trainee_dashboard_url(request=None):
    """Where staff land in support mode.

    In development, keep the loopback name staff used for the back office
    (localhost or 127.0.0.1). Browsers treat the two as different sites and
    would not send the staff session cookie across them.
    """
    base = settings.PUBLIC_SITE_URL
    if not base:
        return "/trainee"
    parts = urlsplit(base)
    if request is not None and parts.hostname in LOOPBACK_HOSTS:
        request_host = request.get_host().rsplit(":", 1)[0]
        if request_host in LOOPBACK_HOSTS and request_host != parts.hostname:
            netloc = request_host + (f":{parts.port}" if parts.port else "")
            base = urlunsplit(parts._replace(netloc=netloc))
    return urljoin(base.rstrip("/") + "/", "trainee")


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class EnquiryInline(ReadOnlyInline):
    model = Enquiry
    fk_name = "trainee"
    fields = ("reference", "provider", "programme", "state", "created_at")
    readonly_fields = fields
    verbose_name_plural = "Enquiries"

    @admin.display(description="Reference")
    def reference(self, obj):
        return format_html(
            '<a href="{}">{}</a>',
            reverse("admin:enquiries_enquiry_change", args=[obj.pk]),
            obj.reference_code,
        )


class EnrolmentInline(ReadOnlyInline):
    model = Enrolment
    fk_name = "trainee"
    fields = ("record", "provider", "programme", "started_on", "completed_on")
    readonly_fields = fields
    verbose_name_plural = "Enrolments"

    @admin.display(description="Record")
    def record(self, obj):
        return format_html(
            '<a href="{}">Open</a>',
            reverse("admin:enquiries_enrolment_change", args=[obj.pk]),
        )


class SavedProviderInline(ReadOnlyInline):
    model = SavedProvider
    fields = ("provider", "created_at")
    readonly_fields = fields
    verbose_name_plural = "Saved providers"


class SupportSessionInline(ReadOnlyInline):
    model = SupportSession
    fields = ("session", "staff_user", "reason", "started_at", "ended_at", "end_reason")
    readonly_fields = fields
    verbose_name_plural = "Support sessions on this account"

    @admin.display(description="Log")
    def session(self, obj):
        return format_html(
            '<a href="{}">View log</a>',
            reverse("admin:trainees_supportsession_change", args=[obj.pk]),
        )


@admin.register(TraineeAccount)
class TraineeAccountAdmin(SimpleHistoryAdmin):
    list_display = (
        "trainee_summary",
        "preferred_channel",
        "enquiry_count",
        "enrolment_count",
        "is_active",
        "last_seen_at",
        "created_at",
    )
    list_filter = ("is_active", "preferred_channel", "created_at")
    search_fields = ("phone", "display_name")
    search_help_text = "Search by phone number or name."
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    actions = ("switch_off", "switch_on")
    readonly_fields = ("phone", "phone_verified_at", "last_seen_at", "created_at", "updated_at")
    fieldsets = (
        ("Trainee", {"fields": ("phone", "display_name", "preferred_channel")}),
        (
            "Access",
            {
                "fields": ("is_active", "phone_verified_at", "last_seen_at"),
                "description": (
                    "Switching an account off stops the number signing in. Enquiries "
                    "and enrolments are kept."
                ),
            },
        ),
        ("Record", {"fields": ("created_at", "updated_at")}),
    )
    inlines = [EnquiryInline, EnrolmentInline, SavedProviderInline, SupportSessionInline]
    change_form_template = "admin/trainees/traineeaccount/change_form.html"

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                n_enquiries=Count("enquiries", distinct=True),
                n_enrolments=Count("enrolments", distinct=True),
            )
        )

    @admin.display(description="Trainee", ordering="display_name")
    def trainee_summary(self, obj):
        if obj.display_name:
            return format_html(
                "<strong>{}</strong><br><small>{}</small>", obj.display_name, obj.phone
            )
        return format_html("<strong>{}</strong>", obj.phone)

    @admin.display(description="Enquiries", ordering="n_enquiries")
    def enquiry_count(self, obj):
        return obj.n_enquiries

    @admin.display(description="Enrolments", ordering="n_enrolments")
    def enrolment_count(self, obj):
        return obj.n_enrolments

    def has_add_permission(self, request):
        # An account is created by a phone number proving itself, never by hand.
        return False

    def has_delete_permission(self, request, obj=None):
        # Removal goes through the erase screen, which is logged and confirmed.
        return False

    def _set_active(self, request, queryset, *, active, verb):
        changed = list(queryset.exclude(is_active=active))
        for account in changed:
            account.is_active = active
            account.save(update_fields=["is_active", "updated_at"])
            self.log_change(request, account, f"Trainee access {verb}.")
        self.message_user(request, f"{len(changed)} trainee account(s) {verb}.")

    @admin.action(description="Switch off sign-in", permissions=["change"])
    def switch_off(self, request, queryset):
        self._set_active(request, queryset, active=False, verb="switched off")

    @admin.action(description="Switch sign-in back on", permissions=["change"])
    def switch_on(self, request, queryset):
        self._set_active(request, queryset, active=True, verb="switched on")

    # -- support and erasure screens -----------------------------------------

    def get_urls(self):
        wrap = self.admin_site.admin_view
        return [
            path(
                "<int:pk>/support/",
                wrap(self.support_start_view),
                name="trainees_traineeaccount_support",
            ),
            path(
                "support/end/",
                wrap(require_POST(self.support_end_view)),
                name="trainees_support_end",
            ),
            path(
                "<int:pk>/erase/",
                wrap(self.erase_view),
                name="trainees_traineeaccount_erase",
            ),
            *super().get_urls(),
        ]

    def change_view(self, request, object_id, form_url="", extra_context=None):
        live = active_support_session(request)
        context = {
            "can_support": staff_can_support(request.user),
            "can_erase": request.user.has_perm("trainees.erase_trainee"),
            "live_support": live if live and str(live.trainee_id) == str(object_id) else None,
            "trainee_dashboard_url": trainee_dashboard_url(request),
            "support_minutes": settings.SUPPORT_SESSION_SECONDS // 60,
        }
        context.update(extra_context or {})
        return super().change_view(request, object_id, form_url, extra_context=context)

    def support_start_view(self, request, pk):
        trainee = get_object_or_404(TraineeAccount.objects.select_related("user"), pk=pk)
        if not staff_can_support(request.user):
            raise PermissionDenied
        error = None
        if request.method == "POST":
            try:
                session = start_support_session(request, trainee, request.POST.get("reason", ""))
            except ValidationError as exc:
                error = " ".join(exc.messages)
            else:
                self.log_change(request, trainee, f"Opened dashboard for support: {session.reason}")
                return HttpResponseRedirect(trainee_dashboard_url(request))

        context = {
            **self.admin_site.each_context(request),
            "opts": self.opts,
            "original": trainee,
            "title": "Open trainee dashboard",
            "error": error,
            "reason": request.POST.get("reason", ""),
            "can_edit": request.user.has_perm("trainees.support_edit"),
            "support_minutes": settings.SUPPORT_SESSION_SECONDS // 60,
        }
        return TemplateResponse(
            request, "admin/trainees/traineeaccount/support_start.html", context
        )

    def support_end_view(self, request):
        session = end_support_session(request)
        if session is None:
            self.message_user(request, "No support session was open.", level=messages.INFO)
            return HttpResponseRedirect(reverse("admin:trainees_traineeaccount_changelist"))
        self.message_user(request, "Support session ended.")
        return HttpResponseRedirect(
            reverse("admin:trainees_traineeaccount_change", args=[session.trainee_id])
        )

    def erase_view(self, request, pk):
        if not request.user.has_perm("trainees.erase_trainee"):
            raise PermissionDenied
        trainee = get_object_or_404(TraineeAccount, pk=pk)
        error = None
        if request.method == "POST":
            if request.POST.get("confirm_phone", "").replace(" ", "") != str(trainee.phone):
                error = "Type the phone number exactly as shown to confirm."
            else:
                result = erase_personal_data(trainee, actor=request.user)
                self.message_user(
                    request,
                    f"Erased: {result['enquiries']} enquiries and "
                    f"{result['enrolments']} enrolments redacted, "
                    f"{result['codes']} code records deleted.",
                )
                return HttpResponseRedirect(reverse("admin:trainees_traineeaccount_changelist"))

        context = {
            **self.admin_site.each_context(request),
            "opts": self.opts,
            "original": trainee,
            "title": "Erase trainee data",
            "error": error,
            "enquiry_count": Enquiry.objects.filter(trainee_phone=trainee.phone).count(),
            "enrolment_count": Enrolment.objects.filter(trainee_phone=trainee.phone).count(),
        }
        return TemplateResponse(request, "admin/trainees/traineeaccount/erase.html", context)


class SupportSessionEventInline(ReadOnlyInline):
    model = SupportSessionEvent
    fields = ("created_at", "action", "detail")
    readonly_fields = fields
    verbose_name_plural = "What happened"


@admin.register(SupportSession)
class SupportSessionAdmin(admin.ModelAdmin):
    """The accountability log. Nothing here can be changed or deleted."""

    list_display = (
        "trainee",
        "staff_user",
        "reason",
        "access",
        "started_at",
        "ended_at",
        "end_reason",
        "event_count",
    )
    list_filter = ("end_reason", "can_edit", "started_at")
    search_fields = ("trainee__phone", "staff_user__username", "reason")
    date_hierarchy = "started_at"
    list_select_related = ("trainee", "staff_user")
    fields = (
        "trainee",
        "staff_user",
        "reason",
        "can_edit",
        "started_at",
        "expires_at",
        "ended_at",
        "end_reason",
    )
    readonly_fields = fields
    inlines = [SupportSessionEventInline]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(n_events=Count("events"))

    @admin.display(description="Access", boolean=False, ordering="can_edit")
    def access(self, obj):
        return "View and edit" if obj.can_edit else "View only"

    @admin.display(description="Requests", ordering="n_events")
    def event_count(self, obj):
        return obj.n_events

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
