"""A signed-in person's own number needs no code; any other number does.

One login covers the site, so the enquiry and quote forms skip the code for
the number the account proved at sign-in. A different number typed into the
same form is somebody else's until it is proved: no enquiry or quote goes out
for it, and asking for a code really texts one.
"""

import pytest
from django.urls import reverse

from accounts.tests.test_accounts import JSON, PHONE, codes, sign_in  # noqa: F401
from catalog.models import Trade
from enquiries.models import Enquiry, PhoneVerification
from enquiries.tests.test_enquiry_api import programme  # noqa: F401

OTHER = "+233249998888"


@pytest.mark.django_db
def test_the_accounts_own_number_enquires_without_a_code(client, programme):  # noqa: F811
    sign_in(client)

    asked = client.post(reverse("otp-request"), {"phone": PHONE}, content_type=JSON)
    sent = client.post(
        reverse("enquiry-create"),
        {"phone": PHONE, "programme_id": programme.pk, "message": "Beginners?"},
        content_type=JSON,
    )

    assert asked.json() == {"verified": True, "code_sent": False}
    assert sent.status_code == 201, sent.content


@pytest.mark.django_db
def test_another_number_needs_its_own_code_to_enquire(client, programme):  # noqa: F811
    sign_in(client)
    before = PhoneVerification.objects.filter(phone=OTHER).count()

    asked = client.post(reverse("otp-request"), {"phone": OTHER}, content_type=JSON)
    refused = client.post(
        reverse("enquiry-create"),
        {"phone": OTHER, "programme_id": programme.pk, "message": "Beginners?"},
        content_type=JSON,
    )

    assert asked.json()["verified"] is False
    assert PhoneVerification.objects.filter(phone=OTHER).count() == before + 1
    assert refused.status_code == 403
    assert not Enquiry.objects.exists()

    proved = client.post(
        reverse("otp-verify"), {"phone": OTHER, "code": "135791"}, content_type=JSON
    )
    assert proved.status_code == 200, proved.content
    sent = client.post(
        reverse("enquiry-create"),
        {"phone": OTHER, "programme_id": programme.pk, "message": "Beginners?"},
        content_type=JSON,
    )
    assert sent.status_code == 201, sent.content


def quote(client, phone):
    return client.post(
        reverse("quote-create"),
        {
            "trade": "welding",
            "title": "Gate",
            "details": "A sliding gate, 4 m.",
            "name": "Esi",
            "phone": phone,
        },
        content_type=JSON,
    )


@pytest.mark.django_db
def test_a_quote_for_another_number_needs_its_code(client):
    Trade.objects.create(name="Welding", slug="welding")
    sign_in(client)

    assert quote(client, OTHER).status_code == 403
    assert quote(client, PHONE).status_code in (200, 201)
