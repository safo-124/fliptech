"""Links from the back office to the public site.

The back office and the public site are two servers. In production Caddy puts
them on one domain, so a relative link like "/trades/welding" happens to reach
the site. In development the back office is on :8000 and the site on its own
port, and the same link is a Django 404. Building every link from
PUBLIC_SITE_URL makes it the site's address in both.

With PUBLIC_SITE_URL unset the path is returned as it is: relative, which is
still right wherever the two share a domain.
"""

from urllib.parse import urljoin, urlsplit, urlunsplit

from django.conf import settings

LOOPBACK_HOSTS = {"localhost", "127.0.0.1"}


def public_site_url(path="/", request=None):
    """The public site's address for `path`.

    Given the request, a development link keeps the loopback name staff used
    for the back office (localhost or 127.0.0.1). Browsers treat the two as
    different sites and would not send the staff session cookie across them,
    which is what support mode relies on.
    """
    base = settings.PUBLIC_SITE_URL
    if not base:
        return "/" + path.lstrip("/")

    parts = urlsplit(base)
    if request is not None and parts.hostname in LOOPBACK_HOSTS:
        request_host = request.get_host().rsplit(":", 1)[0]
        if request_host in LOOPBACK_HOSTS and request_host != parts.hostname:
            netloc = request_host + (f":{parts.port}" if parts.port else "")
            base = urlunsplit(parts._replace(netloc=netloc))
    return urljoin(base.rstrip("/") + "/", path.lstrip("/"))


def provider_page_url(provider):
    """A provider's public profile, or None while it has none.

    Only a published listing has a page; linking to a draft would send staff
    to a "not found" and look like a broken site.
    """
    from providers.models import Provider

    if provider.status != Provider.Status.PUBLISHED:
        return None
    return public_site_url(f"{provider.area.slug}/{provider.slug}")
