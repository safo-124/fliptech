"""Check that a database is usable by this project before pointing it at production.

Run this against your VPS database *before* the first migrate. It reports what
is wrong in plain terms rather than failing halfway through a migration and
leaving a half-built schema behind.

    python manage.py check_database

It reads DATABASE_URL from .env like everything else, so no credentials are
passed on the command line or end up in your shell history.
"""

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection

REQUIRED_EXTENSIONS = ["postgis", "pg_trgm", "unaccent", "btree_gin"]
MINIMUM_PG_MAJOR = 14


class Command(BaseCommand):
    help = "Verify a PostgreSQL database can host this project (PostGIS, extensions, privileges)."

    def handle(self, *args, **options):
        ok = True

        engine = settings.DATABASES["default"]["ENGINE"]
        self.stdout.write(f"Engine:   {engine}")
        if "postgis" not in engine:
            ok = False
            self.stderr.write(
                self.style.ERROR(
                    "  DATABASE_URL must use the postgis:// scheme, not postgres://.\n"
                    "  Geometry fields need django.contrib.gis.db.backends.postgis."
                )
            )

        host = settings.DATABASES["default"].get("HOST") or "(local socket)"
        name = settings.DATABASES["default"].get("NAME")
        user = settings.DATABASES["default"].get("USER")
        self.stdout.write(f"Target:   {user}@{host}/{name}")

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT version()")
                version = cursor.fetchone()[0]
                self.stdout.write(f"Server:   {version.split(',')[0]}")

                cursor.execute("SHOW server_version_num")
                major = int(cursor.fetchone()[0]) // 10000
                if major < MINIMUM_PG_MAJOR:
                    ok = False
                    self.stderr.write(
                        self.style.ERROR(f"  PostgreSQL {major} is older than {MINIMUM_PG_MAJOR}.")
                    )

                # Is the connection encrypted? Anything crossing a network
                # without TLS is sending credentials and trainee phone numbers
                # in clear text.
                cursor.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
                row = cursor.fetchone()
                using_ssl = bool(row and row[0])
                if host not in ("localhost", "127.0.0.1", "(local socket)"):
                    if using_ssl:
                        self.stdout.write(self.style.SUCCESS("TLS:      on"))
                    else:
                        ok = False
                        self.stderr.write(
                            self.style.ERROR(
                                "  Connection is NOT encrypted, and the database is remote.\n"
                                "  Add ?sslmode=require to DATABASE_URL, or tunnel over the "
                                "private network."
                            )
                        )

                # Which of the four extensions this project needs are present,
                # and can the app role create the missing ones?
                cursor.execute("SELECT extname FROM pg_extension")
                installed = {r[0] for r in cursor.fetchall()}
                cursor.execute("SELECT name FROM pg_available_extensions")
                available = {r[0] for r in cursor.fetchall()}

                self.stdout.write("\nExtensions:")
                for extension in REQUIRED_EXTENSIONS:
                    if extension in installed:
                        self.stdout.write(self.style.SUCCESS(f"  installed  {extension}"))
                    elif extension in available:
                        self.stdout.write(
                            self.style.WARNING(
                                f"  available  {extension} (core.0001_extensions will create it)"
                            )
                        )
                    else:
                        ok = False
                        self.stderr.write(
                            self.style.ERROR(
                                f"  MISSING    {extension} — not installed on the server.\n"
                                f"             apt install postgresql-{major}-postgis-3"
                                if extension == "postgis"
                                else f"  MISSING    {extension} — not available on the server."
                            )
                        )

                cursor.execute(
                    "SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user"
                )
                superuser, createdb = cursor.fetchone()
                self.stdout.write(
                    f"\nRole:     superuser={superuser} createdb={createdb} (createdb is only needed to run tests)"
                )
                missing = [e for e in REQUIRED_EXTENSIONS if e not in installed]
                if missing and not superuser:
                    ok = False
                    self.stderr.write(
                        self.style.ERROR(
                            "  The app role is not a superuser and extensions are missing.\n"
                            "  CREATE EXTENSION needs superuser. Run these once as postgres:\n"
                            + "".join(f"    CREATE EXTENSION IF NOT EXISTS {e};\n" for e in missing)
                        )
                    )

        except Exception as exc:  # noqa: BLE001 - this command exists to report failures
            ok = False
            self.stderr.write(self.style.ERROR(f"\nCould not connect: {exc}"))
            self.stderr.write(
                "\nUsual causes, in order of likelihood:\n"
                "  - listen_addresses in postgresql.conf is still 'localhost'\n"
                "  - pg_hba.conf has no host entry for this client address\n"
                "  - the VPS firewall drops 5432\n"
                "  - the password in .env does not match the role"
            )

        self.stdout.write("")
        if ok:
            self.stdout.write(self.style.SUCCESS("Database is ready. Run migrate next."))
        else:
            self.stderr.write(self.style.ERROR("Database is NOT ready. Fix the items above first."))
            raise SystemExit(1)
