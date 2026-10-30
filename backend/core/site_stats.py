"""The few numbers the home page's trust strip shows, counted from the data.

Each counts only what a visitor could actually find on the site: published
workshops, a site visit that passed and has not expired, lessons staff
approved at published workshops, and products on sale. A number that
included drafts or lapsed visits would be the inflated claim the strip
exists to replace — the mockup's star ratings, which the site has no way to
back.
"""

from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


def site_stats():
    from marketplace.models import Product
    from providers.models import Provider, ProviderVideo, Verification

    published = Provider.objects.published()
    today = timezone.localdate()
    # One filter() call, so both conditions hold for the same visit: two
    # calls would let a passed visit and a different, unexpired one combine.
    visited = published.filter(
        Q(verifications__expires_on__isnull=True) | Q(verifications__expires_on__gte=today),
        verifications__outcome__in=[
            Verification.Outcome.PASSED,
            Verification.Outcome.PASSED_WITH_NOTES,
        ],
    )
    return {
        "workshops": published.count(),
        "visited": visited.distinct().count(),
        "lessons": ProviderVideo.objects.shown().filter(provider__in=published).count(),
        "products": Product.objects.visible().count(),
    }


class SiteStatsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(site_stats())
