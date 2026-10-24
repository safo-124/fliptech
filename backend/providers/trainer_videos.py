"""A trainer's teaching videos: list, add and remove. See providers/videos.py.

Unlike photographs, a video can be added to a listing that is live or under
review. Each one is reviewed on its own, so adding one changes nothing anybody
is in the middle of deciding, and nothing reaches the public listing until a
member of staff has watched it.
"""

from django.utils.translation import gettext as _
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Provider
from .trainer_serializers import TrainerVideoInputSerializer, TrainerVideoSerializer
from .trainer_views import IsActiveTrainer, _account, _profile_for
from .videos import VideoRefused, add_video


class TrainerVideosView(APIView):
    """The trainer's videos, oldest first, each with where it stands in review."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(responses={200: TrainerVideoSerializer(many=True)})
    def get(self, request):
        provider = _profile_for(_account(request))
        videos = provider.videos.all() if provider is not None else []
        return Response(TrainerVideoSerializer(videos, many=True).data)

    @extend_schema(request=TrainerVideoInputSerializer, responses={201: TrainerVideoSerializer})
    def post(self, request):
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
            video = add_video(
                provider,
                link=serializer.validated_data["url"],
                title=serializer.validated_data["title"],
                actor=request.user,
            )
        except VideoRefused as refusal:
            # Keyed to the link field, which is what the trainer has to change.
            return Response({"url": [str(refusal)]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TrainerVideoSerializer(video).data, status=status.HTTP_201_CREATED)


class TrainerVideoDeleteView(APIView):
    """Remove a video. Allowed in any state: taking something down is never held up."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, video_id):
        provider = _profile_for(_account(request))
        # Scoped to the trainer's own listing, so a guessed id from another
        # one is a 404 rather than a deletion.
        video = provider.videos.filter(pk=video_id).first() if provider is not None else None
        if video is None:
            return Response({"detail": _("Not found.")}, status=status.HTTP_404_NOT_FOUND)
        video.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
