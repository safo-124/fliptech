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

from core.images import has_transparency, strip_exif, stripped_name
from core.models import TimeStampedModel

# Shown at most a few hundred pixels across: on the trade page, in empty states
# and on share cards.
MAX_TRADE_PICTURE_EDGE = 1024


def prepare_trade_picture(django_file):
    """(content, is_png) for a trade's painted picture; (None, False) if unreadable."""
    as_png = has_transparency(django_file)
    content = strip_exif(django_file, max_edge=MAX_TRADE_PICTURE_EDGE, keep_transparency=True)
    return (content, as_png) if content is not None else (None, False)


class Trade(TimeStampedModel):
    """Welding, tailoring, plumbing and so on. A fixed list, never free text."""

    class Colour(models.TextChoices):
        """Each trade's accent, taken from what the trade works with.

        Someone scanning a column of results looks for their trade before they
        read a name, and a colour is found faster than a word. Named after the
        material rather than the hue, so the choice for a new trade is obvious.
        The hex values live in the site's stylesheet (frontend globals.css).
        """

        SPARK = "spark", "Spark orange: welding, metalwork"
        DYE = "dye", "Dye blue: tailoring, textiles"
        CORAL = "coral", "Coral: hair and beauty"
        TIMBER = "timber", "Timber brown: carpentry, furniture"
        SIGNAL = "signal", "Signal yellow: electrical, solar"
        STEEL = "steel", "Steel blue-grey: mechanics, machines"
        CLAY = "clay", "Clay red: building, plumbing, tiling"
        LEAF = "leaf", "Leaf green: food, farming"
        VIOLET = "violet", "Brand violet: anything else"

    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    colour = models.CharField(max_length=10, choices=Colour.choices, default=Colour.VIOLET)
    # The trade's hand-painted signboard picture, in the style of Ghana's
    # painted barber and salon signs. Commissioned from a sign painter, so most
    # trades have none at first: the site shows the trade's icon in its colour
    # until one is uploaded.
    picture = models.ImageField(
        upload_to="trades/",
        blank=True,
        help_text="The hand-painted signboard picture for this trade. Square, 600px or larger.",
    )

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

    def save(self, *args, **kwargs):
        # A photographed painting carries the phone's metadata like any other
        # photograph. Re-encoded only when freshly uploaded, and kept as PNG if
        # the painter's file has a transparent background.
        if self.picture and not self.picture._committed:
            content, as_png = prepare_trade_picture(self.picture)
            if content is not None:
                self.picture.save(stripped_name(self.picture.name, png=as_png), content, save=False)
        super().save(*args, **kwargs)


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

    # What the fee leaves out, as money. The four booleans above can only say
    # "extra"; a trainee weighing GHC1,800 against GHC2,000 needs to know the
    # first also means GHC300 of hair to practise on. The listing shows the
    # fee, what it covers and this as a receipt, with a total to plan for.
    extra_costs = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
        help_text="Roughly what a trainee spends on top of the fee, in cedis. Blank if unknown.",
    )
    extra_costs_note = models.CharField(
        max_length=200,
        blank=True,
        help_text="What that money is for. For example: hair and extensions to practise on.",
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
