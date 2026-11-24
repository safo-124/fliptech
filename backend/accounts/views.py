"""The account API: one sign-in for everyone, and what a customer sees.

  /api/account/                 who is signed in, what they hold; PATCH details
  /api/account/request-code/    send a sign-in code to a phone
  /api/account/verify-code/     sign in (an account is made on first use)
  /api/account/logout/
  /api/account/orders/          orders paid with this account's phone
  /api/account/questions/       questions asked about products with it
  /api/account/saved/           saved products; PUT merges the browser's list
  /api/account/roles/<role>/    become a trainee, a trainer or a seller

Being a trainee, trainer or seller is added to the same login. A trainer or
seller added here starts unconfirmed, exactly as through their own sign-up
pages, and staff confirm them as before.
"""

import contextlib
import logging

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from core.identities import roles_of
from core.images import validate_image_upload
from core.media import public_url
from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries.models import PhoneVerification
from enquiries.otp import OTPError, request_code, verify_code

from .auth import AccountDisabled, account_for_verified_phone, own_customer_account
from .models import BagLine, CustomerAccount, DeliveryAddress, SavedProduct

logger = logging.getLogger(__name__)

PURPOSE = PhoneVerification.Purpose.ACCOUNT_ACCESS


class CodeRequestSerializer(serializers.Serializer):
    phone = PhoneNumberField()
    # "register" from the website's Create your account page: a number that
    # already has an account is told so and sent to sign in, with no code.
    # Everything else (sign in, the app) leaves it out and works as before.
    intent = serializers.ChoiceField(
        choices=["sign_in", "register"], required=False, default="sign_in"
    )


def number_has_account(phone):
    """Whether this phone already belongs to someone: a customer account, or a
    trainee, trainer or seller login it would sign in to."""
    from core.identities import person_user

    return CustomerAccount.objects.filter(phone=phone).exists() or person_user(phone) is not None


class CodeVerifySerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    phone = PhoneNumberField()
    code = serializers.RegexField(r"^\d{4,8}$")
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)


class AccountSerializer(serializers.ModelSerializer):
    phone = serializers.CharField(read_only=True)

    def validate_display_name(self, value):
        from core.placeholders import name_problem

        problem = name_problem(value)
        if problem:
            raise serializers.ValidationError(problem)
        return value.strip()

    def validate_email(self, value):
        value = (value or "").strip().lower() or None
        if (
            value
            and CustomerAccount.objects.filter(email=value).exclude(pk=self.instance.pk).exists()
        ):
            raise serializers.ValidationError(_("Another account already uses that address."))
        return value

    photo = serializers.SerializerMethodField()
    # Optional on the request, but when sent (by the welcome screen after
    # signing up) at least one has to be ticked.
    interests = serializers.ListField(
        child=serializers.ChoiceField(choices=CustomerAccount.INTERESTS),
        required=False,
        allow_empty=False,
        max_length=len(CustomerAccount.INTERESTS),
        error_messages={"empty": _("Tick at least one of the choices to continue.")},
    )

    def validate_interests(self, value):
        # Kept in a fixed order, once each, whatever order they were ticked in.
        return [interest for interest in CustomerAccount.INTERESTS if interest in value]

    def get_photo(self, obj):
        return public_url(obj.photo.url, self.context.get("request")) if obj.photo else None

    has_password = serializers.SerializerMethodField()
    email_verified = serializers.SerializerMethodField()
    phone_verified = serializers.SerializerMethodField()

    def get_has_password(self, obj) -> bool:
        """False for an account made with a phone code: it can set one."""
        return obj.user.has_usable_password()

    def get_email_verified(self, obj) -> bool:
        return obj.email_verified_at is not None

    def get_phone_verified(self, obj) -> bool:
        """False for a number given at password sign-up and never proven."""
        return obj.phone_verified_at is not None

    class Meta:
        model = CustomerAccount
        fields = [
            "phone",
            "display_name",
            "email",
            "delivery_address",
            "photo",
            "interests",
            "created_at",
            "has_password",
            "email_verified",
            "phone_verified",
        ]
        read_only_fields = ["phone", "photo", "created_at"]


def _roles(user):
    """What this login holds, and the state of each, for the account page."""
    held = set(roles_of(user))
    payload = {"trainee": None, "trainer": None, "seller": None}
    if "trainee_account" in held and user.trainee_account.is_active:
        payload["trainee"] = {"href": "/account/learning"}
    if "trainer_account" in held and user.trainer_account.is_active:
        payload["trainer"] = {
            "href": "/trainer/dashboard",
            "status": user.trainer_account.approval_status,
        }
    if "seller_account" in held and user.seller_account.is_active:
        payload["seller"] = {
            "id": user.seller_account.pk,
            "href": "/sell/shop",
            "status": user.seller_account.approval_status,
        }
    return payload


def account_payload(request):
    # Whether "Send me a code" is offered, besides phone or email and a password.
    methods = {"code": settings.PHONE_CODE_SIGN_IN}
    account = own_customer_account(request)
    if account is None:
        return {"authenticated": False, "account": None, "roles": None, "sign_in": methods}
    return {
        "authenticated": True,
        "account": AccountSerializer(account, context={"request": request}).data,
        "roles": _roles(request.user),
        "sign_in": methods,
    }


class IsCustomer(BasePermission):
    message = "Sign in with your phone number to see this page."

    def has_permission(self, request, view):
        return own_customer_account(request) is not None


def _account(request):
    account = own_customer_account(request)
    if account is None:
        raise PermissionDenied(_("Sign in with your phone number to see this page."))
    return account


@method_decorator(ensure_csrf_cookie, name="dispatch")
class AccountView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        get_token(request._request)
        return Response(account_payload(request))

    @extend_schema(request=AccountSerializer, responses={200: None})
    def patch(self, request):
        account = _account(request)
        serializer = AccountSerializer(account, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if (
            "email" in serializer.validated_data
            and serializer.validated_data["email"] != account.email
        ):
            # A new address is not proven until the link sent to it is opened.
            serializer.validated_data["email_verified_at"] = None
        changed_email = serializer.validated_data.get("email_verified_at", "kept") is None
        serializer.save()
        if changed_email and account.email:
            from .passwords import send_confirm_email

            transaction.on_commit(lambda: send_confirm_email(account))
        # The learning pages show the same name and email (one profile).
        from .profile_sync import push_to_trainee

        push_to_trainee(account)
        # "Learn a trade" makes them a trainee straight away, on this login,
        # so a course started next needs no second sign-in. (Selling still
        # goes through the seller's own steps: staff confirm sellers.)
        if "learn" in serializer.validated_data.get("interests", []):
            # A trainee login switched off by staff stays off.
            with contextlib.suppress(ValueError):
                _add_role(request, account, "trainee")
        return Response(account_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class CodeRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=CodeRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = CodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
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
        # Counted by the limit above, so it cannot be used to check numbers
        # in bulk; no code is sent, so it costs no text either.
        if serializer.validated_data["intent"] == "register" and number_has_account(
            serializer.validated_data["phone"]
        ):
            return Response(
                {
                    "detail": _("This number already has an account. Sign in instead."),
                    "code": "account_exists",
                },
                status=status.HTTP_409_CONFLICT,
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
                # So the code screen can say "the 6-digit code".
                "code_length": settings.OTP_CODE_LENGTH,
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class CodeVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=CodeVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = CodeVerifySerializer(data=request.data)
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
        try:
            verification = verify_code(
                serializer.validated_data["phone"],
                serializer.validated_data["code"],
                purpose=PURPOSE,
                challenge_id=serializer.validated_data["challenge_id"],
            )
            account = account_for_verified_phone(
                phone=verification.phone, verified_at=verification.verified_at
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except AccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        name = (serializer.validated_data.get("name") or "").strip()
        if name and not account.display_name:
            account.display_name = name[:120]
            account.save(update_fields=["display_name", "updated_at"])

        # login() cycles the session key, preventing session fixation.
        login(request._request, account.user, backend="django.contrib.auth.backends.ModelBackend")
        request.user = account.user
        get_token(request._request)
        return Response({**account_payload(request), "joined": account._just_created})


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        logout(request._request)
        return Response({"authenticated": False, "account": None, "roles": None})


class CloseView(APIView):
    """Delete the whole account: shop, workshop and all. accounts/removal.py
    says what goes and the few money records that stay, emptied."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        from .removal import CannotRemove, remove_login

        if request.data.get("confirm") is not True:
            return Response(
                {"detail": _("Confirm that you want to delete your account.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = request.user
        # A password account proves it is the person, not someone at an
        # unlocked phone. An account that only ever used codes has none.
        if user.has_usable_password() and not user.check_password(
            str(request.data.get("password") or "")
        ):
            return Response(
                {"detail": _("That password is not right."), "code": "password"},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            remove_login(user)
        except CannotRemove as refused:
            return Response(
                {"detail": refused.message, "code": refused.code},
                status=status.HTTP_409_CONFLICT,
            )
        logout(request._request)
        return Response({"closed": True})


class OrdersView(APIView):
    """Every order paid for with this account's phone, signed in or not when
    it was made: matched by the number, which the account has proved."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={200: None})
    def get(self, request):
        from marketplace.models import Order, PaymentStatus
        from marketplace.serializers import OrderSerializer

        account = _account(request)
        orders = (
            Order.objects.filter(buyer_phone=account.phone, status=PaymentStatus.PAID)
            .select_related("seller", "seller__provider", "seller__provider__area")
            .prefetch_related("items")
            .order_by("-paid_at")[:100]
        )
        return Response({"results": OrderSerializer(orders, many=True).data})


class QuestionsView(APIView):
    """Questions this phone asked about products, and quote requests."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={200: None})
    def get(self, request):
        from marketplace.models import ProductEnquiry, QuoteRequest

        account = _account(request)
        asked = (
            ProductEnquiry.objects.filter(
                buyer_phone=account.phone, state=ProductEnquiry.State.SENT
            )
            .select_related("seller")
            .order_by("-created_at")[:50]
        )
        quotes = (
            QuoteRequest.objects.filter(buyer_phone=account.phone)
            .select_related("trade")
            .prefetch_related("leads__seller")
            .order_by("-created_at")[:20]
        )
        return Response(
            {
                "questions": [
                    {
                        "reference": enquiry.reference_code,
                        "product": enquiry.product_id,
                        "product_name": enquiry.product_name,
                        "seller_name": enquiry.seller.business_name,
                        "message": enquiry.message,
                        "created_at": enquiry.created_at.isoformat(),
                    }
                    for enquiry in asked
                ],
                "quotes": [
                    {
                        "reference": quote.reference,
                        "title": quote.title,
                        "trade": quote.trade.name,
                        "state": quote.state,
                        "makers": [lead.seller.business_name for lead in quote.leads.all()],
                        "created_at": quote.created_at.isoformat(),
                    }
                    for quote in quotes
                ],
            }
        )


class SavedView(APIView):
    """Saved products. PUT adds the ids a browser kept while signed out, so
    nothing saved before signing in is lost."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={200: None})
    def get(self, request):
        account = _account(request)
        return Response({"ids": list(account.saved.values_list("product_id", flat=True))})

    @method_decorator(csrf_protect)
    @extend_schema(request=None, responses={200: None})
    def put(self, request):
        from marketplace.models import Product

        account = _account(request)
        add = [int(i) for i in request.data.get("add", []) if str(i).isdigit()][:50]
        remove = [int(i) for i in request.data.get("remove", []) if str(i).isdigit()][:50]
        if remove:
            account.saved.filter(product_id__in=remove).delete()
        visible = Product.objects.visible().filter(pk__in=add).values_list("pk", "price")
        SavedProduct.objects.bulk_create(
            [
                SavedProduct(account=account, product_id=pk, price_seen=price)
                for pk, price in visible
            ],
            ignore_conflicts=True,
        )
        return Response({"ids": list(account.saved.values_list("product_id", flat=True))})


def _saved_search_payload(search):
    from urllib.parse import urlencode

    return {
        "id": search.pk,
        "label": search.label,
        "params": search.params,
        "path": "/marketplace" + (f"?{urlencode(search.params)}" if search.params else ""),
        "created_at": search.created_at,
        "last_told_at": search.last_told_at,
    }


@method_decorator(csrf_protect, name="dispatch")
class SavedSearchesView(APIView):
    """Saved marketplace searches. POST keeps one (texted about new matches
    once a day at most); up to SavedSearch.LIMIT each."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={200: None})
    def get(self, request):
        account = _account(request)
        return Response(
            {"results": [_saved_search_payload(s) for s in account.saved_searches.all()]}
        )

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        from marketplace.models import SavedSearch

        account = _account(request)
        params = SavedSearch.clean_params(request.data.get("params"))
        if not params:
            return Response(
                {"detail": _("Search for something or choose a filter first.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        existing = next((s for s in account.saved_searches.all() if s.params == params), None)
        if existing is not None:
            return Response(_saved_search_payload(existing))
        if account.saved_searches.count() >= SavedSearch.LIMIT:
            return Response(
                {
                    "detail": _("You can keep %(n)s searches. Delete one first.")
                    % {"n": SavedSearch.LIMIT}
                },
                status=status.HTTP_409_CONFLICT,
            )
        label = (
            str(request.data.get("label") or "").strip()[:160]
            or params.get("q")
            or _("Marketplace search")
        )
        search = SavedSearch.objects.create(account=account, params=params, label=label)
        return Response(_saved_search_payload(search), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class SavedSearchView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        _account(request).saved_searches.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _bag_payload(account, request):
    from core.media import public_url

    lines = (
        account.bag.select_related("product", "product__seller", "option")
        .prefetch_related("product__photos")
        .order_by("added_at", "pk")
    )
    rows = []
    for line in lines:
        product = line.product
        first = next(iter(product.photos.all()), None)
        unit = line.option.price if line.option and line.option.price is not None else product.price
        rows.append(
            {
                "product": product.pk,
                "option": line.option_id,
                "option_label": line.option.label if line.option else "",
                "quantity": line.quantity,
                "name": product.name,
                "price": f"{unit:.2f}" if unit is not None else None,
                "photo": public_url(first.image.url, request) if first and first.image else None,
                "seller": {"id": product.seller_id, "business_name": product.seller.business_name},
                "available": product.availability != "sold_out" and product.seller.may_sell,
            }
        )
    return {"items": rows}


@method_decorator(csrf_protect, name="dispatch")
class BagView(APIView):
    """The bag, kept on the account so it is the same on every device.

    GET reads it. PUT replaces it with what the device sends (after the
    device merged its own); POST {"add": [...]} adds lines, summing the
    quantities, so a bag made signed out joins the account's on sign-in.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]
    LIMIT = 50

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(_bag_payload(_account(request), request))

    def _lines(self, raw):
        from marketplace.models import Product, ProductOption

        rows = []
        for row in (raw or [])[: self.LIMIT]:
            try:
                product, option, quantity = (
                    int(row["product"]),
                    row.get("option"),
                    int(row.get("quantity") or 1),
                )
            except (KeyError, TypeError, ValueError):
                continue
            option = int(option) if str(option or "").isdigit() else None
            rows.append((product, option, max(1, min(quantity, 20))))
        visible = set(
            Product.objects.visible()
            .filter(pk__in=[r[0] for r in rows])
            .values_list("pk", flat=True)
        )
        options = set(
            ProductOption.objects.filter(pk__in=[r[1] for r in rows if r[1]]).values_list(
                "pk", "product_id"
            )
        )
        return [r for r in rows if r[0] in visible and (r[1] is None or (r[1], r[0]) in options)]

    @extend_schema(request=None, responses={200: None})
    def put(self, request):
        account = _account(request)
        with transaction.atomic():
            account.bag.all().delete()
            merged = {}
            for product, option, quantity in self._lines(request.data.get("items")):
                merged[(product, option)] = quantity
            BagLine.objects.bulk_create(
                BagLine(account=account, product_id=p, option_id=o, quantity=q)
                for (p, o), q in merged.items()
            )
        return Response(_bag_payload(account, request))

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        account = _account(request)
        with transaction.atomic():
            for product, option, quantity in self._lines(request.data.get("add")):
                line, created = BagLine.objects.get_or_create(
                    account=account,
                    product_id=product,
                    option_id=option,
                    defaults={"quantity": quantity},
                )
                if not created:
                    line.quantity = min(line.quantity + quantity, 20)
                    line.save(update_fields=["quantity"])
        return Response(_bag_payload(account, request))


@method_decorator(csrf_protect, name="dispatch")
class AddressesView(APIView):
    """Saved delivery addresses (up to DeliveryAddress.LIMIT). POST keeps one,
    or moves an existing one to the top; checkout saves the one it used."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={200: None})
    def get(self, request):
        account = _account(request)
        return Response(
            {
                "results": [
                    {"id": a.pk, "label": a.label, "address": a.address}
                    for a in account.addresses.all()
                ]
            }
        )

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        account = _account(request)
        address = str(request.data.get("address") or "").strip()[:300]
        if not address:
            return Response(
                {"address": [_("Write the address.")]}, status=status.HTTP_400_BAD_REQUEST
            )
        label = str(request.data.get("label") or "").strip()[:40]
        remember_address(account, address, label)
        return self.get(request)


def remember_address(account, address, label=""):
    """Keep an address used at checkout at the top of the list; drop the
    oldest past the limit."""
    existing = account.addresses.filter(address__iexact=address).first()
    if existing:
        if label:
            existing.label = label
        existing.save()
    else:
        DeliveryAddress.objects.create(account=account, address=address, label=label)
    for old in account.addresses.all()[DeliveryAddress.LIMIT :]:
        old.delete()


@method_decorator(csrf_protect, name="dispatch")
class AddressView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        _account(request).addresses.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class AddRoleView(APIView):
    """Become a trainee, a trainer or a seller, on this same login.

    The phone the account proved is the phone the new role uses, so no second
    code. Trainers and sellers still wait for staff to confirm them.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, role):
        account = _account(request)
        try:
            if not _add_role(request, account, role):
                return Response({"detail": _("No such role.")}, status=status.HTTP_404_NOT_FOUND)
        except ValueError as exc:
            # Each role's own "disabled", "declined" or "sells elsewhere".
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(account_payload(request), status=status.HTTP_201_CREATED)


def _add_role(request, account, role):
    """Add a trainee, trainer or seller role to this login. False for an
    unknown role; a role's own refusal raises ValueError."""
    now = account.phone_verified_at or timezone.now()
    if role == "trainee":
        from trainees.auth import account_for_verified_phone as trainee_for

        trainee_for(phone=account.phone, verified_at=now, display_name=account.display_name)
    elif role == "trainer":
        from providers.trainer_auth import account_for_verified_phone as trainer_for

        trainer_for(phone=account.phone, verified_at=now)
    elif role == "seller":
        from marketplace.auth import account_for_verified_phone as seller_for
        from marketplace.auth import adopt_workshop, workshop_of

        seller = seller_for(phone=account.phone, verified_at=now, user=request.user)
        # A trainer opening a shop from the account page gets the same as from
        # the workshop dashboard: its name, area and ID carried over.
        workshop = workshop_of(request.user)
        if workshop is not None:
            adopt_workshop(seller, workshop)
    else:
        return False
    # A fresh copy, so the new role's reverse relation is not cached as
    # missing from before it existed.
    request.user = get_user_model().objects.get(pk=request.user.pk)
    return True


class AccountPhotoView(APIView):
    """POST a picture (field "photo") to set the account's photo, DELETE to
    take it off. Shown only to its owner: in the site header and the app."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        account = _account(request)
        upload = request.FILES.get("photo")
        refusal = validate_image_upload(upload)
        if refusal is not None:
            return Response({"detail": refusal}, status=status.HTTP_400_BAD_REQUEST)
        account.photo = upload
        try:
            account.save(update_fields=["photo", "updated_at"])
        except Exception:
            logger.exception("Photo upload failed for account %s", account.pk)
            return Response(
                {"detail": _("That image could not be read. Try another.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Anything Pillow could not decode is stored as it came, metadata and
        # all: never keep that (the same rule as a trainee's picture).
        if not account.photo.name.lower().endswith(".jpg"):
            account.photo.delete(save=True)
            return Response(
                {"detail": _("That file is not a readable image.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(account_payload(request), status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses={200: None})
    def delete(self, request):
        account = _account(request)
        if account.photo:
            # The file is left for prune_media, as for every other picture.
            account.photo = ""
            account.save(update_fields=["photo", "updated_at"])
        return Response(account_payload(request))
