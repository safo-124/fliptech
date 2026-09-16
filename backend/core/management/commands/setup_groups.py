"""Create the two back-office roles from Section 09.

The onboarding workflow has a field officer drafting a provider and an
operations lead approving publication. That is only a real control if the two
roles hold different permissions, so this command creates them rather than
leaving it to whoever sets up the first staff account.

Idempotent: safe to re-run after adding models.
"""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

FIELD_OFFICER = "Field officer"
OPERATIONS_LEAD = "Operations lead"

# A field officer creates and edits everything needed during a site visit, but
# cannot publish, cannot suspend and cannot delete.
FIELD_OFFICER_PERMISSIONS = [
    ("providers", "provider", ["add", "change", "view"]),
    ("providers", "providerphoto", ["add", "change", "view", "delete"]),
    ("providers", "providerevidence", ["add", "change", "view"]),
    ("providers", "verification", ["add", "change", "view"]),
    ("providers", "governmentstatus", ["add", "change", "view"]),
    ("providers", "listingconfirmation", ["add", "change", "view"]),
    ("providers", "suspension", ["view"]),
    ("catalog", "trade", ["add", "change", "view"]),
    ("catalog", "programme", ["add", "change", "view"]),
    ("catalog", "intake", ["add", "change", "view"]),
    ("geography", "area", ["view"]),
    ("geography", "region", ["view"]),
    ("enquiries", "enquiry", ["view", "change"]),
    ("enquiries", "enquiryoutcome", ["add", "change", "view"]),
    ("enquiries", "enrolment", ["add", "change", "view"]),
    ("billing", "subscription", ["view"]),
]

# An operations lead additionally publishes, suspends and manages subscriptions,
# and is the only role that sees trainee accounts. Trainee phone numbers belong
# to people who are often young, so field officers do not get them by default.
OPERATIONS_LEAD_EXTRA = [
    ("trainees", "traineeaccount", ["view", "change"]),
    ("trainees", "savedprovider", ["view"]),
    ("trainees", "supportsession", ["view"]),
    ("trainees", "supportsessionevent", ["view"]),
    ("providers", "traineraccount", ["view", "change"]),
    ("enquiries", "phoneverification", ["view"]),
    ("providers", "provider", ["delete"]),
    ("providers", "suspension", ["add", "change", "view"]),
    ("providers", "providerevidence", ["delete"]),
    ("geography", "area", ["add", "change"]),
    ("geography", "region", ["add", "change"]),
    ("billing", "subscription", ["add", "change", "view"]),
]

# The second pair of eyes, and view-only support access to a trainee's
# dashboard. Editing in support mode and erasing a trainee stay with
# superusers unless someone grants them to a named person.
OPERATIONS_LEAD_CUSTOM = [
    ("providers", "publish_provider"),
    ("trainees", "support_access"),
]


class Command(BaseCommand):
    help = "Create or update the Field officer and Operations lead groups."

    def handle(self, *args, **options):
        officer, _ = Group.objects.get_or_create(name=FIELD_OFFICER)
        lead, _ = Group.objects.get_or_create(name=OPERATIONS_LEAD)

        officer_perms = self._collect(FIELD_OFFICER_PERMISSIONS)
        officer.permissions.set(officer_perms)

        lead_perms = officer_perms | self._collect(OPERATIONS_LEAD_EXTRA)
        for app_label, codename in OPERATIONS_LEAD_CUSTOM:
            try:
                lead_perms.add(
                    Permission.objects.get(content_type__app_label=app_label, codename=codename)
                )
            except Permission.DoesNotExist:
                self.stderr.write(f"Missing permission {app_label}.{codename} — run migrate first.")
        lead.permissions.set(lead_perms)

        self.stdout.write(
            self.style.SUCCESS(
                f"{FIELD_OFFICER}: {officer.permissions.count()} permissions\n"
                f"{OPERATIONS_LEAD}: {lead.permissions.count()} permissions"
            )
        )
        self.stdout.write(
            "Assign staff to a group in the back office. Both groups need is_staff=True."
        )

    def _collect(self, spec):
        found = set()
        for app_label, model, actions in spec:
            for action in actions:
                codename = f"{action}_{model}"
                try:
                    found.add(
                        Permission.objects.get(content_type__app_label=app_label, codename=codename)
                    )
                except Permission.DoesNotExist:
                    self.stderr.write(f"Missing permission {app_label}.{codename}")
        return found
