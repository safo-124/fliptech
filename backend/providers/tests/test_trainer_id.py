"""The ID on the first step of trainer sign-up.

The number has to have the shape of the ID type chosen, one card goes with one
account, and the photo of the card is taken first and read so the boxes fill
themselves. Reading is a help, never a check: these tests also pin that a
missing reader, or a photo that cannot be read, never stops anyone.
"""

from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.urls import reverse
from PIL import Image

from catalog.models import Trade
from geography.models import Area, Region
from providers import id_reading
from providers.id_numbers import id_number_problem, tidy_id_number
from providers.id_reading import CardReading, names_match, parse_card_text, read_card
from providers.models import IdNumberClash, TrainerAccount, TrainerIdPhoto
from providers.tests.test_trainer_api import (
    ACCRA,
    OTHER_PHONE,
    authenticated_csrf,
    login_trainer,
    profile_payload,
)

CARD = "GHA-724019385-6"


@pytest.fixture
def catalogue(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    return {"area": area, "trade": Trade.objects.create(name="Welding", slug="welding")}


def jpeg_upload(name="card.jpg"):
    buffer = BytesIO()
    Image.new("RGB", (120, 80), "white").save(buffer, format="JPEG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


def save_profile(client, catalogue, **overrides):
    return client.put(
        reverse("trainer-profile"),
        profile_payload(catalogue, **overrides),
        content_type="application/json",
        **authenticated_csrf(client),
    )


def upload_id(client, document_type="ghana_card"):
    return client.post(
        reverse("trainer-identity-document"),
        {"document": jpeg_upload(), "id_document_type": document_type},
        **authenticated_csrf(client),
    )


# --- What a number has to look like -----------------------------------------


@pytest.mark.parametrize(
    ("document_type", "typed", "stored"),
    [
        ("ghana_card", "gha-724019385-6", CARD),
        ("ghana_card", "GHA7240193856", CARD),
        ("ghana_card", " gha 724019385 6 ", CARD),
        # The letters left off: on a Ghanaian's card they are GHA.
        ("ghana_card", "7240193856", CARD),
        # A foreign resident's card carries their own country's letters.
        ("ghana_card", "nga 724019385 6", "NGA-724019385-6"),
        ("passport", "g 123 4567", "G1234567"),
        ("voter_id", "7240 193 856", "7240193856"),
    ],
)
def test_a_number_is_forgiven_its_spaces_and_written_one_way(document_type, typed, stored):
    tidied = tidy_id_number(document_type, typed)
    assert tidied == stored
    assert id_number_problem(document_type, tidied) is None


@pytest.mark.parametrize(
    ("document_type", "typed", "says"),
    [
        ("ghana_card", "abc", "like GHA-123456789-0"),
        ("ghana_card", "GHA-72401938-6", "like GHA-123456789-0"),
        ("ghana_card", "GHA-000000000-0", "looks like an example"),
        ("ghana_card", "GHA-123456789-0", "looks like an example"),
        ("passport", "ABCDEFG", "like G1234567"),
        ("passport", "G12", "like G1234567"),
        ("voter_id", "12345", "10 digits"),
        ("voter_id", "1234567890", "looks like an example"),
        ("", CARD, "Choose the ID type first"),
    ],
)
def test_a_number_that_does_not_fit_says_why(document_type, typed, says):
    problem = id_number_problem(document_type, tidy_id_number(document_type, typed))
    assert problem is not None and says in problem


def test_the_rule_follows_the_id_type_chosen():
    assert id_number_problem("ghana_card", "7240193856") is not None
    assert id_number_problem("voter_id", "7240193856") is None
    assert id_number_problem("passport", CARD) is not None


# --- Through the form's own API ---------------------------------------------


@pytest.mark.django_db
def test_anything_typed_is_no_longer_accepted(client, monkeypatch, catalogue):
    login_trainer(client, monkeypatch)
    response = save_profile(client, catalogue, id_document_number="abc")
    assert response.status_code == 400
    assert "GHA-123456789-0" in str(response.json()["id_document_number"])


@pytest.mark.django_db
def test_the_number_is_stored_the_one_way(client, monkeypatch, catalogue):
    login_trainer(client, monkeypatch)
    assert save_profile(client, catalogue, id_document_number="gha 724019385 6").status_code == 200
    assert TrainerAccount.objects.get().id_document_number == CARD


@pytest.mark.django_db
def test_one_card_goes_with_one_account(client, monkeypatch, catalogue):
    login_trainer(client, monkeypatch)
    assert save_profile(client, catalogue, id_document_number=CARD).status_code == 200
    first = TrainerAccount.objects.get()

    second_client = Client()
    login_trainer(second_client, monkeypatch, phone=OTHER_PHONE)
    refused = save_profile(
        second_client,
        catalogue,
        id_document_number="gha7240193856",
        name="Another Workshop",
        contact_phone="+233240000002",
    )
    assert refused.status_code == 400
    assert "already linked to another account" in str(refused.json()["id_document_number"])

    # Staff are told, once per pair however often it is tried.
    save_profile(second_client, catalogue, id_document_number=CARD, name="Another Workshop")
    clash = IdNumberClash.objects.get()
    assert clash.other_account == first
    assert str(clash.account.phone) == OTHER_PHONE
    assert clash.number == CARD

    # The account the card is on keeps saving.
    assert save_profile(client, catalogue, id_document_number=CARD).status_code == 200


@pytest.mark.django_db
def test_of_two_accounts_that_already_share_a_number_the_first_keeps_saving(
    client, monkeypatch, catalogue, django_user_model
):
    login_trainer(client, monkeypatch)
    first = TrainerAccount.objects.get()
    first.id_document_type, first.id_document_number = "ghana_card", CARD
    first.save()
    later = TrainerAccount.objects.create(
        user=django_user_model.objects.create_user(username="later"),
        phone=OTHER_PHONE,
        id_document_type="ghana_card",
        id_document_number=CARD,
    )
    assert later.created_at > first.created_at

    assert save_profile(client, catalogue, id_document_number=CARD).status_code == 200
    assert not IdNumberClash.objects.filter(account=first).exists()


# --- The photo, first, and what is read from it -----------------------------


@pytest.mark.django_db
def test_the_id_photo_is_taken_before_the_workshop_exists(client, monkeypatch):
    login_trainer(client, monkeypatch)
    monkeypatch.setattr(id_reading, "tesseract_command", lambda: None)

    response = upload_id(client)

    assert response.status_code == 201, response.content
    body = response.json()
    # No reader on this machine: stored all the same, and the person types.
    assert body == {"stored": True, "reading": "unavailable", "read": {"number": "", "name": ""}}
    photo = TrainerIdPhoto.objects.get()
    assert photo.document_type == "ghana_card"
    assert client.get(reverse("trainer-session-me")).json()["has_id_document"] is True


@pytest.mark.django_db
def test_what_is_read_from_the_card_comes_back_and_is_kept_for_staff(client, monkeypatch):
    login_trainer(client, monkeypatch)
    monkeypatch.setattr(
        id_reading,
        "read_card",
        lambda upload, document_type: CardReading("read", CARD, "Kwame Ato Mensah"),
    )

    body = upload_id(client).json()

    assert body["reading"] == "read"
    assert body["read"] == {"number": CARD, "name": "Kwame Ato Mensah"}
    photo = TrainerIdPhoto.objects.get()
    assert (photo.read_number, photo.read_name) == (CARD, "Kwame Ato Mensah")


@pytest.mark.django_db
def test_a_new_photo_replaces_the_last(client, monkeypatch):
    login_trainer(client, monkeypatch)
    monkeypatch.setattr(id_reading, "tesseract_command", lambda: None)
    upload_id(client)
    upload_id(client, "passport")
    assert TrainerIdPhoto.objects.count() == 1
    assert TrainerIdPhoto.objects.get().document_type == "passport"


@pytest.mark.django_db
def test_the_photo_on_the_account_counts_for_sending_for_review(client, monkeypatch, catalogue):
    login_trainer(client, monkeypatch)
    monkeypatch.setattr(id_reading, "tesseract_command", lambda: None)
    upload_id(client)
    assert save_profile(client, catalogue).status_code == 200

    blockers = client.get(reverse("trainer-profile")).json()["blockers"]
    assert "Upload a photo of your ID." not in blockers


def test_without_the_reader_installed_nothing_is_read(monkeypatch):
    monkeypatch.setattr(id_reading, "tesseract_command", lambda: None)
    assert read_card(BytesIO(b"anything"), "ghana_card") == CardReading("unavailable")


def test_a_file_that_is_not_a_picture_is_unreadable(monkeypatch):
    monkeypatch.setattr(id_reading, "tesseract_command", lambda: "/usr/bin/tesseract")
    assert read_card(BytesIO(b"not a picture"), "ghana_card").status == "unreadable"


def test_the_text_the_reader_gives_is_made_sense_of(monkeypatch):
    monkeypatch.setattr(id_reading, "tesseract_command", lambda: "/usr/bin/tesseract")
    monkeypatch.setattr(id_reading, "_ocr", lambda command, image, mode: GHANA_CARD_TEXT)
    buffer = BytesIO()
    Image.new("RGB", (300, 200), "white").save(buffer, format="PNG")
    buffer.seek(0)

    reading = read_card(buffer, "ghana_card")

    assert reading == CardReading("read", CARD, "Kwame Ato Mensah")
    # Left at its start, so it can still be stored.
    assert buffer.tell() == 0


# --- Making sense of the text -----------------------------------------------

GHANA_CARD_TEXT = """REPUBLIC OF GHANA
ECOWAS IDENTITY CARD
Surname/Nom
MENSAH
Firstnames/Prénoms
KWAME ATO
Previous Names/Noms Précédents
Nationality/Nationalité Sex/Sexe Date of Birth/Date de Naissance
GHANAIAN M 01/01/1990
Personal ID Number/Numéro d'Identification Personnel
GHA-724019385-6
"""


def test_a_ghana_card_gives_its_number_and_name():
    assert parse_card_text(GHANA_CARD_TEXT, "ghana_card") == (CARD, "Kwame Ato Mensah")


@pytest.mark.parametrize(
    "as_read",
    ["GHA-72401938S-6", "6HA 724019385 6", "GHA—724O19385—6", "GHA 7240I9385 6"],
)
def test_the_readers_usual_slips_in_a_number_are_put_right(as_read):
    assert parse_card_text(f"Personal ID Number\n{as_read}\n", "ghana_card")[0] == CARD


def test_half_a_name_fills_nothing():
    assert parse_card_text("Surname/Nom\nMENSAH\n", "ghana_card")[1] == ""


def test_a_passport_is_read_from_its_machine_readable_lines():
    text = (
        "PASSPORT\n"
        "P<GHAMENSAH<<KWAME<ATO<<<<<<<<<<<<<<<<<<<<<<\n"
        "G1234567<8GHA9001014M3001012<<<<<<<<<<<<<<04\n"
    )
    assert parse_card_text(text, "passport") == ("G1234567", "Kwame Ato Mensah")


def test_a_passport_line_that_fails_its_check_digit_gives_no_number():
    text = "G1234567<3GHA9001014M3001012<<<<<<<<<<<<<<04\n"
    assert parse_card_text(text, "passport")[0] == ""


def test_a_voter_id_gives_its_ten_digits_and_name():
    text = "SURNAME\nMENSAH\nOTHER NAMES\nKWAME ATO\nVOTER ID NUMBER\n7240193856\n"
    assert parse_card_text(text, "voter_id") == ("7240193856", "Kwame Ato Mensah")


def test_the_name_issufu_is_a_name_not_a_label():
    text = "Surname/Nom\nISSUFU\nFirstnames/Prénoms\nABDUL\n"
    assert parse_card_text(text, "ghana_card")[1] == "Abdul Issufu"


@pytest.mark.parametrize(
    ("typed", "on_card", "expected"),
    [
        ("Kwame Mensah", "Kwame Ato Mensah", True),
        ("kwame ato mensah", "MENSAH KWAME ATO", True),
        # One letter out in a long name: the reader's slip.
        ("Kwame Mensah", "Kwame Ato Mensab", True),
        ("Ama Owusu", "Kwame Ato Mensah", False),
        # One name alone is not enough to say it is the same person.
        ("Kwame", "Kwame Ato Mensah", False),
        ("Kwame Mensah", "", None),
    ],
)
def test_the_typed_name_is_compared_with_the_card(typed, on_card, expected):
    assert names_match(typed, on_card) is expected


# --- The back office --------------------------------------------------------


def _account_with_photo(django_user_model, phone, *, name, number, read_name, read_number):
    from django.core.files.base import ContentFile

    account = TrainerAccount.objects.create(
        user=django_user_model.objects.create_user(username=f"t{phone[-4:]}"),
        phone=phone,
        full_name=name,
        id_document_type="ghana_card",
        id_document_number=number,
    )
    buffer = BytesIO()
    Image.new("RGB", (120, 80), "white").save(buffer, format="JPEG")
    photo = TrainerIdPhoto(
        account=account,
        document_type="ghana_card",
        reading="read",
        read_number=read_number,
        read_name=read_name,
    )
    photo.file.save("card.jpg", ContentFile(buffer.getvalue()), save=True)
    return account


@pytest.mark.django_db
def test_staff_see_the_photo_beside_what_was_typed_and_what_to_look_at(
    admin_client, django_user_model
):
    account = _account_with_photo(
        django_user_model,
        "+233241119999",
        name="Ama Owusu",
        number=CARD,
        read_name="Kwame Ato Mensah",
        read_number="GHA-724019385-7",
    )
    other = TrainerAccount.objects.create(
        user=django_user_model.objects.create_user(username="other"), phone=OTHER_PHONE
    )
    IdNumberClash.objects.create(
        account=other, other_account=account, document_type="ghana_card", number=CARD
    )

    page = admin_client.get(reverse("admin:providers_traineraccount_change", args=[account.pk]))

    html = page.content.decode()
    assert page.status_code == 200
    assert reverse("admin:providers_traineraccount_id_photo", args=[account.pk]) in html
    assert "Typed by them" in html and "Read from the card" in html
    assert "Kwame Ato Mensah" in html and "GHA-724019385-7" in html
    assert "tried to use this ID number" in html
    assert "The name typed is not the name read from the card." in html
    assert "The number typed is not the number read from the card." in html


@pytest.mark.django_db
def test_the_id_photo_is_served_to_staff_only(admin_client, client, django_user_model):
    account = _account_with_photo(
        django_user_model,
        "+233241118888",
        name="Kwame Mensah",
        number=CARD,
        read_name="Kwame Ato Mensah",
        read_number=CARD,
    )
    url = reverse("admin:providers_traineraccount_id_photo", args=[account.pk])

    shown = admin_client.get(url)
    assert shown.status_code == 200
    assert "no-store" in shown["Cache-Control"]

    # Signed out: sent to the admin's sign-in page, not given the picture.
    assert client.get(url).status_code == 302


@pytest.mark.django_db
def test_the_tried_twice_list_opens(admin_client, django_user_model):
    first = TrainerAccount.objects.create(
        user=django_user_model.objects.create_user(username="first"), phone="+233241117777"
    )
    second = TrainerAccount.objects.create(
        user=django_user_model.objects.create_user(username="second"), phone=OTHER_PHONE
    )
    IdNumberClash.objects.create(
        account=second, other_account=first, document_type="ghana_card", number=CARD
    )
    page = admin_client.get(reverse("admin:providers_idnumberclash_changelist"))
    assert page.status_code == 200
    assert CARD in page.content.decode()
