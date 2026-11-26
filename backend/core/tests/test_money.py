"""The back office's Money page."""

import pytest
from django.urls import reverse
from django.utils import timezone

from accounts.tests.test_accounts import shop  # noqa: F401
from core import money_page as money
from marketplace.models import CheckoutPayment, Order, PaymentStatus


def paid_order(seller, product, **fields):
    defaults = {
        "reference": f"fo-{timezone.now().timestamp()}",
        "seller": seller,
        "product": product,
        "product_name": product.name,
        "unit_price": product.price,
        "amount_pesewas": 10000,
        "commission_pesewas": 500,
        "buyer_phone": "+233240000001",
        "buyer_name": "Esi",
        "status": PaymentStatus.PAID,
        "paid_at": timezone.now(),
    }
    defaults.update(fields)
    return Order.objects.create(**defaults)


@pytest.mark.django_db
def test_it_adds_up_what_came_in_what_was_kept_and_what_is_held(shop):  # noqa: F811
    seller, product = shop
    paid_order(seller, product, reference="fo-1")
    paid_order(seller, product, reference="fo-2", payout=Order.Payout.HELD)

    found = money.summary("marketplace", 7)

    assert found["came_in"] == "200.00" and found["count"] == 2
    assert found["kept"] == "10.00"
    assert found["held"] == "95.00"
    assert len(found["rows"]) == 2


@pytest.mark.django_db
def test_payments_still_waiting_after_an_hour_need_a_look(shop):  # noqa: F811
    seller, product = shop
    late = timezone.now() - timezone.timedelta(hours=3)
    payment = CheckoutPayment.objects.create(
        reference="fg-late", buyer_phone="+233240000001", buyer_name="Esi", amount_pesewas=100
    )
    CheckoutPayment.objects.filter(pk=payment.pk).update(created_at=late)
    fresh = paid_order(
        seller, product, reference="fo-new", status=PaymentStatus.PENDING, paid_at=None
    )

    stuck = money.stuck_payments()

    assert ("checkout", "fg-late") in stuck
    assert ("order", fresh.reference) not in stuck


@pytest.mark.django_db
def test_staff_open_the_page(admin_client, shop):  # noqa: F811
    seller, product = shop
    paid_order(seller, product, reference="fo-1")

    page = admin_client.get(reverse("admin:money") + "?area=all&days=30")

    assert page.status_code == 200
    assert b"Fliiptech kept" in page.content and b"Needs a look" in page.content
    assert b"Ama Crafts" in page.content
