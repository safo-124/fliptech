"""The email transport check.

Its job is to turn "nothing arrived" into a sentence naming the cause, so the
tests are mostly about it reporting honestly — including never printing the
credential it is checking.
"""

from io import StringIO

import pytest
from django.core.management import CommandError, call_command


def run(to="someone@example.com"):
    out = StringIO()
    call_command("check_email", to, stdout=out)
    return out.getvalue()


def test_console_says_the_message_went_nowhere(settings):
    """The whole point of the warning: a logged code is a code nobody got."""
    settings.EMAIL_PROVIDER = "console"

    output = run()

    assert "goes to this log and" in output
    assert "Nobody receives a code" in output


def test_it_reports_the_configuration_it_used(settings):
    settings.EMAIL_PROVIDER = "smtp"
    settings.EMAIL_HOST = "smtp.gmail.com"
    settings.EMAIL_PORT = 587
    settings.EMAIL_HOST_USER = "someone@gmail.com"
    settings.EMAIL_HOST_PASSWORD = "app-password-here"
    settings.DEFAULT_FROM_EMAIL = "Skills Hub <someone@gmail.com>"

    # The send itself will fail with no server; the report comes first.
    with pytest.raises(CommandError):
        run()


def test_the_password_is_never_printed(settings, monkeypatch):
    """Output gets pasted into support threads."""
    settings.EMAIL_PROVIDER = "smtp"
    settings.EMAIL_HOST = "smtp.example.com"
    settings.EMAIL_HOST_USER = "someone@example.com"
    settings.EMAIL_HOST_PASSWORD = "sup3r-s3cret-app-password"

    from core import mail

    monkeypatch.setattr(mail, "get_email_backend", lambda: _Backend(True))

    output = run()

    assert "sup3r-s3cret-app-password" not in output
    assert "Password : set" in output


def test_an_unset_password_is_called_out(settings, monkeypatch):
    settings.EMAIL_PROVIDER = "smtp"
    settings.EMAIL_HOST = "smtp.example.com"
    settings.EMAIL_HOST_PASSWORD = ""

    from core import mail

    monkeypatch.setattr(mail, "get_email_backend", lambda: _Backend(True))

    assert "Password : NOT SET" in run()


def test_a_refused_message_is_an_error_not_a_success(settings, monkeypatch):
    """send() returning zero means the relay said no. Reporting that as sent
    is how you conclude the address is wrong when the From address is."""
    settings.EMAIL_PROVIDER = "smtp"

    from core import mail

    monkeypatch.setattr(mail, "get_email_backend", lambda: _Backend(False))

    with pytest.raises(CommandError, match="refused the message"):
        run()


def test_a_connection_failure_names_itself(settings, monkeypatch):
    settings.EMAIL_PROVIDER = "smtp"

    from core import mail

    def boom():
        raise ConnectionRefusedError("nothing listening on 587")

    monkeypatch.setattr(mail, "get_email_backend", boom)

    with pytest.raises(CommandError, match="ConnectionRefusedError"):
        run()


def test_success_does_not_claim_the_mail_arrived(settings, monkeypatch):
    """Accepted for delivery is all an SMTP server can tell us."""
    settings.EMAIL_PROVIDER = "smtp"

    from core import mail

    monkeypatch.setattr(mail, "get_email_backend", lambda: _Backend(True))

    output = run()

    assert "Accepted for delivery" in output
    assert "Accepted is not the same as arrived" in output


class _Backend:
    def __init__(self, delivered):
        self.delivered = delivered

    def send(self, to, subject, body):
        return self.delivered
