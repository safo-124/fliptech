"""Who may sell, and what the public may see.

The marketplace's whole safety story is one queryset — `Product.objects
.visible()` — and one rule about who is allowed to publish. Everything else
is a form around those. So these tests are about the ways a product can reach
a buyer it should not have reached.
"""

from io import BytesIO

import pytest
from django.contrib.gis.geos import Point
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.utils import IntegrityError
from django.utils import timezone
from PIL import Image

from geography.models import Area, Region
from marketplace.models import Product, ProductPhoto, SellerAccount
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


def make_seller(django_user_model, area, *, name, phone, confirmed=True, provider=None):
    user = django_user_model.objects.create_user(phone.replace("+", ""))
    return SellerAccount.objects.create(
        user=user,
        phone=phone,
        phone_verified_at=timezone.now(),
        business_name=name,
        area=area,
        provider=provider,
        approval_status=(
            SellerAccount.Approval.CONFIRMED if confirmed else SellerAccount.Approval.PENDING
        ),
    )


@pytest.fixture
def seller(db, django_user_model, area):
    return make_seller(django_user_model, area, name="Ama Crafts", phone="+233201110001")


def publish(seller, name="Handmade Ankara Bag", **kwargs):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        status=kwargs.pop("status", Product.Status.PUBLISHED),
        **kwargs,
    )


# --------------------------------------------------------------------------
# A seller does not have to be a workshop


@pytest.mark.django_db
def test_somebody_who_only_sells_needs_no_listing(seller):
    """The point of a separate account. A soap maker who teaches nobody is a
    seller, and must not need a training listing to be one."""
    assert seller.provider is None
    assert seller.may_sell


@pytest.mark.django_db
def test_a_workshop_can_be_the_same_business_in_both_places(db, django_user_model, area):
    provider = Provider.objects.create(
        name="VIS Leather and Silk",
        slug="vis-leather-and-silk",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )
    seller = make_seller(
        django_user_model, area, name="VIS Leather", phone="+233201110002", provider=provider
    )

    assert seller.provider == provider
    assert provider.seller_account == seller


@pytest.mark.django_db
def test_two_sellers_may_use_the_same_product_name(db, django_user_model, area, seller):
    """Slugs are unique per seller, not globally. Two tailors both selling an
    "Ankara bag" is the ordinary case, and a global constraint would make the
    second one rename a product for a reason she could not see."""
    other = make_seller(django_user_model, area, name="Adjoa's", phone="+233201110003")

    publish(seller)
    publish(other)

    assert Product.objects.count() == 2


@pytest.mark.django_db
def test_one_seller_may_not_repeat_a_slug(seller):
    publish(seller)

    with pytest.raises(IntegrityError):
        publish(seller)


# --------------------------------------------------------------------------
# What the public may see


@pytest.mark.django_db
def test_a_published_product_from_a_confirmed_seller_is_visible(seller):
    product = publish(seller)

    assert list(Product.objects.visible()) == [product]


@pytest.mark.django_db
def test_a_draft_is_not_visible(seller):
    publish(seller, status=Product.Status.DRAFT)

    assert not Product.objects.visible().exists()


@pytest.mark.django_db
def test_a_product_taken_down_by_staff_is_not_visible(seller):
    publish(seller, status=Product.Status.SUSPENDED)

    assert not Product.objects.visible().exists()


@pytest.mark.django_db
def test_an_unconfirmed_seller_shows_nothing(db, django_user_model, area):
    """They may fill their shelf while they wait. None of it is public.

    This is the gate the whole moderation model rests on: products are not
    reviewed one by one, so the seller being confirmed is the only thing
    standing between a sign-up and a public listing.
    """
    pending = make_seller(
        django_user_model, area, name="Unknown", phone="+233201110004", confirmed=False
    )
    publish(pending)

    assert not Product.objects.visible().exists()


@pytest.mark.django_db
def test_switching_a_seller_off_takes_the_whole_shelf_down(seller):
    """One action, not one per product — and reversible without having to
    remember which products were live before."""
    publish(seller, name="Bag One")
    publish(seller, name="Bag Two")
    assert Product.objects.visible().count() == 2

    seller.is_active = False
    seller.save(update_fields=["is_active"])

    assert not Product.objects.visible().exists()

    seller.is_active = True
    seller.save(update_fields=["is_active"])

    assert Product.objects.visible().count() == 2


@pytest.mark.django_db
def test_declining_a_seller_hides_their_products(seller):
    publish(seller)

    seller.approval_status = SellerAccount.Approval.DECLINED
    seller.save(update_fields=["approval_status"])

    assert not Product.objects.visible().exists()


# --------------------------------------------------------------------------
# Publishing is checked on the model, not only in a form


@pytest.mark.django_db
def test_an_unconfirmed_seller_cannot_publish_through_clean(db, django_user_model, area):
    """A row written from the back office or a management command must not be
    able to route around the rule the view enforces."""
    pending = make_seller(
        django_user_model, area, name="Unknown", phone="+233201110005", confirmed=False
    )
    product = Product(
        seller=pending,
        name="Soap",
        slug="soap",
        status=Product.Status.PUBLISHED,
    )

    with pytest.raises(ValidationError) as caught:
        product.full_clean()

    assert "status" in caught.value.message_dict


@pytest.mark.django_db
def test_a_confirmed_seller_passes_the_same_check(seller):
    product = Product(seller=seller, name="Soap", slug="soap", status=Product.Status.PUBLISHED)

    product.full_clean()


# --------------------------------------------------------------------------
# Price and availability


@pytest.mark.django_db
def test_a_price_may_be_left_off(seller):
    """ "Price on request" is a real answer for something made to order, and
    more honest than a number the seller would have to argue down."""
    product = publish(seller, price=None)

    assert product.price is None


@pytest.mark.django_db
def test_availability_is_a_state_not_a_count(seller):
    """A number nobody updates is worse than no number. Whatever else
    changes, this field must not become an integer."""
    product = publish(seller)

    assert product.availability == Product.Availability.AVAILABLE
    assert {choice for choice, _ in Product.Availability.choices} == {
        "available",
        "made_to_order",
        "sold_out",
    }


# --------------------------------------------------------------------------
# Photographs


def jpeg_with_gps(name="bag.jpg"):
    buffer = BytesIO()
    image = Image.new("RGB", (900, 700), "red")
    exif = image.getexif()
    exif[0x0110] = "TestPhone"
    image.save(buffer, format="JPEG", exif=exif)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


@pytest.mark.django_db
def test_a_product_photo_is_stripped_and_downscaled(seller, settings, tmp_path):
    """Somebody photographing a bag on their own table is publishing their
    home address unless the GPS tag comes off."""
    from core.images import MAX_STORED_EDGE

    settings.MEDIA_ROOT = tmp_path
    product = publish(seller)

    photo = ProductPhoto.objects.create(product=product, image=jpeg_with_gps())

    stored = Image.open(settings.MEDIA_ROOT / photo.image.name)
    assert max(stored.size) <= MAX_STORED_EDGE
    assert not stored.getexif()
    assert photo.exif_stripped is True


@pytest.mark.django_db
def test_editing_a_caption_does_not_re_encode_the_photograph(seller, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    product = publish(seller)
    photo = ProductPhoto.objects.create(product=product, image=jpeg_with_gps())
    stored_name = photo.image.name

    photo.caption = "Front view"
    photo.save(update_fields=["caption", "updated_at"])
    photo.refresh_from_db()

    assert photo.image.name == stored_name
