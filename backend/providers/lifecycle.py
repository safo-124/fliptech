"""Audited provider lifecycle transitions shared by API and back office."""

from django.db import transaction
from django.utils import timezone

from .models import Provider, TrainerAccount


class ProviderTransitionError(ValueError):
    """Raised when a provider cannot move from its current lifecycle state."""


class UnconfirmedTrainerError(ProviderTransitionError):
    """A self-submitted listing whose owner has not been confirmed yet."""


def _save_transition(provider, *, actor, reason, fields):
    provider._history_user = actor
    provider._change_reason = reason
    provider.save(update_fields=[*fields, "updated_at"])
    return provider


@transaction.atomic
def submit_provider(provider, *, actor):
    provider = Provider.objects.select_for_update().get(pk=provider.pk)
    if provider.status not in {
        Provider.Status.DRAFT,
        Provider.Status.CHANGES_REQUESTED,
    }:
        raise ProviderTransitionError("Only an editable draft can be submitted for approval.")

    provider.status = Provider.Status.PENDING_APPROVAL
    provider.submitted_at = timezone.now()
    provider.review_note = ""
    return _save_transition(
        provider,
        actor=actor,
        reason="Submitted for approval",
        fields=["status", "submitted_at", "review_note"],
    )


@transaction.atomic
def publish_provider(provider, *, actor):
    provider = Provider.objects.select_for_update().get(pk=provider.pk)
    if provider.status != Provider.Status.PENDING_APPROVAL:
        raise ProviderTransitionError("Only a provider pending approval can be published.")
    if provider.trainer_memberships.exclude(
        trainer__approval_status=TrainerAccount.Approval.CONFIRMED
    ).exists():
        raise UnconfirmedTrainerError(
            "The trainer who submitted this listing has not been confirmed yet."
        )

    now = timezone.now()
    provider.status = Provider.Status.PUBLISHED
    provider.published_at = now
    provider.last_confirmed_at = now
    provider.review_note = ""
    return _save_transition(
        provider,
        actor=actor,
        reason="Approved and published",
        fields=["status", "published_at", "last_confirmed_at", "review_note"],
    )


@transaction.atomic
def request_provider_changes(provider, *, actor, note):
    provider = Provider.objects.select_for_update().get(pk=provider.pk)
    if provider.status != Provider.Status.PENDING_APPROVAL:
        raise ProviderTransitionError("Only a provider pending approval can be returned.")

    provider.status = Provider.Status.CHANGES_REQUESTED
    provider.review_note = note.strip()
    return _save_transition(
        provider,
        actor=actor,
        reason="Changes requested during review",
        fields=["status", "review_note"],
    )
