"""Texts that tell a buyer something changed: it is back, it is on its way,
it is ready, or a shop they follow has something new.

Every one is a single SMS, sent after the change has been saved, and never
allowed to undo it: a text that fails to send is logged and nothing else.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, F, Q
from django.utils import timezone

from appsupport.notify import notify
from core.sms import send_sms

from .models import Product, ShopFollow, StockAlert

logger = logging.getLogger(__name__)


def _site(path):
    return f"{settings.PUBLIC_SITE_URL.rstrip('/')}{path}"


def _text(phone, message):
    try:
        notify(phone, message, send=send_sms)
        return True
    except Exception:
        logger.exception("Could not text %s", phone)
        return False


def wait_for_stock(product, phone):
    """Add (or renew) a phone's wait for a sold-out product."""
    alert, created = StockAlert.objects.get_or_create(product=product, phone=phone)
    if not created and alert.notified_at is not None:
        alert.notified_at = None
        alert.save(update_fields=["notified_at"])
    return alert


def back_in_stock(product):
    """Tell everybody waiting that a product is back. Once each."""
    if product.availability == Product.Availability.SOLD_OUT:
        return 0
    waiting = list(product.stock_alerts.filter(notified_at__isnull=True))
    now = timezone.now()
    for alert in waiting:
        _text(
            alert.phone,
            f"{settings.BRAND_NAME}: {product.name} from {product.seller.business_name} "
            f"is back. {_site(f'/marketplace/{product.pk}')}",
        )
    StockAlert.objects.filter(pk__in=[alert.pk for alert in waiting]).update(notified_at=now)
    return len(waiting)


def after_availability_change(product, was):
    """Called when a seller saves a product: a sold-out one coming back
    tells the people waiting, after the save has committed."""
    if was == Product.Availability.SOLD_OUT and product.availability != was:
        transaction.on_commit(lambda: back_in_stock(product))


def handed_over(order):
    """The seller says the buyer has it: ask the buyer to confirm."""
    _text(
        order.buyer_phone,
        f"{settings.BRAND_NAME}: {order.seller.business_name} says order {order.reference} "
        f"was handed over. Got it? Confirm or report a problem: "
        f"{_site(f'/marketplace/order/{order.reference}')}",
    )


def balance_due(order):
    """Made-to-order work is ready: ask for the rest of the money."""
    _text(
        order.buyer_phone,
        f"{settings.BRAND_NAME}: {order.seller.business_name} has finished your order "
        f"{order.reference}. Pay the balance of GH₵{order.balance_pesewas / 100:.2f} here: "
        f"{_site(f'/marketplace/order/{order.reference}')}",
    )


def tell_followers(now=None):
    """One text per follower with something new, at most once a day.

    "New" is a product that first went on show since they were last told
    (or since they followed), from a shop they follow.
    """
    now = now or timezone.now()
    told = 0
    follows = (
        ShopFollow.objects.select_related("account", "seller")
        .filter(account__is_active=True)
        .filter(Q(last_told_at__isnull=True) | Q(last_told_at__lte=now - timedelta(hours=20)))
    )
    for follow in follows:
        since = follow.last_told_at or follow.created_at
        new = (
            Product.objects.visible()
            .filter(seller=follow.seller, published_at__gt=since)
            .aggregate(n=Count("pk"))["n"]
        )
        if not new:
            continue
        what = "something new" if new == 1 else f"{new} new things"
        _text(
            follow.account.phone,
            f"{settings.BRAND_NAME}: {follow.seller.business_name} has {what}. "
            f"{_site(f'/marketplace/seller/{follow.seller_id}')}",
        )
        follow.last_told_at = now
        follow.save(update_fields=["last_told_at"])
        told += 1
    return told


def tell_saved_searches(now=None):
    """One text per saved search with new matches, at most once a day.

    "New" is a product that first went on show since the search last
    looked. The match is the marketplace's own (views.browse), so the link
    in the text opens exactly what was counted.
    """
    from urllib.parse import urlencode

    from .models import SavedSearch
    from .views import browse

    now = now or timezone.now()
    told = 0
    searches = (
        SavedSearch.objects.select_related("account")
        .filter(account__is_active=True)
        .filter(Q(last_told_at__isnull=True) | Q(last_told_at__lte=now - timedelta(hours=20)))
    )
    for search in searches:
        new = browse(search.params).filter(published_at__gt=search.checked_at).count()
        search.checked_at = now
        if not new:
            search.save(update_fields=["checked_at"])
            continue
        what = "1 new match" if new == 1 else f"{new} new matches"
        link = _site("/marketplace" + (f"?{urlencode(search.params)}" if search.params else ""))
        _text(
            search.account.phone,
            f'{settings.BRAND_NAME}: {what} for "{search.label}". {link}',
        )
        search.last_told_at = now
        search.save(update_fields=["checked_at", "last_told_at"])
        told += 1
    return told


def problem_reported(order):
    """The buyer says something is wrong: the seller has a set time to answer
    before staff decide."""
    hours = settings.MARKETPLACE_DISPUTE_HOURS
    _text(
        order.seller.phone,
        f"{settings.BRAND_NAME}: the buyer of order {order.reference} reported a problem: "
        f'"{order.problem[:120]}". Reply within {hours} hours in your shop dashboard; then '
        f"Fliiptech decides. {_site('/sell/shop?tab=orders')}",
    )


def problem_answered(order):
    _text(
        order.buyer_phone,
        f"{settings.BRAND_NAME}: {order.seller.business_name} replied about order "
        f"{order.reference}. Fliiptech will look at both sides and decide. "
        f"{_site(f'/marketplace/order/{order.reference}')}",
    )


def received(order):
    _text(
        order.seller.phone,
        f"{settings.BRAND_NAME}: the buyer confirmed they have order {order.reference}. Thank you.",
    )


def tell_price_drops(now=None):
    """One text per buyer whose saved things got cheaper, at most once a day.

    Each saved product remembers the price when it was saved (or when the
    buyer was last told); a lower visible price now is a drop. Telling
    resets the remembered price, so a drop is told once.
    """
    from accounts.models import SavedProduct

    now = now or timezone.now()
    drops = {}
    for saved in (
        SavedProduct.objects.select_related("account", "product")
        .filter(
            account__is_active=True, price_seen__isnull=False, product__price__lt=F("price_seen")
        )
        .filter(product__in=Product.objects.visible())
    ):
        drops.setdefault(saved.account, []).append(saved)
    told = 0
    for account, rows in drops.items():
        names = ", ".join(
            f"{row.product.name} (now GH₵{row.product.price:.0f})" for row in rows[:3]
        )
        more = f" and {len(rows) - 3} more" if len(rows) > 3 else ""
        _text(
            account.phone,
            f"{settings.BRAND_NAME}: cheaper now: {names}{more}. {_site('/marketplace/saved')}",
        )
        for row in rows:
            row.price_seen = row.product.price
            row.save(update_fields=["price_seen"])
        told += 1
    return told
