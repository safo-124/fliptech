"""One rule for a listed course, on every public page, refreshed at once."""

from io import StringIO

import pytest
from django.core.management import call_command
from django.urls import reverse

from catalog.models import Programme, Trade
from providers.models import Provider
from providers.tests.test_upcoming_intakes import board  # noqa: F401


def upcoming_titles(client):
    return {row["provider"] for row in client.get(reverse("upcoming-intakes")).json()}


def welding_count(client):
    trades = client.get(reverse("trade-list")).json()["results"]
    return next(trade["provider_count"] for trade in trades if trade["slug"] == "welding")


@pytest.mark.django_db
def test_a_hidden_course_leaves_starting_soon_and_the_trade_count_together(client, board):  # noqa: F811
    assert "Kofi Welding" in upcoming_titles(client)
    assert welding_count(client) == 1

    call_command(
        "hide_listing",
        "--course-id",
        str(Programme.objects.get(provider__name="Kofi Welding").pk),
        "--yes",
        stdout=StringIO(),
    )

    assert "Kofi Welding" not in upcoming_titles(client)
    assert welding_count(client) == 0


@pytest.mark.django_db
def test_a_course_in_a_switched_off_trade_leaves_starting_soon(client, board):  # noqa: F811
    Trade.objects.filter(slug="welding").update(is_active=False)

    assert "Kofi Welding" not in upcoming_titles(client)


@pytest.mark.django_db
def test_hiding_a_workshop_asks_the_site_to_refresh_its_training_pages(
    board,  # noqa: F811
    settings,
    monkeypatch,
    django_capture_on_commit_callbacks,  # noqa: F811
):
    from marketplace import page_refresh

    settings.FRONTEND_REVALIDATE_URL = "http://frontend.test/revalidate"
    settings.FRONTEND_REVALIDATE_SECRET = "s3cret"
    sent = []
    monkeypatch.setattr(page_refresh, "_send", lambda: sent.append(1))

    class Now:
        def __init__(self, target, daemon):
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(page_refresh.threading, "Thread", Now)

    with django_capture_on_commit_callbacks(execute=True):
        call_command("hide_listing", "--workshop", "Kofi Welding", "--yes", stdout=StringIO())
    assert sent == [1]

    with django_capture_on_commit_callbacks(execute=True):
        provider = Provider.objects.get(name="Ama Braids")
        provider.save(update_fields=["updated_at"])
    # A timestamp-only save changes nothing a visitor sees.
    assert sent == [1]


@pytest.mark.django_db
def test_an_enquiry_about_a_hidden_course_says_so_instead_of_a_start_date(board):  # noqa: F811
    from catalog.models import Intake
    from enquiries.models import Enquiry
    from marketplace.chat import _course_card
    from trainees.serializers import TraineeEnquirySerializer

    programme = Programme.objects.get(provider__name="Ama Braids")
    enquiry = Enquiry.objects.create(
        provider=programme.provider,
        programme=programme,
        intake=Intake.objects.filter(programme=programme, is_open=True).first(),
        trainee_phone="+233241110000",
    )
    assert TraineeEnquirySerializer(enquiry).data["programme_listed"] is True
    assert _course_card(enquiry)["starts"] is not None

    Programme.objects.filter(pk=programme.pk).update(is_active=False)
    enquiry.refresh_from_db()

    shown = TraineeEnquirySerializer(enquiry).data
    card = _course_card(enquiry)
    assert (shown["programme_listed"], shown["intake_start"]) == (False, None)
    assert (card["listed"], card["starts"]) == (False, None)
    # Still named: it is what was asked about.
    assert card["title"] == "Hairdressing basics"


@pytest.mark.django_db
def test_publishing_asks_the_site_to_refresh_the_trade_counts(
    board,  # noqa: F811
    settings,
    monkeypatch,
    django_capture_on_commit_callbacks,
    django_user_model,
):
    from marketplace import page_refresh
    from providers.lifecycle import publish_provider

    settings.FRONTEND_REVALIDATE_URL = "http://frontend.test/revalidate"
    settings.FRONTEND_REVALIDATE_SECRET = "s3cret"
    sent = []
    monkeypatch.setattr(page_refresh, "_send", lambda: sent.append(1))

    class Now:
        def __init__(self, target, daemon):
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(page_refresh.threading, "Thread", Now)
    waiting = Provider.objects.get(name="Draft Works")
    Provider.objects.filter(pk=waiting.pk).update(status=Provider.Status.PENDING_APPROVAL)
    lead = django_user_model.objects.create_user("lead", is_staff=True)

    with django_capture_on_commit_callbacks(execute=True):
        publish_provider(waiting, actor=lead)

    assert sent == [1]


@pytest.mark.django_db
def test_a_workshop_with_no_course_is_left_out_of_search_but_keeps_its_page(client, board):  # noqa: F811
    from geography.models import Area

    empty = Provider.objects.create(
        name="Mulago Electricals",
        slug="mulago-electricals",
        area=Area.objects.get(slug="madina"),
        location=board_point(),
        contact_phone="+233240000999",
        status=Provider.Status.PUBLISHED,
    )

    listed = {card["name"] for card in client.get(reverse("provider-list")).json()["results"]}
    found = client.get(reverse("search"), {"q": "Mulago"}).json()["workshops"]["results"]
    page = client.get(reverse("provider-by-slug", args=["madina", empty.slug]))

    assert "Mulago Electricals" not in listed
    assert "Kofi Welding" in listed
    assert all(card["name"] != "Mulago Electricals" for card in found)
    assert page.status_code == 200


def board_point():
    from providers.tests.test_upcoming_intakes import ACCRA

    return ACCRA
