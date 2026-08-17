"""Money in JSON.

DRF's JSON encoder turns a Decimal into a float, which is the wrong
representation for currency: 1200.10 does not survive a float round trip
exactly, and these figures end up in a provider's subscription statement and in
the fee paragraph on a public page.

Serializer DecimalFields already emit strings because COERCE_DECIMAL_TO_STRING
defaults to True. Endpoints that build a plain dict from an aggregate bypass
that, so they call this instead.
"""

from decimal import Decimal


def money(value):
    """Render a Decimal as a fixed two-place string, or None."""
    if value is None:
        return None
    return str(Decimal(value).quantize(Decimal("0.01")))
