"""One-time codes for trainee phone verification.

Codes are stored hashed. A leaked database backup should not hand anyone a list
of live verification codes, and there is no reason to keep the plaintext once
the SMS is away.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

from core.sms import send_sms

from .models import PhoneVerification


class OTPError(Exception):
    """Raised with a message safe to show a trainee."""


def _generate_code():
    upper = 10**settings.OTP_CODE_LENGTH
    return f"{secrets.randbelow(upper):0{settings.OTP_CODE_LENGTH}d}"


def request_code(phone, ip_address=None):
    """Issue and send a code, subject to the daily caps."""
    since = timezone.now() - timedelta(days=1)

    if PhoneVerification.objects.filter(phone=phone, created_at__gte=since).count() >= (
        settings.OTP_MAX_PER_PHONE_PER_DAY
    ):
        raise OTPError("Too many codes requested for this number today. Try again tomorrow.")

    if ip_address and PhoneVerification.objects.filter(
        ip_address=ip_address, created_at__gte=since
    ).count() >= (settings.OTP_MAX_PER_IP_PER_DAY):
        raise OTPError("Too many codes requested from this connection today.")

    code = _generate_code()
    verification = PhoneVerification.objects.create(
        phone=phone,
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
        ip_address=ip_address,
    )

    send_sms(
        phone,
        f"{code} is your {settings.BRAND_NAME} Skills Hub code. It expires in 10 minutes.",
    )
    return verification


def verify_code(phone, code):
    """Return the verification on success, raise OTPError otherwise."""
    verification = (
        PhoneVerification.objects.filter(phone=phone, verified_at__isnull=True)
        .order_by("-created_at")
        .first()
    )

    if verification is None:
        raise OTPError("No code was requested for this number.")
    if verification.is_expired:
        raise OTPError("That code has expired. Request a new one.")
    if verification.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise OTPError("Too many incorrect attempts. Request a new code.")

    # Count the attempt before checking, so a crash mid-check cannot be used to
    # get a free guess.
    PhoneVerification.objects.filter(pk=verification.pk).update(attempts=verification.attempts + 1)

    if not check_password(code, verification.code_hash):
        raise OTPError("That code is not correct.")

    verification.verified_at = timezone.now()
    verification.save(update_fields=["verified_at"])
    return verification


def phone_is_trusted(phone):
    """True when this number verified recently enough to skip a fresh code.

    This is what makes "enquire with three providers" cost one SMS rather than
    three.
    """
    cutoff = timezone.now() - timedelta(seconds=settings.OTP_SESSION_TRUST_SECONDS)
    return PhoneVerification.objects.filter(phone=phone, verified_at__gte=cutoff).exists()
