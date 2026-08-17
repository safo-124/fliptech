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

from django.contrib import admin
from import_export.admin import ExportActionMixin

from .models import Enquiry, EnquiryOutcome, Enrolment


class EnquiryOutcomeInline(admin.StackedInline):
    model = EnquiryOutcome
    extra = 0
    can_delete = False
    verbose_name_plural = "Outcome (reported by a human — the conversation is on WhatsApp)"


@admin.register(Enquiry)
class EnquiryAdmin(admin.ModelAdmin):
    list_display = (
        "reference_code",
        "provider",
        "programme",
        "trainee_phone",
        "state",
        "created_at",
    )
    list_filter = ("state", "created_at", "provider__area__region")
    search_fields = ("reference_code", "trainee_phone", "provider__name")
    autocomplete_fields = ("provider", "programme", "intake")
    date_hierarchy = "created_at"
    inlines = [EnquiryOutcomeInline]
    list_select_related = ("provider", "programme")

    # An enquiry is a record of something a trainee did. Staff annotate the
    # outcome; they do not rewrite what was sent.
    readonly_fields = ("reference_code", "trainee_phone", "message", "phone_verified_at")

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
        "trainee_phone",
        "provider",
        "programme",
        "started_on",
        "fee_paid",
        "completed_on",
        "provider_attestation",
        "came_through_platform",
    )
    list_filter = (
        "provider_attestation",
        "started_on",
        "completed_on",
        "provider__area__region",
    )
    search_fields = ("trainee_phone", "trainee_name", "provider__name")
    autocomplete_fields = ("provider", "programme", "intake", "enquiry", "recorded_by")
    date_hierarchy = "started_on"
    list_select_related = ("provider", "programme")

    fieldsets = (
        ("Who and what", {"fields": ("provider", "programme", "intake", "enquiry")}),
        ("Trainee", {"fields": ("trainee_phone", "trainee_name", "started_on", "fee_paid")}),
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
    )

    @admin.display(description="Via platform", boolean=True)
    def came_through_platform(self, obj):
        return obj.enquiry_id is not None

    def save_model(self, request, obj, form, change):
        if not obj.recorded_by_id:
            obj.recorded_by = request.user
        super().save_model(request, obj, form, change)
