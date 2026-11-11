"""Refresh, read and status routes (``api/refresh.py``, ``api/status.py``).

Real database (``core/db.py`` in ``tmp_path``), real ``Refresher`` (``core/refresh.py``) and fakes
for the rest. Every ``ok`` answer is validated **strictly** against ``x-data`` in
``contract/api.yaml``; every error, against ``ErrorEnvelope`` and the operation's ``x-errors``.

Proofs: ``/status`` < 50 ms with slow YouTube and a cycle running; ``/status`` with
``rss_down_since`` (RSS outage); ``/refresh`` twice → ``running`` and a single cycle;
``/read`` by channel, recursive folder and everything; database locked by another process; two
processes (two ``Db`` on the same file) calling ``/status`` and ``/refresh`` together → one cycle;
extension server started by ``/status`` and never by ``register()``.
"""

from __future__ import annotations

import importlib.util
import multiprocessing as mp
import os
import random
import socket
import sqlite3
import sys
import threading
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TESTS = Path(__file__).resolve().parent
if "tube_pkg" not in sys.modules:  # a multiprocessing child (spawn) does not load the conftest
    _spec = importlib.util.spec_from_file_location(
        "_tube_bootstrap_refresh_api", ROOT / "plugin" / "_bootstrap.py"
    )
    assert _spec is not None and _spec.loader is not None
    _boot = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_boot)
    _boot.ensure()
    if str(TESTS) not in sys.path:
        sys.path.insert(0, str(TESTS))

import pytest  # noqa: E402
from _spawn import children_can_import  # noqa: E402
from _timing import fast_budget  # noqa: E402
from fakes import FakeYouTube, build_fake_world  # noqa: E402
from fakes import seed_world as _seed  # noqa: E402

from tube_pkg import wiring  # noqa: E402
from tube_pkg.api import _common  # noqa: E402
from tube_pkg.api import refresh as api_refresh  # noqa: E402
from tube_pkg.api import status as api_status  # noqa: E402
from tube_pkg.core import db as core_db  # noqa: E402
from tube_pkg.core import refresh as R  # noqa: E402
from tube_pkg.core import types as T  # noqa: E402
from tube_pkg.ext import _server  # noqa: E402

DAY = 86_400
FAKE_PORT = 23456


def _load_gen_types() -> Any:
    name = "_gen_types_refresh_api"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "gen_types.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


GEN = _load_gen_types()
CONTRACT = GEN.load_contract(ROOT)


# --------------------------------------------------------------------------- validation


def check_ok(operation_id: str, env: Any) -> Any:
    """``ok`` envelope validated strictly against ``x-data``; returns ``data``."""
    assert _common.is_envelope(env), env
    assert env["ok"] is True, env
    assert set(env) == {"ok", "data"}, env
    op = GEN.get_operation(CONTRACT, operation_id)
    GEN.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    return env["data"]


def check_err(operation_id: str, env: Any) -> str:
    """Strict error envelope, with a code declared in ``x-errors``; returns the code."""
    assert _common.is_envelope(env), env
    assert env["ok"] is False, env
    GEN.validate_instance({"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True)
    op = GEN.get_operation(CONTRACT, operation_id)
    code = env["error"]["code"]
    assert code in op.errors, (operation_id, code, op.errors)
    return code


# --------------------------------------------------------------------------- helpers


def cid(n: int) -> str:
    return f"UCb02bchan{n:014d}"


def vid(n: int, j: int) -> str:
    return f"w{n:06d}_{j:03d}"


def insert_channels(db: Any, ids: Sequence[str], *, now: int, folder_id: str | None = None) -> None:
    db.executemany(
        "INSERT INTO channels (id, title, relation, source, added_at, favorite, folder_id)"
        " VALUES (?, ?, 'subscribed', 'extension', ?, 0, ?)",
        [(c, f"Canal {c[-4:]}", now, folder_id) for c in ids],
    )


def make_feed(channel: str, n: int, *, now: int, count: int = 3) -> T.RssFeed:
    videos = tuple(
        T.VideoIn(
            id=vid(n, j),
            channel_id=channel,
            title=f"Vídeo {j} do canal {n}",
            published_at=now - j * DAY - 3600,
            channel_title=f"Canal {n}",
            views=100 + j,
            is_short=False,
        )
        for j in range(count)
    )
    return T.RssFeed(channel=T.ChannelInfo(id=channel, title=f"Canal {n}"), videos=videos)


def meta(db: Any, key: str) -> str | None:
    row = db.query_one("SELECT value FROM meta WHERE key = ?", (key,))
    return row["value"] if row else None


def set_meta(db: Any, key: str, value: str) -> None:
    db.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def wait_until(pred: Any, timeout: float = 10.0) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return
        time.sleep(0.01)
    raise AssertionError("condition did not become true in time")


def timed(fn: Any, *args: Any) -> tuple[Any, float]:
    t0 = time.perf_counter()
    out = fn(*args)
    return out, time.perf_counter() - t0


class SlowYouTube(FakeYouTube):
    """Slow, counting ``FakeYouTube``: ``delay`` per RSS and a ``gate`` that holds the cycle."""

    def __init__(self, delay: float = 0.0) -> None:
        super().__init__()
        self.delay = delay
        self.gate: threading.Event | None = None
        self.entered = threading.Event()
        self.fetched = 0
        self._mx = threading.Lock()

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        self.entered.set()
        if self.gate is not None:
            self.gate.wait(15)
        if self.delay:
            time.sleep(self.delay)
        with self._mx:
            self.fetched += 1
            return super().fetch_channel_rss(channel_id)

    def is_short(self, video_id: str) -> bool:
        return False


def make_refresher(world: Any, **kw: Any) -> R.Refresher:
    deps: dict[str, Any] = dict(
        db=world.db,
        settings=world.settings,
        youtube=world.youtube,
        channels=world.channels,
        video_store=R.build_video_store(db=world.db, settings=world.settings, clock=world.clock),
        feed=world.feed,
        events=world.events,
        changelog=world.changelog,
        ext_endpoint_up=world.ext_endpoint_up,
        clock=world.clock,
        shorts_per_cycle=0,
        cold_start_pages=0,
    )
    deps.update(kw)
    return R.Refresher(**deps)


class Env:
    """Fakes + real ``Refresher`` wired into ``wiring`` (+ fake ``ensure_ext_server``)."""

    def __init__(self, world: Any, refresher: R.Refresher, ensured: list[str | None]) -> None:
        self.world = world
        self.db = world.db
        self.clock = world.clock
        self.yt: SlowYouTube = world.youtube
        self.ref = refresher
        self.ensured = ensured

    def channels(self, n: int, **kw: Any) -> list[str]:
        now = self.clock.now()
        ids = [cid(i) for i in range(n)]
        insert_channels(self.db, ids, now=now, **kw)
        for i, c in enumerate(ids):
            self.yt.add_rss(make_feed(c, i, now=now))
        return ids

    def not_due(self) -> None:
        set_meta(self.db, T.META_LAST_RSS_AT, str(self.clock.now()))

    def idle(self, timeout: float = 10.0) -> None:
        wait_until(lambda: not self.ref.is_running(), timeout)


@pytest.fixture(autouse=True)
def _fresh_route_state() -> Any:
    """Forgets the route caches and in-flight tasks (they are per process and profile)."""
    resets = [getattr(m, "reset", None) for m in (api_status, api_refresh)]
    for fn in resets:
        if fn is not None:
            fn()
    yield
    for fn in resets:
        if fn is not None:
            fn()


@pytest.fixture
def env(db: Any, wire: Any, monkeypatch: pytest.MonkeyPatch) -> Env:
    yt = SlowYouTube()
    world = build_fake_world(db, youtube=yt)
    ref = make_refresher(world)
    wire.use_world(world)
    wire.set("refresher", ref)
    ensured: list[str | None] = []

    def fake_ensure(*, role: str | None = None) -> int | None:
        ensured.append(role)
        return FAKE_PORT

    monkeypatch.setattr(wiring, "ensure_ext_server", fake_ensure)
    e = Env(world, ref, ensured)
    yield e
    if yt.gate is not None:
        yt.gate.set()
    try:
        e.idle(15)
    except AssertionError:
        pass


def status() -> dict[str, Any]:
    return check_ok("getStatus", api_status.get_status(None, {}))


# =========================================================================== surface


def test_handlers_are_real_and_wired() -> None:
    for fn in (
        api_status.get_status,
        api_refresh.post_refresh,
        api_refresh.post_refresh_channel,
        api_refresh.post_read,
    ):
        assert _common.is_real(fn), fn
        assert _common.stub_operation(fn) is None
    routes = {(r.method, r.path): (r.module, r.handler) for r in wiring.REST_ROUTES}
    assert routes[("GET", "/status")] == ("tube_pkg.api.status", "get_status")
    assert routes[("POST", "/refresh")] == ("tube_pkg.api.refresh", "post_refresh")
    assert routes[("POST", "/refresh/{channel_id}")] == (
        "tube_pkg.api.refresh",
        "post_refresh_channel",
    )
    assert routes[("POST", "/read")] == ("tube_pkg.api.refresh", "post_read")


def test_route_modules_never_wait_for_the_cycle() -> None:
    """A route never runs the cycle on its own thread (the plugin host has a 60 s limit)."""
    for module in (api_refresh, api_status):
        src = Path(module.__file__).read_text(encoding="utf-8")
        assert "wait=True" not in src
        assert ".refresh_all(" not in src and ".refresh_channel(" not in src
        assert "os.environ" not in src and "getenv" not in src


# =========================================================================== GET /status


def test_status_shape_counts_and_server(env: Env) -> None:
    seeded = _seed(env.world)
    env.not_due()
    data = status()
    assert data["ext_port"] == FAKE_PORT and data["ext_endpoint_up"] is True
    assert env.ensured and all(r in (None, "host") for r in env.ensured)
    snap = env.ref.status()
    assert data["new_total"] == snap.new_total > 0
    assert {t["tab_id"]: t["count"] for t in data["new_by_tab"]} == {
        t.tab_id: t.count for t in snap.new_by_tab
    }
    fav = {f["channel_id"] for f in data["fav_new"]}
    assert seeded.channels["fireship"] in fav
    assert data["last_rss_at"] == env.clock.now() and data["refresh_running"] is False
    assert data["rss_down_since"] is None and data["rss_fallback_channels"] == 0


def test_status_kicks_due_refresh_without_waiting(env: Env) -> None:
    ids = env.channels(5)
    env.yt.gate = threading.Event()  # the cycle gets stuck on the 1st RSS
    data, dt = timed(status)
    assert dt < fast_budget(), dt
    assert env.yt.entered.wait(5)
    assert env.ref.is_running()
    assert data["refresh_running"] is True  # kick before the read, on the same worker thread
    env.yt.gate.set()
    env.idle()
    assert env.yt.fetched == len(ids)
    assert status()["last_rss_at"] == env.clock.now()


def test_status_under_50ms_while_slow_cycle_runs(env: Env) -> None:
    _seed(env.world)
    env.channels(40)
    env.yt.delay = 0.02  # slow YouTube: the cycle takes ~0.2 s+ with 4 concurrent
    env.yt.gate = threading.Event()
    assert check_ok("postRefresh", api_refresh.post_refresh({}, {}))["result"] == "started"
    assert env.yt.entered.wait(5)
    times: list[float] = []
    for i in range(40):
        if i == 10:
            env.yt.gate.set()  # half with the cycle stuck, half with it writing
        data, dt = timed(status)
        times.append(dt)
        assert data["new_total"] > 0
    assert max(times) < fast_budget(), f"max={max(times) * 1000:.1f} ms"
    print(
        f"/status with a cycle: max {max(times) * 1000:.1f} ms, mean "
        f"{sum(times) / len(times) * 1000:.1f} ms"
    )
    env.idle()


def test_status_shows_rss_outage(env: Env, wire: Any) -> None:
    """RSS outage scenario: RSS 404 on every channel, fallback through the page → ``/status`` shows
    since when and how many channels came through the page."""
    ids = env.channels(10)
    now = env.clock.now()
    for i, c in enumerate(ids):
        env.yt.fail(
            "fetch_channel_rss",
            c,
            T.YouTubeError(
                f"channel RSS {c}: HTTP 404", status=404, feed_unavailable=True, channel_id=c
            ),
        )
        env.yt.uploads[c] = make_feed(c, i, now=now)
    ref = make_refresher(env.world, fallback_budget=4)
    env.ref = ref
    wire.set("refresher", ref)
    assert ref.kick_if_due(wait=True) == "started"
    data = status()
    assert data["rss_down_since"] == now
    assert data["rss_fallback_channels"] == 4
    assert data["last_rss_at"] == now and data["refresh_running"] is False


def test_status_degrades_field_by_field(env: Env, wire: Any) -> None:
    _seed(env.world)
    env.not_due()
    first = status()

    class BrokenStatus:
        """``status()`` breaks; the cheap fields keep answering."""

        def __init__(self, inner: Any) -> None:
            self.inner = inner

        def __getattr__(self, name: str) -> Any:
            return getattr(self.inner, name)

        def status(self) -> T.StatusSnapshot:
            raise RuntimeError("broken engine")

    wire.set("refresher", BrokenStatus(env.ref))
    set_meta(env.db, T.META_LAST_RSS_AT, str(env.clock.now() - 5))
    set_meta(env.db, R.META_RSS_DOWN_SINCE, str(env.clock.now() - 60))
    set_meta(env.db, R.META_RSS_FALLBACK_CHANNELS, "3")
    data = status()
    assert data["last_rss_at"] == env.clock.now() - 5  # live field
    assert data["rss_down_since"] == env.clock.now() - 60 and data["rss_fallback_channels"] == 3
    assert data["new_total"] == first["new_total"]  # last known value
    assert data["new_by_tab"] == first["new_by_tab"] and data["fav_new"] == first["fav_new"]


def test_first_status_waits_for_real_counts_not_zeros(env: Env, wire: Any) -> None:
    """Cold start: a slow read (large database) does not become "0 new" on the first query."""
    _seed(env.world)
    env.not_due()
    expected = status()["new_total"]
    assert expected > 0

    class SlowStatus:
        def __init__(self, inner: Any) -> None:
            self.inner = inner

        def __getattr__(self, name: str) -> Any:
            return getattr(self.inner, name)

        def status(self) -> T.StatusSnapshot:
            time.sleep(0.15)  # well above STATUS_WAIT_S, below STATUS_COLD_WAIT_S
            return self.inner.status()

    wire.set("refresher", SlowStatus(env.ref))
    api_status.reset()  # freshly started process: nothing known
    assert status()["new_total"] == expected
    t0 = time.monotonic()
    assert status()["new_total"] == expected  # already known: back to the short budget
    assert time.monotonic() - t0 < 0.12


def test_status_never_fails_when_everything_breaks(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("everything broken")

    monkeypatch.setattr(wiring, "get_refresher", boom)
    monkeypatch.setattr(wiring, "ensure_ext_server", boom)
    env_ = api_status.get_status(None, {})
    data = check_ok("getStatus", env_)
    assert data["new_total"] == 0 and data["ext_port"] is None
    assert data["ext_endpoint_up"] is False and data["refresh_running"] is False


def _file_path(db: Any) -> str:
    """Path of the test database file (``MemDb`` has no file: the cross-process proof only makes
    sense with real SQLite)."""
    path = str(getattr(db, "path", "") or "")
    if not path or path == ":memory:" or not Path(path).exists():
        pytest.skip("needs real file-backed SQLite (TUBE_TEST_DB=mem)")
    return path


def _hold_write_lock(path: str, ready: Any, release: Any, hold_s: float) -> None:
    conn = sqlite3.connect(path, timeout=10, isolation_level=None)
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("UPDATE meta SET value = value WHERE key = 'schema_version'")
    ready.set()
    release.wait(hold_s)
    conn.execute("COMMIT")
    conn.close()


def test_status_answers_fast_while_other_process_holds_the_db(env: Env, tmp_path: Path) -> None:
    """Another process holds the SQLite write lock: the ``/status`` kick waits for the
    ``busy_timeout`` (and this process's ``Db`` lock), but the answer comes out right away with the
    last known values — never an error."""
    path = _file_path(env.db)
    _seed(env.world)
    env.channels(3)
    env.not_due()
    first = status()
    set_meta(env.db, T.META_LAST_RSS_AT, str(env.clock.now() - 3 * 3600))  # grace period expires
    ctx = mp.get_context("spawn")
    ready, release = ctx.Event(), ctx.Event()
    proc = ctx.Process(target=_hold_write_lock, args=(path, ready, release, 4.0))
    with children_can_import(__name__, __file__):
        proc.start()
    try:
        assert ready.wait(30)
        times = []
        for _ in range(5):
            raw, dt = timed(api_status.get_status, None, {})
            times.append(dt)
            data = check_ok("getStatus", raw)
            assert data["new_total"] == first["new_total"]
            assert data["ext_port"] == FAKE_PORT
        # the route waits up to STATUS_WAIT_S for the held lock, by design, then answers right
        # away — never the 5 s busy_timeout. The budget is that wait plus a fast call (the wait
        # alone left a slower machine 15 ms for everything else).
        assert api_status.STATUS_WAIT_S < 0.05
        assert max(times) < api_status.STATUS_WAIT_S + fast_budget(), times
        print(f"/status with the database locked elsewhere: max {max(times) * 1000:.1f} ms")
    finally:
        release.set()
        proc.join(15)
    wait_until(lambda: env.ref.last_rss_at() == env.clock.now() or env.ref.is_running(), 10)
    env.idle()
    assert status()["last_rss_at"] == env.clock.now()


# =========================================================================== POST /refresh


def test_refresh_twice_second_is_running_one_cycle(env: Env) -> None:
    ids = env.channels(8)
    env.not_due()
    env.yt.gate = threading.Event()
    first, dt1 = timed(api_refresh.post_refresh, {"force": True}, {})
    second, dt2 = timed(api_refresh.post_refresh, {}, {})
    assert check_ok("postRefresh", first) == {"result": "started"}
    assert check_ok("postRefresh", second) == {"result": "running"}
    assert dt1 < fast_budget() and dt2 < fast_budget(), (dt1, dt2)
    assert check_ok("postRefresh", api_refresh.post_refresh({"force": False}, {})) == {
        "result": "running"
    }
    env.yt.gate.set()
    env.idle()
    assert env.yt.fetched == len(ids)  # a single cycle
    assert env.ref.last_rss_at() == env.clock.now()


def test_refresh_force_false_respects_interval_and_default_is_force(env: Env) -> None:
    env.channels(2)
    env.not_due()
    assert check_ok("postRefresh", api_refresh.post_refresh({"force": False}, {})) == {
        "result": "skipped"
    }
    assert check_ok("postRefresh", api_refresh.post_refresh({}, {})) == {"result": "started"}
    env.idle()
    assert check_ok("postRefresh", api_refresh.post_refresh(None, {})) == {"result": "started"}
    env.idle()


@pytest.mark.parametrize("body", [{"force": "yes"}, {"force": 1}, {"force": None}, ["x"]])
def test_refresh_bad_body_is_invalid(env: Env, body: Any) -> None:
    """A non-boolean ``force`` violates the body schema → ``invalid`` (the router already returns
    ``invalid`` for bad JSON on this same route; ``x-errors: []`` — contract change requested)."""
    out = _common.call_rest(api_refresh.post_refresh, body, {})
    assert out["ok"] is False and out["error"]["code"] == "invalid", out
    GEN.validate_instance({"$ref": "#/components/schemas/ErrorEnvelope"}, out, ROOT, strict=True)
    assert not env.ref.is_running()


def test_refresh_ignores_unknown_keys(env: Env) -> None:
    """The body schema does not close properties: an extra key is ignored (default ``force``)."""
    env.channels(1)
    env.not_due()
    out = api_refresh.post_refresh({"other": True}, {})
    assert check_ok("postRefresh", out) == {"result": "started"}
    env.idle()


def test_refresh_does_not_hold_the_request_when_db_is_locked(env: Env) -> None:
    path = _file_path(env.db)
    env.channels(2)
    ctx = mp.get_context("spawn")
    ready, release = ctx.Event(), ctx.Event()
    proc = ctx.Process(target=_hold_write_lock, args=(path, ready, release, 4.0))
    with children_can_import(__name__, __file__):
        proc.start()
    try:
        assert ready.wait(30)
        out, dt = timed(api_refresh.post_refresh, {"force": True}, {})
        assert check_ok("postRefresh", out) == {"result": "running"}  # request accepted, queued
        assert dt < api_refresh.REFRESH_WAIT_S + 0.2, dt
    finally:
        release.set()
        proc.join(15)
    wait_until(lambda: env.ref.last_rss_at() is not None, 15)
    assert env.yt.fetched == 2


# =========================================================================== POST /refresh/{id}


def test_refresh_channel_started_running_and_errors(env: Env) -> None:
    ids = env.channels(3)
    env.yt.gate = threading.Event()
    out, dt = timed(api_refresh.post_refresh_channel, {}, {"channel_id": ids[1]})
    assert check_ok("postRefreshChannel", out) == {"result": "started"} and dt < fast_budget()
    assert env.yt.entered.wait(5)
    again = api_refresh.post_refresh_channel({}, {"channel_id": ids[1]})
    assert check_ok("postRefreshChannel", again) == {"result": "running"}
    other = api_refresh.post_refresh_channel({}, {"channel_id": ids[2]})
    assert check_ok("postRefreshChannel", other) == {"result": "started"}

    missing = api_refresh.post_refresh_channel({}, {"channel_id": cid(999)})
    assert check_err("postRefreshChannel", missing) == "not_found"
    for bad in ("UCcurto", "", "XX" + "a" * 22, "UC" + "a" * 21 + "!"):
        out = api_refresh.post_refresh_channel({}, {"channel_id": bad})
        assert check_err("postRefreshChannel", out) == "invalid", bad
    assert check_err("postRefreshChannel", api_refresh.post_refresh_channel({}, {})) == "invalid"

    env.yt.gate.set()
    wait_until(lambda: not env.ref.kick_channel_active(ids[1]))
    wait_until(lambda: not env.ref.kick_channel_active(ids[2]))
    n = env.db.query_one(
        "SELECT COUNT(*) AS n FROM videos WHERE channel_id IN (?, ?)", (ids[1], ids[2])
    )
    assert n is not None and n["n"] == 6
    assert env.ref.last_rss_at() is None  # one channel does not count as a cycle


# =========================================================================== POST /read


def _new_by_channel(env: Env) -> dict[str, int]:
    """New per channel (only channels with something new)."""
    return {c: n for c, n in env.world.feed.new_counts().by_channel.items() if n}


def test_read_channel_folder_and_all_with_counts(env: Env) -> None:
    seeded = _seed(env.world)
    env.clock.advance(60)
    before = _new_by_channel(env)
    total_before = env.world.feed.new_counts().total
    fire = seeded.channels["fireship"]
    assert before[fire] > 0 and total_before > 0

    # channel
    out = api_refresh.post_read({"kind": "channel", "id": fire}, {})
    assert check_ok("postRead", out) == {"changed": 1}
    after = _new_by_channel(env)
    assert fire not in after
    assert after == {c: n for c, n in before.items() if c != fire}  # the others do not change
    rec = env.world.changelog.list()[0]
    assert rec.action is T.ChangeAction.mark_read and rec.actor is T.Actor.user
    assert check_ok("postRead", api_refresh.post_read({"kind": "channel", "id": fire}, {})) == {
        "changed": 0
    }

    # folder with a subfolder: Tecnologia ⊃ IA
    tech = {seeded.channels[k] for k in ("fireship", "twominute", "aiexplained")}
    tech |= {seeded.channels[k] for k in ("mkbhd", "linus", "verge")}
    science = {seeded.channels[k] for k in ("veritasium", "cienciatododia", "kurzgesagt")}
    mid = _new_by_channel(env)
    assert any(mid.get(c, 0) for c in tech - {fire}) and any(mid.get(c, 0) for c in science)
    out = api_refresh.post_read({"kind": "folder", "id": seeded.folders["Tecnologia"]}, {})
    assert check_ok("postRead", out) == {"changed": len(tech) - 1}  # fireship was already read
    after = _new_by_channel(env)
    assert all(after.get(c, 0) == 0 for c in tech)
    assert {c: after.get(c, 0) for c in science} == {c: mid.get(c, 0) for c in science}

    # everything
    out = api_refresh.post_read({"kind": "all", "id": None}, {})
    changed = check_ok("postRead", out)["changed"]
    assert changed > 0
    counts = env.world.feed.new_counts()
    active = {
        r["id"]
        for r in env.db.query(
            "SELECT id FROM channels WHERE relation IN ('subscribed', 'followed')"
        )
    }
    assert all(counts.by_channel.get(c, 0) == 0 for c in active)
    print(f"/read: new before={total_before} after={counts.total} (channel, folder, everything)")

    # undo through the history (the core stores mark_read with UndoMarkRead)
    marks_before_all = env.world.changelog.list()[0]
    assert marks_before_all.action is T.ChangeAction.mark_read
    env.world.refresher = env.ref
    env.world.changelog.undo(marks_before_all.id, targets=env.world.targets())
    assert _new_by_channel(env) == after


def test_read_folder_recursive_counts_only_subtree(env: Env) -> None:
    seeded = _seed(env.world)
    env.clock.advance(60)
    out = api_refresh.post_read({"kind": "folder", "id": seeded.folders["IA"]}, {})
    assert check_ok("postRead", out) == {"changed": 3}
    after = _new_by_channel(env)
    for k in ("fireship", "twominute", "aiexplained"):
        assert after.get(seeded.channels[k], 0) == 0
    assert after.get(seeded.channels["mkbhd"], 0) > 0  # parent is not included


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"kind": "channel", "id": "UCb02bchan00000000000999"}, "not_found"),
        ({"kind": "folder", "id": "pasta-que-nao-existe"}, "not_found"),
        ({"kind": "folder"}, "invalid"),
        ({"kind": "channel", "id": None}, "invalid"),
        ({"kind": "channel", "id": ""}, "invalid"),
        ({"kind": "channel", "id": 7}, "invalid"),
        ({"kind": "pasta", "id": "x"}, "invalid"),
        ({}, "invalid"),
        ({"kind": "all", "extra": 1}, "invalid"),
        (["all"], "invalid"),
        (None, "invalid"),
    ],
)
def test_read_errors(env: Env, body: Any, code: str) -> None:
    _seed(env.world)
    out = _common.call_rest(api_refresh.post_read, body, {})
    assert check_err("postRead", out) == code
    assert env.world.changelog.list() == []


# =========================================================================== extension server


def _free_block(span: int = 3) -> int:
    rng = random.Random()
    for _ in range(300):
        p = rng.randrange(20000, 40000 - span)
        free = True
        for q in range(p, p + span):
            s = socket.socket()
            try:
                s.bind(("127.0.0.1", q))
            except OSError:
                free = False
            finally:
                s.close()
        if free:
            return p
    raise RuntimeError("no free port block")


def _load_plugin_init() -> Any:
    name = "_tube_plugin_init_refresh_api"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, ROOT / "plugin" / "__init__.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_register_never_starts_server_and_status_does(
    db: Any, wire: Any, fake_ctx: Any, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The extension server starts on demand in ``GET /status`` (real server on a test port
    range), never in ``register()``."""
    base = _free_block()
    data_dir = tmp_path / "plugin-data"
    real_ensure = _server.ensure_server
    calls: list[str | None] = []

    def ensure_in_test_range(**kwargs: Any) -> int | None:
        calls.append(kwargs.get("role"))
        kwargs.update(port_base=base, port_span=3)
        return real_ensure(**kwargs)

    world = build_fake_world(db, youtube=SlowYouTube())
    wire.use_world(world)
    wire.set("refresher", make_refresher(world))
    set_meta(db, T.META_LAST_RSS_AT, str(world.clock.now()))
    monkeypatch.setattr(_server, "ensure_server", ensure_in_test_range)
    monkeypatch.setattr(wiring, "data_dir", lambda: data_dir)
    try:
        plugin_init = _load_plugin_init()
        plugin_init.register(fake_ctx)
        assert calls == [], "register() started the extension server"
        assert _server.local_server(data_dir) is None

        status()
        assert calls, "GET /status did not call ensure_ext_server"
        # the server starts on a route thread; the answer only waits for the short budget
        wait_until(lambda: status()["ext_port"] is not None, 5)
        data = status()
        port = data["ext_port"]
        assert isinstance(port, int) and base <= port < base + 3, data
        assert data["ext_endpoint_up"] is True
        health = _server.health(port)
        assert health is not None and health.get("service")
        again = status()
        assert again["ext_port"] == port  # reuses the same server
    finally:
        _server.stop_local(data_dir)
        for cb in getattr(fake_ctx, "unload_callbacks", []):
            try:
                cb()
            except Exception:  # noqa: BLE001
                pass


# =========================================================================== two processes


class ChildYouTube:
    """Minimal ``YouTubeClient`` for the children: slow, counts the RSS reads."""

    def __init__(self, delay: float) -> None:
        self.delay = delay
        self.fetched = 0
        self._mx = threading.Lock()

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        time.sleep(self.delay)
        with self._mx:
            self.fetched += 1
        return make_feed(channel_id, int(channel_id[-6:]), now=int(time.time()))

    def is_short(self, video_id: str) -> bool:
        return False


def _two_process_worker(db_path: str, name: str, barrier: Any, out: Any) -> None:
    os.environ["TUBE_DB_PATH"] = db_path
    from tube_pkg import wiring as w
    from tube_pkg.api import refresh as ar
    from tube_pkg.api import status as st

    yt = ChildYouTube(delay=0.05)
    w.get_youtube = lambda: yt  # type: ignore[assignment]
    w.ensure_ext_server = lambda *, role=None: None  # type: ignore[assignment]  # no real port
    errors: list[str] = []
    envs: list[tuple[str, Any, float]] = []
    try:
        w.get_refresher()  # builds the graph before the start
        barrier.wait(30)

        def call(kind: str, fn: Any, body: Any) -> None:
            t0 = time.perf_counter()
            try:
                envs.append((kind, fn(body, {}), time.perf_counter() - t0))
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{kind}: {exc!r}")

        threads = [
            threading.Thread(target=call, args=("status", st.get_status, None)),
            threading.Thread(target=call, args=("refresh", ar.post_refresh, {"force": True})),
            threading.Thread(target=call, args=("status", st.get_status, None)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        ref = w.get_refresher()
        end = time.monotonic() + 30
        time.sleep(0.2)
        while time.monotonic() < end and (ref.is_running() or ref.last_rss_at() is None):
            time.sleep(0.05)
        envs.append(("status", st.get_status(None, {}), 0.0))
    except Exception as exc:  # noqa: BLE001
        errors.append(repr(exc))
    out.put((name, yt.fetched, envs, errors))


def test_two_processes_status_and_refresh_one_cycle(tmp_path: Path) -> None:
    path = str(tmp_path / "two.db")
    n = 12
    db = core_db.build(path=path)
    try:
        insert_channels(db, [cid(i) for i in range(n)], now=int(time.time()))
    finally:
        db.close()
    ctx = mp.get_context("spawn")
    barrier, out = ctx.Barrier(2), ctx.Queue()
    procs = [
        ctx.Process(target=_two_process_worker, args=(path, f"p{i}", barrier, out))
        for i in range(2)
    ]
    with children_can_import(__name__, __file__):
        for p in procs:
            p.start()
    try:
        results = [out.get(timeout=90) for _ in procs]
    finally:
        for p in procs:
            p.join(15)
            if p.is_alive():
                p.kill()
    assert all(not r[3] for r in results), results
    assert sum(r[1] for r in results) == n, [(r[0], r[1]) for r in results]  # a single cycle
    kicks = []
    for _name, _fetched, envs, _errors in results:
        for kind, env_, dt in envs:
            if kind == "status":
                check_ok("getStatus", env_)
            else:
                kicks.append(check_ok("postRefresh", env_)["result"])
                assert dt < 1.0, dt
    assert set(kicks) <= {"started", "running"} and kicks.count("started") <= 1, kicks
    db = core_db.build(path=path)
    try:
        assert meta(db, T.META_REFRESH_LOCK) is None
        assert meta(db, T.META_LAST_RSS_AT) is not None
        row = db.query_one("SELECT COUNT(*) AS n FROM videos")
        assert row is not None and row["n"] == n * 3
    finally:
        db.close()
