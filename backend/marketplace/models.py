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

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from phonenumber_field.modelfields import PhoneNumberField

from core.images import strip_exif, stripped_name
from core.models import TimeStampedModel


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
