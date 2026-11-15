"""List workshops whose map pin is outside Ghana or far from their area.

Read-only. It prints what is wrong and where to fix it; it changes nothing.

    python manage.py check_listing_locations

A listing found here cannot be saved again until its pin is moved: since
geography/bounds.py, the back office and the trainer's form both refuse a pin
outside Ghana or more than 25 km from the listing's area. Fix each one in the
back office (Providers > the listing > Workshop > Location), or suspend it
there until the trainer gives the real location.
"""

from django.core.management.base import BaseCommand

from geography.bounds import location_problem
from providers.models import Provider


class Command(BaseCommand):
    help = "List workshops whose map pin is outside Ghana or far from their area. Changes nothing."

    def handle(self, *args, **options):
        found = 0
        for provider in Provider.objects.select_related("area").order_by("name"):
            problem = location_problem(provider.location, provider.area)
            if not problem:
                continue
            found += 1
            self.stdout.write(
                f"#{provider.pk}  {provider.name}  [{provider.get_status_display()}]  "
                f"{provider.area.name}  pin {provider.location.y:.5f}, {provider.location.x:.5f}\n"
                f"    {problem}\n"
                f"    Fix: /back-office/providers/provider/{provider.pk}/change/"
            )
        if found:
            self.stdout.write(self.style.WARNING(f"{found} listing(s) need their pin moved."))
        else:
            self.stdout.write(
                self.style.SUCCESS("Every listing's pin is in Ghana and near its area.")
            )
