"""The marketplace API: signing in as a seller, a seller's own shelf, and what
a buyer can browse.

Three groups of endpoints, and the boundary between them is the point. The
public ones read `Product.objects.visible()` and nothing else, so there is one
place to get wrong rather than one per view. The seller's own endpoints are
scoped to `own_seller_account(request)` and never take an id from the caller
that selects whose products are touched.
"""

from django.conf import settings
from django.contrib.auth import login, logout
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.text import slugify
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.images import strip_exif, validate_image_upload
from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries.email_otp import may_copy_code_to
from enquiries.models import PhoneVerification
from enquiries.otp import OTPError, phone_is_trusted, request_code, verify_code
from enquiries.serializers import OTPRequestSerializer

from . import seller_messages
from .auth import (
    SellerAccountDisabled,
    SellerAccountElsewhere,
    account_for_verified_phone,
    code_address_for,
    other_number_message,
    own_seller_account,
    start_selling,
)
from .models import Product, ProductEnquiry, ProductPhoto, SellerAccount
from .serializers import (
    OwnEnquirySerializer,
    OwnProductSerializer,
    ProductCardSerializer,
    ProductDetailSerializer,
    ProductEnquiryInputSerializer,
    ProductPhotoSerializer,
    SellerCardSerializer,
    SellerOTPVerifySerializer,
    SellerProfileSerializer,
)

PURPOSE = PhoneVerification.Purpose.SELLER_ACCESS

# A shelf, not a catalogue. Twenty is the search page's size and the same
# reasoning applies: nobody scrolls past it on a phone on prepaid data.
PAGE_SIZE = 20
MAX_PHOTOS_PER_PRODUCT = 6


class IsActiveSeller(BasePermission):
    message = "A verified seller session is required."

    def has_permission(self, request, view):
        return own_seller_account(request) is not None


def _account(request):
    account = own_seller_account(request)
    if account is None:
        raise PermissionDenied(_("A verified seller session is required."))
    return account


def _session_payload(request):
    account = own_seller_account(request)
    if account is None:
        return {"authenticated": False, "seller": None}
    return {
        "authenticated": True,
        "seller": SellerProfileSerializer(account).data,
    }


# --------------------------------------------------------------------------
# Signing in


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SellerSessionView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        # Same CSRF bootstrap contract as the other two session endpoints, so
        # a page that only renders the shop can still make its first write.
        get_token(request._request)
        return Response(_session_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class SellerOTPRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=OTPRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        if is_ratelimited(
            request, group="seller-otp-request", key=ratelimit_client_ip, rate="5/m", increment=True
        ):
            return Response(
                {"detail": _("Too many requests. Wait a minute and try again.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        copy_to, proven = code_address_for(phone)
        if copy_to and not proven and not may_copy_code_to(copy_to):
            copy_to = None
        try:
            challenge = request_code(
                phone,
                ip_address=canonical_client_ip(request),
                purpose=PURPOSE,
                # The same code, also sent to the address on the account. The
                # response is identical either way, so it reveals nothing
                # about whether an account or an address exists.
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
class SellerOTPVerifyView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=SellerOTPVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = SellerOTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Symmetric with the request endpoint. Each challenge caps its own
        # guesses, but nothing would stop a caller burning challenges at
        # 5/min and taking a fresh allowance of guesses with each.
        if is_ratelimited(
            request, group="seller-otp-verify", key=ratelimit_client_ip, rate="10/m", increment=True
        ):
            return Response(
                {"detail": _("Too many attempts. Wait a minute and try again.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Somebody already signed in — a trainer ticking "I also sell" —
        # keeps their login and gains a seller account on it. Checked before
        # verification so the branch is visible rather than implied.
        existing_user = (
            request.user if request.user.is_authenticated and not request.user.is_staff else None
        )
        # Before the code is checked, so a number that cannot be used here
        # does not spend it.
        if existing_user is not None:
            held = SellerAccount.objects.filter(user=existing_user).only("phone").first()
            if held is not None and str(held.phone) != str(serializer.validated_data["phone"]):
                return Response(
                    {"detail": other_number_message()}, status=status.HTTP_409_CONFLICT
                )

        try:
            verification = verify_code(
                serializer.validated_data["phone"],
                serializer.validated_data["code"],
                purpose=PURPOSE,
                challenge_id=serializer.validated_data["challenge_id"],
            )
            account = account_for_verified_phone(
                phone=verification.phone,
                verified_at=verification.verified_at,
                user=existing_user,
            )
        except OTPError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except SellerAccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except SellerAccountElsewhere as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        if existing_user is None:
            # login() cycles the session key, preventing fixation. Skipped
            # when they were already signed in: re-logging the same user in
            # would throw away the trainer session they are standing on.
            login(
                request._request,
                account.user,
                backend="django.contrib.auth.backends.ModelBackend",
            )
            request.user = account.user
        get_token(request._request)
        return Response(_session_payload(request))


# --------------------------------------------------------------------------
# A trainer who also sells


@method_decorator(csrf_protect, name="dispatch")
class StartSellingView(APIView):
    """Turn selling on for a trainer who is already signed in.

    No second code. Their phone was verified to get into this session and it
    is the same number — asking again would be theatre, and on a paused SMS
    gateway it would be theatre somebody has to relay by hand.

    No second account either: the SellerAccount hangs off the user they
    already have, so one login carries both capabilities. The shop is
    prefilled from the workshop, because for a workshop that is what the shop
    is — the same name, the same place.

    Confirmation still applies. A confirmed trainer is not automatically a
    confirmed seller: staff approved a workshop that teaches, which is not the
    same question as whether it should sell goods. It does mean the queue has
    something to read, which a bare phone number does not.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        from providers.models import TrainerAccount
        from providers.trainer_profiles import get_owned_profile

        try:
            trainer = request.user.trainer_account
        except TrainerAccount.DoesNotExist:
            raise PermissionDenied(_("A verified trainer session is required.")) from None
        if not trainer.is_active:
            raise PermissionDenied(_("This trainer account has been disabled."))

        provider = get_owned_profile(trainer)
        try:
            account = start_selling(
                user=request.user,
                phone=trainer.phone,
                verified_at=trainer.phone_verified_at,
                provider=provider,
            )
        except SellerAccountDisabled as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except SellerAccountElsewhere as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        # Prefilled, not forced: a workshop that sells under another name can
        # change both from the dashboard. Only ever fills blanks, so a second
        # call never overwrites what the seller has since typed.
        changed = []
        if provider is not None:
            if not account.business_name:
                account.business_name = provider.name
                changed.append("business_name")
            if not account.area_id and provider.area_id:
                account.area_id = provider.area_id
                changed.append("area")
        if changed:
            account.save(update_fields=[*changed, "updated_at"])

        return Response(SellerProfileSerializer(account).data)


# --------------------------------------------------------------------------
# The seller's own shop


@method_decorator(csrf_protect, name="dispatch")
class SellerProfileView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(SellerProfileSerializer(_account(request)).data)

    @extend_schema(request=SellerProfileSerializer, responses={200: None})
    def patch(self, request):
        account = _account(request)
        serializer = SellerProfileSerializer(account, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(SellerProfileSerializer(account).data)


def _unique_slug(seller, name):
    """A slug unique within this seller's own shelf.

    Per-seller, not global: two tailors both selling an "Ankara bag" is the
    ordinary case, and a global constraint would make the second rename a
    product for a reason she cannot see.
    """
    base = slugify(name)[:200] or "product"
    slug = base
    n = 2
    taken = set(seller.products.values_list("slug", flat=True))
    while slug in taken:
        suffix = f"-{n}"
        slug = f"{base[: 200 - len(suffix)]}{suffix}"
        n += 1
    return slug


@method_decorator(csrf_protect, name="dispatch")
class OwnProductsView(APIView):
    """Everything this seller has listed, in any state, and how to add one."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        account = _account(request)
        products = account.products.prefetch_related("photos").select_related("trade")
        return Response({"results": OwnProductSerializer(products, many=True).data})

    @extend_schema(request=OwnProductSerializer, responses={201: None})
    def post(self, request):
        account = _account(request)
        serializer = OwnProductSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = Product(
            seller=account,
            slug=_unique_slug(account, serializer.validated_data["name"]),
            **serializer.validated_data,
        )
        # A new product is always a draft. Publishing is its own call, so a
        # client cannot create something already live by accident.
        product.status = Product.Status.DRAFT
        product.save()
        return Response(OwnProductSerializer(product).data, status=status.HTTP_201_CREATED)


def _owned_product(request, pk):
    """Scoped by seller, so an id belonging to somebody else is a 404 and not
    a 403 — which would confirm the product exists."""
    account = _account(request)
    product = account.products.filter(pk=pk).prefetch_related("photos").first()
    if product is None:
        raise NotFound(_("No such product."))
    return account, product


@method_decorator(csrf_protect, name="dispatch")
class OwnProductView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        _seller, product = _owned_product(request, pk)
        return Response(OwnProductSerializer(product).data)

    @extend_schema(request=OwnProductSerializer, responses={200: None})
    def patch(self, request, pk):
        _seller, product = _owned_product(request, pk)
        serializer = OwnProductSerializer(product, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(OwnProductSerializer(product).data)

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        """Gone for good, at the seller's own hand.

        A product nobody has enquired about carries no record worth keeping,
        and a shelf that only grows is a shelf nobody tidies. Withdrawing to
        draft is the softer action and it is a different endpoint.
        """
        _seller, product = _owned_product(request, pk)
        product.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class ProductPublishView(APIView):
    """Put a product up, or take it back down.

    Its own endpoint rather than a field on PATCH, so there is one place that
    explains why publishing can be refused — and so a careless client cannot
    publish a half-finished draft by sending the whole object back.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk):
        account, product = _owned_product(request, pk)
        if not account.may_sell:
            # Three different reasons, three different things to do about it,
            # so they are not collapsed into one message.
            if not account.business_name or not account.area_id:
                detail = _("Add your shop name and where you are before listing anything.")
            elif not account.is_confirmed:
                detail = _(
                    "Your seller sign-up is still being checked. You can keep adding "
                    "products, and they go live once it is approved."
                )
            else:
                detail = _("This seller account cannot list products.")
            return Response({"detail": detail}, status=status.HTTP_403_FORBIDDEN)

        if product.status == Product.Status.SUSPENDED:
            return Response(
                {
                    "detail": _(
                        "This product was taken down by staff and cannot be put back from here."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        product.status = Product.Status.PUBLISHED
        product.save(update_fields=["status", "updated_at"])
        return Response(OwnProductSerializer(product).data)

    @extend_schema(responses={200: None})
    def delete(self, request, pk):
        """Withdraw: back to draft, keeping everything."""
        _seller, product = _owned_product(request, pk)
        if product.status == Product.Status.SUSPENDED:
            return Response(
                {"detail": _("This product was taken down by staff.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        product.status = Product.Status.DRAFT
        product.save(update_fields=["status", "updated_at"])
        return Response(OwnProductSerializer(product).data)


@method_decorator(csrf_protect, name="dispatch")
class ProductPhotosView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        _seller, product = _owned_product(request, pk)
        upload = request.FILES.get("image")
        if upload is None:
            return Response({"detail": _("Choose a picture.")}, status=status.HTTP_400_BAD_REQUEST)
        # It returns the refusal, it does not raise one. Wrapping this in a
        # try/except meant every check inside it passed silently and a PDF
        # was accepted as a photograph.
        refusal = validate_image_upload(upload)
        if refusal:
            return Response({"detail": refusal}, status=status.HTTP_400_BAD_REQUEST)

        # The size and content-type checks above both trust what the client
        # said. This is the one that does not: Pillow either reads the file
        # or it does not, and a .jpg that is really a PDF does not.
        if strip_exif(upload) is None:
            return Response(
                {"detail": _("That file is not an image we can read.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        upload.seek(0)

        if product.photos.count() >= MAX_PHOTOS_PER_PRODUCT:
            return Response(
                {
                    "detail": _("A product can have %(n)d pictures. Remove one first.")
                    % {"n": MAX_PHOTOS_PER_PRODUCT}
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            photo = ProductPhoto.objects.create(
                product=product,
                image=upload,
                uploaded_by=request.user,
                display_order=product.photos.count(),
            )
        return Response(
            ProductPhotoSerializer(photo, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_protect, name="dispatch")
class ProductPhotoView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={204: None})
    def delete(self, request, pk, photo_id):
        _seller, product = _owned_product(request, pk)
        photo = product.photos.filter(pk=photo_id).first()
        if photo is None:
            raise NotFound(_("No such picture."))
        photo.image.delete(save=False)
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# What a buyer sees


def _public_products():
    """The one queryset every public view reads.

    Written once so there is a single place to get the visibility rule wrong,
    rather than one per view.
    """
    return (
        Product.objects.visible()
        .select_related(
            "seller", "seller__area", "seller__area__region", "seller__provider", "trade"
        )
        .prefetch_related("photos")
    )


class ProductListView(ListAPIView):
    """Browse the marketplace. Filters mirror the training search's names so
    one set of query parameters is learned, not two."""

    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = ProductCardSerializer

    def get_queryset(self):
        products = _public_products()
        params = self.request.query_params

        trade = params.get("trade")
        if trade:
            products = products.filter(trade__slug=trade)

        area = params.get("area")
        if area:
            products = products.filter(seller__area__slug=area)

        region = params.get("region")
        if region:
            products = products.filter(seller__area__region__slug=region)

        availability = params.get("availability")
        if availability:
            products = products.filter(availability=availability)

        query = (params.get("q") or "").strip()
        if query:
            from django.db.models import Q

            products = products.filter(
                Q(name__icontains=query)
                | Q(description__icontains=query)
                | Q(seller__business_name__icontains=query)
            )

        # Sold-out items sort last rather than being hidden: seeing that a
        # maker's work goes is a reason to ask them, and hiding it makes a
        # busy shop look empty.
        from django.db.models import Case, IntegerField, Value, When

        return products.annotate(
            gone=Case(
                When(availability=Product.Availability.SOLD_OUT, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
        ).order_by("gone", "-created_at")


class ProductDetailView(RetrieveAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = ProductDetailSerializer
    lookup_field = "pk"

    def get_queryset(self):
        return _public_products()


class SellerDetailView(APIView):
    """A seller's shop front: who they are, and everything of theirs on sale."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        seller = (
            SellerAccount.objects.select_related("area", "area__region", "provider")
            .filter(pk=pk)
            .first()
        )
        # A seller nobody may see is a 404, not an empty shop: an empty shop
        # confirms the account exists.
        if seller is None or not seller.may_sell:
            raise NotFound(_("No such seller."))
        products = _public_products().filter(seller=seller)
        return Response(
            {
                "seller": SellerCardSerializer(seller, context={"request": request}).data,
                "products": ProductCardSerializer(
                    products, many=True, context={"request": request}
                ).data,
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class ProductEnquiryCreateView(APIView):
    """Ask a seller about a product.

    Anyone can, with no account — but not with no proof. The number has to
    have been verified by this browser, which is the same bargain the
    training enquiry makes and, deliberately, the *same* session trust: a
    buyer who asked about a welding course an hour ago does not type another
    code to ask about a bag. One verification, both pillars.

    Why verified at all, when it is only a question? Because the seller is
    told on WhatsApp by a member of staff, and an unverified form is a way to
    have Fliiptech send messages to strangers on somebody else's behalf.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=ProductEnquiryInputSerializer, responses={201: None})
    def post(self, request, pk):
        serializer = ProductEnquiryInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        product = _public_products().filter(pk=pk).first()
        if product is None:
            raise NotFound(_("No such product."))

        if not phone_is_trusted(request.session, phone):
            return Response(
                {"detail": _("Verify this phone number before asking about a product.")},
                status=status.HTTP_403_FORBIDDEN,
            )

        if is_ratelimited(
            request,
            group="product-enquiry",
            key=ratelimit_client_ip,
            rate="10/h",
            increment=True,
        ):
            return Response(
                {"detail": _("Too many enquiries. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        with transaction.atomic():
            enquiry = ProductEnquiry.objects.create(
                seller=product.seller,
                product=product,
                # Kept as text as well as a link, so the row still says what
                # it was about after the seller tidies the product away.
                product_name=product.name,
                buyer_phone=phone,
                buyer_name=serializer.validated_data.get("name", ""),
                message=serializer.validated_data.get("message", ""),
                phone_verified_at=timezone.now(),
            )
            # In the same transaction as the enquiry: an enquiry nobody is
            # told about is the failure this whole queue exists to prevent.
            seller_messages.queue_enquiry_alert(enquiry)

        return Response(
            {
                "reference_code": enquiry.reference_code,
                # Said plainly because it is true and the wait is real: a
                # person sends this on, so "we have told them" would be a
                # promise about a queue the buyer cannot see.
                "detail": _(
                    "Your question has been sent. The seller will be told and "
                    "will reply on WhatsApp."
                ),
            },
            status=status.HTTP_201_CREATED,
        )


class OwnEnquiriesView(APIView):
    """The questions people have asked this seller.

    Read-only, and scoped to the signed-in seller. Spam is left out: staff
    marked it spam, and showing a seller the thing staff decided to shield
    them from would undo the decision.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        account = _account(request)
        enquiries = (
            account.enquiries.filter(state=ProductEnquiry.State.SENT)
            .prefetch_related("alerts")
            .order_by("-created_at")[:100]
        )
        return Response({"results": OwnEnquirySerializer(enquiries, many=True).data})


@method_decorator(csrf_protect, name="dispatch")
class SellerLogoutView(APIView):
    """End the session.

    Its own view rather than reusing the trainer's, which is generic enough
    to work: a seller posting to /api/trainer/logout/ reads as a mistake, and
    the next person to touch either would have to work out whether it was.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        logout(request._request)
        return Response({"authenticated": False, "seller": None})
