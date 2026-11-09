"""The mobile app's own endpoints: its notices, crash reports and updates."""

import json
import logging

from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.network import ratelimit_client_ip

from . import updates
from .models import CrashReport, Notice
from .notify import phones_for

logger = logging.getLogger(__name__)

PAGE = 50


def _payload(notice):
    return {
        "id": notice.pk,
        "title": notice.title,
        "body": notice.body,
        "link": notice.link,
        "created_at": notice.created_at,
        "read": notice.read_at is not None,
    }


class NoticesView(APIView):
    """GET: the signed-in person's notices, newest first. ?after=<id> gives
    only newer ones, which is what the app's background check asks for.
    POST {"read": [ids]} or {"read": "all"} marks them read."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def _mine(self, request):
        return Notice.objects.filter(phone__in=phones_for(request.user))

    @extend_schema(responses={200: None})
    def get(self, request):
        notices = self._mine(request)
        after = request.query_params.get("after")
        if after and after.isdigit():
            notices = notices.filter(pk__gt=int(after))
        unread = self._mine(request).filter(read_at__isnull=True).count()
        return Response({"results": [_payload(n) for n in notices[:PAGE]], "unread": unread})

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        wanted = request.data.get("read")
        notices = self._mine(request).filter(read_at__isnull=True)
        if wanted != "all":
            ids = [int(i) for i in (wanted or []) if str(i).isdigit()]
            notices = notices.filter(pk__in=ids)
        marked = notices.update(read_at=timezone.now())
        return Response({"marked": marked})


class CrashReportView(APIView):
    """The app reports an error it could not recover from. Open to anyone
    (a crash can happen before sign-in), limited per address."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        if is_ratelimited(
            request, group="app-crash", key=ratelimit_client_ip, rate="30/h", increment=True
        ):
            return Response(status=status.HTTP_429_TOO_MANY_REQUESTS)
        data = request.data
        message = str(data.get("message") or "").strip()
        if not message:
            return Response({"detail": "A message is needed."}, status=400)
        user = request.user if request.user.is_authenticated else None
        CrashReport.objects.create(
            message=message[:500],
            stack=str(data.get("stack") or "")[:20000],
            screen=str(data.get("screen") or "")[:200],
            fatal=bool(data.get("fatal")),
            app_version=str(data.get("app_version") or "")[:40],
            update_id=str(data.get("update_id") or "")[:60],
            device=str(data.get("device") or "")[:120],
            os_version=str(data.get("os_version") or "")[:40],
            user=user,
        )
        return Response(status=status.HTTP_201_CREATED)


def update_manifest(request):
    """The Expo Updates protocol's manifest request (see updates.py)."""
    platform = request.headers.get("expo-platform") or request.GET.get("platform") or ""
    runtime = request.headers.get("expo-runtime-version") or request.GET.get("runtime-version")
    if platform not in {"android", "ios"} or not runtime:
        return HttpResponse("expo-platform and expo-runtime-version are needed.", status=400)
    base = (settings.PUBLIC_SITE_URL or request.build_absolute_uri("/")).rstrip("/")

    def asset_url(update, relative):
        return f"{base}/api/app/updates/{runtime}/{update.name}/{relative}"

    try:
        body = updates.manifest(runtime, platform, asset_url)
    except updates.NoUpdate:
        response = HttpResponse(status=204)
        response["expo-protocol-version"] = "1"
        response["expo-sfv-version"] = "0"
        response["cache-control"] = "private, max-age=0"
        return response

    boundary = "fliptech-update-boundary"
    part = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="manifest"\r\n'
        "Content-Type: application/json; charset=utf-8\r\n\r\n"
        f"{json.dumps(body)}\r\n"
        f"--{boundary}--\r\n"
    )
    response = HttpResponse(part, content_type=f"multipart/mixed; boundary={boundary}")
    response["expo-protocol-version"] = "1"
    response["expo-sfv-version"] = "0"
    response["cache-control"] = "private, max-age=0"
    return response


def update_asset(request, runtime, update, path):
    """One file of a published update: the bundle or an asset."""
    try:
        target = updates.asset_path(runtime, update, path)
    except updates.NoUpdate:
        return HttpResponse(status=404)
    response = FileResponse(target.open("rb"))
    # An update's files never change: a new update is a new folder.
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response
