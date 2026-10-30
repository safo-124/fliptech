"""Encode uploaded teaching videos with ffmpeg, one at a time.

Runs all the time under deploy/fliptech-video.service: it waits for a video
to finish uploading, prepares it for 3G (see providers/video_encoding.py) and
puts it in the review queue. With --once it works through what is waiting and
stops, which is what tests and a by-hand run want.

One video at a time, at the lowest CPU priority, so the site keeps answering
on the same two-CPU server. When long courses make the queue too slow, run
this on a second server pointed at the same database and the same storage:
each worker claims a different video.
"""

import time

from django.core.management.base import BaseCommand

# How long to wait before looking again when nothing is queued. Long enough
# not to keep the database busy; short enough that a trainer watching their
# screen sees it start.
IDLE_SECONDS = 10
# How often to requeue dead encodings and remove abandoned uploads.
TIDY_SECONDS = 15 * 60


class Command(BaseCommand):
    help = "Encode uploaded teaching videos for review."

    def add_arguments(self, parser):
        parser.add_argument(
            "--once", action="store_true", help="Work through the queue, then stop."
        )

    def handle(self, *args, once=False, **options):
        from providers.video_encoding import process_next, tidy

        last_tidy = 0.0
        while True:
            if time.monotonic() - last_tidy >= TIDY_SECONDS:
                requeued, abandoned = tidy()
                if requeued or abandoned:
                    self.stdout.write(
                        f"Requeued {requeued} stalled encoding(s); "
                        f"removed {abandoned} abandoned upload(s)."
                    )
                last_tidy = time.monotonic()

            video = process_next()
            if video is not None:
                self.stdout.write(f"Video {video.pk}: {video.get_status_display()}")
                continue
            if once:
                return
            time.sleep(IDLE_SECONDS)
