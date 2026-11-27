"""Sponsored courses (courses/promotion.py): the label, where they show, what
may be sponsored, what a boost brought, and staff stopping one."""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from courses.models import CourseBoost, CourseOffer, CoursePurchase, LessonPlayDay, LessonProgress
from courses.promotion import boost_problem, boost_results
from courses.studio import confirm_boost
from courses.tests.test_paid_courses import lesson
from providers.models import Provider, ProviderMembership, ProviderVideo, VideoReport
from providers.trainer_auth import account_for_verified_phone as trainer_for_phone
from trainees.auth import account_for_verified_phone as trainee_for_phone


def another_course(like, slug):
    provider = Provider.objects.create(
        name=slug.title(),
        slug=slug,
        area=like.area,
        location=like.location,
        status=Provider.Status.PUBLISHED,
    )
    lesson(provider, "Lesson 1")
    return provider


def boost(provider, *, started=timedelta(days=1), lasts=timedelta(days=7), reference=None):
    now = timezone.now()
    return CourseBoost.objects.create(
        reference=reference or f"fk-{provider.slug}",
        provider=provider,
        days=7,
        amount_pesewas=2000,
        status=CourseBoost.Status.PAID,
        paid_at=now - started,
        starts_at=now - started,
        ends_at=now - started + lasts,
    )


def results(client, **params):
    return client.get(reverse("course-list"), params).json()["results"]


@pytest.mark.django_db
def test_paid_says_sponsored_and_only_staff_picks_say_featured(client, course):
    provider, _ = course
    picked = another_course(provider, "kente")
    CourseOffer.objects.create(provider=picked, featured_until=timezone.now() + timedelta(days=3))
    boost(provider)

    rows = {row["slug"]: row for row in results(client)}
    assert rows[provider.slug]["sponsored"] is True and rows[provider.slug]["featured"] is False
    assert rows["kente"]["featured"] is True and rows["kente"]["sponsored"] is False
    # The /learn spotlight is staff's picks alone.
    assert [row["slug"] for row in results(client, featured=1)] == ["kente"]
    # The free first lesson, for the "Watch free lesson" button.
    first = ProviderVideo.objects.filter(provider=provider).order_by(
        "position", "created_at", "pk"
    )[0]
    assert rows[provider.slug]["free_lesson"]["id"] == first.pk

    # A boost that has ended, or not started, sponsors nothing.
    CourseBoost.objects.update(ends_at=timezone.now() - timedelta(minutes=1))
    assert not any(row["sponsored"] for row in results(client))


@pytest.mark.django_db
def test_sponsored_courses_get_one_spot_in_eight_and_two_on_the_home_page(client, course):
    provider, _ = course
    others = [another_course(provider, f"workshop-{n}") for n in range(11)]
    boost(others[3], reference="fk-a")
    boost(others[7], reference="fk-b")

    listing = results(client)
    assert len(listing) == 12
    assert [n for n, row in enumerate(listing) if row["sponsored"]] == [0, 8]
    # A sort the learner chose is left as it is: no spots. (No lesson here has
    # been watched by staff, so "newest" falls back to the order they joined.)
    newest = results(client, sort="newest")
    assert [row["slug"] for row in newest] == [provider.slug] + [o.slug for o in others]

    boost(others[9], reference="fk-c")
    home = client.get(reverse("courses-sponsored")).json()["results"]
    assert len(home) == 2 and all(row["sponsored"] for row in home)
    assert len(client.get(reverse("courses-sponsored"), {"limit": 4}).json()["results"]) == 3


@pytest.mark.django_db
def test_a_course_needs_lessons_a_summary_and_no_open_report_to_be_sponsored(
    client, course, django_user_model
):
    provider, lessons = course
    assert "summary" in boost_problem(provider)
    CourseOffer.objects.create(provider=provider, summary="Braids from the first parting.")
    assert boost_problem(provider) is None

    lessons[2].status = ProviderVideo.Status.PENDING
    lessons[2].save()
    assert "at least 3 lessons" in boost_problem(provider)
    lessons[2].status = ProviderVideo.Status.APPROVED
    lessons[2].save()

    reporter = django_user_model.objects.create_user(username="viewer", password="x")
    report = VideoReport.objects.create(
        video=lessons[0], reporter=reporter, reason=VideoReport.Reason.NOT_THEIRS
    )
    assert "report" in boost_problem(provider)
    # A running boost steps out of its spots until staff deal with the report.
    boost(provider)
    assert client.get(reverse("courses-sponsored")).json()["results"] == []
    report.resolved_at = timezone.now()
    report.save()
    assert len(client.get(reverse("courses-sponsored")).json()["results"]) == 1

    provider.status = Provider.Status.DRAFT
    provider.save()
    assert "not live" in boost_problem(provider)


@pytest.mark.django_db
def test_a_second_boost_waits_for_the_first_and_never_touches_featured(course):
    provider, _ = course
    first = CourseBoost.objects.create(
        reference="fk-first", provider=provider, days=7, amount_pesewas=2000
    )
    second = CourseBoost.objects.create(
        reference="fk-second", provider=provider, days=30, amount_pesewas=6000
    )
    confirm_boost("fk-first", {"status": "success", "amount": 2000, "currency": "GHS"})
    confirm_boost("fk-second", {"status": "success", "amount": 6000, "currency": "GHS"})
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.ends_at - first.starts_at == timedelta(days=7)
    assert second.starts_at == first.ends_at
    assert second.ends_at - second.starts_at == timedelta(days=30)
    assert CourseOffer.objects.get(provider=provider).featured_until is None


@pytest.mark.django_db
def test_a_boost_reports_plays_people_who_started_and_sales(course):
    provider, lessons = course
    running = boost(provider, started=timedelta(days=2))
    today = timezone.localdate()
    LessonPlayDay.objects.create(video=lessons[0], provider=provider, day=today, plays=5)
    LessonPlayDay.objects.create(
        video=lessons[0], provider=provider, day=today - timedelta(days=6), plays=3
    )

    newcomer = trainee_for_phone(phone="+233240000781", verified_at=timezone.now())
    regular = trainee_for_phone(phone="+233240000782", verified_at=timezone.now())
    LessonProgress.objects.create(trainee=newcomer, video=lessons[0], provider=provider)
    earlier = LessonProgress.objects.create(trainee=regular, video=lessons[0], provider=provider)
    LessonProgress.objects.filter(pk=earlier.pk).update(
        created_at=timezone.now() - timedelta(days=10)
    )
    # Coming back during the boost is not starting the course.
    LessonProgress.objects.create(trainee=regular, video=lessons[1], provider=provider)

    CoursePurchase.objects.create(
        reference="cp-in",
        provider=provider,
        trainee=newcomer,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
        paid_at=timezone.now() - timedelta(hours=3),
    )
    CoursePurchase.objects.create(
        reference="cp-before",
        provider=provider,
        trainee=regular,
        amount_pesewas=15000,
        status=CoursePurchase.Status.PAID,
        paid_at=timezone.now() - timedelta(days=9),
    )

    assert boost_results(running) == {"plays": 5, "started": 1, "sales": 1, "sold": "150.00"}
    waiting = boost(provider, started=-timedelta(days=5), reference="fk-later")
    assert boost_results(waiting)["plays"] == 0


@pytest.mark.django_db
def test_the_studio_says_why_not_and_what_each_boost_brought(client, course):
    provider, _ = course
    trainer = trainer_for_phone(phone="+233240000601", verified_at=timezone.now())
    ProviderMembership.objects.create(
        trainer=trainer, provider=provider, role=ProviderMembership.Role.OWNER
    )
    client.force_login(trainer.user)

    body = client.get(reverse("studio-boost")).json()
    assert "summary" in body["problem"] and body["boosts"] == []
    assert body["sponsored_until"] is None

    running = boost(provider)
    body = client.get(reverse("studio-boost")).json()
    assert body["boosts"][0]["running"] is True
    assert body["boosts"][0]["plays"] == 0
    assert parse_datetime(body["sponsored_until"]) == running.ends_at


@pytest.mark.django_db
def test_staff_can_stop_a_boost_at_once(admin_client, client, course):
    provider, _ = course
    running = boost(provider)
    waiting = boost(provider, started=-timedelta(days=6), reference="fk-next")
    response = admin_client.post(
        reverse("admin:courses_courseboost_changelist"),
        {"action": "stop_boosts", "_selected_action": [running.pk, waiting.pk]},
    )
    assert response.status_code == 302
    running.refresh_from_db()
    waiting.refresh_from_db()
    assert running.ends_at <= timezone.now() and waiting.ends_at <= timezone.now()
    assert not any(row["sponsored"] for row in results(client))
