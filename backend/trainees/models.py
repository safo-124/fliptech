"""Trainee accounts, saved providers and staff support sessions.

Section 10 limits trainee data to a phone number and enquiry history. A trainee
account therefore adds nothing beyond that: a verified phone, an optional name
the trainee typed themselves, and which messaging app they prefer. No email, no
identity documents, no date of birth.

The account exists so a trainee can see their own enquiries and enrolments in
one place, and so staff can help them when they are stuck. It is optional:
enquiries still work for a trainee who never opens their account page.
"""

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone
from phonenumber_field.modelfields import PhoneNumberField
from simple_history.models import HistoricalRecords

from core.models import TimeStampedModel


class TraineeAccount(TimeStampedModel):
    """A passwordless, non-staff trainee identity verified by phone."""

    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        TELEGRAM = "telegram", "Telegram"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trainee_account",
    )
    phone = PhoneNumberField(unique=True)
    phone_verified_at = models.DateTimeField()
    display_name = models.CharField(
        max_length=120,
        blank=True,
        help_text="Typed by the trainee. Optional.",
    )
    preferred_channel = models.CharField(
        max_length=20,
        choices=Channel.choices,
        default=Channel.WHATSAPP,
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Untick to stop this number signing in. History is kept.",
    )
    last_seen_at = models.DateTimeField(null=True, blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "trainee"
        verbose_name_plural = "trainees"
        permissions = [
            ("support_access", "Can open a trainee dashboard to help them (view only)"),
            ("support_edit", "Can make changes while helping a trainee"),
            ("erase_trainee", "Can erase a trainee's personal data on request"),
        ]

    def __str__(self):
        return self.display_name or str(self.phone)


class SavedProvider(TimeStampedModel):
    """A provider a trainee wants to come back to."""

    trainee = models.ForeignKey(
        TraineeAccount,
        on_delete=models.CASCADE,
        related_name="saved_providers",
    )
    provider = models.ForeignKey(
        "providers.Provider",
        on_delete=models.CASCADE,
        related_name="saved_by",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["trainee", "provider"],
                name="one_save_per_trainee_provider",
            )
        ]

    def __str__(self):
        return f"{self.trainee} saved {self.provider}"


def default_support_expiry():
    return timezone.now() + timedelta(seconds=settings.SUPPORT_SESSION_SECONDS)


class SupportSessionQuerySet(models.QuerySet):
    def live(self):
        return self.filter(ended_at__isnull=True, expires_at__gt=timezone.now())


class SupportSession(models.Model):
    """A member of staff viewing a trainee's dashboard to help them.

    Every session carries a reason, a hard expiry and a log of what was done.
    It is personal data being looked at by someone other than its owner, and
    the Data Protection Act expects that to be accountable after the fact.
    """

    class EndReason(models.TextChoices):
        ENDED_BY_STAFF = "ended_by_staff", "Ended by staff"
        EXPIRED = "expired", "Expired"
        REPLACED = "replaced", "Replaced by a new session"
        STAFF_SIGNED_OUT = "staff_signed_out", "Staff signed out"
        ACCOUNT_DISABLED = "account_disabled", "Trainee account disabled"

    staff_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_sessions",
    )
    # Kept when the account is closed or erased: the log of who looked at an
    # account outlives the account, and holds no phone number of its own.
    trainee = models.ForeignKey(
        TraineeAccount,
        on_delete=models.SET_NULL,
        null=True,
        related_name="support_sessions",
    )
    reason = models.CharField(max_length=300)
    can_edit = models.BooleanField(
        default=False,
        help_text="Granted only when the staff member holds the support edit permission.",
    )
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    expires_at = models.DateTimeField(default=default_support_expiry)
    ended_at = models.DateTimeField(null=True, blank=True)
    end_reason = models.CharField(max_length=30, choices=EndReason.choices, blank=True)

    objects = SupportSessionQuerySet.as_manager()

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["staff_user", "-started_at"])]

    def __str__(self):
        return f"{self.staff_user} helping {self.trainee or 'a closed account'}"

    @property
    def is_live(self):
        return self.ended_at is None and self.expires_at > timezone.now()


class SupportSessionEvent(models.Model):
    """One thing that happened during a support session."""

    session = models.ForeignKey(
        SupportSession,
        on_delete=models.CASCADE,
        related_name="events",
    )
    action = models.CharField(max_length=60)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.action} at {self.created_at:%Y-%m-%d %H:%M}"
