"""Learn and buy: a workshop's course and its tool kit, sold together.

A bundle belongs to a shop that is a training workshop, holds that shop's
own products, and (usually) its online course. The buyer pays the shop once
through the usual order (selling_views._create_order), with the bundle's
discount on the whole; when the order is paid the course is unlocked for
the phone that paid (payments.confirm_order -> grant_course).
"""

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.media import public_url

from .models import Bundle, BundleItem, Order, Product
from .views import IsActiveSeller
from .views import _account as _seller_account

MAX_ITEMS = 10
BUNDLE_CODE = "Bundle"


def _offer(bundle):
    """The workshop's course offer, when the bundle includes the course."""
    if not bundle.includes_course or not bundle.seller.provider_id:
        return None
    from courses.access import offer_for

    return offer_for(bundle.seller.provider)


def _pesewas(value):
    return int((Decimal(value) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _cedis(pesewas):
    return f"{pesewas / 100:.2f}"


def bundle_priced(bundle, fulfilment=Order.Fulfilment.PICKUP):
    """The bundle as an order would price it, in price_basket's shape.

    Raises BasketError when something in it can no longer be bought. The
    discount is on everything, course included; commission is on the
    goods' share only, as for any order.
    """
    from .selling_views import BasketError, commission_pesewas

    seller = bundle.seller
    if not bundle.is_active or not seller.provider_id:
        raise BasketError(_("This bundle is not on sale."))
    if seller.is_away:
        raise BasketError(_("This seller is away. Try again when they are back."))
    lines = []
    for item in bundle.items.select_related("product"):
        product = item.product
        buyable = (
            product.seller_id == seller.pk
            and product.price
            and product.availability == Product.Availability.AVAILABLE
            and Product.objects.visible().filter(pk=product.pk).exists()
        )
        if not buyable:
            raise BasketError(
                _("%(name)s in this bundle is not available right now.") % {"name": product.name}
            )
        lines.append(
            {
                "product": product,
                "option": None,
                "unit_price": product.price,
                "quantity": item.quantity,
                "pesewas": int(product.price * 100) * item.quantity,
            }
        )
    if not lines:
        raise BasketError(_("This bundle has nothing in it yet."))
    goods = sum(line["pesewas"] for line in lines)
    offer = _offer(bundle)
    course = _pesewas(offer.current_price) if offer and offer.current_price else 0
    full = goods + course
    discount = int(
        (Decimal(full) * bundle.percent_off / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )
    goods_discount = int((Decimal(discount) * goods / full).quantize(Decimal(1))) if full else 0
    commission = commission_pesewas(goods - goods_discount)
    delivery = (
        int(seller.delivery_fee * 100)
        if fulfilment == Order.Fulfilment.DELIVERY and seller.delivery_fee is not None
        else 0
    )
    total = full - discount + delivery
    return {
        "lines": lines,
        "subtotal": full,
        "discount": discount,
        "code": BUNDLE_CODE,
        "delivery": delivery,
        "total": total,
        "commission": commission,
        "plan": Order.Plan.FULL,
        "pay_now": total,
        "commission_now": commission,
        "balance": 0,
        "balance_commission": 0,
        "student": False,
        "course": course - (discount - goods_discount),
    }


def bundle_payload(bundle, request):
    from courses import paystack

    from .selling_views import BasketError

    offer = _offer(bundle)
    provider = bundle.seller.provider
    items = []
    for item in bundle.items.select_related("product").prefetch_related("product__photos"):
        first = next(iter(item.product.photos.all()), None)
        items.append(
            {
                "product": {
                    "id": item.product.pk,
                    "name": item.product.name,
                    "price": f"{item.product.price:.2f}"
                    if item.product.price is not None
                    else None,
                    "photo": public_url(first.image.url, request)
                    if first and first.image
                    else None,
                },
                "quantity": item.quantity,
            }
        )
    try:
        priced = bundle_priced(bundle)
        problem = ""
    except BasketError as exc:
        priced, problem = None, str(exc)
    payable = bool(priced and paystack.enabled() and bundle.seller.takes_payments)
    return {
        "id": bundle.pk,
        "title": bundle.title,
        "blurb": bundle.blurb,
        "percent_off": bundle.percent_off,
        "is_active": bundle.is_active,
        "includes_course": bool(offer),
        "course": (
            {
                "name": provider.name,
                "price": f"{offer.current_price:.2f}" if offer.current_price else None,
                "path": f"/learn/{provider.area.slug}/{provider.slug}",
                "area_slug": provider.area.slug,
                "slug": provider.slug,
            }
            if offer
            else None
        ),
        "items": items,
        "seller": {"id": bundle.seller_id, "business_name": bundle.seller.business_name},
        "full_price": _cedis(priced["subtotal"]) if priced else None,
        "price": _cedis(priced["subtotal"] - priced["discount"]) if priced else None,
        "saving": _cedis(priced["discount"]) if priced else None,
        "delivery_fee": f"{bundle.seller.delivery_fee:.2f}"
        if bundle.seller.delivery_fee is not None
        else None,
        "buy_online": payable,
        "problem": problem,
    }


def grant_course(order):
    """A paid bundle with the course: the phone that paid gets the course,
    as if bought on its own. Safe to call twice."""
    from courses.models import CoursePurchase
    from trainees.auth import account_for_verified_phone

    bundle = order.bundle
    if bundle is None or not bundle.includes_course or not order.seller.provider_id:
        return None
    trainee = account_for_verified_phone(phone=order.buyer_phone, verified_at=timezone.now())
    purchase, _created = CoursePurchase.objects.get_or_create(
        reference=f"{order.reference}-course"[:40],
        defaults={
            "provider": order.seller.provider,
            "trainee": trainee,
            "amount_pesewas": order.course_pesewas,
            "status": CoursePurchase.Status.PAID,
            "paid_at": timezone.now(),
        },
    )
    return purchase


def _live(queryset):
    return queryset.filter(is_active=True, seller__provider__isnull=False).select_related(
        "seller", "seller__provider", "seller__provider__area"
    )


class BundleView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        bundle = _live(Bundle.objects.filter(pk=pk)).first()
        if bundle is None or not bundle.seller.may_sell:
            raise NotFound(_("No such bundle."))
        return Response(bundle_payload(bundle, request))


class CourseBundlesView(APIView):
    """The bundles a course is sold in: its workshop's shop's active ones."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, area_slug, slug):
        bundles = _live(
            Bundle.objects.filter(
                seller__provider__area__slug=area_slug, seller__provider__slug=slug
            )
        )
        return Response(
            {"results": [bundle_payload(b, request) for b in bundles if b.seller.may_sell]}
        )


class ShopBundlesView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        bundles = _live(Bundle.objects.filter(seller_id=pk))
        return Response(
            {"results": [bundle_payload(b, request) for b in bundles if b.seller.may_sell]}
        )


@method_decorator(csrf_protect, name="dispatch")
class BundleOrderView(APIView):
    """Pay for a bundle: one order to the workshop's shop, through Paystack."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        from .selling_views import _create_order
        from .serializers import BundleOrderInputSerializer

        bundle = _live(Bundle.objects.filter(pk=pk)).first()
        if bundle is None or not bundle.seller.may_sell:
            raise NotFound(_("No such bundle."))
        serializer = BundleOrderInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return _create_order(request, bundle.seller, dict(serializer.validated_data), bundle=bundle)


def _save_items(bundle, seller, raw):
    """Replace a bundle's items; each must be the seller's own product."""
    if not isinstance(raw, list) or not raw or len(raw) > MAX_ITEMS:
        return _("Choose between 1 and %(n)s products.") % {"n": MAX_ITEMS}
    wanted = {}
    for row in raw:
        try:
            product, quantity = int(row["product"]), int(row.get("quantity") or 1)
        except (KeyError, TypeError, ValueError):
            return _("Choose products from your shop.")
        wanted[product] = max(1, min(quantity, 5))
    found = set(seller.products.filter(pk__in=wanted).values_list("pk", flat=True))
    if found != set(wanted):
        return _("Choose products from your shop.")
    bundle.items.all().delete()
    BundleItem.objects.bulk_create(
        BundleItem(bundle=bundle, product_id=pk, quantity=qty) for pk, qty in wanted.items()
    )
    return None


def _apply(bundle, data):
    if "title" in data:
        title = str(data.get("title") or "").strip()[:120]
        if not title:
            return _("Give the bundle a name.")
        bundle.title = title
    if "blurb" in data:
        bundle.blurb = str(data.get("blurb") or "").strip()[:300]
    if "percent_off" in data:
        try:
            percent = int(data.get("percent_off") or 0)
        except (TypeError, ValueError):
            percent = -1
        if not 0 <= percent <= 50:
            return _("The discount is between 0 and 50 percent.")
        bundle.percent_off = percent
    for name in ("includes_course", "is_active"):
        if name in data:
            setattr(bundle, name, bool(data.get(name)))
    return None


@method_decorator(csrf_protect, name="dispatch")
class OwnBundlesView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        seller = _seller_account(request)
        bundles = seller.bundles.select_related(
            "seller", "seller__provider", "seller__provider__area"
        )
        return Response({"results": [bundle_payload(b, request) for b in bundles]})

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        seller = _seller_account(request)
        if not seller.provider_id:
            return Response(
                {"detail": _("Bundles are for shops that are training workshops on the site.")},
                status=status.HTTP_409_CONFLICT,
            )
        with transaction.atomic():
            bundle = Bundle(seller=seller, title="")
            problem = _apply(bundle, {"title": "", **request.data})
            if problem is None:
                bundle.save()
                problem = _save_items(bundle, seller, request.data.get("items"))
            if problem:
                transaction.set_rollback(True)
                return Response({"detail": problem}, status=status.HTTP_400_BAD_REQUEST)
        return Response(bundle_payload(bundle, request), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class OwnBundleView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsActiveSeller]

    def _bundle(self, request, pk):
        bundle = _seller_account(request).bundles.filter(pk=pk).first()
        if bundle is None:
            raise NotFound(_("No such bundle."))
        return bundle

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, pk):
        bundle = self._bundle(request, pk)
        with transaction.atomic():
            problem = _apply(bundle, request.data)
            if problem is None and "items" in request.data:
                problem = _save_items(bundle, bundle.seller, request.data.get("items"))
            if problem:
                transaction.set_rollback(True)
                return Response({"detail": problem}, status=status.HTTP_400_BAD_REQUEST)
            bundle.save()
        return Response(bundle_payload(bundle, request))

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        self._bundle(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
