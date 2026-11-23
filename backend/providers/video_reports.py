"""Reporting a teaching video that breaks the guidelines. See VideoReport.

Signed in only, unlike the anonymous "Report a problem" form on a listing
(providers/complaint_views.py): a report here puts a live video in front of
staff, so each person counts once, and reporting again updates their reason.
"""

from django.utils.translation import gettext as _
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ProviderVideo, VideoReport


class VideoReportInputSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=VideoReport.Reason.choices)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class VideoReportView(APIView):
    """Report a video shown on a listing or in a course."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(request=VideoReportInputSerializer, responses={200: None, 201: None})
    def post(self, request, video_id):
        video = ProviderVideo.objects.shown().filter(pk=video_id).first()
        if video is None:
            return Response({"detail": _("Not found.")}, status=status.HTTP_404_NOT_FOUND)
        if is_ratelimited(request, group="video-report", key="user", rate="20/h", increment=True):
            return Response(
                {"detail": _("Too many reports in a short time. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        serializer = VideoReportInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _report, created = VideoReport.objects.update_or_create(
            video=video,
            reporter=request.user,
            defaults={
                "reason": serializer.validated_data["reason"],
                "note": serializer.validated_data["note"].strip(),
                # Open again: staff look at it afresh.
                "resolved_at": None,
            },
        )
        return Response(
            {"reported": True}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )
