"""Paid promotion: where boosted products show, and what may be boosted.

A boost (SellerPayment, a week or a month) buys a product a sponsored spot,
always labelled "Sponsored":

* the home page's marketplace row, on the website and in the app: up to
  HOME_SLOTS of its four places, picked at random from every product with a
  boost running, so each paying seller gets seen (`sponsored`);
* the marketplace list, in its default order: at most one sponsored item in
  every SLOT_EVERY, so the list never becomes all ads (`slotted_page`). Which
  boosted items fill the spots rotates every hour, the same for every page of
  the list so nothing is shown twice or skipped while someone pages through.

What may be boosted: a product on show, with a photo, that can be bought
(`boost_problem`). A boost on a product with no picture is money wasted.
What the seller gets back: the views the product had while boosted
(`boost_views`), on their growth page.
"""

import random

from django.db.models import Exists, OuterRef, Sum
from django.utils import timezone
from django.utils.translation import gettext as _

from .models import Product, ProductPhoto, ProductViewDay

SLOT_EVERY = 8
HOME_SLOTS = 2


def _showable(products):
    """Boosted products worth a sponsored spot: with a photo, not sold out."""
    return (
        products.filter(boosted=True)
        .filter(Exists(ProductPhoto.objects.filter(product=OuterRef("pk"))))
        .exclude(availability=Product.Availability.SOLD_OUT)
    )


def sponsored(products, limit=HOME_SLOTS, showable=None):
    """Up to `limit` sponsored products, picked at random from those boosted.

    `showable` narrows a queryset to the items worth a sponsored spot; the
    products' rule by default. Courses pass their own (courses/promotion.py).
    """
    pool = list((showable or _showable)(products).values_list("pk", flat=True))
    chosen = random.sample(pool, min(limit, len(pool)))
    found = {product.pk: product for product in products.filter(pk__in=chosen)}
    return [found[pk] for pk in chosen if pk in found]


def _hour_seed():
    return timezone.localtime().strftime("%Y%m%d%H")


def slotted_page(products, page, page_size, showable=None):
    """One page of the marketplace list with sponsored items in their spots.

    Returns (items, count). Spots are the first item and every SLOT_EVERY
    after it on the first page; the boosted items chosen for them are left
    out of the rest of the list, on every page, so nothing shows twice.
    `showable` as for `sponsored`: the course list uses this too.
    """
    spots = list(range(0, page_size, SLOT_EVERY))
    pool = list((showable or _showable)(products).values_list("pk", flat=True))
    random.Random(_hour_seed()).shuffle(pool)
    chosen_ids = pool[: len(spots)]
    rest = products.exclude(pk__in=chosen_ids)
    count = rest.count() + len(chosen_ids)
    if page > 1:
        start = page_size * (page - 1) - len(chosen_ids)
        return list(rest[start : start + page_size]), count
    found = {product.pk: product for product in products.filter(pk__in=chosen_ids)}
    chosen = [found[pk] for pk in chosen_ids if pk in found]
    natural = iter(rest[: page_size - len(chosen)])
    items = []
    for position in range(page_size):
        if position in spots[: len(chosen)]:
            items.append(chosen[spots.index(position)])
            continue
        item = next(natural, None)
        if item is None:
            break
        items.append(item)
    # Fewer ordinary items than spots: the rest of the chosen still show.
    items += [item for item in chosen if item not in items]
    return items, count


def boost_problem(product):
    """Why a product may not be boosted, in the seller's words, or None."""
    if not product.photos.exists():
        return _("Add a photo first. A boosted product without one is easy to pass by.")
    if product.availability == Product.Availability.SOLD_OUT:
        return _("This is marked sold out. Boost something buyers can get.")
    return None


def boost_views(boost):
    """How many times the product was looked at while this boost ran."""
    if boost.product_id is None or boost.starts_at is None:
        return 0
    now = timezone.now()
    end = min(boost.ends_at or now, now)
    first, last = timezone.localdate(boost.starts_at), timezone.localdate(end)
    return (
        ProductViewDay.objects.filter(
            product_id=boost.product_id, day__gte=first, day__lte=max(first, last)
        ).aggregate(total=Sum("views"))["total"]
        or 0
    )
