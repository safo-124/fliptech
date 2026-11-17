"""Telling someone something: as a notice the app collects, by email when
they have confirmed an address, and by SMS when the app will not show it.

Every alert that used to be one `send_sms` call goes through `notify`
instead. Sign-in codes do not: they are always texted (enquiries/otp.py).

The rule for the SMS:
* "always" for money (a paid order, a receipt, a balance paid): a text is
  the record people keep, app or not.
* otherwise only when no app signed in to that number has checked in for
  two days. A phone that collects its notices is told there, for free.

The email: to the confirmed address of the account with that number, for
every notice, so a person without the app (or while SMS cannot be relied
on) still hears. Chat messages are emailed at most once an hour per chat,
so a busy conversation does not fill an inbox.
"""

import logging
import re
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from core.sms import send_sms

from .models import Notice

logger = logging.getLogger(__name__)

# An app that has not been opened, nor checked in from the background, for
# this long may be deleted or the phone switched off: text instead.
ACTIVE_FOR = timedelta(hours=48)

URL = re.compile(r"https?://\S+")


def _site_path(message):
    """The last link to this site in the message, as a path, and the
    message with it taken out (the notification is tapped instead)."""
    site = (settings.PUBLIC_SITE_URL or "").rstrip("/")
    links = URL.findall(message)
    for link in reversed(links):
        clean = link.rstrip(".,)")
        if site and clean.startswith(site):
            path = clean[len(site) :] or "/"
            text = message.replace(link, "").strip()
            text = re.sub(r"[\s:]+$", "", text)
            return path, text
    return "", message


def _split(message):
    """ "Fliiptech: NEW PAID ORDER ..." -> title "Fliiptech", body the rest."""
    brand = settings.BRAND_NAME
    prefix = f"{brand}: "
    if message.startswith(prefix):
        return brand, message[len(prefix) :]
    return brand, message


def users_with_phone(phone):
    """The ids of the people this number belongs to: as a buyer, a seller or
    a trainer (one person may be all three, with one phone)."""
    from accounts.models import CustomerAccount
    from marketplace.models import SellerAccount
    from providers.models import TrainerAccount

    ids = set()
    for model in (CustomerAccount, SellerAccount, TrainerAccount):
        ids.update(model.objects.filter(phone=phone).values_list("user_id", flat=True))
    return ids


CHAT_EMAIL_EVERY = timedelta(hours=1)


def confirmed_email(phone):
    """The confirmed email of the person with this number, or None."""
    from accounts.models import CustomerAccount
    from marketplace.models import SellerAccount
    from providers.models import TrainerAccount

    for model in (CustomerAccount, SellerAccount, TrainerAccount):
        email = (
            model.objects.filter(phone=phone, email_verified_at__isnull=False)
            .exclude(email__isnull=True)
            .exclude(email="")
            .values_list("email", flat=True)
            .first()
        )
        if email:
            return email
    return None


def _email(phone, title, body, path):
    """Email the notice, when there is a confirmed address. Never raises: the
    notice and the text stand without it."""
    from django.core.cache import cache

    from core.mail import send_email

    try:
        email = confirmed_email(phone)
        if not email:
            return False
        if "/chats" in path or "/inbox" in path:
            key = f"notify-email:{email}:{path}"
            if not cache.add(key, 1, int(CHAT_EMAIL_EVERY.total_seconds())):
                return False
        site = (settings.PUBLIC_SITE_URL or "").rstrip("/")
        link = f"\n\nOpen it: {site}{path}" if path and site else ""
        first = body.split(". ")[0][:90]
        return send_email(email, f"{title}: {first}", f"{body}{link}")
    except Exception:  # noqa: BLE001 - an email that fails must not stop the rest
        logger.exception("Could not email the notice to %s", phone)
        return False


def app_is_active(phone, now=None):
    from accounts.models import AppToken

    now = now or timezone.now()
    users = users_with_phone(phone)
    if not users:
        return False
    return AppToken.objects.filter(
        user_id__in=users, revoked_at__isnull=True, last_used_at__gte=now - ACTIVE_FOR
    ).exists()


def notify(to, message, *, sms="auto", link="", send=None):
    """Tell the person with phone `to`. Returns whether they were told
    (kept for the app, texted, or both). Raises only if a text was needed
    and failed, as send_sms did, so callers' error handling is unchanged.

    `link` is the site path the notice opens, for a message whose text has
    none; otherwise the last link in the text is used.

    `send` is the SMS function to use: callers pass their own module's
    send_sms, so a test that stubs it there still catches the text."""
    phone = str(to)
    path, text = _site_path(message)
    path = path or link
    title, body = _split(text)
    notice = Notice.objects.create(phone=phone, title=title[:80], body=body[:500], link=path[:300])
    emailed = _email(phone, title, body, path)
    if sms == "always" or not app_is_active(phone):
        sent = (send or send_sms)(phone, message)
        Notice.objects.filter(pk=notice.pk).update(texted=True)
        return sent or emailed
    return True


def phones_for(user):
    """Every number the signed-in person is told on."""
    phones = set()
    for name in ("customer_account", "seller_account", "trainer_account"):
        account = getattr(user, name, None)
        try:
            if account is not None and account.phone:
                phones.add(str(account.phone))
        except Exception:  # noqa: BLE001 - a missing related account
            continue
    return phones
