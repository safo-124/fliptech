"""Reading the ID number and name from a photo of a trainer's ID.

A trainer photographs their card on the first step of sign-up and the boxes
fill themselves; what could not be read, they type or retake. Reading happens
here, on our own server, with Tesseract (the free reading program), so a photo
of someone's ID is never sent to another company. It is installed once on the
server:

    sudo apt install -y tesseract-ocr

Without it nothing breaks. The photo is still stored for staff, the reading
comes back "unavailable", and the person types the details as before.

What is read is a help for the person filling the form and nothing more. A
fake card reads as well as a real one, and a phone photo of a card with glare
on it reads badly, so the person always sees what was read and can change it,
and staff still compare the photo with what was typed.
"""

import logging
import re
import shutil
import subprocess
import unicodedata
from dataclasses import dataclass
from io import BytesIO

from django.conf import settings

from .id_numbers import GHANA_CARD, PASSPORT, VOTER_ID, id_number_problem, tidy_id_number

logger = logging.getLogger(__name__)

READ = "read"
UNREADABLE = "unreadable"
UNAVAILABLE = "unavailable"

# A reading that takes longer than this is not one a person is waiting for.
TESSERACT_TIMEOUT_SECONDS = 15
# Tesseract reads printed text best at around 300 dots per inch. A card is
# 86 mm wide, so about 1,000 pixels across the card; the photo usually has
# some table around it, hence a little more.
WORKING_WIDTH = 1800


@dataclass(frozen=True)
class CardReading:
    status: str
    number: str = ""
    name: str = ""


def tesseract_command():
    """The reading program's path, or None when it is not installed."""
    return shutil.which(getattr(settings, "TESSERACT_CMD", "") or "tesseract")


def read_card(upload, document_type):
    """What can be read from the photo `upload` of an ID of `document_type`.

    Leaves `upload` at its start, so it can still be stored afterwards.
    """
    command = tesseract_command()
    if command is None:
        return CardReading(UNAVAILABLE)
    try:
        image = _prepared(upload)
    except Exception:  # noqa: BLE001 - anything Pillow cannot open is "unreadable"
        logger.info("ID photo could not be opened for reading", exc_info=True)
        return CardReading(UNREADABLE)
    finally:
        upload.seek(0)

    number = name = ""
    # A block of text first, then scattered text, which suits a card whose
    # words sit in boxes around a portrait. Two tries at most: the person is
    # waiting.
    for page_mode in ("6", "11"):
        text = _ocr(command, image, page_mode)
        if text is None:
            if page_mode == "6":
                return CardReading(UNAVAILABLE)
            break
        found_number, found_name = parse_card_text(text, document_type)
        number = number or found_number
        name = name or found_name
        if number and name:
            break
    return CardReading(READ if number or name else UNREADABLE, number, name)


def _prepared(upload):
    """The photo as Tesseract reads it best: upright, grey, large, high contrast."""
    from PIL import Image, ImageOps

    upload.seek(0)
    with Image.open(upload) as original:
        image = ImageOps.exif_transpose(original).convert("L")
    if image.width != WORKING_WIDTH:
        height = round(image.height * WORKING_WIDTH / image.width)
        image = image.resize((WORKING_WIDTH, height), Image.Resampling.LANCZOS)
    image = ImageOps.autocontrast(image, cutoff=1)
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _ocr(command, png, page_mode):
    try:
        done = subprocess.run(  # noqa: S603 - fixed arguments, no shell
            [command, "stdin", "stdout", "-l", "eng", "--psm", page_mode],
            input=png,
            capture_output=True,
            timeout=TESSERACT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("Tesseract did not finish reading an ID photo", exc_info=True)
        return None
    if done.returncode != 0:
        logger.warning("Tesseract failed on an ID photo: %s", done.stderr[:300])
        return None
    return done.stdout.decode("utf-8", errors="replace")


# --- Making sense of the text --------------------------------------------
#
# Kept apart from the reading so it can be tested with text alone.

# Letters a reader gives for a digit in a run of digits.
_AS_DIGIT = str.maketrans(
    {
        "O": "0",
        "Q": "0",
        "D": "0",
        "U": "0",
        "I": "1",
        "L": "1",
        "|": "1",
        "!": "1",
        "Z": "2",
        "S": "5",
        "B": "8",
        "G": "6",
        "T": "7",
    }
)
_DIGITISH = "0-9OQDUILZSBGT|!"
_DASH = r"\s*[-–—_.~=]?\s*"

_GHANA_NUMBER = re.compile(
    rf"(?<![A-Z0-9])([A-Z6]{{3}}){_DASH}([{_DIGITISH}]{{9}}){_DASH}([{_DIGITISH}])(?![0-9])"
)
_VOTER_NUMBER = re.compile(rf"(?<![A-Z0-9])([{_DIGITISH}]{{10}})(?![A-Z0-9])")
_GHANA_PASSPORT = re.compile(r"(?<![A-Z0-9])([A-Z][0-9]{7})(?![A-Z0-9])")


def parse_card_text(text, document_type):
    """(number, name) found in the text read from a card, either "" if not found."""
    upper = text.upper()
    if document_type == PASSPORT:
        number, name = _from_mrz(upper)
        if not number:
            # The number printed on the page, not the one in the machine
            # lines: one there that failed its check digit was misread.
            printed = "\n".join(line for line in upper.splitlines() if "<" not in line)
            number = _first_valid(PASSPORT, (m[1] for m in _GHANA_PASSPORT.finditer(printed)))
        return number, name or _name_from_labels(upper)
    if document_type == GHANA_CARD:
        return _ghana_card_number(upper), _name_from_labels(upper)
    if document_type == VOTER_ID:
        candidates = (
            m[1].translate(_AS_DIGIT)
            for m in _VOTER_NUMBER.finditer(upper)
            if _mostly_digits(m[1], 8)
        )
        return _first_valid(VOTER_ID, candidates), _name_from_labels(upper)
    return "", ""


def _mostly_digits(value, at_least):
    return sum(ch.isdigit() for ch in value) >= at_least


def _first_valid(document_type, candidates):
    for candidate in candidates:
        number = tidy_id_number(document_type, candidate)
        if id_number_problem(document_type, number) is None:
            return number
    return ""


def _ghana_card_number(upper):
    found = []
    for match in _GHANA_NUMBER.finditer(upper):
        letters, middle, last = match.groups()
        if not _mostly_digits(middle, 6):
            continue
        letters = letters.replace("6", "G")
        found.append(f"{letters}{middle.translate(_AS_DIGIT)}{last.translate(_AS_DIGIT)}")
    # A Ghanaian's card first: a three-letter word misread before a number
    # elsewhere on the card should not win over the real one.
    found.sort(key=lambda number: not number.startswith("GHA"))
    return _first_valid(GHANA_CARD, found)


# --- Passports: the two machine-readable lines ----------------------------


def _check_digit(value):
    """ICAO 9303: weights 7, 3, 1; letters count from 10; the filler is 0."""
    total = 0
    for index, ch in enumerate(value):
        if ch.isdigit():
            worth = int(ch)
        elif "A" <= ch <= "Z":
            worth = ord(ch) - 55
        else:
            worth = 0
        total += worth * (7, 3, 1)[index % 3]
    return str(total % 10)


def _from_mrz(upper):
    lines = [re.sub(r"\s+", "", line).replace("«", "<") for line in upper.splitlines()]
    lines = [line for line in lines if line.count("<") >= 3 and len(line) >= 30]
    number = name = ""
    for line in lines:
        if line.startswith("P") and "<<" in line[5:] and not name:
            surname, _sep, given = line[5:].partition("<<")
            # The filler after the names is often read as K or C: stop at it.
            given = given.split("<<")[0]
            surname = _letters_only(surname.replace("<", " "))
            given = _letters_only(given.replace("<", " "))
            if surname and given:
                name = _person_name(given, surname)
        elif not number and re.match(r"[A-Z0-9<]{9}[0-9O]", line):
            field, check = line[:9], line[9].replace("O", "0")
            for candidate in (field, field.replace("O", "0")):
                if _check_digit(candidate) == check:
                    number = _first_valid(PASSPORT, [candidate.replace("<", "")])
                    break
    return number, name


# --- Names, from the labels printed beside them ----------------------------

_SURNAME_LABEL = re.compile(r"\bSURNAME\b|\bNOM\b|\bLAST\s*NAME\b|\bFAMILY\s*NAME\b")
_GIVEN_LABEL = re.compile(
    r"\bFIRST\s*NAMES?\b|\bGIVEN\s*NAMES?\b|\bOTHER\s*NAMES?\b|\bFORENAMES?\b|\bPR[EÉ]NOMS?\b"
)
# Words that mean a line is a label or a heading, not someone's name.
_NOT_A_NAME = re.compile(
    r"PREVIOUS|PR[EÉ]C[EÉ]DENT|NATIONALIT|\bSEX|DATE|BIRTH|NAISSANCE|PERSONAL|NUMBER|NUM[EÉ]RO"
    r"|HEIGHT|TAILLE|DOCUMENT|\bISSU(?:E|ED|ING|ANCE)\b|D[EÉ]LIVRANCE|EXPIR|SIGNATURE|REPUBLIC|R[EÉ]PUBLIQUE|GHANA|ECOWAS"
    r"|IDENTITY|CARD|CARTE|PLACE|POLLING|STATION|VOTER|ELECTORAL|COMMISSION|PASSPORT|\bTYPE\b"
    r"|SURNAME|\bNOM\b|NAMES?\b|PR[EÉ]NOM"
)


def _letters_only(value):
    return " ".join(re.findall(r"[A-Z][A-Z'\-]*[A-Z]|[A-Z]", value)).strip()


def _name_like(line):
    """The name on a line, if the line is a name and nothing else."""
    if not line or re.search(r"\d", line) or _NOT_A_NAME.search(line):
        return ""
    letters = sum(ch.isalpha() for ch in line)
    if letters < 2 or letters < 0.7 * len(line.replace(" ", "")):
        return ""
    return _letters_only(line)


def _value_after(lines, index, label):
    """The value of the label on line `index`: on the same line, or just below."""
    rest = label.sub(" ", lines[index])
    rest = re.sub(r"[/:|]", " ", rest).strip()
    if rest and (value := _name_like(rest)):
        return value
    for following in lines[index + 1 : index + 3]:
        if value := _name_like(following):
            return value
        if _SURNAME_LABEL.search(following) or _GIVEN_LABEL.search(following):
            break
    return ""


def _name_from_labels(upper):
    lines = [line.strip() for line in upper.splitlines() if line.strip()]
    surname = given = ""
    for index, line in enumerate(lines):
        if "PREVIOUS" in line or "PRÉCÉDENT" in line or "PRECEDENT" in line:
            continue
        if not given and _GIVEN_LABEL.search(line):
            given = _value_after(lines, index, _GIVEN_LABEL)
        elif not surname and _SURNAME_LABEL.search(line):
            surname = _value_after(lines, index, _SURNAME_LABEL)
    # Half a name fills the box wrongly, so it fills nothing.
    return _person_name(given, surname) if surname and given else ""


def _person_name(given, surname):
    """'KWAME ATO', 'MENSAH' -> 'Kwame Ato Mensah', the way the form asks for it."""

    def word(value):
        return "-".join(part.capitalize() for part in value.split("-"))

    return " ".join(word(w) for w in f"{given} {surname}".split())


# --- Does the typed name match the card? ----------------------------------


def _name_tokens(value):
    folded = unicodedata.normalize("NFKD", value or "")
    plain = "".join(ch for ch in folded if not unicodedata.combining(ch)).casefold()
    return [token for token in re.split(r"[^a-z]+", plain) if len(token) >= 2]


def _edit_distance(a, b):
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def _close(a, b):
    """The same name, allowing one letter out in a long one: the reader's slip."""
    if a == b:
        return True
    if min(len(a), len(b)) < 5 or abs(len(a) - len(b)) > 1:
        return False
    return _edit_distance(a, b) <= 1


def names_match(typed, on_card):
    """True if the typed name is the name on the card, False if not, None if unknown.

    Order, capitals and accents do not matter, and a middle name may be left
    out: "Kwame Mensah" matches "MENSAH KWAME ATO". One name alone does not
    match a card with several, because "Kwame" is half the country.
    """
    typed_tokens, card_tokens = _name_tokens(typed), _name_tokens(on_card)
    if not typed_tokens or not card_tokens:
        return None
    every_typed_on_card = all(
        any(_close(token, card) for card in card_tokens) for token in typed_tokens
    )
    return every_typed_on_card and (len(typed_tokens) >= 2 or len(card_tokens) == 1)
