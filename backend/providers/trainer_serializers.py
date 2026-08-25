"""Input validation for passwordless trainer profile onboarding."""

from django.utils import timezone
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers

from catalog.models import Trade
from geography.models import Area


class RejectUnknownFieldsMixin:
    """Fail closed when a client attempts to mass-assign a server-owned field."""

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError(
                    dict.fromkeys(sorted(unknown), "This field is not accepted.")
                )
        return super().to_internal_value(data)


class TrainerOTPVerifySerializer(RejectUnknownFieldsMixin, serializers.Serializer):
    challenge_id = serializers.UUIDField()
    phone = PhoneNumberField()
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
        raise serializers.ValidationError("Choose a future intake date.")


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
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    programme = TrainerProgrammeInputSerializer()
