"""Local playlists: schema step in ``core/db.py``, ``core/playlists.py``, the REST routes in
``api/playlists.py`` and the playlist parts of the agent tools.

Playlists live only in the plugin database (never written to the YouTube account). Every
database lives in ``tmp_path``; no network.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from fakes import FakeClock, MemDb

from tube_pkg.api import _common
from tube_pkg.api import playlists as api_playlists
from tube_pkg.core import db as dbmod
from tube_pkg.core import playlists as PL
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
CHANNEL = "UC" + "p" * 22
PLAYLIST_TABLES = {"playlists", "playlist_items"}


def vid(n: int) -> str:
    """Valid video id (11 characters)."""
    return f"plsVid{n:05d}"


def _load_by_path(name: str, path: Path) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_playlists", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)
OPS = {op.operation_id: op for op in gen_types.iter_operations(CONTRACT)}


def _tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {r[0] for r in rows if not r[0].startswith("sqlite_")}


def _create_v1(path: Path) -> None:
    """A database as the first published version leaves it: the v1 schema, no playlist tables."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), isolation_level=None)
    try:
        conn.executescript(dbmod.SCHEMA_SQL)
        conn.execute(
            "INSERT INTO videos (id, channel_id, title, first_seen_at, origin)"
            " VALUES (?, ?, 'Old video', 1, 'rss')",
            (vid(1), CHANNEL),
        )
        assert not (_tables(conn) & PLAYLIST_TABLES)
    finally:
        conn.close()


# =========================================================================== schema step


def test_new_database_has_the_playlist_tables(tmp_path: Path) -> None:
    handle = dbmod.build(path=str(tmp_path / "tube.db"))
    try:
        names = {r["name"] for r in handle.query("SELECT name FROM sqlite_master")}
        assert PLAYLIST_TABLES <= names
    finally:
        handle.close()


def test_old_database_gets_the_tables_and_keeps_its_data(tmp_path: Path) -> None:
    path = tmp_path / "old" / "tube.db"
    _create_v1(path)
    handle = dbmod.build(path=str(path))
    try:
        names = {r["name"] for r in handle.query("SELECT name FROM sqlite_master")}
        assert PLAYLIST_TABLES <= names
        assert handle.query("SELECT id, title FROM videos") == [
            {"id": vid(1), "title": "Old video"}
        ]
    finally:
        handle.close()
    # opening again is a no-op (idempotent)
    again = dbmod.build(path=str(path))
    try:
        assert again.query_one("SELECT count(*) AS n FROM playlists") == {"n": 0}
    finally:
        again.close()


def test_versioned_step_takes_v1_to_v2_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Once ``SCHEMA_VERSION`` reaches 2, the same step runs as ``migrate_2``: v1 → v2, once."""
    path = tmp_path / "v1" / "tube.db"
    _create_v1(path)
    calls: list[int] = []

    def migrate_2(conn: sqlite3.Connection) -> None:
        calls.append(2)
        dbmod.migrate_2(conn)

    monkeypatch.setattr(dbmod, "MIGRATIONS", [dbmod.migrate_1, migrate_2])
    monkeypatch.setattr(dbmod, "PENDING_MIGRATIONS", [])
    first = dbmod.build(path=str(path))
    try:
        assert calls == [2]
        assert dbmod.schema_version(first) == 2
        names = {r["name"] for r in first.query("SELECT name FROM sqlite_master")}
        assert PLAYLIST_TABLES <= names
        assert first.query_one("SELECT title FROM videos") == {"title": "Old video"}
    finally:
        first.close()
    second = dbmod.build(path=str(path))
    try:
        assert calls == [2]
    finally:
        second.close()


def test_migrate_2_is_idempotent_and_named_like_the_others() -> None:
    assert dbmod.migrate_2.__name__ == "migrate_2"
    conn = sqlite3.connect(":memory:")
    try:
        dbmod.migrate_1(conn)
        dbmod.migrate_2(conn)
        dbmod.migrate_2(conn)
        assert PLAYLIST_TABLES <= _tables(conn)
    finally:
        conn.close()


def test_pending_step_does_not_bump_the_contract_version(tmp_path: Path) -> None:
    handle = dbmod.build(path=str(tmp_path / "tube.db"))
    try:
        assert dbmod.schema_version(handle) == T.SCHEMA_VERSION
        assert len(dbmod.MIGRATIONS) == T.SCHEMA_VERSION
    finally:
        handle.close()


# =========================================================================== core


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(1_762_000_000)


@pytest.fixture
def svc(db: Any, clock: FakeClock) -> PL.PlaylistService:
    return PL.build(db=db, clock=clock)


def test_build_on_a_bare_schema_database_creates_the_tables(clock: FakeClock) -> None:
    """A ``Db`` that never went through ``core/db`` (``MemDb``, the plugin host's own file)."""
    mem = MemDb()
    try:
        assert not (set(mem.tables()) & PLAYLIST_TABLES)
        PL.build(db=mem, clock=clock).create("Physics")
        assert PLAYLIST_TABLES <= set(mem.tables())
    finally:
        mem.close()


def test_create_list_rename_delete(svc: PL.PlaylistService, clock: FakeClock) -> None:
    a = svc.create("  Physics  ")
    assert a.name == "Physics" and a.count == 0 and a.first_video_id is None
    assert a.id.startswith("pl_") and a.created_at == a.updated_at == clock.now()
    clock.advance(10)
    b = svc.create("Cooking")
    assert [p.name for p in svc.list()] == ["Cooking", "Physics"]  # most recently updated first
    clock.advance(10)
    renamed = svc.rename(a.id, "Physics lectures")
    assert renamed.name == "Physics lectures" and renamed.updated_at == clock.now()
    svc.delete(b.id)
    assert [p.id for p in svc.list()] == [a.id]
    with pytest.raises(T.NotFound):
        svc.get(b.id)
    with pytest.raises(T.NotFound):
        svc.rename(b.id, "x")
    with pytest.raises(T.NotFound):
        svc.delete(b.id)


def test_names_are_validated_and_unique(svc: PL.PlaylistService) -> None:
    svc.create("Physics")
    for bad in ("", "   ", "x" * (PL.MAX_NAME_LEN + 1), None, 3):
        with pytest.raises(T.ValidationError):
            svc.create(bad)  # type: ignore[arg-type]
    assert svc.create("x" * PL.MAX_NAME_LEN).name == "x" * PL.MAX_NAME_LEN
    with pytest.raises(T.Conflict, match="already"):
        svc.create("physics")
    other = svc.create("Other")
    with pytest.raises(T.Conflict):
        svc.rename(other.id, "PHYSICS")
    assert svc.rename(other.id, "other").name == "other"  # its own name in another case is fine


def test_playlist_limit(svc: PL.PlaylistService, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PL, "MAX_PLAYLISTS", 2)
    svc.create("a")
    svc.create("b")
    with pytest.raises(T.Conflict, match="2 playlists"):
        svc.create("c")


def test_items_add_remove_no_duplicates(svc: PL.PlaylistService, clock: FakeClock) -> None:
    p = svc.create("Physics")
    assert svc.add(p.id, [vid(1), vid(2), vid(1)]) == 2
    assert svc.add(p.id, [vid(2), vid(3)]) == 1  # vid(2) is already there
    assert svc.item_ids(p.id) == [vid(1), vid(2), vid(3)]
    got = svc.get(p.id)
    assert got.count == 3 and got.first_video_id == vid(1)
    assert svc.remove(p.id, [vid(1), vid(9)]) == 1
    assert svc.item_ids(p.id) == [vid(2), vid(3)]
    assert svc.get(p.id).first_video_id == vid(2)
    with pytest.raises(T.ValidationError):
        svc.add(p.id, ["short"])
    with pytest.raises(T.ValidationError):
        svc.add(p.id, [])
    with pytest.raises(T.NotFound):
        svc.add("pl_nope", [vid(1)])


def test_a_video_can_be_in_many_playlists_and_delete_keeps_videos(
    db: Any, svc: PL.PlaylistService
) -> None:
    db.execute(
        "INSERT INTO videos (id, channel_id, title, first_seen_at, origin)"
        " VALUES (?, ?, 'v', 1, 'rss')",
        (vid(1), CHANNEL),
    )
    a = svc.create("A")
    b = svc.create("B")
    svc.add(a.id, [vid(1)])
    svc.add(b.id, [vid(1)])
    assert sorted(svc.member_of(vid(1))) == sorted([a.id, b.id])
    svc.delete(a.id)
    assert svc.member_of(vid(1)) == [b.id]
    assert db.query_one(
        "SELECT count(*) AS n FROM playlist_items WHERE playlist_id = ?", (a.id,)
    ) == {"n": 0}
    assert db.query_one("SELECT count(*) AS n FROM videos") == {"n": 1}


def test_item_limit(svc: PL.PlaylistService, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PL, "MAX_ITEMS", 3)
    p = svc.create("P")
    svc.add(p.id, [vid(1), vid(2)])
    with pytest.raises(T.Conflict, match="3 videos"):
        svc.add(p.id, [vid(3), vid(4)])
    assert svc.item_ids(p.id) == [vid(1), vid(2)]  # nothing added
    assert svc.add(p.id, [vid(1), vid(3)]) == 1  # duplicates do not count towards the limit


def test_reorder(svc: PL.PlaylistService) -> None:
    p = svc.create("P")
    svc.add(p.id, [vid(1), vid(2), vid(3), vid(4)])
    assert svc.reorder(p.id, [vid(3), vid(1)]) == 4
    # the listed ones first, in the given order; the rest keep their relative order
    assert svc.item_ids(p.id) == [vid(3), vid(1), vid(2), vid(4)]
    with pytest.raises(T.ValidationError):
        svc.reorder(p.id, [vid(9)])
    assert svc.add(p.id, [vid(5)]) == 1
    assert svc.item_ids(p.id)[-1] == vid(5)


def test_find_by_id_or_name(svc: PL.PlaylistService) -> None:
    p = svc.create("Física Quântica")
    assert svc.find(p.id).id == p.id
    assert svc.find("fisica quantica").id == p.id
    with pytest.raises(T.NotFound) as err:
        svc.find("Cooking")
    assert err.value.details["options"] == ["Física Quântica"]


def test_list_summary_has_count_and_first_item(svc: PL.PlaylistService) -> None:
    a = svc.create("A")
    svc.add(a.id, [vid(7), vid(8)])
    svc.reorder(a.id, [vid(8)])
    (summary,) = svc.list()
    assert summary.count == 2 and summary.first_video_id == vid(8)
    data = T.to_jsonable(summary)
    assert set(data) == {"id", "name", "count", "first_video_id", "created_at", "updated_at"}


# =========================================================================== REST


def _check(op_id: str, env: dict[str, Any]) -> Any:
    op = OPS[op_id]
    assert _common.is_envelope(env), env
    if env["ok"]:
        gen_types.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
        return env["data"]
    gen_types.validate_instance(
        {"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True
    )
    assert env["error"]["code"] in set(op.errors) | {"internal"}, env
    return env["error"]


@pytest.fixture
def api(tmp_path: Path, wire: Any, clock: FakeClock) -> Any:
    """Real database and the real feed engine/video store of a world on it."""
    handle = dbmod.build(path=str(tmp_path / "api" / "tube.db"))
    for n in (1, 2, 3):
        handle.execute(
            "INSERT INTO videos (id, channel_id, channel_title, title, first_seen_at, origin)"
            " VALUES (?, ?, 'Chan', ?, 1, 'rss')",
            (vid(n), CHANNEL, f"Video {n}"),
        )
    wire.set("db", handle)
    wire.set("clock", clock)

    class Store:
        def get(self, ids: list[str]) -> dict[str, T.Video]:
            rows = handle.query(
                f"SELECT id, channel_id, title FROM videos WHERE id IN"
                f" ({','.join('?' for _ in ids)})",
                tuple(ids),
            )
            return {
                r["id"]: T.Video(
                    id=r["id"], channel_id=r["channel_id"], title=r["title"], published_at=None
                )
                for r in rows
            }

    class Engine:
        def items(self, ids: list[str]) -> list[T.FeedItem]:
            rows = {
                r["id"]: r
                for r in handle.query(
                    f"SELECT id, channel_id, title FROM videos WHERE id IN"
                    f" ({','.join('?' for _ in ids)})",
                    tuple(ids),
                )
            }
            return [
                T.FeedItem(
                    video=T.Video(
                        id=i,
                        channel_id=rows[i]["channel_id"],
                        title=rows[i]["title"],
                        published_at=1_761_000_000,
                    )
                )
                for i in ids
                if i in rows
            ]

    wire.set("video_store", Store())
    wire.set("feed", Engine())
    yield handle
    handle.close()


def test_rest_flow(api: Any) -> None:
    created = _check("postPlaylist", api_playlists.post_playlist({"name": "Physics"}, {}))
    pid = created["id"]
    assert created["count"] == 0

    added = _check(
        "postPlaylistItems",
        api_playlists.post_playlist_items({"video_ids": [vid(1), vid(2)]}, {"id": pid}),
    )
    assert added["changed"] == 2 and added["playlist"]["count"] == 2

    listing = _check("getPlaylists", api_playlists.get_playlists(None, {"video_id": vid(1)}))
    assert [p["id"] for p in listing["items"]] == [pid]
    assert listing["member_of"] == [pid]
    assert _check("getPlaylists", api_playlists.get_playlists(None, {}))["member_of"] == []

    one = _check("getPlaylist", api_playlists.get_playlist(None, {"id": pid}))
    assert one["playlist"]["name"] == "Physics"
    assert [it["video"]["id"] for it in one["items"]] == [vid(1), vid(2)]

    _check(
        "postPlaylistReorder", api_playlists.post_playlist_reorder({"ids": [vid(2)]}, {"id": pid})
    )
    one = _check("getPlaylist", api_playlists.get_playlist(None, {"id": pid}))
    assert [it["video"]["id"] for it in one["items"]] == [vid(2), vid(1)]

    removed = _check(
        "postPlaylistItemsRemove",
        api_playlists.post_playlist_items_remove({"video_ids": [vid(2)]}, {"id": pid}),
    )
    assert removed["changed"] == 1 and removed["playlist"]["count"] == 1

    renamed = _check(
        "patchPlaylist", api_playlists.patch_playlist({"name": "Lectures"}, {"id": pid})
    )
    assert renamed["name"] == "Lectures"

    assert _check("deletePlaylist", api_playlists.delete_playlist(None, {"id": pid})) == {"id": pid}
    assert (
        _check("getPlaylist", api_playlists.get_playlist(None, {"id": pid}))["code"] == "not_found"
    )


def test_rest_create_with_videos_and_errors(api: Any) -> None:
    made = _check(
        "postPlaylist", api_playlists.post_playlist({"name": "Mix", "video_ids": [vid(3)]}, {})
    )
    assert made["count"] == 1 and made["first_video_id"] == vid(3)
    dup = _check("postPlaylist", api_playlists.post_playlist({"name": "mix"}, {}))
    assert dup["code"] == "conflict"
    for body in ({}, {"name": 3}, {"name": "x" * 81}, {"name": "ok", "video_ids": "x"}):
        assert _check("postPlaylist", api_playlists.post_playlist(body, {}))["code"] == "invalid"
    unknown = _check(
        "postPlaylistItems",
        api_playlists.post_playlist_items({"video_ids": [vid(9)]}, {"id": made["id"]}),
    )
    assert unknown["code"] == "not_found"
    assert (
        _check("patchPlaylist", api_playlists.patch_playlist({}, {"id": made["id"]}))["code"]
        == "invalid"
    )
    assert (
        _check("getPlaylists", api_playlists.get_playlists(None, {"video_id": "bad"}))["code"]
        == "invalid"
    )


def test_rest_routes_are_registered_in_wiring() -> None:
    from tube_pkg import wiring

    routes = {(r.method, r.path): (r.module, r.handler) for r in wiring.REST_ROUTES}
    expected = {
        ("GET", "/playlists"): "get_playlists",
        ("POST", "/playlists"): "post_playlist",
        ("GET", "/playlists/{id}"): "get_playlist",
        ("PATCH", "/playlists/{id}"): "patch_playlist",
        ("DELETE", "/playlists/{id}"): "delete_playlist",
        ("POST", "/playlists/{id}/items"): "post_playlist_items",
        ("POST", "/playlists/{id}/items/remove"): "post_playlist_items_remove",
        ("POST", "/playlists/{id}/reorder"): "post_playlist_reorder",
    }
    for key, handler in expected.items():
        assert routes[key] == ("tube_pkg.api.playlists", handler), key
        assert _common.is_real(getattr(api_playlists, handler))


# =========================================================================== tools


def _tool(name: str, args: Any) -> dict[str, Any]:
    from tube_pkg.tools import catalog

    return json.loads(getattr(catalog, name)(args, session_id=None))


def test_tool_mark_adds_to_a_playlist_by_name(api: Any) -> None:
    pid = api_playlists.service().create("Physics").id
    out = _tool("tube_mark", {"video_ids": [vid(1)], "playlist": "physics"})
    assert out["ok"] is True, out
    assert out["playlist"] == {"id": pid, "name": "Physics", "added": 1, "count": 1}
    assert api_playlists.service().item_ids(pid) == [vid(1)]
    # again: nothing duplicated
    again = _tool("tube_mark", {"video_ids": [vid(1)], "playlist": "Physics"})
    assert again["playlist"]["added"] == 0


def test_tool_mark_unknown_playlist_lists_options_or_creates(api: Any) -> None:
    api_playlists.service().create("Cooking")
    out = _tool("tube_mark", {"video_ids": [vid(1)], "playlist": "Physics"})
    assert out["ok"] is False and out["error"]["code"] == "not_found"
    assert out["error"]["options"] == ["Cooking"]
    made = _tool(
        "tube_mark", {"video_ids": [vid(1), vid(2)], "playlist": "Physics", "create_playlist": True}
    )
    assert made["ok"] is True and made["playlist"]["added"] == 2
    assert made["playlist"]["created"] is True


def test_tool_feed_lists_playlists_and_their_videos(api: Any) -> None:
    svc = api_playlists.service()
    pid = svc.create("Physics").id
    svc.add(pid, [vid(2), vid(1)])
    listing = _tool("tube_feed", {"playlist": "*"})
    assert listing["ok"] is True
    assert listing["playlists"] == [{"id": pid, "name": "Physics", "count": 2}]
    videos = _tool("tube_feed", {"playlist": "Physics", "limit": 1})
    assert videos["ok"] is True
    assert videos["source"] == {"playlist": pid, "name": "Physics"}
    assert [v["id"] for v in videos["items"]] == [vid(2)]
    assert videos["truncated"] is True
    both = _tool("tube_feed", {"playlist": "Physics", "tab": "all-new"})
    assert both["ok"] is False and both["error"]["code"] == "invalid"
