"""Send one text through the configured SMS gateway and say what happened.

Turning texts on is a change to backend/.env and a restart. This asks the
gateway directly, so a wrong key, an unapproved sender ID or an empty balance
names itself here instead of as a trainee who never gets their code.

It never prints SMS_API_KEY, only whether one is set: output pasted into a
support chat should not leak the credential.
"""

import logging

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Send a test text through the configured SMS gateway."

    def add_arguments(self, parser):
        parser.add_argument("to", help="Phone number to text, e.g. +233241234567 or 0241234567.")

    def handle(self, *args, **options):
        from core.sms import get_sms_backend

        provider = getattr(settings, "SMS_PROVIDER", "console")
        sender = settings.SMS_SENDER_ID
        self.stdout.write(f"Provider : {provider}")
        self.stdout.write(f"Sender   : {sender} ({len(sender)} characters, at most 11)")
        if provider == "arkesel":
            self.stdout.write(f"API URL  : {settings.SMS_API_URL}")
            self.stdout.write(f"API key  : {'set' if settings.SMS_API_KEY else 'NOT SET'}")
            self.stdout.write(f"Sandbox  : {settings.SMS_SANDBOX}")
        self.stdout.write("")

        if len(sender) > 11:
            raise CommandError(
                f"SMS_SENDER_ID {sender!r} is longer than 11 characters; phones cannot show it."
            )
        if provider in ("console", "backoffice"):
            self.stdout.write(
                self.style.WARNING(
                    f"SMS_PROVIDER is {provider}, so nothing is texted by the server. Set "
                    "SMS_PROVIDER=arkesel in backend/.env and restart the API."
                )
            )

        # The gateway logs why it refused; show that here too.
        handler = logging.StreamHandler(self.stderr)
        handler.setLevel(logging.WARNING)
        sms_log = logging.getLogger("core.sms")
        sms_log.addHandler(handler)
        try:
            sent = get_sms_backend().send(
                options["to"],
                f"{settings.BRAND_NAME} Skills Hub: this is a test text. "
                "If you can read it, sign-in codes will reach this number.",
            )
        except Exception as exc:
            raise CommandError(f"{type(exc).__name__}: {exc}") from exc
        finally:
            sms_log.removeHandler(handler)

        if not sent:
            raise CommandError(
                "The gateway did not accept the text (see the reason above). Usual causes: "
                "the API key is wrong, the sender ID is not approved yet in Arkesel "
                "(SMS > Sender ID), or the SMS balance is empty."
            )
        if provider == "arkesel" and settings.SMS_SANDBOX:
            self.stdout.write(
                self.style.SUCCESS(
                    "Arkesel accepted it in sandbox mode: nothing was sent or charged."
                )
            )
        else:
            self.stdout.write(self.style.SUCCESS("Accepted. Check the phone for the text."))
