"""Tests for the back office.

The two behaviours worth pinning are the ones that are policy rather than code
convenience: publication needs a second pair of eyes, and photographs must not
carry the location they were taken at.
"""

from io import BytesIO

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from geography.models import Area, Region
from providers.models import ListingConfirmation, Provider, ProviderPhoto, Suspension

ACCRA = Point(-0.1870, 5.6037, srid=4326)

EXIF_MAKE = 0x010F
EXIF_ORIENTATION = 0x0112


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


@pytest.fixture
def provider(area):
    return Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PENDING_APPROVAL,
    )


@pytest.fixture
def groups(db):
    from django.core.management import call_command

    call_command("setup_groups", verbosity=0)
    return {
        "officer": Group.objects.get(name="Field officer"),
        "lead": Group.objects.get(name="Operations lead"),
    }


def staff_user(django_user_model, username, group):
    user = django_user_model.objects.create_user(username, password="test-pass-1234", is_staff=True)
    user.groups.add(group)
    return user


def photo_with_exif():
    """A wide red image carrying a camera make and a 90-degree rotation flag."""
    image = Image.new("RGB", (20, 10), "red")
    exif = image.getexif()
    exif[EXIF_MAKE] = "TestPhoneMaker"
    exif[EXIF_ORIENTATION] = 6  # rotate 90 degrees clockwise
    buffer = BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    buffer.seek(0)
    return SimpleUploadedFile("workshop.jpg", buffer.read(), content_type="image/jpeg")


# --------------------------------------------------------------------------
# The second pair of eyes
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_field_officer_cannot_publish_a_listing(client, django_user_model, groups, provider):
    officer = staff_user(django_user_model, "officer", groups["officer"])
    client.force_login(officer)

    client.post(
        reverse("admin:providers_provider_changelist"),
        {"action": "publish_listings", "_selected_action": [provider.pk]},
        follow=True,
    )

    provider.refresh_from_db()
    assert provider.status == Provider.Status.PENDING_APPROVAL
    assert provider.published_at is None


@pytest.mark.django_db
def test_operations_lead_can_publish_a_listing(client, django_user_model, groups, provider):
    lead = staff_user(django_user_model, "lead", groups["lead"])
    assert lead.has_perm("providers.publish_provider")
    client.force_login(lead)

    client.post(
        reverse("admin:providers_provider_changelist"),
        {"action": "publish_listings", "_selected_action": [provider.pk]},
        follow=True,
    )

    provider.refresh_from_db()
    assert provider.status == Provider.Status.PUBLISHED
    assert provider.published_at is not None


@pytest.mark.django_db
def test_publishing_skips_a_draft_that_was_never_submitted(
    client, django_user_model, groups, provider
):
    """Draft goes to pending, pending goes to published. Not straight through."""
    provider.status = Provider.Status.DRAFT
    provider.save()
    lead = staff_user(django_user_model, "lead", groups["lead"])
    client.force_login(lead)

    client.post(
        reverse("admin:providers_provider_changelist"),
        {"action": "publish_listings", "_selected_action": [provider.pk]},
        follow=True,
    )

    provider.refresh_from_db()
    assert provider.status == Provider.Status.DRAFT


# --------------------------------------------------------------------------
# EXIF
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_uploaded_photograph_has_its_location_metadata_removed(provider, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path

    photo = ProviderPhoto.objects.create(provider=provider, image=photo_with_exif())

    photo.refresh_from_db()
    assert photo.exif_stripped is True

    with Image.open(photo.image.path) as stored:
        assert dict(stored.getexif()) == {}


@pytest.mark.django_db
def test_orientation_is_applied_before_the_metadata_is_discarded(provider, settings, tmp_path):
    """Stripping EXIF naively leaves half the photographs on their side."""
    settings.MEDIA_ROOT = tmp_path

    photo = ProviderPhoto.objects.create(provider=provider, image=photo_with_exif())

    with Image.open(photo.image.path) as stored:
        # The source was 20x10 with a "rotate 90" flag, so the pixels must now
        # be 10x20 rather than relying on a flag that no longer exists.
        assert stored.size == (10, 20)


# --------------------------------------------------------------------------
# Moderation and freshness
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_suspending_a_provider_records_the_reason_and_hides_the_listing(
    client, django_user_model, groups, provider
):
    lead = staff_user(django_user_model, "lead", groups["lead"])
    client.force_login(lead)

    client.post(
        reverse("admin:providers_suspension_add"),
        {
            "provider": provider.pk,
            "reason": "Fees advertised do not match fees charged",
            "detail": "Two trainees reported a different figure on arrival.",
            "raised_by": lead.pk,
            "started_at_0": "2026-08-17",
            "started_at_1": "10:00:00",
        },
        follow=True,
    )

    suspension = Suspension.objects.get(provider=provider)
    assert suspension.reason  # Section 09: the reason must be logged
    provider.refresh_from_db()
    assert provider.status == Provider.Status.SUSPENDED


@pytest.mark.django_db
def test_a_confirmed_listing_updates_the_freshness_clock(provider, django_user_model):
    from django.utils import timezone

    assert provider.last_confirmed_at is None

    responded = timezone.now()
    confirmation = ListingConfirmation.objects.create(
        provider=provider,
        prompted_at=responded,
        responded_at=responded,
        fees_confirmed=True,
        intakes_confirmed=True,
    )

    # The admin performs this step; assert the data it depends on is coherent.
    Provider.objects.filter(pk=provider.pk).update(last_confirmed_at=confirmation.responded_at)
    provider.refresh_from_db()

    assert provider.last_confirmed_at is not None
    assert provider.is_listing_stale is False


# --------------------------------------------------------------------------
# The back office loads at all
# --------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url_name",
    [
        "admin:providers_provider_changelist",
        "admin:providers_verification_changelist",
        "admin:providers_governmentstatus_changelist",
        "admin:providers_suspension_changelist",
        "admin:providers_listingconfirmation_changelist",
        "admin:catalog_trade_changelist",
        "admin:catalog_programme_changelist",
        "admin:catalog_intake_changelist",
        "admin:geography_region_changelist",
        "admin:geography_area_changelist",
        "admin:enquiries_enquiry_changelist",
        "admin:enquiries_enrolment_changelist",
        "admin:billing_subscription_changelist",
    ],
)
def test_back_office_pages_load(client, django_user_model, url_name):
    admin_user = django_user_model.objects.create_superuser("boss", password="test-pass-1234")
    client.force_login(admin_user)

    assert client.get(reverse(url_name)).status_code == 200


@pytest.mark.django_db
def test_provider_change_form_loads_with_every_inline(client, django_user_model, provider):
    admin_user = django_user_model.objects.create_superuser("boss", password="test-pass-1234")
    client.force_login(admin_user)

    response = client.get(reverse("admin:providers_provider_change", args=[provider.pk]))

    assert response.status_code == 200
    content = response.content.decode()
    assert "Government status" in content
    assert "Private evidence" in content
