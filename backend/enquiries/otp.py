"""One-time codes for trainee phone verification.

Codes are stored hashed. A leaked database backup should not hand anyone a list
of live verification codes, and there is no reason to keep the plaintext once
the SMS is away.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import F
from django.utils import timezone

from core.sms import send_sms

from .models import PhoneVerification


class OTPError(Exception):
    """Raised with a message safe to show a trainee."""


def _generate_code():
    upper = 10**settings.OTP_CODE_LENGTH
    return f"{secrets.randbelow(upper):0{settings.OTP_CODE_LENGTH}d}"


def request_code(
    phone,
    ip_address=None,
    *,
    purpose=PhoneVerification.Purpose.TRAINEE_ENQUIRY,
):
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
        purpose=purpose,
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
        ip_address=ip_address,
    )

    send_sms(
        phone,
        f"{code} is your {settings.BRAND_NAME} Skills Hub code. It expires in 10 minutes.",
    )
    return verification


def verify_code(
    phone,
    code,
    *,
    purpose=PhoneVerification.Purpose.TRAINEE_ENQUIRY,
    challenge_id=None,
):
    """Return the verification on success, raise OTPError otherwise."""
    candidates = PhoneVerification.objects.filter(
        phone=phone,
        purpose=purpose,
        verified_at__isnull=True,
    )
    if challenge_id is not None:
        candidates = candidates.filter(challenge_id=challenge_id)
    verification = candidates.order_by("-created_at").first()

    if verification is None:
        raise OTPError("No code was requested for this number.")
    if verification.is_expired:
        raise OTPError("That code has expired. Request a new one.")
    # The limit check and increment are one conditional database operation.
    # Two simultaneous guesses against the last available attempt cannot both
    # pass by reading the same stale counter.
    attempted = PhoneVerification.objects.filter(
        pk=verification.pk,
        verified_at__isnull=True,
        attempts__lt=settings.OTP_MAX_ATTEMPTS,
    ).update(attempts=F("attempts") + 1)
    if not attempted:
        raise OTPError("Too many incorrect attempts. Request a new code.")

    if not check_password(code, verification.code_hash):
        raise OTPError("That code is not correct.")

    verified_at = timezone.now()
    # Consuming the challenge is conditional, so two correct requests racing
    # each other cannot both establish sessions from one code.
    consumed = PhoneVerification.objects.filter(
        pk=verification.pk,
        verified_at__isnull=True,
    ).update(verified_at=verified_at)
    if not consumed:
        raise OTPError("That code has already been used. Request a new one.")
    verification.verified_at = verified_at
    verification.attempts += 1
    return verification


def phone_is_trusted(phone):
    """True when this number verified recently enough to skip a fresh code.

    This is what makes "enquire with three providers" cost one SMS rather than
    three.
    """
    cutoff = timezone.now() - timedelta(seconds=settings.OTP_SESSION_TRUST_SECONDS)
    return PhoneVerification.objects.filter(
        phone=phone,
        purpose=PhoneVerification.Purpose.TRAINEE_ENQUIRY,
        verified_at__gte=cutoff,
    ).exists()
