from django.db.models import Count, Q
from rest_framework import viewsets

from providers.models import Provider

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
                    filter=Q(programmes__provider__status=Provider.Status.PUBLISHED),
                )
            )
            .order_by("display_order", "name")
        )
