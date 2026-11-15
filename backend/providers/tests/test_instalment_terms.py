"""Instalments as two numbers a trainee can plan with, and a note for the rest.

A free-text "Instalment arrangement" went live as "30": thirty what? The form
now asks how many payments and how much comes first, and the note is optional.
"""

import pytest
from django.test import Client
from django.urls import reverse

from catalog.models import Programme, Trade
from geography.models import Area, Region
from providers.models import Provider
from providers.tests.test_trainer_api import (
    ACCRA,
    authenticated_csrf,
    login_trainer,
    profile_payload,
)


@pytest.fixture
def catalogue(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    return {"area": area, "trade": Trade.objects.create(name="Welding", slug="welding")}


@pytest.fixture
def owner(monkeypatch):
    client = Client(enforce_csrf_checks=True)
    login_trainer(client, monkeypatch)
    return client


def save(client, catalogue, **terms):
    payload = profile_payload(catalogue)
    payload["programme"].update(terms)
    return client.put(
        reverse("trainer-profile"),
        payload,
        content_type="application/json",
        **authenticated_csrf(client),
    )


@pytest.mark.django_db
def test_the_number_of_payments_and_the_deposit_are_kept(owner, catalogue):
    response = save(
        owner,
        catalogue,
        instalment_count=3,
        instalment_deposit_percent=30,
        instalment_note="The rest monthly",
    )

    assert response.status_code == 200, response.content
    programme = Programme.objects.get()
    assert (programme.instalment_count, programme.instalment_deposit_percent) == (3, 30)
    assert programme.instalment_note == "The rest monthly"


@pytest.mark.django_db
def test_instalments_need_a_number_of_payments(owner, catalogue):
    response = save(owner, catalogue, instalment_count=None)

    assert response.status_code == 400
    assert "instalment_count" in response.content.decode()


@pytest.mark.django_db
def test_the_note_is_optional_but_not_a_bare_number(owner, catalogue):
    assert save(owner, catalogue, instalment_note="").status_code == 200
    assert save(owner, catalogue, instalment_note="30").status_code == 400


@pytest.mark.django_db
def test_no_deposit_is_stored_as_none_so_a_listing_never_says_zero_first(owner, catalogue):
    save(owner, catalogue, instalment_deposit_percent=0)

    assert Programme.objects.get().instalment_deposit_percent is None


@pytest.mark.django_db
def test_turning_instalments_off_clears_the_terms(owner, catalogue):
    save(owner, catalogue)
    save(owner, catalogue, instalments_allowed=False)

    programme = Programme.objects.get()
    assert programme.instalment_count is None
    assert programme.instalment_deposit_percent is None
    assert programme.instalment_note == ""


@pytest.mark.django_db
@pytest.mark.parametrize("terms", [{"instalment_count": 1}, {"instalment_deposit_percent": 95}])
def test_impossible_terms_are_refused(owner, catalogue, terms):
    assert save(owner, catalogue, **terms).status_code == 400


@pytest.mark.django_db
def test_the_listing_shows_the_terms(owner, catalogue, client):
    save(owner, catalogue, instalment_count=4, instalment_deposit_percent=25)
    provider = Provider.objects.get()
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.PUBLISHED)

    programme = client.get(
        reverse("provider-by-slug", args=[provider.area.slug, provider.slug])
    ).json()["programmes"][0]

    assert programme["instalment_count"] == 4
    assert programme["instalment_deposit_percent"] == 25
