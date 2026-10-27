"""The back office, which is where every marketplace decision is actually made.

Confirming a seller is the only gate between a sign-up and a public listing —
products are not reviewed one by one — so the permission on it is the whole
security model, and it is checked on the bulk action and on the single-row URL
separately. Hiding a button is not a permission.
"""

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from marketplace.models import Product, SellerAccount

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PASSWORD = "back-office-pass-1234"


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


@pytest.fixture
def seller(db, django_user_model, area):
    user = django_user_model.objects.create_user("seller-admin")
    return SellerAccount.objects.create(
        user=user,
        phone="+233201110600",
        phone_verified_at=timezone.now(),
        business_name="Ama Crafts",
        area=area,
    )


@pytest.fixture
def boss(db, client, django_user_model):
    user = django_user_model.objects.create_superuser("boss", password=PASSWORD)
    client.force_login(user)
    return user


@pytest.fixture
def officer(db, django_user_model):
    """Staff, but without the confirm permission."""
    return django_user_model.objects.create_user("officer", password=PASSWORD, is_staff=True)


CHANGELIST = "admin:marketplace_selleraccount_changelist"


@pytest.mark.django_db
def test_the_super_admin_can_confirm_a_seller(client, boss, seller):
    response = client.post(
        reverse("admin:marketplace_selleraccount_confirm", args=[seller.pk]), follow=True
    )

    assert response.status_code == 200
    seller.refresh_from_db()
    assert seller.is_confirmed
    assert seller.approval_decided_by == boss
    assert seller.approval_decided_at is not None


@pytest.mark.django_db
def test_confirming_needs_the_permission(client, officer, seller):
    """A URL is reachable by anyone who can guess it, and a bulk action
    hidden from the menu does not stop a POST."""
    client.force_login(officer)

    response = client.post(reverse("admin:marketplace_selleraccount_confirm", args=[seller.pk]))

    assert response.status_code in (403, 302)
    seller.refresh_from_db()
    assert not seller.is_confirmed


@pytest.mark.django_db
def test_confirming_is_a_post_not_a_get(client, boss, seller):
    """A GET that confirms an account would be followed by every crawler and
    link prefetcher that ever saw the page."""
    response = client.get(reverse("admin:marketplace_selleraccount_confirm", args=[seller.pk]))

    assert response.status_code == 405
    seller.refresh_from_db()
    assert not seller.is_confirmed


@pytest.mark.django_db
def test_the_bulk_action_also_checks_the_permission(client, officer, seller):
    client.force_login(officer)

    client.post(
        reverse(CHANGELIST),
        {"action": "confirm_sellers", "_selected_action": [str(seller.pk)]},
        follow=True,
    )

    seller.refresh_from_db()
    assert not seller.is_confirmed


@pytest.mark.django_db
def test_switching_a_seller_off_hides_the_whole_shelf(client, boss, seller):
    seller.approval_status = SellerAccount.Approval.CONFIRMED
    seller.save(update_fields=["approval_status"])
    Product.objects.create(seller=seller, name="Bag", slug="bag", status=Product.Status.PUBLISHED)
    Product.objects.create(seller=seller, name="Soap", slug="soap", status=Product.Status.PUBLISHED)
    assert Product.objects.visible().count() == 2

    client.post(
        reverse(CHANGELIST),
        {"action": "suspend_selling", "_selected_action": [str(seller.pk)]},
        follow=True,
    )

    assert not Product.objects.visible().exists()
    # Nothing was deleted and no product changed status, so switching back on
    # restores the shelf exactly rather than needing each row put back.
    assert Product.objects.filter(status=Product.Status.PUBLISHED).count() == 2


@pytest.mark.django_db
def test_a_product_can_be_taken_down(client, boss, seller):
    seller.approval_status = SellerAccount.Approval.CONFIRMED
    seller.save(update_fields=["approval_status"])
    product = Product.objects.create(
        seller=seller, name="Bag", slug="bag", status=Product.Status.PUBLISHED
    )

    client.post(
        reverse("admin:marketplace_product_changelist"),
        {"action": "take_down", "_selected_action": [str(product.pk)]},
        follow=True,
    )

    product.refresh_from_db()
    assert product.status == Product.Status.SUSPENDED
    assert not Product.objects.visible().exists()


@pytest.mark.django_db
def test_the_queues_load(client, boss, seller):
    """A changelist that raises is a queue nobody can work, and these two are
    where every marketplace decision is made."""
    Product.objects.create(seller=seller, name="Bag", slug="bag")

    for url in (
        reverse(CHANGELIST),
        reverse("admin:marketplace_product_changelist"),
        reverse("admin:marketplace_selleraccount_change", args=[seller.pk]),
    ):
        assert client.get(url).status_code == 200, url


@pytest.mark.django_db
def test_the_dashboard_counts_the_marketplace(client, boss, seller, area, django_user_model):
    """The oversight page is the answer to "so he sees everything that's
    going on", so it has to survive the marketplace being there at all."""
    seller.approval_status = SellerAccount.Approval.CONFIRMED
    seller.save(update_fields=["approval_status"])
    Product.objects.create(seller=seller, name="Live", slug="live", status=Product.Status.PUBLISHED)

    response = client.get(reverse("admin:index"))

    assert response.status_code == 200
    panel = response.context["panel"]["marketplace"]
    assert panel["sellers"] == 1
    assert panel["live"] == 1
    assert panel["sellers_waiting"] == 0


@pytest.mark.django_db
def test_the_dashboard_separates_published_from_actually_visible(client, boss, seller):
    """A row that says Published and is not. Switching a seller off leaves
    published products behind it, and a dashboard that counted those as live
    would be telling staff something untrue."""
    seller.approval_status = SellerAccount.Approval.CONFIRMED
    seller.is_active = False
    seller.save(update_fields=["approval_status", "is_active"])
    Product.objects.create(
        seller=seller, name="Hidden", slug="hidden", status=Product.Status.PUBLISHED
    )

    panel = client.get(reverse("admin:index")).context["panel"]["marketplace"]

    assert panel["live"] == 0
    assert panel["hidden_by_seller"] == 1
