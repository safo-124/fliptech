"""Region and Area.

Section 04 of the product documentation specifies URLs of the form
/greater-accra/welding-training and /tema/welding-training, and the Screen 1
filter bar filters by area. Neither is possible with an address string, so the
geography is a table.
"""

from django.contrib.gis.db import models as gis_models
from django.core.exceptions import ValidationError
from django.db import models

from core.models import TimeStampedModel


class Region(TimeStampedModel):
    """One of Ghana's sixteen regions."""

    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)

    # Section 04 warns against thin templates. A region page is generated only
    # once it has real inventory; below the threshold it is noindexed.
    is_launched = models.BooleanField(
        default=False,
        help_text="Greater Accra is the launch market. Others stay unlisted until they have providers.",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def clean(self):
        """Keep region and area slugs in their shared public URL namespace."""
        super().clean()
        if self.slug and Area.objects.filter(slug=self.slug).exists():
            raise ValidationError(
                {"slug": "This slug is already used by an area, and both share the URL namespace."}
            )


class Area(TimeStampedModel):
    """A town or district within a region, such as Tema or Madina."""

    region = models.ForeignKey(Region, on_delete=models.PROTECT, related_name="areas")
    name = models.CharField(max_length=100)

    # Globally unique, not unique-per-region: the slug is the first segment of
    # a public URL (/tema/welding-training), so two areas named Tema in
    # different regions would collide. Region slugs share that namespace, so
    # an area may not reuse a region's slug either — enforced in clean().
    slug = models.SlugField(max_length=100, unique=True)

    # Fallback origin for the radius search when a trainee declines the browser
    # location prompt. Section 04 says results are ordered by distance from the
    # point the user chose, and a chosen area needs a point.
    centroid = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)

    class Meta:
        ordering = ["region__name", "name"]
        constraints = [
            models.UniqueConstraint(fields=["region", "name"], name="unique_area_name_per_region")
        ]

    def __str__(self):
        return f"{self.name}, {self.region.name}"

    def clean(self):
        super().clean()
        if self.centroid is not None and self.centroid.empty:
            raise ValidationError(
                {"centroid": "Set a real point or leave the fallback search origin blank."}
            )
        if self.slug and Region.objects.filter(slug=self.slug).exists():
            raise ValidationError(
                {"slug": "This slug is already used by a region, and both share the URL namespace."}
            )
