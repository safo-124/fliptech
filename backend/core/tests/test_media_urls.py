"""Public media has to be addressed by where a browser can fetch it.

Every workshop photograph on the search page rendered as a broken box. The
serializer built the URL from the incoming request, and a server-rendered
request arrives on loopback carrying X-Forwarded-Proto: https, so the answer
was https://127.0.0.1:8000/media/... — nothing serves TLS on that port, and
next/image rejected the host outright.
"""

from io import BytesIO

import pytest
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory
from PIL import Image

from core.media import derive_public_origin, public_url
from geography.models import Area, Region
from providers.models import Provider, ProviderPhoto

ACCRA = Point(-0.1870, 5.6037, srid=4326)
PUBLIC = "https://skills.example.com"


def jpeg(name="workshop.jpg"):
    buffer = BytesIO()
    Image.new("RGB", (40, 30), "red").save(buffer, format="JPEG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


@pytest.fixture
def listed_provider(db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Accra", slug="accra", centroid=ACCRA)
    provider = Provider.objects.create(
        name="Accra Welding Works",
        slug="accra-welding-works",
        area=area,
        location=ACCRA,
        contact_phone="+233241234567",
        status=Provider.Status.PUBLISHED,
    )
    ProviderPhoto.objects.create(provider=provider, kind=ProviderPhoto.Kind.WORKSHOP, image=jpeg())
    provider.logo = jpeg("logo.jpg")
    provider.save(update_fields=["logo"])
    return provider


# --------------------------------------------------------------------------
# The helper


def test_a_configured_origin_wins_over_the_request(settings):
    settings.PUBLIC_ORIGIN = PUBLIC
    request = RequestFactory().get("/api/providers/", HTTP_HOST="127.0.0.1:8000")

    assert public_url("/media/a.jpg", request) == f"{PUBLIC}/media/a.jpg"


def test_a_trailing_slash_on_the_origin_does_not_double_up(settings):
    settings.PUBLIC_ORIGIN = PUBLIC + "/"

    assert public_url("/media/a.jpg") == f"{PUBLIC}/media/a.jpg"


def test_without_an_origin_it_falls_back_to_the_request(settings):
    """Development, where Django really is the host that serves the file."""
    settings.PUBLIC_ORIGIN = ""
    request = RequestFactory().get("/api/providers/", HTTP_HOST="127.0.0.1:8000")

    assert public_url("/media/a.jpg", request) == "http://127.0.0.1:8000/media/a.jpg"


def test_with_neither_it_stays_relative(settings):
    settings.PUBLIC_ORIGIN = ""

    assert public_url("/media/a.jpg") == "/media/a.jpg"


def test_no_file_is_no_url(settings):
    settings.PUBLIC_ORIGIN = PUBLIC

    assert public_url("") is None


# --------------------------------------------------------------------------
# Through the API, as server-side rendering calls it


@pytest.mark.django_db
def test_the_card_addresses_photos_where_a_browser_can_reach_them(
    client, listed_provider, settings
):
    """The exact production shape: loopback host, forwarded https scheme."""
    settings.PUBLIC_ORIGIN = PUBLIC

    body = client.get(
        "/api/providers/",
        HTTP_HOST="127.0.0.1:8000",
        HTTP_X_FORWARDED_PROTO="https",
    ).json()

    card = body["results"][0]
    assert card["primary_photo"].startswith(f"{PUBLIC}/media/")
    assert card["logo"].startswith(f"{PUBLIC}/media/")
    assert "127.0.0.1" not in card["primary_photo"]


@pytest.mark.django_db
def test_the_profile_gallery_too(client, listed_provider, settings):
    """The gallery went through DRF's ImageField, which has the same habit."""
    settings.PUBLIC_ORIGIN = PUBLIC

    body = client.get(
        "/api/providers/accra/accra-welding-works/",
        HTTP_HOST="127.0.0.1:8000",
        HTTP_X_FORWARDED_PROTO="https",
    ).json()

    assert body["photos"]
    for photo in body["photos"]:
        assert photo["image"].startswith(f"{PUBLIC}/media/")


@pytest.mark.django_db
def test_a_workshop_with_no_pictures_still_serialises(client, listed_provider, settings):
    settings.PUBLIC_ORIGIN = PUBLIC
    listed_provider.photos.all().delete()
    listed_provider.logo = ""
    listed_provider.save(update_fields=["logo"])

    card = client.get("/api/providers/").json()["results"][0]

    assert card["primary_photo"] is None
    assert card["logo"] is None


def test_the_origin_prefers_the_csrf_setting():
    """It carries a scheme, so it needs no assumption about TLS."""
    assert derive_public_origin([f"{PUBLIC}/"], ["skills.example.com"], debug=False) == PUBLIC


def test_a_wildcard_csrf_entry_is_not_an_address():
    """ "https://*.example.com" is a matching rule. Fetching from it would ask
    for a host that does not resolve."""
    assert derive_public_origin(["https://*.example.com", PUBLIC], [], debug=False) == PUBLIC


def test_it_falls_back_to_the_allowed_host():
    """One origin behind Caddy does not need CSRF_TRUSTED_ORIGINS at all —
    Django compares Origin against the host and passes — so it is commonly
    empty on exactly the deployments this has to work on."""
    hosts = ["skills.example.com", "127.0.0.1"]

    assert derive_public_origin([], hosts, debug=False) == PUBLIC


def test_loopback_is_never_the_public_origin():
    """127.0.0.1 is in ALLOWED_HOSTS only because server-side rendering
    reaches Django that way. It is the wrong answer, and the one this whole
    change exists to stop being given."""
    assert derive_public_origin([], ["127.0.0.1", "localhost"], debug=False) == ""


def test_development_keeps_using_the_request():
    """Django serves its own media under DEBUG, and the request is then a
    truthful account of where it is."""
    assert derive_public_origin([], ["skills.example.com"], debug=True) == ""
