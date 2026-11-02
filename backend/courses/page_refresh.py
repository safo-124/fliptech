"""Course pages refresh the moment a course changes, as marketplace ones do.

The same request to the frontend's /revalidate (marketplace/page_refresh.py),
which expires the "learn" cache tag as well: a new lesson approved, a lesson
taken down, the order changed, a launch price, a review. Saves the public
never sees (an upload arriving piece by piece, an encode) ask for nothing.
"""

from django.db.models.signals import post_delete, post_save

from marketplace.page_refresh import refresh_soon

UNSEEN_VIDEO_STATES = {"uploading", "queued", "processing", "failed"}


def _changed(sender, instance, **kwargs):
    if sender.__name__ == "ProviderVideo" and instance.status in UNSEEN_VIDEO_STATES:
        return
    refresh_soon()


def connect():
    from providers.models import ProviderVideo

    from .models import CourseOffer, CourseReview, LessonCaption

    for model in (CourseOffer, CourseReview, LessonCaption, ProviderVideo):
        post_save.connect(_changed, sender=model, dispatch_uid=f"learn-refresh-{model.__name__}")
        post_delete.connect(
            _changed, sender=model, dispatch_uid=f"learn-refresh-del-{model.__name__}"
        )
