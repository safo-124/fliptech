"""Owned trainer profile queries and atomic nested writes."""

from uuid import uuid4

from django.contrib.gis.geos import Point
from django.db import transaction
from django.utils.text import slugify

from catalog.models import Intake, Programme

from .models import Provider, ProviderMembership, TrainerAccount


class TrainerProfileConflict(ValueError):
    """The singular trainer profile cannot be safely read or changed."""


EDITABLE_STATUSES = {
    Provider.Status.DRAFT,
    Provider.Status.CHANGES_REQUESTED,
}


def owned_profile_queryset(account):
    return (
        Provider.objects.filter(
            trainer_memberships__trainer=account,
            trainer_memberships__role=ProviderMembership.Role.OWNER,
        )
        .select_related("area", "area__region")
        .prefetch_related("programmes__trade", "programmes__intakes")
        .distinct()
    )


def get_owned_profile(account):
    profiles = list(owned_profile_queryset(account)[:2])
    if len(profiles) > 1:
        raise TrainerProfileConflict("This account has more than one provider profile.")
    return profiles[0] if profiles else None


def _unique_slug(*, area, name, provider_id=None):
    stem = (slugify(name) or f"provider-{uuid4().hex[:8]}")[:180]
    candidate = stem
    suffix = 2
    existing = Provider.objects.filter(area=area)
    if provider_id is not None:
        existing = existing.exclude(pk=provider_id)
    while existing.filter(slug=candidate).exists():
        candidate = f"{stem}-{suffix}"
        suffix += 1
    return candidate


def _history_save(instance, *, actor, reason, fields=None):
    instance._history_user = actor
    instance._change_reason = reason
    if fields is None:
        instance.save()
    else:
        instance.save(update_fields=[*fields, "updated_at"])


@transaction.atomic
def save_owned_profile(*, account, actor, validated_data):
    # Serialise profile creation for one trainer so two mobile retries cannot
    # both pass the "no membership yet" check.
    account = TrainerAccount.objects.select_for_update().get(pk=account.pk)
    memberships = list(
        ProviderMembership.objects.select_for_update()
        .filter(trainer=account, role=ProviderMembership.Role.OWNER)
        .select_related("provider")[:2]
    )
    if len(memberships) > 1:
        raise TrainerProfileConflict("This account has more than one provider profile.")

    provider = memberships[0].provider if memberships else None
    if provider is not None:
        provider = Provider.objects.select_for_update().get(pk=provider.pk)
        if provider.status not in EDITABLE_STATUSES:
            raise TrainerProfileConflict(
                "This profile is locked while it is being reviewed or is published."
            )

    programme_data = validated_data.pop("programme")
    intake_data = programme_data.pop("intake", None)
    area = validated_data["area"]
    location = Point(validated_data.pop("longitude"), validated_data.pop("latitude"), srid=4326)

    provider_values = {
        **validated_data,
        "area": area,
        "location": location,
        "owner_phone": account.phone,
    }

    if provider is None:
        provider = Provider(
            **provider_values,
            slug=_unique_slug(area=area, name=provider_values["name"]),
            status=Provider.Status.DRAFT,
        )
        provider.full_clean()
        _history_save(provider, actor=actor, reason="Trainer created profile draft")
        ProviderMembership.objects.create(
            trainer=account,
            provider=provider,
            role=ProviderMembership.Role.OWNER,
        )
    else:
        for field, value in provider_values.items():
            setattr(provider, field, value)
        provider.slug = _unique_slug(
            area=area,
            name=provider.name,
            provider_id=provider.pk,
        )
        provider.full_clean()
        _history_save(provider, actor=actor, reason="Trainer updated profile draft")

    programmes = list(Programme.objects.select_for_update().filter(provider=provider)[:2])
    if len(programmes) > 1:
        raise TrainerProfileConflict(
            "This profile has multiple programmes and needs staff help before it can be edited."
        )

    if programmes:
        programme = programmes[0]
        for field, value in programme_data.items():
            setattr(programme, field, value)
        programme.is_active = True
        programme.full_clean()
        _history_save(programme, actor=actor, reason="Trainer updated programme")
    else:
        programme = Programme(provider=provider, is_active=True, **programme_data)
        programme.full_clean()
        _history_save(programme, actor=actor, reason="Trainer created programme")

    intakes = list(Intake.objects.select_for_update().filter(programme=programme)[:2])
    if len(intakes) > 1:
        raise TrainerProfileConflict(
            "This programme has multiple intakes and needs staff help before it can be edited."
        )

    if intake_data is None:
        if intakes:
            intakes[0].delete()
    elif intakes:
        intake = intakes[0]
        for field, value in intake_data.items():
            setattr(intake, field, value)
        intake.full_clean()
        intake.save()
    else:
        intake = Intake(programme=programme, **intake_data)
        intake.full_clean()
        intake.save()

    return get_owned_profile(account)


def serialize_profile(provider):
    if provider is None:
        return None

    programmes = list(provider.programmes.all())
    if len(programmes) != 1:
        programme_payload = None
    else:
        programme = programmes[0]
        intakes = list(programme.intakes.all())
        intake = intakes[0] if len(intakes) == 1 else None
        programme_payload = {
            "id": programme.pk,
            "trade": {
                "id": programme.trade_id,
                "name": programme.trade.name,
                "slug": programme.trade.slug,
            },
            "title": programme.title,
            "fee": format(programme.fee, ".2f"),
            "instalments_allowed": programme.instalments_allowed,
            "instalment_note": programme.instalment_note,
            "duration_weeks": programme.duration_weeks,
            "hours_per_week": programme.hours_per_week,
            "weekly_schedule": programme.weekly_schedule,
            "capacity": programme.capacity,
            "intake": (
                {
                    "id": intake.pk,
                    "start_date": intake.start_date,
                    "places_offered": intake.places_offered,
                    "places_remaining": intake.places_remaining,
                    "is_open": intake.is_open,
                }
                if intake is not None
                else None
            ),
        }

    return {
        "id": provider.pk,
        "name": provider.name,
        "owner_name": provider.owner_name,
        "owner_phone": str(provider.owner_phone),
        "contact_phone": str(provider.contact_phone),
        "area": {
            "id": provider.area_id,
            "name": provider.area.name,
            "slug": provider.area.slug,
            "region": provider.area.region.name,
        },
        "address": provider.address,
        "latitude": provider.location.y,
        "longitude": provider.location.x,
        "status": provider.status,
        "status_label": provider.get_status_display(),
        "review_note": provider.review_note,
        "submitted_at": provider.submitted_at,
        "editable": provider.status in EDITABLE_STATUSES,
        "programme": programme_payload,
    }
