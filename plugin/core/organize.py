"""Organize with AI: ``Organizer`` — owner of ``suggestions`` with ``kind=organize``.

Flow (``organize`` task):

- **organize** (blocking, overall ``timeout`` + ``on_progress``): channels without a folder (or the
  requested ids) in batches of up to ``BATCH_SIZE``; input = title, handle, 5 latest titles +
  existing folders and tags + **the user's earlier corrections and rejections** as examples. The
  model output is **untrusted data**: every item is checked here (id ⊆ batch and still
  present/organizable in the database, no duplicates; existing folder or explicit ``new_folder``;
  path without ``..``/stray slashes; tags without slashes; confidence 0..1; one-line ``why``;
  extra/missing field → item dropped). Only ``pending`` suggestions are written: **nothing is
  applied before acceptance**.
- **failed batches**: a batch the AI got wrong (``llm_invalid``) does not break the others; a
  timeout stops the remaining batches. If no batch succeeded, the error is raised.
- **idempotent**: running again with the same proposal keeps the suggestion (same id); a different
  proposal marks the old one ``superseded``. One pending suggestion per channel.
- **read** (``pending``): a suggestion whose channel vanished, is no longer followed or **changed
  folder** since the suggestion is discarded (``superseded``); ``new_folder`` reflects the
  database now.
- **accept**: by suggestion or by channel, with corrections (``edits``); applies through the
  services (``TaxonomyService`` creates folder/tag, ``ChannelService`` moves and tags) in a
  **single undo group** (``GROUP_LABEL``) and records ``organize_accept``. Tags are only added
  (never removes a user tag). **Reject** stores where the channel stayed; corrections and
  rejections become examples. ``AcceptReport.change_ids`` = the exact ids of the accept entries.
- **cancel** (``job.cancel``): checkpoints between batches and right after each response (a
  response that came back after the click is not written); batches finished before stay
  ``pending``. Asking again right after waits for the cancelled run to release the lock.
- **channels without a folder first**: with explicit ids they go to the model first (and
  ``GET /suggestions`` lists their suggestions first).
- **nothing new, no suggestion**: a proposal that keeps the channel in its current folder and
  adds no tag it lacks is not saved (and a stored one is discarded on read). One that only adds
  tags is kept with ``same_folder: true`` and ``new_tags`` (computed on read).
- **proposal basis**: each suggestion stores the fingerprint of the folder list it was made
  with (``basis``); when the folders change (created, renamed, moved, deleted by the user) the
  stored proposal is discarded on read instead of being shown again. Folders created by an
  accept (and removed by its undo) do not count: the remaining suggestions are re-stamped.
  Suggestions saved before the basis existed are discarded on read.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import threading
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import prompts as P
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

GROUP_LABEL = "organize with Hermes"
"""Label of an accept's undo group (history drawer)."""
BATCH_SIZE = T.LLM_BATCH_CHANNELS
"""Channels per model call."""
RECENT_TITLES = P.LIMITS["recent_titles"]
MAX_EXAMPLES = P.LIMITS["examples"]
FOLDER_CHARS = P.LIMITS["folder_chars"]
TAG_CHARS = P.LIMITS["tag_chars"]
TAGS_PER_CHANNEL = P.LIMITS["tags_per_channel"]
WHY_CHARS = P.LIMITS["why_chars"]
MAX_FOLDER_DEPTH = 4
"""Folder levels accepted in a suggestion (``A/B/C/D``)."""
MAX_EDIT_TAGS = 20
"""Tags the user may put in a correction."""
CANCEL_WAIT_S = 180.0
"""How long a new run waits for a cancelled one (batch in flight) to release the lock before
``Busy``."""
CHANGE_PAGE = 200
"""``ChangeLog.list`` page size when collecting an accept's ``change_ids``."""

BASIS_KEY = "basis"
"""Payload field with the folder-list fingerprint the suggestion was made with."""
RESTAMP = "restamp"
"""``basis`` value meaning "re-stamp with the current fingerprint on the next read" (set by the
undo of an accept, which removes folders the accept created)."""

ORGANIZABLE = (T.Relation.subscribed, T.Relation.followed)
PROPOSAL_KEYS = frozenset({"channel_id", "folder", "new_folder", "tags", "confidence", "why"})
"""Exact fields of an output item (``OrganizeProposal``)."""

NO_MODEL_MESSAGE = "No AI model is available. Pick one and sign in under Settings → Models."
"""Same text as ``core.ai.NO_MODEL_MESSAGE`` (a test keeps them equal); cores do not import
each other, so the text is repeated here."""
NO_MODEL = T.AI_STATUS_REASONS[0]
"""``details["reason"]`` of the "no model" ``LLMUnavailable`` (as ``core.ai.NO_MODEL``)."""
BUSY_MESSAGE = "An organize run is already in progress; wait for it to finish."

_CONTROL = re.compile(r"[\x00-\x1f\x7f\u2028\u2029]")


# ------------------------------------------------------------- cleaning (untrusted data)


def _one_line(text: str) -> str:
    return " ".join(_CONTROL.sub(" ", text).split())


def clean_folder(value: Any) -> str | None:
    """Clean ``A/B`` path, or ``None`` if invalid (empty, ``..``, ``\\``, stray slash, empty
    segment, control character, too long or too deep)."""
    if not isinstance(value, str) or "\\" in value or _CONTROL.search(value):
        return None
    parts = [" ".join(p.split()) for p in value.strip().split("/")]
    if not parts or len(parts) > MAX_FOLDER_DEPTH:
        return None
    if any(p in ("", ".", "..") for p in parts):
        return None
    path = "/".join(parts)
    return path if len(path) <= FOLDER_CHARS else None


def clean_tag(value: Any) -> str | None:
    """Clean tag name, or ``None`` (empty, slash, control character, too long)."""
    if not isinstance(value, str) or _CONTROL.search(value) or "/" in value or "\\" in value:
        return None
    name = " ".join(value.split())
    return name if 0 < len(name) <= TAG_CHARS else None


def _confidence(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    value = float(value)
    return value if math.isfinite(value) and 0.0 <= value <= 1.0 else None


def _path_key(path: str) -> tuple[str, ...]:
    return tuple(dedup.normalize_name(part) for part in path.split("/"))


def _loads(text: Any) -> dict[str, Any]:
    try:
        data = json.loads(text) if isinstance(text, str) else text
    except ValueError:
        return {}
    return dict(data) if isinstance(data, Mapping) else {}


def _dumps(value: Any) -> str:
    return json.dumps(T.to_jsonable(value), ensure_ascii=False, sort_keys=True)


def _suggestion(row: Mapping[str, Any]) -> T.Suggestion:
    return T.Suggestion(
        id=row["id"],
        kind=T.SuggestionKind(row["kind"]),
        status=T.SuggestionStatus(row["status"]),
        payload=_loads(row["payload"]),
        created_at=int(row["created_at"]),
        channel_id=row["channel_id"],
        model=row["model"],
        decided_at=row["decided_at"],
    )


def _placeholders(n: int) -> str:
    return ", ".join("?" * n)


# --------------------------------------------------------------------------- folders and tags


class _Folders:
    """Index of existing folders: canonical path ↔ id (names via ``dedup.normalize_name``)."""

    def __init__(self, folders: Sequence[T.Folder]) -> None:
        by_id = {f.id: f for f in folders}
        self.path_of: dict[str, str] = {}
        self.by_key: dict[tuple[str, ...], str] = {}
        for folder in folders:
            parts: list[str] = []
            cur: T.Folder | None = folder
            seen: set[str] = set()
            while cur is not None and cur.id not in seen:
                seen.add(cur.id)
                parts.append(cur.name)
                cur = by_id.get(cur.parent_id) if cur.parent_id else None
            path = "/".join(reversed(parts))
            self.path_of[folder.id] = path
            self.by_key.setdefault(_path_key(path), folder.id)

    def find(self, path: str) -> str | None:
        return self.by_key.get(_path_key(path))

    def paths(self) -> list[str]:
        return sorted(self.path_of.values(), key=lambda p: (_path_key(p), p))

    def fingerprint(self) -> str:
        """Short hash of the folder paths (any create/rename/move/delete changes it)."""
        digest = hashlib.sha256()
        for path in sorted("\x1f".join(_path_key(p)) for p in self.path_of.values()):
            digest.update(path.encode("utf-8"))
            digest.update(b"\x00")
        return digest.hexdigest()[:16]


@dataclass
class _Plan:
    suggestion: T.Suggestion
    channel_id: str
    folder: str
    tags: list[str]
    edited: bool = False
    folder_id: str | None = None
    tag_ids: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- Organizer


class Organizer:
    """Real ``T.Organizer`` (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        llm: T.LLM,
        channels: T.ChannelService,
        taxonomy: T.TaxonomyService,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        new_id: Callable[[], str] | None = None,
        batch_size: int = BATCH_SIZE,
    ) -> None:
        self.db = db
        self.settings = settings
        self.llm = llm
        self.channels = channels
        self.taxonomy = taxonomy
        self.changelog = changelog
        self.clock: T.Clock = clock or T.SystemClock()
        self._new_id = new_id or (lambda: f"sg_{uuid.uuid4().hex}")
        self.batch_size = max(1, min(int(batch_size), BATCH_SIZE))
        self._running = threading.Lock()
        self._holder: T.ProgressFn | None = None
        """``on_progress`` of the run holding the lock (to tell whether it was cancelled)."""

    def _now(self) -> int:
        return int(self.clock.now())

    def _folders(self) -> _Folders:
        return _Folders(self.taxonomy.list_folders())

    def _tag_index(self) -> dict[str, str]:
        """Normalized name → canonical name of the existing tags."""
        return {dedup.normalize_name(t.name): t.name for t in self.taxonomy.list_tags()}

    def _tag_names(self) -> dict[str, str]:
        """Tag id → name."""
        return {t.id: t.name for t in self.taxonomy.list_tags()}

    @staticmethod
    def _delta(
        channel: T.Channel,
        folder: Any,
        tags: Any,
        folders: _Folders,
        tag_names: Mapping[str, str],
    ) -> tuple[bool, list[str]]:
        """``(same_folder, new_tags)``: whether *folder* is the channel's current folder and the
        suggested tags it does not have yet."""
        found = folders.find(folder) if isinstance(folder, str) else None
        same_folder = found is not None and found == channel.folder_id
        have = {dedup.normalize_name(tag_names[t]) for t in channel.tag_ids if t in tag_names}
        new_tags: list[str] = []
        for name in tags if isinstance(tags, list) else []:
            if not isinstance(name, str):
                continue
            key = dedup.normalize_name(name)
            if key not in have:
                have.add(key)
                new_tags.append(name)
        return same_folder, new_tags

    # ------------------------------------------------------------------ organize

    def organize(
        self,
        channel_ids: Sequence[str] | None = None,
        *,
        timeout: float = T.TOOL_TIMEOUT_S,
        on_progress: T.ProgressFn | None = None,
    ) -> T.OrganizeResult:
        if not self.llm.available():
            raise T.LLMUnavailable(NO_MODEL_MESSAGE, reason=NO_MODEL)
        if not self._acquire(on_progress):
            raise T.Busy(BUSY_MESSAGE)
        self._holder = on_progress
        try:
            return self._organize(channel_ids, timeout=timeout, on_progress=on_progress)
        finally:
            self._holder = None
            self._running.release()

    def _acquire(self, on_progress: T.ProgressFn | None) -> bool:
        """One-run-at-a-time lock. If the holder was **cancelled** and is still waiting for a batch
        in flight → wait for it to release (up to ``CANCEL_WAIT_S``) instead of ``Busy``: asking
        again right after cancelling works."""
        if self._running.acquire(blocking=False):
            return True
        if not T.is_cancelled(self._holder):
            return False
        if on_progress is not None:
            on_progress(
                T.Progress(
                    stage="organize", message="Waiting for the cancelled organize run to end…"
                )
            )
        return self._running.acquire(timeout=CANCEL_WAIT_S)

    def _organize(
        self,
        channel_ids: Sequence[str] | None,
        *,
        timeout: float,
        on_progress: T.ProgressFn | None,
    ) -> T.OrganizeResult:
        deadline = time.monotonic() + max(0.0, float(timeout))
        targets = self._targets(channel_ids)
        model = self.llm.model_name()
        if not targets:
            return T.OrganizeResult(suggestions=(), model=model)
        chunks = [targets[i : i + self.batch_size] for i in range(0, len(targets), self.batch_size)]
        total = len(targets)

        def progress(done: int, message: str) -> None:
            if on_progress is not None:
                on_progress(T.Progress(stage="organize", done=done, total=total, message=message))

        context = {
            "folders": self._folders().paths(),
            "tags": sorted(t.name for t in self.taxonomy.list_tags()),
            "examples": self._examples(),
        }
        progress(0, f"{total} channels in {len(chunks)} batch(es)")
        saved: list[str] = []
        errors: list[T.TubeError] = []
        succeeded = failed = done = 0
        for index, chunk in enumerate(chunks, start=1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                errors.append(T.OperationTimeout("The organize run went past its time limit."))
                break
            T.check_cancelled(on_progress)  # between batches (before spending another call)
            payload = {"items": self._items(chunk), **context}
            try:
                out = self.llm.complete_structured(T.AiTask.organize, payload, timeout=remaining)
            except T.OperationTimeout as exc:
                errors.append(exc)
                break
            except T.LLMInvalidResponse as exc:
                log.warning("organize: batch %d of %d rejected: %s", index, len(chunks), exc)
                errors.append(exc)
                failed += 1
            else:
                # a response that came back after cancellation is not written
                T.check_cancelled(on_progress)
                succeeded += 1
                if model is None:
                    model = self.llm.model_name()
                saved.extend(self._save(self._accepted_items(out, chunk), model))
            done += len(chunk)
            note = f" · {failed} batch(es) failed" if failed else ""
            progress(done, f"batch {index} of {len(chunks)}{note}")
        if errors and not succeeded:
            raise errors[0]
        if errors:
            log.warning("organize: %d batch(es) left out (%s)", len(errors), errors[0].code)
        return T.OrganizeResult(suggestions=tuple(self._get_many(saved)), model=model)

    def _targets(self, channel_ids: Sequence[str] | None) -> list[T.Channel]:
        if channel_ids is None:
            return self.channels.list(T.ChannelFilter(relations=ORGANIZABLE, folder_id=None))
        wanted = [c for c in dict.fromkeys(channel_ids) if isinstance(c, str) and c]
        out = []
        for channel_id in wanted:
            ch = self.channels.get(channel_id)
            if ch is not None and ch.relation in ORGANIZABLE:
                out.append(ch)
        # channels without a folder first (stable): they are what the person needs most, and
        # they get the first batch when the time limit cuts the run short
        return sorted(out, key=lambda c: c.folder_id is not None)

    def _recent_titles(self, ids: Sequence[str]) -> dict[str, list[str]]:
        if not ids:
            return {}
        rows = self.db.query(
            "SELECT channel_id, title FROM ("
            " SELECT channel_id, title, ROW_NUMBER() OVER ("
            "  PARTITION BY channel_id"
            "  ORDER BY COALESCE(published_at, 0) DESC, first_seen_at DESC, id"
            " ) AS rn FROM videos"
            f" WHERE channel_id IN ({_placeholders(len(ids))}) AND trim(title) <> ''"
            f") WHERE rn <= {int(RECENT_TITLES)} ORDER BY channel_id, rn",
            list(ids),
        )
        out: dict[str, list[str]] = {}
        for row in rows:
            out.setdefault(row["channel_id"], []).append(_one_line(row["title"]))
        return out

    def _items(self, chunk: Sequence[T.Channel]) -> list[dict[str, Any]]:
        recent = self._recent_titles([c.id for c in chunk])
        return [
            {
                "channel_id": c.id,
                "title": _one_line(c.title or "") or c.handle or c.id,
                "handle": c.handle,
                "recent_titles": recent.get(c.id, []),
            }
            for c in chunk
        ]

    def _accepted_items(
        self, out: Any, chunk: Sequence[T.Channel]
    ) -> list[tuple[T.Channel, dict[str, Any]]]:
        """Output items that pass the checks, with the channel **re-read** from the database."""
        items = out.get("items") if isinstance(out, Mapping) else None
        if not isinstance(items, list):
            log.warning("organize: output has no item list")
            return []
        given = {c.id for c in chunk}
        folders = self._folders()
        tags = self._tag_index()
        tag_names = self._tag_names()
        seen: set[str] = set()
        accepted: list[tuple[T.Channel, dict[str, Any]]] = []
        dropped: list[str] = []
        unchanged = 0
        for raw in items:
            proposal = self._clean_proposal(raw, folders, tags)
            cid = proposal["channel_id"] if proposal else None
            if proposal is None or cid not in given or cid in seen:
                dropped.append(str(raw.get("channel_id")) if isinstance(raw, Mapping) else "?")
                continue
            seen.add(cid)
            current = self.channels.get(cid)
            if current is None or current.relation not in ORGANIZABLE:
                dropped.append(cid)
                continue
            same_folder, new_tags = self._delta(
                current, proposal["folder"], proposal["tags"], folders, tag_names
            )
            if same_folder and not new_tags:
                unchanged += 1  # "stay where you are": not a suggestion
                continue
            accepted.append((current, proposal))
        missing = given - seen
        if dropped or missing or unchanged:
            log.info(
                "organize: %d item(s) dropped, %d channel(s) without a suggestion,"
                " %d left as they are",
                len(dropped),
                len(missing),
                unchanged,
            )
        return accepted

    def _clean_proposal(
        self, raw: Any, folders: _Folders, tag_index: Mapping[str, str]
    ) -> dict[str, Any] | None:
        if not isinstance(raw, Mapping) or set(raw) != PROPOSAL_KEYS:
            return None
        cid = raw["channel_id"]
        if not isinstance(cid, str) or not dedup.is_channel_id(cid):
            return None
        folder = clean_folder(raw["folder"])
        new_folder = raw["new_folder"]
        confidence = _confidence(raw["confidence"])
        why = raw["why"]
        tags_raw = raw["tags"]
        if folder is None or not isinstance(new_folder, bool) or confidence is None:
            return None
        if not isinstance(why, str) or not isinstance(tags_raw, list):
            return None
        existing = folders.find(folder)
        if existing is not None:
            folder, new_folder = folders.path_of[existing], False
        elif not new_folder:
            return None  # an "existing" folder that does not exist: the model made it up
        tags: list[str] = []
        keys: set[str] = set()
        for value in tags_raw:
            name = clean_tag(value)
            key = dedup.normalize_name(name) if name else ""
            if not name or key in keys:
                continue
            keys.add(key)
            tags.append(tag_index.get(key, name))
        return {
            "channel_id": cid,
            "folder": folder,
            "new_folder": new_folder,
            "tags": tags[:TAGS_PER_CHANNEL],
            "confidence": confidence,
            "why": _one_line(why)[:WHY_CHARS],
        }

    def _save(
        self, accepted: Sequence[tuple[T.Channel, dict[str, Any]]], model: str | None
    ) -> list[str]:
        if not accepted:
            return []
        now = self._now()
        folders = self._folders()
        basis = folders.fingerprint()
        ids: list[str] = []
        with self.db.transaction():
            for channel, proposal in accepted:
                payload = {
                    **proposal,
                    "channel_title": channel.title,
                    "from_folder_id": channel.folder_id,
                    "from_folder": folders.path_of.get(channel.folder_id or ""),
                    BASIS_KEY: basis,
                }
                rows = self.db.query(
                    "SELECT * FROM suggestions WHERE kind = 'organize' AND status = 'pending'"
                    " AND channel_id = ? ORDER BY created_at DESC, rowid DESC",
                    (channel.id,),
                )
                keep = next((r for r in rows if self._same(_loads(r["payload"]), payload)), None)
                stale = [r["id"] for r in rows if keep is None or r["id"] != keep["id"]]
                if stale:
                    self.db.execute(
                        "UPDATE suggestions SET status = 'superseded', decided_at = ?"
                        f" WHERE id IN ({_placeholders(len(stale))})",
                        [now, *stale],
                    )
                if keep is not None:
                    if _loads(keep["payload"]).get(BASIS_KEY) != basis:
                        # same answer under a different folder list: refresh it in place
                        self.db.execute(
                            "UPDATE suggestions SET payload = ? WHERE id = ?",
                            (_dumps(payload), keep["id"]),
                        )
                    ids.append(keep["id"])
                    continue
                sid = self._new_id()
                self.db.execute(
                    "INSERT INTO suggestions (id, kind, channel_id, payload, status, model,"
                    " created_at) VALUES (?, 'organize', ?, ?, 'pending', ?, ?)",
                    (sid, channel.id, _dumps(payload), model, now),
                )
                ids.append(sid)
        return ids

    @staticmethod
    def _same(old: Mapping[str, Any], new: Mapping[str, Any]) -> bool:
        def key(p: Mapping[str, Any]) -> tuple[Any, ...]:
            folder = p.get("folder")
            tags = p.get("tags") or []
            return (
                _path_key(folder) if isinstance(folder, str) else None,
                tuple(sorted(dedup.normalize_name(t) for t in tags if isinstance(t, str))),
                p.get("from_folder_id"),
            )

        return key(old) == key(new)

    def _examples(self) -> list[dict[str, Any]]:
        """Corrections (accepts with ``edits``) and rejections, most recent first, one per
        channel."""
        rows = self.db.query(
            "SELECT channel_id, status, payload FROM suggestions WHERE kind = 'organize'"
            " AND status IN ('accepted', 'rejected') AND decided_at IS NOT NULL"
            " ORDER BY decided_at DESC, rowid DESC LIMIT 500"
        )
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            payload = _loads(row["payload"])
            choice = payload.get("edited") if row["status"] == "accepted" else payload.get("kept")
            cid = row["channel_id"]
            if not isinstance(choice, Mapping) or not cid or cid in seen:
                continue
            title = payload.get("channel_title")
            if not isinstance(title, str) or not title.strip():
                ch = self.channels.get(cid)
                title = ch.title if ch else ""
            if not title.strip():
                continue
            seen.add(cid)
            folder = choice.get("folder")
            out.append(
                {
                    "channel_title": _one_line(title),
                    "folder": folder if isinstance(folder, str) else None,
                    "tags": [t for t in choice.get("tags") or [] if isinstance(t, str)],
                }
            )
            if len(out) >= MAX_EXAMPLES:
                break
        return out

    # ------------------------------------------------------------------ read

    def _get_many(self, ids: Sequence[str]) -> list[T.Suggestion]:
        if not ids:
            return []
        rows = self.db.query(
            f"SELECT * FROM suggestions WHERE id IN ({_placeholders(len(ids))})", list(ids)
        )
        by_id = {r["id"]: r for r in rows}
        folders = self._folders()
        tag_names = self._tag_names()
        found = [_suggestion(by_id[i]) for i in ids if i in by_id]
        current = self._current_channels(found)
        return [
            self._present(s, folders, current.get(s.channel_id or ""), tag_names) for s in found
        ]

    def _current_channels(self, suggestions: Sequence[T.Suggestion]) -> dict[str, T.Channel]:
        cids = sorted({s.channel_id for s in suggestions if s.channel_id})
        if not cids:
            return {}
        return {c.id: c for c in self.channels.list(T.ChannelFilter(ids=tuple(cids)))}

    @classmethod
    def _present(
        cls,
        s: T.Suggestion,
        folders: _Folders,
        channel: T.Channel | None = None,
        tag_names: Mapping[str, str] | None = None,
    ) -> T.Suggestion:
        """``new_folder`` as the database is now (another accepted suggestion may have created the
        folder); with the channel, ``same_folder`` and ``new_tags`` as it is now (the screen says
        "add tag #x" instead of "folder → same folder"). ``basis`` stays internal."""
        folder = s.payload.get("folder")
        if not isinstance(folder, str):
            return s
        existing = folders.find(folder)
        payload = dict(s.payload)
        payload.pop(BASIS_KEY, None)
        payload["new_folder"] = existing is None
        if existing is not None:
            payload["folder"] = folders.path_of[existing]
        if channel is not None:
            same_folder, new_tags = cls._delta(
                channel, folder, payload.get("tags"), folders, tag_names or {}
            )
            payload["same_folder"] = same_folder
            payload["new_tags"] = new_tags
        return T.Suggestion(
            id=s.id,
            kind=s.kind,
            status=s.status,
            payload=payload,
            created_at=s.created_at,
            channel_id=s.channel_id,
            model=s.model,
            decided_at=s.decided_at,
        )

    def pending(self) -> list[T.Suggestion]:
        rows = self.db.query(
            "SELECT * FROM suggestions WHERE kind = 'organize' AND status = 'pending'"
            " ORDER BY created_at, rowid"
        )
        if not rows:
            return []
        suggestions = [_suggestion(r) for r in rows]
        current = self._current_channels(suggestions)
        folders = self._folders()
        basis = folders.fingerprint()
        tag_names = self._tag_names()
        latest: dict[str, T.Suggestion] = {}
        stale: list[str] = []
        restamp: list[T.Suggestion] = []
        for s in suggestions:
            ch = current.get(s.channel_id or "")
            moved = (
                "from_folder_id" in s.payload
                and ch is not None
                and (ch.folder_id != s.payload.get("from_folder_id"))
            )
            stamp = s.payload.get(BASIS_KEY)
            # made with another folder list (or before the basis existed): not reused
            outdated = stamp != basis and stamp != RESTAMP
            if ch is None or ch.relation not in ORGANIZABLE or moved or outdated:
                stale.append(s.id)
                continue
            same_folder, new_tags = self._delta(
                ch, s.payload.get("folder"), s.payload.get("tags"), folders, tag_names
            )
            if same_folder and not new_tags:
                stale.append(s.id)  # nothing left to change (e.g. the user added the tag)
                continue
            if stamp == RESTAMP:
                restamp.append(s)
            previous = latest.get(ch.id)
            if previous is not None:
                stale.append(previous.id)
            latest[ch.id] = s
        if stale or restamp:
            with self.db.transaction():
                if stale:
                    self.db.execute(
                        "UPDATE suggestions SET status = 'superseded', decided_at = ?"
                        f" WHERE status = 'pending' AND id IN ({_placeholders(len(stale))})",
                        [self._now(), *stale],
                    )
                for s in restamp:
                    if s.id not in stale:
                        self.db.execute(
                            "UPDATE suggestions SET payload = ?"
                            " WHERE id = ? AND status = 'pending'",
                            (_dumps({**s.payload, BASIS_KEY: basis}), s.id),
                        )
        keep = {s.id for s in latest.values()}
        return [
            self._present(s, folders, current.get(s.channel_id or ""), tag_names)
            for s in suggestions
            if s.id in keep
        ]

    def _rebase_pending(self, old: Sequence[str], new: str) -> None:
        """Pending suggestions stamped with a fingerprint in *old* get *new* (the folder list
        changed through the proposal itself: an accept, or its undo)."""
        olds = {o for o in old if o}
        if not olds:
            return
        rows = self.db.query(
            "SELECT id, payload FROM suggestions WHERE kind = 'organize' AND status = 'pending'"
        )
        for row in rows:
            payload = _loads(row["payload"])
            if payload.get(BASIS_KEY) not in olds:
                continue
            payload[BASIS_KEY] = new
            self.db.execute(
                "UPDATE suggestions SET payload = ? WHERE id = ?", (_dumps(payload), row["id"])
            )

    def _select(
        self, suggestion_ids: Sequence[str] | None, channel_ids: Sequence[str] | None
    ) -> list[T.Suggestion]:
        pending = self.pending()
        if suggestion_ids is None and channel_ids is None:
            return pending
        wanted_s = set(suggestion_ids or ())
        wanted_c = set(channel_ids or ())
        return [s for s in pending if s.id in wanted_s or s.channel_id in wanted_c]

    # ------------------------------------------------------------------ accept

    @staticmethod
    def _clean_edits(edits: Mapping[str, Any] | None) -> dict[str, T.OrganizeEdit]:
        if edits is None:
            return {}
        if not isinstance(edits, Mapping):
            raise T.ValidationError("edits must be an object channel → correction", field="edits")
        out: dict[str, T.OrganizeEdit] = {}
        for cid, edit in edits.items():
            if isinstance(edit, Mapping):
                unknown = set(edit) - {"folder", "tags"}
                if unknown:
                    raise T.ValidationError(f"correction with unknown field: {sorted(unknown)}")
                folder_raw, tags_raw = edit.get("folder"), edit.get("tags")
            elif isinstance(edit, T.OrganizeEdit):
                folder_raw, tags_raw = edit.folder, edit.tags
            else:
                raise T.ValidationError(f"invalid correction for {cid}", field="edits")
            folder: str | None = None
            if folder_raw is not None and not (
                isinstance(folder_raw, str) and not folder_raw.strip()
            ):
                folder = clean_folder(folder_raw)
                if folder is None:
                    raise T.ValidationError(f"invalid folder: {folder_raw!r}", field="edits")
            tags: tuple[str, ...] | None = None
            if tags_raw is not None:
                if isinstance(tags_raw, str) or not isinstance(tags_raw, Sequence):
                    raise T.ValidationError("tags must be a list", field="edits")
                names: list[str] = []
                for value in tags_raw:
                    name = clean_tag(value)
                    if name is None:
                        raise T.ValidationError(f"invalid tag: {value!r}", field="edits")
                    if dedup.normalize_name(name) not in {dedup.normalize_name(n) for n in names}:
                        names.append(name)
                if len(names) > MAX_EDIT_TAGS:
                    raise T.ValidationError(f"at most {MAX_EDIT_TAGS} tags", field="edits")
                tags = tuple(names)
            out[str(cid)] = T.OrganizeEdit(folder=folder, tags=tags)
        return out

    def accept(
        self,
        suggestion_ids: Sequence[str] | None = None,
        *,
        channel_ids: Sequence[str] | None = None,
        edits: Mapping[str, T.OrganizeEdit] | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.AcceptReport:
        actor = T.Actor(actor)
        clean_edits = self._clean_edits(edits)
        if suggestion_ids is not None:
            self._require_known(suggestion_ids)
        chosen = self._select(suggestion_ids, channel_ids)
        if not chosen:
            return T.AcceptReport()
        plans = self._plans(chosen, clean_edits)
        if not plans:
            return T.AcceptReport()
        created_folders: list[str] = []
        created_tags: list[str] = []
        last_change = self._last_change_id()
        basis_before = self._folders().fingerprint()
        with self.db.transaction(), self.changelog.group(GROUP_LABEL) as gid:
            self._resolve_folders(plans, created_folders, actor)
            self._resolve_tags(plans, created_tags, actor)
            by_folder: dict[str | None, list[str]] = {}
            for plan in plans:
                by_folder.setdefault(plan.folder_id, []).append(plan.channel_id)
            for folder_id, cids in by_folder.items():
                self.channels.move(cids, folder_id, actor=actor)
            for plan in plans:
                self._add_tags(plan, actor)
            now = self._now()
            basis_after = self._folders().fingerprint()
            for plan in plans:
                payload = dict(plan.suggestion.payload)
                for key in ("same_folder", "new_tags"):  # computed on read, not stored
                    payload.pop(key, None)
                payload["applied"] = {"folder": plan.folder, "tags": plan.tags}
                if plan.edited:
                    payload["edited"] = {"folder": plan.folder, "tags": plan.tags}
                if basis_after != basis_before:
                    payload["basis_after"] = basis_after
                self.db.execute(
                    "UPDATE suggestions SET status = 'accepted', decided_at = ?, payload = ?"
                    " WHERE id = ? AND status = 'pending'",
                    (now, _dumps(payload), plan.suggestion.id),
                )
            if basis_after != basis_before:
                # folders this accept created are the proposal's own doing: the rest stays valid
                self._rebase_pending([basis_before], basis_after)
            self.changelog.record(
                actor,
                T.ChangeAction.organize_accept,
                {
                    "label": GROUP_LABEL,
                    "count": len(plans),
                    "folders": sorted({p.folder for p in plans}),
                },
                T.UndoOrganizeAccept(suggestion_ids=tuple(p.suggestion.id for p in plans)),
            )
        return T.AcceptReport(
            accepted=tuple(p.suggestion.id for p in plans),
            created_folders=tuple(created_folders),
            created_tags=tuple(created_tags),
            change_group=gid,
            change_ids=self._group_change_ids(gid, after=last_change),
        )

    def _last_change_id(self) -> int:
        page = self.changelog.list(limit=1)
        return page[0].id if page else 0

    def _group_change_ids(self, group_id: str, *, after: int) -> tuple[int, ...]:
        """Ids (ascending) of the *group_id* entries recorded after *after* — only through the
        ``ChangeLog`` (no SQL on another owner's table); stops at *after*, so it only reads what
        this accept (and concurrent writes, filtered by group) recorded."""
        ids: list[int] = []
        before: int | None = None
        while True:
            page = self.changelog.list(limit=CHANGE_PAGE, before_id=before)
            for record in page:
                if record.id <= after:
                    return tuple(sorted(ids))
                if record.group_id == group_id:
                    ids.append(record.id)
            if len(page) < CHANGE_PAGE:
                return tuple(sorted(ids))
            before = page[-1].id

    def _require_known(self, suggestion_ids: Sequence[str]) -> None:
        ids = list(dict.fromkeys(suggestion_ids))
        if not all(isinstance(i, str) for i in ids):
            raise T.ValidationError("suggestion_ids must be a list of strings")
        if not ids:
            return
        rows = self.db.query(
            "SELECT id FROM suggestions WHERE kind = 'organize'"
            f" AND id IN ({_placeholders(len(ids))})",
            ids,
        )
        missing = [i for i in ids if i not in {r["id"] for r in rows}]
        if missing:
            raise T.NotFound(f"suggestion {missing[0]} does not exist", suggestion_ids=missing)

    def _plans(
        self, chosen: Sequence[T.Suggestion], edits: Mapping[str, T.OrganizeEdit]
    ) -> list[_Plan]:
        tag_index = self._tag_index()
        plans: list[_Plan] = []
        for s in chosen:
            cid = s.channel_id or s.payload.get("channel_id")
            if not isinstance(cid, str):
                continue
            edit = edits.get(cid)
            folder = clean_folder(edit.folder if edit and edit.folder else s.payload.get("folder"))
            raw_tags = (
                list(edit.tags) if edit and edit.tags is not None else s.payload.get("tags") or []
            )
            if folder is None:
                log.warning("organize: suggestion %s has an invalid folder; skipped", s.id)
                continue
            names: list[str] = []
            keys: set[str] = set()
            for value in raw_tags:
                name = clean_tag(value)
                key = dedup.normalize_name(name) if name else ""
                if name and key not in keys:
                    keys.add(key)
                    names.append(tag_index.get(key, name))
            edited = edit is not None and (edit.folder is not None or edit.tags is not None)
            plans.append(_Plan(s, cid, folder, names, edited=edited))
        return plans

    def _resolve_folders(self, plans: Sequence[_Plan], created: list[str], actor: T.Actor) -> None:
        cache: dict[tuple[str, ...], tuple[str, str]] = {}
        for plan in plans:
            parent: str | None = None
            names: list[str] = []
            for depth, part in enumerate(plan.folder.split("/"), start=1):
                key = _path_key(plan.folder)[:depth]
                if key in cache:
                    parent, name = cache[key]
                else:
                    found = self.taxonomy.find_folder_by_name(part, parent_id=parent)
                    if found is None:
                        found = self.taxonomy.create_folder(part, parent_id=parent, actor=actor)
                        created.append(found.id)
                    parent, name = found.id, found.name
                    cache[key] = (parent, name)
                names.append(name)
            plan.folder_id = parent
            plan.folder = "/".join(names)

    def _resolve_tags(self, plans: Sequence[_Plan], created: list[str], actor: T.Actor) -> None:
        cache: dict[str, T.Tag] = {}
        for plan in plans:
            plan.tag_ids = []
            names: list[str] = []
            for name in plan.tags:
                key = dedup.normalize_name(name)
                tag = cache.get(key) or self.taxonomy.find_tag_by_name(name)
                if tag is None:
                    tag = self.taxonomy.create_tag(name, actor=actor)
                    created.append(tag.id)
                cache[key] = tag
                plan.tag_ids.append(tag.id)
                names.append(tag.name)
            plan.tags = names

    def _add_tags(self, plan: _Plan, actor: T.Actor) -> None:
        if not plan.tag_ids:
            return
        channel = self.channels.get(plan.channel_id)
        if channel is None:
            return
        merged = list(channel.tag_ids) + [t for t in plan.tag_ids if t not in channel.tag_ids]
        if len(merged) != len(channel.tag_ids):
            self.channels.set_tags(plan.channel_id, merged, actor=actor)

    # ------------------------------------------------------------------ reject

    def reject(
        self,
        suggestion_ids: Sequence[str] | None = None,
        *,
        channel_ids: Sequence[str] | None = None,
    ) -> int:
        chosen = self._select(suggestion_ids, channel_ids)
        if not chosen:
            return 0
        folders = self._folders()
        tag_names = {t.id: t.name for t in self.taxonomy.list_tags()}
        now = self._now()
        count = 0
        with self.db.transaction():
            for s in chosen:
                ch = self.channels.get(s.channel_id or "")
                payload = dict(s.payload)
                payload["kept"] = {
                    "folder": folders.path_of.get(ch.folder_id) if ch and ch.folder_id else None,
                    "tags": sorted(
                        tag_names[t] for t in (ch.tag_ids if ch else ()) if t in tag_names
                    ),
                }
                res = self.db.execute(
                    "UPDATE suggestions SET status = 'rejected', decided_at = ?, payload = ?"
                    " WHERE id = ? AND status = 'pending'",
                    (now, _dumps(payload), s.id),
                )
                count += int(res.rowcount or 0)
        return count

    # ------------------------------------------------------------------ undo

    def apply_undo(self, change: T.ChangeRecord) -> None:
        undo = change.undo
        if not isinstance(undo, T.UndoOrganizeAccept):
            raise T.UndoRefused("not_undoable", f"organize cannot undo {change.action}")
        afters: list[str] = []
        for sid in undo.suggestion_ids:
            row = self.db.query_one(
                "SELECT * FROM suggestions WHERE id = ? AND kind = 'organize'", (sid,)
            )
            if row is None or row["status"] != T.SuggestionStatus.accepted.value:
                continue
            payload = _loads(row["payload"])
            payload.pop("applied", None)
            payload.pop("edited", None)
            after = payload.pop("basis_after", None)
            if isinstance(after, str):
                afters.append(after)
            # the undo also removes the folders the accept created (in whatever order the
            # history runs it): the next read stamps the folder list as it ends up
            payload[BASIS_KEY] = RESTAMP
            other = self.db.query_one(
                "SELECT id FROM suggestions WHERE kind = 'organize' AND status = 'pending'"
                " AND channel_id = ? AND id <> ?",
                (row["channel_id"], sid),
            )
            if other is None:
                self.db.execute(
                    "UPDATE suggestions SET status = 'pending', decided_at = NULL, payload = ?"
                    " WHERE id = ?",
                    (_dumps(payload), sid),
                )
            else:  # the channel already has another pending suggestion: this one does not come back
                self.db.execute(
                    "UPDATE suggestions SET status = 'superseded', decided_at = ?, payload = ?"
                    " WHERE id = ?",
                    (self._now(), _dumps(payload), sid),
                )
        # the rest of the proposal was re-stamped by the accept: it stays valid after the undo
        self._rebase_pending(afters, RESTAMP)


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    llm: T.LLM,
    channels: T.ChannelService,
    taxonomy: T.TaxonomyService,
    changelog: T.ChangeLog,
    clock: T.Clock | None = None,
) -> T.Organizer:
    """Real ``Organizer`` (no network, no thread, no write here)."""
    return Organizer(
        db=db,
        settings=settings,
        llm=llm,
        channels=channels,
        taxonomy=taxonomy,
        changelog=changelog,
        clock=clock,
    )


__all__ = [
    "BATCH_SIZE",
    "GROUP_LABEL",
    "NO_MODEL_MESSAGE",
    "Organizer",
    "build",
    "clean_folder",
    "clean_tag",
]
