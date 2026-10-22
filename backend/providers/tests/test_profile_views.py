"""Profile views, the dashboard number Section 04 lists beside enquiries.

The figure goes in front of a paying owner, so the tests are about it being
honest: one person is one view a day, and the owner and staff checking the
listing do not inflate it.
"""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from providers.dashboard import dashboard_payload
from providers.models import ProfileViewDay, Provider, ProviderMembership
from providers.trainer_auth import account_for_verified_phone

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PHONE_UA = "Mozilla/5.0 (Linux; Android 13; SM-A145F) Mobile Safari/537.36"
OTHER_UA = "Mozilla/5.0 (Linux; Android 12; TECNO KH7) Mobile Safari/537.36"


@pytest.fixture
def provider(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    return Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )


def viewed(client, provider, user_agent=PHONE_UA):
    return client.post(
        reverse("provider-profile-viewed", args=[provider.pk]), HTTP_USER_AGENT=user_agent
    )


def counted(provider):
    row = ProfileViewDay.objects.filter(provider=provider, day=timezone.localdate()).first()
    return row.views if row else 0


@pytest.mark.django_db
def test_a_visit_is_counted(client, provider):
    response = viewed(client, provider)

    assert response.status_code == 204
    assert counted(provider) == 1


@pytest.mark.django_db
def test_the_same_visitor_counts_once_a_day(client, provider):
    for _ in range(3):
        assert viewed(client, provider).status_code == 204

    assert counted(provider) == 1


@pytest.mark.django_db
def test_two_visitors_count_twice(client, provider):
    viewed(client, provider, PHONE_UA)
    viewed(client, provider, OTHER_UA)

    assert counted(provider) == 2


@pytest.mark.django_db
def test_crawlers_are_not_counted(client, provider):
    viewed(client, provider, "Mozilla/5.0 (compatible; Googlebot/2.1)")

    assert counted(provider) == 0


@pytest.mark.django_db
def test_staff_looking_at_a_listing_is_not_interest(client, provider, django_user_model):
    client.force_login(django_user_model.objects.create_user("officer", is_staff=True))

    assert viewed(client, provider).status_code == 204
    assert counted(provider) == 0


@pytest.mark.django_db
def test_the_owner_checking_their_own_listing_is_not_counted(client, provider):
    account = account_for_verified_phone(phone="+233205551234", verified_at=timezone.now())
    ProviderMembership.objects.create(trainer=account, provider=provider)
    client.force_login(account.user)

    assert viewed(client, provider).status_code == 204
    assert counted(provider) == 0


@pytest.mark.django_db
def test_a_signed_in_trainee_is_counted_without_a_csrf_token(provider, django_user_model):
    """sendBeacon cannot attach the CSRF header, so the beacon must not need it."""
    browser = Client(enforce_csrf_checks=True)
    browser.force_login(django_user_model.objects.create_user("trainee"))

    assert viewed(browser, provider).status_code == 204
    assert counted(provider) == 1


@pytest.mark.django_db
def test_an_unpublished_listing_is_not_counted(client, provider):
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.SUSPENDED)

    assert viewed(client, provider).status_code == 404
    assert not ProfileViewDay.objects.exists()


@pytest.mark.django_db
def test_reading_the_endpoint_does_not_count(client, provider):
    response = client.get(reverse("provider-profile-viewed", args=[provider.pk]))

    assert response.status_code == 405
    assert counted(provider) == 0


@pytest.mark.django_db
def test_a_young_counter_says_when_it_started(provider):
    """A week of counting must not read as a slow month."""
    started = timezone.localdate() - timedelta(days=6)
    ProfileViewDay.objects.create(provider=provider, day=started, views=3)

    body = dashboard_payload(provider)

    assert body["profile_views"] == 3
    assert body["profile_views_counted_since"] == started
