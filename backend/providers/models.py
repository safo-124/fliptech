"""Provider and everything attached to it.

Two rules from DATA_MODEL.md shape this module and should survive refactoring:

1. Verification and GovernmentStatus are separate tables and are never joined
   into one displayed field. There is deliberately no `is_verified` boolean on
   Provider. A provider can be visited by Fliiptech with no CTVET record, or
   hold a CTVET registration and never have been visited, and both states must
   render honestly. Collapsing them is the change most likely to create a legal
   problem later.

2. Public photographs and private evidence never share a bucket. They are two
   models bound to two storages rather than one model with a visibility flag —
   see the note on ProviderEvidence.
"""

from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.contrib.postgres.indexes import GinIndex
from django.core.files.storage import storages
from django.db import models
from phonenumber_field.modelfields import PhoneNumberField
from simple_history.models import HistoricalRecords

from core.images import prepare_logo, strip_exif, stripped_name
from core.models import TimeStampedModel


def private_storage():
    """Second R2 bucket, signed URLs only. Configured in settings.STORAGES."""
    return storages["private"]


class ProviderQuerySet(models.QuerySet):
    def published(self):
        return self.filter(status=Provider.Status.PUBLISHED)

    def for_card(self):
        """Annotate the three numbers Screen 1 puts on the card.

        Computed in one query rather than per row: at forty providers the
        difference is invisible, but the page-weight and first-paint budgets in
        Section 10 leave no room for an N+1 once the list grows.
        """
        from django.utils import timezone

        active = models.Q(
            programmes__is_active=True,
            programmes__trade__is_active=True,
        )
        available_places = models.Q(programmes__intakes__places_remaining__isnull=True) | models.Q(
            programmes__intakes__places_remaining__gt=0
        )
        upcoming = (
            models.Q(
                programmes__is_active=True,
                programmes__trade__is_active=True,
                programmes__intakes__is_open=True,
                programmes__intakes__start_date__gte=timezone.localdate(),
            )
            & available_places
        )
        return self.annotate(
            lowest_fee=models.Min("programmes__fee", filter=active),
            shortest_duration_weeks=models.Min("programmes__duration_weeks", filter=active),
            next_intake=models.Min("programmes__intakes__start_date", filter=upcoming),
        )

    def with_related(self):
        """Everything the card and profile serializers touch."""
        from django.db.models import Prefetch
        from django.utils import timezone

        from catalog.models import Intake, Programme

        public_intakes = (
            Intake.objects.filter(
                is_open=True,
                start_date__gte=timezone.localdate(),
            )
            .filter(models.Q(places_remaining__isnull=True) | models.Q(places_remaining__gt=0))
            .order_by("start_date", "pk")
        )

        return self.select_related("area", "area__region", "government_status").prefetch_related(
            "photos",
            "verifications",
            Prefetch(
                "programmes",
                queryset=Programme.objects.filter(is_active=True, trade__is_active=True)
                .select_related("trade")
                .prefetch_related(Prefetch("intakes", queryset=public_intakes)),
            ),
        )


class PremisesTenure(models.TextChoices):
    """How the workshop holds its premises.

    A rented or shared yard is not a problem in itself, but it changes what a
    site visit should check and how durable the listing's address is.
    """

    OWNED = "owned", "Owned"
    RENTED = "rented", "Rented"
    SHARED = "shared", "Shared or family premises"


class Provider(TimeStampedModel):
    """A workshop or training centre."""

    objects = ProviderQuerySet.as_manager()

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        CHANGES_REQUESTED = "changes_requested", "Changes requested"
        PENDING_APPROVAL = "pending_approval", "Pending approval"
        PUBLISHED = "published", "Published"
        SUSPENDED = "suspended", "Suspended"

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200)

    owner_name = models.CharField(max_length=200, blank=True)
    owner_phone = PhoneNumberField(blank=True)
    contact_phone = PhoneNumberField(
        help_text="The number a trainee is handed over to on WhatsApp."
    )

    area = models.ForeignKey("geography.Area", on_delete=models.PROTECT, related_name="providers")
    address = models.CharField(max_length=300, blank=True)
    # A street address does not find a workshop in Accra and a GPS pin dropped
    # from a phone can be tens of metres out. The landmark is what the field
    # officer actually navigates by on the site visit, so it is asked for
    # separately rather than hoped for inside `address`.
    # The workshop's own mark, if it has one.
    #
    # Optional, and that is a product decision rather than laziness: the target
    # provider is a master craft person in the informal sector, and most have
    # no logo at all. Requiring one would keep real workshops off the site,
    # which Section 03 names as the failure that matters. The card falls back
    # to the provider's initials.
    logo = models.ImageField(upload_to="logos/%Y/%m/", blank=True)

    landmark = models.CharField(
        max_length=200,
        blank=True,
        help_text="The nearest well-known place. For example: behind Tema Community 1 market.",
    )

    # Asked because they are the questions a workshop that does not exist
    # cannot answer consistently, and because they cost one tap each.
    year_established = models.PositiveSmallIntegerField(null=True, blank=True)
    premises_tenure = models.CharField(
        max_length=20,
        choices=PremisesTenure.choices,
        blank=True,
    )
    trainer_count = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="People who teach at this workshop, including the owner."
    )
    trainee_count = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Trainees enrolled when the listing was submitted."
    )

    # Section 09 puts a site visit at the centre of onboarding, so a
    # self-submitted listing has to carry consent for one. Timestamps rather
    # than booleans: when a trainee disputes a fee, the answer is what was
    # declared and when, which a boolean cannot answer.
    declared_accurate_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the trainer last attested that fees and dates are current.",
    )
    site_visit_consent_at = models.DateTimeField(null=True, blank=True)

    # geography=True so distance comes back in metres over the spheroid, which
    # is what "within 10 kilometres of a point" in Section 05 means.
    location = gis_models.PointField(geography=True, srid=4326)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    published_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)

    # Section 09: prompted every 90 days, marked unconfirmed after 30 days
    # without a reply, and the date last checked is shown on the listing.
    last_confirmed_at = models.DateTimeField(null=True, blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["area", "slug"], name="unique_provider_slug_per_area")
        ]
        indexes = [
            GinIndex(name="provider_name_trgm", fields=["name"], opclasses=["gin_trgm_ops"]),
            models.Index(fields=["status", "area"]),
        ]
        # Section 09 requires a second pair of eyes before a listing goes live.
        # Publishing is therefore its own permission, not implied by change:
        # a field officer can draft and edit, only an operations lead can
        # publish. See the setup_groups management command.
        permissions = [("publish_provider", "Can publish a provider listing")]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # Same contract as ProviderPhoto: `_committed` is False only for a
        # freshly assigned upload, so an ordinary edit does not re-encode the
        # logo on every save.
        if self.logo and not self.logo._committed:
            content, is_png = prepare_logo(self.logo)
            if content is not None:
                self.logo.save(stripped_name(self.logo.name, png=is_png), content, save=False)
        super().save(*args, **kwargs)

    @property
    def is_listing_stale(self):
        """True once the 90-day confirmation has lapsed by a further 30 days."""
        from datetime import timedelta

        from django.utils import timezone

        if self.last_confirmed_at is None:
            return self.published_at is not None
        return timezone.now() - self.last_confirmed_at > timedelta(days=120)


class TrainerAccount(TimeStampedModel):
    """A passwordless, non-staff trainer identity verified by phone.

    Anyone can sign up as a trainer, so a sign-up is not trusted until someone
    with the confirm permission (the super admin by default) confirms it. An
    unconfirmed trainer can still draft and submit a listing, so nobody waits
    on staff to start typing, but that listing cannot be published until the
    account is confirmed.
    """

    class Approval(models.TextChoices):
        PENDING = "pending", "Waiting for confirmation"
        CONFIRMED = "confirmed", "Confirmed"
        DECLINED = "declined", "Declined"

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MANAGER = "manager", "Manager"
        LEAD_TRAINER = "lead_trainer", "Lead trainer"

    class IdentityDocument(models.TextChoices):
        GHANA_CARD = "ghana_card", "Ghana Card"
        PASSPORT = "passport", "Passport"
        VOTER_ID = "voter_id", "Voter ID"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trainer_account",
    )
    phone = PhoneNumberField(unique=True)
    phone_verified_at = models.DateTimeField()

    # A second way into the same account, not a second account.
    #
    # The phone stays the identity: it is what a workshop replies to on
    # WhatsApp, so an account without one has nowhere for an enquiry to go.
    # Email is an added, separately verified route for signing in — useful for
    # someone whose SMS is unreliable, which on a prepaid Ghanaian network is
    # common.
    #
    # Unique, so one address cannot open two accounts, and null rather than
    # blank so the uniqueness constraint ignores every account that has not
    # added one. A blank string would collide on the second account.
    email = models.EmailField(unique=True, null=True, blank=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    # A verified phone proves someone holds a SIM, not that they are who they
    # say or that they speak for the workshop. These are what the confirming
    # admin is actually deciding on.
    full_name = models.CharField(max_length=200, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, blank=True)

    # The document itself is NOT here. It is a ProviderEvidence row of kind
    # ID_DOCUMENT, which already writes to private storage that the web server
    # is never pointed at — Section 10 requires identity documents are never
    # publicly served. Only the type and number live on the account, so the
    # queue is reviewable without opening a file.
    id_document_type = models.CharField(max_length=20, choices=IdentityDocument.choices, blank=True)
    id_document_number = models.CharField(max_length=60, blank=True)

    # Section 10: the platform holds personal data and needs a lawful basis
    # recorded, not assumed.
    data_consent_at = models.DateTimeField(null=True, blank=True)

    approval_status = models.CharField(
        max_length=20,
        choices=Approval.choices,
        default=Approval.PENDING,
        db_index=True,
    )
    approval_decided_at = models.DateTimeField(null=True, blank=True)
    approval_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    approval_note = models.CharField(
        max_length=300,
        blank=True,
        help_text="Shown to the trainer when a sign-up is declined.",
    )

    class Meta:
        ordering = ["phone"]
        permissions = [
            ("confirm_trainer", "Can confirm or decline trainer sign-ups"),
        ]

    @property
    def is_confirmed(self):
        return self.approval_status == self.Approval.CONFIRMED

    def __str__(self):
        return str(self.phone)


class ProviderMembership(TimeStampedModel):
    """Structural ownership used to scope every trainer-facing provider query."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"

    trainer = models.ForeignKey(
        TrainerAccount,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    provider = models.ForeignKey(
        Provider,
        on_delete=models.CASCADE,
        related_name="trainer_memberships",
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.OWNER)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["trainer"],
                name="one_provider_membership_per_trainer",
            ),
            models.UniqueConstraint(
                fields=["provider"],
                name="one_trainer_membership_per_provider",
            ),
        ]

    def __str__(self):
        return f"{self.trainer} owns {self.provider}"


class ProviderPhoto(TimeStampedModel):
    """A public photograph, served from the public bucket."""

    class Kind(models.TextChoices):
        """What the photograph shows.

        Two questions a trainee asks are different: "is this a real place I can
        get to" and "is the work any good". A picture of a tidy yard answers
        the first and says nothing about the second, and a close-up of a welded
        gate answers the second and says nothing about the first. Storing which
        is which lets the profile show both rather than a single undifferentiated
        gallery, and lets the submission check ask for one of each.
        """

        WORKSHOP = "workshop", "The workshop"
        WORK = "work", "Work they have done"

    provider = models.ForeignKey(Provider, on_delete=models.CASCADE, related_name="photos")
    kind = models.CharField(
        max_length=20,
        choices=Kind.choices,
        default=Kind.WORKSHOP,
        db_index=True,
    )
    image = models.ImageField(upload_to="providers/%Y/%m/")
    caption = models.CharField(max_length=200, blank=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    # Phone photographs carry GPS coordinates. Section 10 commits to minimal
    # collection, and an un-stripped photo can expose an owner's home address.
    exif_stripped = models.BooleanField(default=False)

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["display_order", "created_at"]

    def __str__(self):
        return f"Photo of {self.provider.name}"

    def save(self, *args, **kwargs):
        # `_committed` is False only for a freshly assigned upload, so editing a
        # caption does not re-encode the photograph on every save.
        if self.image and not self.image._committed and not self.exif_stripped:
            cleaned = strip_exif(self.image)
            if cleaned is not None:
                self.image.save(stripped_name(self.image.name), cleaned, save=False)
                self.exif_stripped = True
        super().save(*args, **kwargs)


class ProviderEvidence(TimeStampedModel):
    """Verification evidence and owner identification. Never publicly served.

    This is a separate model from ProviderPhoto rather than one media table with
    a visibility flag, because Django binds storage at the field, not the
    instance: a single FileField cannot route to two buckets per row. Splitting
    the models makes the separation structural — a mis-set boolean cannot leak
    an identity document, because private files physically cannot be written to
    the public bucket.
    """

    class Kind(models.TextChoices):
        VERIFICATION_EVIDENCE = "verification_evidence", "Verification evidence"
        ID_DOCUMENT = "id_document", "Owner identification"

    provider = models.ForeignKey(Provider, on_delete=models.CASCADE, related_name="evidence")
    verification = models.ForeignKey(
        "providers.Verification",
        on_delete=models.CASCADE,
        related_name="evidence",
        null=True,
        blank=True,
    )
    kind = models.CharField(max_length=30, choices=Kind.choices)
    file = models.FileField(upload_to="evidence/%Y/%m/", storage=private_storage)
    note = models.CharField(max_length=200, blank=True)
    exif_stripped = models.BooleanField(default=False)

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "provider evidence"

    def __str__(self):
        return f"{self.get_kind_display()} for {self.provider.name}"

    def save(self, *args, **kwargs):
        # Evidence is often a photograph of a certificate taken on a phone, so
        # it carries GPS too. Scanned PDFs pass through untouched: strip_exif
        # returns None for anything Pillow cannot read, and exif_stripped stays
        # False rather than claiming a strip that never happened.
        if self.file and not self.file._committed and not self.exif_stripped:
            cleaned = strip_exif(self.file)
            if cleaned is not None:
                self.file.save(stripped_name(self.file.name), cleaned, save=False)
                self.exif_stripped = True
        super().save(*args, **kwargs)


class Verification(TimeStampedModel):
    """One completed Fliiptech site visit. History is retained, never overwritten."""

    class Outcome(models.TextChoices):
        PASSED = "passed", "Passed"
        PASSED_WITH_NOTES = "passed_with_notes", "Passed with notes"
        FAILED = "failed", "Failed"

    provider = models.ForeignKey(Provider, on_delete=models.CASCADE, related_name="verifications")
    visited_on = models.DateField()
    officer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="verifications"
    )

    # Stated in plain words on the profile screen, because Screen 3 says outright
    # what was checked and that it is not a government accreditation.
    checks_performed = models.TextField(
        help_text="What was actually checked, in plain words. Shown to trainees verbatim."
    )
    outcome = models.CharField(max_length=20, choices=Outcome.choices)
    notes = models.TextField(blank=True)

    # Section 09 flags a verification older than 12 months for a repeat visit.
    expires_on = models.DateField(null=True, blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["-visited_on"]
        get_latest_by = "visited_on"

    def __str__(self):
        return f"{self.provider.name} verified {self.visited_on:%d %b %Y}"


class GovernmentStatus(TimeStampedModel):
    """CTVET registration as documented. Kept apart from Verification by design.

    Every status field can say no. A field that can say no is what makes the
    field mean anything when it says yes.
    """

    class Status(models.TextChoices):
        REGISTERED = "registered", "Registered"
        NOT_REGISTERED = "not_registered", "Not registered"
        NOT_CLAIMED = "not_claimed", "Not claimed"
        CLAIMED_NOT_VERIFIED = "claimed_not_verified", "Claimed, not independently verified"

    provider = models.OneToOneField(
        Provider, on_delete=models.CASCADE, related_name="government_status"
    )
    registration_status = models.CharField(
        max_length=30, choices=Status.choices, default=Status.NOT_CLAIMED
    )
    registration_number = models.CharField(max_length=100, blank=True)
    accreditation_status = models.CharField(
        max_length=30, choices=Status.choices, default=Status.NOT_CLAIMED
    )
    documented_on = models.DateField(null=True, blank=True)
    source_note = models.CharField(
        max_length=300,
        blank=True,
        help_text="Where this came from. Displayed exactly as documented, never inferred.",
    )

    history = HistoricalRecords()

    class Meta:
        verbose_name_plural = "government statuses"

    def __str__(self):
        return f"{self.provider.name}: {self.get_registration_status_display()}"


# Module-level alias so drf-spectacular can import it for ENUM_NAME_OVERRIDES.
# registration_status and accreditation_status draw on the same choice set, and
# without a name for it the generated schema invents two.
GOVERNMENT_RECORD_STATUS_CHOICES = GovernmentStatus.Status.choices


class ListingConfirmation(TimeStampedModel):
    """One prompt-and-response in the Section 09 freshness cycle.

    A log rather than a timestamp, so "confirmed last week" can be told apart
    from "never prompted".
    """

    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        SMS = "sms", "SMS"
        PHONE = "phone", "Phone call"
        VISIT = "visit", "Site visit"

    provider = models.ForeignKey(Provider, on_delete=models.CASCADE, related_name="confirmations")
    prompted_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    channel = models.CharField(max_length=20, choices=Channel.choices, default=Channel.WHATSAPP)
    fees_confirmed = models.BooleanField(default=False)
    intakes_confirmed = models.BooleanField(default=False)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-prompted_at"]

    def __str__(self):
        return f"Confirmation for {self.provider.name}"


class Suspension(TimeStampedModel):
    """A listing suspended by staff, with the reason logged.

    Section 09 requires the reason. Suspension follows a complaint about a real
    business, so this is the record to produce if the decision is challenged.
    """

    provider = models.ForeignKey(Provider, on_delete=models.CASCADE, related_name="suspensions")
    reason = models.CharField(max_length=200)
    detail = models.TextField(blank=True)
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="suspensions_raised"
    )
    started_at = models.DateTimeField()
    lifted_at = models.DateTimeField(null=True, blank=True)
    lifted_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        state = "active" if self.lifted_at is None else "lifted"
        return f"{self.provider.name} suspension ({state})"
