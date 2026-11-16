"""Training pages refresh the moment a workshop or course changes.

/training, the home page's "Starting soon", the trade counts and the map are
cached for five minutes (frontend lib/api.ts), under the "training" tag.
Hiding a workshop or a course (in the back office, by its trainer, or with
`hide_listing`) used to leave it on those pages until the timer ran out,
while its own page had already changed. Now any change to what they show
asks the frontend's /revalidate to expire the tag, through the same request
as marketplace and course pages (marketplace/page_refresh.py).
"""

from django.db.models.signals import post_delete, post_save

from marketplace.page_refresh import refresh_soon

# A save that only touches the timestamp changes nothing a visitor sees.
QUIET_PROVIDER_FIELDS = {"updated_at"}


def _changed(sender, instance, **kwargs):
    update_fields = kwargs.get("update_fields")
    if (
        sender.__name__ == "Provider"
        and update_fields
        and set(update_fields) <= QUIET_PROVIDER_FIELDS
    ):
        return
    refresh_soon()


def connect():
    from catalog.models import Intake, Programme, Trade

    from .models import Provider, ProviderPhoto

    for model in (Provider, ProviderPhoto, Programme, Intake, Trade):
        post_save.connect(_changed, sender=model, dispatch_uid=f"training-refresh-{model.__name__}")
        post_delete.connect(
            _changed, sender=model, dispatch_uid=f"training-refresh-del-{model.__name__}"
        )
