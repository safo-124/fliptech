"""Teaching videos: the link a trainer pastes, the review, and what the public sees."""

import pytest
from django.contrib.auth.models import Group
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from geography.models import Area, Region
from providers.models import Provider, ProviderMembership, ProviderVideo
from providers.trainer_auth import account_for_verified_phone
from providers.videos import MAX_VIDEOS_PER_PROVIDER, parse_youtube_id

ACCRA = Point(-0.1870, 5.6037, srid=4326)
VIDEO = "dQw4w9WgXcQ"
LINK = f"https://youtu.be/{VIDEO}"


# --------------------------------------------------------------------------
# Reading the link


@pytest.mark.parametrize(
    "link",
    [
        f"https://www.youtube.com/watch?v={VIDEO}",
        f"https://youtube.com/watch?v={VIDEO}&t=42s",
        f"https://m.youtube.com/watch?feature=share&v={VIDEO}",
        f"https://youtu.be/{VIDEO}",
        f"https://youtu.be/{VIDEO}?si=Hk3l9xPq",
        f"youtu.be/{VIDEO}",
        f"https://www.youtube.com/shorts/{VIDEO}",
        f"https://youtube.com/shorts/{VIDEO}?feature=share",
        f"https://www.youtube.com/embed/{VIDEO}",
        f"https://www.youtube-nocookie.com/embed/{VIDEO}",
        f"https://www.youtube.com/live/{VIDEO}",
        f"  https://youtu.be/{VIDEO}\n",
    ],
)
def test_every_way_a_phone_shares_a_video_is_read(link):
    assert parse_youtube_id(link) == VIDEO


@pytest.mark.parametrize(
    "link",
    [
        "",
        VIDEO,
        "https://vimeo.com/123456789",
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs",
        "https://www.youtube.com/@somebodyschannel",
        "https://youtu.be/tooshort",
        f"https://example.com/watch?v={VIDEO}",
        f"https://youtube.com.example.com/watch?v={VIDEO}",
        f"ftp://youtube.com/watch?v={VIDEO}",
        "javascript:alert(1)",
        f"https://www.youtube.com/watch?v={VIDEO}%22onerror%3Dalert(1)",
        "https://www.youtube.com/watch?v=<script>x</script>",
    ],
)
def test_anything_that_is_not_one_youtube_video_is_refused(link):
    assert parse_youtube_id(link) is None


# --------------------------------------------------------------------------
# The trainer's side


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


def add(client, link=LINK, title="Cornrows in five minutes", **extra):
    return client.post(
        reverse("trainer-videos"),
        {"url": link, "title": title, **extra},
        content_type="application/json",
    )


def public_videos(client, provider):
    response = client.get(reverse("provider-by-slug", args=[provider.area.slug, provider.slug]))
    assert response.status_code == 200
    return response.json()["videos"]


@pytest.mark.django_db
def test_a_video_waits_for_review_and_the_listing_stays_live(owner, listing):
    provider, _ = listing

    response = add(owner)

    assert response.status_code == 201, response.content
    assert response.json()["youtube_id"] == VIDEO
    assert response.json()["status"] == ProviderVideo.Status.PENDING
    provider.refresh_from_db()
    assert provider.status == Provider.Status.PUBLISHED
    assert public_videos(owner, provider) == []


@pytest.mark.django_db
def test_only_approved_videos_are_public_and_only_their_id_and_title(owner, listing):
    provider, _ = listing
    add(owner)
    add(owner, link="https://youtu.be/aaaaaaaaaaa", title="Turned down")
    ProviderVideo.objects.filter(youtube_id=VIDEO).update(status=ProviderVideo.Status.APPROVED)
    ProviderVideo.objects.filter(youtube_id="aaaaaaaaaaa").update(
        status=ProviderVideo.Status.REJECTED, review_note="Someone else's video."
    )

    videos = public_videos(owner, provider)

    assert [video["youtube_id"] for video in videos] == [VIDEO]
    assert set(videos[0]) == {"id", "youtube_id", "title"}


@pytest.mark.django_db
def test_the_trainer_sees_each_video_with_its_review(owner, listing):
    add(owner)
    ProviderVideo.objects.update(
        status=ProviderVideo.Status.REJECTED, review_note="Film it in better light."
    )

    [video] = owner.get(reverse("trainer-videos")).json()

    assert video["status"] == ProviderVideo.Status.REJECTED
    assert video["review_note"] == "Film it in better light."


@pytest.mark.django_db
@pytest.mark.parametrize(
    "link",
    ["https://vimeo.com/123456789", "https://www.youtube.com/playlist?list=PL1234567890"],
)
def test_a_link_that_is_not_a_youtube_video_says_so_on_the_link(owner, link):
    response = add(owner, link=link)

    assert response.status_code == 400
    assert "YouTube" in response.json()["url"][0]
    assert not ProviderVideo.objects.exists()


@pytest.mark.django_db
def test_the_same_video_cannot_be_added_twice(owner):
    add(owner)
    response = add(owner, link=f"https://www.youtube.com/watch?v={VIDEO}")

    assert response.status_code == 400
    assert ProviderVideo.objects.count() == 1


@pytest.mark.django_db
def test_there_is_a_limit(owner):
    for index in range(MAX_VIDEOS_PER_PROVIDER):
        assert add(owner, link=f"https://youtu.be/video{index:06d}").status_code == 201

    response = add(owner, link="https://youtu.be/onetoomanyx")

    assert response.status_code == 400
    assert ProviderVideo.objects.count() == MAX_VIDEOS_PER_PROVIDER


@pytest.mark.django_db
def test_a_trainer_cannot_approve_their_own_video(owner):
    response = add(owner, status="approved")

    assert response.status_code == 400
    assert not ProviderVideo.objects.exists()


@pytest.mark.django_db
def test_a_trainer_removes_their_own_video_and_nobody_elses(client, owner, listing):
    add(owner)
    mine = ProviderVideo.objects.get()

    other_area = listing[0].area
    other = Provider.objects.create(
        name="Another Studio",
        slug="another-studio",
        area=other_area,
        location=ACCRA,
        contact_phone="+233240000602",
        status=Provider.Status.PUBLISHED,
    )
    theirs = ProviderVideo.objects.create(provider=other, youtube_id="bbbbbbbbbbb", title="Theirs")

    assert owner.delete(reverse("trainer-video-delete", args=[theirs.pk])).status_code == 404
    assert owner.delete(reverse("trainer-video-delete", args=[mine.pk])).status_code == 204
    assert list(ProviderVideo.objects.all()) == [theirs]


@pytest.mark.django_db
def test_a_suspended_listing_takes_no_new_videos_but_can_lose_one(owner, listing):
    provider, _ = listing
    add(owner)
    Provider.objects.filter(pk=provider.pk).update(status=Provider.Status.SUSPENDED)

    assert add(owner, link="https://youtu.be/ccccccccccc").status_code == 409
    video = ProviderVideo.objects.get()
    assert owner.delete(reverse("trainer-video-delete", args=[video.pk])).status_code == 204


@pytest.mark.django_db
def test_videos_need_a_listing_and_a_trainer(client, db):
    assert add(client).status_code in (401, 403)

    lone = account_for_verified_phone(phone="+233240000603", verified_at=timezone.now())
    client.force_login(lone.user)
    assert add(client).status_code == 409
    assert client.get(reverse("trainer-videos")).json() == []


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
def test_the_operations_lead_approves_and_a_field_officer_cannot(client, staff, listing):
    video = ProviderVideo.objects.create(provider=listing[0], youtube_id=VIDEO, title="Cornrows")

    client.force_login(staff["officer"])
    approve(client, video)
    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.PENDING

    client.force_login(staff["lead"])
    approve(client, video)
    video.refresh_from_db()
    assert video.status == ProviderVideo.Status.APPROVED
    assert video.reviewed_by == staff["lead"]
    assert public_videos(client, listing[0])[0]["youtube_id"] == VIDEO


@pytest.mark.django_db
def test_turning_a_video_down_needs_a_note_the_workshop_can_act_on(client, staff, listing):
    video = ProviderVideo.objects.create(provider=listing[0], youtube_id=VIDEO, title="Cornrows")
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
def test_a_field_officer_adds_a_video_for_a_workshop_but_cannot_approve_it(client, staff, listing):
    client.force_login(staff["officer"])
    add_url = reverse("admin:providers_providervideo_add")
    assert 'name="status"' not in client.get(add_url).content.decode()

    client.post(add_url, {"provider": listing[0].pk, "link": LINK, "title": "Cornrows"})

    video = ProviderVideo.objects.get()
    assert (video.youtube_id, video.status, video.added_by) == (
        VIDEO,
        ProviderVideo.Status.PENDING,
        staff["officer"],
    )


@pytest.mark.django_db
def test_videos_waiting_show_in_the_sidebar_for_whoever_can_approve_them(client, staff, listing):
    cache.clear()
    ProviderVideo.objects.create(provider=listing[0], youtube_id=VIDEO, title="Cornrows")

    client.force_login(staff["lead"])
    assert "Videos to review" in client.get(reverse("admin:index")).content.decode()

    client.force_login(staff["officer"])
    assert "Videos to review" not in client.get(reverse("admin:index")).content.decode()
