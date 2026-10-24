"""What a course really costs: the receipt on the listing, and where its figures come from."""

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
def csrf_client():
    return Client(enforce_csrf_checks=True)


def save(client, payload):
    return client.put(
        reverse("trainer-profile"),
        payload,
        content_type="application/json",
        **authenticated_csrf(client),
    )


def with_extras(catalogue, **extras):
    payload = profile_payload(catalogue)
    payload["programme"] = {**payload["programme"], **extras}
    return payload


@pytest.mark.django_db
def test_a_trainer_says_roughly_what_the_extras_cost(csrf_client, monkeypatch, catalogue):
    login_trainer(csrf_client, monkeypatch)

    response = save(
        csrf_client,
        with_extras(catalogue, extra_costs="300.00", extra_costs_note="Welding rods and gloves"),
    )

    assert response.status_code == 200, response.content
    programme = response.json()["profile"]["programme"]
    assert (programme["extra_costs"], programme["extra_costs_note"]) == (
        "300.00",
        "Welding rods and gloves",
    )


@pytest.mark.django_db
def test_extras_are_optional_and_never_negative(csrf_client, monkeypatch, catalogue):
    login_trainer(csrf_client, monkeypatch)

    assert save(csrf_client, profile_payload(catalogue)).status_code == 200
    assert Programme.objects.get().extra_costs is None
    assert save(csrf_client, with_extras(catalogue, extra_costs="-5")).status_code == 400


@pytest.mark.django_db
def test_the_listing_carries_everything_the_receipt_shows(
    csrf_client, monkeypatch, catalogue, client
):
    login_trainer(csrf_client, monkeypatch)
    save(
        csrf_client,
        with_extras(
            catalogue,
            fee_includes_tools=True,
            fee_includes_certificate=True,
            certificate_awarded="NVTI proficiency certificate",
            extra_costs="300",
            extra_costs_note="Rods",
        ),
    )
    provider = Provider.objects.get()
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.PUBLISHED)

    listing = client.get(
        reverse("provider-by-slug", args=[provider.area.slug, provider.slug])
    ).json()

    [course] = listing["programmes"]
    assert {
        key: course[key] for key in course if key.startswith(("fee_", "certificate", "extra"))
    } == {
        "fee_includes_tools": True,
        "fee_includes_materials": False,
        "fee_includes_ppe": False,
        "fee_includes_certificate": True,
        "certificate_awarded": "NVTI proficiency certificate",
        "extra_costs": "300.00",
        "extra_costs_note": "Rods",
    }
