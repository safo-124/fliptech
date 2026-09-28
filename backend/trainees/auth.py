"""Creation, lookup and history linking for trainee accounts."""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.identities import create_dedicated_user, user_is_unprivileged

from .models import TraineeAccount


class TraineeAccountDisabled(ValueError):
    pass


def link_history(account):
    """Attach earlier enquiries and enrolments made with this number.

    Only rows with no trainee yet are touched, so a record that staff have
    deliberately pointed at a different account is never moved.
    """
    from enquiries.models import Enquiry, Enrolment

    enquiries = Enquiry.objects.filter(trainee__isnull=True, trainee_phone=account.phone).update(
        trainee=account
    )
    enrolments = Enrolment.objects.filter(trainee__isnull=True, trainee_phone=account.phone).update(
        trainee=account
    )
    return enquiries, enrolments


# What the sign-up form may fill in, beyond the number. Every one is optional,
# and none of them is ever a condition of having an account: Section 03 names
# extra steps as what makes people give up, so the form collects while the
# account is created regardless.
SIGN_UP_FIELDS = (
    "display_name",
    "education_level",
    "institution_name",
    "field_of_study",
    "education_status",
    "education_year",
)


def _fill_blanks(account, profile):
    """Write the optional details, without overwriting anything already there.

    Someone signing in through the sign-up form — which is the same form, and
    says so — must not lose what they filled in last time because the boxes
    happened to be empty in this browser.
    """
    changed = []
    for field in SIGN_UP_FIELDS:
        value = profile.get(field)
        if value in (None, ""):
            continue
        if getattr(account, field):
            continue
        setattr(account, field, value)
        changed.append(field)
    return changed


# Why a typed address was or was not attached, for telling the person.
EMAIL_ADDED = "added"
EMAIL_ALREADY_SET = "already_set"
EMAIL_TAKEN = "taken"


def _claim_email(account, email):
    """Attach a typed address, unverified, if no other account holds it.

    Returns (changed fields, outcome). The outcome is reported to the caller
    rather than swallowed: silently dropping the address leaves somebody
    believing they gave us an email, then wondering later why sign-in codes
    never reach it.

    It is told to them only after they have proved the phone. Saying "that
    address is already registered" to an unauthenticated caller would be an
    account-enumeration oracle — anybody could test addresses for free.
    Behind a verified code it costs a working phone and a code per guess, and
    tells the one person who actually needs to know.

    Deliberately not marked verified. One code goes to the phone and to this
    address, so entering it proves control of one of them and not both — and
    treating that as proof would let somebody attach a stranger's address by
    reading their own text message.
    """
    from .models import TraineeAccount

    if not email:
        return [], None
    if account.email:
        return [], EMAIL_ALREADY_SET
    if TraineeAccount.objects.filter(email=email).exclude(pk=account.pk).exists():
        return [], EMAIL_TAKEN
    account.email = email
    return ["email"], EMAIL_ADDED


@transaction.atomic
def account_for_verified_phone(*, phone, verified_at, display_name="", profile=None):
    """Return the trainee account for a phone that has just proved ownership.

    Creates the account on first use. Raises TraineeAccountDisabled for an
    account staff have switched off, or one whose user has somehow gained
    privileges, so a phone login can never become a staff login.
    """
    account = (
        TraineeAccount.objects.select_for_update()
        .select_related("user")
        .filter(phone=phone)
        .first()
    )
    created = False
    if account is None:
        user = create_dedicated_user(get_user_model(), prefix="trainee")
        try:
            with transaction.atomic():
                account = TraineeAccount.objects.create(
                    phone=phone,
                    user=user,
                    phone_verified_at=verified_at,
                    display_name=display_name[:120],
                )
                created = True
        except IntegrityError:
            user.delete()
            account = (
                TraineeAccount.objects.select_for_update().select_related("user").get(phone=phone)
            )

    if not account.is_active or not user_is_unprivileged(account.user):
        raise TraineeAccountDisabled("This account has been switched off. Contact support.")

    fields = ["phone_verified_at", "last_seen_at", "updated_at"]
    account.phone_verified_at = verified_at
    account.last_seen_at = timezone.now()
    if display_name and not account.display_name:
        account.display_name = display_name[:120]
        fields.append("display_name")
    email_outcome = None
    if profile:
        fields += _fill_blanks(account, profile)
        changed, email_outcome = _claim_email(account, profile.get("email"))
        fields += changed
    account.save(update_fields=fields)

    link_history(account)
    account._just_created = created
    # Read by the view, which is the only place that knows whether there is
    # anybody to tell.
    account._email_outcome = email_outcome
    return account


def account_for_verified_email(*, email, verified_at):
    """Return the trainee account that owns an address that just proved itself.

    Unlike the phone path this never creates an account. Email is a second door
    into an existing one, and the phone is still the identity: it is what a
    workshop replies to on WhatsApp, so an account created from an address
    alone would have nowhere to send an enquiry. Someone whose address is not
    on any account is told to sign in with their phone and add it there.

    The error deliberately does not distinguish "no account has this address"
    from anything else, so this endpoint cannot be used to discover which
    addresses are registered.
    """
    from enquiries.email_otp import normalise_email

    account = (
        TraineeAccount.objects.select_for_update()
        .select_related("user")
        .filter(email=normalise_email(email))
        .first()
    )
    if account is None:
        raise TraineeAccountDisabled(
            "That address is not on an account yet. Sign in with your phone number, "
            "then add your email from your account page."
        )

    if not account.is_active or not user_is_unprivileged(account.user):
        raise TraineeAccountDisabled("This account has been switched off. Contact support.")

    account.email_verified_at = verified_at
    account.last_seen_at = timezone.now()
    account.save(update_fields=["email_verified_at", "last_seen_at", "updated_at"])

    link_history(account)
    account._just_created = False
    return account


def code_address_for(phone):
    """(address, is_verified) for copying a sign-in code to, or (None, False).

    Any address on the account, not only a proven one. Requiring proof read
    well until you follow it through: somebody signs up giving their email,
    gets the code both ways, and on their next sign-in it goes to the phone
    alone — which on a prepaid network may be exactly the message that does
    not arrive, and on this deployment is not sent at all. Being asked to
    prove an address you cannot receive the proof for is a locked door.

    The risk this accepts is bounded and worth naming. Somebody could sign up
    with their own phone and a stranger's address, and that stranger would
    then get a code every time they signed in. It is a nuisance rather than a
    way in — the code is useless without the phone it was issued for — and the
    caller caps unverified addresses at the same few per day as the email door
    itself, so it cannot become a flood.

    Inactive accounts are excluded for the same reason they cannot sign in.
    """
    row = (
        TraineeAccount.objects.filter(phone=phone, is_active=True)
        .exclude(email=None)
        .values_list("email", "email_verified_at")
        .first()
    )
    if not row:
        return None, False
    email, verified_at = row
    return email, verified_at is not None
