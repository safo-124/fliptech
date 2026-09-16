from django.urls import path

from . import views

urlpatterns = [
    path("session/me/", views.TraineeSessionView.as_view(), name="trainee-session-me"),
    path("auth/request-code/", views.TraineeCodeRequestView.as_view(), name="trainee-otp-request"),
    path("auth/verify-code/", views.TraineeCodeVerifyView.as_view(), name="trainee-otp-verify"),
    path("logout/", views.TraineeLogoutView.as_view(), name="trainee-logout"),
    path("account/", views.TraineeAccountView.as_view(), name="trainee-account"),
    path(
        "account/close/",
        views.TraineeCloseAccountView.as_view(),
        name="trainee-account-close",
    ),
    path("enquiries/", views.TraineeEnquiryListView.as_view(), name="trainee-enquiries"),
    path("enrolments/", views.TraineeEnrolmentListView.as_view(), name="trainee-enrolments"),
    path("saved/", views.SavedProviderListView.as_view(), name="trainee-saved"),
    path(
        "saved/<int:provider_id>/",
        views.SavedProviderDetailView.as_view(),
        name="trainee-saved-detail",
    ),
]
