"""Teaching videos on a listing: the limits, starting an upload, and the review.

A video arrives in three steps, each in its own module:

1. Here, the trainer says what they are about to send (a title and a size)
   and is refused now, before spending an hour of mobile data, if it would
   not fit.
2. providers/video_uploads.py takes the file a piece at a time.
3. providers/video_encoding.py turns it into something a 3G phone can play.

Then it waits for review like everything else on a listing, and decide()
below is the only thing that moves its files between private and public
storage. See ProviderVideo for why there are two.
"""

import logging
import shutil

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.translation import gettext as _

from . import video_uploads
from .models import ProviderVideo

logger = logging.getLogger(__name__)

# (review field, public field) for every encoded file, in one place so that
# publishing, withdrawing and deleting cannot disagree about what a video is.
FILE_PAIRS = (
    ("review_360", "public_360"),
    ("review_720", "public_720"),
    ("review_poster", "public_poster"),
)


class VideoRefused(Exception):
    """Why a video was not taken, worded for the trainer."""


def limits():
    """The allowances, as the trainer's upload screen shows them."""
    return {
        "max_videos": settings.VIDEO_MAX_PER_PROVIDER,
        "max_minutes": settings.VIDEO_MAX_MINUTES,
        "max_hours": settings.VIDEO_MAX_HOURS_PER_PROVIDER,
        "max_upload_bytes": settings.VIDEO_MAX_UPLOAD_BYTES,
        "chunk_bytes": settings.VIDEO_CHUNK_BYTES,
    }


def seconds_used(provider, *, excluding=None):
    """Teaching already on the listing, counted once it has been measured.

    Rejected videos are left out: the trainer has been told to replace them,
    and counting them would make removing one the only way to try again.
    """
    videos = provider.videos.exclude(status=ProviderVideo.Status.REJECTED)
    if excluding is not None:
        videos = videos.exclude(pk=excluding.pk)
    return videos.aggregate(total=Sum("duration_seconds"))["total"] or 0


def _disk_has_room_for(size):
    work_dir = video_uploads.work_dir()
    free = shutil.disk_usage(work_dir).free
    return free - size >= settings.VIDEO_MIN_FREE_BYTES


def start_upload(provider, *, title, name, size, actor):
    """A new video, ready to receive its file. Raises VideoRefused.

    Every check that can be made before a byte is sent is made here. Length
    is not one of them — nothing knows a video's length until it has arrived
    and been read — so that check is the encoder's.
    """
    if size <= 0:
        raise VideoRefused(_("That file is empty. Choose the video again."))
    if size > settings.VIDEO_MAX_UPLOAD_BYTES:
        raise VideoRefused(
            _(
                "That video is too large to send. Keep each lesson under %(gb)s GB: "
                "film at 720p in your camera settings, or split it into shorter lessons."
            )
            % {"gb": round(settings.VIDEO_MAX_UPLOAD_BYTES / 1024**3, 1)}
        )
    if provider.videos.count() >= settings.VIDEO_MAX_PER_PROVIDER:
        raise VideoRefused(
            _("You can add up to %(count)s videos. Remove one to add another.")
            % {"count": settings.VIDEO_MAX_PER_PROVIDER}
        )
    if seconds_used(provider) >= settings.VIDEO_MAX_HOURS_PER_PROVIDER * 3600:
        raise VideoRefused(
            _("Your listing already has %(hours)s hours of video, the most it can hold.")
            % {"hours": settings.VIDEO_MAX_HOURS_PER_PROVIDER}
        )
    if not _disk_has_room_for(size):
        # Logged loudly: this is the server running out of space, and it is
        # staff who need to know, not the trainer.
        logger.error("Refused a %s-byte video upload: the video disk is nearly full", size)
        raise VideoRefused(
            _("Videos cannot be taken right now. Try again tomorrow, or contact %(brand)s.")
            % {"brand": settings.BRAND_NAME}
        )

    return ProviderVideo.objects.create(
        provider=provider,
        title=title.strip(),
        status=ProviderVideo.Status.UPLOADING,
        upload_name=name[:255],
        upload_size=size,
        added_by=actor,
    )


# --------------------------------------------------------------------------
# The review


def _move(video, source_field, target_field):
    """Copy one file across storages, then forget the source.

    Copy first and delete after, so a failure half way leaves a file in both
    places rather than in neither.
    """
    source = getattr(video, source_field)
    if not source:
        return
    with source.open("rb") as handle:
        getattr(video, target_field).save(source.name.rsplit("/", 1)[-1], handle, save=False)
    source.delete(save=False)


def decide(video, status, *, by, note=""):
    """Record a reviewer's decision and put the files where it says.

    Approved: the encoded files move to public storage. Anything else: they
    move back, so a video taken down is no longer at its public address.
    YouTube videos have no files and only change status.
    """
    if status not in ProviderVideo.REVIEWABLE:
        raise ValueError(f"{status!r} is not a review decision")
    if video.status not in ProviderVideo.REVIEWABLE:
        raise ValueError("This video has not been prepared yet, so there is nothing to review.")

    with transaction.atomic():
        if status == ProviderVideo.Status.APPROVED:
            for review_field, public_field in FILE_PAIRS:
                _move(video, review_field, public_field)
        else:
            for review_field, public_field in FILE_PAIRS:
                _move(video, public_field, review_field)
        video.status = status
        video.review_note = "" if status == ProviderVideo.Status.APPROVED else note
        decided = status != ProviderVideo.Status.PENDING
        video.reviewed_by = by if decided else None
        video.reviewed_at = timezone.now() if decided else None
        video.save()


def discard_files(video, *, video_id=None):
    """Delete every file a video has, wherever it is. Never raises.

    Called when a video row goes, including when a whole listing is deleted:
    a file nothing points at is a file nobody will ever delete. Pass
    `video_id` then: Django clears a deleted instance's pk.
    """
    for review_field, public_field in FILE_PAIRS:
        for field in (review_field, public_field):
            file = getattr(video, field)
            if file:
                try:
                    file.delete(save=False)
                except Exception:
                    logger.warning(
                        "Could not delete %s of video %s", field, video.pk, exc_info=True
                    )
    video_uploads.remove_work_file(video, video_id=video_id)
