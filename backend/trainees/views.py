"""Trainee API: sign in with a phone, then see your own enquiries.

Every view below the auth views resolves a TraineeContext, which is either the
trainee themselves or a member of staff in a live support session. See
trainees/access.py and trainees/support.py.
"""

from django.conf import settings
from django.contrib.auth import login, logout
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries.models import PhoneVerification
from enquiries.otp import OTPError, request_code, verify_code

from .access import IsTraineeOrSupport, context_for, forget_context
from .auth import TraineeAccountDisabled, account_for_verified_phone
from .erasure import close_account
from .models import SavedProvider
from .serializers import (
    SavedProviderSerializer,
    TraineeAccountSerializer,
    TraineeCodeRequestSerializer,
    TraineeCodeVerifySerializer,
    TraineeEnquirySerializer,
    TraineeEnrolmentSerializer,
)
from .support import end_support_session, record


def session_payload(request):
    ctx = context_for(request)
    if ctx is None:
        return {"authenticated": False, "account": None, "support": None}
    support = None
    if ctx.is_support:
        support = {
            "staff_name": ctx.support.staff_user.get_full_name()
            or ctx.support.staff_user.get_username(),
            "reason": ctx.support.reason,
            "can_edit": ctx.support.can_edit,
            "expires_at": ctx.support.expires_at,
            "back_office_url": reverse(
                "admin:trainees_traineeaccount_change", args=[ctx.account.pk]
            ),
        }
    return {
        "authenticated": True,
        "account": TraineeAccountSerializer(ctx.account).data,
        "support": support,
    }


class TraineeView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsTraineeOrSupport]

    @property
    def ctx(self):
        return context_for(self.request)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class TraineeSessionView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        get_token(request._request)
        return Response(session_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class TraineeCodeRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=TraineeCodeRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = TraineeCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if is_ratelimited(
            request,
            group="trainee-otp-request",
            key=ratelimit_client_ip,
            rate="5/m",
            increment=True,
        ):
            return Response(
                {"detail": "Too many requests. Wait a minute and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            challenge = request_code(
                serializer.validated_data["phone"],
                ip_address=canonical_client_ip(request),
                purpose=PhoneVerification.Purpose.TRAINEE_ACCESS,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        return Response(
            {
                "challenge_id": str(challenge.challenge_id),
                "expires_in_seconds": settings.OTP_TTL_SECONDS,
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class TraineeCodeVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=TraineeCodeVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = TraineeCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if is_ratelimited(
            request,
            group="trainee-otp-verify",
            key=ratelimit_client_ip,
            rate="10/m",
            increment=True,
        ):
            return Response(
                {"detail": "Too many attempts. Wait a minute and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            verification = verify_code(
                serializer.validated_data["phone"],
                serializer.validated_data["code"],
                purpose=PhoneVerification.Purpose.TRAINEE_ACCESS,
                challenge_id=serializer.validated_data["challenge_id"],
            )
            account = account_for_verified_phone(
                phone=verification.phone,
                verified_at=verification.verified_at,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except TraineeAccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        # login() cycles the session key, which prevents session fixation and
        # also drops any support session a staff member had in this browser.
        login(
            request._request,
            account.user,
            backend="django.contrib.auth.backends.ModelBackend",
        )
        request.user = account.user
        forget_context(request)
        get_token(request._request)
        return Response(session_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class TraineeLogoutView(APIView):
    """Sign out, or, for staff in support mode, leave support mode only."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        ctx = context_for(request)
        if ctx is not None and ctx.is_support:
            end_support_session(request._request)
            return Response(
                {
                    "authenticated": False,
                    "account": None,
                    "support": None,
                    "back_office_url": reverse(
                        "admin:trainees_traineeaccount_change", args=[ctx.account.pk]
                    ),
                }
            )
        logout(request._request)
        return Response({"authenticated": False, "account": None, "support": None})


class TraineeAccountView(TraineeView):
    @extend_schema(responses={200: TraineeAccountSerializer})
    def get(self, request):
        return Response(TraineeAccountSerializer(self.ctx.account).data)

    @extend_schema(request=TraineeAccountSerializer, responses={200: TraineeAccountSerializer})
    def patch(self, request):
        serializer = TraineeAccountSerializer(self.ctx.account, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        account = serializer.save()
        if self.ctx.is_support:
            record(self.ctx.support, "updated_account", fields=sorted(serializer.validated_data))
        return Response(TraineeAccountSerializer(account).data)


class TraineeCloseAccountView(TraineeView):
    """Close your own account. Never available in support mode."""

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        if self.ctx.is_support:
            return Response(
                {"detail": "Only the trainee can close their own account."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if request.data.get("confirm") is not True:
            return Response(
                {"detail": "Confirm that you want to close your account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account = self.ctx.account
        logout(request._request)
        close_account(account)
        return Response({"closed": True})


class TraineeEnquiryListView(TraineeView):
    @extend_schema(responses={200: TraineeEnquirySerializer(many=True)})
    def get(self, request):
        rows = TraineeEnquirySerializer.queryset_for(self.ctx.account)
        return Response(TraineeEnquirySerializer(rows, many=True).data)


class TraineeEnrolmentListView(TraineeView):
    @extend_schema(responses={200: TraineeEnrolmentSerializer(many=True)})
    def get(self, request):
        rows = TraineeEnrolmentSerializer.queryset_for(self.ctx.account)
        return Response(TraineeEnrolmentSerializer(rows, many=True).data)


class SavedProviderListView(TraineeView):
    @extend_schema(responses={200: SavedProviderSerializer(many=True)})
    def get(self, request):
        rows = SavedProvider.objects.filter(trainee=self.ctx.account).select_related(
            "provider__area"
        )
        return Response(SavedProviderSerializer(rows, many=True).data)

    @extend_schema(request=SavedProviderSerializer, responses={201: SavedProviderSerializer})
    def post(self, request):
        serializer = SavedProviderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        saved, created = SavedProvider.objects.get_or_create(
            trainee=self.ctx.account, provider=serializer.validated_data["provider"]
        )
        if self.ctx.is_support:
            record(self.ctx.support, "saved_provider", provider_id=saved.provider_id)
        return Response(
            SavedProviderSerializer(saved).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class SavedProviderDetailView(TraineeView):
    @extend_schema(responses={204: None})
    def delete(self, request, provider_id):
        saved = get_object_or_404(SavedProvider, trainee=self.ctx.account, provider_id=provider_id)
        saved.delete()
        if self.ctx.is_support:
            record(self.ctx.support, "removed_saved_provider", provider_id=provider_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
