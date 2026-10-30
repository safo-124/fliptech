"""Online learning: approved videos, browsed as one course per workshop."""

import pytest
from django.contrib.gis.geos import Point
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.urls import reverse
from django.utils import timezone

from catalog.models import Programme, Trade
from geography.models import Area, Region
from providers.models import Provider, ProviderVideo

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture(autouse=True)
def media(settings, tmp_path, monkeypatch):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    private = storages["private"]
    monkeypatch.setattr(private, "_location", str(tmp_path / "private"))
    for cached in ("base_location", "location"):
        private.__dict__.pop(cached, None)
    yield
    for cached in ("base_location", "location"):
        private.__dict__.pop(cached, None)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)


def workshop(area, slug, *, status=Provider.Status.PUBLISHED, trade=None):
    provider = Provider.objects.create(
        name=slug.replace("-", " ").title(),
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233240000601",
        status=status,
    )
    if trade is not None:
        Programme.objects.create(
            provider=provider, trade=trade, title="Course", fee=500, duration_weeks=12
        )
    return provider


def lesson(provider, title, *, status=ProviderVideo.Status.APPROVED, seconds=600):
    video = ProviderVideo.objects.create(
        provider=provider,
        title=title,
        status=status,
        duration_seconds=seconds,
        size_360=1000,
        reviewed_at=timezone.now(),
    )
    if status == ProviderVideo.Status.APPROVED:
        video.public_360.save("360.mp4", ContentFile(b"video"), save=False)
        video.public_poster.save("poster.jpg", ContentFile(b"poster"), save=False)
        video.save()
    return video


def courses(client, **params):
    response = client.get(reverse("course-list"), params)
    assert response.status_code == 200, response.content
    return response.json()["results"]


@pytest.mark.django_db
def test_a_course_is_a_workshops_approved_lessons(client, area):
    hair = Trade.objects.create(name="Hairdressing", slug="hairdressing")
    studio = workshop(area, "vis-hair-studio", trade=hair)
    lesson(studio, "Lesson 1", seconds=600)
    lesson(studio, "Lesson 2", seconds=900)
    lesson(studio, "Waiting", status=ProviderVideo.Status.PENDING, seconds=3000)

    [course] = courses(client)

    assert course["name"] == "Vis Hair Studio"
    assert (course["lessons"], course["total_seconds"]) == (2, 1500)
    assert course["trade"]["slug"] == "hairdressing"
    assert "/media/videos/public/" in course["poster"]


@pytest.mark.django_db
def test_a_workshop_with_nothing_approved_or_not_published_has_no_course(client, area):
    lesson(workshop(area, "nothing-yet"), "Waiting", status=ProviderVideo.Status.PENDING)
    lesson(workshop(area, "under-review", status=Provider.Status.PENDING_APPROVAL), "Lesson 1")
    lesson(workshop(area, "suspended", status=Provider.Status.SUSPENDED), "Lesson 1")

    assert courses(client) == []


@pytest.mark.django_db
def test_courses_can_be_filtered_by_trade_without_counting_lessons_twice(client, area):
    hair = Trade.objects.create(name="Hairdressing", slug="hairdressing")
    welding = Trade.objects.create(name="Welding", slug="welding")
    studio = workshop(area, "vis-hair-studio", trade=hair)
    # A second course in the same trade: a join on courses would double the
    # lesson count.
    Programme.objects.create(
        provider=studio, trade=hair, title="Advanced", fee=900, duration_weeks=24
    )
    lesson(studio, "Lesson 1")
    lesson(workshop(area, "tema-welders", trade=welding), "Lesson 1")

    [course] = courses(client, trade="hairdressing")

    assert course["slug"] == "vis-hair-studio"
    assert course["lessons"] == 1


@pytest.mark.django_db
def test_a_course_page_lists_its_lessons_in_order(client, area):
    studio = workshop(area, "vis-hair-studio")
    lesson(studio, "Lesson 1")
    lesson(studio, "Lesson 2")
    lesson(studio, "Turned down", status=ProviderVideo.Status.REJECTED)

    response = client.get(reverse("course-detail", args=["adenta", "vis-hair-studio"]))

    assert response.status_code == 200
    body = response.json()
    assert body["course"]["lessons"] == 2
    assert [video["title"] for video in body["lessons"]] == ["Lesson 1", "Lesson 2"]
    assert body["lessons"][0]["sources"][0]["quality"] == 360


@pytest.mark.django_db
def test_a_course_with_nothing_to_watch_is_not_found(client, area):
    lesson(workshop(area, "nothing-yet"), "Waiting", status=ProviderVideo.Status.PENDING)

    assert client.get(reverse("course-detail", args=["adenta", "nothing-yet"])).status_code == 404
    assert client.get(reverse("course-detail", args=["adenta", "nobody"])).status_code == 404
