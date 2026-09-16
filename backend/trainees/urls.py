from django.urls import path

from . import email_views, views

urlpatterns = [
    path("session/me/", views.TraineeSessionView.as_view(), name="trainee-session-me"),
    path("auth/request-code/", views.TraineeCodeRequestView.as_view(), name="trainee-otp-request"),
    path("auth/verify-code/", views.TraineeCodeVerifyView.as_view(), name="trainee-otp-verify"),
    # Email is a second door into the same account. See trainees/email_views.py.
    path(
        "auth/email/request-code/",
        email_views.TraineeEmailCodeRequestView.as_view(),
        name="trainee-email-otp-request",
    ),
    path(
        "auth/email/verify-code/",
        email_views.TraineeEmailCodeVerifyView.as_view(),
        name="trainee-email-otp-verify",
    ),
    path(
        "account/email/request-code/",
        email_views.TraineeAddEmailRequestView.as_view(),
        name="trainee-add-email-request",
    ),
    path(
        "account/email/confirm/",
        email_views.TraineeAddEmailConfirmView.as_view(),
        name="trainee-add-email-confirm",
    ),
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
