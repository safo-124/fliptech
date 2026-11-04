"""Recording a search for the staff report. Never lets a failure reach the
visitor: a search that worked must not error because the log could not."""

import logging

from .models import SearchLog
from .understand import normalise

logger = logging.getLogger(__name__)


def source(request):
    """The app says so in a header; everything else is the website."""
    if request is not None and request.headers.get("X-Fliptech-Client") == "app":
        return SearchLog.Source.APP
    return SearchLog.Source.WEB


def record(query, scope, results, request=None):
    query = normalise(query)
    if len(query) < 2:
        return
    try:
        SearchLog.objects.create(
            query=query, scope=scope, results=max(0, int(results or 0)), source=source(request)
        )
    except Exception:  # pragma: no cover - logged, never raised
        logger.exception("Could not record a search")
