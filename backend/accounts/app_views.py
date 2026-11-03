"""Sign-in for the mobile app (see accounts/app_auth.py).

  /api/app/request-code/   send a sign-in code to a phone, as the website does
  /api/app/verify-code/    check it; returns a token for the app to keep
  /api/app/sign-out/       forget this phone's token

The same codes, limits and accounts as /api/account/: one person, one login,
on the website and on any number of phones. These differ only in what they
hand back: a token in the body instead of a session cookie, so they need no
CSRF token either (they set no cookie for a forged request to ride on).
"""

from django.conf import settings
from django.utils.translation import gettext as _
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries.otp import OTPError, request_code, verify_code

from .app_auth import issue_token, revoke
from .auth import AccountDisabled, account_for_verified_phone
from .views import PURPOSE, CodeRequestSerializer, CodeVerifySerializer, account_payload


class AppCodeVerifySerializer(CodeVerifySerializer):
    device = serializers.CharField(max_length=120, required=False, allow_blank=True)


class AppCodeRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=CodeRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = CodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # The website's limit, shared: a phone app is no way round it.
        if is_ratelimited(
            request,
            group="account-otp-request",
            key=ratelimit_client_ip,
            rate="5/m",
            increment=True,
        ):
            return Response(
                {"detail": _("Too many requests. Wait a minute and try again.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        try:
            challenge = request_code(
                serializer.validated_data["phone"],
                ip_address=canonical_client_ip(request),
                purpose=PURPOSE,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        return Response(
            {
                "challenge_id": str(challenge.challenge_id),
                "expires_in_seconds": settings.OTP_TTL_SECONDS,
            }
        )


class AppCodeVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=AppCodeVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = AppCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if is_ratelimited(
            request,
            group="account-otp-verify",
            key=ratelimit_client_ip,
            rate="10/m",
            increment=True,
        ):
            return Response(
                {"detail": _("Too many attempts. Wait a minute and try again.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        data = serializer.validated_data
        try:
            verification = verify_code(
                data["phone"], data["code"], purpose=PURPOSE, challenge_id=data["challenge_id"]
            )
            account = account_for_verified_phone(
                phone=verification.phone, verified_at=verification.verified_at
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except AccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        name = (data.get("name") or "").strip()
        if name and not account.display_name:
            account.display_name = name[:120]
            account.save(update_fields=["display_name", "updated_at"])

        token = issue_token(account.user, device=data.get("device") or "")
        request.user = account.user
        return Response(
            {**account_payload(request), "token": token, "joined": account._just_created}
        )


class AppSignOutView(APIView):
    """Revoke the token this request came with. Always answers signed out."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        revoke(getattr(request._request, "app_token", None))
        return Response({"authenticated": False, "account": None, "roles": None})
