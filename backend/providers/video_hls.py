"""Streaming copies of approved lessons (HLS), for players on a weak signal.

A whole MP4 plays at one sharpness: a trainee whose signal drops half way
through a 720p lesson waits for it to buffer. HLS cuts each copy into pieces
a few seconds long and lists them, so the player can take the next piece from
the 360p copy when the signal weakens and go back up when it returns.

Nothing is encoded again. The pieces are cut from the MP4s already made and
approved (`-c copy`), which takes seconds rather than the minutes encoding
did, and the pictures are the ones staff watched.

Made by the video worker (process_videos) after approval, never in a web
request. They live in public storage under HLS_PREFIX, so Caddy's forward_auth
asks Django before serving each playlist and piece, exactly as it does for
the MP4s: a locked lesson stays locked (see courses/access.py). Taking a
lesson down deletes them, and the MP4s keep playing for any browser or
lesson without them.
"""

import json
import logging
import secrets
import shutil
import subprocess
import tempfile
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.files import File
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from .models import ProviderVideo

logger = logging.getLogger(__name__)

HLS_PREFIX = "videos/public/hls/"
MASTER = "master.m3u8"
# Seconds a piece aims at. Cut at the encoder's keyframes, so pieces come out
# near this rather than exactly at it.
PIECE_SECONDS = 6
# How long a worker may hold one before another takes it over.
LEASE = timedelta(hours=1)


def enabled():
    return settings.VIDEO_HLS


def stream_url(video, request=None):
    """The master playlist's public address, or None."""
    if video.hls_state != ProviderVideo.HlsState.READY or not video.hls_dir:
        return None
    from core.media import public_url

    return public_url(default_storage.url(f"{video.hls_dir}/{MASTER}"), request)


def _run(arguments, binary=None, timeout=600):
    command = [binary or settings.VIDEO_FFMPEG, *arguments]
    if shutil.which("nice"):
        command = ["nice", "-n", "19", *command]
    return subprocess.run(command, capture_output=True, timeout=timeout, check=False)


def _size(path):
    """(width, height, seconds) of a video file."""
    result = _run(
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        binary=settings.VIDEO_FFPROBE,
        timeout=120,
    )
    info = json.loads(result.stdout or b"{}")
    stream = next(s for s in info["streams"] if s.get("codec_type") == "video")
    return int(stream["width"]), int(stream["height"]), float(info["format"]["duration"])


def _local_copy(field_file, scratch, name):
    """A path ffmpeg can read: the file itself on disk, or a copy of it."""
    try:
        return Path(field_file.path)
    except NotImplementedError:  # A bucket: copy it down first.
        target = Path(scratch) / name
        with field_file.open("rb") as source, open(target, "wb") as out:
            shutil.copyfileobj(source, out)
        return target


def make_stream(video):
    """Cut the approved MP4s into an HLS stream and save it. Raises on failure."""
    with tempfile.TemporaryDirectory() as scratch:
        out = Path(scratch) / "out"
        out.mkdir()
        variants = []
        for quality in (360, 720):
            field_file = getattr(video, f"public_{quality}")
            if not field_file:
                continue
            source = _local_copy(field_file, scratch, f"{quality}.mp4")
            width, height, seconds = _size(source)
            result = _run(
                [
                    "-nostdin",
                    "-y",
                    "-i",
                    str(source),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-c",
                    "copy",
                    "-f",
                    "hls",
                    "-hls_time",
                    str(PIECE_SECONDS),
                    "-hls_playlist_type",
                    "vod",
                    "-hls_segment_filename",
                    str(out / f"{quality}_%04d.ts"),
                    str(out / f"{quality}.m3u8"),
                ],
                timeout=int(seconds * 2) + 300,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.decode(errors="replace")[-500:])
            size = getattr(video, f"size_{quality}") or source.stat().st_size
            # Peak a little above the average, as players expect.
            bandwidth = int(size * 8 / max(seconds, 1) * 1.2)
            variants.append((quality, width, height, bandwidth))
        if not variants:
            raise RuntimeError("No approved files to stream from")

        lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
        for quality, width, height, bandwidth in variants:
            lines.append(
                f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={width}x{height},"
                f'NAME="{quality}p"'
            )
            lines.append(f"{quality}.m3u8")
        (out / MASTER).write_text("\n".join(lines) + "\n")

        folder = f"{HLS_PREFIX}{timezone.now():%Y/%m}/{secrets.token_urlsafe(12)}"
        for path in sorted(out.iterdir()):
            with open(path, "rb") as handle:
                default_storage.save(f"{folder}/{path.name}", File(handle))

    with transaction.atomic():
        current = ProviderVideo.objects.select_for_update().filter(pk=video.pk).first()
        # Taken down, or deleted, while the pieces were being cut: they must
        # not stay at a public address.
        if current is None or current.status != ProviderVideo.Status.APPROVED:
            _delete_folder(folder)
            return None
        current.hls_dir = folder
        current.hls_state = ProviderVideo.HlsState.READY
        current.save(update_fields=["hls_dir", "hls_state", "updated_at"])
        return current


def _delete_folder(folder):
    if not folder or not folder.startswith(HLS_PREFIX):
        return
    try:
        _dirs, files = default_storage.listdir(folder)
    except (FileNotFoundError, OSError):
        return
    for name in files:
        try:
            default_storage.delete(f"{folder}/{name}")
        except Exception:
            logger.warning("Could not delete %s/%s", folder, name, exc_info=True)
    try:
        path = Path(default_storage.path(folder))
        path.rmdir()
    except (NotImplementedError, OSError):
        pass


def delete_stream(video, *, save=True):
    """Remove a lesson's streaming copy, wherever it is. Never raises."""
    folder = video.hls_dir
    video.hls_dir = ""
    video.hls_state = ProviderVideo.HlsState.NONE
    if save and video.pk:
        ProviderVideo.objects.filter(pk=video.pk).update(hls_dir="", hls_state="")
    try:
        _delete_folder(folder)
    except Exception:
        logger.warning("Could not delete the stream of video %s", video.pk, exc_info=True)


def claim_next():
    """The next approved upload with no stream yet, marked as being made."""
    with transaction.atomic():
        video = (
            ProviderVideo.objects.select_for_update(skip_locked=True)
            .filter(status=ProviderVideo.Status.APPROVED, youtube_id="", hls_state="")
            .exclude(public_360="")
            .order_by("reviewed_at", "pk")
            .first()
        )
        if video is None:
            return None
        video.hls_state = ProviderVideo.HlsState.PROCESSING
        video.save(update_fields=["hls_state", "updated_at"])
        return video


def process_next():
    """Make one stream if any lesson is waiting. Returns the video, or None."""
    if not enabled():
        return None
    video = claim_next()
    if video is None:
        return None
    try:
        return make_stream(video) or video
    except Exception:
        logger.exception("Making the stream of video %s failed", video.pk)
        ProviderVideo.objects.filter(pk=video.pk).update(hls_state=ProviderVideo.HlsState.FAILED)
        return video


def tidy():
    """Hand back streams whose worker died, so another makes them."""
    return ProviderVideo.objects.filter(
        hls_state=ProviderVideo.HlsState.PROCESSING, updated_at__lt=timezone.now() - LEASE
    ).update(hls_state=ProviderVideo.HlsState.NONE)
