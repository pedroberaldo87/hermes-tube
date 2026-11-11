"""Routine covers: ``MEDIA:`` line after the text, download rules, failures that change nothing.

Everything runs in-process against a seeded profile database with a fake HTTP client (no network).
The stdout contract is the one the Hermes cron reads: text first, then one ``MEDIA:<path>`` line.
"""

from __future__ import annotations

import importlib
import os
import re
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from test_routines import _db_file, _seed

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import types as T

cover = importlib.import_module("tube_pkg.routines.cover")
runner = importlib.import_module("tube_pkg.routines.runner")
compose = importlib.import_module("tube_pkg.routines.compose")

JPEG = b"\xff\xd8\xff\xe0" + b"j" * 5000
VID = "abcdefghijk"
MEDIA_RE = re.compile(r"^MEDIA:(/.+\.jpg)$")


class FakeHttp:
    """``HttpClient.get`` with canned answers per file name; records every URL."""

    def __init__(self, answers: dict[str, Any] | None = None, default: Any = (200, JPEG)) -> None:
        self.answers = answers or {}
        self.default = default
        self.urls: list[str] = []

    def get(self, url: str, **kwargs: Any) -> Any:
        self.urls.append(url)
        answer = self.answers.get(url.rsplit("/", 1)[-1], self.default)
        if isinstance(answer, BaseException):
            raise answer
        status, body = answer
        return T.HttpResponse(status=status, url=url, content=body)


@pytest.fixture(autouse=True)
def _online(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(cover.DISABLE_ENV, raising=False)


def _home(tmp_path: Path, name: str = "p1") -> Path:
    home = (tmp_path / "profiles" / name).resolve()
    home.mkdir(parents=True)
    return home


def _resolved(home: Path) -> Any:
    return SimpleNamespace(home=home, db_path=_db_file(home))


def _run(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    home: Path,
    key: str,
    http: Any,
) -> str:
    original = runner._open_env

    def open_env(*args: Any) -> Any:
        env = original(*args)
        env.graph._items["http"] = http
        return env

    monkeypatch.setattr(runner, "_open_env", open_env)
    capsys.readouterr()
    assert runner.run(key, _resolved(home)) == 0
    return capsys.readouterr().out


def _first_video_id(out: str) -> str:
    return re.search(r"https://youtu\.be/([A-Za-z0-9_-]{11})", out).group(1)  # type: ignore[union-attr]


# =========================================================================== favoritos


def test_favoritos_fallback_prints_each_card_then_the_cover_lines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """No chat target (no jobs.json): everything goes to stdout, texts first, MEDIA lines last."""
    home = _home(tmp_path)
    _seed(home)
    http = FakeHttp()
    out = _run(monkeypatch, capsys, home, "favoritos", http)
    lines = out.splitlines()
    media = [x for x in lines if x.startswith("MEDIA:")]
    assert lines[-len(media) :] == media and all(MEDIA_RE.match(x) for x in media)
    ids = re.findall(r"https://youtu\.be/([A-Za-z0-9_-]{11})", out)
    assert len(ids) == len(media) >= 1
    folder = home / "plugin-data" / PLUGIN_ID / "covers"
    assert [Path(x[6:]) for x in media] == [folder / f"{i}.jpg" for i in ids]
    assert all(p.read_bytes() == JPEG for p in folder.glob("*.jpg"))
    assert http.urls == [f"https://i.ytimg.com/vi/{i}/maxresdefault.jpg" for i in ids]
    assert lines[0].startswith("\u2b50 **New from ") and lines[0].endswith("**")
    assert all(f"\u25b6\ufe0f https://youtu.be/{i}" in lines for i in ids)


def test_favoritos_stdout_without_covers_is_the_same_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path, "a")
    _seed(home)
    with_cover = _run(monkeypatch, capsys, home, "favoritos", FakeHttp())
    home2 = _home(tmp_path, "b")
    _seed(home2)
    monkeypatch.setenv(cover.DISABLE_ENV, "1")
    plain = _run(monkeypatch, capsys, home2, "favoritos", FakeHttp())
    assert "MEDIA:" not in plain
    assert with_cover.startswith(plain)
    assert all(x.startswith("MEDIA:") for x in with_cover[len(plain) :].splitlines())


FAILURES = {
    "all 404": FakeHttp(default=(404, b"x" * 3000)),
    "server error": FakeHttp(default=(500, JPEG)),
    "network error": FakeHttp(default=OSError("no network")),
    "unknown exception": FakeHttp(default=RuntimeError("boom")),
    "not a jpeg": FakeHttp(default=(200, b"\x89PNG" + b"p" * 5000)),
    "too small": FakeHttp(default=(200, b"\xff\xd8" + b"s" * 100)),
    "too big": FakeHttp(default=(200, b"\xff\xd8" + b"b" * (2 * 1024 * 1024))),
}


@pytest.mark.parametrize("mode", list(FAILURES))
def test_failure_leaves_stdout_byte_identical(
    mode: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv(cover.DISABLE_ENV, "1")
    base_home = _home(tmp_path, "base")
    _seed(base_home)
    baseline = _run(monkeypatch, capsys, base_home, "favoritos", FakeHttp())
    monkeypatch.delenv(cover.DISABLE_ENV)
    home = _home(tmp_path, "fail")
    _seed(home)
    out = _run(monkeypatch, capsys, home, "favoritos", FAILURES[mode])
    assert out == baseline and out.strip() and "MEDIA:" not in out
    assert not list((home / "plugin-data" / PLUGIN_ID).glob("covers/*"))


def test_disk_error_leaves_stdout_identical(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(cover.DISABLE_ENV, "1")
    base_home = _home(tmp_path, "base")
    _seed(base_home)
    baseline = _run(monkeypatch, capsys, base_home, "favoritos", FakeHttp())
    monkeypatch.delenv(cover.DISABLE_ENV)
    home = _home(tmp_path, "disk")
    _seed(home)
    (home / "plugin-data" / PLUGIN_ID / "covers").write_text("a file where the folder should be")
    out = _run(monkeypatch, capsys, home, "favoritos", FakeHttp())
    assert out == baseline and "MEDIA:" not in out


def test_silence_prints_no_media(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    _run(monkeypatch, capsys, home, "favoritos", FakeHttp())
    http = FakeHttp()
    assert _run(monkeypatch, capsys, home, "favoritos", http) == ""
    assert http.urls == []


# =========================================================================== bom_dia


def test_bom_dia_prints_text_only_and_never_fetches_a_cover(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    http = FakeHttp()
    out = _run(monkeypatch, capsys, home, "bom-dia", http)
    assert out.strip() and "MEDIA:" not in out and http.urls == []
    assert not (home / "plugin-data" / PLUGIN_ID / "covers").exists()


def test_bom_dia_failure_leaves_stdout_identical(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(cover.DISABLE_ENV, "1")
    a = _home(tmp_path, "a")
    _seed(a)
    baseline = _run(monkeypatch, capsys, a, "bom-dia", FakeHttp())
    monkeypatch.delenv(cover.DISABLE_ENV)
    b = _home(tmp_path, "b")
    _seed(b)
    assert _run(monkeypatch, capsys, b, "bom-dia", FAILURES["all 404"]) == baseline


# =========================================================================== runner contract


def _fake_composer(monkeypatch: pytest.MonkeyPatch, outcome: Any) -> None:
    monkeypatch.setitem(compose.COMPOSERS, "favoritos", lambda env: outcome)


def test_runner_prints_media_lines_after_the_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    img = home / "one.jpg"
    img.write_bytes(JPEG)
    _fake_composer(monkeypatch, runner.Outcome("hello\nworld", media=(str(img),)))
    assert (
        _run(monkeypatch, capsys, home, "favoritos", FakeHttp()) == f"hello\nworld\nMEDIA:{img}\n"
    )


def test_runner_never_prints_media_without_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    img = home / "one.jpg"
    img.write_bytes(JPEG)
    for text in (None, "", "   "):
        _fake_composer(monkeypatch, runner.Outcome(text, media=(str(img),)))
        assert _run(monkeypatch, capsys, home, "favoritos", FakeHttp()) == ""


def test_runner_skips_unsafe_media_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    img = home / "ok.jpg"
    img.write_bytes(JPEG)
    bad = ("relative.jpg", str(home / "missing.jpg"), f"{img}\nMEDIA:/etc/passwd", "")
    _fake_composer(monkeypatch, runner.Outcome("hi", media=(*bad, str(img))))
    assert _run(monkeypatch, capsys, home, "favoritos", FakeHttp()) == f"hi\nMEDIA:{img}\n"


# =========================================================================== cover.fetch


def test_fallback_order_first_404_second_ok(tmp_path: Path) -> None:
    http = FakeHttp({"maxresdefault.jpg": (404, b"grey" * 800), "hq720.jpg": (200, JPEG)})
    path = cover.fetch(http, tmp_path, VID)
    assert [u.rsplit("/", 1)[-1] for u in http.urls] == ["maxresdefault.jpg", "hq720.jpg"]
    assert all(u.startswith(f"https://i.ytimg.com/vi/{VID}/") for u in http.urls)
    assert path == str(cover.covers_dir(tmp_path) / f"{VID}.jpg")
    assert Path(path).read_bytes() == JPEG


def test_third_size_is_the_last_resort(tmp_path: Path) -> None:
    http = FakeHttp(
        {"maxresdefault.jpg": (404, b""), "hq720.jpg": (404, b""), "mqdefault.jpg": (200, JPEG)}
    )
    assert cover.fetch(http, tmp_path, VID)
    assert len(http.urls) == 3 and http.urls[-1].endswith("/mqdefault.jpg")


def test_existing_file_is_reused_and_refreshed(tmp_path: Path) -> None:
    http = FakeHttp()
    first = cover.fetch(http, tmp_path, VID)
    old = time.time() - 86400
    os.utime(first, (old, old))
    second = cover.fetch(http, tmp_path, VID)
    assert second == first and len(http.urls) == 1
    assert time.time() - Path(second).stat().st_mtime < 60  # fresh for the strict media policy


@pytest.mark.parametrize(
    "bad",
    ["", "short", "a" * 12, "../../etc/pa", "abc/defghij", "abc defghij", "abcdefghij\n", None, 7],
)
def test_invalid_video_id_never_reaches_the_network(tmp_path: Path, bad: object) -> None:
    http = FakeHttp()
    assert cover.fetch(http, tmp_path, bad) is None
    assert http.urls == [] and not cover.covers_dir(tmp_path).exists()


def test_prune_keeps_the_newest_20(tmp_path: Path) -> None:
    folder = cover.covers_dir(tmp_path)
    folder.mkdir(parents=True)
    now = time.time()
    for i in range(25):
        f = folder / f"old{i:08d}x.jpg"
        f.write_bytes(JPEG)
        os.utime(f, (now - 1000 + i, now - 1000 + i))
    path = cover.fetch(FakeHttp(), tmp_path, VID)
    names = sorted(p.name for p in folder.glob("*.jpg"))
    assert len(names) == cover.KEEP and Path(path).name in names
    assert "old00000000x.jpg" not in names and "old00000024x.jpg" in names
    assert not list(folder.glob("*.part"))


def test_total_budget_stops_further_tries(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ticks = iter([0.0, 0.0, 5.0, 9.0, 9.0, 9.0])
    monkeypatch.setattr(cover.time, "monotonic", lambda: next(ticks))
    http = FakeHttp(default=(404, b""))
    assert cover.fetch(http, tmp_path, VID) is None
    assert len(http.urls) == 2  # the third try would start after the 8 s budget
