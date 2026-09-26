"""One-time codes for trainee phone verification.

Codes are stored hashed. A leaked database backup should not hand anyone a list
of live verification codes, and there is no reason to keep the plaintext once
the SMS is away.

A code can go out on two channels at once. The phone number is the identity
and the SMS is the primary delivery, but an SMS on a prepaid Ghanaian network
is not reliable — which is the whole reason email sign-in exists as a second
door. Sending the same code to the address already on the account means
somebody whose text never arrives does not have to work out that the other
door exists; they just read their email.

One code, two deliveries, not two codes. A second code would invalidate
nothing but would leave two live challenges for one sign-in, and whichever
arrived second would be the only one that worked.
"""

import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import F
from django.utils import timezone

from core.mail import send_email
from core.sms import send_sms

from .models import PhoneVerification

logger = logging.getLogger(__name__)


class OTPError(Exception):
    """Raised with a message safe to show a trainee."""


def _generate_code():
    upper = 10**settings.OTP_CODE_LENGTH
    return f"{secrets.randbelow(upper):0{settings.OTP_CODE_LENGTH}d}"


def _also_email(email, code):
    """Deliver the same code to the account's address.

    Never raises. The SMS has already gone, so the sign-in works whatever
    happens here; failing the request because a mail server was slow would
    take away the code that did arrive.

    Deliberately does not create an EmailVerification row. This is a second
    delivery of one challenge, not a second challenge, and counting it against
    the per-address daily cap would mean five phone sign-ins locked somebody
    out of the email door they had not even used.
    """
    minutes = settings.OTP_TTL_SECONDS // 60
    brand = settings.BRAND_NAME
    try:
        send_email(
            email,
            f"{code} is your {brand} Skills Hub code",
            f"{code} is your {brand} Skills Hub sign-in code.\n\n"
            f"It expires in {minutes} minutes and can be used once.\n\n"
            "We sent it to your phone as well, in case the text does not "
            "arrive.\n\n"
            "If you did not try to sign in, you can ignore this message. "
            "Nothing has happened to your account, and whoever typed your "
            "number cannot get in without this code.\n",
        )
    except Exception:
        # Logged rather than swallowed silently: a mail backend that is failing
        # every time is worth finding in the journal.
        logger.warning("Could not email the sign-in code as well as texting it", exc_info=True)


def request_code(
    phone,
    ip_address=None,
    *,
    purpose=PhoneVerification.Purpose.TRAINEE_ENQUIRY,
    email=None,
):
    """Issue and send a code, subject to the daily caps.

    `email` is the verified address on the account this number belongs to, or
    None. Callers look it up, because this module has no business importing
    trainee or provider models.
    """
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
    if email:
        _also_email(email, code)
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
    # A trainee who signed in to their account proved the same thing. A trainer
    # sign-in does not count: that code was issued for a different purpose.
    return PhoneVerification.objects.filter(
        phone=phone,
        purpose__in=[
            PhoneVerification.Purpose.TRAINEE_ENQUIRY,
            PhoneVerification.Purpose.TRAINEE_ACCESS,
        ],
        verified_at__gte=cutoff,
    ).exists()
