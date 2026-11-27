"""A boost's start, kept on the boost; and "Featured" left to staff.

Until now a boost pushed CourseOffer.featured_until along and nothing else
said when it started. Now a boost carries its own window (starts_at to
ends_at) and is labelled "Sponsored", and featured_until is staff's pick
alone. So: fill in the start of every paid boost, and clear a
featured_until that only a boost had set.
"""

from datetime import timedelta

from django.db import migrations, models


def split(apps, schema_editor):
    CourseBoost = apps.get_model("courses", "CourseBoost")
    CourseOffer = apps.get_model("courses", "CourseOffer")
    paid = CourseBoost.objects.filter(status="paid", ends_at__isnull=False)
    for boost in paid:
        boost.starts_at = boost.ends_at - timedelta(days=boost.days)
        boost.save(update_fields=["starts_at"])
    for offer in CourseOffer.objects.filter(featured_until__isnull=False):
        if paid.filter(provider_id=offer.provider_id, ends_at=offer.featured_until).exists():
            offer.featured_until = None
            offer.save(update_fields=["featured_until"])


class Migration(migrations.Migration):
    dependencies = [
        ("courses", "0004_watched_ranges_and_course_title"),
    ]

    operations = [
        migrations.AddField(
            model_name="courseboost",
            name="starts_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="courseoffer",
            name="featured_until",
            field=models.DateTimeField(
                blank=True,
                help_text="Staff's own pick: labelled Featured and shown first on /learn until "
                "then. Paid boosts are separate (Course boosts) and labelled Sponsored.",
                null=True,
            ),
        ),
        migrations.RunPython(split, migrations.RunPython.noop),
    ]
