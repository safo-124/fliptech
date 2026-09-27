"""Trainee API shapes.

The trainee sees their own words and the platform's record of what happened.
They do not see the provider's attestation about them: that is the provider's
private judgement for the Section 08 graduate record, and showing it to the
person it describes would stop providers answering honestly.
"""

from drf_spectacular.utils import extend_schema_field
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers

from core.media import public_url
from enquiries.models import Enquiry, Enrolment
from enquiries.serializers import EnquiryConfirmationSerializer
from providers.models import Provider

from .models import SavedProvider, TraineeAccount


class TraineeCodeRequestSerializer(serializers.Serializer):
    phone = PhoneNumberField()
    # Typed on the sign-up form, before any account exists to look one up on.
    # The code goes to it as well as to the phone. Not stored by this request.
    email = serializers.EmailField(required=False, allow_blank=True)


class TraineeSignUpProfileSerializer(serializers.Serializer):
    """What the sign-up form may send alongside the code.

    Every field is optional and blanks are allowed, because the form shows
    them all and requires only the number. A trainee who fills nothing in
    still gets an account, which is the whole point of a passwordless
    sign-up on a phone with a slow connection.
    """

    display_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    # Stored unverified. See trainees.auth._claim_email for why proving the
    # code cannot prove the address.
    email = serializers.EmailField(required=False, allow_blank=True)
    education_level = serializers.ChoiceField(
        choices=TraineeAccount.EducationLevel.choices, required=False, allow_blank=True
    )
    institution_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    field_of_study = serializers.CharField(max_length=200, required=False, allow_blank=True)
    education_status = serializers.ChoiceField(
        choices=TraineeAccount.EducationStatus.choices, required=False, allow_blank=True
    )
    education_year = serializers.IntegerField(
        min_value=1950, max_value=2100, required=False, allow_null=True
    )


class TraineeCodeVerifySerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    phone = PhoneNumberField()
    code = serializers.RegexField(r"^\d{4,8}$")
    # Absent for a returning trainee signing in; present from the sign-up form.
    profile = TraineeSignUpProfileSerializer(required=False)


class TraineeEmailCodeRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class TraineeEmailCodeVerifySerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    email = serializers.EmailField()
    code = serializers.RegexField(r"^\d{4,8}$")


class TraineeAccountSerializer(serializers.ModelSerializer):
    phone = serializers.CharField(read_only=True)
    avatar = serializers.SerializerMethodField()

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_avatar(self, obj):
        # Not the plain ImageField: DRF would build the URL from the request,
        # and a server-rendered request arrives on loopback. See core/media.py.
        return public_url(obj.avatar.url, self.context.get("request")) if obj.avatar else None

    class Meta:
        model = TraineeAccount
        fields = [
            "phone",
            "display_name",
            "preferred_channel",
            # All optional. PATCH is partial, so a trainee who never opens the
            # background form is never blocked by it and never sees an error
            # about it.
            "education_level",
            "institution_name",
            "field_of_study",
            "education_status",
            "education_year",
            "email",
            "avatar",
            "created_at",
        ]
        # email is read-only here on purpose. It is claimed by proving the
        # address with a one-time code, not by typing it into the settings
        # form — otherwise an account could assert any address it liked.
        # avatar is read-only here too: it arrives as a file on its own
        # endpoint, where it can be stripped of EXIF and downscaled, not as a
        # URL somebody could type into this form.
        read_only_fields = ["phone", "email", "avatar", "created_at"]


class ProviderLinkSerializer(serializers.ModelSerializer):
    area = serializers.CharField(source="area.name", read_only=True)
    area_slug = serializers.CharField(source="area.slug", read_only=True)
    is_listed = serializers.SerializerMethodField()

    class Meta:
        model = Provider
        fields = ["id", "name", "slug", "area", "area_slug", "is_listed"]

    @extend_schema_field(serializers.BooleanField())
    def get_is_listed(self, obj):
        return obj.status == Provider.Status.PUBLISHED


class TraineeEnquirySerializer(serializers.ModelSerializer):
    provider = ProviderLinkSerializer(read_only=True)
    programme_title = serializers.CharField(source="programme.title", default="", read_only=True)
    intake_start = serializers.DateField(source="intake.start_date", default=None, read_only=True)
    status = serializers.SerializerMethodField()
    whatsapp_url = serializers.SerializerMethodField()

    class Meta:
        model = Enquiry
        fields = [
            "reference_code",
            "provider",
            "programme_title",
            "intake_start",
            "message",
            "status",
            "whatsapp_url",
            "created_at",
        ]

    @extend_schema_field(serializers.CharField())
    def get_status(self, obj):
        """The furthest stage anyone has recorded, in the trainee's words."""
        outcome = getattr(obj, "outcome", None)
        if obj.state == Enquiry.State.FAILED:
            return "not_delivered"
        if outcome is not None:
            if outcome.enrolled:
                return "enrolled"
            if outcome.visited:
                return "visited"
            if outcome.replied:
                return "replied"
        return "sent"

    @extend_schema_field(serializers.URLField())
    def get_whatsapp_url(self, obj):
        return EnquiryConfirmationSerializer().get_whatsapp_url(obj)

    @classmethod
    def queryset_for(cls, account):
        return (
            Enquiry.objects.filter(trainee=account)
            .exclude(state=Enquiry.State.SPAM)
            .select_related("provider__area", "programme", "intake", "outcome")
            .order_by("-created_at")
        )


class TraineeEnrolmentSerializer(serializers.ModelSerializer):
    provider = ProviderLinkSerializer(read_only=True)
    programme_title = serializers.CharField(source="programme.title", read_only=True)

    class Meta:
        model = Enrolment
        fields = ["id", "provider", "programme_title", "started_on", "completed_on", "fee_paid"]

    @classmethod
    def queryset_for(cls, account):
        return (
            Enrolment.objects.filter(trainee=account)
            .select_related("provider__area", "programme")
            .order_by("-started_on")
        )


class SavedProviderSerializer(serializers.ModelSerializer):
    provider = ProviderLinkSerializer(read_only=True)
    provider_id = serializers.PrimaryKeyRelatedField(
        queryset=Provider.objects.filter(status=Provider.Status.PUBLISHED),
        source="provider",
        write_only=True,
    )

    class Meta:
        model = SavedProvider
        fields = ["provider", "provider_id", "created_at"]
        read_only_fields = ["created_at"]
