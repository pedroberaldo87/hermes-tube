"""History with undo: ``ChangeLog`` — owner of the ``changes`` table.

Rules (``types.ChangeLog``):

- **Record** — ``record`` requires ``undo`` of class ``UNDO_TYPES[action]``; ``ts`` comes from the
  injected clock; ``group_id`` comes from the ``group()`` active in the context (``contextvars``: a
  new thread does not inherit it). The caller is usually already inside its own transaction: the
  ``record`` joins it.
- **Undo** — ``undo`` receives the services (``UndoTargets``) on the call and dispatches each entry
  to ``getattr(targets, CHANGE_ACTION_OWNER[action]).apply_undo``; it never writes SQL into another
  owner's table. The whole group, newest to oldest, in a single transaction: any error
  (``UndoRefused`` or not) rolls everything back and re-raises — all or nothing.
- **Undo does not record history** — ``record`` called from inside an ``apply_undo`` raises
  ``RuntimeError`` (and the whole undo transaction rolls back).
- **Tolerant reading** — a row with an unreadable ``undo`` becomes ``UndoNotSupported`` (the list
  keeps working, undo refuses with ``not_undoable``); an unknown action (from a future version) is
  left out of the list.
"""

from __future__ import annotations

import contextvars
import json
import logging
import uuid
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from tube_pkg.core import types as T

log = logging.getLogger(__name__)

MAX_LIST = 500
"""Cap for ``list(limit=...)`` (the route asks for at most 200)."""

_GROUP: contextvars.ContextVar[tuple[str, str] | None] = contextvars.ContextVar(
    "tube_change_group", default=None
)
"""``(group_id, label)`` of the ``group()`` active in the current context."""

_UNDOING: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "tube_change_undoing", default=False
)


def _json(value: Any) -> str:
    return json.dumps(T.to_jsonable(value), ensure_ascii=False, sort_keys=True)


def _loads(text: Any) -> Any:
    if text is None or text == "":
        return {}
    return json.loads(text)


def _record_from_row(row: Mapping[str, Any]) -> T.ChangeRecord | None:
    """``ChangeRecord`` for the row; ``None`` if the action is unknown (future version)."""
    try:
        action = T.ChangeAction(row["action"])
        actor = T.Actor(row["actor"])
    except ValueError:
        log.warning("changes.id=%s skipped: unknown action/actor", row.get("id"))
        return None
    try:
        payload = _loads(row["payload"])
        if not isinstance(payload, Mapping):
            payload = {"value": payload}
    except ValueError:
        payload = {}
    try:
        data = _loads(row["undo"])
        if not isinstance(data, Mapping):
            raise T.ValidationError("undo is not an object")
        undo = T.undo_from_dict(action, data)
    except (ValueError, T.ValidationError):
        log.warning("changes.id=%s has an unreadable undo; it cannot be undone", row.get("id"))
        undo = T.UndoNotSupported()
    return T.ChangeRecord(
        id=int(row["id"]),
        ts=int(row["ts"]),
        actor=actor,
        action=action,
        payload=payload,
        undo=undo,
        group_id=row["group_id"],
        undone_at=row["undone_at"],
    )


class ChangeLog:
    """``ChangeLog`` over the ``changes`` table (see the module docstring)."""

    def __init__(
        self, *, db: T.Db, settings: T.Settings | None = None, clock: T.Clock | None = None
    ) -> None:
        self.db = db
        self.settings = settings
        self.clock: T.Clock = clock or T.SystemClock()

    def _now(self) -> int:
        return int(self.clock.now())

    # ------------------------------------------------------------------ record

    def record(
        self,
        actor: T.Actor,
        action: T.ChangeAction,
        payload: Mapping[str, Any],
        undo: T.UndoData,
    ) -> T.ChangeRecord:
        if _UNDOING.get():
            raise RuntimeError(
                f"apply_undo cannot record history (attempted {action}); write directly to the "
                "owner's own table"
            )
        try:
            action = T.ChangeAction(action)
            actor = T.Actor(actor)
        except ValueError as exc:
            raise T.ValidationError(f"history: {exc}") from exc
        expected = T.UNDO_TYPES[action]
        if type(undo) is not expected:
            raise T.ValidationError(f"{action}: undo must be {expected.__name__}")
        if payload is None:
            payload = {}
        if not isinstance(payload, Mapping):
            raise T.ValidationError("history payload must be an object")
        body = dict(payload)
        group = _GROUP.get()
        if group is not None and group[1]:
            body.setdefault("group_label", group[1])
        res = self.db.execute(
            "INSERT INTO changes (ts, actor, action, group_id, payload, undo)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                self._now(),
                actor.value,
                action.value,
                group[0] if group else None,
                _json(body),
                _json(T.undo_to_dict(undo)),
            ),
        )
        rec = self.get(int(res.lastrowid or 0))
        if rec is None:  # pragma: no cover - the INSERT just happened
            raise RuntimeError("recorded history entry vanished")
        return rec

    @contextmanager
    def group(self, label: str) -> Iterator[str]:
        current = _GROUP.get()
        if current is not None:
            yield current[0]
            return
        gid = uuid.uuid4().hex
        token = _GROUP.set((gid, str(label or "")))
        try:
            yield gid
        finally:
            _GROUP.reset(token)

    # ------------------------------------------------------------------ read

    def list(self, *, limit: int = 50, before_id: int | None = None) -> list[T.ChangeRecord]:
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
            raise T.ValidationError("limit must be an integer ≥ 1", field="limit")
        limit = min(limit, MAX_LIST)
        if before_id is None:
            rows = self.db.query("SELECT * FROM changes ORDER BY id DESC LIMIT ?", (limit,))
        else:
            rows = self.db.query(
                "SELECT * FROM changes WHERE id < ? ORDER BY id DESC LIMIT ?",
                (int(before_id), limit),
            )
        return [rec for r in rows if (rec := _record_from_row(r)) is not None]

    def get(self, change_id: int) -> T.ChangeRecord | None:
        row = self.db.query_one("SELECT * FROM changes WHERE id = ?", (int(change_id),))
        return _record_from_row(row) if row else None

    # ------------------------------------------------------------------ undo

    def undo(
        self, change_id: int, *, targets: T.UndoTargets, actor: T.Actor = T.Actor.user
    ) -> list[T.ChangeRecord]:
        """See ``types.ChangeLog.undo``. *actor* goes to the log (the table has no column for
        it)."""
        token = _UNDOING.set(True)
        try:
            with self.db.transaction():
                row = self.db.query_one("SELECT * FROM changes WHERE id = ?", (int(change_id),))
                if row is None:
                    raise T.NotFound(
                        f"history entry {change_id} does not exist", change_id=change_id
                    )
                rec = _record_from_row(row)
                if rec is None:
                    raise T.UndoRefused("not_undoable", f"unknown action: {row['action']}")
                if rec.undone_at is not None:
                    raise T.UndoRefused("already_undone", "already undone")
                if rec.group_id:
                    rows = self.db.query(
                        "SELECT * FROM changes WHERE group_id = ? AND undone_at IS NULL"
                        " ORDER BY id DESC",
                        (rec.group_id,),
                    )
                    entries = [_record_from_row(r) for r in rows]
                else:
                    entries = [rec]
                now = self._now()
                for entry in entries:
                    if entry is None:
                        raise T.UndoRefused("not_undoable", "group contains an unknown action")
                    self._dispatch(entry, targets)
                    self.db.execute(
                        "UPDATE changes SET undone_at = ? WHERE id = ?", (now, entry.id)
                    )
                ids = [e.id for e in entries if e is not None]
        finally:
            _UNDOING.reset(token)
        log.info("undone by %s: %s", T.Actor(actor).value, ids)
        return [r for i in ids if (r := self.get(i)) is not None]

    @staticmethod
    def _dispatch(entry: T.ChangeRecord, targets: T.UndoTargets) -> None:
        if isinstance(entry.undo, T.UndoNotSupported):
            raise T.UndoRefused("not_undoable", f"{entry.action.value} has no undo")
        owner_name = T.CHANGE_ACTION_OWNER.get(entry.action)
        owner = getattr(targets, owner_name, None) if owner_name else None
        if owner is None:
            raise T.UndoRefused("not_undoable", f"no owner for {entry.action.value}")
        owner.apply_undo(entry)


def build(*, db: T.Db, settings: T.Settings, clock: T.Clock | None = None) -> T.ChangeLog:
    """``ChangeLog`` over *db*. No network, no thread."""
    return ChangeLog(db=db, settings=settings, clock=clock)


__all__ = ["MAX_LIST", "ChangeLog", "build"]
