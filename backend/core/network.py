"""Canonical client address handling for requests behind the local proxy."""

from ipaddress import ip_address, ip_network

from django.conf import settings


def _normalise_ip(value):
    if not value:
        return None
    try:
        address = ip_address(str(value).strip())
    except ValueError:
        return None
    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.compressed


def canonical_client_ip(request):
    """Return one normalised address, trusting XFF only from configured Caddy.

    The API service is bound behind the sole Caddy proxy. Under systemd that
    peer is loopback; under Compose it is a private bridge address. A peer
    outside TRUSTED_PROXY_CIDRS can supply any X-Forwarded-For value it likes,
    so its header is ignored. With a single trusted proxy, the rightmost valid
    XFF entry is the client address Caddy appended (or the only entry when
    Caddy replaced the header).
    """

    remote = _normalise_ip(request.META.get("REMOTE_ADDR"))
    if remote is None:
        return None

    remote_address = ip_address(remote)
    trusted_proxy = False
    for value in settings.TRUSTED_PROXY_CIDRS:
        try:
            if remote_address in ip_network(value, strict=False):
                trusted_proxy = True
                break
        except ValueError:
            # An invalid deployment value must fail closed for forwarding
            # headers. Django still falls back to the real socket peer below.
            continue

    if trusted_proxy:
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        for candidate in reversed(forwarded.split(",")):
            normalised = _normalise_ip(candidate)
            if normalised is not None:
                return normalised
    return remote


def ratelimit_client_ip(group, request):
    """django-ratelimit key callable using the same address stored for caps."""

    return canonical_client_ip(request) or "unknown"
