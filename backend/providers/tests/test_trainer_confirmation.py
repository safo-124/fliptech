"""Trainer sign-ups are confirmed by the super admin before a listing goes live."""

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from providers.lifecycle import UnconfirmedTrainerError, publish_provider
from providers.models import Provider, ProviderMembership, TrainerAccount
from providers.trainer_auth import TrainerAccountDisabled, account_for_verified_phone

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PHONE = "+233241112222"


@pytest.fixture
def owner_listing(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    trainer = account_for_verified_phone(phone=PHONE, verified_at=timezone.now())
    provider = Provider.objects.create(
        name="Owner Academy",
        slug="owner-academy",
        area=area,
        location=ACCRA,
        contact_phone=PHONE,
        status=Provider.Status.PENDING_APPROVAL,
    )
    ProviderMembership.objects.create(trainer=trainer, provider=provider)
    return trainer, provider


@pytest.fixture
def groups(db):
    call_command("setup_groups", verbosity=0)
    return {
        "officer": Group.objects.get(name="Field officer"),
        "lead": Group.objects.get(name="Operations lead"),
    }


def staff(django_user_model, name, group=None, superuser=False):
    user = django_user_model.objects.create_user(
        name, password="pw", is_staff=True, is_superuser=superuser
    )
    if group:
        user.groups.add(group)
    return user


@pytest.mark.django_db
def test_new_trainer_waits_for_confirmation(owner_listing):
    trainer, _ = owner_listing
    assert trainer.approval_status == TrainerAccount.Approval.PENDING
    assert not trainer.is_confirmed


@pytest.mark.django_db
def test_listing_from_unconfirmed_trainer_cannot_be_published(owner_listing, django_user_model):
    trainer, provider = owner_listing
    boss = staff(django_user_model, "boss", superuser=True)

    with pytest.raises(UnconfirmedTrainerError):
        publish_provider(provider, actor=boss)
    provider.refresh_from_db()
    assert provider.status == Provider.Status.PENDING_APPROVAL

    trainer.approval_status = TrainerAccount.Approval.CONFIRMED
    trainer.save()
    publish_provider(provider, actor=boss)
    provider.refresh_from_db()
    assert provider.status == Provider.Status.PUBLISHED


@pytest.mark.django_db
def test_publish_action_explains_why_it_was_skipped(
    client, owner_listing, django_user_model, groups
):
    _, provider = owner_listing
    lead = staff(django_user_model, "lead", groups["lead"])
    client.force_login(lead)
    response = client.post(
        reverse("admin:providers_provider_changelist"),
        {"action": "publish_listings", "_selected_action": [provider.pk]},
        follow=True,
    )
    provider.refresh_from_db()
    assert provider.status == Provider.Status.PENDING_APPROVAL
    assert "not confirmed yet: Owner Academy" in response.content.decode()


@pytest.mark.django_db
def test_super_admin_confirms_and_it_is_recorded(client, owner_listing, django_user_model):
    trainer, _ = owner_listing
    boss = staff(django_user_model, "boss", superuser=True)
    client.force_login(boss)
    client.post(
        reverse("admin:providers_traineraccount_changelist"),
        {"action": "confirm_trainers", "_selected_action": [trainer.pk]},
    )
    trainer.refresh_from_db()
    assert trainer.approval_status == TrainerAccount.Approval.CONFIRMED
    assert trainer.approval_decided_by == boss
    assert trainer.approval_decided_at is not None


@pytest.mark.django_db
def test_operations_lead_cannot_confirm(client, owner_listing, django_user_model, groups):
    trainer, _ = owner_listing
    lead = staff(django_user_model, "lead", groups["lead"])
    client.force_login(lead)
    changelist = client.get(reverse("admin:providers_traineraccount_changelist"))
    assert changelist.status_code == 200
    assert b"confirm_trainers" not in changelist.content
    client.post(
        reverse("admin:providers_traineraccount_changelist"),
        {"action": "confirm_trainers", "_selected_action": [trainer.pk]},
    )
    trainer.refresh_from_db()
    assert trainer.approval_status == TrainerAccount.Approval.PENDING


@pytest.mark.django_db
def test_declined_trainer_cannot_sign_in(owner_listing):
    trainer, _ = owner_listing
    trainer.approval_status = TrainerAccount.Approval.DECLINED
    trainer.save()
    with pytest.raises(TrainerAccountDisabled, match="not approved"):
        account_for_verified_phone(phone=PHONE, verified_at=timezone.now())


@pytest.mark.django_db
def test_session_reports_account_status(client, owner_listing):
    trainer, _ = owner_listing
    trainer.approval_note = ""
    trainer.save()
    client.force_login(trainer.user)
    body = client.get(reverse("trainer-session-me")).json()
    assert body["account_status"] == "pending"


@pytest.mark.django_db
def test_sidebar_and_dashboard_show_sign_ups_to_super_admin_only(
    client, owner_listing, django_user_model, groups
):
    from django.core.cache import cache

    boss = staff(django_user_model, "boss", superuser=True)
    lead = staff(django_user_model, "lead", groups["lead"])

    cache.clear()
    client.force_login(boss)
    page = client.get(reverse("admin:index")).content.decode()
    assert "Trainers to confirm" in page
    assert "Confirm trainer sign-ups" in page

    client.force_login(lead)
    page = client.get(reverse("admin:index")).content.decode()
    assert "Trainers to confirm" not in page
    assert "Confirm trainer sign-ups" not in page


@pytest.mark.django_db
def test_setup_groups_does_not_hand_out_confirmation(groups):
    for group in groups.values():
        assert not group.permissions.filter(codename="confirm_trainer").exists()


# --------------------------------------------------------------------------
# Confirming from the row rather than the bulk action


def confirm_url(account):
    from django.urls import reverse

    return reverse("admin:providers_traineraccount_confirm", args=[account.pk])


@pytest.mark.django_db
def test_a_superuser_can_confirm_from_the_list_in_one_click(client, django_user_model):
    from django.utils import timezone

    from providers.trainer_auth import account_for_verified_phone

    account = account_for_verified_phone(phone="+233240000501", verified_at=timezone.now())
    admin = django_user_model.objects.create_superuser("rowadmin", password="x")
    client.force_login(admin)

    response = client.post(confirm_url(account))

    account.refresh_from_db()
    assert response.status_code == 302
    assert account.approval_status == TrainerAccount.Approval.CONFIRMED
    assert account.approval_decided_by == admin
    assert account.approval_decided_at is not None


@pytest.mark.django_db
def test_the_row_endpoint_refuses_a_get(client, django_user_model):
    """It changes state.

    A GET that confirms an account is followed by every crawler, prefetcher and
    link-preview bot that ever sees the page.
    """
    from django.utils import timezone

    from providers.trainer_auth import account_for_verified_phone

    account = account_for_verified_phone(phone="+233240000502", verified_at=timezone.now())
    client.force_login(django_user_model.objects.create_superuser("getadmin", password="x"))

    response = client.get(confirm_url(account))

    account.refresh_from_db()
    assert response.status_code == 405
    assert account.approval_status == TrainerAccount.Approval.PENDING


@pytest.mark.django_db
def test_staff_without_the_permission_cannot_confirm_from_the_row(client, django_user_model):
    """Hiding the bulk action does not protect a URL anyone can POST to."""
    from django.utils import timezone

    from providers.trainer_auth import account_for_verified_phone

    account = account_for_verified_phone(phone="+233240000503", verified_at=timezone.now())
    plain = django_user_model.objects.create_user("plainstaff", password="x", is_staff=True)
    client.force_login(plain)

    response = client.post(confirm_url(account))

    account.refresh_from_db()
    assert response.status_code in (302, 403)
    assert account.approval_status == TrainerAccount.Approval.PENDING


# --------------------------------------------------------------------------
# The evidence, on the page where the decision is made


def trainer_change_url(account):
    return reverse("admin:providers_traineraccount_change", args=[account.pk])


def give_it_photos(provider, *, work=True):
    """One of each kind, which is what a submission must carry."""
    from io import BytesIO

    from django.core.files.base import ContentFile
    from PIL import Image

    from providers.models import ProviderPhoto

    def jpeg():
        buffer = BytesIO()
        Image.new("RGB", (40, 30), "red").save(buffer, format="JPEG")
        return ContentFile(buffer.getvalue())

    kinds = [ProviderPhoto.Kind.WORKSHOP] + ([ProviderPhoto.Kind.WORK] if work else [])
    for kind in kinds:
        photo = ProviderPhoto(provider=provider, kind=kind)
        photo.image.save(f"{kind}.jpg", jpeg(), save=True)


@pytest.mark.django_db
def test_the_review_page_shows_the_listing_they_submitted(
    client, django_user_model, owner_listing, settings, tmp_path
):
    """Confirming asks "is this real". The evidence has to be on the page."""
    settings.MEDIA_ROOT = tmp_path
    trainer, provider = owner_listing
    provider.landmark = "Behind the community market"
    provider.save(update_fields=["landmark"])
    give_it_photos(provider)
    client.force_login(django_user_model.objects.create_superuser("reviewer1", password="pw"))

    body = client.get(trainer_change_url(trainer)).content.decode()

    assert provider.name in body
    assert "Behind the community market" in body
    assert "The workshop (1)" in body
    assert "Their work (1)" in body
    assert "Open the full listing" in body


@pytest.mark.django_db
def test_a_missing_photo_kind_says_so_rather_than_rendering_nothing(
    client, django_user_model, owner_listing, settings, tmp_path
):
    """An empty row reads as a rendering fault.

    "None uploaded" is an answer, and a submission with no picture of the work
    is one a reviewer should push back on.
    """
    settings.MEDIA_ROOT = tmp_path
    trainer, provider = owner_listing
    give_it_photos(provider, work=False)
    client.force_login(django_user_model.objects.create_superuser("reviewer2", password="pw"))

    body = client.get(trainer_change_url(trainer)).content.decode()

    assert "Their work (0)" in body
    assert "None uploaded." in body


@pytest.mark.django_db
def test_a_trainer_with_no_listing_does_not_break_the_page(client, django_user_model):
    """The queue is full of accounts that have submitted nothing yet."""
    account = account_for_verified_phone(phone="+233240000601", verified_at=timezone.now())
    client.force_login(django_user_model.objects.create_superuser("reviewer3", password="pw"))

    response = client.get(trainer_change_url(account))

    assert response.status_code == 200
    assert "No listing yet." in response.content.decode()


@pytest.mark.django_db
def test_the_landmark_is_called_out_when_it_is_missing(
    client, django_user_model, owner_listing, settings, tmp_path
):
    """It is how a field officer finds the place, so its absence is a finding
    rather than a blank."""
    settings.MEDIA_ROOT = tmp_path
    trainer, provider = owner_listing
    provider.landmark = ""
    provider.save(update_fields=["landmark"])
    client.force_login(django_user_model.objects.create_superuser("reviewer4", password="pw"))

    body = client.get(trainer_change_url(trainer)).content.decode()

    assert "none given" in body
