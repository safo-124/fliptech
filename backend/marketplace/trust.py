"""Trust and safety for paying sellers on the site.

Money goes straight to the individual seller, but not to just anyone:

- Levels (SellerAccount.level): confirmed sellers list and answer buyers;
  only sellers whose ID staff have checked (MARKETPLACE_REQUIRE_ID) and who
  have a payout account take payments; a Fliiptech visit makes them
  "verified". See SellerAccount.takes_payments.
- Holding money: a new seller's first MARKETPLACE_HOLD_FIRST_ORDERS paid
  orders, and any order above MARKETPLACE_HOLD_ABOVE cedis, are held for
  buyer protection: the seller is paid when the buyer confirms, or a few
  days after handover with no problem (payouts.py).
- A cap on new sellers: orders above MARKETPLACE_NEW_SELLER_LIMIT cedis are
  refused until the seller has MARKETPLACE_NEW_SELLER_ORDERS completed
  orders, so an unproven seller cannot take a large sum.
"""

from django.conf import settings

from .models import Order, PaymentStatus


def paid_orders(seller):
    return seller.orders.filter(status=PaymentStatus.PAID).count()


def completed_orders(seller):
    """Orders the buyer has, or that were handed over with no problem."""
    return seller.orders.filter(
        status=PaymentStatus.PAID, stage__in=[Order.Stage.RECEIVED, Order.Stage.DELIVERED]
    ).count()


def holds_payment(seller, pay_now_pesewas=0):
    """Whether this order's money is held for buyer protection. Holding
    needs a transfer recipient to pay the seller through afterwards."""
    if settings.MARKETPLACE_HOLD_PAYMENTS:
        return True
    if not seller.paystack_recipient:
        return False
    above = settings.MARKETPLACE_HOLD_ABOVE
    if above and pay_now_pesewas > above * 100:
        return True
    first = settings.MARKETPLACE_HOLD_FIRST_ORDERS
    return bool(first) and paid_orders(seller) < first


def over_new_seller_limit(seller, total_pesewas):
    """The cedi cap for a seller still proving themselves, or None."""
    limit = settings.MARKETPLACE_NEW_SELLER_LIMIT
    if not limit or total_pesewas <= limit * 100:
        return None
    if completed_orders(seller) >= settings.MARKETPLACE_NEW_SELLER_ORDERS:
        return None
    return limit
