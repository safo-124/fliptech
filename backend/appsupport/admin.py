from django.contrib import admin

from .models import CrashReport, Notice


@admin.register(Notice)
class NoticeAdmin(admin.ModelAdmin):
    """What people were told, and whether it also went by SMS."""

    list_display = ("phone", "body", "link", "texted", "read_at", "created_at")
    list_filter = ("texted",)
    search_fields = ("phone", "body")
    date_hierarchy = "created_at"
    readonly_fields = ("phone", "title", "body", "link", "texted", "read_at", "created_at")

    def has_add_permission(self, request):
        return False


@admin.register(CrashReport)
class CrashReportAdmin(admin.ModelAdmin):
    """Errors the app could not recover from, as the app reported them."""

    list_display = (
        "message",
        "screen",
        "fatal",
        "app_version",
        "update_id",
        "device",
        "created_at",
    )
    list_filter = ("fatal", "app_version")
    search_fields = ("message", "screen", "stack")
    date_hierarchy = "created_at"
    readonly_fields = [f.name for f in CrashReport._meta.fields]

    def has_add_permission(self, request):
        return False
