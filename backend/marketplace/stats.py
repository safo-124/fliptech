"""Numbers a seller can act on: who looked, who asked, who paid.

Views are counted the way a workshop's are (providers/profile_views.py): the
product page is cached, so the browser sends a beacon; each browser counts
once a day, identified only by a salted hash kept in the cache; staff, the
seller themselves and announced crawlers do not count. The number is a floor.
"""

import hashlib
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, F, Q, Sum
from django.utils import timezone

from providers.profile_views import BOT_PATTERN, _seconds_until_tomorrow

from .models import Order, PaymentStatus, ProductEnquiry, ProductViewDay, SellerPayment

WINDOW_DAYS = 30


def record_product_view(product, *, client_ip, user_agent, user=None):
    """Count one view. Returns True when it was counted."""
    if user_agent and BOT_PATTERN.search(user_agent):
        return False
    if (
        user is not None
        and user.is_authenticated
        and (user.is_staff or product.seller.user_id == user.pk)
    ):
        return False

    now = timezone.localtime()
    day = now.date()
    raw = f"{settings.SECRET_KEY}|product|{product.pk}|{day.isoformat()}|{client_ip}|{user_agent}"
    key = "product-view:" + hashlib.sha256(raw.encode()).hexdigest()
    # add() is atomic: two beacons from one page load cannot both win it.
    if not cache.add(key, 1, timeout=_seconds_until_tomorrow(now)):
        return False

    row, _created = ProductViewDay.objects.get_or_create(product=product, day=day)
    ProductViewDay.objects.filter(pk=row.pk).update(views=F("views") + 1)
    return True


def seller_stats(seller):
    """The last 30 days, in total and product by product.

    Products sorted by views, most first, so the one worth boosting (or
    worth a better photo) is at the top.
    """
    today = timezone.localdate()
    since = today - timedelta(days=WINDOW_DAYS - 1)
    since_week = today - timedelta(days=6)
    start = timezone.now() - timedelta(days=WINDOW_DAYS)

    products = list(
        seller.products.exclude(status="suspended")
        .annotate(
            views_30=Sum("view_days__views", filter=Q(view_days__day__gte=since)),
            views_7=Sum("view_days__views", filter=Q(view_days__day__gte=since_week)),
        )
        .order_by("name")
    )
    asked = dict(
        ProductEnquiry.objects.filter(
            seller=seller, created_at__gte=start, state=ProductEnquiry.State.SENT
        )
        .values_list("product_id")
        .annotate(n=Count("pk"))
    )
    sold = dict(
        Order.objects.filter(seller=seller, paid_at__gte=start, status=PaymentStatus.PAID)
        .values_list("product_id")
        .annotate(n=Sum("quantity"))
    )
    boosted = dict(
        SellerPayment.objects.running()
        .boosts()
        .filter(seller=seller)
        .order_by("ends_at")
        .values_list("product_id", "ends_at")
    )

    rows = [
        {
            "id": product.pk,
            "name": product.name,
            "status": product.status,
            "views_7d": product.views_7 or 0,
            "views_30d": product.views_30 or 0,
            "enquiries_30d": asked.get(product.pk, 0),
            "sold_30d": sold.get(product.pk, 0),
            "boosted_until": boosted[product.pk].isoformat() if product.pk in boosted else None,
        }
        for product in products
    ]
    rows.sort(key=lambda row: (-row["views_30d"], row["name"]))
    return {
        "days": WINDOW_DAYS,
        "totals": {
            "views": sum(row["views_30d"] for row in rows),
            "enquiries": sum(asked.values()),
            "sold": sum(sold.values()),
        },
        "products": rows,
    }
