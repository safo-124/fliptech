"""What the mobile app needs from the server beyond the site's own API:
notices it shows as phone notifications, and crash reports.

No Firebase or other push service: the app collects its notices from here,
when it opens and every quarter of an hour or so in the background
(appsupport/notify.py, mobile/src/lib/notices.ts).
"""

from django.conf import settings
from django.db import models


class Notice(models.Model):
    """Something to tell the person with this phone number: the same words
    the SMS would have carried, kept for the app to collect."""

    # E.164, as the accounts store it. A phone, not an account: buyers,
    # sellers and trainers are told by number, and one person may be all
    # three with one phone.
    phone = models.CharField(max_length=20, db_index=True)
    title = models.CharField(max_length=80)
    body = models.CharField(max_length=500)
    # A path on the site ("/account/chats/12"), which the app maps to its
    # own screen. Blank when there is nowhere in particular to go.
    link = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    # Whether an SMS went too (no app checking in, or money involved).
    texted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.phone}: {self.body[:60]}"


class CrashReport(models.Model):
    """An error the app could not recover from, sent by the app itself.

    No third-party service: the report comes here and staff read it in the
    back office. Never holds the person's data beyond which account it was.
    """

    message = models.CharField(max_length=500)
    stack = models.TextField(blank=True)
    # Where it happened: the screen's route, and whether it brought the app down.
    screen = models.CharField(max_length=200, blank=True)
    fatal = models.BooleanField(default=False)
    app_version = models.CharField(max_length=40, blank=True)
    # The published update the app was running (appsupport/updates.py), if any.
    update_id = models.CharField(max_length=60, blank=True)
    device = models.CharField(max_length=120, blank=True)
    os_version = models.CharField(max_length=40, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.message[:80]
