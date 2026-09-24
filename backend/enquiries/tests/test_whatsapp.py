"""The click-to-chat links, in both directions.

One module builds both because they have to agree on the wa.me format, and
because the reference code is the only thing tying a WhatsApp conversation
back to a row in this database — a link that drops it is a conversation
nobody can reconcile later.
"""

from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.gis.geos import Point

from catalog.models import Programme, Trade
from enquiries import whatsapp
from enquiries.models import Enquiry
from geography.models import Area, Region
from providers.models import Provider

ACCRA = Point(-0.1870, 5.6037, srid=4326)


def text_of(url):
    return parse_qs(urlparse(url).query)["text"][0]


def number_of(url):
    return urlparse(url).path.lstrip("/")


@pytest.fixture
def enquiry(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    trade = Trade.objects.create(name="Welding", slug="welding")
    provider = Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
    )
    programme = Programme.objects.create(
        provider=provider, trade=trade, title="Arc welding", fee=900, duration_weeks=12
    )
    from django.utils import timezone

    return Enquiry.objects.create(
        provider=provider,
        programme=programme,
        trainee_phone="+233209998888",
        trainee_name="Ama",
        message="Do you take beginners?",
        phone_verified_at=timezone.now(),
    )


def test_a_number_loses_its_plus_and_its_spaces():
    """wa.me reads the path as digits. A plus sign there is a 404."""
    assert number_of(whatsapp.chat_url("+233 24 123 4567", "hi")) == "233241234567"


@pytest.mark.django_db
def test_the_trainee_writes_to_the_workshop(enquiry):
    url = whatsapp.trainee_to_provider(enquiry)

    assert number_of(url) == "233241234567"
    assert enquiry.reference_code in text_of(url)
    assert "Arc welding" in text_of(url)


@pytest.mark.django_db
def test_a_trainee_with_no_programme_still_gets_a_link(enquiry):
    """An enquiry can be about the workshop rather than one course."""
    enquiry.programme = None

    assert "your training" in text_of(whatsapp.trainee_to_provider(enquiry))


@pytest.mark.django_db
def test_the_workshop_writes_back_to_the_trainee(enquiry):
    url = whatsapp.provider_to_trainee(enquiry)

    assert number_of(url) == "233209998888"
    text = text_of(url)
    assert "Ama" in text
    assert "Accra Welding Works" in text
    assert enquiry.reference_code in text


@pytest.mark.django_db
def test_the_reply_names_the_workshop_even_without_a_trainee_name(enquiry):
    """The name is optional on the enquiry form. "Hello , this is..." would be
    the giveaway that nobody read this string out loud."""
    enquiry.trainee_name = ""

    text = text_of(whatsapp.provider_to_trainee(enquiry))

    assert text.startswith("Hello, this is Accra Welding Works")


@pytest.mark.django_db
def test_the_dashboard_hands_the_owner_a_way_to_answer(enquiry):
    """The figures counted enquiries the owner could not reply to."""
    from providers.dashboard import enquiry_payload

    row = enquiry_payload(enquiry.provider)[0]

    assert row["whatsapp_url"] == whatsapp.provider_to_trainee(enquiry)
