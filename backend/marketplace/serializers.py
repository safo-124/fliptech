"""What the marketplace sends and accepts.

Two audiences, two shapes. A buyer browsing gets what is on the label and
nothing about the seller's account; a seller reading their own shelf gets the
draft and taken-down rows too, plus the staff note explaining a takedown —
which is the one piece of staff writing they are meant to see.
"""

from drf_spectacular.utils import extend_schema_field
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers

from core.media import public_url
from providers.trainer_serializers import RejectUnknownFieldsMixin

from .models import (
    DiscountCode,
    Order,
    OrderItem,
    Product,
    ProductEnquiry,
    ProductOption,
    ProductPhoto,
    ProductReport,
    SellerAccount,
    SellerReview,
)


class SellerOTPVerifySerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    challenge_id = serializers.UUIDField()
    phone = PhoneNumberField()
    code = serializers.CharField(min_length=4, max_length=8, trim_whitespace=True)


class ProductPhotoSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_image(self, obj):
        # Not the plain ImageField: DRF would build the URL from the request,
        # and a server-rendered request arrives on loopback. See core/media.py.
        return public_url(obj.image.url, self.context.get("request")) if obj.image else None

    class Meta:
        model = ProductPhoto
        fields = ["id", "image", "caption", "display_order"]


class SellerCardSerializer(serializers.ModelSerializer):
    """The seller as a buyer sees them: a name, a place, and whether there is
    a workshop behind them.

    No phone number. Contacting a seller goes through a route that can be
    counted and moderated, and printing the number on the page would route
    around it — and hand every scraper a list of Ghanaian mobile numbers.
    """

    area = serializers.CharField(source="area.name", read_only=True)
    area_slug = serializers.CharField(source="area.slug", read_only=True)
    region = serializers.CharField(source="area.region.name", read_only=True)
    workshop = serializers.SerializerMethodField()
    rating = serializers.SerializerMethodField()
    replies_fast = serializers.SerializerMethodField()
    verified = serializers.SerializerMethodField()

    @extend_schema_field(serializers.BooleanField())
    def get_replies_fast(self, obj):
        """The "usually replies within a day" badge (marketplace/reviews.py)."""
        from .reviews import fast_repliers

        fast = self.context.get("fast")
        if fast is None:
            fast = fast_repliers([obj.pk])
        return obj.pk in fast

    @extend_schema_field(serializers.BooleanField())
    def get_verified(self, obj):
        """A member of staff visited and saw the work being made."""
        return obj.verified_at is not None

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_rating(self, obj):
        """{"average", "count"} from buyers' reviews, or None with none yet.

        A list passes every seller's rating in the context, worked out in
        one query; anything else asks for this one.
        """
        from .reviews import rating_for

        ratings = self.context.get("ratings")
        if ratings is not None:
            return ratings.get(obj.pk)
        return rating_for(obj)

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_workshop(self, obj):
        """The training listing, when this seller is also a workshop.

        It is the strongest thing a buyer can be told: this is not an
        anonymous account, it is a place with an address that Fliiptech may
        have visited, and here is the page.
        """
        if not obj.provider_id:
            return None
        provider = obj.provider
        return {
            "name": provider.name,
            "slug": provider.slug,
            "area_slug": provider.area.slug,
        }

    class Meta:
        model = SellerAccount
        fields = [
            "id",
            "business_name",
            "about",
            "area",
            "area_slug",
            "region",
            "workshop",
            "rating",
            "replies_fast",
            "verified",
            "delivery_fee",
            "delivery_area",
        ]


class ProductCardSerializer(serializers.ModelSerializer):
    """A product in a list. One photo, not the gallery."""

    seller = SellerCardSerializer(read_only=True)
    trade = serializers.SerializerMethodField()
    photo = serializers.SerializerMethodField()
    sponsored = serializers.SerializerMethodField()
    distance_km = serializers.SerializerMethodField()
    buy_online = serializers.SerializerMethodField()
    was_price = serializers.SerializerMethodField()

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_was_price(self, obj):
        """The crossed-out price, only when it is really higher."""
        if obj.was_price and obj.price is not None and obj.was_price > obj.price:
            return f"{obj.was_price:.2f}"
        return None

    @extend_schema_field(serializers.BooleanField())
    def get_sponsored(self, obj):
        """A boost is running. Shown as "Sponsored" so nobody mistakes a paid
        place at the top for the best product."""
        boosted = getattr(obj, "boosted", None)
        if boosted is None:
            from .models import SellerPayment

            return SellerPayment.objects.running().boosts().filter(product=obj).exists()
        return bool(boosted)

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_distance_km(self, obj):
        """How far the seller's area is, when the buyer said where they are."""
        distance = getattr(obj, "distance", None)
        return round(distance.km, 1) if distance is not None else None

    @extend_schema_field(serializers.BooleanField())
    def get_buy_online(self, obj):
        """Whether "Buy now" is offered: payments on, the seller can be
        paid, a price to pay, and something ready to hand over."""
        from courses import paystack

        return bool(
            paystack.enabled()
            and obj.seller.payout_ready
            and obj.price
            and obj.availability == Product.Availability.AVAILABLE
        )

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_trade(self, obj):
        if not obj.trade_id:
            return None
        return {"name": obj.trade.name, "slug": obj.trade.slug, "colour": obj.trade.colour}

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_photo(self, obj):
        first = next(iter(obj.photos.all()), None)
        if first is None or not first.image:
            return None
        return public_url(first.image.url, self.context.get("request"))

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "slug",
            "price",
            "was_price",
            "availability",
            "trade",
            "photo",
            "seller",
            "sponsored",
            "distance_km",
            "buy_online",
            "created_at",
        ]


class ProductOptionSerializer(serializers.ModelSerializer):
    label = serializers.CharField(max_length=80)

    class Meta:
        model = ProductOption
        fields = ["id", "label", "price", "available"]


class ProductDetailSerializer(ProductCardSerializer):
    photos = ProductPhotoSerializer(many=True, read_only=True)
    options = serializers.SerializerMethodField()

    @extend_schema_field(ProductOptionSerializer(many=True))
    def get_options(self, obj):
        """Each option with the price a buyer pays for it."""
        return [
            {
                "id": option.id,
                "label": option.label,
                "price": f"{(option.price if option.price is not None else obj.price):.2f}"
                if (option.price is not None or obj.price is not None)
                else None,
                "available": option.available,
            }
            for option in obj.options.all()
        ]

    class Meta(ProductCardSerializer.Meta):
        fields = [*ProductCardSerializer.Meta.fields, "description", "photos", "options"]


# --------------------------------------------------------------------------
# The seller's own view


class OwnProductSerializer(serializers.ModelSerializer):
    """A product as its owner sees and edits it.

    `status` is read-only here on purpose. Publishing and withdrawing are
    their own endpoints: a PATCH that can flip status means a careless client
    publishes a half-finished draft, and it gives the seller no single place
    where the rule about confirmation is explained.
    """

    photos = ProductPhotoSerializer(many=True, read_only=True)
    options = ProductOptionSerializer(many=True, read_only=True)
    status = serializers.CharField(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    visible = serializers.SerializerMethodField()

    @extend_schema_field(serializers.BooleanField())
    def get_visible(self, obj):
        """Whether a buyer can actually see it, which is not the same as
        'published'. A published product whose seller is not confirmed is
        invisible, and the dashboard has to be able to say so."""
        return obj.status == Product.Status.PUBLISHED and obj.seller.may_sell

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "price",
            "was_price",
            "trade",
            "availability",
            "options",
            "status",
            "status_label",
            "staff_note",
            "visible",
            "photos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["slug", "staff_note", "created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give the product a name.")
        return value


class SellerProfileSerializer(serializers.ModelSerializer):
    """The seller's own account, as the dashboard reads and writes it."""

    phone = serializers.CharField(read_only=True)
    approval_status = serializers.CharField(read_only=True)
    approval_note = serializers.CharField(read_only=True)
    may_sell = serializers.BooleanField(read_only=True)
    ready_to_sell = serializers.SerializerMethodField()

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_ready_to_sell(self, obj):
        """What is still missing, as a list the dashboard can print.

        Empty means nothing is left on the seller's side. It deliberately
        reports the confirmation separately from the form, because one is
        their work and the other is a wait.
        """
        missing = []
        if not obj.business_name:
            missing.append("business_name")
        if not obj.area_id:
            missing.append("area")
        return missing

    class Meta:
        model = SellerAccount
        fields = [
            "phone",
            "email",
            "business_name",
            "about",
            "area",
            "approval_status",
            "approval_note",
            "may_sell",
            "ready_to_sell",
            "delivery_fee",
            "delivery_area",
            "verified_at",
        ]
        read_only_fields = ["phone", "email", "verified_at"]


class ProductEnquiryInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    """What a buyer sends when they ask about something.

    The phone is here and not taken from the session, because the session
    holds every number this browser has proved and the caller has to say
    which of them is asking. The view checks it against that list.
    """

    phone = PhoneNumberField()
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    message = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class OwnEnquirySerializer(serializers.ModelSerializer):
    """An enquiry as the seller who received it sees it.

    `told` is here because it is the honest thing to show. A seller looking
    at a question they have not answered deserves to know whether it ever
    reached their phone — the alternative is them feeling slow about a
    message nobody passed on.
    """

    told = serializers.SerializerMethodField()
    reply_url = serializers.SerializerMethodField()

    @extend_schema_field(serializers.BooleanField())
    def get_told(self, obj):
        notice = next(iter(obj.alerts.all()), None)
        return bool(notice and notice.sent_at)

    @extend_schema_field(serializers.URLField())
    def get_reply_url(self, obj):
        from .seller_messages import seller_to_buyer

        return seller_to_buyer(obj)

    class Meta:
        model = ProductEnquiry
        fields = [
            "id",
            "reference_code",
            "product",
            "product_name",
            "buyer_phone",
            "buyer_name",
            "message",
            "told",
            "reply_url",
            "replied_at",
            "created_at",
        ]


# --------------------------------------------------------------------------
# Reviews and orders


class PublicReviewSerializer(serializers.ModelSerializer):
    """A review as anyone sees it: a first name at most, never the phone."""

    buyer_name = serializers.SerializerMethodField()

    @extend_schema_field(serializers.CharField())
    def get_buyer_name(self, obj):
        return (obj.buyer_name or "").split(" ")[0][:40]

    class Meta:
        model = SellerReview
        fields = ["id", "rating", "comment", "bought", "product_name", "buyer_name", "created_at"]


class ReviewInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(max_length=600, required=False, allow_blank=True)
    bought = serializers.BooleanField(required=False, default=False)


class BasketItemSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    product = serializers.IntegerField()
    option = serializers.IntegerField(required=False, allow_null=True)
    quantity = serializers.IntegerField(min_value=1, max_value=20, default=1)


class BasketSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    """What is being priced: items from one seller, how it is handed over,
    and a discount code. Used to show the total before paying."""

    items = BasketItemSerializer(many=True, required=False)
    # One product, the Buy now on a product page. Turned into `items`.
    option = serializers.IntegerField(required=False, allow_null=True)
    quantity = serializers.IntegerField(min_value=1, max_value=20, required=False)
    fulfilment = serializers.ChoiceField(choices=Order.Fulfilment.choices, default="pickup")
    code = serializers.CharField(max_length=30, required=False, allow_blank=True)


class OrderInputSerializer(BasketSerializer):
    """What a buyer sends to pay. The phone must already be verified in
    this browser, as for asking a question."""

    phone = PhoneNumberField()
    name = serializers.CharField(max_length=120)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["fulfilment"] == Order.Fulfilment.DELIVERY and not attrs.get("note", "").strip():
            raise serializers.ValidationError({"note": "Say where it should be delivered."})
        return attrs


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["product", "product_name", "option_label", "unit_price", "quantity"]


class OrderSerializer(serializers.ModelSerializer):
    """An order, as its buyer or its seller sees it."""

    items = OrderItemSerializer(many=True, read_only=True)
    delivery = serializers.SerializerMethodField()
    discount = serializers.SerializerMethodField()
    protected = serializers.SerializerMethodField()

    @extend_schema_field(serializers.CharField())
    def get_delivery(self, obj):
        return f"{obj.delivery_pesewas / 100:.2f}"

    @extend_schema_field(serializers.CharField())
    def get_discount(self, obj):
        return f"{obj.discount_pesewas / 100:.2f}"

    @extend_schema_field(serializers.BooleanField())
    def get_protected(self, obj):
        """Buyer protection: the seller is paid once the buyer has it."""
        return obj.payout != Order.Payout.SPLIT

    amount = serializers.SerializerMethodField()
    commission = serializers.SerializerMethodField()
    buyer_phone = serializers.CharField(read_only=True)
    seller_name = serializers.CharField(source="seller.business_name", read_only=True)
    seller_phone = serializers.SerializerMethodField()

    @extend_schema_field(serializers.CharField())
    def get_amount(self, obj):
        return f"{obj.amount_pesewas / 100:.2f}"

    @extend_schema_field(serializers.CharField())
    def get_commission(self, obj):
        return f"{obj.commission_pesewas / 100:.2f}"

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_seller_phone(self, obj):
        # Only once paid: the buyer needs it to arrange the handover, and an
        # unpaid order is not a reason to hand out a seller's number.
        return str(obj.seller.phone) if obj.status == "paid" else None

    class Meta:
        model = Order
        fields = [
            "reference",
            "product",
            "product_name",
            "unit_price",
            "quantity",
            "amount",
            "commission",
            "currency",
            "buyer_name",
            "buyer_phone",
            "fulfilment",
            "note",
            "items",
            "delivery",
            "discount",
            "discount_code",
            "status",
            "stage",
            "payout",
            "protected",
            "problem",
            "seller_name",
            "seller_phone",
            "paid_at",
            "delivered_at",
            "received_at",
            "created_at",
        ]


class DiscountCodeSerializer(serializers.ModelSerializer):
    def validate_code(self, value):
        value = "".join(value.split()).upper()
        if not value.isalnum():
            raise serializers.ValidationError("Use letters and numbers only, like SALE10.")
        return value

    class Meta:
        model = DiscountCode
        fields = ["id", "code", "percent", "ends_on", "active", "uses"]
        read_only_fields = ["uses"]


class ProductReportInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    reason = serializers.ChoiceField(choices=ProductReport.Reason.choices)
    details = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    phone = PhoneNumberField(required=False, allow_null=True)


class QuoteInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    trade = serializers.SlugField()
    area = serializers.SlugField(required=False, allow_blank=True)
    title = serializers.CharField(max_length=160)
    details = serializers.CharField(max_length=2000)
    quantity = serializers.CharField(max_length=60, required=False, allow_blank=True)
    budget = serializers.CharField(max_length=60, required=False, allow_blank=True)
    needed_by = serializers.DateField(required=False, allow_null=True)
    name = serializers.CharField(max_length=120)
    phone = PhoneNumberField()
