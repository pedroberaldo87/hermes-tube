"""Search broker: ``Searcher`` implementation over the ``search_jobs`` table.

``search_many`` flow (extension protocol, "delegated searches"):

1. One ``search_jobs`` row per distinct search, all with the same ``batch_id`` and
   ``expires_at = created_at + min(timeout, 15 s)``. ``ExtState.search_pending`` and ``/status``
   count the unexpired ``pending`` rows straight from the table.
2. **One** wait window for the whole batch — and none if no device showed up in 60 s
   (``DeviceAuth.any_seen_within``) or the extension server is down (``ext_endpoint_up``): then
   the jobs are born ``expired`` (record only; nothing to hand out). The window closes early once
   every job in the batch has settled (``done``/``failed``).
3. Atomic close: whatever did not arrive becomes ``expired`` (late result → ``Conflict``, nothing
   written) and the batch is read in a single transaction.
4. Whatever is missing goes to the host (``YouTubeClient.search``), at most ``HOST_WORKERS`` in
   parallel and within ``HOST_BUDGET_S``. A failed search becomes ``SearchOutcome.error`` (empty
   search); an HTTP 429 from YouTube makes the batch stop trying (searches not started yet are
   not run at all).
5. Output in the requested order, deduplicated by ``video_id`` across the whole batch (first
   appearance wins), with each search's origin (``extension``/``host``; ``none`` when it failed).

Extension payload = **untrusted data** (``complete``): maximum size, shape (object with
``contents``… or JSON/HTML text), bounded depth and node count, 11-character video ids and
``UC`` + 22 channel ids in every video renderer, cleaned and capped text. Rejected →
``ValidationError`` and the job becomes ``failed`` (the host covers that search without waiting
for the window). What is stored in ``search_jobs.payload`` is the **extracted and validated**
data (``{"hits": [...]}``), never the raw ``ytInitialData``.

State lives only in SQLite: ``claim``/``complete`` run in the extension server, which may be in
another process; ``search_many`` polls the table every ``POLL_S``.
"""

from __future__ import annotations

import concurrent.futures
import contextvars
import json
import logging
import math
import re
import threading
import time
import unicodedata
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from tube_pkg.core import types as T

logger = logging.getLogger(__name__)

POLL_S = 0.25
"""Table polling interval during the wait window."""
HOST_WORKERS = 4
"""Concurrent searches on the host (``HttpClient`` already caps 4 per host)."""
HOST_BUDGET_S = 25.0
"""Cap for the host phase. Worst case of ``search_many`` = 15 s window + 25 s = 40 s, within the
caller's 90 s (``theme_expand`` + searches + ``theme_curate``)."""
MAX_QUERY_CHARS = 200
CLAIM_MAX = 8
"""Cap for the ``limit`` of ``GET /ext/search-jobs`` (api.yaml: 1..8, default 4)."""

MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
"""Cap for the extension payload (search ``ytInitialData`` ≈ 0.85 MB; HTML page ≈ 1.7 MB)."""
MAX_PAYLOAD_NODES = 200_000
"""JSON nodes (objects, lists and leaves); a real search has ≈ 24 thousand."""
MAX_PAYLOAD_DEPTH = 80
"""JSON depth; a real search has ≈ 39."""
MAX_HITS = 60
"""Videos kept per search (the page has ~20)."""
MAX_TEXT_CHARS = 300
MAX_DESCRIPTION_CHARS = 1000
MAX_DURATION_S = 7 * 86_400

_VIDEO_ID_RE = re.compile(r"[A-Za-z0-9_-]{11}")
_CHANNEL_ID_RE = re.compile(r"UC[A-Za-z0-9_-]{22}")
_INITIAL_DATA_KEYS = ("contents", "onResponseReceivedCommands", "onResponseReceivedActions")
_LOCKUP_VIDEO = "LOCKUP_CONTENT_TYPE_VIDEO"
_BIDI_CONTROLS = frozenset(chr(c) for c in (*range(0x202A, 0x202F), *range(0x2066, 0x206A)))
_SETTLED = (T.SearchJobStatus.done.value, T.SearchJobStatus.failed.value)
_OPEN = (T.SearchJobStatus.pending.value, T.SearchJobStatus.claimed.value)


# ============================================================================ payload


def _is_video_id(value: Any) -> bool:
    return isinstance(value, str) and _VIDEO_ID_RE.fullmatch(value) is not None


def _is_channel_id(value: Any) -> bool:
    return isinstance(value, str) and _CHANNEL_ID_RE.fullmatch(value) is not None


def _clean_text(value: Any, limit: int) -> str | None:
    """One line, no control or direction characters, capped."""
    if not isinstance(value, str):
        return None
    out = []
    for ch in value:
        if ch in _BIDI_CONTROLS:
            continue
        cat = unicodedata.category(ch)
        if cat == "Cc":
            if ch in "\t\n\r":
                out.append(" ")
            continue
        out.append(ch)
    text = " ".join("".join(out).split())
    return text[:limit] if text else None


def _clean_int(value: Any, upper: int | None = None) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    if upper is not None and value > upper:
        return None
    return value


def _payload_size(payload: Any) -> int:
    if isinstance(payload, str):
        return len(payload.encode("utf-8", errors="replace"))
    try:
        return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    except (TypeError, ValueError) as exc:
        raise T.ValidationError(f"payload is not serializable: {exc}") from exc


def _scan(data: Any) -> int:
    """Walks ``ytInitialData`` (explicit stack): caps nodes and depth and checks the id of every
    video renderer. Returns how many video renderers it found."""
    nodes = 0
    videos = 0
    stack: list[tuple[Any, int]] = [(data, 1)]
    while stack:
        node, depth = stack.pop()
        nodes += 1
        if nodes > MAX_PAYLOAD_NODES:
            raise T.ValidationError(f"payload has more than {MAX_PAYLOAD_NODES} nodes")
        if depth > MAX_PAYLOAD_DEPTH:
            raise T.ValidationError(f"payload nested deeper than {MAX_PAYLOAD_DEPTH} levels")
        if isinstance(node, dict):
            vr = node.get("videoRenderer")
            if isinstance(vr, dict) and "videoId" in vr:
                videos += 1
                if not _is_video_id(vr["videoId"]):
                    raise T.ValidationError("invalid video id in payload (videoRenderer)")
            lockup = node.get("lockupViewModel")
            if isinstance(lockup, dict) and lockup.get("contentType") == _LOCKUP_VIDEO:
                videos += 1
                if not _is_video_id(lockup.get("contentId")):
                    raise T.ValidationError("invalid video id in payload (lockupViewModel)")
            stack.extend((v, depth + 1) for v in node.values())
        elif isinstance(node, list):
            stack.extend((v, depth + 1) for v in node)
    return videos


def _coerce(payload: Any) -> tuple[Any, int | None]:
    """Payload shape → (what goes to the parser, number of video renderers or ``None`` for HTML)."""
    if isinstance(payload, str):
        text = payload.strip()
        if not text:
            raise T.ValidationError("empty payload")
        if text[0] in "{[":
            try:
                payload = json.loads(text)
            except ValueError as exc:
                raise T.ValidationError(f"unreadable JSON payload: {exc}") from exc
        else:
            return payload, None  # page HTML: the parser extracts; the hits are checked
    if not isinstance(payload, Mapping):
        raise T.ValidationError(f"payload must be an object or text (got {type(payload).__name__})")
    data: Any = payload
    if "ytInitialData" in data:
        data = data["ytInitialData"]
        if not isinstance(data, Mapping):
            raise T.ValidationError("ytInitialData must be an object")
    if not any(key in data for key in _INITIAL_DATA_KEYS):
        raise T.ValidationError("payload does not look like a search ytInitialData (no 'contents')")
    return data, _scan(data)


def _sanitize(hit: Any) -> T.SearchHit:
    if not isinstance(hit, T.SearchHit):
        raise T.ValidationError("parser returned an item that is not a SearchHit")
    if not _is_video_id(hit.video_id):
        raise T.ValidationError(f"invalid video id: {str(hit.video_id)[:20]!r}")
    if not _is_channel_id(hit.channel_id):
        raise T.ValidationError(f"invalid channel id: {str(hit.channel_id)[:30]!r}")
    published_at = hit.published_at if _clean_int(hit.published_at) is not None else None
    return T.SearchHit(
        video_id=hit.video_id,
        title=_clean_text(hit.title, MAX_TEXT_CHARS) or "",
        channel_id=hit.channel_id,
        channel_title=_clean_text(hit.channel_title, MAX_TEXT_CHARS),
        duration_s=_clean_int(hit.duration_s, MAX_DURATION_S),
        views=_clean_int(hit.views),
        published_text=_clean_text(hit.published_text, 80),
        published_at=published_at,
        description=_clean_text(hit.description, MAX_DESCRIPTION_CHARS),
    )


def validate_payload(youtube: T.YouTubeClient, payload: Any) -> list[T.SearchHit]:
    """``ytInitialData`` from the extension → validated videos (no duplicates, in page order, at
    most ``MAX_HITS``). Any problem → ``ValidationError``."""
    if payload is None:
        raise T.ValidationError("missing payload")
    if _payload_size(payload) > MAX_PAYLOAD_BYTES:
        raise T.ValidationError(f"payload larger than {MAX_PAYLOAD_BYTES // (1024 * 1024)} MB")
    data, videos = _coerce(payload)
    try:
        parsed = youtube.parse_search_payload(data)
    except T.TubeError as exc:
        raise T.ValidationError(f"unreadable search payload: {exc.message}") from exc
    except Exception as exc:  # noqa: BLE001 — untrusted data: no stray exceptions
        raise T.ValidationError(f"unreadable search payload ({type(exc).__name__})") from exc
    if not isinstance(parsed, list):
        raise T.ValidationError("parser returned something that is not a list")
    hits: list[T.SearchHit] = []
    seen: set[str] = set()
    for item in parsed:
        hit = _sanitize(item)
        if hit.video_id in seen:
            continue
        seen.add(hit.video_id)
        hits.append(hit)
        if len(hits) >= MAX_HITS:
            break
    if videos and not hits:
        raise T.ValidationError("no valid video in the payload (unrecognisable channel or id)")
    return hits


def _hit_to_json(hit: T.SearchHit) -> dict[str, Any]:
    return {
        "video_id": hit.video_id,
        "title": hit.title,
        "channel_id": hit.channel_id,
        "channel_title": hit.channel_title,
        "duration_s": hit.duration_s,
        "views": hit.views,
        "published_text": hit.published_text,
        "published_at": hit.published_at,
        "description": hit.description,
    }


def hits_from_payload(stored: Any) -> list[T.SearchHit]:
    """``search_jobs.payload`` (``{"hits": [...]}``, text or object) → ``SearchHit``s. Broken
    row → empty list (the host covers it)."""
    if isinstance(stored, str):
        try:
            stored = json.loads(stored)
        except ValueError:
            return []
    items = stored.get("hits") if isinstance(stored, Mapping) else None
    out: list[T.SearchHit] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, Mapping):
            continue
        try:
            out.append(
                _sanitize(
                    T.SearchHit(
                        video_id=item.get("video_id"),  # type: ignore[arg-type]
                        title=item.get("title") or "",
                        channel_id=item.get("channel_id"),  # type: ignore[arg-type]
                        channel_title=item.get("channel_title"),
                        duration_s=item.get("duration_s"),
                        views=item.get("views"),
                        published_text=item.get("published_text"),
                        published_at=item.get("published_at"),
                        description=item.get("description"),
                    )
                )
            )
        except T.ValidationError:
            continue
    return out


# ============================================================================ broker


def _job(row: Mapping[str, Any]) -> T.SearchJob:
    raw = row.get("payload")
    payload: Any = None
    if raw is not None:
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = None
    return T.SearchJob(
        id=row["id"],
        batch_id=row["batch_id"],
        query=row["query"],
        order=T.SearchOrder(row["search_order"]),
        status=T.SearchJobStatus(row["status"]),
        created_at=int(row["created_at"]),
        expires_at=int(row["expires_at"]),
        theme_id=row.get("theme_id"),
        device_id=row.get("device_id"),
        payload=payload,
    )


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _is_rate_limited(exc: BaseException) -> bool:
    details = getattr(exc, "details", None)
    if isinstance(details, Mapping) and details.get("status") == 429:
        return True
    return "429" in str(getattr(exc, "message", "") or exc)


@dataclass
class _Slot:
    """One distinct search in the batch (repeated requests point to the same slot)."""

    query: str
    order: T.SearchOrder
    theme_id: str | None
    job_id: str = ""
    hits: tuple[T.SearchHit, ...] = ()
    via: T.SearchVia = T.SearchVia.none
    error: str | None = None
    settled: bool = False


class SearcherImpl:
    """Real ``Searcher`` (see the module docstring). Injectable ``sleep``/``monotonic`` (tests)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        youtube: T.YouTubeClient,
        devices: T.DeviceAuth,
        ext_endpoint_up: Callable[[], bool],
        clock: T.Clock | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.db = db
        self.settings = settings
        self.youtube = youtube
        self.devices = devices
        self.ext_endpoint_up = ext_endpoint_up
        self.clock: T.Clock = clock if clock is not None else T.SystemClock()
        self._sleep = sleep
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self.stats: dict[str, Any] = {"windows": 0, "rate_limited": False, "last": None}
        """Diagnostics: windows opened (cumulative), 429 in the last batch, summary of the last
        batch."""

    def _now(self) -> T.Timestamp:
        return int(self.clock.now())

    # ------------------------------------------------------------------ extension reachable?

    def _extension_reachable(self) -> bool:
        try:
            if not self.devices.any_seen_within(T.DEVICE_ONLINE_WINDOW_S):
                return False
        except Exception:  # noqa: BLE001 — when unsure, do not wait
            logger.debug("any_seen_within failed", exc_info=True)
            return False
        try:
            return bool(self.ext_endpoint_up())
        except Exception:  # noqa: BLE001
            logger.debug("ext_endpoint_up failed", exc_info=True)
            return False

    # ------------------------------------------------------------------ jobs

    def _insert(
        self, slots: Sequence[_Slot], *, window_s: int, status: str
    ) -> tuple[str, T.Timestamp]:
        batch_id = _new_id("sb")
        now = self._now()
        rows = []
        for slot in slots:
            slot.job_id = _new_id("sj")
            rows.append(
                (
                    slot.job_id,
                    batch_id,
                    slot.theme_id,
                    slot.query,
                    slot.order.value,
                    status,
                    now,
                    now + window_s,
                )
            )
        with self.db.transaction():
            self.db.executemany(
                "INSERT INTO search_jobs (id, batch_id, theme_id, query, search_order, status,"
                " created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
        return batch_id, now + window_s

    def enqueue(
        self,
        query: str,
        order: T.SearchOrder = T.SearchOrder.relevance,
        theme_id: str | None = None,
        *,
        window_s: float = T.SEARCH_WINDOW_S,
    ) -> T.SearchJob:
        """Creates a standalone ``pending`` job (same shape as ``FakeSearcher.enqueue``)."""
        slot = _Slot(query=query, order=T.SearchOrder(order), theme_id=theme_id)
        self._insert([slot], window_s=max(1, math.ceil(window_s)), status="pending")
        row = self.db.query_one("SELECT * FROM search_jobs WHERE id = ?", (slot.job_id,))
        assert row is not None
        return _job(row)

    def _batch_settled(self, batch_id: str) -> bool:
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM search_jobs WHERE batch_id = ? AND status IN (?, ?)",
            (batch_id, *_OPEN),
        )
        return row is not None and int(row["n"]) == 0

    def _wait(self, batch_id: str, window: float, expires_at: int) -> None:
        """The batch's single window: ends at the deadline, at ``expires_at`` or when everything
        settled."""
        self.stats["windows"] += 1
        deadline = self._monotonic() + window
        while True:
            try:
                if self._batch_settled(batch_id):
                    return
            except Exception:  # noqa: BLE001 — database busy: try again on the next step
                logger.debug("reading the batch failed", exc_info=True)
            remaining = deadline - self._monotonic()
            if remaining <= 0 or self._now() >= expires_at:
                return
            self._sleep(min(POLL_S, remaining))

    def _close_batch(self, batch_id: str) -> list[Mapping[str, Any]]:
        """Closes the batch in a transaction: whatever did not arrive becomes ``expired``; returns
        the rows."""
        with self.db.transaction():
            self.db.execute(
                "UPDATE search_jobs SET status = 'expired' WHERE batch_id = ? AND status IN (?, ?)",
                (batch_id, *_OPEN),
            )
            return self.db.query("SELECT * FROM search_jobs WHERE batch_id = ?", (batch_id,))

    # ------------------------------------------------------------------ host

    def _host_one(
        self, query: str, order: T.SearchOrder, stop: threading.Event
    ) -> tuple[tuple[T.SearchHit, ...], str | None]:
        """One search on the host → ``(hits, error)``. Never raises; a 429 sets *stop* for the
        batch."""
        if stop.is_set():
            return (), f"search {query!r} skipped: YouTube rate-limited the requests (HTTP 429)"
        try:
            hits = self.youtube.search(query, order)
        except Exception as exc:  # noqa: BLE001 — one failed search does not break the batch
            if _is_rate_limited(exc):
                stop.set()
            message = exc.message if isinstance(exc, T.TubeError) else None
            error = message or f"search {query!r} failed ({type(exc).__name__}: {exc})"
            logger.warning("host search failed: %s", error)
            return (), error
        clean: list[T.SearchHit] = []
        for hit in hits if isinstance(hits, list) else []:
            try:
                clean.append(_sanitize(hit))
            except T.ValidationError:
                continue
        return tuple(clean), None

    def _run_host(self, slots: Sequence[_Slot]) -> bool:
        """Fills *slots* through the host, ``HOST_WORKERS`` at a time, within ``HOST_BUDGET_S``.
        Only the caller's thread writes to the slots (a search cut by the deadline does not come
        back later). Returns whether there was a 429."""
        if not slots:
            return False
        budget = HOST_BUDGET_S
        stop = threading.Event()
        pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=min(HOST_WORKERS, len(slots)), thread_name_prefix="tube-search"
        )
        futures: dict[concurrent.futures.Future[Any], _Slot] = {}
        try:
            for slot in slots:
                ctx = contextvars.copy_context()
                fut = pool.submit(ctx.run, self._host_one, slot.query, slot.order, stop)
                futures[fut] = slot
            done, _ = concurrent.futures.wait(futures, timeout=budget)
            for fut, slot in futures.items():
                if fut in done and fut.exception() is None:
                    hits, error = fut.result()
                    slot.hits, slot.error = hits, error
                    slot.via = T.SearchVia.host if error is None else T.SearchVia.none
                elif fut in done:
                    slot.error = f"search {slot.query!r} failed: {fut.exception()}"
                else:
                    slot.error = f"search {slot.query!r}: timed out on the host ({budget:g} s)"
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        return stop.is_set()

    # ------------------------------------------------------------------ Searcher

    def search_many(
        self, requests: Sequence[T.SearchRequest], timeout: float = T.SEARCH_WINDOW_S
    ) -> list[T.SearchOutcome]:
        started = self._monotonic()
        requests = list(requests)
        slots: dict[tuple[str, T.SearchOrder], _Slot] = {}
        plan: list[tuple[T.SearchRequest, _Slot | None, str | None]] = []
        for req in requests:
            query = req.query.strip() if isinstance(req.query, str) else ""
            try:
                order = T.SearchOrder(req.order)
            except ValueError:
                plan.append((req, None, f"invalid search order: {req.order!r}"))
                continue
            if not query:
                plan.append((req, None, "empty search"))
                continue
            if len(query) > MAX_QUERY_CHARS:
                plan.append((req, None, f"search longer than {MAX_QUERY_CHARS} characters"))
                continue
            key = (query, order)
            slot = slots.get(key)
            if slot is None:
                slot = slots[key] = _Slot(query=query, order=order, theme_id=req.theme_id)
            plan.append((req, slot, None))

        unique = list(slots.values())
        window = max(0.0, min(float(timeout), T.SEARCH_WINDOW_S))
        window_s = max(1, math.ceil(window))
        wait = bool(unique) and window > 0 and self._extension_reachable()
        batch_id: str | None = None
        expires_at = 0
        if unique:
            try:
                batch_id, expires_at = self._insert(
                    unique, window_s=window_s, status="pending" if wait else "expired"
                )
            except Exception:  # noqa: BLE001 — no jobs: everything through the host
                logger.warning(
                    "could not create search_jobs; everything through the host", exc_info=True
                )
                wait = False
        if wait and batch_id is not None:
            self._wait(batch_id, window, expires_at)
            try:
                rows = self._close_batch(batch_id)
            except Exception:  # noqa: BLE001
                logger.warning("could not close batch %s", batch_id, exc_info=True)
                rows = []
            by_id = {slot.job_id: slot for slot in unique}
            for row in rows:
                slot = by_id.get(row["id"])
                if slot is not None and row["status"] == T.SearchJobStatus.done.value:
                    slot.hits = tuple(hits_from_payload(row["payload"]))
                    slot.via = T.SearchVia.extension
                    slot.settled = True
        missing = [slot for slot in unique if not slot.settled]
        rate_limited = self._run_host(missing)
        self.stats["rate_limited"] = rate_limited

        seen: set[str] = set()
        out: list[T.SearchOutcome] = []
        used: set[int] = set()
        for req, slot, error in plan:
            if slot is None:
                out.append(T.SearchOutcome(request=req, error=error))
                continue
            first = id(slot) not in used
            used.add(id(slot))
            hits: list[T.SearchHit] = []
            if first:
                for hit in slot.hits:
                    if hit.video_id not in seen:
                        seen.add(hit.video_id)
                        hits.append(hit)
            out.append(
                T.SearchOutcome(request=req, hits=tuple(hits), via=slot.via, error=slot.error)
            )
        self.stats["last"] = {
            "requests": len(requests),
            "searches": len(unique),
            "waited": wait,
            "extension": sum(1 for s in unique if s.via is T.SearchVia.extension),
            "host": sum(1 for s in unique if s.via is T.SearchVia.host),
            "errors": sum(1 for s in unique if s.error),
            "elapsed_s": round(self._monotonic() - started, 3),
        }
        return out

    def search(
        self,
        query: str,
        order: T.SearchOrder = T.SearchOrder.relevance,
        *,
        timeout: float = T.SEARCH_WINDOW_S,
    ) -> list[T.SearchHit]:
        (outcome,) = self.search_many([T.SearchRequest(query=query, order=order)], timeout)
        if outcome.error:
            raise T.YouTubeError(outcome.error)
        return list(outcome.hits)

    def pending_count(self) -> int:
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM search_jobs WHERE status = 'pending' AND expires_at > ?",
            (self._now(),),
        )
        return int(row["n"]) if row else 0

    def claim(self, device_id: str, limit: int = 4) -> list[T.SearchJob]:
        """Unexpired ``pending`` → ``claimed`` by *device_id*, oldest first. Atomic
        (``BEGIN IMMEDIATE``): two devices never get the same job."""
        if not isinstance(device_id, str) or not device_id:
            raise T.ValidationError("missing device")
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = 4
        limit = max(1, min(CLAIM_MAX, limit))
        now = self._now()
        with self.db.transaction():
            rows = self.db.query(
                "SELECT id FROM search_jobs WHERE status = 'pending' AND expires_at > ?"
                " ORDER BY created_at, rowid LIMIT ?",
                (now, limit),
            )
            ids = [r["id"] for r in rows]
            for job_id in ids:
                self.db.execute(
                    "UPDATE search_jobs SET status = 'claimed', device_id = ?"
                    " WHERE id = ? AND status = 'pending'",
                    (device_id, job_id),
                )
            got: dict[str, Mapping[str, Any]] = {}
            if ids:
                marks = ", ".join("?" * len(ids))
                sql = f"SELECT * FROM search_jobs WHERE id IN ({marks})"
                got = {r["id"]: r for r in self.db.query(sql, ids)}
        return [_job(got[i]) for i in ids if i in got and got[i]["device_id"] == device_id]

    def _row(self, job_id: str) -> Mapping[str, Any]:
        if not isinstance(job_id, str) or not job_id:
            raise T.NotFound("search without an id")
        row = self.db.query_one("SELECT * FROM search_jobs WHERE id = ?", (job_id,))
        if row is None:
            raise T.NotFound(f"search {job_id} does not exist")
        return row

    def _check_open(self, row: Mapping[str, Any], device_id: str) -> None:
        """Only the device that claimed the job, before the deadline, may deliver a result."""
        if row["device_id"] is not None and row["device_id"] != device_id:
            raise T.Conflict("search was handed to another device")
        status = row["status"]
        if status == T.SearchJobStatus.pending.value:
            raise T.Conflict("search was not handed to this device (GET /ext/search-jobs)")
        if status != T.SearchJobStatus.claimed.value or int(row["expires_at"]) <= self._now():
            raise T.Conflict("search expired; the host already covered it")

    def _finish(self, job_id: str, device_id: str, status: str, payload: str | None) -> bool:
        res = self.db.execute(
            "UPDATE search_jobs SET status = ?, payload = ?, completed_at = ?"
            " WHERE id = ? AND status = 'claimed' AND device_id = ? AND expires_at > ?",
            (status, payload, self._now(), job_id, device_id, self._now()),
        )
        return bool(res.rowcount)

    def complete(
        self, job_id: str, payload: Mapping[str, Any] | str, *, device_id: str
    ) -> T.SearchJob:
        row = self._row(job_id)
        if row["status"] == T.SearchJobStatus.done.value and row["device_id"] == device_id:
            return _job(row)  # same result sent again: idempotent
        self._check_open(row, device_id)
        try:
            hits = validate_payload(self.youtube, payload)
        except T.ValidationError:
            self._finish(job_id, device_id, T.SearchJobStatus.failed.value, None)
            raise
        stored = json.dumps(
            {"hits": [_hit_to_json(h) for h in hits]}, ensure_ascii=False, separators=(",", ":")
        )
        if not self._finish(job_id, device_id, T.SearchJobStatus.done.value, stored):
            row = self._row(job_id)
            if row["status"] == T.SearchJobStatus.done.value and row["device_id"] == device_id:
                return _job(row)
            self._check_open(row, device_id)
            raise T.Conflict("search expired; the host already covered it")
        return _job(self._row(job_id))

    def fail(self, job_id: str, error: str, *, device_id: str) -> T.SearchJob:
        """The extension could not search (``POST …/result {error}``): ``failed``, and the batch
        goes to the host without waiting out the rest of the window for this search."""
        row = self._row(job_id)
        if row["status"] == T.SearchJobStatus.failed.value and row["device_id"] == device_id:
            return _job(row)
        self._check_open(row, device_id)
        message = _clean_text(error, MAX_TEXT_CHARS) or "error without a message"
        logger.info("extension did not search %s: %s", job_id, message)
        if not self._finish(job_id, device_id, T.SearchJobStatus.failed.value, None):
            self._check_open(self._row(job_id), device_id)
            raise T.Conflict("search expired; the host already covered it")
        return _job(self._row(job_id))

    def purge_expired(self, now: T.Timestamp | None = None) -> int:
        """Deletes every job whose ``expires_at`` has passed (any status: the batch was already
        read)."""
        when = self._now() if now is None else int(now)
        res = self.db.execute("DELETE FROM search_jobs WHERE expires_at <= ?", (when,))
        return int(res.rowcount or 0)

    def iter_batch(self, batch_id: str) -> Iterator[T.SearchJob]:
        """Jobs of one batch (diagnostics)."""
        for row in self.db.query(
            "SELECT * FROM search_jobs WHERE batch_id = ? ORDER BY rowid", (batch_id,)
        ):
            yield _job(row)


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    youtube: T.YouTubeClient,
    devices: T.DeviceAuth,
    ext_endpoint_up: Callable[[], bool],
    clock: T.Clock | None = None,
) -> T.Searcher:
    """Real ``Searcher`` (signature from ``BUILD_SIGNATURES``; no network, no thread here)."""
    return SearcherImpl(
        db=db,
        settings=settings,
        youtube=youtube,
        devices=devices,
        ext_endpoint_up=ext_endpoint_up,
        clock=clock,
    )


__all__ = [
    "HOST_BUDGET_S",
    "HOST_WORKERS",
    "MAX_PAYLOAD_BYTES",
    "MAX_PAYLOAD_DEPTH",
    "MAX_PAYLOAD_NODES",
    "SearcherImpl",
    "build",
    "hits_from_payload",
    "validate_payload",
]
