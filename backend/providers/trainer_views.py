"""Passwordless trainer session and owned profile API."""

from django.conf import settings
from django.contrib.auth import login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries.models import PhoneVerification
from enquiries.otp import OTPError, request_code, verify_code
from enquiries.serializers import OTPRequestSerializer

from .lifecycle import ProviderTransitionError, submit_provider
from .models import TrainerAccount
from .trainer_auth import TrainerAccountDisabled, account_for_verified_phone
from .trainer_profiles import (
    TrainerProfileConflict,
    current_intake_start_date,
    get_owned_profile,
    save_owned_profile,
    serialize_profile,
)
from .trainer_serializers import TrainerOTPVerifySerializer, TrainerProfileInputSerializer


class IsActiveTrainer(BasePermission):
    message = "A verified trainer session is required."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        try:
            return request.user.trainer_account.is_active
        except TrainerAccount.DoesNotExist:
            return False


def _account(request):
    try:
        account = request.user.trainer_account
    except TrainerAccount.DoesNotExist as exc:
        raise PermissionDenied("A verified trainer session is required.") from exc
    if not account.is_active:
        raise PermissionDenied("This trainer account has been disabled.")
    return account


def _profile_for(account):
    try:
        return get_owned_profile(account)
    except TrainerProfileConflict as exc:
        raise PermissionDenied(str(exc)) from exc


def _session_payload(request):
    if not request.user or not request.user.is_authenticated:
        return {"authenticated": False, "profile": None}
    try:
        account = request.user.trainer_account
    except TrainerAccount.DoesNotExist:
        return {"authenticated": False, "profile": None}
    if not account.is_active:
        return {"authenticated": False, "profile": None}
    return {
        "authenticated": True,
        "phone": str(account.phone),
        "account_status": account.approval_status,
        "account_note": account.approval_note,
        "profile": serialize_profile(_profile_for(account)),
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class TrainerSessionView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        # Calling get_token makes the CSRF bootstrap contract explicit even if
        # middleware settings change later.
        get_token(request._request)
        return Response(_session_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class TrainerOTPRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=OTPRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        if is_ratelimited(
            request,
            group="trainer-otp-request",
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
                phone,
                ip_address=canonical_client_ip(request),
                purpose=PhoneVerification.Purpose.TRAINER_ACCESS,
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
class TrainerOTPVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=TrainerOTPVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = TrainerOTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Each challenge caps its own guesses, but nothing stopped a caller
        # burning challenges at the request endpoint's 5/min and taking a fresh
        # allowance of guesses with each one. The two endpoints now have
        # symmetric limits; the per-phone daily cap remains the real backstop.
        if is_ratelimited(
            request,
            group="trainer-otp-verify",
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
                purpose=PhoneVerification.Purpose.TRAINER_ACCESS,
                challenge_id=serializer.validated_data["challenge_id"],
            )
            account = account_for_verified_phone(
                phone=verification.phone,
                verified_at=verification.verified_at,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except TrainerAccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        # login() cycles the session key, preventing fixation. The sessionid
        # cookie is HttpOnly; rotate/get the CSRF token after login so the
        # frontend can use the new value for its first authenticated write.
        login(
            request._request,
            account.user,
            backend="django.contrib.auth.backends.ModelBackend",
        )
        request.user = account.user
        get_token(request._request)
        return Response(_session_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class TrainerProfileView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response({"profile": serialize_profile(_profile_for(_account(request)))})

    @extend_schema(request=TrainerProfileInputSerializer, responses={200: None})
    def put(self, request):
        account = _account(request)
        # The intake date the profile already carries is passed to the
        # serializer so re-saving an unchanged one is allowed. Otherwise a
        # trainer returned for changes in May cannot save anything at all until
        # they work out that an April intake date they never touched is the
        # thing blocking them.
        serializer = TrainerProfileInputSerializer(
            data=request.data,
            context={"current_intake_start_date": current_intake_start_date(_profile_for(account))},
        )
        serializer.is_valid(raise_exception=True)
        try:
            profile = save_owned_profile(
                account=account,
                actor=request.user,
                validated_data=dict(serializer.validated_data),
            )
        except TrainerProfileConflict as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response({"profile": serialize_profile(profile)})


@method_decorator(csrf_protect, name="dispatch")
class TrainerProfileSubmitView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        account = _account(request)
        provider = _profile_for(account)
        if provider is None:
            # There is no object identifier in the public contract, and the
            # generic response reveals nothing about another trainer's record.
            raise NotFound("No trainer profile exists.")
        # len() over the prefetched relation rather than .count(), which would
        # issue a second query and throw the prefetch away.
        if len(provider.programmes.all()) != 1:
            return Response(
                {"detail": "Add exactly one programme before submitting."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            submit_provider(provider, actor=request.user)
        except ProviderTransitionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response({"profile": serialize_profile(_profile_for(account))})


@method_decorator(csrf_protect, name="dispatch")
class TrainerLogoutView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        logout(request._request)
        return Response({"authenticated": False, "profile": None})
