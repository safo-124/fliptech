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
from marketplace.models import ChatReport, Conversation, Product, SellerAccount

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
def test_neither_side_shares_a_number_in_a_shop_chat(shop, buyer, texts):
    """A sale stays on the site, where Buy now holds the money (NumbersPrivate)."""
    them = signed_in(buyer.user)
    thread = them.post(
        reverse("account-chats"), {"seller": shop.pk, "body": "Hello"}, content_type=JSON
    ).json()
    assert thread["can_share_number"] is False

    mine = them.post(reverse("account-chat-share", args=[thread["id"]]))
    theirs = signed_in(shop.user).post(reverse("inbox-share", args=[thread["id"]]))
    for refused in (mine, theirs):
        assert refused.status_code == 409
        assert "Numbers stay private" in refused.json()["detail"]
    chat_ = Conversation.objects.get(pk=thread["id"])
    assert chat_.messages.filter(kind="phone").count() == 0
    assert (
        signed_in(shop.user).get(reverse("inbox")).json()["results"][0]["can_share_number"] is False
    )


@pytest.mark.django_db
def test_contact_details_typed_into_a_shop_chat_are_not_sent(shop, buyer, texts):
    """marketplace/contact_guard.py, applied by chat._guard_contact."""
    them = signed_in(buyer.user)
    # A first message with a number starts no chat at all.
    refused = them.post(
        reverse("account-chats"),
        {"seller": shop.pk, "body": "Call me on 024 123 4567"},
        content_type=JSON,
    )
    assert refused.status_code == 409
    assert "Contact details stay private" in refused.json()["detail"]
    assert not Conversation.objects.exists()

    thread = them.post(
        reverse("account-chats"), {"seller": shop.pk, "body": "Hello"}, content_type=JSON
    ).json()
    mine = reverse("account-chat", args=[thread["id"]])
    theirs = reverse("inbox-chat", args=[thread["id"]])
    seller = signed_in(shop.user)
    # A number split over two messages is still a number.
    assert them.post(mine, {"body": "my number 024 123"}, content_type=JSON).status_code == 201
    assert them.post(mine, {"body": "4567"}, content_type=JSON).status_code == 409
    # The shop cannot send a WhatsApp link either; prices and sizes go through.
    assert seller.post(theirs, {"body": "wa.me/233241234567"}, content_type=JSON).status_code == 409
    priced = seller.post(theirs, {"body": "GH₵250, sizes 38, 40, 42"}, content_type=JSON)
    assert priced.status_code == 201
    chat_ = Conversation.objects.get(pk=thread["id"])
    assert [m.body for m in chat_.messages.order_by("pk")] == [
        "Hello",
        "my number 024 123",
        "GH₵250, sizes 38, 40, 42",
    ]

    # The third try in a day puts the chat in front of staff, once.
    assert not ChatReport.objects.exists()
    them.post(mine, {"body": "ama at gmail dot com"}, content_type=JSON)
    them.post(mine, {"body": "0241234567"}, content_type=JSON)
    report = ChatReport.objects.get()
    assert (report.by, report.reason, report.conversation_id) == ("buyer", "other", chat_.pk)
    them.post(mine, {"body": "0241234567"}, content_type=JSON)
    assert ChatReport.objects.count() == 1


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


# --------------------------------------------------------------------------
# Blocking


@pytest.mark.django_db
def test_a_buyer_blocks_a_shop_and_nothing_more_is_sent_either_way(shop, buyer, texts):
    chat_ = Conversation.objects.create(seller=shop, buyer=buyer)
    them = signed_in(buyer.user)
    seller = signed_in(shop.user)
    block = reverse("account-chat-block", args=[chat_.pk])

    blocked = them.post(block)
    assert blocked.status_code == 200
    assert (blocked.json()["blocked_by_you"], blocked.json()["can_write"]) == (True, False)

    # The buyer is told how to write again; the shop only that it cannot.
    mine = them.post(reverse("account-chat", args=[chat_.pk]), {"body": "Hi"}, content_type=JSON)
    assert mine.status_code == 409
    assert "Unblock" in mine.json()["detail"]
    theirs = seller.post(reverse("inbox-chat", args=[chat_.pk]), {"body": "Hi"}, content_type=JSON)
    assert theirs.status_code == 409
    assert theirs.json()["detail"] == "You cannot contact them here."
    # The old address for app builds made before the inbox, a shared number,
    # and starting the chat again all stop too.
    old = seller.post(reverse("seller-chat", args=[chat_.pk]), {"body": "Hi"}, content_type=JSON)
    assert old.status_code == 409
    assert seller.post(reverse("inbox-share", args=[chat_.pk])).status_code == 409
    again = them.post(
        reverse("account-chats"), {"seller": shop.pk, "body": "Hi"}, content_type=JSON
    )
    assert again.status_code == 409
    assert chat_.messages.count() == 0
    assert texts == []

    # The shop's view of it: it cannot write, and is not told it was blocked.
    row = seller.get(reverse("inbox")).json()["results"][0]
    assert (row["blocked_by_you"], row["can_write"]) == (False, False)

    unblocked = them.delete(block)
    assert (unblocked.json()["blocked_by_you"], unblocked.json()["can_write"]) == (False, True)
    sent = them.post(reverse("account-chat", args=[chat_.pk]), {"body": "Hi"}, content_type=JSON)
    assert sent.status_code == 201


@pytest.mark.django_db
def test_only_the_side_that_blocked_can_unblock(shop, buyer, texts):
    chat_ = Conversation.objects.create(seller=shop, buyer=buyer)
    them = signed_in(buyer.user)
    seller = signed_in(shop.user)

    assert seller.post(reverse("inbox-block", args=[chat_.pk])).json()["blocked_by_you"] is True
    # The buyer's unblock lifts only a block of their own: there is none.
    lifted = them.delete(reverse("account-chat-block", args=[chat_.pk]))
    assert (lifted.json()["blocked_by_you"], lifted.json()["can_write"]) == (False, False)
    refused = them.post(reverse("account-chat", args=[chat_.pk]), {"body": "Hi"}, content_type=JSON)
    assert refused.status_code == 409

    seller.delete(reverse("inbox-block", args=[chat_.pk]))
    sent = them.post(reverse("account-chat", args=[chat_.pk]), {"body": "Hi"}, content_type=JSON)
    assert sent.status_code == 201


@pytest.mark.django_db
def test_nobody_blocks_in_someone_elses_chat(shop, buyer, django_user_model, texts):
    chat_ = Conversation.objects.create(seller=shop, buyer=buyer)
    stranger = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("buyer-esi"),
        phone="+233201113333",
        phone_verified_at=timezone.now(),
    )
    as_stranger = signed_in(stranger.user)
    assert as_stranger.post(reverse("account-chat-block", args=[chat_.pk])).status_code == 404
    assert Client().post(reverse("account-chat-block", args=[chat_.pk])).status_code == 403
    chat_.refresh_from_db()
    assert chat_.person_blocked_at is None
