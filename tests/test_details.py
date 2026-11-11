"""Duration and kind (Short or not) of every video, in the background.

Source (measured live): the channel's uploads playlist (``/playlist?list=UU…``, 100 items,
duration on the badge — Shorts included) and the Shorts one (``UUSH…``): **two requests per
channel** settle duration and kind for everything the RSS brought. Video page (``/shorts/<id>``,
``/watch``) only for what was not in the playlist, with a low cap.

Real database (``db`` fixture) + fakes; the fake client gains ``fetch_uploads_playlist`` and
``short_details`` (the plain ``FakeYouTube`` lacks them: without them the details fetch stays off
and the older tests do not change). The end-to-end test uses the real client over fake HTTP and
the saved pages.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeSettings, FakeYouTube, build_fake_world

from tube_pkg.core import details as D
from tube_pkg.core import refresh as R
from tube_pkg.core import types as T
from tube_pkg.core import youtube as Y

TESTS = Path(__file__).resolve().parent
FIX = TESTS / "fixtures" / "youtube"
DAY = 86_400
FIRESHIP = "UCsBjURrPoezykLs9EqgamOA"
VERITASIUM = "UCHnyfMqiRRG1u-2MsSQLbXA"
KARPATHY = "UCXUPKJO5MZQN11PqgIvyuvQ"


# --------------------------------------------------------------------------- helpers


def cid(n: int) -> str:
    return f"UCb13chan{n:015d}"


def vid(n: int, j: int) -> str:
    return f"b{n:06d}_{j:03d}"


class Mono:
    """Fake monotonic clock: ``sleep`` advances time (waits between requests without waiting)."""

    def __init__(self) -> None:
        self.t = 1000.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += max(seconds, 0.0)


class PlaylistYouTube(FakeYouTube):
    """``FakeYouTube`` + uploads/Shorts playlists + ``short_details``; records the instant of each
    request (on the fake monotonic clock)."""

    def __init__(self, mono: Mono | None = None) -> None:
        super().__init__()
        self.playlists: dict[str, Y.PlaylistPage] = {}
        self.short_lengths: dict[str, int | None] = {}
        self.mono = mono
        self.starts: list[float] = []

    def add_playlist(
        self, channel_id: str, items: Sequence[tuple[str, int | None]], *, shorts: bool = False
    ) -> None:
        pid = Y.uploads_playlist_id(channel_id, shorts=shorts)
        self.playlists[pid] = Y.PlaylistPage(
            playlist_id=pid,
            exists=True,
            video_ids=tuple(v for v, _ in items),
            durations={v: d for v, d in items if d is not None},
        )

    def _start(self) -> None:
        if self.mono is not None:
            self.starts.append(self.mono())

    def fetch_uploads_playlist(self, channel_id: str, *, shorts: bool = False) -> Y.PlaylistPage:
        pid = Y.uploads_playlist_id(channel_id, shorts=shorts)
        self.calls.append(("fetch_uploads_playlist", pid))
        self._start()
        self._check_fail("fetch_uploads_playlist", pid)
        page = self.playlists.get(pid)
        if page is None:
            return Y.PlaylistPage(playlist_id=pid, exists=False, video_ids=(), durations={})
        return page

    def short_details(self, video_id: str) -> tuple[bool, int | None]:
        self.calls.append(("short_details", video_id))
        self._start()
        self._check_fail("short_details", video_id)
        if video_id in self.shorts:
            return True, self.short_lengths.get(video_id)
        return False, None

    def video_details(self, video_id: str) -> T.VideoDetails:
        self._start()
        return super().video_details(video_id)

    def playlist_calls(self) -> list[str]:
        return [a for m, a in self.calls if m == "fetch_uploads_playlist"]

    def page_calls(self) -> list[tuple[str, Any]]:
        """Individual page requests (the last resort)."""
        return [c for c in self.calls if c[0] in ("short_details", "video_details", "is_short")]


def insert_channels(
    db: Any, ids: Sequence[str], *, favorite: Sequence[str] = (), relation: str = "subscribed"
) -> None:
    db.executemany(
        "INSERT INTO channels (id, title, relation, source, added_at, favorite)"
        " VALUES (?, ?, ?, 'extension', 0, ?)",
        [(c, f"Canal {c[-4:]}", relation, int(c in favorite)) for c in ids],
    )


def store(world: Any, videos: Sequence[T.VideoIn]) -> None:
    world.video_store.upsert(list(videos), T.VideoOrigin.rss)


def vin(video_id: str, channel_id: str, *, published_at: int, **kw: Any) -> T.VideoIn:
    return T.VideoIn(
        id=video_id,
        channel_id=channel_id,
        title=f"vídeo {video_id}",
        published_at=published_at,
        **kw,
    )


def row(db: Any, video_id: str) -> dict[str, Any]:
    r = db.query_one("SELECT duration_s, is_short FROM videos WHERE id = ?", (video_id,))
    assert r is not None
    return {"duration_s": r["duration_s"], "is_short": r["is_short"]}


def resolver(world: Any, yt: Any, mono: Mono, **kw: Any) -> D.DetailsResolver:
    return D.DetailsResolver(
        db=world.db,
        video_store=world.video_store,
        youtube=yt,
        clock=world.clock,
        sleep=mono.sleep,
        monotonic=mono,
        **kw,
    )


@pytest.fixture
def mono() -> Mono:
    return Mono()


@pytest.fixture
def yt(mono: Mono) -> PlaylistYouTube:
    return PlaylistYouTube(mono)


@pytest.fixture
def w(db: Any, clock: FakeClock, yt: PlaylistYouTube) -> Any:
    world = build_fake_world(db, clock=clock, youtube=yt)
    world.video_store = R.build_video_store(db=db, settings=world.settings, clock=clock)
    return world


def seed_channel(
    w: Any, yt: PlaylistYouTube, n: int, *, longs: int = 3, shorts: int = 2, extra: int = 0
) -> list[str]:
    """Channel *n* with ``longs`` recent videos (10 min) and ``shorts`` recent Shorts (45 s), all
    with no duration or kind in the database; scripted playlists (``extra`` more older items)."""
    now = w.clock.now()
    c = cid(n)
    videos = [vin(vid(n, j), c, published_at=now - (j + 1) * 3600) for j in range(longs + shorts)]
    store(w, videos)
    uploads = [(v.id, 600 if j < longs else 45) for j, v in enumerate(videos)]
    uploads += [(vid(n, 900 + k), 300) for k in range(extra)]
    yt.add_playlist(c, uploads)
    yt.add_playlist(c, [(v.id, None) for v in videos[longs:]], shorts=True)
    return [v.id for v in videos]


# --------------------------------------------------------------------------- parser (real pages)


def test_parse_uploads_playlist_real_page_has_durations_of_shorts_too() -> None:
    html = (FIX / "playlist" / f"uploads.UU{VERITASIUM[2:]}.html").read_text(encoding="utf-8")
    page = Y.parse_playlist_page(html)
    assert page.exists is True
    assert len(page.video_ids) == 100
    assert len(set(page.video_ids)) == 100
    assert page.durations["rL0qEmTRI-I"] == 86  # Short (1:26)
    assert page.durations["KfODG5REyss"] == 3956  # 1:05:56
    assert all(isinstance(d, int) and d > 0 for d in page.durations.values())
    assert len(page.durations) == 100


def test_parse_shorts_playlist_real_page_lists_ids_without_duration() -> None:
    html = (FIX / "playlist" / f"shorts.UUSH{VERITASIUM[2:]}.html").read_text(encoding="utf-8")
    page = Y.parse_playlist_page(html)
    assert page.exists is True
    assert len(page.video_ids) == 95
    assert "rL0qEmTRI-I" in page.video_ids
    assert "KfODG5REyss" not in page.video_ids
    assert page.durations == {}


def test_parse_missing_playlist_is_not_an_error() -> None:
    """Channel without Shorts (Karpathy, real): ``UUSH…`` answers 200 with "The playlist does not
    exist." — that is an answer, not a failure."""
    html = (FIX / "playlist" / f"missing.UUSH{KARPATHY[2:]}.html").read_text(encoding="utf-8")
    page = Y.parse_playlist_page(html)
    assert page.exists is False
    assert page.video_ids == () and page.durations == {}


def test_parse_playlist_garbage_is_an_error() -> None:
    with pytest.raises(T.YouTubeError):
        Y.parse_playlist_page("<html>nada aqui</html>")
    with pytest.raises(T.YouTubeError):
        Y.parse_playlist_page({"responseContext": {}})


def test_uploads_playlist_ids() -> None:
    assert Y.uploads_playlist_id(VERITASIUM) == "UU" + VERITASIUM[2:]
    assert Y.uploads_playlist_id(VERITASIUM, shorts=True) == "UUSH" + VERITASIUM[2:]
    with pytest.raises(T.ValidationError):
        Y.uploads_playlist_id("nope")


def _client(transport: Any, clock: Any = None) -> Y.YouTube:
    from tube_pkg.core import http as H

    settings = FakeSettings()
    return Y.build(
        http=H.Client(settings=settings, transport=transport, sleep=lambda _s: None),
        settings=settings,
        clock=clock,
    )


def test_client_fetch_uploads_playlist_and_short_details() -> None:
    seen: list[str] = []
    page = (FIX / "playlist" / f"uploads.UU{FIRESHIP[2:]}.html").read_bytes()
    short_page = (FIX / "shorts" / "page.rL0qEmTRI-I.html").read_bytes()

    def transport(req: Any) -> T.HttpResponse:
        seen.append(req.url)
        if "/playlist" in req.url and "UU" + FIRESHIP[2:] in req.url:
            return T.HttpResponse(200, req.url, {"content-type": "text/html"}, page)
        if req.url.endswith("/shorts/rL0qEmTRI-I"):
            return T.HttpResponse(200, req.url, {"content-type": "text/html"}, short_page)
        if req.url.endswith("/shorts/KfODG5REyss"):
            loc = "https://www.youtube.com/watch?v=KfODG5REyss"
            return T.HttpResponse(303, req.url, {"location": loc}, b"")
        return T.HttpResponse(500, req.url, {}, b"")

    yt = _client(transport)
    got = yt.fetch_uploads_playlist(FIRESHIP)
    assert got.exists and len(got.video_ids) == 100 and got.durations["iw9SZgyahqg"] == 361
    assert "list=UU" + FIRESHIP[2:] in seen[0] and "hl=en" in seen[0]
    assert yt.short_details("rL0qEmTRI-I") == (True, 86)
    assert yt.short_details("KfODG5REyss") == (False, None)
    with pytest.raises(T.YouTubeError) as err:
        yt.fetch_uploads_playlist(VERITASIUM, shorts=True)
    assert err.value.details.get("status") == 500


# --------------------------------------------------------------------------- resolver


def test_build_is_inert_and_disabled_without_playlist_support(w: Any, mono: Mono) -> None:
    before = threading.active_count()
    plain = FakeYouTube()
    r = resolver(w, plain, mono)
    assert threading.active_count() == before
    assert r.enabled() is False
    assert r.run_pass() is None
    assert plain.calls == []
    assert r.kick() == "skipped"
    assert w.db.query_one("SELECT value FROM meta WHERE key = ?", (D.META_DETAILS_STATE,)) is None


def test_one_pass_resolves_duration_and_kind_with_two_requests_per_channel(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    insert_channels(w.db, [cid(1), cid(2)])
    a = seed_channel(w, yt, 1)
    b = seed_channel(w, yt, 2, shorts=0)  # long videos only: does not even ask for the Shorts one
    r = resolver(w, yt, mono)
    assert r.pending_count() == 8
    report = r.run_pass()
    assert report is not None and report.requests == 3
    assert sorted(yt.playlist_calls()) == sorted(
        ["UU" + cid(1)[2:], "UUSH" + cid(1)[2:], "UU" + cid(2)[2:]]
    )
    assert yt.page_calls() == []
    for v in a[:3] + b:
        assert row(w.db, v) == {"duration_s": 600, "is_short": 0}
    for v in a[3:]:
        assert row(w.db, v) == {"duration_s": 45, "is_short": 1}
    assert r.pending_count() == 0


def test_nothing_is_asked_twice(w: Any, yt: PlaylistYouTube, mono: Mono) -> None:
    insert_channels(w.db, [cid(1)])
    seed_channel(w, yt, 1)
    r = resolver(w, yt, mono)
    r.run_pass()
    first = list(yt.calls)
    w.clock.advance(3600)
    mono.t += 3600
    r.run_pass(force=True)
    assert yt.calls == first
    # a new video on the same channel: the channel comes back (only for it)
    now = w.clock.now()
    store(w, [vin(vid(1, 50), cid(1), published_at=now - 60)])
    yt.add_playlist(cid(1), [(vid(1, 50), 777)] + [(vid(1, j), 600) for j in range(3)])
    r.run_pass(force=True)
    assert yt.playlist_calls()[len(first) :] == ["UU" + cid(1)[2:]]
    assert row(w.db, vid(1, 50)) == {"duration_s": 777, "is_short": 0}


def test_long_video_is_never_a_short_without_asking(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    insert_channels(w.db, [cid(1)])
    now = w.clock.now()
    store(w, [vin(vid(1, 0), cid(1), published_at=now - 60, duration_s=D.LONG_FROM_S + 1)])
    r = resolver(w, yt, mono)
    assert r.run_pass() is not None
    assert row(w.db, vid(1, 0)) == {"duration_s": D.LONG_FROM_S + 1, "is_short": 0}
    assert yt.calls == []


def test_short_known_by_rss_still_gets_duration_but_no_shorts_page(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    insert_channels(w.db, [cid(1)])
    now = w.clock.now()
    store(w, [vin(vid(1, 0), cid(1), published_at=now - 60, is_short=True)])
    yt.add_playlist(cid(1), [(vid(1, 0), 33)])
    resolver(w, yt, mono).run_pass()
    assert row(w.db, vid(1, 0)) == {"duration_s": 33, "is_short": 1}
    assert yt.playlist_calls() == ["UU" + cid(1)[2:]]


def test_short_without_duration_on_the_page_is_still_a_short(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    """Not in the uploads playlist (only in the Shorts one): ``is_short=1`` without a duration."""
    insert_channels(w.db, [cid(1)])
    now = w.clock.now()
    store(w, [vin(vid(1, 0), cid(1), published_at=now - 60)])
    yt.add_playlist(cid(1), [(vid(1, 9), 300)])
    yt.add_playlist(cid(1), [(vid(1, 0), None)], shorts=True)
    r = resolver(w, yt, mono, singles_per_pass=0)
    r.run_pass()
    assert row(w.db, vid(1, 0)) == {"duration_s": None, "is_short": 1}


def test_channel_without_shorts_playlist_means_no_shorts(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    insert_channels(w.db, [cid(1)])
    now = w.clock.now()
    store(w, [vin(vid(1, 0), cid(1), published_at=now - 60)])
    yt.add_playlist(cid(1), [(vid(1, 0), 50)])  # short, but the channel has no Shorts playlist
    resolver(w, yt, mono).run_pass()
    assert row(w.db, vid(1, 0)) == {"duration_s": 50, "is_short": 0}


def test_video_missing_from_the_playlist_goes_to_the_video_page_with_a_low_cap(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    insert_channels(w.db, [cid(1)])
    now = w.clock.now()
    videos = [vin(vid(1, j), cid(1), published_at=now - j * 60) for j in range(5)]
    store(w, videos)
    yt.add_playlist(cid(1), [(vid(1, 99), 600)])  # none of the 5 is in the playlist
    yt.add_playlist(cid(1), [(vid(1, 98), None)], shorts=True)
    yt.add_short(vid(1, 0))
    yt.short_lengths[vid(1, 0)] = 40
    for j in range(1, 5):
        yt.add_details(T.VideoDetails(video_id=vid(1, j), duration_s=900))
    r = resolver(w, yt, mono, singles_per_pass=2)
    r.run_pass()
    assert row(w.db, vid(1, 0)) == {"duration_s": 40, "is_short": 1}  # 1 request (/shorts/)
    assert row(w.db, vid(1, 1)) == {"duration_s": 900, "is_short": 0}  # 2 requests
    assert row(w.db, vid(1, 2))["duration_s"] is None  # cap of 2 videos per pass
    assert len({a for _, a in yt.page_calls()}) == 2
    w.clock.advance(60)
    r.run_pass(force=True)
    assert row(w.db, vid(1, 3)) == {"duration_s": 900, "is_short": 0}
    assert yt.playlist_calls().count("UU" + cid(1)[2:]) == 1  # no playlist refetch for them


def test_failure_is_retried_with_backoff(w: Any, yt: PlaylistYouTube, mono: Mono) -> None:
    insert_channels(w.db, [cid(1)])
    seed_channel(w, yt, 1)
    pid = "UU" + cid(1)[2:]
    yt.fail("fetch_uploads_playlist", pid, T.YouTubeError("HTTP 500", status=500))
    r = resolver(w, yt, mono)
    r.run_pass()
    assert yt.playlist_calls() == [pid]
    assert r.pending_count() == 0  # backing off: "nothing to fetch now"
    w.clock.advance(D.RETRY_BASE_S - 1)
    r.run_pass(force=True)
    assert yt.playlist_calls() == [pid]  # still backing off
    w.clock.advance(1)
    r.run_pass(force=True)
    assert yt.playlist_calls() == [pid, pid]  # 2nd attempt; failed again → the backoff doubles
    w.clock.advance(D.RETRY_BASE_S)
    r.run_pass(force=True)
    assert yt.playlist_calls() == [pid, pid]
    del yt.failures[("fetch_uploads_playlist", pid)]
    w.clock.advance(D.RETRY_BASE_S)
    r.run_pass(force=True)
    assert yt.playlist_calls() == [pid, pid, pid, "UUSH" + cid(1)[2:]]
    assert r.pending_count() == 0
    assert all(row(w.db, v)["duration_s"] for v in (vid(1, j) for j in range(5)))


def test_budget_per_pass_and_spacing_between_requests(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    ids = [cid(n) for n in range(30)]
    insert_channels(w.db, ids)
    for n in range(30):
        seed_channel(w, yt, n, longs=1, shorts=1)
    r = resolver(w, yt, mono, requests_per_pass=10, spacing_s=0.75)
    report = r.run_pass()
    assert report is not None and report.requests == 10
    assert len(yt.calls) == 10
    gaps = [b - a for a, b in zip(yt.starts, yt.starts[1:], strict=False)]
    assert gaps and min(gaps) >= 0.75 - 1e-9  # no bursts
    # the following passes finish the job, without repeating a channel
    for _ in range(10):
        w.clock.advance(D.PASS_GAP_S)
        r.run_pass(force=True)
    assert len(yt.playlist_calls()) == 60 == len(set(yt.playlist_calls()))
    assert r.pending_count() == 0


def test_channels_with_new_unseen_videos_and_favorites_come_first(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1), cid(2), cid(3)], favorite=[cid(3)])
    for n in (1, 2, 3):
        seed_channel(w, yt, n, longs=1, shorts=0)
    # channel 1: everything already seen (watermark ahead); channel 2: new video
    w.db.execute("INSERT INTO watermarks (channel_id, seen_up_to) VALUES (?, ?)", (cid(1), now))
    r = resolver(w, yt, mono, requests_per_pass=2)
    r.run_pass()
    assert yt.playlist_calls() == ["UU" + cid(3)[2:], "UU" + cid(2)[2:]]


def test_429_stops_the_pass_and_waits(w: Any, yt: PlaylistYouTube, mono: Mono) -> None:
    insert_channels(w.db, [cid(1), cid(2)])
    seed_channel(w, yt, 1)
    seed_channel(w, yt, 2)
    yt.fail("fetch_uploads_playlist", "UU" + cid(1)[2:], T.YouTubeError("HTTP 429", status=429))
    yt.fail("fetch_uploads_playlist", "UU" + cid(2)[2:], T.YouTubeError("HTTP 429", status=429))
    r = resolver(w, yt, mono)
    report = r.run_pass()
    assert report is not None and report.throttled is True
    assert len(yt.calls) == 1
    w.clock.advance(D.THROTTLE_S - 1)
    assert r.run_pass(force=True) is not None
    assert len(yt.calls) == 1
    assert r.kick() == "skipped"


def test_pass_lock_is_exclusive(w: Any, yt: PlaylistYouTube, mono: Mono) -> None:
    insert_channels(w.db, [cid(1)])
    seed_channel(w, yt, 1)
    lock = {"owner": "outro", "expires_at": w.clock.now() + 60}
    w.db.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)", (D.META_DETAILS_LOCK, json.dumps(lock))
    )
    r = resolver(w, yt, mono)
    assert r.run_pass(force=True) is None
    assert r.kick(force=True) == "running"
    assert yt.calls == []
    w.clock.advance(61)  # dead owner: the lease expires
    assert r.run_pass(force=True) is not None
    assert yt.calls


def test_kick_respects_the_gap_between_passes(w: Any, yt: PlaylistYouTube, mono: Mono) -> None:
    insert_channels(w.db, [cid(n) for n in range(4)])
    for n in range(4):
        seed_channel(w, yt, n, longs=1, shorts=0)
    r = resolver(w, yt, mono, requests_per_pass=2)
    assert r.kick(wait=True) == "started"
    assert len(yt.calls) == 2
    assert r.kick(wait=True) == "skipped"  # still within the interval between passes
    w.clock.advance(D.PASS_GAP_S)
    assert r.kick() == "started"  # in a thread
    assert r.wait_idle(5)
    assert len(yt.calls) == 4
    w.clock.advance(D.PASS_GAP_S)
    assert r.kick() == "skipped"  # nothing pending


def test_old_and_archived_videos_are_not_pending(w: Any, yt: PlaylistYouTube, mono: Mono) -> None:
    insert_channels(w.db, [cid(1)])
    now = w.clock.now()
    w.clock.advance(-30 * DAY)
    store(w, [vin(vid(1, 0), cid(1), published_at=now - 40 * DAY)])  # old, seen 30 days ago
    w.clock.advance(30 * DAY)
    store(w, [vin(vid(1, 1), cid(1), published_at=now - 60)])
    w.db.execute(
        "INSERT INTO video_state (video_id, state, updated_at) VALUES (?, 'archived', ?)",
        (vid(1, 1), now),
    )
    r = resolver(w, yt, mono)
    assert r.pending_count() == 0
    r.run_pass()
    assert yt.calls == []


# --------------------------------------------------------------------------- Refresher


def make_refresher(world: Any, yt: Any, mono: Mono, **kw: Any) -> R.Refresher:
    details = kw.pop("details", None) or resolver(world, yt, mono)
    return R.Refresher(
        db=world.db,
        settings=world.settings,
        youtube=yt,
        channels=world.channels,
        video_store=world.video_store,
        feed=world.feed,
        events=world.events,
        changelog=world.changelog,
        ext_endpoint_up=world.ext_endpoint_up,
        clock=world.clock,
        cold_start_pages=0,
        details=details,
        **kw,
    )


def _rss(channel: str, n: int, now: int, *, shorts: Sequence[int] = ()) -> T.RssFeed:
    videos = tuple(
        T.VideoIn(
            id=vid(n, j),
            channel_id=channel,
            title=f"v{j}",
            published_at=now - (j + 1) * 3600,
            is_short=True if j in shorts else None,
        )
        for j in range(5)
    )
    return T.RssFeed(channel=T.ChannelInfo(id=channel, title=f"C{n}"), videos=videos)


def test_durations_arrive_after_one_cycle_without_the_screen_asking(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1), cid(2)])
    for n in (1, 2):
        yt.add_rss(_rss(cid(n), n, now))
        yt.add_playlist(cid(n), [(vid(n, j), 30 if j == 4 else 500) for j in range(5)])
        yt.add_playlist(cid(n), [(vid(n, 4), None)], shorts=True)
    ref = make_refresher(w, yt, mono)
    assert ref.details_pending() == 0
    assert ref.kick_if_due(wait=True) == "started"
    assert ref.details_pending() == 0
    rows = w.db.query("SELECT id, duration_s, is_short FROM videos ORDER BY id")
    assert len(rows) == 10
    assert all(r["duration_s"] is not None and r["is_short"] is not None for r in rows)
    # the cycle spent no video-by-video Short checks (the playlist settles it)
    assert yt.page_calls() == []
    # GET /feed (real engine) asks YouTube for nothing, even with a pending video
    from tube_pkg.core import feed as F

    store(w, [vin(vid(9, 0), cid(1), published_at=now - 10)])
    engine = F.build(
        db=w.db,
        settings=w.settings,
        youtube=yt,
        video_store=w.video_store,
        lenses=[],
        tabs=w.tabs,
        taxonomy=w.taxonomy,
        channels=w.channels,
        video_state=w.video_state,
        clock=w.clock,
    )
    before = len(yt.calls)
    page = engine.page(T.BUILTIN_TAB_ALL_NEW, limit=30)
    assert len(page.items) == 11
    assert len(yt.calls) == before


def test_kick_if_due_skipped_still_starts_a_details_pass(
    w: Any, yt: PlaylistYouTube, mono: Mono
) -> None:
    now = w.clock.now()
    insert_channels(w.db, [cid(1)])
    yt.add_rss(_rss(cid(1), 1, now))
    ref = make_refresher(w, yt, mono)
    yt.fail("fetch_uploads_playlist", "UU" + cid(1)[2:], T.YouTubeError("HTTP 503", status=503))
    ref.kick_if_due(wait=True)
    assert row(w.db, vid(1, 0))["duration_s"] is None
    del yt.failures[("fetch_uploads_playlist", "UU" + cid(1)[2:])]
    yt.add_playlist(cid(1), [(vid(1, j), 500) for j in range(5)])
    w.clock.advance(D.RETRY_BASE_S)
    assert ref.kick_if_due() == "skipped"  # RSS is not due; the details fetch is
    assert ref.details.wait_idle(5)
    assert row(w.db, vid(1, 0)) == {"duration_s": 500, "is_short": 0}


def test_refresher_without_playlist_client_keeps_the_old_cycle(db: Any, clock: FakeClock) -> None:
    """Client without ``fetch_uploads_playlist``: the cycle's Short check as before, no
    details fetch, ``details_pending`` = ``None`` (``/status`` omits the field)."""
    plain = FakeYouTube()
    world = build_fake_world(db, clock=clock, youtube=plain)
    world.video_store = R.build_video_store(db=db, settings=world.settings, clock=clock)
    insert_channels(db, [cid(1)])
    plain.add_rss(_rss(cid(1), 1, clock.now()))
    ref = R.Refresher(
        db=db,
        settings=world.settings,
        youtube=plain,
        channels=world.channels,
        video_store=world.video_store,
        feed=world.feed,
        events=world.events,
        changelog=world.changelog,
        ext_endpoint_up=world.ext_endpoint_up,
        clock=clock,
        cold_start_pages=0,
    )
    ref.kick_if_due(wait=True)
    assert [c for c in plain.calls if c[0] == "is_short"]
    assert ref.details_pending() is None


# --------------------------------------------------------------------------- GET /status


def _check_status(env: Any) -> dict[str, Any]:
    import importlib.util
    import sys

    from tube_pkg.api import _common

    name = "_gen_types_b13"
    gen = sys.modules.get(name)
    if gen is None:
        spec = importlib.util.spec_from_file_location(
            name, TESTS.parent / "scripts" / "gen_types.py"
        )
        assert spec is not None and spec.loader is not None
        gen = importlib.util.module_from_spec(spec)
        sys.modules[name] = gen
        spec.loader.exec_module(gen)
    assert _common.is_envelope(env) and env["ok"] is True, env
    contract = gen.load_contract(TESTS.parent)
    op = gen.get_operation(contract, "getStatus")
    gen.validate_instance(op.data_schema, env["data"], TESTS.parent, current=op.doc, strict=True)
    return env["data"]


def test_status_says_how_many_videos_still_wait_for_details(
    w: Any, yt: PlaylistYouTube, mono: Mono, wire: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tube_pkg import wiring
    from tube_pkg.api import status as api_status

    insert_channels(w.db, [cid(1)])
    seed_channel(w, yt, 1)
    ref = make_refresher(w, yt, mono)
    wire.use_world(w)
    wire.set("refresher", ref)
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: None)
    now = w.clock.now()
    # RSS up to date and a recent pass: the query triggers nothing (the number stays put)
    w.db.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (T.META_LAST_RSS_AT, str(now)))
    w.db.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        (D.META_DETAILS_STATE, json.dumps({"c": {}, "v": {}, "last": now})),
    )
    api_status.reset()
    try:
        data = _check_status(api_status.get_status(None, {}))
        assert data["details_pending"] == 5
        ref.details.run_pass(force=True)
        api_status.reset()
        data = _check_status(api_status.get_status(None, {}))
        assert data["details_pending"] == 0
        # fetch disabled (client without playlists): the field goes away, never a false 0
        plain = make_refresher(w, FakeYouTube(), mono, details=resolver(w, FakeYouTube(), mono))
        wire.set("refresher", plain)
        api_status.reset()
        data = _check_status(api_status.get_status(None, {}))
        assert "details_pending" not in data
    finally:
        api_status.reset()


# --------------------------------------------------------------------------- end to end


def test_real_client_over_fake_http_resolves_every_rss_video(db: Any, clock: FakeClock) -> None:
    """Real client (``core/youtube.py`` + ``core/http.Client``) over fake HTTP with the saved RSS
    feeds and playlists: after one cycle, the 30 videos have duration and kind; cost = 2 uploads
    playlists + 1 Shorts playlist (Veritasium's RSS without the ``/shorts/`` link, to force it)."""
    from tube_pkg.core import http as H

    hits: list[str] = []
    rss = {
        FIRESHIP: (FIX / "rss" / "fireship.xml").read_bytes(),
        VERITASIUM: (FIX / "rss" / "veritasium.xml")
        .read_bytes()
        .replace(b"/shorts/", b"/watch?v="),
    }

    def transport(req: Any) -> T.HttpResponse:
        hits.append(req.url)
        path, _, query = req.url.partition("?")
        if path.endswith("/feeds/videos.xml"):
            for channel, body in rss.items():
                if channel in query:
                    return T.HttpResponse(200, req.url, {}, body)
        if path.endswith("/playlist"):
            for name in ("uploads", "shorts"):
                for channel in (FIRESHIP, VERITASIUM):
                    pid = Y.uploads_playlist_id(channel, shorts=name == "shorts")
                    f = FIX / "playlist" / f"{name}.{pid}.html"
                    if f"list={pid}&" in query + "&" and f.exists():
                        return T.HttpResponse(
                            200, req.url, {"content-type": "text/html"}, f.read_bytes()
                        )
        return T.HttpResponse(404, req.url, {}, b"")

    clock.set(1_794_300_000)  # 2026-11-10 (the dates of the saved RSS feeds)
    settings = FakeSettings()
    client = Y.build(
        http=H.Client(settings=settings, transport=transport, sleep=lambda _s: None),
        settings=settings,
        clock=clock,
    )
    world = build_fake_world(db, clock=clock, youtube=client)
    world.video_store = R.build_video_store(db=db, settings=world.settings, clock=clock)
    insert_channels(db, [FIRESHIP, VERITASIUM])
    mono = Mono()
    ref = make_refresher(world, client, mono)
    assert ref.kick_if_due(wait=True) == "started"
    rows = db.query("SELECT id, duration_s, is_short FROM videos")
    assert len(rows) == 30
    assert all(r["duration_s"] and r["is_short"] is not None for r in rows), rows
    assert sum(r["is_short"] for r in rows) == 10  # Veritasium's 10 Shorts
    assert row(db, "rL0qEmTRI-I") == {"duration_s": 86, "is_short": 1}
    assert row(db, "KfODG5REyss") == {"duration_s": 3956, "is_short": 0}
    lists = sorted(u.split("list=")[1].split("&")[0] for u in hits if "/playlist" in u)
    assert lists == sorted(["UU" + FIRESHIP[2:], "UU" + VERITASIUM[2:], "UUSH" + VERITASIUM[2:]])
    assert not [u for u in hits if "/watch" in u or "/shorts/" in u]
    # nothing requested again
    hits.clear()
    clock.advance(R.DEFAULT_INTERVAL_MIN * 60)
    ref.kick_if_due(wait=True)
    assert not [u for u in hits if "/playlist" in u]


def test_details_pass_never_blocks_long(w: Any, yt: PlaylistYouTube) -> None:
    """With the real clock: the pass respects the deadline and releases the lock."""
    insert_channels(w.db, [cid(1)])
    seed_channel(w, yt, 1)
    r = D.DetailsResolver(
        db=w.db, video_store=w.video_store, youtube=yt, clock=w.clock, spacing_s=0.01
    )
    t0 = time.monotonic()
    assert r.run_pass() is not None
    assert time.monotonic() - t0 < 2
    assert w.db.query_one("SELECT value FROM meta WHERE key = ?", (D.META_DETAILS_LOCK,)) is None
