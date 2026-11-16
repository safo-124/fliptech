"""The shopping basket, shared by the website and the app.

Every rule lives here, once: what may go in (on show, not the buyer's own,
not more than is left), what a line is worth now, what is no longer
available, how one seller's group is priced (marketplace.selling_views.
price_basket, the same function checkout charges by) and how a group is
checked out: paid on the site through Paystack where the seller can take
payments, or sent to the maker to be paid directly where not.

Who owns a basket: the signed-in customer account, or, signed out, a random
token the device keeps and sends as X-Basket-Token. A request that is signed
in and still sends a token has that token's basket merged into the
account's (quantities added, capped at what is left), so verifying a phone
at checkout, which signs the buyer in, keeps everything they chose.
"""

import hashlib
import secrets
from decimal import Decimal

from django.db import transaction
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import extend_schema
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.auth import own_customer_account
from core.media import public_url
from courses import paystack

from .models import Basket, BasketLine, Order, Product, SellerAccount

TOKEN_HEADER = "HTTP_X_BASKET_TOKEN"
# The most of one thing in one order, whatever the stock (as at checkout).
MAX_QUANTITY = 20
# Different things in one basket.
MAX_LINES = 50
UNAVAILABLE = "No longer available"


def _hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def _owns(request, seller):
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated and seller.user_id == user.pk)


def most_of(product):
    """The most of this product one basket may hold: what is left, when the
    seller counts stock, and never more than one order takes."""
    if product.stock is None:
        return MAX_QUANTITY
    return min(MAX_QUANTITY, product.stock)


def unit_price(product, option):
    if option is not None and option.price is not None:
        return option.price
    return product.price


def _merge(into, other, request=None):
    """Lines of `other` join `into`: the same thing adds up, capped at what
    is left; the buyer's own products are left behind."""
    existing = {(line.product_id, line.option_id): line for line in into.lines.all()}
    for line in other.lines.select_related("product", "product__seller"):
        if request is not None and _owns(request, line.product.seller):
            continue
        cap = max(1, most_of(line.product))
        found = existing.get((line.product_id, line.option_id))
        if found is not None:
            found.quantity = min(found.quantity + line.quantity, cap)
            found.save(update_fields=["quantity"])
        elif into.lines.count() < MAX_LINES:
            line.basket = into
            line.quantity = min(line.quantity, cap)
            line.save(update_fields=["basket", "quantity"])
            existing[(line.product_id, line.option_id)] = line


def basket_for(request, create=False):
    """(basket, new_token): the basket this request is about, or None.

    A new token is only ever made for a signed-out device adding its first
    thing; it is returned once, in that response, for the device to keep.
    """
    account = own_customer_account(request)
    raw = (request.META.get(TOKEN_HEADER) or "").strip()
    token_basket = (
        Basket.objects.filter(token_hash=_hash(raw), account__isnull=True).first() if raw else None
    )
    if account is not None:
        basket = Basket.objects.filter(account=account).first()
        if token_basket is not None:
            with transaction.atomic():
                if basket is None:
                    token_basket.account = account
                    token_basket.token_hash = None
                    token_basket.save(update_fields=["account", "token_hash", "updated_at"])
                    basket = token_basket
                    # Their own products, if any, cannot stay.
                    basket.lines.filter(product__seller__user=request.user).delete()
                else:
                    _merge(basket, token_basket, request)
                    token_basket.delete()
        if basket is None and create:
            basket, _created = Basket.objects.get_or_create(account=account)
        return basket, None
    if token_basket is not None or not create:
        return token_basket, None
    raw = secrets.token_urlsafe(24)
    return Basket.objects.create(token_hash=_hash(raw)), raw


def _visible_ids(product_ids):
    return set(Product.objects.visible().filter(pk__in=product_ids).values_list("pk", flat=True))


def line_available(line, visible):
    """False for a product taken off sale, sold out, out of stock, without a
    price, or whose chosen option is no longer offered: such a line stays in
    the basket, marked "No longer available", and counts for nothing."""
    product = line.product
    if product.pk not in visible:
        return False
    if product.availability == Product.Availability.SOLD_OUT:
        return False
    if product.stock is not None and product.stock <= 0:
        return False
    if line.option_id and not (line.option and line.option.available):
        return False
    return unit_price(product, line.option) is not None


def _money(value):
    return f"{Decimal(value):.2f}" if value is not None else None


def _pesewas(value):
    return f"{value / 100:.2f}"


def _lines_of(basket):
    return list(
        basket.lines.select_related(
            "product",
            "option",
            "product__seller",
            "product__seller__area",
            "product__seller__area__region",
            "product__seller__provider",
            "product__seller__provider__area",
        ).prefetch_related("product__photos")
    )


def _line_payload(line, available, takes_payments, request):
    product = line.product
    seller = product.seller
    unit = unit_price(product, line.option)
    first = next(iter(product.photos.all()), None)
    made_to_order = None
    if product.availability == Product.Availability.MADE_TO_ORDER:
        deposit = None
        if takes_payments and seller.deposit_percent and unit is not None:
            deposit = _money(
                (unit * line.quantity * seller.deposit_percent / 100).quantize(Decimal("0.01"))
            )
        made_to_order = {
            "days": product.make_days,
            "deposit_percent": seller.deposit_percent if takes_payments else None,
            "deposit": deposit,
        }
    changed = None
    if (
        available
        and line.price_snapshot is not None
        and unit is not None
        and line.price_snapshot != unit
    ):
        changed = {"from": _money(line.price_snapshot), "to": _money(unit)}
    return {
        "id": line.pk,
        "product": product.pk,
        "option": line.option_id,
        "option_label": line.option.label if line.option else "",
        "name": product.name,
        "photo": public_url(first.image.url, request) if first and first.image else None,
        "unit_price": _money(unit),
        "quantity": line.quantity,
        "max_quantity": max(1, most_of(product)),
        # "Only N left", when the seller counts stock and few remain.
        "few_left": product.stock if product.stock is not None and 0 < product.stock <= 5 else None,
        "line_total": _money(unit * line.quantity) if available and unit is not None else None,
        "available": available,
        "unavailable_reason": "" if available else _(UNAVAILABLE),
        "made_to_order": made_to_order,
        "price_changed": changed,
    }


def _priced_totals(seller, items, fulfilment, request):
    """One way of handing over, priced by the same function checkout uses."""
    from .selling_views import price_basket
    from .students import student_discount_for, who_is_asking

    priced = price_basket(
        seller,
        {"items": items, "fulfilment": fulfilment},
        student_percent=student_discount_for(seller, who_is_asking(request)),
    )
    return {
        "subtotal": _pesewas(priced["subtotal"]),
        "discount": _pesewas(priced["discount"]),
        "delivery": _pesewas(priced["delivery"]),
        "total": _pesewas(priced["total"]),
        "pay_now": _pesewas(priced["pay_now"]),
        "balance": _pesewas(priced["balance"]),
        "plan": priced["plan"],
    }


def _direct_totals(seller, lines, fulfilment):
    """A maker paid directly: what it comes to at the listed prices, which
    is what the order sent to them says."""
    subtotal = sum((unit_price(line.product, line.option) or 0) * line.quantity for line in lines)
    delivery = (
        seller.delivery_fee
        if fulfilment == Order.Fulfilment.DELIVERY and seller.delivery_fee is not None
        else Decimal(0)
    )
    return {
        "subtotal": _money(subtotal),
        "discount": "0.00",
        "delivery": _money(delivery),
        "total": _money(subtotal + delivery),
        "pay_now": "0.00",
        "balance": _money(subtotal + delivery),
        "plan": Order.Plan.DIRECT,
    }


def _group_payload(seller, lines, visible, request):
    from .selling_views import BasketError
    from .serializers import SellerCardSerializer, pickup_point

    takes_payments = bool(paystack.enabled() and seller.takes_payments)
    rows, buyable = [], []
    for line in lines:
        available = line_available(line, visible)
        rows.append(_line_payload(line, available, takes_payments, request))
        if available:
            buyable.append(line)
    totals = {"pickup": None, "delivery": None}
    problem = ""
    if buyable:
        items = [
            {"product": line.product_id, "option": line.option_id, "quantity": line.quantity}
            for line in buyable
        ]
        ways = [Order.Fulfilment.PICKUP]
        if seller.delivery_fee is not None:
            ways.append(Order.Fulfilment.DELIVERY)
        for way in ways:
            if takes_payments:
                try:
                    totals[way] = _priced_totals(seller, items, way, request)
                except BasketError as exc:
                    problem = str(exc)
                    break
            else:
                totals[way] = _direct_totals(seller, buyable, way)
    pickup = totals["pickup"]
    return {
        "seller": SellerCardSerializer(seller).data,
        "pickup": pickup_point(seller),
        "delivery": (
            {"fee": _money(seller.delivery_fee), "area": seller.delivery_area}
            if seller.delivery_fee is not None
            else None
        ),
        "takes_payments": takes_payments,
        "lines": rows,
        "subtotal": pickup["subtotal"] if pickup else "0.00",
        "total": pickup["total"] if pickup else "0.00",
        "totals": totals,
        "problem": problem,
    }


def basket_payload(basket, request, token=None, notice=""):
    """The basket grouped by seller, in the order things were first added."""
    if basket is None:
        return {"token": token, "count": 0, "groups": [], "notice": notice}
    lines = _lines_of(basket)
    visible = _visible_ids([line.product_id for line in lines])
    # Stock fell since it was put in: hold the line to what is left.
    for line in lines:
        cap = most_of(line.product)
        if line_available(line, visible) and 0 < cap < line.quantity:
            line.quantity = cap
            line.save(update_fields=["quantity"])
            notice = notice or _("Only %(count)s %(name)s left.") % {
                "count": cap,
                "name": line.product.name,
            }
    groups, order = {}, []
    for line in lines:
        seller_id = line.product.seller_id
        if seller_id not in groups:
            groups[seller_id] = []
            order.append(line.product.seller)
        groups[seller_id].append(line)
    payload = [_group_payload(seller, groups[seller.pk], visible, request) for seller in order]
    count = sum(
        line["quantity"] for group in payload for line in group["lines"] if line["available"]
    )
    return {"token": token, "count": count, "groups": payload, "notice": notice}


# --------------------------------------------------------------------------
# Endpoints


class AddSerializer(serializers.Serializer):
    product = serializers.IntegerField()
    option = serializers.IntegerField(required=False, allow_null=True)
    quantity = serializers.IntegerField(min_value=1, default=1)


class QuantitySerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1)


class MergeSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=100)


class CheckoutSerializer(serializers.Serializer):
    phone = PhoneNumberField()
    name = serializers.CharField(max_length=120)
    fulfilment = serializers.ChoiceField(choices=Order.Fulfilment.choices, default="pickup")
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)
    code = serializers.CharField(max_length=30, required=False, allow_blank=True)
    pay_at_collection = serializers.BooleanField(required=False, default=False)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_("Say who the order is for."))
        return value

    def validate(self, attrs):
        if attrs["fulfilment"] == Order.Fulfilment.DELIVERY and not attrs.get("note", "").strip():
            raise serializers.ValidationError({"note": _("Say where it should be delivered.")})
        return attrs


class _BasketAPIView(APIView):
    # The app's token is turned into request.user by AppTokenMiddleware and
    # excused CSRF; the website's session is checked for it as everywhere.
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]


@method_decorator(csrf_protect, name="dispatch")
class BasketView(_BasketAPIView):
    """GET the basket; DELETE empties it."""

    @extend_schema(responses={200: None})
    def get(self, request):
        basket, _token = basket_for(request)
        return Response(basket_payload(basket, request))

    @extend_schema(responses={200: None})
    def delete(self, request):
        basket, _token = basket_for(request)
        if basket is not None:
            basket.lines.all().delete()
        return Response(basket_payload(basket, request))


@method_decorator(csrf_protect, name="dispatch")
class BasketItemsView(_BasketAPIView):
    """POST {product, option?, quantity?}: put it in, or add to what is
    there. More than is left is held to what is left, and said."""

    @extend_schema(request=AddSerializer, responses={200: None})
    def post(self, request):
        serializer = AddSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        product = (
            Product.objects.visible().select_related("seller").filter(pk=data["product"]).first()
        )
        if product is None:
            raise NotFound(_("No such product."))
        if _owns(request, product.seller):
            return Response(
                {"detail": _("This is your own item, so you cannot buy it."), "code": "own_item"},
                status=status.HTTP_403_FORBIDDEN,
            )
        option = None
        options = list(product.options.all())
        if data.get("option"):
            option = next((o for o in options if o.pk == data["option"] and o.available), None)
            if option is None:
                return Response(
                    {"detail": _("That choice is not available.")},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif any(o.available for o in options):
            return Response(
                {"detail": _("Choose which %(name)s you want.") % {"name": product.name}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cap = most_of(product)
        if (
            product.availability == Product.Availability.SOLD_OUT
            or cap <= 0
            or unit_price(product, option) is None
        ):
            return Response(
                {"detail": _("%(name)s is sold out.") % {"name": product.name}},
                status=status.HTTP_409_CONFLICT,
            )
        basket, token = basket_for(request, create=True)
        notice = ""
        with transaction.atomic():
            line = basket.lines.filter(product=product, option=option).first()
            wanted = data["quantity"] + (line.quantity if line else 0)
            if wanted > cap:
                notice = _("Only %(count)s left.") % {"count": cap}
            if line is None:
                if basket.lines.count() >= MAX_LINES:
                    return Response(
                        {"detail": _("Your basket is full. Check out or remove something first.")},
                        status=status.HTTP_409_CONFLICT,
                    )
                BasketLine.objects.create(
                    basket=basket,
                    product=product,
                    option=option,
                    quantity=min(wanted, cap),
                    price_snapshot=unit_price(product, option),
                )
            else:
                line.quantity = min(wanted, cap)
                line.save(update_fields=["quantity"])
        return Response(basket_payload(basket, request, token=token, notice=notice))


@method_decorator(csrf_protect, name="dispatch")
class BasketLineView(_BasketAPIView):
    """PATCH {quantity} sets how many (1 up to what is left); DELETE removes."""

    def _line(self, request, pk):
        basket, _token = basket_for(request)
        line = (
            basket.lines.select_related("product").filter(pk=pk).first()
            if basket is not None
            else None
        )
        if line is None:
            raise NotFound(_("That is not in your basket."))
        return basket, line

    @extend_schema(request=QuantitySerializer, responses={200: None})
    def patch(self, request, pk):
        serializer = QuantitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        basket, line = self._line(request, pk)
        cap = most_of(line.product)
        quantity = serializer.validated_data["quantity"]
        if quantity > cap:
            return Response(
                {
                    "detail": _("Only %(count)s left.") % {"count": max(cap, 0)},
                    "basket": basket_payload(basket, request),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        line.quantity = quantity
        line.save(update_fields=["quantity"])
        return Response(basket_payload(basket, request))

    @extend_schema(responses={200: None})
    def delete(self, request, pk):
        basket, line = self._line(request, pk)
        line.delete()
        return Response(basket_payload(basket, request))


@method_decorator(csrf_protect, name="dispatch")
class BasketMergeView(_BasketAPIView):
    """POST {token}: a signed-out device's basket joins the signed-in
    account's, quantities added and held to what is left. (A request that
    sends X-Basket-Token while signed in is merged without asking.)"""

    @extend_schema(request=MergeSerializer, responses={200: None})
    def post(self, request):
        if own_customer_account(request) is None:
            return Response({"detail": _("Sign in first.")}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = MergeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request.META[TOKEN_HEADER] = serializer.validated_data["token"]
        basket, _token = basket_for(request, create=True)
        return Response(basket_payload(basket, request))


@method_decorator(csrf_protect, name="dispatch")
class BasketCheckoutView(_BasketAPIView):
    """Check out one seller's group of the basket.

    Prices are read again first: a line whose price changed since it went
    in stops the checkout (409, code "price_changed") with the basket
    showing "Price changed from GH₵X to GH₵Y"; the next try goes ahead at
    the new price.

    A seller who takes payments on the site: an order is made and Paystack
    started for it ({"kind": "pay", "authorization_url", "reference"}); the
    lines stay in the basket until it is paid, so a failed or cancelled
    payment comes back to the basket as it was.

    A seller who does not: the order goes to them to be paid directly
    ({"kind": "direct", ...the order, "conversation_id"}), they are texted
    and see it in Orders and the chat, and the lines leave the basket.
    """

    @extend_schema(request=CheckoutSerializer, responses={201: None})
    def post(self, request, seller_id):
        from .selling_views import _create_order, create_direct_order

        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        seller = SellerAccount.objects.filter(pk=seller_id).first()
        if seller is None or not seller.may_sell:
            raise NotFound(_("No such seller."))
        if _owns(request, seller):
            return Response(
                {
                    "detail": _("This is your own shop, so you cannot buy from it."),
                    "code": "own_item",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        basket, _token = basket_for(request)
        lines = [
            line
            for line in (_lines_of(basket) if basket is not None else [])
            if line.product.seller_id == seller.pk
        ]
        visible = _visible_ids([line.product_id for line in lines])
        buyable = [line for line in lines if line_available(line, visible)]
        if not buyable:
            return Response(
                {"detail": _("Nothing from this seller can be ordered now.")},
                status=status.HTTP_409_CONFLICT,
            )
        for line in buyable:
            if line.quantity > most_of(line.product):
                return Response(
                    {
                        "detail": _("Only %(count)s %(name)s left.")
                        % {"count": most_of(line.product), "name": line.product.name},
                        "basket": basket_payload(basket, request),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
        changed = [
            line
            for line in buyable
            if line.price_snapshot is not None
            and line.price_snapshot != unit_price(line.product, line.option)
        ]
        if changed:
            shown = basket_payload(basket, request)
            for line in changed:
                line.price_snapshot = unit_price(line.product, line.option)
                line.save(update_fields=["price_snapshot"])
            return Response(
                {
                    "detail": _(
                        "A price changed since you added it. Check the total and try again."
                    ),
                    "code": "price_changed",
                    "basket": shown,
                },
                status=status.HTTP_409_CONFLICT,
            )

        if paystack.enabled() and seller.takes_payments:
            response = _create_order(
                request,
                seller,
                {
                    "items": [
                        {
                            "product": line.product_id,
                            "option": line.option_id,
                            "quantity": line.quantity,
                        }
                        for line in buyable
                    ],
                    "fulfilment": data["fulfilment"],
                    "code": data.get("code", ""),
                    "pay_at_collection": data.get("pay_at_collection", False),
                    "phone": data["phone"],
                    "name": data["name"],
                    "note": data.get("note", ""),
                },
            )
            if response.status_code == status.HTTP_201_CREATED:
                response.data["kind"] = "pay"
            return response

        response = create_direct_order(
            request,
            seller,
            [
                {"product": line.product, "option": line.option, "quantity": line.quantity}
                for line in buyable
            ],
            phone=data["phone"],
            name=data["name"],
            fulfilment=data["fulfilment"],
            note=data.get("note", ""),
        )
        if response.status_code == status.HTTP_201_CREATED:
            BasketLine.objects.filter(pk__in=[line.pk for line in buyable]).delete()
            response.data["kind"] = "direct"
        return response


def clear_paid_lines(request, order):
    """Once an order is paid, what it bought leaves the buyer's basket: the
    basket of whoever is looking at the paid order, and the basket of the
    account whose phone paid. (Unpaid, the lines stay, so a failed payment
    goes back to the basket as it was.)"""
    from accounts.models import CustomerAccount

    if order.status != "paid" or order.plan == Order.Plan.DIRECT:
        return
    items = list(order.items.values_list("product_id", flat=True))
    baskets = []
    basket, _token = basket_for(request)
    if basket is not None:
        baskets.append(basket.pk)
    account = CustomerAccount.objects.filter(phone=order.buyer_phone, is_active=True).first()
    if account is not None:
        baskets.extend(Basket.objects.filter(account=account).values_list("pk", flat=True))
    if baskets and items:
        BasketLine.objects.filter(basket_id__in=baskets, product_id__in=items).delete()
