"""REST routes for the history: the Manage drawer with undo.

- ``GET /changes`` — most recent first, paged by ``before_id`` (``limit`` 1..200).
- ``POST /changes/{id}/undo`` — ``ChangeLog.undo`` with ``wiring.get_undo_targets()``: the entry or
  the whole group, all or nothing, ``actor=user``. Refusal → ``undo_refused`` with ``reason``.

Route guards (before and around the core; nothing changes on a refusal):

1. **An unsubscription already executed is not undone** — if the entry (or anyone in its group)
   is ``cleanup_approve``/``cleanup_resubscribe`` with a ``running|done|failed`` queue item, refuse
   with ``already_executed`` **without** calling the owner (the UI points to Resubscribe in
   Cleanup → Former subscriptions). A relation changed by the extension is refused by
   ``ChannelService``.
2. **Undo never creates a queue item** — the undo runs inside ``queue_untouched``; if the queue
   gains an item (or an active item), everything rolls back and the answer is ``not_undoable``.
3. **Owner still a stub** (``NotImplementedError``) → ``not_undoable`` (the transaction already
   rolled back).
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.api.channels import QueueTouched, guard, path_id, queue_untouched
from tube_pkg.core import types as T

LIST_DEFAULT = 50
LIST_MAX = 200
EXECUTED_QUEUE_STATUSES = ("running", "done", "failed")
_QUEUE_ACTIONS = frozenset({T.ChangeAction.cleanup_approve, T.ChangeAction.cleanup_resubscribe})
_EXECUTED_MESSAGE = (
    "Unsubscription already executed — use Resubscribe in Cleanup → Former subscriptions"
)


def _int_param(query: Mapping[str, str], key: str) -> int | None:
    raw = (query or {}).get(key)
    if raw is None or str(raw).strip() == "":
        return None
    text = str(raw).strip()
    try:
        return int(text)
    except ValueError as exc:
        raise T.ValidationError(f"{key} must be an integer", field=key) from exc


# =========================================================================== GET /changes


@contract.real
@guard
def get_changes(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /changes.

    History (most recent first)
    """
    limit = _int_param(query, "limit")
    limit = LIST_DEFAULT if limit is None else limit
    if not 1 <= limit <= LIST_MAX:
        raise T.ValidationError(f"limit must be between 1 and {LIST_MAX}", field="limit")
    before_id = _int_param(query, "before_id")
    items = wiring.get_changelog().list(limit=limit, before_id=before_id)
    return ok({"items": items})


# ========================================================================== POST /changes/{id}/undo


def _change_id(query: Mapping[str, str]) -> int:
    raw = path_id(query, "history entry")
    try:
        value = int(raw)
    except ValueError as exc:
        raise T.NotFound(f"history entry {raw!r} does not exist", change_id=raw) from exc
    if value < 1:
        raise T.NotFound(f"history entry {raw!r} does not exist", change_id=raw)
    return value


def _pending_entries(db: T.Db, changelog: T.ChangeLog, rec: T.ChangeRecord) -> list[T.ChangeRecord]:
    """The entry and, if it has a group, the other not-yet-undone entries of the same group."""
    if not rec.group_id:
        return [rec]
    rows = db.query(
        "SELECT id FROM changes WHERE group_id = ? AND undone_at IS NULL ORDER BY id DESC",
        (rec.group_id,),
    )
    out = [r for row in rows if (r := changelog.get(int(row["id"]))) is not None]
    return out or [rec]


def _executed_queue_ids(db: T.Db, queue_ids: Sequence[str]) -> list[str]:
    if not queue_ids:
        return []
    rows = db.query(
        "SELECT id FROM unsub_queue WHERE id IN (SELECT value FROM json_each(?))"
        " AND status IN (SELECT value FROM json_each(?)) ORDER BY id",
        (json.dumps(list(queue_ids)), json.dumps(list(EXECUTED_QUEUE_STATUSES))),
    )
    return [r["id"] for r in rows]


def refuse_executed_queue(db: T.Db, entries: Sequence[T.ChangeRecord]) -> None:
    """Guard 1: an approval/resubscription whose queue item already ran (or is running) is not
    undone."""
    for entry in entries:
        if entry.action not in _QUEUE_ACTIONS:
            continue
        queue_ids = getattr(entry.undo, "queue_ids", ()) or ()
        executed = _executed_queue_ids(db, [str(q) for q in queue_ids])
        if executed:
            raise T.UndoRefused(
                "already_executed", _EXECUTED_MESSAGE, change_id=entry.id, queue_ids=executed
            )


@contract.real
@guard
def post_change_undo(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /changes/{id}/undo.

    Undo (an entry or a whole group)
    """
    change_id = _change_id(query)
    db = wiring.get_db()
    changelog = wiring.get_changelog()
    rec = changelog.get(change_id)
    if rec is None:
        raise T.NotFound(f"history entry {change_id} does not exist", change_id=change_id)
    if rec.undone_at is None:
        refuse_executed_queue(db, _pending_entries(db, changelog, rec))
    targets = wiring.get_undo_targets()
    try:
        with queue_untouched(db, "undo"):
            undone = changelog.undo(change_id, targets=targets, actor=T.Actor.user)
    except QueueTouched as exc:
        raise T.UndoRefused(
            "not_undoable", "undoing would create an unsubscribe queue item", change_id=change_id
        ) from exc
    except NotImplementedError as exc:
        raise T.UndoRefused(
            "not_undoable", "this action cannot be undone yet", change_id=change_id
        ) from exc
    return ok({"undone": undone})
