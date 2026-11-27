"""Contact details typed into a shop chat (marketplace/contact_guard.py)."""

import pytest

from marketplace.contact_guard import contact_in


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("My number is 024 123 4567", "phone"),
        ("0241234567", "phone"),
        ("call +233 24 123 4567", "phone"),
        ("233241234567", "phone"),
        ("O24-123-4567", "phone"),
        ("(055) 123.4567 anytime", "phone"),
        ("zero two four one two three four five six seven", "phone"),
        ("24 123 4567", "phone"),
        ("Accra office 030 221 1234", "phone"),
        ("wa.me/233241234567", "link"),
        ("join https://chat.whatsapp.com/AbCd", "link"),
        ("t.me/amacrafts", "link"),
        ("see instagram.com/amacrafts", "link"),
        ("ama.crafts@gmail.com", "email"),
        ("ama at gmail dot com", "email"),
    ],
)
def test_contact_details_are_caught(text, kind):
    assert contact_in(text) == kind


@pytest.mark.parametrize(
    "text",
    [
        "It is GH₵2,500 with delivery",
        "250 cedis for two",
        "Order FT-2210 is ready",
        "Sizes 38, 40, 42, 44, 46",
        "I need 3 pieces by 12/12/2026",
        "One or two of them",
        "Call me when you are ready to collect",
        "Meet at the shop on Monday",
        "We made 1,000,000 beads in 2025 and 2026",
        "",
    ],
)
def test_ordinary_messages_pass(text):
    assert contact_in(text) is None
