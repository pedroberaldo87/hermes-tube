"""Channel and history REST routes (``api/channels.py``, ``api/changes.py``).

Real database (``core.db.build``) with the real ``ChangeLog``/``ChannelService`` in place of the
``build_fake_world`` fakes; the rest (cleanup, refresher, YouTube) is fake, except where the test
says otherwise. Every ``ok`` response is validated **strictly** against the ``x-data`` in
``api.yaml`` (same validator as ``tests/test_contract_surface.py``); every error, against
``ErrorEnvelope`` and the operation's ``x-errors``.
"""

from __future__ import annotations

import importlib.util
import sys
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import fakes.world as fake_world_module
import pytest
from fakes import FakeClock, FakeSettings, FakeYouTube, build_fake_world

from tube_pkg.api import _common
from tube_pkg.api import changes as api_changes
from tube_pkg.api import channels as api_channels
from tube_pkg.core import changes as CG
from tube_pkg.core import channels as CH
from tube_pkg.core import db as core_db
from tube_pkg.core import dedup
from tube_pkg.core import refresh as R
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
DAY = 86_400


def cid(n: int) -> str:
    """Valid channel id (``UC`` + 22)."""
    return f"UCb04btest{n:014d}"


def vid(n: int, j: int) -> str:
    """Valid video id (11 characters)."""
    return f"b{n:05d}_{j:04d}"


def _load_by_path(name: str, path: Path) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_b04b", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)

HANDLERS = {
    "getChannels": api_channels.get_channels,
    "getChannel": api_channels.get_channel,
    "patchChannel": api_channels.patch_channel,
    "postChannelsBatch": api_channels.post_channels_batch,
    "postChannelsAdd": api_channels.post_channels_add,
    "getChanges": api_changes.get_changes,
    "postChangeUndo": api_changes.post_change_undo,
}


# --------------------------------------------------------------------------- call and contract


def _op(operation_id: str) -> Any:
    return gen_types.get_operation(CONTRACT, operation_id)


def call(operation_id: str, body: Any = None, query: Any = None) -> dict[str, Any]:
    """Calls the handler like the router (``call_rest``: never raises) and validates the envelope
    strictly against the operation's contract."""
    env = _common.call_rest(HANDLERS[operation_id], body, dict(query or {}))
    op = _op(operation_id)
    assert _common.is_envelope(env), env
    if env["ok"]:
        assert set(env) == {"ok", "data"}, env
        gen_types.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    else:
        gen_types.validate_instance(
            {"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True
        )
        assert env["error"]["code"] in set(op.errors) | {"internal"}, env
    return env


def ok(operation_id: str, body: Any = None, query: Any = None) -> Any:
    env = call(operation_id, body, query)
    assert env["ok"] is True, env
    return env["data"]


def err(operation_id: str, body: Any = None, query: Any = None, *, code: str) -> dict[str, Any]:
    env = call(operation_id, body, query)
    assert env["ok"] is False, env
    assert env["error"]["code"] == code, env
    if code != "internal":
        assert code in _op(operation_id).errors, f"{code} not in the x-errors of {operation_id}"
    return env["error"]


# --------------------------------------------------------------------------- world


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "b04b.db"))
    yield db
    db.close()


def _make_changelog(db: Any, *, clock: Any = None, ids: Any = None) -> Any:
    return CG.build(db=db, settings=FakeSettings(), clock=clock)


def _make_channels(
    db: Any, *, changelog: Any, youtube: Any = None, clock: Any = None, ids: Any = None
) -> Any:
    return CH.build(
        db=db,
        settings=FakeSettings(),
        youtube=youtube or FakeYouTube(),
        changelog=changelog,
        clock=clock,
    )


@pytest.fixture
def w(monkeypatch: pytest.MonkeyPatch, rdb: Any, clock: FakeClock, wire: Any) -> Any:
    """World of fakes with real ``ChangeLog``/``ChannelService`` over the real database, wired into
    ``wiring`` (the routes get everything through ``wiring.get_<name>()``)."""
    monkeypatch.setattr(fake_world_module, "FakeChangeLog", _make_changelog)
    monkeypatch.setattr(fake_world_module, "FakeChannelService", _make_channels)
    world = build_fake_world(rdb, clock=clock)
    assert isinstance(world.channels, CH.ChannelService)
    assert isinstance(world.changelog, CG.ChangeLog)
    wire.use_world(world)
    return world


def _sub(w: Any, *ns: int, titles: dict[int, str] | None = None) -> list[str]:
    """``subscribed`` channels coming from the extension (no history)."""
    titles = titles or {}
    w.channels.upsert_many(
        [T.ChannelIn(title=titles.get(n, f"Canal {n:03d}"), channel_id=cid(n)) for n in ns],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
        actor=T.Actor.extension,
    )
    return [cid(n) for n in ns]


def _snapshot(db: Any) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for table in (
        "channels",
        "channel_tags",
        "changes",
        "cleanup_candidates",
        "unsub_queue",
        "folders",
        "tags",
    ):
        rows = db.query(f"SELECT * FROM {table} ORDER BY 1, 2")
        for r in rows:
            r.pop("updated_at", None)
        out[table] = rows
    return out


def _queue_rows(db: Any) -> list[dict[str, Any]]:
    return db.query("SELECT * FROM unsub_queue ORDER BY id")


def _actors(db: Any) -> set[str]:
    return {r["actor"] for r in db.query("SELECT actor FROM changes")}


def _last_change_id(db: Any) -> int:
    row = db.query_one("SELECT MAX(id) AS m FROM changes")
    return int(row["m"] or 0)


# --------------------------------------------------------------------------- coverage


def test_every_channels_route_is_real_and_covered() -> None:
    ours = {
        op.operation_id
        for op in gen_types.iter_operations(CONTRACT)
        if op.module in ("plugin/api/channels.py", "plugin/api/changes.py")
    }
    assert ours == set(HANDLERS)
    for op_id, fn in HANDLERS.items():
        assert _common.is_real(fn), op_id
        assert _common.stub_operation(fn) is None, op_id


def test_modules_are_pure() -> None:
    for module in (api_channels, api_changes):
        text = Path(module.__file__).read_text(encoding="utf-8")
        assert "from plugin" not in text
        assert "os.environ" not in text
        for other in ("feed", "refresh", "cleanup", "sync", "taxonomy", "video_state"):
            assert f"tube_pkg.core.{other}" not in text, other
            assert f"tube_pkg.core import {other}" not in text, other


# --------------------------------------------------------------------------- GET /channels


def _gerenciar_world(w: Any) -> dict[str, Any]:
    """Channels of every relation, folder with a subfolder, tag, ⭐, muted, link origin."""
    _sub(w, 1, 2, 3, 4, titles={1: "Ação & Reação", 2: "beta", 3: "Álgebra", 4: "zeta"})
    tech = w.taxonomy.create_folder("Tech")
    ia = w.taxonomy.create_folder("IA", parent_id=tech.id)
    tag = w.taxonomy.create_tag("dev")
    w.channels.batch(T.BatchOp.move, [cid(1)], value=tech.id, actor=T.Actor.user)
    w.channels.batch(T.BatchOp.move, [cid(2)], value=ia.id, actor=T.Actor.user)
    w.channels.batch(T.BatchOp.favorite, [cid(1)], actor=T.Actor.user)
    w.channels.batch(T.BatchOp.mute, [cid(3)], actor=T.Actor.user)
    w.channels.batch(T.BatchOp.tag, [cid(2), cid(4)], value=tag.id, actor=T.Actor.user)
    w.youtube.add_channel(T.ChannelInfo(id=cid(5), title="Gama", handle="@gama"))
    w.channels.add("@gama", actor=T.Actor.user)  # followed, source link
    _sub(w, 6, titles={6: "Ex Canal"})
    w.channels.set_relation(cid(6), T.Relation.ex, actor=T.Actor.extension)
    w.youtube.add_channel(T.ChannelInfo(id=cid(7), title="Ignorado", handle="@ign"))
    w.channels.add("@ign", actor=T.Actor.user)
    w.channels.set_relation(cid(7), T.Relation.ignored, actor=T.Actor.user)
    return {"tech": tech.id, "ia": ia.id, "tag": tag.id}


def _ids(data: dict[str, Any]) -> list[str]:
    return [row["channel"]["id"] for row in data["items"]]


def test_get_channels_filters_and_order(w: Any) -> None:
    ref = _gerenciar_world(w)
    data = ok("getChannels")
    assert data["total"] == 7
    # Manage order: normalized title (no accents/case), ties broken by id
    assert _ids(data) == [cid(1), cid(3), cid(2), cid(6), cid(5), cid(7), cid(4)]
    assert ok("getChannels", query={"relation": "subscribed,followed"})["total"] == 5
    assert _ids(ok("getChannels", query={"relation": "ex"})) == [cid(6)]
    assert _ids(ok("getChannels", query={"relation": "ignored"})) == [cid(7)]
    assert set(_ids(ok("getChannels", query={"folder": "none"}))) == {
        cid(3),
        cid(4),
        cid(5),
        cid(6),
        cid(7),
    }
    assert _ids(ok("getChannels", query={"folder": ref["tech"]})) == [cid(1), cid(2)]
    assert _ids(ok("getChannels", query={"folder": ref["tech"], "recursive": "false"})) == [cid(1)]
    assert _ids(ok("getChannels", query={"tag": ref["tag"]})) == [cid(2), cid(4)]
    assert _ids(ok("getChannels", query={"favorite": "true"})) == [cid(1)]
    assert _ids(ok("getChannels", query={"muted": "true"})) == [cid(3)]
    assert ok("getChannels", query={"muted": "false"})["total"] == 6
    assert _ids(ok("getChannels", query={"source": "link"})) == [cid(5), cid(7)]
    assert _ids(ok("getChannels", query={"q": "acao"})) == [cid(1)]
    assert _ids(ok("getChannels", query={"q": "@GAMA"})) == [cid(5)]
    assert _ids(ok("getChannels", query={"ids": f"{cid(4)}, {cid(2)}"})) == [cid(2), cid(4)]
    # pagination: total ignores limit/offset
    page = ok("getChannels", query={"limit": "2", "offset": "1"})
    assert page["total"] == 7 and _ids(page) == [cid(3), cid(2)]
    assert ok("getChannels", query={"limit": "2000", "offset": "50"}) == {"items": [], "total": 7}
    # combined filters
    combo = ok(
        "getChannels", query={"relation": "subscribed", "folder": ref["tech"], "tag": ref["tag"]}
    )
    assert _ids(combo) == [cid(2)]
    row = ok("getChannels", query={"ids": cid(1)})["items"][0]
    assert row["channel"]["favorite"] is True and row["channel"]["folder_id"] == ref["tech"]


@pytest.mark.parametrize(
    "query",
    [
        {"relation": "subscribed,banana"},
        {"limit": "0"},
        {"limit": "2001"},
        {"limit": "dez"},
        {"offset": "-1"},
        {"favorite": "talvez"},
        {"recursive": "x"},
        {"source": "orkut"},
    ],
)
def test_get_channels_invalid_query(w: Any, query: dict[str, str]) -> None:
    error = err("getChannels", query=query, code="invalid")
    assert error["message"]


def test_get_channels_row_counters(w: Any) -> None:
    _sub(w, 1, 2, 3)
    now = w.clock.now()
    rows = []
    for n in (1, 2):
        for j in range(4):
            rows.append((vid(n, j), cid(n), f"v{j}", now - j * DAY - 60, now, "rss"))
    rows.append((vid(1, 9), cid(1), "velho", now - 60 * DAY, now, "rss"))  # outside the window
    w.db.executemany(
        "INSERT INTO videos (id, channel_id, title, published_at, first_seen_at, origin)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    # channel 1: the watermark leaves 2 new (j=0,1); j=0 seen → 1 new
    w.db.execute(
        "INSERT INTO watermarks (channel_id, seen_up_to) VALUES (?, ?)", (cid(1), now - 2 * DAY)
    )
    w.db.execute(
        "INSERT INTO video_state (video_id, state, updated_at) VALUES (?, 'seen', ?)",
        (vid(1, 0), now),
    )
    data = ok("getChannels")
    by_id = {r["channel"]["id"]: r for r in data["items"]}
    assert by_id[cid(1)]["new_count"] == 1
    assert by_id[cid(2)]["new_count"] == 4  # no watermark = everything is new (within the window)
    assert by_id[cid(3)]["new_count"] == 0
    # no device has sent history yet → null
    assert {r["watched_90d"] for r in data["items"]} == {None}
    w.db.executemany(
        "INSERT INTO watch_history (video_id, channel_id, watched_at, device_id)"
        " VALUES (?, ?, ?, 'd1')",
        [
            (vid(1, 1), cid(1), now - DAY),
            (vid(1, 1), cid(1), now - 2 * DAY),  # same video again: counts once
            (vid(1, 2), cid(1), now - 10 * DAY),
            (vid(1, 3), cid(1), now - 100 * DAY),  # outside the 90 days
            (vid(2, 1), cid(2), now - 200 * DAY),
        ],
    )
    by_id = {r["channel"]["id"]: r for r in ok("getChannels")["items"]}
    assert by_id[cid(1)]["watched_90d"] == 2
    assert by_id[cid(2)]["watched_90d"] == 0
    assert by_id[cid(3)]["watched_90d"] == 0
    single = ok("getChannel", query={"id": cid(1)})
    assert single["new_count"] == 1 and single["watched_90d"] == 2


# --------------------------------------------------------------------------- GET /channels/{id}


def test_get_channel(w: Any) -> None:
    _sub(w, 1)
    row = ok("getChannel", query={"id": cid(1)})
    assert row["channel"]["id"] == cid(1)
    assert row["channel"]["relation"] == "subscribed"
    assert row["new_count"] == 0
    assert row["watched_90d"] is None
    err("getChannel", query={"id": cid(99)}, code="not_found")
    err("getChannel", query={"id": ""}, code="not_found")
    err("getChannel", query={}, code="not_found")


# --------------------------------------------------------------------------- PATCH /channels/{id}


def test_patch_channel_every_field_one_undo(w: Any) -> None:
    _sub(w, 1)
    w.youtube.add_channel(T.ChannelInfo(id=cid(2), title="Seguido", handle="@seg"))
    w.channels.add("@seg", actor=T.Actor.user)
    tech = w.taxonomy.create_folder("Tech")
    t1 = w.taxonomy.create_tag("a")
    t2 = w.taxonomy.create_tag("b")
    before = _snapshot(w.db)
    mark = _last_change_id(w.db)
    ch = ok(
        "patchChannel",
        {
            "favorite": True,
            "muted": True,
            "folder_id": tech.id,
            "tag_ids": [t2.id, t1.id],
            "ai_note": "nota",
            "title": "Novo título",
            "relation": "ignored",
        },
        {"id": cid(2)},
    )
    assert ch["favorite"] is True and ch["muted"] is True
    assert ch["folder_id"] == tech.id
    assert ch["tag_ids"] == sorted([t1.id, t2.id])
    assert ch["ai_note"] == "nota" and ch["title"] == "Novo título"
    assert ch["relation"] == "ignored"
    new = [r for r in w.changelog.list(limit=20) if r.id > mark]
    assert new and {r.actor for r in new} == {T.Actor.user}
    assert len({r.group_id for r in new}) == 1 and new[0].group_id is not None
    # one undo reverts everything
    undone = ok("postChangeUndo", query={"id": str(new[0].id)})["undone"]
    assert {r["id"] for r in undone} == {r.id for r in new}
    after = _snapshot(w.db)
    after.pop("changes"), before.pop("changes")
    assert after == before
    # null clears where accepted
    ok("patchChannel", {"folder_id": tech.id, "ai_note": "x"}, {"id": cid(1)})
    ch = ok("patchChannel", {"folder_id": None, "ai_note": None}, {"id": cid(1)})
    assert ch["folder_id"] is None and ch["ai_note"] is None


def test_patch_channel_relation_transitions(w: Any) -> None:
    w.youtube.add_channel(T.ChannelInfo(id=cid(2), title="Seguido", handle="@seg"))
    w.channels.add("@seg", actor=T.Actor.user)
    _sub(w, 1)
    assert ok("patchChannel", {"relation": "ignored"}, {"id": cid(2)})["relation"] == "ignored"
    assert ok("patchChannel", {"relation": "followed"}, {"id": cid(2)})["relation"] == "followed"
    assert ok("patchChannel", {"relation": "followed"}, {"id": cid(2)})["relation"] == "followed"
    snap = _snapshot(w.db)
    # subscribed → ignored/followed is not a valid transition: conflict, nothing changes
    e = err(
        "patchChannel", {"relation": "ignored", "favorite": True}, {"id": cid(1)}, code="conflict"
    )
    assert "subscribed" in e["message"]
    err("patchChannel", {"relation": "followed"}, {"id": cid(1)}, code="conflict")
    assert _snapshot(w.db) == snap


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"favorite": "sim"},
        {"muted": 1},
        {"title": ""},
        {"title": None},
        {"folder_id": 3},
        {"ai_note": 5},
        {"tag_ids": "t1"},
        {"tag_ids": [1]},
        {"relation": "subscribed"},
        {"relation": "ex"},
        {"relation": "banana"},
        {"handle": "@outro"},
        {"favourite": True},
    ],
)
def test_patch_channel_invalid(w: Any, body: dict[str, Any]) -> None:
    _sub(w, 1)
    snap = _snapshot(w.db)
    err("patchChannel", body, {"id": cid(1)}, code="invalid")
    assert _snapshot(w.db) == snap


def test_patch_channel_not_found(w: Any) -> None:
    _sub(w, 1)
    snap = _snapshot(w.db)
    err("patchChannel", {"favorite": True}, {"id": cid(99)}, code="not_found")
    err("patchChannel", {"folder_id": "f_nope"}, {"id": cid(1)}, code="not_found")
    err("patchChannel", {"favorite": True, "tag_ids": ["t_nope"]}, {"id": cid(1)}, code="not_found")
    err("patchChannel", None, {"id": cid(1)}, code="invalid")
    assert _snapshot(w.db) == snap


# --------------------------------------------------------------------------- POST /channels/batch


def test_batch_ops_and_undo(w: Any) -> None:
    ids = _sub(w, 1, 2, 3)
    tech = w.taxonomy.create_folder("Tech")
    tag = w.taxonomy.create_tag("dev")
    before = _snapshot(w.db)
    mark = _last_change_id(w.db)
    res = ok("postChannelsBatch", {"op": "move", "channel_ids": ids, "value": tech.id})
    assert res["proposed"] == [] and res["batch"]["changed"] == ids
    assert isinstance(res["batch"]["change_id"], int)
    res = ok("postChannelsBatch", {"op": "favorite", "channel_ids": [cid(1), cid(1)]})
    assert res["batch"]["changed"] == [cid(1)]
    res = ok("postChannelsBatch", {"op": "favorite", "channel_ids": [cid(1), cid(2)]})
    assert res["batch"]["changed"] == [cid(2)] and res["batch"]["skipped"] == [cid(1)]
    res = ok("postChannelsBatch", {"op": "tag", "channel_ids": [cid(3)], "value": tag.id})
    assert res["batch"]["changed"] == [cid(3)]
    ok("postChannelsBatch", {"op": "mute", "channel_ids": [cid(2)]})
    # follow on a subscribed channel is not a transition: skipped, nothing written
    res = ok("postChannelsBatch", {"op": "follow", "channel_ids": [cid(1)]})
    assert res["batch"] == {"changed": [], "skipped": [cid(1)], "change_id": None}
    rows = {r["channel"]["id"]: r["channel"] for r in ok("getChannels")["items"]}
    assert rows[cid(1)]["favorite"] and rows[cid(2)]["muted"]
    assert rows[cid(3)]["tag_ids"] == [tag.id]
    assert {r["folder_id"] for r in rows.values()} == {tech.id}
    assert _actors(w.db) >= {"user"}
    new = [r for r in w.changelog.list(limit=50) if r.id > mark]
    assert {r.actor for r in new} == {T.Actor.user}
    for rec in new:  # newest first
        ok("postChangeUndo", query={"id": str(rec.id)})
    after = _snapshot(w.db)
    after.pop("changes"), before.pop("changes")
    assert after == before


def test_batch_move_to_no_folder(w: Any) -> None:
    ids = _sub(w, 1)
    tech = w.taxonomy.create_folder("Tech")
    ok("postChannelsBatch", {"op": "move", "channel_ids": ids, "value": tech.id})
    res = ok("postChannelsBatch", {"op": "move", "channel_ids": ids, "value": None})
    assert res["batch"]["changed"] == ids
    assert ok("getChannel", query={"id": cid(1)})["channel"]["folder_id"] is None


def test_batch_partial_invalid_applies_nothing(w: Any) -> None:
    _sub(w, 1, 2)
    tech = w.taxonomy.create_folder("Tech")
    snap = _snapshot(w.db)
    e = err(
        "postChannelsBatch",
        {"op": "move", "channel_ids": [cid(1), cid(98), cid(2), cid(99)], "value": tech.id},
        code="not_found",
    )
    assert e["details"]["channel_ids"] == [cid(98), cid(99)]
    err(
        "postChannelsBatch",
        {"op": "unsubscribe", "channel_ids": [cid(1), cid(99)]},
        code="not_found",
    )
    err(
        "postChannelsBatch",
        {"op": "tag", "channel_ids": [cid(1)], "value": "t_nope"},
        code="not_found",
    )
    err(
        "postChannelsBatch",
        {"op": "move", "channel_ids": [cid(1)], "value": "f_nope"},
        code="not_found",
    )
    assert _snapshot(w.db) == snap


def test_batch_failure_mid_write_rolls_back(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    ids = _sub(w, 1, 2, 3)
    snap = _snapshot(w.db)
    real_set = w.channels._set_fields
    calls = {"n": 0}

    def flaky(channel_id: str, values: Any) -> None:
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("disco cheio")
        real_set(channel_id, values)

    monkeypatch.setattr(w.channels, "_set_fields", flaky)
    err("postChannelsBatch", {"op": "favorite", "channel_ids": ids}, code="internal")
    assert _snapshot(w.db) == snap


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"op": "move"},
        {"channel_ids": [cid(1)]},
        {"op": "approve", "channel_ids": [cid(1)]},
        {"op": "delete", "channel_ids": [cid(1)]},
        {"op": 3, "channel_ids": [cid(1)]},
        {"op": "favorite", "channel_ids": []},
        {"op": "favorite", "channel_ids": cid(1)},
        {"op": "favorite", "channel_ids": [1]},
        {"op": "move", "channel_ids": [cid(1)], "value": 7},
        {"op": "tag", "channel_ids": [cid(1)]},
        {"op": "unsubscribe", "channel_ids": [cid(1)], "reason": 3},
        {"op": "favorite", "channel_ids": [cid(1)], "via": "desktop_rpc"},
    ],
)
def test_batch_invalid(w: Any, body: dict[str, Any]) -> None:
    _sub(w, 1)
    snap = _snapshot(w.db)
    err("postChannelsBatch", body, code="invalid")
    assert _snapshot(w.db) == snap


def test_batch_unsubscribe_only_proposes(w: Any) -> None:
    ids = _sub(w, 1, 2)
    snap = _snapshot(w.db)
    res = ok(
        "postChannelsBatch",
        {"op": "unsubscribe", "channel_ids": ids, "reason": "não assisto mais"},
    )
    assert res["batch"] is None
    assert [c["channel_id"] for c in res["proposed"]] == ids
    assert {c["group"] for c in res["proposed"]} == {"manual"}
    assert {c["status"] for c in res["proposed"]} == {"pending"}
    assert {c["why"] for c in res["proposed"]} == {"não assisto mais"}
    after = _snapshot(w.db)
    # only cleanup got candidates; empty queue; relation intact; nothing approved
    assert after["unsub_queue"] == [] and _queue_rows(w.db) == []
    assert after["channels"] == snap["channels"]
    assert len(after["cleanup_candidates"]) == 2
    assert {r["relation"] for r in after["channels"]} == {"subscribed"}
    assert not w.db.query("SELECT 1 FROM cleanup_candidates WHERE status = 'approved'")


def test_batch_unsubscribe_refuses_non_subscribed_atomically(w: Any) -> None:
    _sub(w, 1)
    w.youtube.add_channel(T.ChannelInfo(id=cid(2), title="Seguido", handle="@seg"))
    w.channels.add("@seg", actor=T.Actor.user)
    snap = _snapshot(w.db)
    e = err(
        "postChannelsBatch", {"op": "unsubscribe", "channel_ids": [cid(1), cid(2)]}, code="conflict"
    )
    assert e["details"]["channel_ids"] == [cid(2)]
    assert _snapshot(w.db) == snap


def test_batch_unsubscribe_with_cleanup_unavailable(w: Any, wire: Any) -> None:
    from tube_pkg.core import cleanup as cleanup_stub_module

    _sub(w, 1)
    stub = cleanup_stub_module.CleanupStub()
    wire.set("cleanup", stub)
    snap = _snapshot(w.db)
    err("postChannelsBatch", {"op": "unsubscribe", "channel_ids": [cid(1)]}, code="conflict")
    assert _snapshot(w.db) == snap


class ApprovingCleanup:
    """Faulty cleanup: ``propose`` approves the unsubscribe (creates an ``approved`` queue item)."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner

    def propose(self, channel_ids: Any, *, reason: Any = None, actor: Any = T.Actor.user) -> Any:
        self.inner.approve(list(channel_ids), T.ApprovedVia.desktop_rpc, actor=actor)
        return []

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


def test_batch_unsubscribe_never_approves_even_if_cleanup_does(w: Any, wire: Any) -> None:
    """Route guard: an "unsubscribe" batch never leaves an ``approved`` queue item (rollback)."""
    _sub(w, 1)
    wire.set("cleanup", ApprovingCleanup(w.cleanup))
    snap = _snapshot(w.db)
    err("postChannelsBatch", {"op": "unsubscribe", "channel_ids": [cid(1)]}, code="internal")
    assert _queue_rows(w.db) == []
    assert _snapshot(w.db) == snap


# --------------------------------------------------------------------------- POST /channels/add


def test_add_by_handle_follows_and_kicks_refresh(w: Any) -> None:
    w.youtube.add_channel(
        T.ChannelInfo(
            id=cid(1), title="Marques", handle="@mkbhd", url="https://www.youtube.com/@mkbhd"
        )
    )
    tech = w.taxonomy.create_folder("Tech")
    ch = ok("postChannelsAdd", {"url_or_handle": "@MKBHD", "folder_id": tech.id})
    assert ch["id"] == cid(1)
    assert ch["relation"] == "followed" and ch["source"] == "link"
    assert ch["folder_id"] == tech.id and ch["handle"] == "@mkbhd"
    _wait(lambda: ("channel", cid(1)) in w.refresher.kicks)
    recs = w.changelog.list(limit=5)
    assert recs[0].action is T.ChangeAction.channel_add and recs[0].actor is T.Actor.user
    # shows up in Manage
    assert _ids(ok("getChannels", query={"relation": "followed"})) == [cid(1)]


def test_add_by_channel_link_and_video_link(w: Any) -> None:
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="Um"))
    feed = T.RssFeed(
        channel=T.ChannelInfo(id=cid(2), title="Dois"),
        videos=(T.VideoIn(id="abcdefghijk", channel_id=cid(2), title="x", published_at=1),),
    )
    w.youtube.add_rss(feed)
    ch = ok("postChannelsAdd", {"url_or_handle": f"https://www.youtube.com/channel/{cid(1)}"})
    assert ch["id"] == cid(1) and ch["relation"] == "followed"
    ch = ok("postChannelsAdd", {"url_or_handle": "https://youtu.be/abcdefghijk"})
    assert ch["id"] == cid(2)
    _wait(lambda: {("channel", cid(1)), ("channel", cid(2))} <= set(w.refresher.kicks))


def test_add_duplicate_is_conflict_with_existing_channel(w: Any) -> None:
    _sub(w, 1)
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="Canal 001", handle="@um"))
    w.youtube.add_channel(T.ChannelInfo(id=cid(2), title="Dois", handle="@dois"))
    ok("postChannelsAdd", {"url_or_handle": "@dois"})
    kicks = len(w.refresher.kicks)
    snap = _snapshot(w.db)
    for text in (cid(1), f"https://www.youtube.com/channel/{cid(1)}", "@dois", "@DOIS"):
        e = err("postChannelsAdd", {"url_or_handle": text}, code="conflict")
        assert e["details"]["channel"]["id"] in (cid(1), cid(2))
        assert e["details"]["channel_id"] == e["details"]["channel"]["id"]
    e = err("postChannelsAdd", {"url_or_handle": cid(1)}, code="conflict")
    assert e["details"]["channel"]["relation"] == "subscribed"
    assert _snapshot(w.db) == snap
    time.sleep(0.05)
    assert len(w.refresher.kicks) == kicks


def test_add_existing_ignored_or_ex_comes_back_as_followed(w: Any) -> None:
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="Um", handle="@um"))
    ok("postChannelsAdd", {"url_or_handle": "@um"})
    ok("patchChannel", {"relation": "ignored"}, {"id": cid(1)})
    ch = ok("postChannelsAdd", {"url_or_handle": "@um"})
    assert ch["relation"] == "followed"
    _sub(w, 2)
    w.channels.set_relation(cid(2), T.Relation.ex, actor=T.Actor.extension)
    ch = ok("postChannelsAdd", {"url_or_handle": cid(2)})
    assert ch["relation"] == "followed" and ch["unsubscribed_at"] is None
    assert "subscribed" not in {r["relation"] for r in w.db.query("SELECT relation FROM channels")}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"url_or_handle": ""},
        {"url_or_handle": "@"},
        {"url_or_handle": 42},
        {"url_or_handle": "isso não é canal nenhum"},
        {"url_or_handle": "https://example.com/@mkbhd"},
        {"url_or_handle": "@mkbhd", "folder_id": 3},
        {"url_or_handle": "@mkbhd", "folder_id": "f_nope"},
        {"url_or_handle": "@mkbhd", "relation": "subscribed"},
    ],
)
def test_add_invalid(w: Any, body: dict[str, Any]) -> None:
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="M", handle="@mkbhd"))
    snap = _snapshot(w.db)
    err("postChannelsAdd", body, code="invalid")
    assert _snapshot(w.db) == snap
    assert not [c for c in w.youtube.calls if c[0] == "resolve_channel"]


def test_add_youtube_error(w: Any) -> None:
    snap = _snapshot(w.db)
    e = err("postChannelsAdd", {"url_or_handle": "@naoexiste"}, code="youtube_error")
    assert "naoexiste" in e["message"]
    assert _snapshot(w.db) == snap
    assert w.refresher.kicks == []


class SlowYouTube(FakeYouTube):
    """``resolve_channel`` waits on a gate (slow YouTube)."""

    def __init__(self) -> None:
        super().__init__()
        self.gate = threading.Event()

    def resolve_channel(self, url_or_handle: str) -> T.ChannelInfo:
        self.gate.wait(5)
        return super().resolve_channel(url_or_handle)


def test_add_timeout_then_lands_in_background(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    slow = SlowYouTube()
    slow.add_channel(T.ChannelInfo(id=cid(1), title="Lento", handle="@lento"))
    monkeypatch.setattr(w.channels, "youtube", slow)
    monkeypatch.setattr(api_channels, "ADD_DEADLINE_S", 0.05)
    t0 = time.monotonic()
    e = err("postChannelsAdd", {"url_or_handle": "@lento"}, code="timeout")
    assert time.monotonic() - t0 < 1.0
    assert e["details"]["pending"] is True
    assert w.channels.get(cid(1)) is None
    slow.gate.set()  # YouTube answers later: the channel gets in and the feed is called
    _wait(lambda: ("channel", cid(1)) in w.refresher.kicks)
    assert w.channels.get(cid(1)).relation is T.Relation.followed


class BrokenRefresher:
    def kick_channel(self, channel_id: str) -> str:
        raise RuntimeError("refresher fora")


def test_add_works_when_refresher_breaks(w: Any, wire: Any) -> None:
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="Um", handle="@um"))
    wire.set("refresher", BrokenRefresher())
    ch = ok("postChannelsAdd", {"url_or_handle": "@um"})
    assert ch["id"] == cid(1)
    assert w.channels.get(cid(1)) is not None


def test_add_with_rss_down_shows_videos_via_channel_page(w: Any, wire: Any) -> None:
    """RSS down (404) does not prevent adding; the real ``kick_channel`` fetches through the channel
    page and the videos show up right after."""
    now = w.clock.now()
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="Novo", handle="@novo"))
    w.youtube.fail(
        "fetch_channel_rss",
        cid(1),
        T.YouTubeError(
            "feed do YouTube indisponível (HTTP 404)", status=404, feed_unavailable=True
        ),
    )
    w.youtube.uploads[cid(1)] = T.RssFeed(
        channel=T.ChannelInfo(id=cid(1), title="Novo"),
        videos=tuple(
            T.VideoIn(id=vid(1, j), channel_id=cid(1), title=f"v{j}", published_at=now - j * DAY)
            for j in range(3)
        ),
    )
    refresher = R.build(
        db=w.db,
        settings=w.settings,
        youtube=w.youtube,
        channels=w.channels,
        video_store=R.build_video_store(db=w.db, settings=w.settings, clock=w.clock),
        feed=w.feed,
        events=w.events,
        changelog=w.changelog,
        ext_endpoint_up=w.ext_endpoint_up,
        clock=w.clock,
    )
    wire.set("refresher", refresher)
    ch = ok("postChannelsAdd", {"url_or_handle": "@novo"})
    assert ch["id"] == cid(1)
    _wait(lambda: not refresher.kick_channel_active(cid(1)), timeout=10)
    rows = w.db.query("SELECT id FROM videos WHERE channel_id = ?", (cid(1),))
    assert len(rows) == 3
    assert ("fetch_channel_uploads", cid(1)) in w.youtube.calls


# --------------------------------------------------------------------------- GET /changes


def test_get_changes_paginated(w: Any) -> None:
    ids = _sub(w, 1, 2, 3)
    for op in ("favorite", "mute", "unfavorite", "unmute", "favorite"):
        ok("postChannelsBatch", {"op": op, "channel_ids": ids})
    data = ok("getChanges")
    got = [r["id"] for r in data["items"]]
    assert got == sorted(got, reverse=True) and len(got) == 5
    assert all(r["actor"] == "user" and r["action"] == "channel_batch" for r in data["items"])
    first = ok("getChanges", query={"limit": "2"})["items"]
    assert [r["id"] for r in first] == got[:2]
    second = ok("getChanges", query={"limit": "2", "before_id": str(first[-1]["id"])})["items"]
    assert [r["id"] for r in second] == got[2:4]
    tail = ok("getChanges", query={"limit": "200", "before_id": str(second[-1]["id"])})["items"]
    assert [r["id"] for r in tail] == got[4:]
    assert ok("getChanges", query={"before_id": str(got[-1])}) == {"items": []}


@pytest.mark.parametrize(
    "query",
    [{"limit": "0"}, {"limit": "201"}, {"limit": "x"}, {"before_id": "abc"}, {"before_id": "1.5"}],
)
def test_get_changes_invalid(w: Any, query: dict[str, str]) -> None:
    err("getChanges", query=query, code="invalid")


def test_get_changes_lists_every_kind_of_entry(w: Any) -> None:
    """Entries from several owners (channel, folder, cleanup) pass the strict schema."""
    _sub(w, 1)
    w.taxonomy.create_folder("Tech")
    ok("patchChannel", {"favorite": True, "tag_ids": []}, {"id": cid(1)})
    w.youtube.add_channel(T.ChannelInfo(id=cid(2), title="Dois", handle="@dois"))
    ok("postChannelsAdd", {"url_or_handle": "@dois"})
    w.cleanup.approve([cid(1)], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    items = ok("getChanges", query={"limit": "200"})["items"]
    assert {r["action"] for r in items} >= {"channel_update", "channel_add", "cleanup_approve"}


# --------------------------------------------------------------------------- undo


def test_do_list_undo_list(w: Any) -> None:
    _sub(w, 1, 2)
    tech = w.taxonomy.create_folder("Tech")
    listed = ok("getChannels")
    ok("postChannelsBatch", {"op": "move", "channel_ids": [cid(1), cid(2)], "value": tech.id})
    moved = ok("getChannels", query={"folder": tech.id})
    assert moved["total"] == 2
    entry = ok("getChanges", query={"limit": "1"})["items"][0]
    assert entry["action"] == "channel_batch" and entry["undone_at"] is None
    undone = ok("postChangeUndo", query={"id": str(entry["id"])})["undone"]
    assert [r["id"] for r in undone] == [entry["id"]]
    assert undone[0]["undone_at"] is not None
    assert ok("getChannels") == listed
    assert ok("getChannels", query={"folder": tech.id})["total"] == 0
    assert ok("getChanges", query={"limit": "1"})["items"][0]["undone_at"] is not None
    e = err("postChangeUndo", query={"id": str(entry["id"])}, code="undo_refused")
    assert e["reason"] == "already_undone"


def test_undo_not_found(w: Any) -> None:
    err("postChangeUndo", query={"id": "999999"}, code="not_found")
    err("postChangeUndo", query={"id": "abc"}, code="not_found")
    err("postChangeUndo", query={"id": "-3"}, code="not_found")
    err("postChangeUndo", query={}, code="not_found")


def _executed_unsubscribe(w: Any, channel_id: str, status: str = "done") -> None:
    """Unsubscribe approved (cleanup) and executed by the extension (queue ``status``)."""
    w.cleanup.approve([channel_id], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    w.clock.advance(5)
    w.db.execute("UPDATE unsub_queue SET status = ? WHERE channel_id = ?", (status, channel_id))
    if status == "done":
        w.channels.set_relation(channel_id, T.Relation.ex, actor=T.Actor.extension)


@pytest.mark.parametrize("status", ["running", "done", "failed"])
def test_undo_executed_cancellation_is_refused(w: Any, status: str) -> None:
    _sub(w, 1)
    _executed_unsubscribe(w, cid(1), status)
    snap = _snapshot(w.db)
    for rec in w.changelog.list(limit=10):
        e = err("postChangeUndo", query={"id": str(rec.id)}, code="undo_refused")
        assert e["reason"] == "already_executed", rec
        assert "Resubscribe" in e["message"]
    assert _snapshot(w.db) == snap


class PermissiveCleanup:
    """Faulty cleanup: undoes the approval even of an item already executed."""

    def __init__(self, db: Any) -> None:
        self.db = db
        self.calls: list[int] = []

    def apply_undo(self, change: T.ChangeRecord) -> None:
        self.calls.append(change.id)
        for qid in change.undo.queue_ids:  # type: ignore[union-attr]
            self.db.execute("UPDATE unsub_queue SET status = 'undone' WHERE id = ?", (qid,))


def test_undo_guard_refuses_executed_queue_even_if_owner_would_undo(w: Any, wire: Any) -> None:
    """Route guard: an already executed unsubscribe is not undone, even if the owner allows it."""
    _sub(w, 1)
    _executed_unsubscribe(w, cid(1), "done")
    approve = next(
        r for r in w.changelog.list(limit=10) if r.action is T.ChangeAction.cleanup_approve
    )
    spy = PermissiveCleanup(w.db)
    wire.set("cleanup", spy)
    snap = _snapshot(w.db)
    e = err("postChangeUndo", query={"id": str(approve.id)}, code="undo_refused")
    assert e["reason"] == "already_executed"
    assert spy.calls == []
    assert _snapshot(w.db) == snap


def test_undo_pending_approval_is_allowed(w: Any) -> None:
    _sub(w, 1)
    w.cleanup.approve([cid(1)], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    rec = w.changelog.list(limit=1)[0]
    assert rec.action is T.ChangeAction.cleanup_approve
    undone = ok("postChangeUndo", query={"id": str(rec.id)})["undone"]
    assert [r["id"] for r in undone] == [rec.id]
    assert {r["status"] for r in _queue_rows(w.db)} == {"undone"}


class QueueCreatingCleanup:
    """Faulty cleanup: the undo creates a queue item."""

    def __init__(self, db: Any, clock: Any) -> None:
        self.db = db
        self.clock = clock

    def apply_undo(self, change: T.ChangeRecord) -> None:
        now = self.clock.now()
        self.db.execute(
            "INSERT INTO unsub_queue (id, channel_id, action, approved_at, approved_via, status,"
            " created_at, updated_at) VALUES ('q_bad', ?, 'unsubscribe', ?, 'desktop_rpc',"
            " 'approved', ?, ?)",
            (cid(1), now, now, now),
        )


def test_undo_never_creates_queue_item(w: Any, wire: Any) -> None:
    _sub(w, 1)
    w.cleanup.approve([cid(1)], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    rec = w.changelog.list(limit=1)[0]
    w.db.execute("UPDATE unsub_queue SET status = 'undone'")
    wire.set("cleanup", QueueCreatingCleanup(w.db, w.clock))
    snap = _snapshot(w.db)
    e = err("postChangeUndo", query={"id": str(rec.id)}, code="undo_refused")
    assert e["reason"] == "not_undoable"
    assert _snapshot(w.db) == snap


def test_undo_group_is_all_or_nothing(w: Any) -> None:
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="Um", handle="@um"))
    ok("postChannelsAdd", {"url_or_handle": "@um"})
    ok("patchChannel", {"favorite": True, "relation": "ignored"}, {"id": cid(1)})
    group_entry = w.changelog.list(limit=1)[0]
    assert group_entry.group_id is not None
    # the relation changed afterwards (ignored → followed): undoing the group refuses as a whole
    ok("patchChannel", {"relation": "followed"}, {"id": cid(1)})
    snap = _snapshot(w.db)
    e = err("postChangeUndo", query={"id": str(group_entry.id)}, code="undo_refused")
    assert e["reason"] == "not_undoable"
    assert _snapshot(w.db) == snap
    assert w.channels.get(cid(1)).favorite is True


class StubOrganizer:
    __contract_stub__ = "organize"

    def apply_undo(self, change: T.ChangeRecord) -> None:
        raise NotImplementedError("stub: Organizer.apply_undo")


def test_undo_with_owner_still_stub_is_refused(w: Any, wire: Any) -> None:
    rec = w.changelog.record(
        T.Actor.user,
        T.ChangeAction.organize_accept,
        {"label": "organizar"},
        T.UndoOrganizeAccept(suggestion_ids=("s1",)),
    )
    wire.set("organizer", StubOrganizer())
    e = err("postChangeUndo", query={"id": str(rec.id)}, code="undo_refused")
    assert e["reason"] == "not_undoable"
    assert w.changelog.get(rec.id).undone_at is None


# --------------------------------------------------------------------------- global rules


def test_rest_routes_never_approve_and_always_record_user(w: Any) -> None:
    ids = _sub(w, 1, 2, 3)
    tech = w.taxonomy.create_folder("Tech")
    w.youtube.add_channel(T.ChannelInfo(id=cid(4), title="Quatro", handle="@quatro"))
    mark = _last_change_id(w.db)
    ok("postChannelsAdd", {"url_or_handle": "@quatro", "folder_id": tech.id})
    ok("patchChannel", {"favorite": True, "relation": "ignored"}, {"id": cid(4)})
    for op in ("favorite", "mute", "follow", "ignore"):
        ok("postChannelsBatch", {"op": op, "channel_ids": ids})
    ok("postChannelsBatch", {"op": "move", "channel_ids": ids, "value": tech.id})
    ok("postChannelsBatch", {"op": "unsubscribe", "channel_ids": ids})
    for rec in w.changelog.list(limit=50):
        if rec.id > mark and rec.undone_at is None:
            call("postChangeUndo", query={"id": str(rec.id)})
    assert _queue_rows(w.db) == []
    assert not w.db.query("SELECT 1 FROM cleanup_candidates WHERE status = 'approved'")
    actors = {r["actor"] for r in w.db.query("SELECT actor FROM changes WHERE id > ?", (mark,))}
    assert actors == {"user"}


def test_400_channels_list_with_filter_and_order(w: Any) -> None:
    n = 400
    titles = {i: f"{'ÁÉÍÓÚ'[i % 5]}canal {i:03d}" for i in range(n)}
    ids = _sub(w, *range(n), titles=titles)
    folders = [w.taxonomy.create_folder(f"Pasta {k}") for k in range(8)]
    tag = w.taxonomy.create_tag("dev")
    for k, folder in enumerate(folders):
        w.channels.batch(T.BatchOp.move, ids[k::8], value=folder.id, actor=T.Actor.user)
    w.channels.batch(T.BatchOp.tag, ids[::3], value=tag.id, actor=T.Actor.user)
    w.channels.batch(T.BatchOp.favorite, ids[::7], actor=T.Actor.user)
    now = w.clock.now()
    w.db.executemany(
        "INSERT INTO videos (id, channel_id, title, published_at, first_seen_at, origin)"
        " VALUES (?, ?, ?, ?, ?, 'rss')",
        [(vid(i, j), cid(i), "v", now - j * DAY, now) for i in range(n) for j in range(15)],
    )
    w.db.executemany(
        "INSERT INTO watch_history (video_id, channel_id, watched_at) VALUES (?, ?, ?)",
        [(vid(i, 1), cid(i), now - DAY) for i in range(0, n, 2)],
    )
    timings: dict[str, float] = {}

    def timed(label: str, query: dict[str, str]) -> Any:
        t0 = time.perf_counter()
        data = ok("getChannels", query=query)
        timings[label] = (time.perf_counter() - t0) * 1000
        return data

    full = timed("todos (limit 2000)", {"limit": "2000"})
    assert full["total"] == n and len(full["items"]) == n
    keys = [
        (dedup.normalize_name(r["channel"]["title"]), r["channel"]["id"]) for r in full["items"]
    ]
    assert keys == sorted(keys)
    assert (
        full["items"][0]["channel"]["title"] == "Ácanal 000"
    )  # an accent does not push it to the end
    filtered = timed(
        "inscritos + pasta + tag + busca",
        {"relation": "subscribed,followed", "folder": folders[0].id, "tag": tag.id, "q": "canal"},
    )
    assert filtered["total"] == len([i for i in range(0, n, 8) if i % 3 == 0])
    page = timed("página 50 com ⭐", {"favorite": "true", "limit": "50", "offset": "10"})
    assert page["total"] == len(ids[::7])
    assert all(r["new_count"] == 15 for r in full["items"])
    assert {r["watched_90d"] for r in full["items"]} == {0, 1}
    print("\nB04b 400 canais (ms): " + ", ".join(f"{k}={v:.1f}" for k, v in timings.items()))
    assert max(timings.values()) < 2000, timings


# --------------------------------------------------------------------------- utility


def _wait(cond: Any, timeout: float = 5.0) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return
        time.sleep(0.01)
    assert cond(), "condition did not happen in time"
