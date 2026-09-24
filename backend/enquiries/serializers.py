"""Enquiry serializers.

The enquiry is structured, then the conversation moves to WhatsApp. Building a
chat product to compete with the one already on every phone in Ghana would be
the most expensive mistake available in this project, so the response carries a
wa.me handover link and nothing more.
"""

from drf_spectacular.utils import extend_schema_field
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers

from catalog.models import Intake, Programme

from . import whatsapp
from .models import Enquiry


class OTPRequestSerializer(serializers.Serializer):
    phone = PhoneNumberField()


class OTPVerifySerializer(serializers.Serializer):
    phone = PhoneNumberField()
    code = serializers.CharField(min_length=4, max_length=8)


class EnquiryCreateSerializer(serializers.ModelSerializer):
    phone = PhoneNumberField(write_only=True)
    programme_id = serializers.PrimaryKeyRelatedField(
        queryset=Programme.objects.filter(is_active=True), source="programme"
    )
    intake_id = serializers.PrimaryKeyRelatedField(
        queryset=Intake.objects.filter(is_open=True),
        source="intake",
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Enquiry
        fields = ["phone", "programme_id", "intake_id", "trainee_name", "message"]

    def validate(self, attrs):
        programme = attrs["programme"]
        intake = attrs.get("intake")
        if intake and intake.programme_id != programme.id:
            raise serializers.ValidationError(
                {"intake_id": "That intake is not on this programme."}
            )
        if programme.provider.status != programme.provider.Status.PUBLISHED:
            raise serializers.ValidationError({"programme_id": "This listing is not available."})
        return attrs


class EnquiryConfirmationSerializer(serializers.ModelSerializer):
    """Screen 4: a reference the trainee can quote, and the handover link."""

    provider_name = serializers.CharField(source="provider.name", read_only=True)
    whatsapp_url = serializers.SerializerMethodField()
    expect_reply_within_hours = serializers.SerializerMethodField()

    class Meta:
        model = Enquiry
        fields = [
            "reference_code",
            "provider_name",
            "whatsapp_url",
            "expect_reply_within_hours",
            "created_at",
        ]

    @extend_schema_field(serializers.URLField())
    def get_whatsapp_url(self, obj):
        """A click-to-chat deep link, which is free.

        Only the provider-alert side needs the paid Cloud API, because a
        business-initiated template message is billed per send.
        """
        return whatsapp.trainee_to_provider(obj)

    @extend_schema_field(serializers.IntegerField())
    def get_expect_reply_within_hours(self, obj):
        # A realistic expectation rather than a promise the provider never made.
        return 48
