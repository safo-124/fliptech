"""Deleting a whole account, shop and workshop included (accounts/removal.py),
from "Delete my account" and from the back office's Delete."""

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.urls import reverse

from accounts.models import CustomerAccount
from accounts.removal import CannotRemove, remove_login
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
from marketplace.models import Order, Product, ProductPhoto, SellerAccount
from providers.models import Provider, ProviderMembership, TrainerAccount
from trainees.models import TraineeAccount

User = get_user_model()


def close(client, **extra):
    return client.post(reverse("account-close"), {"confirm": True, **extra}, content_type=JSON)


def own_shop(client, seller):
    """Hand the shop fixture to the login `client` is signed in as."""
    user = User.objects.get(customer_account__isnull=False)
    old = seller.user
    seller.user = user
    seller.save()
    old.delete()
    return user


def workshop(area, name="Works", phone="+233201110900"):
    return Provider.objects.create(
        name=name,
        slug=name.lower(),
        area=area,
        location=ACCRA,
        contact_phone=phone,
        owner_name="Kofi",
        status=Provider.Status.PUBLISHED,
    )


def trainer_for(user, provider, phone="+233201110901"):
    trainer = TrainerAccount.objects.create(user=user, phone=phone, full_name="Kofi Boateng")
    ProviderMembership.objects.create(trainer=trainer, provider=provider)
    return trainer


@pytest.mark.django_db
def test_deleting_a_shop_with_no_sales_deletes_everything(  # noqa: F811
    client,
    shop,
    settings,
    tmp_path,
    django_capture_on_commit_callbacks,  # noqa: F811
):
    settings.MEDIA_ROOT = tmp_path
    seller, product = shop
    photo = ProductPhoto.objects.create(
        product=product, image=ContentFile(b"\xff\xd8\xff bag", name="bag.jpg")
    )
    stored = tmp_path / photo.image.name
    assert stored.exists()
    sign_in(client)
    own_shop(client, seller)

    with django_capture_on_commit_callbacks(execute=True):
        response = close(client)

    assert response.status_code == 200, response.content
    assert not SellerAccount.objects.exists()
    assert not Product.objects.exists()
    assert not User.objects.exists()
    assert not CustomerAccount.objects.exists()
    assert not stored.exists()  # the photo file on the server went too


@pytest.mark.django_db
def test_paid_orders_stay_without_the_seller_and_the_shop_leaves_the_website(client, shop):  # noqa: F811
    seller, product = shop
    order = paid_order(seller, phone="+233249999999")
    sign_in(client)
    user = own_shop(client, seller)
    assert Product.objects.visible().exists()

    response = close(client)

    assert response.status_code == 200, response.content
    assert not Product.objects.exists()
    assert not Product.objects.visible().exists()
    order.refresh_from_db()  # the buyer's receipt and the books
    assert order.seller_id == seller.pk
    seller.refresh_from_db()
    assert seller.business_name == "Closed shop"
    assert not seller.is_active
    assert not seller.may_sell
    assert str(seller.phone) != "+233201110800"
    assert seller.email is None
    user.refresh_from_db()
    assert not user.is_active
    assert not user.has_usable_password()
    assert not CustomerAccount.objects.exists()
    # The number is free to sign up again.
    sign_in(client, phone="+233201110800")
    assert CustomerAccount.objects.filter(phone="+233201110800").exists()
    assert Order.objects.count() == 1


@pytest.mark.django_db
def test_deleting_a_trainer_takes_the_workshop_off_the_website(client, shop):  # noqa: F811
    seller, _product = shop
    provider = workshop(seller.area)
    sign_in(client)
    user = User.objects.get(customer_account__isnull=False)
    trainer_for(user, provider)
    assert Provider.objects.published().exists()

    assert close(client).status_code == 200

    assert not Provider.objects.exists()
    assert not TrainerAccount.objects.exists()
    assert not User.objects.filter(pk=user.pk).exists()


@pytest.mark.django_db
def test_a_workshop_with_paid_course_sales_is_kept_hidden_and_emptied(client, shop):  # noqa: F811
    seller, _product = shop
    provider = workshop(seller.area)
    learner = TraineeAccount.objects.create(
        user=User.objects.create_user("learner"), phone="+233249999990"
    )
    purchase = CoursePurchase.objects.create(
        reference="fc-paid",
        provider=provider,
        trainee=learner,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
    )
    sign_in(client)
    user = User.objects.get(customer_account__isnull=False)
    trainer_for(user, provider)

    assert close(client).status_code == 200

    provider.refresh_from_db()
    assert not Provider.objects.published().exists()
    assert provider.name == "Closed workshop"
    assert provider.owner_name == ""
    assert CoursePurchase.objects.filter(pk=purchase.pk).exists()
    assert not TrainerAccount.objects.exists()
    assert not User.objects.filter(pk=user.pk).exists()


@pytest.mark.django_db
def test_a_learner_with_a_paid_course_can_delete_the_account_now(client, shop):  # noqa: F811
    seller, _product = shop
    provider = workshop(seller.area)
    sign_in(client)
    client.post(reverse("account-add-role", args=["trainee"]))
    learner = TraineeAccount.objects.get()
    learner.display_name = "Esi Mensah"
    learner.save()
    CoursePurchase.objects.create(
        reference="fc-paid",
        provider=provider,
        trainee=learner,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
    )

    assert close(client).status_code == 200

    learner.refresh_from_db()
    assert learner.display_name == ""
    assert str(learner.phone) != PHONE
    assert CoursePurchase.objects.count() == 1


@pytest.mark.django_db
def test_a_password_account_must_give_its_password(client):
    client.post(
        reverse("account-register"),
        {"phone": PHONE, "email": "esi@example.com", "password": "Kente-loom-2026"},
        content_type=JSON,
    )

    wrong = close(client, password="not-it")
    right = close(client, password="Kente-loom-2026")

    assert wrong.status_code == 403
    assert wrong.json()["code"] == "password"
    assert right.status_code == 200
    assert not User.objects.exists()


@pytest.mark.django_db
def test_a_staff_login_is_never_removed(django_user_model):
    staff = django_user_model.objects.create_user("staff", is_staff=True)
    with pytest.raises(CannotRemove):
        remove_login(staff)
    assert User.objects.filter(pk=staff.pk).exists()


# --- the back office -----------------------------------------------------------


@pytest.fixture
def boss(client, django_user_model):
    user = django_user_model.objects.create_superuser("boss", password="pw-12345678")
    client.force_login(user)
    return user


@pytest.mark.django_db
def test_the_back_office_deletes_a_seller_with_paid_orders(client, boss, shop):  # noqa: F811
    seller, _product = shop
    paid_order(seller)
    url = reverse("admin:marketplace_selleraccount_delete", args=[seller.pk])

    page = client.get(url)
    assert page.status_code == 200
    text = page.content.decode()
    assert "leave the website at once" in text
    assert "kept for refunds" in text
    assert "Cannot delete" not in text

    response = client.post(url, {"post": "yes"}, follow=True)

    assert response.status_code == 200
    assert not Product.objects.exists()
    assert Order.objects.count() == 1
    assert SellerAccount.objects.get().business_name == "Closed shop"


@pytest.mark.django_db
def test_the_back_office_deleting_a_trainer_removes_the_workshop(client, boss, shop):  # noqa: F811
    seller, _product = shop
    provider = workshop(seller.area)
    trainer = trainer_for(User.objects.create_user("kofi"), provider)

    response = client.post(
        reverse("admin:providers_traineraccount_delete", args=[trainer.pk]),
        {"post": "yes"},
        follow=True,
    )

    assert response.status_code == 200
    assert not TrainerAccount.objects.exists()
    assert not Provider.objects.exists()
    assert not User.objects.filter(username="kofi").exists()


@pytest.mark.django_db
def test_the_back_office_will_not_delete_a_staff_login(client, boss):
    other = User.objects.create_user("other-staff", is_staff=True)

    page = client.get(reverse("admin:auth_user_delete", args=[other.pk]))

    assert "staff login" in page.content.decode()
    assert User.objects.filter(pk=other.pk).exists()
