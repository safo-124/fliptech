"""The workshop is told when a trainee enquires.

Until WhatsApp Cloud API credentials exist the server cannot send this
itself, so every enquiry queues an alert that an officer sends from Messages
to send. Before this, the alert was a log line and no workshop ever heard
about an enquiry from the platform. These hold the queue to telling every
workshop once, quickly, and never about an enquiry it should not act on.
"""

from datetime import date, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.urls import reverse

from catalog.models import Intake, Programme, Trade
from enquiries.models import Enquiry
from geography.models import Area, Region
from providers import owner_messages
from providers.admin_outbox import waiting_count
from providers.models import OwnerNotice, Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)
TRAINEE = "+233241112222"
OWNER = "+233209998888"


@pytest.fixture
def programme(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    provider = Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233240000000",
        owner_phone=OWNER,
        owner_name="Ama",
        status=Provider.Status.PUBLISHED,
    )
    trade = Trade.objects.create(name="Welding", slug="welding")
    prog = Programme.objects.create(
        provider=provider, trade=trade, title="Arc welding", fee=1200, duration_weeks=12
    )
    Intake.objects.create(programme=prog, start_date=date.today() + timedelta(days=30))
    return prog


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


def enquiry_for(programme, **fields):
    enquiry = Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        trainee_phone=TRAINEE,
        state=Enquiry.State.SENT,
        **fields,
    )
    return enquiry, owner_messages.queue_enquiry_alert(enquiry)


def text_of(url):
    return parse_qs(urlsplit(url).query)["text"][0]


# --- queueing ----------------------------------------------------------------


@pytest.mark.django_db
def test_sending_an_enquiry_queues_an_alert_for_the_workshop(client, programme, monkeypatch):
    from enquiries import otp

    monkeypatch.setattr(otp, "_generate_code", lambda: "123456")
    otp.request_code(TRAINEE)
    client.post("/api/enquiries/verify-code/", {"phone": TRAINEE, "code": "123456"})

    response = client.post("/api/enquiries/", {"phone": TRAINEE, "programme_id": programme.pk})

    assert response.status_code == 201
    notice = OwnerNotice.objects.get()
    assert notice.kind == OwnerNotice.Kind.NEW_ENQUIRY
    assert notice.enquiry == Enquiry.objects.get()
    assert notice.provider == programme.provider
    assert list(owner_messages.enquiry_alerts_waiting()) == [notice]
    # The sidebar's "Messages to send" badge counts it.
    assert waiting_count() == 1


@pytest.mark.django_db
def test_one_alert_per_enquiry(programme):
    enquiry, first = enquiry_for(programme)

    again = owner_messages.queue_enquiry_alert(enquiry)

    assert again == first
    assert OwnerNotice.objects.count() == 1


@pytest.mark.django_db
def test_spam_and_suspended_listings_are_not_alerted(programme):
    spam, _ = enquiry_for(programme)
    Enquiry.objects.filter(pk=spam.pk).update(state=Enquiry.State.SPAM)
    assert not owner_messages.enquiry_alerts_waiting().exists()

    enquiry_for(programme)
    Provider.objects.filter(pk=programme.provider_id).update(status=Provider.Status.SUSPENDED)
    assert not owner_messages.enquiry_alerts_waiting().exists()


# --- the message -------------------------------------------------------------


@pytest.mark.django_db
def test_the_alert_says_who_asked_about_what_and_how_to_reply(programme, settings):
    settings.PUBLIC_SITE_URL = "https://skills.example.com"
    enquiry, notice = enquiry_for(
        programme, trainee_name="Kofi", message="Do you train on weekends?"
    )

    url = owner_messages.enquiry_alert_url(notice)

    # To the owner's own number, not the public one on the listing.
    assert urlsplit(url).path == "/233209998888"
    text = text_of(url)
    assert text.startswith("Hello Ama, ")
    assert '"Arc welding"' in text
    assert enquiry.reference_code in text
    assert "Name: Kofi" in text
    assert "Phone: +233241112222" in text
    assert "Their message: Do you train on weekends?" in text
    # One tap opens a chat with the trainee, the reply typed and quoting the
    # reference, because the trainee asked several workshops.
    assert "https://wa.me/233241112222?text=" in text
    assert "https://skills.example.com/dashboard/" in text


@pytest.mark.django_db
def test_an_enquiry_with_no_name_or_message_still_reads_well(programme):
    _, notice = enquiry_for(programme)

    text = text_of(owner_messages.enquiry_alert_url(notice))

    assert "Name:" not in text
    assert "Their message:" not in text
    assert "Phone: +233241112222" in text


# --- sending it from the back office ----------------------------------------


@pytest.mark.django_db
def test_an_officer_sends_the_alert_and_it_is_recorded(
    client, django_user_model, groups, programme
):
    enquiry, notice = enquiry_for(programme)
    officer = staff(django_user_model, "officer", groups["officer"])
    client.force_login(officer)

    page = client.get(reverse("admin:providers_provider_messages")).content.decode()
    # First on the page: the one queue where an hour matters.
    assert page.index("New enquiry (1)") < page.index("Listings are live (0)")
    assert enquiry.reference_code in page

    sent = client.post(reverse("admin:providers_provider_send_enquiry_alert", args=[notice.pk]))

    assert sent.status_code == 302
    assert sent["Location"].startswith("https://wa.me/233209998888?text=")
    notice.refresh_from_db()
    assert notice.sent_by == officer
    assert notice.sent_at is not None
    assert not owner_messages.enquiry_alerts_waiting().exists()


@pytest.mark.django_db
def test_a_second_send_does_not_alert_the_workshop_again(
    client, django_user_model, groups, programme
):
    _, notice = enquiry_for(programme)
    first = staff(django_user_model, "first")
    owner_messages.mark_notice_sent(notice, actor=first)
    client.force_login(staff(django_user_model, "officer", groups["officer"]))

    response = client.post(reverse("admin:providers_provider_send_enquiry_alert", args=[notice.pk]))

    assert response["Location"] == reverse("admin:providers_provider_messages")
    notice.refresh_from_db()
    assert notice.sent_by == first


@pytest.mark.django_db
def test_staff_without_permission_cannot_send_it(client, django_user_model, programme):
    _, notice = enquiry_for(programme)
    client.force_login(staff(django_user_model, "nobody"))

    response = client.post(reverse("admin:providers_provider_send_enquiry_alert", args=[notice.pk]))

    assert response.status_code == 403
    assert owner_messages.enquiry_alerts_waiting().exists()


@pytest.mark.django_db
def test_the_enquiry_page_says_whether_the_workshop_was_told(
    client, django_user_model, groups, programme
):
    enquiry, notice = enquiry_for(programme)
    lead = staff(django_user_model, "lead", groups["lead"])
    client.force_login(lead)
    url = reverse("admin:enquiries_enquiry_change", args=[enquiry.pk])

    assert "Not yet — waiting on" in client.get(url).content.decode()

    owner_messages.mark_notice_sent(notice, actor=lead)

    assert ", by lead" in client.get(url).content.decode()
