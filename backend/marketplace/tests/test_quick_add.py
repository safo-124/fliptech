"""Adding an item in under a minute on a phone: photos first, then the rest."""

from datetime import timedelta
from io import BytesIO, StringIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from catalog.models import Programme, Trade
from marketplace.models import PendingProductPhoto, Product, ProductPhoto, SellerAccount
from marketplace.tests.test_more import ACCRA, JSON, as_seller, seller  # noqa: F401
from providers.models import Provider


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


def jpeg(name="item.jpg"):
    buffer = BytesIO()
    Image.new("RGB", (40, 30), "red").save(buffer, format="JPEG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


def upload(client):
    response = client.post(reverse("seller-pending-photos"), {"image": jpeg()})
    assert response.status_code == 201, response.content
    return response.json()


def add(client, **data):
    return client.post(reverse("seller-products"), data, content_type=JSON)


@pytest.mark.django_db
def test_photos_taken_before_the_item_is_saved_end_up_on_it(client, seller):  # noqa: F811
    client = as_seller(client, seller)
    first, second = upload(client), upload(client)
    assert first["image"]

    response = add(client, name="Metal shoe rack", photos=[second["id"], first["id"]])

    assert response.status_code == 201, response.content
    product = Product.objects.get()
    photos = list(product.photos.all())
    # In the order the form gave, and no longer waiting.
    assert [photo.display_order for photo in photos] == [0, 1]
    assert len(response.json()["photos"]) == 2
    assert not PendingProductPhoto.objects.exists()
    assert all(photo.exif_stripped for photo in photos)


@pytest.mark.django_db
def test_another_sellers_waiting_photo_cannot_be_taken(client, seller, django_user_model):  # noqa: F811
    other = SellerAccount.objects.create(
        user=django_user_model.objects.create_user("seller-other"),
        phone="+233201110801",
        phone_verified_at=timezone.now(),
        business_name="Other",
        area=seller.area,
    )
    theirs = PendingProductPhoto.objects.create(seller=other, image=jpeg())

    add(as_seller(client, seller), name="Rack", photos=[theirs.pk])

    assert not ProductPhoto.objects.exists()
    assert PendingProductPhoto.objects.filter(pk=theirs.pk).exists()


@pytest.mark.django_db
def test_the_defaults_the_seller_does_not_have_to_choose(client, seller):  # noqa: F811
    welding = Trade.objects.create(name="Welding", slug="welding")
    workshop = Provider.objects.create(
        name="Ama Welding",
        slug="ama-welding",
        area=seller.area,
        location=ACCRA,
        contact_phone="+233240000777",
        status=Provider.Status.PUBLISHED,
    )
    Programme.objects.create(
        provider=workshop, trade=welding, title="Arc welding", fee=900, duration_weeks=8
    )
    SellerAccount.objects.filter(pk=seller.pk).update(provider=workshop)
    seller.refresh_from_db()

    body = add(as_seller(client, seller), name="Metal shoe rack", options="Small, Large").json()

    product = Product.objects.get()
    assert product.trade == welding
    assert product.condition == Product.Condition.NEW
    assert product.stock is None
    assert product.availability == Product.Availability.AVAILABLE
    assert [option["label"] for option in body["options"]] == ["Small", "Large"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("typed", "stored"),
    [("1,200", "1200.00"), ("GH₵ 1 250.50", "1250.50"), ("", None), (None, None)],
)
def test_prices_as_a_seller_types_them(client, seller, typed, stored):  # noqa: F811
    response = add(as_seller(client, seller), name="Kente dress", price=typed)

    assert response.status_code == 201, response.content
    assert response.json()["price"] == stored


@pytest.mark.django_db
def test_put_on_sale_publishes_a_shop_that_may_sell(client, seller):  # noqa: F811
    body = add(as_seller(client, seller), name="Braided wig", price="300", publish=True).json()

    assert body["status"] == Product.Status.PUBLISHED
    assert "not_published" not in body


@pytest.mark.django_db
def test_put_on_sale_saves_a_draft_and_says_why_when_the_shop_cannot_sell(client, seller):  # noqa: F811
    SellerAccount.objects.filter(pk=seller.pk).update(
        approval_status=SellerAccount.Approval.DECLINED
    )
    seller.refresh_from_db()

    body = add(as_seller(client, seller), name="Braided wig", publish=True).json()

    assert body["status"] == Product.Status.DRAFT
    assert body["not_published"]["code"] == "declined"
    assert "not approved" in body["not_published"]["detail"]


@pytest.mark.django_db
def test_put_on_sale_works_before_staff_have_looked(client, seller):  # noqa: F811
    SellerAccount.objects.filter(pk=seller.pk).update(
        approval_status=SellerAccount.Approval.PENDING
    )
    seller.refresh_from_db()

    body = add(as_seller(client, seller), name="Braided wig", publish=True).json()

    assert body["status"] == Product.Status.PUBLISHED


@pytest.mark.django_db
def test_save_as_draft_never_publishes(client, seller):  # noqa: F811
    body = add(as_seller(client, seller), name="Braided wig").json()

    assert body["status"] == Product.Status.DRAFT


@pytest.mark.django_db
def test_waiting_photos_can_be_removed_and_old_ones_are_cleaned_up(client, seller):  # noqa: F811
    client = as_seller(client, seller)
    removed = upload(client)
    kept = upload(client)

    assert client.delete(reverse("seller-pending-photo", args=[removed["id"]])).status_code == 204
    PendingProductPhoto.objects.filter(pk=kept["id"]).update(
        created_at=timezone.now() - timedelta(days=2)
    )
    call_command("marketplace_daily", stdout=StringIO())

    assert not PendingProductPhoto.objects.exists()
