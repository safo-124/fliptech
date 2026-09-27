"""Send one message through the configured transport and say what happened.

Turning email on is a change to a .env file and a restart, and the only way to
find out whether it worked used to be to sign in as a trainee and wait to see
if anything arrived. When nothing did, there was no way to tell a wrong
password from a wrong host from a backend still set to console.

This asks the question directly, and reports the configuration it used, so a
failure names itself.

It never prints EMAIL_HOST_PASSWORD. A support session with the output pasted
into it should not be a way to leak the credential.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Send a test message through the configured email transport."

    def add_arguments(self, parser):
        parser.add_argument("to", help="Address to send the test message to.")

    def handle(self, *args, **options):
        from core.mail import send_email

        provider = getattr(settings, "EMAIL_PROVIDER", "console")
        sender = settings.DEFAULT_FROM_EMAIL

        self.stdout.write(f"Provider : {provider}")
        self.stdout.write(f"From     : {sender}")
        if provider == "smtp":
            self.stdout.write(f"Host     : {settings.EMAIL_HOST}:{settings.EMAIL_PORT}")
            self.stdout.write(f"User     : {settings.EMAIL_HOST_USER}")
            self.stdout.write(f"TLS      : {settings.EMAIL_USE_TLS}")
            # Whether one is set, never what it is.
            self.stdout.write(f"Password : {'set' if settings.EMAIL_HOST_PASSWORD else 'NOT SET'}")
        self.stdout.write("")

        if provider == "console":
            self.stdout.write(
                self.style.WARNING(
                    "EMAIL_PROVIDER is console, so the message below goes to this log and\n"
                    "nowhere else. Nobody receives a code while that is true."
                )
            )

        try:
            delivered = send_email(
                options["to"],
                "Skills Hub email test",
                "If you are reading this, the Skills Hub server can send email.\n\n"
                "Sign-in codes will reach this address from now on.\n",
            )
        except Exception as exc:
            # The exception text is the useful part — authentication failed,
            # connection refused, name resolution — so it is shown rather than
            # reduced to "failed".
            raise CommandError(f"{type(exc).__name__}: {exc}") from exc

        if not delivered:
            raise CommandError(
                "The server accepted the connection but refused the message. "
                "Check that DEFAULT_FROM_EMAIL matches the authenticated account — "
                "most relays, Gmail included, reject a From address they do not own."
            )

        if provider == "console":
            self.stdout.write(self.style.SUCCESS("\nWritten to the log, as configured."))
        else:
            self.stdout.write(self.style.SUCCESS(f"\nAccepted for delivery to {options['to']}."))
            self.stdout.write(
                "Accepted is not the same as arrived. Check the inbox, and the spam "
                "folder — a new sender usually lands there once before it is trusted."
            )
