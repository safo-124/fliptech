"""Videos already on listings were approved by staff before they went live.

From 0023 on, "shown with no reviewed_at" means live but not yet watched,
and puts the video in the back office's list to watch. Any older shown video
without a reviewed_at (from before that field was filled in) was watched
before it went live, so it is marked as watched here rather than flooding
that list.
"""

from django.db import migrations
from django.db.models import F


def mark_watched(apps, schema_editor):
    ProviderVideo = apps.get_model("providers", "ProviderVideo")
    ProviderVideo.objects.filter(status="approved", reviewed_at__isnull=True).update(
        reviewed_at=F("updated_at")
    )


class Migration(migrations.Migration):
    dependencies = [
        ("providers", "0023_video_publishing_and_reports"),
    ]

    operations = [
        migrations.RunPython(mark_watched, migrations.RunPython.noop),
    ]
