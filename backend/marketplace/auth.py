"""Creation and lookup of passwordless seller identities.

Mirrors providers/trainer_auth.py closely, and the places it differs are the
interesting ones.

A seller account is created the moment a phone is verified, carrying nothing
but that number. The shop — its name, where it is — is filled in afterwards
from the dashboard. The alternative, demanding the whole form before an
account exists, means a failed save leaves somebody with a verified phone and
nowhere to put it, and makes signing in again on a new handset a form to fill
rather than a code to type.

A trainer who opts into selling gets the same SellerAccount, linked to their
Provider. One person, one login, two capabilities — not two sign-ups.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils.translation import gettext as _

from core.identities import create_dedicated_user, user_is_unprivileged

from .models import SellerAccount


class SellerAccountDisabled(ValueError):
    pass


class SellerAccountElsewhere(ValueError):
    """This login already sells under a different phone number."""


def other_number_message():
    return _(
        "You already sell on %(brand)s with a different phone number. Sign in "
        "with that number, or sign out first to start a new shop."
    ) % {"brand": settings.BRAND_NAME}


@transaction.atomic
def account_for_verified_phone(*, phone, verified_at, user=None):
    """The seller account for a number that just proved itself.

    `user` attaches selling to somebody already signed in — the trainer who
    ticks "I also sell". Without it the account gets a dedicated user of its
    own, which is the plain seller sign-up.
    """
    # `of=("self",)` locks the seller row and nothing else. A plain
    # select_for_update() alongside select_related on `area` and `provider`
    # builds LEFT OUTER JOINs, because both are nullable, and Postgres
    # refuses: "FOR UPDATE cannot be applied to the nullable side of an outer
    # join". Dropping the select_related would work too and cost two queries
    # on every sign-in.
    account = (
        SellerAccount.objects.select_for_update(of=("self",))
        .select_related("user", "area", "provider")
        .filter(phone=phone)
        .first()
    )
    if account is None and user is not None and SellerAccount.objects.filter(user=user).exists():
        # One seller account per login. Creating a second would break that
        # rule in the database, and the fallback below would then look for
        # an account under this number, find none and crash.
        raise SellerAccountElsewhere(other_number_message())
    if account is None:
        owner = user
        if owner is None:
            owner = create_dedicated_user(get_user_model(), prefix="seller")
        try:
            # The savepoint contains the expected unique-phone race. If
            # another first sign-in commits first, only this insert rolls
            # back and the dedicated loser user can be removed cleanly.
            with transaction.atomic():
                account = SellerAccount.objects.create(
                    phone=phone,
                    user=owner,
                    phone_verified_at=verified_at,
                )
        except IntegrityError:
            # Only a user this call invented may be cleaned up. Deleting a
            # signed-in trainer's user because their seller insert raced
            # would take the workshop with it.
            if user is None:
                owner.delete()
            account = (
                SellerAccount.objects.select_for_update(of=("self",))
                .select_related("user", "area", "provider")
                .get(phone=phone)
            )

    if account.approval_status == SellerAccount.Approval.DECLINED:
        raise SellerAccountDisabled(
            _(
                "This seller sign-up was not approved. Contact %(brand)s if you think "
                "this is a mistake."
            )
            % {"brand": settings.BRAND_NAME}
        )
    if not account.is_active or not user_is_unprivileged(account.user):
        raise SellerAccountDisabled(_("This seller account has been disabled."))

    account.phone_verified_at = verified_at
    account.save(update_fields=["phone_verified_at", "updated_at"])
    return account


def own_seller_account(request):
    """The signed-in caller's seller account, or None.

    Staff are excluded for the same reason they are excluded everywhere else
    on the public side: a member of staff in a support session is acting for
    somebody else and is not themselves a seller.
    """
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated or user.is_staff:
        return None
    try:
        account = user.seller_account
    except SellerAccount.DoesNotExist:
        return None
    return account if account.is_active else None


def code_address_for(phone):
    """Where a sign-in code for this number should also be sent.

    Returns (address, proven). An unproven address still gets a copy — it is
    the only way somebody whose SMS never arrives can get in — but the caller
    caps how often, because otherwise sign-up is a way to post mail into a
    stranger's inbox.
    """
    account = SellerAccount.objects.filter(phone=phone).only("email", "email_verified_at").first()
    if account is None or not account.email:
        return None, False
    return account.email, account.email_verified_at is not None


@transaction.atomic
def start_selling(*, user, phone, verified_at, provider=None):
    """Turn selling on for somebody who already has an account.

    This is the trainer's "I also sell" tick. It reuses their login rather
    than creating a second one, and links the Provider so a buyer sees the
    same business in both places.

    Idempotent: ticking it twice is not an error, and an account that already
    exists keeps the provider link it has rather than having it overwritten
    with None by a later call that did not pass one.
    """
    account = account_for_verified_phone(phone=phone, verified_at=verified_at, user=user)
    if provider is not None and account.provider_id != provider.pk:
        account.provider = provider
        account.save(update_fields=["provider", "updated_at"])
    return account
