"""Email one-time codes for trainees: signing in, and adding an address.

A separate module from views.py because these are a distinct flow with their
own rules, not because the phone views were full. The phone path creates an
account on first use; this one never does — email is a second door into an
account that already exists, and the phone stays the identity because it is
what a workshop replies to on WhatsApp.

Two things here exist to avoid leaking who is registered.

Requesting a sign-in code answers identically whether or not the address is on
an account. Otherwise this endpoint becomes a way to test addresses one
request at a time, and the answer it gives is "this person uses Skills Hub".

Adding an address checks for a conflict *before* sending anything. The other
order means the owner of an already-registered address receives mail they did
not ask for, triggered by a stranger, and learns nothing useful from it.
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
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries import email_otp
from enquiries.models import EmailVerification
from enquiries.otp import OTPError

from .access import forget_context
from .auth import TraineeAccountDisabled, account_for_verified_email
from .models import TraineeAccount
from .serializers import (
    TraineeAccountSerializer,
    TraineeEmailCodeRequestSerializer,
    TraineeEmailCodeVerifySerializer,
)
from .support import record
from .views import TraineeView, session_payload


def _challenge_response(challenge):
    return Response(
        {
            "challenge_id": str(challenge.challenge_id),
            "expires_in_seconds": settings.OTP_TTL_SECONDS,
        }
    )


@method_decorator(csrf_protect, name="dispatch")
class TraineeEmailCodeRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=TraineeEmailCodeRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = TraineeEmailCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if is_ratelimited(
            request,
            group="trainee-email-otp-request",
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
                purpose=EmailVerification.Purpose.TRAINEE_ACCESS,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        return _challenge_response(challenge)


@method_decorator(csrf_protect, name="dispatch")
class TraineeEmailCodeVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=TraineeEmailCodeVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = TraineeEmailCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if is_ratelimited(
            request,
            group="trainee-email-otp-verify",
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
                purpose=EmailVerification.Purpose.TRAINEE_ACCESS,
                challenge_id=serializer.validated_data["challenge_id"],
            )
            account = account_for_verified_email(
                email=verification.email,
                verified_at=verification.verified_at,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except TraineeAccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        # login() cycles the session key, preventing fixation and dropping any
        # support session a staff member had open in this browser.
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
class TraineeAddEmailRequestView(TraineeView):
    """Start attaching an address to the account already signed in.

    ADD_TO_ACCOUNT is a different purpose from TRAINEE_ACCESS, so a code issued
    to prove a new address cannot be replayed at the sign-in endpoint to enter
    an account that does not carry it yet.
    """

    @extend_schema(request=TraineeEmailCodeRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = TraineeEmailCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = email_otp.normalise_email(serializer.validated_data["email"])

        if not self.ctx.can_write:
            return Response(
                {"detail": "Support view is read-only."}, status=status.HTTP_403_FORBIDDEN
            )

        if TraineeAccount.objects.filter(email=email).exclude(pk=self.ctx.account.pk).exists():
            return Response(
                {"detail": "That address is already on another account."},
                status=status.HTTP_409_CONFLICT,
            )

        if is_ratelimited(
            request,
            group="trainee-add-email",
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
class TraineeAddEmailConfirmView(TraineeView):
    @extend_schema(request=TraineeEmailCodeVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = TraineeEmailCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if not self.ctx.can_write:
            return Response(
                {"detail": "Support view is read-only."}, status=status.HTTP_403_FORBIDDEN
            )

        try:
            verification = email_otp.verify_code(
                serializer.validated_data["email"],
                serializer.validated_data["code"],
                purpose=EmailVerification.Purpose.ADD_TO_ACCOUNT,
                challenge_id=serializer.validated_data["challenge_id"],
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        account = self.ctx.account
        account.email = verification.email
        account.email_verified_at = verification.verified_at
        try:
            account.save(update_fields=["email", "email_verified_at", "updated_at"])
        except IntegrityError:
            # Claimed by someone else between the check above and this save.
            return Response(
                {"detail": "That address is already on another account."},
                status=status.HTTP_409_CONFLICT,
            )

        if self.ctx.is_support:
            record(self.ctx.support, "added_email")
        return Response(TraineeAccountSerializer(account).data)
