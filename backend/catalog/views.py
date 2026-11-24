from django.db.models import Count, Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from catalog.listed import listed_course_q

from .models import OTHER_TRADE_SLUG, Trade, TradeCategory
from .serializers import TradeCategorySerializer, TradeSerializer


def _with_provider_count(trades):
    return trades.annotate(
        provider_count=Count(
            "programmes__provider",
            distinct=True,
            # The same rule as every other public page (catalog/listed.py).
            filter=listed_course_q("programmes__"),
        )
    )


class TradeViewSet(viewsets.ReadOnlyModelViewSet):
    """The trade filter row across the top of Screen 1, and the /trades pages."""

    serializer_class = TradeSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return (
            _with_provider_count(
                Trade.objects.filter(is_active=True).exclude(slug=OTHER_TRADE_SLUG)
            )
            .select_related("category")
            .order_by("display_order", "name")
        )

    @extend_schema(responses=TradeSerializer(many=True))
    @action(detail=False, url_path="choices", pagination_class=None)
    def choices(self, request):
        """What a new course or product is filed under: one per category
        (catalog/listing.py). The forms add "Other (describe)" themselves."""
        from .listing import listing_trades

        ids = [trade.pk for trade in listing_trades()]
        trades = {trade.pk: trade for trade in self.get_queryset().filter(pk__in=ids)}
        ordered = [trades[pk] for pk in ids if pk in trades]
        return Response(self.get_serializer(ordered, many=True).data)


class TradeCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    """The categories for browsing ("Browse by category" on the home page,
    the category pages, the app's category row), each with its trades and
    what is live in it. Every active category is listed; `live` says whether
    it has anything to show, and the site and the app hide those without."""

    serializer_class = TradeCategorySerializer
    lookup_field = "slug"
    pagination_class = None

    def get_queryset(self):
        trades = _with_provider_count(Trade.objects.filter(is_active=True)).order_by(
            "display_order", "name"
        )
        return (
            TradeCategory.objects.filter(is_active=True)
            .annotate(
                provider_count=Count(
                    "trades__programmes__provider",
                    distinct=True,
                    filter=listed_course_q("trades__programmes__") & Q(trades__is_active=True),
                )
            )
            .prefetch_related(Prefetch("trades", queryset=trades, to_attr="active_trades"))
            .order_by("display_order", "name")
        )
