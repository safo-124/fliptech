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
