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

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Upper
from django.utils import timezone

from core.models import TimeStampedModel

# Cedis. A floor so a slip of the thumb does not list a course for 5 pesewas,
# and a ceiling well above any course here so a stray zero is caught.
MIN_PRICE = Decimal("1.00")
MAX_PRICE = Decimal("100000.00")


class CourseOffer(TimeStampedModel):
    """A workshop's course: its price, its page, and where its earnings go.

    Its own table rather than fields on Provider: Provider carries a full
    change history for disputes about fees and visits, and a payout account
    number has no business in that history.
    """

    class Level(models.TextChoices):
        BEGINNER = "beginner", "Beginner"
        INTERMEDIATE = "intermediate", "Some experience"
        ADVANCED = "advanced", "Advanced"

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

    # The course page, in the trainer's words. One item a line for the two
    # lists, so a trainer on a phone types them as they would a text.
    summary = models.TextField(max_length=1200, blank=True)
    outcomes = models.TextField("what you will learn", max_length=1500, blank=True)
    tools = models.TextField("what you need", max_length=1000, blank=True)
    level = models.CharField(max_length=20, choices=Level.choices, blank=True)

    # A launch price: lower than `price` until it ends. Never below the floor,
    # and only counts while it is lower than the full price.
    sale_price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(MIN_PRICE), MaxValueValidator(MAX_PRICE)],
    )
    sale_ends_at = models.DateTimeField(null=True, blank=True)

    # Shown first on /learn and on the home page until then: bought by the
    # workshop (CourseBoost), or set by staff.
    featured_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "course"

    def __str__(self):
        return f"{self.provider}: {self.price or 'free'}"

    @property
    def payout_ready(self):
        return bool(self.paystack_subaccount)

    @property
    def is_paid(self):
        return bool(self.price) and self.payout_ready

    @property
    def on_sale(self):
        if not (self.price and self.sale_price and self.sale_price < self.price):
            return False
        return self.sale_ends_at is None or self.sale_ends_at > timezone.now()

    @property
    def current_price(self):
        """What a trainee pays today, before any promo code."""
        return self.sale_price if self.on_sale else self.price

    @property
    def is_featured(self):
        return bool(self.featured_until and self.featured_until > timezone.now())

    def lines(self, field):
        return [
            line.strip(" -•\t") for line in getattr(self, field).splitlines() if line.strip(" -•\t")
        ]


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
    # A promo code used, and the price before it, so the trainer's sales say
    # what each code cost them.
    promo_code = models.CharField(max_length=20, blank=True)
    full_price_pesewas = models.PositiveIntegerField(null=True, blank=True)

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


# --------------------------------------------------------------------------
# Selling


class CoursePromoCode(TimeStampedModel):
    """A code a trainer hands out for money off their course."""

    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="course_codes"
    )
    code = models.CharField(max_length=20)
    percent_off = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(5), MaxValueValidator(90)]
    )
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    uses = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(Upper("code"), "provider", name="one_course_code_per_workshop")
        ]

    def __str__(self):
        return f"{self.code} ({self.percent_off}% off {self.provider})"

    @property
    def usable(self):
        if not self.is_active:
            return False
        if self.expires_at and self.expires_at <= timezone.now():
            return False
        return self.max_uses is None or self.uses < self.max_uses

    def apply(self, price):
        off = (price * self.percent_off / 100).quantize(Decimal("0.01"))
        return max(MIN_PRICE, price - off)


class CourseBoost(TimeStampedModel):
    """A workshop paying Fliiptech to show its course first for a while.

    The same rule as every payment here: it starts only once Paystack
    confirms a successful charge of exactly the amount asked. Reference
    prefix fk-, which is how the shared webhook knows it is one of these.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for payment"
        PAID = "paid", "Paid"
        FAILED = "failed", "Not paid"

    reference = models.CharField(max_length=40, unique=True)
    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.PROTECT, related_name="course_boosts"
    )
    days = models.PositiveSmallIntegerField()
    amount_pesewas = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="GHS")
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    gateway_response = models.CharField(max_length=200, blank=True)
    channel = models.CharField(max_length=30, blank=True)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.reference} {self.provider} {self.days} days"


# --------------------------------------------------------------------------
# Learning


class LessonProgress(TimeStampedModel):
    """How far one trainee has got with one lesson.

    `position` is where to pick up; `furthest` is the most they have
    reached, which is what decides "finished", so skipping back to rewatch
    a step never undoes it.
    """

    trainee = models.ForeignKey(
        "trainees.TraineeAccount", on_delete=models.CASCADE, related_name="lesson_progress"
    )
    video = models.ForeignKey(
        "providers.ProviderVideo", on_delete=models.CASCADE, related_name="progress"
    )
    # Denormalised from the video, for "my courses" without a join per row.
    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="lesson_progress"
    )
    position = models.PositiveIntegerField(default=0)
    furthest = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(fields=["trainee", "video"], name="one_progress_per_lesson")
        ]
        indexes = [models.Index(fields=["trainee", "provider"])]


class Certificate(TimeStampedModel):
    """Proof that a trainee finished every lesson of a course.

    Names are kept as they were on the day, so a certificate still says what
    it said after a workshop renames itself or a trainee changes their name.
    Anyone with the code can check it at /certificates/<code>.
    """

    code = models.CharField(max_length=12, unique=True)
    trainee = models.ForeignKey(
        "trainees.TraineeAccount", on_delete=models.CASCADE, related_name="certificates"
    )
    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="certificates"
    )
    trainee_name = models.CharField(max_length=120)
    course_name = models.CharField(max_length=200)
    area_name = models.CharField(max_length=120, blank=True)
    trade_name = models.CharField(max_length=120, blank=True)
    lessons = models.PositiveIntegerField()
    total_seconds = models.PositiveIntegerField(default=0)
    is_revoked = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["trainee", "provider"], name="one_certificate_per_course"
            )
        ]

    def __str__(self):
        return f"{self.code}: {self.trainee_name}, {self.course_name}"


class CourseReview(TimeStampedModel):
    """A learner's stars and words about a course, and the trainer's reply."""

    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="course_reviews"
    )
    trainee = models.ForeignKey(
        "trainees.TraineeAccount", on_delete=models.CASCADE, related_name="course_reviews"
    )
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    body = models.TextField(max_length=1000, blank=True)
    reply = models.TextField(max_length=1000, blank=True)
    replied_at = models.DateTimeField(null=True, blank=True)
    # Staff hide a review that breaks the rules; it stays for the record.
    is_hidden = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["provider", "trainee"], name="one_review_per_course")
        ]


class LessonQuestion(TimeStampedModel):
    """A learner's question under a lesson, and the trainer's answer."""

    video = models.ForeignKey(
        "providers.ProviderVideo", on_delete=models.CASCADE, related_name="questions"
    )
    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="lesson_questions"
    )
    trainee = models.ForeignKey(
        "trainees.TraineeAccount", on_delete=models.CASCADE, related_name="lesson_questions"
    )
    body = models.TextField(max_length=800)
    # The second in the lesson they were at when they asked, so the answer
    # can say "at 3:12".
    at_seconds = models.PositiveIntegerField(null=True, blank=True)
    answer = models.TextField(max_length=1500, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    answered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    is_hidden = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]


class LessonPlayDay(models.Model):
    """How many times a lesson was started on one day, by anybody.

    Counted per day rather than per play, so a busy lesson is one row a day,
    and the trainer's numbers need no personal data at all.
    """

    video = models.ForeignKey(
        "providers.ProviderVideo", on_delete=models.CASCADE, related_name="play_days"
    )
    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="lesson_play_days"
    )
    day = models.DateField()
    plays = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["video", "day"], name="one_play_count_per_lesson_day")
        ]
        indexes = [models.Index(fields=["provider", "day"])]

    def __str__(self):
        return f"{self.video_id} on {self.day}: {self.plays}"


class LessonCaption(TimeStampedModel):
    """Words on screen for one lesson, in one language, written by a person.

    Kept as WebVTT text in the database: a lesson's captions are a few tens
    of kilobytes, and served through the API they pass the same lock as the
    video itself.
    """

    video = models.ForeignKey(
        "providers.ProviderVideo", on_delete=models.CASCADE, related_name="captions"
    )
    language = models.CharField(max_length=10, default="en")
    label = models.CharField(max_length=40, default="English")
    vtt = models.TextField()

    class Meta:
        ordering = ["language"]
        constraints = [
            models.UniqueConstraint(fields=["video", "language"], name="one_caption_per_language")
        ]
