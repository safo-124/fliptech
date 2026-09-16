"""Preparing uploaded photographs for storage: orientation, EXIF, and size.

Section 10 commits to collecting the minimum, and "anything not collected
cannot be leaked". Field officers photograph workshops on their own phones, and
phone photographs carry GPS coordinates in EXIF — which for a home-based
workshop is the owner's home address.

Orientation is applied before the metadata is discarded. Skipping that step is
the classic bug: EXIF carries the rotation flag, so stripping it naively leaves
half the photographs lying on their side.

Photographs are also downscaled to MAX_STORED_EDGE. Section 10 asks for images
"sized for the device", which next/image does at serve time — but it does that
by reading the stored original for every size it emits, so an oversized
original is a cost paid on disk and on every optimiser pass, not just once.
"""

import logging
from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

# Photographs are re-encoded as JPEG. next/image produces the WebP variants at
# serve time, so there is nothing to gain by storing two derived formats here.
JPEG_QUALITY = 88
STRIPPABLE_FORMATS = {"JPEG", "PNG", "WEBP", "TIFF", "HEIF", "HEIC"}

# Longest edge kept, in pixels.
#
# A current phone camera produces something like 4000x3000 and 8-12 MB. Nothing
# on this site ever displays a workshop photograph larger than about 1200px
# wide, so the remaining pixels are paid for three times: disk on a 40 GB VPS,
# the image optimiser re-reading the original for every size it emits, and the
# upload itself over a prepaid mobile connection.
#
# 2048 keeps enough for a full-width hero on a high-density desktop screen and
# turns a 10 MB upload into roughly 400 KB. Photographs smaller than this are
# left alone — upscaling would only invent detail.
MAX_STORED_EDGE = 2048


def strip_exif(django_file):
    """Return a ContentFile with orientation applied and metadata removed.

    Returns None when the upload is not an image Pillow can read — a scanned
    PDF of a CTVET certificate, for example — so callers can store it as-is.
    """
    try:
        django_file.seek(0)
        image = Image.open(django_file)
        image_format = (image.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError):
        logger.info("Upload is not a readable image, storing unchanged")
        return None

    if image_format not in STRIPPABLE_FORMATS:
        return None

    # Rotate the pixels to match the EXIF orientation flag, then drop the flag.
    image = ImageOps.exif_transpose(image)

    if image.mode in ("RGBA", "P", "LA"):
        image = image.convert("RGB")

    # thumbnail() is in-place, keeps the aspect ratio, and never enlarges, so a
    # photograph already under the limit passes through untouched.
    if max(image.size) > MAX_STORED_EDGE:
        image.thumbnail((MAX_STORED_EDGE, MAX_STORED_EDGE), Image.LANCZOS)

    buffer = BytesIO()
    # Pillow does not carry EXIF into the output unless it is passed explicitly,
    # so simply not passing it is the strip.
    image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    buffer.seek(0)

    return ContentFile(buffer.read())


def stripped_name(original_name):
    """Uploads are re-encoded as JPEG, so the extension has to follow."""
    from pathlib import Path

    return f"{Path(original_name).stem}.jpg"
