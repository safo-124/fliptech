"""Texts through Arkesel, tested against a stand-in server on this machine.

The real HTTP code runs end to end (urllib, headers, JSON) against a local
server that answers the way Arkesel's SMS API v2 does, so nothing is sent and
nothing is charged.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management import CommandError, call_command

from core import relay
from core.models import RelayedText
from core.sms import arkesel_number, send_sms
from enquiries import otp

PHONE = "+233241112222"


class FakeArkesel:
    """Answers like Arkesel. `reply` sets what the next request gets."""

    def __init__(self):
        self.requests = []
        self.reply = (200, {"status": "success", "data": [{"recipient": "233241112222", "id": "x"}]})
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                fake.requests.append(
                    {
                        "path": self.path,
                        "api_key": self.headers.get("api-key"),
                        "body": json.loads(self.rfile.read(length) or b"{}"),
                    }
                )
                status, payload = fake.reply
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/v2"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def arkesel(settings):
    fake = FakeArkesel()
    settings.SMS_PROVIDER = "arkesel"
    settings.SMS_API_KEY = "test-key-123"
    settings.SMS_API_URL = fake.url
    settings.SMS_SENDER_ID = "Fliiptech"
    settings.SMS_SANDBOX = False
    yield fake
    fake.close()


def test_a_text_reaches_arkesel_as_its_api_expects(arkesel):
    assert send_sms(PHONE, "123456 is your code") is True

    [request] = arkesel.requests
    assert request["path"] == "/api/v2/sms/send"
    assert request["api_key"] == "test-key-123"
    assert request["body"] == {
        "sender": "Fliiptech",
        "message": "123456 is your code",
        "recipients": ["233241112222"],
    }


def test_sandbox_mode_asks_arkesel_not_to_send(arkesel, settings):
    settings.SMS_SANDBOX = True

    send_sms(PHONE, "hello")

    assert arkesel.requests[0]["body"]["sandbox"] is True


@pytest.mark.parametrize(
    "reply",
    [
        (401, {"status": "error", "message": "Invalid API key"}),
        (422, {"status": "error", "message": "Sender ID not approved"}),
        (200, {"status": "error", "message": "Insufficient balance"}),
        (500, {}),
    ],
)
def test_a_refusal_is_reported_as_not_sent_not_an_error(arkesel, reply, caplog):
    arkesel.reply = reply

    assert send_sms(PHONE, "hello") is False
    assert "Arkesel" in caplog.text
    # The full number never goes into the log.
    assert PHONE not in caplog.text


def test_an_unreachable_gateway_is_reported_as_not_sent(settings):
    settings.SMS_PROVIDER = "arkesel"
    settings.SMS_API_KEY = "k"
    settings.SMS_API_URL = "http://127.0.0.1:9/api/v2"  # nothing listens on port 9

    assert send_sms(PHONE, "hello") is False


def test_a_missing_key_fails_loudly(settings):
    settings.SMS_PROVIDER = "arkesel"
    settings.SMS_API_KEY = ""

    with pytest.raises(ImproperlyConfigured):
        send_sms(PHONE, "hello")


@pytest.mark.parametrize(
    "given,expected",
    [
        ("+233241112222", "233241112222"),
        ("233241112222", "233241112222"),
        ("0241112222", "233241112222"),
        ("024 111 2222", "233241112222"),
    ],
)
def test_numbers_are_written_the_way_arkesel_takes_them(given, expected):
    assert arkesel_number(given) == expected


@pytest.mark.django_db
def test_a_sign_in_code_is_texted_and_copied_to_the_back_office(arkesel, settings, monkeypatch):
    settings.OTP_COPY_TO_BACK_OFFICE = True
    monkeypatch.setattr(otp, "_generate_code", lambda: "908172")

    otp.request_code(PHONE)

    assert "908172" in arkesel.requests[0]["body"]["message"]
    text = RelayedText.objects.get()
    assert (relay.code_in(text.body), text.texted) == ("908172", True)


@pytest.mark.django_db
def test_a_code_arkesel_refuses_is_flagged_for_staff(arkesel, settings, monkeypatch):
    settings.OTP_COPY_TO_BACK_OFFICE = True
    arkesel.reply = (402, {"status": "error", "message": "Insufficient balance"})

    otp.request_code(PHONE)  # sign-up carries on

    assert RelayedText.objects.get().texted is False


def test_check_sms_reports_success(arkesel, capsys):
    call_command("check_sms", PHONE)

    out = capsys.readouterr().out
    assert "Accepted" in out
    assert "test-key-123" not in out  # never prints the key
    assert "API key  : set" in out


def test_check_sms_names_the_problem(arkesel):
    arkesel.reply = (401, {"status": "error", "message": "Invalid API key"})

    with pytest.raises(CommandError, match="did not accept"):
        call_command("check_sms", PHONE)


def test_check_sms_refuses_a_sender_id_phones_cannot_show(arkesel, settings):
    settings.SMS_SENDER_ID = "FliiptechSkillsHub"

    with pytest.raises(CommandError, match="11 characters"):
        call_command("check_sms", PHONE)
