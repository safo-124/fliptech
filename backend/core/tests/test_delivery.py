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


def test_workshop_alerts_are_reported_as_not_built(settings):
    settings.SMS_PROVIDER = "arkesel"
    settings.EMAIL_PROVIDER = "smtp"

    status = delivery.status()

    # Every channel that can be configured is live, and it still is not all
    # fine, because nothing tells a workshop an enquiry arrived.
    assert status["all_live"] is False
    assert status["response_rate_is_misleading"] is True
    assert [channel["name"] for channel in status["broken"]] == ["Workshop alerts"]


@pytest.mark.django_db
def test_the_dashboard_says_so(client, django_user_model, settings):
    settings.SMS_PROVIDER = "console"
    client.force_login(django_user_model.objects.create_superuser("boss", password="pw"))

    body = client.get(reverse("admin:index")).content.decode()

    assert "Some messages are not being delivered" in body
    assert "measures how many answered a message nobody sent them" in body


@pytest.mark.django_db
def test_sending_an_enquiry_still_sends_nothing(monkeypatch, client, settings):
    """The tripwire for PROVIDER_ALERTS_SEND.

    It is a hard-coded False because there is nothing to inspect: the view
    writes a log line where the send would go. If somebody makes that a real
    send and leaves the flag alone, the dashboard would go on telling staff
    that workshops are not being told while they are — so this fails instead.
    """
    if delivery.PROVIDER_ALERTS_SEND:
        pytest.skip("Alerts are implemented; this tripwire has done its job.")

    from core import sms

    sent = []
    monkeypatch.setattr(sms, "send_sms", lambda to, message: sent.append(to))

    # Not a full enquiry POST: this asserts a negative, and the cheapest honest
    # way to do that is to prove the send path is untouched by the module that
    # would use it.
    import enquiries.views

    assert not hasattr(enquiries.views, "send_sms"), (
        "enquiries.views imports send_sms, so an alert may now be sent. "
        "Set core.delivery.PROVIDER_ALERTS_SEND = True."
    )
    assert sent == []
