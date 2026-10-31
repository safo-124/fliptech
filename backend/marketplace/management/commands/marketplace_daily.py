"""The marketplace's daily texts: asking buyers for a review, and telling
sellers their Shop plan is about to end.

Run once a day by fliptech-freshness.service, after the freshness prompts.
Each text goes once: the row is stamped when it is sent, so running this
twice in a day (or by hand) sends nothing new.

Review requests go a few days after the question or the payment, long
enough for the handover to have happened, and only for the last month:
nobody remembers a bag they asked about in March. One text per number per
run, however many sellers they asked, so a busy buyer is not sent five.
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.sms import send_sms
from marketplace.models import Order, PaymentStatus, ProductEnquiry, SellerPayment
from marketplace.reviews import token_for

ASK_AFTER_DAYS = 3
ASK_WITHIN_DAYS = 30
REMIND_DAYS_BEFORE = 3


def review_link(token):
    return f"{settings.PUBLIC_SITE_URL.rstrip('/')}/marketplace/review/{token}"


class Command(BaseCommand):
    help = "Text buyers a review link, and remind sellers before their Shop plan ends."

    def handle(self, *args, **options):
        now = timezone.now()
        asked = self.ask_for_reviews(now)
        reminded = self.remind_plans(now)
        self.stdout.write(f"{asked} review request(s), {reminded} plan reminder(s) sent.")

    def ask_for_reviews(self, now):
        window = (now - timedelta(days=ASK_WITHIN_DAYS), now - timedelta(days=ASK_AFTER_DAYS))
        texted = set()
        sent = 0
        # Orders first: somebody who paid has the most to say.
        orders = Order.objects.filter(
            status=PaymentStatus.PAID,
            paid_at__range=window,
            review_requested_at__isnull=True,
        ).select_related("seller")
        enquiries = ProductEnquiry.objects.filter(
            state=ProductEnquiry.State.SENT,
            created_at__range=window,
            review_requested_at__isnull=True,
        ).select_related("seller")
        for thing in [*orders, *enquiries]:
            phone = str(thing.buyer_phone)
            if phone in texted:
                continue
            is_order = isinstance(thing, Order)
            token = token_for(order=thing) if is_order else token_for(enquiry=thing)
            what = "your order of" if is_order else "your question about"
            message = (
                f"{settings.BRAND_NAME}: how was {thing.seller.business_name}? Tell other "
                f"buyers about {what} {thing.product_name}: {review_link(token)}"
            )
            send_sms(phone, message)
            texted.add(phone)
            thing.review_requested_at = now
            thing.save(update_fields=["review_requested_at", "updated_at"])
            sent += 1
        return sent

    def remind_plans(self, now):
        sent = 0
        ending = (
            SellerPayment.objects.plans()
            .filter(
                status=PaymentStatus.PAID,
                ends_at__range=(now, now + timedelta(days=REMIND_DAYS_BEFORE)),
                reminded_at__isnull=True,
            )
            .select_related("seller")
        )
        for plan in ending:
            # Not if they have already paid for the month after.
            if (
                SellerPayment.objects.plans()
                .filter(seller=plan.seller, status=PaymentStatus.PAID, ends_at__gt=plan.ends_at)
                .exists()
            ):
                continue
            send_sms(
                plan.seller.phone,
                f"{settings.BRAND_NAME}: your Shop plan ends on "
                f"{timezone.localtime(plan.ends_at):%d %b}. Keep your extra products on show "
                f"by paying for another month in your seller dashboard: "
                f"{settings.PUBLIC_SITE_URL.rstrip('/')}/sell/shop",
            )
            plan.reminded_at = now
            plan.save(update_fields=["reminded_at", "updated_at"])
            sent += 1
        return sent
