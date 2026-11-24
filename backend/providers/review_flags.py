"""What staff should look at on a listing: shown in the back office, never a
reason to stop the trainer.

* Placeholder text in a public field ("To be changed", "tbc", "xxx"), on the
  listing or one of its courses: new text like it is refused when saved
  (core/placeholders.py), and this finds what went live before that.
* Numbers that do not add up: more apprentices trained a year than one
  master can teach, and hours a week that the schedule written beside them
  cannot hold.

Each flag is a sentence saying what and where, for ProviderAdmin's "Review
flags" box and its filter.
"""

import re

from django.utils import timezone

from core.placeholders import is_placeholder

PROVIDER_FIELDS = (
    ("name", "Workshop name"),
    ("owner_name", "Owner name"),
    ("lead_trainer_name", "Who teaches"),
    ("address", "Address"),
    ("directions", "Directions"),
)
PROGRAMME_FIELDS = (
    ("title", "Course name"),
    ("certificate_awarded", "Certificate"),
    ("extra_costs_note", "What the extras are for"),
    ("instalment_note", "Instalment note"),
    ("weekly_schedule", "Schedule"),
)

# One master, with help, rarely trains more apprentices a year than this.
MAX_APPRENTICES_A_YEAR = 25
# Hours a week no schedule holds: twelve a day, every day.
MAX_HOURS_A_WEEK = 84


def placeholder_flags(provider, programmes):
    flags = [
        f'{label}: "{getattr(provider, field)}" looks like a placeholder.'
        for field, label in PROVIDER_FIELDS
        if is_placeholder(getattr(provider, field, ""))
    ]
    for programme in programmes:
        flags += [
            f'{programme.title or "A course"}, {label.lower()}: "{getattr(programme, field)}" '
            "looks like a placeholder."
            for field, label in PROGRAMME_FIELDS
            if is_placeholder(getattr(programme, field, ""))
        ]
    return flags


def apprentice_flag(provider, today=None):
    """More apprentices a year than one master plausibly trains."""
    if not provider.apprentices_trained or not provider.in_trade_since:
        return None
    years = max(1, (today or timezone.localdate()).year - provider.in_trade_since)
    if provider.apprentices_trained / years <= MAX_APPRENTICES_A_YEAR:
        return None
    return (
        f"Apprentices trained: {provider.apprentices_trained} in {years} "
        f"year{'s' if years != 1 else ''} in the trade is more than "
        f"{MAX_APPRENTICES_A_YEAR} a year."
    )


# --------------------------------------------------------------------------
# Reading "Mon-Fri, 8am to 2pm"

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
# "monthly" is not Monday.
_DAY = r"(mon(?!th)|tue|wed|thu|fri|sat|sun)[a-z]*"
_RANGE = re.compile(rf"\b{_DAY}\s*(?:-|–|—|to|through|till|until)\s*{_DAY}\b")
_ONE_DAY = re.compile(rf"\b{_DAY}\b")
_TIME = r"(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?"
_HOURS = re.compile(rf"{_TIME}\s*(?:-|–|—|to|till|until)\s*{_TIME}")


def _days(text):
    if re.search(r"\b(every ?day|daily|7 days)\b", text):
        return 7
    if re.search(r"\bweekdays?\b", text):
        return 5
    if re.search(r"\bweekends?\b", text):
        return 2
    found = _RANGE.search(text)
    if found:
        start, end = DAYS.index(found.group(1)), DAYS.index(found.group(2))
        return (end - start) % 7 + 1
    named = {match.group(1) for match in _ONE_DAY.finditer(text)}
    return len(named) or None


def _clock(hour, minute, half):
    value = int(hour) % 12 if half else int(hour)
    if half and half.startswith("p"):
        value += 12
    return value + (int(minute) / 60 if minute else 0)


def _daily_hours(text):
    found = _HOURS.search(text)
    if not found:
        return None
    h1, m1, half1, h2, m2, half2 = found.groups()
    start = _clock(
        h1, m1, half1 or (half2 if half2 and int(h1) <= int(h2) and int(h1) != 12 else None)
    )
    end = _clock(h2, m2, half2)
    if end <= start:
        end += 12  # "8 to 2": the afternoon
    hours = end - start
    return hours if 0 < hours <= 16 else None


def schedule_hours(schedule):
    """Hours a week a schedule like "Mon-Fri, 8am to 2pm" holds, or None
    when it cannot be read (no flag is better than a wrong one)."""
    text = str(schedule or "").lower()
    days, daily = _days(text), _daily_hours(text)
    return days * daily if days and daily else None


def hours_flag(programme):
    """Hours a week that the course's own schedule cannot hold."""
    hours = programme.hours_per_week
    if not hours:
        return None
    name = programme.title or "A course"
    if hours > MAX_HOURS_A_WEEK:
        return f"{name}: {hours} hours a week is more than any schedule holds."
    expected = schedule_hours(programme.weekly_schedule)
    if expected is None or abs(hours - expected) <= max(4, 0.3 * expected):
        return None
    return (
        f'{name}: {hours} hours a week, but "{programme.weekly_schedule}" '
        f"is about {expected:g} hours a week."
    )


def flags_for(provider):
    """Every flag on a listing and its courses, in reading order."""
    programmes = list(provider.programmes.all())
    flags = placeholder_flags(provider, programmes)
    apprentice = apprentice_flag(provider)
    if apprentice:
        flags.append(apprentice)
    flags += [flag for flag in (hours_flag(programme) for programme in programmes) if flag]
    return flags
