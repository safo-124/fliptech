"""Taking a video file a piece at a time.

An hour of teaching filmed on a phone is gigabytes, and the phone sending it
is on 3G. Sent as one request it would take most of an hour, hold one of the
API's few worker threads the whole time, and start again from nothing the
first time the signal dropped. So the browser sends it in pieces of
settings.VIDEO_CHUNK_BYTES, each one a short request, and says where each
piece starts. A dropped connection costs one piece: the browser asks how much
arrived and carries on from there.

The same idea as the tus protocol, kept to the part this needs: one header,
Upload-Offset, and the rule that a piece is only taken if it starts exactly
where the last one ended. That rule is what makes a retried request safe. A
piece that arrived but whose answer was lost is sent again, is refused as
out of place, and the browser is told the real offset.

Pieces are appended to a file in settings.VIDEO_WORK_DIR, named after the
video's id. It is never in media storage: it is unreviewed, and only the
encoder reads it.
"""

import contextlib
import os
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils.translation import gettext as _

from .models import ProviderVideo


class ChunkRefused(Exception):
    """A piece that was not taken. `received` is where the next must start."""

    def __init__(self, message, *, received, status=400):
        super().__init__(message)
        self.received = received
        self.status = status


def work_dir():
    path = Path(settings.VIDEO_WORK_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def work_path(video):
    return _work_path_for(video.pk)


def _work_path_for(video_id):
    return work_dir() / f"{video_id}.upload"


def remove_work_file(video, *, video_id=None):
    """`video_id` for a video already deleted, whose instance has lost its pk."""
    with contextlib.suppress(OSError):
        _work_path_for(video_id or video.pk).unlink(missing_ok=True)


def read_chunk(read):
    """The body of one piece, read before anything is locked.

    One byte more than a piece may be, so an oversized one is noticed rather
    than silently cut short. Read here, outside the transaction, because a
    2 MB piece arriving over 3G takes seconds, and a row lock held open for
    them is a row lock held open for nothing.
    """
    return read(settings.VIDEO_CHUNK_BYTES + 1)


def receive_chunk(video_id, *, offset, data):
    """Append one piece to an upload, and return the video.

    The row is locked for the whole append, so two requests for one upload —
    a retry racing its original — are taken one after the other, and the
    second is refused by the offset check rather than writing the same bytes
    twice.
    """
    with transaction.atomic():
        video = ProviderVideo.objects.select_for_update().get(pk=video_id)
        if video.status != ProviderVideo.Status.UPLOADING:
            raise ChunkRefused(
                _("This video has already been sent."), received=video.upload_received, status=409
            )
        if offset != video.upload_received:
            raise ChunkRefused(
                _("That piece is out of place."), received=video.upload_received, status=409
            )
        if not data:
            raise ChunkRefused(_("That piece was empty."), received=video.upload_received)
        remaining = video.upload_size - video.upload_received
        if len(data) > settings.VIDEO_CHUNK_BYTES or len(data) > remaining:
            raise ChunkRefused(
                _("That piece is larger than the upload has room for."),
                received=video.upload_received,
            )

        path = work_path(video)
        with open(path, "ab") as handle:
            # A previous request may have written bytes and then died before
            # the row was updated. The row is the truth; cut the file back
            # to it before appending. Append mode always writes at the end,
            # which is now exactly there.
            handle.truncate(video.upload_received)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())

        video.upload_received += len(data)
        update = ["upload_received", "updated_at"]
        if video.upload_received == video.upload_size:
            # Complete. The encoder picks it up from here.
            video.status = ProviderVideo.Status.QUEUED
            update.append("status")
        video.save(update_fields=update)
        return video
