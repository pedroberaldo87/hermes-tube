"""REST routes for the cleanup: **read-only plus step-backs that never approve**.

- ``GET /cleanup`` — latest scan (``Cleanup.latest_scan``) with the candidates' channels.
- ``POST /cleanup/dismiss`` — removes candidates from the list (``Cleanup.dismiss``).
- ``GET /queue`` — the queue (``Cleanup.queue``) + ``pending`` (``approved`` + ``running``).
- ``POST /queue/undo`` — ``Cleanup.undo_approval`` (all or nothing; executed → ``undo_refused``
  with ``reason=already_executed``; never creates an item).

**There is no REST approval route**: approving is only the ``cleanup.approve`` RPC (Desktop) and
``/tube faxina`` (``ask_choice``). The routes that write run inside
``core.cleanup.approvals_unchanged``: if, by a bug, one of them left a new ``approved`` item, the
transaction rolls back and the answer is ``internal``. Plain ``def`` routes, < 2 s, no AI and no
events.
"""

from __future__ import annotations

import functools
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, error_envelope, ok
from tube_pkg.core import cleanup as CL
from tube_pkg.core import types as T

QUEUE_LIMIT_DEFAULT = 200
QUEUE_LIMIT_MAX = 500
IDS_MAX = 500


def _enveloped(fn: Callable[..., Envelope]) -> Callable[..., Envelope]:
    """Errors become an envelope on a direct call too (the router already does this)."""

    @functools.wraps(fn)
    def wrapper(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
        try:
            return fn(body, query or {})
        except Exception as exc:  # noqa: BLE001 — REST always answers with an envelope
            return error_envelope(exc)

    return wrapper


def _ids(body: Mapping[str, Any] | None) -> list[str]:
    raw = body.get("ids") if isinstance(body, Mapping) else None
    if not isinstance(raw, list) or not raw:
        raise T.ValidationError("ids: a list with at least one id", field="ids")
    if len(raw) > IDS_MAX:
        raise T.ValidationError(f"ids: at most {IDS_MAX}", field="ids")
    if not all(isinstance(x, str) and x for x in raw):
        raise T.ValidationError("ids: strings only", field="ids")
    return list(dict.fromkeys(raw))


def _channels_of(ids: Sequence[str]) -> dict[str, T.Channel]:
    if not ids:
        return {}
    service = wiring.get_channels()
    found = {c.id: c for c in service.list(T.ChannelFilter(ids=tuple(ids)))}
    for cid in ids:
        if cid not in found:
            ch = service.get(cid)
            if ch is not None:
                found[cid] = ch
    return {cid: found[cid] for cid in ids if cid in found}


@contract.real
@_enveloped
def get_cleanup(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /cleanup.

    Latest scan with pending candidates (3 groups + manual) and their channels
    """
    scan = wiring.get_cleanup().latest_scan()
    if scan is None:
        return ok({"scan": None, "channels": {}})
    ids = list(dict.fromkeys(c.channel_id for c in scan.candidates))
    return ok({"scan": scan, "channels": _channels_of(ids)})


@contract.real
@_enveloped
def post_cleanup_dismiss(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /cleanup/dismiss.

    Remove candidates from the list (approves nothing)
    """
    ids = _ids(body)
    cleanup = wiring.get_cleanup()
    with CL.approvals_unchanged(wiring.get_db(), "POST /cleanup/dismiss"):
        count = cleanup.dismiss(ids)
    return ok({"count": int(count)})


def _statuses(raw: str | None) -> list[T.QueueStatus] | None:
    if raw is None or not str(raw).strip():
        return None
    out = []
    for part in str(raw).split(","):
        value = part.strip()
        if not value:
            continue
        try:
            out.append(T.QueueStatus(value))
        except ValueError as exc:
            raise T.ValidationError(f"unknown status: {value!r}", field="status") from exc
    return out or None


def _limit(raw: str | None) -> int:
    if raw is None or not str(raw).strip():
        return QUEUE_LIMIT_DEFAULT
    try:
        value = int(str(raw).strip())
    except ValueError as exc:
        raise T.ValidationError("limit must be an integer", field="limit") from exc
    if not 1 <= value <= QUEUE_LIMIT_MAX:
        raise T.ValidationError(f"limit between 1 and {QUEUE_LIMIT_MAX}", field="limit")
    return value


def _pending(cleanup: T.Cleanup) -> int:
    count = getattr(cleanup, "pending_count", None)
    if callable(count):
        return int(count())
    return len(cleanup.queue([T.QueueStatus.approved, T.QueueStatus.running], limit=100_000))


@contract.real
@_enveloped
def get_queue(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /queue.

    Unsubscribe/resubscribe queue (progress)
    """
    statuses = _statuses(query.get("status"))
    limit = _limit(query.get("limit"))
    cleanup = wiring.get_cleanup()
    items = cleanup.queue(statuses, limit=limit)
    return ok({"items": items, "pending": _pending(cleanup)})


@contract.real
@_enveloped
def post_queue_undo(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /queue/undo.

    Undo an approval not yet executed (approved → undone)
    """
    ids = _ids(body)
    cleanup = wiring.get_cleanup()
    with CL.approvals_unchanged(wiring.get_db(), "POST /queue/undo"):
        items = CL.call_quietly(cleanup.undo_approval, ids)
    return ok({"items": items})
