"""Chat between trainees and workshops, and the one inbox for businesses.

An enquiry opens a chat, the workshop is told at once, its reply marks the
enquiry replied, and nobody's number crosses until its owner shares it. Staff
chase an enquiry only after a day without a reply, or at once when nobody
holds the workshop.
"""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from accounts.models import CustomerAccount
from catalog.models import Intake, Programme, Trade
from enquiries import otp
from enquiries.models import Enquiry
from geography.models import Area, Region
from marketplace import chat
from marketplace.models import (
    ChatReport,
    Conversation,
    Message,
    Product,
    ProductEnquiry,
    SellerAccount,
)
from providers import owner_messages
from providers.dashboard import enquiry_payload
from providers.models import OwnerNotice, Provider, ProviderMembership, TrainerAccount

JSON = "application/json"
ACCRA = Point(-0.1870, 5.6037, srid=4326)
TRAINEE = "+233241112222"
TRAINER = "+233240000001"


@pytest.fixture
def texts(monkeypatch, settings):
    settings.PUBLIC_SITE_URL = "https://skills.example"
    sent = []
    monkeypatch.setattr(chat, "send_sms", lambda to, message: sent.append((str(to), message)))
    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    return sent


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


def workshop(area, name="Accra Welding Works", slug="accra-welding-works"):
    provider = Provider.objects.create(
        name=name,
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233240000000",
        status=Provider.Status.PUBLISHED,
    )
    trade, _ = Trade.objects.get_or_create(name="Welding", slug="welding")
    course = Programme.objects.create(
        provider=provider, trade=trade, title="Arc welding", fee=1200, duration_weeks=12
    )
    Intake.objects.create(programme=course, start_date=date.today() + timedelta(days=30))
    return provider, course


def trainer_of(provider, django_user_model, phone=TRAINER, username="trainer-kwame"):
    trainer = TrainerAccount.objects.create(
        user=django_user_model.objects.create_user(username),
        phone=phone,
        phone_verified_at=timezone.now(),
        approval_status=TrainerAccount.Approval.CONFIRMED,
    )
    ProviderMembership.objects.create(trainer=trainer, provider=provider)
    return trainer


def signed_in(user):
    client = Client()
    client.force_login(user)
    return client


def enquire(client, course, **extra):
    """The website's flow: a code to the phone, then the enquiry."""
    otp.request_code(TRAINEE)
    client.post("/api/enquiries/verify-code/", {"phone": TRAINEE, "code": "123456"})
    return client.post(
        "/api/enquiries/",
        {"phone": TRAINEE, "programme_id": course.pk, **extra},
    ).json()


@pytest.mark.django_db(transaction=True)
def test_an_enquiry_opens_a_chat_the_workshop_answers(client, area, django_user_model, texts):
    provider, course = workshop(area)
    trainer = trainer_of(provider, django_user_model)

    made = enquire(client, course, trainee_name="Abena", message="Do you take beginners?")
    assert made["conversation_id"]
    assert made["whatsapp_url"] is None
    # The workshop is told at once, with a link, never the trainee's number.
    assert texts[-1][0] == TRAINER
    assert "Abena asked about Arc welding" in texts[-1][1]
    assert f"/inbox/{made['conversation_id']}" in texts[-1][1]
    assert "241112222" not in texts[-1][1]

    inbox_client = signed_in(trainer.user)
    inbox = inbox_client.get(reverse("inbox")).json()["results"]
    assert [row["kind"] for row in inbox] == ["workshop"]
    assert inbox[0]["unread"] == 1
    assert inbox[0]["with"]["name"] == "Abena"
    assert "241112222" not in str(inbox)
    thread = inbox_client.get(reverse("inbox-chat", args=[made["conversation_id"]])).json()
    first = thread["messages"][0]
    assert (first["kind"], first["body"]) == ("enquiry", "Do you take beginners?")
    assert first["course"]["title"] == "Arc welding"
    assert first["course"]["reference"] == made["reference_code"]

    inbox_client.post(
        reverse("inbox-chat", args=[made["conversation_id"]]),
        {"body": "Yes. Come on Monday."},
        content_type=JSON,
    )
    outcome = Enquiry.objects.get().outcome
    assert outcome.replied and outcome.replied_at
    assert texts[-1][0] == TRAINEE
    assert f"/account/chats/{made['conversation_id']}" in texts[-1][1]

    # The trainee reads the reply in their own messages.
    mine = client.get(reverse("account-chats")).json()["results"]
    assert mine[0]["with"]["name"] == "Accra Welding Works"
    assert mine[0]["business"]["path"] == "/accra/accra-welding-works"
    assert mine[0]["unread"] == 1


@pytest.mark.django_db
def test_a_signed_in_person_can_message_a_workshop_directly(area, django_user_model, texts):
    provider, _course = workshop(area)
    trainer_of(provider, django_user_model)
    person = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("person-esi"),
        phone="+233201113333",
        phone_verified_at=timezone.now(),
    )
    started = signed_in(person.user).post(
        reverse("account-chats"), {"workshop": provider.pk, "body": "Hello"}, content_type=JSON
    )
    assert started.status_code == 201
    assert started.json()["kind"] == "workshop"


@pytest.mark.django_db
def test_only_the_workshops_own_trainer_and_its_person_read_a_chat(area, django_user_model, texts):
    provider, _course = workshop(area)
    trainer_of(provider, django_user_model)
    person = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("person-esi"),
        phone="+233201113333",
        phone_verified_at=timezone.now(),
    )
    conversation = Conversation.objects.create(provider=provider, buyer=person)

    other, _ = workshop(area, name="Tema Welding", slug="tema-welding")
    other_trainer = trainer_of(other, django_user_model, phone="+233240000002", username="t2")
    reader = signed_in(other_trainer.user)
    assert reader.get(reverse("inbox-chat", args=[conversation.pk])).status_code == 404
    assert reader.get(reverse("inbox")).json()["results"] == []

    stranger = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("person-yaw"),
        phone="+233201114444",
        phone_verified_at=timezone.now(),
    )
    as_stranger = signed_in(stranger.user)
    assert as_stranger.get(reverse("account-chat", args=[conversation.pk])).status_code == 404
    # Somebody with no shop or workshop has no inbox at all.
    assert as_stranger.get(reverse("inbox")).status_code == 403


@pytest.mark.django_db
def test_each_side_shares_only_its_own_number(area, django_user_model, texts):
    provider, _course = workshop(area)
    trainer = trainer_of(provider, django_user_model)
    person = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("person-esi"),
        phone="+233201113333",
        phone_verified_at=timezone.now(),
    )
    conversation = Conversation.objects.create(provider=provider, buyer=person)

    signed_in(person.user).post(reverse("account-chat-share", args=[conversation.pk]))
    signed_in(trainer.user).post(reverse("inbox-share", args=[conversation.pk]))

    shared = list(conversation.messages.filter(kind=Message.Kind.PHONE).order_by("pk"))
    assert [(m.sender, m.body) for m in shared] == [
        (Message.Sender.BUYER, "+233201113333"),
        (Message.Sender.SELLER, TRAINER),
    ]


@pytest.mark.django_db(transaction=True)
def test_staff_chase_an_unanswered_enquiry_after_a_day(client, area, django_user_model, texts):
    provider, course = workshop(area)
    trainer = trainer_of(provider, django_user_model)
    made = enquire(client, course)
    notice = OwnerNotice.objects.get()

    assert not owner_messages.enquiry_alerts_waiting().exists()
    later = timezone.now() + timedelta(hours=25)
    assert list(owner_messages.enquiry_alerts_waiting(later)) == [notice]
    # The follow-up sends the owner to sign in, with no number to call.
    message = owner_messages.enquiry_message(notice.enquiry)
    assert "241112222" not in message
    assert "/inbox" in message

    signed_in(trainer.user).post(
        reverse("inbox-chat", args=[made["conversation_id"]]),
        {"body": "Yes."},
        content_type=JSON,
    )
    assert not owner_messages.enquiry_alerts_waiting(later).exists()


@pytest.mark.django_db(transaction=True)
def test_a_workshop_nobody_holds_goes_to_staff_at_once(client, area, texts):
    _provider, course = workshop(area)
    enquire(client, course)
    # Nobody to tell in the chat, so no text, and staff see it straight away.
    assert texts == []
    assert owner_messages.enquiry_alerts_waiting().count() == 1


@pytest.mark.django_db(transaction=True)
def test_the_workshop_dashboard_hides_a_chat_enquirers_number(
    client, area, django_user_model, texts
):
    provider, course = workshop(area)
    trainer_of(provider, django_user_model)
    made = enquire(client, course)
    [row] = enquiry_payload(provider)
    assert row["trainee_phone"] is None
    assert row["whatsapp_url"] is None
    assert row["conversation_id"] == made["conversation_id"]


@pytest.fixture
def shop_product(area, django_user_model):
    seller = SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-ama"),
        phone="+233201110800",
        phone_verified_at=timezone.now(),
        business_name="Ama Tailoring",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    return Product.objects.create(
        seller=seller,
        name="Tailoring kit",
        slug="tailoring-kit",
        price="200.00",
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=1),
    )


@pytest.mark.django_db(transaction=True)
def test_asking_about_a_product_opens_the_shop_chat(client, shop_product, texts):
    otp.request_code(TRAINEE)
    client.post(
        "/api/enquiries/verify-code/",
        {"phone": TRAINEE, "code": "123456", "context": "marketplace"},
    )
    asked = client.post(
        reverse("product-enquiry-create", args=[shop_product.pk]),
        {"phone": TRAINEE, "name": "Kofi", "message": "Is it in blue?"},
        content_type=JSON,
    ).json()
    assert asked["conversation_id"]
    assert ProductEnquiry.objects.count() == 1
    assert texts[-1][0] == "+233201110800"
    assert 'Kofi asked about Tailoring kit: "Is it in blue?"' in texts[-1][1]

    seller = signed_in(shop_product.seller.user)
    [row] = seller.get(reverse("inbox")).json()["results"]
    assert (row["kind"], row["with"]["name"]) == ("shop", "Kofi")
    seller.post(
        reverse("inbox-chat", args=[asked["conversation_id"]]),
        {"body": "Yes, blue too."},
        content_type=JSON,
    )
    assert ProductEnquiry.objects.get().replied_at is not None
    # The shop's list of questions points to the chat, not to the number.
    [question] = seller.get(reverse("seller-enquiries")).json()["results"]
    assert question["conversation_id"] == asked["conversation_id"]
    assert question["buyer_phone"] is None and question["reply_url"] is None
    # The shop's old chat address still answers, for app builds already out.
    assert seller.get(reverse("seller-chats")).status_code == 200


@pytest.mark.django_db(transaction=True)
def test_the_trainees_own_list_links_the_chat(client, area, texts):
    from trainees.serializers import TraineeEnquirySerializer

    _provider, course = workshop(area)
    made = enquire(client, course)

    [row] = TraineeEnquirySerializer(Enquiry.objects.prefetch_related("messages"), many=True).data
    assert row["conversation_id"] == made["conversation_id"]
    assert row["whatsapp_url"] is None


@pytest.mark.django_db
def test_a_seller_can_write_first_to_a_buyer_with_an_account(
    shop_product, django_user_model, texts
):
    from marketplace.models import Order, PaymentStatus

    seller = signed_in(shop_product.seller.user)

    def order(reference, phone):
        return Order.objects.create(
            reference=reference,
            seller=shop_product.seller,
            product=shop_product,
            product_name=shop_product.name,
            unit_price="200.00",
            amount_pesewas=20000,
            buyer_phone=phone,
            buyer_name="Kofi",
            status=PaymentStatus.PAID,
        )

    order("fo-guest", "+233201119999")
    guest = seller.post(reverse("inbox"), {"order": "fo-guest"}, content_type=JSON)
    assert guest.status_code == 409

    CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("buyer-kofi"),
        phone="+233201112222",
        phone_verified_at=timezone.now(),
        display_name="Kofi",
    )
    order("fo-member", "+233201112222")
    opened = seller.post(reverse("inbox"), {"order": "fo-member"}, content_type=JSON)
    assert opened.status_code == 200
    assert opened.json()["with"]["name"] == "Kofi"
    assert seller.post(reverse("inbox"), {"order": "fo-nope"}, content_type=JSON).status_code == 404


@pytest.mark.django_db
def test_a_chat_can_be_reported_to_staff(area, django_user_model, texts):
    provider, _course = workshop(area)
    person = CustomerAccount.objects.create(
        user=django_user_model.objects.create_user("person-esi"),
        phone="+233201113333",
        phone_verified_at=timezone.now(),
    )
    conversation = Conversation.objects.create(provider=provider, buyer=person)
    them = signed_in(person.user)
    url = reverse("account-chat-report", args=[conversation.pk])

    assert them.post(url, {"reason": "nonsense"}, content_type=JSON).status_code == 400
    reported = them.post(
        url, {"reason": "money", "details": "Wants GHC 200 first"}, content_type=JSON
    )
    assert reported.status_code == 201
    report = ChatReport.objects.get()
    assert (report.reason, report.by) == ("money", Message.Sender.BUYER)
