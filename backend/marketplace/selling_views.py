"""The marketplace's paid and measured parts.

  A seller     /api/seller/stats/        who looked, asked and bought
               /api/seller/growth/       boosts and the Shop plan: prices,
                                         what is running, buying either
               /api/seller/banner/       the Shop plan's shop banner
               /api/seller/payout/       where buyers' money goes
               /api/seller/orders/       what buyers have paid for
  A buyer      /api/products/<id>/viewed/   the page-view beacon
               /api/products/<id>/orders/   pay for a product
               /api/orders/<ref>/           an order this browser made
  A reviewer   /api/reviews/<token>/        the link texted after a purchase

Money is confirmed only by Paystack (marketplace/payments.py). The seller
paying Fliiptech goes to Fliiptech's own account; a buyer paying a seller is
split at Paystack straight to the seller's subaccount, with Fliiptech's
commission taken as the main account's share.
"""

from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.contrib.auth import get_user
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.images import strip_exif, stripped_name, validate_image_upload
from core.media import public_url
from core.network import canonical_client_ip, ratelimit_client_ip
from courses import paystack
from enquiries.otp import phone_is_trusted

from .models import (
    Order,
    PaymentStatus,
    Product,
    ProductEnquiry,
    SellerPayment,
    SellerReview,
    payment_reference,
    plan_running,
)
from .payments import confirm_order, confirm_seller_payment, payer_email
from .reviews import read_token
from .serializers import (
    OrderInputSerializer,
    OrderSerializer,
    ReviewInputSerializer,
)
from .stats import record_product_view, seller_stats
from .views import IsActiveSeller, _account, _public_products

SESSION_ORDERS = "marketplace_orders"


def _site(path):
    return f"{settings.PUBLIC_SITE_URL.rstrip('/')}{path}"


def _prices():
    return {
        SellerPayment.Kind.BOOST_WEEK: settings.MARKETPLACE_BOOST_WEEK_PRICE,
        SellerPayment.Kind.BOOST_MONTH: settings.MARKETPLACE_BOOST_MONTH_PRICE,
        SellerPayment.Kind.PLAN_MONTH: settings.MARKETPLACE_PLAN_PRICE,
    }


# --------------------------------------------------------------------------
# Numbers


class ProductViewedView(APIView):
    """The product page's beacon. Sent with navigator.sendBeacon, which
    cannot carry a CSRF header, so DRF authentication is off; the user is
    read from the session only to leave the seller's own looks out. Always
    204 for a visible product, so the answer says nothing about who counted.
    """

    authentication_classes = []
    permission_classes = []

    @extend_schema(request=None, responses={204: None})
    def post(self, request, pk):
        product = get_object_or_404(Product.objects.visible().select_related("seller"), pk=pk)
        if is_ratelimited(
            request, group="product-viewed", key=ratelimit_client_ip, rate="60/m", increment=True
        ):
            return Response(status=429)
        record_product_view(
            product,
            client_ip=canonical_client_ip(request) or "",
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:300],
            user=get_user(request._request),
        )
        return Response(status=204)


class SellerStatsView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(seller_stats(_account(request)))


# --------------------------------------------------------------------------
# Boosts and the Shop plan


def _growth_payload(seller, request):
    plan = plan_running(seller)
    free_boost = plan is not None and not SellerPayment.objects.filter(plan_credit_of=plan).exists()
    boosts = (
        SellerPayment.objects.running()
        .boosts()
        .filter(seller=seller)
        .select_related("product")
        .order_by("ends_at")
    )
    later_plan = (
        SellerPayment.objects.plans()
        .filter(seller=seller, status=PaymentStatus.PAID, ends_at__gt=timezone.now())
        .order_by("-ends_at")
        .values_list("ends_at", flat=True)
        .first()
    )
    return {
        "payments_enabled": paystack.enabled(),
        "prices": {kind.value: str(price) for kind, price in _prices().items()},
        "free_product_limit": settings.MARKETPLACE_FREE_PRODUCT_LIMIT,
        "published": seller.products.filter(status=Product.Status.PUBLISHED).count(),
        "plan": {
            "running": plan is not None,
            "ends_at": later_plan.isoformat() if later_plan else None,
            "free_boost_available": free_boost,
        },
        "boosts": [
            {
                "product": boost.product_id,
                "product_name": boost.product.name if boost.product else "",
                "kind": boost.kind,
                "ends_at": boost.ends_at.isoformat(),
            }
            for boost in boosts
        ],
        "banner": public_url(seller.banner.url, request) if seller.banner else None,
    }


class SellerGrowthView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(_growth_payload(_account(request), request))


def _start_seller_payment(request, seller, kind, product=None):
    if not paystack.enabled():
        return Response(
            {"detail": _("Payments are not switched on yet.")}, status=status.HTTP_409_CONFLICT
        )
    if is_ratelimited(request, group="seller-pay", key="user", rate="20/h", increment=True):
        return Response(
            {"detail": _("Too many attempts. Try again later.")},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    payment = SellerPayment.objects.create(
        reference=payment_reference("fm"),
        seller=seller,
        kind=kind,
        product=product,
        amount_pesewas=_prices()[kind] * 100,
    )
    try:
        url = paystack.initialize(
            email=payer_email(seller.email, seller.phone),
            amount_pesewas=payment.amount_pesewas,
            reference=payment.reference,
            callback_url=_site(f"/sell/shop?payment={payment.reference}"),
            metadata={"seller_id": seller.pk, "kind": kind},
        )
    except paystack.PaystackError as exc:
        payment.status = PaymentStatus.FAILED
        payment.gateway_response = str(exc)[:200]
        payment.save(update_fields=["status", "gateway_response", "updated_at"])
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response(
        {"authorization_url": url, "reference": payment.reference},
        status=status.HTTP_201_CREATED,
    )


@method_decorator(csrf_protect, name="dispatch")
class SellerBoostView(APIView):
    """Boost one published product: pay, or use the Shop plan's free week."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        seller = _account(request)
        product = (
            Product.objects.visible().filter(seller=seller, pk=request.data.get("product")).first()
        )
        if product is None:
            return Response(
                {"product": [_("Choose one of your products that is on show.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if request.data.get("use_plan_credit"):
            with transaction.atomic():
                plan = (
                    SellerPayment.objects.running()
                    .plans()
                    .select_for_update()
                    .filter(seller=seller)
                    .first()
                )
                if plan is None or SellerPayment.objects.filter(plan_credit_of=plan).exists():
                    return Response(
                        {"detail": _("Your free boost for this month has been used.")},
                        status=status.HTTP_409_CONFLICT,
                    )
                boost = SellerPayment(
                    reference=payment_reference("fm"),
                    seller=seller,
                    kind=SellerPayment.Kind.BOOST_WEEK,
                    product=product,
                    plan_credit_of=plan,
                    amount_pesewas=0,
                    status=PaymentStatus.PAID,
                    paid_at=timezone.now(),
                )
                boost.start()
                boost.save()
            return Response(_growth_payload(seller, request), status=status.HTTP_201_CREATED)

        kind = request.data.get("kind")
        if kind not in SellerPayment.BOOST_KINDS:
            return Response(
                {"kind": [_("Choose a week or a month.")]}, status=status.HTTP_400_BAD_REQUEST
            )
        return _start_seller_payment(request, seller, kind, product)


@method_decorator(csrf_protect, name="dispatch")
class SellerPlanView(APIView):
    """Pay for a month of the Shop plan (or another, starting when this ends)."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        return _start_seller_payment(request, _account(request), SellerPayment.Kind.PLAN_MONTH)


@method_decorator(csrf_protect, name="dispatch")
class SellerPaymentVerifyView(APIView):
    """The seller is back from Paystack: ask Paystack how it went."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference):
        seller = _account(request)
        payment = SellerPayment.objects.filter(reference=reference, seller=seller).first()
        if payment is None:
            raise NotFound(_("No such payment."))
        if payment.status == PaymentStatus.PENDING:
            try:
                payment = confirm_seller_payment(reference, paystack.verify(reference)) or payment
            except paystack.PaystackError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(
            {"status": payment.status, "kind": payment.kind, **_growth_payload(seller, request)}
        )


@method_decorator(csrf_protect, name="dispatch")
class SellerBannerView(APIView):
    """The picture across the top of the shop page, shown while on the plan."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={200: None})
    def put(self, request):
        seller = _account(request)
        upload = request.FILES.get("image")
        if upload is None:
            return Response({"image": [_("Choose a picture.")]}, status=status.HTTP_400_BAD_REQUEST)
        problem = validate_image_upload(upload)
        if problem:
            return Response({"image": [problem]}, status=status.HTTP_400_BAD_REQUEST)
        # Phone photographs carry GPS; a shop banner must not publish a home.
        # Pillow reading it is also the real check that it is a picture.
        cleaned = strip_exif(upload)
        if cleaned is None:
            return Response(
                {"image": [_("That file is not an image we can read.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        seller.banner.save(stripped_name(upload.name), cleaned, save=False)
        seller.save(update_fields=["banner", "updated_at"])
        return Response(_growth_payload(seller, request))

    @extend_schema(responses={200: None})
    def delete(self, request):
        seller = _account(request)
        # The file is left for prune_media, so a cached page does not break.
        seller.banner = ""
        seller.save(update_fields=["banner", "updated_at"])
        return Response(_growth_payload(seller, request))


# --------------------------------------------------------------------------
# Where buyers' money goes


def _payout_payload(seller):
    return {
        "payments_enabled": paystack.enabled(),
        "commission_percent": settings.MARKETPLACE_COMMISSION_PERCENT,
        "payout": {
            "ready": seller.payout_ready,
            "bank_code": seller.payout_bank_code,
            "bank_name": seller.payout_bank_name,
            "account_last4": seller.payout_account_last4,
            "account_name": seller.payout_account_name,
        },
    }


class SellerPayoutBanksView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        try:
            return Response({"banks": paystack.payout_banks()})
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@method_decorator(csrf_protect, name="dispatch")
class SellerPayoutView(APIView):
    """Turn on "Buy now" by saving where to be paid, as a Paystack subaccount."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(_payout_payload(_account(request)))

    @extend_schema(request=None, responses={200: None})
    def put(self, request):
        seller = _account(request)
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
        if not paystack.enabled():
            return Response(
                {"detail": _("Payments are not switched on yet.")},
                status=status.HTTP_409_CONFLICT,
            )
        if is_ratelimited(request, group="seller-payout", key="user", rate="10/h", increment=True):
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
        try:
            code = paystack.save_subaccount(
                existing_code=seller.paystack_subaccount,
                business_name=f"{seller.business_name or seller.phone} ({account_name})",
                bank_code=bank_code,
                account_number=account_number,
            )
        except paystack.PaystackError as exc:
            # Paystack says why, e.g. the account number does not resolve.
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        seller.paystack_subaccount = code
        seller.payout_bank_code = bank_code
        seller.payout_bank_name = banks[bank_code]
        seller.payout_account_last4 = account_number[-4:]
        seller.payout_account_name = account_name
        seller.save()
        return Response(_payout_payload(seller))

    @extend_schema(responses={200: None})
    def delete(self, request):
        """Stop taking payments on the site. Paystack keeps the subaccount;
        saving an account again reuses it."""
        seller = _account(request)
        seller.payout_bank_code = seller.payout_bank_name = ""
        seller.payout_account_last4 = seller.payout_account_name = ""
        code, seller.paystack_subaccount = seller.paystack_subaccount, ""
        seller.save()
        payload = _payout_payload(seller)
        payload["previous_subaccount"] = bool(code)
        return Response(payload)


# --------------------------------------------------------------------------
# Orders


def commission_pesewas(amount_pesewas):
    share = Decimal(amount_pesewas) * Decimal(str(settings.MARKETPLACE_COMMISSION_PERCENT)) / 100
    return int(share.quantize(Decimal(1), rounding=ROUND_HALF_UP))


@method_decorator(csrf_protect, name="dispatch")
class OrderCreateView(APIView):
    """Pay for a product. Returns Paystack's page to send the buyer to.

    No account, but a verified phone, as for asking a question: the seller
    is going to call this number to hand the thing over.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=OrderInputSerializer, responses={201: None})
    def post(self, request, pk):
        serializer = OrderInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        product = _public_products().filter(pk=pk).first()
        if product is None:
            raise NotFound(_("No such product."))
        if not (
            paystack.enabled()
            and product.seller.payout_ready
            and product.price
            and product.availability == Product.Availability.AVAILABLE
        ):
            return Response(
                {"detail": _("This product cannot be bought on the site. Ask the seller.")},
                status=status.HTTP_409_CONFLICT,
            )
        if not phone_is_trusted(request.session, data["phone"]):
            return Response(
                {"detail": _("Verify this phone number before paying.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        if is_ratelimited(
            request, group="product-order", key=ratelimit_client_ip, rate="20/h", increment=True
        ):
            return Response(
                {"detail": _("Too many attempts. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        amount = int(product.price * 100) * data["quantity"]
        order = Order.objects.create(
            reference=payment_reference("fo"),
            seller=product.seller,
            product=product,
            product_name=product.name,
            unit_price=product.price,
            quantity=data["quantity"],
            amount_pesewas=amount,
            commission_pesewas=commission_pesewas(amount),
            buyer_phone=data["phone"],
            buyer_name=data["name"].strip(),
            fulfilment=data["fulfilment"],
            note=data.get("note", "").strip(),
        )
        # This browser may see the order afterwards, whatever happens to the
        # hour-long trust in the phone number.
        request.session[SESSION_ORDERS] = [
            *request.session.get(SESSION_ORDERS, [])[-19:],
            order.reference,
        ]
        try:
            url = paystack.initialize(
                email=payer_email(None, order.buyer_phone),
                amount_pesewas=amount,
                reference=order.reference,
                callback_url=_site(f"/marketplace/order/{order.reference}"),
                subaccount=product.seller.paystack_subaccount,
                transaction_charge=order.commission_pesewas,
                metadata={"product_id": product.pk, "seller_id": product.seller_id},
            )
        except paystack.PaystackError as exc:
            order.status = PaymentStatus.FAILED
            order.gateway_response = str(exc)[:200]
            order.save(update_fields=["status", "gateway_response", "updated_at"])
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(
            {"authorization_url": url, "reference": order.reference},
            status=status.HTTP_201_CREATED,
        )


def _buyers_order(request, reference):
    if reference not in request.session.get(SESSION_ORDERS, []):
        raise NotFound(_("No such order."))
    order = Order.objects.select_related("seller").filter(reference=reference).first()
    if order is None:
        raise NotFound(_("No such order."))
    return order


@method_decorator(csrf_protect, name="dispatch")
class OrderView(APIView):
    """An order, for the browser that made it. POST asks Paystack how the
    payment went, for a buyer just back from paying."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, reference):
        return Response(OrderSerializer(_buyers_order(request, reference)).data)

    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference):
        order = _buyers_order(request, reference)
        if order.status == PaymentStatus.PENDING:
            try:
                order = confirm_order(reference, paystack.verify(reference)) or order
            except paystack.PaystackError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(OrderSerializer(order).data)


class OwnOrdersView(APIView):
    """What buyers have paid this seller for. Unpaid attempts are left out."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        orders = (
            _account(request)
            .orders.filter(status=PaymentStatus.PAID)
            .select_related("seller")
            .order_by("-paid_at")[:100]
        )
        return Response({"results": OrderSerializer(orders, many=True).data})


@method_decorator(csrf_protect, name="dispatch")
class OwnOrderView(APIView):
    """Mark a paid order as handed over. Refunds are staff's, not here."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, reference):
        order = (
            _account(request)
            .orders.select_related("seller")
            .filter(reference=reference, status=PaymentStatus.PAID)
            .first()
        )
        if order is None:
            raise NotFound(_("No such order."))
        if request.data.get("stage") != Order.Stage.DELIVERED:
            return Response(
                {"stage": [_("Orders can only be marked as handed over here.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if order.stage == Order.Stage.NEW:
            order.stage = Order.Stage.DELIVERED
            order.delivered_at = timezone.now()
            order.save(update_fields=["stage", "delivered_at", "updated_at"])
        return Response(OrderSerializer(order).data)


# --------------------------------------------------------------------------
# Reviews


def _reviewed_thing(token):
    found = read_token(token)
    if found is None:
        raise NotFound(_("This review link is not valid or has expired."))
    kind, pk = found
    if kind == "enquiry":
        thing = (
            ProductEnquiry.objects.select_related("seller")
            .filter(pk=pk, state=ProductEnquiry.State.SENT)
            .first()
        )
    else:
        thing = (
            Order.objects.select_related("seller").filter(pk=pk, status=PaymentStatus.PAID).first()
        )
    if thing is None:
        raise NotFound(_("This review link is not valid or has expired."))
    return kind, thing


@method_decorator(csrf_protect, name="dispatch")
class ReviewView(APIView):
    """The page a buyer reaches from the texted link."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, token):
        kind, thing = _reviewed_thing(token)
        return Response(
            {
                "seller": thing.seller.business_name,
                "product_name": thing.product_name,
                "paid": kind == "order",
                "reviewed": SellerReview.objects.filter(**{kind: thing}).exists(),
            }
        )

    @extend_schema(request=ReviewInputSerializer, responses={201: None})
    def post(self, request, token):
        kind, thing = _reviewed_thing(token)
        serializer = ReviewInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if is_ratelimited(
            request, group="seller-review", key=ratelimit_client_ip, rate="20/h", increment=True
        ):
            return Response(
                {"detail": _("Too many attempts. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        with transaction.atomic():
            if SellerReview.objects.select_for_update().filter(**{kind: thing}).exists():
                return Response(
                    {"detail": _("You have already reviewed this. Thank you.")},
                    status=status.HTTP_409_CONFLICT,
                )
            SellerReview.objects.create(
                seller=thing.seller,
                product=thing.product,
                product_name=thing.product_name,
                buyer_name=thing.buyer_name,
                rating=serializer.validated_data["rating"],
                comment=serializer.validated_data.get("comment", "").strip(),
                bought=kind == "order" or serializer.validated_data.get("bought", False),
                **{kind: thing},
            )
        return Response({"detail": _("Thank you for your review.")}, status=status.HTTP_201_CREATED)
