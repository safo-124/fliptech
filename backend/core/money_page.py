"""The back office's "Money" page: everything paid on the site, in one place.

Four kinds of payment, read from where each already lives:

  marketplace  a buyer paying sellers (Order, one per seller; several of
               them may share one CheckoutPayment)
  courses      a trainee buying an online course (CoursePurchase)
  fees         sellers and workshops paying Fliiptech: boosts, the Shop plan,
               quote leads, verification visits (SellerPayment), course
               boosts (CourseBoost)

and the questions staff need answered: what came in, what Fliiptech kept,
what is held for buyers, what went out to sellers and trainers, what was
refunded, and what needs a look (payments stuck waiting, problems buyers
reported, payout names that do not match an ID, held money due to go).

Read-only. Every number links to the rows it counts.
"""

from datetime import timedelta

from django.conf import settings
from django.db.models import Q, Sum
from django.urls import reverse
from django.utils import timezone

AREAS = ("all", "marketplace", "courses", "fees")
# A payment still "waiting" after this long has probably been abandoned or
# lost on the way back from Paystack: check_payments asks Paystack about it.
STUCK_AFTER = timedelta(hours=1)
STUCK_WITHIN = timedelta(days=2)


def _sum(queryset, field):
    return queryset.aggregate(total=Sum(field))["total"] or 0


def _cedis(pesewas):
    return f"{pesewas / 100:,.2f}"


def summary(area="all", days=7, now=None):
    from accounts.models import PayoutAccount
    from courses.models import CourseBoost, CoursePurchase
    from courses.views import course_commission_pesewas
    from marketplace import payouts
    from marketplace.models import CheckoutPayment, Order, PaymentStatus, SellerPayment

    now = now or timezone.now()
    since = now - timedelta(days=days)
    area = area if area in AREAS else "all"
    show = {name: area in ("all", name) for name in AREAS[1:]}

    came_in = kept = paid_out = refunded = held = count = 0
    rows = []

    if show["marketplace"]:
        paid = Order.objects.filter(status=PaymentStatus.PAID, paid_at__gte=since).exclude(
            plan=Order.Plan.DIRECT
        )
        came_in += _sum(paid, "amount_pesewas")
        count += paid.count()
        # Fliiptech's share of what was paid: a deposit carries only its part.
        for order in paid.only(
            "commission_pesewas", "balance_commission_pesewas", "balance_status"
        ):
            owed = (
                order.balance_commission_pesewas
                if order.balance_status != Order.Balance.PAID
                else 0
            )
            kept += order.commission_pesewas - owed
        held_orders = Order.objects.filter(
            status=PaymentStatus.PAID,
            payout__in=[Order.Payout.HELD, Order.Payout.SENDING, Order.Payout.FAILED],
        ).exclude(stage=Order.Stage.REFUNDED)
        held += sum(o.online_share_pesewas for o in held_orders)
        released = Order.objects.filter(payout=Order.Payout.RELEASED, released_at__gte=since)
        split = paid.filter(payout=Order.Payout.SPLIT).exclude(stage=Order.Stage.REFUNDED)
        paid_out += sum(o.online_share_pesewas for o in released) + sum(
            o.amount_pesewas - (o.commission_pesewas - o.balance_commission_pesewas) for o in split
        )
        refunds = Order.objects.filter(stage=Order.Stage.REFUNDED, updated_at__gte=since)
        refunded += _sum(refunds, "amount_pesewas")
        for order in paid.select_related("seller", "checkout").order_by("-paid_at")[:40]:
            rows.append(
                {
                    "when": order.paid_at,
                    "who": order.buyer_name,
                    "what": f"Order from {order.seller.business_name}"
                    + (" (one payment, several sellers)" if order.checkout_id else ""),
                    "amount": order.amount_pesewas,
                    "kept": order.commission_pesewas,
                    "state": order.get_payout_display()
                    if order.stage != Order.Stage.REFUNDED
                    else "Refunded",
                    "tone": "warn"
                    if order.payout in (Order.Payout.HELD, Order.Payout.FAILED)
                    else "good",
                    "url": reverse("admin:marketplace_order_change", args=[order.pk]),
                }
            )

    if show["courses"]:
        bought = CoursePurchase.objects.filter(status="paid", paid_at__gte=since)
        came_in += _sum(bought, "amount_pesewas")
        count += bought.count()
        for purchase in bought.select_related("provider", "trainee").order_by("-paid_at")[:40]:
            share = course_commission_pesewas(purchase.amount_pesewas)
            kept += share
            paid_out += purchase.amount_pesewas - share
            rows.append(
                {
                    "when": purchase.paid_at,
                    "who": str(purchase.trainee),
                    "what": f"Course: {purchase.provider.name}",
                    "amount": purchase.amount_pesewas,
                    "kept": share,
                    "state": "Paid",
                    "tone": "good",
                    "url": reverse("admin:courses_coursepurchase_change", args=[purchase.pk]),
                }
            )

    if show["fees"]:
        fees = SellerPayment.objects.filter(status=PaymentStatus.PAID, paid_at__gte=since)
        boosts = CourseBoost.objects.filter(status="paid", paid_at__gte=since)
        fee_total = _sum(fees, "amount_pesewas") + _sum(boosts, "amount_pesewas")
        came_in += fee_total
        kept += fee_total
        count += fees.count() + boosts.count()
        for fee in fees.select_related("seller").order_by("-paid_at")[:40]:
            rows.append(
                {
                    "when": fee.paid_at,
                    "who": fee.seller.business_name,
                    "what": fee.get_kind_display(),
                    "amount": fee.amount_pesewas,
                    "kept": fee.amount_pesewas,
                    "state": "Paid",
                    "tone": "good",
                    "url": reverse("admin:marketplace_sellerpayment_change", args=[fee.pk]),
                }
            )
        for boost in boosts.select_related("provider").order_by("-paid_at")[:40]:
            rows.append(
                {
                    "when": boost.paid_at,
                    "who": boost.provider.name,
                    "what": "Course boost",
                    "amount": boost.amount_pesewas,
                    "kept": boost.amount_pesewas,
                    "state": "Paid",
                    "tone": "good",
                    "url": "",
                }
            )

    rows.sort(key=lambda row: row["when"] or now, reverse=True)
    for row in rows:
        row["amount"] = _cedis(row["amount"])
        row["kept"] = _cedis(row["kept"])

    stuck = stuck_payments(now)
    order_admin = reverse("admin:marketplace_order_changelist")
    attention = [
        {
            "label": f"{len(stuck)} payment(s) still waiting after an hour",
            "count": len(stuck),
            "url": order_admin + "?status__exact=pending",
            "action": "Check",
        },
        {
            "label": "Buyers who said something is wrong",
            "count": Order.objects.filter(stage=Order.Stage.PROBLEM).count(),
            "url": order_admin + "?stage__exact=problem",
            "action": "Open",
        },
        {
            "label": "Payout names to check against the ID",
            "count": PayoutAccount.objects.filter(
                name_check__in=[
                    PayoutAccount.NameCheck.DIFFERENT,
                    PayoutAccount.NameCheck.UNKNOWN,
                ],
                staff_cleared_at__isnull=True,
            ).count(),
            "url": reverse("admin:accounts_payoutaccount_changelist")
            + "?staff_cleared_at__isempty=1",
            "action": "Review",
        },
        {
            "label": "Held payments due to be sent",
            "count": payouts.due_for_release(now).count(),
            "url": order_admin + "?payout__exact=held",
            "action": "See",
        },
    ]
    multi = CheckoutPayment.objects.filter(status=PaymentStatus.PAID, paid_at__gte=since).count()
    return {
        "area": area,
        "areas": AREAS,
        "days": days,
        "came_in": _cedis(came_in),
        "count": count,
        "kept": _cedis(kept),
        "held": _cedis(held),
        "paid_out": _cedis(paid_out),
        "refunded": _cedis(refunded),
        "multi_seller_payments": multi,
        "rows": rows[:60],
        "attention": attention,
        "commission": settings.MARKETPLACE_COMMISSION_PERCENT,
        "course_commission": settings.COURSE_COMMISSION_PERCENT,
    }


def stuck_payments(now=None):
    """Payments still waiting an hour after they started (but not ancient):
    [(kind, reference)], for this page and for check_payments."""
    from courses.models import CourseBoost, CoursePurchase
    from marketplace.models import CheckoutPayment, Order, PaymentStatus, SellerPayment

    now = now or timezone.now()
    window = Q(created_at__lte=now - STUCK_AFTER, created_at__gte=now - STUCK_WITHIN)
    found = []
    for kind, model, extra in (
        ("checkout", CheckoutPayment, {}),
        ("order", Order, {"checkout__isnull": True}),
        ("seller_payment", SellerPayment, {}),
        ("course", CoursePurchase, {}),
        ("course_boost", CourseBoost, {}),
    ):
        queryset = model.objects.filter(window, status=PaymentStatus.PENDING, **extra)
        if model is Order:
            queryset = queryset.exclude(plan=Order.Plan.DIRECT)
        found.extend(
            (kind, reference) for reference in queryset.values_list("reference", flat=True)
        )
    return found


def check_stuck(now=None):
    """Ask Paystack about every stuck payment and record its answer, the way
    the webhook would have. Returns how many were checked."""
    from courses import paystack
    from courses.studio import confirm_boost
    from courses.views import confirm as confirm_course
    from marketplace.payments import confirm_reference

    if not paystack.enabled():
        return 0
    checked = 0
    for kind, reference in stuck_payments(now):
        try:
            data = paystack.verify(reference)
        except paystack.PaystackError:
            continue
        if kind == "course":
            confirm_course(reference, data)
        elif kind == "course_boost":
            confirm_boost(reference, data)
        else:
            confirm_reference(reference, data)
        checked += 1
    return checked
