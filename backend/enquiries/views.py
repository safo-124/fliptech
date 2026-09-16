"""Enquiry endpoints: request a code, verify it, then send the enquiry.

Rate limiting here is a spend control, not just an abuse control. Every code is
a paid SMS, and django-axes does not help because it only guards staff login.
"""

import logging

from django.conf import settings
from django.contrib.auth import login
from django.middleware.csrf import get_token
from django.utils import timezone
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import canonical_client_ip, ratelimit_client_ip
from trainees.access import own_trainee_account
from trainees.auth import TraineeAccountDisabled, account_for_verified_phone
from trainees.models import TraineeAccount

from .models import Enquiry
from .otp import OTPError, phone_is_trusted, request_code, verify_code
from .serializers import (
    EnquiryConfirmationSerializer,
    EnquiryCreateSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
)

logger = logging.getLogger(__name__)


def _signed_in_as(request, phone):
    """True when the request is the trainee who owns this number, signed in."""
    account = own_trainee_account(request)
    return account is not None and account.phone == phone


class OTPRequestView(APIView):
    """Send a one-time code.

    Three limits stack: per IP per minute here, then per number per day and per
    IP per day inside request_code.
    """

    @extend_schema(request=OTPRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        if is_ratelimited(
            request,
            group="otp-request",
            key=ratelimit_client_ip,
            rate="5/m",
            increment=True,
        ):
            return Response(
                {"detail": "Too many requests. Wait a minute and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Already verified recently, or signed in with this number: no second
        # code for the second and third provider a trainee enquires with.
        if _signed_in_as(request, phone) or phone_is_trusted(phone):
            return Response({"verified": True, "code_sent": False})

        try:
            request_code(phone, ip_address=canonical_client_ip(request))
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        return Response(
            {"verified": False, "code_sent": True, "expires_in_seconds": settings.OTP_TTL_SECONDS}
        )


class OTPVerifyView(APIView):
    @extend_schema(request=OTPVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            verification = verify_code(
                serializer.validated_data["phone"], serializer.validated_data["code"]
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # The number is now proven, so it gets a trainee account and its earlier
        # enquiries are attached. Signing in happens only for an anonymous
        # visitor: a staff member or trainer testing the form in their own
        # browser must not be silently signed out of their own session.
        signed_in = False
        try:
            account = account_for_verified_phone(
                phone=verification.phone, verified_at=verification.verified_at
            )
        except TraineeAccountDisabled:
            account = None
        if account is not None and not request.user.is_authenticated:
            login(
                request._request,
                account.user,
                backend="django.contrib.auth.backends.ModelBackend",
            )
            request.user = account.user
            get_token(request._request)
            signed_in = True
        elif account is not None and request.user.pk == account.user_id:
            signed_in = True

        return Response({"verified": True, "signed_in": signed_in})


class EnquiryCreateView(APIView):
    """Create an enquiry for a phone number that has already been verified."""

    @extend_schema(request=EnquiryCreateSerializer, responses={201: EnquiryConfirmationSerializer})
    def post(self, request):
        serializer = EnquiryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data.pop("phone")

        if not (_signed_in_as(request, phone) or phone_is_trusted(phone)):
            return Response(
                {"detail": "Verify this phone number before sending an enquiry."},
                status=status.HTTP_403_FORBIDDEN,
            )

        programme = serializer.validated_data["programme"]
        enquiry = Enquiry.objects.create(
            provider=programme.provider,
            trainee_phone=phone,
            phone_verified_at=timezone.now(),
            state=Enquiry.State.SENT,
            trainee=TraineeAccount.objects.filter(phone=phone, is_active=True).first(),
            **serializer.validated_data,
        )

        # Alerting the provider is a business-initiated WhatsApp template and is
        # billed per message, with SMS as the fallback. Both need credentials
        # that do not exist yet, so this is logged rather than pretended.
        logger.info(
            "Provider alert pending for enquiry %s to %s", enquiry.reference_code, enquiry.provider
        )

        return Response(EnquiryConfirmationSerializer(enquiry).data, status=status.HTTP_201_CREATED)
