"""The paid-course API: a trainer's price and payout, buying, and checking.

Four audiences, kept apart:

  The trainer    /api/trainer/course/…  price, payout account, what sold.
  The trainee    /api/courses/<area>/<slug>/access/ and buy/, and
                 /api/payments/<reference>/verify/ on the way back.
  Paystack       /api/payments/paystack/webhook/, signed with the secret key.
  Caddy          /api/media-access/, asked before it streams a video file.

Nothing unlocks on the trainee's say-so. A purchase becomes PAID only when
Paystack itself confirms it, for exactly the amount and currency asked:
either through its API (verify) or its signed webhook. Both paths run the
same confirm(), which is idempotent, so a webhook and a returning browser
racing each other unlock the course once.
"""

import logging
import secrets
from decimal import Decimal, InvalidOperation
from urllib.parse import unquote, urlparse

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from providers.learning import _courses
from providers.serializers import video_sources
from providers.trainer_views import IsActiveTrainer, _account, _profile_for
from trainees.access import own_trainee_account

from . import paystack
from .access import gate_for, gate_for_file, offer_for
from .models import MAX_PRICE, MIN_PRICE, CourseOffer, CoursePurchase

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# The trainer's side


def _trainer_provider(request):
    provider = _profile_for(_account(request))
    if provider is None:
        raise NotFound(_("Create your workshop details first."))
    return provider


def _offer_payload(provider):
    offer = offer_for(provider)
    paid = CoursePurchase.objects.filter(provider=provider, status=CoursePurchase.Status.PAID)
    return {
        "payments_enabled": paystack.enabled(),
        "price": f"{offer.price:.2f}" if offer is not None and offer.price else None,
        "min_price": f"{MIN_PRICE:.2f}",
        "payout": {
            "ready": bool(offer and offer.payout_ready),
            "bank_code": offer.payout_bank_code if offer else "",
            "bank_name": offer.payout_bank_name if offer else "",
            "account_last4": offer.payout_account_last4 if offer else "",
            "account_name": offer.payout_account_name if offer else "",
        },
        "sales": {
            "count": paid.count(),
            "total": f"{sum((p.amount for p in paid), Decimal(0)):.2f}",
        },
    }


class TrainerCourseView(APIView):
    """The trainer's course price and payout account, and what has sold."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(_offer_payload(_trainer_provider(request)))

    @extend_schema(request=None, responses={200: None})
    def patch(self, request):
        """Set or clear the price. Empty, null or zero makes the course free."""
        provider = _trainer_provider(request)
        raw = request.data.get("price")
        price = None
        if raw not in (None, "", 0, "0"):
            try:
                price = Decimal(str(raw)).quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError):
                return Response(
                    {"price": [_("Enter the price in cedis, like 150.")]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if price < MIN_PRICE or price > MAX_PRICE:
                return Response(
                    {
                        "price": [
                            _("A course can cost from GH₵%(min)s to GH₵%(max)s.")
                            % {"min": MIN_PRICE, "max": MAX_PRICE}
                        ]
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        offer, _created = CourseOffer.objects.get_or_create(provider=provider)
        if price is not None:
            if not paystack.enabled():
                return Response(
                    {"detail": _("Selling courses is not switched on yet.")},
                    status=status.HTTP_409_CONFLICT,
                )
            if not offer.payout_ready:
                return Response(
                    {"detail": _("Add where you want to be paid before setting a price.")},
                    status=status.HTTP_409_CONFLICT,
                )
        offer.price = price
        offer.save(update_fields=["price", "updated_at"])
        return Response(_offer_payload(provider))


class TrainerPayoutBanksView(APIView):
    """Where a trainer can be paid: mobile money networks, then banks."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(responses={200: None})
    def get(self, request):
        try:
            return Response({"banks": paystack.payout_banks()})
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


class TrainerPayoutView(APIView):
    """Save the trainer's payout account at Paystack, as a split subaccount."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(request=None, responses={200: None})
    def put(self, request):
        provider = _trainer_provider(request)
        bank_code = str(request.data.get("bank_code") or "").strip()
        account_number = "".join(
            ch for ch in str(request.data.get("account_number") or "") if ch.isdigit()
        )
        account_name = str(request.data.get("account_name") or "").strip()[:120]
        errors = {}
        if not bank_code:
            errors["bank_code"] = [_("Choose where to be paid.")]
        if not 9 <= len(account_number) <= 20:
            errors["account_number"] = [
                _("Enter the number of the account or mobile money wallet.")
            ]
        if not account_name:
            errors["account_name"] = [_("Enter the name on the account.")]
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        if is_ratelimited(request, group="course-payout", key="user", rate="10/h", increment=True):
            return Response(
                {"detail": _("Too many changes. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            banks = {bank["code"]: bank["name"] for bank in paystack.payout_banks()}
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if bank_code not in banks:
            return Response(
                {"bank_code": [_("Choose where to be paid from the list.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        offer, _created = CourseOffer.objects.get_or_create(provider=provider)
        try:
            code = paystack.save_subaccount(
                existing_code=offer.paystack_subaccount,
                business_name=f"{provider.name} ({account_name})",
                bank_code=bank_code,
                account_number=account_number,
            )
        except paystack.PaystackError as exc:
            # Paystack says why, e.g. the account number does not resolve.
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        offer.paystack_subaccount = code
        offer.payout_bank_code = bank_code
        offer.payout_bank_name = banks[bank_code]
        offer.payout_account_last4 = account_number[-4:]
        offer.payout_account_name = account_name
        offer.save()
        return Response(_offer_payload(provider))


# --------------------------------------------------------------------------
# The trainee's side


def _course_or_404(area_slug, slug):
    course = _courses().filter(area__slug=area_slug, slug=slug).first()
    if course is None:
        raise NotFound(_("No such course."))
    return course


class CourseAccessView(APIView):
    """What this viewer may watch of a course, and whether they can buy it.

    The course page is cached and identical for everyone, with every locked
    lesson's files left out. This fills them in, for this browser, after it
    has loaded.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, area_slug, slug):
        course = _course_or_404(area_slug, slug)
        lessons = list(course.shown_videos)
        gate = gate_for(course, request, videos=lessons)
        return Response(
            {
                "price": f"{gate.price:.2f}" if gate.price else None,
                "owned": gate.owned,
                "signed_in": own_trainee_account(request) is not None,
                "payments_enabled": paystack.enabled(),
                "sources": {
                    str(video.pk): video_sources(video, request)
                    for video in lessons
                    if gate.may_watch(video)
                },
            }
        )


def _payer_email(trainee):
    """Paystack needs an email for its receipt. Trainees sign in by phone,
    so one who has not added an email gets a stand-in on a domain staff set,
    and Paystack's receipt simply goes nowhere."""
    if trainee.email:
        return trainee.email
    digits = "".join(ch for ch in str(trainee.phone) if ch.isdigit())
    return f"{digits}@{settings.PAYSTACK_FALLBACK_EMAIL_DOMAIN}"


@method_decorator(csrf_protect, name="dispatch")
class CourseBuyView(APIView):
    """Start paying for a course. Returns Paystack's page to send them to."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, area_slug, slug):
        trainee = own_trainee_account(request)
        if trainee is None:
            return Response(
                {"detail": _("Sign in to buy a course.")}, status=status.HTTP_401_UNAUTHORIZED
            )
        course = _course_or_404(area_slug, slug)
        gate = gate_for(course, request)
        if not gate.price:
            return Response({"detail": _("This course is free.")}, status=status.HTTP_409_CONFLICT)
        if gate.owned:
            return Response(
                {"detail": _("You already have this course."), "owned": True},
                status=status.HTTP_409_CONFLICT,
            )
        if is_ratelimited(request, group="course-buy", key="user", rate="20/h", increment=True):
            return Response(
                {"detail": _("Too many attempts. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        purchase = CoursePurchase.objects.create(
            reference=f"fc-{secrets.token_hex(10)}",
            provider=course,
            trainee=trainee,
            amount_pesewas=int(gate.price * 100),
        )
        callback = (
            f"{settings.PUBLIC_SITE_URL.rstrip('/')}/learn/{course.area.slug}/{course.slug}"
            f"?purchase={purchase.reference}"
        )
        try:
            url = paystack.initialize(
                email=_payer_email(trainee),
                amount_pesewas=purchase.amount_pesewas,
                reference=purchase.reference,
                callback_url=callback,
                subaccount=course.course_offer.paystack_subaccount,
                metadata={"provider_id": course.pk, "trainee_id": trainee.pk},
            )
        except paystack.PaystackError as exc:
            purchase.status = CoursePurchase.Status.FAILED
            purchase.gateway_response = str(exc)[:200]
            purchase.save(update_fields=["status", "gateway_response", "updated_at"])
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(
            {"authorization_url": url, "reference": purchase.reference},
            status=status.HTTP_201_CREATED,
        )


def confirm(reference, data):
    """Apply what Paystack says about a payment. Returns the purchase or None.

    PAID only for a successful charge of exactly the amount and currency the
    purchase asked for: a webhook or verify reply for a smaller sum, or in
    another currency, unlocks nothing. Idempotent under a row lock.
    """
    with transaction.atomic():
        purchase = CoursePurchase.objects.select_for_update().filter(reference=reference).first()
        if purchase is None:
            return None
        if purchase.status == CoursePurchase.Status.PAID:
            return purchase
        state = (data or {}).get("status")
        exact = (
            int((data or {}).get("amount") or 0) == purchase.amount_pesewas
            and str((data or {}).get("currency") or "").upper() == purchase.currency
        )
        purchase.gateway_response = str((data or {}).get("gateway_response") or "")[:200]
        purchase.channel = str((data or {}).get("channel") or "")[:30]
        if state == "success" and exact:
            purchase.status = CoursePurchase.Status.PAID
            purchase.paid_at = timezone.now()
        elif state == "success":
            logger.error("Paystack charge %s does not match its purchase; not unlocking", reference)
            purchase.status = CoursePurchase.Status.FAILED
        elif state in ("failed", "abandoned", "reversed"):
            purchase.status = CoursePurchase.Status.FAILED
        purchase.save()
        return purchase


@method_decorator(csrf_protect, name="dispatch")
class PurchaseVerifyView(APIView):
    """The trainee is back from Paystack: ask Paystack how it went."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference):
        trainee = own_trainee_account(request)
        purchase = CoursePurchase.objects.filter(reference=reference).first()
        # Only the buyer may ask about their own purchase.
        if trainee is None or purchase is None or purchase.trainee_id != trainee.pk:
            raise NotFound(_("No such payment."))
        if purchase.status == CoursePurchase.Status.PENDING:
            try:
                purchase = confirm(reference, paystack.verify(reference)) or purchase
            except paystack.PaystackError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"status": purchase.status, "owned": purchase.status == "paid"})


@method_decorator(csrf_exempt, name="dispatch")
class PaystackWebhookView(APIView):
    """Paystack telling the server a payment went through.

    The one way a course unlocks if the trainee closed the page before
    coming back. Trusted only by its signature, never by where it came from.
    Always answers 200 once the signature checks out, so Paystack does not
    retry an event this server has already seen or does not need.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        body = request.body
        if not paystack.signature_is_valid(body, request.headers.get("X-Paystack-Signature")):
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        event = request.data if isinstance(request.data, dict) else {}
        if event.get("event") == "charge.success":
            data = event.get("data") or {}
            reference = str(data.get("reference") or "")
            # The prefix says whose payment it is (marketplace/models.py).
            if reference.startswith(("fm-", "fo-")):
                from marketplace.payments import confirm_reference

                confirm_reference(reference, data)
            else:
                confirm(reference, data)
        elif str(event.get("event") or "").startswith("transfer."):
            from marketplace.payouts import transfer_event

            transfer_event(event["event"], event.get("data") or {})
        return Response({"received": True})


# --------------------------------------------------------------------------
# Caddy's question


class MediaAccessView(APIView):
    """May this browser have this video file? Asked by Caddy (forward_auth)
    before it streams anything under /media/videos/public/.

    200 lets Caddy serve the file; 403 stops it. Only the playable copies of
    a locked lesson are ever refused, so free lessons, previews and posters
    cost one quick lookup and nothing else.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None, 403: None})
    def get(self, request):
        uri = request.headers.get("X-Forwarded-Uri", "")
        path = unquote(urlparse(uri).path)
        prefix = "/" + settings.MEDIA_URL.strip("/") + "/"
        if not path.startswith(prefix):
            return HttpResponse(status=200)
        video, gate = gate_for_file(path[len(prefix) :], request)
        if video is not None and not gate.may_watch(video):
            return HttpResponse(status=403)
        return HttpResponse(status=200)
