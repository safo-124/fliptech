"""The header asks who is signed in, and browsing must not answer "nobody".

A trainer signed in to their dashboard clicked "Find training" and every link
in the header then offered to sign them up. The session was intact the whole
time; the header simply had no way to know. These tests cover both halves:
that the question is answered correctly, and that asking the *other* area's
session endpoint — which is what the public pages do — leaves a session alone.
"""

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone

from providers.trainer_auth import account_for_verified_phone
from trainees.auth import account_for_verified_phone as trainee_for_verified_phone

WHOAMI = "session-whoami"
ACCRA = Point(-0.1870, 5.6037, srid=4326)


def whoami(client):
    return client.get(reverse(WHOAMI)).json()


@pytest.fixture
def trainer(db):
    account = account_for_verified_phone(phone="+233201110001", verified_at=timezone.now())
    account.full_name = "Ama Mensah"
    account.save(update_fields=["full_name"])
    return account


@pytest.fixture
def trainee(db):
    account = trainee_for_verified_phone(phone="+233201110002", verified_at=timezone.now())
    account.display_name = "Kofi Owusu"
    account.save(update_fields=["display_name"])
    return account


@pytest.mark.django_db
def test_nobody_signed_in(client):
    assert whoami(client) == {"trainer": None, "trainee": None}


@pytest.mark.django_db
def test_a_signed_in_trainer_is_named(client, trainer):
    client.force_login(trainer.user)

    body = whoami(client)

    assert body["trainee"] is None
    assert body["trainer"] == {"name": "Ama Mensah"}


@pytest.mark.django_db
def test_a_trainer_with_no_name_falls_back_to_their_phone(client, trainer):
    """full_name is blank until they fill the form, and the header still has
    to render something."""
    trainer.full_name = ""
    trainer.save(update_fields=["full_name"])
    client.force_login(trainer.user)

    assert whoami(client)["trainer"]["name"] == "+233201110001"


@pytest.mark.django_db
def test_a_signed_in_trainee_is_named(client, trainee):
    client.force_login(trainee.user)

    body = whoami(client)

    assert body["trainer"] is None
    assert body["trainee"] == {"name": "Kofi Owusu"}


@pytest.mark.django_db
def test_a_deactivated_trainer_is_nobody(client, trainer):
    trainer.is_active = False
    trainer.save(update_fields=["is_active"])
    client.force_login(trainer.user)

    assert whoami(client)["trainer"] is None


@pytest.mark.django_db
def test_staff_are_in_neither_public_area(client, django_user_model):
    """A staff user is signed into the back office, which this does not report.

    Answering "trainee" for someone in a support session would put another
    person's name in the header of whoever is helping them.
    """
    client.force_login(django_user_model.objects.create_superuser("boss", password="pw"))

    assert whoami(client) == {"trainer": None, "trainee": None}


# --------------------------------------------------------------------------
# Browsing the public site does not end a session


@pytest.mark.django_db
def test_a_trainer_survives_the_trainee_session_endpoint(client, trainer):
    """This is the bug as reported: "I log in, click find my training, and it
    logs me out."

    Both areas share one Django session cookie, so an endpoint that answered
    "you are not a trainee" by clearing the session would sign the trainer out
    of their own dashboard.
    """
    client.force_login(trainer.user)

    assert client.get(reverse("trainee-session-me")).json()["authenticated"] is False

    assert client.get(reverse("trainer-session-me")).json()["authenticated"] is True
    assert whoami(client)["trainer"]["name"] == "Ama Mensah"


@pytest.mark.django_db
def test_a_trainee_survives_the_trainer_session_endpoint(client, trainee):
    """The same crossing in the other direction."""
    client.force_login(trainee.user)

    assert client.get(reverse("trainer-session-me")).json()["authenticated"] is False

    assert client.get(reverse("trainee-session-me")).json()["authenticated"] is True
    assert whoami(client)["trainee"] == {"name": "Kofi Owusu"}
