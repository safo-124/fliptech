from django.db import connection
from django.http import JsonResponse


def health(request):
    """Liveness probe that also proves PostGIS is reachable.

    A plain 200 would go on passing if the spatial extension vanished, which is
    the failure that breaks provider search.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT postgis_version()")
            postgis = cursor.fetchone()[0]
    except Exception as exc:  # noqa: BLE001 - report, do not raise, on a probe
        return JsonResponse({"status": "error", "detail": str(exc)}, status=503)
    return JsonResponse({"status": "ok", "postgis": postgis})
