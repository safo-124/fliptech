"""The monthly check-in with each paying workshop.

The point is that "we asked, nobody enrolled" becomes a record. These hold the
due list to the workshops that actually owe an answer, keep a not-reached
attempt from passing as an answer, and keep "enrolments reported" honest.
"""

from datetime import date, timedelta

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from billing.models import Subscription
from catalog.models import Programme, Trade
from enquiries import check_ins
from enquiries.models import Enrolment, MonthlyCheckIn
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)
TODAY = date(2026, 10, 15)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


def workshop(area, name, *, status=Provider.Status.PUBLISHED):
    return Provider.objects.create(
        name=name,
        slug=name.lower().replace(" ", "-"),
        area=area,
        location=ACCRA,
        contact_phone="+233240000000",
        owner_phone="+233209998888",
        owner_name="Ama",
        status=status,
    )


def subscribe(provider, *, price=100, start=date(2026, 9, 1), end=date(2026, 12, 31), **fields):
    return Subscription.objects.create(
        provider=provider,
        tier=Subscription.Tier.STANDARD,
        price=price,
        period_start=start,
        period_end=end,
        **fields,
    )


def enrol(provider):
    trade, _ = Trade.objects.get_or_create(name="Welding", slug="welding")
    programme, _ = Programme.objects.get_or_create(
        provider=provider, trade=trade, title="Arc welding", fee=1200, duration_weeks=12
    )
    return Enrolment.objects.create(
        provider=provider, programme=programme, trainee_phone="+233241112222", started_on=TODAY
    )


@pytest.fixture
def groups(db):
    call_command("setup_groups", verbosity=0)
    return {"officer": Group.objects.get(name="Field officer")}


def staff(django_user_model, username, group=None):
    user = django_user_model.objects.create_user(username, password="pw-12345678", is_staff=True)
    if group is not None:
        user.groups.add(group)
    return user


# --- who is due ------------------------------------------------------------------


@pytest.mark.django_db
def test_only_paying_workshops_are_due(area):
    paying = workshop(area, "Paying Works")
    subscribe(paying)
    subscribe(workshop(area, "Free Works"), price=0)
    subscribe(workshop(area, "Lapsed Works"), state=Subscription.State.LAPSED)
    subscribe(workshop(area, "Ended Works"), start=date(2026, 1, 1), end=date(2026, 9, 30))
    subscribe(workshop(area, "Draft Works", status=Provider.Status.DRAFT))

    assert list(check_ins.due(TODAY)) == [paying]


@pytest.mark.django_db
def test_an_answer_takes_a_workshop_off_the_list_and_not_reaching_them_does_not(
    area, django_user_model
):
    officer = django_user_model.objects.create_user("officer")
    answered = workshop(area, "Answered Works")
    unreached = workshop(area, "Unreached Works")
    subscribe(answered)
    subscribe(unreached)

    check_ins.record(answered, MonthlyCheckIn.Outcome.NONE, actor=officer, today=TODAY)
    check_ins.record(unreached, MonthlyCheckIn.Outcome.NOT_REACHED, actor=officer, today=TODAY)

    assert list(check_ins.due(TODAY)) == [unreached]
    summary = check_ins.summary(TODAY)
    assert (summary.paying, summary.answered, summary.not_reached, summary.due) == (2, 1, 1, 1)


@pytest.mark.django_db
def test_nobody_enrolled_is_a_record_not_an_absence(area, django_user_model):
    """The whole reason this exists."""
    provider = workshop(area, "Quiet Works")
    subscribe(provider)

    check_in = check_ins.record(
        provider,
        MonthlyCheckIn.Outcome.NONE,
        actor=django_user_model.objects.create_user("o"),
        today=TODAY,
    )

    assert check_in.month == date(2026, 10, 1)
    assert not Enrolment.objects.exists()
    assert MonthlyCheckIn.objects.get().get_outcome_display() == "Asked — nobody enrolled"


@pytest.mark.django_db
def test_enrolments_reported_needs_the_enrolments(area, django_user_model):
    provider = workshop(area, "Busy Works")
    subscribe(provider)
    officer = django_user_model.objects.create_user("officer")

    with pytest.raises(check_ins.CheckInRefused):
        check_ins.record(provider, MonthlyCheckIn.Outcome.REPORTED, actor=officer)

    enrol(provider)
    check_in = check_ins.record(provider, MonthlyCheckIn.Outcome.REPORTED, actor=officer)

    assert check_in.outcome == MonthlyCheckIn.Outcome.REPORTED


@pytest.mark.django_db
def test_a_second_answer_in_the_month_replaces_the_first(area, django_user_model):
    provider = workshop(area, "Second Try Works")
    subscribe(provider)
    officer = django_user_model.objects.create_user("officer")

    check_ins.record(provider, MonthlyCheckIn.Outcome.NOT_REACHED, actor=officer, today=TODAY)
    check_ins.record(provider, MonthlyCheckIn.Outcome.NONE, actor=officer, today=TODAY)

    assert MonthlyCheckIn.objects.get().outcome == MonthlyCheckIn.Outcome.NONE


@pytest.mark.django_db
def test_missed_last_month_counts_only_workshops_that_were_due(area, django_user_model):
    officer = django_user_model.objects.create_user("officer")
    missed = workshop(area, "Missed Works")
    subscribe(missed)
    answered = workshop(area, "Answered Works")
    subscribe(answered)
    MonthlyCheckIn.objects.create(
        provider=answered, month=date(2026, 9, 1), outcome="none", checked_by=officer
    )
    # Started paying this month, so it was never due last month.
    newcomer = workshop(area, "New Works")
    subscribe(newcomer, start=date(2026, 10, 5))

    assert list(check_ins.missed_last_month(TODAY)) == [missed]


@pytest.mark.django_db
def test_the_month_is_always_the_first(area):
    provider = workshop(area, "Any Works")

    check_in = MonthlyCheckIn.objects.create(
        provider=provider, month=date(2026, 10, 23), outcome="none"
    )

    assert check_in.month == date(2026, 10, 1)


# --- the back-office page --------------------------------------------------------


@pytest.mark.django_db
def test_an_officer_asks_and_records_the_answer(client, area, groups, django_user_model):
    provider = workshop(area, "Kumasi Road Works")
    subscribe(provider, start=timezone.localdate() - timedelta(days=30))
    officer = staff(django_user_model, "officer", groups["officer"])
    client.force_login(officer)

    page = client.get(reverse("admin:enquiries_monthlycheckin_due"))
    assert page.status_code == 200
    html = page.content.decode()
    assert "Kumasi Road Works" in html
    assert "https://wa.me/233209998888?text=" in html

    response = client.post(
        reverse("admin:enquiries_monthlycheckin_record", args=[provider.pk, "none"])
    )

    assert response.status_code == 302
    check_in = MonthlyCheckIn.objects.get()
    assert check_in.checked_by == officer
    assert check_in.outcome == MonthlyCheckIn.Outcome.NONE
    assert not check_ins.due().exists()


@pytest.mark.django_db
def test_recording_needs_a_post_permission_and_a_paying_workshop(
    client, area, groups, django_user_model
):
    paying = workshop(area, "Paying Works")
    subscribe(paying, start=timezone.localdate() - timedelta(days=30))
    free = workshop(area, "Free Works")
    record = reverse("admin:enquiries_monthlycheckin_record", args=[paying.pk, "none"])

    client.force_login(staff(django_user_model, "nobody"))
    assert client.post(record).status_code == 403

    client.force_login(staff(django_user_model, "officer", groups["officer"]))
    assert client.get(record).status_code == 405
    free_url = reverse("admin:enquiries_monthlycheckin_record", args=[free.pk, "none"])
    assert client.post(free_url).status_code == 404
    bad_outcome = reverse("admin:enquiries_monthlycheckin_record", args=[paying.pk, "maybe"])
    assert client.post(bad_outcome).status_code == 404
    assert not MonthlyCheckIn.objects.exists()


@pytest.mark.django_db
def test_the_sidebar_and_dashboard_show_whos_due(client, area, groups, django_user_model):
    provider = workshop(area, "Due Works")
    subscribe(provider, start=timezone.localdate() - timedelta(days=30))
    client.force_login(staff(django_user_model, "officer", groups["officer"]))

    response = client.get(reverse("admin:index"))

    queues = {q["label"]: q for q in response.context["back_office"]["queues"]}
    assert queues["Check-ins due"]["count"] == 1
    assert queues["Check-ins due"]["url"] == reverse("admin:enquiries_monthlycheckin_due")
    html = response.content.decode()
    assert "Monthly check-in," in html
    assert "1 to ask" in html
