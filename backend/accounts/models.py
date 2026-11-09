"""The account everyone gets: sign in with a phone, buy, keep your orders.

A customer account is the one thing every signed-in person has. Being a
trainee, a trainer or a seller is something added to it later, on the same
login (core/identities.py), when they ask for it. Buying needs nothing more
than this, and buying without an account still works: an order is made with
a verified phone, and signing in with that phone later shows it here, because
orders are matched to an account by its number rather than copied onto it.
"""

from django.conf import settings
from django.db import models
from phonenumber_field.modelfields import PhoneNumberField

from core.images import MAX_AVATAR_EDGE, strip_exif, stripped_name
from core.models import TimeStampedModel


class CustomerAccount(TimeStampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="customer_account"
    )
    phone = PhoneNumberField(unique=True)
    phone_verified_at = models.DateTimeField()
    # A second way in and somewhere to send receipts. Null rather than blank
    # so the uniqueness constraint ignores everyone without one.
    email = models.EmailField(unique=True, null=True, blank=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    display_name = models.CharField(max_length=120, blank=True)
    # Their own picture, shown to them in the site header and the app. Not on
    # any listing, and never shown to a seller or a workshop. Decoded,
    # stripped of its metadata (a phone photograph carries GPS) and made
    # small on save, however it arrives.
    photo = models.ImageField(upload_to="accounts/%Y/%m/", blank=True)
    # Filled in at checkout so the next order does not ask again.
    delivery_address = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.display_name or str(self.phone)

    def save(self, *args, **kwargs):
        if self.photo and not self.photo._committed:
            content = strip_exif(self.photo, max_edge=MAX_AVATAR_EDGE)
            if content is not None:
                self.photo.save(stripped_name(self.photo.name), content, save=False)
        super().save(*args, **kwargs)


class SavedProduct(models.Model):
    """A product kept for later, on the account so it follows the person
    from phone to phone. (Signed out, the heart keeps it in the browser.)"""

    account = models.ForeignKey(CustomerAccount, on_delete=models.CASCADE, related_name="saved")
    product = models.ForeignKey(
        "marketplace.Product", on_delete=models.CASCADE, related_name="saved_by"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # The price when saved (or when last told about a drop): a lower price
    # than this is "now cheaper" (marketplace_daily).
    price_seen = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["account", "product"], name="save_a_product_once"),
        ]

    def __str__(self):
        return f"{self.account} saved {self.product_id}"


class AppToken(models.Model):
    """A sign-in for the mobile app, kept on the phone in place of a cookie.

    The app sends it as `Authorization: Bearer <token>` (accounts/app_auth.py).
    Only a hash is stored: a copy of this table is not a copy of anybody's
    sign-in. Signing out of the app revokes it; staff can revoke one here too,
    for a lost phone.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="app_tokens"
    )
    key_hash = models.CharField(max_length=64, unique=True)
    # "Samsung SM-A145F", as the app says, so a person can tell their phones apart.
    device = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "app sign-in"

    def __str__(self):
        return f"{self.user} on {self.device or 'a phone'}"


class BagLine(models.Model):
    """One thing in a signed-in buyer's bag, kept on the account so the bag
    is the same on the phone and the website. Prices are never kept: the
    server prices the bag whenever it is shown or paid for."""

    account = models.ForeignKey(CustomerAccount, on_delete=models.CASCADE, related_name="bag")
    product = models.ForeignKey(
        "marketplace.Product", on_delete=models.CASCADE, related_name="in_bags"
    )
    option = models.ForeignKey(
        "marketplace.ProductOption",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="+",
    )
    quantity = models.PositiveSmallIntegerField(default=1)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["added_at", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "product", "option"], name="a_bag_line_once"
            ),
        ]

    def __str__(self):
        return f"{self.quantity} x {self.product_id} for {self.account_id}"


class DeliveryAddress(models.Model):
    """Saved delivery addresses, so checkout does not ask again."""

    LIMIT = 5

    account = models.ForeignKey(CustomerAccount, on_delete=models.CASCADE, related_name="addresses")
    label = models.CharField(max_length=40, blank=True)
    address = models.CharField(max_length=300)
    last_used_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_used_at"]

    def __str__(self):
        return self.label or self.address[:40]
