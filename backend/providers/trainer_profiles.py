"""Owned trainer profile queries and atomic nested writes."""

from uuid import uuid4

from django.contrib.gis.geos import Point
from django.core.exceptions import NON_FIELD_ERRORS, ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
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


SLUG_ATTEMPTS = 4


def _is_slug_collision(error):
    """True for the unique_provider_slug_per_area failure, not other errors.

    Anything else — a field too long, a broken constraint — is a real problem
    and must not be retried into silence.
    """
    for message in getattr(error, "error_dict", {}).get(NON_FIELD_ERRORS, []):
        params = message.params or {}
        if message.code == "unique_together" and "slug" in params.get("unique_check", ()):
            return True
    return False


def _save_with_unique_slug(provider, *, area, actor, reason):
    """Save, re-deriving the slug if another trainer took the one we picked.

    _unique_slug finds a free slug with a SELECT, so two owners registering
    "Accra Welding Works" in the same area at the same moment can both be told
    the same slug is free. Whoever loses used to get a 500 on the most
    important request of their day.

    The collision arrives as one of two different exceptions depending on how
    close the race was, and both have to be caught:

      ValidationError  the other row was committed before full_clean ran, so
                       validate_unique's own SELECT sees it. This is the usual
                       case, and it is why catching IntegrityError alone was
                       not enough.
      IntegrityError   the other row landed in the gap between that SELECT and
                       our INSERT, leaving the database to reject it.

    Each attempt needs its own savepoint. An IntegrityError leaves the
    enclosing atomic block unusable, so a retry without one fails on the next
    query with a confusing TransactionManagementError instead.
    """
    for attempt in range(SLUG_ATTEMPTS):
        provider.slug = _unique_slug(area=area, name=provider.name, provider_id=provider.pk)
        try:
            with transaction.atomic():
                provider.full_clean()
                _history_save(provider, actor=actor, reason=reason)
            return provider
        except ValidationError as error:
            if not _is_slug_collision(error) or attempt == SLUG_ATTEMPTS - 1:
                raise
        except IntegrityError:
            if attempt == SLUG_ATTEMPTS - 1:
                raise
    return provider


def current_intake_start_date(provider):
    """The intake date already stored, so re-saving it unchanged is allowed.

    Returns None when there is no single unambiguous intake, which makes the
    serializer fall back to requiring a future date.
    """
    if provider is None:
        return None
    programmes = list(provider.programmes.all())
    if len(programmes) != 1:
        return None
    intakes = list(programmes[0].intakes.all())
    return intakes[0].start_date if len(intakes) == 1 else None


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

    # These belong to the person, not the workshop, so they come off before
    # the rest is splatted onto Provider.
    account_values = {
        "full_name": validated_data.pop("full_name", ""),
        "role": validated_data.pop("role", ""),
        "id_document_type": validated_data.pop("id_document_type", ""),
        "id_document_number": validated_data.pop("id_document_number", ""),
    }
    data_consent = validated_data.pop("data_consent", False)

    # Declarations arrive as booleans and are stored as the moment they were
    # made. Once set they are not cleared by a later save that happens to send
    # false: withdrawing consent is a deliberate act, not a dropped checkbox on
    # a form that half-submitted over a bad connection.
    now = timezone.now()
    declared_accurate = validated_data.pop("declared_accurate", False)
    site_visit_consent = validated_data.pop("site_visit_consent", False)

    account_changed = False
    for field, value in account_values.items():
        if value and getattr(account, field) != value:
            setattr(account, field, value)
            account_changed = True
    if data_consent and account.data_consent_at is None:
        account.data_consent_at = now
        account_changed = True
    if account_changed:
        account.full_clean()
        account.save()

    area = validated_data["area"]
    location = Point(validated_data.pop("longitude"), validated_data.pop("latitude"), srid=4326)

    provider_values = {
        **validated_data,
        "area": area,
        "location": location,
        "owner_phone": account.phone,
    }
    if declared_accurate:
        provider_values["declared_accurate_at"] = now
    if site_visit_consent:
        provider_values["site_visit_consent_at"] = now

    if provider is None:
        provider = Provider(**provider_values, status=Provider.Status.DRAFT)
        _save_with_unique_slug(
            provider,
            area=area,
            actor=actor,
            reason="Trainer created profile draft",
        )
        ProviderMembership.objects.create(
            trainer=account,
            provider=provider,
            role=ProviderMembership.Role.OWNER,
        )
    else:
        for field, value in provider_values.items():
            setattr(provider, field, value)
        _save_with_unique_slug(
            provider,
            area=area,
            actor=actor,
            reason="Trainer updated profile draft",
        )

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
        # places_remaining is not a form field: it is the counter that moves as
        # trainees enrol, and the trainer's form has no idea what it should be.
        # Only clamp it, so lowering the offer cannot leave more places
        # remaining than are offered — which the check constraint rejects.
        if intake.places_offered is not None and intake.places_remaining is not None:
            intake.places_remaining = min(intake.places_remaining, intake.places_offered)
        intake.full_clean()
        intake.save()
    else:
        intake = Intake(programme=programme, **intake_data)
        # A brand new intake has had no enrolments, so every place offered is
        # still free. This is the only moment the counter is seeded.
        intake.places_remaining = intake.places_offered
        intake.full_clean()
        intake.save()

    return get_owned_profile(account)


# What a listing must carry before a super admin is asked to decide on it.
#
# Returned as a list rather than raised as one error so the wizard can show a
# checklist. A trainer on a prepaid connection who is told only "not ready"
# submits four more times to find out why.
# One of the workshop, one of the work. Still two photographs, so this asks no
# more of a trainer on prepaid data than before — it just asks for the two that
# answer different questions. "Is this a real place I can get to" and "is the
# work any good" are not the same question, and two pictures of a tidy yard
# answer only the first.
MIN_PHOTOS_TO_SUBMIT = 2


def submission_blockers(provider, account):
    """Everything still missing before this listing can go for review."""
    from .models import ProviderEvidence

    blockers = []

    if not account.full_name.strip():
        blockers.append("Add your full name.")
    if not account.role:
        blockers.append("Say whether you are the owner, the manager or the lead trainer.")
    if not account.id_document_type or not account.id_document_number.strip():
        blockers.append("Add your ID type and number.")

    # The document itself, not just the number. Section 10 keeps it in private
    # storage; this only asks whether a row exists.
    has_id = ProviderEvidence.objects.filter(
        provider=provider, kind=ProviderEvidence.Kind.ID_DOCUMENT
    ).exists()
    if not has_id:
        blockers.append("Upload a photo of your ID.")

    from .models import ProviderPhoto

    kinds = set(provider.photos.values_list("kind", flat=True))
    if ProviderPhoto.Kind.WORKSHOP not in kinds:
        blockers.append("Add at least one photo of the workshop itself.")
    if ProviderPhoto.Kind.WORK not in kinds:
        blockers.append("Add at least one photo of work you have done.")

    if not provider.programmes.exists():
        blockers.append("Add at least one course.")

    if not provider.landmark.strip():
        blockers.append("Add the nearest landmark, so we can find the workshop.")

    if provider.declared_accurate_at is None:
        blockers.append("Confirm that the fees and dates you entered are correct.")
    if provider.site_visit_consent_at is None:
        blockers.append("Agree to a Fliiptech site visit.")
    if account.data_consent_at is None:
        blockers.append("Accept how we handle your personal information.")

    return blockers


def _identity_payload(provider, account):
    """Who the trainer says they are, and whether a document is on file.

    `has_document` is a boolean rather than a link. Section 10 requires
    identity documents are never publicly served, and the trainer only needs
    to know whether the upload landed — a URL here would be one careless
    template away from rendering.
    """
    from .models import ProviderEvidence

    if account is None:
        return None
    return {
        "full_name": account.full_name,
        "role": account.role,
        "id_document_type": account.id_document_type,
        "id_document_number": account.id_document_number,
        "has_document": ProviderEvidence.objects.filter(
            provider=provider, kind=ProviderEvidence.Kind.ID_DOCUMENT
        ).exists(),
        "data_consent_given": account.data_consent_at is not None,
    }


def serialize_profile(provider, account=None):
    """The trainer's own view of their listing.

    `account` is optional so existing callers that only have a provider keep
    working; pass it to include the identity block, which lives on
    TrainerAccount rather than on Provider.
    """
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
            "fee_includes_tools": programme.fee_includes_tools,
            "fee_includes_materials": programme.fee_includes_materials,
            "fee_includes_ppe": programme.fee_includes_ppe,
            "fee_includes_certificate": programme.fee_includes_certificate,
            "certificate_awarded": programme.certificate_awarded,
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
        "landmark": provider.landmark,
        "year_established": provider.year_established,
        "premises_tenure": provider.premises_tenure,
        "trainer_count": provider.trainer_count,
        "trainee_count": provider.trainee_count,
        "declared_accurate_at": provider.declared_accurate_at,
        "site_visit_consent_at": provider.site_visit_consent_at,
        "latitude": provider.location.y,
        "longitude": provider.location.x,
        "status": provider.status,
        "status_label": provider.get_status_display(),
        "review_note": provider.review_note,
        "submitted_at": provider.submitted_at,
        "editable": provider.status in EDITABLE_STATUSES,
        # Public workshop photographs. Safe to hand back a URL: these are the
        # gallery on the provider profile. The identity document below is not,
        # and deliberately has no URL anywhere in this payload.
        "logo": provider.logo.url if provider.logo else None,
        "photos": [
            {
                "id": photo.pk,
                "kind": photo.kind,
                "url": photo.image.url,
                "caption": photo.caption,
            }
            for photo in provider.photos.all()
        ],
        "identity": _identity_payload(provider, account),
        "programme": programme_payload,
    }
