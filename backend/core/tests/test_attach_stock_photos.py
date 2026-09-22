"""Stock photographs on a named listing.

This one writes to a real workshop's public page, so the tests are about it
refusing clearly when it is pointed somewhere wrong, and about the credit
surviving into the caption — which is the only thing on the page that tells a
reader the picture is not of this workshop.
"""

from io import StringIO

import pytest
from django.contrib.gis.geos import Point
from django.core.files.base import ContentFile
from django.core.management import CommandError, call_command

from catalog.models import Programme, Trade
from core import trade_photos
from geography.models import Area, Region
from providers.models import Provider, ProviderPhoto

ACCRA = Point(-0.2174, 5.5502, srid=4326)


def run(*args):
    out = StringIO()
    call_command("attach_stock_photos", *args, stdout=out)
    return out.getvalue()


@pytest.fixture
def listing(db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.BASE_DIR = tmp_path
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(
        region=region, name="Accra Central", slug="accra-central", centroid=ACCRA
    )
    trade = Trade.objects.create(name="Hairdressing", slug="hairdressing")
    provider = Provider.objects.create(
        name="Test 1",
        slug="test-1",
        area=area,
        location=ACCRA,
        contact_phone="+233544736822",
        status=Provider.Status.PUBLISHED,
    )
    Programme.objects.create(
        provider=provider, trade=trade, title="Hairdressing", fee=1800, duration_weeks=24
    )
    return provider


@pytest.fixture
def cached(listing):
    """Two fake files in the cache, so nothing reaches the network."""
    directory = trade_photos.cache_dir()
    directory.mkdir(parents=True, exist_ok=True)
    for entry in trade_photos.PHOTOS["hairdressing"]:
        (directory / trade_photos.filename("hairdressing", entry)).write_bytes(b"jpeg-bytes")
    return listing


def test_a_bad_address_is_refused(listing):
    with pytest.raises(CommandError, match="area-slug/provider-slug"):
        run("test-1")


def test_an_unknown_listing_is_refused(listing):
    with pytest.raises(CommandError, match="No listing at"):
        run("accra-central/not-here")


def test_it_refuses_rather_than_running_with_an_empty_cache(listing):
    """Otherwise it reports success having attached nothing."""
    with pytest.raises(CommandError, match="fetch_trade_photos"):
        run("accra-central/test-1")


def test_an_unknown_trade_lists_the_ones_it_has(listing):
    with pytest.raises(CommandError, match="hairdressing"):
        run("accra-central/test-1", "--trade", "basket-weaving")


@pytest.mark.django_db
def test_it_takes_the_trade_from_the_listing(cached):
    """Naming the trade twice is a chance to name it wrong."""
    run("accra-central/test-1")

    assert cached.photos.count() == 2


@pytest.mark.django_db
def test_the_credit_lands_in_the_caption(cached):
    """The caption is the only thing on the page that says whose photograph
    this is, and the licence requires it."""
    run("accra-central/test-1")

    for photo in cached.photos.all():
        assert "Wikimedia Commons" in photo.caption
        assert "CC BY" in photo.caption


@pytest.mark.django_db
def test_it_says_out_loud_that_these_are_not_this_workshop(cached):
    output = run("accra-central/test-1")

    assert "not pictures of this workshop" in output


@pytest.mark.django_db
def test_replace_clears_the_demo_panels_and_their_files(cached, settings):
    """Without --replace the existing panels stay and nothing changes, because
    a workshop photograph already exists for that kind."""
    old = ProviderPhoto(provider=cached, kind=ProviderPhoto.Kind.WORKSHOP)
    old.image.save("demo.jpg", ContentFile(b"old"), save=True)
    path = settings.MEDIA_ROOT / old.image.name

    assert path.exists()

    run("accra-central/test-1", "--replace")

    assert not path.exists()
    assert cached.photos.count() == 2
    assert not cached.photos.filter(caption="").exists()


@pytest.mark.django_db
def test_without_replace_an_existing_kind_is_left_alone(cached):
    old = ProviderPhoto(provider=cached, kind=ProviderPhoto.Kind.WORKSHOP)
    old.image.save("demo.jpg", ContentFile(b"old"), save=True)

    run("accra-central/test-1")

    assert cached.photos.filter(kind=ProviderPhoto.Kind.WORKSHOP).count() == 1
    assert cached.photos.filter(kind=ProviderPhoto.Kind.WORK).count() == 1
