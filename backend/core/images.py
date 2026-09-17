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

import contextlib
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

# Logos are a different job from photographs.
#
# They render at about 40px on a result card and 64px on a profile, never as a
# hero. 512 is generous for that and keeps a file a workshop owner uploads from
# a phone down to a few tens of kilobytes.
MAX_LOGO_EDGE = 512


def strip_exif(django_file, *, max_edge=MAX_STORED_EDGE, keep_transparency=False):
    """Return a ContentFile with orientation applied and metadata removed.

    Returns None when the upload is not an image Pillow can read — a scanned
    PDF of a CTVET certificate, for example — so callers can store it as-is.

    `keep_transparency` writes PNG instead of JPEG when the source actually has
    an alpha channel. It exists for logos: JPEG cannot store transparency, so
    flattening one onto white puts a white box around the mark on every
    coloured surface it is placed on. Photographs never need it, and PNG would
    make them several times larger, so it is off by default.
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

    # "P" mode can carry transparency in a palette entry rather than a channel,
    # which `image.mode in ("RGBA", "LA")` alone would miss.
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    as_png = keep_transparency and has_alpha

    if as_png:
        image = image.convert("RGBA")
    elif image.mode in ("RGBA", "P", "LA"):
        image = image.convert("RGB")

    # thumbnail() is in-place, keeps the aspect ratio, and never enlarges, so an
    # image already under the limit passes through untouched.
    if max(image.size) > max_edge:
        image.thumbnail((max_edge, max_edge), Image.LANCZOS)

    buffer = BytesIO()
    # Pillow does not carry EXIF into the output unless it is passed explicitly,
    # so simply not passing it is the strip.
    if as_png:
        image.save(buffer, format="PNG", optimize=True)
    else:
        image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    buffer.seek(0)

    return ContentFile(buffer.read())


def stripped_name(original_name, *, png=False):
    """Uploads are re-encoded, so the extension has to follow what was written."""
    from pathlib import Path

    return f"{Path(original_name).stem}.{'png' if png else 'jpg'}"


def has_transparency(django_file):
    """True when the upload carries an alpha channel Pillow can see.

    "P" mode stores transparency in a palette entry rather than a channel, so
    checking the mode alone misses palette PNGs — which is most logos exported
    from a design tool.
    """
    try:
        django_file.seek(0)
        with Image.open(django_file) as image:
            return image.mode in ("RGBA", "LA") or (
                image.mode == "P" and "transparency" in image.info
            )
    except (UnidentifiedImageError, OSError, ValueError):
        return False
    finally:
        # A file already closed or not seekable is not a failure here: the
        # caller only needs the answer, and strip_exif seeks again itself.
        with contextlib.suppress(OSError, ValueError):
            django_file.seek(0)


def prepare_logo(django_file):
    """A logo, sized for a card and with any transparency kept.

    Returns (content, is_png). is_png tells the caller which extension to store
    it under, because a PNG saved as .jpg is served with the wrong content type
    and some browsers refuse it.

    Returns (None, False) when Pillow cannot read the upload.
    """
    as_png = has_transparency(django_file)
    content = strip_exif(django_file, max_edge=MAX_LOGO_EDGE, keep_transparency=True)
    if content is None:
        return None, False
    return content, as_png
