"""An "Other (describe)" trade, and the basic checks on names and landmarks."""

import pytest
from django.urls import reverse

from catalog.models import OTHER_TRADE_SLUG, Programme, other_trade
from core.placeholders import is_short_name, landmark_problem, name_problem
from marketplace.models import Product
from marketplace.tests.test_api import area, ready_seller, sent  # noqa: F401
from providers.tests.test_trainer_api import (  # noqa: F401
    authenticated_csrf,
    catalogue,
    csrf_client,
    login_trainer,
    profile_payload,
)

JSON = "application/json"


def put_profile(client, payload):
    return client.put(
        reverse("trainer-profile"), payload, content_type=JSON, **authenticated_csrf(client)
    )


def test_the_other_trade_is_not_listed(client, db):
    other_trade()
    slugs = [trade["slug"] for trade in client.get("/api/trades/").json()["results"]]
    assert OTHER_TRADE_SLUG not in slugs


def test_a_trainer_can_name_a_trade_that_is_not_listed(csrf_client, monkeypatch, catalogue):  # noqa: F811
    login_trainer(csrf_client, monkeypatch)
    payload = profile_payload(catalogue)
    payload["programme"] = {
        **payload["programme"],
        "trade_id": None,
        "trade_other": "  Shoe   making ",
    }

    response = put_profile(csrf_client, payload)

    assert response.status_code == 200, response.content
    programme = Programme.objects.get()
    assert programme.trade.slug == OTHER_TRADE_SLUG
    assert programme.trade_other == "Shoe making"
    assert response.json()["profile"]["programme"]["trade_other"] == "Shoe making"


def test_other_needs_words_and_a_listed_trade_drops_them(csrf_client, monkeypatch, catalogue):  # noqa: F811
    login_trainer(csrf_client, monkeypatch)
    payload = profile_payload(catalogue)
    payload["programme"] = {**payload["programme"], "trade_id": None, "trade_other": "x"}
    refused = put_profile(csrf_client, payload)
    assert refused.status_code == 400
    assert "trade_other" in str(refused.json())

    payload["programme"] = {
        **payload["programme"],
        "trade_id": catalogue["trade"].pk,
        "trade_other": "Shoe making",
    }
    assert put_profile(csrf_client, payload).status_code == 200
    assert Programme.objects.get().trade_other == ""


@pytest.mark.django_db
def test_a_seller_can_name_a_trade_that_is_not_listed(client, area, sent):  # noqa: F811
    ready_seller(client, area, sent)

    response = client.post(
        reverse("seller-products"),
        {"name": "Leather sandals", "trade": None, "trade_other": "Shoe making"},
        content_type=JSON,
    )

    assert response.status_code == 201, response.content
    product = Product.objects.get()
    assert (product.trade, product.trade_other) == (None, "Shoe making")
    assert "trade" not in response.json()["tips"]


def test_workshop_and_trainer_names_and_the_landmark_are_checked(
    csrf_client,  # noqa: F811
    monkeypatch,
    catalogue,  # noqa: F811
):
    login_trainer(csrf_client, monkeypatch)

    response = put_profile(
        csrf_client,
        profile_payload(catalogue, name="Yes", full_name="Jo", landmark="Mall"),
    )

    assert response.status_code == 400
    errors = response.json()
    assert {"name", "full_name", "landmark"} <= set(errors.get("errors", errors))


def test_the_name_rules():
    assert name_problem("Jo")
    assert name_problem("yes")
    assert name_problem("No")
    assert name_problem("aaaa")
    assert name_problem("Gym") is None
    assert name_problem("Safo Welding Academy") is None
    assert name_problem("") is None
    assert is_short_name("Gym") and not is_short_name("Safo Welding")
    assert landmark_problem("Mall")
    assert landmark_problem("Opposite Madina Mall") is None


@pytest.mark.django_db
def test_an_account_name_is_checked(client, area, sent):  # noqa: F811
    ready_seller(client, area, sent)

    response = client.patch(reverse("account"), {"display_name": "ok"}, content_type=JSON)

    assert response.status_code == 400
    assert "display_name" in response.json()
