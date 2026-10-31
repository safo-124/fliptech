"""Asking buyers to review a seller, and what the reviews add up to.

A review can only be left through a link texted to somebody who asked about
a product through the site (their phone was verified) or paid on it. The
link carries a signed token naming the enquiry or order, so it cannot be
made up, and each enquiry or order takes one review.
"""

from datetime import timedelta

from django.core import signing
from django.db.models import Avg, Count
from django.utils import timezone

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


# How the "usually replies within a day" badge is earned: of the seller's
# last few questions (old enough to have been answerable), most were marked
# replied within a day. Few questions, no badge: three is not a habit.
REPLY_WINDOW = timedelta(hours=24)
REPLY_SAMPLE = 10
REPLY_MIN = 3
REPLY_SHARE = 0.8


def fast_repliers(seller_ids, now=None):
    """The ids, among these, of sellers who usually reply within a day."""
    from .models import ProductEnquiry

    now = now or timezone.now()
    rows = (
        ProductEnquiry.objects.filter(
            seller_id__in=set(seller_ids),
            state=ProductEnquiry.State.SENT,
            created_at__gte=now - timedelta(days=90),
        )
        .order_by("seller_id", "-created_at")
        .values_list("seller_id", "created_at", "replied_at")
    )
    by_seller = {}
    for seller_id, asked, replied in rows:
        # A question younger than a day that is not answered yet does not
        # count against anyone.
        if replied is None and now - asked < REPLY_WINDOW:
            continue
        sample = by_seller.setdefault(seller_id, [])
        if len(sample) < REPLY_SAMPLE:
            sample.append(replied is not None and replied - asked <= REPLY_WINDOW)
    return {
        seller_id
        for seller_id, sample in by_seller.items()
        if len(sample) >= REPLY_MIN and sum(sample) / len(sample) >= REPLY_SHARE
    }
