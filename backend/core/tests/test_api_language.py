"""The API answers in the language the public site was set to; the back office does not.

There is no Twi or Ga catalogue yet, so the mechanism is shown with French,
which Django and DRF ship translations for: the cookie the site's footer sets
is honoured on /api/, ignored on /back-office/, and an unknown or switched-off
language falls back to English.
"""

import pytest
from django.urls import reverse

URL = "/api/complaints/"


@pytest.fixture
def french_on(settings):
    settings.LANGUAGES = [("en-gb", "English"), ("fr", "French")]


@pytest.mark.django_db
def test_the_api_answers_in_the_sites_language(client, french_on):
    client.cookies["NEXT_LOCALE"] = "fr"

    response = client.post(URL, {}, content_type="application/json")

    assert response.status_code == 400
    assert response["Content-Language"] == "fr"
    # DRF's own French, for a field left out.
    assert "Ce champ est obligatoire." in response.content.decode()
    assert "Accept-Language" in response["Vary"]
    assert "Cookie" in response["Vary"]


@pytest.mark.django_db
def test_the_browsers_preference_counts_when_nothing_was_chosen(client, french_on):
    response = client.post(
        URL, {}, content_type="application/json", HTTP_ACCEPT_LANGUAGE="fr-FR,fr;q=0.9"
    )

    assert response["Content-Language"] == "fr"


@pytest.mark.django_db
def test_a_language_that_is_not_switched_on_stays_english(client):
    client.cookies["NEXT_LOCALE"] = "fr"

    response = client.post(URL, {}, content_type="application/json")

    assert response["Content-Language"] == "en-gb"
    assert "This field is required." in response.content.decode()


@pytest.mark.django_db
def test_twi_with_no_catalogue_yet_reads_as_english(client, settings):
    settings.LANGUAGES = [("en-gb", "English"), ("tw", "Twi")]
    client.cookies["NEXT_LOCALE"] = "tw"

    response = client.post(URL, {}, content_type="application/json")

    assert "This field is required." in response.content.decode()


@pytest.mark.django_db
def test_the_back_office_stays_english(client, french_on):
    """Staff share a browser, and so a cookie, with the public site."""
    client.cookies["NEXT_LOCALE"] = "fr"

    page = client.get(reverse("admin:login")).content.decode()

    assert "Username" in page
    assert "Nom d" not in page
