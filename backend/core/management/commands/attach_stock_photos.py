"""Put freely licensed stock photographs on a listing.

For a listing that is real but has no photographs of its own yet, so the site
can be shown to someone without four panels reading "DEMO" on the only page
that has anything on it.

These are not photographs of this workshop and the command never pretends
otherwise: the Commons credit goes into the caption, which the profile renders
under the image. That is visible on the profile. It is NOT visible on a search
card, which shows the picture alone — so anyone browsing sees an image that
looks like this workshop's premises. That is the cost, it is real, and it is
why the command says so every time it runs.

The fix is the owner's own photographs, uploaded through the trainer wizard.
This is scaffolding until then, not a destination.
"""

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError

from core import trade_photos
from providers.models import Provider, ProviderPhoto


class Command(BaseCommand):
    help = "Attach freely licensed Wikimedia Commons photographs to one listing."

    def add_arguments(self, parser):
        parser.add_argument("address", help="area-slug/provider-slug, as the public URL reads.")
        parser.add_argument(
            "--trade",
            help="Trade slug to take photographs from. Defaults to the listing's own trade.",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete the listing's existing photographs, and their files, first.",
        )

    def handle(self, *args, **options):
        try:
            area_slug, slug = options["address"].split("/")
        except ValueError:
            raise CommandError("Address should read area-slug/provider-slug.") from None

        try:
            provider = Provider.objects.get(area__slug=area_slug, slug=slug)
        except Provider.DoesNotExist:
            raise CommandError(f"No listing at {options['address']}.") from None

        trade_slug = options["trade"] or self._own_trade(provider)
        if not trade_slug:
            raise CommandError(
                "This listing has no programme to take a trade from. Pass --trade, one of: "
                + ", ".join(sorted(trade_photos.PHOTOS))
            )
        if trade_slug not in trade_photos.PHOTOS:
            raise CommandError(
                f"No photographs for '{trade_slug}'. Known: "
                + ", ".join(sorted(trade_photos.PHOTOS))
            )

        photos = trade_photos.for_trade(trade_slug)
        if not photos:
            raise CommandError(
                "Nothing cached for that trade. Run `manage.py fetch_trade_photos` first."
            )

        if options["replace"]:
            removed = 0
            for photo in provider.photos.all():
                if photo.image:
                    photo.image.delete(save=False)
                photo.delete()
                removed += 1
            self.stdout.write(f"Removed {removed} existing photograph(s).")

        added = 0
        for order, (kind, content, caption) in enumerate(photos):
            if provider.photos.filter(kind=kind).exists():
                continue
            photo = ProviderPhoto(
                provider=provider, kind=kind, display_order=order, caption=caption
            )
            photo.image.save(f"{provider.slug}-{kind}-stock.jpg", ContentFile(content), save=True)
            self.stdout.write(f"  {kind:<10} {caption}")
            added += 1

        self.stdout.write(self.style.SUCCESS(f"\n{added} photograph(s) on {provider.name}."))
        self.stdout.write(
            self.style.WARNING(
                "\nThese are stock photographs, not pictures of this workshop. The credit\n"
                "shows on the profile page; a search card shows the image alone. Replace\n"
                "them with the owner's own photographs through the trainer wizard."
            )
        )

    @staticmethod
    def _own_trade(provider):
        programme = provider.programmes.select_related("trade").first()
        return programme.trade.slug if programme else None
