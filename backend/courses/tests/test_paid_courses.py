"""Paid courses: pricing, locking, buying through Paystack, and Caddy's check."""

import hashlib
import hmac
import json
from decimal import Decimal

import pytest
from django.contrib.gis.geos import Point
from django.core.files.base import ContentFile
from django.urls import reverse
from django.utils import timezone

from courses import paystack
from courses.models import CourseOffer, CoursePurchase
from geography.models import Area, Region
from providers.models import Provider, ProviderMembership, ProviderVideo
from providers.trainer_auth import account_for_verified_phone as trainer_for_phone
from trainees.auth import account_for_verified_phone as trainee_for_phone

ACCRA = Point(-0.1870, 5.6037, srid=4326)
SECRET = "sk_test_secret"


@pytest.fixture(autouse=True)
def paystack_on(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    settings.PAYSTACK_SECRET_KEY = SECRET
    settings.PUBLIC_SITE_URL = "https://skills.example"


@pytest.fixture
def calls(monkeypatch):
    """Paystack, faked: records each call and answers as Paystack would."""

    class Calls(list):
        answers = None

    made = Calls()
    made.answers = answers = {}

    def fake(method, path, payload=None, *, query=None):
        made.append((method, path, payload, query))
        for prefix, answer in answers.items():
            if path.startswith(prefix):
                return answer(payload) if callable(answer) else answer
        return {}

    monkeypatch.setattr(paystack, "_call", fake)
    return made


@pytest.fixture
def course(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)
    provider = Provider.objects.create(
        name="Vis Hair Studio",
        slug="vis-hair-studio",
        area=area,
        location=ACCRA,
        contact_phone="+233240000601",
        status=Provider.Status.PUBLISHED,
    )
    lessons = [lesson(provider, f"Lesson {n}") for n in (1, 2, 3)]
    return provider, lessons


def lesson(provider, title):
    video = ProviderVideo.objects.create(
        provider=provider, title=title, status=ProviderVideo.Status.APPROVED, size_360=5
    )
    video.public_360.save("360.mp4", ContentFile(b"video"), save=False)
    video.public_poster.save("poster.jpg", ContentFile(b"poster"), save=False)
    video.save()
    return video


def priced(provider, price="150.00"):
    return CourseOffer.objects.create(
        provider=provider, price=Decimal(price), paystack_subaccount="ACCT_trainer"
    )


@pytest.fixture
def trainee(client):
    account = trainee_for_phone(phone="+233240000777", verified_at=timezone.now())
    return account


def as_user(client, user):
    client.force_login(user)
    return client


def course_lessons(client, provider):
    response = client.get(reverse("course-detail", args=[provider.area.slug, provider.slug]))
    assert response.status_code == 200
    return response.json()


def access(client, provider):
    return client.get(reverse("course-access", args=[provider.area.slug, provider.slug])).json()


# --------------------------------------------------------------------------
# Locking


@pytest.mark.django_db
def test_a_free_course_plays_every_lesson(client, course):
    provider, _ = course

    body = course_lessons(client, provider)

    assert body["course"]["price"] is None
    assert all(lesson["sources"] and not lesson["locked"] for lesson in body["lessons"])


@pytest.mark.django_db
def test_a_paid_course_gives_the_first_lesson_free_and_locks_the_rest(client, course):
    provider, lessons = course
    priced(provider)

    body = course_lessons(client, provider)

    assert body["course"]["price"] == "150.00"
    first, *rest = body["lessons"]
    assert first["sources"] and not first["locked"]
    assert all(lesson["locked"] and lesson["sources"] == [] for lesson in rest)
    # The still stays, so a trainee can see what they would be buying.
    assert all(lesson["poster"] for lesson in rest)


@pytest.mark.django_db
def test_the_workshop_listing_locks_the_same_lessons(client, course):
    provider, _ = course
    priced(provider)

    videos = client.get(
        reverse("provider-by-slug", args=[provider.area.slug, provider.slug])
    ).json()["videos"]

    assert [bool(video["sources"]) for video in videos] == [True, False, False]


@pytest.mark.django_db
def test_a_price_without_a_payout_account_locks_nothing(client, course):
    provider, _ = course
    CourseOffer.objects.create(provider=provider, price=Decimal("150"))

    body = course_lessons(client, provider)

    assert body["course"]["price"] is None
    assert not any(lesson["locked"] for lesson in body["lessons"])


@pytest.mark.django_db
def test_a_buyer_and_the_workshops_trainer_see_everything_and_a_stranger_does_not(
    client, course, trainee
):
    provider, lessons = course
    priced(provider)
    stranger = access(client, provider)
    assert set(stranger["sources"]) == {str(lessons[0].pk)}
    assert stranger["owned"] is False

    CoursePurchase.objects.create(
        reference="fc-paid",
        provider=provider,
        trainee=trainee,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
    )
    as_user(client, trainee.user)
    bought = access(client, provider)
    assert bought["owned"] is True
    assert set(bought["sources"]) == {str(lesson.pk) for lesson in lessons}

    trainer = trainer_for_phone(phone="+233240000601", verified_at=timezone.now())
    ProviderMembership.objects.create(
        trainer=trainer, provider=provider, role=ProviderMembership.Role.OWNER
    )
    as_user(client, trainer.user)
    assert access(client, provider)["owned"] is True


# --------------------------------------------------------------------------
# Buying


@pytest.mark.django_db
def test_buying_starts_a_paystack_payment_split_to_the_trainer(client, course, trainee, calls):
    provider, _ = course
    priced(provider)
    calls.answers["/transaction/initialize"] = {"authorization_url": "https://checkout.paystack/x"}
    as_user(client, trainee.user)

    response = client.post(reverse("course-buy", args=[provider.area.slug, provider.slug]))

    assert response.status_code == 201, response.content
    assert response.json()["authorization_url"] == "https://checkout.paystack/x"
    purchase = CoursePurchase.objects.get()
    assert (purchase.status, purchase.amount_pesewas) == (CoursePurchase.Status.PENDING, 15000)
    [(_, _, payload, _)] = calls
    assert payload["amount"] == 15000 and payload["currency"] == "GHS"
    assert payload["subaccount"] == "ACCT_trainer"
    assert payload["reference"] == purchase.reference
    assert payload["callback_url"].startswith("https://skills.example/learn/adenta/vis-hair-studio")
    # A trainee who signs in by phone still has an email Paystack accepts.
    assert payload["email"] == "233240000777@trainees.fliiptech.com"


@pytest.mark.django_db
def test_buying_needs_a_signed_in_trainee_and_a_priced_course(client, course, trainee, calls):
    provider, _ = course
    url = reverse("course-buy", args=[provider.area.slug, provider.slug])

    assert client.post(url).status_code == 401
    as_user(client, trainee.user)
    assert client.post(url).status_code == 409  # free
    assert calls == []


def _verify_answer(amount, currency="GHS", state="success"):
    return {"status": state, "amount": amount, "currency": currency, "channel": "mobile_money"}


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("answer", "owned"),
    [
        (_verify_answer(15000), True),
        (_verify_answer(100), False),  # a smaller sum unlocks nothing
        (_verify_answer(15000, currency="NGN"), False),
        (_verify_answer(15000, state="failed"), False),
    ],
)
def test_coming_back_unlocks_only_what_paystack_confirms_in_full(
    client, course, trainee, calls, answer, owned
):
    provider, _ = course
    priced(provider)
    purchase = CoursePurchase.objects.create(
        reference="fc-1", provider=provider, trainee=trainee, amount_pesewas=15000
    )
    calls.answers["/transaction/verify/"] = answer
    as_user(client, trainee.user)

    response = client.post(reverse("purchase-verify", args=[purchase.reference]))

    assert response.json()["owned"] is owned
    assert access(client, provider)["owned"] is owned


@pytest.mark.django_db
def test_nobody_can_verify_someone_elses_payment(client, course, trainee, calls):
    provider, _ = course
    priced(provider)
    CoursePurchase.objects.create(
        reference="fc-1", provider=provider, trainee=trainee, amount_pesewas=15000
    )
    other = trainee_for_phone(phone="+233240000888", verified_at=timezone.now())
    as_user(client, other.user)

    assert client.post(reverse("purchase-verify", args=["fc-1"])).status_code == 404
    assert calls == []


def _webhook(client, event, secret=SECRET):
    body = json.dumps(event).encode()
    signature = hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    return client.post(
        reverse("paystack-webhook"),
        data=body,
        content_type="application/json",
        HTTP_X_PAYSTACK_SIGNATURE=signature,
    )


@pytest.mark.django_db
def test_paystacks_signed_webhook_unlocks_a_course_once(client, course, trainee):
    provider, _ = course
    priced(provider)
    CoursePurchase.objects.create(
        reference="fc-1", provider=provider, trainee=trainee, amount_pesewas=15000
    )
    event = {"event": "charge.success", "data": {"reference": "fc-1", **_verify_answer(15000)}}

    assert _webhook(client, event, secret="sk_test_wrong").status_code == 401
    assert CoursePurchase.objects.get().status == CoursePurchase.Status.PENDING

    assert _webhook(client, event).status_code == 200
    assert _webhook(client, event).status_code == 200  # Paystack retries; still once

    purchase = CoursePurchase.objects.get()
    assert purchase.status == CoursePurchase.Status.PAID and purchase.paid_at


# --------------------------------------------------------------------------
# Caddy's check before it streams a file


@pytest.mark.django_db
def test_caddy_streams_a_locked_file_only_to_someone_who_may_watch_it(client, course, trainee):
    provider, lessons = course
    priced(provider)

    def ask(video_file):
        return client.get(
            reverse("media-access"), HTTP_X_FORWARDED_URI=f"/media/{video_file.name}"
        ).status_code

    assert ask(lessons[0].public_360) == 200  # the free preview
    assert ask(lessons[1].public_360) == 403
    assert ask(lessons[1].public_poster) == 200  # stills are never locked
    assert (
        client.get(reverse("media-access"), HTTP_X_FORWARDED_URI="/media/x.jpg").status_code == 200
    )

    CoursePurchase.objects.create(
        reference="fc-paid",
        provider=provider,
        trainee=trainee,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
    )
    as_user(client, trainee.user)
    assert ask(lessons[1].public_360) == 200


# --------------------------------------------------------------------------
# The trainer's side


@pytest.fixture
def owner(client, course):
    provider, _ = course
    trainer = trainer_for_phone(phone="+233240000601", verified_at=timezone.now())
    ProviderMembership.objects.create(
        trainer=trainer, provider=provider, role=ProviderMembership.Role.OWNER
    )
    return as_user(client, trainer.user)


BANKS = [{"code": "MTN", "name": "MTN Mobile Money", "active": True}]


@pytest.mark.django_db
def test_a_trainer_saves_a_payout_account_then_sets_a_price(owner, course, calls):
    provider, _ = course
    calls.answers["/bank"] = BANKS
    calls.answers["/subaccount"] = {"subaccount_code": "ACCT_new"}

    refused = owner.patch(
        reverse("trainer-course"), {"price": "150"}, content_type="application/json"
    )
    assert refused.status_code == 409  # nowhere to send the money yet

    saved = owner.put(
        reverse("trainer-course-payout"),
        {"bank_code": "MTN", "account_number": "024 000 0601", "account_name": "Vida Mensah"},
        content_type="application/json",
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["payout"] == {
        "ready": True,
        "bank_code": "MTN",
        "bank_name": "MTN Mobile Money",
        "account_last4": "0601",
        "account_name": "Vida Mensah",
    }
    subaccount = [payload for method, path, payload, _ in calls if path == "/subaccount"][0]
    assert subaccount["percentage_charge"] == 0  # Fliiptech takes nothing
    assert subaccount["account_number"] == "0240000601"

    priced_now = owner.patch(
        reverse("trainer-course"), {"price": "150"}, content_type="application/json"
    )
    assert priced_now.json()["price"] == "150.00"
    assert CourseOffer.objects.get(provider=provider).is_paid


@pytest.mark.django_db
@pytest.mark.parametrize("price", ["0.50", "200000", "lots"])
def test_a_price_has_to_be_sensible(owner, course, price):
    provider, _ = course
    CourseOffer.objects.create(provider=provider, paystack_subaccount="ACCT_x")

    response = owner.patch(
        reverse("trainer-course"), {"price": price}, content_type="application/json"
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_without_paystack_keys_nothing_can_be_priced(owner, course, settings):
    provider, _ = course
    settings.PAYSTACK_SECRET_KEY = ""
    CourseOffer.objects.create(provider=provider, paystack_subaccount="ACCT_x")

    assert owner.get(reverse("trainer-course")).json()["payments_enabled"] is False
    response = owner.patch(
        reverse("trainer-course"), {"price": "150"}, content_type="application/json"
    )
    assert response.status_code == 409


@pytest.mark.django_db
def test_making_a_course_free_again_unlocks_it(owner, course, client):
    provider, _ = course
    priced(provider)

    owner.patch(reverse("trainer-course"), {"price": ""}, content_type="application/json")
    client.logout()

    assert not any(lesson["locked"] for lesson in course_lessons(client, provider)["lessons"])
