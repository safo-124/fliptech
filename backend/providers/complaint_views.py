"""The "Report a problem" form on every listing. See Complaint."""

from django.utils.translation import gettext as _
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import ratelimit_client_ip

from .models import Complaint, Provider, complaint_reference


class ComplaintCreateSerializer(serializers.Serializer):
    provider_id = serializers.PrimaryKeyRelatedField(
        source="provider",
        queryset=Provider.objects.filter(status=Provider.Status.PUBLISHED),
    )
    category = serializers.ChoiceField(choices=Complaint.Category.choices)
    detail = serializers.CharField(min_length=10, max_length=2000)
    reporter_name = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    reporter_phone = PhoneNumberField(required=False, allow_blank=True, default="")
    # Hidden from people by the form. A bot that fills in every field fills
    # this one too.
    website = serializers.CharField(required=False, allow_blank=True, default="")


class ComplaintCreateView(APIView):
    """Anyone can report a problem with a published listing.

    No sign-in and no code. Somebody reporting a workshop that took their money
    should not have to prove a phone number first, and some will only report
    if they can stay anonymous. Spam is held off by a per-connection limit and
    the hidden field above; what to do about a report is a person's decision.
    """

    @extend_schema(request=ComplaintCreateSerializer, responses={201: None})
    def post(self, request):
        if is_ratelimited(
            request,
            group="complaint-create",
            key=ratelimit_client_ip,
            rate="5/h",
            increment=True,
        ):
            return Response(
                {"detail": _("Too many reports from this connection. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = ComplaintCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)

        if data.pop("website"):
            # Looks accepted, so the bot moves on. Nothing is stored.
            return Response({"reference": complaint_reference()}, status=status.HTTP_201_CREATED)

        complaint = Complaint.objects.create(**data)
        return Response({"reference": complaint.reference}, status=status.HTTP_201_CREATED)
