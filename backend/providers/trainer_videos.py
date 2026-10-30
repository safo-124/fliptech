"""A trainer's teaching videos: list, start an upload, send it, and remove.

See providers/videos.py for the order a video goes through. Unlike
photographs, a video can be added to a listing that is live or under review.
Each one is reviewed on its own, so adding one changes nothing anybody is in
the middle of deciding, and nothing reaches the public listing until a member
of staff has watched it.
"""

from django.utils.translation import gettext as _
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Provider
from .trainer_serializers import TrainerVideoInputSerializer, TrainerVideoSerializer
from .trainer_views import IsActiveTrainer, _account, _profile_for
from .video_uploads import ChunkRefused, read_chunk, receive_chunk
from .videos import VideoRefused, limits, seconds_used, start_upload


def _own_video(request, video_id):
    """Scoped to the trainer's own listing, so a guessed id from another one
    is a 404 rather than somebody else's upload."""
    provider = _profile_for(_account(request))
    if provider is None:
        return None
    return provider.videos.filter(pk=video_id).first()


class TrainerVideosView(APIView):
    """The trainer's videos, oldest first, each with where it stands."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(responses={200: None})
    def get(self, request):
        provider = _profile_for(_account(request))
        videos = provider.videos.all() if provider is not None else []
        return Response(
            {
                "videos": TrainerVideoSerializer(
                    videos, many=True, context={"request": request}
                ).data,
                "limits": {
                    **limits(),
                    "seconds_used": seconds_used(provider) if provider is not None else 0,
                },
            }
        )

    @extend_schema(request=TrainerVideoInputSerializer, responses={201: TrainerVideoSerializer})
    def post(self, request):
        """Start an upload: say what is coming. The file follows in pieces."""
        provider = _profile_for(_account(request))
        if provider is None:
            return Response(
                {"detail": _("Create your workshop details before adding videos.")},
                status=status.HTTP_409_CONFLICT,
            )
        if provider.status == Provider.Status.SUSPENDED:
            return Response(
                {"detail": _("Your listing is suspended, so nothing can be added to it.")},
                status=status.HTTP_409_CONFLICT,
            )
        if is_ratelimited(
            request, group="trainer-video-add", key="user", rate="30/h", increment=True
        ):
            return Response(
                {"detail": _("Too many videos added in a short time. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = TrainerVideoInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            video = start_upload(
                provider,
                title=serializer.validated_data["title"],
                name=serializer.validated_data["name"],
                size=serializer.validated_data["size"],
                actor=request.user,
            )
        except VideoRefused as refusal:
            return Response({"detail": str(refusal)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            TrainerVideoSerializer(video, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class TrainerVideoUploadView(APIView):
    """One piece of an upload. See providers/video_uploads.py.

    The body is the raw bytes, not a form: a multipart wrapper would make the
    server parse each piece into a temporary file only to copy it again.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]
    # Nothing parses the body. It is read straight from the request below.
    parser_classes = []

    @extend_schema(
        request={"application/octet-stream": bytes},
        parameters=[
            OpenApiParameter(
                "Upload-Offset",
                int,
                OpenApiParameter.HEADER,
                required=True,
                description="Where in the file this piece starts.",
            )
        ],
        responses={200: TrainerVideoSerializer},
    )
    def put(self, request, video_id):
        video = _own_video(request, video_id)
        if video is None:
            return Response({"detail": _("Not found.")}, status=status.HTTP_404_NOT_FOUND)
        try:
            offset = int(request.headers.get("Upload-Offset", ""))
        except ValueError:
            return Response(
                {
                    "detail": _("Say where this piece starts."),
                    "upload_received": video.upload_received,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            video = receive_chunk(video.pk, offset=offset, data=read_chunk(request._request.read))
        except ChunkRefused as refusal:
            # The offset is always in the answer: it is where the browser
            # carries on from, which is the whole point of refusing.
            return Response(
                {"detail": str(refusal), "upload_received": refusal.received},
                status=refusal.status,
            )
        return Response(TrainerVideoSerializer(video, context={"request": request}).data)


class TrainerVideoDeleteView(APIView):
    """Remove a video, at any stage: taking something down is never held up.

    An upload still arriving is removed the same way; that is what "cancel"
    is. Its files go with it (see ProvidersConfig).
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, video_id):
        video = _own_video(request, video_id)
        if video is None:
            return Response({"detail": _("Not found.")}, status=status.HTTP_404_NOT_FOUND)
        video.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
