"""Teaching videos on a listing: reading the link a trainer pastes, and adding it.

The trainer puts the video on YouTube (unlisted is fine) and pastes its link.
YouTube does the hard part: storing it, encoding it small enough for a 3G
phone and streaming it. All this keeps is the video's id, and the review in
the back office decides whether it is shown. See ProviderVideo.
"""

import re
from urllib.parse import parse_qs, urlparse

from django.db import IntegrityError, transaction
from django.utils.translation import gettext as _

from .models import ProviderVideo

# Enough to show how a workshop teaches. More is a review queue nobody keeps
# up with and a listing page nobody scrolls to the end of.
MAX_VIDEOS_PER_PROVIDER = 6

VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
YOUTUBE_HOSTS = {"youtube.com", "youtube-nocookie.com"}
# Paths that carry the id as their second segment.
ID_PATHS = {"shorts", "embed", "live", "v"}


class VideoRefused(Exception):
    """Why a link was not added, worded for the trainer."""


def parse_youtube_id(text):
    """The video id in a YouTube link, or None if it is not a link to one video.

    Takes the forms a phone's Share button and a browser's address bar give:
    youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>, /embed/<id> and
    /live/<id>, on www., m. or no subdomain, with or without https://. A
    playlist, a channel, or anything that is not YouTube is None.
    """
    text = (text or "").strip()
    if not text:
        return None
    if "://" not in text:
        text = f"https://{text}"
    try:
        url = urlparse(text)
        host = (url.hostname or "").lower()
    except ValueError:
        return None
    if url.scheme not in ("http", "https"):
        return None

    host = re.sub(r"^(?:www|m)\.", "", host)
    segments = [segment for segment in url.path.split("/") if segment]
    candidate = None
    if host == "youtu.be":
        candidate = segments[0] if segments else None
    elif host in YOUTUBE_HOSTS:
        if segments == ["watch"]:
            candidate = (parse_qs(url.query).get("v") or [None])[0]
        elif len(segments) >= 2 and segments[0] in ID_PATHS:
            candidate = segments[1]

    if candidate and VIDEO_ID.fullmatch(candidate):
        return candidate
    return None


def add_video(provider, *, link, title, actor):
    """A new video on the listing, waiting for review. Raises VideoRefused."""
    youtube_id = parse_youtube_id(link)
    if youtube_id is None:
        raise VideoRefused(
            _(
                "That is not a link to a YouTube video. Open the video in YouTube, "
                "tap Share, copy the link and paste it here."
            )
        )
    if provider.videos.filter(youtube_id=youtube_id).exists():
        raise VideoRefused(_("That video is already on your listing."))
    if provider.videos.count() >= MAX_VIDEOS_PER_PROVIDER:
        raise VideoRefused(
            _("You can add up to %(count)s videos. Remove one to add another.")
            % {"count": MAX_VIDEOS_PER_PROVIDER}
        )
    try:
        # A savepoint, so a double tap that loses the race to the unique
        # constraint is a refusal rather than a broken transaction.
        with transaction.atomic():
            return ProviderVideo.objects.create(
                provider=provider, youtube_id=youtube_id, title=title.strip(), added_by=actor
            )
    except IntegrityError as exc:
        raise VideoRefused(_("That video is already on your listing.")) from exc
