"""Pruning orphaned public media.

This deletes files off a live server, so the tests are about what it refuses
to touch: anything a row still points at, anything recent enough that a cached
page might still be asking for it, and the private directory entirely.
"""

from datetime import timedelta
from io import BytesIO, StringIO

import pytest
from django.contrib.gis.geos import Point
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.utils import timezone
from PIL import Image

from geography.models import Area, Region
from providers.models import Provider, ProviderPhoto

ACCRA = Point(-0.1870, 5.6037, srid=4326)


def prune(*args):
    out = StringIO()
    call_command("prune_media", *args, stdout=out)
    return out.getvalue()


def jpeg():
    buffer = BytesIO()
    Image.new("RGB", (30, 20), "red").save(buffer, format="JPEG")
    return ContentFile(buffer.getvalue())


def age(path, days):
    """Backdate a file so it falls outside the safety window."""
    import os

    old = (timezone.now() - timedelta(days=days)).timestamp()
    os.utime(path, (old, old))


@pytest.fixture
def media(db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    (tmp_path / "media").mkdir()
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    return tmp_path / "media", area


def orphan(root, name="providers/2026/09/gone.jpg", days=30):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"orphaned")
    age(path, days)
    return path


@pytest.mark.django_db
def test_an_old_orphan_is_deleted(media):
    root, _ = media
    path = orphan(root)

    prune("--yes")

    assert not path.exists()


@pytest.mark.django_db
def test_a_dry_run_deletes_nothing(media):
    root, _ = media
    path = orphan(root)

    output = prune()

    assert path.exists()
    assert "Dry run" in output


@pytest.mark.django_db
def test_a_file_a_row_points_at_survives(media):
    """The whole point. A referenced file is a live photograph."""
    root, area = media
    provider = Provider.objects.create(
        name="Accra Welding",
        slug="accra-welding",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )
    photo = ProviderPhoto(provider=provider, kind=ProviderPhoto.Kind.WORKSHOP)
    photo.image.save("live.jpg", jpeg(), save=True)
    path = root / photo.image.name
    age(path, 30)

    prune("--yes")

    assert path.exists()


@pytest.mark.django_db
def test_a_logo_counts_as_referenced(media):
    """Logos live in their own directory and are just as live."""
    root, area = media
    provider = Provider.objects.create(
        name="Accra Welding",
        slug="accra-welding",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )
    provider.logo.save("logo.jpg", jpeg(), save=True)
    path = root / provider.logo.name
    age(path, 30)

    prune("--yes")

    assert path.exists()


@pytest.mark.django_db
def test_a_recent_orphan_is_left_alone(media):
    """A page cached five minutes ago may still be asking for it. Deleting it
    now is the broken image this command exists to avoid causing."""
    root, _ = media
    path = orphan(root, name="providers/2026/09/just-replaced.jpg", days=0)

    output = prune("--yes")

    assert path.exists()
    assert "Nothing to do" in output


@pytest.mark.django_db
def test_the_window_can_be_narrowed_deliberately(media):
    root, _ = media
    path = orphan(root, name="providers/2026/09/yesterday.jpg", days=2)

    prune("--yes", "--older-than", "1")

    assert not path.exists()


@pytest.mark.django_db
def test_private_media_is_never_walked(media, settings, tmp_path):
    """Verification evidence and identity documents are not public, and a
    pruner that wandered in could delete the proof behind a published badge."""
    private = tmp_path / "private-media"
    private.mkdir()
    settings.PRIVATE_MEDIA_ROOT = private
    evidence = private / "evidence" / "ghana-card.jpg"
    evidence.parent.mkdir(parents=True)
    evidence.write_bytes(b"identity document")
    age(evidence, 365)

    prune("--yes")

    assert evidence.exists()


@pytest.mark.django_db
def test_nothing_to_do_is_not_an_error(media):
    assert "Nothing to do" in prune("--yes")
