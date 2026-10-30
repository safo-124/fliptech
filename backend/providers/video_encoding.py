"""Making an uploaded video small enough for a trainee on 3G, with ffmpeg.

A phone films at 1080p and 15–20 Mbit/s. A trainee on prepaid data cannot
play that, so every upload is encoded to:

  360p   H.264 and mono AAC, capped near 450 kbit/s: about 3.5 MB a minute.
         What a listing plays unless the trainee asks for better.
  720p   The same at about 1.4 Mbit/s, only when the original is at least
         that sharp. For good connections and fine detail.
  poster One still, so a listing shows something before anyone spends data.

Both MP4s are written with +faststart, so playback starts before the file has
downloaded, and served by Caddy straight from disk once approved, which
answers the range requests a phone makes when somebody skips ahead.

-map_metadata -1 does for video what strip_exif does for photographs: a
phone's recording carries the GPS position it was filmed at, and a workshop
filmed in somebody's home would otherwise publish the address.

The original is deleted once encoded. Keeping it would triple the disk a
course takes, and nothing reads it again.

ffmpeg runs from process_videos, one video at a time, never from a web
request. See core/management/commands/process_videos.py.
"""

import json
import logging
import shutil
import subprocess
import tempfile
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.files import File
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from . import video_uploads
from .models import ProviderVideo
from .videos import seconds_used

logger = logging.getLogger(__name__)

# (field, short side in pixels, x264 settings, audio bitrate). "Short side"
# rather than height, so a video filmed upright comes out 360 wide, not 360
# tall and therefore needlessly sharp.
RENDITIONS = (
    ("360", 360, ["-crf", "28", "-maxrate", "450k", "-bufsize", "900k"], "64k"),
    ("720", 720, ["-crf", "26", "-maxrate", "1400k", "-bufsize", "2800k"], "96k"),
)


class EncodingFailed(Exception):
    """Why a video could not be prepared, worded for the trainer."""


def _scale(short_side):
    # Never enlarges: min() keeps a small original at its own size. -2 keeps
    # the other side even, which H.264 requires. ffmpeg has already turned an
    # upright phone video the right way up by the time this runs.
    return (
        f"scale=w='if(gte(iw,ih),-2,min({short_side},iw))'"
        f":h='if(gte(iw,ih),min({short_side},ih),-2)'"
    )


def _run(binary, arguments, *, timeout):
    command = [binary, *arguments]
    # Lowest priority, so the site keeps answering while a long lesson
    # encodes on the same machine.
    if shutil.which("nice"):
        command = ["nice", "-n", "19", *command]
    return subprocess.run(command, capture_output=True, timeout=timeout, check=False)


def probe(path):
    """(duration in seconds, short side in pixels) or EncodingFailed."""
    result = _run(
        settings.VIDEO_FFPROBE,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        timeout=120,
    )
    unreadable = EncodingFailed(
        _("That file is not a video we can play. Choose the video again, or film it again.")
    )
    if result.returncode != 0:
        raise unreadable
    try:
        info = json.loads(result.stdout)
        stream = next(s for s in info["streams"] if s.get("codec_type") == "video")
        duration = float(info["format"]["duration"])
        short_side = min(int(stream["width"]), int(stream["height"]))
    except (ValueError, KeyError, StopIteration, TypeError):
        raise unreadable from None
    if duration <= 0 or short_side <= 0:
        raise unreadable
    return duration, short_side


def _encode(source, target, *, short_side, video_options, audio_bitrate, timeout):
    result = _run(
        settings.VIDEO_FFMPEG,
        [
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-i",
            source,
            "-map",
            "0:v:0",
            # The question mark: a silent video is still a video.
            "-map",
            "0:a:0?",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-sn",
            "-dn",
            "-vf",
            _scale(short_side),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-profile:v",
            "main",
            "-pix_fmt",
            "yuv420p",
            *video_options,
            "-c:a",
            "aac",
            "-b:a",
            audio_bitrate,
            # A teacher talking: one channel is all it needs, at half the data.
            "-ac",
            "1",
            "-movflags",
            "+faststart",
            "-threads",
            str(settings.VIDEO_FFMPEG_THREADS),
            target,
        ],
        timeout=timeout,
    )
    if result.returncode != 0:
        logger.warning("ffmpeg failed: %s", result.stderr.decode(errors="replace")[-2000:])
        raise EncodingFailed(
            _("That video could not be prepared. Try sending it again, or film it again.")
        )


def _poster(source, target, *, at_seconds, timeout):
    result = _run(
        settings.VIDEO_FFMPEG,
        [
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{at_seconds:.2f}",
            "-i",
            source,
            "-frames:v",
            "1",
            "-map_metadata",
            "-1",
            "-vf",
            _scale(360),
            "-q:v",
            "5",
            target,
        ],
        timeout=timeout,
    )
    if result.returncode != 0:
        raise EncodingFailed(_("That video could not be prepared. Try sending it again."))


def encode(video):
    """Prepare one queued video for review. Raises EncodingFailed."""
    source = str(video_uploads.work_path(video))
    if not Path(source).exists():
        raise EncodingFailed(_("The video did not arrive in full. Send it again."))

    duration, short_side = probe(source)

    if duration > settings.VIDEO_MAX_MINUTES * 60:
        raise EncodingFailed(
            _(
                "That video is %(minutes)s minutes long. Each lesson can be up to "
                "%(max)s minutes: split it into shorter lessons."
            )
            % {"minutes": round(duration / 60), "max": settings.VIDEO_MAX_MINUTES}
        )
    allowance = settings.VIDEO_MAX_HOURS_PER_PROVIDER * 3600
    if seconds_used(video.provider, excluding=video) + duration > allowance:
        raise EncodingFailed(
            _(
                "That video would take your listing past %(hours)s hours of video. "
                "Remove a video, or send a shorter one."
            )
            % {"hours": settings.VIDEO_MAX_HOURS_PER_PROVIDER}
        )

    # Generous: a slow, niced encode of an hour can take more than an hour.
    timeout = int(duration * 6) + 600

    with tempfile.TemporaryDirectory(dir=video_uploads.work_dir()) as scratch:
        outputs = {}
        for name, side, video_options, audio_bitrate in RENDITIONS:
            # The 360p is always made. Sharper ones only from a sharp enough
            # original: enlarging a 480p video to 720p costs data and adds
            # nothing a trainee can see.
            if name != "360" and short_side < side:
                continue
            target = str(Path(scratch) / f"{name}.mp4")
            _encode(
                source,
                target,
                short_side=side,
                video_options=video_options,
                audio_bitrate=audio_bitrate,
                timeout=timeout,
            )
            outputs[name] = target
        poster = str(Path(scratch) / "poster.jpg")
        _poster(source, poster, at_seconds=min(duration * 0.1, 10), timeout=300)

        with transaction.atomic():
            for name, target in outputs.items():
                with open(target, "rb") as handle:
                    getattr(video, f"review_{name}").save(f"{name}.mp4", File(handle), save=False)
                setattr(video, f"size_{name}", Path(target).stat().st_size)
            with open(poster, "rb") as handle:
                video.review_poster.save("poster.jpg", File(handle), save=False)
            video.duration_seconds = round(duration)
            video.status = ProviderVideo.Status.PENDING
            video.failure_reason = ""
            video.processing_started_at = None
            video.save()

    video_uploads.remove_work_file(video)


# --------------------------------------------------------------------------
# The queue


def claim_next():
    """Take the oldest queued video for this worker, or None.

    skip_locked, so a second worker — on a separate encoding server, say —
    takes the next one instead of waiting for this one's lock.
    """
    with transaction.atomic():
        video = (
            ProviderVideo.objects.select_for_update(skip_locked=True)
            .filter(status=ProviderVideo.Status.QUEUED)
            .order_by("updated_at")
            .first()
        )
        if video is None:
            return None
        video.status = ProviderVideo.Status.PROCESSING
        video.processing_started_at = timezone.now()
        video.save(update_fields=["status", "processing_started_at", "updated_at"])
        return video


def process_next():
    """Encode one video if any is waiting. Returns it, or None."""
    video = claim_next()
    if video is None:
        return None
    try:
        encode(video)
    except EncodingFailed as exc:
        _fail(video, str(exc))
    except subprocess.TimeoutExpired:
        _fail(video, _("That video took too long to prepare. Send it as shorter lessons."))
    except Exception:
        logger.exception("Encoding video %s failed", video.pk)
        _fail(video, _("That video could not be prepared. Try sending it again."))
    return video


def _fail(video, reason):
    video.status = ProviderVideo.Status.FAILED
    video.failure_reason = reason[:300]
    video.processing_started_at = None
    video.save(update_fields=["status", "failure_reason", "processing_started_at", "updated_at"])
    # The original is no use to anybody now: the trainer sends it again as a
    # new video, and a failed upload must not sit on the disk forever.
    video_uploads.remove_work_file(video)


def tidy():
    """Requeue encodings whose worker died, and remove abandoned uploads.

    Returns (requeued, abandoned).
    """
    now = timezone.now()
    requeued = ProviderVideo.objects.filter(
        status=ProviderVideo.Status.PROCESSING,
        processing_started_at__lt=now - timedelta(hours=settings.VIDEO_ENCODE_LEASE_HOURS),
    ).update(status=ProviderVideo.Status.QUEUED, processing_started_at=None)

    abandoned = 0
    stale = ProviderVideo.objects.filter(
        status=ProviderVideo.Status.UPLOADING,
        updated_at__lt=now - timedelta(hours=settings.VIDEO_ABANDONED_UPLOAD_HOURS),
    )
    for video in stale:
        # delete() runs the same clean-up as a trainer removing it.
        video.delete()
        abandoned += 1
    return requeued, abandoned
