"""What brought someone here, ticked once after signing up.

It only decides what their account shows first, so the rules are small: the
three known choices, once each, in a fixed order; "Learn a trade" makes the
login a trainee straight away so a course needs no second sign-in; and
nobody's choice ever shuts them out of the rest of the site.
"""

import pytest
from django.urls import reverse

from accounts.models import CustomerAccount
from accounts.tests.test_accounts import (  # noqa: F401 (codes is a fixture)
    JSON,
    codes,
    sign_in,
    trainee_sign_in,
)
from trainees.models import TraineeAccount


def tick(client, interests):
    return client.patch(reverse("account"), {"interests": interests}, content_type=JSON)


@pytest.mark.django_db
def test_a_new_account_has_chosen_nothing_yet(client):
    body = sign_in(client).json()

    assert body["joined"] is True
    assert body["account"]["interests"] == []


@pytest.mark.django_db
def test_choices_are_kept_once_each_in_a_fixed_order(client):
    sign_in(client)

    response = tick(client, ["sell", "buy", "buy"])

    assert response.status_code == 200
    assert response.json()["account"]["interests"] == ["buy", "sell"]
    assert CustomerAccount.objects.get().interests == ["buy", "sell"]


@pytest.mark.django_db
def test_an_unknown_choice_is_refused(client):
    sign_in(client)

    assert tick(client, ["buy", "admin"]).status_code == 400
    assert CustomerAccount.objects.get().interests == []


@pytest.mark.django_db
def test_learn_a_trade_makes_the_same_login_a_trainee(client):
    sign_in(client)
    user = CustomerAccount.objects.get().user

    body = tick(client, ["learn", "buy"]).json()

    assert TraineeAccount.objects.get().user == user
    assert body["roles"]["trainee"] == {"href": "/trainee"}
    # The trainee side recognises the same session: no second sign-in.
    assert client.get(reverse("trainee-session-me")).status_code == 200


@pytest.mark.django_db
def test_buying_alone_adds_no_other_role(client):
    sign_in(client)

    body = tick(client, ["buy"]).json()

    assert not TraineeAccount.objects.exists()
    assert body["roles"] == {"trainee": None, "trainer": None, "seller": None}


@pytest.mark.django_db
def test_choosing_needs_a_signed_in_account(client):
    assert tick(client, ["buy"]).status_code in (401, 403)


@pytest.mark.django_db
def test_a_trainee_who_came_in_by_their_own_door_can_buy_too(client):
    """Whichever door: the login gets a buyer account, so checkout and
    "My orders" work for trainees, trainers and sellers alike."""
    trainee_sign_in(client)

    body = client.get(reverse("account")).json()

    assert body["authenticated"] is True
    assert body["roles"]["trainee"] == {"href": "/trainee"}
