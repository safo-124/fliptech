from django.db.models import Count, Q
from rest_framework import viewsets

from providers.models import Provider

from .models import Area, Region
from .serializers import AreaSerializer, RegionSerializer


class AreaViewSet(viewsets.ReadOnlyModelViewSet):
    """Powers the area picker, which is also the fallback search origin when a
    trainee declines the browser location prompt."""

    serializer_class = AreaSerializer
    lookup_field = "slug"

    def get_queryset(self):
        published = Q(providers__status=Provider.Status.PUBLISHED)
        return (
            Area.objects.select_related("region")
            .annotate(provider_count=Count("providers", filter=published))
            .order_by("region__name", "name")
        )


class RegionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RegionSerializer
    lookup_field = "slug"
    queryset = Region.objects.prefetch_related("areas__region").order_by("name")
