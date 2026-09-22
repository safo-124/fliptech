"""Real photographs of real trades, for the demo data.

The generated panels in demo_images.py say what they are and never pretend to
be photography, which is right for a placeholder but useless for judging how
the cards and the profile actually look. These are photographs, from Wikimedia
Commons, chosen for West Africa: a directory of workshops in Accra illustrated
with European factory floors tells you nothing about the real thing.

Every one is freely licensed and every one was looked at before it was listed
here — a file called "Electrical Engineering workshop" turned out to be an
empty classroom, which is the reason for looking rather than trusting titles.

The licences require attribution, so the credit travels with the photograph
into ProviderPhoto.caption, which the profile renders under the image and uses
as its alt text. Removing that caption would breach the licence, not just lose
a nicety.

Not committed to the repo and not fetched during tests. `manage.py
fetch_trade_photos` downloads them into a gitignored cache; seed_demo uses them
only when asked and falls back to the generated panels otherwise, so CI never
depends on the network or on Commons still holding a given file.

These belong to demo data. They must never be attached to a real listing: a
photograph of somebody else's workshop presented as this one's premises is
exactly the invented evidence the product exists to prevent.
"""

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from django.conf import settings

COMMONS_API = "https://commons.wikimedia.org/w/api.php"

# Commons asks for a descriptive agent that identifies the caller.
USER_AGENT = "FliiptechSkillsHub/1.0 (demo seed imagery; https://github.com/safo-124/fliptech)"

# Downloaded at this width. The upload pipeline caps the stored edge at 2048
# anyway, and asking Commons for the 5472px original to then shrink it is rude
# to a service handing out bandwidth for free.
REQUEST_WIDTH = 1600

WORKSHOP = "workshop"
WORK = "work"

# trade slug -> the photographs, in the order a provider shows them.
PHOTOS = {
    "welding": [
        {
            "kind": WORKSHOP,
            "title": "File:Welder in Ghana (5927500042).jpg",
            "author": "USAID Africa Bureau",
            "licence": "Public domain",
        },
        {
            "kind": WORK,
            "title": "File:A welder. man at north east of Nigeria.jpg",
            "author": "ABDULIUMAR",
            "licence": "CC BY-SA 4.0",
        },
    ],
    "tailoring": [
        {
            "kind": WORKSHOP,
            "title": "File:A Nigerian seamstress.jpg",
            "author": "Sinachworld",
            "licence": "CC BY-SA 4.0",
        },
        {
            "kind": WORK,
            "title": "File:A professional tailor mechanic in Northern Ghana 01.jpg",
            "author": "Sir Amugi",
            "licence": "CC BY-SA 4.0",
        },
    ],
    "plumbing": [
        {
            "kind": WORKSHOP,
            "title": "File:Cameroon male plumbier at work 02.jpg",
            "author": "Gatien TITCHO SEUMO",
            "licence": "CC BY-SA 4.0",
        },
        {
            "kind": WORK,
            "title": "File:Plumber 01.jpg",
            "author": "Amuzujoe",
            "licence": "CC BY-SA 4.0",
        },
    ],
    "auto-mechanics": [
        {
            "kind": WORKSHOP,
            "title": "File:Auto Mechanic 066.jpg",
            "author": "Amuzujoe",
            "licence": "CC BY-SA 4.0",
        },
        {
            "kind": WORK,
            "title": "File:Ghana Mechanic Working.jpg",
            "author": "Richard Boadi",
            "licence": "CC BY-SA 4.0",
        },
    ],
    "hairdressing": [
        {
            "kind": WORKSHOP,
            "title": "File:Elmina Hairdresser Salon B002.jpg",
            "author": "Adam Jones on Flickr",
            "licence": "CC BY-SA 2.0",
        },
        {
            "kind": WORK,
            "title": "File:A hairdresser braiding hair.jpg",
            "author": "KISUMAR123",
            "licence": "CC BY-SA 4.0",
        },
    ],
    "electrical-installation": [
        {
            "kind": WORKSHOP,
            "title": "File:Electrician 02.jpg",
            "author": "Amuzujoe",
            "licence": "CC BY-SA 4.0",
        },
        {
            "kind": WORK,
            "title": "File:Electrician 01.jpg",
            "author": "Amuzujoe",
            "licence": "CC BY-SA 4.0",
        },
    ],
}


def credit(entry):
    """The attribution the licence requires, in a sentence a reader can parse."""
    return f"Photograph by {entry['author']}, {entry['licence']}, via Wikimedia Commons."


def cache_dir():
    return Path(settings.BASE_DIR) / ".trade-photos"


def filename(trade_slug, entry):
    safe = re.sub(r"[^a-z0-9]+", "-", entry["title"].lower().removeprefix("file:")).strip("-")
    return f"{trade_slug}--{safe}"


def cached(trade_slug, entry):
    path = cache_dir() / filename(trade_slug, entry)
    return path if path.exists() else None


def available():
    """True when the cache holds at least one photograph for every trade."""
    return all(any(cached(slug, entry) for entry in entries) for slug, entries in PHOTOS.items())


def for_trade(trade_slug):
    """[(kind, bytes, caption)] for whatever is cached, in manifest order."""
    out = []
    for entry in PHOTOS.get(trade_slug, []):
        path = cached(trade_slug, entry)
        if path:
            out.append((entry["kind"], path.read_bytes(), credit(entry)))
    return out


def _thumb_urls(titles):
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "titles": "|".join(titles),
            "prop": "imageinfo",
            "iiprop": "url",
            "iiurlwidth": REQUEST_WIDTH,
        }
    )
    request = urllib.request.Request(f"{COMMONS_API}?{params}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        pages = json.load(response)["query"]["pages"]
    return {
        page["title"]: page["imageinfo"][0]["thumburl"]
        for page in pages.values()
        if page.get("imageinfo")
    }


def download(report=print):
    """Fetch anything not already cached. Returns how many were written."""
    directory = cache_dir()
    directory.mkdir(parents=True, exist_ok=True)

    wanted = [
        (slug, entry)
        for slug, entries in PHOTOS.items()
        for entry in entries
        if not cached(slug, entry)
    ]
    if not wanted:
        report("Every photograph is already cached.")
        return 0

    urls = _thumb_urls([entry["title"] for _, entry in wanted])
    written = 0
    for slug, entry in wanted:
        url = urls.get(entry["title"])
        if not url:
            # A file can be renamed or deleted on Commons. Say which, and carry
            # on: a missing photograph falls back to a generated panel.
            report(f"  not found on Commons, skipping: {entry['title']}")
            continue
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            (directory / filename(slug, entry)).write_bytes(response.read())
        report(f"  {slug:<24} {entry['title']}")
        written += 1
    return written
