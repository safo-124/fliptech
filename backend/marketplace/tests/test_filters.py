"""Marketplace filters (sold by trainers or makers, price, paying online,
delivery, verified, on sale, one shop) and the trainers-who-sell list."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from marketplace.models import Product, SellerAccount
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture(autouse=True)
def paystack_on(settings):
    settings.PAYSTACK_SECRET_KEY = "sk_test_secret"
    settings.MARKETPLACE_HOLD_PAYMENTS = False


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


@pytest.fixture
def workshop(area):
    return Provider.objects.create(
        name="Adenta Tailoring Institute",
        slug="adenta-tailoring",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )


def shop(django_user_model, area, name, phone, **extra):
    return SellerAccount.objects.create(
        user=django_user_model.objects.create_user(name.lower().replace(" ", "-")),
        phone=phone,
        phone_verified_at=timezone.now(),
        business_name=name,
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
        **extra,
    )


def product(seller, name, price="100.00", **extra):
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price=price,
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=3),
        **extra,
    )


@pytest.fixture
def shops(django_user_model, area, workshop):
    trainer = shop(
        django_user_model,
        area,
        "Adenta Tailoring",
        "+233201110801",
        provider=workshop,
        paystack_subaccount="ACCT_t",
        delivery_fee="15.00",
        verified_at=timezone.now(),
    )
    maker = shop(django_user_model, area, "Kofi Beads", "+233201110802")
    return trainer, maker


def names(client, **params):
    response = client.get(reverse("product-list"), params)
    assert response.status_code == 200
    return sorted(row["name"] for row in response.json()["results"])


@pytest.mark.django_db
def test_sold_by_trainers_or_makers(client, shops):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(maker, "Bead bracelet")
    assert names(client, sold_by="trainers") == ["Kente shirt"]
    assert names(client, sold_by="makers") == ["Bead bracelet"]
    assert names(client) == ["Bead bracelet", "Kente shirt"]


@pytest.mark.django_db
def test_one_workshop_or_one_shop(client, shops, workshop):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(maker, "Bead bracelet")
    assert names(client, workshop=workshop.pk) == ["Kente shirt"]
    assert names(client, seller=maker.pk) == ["Bead bracelet"]
    assert names(client, workshop="nonsense") == ["Bead bracelet", "Kente shirt"]


@pytest.mark.django_db
def test_price_range_is_inclusive_and_drops_ask_for_price(client, shops):
    trainer, _ = shops
    product(trainer, "Cheap", price="20.00")
    product(trainer, "Middle", price="100.00")
    product(trainer, "Dear", price="500.00")
    product(trainer, "Ask me", price=None)
    assert names(client, min_price="100") == ["Dear", "Middle"]
    assert names(client, max_price="100") == ["Cheap", "Middle"]
    # Swapped bounds are read the right way round; junk is ignored.
    assert names(client, min_price="500", max_price="20") == ["Cheap", "Dear", "Middle"]
    assert len(names(client, min_price="abc")) == 4


@pytest.mark.django_db
def test_seller_flags(client, shops):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(maker, "Bead bracelet")
    assert names(client, delivers="1") == ["Kente shirt"]
    assert names(client, verified="true") == ["Kente shirt"]


@pytest.mark.django_db
def test_on_sale_means_a_real_reduction(client, shops):
    trainer, _ = shops
    product(trainer, "Reduced", price="80.00", was_price="100.00")
    product(trainer, "Not really", price="100.00", was_price="90.00")
    product(trainer, "Full price")
    assert names(client, on_sale="1") == ["Reduced"]


@pytest.mark.django_db
def test_pay_online_matches_the_buy_now_rule(client, shops, settings):
    trainer, maker = shops
    product(trainer, "Ready", availability=Product.Availability.AVAILABLE)
    product(trainer, "Made to order, no deposit", availability=Product.Availability.MADE_TO_ORDER)
    product(trainer, "No price", price=None)
    product(maker, "Cannot be paid")
    assert names(client, pay_online="1") == ["Ready"]
    rows = client.get(reverse("product-list"), {"pay_online": "1"}).json()["results"]
    assert all(row["buy_online"] for row in rows)

    trainer.deposit_percent = 30
    trainer.save()
    assert names(client, pay_online="1") == ["Made to order, no deposit", "Ready"]

    trainer.away_until = timezone.localdate() + timedelta(days=2)
    trainer.save()
    assert names(client, pay_online="1") == []

    settings.PAYSTACK_SECRET_KEY = ""
    assert names(client, pay_online="1") == []


@pytest.mark.django_db
def test_trainers_who_sell(client, shops, workshop):
    trainer, maker = shops
    product(trainer, "Kente shirt")
    product(trainer, "Smock")
    product(maker, "Bead bracelet")
    hidden = product(trainer, "Draft")
    hidden.status = Product.Status.DRAFT
    hidden.save()

    response = client.get(reverse("sellers-trainers"))
    assert response.status_code == 200
    rows = response.json()["results"]
    assert [row["business_name"] for row in rows] == ["Adenta Tailoring"]
    assert rows[0]["product_count"] == 2
    assert rows[0]["workshop"]["slug"] == workshop.slug


@pytest.mark.django_db
def test_a_workshop_shop_with_nothing_on_show_is_not_listed(client, shops):
    trainer, _ = shops
    draft = product(trainer, "Draft")
    draft.status = Product.Status.DRAFT
    draft.save()
    assert client.get(reverse("sellers-trainers")).json()["results"] == []


def review(seller, rating, shown=True):
    from marketplace.models import SellerReview

    return SellerReview.objects.create(
        seller=seller,
        product_name="Something",
        rating=rating,
        visibility=SellerReview.Visibility.SHOWN if shown else SellerReview.Visibility.HIDDEN,
    )


@pytest.mark.django_db
def test_rating_filter_and_best_rated_sort(client, shops, django_user_model, area):
    trainer, maker = shops
    unrated = shop(django_user_model, area, "New Shop", "+233201110803")
    product(trainer, "Kente shirt")
    product(maker, "Bead bracelet")
    product(unrated, "Fresh soap")
    for rating in (5, 4):
        review(trainer, rating)  # 4.5 from two
    review(maker, 5)  # 5.0 from one
    review(maker, 1, shown=False)  # hidden: does not count

    assert names(client, min_rating="4.5") == ["Bead bracelet", "Kente shirt"]
    assert names(client, min_rating="4.8") == ["Bead bracelet"]
    rows = client.get(reverse("product-list"), {"sort": "rating"}).json()["results"]
    assert [row["name"] for row in rows] == ["Bead bracelet", "Kente shirt", "Fresh soap"]


@pytest.mark.django_db
def test_second_hand_filter(client, shops):
    trainer, _ = shops
    product(trainer, "New scissors")
    product(trainer, "Used sewing machine", condition=Product.Condition.USED)
    assert names(client, condition="used") == ["Used sewing machine"]
    assert names(client, condition="new") == ["New scissors"]
    row = client.get(reverse("product-list"), {"condition": "used"}).json()["results"][0]
    assert row["condition"] == "used"


@pytest.mark.django_db
def test_a_workshop_shop_offers_pickup_at_the_workshop(client, shops, workshop):
    trainer, maker = shops
    workshop.address = "Behind Adenta Barrier"
    workshop.directions = "Blue gate after the church"
    workshop.save()
    theirs = product(trainer, "Kente shirt")
    other = product(maker, "Bead bracelet")
    pickup = client.get(reverse("product-detail", args=[theirs.pk])).json()["pickup"]
    assert pickup["address"] == "Behind Adenta Barrier"
    assert pickup["directions"] == "Blue gate after the church"
    assert pickup["workshop_path"] == f"/adenta/{workshop.slug}"
    assert round(pickup["lat"], 3) == 5.604
    assert client.get(reverse("product-detail", args=[other.pk])).json()["pickup"] is None


@pytest.mark.django_db
def test_saved_searches_text_new_matches_once(client, shops, monkeypatch, settings):
    from accounts.models import CustomerAccount
    from marketplace import alerts
    from marketplace.models import SavedSearch

    settings.PUBLIC_SITE_URL = "https://skills.example"
    sent = []
    monkeypatch.setattr(alerts, "send_sms", lambda to, message: sent.append((str(to), message)))
    trainer, maker = shops
    buyer = CustomerAccount.objects.create(
        user=trainer.user.__class__.objects.create_user("buyer-kofi"),
        phone="+233201112233",
        phone_verified_at=timezone.now(),
    )
    client.force_login(buyer.user)

    refused = client.post(
        reverse("account-searches"), {"params": {"page": "2"}}, content_type="application/json"
    )
    assert refused.status_code == 400
    made = client.post(
        reverse("account-searches"),
        {
            "params": {"q": "machine", "max_price": "500", "junk": "x"},
            "label": "Machines under 500",
        },
        content_type="application/json",
    )
    assert made.status_code == 201
    assert made.json()["params"] == {"q": "machine", "max_price": "500"}
    again = client.post(
        reverse("account-searches"),
        {"params": {"q": "machine", "max_price": "500"}},
        content_type="application/json",
    )
    assert again.json()["id"] == made.json()["id"]

    search = SavedSearch.objects.get()
    search.checked_at = timezone.now() - timedelta(days=1)
    search.save()
    product(maker, "Sewing machine", price="450.00")
    product(maker, "Grinding machine", price="900.00")  # too dear
    product(maker, "Scissors", price="20.00")  # does not match
    Product.objects.update(published_at=timezone.now())

    assert alerts.tell_saved_searches() == 1
    assert len(sent) == 1
    assert sent[0][0] == "+233201112233"
    assert '1 new match for "Machines under 500"' in sent[0][1]
    assert "/marketplace?q=machine&max_price=500" in sent[0][1]
    # Nothing new, or too soon: no second text.
    assert alerts.tell_saved_searches() == 0

    listed = client.get(reverse("account-searches")).json()["results"]
    assert [row["label"] for row in listed] == ["Machines under 500"]
    client.delete(reverse("account-search", args=[listed[0]["id"]]))
    assert not SavedSearch.objects.exists()


@pytest.mark.django_db
def test_a_workshops_own_students_get_its_student_price(client, shops, workshop):
    from courses.models import CoursePurchase
    from trainees.auth import account_for_verified_phone

    trainer, _ = shops
    trainer.student_discount_percent = 20
    trainer.save()
    kit = product(trainer, "Tailoring kit", price="200.00")
    body = {"items": [{"product": kit.pk, "quantity": 1}], "fulfilment": "pickup"}
    url = reverse("shop-price", args=[trainer.pk])

    stranger = client.post(url, body, content_type="application/json").json()
    assert stranger["total"] == "200.00"
    assert stranger["student"] is False

    trainee = account_for_verified_phone(phone="+233241110000", verified_at=timezone.now())
    client.force_login(trainee.user)
    assert client.post(url, body, content_type="application/json").json()["student"] is False

    CoursePurchase.objects.create(
        reference="fc-test", provider=workshop, trainee=trainee, amount_pesewas=5000, status="paid"
    )
    student = client.post(url, body, content_type="application/json").json()
    assert student["student"] is True
    assert student["discount"] == "40.00"
    assert student["total"] == "160.00"

    # A code worth more wins; they do not stack.
    trainer.codes.create(code="HALF", percent=50)
    coded = client.post(url, {**body, "code": "HALF"}, content_type="application/json").json()
    assert coded["discount"] == "100.00"
    assert coded["student"] is False

    card = client.get(reverse("product-detail", args=[kit.pk])).json()["seller"]
    assert card["student_discount"] == 20
