"""Contact details typed into a shop chat, caught before they are sent.

Numbers stay private in shop chats (chat.NumbersPrivate), so that a sale stays
on the site, where Buy now holds the buyer's money until the goods arrive.
The "Share my number" button is off there; this catches what people type
instead:

* a Ghana phone number in its usual shapes: 024 123 4567, 0241234567,
  +233 24 123 4567, with dots, dashes or brackets between the digits, with
  the letter O for a zero, or in words ("zero two four ...");
* a WhatsApp or Telegram link, or a link to a social profile;
* an email address, "ama@gmail.com" or "ama at gmail dot com".

Prices, quantities, sizes, dates and order numbers are left alone: only a run
of digits that is exactly a phone number's length and starts like a Ghana
number (02x, 03x, 05x, after 0 or 233) counts. A determined person can still
spell a number out in ways this misses; it stops the casual attempts, which
are most of them.
"""

import re

_WORDS = {
    "zero": "0",
    "oh": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
}
_WORD = re.compile(r"\b(" + "|".join(_WORDS) + r")\b")
# A letter O written for a zero, beside a digit.
_LETTER_O = re.compile(r"(?<=\d)o|o(?=\d)")
# What people put between the digits of a number they type.
_BETWEEN = re.compile(r"(?<=\d)[\s.\-_/()*,+|]{1,3}(?=\d)")
_RUN = re.compile(r"\d+")

# The second and third digits of a Ghana number: the mobile networks and the
# landline areas.
_PREFIXES = {"20", "23", "24", "25", "26", "27", "28", "50", "53", "54", "55", "56", "57", "59"} | {
    f"3{n}" for n in range(10)
}

_LINK = re.compile(
    r"wa\.me|whatsapp\.com|t\.me/|telegram\.(?:me|org)|instagram\.com|instagr\.am"
    r"|facebook\.com|fb\.me|fb\.com|m\.me/|tiktok\.com|snapchat\.com|twitter\.com|\bx\.com/",
    re.IGNORECASE,
)
_EMAIL = re.compile(
    r"[\w.+-]+\s*(?:@|\(at\)|\[at\]|\s+at\s+)\s*[\w-]+\s*(?:\.|\(dot\)|\[dot\]|\s+dot\s+)\s*"
    r"(?:com|net|org|gh|co|io|edu)\b",
    re.IGNORECASE,
)


def _is_phone(run):
    """A run of digits that is exactly a Ghana phone number."""
    if len(run) == 12 and run.startswith("233"):
        rest = run[3:]
    elif len(run) == 10 and run.startswith("0"):
        rest = run[1:]
    elif len(run) == 9:
        rest = run
    else:
        return False
    return rest[:2] in _PREFIXES


def phone_in(text):
    """True if the text holds a Ghana phone number, however it is typed."""
    plain = _WORD.sub(lambda match: _WORDS[match.group(1)], text.lower())
    plain = _LETTER_O.sub("0", plain)
    plain = _BETWEEN.sub("", plain)
    return any(_is_phone(run) for run in _RUN.findall(plain))


def contact_in(text):
    """What kind of contact detail the text holds: "phone", "link" or
    "email", or None."""
    if not text:
        return None
    if _LINK.search(text):
        return "link"
    if _EMAIL.search(text):
        return "email"
    if phone_in(text):
        return "phone"
    return None
