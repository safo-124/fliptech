"""Asking a seller about something, and the seller being told.

Two halves, and the second is the one that goes wrong quietly. An enquiry
nobody passes on looks identical in the database to one that was answered
slowly — that is exactly how the provider dashboard came to report workshops
as slow when they had never been told. So the alert is created in the same
transaction as the enquiry, and these tests check it is there.
"""

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from enquiries import otp
from geography.models import Area, Region
from marketplace import seller_messages
from marketplace.models import Product, ProductEnquiry, SellerAccount, SellerNotice

ACCRA = Point(-0.1870, 5.6037, srid=4326)
BUYER = "+233201112222"


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


@pytest.fixture
def sent(monkeypatch):
    from django.core.cache import cache

    cache.clear()
    box = {"sms": [], "email": []}
    monkeypatch.setattr(otp, "send_sms", lambda to, m: box["sms"].append((str(to), m)))
    monkeypatch.setattr(otp, "send_email", lambda to, s, b: box["email"].append((str(to), s, b)))
    monkeypatch.setattr(otp, "_generate_code", lambda: "246802")
    return box


@pytest.fixture
def product(db, django_user_model, area):
    user = django_user_model.objects.create_user("seller-enq")
    seller = SellerAccount.objects.create(
        user=user,
        phone="+233201110800",
        phone_verified_at=timezone.now(),
        business_name="Ama Crafts",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    return Product.objects.create(
        seller=seller,
        name="Handmade Ankara Bag",
        slug="handmade-ankara-bag",
        price="200.00",
        status=Product.Status.PUBLISHED,
    )


def verify(client, phone=BUYER):
    """The ordinary trainee verification, which is also the buyer's."""
    request = client.post(reverse("otp-request"), {"phone": phone}, content_type="application/json")
    assert request.status_code == 200
    return client.post(
        reverse("otp-verify"),
        {"phone": phone, "code": "246802"},
        content_type="application/json",
    )


def ask(client, product, **payload):
    return client.post(
        reverse("product-enquiry-create", args=[product.pk]),
        {"phone": BUYER, **payload},
        content_type="application/json",
    )


# --------------------------------------------------------------------------
# Asking


@pytest.mark.django_db
def test_anyone_can_ask_without_an_account(client, product, sent):
    """No sign-up. One code per browser session and that is the whole gate."""
    verify(client)

    response = ask(client, product, message="Do you have it in blue?")

    assert response.status_code == 201
    enquiry = ProductEnquiry.objects.get()
    assert enquiry.buyer_phone == BUYER
    assert enquiry.message == "Do you have it in blue?"
    assert enquiry.seller == product.seller


@pytest.mark.django_db
def test_an_unverified_number_is_refused(client, product, sent):
    """The seller is messaged on WhatsApp by a member of staff. An
    unverified form is a way to have Fliiptech message strangers on somebody
    else's behalf."""
    response = ask(client, product)

    assert response.status_code == 403
    assert not ProductEnquiry.objects.exists()


@pytest.mark.django_db
def test_verifying_once_covers_training_and_the_marketplace(client, product, sent):
    """Deliberately the same session trust as the training enquiry: somebody
    who asked about a welding course an hour ago does not type another code
    to ask about a bag."""
    verify(client)
    assert len(sent["sms"]) == 1

    ask(client, product)
    ask(client, product)

    assert ProductEnquiry.objects.count() == 2
    # Still one code for the whole session.
    assert len(sent["sms"]) == 1


@pytest.mark.django_db
def test_asking_about_something_invisible_is_a_404(client, product, sent):
    verify(client)
    product.status = Product.Status.DRAFT
    product.save(update_fields=["status"])

    assert ask(client, product).status_code == 404


@pytest.mark.django_db
def test_asking_a_seller_who_is_switched_off_is_a_404(client, product, sent):
    verify(client)
    product.seller.is_active = False
    product.seller.save(update_fields=["is_active"])

    assert ask(client, product).status_code == 404


@pytest.mark.django_db
def test_the_reference_comes_back(client, product, sent):
    """It is the only thing tying a WhatsApp conversation to a row here."""
    verify(client)

    body = ask(client, product).json()

    assert body["reference_code"] == ProductEnquiry.objects.get().reference_code


# --------------------------------------------------------------------------
# The seller being told


@pytest.mark.django_db
def test_an_alert_is_queued_with_the_enquiry(client, product, sent):
    verify(client)

    ask(client, product)

    notice = SellerNotice.objects.get()
    assert notice.enquiry == ProductEnquiry.objects.get()
    assert notice.seller == product.seller
    assert notice.sent_at is None
    assert list(seller_messages.alerts_waiting()) == [notice]


@pytest.mark.django_db
def test_the_alert_carries_the_buyers_number(client, product, sent):
    """The seller is the one who has to reply. Making them come back to a
    dashboard to find the number is how a reply does not happen."""
    verify(client)
    ask(client, product, name="Kofi", message="Still available?")

    text = seller_messages.alert_text(ProductEnquiry.objects.get())

    assert BUYER in text
    assert "Handmade Ankara Bag" in text
    assert "Still available?" in text


@pytest.mark.django_db
def test_an_enquiry_marked_spam_drops_out_of_the_queue(client, product, sent):
    verify(client)
    ask(client, product)

    ProductEnquiry.objects.update(state=ProductEnquiry.State.SPAM)

    assert not seller_messages.alerts_waiting().exists()


@pytest.mark.django_db
def test_a_switched_off_seller_drops_out_of_the_queue(client, product, sent):
    """Asking an officer to message somebody whose shop is off wastes their
    time and confuses the seller."""
    verify(client)
    ask(client, product)

    product.seller.is_active = False
    product.seller.save(update_fields=["is_active"])

    assert not seller_messages.alerts_waiting().exists()


@pytest.mark.django_db
def test_sending_records_who_and_when(client, product, sent, django_user_model):
    verify(client)
    ask(client, product)
    notice = SellerNotice.objects.get()
    officer = django_user_model.objects.create_user("officer-send", is_staff=True)

    seller_messages.mark_sent(notice, by=officer)

    notice.refresh_from_db()
    assert notice.sent_by == officer
    assert notice.sent_at is not None
    assert not seller_messages.alerts_waiting().exists()


# --------------------------------------------------------------------------
# The record outlives the product


@pytest.mark.django_db
def test_deleting_a_product_keeps_the_enquiry(client, product, sent):
    """A seller tidying their shelf must not delete the evidence that people
    were asking. That number is what the marketplace is judged on."""
    verify(client)
    ask(client, product)

    product.delete()

    enquiry = ProductEnquiry.objects.get()
    assert enquiry.product is None
    assert enquiry.product_name == "Handmade Ankara Bag"


# --------------------------------------------------------------------------
# The back office


@pytest.mark.django_db
def test_the_messages_page_lists_what_is_waiting(client, product, sent, django_user_model):
    verify(client)
    ask(client, product)
    client.logout()
    client.force_login(django_user_model.objects.create_superuser("boss2", password="pw-12345678"))

    response = client.get(reverse("admin:marketplace_selleraccount_messages"))

    assert response.status_code == 200
    assert len(response.context["waiting"]) == 1


@pytest.mark.django_db
def test_sending_from_the_back_office_opens_whatsapp(client, product, sent, django_user_model):
    verify(client)
    ask(client, product)
    notice = SellerNotice.objects.get()
    client.logout()
    client.force_login(django_user_model.objects.create_superuser("boss3", password="pw-12345678"))

    response = client.post(reverse("admin:marketplace_selleraccount_send_alert", args=[notice.pk]))

    assert response.status_code == 302
    assert response["Location"].startswith("https://wa.me/")
    notice.refresh_from_db()
    assert notice.sent_at is not None


@pytest.mark.django_db
def test_an_officer_without_the_permission_cannot_send(client, product, sent, django_user_model):
    verify(client)
    ask(client, product)
    notice = SellerNotice.objects.get()
    client.logout()
    client.force_login(
        django_user_model.objects.create_user(
            "plain-officer", password="pw-12345678", is_staff=True
        )
    )

    response = client.post(reverse("admin:marketplace_selleraccount_send_alert", args=[notice.pk]))

    assert response.status_code in (403, 302)
    notice.refresh_from_db()
    assert notice.sent_at is None


@pytest.mark.django_db
def test_the_enquiry_queue_loads(client, product, sent, django_user_model):
    verify(client)
    ask(client, product)
    client.logout()
    client.force_login(django_user_model.objects.create_superuser("boss4", password="pw-12345678"))

    assert client.get(reverse("admin:marketplace_productenquiry_changelist")).status_code == 200
