"""WhatsApp messages staff send to sellers from the back office.

The same arrangement as providers/owner_messages.py, and for the same
reason: a business-initiated WhatsApp message needs Cloud API credentials
nobody has yet, so the system queues the message and an officer sends it from
their own phone with a wa.me link. When a real sender exists it replaces the
Send button and nothing else.

Two messages go to sellers: "someone asked about your product", and
"someone paid for your product".
"""

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from enquiries.whatsapp import chat_url

from .models import PaymentStatus, ProductEnquiry, SellerNotice


def queue_enquiry_alert(enquiry):
    """Queue the alert for an enquiry that has just been sent.

    Called in the same transaction as the enquiry. One per enquiry: the
    constraint on SellerNotice holds that even against a retried request.
    """
    notice, _created = SellerNotice.objects.get_or_create(
        enquiry=enquiry,
        defaults={"seller": enquiry.seller, "kind": SellerNotice.Kind.NEW_ENQUIRY},
    )
    return notice


def queue_order_alert(order):
    """Queue "someone paid" for an order Paystack has just confirmed.

    Called from the confirmation, which can run twice (the buyer's browser
    and the webhook); the constraint keeps it to one alert.
    """
    notice, _created = SellerNotice.objects.get_or_create(
        order=order,
        defaults={"seller": order.seller, "kind": SellerNotice.Kind.NEW_ORDER},
    )
    return notice


def alerts_waiting():
    """Unsent alerts a seller can still act on, oldest first.

    Oldest first because this is a queue where an hour matters: somebody
    asking about a bag will ask the next maker if nobody answers.

    Not for an enquiry since marked as spam, and not for a seller who is no
    longer selling — asking an officer to message somebody whose shop is
    switched off wastes the officer's time and confuses the seller.
    """
    from .models import SellerAccount

    return (
        SellerNotice.objects.filter(
            Q(kind=SellerNotice.Kind.NEW_ENQUIRY, enquiry__state=ProductEnquiry.State.SENT)
            | Q(kind=SellerNotice.Kind.NEW_ORDER, order__status=PaymentStatus.PAID),
            sent_at__isnull=True,
            seller__is_active=True,
            seller__approval_status=SellerAccount.Approval.CONFIRMED,
        )
        .select_related("seller", "seller__area", "enquiry", "enquiry__product", "order")
        .order_by("created_at", "pk")
    )


def seller_to_buyer(enquiry):
    """The reply, as the seller would open it.

    It opens with who is writing and what it is about, because the buyer
    asked several makers and a bare "hello" from an unknown number tells them
    nothing.
    """
    greeting = f"Hello {enquiry.buyer_name}, " if enquiry.buyer_name else "Hello, "
    return chat_url(
        enquiry.buyer_phone,
        f"{greeting}this is {enquiry.seller.business_name}, replying about "
        f"{enquiry.product_name} on {settings.BRAND_NAME} Skills Hub. "
        f"Your reference is {enquiry.reference_code}.",
    )


def alert_text(enquiry):
    """What the officer sends the seller.

    It carries the buyer's number, because the seller is the one who has to
    reply and making them come back to a dashboard to find it is how a reply
    does not happen.
    """
    asked = f'"{enquiry.message}"' if enquiry.message else "no message"
    return (
        f"Hello, someone asked about {enquiry.product_name} on "
        f"{settings.BRAND_NAME} Skills Hub. "
        f"Reference {enquiry.reference_code}. "
        f"They said: {asked}. "
        f"Reply to them on {enquiry.buyer_phone}."
    )


def order_text(order):
    """What the officer sends the seller when a buyer has paid.

    Says the money is paid, so the seller does not ask for it again, and
    how the buyer wants it handed over.
    """
    how = (
        f"Deliver to: {order.note}"
        if order.fulfilment == order.Fulfilment.DELIVERY
        else "They will collect it from you."
    )
    return (
        f"Hello, {order.buyer_name} has paid GH₵{order.amount:.2f} for "
        f"{order.quantity} x {order.product_name} on {settings.BRAND_NAME} Skills Hub. "
        f"Order {order.reference}. {how} "
        f"Call them on {order.buyer_phone}. The money goes to your payout account; "
        f"mark the order as handed over in your dashboard once they have it."
    )


def alert_url(notice):
    """The wa.me link an officer presses to send this alert."""
    if notice.kind == SellerNotice.Kind.NEW_ORDER:
        return chat_url(notice.seller.phone, order_text(notice.order))
    return chat_url(notice.seller.phone, alert_text(notice.enquiry))


def mark_sent(notice, *, by):
    """Record that an officer sent it.

    Recorded before WhatsApp opens, not after: nothing comes back from wa.me
    to say the officer pressed send, so recording afterwards would leave
    every message looking unsent for ever.
    """
    notice.sent_at = timezone.now()
    notice.sent_by = by
    notice.save(update_fields=["sent_at", "sent_by", "updated_at"])
    return notice
