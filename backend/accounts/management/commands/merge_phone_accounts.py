"""Join up the separate logins one phone number collected before
one-person-one-login.

Until now each kind of account made its own login, so somebody who enquired
as a trainee and later registered their workshop had two, unrelated. This
moves every account for a number onto one login (the customer account's if
there is one, then the trainer's, the seller's, the trainee's), points
anything else that named the old login at the kept one, and switches the old
login off. Nothing is deleted, so a mistake can be undone by hand.

Dry run unless --yes. Safe to run again: a number already on one login is
left alone. Logins with staff rights or a password are never touched or
merged into: a phone code must never open the back office.

Take a database backup first.
"""

from collections import defaultdict

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from core.identities import _role_models, user_is_unprivileged


def duplicates():
    """{phone: [(model, account), ...]} for numbers held by more than one login."""
    by_phone = defaultdict(list)
    for model in _role_models():
        for account in model.objects.select_related("user"):
            by_phone[str(account.phone)].append((model, account))
    return {
        phone: accounts
        for phone, accounts in by_phone.items()
        if len({account.user_id for _model, account in accounts}) > 1
    }


def _user_foreign_keys():
    """Every (model, field name) that points at a user, other than the four
    accounts themselves (moved on purpose) and one-to-one links (a second
    would collide)."""
    user_model = get_user_model()
    found = []
    for model in apps.get_models():
        for field in model._meta.get_fields():
            if (
                getattr(field, "many_to_one", False)
                and field.related_model is user_model
                and field.concrete
            ):
                found.append((model, field.name))
    return found


class Command(BaseCommand):
    help = "Move every account for one phone number onto one login. Dry run unless --yes."

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Actually merge.")

    def handle(self, *args, **options):
        found = duplicates()
        if not found:
            self.stdout.write("Every phone number is already on one login. Nothing to do.")
            return
        merged = skipped = 0
        for phone, accounts in sorted(found.items()):
            users = {account.user_id: account.user for _model, account in accounts}
            privileged = [user for user in users.values() if not user_is_unprivileged(user)]
            if privileged:
                self.stdout.write(
                    f"{phone}: skipped, a login has staff rights or a password "
                    f"({', '.join(user.get_username() for user in privileged)})."
                )
                skipped += 1
                continue
            # The first account in preference order decides which login stays.
            keeper = accounts[0][1].user
            moving = [
                (model, account) for model, account in accounts if account.user_id != keeper.pk
            ]
            clash = [
                model._meta.verbose_name
                for model, account in moving
                if model.objects.filter(user=keeper).exists()
            ]
            if clash:
                self.stdout.write(
                    f"{phone}: skipped, the kept login already has a {', '.join(clash)} "
                    "under another number."
                )
                skipped += 1
                continue
            names = ", ".join(model._meta.verbose_name for model, _account in moving)
            self.stdout.write(f"{phone}: move {names} onto {keeper.get_username()}")
            if options["yes"]:
                self._merge(keeper, moving)
            merged += 1

        verb = "Merged" if options["yes"] else "Would merge"
        self.stdout.write(self.style.SUCCESS(f"{verb} {merged} number(s); {skipped} skipped."))
        if not options["yes"]:
            self.stdout.write(self.style.NOTICE("Dry run. Re-run with --yes to merge."))

    @transaction.atomic
    def _merge(self, keeper, moving):
        old_users = {account.user for _model, account in moving}
        for model, account in moving:
            model.objects.filter(pk=account.pk).update(user=keeper)
        keys = _user_foreign_keys()
        for old in old_users:
            for model, field in keys:
                model._default_manager.filter(**{field: old}).update(**{field: keeper})
            if not any(model.objects.filter(user=old).exists() for model in _role_models()):
                # Switched off, not deleted: every row that named it now names
                # the kept login, and an inactive user cannot sign in.
                old.is_active = False
                old.save(update_fields=["is_active"])
