"""One-time codes sent to an email address.

The mirror of otp.py, with the same guarantees and for the same reasons:
codes are stored hashed, attempts are counted with a conditional update so two
simultaneous guesses cannot both spend the last one, and consuming a challenge
is conditional so one code cannot establish two sessions.

Two differences from the phone flow, both deliberate.

Addresses are normalised to lowercase before anything touches the database.
Mail addresses are case-insensitive in practice, and without this the daily
cap is per capitalisation — five codes for Ada@, five more for ada@, and so on
for as long as someone can hold down the shift key.

The per-address daily cap is lower than the phone one. An SMS costs us money,
which is its own brake; email costs nothing to send and the thing being
protected is the reputation of whatever address the mail leaves from, plus the
inbox of whoever's address was typed in. Someone else's address should not be
able to receive twenty codes a day because a stranger typed it.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import F
from django.utils import timezone

from core.mail import send_email

from .models import EmailVerification
from .otp import OTPError

# Codes per address per day. See the module docstring for why this is not
# OTP_MAX_PER_PHONE_PER_DAY.
MAX_PER_EMAIL_PER_DAY = 5


def normalise_email(email):
    """Lowercased and stripped. The one place this decision is made."""
    return (email or "").strip().lower()


def _generate_code():
    upper = 10**settings.OTP_CODE_LENGTH
    return f"{secrets.randbelow(upper):0{settings.OTP_CODE_LENGTH}d}"


def request_code(
    email,
    ip_address=None,
    *,
    purpose=EmailVerification.Purpose.TRAINEE_ACCESS,
):
    """Issue and send a code, subject to the daily caps."""
    email = normalise_email(email)
    since = timezone.now() - timedelta(days=1)

    if (
        EmailVerification.objects.filter(email=email, created_at__gte=since).count()
        >= MAX_PER_EMAIL_PER_DAY
    ):
        raise OTPError("Too many codes requested for this address today. Try again tomorrow.")

    if (
        ip_address
        and EmailVerification.objects.filter(ip_address=ip_address, created_at__gte=since).count()
        >= settings.OTP_MAX_PER_IP_PER_DAY
    ):
        raise OTPError("Too many codes requested from this connection today.")

    code = _generate_code()
    verification = EmailVerification.objects.create(
        email=email,
        purpose=purpose,
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
        ip_address=ip_address,
    )

    minutes = settings.OTP_TTL_SECONDS // 60
    brand = settings.BRAND_NAME
    send_email(
        email,
        f"{code} is your {brand} Skills Hub code",
        # Plain text, and the code is in the subject as well as the body: on a
        # phone the subject line is often all that is visible in the
        # notification, and copying it from there saves opening the message.
        f"{code} is your {brand} Skills Hub sign-in code.\n\n"
        f"It expires in {minutes} minutes and can be used once.\n\n"
        "If you did not ask for this code, you can ignore this message — "
        "someone typed your address by mistake, and nothing has happened to "
        "any account.\n",
    )
    return verification


def verify_code(
    email,
    code,
    *,
    purpose=EmailVerification.Purpose.TRAINEE_ACCESS,
    challenge_id=None,
):
    """Return the verification on success, raise OTPError otherwise."""
    email = normalise_email(email)
    candidates = EmailVerification.objects.filter(
        email=email,
        purpose=purpose,
        verified_at__isnull=True,
    )
    if challenge_id is not None:
        candidates = candidates.filter(challenge_id=challenge_id)
    verification = candidates.order_by("-created_at").first()

    if verification is None:
        raise OTPError("No code was requested for this address.")
    if verification.is_expired:
        raise OTPError("That code has expired. Request a new one.")

    # The limit check and increment are one conditional database operation, so
    # two simultaneous guesses against the last available attempt cannot both
    # pass by reading the same stale counter.
    attempted = EmailVerification.objects.filter(
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
    consumed = EmailVerification.objects.filter(
        pk=verification.pk,
        verified_at__isnull=True,
    ).update(verified_at=verified_at)
    if not consumed:
        raise OTPError("That code has already been used. Request a new one.")

    verification.verified_at = verified_at
    verification.attempts += 1
    return verification
