"""Paying for a basket with several sellers in one payment.

The buyer sees one total and approves one MoMo prompt. Behind it:

  - each seller gets their own Order (selling_views.save_order), exactly as
    if it had been checked out alone: their dashboard, buyer protection,
    problems and refunds stay per seller;
  - one CheckoutPayment ties them together and is what Paystack charges;
  - Paystack splits the charge as it is paid (courses/paystack.split_for):
    each seller paid by split gets their share, and Fliiptech's account
    keeps its commission and the shares of sellers whose money is held until
    the buyer has the goods (payouts.py sends those on later).

Only sellers who take payment on the site can be in it. A maker paid
directly is still sent their order from their own part of the basket.
Discount codes and paying part on collection stay with one seller's own
checkout, where the buyer sees that seller's terms.
"""

import logging

from django.conf import settings
from django.db import transaction
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.app_auth import payment_return
from appsupport.notify import notify
from core.identities import phone_vouched_for, signed_in_phones
from core.network import ratelimit_client_ip
from core.sms import send_sms
from courses import paystack

from .basket import _BasketAPIView, basket_for, clear_paid_lines, ready_lines
from .models import CheckoutPayment, Order, PaymentStatus, SellerAccount, payment_reference
from .payments import _apply, confirm_order, payer_email
from .serializers import OrderSerializer

logger = logging.getLogger(__name__)

SESSION_CHECKOUTS = "marketplace_checkouts"
# Sellers in one payment: a basket holds at most this many groups anyway.
MAX_SELLERS = 10


class GroupChoiceSerializer(serializers.Serializer):
    seller = serializers.IntegerField()
    fulfilment = serializers.ChoiceField(choices=Order.Fulfilment.choices, default="pickup")


class CheckoutAllSerializer(serializers.Serializer):
    """What the buyer sends: who they are, where to deliver, and how each
    seller hands their part over."""

    phone = PhoneNumberField()
    name = serializers.CharField(max_length=120)
    # Where to deliver, for the sellers who deliver; anything else to know.
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)
    groups = GroupChoiceSerializer(many=True)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_("Say who the order is for."))
        return value

    def validate(self, attrs):
        groups = attrs["groups"]
        if not groups:
            raise serializers.ValidationError({"groups": _("Choose what to pay for.")})
        if len(groups) > MAX_SELLERS:
            raise serializers.ValidationError({"groups": _("That is too many sellers at once.")})
        if len({g["seller"] for g in groups}) != len(groups):
            raise serializers.ValidationError({"groups": _("Each seller once.")})
        delivers = any(g["fulfilment"] == Order.Fulfilment.DELIVERY for g in groups)
        if delivers and not attrs.get("note", "").strip():
            raise serializers.ValidationError({"note": _("Say where it should be delivered.")})
        return attrs


def _refused(detail, code="", http=status.HTTP_409_CONFLICT, **more):
    payload = {"detail": detail, **more}
    if code:
        payload["code"] = code
    return Response(payload, status=http)


@method_decorator(csrf_protect, name="dispatch")
class BasketCheckoutAllView(_BasketAPIView):
    """Pay several sellers' parts of the basket in one payment.

    201 {"kind": "pay", "authorization_url", "reference"} (the checkout's
    reference: the receipt page asks about it on the way back). Anything
    that stops one seller's part stops the whole payment, saying which, so
    nobody pays for less than they think.
    """

    @extend_schema(request=CheckoutAllSerializer, responses={201: None})
    def post(self, request):
        from .selling_views import BasketError, buying_own, holds_payment, price_basket, save_order
        from .students import student_discount_for
        from .trust import over_new_seller_limit

        serializer = CheckoutAllSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not paystack.enabled():
            return _refused(_("Payments are not switched on yet."))
        if not phone_vouched_for(request, data["phone"]):
            return _refused(
                _("Verify this phone number before paying."), http=status.HTTP_403_FORBIDDEN
            )
        if is_ratelimited(
            request, group="product-order", key=ratelimit_client_ip, rate="20/h", increment=True
        ):
            return _refused(
                _("Too many attempts. Try again later."), http=status.HTTP_429_TOO_MANY_REQUESTS
            )

        basket, _token = basket_for(request)
        sellers = {
            s.pk: s
            for s in SellerAccount.objects.filter(pk__in=[g["seller"] for g in data["groups"]])
        }
        note = data.get("note", "").strip()
        parts = []
        for choice in data["groups"]:
            seller = sellers.get(choice["seller"])
            if seller is None or not seller.may_sell:
                raise NotFound(_("No such seller."))
            if buying_own(request, seller):
                return _refused(
                    _("%(seller)s is your own shop, so you cannot buy from it.")
                    % {"seller": seller.business_name},
                    "own_item",
                    status.HTTP_403_FORBIDDEN,
                )
            if not seller.takes_payments:
                return _refused(
                    _("%(seller)s does not take payment on the site. Send them your order instead.")
                    % {"seller": seller.business_name},
                    "direct",
                )
            lines, refusal = ready_lines(request, basket, seller)
            if refusal is not None:
                refusal.data["seller"] = seller.pk
                return refusal
            fulfilment = choice["fulfilment"]
            if fulfilment == Order.Fulfilment.DELIVERY and seller.delivery_fee is None:
                fulfilment = Order.Fulfilment.PICKUP
            order_data = {
                "items": [
                    {
                        "product": line.product_id,
                        "option": line.option_id,
                        "quantity": line.quantity,
                    }
                    for line in lines
                ],
                "fulfilment": fulfilment,
                "phone": data["phone"],
                "name": data["name"],
                "note": note if fulfilment == Order.Fulfilment.DELIVERY else "",
            }
            try:
                priced = price_basket(
                    seller, order_data, student_percent=student_discount_for(seller, request.user)
                )
            except BasketError as exc:
                return _refused(f"{seller.business_name}: {exc}", seller=seller.pk)
            limit = over_new_seller_limit(seller, priced["total"])
            if limit:
                return _refused(
                    _(
                        "%(seller)s is new on the site, so orders are limited to GH₵%(limit)s "
                        "for now. Buy less from them at once."
                    )
                    % {"seller": seller.business_name, "limit": limit},
                    seller=seller.pk,
                )
            parts.append((seller, priced, order_data))

        with transaction.atomic():
            payment = CheckoutPayment.objects.create(
                reference=payment_reference("fg"),
                buyer_phone=data["phone"],
                buyer_name=data["name"],
                amount_pesewas=sum(priced["pay_now"] for _seller, priced, _data in parts),
            )
            shares = {}
            for seller, priced, order_data in parts:
                held = holds_payment(seller, priced["pay_now"])
                save_order(request, seller, priced, order_data, held=held, checkout=payment)
                if not held:
                    # Paid by split: their part of this payment, less
                    # Fliiptech's share of it (a deposit carries its part).
                    shares[seller.paystack_subaccount] = (
                        priced["pay_now"] - priced["commission_now"]
                    )
            payment.split = paystack.split_for(shares) if shares else {}
            payment.save(update_fields=["split", "updated_at"])

        request.session[SESSION_CHECKOUTS] = [
            *request.session.get(SESSION_CHECKOUTS, [])[-19:],
            payment.reference,
        ]
        try:
            url = paystack.initialize(
                email=payer_email(None, payment.buyer_phone),
                amount_pesewas=payment.amount_pesewas,
                reference=payment.reference,
                callback_url=payment_return(
                    request,
                    f"{settings.PUBLIC_SITE_URL.rstrip('/')}/marketplace/receipt/{payment.reference}",
                ),
                # No split at all: every seller is held, so it is all
                # Fliiptech's until each is sent on.
                split=payment.split or None,
                metadata={"sellers": len(parts), "kind": "basket"},
            )
        except paystack.PaystackError as exc:
            _fail(payment, str(exc))
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(
            {"kind": "pay", "authorization_url": url, "reference": payment.reference},
            status=status.HTTP_201_CREATED,
        )


def _fail(payment, why):
    payment.status = PaymentStatus.FAILED
    payment.gateway_response = why[:200]
    payment.save(update_fields=["status", "gateway_response", "updated_at"])
    payment.orders.filter(status=PaymentStatus.PENDING).update(
        status=PaymentStatus.FAILED, gateway_response=why[:200]
    )


def confirm_checkout(reference, data):
    """Paystack's word on one payment for several sellers.

    The payment is checked like every other (exactly this amount, in cedis),
    then each order in it is confirmed as if paid on its own, for its own
    amount, so stock, the seller's text and buyer protection all run as
    they always do. The buyer gets one receipt, not one per seller.
    """
    with transaction.atomic():
        payment = CheckoutPayment.objects.select_for_update().filter(reference=reference).first()
        if payment is None or payment.status == PaymentStatus.PAID:
            return payment
        paid = _apply(payment, data)
        payment.save()
    if payment.status == PaymentStatus.FAILED:
        payment.orders.filter(status=PaymentStatus.PENDING).update(
            status=PaymentStatus.FAILED, gateway_response=payment.gateway_response
        )
        return payment
    if not paid:
        return payment
    for order in payment.orders.all():
        confirm_order(
            order.reference,
            {
                "status": "success",
                "amount": order.amount_pesewas,
                "currency": order.currency,
                "gateway_response": payment.gateway_response,
                "channel": payment.channel,
            },
            tell_buyer=False,
        )
    transaction.on_commit(lambda: tell_buyer(payment))
    return payment


def tell_buyer(payment):
    """One receipt by text for the whole payment, with each seller's order."""
    orders = list(payment.orders.select_related("seller"))
    parts = "; ".join(f"{order.seller.business_name} ({order.reference})" for order in orders)
    try:
        notify(
            payment.buyer_phone,
            f"{settings.BRAND_NAME}: you paid GH₵{payment.amount_pesewas / 100:.2f} for "
            f"{len(orders)} orders: {parts}. Receipt {payment.reference}. Each seller will "
            f"contact you to hand it over.",
            sms="always",
            link=f"/marketplace/receipt/{payment.reference}",
            send=send_sms,
        )
    except Exception:  # A receipt that fails to send must not undo a payment.
        logger.exception("Could not text the receipt for %s", payment.reference)


def receipt_payload(payment):
    return {
        "reference": payment.reference,
        "status": payment.status,
        "amount": f"{payment.amount_pesewas / 100:.2f}",
        "paid_at": payment.paid_at,
        "buyer_name": payment.buyer_name,
        "orders": OrderSerializer(
            payment.orders.select_related("seller").prefetch_related("items"), many=True
        ).data,
    }


def _buyers_checkout(request, reference):
    payment = CheckoutPayment.objects.filter(reference=reference).first()
    if payment is None or (
        reference not in request.session.get(SESSION_CHECKOUTS, [])
        and str(payment.buyer_phone) not in signed_in_phones(request)
    ):
        raise NotFound(_("No such payment."))
    return payment


@method_decorator(csrf_protect, name="dispatch")
class CheckoutReceiptView(APIView):
    """One payment for several sellers, as its buyer sees it. POST asks
    Paystack how it went, for a buyer just back from paying."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, reference):
        return Response(receipt_payload(_buyers_checkout(request, reference)))

    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference):
        payment = _buyers_checkout(request, reference)
        if payment.status == PaymentStatus.PENDING:
            try:
                payment = confirm_checkout(reference, paystack.verify(reference)) or payment
            except paystack.PaystackError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        if payment.status == PaymentStatus.PAID:
            for order in payment.orders.all():
                clear_paid_lines(request, order)
        return Response(receipt_payload(payment))
