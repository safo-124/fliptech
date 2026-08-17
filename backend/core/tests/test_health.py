"""The health probe is the one endpoint that must never regress silently.

It asserts PostGIS is reachable, not merely that Django returns 200, because a
missing spatial extension breaks provider search while leaving the rest of the
site apparently healthy.
"""

import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_reports_postgis(client):
    response = client.get(reverse("health"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["postgis"].startswith("3.")


@pytest.mark.django_db
def test_required_extensions_are_installed(django_db_setup, django_db_blocker):
    """pg_trgm and unaccent are not default. Section 05's search depends on both."""
    with django_db_blocker.unblock():
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("SELECT extname FROM pg_extension")
            installed = {row[0] for row in cursor.fetchall()}

    assert {"postgis", "pg_trgm", "unaccent", "btree_gin"} <= installed


@pytest.mark.django_db
def test_trigram_matches_what_full_text_search_cannot():
    """'welder' should match 'welding'. Plain FTS does not manage this."""
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("SELECT similarity('welding', 'welder')")
        score = cursor.fetchone()[0]

    assert score > 0.3
