"""Chat: threads between a signed-in person and a business, which is a shop
or a training workshop.

People use /api/account/chats/. Businesses use /api/inbox/: one inbox for
everything a login holds, so a tailor who teaches and sells answers trainees
and buyers in one place. /api/seller/chats/ stays for app builds made before
the inbox.

Each side is told about a new message (in the app, or by text when the app is
not in use: appsupport/notify.py) at most once every TEXT_EVERY per thread,
with a link to read it, so a quick back and forth is not a stream of texts.
Phone numbers are never shown to the other side; either side may share their
own (share-number). A workshop's reply marks the trainee's enquiry replied,
which is what makes the response rate a measurement rather than a guess. The
website and the app poll the thread while it is open; nothing here needs a
socket.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from appsupport.notify import notify
from core.media import public_url
from core.sms import send_sms

from .models import ChatReport, Conversation, Message, Product, ProductEnquiry, SellerAccount
from .views import IsActiveSeller
from .views import _account as _seller_account

logger = logging.getLogger(__name__)

TEXT_EVERY = timedelta(minutes=30)
MAX_BODY = 1000
PAGE = 100

# Who is on which side, in the words the API uses.
PERSON = Message.Sender.BUYER
BUSINESS = Message.Sender.SELLER


def _site(path):
    return f"{settings.PUBLIC_SITE_URL.rstrip('/')}{path}"


def _chats():
    return Conversation.objects.select_related("seller", "provider", "provider__area", "buyer")


# --------------------------------------------------------------------------
# What the API shows


def _product_card(product, request):
    if product is None:
        return None
    first = next(iter(product.photos.all()), None)
    return {
        "id": product.pk,
        "name": product.name,
        "price": f"{product.price:.2f}" if product.price is not None else None,
        "photo": public_url(first.image.url, request) if first and first.image else None,
    }


def _course_card(enquiry):
    """The course an enquiry is about, for the card at the top of its message."""
    if enquiry is None:
        return None
    programme = enquiry.programme
    return {
        "reference": enquiry.reference_code,
        "title": programme.title if programme else "",
        "fee": f"{programme.fee:.2f}" if programme else None,
        "starts": enquiry.intake.start_date if enquiry.intake_id else None,
    }


def _message(message, request):
    return {
        "id": message.pk,
        "sender": message.sender,
        "kind": message.kind,
        "body": message.body,
        "product": _product_card(message.product, request),
        "course": _course_card(message.enquiry),
        "created_at": message.created_at,
    }


def _business(conversation):
    """The shop or workshop in a chat: its name, and where its page is."""
    if conversation.seller_id:
        return {
            "kind": "shop",
            "id": conversation.seller_id,
            "name": conversation.seller.business_name,
            "path": f"/marketplace/seller/{conversation.seller_id}",
        }
    provider = conversation.provider
    return {
        "kind": "workshop",
        "id": provider.pk,
        "name": provider.name,
        "path": f"/{provider.area.slug}/{provider.slug}",
    }


def _unread(conversation, side):
    """Messages from the other side newer than this side last read."""
    other = BUSINESS if side == PERSON else PERSON
    read_at = conversation.buyer_read_at if side == PERSON else conversation.seller_read_at
    messages = conversation.messages.filter(sender=other)
    return messages.filter(created_at__gt=read_at).count() if read_at else messages.count()


def _summary(conversation, side, request):
    last = conversation.messages.order_by("-created_at").first()
    business = _business(conversation)
    if side == PERSON:
        them = {"name": business["name"], "id": business["id"]}
    else:
        fallback = _("A trainee") if business["kind"] == "workshop" else _("A buyer")
        them = {"name": conversation.buyer.display_name or fallback, "id": None}
    return {
        "id": conversation.pk,
        "kind": business["kind"],
        "with": them,
        "business": business,
        "last": _message(last, request) if last else None,
        "unread": _unread(conversation, side),
        "last_message_at": conversation.last_message_at,
    }


def _thread(conversation, side, request):
    messages = list(
        conversation.messages.select_related(
            "product", "enquiry", "enquiry__programme", "enquiry__intake"
        ).prefetch_related("product__photos")
    )[-PAGE:]
    return {
        **_summary(conversation, side, request),
        "messages": [_message(message, request) for message in messages],
    }


# --------------------------------------------------------------------------
# Sending, telling the other side, and what a reply means


def business_phones(conversation):
    """Who to tell when a person writes: the shop's number, or each trainer
    who holds the workshop. Empty for a workshop nobody has claimed yet,
    which the staff queue picks up at once (providers/owner_messages.py)."""
    if conversation.seller_id:
        return [conversation.seller.phone] if conversation.seller.is_active else []
    memberships = conversation.provider.trainer_memberships.select_related("trainer")
    return [m.trainer.phone for m in memberships if m.trainer.is_active]


def _post(conversation, side, body, product, request, *, kind=Message.Kind.TEXT, enquiry=None):
    """Add a message and, unless they were told about this thread recently,
    tell the other side. A business's message also marks what it answers."""
    now = timezone.now()
    with transaction.atomic():
        conversation = (
            Conversation.objects.select_for_update(of=("self",))
            .select_related("seller", "provider", "buyer")
            .get(pk=conversation.pk)
        )
        message = Message.objects.create(
            conversation=conversation,
            sender=side,
            kind=kind,
            body=body,
            product=product,
            enquiry=enquiry,
        )
        conversation.last_message_at = now
        if side == PERSON:
            conversation.buyer_read_at = now
            texted_field, last_texted = "seller_texted_at", conversation.seller_texted_at
        else:
            conversation.seller_read_at = now
            texted_field, last_texted = "buyer_texted_at", conversation.buyer_texted_at
        # A new enquiry is always worth telling the workshop about.
        due = kind == Message.Kind.ENQUIRY or last_texted is None or now - last_texted >= TEXT_EVERY
        if due:
            setattr(conversation, texted_field, now)
        conversation.save()
        if side == BUSINESS:
            _mark_answered(conversation, now)
    if due:
        _tell_other_side(conversation, side, message)
    return message


# How much of a question about a product its text quotes: enough to answer
# from, short enough to stay near one SMS.
QUOTE = 60


def _tell_other_side(conversation, side, message):
    brand = settings.BRAND_NAME
    enquiry = message.enquiry
    if side == PERSON:
        who = conversation.buyer.display_name or (
            _("A trainee") if conversation.provider_id else _("A buyer")
        )
        link = _site(f"/inbox/{conversation.pk}")
        if message.kind == Message.Kind.ENQUIRY and enquiry is not None and enquiry.programme_id:
            text = _("%(brand)s: %(who)s asked about %(course)s. Read and reply: %(link)s") % {
                "brand": brand,
                "who": who,
                "course": enquiry.programme.title,
                "link": link,
            }
        elif message.product is not None:
            quote = message.body if len(message.body) <= QUOTE else message.body[: QUOTE - 1] + "…"
            text = _(
                '%(brand)s: %(who)s asked about %(product)s: "%(quote)s" Read and reply: %(link)s'
            ) % {
                "brand": brand,
                "who": who,
                "product": message.product.name,
                "quote": quote,
                "link": link,
            }
        else:
            text = _("%(brand)s: %(who)s sent you a message. Read and reply: %(link)s") % {
                "brand": brand,
                "who": who,
                "link": link,
            }
        phones = business_phones(conversation)
    else:
        text = _("%(brand)s: %(who)s sent you a message. Read and reply: %(link)s") % {
            "brand": brand,
            "who": conversation.business_name,
            "link": _site(f"/account/chats/{conversation.pk}"),
        }
        phones = [conversation.buyer.phone]
    for phone in phones:
        transaction.on_commit(lambda to=phone: _text(to, text))


def _mark_answered(conversation, now):
    """A business replied: the enquiries and questions in this chat are
    answered, at this time, unless they already were."""
    if conversation.provider_id:
        from enquiries.models import Enquiry, EnquiryOutcome

        open_enquiries = Enquiry.objects.filter(messages__conversation=conversation).exclude(
            outcome__replied=True
        )
        for enquiry in open_enquiries.distinct():
            outcome, _created = EnquiryOutcome.objects.get_or_create(enquiry=enquiry)
            outcome.replied = True
            outcome.replied_at = now
            outcome.note = outcome.note or "Replied in chat"
            outcome.save(update_fields=["replied", "replied_at", "note", "updated_at"])
    else:
        ProductEnquiry.objects.filter(
            seller_id=conversation.seller_id,
            buyer_phone=conversation.buyer.phone,
            replied_at__isnull=True,
        ).update(replied_at=now)


def _text(to, message):
    try:
        notify(to, message, send=send_sms)
    except Exception:  # noqa: BLE001 - a text that fails must not lose the message
        logger.exception("Could not text about a chat message")


def _body(request):
    body = str(request.data.get("body") or "").strip()
    if not body:
        return None, Response({"body": [_("Write a message.")]}, status=status.HTTP_400_BAD_REQUEST)
    if len(body) > MAX_BODY:
        return None, Response(
            {"body": [_("Keep it under %(n)s characters.") % {"n": MAX_BODY}]},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if is_ratelimited(request, group="chat", key="user", rate="60/h", increment=True):
        return None, Response(
            {"detail": _("You are sending a lot of messages. Try again later.")},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    return body, None


# --------------------------------------------------------------------------
# Starting a chat from elsewhere on the site


def account_for_chat(request, phone, verified_at):
    """The person's account for a chat that an enquiry or a product question
    opens: theirs if signed in with this number, else the one this proven
    number has, made on first use on the login it already has
    (core/identities.py). None if it has been switched off."""
    from accounts.auth import AccountDisabled, account_for_verified_phone, own_customer_account

    own = own_customer_account(request)
    if own is not None and str(own.phone) == str(phone):
        return own
    try:
        return account_for_verified_phone(phone=phone, verified_at=verified_at)
    except AccountDisabled:
        return None


def open_enquiry_chat(enquiry, account):
    """The workshop chat an enquiry starts or continues, with the enquiry as
    its message. Called by enquiries.views.EnquiryCreateView."""
    conversation, _created = Conversation.objects.get_or_create(
        provider=enquiry.provider, buyer=account
    )
    course = enquiry.programme.title if enquiry.programme_id else _("your training")
    body = enquiry.message.strip() or _("Hello, I would like to know more about %(course)s.") % {
        "course": course
    }
    _post(
        conversation,
        PERSON,
        body[:MAX_BODY],
        None,
        None,
        kind=Message.Kind.ENQUIRY,
        enquiry=enquiry,
    )
    return conversation


def open_product_chat(product, account, body):
    """The shop chat a question about a product starts or continues."""
    conversation, _created = Conversation.objects.get_or_create(
        seller=product.seller, buyer=account
    )
    _post(conversation, PERSON, body[:MAX_BODY], product, None)
    return conversation


def _share_number(conversation, side, phone):
    """The sender's own number, as a message the other side can call."""
    _post(conversation, side, str(phone), None, None, kind=Message.Kind.PHONE)


def _report(conversation, side, request):
    reason = str(request.data.get("reason") or "")
    if reason not in ChatReport.Reason.values:
        return Response(
            {"reason": [_("Choose what went wrong.")]}, status=status.HTTP_400_BAD_REQUEST
        )
    if is_ratelimited(request, group="chat-report", key="user", rate="10/h", increment=True):
        return Response(
            {"detail": _("Too many reports. Try again later.")},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    ChatReport.objects.create(
        conversation=conversation,
        by=side,
        reason=reason,
        details=str(request.data.get("details") or "").strip()[:1000],
    )
    return Response(
        {"detail": _("Thank you. Fliiptech staff will look at this chat.")},
        status=status.HTTP_201_CREATED,
    )


# --------------------------------------------------------------------------
# The person's side


def _buyer(request):
    from accounts.views import _account

    return _account(request)


def _buyer_permission():
    from accounts.views import IsCustomer

    return IsCustomer


def _own_chat(request, pk):
    chat = _chats().filter(buyer=_buyer(request), pk=pk).first()
    if chat is None:
        raise NotFound(_("No such chat."))
    return chat


@method_decorator(csrf_protect, name="dispatch")
class BuyerChatsView(APIView):
    """A person's chats. POST starts (or continues) the chat with a shop
    ({"seller": id}) or a training workshop ({"workshop": id})."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [_buyer_permission()]

    @extend_schema(responses={200: None})
    def get(self, request):
        chats = _chats().filter(buyer=_buyer(request))
        return Response({"results": [_summary(chat, PERSON, request) for chat in chats]})

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        account = _buyer(request)
        body, refused = _body(request)
        if refused:
            return refused
        if request.data.get("workshop"):
            return self._to_workshop(request, account, body)
        seller = SellerAccount.objects.filter(pk=request.data.get("seller") or 0).first()
        if seller is None or not seller.may_sell:
            raise NotFound(_("No such shop."))
        if seller.user_id == account.user_id:
            return Response(
                {"detail": _("This is your own shop.")}, status=status.HTTP_400_BAD_REQUEST
            )
        product = None
        if request.data.get("product"):
            product = (
                Product.objects.visible().filter(pk=request.data["product"], seller=seller).first()
            )
        conversation, _created = Conversation.objects.get_or_create(seller=seller, buyer=account)
        _post(conversation, PERSON, body, product, request)
        return Response(
            _thread(_own_chat(request, conversation.pk), PERSON, request),
            status=status.HTTP_201_CREATED,
        )

    def _to_workshop(self, request, account, body):
        from providers.models import Provider

        provider = Provider.objects.published().filter(pk=request.data.get("workshop") or 0).first()
        if provider is None:
            raise NotFound(_("No such workshop."))
        if provider.trainer_memberships.filter(trainer__user_id=account.user_id).exists():
            return Response(
                {"detail": _("This is your own workshop.")}, status=status.HTTP_400_BAD_REQUEST
            )
        conversation, _created = Conversation.objects.get_or_create(
            provider=provider, buyer=account
        )
        _post(conversation, PERSON, body, None, request)
        return Response(
            _thread(_own_chat(request, conversation.pk), PERSON, request),
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_protect, name="dispatch")
class BuyerChatView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [_buyer_permission()]

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        chat = _own_chat(request, pk)
        Conversation.objects.filter(pk=chat.pk).update(buyer_read_at=timezone.now())
        chat.refresh_from_db()
        return Response(_thread(chat, PERSON, request))

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        chat = _own_chat(request, pk)
        body, refused = _body(request)
        if refused:
            return refused
        _post(chat, PERSON, body, None, request)
        chat.refresh_from_db()
        return Response(_thread(chat, PERSON, request), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class BuyerChatShareView(APIView):
    """Share my number: the person's own verified phone, into the chat."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [_buyer_permission()]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        chat = _own_chat(request, pk)
        _share_number(chat, PERSON, chat.buyer.phone)
        chat.refresh_from_db()
        return Response(_thread(chat, PERSON, request), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class BuyerChatReportView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [_buyer_permission()]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        return _report(_own_chat(request, pk), PERSON, request)


# --------------------------------------------------------------------------
# The business's side: one inbox for a shop and a workshop


def _active_trainer(user):
    trainer = getattr(user, "trainer_account", None)
    return trainer if trainer is not None and trainer.is_active else None


def _active_seller(user):
    seller = getattr(user, "seller_account", None)
    return seller if seller is not None and seller.is_active else None


def _business_q(user):
    q = Q(pk__in=[])
    if _active_seller(user) is not None:
        q |= Q(seller__user=user)
    if _active_trainer(user) is not None:
        q |= Q(provider__trainer_memberships__trainer__user=user)
    return q


class IsBusiness(BasePermission):
    message = "Sign in with your shop's or your workshop's phone number to see this page."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated) or user.is_staff:
            return False
        return _active_seller(user) is not None or _active_trainer(user) is not None


def _inbox_chat(request, pk):
    chat = _chats().filter(_business_q(request.user), pk=pk).distinct().first()
    if chat is None:
        raise NotFound(_("No such chat."))
    return chat


@method_decorator(csrf_protect, name="dispatch")
class InboxView(APIView):
    """Every chat for the shop and the workshop this login holds."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsBusiness]

    @extend_schema(responses={200: None})
    def get(self, request):
        chats = _chats().filter(_business_q(request.user)).distinct()
        return Response({"results": [_summary(chat, BUSINESS, request) for chat in chats]})

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        """Open the chat with the buyer of one of this shop's paid orders
        ({"order": reference}), so the seller can write first. Only when the
        buyer has an account: somebody who bought as a guest has no inbox to
        read it in, and the seller calls them instead."""
        from accounts.models import CustomerAccount

        from .models import Order, PaymentStatus

        seller = _active_seller(request.user)
        order = (
            Order.objects.filter(
                seller=seller,
                reference=str(request.data.get("order") or ""),
                status=PaymentStatus.PAID,
            ).first()
            if seller is not None
            else None
        )
        if order is None:
            raise NotFound(_("No such order."))
        buyer = CustomerAccount.objects.filter(phone=order.buyer_phone, is_active=True).first()
        if buyer is None:
            return Response(
                {"detail": _("This buyer has no account to chat in. Call them instead.")},
                status=status.HTTP_409_CONFLICT,
            )
        conversation, _created = Conversation.objects.get_or_create(seller=seller, buyer=buyer)
        return Response(_thread(_inbox_chat(request, conversation.pk), BUSINESS, request))


@method_decorator(csrf_protect, name="dispatch")
class InboxChatView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsBusiness]

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        chat = _inbox_chat(request, pk)
        Conversation.objects.filter(pk=chat.pk).update(seller_read_at=timezone.now())
        chat.refresh_from_db()
        return Response(_thread(chat, BUSINESS, request))

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        chat = _inbox_chat(request, pk)
        body, refused = _body(request)
        if refused:
            return refused
        _post(chat, BUSINESS, body, None, request)
        chat.refresh_from_db()
        return Response(_thread(chat, BUSINESS, request), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class InboxShareView(APIView):
    """Share my number: the shop's number in a shop chat, the trainer's own
    in a workshop chat."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsBusiness]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        chat = _inbox_chat(request, pk)
        phone = chat.seller.phone if chat.seller_id else _active_trainer(request.user).phone
        _share_number(chat, BUSINESS, phone)
        chat.refresh_from_db()
        return Response(_thread(chat, BUSINESS, request), status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class InboxReportView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsBusiness]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        return _report(_inbox_chat(request, pk), BUSINESS, request)


# --------------------------------------------------------------------------
# The shop's chats at their old addresses, for app builds made before the
# inbox. Shop chats only, as before.


@method_decorator(csrf_protect, name="dispatch")
class SellerChatsView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        chats = _chats().filter(seller=_seller_account(request))
        return Response({"results": [_summary(chat, BUSINESS, request) for chat in chats]})


@method_decorator(csrf_protect, name="dispatch")
class SellerChatView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsActiveSeller]

    def _chat(self, request, pk):
        chat = _chats().filter(seller=_seller_account(request), pk=pk).first()
        if chat is None:
            raise NotFound(_("No such chat."))
        return chat

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        chat = self._chat(request, pk)
        Conversation.objects.filter(pk=chat.pk).update(seller_read_at=timezone.now())
        chat.refresh_from_db()
        return Response(_thread(chat, BUSINESS, request))

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        chat = self._chat(request, pk)
        body, refused = _body(request)
        if refused:
            return refused
        _post(chat, BUSINESS, body, None, request)
        chat.refresh_from_db()
        return Response(_thread(chat, BUSINESS, request), status=status.HTTP_201_CREATED)
