"""Words that hold a place instead of saying something.

A listing went live with its certificate named "To be changed". A trainee
reads that as the certificate, so text like it is refused in public fields
(providers/trainer_serializers.py) and flagged to staff on listings that
already have it (providers/review_flags.py).

Only a whole field counts: "Test welding" is a course name, "test" is not.
And a role is not a name: "Owner" typed into a name box is shown as nobody's
name (providers/serializers.py, the teacher's name).
"""

import re

# Compared after lowercasing and turning anything that is not a letter or a
# digit into one space, so "TBC.", "t.b.c" and "N/A" are caught too.
PLACEHOLDERS = {
    "to be changed",
    "to be confirmed",
    "to be decided",
    "to be determined",
    "to be updated",
    "to be added",
    "to be announced",
    "will update",
    "will be updated",
    "update later",
    "change later",
    "change this",
    "change me",
    "edit me",
    "fill later",
    "coming soon",
    "tbc",
    "t b c",
    "tbd",
    "t b d",
    "tba",
    "test",
    "testing",
    "test test",
    "n a",
    "na",
    "none",
    "nil",
    "null",
    "placeholder",
    "sample",
    "dummy",
    "asdf",
    "qwerty",
}

# What a name box sometimes gets instead of a name.
ROLE_LABELS = {
    "owner",
    "the owner",
    "manager",
    "the manager",
    "lead trainer",
    "trainer",
    "the trainer",
    "proprietor",
    "proprietress",
    "ceo",
    "boss",
    "master",
    "madam",
}

_NOT_WORD = re.compile(r"[^0-9a-z]+")


def _normal(text):
    return _NOT_WORD.sub(" ", str(text or "").lower()).strip()


def is_placeholder(text):
    """Whether a whole field is a stand-in ("tbc", "xxx", "n/a", "...")."""
    raw = str(text or "").strip()
    if not raw:
        return False
    words = _normal(raw)
    if not words:
        # Only punctuation: "-", "...", "?".
        return True
    if words in PLACEHOLDERS or words.startswith("lorem ipsum"):
        return True
    # "xxx", "x x x", "XXXX".
    return len(words.replace(" ", "")) >= 2 and set(words.replace(" ", "")) == {"x"}


def is_role_label(text):
    """Whether a name box holds a role ("Owner") rather than a name."""
    return _normal(text) in ROLE_LABELS


def real_name(text):
    """The name, or "" when it is a stand-in or a role."""
    name = str(text or "").strip()
    return "" if not name or is_placeholder(name) or is_role_label(name) else name


def placeholder_error(text):
    """The message for a field holding a stand-in, in the words a trainer sees."""
    from django.utils.translation import gettext as _

    return _(
        '"%(text)s" looks like a placeholder. Write the real thing, or leave it empty if you '
        "do not know yet."
    ) % {"text": str(text).strip()[:40]}


# Words people type to get past a name box: answers, greetings, the label
# itself. A real name is never just one of these.
FILLER_NAMES = {
    "yes",
    "no",
    "ok",
    "okay",
    "hi",
    "hello",
    "name",
    "my name",
    "your name",
    "full name",
    "nothing",
    "no name",
    "abc",
    "abcd",
    "aaa",
    "xyz",
    "me",
    "myself",
    "user",
    "admin",
    "unknown",
    "anonymous",
    "nobody",
    "someone",
    "person",
    "shop",
    "my shop",
    "workshop",
    "my workshop",
    "business",
    "my business",
    "company",
}

# Names this short pass, but staff are shown them to check ("Gym" is fine,
# "Ama" is fine, "Jjj" is not).
SHORT_NAME_LETTERS = 4


def _letters(text):
    return sum(1 for ch in str(text or "") if ch.isalpha())


def name_problem(text):
    """Why a name (a person's, a workshop's, a shop's) is not one, or None.
    Empty is not checked here: whether a name is required is the form's call."""
    from django.utils.translation import gettext as _

    raw = str(text or "").strip()
    if not raw:
        return None
    if _letters(raw) < 3:
        return _("A name needs at least 3 letters.")
    words = _normal(raw)
    if words in FILLER_NAMES or is_placeholder(raw):
        return _('"%(text)s" is not a name. Write the real name.') % {"text": raw[:40]}
    if len(set(words.replace(" ", ""))) == 1:  # "aaaa", "zzz"
        return _('"%(text)s" is not a name. Write the real name.') % {"text": raw[:40]}
    return None


def is_short_name(text):
    """A name that passes but is short enough for staff to look at."""
    raw = str(text or "").strip()
    return bool(raw) and _letters(raw) <= SHORT_NAME_LETTERS


def landmark_problem(text):
    """A landmark someone can find: at least two words ("Madina Mall"), not "mall"."""
    from django.utils.translation import gettext as _

    raw = str(text or "").strip()
    if not raw:
        return None
    words = [word for word in re.split(r"\s+", raw) if any(ch.isalpha() for ch in word)]
    if len(words) < 2:
        return _('Name the landmark in at least two words, for example "Opposite Madina Mall".')
    return None
