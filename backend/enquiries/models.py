"""Enquiry, EnquiryOutcome and Enrolment.

The important structural point in the whole data model lives here. Section 12
of the product documentation accepts leakage as a fact of the business: a
trainee finds a workshop, calls directly, and the platform never sees the
enrolment. So Enrolment stands on its own with an *optional* link back to an
Enquiry, and completion and attestation hang off Enrolment rather than off
EnquiryOutcome.

If they hung off EnquiryOutcome, the graduate record underpinning Section 08
would only ever contain platform-attributed trainees — the minority — and the
employer-matching option the architecture is supposed to preserve would arrive
in year two with a fraction of the real population.
"""

import secrets
import uuid

from django.conf import settings
from django.db import models
from phonenumber_field.modelfields import PhoneNumberField

from core.models import TimeStampedModel


def generate_reference():
    """Short, unambiguous and quotable over a phone call.

    No vowels, so it cannot spell anything; no 0/O or 1/I, which are the pairs
    people misread aloud.
    """
    alphabet = "23456789BCDFGHJKLMNPQRSTVWXYZ"
    return "SH-" + "".join(secrets.choice(alphabet) for _ in range(6))


class PhoneVerification(TimeStampedModel):
    """A one-time code issued to a trainee's phone.

    Codes are stored hashed, never in plaintext: a leaked backup should not be a
    list of live codes. The row is retained after use because it is also the
    record that lets a second and third enquiry in the same session skip a fresh
    SMS.
    """

    class Purpose(models.TextChoices):
        TRAINEE_ENQUIRY = "trainee_enquiry", "Trainee enquiry"
        TRAINER_ACCESS = "trainer_access", "Trainer access"

    # A public, unguessable handle lets the verification endpoint consume the
    # exact challenge it issued. Phone plus "latest code" is sufficient for the
    # low-risk enquiry flow, but it is not a safe authentication boundary for a
    # trainer account when requests can overlap or be replayed.
    challenge_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    purpose = models.CharField(
        max_length=30,
        choices=Purpose.choices,
        default=Purpose.TRAINEE_ENQUIRY,
        db_index=True,
    )
    phone = PhoneNumberField(db_index=True)
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    verified_at = models.DateTimeField(null=True, blank=True)

    # Kept for the per-connection daily cap. Section 10 commits to minimal
    # collection, so nothing else about the request is stored.
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["phone", "purpose", "-created_at"])]

    def __str__(self):
        return f"Code for {self.phone}"

    @property
    def is_expired(self):
        from django.utils import timezone

        return timezone.now() >= self.expires_at


class Enquiry(TimeStampedModel):
    """A trainee contacting a provider. The conversation then moves to WhatsApp."""

    class State(models.TextChoices):
        PENDING_VERIFICATION = "pending_verification", "Awaiting phone verification"
        SENT = "sent", "Sent to provider"
        FAILED = "failed", "Delivery failed"
        SPAM = "spam", "Marked as spam"

    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="enquiries"
    )
    programme = models.ForeignKey(
        "catalog.Programme", on_delete=models.SET_NULL, null=True, related_name="enquiries"
    )
    intake = models.ForeignKey(
        "catalog.Intake", on_delete=models.SET_NULL, null=True, blank=True, related_name="enquiries"
    )

    # Phone number and enquiry history only. No identity documents, no email —
    # Section 10, and most trainees have no email address anyway.
    trainee_phone = PhoneNumberField(db_index=True)
    trainee_name = models.CharField(max_length=120, blank=True)
    message = models.TextField(blank=True)

    reference_code = models.CharField(
        max_length=12, unique=True, default=generate_reference, editable=False
    )
    state = models.CharField(
        max_length=25, choices=State.choices, default=State.PENDING_VERIFICATION
    )

    # Verify the number once per session, not once per enquiry: Screen 4
    # encourages enquiring with three providers, and three SMS per trainee is
    # both a cost on the free side and three points of friction.
    phone_verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "enquiries"
        indexes = [models.Index(fields=["provider", "-created_at"])]

    def __str__(self):
        return f"{self.reference_code} to {self.provider.name}"


class EnquiryOutcome(TimeStampedModel):
    """What happened to an enquiry, limited to what can honestly be observed.

    Completion and attestation deliberately do NOT live here. See the module
    docstring.
    """

    enquiry = models.OneToOneField(Enquiry, on_delete=models.CASCADE, related_name="outcome")

    replied = models.BooleanField(default=False)
    replied_at = models.DateTimeField(null=True, blank=True)
    visited = models.BooleanField(default=False)
    enrolled = models.BooleanField(default=False)

    # The conversation happens on WhatsApp by design, so none of the above can
    # be observed by the platform. Every one of these is reported by a human.
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    note = models.CharField(max_length=300, blank=True)

    def __str__(self):
        return f"Outcome for {self.enquiry.reference_code}"


class Enrolment(TimeStampedModel):
    """A person who actually started a programme, however they found it.

    Captured during the monthly provider conversation that Section 04 already
    requires for reporting enrolments, so it covers every trainee at a listed
    workshop rather than only the attributed ones.
    """

    class Attestation(models.TextChoices):
        NOT_ASKED = "not_asked", "Not asked yet"
        RECOMMENDED = "recommended", "Would recommend for paid work"
        NOT_RECOMMENDED = "not_recommended", "Would not recommend"

    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.PROTECT, related_name="enrolments"
    )
    programme = models.ForeignKey(
        "catalog.Programme", on_delete=models.PROTECT, related_name="enrolments"
    )
    intake = models.ForeignKey(
        "catalog.Intake",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="enrolments",
    )

    # Nullable on purpose. Most enrolments will have no enquiry behind them.
    enquiry = models.OneToOneField(
        Enquiry,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="enrolment",
        help_text="Set only when this enrolment came through the platform.",
    )

    trainee_phone = PhoneNumberField(db_index=True)
    trainee_name = models.CharField(max_length=120, blank=True)
    started_on = models.DateField()

    # Cedis of course fees. Section 07 calls this the number that decides
    # retention, and it cannot be measured automatically.
    fee_paid = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # --- The two fields that make Section 08 possible ---
    # Nothing in version 1 reads either of them. They cannot be reconstructed
    # later: a platform that starts recording them in year three has no
    # graduate history until year four.
    completed_on = models.DateField(
        null=True, blank=True, help_text="Did this person finish the programme, and when."
    )
    provider_attestation = models.CharField(
        max_length=20,
        choices=Attestation.choices,
        default=Attestation.NOT_ASKED,
        help_text="Would you recommend this graduate for paid work?",
    )
    attested_on = models.DateField(null=True, blank=True)

    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["-started_on"]
        indexes = [
            models.Index(fields=["provider", "-started_on"]),
            # The stage-two graduate search: trade and area come through
            # programme and provider, but completion is the first filter.
            models.Index(fields=["completed_on", "provider_attestation"]),
        ]

    def __str__(self):
        return f"{self.trainee_phone} on {self.programme.title}"

    @property
    def is_graduate(self):
        return self.completed_on is not None
