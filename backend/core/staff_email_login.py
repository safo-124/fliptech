"""Signing in to the back office with an emailed one-time code.

An alternative to the username and password form, not a replacement. The
password route and its django-axes lockout are untouched.

Read this before enabling it in production
------------------------------------------
This makes back-office access exactly as strong as the staff member's mailbox.
A password plus axes means an attacker needs the password; this means they need
the inbox. For a field officer that is usually a fair trade — they are on a
phone, they forget passwords, and a locked-out officer during a site visit is a
lost provider. For a superuser it is a real reduction, because the account that
can publish listings and open trainee records is now reachable by whoever
controls that mailbox.

So it is gated on STAFF_EMAIL_LOGIN_ENABLED, and it is off unless turned on.
Turn it on once mail actually delivers, and consider giving superusers
addresses on a mailbox with its own second factor.

While EMAIL_PROVIDER is "console" the code is written to the server journal
rather than sent, which means only someone who already has server access can
read it. That is not a security property to rely on; it is a reason this is
not useful yet.

What it will not do
-------------------
Sign in anyone who is not already active staff. The code proves control of an
address; it never creates a user, never grants is_staff, and a matching address
on a non-staff account is refused exactly like an unknown one.
"""

import logging

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model, login
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from django_ratelimit.core import is_ratelimited

from core.network import canonical_client_ip, ratelimit_client_ip
from enquiries import email_otp
from enquiries.models import EmailVerification
from enquiries.otp import OTPError

logger = logging.getLogger(__name__)

TEMPLATE = "admin/email_login.html"


def _enabled():
    return getattr(settings, "STAFF_EMAIL_LOGIN_ENABLED", False)


def _staff_user_for(email):
    """The active staff user with this address, or None.

    Case-insensitive, because Django stores User.email as typed and a staff
    member will not reproduce their own capitalisation on a phone keyboard.
    """
    return (
        get_user_model().objects.filter(email__iexact=email, is_active=True, is_staff=True).first()
    )


def _render(request, *, step, email="", challenge_id="", error=None):
    return render(
        request,
        TEMPLATE,
        {
            "step": step,
            "email": email,
            "challenge_id": challenge_id,
            "error": error,
            "title": "Sign in with a code",
            "code_length": settings.OTP_CODE_LENGTH,
        },
    )


@never_cache
@csrf_protect
@require_http_methods(["GET", "POST"])
def staff_email_login(request):
    if not _enabled():
        messages.error(request, "Signing in by email is not enabled.")
        return HttpResponseRedirect(reverse("admin:login"))

    if request.user.is_authenticated and request.user.is_staff:
        return HttpResponseRedirect(reverse("admin:index"))

    if request.method == "GET":
        return _render(request, step="email")

    step = request.POST.get("step", "email")
    email = email_otp.normalise_email(request.POST.get("email", ""))

    if step == "email":
        return _request_code(request, email)
    return _verify_code(request, email)


def _request_code(request, email):
    if not email:
        return _render(request, step="email", error="Enter your email address.")

    if is_ratelimited(
        request,
        group="staff-email-login-request",
        key=ratelimit_client_ip,
        rate="5/m",
        increment=True,
    ):
        return _render(
            request,
            step="email",
            email=email,
            error="Too many requests. Wait a minute and try again.",
        )

    user = _staff_user_for(email)

    # A code is only ever issued to a real staff address, but the screen that
    # follows is identical either way. Otherwise this page reports which
    # addresses belong to staff, which is a list worth having if you intend to
    # attack the back office.
    challenge_id = ""
    if user is not None:
        try:
            challenge = email_otp.request_code(
                email,
                ip_address=canonical_client_ip(request),
                purpose=EmailVerification.Purpose.STAFF_ACCESS,
            )
            challenge_id = str(challenge.challenge_id)
        except OTPError as exc:
            return _render(request, step="email", email=email, error=str(exc))
    else:
        logger.info("Back-office code requested for an address with no staff account")

    return _render(request, step="code", email=email, challenge_id=challenge_id)


def _verify_code(request, email):
    code = (request.POST.get("code") or "").strip()
    challenge_id = request.POST.get("challenge_id") or ""

    if is_ratelimited(
        request,
        group="staff-email-login-verify",
        key=ratelimit_client_ip,
        rate="10/m",
        increment=True,
    ):
        return _render(
            request,
            step="code",
            email=email,
            challenge_id=challenge_id,
            error="Too many attempts. Wait a minute and try again.",
        )

    # An empty challenge means no code was ever issued — the address had no
    # staff account. Fail here, with the same message a wrong code gets.
    if not challenge_id:
        return _render(
            request,
            step="code",
            email=email,
            error="That code is not correct.",
        )

    try:
        email_otp.verify_code(
            email,
            code,
            purpose=EmailVerification.Purpose.STAFF_ACCESS,
            challenge_id=challenge_id,
        )
    except OTPError as exc:
        return _render(request, step="code", email=email, challenge_id=challenge_id, error=str(exc))

    # Re-read rather than trusting the earlier lookup: the account may have
    # been switched off or had staff access removed while the code was in
    # someone's inbox.
    user = _staff_user_for(email)
    if user is None:
        return _render(
            request,
            step="code",
            email=email,
            error="That account can no longer sign in here.",
        )

    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    logger.info("Back-office sign-in by emailed code for user %s", user.pk)
    return HttpResponseRedirect(request.POST.get("next") or reverse("admin:index"))
