from django.apps import AppConfig
from django.db.models.signals import post_delete


def _discard_video_files(sender, instance, **kwargs):
    # A signal rather than a delete() override, so a video removed with its
    # whole listing — a cascade, which never calls delete() on each row —
    # still takes its files with it. Gigabytes nothing refers to would
    # otherwise sit on the disk forever. On commit, so a delete that is
    # rolled back does not leave a row pointing at files already gone.
    from django.db import transaction

    from .videos import discard_files

    # The id is taken now: by the time the commit runs, Django has set the
    # deleted instance's pk to None.
    video_id = instance.pk
    transaction.on_commit(lambda: discard_files(instance, video_id=video_id))


class ProvidersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "providers"

    def ready(self):
        post_delete.connect(
            _discard_video_files, sender="providers.ProviderVideo", dispatch_uid="video-files"
        )
