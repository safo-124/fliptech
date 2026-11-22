"""What an ID number has to look like, for each kind of ID a trainer can give.

The box used to take anything that was not empty, so "abc" went to the back
office as a Ghana Card number. These rules check the shape of the number for
the ID type chosen, and write it one way, so the same card typed two ways is
still recognised as the same card (see TrainerAccount: one card, one account).

A number with the right shape is not proof that the card is real or belongs to
the person. NIA has not published how the last digit of a Ghana Card number is
worked out, so it cannot be tested here; staff still compare the number with
the photo of the card.

frontend/src/lib/id-numbers.ts applies the same rules as the person types, so
they hear about a mistake at the box rather than after sending. Change both.
"""

import re

from django.utils.translation import gettext as _

GHANA_CARD = "ghana_card"
PASSPORT = "passport"
VOTER_ID = "voter_id"

# Three letters (GHA for a Ghanaian; a foreign resident's card carries their
# own country's code), nine digits and one last digit.
_GHANA_CARD = re.compile(r"^([A-Z]{3})(\d{9})(\d)$")
# Six to nine letters and digits with at least one digit. A Ghanaian passport
# is one letter and seven digits (G1234567); this also lets a foreign one in.
_PASSPORT = re.compile(r"^(?=.*\d)[A-Z0-9]{6,9}$")
# The ten digits on the Electoral Commission's current card.
_VOTER_ID = re.compile(r"^\d{10}$")

_SEPARATORS = re.compile(r"[\s\-_./–—]+")


def tidy_id_number(document_type, raw):
    """The number written the way it is stored, as far as it can be.

    Small letters, spaces and dashes are forgiven: "gha 123456789 0" becomes
    "GHA-123456789-0". A number that does not fit its type comes back with only
    the spaces trimmed, for id_number_problem to explain.
    """
    value = (raw or "").strip()
    if not value:
        return ""
    packed = _SEPARATORS.sub("", value).upper()

    if document_type == GHANA_CARD:
        # Ten digits on their own: the person left off the letters, which on a
        # Ghanaian's card are GHA.
        if re.fullmatch(r"\d{10}", packed):
            packed = f"GHA{packed}"
        match = _GHANA_CARD.match(packed)
        if match:
            return f"{match[1]}-{match[2]}-{match[3]}"
        return value
    if document_type == PASSPORT:
        return packed if _PASSPORT.match(packed) else value
    if document_type == VOTER_ID:
        return packed if _VOTER_ID.match(packed) else value
    return value


def _looks_made_up(digits):
    """All one digit, or counting up or down: an example, not someone's card."""
    return len(set(digits)) == 1 or digits in "01234567890" or digits in "9876543210"


def id_number_problem(document_type, number):
    """What is wrong with `number` for this ID type, in words, or None.

    Expects the tidied number. An empty number is not a problem here: whether
    one is needed yet is the submission checklist's question.
    """
    if not number:
        return None
    if not document_type:
        return _("Choose the ID type first.")

    if document_type == GHANA_CARD:
        match = re.fullmatch(r"([A-Z]{3})-(\d{9})-(\d)", number)
        if not match:
            return _("Enter the number as it is on your card, like GHA-123456789-0.")
        if _looks_made_up(match[2]):
            return _("Check the number. It looks like an example, not the one on your card.")
        return None
    if document_type == PASSPORT:
        if not _PASSPORT.match(number):
            return _("Enter your passport number, like G1234567.")
        return None
    if document_type == VOTER_ID:
        if not _VOTER_ID.match(number):
            return _("Enter the 10 digits on your voter ID card.")
        if _looks_made_up(number):
            return _("Check the number. It looks like an example, not the one on your card.")
        return None
    return None
