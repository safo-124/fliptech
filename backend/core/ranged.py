"""Serving a private file to staff in a way a video player can seek through.

A browser playing a video asks for it in ranges ("bytes=1048576-"), and
jumping to minute forty of a lesson is one such request. A plain
FileResponse answers every one with the whole file from the start, so the
player can only ever play from the beginning, and a reviewer spot-checking
an hour-long lesson cannot.

Only for files that are private and only behind a permission check: public
files are served by Caddy, which handles ranges itself. When private storage
is a bucket rather than a disk, the signed URL it issues is used instead,
and the bucket handles ranges.
"""

import mimetypes
import re

from django.http import HttpResponse, HttpResponseRedirect, StreamingHttpResponse

RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
BLOCK = 64 * 1024


def _stream(path, start, length):
    # Opened inside the generator, so the file is closed when the response
    # finishes or the player hangs up, not left to the garbage collector.
    with open(path, "rb") as handle:
        handle.seek(start)
        remaining = length
        while remaining > 0:
            data = handle.read(min(BLOCK, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def serve_private_file(request, field_file):
    """A response for `field_file` that honours a Range header."""
    storage = field_file.storage
    try:
        path = storage.path(field_file.name)
    except NotImplementedError:
        return HttpResponseRedirect(storage.url(field_file.name))

    size = storage.size(field_file.name)
    content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    start, end = 0, size - 1
    partial = False

    match = RANGE.match(request.headers.get("Range", "").strip())
    if match and (match.group(1) or match.group(2)):
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            # "bytes=-500": the last 500 bytes.
            start = max(size - int(last), 0)
        if start > end or start >= size:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        partial = True

    length = end - start + 1
    response = StreamingHttpResponse(
        _stream(path, start, length),
        status=206 if partial else 200,
        content_type=content_type,
    )
    response["Content-Length"] = str(length)
    response["Accept-Ranges"] = "bytes"
    if partial:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    # Unreviewed content, for one member of staff: nothing in between keeps it.
    response["Cache-Control"] = "private, no-store"
    return response
