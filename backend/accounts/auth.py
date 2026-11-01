"""Signing in to the one account, and giving every login its customer account."""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from core.identities import user_for_new_role, user_is_unprivileged

from .models import CustomerAccount


class AccountDisabled(ValueError):
    pass


def ensure_customer(user, phone, verified_at):
    """The customer account on this login, made if it has none.

    Called whenever anybody signs in, whatever door they used, so a trainer
    who buys something has "My orders" like everyone else. Does nothing when
    another login already holds a customer account for this number: that is
    a duplicate from before one-person-one-login, and merge_phone_accounts is
    what joins it up, not a sign-in.
    """
    try:
        return user.customer_account
    except CustomerAccount.DoesNotExist:
        pass
    if CustomerAccount.objects.filter(phone=phone).exists():
        return None
    try:
        with transaction.atomic():
            return CustomerAccount.objects.create(
                user=user, phone=phone, phone_verified_at=verified_at
            )
    except IntegrityError:
        return CustomerAccount.objects.filter(user=user).first()


@transaction.atomic
def account_for_verified_phone(*, phone, verified_at):
    """The account for a phone that has just proved itself. Made on first use,
    on the login the person already has if they are a trainee, trainer or
    seller already."""
    account = (
        CustomerAccount.objects.select_for_update()
        .select_related("user")
        .filter(phone=phone)
        .first()
    )
    created = False
    if account is None:
        user = user_for_new_role(get_user_model(), phone, prefix="customer")
        account = ensure_customer(user, phone, verified_at)
        if account is None:  # Lost a race for this number.
            account = CustomerAccount.objects.select_related("user").get(phone=phone)
        created = True

    if not account.is_active or not user_is_unprivileged(account.user):
        raise AccountDisabled(_("This account has been switched off. Contact support."))

    account.phone_verified_at = verified_at
    account.last_seen_at = timezone.now()
    account.save(update_fields=["phone_verified_at", "last_seen_at", "updated_at"])
    account._just_created = created
    return account


def own_customer_account(request):
    """The signed-in person's customer account, or None. Staff excluded, as
    everywhere on the public side."""
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated or user.is_staff:
        return None
    try:
        account = user.customer_account
    except CustomerAccount.DoesNotExist:
        return None
    return account if account.is_active else None
