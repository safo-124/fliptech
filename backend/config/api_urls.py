"""API routes consumed by the Next.js frontend.

Everything under /api/ is public and read-only except the enquiry and complaint
endpoints, the tokenised dashboard, and the signed-in trainee and trainer areas.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from accounts.app_views import AppCodeRequestView, AppCodeVerifyView, AppSignOutView
from accounts.views import AccountPhotoView, AccountView
from accounts.views import AddressesView as AccountAddressesView
from accounts.views import AddressView as AccountAddressView
from accounts.views import AddRoleView as AccountAddRoleView
from accounts.views import BagView as AccountBagView
from accounts.views import CodeRequestView as AccountCodeRequestView
from accounts.views import CodeVerifyView as AccountCodeVerifyView
from accounts.views import LogoutView as AccountLogoutView
from accounts.views import OrdersView as AccountOrdersView
from accounts.views import QuestionsView as AccountQuestionsView
from accounts.views import SavedSearchesView as AccountSavedSearchesView
from accounts.views import SavedSearchView as AccountSavedSearchView
from accounts.views import SavedView as AccountSavedView
from appsupport.views import (
    CrashReportView,
    NoticesView,
    update_asset,
    update_manifest,
)
from catalog.views import TradeViewSet
from core.home_pictures import HomePicturesView
from core.site_stats import SiteStatsView
from core.whoami import WhoAmIView
from courses import learner, studio
from courses.views import (
    CourseAccessView,
    CourseBuyView,
    CourseCodeCheckView,
    MediaAccessView,
    PaystackWebhookView,
    PurchaseVerifyView,
    TrainerCourseView,
    TrainerPayoutBanksView,
    TrainerPayoutView,
)
from enquiries.views import EnquiryCreateView, OTPRequestView, OTPVerifyView
from geography.views import AreaViewSet, RegionViewSet
from marketplace import bundles, chat
from marketplace.selling_views import (
    BasketPriceView,
    CopyProductView,
    FeaturedShopsView,
    FollowShopView,
    OrderBalanceView,
    OrderCreateView,
    OrderProblemView,
    OrderReceivedView,
    OrderView,
    OwnOrderReplyView,
    OwnOrdersView,
    OwnOrderView,
    ProductReportView,
    ProductViewedView,
    QuoteCreateView,
    ReviewView,
    SellerBannerView,
    SellerBoostView,
    SellerCodesView,
    SellerCodeView,
    SellerEarningsView,
    SellerEnquiryRepliedView,
    SellerGrowthView,
    SellerIdView,
    SellerPaymentVerifyView,
    SellerPayoutBanksView,
    SellerPayoutsView,
    SellerPayoutView,
    SellerPlanView,
    SellerProductOptionsView,
    SellerQuotesView,
    SellerQuoteUnlockView,
    SellerStatsView,
    SellerVerificationView,
    ShopOrderCreateView,
    StockAlertView,
)
from marketplace.views import (
    CourseToolsView,
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
    TrainerShopsView,
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
from search.views import (
    NearbyView,
    SearchView,
    SuggestView,
    TrainingAlertsView,
    TrainingAlertView,
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
    # Site search: everything as the visitor types, the suggestions under the
    # box, help when nothing matched, and "text me when one opens".
    # The mobile app: its notices (collected, not pushed: no Firebase), crash
    # reports, and its updates, served from this server.
    path("app/notices/", NoticesView.as_view(), name="app-notices"),
    path("app/crash/", CrashReportView.as_view(), name="app-crash"),
    path("app/updates/manifest/", update_manifest, name="app-update-manifest"),
    path(
        "app/updates/<str:runtime>/<str:update>/<path:path>",
        update_asset,
        name="app-update-asset",
    ),
    # The signed-in person's own picture, for the header and the app.
    path("account/photo/", AccountPhotoView.as_view(), name="account-photo"),
    path("search/", SearchView.as_view(), name="search"),
    path("search/suggest/", SuggestView.as_view(), name="search-suggest"),
    path("search/nearby/", NearbyView.as_view(), name="search-nearby"),
    path("search/alerts/", TrainingAlertsView.as_view(), name="search-alerts"),
    path("search/alerts/<int:pk>/", TrainingAlertView.as_view(), name="search-alert"),
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
    # The home page's trust strip: real counts, in place of ratings.
    path("site/stats/", SiteStatsView.as_view(), name="site-stats"),
    # Online learning: each workshop's approved videos, browsed as a course.
    path("courses/", CourseListView.as_view(), name="course-list"),
    # Paid courses. See courses/views.py.
    path(
        "courses/<slug:area_slug>/<slug:slug>/access/",
        CourseAccessView.as_view(),
        name="course-access",
    ),
    path(
        "courses/<slug:area_slug>/<slug:slug>/buy/",
        CourseBuyView.as_view(),
        name="course-buy",
    ),
    path(
        "payments/<str:reference>/verify/",
        PurchaseVerifyView.as_view(),
        name="purchase-verify",
    ),
    path(
        "payments/paystack/webhook/",
        PaystackWebhookView.as_view(),
        name="paystack-webhook",
    ),
    # Caddy asks this before it streams a video file (forward_auth).
    path("media-access/", MediaAccessView.as_view(), name="media-access"),
    path("trainer/course/", TrainerCourseView.as_view(), name="trainer-course"),
    path(
        "trainer/course/banks/",
        TrainerPayoutBanksView.as_view(),
        name="trainer-course-banks",
    ),
    path(
        "trainer/course/payout/",
        TrainerPayoutView.as_view(),
        name="trainer-course-payout",
    ),
    path(
        "courses/<slug:area_slug>/<slug:slug>/bundles/",
        bundles.CourseBundlesView.as_view(),
        name="course-bundles",
    ),
    path("bundles/<int:pk>/", bundles.BundleView.as_view(), name="bundle-detail"),
    path("bundles/<int:pk>/orders/", bundles.BundleOrderView.as_view(), name="bundle-order"),
    path("sellers/<int:pk>/bundles/", bundles.ShopBundlesView.as_view(), name="shop-bundles"),
    path("seller/bundles/", bundles.OwnBundlesView.as_view(), name="seller-bundles"),
    path("seller/bundles/<int:pk>/", bundles.OwnBundleView.as_view(), name="seller-bundle"),
    path(
        "courses/<slug:area_slug>/<slug:slug>/tools/",
        CourseToolsView.as_view(),
        name="course-tools",
    ),
    path(
        "courses/<slug:area_slug>/<slug:slug>/code/",
        CourseCodeCheckView.as_view(),
        name="course-code",
    ),
    # Learning: progress, my courses, certificates, reviews, questions.
    # See courses/learner.py.
    path("learn/mine/", learner.MyCoursesView.as_view(), name="my-courses"),
    path(
        "learn/lessons/<int:video_id>/progress/",
        learner.LessonProgressView.as_view(),
        name="lesson-progress",
    ),
    path(
        "learn/lessons/<int:video_id>/play/", learner.LessonPlayView.as_view(), name="lesson-play"
    ),
    path(
        "learn/lessons/<int:video_id>/questions/",
        learner.LessonQuestionsView.as_view(),
        name="lesson-questions",
    ),
    path(
        "learn/lessons/<int:video_id>/captions/<str:language>.vtt",
        learner.LessonCaptionsView.as_view(),
        name="lesson-captions",
    ),
    path(
        "courses/<slug:area_slug>/<slug:slug>/certificate/",
        learner.CourseCertificateView.as_view(),
        name="course-certificate",
    ),
    path(
        "courses/<slug:area_slug>/<slug:slug>/reviews/",
        learner.CourseReviewsView.as_view(),
        name="course-reviews",
    ),
    path(
        "certificates/<str:code>/",
        learner.CertificateCheckView.as_view(),
        name="certificate-check",
    ),
    # The trainer's course studio. See courses/studio.py.
    path("trainer/course/details/", studio.StudioDetailsView.as_view(), name="studio-details"),
    path("trainer/course/lessons/", studio.StudioLessonsView.as_view(), name="studio-lessons"),
    path(
        "trainer/course/lessons/<int:video_id>/",
        studio.StudioLessonView.as_view(),
        name="studio-lesson",
    ),
    path(
        "trainer/course/lessons/<int:video_id>/captions/<str:language>/",
        studio.StudioCaptionsView.as_view(),
        name="studio-captions",
    ),
    path("trainer/course/codes/", studio.StudioCodesView.as_view(), name="studio-codes"),
    path(
        "trainer/course/codes/<int:code_id>/", studio.StudioCodeView.as_view(), name="studio-code"
    ),
    path("trainer/course/stats/", studio.StudioStatsView.as_view(), name="studio-stats"),
    path(
        "trainer/course/questions/", studio.StudioQuestionsView.as_view(), name="studio-questions"
    ),
    path(
        "trainer/course/questions/<int:question_id>/answer/",
        studio.StudioAnswerView.as_view(),
        name="studio-answer",
    ),
    path("trainer/course/reviews/", studio.StudioReviewsView.as_view(), name="studio-reviews"),
    path(
        "trainer/course/reviews/<int:review_id>/reply/",
        studio.StudioReplyView.as_view(),
        name="studio-reply",
    ),
    path("trainer/course/boost/", studio.StudioBoostView.as_view(), name="studio-boost"),
    path(
        "trainer/course/boost/<str:reference>/verify/",
        studio.StudioBoostVerifyView.as_view(),
        name="studio-boost-verify",
    ),
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
    path("sellers/trainers/", TrainerShopsView.as_view(), name="sellers-trainers"),
    path("sellers/<int:pk>/", SellerDetailView.as_view(), name="seller-detail"),
    # The marketplace's measured and paid parts; see marketplace/selling_views.py.
    path("products/<int:pk>/viewed/", ProductViewedView.as_view(), name="product-viewed"),
    path("products/<int:pk>/orders/", OrderCreateView.as_view(), name="product-order-create"),
    path("orders/<str:reference>/", OrderView.as_view(), name="order-detail"),
    path("orders/<str:reference>/received/", OrderReceivedView.as_view(), name="order-received"),
    path("orders/<str:reference>/problem/", OrderProblemView.as_view(), name="order-problem"),
    path("sellers/<int:pk>/price/", BasketPriceView.as_view(), name="shop-price"),
    path("sellers/<int:pk>/orders/", ShopOrderCreateView.as_view(), name="shop-order-create"),
    path("products/<int:pk>/reports/", ProductReportView.as_view(), name="product-report"),
    path("quotes/", QuoteCreateView.as_view(), name="quote-create"),
    path("seller/quotes/", SellerQuotesView.as_view(), name="seller-quotes"),
    path(
        "seller/quotes/<int:pk>/unlock/",
        SellerQuoteUnlockView.as_view(),
        name="seller-quote-unlock",
    ),
    path(
        "seller/products/<int:pk>/options/",
        SellerProductOptionsView.as_view(),
        name="seller-product-options",
    ),
    path("seller/codes/", SellerCodesView.as_view(), name="seller-codes"),
    path("seller/codes/<int:pk>/", SellerCodeView.as_view(), name="seller-code"),
    path(
        "seller/enquiries/<int:pk>/replied/",
        SellerEnquiryRepliedView.as_view(),
        name="seller-enquiry-replied",
    ),
    path("seller/verification/", SellerVerificationView.as_view(), name="seller-verification"),
    path("orders/<str:reference>/balance/", OrderBalanceView.as_view(), name="order-balance"),
    path("products/<int:pk>/notify/", StockAlertView.as_view(), name="product-stock-alert"),
    path("sellers/featured/", FeaturedShopsView.as_view(), name="sellers-featured"),
    path("sellers/<int:pk>/follow/", FollowShopView.as_view(), name="shop-follow"),
    path("seller/products/<int:pk>/copy/", CopyProductView.as_view(), name="seller-product-copy"),
    path("seller/earnings/", SellerEarningsView.as_view(), name="seller-earnings"),
    path("reviews/<str:token>/", ReviewView.as_view(), name="seller-review"),
    path("seller/stats/", SellerStatsView.as_view(), name="seller-stats"),
    path("seller/growth/", SellerGrowthView.as_view(), name="seller-growth"),
    path("seller/boosts/", SellerBoostView.as_view(), name="seller-boost"),
    path("seller/plan/", SellerPlanView.as_view(), name="seller-plan"),
    path(
        "seller/payments/<str:reference>/verify/",
        SellerPaymentVerifyView.as_view(),
        name="seller-payment-verify",
    ),
    path("seller/banner/", SellerBannerView.as_view(), name="seller-banner"),
    path("seller/payout/", SellerPayoutView.as_view(), name="seller-payout"),
    path("seller/payout/banks/", SellerPayoutBanksView.as_view(), name="seller-payout-banks"),
    path("seller/orders/", OwnOrdersView.as_view(), name="seller-orders"),
    path("seller/orders/<str:reference>/", OwnOrderView.as_view(), name="seller-order"),
    path(
        "seller/orders/<str:reference>/reply/",
        OwnOrderReplyView.as_view(),
        name="seller-order-reply",
    ),
    path("seller/id/", SellerIdView.as_view(), name="seller-id"),
    path("seller/payouts/", SellerPayoutsView.as_view(), name="seller-payouts"),
    # The mobile app's sign-in: a token instead of a cookie. See
    # accounts/app_views.py and accounts/app_auth.py.
    path("app/request-code/", AppCodeRequestView.as_view(), name="app-request-code"),
    path("app/verify-code/", AppCodeVerifyView.as_view(), name="app-verify-code"),
    path("app/sign-out/", AppSignOutView.as_view(), name="app-sign-out"),
    # One sign-in for everyone; see accounts/views.py.
    path("account/", AccountView.as_view(), name="account"),
    path("account/request-code/", AccountCodeRequestView.as_view(), name="account-request-code"),
    path("account/verify-code/", AccountCodeVerifyView.as_view(), name="account-verify-code"),
    path("account/logout/", AccountLogoutView.as_view(), name="account-logout"),
    path("account/orders/", AccountOrdersView.as_view(), name="account-orders"),
    path("account/questions/", AccountQuestionsView.as_view(), name="account-questions"),
    path("account/saved/", AccountSavedView.as_view(), name="account-saved"),
    path("account/bag/", AccountBagView.as_view(), name="account-bag"),
    path("account/addresses/", AccountAddressesView.as_view(), name="account-addresses"),
    path("account/addresses/<int:pk>/", AccountAddressView.as_view(), name="account-address"),
    path("account/chats/", chat.BuyerChatsView.as_view(), name="account-chats"),
    path("account/chats/<int:pk>/", chat.BuyerChatView.as_view(), name="account-chat"),
    path("seller/chats/", chat.SellerChatsView.as_view(), name="seller-chats"),
    path("seller/chats/<int:pk>/", chat.SellerChatView.as_view(), name="seller-chat"),
    path("account/searches/", AccountSavedSearchesView.as_view(), name="account-searches"),
    path(
        "account/searches/<int:pk>/",
        AccountSavedSearchView.as_view(),
        name="account-search",
    ),
    path("account/roles/<str:role>/", AccountAddRoleView.as_view(), name="account-add-role"),
    path("", include(router.urls)),
]
