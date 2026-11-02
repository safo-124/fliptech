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

import logging
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

from core.identities import phone_vouched_for
from core.images import strip_exif, stripped_name, validate_image_upload
from core.media import public_url
from core.network import canonical_client_ip, ratelimit_client_ip
from courses import paystack

from . import alerts, payouts, quotes
from .models import (
    Order,
    OrderItem,
    PaymentStatus,
    Product,
    ProductEnquiry,
    ProductOption,
    ProductReport,
    QuoteRequest,
    SellerPayment,
    SellerReview,
    payment_reference,
    plan_running,
)
from .payments import confirm_balance, confirm_order, confirm_seller_payment, payer_email
from .reviews import read_token
from .serializers import (
    BasketSerializer,
    DiscountCodeSerializer,
    OrderInputSerializer,
    OrderSerializer,
    ProductOptionSerializer,
    ProductReportInputSerializer,
    QuoteInputSerializer,
    ReviewInputSerializer,
)
from .stats import record_product_view, seller_stats
from .views import IsActiveSeller, _account, _public_products

SESSION_ORDERS = "marketplace_orders"

logger = logging.getLogger(__name__)


def _site(path):
    return f"{settings.PUBLIC_SITE_URL.rstrip('/')}{path}"


def _prices():
    return {
        SellerPayment.Kind.BOOST_WEEK: settings.MARKETPLACE_BOOST_WEEK_PRICE,
        SellerPayment.Kind.BOOST_MONTH: settings.MARKETPLACE_BOOST_MONTH_PRICE,
        SellerPayment.Kind.PLAN_MONTH: settings.MARKETPLACE_PLAN_PRICE,
        SellerPayment.Kind.LEAD: settings.MARKETPLACE_LEAD_PRICE,
        SellerPayment.Kind.VERIFICATION: settings.MARKETPLACE_VERIFICATION_PRICE,
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
        "verification": {
            "verified_at": seller.verified_at.isoformat() if seller.verified_at else None,
            # Paid for, waiting for the visit.
            "requested": SellerPayment.objects.filter(
                seller=seller, kind=SellerPayment.Kind.VERIFICATION, status=PaymentStatus.PAID
            ).exists()
            and seller.verified_at is None,
        },
    }


class SellerGrowthView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(_growth_payload(_account(request), request))


def _start_seller_payment(request, seller, kind, product=None, quote=None):
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
        quote=quote,
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
        "protected": settings.MARKETPLACE_HOLD_PAYMENTS,
        "release_days": settings.MARKETPLACE_RELEASE_DAYS,
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
            listed = {bank["code"]: bank for bank in paystack.payout_banks()}
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if bank_code not in listed:
            return Response(
                {"bank_code": [_("Choose where to be paid from the list.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        banks = {code: bank["name"] for code, bank in listed.items()}
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
        # The same account as a transfer recipient, for buyer protection.
        # Made now because only now is the full number at hand: just the
        # last four digits are kept. Only required while payments are held;
        # otherwise a refusal is logged and the split still works.
        try:
            recipient = paystack.save_recipient(
                bank_code=bank_code,
                bank_type=listed[bank_code].get("type", ""),
                account_number=account_number,
                name=account_name,
            )
        except (paystack.PaystackError, KeyError, TypeError) as exc:
            if settings.MARKETPLACE_HOLD_PAYMENTS:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            logger.warning("No transfer recipient for seller %s: %s", seller.pk, exc)
            recipient = ""

        seller.paystack_subaccount = code
        seller.paystack_recipient = recipient
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
        seller.paystack_recipient = ""
        seller.save()
        payload = _payout_payload(seller)
        payload["previous_subaccount"] = bool(code)
        return Response(payload)


# --------------------------------------------------------------------------
# Orders


def commission_pesewas(amount_pesewas):
    share = Decimal(amount_pesewas) * Decimal(str(settings.MARKETPLACE_COMMISSION_PERCENT)) / 100
    return int(share.quantize(Decimal(1), rounding=ROUND_HALF_UP))


class BasketError(Exception):
    """Something in the basket cannot be bought; the message says what."""


def price_basket(seller, data):
    """Work out an order before it exists: lines, delivery, discount, total.

    Every price is read from the database, never from the request. Each
    item must be the seller's, on show and priced, and either ready now or
    made to order by a seller who takes deposits; an option must be one of
    that product's and available.

    A bag with anything made to order is paid in two parts: the seller's
    deposit share of the goods now, and the rest (with delivery) when the
    seller says it is ready.
    """
    if seller.is_away:
        raise BasketError(
            _("This seller is away until %(date)s. You can still ask them a question.")
            % {"date": seller.away_until.strftime("%d %b")}
        )
    raw = data.get("items") or []
    if not raw:
        raise BasketError(_("Choose something to buy."))
    if len(raw) > 20:
        raise BasketError(_("That is too many different things for one order."))
    products = {
        product.pk: product
        for product in _public_products().filter(
            seller=seller, pk__in=[item["product"] for item in raw]
        )
    }
    lines = []
    for item in raw:
        product = products.get(item["product"])
        buyable = (
            product is not None
            and product.price
            and (
                product.availability == Product.Availability.AVAILABLE
                or (
                    product.availability == Product.Availability.MADE_TO_ORDER
                    and seller.deposit_percent
                )
            )
        )
        if not buyable:
            raise BasketError(_("Something in your order can no longer be bought here."))
        options = list(product.options.all())
        option = None
        if item.get("option"):
            option = next((o for o in options if o.pk == item["option"] and o.available), None)
            if option is None:
                raise BasketError(
                    _("That choice of %(name)s is not available.") % {"name": product.name}
                )
        elif any(o.available for o in options):
            raise BasketError(_("Choose which %(name)s you want.") % {"name": product.name})
        unit = option.price if option and option.price is not None else product.price
        lines.append(
            {
                "product": product,
                "option": option,
                "unit_price": unit,
                "quantity": item["quantity"],
                "pesewas": int(unit * 100) * item["quantity"],
            }
        )

    subtotal = sum(line["pesewas"] for line in lines)
    discount = 0
    code = ""
    typed = "".join(str(data.get("code") or "").split()).upper()
    if typed:
        found = seller.codes.filter(code__iexact=typed).first()
        if found is None or not found.usable():
            raise BasketError(_("That discount code is not valid."))
        code = found.code
        discount = int(
            (Decimal(subtotal) * found.percent / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)
        )
    delivery = 0
    if data.get("fulfilment") == Order.Fulfilment.DELIVERY and seller.delivery_fee is not None:
        delivery = int(seller.delivery_fee * 100)
    paid_for_goods = subtotal - discount
    # On the goods, not on delivery: that money is the seller's cost.
    commission = commission_pesewas(paid_for_goods)
    made_to_order = any(
        line["product"].availability == Product.Availability.MADE_TO_ORDER for line in lines
    )
    if made_to_order:
        pay_now = int(
            (Decimal(paid_for_goods) * seller.deposit_percent / 100).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )
        commission_now = (
            int(
                (Decimal(commission) * pay_now / paid_for_goods).quantize(
                    Decimal(1), rounding=ROUND_HALF_UP
                )
            )
            if paid_for_goods
            else 0
        )
        balance = paid_for_goods - pay_now + delivery
    else:
        pay_now, commission_now, balance = paid_for_goods + delivery, commission, 0
    return {
        "lines": lines,
        "subtotal": subtotal,
        "discount": discount,
        "code": code,
        "delivery": delivery,
        "total": paid_for_goods + delivery,
        "commission": commission,
        "plan": Order.Plan.DEPOSIT if made_to_order else Order.Plan.FULL,
        "pay_now": pay_now,
        "commission_now": commission_now,
        "balance": balance,
        "balance_commission": commission - commission_now,
    }


def _pesewas(value):
    return f"{value / 100:.2f}"


def _basket_payload(priced, seller):
    return {
        "lines": [
            {
                "product": line["product"].pk,
                "product_name": line["product"].name,
                "option": line["option"].pk if line["option"] else None,
                "option_label": line["option"].label if line["option"] else "",
                "unit_price": f"{line['unit_price']:.2f}",
                "quantity": line["quantity"],
                "total": _pesewas(line["pesewas"]),
            }
            for line in priced["lines"]
        ],
        "plan": priced["plan"],
        "deposit_percent": seller.deposit_percent,
        "pay_now": _pesewas(priced["pay_now"]),
        "balance": _pesewas(priced["balance"]),
        "subtotal": _pesewas(priced["subtotal"]),
        "discount": _pesewas(priced["discount"]),
        "code": priced["code"],
        "delivery": _pesewas(priced["delivery"]),
        "delivery_fee": f"{seller.delivery_fee:.2f}" if seller.delivery_fee is not None else None,
        "delivery_area": seller.delivery_area,
        "total": _pesewas(priced["total"]),
        "protected": settings.MARKETPLACE_HOLD_PAYMENTS,
    }


def _shop(pk):
    from .models import SellerAccount

    seller = SellerAccount.objects.filter(pk=pk).first()
    if seller is None or not seller.may_sell:
        raise NotFound(_("No such seller."))
    return seller


def _single_product_items(data, product_pk):
    """A product page's Buy now is a basket of one."""
    if not data.get("items"):
        data["items"] = [
            {
                "product": product_pk,
                "option": data.get("option"),
                "quantity": data.get("quantity") or 1,
            }
        ]
    return data


class BasketPriceView(APIView):
    """The total before paying: what the Buy now panel and the bag show."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=BasketSerializer, responses={200: None})
    def post(self, request, pk):
        seller = _shop(pk)
        serializer = BasketSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if is_ratelimited(
            request, group="basket-price", key=ratelimit_client_ip, rate="120/m", increment=True
        ):
            return Response(status=429)
        try:
            priced = price_basket(seller, dict(serializer.validated_data))
        except BasketError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_basket_payload(priced, seller))


def holds_payment(seller):
    """Whether this seller's next order is held for buyer protection: for
    everyone when MARKETPLACE_HOLD_PAYMENTS is on, otherwise for a new
    seller's first few orders (MARKETPLACE_HOLD_FIRST_ORDERS), when they have
    a transfer recipient to be paid through."""
    if settings.MARKETPLACE_HOLD_PAYMENTS:
        return True
    first = settings.MARKETPLACE_HOLD_FIRST_ORDERS
    if not first or not seller.paystack_recipient:
        return False
    return seller.orders.filter(status=PaymentStatus.PAID).count() < first


def _create_order(request, seller, data):
    if not (paystack.enabled() and seller.payout_ready):
        return Response(
            {"detail": _("This seller does not take payment on the site. Ask them instead.")},
            status=status.HTTP_409_CONFLICT,
        )
    try:
        priced = price_basket(seller, data)
    except BasketError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    if not phone_vouched_for(request, data["phone"]):
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

    lines = priced["lines"]
    first = lines[0]
    count = sum(line["quantity"] for line in lines)
    summary = first["product"].name
    if len(lines) > 1:
        summary = _("%(name)s and %(more)s more") % {"name": summary, "more": len(lines) - 1}
    held = holds_payment(seller)
    with transaction.atomic():
        order = Order.objects.create(
            reference=payment_reference("fo"),
            seller=seller,
            product=first["product"],
            product_name=summary[:200],
            unit_price=first["unit_price"],
            quantity=count,
            amount_pesewas=priced["pay_now"],
            plan=priced["plan"],
            balance_pesewas=priced["balance"],
            balance_commission_pesewas=priced["balance_commission"],
            delivery_pesewas=priced["delivery"],
            discount_pesewas=priced["discount"],
            discount_code=priced["code"],
            commission_pesewas=priced["commission"],
            buyer_phone=data["phone"],
            buyer_name=data["name"].strip(),
            fulfilment=data["fulfilment"],
            note=data.get("note", "").strip(),
            payout=Order.Payout.HELD if held else Order.Payout.SPLIT,
        )
        OrderItem.objects.bulk_create(
            OrderItem(
                order=order,
                product=line["product"],
                product_name=line["product"].name,
                option_label=line["option"].label if line["option"] else "",
                unit_price=line["unit_price"],
                quantity=line["quantity"],
            )
            for line in lines
        )
    # A signed-in buyer with no name yet keeps the one typed here.
    from accounts.auth import own_customer_account

    customer = own_customer_account(request)
    if (
        customer is not None
        and not customer.display_name
        and str(customer.phone) == str(order.buyer_phone)
    ):
        customer.display_name = order.buyer_name[:120]
        customer.save(update_fields=["display_name", "updated_at"])
    # This browser may see the order afterwards, whatever happens to the
    # hour-long trust in the phone number.
    request.session[SESSION_ORDERS] = [
        *request.session.get(SESSION_ORDERS, [])[-19:],
        order.reference,
    ]
    try:
        url = paystack.initialize(
            email=payer_email(None, order.buyer_phone),
            amount_pesewas=order.amount_pesewas,
            reference=order.reference,
            callback_url=_site(f"/marketplace/order/{order.reference}"),
            # Held: all of it to Fliiptech, and the seller's share follows by
            # transfer. Split: straight to the seller, less the commission.
            subaccount=None if held else seller.paystack_subaccount,
            # A deposit carries its share of the commission; the balance the rest.
            transaction_charge=None if held else priced["commission_now"],
            metadata={"seller_id": seller.pk, "items": len(lines)},
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


@method_decorator(csrf_protect, name="dispatch")
class OrderCreateView(APIView):
    """Buy now on a product page: one product, maybe an option and a number.

    No account, but a verified phone, as for asking a question: the seller
    is going to call this number to hand the thing over.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=OrderInputSerializer, responses={201: None})
    def post(self, request, pk):
        serializer = OrderInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = _public_products().filter(pk=pk).select_related("seller").first()
        if product is None:
            raise NotFound(_("No such product."))
        data = _single_product_items(dict(serializer.validated_data), product.pk)
        return _create_order(request, product.seller, data)


@method_decorator(csrf_protect, name="dispatch")
class ShopOrderCreateView(APIView):
    """Pay for a bag of things from one seller in one payment."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=OrderInputSerializer, responses={201: None})
    def post(self, request, pk):
        serializer = OrderInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return _create_order(request, _shop(pk), dict(serializer.validated_data))


def _buyers_order(request, reference):
    """The order, for the browser that made it or the signed-in person whose
    phone paid for it, from any phone."""
    from core.identities import signed_in_phones

    order = Order.objects.select_related("seller").filter(reference=reference).first()
    if order is None or (
        reference not in request.session.get(SESSION_ORDERS, [])
        and str(order.buyer_phone) not in signed_in_phones(request)
    ):
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
        if order.balance_status == Order.Balance.DUE and order.balance_reference:
            # Perhaps back from paying the balance: ask Paystack. A failed
            # question leaves the balance due and the page still shows.
            try:
                verified = paystack.verify(order.balance_reference)
                order = confirm_balance(order.balance_reference, verified) or order
            except paystack.PaystackError:
                pass
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
        wanted = request.data.get("stage")
        if wanted == "ready":
            # Made-to-order work is finished: ask the buyer for the balance.
            if order.plan != Order.Plan.DEPOSIT or order.balance_status != Order.Balance.WAITING:
                return Response(
                    {"stage": [_("This order is not waiting to be finished.")]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            order.balance_status = Order.Balance.DUE
            order.ready_at = timezone.now()
            order.save(update_fields=["balance_status", "ready_at", "updated_at"])
            transaction.on_commit(lambda: alerts.balance_due(order))
            return Response(OrderSerializer(order).data)
        if wanted != Order.Stage.DELIVERED:
            return Response(
                {"stage": [_("Orders can only be marked as ready or handed over here.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not order.fully_paid:
            return Response(
                {"stage": [_("Wait for the buyer to pay the balance before handing it over.")]},
                status=status.HTTP_409_CONFLICT,
            )
        if order.stage == Order.Stage.NEW:
            order.stage = Order.Stage.DELIVERED
            order.delivered_at = timezone.now()
            order.save(update_fields=["stage", "delivered_at", "updated_at"])
            transaction.on_commit(lambda: alerts.handed_over(order))
        return Response(OrderSerializer(order).data)


@method_decorator(csrf_protect, name="dispatch")
class OrderBalanceView(APIView):
    """Pay the balance of a made-to-order order, once the seller says it is
    ready. Same split (or hold) as the deposit, with the rest of the
    commission."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, reference):
        order = _buyers_order(request, reference)
        if order.balance_status != Order.Balance.DUE:
            return Response(
                {"detail": _("There is no balance to pay on this order now.")},
                status=status.HTTP_409_CONFLICT,
            )
        reference_now = payment_reference("fb")
        split = order.payout == Order.Payout.SPLIT
        try:
            url = paystack.initialize(
                email=payer_email(None, order.buyer_phone),
                amount_pesewas=order.balance_pesewas,
                reference=reference_now,
                callback_url=_site(f"/marketplace/order/{order.reference}"),
                subaccount=order.seller.paystack_subaccount if split else None,
                transaction_charge=order.balance_commission_pesewas if split else None,
                metadata={"order": order.reference, "part": "balance"},
            )
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        # Kept only once Paystack has it, so the order page never asks
        # Paystack about a payment that was never started.
        order.balance_reference = reference_now
        order.save(update_fields=["balance_reference", "updated_at"])
        return Response(
            {"authorization_url": url, "reference": order.balance_reference},
            status=status.HTTP_201_CREATED,
        )


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


# --------------------------------------------------------------------------
# The buyer, after paying


@method_decorator(csrf_protect, name="dispatch")
class OrderReceivedView(APIView):
    """ "I've got it." Releases a held payment to the seller at once."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference):
        order = _buyers_order(request, reference)
        if order.stage == Order.Stage.PROBLEM:
            # A problem was reported: staff decide now, so the money is not
            # released by a tap that may have been a mistake either way.
            return Response(
                {"detail": _("Fliiptech staff are looking at the problem you reported.")},
                status=status.HTTP_409_CONFLICT,
            )
        if order.status != PaymentStatus.PAID or order.stage in (
            Order.Stage.REFUNDED,
            Order.Stage.RECEIVED,
        ):
            return Response(OrderSerializer(order).data)
        order.stage = Order.Stage.RECEIVED
        order.received_at = timezone.now()
        order.save(update_fields=["stage", "received_at", "updated_at"])
        order = payouts.release(order)
        return Response(OrderSerializer(order).data)


@method_decorator(csrf_protect, name="dispatch")
class OrderProblemView(APIView):
    """Something is wrong with an order. Freezes a held payment until staff
    have looked: they release it to the seller or refund the buyer."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference):
        order = _buyers_order(request, reference)
        problem = str(request.data.get("problem") or "").strip()[:1000]
        if not problem:
            return Response(
                {"problem": [_("Say what went wrong.")]}, status=status.HTTP_400_BAD_REQUEST
            )
        if order.status != PaymentStatus.PAID or order.stage == Order.Stage.REFUNDED:
            return Response(
                {"detail": _("This order can no longer be disputed here. Contact us.")},
                status=status.HTTP_409_CONFLICT,
            )
        order.stage = Order.Stage.PROBLEM
        order.problem = problem
        order.problem_at = timezone.now()
        order.save(update_fields=["stage", "problem", "problem_at", "updated_at"])
        return Response(OrderSerializer(order).data)


# --------------------------------------------------------------------------
# Reports


@method_decorator(csrf_protect, name="dispatch")
class ProductReportView(APIView):
    """Flag a product to staff. No account: a scam is reported by whoever
    sees it. Rate limited, and the seller never sees who reported."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=ProductReportInputSerializer, responses={201: None})
    def post(self, request, pk):
        product = _public_products().filter(pk=pk).first()
        if product is None:
            raise NotFound(_("No such product."))
        serializer = ProductReportInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if is_ratelimited(
            request, group="product-report", key=ratelimit_client_ip, rate="5/h", increment=True
        ):
            return Response(
                {"detail": _("Too many reports. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        ProductReport.objects.create(
            product=product,
            seller=product.seller,
            product_name=product.name,
            reason=serializer.validated_data["reason"],
            details=serializer.validated_data.get("details", "").strip(),
            reporter_phone=serializer.validated_data.get("phone") or "",
        )
        return Response(
            {"detail": _("Thank you. Fliiptech staff will look at it.")},
            status=status.HTTP_201_CREATED,
        )


# --------------------------------------------------------------------------
# Quote requests


@method_decorator(csrf_protect, name="dispatch")
class QuoteCreateView(APIView):
    """A buyer asking makers in one trade for a bulk or custom job."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=QuoteInputSerializer, responses={201: None})
    def post(self, request):
        from catalog.models import Trade
        from geography.models import Area

        serializer = QuoteInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        trade = Trade.objects.filter(slug=data["trade"]).first()
        if trade is None:
            return Response({"trade": [_("Choose a trade.")]}, status=status.HTTP_400_BAD_REQUEST)
        area = Area.objects.filter(slug=data.get("area")).first() if data.get("area") else None
        if not phone_vouched_for(request, data["phone"]):
            return Response(
                {"detail": _("Verify this phone number first.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        if is_ratelimited(
            request, group="quote-request", key=ratelimit_client_ip, rate="5/h", increment=True
        ):
            return Response(
                {"detail": _("Too many requests. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        with transaction.atomic():
            quote = QuoteRequest.objects.create(
                trade=trade,
                area=area,
                title=data["title"].strip(),
                details=data["details"].strip(),
                quantity=data.get("quantity", "").strip(),
                budget=data.get("budget", "").strip(),
                needed_by=data.get("needed_by"),
                buyer_name=data["name"].strip(),
                buyer_phone=data["phone"],
            )
            transaction.on_commit(lambda: quotes.tell_makers(quote))
        return Response(
            {
                "reference": quote.reference,
                "makers": quotes.makers_for(trade).count(),
            },
            status=status.HTTP_201_CREATED,
        )


def _quote_payload(quote, seller, unlocked_ids):
    unlocked = quote.pk in unlocked_ids
    return {
        "id": quote.pk,
        "reference": quote.reference,
        "trade": quote.trade.name,
        "area": quote.area.name if quote.area else None,
        "title": quote.title,
        "details": quote.details,
        "quantity": quote.quantity,
        "budget": quote.budget,
        "needed_by": quote.needed_by.isoformat() if quote.needed_by else None,
        "created_at": quote.created_at.isoformat(),
        "spots_left": quotes.spots_left(quote),
        "unlocked": unlocked,
        "buyer_name": quote.buyer_name if unlocked else None,
        "buyer_phone": str(quote.buyer_phone) if unlocked else None,
    }


class SellerQuotesView(APIView):
    """Quote requests in the trades this seller sells in."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        seller = _account(request)
        found = list(quotes.open_for(seller)[:50])
        unlocked = set(seller.leads.values_list("quote_id", flat=True))
        return Response(
            {
                "lead_price": str(settings.MARKETPLACE_LEAD_PRICE),
                "free_on_plan": plan_running(seller) is not None,
                "payments_enabled": paystack.enabled(),
                "results": [_quote_payload(quote, seller, unlocked) for quote in found],
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class SellerQuoteUnlockView(APIView):
    """See who asked: free on the Shop plan, otherwise the lead fee."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk):
        seller = _account(request)
        quote = quotes.open_for(seller).filter(pk=pk).first()
        if quote is None:
            raise NotFound(_("No such request."))
        if seller.leads.filter(quote=quote).exists():
            return Response(_quote_payload(quote, seller, {quote.pk}))
        if not quotes.spots_left(quote):
            return Response(
                {"detail": _("Enough makers have already contacted this buyer.")},
                status=status.HTTP_409_CONFLICT,
            )
        if plan_running(seller) is not None or not settings.MARKETPLACE_LEAD_PRICE:
            quotes.unlock(quote, seller)
            return Response(_quote_payload(quote, seller, {quote.pk}))
        return _start_seller_payment(request, seller, SellerPayment.Kind.LEAD, quote=quote)


# --------------------------------------------------------------------------
# The seller's shelf: options, codes, replies, verification


class SellerProductOptionsView(APIView):
    """Replace a product's options in one go: [{label, price, available}]."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @method_decorator(csrf_protect)
    @extend_schema(request=None, responses={200: None})
    def put(self, request, pk):
        seller = _account(request)
        product = seller.products.filter(pk=pk).first()
        if product is None:
            raise NotFound(_("No such product."))
        raw = request.data.get("options")
        if not isinstance(raw, list) or len(raw) > 20:
            return Response(
                {"options": [_("Give up to 20 options.")]}, status=status.HTTP_400_BAD_REQUEST
            )
        serializer = ProductOptionSerializer(data=raw, many=True)
        serializer.is_valid(raise_exception=True)
        labels = [row["label"].strip() for row in serializer.validated_data]
        if any(not label for label in labels) or len(set(labels)) != len(labels):
            return Response(
                {"options": [_("Give each option a different name.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Matched by name, so an option keeps its id when only its price or
        # stock changes: a bag, or a product page cached for a few minutes,
        # still points at the right choice.
        with transaction.atomic():
            existing = {option.label: option for option in product.options.select_for_update()}
            product.options.exclude(label__in=labels).delete()
            for position, row in enumerate(serializer.validated_data):
                label = row["label"].strip()
                option = existing.get(label) or ProductOption(product=product, label=label)
                option.price = row.get("price")
                option.available = row.get("available", True)
                option.display_order = position
                option.save()
        return Response(ProductOptionSerializer(product.options.all(), many=True).data)


class SellerCodesView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        codes = _account(request).codes.all()
        return Response({"results": DiscountCodeSerializer(codes, many=True).data})

    @method_decorator(csrf_protect)
    @extend_schema(request=DiscountCodeSerializer, responses={201: None})
    def post(self, request):
        seller = _account(request)
        serializer = DiscountCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if seller.codes.filter(code__iexact=serializer.validated_data["code"]).exists():
            return Response(
                {"code": [_("You already have a code with that name.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if seller.codes.count() >= 20:
            return Response(
                {"detail": _("Delete an old code first.")}, status=status.HTTP_409_CONFLICT
            )
        serializer.save(seller=seller)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class SellerCodeView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    def _code(self, request, pk):
        found = _account(request).codes.filter(pk=pk).first()
        if found is None:
            raise NotFound(_("No such code."))
        return found

    @method_decorator(csrf_protect)
    @extend_schema(request=None, responses={200: None})
    def patch(self, request, pk):
        found = self._code(request, pk)
        serializer = DiscountCodeSerializer(
            found,
            data={
                key: request.data[key]
                for key in ("active", "ends_on", "percent")
                if key in request.data
            },
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @method_decorator(csrf_protect)
    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        self._code(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class SellerEnquiryRepliedView(APIView):
    """The seller replied to a question (or opened the reply on WhatsApp)."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk):
        enquiry = _account(request).enquiries.filter(pk=pk).first()
        if enquiry is None:
            raise NotFound(_("No such question."))
        if enquiry.replied_at is None:
            enquiry.replied_at = timezone.now()
            enquiry.save(update_fields=["replied_at", "updated_at"])
        return Response({"replied_at": enquiry.replied_at.isoformat()})


@method_decorator(csrf_protect, name="dispatch")
class SellerVerificationView(APIView):
    """Pay for the "Verified maker" visit. Staff arrange it and set the badge."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        seller = _account(request)
        if seller.verified_at is not None:
            return Response(
                {"detail": _("You are already a verified maker.")}, status=status.HTTP_409_CONFLICT
            )
        if SellerPayment.objects.filter(
            seller=seller, kind=SellerPayment.Kind.VERIFICATION, status=PaymentStatus.PAID
        ).exists():
            return Response(
                {"detail": _("You have paid for a visit; Fliiptech will call to arrange it.")},
                status=status.HTTP_409_CONFLICT,
            )
        return _start_seller_payment(request, seller, SellerPayment.Kind.VERIFICATION)


# --------------------------------------------------------------------------
# Back in stock, and following a shop


@method_decorator(csrf_protect, name="dispatch")
class StockAlertView(APIView):
    """ "Tell me when it's back", for a sold-out product. The phone must be
    the signed-in person's or verified in this browser, as for a question,
    so nobody can sign a stranger up for texts."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        from phonenumber_field.phonenumber import to_python

        product = _public_products().filter(pk=pk).first()
        if product is None:
            raise NotFound(_("No such product."))
        if product.availability != Product.Availability.SOLD_OUT:
            return Response({"detail": _("This is not sold out.")}, status=status.HTTP_409_CONFLICT)
        phone = to_python(str(request.data.get("phone") or ""), region="GH")
        if phone is None or not phone.is_valid():
            return Response(
                {"phone": [_("Enter a phone number.")]}, status=status.HTTP_400_BAD_REQUEST
            )
        if not phone_vouched_for(request, phone):
            return Response(
                {"detail": _("Verify this phone number first.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        alerts.wait_for_stock(product, phone)
        return Response(
            {"detail": _("We will text you when it is back.")}, status=status.HTTP_201_CREATED
        )


@method_decorator(csrf_protect, name="dispatch")
class FollowShopView(APIView):
    """Follow a shop to hear about new products. Signed-in buyers only."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def _state(self, request, seller):
        from accounts.auth import own_customer_account

        account = own_customer_account(request)
        following = bool(account and seller.followers.filter(account=account).exists())
        return {
            "following": following,
            "followers": seller.followers.count(),
            "signed_in": account is not None,
        }

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        return Response(self._state(request, _shop(pk)))

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk):
        from accounts.auth import own_customer_account

        from .models import ShopFollow

        seller = _shop(pk)
        account = own_customer_account(request)
        if account is None:
            return Response(
                {"detail": _("Sign in to follow a shop.")}, status=status.HTTP_403_FORBIDDEN
            )
        ShopFollow.objects.get_or_create(account=account, seller=seller)
        return Response(self._state(request, seller))

    @extend_schema(responses={200: None})
    def delete(self, request, pk):
        from accounts.auth import own_customer_account

        seller = _shop(pk)
        account = own_customer_account(request)
        if account is not None:
            seller.followers.filter(account=account).delete()
        return Response(self._state(request, seller))


# --------------------------------------------------------------------------
# Seller tools: copy a product, earnings, featured shops


@method_decorator(csrf_protect, name="dispatch")
class CopyProductView(APIView):
    """A draft copy of one of the seller's products: the same description,
    price, trade, options and photos, for listing similar things quickly.
    The photos point at the same files; removing one from either product
    leaves the other's alone."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        from .models import ProductPhoto
        from .serializers import OwnProductSerializer
        from .views import _unique_slug

        seller = _account(request)
        original = seller.products.filter(pk=pk).prefetch_related("photos", "options").first()
        if original is None:
            raise NotFound(_("No such product."))
        name = _("%(name)s (copy)") % {"name": original.name}
        with transaction.atomic():
            copy = Product.objects.create(
                seller=seller,
                name=name[:200],
                slug=_unique_slug(seller, name),
                description=original.description,
                price=original.price,
                was_price=original.was_price,
                trade=original.trade,
                availability=original.availability,
                status=Product.Status.DRAFT,
            )
            ProductOption.objects.bulk_create(
                ProductOption(
                    product=copy,
                    label=option.label,
                    price=option.price,
                    available=option.available,
                    display_order=option.display_order,
                )
                for option in original.options.all()
            )
            ProductPhoto.objects.bulk_create(
                ProductPhoto(
                    product=copy,
                    image=photo.image.name,
                    caption=photo.caption,
                    display_order=photo.display_order,
                    exif_stripped=True,
                    uploaded_by=request.user,
                )
                for photo in original.photos.all()
            )
        return Response(OwnProductSerializer(copy).data, status=status.HTTP_201_CREATED)


def _month(raw):
    today = timezone.localdate()
    try:
        year, month = (int(part) for part in str(raw or "").split("-"))
        if not 1 <= month <= 12:
            raise ValueError
    except ValueError:
        year, month = today.year, today.month
    return year, month


class SellerEarningsView(APIView):
    """One month of sales: each paid order, Fliiptech's share, the seller's
    share and whether it has reached them. ?download=csv downloads it."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        import csv
        from io import StringIO

        from django.http import HttpResponse

        seller = _account(request)
        year, month = _month(request.query_params.get("month"))
        orders = list(
            seller.orders.filter(
                status=PaymentStatus.PAID, paid_at__year=year, paid_at__month=month
            ).order_by("paid_at")
        )
        rows = [
            {
                "reference": order.reference,
                "paid_at": timezone.localtime(order.paid_at).strftime("%Y-%m-%d"),
                "product": order.product_name,
                "buyer": order.buyer_name,
                "total": order.total_pesewas,
                "paid": order.paid_pesewas,
                "fliiptech": order.commission_pesewas,
                "yours": order.seller_share_pesewas,
                "stage": order.get_stage_display(),
                "payout": order.get_payout_display(),
            }
            for order in orders
        ]
        if request.query_params.get("download") == "csv":
            out = StringIO()
            writer = csv.writer(out)
            writer.writerow(
                [
                    "Order",
                    "Paid on",
                    "What",
                    "Buyer",
                    "Total (GH₵)",
                    "Paid so far (GH₵)",
                    "Fliiptech share (GH₵)",
                    "Your share (GH₵)",
                    "Stage",
                    "Payout",
                ]
            )
            for row in rows:
                writer.writerow(
                    [
                        row["reference"],
                        row["paid_at"],
                        row["product"],
                        row["buyer"],
                        _pesewas(row["total"]),
                        _pesewas(row["paid"]),
                        _pesewas(row["fliiptech"]),
                        _pesewas(row["yours"]),
                        row["stage"],
                        row["payout"],
                    ]
                )
            response = HttpResponse(out.getvalue(), content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = f'attachment; filename="sales-{year}-{month:02d}.csv"'
            return response
        return Response(
            {
                "month": f"{year}-{month:02d}",
                "totals": {
                    "orders": len(rows),
                    "sales": _pesewas(sum(row["total"] for row in rows)),
                    "fliiptech": _pesewas(sum(row["fliiptech"] for row in rows)),
                    "yours": _pesewas(sum(row["yours"] for row in rows)),
                },
                "orders": [
                    {
                        **row,
                        "total": _pesewas(row["total"]),
                        "paid": _pesewas(row["paid"]),
                        "fliiptech": _pesewas(row["fliiptech"]),
                        "yours": _pesewas(row["yours"]),
                    }
                    for row in rows
                ],
            }
        )


class FeaturedShopsView(APIView):
    """Shop plan shops for the home page: up to six, in an order that
    changes each day so none is always first."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        import random

        from .models import SellerAccount
        from .serializers import SellerCardSerializer

        now = timezone.now()
        on_plan = SellerPayment.objects.filter(
            status=PaymentStatus.PAID,
            kind=SellerPayment.Kind.PLAN_MONTH,
            starts_at__lte=now,
            ends_at__gt=now,
        ).values("seller_id")
        sellers = list(
            SellerAccount.objects.filter(pk__in=on_plan, products__in=Product.objects.visible())
            .distinct()
            .select_related("area", "area__region", "provider")
        )
        random.Random(timezone.localdate().toordinal()).shuffle(sellers)
        sellers = sellers[:6]
        covers = {}
        for product in (
            _public_products().filter(seller__in=sellers).order_by("-boosted", "-created_at")
        ):
            if product.seller_id not in covers:
                first = next(iter(product.photos.all()), None)
                covers[product.seller_id] = (
                    public_url(first.image.url, request) if first and first.image else None
                )
        cards = SellerCardSerializer(sellers, many=True, context={"request": request}).data
        for card in cards:
            card["photo"] = covers.get(card["id"])
        return Response({"results": cards})
