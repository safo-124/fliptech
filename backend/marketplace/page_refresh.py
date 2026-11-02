"""Telling the frontend to refresh marketplace pages the moment they change.

Product, shop and list pages are cached for five minutes (frontend
lib/api.ts). That was fine until sellers started changing things buyers act
on straight away: back in stock, away mode, a new price. Now any change to
what those pages show asks the frontend's /revalidate to expire the
"marketplace" cache tag, and the next visitor sees the change.

One request per database transaction at most, sent after it commits, from a
short-lived thread so a seller's save never waits on it, and never allowed
to fail anything: a missed refresh means the five-minute timer, as before.
Off unless FRONTEND_REVALIDATE_URL and FRONTEND_REVALIDATE_SECRET are set.
"""

import logging
import threading
import urllib.request

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_delete, post_save

logger = logging.getLogger(__name__)

# A seller signing in touches these and nothing a buyer sees.
QUIET_SELLER_FIELDS = {"phone_verified_at", "updated_at", "payout_bank_code", "paystack_recipient"}


def enabled():
    return bool(settings.FRONTEND_REVALIDATE_URL and settings.FRONTEND_REVALIDATE_SECRET)


def _send():
    request = urllib.request.Request(
        settings.FRONTEND_REVALIDATE_URL,
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Revalidate-Secret": settings.FRONTEND_REVALIDATE_SECRET,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=3):
            pass
    except Exception as exc:  # The five-minute timer still applies.
        logger.warning("Could not ask the frontend to refresh marketplace pages: %s", exc)


def _after_commit():
    threading.Thread(target=_send, daemon=True).start()


def refresh_soon():
    """Ask for a refresh once the current transaction commits, once.

    Deduplicated against Django's own list of what will run on commit, not
    a flag of ours: a flag set in a transaction that is then rolled back
    would never be cleared, and that worker would stop asking for good.
    """
    if not enabled():
        return
    connection = transaction.get_connection()
    if connection.in_atomic_block and any(
        item[1] is _after_commit for item in connection.run_on_commit
    ):
        return
    transaction.on_commit(_after_commit)


def _changed(sender, instance, **kwargs):
    update_fields = kwargs.get("update_fields")
    if (
        sender.__name__ == "SellerAccount"
        and update_fields
        and set(update_fields) <= QUIET_SELLER_FIELDS
    ):
        return
    if sender.__name__ == "SellerPayment" and instance.status != "paid":
        return
    refresh_soon()


def connect():
    from .models import (
        Product,
        ProductOption,
        ProductPhoto,
        SellerAccount,
        SellerPayment,
        SellerReview,
    )

    for model in (Product, ProductOption, ProductPhoto, SellerAccount, SellerPayment, SellerReview):
        post_save.connect(_changed, sender=model, dispatch_uid=f"refresh-{model.__name__}")
        post_delete.connect(_changed, sender=model, dispatch_uid=f"refresh-del-{model.__name__}")
