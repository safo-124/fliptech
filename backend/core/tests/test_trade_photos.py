"""The photograph manifest, without touching the network.

Nothing here reaches Wikimedia Commons. A test suite that did would fail on a
train, and would fail for reasons that have nothing to do with this code.
"""

import pytest

from core import trade_photos


def test_every_trade_the_seeder_uses_has_photographs():
    """The seeder composes provider names from these trades. A slug that drifts
    out of the manifest means those providers silently fall back to panels."""
    from core.management.commands.seed_demo import TRADES

    seeded = {slug for _, slug, _ in TRADES}

    assert seeded == set(trade_photos.PHOTOS)


def test_each_trade_has_one_of_each_kind():
    """The profile groups the workshop and the work as two answers to two
    different questions. One of each is the minimum that shows both."""
    for slug, entries in trade_photos.PHOTOS.items():
        kinds = [entry["kind"] for entry in entries]
        assert trade_photos.WORKSHOP in kinds, slug
        assert trade_photos.WORK in kinds, slug


def test_every_entry_carries_an_author_and_a_licence():
    """These are CC BY and CC BY-SA files. An entry without a credit cannot be
    attributed, and an unattributed copy is not licensed."""
    for slug, entries in trade_photos.PHOTOS.items():
        for entry in entries:
            assert entry["author"].strip(), f"{slug}: {entry['title']}"
            assert entry["licence"].strip(), f"{slug}: {entry['title']}"


def test_the_credit_names_the_author_the_licence_and_the_source():
    line = trade_photos.credit(
        {"author": "Sir Amugi", "licence": "CC BY-SA 4.0", "title": "File:X.jpg"}
    )

    assert "Sir Amugi" in line
    assert "CC BY-SA 4.0" in line
    assert "Wikimedia Commons" in line


def test_filenames_are_distinct_and_safe():
    """They become paths. A stray slash or colon from a Commons title would
    write outside the cache directory or fail on Windows."""
    names = [
        trade_photos.filename(slug, entry)
        for slug, entries in trade_photos.PHOTOS.items()
        for entry in entries
    ]

    assert len(names) == len(set(names))
    for name in names:
        assert not set(name) & set('/\\:*?"<>|')


@pytest.fixture
def empty_cache(settings, tmp_path):
    settings.BASE_DIR = tmp_path
    return tmp_path


def test_an_empty_cache_offers_nothing_rather_than_failing(empty_cache):
    """seed_demo without --real-photos, and CI, both land here."""
    assert trade_photos.available() is False
    assert trade_photos.for_trade("welding") == []


def test_a_cached_file_is_offered_with_its_credit(empty_cache):
    entry = trade_photos.PHOTOS["welding"][0]
    path = trade_photos.cache_dir()
    path.mkdir(parents=True, exist_ok=True)
    (path / trade_photos.filename("welding", entry)).write_bytes(b"not-really-a-jpeg")

    got = trade_photos.for_trade("welding")

    assert len(got) == 1
    kind, content, caption = got[0]
    assert kind == trade_photos.WORKSHOP
    assert content == b"not-really-a-jpeg"
    assert caption == trade_photos.credit(entry)


def test_available_needs_every_trade(empty_cache):
    """One cached file is not a set. Reporting ready on a partial cache would
    leave half the site on panels with no warning."""
    entry = trade_photos.PHOTOS["welding"][0]
    trade_photos.cache_dir().mkdir(parents=True, exist_ok=True)
    (trade_photos.cache_dir() / trade_photos.filename("welding", entry)).write_bytes(b"x")

    assert trade_photos.available() is False
