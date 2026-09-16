"""Passwordless phone identities shared by trainers and trainees.

Both kinds of account sit on a dedicated Django user that can never log in to
the back office: no password, no staff flag, no groups, no permissions. The
checks live here once so the trainer and trainee flows cannot drift apart on
the property that matters most, which is that a phone login can never become a
staff login.
"""

from uuid import uuid4

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
