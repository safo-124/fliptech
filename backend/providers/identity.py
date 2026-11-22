"""Where a trainer's ID photo is, wherever it was taken.

Since the ID photo moved to the first step of sign-up it lives on the trainer's
account, as a TrainerIdPhoto. Sign-ups from before then have it on their
workshop, as a ProviderEvidence row of kind ID_DOCUMENT. Everything that asks
"is there an ID on file?" asks here, so neither kind is missed.
"""


def latest_id_photo(account):
    """The account's newest ID photo, or None."""
    if account is None or account.pk is None:
        return None
    return account.id_photos.order_by("-created_at").first()


def _legacy_evidence(provider):
    from .models import ProviderEvidence

    if provider is None:
        return None
    return (
        ProviderEvidence.objects.filter(provider=provider, kind=ProviderEvidence.Kind.ID_DOCUMENT)
        .order_by("-created_at")
        .first()
    )


def has_id_on_file(account, provider=None):
    return latest_id_photo(account) is not None or _legacy_evidence(provider) is not None


def repeat_id_refusal(account, document_type, number):
    """Why `number` cannot go on this account, if it is on another one already.

    One card, one account. The attempt is recorded for staff as an
    IdNumberClash (once per pair of accounts and number; a repeat only moves
    its time on), because it is either the same person who lost the phone they
    signed up with or someone using another person's card, and a person has to
    tell which.
    """
    from django.utils.translation import gettext as _

    from .models import IdNumberClash, TrainerAccount

    if not document_type or not number:
        return None
    others = TrainerAccount.objects.filter(
        id_document_type=document_type, id_document_number=number
    ).exclude(pk=account.pk)
    # Two accounts may share a number from before this rule. The one that had
    # it first keeps saving; the later one is the one refused.
    if account.id_document_type == document_type and account.id_document_number == number:
        others = others.filter(created_at__lt=account.created_at)
    other = others.order_by("created_at").first()
    if other is None:
        return None
    clash, created = IdNumberClash.objects.get_or_create(
        account=account, other_account=other, document_type=document_type, number=number
    )
    if not created:
        clash.save(update_fields=["updated_at"])
    return _(
        "This ID is already linked to another account. Sign in with the phone number you "
        "used before, or contact us."
    )


def id_file(account, provider=None):
    """The file of the newest ID photo on file for this person, or None."""
    candidates = [row for row in (latest_id_photo(account), _legacy_evidence(provider)) if row]
    if not candidates:
        return None
    newest = max(candidates, key=lambda row: row.created_at)
    return newest.file or None
