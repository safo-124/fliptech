"""Shared test fixtures.

Note this file cannot be used to choose the env file: pytest-django calls
django.setup() from pytest_load_initial_conftests, which runs before conftest
files are imported. That selection lives in config/settings.py.
"""

import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Give every test a clean cache.

    Rate limits and DRF throttles are counted in the cache and keyed by client
    IP, which is the same for every test. Without this, counters accumulate
    across a run and a test that passes alone starts failing once enough tests
    run before it — the worst kind of flake to diagnose.
    """
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _marketplace_trust_off(settings):
    """The marketplace's trust rules (ID check before payments, holding new
    sellers' and large orders, the new-seller cap) are on in production.
    Tests written before them assume them off; marketplace/tests/test_trust_rules.py
    switches each on where it tests it."""
    settings.MARKETPLACE_REQUIRE_ID = False
    settings.MARKETPLACE_HOLD_FIRST_ORDERS = 0
    settings.MARKETPLACE_HOLD_ABOVE = 0
    settings.MARKETPLACE_NEW_SELLER_LIMIT = 0
