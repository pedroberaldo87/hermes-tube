"""Search broker (``core/search_jobs.py``) and the ``/ext/search-jobs`` handlers.

Always on the real ``Db`` (``core.db.build`` via the ``db`` fixture). Fake wall clock
(``FakeClock``) + fake monotonic time (``FakeTime``): the window wait is measured without really
sleeping. Tests with "Measured" in the docstring use real wall time. ``live``: real YouTube.
"""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from conftest import real_db_factory
from fakes import FakeClock, FakeSearcher, FakeSettings, FakeYouTube

from tube_pkg import wiring
from tube_pkg.core import search_jobs as SJ
from tube_pkg.core import types as T
from tube_pkg.ext import search as ext_search

ROOT = Path(__file__).resolve().parents[1]
CH = "UC" + "a" * 22
CH2 = "UC" + "b" * 22
DEV_A = T.Device(id="dev_a", name="Chrome A", created_at=1)
DEV_B = T.Device(id="dev_b", name="Chrome B", created_at=1)


# --------------------------------------------------------------------------- harness


def vid(n: int) -> str:
    return f"v{n:010d}"


def hit(v: str, channel: str = CH) -> T.SearchHit:
    return T.SearchHit(video_id=v, title=f"título {v}", channel_id=channel, channel_title="Canal")


def renderer(v: Any, channel: str = CH, title: str = "Um vídeo") -> dict[str, Any]:
    return {
        "videoRenderer": {
            "videoId": v,
            "title": {"runs": [{"text": title}]},
            "ownerText": {
                "runs": [
                    {
                        "text": "Canal",
                        "navigationEndpoint": {"browseEndpoint": {"browseId": channel}},
                    }
                ]
            },
            "lengthText": {"simpleText": "10:05"},
            "viewCountText": {"simpleText": "1,234 views"},
            "publishedTimeText": {"simpleText": "3 days ago"},
        }
    }


def payload(*vids: Any, channel: str = CH) -> dict[str, Any]:
    """Minimal ``ytInitialData`` of a search page with the given videos."""
    return {
        "contents": {
            "twoColumnSearchResultsRenderer": {
                "primaryContents": {
                    "sectionListRenderer": {
                        "contents": [
                            {
                                "itemSectionRenderer": {
                                    "contents": [renderer(v, channel) for v in vids]
                                }
                            }
                        ]
                    }
                }
            }
        }
    }


class FakeTime:
    """Fake ``monotonic``/``sleep``; the ``FakeClock`` moves along; ``on_sleep`` = the extension."""

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.base = clock.now()
        self.t = 0.0
        self.slept: list[float] = []
        self.on_sleep: Callable[[int], Any] | None = None

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.t += seconds
        self.clock.set(self.base + int(self.t))
        if self.on_sleep is not None:
            self.on_sleep(len(self.slept))

    @property
    def total(self) -> float:
        return sum(self.slept)


class Devices:
    """Minimal ``DeviceAuth``: only ``any_seen_within`` matters to the broker."""

    def __init__(self, online: bool) -> None:
        self.online = online
        self.asked: list[float] = []

    def any_seen_within(self, seconds: float = T.DEVICE_ONLINE_WINDOW_S) -> bool:
        self.asked.append(seconds)
        return self.online


class SlowYouTube(FakeYouTube):
    """``FakeYouTube`` with per-search latency and per-query errors (thread-safe enough)."""

    def __init__(self, delay: float = 0.0) -> None:
        super().__init__()
        self.delay = delay
        self.errors: dict[str, BaseException] = {}
        self.delays: dict[str, float] = {}
        self._lock = threading.Lock()

    def search(
        self, query: str, order: T.SearchOrder = T.SearchOrder.relevance
    ) -> list[T.SearchHit]:
        with self._lock:
            self.calls.append(("search", query))
        time.sleep(self.delays.get(query, self.delay))
        err = self.errors.get(query)
        if err is not None:
            raise err
        hits = self.searches.get((query, T.SearchOrder(order)))
        if hits is None:
            hits = self.searches.get((query, None), [])
        return list(hits)

    def host_queries(self) -> list[str]:
        return [arg for name, arg in self.calls if name == "search"]


@pytest.fixture
def real_parser(db: Any) -> T.YouTubeClient:
    """The real ``YouTubeClient`` (from the ``wiring`` graph): only its parser is used."""
    return wiring.Graph(db=db, settings=FakeSettings()).get("youtube")


class HybridYouTube(SlowYouTube):
    """Fake host search + the real parser for the extension payload."""

    def __init__(self, parser: T.YouTubeClient) -> None:
        super().__init__()
        self.parser = parser

    def parse_search_payload(self, payload: Any) -> list[T.SearchHit]:
        self.calls.append(("parse_search_payload", None))
        return self.parser.parse_search_payload(payload)


def make(
    db: Any,
    clock: FakeClock,
    *,
    online: bool = True,
    up: bool = True,
    youtube: Any = None,
    fake_time: bool = True,
) -> tuple[Any, FakeTime, Any]:
    yt = youtube if youtube is not None else SlowYouTube()
    ft = FakeTime(clock)
    kwargs: dict[str, Any] = {}
    if fake_time:
        kwargs = {"sleep": ft.sleep, "monotonic": ft.monotonic}
    searcher = SJ.SearcherImpl(
        db=db,
        settings=FakeSettings(),
        youtube=yt,
        devices=Devices(online),
        ext_endpoint_up=lambda: up,
        clock=clock,
        **kwargs,
    )
    return searcher, ft, yt


def reqs(*queries: str, order: T.SearchOrder = T.SearchOrder.relevance) -> list[T.SearchRequest]:
    return [T.SearchRequest(query=q, order=order) for q in queries]


def script_host(yt: Any, n: int, *, per: int = 2, start: int = 0) -> list[str]:
    """``q0``…``q{n-1}`` with *per* distinct videos each on the host; returns the queries."""
    queries = []
    for i in range(n):
        q = f"q{i}"
        yt.add_search(q, [hit(vid(start + i * 100 + j)) for j in range(per)])
        queries.append(q)
    return queries


def answer_all(searcher: Any, device: str = "dev_a", base: int = 50_000) -> list[str]:
    """Extension: takes everything pending and answers with 1 video of its own per search."""
    done = []
    for i, job in enumerate(searcher.claim(device, limit=8)):
        searcher.complete(job.id, payload(vid(base + i)), device_id=device)
        done.append(job.query)
    return done


# --------------------------------------------------------------------------- creation and window


def test_build_matches_contract_and_is_inert(db: Any, clock: FakeClock) -> None:
    before = threading.active_count()
    searcher = SJ.build(
        db=db,
        settings=FakeSettings(),
        youtube=FakeYouTube(),
        devices=Devices(False),
        ext_endpoint_up=lambda: False,
        clock=clock,
    )
    assert isinstance(searcher, T.Searcher)
    assert not getattr(searcher, "__contract_stub__", None)
    assert threading.active_count() == before
    spec = next(s for s in T.BUILDS if s.module == "plugin/core/search_jobs.py")
    params = inspect.signature(SJ.build).parameters
    kw_only = [n for n, p in params.items() if p.kind is inspect.Parameter.KEYWORD_ONLY]
    assert [n for n in kw_only if params[n].default is inspect.Parameter.empty] == list(spec.deps)
    assert params["clock"].default is None and len(params) == len(spec.deps) + 1


def test_job_created_sets_search_pending(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    seen: list[int] = []
    ft.on_sleep = lambda n: seen.append(searcher.pending_count()) if n == 1 else None
    searcher.search_many(reqs("rust"))
    assert seen == [1]
    # the same count /status makes directly on the table
    row = db.query_one(
        "SELECT COUNT(*) AS n FROM search_jobs WHERE status = 'pending' AND expires_at > ?",
        (clock.now(),),
    )
    assert row["n"] == 0  # window closed: nothing stays pending
    assert searcher.pending_count() == 0


def test_jobs_share_batch_and_expire_after_window(db: Any, clock: FakeClock) -> None:
    searcher, ft, _ = make(db, clock)
    t0 = clock.now()
    rows: list[dict[str, Any]] = []
    ft.on_sleep = lambda n: rows.extend(db.query("SELECT * FROM search_jobs")) if n == 1 else None
    batch = [
        T.SearchRequest("a", T.SearchOrder.relevance, theme_id="th_1"),
        T.SearchRequest("a", T.SearchOrder.date, theme_id="th_1"),
        T.SearchRequest("b"),
    ]
    searcher.search_many(batch)
    assert len(rows) == 3
    assert len({r["batch_id"] for r in rows}) == 1
    assert {r["status"] for r in rows} == {"pending"}
    assert all(r["created_at"] == t0 and r["expires_at"] == t0 + 15 for r in rows)
    assert sorted((r["query"], r["search_order"], r["theme_id"]) for r in rows) == [
        ("a", "date", "th_1"),
        ("a", "relevance", "th_1"),
        ("b", "relevance", None),
    ]
    after = db.query("SELECT status FROM search_jobs")
    assert {r["status"] for r in after} == {"expired"}


def test_batch_of_12_waits_one_single_window(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    queries = script_host(yt, 12)
    out = searcher.search_many(reqs(*queries))
    # one 15 s window for the whole batch (not 12 × 15 s)
    assert 14.0 <= ft.total <= T.SEARCH_WINDOW_S + 1e-6
    assert searcher.stats["windows"] == 1
    assert [o.request.query for o in out] == queries
    assert all(o.via is T.SearchVia.host and len(o.hits) == 2 for o in out)
    assert sorted(yt.host_queries()) == sorted(queries)


def test_window_is_capped_by_timeout(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    searcher.search_many(reqs("a", "b"), timeout=4)
    assert 3.0 <= ft.total <= 4.0 + 1e-6
    rows = db.query("SELECT created_at, expires_at FROM search_jobs")
    assert all(r["expires_at"] - r["created_at"] == 4 for r in rows)


@pytest.mark.parametrize(("online", "up"), [(False, True), (True, False), (False, False)])
def test_no_device_or_endpoint_means_no_wait(db: Any, clock: FakeClock, online, up) -> None:
    searcher, ft, yt = make(db, clock, online=online, up=up)
    queries = script_host(yt, 5)
    out = searcher.search_many(reqs(*queries))
    assert ft.slept == []
    assert searcher.stats["windows"] == 0
    assert all(o.via is T.SearchVia.host for o in out)
    assert searcher.pending_count() == 0
    # still one job per search (record), none deliverable to the extension
    assert db.query_one("SELECT COUNT(*) AS n FROM search_jobs")["n"] == 5
    assert searcher.claim("dev_a") == []


def test_no_device_online_measured_wall_time(db: Any, clock: FakeClock) -> None:
    """Measured with real sleep/monotonic: no device, 16 host searches, no extension wait."""
    searcher, _, yt = make(db, clock, online=False, fake_time=False)
    queries = script_host(yt, 16)
    t0 = time.monotonic()
    out = searcher.search_many(reqs(*queries))
    elapsed = time.monotonic() - t0
    assert elapsed < 1.0, elapsed
    assert len(out) == 16 and all(o.hits for o in out)


def test_devices_and_endpoint_failures_count_as_offline(db: Any, clock: FakeClock) -> None:
    class Broken:
        def any_seen_within(self, seconds: float = 60.0) -> bool:
            raise RuntimeError("database locked")

    yt = SlowYouTube()
    yt.add_search("a", [hit(vid(1))])
    ft = FakeTime(clock)

    def boom() -> bool:
        raise OSError("sem servidor")

    for devices, up in ((Broken(), lambda: True), (Devices(True), boom)):
        searcher = SJ.SearcherImpl(
            db=db,
            settings=FakeSettings(),
            youtube=yt,
            devices=devices,
            ext_endpoint_up=up,
            clock=clock,
            sleep=ft.sleep,
            monotonic=ft.monotonic,
        )
        (out,) = searcher.search_many(reqs("a"))
        assert out.via is T.SearchVia.host and out.hits
    assert ft.slept == []


# --------------------------------------------------------------------------- extension


def test_extension_answers_in_time(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    queries = ["a", "b", "c"]
    ft.on_sleep = lambda n: answer_all(searcher) if n == 1 else None
    out = searcher.search_many(reqs(*queries))
    assert [o.via for o in out] == [T.SearchVia.extension] * 3
    assert [o.request.query for o in out] == queries
    assert {len(o.hits) for o in out} == {1}
    assert yt.host_queries() == []
    # left the window as soon as everything arrived (did not wait the 15 s)
    assert ft.total < 2.0


def test_extension_answers_part_host_completes_rest(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    queries = script_host(yt, 5)

    def extension(n: int) -> None:
        if n == 2:  # takes only 2 and answers; the rest stays pending
            for i, job in enumerate(searcher.claim("dev_a", limit=2)):
                searcher.complete(job.id, payload(vid(90_000 + i)), device_id="dev_a")

    ft.on_sleep = extension
    out = searcher.search_many(reqs(*queries))
    assert [o.request.query for o in out] == queries
    vias = [o.via for o in out]
    assert vias.count(T.SearchVia.extension) == 2 and vias.count(T.SearchVia.host) == 3
    assert sorted(yt.host_queries()) == sorted(
        o.request.query for o in out if o.via is T.SearchVia.host
    )
    assert searcher.stats["windows"] == 1


def test_claimed_but_silent_goes_to_host(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    queries = script_host(yt, 3)
    ft.on_sleep = lambda n: searcher.claim("dev_a", limit=8) if n == 1 else None
    out = searcher.search_many(reqs(*queries))
    assert all(o.via is T.SearchVia.host and o.hits for o in out)
    assert ft.total == pytest.approx(T.SEARCH_WINDOW_S)
    assert {r["status"] for r in db.query("SELECT status FROM search_jobs")} == {"expired"}


def test_extension_error_report_goes_to_host_early(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    queries = script_host(yt, 2)

    def extension(n: int) -> None:
        if n == 1:
            for job in searcher.claim("dev_a"):
                searcher.fail(job.id, "tab closed", device_id="dev_a")

    ft.on_sleep = extension
    out = searcher.search_many(reqs(*queries))
    assert all(o.via is T.SearchVia.host for o in out)
    assert ft.total < 2.0  # all settled: did not wait the whole window


def test_extension_in_another_thread_and_connection(db: Any, clock: FakeClock) -> None:
    """Measured: the real extension runs on another thread with another connection to the same file
    (extension server in another process). The batch returns as soon as it answers."""
    factory = real_db_factory()
    if factory is None or db.path == ":memory:":
        pytest.skip("needs the real file-backed Db")
    other = factory(path=db.path)
    searcher, _, yt = make(db, clock, fake_time=False)
    remote, _, _ = make(other, clock, fake_time=False)
    stop = threading.Event()
    answered: list[str] = []

    def extension() -> None:
        while not stop.is_set() and len(answered) < 4:
            answered.extend(answer_all(remote))
            time.sleep(0.05)

    thread = threading.Thread(target=extension, daemon=True)
    thread.start()
    try:
        t0 = time.monotonic()
        out = searcher.search_many(reqs("a", "b", "c", "d"))
        elapsed = time.monotonic() - t0
    finally:
        stop.set()
        thread.join(2)
        other.close()
    assert [o.via for o in out] == [T.SearchVia.extension] * 4
    assert elapsed < 3.0, elapsed
    assert yt.host_queries() == []


def test_late_result_is_discarded(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    yt.add_search("a", [hit(vid(1))])
    claimed: list[T.SearchJob] = []
    ft.on_sleep = lambda n: claimed.extend(searcher.claim("dev_a")) if n == 1 else None
    (out,) = searcher.search_many(reqs("a"))
    assert out.via is T.SearchVia.host
    (job,) = claimed
    with pytest.raises(T.Conflict):
        searcher.complete(job.id, payload(vid(2)), device_id="dev_a")
    row = db.query_one("SELECT status, payload FROM search_jobs WHERE id = ?", (job.id,))
    assert row["status"] == "expired" and row["payload"] is None
    # through the handler: conflict (409 on the extension server), the extension ignores it
    env = ext_search.post_search_result(
        DEV_A, {"payload": payload(vid(2))}, {"id": job.id}, searcher=searcher
    )
    assert env["ok"] is False and env["error"]["code"] == "conflict"
    assert T.ERROR_HTTP_STATUS["conflict"] == 409


def test_result_after_expires_at_is_refused_even_before_batch_closes(
    db: Any, clock: FakeClock
) -> None:
    searcher, _, _ = make(db, clock)
    job = searcher.enqueue("a")
    (got,) = searcher.claim("dev_a")
    assert got.id == job.id and got.status is T.SearchJobStatus.claimed
    clock.advance(T.SEARCH_WINDOW_S)
    with pytest.raises(T.Conflict):
        searcher.complete(job.id, payload(vid(1)), device_id="dev_a")
    assert searcher.claim("dev_b") == []


# --------------------------------------------------------------------------- devices


def test_two_devices_never_get_the_same_job(db: Any, clock: FakeClock) -> None:
    searcher, _, _ = make(db, clock)
    jobs = [searcher.enqueue(f"q{i}") for i in range(6)]
    a = searcher.claim("dev_a", limit=4)
    b = searcher.claim("dev_b", limit=4)
    assert [j.id for j in a] == [j.id for j in jobs[:4]]
    assert [j.id for j in b] == [j.id for j in jobs[4:]]
    assert all(j.device_id == "dev_a" for j in a) and all(j.device_id == "dev_b" for j in b)
    assert searcher.claim("dev_a") == [] and searcher.pending_count() == 0
    # B does not deliver the result of a job from A
    with pytest.raises(T.Conflict):
        searcher.complete(a[0].id, payload(vid(1)), device_id="dev_b")
    # a job never delivered (pending) does not accept a result either
    c = searcher.enqueue("solto")
    with pytest.raises(T.Conflict):
        searcher.complete(c.id, payload(vid(1)), device_id="dev_a")


def test_two_devices_racing_on_separate_connections(db: Any, clock: FakeClock) -> None:
    factory = real_db_factory()
    if factory is None or db.path == ":memory:":
        pytest.skip("needs the real file-backed Db")
    searcher, _, _ = make(db, clock)
    for i in range(40):
        searcher.enqueue(f"q{i}")
    conns = [factory(path=db.path) for _ in range(4)]
    got: dict[str, list[str]] = {f"dev_{i}": [] for i in range(4)}
    barrier = threading.Barrier(4)

    def device(i: int) -> None:
        mine, _, _ = make(conns[i], clock)
        barrier.wait()
        for _ in range(20):
            got[f"dev_{i}"].extend(j.id for j in mine.claim(f"dev_{i}", limit=3))

    threads = [threading.Thread(target=device, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    for c in conns:
        c.close()
    every = [j for ids in got.values() for j in ids]
    assert len(every) == 40 and len(set(every)) == 40
    owners = db.query("SELECT id, device_id FROM search_jobs")
    assert all(got[r["device_id"]].count(r["id"]) == 1 for r in owners)


def test_claim_limit_is_clamped(db: Any, clock: FakeClock) -> None:
    searcher, _, _ = make(db, clock)
    for i in range(12):
        searcher.enqueue(f"q{i}")
    assert len(searcher.claim("dev_a", limit=0)) == 1
    assert len(searcher.claim("dev_a", limit=100)) == 8


def test_complete_is_idempotent_for_the_same_device(db: Any, clock: FakeClock) -> None:
    searcher, _, _ = make(db, clock)
    job = searcher.enqueue("a")
    searcher.claim("dev_a")
    first = searcher.complete(job.id, payload(vid(1)), device_id="dev_a")
    again = searcher.complete(job.id, payload(vid(1)), device_id="dev_a")
    assert first.status is again.status is T.SearchJobStatus.done
    assert again.payload == first.payload
    with pytest.raises(T.NotFound):
        searcher.complete("sj_nao_existe", payload(vid(1)), device_id="dev_a")


# --------------------------------------------------------------------------- untrusted payload


@pytest.fixture(params=["fake_parser", "real_parser"])
def parser_youtube(request: Any, db: Any) -> Any:
    if request.param == "fake_parser":
        return SlowYouTube()
    return HybridYouTube(request.getfixturevalue("real_parser"))


def _claimed(searcher: Any) -> T.SearchJob:
    job = searcher.enqueue("rust")
    searcher.claim("dev_a")
    return job


def test_valid_payload_is_extracted(db: Any, clock: FakeClock, parser_youtube: Any) -> None:
    searcher, _, _ = make(db, clock, youtube=parser_youtube)
    job = _claimed(searcher)
    done = searcher.complete(job.id, payload(vid(1), vid(2), vid(1)), device_id="dev_a")
    assert done.status is T.SearchJobStatus.done
    hits = SJ.hits_from_payload(done.payload)
    assert [h.video_id for h in hits] == [vid(1), vid(2)]
    assert hits[0].channel_id == CH


def test_payload_as_json_text_and_envelope(db: Any, clock: FakeClock, real_parser: Any) -> None:
    import json

    searcher, _, _ = make(db, clock, youtube=HybridYouTube(real_parser))
    a = _claimed(searcher)
    done = searcher.complete(a.id, json.dumps(payload(vid(1))), device_id="dev_a")
    assert [h.video_id for h in SJ.hits_from_payload(done.payload)] == [vid(1)]
    b = _claimed(searcher)
    done = searcher.complete(b.id, {"ytInitialData": payload(vid(3))}, device_id="dev_a")
    assert [h.video_id for h in SJ.hits_from_payload(done.payload)] == [vid(3)]


def test_saved_search_page_is_accepted(db: Any, clock: FakeClock, real_parser: Any) -> None:
    html = (ROOT / "tests/fixtures/youtube/search/en-rust-programming.relevance.html").read_text(
        encoding="utf-8"
    )
    searcher, _, _ = make(db, clock, youtube=HybridYouTube(real_parser))
    job = _claimed(searcher)
    done = searcher.complete(job.id, html, device_id="dev_a")
    assert len(SJ.hits_from_payload(done.payload)) == 17


def _bad_payloads() -> dict[str, Any]:
    deep: Any = {"contents": []}
    node = deep["contents"]
    for _ in range(200):
        child: list[Any] = []
        node.append(child)
        node = child
    wide = {"contents": [{"x": i} for i in range(SJ.MAX_PAYLOAD_NODES + 10)]}
    return {
        "gigante_texto": "x" * (SJ.MAX_PAYLOAD_BYTES + 1),
        "gigante_objeto": {"contents": ["y" * 1024] * (SJ.MAX_PAYLOAD_BYTES // 1024 + 10)},
        "lista": [payload(vid(1))],
        "numero": 42,
        "nulo": None,
        "sem_contents": {"foo": {"videoRenderer": renderer(vid(1))["videoRenderer"]}},
        "texto_lixo": "<html><body>nada aqui</body></html>",
        "json_quebrado": '{"contents": [',
        "profundo": deep,
        "largo": wide,
        "id_curto": payload("abc"),
        "id_longo": payload("abcdefghijkl"),
        "id_com_marcacao": payload("<script>x1>"),
        "id_numero": payload(12345678901),
        "id_valido_e_invalido": payload(vid(1), "../../etc/p"),
        "canal_invalido": payload(vid(1), channel="UCcurto"),
        "lockup_id_invalido": {
            "contents": [
                {
                    "lockupViewModel": {
                        "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
                        "contentId": "javascript:1",
                    }
                }
            ]
        },
    }


BAD_PAYLOADS = (
    "canal_invalido",
    "gigante_objeto",
    "gigante_texto",
    "id_com_marcacao",
    "id_curto",
    "id_longo",
    "id_numero",
    "id_valido_e_invalido",
    "json_quebrado",
    "largo",
    "lista",
    "lockup_id_invalido",
    "nulo",
    "numero",
    "profundo",
    "sem_contents",
    "texto_lixo",
)


def test_bad_payload_names_cover_all() -> None:
    assert sorted(BAD_PAYLOADS) == sorted(_bad_payloads())


@pytest.mark.parametrize("name", BAD_PAYLOADS)
def test_bad_payload_is_refused(db: Any, clock: FakeClock, parser_youtube: Any, name: str) -> None:
    bad = _bad_payloads()[name]
    searcher, _, _ = make(db, clock, youtube=parser_youtube)
    job = _claimed(searcher)
    with pytest.raises(T.ValidationError):
        searcher.complete(job.id, bad, device_id="dev_a")
    row = db.query_one("SELECT status, payload FROM search_jobs WHERE id = ?", (job.id,))
    assert row["status"] == "failed" and row["payload"] is None
    # handler answer: invalid (400), never internal
    job2 = _claimed(searcher)
    env = ext_search.post_search_result(DEV_A, {"payload": bad}, {"id": job2.id}, searcher=searcher)
    assert env["ok"] is False and env["error"]["code"] == "invalid", env


def test_playlist_lockup_is_not_an_invalid_video_id(db: Any, clock: FakeClock, real_parser) -> None:
    data = payload(vid(1))
    data["contents"]["extra"] = [
        {
            "lockupViewModel": {
                "contentType": "LOCKUP_CONTENT_TYPE_PLAYLIST",
                "contentId": "PL" + "x" * 32,
            }
        }
    ]
    searcher, _, _ = make(db, clock, youtube=HybridYouTube(real_parser))
    job = _claimed(searcher)
    done = searcher.complete(job.id, data, device_id="dev_a")
    assert [h.video_id for h in SJ.hits_from_payload(done.payload)] == [vid(1)]


def test_hit_texts_are_bounded_and_cleaned(db: Any, clock: FakeClock, real_parser: Any) -> None:
    data = payload(vid(1))
    vr = data["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"][
        "sectionListRenderer"
    ]["contents"][0]["itemSectionRenderer"]["contents"][0]["videoRenderer"]
    vr["title"] = {"runs": [{"text": "a\u0000b\u202ec" + "z" * 5000}]}
    searcher, _, _ = make(db, clock, youtube=HybridYouTube(real_parser))
    job = _claimed(searcher)
    done = searcher.complete(job.id, data, device_id="dev_a")
    (h,) = SJ.hits_from_payload(done.payload)
    assert len(h.title) <= SJ.MAX_TEXT_CHARS
    assert "\u0000" not in h.title and "\u202e" not in h.title and h.title.startswith("abc")


def test_invalid_payload_sends_that_search_to_host_early(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    queries = script_host(yt, 2)

    def extension(n: int) -> None:
        if n == 1:
            jobs = searcher.claim("dev_a")
            searcher.complete(jobs[0].id, payload(vid(77)), device_id="dev_a")
            with pytest.raises(T.ValidationError):
                searcher.complete(jobs[1].id, payload("bad"), device_id="dev_a")

    ft.on_sleep = extension
    out = searcher.search_many(reqs(*queries))
    assert [o.via for o in out] == [T.SearchVia.extension, T.SearchVia.host]
    assert ft.total < 2.0


# --------------------------------------------------------------------------- host


def test_host_failure_does_not_break_the_batch(db: Any, clock: FakeClock) -> None:
    searcher, _, yt = make(db, clock, online=False)
    queries = script_host(yt, 4)
    yt.errors["q1"] = T.YouTubeError("search 'q1': YouTube unavailable (HTTP 503)", status=503)
    yt.errors["q2"] = RuntimeError("client bug")
    out = searcher.search_many(reqs(*queries))
    assert [o.request.query for o in out] == queries
    assert out[0].hits and out[3].hits
    for o in (out[1], out[2]):
        assert o.hits == () and o.error and o.via is T.SearchVia.none
    assert "503" in (out[1].error or "")


def test_429_stops_insisting(db: Any, clock: FakeClock) -> None:
    searcher, _, yt = make(db, clock, online=False)
    queries = script_host(yt, 12)
    yt.delay = 0.05
    yt.delays["q0"] = 0.0
    yt.errors["q0"] = T.YouTubeError(
        "search 'q0': YouTube rate-limited the requests (HTTP 429)", status=429
    )
    out = searcher.search_many(reqs(*queries))
    calls = yt.host_queries()
    assert len(calls) <= SJ.HOST_WORKERS, calls  # only the ones already in flight
    assert "429" in (out[0].error or "")
    skipped = [o for o in out if o.request.query not in calls]
    assert skipped and all("429" in (o.error or "") and o.hits == () for o in skipped)
    assert searcher.stats["rate_limited"] is True


def test_host_budget_cuts_hanging_searches(
    db: Any, clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(SJ, "HOST_BUDGET_S", 0.5)
    searcher, _, yt = make(db, clock, online=False, fake_time=False)
    queries = script_host(yt, 3)
    yt.delays["q1"] = 2.0
    t0 = time.monotonic()
    out = searcher.search_many(reqs(*queries))
    elapsed = time.monotonic() - t0
    assert elapsed < 1.5, elapsed
    assert out[0].hits and out[2].hits
    assert out[1].hits == () and "timed out" in (out[1].error or "")


def test_host_runs_in_parallel_and_fits_the_budget(db: Any, clock: FakeClock) -> None:
    """Measured: 16 host searches of 0.3 s each, no extension → ≈ 4 rounds of 4 in parallel."""
    searcher, _, yt = make(db, clock, online=False, fake_time=False)
    queries = script_host(yt, 16)
    yt.delay = 0.3
    t0 = time.monotonic()
    out = searcher.search_many(reqs(*queries))
    elapsed = time.monotonic() - t0
    assert all(o.hits for o in out)
    assert elapsed < 0.3 * 16 / 2, elapsed  # much less than in series (4.8 s)
    print(f"\n[search] 16 host searches (0.3 s each, {SJ.HOST_WORKERS} at a time): {elapsed:.2f} s")


def test_worst_case_budget_with_silent_extension(db: Any, clock: FakeClock) -> None:
    """Worst case within the theme search budget (90 s): silent extension (15 s) + host."""
    searcher, ft, yt = make(db, clock)
    queries = script_host(yt, 16)
    t0 = time.monotonic()
    out = searcher.search_many(reqs(*queries))
    host_wall = time.monotonic() - t0
    assert all(o.via is T.SearchVia.host for o in out)
    assert ft.total + SJ.HOST_BUDGET_S <= T.TOOL_TIMEOUT_S / 2
    assert host_wall < 1.0


# --------------------------------------------------------------------------- result


def test_results_in_order_deduplicated_with_origin(db: Any, clock: FakeClock) -> None:
    searcher, ft, yt = make(db, clock)
    shared = vid(5)
    yt.add_search("h1", [hit(vid(1)), hit(shared)])
    yt.add_search("h2", [hit(shared), hit(vid(2)), hit(vid(2))])

    def extension(n: int) -> None:
        if n == 1:
            for job in searcher.claim("dev_a"):
                if job.query == "e1":
                    searcher.complete(job.id, payload(shared, vid(3)), device_id="dev_a")

    ft.on_sleep = extension
    out = searcher.search_many(reqs("h1", "e1", "h2"))
    assert [o.request.query for o in out] == ["h1", "e1", "h2"]
    assert [o.via for o in out] == [T.SearchVia.host, T.SearchVia.extension, T.SearchVia.host]
    assert [h.video_id for h in out[0].hits] == [vid(1), shared]
    assert [h.video_id for h in out[1].hits] == [vid(3)]
    assert [h.video_id for h in out[2].hits] == [vid(2)]


def test_repeated_request_is_searched_once(db: Any, clock: FakeClock) -> None:
    searcher, _, yt = make(db, clock, online=False)
    yt.add_search("a", [hit(vid(1))])
    out = searcher.search_many(reqs("a", "a", " a "))
    assert yt.host_queries() == ["a"]
    assert [len(o.hits) for o in out] == [1, 0, 0]
    assert all(o.via is T.SearchVia.host for o in out)


def test_invalid_requests_become_outcome_errors(db: Any, clock: FakeClock) -> None:
    searcher, _, yt = make(db, clock, online=False)
    yt.add_search("ok", [hit(vid(1))])
    sideways: Any = "sideways"
    batch = [T.SearchRequest(q) for q in ("", "   ", "x" * 500, "ok")]
    out = searcher.search_many([*batch, T.SearchRequest("ok", order=sideways)])
    assert [bool(o.error) for o in out] == [True, True, True, False, True]
    assert out[3].hits
    assert searcher.search_many([]) == []


def test_search_shortcut(db: Any, clock: FakeClock) -> None:
    searcher, _, yt = make(db, clock, online=False)
    yt.add_search("a", [hit(vid(1))], T.SearchOrder.date)
    assert [h.video_id for h in searcher.search("a", T.SearchOrder.date)] == [vid(1)]
    yt.errors["b"] = T.YouTubeError("caiu")
    with pytest.raises(T.YouTubeError):
        searcher.search("b")


# --------------------------------------------------------------------------- cleanup


def test_purge_expired(db: Any, clock: FakeClock) -> None:
    searcher, _, _ = make(db, clock)
    old = searcher.enqueue("velha")
    clock.advance(20)
    fresh = searcher.enqueue("nova")
    assert searcher.purge_expired() == 1
    ids = {r["id"] for r in db.query("SELECT id FROM search_jobs")}
    assert ids == {fresh.id} and old.id not in ids
    assert searcher.purge_expired(clock.now() + 3600) == 1
    assert searcher.purge_expired() == 0


# --------------------------------------------------------------------------- extension handlers


def _gen_types() -> Any:
    import sys

    name = "_gen_types_surface"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "gen_types.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


def _check(op_id: str, env: dict[str, Any]) -> None:
    gt = _gen_types()
    contract = gt.load_contract(ROOT)
    op = gt.get_operation(contract, op_id)
    if env["ok"]:
        gt.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    else:
        gt.validate_instance({"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True)
        assert env["error"]["code"] in set(op.errors) | {"unauthorized"}


def test_handlers_are_marked_real() -> None:
    common = importlib.import_module("tube_pkg.api._common")
    assert common.is_real(ext_search.get_search_jobs)
    assert common.is_real(ext_search.post_search_result)


def test_get_search_jobs_handler(db: Any, clock: FakeClock) -> None:
    searcher, _, _ = make(db, clock)
    for i in range(6):
        searcher.enqueue(f"q{i}", theme_id="th_1")
    env = ext_search.get_search_jobs(None, None, {}, searcher=searcher)
    assert env["ok"] is False and env["error"]["code"] == "unauthorized"
    env = ext_search.get_search_jobs(DEV_A, None, {"limit": "2"}, searcher=searcher)
    _check("extGetSearchJobs", env)
    assert [j["status"] for j in env["data"]["items"]] == ["claimed", "claimed"]
    assert {j["device_id"] for j in env["data"]["items"]} == {"dev_a"}
    for bad in ("x", "-3", "999", ""):
        env = ext_search.get_search_jobs(DEV_B, None, {"limit": bad}, searcher=searcher)
        _check("extGetSearchJobs", env)
    assert searcher.pending_count() == 0


def test_post_search_result_handler(db: Any, clock: FakeClock) -> None:
    searcher, _, _ = make(db, clock)
    a, b, c = (searcher.enqueue(q) for q in ("a", "b", "c"))
    searcher.claim("dev_a")
    env = ext_search.post_search_result(
        DEV_A, {"payload": payload(vid(1))}, {"id": a.id}, searcher=searcher
    )
    _check("extPostSearchResult", env)
    assert env["ok"] and env["data"]["status"] == "done" and env["data"]["id"] == a.id
    env = ext_search.post_search_result(
        DEV_A, {"error": "tab closed"}, {"id": b.id}, searcher=searcher
    )
    _check("extPostSearchResult", env)
    assert env["ok"] and env["data"]["status"] == "failed"
    cases = [
        (DEV_A, {"payload": payload(vid(1)), "error": "x"}, {"id": c.id}, "invalid"),
        (DEV_A, {}, {"id": c.id}, "invalid"),
        (DEV_A, {"error": 3}, {"id": c.id}, "invalid"),
        (DEV_A, {"payload": payload(vid(1))}, {}, "not_found"),
        (DEV_A, {"payload": payload(vid(1))}, {"id": "sj_x"}, "not_found"),
        (DEV_B, {"payload": payload(vid(1))}, {"id": c.id}, "conflict"),
        (None, {"payload": payload(vid(1))}, {"id": c.id}, "unauthorized"),
    ]
    for device, body, query, code in cases:
        env = ext_search.post_search_result(device, body, query, searcher=searcher)
        _check("extPostSearchResult", env)
        assert env["ok"] is False and env["error"]["code"] == code, (body, query, env)


def test_handlers_with_contract_examples(db: Any, clock: FakeClock) -> None:
    """Same inputs as the surface test (contract example, nonexistent job)."""
    searcher, _, _ = make(db, clock)
    env = ext_search.get_search_jobs(DEV_A, None, {}, searcher=searcher)
    _check("extGetSearchJobs", env)
    env = ext_search.post_search_result(
        DEV_A,
        {"payload": {"contents": {"twoColumnSearchResultsRenderer": {}}}},
        {"id": "sj_1"},
        searcher=searcher,
    )
    _check("extPostSearchResult", env)
    assert env["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- fake × real


@pytest.fixture(params=["fake", "real"])
def impl(request: Any, db: Any, clock: FakeClock) -> tuple[Any, SlowYouTube]:
    yt = SlowYouTube()
    if request.param == "fake":
        return FakeSearcher(youtube=yt, clock=clock), yt
    searcher, _, _ = make(db, clock, online=False, youtube=yt)
    return searcher, yt


def test_conformance_protocol(impl: Any) -> None:
    searcher, _ = impl
    assert isinstance(searcher, T.Searcher)


def test_conformance_pending_claim_complete(impl: Any, clock: FakeClock) -> None:
    searcher, _ = impl
    assert searcher.pending_count() == 0
    jobs = [searcher.enqueue(f"q{i}", theme_id="th") for i in range(5)]
    assert searcher.pending_count() == 5
    a = searcher.claim("dev_a", limit=3)
    assert [j.id for j in a] == [j.id for j in jobs[:3]]
    assert all(j.status is T.SearchJobStatus.claimed and j.device_id == "dev_a" for j in a)
    assert searcher.pending_count() == 2
    b = searcher.claim("dev_b")
    assert {j.id for j in b} == {jobs[3].id, jobs[4].id}
    done = searcher.complete(a[0].id, payload(vid(1)), device_id="dev_a")
    assert done.status is T.SearchJobStatus.done and done.id == a[0].id
    with pytest.raises(T.NotFound):
        searcher.complete("nao-existe", payload(vid(1)), device_id="dev_a")
    clock.advance(T.SEARCH_WINDOW_S)
    assert searcher.pending_count() == 0
    with pytest.raises(T.Conflict):
        searcher.complete(a[1].id, payload(vid(1)), device_id="dev_a")


def test_conformance_expired_not_delivered(impl: Any, clock: FakeClock) -> None:
    searcher, _ = impl
    searcher.enqueue("a")
    clock.advance(T.SEARCH_WINDOW_S)
    assert searcher.claim("dev_a") == []
    assert searcher.pending_count() == 0


def test_conformance_purge(impl: Any, clock: FakeClock) -> None:
    searcher, _ = impl
    searcher.enqueue("velha")
    clock.advance(T.SEARCH_WINDOW_S + 1)
    searcher.enqueue("nova")
    assert searcher.purge_expired() == 1
    assert searcher.pending_count() == 1


def test_conformance_search_many_host(impl: Any) -> None:
    searcher, yt = impl
    yt.add_search("a", [hit(vid(1))])
    yt.add_search("b", [hit(vid(2)), hit(vid(3))])
    yt.errors["c"] = T.YouTubeError("caiu")
    out = searcher.search_many(reqs("a", "b", "c"))
    assert [o.request.query for o in out] == ["a", "b", "c"]
    assert [[h.video_id for h in o.hits] for o in out] == [[vid(1)], [vid(2), vid(3)], []]
    assert [o.via for o in out[:2]] == [T.SearchVia.host] * 2
    assert out[2].error and not out[2].hits
    assert searcher.search("a") == [hit(vid(1))]
    with pytest.raises(T.YouTubeError):
        searcher.search("c")


# --------------------------------------------------------------------------- live (outside check)


@pytest.mark.live
def test_live_three_host_searches(db: Any, capsys: pytest.CaptureFixture[str]) -> None:
    """3 real searches through the host (no device online): time and number of results."""
    yt = wiring.Graph(db=db, settings=FakeSettings()).get("youtube")
    searcher = SJ.SearcherImpl(
        db=db,
        settings=FakeSettings(),
        youtube=yt,
        devices=Devices(False),
        ext_endpoint_up=lambda: False,
    )
    batch = [
        T.SearchRequest("rust programming tutorial"),
        T.SearchRequest("receita de pão caseiro"),
        T.SearchRequest("AI agents", T.SearchOrder.date),
    ]
    t0 = time.monotonic()
    out = searcher.search_many(batch)
    elapsed = time.monotonic() - t0
    with capsys.disabled():
        print(f"\n[search live] 3 host searches in {elapsed:.2f} s")
        for o in out:
            print(
                f"  {o.request.query!r} ({o.request.order}): {len(o.hits)} videos via {o.via}"
                f"{' error: ' + o.error if o.error else ''}"
            )
    assert all(o.via is T.SearchVia.host and len(o.hits) >= 5 for o in out)
    assert elapsed < 30
