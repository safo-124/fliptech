from django.db.models import Count
from rest_framework import viewsets

from catalog.listed import listed_course_q

from .models import Trade
from .serializers import TradeSerializer


class TradeViewSet(viewsets.ReadOnlyModelViewSet):
    """The trade filter row across the top of Screen 1, and the /trades pages."""

    serializer_class = TradeSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return (
            Trade.objects.filter(is_active=True)
            .annotate(
                provider_count=Count(
                    "programmes__provider",
                    distinct=True,
                    # The same rule as every other public page (catalog/listed.py).
                    filter=listed_course_q("programmes__"),
                )
            )
            .order_by("display_order", "name")
        )
