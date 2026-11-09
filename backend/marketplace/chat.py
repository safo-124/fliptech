"""Chat with the seller: threads between a signed-in buyer and a shop.

Buyers use /api/account/chats/, sellers /api/seller/chats/. Each side is
texted about a new message, at most once every TEXT_EVERY per thread, with a
link to read it, so a quick back and forth is not a stream of texts. Phone
numbers are never shown to the other side. The website and the app poll the
thread while it is open; nothing here needs a socket.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from appsupport.notify import notify
from core.media import public_url
from core.sms import send_sms

from .models import Conversation, Message, Product, SellerAccount
from .views import IsActiveSeller
from .views import _account as _seller_account

TEXT_EVERY = timedelta(minutes=30)
MAX_BODY = 1000
PAGE = 100


def _site(path):
    return f"{settings.PUBLIC_SITE_URL.rstrip('/')}{path}"


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


def _message(message, request):
    return {
        "id": message.pk,
        "sender": message.sender,
        "body": message.body,
        "product": _product_card(message.product, request),
        "created_at": message.created_at,
    }


def _unread(conversation, side):
    """Messages from the other side newer than this side last read."""
    other = Message.Sender.SELLER if side == Message.Sender.BUYER else Message.Sender.BUYER
    read_at = (
        conversation.buyer_read_at if side == Message.Sender.BUYER else conversation.seller_read_at
    )
    messages = conversation.messages.filter(sender=other)
    return messages.filter(created_at__gt=read_at).count() if read_at else messages.count()


def _summary(conversation, side, request):
    last = conversation.messages.order_by("-created_at").first()
    them = (
        {"name": conversation.seller.business_name, "id": conversation.seller_id}
        if side == Message.Sender.BUYER
        else {"name": conversation.buyer.display_name or _("A buyer"), "id": None}
    )
    return {
        "id": conversation.pk,
        "with": them,
        "last": _message(last, request) if last else None,
        "unread": _unread(conversation, side),
        "last_message_at": conversation.last_message_at,
    }


def _post(conversation, side, body, product, request):
    """Add a message and, unless they were texted about this thread
    recently, text the other side."""
    now = timezone.now()
    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().get(pk=conversation.pk)
        message = Message.objects.create(
            conversation=conversation, sender=side, body=body, product=product
        )
        conversation.last_message_at = now
        if side == Message.Sender.BUYER:
            conversation.buyer_read_at = now
            texted_field, last_texted = "seller_texted_at", conversation.seller_texted_at
        else:
            conversation.seller_read_at = now
            texted_field, last_texted = "buyer_texted_at", conversation.buyer_texted_at
        due = last_texted is None or now - last_texted >= TEXT_EVERY
        if due:
            setattr(conversation, texted_field, now)
        conversation.save()
    if due:
        if side == Message.Sender.BUYER:
            to = conversation.seller.phone
            who = conversation.buyer.display_name or _("A buyer")
            link = _site("/sell/shop?tab=chats")
        else:
            to = conversation.buyer.phone
            who = conversation.seller.business_name
            link = _site(f"/account/chats/{conversation.pk}")
        transaction.on_commit(
            lambda: _text(
                to, f"{settings.BRAND_NAME}: {who} sent you a message. Read and reply: {link}"
            )
        )
    return message


def _text(to, message):
    try:
        notify(to, message, send=send_sms)
    except Exception:  # noqa: BLE001 - a text that fails must not lose the message
        import logging

        logging.getLogger(__name__).exception("Could not text about a chat message")


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


def _thread(conversation, side, request):
    messages = list(
        conversation.messages.select_related("product").prefetch_related("product__photos")
    )[-PAGE:]
    return {
        **_summary(conversation, side, request),
        "messages": [_message(message, request) for message in messages],
    }


def _buyer(request):
    from accounts.views import _account

    return _account(request)


def _buyer_permission():
    from accounts.views import IsCustomer

    return IsCustomer


@method_decorator(csrf_protect, name="dispatch")
class BuyerChatsView(APIView):
    """A buyer's chats. POST starts (or continues) the chat with a shop."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [_buyer_permission()]

    @extend_schema(responses={200: None})
    def get(self, request):
        account = _buyer(request)
        chats = account.conversations.select_related("seller", "buyer")
        return Response(
            {"results": [_summary(chat, Message.Sender.BUYER, request) for chat in chats]}
        )

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        account = _buyer(request)
        body, refused = _body(request)
        if refused:
            return refused
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
        _post(conversation, Message.Sender.BUYER, body, product, request)
        conversation.refresh_from_db()
        return Response(
            _thread(conversation, Message.Sender.BUYER, request), status=status.HTTP_201_CREATED
        )


@method_decorator(csrf_protect, name="dispatch")
class BuyerChatView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [_buyer_permission()]

    def _chat(self, request, pk):
        chat = _buyer(request).conversations.select_related("seller", "buyer").filter(pk=pk).first()
        if chat is None:
            raise NotFound(_("No such chat."))
        return chat

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        chat = self._chat(request, pk)
        Conversation.objects.filter(pk=chat.pk).update(buyer_read_at=timezone.now())
        chat.refresh_from_db()
        return Response(_thread(chat, Message.Sender.BUYER, request))

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        chat = self._chat(request, pk)
        body, refused = _body(request)
        if refused:
            return refused
        _post(chat, Message.Sender.BUYER, body, None, request)
        chat.refresh_from_db()
        return Response(
            _thread(chat, Message.Sender.BUYER, request), status=status.HTTP_201_CREATED
        )


@method_decorator(csrf_protect, name="dispatch")
class SellerChatsView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsActiveSeller]

    @extend_schema(responses={200: None})
    def get(self, request):
        seller = _seller_account(request)
        chats = seller.conversations.select_related("seller", "buyer")
        return Response(
            {"results": [_summary(chat, Message.Sender.SELLER, request) for chat in chats]}
        )


@method_decorator(csrf_protect, name="dispatch")
class SellerChatView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsActiveSeller]

    def _chat(self, request, pk):
        chat = (
            _seller_account(request)
            .conversations.select_related("seller", "buyer")
            .filter(pk=pk)
            .first()
        )
        if chat is None:
            raise NotFound(_("No such chat."))
        return chat

    @extend_schema(responses={200: None})
    def get(self, request, pk):
        chat = self._chat(request, pk)
        Conversation.objects.filter(pk=chat.pk).update(seller_read_at=timezone.now())
        chat.refresh_from_db()
        return Response(_thread(chat, Message.Sender.SELLER, request))

    @extend_schema(request=None, responses={201: None})
    def post(self, request, pk):
        chat = self._chat(request, pk)
        body, refused = _body(request)
        if refused:
            return refused
        _post(chat, Message.Sender.SELLER, body, None, request)
        chat.refresh_from_db()
        return Response(
            _thread(chat, Message.Sender.SELLER, request), status=status.HTTP_201_CREATED
        )
