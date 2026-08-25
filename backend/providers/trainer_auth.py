"""Creation and lookup of passwordless trainer identities."""

from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from .models import TrainerAccount


class TrainerAccountDisabled(ValueError):
    pass


def _create_dedicated_user(user_model):
    """Create a fresh nonprivileged identity; never adopt an existing user."""

    for _attempt in range(3):
        try:
            with transaction.atomic():
                user = user_model(
                    username=f"trainer-{uuid4().hex}",
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
    raise IntegrityError("Could not allocate a unique trainer identity.")


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
        user = _create_dedicated_user(user_model)
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

    if (
        not account.is_active
        or not account.user.is_active
        or account.user.is_staff
        or account.user.is_superuser
        or account.user.has_usable_password()
        or account.user.groups.exists()
        or account.user.user_permissions.exists()
    ):
        raise TrainerAccountDisabled("This trainer account has been disabled.")

    account.phone_verified_at = verified_at
    account.save(update_fields=["phone_verified_at", "updated_at"])
    return account
