"""Passwordless phone identities shared by every kind of account.

Both kinds of account sit on a dedicated Django user that can never log in to
the back office: no password, no staff flag, no groups, no permissions. The
checks live here once so the trainer and trainee flows cannot drift apart on
the property that matters most, which is that a phone login can never become a
staff login.
"""

from uuid import uuid4

from django.core.exceptions import ObjectDoesNotExist
from django.db import IntegrityError, transaction


def create_dedicated_user(user_model, *, prefix):
    """Create a fresh nonprivileged identity; never adopt an existing user."""

    for _attempt in range(3):
        try:
            with transaction.atomic():
                user = user_model(
                    username=f"{prefix}-{uuid4().hex}",
                    is_active=True,
                    is_staff=False,
                    is_superuser=False,
                )
                user.set_unusable_password()
                user.save(force_insert=True)
                return user
        except IntegrityError:
            # A UUID username collision is extraordinarily unlikely, but a
            # retry keeps the safety property structural instead of assuming.
            continue
    raise IntegrityError(f"Could not allocate a unique {prefix} identity.")


def user_is_unprivileged(user):
    """True only for a user that a phone login is allowed to establish."""
    return (
        user.is_active
        and not user.is_staff
        and not user.is_superuser
        and not user.has_usable_password()
        and not user.groups.exists()
        and not user.user_permissions.exists()
    )


# --------------------------------------------------------------------------
# One person, one login
#
# A person signs in with their phone and holds whichever of these they have
# asked for: a customer account (everyone), and a trainee, trainer or seller
# profile on top. All of them hang off the same Django user, so one sign-in
# opens every part of the site that person uses. Before this, each kind of
# account created its own user, and the same phone could be two or three
# unrelated logins; `manage.py merge_phone_accounts` joins those up.

ROLE_RELATIONS = ("customer_account", "trainer_account", "seller_account", "trainee_account")


def _role_models():
    from accounts.models import CustomerAccount
    from marketplace.models import SellerAccount
    from providers.models import TrainerAccount
    from trainees.models import TraineeAccount

    # In order of preference when more than one login exists for a number
    # (only possible before the merge): the customer account is the one the
    # single sign-in creates, then the roles with the most hanging off them.
    return (CustomerAccount, TrainerAccount, SellerAccount, TraineeAccount)


def person_user(phone):
    """The existing login for this phone, from any of its accounts, or None.

    Only a user a phone login may use: active and without privileges. A
    member of staff who also sells gets a separate login, as before, so a
    phone code can never open the back office.
    """
    for model in _role_models():
        account = model.objects.select_related("user").filter(phone=phone).first()
        if account is not None and user_is_unprivileged(account.user):
            return account.user
    return None


def user_for_new_role(user_model, phone, *, prefix):
    """The login a new account for this phone should hang off."""
    return person_user(phone) or create_dedicated_user(user_model, prefix=prefix)


def roles_of(user):
    """Which of the four accounts this login holds, by relation name."""
    held = []
    for relation in ROLE_RELATIONS:
        try:
            getattr(user, relation)
        except ObjectDoesNotExist:
            continue
        held.append(relation)
    return held


def delete_user_if_unused(user):
    """Delete a phone login once nothing hangs off it any more.

    Closing a trainee account used to delete the login with it, which is
    right only while the login is nothing else; it may now also be someone's
    shop or workshop.
    """
    if user_is_unprivileged(user) and not roles_of(user):
        user.delete()
        return True
    return False


def signed_in_phones(request):
    """The phone numbers the signed-in person has proved, across their accounts."""
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated or user.is_staff:
        return set()
    phones = set()
    for relation in roles_of(user):
        account = getattr(user, relation)
        if getattr(account, "is_active", True) and account.phone:
            phones.add(str(account.phone))
    return phones


def phone_vouched_for(request, phone):
    """True when this request may act for this phone without another code:
    the signed-in person owns it, or this browser verified it recently."""
    from enquiries.otp import phone_is_trusted

    return str(phone) in signed_in_phones(request) or phone_is_trusted(request.session, phone)
