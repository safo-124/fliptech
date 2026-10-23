"""What the dashboard says about messages reaching people.

The point of this strip is that the back office was quietly wrong: it showed a
reply rate for enquiries no workshop was ever told about. These tests are
mostly about it staying honest as the settings change.
"""

import pytest
from django.urls import reverse

from core import delivery


def test_console_backends_are_not_live(settings):
    settings.SMS_PROVIDER = "console"
    settings.EMAIL_PROVIDER = "console"

    status = delivery.status()

    assert status["all_live"] is False
    assert {channel["name"] for channel in status["broken"]} >= {"Text messages", "Email"}


def test_a_real_provider_is_live(settings):
    settings.SMS_PROVIDER = "arkesel"
    settings.EMAIL_PROVIDER = "smtp"

    names = {channel["name"] for channel in delivery.status()["broken"]}

    assert "Text messages" not in names
    assert "Email" not in names


def test_an_unset_provider_is_not_quietly_treated_as_working(settings):
    """An empty setting is the easiest way to end up sending nothing at all
    while the dashboard says everything is fine."""
    settings.SMS_PROVIDER = ""

    broken = {channel["name"] for channel in delivery.status()["broken"]}

    assert "Text messages" in broken


def test_workshop_alerts_are_reported_as_sent_by_staff(settings):
    settings.SMS_PROVIDER = "arkesel"
    settings.EMAIL_PROVIDER = "smtp"

    status = delivery.status()

    alerts = next(c for c in status["channels"] if c["name"] == "Workshop alerts")
    assert alerts["live"] is True
    assert alerts["provider"] == "sent by staff from the back office"
    # Workshops are told now, so the reply rate means something again.
    assert status["response_rate_is_misleading"] is False
    assert status["all_live"] is True


@pytest.mark.django_db
def test_the_dashboard_says_so(client, django_user_model, settings):
    settings.SMS_PROVIDER = "console"
    client.force_login(django_user_model.objects.create_superuser("boss", password="pw"))

    body = client.get(reverse("admin:index")).content.decode()

    assert "Some messages are not being delivered" in body
    assert "writing to the server log rather than sending" in body
    assert "measures how many answered a message nobody sent them" not in body
