"""A shop opened by a trainer starts from the workshop: its name, area and ID."""

import pytest
from django.core.files.base import ContentFile
from django.urls import reverse

from marketplace.models import SellerAccount
from providers.models import Provider, ProviderEvidence
from providers.tests.test_master_strip import catalogue, owner, save  # noqa: F401
from providers.tests.test_trainer_api import authenticated_csrf


@pytest.mark.django_db
def test_a_trainers_shop_takes_the_workshops_name_area_and_id(owner, catalogue, settings, tmp_path):  # noqa: F811
    settings.PRIVATE_MEDIA_ROOT = tmp_path
    assert save(owner, catalogue).status_code == 200
    provider = Provider.objects.get()
    ProviderEvidence.objects.create(
        provider=provider,
        kind=ProviderEvidence.Kind.ID_DOCUMENT,
        file=ContentFile(b"\xff\xd8\xff card", name="ghana-card.jpg"),
    )

    response = owner.post(reverse("account-add-role", args=["seller"]), **authenticated_csrf(owner))

    assert response.status_code in (200, 201), response.content
    shop = SellerAccount.objects.get()
    assert shop.provider_id == provider.pk
    assert shop.business_name == provider.name
    assert shop.area_id == provider.area_id
    # Not asked for again: the workshop's ID, waiting for the selling check.
    assert shop.id_status == SellerAccount.IdStatus.SUBMITTED
    assert shop.id_document
    assert shop.id_note
