"""Whether messages are actually reaching anyone.

The back office reports enquiry counts and a response rate as though the
workshop had been told an enquiry arrived. For a long time it had not been:
the alert was a log line, because a business-initiated WhatsApp template needs
credentials nobody has yet. An operations lead reading "40% replied" would
have concluded providers were slow, when they had never been told.

Every enquiry now queues an alert that an officer sends from Messages to send
(providers/owner_messages.py), so workshops are told, by a person rather than
the server. SMS and email still default to the console backend, which writes
to the log and reaches nobody.

This module answers "what is actually being delivered" in one place so the
dashboard can say it out loud.
"""

from django.conf import settings

# Backends that write somewhere a developer can read and a user cannot.
INERT_BACKENDS = {"console", "dummy", "locmem", ""}


# Backends that reach the person, but by a member of staff rather than the
# server. Counted as delivering, and named for what they are.
STAFF_RELAYED_BACKENDS = {"backoffice": "sent by staff from the back office"}


def _channel(name, setting_value, carries):
    live = setting_value not in INERT_BACKENDS
    return {
        "name": name,
        "provider": STAFF_RELAYED_BACKENDS.get(setting_value, setting_value or "unset"),
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
    # Queued with every enquiry and sent by an officer, so every workshop is
    # told. Becomes a server send when there are WhatsApp Cloud API
    # credentials, and this entry with it.
    alerts = {
        "name": "Workshop alerts",
        "provider": STAFF_RELAYED_BACKENDS["backoffice"],
        "live": True,
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
