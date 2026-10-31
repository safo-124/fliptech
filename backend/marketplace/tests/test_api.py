"""Signing in as a seller, running your own shelf, and what a buyer can see.

The questions worth holding down are about reach: whether a code for one area
opens another, whether one seller can touch another's products, and whether
anything invisible leaks into a public response.
"""

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from enquiries import otp
from enquiries.models import PhoneVerification
from geography.models import Area, Region
from marketplace.models import Product, SellerAccount
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PHONE = "+233201110321"


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
    monkeypatch.setattr(otp, "_generate_code", lambda: "135791")
    return box


def sign_in(client, phone=PHONE):
    request = client.post(
        reverse("seller-otp-request"), {"phone": phone}, content_type="application/json"
    )
    challenge = request.json()["challenge_id"]
    return client.post(
        reverse("seller-otp-verify"),
        {"challenge_id": challenge, "phone": phone, "code": "135791"},
        content_type="application/json",
    )


def confirm(account):
    account.approval_status = SellerAccount.Approval.CONFIRMED
    account.save(update_fields=["approval_status"])
    return account


def ready_seller(client, area, sent, phone=PHONE, name="Ama Crafts"):
    """Signed in, shop filled in, confirmed. The ordinary starting point."""
    sign_in(client, phone)
    account = SellerAccount.objects.get(phone=phone)
    account.business_name = name
    account.area = area
    account.save(update_fields=["business_name", "area"])
    return confirm(account)


# --------------------------------------------------------------------------
# Signing in


@pytest.mark.django_db
def test_a_verified_number_gets_an_account(client, sent):
    response = sign_in(client)

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert SellerAccount.objects.filter(phone=PHONE).exists()


@pytest.mark.django_db
def test_the_new_account_is_not_yet_allowed_to_sell(client, sent):
    """Three things stand between signing in and a public product: the shop
    name, the place, and a member of staff."""
    body = sign_in(client).json()

    assert body["seller"]["may_sell"] is False
    assert set(body["seller"]["ready_to_sell"]) == {"business_name", "area"}
    assert body["seller"]["approval_status"] == "pending"


@pytest.mark.django_db
def test_a_trainer_code_does_not_open_a_shop(client, sent):
    """Purpose isolation. A code issued to sign in to a workshop must not be
    replayable against the marketplace."""
    from enquiries.otp import request_code

    challenge = request_code(PHONE, purpose=PhoneVerification.Purpose.TRAINER_ACCESS)

    response = client.post(
        reverse("seller-otp-verify"),
        {"challenge_id": str(challenge.challenge_id), "phone": PHONE, "code": "135791"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert not SellerAccount.objects.filter(phone=PHONE).exists()


@pytest.mark.django_db
def test_a_declined_seller_cannot_sign_in(client, sent):
    sign_in(client)
    account = SellerAccount.objects.get(phone=PHONE)
    account.approval_status = SellerAccount.Approval.DECLINED
    account.save(update_fields=["approval_status"])
    client.logout()

    response = sign_in(client)

    assert response.status_code == 403


@pytest.mark.django_db
def test_signing_in_again_reuses_the_account(client, sent):
    sign_in(client)
    client.logout()

    sign_in(client)

    assert SellerAccount.objects.filter(phone=PHONE).count() == 1


# --------------------------------------------------------------------------
# A trainer who also sells


@pytest.mark.django_db
def test_a_trainer_can_start_selling_without_a_second_code(client, area, db):
    """Their number was verified to get into this session. Asking again would
    be theatre — and on a paused SMS gateway, theatre somebody relays by hand."""
    from providers.trainer_auth import account_for_verified_phone as trainer_for_phone

    trainer = trainer_for_phone(phone="+233201110777", verified_at=timezone.now())
    provider = Provider.objects.create(
        name="VIS Leather and Silk",
        slug="vis-leather",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )
    from providers.models import ProviderMembership

    ProviderMembership.objects.create(
        provider=provider, trainer=trainer, role=ProviderMembership.Role.OWNER
    )
    client.force_login(trainer.user)

    response = client.post(reverse("trainer-start-selling"))

    assert response.status_code == 200
    account = SellerAccount.objects.get(phone="+233201110777")
    assert account.user == trainer.user
    assert account.provider == provider
    # Prefilled from the workshop: for a workshop, that is what the shop is.
    assert account.business_name == "VIS Leather and Silk"
    assert account.area == area


@pytest.mark.django_db
def test_starting_to_sell_twice_is_not_an_error(client, area, db):
    from providers.trainer_auth import account_for_verified_phone as trainer_for_phone

    trainer = trainer_for_phone(phone="+233201110778", verified_at=timezone.now())
    client.force_login(trainer.user)

    client.post(reverse("trainer-start-selling"))
    second = client.post(reverse("trainer-start-selling"))

    assert second.status_code == 200
    assert SellerAccount.objects.filter(phone="+233201110778").count() == 1


@pytest.mark.django_db
def test_a_trainer_is_not_automatically_a_confirmed_seller(client, area, db):
    """Staff approved a workshop that teaches. Whether it should sell goods is
    a different question, and nobody has been asked it yet."""
    from providers.trainer_auth import account_for_verified_phone as trainer_for_phone

    trainer = trainer_for_phone(phone="+233201110779", verified_at=timezone.now())
    trainer.approval_status = trainer.Approval.CONFIRMED
    trainer.save(update_fields=["approval_status"])
    client.force_login(trainer.user)

    client.post(reverse("trainer-start-selling"))

    assert SellerAccount.objects.get(phone="+233201110779").is_confirmed is False


@pytest.mark.django_db
def test_somebody_with_no_trainer_account_cannot_use_that_door(client, db, django_user_model):
    client.force_login(django_user_model.objects.create_user("nobody"))

    assert client.post(reverse("trainer-start-selling")).status_code == 403


# --------------------------------------------------------------------------
# The seller's own shelf


@pytest.mark.django_db
def test_a_new_product_starts_as_a_draft(client, area, sent):
    """Publishing is its own call, so no client creates something live by
    sending one request."""
    ready_seller(client, area, sent)

    response = client.post(
        reverse("seller-products"),
        {"name": "Handmade Ankara Bag", "price": "200.00"},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["status"] == "draft"


@pytest.mark.django_db
def test_publishing_makes_it_visible(client, area, sent):
    ready_seller(client, area, sent)
    created = client.post(
        reverse("seller-products"), {"name": "Bag"}, content_type="application/json"
    ).json()

    response = client.post(reverse("seller-product-publish", args=[created["id"]]))

    assert response.status_code == 200
    assert response.json()["visible"] is True
    assert Product.objects.visible().count() == 1


@pytest.mark.django_db
def test_an_unconfirmed_seller_is_told_why_publishing_is_refused(client, area, sent):
    sign_in(client)
    account = SellerAccount.objects.get(phone=PHONE)
    account.business_name = "Ama Crafts"
    account.area = area
    account.save(update_fields=["business_name", "area"])
    created = client.post(
        reverse("seller-products"), {"name": "Bag"}, content_type="application/json"
    ).json()

    response = client.post(reverse("seller-product-publish", args=[created["id"]]))

    assert response.status_code == 403
    assert "still being checked" in response.json()["detail"]


@pytest.mark.django_db
def test_an_empty_shop_is_told_to_fill_itself_in_first(client, area, sent):
    """A different refusal from the one above, because it is the seller's own
    work to fix rather than a wait."""
    sign_in(client)
    confirm(SellerAccount.objects.get(phone=PHONE))
    created = client.post(
        reverse("seller-products"), {"name": "Bag"}, content_type="application/json"
    ).json()

    response = client.post(reverse("seller-product-publish", args=[created["id"]]))

    assert response.status_code == 403
    assert "shop name" in response.json()["detail"]


@pytest.mark.django_db
def test_withdrawing_returns_a_product_to_draft(client, area, sent):
    ready_seller(client, area, sent)
    created = client.post(
        reverse("seller-products"), {"name": "Bag"}, content_type="application/json"
    ).json()
    client.post(reverse("seller-product-publish", args=[created["id"]]))

    response = client.delete(reverse("seller-product-publish", args=[created["id"]]))

    assert response.status_code == 200
    assert response.json()["status"] == "draft"
    assert not Product.objects.visible().exists()


@pytest.mark.django_db
def test_a_seller_cannot_put_back_what_staff_took_down(client, area, sent):
    """Otherwise a takedown is a suggestion."""
    seller = ready_seller(client, area, sent)
    product = Product.objects.create(
        seller=seller, name="Bag", slug="bag", status=Product.Status.SUSPENDED
    )

    assert client.post(reverse("seller-product-publish", args=[product.pk])).status_code == 403
    assert client.delete(reverse("seller-product-publish", args=[product.pk])).status_code == 403


@pytest.mark.django_db
def test_one_seller_cannot_touch_another_sellers_product(client, area, sent, django_user_model):
    """A 404 and not a 403: a 403 confirms the product exists."""
    other_user = django_user_model.objects.create_user("other-seller")
    other = SellerAccount.objects.create(
        user=other_user,
        phone="+233201110999",
        phone_verified_at=timezone.now(),
        business_name="Adjoa's",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    theirs = Product.objects.create(seller=other, name="Bag", slug="bag")
    ready_seller(client, area, sent)

    assert client.get(reverse("seller-product", args=[theirs.pk])).status_code == 404
    assert (
        client.patch(
            reverse("seller-product", args=[theirs.pk]),
            {"name": "Mine now"},
            content_type="application/json",
        ).status_code
        == 404
    )
    assert client.delete(reverse("seller-product", args=[theirs.pk])).status_code == 404
    theirs.refresh_from_db()
    assert theirs.name == "Bag"


@pytest.mark.django_db
def test_a_stranger_cannot_read_a_shelf(client, db):
    assert client.get(reverse("seller-products")).status_code in (401, 403)


@pytest.mark.django_db
def test_status_cannot_be_set_by_patching_the_product(client, area, sent):
    """Read-only on the serializer, so a client that sends the whole object
    back cannot publish a half-finished draft."""
    ready_seller(client, area, sent)
    created = client.post(
        reverse("seller-products"), {"name": "Bag"}, content_type="application/json"
    ).json()

    client.patch(
        reverse("seller-product", args=[created["id"]]),
        {"status": "published"},
        content_type="application/json",
    )

    assert Product.objects.get(pk=created["id"]).status == Product.Status.DRAFT


@pytest.mark.django_db
def test_two_products_with_one_name_get_different_slugs(client, area, sent):
    ready_seller(client, area, sent)

    first = client.post(
        reverse("seller-products"), {"name": "Ankara Bag"}, content_type="application/json"
    ).json()
    second = client.post(
        reverse("seller-products"), {"name": "Ankara Bag"}, content_type="application/json"
    ).json()

    assert first["slug"] == "ankara-bag"
    assert second["slug"] == "ankara-bag-2"


# --------------------------------------------------------------------------
# What a buyer sees


@pytest.mark.django_db
def test_the_public_list_shows_only_what_is_visible(client, area, sent):
    seller = ready_seller(client, area, sent)
    Product.objects.create(seller=seller, name="Live", slug="live", status=Product.Status.PUBLISHED)
    Product.objects.create(seller=seller, name="Draft", slug="draft")
    Product.objects.create(seller=seller, name="Gone", slug="gone", status=Product.Status.SUSPENDED)
    client.logout()

    body = client.get(reverse("product-list")).json()

    assert [p["name"] for p in body["results"]] == ["Live"]


@pytest.mark.django_db
def test_a_hidden_product_is_a_404_not_an_empty_page(client, area, sent):
    seller = ready_seller(client, area, sent)
    draft = Product.objects.create(seller=seller, name="Draft", slug="draft")
    client.logout()

    assert client.get(reverse("product-detail", args=[draft.pk])).status_code == 404


@pytest.mark.django_db
def test_the_public_product_never_carries_the_seller_phone(client, area, sent):
    """Printing it would route around whatever contact path is chosen, and
    hand every scraper a list of Ghanaian mobile numbers."""
    seller = ready_seller(client, area, sent)
    product = Product.objects.create(
        seller=seller, name="Bag", slug="bag", status=Product.Status.PUBLISHED
    )
    client.logout()

    body = client.get(reverse("product-detail", args=[product.pk])).json()

    assert "phone" not in body["seller"]
    assert PHONE not in str(body)


@pytest.mark.django_db
def test_sold_out_sorts_last_rather_than_hiding(client, area, sent):
    """Seeing that a maker's work goes is a reason to ask them. Hiding it
    makes a busy shop look empty."""
    seller = ready_seller(client, area, sent)
    Product.objects.create(
        seller=seller,
        name="Older but available",
        slug="older",
        status=Product.Status.PUBLISHED,
    )
    Product.objects.create(
        seller=seller,
        name="Newer but gone",
        slug="newer",
        status=Product.Status.PUBLISHED,
        availability=Product.Availability.SOLD_OUT,
    )
    client.logout()

    names = [p["name"] for p in client.get(reverse("product-list")).json()["results"]]

    assert names == ["Older but available", "Newer but gone"]


@pytest.mark.django_db
def test_browsing_can_be_filtered_by_trade_and_area(client, area, sent):
    from catalog.models import Trade

    seller = ready_seller(client, area, sent)
    tailoring = Trade.objects.create(name="Tailoring", slug="tailoring")
    Product.objects.create(
        seller=seller,
        name="Bag",
        slug="bag",
        trade=tailoring,
        status=Product.Status.PUBLISHED,
    )
    Product.objects.create(seller=seller, name="Soap", slug="soap", status=Product.Status.PUBLISHED)
    client.logout()

    by_trade = client.get(reverse("product-list"), {"trade": "tailoring"}).json()
    by_area = client.get(reverse("product-list"), {"area": "adenta"}).json()
    elsewhere = client.get(reverse("product-list"), {"area": "tema"}).json()

    assert [p["name"] for p in by_trade["results"]] == ["Bag"]
    assert len(by_area["results"]) == 2
    assert elsewhere["results"] == []


@pytest.mark.django_db
def test_a_sellers_shop_front_shows_their_visible_products(client, area, sent):
    seller = ready_seller(client, area, sent)
    Product.objects.create(seller=seller, name="Live", slug="live", status=Product.Status.PUBLISHED)
    Product.objects.create(seller=seller, name="Draft", slug="draft")
    client.logout()

    body = client.get(reverse("seller-detail", args=[seller.pk])).json()

    assert body["seller"]["business_name"] == "Ama Crafts"
    assert [p["name"] for p in body["products"]] == ["Live"]


@pytest.mark.django_db
def test_a_seller_nobody_may_see_is_a_404(client, area, sent):
    """An empty shop front would confirm the account exists."""
    sign_in(client)
    account = SellerAccount.objects.get(phone=PHONE)
    client.logout()

    assert client.get(reverse("seller-detail", args=[account.pk])).status_code == 404


@pytest.mark.django_db
def test_a_workshop_sellers_listing_is_named_on_their_shop(client, area, sent):
    """The strongest thing a buyer can be told: not an anonymous account, a
    place with an address, and here is the page."""
    seller = ready_seller(client, area, sent)
    provider = Provider.objects.create(
        name="VIS Leather and Silk",
        slug="vis-leather",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )
    seller.provider = provider
    seller.save(update_fields=["provider"])
    client.logout()

    body = client.get(reverse("seller-detail", args=[seller.pk])).json()

    assert body["seller"]["workshop"]["slug"] == "vis-leather"


# --------------------------------------------------------------------------
# The rule in Python and the rule in SQL must not drift


@pytest.mark.django_db
def test_may_sell_and_visible_agree(client, area, sent, django_user_model):
    """SellerAccount.may_sell and ProductQuerySet.visible() express the same
    rule twice. A drift between them is how something stays visible after the
    object says it should not be, so every combination is checked against
    both rather than trusting they were written together."""
    cases = [
        ("confirmed, filled in, active", True, True, True, True),
        ("not confirmed", False, True, True, False),
        ("switched off", True, False, True, False),
        ("no shop name", True, True, False, False),
    ]
    for i, (label, is_confirmed, is_active, filled, expected) in enumerate(cases):
        user = django_user_model.objects.create_user(f"seller-case-{i}")
        seller = SellerAccount.objects.create(
            user=user,
            phone=f"+23320111{i:04d}",
            phone_verified_at=timezone.now(),
            business_name="Ama Crafts" if filled else "",
            area=area,
            is_active=is_active,
            approval_status=(
                SellerAccount.Approval.CONFIRMED if is_confirmed else SellerAccount.Approval.PENDING
            ),
        )
        product = Product.objects.create(
            seller=seller, name="Bag", slug="bag", status=Product.Status.PUBLISHED
        )

        in_sql = Product.objects.visible().filter(pk=product.pk).exists()
        assert seller.may_sell is expected, label
        assert in_sql is expected, label


# --------------------------------------------------------------------------
# The seller's own enquiries, and signing out


@pytest.mark.django_db
def test_a_seller_sees_who_asked_about_their_things(client, area, sent):
    from marketplace.models import ProductEnquiry

    seller = ready_seller(client, area, sent)
    product = Product.objects.create(
        seller=seller, name="Bag", slug="bag", status=Product.Status.PUBLISHED
    )
    ProductEnquiry.objects.create(
        seller=seller,
        product=product,
        product_name=product.name,
        buyer_phone="+233201115555",
        buyer_name="Kofi",
        message="In blue?",
        phone_verified_at=timezone.now(),
    )

    body = client.get(reverse("seller-enquiries")).json()

    assert len(body["results"]) == 1
    row = body["results"][0]
    assert row["buyer_phone"] == "+233201115555"
    assert row["told"] is False
    assert row["reply_url"].startswith("https://wa.me/")


@pytest.mark.django_db
def test_spam_is_not_shown_to_the_seller(client, area, sent):
    """Staff marked it spam. Showing the seller the thing staff shielded them
    from would undo the decision."""
    from marketplace.models import ProductEnquiry

    seller = ready_seller(client, area, sent)
    product = Product.objects.create(
        seller=seller, name="Bag", slug="bag", status=Product.Status.PUBLISHED
    )
    ProductEnquiry.objects.create(
        seller=seller,
        product=product,
        product_name=product.name,
        buyer_phone="+233201115556",
        phone_verified_at=timezone.now(),
        state=ProductEnquiry.State.SPAM,
    )

    assert client.get(reverse("seller-enquiries")).json()["results"] == []


@pytest.mark.django_db
def test_one_seller_cannot_read_anothers_enquiries(client, area, sent, django_user_model):
    from marketplace.models import ProductEnquiry

    other_user = django_user_model.objects.create_user("other-enq-seller")
    other = SellerAccount.objects.create(
        user=other_user,
        phone="+233201115557",
        phone_verified_at=timezone.now(),
        business_name="Adjoa's",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    theirs = Product.objects.create(seller=other, name="Bag", slug="bag")
    ProductEnquiry.objects.create(
        seller=other,
        product=theirs,
        product_name="Bag",
        buyer_phone="+233201115558",
        phone_verified_at=timezone.now(),
    )
    ready_seller(client, area, sent)

    assert client.get(reverse("seller-enquiries")).json()["results"] == []


@pytest.mark.django_db
def test_a_stranger_cannot_read_enquiries(client, db):
    assert client.get(reverse("seller-enquiries")).status_code in (401, 403)


@pytest.mark.django_db
def test_signing_out_ends_the_session(client, area, sent):
    ready_seller(client, area, sent)
    assert client.get(reverse("seller-products")).status_code == 200

    response = client.post(reverse("seller-logout"))

    assert response.status_code == 200
    assert response.json()["authenticated"] is False
    assert client.get(reverse("seller-products")).status_code in (401, 403)


@pytest.mark.django_db
def test_a_seller_signing_in_with_a_second_number_is_refused_not_crashed(client, sent):
    """Used to be a 500: the second account broke one-account-per-login, and
    the fallback then looked for an account under the new number."""
    sign_in(client)
    other = "+233201110654"

    request = client.post(
        reverse("seller-otp-request"), {"phone": other}, content_type="application/json"
    )
    response = client.post(
        reverse("seller-otp-verify"),
        {"challenge_id": request.json()["challenge_id"], "phone": other, "code": "135791"},
        content_type="application/json",
    )

    assert response.status_code == 409
    assert "different phone number" in response.json()["detail"]
    assert list(SellerAccount.objects.values_list("phone", flat=True)) == [PHONE]
    # The code was not spent on a sign-in that could not happen.
    assert PhoneVerification.objects.filter(phone=other, verified_at__isnull=True).exists()
