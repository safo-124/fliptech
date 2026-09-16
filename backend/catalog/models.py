"""Trade, Programme and Intake.

A Programme is a course a provider offers. An Intake is a dated start of one.
Screen 1 shows fee, duration and next intake on the card itself, which is the
single most important layout decision in the product — so all three have to be
cheap to query together.
"""

from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from simple_history.models import HistoricalRecords

from core.models import TimeStampedModel


class Trade(TimeStampedModel):
    """Welding, tailoring, plumbing and so on. A fixed list, never free text."""

    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)

    # Plain full-text search will not match "welder" to "welding", "sewing" to
    # "tailoring", or "fitter" to "auto mechanic" — and that is how people
    # actually type. Combined with the pg_trgm index below, this is what makes
    # the Postgres-only search decision in Section 05 hold up.
    synonyms = ArrayField(
        models.CharField(max_length=60),
        default=list,
        blank=True,
        help_text="Alternative words people search for. One per entry, lowercase.",
    )

    description = models.TextField(
        blank=True, help_text="Used on the /trades/<slug> explainer page."
    )
    display_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["display_order", "name"]
        indexes = [GinIndex(name="trade_name_trgm", fields=["name"], opclasses=["gin_trgm_ops"])]

    def __str__(self):
        return self.name


class Programme(TimeStampedModel):
    """A course offered by one provider. A provider has many."""

    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="programmes"
    )
    trade = models.ForeignKey(Trade, on_delete=models.PROTECT, related_name="programmes")

    title = models.CharField(max_length=200)

    # Cedis. A listing with no fee shown is what makes a trainee give up
    # (Section 03), so this is required rather than nullable.
    fee = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0)])
    instalments_allowed = models.BooleanField(default=False)
    instalment_note = models.CharField(max_length=200, blank=True)

    duration_weeks = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    hours_per_week = models.PositiveSmallIntegerField(null=True, blank=True)
    weekly_schedule = models.CharField(
        max_length=200, blank=True, help_text="For example: Mon-Thu, 8am to 2pm"
    )
    capacity = models.PositiveSmallIntegerField(null=True, blank=True)

    # What the fee actually covers.
    #
    # Section 03 makes the fee the single most important thing on the card: it
    # is what lets someone rule a provider out without a tap. A fee that
    # excludes tools and materials is not comparable with one that includes
    # them, so without this the comparison the product is built on is
    # misleading in exactly the cases that matter most.
    #
    # Four booleans rather than one multi-select field because the reviewing
    # admin scans these in a changelist, and because each is independently
    # answerable — "does GHC600 include the welding rods" is a question with a
    # yes or a no.
    fee_includes_tools = models.BooleanField(default=False)
    fee_includes_materials = models.BooleanField(default=False)
    fee_includes_ppe = models.BooleanField(
        default=False, help_text="Goggles, gloves, overalls and similar."
    )
    fee_includes_certificate = models.BooleanField(default=False)
    certificate_awarded = models.CharField(
        max_length=200,
        blank=True,
        help_text="What the trainee receives on completion. Left blank if nothing is awarded.",
    )

    is_active = models.BooleanField(default=True)
    history = HistoricalRecords()

    class Meta:
        ordering = ["provider", "title"]
        indexes = [models.Index(fields=["trade", "fee"])]

    def __str__(self):
        return f"{self.title} at {self.provider.name}"


class Intake(TimeStampedModel):
    """A dated start of a programme. Drives the Starts filter on Screen 1."""

    programme = models.ForeignKey(Programme, on_delete=models.CASCADE, related_name="intakes")
    start_date = models.DateField(db_index=True)
    places_offered = models.PositiveSmallIntegerField(null=True, blank=True)
    places_remaining = models.PositiveSmallIntegerField(null=True, blank=True)
    is_open = models.BooleanField(default=True)

    class Meta:
        ordering = ["start_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["programme", "start_date"], name="unique_intake_per_programme_date"
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(places_offered__isnull=True)
                    | models.Q(places_remaining__isnull=True)
                    | models.Q(places_remaining__lte=models.F("places_offered"))
                ),
                name="intake_remaining_lte_offered",
            ),
        ]

    def __str__(self):
        return f"{self.programme.title} starting {self.start_date:%d %b %Y}"

    def clean(self):
        """Keep the availability numbers internally possible."""
        super().clean()
        if (
            self.places_offered is not None
            and self.places_remaining is not None
            and self.places_remaining > self.places_offered
        ):
            raise ValidationError(
                {"places_remaining": "Places remaining cannot exceed places offered."}
            )
