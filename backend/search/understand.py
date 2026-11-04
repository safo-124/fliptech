"""Reading a search the way a person meant it.

People type "welder tema", "sewing classes in madina", "mechanic" or
"weldng". The trade filter wants a slug and the area filter wants a slug, so
this finds the trade (by its name, its slug or any of the synonyms staff keep
on it, allowing a slip of the finger) and the area (by name) inside the free
text, and hands back whatever words are left over for the name search.

Trades and areas are a few dozen rows each, so they are matched here in
Python rather than with one query per word, and cached until either table
changes.
"""

import hashlib
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from django.core.cache import cache
from django.db.models import Count, Max

from catalog.models import Trade
from geography.models import Area

# Words that say what kind of thing is wanted, not which one. Dropped from
# the leftover words so "welding training in tema" leaves nothing to match
# against workshop names.
STOP_WORDS = {
    "a",
    "an",
    "and",
    "around",
    "at",
    "best",
    "by",
    "class",
    "classes",
    "course",
    "courses",
    "for",
    "how",
    "i",
    "in",
    "learn",
    "learning",
    "me",
    "my",
    "near",
    "of",
    "school",
    "schools",
    "the",
    "to",
    "train",
    "trainer",
    "trainers",
    "training",
    "trainings",
    "want",
    "where",
    "with",
    "workshop",
    "workshops",
}

WORD = re.compile(r"[a-z0-9']+")


def normalise(text):
    """Lowercase, punctuation out, spaces collapsed: the form logged and matched."""
    return " ".join(WORD.findall(str(text or "").lower()))[:100]


@dataclass
class Understood:
    trade: Trade | None = None
    area: Area | None = None
    # What is left once the trade, the area and the filler words are taken
    # out, for matching against workshop, course and product names.
    words: str = ""
    # Other trades that look like what was typed, best first. For "Did you
    # mean" and for the suggestions under the search box.
    also: list = field(default_factory=list)


def _stamp():
    trades = Trade.objects.aggregate(n=Count("id"), at=Max("updated_at"))
    areas = Area.objects.aggregate(n=Count("id"), at=Max("updated_at"))
    return f"{trades['n']}:{trades['at']}:{areas['n']}:{areas['at']}"


def _vocabulary():
    """[(trade_id, [(phrase, own)])], [(area_id, name)], rebuilt when either changes."""
    key = "search-vocabulary:" + hashlib.sha1(_stamp().encode()).hexdigest()
    found = cache.get(key)
    if found is None:
        trades = []
        for trade in Trade.objects.filter(is_active=True):
            # (phrase, is the trade's own name): part of a name counts
            # ("mechanics" for "Auto mechanics"), part of a synonym does not,
            # or "phone repair" would match "car repair".
            own = {normalise(trade.name), normalise(trade.slug.replace("-", " "))}
            others = {normalise(word) for word in trade.synonyms or []} - own
            phrases = [(p, True) for p in own if p] + [(p, False) for p in others if p]
            trades.append((trade.pk, sorted(phrases)))
        areas = [(area.pk, normalise(area.name)) for area in Area.objects.all()]
        found = (trades, areas)
        cache.set(key, found, 3600)
    return found


def _close(a, b):
    """Whether two words are the same word, allowing a typo or an ending:
    "weldng" and "welding", "mechanic" and "mechanics", "weld" and "welding"."""
    if a == b:
        return True
    if len(a) >= 4 and (b.startswith(a) or a.startswith(b)) and min(len(a), len(b)) >= 4:
        return True
    return len(a) >= 5 and SequenceMatcher(None, a, b).ratio() >= 0.8


def _phrase_score(tokens, phrase):
    """How much of a trade phrase the tokens cover, and which tokens did it."""
    words = phrase.split()
    used = []
    for word in words:
        hit = next(
            (i for i, token in enumerate(tokens) if i not in used and _close(token, word)), None
        )
        if hit is None:
            # Long names ("electrical installation") still count when the
            # telling word is there ("electrical", "electrician").
            continue
        used.append(hit)
    if not used:
        return 0.0, []
    # Every word of the phrase found beats some of a longer one.
    return len(used) / len(words) + 0.01 * len(used), used


def understand(text):
    query = normalise(text)
    tokens = query.split()
    result = Understood(words=query)
    if not tokens:
        return result
    trades, areas = _vocabulary()
    taken = set()

    # The area first: names are matched whole, so "tema" is never mistaken
    # for part of a trade. Longest name first, so "accra central" beats "accra".
    padded = f" {query} "
    for area_id, name in sorted(areas, key=lambda row: -len(row[1])):
        if name and f" {name} " in padded:
            result.area = Area.objects.select_related("region").get(pk=area_id)
            span = name.split()
            for start in range(len(tokens) - len(span) + 1):
                if tokens[start : start + len(span)] == span:
                    taken.update(range(start, start + len(span)))
                    break
            break

    free = [token if i not in taken else "" for i, token in enumerate(tokens)]
    scored = []
    for trade_id, phrases in trades:
        best, used = 0.0, []
        for phrase, own in phrases:
            score, hits = _phrase_score(free, phrase)
            if not own and len(hits) < len(phrase.split()):
                continue
            if score > best:
                best, used = score, hits
        if best >= 0.5:
            scored.append((best, trade_id, used))
    scored.sort(key=lambda row: -row[0])
    if scored:
        best, trade_id, used = scored[0]
        result.trade = Trade.objects.get(pk=trade_id)
        taken.update(used)
        # Any other word of the same trade ("hair" in "hair braiding") is
        # used up too, rather than left to match workshop names.
        words = {w for phrase, _ in dict(trades)[trade_id] for w in phrase.split()}
        taken.update(
            i for i, token in enumerate(free) if token and any(_close(token, w) for w in words)
        )
        result.also = [trade_id for _, trade_id, _ in scored[1:4]]

    left = [t for i, t in enumerate(tokens) if i not in taken and t not in STOP_WORDS]
    result.words = " ".join(left)
    return result
