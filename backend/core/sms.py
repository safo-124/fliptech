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

import json
import logging
import re
import urllib.error
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


def _reason(error):
    """What Arkesel said when it refused, if it said anything readable."""
    try:
        body = json.loads(error.read() or b"{}")
    except ValueError:
        return ""
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


class HubtelSMSBackend(SMSBackend):
    def send(self, to: str, message: str) -> bool:
        raise NotImplementedError("Hubtel backend not implemented.")


_BACKENDS = {
    "console": ConsoleSMSBackend,
    "backoffice": BackOfficeSMSBackend,
    "arkesel": ArkeselSMSBackend,
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
