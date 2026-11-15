"""Where a workshop's pin may be: in Ghana, and near the area it is listed in.

A listing showed "Vaajakatu 5, Accra Central" with its pin in Finland. Nothing
checked the coordinates against the country, or against the area the trainer
chose, so a pin dragged (or typed) anywhere on Earth was published as it was.

Both checks are here so the trainer's form, the API and the back office give
the same answer. The frontend mirrors the box in lib/ghana-bounds.ts.
"""

from django.contrib.gis.geos import Point
from django.utils.translation import gettext_lazy as _

# Ghana's mainland and coastal waters, with a little margin: south of Cape
# Three Points (4.74 N) to the northern border (11.17 N), west of Elubo
# (-3.26) to east of Aflao (1.20).
GHANA_SOUTH, GHANA_NORTH = 4.5, 11.25
GHANA_WEST, GHANA_EAST = -3.35, 1.3

# An area is a neighbourhood or a town: Accra Central, Madina, Tema. A pin
# further than this from the area's centre is in a different place from the
# one the listing names. Generous, because an area's centroid is a rough
# middle and a workshop on its edge is still in it.
MAX_KM_FROM_AREA = 25

OUTSIDE_GHANA = _(
    "That pin is outside Ghana. Move the pin onto your workshop, or use "
    "'Use my location' while you are there."
)


def inside_ghana(latitude: float, longitude: float) -> bool:
    return GHANA_SOUTH <= latitude <= GHANA_NORTH and GHANA_WEST <= longitude <= GHANA_EAST


def km_between(a: Point, b: Point) -> float:
    """Great-circle distance in kilometres between two WGS84 points."""
    from math import asin, cos, radians, sin, sqrt

    lat1, lng1, lat2, lng2 = map(radians, (a.y, a.x, b.y, b.x))
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))


def location_problem(location: Point | None, area=None) -> str | None:
    """Why this pin cannot be a workshop's location, or None if it can."""
    if location is None:
        return None
    if not inside_ghana(location.y, location.x):
        return str(OUTSIDE_GHANA)
    centroid = getattr(area, "centroid", None)
    if centroid is not None and km_between(location, centroid) > MAX_KM_FROM_AREA:
        return str(
            _(
                "That pin is more than %(km)d km from %(area)s. Move the pin onto your "
                "workshop, or choose the area it is really in."
            )
            % {"km": MAX_KM_FROM_AREA, "area": area.name}
        )
    return None
