"""What the AI dialogs (organize, theme) asked of the backend.

1. ``job.cancel`` — cooperative cancellation: ``JobRunner`` marks and closes the job as
   ``error`` + ``error.code = cancelled`` right away (frees the \"one at a time\"); organize checks
   between batches (finished batches stay, nothing is applied); theme checks between steps and
   between searches; idempotent.
2. ``GET /ai/status`` — ``{available, model, reason}`` from the configuration only (the test fails
   if a socket is opened).
3. ``theme.create`` with structured ``language``/``classics`` (they reach the search plan).
4. Theme progress with ``step`` ``{name, done, total}`` at each stage.
5. ``organize.accept`` returns ``change_ids`` (undoes exactly the accept).

Against the real ones (real database, real services) and against the fake (``tests/fakes``);
envelopes validated **strictly** against ``contract/*.yaml``.
"""

from __future__ import annotations

import importlib.util
import socket
import sys
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import fakes.world as fake_world_module
import pytest
import test_organize as TO
import test_themes as TT
from fakes import (
    FakeChangeLog,
    FakeChannelService,
    FakeClock,
    FakeEventSink,
    FakeJobRunner,
    FakeLens,
    FakeLLM,
    FakeOrganizer,
    FakeSearcher,
    FakeSettings,
    FakeTaxonomyService,
    MemDb,
    build_fake_world,
)

from tube_pkg import wiring
from tube_pkg.adapters import hermes_llm
from tube_pkg.api import _common
from tube_pkg.api import ai as api_ai
from tube_pkg.api import jobs as api_jobs
from tube_pkg.core import ai as core_ai
from tube_pkg.core import db as core_db
from tube_pkg.core import jobs as core_jobs
from tube_pkg.core import organize as OG
from tube_pkg.core import themes as TH
from tube_pkg.core import types as T
from tube_pkg.rpc import jobs as rpc_jobs
from tube_pkg.rpc import organize as rpc_org
from tube_pkg.rpc import themes as rpc_themes

ROOT = Path(__file__).resolve().parents[1]
ORGANIZE = T.AiTask.organize
EXPAND = T.AiTask.theme_expand
CURATE = T.AiTask.theme_curate


def _load_by_path(name: str, path: Path) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_b11", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)


# =========================================================================== utilities


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
            current=_op("getJob").doc,
            strict=True,
        )
        assert env["error"]["code"] in set(op.errors) | {"internal"}, env
    assert env["ok"] is ok, env
    return env.get("data") if ok else env["error"]


def _validate(ref: str, instance: Any) -> None:
    gen_types.validate_instance({"$ref": ref}, instance, ROOT, current=gen_types.RPC_DOC)


def _rpc(fn: Any, params: Any, session_id: str | None = None) -> Any:
    return _common.call_rpc(fn, params, session_id=session_id)


def _rest(fn: Any, query: Any = None) -> Any:
    return _common.call_rest(fn, None, query or {})


def wait_until(pred: Callable[[], Any], timeout: float = 10.0) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = pred()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError("timed out waiting for the condition")


def wait_job_end(runner: Any, job_id: str) -> T.Job:
    def ended() -> T.Job | None:
        job = runner.get(job_id)
        return job if job is not None and job.status not in _ACTIVE else None

    return wait_until(ended)


def wait_threads(prefix: str = "", timeout: float = 10.0) -> None:
    """Waits for the job threads to finish (a cancelled one only exits at the next checkpoint)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        alive = [t for t in threading.enumerate() if "-job_" in t.name and prefix in t.name]
        if not alive:
            return
        time.sleep(0.02)
    raise AssertionError("job thread did not finish")


_ACTIVE = (T.JobStatus.queued, T.JobStatus.running)


def P(stage: str, done: int = 0, total: int | None = None) -> T.Progress:
    return T.Progress(stage=stage, done=done, total=total)


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "b11.db"))
    yield db
    db.close()


def real_runner(db: Any, events: Any = None) -> Any:
    return core_jobs.build(db=db, settings=FakeSettings(), events=events or FakeEventSink())


# =========================================================================== 0. contract


def test_contract_is_additive_and_wired() -> None:
    methods = CONTRACT.rpc["methods"]
    cancel = methods["job.cancel"]
    assert cancel["x-module"] == "plugin/rpc/jobs.py" and cancel["kind"] == "direct"
    assert cancel["fallback"] == {"message": "open_desktop_backend"}
    op = _op("getAiStatus")
    assert (op.method, op.path, op.module) == ("GET", "/ai/status", "plugin/api/ai.py")
    params = CONTRACT.rpc["components"]["schemas"]["ThemeCreateParams"]
    assert params["required"] == ["query"], "language/classics opcionais"
    assert set(params["properties"]) == {"query", "language", "classics"}
    domain = CONTRACT.domain["$defs"]
    assert domain["JobStatus"]["enum"] == ["queued", "running", "done", "error"], "no new value"
    assert T.JOB_CANCELLED_CODE == "cancelled"
    assert "step" not in domain["Progress"]["required"], "new optional field (old client)"
    assert "change_ids" not in domain["AcceptReport"]["required"]
    assert "step" in domain["Progress"]["properties"]
    assert set(domain["ProgressStep"]["properties"]) == {"name", "done", "total"}
    assert set(domain["ThemeStep"]["enum"]) >= {"expand", "search", "curate", "preview"}
    assert "change_ids" in domain["AcceptReport"]["properties"]
    assert set(domain["AiStatus"]["properties"]) == {"available", "model", "reason", "provider"}
    assert "provider" not in domain["AiStatus"]["required"], "new optional field (old client)"
    rpc = {m.name: (m.module, m.handler) for m in wiring.RPC_METHODS}
    assert rpc["job.cancel"] == ("tube_pkg.rpc.jobs", "job_cancel")
    rest = {(r.method, r.path): (r.module, r.handler) for r in wiring.REST_ROUTES}
    assert rest[("GET", "/ai/status")] == ("tube_pkg.api.ai", "get_ai_status")
    assert getattr(rpc_jobs.job_cancel, "__contract_real__", False)
    assert getattr(api_ai.get_ai_status, "__contract_real__", False)
    assert isinstance(FakeJobRunner(), T.JobRunner)


def test_old_payloads_still_validate() -> None:
    """Old client/server: the previous formats stay valid (new fields are additive on input;
    on output the server always sends the new ones)."""
    _validate("#/components/schemas/ThemeCreateParams", {"query": "agentes de IA"})
    job = T.Job(
        id="job_1",
        kind=T.JobKind.theme,
        status=T.JobStatus.running,
        created_at=1,
        updated_at=2,
        progress=P("search", 6, 12),
    )
    _check("getJob", _common.ok(job))
    assert T.to_jsonable(T.AcceptReport())["change_ids"] == []


# =========================================================================== 1. JobRunner.cancel


class _RealHarness:
    """Runs the script in a real thread: ``pause()`` (inside the job) signals and waits for the
    test."""

    def __init__(self, db: Any) -> None:
        self.events = FakeEventSink()
        self.runner = real_runner(db, self.events)
        self.started = threading.Event()
        self.gate = threading.Event()

    def pause(self, job_id: Callable[[], str]) -> None:
        self.started.set()
        assert self.gate.wait(10)

    def drive(self, job: T.Job) -> None:
        assert self.started.wait(10)
        self.cancelled = self.runner.cancel(job.id)
        self.gate.set()
        wait_threads(job.id)


class _FakeHarness:
    """Synchronous fake: ``pause()`` cancels from inside the job (like a click midway)."""

    def __init__(self, db: Any) -> None:
        self.events = FakeEventSink()
        self.runner = FakeJobRunner(events=self.events, defer=True)

    def pause(self, job_id: Callable[[], str]) -> None:
        self.cancelled = self.runner.cancel(job_id())

    def drive(self, job: T.Job) -> None:
        self.runner.run_pending()


@pytest.fixture(params=["real", "fake"])
def harness(request: pytest.FixtureRequest, rdb: Any) -> Any:
    return _RealHarness(rdb) if request.param == "real" else _FakeHarness(rdb)


def test_cancel_running_job_closes_now_stops_at_next_checkpoint_and_announces_once(
    harness: Any,
) -> None:
    h = harness
    seen: dict[str, Any] = {}
    box: dict[str, str] = {}

    def fn(progress: T.ProgressFn) -> Any:
        progress(P("work", 0, 2))
        seen["before"] = T.is_cancelled(progress)
        h.pause(lambda: box["id"])
        seen["flag"] = T.is_cancelled(progress)
        progress(P("work", 1, 2))  # checkpoint: raises Cancelled
        seen["after"] = True
        return {"x": 1}

    job = h.runner.submit(T.JobKind.organize, fn, event="organize.done")
    box["id"] = job.id
    h.drive(job)

    assert seen["before"] is False and seen["flag"] is True
    assert "after" not in seen, "stopped at the checkpoint"
    assert h.cancelled is not None and T.is_job_cancelled(h.cancelled)
    final = h.runner.get(job.id)
    assert T.is_job_cancelled(final)
    assert final.result is None
    assert final.error is not None and final.error["code"] == "cancelled"
    assert final.progress is not None and final.progress.done == 0, "earlier progress stays"
    assert job.id not in {j.id for j in h.runner.list_active()}
    ends = [p for name, p in h.events.events if name == "organize.done"]
    assert ends == [{"job": job.id, "status": "error"}], "end announced only once"
    _check("getJob", _common.ok(final))


def test_cancel_is_idempotent_for_finished_unknown_and_repeated(harness: Any) -> None:
    h = harness
    assert h.runner.cancel("job_404_deadbeef") is None
    job = h.runner.submit(T.JobKind.theme, lambda progress: {"ok": True})
    if isinstance(h, _FakeHarness):
        h.runner.run_pending()
    done = wait_job_end(h.runner, job.id)
    assert done.status is T.JobStatus.done
    again = h.runner.cancel(job.id)
    assert again is not None and again.status is T.JobStatus.done and again.result == {"ok": True}


def test_fake_cancel_queued_job_never_runs() -> None:
    runner = FakeJobRunner(defer=True)
    ran: list[int] = []
    job = runner.submit(T.JobKind.theme, lambda p: ran.append(1))
    assert T.is_job_cancelled(runner.cancel(job.id))
    assert T.is_job_cancelled(runner.cancel(job.id))
    runner.run_pending()
    assert ran == [] and T.is_job_cancelled(runner.get(job.id))


def test_real_cancel_from_another_runner_on_the_same_database(tmp_path: Path) -> None:
    """Whoever cancels can be another instance (another graph/process): the mark lives in the
    database."""
    path = str(tmp_path / "shared.db")
    db_a, db_b = core_db.build(path=path), core_db.build(path=path)
    try:
        a, b = real_runner(db_a), real_runner(db_b)
        started, gate = threading.Event(), threading.Event()
        reached: list[str] = []

        def fn(progress: T.ProgressFn) -> Any:
            started.set()
            assert gate.wait(10)
            T.check_cancelled(progress)
            reached.append("fim")
            return 1

        job = a.submit(T.JobKind.organize, fn)
        assert started.wait(10)
        assert T.is_job_cancelled(b.cancel(job.id))
        assert T.is_job_cancelled(a.get(job.id))
        gate.set()
        wait_threads(job.id)
        assert reached == [] and T.is_job_cancelled(a.get(job.id))
    finally:
        db_a.close()
        db_b.close()


def test_real_cancelled_job_is_purged_like_any_finished_job(rdb: Any) -> None:
    clock = FakeClock()
    runner = core_jobs.build(db=rdb, settings=FakeSettings(), events=FakeEventSink(), clock=clock)
    gate = threading.Event()
    job = runner.submit(T.JobKind.theme, lambda p: (gate.wait(10), T.check_cancelled(p)))
    runner.cancel(job.id)
    gate.set()
    wait_threads(job.id)
    clock.advance(10)
    assert runner.purge(older_than=clock.now()) == 1
    assert runner.get(job.id) is None


# =========================================================================== 2. RPC job.cancel


def test_rpc_job_cancel_contract_and_idempotence(wire: Any) -> None:
    runner = FakeJobRunner(defer=True)
    wire.set_many(jobs=runner)
    ran: list[int] = []
    job = runner.submit(T.JobKind.theme, lambda p: ran.append(1))

    data = _check("job.cancel", _rpc(rpc_jobs.job_cancel, {"job_id": job.id}))
    assert data["cancelled"] is True and data["job"]["status"] == "error"
    assert data["job"]["error"]["code"] == "cancelled"
    data = _check("job.cancel", _rpc(rpc_jobs.job_cancel, {"job_id": job.id}))
    assert data["cancelled"] is False and data["job"]["error"]["code"] == "cancelled", "idempotente"
    data = _check("job.cancel", _rpc(rpc_jobs.job_cancel, {"job_id": "job_1_ffff"}))
    assert data == {"job": None, "cancelled": False}, "unknown: no error"
    runner.run_pending()
    assert ran == [], "cancelled before starting does not run"

    done = runner.submit(T.JobKind.theme, lambda p: {"ok": 1})
    runner.run_pending()
    data = _check("job.cancel", _rpc(rpc_jobs.job_cancel, {"job_id": done.id}))
    assert data["cancelled"] is False and data["job"]["status"] == "done"

    for bad in ({}, {"job_id": ""}, {"job_id": 3}, ["x"]):
        err = _check("job.cancel", _rpc(rpc_jobs.job_cancel, bad), ok=False)
        assert err["code"] == "invalid", bad


# =========================================================================== 3. organize


@pytest.fixture
def org_world(monkeypatch: pytest.MonkeyPatch, rdb: Any) -> Any:
    TO._real_factories(monkeypatch)
    world = build_fake_world(rdb, clock=FakeClock(), llm=FakeLLM(model="modelo-teste"))
    world.organizer = OG.Organizer(
        db=world.db,
        settings=FakeSettings(),
        llm=world.llm,
        channels=world.channels,
        taxonomy=world.taxonomy,
        changelog=world.changelog,
        clock=world.clock,
        batch_size=2,
    )
    return world


def _org_snapshot(w: Any) -> dict[str, Any]:
    return {**TO.snapshot(w.db), "changes": TO.n_changes(w.db)}


def test_cancel_organize_mid_run_keeps_ready_batches_applies_nothing_and_frees_the_lock(
    org_world: Any, wire: Any
) -> None:
    w = org_world
    chans = TO.subscribe(w, 1, 2, 3, 4, 5)  # batches of 2: [1,2] [3,4] [5]
    events = FakeEventSink()
    runner = real_runner(w.db, events)
    wire.set_many(organizer=w.organizer, llm=w.llm, jobs=runner, changelog=w.changelog)
    started, gate = threading.Event(), threading.Event()
    tech = TO.same("Tecnologia", new=True)

    def blocking(payload: dict[str, Any]) -> dict[str, Any]:
        started.set()
        assert gate.wait(10)
        return tech(payload)

    # 1st round: batch 1 done, batch 2 stuck (cancelled midway), batch 3 never called;
    # 2nd round (requested right after the cancellation): 3 batches
    w.llm.script(ORGANIZE, tech, blocking, tech, tech, tech)
    before = _org_snapshot(w)

    job = _check("organize.run", _rpc(rpc_org.organize_run, {}))["job"]
    assert started.wait(10)
    t0 = time.monotonic()
    data = _check("job.cancel", _rpc(rpc_jobs.job_cancel, {"job_id": job["id"]}))
    assert data["cancelled"] is True and data["job"]["error"]["code"] == "cancelled"
    seen = _check("getJob", _rest(api_jobs.get_job, {"id": job["id"]}))
    assert seen["status"] == "error" and seen["error"]["code"] == "cancelled", seen
    assert time.monotonic() - t0 < 1.0, "right away"

    again = _rpc(rpc_org.organize_run, {})
    assert again["ok"], f"a cancelled job frees the 'one at a time': {again}"
    second = again["data"]["job"]["id"]

    gate.set()
    first = wait_job_end(runner, job["id"])
    assert T.is_job_cancelled(first) and first.result is None
    done = wait_job_end(runner, second)
    assert done.status is T.JobStatus.done, done
    wait_threads()

    calls = w.llm.calls_for(ORGANIZE)
    assert [len(c["items"]) for c in calls[:2]] == [2, 2], "1st round: batch 3 was never requested"
    assert len(calls) == 5
    after = _org_snapshot(w)
    assert after == before, "nothing applied (channels, folders, tags, history)"
    assert all(w.channels.get(c).folder_id is None for c in chans)
    assert sorted(s.channel_id for s in w.organizer.pending()) == sorted(chans)
    ends = [p for name, p in events.events if name == "organize.done"]
    assert ends.count({"job": job["id"], "status": "error"}) == 1


def test_cancel_organize_keeps_suggestions_of_finished_batches(org_world: Any) -> None:
    w = org_world
    TO.subscribe(w, 1, 2, 3, 4, 5)
    runner = real_runner(w.db)
    started, gate = threading.Event(), threading.Event()
    tech = TO.same("Tecnologia", new=True)

    def blocking(payload: dict[str, Any]) -> dict[str, Any]:
        started.set()
        assert gate.wait(10)
        return tech(payload)

    w.llm.script(ORGANIZE, tech, blocking)
    job = runner.submit(
        T.JobKind.organize,
        lambda progress: w.organizer.organize(None, timeout=60, on_progress=progress),
    )
    assert started.wait(10)
    runner.cancel(job.id)
    gate.set()
    wait_threads(job.id)
    pending = w.organizer.pending()
    assert sorted(s.channel_id for s in pending) == [TO.cid(1), TO.cid(2)], (
        "batch 1 (done before) stays; batch 2 (returned after the cancellation) is not written"
    )
    assert len(w.llm.calls_for(ORGANIZE)) == 2


def test_fake_organize_cancel_saves_nothing_after_the_click(wire: Any) -> None:
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(fake_world_module, "FakeChangeLog", FakeChangeLog)
        mp.setattr(fake_world_module, "FakeChannelService", FakeChannelService)
        mp.setattr(fake_world_module, "FakeTaxonomyService", FakeTaxonomyService)
        mp.setattr(fake_world_module, "FakeOrganizer", FakeOrganizer)
        w = build_fake_world(MemDb(), llm=FakeLLM(model="m"))
    finally:
        mp.undo()
    assert isinstance(w.organizer, FakeOrganizer)
    TO.subscribe(w, 1, 2)
    runner = FakeJobRunner(defer=True, events=w.events)
    wire.set_many(organizer=w.organizer, llm=w.llm, jobs=runner)
    box: dict[str, str] = {}
    tech = TO.same("Tecnologia", new=True)

    def click_cancel(payload: dict[str, Any]) -> dict[str, Any]:
        runner.cancel(box["id"])
        return tech(payload)

    w.llm.script(ORGANIZE, click_cancel)
    box["id"] = _check("organize.run", _rpc(rpc_org.organize_run, {}))["job"]["id"]
    runner.run_pending()
    assert T.is_job_cancelled(runner.get(box["id"]))
    assert w.organizer.pending() == [], "an answer that arrived after the click is discarded"
    assert _rpc(rpc_org.organize_run, {})["ok"], "no busy after cancelling"


# =========================================================================== 4. themes


@pytest.fixture
def theme_world(monkeypatch: pytest.MonkeyPatch, rdb: Any) -> Any:
    TT._patch(monkeypatch, TT.REAL_FACTORIES)
    lens = FakeLens(classics=[TT.hit(90, 9), TT.hit(91, 9)])
    world = build_fake_world(rdb, clock=FakeClock(), llm=FakeLLM(model="m"), lenses=[lens])
    world.searcher = FakeSearcher(clock=world.clock)
    world.themes = TT.rebuild_themes(world)
    assert isinstance(world.themes, TH.ThemeService)
    world.lens = lens
    return world


def _theme_rows(w: Any) -> list[dict[str, Any]]:
    return TT.rows(w.db, "SELECT id, query, status FROM themes ORDER BY created_at, id")


def test_cancel_theme_then_ask_another_right_away_without_busy(theme_world: Any, wire: Any) -> None:
    w = theme_world
    events = FakeEventSink()
    runner = real_runner(w.db, events)
    wire.set_many(themes=w.themes, llm=w.llm, jobs=runner)
    started, gate = threading.Event(), threading.Event()

    def blocking(payload: dict[str, Any]) -> dict[str, Any]:
        started.set()
        assert gate.wait(10)
        return TT.expand_out()

    w.llm.script(EXPAND, blocking, TT.expand_out())
    TT.script_search(w, {"*": [TT.hit(1, 1), TT.hit(2, 1)]})
    w.llm.script(CURATE, TT.keep_all())

    first = _check("theme.create", _rpc(rpc_themes.theme_create, {"query": "primeiro tema"}))
    assert started.wait(10)
    data = _check("job.cancel", _rpc(rpc_jobs.job_cancel, {"job_id": first["job"]["id"]}))
    assert data["cancelled"] is True

    env = _rpc(rpc_themes.theme_create, {"query": "segundo tema"})
    assert env["ok"], f"asking for another theme right after does not give busy: {env}"
    second = env["data"]["job"]["id"]
    done = wait_job_end(runner, second)
    assert done.status is T.JobStatus.done, done
    assert done.result["theme"]["query"] == "segundo tema"

    gate.set()
    wait_threads()
    assert T.is_job_cancelled(runner.get(first["job"]["id"]))
    assert [r["query"] for r in _theme_rows(w)] == ["segundo tema"], (
        "the cancelled theme neither becomes a preview nor hangs around"
    )
    assert len(w.searcher.batches) == 1, "the cancelled one stopped before searching"
    assert ("theme.ready", {"job": first["job"]["id"], "status": "error"}) in events.events


class _CancellingSearcher(FakeSearcher):
    """Cancels the job during the search (a click between searching and curating)."""

    def __init__(self, cancel: Callable[[], Any], **kw: Any) -> None:
        super().__init__(**kw)
        self.cancel = cancel

    def search_many(self, requests: Any, timeout: float = T.SEARCH_WINDOW_S) -> Any:
        out = super().search_many(requests, timeout)
        self.cancel()
        return out


def test_cancel_theme_between_search_and_curate_checks_between_searches(
    theme_world: Any, wire: Any
) -> None:
    w = theme_world
    runner = FakeJobRunner(defer=True)
    box: dict[str, str] = {}
    w.searcher = _CancellingSearcher(lambda: runner.cancel(box["id"]), clock=w.clock)
    w.themes = TT.rebuild_themes(w)
    wire.set_many(themes=w.themes, llm=w.llm, jobs=runner)
    w.llm.script(EXPAND, TT.expand_out(mode="classics"))
    TT.script_search(w, {"*": [TT.hit(1, 1)]})
    box["id"] = _check("theme.create", _rpc(rpc_themes.theme_create, {"query": "tema x"}))["job"][
        "id"
    ]
    runner.run_pending()
    assert T.is_job_cancelled(runner.get(box["id"]))
    assert w.llm.calls_for(CURATE) == [], "curation never started"
    assert not [c for c in w.lens.calls if c[0] == "classics"], "checked before the classics"
    assert _theme_rows(w) == []


def test_theme_refresh_cancel_keeps_the_saved_theme(theme_world: Any) -> None:
    w = theme_world
    TT.standard(w)
    preview = w.themes.create("agentes de IA", timeout=60)
    saved = w.themes.save(preview.theme.id, None, actor=T.Actor.user)
    before = TT.rows(w.db, "SELECT * FROM themes")
    runner = FakeJobRunner(defer=True)
    box: dict[str, str] = {}
    w.searcher = _CancellingSearcher(lambda: runner.cancel(box["id"]), clock=w.clock)
    w.themes = TT.rebuild_themes(w)
    job = runner.submit(
        T.JobKind.theme,
        lambda p: w.themes.refresh(saved.theme_id, timeout=60, on_progress=p, search=True),
    )
    box["id"] = job.id
    runner.run_pending()
    assert T.is_job_cancelled(runner.get(job.id))
    after = TT.rows(w.db, "SELECT * FROM themes")
    assert after == before, "saved theme intact (no error written)"


# =========================================================================== 5. GET /ai/status


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a: Any, **k: Any) -> Any:
        raise AssertionError("GET /ai/status abriu rede")

    monkeypatch.setattr(socket.socket, "connect", boom)
    monkeypatch.setattr(socket.socket, "connect_ex", boom)
    monkeypatch.setattr(socket, "create_connection", boom)
    monkeypatch.setattr(socket, "getaddrinfo", boom)


def _real_llm(config: Any, ctx: Any = None) -> tuple[Any, list[int]]:
    reads: list[int] = []

    def reader() -> Any:
        reads.append(1)
        return config

    backend = hermes_llm.HermesLLMBackend(ctx, config_reader=reader)
    return core_ai.build(settings=FakeSettings(), llm_backend=backend), reads


def _ai_status(wire: Any, llm: Any) -> dict[str, Any]:
    wire.set_many(llm=llm)
    return _check("getAiStatus", _rest(api_ai.get_ai_status))


@pytest.mark.usefixtures("no_network")
def test_ai_status_from_config_without_network(wire: Any) -> None:
    # plugin host (REST): no ctx; the AI runs in the gateway with this same configuration
    llm, reads = _real_llm({"model": {"default": "claude-x", "provider": "anthropic"}})
    assert _ai_status(wire, llm) == {
        "available": True,
        "model": "claude-x",
        "reason": None,
        "provider": "anthropic",
    }
    assert reads, "read the configuration"
    aux = {"auxiliary": {wiring.CURATOR_TASK: {"model": "haiku-y"}}, "model": "principal"}
    llm, _ = _real_llm(aux)
    assert _ai_status(wire, llm)["model"] == "haiku-y", "the plugin task wins over the main model"
    llm, _ = _real_llm({})
    assert _ai_status(wire, llm) == {"available": False, "model": None, "reason": "no_model"}
    llm, _ = _real_llm({"model": {"default": "", "provider": ""}})
    assert _ai_status(wire, llm)["reason"] == "no_model"


@pytest.mark.usefixtures("no_network")
def test_ai_status_in_the_gateway(wire: Any) -> None:
    cfg = {"model": {"default": "claude-x"}}
    llm, _ = _real_llm(cfg, ctx=SimpleNamespace(llm=object()))
    assert _ai_status(wire, llm) == {"available": True, "model": "claude-x", "reason": None}
    llm, _ = _real_llm(cfg, ctx=SimpleNamespace(llm=None))  # Hermes without ctx.llm
    out = _ai_status(wire, llm)
    assert out["available"] is False and out["reason"] == "provider_unavailable"
    llm, _ = _real_llm({}, ctx=SimpleNamespace(llm=object()))
    assert _ai_status(wire, llm) == {"available": False, "model": None, "reason": "no_model"}


@pytest.mark.usefixtures("no_network")
def test_ai_status_with_fake_llm_and_broken_backend(wire: Any) -> None:
    assert _ai_status(wire, FakeLLM(model="fake-m")) == {
        "available": True,
        "model": "fake-m",
        "reason": None,
    }
    off = FakeLLM(model="fake-m", available=False)
    assert _ai_status(wire, off) == {"available": False, "model": None, "reason": "no_model"}

    class Broken:
        def available(self) -> bool:
            raise RuntimeError("x")

        def model_name(self) -> str | None:
            raise RuntimeError("y")

    llm = core_ai.build(settings=FakeSettings(), llm_backend=Broken())  # type: ignore[arg-type]
    assert _ai_status(wire, llm)["available"] is False


# =========================================================================== 6. theme options


def test_theme_options_reach_the_search_plan(theme_world: Any) -> None:
    w = theme_world
    # no options: previous behavior (plain text; the model's mode decides the classics)
    w.llm.script(EXPAND, TT.expand_out(mode="fresh"))
    TT.script_search(w, {"*": [TT.hit(1, 1)]})
    w.llm.script(CURATE, *[TT.keep_all() for _ in range(4)])
    w.themes.create("agentes de IA", timeout=60)
    assert w.llm.calls_for(EXPAND)[-1]["query"] == "agentes de IA"
    assert w.llm.calls_for(CURATE)[-1]["query"] == "agentes de IA"
    assert not [c for c in w.lens.calls if c[0] == "classics"]

    # English + classics: the model said "fresh", the person's choice wins
    w.llm.script(EXPAND, TT.expand_out(mode="fresh"))
    pv = w.themes.create("agentes de IA", timeout=60, language="en", classics=True)
    asked = w.llm.calls_for(EXPAND)[-1]["query"]
    assert asked.startswith("agentes de IA") and "English" in asked and "classic" in asked
    assert "English" in w.llm.calls_for(CURATE)[-1]["query"]
    assert [c for c in w.lens.calls if c[0] == "classics"], "classics entered the plan"
    assert pv.theme.query == "agentes de IA", "the person's text stays clean"
    assert w.themes.mode(pv.theme.id) is T.FeedMode.classics

    # Portuguese without classics: the model said "classics", the person's choice wins
    w.lens.calls.clear()
    w.llm.script(EXPAND, TT.expand_out(mode="classics"))
    pv = w.themes.create("agentes de IA", timeout=60, language="pt", classics=False)
    asked = w.llm.calls_for(EXPAND)[-1]["query"]
    assert "Portuguese" in asked and "classic" not in asked.replace("agentes de IA", "")
    assert not [c for c in w.lens.calls if c[0] == "classics"]
    assert w.themes.mode(pv.theme.id) is T.FeedMode.fresh

    # "any" = no language restriction
    w.llm.script(EXPAND, TT.expand_out(mode="fresh"))
    w.themes.create("agentes de IA", timeout=60, language="any")
    assert w.llm.calls_for(EXPAND)[-1]["query"] == "agentes de IA"

    with pytest.raises(T.ValidationError):
        w.themes.create("agentes de IA", language="fr")
    with pytest.raises(T.ValidationError):
        w.themes.create("agentes de IA", classics="sim")  # type: ignore[arg-type]


def test_theme_options_are_kept_for_the_next_search(theme_world: Any) -> None:
    w = theme_world
    w.llm.script(EXPAND, TT.expand_out(mode="fresh"))
    TT.script_search(w, {"*": [TT.hit(1, 1)]})
    w.llm.script(CURATE, TT.keep_all())
    pv = w.themes.create("agentes de IA", timeout=60, language="pt", classics=True)
    w.themes.save(pv.theme.id, None, actor=T.Actor.user)
    TT.script_search(w, {"*": [TT.hit(2, 1)]})
    w.llm.script(CURATE, TT.keep_all())
    w.themes.refresh(pv.theme.id, timeout=60, search=True)
    assert "Portuguese" in w.llm.calls_for(CURATE)[-1]["query"]


def test_rpc_theme_create_options(theme_world: Any, wire: Any) -> None:
    w = theme_world
    runner = FakeJobRunner(defer=True)
    wire.set_many(themes=w.themes, llm=w.llm, jobs=runner)
    for bad in (
        {"query": "agentes", "language": "fr"},
        {"query": "agentes", "language": 3},
        {"query": "agentes", "classics": "sim"},
    ):
        err = _check("theme.create", _rpc(rpc_themes.theme_create, bad), ok=False)
        assert err["code"] == "invalid", bad
    params = {"query": "agentes de IA", "language": "en", "classics": False}
    _validate("#/components/schemas/ThemeCreateParams", params)
    w.llm.script(EXPAND, TT.expand_out(mode="classics"))
    TT.script_search(w, {"*": [TT.hit(1, 1)]})
    w.llm.script(CURATE, TT.keep_all())
    job = _check("theme.create", _rpc(rpc_themes.theme_create, params))["job"]
    runner.run_pending()
    assert runner.get(job["id"]).status is T.JobStatus.done
    assert "English" in w.llm.calls_for(EXPAND)[-1]["query"]
    assert not [c for c in w.lens.calls if c[0] == "classics"]
    nulls = {"query": "outro tema", "language": None, "classics": None}
    _validate("#/components/schemas/ThemeCreateParams", nulls)
    w.llm.script(EXPAND, TT.expand_out())
    w.llm.script(CURATE, TT.keep_all())
    _check("theme.create", _rpc(rpc_themes.theme_create, nulls))
    runner.run_pending()
    assert w.llm.calls_for(EXPAND)[-1]["query"] == "outro tema"


def test_fake_themes_accept_the_options() -> None:
    lens = FakeLens(classics=[TT.hit(90, 9)])
    w = build_fake_world(MemDb(), llm=FakeLLM(model="m"), lenses=[lens])
    w.searcher = FakeSearcher(clock=w.clock)
    assert w.themes.__class__.__name__ == "FakeThemes"
    w.themes.searcher = w.searcher
    w.llm.script(EXPAND, TT.expand_out(mode="fresh"))
    TT.script_search(w, {"*": [TT.hit(1, 1)]})
    w.llm.script(CURATE, TT.keep_all())
    w.themes.create("agentes de IA", language="en", classics=True)
    assert "English" in w.llm.calls_for(EXPAND)[-1]["query"]
    assert [c for c in lens.calls if c[0] == "classics"]


# =========================================================================== 7. progress


def _steps(events: Any, job_id: str) -> list[dict[str, Any]]:
    out = []
    for name, payload in events.events:
        if name == "theme.progress" and payload["job"] == job_id:
            _validate("#/components/schemas/ThemeProgressPayload", payload)
            out.append(payload["progress"])
    return out


def test_theme_progress_has_structured_numbers_in_every_step(theme_world: Any, wire: Any) -> None:
    w = theme_world
    events = FakeEventSink()
    runner = FakeJobRunner(defer=True, events=events)
    wire.set_many(themes=w.themes, llm=w.llm, jobs=runner)
    TT.standard(w)  # 5 searches · 8 unique videos · 1 cut
    job = _check("theme.create", _rpc(rpc_themes.theme_create, {"query": "agentes de IA"}))["job"]
    runner.run_pending()
    progress = _steps(events, job["id"])
    assert progress and all(p["step"] is not None for p in progress)
    assert all(p["step"]["name"] == p["stage"] for p in progress)
    names = list(dict.fromkeys(p["step"]["name"] for p in progress))
    assert names == ["expand", "search", "curate", "preview"]
    last = {p["step"]["name"]: p["step"] for p in progress}
    assert last["expand"] == {"name": "expand", "done": 5, "total": 5}, "planned searches"
    assert last["search"] == {"name": "search", "done": 8, "total": 8}, "videos found"
    assert last["curate"] == {"name": "curate", "done": 8, "total": 8}, "avaliados de encontrados"
    assert last["preview"] == {"name": "preview", "done": 7, "total": 8}, "mantidos de avaliados"
    curate = [p["step"] for p in progress if p["step"]["name"] == "curate"]
    assert curate[0] == {"name": "curate", "done": 0, "total": 8}
    assert all(p["message"] for p in progress), "mensagem continua (cliente antigo)"


def test_theme_progress_numbers_survive_the_database(theme_world: Any, wire: Any) -> None:
    w = theme_world
    runner = real_runner(w.db)
    TT.standard(w)
    job = runner.submit(
        T.JobKind.theme,
        lambda p: w.themes.create("agentes de IA", timeout=60, on_progress=p),
        progress_event="theme.progress",
    )
    done = wait_job_end(runner, job.id)
    assert done.status is T.JobStatus.done
    wire.set_many(jobs=runner)
    seen = _check("getJob", _rest(api_jobs.get_job, {"id": job.id}))
    assert seen["progress"]["step"] == {"name": "preview", "done": 7, "total": 8}


def test_refresh_progress_starts_with_seeds_step(theme_world: Any) -> None:
    w = theme_world
    TT.standard(w)
    pv = w.themes.create("agentes de IA", timeout=60)
    w.themes.save(pv.theme.id, None, actor=T.Actor.user)
    got: list[T.Progress] = []
    w.themes.refresh(pv.theme.id, timeout=60, on_progress=got.append, search=False)
    assert got[0].step is not None and got[0].step.name is T.ThemeStep.seeds
    assert got[-1].step is not None and got[-1].step.name is T.ThemeStep.preview


def test_fake_themes_progress_has_steps() -> None:
    w = build_fake_world(MemDb(), llm=FakeLLM(model="m"))
    w.searcher = FakeSearcher(clock=w.clock)
    w.themes.searcher = w.searcher
    TT.standard(w)
    got: list[T.Progress] = []
    w.themes.create("agentes de IA", on_progress=got.append)
    names = list(dict.fromkeys(p.step.name.value for p in got if p.step is not None))
    assert names == ["expand", "search", "curate", "preview"]


def test_organize_progress_is_unchanged_without_step(org_world: Any) -> None:
    w = org_world
    TO.subscribe(w, 1, 2, 3)
    w.llm.script(ORGANIZE, TO.same("Tech"), TO.same("Tech"))
    got: list[T.Progress] = []
    w.organizer.organize(None, timeout=60, on_progress=got.append)
    assert [(p.stage, p.done, p.total) for p in got] == [
        ("organize", 0, 3),
        ("organize", 2, 3),
        ("organize", 3, 3),
    ]


# =========================================================================== 8. change_ids


def _accept_scenario(w: Any, runner_wire: Any) -> tuple[dict[str, Any], list[int], Any]:
    TO.subscribe(w, 1, 2, 3)
    tech = TO.same("Tecnologia/IA", new=True, tags=["ia"])
    w.llm.script(ORGANIZE, tech, tech)  # real in batches of 2 (2 calls); fake: 1
    w.organizer.organize()
    group = [s.id for s in w.organizer.pending()]
    last = max([r.id for r in w.changelog.list(limit=500)] or [0])
    before = TO.snapshot(w.db)
    data = _check("organize.accept", _rpc(rpc_org.organize_accept, {"suggestion_ids": group}))
    new = sorted(r.id for r in w.changelog.list(limit=500) if r.id > last)
    return data, new, before


def test_accept_returns_the_exact_change_ids_and_undo_reverts_it(org_world: Any, wire: Any) -> None:
    w = org_world
    wire.set_many(organizer=w.organizer, llm=w.llm, changelog=w.changelog)
    data, new, before = _accept_scenario(w, wire)
    noise = TO.subscribe(w, 9)
    assert data["change_ids"] == new and len(new) >= 3, (data, new)
    assert all(isinstance(i, int) for i in data["change_ids"])
    # a change afterwards, outside the accept
    w.channels.update(noise[0], T.ChannelPatch(favorite=True), actor=T.Actor.user)
    undone = w.changelog.undo(data["change_ids"][0], targets=w.targets())
    assert sorted(r.id for r in undone) == new, "undoes exactly the accept"
    after = TO.snapshot(w.db)
    after["channels"] = [c for c in after["channels"] if c["id"] != noise[0]]
    assert after == before
    assert w.channels.get(noise[0]).favorite is True, "the rest stays"
    empty = _check("organize.accept", _rpc(rpc_org.organize_accept, {"channel_ids": noise}))
    assert empty["change_ids"] == [] and empty["accepted"] == []


def test_fake_accept_returns_change_ids(wire: Any) -> None:
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(fake_world_module, "FakeChangeLog", FakeChangeLog)
        mp.setattr(fake_world_module, "FakeChannelService", FakeChannelService)
        mp.setattr(fake_world_module, "FakeTaxonomyService", FakeTaxonomyService)
        mp.setattr(fake_world_module, "FakeOrganizer", FakeOrganizer)
        w = build_fake_world(MemDb(), llm=FakeLLM(model="m"))
    finally:
        mp.undo()
    wire.set_many(organizer=w.organizer, llm=w.llm, changelog=w.changelog)
    data, new, before = _accept_scenario(w, wire)
    assert data["change_ids"] == new and new
    w.changelog.undo(data["change_ids"][-1], targets=w.targets())
    assert TO.snapshot(w.db) == before
