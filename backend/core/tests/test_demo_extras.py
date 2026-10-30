"""Demo shops and lessons: made by seed_demo, visibly demo, and removed by purge_demo."""

import shutil
from io import StringIO
from pathlib import Path

import pytest
from django.core.files.storage import storages
from django.core.management import call_command

from marketplace.models import Product, SellerAccount
from providers.models import Provider, ProviderVideo

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg is not installed"
)


@pytest.fixture(autouse=True)
def media(settings, tmp_path, monkeypatch):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.VIDEO_WORK_DIR = str(tmp_path / "work")
    settings.VIDEO_MIN_FREE_BYTES = 0
    private = storages["private"]
    monkeypatch.setattr(private, "_location", str(tmp_path / "private"))
    for cached in ("base_location", "location"):
        private.__dict__.pop(cached, None)
    yield tmp_path
    for cached in ("base_location", "location"):
        private.__dict__.pop(cached, None)


def run(command, *args):
    out = StringIO()
    call_command(command, *args, stdout=out)
    return out.getvalue()


@pytest.mark.django_db
def test_demo_shops_are_visible_and_plainly_demo():
    run("seed_demo", "--providers", "6", "--no-lessons")

    visible = Product.objects.visible()
    assert visible.count() >= 8
    # Every demo product says so, and every demo shop has a reserved number.
    assert all("demo" in product.description.lower() for product in visible)
    assert all(product.photos.exists() for product in visible)
    shops = SellerAccount.objects.all()
    assert all(shop.business_name and shop.area_id for shop in shops)
    # Some shops are workshops that also sell; some are makers who only sell.
    assert shops.filter(provider__isnull=False).exists()
    assert shops.filter(provider__isnull=True).exists()


@pytest.mark.django_db
def test_seeding_twice_does_not_double_the_shops():
    run("seed_demo", "--providers", "6", "--no-lessons", "--no-images")
    first = Product.objects.count()

    run("seed_demo", "--providers", "6", "--no-lessons", "--no-images")

    assert Product.objects.count() == first
    assert SellerAccount.objects.count() == 6


@needs_ffmpeg
@pytest.mark.django_db
def test_demo_lessons_are_encoded_approved_and_make_courses(client):
    out = run("seed_demo", "--providers", "6", "--no-shops", "--no-images")

    assert "6 demo lessons" in out
    lessons = ProviderVideo.objects.shown()
    assert lessons.count() == 6
    lesson = lessons.first()
    assert lesson.public_360 and lesson.public_poster and lesson.duration_seconds
    # They show up in Online learning, one course per workshop.
    assert client.get("/api/courses/").json()["count"] == 3


@needs_ffmpeg
@pytest.mark.django_db
def test_purging_removes_shops_lessons_and_their_files(media, django_capture_on_commit_callbacks):
    run("seed_demo", "--providers", "6")
    lesson_file = Path(ProviderVideo.objects.shown().first().public_360.path)
    photo_file = Path(Product.objects.first().photos.first().image.path)
    assert lesson_file.exists() and photo_file.exists()

    dry = run("purge_demo")
    assert "demo shops" in dry and SellerAccount.objects.exists()

    with django_capture_on_commit_callbacks(execute=True):
        run("purge_demo", "--yes")

    assert not SellerAccount.objects.exists()
    assert not Product.objects.exists()
    assert not ProviderVideo.objects.exists()
    assert not Provider.objects.exists()
    assert not lesson_file.exists()
    assert not photo_file.exists()


@needs_ffmpeg
@pytest.mark.django_db
def test_a_running_video_worker_cannot_snatch_a_lesson_mid_seed(monkeypatch):
    """What happened on the live server: fliptech-video took a demo lesson
    the moment it was created, before its file existed, failed it, and
    deleted the file the seeder was about to read."""
    from core import demo_extras
    from providers.video_encoding import process_next

    original = demo_extras._lesson_video
    snatched = []

    def worker_runs_meanwhile(frame_png, target):
        # The worker wakes between the row appearing and the file arriving.
        snatched.append(process_next())
        original(frame_png, target)

    monkeypatch.setattr(demo_extras, "_lesson_video", worker_runs_meanwhile)

    out = run("seed_demo", "--providers", "3", "--no-shops", "--no-images")

    assert set(snatched) == {None}
    assert "6 demo lessons" in out
    assert ProviderVideo.objects.shown().count() == 6


@needs_ffmpeg
@pytest.mark.django_db
def test_a_lesson_left_failed_by_an_earlier_run_is_made_again():
    run("seed_demo", "--providers", "3", "--no-shops", "--no-images", "--no-lessons")
    provider = Provider.objects.order_by("pk").first()
    title = f"Lesson 1: {provider.programmes.first().trade.name} basics"
    ProviderVideo.objects.create(
        provider=provider,
        title=title,
        status=ProviderVideo.Status.FAILED,
        failure_reason="The video did not arrive in full. Send it again.",
    )

    run("seed_demo", "--providers", "3", "--no-shops", "--no-images")

    [lesson] = provider.videos.filter(title=title)
    assert lesson.status == ProviderVideo.Status.APPROVED
