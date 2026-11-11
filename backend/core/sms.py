"""Pluggable SMS delivery.

Section 06 names Arkesel or Hubtel, but the sender ID registration needs
business documents and takes days to weeks, so no credentials exist yet. The
backend is therefore an interface with a console implementation, chosen by the
SMS_PROVIDER setting. Swapping in the real gateway is one class, and everything
above this layer stays untouched.

Note this is deliberately not django-otp. That package does TOTP, HOTP, static
tokens and email — it does not send SMS, so the gateway integration is code you
write either way, and its device models add machinery this flow does not need.
"""

import base64
import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

logger = logging.getLogger(__name__)


class SMSBackend:
    """Interface. Return True when the message was accepted by the gateway."""

    def send(self, to: str, message: str) -> bool:
        raise NotImplementedError


class ConsoleSMSBackend(SMSBackend):
    """Development. Writes to the log instead of spending money."""

    def send(self, to: str, message: str) -> bool:
        logger.info("SMS to %s: %s", to, message)
        return True


class BackOfficeSMSBackend(SMSBackend):
    """Showcase. Puts the text in the back office for staff to send by hand.

    For demonstrating the product before a gateway exists: the person still
    gets their code, from a member of staff. See core/relay.py, including who
    may see these codes and why they are wiped once expired.

    The code is not written to the log, unlike the console backend: the back
    office is the one place it is shown, behind a permission.
    """

    def send(self, to: str, message: str) -> bool:
        from .relay import queue_text

        queue_text(to, message)
        logger.info("Text to %s queued in the back office for staff to send", to)
        return True


class ArkeselSMSBackend(SMSBackend):
    """Arkesel, Ghana: SMS API v2.

    POST {SMS_API_URL}/sms/send with the key in an `api-key` header and
    {"sender", "message", "recipients"} as JSON. The sender is the name the
    phone shows, at most 11 characters, and Arkesel only delivers it once it
    is approved in their dashboard (SMS > Sender ID).

    A refusal or a network failure is logged and returns False rather than
    raising: callers treat False as "not sent" (a sign-in code is then marked
    "Not sent: pass it on" in the back office), and a bad moment at the
    gateway should not turn somebody's sign-up into an error page. A missing
    key is different, a deploy mistake, and fails loudly at the first text.
    """

    def __init__(self):
        self.api_key = getattr(settings, "SMS_API_KEY", "")
        if not self.api_key:
            raise ImproperlyConfigured(
                "SMS_PROVIDER is arkesel but SMS_API_KEY is empty. Put the key from "
                "Arkesel (API > Main SMS API Info) in backend/.env."
            )
        self.url = settings.SMS_API_URL.rstrip("/") + "/sms/send"
        self.sender = settings.SMS_SENDER_ID

    def payload(self, to, message):
        body = {"sender": self.sender, "message": message, "recipients": [arkesel_number(to)]}
        if getattr(settings, "SMS_SANDBOX", False):
            # Arkesel answers as though it sent, but sends nothing and charges nothing.
            body["sandbox"] = True
        return body

    def send(self, to: str, message: str) -> bool:
        request = urllib.request.Request(
            self.url,
            data=json.dumps(self.payload(to, message)).encode(),
            method="POST",
            headers={
                "api-key": self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
                # Arkesel's API sits behind a firewall that turns away
                # Python's default "Python-urllib/3.x" with a bare 403.
                "User-Agent": user_agent(),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=settings.SMS_TIMEOUT_SECONDS) as response:
                data = json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            logger.warning("Arkesel refused a text to %s: %s %s", mask(to), exc.code, _reason(exc))
            return False
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            logger.warning("Could not reach Arkesel for a text to %s: %s", mask(to), exc)
            return False
        if str(data.get("status", "")).lower() != "success":
            logger.warning(
                "Arkesel did not send a text to %s: %s", mask(to), data.get("message") or data
            )
            return False
        logger.info("Text to %s accepted by Arkesel", mask(to))
        return True


def user_agent():
    """Who is calling, named the way a firewall expects a real client to be."""
    site = getattr(settings, "PUBLIC_SITE_URL", "")
    name = f"{settings.BRAND_NAME}SkillsHub/1.0"
    return f"{name} (+{site})" if site else name


def _error_body(error):
    """A refusal's JSON, or a short plain-text slice of it when it is not JSON.

    A gateway's own refusals are JSON. A refusal from a firewall in front of
    it is an HTML page instead; a slice of that still says which it was (a
    block page names itself), where an empty reason said nothing.
    """
    raw = error.read() or b""
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        text = re.sub(r"<[^>]+>", " ", raw.decode("utf-8", "replace"))
        return " ".join(text.split())[:200]
    return body if isinstance(body, dict) else str(body)[:200]


def _reason(error):
    """What Arkesel said when it refused, if it said anything readable."""
    body = _error_body(error)
    if isinstance(body, str):
        return body
    return body.get("message") or body.get("errors") or ""


def arkesel_number(phone):
    """233XXXXXXXXX, the form Arkesel takes: no plus, no leading zero."""
    digits = re.sub(r"\D", "", str(phone))
    if digits.startswith("0") and len(digits) == 10:
        digits = "233" + digits[1:]
    return digits


def mask(phone):
    """A number for the logs: enough to find the person, not to text them."""
    text = str(phone)
    return text[:-4] + "****" if len(text) > 6 else "****"


MESSAGING_SERVICE = re.compile(r"^MG[0-9a-fA-F]{32}$")


class TwilioSMSBackend(SMSBackend):
    """Twilio Programmable Messaging.

    POST {TWILIO_API_URL}/2010-04-01/Accounts/<sid>/Messages.json, form-encoded
    To, From (or MessagingServiceSid) and Body, with the account SID and auth
    token as HTTP basic auth. Only the delivery is Twilio's: codes are still
    made, hashed and checked here (enquiries/otp.py), so Twilio Verify is not
    used and the back office keeps its copy of each code.

    Ghana, per Twilio's own guidelines: MTN blocks sender IDs that are not
    registered (about three weeks, through Twilio), and a text sent from a
    phone number rather than a name fails on MTN, AirtelTigo and Glo. A trial
    account may only send from its Twilio number, only to numbers verified in
    the Twilio console, and starts each text "Sent from a Twilio trial
    account". So a trial proves the integration; reaching everyone needs an
    upgraded account and a registered sender ID.

    Twilio accepting a text is not the text arriving: a carrier that refuses
    it does so afterwards, and the Twilio console's message log says why.
    Refusals are logged and return False, as Arkesel's do.
    """

    def __init__(self):
        self.account_sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
        self.auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
        if not (self.account_sid and self.auth_token):
            raise ImproperlyConfigured(
                "SMS_PROVIDER is twilio but TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is empty. "
                "Both are on the Twilio console's front page; put them in backend/.env."
            )
        self.url = (
            f"{settings.TWILIO_API_URL.rstrip('/')}/2010-04-01/Accounts/"
            f"{urllib.parse.quote(self.account_sid)}/Messages.json"
        )
        self.sender = settings.TWILIO_FROM or settings.SMS_SENDER_ID

    def fields(self, to, message):
        fields = {"To": "+" + arkesel_number(to), "Body": message}
        if MESSAGING_SERVICE.match(self.sender):
            fields["MessagingServiceSid"] = self.sender
        else:
            fields["From"] = self.sender
        return fields

    def send(self, to: str, message: str) -> bool:
        fields = self.fields(to, message)
        credentials = base64.b64encode(f"{self.account_sid}:{self.auth_token}".encode()).decode()
        request = urllib.request.Request(
            self.url,
            data=urllib.parse.urlencode(fields).encode(),
            method="POST",
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "User-Agent": user_agent(),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=settings.SMS_TIMEOUT_SECONDS) as response:
                data = json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            # Twilio's messages quote the number ("The number +233... is
            # unverified"); it is masked here like everywhere else in the log.
            reason = _twilio_reason(exc).replace(fields["To"], mask(fields["To"]))
            logger.warning("Twilio refused a text to %s: %s %s", mask(to), exc.code, reason)
            return False
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            logger.warning("Could not reach Twilio for a text to %s: %s", mask(to), exc)
            return False
        if data.get("error_code") or data.get("status") in ("failed", "undelivered"):
            logger.warning(
                "Twilio did not send a text to %s: %s %s",
                mask(to),
                data.get("error_code") or "",
                data.get("error_message") or data.get("status"),
            )
            return False
        logger.info("Text to %s accepted by Twilio", mask(to))
        return True


def _twilio_reason(error):
    """Twilio's error code and message. The code is what its docs index:
    twilio.com/docs/api/errors/<code>."""
    body = _error_body(error)
    if isinstance(body, str):
        return body
    return " ".join(str(part) for part in (body.get("code"), body.get("message")) if part)


class HubtelSMSBackend(SMSBackend):
    def send(self, to: str, message: str) -> bool:
        raise NotImplementedError("Hubtel backend not implemented.")


_BACKENDS = {
    "console": ConsoleSMSBackend,
    "backoffice": BackOfficeSMSBackend,
    "arkesel": ArkeselSMSBackend,
    "twilio": TwilioSMSBackend,
    "hubtel": HubtelSMSBackend,
}


def get_sms_backend() -> SMSBackend:
    name = getattr(settings, "SMS_PROVIDER", "console")
    try:
        return _BACKENDS[name]()
    except KeyError as exc:
        raise ValueError(
            f"Unknown SMS_PROVIDER {name!r}. Choose from {sorted(_BACKENDS)}."
        ) from exc


def send_sms(to, message) -> bool:
    return get_sms_backend().send(str(to), message)
