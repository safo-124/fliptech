"""Shared base models.

Structural rule 2 in DATA_MODEL.md requires a timestamp and an author on every
change to a provider or a verification. TimeStampedModel carries the
timestamps; django-simple-history carries the author and the full history.
"""

from django.conf import settings
from django.db import models

from .images import strip_exif, stripped_name


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class RelayedText(models.Model):
    """A text message the server cannot send yet, waiting for a person to.

    Only written with SMS_PROVIDER=backoffice, a stand-in until an SMS gateway
    is registered: staff see each sign-in code in the back office and send it
    on themselves. See core/relay.py, including why the body does not outlive
    the code in it.
    """

    to = models.CharField(max_length=32)
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    relayed_at = models.DateTimeField(null=True, blank=True)
    relayed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "code to send"
        verbose_name_plural = "codes to send"

    def __str__(self):
        return f"Text to {self.to}"


class HomePicture(TimeStampedModel):
    """A photograph on the home page, chosen by staff.

    The home page has four places for a picture: the large one beside the
    search, and one on each of the three cards that lead into training,
    online learning and the marketplace. Each place holds one picture, and
    an empty place falls back to something real from the site — a
    workshop's photograph, a course's still, a product — and then to the
    plain card. So the page never shows a picture somebody has to explain.

    Staff-chosen rather than taken from listings because these speak for the
    whole site, not one workshop. A photograph of one workshop's premises
    used as the face of the site would read as an endorsement it never got.

    Credit is shown beside the picture whenever it is filled in. A Creative
    Commons photograph requires it, and leaving it out breaches the licence.
    """

    class Slot(models.TextChoices):
        HERO = "hero", "Beside the search, at the top"
        TRAINING = "training", "Find training card"
        LEARNING = "learning", "Online learning card"
        MARKETPLACE = "marketplace", "Marketplace card"

    slot = models.CharField(max_length=20, choices=Slot.choices, unique=True)
    image = models.ImageField(upload_to="home/%Y/%m/")
    alt_text = models.CharField(
        max_length=200,
        help_text="What the picture shows, for somebody who cannot see it. "
        "For example: “A tailor sewing kente at a machine.”",
    )
    credit = models.CharField(
        max_length=200,
        blank=True,
        help_text="Who took it and under what licence, when it is not your own. "
        "For example: “Photo: Sir Amugi, CC BY-SA 4.0”.",
    )
    # Phone photographs carry GPS, as everywhere else on the site.
    exif_stripped = models.BooleanField(default=False, editable=False)

    class Meta:
        ordering = ["slot"]
        verbose_name = "home page picture"

    def __str__(self):
        return self.get_slot_display()

    def save(self, *args, **kwargs):
        # Only for a freshly chosen file, so editing the credit does not
        # re-encode the picture.
        if self.image and not self.image._committed:
            cleaned = strip_exif(self.image)
            if cleaned is not None:
                self.image.save(stripped_name(self.image.name), cleaned, save=False)
                self.exif_stripped = True
        super().save(*args, **kwargs)
