"""``ChannelService`` (``core/channels.py``) and ``ChangeLog`` (``core/changes.py``).

Real database (``core.db.build``). For conformance, the world of fakes is built with the two
real ones in place of ``FakeChangeLog``/``FakeChannelService`` (same composition as
``build_fake_world``) and runs the fake's own suite: queue invariants, ``seed_world`` and the
service tests in ``tests/test_fakes.py``.
"""

from __future__ import annotations

import inspect
import json
import threading
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import fakes.world as fake_world_module
import pytest
import test_fakes
from fakes import (
    FakeChangeLog,
    FakeChannelService,
    FakeClock,
    FakeSettings,
    FakeYouTube,
    MemDb,
    build_fake_world,
)
from fakes import seed_world as _seed
from fakes.invariants import INVARIANTS, QueueImpls

from tube_pkg.core import changes as CG
from tube_pkg.core import channels as CH
from tube_pkg.core import db as core_db
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]


def cid(n: int) -> str:
    """Valid channel id (``UC`` + 22)."""
    return f"UCb04test{n:015d}"


def vid(n: int) -> str:
    return f"b04vid{n:05d}"


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "b04.db"))
    yield db
    db.close()


@pytest.fixture
def yt() -> FakeYouTube:
    return FakeYouTube()


@pytest.fixture
def svc(rdb: Any, clock: FakeClock, yt: FakeYouTube) -> SimpleNamespace:
    """Only the two real ones over the real database."""
    settings = FakeSettings()
    changelog = CG.build(db=rdb, settings=settings, clock=clock)
    channels = CH.build(db=rdb, settings=settings, youtube=yt, changelog=changelog, clock=clock)
    return SimpleNamespace(
        db=rdb,
        clock=clock,
        yt=yt,
        changelog=changelog,
        channels=channels,
        targets=T.UndoTargets(channels=channels),
    )


def _real_factories(monkeypatch: pytest.MonkeyPatch) -> None:
    """``build_fake_world`` now builds the real ``ChangeLog`` and ``ChannelService``."""

    def make_changelog(db: Any, *, clock: Any = None, ids: Any = None) -> Any:
        return CG.build(db=db, settings=FakeSettings(), clock=clock)

    def make_channels(
        db: Any, *, changelog: Any, youtube: Any = None, clock: Any = None, ids: Any = None
    ) -> Any:
        return CH.build(
            db=db,
            settings=FakeSettings(),
            youtube=youtube or FakeYouTube(),
            changelog=changelog,
            clock=clock,
        )

    monkeypatch.setattr(fake_world_module, "FakeChangeLog", make_changelog)
    monkeypatch.setattr(fake_world_module, "FakeChannelService", make_channels)


@pytest.fixture
def real(monkeypatch: pytest.MonkeyPatch) -> None:
    _real_factories(monkeypatch)


@pytest.fixture
def rw(real: None, rdb: Any, clock: FakeClock) -> Any:
    """World of fakes with real ``changelog``/``channels``, real database."""
    world = build_fake_world(rdb, clock=clock)
    assert isinstance(world.channels, CH.ChannelService)
    assert isinstance(world.changelog, CG.ChangeLog)
    return world


def _snapshot(db: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = db.query("SELECT * FROM channels ORDER BY id")
    for r in rows:
        r.pop("updated_at", None)
    tags = db.query("SELECT * FROM channel_tags ORDER BY channel_id, tag_id")
    return rows, tags


def _sub(channels: Any, *ns: int, relation: T.Relation = T.Relation.subscribed) -> list[str]:
    ids = [cid(n) for n in ns]
    channels.upsert_many(
        [T.ChannelIn(title=f"Canal {n}", channel_id=cid(n)) for n in ns],
        source=T.ChannelSource.extension,
        relation=relation,
        actor=T.Actor.extension,
    )
    return ids


# --------------------------------------------------------------------------- contract


def test_build_signatures_match_contract() -> None:
    assert T.BUILD_SIGNATURES["plugin/core/changes.py:build"] == (
        "build(*, db, settings, clock=None) -> ChangeLog"
    )
    assert T.BUILD_SIGNATURES["plugin/core/channels.py:build"] == (
        "build(*, db, settings, youtube, changelog, clock=None) -> ChannelService"
    )
    for fn, names in (
        (CG.build, ["db", "settings", "clock"]),
        (CH.build, ["db", "settings", "youtube", "changelog", "clock"]),
    ):
        params = inspect.signature(fn).parameters
        assert list(params) == names
        assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params.values())
        assert params["clock"].default is None
        assert all(p.default is inspect.Parameter.empty for n, p in params.items() if n != "clock")


def _shape(fn: Any) -> list[tuple[str, Any, Any]]:
    return [
        (p.name, p.kind, p.default)
        for p in inspect.signature(fn).parameters.values()
        if p.name != "self"
    ]


def _protocol_methods(proto: type) -> list[str]:
    names: set[str] = set()
    for klass in proto.__mro__:
        if klass is object or not getattr(klass, "_is_protocol", False):
            continue
        names |= {n for n, v in vars(klass).items() if not n.startswith("_") and callable(v)}
    return sorted(names)


@pytest.mark.parametrize(
    ("proto", "impl"),
    [
        ("ChannelService", CH.ChannelService),
        ("ChangeLog", CG.ChangeLog),
        ("Undoable", CH.ChannelService),
    ],
)
def test_methods_match_protocol(proto: str, impl: type) -> None:
    """Same parameters as the ``Protocol``; extras only at the end, keyword-only, defaulted."""
    protocol = getattr(T, proto)
    for name in _protocol_methods(protocol):
        want = _shape(getattr(protocol, name))
        got = _shape(getattr(impl, name))
        assert got[: len(want)] == want, name
        for extra in got[len(want) :]:
            assert extra[1] is inspect.Parameter.KEYWORD_ONLY, (name, extra)
            assert extra[2] is not inspect.Parameter.empty, (name, extra)


def test_build_is_inert_and_satisfies_protocols(svc: SimpleNamespace) -> None:
    before = threading.active_count()
    settings = FakeSettings()
    log = CG.build(db=svc.db, settings=settings)
    ch = CH.build(db=svc.db, settings=settings, youtube=svc.yt, changelog=log)
    assert isinstance(log, T.ChangeLog)
    assert isinstance(ch, T.ChannelService) and isinstance(ch, T.Undoable)
    assert threading.active_count() == before
    assert svc.yt.calls == []
    assert svc.db.query("SELECT COUNT(*) AS n FROM changes") == [{"n": 0}]


@pytest.mark.parametrize("module", [CH, CG])
def test_core_module_hygiene(module: Any) -> None:
    source = Path(module.__file__).read_text(encoding="utf-8")
    for forbidden in (
        "os.environ",
        "getenv",
        "HERMES_HOME",
        "TUBE_DB_PATH",
        "from plugin",
        "import threading",
        "eval(",
    ):
        assert forbidden not in source, forbidden
    for other in ("cleanup", "taxonomy", "refresh", "feed", "sync", "youtube", "db"):
        assert f"tube_pkg.core.{other}" not in source
        assert f"tube_pkg.core import {other}" not in source


def test_world_fixture_uses_real_db(rw: Any) -> None:
    assert isinstance(rw.db, core_db.SqliteDb)
    assert rw.db.path.endswith("b04.db")


# --------------------------------------------------------------------------- add + dedup


def test_add_by_handle_url_id_and_video_link_dedup(svc: SimpleNamespace) -> None:
    ch, yt = svc.channels, svc.yt
    info = yt.add_channel(
        T.ChannelInfo(
            id=cid(1),
            title="Bê",
            handle="@Be",
            thumb="https://yt3.ggpht.com/be.jpg",
            url="https://www.youtube.com/@Be",
        )
    )
    yt.video_owner[vid(1)] = info.id

    first = ch.add("@Be")
    assert first.id == cid(1)
    assert first.relation is T.Relation.followed and first.source is T.ChannelSource.link
    assert first.handle == "@be", "canonical handle"
    assert first.thumb == info.thumb
    resolves = [c for c in yt.calls if c[0] == "resolve_channel"]
    assert len(resolves) == 1

    # handle in another spelling, channel URL and raw id: local dedup, no network
    for text in (
        "@BE",
        "https://www.youtube.com/@be/videos",
        cid(1),
        f"youtube.com/channel/{cid(1)}",
    ):
        assert ch.add(text).id == cid(1), text
    assert len([c for c in yt.calls if c[0] == "resolve_channel"]) == 1

    # video link: needs resolving (network), but lands on the same channel
    for text in (f"https://www.youtube.com/watch?v={vid(1)}", f"https://youtu.be/{vid(1)}"):
        assert ch.add(text).id == cid(1), text
    assert svc.db.query("SELECT COUNT(*) AS n FROM channels") == [{"n": 1}]
    adds = [r for r in svc.changelog.list() if r.action is T.ChangeAction.channel_add]
    assert len(adds) == 1, "repeating the add writes no history"


def test_add_rules_and_errors(svc: SimpleNamespace) -> None:
    ch, yt = svc.channels, svc.yt
    yt.add_channel(T.ChannelInfo(id=cid(1), title="A", handle="@a"))
    for rel in (T.Relation.subscribed, T.Relation.ex):
        with pytest.raises(T.Conflict):
            ch.add("@a", relation=rel)
    for bad in ("", "   ", "mkbhd", "https://example.com/@a", 42):
        with pytest.raises(T.ValidationError):
            ch.add(bad)  # type: ignore[arg-type]
    with pytest.raises(T.YouTubeError):
        ch.add("@naoexiste")
    with pytest.raises(T.NotFound):
        ch.add("@a", folder_id="pasta-que-nao-existe")
    assert ch.list() == []
    assert svc.changelog.list() == []

    no_yt = CH.build(db=svc.db, settings=FakeSettings(), youtube=None, changelog=svc.changelog)
    with pytest.raises(T.YouTubeError):
        no_yt.add("@a")


def test_add_existing_ignored_or_ex_comes_back_and_undo_restores(rw: Any) -> None:
    w = rw
    (a,) = _sub(w.channels, 1)
    (b,) = _sub(w.channels, 2, relation=T.Relation.followed)
    w.channels.set_relation(a, T.Relation.ex)
    w.channels.set_relation(b, T.Relation.ignored)
    folder = w.taxonomy.create_folder("Volta")
    before = _snapshot(w.db)

    back = w.channels.add(a, folder_id=folder.id)
    assert back.relation is T.Relation.followed and back.unsubscribed_at is None
    assert back.folder_id == folder.id
    rec = w.changelog.list()[0]
    assert rec.action is T.ChangeAction.channel_add and rec.undo.before is not None
    assert w.channels.add(b).relation is T.Relation.followed
    assert w.channels.add(b).relation is T.Relation.followed, "second time: no-op"

    for r in [r for r in w.changelog.list() if r.action is T.ChangeAction.channel_add]:
        w.changelog.undo(r.id, targets=w.targets())
    assert _snapshot(w.db) == before


def test_find_duplicate_rules(svc: SimpleNamespace) -> None:
    ch = svc.channels
    ch.upsert_many(
        [
            T.ChannelIn(title="Música Boa", channel_id=cid(1), handle="@musica"),
            T.ChannelIn(
                title="Ciência", channel_id=cid(2), url="https://www.youtube.com/c/Ciencia"
            ),
            T.ChannelIn(title="Repetido", channel_id=cid(3)),
            T.ChannelIn(title="repetido", channel_id=cid(4)),
        ],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    assert ch.find_duplicate(channel_id=cid(1)).id == cid(1)
    assert ch.find_duplicate(handle="@MUSICA").id == cid(1)
    assert ch.find_duplicate(url="https://m.youtube.com/@musica?si=x").id == cid(1)
    assert ch.find_duplicate(url="youtube.com/c/ciencia").id == cid(2)
    assert ch.find_duplicate(title="MUSICA boa").id == cid(1), "name only, no strong key"
    assert ch.find_duplicate(title="Repetido") is None, "an ambiguous name does not decide"
    # with a strong key, the name does not decide
    assert ch.find_duplicate(channel_id=cid(9), title="Música Boa") is None
    assert ch.find_duplicate(handle="@outro", title="Música Boa") is None
    assert ch.find_duplicate(url=f"https://youtu.be/{vid(1)}") is None, "a video yields no key"
    assert ch.find_duplicate() is None


def test_upsert_many_dedup_idempotent_and_resolution(svc: SimpleNamespace) -> None:
    ch, yt = svc.channels, svc.yt
    yt.add_channel(T.ChannelInfo(id=cid(5), title="Resolvido", handle="@resolvido"))
    items = [
        T.ChannelIn(title="Um", channel_id=cid(1), handle="@um", thumb="t1"),
        T.ChannelIn(title="Um de novo", channel_id=cid(1)),  # repeated in the same batch
        T.ChannelIn(title="Dois", handle="@um"),  # no id: matched by handle
        T.ChannelIn(title="Resolvido", handle="@resolvido"),  # no id: resolved over the network
        T.ChannelIn(title="Sumido", handle="@sumido"),  # does not resolve
        T.ChannelIn(title="Lixo", channel_id="nao-e-id"),
    ]
    report = ch.upsert_many(items, source=T.ChannelSource.extension, relation=T.Relation.subscribed)
    assert set(report.inserted) == {cid(1), cid(5)}
    assert report.updated == (), "inserted in the same batch does not count as updated"
    assert set(report.duplicates.values()) == {cid(1)}
    assert set(report.unresolved) == {"Sumido", "Lixo"}
    assert ch.get(cid(1)).title == "Dois", "the newer title wins"
    assert svc.changelog.list() == [], "sync writes no history"
    before = _snapshot(svc.db)
    again = ch.upsert_many(
        [
            T.ChannelIn(title="Dois", channel_id=cid(1)),
            T.ChannelIn(title="Resolvido", channel_id=cid(5)),
        ],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    assert again.inserted == () and again.updated == ()
    assert _snapshot(svc.db) == before, "idempotente"


def test_upsert_many_relation_and_user_fields(rw: Any) -> None:
    w = rw
    folder = w.taxonomy.create_folder("F")
    tag = w.taxonomy.create_tag("t")
    w.channels.upsert_many(
        [
            T.ChannelIn(
                title="A", channel_id=cid(1), folder_id=folder.id, tag_ids=(tag.id,), favorite=True
            )
        ],
        source=T.ChannelSource.mytube,
    )
    a = w.channels.get(cid(1))
    assert a.relation is T.Relation.followed and a.favorite and a.folder_id == folder.id
    other = w.taxonomy.create_folder("G")
    w.channels.upsert_many(
        [T.ChannelIn(title="A", channel_id=cid(1), folder_id=other.id, tag_ids=(), favorite=False)],
        source=T.ChannelSource.extension,
    )
    a2 = w.channels.get(cid(1))
    assert (a2.folder_id, a2.tag_ids, a2.favorite) == (folder.id, (tag.id,), True), "left untouched"
    assert a2.relation is T.Relation.followed, "without relation, it does not change"
    w.channels.upsert_many(
        [T.ChannelIn(title="A", channel_id=cid(1))],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    assert w.channels.get(cid(1)).relation is T.Relation.subscribed
    # invalid transition (subscribed → followed) is ignored, does not raise
    w.channels.upsert_many(
        [T.ChannelIn(title="A", channel_id=cid(1))],
        source=T.ChannelSource.extension,
        relation=T.Relation.followed,
    )
    assert w.channels.get(cid(1)).relation is T.Relation.subscribed
    # a missing folder/tag does not break the batch
    rep = w.channels.upsert_many(
        [T.ChannelIn(title="B", channel_id=cid(2), folder_id="sumiu", tag_ids=("sumiu",))],
        source=T.ChannelSource.mytube,
    )
    assert rep.inserted == (cid(2),)
    b = w.channels.get(cid(2))
    assert b.folder_id is None and b.tag_ids == ()


def test_upsert_many_by_user_is_one_undoable_group(rw: Any) -> None:
    w = rw
    (a,) = _sub(w.channels, 1, relation=T.Relation.followed)
    before = _snapshot(w.db)
    w.channels.upsert_many(
        [T.ChannelIn(title="Novo título", channel_id=a), T.ChannelIn(title="B", channel_id=cid(2))],
        source=T.ChannelSource.mytube,
        relation=T.Relation.followed,
        actor=T.Actor.user,
    )
    recs = w.changelog.list()
    assert len(recs) == 2 and len({r.group_id for r in recs}) == 1 and recs[0].group_id
    w.changelog.undo(recs[-1].id, targets=w.targets())
    assert _snapshot(w.db) == before


def test_handle_moving_to_another_channel_never_breaks(svc: SimpleNamespace) -> None:
    ch = svc.channels
    _sub(ch, 1)
    ch.update(cid(1), T.ChannelPatch(handle="@troca"))
    rep = ch.upsert_many(
        [T.ChannelIn(title="Novo dono", channel_id=cid(2), handle="@troca")],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    assert rep.inserted == (cid(2),)
    assert ch.get(cid(2)).handle == "@troca"
    assert ch.get(cid(1)).handle is None, "the handle changed owner"
    with pytest.raises(T.Conflict):
        ch.update(cid(1), T.ChannelPatch(handle="@TROCA"))


# ------------------------------------------------------------------------- do/undo per action


def _prepare(w: Any) -> SimpleNamespace:
    a, b, c = _sub(w.channels, 1, 2, 3)
    (d, e) = _sub(w.channels, 4, 5, relation=T.Relation.followed)
    w.channels.set_relation(e, T.Relation.ignored)
    f1 = w.taxonomy.create_folder("F1")
    f2 = w.taxonomy.create_folder("F2")
    t1 = w.taxonomy.create_tag("t1")
    t2 = w.taxonomy.create_tag("t2")
    w.channels.move([a], f1.id)
    w.channels.set_tags(a, [t1.id])
    w.channels.update(b, T.ChannelPatch(favorite=True, muted=True))
    w.db.execute("DELETE FROM changes")
    return SimpleNamespace(a=a, b=b, c=c, d=d, e=e, f1=f1.id, f2=f2.id, t1=t1.id, t2=t2.id)


def _batch_action(op: T.BatchOp) -> Any:
    def run(w: Any, s: SimpleNamespace) -> Any:
        value = {T.BatchOp.move: s.f2, T.BatchOp.tag: s.t2, T.BatchOp.untag: s.t1}.get(op)
        return w.channels.batch(op, [s.a, s.b, s.c, s.d, s.e], value=value)

    return run


ACTIONS: dict[str, Any] = {
    "channel_add": lambda w, s: w.channels.add(cid(9)),
    "channel_update": lambda w, s: w.channels.update(
        s.a,
        T.ChannelPatch(
            title="Novo", favorite=True, muted=True, ai_note="nota", folder_id=None, handle="@novo"
        ),
    ),
    "channel_relation": lambda w, s: w.channels.set_relation(s.c, T.Relation.ex, reason="teste"),
    "channel_relation_ignore": lambda w, s: w.channels.set_relation(s.d, T.Relation.ignored),
    "channel_move": lambda w, s: w.channels.move([s.a, s.b, s.c], s.f2),
    "channel_move_none": lambda w, s: w.channels.move([s.a], None),
    "channel_tags": lambda w, s: w.channels.set_tags(s.a, [s.t2]),
    **{f"channel_batch_{op.value}": _batch_action(op) for op in T.BatchOp},
}


@pytest.mark.parametrize("name", list(ACTIONS))
def test_do_and_undo_per_action(rw: Any, name: str) -> None:
    w = rw
    w.youtube.add_channel(T.ChannelInfo(id=cid(9), title="Nove", handle="@nove"))
    s = _prepare(w)
    before = _snapshot(w.db)
    ACTIONS[name](w, s)
    after = _snapshot(w.db)
    assert after != before, "the action changed something"
    recs = w.changelog.list()
    assert len(recs) == 1, [r.action for r in recs]
    rec = recs[0]
    expected = name.removesuffix("_ignore").removesuffix("_none")
    if expected.startswith("channel_batch"):
        expected = "channel_batch"
    assert rec.action.value == expected
    assert isinstance(rec.undo, T.UNDO_TYPES[rec.action])
    assert rec.actor is T.Actor.user
    # undo returns exactly to the previous state, and only once
    undone = w.changelog.undo(rec.id, targets=w.targets())
    assert [u.id for u in undone] == [rec.id] and undone[0].undone_at is not None
    assert _snapshot(w.db) == before
    with pytest.raises(T.UndoRefused) as refused:
        w.changelog.undo(rec.id, targets=w.targets())
    assert refused.value.reason == "already_undone"
    assert _snapshot(w.db) == before
    # the record survives a round trip through the database (JSON)
    again = w.changelog.get(rec.id)
    assert again.undo == rec.undo and again.payload == rec.payload


def test_noop_actions_record_nothing(rw: Any) -> None:
    w = rw
    s = _prepare(w)
    w.channels.update(s.a, T.ChannelPatch())
    w.channels.update(s.b, T.ChannelPatch(favorite=True))
    w.channels.set_relation(s.a, T.Relation.subscribed)
    assert w.channels.move([s.a], s.f1) == 0
    w.channels.set_tags(s.a, [s.t1, s.t1])
    res = w.channels.batch(T.BatchOp.favorite, [s.b])
    assert res.changed == () and res.skipped == (s.b,) and res.change_id is None
    assert w.channels.batch(T.BatchOp.favorite, []) == T.BatchResult()
    assert w.changelog.list() == []


def test_update_validation(rw: Any) -> None:
    w = rw
    s = _prepare(w)
    bad = [
        T.ChannelPatch(title=""),
        T.ChannelPatch(title="   "),
        T.ChannelPatch(title=None),
        T.ChannelPatch(handle="tem espaço"),
        T.ChannelPatch(favorite="sim"),
        T.ChannelPatch(muted=1),
        T.ChannelPatch(ai_note=3),
    ]
    before = _snapshot(w.db)
    for patch in bad:
        with pytest.raises(T.ValidationError):
            w.channels.update(s.a, patch)
    with pytest.raises(T.NotFound):
        w.channels.update(s.a, T.ChannelPatch(folder_id="nao-existe"))
    with pytest.raises(T.NotFound):
        w.channels.update(cid(99), T.ChannelPatch(title="x"))
    with pytest.raises(T.NotFound):
        w.channels.set_tags(s.a, ["nao-existe"])
    with pytest.raises(T.NotFound):
        w.channels.move([s.a], "nao-existe")
    assert _snapshot(w.db) == before and w.changelog.list() == []


# --------------------------------------------------------------------------- atomic batch


def test_batch_missing_channel_or_bad_value_changes_nothing(rw: Any) -> None:
    w = rw
    s = _prepare(w)
    before = _snapshot(w.db)
    with pytest.raises(T.NotFound):
        w.channels.batch(T.BatchOp.favorite, [s.a, cid(99), s.c])
    with pytest.raises(T.NotFound):
        w.channels.batch(T.BatchOp.move, [s.a], value="nao-existe")
    with pytest.raises(T.NotFound):
        w.channels.batch(T.BatchOp.tag, [s.a], value="nao-existe")
    with pytest.raises(T.ValidationError):
        w.channels.batch(T.BatchOp.tag, [s.a], value=None)
    for op in ("unsubscribe", "cancel", "delete", ""):
        with pytest.raises(T.ValidationError):
            w.channels.batch(op, [s.a])  # type: ignore[arg-type]
    assert _snapshot(w.db) == before and w.changelog.list() == []


def test_batch_failure_in_the_middle_writes_nothing(
    rw: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    w = rw
    s = _prepare(w)
    before = _snapshot(w.db)
    real_set = w.channels._set_fields
    calls = {"n": 0}

    def flaky(channel_id: str, values: Any) -> None:
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("falha no meio do lote")
        real_set(channel_id, values)

    monkeypatch.setattr(w.channels, "_set_fields", flaky)
    with pytest.raises(RuntimeError):
        w.channels.batch(T.BatchOp.mute, [s.a, s.c, s.d, s.b])
    assert calls["n"] == 3
    monkeypatch.setattr(w.channels, "_set_fields", real_set)
    assert _snapshot(w.db) == before
    assert w.changelog.list() == []

    # a failure writing the history also rolls back the batch
    def broken_record(*a: Any, **k: Any) -> Any:
        raise RuntimeError("histórico fora do ar")

    monkeypatch.setattr(w.changelog, "record", broken_record)
    with pytest.raises(RuntimeError):
        w.channels.batch(T.BatchOp.favorite, [s.a, s.c])
    with pytest.raises(RuntimeError):
        w.channels.move([s.a, s.c], s.f2)
    assert _snapshot(w.db) == before


def test_upsert_failure_in_the_middle_writes_nothing(
    svc: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    ch = svc.channels
    real_insert = ch._insert
    calls = {"n": 0}

    def flaky(**kw: Any) -> None:
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("falha no segundo")
        real_insert(**kw)

    monkeypatch.setattr(ch, "_insert", flaky)
    with pytest.raises(RuntimeError):
        _sub(ch, 1, 2, 3)
    assert svc.db.query("SELECT COUNT(*) AS n FROM channels") == [{"n": 0}]


def test_batch_unsubscribe_only_proposes_to_cleanup(rw: Any) -> None:
    w = rw
    a, b = _sub(w.channels, 1, 2)
    (f,) = _sub(w.channels, 3, relation=T.Relation.followed)
    outcome = CH.batch_or_propose(
        w.channels, w.cleanup, "unsubscribe", [a, b, f], reason="não vejo mais"
    )
    assert outcome.batch is None
    assert {c.channel_id for c in outcome.proposed} == {a, b}, (
        "only subscribed channels become candidates"
    )
    assert all(c.group is T.CleanupGroup.manual for c in outcome.proposed)
    assert w.db.query("SELECT COUNT(*) AS n FROM unsub_queue") == [{"n": 0}]
    assert {w.channels.get(x).relation for x in (a, b)} == {T.Relation.subscribed}
    moved = CH.batch_or_propose(w.channels, w.cleanup, "mute", [a])
    assert moved.batch is not None and moved.batch.changed == (a,) and moved.proposed == ()
    with pytest.raises(T.ValidationError):
        CH.batch_or_propose(w.channels, w.cleanup, "aprovar", [a])
    with pytest.raises(T.ValidationError):
        CH.batch_or_propose(w.channels, None, "unsubscribe", [a])
    assert w.db.query("SELECT COUNT(*) AS n FROM unsub_queue") == [{"n": 0}]


# --------------------------------------------------------------------------- relation


def _with_relation(w: Any, n: int, rel: T.Relation) -> str:
    if rel in (T.Relation.subscribed, T.Relation.ex):
        (c,) = _sub(w.channels, n)
        if rel is T.Relation.ex:
            w.channels.set_relation(c, T.Relation.ex)
    else:
        (c,) = _sub(w.channels, n, relation=T.Relation.followed)
        if rel is T.Relation.ignored:
            w.channels.set_relation(c, T.Relation.ignored)
    assert w.channels.get(c).relation is rel
    return c


@pytest.mark.parametrize("src", list(T.Relation))
@pytest.mark.parametrize("dst", list(T.Relation))
def test_relation_transitions(rw: Any, src: T.Relation, dst: T.Relation) -> None:
    w = rw
    c = _with_relation(w, 1, src)
    w.db.execute("DELETE FROM changes")
    before = w.channels.get(c)
    w.clock.advance(100)
    if src is dst:
        assert w.channels.set_relation(c, dst) == before
        assert w.changelog.list() == []
    elif dst in T.RELATION_TRANSITIONS[src]:
        after = w.channels.set_relation(c, dst, reason="r")
        assert after.relation is dst
        if dst is T.Relation.ex:
            assert after.unsubscribed_at == w.clock.now()
        elif dst is T.Relation.ignored:
            assert after.unsubscribed_at == before.unsubscribed_at
        else:
            assert after.unsubscribed_at is None
        (rec,) = w.changelog.list()
        assert rec.action is T.ChangeAction.channel_relation
        w.changelog.undo(rec.id, targets=w.targets())
        assert w.channels.get(c).relation is src
        assert w.channels.get(c).unsubscribed_at == before.unsubscribed_at
    else:
        with pytest.raises(T.Conflict):
            w.channels.set_relation(c, dst)
        assert w.channels.get(c) == before and w.changelog.list() == []


def test_set_relation_rejects_garbage(rw: Any) -> None:
    (c,) = _sub(rw.channels, 1)
    with pytest.raises(T.ValidationError):
        rw.channels.set_relation(c, "cancelado")  # type: ignore[arg-type]
    with pytest.raises(T.NotFound):
        rw.channels.set_relation(cid(99), T.Relation.ex)


def test_undo_relation_after_executed_cancellation_is_refused(rw: Any) -> None:
    w = rw
    (c,) = _sub(w.channels, 1)
    (item,) = w.cleanup.approve([c], T.ApprovedVia.desktop_rpc)
    w.cleanup.queue_result(item.id, T.QueueStatus.running, device_id="d")
    w.cleanup.queue_result(item.id, T.QueueStatus.done, device_id="d")
    assert w.channels.get(c).relation is T.Relation.ex
    rel = next(r for r in w.changelog.list() if r.action is T.ChangeAction.channel_relation)
    queue_before = w.db.query("SELECT * FROM unsub_queue ORDER BY id")
    with pytest.raises(T.UndoRefused) as refused:
        w.changelog.undo(rel.id, targets=w.targets())
    assert refused.value.reason == "already_executed"
    assert w.channels.get(c).relation is T.Relation.ex
    assert w.db.query("SELECT * FROM unsub_queue ORDER BY id") == queue_before
    assert w.changelog.get(rel.id).undone_at is None


def test_undo_relation_refused_when_state_moved_on(rw: Any) -> None:
    w = rw
    (c,) = _sub(w.channels, 1, relation=T.Relation.followed)
    w.channels.set_relation(c, T.Relation.ignored)
    first = w.changelog.list()[0]
    w.channels.set_relation(c, T.Relation.subscribed, actor=T.Actor.extension)
    with pytest.raises(T.UndoRefused):
        w.changelog.undo(first.id, targets=w.targets())
    assert w.channels.get(c).relation is T.Relation.subscribed


def test_undo_add_refused_after_extension_subscribed(rw: Any) -> None:
    w = rw
    w.youtube.add_channel(T.ChannelInfo(id=cid(1), title="A", handle="@a"))
    w.channels.add("@a")
    rec = w.changelog.list()[0]
    _sub(w.channels, 1)  # the extension synced: now it is a real subscription
    with pytest.raises(T.UndoRefused):
        w.changelog.undo(rec.id, targets=w.targets())
    assert w.channels.get(cid(1)).relation is T.Relation.subscribed


# --------------------------------------------------------------------------- stats and cleanup


def test_update_stats_ignores_missing_and_never_raises(svc: SimpleNamespace) -> None:
    ch = svc.channels
    a, b = _sub(ch, 1, 2)
    stats = [
        T.ChannelStats(channel_id=cid(99), last_video_at=10),  # missing
        T.ChannelStats(channel_id=a, last_video_at=100, videos_per_week=2.5, shorts_ratio=0.2),
        T.ChannelStats(channel_id=b, shorts_ratio=7.0, videos_per_week=float("nan")),  # bad
        T.ChannelStats(channel_id=b, title="Título do RSS", thumb="https://x/y.jpg"),
        T.ChannelStats(channel_id=a),  # nothing to write
        T.ChannelStats(channel_id=None),  # type: ignore[arg-type]
        "lixo",  # type: ignore[list-item]
        T.ChannelStats(channel_id=b, title="   ", last_video_at=-5),
    ]
    assert ch.update_stats(stats) == 3
    ga, gb = ch.get(a), ch.get(b)
    assert (ga.last_video_at, ga.videos_per_week, ga.shorts_ratio) == (100, 2.5, 0.2)
    assert gb.shorts_ratio == 1.0 and gb.videos_per_week is None
    assert gb.title == "Título do RSS" and gb.thumb == "https://x/y.jpg"
    assert svc.changelog.list() == [], "no history"
    assert ch.update_stats([]) == 0
    assert ch.get(cid(99)) is None


def test_remove_by_source_keeps_real_subscriptions(svc: SimpleNamespace) -> None:
    ch = svc.channels
    ch.upsert_many(
        [T.ChannelIn(title=f"D{n}", channel_id=cid(n)) for n in (1, 2, 3, 4)],
        source=T.ChannelSource.demo,
        relation=T.Relation.followed,
    )
    ch.set_relation(cid(2), T.Relation.ignored)
    ch.upsert_many(
        [T.ChannelIn(title="D3", channel_id=cid(3))],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    ch.upsert_many(
        [T.ChannelIn(title="D4", channel_id=cid(4))],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    ch.set_relation(cid(4), T.Relation.ex)
    _sub(ch, 5)
    n_changes = len(svc.changelog.list())
    assert ch.remove_by_source(T.ChannelSource.demo) == 2
    assert {c.id for c in ch.list()} == {cid(3), cid(4), cid(5)}
    assert ch.remove_by_source(T.ChannelSource.demo) == 0
    assert len(svc.changelog.list()) == n_changes, "no history"


def test_list_filters_and_count(rw: Any) -> None:
    w = rw
    s = _prepare(w)
    child = w.taxonomy.create_folder("Filho", parent_id=s.f1)
    w.channels.move([s.c], child.id)
    ch = w.channels
    assert [c.id for c in ch.list(T.ChannelFilter(folder_id=s.f1))] == [s.a, s.c]
    assert [c.id for c in ch.list(T.ChannelFilter(folder_id=s.f1, recursive=False))] == [s.a]
    assert [c.id for c in ch.list(T.ChannelFilter(folder_id=None))] == [s.b, s.d, s.e]
    assert [c.id for c in ch.list(T.ChannelFilter(tag_id=s.t1))] == [s.a]
    assert [c.id for c in ch.list(T.ChannelFilter(favorite=True, muted=True))] == [s.b]
    assert [c.id for c in ch.list(T.ChannelFilter(relations=(T.Relation.followed,)))] == [s.d]
    assert [c.id for c in ch.list(T.ChannelFilter(ids=(s.d, s.a, cid(99))))] == [s.a, s.d]
    assert [c.id for c in ch.list(T.ChannelFilter(query="CANAL 3"))] == [s.c]
    assert [c.id for c in ch.list(T.ChannelFilter(limit=2, offset=1))] == [s.b, s.c]
    assert ch.count(T.ChannelFilter(limit=1)) == 5
    assert ch.get(s.a).tag_ids == (s.t1,)
    with pytest.raises(T.ValidationError):
        ch.list(T.ChannelFilter(relations=("amigo",)))  # type: ignore[arg-type]


def test_parse_filter_from_query() -> None:
    f = CH.parse_filter(
        {
            "relation": "subscribed,followed",
            "folder": "none",
            "recursive": "false",
            "favorite": "true",
            "q": "  fire ",
            "ids": f"{cid(1)},{cid(2)}",
            "limit": "10",
            "offset": "5",
        }
    )
    assert f.relations == (T.Relation.subscribed, T.Relation.followed)
    assert f.folder_id is None and f.recursive is False and f.favorite is True
    assert f.query == "fire" and f.ids == (cid(1), cid(2)) and (f.limit, f.offset) == (10, 5)
    assert CH.parse_filter({}) == T.ChannelFilter()
    assert CH.parse_filter({"folder": "f1"}).folder_id == "f1"
    for bad in ({"relation": "amigo"}, {"limit": "0"}, {"limit": "x"}, {"favorite": "talvez"}):
        with pytest.raises(T.ValidationError):
            CH.parse_filter(bad)


def test_apply_patch_is_atomic_and_one_undo(rw: Any) -> None:
    w = rw
    s = _prepare(w)
    before = _snapshot(w.db)
    out = w.channels.apply_patch(
        s.d,
        T.ChannelPatch(favorite=True, folder_id=s.f2),
        tag_ids=[s.t2],
        relation=T.Relation.ignored,
    )
    assert out.favorite and out.folder_id == s.f2 and out.tag_ids == (s.t2,)
    assert out.relation is T.Relation.ignored
    recs = w.changelog.list()
    assert len({r.group_id for r in recs}) == 1 and recs[0].group_id
    w.changelog.undo(recs[0].id, targets=w.targets())
    assert _snapshot(w.db) == before
    # relation outside followed|ignored or invalid → nothing is written
    with pytest.raises(T.ValidationError):
        w.channels.apply_patch(s.a, T.ChannelPatch(favorite=True), relation=T.Relation.ex)
    with pytest.raises(T.Conflict):
        w.channels.apply_patch(s.a, T.ChannelPatch(favorite=True), relation=T.Relation.followed)
    assert _snapshot(w.db) == before


# --------------------------------------------------------------------------- ChangeLog


class SpyOwner:
    def __init__(self, fail_on: int | None = None, reason: str = "already_executed") -> None:
        self.seen: list[int] = []
        self.fail_on = fail_on
        self.reason = reason

    def apply_undo(self, change: T.ChangeRecord) -> None:
        if change.id == self.fail_on:
            raise T.UndoRefused(self.reason)
        self.seen.append(change.id)


def test_record_validates_and_roundtrips(svc: SimpleNamespace) -> None:
    log = svc.changelog
    with pytest.raises(T.ValidationError):
        log.record(T.Actor.user, T.ChangeAction.channel_move, {}, T.UndoChannelTags(before={}))
    with pytest.raises(T.ValidationError):
        log.record("robo", T.ChangeAction.channel_move, {}, T.UndoChannelMove(before={}))  # type: ignore[arg-type]
    with pytest.raises(T.ValidationError):
        log.record(T.Actor.user, "inventada", {}, T.UndoChannelMove(before={}))  # type: ignore[arg-type]
    rec = log.record(
        T.Actor.hermes,
        T.ChangeAction.channel_move,
        {"label": "Mover", "count": 2},
        T.UndoChannelMove(before={cid(1): None, cid(2): "f"}),
    )
    assert rec.id > 0 and rec.ts == svc.clock.now() and rec.actor is T.Actor.hermes
    assert rec.group_id is None and rec.undone_at is None
    assert log.get(rec.id) == rec
    assert log.get(rec.id + 100) is None
    row = svc.db.query_one("SELECT * FROM changes WHERE id = ?", (rec.id,))
    assert json.loads(row["undo"]) == {"before": {cid(1): None, cid(2): "f"}}


def test_group_list_and_pagination(svc: SimpleNamespace) -> None:
    log = svc.changelog
    undo = T.UndoChannelMove(before={})
    a = log.record(T.Actor.user, T.ChangeAction.channel_move, {}, undo)
    with log.group("organizar") as gid:
        b = log.record(T.Actor.user, T.ChangeAction.channel_move, {}, undo)
        with log.group("interno") as inner:
            c = log.record(T.Actor.user, T.ChangeAction.channel_move, {"label": "c"}, undo)
        assert inner == gid, "grupo aninhado herda o de fora"
    d = log.record(T.Actor.user, T.ChangeAction.channel_move, {}, undo)
    assert (b.group_id, c.group_id) == (gid, gid) and a.group_id is None and d.group_id is None
    assert [r.id for r in log.list()] == [d.id, c.id, b.id, a.id]
    assert [r.id for r in log.list(limit=2)] == [d.id, c.id]
    assert [r.id for r in log.list(limit=2, before_id=c.id)] == [b.id, a.id]
    with pytest.raises(T.ValidationError):
        log.list(limit=0)

    # another thread does not inherit the group
    seen: dict[str, Any] = {}
    with log.group("x"):
        t = threading.Thread(
            target=lambda: seen.setdefault(
                "rec", log.record(T.Actor.user, T.ChangeAction.channel_move, {}, undo)
            )
        )
        t.start()
        t.join()
    assert seen["rec"].group_id is None


def test_undo_group_newest_first_and_all_or_nothing(svc: SimpleNamespace) -> None:
    log, ch = svc.changelog, svc.channels
    (a, b) = _sub(ch, 1, 2)
    spy = SpyOwner()
    with log.group("misto"):
        ch.update(a, T.ChannelPatch(favorite=True))
        tab = log.record(T.Actor.user, T.ChangeAction.tab_create, {}, T.UndoTabCreate(tab_id="x"))
        ch.update(b, T.ChannelPatch(muted=True))
    targets = T.UndoTargets(channels=ch, tabs=spy)
    undone = log.undo(tab.id, targets=targets)
    assert [r.id for r in undone] == sorted((r.id for r in undone), reverse=True)
    assert len(undone) == 3 and spy.seen == [tab.id]
    assert not ch.get(a).favorite and not ch.get(b).muted

    # all or nothing: a refusal halfway undoes what had already been reverted
    with log.group("misto2"):
        ch.update(a, T.ChannelPatch(favorite=True))
        bad = log.record(T.Actor.user, T.ChangeAction.tab_create, {}, T.UndoTabCreate(tab_id="y"))
        ch.update(b, T.ChannelPatch(muted=True))
    snap = _snapshot(svc.db)
    with pytest.raises(T.UndoRefused) as refused:
        log.undo(bad.id, targets=T.UndoTargets(channels=ch, tabs=SpyOwner(fail_on=bad.id)))
    assert refused.value.reason == "already_executed"
    assert _snapshot(svc.db) == snap, "channel b, undone before the refusal, came back"
    assert all(r.undone_at is None for r in log.list(limit=3))

    # missing owner and an action with no undo → not_undoable, nothing changes
    with pytest.raises(T.UndoRefused) as refused:
        log.undo(bad.id, targets=T.UndoTargets(channels=ch))
    assert refused.value.reason == "not_undoable"
    imp = log.record(T.Actor.user, T.ChangeAction.data_import, {}, T.UndoNotSupported())
    with pytest.raises(T.UndoRefused) as refused:
        log.undo(imp.id, targets=T.UndoTargets(channels=ch))
    assert refused.value.reason == "not_undoable"
    with pytest.raises(T.NotFound):
        log.undo(99_999, targets=targets)
    assert _snapshot(svc.db) == snap


def test_apply_undo_cannot_record_history(svc: SimpleNamespace) -> None:
    log, ch = svc.changelog, svc.channels
    (a,) = _sub(ch, 1)
    ch.update(a, T.ChannelPatch(favorite=True))
    rec = log.list()[0]

    class Sneaky:
        def apply_undo(self, change: T.ChangeRecord) -> None:
            ch.apply_undo(change)
            log.record(T.Actor.user, T.ChangeAction.channel_move, {}, T.UndoChannelMove(before={}))

    with pytest.raises(RuntimeError):
        log.undo(rec.id, targets=T.UndoTargets(channels=Sneaky()))  # type: ignore[arg-type]
    assert ch.get(a).favorite, "nothing undone"
    assert len(log.list()) == 1 and log.list()[0].undone_at is None


def test_corrupt_history_row_does_not_break_listing(svc: SimpleNamespace) -> None:
    log = svc.changelog
    ok = log.record(T.Actor.user, T.ChangeAction.channel_move, {}, T.UndoChannelMove(before={}))
    svc.db.execute(
        "INSERT INTO changes (ts, actor, action, payload, undo) VALUES (1, 'user', ?, '{}', ?)",
        ("channel_move", json.dumps({"inesperado": 1})),
    )
    svc.db.execute(
        "INSERT INTO changes (ts, actor, action, payload, undo) VALUES (1, 'user', ?, '{}', '{}')",
        ("acao_do_futuro",),
    )
    recs = log.list()
    assert ok.id in [r.id for r in recs]
    broken = next(r for r in recs if r.id == ok.id + 1)
    assert isinstance(broken.undo, T.UndoNotSupported)
    with pytest.raises(T.UndoRefused) as refused:
        log.undo(broken.id, targets=T.UndoTargets(channels=svc.channels))
    assert refused.value.reason == "not_undoable"
    with pytest.raises(T.UndoRefused):
        log.undo(ok.id + 2, targets=T.UndoTargets(channels=svc.channels))


def test_channels_refuse_foreign_undo(svc: SimpleNamespace) -> None:
    rec = svc.changelog.record(
        T.Actor.user, T.ChangeAction.tab_create, {}, T.UndoTabCreate(tab_id="x")
    )
    with pytest.raises(T.UndoRefused):
        svc.channels.apply_undo(rec)


# --------------------------------------------------------------------------- queue invariants


@pytest.mark.parametrize("name", [n for n, _ in INVARIANTS])
def test_queue_invariants_hold_on_real(rw: Any, name: str) -> None:
    dict(INVARIANTS)[name](QueueImpls.from_world(rw))


def test_queue_invariants_on_seeded_real_world(rw: Any) -> None:
    _seed(rw)
    impls = QueueImpls.from_world(rw, prefix="seeded")
    for _name, check in INVARIANTS:
        check(impls)


def test_nothing_in_b04_approves(rw: Any) -> None:
    """Nothing here becomes an approved unsubscribe: every action and every undo leave the queue
    empty."""
    w = rw
    w.youtube.add_channel(T.ChannelInfo(id=cid(9), title="Nove", handle="@nove"))
    for name, action in ACTIONS.items():
        w.db.execute("DELETE FROM channel_tags")
        w.db.execute("DELETE FROM channels")
        w.db.execute("DELETE FROM folders")
        w.db.execute("DELETE FROM tags")
        w.db.execute("DELETE FROM changes")
        s = _prepare(w)
        action(w, s)
        for rec in w.changelog.list():
            w.changelog.undo(rec.id, targets=w.targets())
        assert w.db.query("SELECT COUNT(*) AS n FROM unsub_queue") == [{"n": 0}], name


# --------------------------------------------------------------------------- fake conformance


CONFORMANCE = (
    "test_changelog_group_undo_dispatches_to_owners",
    "test_channel_service_rules",
    "test_fake_world_targets_cover_undo_owners",
    "test_organizer_accept_and_undo",
    "test_refresher_cycle_kick_and_mark_read",
    "test_sync_ingest_partial_never_marks_absent",
    "test_list_importer_flow",
    "test_demo_load_clear_and_undo_never_touch_real_data",
    "test_import_mytube_and_json_roundtrip",
    "test_maintenance_run",
    "test_themes_pipeline_with_fake_llm_and_searcher",
    "test_theme_save_is_one_undoable_group",
    "test_seed_world_is_consistent",
    "test_cleanup_scan_rules_ai_and_no_model",
    "test_status_and_new_counts_on_seeded_world",
    "test_queue_invariants_on_seeded_world",
    "test_run_invariants_reports_each",
    "test_seed_world_is_deterministic",
)


@pytest.mark.parametrize("name", CONFORMANCE)
def test_fake_suite_passes_with_real_services(rw: Any, name: str) -> None:
    """The service tests from ``test_fakes.py``, with real ``ChannelService``/``ChangeLog`` (the
    patch also applies to the worlds the test itself builds over ``MemDb``)."""
    fn = getattr(test_fakes, name)
    params = list(inspect.signature(fn).parameters)
    args: dict[str, Any] = {}
    if params:
        args["fresh_world"] = rw
        args["world"] = rw
        if "seed_world" in params:
            args["seed_world"] = _seed(rw)
    fn(**{p: args[p] for p in params})


def test_seed_world_on_real_matches_fake(real: None) -> None:
    """Same ``seed_world`` in both: the ``channels``/``channel_tags`` rows are equal."""
    real_world = build_fake_world(MemDb())
    assert isinstance(real_world.channels, CH.ChannelService)
    fake_world = _fake_only_world(MemDb())
    assert isinstance(fake_world.channels, FakeChannelService)
    dumps = []
    for world in (real_world, fake_world):
        _seed(world)
        rows = {
            t: world.db.query(f"SELECT * FROM {t} ORDER BY 1, 2")
            for t in ("channels", "channel_tags")
        }
        for r in rows["channels"]:
            r.pop("updated_at", None)
        dumps.append(rows)
    assert dumps[0] == dumps[1]


def _fake_only_world(db: Any) -> Any:
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(fake_world_module, "FakeChangeLog", FakeChangeLog)
        mp.setattr(fake_world_module, "FakeChannelService", FakeChannelService)
        return build_fake_world(db)
    finally:
        mp.undo()
