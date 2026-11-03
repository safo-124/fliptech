"""Stock: how many of a product are left, when the seller counts them.

A paid order takes its quantities from the products it bought. At the
seller's low-stock line they are texted "only N left"; at 0 the product
shows as sold out, so nobody pays for something that is not there.
"""

import logging

from django.conf import settings
from django.db import transaction
from django.db.models import F

from core.sms import send_sms

from .models import Product

logger = logging.getLogger(__name__)


def take_stock(order):
    """Called inside confirm_order's transaction, once per paid order."""
    low = []
    gone = []
    for item in order.items.select_related("product"):
        product = item.product
        if product is None or product.stock is None:
            continue
        Product.objects.filter(pk=product.pk).update(stock=F("stock") - item.quantity)
        Product.objects.filter(pk=product.pk, stock__lt=0).update(stock=0)
        product.refresh_from_db(fields=["stock", "availability"])
        if product.stock == 0 and product.availability != Product.Availability.SOLD_OUT:
            product.availability = Product.Availability.SOLD_OUT
            product.save(update_fields=["availability", "updated_at"])
            gone.append(product.name)
        elif 0 < product.stock <= settings.MARKETPLACE_LOW_STOCK:
            low.append(f"{product.name} ({product.stock} left)")
    if low or gone:
        parts = []
        if gone:
            parts.append("Sold out now: " + ", ".join(gone) + ".")
        if low:
            parts.append("Running low: " + ", ".join(low) + ".")
        message = (
            f"{settings.BRAND_NAME}: "
            + " ".join(parts)
            + " Update your stock in your shop dashboard."
        )
        phone = order.seller.phone
        transaction.on_commit(lambda: _text(phone, message))


def _text(phone, message):
    try:
        send_sms(phone, message)
    except Exception:
        logger.exception("Could not text a stock warning")
