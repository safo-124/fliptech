"""Signing in from the mobile app: a token in a header instead of a cookie.

The website keeps a person signed in with Django's session cookie and guards
every change with a CSRF token. An app has neither: it keeps a token it was
given at sign-in and sends it on every request as

    Authorization: Bearer <token>

AppTokenMiddleware turns that header into `request.user`, before any view
runs, so every endpoint the website uses works for the app unchanged
(SessionAuthentication reads the same `request.user`). Such a request is
excused the CSRF check: CSRF is an attack on a credential the browser adds by
itself, a cookie, and a header the app writes deliberately is not one.

A token that is unknown, revoked or belongs to a disabled user is ignored:
the request carries on as anonymous, and the endpoint answers as it would to
anyone signed out.
"""

import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from .models import AppToken

PREFIX = "Bearer "
# How often last_used_at is written: a phone making a request a second must
# not mean a database write a second.
TOUCH_EVERY = timedelta(hours=1)


def _hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_token(user, device=""):
    """A new sign-in for this user. The raw token is returned once, here."""
    raw = f"flt_{secrets.token_urlsafe(32)}"
    AppToken.objects.create(user=user, key_hash=_hash(raw), device=device[:120])
    return raw


def token_from(request):
    header = request.META.get("HTTP_AUTHORIZATION", "")
    if not header.startswith(PREFIX):
        return None
    raw = header[len(PREFIX) :].strip()
    if not raw:
        return None
    return (
        AppToken.objects.select_related("user")
        .filter(key_hash=_hash(raw), revoked_at__isnull=True, user__is_active=True)
        .first()
    )


def revoke(token):
    if token is not None and token.revoked_at is None:
        token.revoked_at = timezone.now()
        token.save(update_fields=["revoked_at"])


class AppTokenMiddleware:
    """After AuthenticationMiddleware: a valid bearer token signs the request in."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.META.get("HTTP_AUTHORIZATION", "").startswith(PREFIX):
            token = token_from(request)
            # Whatever the cookie said, a request with a token is that token's.
            from django.contrib.auth.models import AnonymousUser

            request.user = token.user if token is not None else AnonymousUser()
            request.app_token = token
            request._dont_enforce_csrf_checks = True
            if token is not None:
                now = timezone.now()
                if token.last_used_at is None or now - token.last_used_at > TOUCH_EVERY:
                    AppToken.objects.filter(pk=token.pk).update(last_used_at=now)
        return self.get_response(request)


def from_app(request):
    """Whether this request came from the mobile app (signed in with a token).
    Takes a DRF request or a Django one."""
    django_request = getattr(request, "_request", request)
    return getattr(django_request, "app_token", None) is not None


def payment_return(request, web_url):
    """Where Paystack sends the payer back to when they have paid.

    On the website, its own page (`web_url`). From the app, the website's
    /app-return bridge, which opens the app again with the payment's
    reference (Paystack adds it to the address), so the payer lands back
    where they started rather than in a browser.
    """
    from django.conf import settings

    if from_app(request):
        return f"{settings.PUBLIC_SITE_URL.rstrip('/')}/app-return"
    return web_url
