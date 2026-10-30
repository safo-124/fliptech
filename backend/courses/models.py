"""Paid courses: what a workshop charges for its lessons, and who has paid.

A course is a workshop's approved lessons (providers/learning.py). Most are
free. A trainer can set one price for the whole course; the first lesson
always stays free, so a trainee can judge the teaching before paying for it.

Money goes through Paystack, which Stripe owns and which is how Stripe
reaches Ghana: MTN MoMo, Telecel Cash, AirtelTigo Money, cards. Each payment
is split at Paystack straight to the trainer's own payout account (a Paystack
"subaccount"), so the trainer is paid without the money passing through
Fliiptech's hands. See courses/paystack.py.
"""

from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core.models import TimeStampedModel

# Cedis. A floor so a slip of the thumb does not list a course for 5 pesewas,
# and a ceiling well above any course here so a stray zero is caught.
MIN_PRICE = Decimal("1.00")
MAX_PRICE = Decimal("100000.00")


class CourseOffer(TimeStampedModel):
    """A workshop's course price and where its earnings are paid.

    Its own table rather than fields on Provider: Provider carries a full
    change history for disputes about fees and visits, and a payout account
    number has no business in that history.
    """

    provider = models.OneToOneField(
        "providers.Provider", on_delete=models.CASCADE, related_name="course_offer"
    )
    # Null is free. A price can only be set once the payout account exists,
    # so there is never a sale with nowhere for the money to go.
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(MIN_PRICE), MaxValueValidator(MAX_PRICE)],
        help_text="Cedis for the whole course. Empty is free. The first lesson is always free.",
    )

    # The Paystack subaccount the trainer's share is settled to.
    paystack_subaccount = models.CharField(max_length=40, blank=True)
    # What the trainer chose, kept so their dashboard can show it back. The
    # account number only ever in part: the whole of it lives at Paystack.
    payout_bank_code = models.CharField(max_length=20, blank=True)
    payout_bank_name = models.CharField(max_length=120, blank=True)
    payout_account_last4 = models.CharField(max_length=4, blank=True)
    payout_account_name = models.CharField(max_length=120, blank=True)

    class Meta:
        verbose_name = "course price"

    def __str__(self):
        return f"{self.provider}: {self.price or 'free'}"

    @property
    def payout_ready(self):
        return bool(self.paystack_subaccount)

    @property
    def is_paid(self):
        return bool(self.price) and self.payout_ready


class CoursePurchase(TimeStampedModel):
    """One attempt to buy one course, and what Paystack said about it.

    Created when the trainee taps Buy, before they pay, so every payment
    Paystack reports back has a row to match. Only a purchase confirmed by
    Paystack itself — verified by its API, or reported by its signed webhook,
    for exactly the amount asked — unlocks anything.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for payment"
        PAID = "paid", "Paid"
        FAILED = "failed", "Not paid"

    reference = models.CharField(max_length=40, unique=True)
    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.PROTECT, related_name="course_purchases"
    )
    trainee = models.ForeignKey(
        "trainees.TraineeAccount", on_delete=models.PROTECT, related_name="course_purchases"
    )
    # In pesewas, as Paystack counts it, fixed at the price when Buy was
    # tapped: a trainer changing the price mid-payment changes nothing here.
    amount_pesewas = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="GHS")
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    # Paystack's own words about it ("Approved", "Declined"), for staff.
    gateway_response = models.CharField(max_length=200, blank=True)
    channel = models.CharField(max_length=30, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["trainee", "provider", "status"])]

    def __str__(self):
        return f"{self.reference} {self.get_status_display()}"

    @property
    def amount(self):
        return Decimal(self.amount_pesewas) / 100


def has_paid(trainee, provider):
    return CoursePurchase.objects.filter(
        trainee=trainee, provider=provider, status=CoursePurchase.Status.PAID
    ).exists()
