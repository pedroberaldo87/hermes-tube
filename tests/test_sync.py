"""Extension ingestion — ``SyncIngest`` (``core/sync.py``) and the ``/ext/state``,
``/ext/sync/subscriptions``, ``/ext/sync/watch`` handlers (``ext/state.py``, ``ext/sync.py``).

Real database (``core.db.build``). The world of fakes is built with real
``ChangeLog``/``ChannelService`` and the real ``SyncIngest`` instead of ``FakeSyncIngest``;
conformance runs the fake's test (``test_fakes.test_sync_ingest_partial_never_marks_absent``)
against the real one.
"""

from __future__ import annotations

import importlib.util
import inspect
import re
import sys
import threading
import time
import types
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fakes.world as fake_world_module
import pytest
import test_fakes
from fakes import FakeClock, FakeSettings, FakeYouTube, build_fake_world

from tube_pkg.core import changes as CG
from tube_pkg.core import channels as CH
from tube_pkg.core import db as core_db
from tube_pkg.core import refresh as RF
from tube_pkg.core import sync as SY
from tube_pkg.core import types as T
from tube_pkg.ext import state as ext_state
from tube_pkg.ext import sync as ext_sync

ROOT = Path(__file__).resolve().parents[1]
REASON_EX = "cancelled outside the app"


def cid(n: int) -> str:
    """Valid channel id (``UC`` + 22)."""
    return f"UCb08sync{n:015d}"


def vid(n: int) -> str:
    """Valid video id (11)."""
    return f"b08vid{n:05d}"


def chin(n: int, **kw: Any) -> T.ChannelIn:
    return T.ChannelIn(title=kw.pop("title", f"Canal {n}"), channel_id=cid(n), **kw)


def batch(items: Any, signal: str = "complete") -> T.SubscriptionBatch:
    return T.SubscriptionBatch(channels=tuple(items), signal=T.SyncSignal(signal))


def _load_by_path(name: str, path: Path) -> types.ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_b08", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)
EXT_OPS = {
    op.operation_id: op
    for op in gen_types.iter_operations(CONTRACT)
    if op.transport == "ext" and op.raw.get("x-unit") == "area-state"
}


def check_envelope(operation_id: str, env: Any) -> None:
    """Strict envelope against the contract (same rule as the surface test)."""
    op = EXT_OPS[operation_id]
    assert isinstance(env, dict) and env.get("ok") in (True, False), env
    if env["ok"]:
        assert set(env) == {"ok", "data"}
        gen_types.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    else:
        gen_types.validate_instance(
            {"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True
        )


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "b08.db"))
    yield db
    db.close()


def _real_factories(monkeypatch: pytest.MonkeyPatch) -> None:
    """``build_fake_world`` builds real ``ChangeLog``/``ChannelService`` and ``SyncIngest``."""

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

    def make_sync(db: Any, *, ids: Any = None, **deps: Any) -> Any:
        return SY.build(db=db, **deps)

    monkeypatch.setattr(fake_world_module, "FakeChangeLog", make_changelog)
    monkeypatch.setattr(fake_world_module, "FakeChannelService", make_channels)
    monkeypatch.setattr(fake_world_module, "FakeSyncIngest", make_sync)


@pytest.fixture
def rw(monkeypatch: pytest.MonkeyPatch, rdb: Any, clock: FakeClock) -> Any:
    """World of fakes with real changelog/channels/sync on the real database."""
    _real_factories(monkeypatch)
    world = build_fake_world(rdb, clock=clock)
    assert isinstance(world.sync, SY.SyncIngest)
    assert isinstance(world.channels, CH.ChannelService)
    return world


def _rel(w: Any, channel_id: str) -> T.Relation:
    ch = w.channels.get(channel_id)
    assert ch is not None, channel_id
    return ch.relation


def _relation_changes(w: Any) -> list[T.ChangeRecord]:
    return [r for r in w.changelog.list(limit=500) if r.action is T.ChangeAction.channel_relation]


# --------------------------------------------------------------------------- module contract


def test_build_signature_matches_contract() -> None:
    sig = inspect.signature(SY.build)
    required = [
        p.name
        for p in sig.parameters.values()
        if p.kind is inspect.Parameter.KEYWORD_ONLY and p.default is inspect.Parameter.empty
    ]
    spec = next(s for s in T.BUILDS if s.module == "plugin/core/sync.py")
    assert required == list(spec.deps)
    assert sig.parameters["clock"].default is None
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in sig.parameters.values())


def test_build_is_inert_and_satisfies_protocol(rw: Any) -> None:
    before = threading.active_count()
    impl = SY.build(
        db=rw.db,
        settings=rw.settings,
        channels=rw.channels,
        video_state=rw.video_state,
        refresher=rw.refresher,
        feed=rw.feed,
        tabs=rw.tabs,
        taxonomy=rw.taxonomy,
        searcher=rw.searcher,
        cleanup=rw.cleanup,
    )
    assert threading.active_count() == before
    assert isinstance(impl, T.SyncIngest)
    assert not getattr(impl, "__contract_stub__", None)
    for name in ("ingest_subscriptions", "ingest_watch", "ext_state"):
        proto = inspect.signature(getattr(T.SyncIngest, name))
        real = inspect.signature(getattr(type(impl), name))
        assert list(proto.parameters) == list(real.parameters), name


@pytest.mark.parametrize("rel", ["core/sync.py", "ext/sync.py", "ext/state.py"])
def test_module_hygiene(rel: str) -> None:
    src = (ROOT / "plugin" / rel).read_text(encoding="utf-8")
    assert "os.environ" not in src
    assert "get_hermes_home" not in src
    assert "from plugin" not in src
    assert not re.search(r"^\s*import threading|^\s*from threading", src, re.M)
    for other in ("channels", "refresh", "feed", "video_state", "tabs", "taxonomy", "cleanup"):
        assert f"tube_pkg.core.{other}" not in src
        assert f"from tube_pkg.core import {other}" not in src


def test_handlers_are_marked_real() -> None:
    from tube_pkg.api import _common

    for fn in (ext_state.get_state, ext_sync.sync_subscriptions, ext_sync.sync_watch):
        assert _common.is_real(fn), fn.__name__
        assert _common.stub_operation(fn) is None


# --------------------------------------------------------------------------- conformance


def test_fake_suite_sync_test_passes_with_real(rw: Any) -> None:
    """The fake's script (``test_fakes``) against the real one."""
    test_fakes.test_sync_ingest_partial_never_marks_absent(rw)


# --------------------------------------------------------------------------- subscriptions


def test_first_sync_adds_subscribed_from_extension(rw: Any) -> None:
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    assert rep.signal is T.SyncSignal.complete
    assert set(rep.added) == {cid(1), cid(2)} and rep.updated == () and rep.marked_ex == ()
    for n in (1, 2):
        ch = rw.channels.get(cid(n))
        assert ch.relation is T.Relation.subscribed
        assert ch.source is T.ChannelSource.extension
    assert _relation_changes(rw) == [], "syncing is not a user action"


def test_partial_never_marks_absent(rw: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2), chin(3)]))
    for _ in range(3):
        rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1)], "partial"))
        assert rep.signal is T.SyncSignal.partial and rep.marked_ex == ()
    rep = rw.sync.ingest_subscriptions("dev_1", batch([], "partial"))
    assert rep.marked_ex == ()
    assert {_rel(rw, cid(n)) for n in (1, 2, 3)} == {T.Relation.subscribed}
    assert _relation_changes(rw) == []


def test_partial_still_adds_and_updates(rw: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    rep = rw.sync.ingest_subscriptions(
        "dev_1", batch([chin(1, title="Novo nome"), chin(2)], "partial")
    )
    assert rep.added == (cid(2),) and rep.updated == (cid(1),) and rep.marked_ex == ()
    assert rw.channels.get(cid(1)).title == "Novo nome"


def test_complete_marks_absent_ex_once_with_extension_actor(rw: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2), chin(3)]))
    rw.clock.advance(60)
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    assert set(rep.marked_ex) == {cid(2), cid(3)}
    assert rep.added == () and rep.updated == ()
    for n in (2, 3):
        ch = rw.channels.get(cid(n))
        assert ch.relation is T.Relation.ex
        assert ch.unsubscribed_at == rw.clock.now()
    changes = _relation_changes(rw)
    assert len(changes) == 2
    for rec in changes:
        assert rec.actor is T.Actor.extension
        assert rec.payload["from"] == "subscribed" and rec.payload["to"] == "ex"
        assert rec.payload["reason"] == REASON_EX
    # idempotent resend: nothing changes, nothing new in the history
    for _ in range(2):
        again = rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
        assert again.added == () and again.updated == () and again.marked_ex == ()
    assert len(_relation_changes(rw)) == 2
    rw.clock.advance(60)
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    assert rw.channels.get(cid(2)).unsubscribed_at == rw.clock.now() - 60, "date does not change"


def test_complete_that_would_mark_too_many_as_ex_becomes_partial(
    rw: Any, caplog: pytest.LogCaptureFixture
) -> None:
    """A ``complete`` list missing more than 10 channels and more than 20 % of the subscriptions
    is not trusted (tampered page, half-loaded list): nothing becomes ``ex``, the reply says
    partial."""
    rw.sync.ingest_subscriptions("dev_1", batch([chin(n) for n in range(1, 31)]))
    with caplog.at_level("WARNING"):
        rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(n) for n in range(1, 20)]))
    assert rep.signal is T.SyncSignal.partial and rep.marked_ex == ()
    assert {_rel(rw, cid(n)) for n in range(1, 31)} == {T.Relation.subscribed}
    assert _relation_changes(rw) == []
    assert any("treated as partial" in r.getMessage() for r in caplog.records)


def test_complete_under_the_limits_still_marks(rw: Any) -> None:
    # exactly 10 absent (floor) out of 30: marked
    rw.sync.ingest_subscriptions("dev_1", batch([chin(n) for n in range(1, 31)]))
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(n) for n in range(1, 21)]))
    assert rep.signal is T.SyncSignal.complete and len(rep.marked_ex) == 10
    # 15 absent out of 120 (12.5 %): marked
    rw.sync.ingest_subscriptions("dev_1", batch([chin(n) for n in range(100, 200)], "partial"))
    kept = [*range(1, 21), *range(100, 185)]
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(n) for n in kept]))
    assert rep.signal is T.SyncSignal.complete
    assert set(rep.marked_ex) >= {cid(n) for n in range(185, 200)}


def test_complete_only_touches_subscribed(rw: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    rw.channels.upsert_many(
        [chin(2), chin(3), chin(4)], source=T.ChannelSource.link, relation=T.Relation.followed
    )
    rw.channels.set_relation(cid(3), T.Relation.ignored)
    rw.channels.set_relation(cid(4), T.Relation.subscribed)  # followed → subscribed
    rw.channels.set_relation(cid(4), T.Relation.ex)
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    assert rep.marked_ex == ()
    assert _rel(rw, cid(2)) is T.Relation.followed
    assert _rel(rw, cid(3)) is T.Relation.ignored
    assert _rel(rw, cid(4)) is T.Relation.ex


def test_resubscribed_outside_app_comes_back(rw: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    assert _rel(rw, cid(2)) is T.Relation.ex
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)], "partial"))
    assert rep.updated == (cid(2),) and rep.added == ()
    ch = rw.channels.get(cid(2))
    assert ch.relation is T.Relation.subscribed and ch.unsubscribed_at is None


def test_followed_and_ignored_in_batch_become_subscribed(rw: Any) -> None:
    rw.channels.upsert_many(
        [chin(1), chin(2)], source=T.ChannelSource.link, relation=T.Relation.followed
    )
    rw.channels.set_relation(cid(2), T.Relation.ignored)
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    assert set(rep.updated) == {cid(1), cid(2)}
    assert {_rel(rw, cid(1)), _rel(rw, cid(2))} == {T.Relation.subscribed}
    assert rw.channels.get(cid(1)).source is T.ChannelSource.link, "origin never changes"


def test_dedup_by_handle_and_url_keeps_existing(rw: Any) -> None:
    rw.sync.ingest_subscriptions(
        "dev_1",
        batch(
            [
                chin(1, handle="@um", url="https://www.youtube.com/@um"),
                chin(2, url=f"https://www.youtube.com/channel/{cid(2)}"),
            ]
        ),
    )
    # no channel_id: matches by handle (1) and by /channel/ URL (2); nothing new, nothing becomes ex
    items = [
        T.ChannelIn(title="Um", handle="@UM"),
        T.ChannelIn(title="Dois", url=f"https://youtube.com/channel/{cid(2)}"),
    ]
    rep = rw.sync.ingest_subscriptions("dev_1", batch(items))
    assert rep.added == () and rep.marked_ex == ()
    assert rw.db.query_one("SELECT COUNT(*) AS n FROM channels")["n"] == 2
    assert {_rel(rw, cid(1)), _rel(rw, cid(2))} == {T.Relation.subscribed}


def test_same_channel_twice_in_batch_is_one_row(rw: Any) -> None:
    rep = rw.sync.ingest_subscriptions(
        "dev_1", batch([chin(1), chin(1, handle="@um"), T.ChannelIn(title="x", handle="@um")])
    )
    assert rep.added == (cid(1),)
    assert rw.db.query_one("SELECT COUNT(*) AS n FROM channels")["n"] == 1


def test_complete_empty_list_never_wipes_subscriptions(rw: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    rep = rw.sync.ingest_subscriptions("dev_1", batch([]))
    assert rep.marked_ex == () and rep.signal is T.SyncSignal.complete
    assert {_rel(rw, cid(1)), _rel(rw, cid(2))} == {T.Relation.subscribed}


def test_complete_with_unresolved_item_does_not_mark_absent(rw: Any) -> None:
    """An item that could not be identified may be a subscription that changed its handle: with it
    in the batch, "absent" is not trustworthy and nothing becomes ``ex``."""
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    unknown = T.ChannelIn(title="Sem id", handle="@desconhecido-b08")
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1), unknown]))
    assert rep.marked_ex == ()
    assert _rel(rw, cid(2)) is T.Relation.subscribed


def test_complete_marks_in_one_transaction_all_or_nothing(
    rw: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2), chin(3)]))
    original = rw.channels.set_relation
    calls = {"n": 0}

    def flaky(*a: Any, **k: Any) -> Any:
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("injected failure")
        return original(*a, **k)

    monkeypatch.setattr(rw.channels, "set_relation", flaky)
    with pytest.raises(RuntimeError):
        rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    assert {_rel(rw, cid(2)), _rel(rw, cid(3))} == {T.Relation.subscribed}
    assert _relation_changes(rw) == []
    monkeypatch.setattr(rw.channels, "set_relation", original)
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    assert set(rep.marked_ex) == {cid(2), cid(3)}, "resending completes what was missing"


def test_ex_marked_by_sync_while_queue_executed_is_protected_from_undo(rw: Any) -> None:
    """Unsubscribe done on the YouTube page: the relation changes with ``actor=extension`` and the
    channel undo refuses (``already_executed``)."""
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    rw.clock.advance(10)
    (item,) = rw.cleanup.approve([cid(2)], T.ApprovedVia.desktop_rpc)
    rw.cleanup.queue_result(item.id, T.QueueStatus.running, device_id="dev_1")
    rw.clock.advance(10)
    rep = rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    assert rep.marked_ex == (cid(2),)
    (rec,) = _relation_changes(rw)
    assert rec.actor is T.Actor.extension
    with pytest.raises(T.UndoRefused) as exc:
        rw.changelog.undo(rec.id, targets=rw.targets())
    assert exc.value.reason == "already_executed"
    assert _rel(rw, cid(2)) is T.Relation.ex


def test_ex_marked_without_queue_can_be_undone(rw: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    (rec,) = _relation_changes(rw)
    rw.changelog.undo(rec.id, targets=rw.targets())
    assert _rel(rw, cid(2)) is T.Relation.subscribed
    assert rw.channels.get(cid(2)).unsubscribed_at is None


def test_large_batch_is_fast(rw: Any) -> None:
    items = [chin(n) for n in range(1, 1201)]
    t0 = time.perf_counter()
    rw.sync.ingest_subscriptions("dev_1", batch(items))
    rep = rw.sync.ingest_subscriptions("dev_1", batch(items[:-200]))
    elapsed = time.perf_counter() - t0
    assert len(rep.marked_ex) == 200
    assert elapsed < 20, elapsed


# --------------------------------------------------------------------------- history


def test_watch_batch_idempotent_and_marks_watched(rw: Any) -> None:
    events = [
        T.WatchEvent(vid(1), 1000, cid(1)),
        T.WatchEvent(vid(1), 1000, cid(1)),  # repeated in the same batch
        T.WatchEvent(vid(1), 2000, cid(1)),  # rewatched later = another event
        T.WatchEvent(vid(2), 1500, None),
    ]
    assert rw.sync.ingest_watch("dev_1", events) == 3
    assert rw.sync.ingest_watch("dev_1", events) == 0
    assert rw.sync.ingest_watch("dev_1", events[:1]) == 0
    rows = rw.db.query("SELECT * FROM watch_history ORDER BY video_id, watched_at")
    assert [(r["video_id"], r["watched_at"], r["device_id"]) for r in rows] == [
        (vid(1), 1000, "dev_1"),
        (vid(1), 2000, "dev_1"),
        (vid(2), 1500, "dev_1"),
    ]
    states = rw.video_state.get([vid(1), vid(2)])
    assert {s.state for s in states.values()} == {T.VideoState.watched}
    assert len(states) == 2


def test_watch_resend_does_not_override_later_user_state(rw: Any) -> None:
    ev = [T.WatchEvent(vid(1), 1000, cid(1))]
    rw.sync.ingest_watch("dev_1", ev)
    rw.video_state.set_state([vid(1)], T.VideoState.later)
    assert rw.sync.ingest_watch("dev_1", ev) == 0
    assert rw.video_state.get([vid(1)])[vid(1)].state is T.VideoState.later


def test_watch_fills_channel_from_known_video_and_skips_bad_ids(rw: Any) -> None:
    rw.video_store.upsert(
        [T.VideoIn(id=vid(7), channel_id=cid(7), title="v7", published_at=10)], T.VideoOrigin.rss
    )
    events = [
        T.WatchEvent(vid(7), 1000, None),
        T.WatchEvent("curto", 1000, None),
        T.WatchEvent(vid(8), 1000, "não-é-canal"),
        T.WatchEvent(vid(9), -5, None),
    ]
    assert rw.sync.ingest_watch("dev_1", events) == 2
    rows = {r["video_id"]: r for r in rw.db.query("SELECT * FROM watch_history")}
    assert set(rows) == {vid(7), vid(8)}
    assert rows[vid(7)]["channel_id"] == cid(7)
    assert rows[vid(8)]["channel_id"] is None
    assert rw.sync.ingest_watch("dev_1", []) == 0


def test_watch_survives_stub_video_state(rw: Any) -> None:
    """Before the video state service is wired, the stub ``set_state`` raises
    ``NotImplementedError``: the history stays stored (it is the main data) and the batch
    does not fail."""

    class Stub:
        __contract_stub__ = "video_state"

        def set_state(self, *a: Any, **k: Any) -> int:
            raise NotImplementedError("stub")

    rw.sync.video_state = Stub()
    assert rw.sync.ingest_watch("dev_1", [T.WatchEvent(vid(1), 1000, None)]) == 1
    assert rw.db.query_one("SELECT COUNT(*) AS n FROM watch_history")["n"] == 1


def test_watch_real_failure_rolls_back_so_resend_works(
    rw: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*a: Any, **k: Any) -> int:
        raise RuntimeError("injected failure")

    monkeypatch.setattr(rw.video_state, "set_state", boom)
    ev = [T.WatchEvent(vid(1), 1000, None)]
    with pytest.raises(RuntimeError):
        rw.sync.ingest_watch("dev_1", ev)
    assert rw.db.query_one("SELECT COUNT(*) AS n FROM watch_history")["n"] == 0
    monkeypatch.undo()
    assert rw.sync.ingest_watch("dev_1", ev) == 1


# --------------------------------------------------------------------------- ext_state


def test_ext_state_on_seeded_world(rw: Any) -> None:
    from fakes import seed_world as _seed

    s = _seed(rw)
    rw.settings.set("extras_honest_thumbnails", True)
    rw.settings.set("home_on_youtube", False)
    rw.settings.set("language", "pt-BR")
    rw.searcher.enqueue("rust async")
    (item,) = rw.cleanup.approve([s.channels[next(iter(s.channels))]], T.ApprovedVia.desktop_rpc)
    assert item.status is T.QueueStatus.approved
    st = rw.sync.ext_state("dev_9")
    counts = rw.feed.new_counts()
    assert st.new_total == counts.total > 0
    assert [t.tab_id for t in st.tabs] == [t.id for t in rw.tabs.list()]
    assert {t.tab_id: t.count for t in st.tabs} == {
        t.id: counts.by_tab.get(t.id, 0) for t in rw.tabs.list()
    }
    assert {f.folder_id: (f.name, f.parent_id, f.count) for f in st.folders} == {
        f.id: (f.name, f.parent_id, counts.by_folder.get(f.id, 0))
        for f in rw.taxonomy.list_folders()
    }
    assert st.search_pending == 1 and st.queue_pending == 1
    assert st.extras_honest_thumbnails is True and st.home_on_youtube is False
    assert st.extras_hn_lens is False and st.language == "pt-BR"
    assert st.device_id == "dev_9" and st.server_time == rw.clock.now()
    assert ("all", False) in rw.refresher.kicks, "calls kick_if_due without force"


def _profile_with_display_language(tmp_path: Path, display: str | None) -> Path:
    home = tmp_path / "profile"
    home.mkdir(parents=True, exist_ok=True)
    body = f"display:\n  language: {display}\n" if display else "{}\n"
    (home / "config.yaml").write_text(body, encoding="utf-8")
    return home


@pytest.mark.parametrize(
    ("plugin_language", "display", "expected"),
    [
        ("auto", "en", "en"),
        ("auto", "pt-BR", "pt-BR"),
        ("auto", None, "en"),
        ("auto", "es", "en"),
        ("en", "pt-BR", "en"),
        ("pt-BR", "en", "pt-BR"),
    ],
)
def test_ext_state_sends_the_resolved_language(
    rw: Any,
    tmp_path: Path,
    plugin_language: str,
    display: str | None,
    expected: str,
) -> None:
    """The extension gets the resolved language (plugin setting, then Hermes'
    ``display.language``, then English), never the raw ``auto``."""
    rw.settings.set("language", plugin_language)
    rw.settings.home = _profile_with_display_language(tmp_path, display)
    assert rw.sync.ext_state(None).language == expected


def test_ext_state_language_without_a_profile_is_english(rw: Any) -> None:
    rw.settings.set("language", "auto")
    assert rw.sync.ext_state(None).language == "en"


def test_ext_state_kick_without_wait(rw: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[Any, Any]] = []

    def kick(force: bool = False, *, wait: bool = False) -> str:
        seen.append((force, wait))
        return "skipped"

    monkeypatch.setattr(rw.refresher, "kick_if_due", kick)
    rw.sync.ext_state(None)
    assert seen == [(False, False)]


def test_ext_state_degrades_when_a_service_fails(rw: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a: Any, **k: Any) -> Any:
        raise NotImplementedError("stub")

    for obj, name in (
        (rw.refresher, "kick_if_due"),
        (rw.refresher, "is_running"),
        (rw.refresher, "last_rss_at"),
        (rw.feed, "new_counts"),
        (rw.searcher, "pending_count"),
        (rw.cleanup, "queue_pending"),
        (rw.tabs, "list"),
        (rw.taxonomy, "list_folders"),
        (rw.settings, "snapshot"),
    ):
        monkeypatch.setattr(obj, name, boom)
    st = rw.sync.ext_state("dev_1")
    assert st.new_total == 0 and st.tabs == () and st.folders == ()
    assert st.search_pending == 0 and st.queue_pending == 0
    assert st.home_on_youtube is True and st.extras_honest_thumbnails is False
    assert st.language == "en" and st.refresh_running is False and st.last_rss_at is None
    assert st.device_id == "dev_1"


class SlowYouTube(FakeYouTube):
    """Slow ``fetch_channel_rss`` (simulates real YouTube)."""

    def __init__(self, delay: float) -> None:
        super().__init__()
        self.delay = delay
        self.fetched: list[str] = []

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        time.sleep(self.delay)
        self.fetched.append(channel_id)
        return super().fetch_channel_rss(channel_id)


def test_ext_state_does_not_block_on_real_refresher(rw: Any) -> None:
    """Real Refresher with slow YouTube: the cycle goes to a thread and ``ext_state``
    answers right away (< 50 ms)."""
    yt = SlowYouTube(delay=0.4)
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1), chin(2)]))
    for n in (1, 2):
        yt.add_rss(
            T.RssFeed(
                channel=T.ChannelInfo(id=cid(n), title=f"Canal {n}"),
                videos=(T.VideoIn(id=vid(n), channel_id=cid(n), title="v", published_at=100),),
            )
        )
    real_refresher = RF.build(
        db=rw.db,
        settings=rw.settings,
        youtube=yt,
        channels=rw.channels,
        video_store=rw.video_store,
        feed=rw.feed,
        events=rw.events,
        changelog=rw.changelog,
        ext_endpoint_up=lambda: True,
        clock=T.SystemClock(),
    )
    rw.sync.refresher = real_refresher
    t0 = time.perf_counter()
    st = rw.sync.ext_state("dev_1")
    elapsed = time.perf_counter() - t0
    assert elapsed < 0.05, f"ext_state took {elapsed * 1000:.1f} ms"
    assert st.refresh_running is True
    t1 = time.perf_counter()
    st2 = rw.sync.ext_state("dev_1")  # cycle running: "running", also right away
    assert time.perf_counter() - t1 < 0.05
    assert st2.refresh_running is True
    deadline = time.time() + 10
    while real_refresher.is_running() and time.time() < deadline:
        time.sleep(0.05)
    assert not real_refresher.is_running()
    assert sorted(yt.fetched) == [cid(1), cid(2)], "the cycle ran on the thread"
    assert real_refresher.last_rss_at() is not None


# --------------------------------------------------------------------------- handlers


DEVICE = T.Device(id="dev_1", name="Chrome", created_at=1762700000)


def test_handler_sync_subscriptions(rw: Any) -> None:
    body = {
        "signal": "complete",
        "channels": [
            {"title": "Um", "channel_id": cid(1), "handle": "@um", "url": None, "thumb": None},
            {"title": "Dois", "channel_id": cid(2)},
        ],
    }
    env = ext_sync.sync_subscriptions(DEVICE, body, {}, sync=rw.sync)
    check_envelope("extSyncSubscriptions", env)
    assert env["ok"] and set(env["data"]["added"]) == {cid(1), cid(2)}
    env = ext_sync.sync_subscriptions(
        DEVICE, {"signal": "complete", "channels": [body["channels"][0]]}, {}, sync=rw.sync
    )
    check_envelope("extSyncSubscriptions", env)
    assert env["data"] == {"signal": "complete", "added": [], "updated": [], "marked_ex": [cid(2)]}
    env = ext_sync.sync_subscriptions(
        DEVICE, {"signal": "partial", "channels": []}, {}, sync=rw.sync
    )
    assert env["data"]["marked_ex"] == [] and env["data"]["signal"] == "partial"


@pytest.mark.parametrize(
    "body",
    [
        None,
        {},
        {"channels": []},
        {"signal": "done", "channels": []},
        {"signal": "complete"},
        {"signal": "complete", "channels": {}},
        {"signal": "complete", "channels": [{"channel_id": "UCx"}]},
        {"signal": "complete", "channels": [{"title": 3}]},
        {"signal": "complete", "channels": ["x"]},
        {"signal": "complete", "channels": [{"title": "a", "handle": 1}]},
        {"signal": "complete", "channels": [{"title": "a", "tag_ids": "t1"}]},
        {"signal": "complete", "channels": [{"title": "a", "favorite": "yes"}]},
        {"signal": "complete", "channels": [{"title": "a"}] * 5001},
    ],
)
def test_handler_sync_subscriptions_invalid(rw: Any, body: Any) -> None:
    rw.sync.ingest_subscriptions("dev_1", batch([chin(1)]))
    env = ext_sync.sync_subscriptions(DEVICE, body, {}, sync=rw.sync)
    check_envelope("extSyncSubscriptions", env)
    assert env["ok"] is False and env["error"]["code"] == "invalid"
    assert _rel(rw, cid(1)) is T.Relation.subscribed, "an invalid batch touches nothing"


def test_handler_sync_watch(rw: Any) -> None:
    body = {"events": [{"video_id": vid(1), "watched_at": 1762700000, "channel_id": cid(1)}]}
    env = ext_sync.sync_watch(DEVICE, body, {}, sync=rw.sync)
    check_envelope("extSyncWatch", env)
    assert env == {"ok": True, "data": {"count": 1}}
    env = ext_sync.sync_watch(DEVICE, body, {}, sync=rw.sync)
    assert env == {"ok": True, "data": {"count": 0}}
    row = rw.db.query_one("SELECT device_id FROM watch_history")
    assert row["device_id"] == "dev_1"


@pytest.mark.parametrize(
    "body",
    [
        None,
        {},
        {"events": []},
        {"events": "x"},
        {"events": [{"video_id": vid(1)}]},
        {"events": [{"video_id": vid(1), "watched_at": "ontem"}]},
        {"events": [{"video_id": vid(1), "watched_at": True}]},
        {"events": [{"video_id": 5, "watched_at": 1}]},
        {"events": [{"video_id": vid(1), "watched_at": 1, "channel_id": 7}]},
        {"events": [{"video_id": vid(1), "watched_at": 1}] * 501},
    ],
)
def test_handler_sync_watch_invalid(rw: Any, body: Any) -> None:
    env = ext_sync.sync_watch(DEVICE, body, {}, sync=rw.sync)
    check_envelope("extSyncWatch", env)
    assert env["ok"] is False and env["error"]["code"] == "invalid"
    assert rw.db.query_one("SELECT COUNT(*) AS n FROM watch_history")["n"] == 0


def test_handler_get_state(rw: Any) -> None:
    from fakes import seed_world as _seed

    _seed(rw)
    env = ext_state.get_state(DEVICE, None, {}, sync=rw.sync)
    check_envelope("extGetState", env)
    assert env["ok"] and env["data"]["device_id"] == "dev_1"
    assert env["data"]["new_total"] == rw.feed.new_counts().total


def test_handlers_without_device_are_unauthorized(rw: Any) -> None:
    for fn, body in (
        (ext_state.get_state, None),
        (ext_sync.sync_subscriptions, {"signal": "partial", "channels": []}),
        (ext_sync.sync_watch, {"events": [{"video_id": vid(1), "watched_at": 1}]}),
    ):
        env = fn(None, body, {}, sync=rw.sync)
        assert env["ok"] is False and env["error"]["code"] == "unauthorized"


def test_handlers_through_wiring_graph(wire: Any, rdb: Any) -> None:
    """The way ``wiring`` builds it today (real sync, the rest as wired): the three handlers
    answer within the contract on the real database. Fake YouTube: no network."""
    import importlib

    wire.set("youtube", FakeYouTube())
    wiring = importlib.import_module("tube_pkg.wiring")
    settings = importlib.import_module("tube_pkg.adapters.settings").build()
    handlers = wiring.ext_handlers(db=rdb, settings=settings)
    env = handlers.sync_subscriptions(
        DEVICE, {"signal": "complete", "channels": [{"title": "Um", "channel_id": cid(1)}]}, {}
    )
    check_envelope("extSyncSubscriptions", env)
    assert env["ok"] and env["data"]["added"] == [cid(1)]
    env = handlers.sync_watch(DEVICE, {"events": [{"video_id": vid(1), "watched_at": 5}]}, {})
    check_envelope("extSyncWatch", env)
    assert env["ok"] and env["data"]["count"] == 1
    env = handlers.get_state(DEVICE, None, {})
    check_envelope("extGetState", env)
    assert env["ok"] and env["data"]["device_id"] == "dev_1"
    # the cycle kick_if_due may have started (1 channel, real YouTube) must not outlive the
    # database: wait for the lock to go (the test channel does not exist; fails fast or offline)
    deadline = time.time() + 15
    while time.time() < deadline:
        row = rdb.query_one("SELECT value FROM meta WHERE key = ?", (T.META_REFRESH_LOCK,))
        if not row or not row["value"]:
            break
        time.sleep(0.05)
