"""Chat with the seller: buyer and shop threads, unread counts, texts."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from accounts.models import CustomerAccount
from geography.models import Area, Region
from marketplace import chat
from marketplace.models import Conversation, Product, SellerAccount

JSON = "application/json"


@pytest.fixture
def texts(monkeypatch, settings):
    settings.PUBLIC_SITE_URL = "https://skills.example"
    sent = []
    monkeypatch.setattr(chat, "send_sms", lambda to, message: sent.append((str(to), message)))
    return sent


@pytest.fixture
def shop(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(
        region=region, name="Adenta", slug="adenta", centroid=Point(-0.18, 5.6, srid=4326)
    )
    return SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-ama"),
        phone="+233201110800",
        phone_verified_at=timezone.now(),
        business_name="Ama Tailoring",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )


@pytest.fixture
def buyer(db, django_user_model):
    return CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("buyer-kofi"),
        phone="+233201112222",
        phone_verified_at=timezone.now(),
        display_name="Kofi",
    )


def signed_in(user):
    client = Client()
    client.force_login(user)
    return client


@pytest.mark.django_db(transaction=True)
def test_a_buyer_and_a_shop_chat_without_sharing_numbers(shop, buyer, texts):
    kit = Product.objects.create(
        seller=shop,
        name="Tailoring kit",
        slug="tailoring-kit",
        price="200.00",
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=1),
    )
    them = signed_in(buyer.user)
    started = them.post(
        reverse("account-chats"),
        {"seller": shop.pk, "product": kit.pk, "body": "Is it still available?"},
        content_type=JSON,
    )
    assert started.status_code == 201
    thread = started.json()
    assert thread["with"]["name"] == "Ama Tailoring"
    assert thread["messages"][0]["product"]["name"] == "Tailoring kit"
    assert "201110800" not in str(thread)
    # The shop is texted once, with a link, not the buyer's number.
    assert len(texts) == 1
    assert texts[0][0] == "+233201110800"
    assert "Kofi asked about Tailoring kit" in texts[0][1]
    assert "201112222" not in texts[0][1]

    # A second message soon after is not another text.
    them.post(
        reverse("account-chat", args=[thread["id"]]),
        {"body": "Can I collect today?"},
        content_type=JSON,
    )
    assert len(texts) == 1

    seller = signed_in(shop.user)
    inbox = seller.get(reverse("seller-chats")).json()["results"]
    assert inbox[0]["unread"] == 2
    assert inbox[0]["with"]["name"] == "Kofi"
    opened = seller.get(reverse("seller-chat", args=[thread["id"]])).json()
    assert [m["body"] for m in opened["messages"]] == [
        "Is it still available?",
        "Can I collect today?",
    ]
    assert seller.get(reverse("seller-chats")).json()["results"][0]["unread"] == 0

    seller.post(
        reverse("seller-chat", args=[thread["id"]]), {"body": "Yes, come at 4."}, content_type=JSON
    )
    assert texts[-1][0] == "+233201112222"
    assert f"/account/chats/{thread['id']}" in texts[-1][1]
    assert them.get(reverse("account-chats")).json()["results"][0]["unread"] == 1


@pytest.mark.django_db
def test_nobody_reads_someone_elses_chat(shop, buyer, django_user_model, texts):
    chat_ = Conversation.objects.create(seller=shop, buyer=buyer)
    stranger = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("buyer-esi"),
        phone="+233201113333",
        phone_verified_at=timezone.now(),
    )
    assert signed_in(stranger.user).get(reverse("account-chat", args=[chat_.pk])).status_code == 404
    other_shop = SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-yaw"),
        phone="+233201110801",
        phone_verified_at=timezone.now(),
        business_name="Yaw Beads",
        area=shop.area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    assert (
        signed_in(other_shop.user).get(reverse("seller-chat", args=[chat_.pk])).status_code == 404
    )


@pytest.mark.django_db
def test_empty_or_long_messages_are_refused(shop, buyer, texts):
    them = signed_in(buyer.user)
    assert (
        them.post(
            reverse("account-chats"), {"seller": shop.pk, "body": "  "}, content_type=JSON
        ).status_code
        == 400
    )
    assert (
        them.post(
            reverse("account-chats"), {"seller": shop.pk, "body": "x" * 1001}, content_type=JSON
        ).status_code
        == 400
    )
    assert (
        them.post(
            reverse("account-chats"), {"seller": 999, "body": "Hi"}, content_type=JSON
        ).status_code
        == 404
    )
