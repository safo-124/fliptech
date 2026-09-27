"""Trainee API: sign in with a phone, then see your own enquiries.

Every view below the auth views resolves a TraineeContext, which is either the
trainee themselves or a member of staff in a live support session. See
trainees/access.py and trainees/support.py.
"""

import logging

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
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.images import validate_image_upload
from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries.email_otp import may_copy_code_to
from enquiries.models import PhoneVerification
from enquiries.otp import OTPError, request_code, verify_code

from .access import IsTraineeOrSupport, context_for, forget_context
from .auth import TraineeAccountDisabled, account_for_verified_phone, verified_email_for
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

logger = logging.getLogger(__name__)


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

        phone = serializer.validated_data["phone"]
        # A proven address needs no extra cap: the phone allowance already
        # governs how often it can be asked for. A typed one does, or sign-up
        # becomes a way to post mail into a stranger's inbox.
        copy_to = verified_email_for(phone)
        if not copy_to:
            typed = serializer.validated_data.get("email")
            copy_to = typed if typed and may_copy_code_to(typed) else None
        try:
            challenge = request_code(
                phone,
                ip_address=canonical_client_ip(request),
                purpose=PhoneVerification.Purpose.TRAINEE_ACCESS,
                # Copied to the address on the account when there is a
                # verified one, and otherwise to whatever the sign-up form
                # typed. An SMS on a prepaid network is not reliable, and the
                # response below says nothing about whether a copy went —
                # otherwise anyone holding a phone number could learn whether
                # it has an address attached.
                email=copy_to,
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
                # Only ever fills fields that are still empty, so signing in
                # through the sign-up form cannot wipe what is already there.
                profile=serializer.validated_data.get("profile"),
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


@method_decorator(csrf_protect, name="dispatch")
class TraineeAvatarView(TraineeView):
    """The trainee's own profile picture.

    Replace-only, and optional. A trainee has one picture, and a gallery of
    four attempts helps nobody — the same reasoning as a workshop logo.

    DELETE removes it, because someone who uploaded the wrong file needs a way
    back that is not "ask support". That matters more here than it does for a
    workshop: this is a photograph of a person, and being unable to take it
    down would be its own problem.

    Nothing public shows it. It appears in the trainee's own account and to a
    member of staff in a support session, and never on a listing or to a
    workshop, so uploading one gives nothing away to anybody.
    """

    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        ctx = self.ctx
        if not ctx.can_write:
            return Response(
                {"detail": "Support view is read-only. Nothing was changed."},
                status=status.HTTP_403_FORBIDDEN,
            )

        upload = request.FILES.get("avatar")
        refusal = validate_image_upload(upload)
        if refusal is not None:
            return Response({"detail": refusal}, status=status.HTTP_400_BAD_REQUEST)

        account = ctx.account
        account.avatar = upload
        try:
            account.save(update_fields=["avatar", "updated_at"])
        except Exception:
            logger.exception("Avatar upload failed for trainee %s", account.pk)
            return Response(
                {"detail": "That image could not be read. Try another."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # strip_exif returns None for anything Pillow cannot decode, which
        # leaves the original bytes stored unprocessed. Those must not be kept:
        # they would sit in the public media directory carrying whatever
        # metadata — including GPS — they arrived with.
        if not account.avatar.name.lower().endswith(".jpg"):
            account.avatar.delete(save=True)
            return Response(
                {"detail": "That file is not a readable image."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(session_payload(request), status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses={200: None})
    def delete(self, request):
        ctx = self.ctx
        if not ctx.can_write:
            return Response(
                {"detail": "Support view is read-only. Nothing was changed."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if ctx.account.avatar:
            # The row is cleared; the file is left for prune_media, so a page
            # cached with the old address does not start serving a 404.
            ctx.account.avatar = ""
            ctx.account.save(update_fields=["avatar", "updated_at"])
        return Response(session_payload(request))
