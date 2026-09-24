"""Whether messages are actually reaching anyone.

The back office reports enquiry counts and a response rate as though the
workshop had been told an enquiry arrived. Today it has not been: SMS and
email default to the console backend, and the provider alert in
enquiries/views.py is a log line, because a business-initiated WhatsApp
template needs credentials nobody has yet.

So an operations lead reads "40% replied" and concludes providers are slow.
They are not slow; they were never told. Acting on that number means chasing
workshops over messages that were never sent, which is worse than having no
number at all.

This module answers "what is actually being delivered" in one place so the
dashboard can say it out loud.
"""

from django.conf import settings

# Whether an enquiry causes the workshop to be told.
#
# Hard-coded because there is nothing to inspect: enquiries/views.py writes a
# log line where the send would go. Flip this when that becomes a real send,
# and test_delivery.py will hold you to it — it fails if an enquiry ever
# reaches a send function while this says False.
PROVIDER_ALERTS_SEND = False

# Backends that write somewhere a developer can read and a user cannot.
INERT_BACKENDS = {"console", "dummy", "locmem", ""}


def _channel(name, setting_value, carries):
    live = setting_value not in INERT_BACKENDS
    return {
        "name": name,
        "provider": setting_value or "unset",
        "live": live,
        "carries": carries,
    }


def status():
    """What each delivery channel is doing, and whether anything is wrong.

    Read by the dashboard. Deliberately not cached: it is three settings
    lookups, and a stale answer about whether messages are being delivered
    would be worse than the problem it describes.
    """
    channels = [
        _channel(
            "Text messages",
            getattr(settings, "SMS_PROVIDER", ""),
            "Sign-in codes for trainees and trainers, and enquiry verification.",
        ),
        _channel(
            "Email",
            getattr(settings, "EMAIL_PROVIDER", ""),
            "Sign-in codes for anyone using an email address instead of a phone.",
        ),
    ]
    alerts = {
        "name": "Workshop alerts",
        "provider": "not built" if not PROVIDER_ALERTS_SEND else "live",
        "live": PROVIDER_ALERTS_SEND,
        "carries": "Telling a workshop that somebody has enquired.",
    }
    channels.append(alerts)

    broken = [channel for channel in channels if not channel["live"]]
    return {
        "channels": channels,
        "broken": broken,
        "all_live": not broken,
        # The one consequence worth spelling out on a dashboard that shows a
        # response rate two cards away from this strip.
        "response_rate_is_misleading": not alerts["live"],
    }
