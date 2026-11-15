"""Hide test listings and courses from the public site, without deleting them.

Nothing is deleted. A workshop is set to Suspended, which takes it, its
courses and their intakes off every public page (search, the map, the home
page's "Starting soon", its own page). A course on its own is switched off
(is_active = False), which hides that course and its intakes but leaves the
workshop up. Both are undone in the back office: set the workshop back to
Published, or tick the course's "Is active" box.

Dry run first (the default): shows what matches and changes nothing.

    python manage.py hide_listing --workshop "Test 1"
    python manage.py hide_listing --course "Sadgg"

Then the same with --yes to do it:

    python manage.py hide_listing --workshop "Test 1" --yes

Names match exactly, ignoring case. Use --workshop-id / --course-id when two
share a name (the ids are in the dry run's output).
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from catalog.models import Programme
from providers.models import Provider


class Command(BaseCommand):
    help = (
        "Hide a test workshop or course from the public site. Never deletes. Dry run unless --yes."
    )

    def add_arguments(self, parser):
        parser.add_argument("--workshop", action="append", default=[], help="Workshop name.")
        parser.add_argument("--workshop-id", action="append", type=int, default=[])
        parser.add_argument("--course", action="append", default=[], help="Course title.")
        parser.add_argument("--course-id", action="append", type=int, default=[])
        parser.add_argument("--yes", action="store_true", help="Make the change.")

    def handle(self, *args, **options):
        workshops = list(
            Provider.objects.filter(pk__in=options["workshop_id"]).select_related("area")
        )
        for name in options["workshop"]:
            workshops += list(Provider.objects.filter(name__iexact=name).select_related("area"))
        courses = list(
            Programme.objects.filter(pk__in=options["course_id"]).select_related("provider")
        )
        for title in options["course"]:
            courses += list(
                Programme.objects.filter(title__iexact=title).select_related("provider")
            )

        if not workshops and not courses:
            raise CommandError("Nothing matched. Check the spelling, or pass an id.")

        for provider in workshops:
            self.stdout.write(
                f"Workshop #{provider.pk}  {provider.name}  ({provider.area.name})  "
                f"now: {provider.get_status_display()}  ->  Suspended"
            )
        for course in courses:
            self.stdout.write(
                f"Course #{course.pk}  {course.title}  at {course.provider.name}  "
                f"now: {'on' if course.is_active else 'off'}  ->  off"
            )

        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING("Dry run: nothing changed. Add --yes to hide these.")
            )
            return

        with transaction.atomic():
            for provider in workshops:
                provider.status = Provider.Status.SUSPENDED
                # Kept in the listing's history, so the reason is on record.
                provider._change_reason = "Hidden from the public site as test data (hide_listing)."
                provider.save(update_fields=["status", "updated_at"])
            for course in courses:
                course.is_active = False
                course._change_reason = "Hidden from the public site as test data (hide_listing)."
                course.save(update_fields=["is_active", "updated_at"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Hidden: {len(workshops)} workshop(s), {len(courses)} course(s). Nothing deleted."
            )
        )
