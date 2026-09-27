"""Optional details collected while the account is created.

Sign-up asks for a phone number and nothing else is ever required — Section 03
names extra steps as what makes people give up. The form shows name, education
and an address, and an account appears whether or not any of them is filled.

The rules worth holding down are about what the details may not do: overwrite
something already there, claim an address that is not proven, or take an
address that belongs to someone else.
"""

from io import BytesIO, StringIO  # noqa: F401

import pytest
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from enquiries import otp
from trainees.auth import account_for_verified_phone
from trainees.models import TraineeAccount

PHONE = "+233201110311"


@pytest.fixture
def sent(monkeypatch):
    from django.core.cache import cache

    cache.clear()
    box = {"sms": [], "email": []}
    monkeypatch.setattr(otp, "send_sms", lambda to, m: box["sms"].append((str(to), m)))
    monkeypatch.setattr(otp, "send_email", lambda to, s, b: box["email"].append((str(to), s, b)))
    monkeypatch.setattr(otp, "_generate_code", lambda: "246810")
    return box


def sign_up(client, phone=PHONE, **profile):
    request = client.post(
        reverse("trainee-otp-request"),
        {"phone": phone, **({"email": profile["email"]} if "email" in profile else {})},
        content_type="application/json",
    )
    challenge = request.json()["challenge_id"]
    return client.post(
        reverse("trainee-otp-verify"),
        {"challenge_id": challenge, "phone": phone, "code": "246810", "profile": profile},
        content_type="application/json",
    )


@pytest.mark.django_db
def test_an_account_appears_with_nothing_but_a_number(client, sent):
    """The rule the whole form is built around."""
    response = sign_up(client)

    assert response.status_code == 200
    assert TraineeAccount.objects.filter(phone=PHONE).exists()


@pytest.mark.django_db
def test_the_details_are_kept(client, sent):
    sign_up(
        client,
        display_name="Ama Mensah",
        education_level="shs_technical",
        institution_name="Accra Technical",
        field_of_study="Building construction",
        education_status="completed",
        education_year=2024,
    )

    account = TraineeAccount.objects.get(phone=PHONE)
    assert account.display_name == "Ama Mensah"
    assert account.education_level == "shs_technical"
    assert account.institution_name == "Accra Technical"
    assert account.field_of_study == "Building construction"
    assert account.education_status == "completed"
    assert account.education_year == 2024


@pytest.mark.django_db
def test_blanks_are_not_an_error(client, sent):
    """Every field is optional, so the form may send empty strings for the
    ones nobody filled rather than having to omit them."""
    response = sign_up(client, display_name="", education_level="", education_year=None)

    assert response.status_code == 200


@pytest.mark.django_db
def test_signing_in_again_does_not_wipe_what_is_there(client, sent):
    """It is the same form and it says so. Somebody signing in on a new phone,
    with the boxes empty, must not lose the details they gave last year."""
    account = account_for_verified_phone(phone=PHONE, verified_at=timezone.now())
    account.display_name = "Ama Mensah"
    account.field_of_study = "Welding"
    account.save()

    sign_up(client, display_name="", field_of_study="")

    account.refresh_from_db()
    assert account.display_name == "Ama Mensah"
    assert account.field_of_study == "Welding"


@pytest.mark.django_db
def test_a_filled_box_does_not_overwrite_an_existing_answer(client, sent):
    """Sign-up fills blanks. Changing an answer is what the settings screen is
    for, where the person can see what they are replacing."""
    account = account_for_verified_phone(phone=PHONE, verified_at=timezone.now())
    account.field_of_study = "Welding"
    account.save()

    sign_up(client, field_of_study="Tailoring")

    account.refresh_from_db()
    assert account.field_of_study == "Welding"


# --------------------------------------------------------------------------
# The address


@pytest.mark.django_db
def test_a_typed_address_is_stored_unverified(client, sent):
    """One code goes to the phone and to the address, so entering it proves
    control of one of them. Marking the address verified would let somebody
    attach a stranger's by reading their own text message."""
    sign_up(client, email="ama@example.com")

    account = TraineeAccount.objects.get(phone=PHONE)
    assert account.email == "ama@example.com"
    assert account.email_verified_at is None


@pytest.mark.django_db
def test_an_address_another_account_holds_is_left_alone(client, sent):
    """Skipped rather than refused: telling an unauthenticated caller that an
    address is registered is an enumeration oracle."""
    other = account_for_verified_phone(phone="+233201110999", verified_at=timezone.now())
    other.email = "taken@example.com"
    other.save()

    response = sign_up(client, email="taken@example.com")

    assert response.status_code == 200
    assert TraineeAccount.objects.get(phone=PHONE).email is None
    other.refresh_from_db()
    assert other.email == "taken@example.com"


@pytest.mark.django_db
def test_the_code_goes_to_the_typed_address_too(client, sent):
    """There is no account yet to look an address up on, so the form's is the
    only one there is."""
    sign_up(client, email="ama@example.com")

    assert [to for to, _, _ in sent["email"]] == ["ama@example.com"]
    assert len(sent["sms"]) == 1


@pytest.mark.django_db
def test_copies_to_a_typed_address_are_capped(client, sent):
    """Otherwise sign-up is a way to post mail into a stranger's inbox,
    limited only by how many phone numbers somebody has."""
    from enquiries.email_otp import MAX_PER_EMAIL_PER_DAY, may_copy_code_to

    for _ in range(MAX_PER_EMAIL_PER_DAY):
        assert may_copy_code_to("victim@example.com") is True

    assert may_copy_code_to("victim@example.com") is False


@pytest.mark.django_db
def test_an_empty_address_is_never_copied_to():
    from enquiries.email_otp import may_copy_code_to

    assert may_copy_code_to("") is False
    assert may_copy_code_to(None) is False


# --------------------------------------------------------------------------
# The picture


def jpeg_upload(name="me.jpg"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    buffer = BytesIO()
    image = Image.new("RGB", (900, 700), "red")
    data = image.getexif()
    data[0x0110] = "TestPhone"
    image.save(buffer, format="JPEG", exif=data)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


@pytest.fixture
def signed_in(client, db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    account = account_for_verified_phone(phone=PHONE, verified_at=timezone.now())
    client.force_login(account.user)
    return account


@pytest.mark.django_db
def test_a_picture_can_be_uploaded(client, signed_in):
    response = client.post(reverse("trainee-avatar"), {"avatar": jpeg_upload()})

    assert response.status_code == 201
    signed_in.refresh_from_db()
    assert signed_in.avatar


@pytest.mark.django_db
def test_the_picture_is_downscaled_and_stripped(client, signed_in, settings):
    """A phone photograph carries GPS, and Section 10 commits to collecting
    the minimum."""
    from core.images import MAX_AVATAR_EDGE

    client.post(reverse("trainee-avatar"), {"avatar": jpeg_upload()})
    signed_in.refresh_from_db()

    stored = Image.open(settings.MEDIA_ROOT / signed_in.avatar.name)
    assert max(stored.size) <= MAX_AVATAR_EDGE
    assert not stored.getexif()


@pytest.mark.django_db
def test_a_file_that_is_not_an_image_is_refused(client, signed_in):
    from django.core.files.uploadedfile import SimpleUploadedFile

    response = client.post(
        reverse("trainee-avatar"),
        {"avatar": SimpleUploadedFile("cv.pdf", b"%PDF-1.4", content_type="application/pdf")},
    )

    assert response.status_code == 400
    signed_in.refresh_from_db()
    assert not signed_in.avatar


@pytest.mark.django_db
def test_it_can_be_taken_down(client, signed_in):
    """It is a photograph of a person. Being unable to remove it would be its
    own problem."""
    client.post(reverse("trainee-avatar"), {"avatar": jpeg_upload()})

    response = client.delete(reverse("trainee-avatar"))

    assert response.status_code == 200
    signed_in.refresh_from_db()
    assert not signed_in.avatar


@pytest.mark.django_db
def test_a_stranger_cannot_upload(client, db):
    response = client.post(reverse("trainee-avatar"), {"avatar": jpeg_upload()})

    assert response.status_code in (401, 403)
