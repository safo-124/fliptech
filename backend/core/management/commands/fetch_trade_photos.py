"""Download the freely licensed trade photographs the demo data can use.

Separate from seed_demo on purpose: seeding is run in places that have no
business reaching the internet, and a test suite that silently depended on
Wikimedia Commons being up would fail for reasons that have nothing to do with
the code. See core/trade_photos.py.
"""

from django.core.management.base import BaseCommand

from core import trade_photos


class Command(BaseCommand):
    help = "Cache the Wikimedia Commons trade photographs used by seed_demo --real-photos."

    def handle(self, *args, **options):
        self.stdout.write(f"Caching into {trade_photos.cache_dir()}")
        written = trade_photos.download(report=self.stdout.write)
        if written:
            self.stdout.write(self.style.SUCCESS(f"\n{written} photographs cached."))
        self.stdout.write("\nNow: manage.py seed_demo --real-photos")
