"""Online learning beyond watching and paying: progress, certificates, reviews,
questions, the trainer's studio, promo codes, featuring, search, captions
and streaming copies."""

import hashlib
import hmac
import json
import shutil
import subprocess
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files import File
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from courses import learner, studio
from courses.learner import course_title
from courses.models import (
    Certificate,
    CourseBoost,
    CourseOffer,
    CoursePromoCode,
    CoursePurchase,
    LessonPlayDay,
    LessonProgress,
)
from courses.tests.test_paid_courses import SECRET, as_user, lesson, priced
from providers import video_hls
from providers.models import ProviderMembership, ProviderVideo
from providers.trainer_auth import account_for_verified_phone as trainer_for_phone
from providers.videos import decide
from trainees.auth import account_for_verified_phone as trainee_for_phone

LEARNER = "+233240000777"
TRAINER = "+233240000601"


@pytest.fixture
def texts(monkeypatch):
    sent = []

    def record(to, message):
        sent.append((str(to), message))
        return True

    monkeypatch.setattr(learner, "send_sms", record)
    monkeypatch.setattr(studio, "send_sms", record)
    return sent


@pytest.fixture
def trainee(db):
    account = trainee_for_phone(phone=LEARNER, verified_at=timezone.now())
    account.display_name = "Ama Owusu"
    account.save()
    return account


@pytest.fixture
def learner_client(client, trainee):
    return as_user(client, trainee.user)


@pytest.fixture
def trainer_client(django_user_model, course):
    from django.test import Client

    provider, _ = course
    trainer = trainer_for_phone(phone=TRAINER, verified_at=timezone.now())
    ProviderMembership.objects.create(
        trainer=trainer, provider=provider, role=ProviderMembership.Role.OWNER
    )
    other = Client()
    other.force_login(trainer.user)
    return other


def progress(client, video, position, **extra):
    return client.post(
        reverse("lesson-progress", args=[video.pk]),
        {"position": position, **extra},
        content_type="application/json",
    )


def watch(client, video, upto=None, start=0, step=20):
    """Play a lesson for real: report the played ranges a few seconds apart,
    as the player does (time is moved on between reports)."""
    from datetime import timedelta

    from django.utils import timezone

    end = upto if upto is not None else (video.duration_seconds or 100)
    position, body = start, None
    while position < end:
        reached = min(end, position + step)
        LessonProgress.objects.filter(video=video).update(
            updated_at=timezone.now() - timedelta(seconds=60)
        )
        body = progress(client, video, reached, watched=[[position, reached]]).json()
        position = reached
    return body


def with_length(videos, seconds=100):
    for video in videos:
        video.duration_seconds = seconds
        video.save(update_fields=["duration_seconds"])


def access(client, provider):
    return client.get(reverse("course-access", args=[provider.area.slug, provider.slug])).json()


def detail(client, provider):
    return client.get(reverse("course-detail", args=[provider.area.slug, provider.slug])).json()


# --------------------------------------------------------------------------
# Progress and certificates


@pytest.mark.django_db
def test_progress_needs_a_trainee_sign_in(client, course):
    _, lessons = course
    response = progress(client, lessons[0], 10)
    assert response.status_code == 401
    assert response.json()["sign_in"] is True


@pytest.mark.django_db
def test_a_lesson_is_finished_at_ninety_percent_and_rewinding_keeps_it(learner_client, course):
    _, lessons = course
    with_length(lessons)

    half = watch(learner_client, lessons[0], upto=50)
    assert half["lesson"]["completed"] is False
    assert half["lesson"]["watched_seconds"] == 50

    done = watch(learner_client, lessons[0], start=50, upto=90)
    assert done["lesson"]["completed"] is True
    assert done["course"]["done"] == 1
    assert done["course"]["needs_name"] is False

    rewound = progress(learner_client, lessons[0], 5).json()
    assert rewound["lesson"]["completed"] is True
    assert rewound["lesson"]["position"] == 5


@pytest.mark.django_db
def test_seeking_to_the_end_does_not_finish_a_lesson(learner_client, course):
    _, lessons = course
    with_length(lessons)

    # Jumped to the end: the position moves, nothing was played.
    jumped = progress(learner_client, lessons[0], 100).json()
    assert jumped["lesson"]["completed"] is False
    # A client claiming the whole lesson at once is refused: no time has passed.
    claimed = progress(learner_client, lessons[0], 100, watched=[[0, 100]]).json()
    assert claimed["lesson"]["accepted"] is False
    assert claimed["lesson"]["completed"] is False
    # Ranges past the end of the video are cut to it.
    watch(learner_client, lessons[0], upto=80)
    late = progress(learner_client, lessons[0], 100, watched=[[80, 500]]).json()
    assert late["lesson"]["watched_seconds"] == 100


@pytest.mark.django_db
def test_watched_ranges_are_merged_not_double_counted(learner_client, course):
    _, lessons = course
    with_length(lessons)
    watch(learner_client, lessons[0], upto=40)
    again = watch(learner_client, lessons[0], start=0, upto=40)  # the same part twice
    assert again["lesson"]["watched_seconds"] == 40
    assert LessonProgress.objects.get(video=lessons[0]).watched == [[0, 40]]


@pytest.mark.django_db
def test_a_locked_lesson_takes_no_progress_until_bought(learner_client, course):
    provider, lessons = course
    priced(provider)
    assert progress(learner_client, lessons[1], 5).status_code == 404
    assert progress(learner_client, lessons[0], 5).status_code == 200  # the free preview


@pytest.mark.django_db
def test_finishing_every_lesson_issues_a_certificate_anyone_can_check(
    learner_client, client, course
):
    provider, lessons = course
    with_length(lessons)
    for video in lessons:
        last = watch(learner_client, video)

    # Finished: the learner confirms the name to print first.
    assert last["course"]["finished"] is True
    assert last["course"]["needs_name"] is True
    assert last["course"]["certificate"] is None
    url = reverse("course-certificate", args=[provider.area.slug, provider.slug])
    issued = learner_client.post(url, {"name": "Ama Owusu"}, content_type="application/json")
    assert issued.status_code == 201, issued.content
    certificate = issued.json()
    assert certificate["trainee_name"] == "Ama Owusu"
    assert certificate["course_name"] == course_title(provider)
    assert certificate["lessons"] == 3
    assert certificate["total_seconds"] == 300

    from django.test import Client

    checked = Client().get(reverse("certificate-check", args=[certificate["code"].lower()]))
    assert checked.status_code == 200
    assert checked.json()["course_path"] == f"/learn/{provider.area.slug}/{provider.slug}"
    # Asking again gives the same one.
    again = learner_client.post(url)
    assert again.json()["code"] == certificate["code"]
    assert Certificate.objects.count() == 1


@pytest.mark.django_db
def test_the_certificate_name_must_be_a_full_real_name(learner_client, trainee, course):
    provider, lessons = course
    trainee.display_name = ""
    trainee.save()
    for video in lessons:
        body = watch(learner_client, video)
    assert body["course"]["needs_name"] is True

    url = reverse("course-certificate", args=[provider.area.slug, provider.slug])
    for refused in ("Kofi", "yes", "test test", ""):
        answer = learner_client.post(url, {"name": refused}, content_type="application/json")
        assert answer.status_code == 400, refused
    issued = learner_client.post(url, {"name": "Kofi  Mensah"}, content_type="application/json")
    assert issued.status_code == 201
    assert issued.json()["trainee_name"] == "Kofi Mensah"
    trainee.refresh_from_db()
    assert trainee.display_name == "Kofi Mensah"


@pytest.mark.django_db
def test_the_workshops_own_trainer_previews_but_gets_no_certificate(
    learner_client, trainee, course
):
    from providers.models import ProviderMembership, TrainerAccount

    provider, lessons = course
    owner = TrainerAccount.objects.create(user=trainee.user, phone="+233201119999")
    ProviderMembership.objects.filter(provider=provider).delete()
    ProviderMembership.objects.create(trainer=owner, provider=provider)
    for video in lessons:
        body = watch(learner_client, video)
    assert body["course"]["finished"] is True
    assert body["course"]["own_course"] is True
    assert body["course"]["needs_name"] is False

    url = reverse("course-certificate", args=[provider.area.slug, provider.slug])
    refused = learner_client.post(url, {"name": "Ama Owusu"}, content_type="application/json")
    assert refused.status_code == 403
    assert Certificate.objects.count() == 0


@pytest.mark.django_db
def test_no_certificate_before_every_lesson_is_finished(learner_client, course):
    provider, lessons = course
    watch(learner_client, lessons[0])
    url = reverse("course-certificate", args=[provider.area.slug, provider.slug])
    assert learner_client.post(url).status_code == 409


@pytest.mark.django_db
def test_my_courses_is_empty_not_an_error_for_a_stranger(client):
    assert client.get(reverse("my-courses")).json() == {"results": [], "signed_in": False}


@pytest.mark.django_db
def test_my_courses_says_how_far_and_where_to_carry_on(learner_client, course):
    provider, lessons = course
    with_length(lessons)
    watch(learner_client, lessons[0])
    progress(learner_client, lessons[1], 40)

    mine = learner_client.get(reverse("my-courses")).json()["results"]
    assert len(mine) == 1
    row = mine[0]
    assert row["course"]["slug"] == provider.slug
    assert (row["done"], row["total"]) == (1, 3)
    assert row["resume"] == {
        "id": lessons[1].pk,
        "title": lessons[1].title,
        "position": 40,
        "duration_seconds": 100,
    }


@pytest.mark.django_db
def test_the_course_page_gets_this_learners_progress(learner_client, course):
    provider, lessons = course
    watch(learner_client, lessons[0])
    state = access(learner_client, provider)
    assert state["progress"][str(lessons[0].pk)]["completed"] is True
    assert state["can_review"] is True
    assert state["certificate"] is None


# --------------------------------------------------------------------------
# Reviews and questions


@pytest.mark.django_db
def test_only_someone_who_finished_a_lesson_may_review(learner_client, client, course):
    provider, lessons = course
    url = reverse("course-reviews", args=[provider.area.slug, provider.slug])
    refused = learner_client.post(url, {"rating": 5}, content_type="application/json")
    assert refused.status_code == 403

    watch(learner_client, lessons[0])
    made = learner_client.post(
        url, {"rating": 4, "body": "Clear steps."}, content_type="application/json"
    )
    assert made.status_code == 201
    changed = learner_client.post(url, {"rating": 5}, content_type="application/json")
    assert changed.status_code == 200

    listed = client.get(url).json()
    assert listed["summary"]["average"] == 5.0
    assert listed["summary"]["count"] == 1
    assert listed["results"][0]["name"] == "Ama"  # first name only
    card = client.get(reverse("course-list")).json()["results"][0]
    assert (card["rating"], card["reviews"]) == (5.0, 1)


@pytest.mark.django_db
def test_a_paid_course_is_reviewed_only_by_buyers(learner_client, trainee, course):
    provider, lessons = course
    priced(provider)
    watch(learner_client, lessons[0])  # the free preview
    url = reverse("course-reviews", args=[provider.area.slug, provider.slug])
    assert (
        learner_client.post(url, {"rating": 5}, content_type="application/json").status_code == 403
    )

    CoursePurchase.objects.create(
        reference="fc-paid",
        provider=provider,
        trainee=trainee,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
    )
    assert (
        learner_client.post(url, {"rating": 5}, content_type="application/json").status_code == 201
    )


@pytest.mark.django_db
def test_a_question_texts_the_trainer_and_the_answer_texts_the_learner(
    learner_client, trainer_client, course, texts, django_capture_on_commit_callbacks
):
    provider, lessons = course
    url = reverse("lesson-questions", args=[lessons[0].pk])
    with django_capture_on_commit_callbacks(execute=True):
        asked = learner_client.post(
            url,
            {"body": "Which comb do you use?", "at_seconds": 72},
            content_type="application/json",
        )
    assert asked.status_code == 201
    assert any(to == TRAINER and "Which comb" in message for to, message in texts)

    inbox = trainer_client.get(reverse("studio-questions")).json()["questions"]
    assert inbox[0]["at_seconds"] == 72
    with django_capture_on_commit_callbacks(execute=True):
        answered = trainer_client.post(
            reverse("studio-answer", args=[inbox[0]["id"]]),
            {"answer": "A wide-tooth comb."},
            content_type="application/json",
        )
    assert answered.status_code == 200
    assert any(to == LEARNER and "wide-tooth" in message for to, message in texts)

    public = learner_client.get(url).json()
    assert public["results"][0]["answer"] == "A wide-tooth comb."
    assert public["mine"] == [inbox[0]["id"]]


@pytest.mark.django_db
def test_no_questions_on_a_locked_lesson(learner_client, course):
    provider, lessons = course
    priced(provider)
    response = learner_client.post(
        reverse("lesson-questions", args=[lessons[2].pk]),
        {"body": "Can I see this?"},
        content_type="application/json",
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------
# The studio


@pytest.mark.django_db
def test_the_trainer_orders_lessons_into_sections_and_the_free_preview_follows(
    trainer_client, client, course
):
    provider, lessons = course
    priced(provider)
    a, b, c = lessons
    response = trainer_client.put(
        reverse("studio-lessons"),
        {
            "lessons": [
                {"id": c.pk, "section": "Getting started"},
                {"id": a.pk, "section": "Getting started"},
                {"id": b.pk, "section": "  Finishing   off "},
            ]
        },
        content_type="application/json",
    )
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["lessons"]] == [c.pk, a.pk, b.pk]

    body = detail(client, provider)
    assert [row["id"] for row in body["lessons"]] == [c.pk, a.pk, b.pk]
    assert [row["section"] for row in body["lessons"]] == [
        "Getting started",
        "Getting started",
        "Finishing off",
    ]
    # The free lesson is the first one in the trainer's order.
    assert [row["locked"] for row in body["lessons"]] == [False, True, True]


@pytest.mark.django_db
def test_a_trainer_cannot_order_another_workshops_lesson(trainer_client, course):
    from providers.models import Provider

    provider, _ = course
    other = Provider.objects.create(
        name="Other", slug="other", area=provider.area, location=provider.location
    )
    stranger = lesson(other, "Not yours")
    response = trainer_client.put(
        reverse("studio-lessons"),
        {"lessons": [{"id": stranger.pk}]},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert (
        trainer_client.patch(
            reverse("studio-lesson", args=[stranger.pk]),
            {"description": "x"},
            content_type="application/json",
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_course_details_show_on_the_course_page(trainer_client, client, course):
    provider, lessons = course
    saved = trainer_client.patch(
        reverse("studio-details"),
        {
            "summary": "Braids from start to finish.",
            "outcomes": "- Part the hair\n• Feed in extensions\n\n",
            "tools": "Rat-tail comb",
            "level": "beginner",
        },
        content_type="application/json",
    )
    assert saved.status_code == 200
    trainer_client.patch(
        reverse("studio-lesson", args=[lessons[0].pk]),
        {"description": "What you will need."},
        content_type="application/json",
    )
    body = detail(client, provider)
    assert body["details"]["outcomes"] == ["Part the hair", "Feed in extensions"]
    assert body["details"]["tools"] == ["Rat-tail comb"]
    assert body["course"]["level"] == "beginner"
    assert body["lessons"][0]["description"] == "What you will need."


@pytest.mark.django_db
def test_a_launch_price_shows_until_it_ends(trainer_client, client, course):
    provider, _ = course
    priced(provider)
    too_high = trainer_client.patch(
        reverse("studio-details"), {"sale_price": "200"}, content_type="application/json"
    )
    assert too_high.status_code == 400
    trainer_client.patch(
        reverse("studio-details"),
        {
            "sale_price": "99",
            "sale_ends_at": (timezone.localdate() + timedelta(days=3)).isoformat(),
        },
        content_type="application/json",
    )
    card = detail(client, provider)["course"]
    assert (card["price"], card["full_price"]) == ("99.00", "150.00")

    CourseOffer.objects.filter(provider=provider).update(
        sale_ends_at=timezone.now() - timedelta(minutes=1)
    )
    card = detail(client, provider)["course"]
    assert (card["price"], card["full_price"]) == ("150.00", None)


@pytest.mark.django_db
def test_a_promo_code_lowers_the_price_and_counts_once_paid(
    trainer_client, learner_client, course, calls
):
    provider, _ = course
    priced(provider)
    made = trainer_client.post(
        reverse("studio-codes"),
        {"code": "launch-20", "percent_off": 20},
        content_type="application/json",
    )
    assert made.status_code == 201
    assert made.json()["code"] == "LAUNCH20"

    checked = learner_client.post(
        reverse("course-code", args=[provider.area.slug, provider.slug]),
        {"code": "launch20"},
        content_type="application/json",
    ).json()
    assert (checked["price"], checked["was"]) == ("120.00", "150.00")

    calls.answers["/transaction/initialize"] = {"authorization_url": "https://pay.example"}
    bought = learner_client.post(
        reverse("course-buy", args=[provider.area.slug, provider.slug]),
        {"code": "LAUNCH20"},
        content_type="application/json",
    )
    assert bought.status_code == 201
    purchase = CoursePurchase.objects.get()
    assert (purchase.amount_pesewas, purchase.full_price_pesewas) == (12000, 15000)
    assert calls[-1][2]["amount"] == 12000

    from courses.views import confirm

    confirm(purchase.reference, {"status": "success", "amount": 12000, "currency": "GHS"})
    assert CoursePromoCode.objects.get().uses == 1

    bad = learner_client.post(
        reverse("course-code", args=[provider.area.slug, provider.slug]),
        {"code": "NOPE"},
        content_type="application/json",
    )
    assert bad.status_code == 400


@pytest.mark.django_db
def test_plays_are_counted_and_the_studio_shows_where_learners_stop(
    client, learner_client, trainer_client, course
):
    _, lessons = course
    with_length(lessons)
    for _ in range(3):
        assert client.post(reverse("lesson-play", args=[lessons[0].pk])).status_code == 204
    client.post(reverse("lesson-play", args=[lessons[1].pk]))
    watch(learner_client, lessons[0])
    progress(learner_client, lessons[1], 10)

    stats = trainer_client.get(reverse("studio-stats")).json()
    assert stats["totals"]["plays"] == 4
    assert stats["totals"]["learners"] == 1
    assert stats["daily"][-1]["plays"] == 4
    assert len(stats["daily"]) == 30
    first, second, third = stats["lessons"]
    assert (first["plays"], first["started"], first["finished"]) == (3, 1, 1)
    assert (second["plays"], second["started"], second["finished"]) == (1, 1, 0)
    assert third["started"] == 0
    assert LessonPlayDay.objects.count() == 2


@pytest.mark.django_db
def test_captions_from_an_srt_play_behind_the_lessons_lock(trainer_client, client, course):
    provider, lessons = course
    priced(provider)
    srt = "1\r\n00:00:01,000 --> 00:00:04,500\r\n<b>Part</b> the hair\r\n"
    saved = trainer_client.put(
        reverse("studio-captions", args=[lessons[2].pk, "en"]),
        {"text": srt},
        content_type="application/json",
    )
    assert saved.status_code == 200
    assert saved.json()["captions"][0]["label"] == "English"

    url = reverse("lesson-captions", args=[lessons[2].pk, "en"])
    assert client.get(url).status_code == 403  # a locked lesson's words stay locked
    trainer_client_view = trainer_client.get(url)
    assert trainer_client_view.status_code == 200
    text = trainer_client_view.content.decode()
    assert text.startswith("WEBVTT")
    assert "00:00:01.000 --> 00:00:04.500" in text
    assert "<b>" not in text

    junk = trainer_client.put(
        reverse("studio-captions", args=[lessons[2].pk, "en"]),
        {"text": "just words"},
        content_type="application/json",
    )
    assert junk.status_code == 400


# --------------------------------------------------------------------------
# Finding courses


@pytest.mark.django_db
def test_search_finds_a_course_by_a_lessons_title(client, course):
    provider, lessons = course
    lessons[1].title = "Knotless braids"
    lessons[1].save()
    found = client.get(reverse("course-list"), {"q": "knotless"}).json()
    assert [row["slug"] for row in found["results"]] == [provider.slug]
    assert client.get(reverse("course-list"), {"q": "welding"}).json()["count"] == 0


@pytest.mark.django_db
def test_a_featured_course_comes_first_and_free_ones_can_be_put_first(client, course):
    from providers.models import Provider

    provider, _ = course
    other = Provider.objects.create(
        name="Kente Weavers",
        slug="kente",
        area=provider.area,
        location=provider.location,
        status=Provider.Status.PUBLISHED,
    )
    lesson(other, "Warp")
    ProviderVideo.objects.filter(provider=other).update(reviewed_at=timezone.now())
    priced(provider)
    order = [row["slug"] for row in client.get(reverse("course-list")).json()["results"]]
    assert order[0] == "kente"  # newest

    CourseOffer.objects.filter(provider=provider).update(
        featured_until=timezone.now() + timedelta(days=2)
    )
    listing = client.get(reverse("course-list")).json()["results"]
    assert listing[0]["slug"] == provider.slug and listing[0]["featured"] is True
    assert [
        r["slug"] for r in client.get(reverse("course-list"), {"featured": 1}).json()["results"]
    ] == [provider.slug]

    free_first = client.get(reverse("course-list"), {"sort": "free"}).json()["results"]
    assert free_first[0]["slug"] == "kente"


@pytest.mark.django_db
def test_paying_to_sponsor_a_course_starts_once_paystack_confirms(
    trainer_client, client, course, calls, settings
):
    provider, _ = course
    calls.answers["/transaction/initialize"] = {"authorization_url": "https://pay.example"}
    # No summary yet: nothing to read before pressing play (courses/promotion.py).
    refused = trainer_client.post(
        reverse("studio-boost"), {"days": 7}, content_type="application/json"
    )
    assert refused.status_code == 409 and "summary" in refused.json()["detail"]
    CourseOffer.objects.create(provider=provider, summary="Braids from the first parting.")

    started = trainer_client.post(
        reverse("studio-boost"), {"days": 7}, content_type="application/json"
    )
    assert started.status_code == 201
    boost = CourseBoost.objects.get()
    assert boost.reference.startswith("fk-")
    assert boost.amount_pesewas == settings.COURSE_BOOST_WEEK_PRICE * 100
    # Fliiptech's own money: no trainer subaccount.
    assert "subaccount" not in calls[-1][2]

    event = {
        "event": "charge.success",
        "data": {"reference": boost.reference, "status": "success", "amount": 1, "currency": "GHS"},
    }
    body = json.dumps(event).encode()
    sign = hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()
    client.post(
        reverse("paystack-webhook"),
        body,
        content_type="application/json",
        HTTP_X_PAYSTACK_SIGNATURE=sign,
    )
    boost.refresh_from_db()
    assert boost.status == CourseBoost.Status.FAILED  # the wrong amount grants nothing

    second = trainer_client.post(
        reverse("studio-boost"), {"days": 30}, content_type="application/json"
    )
    reference = second.json()["reference"]
    amount = settings.COURSE_BOOST_MONTH_PRICE * 100
    event["data"] = {
        "reference": reference,
        "status": "success",
        "amount": amount,
        "currency": "GHS",
    }
    body = json.dumps(event).encode()
    sign = hmac.new(SECRET.encode(), body, hashlib.sha512).hexdigest()
    client.post(
        reverse("paystack-webhook"),
        body,
        content_type="application/json",
        HTTP_X_PAYSTACK_SIGNATURE=sign,
    )
    paid = CourseBoost.objects.get(reference=reference)
    assert paid.status == CourseBoost.Status.PAID
    assert paid.ends_at - paid.starts_at == timedelta(days=30)
    # Paying makes it "Sponsored", never staff's "Featured".
    assert CourseOffer.objects.get(provider=provider).featured_until is None
    row = client.get(reverse("course-list")).json()["results"][0]
    assert row["sponsored"] is True and row["featured"] is False


# --------------------------------------------------------------------------
# Streaming copies

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg is not installed"
)


def real_video(tmp_path):
    path = tmp_path / "clip.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=25:duration=4",
            "-f",
            "lavfi",
            "-i",
            "sine=duration=4",
            "-c:v",
            "libx264",
            "-g",
            "25",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
    )
    return path


@needs_ffmpeg
@pytest.mark.django_db
def test_an_approved_lesson_gets_a_stream_that_stays_behind_the_lock(
    client, course, tmp_path, django_user_model, settings
):
    provider, lessons = course
    priced(provider)
    locked = lessons[2]
    with open(real_video(tmp_path), "rb") as handle:
        locked.public_360.save("360.mp4", File(handle), save=True)
    ProviderVideo.objects.exclude(pk=locked.pk).update(hls_state="failed")

    made = video_hls.process_next()
    assert made.pk == locked.pk
    locked.refresh_from_db()
    assert locked.hls_state == "ready"
    folder = Path(settings.MEDIA_ROOT) / locked.hls_dir
    master = (folder / "master.m3u8").read_text()
    assert "RESOLUTION=640x360" in master and "360.m3u8" in master
    assert any(name.endswith(".ts") for name in (p.name for p in folder.iterdir()))

    def asks(name):
        return client.get(
            reverse("media-access"), HTTP_X_FORWARDED_URI=f"/media/{locked.hls_dir}/{name}"
        ).status_code

    assert asks("master.m3u8") == 403
    assert asks("360_0000.ts") == 403
    staff = django_user_model.objects.create_user("staffer", password="x", is_staff=True)
    client.force_login(staff)
    assert asks("360_0000.ts") == 200

    # Taken down: the pieces go, and what is left of the address is refused.
    hls_dir = locked.hls_dir
    decide(locked, ProviderVideo.Status.REJECTED, by=staff, note="No.")
    locked.refresh_from_db()
    assert (locked.hls_state, locked.hls_dir) == ("", "")
    assert not (Path(settings.MEDIA_ROOT) / hls_dir / "master.m3u8").exists()
    client.logout()
    assert (
        client.get(
            reverse("media-access"), HTTP_X_FORWARDED_URI=f"/media/{hls_dir}/master.m3u8"
        ).status_code
        == 403
    )


@needs_ffmpeg
@pytest.mark.django_db
def test_a_buyer_is_given_the_stream_and_a_stranger_is_not(
    learner_client, client, course, trainee, tmp_path
):
    provider, lessons = course
    priced(provider)
    with open(real_video(tmp_path), "rb") as handle:
        lessons[1].public_360.save("360.mp4", File(handle), save=True)
    ProviderVideo.objects.exclude(pk=lessons[1].pk).update(hls_state="failed")
    video_hls.process_next()

    assert str(lessons[1].pk) not in access(learner_client, provider)["streams"]
    CoursePurchase.objects.create(
        reference="fc-x",
        provider=provider,
        trainee=trainee,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
    )
    stream = access(learner_client, provider)["streams"][str(lessons[1].pk)]
    assert stream.endswith("/master.m3u8")


@pytest.mark.django_db
def test_progress_rows_follow_their_lesson_and_trainee(learner_client, course):
    _, lessons = course
    progress(learner_client, lessons[0], 3)
    row = LessonProgress.objects.get()
    assert row.provider_id == lessons[0].provider_id


def test_srt_and_vtt_both_become_webvtt():
    assert studio.to_vtt("nothing timed") is None
    vtt = studio.to_vtt("WEBVTT\n\n00:01.000 --> 00:02.000\nHello")
    assert vtt == "WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n"
    assert Decimal("1") == Decimal("1.0")


@pytest.mark.django_db
def test_a_course_bought_from_the_app_returns_to_the_app(client, trainee, course, calls):
    from accounts.app_auth import issue_token

    provider, _ = course
    priced(provider)
    calls.answers["/transaction/initialize"] = {"authorization_url": "https://pay.example"}
    token = issue_token(trainee.user, device="test phone")
    bought = Client().post(
        reverse("course-buy", args=[provider.area.slug, provider.slug]),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert bought.status_code == 201
    assert calls[-1][2]["callback_url"] == "https://skills.example/app-return"

    as_user(client, trainee.user)
    client.post(reverse("course-buy", args=[provider.area.slug, provider.slug]))
    assert "/learn/" in calls[-1][2]["callback_url"]


def _shop_product(django_user_model, area, name, **extra):
    from datetime import timedelta as _td

    from marketplace.models import Product, SellerAccount

    seller = SellerAccount.objects.filter(
        business_name="Tool Shop"
    ).first() or SellerAccount.objects.create(
        user=django_user_model.objects.create_user("tool-shop"),
        phone="+233201119900",
        phone_verified_at=timezone.now(),
        business_name="Tool Shop",
        area=area,
        approval_status=SellerAccount.Approval.CONFIRMED,
    )
    return Product.objects.create(
        seller=seller,
        name=name,
        slug=name.lower().replace(" ", "-"),
        price="50.00",
        status=Product.Status.PUBLISHED,
        published_at=timezone.now() - _td(days=1),
        **extra,
    )


def test_tools_you_need_suggests_then_shows_the_trainers_choice(
    client, course, trainer_client, django_user_model
):
    from courses.models import CourseOffer
    from marketplace.models import Product

    provider, _ = course
    CourseOffer.objects.create(provider=provider, tools="Hair clippers\n- Spray bottle\nTowel")
    clippers = _shop_product(django_user_model, provider.area, "Wahl hair clippers")
    bottle = _shop_product(django_user_model, provider.area, "Spray bottle 500ml")
    _shop_product(django_user_model, provider.area, "Bead necklace")
    url = reverse("course-tools", args=[provider.area.slug, provider.slug])

    found = client.get(url).json()
    assert found["chosen"] is False
    assert found["tools"] == ["Hair clippers", "Spray bottle", "Towel"]
    assert {row["name"] for row in found["products"]} == {clippers.name, bottle.name}

    # The trainer picks; only products on sale may be picked.
    draft = _shop_product(django_user_model, provider.area, "Draft comb")
    draft.status = Product.Status.DRAFT
    draft.save()
    refused = trainer_client.patch(
        reverse("studio-details"),
        {"tool_products": [bottle.pk, draft.pk]},
        content_type="application/json",
    )
    assert refused.status_code == 400
    saved = trainer_client.patch(
        reverse("studio-details"), {"tool_products": [bottle.pk]}, content_type="application/json"
    )
    assert saved.status_code == 200
    assert [row["id"] for row in saved.json()["tool_products"]] == [bottle.pk]

    shown = client.get(url).json()
    assert shown["chosen"] is True
    assert [row["name"] for row in shown["products"]] == [bottle.name]


def test_tools_for_a_course_with_no_offer_is_empty(client, course):
    provider, _ = course
    found = client.get(reverse("course-tools", args=[provider.area.slug, provider.slug])).json()
    assert found == {"chosen": False, "tools": [], "products": []}


@pytest.mark.django_db
def test_selling_is_on_only_with_a_price_and_a_payout_account(trainer_client, course):
    from courses.models import CourseOffer

    provider, _lessons = course
    details = trainer_client.get(reverse("studio-details")).json()
    assert details["selling_on"] is False
    assert "trade_slug" in details

    CourseOffer.objects.update_or_create(
        provider=provider, defaults={"price": "200.00", "paystack_subaccount": "ACCT_x"}
    )
    assert trainer_client.get(reverse("studio-details")).json()["selling_on"] is True


@pytest.mark.django_db
def test_the_course_title_comes_before_the_workshop_name(client, course):
    from catalog.models import Programme  # an in-person course title comes second
    from courses.models import CourseOffer

    provider, _lessons = course
    Programme.objects.filter(provider=provider).delete()
    assert course_title(provider) == provider.name
    CourseOffer.objects.update_or_create(provider=provider, defaults={"title": "Knotless braids"})
    provider.refresh_from_db()
    assert course_title(provider) == "Knotless braids"
    assert detail(client, provider)["course"]["title"] == "Knotless braids"


def _own(trainee, provider):
    """Make the signed-in learner the workshop's own trainer."""
    from providers.models import ProviderMembership, TrainerAccount

    owner = TrainerAccount.objects.create(user=trainee.user, phone="+233201119998")
    ProviderMembership.objects.filter(provider=provider).delete()
    ProviderMembership.objects.create(trainer=owner, provider=provider)


@pytest.mark.django_db
def test_the_workshop_cannot_review_or_question_its_own_course(learner_client, trainee, course):
    provider, lessons = course
    _own(trainee, provider)
    watch(learner_client, lessons[0])

    review = learner_client.post(
        reverse("course-reviews", args=[provider.area.slug, provider.slug]),
        {"rating": 5, "body": "Great"},
        content_type="application/json",
    )
    question = learner_client.post(
        reverse("lesson-questions", args=[lessons[0].pk]),
        {"body": "How do I start?"},
        content_type="application/json",
    )

    assert review.status_code == 403 and review.json()["code"] == "own_course"
    assert question.status_code == 403 and question.json()["code"] == "own_course"
    assert access(learner_client, provider)["can_review"] is False
    assert access(learner_client, provider)["own_course"] is True


@pytest.mark.django_db
def test_hide_invalid_reviews_hides_self_and_unfinished_reviews(trainee, course, learner_client):
    from io import StringIO

    from django.core.management import call_command

    from courses.learner import rating_summary
    from courses.models import CourseReview
    from trainees.models import TraineeAccount

    provider, lessons = course
    stranger = TraineeAccount.objects.create(
        user=get_user_model().objects.create_user("stranger"), phone="+233249990001"
    )
    CourseReview.objects.create(provider=provider, trainee=stranger, rating=1)  # never watched
    _own(trainee, provider)
    CourseReview.objects.create(provider=provider, trainee=trainee, rating=5)  # self-review
    assert rating_summary(provider)["count"] == 2

    out = StringIO()
    call_command("hide_invalid_reviews", stdout=out)
    assert "2 review(s) would be hidden" in out.getvalue()
    assert CourseReview.objects.filter(is_hidden=True).count() == 0  # a dry run changes nothing

    call_command("hide_invalid_reviews", "--apply", stdout=StringIO())
    assert CourseReview.objects.filter(is_hidden=True).count() == 2
    assert rating_summary(provider) == {
        "average": None,
        "count": 0,
        "spread": {"5": 0, "4": 0, "3": 0, "2": 0, "1": 0},
    }
