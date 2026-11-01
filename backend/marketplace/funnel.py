"""The marketplace funnel by trade, for the back office."""

from datetime import timedelta

from django.db.models import Count, Sum
from django.utils import timezone

from catalog.models import Trade

from .models import Order, PaymentStatus, Product, ProductEnquiry, ProductViewDay

DAYS = 30


def funnel_by_trade(days=DAYS):
    since = timezone.now() - timedelta(days=days)
    since_day = timezone.localdate() - timedelta(days=days - 1)
    live = dict(Product.objects.visible().values_list("trade_id").annotate(n=Count("pk")))
    views = dict(
        ProductViewDay.objects.filter(day__gte=since_day)
        .values_list("product__trade_id")
        .annotate(n=Sum("views"))
    )
    asked = dict(
        ProductEnquiry.objects.filter(created_at__gte=since, state=ProductEnquiry.State.SENT)
        .values_list("product__trade_id")
        .annotate(n=Count("pk"))
    )
    paid = Order.objects.filter(status=PaymentStatus.PAID, paid_at__gte=since)
    orders = dict(paid.values_list("product__trade_id").annotate(n=Count("pk")))
    sales = dict(paid.values_list("product__trade_id").annotate(n=Sum("amount_pesewas")))
    names = dict(Trade.objects.values_list("pk", "name"))
    rows = []
    for trade_id in set(live) | set(views) | set(asked) | set(orders):
        seen = views.get(trade_id, 0)
        questions = asked.get(trade_id, 0)
        rows.append(
            {
                "trade": names.get(trade_id, "No trade"),
                "live": live.get(trade_id, 0),
                "views": seen,
                "questions": questions,
                "orders": orders.get(trade_id, 0),
                "sales": f"{(sales.get(trade_id) or 0) / 100:,.2f}",
                # Of 100 people who look, how many ask.
                "ask_rate": f"{100 * questions / seen:.0f}%" if seen else "—",
            }
        )
    rows.sort(key=lambda row: -row["views"])
    return rows
