"""The back office's "Messages to sellers" page.

Mirrors providers/admin_outbox.py, and its own page rather than rows on that
one because that page is built around a Provider and half the sellers have no
workshop.

The system decides who needs a message; an officer sends it from their own
phone with a wa.me link. Mixed into SellerAccountAdmin, so these views sit
behind the admin's own staff-only wrapper.
"""

from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.views.decorators.http import require_POST

from . import seller_messages
from .models import SellerNotice


class SellerMessagesMixin:
    """Mixed into SellerAccountAdmin, so these views sit behind the admin's
    own staff-only wrapper rather than needing their own."""

    def outbox_urls(self):
        return [
            path(
                "messages/",
                self.admin_site.admin_view(self.seller_messages_view),
                name="marketplace_selleraccount_messages",
            ),
            path(
                "messages/<int:notice_id>/send/",
                self.admin_site.admin_view(require_POST(self.send_seller_alert_view)),
                name="marketplace_selleraccount_send_alert",
            ),
        ]

    def seller_messages_view(self, request):
        if not request.user.has_perm("marketplace.view_selleraccount"):
            raise PermissionDenied
        waiting = list(seller_messages.alerts_waiting())
        for row in waiting:
            row.send_to = row.seller.phone
            row.send_url = seller_messages.alert_url(row)
            row.detail = " · ".join(
                filter(None, [row.enquiry.reference_code, row.enquiry.product_name])
            )
        return TemplateResponse(
            request,
            "admin/marketplace/selleraccount/messages.html",
            {
                **self.admin_site.each_context(request),
                "title": "Messages to sellers",
                "opts": self.model._meta,
                "waiting": waiting,
                "can_send": request.user.has_perm("marketplace.change_sellernotice"),
            },
        )

    def send_seller_alert_view(self, request, notice_id):
        if not request.user.has_perm("marketplace.change_sellernotice"):
            raise PermissionDenied
        notice = get_object_or_404(
            SellerNotice.objects.select_related("seller", "enquiry"), pk=notice_id
        )
        if not seller_messages.alerts_waiting().filter(pk=notice.pk).exists():
            self.message_user(
                request,
                f"{notice.seller} is no longer waiting to hear about this. Someone else "
                "may have sent it, the enquiry was marked as spam, or the seller is no "
                "longer selling.",
                level=messages.WARNING,
            )
            return HttpResponseRedirect(reverse("admin:marketplace_selleraccount_messages"))

        # Recorded before WhatsApp opens. Nothing comes back from wa.me to
        # say the officer pressed send, so recording afterwards would leave
        # every message looking unsent for ever.
        seller_messages.mark_sent(notice, by=request.user)
        return HttpResponseRedirect(seller_messages.alert_url(notice))
