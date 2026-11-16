"""One name and one email per person, whichever page changed them.

A login can hold a customer account (/account) and a trainee account (the
learning pages). Each has its own name and email columns, from before the
single sign-in, and they drifted: an email saved on /account was empty on
the learning pages. The customer account is now the profile everyone edits;
these keep the trainee copy the same, and take a trainee-proved email back.

Photos are not copied: the website shows the account's photo everywhere.
`manage.py sync_account_profiles` brings existing accounts into line.
"""

from django.db import IntegrityError, transaction


def _trainee_of(user):
    try:
        return user.trainee_account
    except Exception:  # ObjectDoesNotExist, and no relation on a bare user
        return None


def _customer_of(user):
    try:
        return user.customer_account
    except Exception:
        return None


def push_to_trainee(customer):
    """After /account changes the name or email."""
    trainee = _trainee_of(customer.user)
    if trainee is None:
        return False
    changed = []
    if trainee.display_name != customer.display_name:
        trainee.display_name = customer.display_name
        changed.append("display_name")
    if (trainee.email or None) != (customer.email or None):
        from trainees.models import TraineeAccount

        taken = (
            customer.email
            and TraineeAccount.objects.filter(email__iexact=customer.email)
            .exclude(pk=trainee.pk)
            .exists()
        )
        if not taken:
            trainee.email = customer.email or None
            trainee.email_verified_at = customer.email_verified_at if customer.email else None
            changed += ["email", "email_verified_at"]
    if not changed:
        return False
    try:
        with transaction.atomic():
            trainee.save(update_fields=[*changed, "updated_at"])
    except IntegrityError:
        return False
    return True


def pull_from_trainee(trainee, *, name=False, email=False):
    """After the learning side changes a name, or proves an email."""
    customer = _customer_of(trainee.user)
    if customer is None:
        return False
    changed = []
    if name and trainee.display_name and customer.display_name != trainee.display_name:
        customer.display_name = trainee.display_name
        changed.append("display_name")
    if email and trainee.email and trainee.email_verified_at:
        customer.email = trainee.email
        customer.email_verified_at = trainee.email_verified_at
        changed += ["email", "email_verified_at"]
    if changed:
        customer.save(update_fields=[*changed, "updated_at"])
    return bool(changed)
