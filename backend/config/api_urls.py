"""API routes consumed by the Next.js frontend.

Everything under /api/ is public and read-only except the enquiry and complaint
endpoints, the tokenised dashboard, and the signed-in trainee and trainer areas.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from catalog.views import TradeViewSet
from core.home_pictures import HomePicturesView
from core.whoami import WhoAmIView
from enquiries.views import EnquiryCreateView, OTPRequestView, OTPVerifyView
from geography.views import AreaViewSet, RegionViewSet
from marketplace.views import (
    OwnEnquiriesView,
    OwnProductsView,
    OwnProductView,
    ProductDetailView,
    ProductEnquiryCreateView,
    ProductListView,
    ProductPhotosView,
    ProductPhotoView,
    ProductPublishView,
    SellerDetailView,
    SellerLogoutView,
    SellerOTPRequestView,
    SellerOTPVerifyView,
    SellerProfileView,
    SellerSessionView,
    StartSellingView,
)
from providers.complaint_views import ComplaintCreateView
from providers.dashboard import ProviderDashboardView, ProviderEnquiryListView
from providers.learning import CourseDetailView, CourseListView
from providers.trainer_dashboard_views import (
    TrainerEnquiryRepliedView,
    TrainerOwnDashboardView,
    TrainerOwnEnquiriesView,
)
from providers.trainer_email_views import (
    TrainerAddEmailConfirmView,
    TrainerAddEmailRequestView,
    TrainerEmailCodeRequestView,
    TrainerEmailCodeVerifyView,
)
from providers.trainer_uploads import (
    TrainerIdentityDocumentView,
    TrainerLogoView,
    TrainerPhotoDeleteView,
    TrainerPhotoUploadView,
)
from providers.trainer_videos import (
    TrainerVideoDeleteView,
    TrainerVideosView,
    TrainerVideoUploadView,
)
from providers.trainer_views import (
    TrainerConfirmListingView,
    TrainerLogoutView,
    TrainerOTPRequestView,
    TrainerOTPVerifyView,
    TrainerProfileSubmitView,
    TrainerProfileView,
    TrainerSessionView,
)
from providers.views import (
    ProfileViewedView,
    ProviderBySlugView,
    ProviderViewSet,
    TradeAreaSummaryView,
    UpcomingIntakesView,
)

router = DefaultRouter()
router.register("providers", ProviderViewSet, basename="provider")
router.register("trades", TradeViewSet, basename="trade")
router.register("areas", AreaViewSet, basename="area")
router.register("regions", RegionViewSet, basename="region")

urlpatterns = [
    # Which account area the caller is signed into, for the site header. Kept
    # deliberately small: it is requested on every page, including search.
    path("session/whoami/", WhoAmIView.as_view(), name="session-whoami"),
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
    # Email is a second door into the same trainer account. The phone route
    # above is untouched and remains the default.
    path(
        "trainer/auth/email/request-code/",
        TrainerEmailCodeRequestView.as_view(),
        name="trainer-email-otp-request",
    ),
    path(
        "trainer/auth/email/verify-code/",
        TrainerEmailCodeVerifyView.as_view(),
        name="trainer-email-otp-verify",
    ),
    path(
        "trainer/account/email/request-code/",
        TrainerAddEmailRequestView.as_view(),
        name="trainer-add-email-request",
    ),
    path(
        "trainer/account/email/confirm/",
        TrainerAddEmailConfirmView.as_view(),
        name="trainer-add-email-confirm",
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
        "trainer/profile/logo/",
        TrainerLogoView.as_view(),
        name="trainer-logo",
    ),
    path(
        "trainer/profile/identity/",
        TrainerIdentityDocumentView.as_view(),
        name="trainer-identity-document",
    ),
    # Teaching videos, uploaded here in pieces, encoded here, and reviewed
    # one by one. See providers/videos.py.
    path("trainer/profile/videos/", TrainerVideosView.as_view(), name="trainer-videos"),
    path(
        "trainer/profile/videos/<int:video_id>/",
        TrainerVideoDeleteView.as_view(),
        name="trainer-video-delete",
    ),
    path(
        "trainer/profile/videos/<int:video_id>/upload/",
        TrainerVideoUploadView.as_view(),
        name="trainer-video-upload",
    ),
    # Screen 5 for a signed-in trainer. The tokenised route below still works
    # for a provider staff onboarded who has never signed in.
    path(
        "trainer/dashboard/",
        TrainerOwnDashboardView.as_view(),
        name="trainer-own-dashboard",
    ),
    path(
        "trainer/dashboard/enquiries/",
        TrainerOwnEnquiriesView.as_view(),
        name="trainer-own-enquiries",
    ),
    path(
        "trainer/dashboard/enquiries/<str:reference_code>/replied/",
        TrainerEnquiryRepliedView.as_view(),
        name="trainer-enquiry-replied",
    ),
    path(
        "trainer/profile/confirm/",
        TrainerConfirmListingView.as_view(),
        name="trainer-confirm-listing",
    ),
    path("trainer/logout/", TrainerLogoutView.as_view(), name="trainer-logout"),
    # Trainee accounts: phone sign-in, own enquiries and saved providers. Staff
    # in a support session reach the same endpoints read-only.
    path("trainee/", include("trainees.urls")),
    # Public page data. Registered before the router so the two-segment provider
    # address does not collide with the router's detail route.
    path("pages/summary/", TradeAreaSummaryView.as_view(), name="trade-area-summary"),
    # The search page's departures board: the next courses to start.
    path("intakes/upcoming/", UpcomingIntakesView.as_view(), name="upcoming-intakes"),
    # The profile page reporting that it was opened, for the dashboard's
    # profile views. Before the router, which owns providers/<pk>/.
    path(
        "providers/<int:pk>/viewed/",
        ProfileViewedView.as_view(),
        name="provider-profile-viewed",
    ),
    path(
        "providers/<slug:area_slug>/<slug:slug>/",
        ProviderBySlugView.as_view(),
        name="provider-by-slug",
    ),
    # The home page's staff-chosen photographs. See core.models.HomePicture.
    path("site/home-pictures/", HomePicturesView.as_view(), name="home-pictures"),
    # Online learning: each workshop's approved videos, browsed as a course.
    path("courses/", CourseListView.as_view(), name="course-list"),
    path(
        "courses/<slug:area_slug>/<slug:slug>/",
        CourseDetailView.as_view(),
        name="course-detail",
    ),
    # Enquiry flow: request a code, verify it, send the enquiry.
    path("enquiries/request-code/", OTPRequestView.as_view(), name="otp-request"),
    path("enquiries/verify-code/", OTPVerifyView.as_view(), name="otp-verify"),
    path("enquiries/", EnquiryCreateView.as_view(), name="enquiry-create"),
    # "Report a problem" on every listing. Anonymous, rate-limited, read by staff.
    path("complaints/", ComplaintCreateView.as_view(), name="complaint-create"),
    # Provider dashboard, reached by a tokenised WhatsApp link.
    path("dashboard/<str:token>/", ProviderDashboardView.as_view(), name="provider-dashboard"),
    path(
        "dashboard/<str:token>/enquiries/",
        ProviderEnquiryListView.as_view(),
        name="provider-dashboard-enquiries",
    ),
    # ----------------------------------------------------------------
    # Marketplace
    #
    # Selling is its own identity, not a flag on a trainer, so it gets its
    # own session the way the trainer and trainee areas do. A trainer who
    # ticks "I also sell" verifies a number while signed in and keeps the
    # login they already have; see marketplace/auth.start_selling.
    path("seller/session/me/", SellerSessionView.as_view(), name="seller-session-me"),
    path(
        "seller/auth/request-code/",
        SellerOTPRequestView.as_view(),
        name="seller-otp-request",
    ),
    path(
        "seller/auth/verify-code/",
        SellerOTPVerifyView.as_view(),
        name="seller-otp-verify",
    ),
    path("seller/logout/", SellerLogoutView.as_view(), name="seller-logout"),
    path("seller/account/", SellerProfileView.as_view(), name="seller-profile"),
    # "I also sell", for a trainer already signed in. No second code: the
    # number was verified to get into this session.
    path("trainer/selling/", StartSellingView.as_view(), name="trainer-start-selling"),
    # The seller's own shelf: every state, including drafts and anything
    # staff have taken down.
    path("seller/enquiries/", OwnEnquiriesView.as_view(), name="seller-enquiries"),
    path("seller/products/", OwnProductsView.as_view(), name="seller-products"),
    path("seller/products/<int:pk>/", OwnProductView.as_view(), name="seller-product"),
    path(
        "seller/products/<int:pk>/published/",
        ProductPublishView.as_view(),
        name="seller-product-publish",
    ),
    path(
        "seller/products/<int:pk>/photos/",
        ProductPhotosView.as_view(),
        name="seller-product-photos",
    ),
    path(
        "seller/products/<int:pk>/photos/<int:photo_id>/",
        ProductPhotoView.as_view(),
        name="seller-product-photo",
    ),
    # What a buyer browses. Reads Product.objects.visible() and nothing else.
    path("products/", ProductListView.as_view(), name="product-list"),
    path("products/<int:pk>/", ProductDetailView.as_view(), name="product-detail"),
    path(
        "products/<int:pk>/enquiries/",
        ProductEnquiryCreateView.as_view(),
        name="product-enquiry-create",
    ),
    path("sellers/<int:pk>/", SellerDetailView.as_view(), name="seller-detail"),
    path("", include(router.urls)),
]
