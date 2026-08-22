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
