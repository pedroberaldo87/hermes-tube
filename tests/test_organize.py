"""Organize with AI — the real ``Organizer`` (``core/organize.py``), RPC ``organize.*``
(``rpc/organize.py``) and ``GET /suggestions`` (``api/organize.py``).

Real database (``core.db.build``) with real ``ChangeLog``/``ChannelService`` and
``TaxonomyService``; AI through ``FakeLLM`` (validates input and output against the schemas in
``core/prompts.py``) or through a local ``LenientLLM`` that returns the **raw** output (simulates
a model/adapter that lets junk through: the ``Organizer`` does not trust the model output).

Blocks:
1. core contract (``build``, ``Protocol``, hygiene);
2. organize: batches, progress, input (recent titles, folders, tags, examples), nothing applied;
3. accept (group, one channel, correction), reject, undo in one step;
4. untrusted output; idempotency; stale suggestion dropped on read; partial failures;
5. RPC/REST (job < 1 s, ``busy``, no model, parameters) validated strictly against the contract;
6. fake × real conformance;
7. ``live`` (outside ``check``): 20 demo channels through the real Hermes model.
"""

from __future__ import annotations

import copy
import importlib.util
import inspect
import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import fakes.world as fake_world_module
import pytest
import test_fakes
from fakes import (
    FakeChangeLog,
    FakeChannelService,
    FakeClock,
    FakeEventSink,
    FakeJobRunner,
    FakeLLM,
    FakeOrganizer,
    FakeSettings,
    FakeTaxonomyService,
    FakeYouTube,
    MemDb,
    build_fake_world,
)

from tube_pkg.api import _common
from tube_pkg.api import organize as api_org
from tube_pkg.core import changes as CG
from tube_pkg.core import channels as CH
from tube_pkg.core import db as core_db
from tube_pkg.core import jobs as core_jobs
from tube_pkg.core import organize as OG
from tube_pkg.core import taxonomy as TX
from tube_pkg.core import types as T
from tube_pkg.rpc import organize as rpc_org

ROOT = Path(__file__).resolve().parents[1]
ORGANIZE = T.AiTask.organize
MODEL = "modelo-teste"


def _load_by_path(name: str, path: Path) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_i02", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)


def cid(n: int) -> str:
    """Valid channel id (``UC`` + 22)."""
    return f"UCi02test{n:015d}"


# --------------------------------------------------------------------------- fixtures


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


def _make_taxonomy(
    db: Any, *, channels: Any, changelog: Any, clock: Any = None, ids: Any = None
) -> Any:
    return TX.TaxonomyService(
        db=db,
        settings=FakeSettings(),
        channels=channels,
        changelog=changelog,
        clock=clock,
        new_id=ids.next if ids is not None else None,
    )


def _make_organizer(
    db: Any,
    *,
    llm: Any,
    channels: Any,
    taxonomy: Any,
    changelog: Any,
    clock: Any = None,
    ids: Any = None,
) -> Any:
    return OG.build(
        db=db,
        settings=FakeSettings(),
        llm=llm,
        channels=channels,
        taxonomy=taxonomy,
        changelog=changelog,
        clock=clock,
    )


def _real_factories(mp: pytest.MonkeyPatch, *, organizer: bool = True) -> None:
    """``build_fake_world`` now builds the real channel/taxonomy services and ``Organizer``."""
    mp.setattr(fake_world_module, "FakeChangeLog", _make_changelog)
    mp.setattr(fake_world_module, "FakeChannelService", _make_channels)
    mp.setattr(fake_world_module, "FakeTaxonomyService", _make_taxonomy)
    if organizer:
        mp.setattr(fake_world_module, "FakeOrganizer", _make_organizer)


@pytest.fixture
def real(monkeypatch: pytest.MonkeyPatch) -> None:
    _real_factories(monkeypatch)


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "i02.db"))
    yield db
    db.close()


@pytest.fixture
def llm() -> FakeLLM:
    return FakeLLM(model=MODEL)


@pytest.fixture
def rw(real: None, rdb: Any, clock: FakeClock, llm: FakeLLM) -> Any:
    """World of fakes with the real channels, taxonomy and organizer on the real database."""
    world = build_fake_world(rdb, clock=clock, llm=llm)
    assert isinstance(world.organizer, OG.Organizer)
    assert isinstance(world.channels, CH.ChannelService)
    assert isinstance(world.taxonomy, TX.TaxonomyService)
    return world


class LenientLLM:
    """``LLM`` that returns the raw answer of *respond* (no schema, no rules)."""

    def __init__(self, respond: Callable[[dict[str, Any]], Any], model: str = "lenient") -> None:
        self.respond = respond
        self.model = model
        self.calls: list[dict[str, Any]] = []

    def available(self) -> bool:
        return True

    def model_name(self) -> str | None:
        return self.model

    def complete_structured(
        self,
        task: T.AiTask,
        payload: Any,
        *,
        timeout: float = 60.0,
        on_progress: Any = None,
    ) -> Any:
        assert T.AiTask(task) is ORGANIZE
        self.calls.append(copy.deepcopy(dict(payload)))
        return self.respond(dict(payload))


def subscribe(
    w: Any,
    *ns: int,
    relation: T.Relation = T.Relation.subscribed,
    source: T.ChannelSource = T.ChannelSource.extension,
) -> list[str]:
    w.channels.upsert_many(
        [T.ChannelIn(title=f"Canal {n}", channel_id=cid(n), handle=f"@canal{n}") for n in ns],
        source=source,
        relation=relation,
        actor=T.Actor.extension,
    )
    return [cid(n) for n in ns]


def add_videos(w: Any, n: int, count: int, *, base: int = 1_762_000_000) -> list[str]:
    """*count* videos of channel *n*; titles ``V<n>-<k>``, newest = highest *k*."""
    videos = [
        T.VideoIn(
            id=f"{n:04d}x{k:06d}",
            channel_id=cid(n),
            title=f"V{n}-{k}",
            published_at=base + k * 100,
        )
        for k in range(count)
    ]
    w.video_store.upsert(videos, T.VideoOrigin.rss)
    return [v.title for v in videos]


def proposal(
    channel_id: str,
    folder: str,
    *,
    new: bool = False,
    tags: list[str] | None = None,
    conf: float = 0.8,
    why: str = "Canal sobre o assunto",
    **extra: Any,
) -> dict[str, Any]:
    return {
        "channel_id": channel_id,
        "folder": folder,
        "new_folder": new,
        "tags": list(tags or []),
        "confidence": conf,
        "why": why,
        **extra,
    }


def answer(rule: Callable[[str], dict[str, Any]]) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """Model answer: ``rule(channel_id)`` → proposal fields, for each input item."""

    def respond(payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "items": [
                proposal(it["channel_id"], **rule(it["channel_id"])) for it in payload["items"]
            ]
        }

    return respond


def same(folder: str, *, new: bool = False, tags: list[str] | None = None) -> Any:
    return answer(lambda _c: {"folder": folder, "new": new, "tags": tags})


def rows(db: Any, sql: str, params: Any = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in db.query(sql, params)]


def snapshot(db: Any) -> dict[str, Any]:
    """What accepting changes (folders, tags, links, channel folders)."""
    return {
        "channels": rows(db, "SELECT id, folder_id FROM channels ORDER BY id"),
        "folders": rows(db, "SELECT id, name, parent_id FROM folders ORDER BY id"),
        "tags": rows(db, "SELECT id, name FROM tags ORDER BY id"),
        "channel_tags": rows(db, "SELECT * FROM channel_tags ORDER BY channel_id, tag_id"),
    }


def n_changes(db: Any) -> int:
    return int(db.query_one("SELECT COUNT(*) AS n FROM changes")["n"])


def statuses(db: Any) -> dict[str, str]:
    return {
        r["id"]: r["status"]
        for r in db.query("SELECT id, status FROM suggestions WHERE kind = 'organize'")
    }


def folder_path(w: Any, folder_id: str | None) -> str | None:
    if folder_id is None:
        return None
    by_id = {f.id: f for f in w.taxonomy.list_folders()}
    parts = []
    cur: str | None = folder_id
    while cur is not None:
        parts.append(by_id[cur].name)
        cur = by_id[cur].parent_id
    return "/".join(reversed(parts))


def tag_names(w: Any, channel_id: str) -> list[str]:
    names = {t.id: t.name for t in w.taxonomy.list_tags()}
    return sorted(names[t] for t in w.channels.get(channel_id).tag_ids)


# =========================================================================== 1. contract


def test_build_signature_protocol_and_inert(rdb: Any) -> None:
    sig = inspect.signature(OG.build)
    assert list(sig.parameters) == [
        "db",
        "settings",
        "llm",
        "channels",
        "taxonomy",
        "changelog",
        "clock",
    ]
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in sig.parameters.values())
    assert sig.parameters["clock"].default is None
    spec = next(s for s in T.BUILDS if s.module == "plugin/core/organize.py")
    assert spec.deps == ("db", "settings", "llm", "channels", "taxonomy", "changelog")

    threads = threading.active_count()
    llm = FakeLLM(model=MODEL)
    world = build_fake_world(rdb, llm=llm)
    org = OG.build(
        db=rdb,
        settings=FakeSettings(),
        llm=llm,
        channels=world.channels,
        taxonomy=world.taxonomy,
        changelog=world.changelog,
    )
    assert isinstance(org, T.Organizer)
    assert not hasattr(org, "__contract_stub__")
    assert threading.active_count() == threads, "build starts no thread"
    assert llm.calls == [], "build does not call the AI"
    assert rows(rdb, "SELECT * FROM suggestions") == []


def test_module_hygiene() -> None:
    for rel in ("plugin/core/organize.py", "plugin/rpc/organize.py", "plugin/api/organize.py"):
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert "os.environ" not in src, rel
        assert "from plugin" not in src and "import plugin" not in src, rel
        for other in ("channels", "taxonomy", "changes", "ai", "jobs", "cleanup", "themes"):
            assert f"tube_pkg.core.{other}" not in src, f"{rel} imports core/{other}"
            assert f"from tube_pkg.core import {other}" not in src, f"{rel} imports core/{other}"
    for rel in ("plugin/rpc/organize.py", "plugin/api/organize.py"):
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert "contract.stub" not in src, rel
    assert _common.is_real(rpc_org.organize_run)
    assert _common.is_real(rpc_org.organize_accept)
    assert _common.is_real(rpc_org.organize_reject)
    assert _common.is_real(api_org.get_suggestions)


# =========================================================================== 2. organize


def test_400_channels_seven_batches_progress_and_nothing_applied(rw: Any) -> None:
    w = rw
    subscribe(w, *range(400))
    titles = add_videos(w, 0, 8)
    musica = w.taxonomy.create_folder("Música")
    w.taxonomy.create_folder("Rock", parent_id=musica.id)
    w.taxonomy.create_tag("review")
    (filed,) = subscribe(w, 500)
    w.channels.move([filed], musica.id)
    before = snapshot(w.db)
    changes_before = n_changes(w.db)
    w.llm.auto = True  # default_response: first existing folder, new_folder false

    progress: list[T.Progress] = []
    result = w.organizer.organize(on_progress=progress.append)

    calls = w.llm.calls_for(ORGANIZE)
    assert [len(c["items"]) for c in calls] == [60] * 6 + [40], "400 channels = 7 batches of ≤ 60"
    sent = [it["channel_id"] for c in calls for it in c["items"]]
    assert len(sent) == len(set(sent)) == 400
    assert filed not in sent, "a channel already in a folder is left out unless asked for"
    first = next(it for it in calls[0]["items"] if it["channel_id"] == cid(0))
    assert first["title"] == "Canal 0" and first["handle"] == "@canal0"
    assert first["recent_titles"] == list(reversed(titles))[:5], "last 5, newest first"
    assert calls[0]["folders"] == ["Música", "Música/Rock"]
    assert calls[0]["tags"] == ["review"]
    assert calls[0]["examples"] == []

    assert len(result.suggestions) == 400 and result.model == MODEL
    assert {s.status for s in result.suggestions} == {T.SuggestionStatus.pending}
    assert {s.model for s in result.suggestions} == {MODEL}
    assert result.suggestions[0].payload["folder"] == "Música"
    assert len(w.organizer.pending()) == 400

    assert progress, "on_progress called"
    assert {p.stage for p in progress} == {"organize"}
    assert [p.done for p in progress] == sorted(p.done for p in progress)
    assert progress[-1].done == progress[-1].total == 400
    assert len([p for p in progress if p.done > 0]) == 7, "one signal per batch"

    assert snapshot(w.db) == before, "nothing applied before accepting"
    assert n_changes(w.db) == changes_before, "organizing writes no history"


def test_explicit_ids_include_filed_channel_but_never_move_before_accept(rw: Any) -> None:
    w = rw
    (a,) = subscribe(w, 1)
    musica = w.taxonomy.create_folder("Música")
    w.channels.move([a], musica.id)
    assert w.organizer.organize().suggestions == (), "no channel without a folder: nothing to do"
    assert w.llm.calls_for(ORGANIZE) == [], "and the AI is not even called"

    w.llm.script(ORGANIZE, same("Ciência", new=True))
    (sug,) = w.organizer.organize([a, cid(77), "lixo"]).suggestions
    assert sug.channel_id == a and sug.payload["folder"] == "Ciência"
    assert sug.payload["new_folder"] is True
    assert [it["channel_id"] for it in w.llm.calls_for(ORGANIZE)[-1]["items"]] == [a]
    assert w.channels.get(a).folder_id == musica.id, "channel organized by the user left intact"
    rep = w.organizer.accept([sug.id])
    assert folder_path(w, w.channels.get(a).folder_id) == "Ciência"
    assert len(rep.created_folders) == 1


def test_second_run_is_idempotent_and_changed_answer_supersedes(rw: Any) -> None:
    w = rw
    subscribe(w, 1, 2, 3)
    w.llm.script(ORGANIZE, same("Tech", new=True), same("Tech", new=True))
    r1 = w.organizer.organize()
    r2 = w.organizer.organize()
    assert [s.id for s in r2.suggestions] == [s.id for s in r1.suggestions], "same suggestion"
    assert len(statuses(w.db)) == 3
    assert sorted(s.id for s in w.organizer.pending()) == sorted(s.id for s in r1.suggestions)

    w.llm.script(ORGANIZE, same("Outra", new=True))
    r3 = w.organizer.organize()
    pend = w.organizer.pending()
    assert len(pend) == 3 and {s.payload["folder"] for s in pend} == {"Outra"}
    assert {s.id for s in pend} == {s.id for s in r3.suggestions}
    st = statuses(w.db)
    assert [st[s.id] for s in r1.suggestions] == ["superseded"] * 3
    per_channel = rows(
        w.db,
        "SELECT channel_id, COUNT(*) AS n FROM suggestions WHERE status = 'pending'"
        " GROUP BY channel_id",
    )
    assert {r["n"] for r in per_channel} == {1}, "one pending per channel"


def test_concurrent_organize_is_busy(rw: Any) -> None:
    w = rw
    subscribe(w, 1)
    started, release = threading.Event(), threading.Event()

    def slow(payload: dict[str, Any]) -> dict[str, Any]:
        started.set()
        assert release.wait(5)
        return same("Tech", new=True)(payload)

    w.llm.script(ORGANIZE, slow)
    box: dict[str, Any] = {}
    th = threading.Thread(target=lambda: box.update(r=w.organizer.organize()))
    th.start()
    try:
        assert started.wait(5)
        with pytest.raises(T.Busy):
            w.organizer.organize()
    finally:
        release.set()
        th.join(5)
    assert len(box["r"].suggestions) == 1


def test_partial_batch_failure_keeps_good_batches_all_failing_raises(rw: Any) -> None:
    w = rw
    subscribe(w, *range(130))
    bad = T.LLMInvalidResponse("fora do formato duas vezes")
    w.llm.script(ORGANIZE, same("Tech", new=True), bad, same("Tech", new=True))
    progress: list[T.Progress] = []
    res = w.organizer.organize(on_progress=progress.append)
    assert len(res.suggestions) == 70, "batches 1 and 3 saved; batch 2 failed"
    assert len(w.organizer.pending()) == 70
    assert progress[-1].done == 130 and "1" in (progress[-1].message or "")

    w2_ids = [s.id for s in w.organizer.pending()]
    w.llm.script(ORGANIZE, bad, bad, bad)
    with pytest.raises(T.LLMInvalidResponse):
        w.organizer.organize()
    assert sorted(s.id for s in w.organizer.pending()) == sorted(w2_ids), "nothing changed"


def test_timeout(rw: Any) -> None:
    w = rw
    subscribe(w, 1, 2)
    with pytest.raises(T.OperationTimeout):
        w.organizer.organize(timeout=0)
    assert w.llm.calls_for(ORGANIZE) == []
    w.llm.script(ORGANIZE, T.OperationTimeout("a IA demorou"))
    with pytest.raises(T.OperationTimeout):
        w.organizer.organize()
    assert statuses(w.db) == {}


def test_no_model_is_readable_and_nothing_breaks(real: None, rdb: Any, wire: Any) -> None:
    llm = FakeLLM(available=False)
    w = build_fake_world(rdb, llm=llm)
    subscribe(w, 1)
    with pytest.raises(T.LLMUnavailable) as info:
        w.organizer.organize()
    assert "model" in info.value.message.lower()
    assert llm.calls == [] and statuses(rdb) == {}

    runner = FakeJobRunner(defer=True)
    wire.set_many(organizer=w.organizer, llm=llm, jobs=runner)
    env = rpc_org.organize_run({}, session_id=None)
    err = _check("organize.run", env, ok=False)
    assert err["code"] == "llm_unavailable" and "model" in err["message"].lower()
    assert runner.submitted == [], "no model: no job"
    assert _check("getSuggestions", _call(api_org.get_suggestions)) == {"items": []}


# =========================================================================== 3. accept / reject


def _two_groups(w: Any) -> tuple[list[str], Any]:
    a, b, c, d = subscribe(w, 1, 2, 3, 4)
    musica = w.taxonomy.create_folder("Música")

    def rule(channel: str) -> dict[str, Any]:
        if channel in (a, b, c):
            return {"folder": "Tecnologia/IA", "new": True, "tags": ["ia"]}
        return {"folder": "Música", "new": False}

    w.llm.script(ORGANIZE, answer(rule))
    w.organizer.organize()
    return [a, b, c, d], musica


def test_accept_folder_group_moves_creates_and_one_undo_restores_all(rw: Any) -> None:
    w = rw
    (a, b, c, d), _musica = _two_groups(w)
    group = [s.id for s in w.organizer.pending() if s.payload["folder"] == "Tecnologia/IA"]
    assert len(group) == 3
    before = snapshot(w.db)
    last_id = max([r.id for r in w.changelog.list(limit=500)] or [0])

    rep = w.organizer.accept(group)

    assert sorted(rep.accepted) == sorted(group)
    assert len(rep.created_folders) == 2 and len(rep.created_tags) == 1
    assert rep.change_group
    for ch in (a, b, c):
        assert folder_path(w, w.channels.get(ch).folder_id) == "Tecnologia/IA"
        assert tag_names(w, ch) == ["ia"]
    assert w.channels.get(d).folder_id is None
    assert [s.channel_id for s in w.organizer.pending()] == [d]
    st = statuses(w.db)
    assert [st[i] for i in group] == ["accepted"] * 3

    new = [r for r in w.changelog.list(limit=500) if r.id > last_id]
    assert {r.group_id for r in new} == {rep.change_group}, "a single undo group"
    actions = sorted(r.action.value for r in new)
    assert actions.count("folder_create") == 2 and actions.count("tag_create") == 1
    assert "channel_move" in actions and "organize_accept" in actions
    acc = next(r for r in new if r.action is T.ChangeAction.organize_accept)
    assert acc.payload.get("group_label") == OG.GROUP_LABEL == "organize with Hermes"

    oldest = min(new, key=lambda r: r.id)
    undone = w.changelog.undo(oldest.id, targets=w.targets())
    assert {r.id for r in undone} == {r.id for r in new}, "one undo restores everything"
    assert snapshot(w.db) == before
    assert sorted(s.id for s in w.organizer.pending() if s.channel_id != d) == sorted(group)


def test_accept_one_channel(rw: Any) -> None:
    w = rw
    (a, b, c, d), musica = _two_groups(w)
    rep = w.organizer.accept(channel_ids=[d])
    assert len(rep.accepted) == 1 and rep.created_folders == () and rep.created_tags == ()
    assert w.channels.get(d).folder_id == musica.id
    assert all(w.channels.get(x).folder_id is None for x in (a, b, c))
    assert sorted(s.channel_id for s in w.organizer.pending()) == sorted([a, b, c])
    assert w.organizer.accept(channel_ids=[d]) == T.AcceptReport(), "accepting again: nothing"


def test_accept_unknown_id_is_not_found_and_applies_nothing(rw: Any) -> None:
    w = rw
    _two_groups(w)
    before = snapshot(w.db)
    with pytest.raises(T.NotFound):
        w.organizer.accept(["sg_nao_existe"])
    assert snapshot(w.db) == before


def test_reject_by_id_and_channel(rw: Any) -> None:
    w = rw
    (a, b, c, d), _ = _two_groups(w)
    before = snapshot(w.db)
    changes_before = n_changes(w.db)
    sa = next(s.id for s in w.organizer.pending() if s.channel_id == a)
    assert w.organizer.reject([sa]) == 1
    assert w.organizer.reject(channel_ids=[b]) == 1
    assert w.organizer.reject([sa]) == 0, "already rejected"
    assert w.organizer.reject(["sg_nao_existe"]) == 0
    assert sorted(s.channel_id for s in w.organizer.pending()) == sorted([c, d])
    assert statuses(w.db)[sa] == "rejected"
    assert snapshot(w.db) == before and n_changes(w.db) == changes_before


def test_corrections_and_rejections_become_examples(rw: Any, clock: FakeClock) -> None:
    w = rw
    a, b, c = subscribe(w, 1, 2, 3)
    ciencia = w.taxonomy.create_folder("Ciência")
    w.llm.script(ORGANIZE, same("Tecnologia", new=True, tags=["tech"]))
    w.organizer.organize()

    rep = w.organizer.accept(
        channel_ids=[a], edits={a: T.OrganizeEdit(folder="Ciência", tags=("física",))}
    )
    assert w.channels.get(a).folder_id == ciencia.id, "the correction won"
    assert tag_names(w, a) == ["física"]
    assert w.taxonomy.find_folder_by_name("Tecnologia") is None
    assert len(rep.created_tags) == 1 and rep.created_folders == ()
    clock.advance(10)
    assert w.organizer.reject(channel_ids=[b]) == 1

    w.llm.script(ORGANIZE, same("Tecnologia", new=True))
    w.organizer.organize([c])
    examples = w.llm.calls_for(ORGANIZE)[-1]["examples"]
    assert examples == [
        {"channel_title": "Canal 2", "folder": None, "tags": []},
        {"channel_title": "Canal 1", "folder": "Ciência", "tags": ["física"]},
    ], "rejection (most recent) and correction become examples"


def test_invalid_edit_is_refused_before_anything_is_applied(rw: Any) -> None:
    w = rw
    (a, *_), _ = _two_groups(w)
    before = snapshot(w.db)
    for edit in (
        T.OrganizeEdit(folder="../etc"),
        T.OrganizeEdit(folder="A//B"),
        T.OrganizeEdit(tags=("a/b",)),
    ):
        with pytest.raises(T.ValidationError):
            w.organizer.accept(channel_ids=[a], edits={a: edit})
    assert snapshot(w.db) == before
    assert len(w.organizer.pending()) == 4


# ===================================================== 4. untrusted output and reading


def test_untrusted_output_is_filtered_and_nothing_junk_is_saved(rw: Any) -> None:
    w = rw
    a, b, c, d, e, f, g, h = subscribe(w, *range(1, 9))
    (gone,) = subscribe(w, 9, relation=T.Relation.followed, source=T.ChannelSource.demo)
    musica = w.taxonomy.create_folder("Música")
    (outside,) = subscribe(w, 20)
    w.channels.move([outside], musica.id)
    before = snapshot(w.db)
    changes_before = n_changes(w.db)

    def respond(payload: dict[str, Any]) -> Any:
        assert gone in [it["channel_id"] for it in payload["items"]]
        w.channels.remove_by_source(T.ChannelSource.demo)  # vanished during the call
        return {
            "items": [
                proposal(a, "Música"),
                proposal(b, "../etc", new=True),
                proposal(c, "Inexistente"),  # folder that does not exist, without new_folder
                proposal(d, "Música", extra="campo extra"),
                proposal(cid(999), "Música"),  # made-up id
                proposal(outside, "Música"),  # real id, not in the input
                proposal(a, "Outra", new=True),  # repeated id
                proposal(gone, "Música"),
                proposal(e, "Música", conf=7),
                proposal(
                    f, "Tech/IA", new=True, why="linha 1\nlinha 2", tags=["ok", "a/b", "OK", ""]
                ),
                proposal(g, "  música ", new=True),  # exists: becomes the existing folder
                "lixo",
                {"channel_id": h},  # incomplete item (h gets no suggestion)
            ],
            "sobra": True,
        }

    org = OG.build(
        db=w.db,
        settings=FakeSettings(),
        llm=LenientLLM(respond),
        channels=w.channels,
        taxonomy=w.taxonomy,
        changelog=w.changelog,
    )
    res = org.organize()
    got = {s.channel_id: s.payload for s in res.suggestions}
    assert sorted(got) == sorted([a, f, g])
    assert got[a]["folder"] == "Música" and got[a]["new_folder"] is False
    assert got[f]["folder"] == "Tech/IA" and got[f]["new_folder"] is True
    assert got[f]["why"] == "linha 1 linha 2", "one-line why"
    assert got[f]["tags"] == ["ok"], "tags with a slash/empty/repeated are dropped"
    assert got[g]["folder"] == "Música" and got[g]["new_folder"] is False
    assert all(0 <= p["confidence"] <= 1 for p in got.values())
    assert sorted(s.channel_id for s in org.pending()) == sorted([a, f, g])
    assert snapshot(w.db) == {**before, "channels": snapshot(w.db)["channels"]}
    assert w.channels.get(gone) is None
    assert n_changes(w.db) == changes_before, "nothing applied"


def test_schema_violation_from_llm_saves_nothing(rw: Any) -> None:
    w = rw
    subscribe(w, 1)
    w.llm.script(
        ORGANIZE,
        lambda p: {
            "items": [proposal(it["channel_id"], "X", new=True, extra=1) for it in p["items"]]
        },
    )
    with pytest.raises(T.LLMInvalidResponse):
        w.organizer.organize()
    assert statuses(w.db) == {}


def test_stale_suggestion_is_discarded_on_read(rw: Any) -> None:
    w = rw
    a, b = subscribe(w, 1, 2)
    (c,) = subscribe(w, 3, relation=T.Relation.followed, source=T.ChannelSource.demo)
    musica = w.taxonomy.create_folder("Música")
    w.llm.script(ORGANIZE, same("Ciência", new=True))
    res = w.organizer.organize()
    sid = {s.channel_id: s.id for s in res.suggestions}
    w.channels.move([a], musica.id)  # the user organized it by hand
    w.channels.remove_by_source(T.ChannelSource.demo)  # channel vanished

    assert [s.channel_id for s in w.organizer.pending()] == [b]
    st = statuses(w.db)
    assert st[sid[a]] == "superseded" and st[sid[c]] == "superseded"
    assert w.organizer.accept(channel_ids=[a]) == T.AcceptReport()
    assert w.channels.get(a).folder_id == musica.id, "does not overwrite the user"


def test_new_folder_flag_follows_the_database_on_read(rw: Any) -> None:
    w = rw
    a, b = subscribe(w, 1, 2)
    w.llm.script(ORGANIZE, same("Reviews", new=True))
    w.organizer.organize()
    w.organizer.accept(channel_ids=[a])
    (left,) = w.organizer.pending()
    assert left.channel_id == b and left.payload["new_folder"] is False, "the folder already exists"
    rep = w.organizer.accept([left.id])
    assert rep.created_folders == ()
    assert w.channels.get(a).folder_id == w.channels.get(b).folder_id


# =========================================================================== 5. RPC and REST


def _op(operation_id: str) -> Any:
    return gen_types.get_operation(CONTRACT, operation_id)


def _check(operation_id: str, env: Any, *, ok: bool = True) -> Any:
    op = _op(operation_id)
    assert _common.is_envelope(env), env
    if env["ok"]:
        gen_types.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    else:
        gen_types.validate_instance(
            {"$ref": "#/components/schemas/ErrorEnvelope"},
            env,
            ROOT,
            current=_op("getSuggestions").doc,
            strict=True,
        )
        assert env["error"]["code"] in set(op.errors) | {"internal"}, env
    assert env["ok"] is ok, env
    return env.get("data") if ok else env["error"]


def _check_job_result(result: Any) -> None:
    op = _op("organize.run")
    gen_types.validate_instance(op.raw["job_result"], result, ROOT, current=op.doc, strict=True)


def _call(fn: Any, body: Any = None, query: Any = None) -> Any:
    try:
        return fn(body, query or {})
    except T.TubeError as exc:
        return _common.error_envelope(exc)


def _rpc(fn: Any, params: Any, session_id: str | None = None) -> Any:
    return _common.call_rpc(fn, params, session_id=session_id)


@pytest.fixture
def wired(rw: Any, wire: Any) -> tuple[Any, FakeJobRunner]:
    runner = FakeJobRunner(defer=True, events=rw.events, clock=rw.clock)
    wire.set_many(organizer=rw.organizer, llm=rw.llm, jobs=runner, changelog=rw.changelog)
    return rw, runner


def test_rpc_run_is_a_job_busy_while_active_and_result_matches_contract(wired: Any) -> None:
    w, runner = wired
    subscribe(w, 1, 2)
    w.llm.script(ORGANIZE, same("Tech", new=True))
    t0 = time.monotonic()
    env = _rpc(rpc_org.organize_run, {"channel_ids": None})
    assert time.monotonic() - t0 < 1.0
    job = _check("organize.run", env)["job"]
    assert job["kind"] == "organize" and job["status"] == "queued"
    assert statuses(w.db) == {}, "nothing runs before the job"

    busy = _check("organize.run", _rpc(rpc_org.organize_run, {}), ok=False)
    assert busy["code"] == "busy"

    assert runner.run_pending() == 1
    done = runner.get(job["id"])
    assert done.status is T.JobStatus.done, done
    _check_job_result(done.result)
    assert len(done.result["suggestions"]) == 2 and done.result["model"] == MODEL
    assert ("organize.done", {"job": job["id"], "status": "done"}) in w.events.events

    items = _check("getSuggestions", _call(api_org.get_suggestions))["items"]
    assert len(items) == 2 and {i["model"] for i in items} == {MODEL}


def test_rpc_run_session_event_and_params(wired: Any) -> None:
    w, runner = wired
    (a,) = subscribe(w, 1)
    w.llm.script(ORGANIZE, same("Tech", new=True))
    env = _rpc(rpc_org.organize_run, {"channel_ids": [a]}, session_id="sess-1")
    job = _check("organize.run", env)["job"]
    runner.run_pending()
    assert ("sess-1", "organize.done", {"job": job["id"], "status": "done"}) in (
        w.events.session_events
    )
    for bad in ({"channel_ids": "x"}, {"channel_ids": [1]}, {"channel_ids": ["mkbhd"]}):
        assert (
            _check("organize.run", _rpc(rpc_org.organize_run, bad), ok=False)["code"] == "invalid"
        )
    assert _rpc(rpc_org.organize_run, ["x"])["error"]["code"] == "invalid"


def test_rpc_run_with_real_job_runner_answers_fast_and_rejects_concurrent(
    rw: Any, wire: Any
) -> None:
    w = rw
    subscribe(w, 1, 2)
    events = FakeEventSink()
    runner = core_jobs.build(db=w.db, settings=FakeSettings(), events=events)
    started, release = threading.Event(), threading.Event()

    def slow(payload: dict[str, Any]) -> dict[str, Any]:
        started.set()
        assert release.wait(10)
        return same("Tech", new=True)(payload)

    w.llm.script(ORGANIZE, slow)
    wire.set_many(organizer=w.organizer, llm=w.llm, jobs=runner)
    try:
        t0 = time.monotonic()
        env = _rpc(rpc_org.organize_run, {})
        assert time.monotonic() - t0 < 1.0, "answers in < 1 s"
        job = _check("organize.run", env)["job"]
        assert started.wait(5)
        assert _rpc(rpc_org.organize_run, {})["error"]["code"] == "busy"
    finally:
        release.set()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        cur = runner.get(job["id"])
        if cur is not None and cur.status in (T.JobStatus.done, T.JobStatus.error):
            break
        time.sleep(0.05)
    assert cur is not None and cur.status is T.JobStatus.done, cur
    _check_job_result(cur.result)
    assert len(w.organizer.pending()) == 2


def test_rpc_accept_reject_and_params(wired: Any) -> None:
    w, _runner = wired
    # made before the run: a folder created afterwards would make the proposal outdated
    ciencia = w.taxonomy.create_folder("Ciência")
    (a, b, c, d), _ = _two_groups(w)
    sid = {s.channel_id: s.id for s in w.organizer.pending()}
    before = snapshot(w.db)

    for bad in (
        {},
        {"edits": {a: {"folder": "X"}}},
        {"suggestion_ids": "x"},
        {"suggestion_ids": [1]},
        {"channel_ids": [a], "edits": {a: {"folder": 3}}},
        {"channel_ids": [a], "edits": {a: {"color": "x"}}},
        {"channel_ids": [a], "edits": {a: {"tags": "x"}}},
        {"channel_ids": [a], "edits": {a: {"folder": "../x"}}},
        {"channel_ids": [a], "edits": "x"},
    ):
        err = _check("organize.accept", _rpc(rpc_org.organize_accept, bad), ok=False)
        assert err["code"] == "invalid", (bad, err)
    nf = _check(
        "organize.accept", _rpc(rpc_org.organize_accept, {"suggestion_ids": ["nope"]}), ok=False
    )
    assert nf["code"] == "not_found"
    assert snapshot(w.db) == before

    data = _check(
        "organize.accept",
        _rpc(
            rpc_org.organize_accept,
            {"suggestion_ids": [sid[a]], "edits": {a: {"folder": "Ciência", "tags": None}}},
        ),
    )
    assert data["accepted"] == [sid[a]] and data["change_group"]
    assert w.channels.get(a).folder_id == ciencia.id
    assert tag_names(w, a) == ["ia"], "tags: null = keep the suggested ones"

    data = _check("organize.accept", _rpc(rpc_org.organize_accept, {"channel_ids": [b]}))
    assert data["accepted"] == [sid[b]]

    for bad in ({}, {"channel_ids": "x"}, {"suggestion_ids": [None]}):
        err = _check("organize.reject", _rpc(rpc_org.organize_reject, bad), ok=False)
        assert err["code"] == "invalid"
    assert _check("organize.reject", _rpc(rpc_org.organize_reject, {"channel_ids": [c]})) == {
        "count": 1
    }
    assert _check(
        "organize.reject", _rpc(rpc_org.organize_reject, {"suggestion_ids": [sid[d]]})
    ) == {"count": 1}
    assert _check("getSuggestions", _call(api_org.get_suggestions)) == {"items": []}


def test_get_suggestions_grouped_by_folder_with_model(wired: Any) -> None:
    w, _ = wired
    subscribe(w, 1, 2, 3, 4)
    w.taxonomy.create_folder("Música")
    confs = {cid(1): 0.4, cid(2): 0.9, cid(3): 0.7, cid(4): 0.6}
    folders = {cid(1): "Tecnologia", cid(2): "Música", cid(3): "Tecnologia", cid(4): "Música"}
    w.llm.script(
        ORGANIZE,
        lambda p: {
            "items": [
                proposal(
                    it["channel_id"],
                    folders[it["channel_id"]],
                    new=folders[it["channel_id"]] != "Música",
                    conf=confs[it["channel_id"]],
                )
                for it in p["items"]
            ]
        },
    )
    w.organizer.organize()
    items = _check("getSuggestions", _call(api_org.get_suggestions))["items"]
    assert [(i["payload"]["folder"], i["channel_id"]) for i in items] == [
        ("Música", cid(2)),
        ("Música", cid(4)),
        ("Tecnologia", cid(3)),
        ("Tecnologia", cid(1)),
    ], "grouped by folder, most confident first"
    assert {i["model"] for i in items} == {MODEL}
    assert {i["kind"] for i in items} == {"organize"}


# =========================================================================== 6. conformance


def test_fake_suite_organizer_accept_and_undo_with_real(real: None, rdb: Any) -> None:
    """The fake's service test (``test_fakes``) running with the real ``Organizer`` (and the
    world's default ``FakeLLM``, which answers as ``fake-model``)."""
    world = build_fake_world(rdb)
    assert isinstance(world.organizer, OG.Organizer)
    test_fakes.test_organizer_accept_and_undo(world)


def _scenario(w: Any) -> dict[str, Any]:
    a, b, c = subscribe(w, 1, 2, 3)
    w.taxonomy.create_folder("Música")

    def rule(channel: str) -> dict[str, Any]:
        if channel == b:
            return {"folder": "Música", "new": False}
        return {"folder": "Tecnologia/IA", "new": True, "tags": ["ia"]}

    w.llm.script(ORGANIZE, answer(rule), answer(rule))
    res = w.organizer.organize()
    out: dict[str, Any] = {
        "result": sorted((s.channel_id, s.payload["folder"], s.model) for s in res.suggestions),
        "applied_before_accept": [folder_path(w, w.channels.get(x).folder_id) for x in (a, b, c)],
    }
    w.organizer.organize()
    out["pending_after_rerun"] = sorted(s.channel_id for s in w.organizer.pending())
    group = [s.id for s in w.organizer.pending() if s.payload["folder"] == "Tecnologia/IA"]
    rep = w.organizer.accept(group)
    out["accepted"] = len(rep.accepted)
    out["created_folders"] = len(rep.created_folders)
    out["created_tags"] = len(rep.created_tags)
    out["after_accept"] = {
        x: (folder_path(w, w.channels.get(x).folder_id), tag_names(w, x)) for x in (a, b, c)
    }
    out["pending"] = sorted(s.channel_id for s in w.organizer.pending())
    out["rejected"] = w.organizer.reject(channel_ids=[b])
    rec = next(r for r in w.changelog.list() if r.action is T.ChangeAction.organize_accept)
    w.changelog.undo(rec.id, targets=w.targets())
    out["after_undo"] = {x: folder_path(w, w.channels.get(x).folder_id) for x in (a, b, c)}
    out["folders_after_undo"] = sorted(f.name for f in w.taxonomy.list_folders())
    out["pending_after_undo"] = sorted(s.channel_id for s in w.organizer.pending())
    return out


def _fake_only_world() -> Any:
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(fake_world_module, "FakeChangeLog", FakeChangeLog)
        mp.setattr(fake_world_module, "FakeChannelService", FakeChannelService)
        mp.setattr(fake_world_module, "FakeTaxonomyService", FakeTaxonomyService)
        mp.setattr(fake_world_module, "FakeOrganizer", FakeOrganizer)
        return build_fake_world(MemDb(), llm=FakeLLM(model=MODEL))
    finally:
        mp.undo()


def test_conformance_fake_vs_real(rw: Any) -> None:
    fake = _fake_only_world()
    assert isinstance(fake.organizer, FakeOrganizer)
    assert isinstance(fake.channels, FakeChannelService)
    assert isinstance(fake.taxonomy, FakeTaxonomyService)
    assert isinstance(fake.changelog, FakeChangeLog)
    got_fake = _scenario(fake)
    got_real = _scenario(rw)
    assert got_real == got_fake


# ================================================ 6b. channels without a folder come first


def _filed_and_unfiled(w: Any) -> tuple[list[str], list[str], Any]:
    """Two channels already in ``Ciência`` (one with tag ``math``) and two without a folder."""
    f1, f2, u1, u2 = subscribe(w, 1, 2, 3, 4)
    ciencia = w.taxonomy.create_folder("Ciência")
    math = w.taxonomy.create_tag("math")
    w.channels.move([f1, f2], ciencia.id)
    w.channels.set_tags(f2, [math.id])
    return [f1, f2], [u1, u2], ciencia


def _insert_legacy(w: Any, channel_id: str, payload: dict[str, Any], sid: str) -> None:
    """A pending suggestion as an older version saved it (no ``basis``)."""
    w.db.execute(
        "INSERT INTO suggestions (id, kind, channel_id, payload, status, model, created_at)"
        " VALUES (?, 'organize', ?, ?, 'pending', ?, ?)",
        (sid, channel_id, json.dumps(payload), MODEL, 1_762_000_000),
    )


def test_selection_sends_channels_without_a_folder_first(rw: Any) -> None:
    w = rw
    (f1, f2), (u1, u2), _ = _filed_and_unfiled(w)
    w.llm.script(ORGANIZE, same("Tech", new=True))
    w.organizer.organize([f1, u1, f2, u2])
    sent = [it["channel_id"] for it in w.llm.calls_for(ORGANIZE)[-1]["items"]]
    assert sent == [u1, u2, f1, f2], "channels without a folder go to the model first"


def test_same_folder_without_anything_new_is_not_saved(rw: Any) -> None:
    w = rw
    (f1, f2), (u1, u2), ciencia = _filed_and_unfiled(w)

    def rule(channel: str) -> dict[str, Any]:
        if channel == f1:
            return {"folder": "Ciência", "tags": ["math"]}  # same folder, new tag
        if channel == f2:
            return {"folder": "ciência ", "tags": ["Math"]}  # same folder, tag it already has
        return {"folder": "Ciência"}

    w.llm.script(ORGANIZE, answer(rule))
    res = w.organizer.organize([f1, f2, u1, u2])
    got = {s.channel_id: s.payload for s in res.suggestions}
    assert sorted(got) == sorted([f1, u1, u2]), "same folder and nothing new: no suggestion"
    assert got[f1]["same_folder"] is True and got[f1]["new_tags"] == ["math"]
    assert got[u1]["same_folder"] is False and got[u1]["new_tags"] == []
    assert sorted(s.channel_id for s in w.organizer.pending()) == sorted([f1, u1, u2])

    w.organizer.accept(channel_ids=[f1])
    assert w.channels.get(f1).folder_id == ciencia.id, "a tag-only suggestion does not move"
    assert tag_names(w, f1) == ["math"]


def test_stored_same_folder_suggestion_is_dropped_on_read(rw: Any) -> None:
    """The case seen in the app: pending suggestions from an earlier run for channels already
    in the folder they suggest, nothing new — the dialog reopened them as the proposal."""
    w = rw
    (f1, f2), (u1, _u2), ciencia = _filed_and_unfiled(w)
    base = {"new_folder": False, "confidence": 0.93, "why": "science explainers"}
    _insert_legacy(
        w,
        f1,
        {**base, "channel_id": f1, "folder": "Ciência", "tags": [], "from_folder_id": ciencia.id},
        "sg_legacy_1",
    )
    _insert_legacy(
        w,
        f2,
        {
            **base,
            "channel_id": f2,
            "folder": "Ciência",
            "tags": ["math"],
            "from_folder_id": ciencia.id,
        },
        "sg_legacy_2",
    )
    assert w.organizer.pending() == []
    st = statuses(w.db)
    assert st["sg_legacy_1"] == st["sg_legacy_2"] == "superseded"

    # a fresh suggestion whose tag the user added by hand meanwhile also goes away
    w.llm.script(ORGANIZE, same("Ciência", tags=["physics"]))
    (sug,) = w.organizer.organize([f1]).suggestions
    assert sug.payload["new_tags"] == ["physics"]
    physics = w.taxonomy.create_tag("physics")
    w.channels.set_tags(f1, [physics.id])
    assert [s.channel_id for s in w.organizer.pending()] == []
    assert u1 not in {s.channel_id for s in w.organizer.pending()}


def test_stored_proposal_is_not_reused_after_the_folders_change(rw: Any) -> None:
    w = rw
    a, b = subscribe(w, 1, 2)
    musica = w.taxonomy.create_folder("Música")
    w.llm.script(ORGANIZE, same("Música"), same("Música"), same("Music"))
    w.organizer.organize()
    assert len(w.organizer.pending()) == 2

    w.taxonomy.create_folder("Ciência")  # the user made a folder the model never saw
    assert w.organizer.pending() == [], "folder list changed: the old proposal is not reused"

    w.organizer.organize()
    assert len(w.organizer.pending()) == 2
    w.taxonomy.update_folder(musica.id, name="Music")
    assert w.organizer.pending() == [], "renamed folder: the old proposal is not reused"

    w.organizer.organize()
    assert sorted(s.channel_id for s in w.organizer.pending()) == sorted([a, b])


def test_legacy_suggestion_without_basis_is_not_reused(rw: Any) -> None:
    w = rw
    (u,) = subscribe(w, 1)
    _insert_legacy(
        w,
        u,
        {
            "channel_id": u,
            "folder": "Tech",
            "new_folder": True,
            "tags": [],
            "confidence": 0.5,
            "why": "x",
            "from_folder_id": None,
        },
        "sg_legacy_u",
    )
    assert w.organizer.pending() == []
    assert statuses(w.db)["sg_legacy_u"] == "superseded"


def test_accepting_or_undoing_keeps_the_rest_of_the_proposal(rw: Any) -> None:
    """Folders created by an accept (and removed by its undo) are the proposal's own doing: the
    other pending suggestions stay."""
    w = rw
    (a, b, c, d), _ = _two_groups(w)
    group = [s.id for s in w.organizer.pending() if s.payload["folder"] == "Tecnologia/IA"]
    rep = w.organizer.accept(group[:1])
    assert len(rep.created_folders) == 2
    left = sorted(s.channel_id for s in w.organizer.pending())
    assert len(left) == 3 and d in left
    rec = next(r for r in w.changelog.list() if r.action is T.ChangeAction.organize_accept)
    w.changelog.undo(rec.id, targets=w.targets())
    assert sorted(s.channel_id for s in w.organizer.pending()) == sorted([a, b, c, d])


def test_get_suggestions_lists_channels_without_a_folder_first(wired: Any) -> None:
    w, _ = wired
    (f1, _f2), (u1, u2), _ = _filed_and_unfiled(w)
    w.taxonomy.create_folder("Arte")

    def rule(channel: str) -> dict[str, Any]:
        if channel == f1:
            return {"folder": "Arte"}  # moves a filed channel
        # u1/u2: move + tag (most confident first within the folder)
        return {"folder": "Ciência", "tags": ["math"], "conf": 0.9 if channel == u1 else 0.7}

    w.llm.script(ORGANIZE, answer(rule))
    w.organizer.organize([f1, u1, u2])
    w.llm.script(ORGANIZE, same("Ciência", tags=["new one"]))
    w.organizer.organize([_f2])
    items = _check("getSuggestions", _call(api_org.get_suggestions))["items"]
    assert [i["channel_id"] for i in items] == [u1, u2, f1, _f2], (
        "without a folder first, then moves of filed channels, then tag-only"
    )


# =========================================================================== 7. live


HERMES_SRC = Path(os.environ.get("HERMES_SRC") or Path.home() / ".hermes" / "hermes-agent")

_LIVE = r"""
import importlib.util, json, sys, tempfile, time
from pathlib import Path
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location("_tube_boot_live", sys.argv[1])
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)
boot.ensure()
from agent.plugin_llm import PluginLlm
from tube_pkg._id import PLUGIN_ID
from tube_pkg.adapters import hermes_llm
from tube_pkg.core import ai, changes, channels, db as core_db, organize, taxonomy
from tube_pkg.core import types as T

class Settings:
    def get(self, key, default=None):
        return {"language": "pt-BR"}.get(key, default)

ctx = SimpleNamespace(llm=PluginLlm(plugin_id=PLUGIN_ID))
backend = hermes_llm.HermesLLMBackend(ctx, task=None)
llm = ai.build(settings=Settings(), llm_backend=backend)
if not llm.available():
    print("SKIP no model"); sys.exit(0)
demo = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["channels"][:20]
db = core_db.build(path=str(Path(tempfile.mkdtemp()) / "live.db"))
s = Settings()
log = changes.build(db=db, settings=s)
chs = channels.build(db=db, settings=s, youtube=SimpleNamespace(), changelog=log)
tax = taxonomy.build(db=db, settings=s, channels=chs, changelog=log)
for name in ("Tecnologia", "Ciência", "Música"):
    tax.create_folder(name)
chs.upsert_many(
    [T.ChannelIn(title=c["title"], channel_id=c["id"], handle=c.get("handle")) for c in demo],
    source=T.ChannelSource.demo, relation=T.Relation.subscribed,
)
org = organize.build(db=db, settings=s, llm=llm, channels=chs, taxonomy=tax, changelog=log)
t0 = time.monotonic()
res = org.organize(timeout=300)
took = time.monotonic() - t0
title = {c["id"]: c["title"] for c in demo}
print("LIVE", res.model, f"{took:.1f}s", len(res.suggestions), "of", len(demo))
for sug in res.suggestions:
    p = sug.payload
    row = {"channel": title[sug.channel_id], "folder": p["folder"], "new": p["new_folder"],
           "tags": p["tags"], "conf": p["confidence"], "why": p["why"]}
    print(json.dumps(row, ensure_ascii=False))
assert all(s.status is T.SuggestionStatus.pending for s in res.suggestions)
assert all(chs.get(c["id"]).folder_id is None for c in demo), "nothing applied"
"""


@pytest.mark.live
def test_live_organize_twenty_demo_channels(tmp_path: Path) -> None:
    """20 demo channels through the real model (``PluginLlm`` = ``ctx.llm``), on the Hermes-managed
    Python (in the project ``.venv`` Hermes relaunches the interpreter mid-call)."""
    if not HERMES_SRC.is_dir():
        pytest.skip("Hermes missing")
    found = subprocess.run(
        [
            sys.executable,
            "-c",
            "from pathlib import Path; from pm.environments import "
            f"project_python; print(project_python(Path({str(HERMES_SRC)!r})))",
        ],
        cwd=HERMES_SRC,
        capture_output=True,
        text=True,
        timeout=60,
    )
    python = found.stdout.strip()
    if found.returncode or not Path(python).exists():
        pytest.skip(f"Hermes Python not found: {found.stderr[-300:]}")
    script = tmp_path / "live.py"
    script.write_text(_LIVE, encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("TUBE_DB_PATH", "PYTHONPATH")}
    out = subprocess.run(
        [
            python,
            str(script),
            str(ROOT / "plugin" / "_bootstrap.py"),
            str(ROOT / "plugin" / "data" / "demo_channels.json"),
        ],
        cwd=HERMES_SRC,
        capture_output=True,
        text=True,
        timeout=420,
        env=env,
    )
    print(out.stdout[-6000:])
    if out.stdout.startswith("SKIP"):
        pytest.skip(out.stdout.strip())
    assert out.returncode == 0, out.stderr[-3000:]
    assert "LIVE" in out.stdout
    assert json  # used in the script
