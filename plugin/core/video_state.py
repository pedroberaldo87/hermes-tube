"""``VideoStateService``: per-video inbox, owner of the ``video_state`` table.

- No row = ``new`` with no reaction; video ids are always validated (11 characters).
- Idempotent writes: only what actually changed is written (and only then ``updated_at`` moves);
  ``set_state``/``change`` return how many videos changed.
- ``actor=user`` or ``hermes`` writes **one** ``video_state`` history entry per call
  (``UndoVideoState`` with the previous state of the changed videos only), with the right actor;
  the extension and routines do not write history.
- ``apply_undo`` writes straight to the table and never calls ``ChangeLog.record``.
- ``reaction=down`` is read by ``Themes`` as a negative example for the next curation.

No network and no thread.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import types as T

_CHUNK = 500

HISTORY_ACTORS = frozenset({T.Actor.user, T.Actor.hermes})
"""Who writes history (and undo) for video state: the person and the agent (``tube_mark``).
The extension and routines do not."""

_UPSERT = (
    "INSERT INTO video_state (video_id, state, reaction, updated_at) VALUES (?, ?, ?, ?)"
    " ON CONFLICT(video_id) DO UPDATE SET state = excluded.state,"
    " reaction = excluded.reaction, updated_at = excluded.updated_at"
)


def _placeholders(values: Sequence[Any]) -> str:
    return ",".join("?" for _ in values)


def _chunks(values: Sequence[str], size: int = _CHUNK) -> list[Sequence[str]]:
    return [values[i : i + size] for i in range(0, len(values), size)]


def clean_video_ids(video_ids: Any, *, where: str = "video_ids") -> list[str]:
    """Valid video ids, deduplicated, in the given order; otherwise ``ValidationError``."""
    if isinstance(video_ids, str | bytes) or not isinstance(video_ids, Sequence):
        raise T.ValidationError(f"{where}: expected a list of video ids", field=where)
    for vid in video_ids:
        if not dedup.is_video_id(vid):
            raise T.ValidationError(f"{where}: invalid video id: {vid!r}", field=where)
    return list(dict.fromkeys(video_ids))


def split_csv_ids(raw: Any, *, maximum: int, required: bool, where: str = "ids") -> list[str]:
    """``"a,b,c"`` (query) → valid video ids, deduplicated; empty when not required;
    empty-but-required, an invalid id or more than *maximum* → ``ValidationError``."""
    text = raw.strip() if isinstance(raw, str) else ""
    if not text:
        if required:
            raise T.ValidationError(f"{where}: required", field=where)
        return []
    ids = [part.strip() for part in text.split(",") if part.strip()]
    if len(ids) > maximum:
        raise T.ValidationError(f"{where}: at most {maximum} ids", field=where)
    return clean_video_ids(ids, where=where)


def parse_state(value: Any) -> T.VideoState:
    try:
        return T.VideoState(value)
    except ValueError as exc:
        raise T.ValidationError(f"invalid state: {value!r}", field="state") from exc


def parse_reaction(value: Any) -> T.Reaction | None:
    if value is None:
        return None
    try:
        return T.Reaction(value)
    except ValueError as exc:
        raise T.ValidationError(f"invalid reaction: {value!r}", field="reaction") from exc


def _row(row: Mapping[str, Any]) -> T.VideoStateRow:
    return T.VideoStateRow(
        video_id=row["video_id"],
        state=T.VideoState(row["state"]),
        reaction=T.Reaction(row["reaction"]) if row["reaction"] else None,
        updated_at=int(row["updated_at"]),
    )


_STATE_LABEL = {
    T.VideoState.new: "new",
    T.VideoState.seen: "seen",
    T.VideoState.later: "later",
    T.VideoState.archived: "archived",
    T.VideoState.watched: "watched",
}
_REACTION_LABEL = {None: "no reaction", T.Reaction.up: "👍", T.Reaction.down: "👎"}


def _label(count: int, state: T.VideoState | None, reaction: Any) -> str:
    noun = "1 video" if count == 1 else f"{count} videos"
    parts = []
    if state is not None:
        parts.append(_STATE_LABEL[state])
    if reaction is not T.UNSET:
        parts.append(_REACTION_LABEL[reaction])
    return f"{noun}: {', '.join(parts)}"


class VideoStateService:
    """``VideoStateService`` implementation over ``video_state``."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.changelog = changelog
        self.clock = clock or T.SystemClock()

    # ------------------------------------------------------------------ reads

    def get(self, video_ids: Sequence[str]) -> dict[str, T.VideoStateRow]:
        ids = [v for v in dict.fromkeys(video_ids) if isinstance(v, str)]
        out: dict[str, T.VideoStateRow] = {}
        for chunk in _chunks(ids):
            rows = self.db.query(
                "SELECT video_id, state, reaction, updated_at FROM video_state"
                f" WHERE video_id IN ({_placeholders(chunk)})",
                tuple(chunk),
            )
            out.update({r["video_id"]: _row(r) for r in rows})
        return out

    def reactions(self, video_ids: Sequence[str] | None = None) -> dict[str, T.Reaction]:
        if video_ids is None:
            rows = self.db.query(
                "SELECT video_id, state, reaction, updated_at FROM video_state"
                " WHERE reaction IS NOT NULL ORDER BY video_id"
            )
            states = {r["video_id"]: _row(r) for r in rows}
        else:
            states = self.get(video_ids)
        return {vid: s.reaction for vid, s in states.items() if s.reaction is not None}

    def list_by_state(self, state: T.VideoState, *, limit: int = 100) -> list[T.VideoStateRow]:
        st = parse_state(state)
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise T.ValidationError("limit: expected an integer ≥ 1", field="limit")
        rows = self.db.query(
            "SELECT video_id, state, reaction, updated_at FROM video_state WHERE state = ?"
            " ORDER BY updated_at DESC, video_id LIMIT ?",
            (st.value, limit),
        )
        return [_row(r) for r in rows]

    # ------------------------------------------------------------------ writes

    def change(
        self,
        video_ids: Sequence[str],
        *,
        state: Any = T.UNSET,
        reaction: Any = T.UNSET,
        actor: T.Actor = T.Actor.user,
    ) -> int:
        """Change state and/or reaction of several videos in one transaction (``UNSET`` = leave
        as is; ``reaction=None`` clears). One history entry (``actor=user|hermes``). Returns how
        many videos changed. Backs ``POST /videos/state`` and ``POST /ext/videos/state``."""
        ids = clean_video_ids(video_ids)
        new_state = None if state is T.UNSET else parse_state(state)
        new_reaction = T.UNSET if reaction is T.UNSET else parse_reaction(reaction)
        if new_state is None and new_reaction is T.UNSET:
            raise T.ValidationError("provide state and/or reaction", field="state")
        actor = T.Actor(actor)
        if not ids:
            return 0
        with self.db.transaction():
            current = self.get(ids)
            now = self.clock.now()
            before: dict[str, dict[str, Any] | None] = {}
            writes: list[tuple[str, str, str | None, int]] = []
            for vid in ids:
                prev = current.get(vid)
                old_state = prev.state if prev else T.VideoState.new
                old_reaction = prev.reaction if prev else None
                st = new_state if new_state is not None else old_state
                rc = old_reaction if new_reaction is T.UNSET else new_reaction
                if st is old_state and rc is old_reaction:
                    continue  # idempotent (no row = "new, no reaction")
                before[vid] = (
                    {
                        "state": old_state.value,
                        "reaction": old_reaction.value if old_reaction else None,
                    }
                    if prev is not None
                    else None
                )
                writes.append((vid, st.value, rc.value if rc else None, now))
            if not writes:
                return 0
            self.db.executemany(_UPSERT, writes)
            if actor in HISTORY_ACTORS:
                payload: dict[str, Any] = {
                    "label": _label(len(writes), new_state, new_reaction),
                    "count": len(writes),
                }
                if new_state is not None:
                    payload["state"] = new_state.value
                if new_reaction is not T.UNSET:
                    payload["reaction"] = new_reaction.value if new_reaction else None
                self.changelog.record(
                    actor, T.ChangeAction.video_state, payload, T.UndoVideoState(before=before)
                )
        return len(writes)

    def set_state(
        self, video_ids: Sequence[str], state: T.VideoState, *, actor: T.Actor = T.Actor.user
    ) -> int:
        return self.change(video_ids, state=state, actor=actor)

    def set_reaction(
        self, video_id: str, reaction: T.Reaction | None, *, actor: T.Actor = T.Actor.user
    ) -> T.VideoStateRow:
        self.change([video_id], reaction=reaction, actor=actor)
        return self.get([video_id]).get(video_id) or T.VideoStateRow(video_id=video_id)

    # ------------------------------------------------------------------ undo

    def apply_undo(self, change: T.ChangeRecord) -> None:
        undo = change.undo
        if change.action is not T.ChangeAction.video_state or not isinstance(
            undo, T.UndoVideoState
        ):
            raise T.UndoRefused("not_undoable", f"video state cannot undo {change.action}")
        now = self.clock.now()
        for vid, prev in undo.before.items():
            if prev is None:
                self.db.execute("DELETE FROM video_state WHERE video_id = ?", (vid,))
                continue
            state = parse_state(prev.get("state", T.VideoState.new.value))
            reaction = parse_reaction(prev.get("reaction"))
            self.db.execute(_UPSERT, (vid, state.value, reaction.value if reaction else None, now))


def apply_change(
    service: T.VideoStateService,
    video_ids: Any,
    *,
    state: Any = T.UNSET,
    reaction: Any = T.UNSET,
    actor: T.Actor = T.Actor.user,
) -> int:
    """``change`` of the real service; with another ``VideoStateService`` (a fake), falls back to
    the ``Protocol`` (``set_state`` + ``set_reaction`` per video)."""
    change = getattr(service, "change", None)
    if callable(change):
        return int(change(video_ids, state=state, reaction=reaction, actor=actor))
    ids = clean_video_ids(video_ids)
    if state is T.UNSET and reaction is T.UNSET:
        raise T.ValidationError("provide state and/or reaction", field="state")
    changed = 0
    if state is not T.UNSET:
        changed = int(service.set_state(ids, parse_state(state), actor=actor))
    if reaction is not T.UNSET:
        rc = parse_reaction(reaction)
        for vid in ids:
            service.set_reaction(vid, rc, actor=actor)
        changed = max(changed, len(ids))
    return changed


def parse_change_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    """``{video_ids, state?, reaction?}`` (``VideoStateChange``) → kwargs for
    ``video_state.apply_change``. At least one of ``state``/``reaction``; ``reaction: null``
    clears; up to 500 valid ids."""
    body = body or {}
    if not isinstance(body, Mapping):
        raise T.ValidationError("body must be an object")
    unknown = sorted(set(body) - {"video_ids", "state", "reaction"})
    if unknown:
        raise T.ValidationError(f"unknown keys {unknown}")
    raw = body.get("video_ids")
    if not isinstance(raw, list) or not raw or len(raw) > 500:
        raise T.ValidationError("video_ids: list with 1 to 500 ids", field="video_ids")
    out: dict[str, Any] = {"video_ids": clean_video_ids(raw)}
    if "state" in body:
        out["state"] = parse_state(body["state"])
    if "reaction" in body:
        out["reaction"] = parse_reaction(body["reaction"])
    if len(out) == 1:
        raise T.ValidationError("provide state and/or reaction", field="state")
    return out


def change_from_body(service: T.VideoStateService, body: Mapping[str, Any] | None) -> int:
    """Apply ``POST /videos/state`` (human action: ``actor=user``, undoable)."""
    kwargs = parse_change_body(body)
    ids = kwargs.pop("video_ids")
    return apply_change(service, ids, actor=T.Actor.user, **kwargs)


def build(
    *, db: T.Db, settings: T.Settings, changelog: T.ChangeLog, clock: T.Clock | None = None
) -> T.VideoStateService:
    """``VideoStateService`` over *db*. No network, no thread."""
    return VideoStateService(db=db, settings=settings, changelog=changelog, clock=clock)
