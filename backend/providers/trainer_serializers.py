"""Input validation for passwordless trainer profile onboarding."""

from django.utils import timezone
from django.utils.translation import gettext as _
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers

from catalog.models import Trade
from core.media import public_url
from geography.models import Area

from .models import (
    PremisesTenure,
    ProviderPhoto,
    ProviderVideo,
    TeachingLanguage,
    TrainerAccount,
)
from .serializers import video_sources


class RejectUnknownFieldsMixin:
    """Fail closed when a client attempts to mass-assign a server-owned field."""

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError(
                    dict.fromkeys(sorted(unknown), _("This field is not accepted."))
                )
        return super().to_internal_value(data)


class TrainerOTPVerifySerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    challenge_id = serializers.UUIDField()
    phone = PhoneNumberField()
    code = serializers.CharField(min_length=4, max_length=8, trim_whitespace=True)


class TrainerEmailCodeRequestSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    email = serializers.EmailField()


class TrainerEmailCodeVerifySerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    challenge_id = serializers.UUIDField()
    email = serializers.EmailField()
    code = serializers.CharField(min_length=4, max_length=8, trim_whitespace=True)


class TrainerIntakeInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    """The intake a trainer offers.

    `places_remaining` is deliberately not accepted. It is an operational
    counter that moves as trainees enrol, not a profile field — letting the
    form post it meant every save silently reset it to the number offered.
    It is seeded from `places_offered` when the intake is created and left
    alone afterwards. See save_owned_profile.
    """

    start_date = serializers.DateField()
    places_offered = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    is_open = serializers.BooleanField(required=False, default=True)

    def validate_start_date(self, value):
        if value > timezone.localdate():
            return value
        # A date already stored on this profile is accepted unchanged. A trainer
        # asked for changes months after submitting would otherwise be blocked
        # by an intake date that expired while they were waiting on the review,
        # on a step they were not asked to revisit.
        if value == self.context.get("current_intake_start_date"):
            return value
        raise serializers.ValidationError(_("Choose a future intake date."))


class TrainerProgrammeInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    trade_id = serializers.PrimaryKeyRelatedField(
        source="trade",
        queryset=Trade.objects.filter(is_active=True),
    )
    title = serializers.CharField(max_length=200)
    fee = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    instalments_allowed = serializers.BooleanField(required=False, default=False)
    instalment_note = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        default="",
    )
    duration_weeks = serializers.IntegerField(min_value=1, max_value=520)
    hours_per_week = serializers.IntegerField(
        min_value=1,
        max_value=168,
        required=False,
        allow_null=True,
        default=None,
    )
    weekly_schedule = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        default="",
    )
    fee_includes_tools = serializers.BooleanField(required=False, default=False)
    fee_includes_materials = serializers.BooleanField(required=False, default=False)
    fee_includes_ppe = serializers.BooleanField(required=False, default=False)
    fee_includes_certificate = serializers.BooleanField(required=False, default=False)
    certificate_awarded = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )
    extra_costs = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=0,
        required=False,
        allow_null=True,
        default=None,
    )
    extra_costs_note = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )
    capacity = serializers.IntegerField(
        min_value=1,
        required=False,
        allow_null=True,
        default=None,
    )
    intake = TrainerIntakeInputSerializer(required=False, allow_null=True, default=None)

    def validate(self, attrs):
        if not attrs.get("instalments_allowed"):
            attrs["instalment_note"] = ""
        return attrs


class TrainerProfileInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    # --- the person, which lives on TrainerAccount rather than on Provider ---
    # Carried on this one form so the wizard saves everything in a single
    # request: on a connection that drops, two round trips is two chances to
    # lose what was typed.
    full_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    role = serializers.ChoiceField(
        choices=TrainerAccount.Role.choices, required=False, allow_blank=True, default=""
    )
    id_document_type = serializers.ChoiceField(
        choices=TrainerAccount.IdentityDocument.choices,
        required=False,
        allow_blank=True,
        default="",
    )
    id_document_number = serializers.CharField(
        max_length=60, required=False, allow_blank=True, default=""
    )

    # --- the workshop ---
    name = serializers.CharField(max_length=200)
    owner_name = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        default="",
    )
    contact_phone = PhoneNumberField()
    area_id = serializers.PrimaryKeyRelatedField(source="area", queryset=Area.objects.all())
    address = serializers.CharField(
        max_length=300,
        required=False,
        allow_blank=True,
        default="",
    )
    landmark = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        default="",
    )
    # Public, unlike the landmark above. See Provider.directions.
    directions = serializers.CharField(
        max_length=300,
        required=False,
        allow_blank=True,
        default="",
    )

    # The master who teaches, for the listing's portrait strip.
    lead_trainer_name = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    in_trade_since = serializers.IntegerField(
        min_value=1940, max_value=2100, required=False, allow_null=True, default=None
    )
    apprentices_trained = serializers.IntegerField(
        min_value=0, max_value=10000, required=False, allow_null=True, default=None
    )
    teaching_languages = serializers.ListField(
        child=serializers.ChoiceField(choices=TeachingLanguage.choices),
        required=False,
        default=list,
        max_length=len(TeachingLanguage.choices),
    )

    def validate_in_trade_since(self, value):
        if value is not None and value > timezone.localdate().year:
            raise serializers.ValidationError(_("That year has not happened yet."))
        return value

    def validate_teaching_languages(self, value):
        # Once each, in the order offered.
        return [code for code in TeachingLanguage.values if code in value]

    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)

    year_established = serializers.IntegerField(
        min_value=1900, max_value=2100, required=False, allow_null=True
    )
    premises_tenure = serializers.ChoiceField(
        choices=PremisesTenure.choices, required=False, allow_blank=True, default=""
    )
    trainer_count = serializers.IntegerField(
        min_value=0, max_value=500, required=False, allow_null=True
    )
    trainee_count = serializers.IntegerField(
        min_value=0, max_value=5000, required=False, allow_null=True
    )

    # Declarations. Sent as booleans and stored as timestamps: when a trainee
    # disputes a fee, "they ticked a box" is not an answer and "they declared
    # it accurate on 14 March" is.
    declared_accurate = serializers.BooleanField(required=False, default=False)
    site_visit_consent = serializers.BooleanField(required=False, default=False)
    data_consent = serializers.BooleanField(required=False, default=False)

    # Null when saved from a step before the course one. The wizard saves the
    # workshop on the way to the photos, which upload against a saved row, and
    # the course step comes after them. Submission still needs a course: see
    # submission_blockers.
    programme = TrainerProgrammeInputSerializer(required=False, allow_null=True, default=None)


# --- Upload schemas -------------------------------------------------------
#
# These describe the multipart endpoints in trainer_uploads.py for
# drf-spectacular. They are documentation, NOT validation: the views check
# uploads through admin_upload.validate_image_upload, which is shared with the
# staff photograph endpoint so the two cannot drift, and which reports size and
# type problems in words a trainer can act on. Declaring them here is what
# stops the generated schema silently omitting three endpoints.


class TrainerPhotoUploadSerializer(serializers.Serializer):
    image = serializers.ImageField()
    kind = serializers.ChoiceField(
        choices=ProviderPhoto.Kind.choices, required=False, allow_blank=True
    )
    caption = serializers.CharField(max_length=200, required=False, allow_blank=True)
    # For kind=before: the photo of the finished work it pairs with.
    before_of = serializers.IntegerField(required=False)


class TrainerPhotoSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    kind = serializers.CharField()
    url = serializers.CharField()
    caption = serializers.CharField()
    before_of = serializers.IntegerField(allow_null=True)


class TrainerVideoInputSerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    """What the trainer is about to send, before any of it is sent.

    The size is what lets an upload that would be refused be refused now,
    rather than after an hour of somebody's mobile data. The name is only
    for the trainer: it is how their screen recognises the same file when
    they pick it again to carry on an upload that was interrupted.
    """

    title = serializers.CharField(max_length=100)
    name = serializers.CharField(max_length=255, allow_blank=True, required=False, default="")
    size = serializers.IntegerField(min_value=1)


class TrainerVideoSerializer(serializers.ModelSerializer):
    kind = serializers.SerializerMethodField()
    poster = serializers.SerializerMethodField()
    sources = serializers.SerializerMethodField()

    class Meta:
        model = ProviderVideo
        fields = [
            "id",
            "title",
            "kind",
            "youtube_id",
            "status",
            "review_note",
            "failure_reason",
            "upload_name",
            "upload_size",
            "upload_received",
            "duration_seconds",
            "poster",
            "sources",
            "created_at",
        ]

    def get_kind(self, obj):
        return "youtube" if obj.is_youtube else "upload"

    # Approved videos only, for the same reason as on the public listing:
    # before then the files are in private storage, which no trainer-facing
    # response points at.
    def get_poster(self, obj):
        if not obj.public_poster:
            return None
        return public_url(obj.public_poster.url, self.context.get("request"))

    def get_sources(self, obj):
        return video_sources(obj, self.context.get("request"))


class TrainerLogoUploadSerializer(serializers.Serializer):
    logo = serializers.ImageField()


class TrainerLogoSerializer(serializers.Serializer):
    url = serializers.CharField()


class TrainerIdentityDocumentSerializer(serializers.Serializer):
    document = serializers.ImageField()


class TrainerIdentityStoredSerializer(serializers.Serializer):
    """Deliberately carries no URL.

    Section 10 requires identity documents are never publicly served, so the
    only thing the trainer is told is whether the upload landed.
    """

    stored = serializers.BooleanField()
