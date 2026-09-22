"""Where the browser can actually fetch a public media file.

Not answerable from the incoming request. A server-rendered page reaches
Django over loopback carrying X-Forwarded-Proto: https, because that is what
stops SECURE_SSL_REDIRECT bouncing it, and DJANGO_ALLOWED_HOSTS has to list
127.0.0.1 because Node's fetch will not set a Host header. Put those two
together and request.build_absolute_uri() returns

    https://127.0.0.1:8000/media/...

which is not a URL that has ever existed: nothing serves TLS on that port, and
the address is the server talking to itself. next/image rejected it outright,
which is why every workshop photograph on the search page was a broken box.

The public origin is a fact about the deployment, not about whichever request
happens to be asking, so it is configuration.
"""

from urllib.parse import urljoin

# No Django imports at module level, and no models: settings.py imports
# derive_public_origin while it is still being evaluated, so anything that
# touches the settings object or the app registry here would deadlock.
LOOPBACK = {"localhost", "127.0.0.1", "[::1]", "::1"}


def derive_public_origin(csrf_trusted_origins, allowed_hosts, *, debug):
    """Work out the public origin from what a deployment already configures.

    Preferred source is CSRF_TRUSTED_ORIGINS, which carries a scheme. But a
    single-origin deployment behind Caddy does not need it — Django compares
    Origin against the host and passes — so it is often legitimately empty.
    ALLOWED_HOSTS is then the fallback: its first public entry is the name the
    site answers to, which is exactly what deploy.sh probes with.

    Returns "" in development, where the request is a truthful source and
    Django serves its own media anyway.
    """
    if debug:
        return ""
    for origin in csrf_trusted_origins:
        if "*" not in origin:
            return origin.rstrip("/")
    for host in allowed_hosts:
        if "*" not in host and host.lower() not in LOOPBACK:
            return f"https://{host}"
    return ""


def public_url(file_url, request=None):
    """Absolute URL for a file under MEDIA_URL.

    Falls back to the request when no public origin is configured, which keeps
    development — where Django serves its own media and the two are genuinely
    the same host — working exactly as before.
    """
    from django.conf import settings

    if not file_url:
        return None
    origin = settings.PUBLIC_ORIGIN
    if origin:
        return urljoin(f"{origin}/", file_url.lstrip("/"))
    if request is not None:
        return request.build_absolute_uri(file_url)
    return file_url
