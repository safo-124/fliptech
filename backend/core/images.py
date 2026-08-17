"""EXIF stripping for uploaded photographs.

Section 10 commits to collecting the minimum, and "anything not collected
cannot be leaked". Field officers photograph workshops on their own phones, and
phone photographs carry GPS coordinates in EXIF — which for a home-based
workshop is the owner's home address.

Orientation is applied before the metadata is discarded. Skipping that step is
the classic bug: EXIF carries the rotation flag, so stripping it naively leaves
half the photographs lying on their side.
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
