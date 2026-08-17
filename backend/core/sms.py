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

import logging

from django.conf import settings

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


class ArkeselSMSBackend(SMSBackend):
    """Arkesel, Ghana. Left unimplemented until a sender ID is registered.

    Raising rather than silently no-opping is deliberate: a misconfigured
    production deploy should fail loudly at the first enquiry, not quietly
    swallow every one-time code.
    """

    def send(self, to: str, message: str) -> bool:
        raise NotImplementedError(
            "Arkesel backend not implemented. Register the sender ID, then send "
            "to https://sms.arkesel.com/api/v2/sms/send with SMS_API_KEY."
        )


class HubtelSMSBackend(SMSBackend):
    def send(self, to: str, message: str) -> bool:
        raise NotImplementedError("Hubtel backend not implemented.")


_BACKENDS = {
    "console": ConsoleSMSBackend,
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
