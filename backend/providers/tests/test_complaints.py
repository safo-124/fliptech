"""Complaints: "Report a problem" on a listing, read and acted on by staff.

A complaint can end in a suspension, and a suspension is a decision about a
real business that may be challenged. So these hold the record to what the
reporter actually wrote, keep the decision with the operations lead, and make
sure a suspension and the complaint behind it always lead to each other.
"""

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.core.management import call_command
from django.urls import reverse

from geography.models import Area, Region
from providers.models import Complaint, Provider, Suspension

ACCRA = Point(-0.1870, 5.6037, srid=4326)
URL = "/api/complaints/"


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    cache.clear()


@pytest.fixture
def listing(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    return Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233240000000",
        status=Provider.Status.PUBLISHED,
    )


@pytest.fixture
def groups(db):
    call_command("setup_groups", verbosity=0)
    return {
        "officer": Group.objects.get(name="Field officer"),
        "lead": Group.objects.get(name="Operations lead"),
    }


def staff(django_user_model, username, group):
    user = django_user_model.objects.create_user(username, password="pw-12345678", is_staff=True)
    user.groups.add(group)
    return user


def report(client, listing, **fields):
    body = {
        "provider_id": listing.pk,
        "category": "money",
        "detail": "They asked me for GH₵300 extra on the first day.",
        **fields,
    }
    return client.post(URL, body, content_type="application/json")


def complaint_about(listing, category="money"):
    return Complaint.objects.create(provider=listing, category=category, detail="Asked for more.")


# --- reporting ---------------------------------------------------------------


@pytest.mark.django_db
def test_anyone_can_report_a_listing_and_gets_a_reference(client, listing):
    response = report(client, listing, reporter_name="Kofi", reporter_phone="0241112222")

    assert response.status_code == 201
    complaint = Complaint.objects.get()
    assert response.json()["reference"] == complaint.reference
    assert complaint.reference.startswith("RP-")
    assert complaint.status == Complaint.Status.NEW
    assert complaint.is_urgent
    assert str(complaint.reporter_phone) == "+233241112222"


@pytest.mark.django_db
def test_name_and_number_are_optional(client, listing):
    """Some people will only report if they can stay anonymous."""
    response = report(client, listing, category="wrong_details")

    assert response.status_code == 201
    complaint = Complaint.objects.get()
    assert complaint.reporter_name == ""
    assert not complaint.reporter_phone
    assert not complaint.is_urgent


@pytest.mark.django_db
def test_only_published_listings_can_be_reported(client, listing):
    Provider.objects.filter(pk=listing.pk).update(status=Provider.Status.DRAFT)

    assert report(client, listing).status_code == 400
    assert not Complaint.objects.exists()


@pytest.mark.django_db
def test_a_report_needs_some_detail(client, listing):
    assert report(client, listing, detail="bad").status_code == 400


@pytest.mark.django_db
def test_a_bot_filling_the_hidden_field_is_told_yes_and_ignored(client, listing):
    response = report(client, listing, website="http://spam.example")

    assert response.status_code == 201
    assert response.json()["reference"].startswith("RP-")
    assert not Complaint.objects.exists()


@pytest.mark.django_db
def test_one_connection_cannot_flood_the_queue(client, listing):
    statuses = [report(client, listing).status_code for _ in range(6)]

    assert statuses == [201, 201, 201, 201, 201, 429]
    assert Complaint.objects.count() == 5


# --- the back office ------------------------------------------------------------


@pytest.mark.django_db
def test_the_lead_sees_new_complaints_and_a_field_officer_does_not(
    client, django_user_model, groups, listing
):
    complaint_about(listing)

    client.force_login(staff(django_user_model, "lead", groups["lead"]))
    queues = {
        q["label"]: q for q in client.get(reverse("admin:index")).context["back_office"]["queues"]
    }
    assert queues["New complaints"]["count"] == 1

    client.force_login(staff(django_user_model, "officer", groups["officer"]))
    assert client.get(reverse("admin:providers_complaint_changelist")).status_code == 403
    labels = [
        q["label"] for q in client.get(reverse("admin:index")).context["back_office"]["queues"]
    ]
    assert "New complaints" not in labels


@pytest.mark.django_db
def test_suspending_from_a_complaint_links_the_two(client, django_user_model, groups, listing):
    complaint = complaint_about(listing)
    lead = staff(django_user_model, "lead", groups["lead"])
    client.force_login(lead)

    client.post(
        reverse("admin:providers_complaint_changelist"),
        {"action": "suspend_listing", "_selected_action": [complaint.pk]},
    )

    listing.refresh_from_db()
    complaint.refresh_from_db()
    suspension = Suspension.objects.get()
    assert listing.status == Provider.Status.SUSPENDED
    assert complaint.suspension == suspension
    assert complaint.status == Complaint.Status.SUSPENDED
    assert complaint.handled_by == lead
    assert complaint.reference in suspension.reason
    assert suspension.detail == complaint.detail
    assert suspension.raised_by == lead
    # The suspension leads back to the complaint.
    page = client.get(reverse("admin:providers_suspension_change", args=[suspension.pk]))
    assert complaint.reference in page.content.decode()


@pytest.mark.django_db
def test_a_second_complaint_joins_the_suspension_already_in_place(
    client, django_user_model, groups, listing
):
    first, second = complaint_about(listing), complaint_about(listing, "unsafe")
    client.force_login(staff(django_user_model, "lead", groups["lead"]))
    changelist = reverse("admin:providers_complaint_changelist")

    client.post(changelist, {"action": "suspend_listing", "_selected_action": [first.pk]})
    client.post(changelist, {"action": "suspend_listing", "_selected_action": [second.pk]})

    suspension = Suspension.objects.get()
    assert set(suspension.complaints.all()) == {first, second}


@pytest.mark.django_db
def test_what_the_reporter_wrote_cannot_be_edited(client, django_user_model, groups, listing):
    complaint = complaint_about(listing)
    lead = staff(django_user_model, "lead", groups["lead"])
    client.force_login(lead)

    client.post(
        reverse("admin:providers_complaint_change", args=[complaint.pk]),
        {"status": "no_action", "resolution_note": "Fee was agreed in writing.", "detail": "x"},
    )

    complaint.refresh_from_db()
    assert complaint.detail == "Asked for more."
    assert complaint.status == Complaint.Status.NO_ACTION
    assert complaint.handled_by == lead
    assert complaint.handled_at is not None
