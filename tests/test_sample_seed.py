"""Development command ``scripts/dev/sample-seed``: the sample catalog in a plugin database.

``load`` puts ``docs/sample-data/catalog.json`` into the plugin database of a Hermes profile through
the plugin's services, ``clear`` takes out exactly what ``load`` put there and ``status`` reports.
These tests run the plugin's routes over the loaded database (with a fake YouTube client: no
network) and check that only catalog data comes out, that the refresher does not spoil the scene
(synthetic ids: every RSS answers 404), and that ``clear`` brings the table counts back.

The command and the catalog are development material outside the public cut: without them the
module is skipped.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import sqlite3
import stat
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeSettings, FakeYouTube

from tube_pkg import wiring
from tube_pkg._id import PLUGIN_ID
from tube_pkg.api import channels as api_channels
from tube_pkg.api import cleanup as api_cleanup
from tube_pkg.api import feed as api_feed
from tube_pkg.api import playlists as api_playlists
from tube_pkg.api import status as api_status
from tube_pkg.api import tabs as api_tabs
from tube_pkg.api import themes as api_themes
from tube_pkg.core import db as core_db
from tube_pkg.core import playlists as core_playlists
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "dev" / "sample-seed"
CATALOG = ROOT / "docs" / "sample-data" / "catalog.json"

pytestmark = pytest.mark.skipif(
    not (SCRIPT.is_file() and CATALOG.is_file()),
    reason="development command or sample catalog not in this checkout",
)

HOUR = 3600
DAY = 86_400
REAL_ID = "UCsBjURrPoezykLs9EqgamOA"  # any non-synthetic id: stands for a real subscription
USER_LINK_ID = "UCuserlinkxxxxxxxxxxxxxx"


def _load_script() -> Any:
    name = "_sample_seed_cmd"
    if name in sys.modules:
        return sys.modules[name]
    loader = importlib.machinery.SourceFileLoader(name, str(SCRIPT))
    spec = importlib.util.spec_from_loader(name, loader)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def seed() -> Any:
    return _load_script()


@pytest.fixture(scope="module")
def catalog() -> dict[str, Any]:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def db_file(home: Path) -> Path:
    return home / "plugin-data" / PLUGIN_ID / "tube.db"


def counts(path: Path) -> dict[str, int]:
    conn = sqlite3.connect(path)
    try:
        names = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {n: conn.execute(f"SELECT COUNT(*) FROM {n}").fetchone()[0] for n in sorted(names)}
    finally:
        conn.close()


def meta_rows(path: Path) -> dict[str, str]:
    conn = sqlite3.connect(path)
    try:
        return dict(conn.execute("SELECT key, value FROM meta").fetchall())
    finally:
        conn.close()


def init_plugin_db(home: Path, *, with_user_data: bool = False) -> Path:
    """A database as the plugin leaves it after its first run (built-in tabs), optionally with
    a bit of the person's own data that ``load``/``clear`` must not touch."""
    path = db_file(home)
    db = core_db.build(path=str(path))
    try:
        g = wiring.Graph(db=db, settings=FakeSettings(), ctx=None)
        g.get("tabs").ensure_builtin()
        if with_user_data:
            folder = g.get("taxonomy").create_folder("Reading list", actor=T.Actor.user)
            g.get("channels").upsert_many(
                [T.ChannelIn(title="My own channel", channel_id=USER_LINK_ID, folder_id=folder.id)],
                source=T.ChannelSource.link,
                relation=T.Relation.followed,
                actor=T.Actor.user,
            )
            g.get("video_store").upsert(
                [
                    T.VideoIn(
                        id="userVideo01",
                        channel_id=USER_LINK_ID,
                        title="A video of my own",
                        published_at=int(time.time()) - DAY,
                    )
                ],
                T.VideoOrigin.rss,
            )
    finally:
        db.close()
    return path


class SampleYouTube(FakeYouTube):
    """What YouTube answers for synthetic ids: the RSS is 404 and the channel page says the
    channel does not exist."""

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        self.calls.append(("fetch_channel_rss", channel_id))
        raise T.YouTubeError("RSS: not found (HTTP 404)", status=404)

    def fetch_channel_uploads(self, channel_id: str) -> T.RssFeed:
        self.calls.append(("fetch_channel_uploads", channel_id))
        raise T.YouTubeError("channel page: not found (HTTP 404)", status=404, channel_missing=True)


@pytest.fixture
def plugin_on(monkeypatch: pytest.MonkeyPatch, wire: Any) -> Iterator[Any]:
    """Points the plugin (``wiring``) at a database file, with a fake YouTube client and no
    extension server; returns a function ``on(path) -> SampleYouTube``."""
    yt = SampleYouTube()
    pointed: list[Path] = []

    def on(path: Path) -> SampleYouTube:
        monkeypatch.setenv("TUBE_DB_PATH", str(path))
        wiring.reset()
        api_status.reset()
        wire.set("youtube", yt)
        monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: None)
        pointed.append(path)
        return yt

    yield on
    if pointed:
        wiring.shutdown()
    wiring.reset()
    api_status.reset()


def ok(env: dict[str, Any]) -> Any:
    assert env.get("ok") is True, env
    return env["data"]


def catalog_texts(catalog: dict[str, Any]) -> dict[str, set[str]]:
    topic = catalog["topic"]
    return {
        "channels": {c["title"] for c in catalog["channels"]},
        "topic_channels": {c["title"] for c in topic["channels"]},
        "folders": {f["name"] for f in catalog["folders"]},
        "videos": {v["title"] for v in catalog["videos"]},
        "topic_videos": {v["title"] for v in topic["videos"]},
        "reasons": {v["reason"] for v in topic["videos"]},
        "topic": {topic["name"]},
    }


# =========================================================================== load + routes


def test_after_load_the_routes_show_only_catalog_data(
    tmp_path: Path, seed: Any, catalog: dict[str, Any], plugin_on: Any
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    report = seed.load(home)
    assert report["channels"] == len(catalog["channels"])
    assert report["videos"] == len(catalog["videos"]) + len(catalog["topic"]["videos"])
    texts = catalog_texts(catalog)

    yt = plugin_on(path)

    # /status: counts from the catalog, no RSS outage, the overdue check did not start a cycle
    status = ok(api_status.get_status(None, {}))
    assert status["channels_total"] == len(catalog["channels"])
    assert status["subscribed_total"] == 0
    assert status["rss_down_since"] is None
    assert status["refresh_running"] is False
    assert status["new_total"] > 0
    assert yt.calls == [], "loading must not trigger any YouTube request"
    fav_titles = {f["title"] for f in status["fav_new"]}
    assert fav_titles <= texts["channels"]

    # /tabs: the two built-in tabs + the topic tab, and nothing else
    tabs = ok(api_tabs.get_tabs(None, {}))["items"]
    by_id = {t["id"]: t for t in tabs}
    assert {T.BUILTIN_TAB_ALL_NEW, T.BUILTIN_TAB_FAVORITES} <= set(by_id)
    custom = [t for t in tabs if not t["builtin"]]
    assert [t["name"] for t in custom] == [catalog["topic"]["name"]]
    topic_tab = custom[0]
    assert topic_tab["kind"] == "theme"
    assert topic_tab["icon"] == catalog["topic"]["icon"]

    # /feed of every tab
    allowed_videos = texts["videos"] | texts["topic_videos"]
    allowed_why = texts["folders"] | texts["channels"] | texts["topic"]
    for tab in tabs:
        page = ok(api_feed.get_feed(None, {"tab": tab["id"], "limit": "100"}))
        assert page["items"], tab["name"]
        for item in page["items"]:
            assert item["video"]["title"] in allowed_videos
            assert item["why"]["label"] in allowed_why
            if item.get("channel"):
                assert item["channel"]["title"] in texts["channels"]
    topic_page = ok(api_feed.get_feed(None, {"tab": topic_tab["id"], "limit": "100"}))
    assert {i["video"]["title"] for i in topic_page["items"]} == texts["topic_videos"]
    assert {i["why"]["label"] for i in topic_page["items"]} == texts["topic"]
    favorites = ok(api_feed.get_feed(None, {"tab": T.BUILTIN_TAB_FAVORITES, "limit": "100"}))
    fav_channels = {c["id"] for c in catalog["channels"] if c["favorite"]}
    assert {i["video"]["channel_id"] for i in favorites["items"]} == fav_channels

    # Manage: the 18 catalog channels, followed, in their folders; the topic channels are not here
    listed = ok(api_channels.get_channels(None, {}))
    assert listed["total"] == len(catalog["channels"])
    rows = [r["channel"] for r in listed["items"]]
    assert {c["title"] for c in rows} == texts["channels"]
    assert not texts["topic_channels"] & {c["title"] for c in rows}
    assert {c["relation"] for c in rows} == {"followed"}
    assert sum(r["new_count"] for r in listed["items"]) > 0
    folder_of = {f["key"]: f["name"] for f in catalog["folders"]}
    names = {f.id: f.name for f in wiring.get_taxonomy().list_folders()}
    assert set(names.values()) == set(folder_of.values())
    for row in rows:
        spec = next(c for c in catalog["channels"] if c["id"] == row["id"])
        assert names[row["folder_id"]] == folder_of[spec["folder"]]
        assert row["favorite"] is spec["favorite"]
        assert row["last_video_at"] is not None

    # /themes: one saved topic with its tab, its 14 videos and their reasons; no seeds followed
    themes = ok(api_themes.get_themes(None, {}))["items"]
    assert [t["name"] for t in themes] == [catalog["topic"]["name"]]
    theme = themes[0]
    assert theme["status"] == "saved" and theme["tab_id"] == topic_tab["id"]
    preview = ok(api_themes.get_theme(None, {"id": theme["id"]}))
    assert len(preview["items"]) == len(catalog["topic"]["videos"])
    assert {i["reason"] for i in preview["items"]} == texts["reasons"]
    assert preview["channel_count"] == len(catalog["topic"]["channels"])
    assert {v["channel_title"] for v in preview["videos"].values()} == texts["topic_channels"]

    # cleanup scan: only real subscriptions are scanned, so the sample data yields no candidate
    scan = wiring.get_cleanup().scan(timeout=10)
    assert scan.candidates == ()
    cleanup = ok(api_cleanup.get_cleanup(None, {}))
    assert cleanup["scan"]["candidates"] == [] and cleanup["channels"] == {}
    assert yt.calls == []


def test_dates_are_relative_to_now(tmp_path: Path, seed: Any, catalog: dict[str, Any]) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    before = int(time.time())
    seed.load(home)
    after = int(time.time())
    conn = sqlite3.connect(path)
    try:
        published = dict(conn.execute("SELECT id, published_at FROM videos").fetchall())
    finally:
        conn.close()
    for v in catalog["videos"] + catalog["topic"]["videos"]:
        age = v["age_hours"] * HOUR
        assert before - age <= published[v["id"]] <= after - age, v["id"]


# =========================================================================== refresher


def test_the_refresher_does_not_spoil_the_scene(
    tmp_path: Path, seed: Any, catalog: dict[str, Any], plugin_on: Any, wire: Any
) -> None:
    """Synthetic ids: every RSS answers 404 and every channel page says "does not exist". Right
    after ``load`` the overdue check does nothing; a full cycle (what happens once
    ``rss_interval_min`` has passed) fails quietly, without the "RSS down" banner and without
    losing anything; only after the one-day recheck window would the banner appear."""
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    seed.load(home)
    yt = plugin_on(path)

    refresher = wiring.get_refresher()
    assert refresher.kick_if_due() == "skipped"
    assert yt.calls == []

    report = refresher.refresh_all(timeout=30)
    assert len(report.errors) == len(catalog["channels"])
    assert refresher.rss_outage() is None
    assert ok(api_status.get_status(None, {}))["rss_down_since"] is None
    assert not [c for c in yt.calls if c[0] == "fetch_channel_uploads"], "no page budget spent"
    assert len(ok(api_channels.get_channels(None, {}))["items"]) == len(catalog["channels"])
    page = ok(api_feed.get_feed(None, {"tab": T.BUILTIN_TAB_FAVORITES, "limit": "100"}))
    assert page["items"]

    # a day later the "does not exist" marks are due for a recheck: the banner would come back
    wire.set("clock", FakeClock(int(time.time()) + DAY + HOUR))
    wiring.reset()
    later = wiring.get_refresher()
    later.refresh_all(timeout=30)
    assert later.rss_outage() is not None


# =========================================================================== clear


def test_clear_restores_every_table_and_keeps_the_persons_data(
    tmp_path: Path, seed: Any, catalog: dict[str, Any]
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home, with_user_data=True)
    before_counts = counts(path)
    before_meta = meta_rows(path)

    seed.load(home)
    loaded = counts(path)
    assert loaded["channels"] == before_counts["channels"] + len(catalog["channels"])
    assert loaded["changes"] == before_counts["changes"], "load leaves no history entries"
    assert seed.status(home)["loaded"] is True

    report = seed.clear(home)
    assert report["channels"] == len(catalog["channels"])
    assert counts(path) == before_counts
    assert meta_rows(path) == before_meta
    assert seed.status(home)["loaded"] is False

    conn = sqlite3.connect(path)
    try:
        assert conn.execute("SELECT title FROM channels").fetchall() == [("My own channel",)]
        assert conn.execute("SELECT name FROM folders").fetchall() == [("Reading list",)]
        assert conn.execute("SELECT id FROM videos").fetchall() == [("userVideo01",)]
    finally:
        conn.close()


def test_clear_also_removes_what_the_person_did_on_sample_videos(
    tmp_path: Path, seed: Any, plugin_on: Any
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    before_counts = counts(path)
    seed.load(home)
    plugin_on(path)
    wiring.get_video_state().set_state(["smpV0001abc"], T.VideoState.later, actor=T.Actor.user)
    wiring.get_video_state().set_reaction("smpT0001abc", T.Reaction.up, actor=T.Actor.user)
    wiring.shutdown()

    seed.clear(home)
    after = counts(path)
    assert after["video_state"] == before_counts["video_state"]
    assert after["videos"] == before_counts["videos"]


def test_load_adds_the_sample_playlists_and_clear_removes_only_them(
    tmp_path: Path, seed: Any, catalog: dict[str, Any], plugin_on: Any
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    db = core_db.build(path=str(path))
    try:
        own = core_playlists.build(db=db).create("My own list")
    finally:
        db.close()
    report = seed.load(home)
    assert report["playlists"] == len(catalog["playlists"]) == 2
    assert seed.status(home)["sample"]["playlists"] == 2

    plugin_on(path)
    listed = ok(api_playlists.get_playlists(None, {}))["items"]
    by_name = {p["name"]: p for p in listed}
    assert set(by_name) == {own.name} | {p["name"] for p in catalog["playlists"]}
    catalog_ids = {v["id"] for v in catalog["videos"] + catalog["topic"]["videos"]}
    for spec in catalog["playlists"]:
        assert all(v.startswith("smp") and v in catalog_ids for v in spec["videos"])
        one = ok(api_playlists.get_playlist(None, {"id": by_name[spec["name"]]["id"]}))
        assert [i["video"]["id"] for i in one["items"]] == spec["videos"]
    wiring.shutdown()

    cleared = seed.clear(home)
    assert cleared["playlists"] == 2
    conn = sqlite3.connect(path)
    try:
        assert conn.execute("SELECT name FROM playlists").fetchall() == [("My own list",)]
        assert conn.execute("SELECT count(*) FROM playlist_items").fetchone() == (0,)
    finally:
        conn.close()


def test_a_sample_playlist_name_already_taken_is_skipped(
    tmp_path: Path, seed: Any, catalog: dict[str, Any]
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    taken = catalog["playlists"][0]["name"]
    db = core_db.build(path=str(path))
    try:
        core_playlists.build(db=db).create(taken.upper())
    finally:
        db.close()
    report = seed.load(home)
    assert report["playlists"] == 1
    assert any(taken in note for note in report["notes"])
    seed.clear(home)
    conn = sqlite3.connect(path)
    try:
        assert conn.execute("SELECT name FROM playlists").fetchall() == [(taken.upper(),)]
    finally:
        conn.close()


def test_load_twice_is_refused_and_clear_without_load_does_nothing(
    tmp_path: Path, seed: Any
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    assert seed.clear(home)["loaded"] is False
    assert not list(path.parent.glob("*.bak")), "nothing to clear: no backup either"
    seed.load(home)
    with pytest.raises(seed.SeedError, match="already loaded"):
        seed.load(home)


# =========================================================================== safety


def test_refuses_a_database_with_real_subscriptions_unless_forced(
    tmp_path: Path, seed: Any, catalog: dict[str, Any]
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    db = core_db.build(path=str(path))
    try:
        g = wiring.Graph(db=db, settings=FakeSettings(), ctx=None)
        g.get("channels").upsert_many(
            [T.ChannelIn(title="A real subscription", channel_id=REAL_ID)],
            source=T.ChannelSource.extension,
            relation=T.Relation.subscribed,
        )
    finally:
        db.close()
    before = counts(path)

    with pytest.raises(seed.Refused, match="1 real subscription"):
        seed.load(home)
    assert counts(path) == before, "refused before writing anything"
    assert not list(path.parent.glob("*.bak")), "refused before the backup"

    report = seed.load(home, force=True)
    assert report["channels"] == len(catalog["channels"])
    seed.clear(home)
    assert counts(path) == before


def test_backup_is_a_dated_sqlite_copy_next_to_the_database(tmp_path: Path, seed: Any) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home, with_user_data=True)
    before = counts(path)
    # an open connection holding uncommitted-to-file (WAL) data: the backup API still sees it
    holder = core_db.build(path=str(path))
    try:
        holder.execute("INSERT INTO meta (key, value) VALUES ('wal_probe', '1')")
        report = seed.load(home)
    finally:
        holder.close()
    backup = Path(report["backup"])
    assert backup.parent == path.parent
    assert backup.name.startswith("tube.db.sample-seed-") and backup.suffix == ".bak"
    stamp = backup.name.removeprefix("tube.db.sample-seed-").removesuffix(".bak")
    time.strptime(stamp[:15], "%Y%m%d-%H%M%S")
    assert stat.S_IMODE(backup.stat().st_mode) == 0o600
    copied = counts(backup)
    assert copied["channels"] == before["channels"]
    assert copied["meta"] == before["meta"] + 1, "the WAL content is in the copy"
    conn = sqlite3.connect(backup)
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    finally:
        conn.close()
    # clear makes its own backup before writing
    second = Path(seed.clear(home)["backup"])
    assert second.is_file() and second != backup


def test_load_removes_the_builtin_demo_and_clear_does_not_bring_it_back(
    tmp_path: Path, seed: Any
) -> None:
    home = tmp_path / "profile"
    path = init_plugin_db(home)
    db = core_db.build(path=str(path))
    try:
        g = wiring.Graph(db=db, settings=FakeSettings(), ctx=None)
        g.get("demo").load(ui_locale="en")
        assert g.get("data").demo_loaded()
    finally:
        db.close()

    report = seed.load(home)
    assert report["demo_removed"] is True
    assert any("demo" in line for line in report["notes"])
    conn = sqlite3.connect(path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM channels WHERE source = 'demo'").fetchone() == (
            0,
        )
    finally:
        conn.close()
    seed.clear(home)
    conn = sqlite3.connect(path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM channels").fetchone() == (0,)
        assert conn.execute("SELECT value FROM meta WHERE key = 'demo_loaded'").fetchone() == ("0",)
    finally:
        conn.close()


# =========================================================================== command line


def test_command_line_status_load_clear(tmp_path: Path) -> None:
    home = tmp_path / "profile"
    init_plugin_db(home)
    env = {k: v for k, v in os.environ.items() if k != "TUBE_DB_PATH"}

    def run(*args: str, where: Path = home) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args, "--home", str(where)],
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
        )

    out = run("status")
    assert out.returncode == 0, out.stderr
    assert "not loaded" in out.stdout
    out = run("load")
    assert out.returncode == 0, out.stderr
    assert "Loaded" in out.stdout and "backup" in out.stdout.lower()
    out = run("status")
    assert out.returncode == 0 and "loaded" in out.stdout and "not loaded" not in out.stdout
    out = run("load")
    assert out.returncode == 1 and "already loaded" in out.stderr
    out = run("clear")
    assert out.returncode == 0, out.stderr
    assert "Cleared" in out.stdout
    missing = run("status", where=tmp_path / "nowhere")
    assert missing.returncode == 2 and "no plugin database" in missing.stderr
