"""Line up each person's name and email between /account and the learning pages.

Before the account pages merged, a login with both a customer account and a
trainee account kept two names and two emails, and they drifted (an email
saved on /account was empty on /trainee). This copies across, and deletes
nothing:

  - a name or email that only one side has is copied to the other;
  - where both have an email, a proved one wins over an unproved one, and
    otherwise /account's wins; where both have a name, /account's wins;
  - an email already on another trainee is left alone and reported.

Dry run first (the default): lists what would change.

    python manage.py sync_account_profiles

Then the same with --yes to make the changes:

    python manage.py sync_account_profiles --yes
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import CustomerAccount
from trainees.models import TraineeAccount


class Command(BaseCommand):
    help = "Copy names and emails between customer and trainee accounts. Dry run unless --yes."

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Make the changes.")

    def handle(self, *args, **options):
        changes = []
        for customer in CustomerAccount.objects.select_related("user"):
            trainee = TraineeAccount.objects.filter(user=customer.user).first()
            if trainee is None:
                continue
            plan = {"customer": {}, "trainee": {}}

            name = customer.display_name or trainee.display_name
            if name and customer.display_name != name:
                plan["customer"]["display_name"] = name
            if name and trainee.display_name != name:
                plan["trainee"]["display_name"] = name

            emails = [
                (customer.email, customer.email_verified_at),
                (trainee.email, trainee.email_verified_at),
            ]
            emails = [pair for pair in emails if pair[0]]
            if emails:
                proved = [pair for pair in emails if pair[1]]
                email, verified = (proved or emails)[0]
                if (customer.email or "").lower() != email.lower():
                    plan["customer"].update(email=email, email_verified_at=verified)
                if (trainee.email or "").lower() != email.lower():
                    taken = (
                        TraineeAccount.objects.filter(email__iexact=email)
                        .exclude(pk=trainee.pk)
                        .exists()
                    )
                    if taken:
                        self.stdout.write(
                            self.style.WARNING(
                                f"  {customer.phone}: {email} is on another trainee; left as is."
                            )
                        )
                    else:
                        plan["trainee"].update(email=email, email_verified_at=verified)

            if plan["customer"] or plan["trainee"]:
                changes.append((customer, trainee, plan))
                for side, fields in plan.items():
                    for field, value in fields.items():
                        if field != "email_verified_at":
                            self.stdout.write(f"{customer.phone}  {side}.{field} -> {value!r}")

        if not changes:
            self.stdout.write(self.style.SUCCESS("Every account already matches."))
            return
        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING(
                    f"Dry run: {len(changes)} account(s) would change. Add --yes to do it."
                )
            )
            return
        with transaction.atomic():
            for customer, trainee, plan in changes:
                for record, fields in ((customer, plan["customer"]), (trainee, plan["trainee"])):
                    if fields:
                        for field, value in fields.items():
                            setattr(record, field, value)
                        record.save(update_fields=[*fields, "updated_at"])
        self.stdout.write(
            self.style.SUCCESS(f"Updated {len(changes)} account(s). Nothing deleted.")
        )
