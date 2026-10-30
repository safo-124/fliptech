"""The home page's staff-chosen photographs."""

from io import BytesIO

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from PIL import Image

from core.models import HomePicture


def jpeg(name="tailor.jpg"):
    buffer = BytesIO()
    Image.new("RGB", (640, 400), (120, 60, 160)).save(buffer, "JPEG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


@pytest.mark.django_db
def test_each_place_with_a_picture_is_listed_and_empty_ones_are_absent(client):
    HomePicture.objects.create(
        slot=HomePicture.Slot.HERO,
        image=jpeg(),
        alt_text="A tailor at her machine.",
        credit="Photo: Sir Amugi, CC BY-SA 4.0",
    )

    body = client.get(reverse("home-pictures")).json()

    assert set(body) == {"hero"}
    assert body["hero"]["alt"] == "A tailor at her machine."
    assert body["hero"]["credit"] == "Photo: Sir Amugi, CC BY-SA 4.0"
    assert "/media/home/" in body["hero"]["url"]


@pytest.mark.django_db
def test_an_uploaded_picture_loses_its_location_data():
    picture = HomePicture.objects.create(
        slot=HomePicture.Slot.TRAINING, image=jpeg(), alt_text="A welder."
    )

    assert picture.exif_stripped


@pytest.mark.django_db
def test_an_operations_lead_can_change_the_pictures_and_a_field_officer_cannot(
    client, django_user_model
):
    call_command("setup_groups", verbosity=0)
    lead = django_user_model.objects.create_user("lead", password="pw", is_staff=True)
    lead.groups.add(Group.objects.get(name="Operations lead"))
    officer = django_user_model.objects.create_user("officer", password="pw", is_staff=True)
    officer.groups.add(Group.objects.get(name="Field officer"))
    url = reverse("admin:core_homepicture_add")

    client.force_login(officer)
    assert client.get(url).status_code == 403

    client.force_login(lead)
    response = client.post(
        url,
        {"slot": "hero", "image": jpeg(), "alt_text": "A tailor at her machine.", "credit": ""},
    )
    assert response.status_code == 302, response.content
    assert HomePicture.objects.get().slot == "hero"
