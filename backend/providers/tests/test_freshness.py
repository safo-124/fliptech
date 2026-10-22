"""The 90-day freshness prompt: queued nightly, sent by staff on WhatsApp.

Section 09 calls staleness what kills a directory. These tests hold the queue
to the two promises that make it trustworthy: an owner is not asked twice for
the same check, and nobody is skipped.
"""

from datetime import timedelta
from io import StringIO
from urllib.parse import parse_qs, urlsplit

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from providers import freshness
from providers.dashboard import provider_from_token
from providers.models import ListingConfirmation, Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


def make_provider(area, slug, *, status=Provider.Status.PUBLISHED, confirmed_days_ago=None):
    return Provider.objects.create(
        name=slug.replace("-", " ").title(),
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        owner_name="Kofi",
        owner_phone="+233209876543",
        status=status,
        last_confirmed_at=(
            None
            if confirmed_days_ago is None
            else timezone.now() - timedelta(days=confirmed_days_ago)
        ),
    )


@pytest.fixture
def due(area):
    return make_provider(area, "due-welding", confirmed_days_ago=95)


@pytest.fixture
def officer(django_user_model):
    call_command("setup_groups", verbosity=0)
    user = django_user_model.objects.create_user("officer", password="pw-12345678", is_staff=True)
    user.groups.add(Group.objects.get(name="Field officer"))
    return user


def queued():
    return ListingConfirmation.objects.filter(prompted_at__isnull=True, responded_at__isnull=True)


# --- queueing ----------------------------------------------------------------


@pytest.mark.django_db
def test_only_published_listings_past_ninety_days_are_queued(area, due):
    never = make_provider(area, "never-confirmed")
    make_provider(area, "fresh", confirmed_days_ago=10)
    make_provider(area, "draft", status=Provider.Status.DRAFT)

    added, withdrawn = freshness.queue_prompts()

    assert (added, withdrawn) == (2, 0)
    assert set(queued().values_list("provider_id", flat=True)) == {due.pk, never.pk}


@pytest.mark.django_db
def test_running_twice_does_not_ask_twice(due):
    freshness.queue_prompts()
    added, _ = freshness.queue_prompts()

    assert added == 0
    assert ListingConfirmation.objects.count() == 1


@pytest.mark.django_db
def test_a_sent_prompt_is_not_repeated_until_the_reply_window_passes(due):
    freshness.queue_prompts()
    row = queued().get()
    freshness.mark_sent(row, actor=None)

    assert freshness.queue_prompts()[0] == 0

    ListingConfirmation.objects.filter(pk=row.pk).update(
        prompted_at=timezone.now() - timedelta(days=freshness.REPROMPT_AFTER_DAYS + 1)
    )
    assert freshness.queue_prompts()[0] == 1


@pytest.mark.django_db
def test_a_listing_confirmed_another_way_leaves_the_queue(due):
    freshness.queue_prompts()
    Provider.objects.filter(pk=due.pk).update(last_confirmed_at=timezone.now())

    assert not freshness.waiting_to_send().exists()
    assert freshness.queue_prompts() == (0, 1)
    assert ListingConfirmation.objects.count() == 0


@pytest.mark.django_db
def test_command_reports_what_it_did(due):
    out = StringIO()
    call_command("queue_freshness_prompts", stdout=out)

    assert "Queued 1 prompt(s)" in out.getvalue()
    assert "1 waiting to be sent" in out.getvalue()


# --- the message ---------------------------------------------------------------


@pytest.mark.django_db
def test_message_goes_to_the_owner_with_a_working_dashboard_link(due, settings):
    settings.PUBLIC_SITE_URL = "https://skills.example"

    url = urlsplit(freshness.prompt_url(due))
    text = parse_qs(url.query)["text"][0]

    assert url.netloc == "wa.me"
    assert url.path == "/233209876543"
    assert text.startswith("Hello Kofi,")
    assert due.name in text

    link = next(word for word in text.split() if word.startswith("https://skills.example/"))
    token = link.removeprefix("https://skills.example/dashboard/")
    provider, error = provider_from_token(token)
    assert error is None
    assert provider == due


@pytest.mark.django_db
def test_without_an_owner_number_it_goes_to_the_listing_number(due):
    due.owner_phone = ""
    assert urlsplit(freshness.prompt_url(due)).path == "/233241234567"


@pytest.mark.django_db
def test_no_public_site_means_no_broken_link(due, settings):
    settings.PUBLIC_SITE_URL = ""

    message = freshness.prompt_message(due)

    assert "dashboard" not in message
    assert "http" not in message


# --- the back-office queue -----------------------------------------------------


@pytest.mark.django_db
def test_officer_sends_a_prompt_and_it_is_recorded(client, officer, due):
    freshness.queue_prompts()
    row = queued().get()
    client.force_login(officer)

    page = client.get(reverse("admin:providers_provider_messages"))
    assert page.status_code == 200
    assert due.name in page.content.decode()

    sent = client.post(reverse("admin:providers_provider_send_prompt", args=[row.pk]))

    assert sent.status_code == 302
    assert sent["Location"].startswith("https://wa.me/233209876543?text=")
    row.refresh_from_db()
    assert row.prompted_at is not None
    assert row.prompted_by == officer
    assert not freshness.waiting_to_send().exists()


@pytest.mark.django_db
def test_a_second_send_does_not_message_the_owner_again(client, officer, due, django_user_model):
    freshness.queue_prompts()
    row = queued().get()
    first = django_user_model.objects.create_user("first", is_staff=True)
    freshness.mark_sent(row, actor=first)
    client.force_login(officer)

    response = client.post(reverse("admin:providers_provider_send_prompt", args=[row.pk]))

    assert response["Location"] == reverse("admin:providers_provider_messages")
    row.refresh_from_db()
    assert row.prompted_by == first


@pytest.mark.django_db
def test_sending_needs_a_post(client, officer, due):
    freshness.queue_prompts()
    client.force_login(officer)

    response = client.get(reverse("admin:providers_provider_send_prompt", args=[queued().get().pk]))

    assert response.status_code == 405
    assert queued().exists()


@pytest.mark.django_db
def test_staff_without_permission_cannot_send(client, due, django_user_model):
    freshness.queue_prompts()
    nobody = django_user_model.objects.create_user("nobody", is_staff=True)
    client.force_login(nobody)

    response = client.post(
        reverse("admin:providers_provider_send_prompt", args=[queued().get().pk])
    )

    assert response.status_code == 403
    assert queued().exists()


@pytest.mark.django_db
def test_sidebar_points_at_the_queue(client, officer, due):
    freshness.queue_prompts()
    cache.clear()
    client.force_login(officer)

    page = client.get(reverse("admin:index")).content.decode()

    assert "Messages to send" in page
    assert reverse("admin:providers_provider_messages") in page


@pytest.mark.django_db
def test_recording_the_reply_restarts_the_clock(client, officer, due):
    freshness.queue_prompts()
    row = queued().get()
    freshness.mark_sent(row, actor=officer)
    client.force_login(officer)
    now = timezone.localtime()

    client.post(
        reverse("admin:providers_listingconfirmation_change", args=[row.pk]),
        {
            "provider": due.pk,
            "prompted_at_0": now.strftime("%Y-%m-%d"),
            "prompted_at_1": now.strftime("%H:%M:%S"),
            "responded_at_0": now.strftime("%Y-%m-%d"),
            "responded_at_1": now.strftime("%H:%M:%S"),
            "channel": ListingConfirmation.Channel.WHATSAPP,
            "fees_confirmed": "on",
            "intakes_confirmed": "on",
            "note": "Owner replied YES.",
        },
    )

    row.refresh_from_db()
    due.refresh_from_db()
    assert row.responded_at is not None
    assert row.confirmed_by == officer
    assert due.last_confirmed_at is not None
    assert not due.is_listing_stale
    assert freshness.queue_prompts() == (0, 0)


# --- the owner answering from their dashboard --------------------------------


@pytest.mark.django_db
def test_owner_confirming_from_the_dashboard_closes_the_prompt(due, django_user_model):
    from providers.trainer_profiles import confirm_listing_is_current

    freshness.queue_prompts()
    row = queued().get()
    freshness.mark_sent(row, actor=None)
    owner = django_user_model.objects.create_user("owner")

    confirm_listing_is_current(due, actor=owner)

    row.refresh_from_db()
    assert row.responded_at is not None
    assert row.fees_confirmed and row.intakes_confirmed
    assert ListingConfirmation.objects.count() == 1
    assert freshness.open_prompt(due) is None
