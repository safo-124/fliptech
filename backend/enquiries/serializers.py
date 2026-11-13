"""Enquiry serializers.

The enquiry is structured, then the conversation moves to WhatsApp. Building a
chat product to compete with the one already on every phone in Ghana would be
the most expensive mistake available in this project, so the response carries a
wa.me handover link and nothing more.
"""

from django.utils.translation import gettext as _
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
    # Who is asking. A training enquiry makes the number a trainee; asking
    # or paying in the marketplace makes it only a customer, so nobody is
    # signed up as a trainee for buying a bag.
    context = serializers.ChoiceField(
        choices=["training", "marketplace"], required=False, default="training"
    )


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
                {"intake_id": _("That intake is not on this programme.")}
            )
        if programme.provider.status != programme.provider.Status.PUBLISHED:
            raise serializers.ValidationError({"programme_id": _("This listing is not available.")})
        return attrs


class EnquiryConfirmationSerializer(serializers.ModelSerializer):
    """Screen 4: a reference the trainee can quote, and the chat it opened.

    The conversation now happens in the site's own chat (marketplace/chat.py),
    so the trainee's number stays theirs until they share it. `whatsapp_url`
    is kept, always empty for an enquiry with a chat, so app builds made
    before chat show "Done" rather than a link to a number.
    """

    provider_name = serializers.CharField(source="provider.name", read_only=True)
    conversation_id = serializers.SerializerMethodField()
    whatsapp_url = serializers.SerializerMethodField()
    expect_reply_within_hours = serializers.SerializerMethodField()

    class Meta:
        model = Enquiry
        fields = [
            "reference_code",
            "provider_name",
            "conversation_id",
            "whatsapp_url",
            "expect_reply_within_hours",
            "created_at",
        ]

    def _conversation_id(self, obj):
        # .all(), not .first(): a list prefetches `messages`, and this then
        # costs no query per row. An enquiry has one message, its own.
        messages = list(obj.messages.all())
        return min(messages, key=lambda m: m.pk).conversation_id if messages else None

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_conversation_id(self, obj):
        return self._conversation_id(obj)

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_whatsapp_url(self, obj):
        """Only for an enquiry without a chat (made before chat existed)."""
        return None if self._conversation_id(obj) else whatsapp.trainee_to_provider(obj)

    @extend_schema_field(serializers.IntegerField())
    def get_expect_reply_within_hours(self, obj):
        # A realistic expectation rather than a promise the provider never made.
        return 48
