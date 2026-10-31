"""Teaching videos: the upload, the encoding, the review, and what the public sees."""

import json
import shutil
import subprocess
from collections import namedtuple
from datetime import timedelta
from pathlib import Path

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from providers import video_encoding, video_uploads
from providers.models import Provider, ProviderMembership, ProviderVideo
from providers.trainer_auth import account_for_verified_phone
from providers.videos import decide

ACCRA = Point(-0.1870, 5.6037, srid=4326)
CHUNK = 1024

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg is not installed"
)


@pytest.fixture(autouse=True)
def video_dirs(settings, tmp_path, monkeypatch):
    """Every file this module writes goes under tmp_path.

    The private storage is bound to its field when the model loads, with an
    explicit location, so changing PRIVATE_MEDIA_ROOT does not move it; its
    location is pointed here directly instead.
    """
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.VIDEO_WORK_DIR = str(tmp_path / "work")
    settings.VIDEO_CHUNK_BYTES = CHUNK
    settings.VIDEO_MIN_FREE_BYTES = 0
    private = storages["private"]
    monkeypatch.setattr(private, "_location", str(tmp_path / "private"))
    for cached in ("base_location", "location"):
        private.__dict__.pop(cached, None)
    yield tmp_path
    for cached in ("base_location", "location"):
        private.__dict__.pop(cached, None)


@pytest.fixture
def listing(db):
    region = Region.objects.create(name="Greater Accra", slug="greater-accra")
    area = Area.objects.create(region=region, name="Adenta", slug="adenta", centroid=ACCRA)
    provider = Provider.objects.create(
        name="Vis Hair Studio",
        slug="vis-hair-studio",
        area=area,
        location=ACCRA,
        contact_phone="+233240000601",
        status=Provider.Status.PUBLISHED,
    )
    trainer = account_for_verified_phone(phone="+233240000601", verified_at=timezone.now())
    ProviderMembership.objects.create(
        trainer=trainer, provider=provider, role=ProviderMembership.Role.OWNER
    )
    return provider, trainer


@pytest.fixture
def owner(client, listing):
    client.force_login(listing[1].user)
    return client


def start(client, size=CHUNK * 2 + 10, title="Cornrows in five minutes", **extra):
    return client.post(
        reverse("trainer-videos"),
        {"title": title, "name": "IMG_0001.mp4", "size": size, **extra},
        content_type="application/json",
    )


def send(client, video_id, data, offset):
    return client.put(
        reverse("trainer-video-upload", args=[video_id]),
        data=data,
        content_type="application/octet-stream",
        HTTP_UPLOAD_OFFSET=str(offset),
    )


def upload(client, data, title="Cornrows"):
    """Start an upload and send all of it, a piece at a time."""
    response = start(client, size=len(data), title=title)
    assert response.status_code == 201, response.content
    video_id = response.json()["id"]
    for offset in range(0, len(data), CHUNK):
        response = send(client, video_id, data[offset : offset + CHUNK], offset)
        assert response.status_code == 200, response.content
    return ProviderVideo.objects.get(pk=video_id)


def public_videos(client, provider):
    response = client.get(reverse("provider-by-slug", args=[provider.area.slug, provider.slug]))
    assert response.status_code == 200
    return response.json()["videos"]


def clip(path, *, size="640x360", seconds=2, audio=True, gps=True):
    """A short real video, the way a phone would hand one over."""
    command = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i"]
    command += [f"testsrc=size={size}:rate=25:duration={seconds}"]
    if audio:
        command += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    command += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if audio:
        command += ["-c:a", "aac"]
    if gps:
        command += ["-metadata", "location=+05.6037-000.1870/"]
    subprocess.run([*command, str(path)], check=True)
    return path.read_bytes()


def tags(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", str(path)],
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)["format"].get("tags", {})


def ready_video(provider, **fields):
    """A video already encoded and waiting for review, without running ffmpeg."""
    fields = {
        "title": "Cornrows",
        "status": ProviderVideo.Status.PENDING,
        "duration_seconds": 120,
        "size_360": 11,
        **fields,
    }
    video = ProviderVideo.objects.create(provider=provider, **fields)
    video.review_360.save("360.mp4", ContentFile(b"360p video!"), save=False)
    video.review_poster.save("poster.jpg", ContentFile(b"poster"), save=False)
    video.save()
    return video


# --------------------------------------------------------------------------
# Starting an upload


@pytest.mark.django_db
def test_an_upload_starts_empty_and_waits_for_its_file(owner, listing):
    response = start(owner)

    assert response.status_code == 201, response.content
    body = response.json()
    assert (body["status"], body["upload_received"], body["upload_size"]) == (
        ProviderVideo.Status.UPLOADING,
        0,
        CHUNK * 2 + 10,
    )
    assert body["sources"] == [] and body["poster"] is None


@pytest.mark.django_db
def test_the_listing_tells_the_trainer_their_allowance(owner, settings):
    body = owner.get(reverse("trainer-videos")).json()

    assert body["videos"] == []
    assert body["limits"]["chunk_bytes"] == CHUNK
    assert body["limits"]["max_minutes"] == settings.VIDEO_MAX_MINUTES
    assert body["limits"]["seconds_used"] == 0


@pytest.mark.django_db
def test_a_file_too_large_is_refused_before_any_of_it_is_sent(owner, settings):
    settings.VIDEO_MAX_UPLOAD_BYTES = 1000

    response = start(owner, size=1001)

    assert response.status_code == 400
    assert "too large" in response.json()["detail"]
    assert not ProviderVideo.objects.exists()


@pytest.mark.django_db
def test_there_is_a_limit_on_how_many(owner, settings):
    settings.VIDEO_MAX_PER_PROVIDER = 2
    assert start(owner).status_code == 201
    assert start(owner).status_code == 201

    response = start(owner)

    assert response.status_code == 400
    assert ProviderVideo.objects.count() == 2


@pytest.mark.django_db
def test_a_listing_full_of_hours_takes_no_more(owner, listing, settings):
    settings.VIDEO_MAX_HOURS_PER_PROVIDER = 1
    ready_video(listing[0], duration_seconds=3600)

    response = start(owner)

    assert response.status_code == 400
    assert "1 hours" in response.json()["detail"]


@pytest.mark.django_db
def test_rejected_videos_do_not_count_against_the_hours(owner, listing, settings):
    settings.VIDEO_MAX_HOURS_PER_PROVIDER = 1
    ready_video(listing[0], duration_seconds=3600).delete()
    ProviderVideo.objects.create(
        provider=listing[0],
        title="Turned down",
        status=ProviderVideo.Status.REJECTED,
        duration_seconds=3600,
    )

    assert start(owner).status_code == 201


@pytest.mark.django_db
def test_a_nearly_full_disk_refuses_uploads(owner, settings, monkeypatch):
    settings.VIDEO_MIN_FREE_BYTES = 10 * 1024**3
    usage = namedtuple("usage", "total used free")
    monkeypatch.setattr(shutil, "disk_usage", lambda path: usage(0, 0, 10 * 1024**3))

    response = start(owner, size=1)

    assert response.status_code == 400
    assert not ProviderVideo.objects.exists()


@pytest.mark.django_db
def test_a_trainer_cannot_choose_the_status(owner):
    response = start(owner, status="approved")

    assert response.status_code == 400
    assert not ProviderVideo.objects.exists()


@pytest.mark.django_db
def test_a_suspended_listing_takes_no_new_videos_but_can_lose_one(owner, listing):
    provider, _ = listing
    start(owner)
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.SUSPENDED)

    assert start(owner).status_code == 409
    video = ProviderVideo.objects.get()
    assert owner.delete(reverse("trainer-video-delete", args=[video.pk])).status_code == 204


@pytest.mark.django_db
def test_videos_need_a_listing_and_a_trainer(client, db):
    assert start(client).status_code in (401, 403)

    lone = account_for_verified_phone(phone="+233240000603", verified_at=timezone.now())
    client.force_login(lone.user)
    assert start(client).status_code == 409
    assert client.get(reverse("trainer-videos")).json()["videos"] == []


# --------------------------------------------------------------------------
# Sending it in pieces


@pytest.mark.django_db
def test_pieces_sent_in_order_make_the_file_and_queue_it(owner, video_dirs):
    data = bytes(range(256)) * 9  # 2304 bytes: two full pieces and a short one

    video = upload(owner, data)

    assert video.status == ProviderVideo.Status.QUEUED
    assert video.upload_received == len(data)
    assert video_uploads.work_path(video).read_bytes() == data


@pytest.mark.django_db
def test_a_piece_out_of_place_is_refused_with_where_to_carry_on(owner):
    video_id = start(owner).json()["id"]
    send(owner, video_id, b"a" * CHUNK, 0)

    skipped = send(owner, video_id, b"c" * CHUNK, CHUNK * 2)

    assert skipped.status_code == 409
    assert skipped.json()["upload_received"] == CHUNK


@pytest.mark.django_db
def test_a_piece_sent_twice_is_written_once(owner):
    """A retry whose original arrived but whose answer was lost."""
    video_id = start(owner).json()["id"]
    assert send(owner, video_id, b"a" * CHUNK, 0).status_code == 200

    retry = send(owner, video_id, b"a" * CHUNK, 0)

    assert retry.status_code == 409
    assert retry.json()["upload_received"] == CHUNK
    video = ProviderVideo.objects.get()
    assert video_uploads.work_path(video).stat().st_size == CHUNK


@pytest.mark.django_db
def test_bytes_written_by_a_request_that_died_are_cut_away(owner):
    video_id = start(owner).json()["id"]
    send(owner, video_id, b"a" * CHUNK, 0)
    video = ProviderVideo.objects.get()
    # Half a piece on disk that the row never heard about.
    with open(video_uploads.work_path(video), "ab") as handle:
        handle.write(b"x" * 500)

    send(owner, video_id, b"b" * CHUNK, CHUNK)

    assert video_uploads.work_path(video).read_bytes() == b"a" * CHUNK + b"b" * CHUNK


@pytest.mark.django_db
def test_a_piece_larger_than_allowed_is_refused(owner):
    video_id = start(owner, size=CHUNK * 4).json()["id"]

    response = send(owner, video_id, b"a" * (CHUNK + 1), 0)

    assert response.status_code == 400
    assert response.json()["upload_received"] == 0


@pytest.mark.django_db
def test_nothing_can_be_added_past_the_size_promised(owner):
    video_id = start(owner, size=10).json()["id"]

    response = send(owner, video_id, b"a" * 11, 0)

    assert response.status_code == 400


@pytest.mark.django_db
def test_a_finished_upload_takes_no_more(owner):
    video = upload(owner, b"a" * 10)

    response = send(owner, video.pk, b"b", 10)

    assert response.status_code == 409


@pytest.mark.django_db
def test_a_piece_needs_to_say_where_it_starts(owner):
    video_id = start(owner).json()["id"]

    response = owner.put(
        reverse("trainer-video-upload", args=[video_id]),
        data=b"a",
        content_type="application/octet-stream",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_nobody_can_send_pieces_into_someone_elses_upload(client, owner, listing):
    other = Provider.objects.create(
        name="Another Studio",
        slug="another-studio",
        area=listing[0].area,
        location=ACCRA,
        contact_phone="+233240000602",
        status=Provider.Status.PUBLISHED,
    )
    theirs = ProviderVideo.objects.create(
        provider=other, title="Theirs", status=ProviderVideo.Status.UPLOADING, upload_size=10
    )

    assert send(owner, theirs.pk, b"a", 0).status_code == 404
    assert owner.delete(reverse("trainer-video-delete", args=[theirs.pk])).status_code == 404
    theirs.refresh_from_db()
    assert theirs.upload_received == 0


@pytest.mark.django_db
def test_removing_an_upload_takes_its_file_with_it(owner, django_capture_on_commit_callbacks):
    video_id = start(owner).json()["id"]
    send(owner, video_id, b"a" * CHUNK, 0)
    path = video_uploads.work_path(ProviderVideo.objects.get())
    assert path.exists()

    with django_capture_on_commit_callbacks(execute=True):
        assert owner.delete(reverse("trainer-video-delete", args=[video_id])).status_code == 204

    assert not path.exists()


# --------------------------------------------------------------------------
# Encoding


@needs_ffmpeg
@pytest.mark.django_db
def test_an_upload_is_encoded_for_phones_and_waits_for_review(owner, listing, video_dirs):
    data = clip(video_dirs / "phone.mp4", size="640x360", seconds=2)
    video = upload(owner, data)

    call_command("process_videos", "--once", verbosity=0)

    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.PENDING, video.failure_reason
    assert video.duration_seconds == 2
    assert video.review_360 and video.review_poster
    # Not sharp enough for a 720p copy, so none was made.
    assert not video.review_720
    assert video.size_360 == video.review_360.size
    # Nothing public until it is approved.
    assert not (video.public_360 or video.public_poster)
    assert public_videos(owner, listing[0]) == []
    # The original is gone once encoded.
    assert not video_uploads.work_path(video).exists()
    # And the place it was filmed is not in the copy that will be published.
    assert "location" not in tags(video.review_360.path)


@needs_ffmpeg
@pytest.mark.django_db
def test_a_sharp_upload_also_gets_a_720p_copy(owner, video_dirs):
    data = clip(video_dirs / "phone.mp4", size="1280x720", seconds=1, audio=False)
    video = upload(owner, data)

    call_command("process_videos", "--once", verbosity=0)

    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.PENDING, video.failure_reason
    assert video.review_720 and video.size_720


@needs_ffmpeg
@pytest.mark.django_db
def test_a_file_that_is_not_a_video_fails_with_a_reason(owner):
    video = upload(owner, b"this is a PDF pretending to be a video" * 20)

    call_command("process_videos", "--once", verbosity=0)

    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.FAILED
    assert "not a video" in video.failure_reason
    assert not video_uploads.work_path(video).exists()


@needs_ffmpeg
@pytest.mark.django_db
def test_a_lesson_that_is_too_long_fails_with_a_reason(owner, settings, video_dirs):
    settings.VIDEO_MAX_MINUTES = 0
    video = upload(owner, clip(video_dirs / "phone.mp4", seconds=1, audio=False))

    call_command("process_videos", "--once", verbosity=0)

    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.FAILED
    assert "shorter lessons" in video.failure_reason


@pytest.mark.django_db
def test_an_encoding_whose_worker_died_is_queued_again(listing, settings):
    stalled = ProviderVideo.objects.create(
        provider=listing[0],
        title="Stalled",
        status=ProviderVideo.Status.PROCESSING,
        processing_started_at=timezone.now()
        - timedelta(hours=settings.VIDEO_ENCODE_LEASE_HOURS + 1),
    )
    running = ProviderVideo.objects.create(
        provider=listing[0],
        title="Running",
        status=ProviderVideo.Status.PROCESSING,
        processing_started_at=timezone.now(),
    )

    video_encoding.tidy()

    stalled.refresh_from_db()
    running.refresh_from_db()
    assert stalled.status == ProviderVideo.Status.QUEUED
    assert running.status == ProviderVideo.Status.PROCESSING


@pytest.mark.django_db
def test_an_abandoned_upload_is_removed(listing, settings):
    abandoned = ProviderVideo.objects.create(
        provider=listing[0], title="Gave up", status=ProviderVideo.Status.UPLOADING, upload_size=9
    )
    ProviderVideo.objects.filter(pk=abandoned.pk).update(
        updated_at=timezone.now() - timedelta(hours=settings.VIDEO_ABANDONED_UPLOAD_HOURS + 1)
    )
    fresh = ProviderVideo.objects.create(
        provider=listing[0], title="Still going", status=ProviderVideo.Status.UPLOADING
    )

    video_encoding.tidy()

    assert list(ProviderVideo.objects.all()) == [fresh]


# --------------------------------------------------------------------------
# The review


@pytest.fixture
def staff(db, django_user_model):
    call_command("setup_groups", verbosity=0)

    def member(name, group):
        user = django_user_model.objects.create_user(name, password="pw", is_staff=True)
        user.groups.add(Group.objects.get(name=group))
        return user

    return {
        "officer": member("officer", "Field officer"),
        "lead": member("lead", "Operations lead"),
    }


def approve(client, video):
    return client.post(
        reverse("admin:providers_providervideo_changelist"),
        {"action": "approve_videos", "_selected_action": [video.pk]},
    )


@pytest.mark.django_db
def test_approving_publishes_the_files_and_only_then(client, staff, listing):
    video = ready_video(listing[0])

    client.force_login(staff["officer"])
    approve(client, video)
    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.PENDING

    client.force_login(staff["lead"])
    approve(client, video)
    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.APPROVED
    assert video.reviewed_by == staff["lead"]
    # Moved, not copied: the private copy is gone.
    assert video.public_360 and video.public_poster
    assert not (video.review_360 or video.review_poster)
    assert video.public_360.read() == b"360p video!"

    [shown] = public_videos(client, listing[0])
    assert shown["kind"] == "upload"
    assert shown["duration_seconds"] == 120
    assert shown["sources"] == [{"quality": 360, "url": shown["sources"][0]["url"], "bytes": 11}]
    assert "/media/videos/public/" in shown["sources"][0]["url"]
    assert shown["poster"]


@pytest.mark.django_db
def test_taking_an_approved_video_down_takes_it_off_its_public_address(listing, staff):
    video = ready_video(listing[0])
    decide(video, ProviderVideo.Status.APPROVED, by=staff["lead"])
    public_path = Path(video.public_360.path)

    decide(video, ProviderVideo.Status.REJECTED, by=staff["lead"], note="Not your own work.")

    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.REJECTED
    assert not video.public_360 and video.review_360
    assert not public_path.exists()


@pytest.mark.django_db
def test_a_video_still_being_prepared_cannot_be_approved(client, staff, listing):
    video = ProviderVideo.objects.create(
        provider=listing[0], title="Cornrows", status=ProviderVideo.Status.PROCESSING
    )
    client.force_login(staff["lead"])

    approve(client, video)

    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.PROCESSING
    with pytest.raises(ValueError):
        decide(video, ProviderVideo.Status.APPROVED, by=staff["lead"])


@pytest.mark.django_db
def test_turning_a_video_down_needs_a_note_the_workshop_can_act_on(client, staff, listing):
    video = ready_video(listing[0])
    client.force_login(staff["lead"])
    url = reverse("admin:providers_providervideo_change", args=[video.pk])

    silent = client.post(url, {"title": "Cornrows", "status": "rejected", "review_note": ""})
    assert silent.status_code == 200
    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.PENDING

    client.post(
        url, {"title": "Cornrows", "status": "rejected", "review_note": "Show your own work."}
    )
    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.REJECTED
    assert video.reviewed_by == staff["lead"]


@pytest.mark.django_db
def test_approving_from_the_page_moves_the_files_too(client, staff, listing):
    video = ready_video(listing[0])
    client.force_login(staff["lead"])

    client.post(
        reverse("admin:providers_providervideo_change", args=[video.pk]),
        {"title": "Cornrows", "status": "approved", "review_note": ""},
    )

    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.APPROVED
    assert video.public_360 and not video.review_360


@pytest.mark.django_db
def test_staff_watch_a_video_under_review_and_can_skip_ahead(client, staff, listing):
    video = ready_video(listing[0])
    url = reverse("admin:providers_providervideo_watch", args=[video.pk, "360"])

    assert client.get(url).status_code == 302  # to the back-office sign-in

    client.force_login(staff["officer"])
    whole = client.get(url)
    assert whole.status_code == 200
    assert b"".join(whole.streaming_content) == b"360p video!"

    part = client.get(url, HTTP_RANGE="bytes=5-")
    assert part.status_code == 206
    assert part["Content-Range"] == "bytes 5-10/11"
    assert b"".join(part.streaming_content) == b"video!"

    assert client.get(url, HTTP_RANGE="bytes=50-").status_code == 416
    assert (
        client.get(
            reverse("admin:providers_providervideo_watch", args=[video.pk, "720"])
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_the_review_page_plays_the_private_copy(client, staff, listing):
    video = ready_video(listing[0])
    client.force_login(staff["lead"])

    page = client.get(reverse("admin:providers_providervideo_change", args=[video.pk]))

    watch = reverse("admin:providers_providervideo_watch", args=[video.pk, "360"])
    assert f'<video src="{watch}"' in page.content.decode()


@pytest.mark.django_db
def test_a_field_officer_uploads_a_video_for_a_workshop_but_cannot_approve_it(
    client, staff, listing
):
    client.force_login(staff["officer"])
    add_url = reverse("admin:providers_providervideo_add")
    assert 'name="status"' not in client.get(add_url).content.decode()

    client.post(
        add_url,
        {
            "provider": listing[0].pk,
            "title": "Cornrows",
            "file": SimpleUploadedFile("lesson.mp4", b"a video", content_type="video/mp4"),
        },
    )

    video = ProviderVideo.objects.get()
    assert (video.status, video.added_by, video.upload_size) == (
        ProviderVideo.Status.QUEUED,
        staff["officer"],
        7,
    )
    assert video_uploads.work_path(video).read_bytes() == b"a video"


@pytest.mark.django_db
def test_videos_waiting_show_in_the_sidebar_for_whoever_can_approve_them(client, staff, listing):
    cache.clear()
    ready_video(listing[0])

    client.force_login(staff["lead"])
    assert "Videos to review" in client.get(reverse("admin:index")).content.decode()

    client.force_login(staff["officer"])
    assert "Videos to review" not in client.get(reverse("admin:index")).content.decode()


# --------------------------------------------------------------------------
# What the public and the trainer see


@pytest.mark.django_db
def test_only_approved_videos_are_public(owner, listing, staff):
    provider, _ = listing
    shown = ready_video(provider)
    decide(shown, ProviderVideo.Status.APPROVED, by=staff["lead"])
    ready_video(provider, title="Waiting")
    turned_down = ready_video(provider, title="Turned down")
    decide(turned_down, ProviderVideo.Status.REJECTED, by=staff["lead"], note="Too dark.")
    ProviderVideo.objects.create(
        provider=provider, title="Arriving", status=ProviderVideo.Status.UPLOADING
    )

    videos = public_videos(owner, provider)

    assert [video["id"] for video in videos] == [shown.pk]
    assert set(videos[0]) == {
        "id",
        "title",
        "kind",
        "youtube_id",
        "duration_seconds",
        "poster",
        "sources",
        "locked",
    }


@pytest.mark.django_db
def test_a_video_added_from_youtube_before_uploads_still_plays(owner, listing):
    ProviderVideo.objects.create(
        provider=listing[0],
        title="From before",
        youtube_id="dQw4w9WgXcQ",
        status=ProviderVideo.Status.APPROVED,
    )

    [video] = public_videos(owner, listing[0])

    assert (video["kind"], video["youtube_id"], video["sources"]) == ("youtube", "dQw4w9WgXcQ", [])


@pytest.mark.django_db
def test_the_trainer_sees_why_a_video_failed_or_was_turned_down(owner, listing):
    ProviderVideo.objects.create(
        provider=listing[0],
        title="Failed",
        status=ProviderVideo.Status.FAILED,
        failure_reason="That file is not a video we can play.",
    )
    ProviderVideo.objects.create(
        provider=listing[0],
        title="Turned down",
        status=ProviderVideo.Status.REJECTED,
        review_note="Film it in better light.",
    )

    failed, rejected = owner.get(reverse("trainer-videos")).json()["videos"]

    assert failed["failure_reason"] == "That file is not a video we can play."
    assert rejected["review_note"] == "Film it in better light."


@pytest.mark.django_db
def test_the_trainer_is_never_handed_a_private_file(owner, listing):
    ready_video(listing[0])

    [video] = owner.get(reverse("trainer-videos")).json()["videos"]

    assert video["sources"] == [] and video["poster"] is None
    assert "videos/review/" not in json.dumps(video)


@pytest.mark.django_db
def test_approved_videos_survive_the_media_pruner(listing, staff, settings):
    from core.management.commands.prune_media import referenced_names

    video = ready_video(listing[0])
    decide(video, ProviderVideo.Status.APPROVED, by=staff["lead"])

    names = referenced_names()

    assert {video.public_360.name, video.public_poster.name} <= names
