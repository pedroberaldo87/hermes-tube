"""Security tests for imports: untrusted backup files and extension batches.

A backup file (plugin JSON or MyTube) is untrusted input. Its channel ``url`` ends up in "Open on
YouTube" (handed to the system's URL opener) and its ``thumb`` is loaded as an image by the
Desktop and the extension: neither may point anywhere but YouTube.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeSettings

from tube_pkg import wiring
from tube_pkg.api import data as api_data
from tube_pkg.core import importers as IM
from tube_pkg.core import types as T
from tube_pkg.ext import sync as ext_sync

UC1 = "UCsecurity00000000000001"
UC2 = "UCsecurity00000000000002"
UC3 = "UCsecurity00000000000003"
GOOD_THUMB = "https://yt3.googleusercontent.com/ytc/abc=s176-c-k-c0x00ffffff-no-rj"

BAD_URLS = [
    "file:///Applications/Calculator.app",
    "javascript:alert(1)",
    "https://evil.example/@handle",
    "http://127.0.0.1:9119/api",
    "smb://attacker/share",
    "https://www.youtube.com.evil.example/@x",
]
BAD_THUMBS = [
    "https://tracker.example/pixel.gif",
    "http://yt3.googleusercontent.com/x",  # not https
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://googleusercontent.com.evil.example/x",
    "data:image/svg+xml,<svg onload=alert(1)>",
]


# ------------------------------------------------------------------ minimal collaborators


class _Db:
    @contextlib.contextmanager
    def transaction(self) -> Iterator[None]:
        yield

    def query(self, sql: str, params: Any = ()) -> list[Any]:
        return []


class _ChangeLog:
    @contextlib.contextmanager
    def group(self, label: str) -> Iterator[None]:
        yield

    def record(self, *args: Any, **kwargs: Any) -> None:
        return None


class _Channels:
    def __init__(self) -> None:
        self.items: list[T.ChannelIn] = []

    def list(self, flt: Any) -> list[Any]:
        return []

    def upsert_many(self, items: Any, **kwargs: Any) -> Any:
        self.items.extend(items)
        return T.UpsertReport(inserted=tuple(str(i.channel_id) for i in items))

    def batch(self, *args: Any, **kwargs: Any) -> None:
        return None

    def update(self, *args: Any, **kwargs: Any) -> None:
        return None


class _Tabs:
    def list(self) -> list[Any]:
        return []


def _ops() -> tuple[IM.DataOps, _Channels]:
    channels = _Channels()
    ops = IM.DataOps(
        db=_Db(),  # type: ignore[arg-type]
        settings=FakeSettings(),
        channels=channels,  # type: ignore[arg-type]
        taxonomy=None,  # type: ignore[arg-type]
        tabs=_Tabs(),  # type: ignore[arg-type]
        video_state=None,  # type: ignore[arg-type]
        demo=None,  # type: ignore[arg-type]
        changelog=_ChangeLog(),  # type: ignore[arg-type]
    )
    return ops, channels


def _by_id(channels: _Channels) -> dict[str, T.ChannelIn]:
    return {str(c.channel_id): c for c in channels.items}


# ------------------------------------------------------------------ helpers


@pytest.mark.parametrize("url", BAD_URLS)
def test_safe_channel_url_drops_non_youtube(url):
    assert IM.safe_channel_url(url) is None


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.youtube.com/@veritasium", "https://www.youtube.com/@veritasium"),
        (f"https://www.youtube.com/channel/{UC1}", f"https://www.youtube.com/channel/{UC1}"),
        ("https://m.youtube.com/c/kurzgesagt", "https://m.youtube.com/c/kurzgesagt"),
        ("@numberphile", "https://www.youtube.com/@numberphile"),
        (None, None),
        ("", None),
    ],
)
def test_safe_channel_url_keeps_youtube(url, expected):
    assert IM.safe_channel_url(url) == expected


@pytest.mark.parametrize("thumb", BAD_THUMBS)
def test_safe_thumb_url_drops_foreign_hosts(thumb):
    assert IM.safe_thumb_url(thumb) is None


@pytest.mark.parametrize(
    "thumb",
    [
        GOOD_THUMB,
        "https://yt3.ggpht.com/abc=s88",
        "https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg",
    ],
)
def test_safe_thumb_url_keeps_youtube_images(thumb):
    assert IM.safe_thumb_url(thumb) == thumb


# ------------------------------------------------------------------ imports


def test_plugin_json_import_strips_foreign_urls_and_thumbs():
    ops, channels = _ops()
    ops.import_json(
        {
            "schema_version": 1,
            "channels": [
                {"id": UC1, "title": "a", "url": BAD_URLS[0], "thumb": BAD_THUMBS[0]},
                {"id": UC2, "title": "b", "url": "https://www.youtube.com/@b", "thumb": GOOD_THUMB},
            ],
        }
    )
    got = _by_id(channels)
    assert got[UC1].url is None and got[UC1].thumb is None
    assert got[UC2].url == "https://www.youtube.com/@b" and got[UC2].thumb == GOOD_THUMB


def test_mytube_import_strips_foreign_urls_and_thumbs():
    ops, channels = _ops()
    ops.import_mytube(
        {
            "organizables": [
                {
                    "type": "channel",
                    "youtubeId": UC1,
                    "name": "a",
                    "url": BAD_URLS[2],
                    "thumbnailUrl": BAD_THUMBS[2],
                },
                {
                    "type": "channel",
                    "youtubeId": UC3,
                    "name": "c",
                    "url": f"https://www.youtube.com/channel/{UC3}",
                    "thumbnailUrl": GOOD_THUMB,
                },
            ],
            "folders": [],
            "tags": [],
        }
    )
    got = _by_id(channels)
    assert got[UC1].url is None and got[UC1].thumb is None
    assert got[UC3].url == f"https://www.youtube.com/channel/{UC3}"
    assert got[UC3].thumb == GOOD_THUMB


def test_extension_batch_strips_foreign_urls_and_thumbs():
    seen: list[T.SubscriptionBatch] = []

    class _Sync:
        def ingest_subscriptions(self, device_id: str, batch: T.SubscriptionBatch) -> Any:
            seen.append(batch)
            return {"ok": True}

    device = T.Device(id="dev-1", name="x", created_at=0)
    env = ext_sync.sync_subscriptions(
        device,
        {
            "signal": "partial",
            "channels": [
                {"title": "a", "channel_id": UC1, "url": BAD_URLS[1], "thumb": BAD_THUMBS[0]},
                {
                    "title": "b",
                    "channel_id": UC2,
                    "url": "https://www.youtube.com/@b",
                    "thumb": GOOD_THUMB,
                },
            ],
        },
        {},
        sync=_Sync(),  # type: ignore[arg-type]
    )
    assert env["ok"] is True
    a, b = seen[0].channels
    assert a.url is None and a.thumb is None
    assert b.url == "https://www.youtube.com/@b" and b.thumb == GOOD_THUMB


# ------------------------------------------------------------------ import by path


class _Data:
    def __init__(self) -> None:
        self.got: list[Mapping[str, Any]] = []

    def import_json(self, data: Mapping[str, Any]) -> T.DataReport:
        self.got.append(data)
        return T.DataReport()


def test_import_by_path_only_reads_json_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data = _Data()
    monkeypatch.setattr(wiring, "get_data", lambda: data)
    secret = tmp_path / "id_ed25519"
    secret.write_text(json.dumps({"schema_version": 1}), encoding="utf-8")
    env = api_data.post_import({"path": str(secret)}, {})
    assert env["ok"] is False and env["error"]["code"] == "invalid"
    assert data.got == []

    ok_file = tmp_path / "backup.JSON"
    ok_file.write_text(json.dumps({"schema_version": 1}), encoding="utf-8")
    env = api_data.post_import({"path": str(ok_file)}, {})
    assert env["ok"] is True and len(data.got) == 1


def test_import_by_path_error_does_not_echo_file_content(tmp_path: Path, monkeypatch):
    data = _Data()
    monkeypatch.setattr(wiring, "get_data", lambda: data)
    f = tmp_path / "notes.json"
    f.write_text("SECRET-VALUE-123 not json", encoding="utf-8")
    env = api_data.post_import({"path": str(f)}, {})
    assert env["ok"] is False
    assert "SECRET-VALUE-123" not in json.dumps(env)
