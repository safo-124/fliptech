from django.contrib import admin

from .models import (
    Certificate,
    CourseBoost,
    CourseOffer,
    CoursePromoCode,
    CoursePurchase,
    CourseReview,
    LessonCaption,
    LessonQuestion,
)


@admin.register(CourseOffer)
class CourseOfferAdmin(admin.ModelAdmin):
    """Each workshop's course price and where its sales are paid.

    Read-only: the trainer sets these from their dashboard, and the payout
    account is created at Paystack, which is the only place it can change.
    """

    list_display = (
        "provider",
        "price",
        "sale_price",
        "level",
        "featured_until",
        "payout_bank_name",
        "payout_account_last4",
        "updated_at",
    )
    search_fields = ("provider__name",)
    # Staff may feature a course for free (a partner, a launch) and edit the
    # course page's words when they break the rules. Money stays read-only.
    readonly_fields = [
        field.name
        for field in CourseOffer._meta.fields
        if field.name not in ("featured_until", "summary", "outcomes", "tools", "level")
    ]

    def has_add_permission(self, request):
        return False


@admin.register(CoursePurchase)
class CoursePurchaseAdmin(admin.ModelAdmin):
    """Every attempt to buy a course, and what Paystack said about it.

    Read-only, so a course is never marked paid by hand: only Paystack's
    confirmation does that. Refunds happen in the Paystack dashboard.
    """

    list_display = ("reference", "provider", "trainee", "amount", "status", "channel", "paid_at")
    list_filter = ("status", "channel")
    search_fields = ("reference", "provider__name", "trainee__phone")
    readonly_fields = [field.name for field in CoursePurchase._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(CourseReview)
class CourseReviewAdmin(admin.ModelAdmin):
    """Learners' reviews. Hide one that breaks the rules; it stays on record."""

    list_display = ("provider", "trainee", "rating", "is_hidden", "created_at")
    list_filter = ("is_hidden", "rating")
    list_editable = ("is_hidden",)
    search_fields = ("provider__name", "trainee__phone", "body")
    readonly_fields = ("provider", "trainee", "rating", "body", "reply", "replied_at")


@admin.register(LessonQuestion)
class LessonQuestionAdmin(admin.ModelAdmin):
    list_display = ("video", "provider", "trainee", "answered_at", "is_hidden", "created_at")
    list_filter = ("is_hidden",)
    list_editable = ("is_hidden",)
    search_fields = ("provider__name", "trainee__phone", "body", "answer")
    readonly_fields = (
        "video",
        "provider",
        "trainee",
        "body",
        "at_seconds",
        "answer",
        "answered_at",
        "answered_by",
    )


@admin.register(Certificate)
class CertificateAdmin(admin.ModelAdmin):
    """Issued automatically. Revoke one given for a course found to be
    copied or otherwise wrong: the check page then says so."""

    list_display = ("code", "trainee_name", "course_name", "is_revoked", "created_at")
    list_filter = ("is_revoked",)
    search_fields = ("code", "trainee_name", "course_name", "trainee__phone")
    readonly_fields = [
        field.name for field in Certificate._meta.fields if field.name != "is_revoked"
    ]

    def has_add_permission(self, request):
        return False


@admin.register(CoursePromoCode)
class CoursePromoCodeAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "provider",
        "percent_off",
        "uses",
        "max_uses",
        "expires_at",
        "is_active",
    )
    list_filter = ("is_active",)
    search_fields = ("code", "provider__name")


@admin.register(CourseBoost)
class CourseBoostAdmin(admin.ModelAdmin):
    """Workshops paying to be featured. Read-only: Paystack decides."""

    list_display = ("reference", "provider", "days", "amount_pesewas", "status", "ends_at")
    list_filter = ("status",)
    search_fields = ("reference", "provider__name")
    readonly_fields = [field.name for field in CourseBoost._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(LessonCaption)
class LessonCaptionAdmin(admin.ModelAdmin):
    """Captions trainers add. Not reviewed before they show: delete any that
    break the rules."""

    list_display = ("video", "language", "updated_at")
    search_fields = ("video__title", "video__provider__name", "vtt")
