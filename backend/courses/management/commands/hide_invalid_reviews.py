"""Hide course reviews that should never have been allowed.

    python manage.py hide_invalid_reviews            # list them, change nothing
    python manage.py hide_invalid_reviews --apply    # hide them

A review is invalid when it was written by the workshop's own trainer or shop
owner (a course rating itself), or by someone who never finished a lesson of
the course. These are hidden (CourseReview.is_hidden), not deleted: staff can
show one again in the back office. Ratings are worked out from the reviews
shown (courses.learner.rating_summary), so hiding them corrects the stars.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from courses.learner import rating_summary, watcher_runs_the_course
from courses.models import CourseReview, LessonProgress


class Command(BaseCommand):
    help = "List (or with --apply, hide) course reviews by the course's owner or non-learners."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true", help="Hide them. Without it, only list."
        )

    def handle(self, *args, apply=False, **options):
        invalid = []
        for review in CourseReview.objects.filter(is_hidden=False).select_related(
            "provider", "trainee", "trainee__user"
        ):
            if watcher_runs_the_course(review.trainee, review.provider):
                invalid.append((review, "written by the course's own workshop"))
            elif not LessonProgress.objects.filter(
                trainee=review.trainee, provider=review.provider, completed_at__isnull=False
            ).exists():
                invalid.append((review, "the reviewer never finished a lesson"))

        if not invalid:
            self.stdout.write("No invalid reviews.")
            return
        for review, why in invalid:
            self.stdout.write(
                f"Review {review.pk} on {review.provider.name}: {review.rating} stars, {why}."
            )
        if not apply:
            self.stdout.write(
                f"{len(invalid)} review(s) would be hidden. Run again with --apply to hide them."
            )
            return
        with transaction.atomic():
            CourseReview.objects.filter(pk__in=[review.pk for review, _why in invalid]).update(
                is_hidden=True
            )
        for provider in {review.provider for review, _why in invalid}:
            summary = rating_summary(provider)
            self.stdout.write(
                f"{provider.name}: now {summary['average'] or 'no rating'} "
                f"from {summary['count']} review(s)."
            )
        self.stdout.write(self.style.SUCCESS(f"Hid {len(invalid)} review(s)."))
