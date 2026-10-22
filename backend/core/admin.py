from urllib.parse import quote

from django.conf import settings
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from enquiries.whatsapp import chat_url

from . import relay
from .models import RelayedText

admin.site.site_header = f"{settings.BRAND_NAME} Skills Hub back office"
admin.site.site_title = "Skills Hub"
admin.site.index_title = "Onboarding, verification and moderation"


@admin.register(RelayedText)
class RelayedTextAdmin(admin.ModelAdmin):
    """Codes to send: sign-in codes staff pass on by hand. See core/relay.py.

    One page rather than the stock list and form. A code is useful for ten
    minutes, so what matters is the code, the number, and a one-tap way to send
    it — not a table of rows to open.
    """

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_urls(self):
        return [
            path(
                "<int:text_id>/sent/",
                self.admin_site.admin_view(require_POST(self.mark_sent_view)),
                name="core_relayedtext_sent",
            ),
            *super().get_urls(),
        ]

    def changelist_view(self, request, extra_context=None):
        if not self.has_view_permission(request):
            raise PermissionDenied
        now = timezone.now()
        relay.wipe_expired(now)
        rows = []
        for text in relay.current(now):
            seconds_left = max(int((text.created_at + relay.lifetime() - now).total_seconds()), 0)
            rows.append(
                {
                    "text": text,
                    "code": relay.code_in(text.body),
                    "minutes_left": -(-seconds_left // 60),
                    "whatsapp": chat_url(text.to, text.body),
                    "sms": f"sms:{text.to}?body={quote(text.body)}",
                }
            )
        return TemplateResponse(
            request,
            "admin/core/relayedtext/codes.html",
            {
                **self.admin_site.each_context(request),
                "title": "Codes to send",
                "opts": self.model._meta,
                "waiting": [row for row in rows if row["text"].relayed_at is None],
                "sent": [row for row in rows if row["text"].relayed_at is not None],
                "relaying": settings.SMS_PROVIDER == "backoffice",
                "provider": settings.SMS_PROVIDER,
                "lifetime_minutes": settings.OTP_TTL_SECONDS // 60,
                "can_mark": self.has_change_permission(request),
            },
        )

    def change_view(self, request, object_id, form_url="", extra_context=None):
        # There is nothing to edit on a text; the list page is the whole tool.
        return HttpResponseRedirect(reverse("admin:core_relayedtext_changelist"))

    def mark_sent_view(self, request, text_id):
        if not self.has_change_permission(request):
            raise PermissionDenied
        text = get_object_or_404(RelayedText, pk=text_id)
        if relay.mark_sent(text, actor=request.user):
            self.message_user(request, f"Marked the code for {text.to} as sent.")
        else:
            self.message_user(
                request, f"The code for {text.to} was already marked as sent.", messages.WARNING
            )
        return HttpResponseRedirect(reverse("admin:core_relayedtext_changelist"))
