"""Shared base models.

Structural rule 2 in DATA_MODEL.md requires a timestamp and an author on every
change to a provider or a verification. TimeStampedModel carries the
timestamps; django-simple-history carries the author and the full history.
"""

from django.conf import settings
from django.db import models


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
