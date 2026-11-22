"""Write the ID numbers already saved the way new ones are saved.

So "gha 123456789 0" saved before the rules and "GHA-123456789-0" typed now are
recognised as the same card (one card, one account). Numbers that do not fit
their ID type are left exactly as they are: staff see them, and the trainer is
asked to correct them on their next save.

The tidying is copied here rather than imported from providers.id_numbers, so
this migration keeps doing the same thing if that module changes later.
"""

import re

from django.db import migrations

_SEPARATORS = re.compile(r"[\s\-_./–—]+")


def _tidy(document_type, raw):
    value = (raw or "").strip()
    packed = _SEPARATORS.sub("", value).upper()
    if document_type == "ghana_card":
        if re.fullmatch(r"\d{10}", packed):
            packed = f"GHA{packed}"
        match = re.fullmatch(r"([A-Z]{3})(\d{9})(\d)", packed)
        return f"{match[1]}-{match[2]}-{match[3]}" if match else value
    if document_type == "passport":
        return packed if re.fullmatch(r"(?=.*\d)[A-Z0-9]{6,9}", packed) else value
    if document_type == "voter_id":
        return packed if re.fullmatch(r"\d{10}", packed) else value
    return value


def tidy_saved_numbers(apps, schema_editor):
    TrainerAccount = apps.get_model("providers", "TrainerAccount")
    for account in TrainerAccount.objects.exclude(id_document_number="").only(
        "pk", "id_document_type", "id_document_number"
    ):
        tidied = _tidy(account.id_document_type, account.id_document_number)
        if tidied != account.id_document_number:
            TrainerAccount.objects.filter(pk=account.pk).update(id_document_number=tidied)


class Migration(migrations.Migration):
    dependencies = [
        ("providers", "0021_trainer_id_photo_and_clashes"),
    ]

    operations = [
        migrations.RunPython(tidy_saved_numbers, migrations.RunPython.noop),
    ]
