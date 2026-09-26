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


@transaction.atomic
def account_for_verified_phone(*, phone, verified_at, display_name=""):
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
    account.save(update_fields=fields)

    link_history(account)
    account._just_created = created
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


def verified_email_for(phone):
    """The address to copy a phone sign-in code to, or None.

    Verified only. An address someone typed but never proved is not theirs to
    receive a sign-in code at — that is the whole point of the two-step claim
    on the settings screen.

    Inactive accounts are excluded for the same reason they cannot sign in.
    """
    return (
        TraineeAccount.objects.filter(phone=phone, is_active=True, email_verified_at__isnull=False)
        .values_list("email", flat=True)
        .first()
    )
