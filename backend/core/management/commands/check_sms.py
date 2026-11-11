"""Send one text through the configured SMS gateway and say what happened.

Turning texts on is a change to backend/.env and a restart. This asks the
gateway directly, so a wrong key, an unapproved sender ID or an empty balance
names itself here instead of as a trainee who never gets their code.

It never prints SMS_API_KEY or the Twilio credentials, only whether they are
set: output pasted into a support chat should not leak them.
"""

import logging

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

# Why each gateway usually refuses, for the message when it does.
USUAL_CAUSES = {
    "arkesel": (
        "the API key is wrong, the sender ID is not approved yet in Arkesel "
        "(SMS > Sender ID), or the SMS balance is empty."
    ),
    "twilio": (
        "the account SID or auth token is wrong (Twilio error 20003); on a trial account, "
        "the number is not verified in the Twilio console (21608) or TWILIO_FROM is a name "
        "rather than your Twilio number (21267); or Ghana is not switched on under "
        "Messaging > Settings > Geo permissions (21408)."
    ),
}


class Command(BaseCommand):
    help = "Send a test text through the configured SMS gateway."

    def add_arguments(self, parser):
        parser.add_argument("to", help="Phone number to text, e.g. +233241234567 or 0241234567.")

    def handle(self, *args, **options):
        from core.sms import MESSAGING_SERVICE, get_sms_backend

        provider = getattr(settings, "SMS_PROVIDER", "console")
        sender = settings.SMS_SENDER_ID
        if provider == "twilio" and settings.TWILIO_FROM:
            sender = settings.TWILIO_FROM
        # A name is what the phone shows, so it has the 11-character limit; a
        # phone number or a Twilio Messaging Service does not.
        named = not (sender.startswith("+") or MESSAGING_SERVICE.match(sender))
        self.stdout.write(f"Provider : {provider}")
        self.stdout.write(
            f"Sender   : {sender}" + (f" ({len(sender)} characters, at most 11)" if named else "")
        )
        if provider == "arkesel":
            self.stdout.write(f"API URL  : {settings.SMS_API_URL}")
            self.stdout.write(f"API key  : {'set' if settings.SMS_API_KEY else 'NOT SET'}")
            self.stdout.write(f"Sandbox  : {settings.SMS_SANDBOX}")
        if provider == "twilio":
            self.stdout.write(f"Account  : {'set' if settings.TWILIO_ACCOUNT_SID else 'NOT SET'}")
            self.stdout.write(f"Token    : {'set' if settings.TWILIO_AUTH_TOKEN else 'NOT SET'}")
        self.stdout.write("")

        if named and len(sender) > 11:
            raise CommandError(
                f"The sender {sender!r} is longer than 11 characters; phones cannot show it."
            )
        if provider in ("console", "backoffice"):
            self.stdout.write(
                self.style.WARNING(
                    f"SMS_PROVIDER is {provider}, so nothing is texted by the server. Set "
                    "SMS_PROVIDER=arkesel or twilio in backend/.env and restart the API."
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
            causes = USUAL_CAUSES.get(provider)
            raise CommandError(
                "The gateway did not accept the text (see the reason above)."
                + (f" Usual causes: {causes}" if causes else "")
            )
        if provider == "arkesel" and settings.SMS_SANDBOX:
            self.stdout.write(
                self.style.SUCCESS(
                    "Arkesel accepted it in sandbox mode: nothing was sent or charged."
                )
            )
        elif provider == "twilio":
            self.stdout.write(
                self.style.SUCCESS(
                    "Accepted by Twilio. Check the phone. If nothing arrives, the Twilio "
                    "console's message logs say why: MTN, AirtelTigo and Glo refuse texts "
                    "sent from a phone number rather than a registered name."
                )
            )
        else:
            self.stdout.write(self.style.SUCCESS("Accepted. Check the phone for the text."))
