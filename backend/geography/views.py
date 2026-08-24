from django.db.models import Count, Prefetch, Q
from rest_framework import viewsets

from providers.models import Provider

from .models import Area, Region
from .serializers import AreaSerializer, RegionSerializer


def areas_with_published_provider_counts():
    """Return the canonical public Area queryset used by both endpoints."""
    published = Q(providers__status=Provider.Status.PUBLISHED)
    return (
        Area.objects.select_related("region")
        .annotate(provider_count=Count("providers", filter=published))
        .order_by("region__name", "name")
    )


class AreaViewSet(viewsets.ReadOnlyModelViewSet):
    """Powers the area picker, which is also the fallback search origin when a
    trainee declines the browser location prompt."""

    serializer_class = AreaSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return areas_with_published_provider_counts()


class RegionViewSet(viewsets.ReadOnlyModelViewSet):
    """Expose launched region pages with their public area inventory."""

    serializer_class = RegionSerializer
    lookup_field = "slug"

    def get_queryset(self):
        # The frontend sitemap treats every returned region as public; it does
        # not filter on is_launched itself. Keep unlaunched regions out here,
        # while /api/areas/ remains complete for the location picker.
        return (
            Region.objects.filter(is_launched=True)
            .prefetch_related(Prefetch("areas", queryset=areas_with_published_provider_counts()))
            .order_by("name")
        )
