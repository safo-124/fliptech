"""Bulk and custom quote requests: one form, several makers.

A buyer describes the job and picks a trade. Makers who sell in that trade
are texted, and see the request in their dashboard without the buyer's
name or number. A maker who wants the job unlocks the contact, free on the
Shop plan and for a small lead fee otherwise, up to MARKETPLACE_LEAD_LIMIT
makers per request. The buyer is texted each time one does, so they know
who is about to call.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.sms import send_sms

from .models import Product, QuoteLead, QuoteRequest, SellerAccount

logger = logging.getLogger(__name__)

OPEN_DAYS = 30
NOTIFY_AT_MOST = 15


def makers_for(trade):
    """Sellers with something on show in this trade."""
    return SellerAccount.objects.filter(
        pk__in=Product.objects.visible().filter(trade=trade).values("seller_id")
    )


def open_for(seller):
    """Open requests in the trades this seller sells in, newest first."""
    trades = Product.objects.visible().filter(seller=seller, trade__isnull=False).values("trade_id")
    return (
        QuoteRequest.objects.filter(
            state=QuoteRequest.State.OPEN,
            trade_id__in=trades,
            created_at__gte=timezone.now() - timedelta(days=OPEN_DAYS),
        )
        .select_related("trade", "area")
        .order_by("-created_at")
    )


def tell_makers(quote):
    """Text the makers in its trade. Called after the request is saved."""
    makers = makers_for(quote.trade).order_by("-updated_at")[:NOTIFY_AT_MOST]
    for seller in makers:
        try:
            send_sms(
                seller.phone,
                f"{settings.BRAND_NAME}: someone wants a quote for {quote.title[:60]} "
                f"({quote.trade.name}). See it under Quote requests in your seller "
                f"dashboard: {settings.PUBLIC_SITE_URL.rstrip('/')}/sell/shop",
            )
        except Exception:
            logger.exception("Could not text %s about quote %s", seller.pk, quote.reference)


def spots_left(quote):
    return max(settings.MARKETPLACE_LEAD_LIMIT - quote.leads.count(), 0)


def unlock(quote, seller, payment=None):
    """Give this maker the buyer's contact. Idempotent. Returns the lead."""
    try:
        with transaction.atomic():
            lead, created = QuoteLead.objects.get_or_create(
                quote=quote, seller=seller, defaults={"payment": payment}
            )
    except IntegrityError:
        return QuoteLead.objects.get(quote=quote, seller=seller)
    if created:
        transaction.on_commit(lambda: _tell_buyer(quote, seller))
    return lead


def _tell_buyer(quote, seller):
    try:
        send_sms(
            quote.buyer_phone,
            f"{settings.BRAND_NAME}: {seller.business_name} saw your request "
            f"{quote.reference} ({quote.title[:50]}) and will contact you.",
        )
    except Exception:
        logger.exception("Could not text the buyer of %s", quote.reference)
