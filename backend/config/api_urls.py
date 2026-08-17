"""API routes consumed by the Next.js frontend.

Everything under /api/ is public and read-only except the enquiry endpoints and
the tokenised dashboard.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from catalog.views import TradeViewSet
from enquiries.views import EnquiryCreateView, OTPRequestView, OTPVerifyView
from geography.views import AreaViewSet, RegionViewSet
from providers.dashboard import ProviderDashboardView, ProviderEnquiryListView
from providers.views import ProviderBySlugView, ProviderViewSet, TradeAreaSummaryView

router = DefaultRouter()
router.register("providers", ProviderViewSet, basename="provider")
router.register("trades", TradeViewSet, basename="trade")
router.register("areas", AreaViewSet, basename="area")
router.register("regions", RegionViewSet, basename="region")

urlpatterns = [
    # Public page data. Registered before the router so the two-segment provider
    # address does not collide with the router's detail route.
    path("pages/summary/", TradeAreaSummaryView.as_view(), name="trade-area-summary"),
    path(
        "providers/<slug:area_slug>/<slug:slug>/",
        ProviderBySlugView.as_view(),
        name="provider-by-slug",
    ),
    # Enquiry flow: request a code, verify it, send the enquiry.
    path("enquiries/request-code/", OTPRequestView.as_view(), name="otp-request"),
    path("enquiries/verify-code/", OTPVerifyView.as_view(), name="otp-verify"),
    path("enquiries/", EnquiryCreateView.as_view(), name="enquiry-create"),
    # Provider dashboard, reached by a tokenised WhatsApp link.
    path("dashboard/<str:token>/", ProviderDashboardView.as_view(), name="provider-dashboard"),
    path(
        "dashboard/<str:token>/enquiries/",
        ProviderEnquiryListView.as_view(),
        name="provider-dashboard-enquiries",
    ),
    path("", include(router.urls)),
]
