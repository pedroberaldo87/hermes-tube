"""``core/refresh.py``: ``VideoStore`` and ``Refresher`` (core, no routes).

Real database (``core/db.py`` in ``tmp_path``) + fakes for the other services. The cross-process
proofs use ``multiprocessing`` with ``spawn`` + a barrier.
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import multiprocessing as mp
import sys
import threading
import time
import types
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TESTS = Path(__file__).resolve().parent
if "tube_pkg" not in sys.modules:  # a multiprocessing child (spawn) does not load the conftest
    _spec = importlib.util.spec_from_file_location(
        "_tube_bootstrap_refresh", ROOT / "plugin" / "_bootstrap.py"
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
from fakes import FakeClock, FakeEventSink, FakeSettings, FakeYouTube, build_fake_world  # noqa: E402
from fakes import seed_world as _seed  # noqa: E402

from tube_pkg.core import db as core_db  # noqa: E402
from tube_pkg.core import refresh as R  # noqa: E402
from tube_pkg.core import types as T  # noqa: E402

DAY = 86_400
WEEK = 7 * DAY


# --------------------------------------------------------------------------- helpers


def cid(n: int) -> str:
    """Valid channel id (``UC`` + 22)."""
    return f"UCb02chan{n:015d}"


def vid(n: int, j: int) -> str:
    """Valid video id (11 characters)."""
    return f"v{n:06d}_{j:03d}"


def insert_channels(
    db: Any,
    ids: Sequence[str],
    *,
    relation: str = "subscribed",
    now: int = 0,
    favorite: bool = False,
    folder_id: str | None = None,
) -> None:
    """Seeds ``channels`` directly in SQL (test setup; in production only the channel service)."""
    db.executemany(
        "INSERT INTO channels (id, title, relation, source, added_at, favorite, folder_id)"
        " VALUES (?, ?, ?, 'extension', ?, ?, ?)",
        [(c, f"Canal {c[-4:]}", relation, now, int(favorite), folder_id) for c in ids],
    )


def make_feed(
    channel: str, n: int, *, now: int, count: int = 15, step: int = DAY, shorts: Sequence[int] = ()
) -> T.RssFeed:
    videos = tuple(
        T.VideoIn(
            id=vid(n, j),
            channel_id=channel,
            title=f"Vídeo {j} do canal {n}",
            published_at=now - j * step - 3600,
            description=f"descrição {j}",
            channel_title=f"Canal {n}",
            views=1000 + j,
            is_short=True if j in shorts else None,
        )
        for j in range(count)
    )
    return T.RssFeed(channel=T.ChannelInfo(id=channel, title=f"Canal {n}"), videos=videos)


class CountingYouTube(FakeYouTube):
    """``FakeYouTube`` that measures concurrency and can delay/block ``fetch_channel_rss``."""

    def __init__(self, delay: float = 0.0) -> None:
        super().__init__()
        self.delay = delay
        self.in_flight = 0
        self.max_in_flight = 0
        self.gate: threading.Event | None = None
        self.entered = threading.Event()
        self.on_fetch: Any = None
        self._mx = threading.Lock()

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        with self._mx:
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            self.entered.set()
            if self.gate is not None:
                self.gate.wait(10)
            if self.delay:
                time.sleep(self.delay)
            if self.on_fetch is not None:
                self.on_fetch(channel_id)
            with self._mx:
                return super().fetch_channel_rss(channel_id)
        finally:
            with self._mx:
                self.in_flight -= 1


def make_refresher(world: Any, **kw: Any) -> Any:
    deps = dict(
        db=world.db,
        settings=world.settings,
        youtube=world.youtube,
        channels=world.channels,
        video_store=kw.pop("video_store", None)
        or R.build_video_store(db=world.db, settings=world.settings, clock=world.clock),
        feed=world.feed,
        events=world.events,
        changelog=world.changelog,
        ext_endpoint_up=world.ext_endpoint_up,
        clock=world.clock,
    )
    deps.update(kw)
    deps.setdefault("cold_start_pages", 0)  # cold start has its own test
    return R.Refresher(**deps)


def wait_idle(ref: Any, timeout: float = 10.0) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if not ref.is_running():
            return
        time.sleep(0.01)
    raise AssertionError("cycle did not finish")


def count(db: Any, sql: str, params: Any = ()) -> int:
    row = db.query_one(sql, params)
    assert row is not None
    return int(next(iter(row.values())))


def meta(db: Any, key: str) -> str | None:
    row = db.query_one("SELECT value FROM meta WHERE key = ?", (key,))
    return row["value"] if row else None


def set_meta(db: Any, key: str, value: str) -> None:
    db.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


@pytest.fixture
def yt() -> CountingYouTube:
    return CountingYouTube()


@pytest.fixture
def w(db: Any, clock: FakeClock, yt: CountingYouTube) -> Any:
    """World of fakes on the real database with ``CountingYouTube``."""
    return build_fake_world(db, clock=clock, youtube=yt)


# --------------------------------------------------------------------------- contract


def test_build_signatures_match_contract() -> None:
    assert T.BUILD_SIGNATURES["plugin/core/refresh.py:build_video_store"] == (
        "build_video_store(*, db, settings, clock=None) -> VideoStore"
    )
    assert T.BUILD_SIGNATURES["plugin/core/refresh.py:build"] == (
        "build(*, db, settings, youtube, channels, video_store, feed, events, changelog,"
        " ext_endpoint_up, clock=None) -> Refresher"
    )
    for fn, names in (
        (R.build_video_store, ["db", "settings", "clock"]),
        (
            R.build,
            [
                "db",
                "settings",
                "youtube",
                "channels",
                "video_store",
                "feed",
                "events",
                "changelog",
                "ext_endpoint_up",
                "clock",
            ],
        ),
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
        if klass in (object,) or not getattr(klass, "_is_protocol", False):
            continue
        names |= {n for n, v in vars(klass).items() if not n.startswith("_") and callable(v)}
    return sorted(names)


@pytest.mark.parametrize(
    ("proto", "impl"), [("VideoStore", "VideoStore"), ("Refresher", "Refresher")]
)
def test_methods_match_protocol(proto: str, impl: str) -> None:
    """Same parameters as the ``Protocol``; extras only at the end, keyword-only, with a default."""
    protocol = getattr(T, proto)
    cls = getattr(R, impl)
    for name in _protocol_methods(protocol):
        want = _shape(getattr(protocol, name))
        got = _shape(getattr(cls, name))
        assert got[: len(want)] == want, name
        for extra in got[len(want) :]:
            assert extra[1] is inspect.Parameter.KEYWORD_ONLY, (name, extra)
            assert extra[2] is not inspect.Parameter.empty, (name, extra)


def test_build_is_inert_and_satisfies_protocols(w: Any, yt: CountingYouTube) -> None:
    before = threading.active_count()
    store = R.build_video_store(db=w.db, settings=w.settings)
    ref = R.build(
        db=w.db,
        settings=w.settings,
        youtube=yt,
        channels=w.channels,
        video_store=store,
        feed=w.feed,
        events=w.events,
        changelog=w.changelog,
        ext_endpoint_up=w.ext_endpoint_up,
    )
    assert isinstance(store, T.VideoStore)
    assert isinstance(ref, T.Refresher)
    assert isinstance(ref, T.Undoable)
    assert threading.active_count() == before
    assert yt.calls == []


def test_core_never_reads_environment_for_paths() -> None:
    source = Path(R.__file__).read_text(encoding="utf-8")
    for forbidden in ("os.environ", "getenv", "HERMES_HOME", "TUBE_DB_PATH", "from plugin"):
        assert forbidden not in source, forbidden


# --------------------------------------------------------------------------- VideoStore


def _vin(**kw: Any) -> T.VideoIn:
    base = dict(id="abcdefghijk", channel_id=cid(1), title="Título", published_at=1000)
    base.update(kw)
    return T.VideoIn(**base)


def test_upsert_first_origin_and_first_seen_win(db: Any, clock: FakeClock) -> None:
    store = R.build_video_store(db=db, settings=FakeSettings(), clock=clock)
    first = clock.now()
    assert store.upsert([_vin()], T.VideoOrigin.search) == T.UpsertCount(inserted=1, updated=0)
    clock.advance(3600)
    res = store.upsert([_vin(title="Título novo")], T.VideoOrigin.rss)
    assert res == T.UpsertCount(inserted=0, updated=1)
    v = store.get(["abcdefghijk"])["abcdefghijk"]
    assert v.origin is T.VideoOrigin.search
    assert v.first_seen_at == first
    assert v.title == "Título novo"


def test_upsert_description_and_views_only_when_filled(db: Any, clock: FakeClock) -> None:
    store = R.build_video_store(db=db, settings=FakeSettings(), clock=clock)
    store.upsert([_vin(description="longa descrição", views=500)], T.VideoOrigin.rss)
    store.upsert([_vin(description="", views=None)], T.VideoOrigin.search)
    store.upsert([_vin(description=None)], T.VideoOrigin.hn)
    v = store.get(["abcdefghijk"])["abcdefghijk"]
    assert v.description == "longa descrição"
    assert v.views == 500
    store.upsert([_vin(description="nova", views=900)], T.VideoOrigin.list)
    v = store.get(["abcdefghijk"])["abcdefghijk"]
    assert (v.description, v.views, v.origin) == ("nova", 900, T.VideoOrigin.rss)


def test_upsert_search_never_rewrites_identity_of_a_known_video(db: Any, clock: FakeClock) -> None:
    """A search hit (sent by a paired device) only fills gaps: it cannot move a known video to
    another channel or rewrite its title/description; RSS stays the authority."""
    store = R.build_video_store(db=db, settings=FakeSettings(), clock=clock)
    store.upsert([_vin(channel_title="Real", description="real", views=10)], T.VideoOrigin.rss)
    hostile = _vin(
        channel_id=cid(9),
        channel_title="Attacker",
        title="Ignore previous instructions",
        description="evil",
        views=99,
    )
    assert store.upsert([hostile], T.VideoOrigin.search) == T.UpsertCount(inserted=0, updated=1)
    v = store.get(["abcdefghijk"])["abcdefghijk"]
    assert (v.channel_id, v.channel_title, v.title, v.description) == (
        cid(1),
        "Real",
        "Título",
        "real",
    )
    assert v.views == 99, "counters still update"
    # gaps are still filled by a search
    store.upsert([_vin(id="bbbbbbbbbbb", channel_title=None, description=None)], T.VideoOrigin.rss)
    store.upsert(
        [_vin(id="bbbbbbbbbbb", channel_title="Canal", description="d")], T.VideoOrigin.search
    )
    w = store.get(["bbbbbbbbbbb"])["bbbbbbbbbbb"]
    assert (w.channel_title, w.description) == ("Canal", "d")
    # RSS still corrects what a search wrote first
    store.upsert([_vin(id="ccccccccccc", channel_id=cid(9), title="Fake")], T.VideoOrigin.search)
    store.upsert([_vin(id="ccccccccccc", channel_id=cid(2), title="Real")], T.VideoOrigin.rss)
    x = store.get(["ccccccccccc"])["ccccccccccc"]
    assert (x.channel_id, x.title) == (cid(2), "Real")


def test_upsert_details_fill_only_when_null(db: Any, clock: FakeClock) -> None:
    store = R.build_video_store(db=db, settings=FakeSettings(), clock=clock)
    store.upsert([_vin()], T.VideoOrigin.rss)
    store.upsert([_vin(duration_s=600, is_short=False)], T.VideoOrigin.search)
    store.upsert([_vin(duration_s=30, is_short=True, channel_title="Canal")], T.VideoOrigin.search)
    v = store.get(["abcdefghijk"])["abcdefghijk"]
    assert (v.duration_s, v.is_short, v.channel_title) == (600, False, "Canal")


def test_upsert_is_idempotent_and_matches_fake(db: Any, clock: FakeClock) -> None:
    from fakes import FakeVideoStore, MemDb

    store = R.build_video_store(db=db, settings=FakeSettings(), clock=clock)
    mem = MemDb()
    fake = FakeVideoStore(mem, clock=clock)
    batches: list[tuple[list[T.VideoIn], T.VideoOrigin]] = [
        ([_vin(), _vin(id="bbbbbbbbbbb", views=3)], T.VideoOrigin.rss),
        ([_vin(description="d", views=7, duration_s=60)], T.VideoOrigin.hn),
        ([_vin(id="bbbbbbbbbbb", title="", is_short=True)], T.VideoOrigin.list),
        ([_vin(description="d", views=7, duration_s=60)], T.VideoOrigin.hn),
    ]
    for videos, origin in batches:
        assert store.upsert(videos, origin) == fake.upsert(videos, origin)
    ids = ["abcdefghijk", "bbbbbbbbbbb"]
    assert store.get(ids) == fake.get(ids)
    assert store.upsert(batches[0][0], T.VideoOrigin.rss) == T.UpsertCount(0, 0)
    assert count(db, "SELECT COUNT(*) FROM videos") == 2


def test_upsert_skips_invalid_ids_and_accepts_text_origin(db: Any, clock: FakeClock) -> None:
    store = R.build_video_store(db=db, settings=FakeSettings(), clock=clock)
    res = store.upsert([_vin(id="curto"), _vin(id="x" * 12), _vin()], "rss")  # type: ignore[arg-type]
    assert res == T.UpsertCount(inserted=1, updated=0)
    with pytest.raises(T.ValidationError):
        store.upsert([_vin()], "feed")  # type: ignore[arg-type]


def test_set_details_and_get(db: Any, clock: FakeClock) -> None:
    store = R.build_video_store(db=db, settings=FakeSettings(), clock=clock)
    store.upsert([_vin(duration_s=10)], T.VideoOrigin.rss)
    store.set_details("abcdefghijk", 700, None)
    store.set_details("abcdefghijk", None, True)
    v = store.get(["abcdefghijk", "naoexiste00"])
    assert list(v) == ["abcdefghijk"]
    assert (v["abcdefghijk"].duration_s, v["abcdefghijk"].is_short) == (700, True)
    with pytest.raises(T.NotFound):
        store.set_details("naoexiste00", 1, None)
    with pytest.raises(T.ValidationError):
        store.set_details("abcdefghijk", -5, None)
    assert store.get([]) == {}


# --------------------------------------------------------------------------- refresh_all


def _world_400(w: Any, yt: CountingYouTube) -> list[str]:
    now = w.clock.now()
    ids = [cid(n) for n in range(400)]
    insert_channels(w.db, ids, now=now)
    for n, c in enumerate(ids):
        yt.add_rss(make_feed(c, n, now=now, shorts=(0,) if n % 2 else ()))
    return ids


def test_refresh_all_400_channels(w: Any, yt: CountingYouTube) -> None:
    ids = _world_400(w, yt)
    yt.delay = 0.002
    progress: list[T.Progress] = []
    ref = make_refresher(w, shorts_per_cycle=0)
    report = ref.refresh_all(on_progress=progress.append)
    assert report.channels == 400
    assert report.new_videos == 400 * 15
    assert dict(report.errors) == {}
    assert report.partial is False
    assert count(w.db, "SELECT COUNT(*) FROM videos") == 6000
    assert count(w.db, "SELECT COUNT(*) FROM videos WHERE origin = 'rss'") == 6000
    assert 1 < yt.max_in_flight <= 4
    assert progress[-1].done == progress[-1].total == 400
    # watermarks on first sight: "the last 7 days count as new" (MyTube)
    assert count(w.db, "SELECT COUNT(*) FROM watermarks") == 400
    assert count(w.db, "SELECT COUNT(DISTINCT seen_up_to) FROM watermarks") == 1
    assert w.db.query_one("SELECT seen_up_to FROM watermarks")["seen_up_to"] == w.clock.now() - WEEK
    # statistics through the (fake) ChannelService
    ch1 = w.channels.get(ids[1])
    assert ch1.last_video_at == w.clock.now() - 3600
    assert ch1.videos_per_week == pytest.approx(15 / (14 + 1 / 24) * 7, rel=0.01)
    assert ch1.shorts_ratio == pytest.approx(1 / 15)
    assert w.channels.get(ids[0]).shorts_ratio == 0
    assert ref.last_rss_at() == w.clock.now()
    assert meta(w.db, T.META_REFRESH_LOCK) is None
    assert w.events.names() == ["refresh.done"]
    assert w.events.events[0][1]["new_videos"] == 6000


def test_rerun_does_not_duplicate(w: Any, yt: CountingYouTube) -> None:
    _world_400(w, yt)
    ref = make_refresher(w, shorts_per_cycle=0)
    ref.refresh_all()
    marks = w.db.query("SELECT * FROM watermarks ORDER BY channel_id")
    w.clock.advance(3600)
    again = ref.refresh_all()
    assert again.new_videos == 0
    assert count(w.db, "SELECT COUNT(*) FROM videos") == 6000
    assert w.db.query("SELECT * FROM watermarks ORDER BY channel_id") == marks
    assert ref.last_rss_at() == w.clock.now()


def test_refresh_only_active_channels_and_collects_errors(w: Any, yt: CountingYouTube) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1), cid(2)], now=now)
    insert_channels(w.db, [cid(3)], relation="followed", now=now)
    insert_channels(w.db, [cid(4)], relation="ex", now=now)
    insert_channels(w.db, [cid(5)], relation="ignored", now=now)
    for n in (1, 3, 4, 5):
        yt.add_rss(make_feed(cid(n), n, now=now, count=3))
    yt.fail("fetch_channel_rss", cid(2), T.YouTubeError("RSS is down"))
    report = make_refresher(w).refresh_all()
    fetched = {a for m, a in yt.calls if m == "fetch_channel_rss"}
    assert fetched == {cid(1), cid(2), cid(3)}
    assert report.channels == 3
    assert report.new_videos == 6
    assert dict(report.errors) == {cid(2): "RSS is down"}
    assert count(w.db, "SELECT COUNT(*) FROM watermarks") == 2


def test_refresh_all_timeout_is_partial_and_releases_lock(w: Any, yt: CountingYouTube) -> None:
    now = w.clock.now()
    ids = [cid(n) for n in range(40)]
    insert_channels(w.db, ids, now=now)
    for n, c in enumerate(ids):
        yt.add_rss(make_feed(c, n, now=now, count=2))
    yt.delay = 0.05
    ref = make_refresher(w)
    t0 = time.monotonic()
    report = ref.refresh_all(timeout=0.2)
    assert time.monotonic() - t0 < 2
    assert report.partial is True
    assert 0 < count(w.db, "SELECT COUNT(*) FROM videos") < 80
    assert not ref.is_running()
    assert meta(w.db, T.META_REFRESH_LOCK) is None


def test_refresh_all_busy_when_other_owner_holds_lock(w: Any) -> None:
    lock = {"owner": "outro", "expires_at": w.clock.now() + 60}
    set_meta(w.db, T.META_REFRESH_LOCK, json.dumps(lock))
    ref = make_refresher(w)
    assert ref.is_running()
    with pytest.raises(T.Busy):
        ref.refresh_all()
    assert json.loads(meta(w.db, T.META_REFRESH_LOCK) or "{}")["owner"] == "outro"


def test_lock_is_renewed_during_long_cycle(w: Any, yt: CountingYouTube) -> None:
    """Cycle longer than the lock deadline: the owner renews; nobody takes over midway."""
    now = w.clock.now()
    ids = [cid(n) for n in range(12)]
    insert_channels(w.db, ids, now=now)
    for n, c in enumerate(ids):
        yt.add_rss(make_feed(c, n, now=now, count=1))
    other = make_refresher(w)
    seen: list[str] = []

    def tick(_c: str) -> None:
        w.clock.advance(5)  # 12 × 5 s = 60 s > 20 s deadline
        seen.append(other.kick_if_due(force=True))

    yt.on_fetch = tick
    ref = make_refresher(w, lease_s=20, workers=1)
    report = ref.refresh_all()
    assert report.partial is False and report.channels == 12
    assert set(seen) == {"running"}


# --------------------------------------------------------------------------- kick_if_due


def test_kick_started_running_skipped_force(w: Any, yt: CountingYouTube) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1)], now=now)
    yt.add_rss(make_feed(cid(1), 1, now=now, count=2))
    yt.gate = threading.Event()
    ref = make_refresher(w)
    t0 = time.perf_counter()
    assert ref.kick_if_due() == "started"
    assert time.perf_counter() - t0 < fast_budget()
    assert yt.entered.wait(5)
    assert ref.is_running()
    assert ref.kick_if_due() == "running"
    assert ref.kick_if_due(force=True) == "running"
    assert ref.status().refresh_running is True
    yt.gate.set()
    wait_idle(ref)
    assert ref.last_rss_at() == now
    assert ref.kick_if_due() == "skipped"
    w.clock.advance(29 * 60)
    assert ref.kick_if_due() == "skipped"
    w.clock.advance(60)
    assert ref.kick_if_due(wait=True) == "started"
    assert ref.kick_if_due(force=True, wait=True) == "started"
    fetches = [a for m, a in yt.calls if m == "fetch_channel_rss"]
    assert len(fetches) == 3
    assert count(w.db, "SELECT COUNT(*) FROM videos") == 2


def test_kick_runs_early_for_channels_no_cycle_has_seen(w: Any, yt: CountingYouTube) -> None:
    """Measured live: the 1st query with zero channels stores ``last_rss_at``; the demo loaded right
    after must not wait 30 min."""
    now = w.clock.now()
    ref = make_refresher(w)
    assert ref.kick_if_due(wait=True) == "started"  # zero channels: only stamps the time
    assert ref.kick_if_due() == "skipped"
    insert_channels(w.db, [cid(1), cid(2)], now=now)
    yt.add_rss(make_feed(cid(1), 1, now=now, count=2))
    yt.add_rss(make_feed(cid(2), 2, now=now, count=3))
    w.clock.advance(R.COLD_RETRY_S - 1)
    assert ref.kick_if_due() == "skipped"  # short slack against bursts
    w.clock.advance(1)
    assert ref.kick_if_due(wait=True) == "started"
    assert count(w.db, "SELECT COUNT(*) FROM videos") == 5
    w.clock.advance(R.COLD_RETRY_S + 60)
    assert ref.kick_if_due() == "skipped"  # all seen: the normal interval applies again


def test_channel_that_only_fails_does_not_keep_the_cycle_spinning(
    w: Any, yt: CountingYouTube
) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1), cid(2)], now=now)
    yt.add_rss(make_feed(cid(1), 1, now=now, count=1))  # cid(2) without a feed: always fails
    ref = make_refresher(w)
    assert ref.kick_if_due(wait=True) == "started"
    before = len([a for m, a in yt.calls if m == "fetch_channel_rss"])
    for _ in range(5):
        w.clock.advance(R.COLD_RETRY_S + 1)
        assert ref.kick_if_due(wait=True) == "skipped"
    assert len([a for m, a in yt.calls if m == "fetch_channel_rss"]) == before


def test_channel_being_fetched_by_kick_channel_does_not_trigger_a_full_cycle(
    w: Any, yt: CountingYouTube
) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1)], now=now)
    yt.add_rss(make_feed(cid(1), 1, now=now, count=1))
    ref = make_refresher(w)
    assert ref.kick_if_due(wait=True) == "started"
    insert_channels(w.db, [cid(2)], now=now)
    yt.add_rss(make_feed(cid(2), 2, now=now, count=1))
    yt.entered.clear()
    yt.gate = threading.Event()
    assert ref.kick_channel(cid(2)) == "started"
    assert yt.entered.wait(5)
    w.clock.advance(R.COLD_RETRY_S + 1)
    assert ref.kick_if_due() == "skipped"  # the new channel is already being fetched
    yt.gate.set()
    deadline = time.monotonic() + 10
    while count(w.db, "SELECT COUNT(*) FROM videos") < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    wait_idle(ref)
    w.clock.advance(R.COLD_RETRY_S + 1)
    assert ref.kick_if_due() == "skipped"  # and once fetched, it has been seen


def test_kick_respects_rss_interval_setting(w: Any, yt: CountingYouTube) -> None:
    w.settings.set("rss_interval_min", 5)
    ref = make_refresher(w)
    assert ref.kick_if_due(wait=True) == "started"
    w.clock.advance(5 * 60)
    assert ref.kick_if_due(wait=True) == "started"


def test_dead_owner_lock_expires_and_other_takes_over(w: Any) -> None:
    ref = make_refresher(w)
    set_meta(
        w.db, T.META_REFRESH_LOCK, json.dumps({"owner": "morto", "expires_at": w.clock.now() + 30})
    )
    assert ref.kick_if_due(force=True) == "running"
    w.clock.advance(31)
    assert not ref.is_running()
    assert ref.kick_if_due(wait=True) == "started"
    assert meta(w.db, T.META_REFRESH_LOCK) is None


def test_corrupt_lock_is_ignored(w: Any) -> None:
    set_meta(w.db, T.META_REFRESH_LOCK, "{nao é json")
    ref = make_refresher(w)
    assert not ref.is_running()
    assert ref.kick_if_due(wait=True) == "started"


def test_kick_thread_crash_releases_lock(w: Any, yt: CountingYouTube, monkeypatch: Any) -> None:
    ref = make_refresher(w)

    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("bug")

    monkeypatch.setattr(ref, "_active_channel_ids", boom)
    assert ref.kick_if_due() == "started"
    wait_idle(ref)
    assert meta(w.db, T.META_REFRESH_LOCK) is None


def test_kick_thread_carries_context(w: Any, yt: CountingYouTube) -> None:
    """The thread starts with the caller's context (gateway profile via contextvar)."""
    import contextvars

    var: contextvars.ContextVar[str] = contextvars.ContextVar("perfil", default="lançamento")
    seen: list[str] = []
    now = w.clock.now()
    insert_channels(w.db, [cid(1)], now=now)
    yt.add_rss(make_feed(cid(1), 1, now=now, count=1))
    yt.on_fetch = lambda _c: seen.append(var.get())
    var.set("perfil-dev")
    ref = make_refresher(w)
    assert ref.kick_if_due() == "started"
    wait_idle(ref)
    assert seen == ["perfil-dev"]


# --------------------------------------------------------------------------- one channel


def test_refresh_channel_and_kick_channel(w: Any, yt: CountingYouTube) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1)], now=now)
    yt.add_rss(make_feed(cid(1), 1, now=now, count=4))
    ref = make_refresher(w)
    report = ref.refresh_channel(cid(1))
    assert (report.channels, report.new_videos) == (1, 4)
    assert ref.last_rss_at() is None  # only a full cycle stores last_rss_at
    assert count(w.db, "SELECT COUNT(*) FROM watermarks") == 1
    assert w.events.events[-1] == ("refresh.done", w.events.events[-1][1])
    assert w.events.events[-1][1]["channel_id"] == cid(1)

    yt.add_rss(make_feed(cid(1), 1, now=now + 10, count=6, step=DAY // 2))
    yt.gate = threading.Event()
    assert ref.kick_channel(cid(1)) == "started"
    assert yt.entered.wait(5)
    assert ref.kick_channel(cid(1)) == "running"
    yt.gate.set()
    end = time.monotonic() + 5
    while ref.kick_channel_active(cid(1)) and time.monotonic() < end:
        time.sleep(0.01)
    assert count(w.db, "SELECT COUNT(*) FROM videos") == 6
    with pytest.raises(T.ValidationError):
        ref.kick_channel("nao-e-canal")
    with pytest.raises(T.ValidationError):
        ref.refresh_channel("nao-e-canal")


def test_refresh_channel_unknown_channel_does_not_create_watermark(
    w: Any, yt: CountingYouTube
) -> None:
    yt.add_rss(make_feed(cid(9), 9, now=w.clock.now(), count=2))
    report = make_refresher(w).refresh_channel(cid(9))
    assert report.new_videos == 2
    assert count(w.db, "SELECT COUNT(*) FROM watermarks") == 0


# --------------------------------------------------------------------------- on-demand Short


def test_resolve_shorts_on_demand(w: Any, yt: CountingYouTube) -> None:
    now = w.clock.now()
    store = R.build_video_store(db=w.db, settings=w.settings, clock=w.clock)
    store.upsert(make_feed(cid(1), 1, now=now, count=5, shorts=(0,)).videos, T.VideoOrigin.rss)
    yt.add_short(vid(1, 2))
    ref = make_refresher(w, video_store=store)
    got = ref.resolve_shorts([vid(1, j) for j in range(5)] + ["naoexiste00"], limit=3)
    # vid(1,0) was already a Short from the RSS link: no request
    assert got == {vid(1, 1): False, vid(1, 2): True, vid(1, 3): False}
    asked = [a for m, a in yt.calls if m == "is_short"]
    assert sorted(asked) == [vid(1, 1), vid(1, 2), vid(1, 3)]
    v = store.get([vid(1, 2), vid(1, 4)])
    assert v[vid(1, 2)].is_short is True and v[vid(1, 4)].is_short is None
    yt.fail("is_short", vid(1, 4), T.YouTubeError("consent"))
    assert ref.resolve_shorts([vid(1, 4)]) == {}


def test_cycle_checks_few_recent_new_shorts(w: Any, yt: CountingYouTube) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1), cid(2)], now=now)
    yt.add_rss(make_feed(cid(1), 1, now=now, count=15, shorts=(1,)))
    yt.add_rss(make_feed(cid(2), 2, now=now, count=15))
    yt.add_short(vid(2, 0))
    ref = make_refresher(w, shorts_per_cycle=5)
    ref.refresh_all()
    asked = [a for m, a in yt.calls if m == "is_short"]
    assert len(asked) == 5
    assert vid(1, 1) not in asked  # already known from RSS
    published = {
        r["id"]: r["published_at"] for r in w.db.query("SELECT id, published_at FROM videos")
    }
    assert all(published[a] >= now - WEEK for a in asked)
    assert vid(2, 0) in asked
    assert w.db.query_one("SELECT is_short FROM videos WHERE id = ?", (vid(2, 0),))["is_short"] == 1
    yt.calls.clear()
    ref.refresh_all()
    assert [a for m, a in yt.calls if m == "is_short"] == []  # only new videos of the cycle


# --------------------------------------------------------------------------- mark as read


@pytest.fixture
def seeded(w: Any) -> Any:
    return _seed(w)


def _marks(db: Any) -> dict[str, int]:
    return {r["channel_id"]: r["seen_up_to"] for r in db.query("SELECT * FROM watermarks")}


def test_mark_read_channel(w: Any, seeded: Any) -> None:
    ref = make_refresher(w)
    fire = seeded.channels["fireship"]
    w.clock.advance(60)
    assert ref.mark_read(T.ReadScope(T.ReadScopeKind.channel, fire)) == 1
    assert _marks(w.db)[fire] == w.clock.now()
    assert ref.mark_read(T.ReadScope(T.ReadScopeKind.channel, fire)) == 0
    rec = w.changelog.list()[0]
    assert rec.action is T.ChangeAction.mark_read
    assert rec.undo == T.UndoMarkRead(before={fire: seeded.watermark})
    with pytest.raises(T.NotFound):
        ref.mark_read(T.ReadScope(T.ReadScopeKind.channel, cid(999)))
    with pytest.raises(T.ValidationError):
        ref.mark_read(T.ReadScope(T.ReadScopeKind.channel, None))


def test_mark_read_folder_is_recursive(w: Any, seeded: Any) -> None:
    ref = make_refresher(w)
    before = _marks(w.db)
    w.clock.advance(60)
    n = ref.mark_read(T.ReadScope(T.ReadScopeKind.folder, seeded.folders["Tecnologia"]))
    tech = {seeded.channels[k] for k in ("fireship", "twominute", "aiexplained")}  # IA ⊂ Tecnologia
    tech |= {seeded.channels[k] for k in ("mkbhd", "linus", "verge")}
    assert n == len(tech)
    after = _marks(w.db)
    for c, mark in after.items():
        assert mark == (w.clock.now() if c in tech else before.get(c)), c
    with pytest.raises(T.NotFound):
        ref.mark_read(T.ReadScope(T.ReadScopeKind.folder, "pasta-que-nao-existe"))


def test_mark_read_all_uses_future_publish_date_and_undo(w: Any, seeded: Any) -> None:
    ref = make_refresher(w)
    w.db.execute(
        "UPDATE videos SET published_at = ? WHERE id = ?",
        (w.clock.now() + DAY, seeded.videos["veritasium-new"]),
    )
    before = _marks(w.db)
    n = ref.mark_read(T.ReadScope(T.ReadScopeKind.all))
    active = {
        r["id"]
        for r in w.db.query("SELECT id FROM channels WHERE relation IN ('subscribed', 'followed')")
    }
    assert n == len(active)
    after = _marks(w.db)
    assert after[seeded.channels["veritasium"]] == w.clock.now() + DAY  # scheduled premiere
    assert set(after) == set(before) | active
    rec = w.changelog.list()[0]
    w.refresher = ref
    w.changelog.undo(rec.id, targets=w.targets())
    assert _marks(w.db) == before


def test_apply_undo_refuses_other_actions(w: Any) -> None:
    ref = make_refresher(w)
    rec = T.ChangeRecord(
        id=1,
        ts=0,
        actor=T.Actor.user,
        action=T.ChangeAction.channel_move,
        payload={},
        undo=T.UndoChannelMove(before={}),
    )
    with pytest.raises(T.UndoRefused):
        ref.apply_undo(rec)


# --------------------------------------------------------------------------- status


def test_status_snapshot(w: Any, seeded: Any) -> None:
    ref = make_refresher(w)
    w.ext_up = False
    st = ref.status()
    assert isinstance(st, T.StatusSnapshot)
    counts = w.feed.new_counts()
    assert st.new_total == counts.total > 0
    assert {t.tab_id for t in st.new_by_tab} >= {T.BUILTIN_TAB_ALL_NEW, T.BUILTIN_TAB_FAVORITES}
    assert {t.tab_id: t.count for t in st.new_by_tab}[T.BUILTIN_TAB_ALL_NEW] == counts.by_tab[
        T.BUILTIN_TAB_ALL_NEW
    ]
    fav = {f.channel_id: f for f in st.fav_new}
    assert seeded.channels["fireship"] in fav
    assert fav[seeded.channels["fireship"]].latest_video_id == seeded.short_video
    assert st.ext_endpoint_up is False
    assert st.last_rss_at is None and st.refresh_running is False
    assert (st.queue_pending, st.search_pending, st.devices_online) == (0, 0, 0)
    w.ext_up = True
    set_meta(w.db, T.META_LAST_RSS_AT, str(w.clock.now() - 10))
    now = w.clock.now()
    w.db.execute(
        "INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES"
        " ('d1', 'chrome', 'h1', ?, ?), ('d2', 'velho', 'h2', ?, ?)",
        (now, now - 5, now, now - 3600),
    )
    w.db.execute(
        "INSERT INTO search_jobs (id, batch_id, query, created_at, expires_at)"
        " VALUES ('s1', 'b', 'q', ?, ?), ('s2', 'b', 'q', ?, ?)",
        (now, now + 15, now - 60, now - 45),
    )
    st = ref.status()
    assert st.ext_endpoint_up is True and st.last_rss_at == now - 10
    assert (st.search_pending, st.devices_online) == (1, 1)


def test_status_survives_broken_feed_engine(w: Any) -> None:
    class Broken:
        def new_counts(self) -> T.NewCounts:
            raise RuntimeError("broken feed")

    ref = make_refresher(w, feed=Broken())
    st = ref.status()
    assert st.new_total == 0 and st.new_by_tab == () and st.fav_new == ()


# --------------------------------------------------------------------------- across processes


class SlowYouTube:
    """Minimal ``YouTubeClient`` for the children (no shared state)."""

    def __init__(self, delay: float, hang: Any = None) -> None:
        self.delay = delay
        self.hang = hang
        self.fetched = 0

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        if self.hang is not None:
            self.hang()
        time.sleep(self.delay)
        self.fetched += 1
        n = int(channel_id[-6:])
        return make_feed(channel_id, n, now=int(time.time()), count=3)

    def is_short(self, video_id: str) -> bool:
        return False


def _child_refresher(db_path: str, youtube: Any, **kw: Any) -> Any:
    db = core_db.build(path=db_path)
    world = build_fake_world(db, youtube=youtube, events=FakeEventSink())
    return R.Refresher(
        db=db,
        settings=FakeSettings(),
        youtube=youtube,
        channels=world.channels,
        video_store=R.build_video_store(db=db, settings=world.settings),
        feed=world.feed,
        events=world.events,
        changelog=world.changelog,
        ext_endpoint_up=lambda: True,
        **kw,
    )


def _race_worker(db_path: str, name: str, barrier: Any, out: Any) -> None:
    yt = SlowYouTube(delay=0.02)
    ref = _child_refresher(db_path, yt, shorts_per_cycle=0)
    barrier.wait()
    t0 = time.perf_counter()
    result = ref.kick_if_due(wait=True)
    out.put((name, result, yt.fetched, round(time.perf_counter() - t0, 3)))


def _dying_owner(db_path: str, out: Any) -> None:
    def hang() -> None:
        out.put("locked")
        time.sleep(60)

    ref = _child_refresher(db_path, SlowYouTube(0.0, hang=hang), lease_s=2, workers=1)
    ref.kick_if_due(wait=True)


def _seed_file_db(path: str, n: int) -> None:
    db = core_db.build(path=path)
    try:
        insert_channels(db, [cid(i) for i in range(n)], now=int(time.time()))
    finally:
        db.close()


_SPAWN_TARGET = """
def put_hello(out):
    out.put("hello")
"""


def _spawn_hello(module: Any, *, prepared: bool) -> Any:
    ctx = mp.get_context("spawn")
    out = ctx.Queue()
    proc = ctx.Process(target=module.put_hello, args=(out,))
    if prepared:
        with children_can_import(module.__name__, module.__file__):
            proc.start()
    else:
        proc.start()
    proc.join(30)  # the child either puts and exits or dies on the import
    try:
        return out.get(timeout=2)
    except Exception as exc:  # noqa: BLE001 — queue.Empty: the child died before running
        return type(exc).__name__
    finally:
        if proc.is_alive():
            proc.kill()


def test_spawn_children_import_a_test_module_named_from_the_root(tmp_path: Path) -> None:
    """pytest may import a test module as ``tests.test_x`` without the root on ``sys.path``
    (import mode/root folder): the ``spawn`` child cannot import its target and dies before
    running it. ``children_can_import`` makes the module importable while the children start."""
    pkg = tmp_path / "pkgspawn"
    pkg.mkdir()
    (pkg / "target_mod.py").write_text(_SPAWN_TARGET, encoding="utf-8")
    name = "pkgspawn.target_mod"
    spec = importlib.util.spec_from_file_location(name, pkg / "target_mod.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # what pytest does in that mode: the parent package exists only in this process's sys.modules
    parent = types.ModuleType("pkgspawn")
    parent.__path__ = [str(pkg)]
    sys.modules["pkgspawn"] = parent
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
        assert str(tmp_path) not in sys.path
        assert _spawn_hello(module, prepared=False) == "Empty"  # the failure seen on Linux
        assert _spawn_hello(module, prepared=True) == "hello"
        assert str(tmp_path) not in sys.path, "sys.path is restored after the start"
    finally:
        sys.modules.pop(name, None)
        sys.modules.pop("pkgspawn", None)


def test_lock_allows_one_cycle_across_processes(tmp_path: Path) -> None:
    path = str(tmp_path / "race.db")
    _seed_file_db(path, 20)
    ctx = mp.get_context("spawn")
    barrier, out = ctx.Barrier(4), ctx.Queue()
    procs = [ctx.Process(target=_race_worker, args=(path, f"p{i}", barrier, out)) for i in range(4)]
    with children_can_import(__name__, __file__):
        for p in procs:
            p.start()
    results = [out.get(timeout=45) for _ in procs]
    for p in procs:
        p.join(10)
    outcomes = sorted(r[1] for r in results)
    assert outcomes.count("started") == 1, results
    assert set(outcomes) <= {"started", "running", "skipped"}, results
    assert sum(r[2] for r in results) == 20, results  # a single cycle: 20 channels read once
    losers = [r for r in results if r[1] != "started"]
    assert all(r[3] < 1.0 for r in losers), results  # whoever loses does not wait for the cycle
    db = core_db.build(path=path)
    try:
        assert count(db, "SELECT COUNT(*) FROM videos") == 60
        assert meta(db, T.META_REFRESH_LOCK) is None
        assert meta(db, T.META_LAST_RSS_AT) is not None
    finally:
        db.close()


def test_dead_owner_process_lock_expires_across_processes(tmp_path: Path) -> None:
    path = str(tmp_path / "dead.db")
    _seed_file_db(path, 3)
    ctx = mp.get_context("spawn")
    out = ctx.Queue()
    proc = ctx.Process(target=_dying_owner, args=(path, out))
    with children_can_import(__name__, __file__):
        proc.start()
    try:
        assert out.get(timeout=30) == "locked"
        proc.kill()
        proc.join(10)
    finally:
        if proc.is_alive():
            proc.kill()
    yt = SlowYouTube(0.0)
    ref = _child_refresher(path, yt, shorts_per_cycle=0)
    assert ref.kick_if_due(force=True) == "running"  # the 2 s deadline still holds
    end = time.monotonic() + 10
    while ref.is_running() and time.monotonic() < end:
        time.sleep(0.1)
    assert ref.kick_if_due(force=True, wait=True) == "started"
    assert yt.fetched == 3
    assert ref.db.query_one("SELECT value FROM meta WHERE key = ?", (T.META_REFRESH_LOCK,)) is None
    ref.db.close()


# --------------------------------------------------------------------------- RSS outage


class OutageYouTube(CountingYouTube):
    """``CountingYouTube`` with scripted HTTP: ``rss_status(channel_id, n)`` returns the error
    status of the *n*-th RSS call (``None`` = 200) and ``fetch_channel_uploads`` (fallback) serves
    ``pages`` or fails with ``page_status``. Same ``details`` as the real client."""

    def __init__(self) -> None:
        super().__init__()
        self.rss_status: Any = lambda _c, _n: None
        self.pages: dict[str, T.RssFeed] = {}
        self.page_status: dict[str, int] = {}
        self.page_delay = 0.0
        self._n = 0

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        with self._mx:
            n, self._n = self._n, self._n + 1
        status = self.rss_status(channel_id, n)
        if status is None:
            return super().fetch_channel_rss(channel_id)
        self.calls.append(("fetch_channel_rss", channel_id))
        if self.delay:
            time.sleep(self.delay)
        raise T.YouTubeError(
            f"RSS do canal {channel_id}: HTTP {status}",
            status=status,
            feed_unavailable=True,
            channel_id=channel_id,
        )

    def fetch_channel_uploads(self, channel_id: str) -> T.RssFeed:
        self.calls.append(("fetch_channel_uploads", channel_id))
        if self.page_delay:
            time.sleep(self.page_delay)
        status = self.page_status.get(channel_id)
        if status is not None:
            raise T.YouTubeError(
                f"channel page {channel_id}: HTTP {status}",
                status=status,
                channel_missing=status == 404,
                channel_id=channel_id,
            )
        feed = self.pages.get(channel_id)
        if feed is None:
            raise T.YouTubeError(f"channel page {channel_id}: HTTP 500", status=500)
        return feed

    def rss_calls(self) -> list[str]:
        return [a for m, a in self.calls if m == "fetch_channel_rss"]

    def page_calls(self) -> list[str]:
        return [a for m, a in self.calls if m == "fetch_channel_uploads"]


def make_page_feed(channel: str, n: int, *, now: int, count: int = 15) -> T.RssFeed:
    """Same videos as ``make_feed``, the way the ``/videos`` page would give them: approximate date
    (rounded relative text), known duration, no description."""
    exact = make_feed(channel, n, now=now, count=count)
    videos = tuple(
        replace(v, published_at=(v.published_at or 0) - 5000, description=None, duration_s=600 + j)
        for j, v in enumerate(exact.videos)
    )
    return T.RssFeed(channel=exact.channel, videos=videos)


@pytest.fixture
def out() -> OutageYouTube:
    return OutageYouTube()


@pytest.fixture
def ow(db: Any, clock: FakeClock, out: OutageYouTube) -> Any:
    return build_fake_world(db, clock=clock, youtube=out)


def _outage_world(ow: Any, out: OutageYouTube, n: int, *, page_count: int = 3) -> list[str]:
    now = ow.clock.now()
    ids = [cid(i) for i in range(n)]
    insert_channels(ow.db, ids, now=now)
    for i, c in enumerate(ids):
        out.add_rss(make_feed(c, i, now=now, count=page_count))
        out.pages[c] = make_page_feed(c, i, now=now, count=page_count)
    return ids


def _relations(db: Any) -> dict[str, str]:
    return {r["id"]: r["relation"] for r in db.query("SELECT id, relation FROM channels")}


def _dates(db: Any) -> dict[str, int]:
    return {r["id"]: r["published_at"] for r in db.query("SELECT id, published_at FROM videos")}


def test_outage_all_404_uses_page_fallback_within_budget_in_priority_order(
    ow: Any, out: OutageYouTube
) -> None:
    now = ow.clock.now()
    _outage_world(ow, out, 30)
    ow.db.execute("UPDATE channels SET favorite = 1 WHERE id IN (?, ?)", (cid(20), cid(21)))
    store = R.build_video_store(db=ow.db, settings=ow.settings, clock=ow.clock)
    for i in range(10):  # channels 0..9 already have stored videos (from old cycles)
        store.upsert(make_feed(cid(i), i, now=now - WEEK, count=2).videos, T.VideoOrigin.rss)
    before_videos = count(ow.db, "SELECT COUNT(*) FROM videos")
    relations = _relations(ow.db)
    out.rss_status = lambda _c, _n: 404
    ref = make_refresher(ow, video_store=store, fallback_budget=6, shorts_per_cycle=0)
    report = ref.refresh_all()

    assert len(out.rss_calls()) <= R.OUTAGE_PROBE  # stopped insisting on RSS
    # budget: ⭐ first, then channels with no stored video (ties by id)
    assert out.page_calls() == [cid(20), cid(21), cid(10), cid(11), cid(12), cid(13)]
    assert dict(report.errors) == {}  # those left out of the budget stay as they are
    assert report.partial is False and report.channels == 30
    assert _relations(ow.db) == relations  # nobody became nonexistent or changed relation
    assert count(ow.db, "SELECT COUNT(*) FROM videos") == before_videos + 6 * 3  # nothing deleted
    for c in (cid(20), cid(21), cid(10)):
        rows = ow.db.query("SELECT duration_s, origin FROM videos WHERE channel_id = ?", (c,))
        assert len(rows) == 3 and all(r["duration_s"] for r in rows)
    assert meta(ow.db, R.META_RSS_DOWN_SINCE) == str(now)
    assert meta(ow.db, R.META_RSS_FALLBACK_CHANNELS) == "6"
    assert ref.rss_outage() == {"down_since": now, "fallback_channels": 6}
    assert ref.last_rss_at() == now  # last_rss_at as defined for the refresh cycle
    assert count(ow.db, "SELECT COUNT(*) FROM watermarks") == 6
    # fallback statistics do not make up a Shorts ratio (the page does not list Shorts)
    assert ow.channels.get(cid(20)).shorts_ratio is None
    assert ow.channels.get(cid(20)).last_video_at is not None


def test_outage_retries_sooner_rotates_budget_and_clears_on_first_healthy_cycle(
    ow: Any, out: OutageYouTube
) -> None:
    ids = _outage_world(ow, out, 12)
    out.rss_status = lambda _c, _n: 404
    ref = make_refresher(ow, fallback_budget=4, shorts_per_cycle=0)
    assert ref.kick_if_due(wait=True) == "started"
    first = out.page_calls()
    assert first == ids[:4]
    ow.clock.advance(R.OUTAGE_RETRY_S - 60)
    assert ref.kick_if_due(wait=True) == "skipped"  # does not hammer
    ow.clock.advance(60)
    assert R.OUTAGE_RETRY_S < R.DEFAULT_INTERVAL_MIN * 60
    assert ref.kick_if_due(wait=True) == "started"  # comes back sooner than the 30 min
    second = out.page_calls()[len(first) :]
    assert second == ids[4:8]  # whoever was served recently does not use budget again
    assert ref.rss_outage() == {
        "down_since": ow.clock.now() - R.OUTAGE_RETRY_S,
        "fallback_channels": 8,
    }

    out.rss_status = lambda _c, _n: None  # RSS is back
    ow.clock.advance(R.OUTAGE_RETRY_S)
    pages_before = len(out.page_calls())
    assert ref.kick_if_due(wait=True) == "started"
    assert len(out.page_calls()) == pages_before
    assert ref.rss_outage() is None
    assert meta(ow.db, R.META_RSS_DOWN_SINCE) is None
    assert meta(ow.db, R.META_RSS_FALLBACK_CHANNELS) is None
    ow.clock.advance(R.OUTAGE_RETRY_S)
    assert ref.kick_if_due(wait=True) == "skipped"  # back to the normal grace period


def test_rss_back_overwrites_approximate_dates_without_duplicates(
    ow: Any, out: OutageYouTube
) -> None:
    now = ow.clock.now()
    ids = _outage_world(ow, out, 3, page_count=5)
    out.rss_status = lambda _c, _n: 404
    ref = make_refresher(ow, shorts_per_cycle=0)
    ref.refresh_all()
    approx = _dates(ow.db)
    assert len(approx) == 15
    exact = {v.id: v.published_at for c in ids for v in out.rss[c].videos}
    assert all(approx[v] == exact[v] - 5000 for v in exact)  # approximate, from the fallback

    out.rss_status = lambda _c, _n: None
    ow.clock.advance(60)
    report = ref.refresh_all()
    assert report.new_videos == 0
    assert count(ow.db, "SELECT COUNT(*) FROM videos") == 15  # nothing duplicated
    assert _dates(ow.db) == exact  # RSS overwrote with the exact date
    rows = ow.db.query("SELECT duration_s FROM videos")
    assert all(r["duration_s"] for r in rows)  # the page duration stays

    # new outage: the approximate page date never overwrites the exact one
    out.rss_status = lambda _c, _n: 500
    ow.clock.advance(3600)
    ref.refresh_all()
    assert len(out.page_calls()) == 6
    assert _dates(ow.db) == exact
    assert now  # (clock used above)


def test_single_missing_channel_needs_page_404_to_be_a_channel_error(
    ow: Any, out: OutageYouTube
) -> None:
    ids = _outage_world(ow, out, 10)
    relations = _relations(ow.db)
    out.rss_status = lambda c, _n: 404 if c == cid(3) else (503 if c == cid(4) else None)
    out.page_status[cid(3)] = 404  # channel really deleted: page 404 too
    ref = make_refresher(ow, shorts_per_cycle=0)
    report = ref.refresh_all()
    assert set(report.errors) == {cid(3)}
    assert "does not exist" in report.errors[cid(3)]
    assert sorted(out.page_calls()) == [cid(3), cid(4)]  # RSS 503 alone: the page resolved it
    assert count(ow.db, "SELECT COUNT(*) FROM videos WHERE channel_id = ?", (cid(4),)) == 3
    assert ref.rss_outage() is None  # a single channel is not an RSS outage
    assert _relations(ow.db) == relations  # the core does not touch the relation; it only reports
    # in the next cycle the deleted channel costs no other page (24 h), but the error remains
    ow.clock.advance(3600)
    report = ref.refresh_all()
    assert "does not exist" in report.errors[cid(3)]
    assert out.page_calls().count(cid(3)) == 1
    assert len(ids) == 10


def test_rss_outage_without_plan_b_never_marks_channels_missing(
    w: Any, yt: CountingYouTube
) -> None:
    """Client without ``fetch_channel_uploads`` (old fake): RSS 404 everywhere does not become
    "channel gone", deletes no video, changes no relation."""
    now = w.clock.now()
    ids = [cid(i) for i in range(12)]
    insert_channels(w.db, ids, now=now)
    store = R.build_video_store(db=w.db, settings=w.settings, clock=w.clock)
    store.upsert(make_feed(cid(0), 0, now=now, count=4).videos, T.VideoOrigin.rss)
    relations = _relations(w.db)
    for c in ids:
        yt.fail(
            "fetch_channel_rss", c, T.YouTubeError("HTTP 404", status=404, feed_unavailable=True)
        )
    report = make_refresher(w, video_store=store).refresh_all()
    assert not any("does not exist" in msg for msg in report.errors.values())
    assert _relations(w.db) == relations
    assert count(w.db, "SELECT COUNT(*) FROM videos") == 4
    assert meta(w.db, R.META_RSS_DOWN_SINCE) == str(now)


def test_alternating_404_and_500_is_outage(ow: Any, out: OutageYouTube) -> None:
    _outage_world(ow, out, 40)
    out.rss_status = lambda _c, n: 404 if n % 2 else 500
    ref = make_refresher(ow, fallback_budget=5, shorts_per_cycle=0)
    report = ref.refresh_all()
    assert len(out.rss_calls()) <= R.OUTAGE_PROBE
    assert len(out.page_calls()) == 5
    assert report.errors == {}
    assert ref.rss_outage() is not None


def test_sporadic_200_during_outage_is_kept_and_does_not_end_outage(
    ow: Any, out: OutageYouTube
) -> None:
    ids = _outage_world(ow, out, 40)
    ok_channel: list[str] = []

    def status(c: str, n: int) -> int | None:
        if n == 2:
            ok_channel.append(c)
            return None  # sporadic 200 (public reports of the outage)
        return 404

    out.rss_status = status
    ref = make_refresher(ow, fallback_budget=5, shorts_per_cycle=0)
    ref.refresh_all()
    assert ref.rss_outage() is not None
    (lucky,) = ok_channel
    assert lucky not in out.page_calls()  # already came from RSS, with an exact date
    exact = {v.id: v.published_at for v in out.rss[lucky].videos}
    assert {k: v for k, v in _dates(ow.db).items() if k in exact} == exact
    assert len(out.page_calls()) == 5
    assert len(ids) == 40


def test_outage_detected_mid_cycle_stops_rss(ow: Any, out: OutageYouTube) -> None:
    _outage_world(ow, out, 60)
    out.rss_status = lambda _c, n: 404 if n >= 16 else None
    ref = make_refresher(ow, fallback_budget=3, shorts_per_cycle=0)
    ref.refresh_all()
    assert len(out.rss_calls()) <= 16 + R.OUTAGE_PROBE + ref.workers
    assert len(out.page_calls()) == 3
    assert ref.rss_outage() is not None


def test_400_channels_with_rss_down_respect_page_budget_and_deadline(
    ow: Any, out: OutageYouTube
) -> None:
    _outage_world(ow, out, 400)
    out.rss_status = lambda _c, _n: 404
    out.delay = 0.01
    out.page_delay = 0.02
    ref = make_refresher(ow, shorts_per_cycle=0)
    t0 = time.monotonic()
    report = ref.refresh_all(timeout=R.CYCLE_TIMEOUT_S)
    elapsed = time.monotonic() - t0
    assert len(out.page_calls()) <= R.FALLBACK_PAGES_PER_CYCLE
    assert len(out.page_calls()) == R.FALLBACK_PAGES_PER_CYCLE  # budget fully used
    assert len(out.rss_calls()) <= R.OUTAGE_PROBE
    assert report.partial is False and report.channels == 400
    assert elapsed < 5.0  # well within the cycle deadline (CYCLE_TIMEOUT_S = 600 s)
    assert meta(ow.db, R.META_RSS_FALLBACK_CHANNELS) == str(R.FALLBACK_PAGES_PER_CYCLE)


@pytest.mark.parametrize("status", [404, 500, 503])
def test_refresh_channel_falls_back_to_page_at_once(
    ow: Any, out: OutageYouTube, status: int
) -> None:
    """Rule 6: the first channel added shows videos even with RSS down."""
    _outage_world(ow, out, 1, page_count=5)
    out.rss_status = lambda _c, _n: status
    ref = make_refresher(ow)
    report = ref.refresh_channel(cid(0))
    assert report.errors == {} and report.new_videos == 5
    assert out.page_calls() == [cid(0)]
    assert count(ow.db, "SELECT COUNT(*) FROM videos WHERE channel_id = ?", (cid(0),)) == 5
    assert ref.rss_outage() is None  # one channel does not declare an RSS outage
    assert ref.last_rss_at() is None


def test_refresh_channel_page_404_is_missing_and_network_error_is_not_fallback(
    ow: Any, out: OutageYouTube
) -> None:
    _outage_world(ow, out, 2)
    out.rss_status = lambda c, _n: 404 if c == cid(0) else None
    out.page_status[cid(0)] = 404
    ref = make_refresher(ow)
    report = ref.refresh_channel(cid(0))
    assert "does not exist" in report.errors[cid(0)]
    # the person asked again: checks the page once more (without the 24 h cycle grace period)
    ref.refresh_channel(cid(0))
    assert out.page_calls() == [cid(0), cid(0)]
    # an error without an HTTP status (network) is not an RSS outage: no fallback
    out.fail("fetch_channel_rss", cid(1), T.YouTubeError("timeout", reason="timeout"))
    report = ref.refresh_channel(cid(1))
    assert report.errors == {cid(1): "timeout"}
    assert cid(1) not in out.page_calls()


def test_real_client_over_fake_http_survives_rss_outage_and_recovers(
    db: Any, clock: FakeClock
) -> None:
    """End to end with the real client (``core/youtube.py`` + ``core/http.Client``) over fake HTTP
    and the saved pages: RSS 404/500 everywhere → fallback; RSS back → exact dates."""
    from tube_pkg.core import http as H
    from tube_pkg.core import youtube as Y

    fix = TESTS / "fixtures" / "youtube"
    fireship, veritasium = "UCsBjURrPoezykLs9EqgamOA", "UCHnyfMqiRRG1u-2MsSQLbXA"
    rss_files = {fireship: "rss/fireship.xml", veritasium: "rss/veritasium.xml"}
    rss_status: dict[str, int | None] = {"value": 404}
    hits: list[str] = []

    def transport(req: Any) -> T.HttpResponse:
        hits.append(req.url)
        path = req.url.split("?", 1)[0]
        for channel, rel in rss_files.items():
            if path.endswith("/feeds/videos.xml") and channel in req.url:
                if rss_status["value"] is not None:
                    return T.HttpResponse(rss_status["value"], req.url, {}, b"<html>x</html>")
                return T.HttpResponse(200, req.url, {}, (fix / rel).read_bytes())
            if path.endswith(f"/channel/{channel}/videos"):
                body = (fix / f"channel_videos.{channel}.html").read_bytes()
                return T.HttpResponse(200, req.url, {"content-type": "text/html"}, body)
        return T.HttpResponse(404, req.url, {}, b"")

    settings = FakeSettings()
    client = Y.build(
        http=H.Client(settings=settings, transport=transport, sleep=lambda _s: None),
        settings=settings,
        clock=clock,
    )
    world = build_fake_world(db, clock=clock, youtube=client)
    insert_channels(db, [fireship, veritasium], now=clock.now())
    ref = make_refresher(world, shorts_per_cycle=0)

    report = ref.refresh_all()
    assert report.errors == {}
    assert ref.rss_outage() == {"down_since": clock.now(), "fallback_channels": 2}
    page_dates = _dates(db)
    assert len(page_dates) == 2 * 15
    assert count(db, "SELECT COUNT(*) FROM videos WHERE duration_s IS NOT NULL") == 30
    assert sum(1 for u in hits if u.split("?", 1)[0].endswith("/videos")) == 2

    rss_status["value"] = 500  # 404 and 500 alternating: still down, no page again (< 30 min)
    clock.advance(R.OUTAGE_RETRY_S)
    ref.refresh_all()
    assert ref.rss_outage() is not None
    assert _dates(db) == page_dates

    rss_status["value"] = None  # RSS is back
    clock.advance(R.OUTAGE_RETRY_S)
    report = ref.refresh_all()
    assert report.errors == {}
    assert ref.rss_outage() is None
    exact = {v.id: v.published_at for c in rss_files for v in client.fetch_channel_rss(c).videos}
    dates = _dates(db)
    assert len(dates) == len(set(page_dates) | set(exact))  # no duplicates
    common = set(page_dates) & set(exact)
    assert common  # same videos from both sources
    assert all(dates[v] == exact[v] for v in exact)  # the exact date won
    assert any(page_dates[v] != exact[v] for v in common)


def test_kick_channel_uses_plan_b(ow: Any, out: OutageYouTube) -> None:
    _outage_world(ow, out, 1, page_count=4)
    out.rss_status = lambda _c, _n: 404
    ref = make_refresher(ow)
    assert ref.kick_channel(cid(0)) == "started"
    end = time.monotonic() + 5
    while ref.kick_channel_active(cid(0)) and time.monotonic() < end:
        time.sleep(0.01)
    assert count(ow.db, "SELECT COUNT(*) FROM videos") == 4


def test_feed_rows_keep_channel_id_from_feed(w: Any, yt: CountingYouTube) -> None:
    """An RSS video without ``channel_id`` inherits the feed channel."""
    now = w.clock.now()
    insert_channels(w.db, [cid(1)], now=now)
    feed = make_feed(cid(1), 1, now=now, count=2)
    feed = replace(feed, videos=tuple(replace(v, channel_id="") for v in feed.videos))
    yt.add_rss(feed)
    make_refresher(w).refresh_all()
    assert {r["channel_id"] for r in w.db.query("SELECT channel_id FROM videos")} == {cid(1)}


def test_cold_start_serves_every_empty_channel_up_to_the_cap(ow: Any, out: OutageYouTube) -> None:
    """Fresh install during the outage (40-channel demo): all get videos in the 1st cycle."""
    _outage_world(ow, out, 40)
    out.rss_status = lambda _c, _n: 404
    ref = make_refresher(ow, shorts_per_cycle=0, cold_start_pages=R.COLD_START_PAGES)
    report = ref.refresh_all()
    assert len(out.page_calls()) == 40
    assert dict(report.errors) == {}
    assert count(ow.db, "SELECT COUNT(DISTINCT channel_id) FROM videos") == 40
    snap = ref.status()
    assert snap.rss_down_since is not None and snap.rss_fallback_channels == 40


def test_cold_start_is_capped_and_ends_when_channels_have_videos(
    ow: Any, out: OutageYouTube
) -> None:
    now = ow.clock.now()
    ids = _outage_world(ow, out, 100)
    out.rss_status = lambda _c, _n: 404
    store = R.build_video_store(db=ow.db, settings=ow.settings, clock=ow.clock)
    ref = make_refresher(
        ow, video_store=store, shorts_per_cycle=0, cold_start_pages=R.COLD_START_PAGES
    )
    ref.refresh_all()
    assert len(out.page_calls()) == R.COLD_START_PAGES  # cap, even with 100 empty ones
    for i, c in enumerate(ids):  # every channel now has a stored video → cold start is over
        store.upsert(make_feed(c, i, now=now - WEEK, count=1).videos, T.VideoOrigin.rss)
    out.calls.clear()
    ow.clock.advance(R.OUTAGE_RETRY_S + 1)
    ref.refresh_all()
    assert len(out.page_calls()) <= R.FALLBACK_PAGES_PER_CYCLE
