"""A "Check name" marker in the back office lists (core/placeholders.py).

Names are checked when they are typed, but a short one (3 or 4 letters,
"Gym") passes and is worth a look, and names typed before the checks may
fail them. Both show here; nothing is stored, it is worked out from the name.
"""

from django.contrib import admin
from django.utils.html import format_html

from .placeholders import is_short_name, name_problem


class NameCheckMixin:
    """Add "name_check" to list_display; `name_check_field` names the field."""

    name_check_field = "name"

    @admin.display(description="Name")
    def name_check(self, obj):
        name = getattr(obj, self.name_check_field, "")
        if name_problem(name):
            label = "Not a name"
        elif is_short_name(name):
            label = "Check name"
        else:
            return ""
        return format_html(
            '<span class="pc-signal pc-signal--attention"><span class="pc-signal-dot" '
            'aria-hidden="true"></span>{}</span>',
            label,
        )
