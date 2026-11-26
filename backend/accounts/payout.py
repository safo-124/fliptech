"""One payout account per person: where their shop's and course's money goes.

    GET  /api/payout-account/        what is saved, and a suggestion to start from
    POST /api/payout-account/check/  "whose is this?" Paystack's name for it
    PUT  /api/payout-account/        save it, once the person said it is theirs

The suggestion is the person's own sign-in number with its network guessed
from the first digits: most people have MoMo on the number they signed up
with, so most type nothing. It is only ever a suggestion. Money going out
to a wallet nobody checked is hard to get back, so the number is always
shown back with the name Paystack has for it ("Is this you?") before it is
saved, and that name is compared with the one staff checked on their ID
(models.PayoutAccount).

Saving it copies it to every role the person has (copy_to_roles): the
shop's Paystack subaccount and transfer recipient, and their course's
subaccount, so the existing payment code needs no second place to look.
"""

import logging
import re

from django.db import transaction
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from courses import paystack

from .models import PayoutAccount

logger = logging.getLogger(__name__)

# The first digits of a Ghanaian mobile number after the 0, by network. A
# number moved to another network keeps its digits, so this is a guess the
# person can change, never a rule.
NETWORK_PREFIXES = {
    "mtn": ("24", "25", "53", "54", "55", "59"),
    "telecel": ("20", "50"),
    "airteltigo": ("26", "27", "56", "57"),
}
# How each network appears in Paystack's list of mobile money "banks".
NETWORK_WORDS = {
    "mtn": ("mtn",),
    "telecel": ("telecel", "vodafone"),
    "airteltigo": ("airtel", "tigo"),
}


def local_number(phone):
    """+233241234567 → 0241234567, the form a MoMo wallet is known by."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("233") and len(digits) == 12:
        return "0" + digits[3:]
    return digits


def guess_network(phone):
    number = local_number(phone)
    if len(number) != 10 or not number.startswith("0"):
        return ""
    return next((net for net, prefixes in NETWORK_PREFIXES.items() if number[1:3] in prefixes), "")


def bank_for_network(banks, network):
    """The code of the mobile money "bank" for a network, or ""."""
    words = NETWORK_WORDS.get(network, ())
    for bank in banks:
        name = bank.get("name", "").lower()
        if bank.get("type") == "mobile_money" and any(word in name for word in words):
            return bank["code"]
    return ""


def _tokens(name):
    return {part for part in re.split(r"[^A-Z]+", (name or "").upper()) if len(part) > 1}


def names_match(account_name, id_name):
    """Whether a wallet's name and an ID's name are the same person's, as far
    as words can say: two names in common, or the one name of a short one.
    "EMMANUEL A. SAFO" matches "Emmanuel Acheampong Safo"."""
    a, b = _tokens(account_name), _tokens(id_name)
    if not a or not b:
        return False
    common = a & b
    return len(common) >= 2 or (len(common) == 1 and min(len(a), len(b)) == 1)


def id_name_for(user):
    """The name staff check on this person's ID: a trainer's full name, once
    their sign-up was confirmed. "" when there is none to compare with."""
    trainer = getattr(user, "trainer_account", None)
    if trainer is not None and trainer.full_name and trainer.is_confirmed:
        return trainer.full_name.strip()
    return ""


def copy_to_roles(payout):
    """Point the person's shop and course at this account.

    The course only while the name is known to be theirs: a course is paid
    by split as it is sold, with no chance to hold the money first. A shop
    can sell meanwhile, because its money is held (trust.holds_payment).
    """
    user = payout.user
    seller = getattr(user, "seller_account", None)
    if seller is not None:
        seller.paystack_subaccount = payout.paystack_subaccount
        seller.paystack_recipient = payout.paystack_recipient
        seller.payout_bank_code = payout.bank_code
        seller.payout_bank_name = payout.bank_name
        seller.payout_account_last4 = payout.account_last4
        seller.payout_account_name = payout.account_name
        seller.save()
    trainer = getattr(user, "trainer_account", None)
    if trainer is None:
        return
    from courses.models import CourseOffer
    from providers.trainer_profiles import owned_profile_queryset

    for provider in owned_profile_queryset(trainer):
        offer, _created = CourseOffer.objects.get_or_create(provider=provider)
        offer.paystack_subaccount = "" if payout.needs_staff else payout.paystack_subaccount
        offer.payout_bank_code = payout.bank_code
        offer.payout_bank_name = payout.bank_name
        offer.payout_account_last4 = payout.account_last4
        offer.payout_account_name = payout.account_name
        offer.save()


def payload(user):
    payout = PayoutAccount.objects.filter(user=user).first()
    account = None
    if payout is not None:
        account = {
            "bank_code": payout.bank_code,
            "bank_name": payout.bank_name,
            "bank_type": payout.bank_type,
            "account_last4": payout.account_last4,
            "account_name": payout.account_name,
            "name_check": payout.name_check,
            "waiting_for_staff": payout.needs_staff,
        }
    phone = _own_phone(user)
    network = guess_network(phone)
    banks = []
    if paystack.enabled():
        try:
            banks = paystack.payout_banks()
        except paystack.PaystackError:
            banks = []
    return {
        "payments_enabled": paystack.enabled(),
        "account": account,
        "suggestion": {
            "number": local_number(phone),
            "network": network,
            "bank_code": bank_for_network(banks, network),
        },
        "banks": banks,
    }


def _own_phone(user):
    for name in ("customer_account", "seller_account", "trainer_account"):
        role = getattr(user, name, None)
        if role is not None and getattr(role, "phone", None):
            return role.phone
    return ""


class IsSignedInPerson(BasePermission):
    message = "Sign in to choose where your money goes."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and not user.is_staff and user.is_active)


def _clean(request):
    bank_code = str(request.data.get("bank_code") or "").strip()
    number = "".join(ch for ch in str(request.data.get("account_number") or "") if ch.isdigit())
    errors = {}
    if not bank_code:
        errors["bank_code"] = [_("Choose your network or bank.")]
    if not 9 <= len(number) <= 20:
        errors["account_number"] = [_("Enter the number of the MoMo wallet or bank account.")]
    return bank_code, number, errors


def _listed():
    return {bank["code"]: bank for bank in paystack.payout_banks()}


@method_decorator(csrf_protect, name="dispatch")
class PayoutCheckView(APIView):
    """Whose is this number? Paystack's name for it, to show back."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsSignedInPerson]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        bank_code, number, errors = _clean(request)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        if not paystack.enabled():
            return Response(
                {"detail": _("Payments are not switched on yet.")},
                status=status.HTTP_409_CONFLICT,
            )
        if is_ratelimited(request, group="payout-check", key="user", rate="20/h", increment=True):
            return Response(
                {"detail": _("Too many checks. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        try:
            listed = _listed()
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if bank_code not in listed:
            return Response(
                {"bank_code": [_("Choose your network or bank from the list.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        name = paystack.resolve_account(account_number=number, bank_code=bank_code)
        return Response(
            {
                "name": name,
                "bank_name": listed[bank_code]["name"],
                "account_last4": number[-4:],
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class PayoutAccountView(APIView):
    """The person's payout account: shown, and saved once they confirmed the
    name on it is theirs."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsSignedInPerson]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(payload(request.user))

    @extend_schema(request=None, responses={200: None})
    def put(self, request):
        bank_code, number, errors = _clean(request)
        confirmed = str(request.data.get("confirmed_name") or "").strip()[:120]
        if not confirmed:
            errors["confirmed_name"] = [_("Say whose account this is.")]
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        if not paystack.enabled():
            return Response(
                {"detail": _("Payments are not switched on yet.")},
                status=status.HTTP_409_CONFLICT,
            )
        if is_ratelimited(request, group="payout-save", key="user", rate="10/h", increment=True):
            return Response(
                {"detail": _("Too many changes. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        try:
            listed = _listed()
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if bank_code not in listed:
            return Response(
                {"bank_code": [_("Choose your network or bank from the list.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Asked again rather than trusted from the check: the name saved is
        # Paystack's, and the person must have seen this one.
        resolved = paystack.resolve_account(account_number=number, bank_code=bank_code)
        if resolved and resolved.upper() != confirmed.upper():
            return Response(
                {
                    "detail": _("The name on this account is %(name)s. Check it again.")
                    % {"name": resolved},
                    "code": "name_changed",
                    "name": resolved,
                },
                status=status.HTTP_409_CONFLICT,
            )
        account_name = resolved or confirmed
        id_name = id_name_for(request.user)
        if not resolved:
            check = PayoutAccount.NameCheck.UNKNOWN
        elif not id_name:
            check = PayoutAccount.NameCheck.NO_ID
        elif names_match(resolved, id_name):
            check = PayoutAccount.NameCheck.MATCHES
        else:
            check = PayoutAccount.NameCheck.DIFFERENT

        existing = PayoutAccount.objects.filter(user=request.user).first()
        seller = getattr(request.user, "seller_account", None)
        try:
            subaccount = paystack.save_subaccount(
                existing_code=(existing.paystack_subaccount if existing else "")
                or (seller.paystack_subaccount if seller else ""),
                business_name=account_name,
                bank_code=bank_code,
                account_number=number,
            )
        except paystack.PaystackError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            recipient = paystack.save_recipient(
                bank_code=bank_code,
                bank_type=listed[bank_code].get("type", ""),
                account_number=number,
                name=account_name,
            )
        except (paystack.PaystackError, KeyError, TypeError) as exc:
            # Needed to hold and then pay out; a split still works without.
            logger.warning("No transfer recipient for user %s: %s", request.user.pk, exc)
            recipient = ""

        with transaction.atomic():
            payout, _created = PayoutAccount.objects.update_or_create(
                user=request.user,
                defaults={
                    "bank_code": bank_code,
                    "bank_name": listed[bank_code]["name"],
                    "bank_type": listed[bank_code].get("type", ""),
                    "account_last4": number[-4:],
                    "account_name": account_name,
                    "id_name": id_name,
                    "name_check": check,
                    # A new account is a new question for staff.
                    "staff_cleared_at": None,
                    "staff_cleared_by": None,
                    "paystack_subaccount": subaccount,
                    "paystack_recipient": recipient,
                },
            )
            copy_to_roles(payout)
        return Response(payload(request.user))
