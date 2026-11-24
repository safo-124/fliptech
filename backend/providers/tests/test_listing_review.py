"""Listing checks: who teaches by name, placeholder text, review flags for
staff, the next-date text to trainers, and when instalments fall due."""

# The fixtures are imported from the instalment tests and named as arguments.
# ruff: noqa: F811

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone

from catalog.models import Intake, Programme
from core.placeholders import is_placeholder, is_role_label
from providers import intake_prompts
from providers.models import Provider, ProviderMembership, TrainerAccount
from providers.review_flags import flags_for, schedule_hours
from providers.serializers import teacher_name
from providers.tests.test_instalment_terms import catalogue, owner, save  # noqa: F401
from providers.tests.test_trainer_api import ACCRA, authenticated_csrf, profile_payload


def workshop(catalogue, **fields):  # noqa: F811
    return Provider.objects.create(
        name=fields.pop("name", "Ama Tailoring"),
        slug=fields.pop("slug", "ama-tailoring"),
        area=catalogue["area"],
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
        published_at=timezone.now() - timedelta(days=30),
        **fields,
    )


def trainer_for(provider, full_name="Ama Mensah", phone="+233241110001"):
    trainer = TrainerAccount.objects.create(
        user=get_user_model().objects.create_user(f"trainer-{phone[-4:]}"),
        phone=phone,
        phone_verified_at=timezone.now(),
        full_name=full_name,
        approval_status=TrainerAccount.Approval.CONFIRMED,
    )
    ProviderMembership.objects.create(trainer=trainer, provider=provider)
    return trainer


def course(provider, catalogue, **fields):  # noqa: F811
    return Programme.objects.create(
        provider=provider,
        trade=catalogue["trade"],
        title=fields.pop("title", "Dressmaking"),
        fee=Decimal("900"),
        duration_weeks=12,
        **fields,
    )


# --------------------------------------------------------------------------
# Placeholder text and roles


@pytest.mark.parametrize(
    ("text", "placeholder"),
    [
        ("To be changed", True),
        ("TBC.", True),
        ("t.b.c", True),
        ("N/A", True),
        ("xxx", True),
        ("X X X X", True),
        ("...", True),
        ("Lorem ipsum dolor", True),
        ("Test welding", False),
        ("NVTI Certificate", False),
        ("", False),
    ],
)
def test_placeholder_text_is_told_from_real_text(text, placeholder):
    assert is_placeholder(text) is placeholder


def test_a_role_is_not_a_name():
    assert is_role_label("Owner") and is_role_label("the owner") and is_role_label("Lead trainer")
    assert not is_role_label("Ama Owusu")


@pytest.mark.django_db
def test_placeholder_text_and_a_role_are_refused_beside_the_field(owner, catalogue):  # noqa: F811
    response = save(owner, catalogue, certificate_awarded="To be changed")
    assert response.status_code == 400
    assert "certificate_awarded" in response.json()["programme"]
    assert "placeholder" in response.json()["programme"]["certificate_awarded"][0]

    payload = profile_payload(catalogue)
    payload["owner_name"] = "Owner"
    response = owner.put(
        reverse("trainer-profile"),
        payload,
        content_type="application/json",
        **authenticated_csrf(owner),
    )
    assert response.status_code == 400
    assert response.json()["owner_name"] == ["Write the person's name, not their role."]


# --------------------------------------------------------------------------
# Who teaches


@pytest.mark.django_db
def test_who_teaches_falls_back_to_the_owners_full_name_never_the_role(catalogue):  # noqa: F811
    provider = workshop(catalogue, owner_name="Owner", lead_trainer_name="")
    trainer_for(provider, full_name="Ama Mensah")

    assert teacher_name(provider) == "Ama Mensah"

    provider.lead_trainer_name = "Madam Akosua"
    assert teacher_name(provider) == "Madam Akosua"
    # Nothing real anywhere: nobody is named, rather than "Owner".
    alone = workshop(catalogue, name="Kofi Works", slug="kofi-works", owner_name="Owner")
    assert teacher_name(alone) == ""


@pytest.mark.django_db
def test_the_listing_names_the_owner_not_the_role(client, catalogue):  # noqa: F811
    provider = workshop(catalogue, owner_name="Owner", in_trade_since=2015)
    course(provider, catalogue)
    trainer_for(provider, full_name="Ama Mensah")

    body = client.get(reverse("provider-by-slug", args=[provider.area.slug, provider.slug])).json()

    assert body["master"]["name"] == "Ama Mensah"


# --------------------------------------------------------------------------
# Review flags for staff


@pytest.mark.parametrize(
    ("schedule", "hours"),
    [
        ("Mon-Fri, 8am to 2pm", 30),
        ("Monday to Saturday 9am-5pm", 48),
        ("Mon, Wed, Fri 8 to 12", 12),
        ("Weekdays 2pm - 6pm", 20),
        ("Saturdays 8:30am to 12:30pm", 4),
        ("Whenever suits", None),
        ("Monthly meetings", None),
    ],
)
def test_a_schedule_is_read_as_hours_a_week(schedule, hours):
    assert schedule_hours(schedule) == hours


@pytest.mark.django_db
def test_staff_see_placeholders_and_numbers_that_do_not_add_up(catalogue):  # noqa: F811
    year = timezone.localdate().year
    provider = workshop(
        catalogue, directions="tbc", apprentices_trained=300, in_trade_since=year - 2
    )
    course(provider, catalogue, certificate_awarded="To be changed")
    course(
        provider,
        catalogue,
        title="Sewing basics",
        hours_per_week=10,
        weekly_schedule="Mon-Fri, 8am to 2pm",
    )

    flags = flags_for(provider)

    assert any("Directions" in flag and "tbc" in flag for flag in flags)
    assert any("certificate" in flag and "To be changed" in flag for flag in flags)
    assert any("300 in 2 years" in flag for flag in flags)
    assert any("Sewing basics: 10 hours a week" in flag and "about 30" in flag for flag in flags)


@pytest.mark.django_db
def test_a_tidy_listing_has_no_flags(catalogue):  # noqa: F811
    provider = workshop(
        catalogue, apprentices_trained=40, in_trade_since=timezone.localdate().year - 10
    )
    course(provider, catalogue, hours_per_week=30, weekly_schedule="Mon-Fri, 8am to 2pm")

    assert flags_for(provider) == []


# --------------------------------------------------------------------------
# The next start date


@pytest.mark.django_db
def test_a_trainer_is_texted_once_when_the_last_start_date_passes(
    catalogue,
    monkeypatch,
    django_capture_on_commit_callbacks,  # noqa: F811
):
    texts = []
    monkeypatch.setattr(
        intake_prompts, "send_sms", lambda to, message: texts.append((str(to), message))
    )
    provider = workshop(catalogue)
    trainer_for(provider, phone="+233241110002")
    lapsed = course(provider, catalogue)
    Intake.objects.create(programme=lapsed, start_date=timezone.localdate() - timedelta(days=5))
    coming = course(provider, catalogue, title="Pattern cutting")
    Intake.objects.create(programme=coming, start_date=timezone.localdate() + timedelta(days=60))

    with django_capture_on_commit_callbacks(execute=True):
        assert intake_prompts.ask_for_next_dates() == 1
    with django_capture_on_commit_callbacks(execute=True):
        assert intake_prompts.ask_for_next_dates() == 0

    assert [to for to, _ in texts] == ["+233241110002"]
    assert "Dressmaking" in texts[0][1] and "/trainer/dashboard" in texts[0][1]

    # A later date is added and that one passes too: asked again, once.
    later = timezone.localdate() + timedelta(days=10)
    Intake.objects.create(programme=lapsed, start_date=later)
    with django_capture_on_commit_callbacks(execute=True):
        assert intake_prompts.ask_for_next_dates(today=later + timedelta(days=1)) == 1
    assert len(texts) == 2


# --------------------------------------------------------------------------
# When instalments fall due


@pytest.mark.django_db
def test_instalments_say_when_the_payments_fall_due(owner, catalogue, client):  # noqa: F811
    missing = save(owner, catalogue, instalment_interval="")
    assert missing.status_code == 400
    assert "instalment_interval" in missing.json()["programme"]

    assert save(owner, catalogue, instalment_interval="weekly").status_code == 200
    assert Programme.objects.get().instalment_interval == "weekly"

    provider = Provider.objects.get()
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.PUBLISHED)
    shown = client.get(reverse("provider-by-slug", args=[provider.area.slug, provider.slug])).json()
    assert shown["programmes"][0]["instalment_interval"] == "weekly"

    # Turning instalments off clears it with the rest.
    save(owner, catalogue, instalments_allowed=False)
    assert Programme.objects.get().instalment_interval == ""
