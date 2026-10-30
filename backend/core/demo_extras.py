"""Demo shops and demo lessons, so the marketplace and Online learning have
something in them on a demo site. Called by seed_demo; undone by purge_demo.

The same rule as the demo workshops: invented, and visibly so. Every product
picture and every lesson says DEMO on it, and the names are plainly made up.
A demo site that showed a convincing shop of real-looking goods would be a
shop that does not exist.

What counts as demo is decided by constants here, not guessed: every demo
seller has one of DEMO_SELLER_PHONES, and purge_demo removes exactly those.
"""

import shutil
import subprocess
import tempfile
from decimal import Decimal
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.utils import timezone

from . import demo_images
from .identities import create_dedicated_user

# Ghana's 020 prefix with a run of zeros: valid in shape, and not a number
# anybody is likely to hold. Twenty, so the demo can grow without new rules.
DEMO_SELLER_PHONES = [f"+2332000009{n:02d}" for n in range(20)]

# By trade slug: what a workshop teaching that trade might also make and sell.
WORKSHOP_GOODS = {
    "tailoring": [("Ankara tote bag", 180), ("Kente-trim shirt", 250)],
    "welding": [("Steel shoe rack", 350), ("Charcoal grill", 420)],
    "hairdressing": [("Braiding hair oil", 45), ("Satin hair bonnet", 30)],
    "electrical-installation": [("Wired extension board", 95)],
    "auto-mechanics": [("Car tool roll", 120)],
    "plumbing": [("Brass garden tap, fitted", 60)],
}

# Makers who sell and teach nobody: the marketplace is for them too.
MAKERS = [
    ("Akua's Herbal Soaps (demo)", [("Shea butter soap", 35), ("Black soap, large", 40)]),
    ("Nhyira Beads (demo)", [("Beaded necklace set", 80), ("Waist beads", 50)]),
]

# Workshops given demo shops and demo lessons: the first few seeded.
SHOPS_FROM_WORKSHOPS = 4
LESSON_WORKSHOPS = 3
LESSONS_EACH = 2
LESSON_SECONDS = 12


def _seller(phone, *, business_name, area, provider=None):
    from marketplace.models import SellerAccount

    seller = SellerAccount.objects.filter(phone=phone).first()
    if seller is None:
        seller = SellerAccount(
            phone=phone,
            user=create_dedicated_user(get_user_model(), prefix="seller"),
            phone_verified_at=timezone.now(),
        )
    seller.business_name = business_name
    seller.about = "A demo shop. Everything in it is invented."
    seller.area = area
    seller.provider = provider
    seller.approval_status = SellerAccount.Approval.CONFIRMED
    seller.approval_decided_at = seller.approval_decided_at or timezone.now()
    seller.save()
    return seller


def _product(seller, name, price, *, trade, with_images):
    from django.utils.text import slugify

    from marketplace.models import Product, ProductPhoto

    product, _ = Product.objects.update_or_create(
        seller=seller,
        slug=slugify(name),
        defaults={
            "name": name,
            "price": Decimal(price),
            "trade": trade,
            "description": "A demo product, for trying the marketplace. Not for sale.",
            "status": Product.Status.PUBLISHED,
        },
    )
    if with_images and not product.photos.exists():
        ProductPhoto.objects.create(
            product=product,
            image=ContentFile(
                demo_images.product(product_name=name, seller_name=seller.business_name),
                name=f"{product.slug}.jpg",
            ),
        )
    return product


def seed_shops(seeded, *, with_images):
    """Demo shops: some workshops that also sell, and two makers who only sell.

    `seeded` is [(provider, trade)] in the order seed_demo made them.
    Returns how many products the demo shops hold.
    """
    from marketplace.models import SellerAccount

    phones = iter(DEMO_SELLER_PHONES)
    count = 0
    for provider, trade in seeded[:SHOPS_FROM_WORKSHOPS]:
        phone = next(phones)
        # A workshop has one shop. If somebody real already linked theirs to
        # this demo listing, the demo shop goes unlinked rather than taking it.
        theirs = SellerAccount.objects.filter(provider=provider).exclude(phone=phone).exists()
        seller = _seller(
            phone,
            business_name=provider.name,
            area=provider.area,
            provider=None if theirs else provider,
        )
        for name, price in WORKSHOP_GOODS.get(trade.slug, []):
            _product(seller, name, price, trade=trade, with_images=with_images)
            count += 1

    areas = [provider.area for provider, _ in seeded] or [None]
    for index, (business_name, goods) in enumerate(MAKERS):
        seller = _seller(next(phones), business_name=business_name, area=areas[index % len(areas)])
        for name, price in goods:
            _product(seller, name, price, trade=None, with_images=with_images)
            count += 1
    return count


def _lesson_video(frame_png, target):
    """Loop one still into a short video with a quiet tone, as a phone file would be."""
    with tempfile.TemporaryDirectory() as scratch:
        frame = Path(scratch) / "frame.png"
        frame.write_bytes(frame_png)
        subprocess.run(
            [
                "ffmpeg", "-nostdin", "-y", "-v", "error",
                "-loop", "1", "-i", str(frame),
                "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100",
                "-t", str(LESSON_SECONDS),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25",
                "-c:a", "aac", "-shortest",
                # The work file is named .upload, which says nothing about
                # the format, so it is stated.
                "-f", "mp4", str(target),
            ],
            check=True,
            capture_output=True,
        )  # fmt: skip


def seed_lessons(seeded, *, reviewer):
    """Demo lessons, through the real pipeline: uploaded, encoded, approved.

    They go through encode() and decide() like any trainer's video, so a demo
    site shows exactly what a real lesson looks and plays like. Needs ffmpeg;
    returns None when it is not installed, and the number of lessons otherwise.
    """
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        return None

    from providers import video_uploads
    from providers.models import ProviderVideo
    from providers.video_encoding import encode
    from providers.videos import decide

    count = 0
    for provider, trade in seeded[:LESSON_WORKSHOPS]:
        for number in range(1, LESSONS_EACH + 1):
            title = f"Lesson {number}: {trade.name} basics"
            if provider.videos.filter(title=title).exists():
                count += 1
                continue
            video = ProviderVideo.objects.create(
                provider=provider,
                title=title,
                status=ProviderVideo.Status.QUEUED,
                upload_name=f"demo-lesson-{number}.mp4",
            )
            work = video_uploads.work_path(video)
            _lesson_video(
                demo_images.lesson_frame(lesson_title=title, provider_name=provider.name), work
            )
            video.upload_size = video.upload_received = work.stat().st_size
            video.save(update_fields=["upload_size", "upload_received"])
            encode(video)
            decide(video, ProviderVideo.Status.APPROVED, by=reviewer)
            count += 1
    return count
