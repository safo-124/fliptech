"""Who may watch which lesson of a paid course.

One rule, used by every place a lesson's files could leak from: the public
listing, the course page, its per-viewer access endpoint, and Caddy's check
before it streams a file (media_access_view).

Every lesson needs an account: nobody signed out may play one, free course,
preview or not. Staff asked for it to be strict, so the files themselves are
refused (Caddy asks media_access_view), not only hidden on the page.

On top of that, a lesson is locked when its workshop charges for the course,
it is not the free preview (the first lesson approved, by when it was sent),
and it is an upload — a YouTube link from before uploads is public on YouTube
anyway, so locking it here would lock nothing. A locked lesson may still be
watched by someone who bought the course, by the workshop's own trainers, and
by staff.
"""

from dataclasses import dataclass, field

from providers.models import ProviderVideo
from providers.video_hls import HLS_PREFIX
from trainees.access import own_trainee_account

from .models import CourseOffer, has_paid


@dataclass
class Gate:
    """One workshop's course, from one viewer's side."""

    price: object = None
    # The price before a launch sale, when one is on; else None.
    full_price: object = None
    locked_ids: set = field(default_factory=set)
    preview_id: int | None = None
    owned: bool = False
    # Signed in at all (any account). Without it, nothing plays.
    signed_in: bool = False

    def is_locked(self, video):
        """Part of the paid course and not bought: buying opens it."""
        return not self.owned and video.pk in self.locked_ids

    def needs_sign_in(self, video):
        """Would play, once the viewer signs in."""
        return not self.owned and not self.signed_in and not self.is_locked(video)

    def may_watch(self, video):
        return self.owned or (self.signed_in and video.pk not in self.locked_ids)


def offer_for(provider):
    try:
        return provider.course_offer
    except CourseOffer.DoesNotExist:
        return None


def _signed_in(request):
    user = getattr(request, "user", None) if request is not None else None
    return bool(user is not None and user.is_authenticated and user.is_active)


def _viewer_owns(provider, request):
    if request is None:
        return False
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        if user.is_staff:
            return True
        trainer = getattr(user, "trainer_account", None)
        if trainer is not None and provider.trainer_memberships.filter(trainer=trainer).exists():
            return True
    trainee = own_trainee_account(request)
    return trainee is not None and has_paid(trainee, provider)


def gate_for(provider, request=None, *, videos=None):
    """The gate for this workshop's course and this request's viewer.

    `videos` may pass the approved lessons already fetched, oldest first,
    to save a query; otherwise they are read here.
    """
    offer = offer_for(provider)
    if offer is None or not offer.is_paid:
        return Gate(signed_in=_signed_in(request))
    if videos is None:
        videos = list(provider.videos.shown().in_course_order())
    uploads = [video for video in videos if not video.is_youtube]
    preview = uploads[0].pk if uploads else None
    return Gate(
        price=offer.current_price,
        full_price=offer.price if offer.on_sale else None,
        preview_id=preview,
        locked_ids={video.pk for video in uploads if video.pk != preview},
        owned=_viewer_owns(provider, request),
        signed_in=_signed_in(request),
    )


def gate_for_file(name, request=None):
    """(video, gate) for a public video file's stored name, or (None, None).

    Only the playable copies are ever locked: the two files, and every
    playlist and piece of the streaming copy. A poster is a still, shown on a
    locked lesson's card so a trainee can see what they would be buying.
    """
    shown = ProviderVideo.objects.shown().select_related("provider")
    if name.startswith(HLS_PREFIX):
        folder = name.rsplit("/", 1)[0]
        video = shown.filter(hls_dir=folder).first() if folder else None
    else:
        video = shown.filter(public_360=name).first() or shown.filter(public_720=name).first()
    if video is None:
        return None, None
    return video, gate_for(video.provider, request)
