"""Remove the illustrative providers that seed_demo created.

They exist to develop the frontend against. On a public deployment they are
invented workshops presented as real ones, with invented fees and invented
site-visit records, which is the one thing this product cannot be seen to do.

What counts as demo data is not guessed. The slugs are rebuilt from the very
constants seed_demo composes them from, so the two cannot drift apart: change
the seeder's areas, trades or suffixes and this command follows.

Reference data stays. Regions, areas and trades are real places and real
trades, they are what a genuine listing is filed under, and Test 1 already
uses one of them.

Dry run unless --yes is passed.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from billing.models import Subscription
from catalog.models import Intake, Programme
from core.management.commands.seed_demo import AREAS, TRADES, WORKSHOP_SUFFIXES
from enquiries.models import Enquiry, Enrolment
from providers.models import Provider, ProviderPhoto


def demo_slugs():
    """Every slug seed_demo could produce, for any --providers count.

    The seeder walks i upwards and takes area[i % 5], trade[i % 6] and
    suffix[i % 5], so which combinations appear depends on how many were
    asked for. The full cross-product is the safe superset.
    """
    return {
        f"{area_slug}-{trade_slug}-{suffix.lower().replace(' ', '-')}"
        for _, area_slug, _, _ in AREAS
        for _, trade_slug, _ in TRADES
        for suffix in WORKSHOP_SUFFIXES
    }


def demo_providers():
    """Matching providers that no trainer has claimed.

    The membership check is the safety catch. A slug collision with a real
    workshop is unlikely but not impossible, and a listing someone signed in
    and filled out is not demo data whatever it is called.
    """
    return Provider.objects.filter(slug__in=demo_slugs(), trainer_memberships__isnull=True)


class Command(BaseCommand):
    help = "Delete the providers created by seed_demo. Dry run unless --yes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Actually delete. Without it, nothing is written.",
        )

    def handle(self, *args, **options):
        providers = list(demo_providers())
        if not providers:
            self.stdout.write("No demo providers found. Nothing to do.")
            return

        ids = [p.pk for p in providers]
        claimed = Provider.objects.filter(slug__in=demo_slugs(), trainer_memberships__isnull=False)

        enquiries = Enquiry.objects.filter(provider_id__in=ids)
        counts = {
            "providers": len(providers),
            "programmes": Programme.objects.filter(provider_id__in=ids).count(),
            "intakes": Intake.objects.filter(programme__provider_id__in=ids).count(),
            "photographs": ProviderPhoto.objects.filter(provider_id__in=ids).count(),
            "enquiries": enquiries.count(),
            "enrolments": Enrolment.objects.filter(provider_id__in=ids).count(),
            "subscriptions": Subscription.objects.filter(provider_id__in=ids).count(),
        }

        self.stdout.write(f"{len(providers)} demo providers:")
        for provider in providers[:10]:
            self.stdout.write(f"  {provider.area.slug}/{provider.slug}  {provider.name}")
        if len(providers) > 10:
            self.stdout.write(f"  ... and {len(providers) - 10} more")

        self.stdout.write("")
        for label, number in counts.items():
            self.stdout.write(f"  {label:<14} {number}")

        # Enquiries from a real signed-in trainee are someone's actual message,
        # even though the workshop it went to is invented. Worth naming before
        # it disappears rather than after.
        real = enquiries.filter(trainee__isnull=False).count()
        if real:
            self.stdout.write(
                self.style.WARNING(
                    f"\n  {real} of those enquiries came from a signed-in trainee account."
                )
            )
        if claimed.exists():
            self.stdout.write(
                self.style.WARNING(
                    f"\nLeaving {claimed.count()} matching listing(s) alone: a trainer has "
                    "signed in and claimed them, so they are not demo data."
                )
            )

        if not options["yes"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --yes to delete."))
            return

        # The files first, while the rows that name them still exist. Django
        # deletes rows, never the files they point at, so skipping this leaves
        # every demo photograph on disk and publicly served.
        files = 0
        for photo in ProviderPhoto.objects.filter(provider_id__in=ids):
            if photo.image:
                photo.image.delete(save=False)
                files += 1
        for provider in providers:
            if provider.logo:
                provider.logo.delete(save=False)
                files += 1

        with transaction.atomic():
            # Enrolment.provider is PROTECT, so it has to go before the
            # provider does or the whole delete refuses.
            Enrolment.objects.filter(provider_id__in=ids).delete()
            Provider.objects.filter(pk__in=ids).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDeleted {len(providers)} demo providers and {files} image files. "
                f"{Provider.objects.count()} providers remain."
            )
        )
