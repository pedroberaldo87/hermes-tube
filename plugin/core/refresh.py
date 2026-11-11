"""RSS refresh and reads: ``VideoStore`` (owner of ``videos``) and ``Refresher`` (owner of
``watermarks`` and of the RSS ``meta`` keys).

Rules:

- **Cross-process lock** — ``meta.refresh_lock`` = JSON ``{"owner", "expires_at", ...}`` with a
  lease (``lease_s``). Checking the interval and taking the lock happen in a single
  ``Db.transaction()`` (``BEGIN IMMEDIATE``): gateway, plugin host, cron and ``hermes chat`` never
  run two cycles at the same time. The owner renews the lease while it works; dead owner → the
  lease expires → someone else takes over.
- **Non-blocking** — ``kick_if_due`` only runs a short transaction and starts a (daemon) thread
  with the caller's context (``contextvars.copy_context``); ``wait=True`` runs on the calling
  thread (cron script). The ``Db`` arrives ready as a parameter: the core never reads the
  environment to find the database/profile.
- **Pace** — up to ``workers`` (4) channels at once; database writes only on the coordinating
  thread, in short transactions (no network inside a transaction).
- **First sight** — a channel without a watermark gets ``seen_up_to = now − 7 days`` (like
  MyTube): only the last week counts as new.
- **On-demand Short** — ``YouTubeClient.is_short`` downloads ~1 MB per Short: only for a few
  freshly arrived videos per cycle (``shorts_per_cycle``) or when someone asks
  (``resolve_shorts``).

RSS outage — YouTube's feed server goes down almost every US night (≈ 01–07 UTC; 404/500 for every
channel, sporadic 200) while the pages stay up:

- **An RSS 404/5xx is a feed failure, never "channel is gone"**: nothing is deleted and no
  relation changes. Only the channel **page** (404 or the "This channel does not exist." alert)
  becomes a "does not exist" error.
- **Detection** — window of the last ``OUTAGE_PROBE`` (8) RSS responses; ≥ 75 % 404/5xx → the
  cycle is in "RSS down": it stops requesting RSS and switches to plan B
  (``fetch_channel_uploads``, the ``/videos`` page, ~40× the RSS) with a **budget**
  ``FALLBACK_PAGES_PER_CYCLE``, in the order ⭐ favourites → channels with no stored video →
  served longest ago. Outside the budget, the channel stays as is (the feed serves what it has).
  At the start of the cycle only 8 RSS requests go out until the decision.
- **State** — ``META_RSS_DOWN_SINCE`` and ``META_RSS_FALLBACK_CHANNELS`` while the outage lasts
  (``rss_outage()``); they disappear on the first healthy cycle. During the outage, the
  ``kick_if_due`` interval drops to ``OUTAGE_RETRY_S``.
- **Dates** — the page only says "3 days ago": an approximate date never overwrites a stored
  date; the RSS, once back, overwrites the approximate one with the exact one (same id, no
  duplicate).
- **One channel** (``refresh_channel``/``kick_channel``): RSS 404/5xx → page right away.
"""

from __future__ import annotations

import contextvars
import json
import logging
import math
import os
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field, replace
from typing import Any, Literal

from tube_pkg.core import dedup
from tube_pkg.core import types as T
from tube_pkg.core.details import DetailsResolver
from tube_pkg.core.youtube import is_channel_missing, is_feed_outage

log = logging.getLogger(__name__)

DAY = 86_400
WEEK = 7 * DAY

WORKERS = 4
"""Channels read at the same time."""
LEASE_S = 120
"""Lock lease; the owner renews it every ``LEASE_S / 4``."""
CYCLE_TIMEOUT_S = 600.0
"""Cap of a cycle started by ``kick_if_due`` (400 channels ≈ 100 s)."""
DEFAULT_INTERVAL_MIN = 30
FIRST_SIGHT_WINDOW_S = WEEK
"""Channel seen for the first time: videos within this window count as new."""
SHORTS_PER_CYCLE = 20
"""New videos of the cycle checked with ``is_short`` (most recent first)."""
SHORTS_RECENT_S = WEEK
"""Only videos published within this window enter the cycle's check."""
SHORTS_ON_DEMAND_LIMIT = 50
STATS_FLUSH_EVERY = 50
"""Stats and watermarks written every N channels (a timeout cut does not lose everything)."""
_RENEW_MAX_WAIT_S = 5.0
_CHUNK = 500
_FILL_ONLY = frozenset({"channel_id", "channel_title", "title", "description"})
"""Fields a ``search`` hit (sent by a paired device) may only fill when empty, never rewrite: a
hit cannot move a known video to another channel nor put its own text in the title/description."""

OUTAGE_PROBE = 8
"""Size of the window of RSS responses that decides an outage (= 2 rounds of 4 at once). At the
start of the cycle only these 8 requests go out until the decision."""
OUTAGE_RATIO = 0.75
"""Share of 404/5xx in the window that declares "RSS down" (6 of 8). In the measured outage
(2026-11-09) it was 100 % with sporadic 200s; in a healthy cycle a deleted channel is rare (and
those the page already confirmed as deleted are not counted): even with 10 % dead channels, 6 of
8 in a row ≈ 3e-5."""
FALLBACK_PAGES_PER_CYCLE = 12
"""Plan B budget per cycle. A page ≈ 1.35 MB (≈ 300 KB gzipped) ≈ 40× the RSS: 12 pages cost as
much as an RSS cycle of ~480 channels. Every ``OUTAGE_RETRY_S`` ≤ 72 pages/h."""
OUTAGE_RETRY_S = 10 * 60
COLD_RETRY_S = 10
"""Channels no cycle has seen yet (freshly loaded demo, first sync, import) do not wait for
``rss_interval_min``: ``kick_if_due`` runs again once this slack has passed since the last
cycle. Measured live (2026-11-10): the first ``/status`` poll wrote ``last_rss_at`` with zero
channels and the demo loaded right after stayed 30 min without any video."""
COLD_START_PAGES = 48
"""Page cap in one cycle when there are channels **with no stored video** (fresh install, demo of
40 channels): measured live at ~0.4 s per page with 4 in parallel."""
"""``kick_if_due`` interval while the RSS is down (normal: ``rss_interval_min``, 30 min). Each
attempt costs 8 RSS requests (~1.6 KB each on 404) + the page budget."""
GONE_RECHECK_S = DAY
"""A channel the page already reported as missing: the cycle does not pay for another page for it
before this (``refresh_channel`` always checks)."""

META_RSS_DOWN_SINCE = "rss_down_since"
"""Instant (s) at which the cycle detected the RSS outage; cleared on the first healthy cycle."""
META_RSS_FALLBACK_CHANNELS = "rss_fallback_channels"
"""Distinct channels served by plan B since ``rss_down_since``."""
META_RSS_CHANNELS = "rss_channels"
"""JSON ``{channel_id: {"ok": ts, "via": "rss"|"page", "gone": ts}}``: last good read of each
channel (budget order) and when the page said it does not exist."""

_ACTIVE_SQL = "('subscribed', 'followed')"

KickResult = Literal["started", "skipped", "running"]


def _chunks(items: Sequence[Any], size: int = _CHUNK) -> Iterator[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _marks(n: int) -> str:
    return ",".join("?" for _ in range(n))


def _filled(value: Any) -> bool:
    return value is not None and value != ""


def _opt_int(value: Any, *, minimum: int = 0) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= minimum else None


def _video_from_row(row: Mapping[str, Any]) -> T.Video:
    return T.Video(
        id=row["id"],
        channel_id=row["channel_id"],
        title=row["title"],
        published_at=row["published_at"],
        description=row["description"],
        channel_title=row["channel_title"],
        duration_s=row["duration_s"],
        is_short=None if row["is_short"] is None else bool(row["is_short"]),
        views=row["views"],
        first_seen_at=int(row["first_seen_at"]),
        origin=T.VideoOrigin(row["origin"]),
    )


# ============================================================================ VideoStore


class VideoStore:
    """``VideoStore`` over the ``videos`` table; the plugin's only writer of videos."""

    def __init__(self, *, db: T.Db, settings: T.Settings, clock: T.Clock | None = None) -> None:
        self.db = db
        self.settings = settings
        self.clock = clock or T.SystemClock()

    def _existing(self, ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for part in _chunks(list(ids)):
            rows = self.db.query(f"SELECT * FROM videos WHERE id IN ({_marks(len(part))})", part)
            out.update({r["id"]: r for r in rows})
        return out

    def upsert(self, videos: Sequence[T.VideoIn], origin: T.VideoOrigin) -> T.UpsertCount:
        """Insert or update in one transaction, idempotent (fixed contract rule).

        A video with an invalid id (≠ 11 characters) is skipped with a log warning — one bad
        item does not bring down the importer's batch (HN, list, search).
        """
        try:
            origin = T.VideoOrigin(origin)
        except ValueError as exc:
            raise T.ValidationError(f"invalid video origin: {origin!r}") from exc
        valid: list[T.VideoIn] = []
        for v in videos:
            if dedup.is_video_id(v.id):
                valid.append(v)
            else:
                log.warning("VideoStore.upsert: invalid video id skipped: %r", v.id)
        if not valid:
            return T.UpsertCount()
        now = self.clock.now()
        inserted = updated = 0
        with self.db.transaction():
            current = self._existing(list(dict.fromkeys(v.id for v in valid)))
            for v in valid:
                row = current.get(v.id)
                is_short = None if v.is_short is None else int(bool(v.is_short))
                if row is None:
                    record = {
                        "id": v.id,
                        "channel_id": v.channel_id or "",
                        "channel_title": v.channel_title or None,
                        "title": v.title or "",
                        "description": v.description or None,
                        "published_at": _opt_int(v.published_at),
                        "duration_s": _opt_int(v.duration_s),
                        "is_short": is_short,
                        "views": _opt_int(v.views),
                        "first_seen_at": now,
                        "origin": origin.value,
                        "updated_at": now,
                    }
                    cols = ", ".join(record)
                    self.db.execute(
                        f"INSERT INTO videos ({cols}) VALUES ({_marks(len(record))})",
                        tuple(record.values()),
                    )
                    current[v.id] = record
                    inserted += 1
                    continue
                changes: dict[str, Any] = {}
                incoming = {
                    "title": v.title,
                    "channel_id": v.channel_id,
                    "channel_title": v.channel_title,
                    "published_at": _opt_int(v.published_at),
                    "description": v.description,
                    "views": _opt_int(v.views),
                }
                for name, value in incoming.items():
                    if not _filled(value) or value == row[name]:
                        continue
                    if origin is T.VideoOrigin.search and name in _FILL_ONLY and _filled(row[name]):
                        continue
                    changes[name] = value
                duration = _opt_int(v.duration_s)
                if duration is not None and row["duration_s"] is None:
                    changes["duration_s"] = duration
                if is_short is not None and row["is_short"] is None:
                    changes["is_short"] = is_short
                if changes:
                    sets = ", ".join(f"{k} = ?" for k in changes)
                    self.db.execute(
                        f"UPDATE videos SET {sets}, updated_at = ? WHERE id = ?",
                        (*changes.values(), now, v.id),
                    )
                    current[v.id] = {**row, **changes}
                    updated += 1
        return T.UpsertCount(inserted=inserted, updated=updated)

    def set_details(self, video_id: str, duration_s: int | None, is_short: bool | None) -> None:
        """Store duration/Short found on demand (``None`` = leave as is)."""
        if duration_s is not None and (
            isinstance(duration_s, bool) or not isinstance(duration_s, int) or duration_s < 0
        ):
            raise T.ValidationError(f"invalid duration: {duration_s!r}", field="duration_s")
        with self.db.transaction():
            if self.db.query_one("SELECT id FROM videos WHERE id = ?", (video_id,)) is None:
                raise T.NotFound(f"video {video_id} does not exist", video_id=video_id)
            changes: dict[str, Any] = {}
            if duration_s is not None:
                changes["duration_s"] = duration_s
            if is_short is not None:
                changes["is_short"] = int(bool(is_short))
            if changes:
                sets = ", ".join(f"{k} = ?" for k in changes)
                self.db.execute(
                    f"UPDATE videos SET {sets}, updated_at = ? WHERE id = ?",
                    (*changes.values(), self.clock.now(), video_id),
                )

    def fill_details(self, updates: Mapping[str, tuple[int | None, bool | None]]) -> int:
        """``{video_id: (duration, is_short)}`` in one transaction, **only where empty** (never
        overwrites what the RSS or another source already stored); ``None`` = leave as is; a
        missing video is ignored. Returns how many videos changed."""
        changed = 0
        now = self.clock.now()
        with self.db.transaction():
            for video_id, (duration, short) in updates.items():
                duration = _opt_int(duration)
                if duration is None and short is None:
                    continue
                flag = None if short is None else int(bool(short))
                res = self.db.execute(
                    "UPDATE videos SET duration_s = COALESCE(duration_s, ?),"
                    " is_short = COALESCE(is_short, ?), updated_at = ?"
                    " WHERE id = ? AND ((duration_s IS NULL AND ? IS NOT NULL)"
                    " OR (is_short IS NULL AND ? IS NOT NULL))",
                    (duration, flag, now, video_id, duration, flag),
                )
                changed += int(res.rowcount or 0)
        return changed

    def get(self, ids: Sequence[str]) -> dict[str, T.Video]:
        """Only the existing ones, in the requested order."""
        wanted = list(dict.fromkeys(ids))
        if not wanted:
            return {}
        rows = self._existing(wanted)
        return {i: _video_from_row(rows[i]) for i in wanted if i in rows}


# ============================================================================ Refresher


def _channel_stats(
    channel_id: str,
    feed: T.RssFeed,
    shorts: Mapping[str, bool | None],
    now: int,
    *,
    page_dates: Sequence[int] | None = None,
) -> T.ChannelStats:
    """Channel stats from the RSS window (up to 15 videos).

    ``videos_per_week`` = videos ÷ weeks between the oldest one and now (at least 1 week), so a
    dormant channel shows up slowly; ``shorts_ratio`` treats unknown ``is_short`` as not a Short
    (the RSS already marks ``/shorts/``).

    Plan B (*page_dates* = stored dates of the page's videos): the ``/videos`` page does not list
    Shorts and only gives approximate dates, so only ``last_video_at`` (from the stored date,
    which keeps the exact one when it exists), title and avatar; pace and Shorts ratio stay as
    they are.
    """
    title = (feed.channel.title or "").strip() or None
    if page_dates is not None:
        return T.ChannelStats(
            channel_id=channel_id,
            last_video_at=max(page_dates) if page_dates else None,
            title=title,
            thumb=feed.channel.thumb,
        )
    dates = [v.published_at for v in feed.videos if v.published_at]
    rate = None
    if dates:
        span = max(now - min(dates), WEEK)
        rate = round(len(dates) / (span / WEEK), 3)
    ratio = None
    if feed.videos:
        ratio = sum(1 for v in feed.videos if shorts.get(v.id)) / len(feed.videos)
    return T.ChannelStats(
        channel_id=channel_id,
        last_video_at=max(dates) if dates else None,
        videos_per_week=rate,
        shorts_ratio=ratio,
        title=title,
        thumb=feed.channel.thumb,
    )


def _gone_message(entry: Mapping[str, Any]) -> str:
    when = _opt_int(entry.get("gone"))
    since = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(when)) if when else "earlier"
    return f"channel does not exist on YouTube (RSS and channel page 404; checked {since})"


class _LockLost(Exception):
    """The lock expired and another process took over: the cycle stops."""


class _Cycle:
    """State of one cycle (all channels or one)."""

    def __init__(self, total: int, started_at: int) -> None:
        self.total = total
        self.started_at = started_at
        self.done = 0
        self.new_videos = 0
        self.errors: dict[str, str] = {}
        self.partial = False
        self.stats: list[T.ChannelStats] = []
        self.sighted: list[str] = []
        """Channels read successfully (first-sight watermark, if missing)."""
        self.fresh: list[tuple[int, str]] = []
        """(published_at, video_id) of videos inserted in this cycle without ``is_short``."""
        # RSS outage
        self.window: deque[bool] = deque(maxlen=OUTAGE_PROBE)
        """Latest RSS responses with an HTTP status: ``True`` = 404/5xx."""
        self.rss_results = 0
        self.rss_ok = 0
        self.rss_submitted: set[str] = set()
        self.rss_failed: dict[str, str] = {}
        """Channels whose RSS gave 404/5xx in this cycle → message (decided later)."""
        self.outage = False
        self.pages: list[str] = []
        """Channels served by plan B in this cycle."""
        self.marks: dict[str, dict[str, Any]] = {}
        """``META_RSS_CHANNELS`` updates not written yet."""


@dataclass
class _Lease:
    """Cycle deadline and lock renewal (owner ``None`` = no lock: one channel)."""

    owner: str | None
    deadline: float
    renew_every: float
    renew_wait: float
    last_mono: float = field(default_factory=time.monotonic)
    last_clock: int = 0


class Refresher:
    """``Refresher``: RSS of all/one channel, watermarks, reads and ``GET /status``."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        youtube: T.YouTubeClient,
        channels: T.ChannelService,
        video_store: T.VideoStore,
        feed: T.FeedEngine,
        events: T.EventSink,
        changelog: T.ChangeLog,
        ext_endpoint_up: Callable[[], bool],
        clock: T.Clock | None = None,
        lease_s: float = LEASE_S,
        workers: int = WORKERS,
        shorts_per_cycle: int = SHORTS_PER_CYCLE,
        cycle_timeout: float = CYCLE_TIMEOUT_S,
        fallback_budget: int = FALLBACK_PAGES_PER_CYCLE,
        cold_start_pages: int = COLD_START_PAGES,
        details: DetailsResolver | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.youtube = youtube
        self.channels = channels
        self.video_store = video_store
        self.feed = feed
        self.events = events
        self.changelog = changelog
        self.ext_endpoint_up = ext_endpoint_up
        self.clock = clock or T.SystemClock()
        self.lease_s = max(float(lease_s), 1.0)
        self.workers = max(int(workers), 1)
        self.shorts_per_cycle = max(int(shorts_per_cycle), 0)
        self.cycle_timeout = float(cycle_timeout)
        self.fallback_budget = max(int(fallback_budget), 0)
        self.cold_start_pages = max(int(cold_start_pages), 0)
        self._channel_mx = threading.Lock()
        self._channels_active: set[str] = set()
        self.details = (
            details
            if details is not None
            else DetailsResolver(db=db, video_store=video_store, youtube=youtube, clock=self.clock)
        )
        """Duration and kind of every video in the background (``core/details``); off when the
        client cannot read playlists (old fakes)."""

    # ------------------------------------------------------------------ meta and lock

    def _meta(self, key: str) -> str | None:
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (key,))
        return None if row is None else row["value"]

    def _set_meta(self, key: str, value: str) -> None:
        self.db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def _read_lock(self) -> dict[str, Any] | None:
        raw = self._meta(T.META_REFRESH_LOCK)
        if not raw:
            return None
        try:
            lock = json.loads(raw)
            int(lock["expires_at"])
            str(lock["owner"])
        except (ValueError, TypeError, KeyError):
            log.warning("RSS lock unreadable in meta; treated as expired: %r", raw[:200])
            return None
        return lock if isinstance(lock, dict) else None

    def _lock_valid(self, lock: Mapping[str, Any] | None, now: int) -> bool:
        return lock is not None and int(lock["expires_at"]) > now

    def _interval_s(self) -> int:
        raw = self.settings.get("rss_interval_min", DEFAULT_INTERVAL_MIN)
        minutes = _opt_int(raw, minimum=1)
        return (minutes or DEFAULT_INTERVAL_MIN) * 60

    def _acquire(self, *, force: bool, check_due: bool) -> tuple[KickResult, str | None]:
        """Check and take the lock in a ``BEGIN IMMEDIATE`` transaction."""
        with self.db.transaction():
            now = self.clock.now()
            if self._lock_valid(self._read_lock(), now):
                return "running", None
            if check_due and not force:
                last = self.last_rss_at()
                interval = self._interval_s()
                if self._meta(META_RSS_DOWN_SINCE):
                    interval = min(interval, OUTAGE_RETRY_S)  # RSS down: try again sooner
                if (
                    last is not None
                    and now - last < interval
                    and (now - last < COLD_RETRY_S or not self._has_unseen_channels())
                ):
                    return "skipped", None
            owner = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"
            lock = {
                "owner": owner,
                "expires_at": now + int(self.lease_s),
                "pid": os.getpid(),
                "started_at": now,
            }
            self._set_meta(T.META_REFRESH_LOCK, json.dumps(lock))
        return "started", owner

    def _renew(self, owner: str) -> bool:
        with self.db.transaction():
            lock = self._read_lock()
            if lock is None or lock.get("owner") != owner:
                return False
            lock["expires_at"] = self.clock.now() + int(self.lease_s)
            self._set_meta(T.META_REFRESH_LOCK, json.dumps(lock))
        return True

    def _release(self, owner: str, *, finished_at: int | None) -> None:
        """Release the lock (if still ours) and write ``last_rss_at`` in the same transaction."""
        try:
            with self.db.transaction():
                lock = self._read_lock()
                ours = lock is not None and lock.get("owner") == owner
                if finished_at is not None and (ours or lock is None):
                    self._set_meta(T.META_LAST_RSS_AT, str(int(finished_at)))
                if ours:
                    self.db.execute("DELETE FROM meta WHERE key = ?", (T.META_REFRESH_LOCK,))
        except Exception:  # noqa: BLE001 - releasing the lock never breaks the caller
            log.exception("failed to release the RSS lock (expires by itself in %ss)", self.lease_s)

    # ------------------------------------------------------------------ cycle

    def _has_unseen_channels(self) -> bool:
        """Is there an active channel no cycle has seen (no entry in the per-channel state) that
        ``kick_channel`` is not fetching right now? Every cycle marks the channels it got
        (``_run``), so a channel that only fails stops counting: only a **new** channel counts."""
        active = self._active_channel_ids()
        if not active:
            return False
        state = self._channel_state()
        with self._channel_mx:
            busy = set(self._channels_active)
        return any(c not in state and c not in busy for c in active)

    def _active_channel_ids(self) -> list[str]:
        rows = self.db.query(
            f"SELECT id FROM channels WHERE relation IN {_ACTIVE_SQL} ORDER BY favorite DESC, id"
        )
        return [r["id"] for r in rows]

    def _progress(self, fn: T.ProgressFn | None, cycle: _Cycle) -> None:
        if fn is None:
            return
        try:
            fn(T.Progress(stage="rss", done=cycle.done, total=cycle.total))
        except Exception:  # noqa: BLE001
            log.exception("on_progress raised; ignored")

    def _store_feed(
        self,
        channel_id: str,
        feed: T.RssFeed,
        cycle: _Cycle,
        known: bool,
        *,
        approximate: bool = False,
    ) -> None:
        """Store the feed's videos (``origin=rss``). *approximate* (plan B): the page's approximate
        date only goes into a new or undated video; it never overwrites a stored one (the RSS's
        exact one or the first approximation, which is the most precise). The RSS always
        overwrites."""
        videos = [
            v if v.channel_id else replace(v, channel_id=channel_id)
            for v in feed.videos
            if dedup.is_video_id(v.id)
        ]
        ids = [v.id for v in videos]
        current = self.video_store.get(ids) if ids else {}
        before = set(current)
        if approximate:
            videos = [
                replace(v, published_at=None)
                if v.id in current and current[v.id].published_at is not None
                else v
                for v in videos
            ]
        count = self.video_store.upsert(videos, T.VideoOrigin.rss)
        cycle.new_videos += count.inserted
        stored = self.video_store.get(ids) if ids else {}
        for v in videos:
            row = stored.get(v.id)
            if v.id not in before and row is not None and row.is_short is None:
                cycle.fresh.append((row.published_at or 0, v.id))
        if known:
            shorts = {i: s.is_short for i, s in stored.items()}
            page_dates = (
                [r.published_at for r in stored.values() if r.published_at] if approximate else None
            )
            cycle.stats.append(
                _channel_stats(
                    channel_id,
                    replace(feed, videos=tuple(videos)),
                    shorts,
                    self.clock.now(),
                    page_dates=page_dates,
                )
            )
            cycle.sighted.append(channel_id)
        mark: dict[str, Any] = {"ok": self.clock.now(), "via": "page" if approximate else "rss"}
        cycle.marks[channel_id] = mark

    # ------------------------------------------------------------------ per-channel state

    def _channel_state(self) -> dict[str, dict[str, Any]]:
        raw = self._meta(META_RSS_CHANNELS)
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            log.warning("RSS channel state unreadable in meta; starting from scratch")
            return {}
        if not isinstance(data, dict):
            return {}
        return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, dict)}

    def _save_marks(self, cycle: _Cycle) -> None:
        marks, cycle.marks = cycle.marks, {}
        if not marks:
            return
        with self.db.transaction():
            state = self._channel_state()
            for cid, mark in marks.items():
                entry = dict(state.get(cid) or {})
                if "ok" in mark:
                    entry.pop("gone", None)
                entry.update(mark)
                state[cid] = entry
            self._set_meta(META_RSS_CHANNELS, json.dumps(state, separators=(",", ":")))

    def _prune_state(self) -> None:
        """Forget channels that left the table (the map does not grow forever)."""
        with self.db.transaction():
            state = self._channel_state()
            if not state:
                return
            alive: set[str] = set()
            ids = list(state)
            for part in _chunks(ids):
                rows = self.db.query(
                    f"SELECT id FROM channels WHERE id IN ({_marks(len(part))})", part
                )
                alive.update(r["id"] for r in rows)
            if len(alive) != len(state):
                kept = {k: v for k, v in state.items() if k in alive}
                self._set_meta(META_RSS_CHANNELS, json.dumps(kept, separators=(",", ":")))

    def _fallback_order(
        self, candidates: Iterable[str], state: Mapping[str, Mapping[str, Any]]
    ) -> list[str]:
        """Budget order: ⭐ favourites → no stored video → oldest last good read (never read = 0)
        → id."""
        ids = list(dict.fromkeys(candidates))
        favorite: set[str] = set()
        with_videos: set[str] = set()
        for part in _chunks(ids):
            marks = _marks(len(part))
            rows = self.db.query(
                f"SELECT id FROM channels WHERE favorite = 1 AND id IN ({marks})", part
            )
            favorite.update(r["id"] for r in rows)
            rows = self.db.query(
                f"SELECT DISTINCT channel_id FROM videos WHERE channel_id IN ({marks})", part
            )
            with_videos.update(r["channel_id"] for r in rows)

        def key(cid: str) -> tuple[int, int, int, str]:
            ok = _opt_int((state.get(cid) or {}).get("ok")) or 0
            return (0 if cid in favorite else 1, 1 if cid in with_videos else 0, ok, cid)

        return sorted(ids, key=key)

    def _cycle_fallback_budget(self, candidates: Iterable[str]) -> int:
        """Page budget of the cycle. Cold start: someone who just installed and loaded the demo or
        their first subscriptions during an outage needs to see videos **now**. Channels with no
        stored video all go in up to ``cold_start_pages``; after that, the normal budget."""
        if self.fallback_budget <= 0:
            return 0
        if self.cold_start_pages <= self.fallback_budget:
            return self.fallback_budget
        ids = list(dict.fromkeys(candidates))
        with_videos: set[str] = set()
        for part in _chunks(ids):
            rows = self.db.query(
                f"SELECT DISTINCT channel_id FROM videos WHERE channel_id IN ({_marks(len(part))})",
                part,
            )
            with_videos.update(r["channel_id"] for r in rows)
        empty = len(ids) - len(with_videos)
        return max(self.fallback_budget, min(empty, self.cold_start_pages))

    def _fallback_fn(self) -> Callable[[str], T.RssFeed] | None:
        """The client's ``fetch_channel_uploads``, if any (the ``Protocol`` does not have it
        yet)."""
        fn = getattr(self.youtube, "fetch_channel_uploads", None)
        return fn if callable(fn) else None

    def _flush(self, cycle: _Cycle) -> None:
        stats, cycle.stats = cycle.stats, []
        sighted, cycle.sighted = cycle.sighted, []
        try:
            self._save_marks(cycle)
        except Exception:  # noqa: BLE001 - auxiliary state does not bring down the cycle
            log.exception("failed to save the RSS per-channel state")
        if stats:
            try:
                self.channels.update_stats(stats)
            except Exception:  # noqa: BLE001 - stats do not bring down the cycle
                log.exception("ChannelService.update_stats failed for %d channels", len(stats))
        if sighted:
            seen_up_to = self.clock.now() - FIRST_SIGHT_WINDOW_S
            with self.db.transaction():
                for cid in sighted:
                    self.db.execute(
                        "INSERT INTO watermarks (channel_id, seen_up_to) SELECT ?, ?"
                        " WHERE EXISTS (SELECT 1 FROM channels WHERE id = ?)"
                        " ON CONFLICT(channel_id) DO NOTHING",
                        (cid, seen_up_to, cid),
                    )

    def _pump(
        self,
        cycle: _Cycle,
        lease: _Lease,
        fetch: Callable[[str], T.RssFeed],
        next_id: Callable[[], str | None],
        handle: Callable[[str, Future[T.RssFeed]], None],
        *,
        prefix: str,
    ) -> None:
        """Up to ``workers`` simultaneous fetches; the coordinating thread writes, renews the lock
        and cuts at the deadline (``partial``). *next_id* returns ``None`` to stop submitting (end
        or decision)."""
        in_flight: dict[Future[T.RssFeed], str] = {}
        pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix=prefix)

        def submit_next() -> None:
            cid = next_id()
            if cid is not None:
                ctx = contextvars.copy_context()
                in_flight[pool.submit(ctx.run, fetch, cid)] = cid

        try:
            for _ in range(self.workers):
                submit_next()
            while in_flight:
                remaining = lease.deadline - time.monotonic()
                if remaining <= 0:
                    cycle.partial = True
                    break
                finished, _ = wait(
                    list(in_flight),
                    timeout=min(remaining, lease.renew_wait),
                    return_when=FIRST_COMPLETED,
                )
                for fut in finished:
                    handle(in_flight.pop(fut), fut)
                if len(cycle.stats) >= STATS_FLUSH_EVERY:
                    self._flush(cycle)
                if lease.owner is not None and (
                    time.monotonic() - lease.last_mono >= lease.renew_every
                    or self.clock.now() - lease.last_clock >= lease.renew_every
                ):
                    if not self._renew(lease.owner):
                        log.warning("RSS lock lost (lease expired); cycle interrupted")
                        cycle.partial = True
                        raise _LockLost()
                    lease.last_mono, lease.last_clock = time.monotonic(), self.clock.now()
                # after an outage decision, the free slots are all used at once
                while len(in_flight) < self.workers:
                    before = len(in_flight)
                    submit_next()
                    if len(in_flight) == before:
                        break
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    def _run(
        self,
        channel_ids: Sequence[str],
        *,
        owner: str | None,
        timeout: float,
        on_progress: T.ProgressFn | None,
        single: bool = False,
    ) -> _Cycle:
        """Phase 1: RSS (only ``OUTAGE_PROBE`` requests until deciding whether the RSS is down;
        sliding window afterwards). Phase 2: plan B through the page for channels whose RSS
        answered 404/5xx — and, with the RSS down, also for those not even requested — within the
        budget (*single*: no budget or intervals; it is the channel the person asked for)."""
        channel_ids = list(dict.fromkeys(channel_ids))
        cycle = _Cycle(total=len(channel_ids), started_at=self.clock.now())
        known = set()
        for part in _chunks(channel_ids):
            rows = self.db.query(f"SELECT id FROM channels WHERE id IN ({_marks(len(part))})", part)
            known.update(r["id"] for r in rows)
        now = self.clock.now()
        state = self._channel_state()
        # "this channel has been through a cycle": success replaces the mark with ``ok``; failure
        # keeps it and stops counting as new in ``_has_unseen_channels``
        for c in channel_ids:
            if c in known and c not in state:
                cycle.marks[c] = {"seen": now}
        gone_recent = set()
        if not single:
            gone_recent = {
                c
                for c, s in state.items()
                if (_opt_int(s.get("gone")) or -GONE_RECHECK_S) > now - GONE_RECHECK_S
            }
        probe_size = min(OUTAGE_PROBE, len(channel_ids))
        threshold = math.ceil(OUTAGE_RATIO * probe_size)
        renew_every = self.lease_s / 4
        lease = _Lease(
            owner=owner,
            deadline=time.monotonic() + max(float(timeout), 0.0),
            renew_every=renew_every,
            renew_wait=min(renew_every, _RENEW_MAX_WAIT_S),
            last_clock=now,
        )
        self._progress(on_progress, cycle)
        pending = iter(channel_ids)

        def decided() -> bool:
            return (
                cycle.outage
                or cycle.rss_results >= probe_size
                or cycle.rss_ok > probe_size - threshold
            )

        def next_rss() -> str | None:
            if cycle.outage:
                return None  # RSS down: stop insisting
            if not decided() and len(cycle.rss_submitted) >= probe_size:
                return None  # wait for the probe to decide
            cid = next(pending, None)
            if cid is not None:
                cycle.rss_submitted.add(cid)
            return cid

        def on_rss(cid: str, fut: Future[T.RssFeed]) -> None:
            cycle.rss_results += 1
            try:
                feed = fut.result()
            except T.TubeError as exc:
                if is_feed_outage(exc):
                    cycle.rss_failed[cid] = exc.message  # decided later: page or wait
                    if (
                        cid not in gone_recent
                    ):  # a channel already reported as deleted does not count
                        cycle.window.append(True)
                else:
                    cycle.errors[cid] = exc.message
                    cycle.done += 1
            except Exception as exc:  # noqa: BLE001 - one channel does not bring down the cycle
                log.exception("RSS of %s failed", cid)
                cycle.errors[cid] = f"unexpected error: {exc}"
                cycle.done += 1
            else:
                cycle.rss_ok += 1
                cycle.window.append(False)
                try:
                    self._store_feed(cid, feed, cycle, cid in known)
                except T.TubeError as exc:
                    cycle.errors[cid] = exc.message
                except Exception as exc:  # noqa: BLE001
                    log.exception("saving RSS of %s failed", cid)
                    cycle.errors[cid] = f"unexpected error: {exc}"
                cycle.done += 1
            if not cycle.outage and probe_size and sum(cycle.window) >= threshold:
                cycle.outage = True
                (log.info if single else log.warning)(
                    "YouTube RSS is down (%d of %d responses 404/5xx); plan B through the page",
                    sum(cycle.window),
                    len(cycle.window),
                )
            self._progress(on_progress, cycle)

        try:
            self._pump(
                cycle,
                lease,
                self.youtube.fetch_channel_rss,
                next_rss,
                on_rss,
                prefix="tube-rss",
            )
            if not cycle.partial:
                self._run_fallback(
                    cycle,
                    lease,
                    channel_ids,
                    known=known,
                    state=state,
                    gone_recent=gone_recent,
                    single=single,
                    on_progress=on_progress,
                )
        finally:
            self._flush(cycle)
        if not cycle.partial:
            cycle.done = cycle.total
            self._progress(on_progress, cycle)
        if not cycle.partial and self.shorts_per_cycle and cycle.fresh and not self._details_on():
            # no details fetch (client without playlists): Short check video by video
            floor = self.clock.now() - SHORTS_RECENT_S
            recent = sorted((p for p in cycle.fresh if p[0] >= floor), reverse=True)
            budget = max(lease.deadline - time.monotonic(), 0.0)
            if recent and budget > 0:
                ids = [v for _, v in recent[: self.shorts_per_cycle]]
                self.resolve_shorts(ids, limit=self.shorts_per_cycle, timeout=min(budget, 60.0))
        return cycle

    def _run_fallback(
        self,
        cycle: _Cycle,
        lease: _Lease,
        channel_ids: Sequence[str],
        *,
        known: set[str],
        state: Mapping[str, Mapping[str, Any]],
        gone_recent: set[str],
        single: bool,
        on_progress: T.ProgressFn | None,
    ) -> None:
        """Phase 2 of the cycle (plan B through the ``/videos`` page)."""
        fetch = self._fallback_fn()
        now = self.clock.now()
        if cycle.outage:
            candidates = [
                c for c in channel_ids if c in cycle.rss_failed or c not in cycle.rss_submitted
            ]
        else:
            candidates = [c for c in channel_ids if c in cycle.rss_failed]
        if not single:
            candidates = [c for c in candidates if c not in gone_recent]
            if cycle.outage:
                # served less than one normal interval ago: does not spend budget again
                fresh_after = now - self._interval_s()
                candidates = [
                    c
                    for c in candidates
                    if (_opt_int((state.get(c) or {}).get("ok")) or 0) <= fresh_after
                ]
        chosen: list[str] = []
        if fetch is not None and candidates:
            budget = len(candidates) if single else self._cycle_fallback_budget(candidates)
            chosen = self._fallback_order(candidates, state)[:budget]
        attempted = set(chosen)
        # channels that do not go to the page: error only if the channel's RSS failed alone
        # (healthy cycle) or the page already said it does not exist; during an outage, it stays
        # as is (the feed serves what it has)
        for cid, message in cycle.rss_failed.items():
            if cid in attempted:
                continue
            if cid in gone_recent:
                cycle.errors[cid] = _gone_message(state.get(cid) or {})
            elif not cycle.outage:
                cycle.errors[cid] = message
        if not chosen or fetch is None:
            return
        queue = iter(chosen)

        def on_page(cid: str, fut: Future[T.RssFeed]) -> None:
            try:
                feed = fut.result()
                self._store_feed(cid, feed, cycle, cid in known, approximate=True)
            except T.TubeError as exc:
                if is_channel_missing(exc):
                    cycle.marks[cid] = {"gone": self.clock.now()}
                    cycle.errors[cid] = (
                        f"channel does not exist on YouTube (RSS and channel page): {exc.message}"
                    )
                else:
                    rss = cycle.rss_failed.get(cid, "RSS is down")
                    cycle.errors[cid] = f"{rss}; plan B (channel page) failed: {exc.message}"
            except Exception as exc:  # noqa: BLE001 - one channel does not bring down the cycle
                log.exception("page of %s failed", cid)
                cycle.errors[cid] = f"unexpected error in plan B: {exc}"
            else:
                cycle.pages.append(cid)
            cycle.done += 1  # the page's channel had not been counted in the RSS phase
            self._progress(on_progress, cycle)

        self._pump(cycle, lease, fetch, lambda: next(queue, None), on_page, prefix="tube-page")

    def _report(self, cycle: _Cycle) -> T.RefreshReport:
        return T.RefreshReport(
            channels=cycle.total,
            new_videos=cycle.new_videos,
            errors=dict(cycle.errors),
            started_at=cycle.started_at,
            finished_at=self.clock.now(),
            partial=cycle.partial,
        )

    def _emit_done(self, report: T.RefreshReport, channel_id: str | None = None) -> None:
        payload: dict[str, Any] = {
            "channels": report.channels,
            "new_videos": report.new_videos,
            "errors": len(report.errors),
            "partial": report.partial,
            "finished_at": report.finished_at,
        }
        if channel_id is not None:
            payload["channel_id"] = channel_id
        try:
            self.events.broadcast("refresh.done", payload)
        except Exception:  # noqa: BLE001 - evento acelera, consulta garante
            log.exception("broadcast of refresh.done failed")

    def _cycle_all(
        self, owner: str, *, timeout: float, on_progress: T.ProgressFn | None
    ) -> T.RefreshReport:
        """Full cycle with the lock already taken; releases it and writes ``last_rss_at`` at the
        end."""
        finished_at: int | None = None
        try:
            cycle = self._run(
                self._active_channel_ids(), owner=owner, timeout=timeout, on_progress=on_progress
            )
            self._update_outage_meta(cycle)
            report = self._report(cycle)
            finished_at = report.finished_at
        except _LockLost:
            raise T.Busy("RSS lock lost to another process") from None
        finally:
            self._release(owner, finished_at=finished_at)
        self._emit_done(report)
        return report

    def _update_outage_meta(self, cycle: _Cycle) -> None:
        """Full cycle: RSS down → set/update ``rss_down_since`` and how many channels plan B has
        served since then; healthy cycle (some 200 and no outage) → delete both keys. A cycle
        with no RSS response at all (no network, timeout, zero channels) changes nothing."""
        try:
            if cycle.outage:
                with self.db.transaction():
                    since = _opt_int(self._meta(META_RSS_DOWN_SINCE)) or cycle.started_at
                    state = self._channel_state()
                    served = sum(
                        1
                        for s in state.values()
                        if s.get("via") == "page" and (_opt_int(s.get("ok")) or 0) >= since
                    )
                    self._set_meta(META_RSS_DOWN_SINCE, str(since))
                    self._set_meta(META_RSS_FALLBACK_CHANNELS, str(served))
            elif cycle.rss_ok > 0:
                with self.db.transaction():
                    self.db.execute(
                        "DELETE FROM meta WHERE key IN (?, ?)",
                        (META_RSS_DOWN_SINCE, META_RSS_FALLBACK_CHANNELS),
                    )
            self._prune_state()
        except Exception:  # noqa: BLE001 - display state does not bring down the cycle
            log.exception("failed to save the RSS outage state")

    def rss_outage(self) -> dict[str, int] | None:
        """``{"down_since", "fallback_channels"}`` while YouTube's RSS is down (last full cycle),
        else ``None``. For ``StatusSnapshot``/screens ("YouTube's feed is down; showing what we
        already have")."""
        since = _opt_int(self._meta(META_RSS_DOWN_SINCE))
        if since is None:
            return None
        served = _opt_int(self._meta(META_RSS_FALLBACK_CHANNELS)) or 0
        return {"down_since": since, "fallback_channels": served}

    def _cycle_in_thread(self, owner: str) -> None:
        try:
            self._cycle_all(owner, timeout=self.cycle_timeout, on_progress=None)
        except T.Busy as exc:
            log.warning("RSS cycle interrupted: %s", exc.message)
        except Exception:  # noqa: BLE001 - a background thread never raises
            log.exception("RSS cycle failed")
        # right after the cycle (new videos just arrived), on the same thread
        self._kick_details(force=True, wait=True)

    # ------------------------------------------------------------------ duration and kind

    def _details_on(self) -> bool:
        try:
            return bool(self.details.enabled())
        except Exception:  # noqa: BLE001
            return False

    def _kick_details(self, *, force: bool = False, wait: bool = False) -> None:
        """Duration/Short fetch (``core/details``); never raises to the caller."""
        if not self._details_on():
            return
        try:
            self.details.kick(force=force, wait=wait)
        except Exception:  # noqa: BLE001
            log.exception("duration/Shorts fetch could not start")

    def details_pending(self) -> int | None:
        """Videos (in the window of the "new" tabs) still lacking duration or kind that the
        background fetch will request; ``None`` when the fetch is off (``GET /status`` omits the
        field)."""
        if not self._details_on():
            return None
        try:
            return int(self.details.pending_count())
        except Exception:  # noqa: BLE001
            log.exception("count of pending details failed")
            return None

    # ------------------------------------------------------------------ Protocol Refresher

    def refresh_all(
        self, *, timeout: float = 600.0, on_progress: T.ProgressFn | None = None
    ) -> T.RefreshReport:
        """Blocking: RSS of all ``subscribed``/``followed`` channels. Another cycle running →
        ``Busy``."""
        result, owner = self._acquire(force=True, check_due=False)
        if owner is None:
            raise T.Busy("RSS refresh in progress", state=result)
        return self._cycle_all(owner, timeout=timeout, on_progress=on_progress)

    def refresh_channel(self, channel_id: str, *, timeout: float = 30.0) -> T.RefreshReport:
        """Blocking: one channel (does not write ``last_rss_at``; does not use the cycle lock)."""
        if not dedup.is_channel_id(channel_id):
            raise T.ValidationError(f"invalid channel id: {channel_id!r}", field="channel_id")
        cycle = self._run([channel_id], owner=None, timeout=timeout, on_progress=None, single=True)
        report = self._report(cycle)
        self._emit_done(report, channel_id)
        return report

    def kick_if_due(self, force: bool = False, *, wait: bool = False) -> KickResult:
        """Non-blocking unless ``wait=True`` (cron script: runs the cycle on the calling thread)."""
        result, owner = self._acquire(force=force, check_due=True)
        if owner is None:
            if result == "skipped":  # RSS up to date: the details fetch moves on its own
                self._kick_details(wait=wait)
            return result
        if wait:
            self._cycle_in_thread(owner)
        else:
            ctx = contextvars.copy_context()
            threading.Thread(
                target=ctx.run,
                args=(self._cycle_in_thread, owner),
                name="tube-rss-cycle",
                daemon=True,
            ).start()
        return "started"

    def kick_channel(self, channel_id: str) -> Literal["started", "running"]:
        """Non-blocking: one channel in a thread; same channel already in progress → ``running``."""
        if not dedup.is_channel_id(channel_id):
            raise T.ValidationError(f"invalid channel id: {channel_id!r}", field="channel_id")
        with self._channel_mx:
            if channel_id in self._channels_active:
                return "running"
            self._channels_active.add(channel_id)

        def job() -> None:
            try:
                self.refresh_channel(channel_id)
            except Exception:  # noqa: BLE001
                log.exception("refresh of channel %s failed", channel_id)
            finally:
                with self._channel_mx:
                    self._channels_active.discard(channel_id)

        ctx = contextvars.copy_context()
        try:
            threading.Thread(
                target=ctx.run, args=(job,), name="tube-rss-channel", daemon=True
            ).start()
        except BaseException:
            with self._channel_mx:
                self._channels_active.discard(channel_id)
            raise
        return "started"

    def kick_channel_active(self, channel_id: str) -> bool:
        """``True`` while this process's ``kick_channel`` is still working on the channel."""
        with self._channel_mx:
            return channel_id in self._channels_active

    def is_running(self) -> bool:
        return self._lock_valid(self._read_lock(), self.clock.now())

    def last_rss_at(self) -> T.Timestamp | None:
        raw = self._meta(T.META_LAST_RSS_AT)
        if not raw:
            return None
        try:
            return int(float(raw))
        except ValueError:
            return None

    # ------------------------------------------------------------------ Short on demand

    def resolve_shorts(
        self,
        video_ids: Sequence[str],
        *,
        limit: int = SHORTS_ON_DEMAND_LIMIT,
        timeout: float = 20.0,
    ) -> dict[str, bool]:
        """``YouTubeClient.is_short`` for stored videos with unknown ``is_short`` (in the given
        order, up to *limit*), 4 at a time; stores through ``VideoStore.set_details``. An error on
        one video only leaves it out. Returns ``video_id → is_short`` of what was resolved."""
        wanted = [v for v in dict.fromkeys(video_ids) if dedup.is_video_id(v)]
        known = self.video_store.get(wanted)
        todo = [v for v in wanted if v in known and known[v].is_short is None][: max(limit, 0)]
        if not todo:
            return {}
        out: dict[str, bool] = {}
        deadline = time.monotonic() + max(timeout, 0.0)
        pool = ThreadPoolExecutor(max_workers=min(self.workers, len(todo)))
        try:
            futures = {
                pool.submit(contextvars.copy_context().run, self.youtube.is_short, v): v
                for v in todo
            }
            not_done = set(futures)
            while not_done:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                finished, not_done = wait(not_done, timeout=remaining, return_when=FIRST_COMPLETED)
                for fut in finished:
                    v = futures[fut]
                    try:
                        value = bool(fut.result())
                        self.video_store.set_details(v, None, value)
                    except T.TubeError as exc:
                        log.info("is_short(%s) got no answer: %s", v, exc.message)
                        continue
                    except Exception:  # noqa: BLE001
                        log.exception("is_short(%s) failed", v)
                        continue
                    out[v] = value
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        return out

    # ------------------------------------------------------------------ reads

    def _tab_channels(self, scope: T.ReadScope) -> list[str]:
        """``ReadScope(kind=tab)`` → channels the tab shows, via the feed engine (same rules as
        ``GET /feed?tab=``). Resolved **before** the write transaction."""
        if not scope.id:
            raise T.ValidationError("a tab is required to mark as read", field="id")
        resolve = getattr(self.feed, "tab_channels", None)
        if not callable(resolve):
            raise T.ValidationError(
                "marking a tab as read is unavailable in this engine", field="kind"
            )
        return [str(c) for c in resolve(scope.id)]

    def _read_targets(
        self, scope: T.ReadScope, tab_channels: Sequence[str] | None = None
    ) -> list[dict[str, Any]]:
        base = (
            "SELECT c.id AS id, w.seen_up_to AS seen_up_to,"
            " (SELECT MAX(v.published_at) FROM videos v WHERE v.channel_id = c.id) AS max_pub"
            " FROM channels c LEFT JOIN watermarks w ON w.channel_id = c.id"
        )
        kind = T.ReadScopeKind(scope.kind)
        if kind is T.ReadScopeKind.tab:
            rows: list[dict[str, Any]] = []
            for chunk in _chunks(list(tab_channels or ())):
                rows += self.db.query(base + f" WHERE c.id IN ({_marks(len(chunk))})", tuple(chunk))
            return rows
        if kind is T.ReadScopeKind.channel:
            if not scope.id:
                raise T.ValidationError("a channel is required to mark as read", field="id")
            rows = self.db.query(base + " WHERE c.id = ?", (scope.id,))
            if not rows:
                raise T.NotFound(f"channel {scope.id} does not exist", channel_id=scope.id)
            return rows
        if kind is T.ReadScopeKind.folder:
            if not scope.id:
                raise T.ValidationError("a folder is required to mark as read", field="id")
            if self.db.query_one("SELECT id FROM folders WHERE id = ?", (scope.id,)) is None:
                raise T.NotFound(f"folder {scope.id} does not exist", folder_id=scope.id)
            return self.db.query(
                "WITH RECURSIVE d(id) AS (SELECT ? UNION SELECT f.id FROM folders f"
                " JOIN d ON f.parent_id = d.id) "
                + base
                + f" WHERE c.folder_id IN (SELECT id FROM d) AND c.relation IN {_ACTIVE_SQL}",
                (scope.id,),
            )
        return self.db.query(base + f" WHERE c.relation IN {_ACTIVE_SQL}")

    def mark_read(self, scope: T.ReadScope, *, actor: T.Actor = T.Actor.user) -> int:
        """Move ``seen_up_to`` to ``max(now, the channel's newest video)`` (a scheduled premiere
        is marked read too); records ``mark_read``; returns how many channels changed."""
        return self.mark_read_changes(scope, actor=actor)[0]

    def mark_read_changes(
        self, scope: T.ReadScope, *, actor: T.Actor = T.Actor.user
    ) -> tuple[int, tuple[int, ...]]:
        """``mark_read`` + ids of the history entries (empty when nothing changed). Tab
        (``kind=tab``): the channels ``FeedEngine.tab_channels`` says it shows."""
        try:
            kind = T.ReadScopeKind(scope.kind)
        except ValueError as exc:
            raise T.ValidationError(f"invalid scope: {scope.kind!r}", field="kind") from exc
        tab_channels = self._tab_channels(scope) if kind is T.ReadScopeKind.tab else None
        with self.db.transaction():
            now = self.clock.now()
            before: dict[str, int | None] = {}
            targets: dict[str, int] = {}
            for row in self._read_targets(scope, tab_channels):
                target = max(now, int(row["max_pub"] or 0))
                current = row["seen_up_to"]
                if current is None or int(current) < target:
                    before[row["id"]] = None if current is None else int(current)
                    targets[row["id"]] = target
            if not targets:
                return 0, ()
            for cid, target in targets.items():
                self.db.execute(
                    "INSERT INTO watermarks (channel_id, seen_up_to) VALUES (?, ?)"
                    " ON CONFLICT(channel_id) DO UPDATE SET seen_up_to = excluded.seen_up_to",
                    (cid, target),
                )
            rec = self.changelog.record(
                actor,
                T.ChangeAction.mark_read,
                {"scope": kind.value, "id": scope.id, "count": len(targets)},
                T.UndoMarkRead(before=before),
            )
        return len(targets), ((int(rec.id),) if rec is not None else ())

    def apply_undo(self, change: T.ChangeRecord) -> None:
        undo = change.undo
        if change.action is not T.ChangeAction.mark_read or not isinstance(undo, T.UndoMarkRead):
            raise T.UndoRefused("not_undoable", f"the Refresher cannot undo {change.action}")
        for cid, prev in undo.before.items():
            if prev is None:
                self.db.execute("DELETE FROM watermarks WHERE channel_id = ?", (cid,))
            else:
                self.db.execute(
                    "INSERT INTO watermarks (channel_id, seen_up_to) SELECT ?, ?"
                    " WHERE EXISTS (SELECT 1 FROM channels WHERE id = ?)"
                    " ON CONFLICT(channel_id) DO UPDATE SET seen_up_to = excluded.seen_up_to",
                    (cid, int(prev), cid),
                )

    # ------------------------------------------------------------------ status

    def _count(self, sql: str, params: Sequence[Any] = ()) -> int:
        row = self.db.query_one(sql, params)
        return int(row["n"]) if row and row["n"] is not None else 0

    def channel_totals(self) -> dict[str, int]:
        """``channels_total`` (``subscribed``+``followed``, muted included — the same ``total`` as
        ``GET /channels?relation=subscribed,followed``) and ``subscribed_total``. One query over
        the ``relation`` index."""
        row = self.db.query_one(
            f"SELECT COUNT(*) AS active, COALESCE(SUM(relation = 'subscribed'), 0) AS subs"
            f" FROM channels WHERE relation IN {_ACTIVE_SQL}"
        )
        if row is None:
            return {"channels_total": 0, "subscribed_total": 0}
        return {
            "channels_total": int(row["active"] or 0),
            "subscribed_total": int(row["subs"] or 0),
        }

    def status(self) -> T.StatusSnapshot:
        """Body of ``GET /status``; read-only (triggers nothing). A tab engine failure becomes
        zeroed counts: the chip keeps answering."""
        now = self.clock.now()
        try:
            counts = self.feed.new_counts()
        except Exception:  # noqa: BLE001
            log.exception("FeedEngine.new_counts failed; /status without counts")
            counts = None
        tabs: tuple[T.TabCount, ...] = ()
        fav_new: list[T.FavNew] = []
        if counts is not None:
            tabs = tuple(
                T.TabCount(
                    tab_id=t["id"],
                    name=t["name"],
                    icon=t["icon"],
                    count=int(counts.by_tab.get(t["id"], 0)),
                )
                for t in self.db.query("SELECT id, name, icon FROM tabs ORDER BY sort, id")
            )
            favorites = self.db.query(
                f"SELECT id, title FROM channels WHERE favorite = 1 AND relation IN {_ACTIVE_SQL}"
                " ORDER BY title, id"
            )
            for fav in favorites:
                n = int(counts.by_channel.get(fav["id"], 0))
                if not n:
                    continue
                latest = self.db.query_one(
                    "SELECT id, title FROM videos WHERE channel_id = ?"
                    " ORDER BY published_at DESC, id LIMIT 1",
                    (fav["id"],),
                )
                fav_new.append(
                    T.FavNew(
                        channel_id=fav["id"],
                        title=fav["title"],
                        count=n,
                        latest_video_id=latest["id"] if latest else None,
                        latest_title=latest["title"] if latest else None,
                    )
                )
        try:
            ext_up = bool(self.ext_endpoint_up())
        except Exception:  # noqa: BLE001
            log.exception("ext_endpoint_up failed")
            ext_up = False
        outage = self.rss_outage() or {}
        return T.StatusSnapshot(
            rss_down_since=outage.get("down_since"),
            rss_fallback_channels=int(outage.get("fallback_channels", 0)),
            new_total=int(counts.total) if counts is not None else 0,
            new_by_tab=tabs,
            fav_new=tuple(fav_new),
            ext_endpoint_up=ext_up,
            last_rss_at=self.last_rss_at(),
            refresh_running=self.is_running(),
            queue_pending=self._count(
                "SELECT COUNT(*) AS n FROM unsub_queue WHERE status = 'approved'"
            ),
            search_pending=self._count(
                "SELECT COUNT(*) AS n FROM search_jobs WHERE status = 'pending' AND expires_at > ?",
                (now,),
            ),
            devices_online=self._count(
                "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL AND last_seen >= ?",
                (now - int(T.DEVICE_ONLINE_WINDOW_S),),
            ),
        )


# ============================================================================ build


def build_video_store(
    *, db: T.Db, settings: T.Settings, clock: T.Clock | None = None
) -> T.VideoStore:
    """``VideoStore`` over *db*. No network, no thread."""
    return VideoStore(db=db, settings=settings, clock=clock)


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    youtube: T.YouTubeClient,
    channels: T.ChannelService,
    video_store: T.VideoStore,
    feed: T.FeedEngine,
    events: T.EventSink,
    changelog: T.ChangeLog,
    ext_endpoint_up: Callable[[], bool],
    clock: T.Clock | None = None,
) -> T.Refresher:
    """``Refresher`` with the ``Db`` already resolved (never looks for a database/profile in the
    environment). No network and no thread: threads are only started in
    ``kick_if_due``/``kick_channel``."""
    return Refresher(
        db=db,
        settings=settings,
        youtube=youtube,
        channels=channels,
        video_store=video_store,
        feed=feed,
        events=events,
        changelog=changelog,
        ext_endpoint_up=ext_endpoint_up,
        clock=clock,
    )


__all__ = [
    "CYCLE_TIMEOUT_S",
    "FALLBACK_PAGES_PER_CYCLE",
    "FIRST_SIGHT_WINDOW_S",
    "GONE_RECHECK_S",
    "LEASE_S",
    "META_RSS_CHANNELS",
    "META_RSS_DOWN_SINCE",
    "META_RSS_FALLBACK_CHANNELS",
    "OUTAGE_PROBE",
    "OUTAGE_RATIO",
    "OUTAGE_RETRY_S",
    "SHORTS_PER_CYCLE",
    "WORKERS",
    "Refresher",
    "VideoStore",
    "build",
    "build_video_store",
]
