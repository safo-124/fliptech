"""Enquiry endpoints: request a code, verify it, then send the enquiry.

Rate limiting here is a spend control, not just an abuse control. Every code is
a paid SMS, and django-axes does not help because it only guards staff login.
"""

from django.conf import settings
from django.contrib.auth import login
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.translation import gettext as _
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import canonical_client_ip, ratelimit_client_ip
from providers.owner_messages import queue_enquiry_alert
from trainees.auth import TraineeAccountDisabled, account_for_verified_phone
from trainees.models import TraineeAccount

from .models import Enquiry
from .otp import OTPError, phone_is_trusted, request_code, trust_phone, verify_code
from .serializers import (
    EnquiryConfirmationSerializer,
    EnquiryCreateSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
)


def _signed_in_as(request, phone):
    """True when the signed-in person owns this number, through any of their
    accounts (core/identities.py)."""
    from core.identities import signed_in_phones

    return str(phone) in signed_in_phones(request)


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
                {"detail": _("Too many requests. Wait a minute and try again.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Already verified recently, or signed in with this number: no second
        # code for the second and third provider a trainee enquires with.
        if _signed_in_as(request, phone) or phone_is_trusted(request.session, phone):
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

        # The number is now proven, so it gets an account: a trainee one, with
        # its earlier enquiries attached, for a training enquiry; just the
        # customer account for the marketplace. Signing in happens only for an anonymous
        # visitor: a staff member or trainer testing the form in their own
        # browser must not be silently signed out of their own session.
        signed_in = False
        try:
            if serializer.validated_data["context"] == "marketplace":
                from accounts.auth import account_for_verified_phone as customer_for

                account = customer_for(
                    phone=verification.phone, verified_at=verification.verified_at
                )
            else:
                account = account_for_verified_phone(
                    phone=verification.phone, verified_at=verification.verified_at
                )
        except (TraineeAccountDisabled, ValueError):
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

        # After login(), which may have cycled or flushed the session.
        trust_phone(request.session, verification.phone, verification.verified_at)

        return Response({"verified": True, "signed_in": signed_in})


class EnquiryCreateView(APIView):
    """Create an enquiry for a phone number that has already been verified."""

    @extend_schema(request=EnquiryCreateSerializer, responses={201: EnquiryConfirmationSerializer})
    def post(self, request):
        serializer = EnquiryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data.pop("phone")

        if not (_signed_in_as(request, phone) or phone_is_trusted(request.session, phone)):
            return Response(
                {"detail": _("Verify this phone number before sending an enquiry.")},
                status=status.HTTP_403_FORBIDDEN,
            )

        programme = serializer.validated_data["programme"]
        # The enquiry and the alert telling the workshop about it are one
        # write: an enquiry nobody is queued to tell the workshop about is the
        # failure this alert exists to end.
        with transaction.atomic():
            enquiry = Enquiry.objects.create(
                provider=programme.provider,
                trainee_phone=phone,
                phone_verified_at=timezone.now(),
                state=Enquiry.State.SENT,
                trainee=TraineeAccount.objects.filter(phone=phone, is_active=True).first(),
                **serializer.validated_data,
            )
            # A staff follow-up, sent only if the workshop has not answered
            # in the chat within a day (providers/owner_messages.py).
            queue_enquiry_alert(enquiry)
            # The conversation itself: the enquiry is its first message and
            # the workshop is told at once. Numbers stay hidden until shared.
            from marketplace.chat import account_for_chat, open_enquiry_chat

            account = account_for_chat(request, phone, enquiry.phone_verified_at)
            if account is not None:
                # The name they typed, so the workshop's inbox shows a person
                # rather than "A trainee". Never over one they already chose.
                if enquiry.trainee_name and not account.display_name:
                    account.display_name = enquiry.trainee_name[:120]
                    account.save(update_fields=["display_name", "updated_at"])
                open_enquiry_chat(enquiry, account)

        return Response(EnquiryConfirmationSerializer(enquiry).data, status=status.HTTP_201_CREATED)
