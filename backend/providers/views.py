"""Public read API for provider search, the map and the profile screen.

Everything here is anonymous and read-only. Ranking is by distance, never by
who paid most, which is what keeps the ordering defensible.
"""

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point, Polygon
from django.contrib.gis.measure import D
from django.db.models import Avg, Count, Max, Min
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import serializers, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.generics import RetrieveAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Programme
from core.money import money

from .filters import ProviderFilter
from .models import Provider
from .serializers import ProviderDetailSerializer, ProviderListSerializer

# Section 04 warns against thin templates with a place name swapped in. A
# generated page needs real inventory behind it before it is worth indexing.
MIN_LISTINGS_FOR_GENERATED_PAGE = 3


def _point_from_query(params):
    """Read lat/lng off the query string, or return None."""
    lat, lng = params.get("lat"), params.get("lng")
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise ValidationError({"detail": "Provide both lat and lng, or neither."})
    try:
        return Point(float(lng), float(lat), srid=4326)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"detail": "lat and lng must be numbers."}) from exc


@extend_schema(
    parameters=[
        OpenApiParameter("lat", OpenApiTypes.NUMBER, description="Search origin latitude"),
        OpenApiParameter("lng", OpenApiTypes.NUMBER, description="Search origin longitude"),
        OpenApiParameter("radius_km", OpenApiTypes.NUMBER, description="Default 10"),
        OpenApiParameter("bbox", OpenApiTypes.STR, description="minLng,minLat,maxLng,maxLat"),
        OpenApiParameter("trade", OpenApiTypes.STR),
        OpenApiParameter("area", OpenApiTypes.STR),
        OpenApiParameter("region", OpenApiTypes.STR),
        OpenApiParameter("max_fee", OpenApiTypes.NUMBER),
        OpenApiParameter("verified_only", OpenApiTypes.BOOL),
        OpenApiParameter("q", OpenApiTypes.STR, description="Fuzzy name and trade search"),
    ]
)
class ProviderViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ProviderListSerializer
    filterset_class = ProviderFilter

    def get_queryset(self):
        queryset = Provider.objects.published().for_card().with_related()

        # Map view: everything inside the visible rectangle.
        bbox = self.request.query_params.get("bbox")
        if bbox:
            try:
                min_lng, min_lat, max_lng, max_lat = (float(v) for v in bbox.split(","))
            except ValueError as exc:
                raise ValidationError(
                    {"detail": "bbox must be minLng,minLat,maxLng,maxLat."}
                ) from exc
            queryset = queryset.filter(
                location__within=Polygon.from_bbox((min_lng, min_lat, max_lng, max_lat))
            )

        origin = _point_from_query(self.request.query_params)
        if origin is not None:
            radius_km = float(self.request.query_params.get("radius_km", 10))
            return (
                queryset.annotate(distance=Distance("location", origin))
                .filter(distance__lte=D(km=radius_km))
                .order_by("distance")
            )

        # for_card() annotates aggregates, which introduces a GROUP BY, and
        # Django treats a grouped queryset as unordered even when the model has
        # Meta.ordering. Paginating an unordered queryset silently repeats and
        # drops rows between pages, so the ordering is stated explicitly.
        return queryset.order_by("name")

    def get_serializer_class(self):
        return ProviderDetailSerializer if self.action == "retrieve" else ProviderListSerializer


@extend_schema_view(get=extend_schema(operation_id="providers_retrieve_by_slug"))
class ProviderBySlugView(RetrieveAPIView):
    """The profile at its public address, /<area>/<provider-slug>."""

    serializer_class = ProviderDetailSerializer

    def get_object(self):
        return get_object_or_404(
            Provider.objects.published().for_card().with_related(),
            area__slug=self.kwargs["area_slug"],
            slug=self.kwargs["slug"],
        )


class TradeAreaSummarySerializer(serializers.Serializer):
    """Documents the generated-page payload so the frontend is not guessing."""

    provider_count = serializers.IntegerField()
    lowest_fee = serializers.CharField(allow_null=True)
    highest_fee = serializers.CharField(allow_null=True)
    average_fee = serializers.CharField(allow_null=True)
    shortest_weeks = serializers.IntegerField(allow_null=True)
    longest_weeks = serializers.IntegerField(allow_null=True)
    has_enough_inventory_to_index = serializers.BooleanField()
    minimum_for_indexing = serializers.IntegerField()


class TradeAreaSummaryView(APIView):
    """Numbers for a generated area page: how many workshops, and what they cost.

    Section 04 insists these pages be genuinely useful rather than thin
    templates, and names the computed fee-range paragraph as the example. This
    is the endpoint behind it.
    """

    @extend_schema(
        parameters=[
            OpenApiParameter("trade", OpenApiTypes.STR, required=True),
            OpenApiParameter("area", OpenApiTypes.STR),
            OpenApiParameter("region", OpenApiTypes.STR),
        ],
        responses={200: TradeAreaSummarySerializer},
    )
    def get(self, request):
        trade = request.query_params.get("trade")
        if not trade:
            raise ValidationError({"detail": "trade is required."})

        programmes = Programme.objects.filter(
            is_active=True,
            trade__slug__iexact=trade,
            provider__status=Provider.Status.PUBLISHED,
        )
        area = request.query_params.get("area")
        region = request.query_params.get("region")
        if area:
            programmes = programmes.filter(provider__area__slug__iexact=area)
        if region:
            programmes = programmes.filter(provider__area__region__slug__iexact=region)

        stats = programmes.aggregate(
            provider_count=Count("provider", distinct=True),
            lowest_fee=Min("fee"),
            highest_fee=Max("fee"),
            average_fee=Avg("fee"),
            shortest_weeks=Min("duration_weeks"),
            longest_weeks=Max("duration_weeks"),
        )
        provider_count = stats["provider_count"] or 0

        return Response(
            {
                **stats,
                "lowest_fee": money(stats["lowest_fee"]),
                "highest_fee": money(stats["highest_fee"]),
                "average_fee": money(stats["average_fee"]),
                # The frontend uses this to decide between rendering a real page
                # and returning noindex. Ninety empty pages for one region is
                # the exact failure Section 04 warns about.
                "has_enough_inventory_to_index": provider_count >= MIN_LISTINGS_FOR_GENERATED_PAGE,
                "minimum_for_indexing": MIN_LISTINGS_FOR_GENERATED_PAGE,
            }
        )
