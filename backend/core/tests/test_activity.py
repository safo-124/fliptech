"""The recent-activity feed.

Two things matter here: that an event a person would name actually shows up,
and that the feed obeys the same permission rules as the rest of the
dashboard — a field officer has no business reading who signed up as a
trainee just because the row happens to be recent.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from core import activity
from geography.models import Area, Region
from providers.models import Provider, TrainerAccount, Verification
from providers.trainer_auth import account_for_verified_phone
from trainees.auth import account_for_verified_phone as trainee_for_verified_phone

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


def kinds(events):
    return [event.kind for event in events]


def texts(events):
    return " | ".join(event.what for event in events)


@pytest.mark.django_db
def test_a_listing_going_live_is_an_event(area, django_user_model):
    boss = django_user_model.objects.create_superuser("boss")
    Provider.objects.create(
        name="Accra Welding",
        slug="accra-welding",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
        published_at=timezone.now(),
    )

    events = activity.recent(boss)

    assert "published" in kinds(events)
    assert "Accra Welding went live" in texts(events)


@pytest.mark.django_db
def test_a_submitted_listing_that_went_live_is_not_reported_twice(area, django_user_model):
    """Otherwise the feed says the same thing twice, minutes apart, for every
    listing staff approve promptly."""
    boss = django_user_model.objects.create_superuser("boss")
    now = timezone.now()
    Provider.objects.create(
        name="Accra Welding",
        slug="accra-welding",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
        submitted_at=now - timedelta(hours=1),
        published_at=now,
    )

    assert kinds(activity.recent(boss)).count("published") == 1
    assert "submitted" not in kinds(activity.recent(boss))


@pytest.mark.django_db
def test_a_site_visit_carries_the_officer(area, django_user_model):
    """ "Who" is most of the value: a visit with no name against it is not
    something anyone can follow up."""
    boss = django_user_model.objects.create_superuser("boss")
    officer = django_user_model.objects.create_user(
        "ama", first_name="Ama", last_name="Mensah", is_staff=True
    )
    provider = Provider.objects.create(
        name="Accra Welding",
        slug="accra-welding",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )
    Verification.objects.create(provider=provider, officer=officer, visited_on=timezone.localdate())

    visit = next(event for event in activity.recent(boss) if event.kind == "visited")

    assert visit.who == "Ama Mensah"


@pytest.mark.django_db
def test_a_trainer_decision_says_what_was_decided(area, django_user_model):
    boss = django_user_model.objects.create_superuser("boss")
    account = account_for_verified_phone(phone="+233240000801", verified_at=timezone.now())
    account.approval_status = TrainerAccount.Approval.CONFIRMED
    account.approval_decided_at = timezone.now()
    account.approval_decided_by = boss
    account.save()

    decision = next(event for event in activity.recent(boss) if event.kind == "decision")

    assert "confirmed" in decision.what
    assert decision.who == "boss"


@pytest.mark.django_db
def test_newest_first(area, django_user_model):
    boss = django_user_model.objects.create_superuser("boss")
    now = timezone.now()
    for index, ago in enumerate([timedelta(days=3), timedelta(hours=1), timedelta(days=1)]):
        Provider.objects.create(
            name=f"Workshop {index}",
            slug=f"workshop-{index}",
            area=area,
            location=ACCRA,
            contact_phone="+233241234567",
            published_at=now - ago,
        )

    events = activity.recent(boss)

    assert [event.what for event in events] == [
        "Workshop 1 went live",
        "Workshop 2 went live",
        "Workshop 0 went live",
    ]


@pytest.mark.django_db
def test_old_events_fall_out(area, django_user_model):
    boss = django_user_model.objects.create_superuser("boss")
    Provider.objects.create(
        name="Ancient",
        slug="ancient",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        published_at=timezone.now() - timedelta(days=60),
    )

    assert activity.recent(boss) == []


@pytest.mark.django_db
def test_a_field_officer_does_not_see_trainee_sign_ups(area, django_user_model):
    """The People row is permission-scoped and so is this. Recency is not a
    reason to widen who can read somebody's account."""
    call_command("setup_groups", verbosity=0)
    officer = django_user_model.objects.create_user("officer", is_staff=True)
    officer.groups.add(Group.objects.get(name="Field officer"))
    trainee_for_verified_phone(phone="+233241110009", verified_at=timezone.now())

    boss = django_user_model.objects.create_superuser("boss")

    assert "signed up as a trainee" in texts(activity.recent(boss))
    assert "signed up as a trainee" not in texts(activity.recent(officer))


@pytest.mark.django_db
def test_the_dashboard_renders_it(client, area, django_user_model):
    client.force_login(django_user_model.objects.create_superuser("boss"))
    Provider.objects.create(
        name="Accra Welding",
        slug="accra-welding",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        published_at=timezone.now(),
    )

    body = client.get(reverse("admin:index")).content.decode()

    assert "Lately" in body
    assert "Accra Welding went live" in body


@pytest.mark.django_db
def test_an_empty_feed_says_so_rather_than_rendering_nothing(client, django_user_model):
    client.force_login(django_user_model.objects.create_superuser("boss"))

    body = client.get(reverse("admin:index")).content.decode()

    assert "Nothing has happened in the last two weeks." in body
