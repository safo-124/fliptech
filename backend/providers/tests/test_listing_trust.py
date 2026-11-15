"""A workshop's pin is in Ghana, and its photos are public only once approved."""

import pytest
from django.contrib.gis.geos import Point
from django.core.exceptions import ValidationError
from django.test import Client
from django.urls import reverse

from geography.bounds import inside_ghana, location_problem
from providers.models import Provider, ProviderPhoto
from providers.tests.test_master_strip import catalogue, owner, save  # noqa: F401
from providers.tests.test_trainer_api import authenticated_csrf, jpeg_upload

# Vaajakatu 5, Helsinki: where the "Accra Central" listing's pin really was.
FINLAND = {"latitude": 60.1829, "longitude": 24.9330}
# Kumasi: in Ghana, but nowhere near Accra.
KUMASI = {"latitude": 6.6885, "longitude": -1.6244}


def test_the_ghana_box():
    assert inside_ghana(5.6037, -0.1870)  # Accra
    assert inside_ghana(9.4034, -0.8424)  # Tamale
    assert not inside_ghana(60.1829, 24.9330)  # Helsinki
    assert not inside_ghana(6.5244, 3.3792)  # Lagos


@pytest.mark.django_db
def test_the_trainer_cannot_save_a_pin_outside_ghana(owner, catalogue):  # noqa: F811
    response = save(owner, catalogue, **FINLAND)

    assert response.status_code == 400
    assert "outside Ghana" in str(response.json())
    assert not Provider.objects.exists()


@pytest.mark.django_db
def test_the_trainer_cannot_save_a_pin_far_from_the_area(owner, catalogue):  # noqa: F811
    response = save(owner, catalogue, **KUMASI)

    assert response.status_code == 400
    assert "km from Accra" in str(response.json())


@pytest.mark.django_db
def test_the_back_office_refuses_a_pin_outside_ghana(owner, catalogue):  # noqa: F811
    assert save(owner, catalogue).status_code == 200
    provider = Provider.objects.get()
    provider.location = Point(FINLAND["longitude"], FINLAND["latitude"], srid=4326)

    with pytest.raises(ValidationError) as caught:
        provider.full_clean()

    assert "location" in caught.value.message_dict
    assert location_problem(provider.location, provider.area)


def publish_with_photo(owner, kind="workshop"):  # noqa: F811
    owner.post(
        reverse("trainer-photo-upload"),
        {"image": jpeg_upload("flyer.jpg"), "kind": kind},
        **authenticated_csrf(owner),
    )
    provider = Provider.objects.get()
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.PUBLISHED)
    return provider


def public_listing(provider):
    return (
        Client().get(reverse("provider-by-slug", args=[provider.area.slug, provider.slug])).json()
    )


def public_card(provider):
    results = Client().get(reverse("provider-list")).json()["results"]
    return next(card for card in results if card["id"] == provider.pk)


@pytest.mark.django_db
def test_a_trainers_photo_stays_off_public_pages_until_staff_approve_it(owner, catalogue):  # noqa: F811
    assert save(owner, catalogue).status_code == 200
    provider = publish_with_photo(owner)
    photo = ProviderPhoto.objects.get()
    assert photo.approved_at is None

    assert public_card(provider)["primary_photo"] is None
    assert public_listing(provider)["photos"] == []

    photo.approve()
    photo.save()

    assert public_card(provider)["primary_photo"]
    assert len(public_listing(provider)["photos"]) == 1


@pytest.mark.django_db
def test_staff_can_hide_a_photo_again(owner, catalogue, admin_client):  # noqa: F811
    assert save(owner, catalogue).status_code == 200
    provider = publish_with_photo(owner)
    photo = ProviderPhoto.objects.get()
    photo.approve()
    photo.save()

    admin_client.post(
        reverse("admin:providers_providerphoto_changelist"),
        {"action": "hide_photos", "_selected_action": [photo.pk]},
    )

    photo.refresh_from_db()
    assert photo.approved_at is None
    assert public_card(provider)["primary_photo"] is None


@pytest.mark.django_db
def test_the_review_list_names_the_ticks_still_to_give_on_their_own(owner, catalogue):  # noqa: F811
    response = save(owner, catalogue, site_visit_consent=False, data_consent=False)
    assert response.status_code == 200, response.content

    body = owner.get(reverse("trainer-profile")).json()

    # The full list still has them, for anything that only reads that.
    assert any("site visit" in item for item in body["blockers"])
    # The review step's two lists: the ticks apart, so each goes when ticked.
    assert body["declarations_needed"] == ["site_visit_consent", "data_consent"]
    assert not any("site visit" in item for item in body["blockers_without_declarations"])
