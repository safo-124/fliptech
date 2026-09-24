"""A trainer marking their own enquiry as answered.

The list was read-only, so "needs a reply" never shrank however many people
the owner had actually called back. This writes to EnquiryOutcome, which staff
also write to, so the tests that matter are about who may write, to which rows,
and what is left behind for the back office to read afterwards.
"""

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from catalog.models import Programme, Trade
from enquiries.models import Enquiry, EnquiryOutcome
from geography.models import Area, Region
from providers.models import Provider, ProviderMembership, TrainerAccount
from providers.trainer_auth import account_for_verified_phone

ACCRA = Point(-0.1870, 5.6037, srid=4326)


def url(reference_code):
    return reverse("trainer-enquiry-replied", args=[reference_code])


def make_world(phone, slug, name):
    region, _ = Region.objects.get_or_create(name="Greater Accra", slug="greater-accra")
    area, _ = Area.objects.get_or_create(
        region=region, name="Accra", slug="accra", defaults={"centroid": ACCRA}
    )
    trade, _ = Trade.objects.get_or_create(name="Welding", slug="welding")
    provider = Provider.objects.create(
        name=name, slug=slug, area=area, location=ACCRA, contact_phone="+233241234567"
    )
    account = account_for_verified_phone(phone=phone, verified_at=timezone.now())
    account.approval_status = TrainerAccount.Approval.CONFIRMED
    account.save(update_fields=["approval_status"])
    ProviderMembership.objects.create(trainer=account, provider=provider)
    programme = Programme.objects.create(
        provider=provider, trade=trade, title="Arc welding", fee=900, duration_weeks=12
    )
    enquiry = Enquiry.objects.create(
        provider=provider,
        programme=programme,
        trainee_phone="+233209998888",
        phone_verified_at=timezone.now(),
    )
    return account, provider, enquiry


@pytest.fixture
def mine(db):
    return make_world("+233240000701", "mine", "My Workshop")


@pytest.mark.django_db
def test_marking_it_replied(client, mine):
    account, _, enquiry = mine
    client.force_login(account.user)

    response = client.post(url(enquiry.reference_code), content_type="application/json")

    assert response.status_code == 200
    assert response.json() == {"reference_code": enquiry.reference_code, "replied": True}
    outcome = EnquiryOutcome.objects.get(enquiry=enquiry)
    assert outcome.replied is True
    assert outcome.replied_at is not None


@pytest.mark.django_db
def test_it_can_be_undone(client, mine):
    """A mis-tap that permanently mislabels an enquiry would make the owner
    trust the list less than no list at all."""
    account, _, enquiry = mine
    client.force_login(account.user)
    client.post(url(enquiry.reference_code), content_type="application/json")

    response = client.post(
        url(enquiry.reference_code), {"replied": False}, content_type="application/json"
    )

    assert response.json()["replied"] is False
    outcome = EnquiryOutcome.objects.get(enquiry=enquiry)
    assert outcome.replied is False
    # A timestamp for something that did not happen.
    assert outcome.replied_at is None


@pytest.mark.django_db
def test_who_said_so_is_recorded(client, mine):
    """Staff read response rate when judging a listing, so a provider's own
    claim has to be tellable from an officer's note. A trainer's user is not
    staff, which is the signal."""
    account, _, enquiry = mine
    client.force_login(account.user)

    client.post(url(enquiry.reference_code), content_type="application/json")

    outcome = EnquiryOutcome.objects.get(enquiry=enquiry)
    assert outcome.recorded_by == account.user
    assert outcome.recorded_by.is_staff is False


@pytest.mark.django_db
def test_it_does_not_clobber_what_staff_recorded(client, mine, django_user_model):
    """The row is shared. Marking a reply must not quietly unset a visit an
    officer recorded during a site call."""
    account, _, enquiry = mine
    officer = django_user_model.objects.create_user("officer", is_staff=True)
    EnquiryOutcome.objects.create(
        enquiry=enquiry, visited=True, enrolled=True, note="Seen on the visit", recorded_by=officer
    )
    client.force_login(account.user)

    client.post(url(enquiry.reference_code), content_type="application/json")

    outcome = EnquiryOutcome.objects.get(enquiry=enquiry)
    assert outcome.replied is True
    assert outcome.visited is True
    assert outcome.enrolled is True
    assert outcome.note == "Seen on the visit"


@pytest.mark.django_db
def test_another_workshops_enquiry_is_not_found(client, mine):
    """Not 403: whether a reference exists on someone else's listing is not
    this account's business either."""
    account, _, _ = mine
    _, _, theirs = make_world("+233240000702", "theirs", "Their Workshop")
    client.force_login(account.user)

    response = client.post(url(theirs.reference_code), content_type="application/json")

    assert response.status_code == 404
    assert not EnquiryOutcome.objects.filter(enquiry=theirs).exists()


@pytest.mark.django_db
def test_a_stranger_cannot_write(client, mine):
    account, _, enquiry = mine
    del account
    response = client.post(url(enquiry.reference_code), content_type="application/json")

    assert response.status_code in (401, 403)
    assert not EnquiryOutcome.objects.filter(enquiry=enquiry).exists()


@pytest.mark.django_db
def test_a_nonsense_value_is_refused(client, mine):
    account, _, enquiry = mine
    client.force_login(account.user)

    response = client.post(
        url(enquiry.reference_code), {"replied": "yes please"}, content_type="application/json"
    )

    assert response.status_code == 400
    assert not EnquiryOutcome.objects.filter(enquiry=enquiry).exists()


@pytest.mark.django_db
def test_the_list_reflects_it(client, mine):
    """The point of the whole thing: the needs-a-reply filter has to shrink."""
    account, _, enquiry = mine
    client.force_login(account.user)

    before = client.get(reverse("trainer-own-enquiries")).json()
    assert before[0]["replied"] is False

    client.post(url(enquiry.reference_code), content_type="application/json")

    after = client.get(reverse("trainer-own-enquiries")).json()
    assert after[0]["replied"] is True
