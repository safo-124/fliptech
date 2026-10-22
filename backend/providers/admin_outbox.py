"""The back office's "Messages to send" page: WhatsApp messages to owners.

The system decides who needs a message; an officer sends it from their own
phone with a wa.me link. Two kinds share the page because they are the same
job for the person holding the phone:

* "Your listing is live", queued when a listing is published (Section 09's
  last onboarding step). See providers/owner_messages.py.
* The 90-day check of fees and intake dates, queued nightly by
  queue_freshness_prompts. See providers/freshness.py.

Each Send records the message as sent and then opens WhatsApp. It is recorded
first because nothing comes back from wa.me to say the officer pressed send;
recording nothing would leave every message looking unsent.

Mixed into ProviderAdmin, which routes to these views, so they sit behind the
admin's own staff-only wrapper.
"""

from django.conf import settings
from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.views.decorators.http import require_POST

from . import freshness, owner_messages
from .models import ListingConfirmation, OwnerNotice, Provider


def waiting_count():
    """Everything an officer could send right now. Drives the sidebar badge."""
    return owner_messages.live_notices_waiting().count() + freshness.waiting_to_send().count()


class OwnerMessagesAdminMixin:
    def outbox_urls(self):
        return [
            path(
                "messages/",
                self.admin_site.admin_view(self.messages_view),
                name="providers_provider_messages",
            ),
            path(
                "messages/live/<int:notice_id>/send/",
                self.admin_site.admin_view(require_POST(self.send_live_notice_view)),
                name="providers_provider_send_live_notice",
            ),
            path(
                "messages/check/<int:confirmation_id>/send/",
                self.admin_site.admin_view(require_POST(self.send_prompt_view)),
                name="providers_provider_send_prompt",
            ),
        ]

    def messages_view(self, request):
        if not request.user.has_perm("providers.view_provider"):
            raise PermissionDenied

        live = list(owner_messages.live_notices_waiting())
        for row in live:
            row.when = row.provider.published_at
        checks = list(freshness.waiting_to_send())
        for row in checks:
            row.when = row.provider.last_confirmed_at
        for row in (*live, *checks):
            row.send_to = owner_messages.owner_phone(row.provider)

        awaiting_reply = (
            ListingConfirmation.objects.filter(
                prompted_at__isnull=False,
                responded_at__isnull=True,
                provider__status=Provider.Status.PUBLISHED,
            )
            .select_related("provider", "prompted_by")
            .order_by("prompted_at")
        )
        return TemplateResponse(
            request,
            "admin/providers/provider/messages.html",
            {
                **self.admin_site.each_context(request),
                "title": "Messages to send",
                "opts": self.model._meta,
                "live": live,
                "checks": checks,
                "awaiting_reply": awaiting_reply,
                "reprompt_days": freshness.REPROMPT_AFTER_DAYS,
                "can_send_live": request.user.has_perm("providers.change_ownernotice"),
                "can_send_checks": request.user.has_perm("providers.change_listingconfirmation"),
                "has_site_links": bool(settings.PUBLIC_SITE_URL),
            },
        )

    def _back_to_outbox(self, request, text):
        self.message_user(request, text, level=messages.WARNING)
        return HttpResponseRedirect(reverse("admin:providers_provider_messages"))

    def send_live_notice_view(self, request, notice_id):
        if not request.user.has_perm("providers.change_ownernotice"):
            raise PermissionDenied
        notice = get_object_or_404(
            OwnerNotice.objects.select_related("provider", "provider__area"), pk=notice_id
        )
        if not owner_messages.live_notices_waiting().filter(pk=notice.pk).exists():
            return self._back_to_outbox(
                request,
                f"{notice.provider.name} is no longer waiting to be told. Someone else may "
                "have sent it, or the listing is no longer live.",
            )
        if not owner_messages.mark_live_sent(notice, actor=request.user):
            return self._back_to_outbox(
                request, f"The message to {notice.provider.name} was already sent."
            )
        return HttpResponseRedirect(owner_messages.live_url(notice.provider))

    def send_prompt_view(self, request, confirmation_id):
        if not request.user.has_perm("providers.change_listingconfirmation"):
            raise PermissionDenied
        confirmation = get_object_or_404(
            ListingConfirmation.objects.select_related("provider"), pk=confirmation_id
        )
        if not freshness.waiting_to_send().filter(pk=confirmation.pk).exists():
            return self._back_to_outbox(
                request,
                f"{confirmation.provider.name} is no longer waiting for a prompt. Someone "
                "else may have sent it, or the listing was confirmed another way.",
            )
        if not freshness.mark_sent(confirmation, actor=request.user):
            return self._back_to_outbox(
                request, f"The prompt to {confirmation.provider.name} was already sent."
            )
        return HttpResponseRedirect(freshness.prompt_url(confirmation.provider))
