"""Sign-in codes relayed by staff while there is no SMS gateway.

With SMS_PROVIDER=backoffice the person still has to get their code, so it
must reach the back office every time. And because a code there is a working
sign-in, only the right staff may see it, and it must not outlive its expiry.
"""

from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from core import relay
from core.delivery import status
from core.models import RelayedText
from core.sms import send_sms
from enquiries import otp
from enquiries.models import PhoneVerification

PHONE = "+233241112222"


@pytest.fixture
def relaying(settings):
    settings.SMS_PROVIDER = "backoffice"


@pytest.fixture
def groups(db):
    call_command("setup_groups", verbosity=0)
    return {
        "officer": Group.objects.get(name="Field officer"),
        "lead": Group.objects.get(name="Operations lead"),
    }


def staff(django_user_model, username, group=None):
    user = django_user_model.objects.create_user(username, password="pw-12345678", is_staff=True)
    if group is not None:
        user.groups.add(group)
    return user


def page_url():
    return reverse("admin:core_relayedtext_changelist")


# --- where the code goes -------------------------------------------------------


@pytest.mark.django_db
def test_a_requested_code_reaches_the_back_office(relaying, monkeypatch):
    monkeypatch.setattr(otp, "_generate_code", lambda: "482913")

    otp.request_code(PHONE)

    text = RelayedText.objects.get()
    assert text.to == PHONE
    assert relay.code_in(text.body) == "482913"
    # The code in the back office is the one the server will accept.
    assert otp.verify_code(PHONE, "482913") == PhoneVerification.objects.get()


@pytest.mark.django_db
def test_the_console_backend_does_not_store_codes(settings):
    settings.SMS_PROVIDER = "console"

    send_sms(PHONE, "123456 is your code")

    assert not RelayedText.objects.exists()


@pytest.mark.django_db
def test_an_expired_code_is_wiped_but_the_record_kept(relaying):
    old = RelayedText.objects.create(to=PHONE, body="111111 is your code")
    RelayedText.objects.filter(pk=old.pk).update(
        created_at=timezone.now() - relay.lifetime() - timedelta(seconds=1)
    )

    send_sms(PHONE, "222222 is your code")

    old.refresh_from_db()
    assert old.body == ""
    assert [relay.code_in(t.body) for t in relay.waiting()] == ["222222"]


@pytest.mark.django_db
def test_a_newer_code_replaces_the_one_before(relaying, monkeypatch):
    """Only the newest code for a number works, so it is the only one to send."""
    codes = iter(["111111", "222222"])
    monkeypatch.setattr(otp, "_generate_code", lambda: next(codes))
    send_sms("+233209998888", "333333 is your code")

    otp.request_code(PHONE)
    otp.request_code(PHONE)

    assert sorted(relay.code_in(t.body) for t in relay.waiting()) == ["222222", "333333"]
    with pytest.raises(otp.OTPError):
        otp.verify_code(PHONE, "111111")


# --- the back-office page --------------------------------------------------------


@pytest.mark.django_db
def test_the_operations_lead_sees_the_code_and_a_way_to_send_it(
    client, django_user_model, groups, relaying
):
    send_sms(PHONE, "482913 is your Skills Hub code. It expires in 10 minutes.")
    client.force_login(staff(django_user_model, "lead", groups["lead"]))

    page = client.get(page_url())

    assert page.status_code == 200
    html = page.content.decode()
    assert "482913" in html
    whatsapp = page.context["waiting"][0]["whatsapp"]
    assert urlsplit(whatsapp).path == "/233241112222"
    assert "482913" in parse_qs(urlsplit(whatsapp).query)["text"][0]


@pytest.mark.django_db
def test_a_field_officer_cannot_see_codes(client, django_user_model, groups, relaying):
    """Anyone who can read a code can sign in as its owner."""
    send_sms(PHONE, "482913 is your code")
    client.force_login(staff(django_user_model, "officer", groups["officer"]))

    assert client.get(page_url()).status_code == 403


@pytest.mark.django_db
def test_marking_sent_records_who_and_when(client, django_user_model, groups, relaying):
    send_sms(PHONE, "482913 is your code")
    text = RelayedText.objects.get()
    lead = staff(django_user_model, "lead", groups["lead"])
    client.force_login(lead)

    response = client.post(reverse("admin:core_relayedtext_sent", args=[text.pk]))

    assert response.status_code == 302
    text.refresh_from_db()
    assert text.relayed_by == lead
    assert text.relayed_at is not None
    assert not relay.waiting().exists()
    # Still shown under "sent" while the code is valid, in case it is asked for again.
    assert len(client.get(page_url()).context["sent"]) == 1


@pytest.mark.django_db
def test_marking_sent_needs_a_post(client, django_user_model, groups, relaying):
    send_sms(PHONE, "482913 is your code")
    client.force_login(staff(django_user_model, "lead", groups["lead"]))

    response = client.get(
        reverse("admin:core_relayedtext_sent", args=[RelayedText.objects.get().pk])
    )

    assert response.status_code == 405
    assert relay.waiting().exists()


@pytest.mark.django_db
def test_an_expired_code_is_not_shown(client, django_user_model, groups, relaying):
    text = RelayedText.objects.create(to=PHONE, body="111111 is your code")
    RelayedText.objects.filter(pk=text.pk).update(
        created_at=timezone.now() - relay.lifetime() - timedelta(seconds=1)
    )
    client.force_login(staff(django_user_model, "lead", groups["lead"]))

    page = client.get(page_url())

    assert "111111" not in page.content.decode()
    text.refresh_from_db()
    assert text.body == ""


@pytest.mark.django_db
def test_the_sidebar_counts_codes_waiting(client, django_user_model, groups, relaying):
    send_sms(PHONE, "482913 is your code")
    client.force_login(staff(django_user_model, "lead", groups["lead"]))

    html = client.get(reverse("admin:index")).content.decode()

    assert "Codes to send" in html
    assert page_url() in html


@pytest.mark.django_db
def test_the_dashboard_says_texts_are_sent_by_staff(relaying):
    texts = next(c for c in status()["channels"] if c["name"] == "Text messages")

    assert texts["live"] is True
    assert texts["provider"] == "sent by staff from the back office"
