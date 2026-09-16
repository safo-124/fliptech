"""Creation and lookup of passwordless trainer identities."""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from core.identities import create_dedicated_user, user_is_unprivileged

from .models import TrainerAccount


class TrainerAccountDisabled(ValueError):
    pass


@transaction.atomic
def account_for_verified_phone(*, phone, verified_at):
    account = (
        TrainerAccount.objects.select_for_update()
        .select_related("user")
        .filter(phone=phone)
        .first()
    )
    if account is None:
        user_model = get_user_model()
        user = create_dedicated_user(user_model, prefix="trainer")
        try:
            # The savepoint contains the expected unique-phone race. If another
            # first login commits first, only this insert rolls back and the
            # dedicated loser user can be removed cleanly.
            with transaction.atomic():
                account = TrainerAccount.objects.create(
                    phone=phone,
                    user=user,
                    phone_verified_at=verified_at,
                )
        except IntegrityError:
            user.delete()
            account = (
                TrainerAccount.objects.select_for_update().select_related("user").get(phone=phone)
            )

    if account.approval_status == TrainerAccount.Approval.DECLINED:
        raise TrainerAccountDisabled(
            "This trainer sign-up was not approved. Contact Fliptech if you think this is a mistake."
        )
    if not account.is_active or not user_is_unprivileged(account.user):
        raise TrainerAccountDisabled("This trainer account has been disabled.")

    account.phone_verified_at = verified_at
    account.save(update_fields=["phone_verified_at", "updated_at"])
    return account
