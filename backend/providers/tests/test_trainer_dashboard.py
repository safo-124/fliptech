"""Screen 5 for a signed-in trainer.

Two things matter here. The numbers must match what the tokenised link shows,
because an owner who sees one figure in a link and another after signing in
stops believing either. And a trainer must only ever reach their own listing —
there is no id in the URL precisely so there is nothing to tamper with, and
that needs a test rather than a comment.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from enquiries.models import Enquiry, EnquiryOutcome
from geography.models import Area, Region
from providers.dashboard import make_dashboard_token
from providers.models import Provider, ProviderMembership
from providers.trainer_auth import account_for_verified_phone

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PHONE = "+233241119001"
OTHER_PHONE = "+233241119002"


@pytest.fixture
def area(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    return Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)


def make_listing(area, *, phone, name, slug):
    """A published listing owned by a signed-in-able trainer."""
    account = account_for_verified_phone(phone=phone, verified_at=timezone.now())
    provider = Provider.objects.create(
        name=name,
        slug=slug,
        area=area,
        location=ACCRA,
        contact_phone="+233240000000",
        status=Provider.Status.PUBLISHED,
        published_at=timezone.now(),
    )
    ProviderMembership.objects.create(
        trainer=account, provider=provider, role=ProviderMembership.Role.OWNER
    )
    return account, provider


def add_enquiry(provider, *, replied_within_48h):
    # reference_code is unique across the table, so it cannot be derived from
    # the provider and the reply flag — two enquiries to one workshop with the
    # same outcome is the ordinary case, not an edge one.
    enquiry = Enquiry.objects.create(
        provider=provider,
        trainee_phone="+233245550000",
        reference_code=uuid4().hex[:12].upper(),
    )
    if replied_within_48h:
        EnquiryOutcome.objects.create(
            enquiry=enquiry,
            replied=True,
            replied_at=enquiry.created_at + timedelta(hours=2),
        )
    return enquiry


def dashboard_url():
    return reverse("trainer-own-dashboard")


# --------------------------------------------------------------------------
# The numbers


@pytest.mark.django_db
def test_a_signed_in_trainer_sees_their_own_numbers(client, area):
    account, provider = make_listing(area, phone=PHONE, name="Accra Welding", slug="accra-welding")
    add_enquiry(provider, replied_within_48h=True)
    add_enquiry(provider, replied_within_48h=False)
    client.force_login(account.user)

    body = client.get(dashboard_url()).json()

    assert body["enquiries"] == 2
    assert body["response_rate"] == 0.5
    assert body["provider"]["name"] == "Accra Welding"


@pytest.mark.django_db
def test_the_signed_in_numbers_match_the_tokenised_link(client, area):
    """Both doors call the same function, and this is what keeps it that way."""
    account, provider = make_listing(area, phone=PHONE, name="Accra Welding", slug="accra-welding")
    add_enquiry(provider, replied_within_48h=True)
    client.force_login(account.user)

    signed_in = client.get(dashboard_url()).json()
    by_token = client.get(
        reverse("provider-dashboard", args=[make_dashboard_token(provider)])
    ).json()

    assert signed_in == by_token


@pytest.mark.django_db
def test_profile_views_is_null_rather_than_zero(client, area):
    """There is no analytics source.

    A zero reads as "nobody looked", which is a claim the software cannot
    make. Null reads as "not measured", which is true.
    """
    account, _ = make_listing(area, phone=PHONE, name="Accra Welding", slug="accra-welding")
    client.force_login(account.user)

    assert client.get(dashboard_url()).json()["profile_views"] is None


# --------------------------------------------------------------------------
# Scoping


@pytest.mark.django_db
def test_a_trainer_cannot_see_another_workshops_numbers(client, area):
    _, theirs = make_listing(area, phone=PHONE, name="Theirs", slug="theirs")
    add_enquiry(theirs, replied_within_48h=True)
    add_enquiry(theirs, replied_within_48h=True)

    intruder, _ = make_listing(area, phone=OTHER_PHONE, name="Mine", slug="mine")
    client.force_login(intruder.user)

    body = client.get(dashboard_url()).json()

    # Their own listing, with none of the other workshop's enquiries.
    assert body["provider"]["name"] == "Mine"
    assert body["enquiries"] == 0


@pytest.mark.django_db
def test_a_trainer_with_no_listing_gets_a_clear_404(client, db):
    account = account_for_verified_phone(phone=PHONE, verified_at=timezone.now())
    client.force_login(account.user)

    assert client.get(dashboard_url()).status_code == 404


@pytest.mark.django_db
def test_signing_out_closes_the_dashboard(client, area):
    account, _ = make_listing(area, phone=PHONE, name="Accra Welding", slug="accra-welding")
    client.force_login(account.user)
    assert client.get(dashboard_url()).status_code == 200

    client.logout()

    assert client.get(dashboard_url()).status_code in (401, 403)


# --------------------------------------------------------------------------
# The enquiries behind the numbers


@pytest.mark.django_db
def test_the_enquiry_list_is_scoped_to_the_signed_in_trainer(client, area):
    _, theirs = make_listing(area, phone=PHONE, name="Theirs", slug="theirs")
    add_enquiry(theirs, replied_within_48h=False)

    intruder, mine = make_listing(area, phone=OTHER_PHONE, name="Mine", slug="mine")
    add_enquiry(mine, replied_within_48h=False)
    client.force_login(intruder.user)

    mine_codes = {enquiry.reference_code for enquiry in Enquiry.objects.filter(provider=mine)}
    body = client.get(reverse("trainer-own-enquiries")).json()

    assert len(body) == 1
    assert body[0]["reference_code"] in mine_codes


@pytest.mark.django_db
def test_the_dashboard_reports_whether_the_listing_needs_confirming(client, area):
    """Drives the prompt on the dashboard, so the owner is asked rather than
    left to guess why their listing says unconfirmed."""
    account, provider = make_listing(area, phone=PHONE, name="Accra Welding", slug="accra-welding")
    provider.last_confirmed_at = None
    provider.save(update_fields=["last_confirmed_at"])
    client.force_login(account.user)

    listing = client.get(dashboard_url()).json()["listing"]

    assert listing["is_stale"] is True
    assert listing["status"] == Provider.Status.PUBLISHED
