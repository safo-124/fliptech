"""Before-and-after work photos, the photo of the way in, and the public directions."""

import pytest
from django.core.exceptions import ValidationError
from django.test import Client
from django.urls import reverse

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
def owner(monkeypatch, catalogue, settings, tmp_path):
    """A signed-in trainer with a saved draft listing."""
    settings.MEDIA_ROOT = tmp_path
    client = Client(enforce_csrf_checks=True)
    login_trainer(client, monkeypatch)
    payload = profile_payload(catalogue, directions="Opposite the lorry station, blue gate")
    client.put(
        reverse("trainer-profile"),
        payload,
        content_type="application/json",
        **authenticated_csrf(client),
    )
    return client


def upload(client, kind, **extra):
    return client.post(
        reverse("trainer-photo-upload"),
        {"image": jpeg_upload(f"{kind}.jpg"), "kind": kind, **extra},
        **authenticated_csrf(client),
    )


@pytest.mark.django_db
def test_a_before_photo_pairs_with_one_photo_of_the_finished_work(owner):
    work = upload(owner, "work").json()

    first = upload(owner, "before", before_of=work["id"])
    second = upload(owner, "before", before_of=work["id"])
    unpaired = upload(owner, "before")

    assert first.status_code == 201
    assert first.json()["before_of"] == work["id"]
    assert second.status_code == 400
    assert unpaired.status_code == 400


@pytest.mark.django_db
def test_a_before_cannot_pair_with_another_workshops_photo(owner, catalogue):
    other = Provider.objects.create(
        name="Elsewhere",
        slug="elsewhere",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone="+233240000801",
    )
    theirs = ProviderPhoto.objects.create(provider=other, kind=ProviderPhoto.Kind.WORK)

    assert upload(owner, "before", before_of=theirs.pk).status_code == 400


@pytest.mark.django_db
def test_a_new_photo_of_the_way_in_replaces_the_last(owner):
    upload(owner, "entrance")
    upload(owner, "entrance")

    assert ProviderPhoto.objects.filter(kind=ProviderPhoto.Kind.ENTRANCE).count() == 1


@pytest.mark.django_db
def test_the_listing_shows_pairs_the_way_in_and_directions_but_never_the_landmark(owner, client):
    workshop = upload(owner, "workshop").json()
    work = upload(owner, "work").json()
    upload(owner, "before", before_of=work["id"])
    upload(owner, "entrance")
    provider = Provider.objects.get()
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.PUBLISHED)

    listing = client.get(
        reverse("provider-by-slug", args=[provider.area.slug, provider.slug])
    ).json()

    assert [photo["id"] for photo in listing["photos"]] == [workshop["id"], work["id"]]
    by_id = {photo["id"]: photo for photo in listing["photos"]}
    assert by_id[work["id"]]["before"].endswith(".jpg")
    assert by_id[workshop["id"]]["before"] is None
    assert listing["entrance_photo"].endswith(".jpg")
    assert listing["directions"] == "Opposite the lorry station, blue gate"
    assert "landmark" not in listing
    assert "Behind the community market" not in str(listing)


@pytest.mark.django_db
def test_a_card_never_uses_the_way_in_or_a_before_as_its_picture(owner, client):
    upload(owner, "entrance")
    Provider.objects.update(status=Provider.Status.PUBLISHED)

    [card] = client.get(reverse("provider-list")).json()["results"]

    assert card["primary_photo"] is None


@pytest.mark.django_db
def test_only_a_before_is_ever_paired(catalogue):
    provider = Provider.objects.create(
        name="Pairs",
        slug="pairs",
        area=catalogue["area"],
        location=ACCRA,
        contact_phone="+233240000802",
    )
    work = ProviderPhoto.objects.create(provider=provider, kind=ProviderPhoto.Kind.WORK)
    workshop = ProviderPhoto.objects.create(provider=provider, kind=ProviderPhoto.Kind.WORKSHOP)

    with pytest.raises(ValidationError):
        ProviderPhoto(provider=provider, kind="workshop", shows_before_of=work).clean()
    with pytest.raises(ValidationError):
        ProviderPhoto(provider=provider, kind="before", shows_before_of=workshop).clean()
    ProviderPhoto(provider=provider, kind="before", shows_before_of=work).clean()
