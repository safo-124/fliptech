"""Section 09's last onboarding step: the owner is told their listing is live.

Queued by publishing, sent by an officer from Messages to send. These hold the
queue to telling every owner once, and never telling an owner a listing is
live when it is not.
"""

from urllib.parse import parse_qs, urlsplit

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.urls import reverse

from geography.models import Area, Region
from providers import owner_messages
from providers.dashboard import provider_from_token
from providers.lifecycle import publish_provider
from providers.models import OwnerNotice, Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


@pytest.fixture
def pending(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Tema", slug="tema", centroid=ACCRA)
    return Provider.objects.create(
        name="Tema Welding Works",
        slug="tema-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        owner_name="Ama",
        status=Provider.Status.PENDING_APPROVAL,
    )


@pytest.fixture
def groups(db):
    call_command("setup_groups", verbosity=0)
    return {
        "officer": Group.objects.get(name="Field officer"),
        "lead": Group.objects.get(name="Operations lead"),
    }


def staff(django_user_model, username, group=None):
    user = django_user_model.objects.create_user(username, password="pw-12345678", is_staff=True)
    if group is not None:
        user.groups.add(group)
    return user


def text_of(url):
    return parse_qs(urlsplit(url).query)["text"][0]


# --- queueing ----------------------------------------------------------------


@pytest.mark.django_db
def test_publishing_queues_one_notice(pending):
    publish_provider(pending, actor=None)

    notice = OwnerNotice.objects.get()
    assert notice.provider == pending
    assert notice.kind == OwnerNotice.Kind.LISTING_LIVE
    assert notice.sent_at is None
    assert list(owner_messages.live_notices_waiting()) == [notice]


@pytest.mark.django_db
def test_publishing_again_before_sending_does_not_queue_a_second(pending):
    publish_provider(pending, actor=None)
    Provider.objects.filter(pk=pending.pk).update(status=Provider.Status.PENDING_APPROVAL)

    publish_provider(pending, actor=None)

    assert OwnerNotice.objects.count() == 1


@pytest.mark.django_db
def test_a_listing_suspended_before_sending_is_not_announced(pending):
    publish_provider(pending, actor=None)
    Provider.objects.filter(pk=pending.pk).update(status=Provider.Status.SUSPENDED)

    assert not owner_messages.live_notices_waiting().exists()


@pytest.mark.django_db
def test_a_publish_that_fails_queues_nothing(pending):
    from providers.lifecycle import ProviderTransitionError

    Provider.objects.filter(pk=pending.pk).update(status=Provider.Status.DRAFT)
    with pytest.raises(ProviderTransitionError):
        publish_provider(pending, actor=None)

    assert not OwnerNotice.objects.exists()


# --- the message ---------------------------------------------------------------


@pytest.mark.django_db
def test_message_links_to_the_listing_and_the_dashboard(pending, settings):
    settings.PUBLIC_SITE_URL = "https://skills.example"
    publish_provider(pending, actor=None)

    url = owner_messages.live_url(pending)
    text = text_of(url)

    assert urlsplit(url).path == "/233241234567"
    assert text.startswith("Hello Ama,")
    assert "is now live" in text
    assert "https://skills.example/tema/tema-welding-works" in text

    dashboard = next(w for w in text.split() if w.startswith("https://skills.example/dashboard/"))
    provider, error = provider_from_token(dashboard.rsplit("/", 1)[1])
    assert error is None and provider == pending


@pytest.mark.django_db
def test_no_public_site_means_no_links(pending, settings):
    settings.PUBLIC_SITE_URL = ""

    text = owner_messages.live_message(pending)

    assert "http" not in text
    assert "reply here" in text


# --- the back office -----------------------------------------------------------


@pytest.mark.django_db
def test_lead_publishing_in_the_back_office_queues_the_notice(
    client, django_user_model, groups, pending
):
    client.force_login(staff(django_user_model, "lead", groups["lead"]))

    client.post(
        reverse("admin:providers_provider_changelist"),
        {"action": "publish_listings", "_selected_action": [pending.pk]},
    )

    assert owner_messages.live_notices_waiting().count() == 1


@pytest.mark.django_db
def test_officer_sends_the_notice_and_it_is_recorded(client, django_user_model, groups, pending):
    publish_provider(pending, actor=None)
    notice = OwnerNotice.objects.get()
    officer = staff(django_user_model, "officer", groups["officer"])
    client.force_login(officer)

    page = client.get(reverse("admin:providers_provider_messages"))
    assert page.status_code == 200
    assert pending.name in page.content.decode()

    sent = client.post(reverse("admin:providers_provider_send_live_notice", args=[notice.pk]))

    assert sent.status_code == 302
    assert sent["Location"].startswith("https://wa.me/233241234567?text=")
    notice.refresh_from_db()
    assert notice.sent_at is not None
    assert notice.sent_by == officer
    assert not owner_messages.live_notices_waiting().exists()


@pytest.mark.django_db
def test_a_second_send_does_not_message_the_owner_again(client, django_user_model, groups, pending):
    publish_provider(pending, actor=None)
    notice = OwnerNotice.objects.get()
    first = staff(django_user_model, "first")
    owner_messages.mark_live_sent(notice, actor=first)
    client.force_login(staff(django_user_model, "officer", groups["officer"]))

    response = client.post(reverse("admin:providers_provider_send_live_notice", args=[notice.pk]))

    assert response["Location"] == reverse("admin:providers_provider_messages")
    notice.refresh_from_db()
    assert notice.sent_by == first


@pytest.mark.django_db
def test_staff_without_permission_cannot_send_or_see_the_page(client, django_user_model, pending):
    publish_provider(pending, actor=None)
    notice = OwnerNotice.objects.get()
    client.force_login(staff(django_user_model, "nobody"))

    assert client.get(reverse("admin:providers_provider_messages")).status_code == 403
    response = client.post(reverse("admin:providers_provider_send_live_notice", args=[notice.pk]))
    assert response.status_code == 403
    assert owner_messages.live_notices_waiting().exists()


@pytest.mark.django_db
def test_clearing_sent_at_puts_a_notice_back_in_the_queue(
    client, django_user_model, groups, pending
):
    """For an officer who opened WhatsApp and backed out without sending."""
    publish_provider(pending, actor=None)
    notice = OwnerNotice.objects.get()
    officer = staff(django_user_model, "officer", groups["officer"])
    owner_messages.mark_live_sent(notice, actor=officer)
    client.force_login(officer)

    client.post(
        reverse("admin:providers_ownernotice_change", args=[notice.pk]),
        {"sent_at_0": "", "sent_at_1": ""},
    )

    notice.refresh_from_db()
    assert notice.sent_at is None
    assert notice.sent_by is None
    assert owner_messages.live_notices_waiting().exists()
