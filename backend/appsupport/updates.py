"""App updates served from this server, with no Expo or other cloud service.

The app (expo-updates) asks /api/app/updates/manifest/ when it opens. This
answers with the newest update published for the app's runtime version,
in the Expo Updates protocol (version 1): a multipart response whose
"manifest" part lists the JavaScript bundle and the assets, each with the
SHA-256 the app checks it against.

An update is the output of `npx expo export --platform android`, copied by
mobile/scripts/publish-update.sh to

    APP_UPDATES_ROOT/<runtime version>/<timestamp>/

with metadata.json, the bundle and assets/ inside, plus expoConfig.json
(the app's public config). The newest folder (by name) is the one served.
Rolling back is deleting or renaming that folder: the one before becomes
the newest again.
"""

import base64
import hashlib
import json
import mimetypes
import uuid
from datetime import UTC, datetime
from pathlib import Path

from django.conf import settings


class NoUpdate(Exception):
    pass


def root():
    return Path(settings.APP_UPDATES_ROOT)


def latest_dir(runtime_version):
    """The newest published update for this runtime version, or NoUpdate."""
    base = root() / _safe(runtime_version)
    if not base.is_dir():
        raise NoUpdate
    found = sorted((d for d in base.iterdir() if (d / "metadata.json").is_file()), reverse=True)
    if not found:
        raise NoUpdate
    return found[0]


def _safe(part):
    """A path segment that cannot climb out of the updates folder."""
    part = str(part or "")
    if not part or part in {".", ".."} or "/" in part or "\\" in part:
        raise NoUpdate
    return part


def _hashes(path):
    data = path.read_bytes()
    sha = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
    return sha, hashlib.md5(data, usedforsecurity=False).hexdigest()


def _asset(update, relative, ext, asset_url):
    path = update / relative
    sha, key = _hashes(path)
    content_type = (
        mimetypes.types_map.get(f".{ext}", "application/octet-stream")
        if ext
        else ("application/javascript")
    )
    return {
        "hash": sha,
        "key": key,
        "fileExtension": f".{ext}" if ext else ".bundle",
        "contentType": content_type,
        "url": asset_url(update, relative),
    }


def manifest(runtime_version, platform, asset_url):
    """The manifest for the newest update, as a dict. asset_url(update_dir,
    relative_path) gives the address the app downloads each file from."""
    update = latest_dir(runtime_version)
    metadata = json.loads((update / "metadata.json").read_text())
    files = (metadata.get("fileMetadata") or {}).get(platform)
    if not files:
        raise NoUpdate
    launch = _asset(update, files["bundle"], "", asset_url)
    launch["contentType"] = "application/javascript"
    assets = [
        _asset(update, a["path"], a.get("ext", ""), asset_url) for a in files.get("assets", [])
    ]

    # A stable id per update: the same folder always gives the same id, so the
    # app downloads each update once.
    digest = hashlib.sha256((update / "metadata.json").read_bytes()).hexdigest()
    update_id = str(uuid.UUID(digest[:32]))
    extra = {}
    config = update / "expoConfig.json"
    if config.is_file():
        extra["expoClient"] = json.loads(config.read_text())
    created = datetime.fromtimestamp((update / "metadata.json").stat().st_mtime, tz=UTC)
    return {
        "id": update_id,
        "createdAt": created.isoformat().replace("+00:00", "Z"),
        "runtimeVersion": runtime_version,
        "launchAsset": launch,
        "assets": assets,
        "metadata": {},
        "extra": extra,
    }


def asset_path(runtime_version, update_name, relative):
    """The file the app asked for, checked to be inside that update."""
    update = (root() / _safe(runtime_version) / _safe(update_name)).resolve()
    target = (update / relative).resolve()
    if not str(target).startswith(str(update) + "/") or not target.is_file():
        raise NoUpdate
    return target
