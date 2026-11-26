"""The marketplace's buying rules, in one place.

Three switches in settings keep buying simple while payments are proven:

  MARKETPLACE_ONLINE_ONLY  every purchase is paid online; a seller's products
                           are shown, but bought only once they can be paid.
  MARKETPLACE_EXTRAS       deposits for made-to-order, paying part on
                           collection, discount codes. Off: pay in full.
  MARKETPLACE_DELIVERY     delivery by the seller. Off: everything is
                           collected, until Fliiptech's own delivery.

Sellers' own settings for the extras and delivery are kept, so switching one
back on needs nothing from them.
"""

from django.conf import settings
from django.db.models import Q


def online_only():
    return settings.MARKETPLACE_ONLINE_ONLY


def extras_on():
    return settings.MARKETPLACE_EXTRAS


def payable_q(prefix=""):
    """Sellers a buyer can pay on the site, in SQL (SellerAccount.takes_payments)."""
    from .models import SellerAccount

    payable = (
        Q(**{f"{prefix}paystack_recipient__gt": ""})
        if settings.MARKETPLACE_HOLD_PAYMENTS
        else Q(**{f"{prefix}paystack_subaccount__gt": ""})
    )
    if settings.MARKETPLACE_REQUIRE_ID:
        payable &= Q(**{f"{prefix}id_status": SellerAccount.IdStatus.CHECKED})
    return payable


def delivers(seller):
    """Whether this seller's buyers may choose delivery."""
    return bool(settings.MARKETPLACE_DELIVERY and seller.delivery_fee is not None)


def deposit_percent(seller):
    """The seller's deposit for made-to-order, while deposits are on."""
    return seller.deposit_percent if settings.MARKETPLACE_EXTRAS else None


def collect_percent(seller):
    """The share paid online when paying the rest on collection, while that is on."""
    return seller.collect_deposit_percent if settings.MARKETPLACE_EXTRAS else None


def made_to_order_buyable(seller):
    """Made to order can be bought online: paid in full while the extras are
    off, or with a deposit where the seller takes one."""
    return not settings.MARKETPLACE_EXTRAS or bool(seller.deposit_percent)
