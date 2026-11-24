"""Queue the 90-day freshness prompts. Run nightly.

Decides which published listings are due to confirm their fees and intake
dates and puts each one in the back office's "Messages to send" page. It
sends nothing: staff send each prompt from the queue on WhatsApp. See
providers/freshness.py for why.

Scheduled by deploy/fliptech-freshness.timer. Safe to run by hand or twice in
a night; a listing already in the queue, or prompted recently, is skipped.
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Queue WhatsApp prompts for listings due their 90-day confirmation."

    def handle(self, *args, **options):
        from providers.freshness import queue_prompts, waiting_to_send
        from providers.intake_prompts import ask_for_next_dates

        queued, withdrawn = queue_prompts()
        waiting = waiting_to_send().count()
        self.stdout.write(
            f"Queued {queued} prompt(s), withdrew {withdrawn} no longer due. "
            f"{waiting} waiting to be sent."
        )
        # Courses whose last start date passed with none to come: the trainer
        # is texted once for it (providers/intake_prompts.py).
        asked = ask_for_next_dates()
        self.stdout.write(f"Texted trainers for the next start date of {asked} course(s).")
