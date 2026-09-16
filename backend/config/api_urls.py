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
from providers.trainer_uploads import (
    TrainerIdentityDocumentView,
    TrainerPhotoDeleteView,
    TrainerPhotoUploadView,
)
from providers.trainer_views import (
    TrainerLogoutView,
    TrainerOTPRequestView,
    TrainerOTPVerifyView,
    TrainerProfileSubmitView,
    TrainerProfileView,
    TrainerSessionView,
)
from providers.views import ProviderBySlugView, ProviderViewSet, TradeAreaSummaryView

router = DefaultRouter()
router.register("providers", ProviderViewSet, basename="provider")
router.register("trades", TradeViewSet, basename="trade")
router.register("areas", AreaViewSet, basename="area")
router.register("regions", RegionViewSet, basename="region")

urlpatterns = [
    # Passwordless trainer onboarding. Session bootstrap is first so the
    # frontend can obtain a CSRF cookie before any unsafe request.
    path("trainer/session/me/", TrainerSessionView.as_view(), name="trainer-session-me"),
    path(
        "trainer/auth/request-code/",
        TrainerOTPRequestView.as_view(),
        name="trainer-otp-request",
    ),
    path(
        "trainer/auth/verify-code/",
        TrainerOTPVerifyView.as_view(),
        name="trainer-otp-verify",
    ),
    path("trainer/profile/", TrainerProfileView.as_view(), name="trainer-profile"),
    path(
        "trainer/profile/submit/",
        TrainerProfileSubmitView.as_view(),
        name="trainer-profile-submit",
    ),
    # Files for the trainer's own listing. Photographs are public content and
    # the identity document is not — see providers/trainer_uploads.py for why
    # they are separate endpoints rather than one with a "kind" parameter.
    path(
        "trainer/profile/photos/",
        TrainerPhotoUploadView.as_view(),
        name="trainer-photo-upload",
    ),
    path(
        "trainer/profile/photos/<int:photo_id>/",
        TrainerPhotoDeleteView.as_view(),
        name="trainer-photo-delete",
    ),
    path(
        "trainer/profile/identity/",
        TrainerIdentityDocumentView.as_view(),
        name="trainer-identity-document",
    ),
    path("trainer/logout/", TrainerLogoutView.as_view(), name="trainer-logout"),
    # Trainee accounts: phone sign-in, own enquiries and saved providers. Staff
    # in a support session reach the same endpoints read-only.
    path("trainee/", include("trainees.urls")),
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
