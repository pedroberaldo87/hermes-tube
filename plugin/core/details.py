"""Duration and kind (Short or regular video) of every video, in the background.

RSS carries no duration and only marks a Short when the link is ``/shorts/``. This piece fills
``videos.duration_s`` and ``videos.is_short`` **outside** the ``GET /feed`` path, after each
refresh cycle and on every ``kick_if_due`` (the screen's ``/status`` poll), without the screen
asking.

Sources (measured live on 2026-11-10):

1. **Channel uploads playlist** (``/playlist?list=UU…``): the 100 most recent uploads, newest
   first, with the duration in the badge — **Shorts included**. One request resolves the duration
   of everything RSS brought from the channel.
2. **Shorts playlist** (``UUSH…``), only when some video of the channel still has an open kind
   (duration ≤ ``LONG_FROM_S``): whoever is in it is a Short; whoever is in the uploads playlist
   and not in it is not (the Shorts among the 100 most recent uploads are the channel's most
   recent Shorts, so they are among the 100 of ``UUSH``). A channel without Shorts answers
   "The playlist does not exist." → nobody is a Short.
3. Duration > ``LONG_FROM_S`` (Shorts go up to 3 min) → not a Short, no request at all.
4. **Last resort**, with a low cap (``SINGLES_PER_PASS`` videos per pass): a video that was not
   in the playlist (too old, live, scheduled, channel not in the table) → ``/shorts/<id>``
   (200 = Short, with the duration on the page itself; 303 = regular video, 0 bytes) and, if the
   duration is still missing, ``/watch``.

Rules:

- **Budget and pace** — at most ``REQUESTS_PER_PASS`` requests per pass (a channel already
  started may exceed the cap by 1 so the uploads playlist is not paid twice), one at a time, with
  ``SPACING_S`` between the start of one and the next; ``PASS_GAP_S`` between passes; deadline
  ``PASS_TIMEOUT_S``. No bursts.
- **Persistent** — what is resolved stays in the database and is not requested again. Attempt
  state lives in ``meta.details_state`` (JSON): channel ``{"ok": ts, "n": failures, "next": ts}``,
  video ``{"n", "next"}``, ``throttle`` and ``last``. Failure → retry with exponential backoff
  (``RETRY_BASE_S`` · 2ⁿ⁻¹ up to ``RETRY_MAX_S``). HTTP 429 → stops the pass and waits
  ``THROTTLE_S``.
- **Priority** — ⭐ favourites → channels with a **new** video lacking data → most recent video →
  id.
- **Window** — videos published in the last ``WINDOW_S`` (what the "new" tabs show), undated, or
  stored in the last ``RECENT_SEEN_S`` (freshly loaded demo/import); archived videos are left out.
- **Lock** — ``meta.details_lock`` with a lease (``LEASE_S``): one pass at a time across
  processes.
- ``build``/the constructor do no network and start no thread; a client without
  ``fetch_uploads_playlist`` (old fakes) → everything off (``enabled() is False``), nothing written.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import threading
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from tube_pkg.core import dedup
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

DAY = 86_400
SHORT_MAX_S = 180
"""Maximum duration of a Short (3 min since Oct 2024)."""
LONG_FROM_S = SHORT_MAX_S + 5
"""Above this it is not a Short (rounding slack of the badge)."""
WINDOW_S = 30 * DAY
RECENT_SEEN_S = 7 * DAY
REQUESTS_PER_PASS = 40
"""Requests per pass (a playlist page is ≈ 300 KB gzipped, like ``/videos``)."""
SINGLES_PER_PASS = 6
"""Videos per pass through the last resort (video page: 1–2 requests each)."""
SPACING_S = 0.75
PASS_GAP_S = 30
PASS_TIMEOUT_S = 240.0
RETRY_BASE_S = 10 * 60
RETRY_MAX_S = DAY
THROTTLE_S = 30 * 60
LEASE_S = 300

META_DETAILS_STATE = "details_state"
META_DETAILS_LOCK = "details_lock"

KickResult = Literal["started", "skipped", "running"]


@dataclass
class PassReport:
    """Summary of one pass (log, tests, live bench)."""

    requests: int = 0
    channels: int = 0
    singles: int = 0
    resolved: int = 0
    throttled: bool = False
    errors: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class _Row:
    id: str
    channel_id: str
    published_at: int
    first_seen_at: int
    duration_s: int | None
    is_short: bool | None
    is_new: bool
    favorite: bool
    in_table: bool

    @property
    def need_duration(self) -> bool:
        return self.duration_s is None

    @property
    def need_kind(self) -> bool:
        return self.is_short is None and not (
            self.duration_s is not None and self.duration_s > LONG_FROM_S
        )

    @property
    def pending(self) -> bool:
        return self.need_duration or self.need_kind


class _Throttled(Exception):
    """YouTube answered 429: the pass stops."""


def _int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _status(err: BaseException) -> int | None:
    details = getattr(err, "details", None)
    return _int(details.get("status")) if isinstance(details, Mapping) else None


def backoff_s(failures: int) -> int:
    """Backoff after *failures* consecutive failures (1 → ``RETRY_BASE_S``)."""
    n = max(int(failures), 1)
    return int(min(RETRY_BASE_S * 2 ** min(n - 1, 20), RETRY_MAX_S))


class DetailsResolver:
    """See the module docstring."""

    def __init__(
        self,
        *,
        db: T.Db,
        video_store: T.VideoStore,
        youtube: T.YouTubeClient,
        clock: T.Clock | None = None,
        sleep: Callable[[float], None] | None = None,
        monotonic: Callable[[], float] | None = None,
        requests_per_pass: int = REQUESTS_PER_PASS,
        singles_per_pass: int = SINGLES_PER_PASS,
        spacing_s: float = SPACING_S,
        pass_gap_s: float = PASS_GAP_S,
        pass_timeout_s: float = PASS_TIMEOUT_S,
    ) -> None:
        self.db = db
        self.video_store = video_store
        self.youtube = youtube
        self.clock = clock or T.SystemClock()
        self._sleep = sleep or time.sleep
        self._mono = monotonic or time.monotonic
        self.requests_per_pass = max(int(requests_per_pass), 0)
        self.singles_per_pass = max(int(singles_per_pass), 0)
        self.spacing_s = max(float(spacing_s), 0.0)
        self.pass_gap_s = max(float(pass_gap_s), 0.0)
        self.pass_timeout_s = float(pass_timeout_s)
        self._mx = threading.Lock()
        self._thread: threading.Thread | None = None
        self._last_start: float | None = None
        # per pass
        self._requests = 0
        self._deadline = 0.0

    # ------------------------------------------------------------------ public

    def enabled(self) -> bool:
        """The client can read the uploads playlist (the real one can; old fakes cannot)."""
        return callable(getattr(self.youtube, "fetch_uploads_playlist", None))

    def pending_count(self) -> int:
        """Window videos still lacking duration or kind that **will be fetched** (not in backoff
        and YouTube not throttling). ``GET /status`` shows it as ``details_pending``."""
        if not self.enabled():
            return 0
        now = self.clock.now()
        state = self._load()
        if (_int(state.get("throttle")) or 0) > now:
            return 0
        channels = state["c"]
        videos = state["v"]
        n = 0
        for row in self._rows(now):
            if not row.pending:
                continue
            cs = channels.get(row.channel_id) or {}
            if self._channel_route(row, cs):
                if (_int(cs.get("next")) or 0) > now:
                    continue
            elif (_int((videos.get(row.id) or {}).get("next")) or 0) > now:
                continue
            n += 1
        return n

    def kick(self, *, force: bool = False, wait: bool = False) -> KickResult:
        """Run a pass if it is time (``force``: no waiting for ``PASS_GAP_S`` nor checking pending
        work — after an RSS cycle). Does not block unless ``wait=True``."""
        if not self.enabled():
            return "skipped"
        with self._mx:
            if self._thread is not None and self._thread.is_alive():
                return "running"
        if not force and not self._due():
            return "skipped"
        result, owner = self._acquire(force=force)
        if owner is None:
            return result
        if wait:
            self._run_owned(owner)
            return "started"
        ctx = contextvars.copy_context()
        thread = threading.Thread(
            target=ctx.run, args=(self._run_owned, owner), name="tube-details", daemon=True
        )
        with self._mx:
            self._thread = thread
        try:
            thread.start()
        except BaseException:
            self._release(owner)
            raise
        return "started"

    def wait_idle(self, timeout: float | None = None) -> bool:
        """Wait for the pass in a thread of this process (tests, scripts). ``True`` if it ended."""
        with self._mx:
            thread = self._thread
        if thread is None:
            return True
        thread.join(timeout)
        return not thread.is_alive()

    def run_pass(self, *, force: bool = False) -> PassReport | None:
        """Pass on the calling thread. ``None``: disabled, another pass holds the lock or
        (without ``force``) before ``PASS_GAP_S``."""
        if not self.enabled():
            return None
        _, owner = self._acquire(force=force)
        if owner is None:
            return None
        return self._run_owned(owner)

    # ------------------------------------------------------------------ lock and state

    def _meta(self, key: str) -> str | None:
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (key,))
        return None if row is None else row["value"]

    def _set_meta(self, key: str, value: str) -> None:
        self.db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def _load(self) -> dict[str, Any]:
        raw = self._meta(META_DETAILS_STATE)
        data: Any = {}
        if raw:
            try:
                data = json.loads(raw)
            except ValueError:
                log.warning("details fetch state unreadable in meta; starting from scratch")
                data = {}
        if not isinstance(data, dict):
            data = {}
        out: dict[str, Any] = {k: v for k, v in data.items() if k not in ("c", "v")}
        for key in ("c", "v"):
            part = data.get(key)
            out[key] = (
                {k: dict(v) for k, v in part.items() if isinstance(k, str) and isinstance(v, dict)}
                if isinstance(part, dict)
                else {}
            )
        return out

    def _save(self, state: Mapping[str, Any]) -> None:
        self._set_meta(META_DETAILS_STATE, json.dumps(state, separators=(",", ":")))

    def _due(self) -> bool:
        now = self.clock.now()
        state = self._load()
        if (_int(state.get("throttle")) or 0) > now:
            return False
        last = _int(state.get("last"))
        if last is not None and now - last < self.pass_gap_s:
            return False
        return self.pending_count() > 0

    def _acquire(self, *, force: bool) -> tuple[KickResult, str | None]:
        with self.db.transaction():
            now = self.clock.now()
            raw = self._meta(META_DETAILS_LOCK)
            if raw:
                try:
                    lock = json.loads(raw)
                    if int(lock["expires_at"]) > now:
                        return "running", None
                except (ValueError, TypeError, KeyError):
                    log.warning("details fetch lock unreadable; treated as expired")
            if not force:
                last = _int(self._load().get("last"))
                if last is not None and now - last < self.pass_gap_s:
                    return "skipped", None
            owner = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"
            lock = {"owner": owner, "expires_at": now + LEASE_S, "pid": os.getpid()}
            self._set_meta(META_DETAILS_LOCK, json.dumps(lock))
        return "started", owner

    def _release(self, owner: str) -> None:
        try:
            with self.db.transaction():
                raw = self._meta(META_DETAILS_LOCK)
                try:
                    ours = bool(raw) and json.loads(raw or "{}").get("owner") == owner
                except ValueError:
                    ours = True
                if ours:
                    self.db.execute("DELETE FROM meta WHERE key = ?", (META_DETAILS_LOCK,))
        except Exception:  # noqa: BLE001 - the lock expires by itself
            log.exception("failed to release the details fetch lock (expires in %ss)", LEASE_S)

    # ------------------------------------------------------------------ reads

    def _rows(self, now: int) -> list[_Row]:
        rows = self.db.query(
            "SELECT v.id, v.channel_id, v.published_at, v.first_seen_at, v.duration_s,"
            " v.is_short, s.state AS s_state, w.seen_up_to AS seen_up_to,"
            " c.id AS c_id, c.favorite AS favorite"
            " FROM videos v"
            " LEFT JOIN video_state s ON s.video_id = v.id"
            " LEFT JOIN channels c ON c.id = v.channel_id"
            " LEFT JOIN watermarks w ON w.channel_id = v.channel_id"
            " WHERE (v.duration_s IS NULL OR v.is_short IS NULL)"
            " AND (s.state IS NULL OR s.state <> 'archived')"
            " AND (v.published_at IS NULL OR v.published_at = 0 OR v.published_at >= ?"
            " OR v.first_seen_at >= ?)",
            (now - WINDOW_S, now - RECENT_SEEN_S),
        )
        out: list[_Row] = []
        for r in rows:
            published = _int(r["published_at"]) or 0
            seen = _int(r["seen_up_to"])
            state = r["s_state"]
            out.append(
                _Row(
                    id=r["id"],
                    channel_id=r["channel_id"] or "",
                    published_at=published,
                    first_seen_at=_int(r["first_seen_at"]) or 0,
                    duration_s=_int(r["duration_s"]),
                    is_short=None if r["is_short"] is None else bool(r["is_short"]),
                    is_new=(state is None or state == "new") and (seen is None or published > seen),
                    favorite=bool(r["favorite"]),
                    in_table=r["c_id"] is not None,
                )
            )
        return out

    @staticmethod
    def _channel_route(row: _Row, cs: Mapping[str, Any]) -> bool:
        """Is the video still waiting for the channel playlist (a table channel that no good read
        has seen since the video arrived)? Otherwise it goes to the last resort."""
        if not row.in_table or not dedup.is_channel_id(row.channel_id):
            return False
        ok = _int(cs.get("ok"))
        return ok is None or row.first_seen_at > ok

    # ------------------------------------------------------------------ pass

    def _run_owned(self, owner: str) -> PassReport:
        report = PassReport()
        try:
            self._pass(report)
        except Exception:  # noqa: BLE001 - a background pass never raises
            log.exception("duration/Shorts fetch failed")
        finally:
            self._release(owner)
            with self._mx:
                if self._thread is threading.current_thread():
                    self._thread = None
        if report.requests or report.resolved:
            log.info(
                "details: %d requests, %d channels, %d single videos, %d resolved%s",
                report.requests,
                report.channels,
                report.singles,
                report.resolved,
                " (429: paused)" if report.throttled else "",
            )
        return report

    def _pass(self, report: PassReport) -> None:
        now = self.clock.now()
        state = self._load()
        self._requests = 0
        self._deadline = self._mono() + self.pass_timeout_s
        try:
            if (_int(state.get("throttle")) or 0) > now:
                report.throttled = True
                return
            state.pop("throttle", None)
            rows = self._rows(now)
            # 3. long duration → not a Short (no request)
            report.resolved += self._fill(
                {r.id: (None, False) for r in rows if r.is_short is None and not r.need_kind}
            )
            try:
                self._channels_phase(rows, state, now, report)
                self._singles_phase(self._rows(now), state, now, report)
            except _Throttled:
                report.throttled = True
                state["throttle"] = now + THROTTLE_S
                log.warning("YouTube throttled the requests (429); duration fetch paused")
        finally:
            report.requests = self._requests
            state["last"] = self.clock.now()
            self._prune(state)
            try:
                with self.db.transaction():
                    self._save(state)
            except Exception:  # noqa: BLE001
                log.exception("failed to save the details fetch state")

    def _prune(self, state: dict[str, Any]) -> None:
        pending = {r.id: r for r in self._rows(self.clock.now()) if r.pending}
        state["v"] = {k: v for k, v in state["v"].items() if k in pending}
        keep = {r.channel_id for r in pending.values()}
        rows = self.db.query("SELECT id FROM channels")
        keep.update(r["id"] for r in rows)
        state["c"] = {k: v for k, v in state["c"].items() if k in keep}

    def _budget_left(self) -> bool:
        return self._requests < self.requests_per_pass and self._mono() < self._deadline

    def _pace(self) -> None:
        """Wait until ``SPACING_S`` after the start of the previous request; count the request."""
        if self._last_start is not None:
            wait_s = self._last_start + self.spacing_s - self._mono()
            if wait_s > 0:
                self._sleep(wait_s)
        self._last_start = self._mono()
        self._requests += 1

    def _fill(self, updates: Mapping[str, tuple[int | None, bool | None]]) -> int:
        updates = {k: v for k, v in updates.items() if v[0] is not None or v[1] is not None}
        if not updates:
            return 0
        fill = getattr(self.video_store, "fill_details", None)
        if callable(fill):
            return int(fill(updates))
        changed = 0  # VideoStore without the extra (fake): field by field
        for vid, (duration, short) in updates.items():
            try:
                self.video_store.set_details(vid, duration, short)
                changed += 1
            except T.TubeError:
                continue
        return changed

    # ---------------------------------------------------------------- 1–2: channel playlists

    def _channels_phase(
        self, rows: Sequence[_Row], state: dict[str, Any], now: int, report: PassReport
    ) -> None:
        by_channel: dict[str, list[_Row]] = {}
        for r in rows:
            if r.pending:
                by_channel.setdefault(r.channel_id, []).append(r)
        candidates: list[tuple[tuple[int, int, int, str], str]] = []
        for cid, items in by_channel.items():
            cs = state["c"].get(cid) or {}
            waiting = [r for r in items if self._channel_route(r, cs)]
            if not waiting or (_int(cs.get("next")) or 0) > now:
                continue
            key = (
                0 if any(r.favorite for r in waiting) else 1,
                0 if any(r.is_new for r in waiting) else 1,
                -max(r.published_at for r in waiting),
                cid,
            )
            candidates.append((key, cid))
        for _, cid in sorted(candidates):
            if not self._budget_left():
                break
            self._channel(cid, by_channel[cid], state, now, report)

    def _channel(
        self,
        cid: str,
        items: Sequence[_Row],
        state: dict[str, Any],
        now: int,
        report: PassReport,
    ) -> None:
        cs = dict(state["c"].get(cid) or {})
        fetch = self.youtube.fetch_uploads_playlist  # type: ignore[attr-defined]
        updates: dict[str, tuple[int | None, bool | None]] = {}
        report.channels += 1
        try:
            self._pace()
            uploads = fetch(cid)
            in_uploads = set(uploads.video_ids)
            open_kind: list[_Row] = []
            for r in items:
                duration = uploads.durations.get(r.id) if r.need_duration else None
                known = r.duration_s if r.duration_s is not None else duration
                kind: bool | None = None
                if r.is_short is None and known is not None and known > LONG_FROM_S:
                    kind = False
                updates[r.id] = (duration, kind)
                if r.is_short is None and kind is None:
                    open_kind.append(r)
            if open_kind and uploads.exists:
                if self._mono() >= self._deadline:
                    # pass deadline exhausted: keep the durations; the channel comes back in the
                    # next pass, without backoff (it was not a failure)
                    report.resolved += self._fill(updates)
                    return
                self._pace()  # a started channel finishes (may exceed the cap by 1)
                shorts_page = fetch(cid, shorts=True)
                shorts = set(shorts_page.video_ids) if shorts_page.exists else set()
                for r in open_kind:
                    if r.id in shorts:
                        updates[r.id] = (updates[r.id][0], True)
                    elif r.id in in_uploads:
                        updates[r.id] = (updates[r.id][0], False)
        except T.TubeError as exc:
            report.resolved += self._fill(updates)
            if _status(exc) == 429:
                raise _Throttled() from exc
            n = (_int(cs.get("n")) or 0) + 1
            cs.update(n=n, next=now + backoff_s(n))
            state["c"][cid] = cs
            report.errors[cid] = exc.message
            log.info(
                "channel playlist %s: %s (retry in %ss)",
                cid,
                exc.message,
                cs["next"] - now,
            )
            return
        except Exception as exc:  # noqa: BLE001 - one channel does not bring down the pass
            log.exception("channel playlist %s failed", cid)
            n = (_int(cs.get("n")) or 0) + 1
            cs.update(n=n, next=now + backoff_s(n))
            state["c"][cid] = cs
            report.errors[cid] = f"unexpected error: {exc}"
            return
        report.resolved += self._fill(updates)
        state["c"][cid] = {"ok": now}

    # ---------------------------------------------------------------- 4: last resort

    def _singles_phase(
        self, rows: Sequence[_Row], state: dict[str, Any], now: int, report: PassReport
    ) -> None:
        todo = [
            r
            for r in rows
            if r.pending
            and not self._channel_route(r, state["c"].get(r.channel_id) or {})
            and (_int((state["v"].get(r.id) or {}).get("next")) or 0) <= now
            and dedup.is_video_id(r.id)
        ]
        todo.sort(key=lambda r: (0 if r.is_new else 1, -r.published_at, r.id))
        for r in todo[: self.singles_per_pass]:
            if not self._budget_left():
                break
            report.singles += 1
            self._single(r, state, now, report)

    def _single(self, r: _Row, state: dict[str, Any], now: int, report: PassReport) -> None:
        duration: int | None = None
        short: bool | None = r.is_short
        try:
            if r.need_kind or (short is True and r.need_duration):
                self._pace()
                checker = getattr(self.youtube, "short_details", None)
                if callable(checker):
                    found, length = checker(r.id)
                else:
                    found, length = bool(self.youtube.is_short(r.id)), None
                if short is None:
                    short = bool(found)
                duration = _int(length)
            if r.need_duration and duration is None and self._budget_left():
                self._pace()
                details = self.youtube.video_details(r.id)
                duration = _int(details.duration_s)
        except T.TubeError as exc:
            if _status(exc) == 429:
                report.resolved += self._fill(
                    {r.id: (duration, short if r.is_short is None else None)}
                )
                raise _Throttled() from exc
            report.errors[r.id] = exc.message
        except Exception as exc:  # noqa: BLE001
            log.exception("details of video %s failed", r.id)
            report.errors[r.id] = f"unexpected error: {exc}"
        if duration is not None and duration <= 0:
            duration = None
        if short is None and duration is not None and duration > LONG_FROM_S:
            short = False
        report.resolved += self._fill(
            {r.id: (duration if r.need_duration else None, short if r.is_short is None else None)}
        )
        still = (r.need_duration and duration is None) or (r.is_short is None and short is None)
        if still:  # live, scheduled, unavailable or failure: backoff
            vs = state["v"].get(r.id) or {}
            n = (_int(vs.get("n")) or 0) + 1
            state["v"][r.id] = {"n": n, "next": now + backoff_s(n)}
        else:
            state["v"].pop(r.id, None)


__all__ = [
    "LONG_FROM_S",
    "META_DETAILS_LOCK",
    "META_DETAILS_STATE",
    "PASS_GAP_S",
    "REQUESTS_PER_PASS",
    "RETRY_BASE_S",
    "SHORT_MAX_S",
    "SINGLES_PER_PASS",
    "SPACING_S",
    "THROTTLE_S",
    "DetailsResolver",
    "PassReport",
    "backoff_s",
]
