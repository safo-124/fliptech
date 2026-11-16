"""One account area: one profile, and one Close account that says what it does."""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.urls import reverse

from accounts.models import CustomerAccount, SavedProduct
from accounts.tests.test_accounts import (  # noqa: F401
    ACCRA,
    JSON,
    PHONE,
    codes,
    paid_order,
    shop,
    sign_in,
)
from courses.models import CoursePurchase
from enquiries.models import Enquiry
from marketplace.models import Order
from providers.models import Provider
from trainees.models import TraineeAccount


def close(client):
    return client.post(reverse("account-close"), {"confirm": True}, content_type=JSON)


@pytest.mark.django_db
def test_closing_deletes_the_login_and_keeps_orders_for_the_seller(client, shop):  # noqa: F811
    seller, product = shop
    sign_in(client)
    client.post(reverse("account-add-role", args=["trainee"]))
    SavedProduct.objects.create(account=CustomerAccount.objects.get(), product=product)
    paid_order(seller)
    trainee = TraineeAccount.objects.get()
    user_id = trainee.user_id
    enquiry = Enquiry.objects.create(
        provider=Provider.objects.create(
            name="Works", slug="works", area=seller.area, location=ACCRA, contact_phone=PHONE
        ),
        trainee=trainee,
        trainee_phone=PHONE,
    )

    response = close(client)

    assert response.status_code == 200, response.content
    assert not CustomerAccount.objects.exists()
    assert not TraineeAccount.objects.exists()
    assert not SavedProduct.objects.exists()
    assert not get_user_model().objects.filter(pk=user_id).exists()
    # The seller's sale and the workshop's enquiry stay, unlinked.
    assert Order.objects.filter(buyer_phone=PHONE).exists()
    enquiry.refresh_from_db()
    assert enquiry.trainee_id is None
    # And they are signed out.
    assert client.get(reverse("account")).json()["authenticated"] is False


@pytest.mark.django_db
def test_closing_needs_the_confirm(client):
    sign_in(client)

    response = client.post(reverse("account-close"), {}, content_type=JSON)

    assert response.status_code == 400
    assert CustomerAccount.objects.exists()


@pytest.mark.django_db
def test_a_login_that_runs_a_shop_is_not_closed_from_here(client):
    sign_in(client)
    client.post(reverse("account-add-role", args=["seller"]))

    response = close(client)

    assert response.status_code == 409
    assert response.json()["code"] == "runs_business"
    assert CustomerAccount.objects.exists()


@pytest.mark.django_db
def test_a_paid_course_keeps_the_account_open_and_says_why(client, shop):  # noqa: F811
    seller, _product = shop
    sign_in(client)
    client.post(reverse("account-add-role", args=["trainee"]))
    provider = Provider.objects.create(
        name="Works", slug="works", area=seller.area, location=ACCRA, contact_phone=PHONE
    )
    CoursePurchase.objects.create(
        reference="fc-paid",
        provider=provider,
        trainee=TraineeAccount.objects.get(),
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
    )

    account_close = close(client)
    trainee_close = client.post(
        reverse("trainee-account-close"), {"confirm": True}, content_type=JSON
    )

    assert account_close.status_code == 409
    assert account_close.json()["code"] == "paid_courses"
    # The learner's own close button no longer fails with a server error.
    assert trainee_close.status_code == 409
    assert TraineeAccount.objects.exists()


@pytest.mark.django_db
def test_the_email_saved_on_the_account_is_the_learners_email_too(client):
    sign_in(client)
    client.post(reverse("account-add-role", args=["trainee"]))

    client.patch(
        reverse("account"),
        {"display_name": "Esi Mensah", "email": "esi@example.com"},
        content_type=JSON,
    )

    trainee = TraineeAccount.objects.get()
    assert trainee.display_name == "Esi Mensah"
    assert trainee.email == "esi@example.com"


@pytest.mark.django_db
def test_the_sync_command_lines_up_old_accounts_and_dry_runs_first(client):
    sign_in(client)
    client.post(reverse("account-add-role", args=["trainee"]))
    CustomerAccount.objects.update(display_name="Esi", email="esi@example.com")
    TraineeAccount.objects.update(display_name="", email=None)

    out = StringIO()
    call_command("sync_account_profiles", stdout=out)
    assert "Dry run" in out.getvalue()
    assert TraineeAccount.objects.get().email is None

    call_command("sync_account_profiles", "--yes", stdout=StringIO())
    trainee = TraineeAccount.objects.get()
    assert (trainee.display_name, trainee.email) == ("Esi", "esi@example.com")


@pytest.mark.django_db
def test_closing_keeps_the_chats_for_the_shop_without_the_person(client, shop):  # noqa: F811
    from django.test import Client

    from marketplace.models import Conversation, Message

    seller, _product = shop
    sign_in(client)
    account = CustomerAccount.objects.get()
    chat = Conversation.objects.create(seller=seller, buyer=account)
    Message.objects.create(conversation=chat, sender=Message.Sender.BUYER, body="Is it in blue?")
    Message.objects.create(
        conversation=chat, sender=Message.Sender.BUYER, kind=Message.Kind.PHONE, body=PHONE
    )

    assert close(client).status_code == 200

    chat.refresh_from_db()
    assert chat.buyer_id is None
    bodies = list(chat.messages.values_list("body", flat=True))
    assert "Is it in blue?" in bodies
    assert not any(PHONE in body for body in bodies)

    business = Client()
    business.force_login(seller.user)
    thread = business.get(reverse("inbox-chat", args=[chat.pk])).json()
    assert thread["closed"] is True
    assert thread["with"]["name"] == "Closed account"
    business.get(reverse("account"))  # a CSRF cookie for the reply
    token = business.cookies["csrftoken"].value
    reply = business.post(
        reverse("inbox-chat", args=[chat.pk]),
        {"body": "Yes, in blue"},
        content_type=JSON,
        HTTP_X_CSRFTOKEN=token,
    )
    assert reply.status_code == 409
