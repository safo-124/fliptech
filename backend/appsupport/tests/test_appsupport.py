"""Notices instead of SMS for people with the app, crash reports, and app
updates served from this server."""

import hashlib
import json
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone

from accounts.app_auth import issue_token
from accounts.models import AppToken, CustomerAccount
from appsupport import notify as notify_module
from appsupport.models import CrashReport, Notice
from appsupport.notify import notify

PHONE = "+233201112233"


@pytest.fixture
def buyer(db):
    user = get_user_model().objects.create_user("buyer-ama")
    return CustomerAccount.objects.create(user=user, phone=PHONE, phone_verified_at=timezone.now())


@pytest.fixture
def texts(monkeypatch):
    sent = []
    monkeypatch.setattr(notify_module, "send_sms", lambda to, msg: sent.append((to, msg)) or True)
    return sent


def app_signed_in(buyer, used=None):
    raw = issue_token(buyer.user, "Test phone")
    AppToken.objects.filter(user=buyer.user).update(last_used_at=used or timezone.now())
    return raw


@pytest.mark.django_db
def test_without_the_app_it_is_texted_and_kept(buyer, texts, settings):
    settings.PUBLIC_SITE_URL = "https://skills.example"
    brand = settings.BRAND_NAME
    notify(
        PHONE,
        f"{brand}: Ama sent you a message. Read and reply: https://skills.example/account/chats/4",
    )

    assert texts == [
        (
            PHONE,
            f"{brand}: Ama sent you a message. Read and reply: https://skills.example/account/chats/4",
        )
    ]
    notice = Notice.objects.get()
    assert (notice.phone, notice.link, notice.texted) == (PHONE, "/account/chats/4", True)
    # The link is the tap, not words in the notification.
    assert notice.body == "Ama sent you a message. Read and reply"


@pytest.mark.django_db
def test_with_the_app_checking_in_there_is_no_text(buyer, texts, settings):
    app_signed_in(buyer)
    notify(PHONE, "Fliiptech: your order is on its way.")
    assert texts == []
    assert Notice.objects.get().texted is False


@pytest.mark.django_db
def test_an_app_quiet_for_two_days_gets_a_text_again(buyer, texts):
    app_signed_in(buyer, used=timezone.now() - timedelta(days=3))
    notify(PHONE, "Fliiptech: back in stock.")
    assert len(texts) == 1


@pytest.mark.django_db
def test_money_is_always_texted(buyer, texts):
    app_signed_in(buyer)
    notify(PHONE, "Fliiptech: NEW PAID ORDER M-1.", sms="always", link="/sell/shop?tab=orders")
    assert len(texts) == 1
    assert Notice.objects.get().link == "/sell/shop?tab=orders"


@pytest.mark.django_db
def test_the_app_collects_its_notices_and_marks_them_read(client, buyer, texts):
    raw = app_signed_in(buyer)
    first = Notice.objects.create(phone=PHONE, title="Fliiptech", body="One")
    Notice.objects.create(phone="+233209999999", title="Fliiptech", body="Someone else's")
    second = Notice.objects.create(phone=PHONE, title="Fliiptech", body="Two")
    auth = {"HTTP_AUTHORIZATION": f"Bearer {raw}"}

    assert client.get(reverse("app-notices")).status_code in (401, 403)
    body = client.get(reverse("app-notices"), **auth).json()
    assert [n["body"] for n in body["results"]] == ["Two", "One"]
    assert body["unread"] == 2

    newer = client.get(reverse("app-notices"), {"after": first.pk}, **auth).json()
    assert [n["id"] for n in newer["results"]] == [second.pk]

    client.post(
        reverse("app-notices"), {"read": [first.pk]}, content_type="application/json", **auth
    )
    assert client.get(reverse("app-notices"), **auth).json()["unread"] == 1
    client.post(reverse("app-notices"), {"read": "all"}, content_type="application/json", **auth)
    assert client.get(reverse("app-notices"), **auth).json()["unread"] == 0


@pytest.mark.django_db
def test_a_crash_report_is_kept_for_staff(client, admin_client):
    made = client.post(
        reverse("app-crash"),
        {"message": "TypeError: x is undefined", "screen": "/product/4", "fatal": True},
        content_type="application/json",
    )
    assert made.status_code == 201
    assert CrashReport.objects.get().screen == "/product/4"
    assert client.post(reverse("app-crash"), {}, content_type="application/json").status_code == 400
    assert admin_client.get(reverse("admin:appsupport_crashreport_changelist")).status_code == 200


def publish(root, runtime, name, bundle=b"console.log(1)", asset=b"PNG"):
    folder = root / runtime / name
    (folder / "_expo/static/js/android").mkdir(parents=True)
    (folder / "assets").mkdir()
    (folder / "_expo/static/js/android/entry-abc.hbc").write_bytes(bundle)
    (folder / "assets/abc123").write_bytes(asset)
    (folder / "metadata.json").write_text(
        json.dumps(
            {
                "version": 0,
                "bundler": "metro",
                "fileMetadata": {
                    "android": {
                        "bundle": "_expo/static/js/android/entry-abc.hbc",
                        "assets": [{"path": "assets/abc123", "ext": "png"}],
                    }
                },
            }
        )
    )
    (folder / "expoConfig.json").write_text(json.dumps({"name": "Fliiptech"}))
    return folder


def manifest_of(response):
    text = response.content.decode()
    return json.loads(text.split("\r\n\r\n", 1)[1].rsplit("\r\n--", 1)[0])


@pytest.mark.django_db
def test_updates_serve_the_newest_published_one(client, tmp_path, settings):
    settings.APP_UPDATES_ROOT = str(tmp_path)
    settings.PUBLIC_SITE_URL = "https://skills.example"
    headers = {"HTTP_EXPO_PLATFORM": "android", "HTTP_EXPO_RUNTIME_VERSION": "0.1.0"}

    assert client.get(reverse("app-update-manifest"), **headers).status_code == 204

    publish(tmp_path, "0.1.0", "20261101-0900")
    publish(tmp_path, "0.1.0", "20261109-0800", bundle=b"console.log(2)")
    response = client.get(reverse("app-update-manifest"), **headers)
    assert response.status_code == 200
    assert response["expo-protocol-version"] == "1"
    manifest = manifest_of(response)
    launch = manifest["launchAsset"]
    assert launch["url"].startswith("https://skills.example/api/app/updates/0.1.0/20261109-0800/")
    assert manifest["extra"]["expoClient"] == {"name": "Fliiptech"}
    assert manifest["assets"][0]["contentType"] == "image/png"

    # The bundle is served, and matches the hash the app checks it against.
    path = launch["url"].replace("https://skills.example", "")
    served = b"".join(client.get(path).streaming_content)
    assert served == b"console.log(2)"
    assert hashlib.md5(served, usedforsecurity=False).hexdigest() == launch["key"]

    # Another runtime version has nothing; nothing outside the folder is served.
    other = {**headers, "HTTP_EXPO_RUNTIME_VERSION": "0.2.0"}
    assert client.get(reverse("app-update-manifest"), **other).status_code == 204
    assert client.get("/api/app/updates/0.1.0/20261109-0800/../../secret").status_code == 404
