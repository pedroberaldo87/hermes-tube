"""Theme tabs — the real ``Themes`` (``core/themes.py``), RPC ``theme.*`` (``rpc/themes.py``)
and ``GET /themes[/{id}]`` (``api/themes.py``).

Real database (``core.db.build``) with the real services ``VideoStore``, ``FeedEngine``,
``VideoStateService``, ``ChangeLog``, ``ChannelService``, ``TaxonomyService`` and
``TabService``; AI through ``FakeLLM`` (validates input and output against the schemas) or a local
``LenientLLM`` that returns the **raw** output (a model/adapter that lets junk through); search
through ``FakeSearcher`` (the real ``Searcher`` is tested in ``test_search_jobs.py``).

Blocks:
1. core contract (``build``, ``Protocol``, hygiene);
2. create: stages, **one** ``search_many``, dedup, seeds, preview, batches of 120, classics;
3. budget: time out → partial preview flagged; expand with no answer → search by the text;
4. no model, empty search, untrusted model output;
5. save → tab in the real feed, folder, seeds, undo in one step; validation;
6. refresh (seed RSS with no tokens; new search on the cadence); 👎 in the next curation;
   expiry of abandoned previews; ``import_rows``;
7. RPC/REST validated strictly against the contract (job < 1 s, events, ``busy``);
8. fake × real conformance;
9. ``live`` (outside ``check``): "agentes de IA" with the real model and host search.
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Iterator, Sequence
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
    FakeFeedEngine,
    FakeJobRunner,
    FakeLens,
    FakeLLM,
    FakeSearcher,
    FakeSettings,
    FakeTabService,
    FakeTaxonomyService,
    FakeThemes,
    FakeVideoStateService,
    FakeVideoStore,
    FakeYouTube,
    MemDb,
    build_fake_world,
)

from tube_pkg.api import _common
from tube_pkg.api import themes as api_themes
from tube_pkg.core import changes as CG
from tube_pkg.core import channels as CH
from tube_pkg.core import db as core_db
from tube_pkg.core import feed as FD
from tube_pkg.core import jobs as core_jobs
from tube_pkg.core import refresh as RF
from tube_pkg.core import tabs as TB
from tube_pkg.core import taxonomy as TX
from tube_pkg.core import themes as TH
from tube_pkg.core import types as T
from tube_pkg.core import video_state as VS
from tube_pkg.rpc import themes as rpc_themes

ROOT = Path(__file__).resolve().parents[1]
EXPAND = T.AiTask.theme_expand
CURATE = T.AiTask.theme_curate
DAY = 86_400
STAGES = ["expand", "search", "curate", "preview"]
NO_RESULTS = ["sem a", "sem b", "sem c", "sem d", "sem e"]
"""Searches no script answers (empty preview, no curation)."""


def _load_by_path(name: str, path: Path) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_i04a", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)


# --------------------------------------------------------------------------- data


def cid(n: int) -> str:
    """Valid channel id (``UC`` + 22)."""
    return f"UCi04atest{n:014d}"


def vid(n: int) -> str:
    """Valid video id (11)."""
    return f"i04a{n:07d}"


def hit(
    n: int,
    channel: int,
    *,
    title: str | None = None,
    days: int = 2,
    now: int = FakeClock().now(),
    views: int | None = 1000,
) -> T.SearchHit:
    return T.SearchHit(
        video_id=vid(n),
        title=title or f"Agentes de IA na prática {n}",
        channel_id=cid(channel),
        channel_title=f"Canal {channel}",
        duration_s=600,
        views=views,
        published_text=f"{days} days ago",
        published_at=now - days * DAY,
    )


def expand_out(
    searches: Sequence[str] = ("agentes de IA", "AI agents tutorial", "agentes LLM", "x y", "z w"),
    *,
    mode: str = "fresh",
    name: str = "Agentes de IA",
    icon: str = "🤖",
    include: Sequence[str] = ("agente",),
    exclude: Sequence[str] = ("reaction",),
) -> dict[str, Any]:
    return {
        "name": name,
        "icon": icon,
        "searches": list(searches),
        "include_terms": list(include),
        "exclude_terms": list(exclude),
        "mode": mode,
    }


def keep_all(
    *, cut: Sequence[str] = (), score: Callable[[int], float] | None = None
) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """``theme_curate`` answer: keeps everything (except *cut*), decreasing score."""

    def respond(payload: dict[str, Any]) -> dict[str, Any]:
        items = payload["items"]
        return {
            "items": [
                {
                    "video_id": it["video_id"],
                    "keep": it["video_id"] not in cut,
                    "score": score(i) if score else round(0.99 - i / (len(items) + 2), 4),
                    "why": "Bom para o tema.",
                }
                for i, it in enumerate(items)
            ]
        }

    return respond


def rows(db: Any, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in db.query(sql, params)]


def snapshot(db: Any) -> dict[str, list[dict[str, Any]]]:
    tables = ("themes", "theme_items", "tabs", "folders", "channels", "changes", "videos")
    return {t: rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in tables}


# --------------------------------------------------------------------------- real world


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
    return TX.build(
        db=db, settings=FakeSettings(), channels=channels, changelog=changelog, clock=clock
    )


def _make_tabs(
    db: Any, *, changelog: Any, known_lenses: Any = (), clock: Any = None, ids: Any = None
) -> Any:
    return TB.TabService(
        db=db,
        settings=FakeSettings(),
        changelog=changelog,
        clock=clock,
        known_lenses=known_lenses,
    )


def _make_video_state(db: Any, *, changelog: Any, clock: Any = None, ids: Any = None) -> Any:
    return VS.build(db=db, settings=FakeSettings(), changelog=changelog, clock=clock)


def _make_video_store(db: Any, *, clock: Any = None, ids: Any = None) -> Any:
    return RF.build_video_store(db=db, settings=FakeSettings(), clock=clock)


def _make_feed(
    db: Any,
    *,
    tabs: Any,
    taxonomy: Any,
    channels: Any,
    video_state: Any,
    video_store: Any,
    lenses: Any,
    clock: Any = None,
    ids: Any = None,
) -> Any:
    return FD.build(
        db=db,
        settings=FakeSettings(),
        youtube=FakeYouTube(),
        video_store=video_store,
        lenses=lenses,
        tabs=tabs,
        taxonomy=taxonomy,
        channels=channels,
        video_state=video_state,
        clock=clock,
    )


def _make_themes(
    db: Any,
    *,
    settings: Any,
    llm: Any,
    searcher: Any,
    lenses: Any,
    tabs: Any,
    taxonomy: Any,
    channels: Any,
    video_state: Any,
    video_store: Any,
    changelog: Any,
    clock: Any = None,
    ids: Any = None,
) -> Any:
    return TH.build(
        db=db,
        settings=settings,
        llm=llm,
        searcher=searcher,
        lenses=lenses,
        tabs=tabs,
        taxonomy=taxonomy,
        channels=channels,
        video_state=video_state,
        video_store=video_store,
        changelog=changelog,
        clock=clock,
    )


REAL_FACTORIES = {
    "FakeChangeLog": _make_changelog,
    "FakeChannelService": _make_channels,
    "FakeTaxonomyService": _make_taxonomy,
    "FakeTabService": _make_tabs,
    "FakeVideoStateService": _make_video_state,
    "FakeVideoStore": _make_video_store,
    "FakeFeedEngine": _make_feed,
    "FakeThemes": _make_themes,
}
FAKE_FACTORIES = {
    "FakeChangeLog": FakeChangeLog,
    "FakeChannelService": FakeChannelService,
    "FakeTaxonomyService": FakeTaxonomyService,
    "FakeTabService": FakeTabService,
    "FakeVideoStateService": FakeVideoStateService,
    "FakeVideoStore": FakeVideoStore,
    "FakeFeedEngine": FakeFeedEngine,
    "FakeThemes": FakeThemes,
}


def _patch(mp: pytest.MonkeyPatch, factories: dict[str, Any]) -> None:
    for name, factory in factories.items():
        mp.setattr(fake_world_module, name, factory)


@pytest.fixture
def real(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch(monkeypatch, REAL_FACTORIES)


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "i04a.db"))
    yield db
    db.close()


@pytest.fixture
def llm() -> FakeLLM:
    return FakeLLM(model="modelo-teste")


def _world(rdb: Any, clock: FakeClock, llm: Any, lenses: Sequence[Any] | None = None) -> Any:
    world = build_fake_world(rdb, clock=clock, llm=llm, lenses=lenses)
    world.searcher = FakeSearcher(clock=clock)  # no YouTube: only the script
    world.themes = rebuild_themes(world)
    assert isinstance(world.themes, TH.ThemeService)
    assert isinstance(world.feed, FD.FeedEngine)
    assert isinstance(world.tabs, TB.TabService)
    assert isinstance(world.channels, CH.ChannelService)
    return world


def rebuild_themes(w: Any, **options: Any) -> Any:
    """Real ``ThemeService`` on the dependencies of world *w* (+ test options)."""
    return TH.ThemeService(
        db=w.db,
        settings=w.settings,
        llm=w.llm,
        searcher=w.searcher,
        lenses=w.lenses,
        tabs=w.tabs,
        taxonomy=w.taxonomy,
        channels=w.channels,
        video_state=w.video_state,
        video_store=w.video_store,
        changelog=w.changelog,
        clock=w.clock,
        **options,
    )


@pytest.fixture
def rw(real: None, rdb: Any, clock: FakeClock, llm: FakeLLM) -> Any:
    """World with the real services on the real database; fake search and AI."""
    return _world(rdb, clock, llm)


class LenientLLM:
    """``LLM`` that returns the raw answer of *respond(task, payload)* (no schema, no rules)."""

    def __init__(self, respond: Callable[[T.AiTask, dict[str, Any]], Any]) -> None:
        self.respond = respond
        self.calls: list[tuple[T.AiTask, dict[str, Any]]] = []

    def available(self) -> bool:
        return True

    def model_name(self) -> str | None:
        return "lenient"

    def complete_structured(
        self, task: T.AiTask, payload: Any, *, timeout: float = 60.0, on_progress: Any = None
    ) -> Any:
        self.calls.append((T.AiTask(task), payload))
        return self.respond(T.AiTask(task), payload)


def script_search(w: Any, table: dict[str, Sequence[T.SearchHit]]) -> None:
    for query, hits in table.items():
        w.searcher.script(query, list(hits))


def standard(w: Any) -> list[str]:
    """Default script: 5 searches, 3 of them with results that repeat across each other.

    Channel 1: 4 videos (seed) · channel 2: 3 videos, 1 cut (not a seed) · channel 3: 1.
    """
    searches = ["agentes de IA", "AI agents tutorial", "agentes LLM", "x y", "z w"]
    w.llm.script(EXPAND, expand_out(searches))
    script_search(
        w,
        {
            "agentes de IA": [hit(1, 1), hit(2, 1), hit(3, 2)],
            "AI agents tutorial": [hit(2, 1), hit(4, 1), hit(5, 2)],
            "agentes LLM": [hit(1, 1), hit(6, 1), hit(7, 2), hit(8, 3)],
        },
    )
    w.llm.script(CURATE, keep_all(cut=[vid(7)]))
    return searches


# =========================================================================== 1. contract


def test_build_signature_protocol_and_inert(rdb: Any) -> None:
    sig = inspect.signature(TH.build)
    spec = next(s for s in T.BUILDS if s.module == "plugin/core/themes.py")
    assert list(sig.parameters) == [*spec.deps, "clock"]
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in sig.parameters.values())
    assert sig.parameters["clock"].default is None

    threads = threading.active_count()
    llm = FakeLLM()
    world = build_fake_world(rdb, llm=llm)
    before = snapshot(rdb)
    themes = TH.build(
        db=rdb,
        settings=world.settings,
        llm=llm,
        searcher=world.searcher,
        lenses=[],
        tabs=world.tabs,
        taxonomy=world.taxonomy,
        channels=world.channels,
        video_state=world.video_state,
        video_store=world.video_store,
        changelog=world.changelog,
    )
    assert isinstance(themes, T.Themes)
    assert not hasattr(themes, "__contract_stub__")
    assert threading.active_count() == threads, "build starts no thread"
    assert llm.calls == [] and world.searcher.batches == [], "build calls neither the AI nor search"
    assert snapshot(rdb) == before, "build writes nothing"


def test_module_hygiene() -> None:
    others = (
        "channels",
        "taxonomy",
        "tabs",
        "feed",
        "refresh",
        "video_state",
        "changes",
        "ai",
        "jobs",
        "organize",
        "cleanup",
        "search_jobs",
        "extras_hn",
        "youtube",
    )
    for rel in ("plugin/core/themes.py", "plugin/rpc/themes.py", "plugin/api/themes.py"):
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert "os.environ" not in src, rel
        assert "from plugin" not in src and "import plugin" not in src, rel
        assert "contract.stub" not in src, rel
        for other in others:
            assert f"tube_pkg.core.{other}" not in src, f"{rel} imports core/{other}"
            assert f"from tube_pkg.core import {other}" not in src, f"{rel} imports core/{other}"
    for fn in (
        rpc_themes.theme_create,
        rpc_themes.theme_save,
        rpc_themes.theme_refresh,
        api_themes.get_themes,
        api_themes.get_theme,
    ):
        assert _common.is_real(fn), fn.__name__


# =========================================================================== 2. create


def test_pipeline_stages_one_search_many_dedup_seeds_and_preview(rw: Any) -> None:
    w = rw
    searches = standard(w)
    progress: list[T.Progress] = []
    before_changes = rows(w.db, "SELECT * FROM changes")

    preview = w.themes.create("  agentes de IA  ", on_progress=progress.append)

    named = [p.stage for p in progress]
    first_seen = list(dict.fromkeys(named))
    assert first_seen == STAGES, named
    assert all(isinstance(p.message, str) and p.message for p in progress), progress

    assert len(w.searcher.batches) == 1, "a single search_many with every search"
    (batch,) = w.searcher.batches
    assert [(r.query, r.order) for r in batch] == [
        (s, o) for s in searches for o in (T.SearchOrder.relevance, T.SearchOrder.date)
    ]
    assert {r.theme_id for r in batch} == {preview.theme.id}

    (curate,) = w.llm.calls_for(CURATE)
    sent = [it["video_id"] for it in curate["items"]]
    assert sent == [vid(n) for n in (1, 2, 3, 4, 5, 6, 7, 8)], "dedup by video_id, in order"
    assert curate["query"] == "agentes de IA"
    assert curate["include_terms"] == ["agente"] and curate["exclude_terms"] == ["reaction"]
    assert {it["source"] for it in curate["items"]} == {"search"}

    stored = w.video_store.get(sent)
    assert set(stored) == set(sent)
    assert {v.origin for v in stored.values()} == {T.VideoOrigin.search}

    theme = preview.theme
    assert theme.status is T.ThemeStatus.preview and theme.error is None
    assert theme.query == "agentes de IA" and theme.name == "Agentes de IA" and theme.icon == "🤖"
    assert list(theme.searches) == searches
    assert theme.last_search_at == w.clock.now() and theme.tab_id is None
    assert list(theme.seeds) == [cid(1)], "≥ 3 kept (channel 2 has 2 kept + 1 cut)"
    kept = [i.video_id for i in preview.items]
    assert vid(7) not in kept and len(kept) == 7
    scores = [i.score for i in preview.items]
    assert scores == sorted(scores, reverse=True)
    assert {i.verdict for i in preview.items} == {T.ThemeVerdict.keep}
    assert set(preview.videos) == set(kept)
    assert [(s.channel_id, s.kept_videos, s.title) for s in preview.seeds] == [
        (cid(1), 4, "Canal 1")
    ]
    assert preview.channel_count == 3
    assert preview.video_count == 7

    # nothing applied before save: no channel followed, no history, no tab
    assert rows(w.db, "SELECT * FROM channels") == []
    assert rows(w.db, "SELECT * FROM changes") == before_changes
    assert rows(w.db, "SELECT * FROM tabs WHERE kind = 'theme'") == []
    assert w.themes.preview(theme.id) == preview
    assert w.themes.get(theme.id) == theme
    assert [t.id for t in w.themes.list()] == [theme.id]


def test_curation_in_small_batches_with_named_progress(rw: Any) -> None:
    w = rw
    w.llm.script(EXPAND, expand_out(["a b", "c d", "e f", "g h", "i j"]))
    big = {
        f"{q}": [hit(i * 100 + k, k % 40 + 1) for k in range(60)]
        for i, q in enumerate(["a b", "c d", "e f", "g h", "i j"])
    }
    script_search(w, big)
    w.llm.script(CURATE, *[keep_all()] * 6)
    progress: list[T.Progress] = []
    preview = w.themes.create("tema grande", on_progress=progress.append)
    calls = w.llm.calls_for(CURATE)
    assert TH.BATCH_SIZE == 40 and TH.MAX_CANDIDATES == 160
    assert sorted(len(c["items"]) for c in calls) == [40, 40, 40, 40], "160 candidates, 40 per call"
    sent = [it["video_id"] for c in calls for it in c["items"]]
    assert len(sent) == len(set(sent)) == 160, "each candidate goes to exactly one call"
    curate = [(p.done, p.total) for p in progress if p.stage == "curate"]
    assert (0, 4) in curate and (4, 4) in curate, curate
    steps = [p.step for p in progress if p.stage == "curate" and p.step is not None]
    assert (steps[-1].done, steps[-1].total) == (160, 160)
    assert preview.video_count == 160


class SlowLLM:
    """``LLM`` whose ``theme_curate`` calls block for *delay* seconds; records how many ran at
    the same time (the real model takes about a minute per long answer)."""

    def __init__(self, delay: float = 0.15, gate: threading.Event | None = None) -> None:
        self.delay = delay
        self.gate = gate
        self.lock = threading.Lock()
        self.running = 0
        self.peak = 0
        self.curate_calls: list[dict[str, Any]] = []
        self.started = threading.Event()

    def available(self) -> bool:
        return True

    def model_name(self) -> str | None:
        return "slow"

    def complete_structured(
        self, task: T.AiTask, payload: Any, *, timeout: float = 60.0, on_progress: Any = None
    ) -> Any:
        task = T.AiTask(task)
        if task is EXPAND:
            return expand_out(["a b", "c d", "e f", "g h", "i j"])
        with self.lock:
            self.running += 1
            self.peak = max(self.peak, self.running)
            self.curate_calls.append(payload)
        self.started.set()
        try:
            if self.gate is not None:
                self.gate.wait(10)
            else:
                time.sleep(self.delay)
            return keep_all()(payload)
        finally:
            with self.lock:
                self.running -= 1


def _many_hits(w: Any, count: int = 200) -> None:
    script_search(w, {"a b": [hit(k, k % 20 + 1) for k in range(1, count + 1)]})


def test_curation_calls_run_in_parallel_and_finish_sooner(rw: Any) -> None:
    w = rw
    w.llm = SlowLLM(delay=0.2)
    w.themes = rebuild_themes(w)
    _many_hits(w)
    started = time.monotonic()
    preview = w.themes.create("tema grande")
    took = time.monotonic() - started
    assert len(w.llm.curate_calls) == 4
    assert w.llm.peak == TH.CURATE_PARALLEL == 4, "the four calls run at the same time"
    assert took < 0.6, f"4 calls of 0.2 s in parallel, not 0.8 s in a row ({took:.2f} s)"
    # same shape for the screen: kept items with score and reason, sorted by score
    assert preview.video_count == 160
    assert all(i.reason == "Bom para o tema." and i.score is not None for i in preview.items)
    scores = [i.score for i in preview.items]
    assert scores == sorted(scores, reverse=True)


def test_curation_calls_see_the_callers_context(rw: Any) -> None:
    """The host keeps the profile it is serving in a context variable and checks the plugin's AI
    route against it: a pool thread that starts with an empty context is refused."""
    import contextvars

    profile: contextvars.ContextVar[str] = contextvars.ContextVar("profile", default="none")
    seen: list[str] = []

    class ContextLLM(SlowLLM):
        def complete_structured(self, task: T.AiTask, payload: Any, **kw: Any) -> Any:
            if T.AiTask(task) is not EXPAND:
                with self.lock:
                    seen.append(profile.get())
            return super().complete_structured(task, payload, **kw)

    w = rw
    w.llm = ContextLLM(delay=0.01)
    w.themes = rebuild_themes(w)
    _many_hits(w)
    token = profile.set("the-profile-being-served")
    try:
        w.themes.create("tema grande")
    finally:
        profile.reset(token)
    assert seen == ["the-profile-being-served"] * 4


def test_curation_parallelism_is_bounded_and_one_means_in_order(rw: Any) -> None:
    w = rw
    w.llm = SlowLLM(delay=0.02)
    w.themes = rebuild_themes(w, curate_parallel=1)
    _many_hits(w)
    w.themes.create("tema grande")
    assert w.llm.peak == 1
    firsts = [c["items"][0]["video_id"] for c in w.llm.curate_calls]
    assert firsts == [vid(1), vid(41), vid(81), vid(121)], "one at a time, in candidate order"


def test_cancel_during_curation_does_not_wait_for_the_model(rw: Any) -> None:
    w = rw
    gate = threading.Event()
    w.llm = SlowLLM(gate=gate)
    w.themes = rebuild_themes(w)
    _many_hits(w)
    cancelled = threading.Event()

    class Progress:
        def __call__(self, progress: T.Progress) -> None:
            self.check_cancelled()

        def check_cancelled(self) -> None:
            if cancelled.is_set():
                raise T.Cancelled()

    def cancel_soon() -> None:
        w.llm.started.wait(5)
        cancelled.set()

    threading.Thread(target=cancel_soon, daemon=True).start()
    started = time.monotonic()
    try:
        with pytest.raises(T.Cancelled):
            w.themes.create("tema grande", on_progress=Progress())
        took = time.monotonic() - started
        assert took < 2, f"cancel answered while the model was still busy ({took:.2f} s)"
        assert w.themes.list() == [], "cancelled create discards the preview"
    finally:
        gate.set()
    # the calls that come back late write nothing
    time.sleep(0.1)
    assert rows(w.db, "SELECT * FROM theme_items") == []


def test_curate_prompt_asks_for_a_minimal_answer() -> None:
    from tube_pkg.core import prompts as P

    sp = P.spec(CURATE)
    text = sp.instructions
    assert "at most 12 words" in text
    assert "Do not repeat the title" in text
    assert "video_id" in text and "keep" in text and "score" in text
    # the answer format is the same as before (contract only grows): the screen reads these
    item = sp.output_schema["properties"]["items"]["items"]
    assert set(item["properties"]) == {"video_id", "keep", "score", "why"}
    assert set(item["required"]) == {"video_id", "keep", "score", "why"}


def test_phase_timings_are_logged_one_line_per_phase(
    rw: Any, caplog: pytest.LogCaptureFixture
) -> None:
    w = rw
    standard(w)
    caplog.set_level("INFO", logger=TH.log.name)
    preview = w.themes.create("agentes de IA")
    lines = [r.getMessage() for r in caplog.records if r.name == TH.log.name]
    theme_id = preview.theme.id

    def line(phase: str) -> str:
        found = [x for x in lines if x.startswith(f"theme {theme_id} phase={phase} ")]
        assert len(found) == 1, (phase, lines)
        return found[0]

    assert "seconds=" in line("expand") and "searches=5" in line("expand")
    assert "input_chars=" in line("expand")
    assert "requests=10" in line("search") and "candidates=8" in line("search")
    assert "items=8" in line("curate_batch") and "input_chars=" in line("curate_batch")
    curate = line("curate")
    for part in ("candidates=8", "batches=1", "parallel=", "evaluated=8", "kept=7", "input_chars="):
        assert part in curate, curate
    assert "seconds=" in line("total")


def test_classics_mode_joins_enabled_lens_and_tab_uses_mode(
    real: None, rdb: Any, clock: FakeClock, llm: FakeLLM
) -> None:
    classic = hit(900, 9, title="O clássico dos agentes", days=2000, views=9_000_000)
    lens = FakeLens(classics=[classic, hit(1, 1)])
    w = _world(rdb, clock, llm, lenses=[lens])
    w.llm.script(EXPAND, expand_out(mode="classics"))
    script_search(w, {"agentes de IA": [hit(1, 1), hit(2, 1)]})
    w.llm.script(CURATE, keep_all())
    preview = w.themes.create("agentes de IA")
    (curate,) = w.llm.calls_for(CURATE)
    src = {it["video_id"]: it["source"] for it in curate["items"]}
    assert src == {vid(1): "search", vid(2): "search", vid(900): "classics"}, "search wins dedup"
    assert ("classics", ("agentes de IA", TH.CLASSICS_LIMIT)) in lens.calls
    item = next(i for i in preview.items if i.video_id == vid(900))
    assert item.source is T.ThemeItemSource.classics
    saved = w.themes.save(preview.theme.id)
    assert saved.tab.rules.mode is T.FeedMode.classics
    page = w.feed.page(saved.tab.id)
    assert vid(900) in [it.video.id for it in page.items], "a 5-year-old classic shows in the tab"

    # fresh mode or lens off: no classics
    lens.calls.clear()
    w.llm.script(EXPAND, expand_out(mode="fresh"))
    w.llm.script(CURATE, keep_all())
    w.themes.create("outro")
    assert not [c for c in lens.calls if c[0] == "classics"]
    lens.set_enabled(False)
    w.llm.script(EXPAND, expand_out(mode="classics"))
    w.llm.script(CURATE, keep_all())
    p3 = w.themes.create("mais um")
    assert vid(900) not in [i.video_id for i in p3.items]


# =========================================================================== 3. budget


class Mono:
    """Controllable monotonic clock (``create`` budget)."""

    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def _two_batches(w: Any) -> None:
    w.llm.script(EXPAND, expand_out(["a b", "c d", "e f", "g h", "i j"]))
    script_search(w, {"a b": [hit(k, k % 5 + 1) for k in range(1, 151)]})


def test_timeout_during_curation_delivers_partial_preview(rw: Any) -> None:
    w = rw
    mono = Mono()
    w.themes = rebuild_themes(w, monotonic=mono, curate_parallel=1)
    _two_batches(w)

    def slow_first(payload: dict[str, Any]) -> dict[str, Any]:
        mono.t += 89.5  # the first batch eats almost all of the 90 s budget
        return keep_all()(payload)

    w.llm.script(CURATE, slow_first, keep_all())
    progress: list[T.Progress] = []
    preview = w.themes.create("tema", timeout=90, on_progress=progress.append)
    assert len(w.llm.calls_for(CURATE)) == 1, "the second batch does not start without budget"
    theme = preview.theme
    assert theme.status is T.ThemeStatus.preview
    assert theme.error and "partial" in theme.error.lower(), theme.error
    assert "40 of 150" in theme.error
    assert preview.video_count == 40
    assert progress[-1].stage == "preview" and "partial" in (progress[-1].message or "").lower()


def test_llm_timeout_on_a_batch_keeps_finished_batches(rw: Any) -> None:
    w = rw
    w.themes = rebuild_themes(w, curate_parallel=1)
    _two_batches(w)
    w.llm.script(CURATE, keep_all(), T.OperationTimeout("A IA demorou demais"))
    preview = w.themes.create("tema")
    assert len(w.llm.calls_for(CURATE)) == 2, "after a timeout no new call starts"
    assert preview.video_count == 40
    assert preview.theme.error and "partial" in preview.theme.error.lower()


def test_parallel_batch_timeout_keeps_the_other_batches(rw: Any) -> None:
    w = rw
    _two_batches(w)  # 150 candidates → 4 parallel calls (40, 40, 40, 30)
    w.llm.script(CURATE, keep_all(), T.OperationTimeout("slow"), keep_all(), keep_all())
    preview = w.themes.create("tema")
    assert len(w.llm.calls_for(CURATE)) == 4
    assert preview.video_count in (110, 120), "only the batch that timed out is missing"
    assert preview.theme.error and "partial" in preview.theme.error.lower()


def test_timeout_before_any_curation_is_an_explained_empty_preview(rw: Any) -> None:
    w = rw
    w.llm.script(EXPAND, expand_out())
    script_search(w, {"*": [hit(1, 1)]})
    w.llm.script(CURATE, T.OperationTimeout("A IA demorou demais"))
    preview = w.themes.create("tema")
    assert preview.theme.status is T.ThemeStatus.preview
    assert preview.video_count == 0
    assert preview.theme.error and "partial" in preview.theme.error.lower()


def test_expand_failure_falls_back_to_the_query_as_search(rw: Any) -> None:
    w = rw
    w.llm.script(EXPAND, T.OperationTimeout("lento"))
    script_search(w, {"agentes de IA": [hit(1, 1)]})
    w.llm.script(CURATE, keep_all())
    preview = w.themes.create("agentes de IA")
    assert list(preview.theme.searches) == ["agentes de IA"]
    assert preview.theme.name == "agentes de IA"
    assert preview.video_count == 1
    (batch,) = w.searcher.batches
    assert len(batch) == 2


# =========================================================================== 4. failures and output


def test_no_model_is_llm_unavailable_before_anything(rw: Any) -> None:
    w = rw
    w.llm.set_available(False)
    before = snapshot(w.db)
    with pytest.raises(T.LLMUnavailable) as err:
        w.themes.create("agentes de IA")
    assert "no ai model" in err.value.message.lower()
    assert snapshot(w.db) == before
    assert w.searcher.batches == []


def test_model_vanishing_mid_way_marks_theme_error(rw: Any) -> None:
    w = rw
    w.llm.script(EXPAND, expand_out())
    script_search(w, {"*": [hit(1, 1)]})
    w.llm.script(CURATE, T.LLMUnavailable("sem modelo"))
    with pytest.raises(T.LLMUnavailable):
        w.themes.create("agentes de IA")
    (theme,) = w.themes.list()
    assert theme.status is T.ThemeStatus.error and theme.error


def test_empty_search_is_an_explained_empty_preview(rw: Any) -> None:
    w = rw
    w.llm.script(EXPAND, expand_out())
    preview = w.themes.create("tema sem resultado")
    assert preview.theme.status is T.ThemeStatus.preview
    assert preview.items == () and preview.seeds == ()
    assert preview.theme.error and "no videos" in preview.theme.error.lower()
    assert w.llm.calls_for(CURATE) == [], "no candidates, no curation"

    w.llm.script(EXPAND, expand_out(["a b", "c d", "e f", "g h", "i j"]))
    for q in ("a b", "c d", "e f", "g h", "i j"):
        w.searcher.fail(q, "YouTube is down")
    preview = w.themes.create("outro")
    assert preview.video_count == 0
    assert "YouTube is down" in (preview.theme.error or "")


def test_model_output_is_untrusted(rw: Any) -> None:
    w = rw
    good = vid(1)

    def respond(task: T.AiTask, payload: dict[str, Any]) -> Any:
        if task is EXPAND:
            return {
                "name": "  Agentes\nde IA  " + "x" * 80,
                "icon": "🤖",
                "searches": [
                    "agentes",
                    "AGENTES",
                    " ",
                    "a" * 300,
                    7,
                    *[f"b{i} c" for i in range(12)],
                ],
                "include_terms": ["agente", 3],
                "exclude_terms": "nope",
                "mode": "turbo",
                "extra": True,
            }
        return {
            "items": [
                {"video_id": good, "keep": True, "score": 0.9, "why": "linha 1\nlinha 2"},
                {"video_id": "zzzzzzzzzzz", "keep": True, "score": 0.99, "why": "inventado"},
                {"video_id": "../../etc/x", "keep": True, "score": 0.99, "why": "inventado"},
                {"video_id": good, "keep": False, "score": 0.1, "why": "repetido"},
                {"video_id": vid(2), "keep": True, "score": 7, "why": "fora da faixa"},
                {"video_id": vid(3), "keep": "yes", "score": 0.5, "why": "tipo errado"},
                {"video_id": vid(4), "keep": True, "score": 0.5, "why": "x", "sql": "DROP"},
                {"video_id": vid(5), "keep": True, "score": 0.4},
                "lixo",
            ]
        }

    w.llm = LenientLLM(respond)
    w.themes = rebuild_themes(w)
    script_search(w, {"*": [hit(n, 1) for n in range(1, 6)]})
    preview = w.themes.create("agentes de IA")
    theme = preview.theme
    assert len(theme.searches) == 8 and theme.searches[0] == "agentes"
    assert all(2 <= len(s) <= 100 for s in theme.searches)
    assert len({s.casefold() for s in theme.searches}) == len(theme.searches)
    assert theme.name and len(theme.name) <= 40 and "\n" not in theme.name
    assert list(theme.include_terms) == ["agente"] and theme.exclude_terms == ()
    assert [i.video_id for i in preview.items] == [good]
    assert preview.items[0].reason == "linha 1 linha 2"
    stored = rows(w.db, "SELECT video_id FROM theme_items")
    assert [r["video_id"] for r in stored] == [good], "a made-up id never becomes a row"


def test_fake_llm_schema_valid_but_invented_ids_are_ignored(rw: Any) -> None:
    w = rw
    w.llm.script(EXPAND, expand_out())
    script_search(w, {"*": [hit(1, 1), hit(2, 1)]})
    w.llm.script(
        CURATE,
        {
            "items": [
                {"video_id": vid(1), "keep": True, "score": 0.8, "why": "ok"},
                {"video_id": "AAAAAAAAAAA", "keep": True, "score": 0.9, "why": "inventado"},
            ]
        },
    )
    preview = w.themes.create("agentes")
    assert [i.video_id for i in preview.items] == [vid(1)]
    assert rows(w.db, "SELECT * FROM theme_items WHERE video_id = 'AAAAAAAAAAA'") == []


def test_invalid_query_is_validation_error(rw: Any) -> None:
    for bad in ("", "   ", None, 3):
        with pytest.raises(T.ValidationError):
            rw.themes.create(bad)  # type: ignore[arg-type]
    assert rw.themes.list() == []


# =========================================================================== 5. save


def test_save_creates_tab_seen_by_real_feed_and_undo_restores_all(rw: Any) -> None:
    w = rw
    standard(w)
    preview = w.themes.create("agentes de IA")
    before = snapshot(w.db)
    edits = T.ThemeSaveEdits(
        name="Meus agentes",
        create_folder=True,
        folder_name="Agentes",
        seed_actions={
            cid(1): T.SeedAction.follow,
            cid(2): T.SeedAction.subscribe,
            cid(3): T.SeedAction.ignore,
        },
    )
    saved = w.themes.save(preview.theme.id, edits)
    assert saved.theme_id == preview.theme.id
    assert saved.tab.kind is T.TabKind.theme and saved.tab.name == "Meus agentes"
    assert saved.tab.icon == "🤖"
    assert saved.tab.rules.include.themes == (preview.theme.id,)
    assert saved.tab.rules.mode is T.FeedMode.classics, "the theme tab shows everything curated"
    assert saved.followed == (cid(1), cid(2)) and saved.to_subscribe == (cid(2),)
    folder = w.taxonomy.get_folder(saved.folder_id)
    assert folder is not None and folder.name == "Agentes"
    for c in (cid(1), cid(2)):
        ch = w.channels.get(c)
        assert ch.relation is T.Relation.followed, "real subscribing does not exist here"
        assert ch.source is T.ChannelSource.theme and ch.folder_id == folder.id
    assert w.channels.get(cid(3)) is None, "ignoring does not follow"
    theme = w.themes.get(preview.theme.id)
    assert theme.status is T.ThemeStatus.saved and theme.tab_id == saved.tab.id
    assert theme.name == "Meus agentes"
    assert cid(3) not in theme.seeds, "an ignored seed leaves the seeds"

    page = w.feed.page(saved.tab.id, limit=50)
    got = {it.video.id for it in page.items}
    assert got == {i.video_id for i in preview.items}, "the tab shows the kept videos"
    assert len(got) == preview.video_count
    assert {it.why.via for it in page.items} <= {T.WhyVia.theme, T.WhyVia.channel}

    rec = w.changelog.get(saved.change_id)
    assert rec.action is T.ChangeAction.theme_save and rec.group_id
    group = [r for r in w.changelog.list() if r.group_id == rec.group_id]
    assert {r.action for r in group} >= {
        T.ChangeAction.theme_save,
        T.ChangeAction.tab_create,
        T.ChangeAction.folder_create,
        T.ChangeAction.channel_add,
    }

    w.changelog.undo(saved.change_id, targets=w.targets())
    assert w.tabs.get(saved.tab.id) is None
    assert w.taxonomy.get_folder(saved.folder_id) is None
    assert w.channels.get(cid(1)) is None and w.channels.get(cid(2)) is None
    back = w.themes.get(preview.theme.id)
    assert back.status is T.ThemeStatus.preview and back.tab_id is None
    assert back.name == "Agentes de IA" and back.seeds == preview.theme.seeds
    with pytest.raises(T.NotFound):
        w.feed.page(saved.tab.id)
    after = snapshot(w.db)
    for table in ("themes", "theme_items", "tabs", "folders", "channels"):
        strip = lambda rs: [{k: v for k, v in r.items() if k != "updated_at"} for r in rs]  # noqa: E731
        assert strip(after[table]) == strip(before[table]), table

    again = w.themes.save(preview.theme.id)
    assert again.tab.kind is T.TabKind.theme, "saving again after undo"


@pytest.mark.parametrize(
    ("model_mode", "tab_mode"),
    [("fresh", T.FeedMode.classics), ("classics", T.FeedMode.classics), ("long", T.FeedMode.long)],
)
def test_tab_mode_keeps_old_curated_videos_visible(
    rw: Any, model_mode: str, tab_mode: T.FeedMode
) -> None:
    """Found by the live test: with ``fresh`` on the tab, only 11 of 75 curated videos showed
    (30 days). The theme tab uses ``classics`` ("themes and HN"), or ``long`` if the model asks."""
    w = rw
    w.llm.script(EXPAND, expand_out(mode=model_mode))
    old = T.SearchHit(
        video_id=vid(1),
        title="Agentes, a aula definitiva",
        channel_id=cid(1),
        duration_s=3600,
        published_at=w.clock.now() - 400 * DAY,
    )
    script_search(w, {"agentes de IA": [old]})
    w.llm.script(CURATE, keep_all())
    preview = w.themes.create("agentes de IA")
    saved = w.themes.save(preview.theme.id)
    assert saved.tab.rules.mode is tab_mode
    assert [it.video.id for it in w.feed.page(saved.tab.id).items] == [vid(1)]


def test_save_removed_videos_leave_tab_and_undo_brings_back(rw: Any) -> None:
    w = rw
    standard(w)
    preview = w.themes.create("agentes de IA")
    saved = w.themes.save(preview.theme.id, T.ThemeSaveEdits(removed_video_ids=(vid(1),)))
    assert vid(1) not in [i.video_id for i in w.themes.preview(preview.theme.id).items]
    assert vid(1) not in {it.video.id for it in w.feed.page(saved.tab.id, limit=50).items}
    (row,) = rows(w.db, "SELECT verdict FROM theme_items WHERE video_id = ?", (vid(1),))
    assert row["verdict"] == "user_down"
    w.changelog.undo(saved.change_id, targets=w.targets())
    assert vid(1) in [i.video_id for i in w.themes.preview(preview.theme.id).items]


def test_save_validation_writes_nothing(rw: Any) -> None:
    w = rw
    standard(w)
    preview = w.themes.create("agentes de IA")
    before = snapshot(w.db)
    with pytest.raises(T.NotFound):
        w.themes.save("th_nope")
    for edits in (
        T.ThemeSaveEdits(seed_actions={cid(77): T.SeedAction.follow}),
        T.ThemeSaveEdits(seed_actions={"nope": T.SeedAction.follow}),
        T.ThemeSaveEdits(removed_video_ids=("zzzzzzzzzzz",)),
        T.ThemeSaveEdits(name="   "),
        T.ThemeSaveEdits(name="x" * 200),
    ):
        with pytest.raises(T.ValidationError):
            w.themes.save(preview.theme.id, edits)
    assert snapshot(w.db) == before
    w.themes.save(preview.theme.id)
    with pytest.raises(T.Conflict):
        w.themes.save(preview.theme.id)


def test_save_reuses_existing_folder_and_keeps_subscribed_seed(rw: Any) -> None:
    w = rw
    standard(w)
    folder = w.taxonomy.create_folder("Agentes de IA")
    w.channels.upsert_many(
        [T.ChannelIn(title="Canal 1", channel_id=cid(1))],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    preview = w.themes.create("agentes de IA")
    saved = w.themes.save(
        preview.theme.id,
        T.ThemeSaveEdits(create_folder=True, seed_actions={cid(1): T.SeedAction.follow}),
    )
    assert saved.folder_id == folder.id
    assert w.channels.get(cid(1)).relation is T.Relation.subscribed, "never downgrades"
    w.changelog.undo(saved.change_id, targets=w.targets())
    assert w.taxonomy.get_folder(folder.id) is not None, "a folder that already existed stays"
    assert w.channels.get(cid(1)).relation is T.Relation.subscribed


# =========================================================================== 6. refresh and 👎


def _saved(w: Any) -> tuple[T.ThemePreview, T.ThemeSaved]:
    standard(w)
    preview = w.themes.create("agentes de IA")
    saved = w.themes.save(
        preview.theme.id, T.ThemeSaveEdits(seed_actions={cid(1): T.SeedAction.follow})
    )
    return preview, saved


def test_refresh_pulls_seed_rss_without_tokens_when_not_due(rw: Any) -> None:
    w = rw
    preview, saved = _saved(w)
    w.clock.advance(DAY)
    now = w.clock.now()
    w.video_store.upsert(
        [
            T.VideoIn(
                id=vid(500),
                channel_id=cid(1),
                title="Novo vídeo de agentes",
                channel_title="Canal 1",
                published_at=now - 3600,
            ),
            T.VideoIn(
                id=vid(501),
                channel_id=cid(1),
                title="REACTION a agentes",
                channel_title="Canal 1",
                published_at=now - 3600,
            ),
            T.VideoIn(
                id=vid(502),
                channel_id=cid(3),
                title="Canal que não é semente",
                channel_title="Canal 3",
                published_at=now - 3600,
            ),
        ],
        T.VideoOrigin.rss,
    )
    calls, batches = len(w.llm.calls), len(w.searcher.batches)
    assert w.themes.due() == []
    progress: list[T.Progress] = []
    out = w.themes.refresh(preview.theme.id, on_progress=progress.append)
    assert len(w.llm.calls) == calls and len(w.searcher.batches) == batches, "0 tokens, 0 searches"
    kept = {i.video_id: i for i in out.items}
    assert vid(500) in kept and kept[vid(500)].source is T.ThemeItemSource.rss
    assert vid(501) not in kept, "exclude_terms filters without AI"
    assert vid(502) not in kept, "seed channels only"
    assert set(i.video_id for i in preview.items) <= set(kept), "kept ones stay"
    assert out.theme.last_search_at == preview.theme.last_search_at
    assert out.theme.status is T.ThemeStatus.saved
    assert vid(500) in {it.video.id for it in w.feed.page(saved.tab.id, limit=50).items}
    assert [p.stage for p in progress][0] == "seeds" and progress[-1].stage == "preview"


def test_refresh_when_due_searches_again_and_only_new_candidates_are_curated(rw: Any) -> None:
    w = rw
    preview, _saved_ = _saved(w)
    w.clock.advance(8 * DAY)
    assert w.themes.due() == [preview.theme.id]
    script_search(w, {"agentes de IA": [hit(1, 1), hit(600, 4), hit(601, 4)]})
    w.llm.script(CURATE, keep_all())
    out = w.themes.refresh(preview.theme.id)
    assert len(w.searcher.batches) == 2
    last = w.llm.calls_for(CURATE)[-1]
    assert [it["video_id"] for it in last["items"]] == [vid(600), vid(601)], "only the new ones"
    kept = {i.video_id for i in out.items}
    assert {vid(600), vid(601)} <= kept and {i.video_id for i in preview.items} <= kept
    assert out.theme.last_search_at == w.clock.now()
    assert w.themes.due() == []


def test_refresh_explicit_search_without_model_is_llm_unavailable(rw: Any) -> None:
    w = rw
    preview, _ = _saved(w)
    w.llm.set_available(False)
    with pytest.raises(T.LLMUnavailable):
        w.themes.refresh(preview.theme.id, search=True)
    out = w.themes.refresh(preview.theme.id)  # automatic, not due: RSS only
    assert out.theme.status is T.ThemeStatus.saved
    with pytest.raises(T.NotFound):
        w.themes.refresh("th_nope")


def test_dislike_is_a_negative_example_in_the_next_curation(rw: Any) -> None:
    w = rw
    preview, saved = _saved(w)
    disliked = preview.items[0].video_id
    title = preview.videos[disliked].title
    w.video_state.set_reaction(disliked, T.Reaction.down)
    w.video_state.set_reaction(preview.items[1].video_id, T.Reaction.up)

    script_search(w, {"agentes de IA": [hit(700, 5)]})
    w.llm.script(CURATE, keep_all())
    out = w.themes.refresh(preview.theme.id, search=True)
    payload = w.llm.calls_for(CURATE)[-1]
    assert title in payload["disliked_titles"]
    assert preview.videos[preview.items[1].video_id].title in payload["liked_titles"]
    assert disliked not in {i.video_id for i in out.items}, "👎 leaves the tab"
    (row,) = rows(w.db, "SELECT verdict FROM theme_items WHERE video_id = ?", (disliked,))
    assert row["verdict"] == "user_down"
    assert disliked not in {it.video.id for it in w.feed.page(saved.tab.id, limit=50).items}

    # a new theme also gets the 👎 (in expansion and in curation)
    w.llm.script(EXPAND, expand_out())
    script_search(w, {"*": [hit(800, 6)]})
    w.llm.script(CURATE, keep_all())
    w.themes.create("outro tema")
    assert title in w.llm.calls_for(EXPAND)[-1]["disliked_titles"]
    assert title in w.llm.calls_for(CURATE)[-1]["disliked_titles"]


def test_disliked_candidate_is_never_sent_back_to_the_model(rw: Any) -> None:
    w = rw
    w.video_store.upsert([hit(1, 1).to_video_in()], T.VideoOrigin.search)
    w.video_state.set_reaction(vid(1), T.Reaction.down)
    w.llm.script(EXPAND, expand_out())
    script_search(w, {"*": [hit(1, 1), hit(2, 1)]})
    w.llm.script(CURATE, keep_all())
    preview = w.themes.create("agentes")
    (payload,) = w.llm.calls_for(CURATE)
    assert [it["video_id"] for it in payload["items"]] == [vid(2)]
    assert [i.video_id for i in preview.items] == [vid(2)]


def test_abandoned_previews_expire(rw: Any) -> None:
    w = rw
    standard(w)
    old = w.themes.create("agentes de IA")
    standard(w)
    kept = w.themes.create("agentes de IA")
    w.themes.save(kept.theme.id)
    w.clock.advance(TH.PREVIEW_TTL_S + 1)
    w.llm.script(EXPAND, expand_out(NO_RESULTS))
    w.themes.create("novo")
    ids = {t.id for t in w.themes.list()}
    assert old.theme.id not in ids and kept.theme.id in ids
    assert rows(w.db, "SELECT * FROM theme_items WHERE theme_id = ?", (old.theme.id,)) == []
    assert w.themes.expire() == 0, "idempotent"


def test_import_rows_restores_exported_themes(rw: Any) -> None:
    w = rw
    standard(w)
    preview = w.themes.create("agentes de IA")
    exported = []
    for r in rows(w.db, "SELECT * FROM themes"):
        r = dict(r)
        for col in ("searches", "seeds", "include_terms", "exclude_terms"):
            r[col] = json.loads(r[col])
        r["items"] = rows(w.db, "SELECT * FROM theme_items WHERE theme_id = ?", (r["id"],))
        for it in r["items"]:
            it.pop("theme_id")
        exported.append(r)
    exported[0]["tab_id"] = "tab_que_nao_existe"
    exported[0]["status"] = "saved"
    w.db.execute("DELETE FROM themes")
    assert w.themes.import_rows(exported) == 1
    assert w.themes.import_rows(exported) == 0, "idempotent"
    back = w.themes.preview(preview.theme.id)
    assert [i.video_id for i in back.items] == [i.video_id for i in preview.items]
    assert back.theme.tab_id is None and back.theme.status is T.ThemeStatus.preview
    assert w.themes.import_rows([{"id": 3}, "x", {"id": "t", "query": ""}]) == 0


def test_two_creates_at_the_same_time_make_two_themes(rw: Any) -> None:
    w = rw
    w.llm = FakeLLM(auto=True)
    w.themes = rebuild_themes(w)
    script_search(w, {"*": [hit(1, 1), hit(2, 2)]})
    errors: list[BaseException] = []
    results: list[T.ThemePreview] = []

    def run(q: str) -> None:
        try:
            results.append(w.themes.create(q))
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(f"tema {i}",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert errors == []
    assert len({p.theme.id for p in results}) == 2
    assert all(p.video_count == 2 for p in results)


# =========================================================================== 7. RPC and REST


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
            current=_op("getThemes").doc,
            strict=True,
        )
        assert env["error"]["code"] in set(op.errors) | {"internal"}, env
    assert env["ok"] is ok, env
    return env.get("data") if ok else env["error"]


def _check_job_result(operation_id: str, result: Any) -> None:
    op = _op(operation_id)
    gen_types.validate_instance(op.raw["job_result"], result, ROOT, current=op.doc, strict=True)


def _rpc(fn: Any, params: Any, session_id: str | None = None) -> Any:
    return _common.call_rpc(fn, params, session_id=session_id)


@pytest.fixture
def wired(rw: Any, wire: Any) -> tuple[Any, FakeJobRunner]:
    runner = FakeJobRunner(defer=True, events=rw.events, clock=rw.clock)
    wire.set_many(themes=rw.themes, llm=rw.llm, jobs=runner, changelog=rw.changelog)
    return rw, runner


def test_rpc_create_is_a_job_with_progress_events_and_contract_result(wired: Any) -> None:
    w, runner = wired
    standard(w)
    t0 = time.monotonic()
    env = _rpc(rpc_themes.theme_create, {"query": "agentes de IA"})
    assert time.monotonic() - t0 < 1.0
    job = _check("theme.create", env)["job"]
    assert job["kind"] == "theme" and job["status"] == "queued"
    assert w.themes.list() == [], "nothing runs before the job"

    busy = _check("theme.create", _rpc(rpc_themes.theme_create, {"query": "outro"}), ok=False)
    assert busy["code"] == "busy", "one theme at a time"

    assert runner.run_pending() == 1
    done = runner.get(job["id"])
    assert done.status is T.JobStatus.done, done
    _check_job_result("theme.create", done.result)
    assert done.result["theme"]["status"] == "preview"
    progress = [p for name, p in w.events.events if name == "theme.progress"]
    assert progress and all(set(p) == {"job", "progress"} for p in progress)
    stages = list(dict.fromkeys(p["progress"]["stage"] for p in progress))
    assert stages == STAGES
    assert ("theme.ready", {"job": job["id"], "status": "done"}) in w.events.events


def test_rpc_create_params_no_model_and_session(wired: Any) -> None:
    w, runner = wired
    for bad in ({}, {"query": ""}, {"query": "x"}, {"query": 3}, {"query": "a" * 201}):
        err = _check("theme.create", _rpc(rpc_themes.theme_create, bad), ok=False)
        assert err["code"] == "invalid", bad
    assert _rpc(rpc_themes.theme_create, ["x"])["error"]["code"] == "invalid"
    w.llm.set_available(False)
    err = _check("theme.create", _rpc(rpc_themes.theme_create, {"query": "agentes"}), ok=False)
    assert err["code"] == "llm_unavailable" and "no ai model" in err["message"].lower()
    assert runner.jobs == {}, "no model: no job"
    w.llm.set_available(True)
    standard(w)
    job = _check(
        "theme.create",
        _rpc(rpc_themes.theme_create, {"query": "agentes de IA"}, session_id="sess-9"),
    )["job"]
    runner.run_pending()
    assert ("sess-9", "theme.ready", {"job": job["id"], "status": "done"}) in (
        w.events.session_events
    )


def test_rpc_create_with_real_job_runner_answers_fast_and_rejects_concurrent(
    rw: Any, wire: Any
) -> None:
    w = rw
    events = FakeEventSink()
    runner = core_jobs.build(db=w.db, settings=FakeSettings(), events=events)
    started, release = threading.Event(), threading.Event()

    def slow(payload: dict[str, Any]) -> dict[str, Any]:
        started.set()
        assert release.wait(10)
        return expand_out()

    w.llm.script(EXPAND, slow)
    script_search(w, {"*": [hit(1, 1)]})
    w.llm.script(CURATE, keep_all())
    wire.set_many(themes=w.themes, llm=w.llm, jobs=runner)
    try:
        t0 = time.monotonic()
        env = _rpc(rpc_themes.theme_create, {"query": "agentes de IA"})
        assert time.monotonic() - t0 < 1.0, "answers in < 1 s"
        job = _check("theme.create", env)["job"]
        assert started.wait(5)
        busy = _rpc(rpc_themes.theme_create, {"query": "outro"})
        assert busy["error"]["code"] == "busy"
        assert _rpc(rpc_themes.theme_refresh, {"theme_id": "x"})["error"]["code"] in (
            "busy",
            "not_found",
        )
    finally:
        release.set()
    deadline = time.monotonic() + 10
    cur = None
    while time.monotonic() < deadline:
        cur = runner.get(job["id"])
        if cur is not None and cur.status in (T.JobStatus.done, T.JobStatus.error):
            break
        time.sleep(0.05)
    assert cur is not None and cur.status is T.JobStatus.done, cur
    _check_job_result("theme.create", cur.result)
    names = [n for n, _ in events.events]
    assert "theme.progress" in names and "theme.ready" in names


def test_rpc_save_and_refresh(wired: Any) -> None:
    w, runner = wired
    standard(w)
    preview = w.themes.create("agentes de IA")
    tid = preview.theme.id
    for bad in (
        {},
        {"theme_id": 3},
        {"theme_id": tid, "edits": "x"},
        {"theme_id": tid, "edits": {"nope": 1}},
        {"theme_id": tid, "edits": {"create_folder": "sim"}},
        {"theme_id": tid, "edits": {"seed_actions": {cid(1): "adore"}}},
        {"theme_id": tid, "edits": {"seed_actions": {cid(77): "follow"}}},
        {"theme_id": tid, "edits": {"removed_video_ids": "x"}},
        {"theme_id": tid, "edits": {"name": 3}},
    ):
        err = _check("theme.save", _rpc(rpc_themes.theme_save, bad), ok=False)
        assert err["code"] == "invalid", (bad, err)
    nf = _check("theme.save", _rpc(rpc_themes.theme_save, {"theme_id": "th_x"}), ok=False)
    assert nf["code"] == "not_found"
    data = _check(
        "theme.save",
        _rpc(
            rpc_themes.theme_save,
            {
                "theme_id": tid,
                "edits": {
                    "name": "Agentes",
                    "create_folder": True,
                    "seed_actions": {cid(1): "subscribe"},
                    "removed_video_ids": [vid(8)],
                },
            },
        ),
    )
    assert data["followed"] == [cid(1)] and data["to_subscribe"] == [cid(1)]
    assert data["tab"]["kind"] == "theme" and data["change_id"]
    again = _check("theme.save", _rpc(rpc_themes.theme_save, {"theme_id": tid}), ok=False)
    assert again["code"] == "conflict"

    for bad in ({}, {"theme_id": ""}, {"theme_id": 1}):
        err = _check("theme.refresh", _rpc(rpc_themes.theme_refresh, bad), ok=False)
        assert err["code"] == "not_found", bad  # the contract does not declare ``invalid`` here
    nf = _check("theme.refresh", _rpc(rpc_themes.theme_refresh, {"theme_id": "th_x"}), ok=False)
    assert nf["code"] == "not_found"
    script_search(w, {"agentes de IA": [hit(900, 7)]})
    w.llm.script(CURATE, keep_all())
    job = _check("theme.refresh", _rpc(rpc_themes.theme_refresh, {"theme_id": tid}))["job"]
    runner.run_pending()
    done = runner.get(job["id"])
    assert done.status is T.JobStatus.done, done
    _check_job_result("theme.refresh", done.result)
    assert len(w.searcher.batches) == 2, "theme.refresh = new search"
    w.llm.set_available(False)
    err = _check("theme.refresh", _rpc(rpc_themes.theme_refresh, {"theme_id": tid}), ok=False)
    assert err["code"] == "llm_unavailable"


def test_rest_get_themes_and_theme(wired: Any) -> None:
    w, _ = wired
    standard(w)
    first = w.themes.create("agentes de IA")
    w.clock.advance(10)
    w.llm.script(EXPAND, expand_out(NO_RESULTS))
    second = w.themes.create("vazio")
    data = _check("getThemes", api_themes.get_themes(None, {}))
    assert [t["id"] for t in data["items"]] == [second.theme.id, first.theme.id]
    data = _check("getTheme", api_themes.get_theme(None, {"id": first.theme.id}))
    assert data == T.to_jsonable(first)
    err = _check("getTheme", api_themes.get_theme(None, {"id": "th_nope"}), ok=False)
    assert err["code"] == "not_found"


# =========================================================================== 8. conformance


def test_fake_suite_runs_against_the_real_themes(real: None) -> None:
    """The ``test_fakes`` theme tests (pipeline and save/undo) with the real services."""
    test_fakes.test_themes_pipeline_with_fake_llm_and_searcher()
    test_fakes.test_theme_save_is_one_undoable_group()


def _scenario(w: Any) -> dict[str, Any]:
    w.searcher = FakeSearcher(clock=w.clock)
    w.themes.searcher = w.searcher
    standard(w)
    stages: list[str] = []
    preview = w.themes.create("agentes de IA", on_progress=lambda p: stages.append(p.stage))
    out: dict[str, Any] = {
        "stages": [s for s in dict.fromkeys(stages) if s in STAGES],
        "search_many": len(w.searcher.batches),
        "requests": len(w.searcher.batches[0]),
        "status": preview.theme.status.value,
        "items": [i.video_id for i in preview.items],
        "seeds": [(s.channel_id, s.kept_videos) for s in preview.seeds],
        "channel_count": preview.channel_count,
        "channels_before_save": rows(w.db, "SELECT id FROM channels"),
    }
    saved = w.themes.save(
        preview.theme.id,
        T.ThemeSaveEdits(
            create_folder=True, folder_name="Agentes", seed_actions={cid(1): T.SeedAction.subscribe}
        ),
    )
    out["tab_kind"] = saved.tab.kind.value
    out["tab_themes"] = list(saved.tab.rules.include.themes) == [preview.theme.id]
    out["followed"] = list(saved.followed)
    out["to_subscribe"] = list(saved.to_subscribe)
    out["relation"] = w.channels.get(cid(1)).relation.value
    out["feed"] = sorted(it.video.id for it in w.feed.page(saved.tab.id, limit=50).items)
    out["status_saved"] = w.themes.get(preview.theme.id).status.value
    w.changelog.undo(saved.change_id, targets=w.targets())
    out["after_undo"] = (
        w.tabs.get(saved.tab.id),
        w.taxonomy.get_folder(saved.folder_id),
        w.channels.get(cid(1)),
        w.themes.get(preview.theme.id).status.value,
    )
    return out


def _fake_only_world(clock: FakeClock) -> Any:
    mp = pytest.MonkeyPatch()
    try:
        _patch(mp, FAKE_FACTORIES)
        return build_fake_world(MemDb(), clock=clock, llm=FakeLLM())
    finally:
        mp.undo()


def test_conformance_fake_vs_real(rw: Any) -> None:
    fake = _fake_only_world(FakeClock())
    assert isinstance(fake.themes, FakeThemes) and isinstance(fake.feed, FakeFeedEngine)
    got_fake = _scenario(fake)
    got_real = _scenario(rw)
    assert got_real == got_fake


# =========================================================================== 9. live

HERMES_SRC = Path(os.environ.get("HERMES_SRC") or Path.home() / ".hermes" / "hermes-agent")

_LIVE = r"""
import importlib.util, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location("_tube_boot_live", sys.argv[1])
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)
boot.ensure()
from agent.plugin_llm import PluginLlm
from tube_pkg._id import PLUGIN_ID
from tube_pkg.adapters import hermes_llm
from tube_pkg.core import ai, changes, channels, db as core_db, feed, http, refresh, tabs
from tube_pkg.core import taxonomy, themes, video_state, youtube
from tube_pkg.core import types as T

class Settings:
    def get(self, key, default=None):
        return {"language": "pt-BR"}.get(key, T.SETTINGS_DEFAULTS.get(key, default))

class HostSearcher:
    # host search (YouTubeClient.search), 4 in parallel; one call = one batch
    def __init__(self, yt):
        self.yt, self.batches = yt, 0
    def search_many(self, requests, timeout=15.0):
        self.batches += 1
        def one(req):
            try:
                hits = tuple(self.yt.search(req.query, req.order))
                return T.SearchOutcome(request=req, hits=hits, via=T.SearchVia.host)
            except T.TubeError as exc:
                return T.SearchOutcome(request=req, error=exc.message)
        with ThreadPoolExecutor(4) as pool:
            return list(pool.map(one, requests))

s = Settings()
ctx = SimpleNamespace(llm=PluginLlm(plugin_id=PLUGIN_ID))
llm = ai.build(settings=s, llm_backend=hermes_llm.HermesLLMBackend(ctx, task=None))
if not llm.available():
    print("SKIP no model"); sys.exit(0)
db = core_db.build(path=str(Path(tempfile.mkdtemp()) / "live.db"))
yt = youtube.build(http=http.build(settings=s), settings=s)
log = changes.build(db=db, settings=s)
chs = channels.build(db=db, settings=s, youtube=yt, changelog=log)
tax = taxonomy.build(db=db, settings=s, channels=chs, changelog=log)
tb = tabs.build(db=db, settings=s, changelog=log)
vs = video_state.build(db=db, settings=s, changelog=log)
store = refresh.build_video_store(db=db, settings=s)
searcher = HostSearcher(yt)
th = themes.build(db=db, settings=s, llm=llm, searcher=searcher, lenses=[], tabs=tb,
                  taxonomy=tax, channels=chs, video_state=vs, video_store=store, changelog=log)
marks = []
def progress(p):
    marks.append((time.monotonic(), p.stage, p.done, p.total, p.message))
t0 = time.monotonic()
pv = th.create("agentes de IA", timeout=90, on_progress=progress)
took = time.monotonic() - t0
first = {}
for ts, stage, *_ in marks:
    first.setdefault(stage, ts)
order = list(first)
spans = []
for i, stage in enumerate(order):
    end = first[order[i + 1]] if i + 1 < len(order) else t0 + took
    spans.append(f"{stage}={end - first[stage]:.1f}s")
print("LIVE", f"{took:.1f}s", "videos", pv.video_count, "channels", pv.channel_count,
      "seeds", len(pv.seeds), "searches", len(pv.theme.searches), "batches", searcher.batches)
print("STAGES", " ".join(spans))
print("THEME", pv.theme.name, pv.theme.icon, "| note:", pv.theme.error)
print("SEARCHES", " | ".join(pv.theme.searches))
for item in pv.items[:5]:
    v = pv.videos[item.video_id]
    print("TOP", f"{item.score:.2f}", v.title, "—", v.channel_title, "|", item.reason)
assert searcher.batches == 1
assert pv.theme.status is T.ThemeStatus.preview
assert took < 90
fd = feed.build(db=db, settings=s, youtube=yt, video_store=store, lenses=[], tabs=tb,
                taxonomy=tax, channels=chs, video_state=vs)
saved = th.save(pv.theme.id)
page = fd.page(saved.tab.id, limit=50)
print("TAB", saved.tab.name, saved.tab.rules.mode.value, "feed items:", len(page.items))
"""


@pytest.mark.live
def test_live_agents_theme_end_to_end(tmp_path: Path) -> None:
    """ "agentes de IA" end to end: real model (``PluginLlm`` = ``ctx.llm``) and host search
    (the real ``YouTubeClient.search``), on the Hermes-managed Python."""
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
        [python, str(script), str(ROOT / "plugin" / "_bootstrap.py")],
        cwd=HERMES_SRC,
        capture_output=True,
        text=True,
        timeout=300,
        env=env,
    )
    print(out.stdout[-6000:])
    if out.stdout.startswith("SKIP"):
        pytest.skip(out.stdout.strip())
    assert out.returncode == 0, out.stderr[-3000:]
    assert "LIVE" in out.stdout
