"""Email one-time codes for trainers: signing in, and adding an address.

The trainee equivalent is trainees/email_views.py and the rules are the same,
for the same reasons — email is a second door into an account that already
exists, never a way to create one, and a code issued to prove a new address is
scoped so it cannot be replayed as a sign-in.

Section 03 is worth remembering here. Being asked to log in is named as the
thing that makes a workshop owner give up, which is why their whole flow is
phone and WhatsApp. This does not change that: the phone route is untouched
and remains the default. An address is for the owner whose SMS keeps failing,
which on a prepaid Ghanaian network is common enough to cost real listings.
"""

from django.conf import settings
from django.contrib.auth import login
from django.db import IntegrityError
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries import email_otp
from enquiries.models import EmailVerification
from enquiries.otp import OTPError

from .models import TrainerAccount
from .trainer_auth import TrainerAccountDisabled, account_for_verified_email
from .trainer_serializers import (
    TrainerEmailCodeRequestSerializer,
    TrainerEmailCodeVerifySerializer,
)
from .trainer_views import IsActiveTrainer, _account, _session_payload


def _challenge_response(challenge):
    return Response(
        {
            "challenge_id": str(challenge.challenge_id),
            "expires_in_seconds": settings.OTP_TTL_SECONDS,
        }
    )


@method_decorator(csrf_protect, name="dispatch")
class TrainerEmailCodeRequestView(APIView):
    """Send a sign-in code.

    Answers identically whether or not the address is on an account, so this
    cannot be used to test addresses one request at a time.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=TrainerEmailCodeRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = TrainerEmailCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if is_ratelimited(
            request,
            group="trainer-email-otp-request",
            key=ratelimit_client_ip,
            rate="5/m",
            increment=True,
        ):
            return Response(
                {"detail": "Too many requests. Wait a minute and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            challenge = email_otp.request_code(
                serializer.validated_data["email"],
                ip_address=canonical_client_ip(request),
                purpose=EmailVerification.Purpose.TRAINER_ACCESS,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        return _challenge_response(challenge)


@method_decorator(csrf_protect, name="dispatch")
class TrainerEmailCodeVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=TrainerEmailCodeVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = TrainerEmailCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if is_ratelimited(
            request,
            group="trainer-email-otp-verify",
            key=ratelimit_client_ip,
            rate="10/m",
            increment=True,
        ):
            return Response(
                {"detail": "Too many attempts. Wait a minute and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            verification = email_otp.verify_code(
                serializer.validated_data["email"],
                serializer.validated_data["code"],
                purpose=EmailVerification.Purpose.TRAINER_ACCESS,
                challenge_id=serializer.validated_data["challenge_id"],
            )
            account = account_for_verified_email(
                email=verification.email,
                verified_at=verification.verified_at,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except TrainerAccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        # login() cycles the session key, which prevents fixation.
        login(
            request._request,
            account.user,
            backend="django.contrib.auth.backends.ModelBackend",
        )
        request.user = account.user
        get_token(request._request)
        return Response(_session_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class TrainerAddEmailRequestView(APIView):
    """Start attaching an address to the signed-in trainer account."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(request=TrainerEmailCodeRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = TrainerEmailCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = _account(request)
        email = email_otp.normalise_email(serializer.validated_data["email"])

        # Before sending, so the owner of an address already in use never
        # receives mail a stranger triggered.
        if TrainerAccount.objects.filter(email=email).exclude(pk=account.pk).exists():
            return Response(
                {"detail": "That address is already on another account."},
                status=status.HTTP_409_CONFLICT,
            )

        if is_ratelimited(
            request,
            group="trainer-add-email",
            key=ratelimit_client_ip,
            rate="5/m",
            increment=True,
        ):
            return Response(
                {"detail": "Too many requests. Wait a minute and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            challenge = email_otp.request_code(
                email,
                ip_address=canonical_client_ip(request),
                purpose=EmailVerification.Purpose.ADD_TO_ACCOUNT,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        return _challenge_response(challenge)


@method_decorator(csrf_protect, name="dispatch")
class TrainerAddEmailConfirmView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(request=TrainerEmailCodeVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = TrainerEmailCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = _account(request)

        try:
            verification = email_otp.verify_code(
                serializer.validated_data["email"],
                serializer.validated_data["code"],
                purpose=EmailVerification.Purpose.ADD_TO_ACCOUNT,
                challenge_id=serializer.validated_data["challenge_id"],
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        account.email = verification.email
        account.email_verified_at = verification.verified_at
        try:
            account.save(update_fields=["email", "email_verified_at", "updated_at"])
        except IntegrityError:
            # Claimed between the check above and this save.
            return Response(
                {"detail": "That address is already on another account."},
                status=status.HTTP_409_CONFLICT,
            )

        return Response(_session_payload(request))
