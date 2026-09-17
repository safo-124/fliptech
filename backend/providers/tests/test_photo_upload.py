"""Tests for the background photograph uploader.

The point of this feature is that a bad connection costs one photograph rather
than the whole site visit, so the failure paths are tested as carefully as the
happy one — plus the permission and file-type checks, since this endpoint takes
an upload from a phone in the field.
"""

from io import BytesIO

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from core.images import MAX_LOGO_EDGE, MAX_STORED_EDGE
from geography.models import Area, Region
from providers.admin_upload import MAX_UPLOAD_BYTES
from providers.models import Provider, ProviderPhoto

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def provider(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    return Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )


@pytest.fixture
def officer(db, client, django_user_model):
    from django.core.management import call_command

    call_command("setup_groups", verbosity=0)
    user = django_user_model.objects.create_user(
        "officer", password="test-pass-1234", is_staff=True
    )
    user.groups.add(Group.objects.get(name="Field officer"))
    client.force_login(user)
    return user


def photo_file(name="workshop.jpg", size=(40, 30), exif=True):
    image = Image.new("RGB", size, "red")
    buffer = BytesIO()
    if exif:
        data = image.getexif()
        data[0x010F] = "TestPhoneMaker"
        data[0x0112] = 6  # rotate 90
        image.save(buffer, format="JPEG", exif=data)
    else:
        image.save(buffer, format="JPEG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/jpeg")


def upload_url(provider):
    return reverse("admin:providers_provider_upload_photo", args=[provider.pk])


# --------------------------------------------------------------------------
# The happy path
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_photograph_uploads_on_its_own_without_the_form(
    client, officer, provider, settings, tmp_path
):
    """No provider form is submitted here. That is the whole point."""
    settings.MEDIA_ROOT = tmp_path

    response = client.post(upload_url(provider), {"image": photo_file()})
    body = response.json()

    assert response.status_code == 201
    assert body["exif_stripped"] is True
    assert provider.photos.count() == 1


@pytest.mark.django_db
def test_upload_strips_location_data_and_applies_orientation(
    client, officer, provider, settings, tmp_path
):
    settings.MEDIA_ROOT = tmp_path

    client.post(upload_url(provider), {"image": photo_file(size=(40, 30))})

    photo = provider.photos.get()
    with Image.open(photo.image.path) as stored:
        assert dict(stored.getexif()) == {}
        # 40x30 carrying a rotate-90 flag must come back transposed.
        assert stored.size == (30, 40)


@pytest.mark.django_db
def test_each_upload_is_independent(client, officer, provider, settings, tmp_path):
    """Three separate requests, so one failure cannot take the others."""
    settings.MEDIA_ROOT = tmp_path

    for i in range(3):
        response = client.post(upload_url(provider), {"image": photo_file(f"w{i}.jpg")})
        assert response.status_code == 201

    assert provider.photos.count() == 3


# --------------------------------------------------------------------------
# Rejections — these must not retry client-side, so they must be 4xx
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_non_image_is_rejected_and_not_stored(client, officer, provider, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    pretend = SimpleUploadedFile("notes.jpg", b"this is not an image", content_type="image/jpeg")

    response = client.post(upload_url(provider), {"image": pretend})

    assert 400 <= response.status_code < 500
    assert ProviderPhoto.objects.count() == 0


@pytest.mark.django_db
def test_a_disallowed_content_type_is_refused(client, officer, provider, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    pdf = SimpleUploadedFile("scan.pdf", b"%PDF-1.4", content_type="application/pdf")

    response = client.post(upload_url(provider), {"image": pdf})

    assert response.status_code == 400
    assert ProviderPhoto.objects.count() == 0


@pytest.mark.django_db
def test_an_oversized_file_is_refused_with_a_useful_message(
    client, officer, provider, settings, tmp_path
):
    settings.MEDIA_ROOT = tmp_path
    huge = SimpleUploadedFile("huge.jpg", b"x" * (MAX_UPLOAD_BYTES + 1), content_type="image/jpeg")

    response = client.post(upload_url(provider), {"image": huge})

    assert response.status_code == 400
    assert "MB" in response.json()["detail"]


@pytest.mark.django_db
def test_a_request_with_no_file_is_a_bad_request(client, officer, provider):
    response = client.post(upload_url(provider), {})

    assert response.status_code == 400


# --------------------------------------------------------------------------
# Permissions
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_an_anonymous_visitor_cannot_upload(client, provider):
    response = client.post(upload_url(provider), {"image": photo_file()})

    assert response.status_code in (302, 403)
    assert ProviderPhoto.objects.count() == 0


@pytest.mark.django_db
def test_a_staff_member_without_change_permission_cannot_upload(
    client, django_user_model, provider, settings, tmp_path
):
    settings.MEDIA_ROOT = tmp_path
    weak = django_user_model.objects.create_user("weak", password="test-pass-1234", is_staff=True)
    client.force_login(weak)

    response = client.post(upload_url(provider), {"image": photo_file()})

    assert response.status_code == 403
    assert ProviderPhoto.objects.count() == 0


@pytest.mark.django_db
def test_get_is_not_allowed_on_the_upload_endpoint(client, officer, provider):
    assert client.get(upload_url(provider)).status_code == 405


# --------------------------------------------------------------------------
# Caption and delete
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_caption_saves_without_touching_the_provider_form(
    client, officer, provider, settings, tmp_path
):
    settings.MEDIA_ROOT = tmp_path
    photo_id = client.post(upload_url(provider), {"image": photo_file()}).json()["id"]

    response = client.post(
        reverse("admin:providers_provider_caption_photo", args=[provider.pk, photo_id]),
        {"caption": "Bench and welding masks"},
    )

    assert response.status_code == 200
    assert ProviderPhoto.objects.get(pk=photo_id).caption == "Bench and welding masks"


@pytest.mark.django_db
def test_a_photograph_can_be_deleted(client, officer, provider, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    photo_id = client.post(upload_url(provider), {"image": photo_file()}).json()["id"]

    response = client.post(
        reverse("admin:providers_provider_delete_photo", args=[provider.pk, photo_id])
    )

    assert response.status_code == 200
    assert ProviderPhoto.objects.count() == 0


@pytest.mark.django_db
def test_a_photograph_cannot_be_deleted_through_another_provider(
    client, officer, provider, settings, tmp_path
):
    """The provider id in the URL is checked, not just the photo id."""
    settings.MEDIA_ROOT = tmp_path
    photo_id = client.post(upload_url(provider), {"image": photo_file()}).json()["id"]
    other = Provider.objects.create(
        name="Other",
        slug="other",
        area=provider.area,
        location=ACCRA,
        contact_phone="+233240000000",
    )

    response = client.post(
        reverse("admin:providers_provider_delete_photo", args=[other.pk, photo_id])
    )

    assert response.status_code == 404
    assert ProviderPhoto.objects.count() == 1


# --------------------------------------------------------------------------
# The change form
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_uploader_appears_only_after_the_provider_is_saved(client, officer, provider):
    """Photographs need a provider id, so the add form explains the order."""
    add_page = client.get(reverse("admin:providers_provider_add")).content.decode()
    change_page = client.get(
        reverse("admin:providers_provider_change", args=[provider.pk])
    ).content.decode()

    assert "data-photo-uploader" not in add_page
    assert "Save the provider first" in add_page
    assert "data-photo-uploader" in change_page
    assert "photo_uploader.js" in change_page


# --------------------------------------------------------------------------
# Size


def test_a_large_photograph_is_downscaled_before_storage(
    client, officer, provider, settings, tmp_path
):
    """A phone camera photograph must not be stored at full resolution.

    Nothing on the site displays a workshop photograph wider than about
    1200px, and the image optimiser re-reads the stored original for every
    size it emits. Keeping 4000px costs disk on a small VPS and CPU on every
    request.
    """
    settings.MEDIA_ROOT = tmp_path

    # exif=False so this measures size alone. The default fixture carries an
    # orientation flag of 6, and exif_transpose correctly rotates the image
    # before it is scaled — which is what rotation is tested for elsewhere, and
    # only noise here.
    response = client.post(
        upload_url(provider), {"image": photo_file(size=(4000, 3000), exif=False)}
    )
    assert response.status_code == 201

    photo = ProviderPhoto.objects.get()
    with Image.open(photo.image.path) as stored:
        assert max(stored.size) == MAX_STORED_EDGE
        # The aspect ratio survives: 4000x3000 is 4:3, so 2048 wide is 1536 tall.
        assert stored.size == (MAX_STORED_EDGE, int(MAX_STORED_EDGE * 3 / 4))


def test_a_small_photograph_is_left_at_its_own_size(client, officer, provider, settings, tmp_path):
    """Downscaling never enlarges. Upscaling would only invent detail."""
    settings.MEDIA_ROOT = tmp_path

    response = client.post(upload_url(provider), {"image": photo_file(size=(640, 480), exif=False)})
    assert response.status_code == 201

    photo = ProviderPhoto.objects.get()
    with Image.open(photo.image.path) as stored:
        assert stored.size == (640, 480)


# --------------------------------------------------------------------------
# Logos


def png_with_transparency(name="logo.png", size=(900, 900)):
    """A logo as a design tool exports one: RGBA, with real transparency."""
    image = Image.new("RGBA", size, (255, 0, 0, 0))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/png")


def test_a_transparent_logo_stays_transparent(provider, settings, tmp_path):
    """JPEG cannot store an alpha channel.

    Flattening a logo onto white puts a white box around the mark on every
    coloured surface it is placed on, which on this site is the indigo header.
    """
    settings.MEDIA_ROOT = tmp_path

    provider.logo = png_with_transparency()
    provider.save()

    assert provider.logo.name.endswith(".png")
    with Image.open(provider.logo.path) as stored:
        assert stored.mode == "RGBA"


def test_a_logo_is_scaled_down_harder_than_a_photograph(provider, settings, tmp_path):
    """It renders at about 40px on a card. 2048 would be absurd."""
    settings.MEDIA_ROOT = tmp_path

    provider.logo = png_with_transparency(size=(900, 900))
    provider.save()

    with Image.open(provider.logo.path) as stored:
        assert max(stored.size) == MAX_LOGO_EDGE


def test_an_opaque_logo_is_stored_as_jpeg(provider, settings, tmp_path):
    """PNG would be several times larger for no benefit."""
    settings.MEDIA_ROOT = tmp_path

    provider.logo = photo_file("logo.jpg", size=(600, 600), exif=False)
    provider.save()

    assert provider.logo.name.endswith(".jpg")


def test_saving_again_does_not_re_encode_the_logo(provider, settings, tmp_path):
    """`_committed` guards this, exactly as it does for photographs."""
    settings.MEDIA_ROOT = tmp_path

    provider.logo = png_with_transparency()
    provider.save()
    stored_name = provider.logo.name

    provider.name = "Renamed Works"
    provider.save()

    assert provider.logo.name == stored_name


# --------------------------------------------------------------------------
# What a photograph shows


def test_a_photograph_records_what_it_shows(client, officer, provider, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path

    client.post(upload_url(provider), {"image": photo_file(), "kind": "work"})

    assert ProviderPhoto.objects.get().kind == ProviderPhoto.Kind.WORK


def test_an_unrecognised_kind_falls_back_to_the_workshop(
    client, officer, provider, settings, tmp_path
):
    """The safer default.

    A work photo mislabelled as premises is cosmetic. The reverse would let a
    picture of a yard satisfy the "show me the work" requirement.
    """
    settings.MEDIA_ROOT = tmp_path

    client.post(upload_url(provider), {"image": photo_file(), "kind": "nonsense"})

    assert ProviderPhoto.objects.get().kind == ProviderPhoto.Kind.WORKSHOP
