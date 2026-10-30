"""Illustrative images for the demo data, drawn here rather than downloaded.

Two constraints shaped this.

Nothing is fetched from an image service. There is no network call, no API key
and no third party in the loop — these are a few hundred lines of Pillow, so
`seed_demo` works on a box with no outbound access and cannot break because
somebody else's free tier changed.

They are deliberately not fake photographs. Section 01 says every provider
name, fee and figure in the mockups is invented and shown as such, and the same
has to hold for imagery: this site puts verification badges next to these
listings, and a plausible-looking photograph of a workshop that does not exist
undermines the one claim the product is built on. So each image is a flat
geometric panel with the word DEMO on it. Nobody will mistake one for a
workshop, which is the point.

Every image is generated from a seed derived from the provider, so re-running
the seeder produces byte-identical files instead of a new set each time.
"""

import hashlib
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

# Drawn large enough to exercise the real pipeline: ProviderPhoto.save runs
# strip_exif over these, so the downscale to MAX_STORED_EDGE actually happens
# on seeded data rather than being a code path only tests reach.
PHOTO_SIZE = (2400, 1800)
LOGO_SIZE = (800, 800)

# Two palettes, so the workshop and the work read as different things at a
# glance in the profile galleries.
WORKSHOP_PALETTE = [
    ((34, 21, 92), (92, 62, 191)),
    ((28, 44, 92), (58, 110, 165)),
    ((48, 28, 74), (122, 78, 160)),
]
WORK_PALETTE = [
    ((122, 60, 30), (224, 154, 108)),
    ((104, 74, 24), (222, 186, 108)),
    ((120, 46, 58), (222, 138, 135)),
]


def _font(size):
    """A real font when the system has one, Pillow's own otherwise.

    DejaVu ships with most Linux images and is what CI and the server have;
    the Windows paths are there so the same command produces the same picture
    during development.

    The fallback passes `size`. Plain `load_default()` returns a fixed 11px
    bitmap that silently ignores the argument, which rendered a 300px heading
    as unreadable specks — the failure looked like a layout bug rather than a
    missing font, which is why it is worth the explicit call.
    """
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _seed(*parts):
    """A stable integer from the provider, so re-seeding is reproducible."""
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode()).digest()
    return int.from_bytes(digest[:4], "big")


def _gradient(size, top, bottom):
    """A vertical gradient, one row at a time.

    Pillow has no gradient primitive and a per-pixel loop over 2400x1800 is
    slow enough to notice when seeding two dozen providers; drawing 1800 lines
    is not.
    """
    image = Image.new("RGB", size, top)
    draw = ImageDraw.Draw(image)
    width, height = size
    for y in range(height):
        ratio = y / max(height - 1, 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(a + (b - a) * ratio) for a, b in zip(top, bottom, strict=True)),
        )
    return image


def _centred(draw, box, text, font, fill):
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    text_box = draw.textbbox((0, 0), text, font=font)
    draw.text(
        (
            left + (width - (text_box[2] - text_box[0])) / 2 - text_box[0],
            top + (height - (text_box[3] - text_box[1])) / 2 - text_box[1],
        ),
        text,
        font=font,
        fill=fill,
    )


def _labelled(*, rng, palette, size, heading, subtitle, caption, heading_size=300):
    """A gradient with translucent bands and three centred lines of text."""
    top, bottom = palette[rng % len(palette)]
    image = _gradient(size, top, bottom)
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = size

    # A few translucent bands, offset by the seed. Enough to stop the panels
    # looking identical in a grid, and obviously not a photograph.
    for band in range(5):
        offset = ((rng >> (band * 3)) % 7 - 3) * 90
        x = width * (band + 1) / 6 + offset
        draw.polygon(
            [
                (x, height),
                (x + width / 9, height),
                (x + width / 5, 0),
                (x + width / 14, 0),
            ],
            fill=(255, 255, 255, 22 + (band % 3) * 10),
        )

    # Sized from the width, so a 1280px video frame reads like a 2400px photo.
    scale = width / PHOTO_SIZE[0]
    _centred(
        draw,
        (0, height * 0.30, width, height * 0.58),
        heading,
        _font(round(heading_size * scale)),
        (255, 255, 255, 235),
    )
    _centred(
        draw,
        (0, height * 0.58, width, height * 0.70),
        subtitle,
        _font(round(86 * scale)),
        (255, 255, 255, 205),
    )
    _centred(
        draw,
        (0, height * 0.72, width, height * 0.82),
        caption,
        _font(round(58 * scale)),
        (255, 255, 255, 165),
    )
    return image


def _jpeg(image):
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def panel(*, provider_name, trade_name, kind, index):
    """One illustrative panel, as JPEG bytes.

    `kind` is "workshop" or "work", and only changes the palette and the
    caption — there is no pretence that one shows a building and the other a
    finished gate.
    """
    return _jpeg(
        _labelled(
            rng=_seed(provider_name, trade_name, kind, index),
            palette=WORKSHOP_PALETTE if kind == "workshop" else WORK_PALETTE,
            size=PHOTO_SIZE,
            heading="DEMO",
            subtitle=f"{trade_name} · {'the workshop' if kind == 'workshop' else 'their work'}",
            caption="Illustrative image, not a real workshop",
        )
    )


def product(*, product_name, seller_name):
    """A demo product's picture, as JPEG bytes. Labelled as not real, like the rest."""
    return _jpeg(
        _labelled(
            rng=_seed(product_name, seller_name, "product"),
            palette=WORK_PALETTE,
            size=PHOTO_SIZE,
            heading="DEMO",
            subtitle=product_name,
            caption="Illustrative image, not a real product",
        )
    )


# A lesson's title card is a video frame: 16:9, at the 720p the encoder makes.
LESSON_FRAME = (1280, 720)


def lesson_frame(*, lesson_title, provider_name):
    """The still a demo lesson shows for its whole length, as PNG bytes.

    PNG, not JPEG: ffmpeg loops it into a video, and a lossless still keeps
    the text sharp through the encode.
    """
    image = _labelled(
        rng=_seed(lesson_title, provider_name, "lesson"),
        palette=WORKSHOP_PALETTE,
        size=LESSON_FRAME,
        heading="DEMO LESSON",
        # Two words where the photographs have one: smaller, so it clears
        # the frame's edges.
        heading_size=200,
        subtitle=lesson_title,
        caption="Illustrative video, not a real lesson",
    )
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def logo(*, provider_name, initials):
    """A monogram on a transparent background, as PNG bytes.

    PNG with real transparency on purpose: it is what a workshop would actually
    upload, and it is the case the storage pipeline handles specially — so
    seeded data exercises the alpha path rather than leaving it to tests.
    """
    rng = _seed(provider_name, "logo")
    hue = WORKSHOP_PALETTE[rng % len(WORKSHOP_PALETTE)][1]

    image = Image.new("RGBA", LOGO_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    width, height = LOGO_SIZE

    draw.ellipse([(40, 40), (width - 40, height - 40)], fill=hue + (255,))
    draw.ellipse(
        [(120, 120), (width - 120, height - 120)],
        outline=(255, 255, 255, 190),
        width=18,
    )
    _centred(draw, (0, 0, width, height), initials, _font(300), (255, 255, 255, 240))

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
