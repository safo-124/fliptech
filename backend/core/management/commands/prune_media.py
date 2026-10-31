"""Delete public media files no row points at any more.

Django has not deleted files on model delete since 1.3, deliberately: a
rolled-back transaction would otherwise take the file with it. So every
photograph a trainer removes through the wizard has stayed on disk, served by
Caddy to anyone who kept the URL. That is a slow leak of both space and
content the owner believed they had taken down.

Deleting them at the moment the row goes would swap one problem for a worse
one. Pages are cached for five minutes, so a file removed now is a broken
image on a live page until that cache turns over — which is exactly what
happened on the first `attach_stock_photos --replace`.

Hence an age: a file is only pruned once it is older than the cache window by
a wide margin, by which time nothing can still be pointing at it.

Public media only. Verification evidence and identity documents live under
PRIVATE_MEDIA_ROOT, which this never walks — Section 10 requires evidence is
never publicly served, and a pruner that wandered into it could delete the
proof behind a published verification badge.
"""

from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

DEFAULT_AGE_DAYS = 7


def referenced_names():
    """Every file name a row points at, as stored, with no I/O per row.

    Every file field on every model, rather than a list kept by hand. The
    hand-kept list knew workshop photos and logos and nothing else, so trade
    pictures, product photos, trainee avatars and home-page pictures were
    all "orphans" a week after upload, and `--yes` deleted them. A new model
    with a file is covered the day it is written.

    Historical copies (django-simple-history) are skipped: a file only an
    old version of a row mentions is one the live row has let go of.
    """
    from django.apps import apps
    from django.db import models

    names = set()
    for model in apps.get_models():
        if model.__name__.startswith("Historical"):
            continue
        for field in model._meta.get_fields():
            if not isinstance(field, models.FileField) or field.model is not model:
                continue
            names |= set(
                model._default_manager.exclude(**{field.name: ""})
                .exclude(**{f"{field.name}__isnull": True})
                .values_list(field.name, flat=True)
            )
    return names


def orphans(root: Path, keep_names: set[str], older_than_days: int):
    cutoff = timezone.now() - timedelta(days=older_than_days)
    found = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        # The name as Django stores it: relative to MEDIA_ROOT, forward slashes.
        name = path.relative_to(root).as_posix()
        if name in keep_names:
            continue
        modified = timezone.datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.get_current_timezone()
        )
        if modified > cutoff:
            continue
        found.append((name, path.stat().st_size, modified))
    return sorted(found)


class Command(BaseCommand):
    help = "Delete public media files no database row references. Dry run unless --yes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes", action="store_true", help="Actually delete. Without it, nothing is removed."
        )
        parser.add_argument(
            "--older-than",
            type=int,
            default=DEFAULT_AGE_DAYS,
            metavar="DAYS",
            help=(
                "Only prune files older than this. The default leaves a wide "
                "margin over the page cache, so a file a live page still "
                "references is never removed."
            ),
        )

    def handle(self, *args, **options):
        root = Path(settings.MEDIA_ROOT)
        if not root.exists():
            self.stdout.write(f"No media directory at {root}. Nothing to do.")
            return

        found = orphans(root, referenced_names(), options["older_than"])
        if not found:
            self.stdout.write("No orphaned files. Nothing to do.")
            return

        total = sum(size for _, size, _ in found)
        self.stdout.write(f"{len(found)} orphaned file(s), {total / 1024:.0f} KB:")
        for name, size, modified in found[:20]:
            self.stdout.write(f"  {name}  ({size / 1024:.0f} KB, {modified:%Y-%m-%d})")
        if len(found) > 20:
            self.stdout.write(f"  ... and {len(found) - 20} more")

        if not options["yes"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --yes to delete."))
            return

        removed = 0
        for name, _, _ in found:
            (root / name).unlink(missing_ok=True)
            removed += 1
        self.stdout.write(
            self.style.SUCCESS(f"\nDeleted {removed} file(s), {total / 1024:.0f} KB freed.")
        )
