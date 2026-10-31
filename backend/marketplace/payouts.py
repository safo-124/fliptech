"""Buyer protection: paying a seller only once the buyer has the goods.

Used when MARKETPLACE_HOLD_PAYMENTS is on when an order is made (the order
remembers it as `payout`). The whole payment then lands in Fliiptech's
Paystack balance, and the seller's share (the total less Fliiptech's
commission) is transferred to them:

  - as soon as the buyer taps "I've got it", or
  - MARKETPLACE_RELEASE_DAYS after the seller marks it handed over, if the
    buyer has not reported a problem (marketplace_daily does this), or
  - when staff release it after looking at a problem.

A problem freezes the money until staff release it or refund the buyer.

Each transfer's reference is derived from the order's, so retrying one
(after a timeout, or a second click) can never pay twice: Paystack refuses a
repeated reference.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from courses import paystack

from .models import Order, PaymentStatus

logger = logging.getLogger(__name__)


def transfer_reference(order):
    return "fp-" + order.reference.split("-", 1)[-1]


def due_for_release(now=None):
    now = now or timezone.now()
    handed_over_before = now - timedelta(days=settings.MARKETPLACE_RELEASE_DAYS)
    return Order.objects.filter(
        Q(stage=Order.Stage.RECEIVED)
        | Q(stage=Order.Stage.DELIVERED, delivered_at__lte=handed_over_before),
        status=PaymentStatus.PAID,
        payout__in=[Order.Payout.HELD, Order.Payout.FAILED],
    )


def release(order):
    """Transfer the seller's share. Returns the order, updated.

    Refuses quietly (returns it unchanged) for anything not held, so it is
    safe to call from a button, the daily job and the buyer's confirmation.
    """
    with transaction.atomic():
        order = (
            Order.objects.select_for_update(of=("self",)).select_related("seller").get(pk=order.pk)
        )
        if order.status != PaymentStatus.PAID or order.payout not in (
            Order.Payout.HELD,
            Order.Payout.FAILED,
        ):
            return order
        if order.stage in (Order.Stage.PROBLEM, Order.Stage.REFUNDED):
            return order
        if not order.seller.paystack_recipient:
            order.payout = Order.Payout.FAILED
            order.transfer_note = "The seller has no payout account for transfers."
            order.save(update_fields=["payout", "transfer_note", "updated_at"])
            return order
        order.payout = Order.Payout.SENDING
        order.transfer_reference = transfer_reference(order)
        order.save(update_fields=["payout", "transfer_reference", "updated_at"])

    try:
        state = paystack.transfer(
            amount_pesewas=order.seller_share_pesewas,
            recipient=order.seller.paystack_recipient,
            reference=order.transfer_reference,
            reason=f"Order {order.reference}: {order.product_name}"[:100],
        )
    except paystack.PaystackError as exc:
        return _settle(order, Order.Payout.FAILED, str(exc))
    if state == "success":
        return _settle(order, Order.Payout.RELEASED, "")
    if state == "otp":
        return _settle(
            order,
            Order.Payout.FAILED,
            "Paystack wants an OTP for transfers. Turn off OTP for transfers in "
            "the Paystack dashboard, then release again.",
        )
    # "pending" or "received": Paystack's transfer webhook finishes it.
    return order


def _settle(order, payout, note):
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.payout in (Order.Payout.RELEASED, Order.Payout.REFUNDED):
            return order
        order.payout = payout
        order.transfer_note = note[:200]
        if payout == Order.Payout.RELEASED:
            order.released_at = timezone.now()
        order.save(update_fields=["payout", "transfer_note", "released_at", "updated_at"])
        return order


def transfer_event(event, data):
    """Paystack's transfer.success / transfer.failed / transfer.reversed."""
    reference = str((data or {}).get("reference") or "")
    order = Order.objects.filter(transfer_reference=reference).first()
    if order is None:
        return None
    if event == "transfer.success":
        return _settle(order, Order.Payout.RELEASED, "")
    reason = str((data or {}).get("reason") or (data or {}).get("status") or event)
    return _settle(order, Order.Payout.FAILED, f"Paystack: {reason}")


def refund(order):
    """Give the buyer their money back. For a held payment nothing has gone
    to the seller; for a split one, Paystack takes it back from both shares."""
    if order.payout in (Order.Payout.RELEASED, Order.Payout.SENDING):
        raise paystack.PaystackError(
            "The seller has already been paid for this order. Refund it from the "
            "Paystack dashboard and recover the money from the seller."
        )
    paystack.refund(reference=order.reference)
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        order.stage = Order.Stage.REFUNDED
        if order.payout != Order.Payout.SPLIT:
            order.payout = Order.Payout.REFUNDED
        order.save(update_fields=["stage", "payout", "updated_at"])
    return order
