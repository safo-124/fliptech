"""Shared base models.

Structural rule 2 in DATA_MODEL.md requires a timestamp and an author on every
change to a provider or a verification. TimeStampedModel carries the
timestamps; django-simple-history carries the author and the full history.
"""

from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
