"""Pictures of the goods.

Written after two bugs were found on these paths by reading rather than by
failing: the error branches here were unreachable from any test, and both of
them called gettext through a name that had been rebound to a model instance.
"""

from io import BytesIO

import pytest
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from geography.models import Area, Region
from marketplace.models import Product, ProductPhoto, SellerAccount
from marketplace.views import MAX_PHOTOS_PER_PRODUCT

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


@pytest.fixture
def seller(db, django_user_model, area, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    user = django_user_model.objects.create_user("seller-photos")
    return SellerAccount.objects.create(
        user=user,
        phone="+233201110450",
        phone_verified_at=timezone.now(),
        business_name="Ama Crafts",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )


@pytest.fixture
def product(seller, client):
    client.force_login(seller.user)
    return Product.objects.create(seller=seller, name="Ankara Bag", slug="ankara-bag")


def jpeg(name="bag.jpg", size=(900, 700)):
    buffer = BytesIO()
    image = Image.new("RGB", size, "red")
    exif = image.getexif()
    exif[0x0110] = "TestPhone"
    image.save(buffer, format="JPEG", exif=exif)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


@pytest.mark.django_db
def test_a_picture_can_be_added(client, product):
    response = client.post(reverse("seller-product-photos", args=[product.pk]), {"image": jpeg()})

    assert response.status_code == 201
    assert product.photos.count() == 1


@pytest.mark.django_db
def test_the_gps_comes_off(client, product, settings):
    """Somebody photographing a bag on their own table is publishing their
    home address unless this happens."""
    client.post(reverse("seller-product-photos", args=[product.pk]), {"image": jpeg()})

    photo = product.photos.get()
    stored = Image.open(settings.MEDIA_ROOT / photo.image.name)
    assert not stored.getexif()


@pytest.mark.django_db
def test_sending_nothing_is_a_plain_message_not_a_crash(client, product):
    """This branch raised TypeError before it was tested: it calls gettext
    through a name that a tuple unpack two lines above had rebound."""
    response = client.post(reverse("seller-product-photos", args=[product.pk]), {})

    assert response.status_code == 400
    assert response.json()["detail"]


@pytest.mark.django_db
def test_a_file_that_is_not_an_image_is_refused(client, product):
    response = client.post(
        reverse("seller-product-photos", args=[product.pk]),
        {"image": SimpleUploadedFile("price.pdf", b"%PDF-1.4", content_type="application/pdf")},
    )

    assert response.status_code == 400
    assert not product.photos.exists()


@pytest.mark.django_db
def test_there_is_a_limit(client, product):
    for i in range(MAX_PHOTOS_PER_PRODUCT):
        assert (
            client.post(
                reverse("seller-product-photos", args=[product.pk]),
                {"image": jpeg(f"bag-{i}.jpg")},
            ).status_code
            == 201
        )

    response = client.post(
        reverse("seller-product-photos", args=[product.pk]), {"image": jpeg("one-too-many.jpg")}
    )

    assert response.status_code == 400
    assert product.photos.count() == MAX_PHOTOS_PER_PRODUCT


@pytest.mark.django_db
def test_a_picture_can_be_removed(client, product, settings):
    client.post(reverse("seller-product-photos", args=[product.pk]), {"image": jpeg()})
    photo = product.photos.get()
    path = settings.MEDIA_ROOT / photo.image.name

    response = client.delete(reverse("seller-product-photo", args=[product.pk, photo.pk]))

    assert response.status_code == 204
    assert not product.photos.exists()
    # The bytes go too. An orphaned file nobody references is still a
    # photograph of somebody's workshop sitting in a public bucket.
    assert not path.exists()


@pytest.mark.django_db
def test_removing_a_picture_that_is_not_there(client, product):
    """Also previously a TypeError rather than a 404."""
    assert (
        client.delete(reverse("seller-product-photo", args=[product.pk, 9999])).status_code == 404
    )


@pytest.mark.django_db
def test_one_seller_cannot_add_pictures_to_anothers_product(
    client, product, area, django_user_model
):
    other_user = django_user_model.objects.create_user("other-photo-seller")
    other = SellerAccount.objects.create(
        user=other_user,
        phone="+233201110451",
        phone_verified_at=timezone.now(),
        business_name="Adjoa's",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    client.force_login(other.user)

    response = client.post(reverse("seller-product-photos", args=[product.pk]), {"image": jpeg()})

    assert response.status_code == 404
    assert not ProductPhoto.objects.exists()
