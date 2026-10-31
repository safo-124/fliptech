"""Who sells on Skills Hub, and what they sell.

The marketplace is the third pillar: trainees find training, anyone can learn
online, and the people on this site sell what they make. Most of them are the
workshops already listed — a tailor who teaches sewing also sells bags — but
not all. Somebody who makes soap and teaches nobody is a seller too.

Why a SellerAccount rather than a flag on TrainerAccount or another Provider
---------------------------------------------------------------------------

A `Provider` is a training workshop. It carries programmes, intakes, site
visits, government registration and a place in the training directory. A soap
maker with no classes has none of that, and putting one in the Provider table
would either show an empty workshop in training search or add an `exclude()`
to every query that must not show it — the thin-listing problem Section 04
warns about, created deliberately.

A flag on `TrainerAccount` fails the other way: a seller-only person has no
trainer account, and giving them one would put them in the trainer
confirmation queue and a dashboard about listings and intakes they do not
have.

So selling is its own identity. A workshop that also sells gets a
SellerAccount linked to its Provider; a person who only sells gets one with
`provider` left null. Products hang off the seller either way, which is what
lets one marketplace list both without a branch in every query.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone
from phonenumber_field.modelfields import PhoneNumberField

from core.images import strip_exif, stripped_name
from core.models import TimeStampedModel
from enquiries.models import generate_reference


class SellerAccount(TimeStampedModel):
    """A passwordless, phone-verified identity that may list products.

    Mirrors TrainerAccount deliberately: the same sign-up is not trusted
    until a member of staff confirms it, and the same reasoning applies —
    anyone can claim to make leather bags, and a verified phone proves
    somebody holds a SIM, not that they make anything.

    The difference is what confirmation gates. A trainer's listing cannot be
    published until the account is confirmed; a seller's products cannot be
    either. Both let the person do the work of filling things in first, so
    nobody waits on staff to start typing.
    """

    class Approval(models.TextChoices):
        PENDING = "pending", "Waiting for confirmation"
        CONFIRMED = "confirmed", "Confirmed"
        DECLINED = "declined", "Declined"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="seller_account",
    )

    # The phone is the identity, as everywhere else on this site: it is what a
    # buyer messages on WhatsApp, so an account without one has no way to be
    # reached about an order.
    phone = PhoneNumberField(unique=True)
    phone_verified_at = models.DateTimeField()

    # A second way in, not a second account. Null rather than blank so the
    # uniqueness constraint ignores every account that has not added one; a
    # blank string would collide on the second.
    email = models.EmailField(unique=True, null=True, blank=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)

    # What a buyer sees above the product. Not the person's legal name: a
    # market trader is known by the stall, and "Ama Crafts" is the thing
    # somebody remembers and searches for.
    # Blank until they fill it in. The account is created the moment a phone
    # is verified, the way a trainer's is, so nobody is told "finish this
    # form" before they can even sign in. `may_sell` is what requires it.
    business_name = models.CharField(max_length=200, blank=True)
    about = models.TextField(
        blank=True,
        help_text="A few lines about what they make. Shown on the seller's products.",
    )

    # Where the goods are. A buyer in Tema needs to know a bag is in Adenta
    # before they ask about it, because at this stage the seller arranges
    # delivery themselves and distance is the whole cost.
    area = models.ForeignKey(
        "geography.Area",
        on_delete=models.PROTECT,
        related_name="sellers",
        null=True,
        blank=True,
    )

    # Set when the seller is a workshop already listed for training. Null for
    # somebody who only sells. OneToOne because a workshop is one business:
    # two seller accounts against one Provider would split its products in
    # half with no way for a buyer to see them together.
    provider = models.OneToOneField(
        "providers.Provider",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="seller_account",
        help_text="The training listing this seller is, when they are also a workshop.",
    )

    is_active = models.BooleanField(default=True)

    # Section 10: a lawful basis for holding personal data is recorded, not
    # assumed.
    data_consent_at = models.DateTimeField(null=True, blank=True)

    approval_status = models.CharField(
        max_length=20,
        choices=Approval.choices,
        default=Approval.PENDING,
        db_index=True,
    )
    approval_decided_at = models.DateTimeField(null=True, blank=True)
    approval_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    approval_note = models.CharField(
        max_length=300,
        blank=True,
        help_text="Shown to the seller when a sign-up is declined.",
    )

    # A wide picture across the top of the shop page. A Shop plan benefit:
    # stored for anyone, shown only while their plan is running.
    banner = models.ImageField(upload_to="shops/%Y/%m/", blank=True)

    # Where a buyer's money goes when they pay on the site: a Paystack split
    # subaccount, as a trainer's course money does (courses/models.py).
    # Only the last four digits of the number are kept here; Paystack holds
    # the rest.
    paystack_subaccount = models.CharField(max_length=64, blank=True)
    payout_bank_code = models.CharField(max_length=40, blank=True)
    payout_bank_name = models.CharField(max_length=120, blank=True)
    payout_account_last4 = models.CharField(max_length=4, blank=True)
    payout_account_name = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["business_name"]
        permissions = [
            ("confirm_seller", "Can confirm or decline seller sign-ups"),
        ]

    def __str__(self):
        return self.business_name or str(self.phone)

    @property
    def is_confirmed(self):
        return self.approval_status == self.Approval.CONFIRMED

    @property
    def may_sell(self):
        """Everything that has to be true before a product of theirs is public.

        Confirmed and switched on, and the shop actually filled in: a buyer
        needs a name to recognise and a place to collect from, and a product
        with neither is not a listing. ProductQuerySet.visible() is the same
        rule in SQL, and a test holds the two together.
        """
        return bool(self.is_active and self.is_confirmed and self.business_name and self.area_id)

    @property
    def payout_ready(self):
        """Whether a buyer can pay this seller on the site."""
        return bool(self.paystack_subaccount)


class ProductQuerySet(models.QuerySet):
    def visible(self):
        """What the public marketplace may show.

        Every clause is load-bearing. A product is published, *and* its
        seller is still allowed to sell — so suspending a seller takes their
        whole shelf down in one action rather than leaving published products
        behind it. This is SellerAccount.may_sell expressed in SQL; the two
        are held together by a test, because a rule that drifts between the
        Python and the query is how something stays visible after the object
        says it should not be.
        """
        return self.filter(
            status=Product.Status.PUBLISHED,
            seller__is_active=True,
            seller__approval_status=SellerAccount.Approval.CONFIRMED,
            seller__area__isnull=False,
        ).exclude(seller__business_name="")


class Product(TimeStampedModel):
    """Something a seller makes, listed for a buyer to enquire about.

    There is no cart and no checkout. A buyer messages the seller, the same
    way a trainee enquires about a course, because a payment integration has
    its own onboarding and compliance lead time and this does not need to wait
    for it. The price is shown so nobody has to ask what should be on a label.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        # Taken down by staff. Distinct from the seller withdrawing it, which
        # is a return to DRAFT: a buyer who complains and a seller who sold out
        # are different events and the queue must tell them apart.
        SUSPENDED = "suspended", "Taken down by staff"

    class Availability(models.TextChoices):
        """Not a stock count.

        A number nobody updates is worse than no number: a seller on a phone
        between customers will not keep "12 in stock" true, and a buyer who
        travels for a bag that went last week does not come back. These three
        are answerable honestly at a glance, which is the only kind of answer
        that stays accurate.
        """

        AVAILABLE = "available", "Ready now"
        MADE_TO_ORDER = "made_to_order", "Made to order"
        SOLD_OUT = "sold_out", "Sold out"

    seller = models.ForeignKey(
        SellerAccount,
        on_delete=models.CASCADE,
        related_name="products",
    )
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220)
    description = models.TextField(blank=True)

    # Cedis, like every other price on the site. Null means "ask" — a real
    # pattern here for something made to order, and more honest than inventing
    # a number the seller would have to argue down.
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
        help_text="Leave empty for 'price on request'.",
    )

    # The same trades that organise training, so a tailoring workshop's bags
    # sit under tailoring and one taxonomy serves both pillars.
    trade = models.ForeignKey(
        "catalog.Trade",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="products",
    )

    availability = models.CharField(
        max_length=20,
        choices=Availability.choices,
        default=Availability.AVAILABLE,
        db_index=True,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )

    # Why a product was taken down, for the seller and for whoever reviews the
    # decision later. Staff-written, never the seller's.
    staff_note = models.CharField(max_length=300, blank=True)

    objects = ProductQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["seller", "slug"],
                name="unique_product_slug_per_seller",
            ),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        """Publishing asks about the seller, not just the product.

        Checked here as well as in the view so a row written from the back
        office or a management command cannot route around it.
        """
        super().clean()
        if self.status == self.Status.PUBLISHED and self.seller_id and not self.seller.may_sell:
            raise ValidationError(
                {"status": "This seller is not confirmed, so their products cannot be published."}
            )


class ProductPhoto(TimeStampedModel):
    """A picture of the thing itself, served from the public bucket."""

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="photos",
    )
    image = models.ImageField(upload_to="products/%Y/%m/")
    caption = models.CharField(max_length=200, blank=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    # Phone photographs carry GPS. Somebody photographing a bag on their own
    # table is publishing their home address unless this happens.
    exif_stripped = models.BooleanField(default=False)

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["display_order", "created_at"]

    def __str__(self):
        return f"Photo of {self.product.name}"

    def save(self, *args, **kwargs):
        # `_committed` is False only for a freshly assigned upload, so editing
        # a caption does not re-encode the photograph on every save.
        if self.image and not self.image._committed and not self.exif_stripped:
            cleaned = strip_exif(self.image)
            if cleaned is not None:
                self.image.save(stripped_name(self.image.name), cleaned, save=False)
                self.exif_stripped = True
        super().save(*args, **kwargs)


class ProductEnquiry(TimeStampedModel):
    """A buyer asking a seller about something they make.

    No cart and no checkout. Money passes between the two of them, as it does
    in a market today — but the asking passes through here, because otherwise
    nobody can answer "is anyone buying?". That question is the whole reason
    this model exists rather than a wa.me link on the product page: a link
    works and leaves no trace, and a marketplace you cannot measure is one you
    cannot decide anything about.

    Verification is the same bargain the training enquiry makes: no account,
    but one code per browser session, shared with the training flow. A buyer
    who asked about a course an hour ago does not type another.
    """

    class State(models.TextChoices):
        SENT = "sent", "Sent to seller"
        SPAM = "spam", "Marked as spam"

    seller = models.ForeignKey(SellerAccount, on_delete=models.CASCADE, related_name="enquiries")
    # SET_NULL, not CASCADE. A seller tidying their shelf must not delete the
    # evidence that people were asking — that is the number the marketplace
    # is judged on.
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="enquiries",
    )
    # What they asked about, kept as text so the row still means something
    # after the product itself is gone.
    product_name = models.CharField(max_length=200)

    buyer_phone = PhoneNumberField(db_index=True)
    buyer_name = models.CharField(max_length=120, blank=True)
    message = models.TextField(blank=True)

    reference_code = models.CharField(
        max_length=12, unique=True, default=generate_reference, editable=False
    )
    state = models.CharField(max_length=20, choices=State.choices, default=State.SENT)
    phone_verified_at = models.DateTimeField()

    # When the buyer was texted a link to review the seller. Once only, set
    # by `manage.py marketplace_daily`.
    review_requested_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "product enquiries"
        indexes = [models.Index(fields=["seller", "-created_at"])]

    def __str__(self):
        return f"{self.reference_code} about {self.product_name}"


class SellerNotice(TimeStampedModel):
    """A WhatsApp message the system asks staff to send a seller.

    The same arrangement as OwnerNotice, and for the same reason: a
    business-initiated WhatsApp message needs Cloud API credentials nobody
    has yet, so the system queues it and an officer sends it from their own
    phone with a wa.me link.

    Its own model rather than OwnerNotice because that one hangs off a
    Provider, and half the sellers have no workshop.
    """

    class Kind(models.TextChoices):
        NEW_ENQUIRY = "new_enquiry", "Someone asked about a product"
        NEW_ORDER = "new_order", "Someone paid for a product"

    seller = models.ForeignKey(SellerAccount, on_delete=models.CASCADE, related_name="notices")
    kind = models.CharField(max_length=30, choices=Kind.choices)
    enquiry = models.ForeignKey(
        ProductEnquiry,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="alerts",
    )
    order = models.ForeignKey(
        "Order",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="alerts",
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # One alert per enquiry, so a retried request cannot have the
            # seller messaged twice about the same question.
            models.UniqueConstraint(
                fields=["enquiry"],
                condition=models.Q(enquiry__isnull=False),
                name="one_seller_alert_per_enquiry",
            ),
            models.UniqueConstraint(
                fields=["order"],
                condition=models.Q(order__isnull=False),
                name="one_seller_alert_per_order",
            ),
        ]

    def __str__(self):
        return f"{self.get_kind_display()}: {self.seller}"


# --------------------------------------------------------------------------
# Numbers a seller can act on


class ProductViewDay(models.Model):
    """How many browsers opened a product's page on one day.

    One row per product per day rather than one per view: a seller wants
    "40 people looked this week", and a row per view is a table that grows
    with every bot. Each browser counts once a day (marketplace/stats.py).
    """

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="view_days")
    day = models.DateField()
    views = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["product", "day"], name="one_product_view_count_per_day"
            ),
        ]

    def __str__(self):
        return f"{self.product_id} on {self.day}: {self.views}"


# --------------------------------------------------------------------------
# Money: what a seller pays Fliiptech, and what a buyer pays a seller


def payment_reference(prefix):
    """Unguessable, and prefixed so Paystack's webhook knows whose it is:
    fc- a course, fm- a seller paying Fliiptech, fo- a buyer's order."""
    return f"{prefix}-{secrets.token_hex(10)}"


class PaymentStatus(models.TextChoices):
    PENDING = "pending", "Waiting for payment"
    PAID = "paid", "Paid"
    FAILED = "failed", "Not paid"


class SellerPaymentQuerySet(models.QuerySet):
    def running(self, at=None):
        at = at or timezone.now()
        return self.filter(status=PaymentStatus.PAID, starts_at__lte=at, ends_at__gt=at)

    def boosts(self):
        return self.filter(kind__in=SellerPayment.BOOST_KINDS)

    def plans(self):
        return self.filter(kind=SellerPayment.Kind.PLAN_MONTH)


class SellerPayment(TimeStampedModel):
    """A seller paying Fliiptech: a boost for one product, or a month of
    the Shop plan.

    One model for both because they are the same thing to Paystack and to
    the books: an amount, a reference and a period. The period is set when
    the payment is confirmed, not when it starts, so time spent on
    Paystack's page is not time lost from what was bought. A second boost
    or month bought while one is running starts where it ends.

    No automatic renewal. Mobile money cannot be charged again without the
    person approving it on their phone, so each period is paid for when it
    is wanted, and `marketplace_daily` reminds them a few days before.
    """

    class Kind(models.TextChoices):
        BOOST_WEEK = "boost_week", "Boost for a week"
        BOOST_MONTH = "boost_month", "Boost for a month"
        PLAN_MONTH = "plan_month", "Shop plan for a month"

    BOOST_KINDS = (Kind.BOOST_WEEK, Kind.BOOST_MONTH)
    DAYS = {Kind.BOOST_WEEK: 7, Kind.BOOST_MONTH: 30, Kind.PLAN_MONTH: 30}

    reference = models.CharField(max_length=40, unique=True)
    seller = models.ForeignKey(SellerAccount, on_delete=models.PROTECT, related_name="payments")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    # The boosted product. SET_NULL: a seller deleting a product must not
    # delete the record that they paid.
    product = models.ForeignKey(
        Product, on_delete=models.SET_NULL, null=True, blank=True, related_name="boosts"
    )
    # A boost the Shop plan gave for free, pointing at that month's plan.
    # One per month, which is what makes this a field and not a flag.
    plan_credit_of = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="free_boost",
    )
    amount_pesewas = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="GHS")
    status = models.CharField(
        max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.PENDING, db_index=True
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    gateway_response = models.CharField(max_length=200, blank=True)
    channel = models.CharField(max_length=30, blank=True)
    # When the "your plan ends soon" text went, so it goes once.
    reminded_at = models.DateTimeField(null=True, blank=True)

    objects = SellerPaymentQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "kind", "ends_at"])]

    def __str__(self):
        return f"{self.get_kind_display()} — {self.seller} ({self.get_status_display()})"

    @property
    def amount(self):
        return self.amount_pesewas / 100

    def start(self, now=None):
        """Set the period: from now, or from the end of the one running."""
        now = now or timezone.now()
        same = SellerPayment.objects.running(now).exclude(pk=self.pk)
        if self.kind in self.BOOST_KINDS:
            same = same.boosts().filter(product_id=self.product_id)
        else:
            same = same.plans().filter(seller_id=self.seller_id)
        latest = same.order_by("-ends_at").values_list("ends_at", flat=True).first()
        self.starts_at = max(now, latest) if latest else now
        self.ends_at = self.starts_at + timedelta(days=self.DAYS[self.kind])


def plan_running(seller, at=None):
    """The Shop plan payment covering now, or None."""
    return SellerPayment.objects.running(at).plans().filter(seller=seller).first()


class Order(TimeStampedModel):
    """A buyer paying a seller for a product, on the site.

    The money goes to the seller's Paystack subaccount in the same charge;
    Fliiptech's commission is taken by Paystack as the main account's share
    (`transaction_charge`), so Fliiptech never holds the seller's money.
    Refunds and disputes are handled by staff from the Paystack dashboard
    and recorded here by hand; there is no automatic escrow.

    Everything the buyer saw is copied onto the order, so it still means
    what it said after the seller edits or deletes the product.
    """

    class Fulfilment(models.TextChoices):
        PICKUP = "pickup", "Collect from the seller"
        DELIVERY = "delivery", "Seller delivers"

    class Stage(models.TextChoices):
        NEW = "new", "Paid, not yet handed over"
        DELIVERED = "delivered", "Handed over"
        REFUNDED = "refunded", "Refunded by staff"

    reference = models.CharField(max_length=40, unique=True)
    seller = models.ForeignKey(SellerAccount, on_delete=models.PROTECT, related_name="orders")
    product = models.ForeignKey(
        Product, on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    product_name = models.CharField(max_length=200)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.PositiveSmallIntegerField(
        default=1, validators=[MinValueValidator(1), MaxValueValidator(20)]
    )
    amount_pesewas = models.PositiveIntegerField()
    # Fliiptech's share, in pesewas, fixed when the order is made.
    commission_pesewas = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=3, default="GHS")

    buyer_phone = PhoneNumberField(db_index=True)
    buyer_name = models.CharField(max_length=120)
    fulfilment = models.CharField(
        max_length=10, choices=Fulfilment.choices, default=Fulfilment.PICKUP
    )
    # Where to deliver, or anything else the seller should know.
    note = models.TextField(blank=True, max_length=500)

    status = models.CharField(
        max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.PENDING, db_index=True
    )
    stage = models.CharField(max_length=10, choices=Stage.choices, default=Stage.NEW)
    paid_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    gateway_response = models.CharField(max_length=200, blank=True)
    channel = models.CharField(max_length=30, blank=True)
    review_requested_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["seller", "-created_at"])]

    def __str__(self):
        return f"{self.reference}: {self.product_name} x{self.quantity}"

    @property
    def amount(self):
        return self.amount_pesewas / 100


# --------------------------------------------------------------------------
# Reviews


class SellerReview(TimeStampedModel):
    """What a buyer said about a seller, after asking or buying.

    Only somebody who asked through the site (a verified phone) or paid on
    it can leave one, through a link texted to them, so a seller cannot
    review themselves from ten browsers. One per enquiry or order.
    """

    class Visibility(models.TextChoices):
        SHOWN = "shown", "Shown"
        HIDDEN = "hidden", "Hidden by staff"

    seller = models.ForeignKey(SellerAccount, on_delete=models.CASCADE, related_name="reviews")
    product = models.ForeignKey(
        Product, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviews"
    )
    product_name = models.CharField(max_length=200)
    enquiry = models.OneToOneField(
        ProductEnquiry, on_delete=models.SET_NULL, null=True, blank=True, related_name="review"
    )
    order = models.OneToOneField(
        Order, on_delete=models.SET_NULL, null=True, blank=True, related_name="review"
    )
    buyer_name = models.CharField(max_length=120, blank=True)
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    comment = models.TextField(blank=True, max_length=600)
    # Whether they bought. Paid orders are always true; somebody who only
    # asked says, so "4 stars, didn't buy" reads for what it is.
    bought = models.BooleanField(default=False)
    visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.SHOWN, db_index=True
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.rating}★ for {self.seller}"
