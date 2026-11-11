"""Texts through Twilio, tested against a stand-in server on this machine.

As with Arkesel, the real HTTP code runs end to end (urllib, basic auth, a
form body) against a local server that answers the way Twilio's Messages API
does, so nothing is sent and nothing is charged.
"""

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management import CommandError, call_command

from core import relay
from core.models import RelayedText
from core.sms import send_sms
from enquiries import otp

PHONE = "+233241112222"
SERVICE = "MG" + "0123456789abcdef" * 2


class FakeTwilio:
    """Answers like Twilio. `reply` sets what the next request gets."""

    def __init__(self):
        self.requests = []
        self.reply = (201, {"sid": "SM123", "status": "queued", "error_code": None})
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                auth = self.headers.get("Authorization", "")
                fake.requests.append(
                    {
                        "path": self.path,
                        "auth": base64.b64decode(auth.removeprefix("Basic ")).decode(),
                        "content_type": self.headers.get("Content-Type"),
                        "form": {
                            key: values[0]
                            for key, values in parse_qs(self.rfile.read(length).decode()).items()
                        },
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
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def twilio(settings):
    fake = FakeTwilio()
    settings.SMS_PROVIDER = "twilio"
    settings.TWILIO_ACCOUNT_SID = "AC123"
    settings.TWILIO_AUTH_TOKEN = "secret-token"
    settings.TWILIO_FROM = "+15005550006"
    settings.TWILIO_API_URL = fake.url
    settings.SMS_SENDER_ID = "Fliiptech"
    yield fake
    fake.close()


def test_a_text_reaches_twilio_as_its_api_expects(twilio):
    assert send_sms(PHONE, "123456 is your code") is True

    [request] = twilio.requests
    assert request["path"] == "/2010-04-01/Accounts/AC123/Messages.json"
    assert request["auth"] == "AC123:secret-token"
    assert request["content_type"] == "application/x-www-form-urlencoded"
    assert request["form"] == {
        "To": PHONE,
        "From": "+15005550006",
        "Body": "123456 is your code",
    }


def test_a_local_number_is_sent_in_full_international_form(twilio):
    send_sms("024 111 2222", "hello")

    assert twilio.requests[0]["form"]["To"] == PHONE


def test_a_messaging_service_is_named_as_one(twilio, settings):
    settings.TWILIO_FROM = SERVICE

    send_sms(PHONE, "hello")

    form = twilio.requests[0]["form"]
    assert form["MessagingServiceSid"] == SERVICE
    assert "From" not in form


def test_with_no_twilio_sender_the_sites_sender_id_is_used(twilio, settings):
    settings.TWILIO_FROM = ""

    send_sms(PHONE, "hello")

    assert twilio.requests[0]["form"]["From"] == "Fliiptech"


@pytest.mark.parametrize(
    "reply,code",
    [
        ((401, {"code": 20003, "message": "Authenticate", "status": 401}), "20003"),
        (
            (
                400,
                {
                    "code": 21608,
                    "message": f"The number {PHONE} is unverified. Trial accounts cannot "
                    "send messages to unverified numbers.",
                    "status": 400,
                },
            ),
            "21608",
        ),
        (
            (400, {"code": 21408, "message": "Permission to send an SMS has not been enabled"}),
            "21408",
        ),
        ((500, {}), "500"),
    ],
)
def test_a_refusal_is_reported_as_not_sent_not_an_error(twilio, reply, code, caplog):
    twilio.reply = reply

    assert send_sms(PHONE, "hello") is False
    assert "Twilio" in caplog.text
    assert code in caplog.text
    # The full number never goes into the log, even where Twilio quotes it.
    assert PHONE not in caplog.text


def test_a_text_twilio_takes_but_marks_failed_is_not_sent(twilio, caplog):
    twilio.reply = (201, {"sid": "SM1", "status": "failed", "error_code": 30008})

    assert send_sms(PHONE, "hello") is False
    assert "30008" in caplog.text


def test_an_unreachable_twilio_is_reported_as_not_sent(settings):
    settings.SMS_PROVIDER = "twilio"
    settings.TWILIO_ACCOUNT_SID = "AC123"
    settings.TWILIO_AUTH_TOKEN = "t"
    settings.TWILIO_API_URL = "http://127.0.0.1:9"  # nothing listens on port 9

    assert send_sms(PHONE, "hello") is False


@pytest.mark.parametrize("sid,token", [("", "t"), ("AC123", "")])
def test_missing_credentials_fail_loudly(settings, sid, token):
    settings.SMS_PROVIDER = "twilio"
    settings.TWILIO_ACCOUNT_SID = sid
    settings.TWILIO_AUTH_TOKEN = token

    with pytest.raises(ImproperlyConfigured):
        send_sms(PHONE, "hello")


@pytest.mark.django_db
def test_a_sign_in_code_is_texted_and_copied_to_the_back_office(twilio, settings, monkeypatch):
    settings.OTP_COPY_TO_BACK_OFFICE = True
    monkeypatch.setattr(otp, "_generate_code", lambda: "908172")

    otp.request_code(PHONE)

    assert "908172" in twilio.requests[0]["form"]["Body"]
    text = RelayedText.objects.get()
    assert (relay.code_in(text.body), text.texted) == ("908172", True)


def test_check_sms_reports_success_without_the_credentials(twilio, capsys):
    call_command("check_sms", PHONE)

    out = capsys.readouterr().out
    assert "Accepted by Twilio" in out
    assert "Token    : set" in out
    assert "secret-token" not in out
    # A phone number as the sender is not held to the 11-character name limit.
    assert "Sender   : +15005550006\n" in out


def test_check_sms_names_twilios_usual_causes(twilio):
    twilio.reply = (400, {"code": 21608, "message": "unverified", "status": 400})

    with pytest.raises(CommandError, match="21608"):
        call_command("check_sms", PHONE)
