"""The account's own picture: set from the website or the app, shown to its
owner in the header, cleaned of its metadata."""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from accounts.app_auth import issue_token
from accounts.auth import account_for_verified_phone

PHONE = "+233241112233"


def jpeg_upload(size=(3000, 2000)):
    image = Image.new("RGB", size, (200, 120, 40))
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make: stands in for the metadata a phone adds
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return SimpleUploadedFile("me.jpg", buffer.getvalue(), content_type="image/jpeg")


@pytest.fixture
def account(db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return account_for_verified_phone(phone=PHONE, verified_at=timezone.now())


@pytest.mark.django_db
def test_a_photo_is_set_cleaned_and_shown_in_the_header(client, account, settings):
    from core.images import MAX_AVATAR_EDGE

    assert client.post(reverse("account-photo"), {"photo": jpeg_upload()}).status_code == 403

    client.force_login(account.user)
    made = client.post(reverse("account-photo"), {"photo": jpeg_upload()})
    assert made.status_code == 201
    assert made.json()["account"]["photo"]

    account.refresh_from_db()
    stored = Image.open(settings.MEDIA_ROOT / account.photo.name)
    assert max(stored.size) <= MAX_AVATAR_EDGE
    assert not stored.getexif()

    who = client.get(reverse("session-whoami")).json()
    assert who["customer"]["avatar"].endswith(account.photo.name.split("/")[-1])


@pytest.mark.django_db
def test_the_app_sets_it_with_its_token_and_can_take_it_off(client, account):
    auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_token(account.user, 'Phone')}"}
    assert (
        client.post(
            reverse("account-photo"), {"photo": jpeg_upload((400, 400))}, **auth
        ).status_code
        == 201
    )

    removed = client.delete(reverse("account-photo"), **auth)
    assert removed.status_code == 200
    assert removed.json()["account"]["photo"] is None
    account.refresh_from_db()
    assert not account.photo


@pytest.mark.django_db
def test_a_file_that_is_not_a_picture_is_refused(client, account):
    client.force_login(account.user)
    refused = client.post(
        reverse("account-photo"),
        {"photo": SimpleUploadedFile("cv.pdf", b"%PDF-1.4", content_type="application/pdf")},
    )
    assert refused.status_code == 400
    account.refresh_from_db()
    assert not account.photo
