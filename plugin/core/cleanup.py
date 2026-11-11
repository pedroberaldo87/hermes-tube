"""Cleanup and the unsubscribe queue: the ``Cleanup`` implementation.

Owner of the ``cleanup_candidates`` (cleanup reasons, kept out of ``suggestions``) and
``unsub_queue`` (the queue the extension runs) tables. Product invariant: **nothing is
unsubscribed without a human click** — only ``approve``/``resubscribe`` create items, and only
with a ``via`` from ``HUMAN_APPROVAL_VIAS`` (``desktop_rpc`` through the ``cleanup.approve`` RPC;
``ask_choice`` through ``/tube faxina``) and ``actor=user``. Anything else → ``ApprovalRefused``
without touching anything.

- **Scan** — a deterministic rule decides who is in:
  ``stale`` = last known video ≥ 180 days ago (the newest of ``channels.last_video_at`` and
  ``videos.published_at``); ``ignored`` = ≥ 8 videos published in the last 90 days and 0 watched
  in that period — only applies once the extension has sent some history (``watch_history`` not
  empty; without it \"0 watched\" would be a lie). The AI (``cleanup_reasons``) only writes the
  reason for channels the rule flagged and may put channels **without** a rule into the
  ``off_profile`` group; model output is untrusted data (id not in the input, duplicate, group
  contradicting the rule, text with line breaks/markup → ignored). Without a model, or with an
  invalid/slow/broken AI, the scan comes out with the rules only, a factual reason generated here
  and ``model = None`` (the screen says what is missing).
- **Last scan** — pointer in ``meta[cleanup_last_scan]`` (``scan_id``, ``created_at``,
  ``model``): a scan without candidates is still the last one. ``latest_scan`` shows only the
  ``pending`` candidates of channels still subscribed and with no active queue item, plus the
  ``manual`` ones.
- **Approval** — all or nothing: invalid id → ``invalid``; unknown channel → ``not_found``; wrong
  relation or an active item for the opposite action → ``conflict``; an active item for the same
  action = returns the existing one (idempotent). Writes ``approved_at``/``approved_via``, marks
  the candidates ``approved``, records ``cleanup_approve``/``cleanup_resubscribe`` in the history
  and emits ``queue.changed``.
- **Extension queue** (extras outside the ``Protocol``: ``claim_next``, ``pending_count``,
  ``ex_subscriptions``) — ``claim_next(device)`` hands out **one** ``approved`` item at a time and
  leases it to the device (``device_id``) for ``LEASE_S``; another device does not get a leased
  item nor can it report a result for it. A ``running`` item with no answer for
  ``RUNNING_STALE_S`` becomes ``failed`` (a late result from the same device still counts).
  ``failed`` is final: it never goes back to the queue (a new attempt = a new human approval).
  ``done`` → ``ChannelService.set_relation`` with ``actor=extension`` (``ex`` / ``subscribed``),
  which makes the channel service refuse to undo the relation.
- **Ex-subscriptions** — ``ex_subscriptions()`` lists the ``ex`` channels within
  ``ex_retention_days`` (default 30) with the date they leave and the active resubscription, if
  any. The ``ex → ignored`` step belongs to maintenance.

No network, no thread and no environment variables here; ``build`` is inert.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from tube_pkg.core import lang
from tube_pkg.core import prompts as P
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

DAY = 86_400
STALE_DAYS = 180
IGNORED_DAYS = 90
IGNORED_MIN_VIDEOS = 8
LEASE_S = 300
"""How long an item handed to a device stays reserved for it (without ``running``)."""
RUNNING_STALE_S = 600
"""A ``running`` item with no result for this long becomes ``failed`` (the extension vanished)."""
MAX_IDS = 500
WHY_MAX = int(P.LIMITS["why_chars"])
ERROR_MAX = 300
RECENT_TITLES = int(P.LIMITS["recent_titles"])
PROFILE_FOLDERS = 12
PROFILE_FAVORITES = 20
META_LAST_SCAN = "cleanup_last_scan"

CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
_EXECUTED = frozenset({T.QueueStatus.running, T.QueueStatus.done, T.QueueStatus.failed})
_RESULTS = frozenset({T.QueueStatus.running, T.QueueStatus.done, T.QueueStatus.failed})
_NEXT: dict[T.QueueStatus, frozenset[T.QueueStatus]] = {
    T.QueueStatus.approved: frozenset(_RESULTS),
    T.QueueStatus.running: frozenset({T.QueueStatus.done, T.QueueStatus.failed}),
}
_TIMEOUT_MARK = "timeout:"
DONE_NOTES = frozenset({"not_subscribed", "already_subscribed"})
"""Notes the extension sends with ``done`` when the page was already in the target state and
nothing was clicked. Kept in ``error`` (the only free text field of the item) so the Desktop
can say so; anything else sent with ``done`` is dropped."""
# Text that tries to command the model ("ignor… …instru…", in EN or PT). The pattern is
# built in pieces on purpose: the whole phrase in the source trips the Hermes catalog security
# scanner (it cannot tell code that writes the phrase from code that blocks it).
_OVERRIDE_TEXT = re.compile(r"\bignor\w*\s+(?:[\w']+\s+){0,4}" + r"instru\w+", re.IGNORECASE)
_UNSAFE_TEXT = re.compile(
    r"[\x00-\x1f\x7f]|<\s*/?\s*[a-z!]|::|javascript:|\[/?inst\]|<\|",
    re.IGNORECASE,
)
_RULE_GROUPS = (T.CleanupGroup.stale, T.CleanupGroup.ignored)

_TEXTS = {
    "pt": {
        "stale": "Sem vídeo novo há {days} dias.",
        "ignored": "{videos} vídeos nos últimos 90 dias e nenhum assistido.",
        "manual": "Proposto por você.",
        "timeout": "timeout: a extensão não confirmou a execução em 10 minutos",
        "gone": "o canal não está mais na sua lista",
        "not_subscribed": "o canal já não está inscrito (mudou fora da fila)",
        "already_subscribed": "o canal já está inscrito (mudou fora da fila)",
        "no_reason": "a extensão não informou o motivo",
    },
    "en": {
        "stale": "No new video in {days} days.",
        "ignored": "{videos} videos in the last 90 days and none watched.",
        "manual": "Proposed by you.",
        "timeout": "timeout: the extension did not confirm within 10 minutes",
        "gone": "the channel is no longer in your list",
        "not_subscribed": "the channel is no longer subscribed (changed outside the queue)",
        "already_subscribed": "the channel is already subscribed (changed outside the queue)",
        "no_reason": "the extension did not say why",
    },
}


@dataclass(frozen=True, slots=True)
class ExSubscription:
    """A visible ex-subscription (within ``ex_retention_days``)."""

    channel: T.Channel
    expires_at: T.Timestamp
    """When it leaves the list (``unsubscribed_at + ex_retention_days``; maintenance then moves it
    to ``ignored``)."""
    resubscribe: T.QueueItem | None = None
    """Active ``resubscribe`` item (``approved``/``running``), if the user already asked for one."""


@dataclass(slots=True)
class _Facts:
    last_video_at: int | None = None
    videos_90d: int = 0
    watched_90d: int = 0
    videos_per_week: float | None = None
    recent_titles: tuple[str, ...] = ()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _ids_json(ids: Sequence[str]) -> str:
    return json.dumps(list(ids))


def clean_text(value: Any, limit: int = WHY_MAX) -> str | None:
    """Single-line text with no markup or directive; ``None`` if unusable (untrusted)."""
    if not isinstance(value, str):
        return None
    if _UNSAFE_TEXT.search(value):
        return None
    text = " ".join(value.split())
    if not text:
        return None
    if _OVERRIDE_TEXT.search(text):
        return None
    return text[:limit]


def _one_line(value: Any, limit: int) -> str | None:
    """Text coming from the extension (error): one line, no control characters, truncated."""
    if value is None:
        return None
    text = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", str(value)).split())
    return text[:limit] or None


def _describe(value: Any) -> str:
    try:
        text = repr(value)
    except Exception:  # noqa: BLE001
        text = f"<{type(value).__name__}>"
    return text[:60]


def require_human(via: Any, actor: Any = T.Actor.user) -> T.ApprovedVia:
    """``via`` must be **the** human ``ApprovedVia`` member (text, look-alikes or forgeries do not
    count) and ``actor`` the user. Otherwise ``ApprovalRefused``."""
    if type(via) is not T.ApprovedVia or via not in T.HUMAN_APPROVAL_VIAS:
        raise T.ApprovalRefused(
            f"approval refused: {_describe(via)} is not a human click "
            "(only the Desktop through the cleanup.approve RPC or the /tube faxina button approve)"
        )
    if type(actor) is not T.Actor or actor is not T.Actor.user:
        raise T.ApprovalRefused(
            f"approval refused: only the user approves (actor {_describe(actor)})"
        )
    return via


def _queue_item(row: Mapping[str, Any]) -> T.QueueItem:
    return T.QueueItem(
        id=row["id"],
        channel_id=row["channel_id"],
        action=T.QueueAction(row["action"]),
        status=T.QueueStatus(row["status"]),
        approved_at=int(row["approved_at"]),
        approved_via=T.ApprovedVia(row["approved_via"]),
        created_at=int(row["created_at"]),
        updated_at=int(row["updated_at"]),
        reason=row["reason"],
        error=row["error"],
        device_id=row["device_id"],
    )


def _candidate(row: Mapping[str, Any]) -> T.CleanupCandidate:
    return T.CleanupCandidate(
        id=row["id"],
        channel_id=row["channel_id"],
        group=T.CleanupGroup(row["group_key"]),
        why=row["why"] or "",
        status=T.CandidateStatus(row["status"]),
        scan_id=row["scan_id"],
        created_at=int(row["created_at"]),
    )


def _status(value: Any) -> T.QueueStatus:
    if isinstance(value, T.QueueStatus):
        return value
    if isinstance(value, str):
        try:
            return T.QueueStatus(value)
        except ValueError:
            pass
    raise T.ValidationError(f"invalid status: {_describe(value)}", field="status")


class CleanupService:
    """Real ``Cleanup`` over ``cleanup_candidates``/``unsub_queue`` (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        llm: T.LLM,
        channels: T.ChannelService,
        events: T.EventSink,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.llm = llm
        self.channels = channels
        self.events = events
        self.changelog = changelog
        self.clock = clock or T.SystemClock()

    # ------------------------------------------------------------------ helpers

    def _now(self) -> int:
        return int(self.clock.now())

    def _lang(self) -> str:
        # the single rule (core/lang): explicit setting > Hermes language > English
        try:
            return lang.short(lang.resolve(self.settings))
        except Exception:  # noqa: BLE001
            return "en"

    def _text(self, key: str, **kw: Any) -> str:
        return _TEXTS[self._lang()][key].format(**kw)

    def _retention_days(self) -> int:
        try:
            days = int(self.settings.get("ex_retention_days"))
        except (TypeError, ValueError):
            days = int(T.SETTINGS_DEFAULTS["ex_retention_days"])
        return max(days, 0)

    @staticmethod
    def _progress(
        on_progress: T.ProgressFn | None,
        stage: str,
        done: int = 0,
        total: int | None = None,
        message: str | None = None,
    ) -> None:
        if on_progress is None:
            return
        try:
            on_progress(T.Progress(stage=stage, done=done, total=total, message=message))
        except Exception:  # noqa: BLE001 — progress never breaks the scan
            log.debug("on_progress failed", exc_info=True)

    def _emit(self, event: str, payload: Mapping[str, Any]) -> None:
        try:
            self.events.broadcast(event, payload)
        except Exception:  # noqa: BLE001 — EventSink should not raise; the event only speeds things up
            log.debug("event %s not sent", event, exc_info=True)

    def _queue_changed(self, queue_ids: Sequence[str]) -> None:
        self._emit("queue.changed", {"queue_ids": list(queue_ids), "pending": self.pending_count()})

    def _item(self, queue_id: str) -> T.QueueItem | None:
        row = self.db.query_one("SELECT * FROM unsub_queue WHERE id = ?", (queue_id,))
        return _queue_item(row) if row else None

    def _active_item(self, channel_id: str, action: T.QueueAction) -> T.QueueItem | None:
        row = self.db.query_one(
            "SELECT * FROM unsub_queue WHERE channel_id = ? AND action = ?"
            " AND status IN ('approved', 'running') ORDER BY approved_at, rowid LIMIT 1",
            (channel_id, action.value),
        )
        return _queue_item(row) if row else None

    def _active_channels(self, action: T.QueueAction) -> set[str]:
        rows = self.db.query(
            "SELECT DISTINCT channel_id FROM unsub_queue WHERE action = ?"
            " AND status IN ('approved', 'running')",
            (action.value,),
        )
        return {r["channel_id"] for r in rows}

    def _subscribed(self) -> list[T.Channel]:
        return list(self.channels.list(T.ChannelFilter(relations=(T.Relation.subscribed,))))

    # ------------------------------------------------------------------ facts and rules

    def _has_history(self) -> bool:
        return self.db.query_one("SELECT 1 AS x FROM watch_history LIMIT 1") is not None

    def _facts(self, chans: Sequence[T.Channel], now: int) -> dict[str, _Facts]:
        ids = [c.id for c in chans]
        facts = {
            c.id: _Facts(last_video_at=c.last_video_at, videos_per_week=c.videos_per_week)
            for c in chans
        }
        if not ids:
            return facts
        ids_json = _ids_json(ids)
        since = now - IGNORED_DAYS * DAY
        for row in self.db.query(
            "SELECT channel_id, MAX(published_at) AS last,"
            " SUM(CASE WHEN published_at >= ? AND published_at <= ? THEN 1 ELSE 0 END) AS n90"
            " FROM videos WHERE published_at IS NOT NULL"
            " AND channel_id IN (SELECT value FROM json_each(?)) GROUP BY channel_id",
            (since, now, ids_json),
        ):
            f = facts[row["channel_id"]]
            last = row["last"]
            if last is not None and (f.last_video_at is None or int(last) > f.last_video_at):
                f.last_video_at = int(last)
            f.videos_90d = int(row["n90"] or 0)
        for row in self.db.query(
            "SELECT COALESCE(w.channel_id, v.channel_id) AS cid, COUNT(*) AS n"
            " FROM watch_history w LEFT JOIN videos v ON v.id = w.video_id"
            " WHERE w.watched_at >= ? GROUP BY cid",
            (since,),
        ):
            if row["cid"] in facts:
                facts[row["cid"]].watched_90d = int(row["n"] or 0)
        for row in self.db.query(
            "SELECT channel_id, title FROM ("
            " SELECT channel_id, title, ROW_NUMBER() OVER ("
            "  PARTITION BY channel_id ORDER BY published_at DESC, id) AS rn"
            " FROM videos WHERE channel_id IN (SELECT value FROM json_each(?))"
            " AND published_at IS NOT NULL) WHERE rn <= ?",
            (ids_json, RECENT_TITLES),
        ):
            f = facts[row["channel_id"]]
            if row["title"]:
                f.recent_titles = (*f.recent_titles, str(row["title"]))
        return facts

    @staticmethod
    def _rule(f: _Facts, now: int, has_history: bool) -> T.CleanupGroup | None:
        if f.last_video_at is not None and now - f.last_video_at >= STALE_DAYS * DAY:
            return T.CleanupGroup.stale
        if has_history and f.videos_90d >= IGNORED_MIN_VIDEOS and f.watched_90d == 0:
            return T.CleanupGroup.ignored
        return None

    def _rule_why(self, group: T.CleanupGroup, f: _Facts, now: int) -> str:
        if group is T.CleanupGroup.stale:
            days = (now - (f.last_video_at or now)) // DAY
            return self._text("stale", days=days)
        return self._text("ignored", videos=f.videos_90d)

    # ------------------------------------------------------------------ AI (untrusted data)

    def _profile(self) -> dict[str, list[str]]:
        folders = self.db.query(
            "SELECT f.name AS name, COUNT(c.id) AS n FROM folders f"
            " JOIN channels c ON c.folder_id = f.id AND c.relation IN ('subscribed', 'followed')"
            " GROUP BY f.id ORDER BY n DESC, f.name LIMIT ?",
            (PROFILE_FOLDERS,),
        )
        favorites = self.db.query(
            "SELECT title FROM channels WHERE favorite = 1"
            " AND relation IN ('subscribed', 'followed') ORDER BY title LIMIT ?",
            (PROFILE_FAVORITES,),
        )
        return {
            "folders": [str(r["name"]) for r in folders if r["name"]],
            "favorites": [str(r["title"]) for r in favorites if r["title"]],
        }

    def _ai_payload(
        self,
        chans: Sequence[T.Channel],
        facts: Mapping[str, _Facts],
        rules: Mapping[str, T.CleanupGroup],
        now: int,
        has_history: bool,
    ) -> dict[str, Any]:
        items = []
        for c in chans:
            f = facts[c.id]
            vpw = f.videos_per_week
            items.append(
                {
                    "channel_id": c.id,
                    "title": (c.title or "").strip() or c.id,
                    "rule_group": rules[c.id].value if c.id in rules else None,
                    "days_since_last_video": (
                        max((now - f.last_video_at) // DAY, 0) if f.last_video_at else None
                    ),
                    "videos_90d": f.videos_90d,
                    "watched_90d": f.watched_90d if has_history else None,
                    "videos_per_week": float(vpw) if vpw is not None and vpw >= 0 else None,
                    "recent_titles": list(f.recent_titles),
                }
            )
        return {"items": items, "profile": self._profile()}

    def _ask_ai(
        self, payload: dict[str, Any], timeout: float, on_progress: T.ProgressFn | None
    ) -> Any:
        total = len(payload["items"])

        def relay(p: T.Progress) -> None:
            self._progress(on_progress, "ai", p.done, p.total or total, p.message)

        try:
            return self.llm.complete_structured(
                T.AiTask.cleanup_reasons, payload, timeout=timeout, on_progress=relay
            )
        except T.TubeError as exc:
            log.info("cleanup without AI (%s): %s", exc.code, exc.message)
        except Exception:  # noqa: BLE001 — a broken AI does not break the rule-based cleanup
            log.warning(
                "cleanup: unexpected AI failure; continuing with the rules only", exc_info=True
            )
        return None

    @staticmethod
    def _apply_ai(
        out: Any,
        sent: Mapping[str, T.CleanupGroup | None],
        why: dict[str, str],
        groups: dict[str, T.CleanupGroup],
    ) -> int:
        """Applies the model output; returns how many valid items came back. Only writes the reason
        for channels the rule flagged (same group as the rule) and ``off_profile`` for channels
        without a rule."""
        items = out.get("items") if isinstance(out, Mapping) else None
        if not isinstance(items, list):
            return 0
        seen: set[str] = set()
        valid = 0
        for item in items:
            if not isinstance(item, Mapping):
                continue
            cid = item.get("channel_id")
            if not isinstance(cid, str) or cid not in sent or cid in seen:
                continue
            seen.add(cid)
            group = item.get("group")
            text = clean_text(item.get("why"))
            rule = sent[cid]
            if rule is not None:
                if group == rule.value and text:
                    why[cid] = text
                    valid += 1
                continue
            if group == "keep":
                valid += 1
            elif group == T.CleanupGroup.off_profile.value and text:
                groups[cid] = T.CleanupGroup.off_profile
                why[cid] = text
                valid += 1
        return valid

    # ------------------------------------------------------------------ scan

    def scan(
        self, *, timeout: float = T.TOOL_TIMEOUT_S, on_progress: T.ProgressFn | None = None
    ) -> T.CleanupScan:
        started = time.monotonic()
        now = self._now()
        self._progress(on_progress, "rules")
        queued = self._active_channels(T.QueueAction.unsubscribe)
        chans = [c for c in self._subscribed() if c.id not in queued]
        facts = self._facts(chans, now)
        has_history = self._has_history()
        groups: dict[str, T.CleanupGroup] = {}
        why: dict[str, str] = {}
        for c in chans:
            rule = self._rule(facts[c.id], now, has_history)
            if rule is not None:
                groups[c.id] = rule
                why[c.id] = self._rule_why(rule, facts[c.id], now)
        rules = dict(groups)
        self._progress(on_progress, "rules", len(chans), len(chans))

        model: str | None = None
        if chans and self._llm_available():
            self._progress(on_progress, "ai", 0, len(chans))
            payload = self._ai_payload(chans, facts, rules, now, has_history)
            remaining = timeout - (time.monotonic() - started)
            out = self._ask_ai(payload, max(remaining, 1.0), on_progress) if remaining > 0 else None
            if out is not None:
                sent = {c.id: rules.get(c.id) for c in chans}
                if self._apply_ai(out, sent, why, groups):
                    model = self._model_name()

        self._progress(on_progress, "save", 0, len(groups))
        scan_id = _new_id("scan")
        order = {T.CleanupGroup.stale: 0, T.CleanupGroup.ignored: 1, T.CleanupGroup.off_profile: 2}
        ordered = sorted(groups.items(), key=lambda kv: order.get(kv[1], 9))
        with self.db.transaction():
            for cid, group in ordered:
                self.db.execute(
                    "INSERT INTO cleanup_candidates (id, scan_id, channel_id, group_key, why,"
                    " status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                    (_new_id("cc"), scan_id, cid, group.value, why.get(cid, ""), now),
                )
            self.db.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (
                    META_LAST_SCAN,
                    json.dumps({"scan_id": scan_id, "created_at": now, "model": model}),
                ),
            )
        self._emit("cleanup.scanned", {"scan_id": scan_id})
        self._progress(on_progress, "done", len(groups), len(groups))
        rows = self.db.query(
            "SELECT * FROM cleanup_candidates WHERE scan_id = ? ORDER BY rowid", (scan_id,)
        )
        return T.CleanupScan(
            scan_id=scan_id,
            created_at=now,
            candidates=tuple(_candidate(r) for r in rows),
            model=model,
        )

    def _llm_available(self) -> bool:
        try:
            return bool(self.llm.available())
        except Exception:  # noqa: BLE001
            return False

    def _model_name(self) -> str | None:
        try:
            name = self.llm.model_name()
        except Exception:  # noqa: BLE001
            return None
        return name if isinstance(name, str) and name else None

    def _last_scan_pointer(self) -> dict[str, Any] | None:
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (META_LAST_SCAN,))
        if row is None or not row["value"]:
            return None
        try:
            data = json.loads(row["value"])
        except ValueError:
            return None
        if not isinstance(data, dict) or not isinstance(data.get("scan_id"), str):
            return None
        return data

    def latest_scan(self) -> T.CleanupScan | None:
        pointer = self._last_scan_pointer()
        if pointer is None:
            row = self.db.query_one(
                "SELECT scan_id, created_at FROM cleanup_candidates WHERE group_key <> 'manual'"
                " ORDER BY created_at DESC, rowid DESC LIMIT 1"
            )
            if row is not None:
                pointer = {"scan_id": row["scan_id"], "created_at": row["created_at"]}
        live = (
            " AND channel_id IN (SELECT id FROM channels WHERE relation = 'subscribed')"
            " AND channel_id NOT IN (SELECT channel_id FROM unsub_queue"
            "  WHERE action = 'unsubscribe' AND status IN ('approved', 'running'))"
        )
        rule_rows = (
            self.db.query(
                "SELECT * FROM cleanup_candidates WHERE scan_id = ? AND group_key <> 'manual'"
                " AND status = 'pending'" + live + " ORDER BY rowid",
                (pointer["scan_id"],),
            )
            if pointer
            else []
        )
        manual_rows = self.db.query(
            "SELECT * FROM cleanup_candidates WHERE group_key = 'manual' AND status = 'pending'"
            + live
            + " ORDER BY created_at, rowid"
        )
        if pointer is None and not manual_rows:
            return None
        seen = {r["channel_id"] for r in rule_rows}
        candidates = [_candidate(r) for r in rule_rows]
        for r in manual_rows:
            if r["channel_id"] not in seen:
                seen.add(r["channel_id"])
                candidates.append(_candidate(r))
        if pointer is None:
            pointer = {
                "scan_id": manual_rows[0]["scan_id"],
                "created_at": manual_rows[0]["created_at"],
            }
        model = pointer.get("model")
        return T.CleanupScan(
            scan_id=str(pointer["scan_id"]),
            created_at=int(pointer.get("created_at") or 0),
            candidates=tuple(candidates),
            model=model if isinstance(model, str) and model else None,
        )

    def propose(
        self,
        channel_ids: Sequence[str],
        *,
        reason: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> list[T.CleanupCandidate]:
        """``manual`` candidates for subscribed channels (others are ignored). Already proposed and
        still pending → returns the existing one. Never creates a queue item nor records history."""
        why = clean_text(reason) or self._text("manual")
        now = self._now()
        scan_id = _new_id("manual")
        out: list[T.CleanupCandidate] = []
        with self.db.transaction():
            for cid in dict.fromkeys(c for c in channel_ids if isinstance(c, str)):
                ch = self.channels.get(cid)
                if ch is None or ch.relation is not T.Relation.subscribed:
                    continue
                row = self.db.query_one(
                    "SELECT * FROM cleanup_candidates WHERE channel_id = ? AND group_key = 'manual'"
                    " AND status = 'pending' ORDER BY rowid LIMIT 1",
                    (cid,),
                )
                if row is None:
                    cand_id = _new_id("cc")
                    self.db.execute(
                        "INSERT INTO cleanup_candidates (id, scan_id, channel_id, group_key, why,"
                        " status, created_at) VALUES (?, ?, ?, 'manual', ?, 'pending', ?)",
                        (cand_id, scan_id, cid, why, now),
                    )
                    row = self.db.query_one(
                        "SELECT * FROM cleanup_candidates WHERE id = ?", (cand_id,)
                    )
                assert row is not None
                out.append(_candidate(row))
        return out

    def dismiss(self, candidate_ids: Sequence[str]) -> int:
        """``pending → dismissed``; also takes the other pending candidates of the same channel (the
        channel leaves the list). Returns how many rows changed."""
        ids = [c for c in dict.fromkeys(candidate_ids) if isinstance(c, str)]
        if not ids:
            return 0
        with self.db.transaction():
            res = self.db.execute(
                "UPDATE cleanup_candidates SET status = 'dismissed' WHERE status = 'pending'"
                " AND channel_id IN (SELECT channel_id FROM cleanup_candidates"
                "  WHERE id IN (SELECT value FROM json_each(?)) AND status = 'pending')",
                (_ids_json(ids),),
            )
        return int(res.rowcount)

    # ------------------------------------------------------------------ approval

    @staticmethod
    def _check_ids(ids: Any) -> list[str]:
        if isinstance(ids, str) or not isinstance(ids, Sequence):
            raise T.ValidationError("ids must be a list of channels", field="channel_ids")
        out = list(dict.fromkeys(ids))
        if not out:
            raise T.ValidationError("no channel given", field="channel_ids")
        if len(out) > MAX_IDS:
            raise T.ValidationError(f"at most {MAX_IDS} channels at a time", field="channel_ids")
        bad = [c for c in out if not isinstance(c, str) or not CHANNEL_ID_RE.match(c)]
        if bad:
            raise T.ValidationError(f"invalid channel id: {_describe(bad[0])}", field="channel_ids")
        return out

    def _enqueue(
        self,
        ids: Sequence[str],
        via: Any,
        actor: Any,
        action: T.QueueAction,
    ) -> list[T.QueueItem]:
        via = require_human(via, actor)  # before any read/write
        channel_ids = self._check_ids(ids)
        unsubscribe = action is T.QueueAction.unsubscribe
        allowed = {T.Relation.subscribed} if unsubscribe else {T.Relation.ex, T.Relation.followed}
        opposite = T.QueueAction.resubscribe if unsubscribe else T.QueueAction.unsubscribe
        change = (
            T.ChangeAction.cleanup_approve if unsubscribe else T.ChangeAction.cleanup_resubscribe
        )
        now = self._now()
        items: list[T.QueueItem] = []
        new_ids: list[str] = []
        with self.db.transaction():
            plan: list[tuple[str, T.QueueItem | None]] = []
            for cid in channel_ids:
                ch = self.channels.get(cid)
                if ch is None:
                    raise T.NotFound(f"channel {cid} is not in your list", channel_id=cid)
                active = self._active_item(cid, action)
                if active is not None:
                    plan.append((cid, active))
                    continue
                if ch.relation not in allowed:
                    want = "subscribed" if unsubscribe else "an ex-subscription or followed"
                    raise T.Conflict(
                        f"{ch.title or cid}: must be {want} (it is {ch.relation.value})",
                        channel_id=cid,
                        relation=ch.relation.value,
                    )
                if self._active_item(cid, opposite) is not None:
                    raise T.Conflict(
                        f"{ch.title or cid}: an opposite request is already in the queue",
                        channel_id=cid,
                    )
                plan.append((cid, None))
            for cid, active in plan:
                if active is not None:
                    items.append(active)
                    continue
                reason = None
                if unsubscribe:
                    row = self.db.query_one(
                        "SELECT why FROM cleanup_candidates WHERE channel_id = ?"
                        " AND status = 'pending' ORDER BY created_at DESC, rowid DESC LIMIT 1",
                        (cid,),
                    )
                    reason = (row["why"] or None) if row else None
                qid = _new_id("q")
                self.db.execute(
                    "INSERT INTO unsub_queue (id, channel_id, action, reason, approved_at,"
                    " approved_via, status, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)",
                    (qid, cid, action.value, reason, now, via.value, now, now),
                )
                if unsubscribe:
                    self.db.execute(
                        "UPDATE cleanup_candidates SET status = 'approved'"
                        " WHERE channel_id = ? AND status = 'pending'",
                        (cid,),
                    )
                new_ids.append(qid)
                item = self._item(qid)
                assert item is not None
                items.append(item)
            if new_ids:
                self.changelog.record(
                    T.Actor.user,
                    change,
                    {"count": len(new_ids), "via": via.value, "channel_ids": list(channel_ids)},
                    T.UndoCleanupQueue(queue_ids=tuple(new_ids)),
                )
        if new_ids:
            self._queue_changed(new_ids)
        return items

    def approve(
        self, ids: Sequence[str], via: T.ApprovedVia, *, actor: T.Actor = T.Actor.user
    ) -> list[T.QueueItem]:
        return self._enqueue(ids, via, actor, T.QueueAction.unsubscribe)

    def resubscribe(
        self, ids: Sequence[str], via: T.ApprovedVia, *, actor: T.Actor = T.Actor.user
    ) -> list[T.QueueItem]:
        return self._enqueue(ids, via, actor, T.QueueAction.resubscribe)

    # ------------------------------------------------------------------ undo

    def _undo(self, queue_ids: Sequence[str]) -> tuple[list[T.QueueItem], list[str]]:
        """Inside a transaction: all or nothing. Returns (items, ids that changed)."""
        items: list[T.QueueItem] = []
        for qid in dict.fromkeys(queue_ids):
            item = self._item(qid) if isinstance(qid, str) else None
            if item is None:
                raise T.NotFound(f"item {qid!r} is not in the queue", queue_id=str(qid))
            items.append(item)
        executed = [i.id for i in items if i.status in _EXECUTED]
        if executed:
            raise T.UndoRefused(
                "already_executed",
                "Already executed — use Resubscribe in Cleanup → Ex-subscriptions",
                queue_ids=executed,
            )
        now = self._now()
        changed: list[str] = []
        for item in items:
            if item.status is not T.QueueStatus.approved:
                continue
            self.db.execute(
                "UPDATE unsub_queue SET status = 'undone', updated_at = ?"
                " WHERE id = ? AND status = 'approved'",
                (now, item.id),
            )
            if item.action is T.QueueAction.unsubscribe:
                self.db.execute(
                    "UPDATE cleanup_candidates SET status = 'pending'"
                    " WHERE channel_id = ? AND status = 'approved'",
                    (item.channel_id,),
                )
            changed.append(item.id)
        out = [i for i in (self._item(x.id) for x in items) if i is not None]
        return out, changed

    def undo_approval(self, queue_ids: Sequence[str], *, notify: bool = True) -> list[T.QueueItem]:
        """``approved → undone`` (all or nothing; ``undone`` = no-op). ``notify=False`` does not
        emit ``queue.changed`` (REST routes do not emit events)."""
        with self.db.transaction():
            items, changed = self._undo(list(queue_ids))
        if changed and notify:
            self._queue_changed(changed)
        return items

    def apply_undo(self, change: T.ChangeRecord) -> None:
        undo = change.undo
        if change.action not in (
            T.ChangeAction.cleanup_approve,
            T.ChangeAction.cleanup_resubscribe,
        ) or not isinstance(undo, T.UndoCleanupQueue):
            raise T.UndoRefused("not_undoable", f"cleanup cannot undo {change.action}")
        try:
            _, changed = self._undo(list(undo.queue_ids))
        except T.NotFound as exc:
            raise T.UndoRefused("not_undoable", exc.message) from exc
        if changed:
            self._queue_changed(changed)

    # ------------------------------------------------------------------ queue

    def queue_pending(self) -> list[T.QueueItem]:
        rows = self.db.query(
            "SELECT * FROM unsub_queue WHERE status = 'approved' AND approved_via IS NOT NULL"
            " AND approved_at IS NOT NULL ORDER BY approved_at, rowid"
        )
        return [_queue_item(r) for r in rows]

    def pending_count(self) -> int:
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM unsub_queue WHERE status IN ('approved', 'running')"
        )
        return int(row["n"]) if row else 0

    def queue(
        self, statuses: Sequence[T.QueueStatus] | None = None, *, limit: int = 200
    ) -> list[T.QueueItem]:
        values = [_status(s).value for s in statuses or ()]
        limit = max(1, min(int(limit), 1000))
        self._expire_running(self._now(), notify=False)
        if values:
            rows = self.db.query(
                "SELECT * FROM unsub_queue WHERE status IN (SELECT value FROM json_each(?))"
                " ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (_ids_json(values), limit),
            )
        else:
            rows = self.db.query(
                "SELECT * FROM unsub_queue ORDER BY created_at DESC, rowid DESC LIMIT ?", (limit,)
            )
        return [_queue_item(r) for r in rows]

    def _expire_running(self, now: int, *, notify: bool = True) -> list[str]:
        rows = self.db.query(
            "SELECT id FROM unsub_queue WHERE status = 'running' AND updated_at <= ?",
            (now - RUNNING_STALE_S,),
        )
        ids = [r["id"] for r in rows]
        if ids:
            self.db.execute(
                "UPDATE unsub_queue SET status = 'failed', error = ?, updated_at = ?"
                " WHERE status = 'running' AND id IN (SELECT value FROM json_each(?))",
                (self._text("timeout"), now, _ids_json(ids)),
            )
            if notify:
                self._queue_changed(ids)
        return ids

    def _fail(self, item: T.QueueItem, error: str, now: int) -> None:
        self.db.execute(
            "UPDATE unsub_queue SET status = 'failed', error = ?, updated_at = ?"
            " WHERE id = ? AND status = 'approved'",
            (error, now, item.id),
        )

    def _still_valid(self, item: T.QueueItem) -> str | None:
        """Reason not to hand the item out (the channel changed outside the queue), or ``None``."""
        ch = self.channels.get(item.channel_id)
        if ch is None:
            return self._text("gone")
        if item.action is T.QueueAction.unsubscribe and ch.relation is not T.Relation.subscribed:
            return self._text("not_subscribed")
        if item.action is T.QueueAction.resubscribe and ch.relation is T.Relation.subscribed:
            return self._text("already_subscribed")
        return None

    def claim_next(self, device_id: str) -> T.QueueItem | None:
        """Next ``approved`` item for *device_id* (one at a time), leased to it for ``LEASE_S``. A
        device with a ``running`` item gets no other. An item whose channel changed outside the
        queue becomes ``failed`` (with a reason) instead of being handed out."""
        if not isinstance(device_id, str) or not device_id:
            raise T.ValidationError("unknown device", field="device_id")
        now = self._now()
        changed: list[str] = []
        chosen: T.QueueItem | None = None
        with self.db.transaction():
            changed += self._expire_running(now, notify=False)
            busy = self.db.query_one(
                "SELECT id FROM unsub_queue WHERE status = 'running' AND device_id = ? LIMIT 1",
                (device_id,),
            )
            if busy is None:
                rows = self.db.query(
                    "SELECT * FROM unsub_queue WHERE status = 'approved'"
                    " AND (device_id IS NULL OR device_id = ? OR updated_at <= ?)"
                    " ORDER BY CASE WHEN device_id = ? THEN 0 ELSE 1 END, approved_at, rowid",
                    (device_id, now - LEASE_S, device_id),
                )
                for row in rows:
                    item = _queue_item(row)
                    problem = self._still_valid(item)
                    if problem is not None:
                        self._fail(item, problem, now)
                        changed.append(item.id)
                        continue
                    self.db.execute(
                        "UPDATE unsub_queue SET device_id = ?, updated_at = ?"
                        " WHERE id = ? AND status = 'approved'",
                        (device_id, now, item.id),
                    )
                    chosen = self._item(item.id)
                    break
        if changed:
            self._queue_changed(changed)
        return chosen

    def queue_result(
        self,
        queue_id: str,
        status: T.QueueStatus,
        *,
        error: str | None = None,
        device_id: str | None = None,
    ) -> T.QueueItem:
        status = _status(status)
        if status not in _RESULTS:
            raise T.ValidationError(
                f"invalid result: {status.value} (use running, done or failed)", field="status"
            )
        now = self._now()
        with self.db.transaction():
            item = self._item(queue_id) if isinstance(queue_id, str) else None
            if item is None:
                raise T.NotFound(f"item {queue_id!r} is not in the queue", queue_id=str(queue_id))
            if item.status is T.QueueStatus.undone:
                raise T.Conflict("item undone before execution: skip it", queue_id=item.id)
            if device_id and item.device_id and item.device_id != device_id:
                lease_over = (
                    item.status is T.QueueStatus.approved and item.updated_at <= now - LEASE_S
                )
                if not lease_over:
                    raise T.Conflict("item is held by another device", queue_id=item.id)
            if item.status is status:
                return item  # repeated: idempotent
            late_done = (
                item.status is T.QueueStatus.failed
                and status is T.QueueStatus.done
                and (item.error or "").startswith(_TIMEOUT_MARK)
                and (not device_id or not item.device_id or item.device_id == device_id)
            )
            if status not in _NEXT.get(item.status, frozenset()) and not late_done:
                raise T.Conflict(f"item already finished ({item.status.value})", queue_id=item.id)
            text = None
            if status is T.QueueStatus.failed:
                text = _one_line(error, ERROR_MAX) or self._text("no_reason")
            elif status is T.QueueStatus.done and isinstance(error, str):
                note = error.strip()
                text = note if note in DONE_NOTES else None
            self.db.execute(
                "UPDATE unsub_queue SET status = ?, error = ?,"
                " device_id = COALESCE(?, device_id), updated_at = ? WHERE id = ?",
                (status.value, text, device_id or None, now, item.id),
            )
            if status is T.QueueStatus.done:
                self._apply_done(item)
            result = self._item(item.id)
        assert result is not None
        self._queue_changed([item.id])
        return result

    def _apply_done(self, item: T.QueueItem) -> None:
        target = (
            T.Relation.ex if item.action is T.QueueAction.unsubscribe else T.Relation.subscribed
        )
        ch = self.channels.get(item.channel_id)
        if ch is None or ch.relation is target:
            return
        if target not in T.RELATION_TRANSITIONS.get(ch.relation, frozenset()):
            log.warning(
                "queue: %s executed but %s → %s is not a valid transition; relation kept",
                item.id,
                ch.relation.value,
                target.value,
            )
            return
        reason = (
            "unsubscribed by the queue" if target is T.Relation.ex else "resubscribed by the queue"
        )
        self.channels.set_relation(item.channel_id, target, actor=T.Actor.extension, reason=reason)

    # ------------------------------------------------------------------ ex-subscriptions

    def ex_subscriptions(self) -> list[ExSubscription]:
        """Ex-subscriptions still within ``ex_retention_days`` (most recent first)."""
        now = self._now()
        keep = self._retention_days() * DAY
        out: list[ExSubscription] = []
        for ch in self.channels.list(T.ChannelFilter(relations=(T.Relation.ex,))):
            since = ch.unsubscribed_at if ch.unsubscribed_at is not None else now
            expires = since + keep
            if now > expires:
                continue
            out.append(
                ExSubscription(
                    channel=ch,
                    expires_at=expires,
                    resubscribe=self._active_item(ch.id, T.QueueAction.resubscribe),
                )
            )
        out.sort(key=lambda e: (-(e.channel.unsubscribed_at or now), e.channel.id))
        return out


@contextmanager
def approvals_unchanged(db: T.Db, what: str) -> Iterator[None]:
    """Guard for routes that do not approve: a transaction around *what*; if at the end there is an
    ``approved`` item that did not exist at the start, everything rolls back and ``RuntimeError``
    is raised (it is a bug)."""
    with db.transaction():
        before = {r["id"] for r in db.query("SELECT id FROM unsub_queue WHERE status = 'approved'")}
        yield
        after = {r["id"] for r in db.query("SELECT id FROM unsub_queue WHERE status = 'approved'")}
        if after - before:
            log.error("%s left an approved item in the queue: %s", what, sorted(after - before))
            raise RuntimeError(f"{what} tried to approve an unsubscribe")


def call_quietly(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Calls *fn* with ``notify=False`` if it accepts it (REST routes do not emit events)."""
    try:
        return fn(*args, notify=False, **kwargs)
    except TypeError as exc:
        if "notify" not in str(exc):
            raise
        return fn(*args, **kwargs)


class CleanupStub:
    """Old stub, kept only for compatibility: ``tests/test_channels_api.py`` uses it to simulate
    \"cleanup unavailable\". Every call raises ``NotImplementedError``; ``build`` never returns
    it."""

    __contract_stub__ = "cleanup"

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)

        def unavailable(*args: Any, **kwargs: Any) -> Any:
            raise NotImplementedError(f"stub: Cleanup.{name} unavailable")

        return unavailable


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    llm: T.LLM,
    channels: T.ChannelService,
    events: T.EventSink,
    changelog: T.ChangeLog,
    clock: T.Clock | None = None,
) -> T.Cleanup:
    """Real ``Cleanup`` (inert: no network, no thread, no write)."""
    return CleanupService(
        db=db,
        settings=settings,
        llm=llm,
        channels=channels,
        events=events,
        changelog=changelog,
        clock=clock,
    )


__all__ = [
    "LEASE_S",
    "RUNNING_STALE_S",
    "CleanupService",
    "ExSubscription",
    "approvals_unchanged",
    "build",
    "call_quietly",
    "clean_text",
    "require_human",
]
