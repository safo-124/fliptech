"""Staff opening a trainee's dashboard to help them."""

from datetime import timedelta
from io import StringIO

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from enquiries.models import PhoneVerification
from trainees.models import SavedProvider, SupportSession, TraineeAccount

PHONE = "+233241112222"


@pytest.fixture
def trainee(db):
    from trainees.auth import account_for_verified_phone

    account = account_for_verified_phone(
        phone=PHONE, verified_at=timezone.now(), display_name="Ama"
    )
    return account


def staff_with(django_user_model, username, *perms, superuser=False):
    user = django_user_model.objects.create_user(
        username, password="pw", is_staff=True, is_superuser=superuser
    )
    for perm in perms:
        app_label, codename = perm.split(".")
        user.user_permissions.add(
            Permission.objects.get(content_type__app_label=app_label, codename=codename)
        )
    return django_user_model.objects.get(pk=user.pk)


@pytest.fixture
def lead(django_user_model):
    return staff_with(
        django_user_model,
        "lead",
        "trainees.view_traineeaccount",
        "trainees.change_traineeaccount",
        "trainees.support_access",
        "trainees.view_supportsession",
    )


def open_dashboard(client, trainee, reason="Trainee cannot find their enquiry"):
    return client.post(
        reverse("admin:trainees_traineeaccount_support", args=[trainee.pk]),
        {"reason": reason},
    )


def csrf_headers(client):
    client.get(reverse("trainee-session-me"))
    return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}


@pytest.mark.django_db
def test_lead_opens_dashboard_view_only(client, lead, trainee, settings):
    settings.PUBLIC_SITE_URL = "https://skills.example"
    client.force_login(lead)

    response = open_dashboard(client, trainee)

    assert response.status_code == 302
    assert response["Location"] == "https://skills.example/trainee"
    session = SupportSession.objects.get()
    assert (session.staff_user, session.trainee, session.can_edit) == (lead, trainee, False)

    me = client.get(reverse("trainee-session-me")).json()
    assert me["authenticated"] is True
    assert me["account"]["phone"] == PHONE
    assert me["support"]["can_edit"] is False
    assert me["support"]["reason"] == "Trainee cannot find their enquiry"

    assert client.get(reverse("trainee-enquiries")).status_code == 200
    # Still signed in to the back office.
    assert client.get(reverse("admin:index")).status_code == 200


@pytest.mark.django_db
def test_view_only_support_cannot_change_anything(lead, trainee, django_user_model):
    client = Client(enforce_csrf_checks=True)
    client.force_login(lead)
    session = client.session
    from trainees.support import SESSION_KEY

    live = SupportSession.objects.create(staff_user=lead, trainee=trainee, reason="Helping out")
    session[SESSION_KEY] = live.pk
    session.save()

    response = client.patch(
        reverse("trainee-account"),
        {"display_name": "Changed"},
        content_type="application/json",
        **csrf_headers(client),
    )
    assert response.status_code == 403
    trainee.refresh_from_db()
    assert trainee.display_name == "Ama"
    assert list(live.events.values_list("action", flat=True)) == ["changed"]


@pytest.mark.django_db
def test_edit_permission_allows_logged_changes(client, django_user_model, trainee):
    helper = staff_with(
        django_user_model,
        "helper",
        "trainees.view_traineeaccount",
        "trainees.support_access",
        "trainees.support_edit",
    )
    client.force_login(helper)
    open_dashboard(client, trainee)

    response = client.patch(
        reverse("trainee-account"),
        {"display_name": "Ama Mensah"},
        content_type="application/json",
    )
    assert response.status_code == 200
    session = SupportSession.objects.get()
    assert session.can_edit is True
    assert "updated_account" in list(session.events.values_list("action", flat=True))


@pytest.mark.django_db
def test_support_can_never_close_the_account(client, django_user_model, trainee):
    helper = staff_with(
        django_user_model,
        "helper",
        "trainees.view_traineeaccount",
        "trainees.support_access",
        "trainees.support_edit",
    )
    client.force_login(helper)
    open_dashboard(client, trainee)
    response = client.post(
        reverse("trainee-account-close"), {"confirm": True}, content_type="application/json"
    )
    assert response.status_code == 403
    assert TraineeAccount.objects.filter(pk=trainee.pk).exists()


@pytest.mark.django_db
def test_reason_is_required(client, lead, trainee):
    client.force_login(lead)
    response = open_dashboard(client, trainee, reason="  ")
    assert response.status_code == 200
    assert "Give a short reason" in response.content.decode()
    assert not SupportSession.objects.exists()


@pytest.mark.django_db
def test_staff_without_permission_cannot_open(client, django_user_model, trainee):
    officer = staff_with(django_user_model, "officer", "trainees.view_traineeaccount")
    client.force_login(officer)
    assert open_dashboard(client, trainee).status_code == 403
    assert client.get(reverse("trainee-enquiries")).status_code == 403


@pytest.mark.django_db
def test_switched_off_trainee_cannot_be_opened(client, lead, trainee):
    trainee.is_active = False
    trainee.save()
    client.force_login(lead)
    response = open_dashboard(client, trainee)
    assert response.status_code == 200
    assert not SupportSession.objects.exists()


@pytest.mark.django_db
def test_session_expires(client, lead, trainee):
    client.force_login(lead)
    open_dashboard(client, trainee)
    SupportSession.objects.update(expires_at=timezone.now() - timedelta(seconds=1))

    assert client.get(reverse("trainee-enquiries")).status_code == 403
    session = SupportSession.objects.get()
    assert session.end_reason == SupportSession.EndReason.EXPIRED


@pytest.mark.django_db
def test_revoking_permission_ends_access_at_once(client, lead, trainee):
    client.force_login(lead)
    open_dashboard(client, trainee)
    lead.user_permissions.remove(Permission.objects.get(codename="support_access"))

    assert client.get(reverse("trainee-enquiries")).status_code == 403
    assert SupportSession.objects.get().ended_at is not None


@pytest.mark.django_db
def test_leaving_support_mode_keeps_staff_signed_in(client, lead, trainee):
    client.force_login(lead)
    open_dashboard(client, trainee)

    body = client.post(reverse("trainee-logout")).json()

    assert body["back_office_url"].endswith(f"/traineeaccount/{trainee.pk}/change/")
    assert SupportSession.objects.get().end_reason == SupportSession.EndReason.ENDED_BY_STAFF
    assert client.get(reverse("trainee-enquiries")).status_code == 403
    assert client.get(reverse("admin:index")).status_code == 200


@pytest.mark.django_db
def test_end_from_back_office(client, lead, trainee):
    client.force_login(lead)
    open_dashboard(client, trainee)
    response = client.post(reverse("admin:trainees_support_end"))
    assert response.status_code == 302
    assert SupportSession.objects.get().ended_at is not None


@pytest.mark.django_db
def test_new_session_replaces_the_old_one(client, lead, trainee):
    from trainees.auth import account_for_verified_phone

    second = account_for_verified_phone(phone="+233243334444", verified_at=timezone.now())
    client.force_login(lead)
    open_dashboard(client, trainee)
    open_dashboard(client, second, reason="Second trainee needs help")

    first, latest = SupportSession.objects.order_by("started_at")
    assert first.end_reason == SupportSession.EndReason.REPLACED
    assert client.get(reverse("trainee-session-me")).json()["account"]["phone"] == str(second.phone)


@pytest.mark.django_db
def test_staff_logout_closes_sessions(client, lead, trainee):
    client.force_login(lead)
    open_dashboard(client, trainee)
    client.post(reverse("admin:logout"))
    assert SupportSession.objects.get().end_reason == SupportSession.EndReason.STAFF_SIGNED_OUT


@pytest.mark.django_db
def test_views_are_logged(client, lead, trainee):
    client.force_login(lead)
    open_dashboard(client, trainee)
    client.get(reverse("trainee-enquiries"))
    client.get(reverse("trainee-saved"))
    paths = list(
        SupportSession.objects.get()
        .events.filter(action="viewed")
        .values_list("detail__path", flat=True)
    )
    assert paths == [reverse("trainee-enquiries"), reverse("trainee-saved")]


@pytest.mark.django_db
def test_support_log_is_read_only(client, django_user_model, trainee, lead):
    boss = staff_with(django_user_model, "boss", superuser=True)
    client.force_login(lead)
    open_dashboard(client, trainee)
    client.force_login(boss)
    session = SupportSession.objects.get()
    change_url = reverse("admin:trainees_supportsession_change", args=[session.pk])
    page = client.get(change_url)
    assert page.status_code == 200
    assert b"Trainee cannot find their enquiry" in page.content
    assert client.post(change_url, {"reason": "edited"}).status_code == 403
    delete_url = reverse("admin:trainees_supportsession_delete", args=[session.pk])
    assert client.post(delete_url, {"post": "yes"}).status_code == 403


# --- back office screens -----------------------------------------------------------


@pytest.mark.django_db
def test_trainee_admin_pages_render(client, django_user_model, trainee):
    boss = staff_with(django_user_model, "boss", superuser=True)
    client.force_login(boss)
    changelist = client.get(reverse("admin:trainees_traineeaccount_changelist"))
    change = client.get(reverse("admin:trainees_traineeaccount_change", args=[trainee.pk]))
    assert changelist.status_code == change.status_code == 200
    assert b"Open dashboard" in change.content
    assert b"Erase data" in change.content
    assert client.get(reverse("admin:trainees_traineeaccount_add")).status_code == 403
    assert client.get(reverse("admin:index")).status_code == 200
    assert b"Trainee accounts" in client.get(reverse("admin:index")).content


@pytest.mark.django_db
def test_lead_without_erase_permission_sees_no_erase(client, lead, trainee):
    client.force_login(lead)
    change = client.get(reverse("admin:trainees_traineeaccount_change", args=[trainee.pk]))
    assert b"Open dashboard" in change.content
    assert b"Erase data" not in change.content
    assert (
        client.get(reverse("admin:trainees_traineeaccount_erase", args=[trainee.pk])).status_code
        == 403
    )


@pytest.mark.django_db
def test_erase_needs_typed_confirmation_and_redacts(client, django_user_model, trainee):
    from datetime import date

    from django.contrib.gis.geos import Point

    from catalog.models import Programme, Trade
    from enquiries.models import Enquiry, Enrolment
    from geography.models import Area, Region
    from providers.models import Provider

    point = Point(-0.187, 5.6037, srid=4326)
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=point)
    provider = Provider.objects.create(
        name="Works",
        slug="works",
        area=area,
        location=point,
        contact_phone="+233240000000",
        status=Provider.Status.PUBLISHED,
    )
    programme = Programme.objects.create(
        provider=provider,
        trade=Trade.objects.create(name="Welding", slug="welding"),
        title="Arc",
        fee=1,
        duration_weeks=1,
    )
    enquiry = Enquiry.objects.create(
        provider=provider,
        programme=programme,
        trainee_phone=PHONE,
        trainee_name="Ama",
        message="Please call me",
        trainee=trainee,
    )
    Enrolment.objects.create(
        provider=provider,
        programme=programme,
        trainee_phone=PHONE,
        trainee_name="Ama",
        started_on=date.today(),
    )
    SavedProvider.objects.create(trainee=trainee, provider=provider)
    PhoneVerification.objects.create(phone=PHONE, code_hash="x", expires_at=timezone.now())
    boss = staff_with(django_user_model, "boss", superuser=True)
    client.force_login(boss)
    support = SupportSession.objects.create(staff_user=boss, trainee=trainee, reason="Help")
    url = reverse("admin:trainees_traineeaccount_erase", args=[trainee.pk])

    wrong = client.post(url, {"confirm_phone": "+233000000000"})
    assert wrong.status_code == 200
    assert TraineeAccount.objects.exists()

    done = client.post(url, {"confirm_phone": PHONE})
    assert done.status_code == 302

    assert not TraineeAccount.objects.exists()
    assert not TraineeAccount.history.filter(id=trainee.pk).exists()
    assert not SavedProvider.objects.exists()
    assert not PhoneVerification.objects.filter(phone=PHONE).exists()
    enquiry.refresh_from_db()
    assert (enquiry.trainee_name, enquiry.message, enquiry.trainee) == ("", "", None)
    assert Enrolment.objects.get().trainee_name == ""
    support.refresh_from_db()
    assert support.trainee is None
    assert not LogEntry.objects.filter(object_repr__contains=PHONE).exists()
    assert LogEntry.objects.filter(object_repr=f"Trainee #{trainee.pk} (erased)").exists()


@pytest.mark.django_db
def test_setup_groups_gives_lead_support_but_not_officer(trainee, django_user_model):
    call_command("setup_groups", stdout=StringIO())
    lead_group = Group.objects.get(name="Operations lead")
    officer_group = Group.objects.get(name="Field officer")
    codes = set(lead_group.permissions.values_list("codename", flat=True))
    assert {"support_access", "view_traineeaccount", "view_supportsession"} <= codes
    assert not {"support_edit", "erase_trainee", "delete_traineeaccount"} & codes
    officer_codes = set(officer_group.permissions.values_list("codename", flat=True))
    assert not {c for c in officer_codes if "trainee" in c or "support" in c}


@pytest.mark.django_db
def test_support_redirect_keeps_the_loopback_name_staff_used(client, lead, trainee, settings):
    settings.PUBLIC_SITE_URL = "http://127.0.0.1:3000"
    settings.ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
    client.force_login(lead)
    response = client.post(
        reverse("admin:trainees_traineeaccount_support", args=[trainee.pk]),
        {"reason": "Trainee cannot find their enquiry"},
        HTTP_HOST="localhost:8000",
    )
    assert response["Location"] == "http://localhost:3000/trainee"
