"""The eight pictures at the top of the marketplace: each finds its things."""

import pytest
from django.urls import reverse

from catalog.models import Trade, TradeCategory
from marketplace.kinds import KINDS
from marketplace.models import Product
from marketplace.tests.test_api import area, ready_seller, sent  # noqa: F401


def names(client, kind):
    body = client.get(reverse("product-list"), {"kind": kind}).json()
    return sorted(p["name"] for p in body["results"])


def put_up(seller, name, trade=None):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        trade=trade,
        status=Product.Status.PUBLISHED,
    )


@pytest.mark.django_db
def test_a_kind_matches_whole_words_in_the_name(client, area, sent):  # noqa: F811
    seller = ready_seller(client, area, sent)
    for name in ["Bone straight wig", "Hair oil", "Mahogany chair", "Kente bag", "Shea soap"]:
        put_up(seller, name)

    assert names(client, "hair-beauty") == ["Bone straight wig", "Hair oil"]
    # "chair" holds "hair" but is not hair.
    assert names(client, "furniture") == ["Mahogany chair"]
    assert names(client, "bags-shoes") == ["Kente bag"]
    assert names(client, "soap-oils") == ["Hair oil", "Shea soap"]


@pytest.mark.django_db
def test_a_kind_also_matches_its_trades_and_categories(client, area, sent):  # noqa: F811
    seller = ready_seller(client, area, sent)
    food = TradeCategory.objects.create(name="Hospitality", slug="hospitality-culinary")
    catering = Trade.objects.create(name="Catering", slug="catering", category=food)
    hair = Trade.objects.create(name="Hairdressing", slug="hairdressing")
    put_up(seller, "Jollof for 20", trade=catering)
    put_up(seller, "Styling session", trade=hair)

    assert names(client, "food") == ["Jollof for 20"]
    assert names(client, "hair-beauty") == ["Styling session"]


@pytest.mark.django_db
def test_an_unknown_kind_is_ignored(client, area, sent):  # noqa: F811
    seller = ready_seller(client, area, sent)
    put_up(seller, "Kente bag")

    assert names(client, "spaceships") == ["Kente bag"]


def test_there_are_eight_kinds():
    assert len(KINDS) == 8
