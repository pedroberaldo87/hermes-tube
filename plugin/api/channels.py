"""REST routes for channels: Manage, dashboard, Former subscriptions and "paste a link".

Plain ``def`` routes (< 2 s, no AI, no events); services only through ``wiring``. A ``TubeError``
becomes an envelope right in the handler (``guard``: a direct call = the router's answer); any
other exception goes up to the router (``internal`` + log). Every write records ``actor=user`` in
the history.

- **Body** validated here, strictly (type of each field, unknown key → ``invalid``,
  ``minProperties``/``minItems``); domain rules (relation transitions, existing folder/tag,
  dedup) live in ``ChannelService`` (``core/channels.py``).
- **Manage row** (``ChannelRow``) — ``new_count`` = ``new`` videos with ``published_at``
  above the watermark (a channel without a watermark = everything is new), within the feed's
  30-day "fresh" window (same count as the dashboard); ``watched_90d`` = distinct videos in
  ``watch_history`` over the last 90 days, ``null`` while no device has sent history. Read
  straight from the tables, only for the page.
- **Order** — normalized title (no accents/case) then id: the table's default order; ``total`` is
  the count with the filter, without ``limit``/``offset`` (a single read).
- **Batch** — atomic: a missing channel → ``not_found`` with the whole list, nothing changes. The
  ``unsubscribe`` batch **only** calls ``Cleanup.propose`` (a ``manual`` cleanup candidate); a
  channel that is not ``subscribed`` → ``conflict`` (nothing is proposed). Guard: no route in this
  module may leave the ``unsub_queue`` bigger or with one more active item — if it does, the
  transaction rolls back and the route answers ``internal`` (a bug in whoever wrote to the queue).
- **Add** — ``ChannelService.add`` (resolves through ``YouTubeClient`` when nothing matches
  locally) in a thread with deadline ``ADD_DEADLINE_S``; past it → ``timeout`` with
  ``details.pending=true`` (the request keeps going and the channel shows up when YouTube
  answers). Channel already in the list with nothing to change → ``conflict`` with
  ``details.channel``; ``ignored``/``ex`` go back to ``followed`` (``ok``). After adding,
  ``Refresher.kick_channel(id)`` without waiting (with RSS down, the core fetches the channel
  page); a refresher failure does not undo the addition.
"""

from __future__ import annotations

import contextvars
import dataclasses
import functools
import json
import logging
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

from tube_pkg import wiring
from tube_pkg._id import PLUGIN_ID
from tube_pkg.api._common import Envelope, RestHandler, contract, error_envelope, ok
from tube_pkg.core import channels as core_channels
from tube_pkg.core import dedup
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

LIST_MAX_LIMIT = 2000
"""Maximum ``limit`` of ``GET /channels`` (api.yaml)."""
ADD_DEADLINE_S = 1.8
"""Deadline of ``POST /channels/add`` before answering ``timeout`` (route < 2 s)."""
NEW_WINDOW_S = 30 * 86_400
""""New" window of the Manage row = the feed's ``fresh`` mode (``FRESH_WINDOW_S``)."""
WATCH_WINDOW_S = 90 * 86_400
"""Window of ``watched_90d``."""

UNSUBSCRIBE_OP = core_channels.UNSUBSCRIBE_OP
BATCH_OPS = frozenset(op.value for op in T.BatchOp)

_PATCH_KEYS = frozenset(
    {"folder_id", "favorite", "muted", "ai_note", "title", "tag_ids", "relation"}
)
_PATCH_RELATIONS = frozenset({T.Relation.followed.value, T.Relation.ignored.value})
_BATCH_KEYS = frozenset({"op", "channel_ids", "value", "reason"})
_ADD_KEYS = frozenset({"url_or_handle", "folder_id"})
_STR_OR_NULL = (str, type(None))


# =========================================================================== shared


def guard(fn: RestHandler) -> RestHandler:
    """A ``TubeError`` becomes an error envelope right in the handler (a direct call = the same
    answer as the router); any other exception goes up to the router (``internal`` + log)."""

    @functools.wraps(fn)
    def wrapper(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
        try:
            return fn(body, query)
        except T.TubeError as exc:
            return error_envelope(exc)

    return wrapper


def body_object(body: Mapping[str, Any] | None, allowed: frozenset[str]) -> Mapping[str, Any]:
    """JSON object body, only with schema keys (unknown key → ``invalid``)."""
    if not isinstance(body, Mapping):
        raise T.ValidationError("body must be a JSON object")
    extra = sorted(str(k) for k in body if k not in allowed)
    if extra:
        raise T.ValidationError(f"unknown field: {', '.join(extra)}", field=extra[0])
    return body


def field(
    body: Mapping[str, Any], key: str, kinds: tuple[type, ...], *, required: bool = False
) -> Any:
    """Value of *key* with its type checked (``bool`` never passes as ``int``); missing →
    ``T.UNSET`` (or ``invalid`` if *required*)."""
    if key not in body:
        if required:
            raise T.ValidationError(f"{key}: required", field=key)
        return T.UNSET
    value = body[key]
    if isinstance(value, bool) and bool not in kinds:
        raise T.ValidationError(f"{key}: invalid type", field=key)
    if not isinstance(value, kinds):
        raise T.ValidationError(f"{key}: invalid type", field=key)
    return value


def str_list(body: Mapping[str, Any], key: str, *, required: bool, min_items: int = 0) -> Any:
    value = field(body, key, (list,), required=required)
    if value is T.UNSET:
        return value
    if len(value) < min_items or not all(isinstance(v, str) for v in value):
        raise T.ValidationError(
            f"{key}: list of strings" + (", not empty" if min_items else ""), field=key
        )
    return list(value)


def path_id(query: Mapping[str, str] | None, what: str = "channel") -> str:
    value = str((query or {}).get("id") or "").strip()
    if not value:
        raise T.NotFound(f"{what} id missing")
    return value


def _is_stub(obj: Any) -> bool:
    return obj is None or bool(getattr(obj, "__contract_stub__", None))


def _ids_json(ids: Sequence[str]) -> str:
    return json.dumps(list(ids))


# =========================================================================== queue guard


def _queue_mark(db: T.Db) -> tuple[int, int]:
    row = db.query_one(
        "SELECT COUNT(*) AS n, COALESCE(SUM(status IN ('approved', 'running')), 0) AS active"
        " FROM unsub_queue"
    )
    return (int(row["n"]), int(row["active"])) if row else (0, 0)


class QueueTouched(RuntimeError):
    """A REST route left the queue bigger or with one more active item (a bug in the writer)."""


@contextmanager
def queue_untouched(db: T.Db, what: str) -> Iterator[None]:
    """Transaction around *what*: at the end, the queue may not have **more** items nor more
    active items (``approved``/``running``) than at the start — otherwise everything rolls back
    and ``QueueTouched`` is raised. No REST route results in ``approved``; undo never creates an
    item."""
    with db.transaction():
        before = _queue_mark(db)
        yield
        after = _queue_mark(db)
        if after[0] > before[0] or after[1] > before[1]:
            log.error(
                "%s: %s touched the unsubscribe queue (%s → %s)", PLUGIN_ID, what, before, after
            )
            raise QueueTouched(f"{what} tried to create/approve a queue item")


# =========================================================================== rows


def _row_counters(
    db: T.Db, ids: Sequence[str], now: int
) -> tuple[dict[str, int], dict[str, int] | None]:
    """``new_count`` and ``watched_90d`` of channels *ids* (``None`` = no history yet)."""
    if not ids:
        return {}, None
    payload = _ids_json(ids)
    new_rows = db.query(
        "SELECT v.channel_id AS cid, COUNT(*) AS n FROM videos v"
        " LEFT JOIN video_state s ON s.video_id = v.id"
        " LEFT JOIN watermarks w ON w.channel_id = v.channel_id"
        " WHERE v.channel_id IN (SELECT value FROM json_each(?))"
        " AND COALESCE(s.state, 'new') = 'new'"
        " AND (w.seen_up_to IS NULL OR COALESCE(v.published_at, 0) > w.seen_up_to)"
        " AND (v.published_at IS NULL OR v.published_at >= ?)"
        " GROUP BY v.channel_id",
        (payload, now - NEW_WINDOW_S),
    )
    new = {r["cid"]: int(r["n"]) for r in new_rows}
    if db.query_one("SELECT 1 AS x FROM watch_history LIMIT 1") is None:
        return new, None
    watched_rows = db.query(
        "SELECT channel_id AS cid, COUNT(DISTINCT video_id) AS n FROM watch_history"
        " WHERE channel_id IN (SELECT value FROM json_each(?)) AND watched_at >= ?"
        " GROUP BY channel_id",
        (payload, now - WATCH_WINDOW_S),
    )
    return new, {r["cid"]: int(r["n"]) for r in watched_rows}


def channel_rows(channels: Sequence[T.Channel]) -> list[dict[str, Any]]:
    """``ChannelRow`` (api.yaml) of each channel, in the same order."""
    now = int(wiring.get_clock().now())
    new, watched = _row_counters(wiring.get_db(), [c.id for c in channels], now)
    return [
        {
            "channel": c,
            "new_count": new.get(c.id, 0),
            "watched_90d": None if watched is None else watched.get(c.id, 0),
        }
        for c in channels
    ]


def _require_channels(svc: T.ChannelService, ids: Sequence[str]) -> list[T.Channel]:
    """All channels, or ``not_found`` listing the missing ones (atomic batch)."""
    found: list[T.Channel] = []
    missing: list[str] = []
    for channel_id in dict.fromkeys(ids):
        ch = svc.get(channel_id)
        if ch is None:
            missing.append(channel_id)
        else:
            found.append(ch)
    if missing:
        raise T.NotFound(f"channel not found: {', '.join(missing)}", channel_ids=missing)
    return found


# =========================================================================== GET /channels


@contract.real
@guard
def get_channels(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /channels.

    Channels with filters (Manage, dashboard, Former subscriptions)
    """
    f = core_channels.parse_filter(query or {})
    if f.limit is not None and f.limit > LIST_MAX_LIMIT:
        raise T.ValidationError(f"limit must be ≤ {LIST_MAX_LIMIT}", field="limit")
    everything = wiring.get_channels().list(dataclasses.replace(f, limit=None, offset=0))
    end = None if f.limit is None else f.offset + f.limit
    page = everything[f.offset : end]
    return ok({"items": channel_rows(page), "total": len(everything)})


# =========================================================================== GET /channels/{id}


@contract.real
@guard
def get_channel(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /channels/{id}.

    One channel
    """
    channel_id = path_id(query)
    ch = wiring.get_channels().get(channel_id)
    if ch is None:
        raise T.NotFound(f"channel {channel_id} does not exist", channel_id=channel_id)
    return ok(channel_rows([ch])[0])


# =========================================================================== PATCH /channels/{id}


@contract.real
@guard
def patch_channel(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """PATCH /channels/{id}.

    Edit a channel (⭐, mute, folder, tags, note, follow/ignore)
    """
    data = body_object(body, _PATCH_KEYS)
    if not data:
        raise T.ValidationError("provide at least one field")
    channel_id = path_id(query)
    patch = T.ChannelPatch(
        folder_id=field(data, "folder_id", _STR_OR_NULL),
        favorite=field(data, "favorite", (bool,)),
        muted=field(data, "muted", (bool,)),
        ai_note=field(data, "ai_note", _STR_OR_NULL),
        title=field(data, "title", (str,)),
    )
    if patch.title is not T.UNSET and not patch.title.strip():
        raise T.ValidationError("title: cannot be empty", field="title")
    tag_ids = str_list(data, "tag_ids", required=False)
    relation = field(data, "relation", (str,))
    if relation is not T.UNSET and relation not in _PATCH_RELATIONS:
        raise T.ValidationError(
            "relation: only followed or ignored (the extension subscribes; ex only through the"
            " queue)",
            field="relation",
        )
    svc = wiring.get_channels()
    if svc.get(channel_id) is None:
        raise T.NotFound(f"channel {channel_id} does not exist", channel_id=channel_id)
    tags = None if tag_ids is T.UNSET else tag_ids
    rel = None if relation is T.UNSET else T.Relation(relation)
    with queue_untouched(wiring.get_db(), "PATCH /channels"):
        apply_patch = getattr(svc, "apply_patch", None)
        if callable(apply_patch):
            ch = apply_patch(channel_id, patch, tag_ids=tags, relation=rel, actor=T.Actor.user)
        else:  # adapter: service without the apply_patch extra (fake)
            with wiring.get_changelog().group("patch"):
                ch = svc.update(channel_id, patch, actor=T.Actor.user)
                if tags is not None:
                    ch = svc.set_tags(channel_id, tags, actor=T.Actor.user)
                if rel is not None:
                    ch = svc.set_relation(channel_id, rel, actor=T.Actor.user)
    return ok(ch)


# =========================================================================== POST /channels/batch


@contract.real
@guard
def post_channels_batch(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /channels/batch.

    Manage batch (atomic; "unsubscribe" only proposes to the cleanup)
    """
    data = body_object(body, _BATCH_KEYS)
    op = field(data, "op", (str,), required=True)
    if op != UNSUBSCRIBE_OP and op not in BATCH_OPS:
        raise T.ValidationError(f"invalid op: {op!r}", field="op")
    ids = str_list(data, "channel_ids", required=True, min_items=1)
    value = field(data, "value", _STR_OR_NULL)
    value = None if value is T.UNSET else value
    reason = field(data, "reason", _STR_OR_NULL)
    reason = None if reason is T.UNSET else reason
    if op in (T.BatchOp.tag.value, T.BatchOp.untag.value) and not value:
        raise T.ValidationError("value: provide the tag", field="value")
    svc = wiring.get_channels()
    current = _require_channels(svc, ids)
    db = wiring.get_db()

    if op == UNSUBSCRIBE_OP:
        # guard: a batch "unsubscribe" only becomes a cleanup candidate; never queue, never approval
        cleanup = wiring.get_cleanup()
        if _is_stub(cleanup):
            raise T.Conflict("the cleanup is not available yet to propose unsubscriptions")
        not_subscribed = [c.id for c in current if c.relation is not T.Relation.subscribed]
        if not_subscribed:
            raise T.Conflict(
                "only subscribed channels can go to the cleanup", channel_ids=not_subscribed
            )
        with queue_untouched(db, "unsubscribe batch"):
            proposed = cleanup.propose([c.id for c in current], reason=reason, actor=T.Actor.user)
        return ok({"batch": None, "proposed": list(proposed)})

    with queue_untouched(db, f"batch {op}"):
        result = svc.batch(T.BatchOp(op), [c.id for c in current], value=value, actor=T.Actor.user)
    return ok({"batch": result, "proposed": []})


# =========================================================================== POST /channels/add


def _changed_since(changelog: T.ChangeLog, mark: int, channel_id: str) -> bool:
    """Was there a ``channel_add`` of the channel after *mark* (a real add/back to followed)?"""
    for rec in changelog.list(limit=20):
        if rec.id <= mark:
            break
        if rec.action is T.ChangeAction.channel_add and rec.payload.get("channel_id") == channel_id:
            return True
    return False


def _last_change_id(changelog: T.ChangeLog) -> int:
    recs = changelog.list(limit=1)
    return recs[0].id if recs else 0


def _kick(refresher: Any, channel_id: str) -> None:
    """First videos of the new channel, without waiting; a failure here does not undo the add."""
    try:
        if refresher is not None and not _is_stub(refresher):
            refresher.kick_channel(channel_id)
    except Exception:  # noqa: BLE001 — the channel is already added; the normal cycle picks it up
        log.warning("%s: kick_channel(%s) failed", PLUGIN_ID, channel_id, exc_info=True)


def _refresher_or_none() -> Any:
    try:
        return wiring.get_refresher()
    except Exception:  # noqa: BLE001 — without a refresher the channel is added anyway
        log.warning("%s: refresher unavailable", PLUGIN_ID, exc_info=True)
        return None


def _add_job(
    svc: T.ChannelService,
    changelog: T.ChangeLog,
    refresher: Any,
    text: str,
    folder_id: str | None,
    box: dict[str, Any],
    done: threading.Event,
) -> None:
    try:
        mark = _last_change_id(changelog)
        ch = svc.add(text, folder_id=folder_id, actor=T.Actor.user)
        changed = _changed_since(changelog, mark, ch.id)
        box["result"] = (ch, changed)
    except BaseException as exc:  # noqa: BLE001 — handed back to the route (or just logged)
        box["error"] = exc
        if box.get("late"):
            log.warning("%s: adding %r failed after the deadline: %s", PLUGIN_ID, text, exc)
        return
    finally:
        done.set()
    if changed:
        _kick(refresher, ch.id)


def _run_with_deadline(target: Callable[[], None], done: threading.Event) -> bool:
    ctx = contextvars.copy_context()
    thread = threading.Thread(
        target=ctx.run, args=(target,), name=f"{PLUGIN_ID}-channel-add", daemon=True
    )
    thread.start()
    return done.wait(ADD_DEADLINE_S)


@contract.real
@guard
def post_channels_add(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /channels/add.

    Follow by link/@handle (without subscribing)
    """
    data = body_object(body, _ADD_KEYS)
    text = field(data, "url_or_handle", (str,), required=True).strip()
    if len(text) < 2:
        raise T.ValidationError(
            "url_or_handle: provide a link, @handle or id", field="url_or_handle"
        )
    if dedup.parse_channel_ref(text) is None:
        raise T.ValidationError(
            f"no YouTube channel recognized in {text!r} (use an @handle, a channel link, a UC… id"
            " or a video link)",
            field="url_or_handle",
        )
    folder_id = field(data, "folder_id", _STR_OR_NULL)
    folder_id = None if folder_id is T.UNSET else folder_id
    db = wiring.get_db()
    if (
        folder_id is not None
        and db.query_one("SELECT id FROM folders WHERE id = ?", (folder_id,)) is None
    ):
        raise T.ValidationError(f"folder {folder_id} does not exist", field="folder_id")

    # services resolved here (the request's profile), before the thread
    svc = wiring.get_channels()
    changelog = wiring.get_changelog()
    refresher = _refresher_or_none()
    box: dict[str, Any] = {}
    done = threading.Event()
    job = functools.partial(_add_job, svc, changelog, refresher, text, folder_id, box, done)
    if not _run_with_deadline(job, done):
        box["late"] = True
        raise T.OperationTimeout(
            "YouTube took too long to answer; if the channel is found, it shows up in the list"
            " shortly",
            pending=True,
        )
    if "error" in box:
        exc = box["error"]
        if isinstance(exc, T.NotFound):  # folder deleted midway
            raise T.ValidationError(exc.message, field="folder_id") from exc
        raise exc
    ch, changed = box["result"]
    if not changed:
        raise T.Conflict(
            f"{ch.title} is already in your list ({ch.relation.value})",
            channel_id=ch.id,
            channel=T.to_jsonable(ch),
        )
    return ok(ch)
