"""Asking buyers to review a seller, and what the reviews add up to.

A review can only be left through a link texted to somebody who asked about
a product through the site (their phone was verified) or paid on it. The
link carries a signed token naming the enquiry or order, so it cannot be
made up, and each enquiry or order takes one review.
"""

from django.core import signing
from django.db.models import Avg, Count

from .models import SellerReview

SALT = "marketplace-review"
# Long enough for somebody who opens the text a fortnight later.
MAX_AGE_SECONDS = 60 * 24 * 3600


def token_for(*, enquiry=None, order=None):
    if enquiry is not None:
        return signing.dumps({"e": enquiry.pk}, salt=SALT, compress=True)
    return signing.dumps({"o": order.pk}, salt=SALT, compress=True)


def read_token(token):
    """("enquiry"|"order", pk), or None for a bad or expired token."""
    try:
        data = signing.loads(token, salt=SALT, max_age=MAX_AGE_SECONDS)
    except signing.BadSignature:
        return None
    if "e" in data:
        return "enquiry", int(data["e"])
    if "o" in data:
        return "order", int(data["o"])
    return None


def rating_for(seller):
    """{"average": 4.5, "count": 12}, or None with no reviews yet."""
    row = SellerReview.objects.filter(
        seller=seller, visibility=SellerReview.Visibility.SHOWN
    ).aggregate(average=Avg("rating"), count=Count("pk"))
    if not row["count"]:
        return None
    return {"average": round(float(row["average"]), 1), "count": row["count"]}


def ratings_for(seller_ids):
    """rating_for, for many sellers in one query: {seller_id: {...}}."""
    rows = (
        SellerReview.objects.filter(
            seller_id__in=set(seller_ids), visibility=SellerReview.Visibility.SHOWN
        )
        .values("seller_id")
        .annotate(average=Avg("rating"), count=Count("pk"))
    )
    return {
        row["seller_id"]: {"average": round(float(row["average"]), 1), "count": row["count"]}
        for row in rows
    }
