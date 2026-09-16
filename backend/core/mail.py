"""Pluggable email delivery, shaped like core/sms.py.

The one-time code system is entirely ours: generation, hashing, expiry,
attempt limits and daily caps all live in this codebase, and no verification
service is involved. What cannot be built from nothing is *transport* — a
message has to leave the machine somehow, and every mail server on the
receiving end decides whether to believe it.

On this deployment that matters concretely. Outbound port 25 is blocked on the
Hetzner box, which is their default, so a local Postfix cannot deliver to
Gmail or anyone else no matter how it is configured. Port 587 is open, so
Django can hand messages to a submission server that will relay them. Reverse
DNS is still the generic provider hostname, and the site has no domain, so
even with port 25 opened the mail would be filtered on reputation alone.

So: EMAIL_PROVIDER picks the transport.

    console   writes the message to the log. Development and CI, and the
              current production default — a code that is logged is a code
              nobody receives, which is honest about the state of things.
    smtp      Django's own SMTP backend, pointed at whatever host the
              EMAIL_HOST settings name. Self-hosted Postfix once port 25 is
              unblocked and the domain has SPF, DKIM, DMARC and rDNS, or a
              relay on 587 until then. Either way the code above this layer is
              unchanged.

Nothing here parses or renders anything a sender controls. The subject and
body are built from our own strings and the code, so there is no path from a
typed address to message content.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection

logger = logging.getLogger(__name__)


class EmailBackend:
    """Interface. Return True when the message was accepted for delivery."""

    def send(self, to: str, subject: str, body: str) -> bool:
        raise NotImplementedError


class ConsoleEmailBackend(EmailBackend):
    """Development, CI, and any deploy without working transport.

    Logs at INFO so the code is greppable in the journal, which is how a code
    is read on this deployment today.
    """

    def send(self, to: str, subject: str, body: str) -> bool:
        logger.info("Email to %s | %s | %s", to, subject, body)
        return True


class SMTPEmailBackend(EmailBackend):
    """Hand the message to an SMTP server.

    A connection per message. These are one-time codes sent one at a time in
    response to someone tapping a button, not a campaign, so pooling would add
    a failure mode without saving anything measurable.
    """

    def send(self, to: str, subject: str, body: str) -> bool:
        connection = get_connection(backend="django.core.mail.backends.smtp.EmailBackend")
        message = EmailMultiAlternatives(
            subject=subject,
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[to],
            connection=connection,
        )
        # send() returns the number of messages delivered. Zero means the
        # server refused it, which must not read as success.
        return message.send() == 1


_BACKENDS = {
    "console": ConsoleEmailBackend,
    "smtp": SMTPEmailBackend,
}


def get_email_backend() -> EmailBackend:
    name = getattr(settings, "EMAIL_PROVIDER", "console")
    try:
        return _BACKENDS[name]()
    except KeyError as exc:
        raise ValueError(
            f"Unknown EMAIL_PROVIDER {name!r}. Choose from {sorted(_BACKENDS)}."
        ) from exc


def send_email(to, subject, body) -> bool:
    return get_email_backend().send(str(to), subject, body)
