"""One sign-in for everyone, one login per person, and joining up old ones.

The property everything rests on: whichever door a person comes in by, the
same phone means the same login, and that login never gains staff rights.
"""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from accounts.models import CustomerAccount, SavedProduct
from core.identities import create_dedicated_user
from courses import paystack
from enquiries import otp
from geography.models import Area, Region
from marketplace.models import Order, PaymentStatus, Product, SellerAccount
from providers.models import TrainerAccount
from trainees.models import TraineeAccount

PHONE = "+233241115555"
JSON = "application/json"
ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture(autouse=True)
def codes(monkeypatch):
    from django.core.cache import cache

    cache.clear()
    monkeypatch.setattr(otp, "send_sms", lambda to, m: None)
    monkeypatch.setattr(otp, "send_email", lambda *a: None)
    monkeypatch.setattr(otp, "_generate_code", lambda: "135791")


def sign_in(client, phone=PHONE, **extra):
    challenge = client.post(
        reverse("account-request-code"), {"phone": phone}, content_type=JSON
    ).json()["challenge_id"]
    return client.post(
        reverse("account-verify-code"),
        {"challenge_id": challenge, "phone": phone, "code": "135791", **extra},
        content_type=JSON,
    )


def trainee_sign_in(client, phone=PHONE):
    challenge = client.post(
        reverse("trainee-otp-request"), {"phone": phone}, content_type=JSON
    ).json()["challenge_id"]
    return client.post(
        reverse("trainee-otp-verify"),
        {"challenge_id": challenge, "phone": phone, "code": "135791"},
        content_type=JSON,
    )


@pytest.fixture
def shop(db, django_user_model):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)
    seller = SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-shop"),
        phone="+233201110800",
        phone_verified_at=timezone.now(),
        business_name="Ama Crafts",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
        paystack_subaccount="ACCT_ama",
    )
    product = Product.objects.create(
        seller=seller, name="Bag", slug="bag", price="100.00", status=Product.Status.PUBLISHED
    )
    return seller, product


# --------------------------------------------------------------------------
# Signing in


@pytest.mark.django_db
def test_signing_in_makes_an_account_and_signs_in(client):
    response = sign_in(client, name="Esi Mensah")

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] and body["joined"]
    assert body["account"]["display_name"] == "Esi Mensah"
    assert body["roles"] == {"trainee": None, "trainer": None, "seller": None}
    who = client.get(reverse("session-whoami")).json()
    assert who["customer"]["name"] == "Esi Mensah" and who["trainee"] is None


@pytest.mark.django_db
def test_the_same_phone_is_the_same_login_whichever_door(client):
    sign_in(client)
    customer = CustomerAccount.objects.get()

    trainee_sign_in(Client())

    trainee = TraineeAccount.objects.get()
    assert trainee.user_id == customer.user_id
    assert get_user_model().objects.count() == 1


@pytest.mark.django_db
def test_a_trainee_signing_in_gets_a_customer_account_on_their_login(client):
    trainee_sign_in(client)

    trainee = TraineeAccount.objects.get()
    assert CustomerAccount.objects.get().user_id == trainee.user_id
    assert client.get(reverse("account")).json()["roles"]["trainee"] == {"href": "/trainee"}


@pytest.mark.django_db
def test_a_phone_login_never_reuses_a_staff_user(client, django_user_model):
    staff = django_user_model.objects.create_user("staff", password="x", is_staff=True)
    TraineeAccount.objects.create(user=staff, phone=PHONE, phone_verified_at=timezone.now())

    sign_in(client)

    assert CustomerAccount.objects.get().user_id != staff.pk


# --------------------------------------------------------------------------
# Adding roles


@pytest.mark.django_db
def test_roles_are_added_to_the_same_login(client):
    sign_in(client)
    user = CustomerAccount.objects.get().user

    trainee = client.post(reverse("account-add-role", args=["trainee"]))
    trainer = client.post(reverse("account-add-role", args=["trainer"]))
    seller = client.post(reverse("account-add-role", args=["seller"]))
    nonsense = client.post(reverse("account-add-role", args=["admin"]))

    assert trainee.status_code == trainer.status_code == seller.status_code == 201
    assert nonsense.status_code == 404
    assert TraineeAccount.objects.get().user == user
    assert TrainerAccount.objects.get().user == user
    assert TrainerAccount.objects.get().approval_status == TrainerAccount.Approval.PENDING
    assert SellerAccount.objects.get().user == user
    roles = seller.json()["roles"]
    assert roles["seller"]["status"] == "pending" and roles["trainer"]["status"] == "pending"


@pytest.mark.django_db
def test_adding_a_role_needs_a_signed_in_account(client):
    assert client.post(reverse("account-add-role", args=["trainee"])).status_code in (401, 403)


@pytest.mark.django_db
def test_closing_a_trainee_account_keeps_a_login_that_also_sells(client):
    sign_in(client)
    client.post(reverse("account-add-role", args=["trainee"]))
    client.post(reverse("account-add-role", args=["seller"]))
    user_id = CustomerAccount.objects.get().user_id

    client.post(reverse("trainee-account-close"), {"confirm": True}, content_type=JSON)

    assert not TraineeAccount.objects.exists()
    assert get_user_model().objects.filter(pk=user_id).exists()
    assert SellerAccount.objects.filter(user_id=user_id).exists()


@pytest.mark.django_db
def test_closing_a_trainee_account_still_closes_the_whole_login_otherwise(client):
    trainee_sign_in(client)

    client.post(reverse("trainee-account-close"), {"confirm": True}, content_type=JSON)

    assert not get_user_model().objects.exists()
    assert not CustomerAccount.objects.exists()


# --------------------------------------------------------------------------
# Orders, saved items and checkout


def paid_order(seller, phone=PHONE, reference="fo-abc123"):
    return Order.objects.create(
        reference=reference,
        seller=seller,
        product_name="Bag",
        unit_price="100.00",
        amount_pesewas=10000,
        buyer_phone=phone,
        buyer_name="Esi",
        status=PaymentStatus.PAID,
        paid_at=timezone.now(),
    )


@pytest.mark.django_db
def test_orders_made_before_signing_up_are_there_after(client, shop):
    seller, _product = shop
    mine = paid_order(seller)
    paid_order(seller, phone="+233249999999", reference="fo-other")

    sign_in(client)
    orders = client.get(reverse("account-orders")).json()["results"]
    detail = client.get(reverse("order-detail", args=[mine.reference]))
    other = client.get(reverse("order-detail", args=["fo-other"]))

    assert [order["reference"] for order in orders] == [mine.reference]
    assert detail.status_code == 200  # From a browser that did not make it.
    assert other.status_code == 404


@pytest.mark.django_db
def test_saved_products_follow_the_account(client, shop):
    _seller, product = shop
    hidden = Product.objects.create(seller=shop[0], name="Draft", slug="draft", price="5.00")
    sign_in(client)

    added = client.put(
        reverse("account-saved"), {"add": [product.pk, hidden.pk, "x"]}, content_type=JSON
    )
    on_another_phone = Client()
    sign_in(on_another_phone)

    assert added.json()["ids"] == [product.pk]
    assert on_another_phone.get(reverse("account-saved")).json()["ids"] == [product.pk]
    client.put(reverse("account-saved"), {"remove": [product.pk]}, content_type=JSON)
    assert not SavedProduct.objects.exists()


@pytest.mark.django_db
def test_a_signed_in_buyer_pays_without_another_code(client, shop, settings, monkeypatch):
    settings.PAYSTACK_SECRET_KEY = "sk_test"
    monkeypatch.setattr(
        paystack, "_call", lambda *a, **k: {"authorization_url": "https://pay.test/x"}
    )
    _seller, product = shop
    sign_in(client)

    asked = client.post(reverse("otp-request"), {"phone": PHONE}, content_type=JSON)
    paid = client.post(
        reverse("product-order-create", args=[product.pk]),
        {"phone": PHONE, "name": "Esi", "fulfilment": "pickup"},
        content_type=JSON,
    )
    someone_else = client.post(
        reverse("product-order-create", args=[product.pk]),
        {"phone": "+233249999999", "name": "Esi", "fulfilment": "pickup"},
        content_type=JSON,
    )

    assert asked.json() == {"verified": True, "code_sent": False}
    assert paid.status_code == 201
    assert someone_else.status_code == 403


@pytest.mark.django_db
def test_the_account_details_can_be_changed(client):
    sign_in(client)

    response = client.patch(
        reverse("account"),
        {"display_name": "Esi M.", "delivery_address": "Adenta, near the market"},
        content_type=JSON,
    )

    account = response.json()["account"]
    assert account["display_name"] == "Esi M."
    assert account["delivery_address"] == "Adenta, near the market"


# --------------------------------------------------------------------------
# Joining up old logins


def old_style(model, phone=PHONE, **extra):
    """An account made the old way, on a login of its own."""
    user = create_dedicated_user(get_user_model(), prefix="old")
    return model.objects.create(user=user, phone=phone, phone_verified_at=timezone.now(), **extra)


@pytest.mark.django_db
def test_merging_puts_every_account_for_a_number_on_one_login(shop):
    seller, product = shop
    trainee = old_style(TraineeAccount)
    trainer = old_style(TrainerAccount)
    # Something else that named the trainer's old login.
    from marketplace.models import ProductPhoto

    photo = ProductPhoto.objects.create(product=product, image="x.jpg", uploaded_by=trainer.user)
    old_trainee_user = trainee.user

    dry = StringIO()
    call_command("merge_phone_accounts", stdout=dry)
    assert TraineeAccount.objects.get().user_id != TrainerAccount.objects.get().user_id

    call_command("merge_phone_accounts", "--yes", stdout=StringIO())
    again = StringIO()
    call_command("merge_phone_accounts", "--yes", stdout=again)

    trainee.refresh_from_db()
    trainer.refresh_from_db()
    photo.refresh_from_db()
    old_trainee_user.refresh_from_db()
    assert "Would merge 1" in dry.getvalue()
    assert trainee.user_id == trainer.user_id
    assert photo.uploaded_by_id == trainer.user_id
    assert old_trainee_user.is_active is False
    assert "already on one login" in again.getvalue()


@pytest.mark.django_db
def test_merging_never_touches_a_privileged_login(django_user_model):
    staff = django_user_model.objects.create_user("staff", password="x", is_staff=True)
    TraineeAccount.objects.create(user=staff, phone=PHONE, phone_verified_at=timezone.now())
    old_style(TrainerAccount)

    out = StringIO()
    call_command("merge_phone_accounts", "--yes", stdout=out)

    assert "skipped" in out.getvalue()
    assert TraineeAccount.objects.get().user_id == staff.pk
    assert TrainerAccount.objects.get().user_id != staff.pk
