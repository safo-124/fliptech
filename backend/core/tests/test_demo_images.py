"""The illustrative images the seeder draws.

Worth testing for two reasons. The logo is the one place transparency has to
survive, and a silent font fallback once rendered a 300px heading as unreadable
specks — a failure that looked like a layout bug and would not have shown up
anywhere except by opening the file.
"""

from io import BytesIO

from PIL import Image

from core import demo_images


def open_bytes(data):
    return Image.open(BytesIO(data))


def test_a_panel_is_a_readable_image_of_the_expected_size():
    data = demo_images.panel(
        provider_name="Accra Central Welding Works",
        trade_name="Welding",
        kind="workshop",
        index=0,
    )

    with open_bytes(data) as image:
        assert image.format == "JPEG"
        assert image.size == demo_images.PHOTO_SIZE


def test_a_logo_keeps_its_transparency():
    """It is stored as PNG precisely so this survives.

    A logo flattened onto white shows a white box on the indigo header.
    """
    data = demo_images.logo(provider_name="Accra Central Welding Works", initials="AC")

    with open_bytes(data) as image:
        assert image.format == "PNG"
        assert image.mode == "RGBA"
        # The corner is outside the circle, so it must be fully transparent.
        assert image.getpixel((0, 0))[3] == 0


def test_the_same_provider_always_gets_the_same_image():
    """Re-seeding must not churn the media directory."""
    first = demo_images.panel(
        provider_name="Tema Tailoring Centre", trade_name="Tailoring", kind="work", index=0
    )
    second = demo_images.panel(
        provider_name="Tema Tailoring Centre", trade_name="Tailoring", kind="work", index=0
    )

    assert first == second


def test_different_providers_get_different_images():
    first = demo_images.panel(
        provider_name="Tema Tailoring Centre", trade_name="Tailoring", kind="work", index=0
    )
    second = demo_images.panel(
        provider_name="Madina Plumbing Works", trade_name="Plumbing", kind="work", index=0
    )

    assert first != second


def test_the_workshop_and_the_work_look_different():
    """Different palettes, so the two galleries read as two things."""
    workshop = demo_images.panel(
        provider_name="Tema Tailoring Centre", trade_name="Tailoring", kind="workshop", index=0
    )
    work = demo_images.panel(
        provider_name="Tema Tailoring Centre", trade_name="Tailoring", kind="work", index=0
    )

    assert workshop != work


def test_the_heading_is_actually_drawn_at_a_readable_size():
    """Guards the font fallback.

    `ImageFont.load_default()` returns a fixed 11px bitmap and ignores the size
    it is given, which made the heading invisible while everything still
    "worked". Measuring the drawn text is the only way that shows up.
    """
    font = demo_images._font(300)
    bbox = font.getbbox("DEMO")

    assert bbox[3] - bbox[1] > 100
