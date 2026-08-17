"""PostgreSQL extensions.

This must be the first migration that runs against a fresh database, before any
model migration that declares a geometry field or a trigram index.

Enforce that by having the catalog app's 0001 depend on this one:

    class Migration(migrations.Migration):
        initial = True
        dependencies = [("core", "0001_extensions")]

Permissions: CREATE EXTENSION requires superuser (or rds_superuser / the
cloudsqlsuperuser equivalent). On a self-managed Hetzner Postgres this is fine
because you own the box. If the app's database role is not superuser, run these
four statements once as postgres before the first `migrate`, and this migration
becomes a no-op because every CreateExtension is IF NOT EXISTS underneath.

System packages required on the server for PostGIS + GeoDjango:
    apt install postgresql-17-postgis-3 gdal-bin libgdal-dev binutils libproj-dev
"""

from django.contrib.postgres.operations import (
    BtreeGinExtension,
    CreateExtension,
    TrigramExtension,
    UnaccentExtension,
)
from django.db import migrations


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        # Section 05: radius search ("providers within 10km of a point") as an
        # indexed query. Required by Provider.location.
        CreateExtension("postgis"),

        # ADDED - not in the PDF. Plain Postgres full-text search will not match
        # "welder" to "welding", "sewing" to "tailoring", or "vulcanizer" to
        # "vulcanising", which is exactly how people type. Trigram similarity
        # handles misspellings and stems that FTS misses. Costs nothing now,
        # and retrofitting the index later means a rewrite of the search view.
        TrigramExtension(),

        # ADDED - strips diacritics so search is insensitive to them.
        UnaccentExtension(),

        # ADDED - lets a single GIN index cover a trigram/tsvector column
        # together with scalar filters (trade_id, area_id, fee ceiling), which
        # is the exact shape of the Screen 1 filter bar.
        BtreeGinExtension(),
    ]
