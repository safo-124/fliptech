"""The few Paystack calls paid courses and the marketplace need, and
checking its webhooks.

Standard library only (urllib), as core/trade_photos.py does for Wikimedia:
four endpoints do not justify a dependency. Everything is keyed on
settings.PAYSTACK_SECRET_KEY; with none set, selling is switched off and the
site says so rather than failing at checkout.

Test keys (sk_test_…) and live keys (sk_live_…) use the same endpoints, so
going live is swapping the key and nothing else.
"""

import hashlib
import hmac
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 20


class PaystackError(Exception):
    """A call that failed, worded so it can be shown to the person who tried."""


def enabled():
    return bool(settings.PAYSTACK_SECRET_KEY)


def _call(method, path, payload=None, *, query=None):
    if not enabled():
        raise PaystackError("Payments are not switched on yet.")
    url = settings.PAYSTACK_API_URL.rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            data = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        # Paystack explains a refusal in "message"; that is what to show.
        try:
            message = json.loads(exc.read() or b"{}").get("message")
        except ValueError:
            message = None
        logger.warning("Paystack %s %s refused: %s %s", method, path, exc.code, message)
        raise PaystackError(message or "Paystack refused the request.") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning("Paystack %s %s failed: %s", method, path, exc)
        raise PaystackError("Could not reach Paystack. Try again in a minute.") from exc
    if not data.get("status"):
        raise PaystackError(data.get("message") or "Paystack refused the request.")
    return data.get("data")


def payout_banks():
    """Where a trainer can be paid in Ghana: mobile money first, then banks.

    [{"code", "name", "type"}]. Cached for a day: the list changes when a
    bank merges, not between one trainer and the next.
    """
    cached = cache.get("paystack:payout-banks")
    if cached is not None:
        return cached
    banks = []
    for kind in ("mobile_money", "ghipss"):
        for bank in _call("GET", "/bank", query={"currency": "GHS", "type": kind}) or []:
            if bank.get("active", True) and not bank.get("is_deleted"):
                banks.append({"code": bank["code"], "name": bank["name"], "type": kind})
    cache.set("paystack:payout-banks", banks, 24 * 3600)
    return banks


def save_subaccount(*, existing_code, business_name, bank_code, account_number):
    """Create or update the trainer's payout subaccount. Returns its code.

    percentage_charge is Fliiptech's share of each payment: none, for now.
    """
    payload = {
        "business_name": business_name[:100],
        "settlement_bank": bank_code,
        "account_number": account_number,
        "percentage_charge": float(settings.PAYSTACK_PLATFORM_PERCENTAGE),
    }
    if existing_code:
        data = _call("PUT", f"/subaccount/{urllib.parse.quote(existing_code)}", payload)
        return (data or {}).get("subaccount_code") or existing_code
    return _call("POST", "/subaccount", payload)["subaccount_code"]


def initialize(
    *,
    email,
    amount_pesewas,
    reference,
    callback_url,
    subaccount=None,
    metadata=None,
    transaction_charge=None,
):
    """Start a payment. Returns the URL to send the payer to.

    With a subaccount, the money is split to it as it is paid (a trainer's
    course, a seller's order); without one, it is Fliiptech's own (a boost
    or a Shop plan). transaction_charge is Fliiptech's share in pesewas,
    overriding the subaccount's percentage for this one payment.
    """
    payload = {
        "email": email,
        "amount": amount_pesewas,
        "currency": "GHS",
        "reference": reference,
        "callback_url": callback_url,
        "channels": ["mobile_money", "card"],
        "metadata": metadata or {},
    }
    if subaccount:
        payload["subaccount"] = subaccount
        # Who pays Paystack's fee: the trainer's or seller's share by default.
        payload["bearer"] = settings.PAYSTACK_FEE_BEARER
        if transaction_charge is not None:
            payload["transaction_charge"] = transaction_charge
    data = _call("POST", "/transaction/initialize", payload)
    return data["authorization_url"]


def verify(reference):
    """What Paystack says happened to a payment."""
    return _call("GET", f"/transaction/verify/{urllib.parse.quote(reference)}")


def signature_is_valid(body, signature):
    """Whether a webhook really came from Paystack: HMAC-SHA512 of the raw
    body with the secret key, compared in constant time."""
    if not enabled() or not signature:
        return False
    expected = hmac.new(settings.PAYSTACK_SECRET_KEY.encode(), body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, signature)


def save_recipient(*, bank_code, bank_type, account_number, name):
    """A transfer recipient for a seller's account. Returns its code.

    Only used when the marketplace holds payments for buyer protection: the
    seller's share then goes out as a transfer rather than a split.
    """
    data = _call(
        "POST",
        "/transferrecipient",
        {
            "type": "mobile_money" if bank_type == "mobile_money" else "ghipss",
            "name": name[:100],
            "account_number": account_number,
            "bank_code": bank_code,
            "currency": "GHS",
        },
    )
    return data["recipient_code"]


def transfer(*, amount_pesewas, recipient, reference, reason):
    """Send money from Fliiptech's Paystack balance. Returns Paystack's status
    ("success", "pending", "otp", ...). The reference makes a retry safe:
    Paystack refuses a second transfer with the same one."""
    data = _call(
        "POST",
        "/transfer",
        {
            "source": "balance",
            "amount": amount_pesewas,
            "currency": "GHS",
            "recipient": recipient,
            "reference": reference,
            "reason": reason[:100],
        },
    )
    return (data or {}).get("status", "")


def refund(*, reference, amount_pesewas=None):
    """Give a buyer their money back for a transaction."""
    payload = {"transaction": reference}
    if amount_pesewas is not None:
        payload["amount"] = amount_pesewas
    return _call("POST", "/refund", payload)
