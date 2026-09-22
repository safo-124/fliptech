"""Removing the demo data must not remove anything else.

This command deletes published providers on a live deployment, so the tests
that matter are the ones about what it leaves behind.
"""

from io import BytesIO, StringIO

import pytest
from django.contrib.gis.geos import Point
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.utils import timezone
from PIL import Image

from catalog.models import Programme, Trade
from core.management.commands.purge_demo import demo_slugs
from enquiries.models import Enquiry, Enrolment
from geography.models import Area, Region
from providers.models import Provider, ProviderMembership, ProviderPhoto
from providers.trainer_auth import account_for_verified_phone
from trainees.auth import account_for_verified_phone as trainee_for_verified_phone

ACCRA = Point(-0.2174, 5.5502, srid=4326)


def purge(*args):
    out = StringIO()
    call_command("purge_demo", *args, stdout=out)
    return out.getvalue()


@pytest.fixture
def world(db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(
        region=region, name="Accra Central", slug="accra-central", centroid=ACCRA
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    return region, area, trade


def make(area, slug, name="A workshop"):
    return Provider.objects.create(
        name=name,
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )


def test_the_slug_set_is_built_from_the_seeder():
    """If seed_demo changes its areas or suffixes, this follows automatically.

    A hand-copied list would silently stop matching and leave demo data live.
    """
    slugs = demo_slugs()

    assert "accra-central-welding-works" in slugs
    assert "tema-hairdressing-training-school" in slugs
    assert "test-1" not in slugs


@pytest.mark.django_db
def test_a_dry_run_writes_nothing(world):
    _, area, _ = world
    make(area, "accra-central-welding-works")

    output = purge()

    assert Provider.objects.count() == 1
    assert "Dry run" in output


@pytest.mark.django_db
def test_it_deletes_the_demo_listing(world):
    _, area, _ = world
    make(area, "accra-central-welding-works")

    purge("--yes")

    assert Provider.objects.count() == 0


@pytest.mark.django_db
def test_it_leaves_a_real_listing_alone(world):
    """Test 1 is a real business with a real owner. It must survive."""
    _, area, _ = world
    make(area, "test-1", name="Test 1")
    make(area, "accra-central-welding-works")

    purge("--yes")

    assert [p.slug for p in Provider.objects.all()] == ["test-1"]


@pytest.mark.django_db
def test_a_claimed_listing_survives_even_with_a_matching_slug(world):
    """The safety catch.

    A slug collision is unlikely, but a listing a trainer signed in and filled
    out is not demo data whatever it happens to be called, and losing it would
    lose their work.
    """
    _, area, _ = world
    provider = make(area, "accra-central-welding-works")
    trainer = account_for_verified_phone(phone="+233240000900", verified_at=timezone.now())
    ProviderMembership.objects.create(trainer=trainer, provider=provider)

    output = purge("--yes")

    assert Provider.objects.filter(pk=provider.pk).exists()
    assert "a trainer has signed in and claimed them" in output


@pytest.mark.django_db
def test_enrolments_do_not_block_the_delete(world):
    """Enrolment.provider is PROTECT, so it has to be cleared first.

    Without that the whole command fails partway and the site is left showing
    some of the demo data and not the rest.
    """
    _, area, trade = world
    provider = make(area, "accra-central-welding-works")
    programme = Programme.objects.create(
        provider=provider, trade=trade, title="Welding certificate", fee=900, duration_weeks=12
    )
    Enrolment.objects.create(
        provider=provider,
        programme=programme,
        trainee_phone="+233241110000",
        started_on=timezone.localdate(),
    )

    purge("--yes")

    assert Provider.objects.count() == 0
    assert Enrolment.objects.count() == 0


@pytest.mark.django_db
def test_the_photographs_leave_the_disk(world, settings):
    """Deleting rows never deletes files. Left behind, every invented
    photograph stays exactly where Caddy serves it from."""
    _, area, _ = world
    provider = make(area, "accra-central-welding-works")
    buffer = BytesIO()
    Image.new("RGB", (40, 30), "red").save(buffer, format="JPEG")
    photo = ProviderPhoto(provider=provider, kind=ProviderPhoto.Kind.WORKSHOP)
    photo.image.save("demo.jpg", ContentFile(buffer.getvalue()), save=True)
    path = settings.MEDIA_ROOT / photo.image.name

    assert path.exists()

    purge("--yes")

    assert not path.exists()


@pytest.mark.django_db
def test_it_says_when_a_real_trainee_enquired(world):
    """Their message is real even though the workshop was not. Worth saying
    out loud before it goes, not after."""
    _, area, trade = world
    provider = make(area, "accra-central-welding-works")
    programme = Programme.objects.create(
        provider=provider, trade=trade, title="Welding certificate", fee=900, duration_weeks=12
    )
    account = trainee_for_verified_phone(phone="+233241110001", verified_at=timezone.now())
    Enquiry.objects.create(
        provider=provider,
        programme=programme,
        trainee_phone="+233241110001",
        trainee=account,
        phone_verified_at=timezone.now(),
    )

    output = purge()

    assert "came from a signed-in trainee account" in output


@pytest.mark.django_db
def test_reference_data_is_not_touched(world):
    """Areas and trades are real places and real trades. A genuine listing is
    filed under them, and Test 1 already is."""
    _, area, _ = world
    make(area, "accra-central-welding-works")

    purge("--yes")

    assert Area.objects.count() == 1
    assert Region.objects.count() == 1
    assert Trade.objects.count() == 1


@pytest.mark.django_db
def test_nothing_to_do_is_not_an_error(world):
    assert "Nothing to do" in purge("--yes")
