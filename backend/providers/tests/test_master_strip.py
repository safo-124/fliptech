"""The master who teaches: what the trainer says, and the strip on the listing."""

import pytest
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from catalog.models import Trade
from geography.models import Area, Region
from providers.models import Provider, ProviderPhoto
from providers.tests.test_trainer_api import (
    ACCRA,
    authenticated_csrf,
    jpeg_upload,
    login_trainer,
    profile_payload,
)


@pytest.fixture
def catalogue(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    return {"area": area, "trade": Trade.objects.create(name="Welding", slug="welding")}


@pytest.fixture
def owner(monkeypatch, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    client = Client(enforce_csrf_checks=True)
    login_trainer(client, monkeypatch)
    return client


def save(client, catalogue, **master):
    return client.put(
        reverse("trainer-profile"),
        profile_payload(catalogue, **master),
        content_type="application/json",
        **authenticated_csrf(client),
    )


def listing(client):
    provider = Provider.objects.get()
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.PUBLISHED)
    return client.get(reverse("provider-by-slug", args=[provider.area.slug, provider.slug])).json()


@pytest.mark.django_db
def test_the_listing_shows_the_master_with_years_worked_out_from_the_year(owner, catalogue, client):
    year = timezone.localdate().year
    response = save(
        owner,
        catalogue,
        lead_trainer_name="Madam Akosua",
        in_trade_since=year - 12,
        apprentices_trained=40,
        teaching_languages=["ee", "tw", "en", "tw"],
    )
    assert response.status_code == 200, response.content
    owner.post(
        reverse("trainer-photo-upload"),
        {"image": jpeg_upload("akosua.jpg"), "kind": "portrait"},
        **authenticated_csrf(owner),
    )

    master = listing(client)["master"]

    assert master | {"portrait": None} == {
        "name": "Madam Akosua",
        "portrait": None,
        "years_in_trade": 12,
        "apprentices_trained": 40,
        # Once each, in the order the form offers them.
        "languages": ["en", "tw", "ee"],
    }
    assert master["portrait"].endswith(".jpg")


@pytest.mark.django_db
def test_a_listing_without_a_master_says_nothing_about_one(owner, catalogue, client):
    save(owner, catalogue)

    assert listing(client)["master"] is None


@pytest.mark.django_db
@pytest.mark.parametrize(
    "master",
    [
        {"in_trade_since": timezone.localdate().year + 1},
        {"teaching_languages": ["klingon"]},
        {"apprentices_trained": -1},
    ],
)
def test_impossible_answers_are_refused(owner, catalogue, master):
    assert save(owner, catalogue, **master).status_code == 400


@pytest.mark.django_db
def test_a_new_portrait_replaces_the_last(owner, catalogue):
    save(owner, catalogue)
    for name in ("first.jpg", "second.jpg"):
        owner.post(
            reverse("trainer-photo-upload"),
            {"image": jpeg_upload(name), "kind": "portrait"},
            **authenticated_csrf(owner),
        )

    assert ProviderPhoto.objects.filter(kind=ProviderPhoto.Kind.PORTRAIT).count() == 1
