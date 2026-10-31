"""Confirming marketplace payments with Paystack.

Two kinds, told apart by their reference's prefix:

  fm-  a seller paying Fliiptech: a boost or a month of the Shop plan.
  fo-  a buyer paying a seller for a product (an Order).

The rule is the paid course's (courses/views.py): nothing is granted on the
payer's say-so. A payment becomes PAID only when Paystack confirms a
successful charge for exactly the amount and currency asked, through its
verify reply or its signed webhook. Both paths run the same function under a
row lock, so a webhook and a returning browser racing each other grant it
once.
"""

import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.sms import send_sms

from . import seller_messages
from .models import Order, PaymentStatus, SellerPayment

logger = logging.getLogger(__name__)


def payer_email(email, phone):
    """Paystack needs an email for its receipt; most people here sign in by
    phone, and pay as <digits>@ a domain staff set."""
    if email:
        return email
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    return f"{digits}@{settings.PAYSTACK_FALLBACK_EMAIL_DOMAIN}"


def _apply(row, data):
    """Set status from Paystack's reply. Returns True when it just became paid."""
    data = data or {}
    state = data.get("status")
    exact = (
        int(data.get("amount") or 0) == row.amount_pesewas
        and str(data.get("currency") or "").upper() == row.currency
    )
    row.gateway_response = str(data.get("gateway_response") or "")[:200]
    row.channel = str(data.get("channel") or "")[:30]
    if state == "success" and exact:
        row.status = PaymentStatus.PAID
        row.paid_at = timezone.now()
        return True
    if state == "success":
        logger.error(
            "Paystack charge %s does not match what was asked; not granting", row.reference
        )
        row.status = PaymentStatus.FAILED
    elif state in ("failed", "abandoned", "reversed"):
        row.status = PaymentStatus.FAILED
    return False


def confirm_seller_payment(reference, data):
    with transaction.atomic():
        payment = SellerPayment.objects.select_for_update().filter(reference=reference).first()
        if payment is None or payment.status == PaymentStatus.PAID:
            return payment
        if _apply(payment, data):
            payment.start()
        payment.save()
        return payment


def confirm_order(reference, data):
    with transaction.atomic():
        order = (
            Order.objects.select_for_update(of=("self",))
            .select_related("seller")
            .filter(reference=reference)
            .first()
        )
        if order is None or order.status == PaymentStatus.PAID:
            return order
        paid = _apply(order, data)
        order.save()
        if paid:
            seller_messages.queue_order_alert(order)
            transaction.on_commit(lambda: _tell_buyer(order))
        return order


def _tell_buyer(order):
    """A receipt they keep on their phone, with who to call."""
    try:
        send_sms(
            order.buyer_phone,
            f"{settings.BRAND_NAME}: you paid GH₵{order.amount:.2f} for "
            f"{order.quantity} x {order.product_name}. Order {order.reference}. "
            f"{order.seller.business_name} will contact you; their number is "
            f"{order.seller.phone}.",
        )
    except Exception:  # A receipt that fails to send must not undo a payment.
        logger.exception("Could not text the receipt for %s", order.reference)


def confirm_reference(reference, data):
    """The webhook's way in: whichever kind the reference is."""
    if reference.startswith("fm-"):
        return confirm_seller_payment(reference, data)
    if reference.startswith("fo-"):
        return confirm_order(reference, data)
    return None
