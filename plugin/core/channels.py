"""Channels: ``ChannelService`` — owner of ``channels`` and ``channel_tags``.

Rules (``types.ChannelService``):

- **Nobody subscribes through here** — ``add`` never creates ``subscribed`` or ``ex`` (only the
  extension subscribes; ``ex`` only through the queue or a ``complete`` sync). The Manage
  "unsubscribe" batch is not a ``BatchOp``: ``batch_or_propose`` sends it to ``Cleanup.propose``
  (a cleanup candidate), never to the queue. Nothing in this module writes to ``unsub_queue``.
- **Relation** — ``RELATION_TRANSITIONS``: same relation = no-op; outside the table = ``Conflict``.
  ``→ ex`` writes ``unsubscribed_at = now``; ``→ ignored`` keeps it; anything else clears it.
- **Dedup** — ``find_duplicate`` over ``core/dedup.py``: an id decides on its own; strong keys
  (``handle``/``custom``/``user``) match when there is no conflict; the **name only decides when
  the input has no strong key** and, if it matches more than one channel, it does not decide
  (ambiguous).
- **Atomic** — every write with history runs in a ``Db.transaction()`` together with
  ``ChangeLog.record``: a failure at any point (including in the history) writes nothing.
  Validation happens before the transaction opens. Network (``YouTubeClient.resolve_channel``)
  only **outside** a transaction.
- **Unique handle** — the schema has a unique index on ``handle``. A handle that arrives from the
  extension/YouTube for another channel "changes owner" (the old one loses its handle); a manual
  edit to another channel's handle → ``Conflict``.
- **Undo** — ``apply_undo`` writes only to ``channels``/``channel_tags`` and never calls
  ``record``. Refusals (``UndoRefused``): undoing a relation already made real by an
  unsubscribe/resubscribe executed by the queue (``already_executed``), a relation that changed
  since (``not_undoable``), and deleting a channel added by link that the extension has since
  synced as subscribed (``not_undoable``).
- **No history** — ``update_stats``, ``remove_by_source`` (clearing the demo) and sync
  ``upsert_many`` (``actor != user``).
"""

from __future__ import annotations

import contextlib
import dataclasses
import json
import logging
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

PATCH_FIELDS = ("title", "handle", "thumb", "url", "folder_id", "favorite", "muted", "ai_note")
"""``ChannelPatch`` fields (columns the user can edit)."""
RESTORABLE = frozenset({*PATCH_FIELDS, "relation", "unsubscribed_at", "tag_ids"})
"""Keys accepted in undo ``before`` snapshots (the rest is ignored: never becomes a column name)."""
PATCH_RELATIONS = frozenset({T.Relation.followed, T.Relation.ignored})
"""Relations the Manage screen may request directly (``PATCH /channels/{id}``)."""
UNSUBSCRIBE_OP = "unsubscribe"
"""``POST /channels/batch`` op that only proposes to cleanup (``Cleanup.propose``)."""

_STRONG_KINDS = frozenset({"id", "handle", "custom", "user"})
_BOOL_COLUMNS = frozenset({"favorite", "muted"})
_TEXT_OR_NONE = ("thumb", "url", "ai_note")


def _relation(value: Any) -> T.Relation:
    try:
        return T.Relation(value)
    except ValueError as exc:
        raise T.ValidationError(f"invalid relation: {value!r}", field="relation") from exc


def _unsub_for(target: T.Relation, current_unsub: int | None, now: int) -> int | None:
    if target is T.Relation.ex:
        return now
    if target is T.Relation.ignored:
        return current_unsub
    return None


def _ids_json(ids: Sequence[str]) -> str:
    return json.dumps(list(ids))


def _channel_from_row(row: Mapping[str, Any], tag_ids: Sequence[str]) -> T.Channel:
    return T.Channel(
        id=row["id"],
        title=row["title"],
        relation=T.Relation(row["relation"]),
        source=T.ChannelSource(row["source"]),
        added_at=int(row["added_at"]),
        handle=row["handle"],
        thumb=row["thumb"],
        url=row["url"],
        folder_id=row["folder_id"],
        favorite=bool(row["favorite"]),
        muted=bool(row["muted"]),
        unsubscribed_at=row["unsubscribed_at"],
        last_video_at=row["last_video_at"],
        videos_per_week=row["videos_per_week"],
        shorts_ratio=row["shorts_ratio"],
        ai_note=row["ai_note"],
        tag_ids=tuple(sorted(tag_ids)),
    )


def _sort_key(title: str | None, channel_id: str) -> tuple[str, str]:
    return (dedup.normalize_name(title or ""), channel_id)


# --------------------------------------------------------------------------- dedup index


class _Index:
    """Dedup keys of every channel, to find duplicates without scanning the table per item."""

    def __init__(self) -> None:
        self.keys: dict[str, tuple[str, ...]] = {}
        self.by_key: dict[str, list[str]] = {}
        self.order: dict[str, tuple[str, str]] = {}

    @classmethod
    def load(cls, db: T.Db) -> _Index:
        idx = cls()
        rows = db.query("SELECT id, handle, url, title FROM channels")
        rows.sort(key=lambda r: _sort_key(r["title"], r["id"]))
        for r in rows:
            idx.put(r["id"], handle=r["handle"], url=r["url"], title=r["title"])
        return idx

    def has(self, channel_id: str) -> bool:
        return channel_id in self.keys

    def put(
        self, channel_id: str, *, handle: str | None, url: str | None, title: str | None
    ) -> None:
        self.drop(channel_id)
        keys = dedup.channel_match_keys(channel_id=channel_id, handle=handle, url=url, title=title)
        self.keys[channel_id] = keys
        self.order[channel_id] = _sort_key(title, channel_id)
        for key in keys:
            bucket = self.by_key.setdefault(key, [])
            bucket.append(channel_id)
            bucket.sort(key=self.order.__getitem__)

    def drop(self, channel_id: str) -> None:
        for key in self.keys.pop(channel_id, ()):
            bucket = self.by_key.get(key)
            if bucket and channel_id in bucket:
                bucket.remove(channel_id)
        self.order.pop(channel_id, None)

    def find(self, keys: Sequence[str]) -> str | None:
        if not keys:
            return None
        kinds = {k.split(":", 1)[0] for k in keys}
        allow_name = not (kinds & _STRONG_KINDS)
        candidates: list[str] = []
        for key in keys:  # already in strength order (dedup.channel_match_keys)
            if key.startswith("name:") and not allow_name:
                continue
            for cid in self.by_key.get(key, ()):
                if cid not in candidates:
                    candidates.append(cid)
        matches = [
            cid
            for cid in candidates
            if dedup.same_channel(tuple(keys), self.keys[cid], allow_name=allow_name)
        ]
        if not matches:
            return None
        if allow_name and len(matches) > 1:
            return None  # name only and more than one channel with that name: cannot decide
        return matches[0]


# --------------------------------------------------------------------------- service


@dataclass(frozen=True, slots=True)
class BatchOutcome:
    """``POST /channels/batch`` response (``ChannelBatchResult`` in api.yaml)."""

    batch: T.BatchResult | None = None
    proposed: tuple[T.CleanupCandidate, ...] = ()


class ChannelService:
    """``ChannelService`` over ``channels``/``channel_tags`` (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings | None,
        youtube: T.YouTubeClient | None,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.youtube = youtube
        self.changelog = changelog
        self.clock: T.Clock = clock or T.SystemClock()

    def _now(self) -> int:
        return int(self.clock.now())

    # ------------------------------------------------------------------ read

    def _tags_of(self, ids: Sequence[str]) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {i: [] for i in ids}
        if not ids:
            return out
        rows = self.db.query(
            "SELECT channel_id, tag_id FROM channel_tags"
            " WHERE channel_id IN (SELECT value FROM json_each(?))",
            (_ids_json(ids),),
        )
        for r in rows:
            out.setdefault(r["channel_id"], []).append(r["tag_id"])
        return out

    def _rows_to_channels(self, rows: Sequence[Mapping[str, Any]]) -> list[T.Channel]:
        tags = self._tags_of([r["id"] for r in rows])
        return [_channel_from_row(r, tags.get(r["id"], [])) for r in rows]

    def get(self, channel_id: str) -> T.Channel | None:
        if not isinstance(channel_id, str):
            return None
        row = self.db.query_one("SELECT * FROM channels WHERE id = ?", (channel_id,))
        return self._rows_to_channels([row])[0] if row else None

    def _require(self, channel_id: str) -> T.Channel:
        ch = self.get(channel_id)
        if ch is None:
            raise T.NotFound(f"channel {channel_id} does not exist", channel_id=channel_id)
        return ch

    def _folder_exists(self, folder_id: str) -> bool:
        return isinstance(folder_id, str) and (
            self.db.query_one("SELECT id FROM folders WHERE id = ?", (folder_id,)) is not None
        )

    def _require_folder(self, folder_id: str | None) -> None:
        if folder_id is not None and not self._folder_exists(folder_id):
            raise T.NotFound(f"folder {folder_id} does not exist", folder_id=folder_id)

    def _existing_tags(self, tag_ids: Sequence[str]) -> set[str]:
        ids = [t for t in dict.fromkeys(tag_ids) if isinstance(t, str)]
        if not ids:
            return set()
        rows = self.db.query(
            "SELECT id FROM tags WHERE id IN (SELECT value FROM json_each(?))", (_ids_json(ids),)
        )
        return {r["id"] for r in rows}

    def _require_tags(self, tag_ids: Sequence[str]) -> tuple[str, ...]:
        wanted = tuple(sorted(dict.fromkeys(tag_ids)))
        for t in wanted:
            if not isinstance(t, str) or not t:
                raise T.ValidationError(f"invalid tag: {t!r}", field="tag_ids")
        missing = set(wanted) - self._existing_tags(wanted)
        if missing:
            raise T.NotFound(f"tag {sorted(missing)[0]} does not exist", tag_ids=sorted(missing))
        return wanted

    def list(self, filter: T.ChannelFilter | None = None) -> list[T.Channel]:
        f = filter or T.ChannelFilter()
        if f.offset < 0 or (f.limit is not None and f.limit < 0):
            raise T.ValidationError("negative limit/offset")
        where: list[str] = []
        params: list[Any] = []
        if f.relations:
            values = [_relation(r).value for r in f.relations]
            where.append("relation IN (SELECT value FROM json_each(?))")
            params.append(_ids_json(values))
        if f.folder_id is not T.UNSET:
            if f.folder_id is None:
                where.append("folder_id IS NULL")
            elif f.recursive:
                where.append(
                    "folder_id IN (WITH RECURSIVE d(id) AS (SELECT ? UNION"
                    " SELECT f.id FROM folders f JOIN d ON f.parent_id = d.id) SELECT id FROM d)"
                )
                params.append(f.folder_id)
            else:
                where.append("folder_id = ?")
                params.append(f.folder_id)
        if f.tag_id is not None:
            where.append("id IN (SELECT channel_id FROM channel_tags WHERE tag_id = ?)")
            params.append(f.tag_id)
        if f.favorite is not None:
            where.append("favorite = ?")
            params.append(int(bool(f.favorite)))
        if f.muted is not None:
            where.append("muted = ?")
            params.append(int(bool(f.muted)))
        if f.source is not None:
            try:
                params.append(T.ChannelSource(f.source).value)
            except ValueError as exc:
                raise T.ValidationError(f"invalid source: {f.source!r}") from exc
            where.append("source = ?")
        if f.ids:
            where.append("id IN (SELECT value FROM json_each(?))")
            params.append(_ids_json(f.ids))
        sql = "SELECT * FROM channels" + (" WHERE " + " AND ".join(where) if where else "")
        channels = self._rows_to_channels(self.db.query(sql, params))
        if f.query:
            needle = dedup.normalize_name(f.query)
            channels = [
                c
                for c in channels
                if needle in dedup.normalize_name(c.title)
                or needle in dedup.normalize_name(c.handle or "")
            ]
        channels.sort(key=lambda c: _sort_key(c.title, c.id))
        end = None if f.limit is None else f.offset + f.limit
        return channels[f.offset : end]

    def count(self, filter: T.ChannelFilter | None = None) -> int:
        """Total for the filter, ignoring ``limit``/``offset`` (``GET /channels`` → ``total``)."""
        f = filter or T.ChannelFilter()
        return len(self.list(dataclasses.replace(f, limit=None, offset=0)))

    def find_duplicate(
        self,
        *,
        channel_id: str | None = None,
        handle: str | None = None,
        url: str | None = None,
        title: str | None = None,
    ) -> T.Channel | None:
        if isinstance(channel_id, str) and channel_id.strip():
            hit = self.get(channel_id.strip())
            if hit is not None:
                return hit
        keys = dedup.channel_match_keys(channel_id=channel_id, handle=handle, url=url, title=title)
        if not keys or keys[0].startswith("id:"):
            return None  # an id on both sides decides on its own (and the id was not found)
        found = _Index.load(self.db).find(keys)
        return self.get(found) if found else None

    # ------------------------------------------------------------------ write (primitives)

    def _set_fields(self, channel_id: str, values: Mapping[str, Any]) -> None:
        """``UPDATE`` of known columns only (a column name never comes from outside)."""
        if not values:
            return
        cols = [k for k in values if k in RESTORABLE and k != "tag_ids"]
        if len(cols) != len(values):
            raise ValueError(f"column not allowed: {sorted(set(values) - set(cols))}")
        params = [
            int(v) if isinstance(v, bool) else (v.value if isinstance(v, T.Relation) else v)
            for v in (values[c] for c in cols)
        ]
        self.db.execute(
            f"UPDATE channels SET {', '.join(f'{c} = ?' for c in cols)}, updated_at = ?"
            " WHERE id = ?",
            (*params, self._now(), channel_id),
        )

    def _take_handle(self, handle: str | None, channel_id: str) -> None:
        """The handle now belongs to *channel_id*: whoever had it before loses it (unique index)."""
        if not handle:
            return
        res = self.db.execute(
            "UPDATE channels SET handle = NULL, updated_at = ? WHERE handle = ? AND id <> ?",
            (self._now(), handle, channel_id),
        )
        if res.rowcount:
            log.info("handle %s changed owner to %s", handle, channel_id)

    def _write_tags(self, channel_id: str, tag_ids: Sequence[str]) -> None:
        self.db.execute("DELETE FROM channel_tags WHERE channel_id = ?", (channel_id,))
        rows = [(channel_id, t) for t in dict.fromkeys(tag_ids)]
        if rows:
            self.db.executemany("INSERT INTO channel_tags (channel_id, tag_id) VALUES (?, ?)", rows)

    def _write_relation(self, channel_id: str, relation: T.Relation, unsub_at: int | None) -> None:
        self._set_fields(channel_id, {"relation": relation.value, "unsubscribed_at": unsub_at})

    def _insert(
        self,
        *,
        channel_id: str,
        title: str,
        relation: T.Relation,
        source: T.ChannelSource,
        handle: str | None = None,
        thumb: str | None = None,
        url: str | None = None,
        folder_id: str | None = None,
        favorite: bool = False,
    ) -> None:
        now = self._now()
        handle = dedup.normalize_handle(handle) if handle else None
        self._take_handle(handle, channel_id)
        self.db.execute(
            "INSERT INTO channels (id, handle, title, thumb, url, relation, folder_id, favorite,"
            " muted, source, added_at, unsubscribed_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
            (
                channel_id,
                handle,
                (title or "").strip(),
                thumb or None,
                url or None,
                relation.value,
                folder_id,
                int(bool(favorite)),
                source.value,
                now,
                now if relation is T.Relation.ex else None,
                now,
            ),
        )

    @staticmethod
    def _can_move(current: T.Relation, target: T.Relation) -> bool:
        return current is target or target in T.RELATION_TRANSITIONS[current]

    def _group(self, label: str, enabled: bool = True) -> contextlib.AbstractContextManager[Any]:
        return self.changelog.group(label) if enabled else contextlib.nullcontext()

    # ------------------------------------------------------------------ add

    def add(
        self,
        url_or_handle: str,
        *,
        relation: T.Relation = T.Relation.followed,
        source: T.ChannelSource = T.ChannelSource.link,
        folder_id: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.Channel:
        relation = _relation(relation)
        if relation in (T.Relation.subscribed, T.Relation.ex):
            raise T.Conflict("only the extension subscribes; a channel added by link is followed")
        source = T.ChannelSource(source)
        actor = T.Actor(actor)
        if not isinstance(url_or_handle, str) or not url_or_handle.strip():
            raise T.ValidationError("provide a link, @handle or channel id")
        text = url_or_handle.strip()
        ref = dedup.parse_channel_ref(text)
        if ref is None:
            raise T.ValidationError(f"no channel recognised in {text!r}")
        self._require_folder(folder_id)

        existing: T.Channel | None = None
        if ref.kind == "id":
            existing = self.get(ref.value)
        elif ref.kind == "handle":
            existing = self.find_duplicate(handle=ref.value)
        elif ref.kind in ("custom", "user"):
            existing = self.find_duplicate(url=dedup.canonical_channel_url(text))

        info: T.ChannelInfo | None = None
        if existing is None:
            info = self._resolve(text)  # network: outside the transaction
            existing = self.find_duplicate(channel_id=info.id, handle=info.handle, url=info.url)
        target_id = existing.id if existing is not None else info.id  # type: ignore[union-attr]

        with self.db.transaction():
            current = self.get(target_id)  # re-read inside the transaction
            if current is not None:
                values: dict[str, Any] = {}
                if (
                    current.relation in (T.Relation.ignored, T.Relation.ex)
                    and current.relation is not relation
                    and relation in T.RELATION_TRANSITIONS[current.relation]
                ):
                    values["relation"] = relation.value
                    values["unsubscribed_at"] = _unsub_for(
                        relation, current.unsubscribed_at, self._now()
                    )
                if folder_id is not None and current.folder_id != folder_id:
                    values["folder_id"] = folder_id
                if not values:
                    return current
                before = {k: _plain(getattr(current, k)) for k in values}
                self._set_fields(current.id, values)
                self.changelog.record(
                    actor,
                    T.ChangeAction.channel_add,
                    {"label": current.title, "channel_id": current.id, "existing": True},
                    T.UndoChannelAdd(channel_id=current.id, before=before),
                )
            else:
                assert info is not None
                self._insert(
                    channel_id=info.id,
                    title=info.title,
                    relation=relation,
                    source=source,
                    handle=info.handle,
                    thumb=info.thumb,
                    url=info.url or dedup.canonical_channel_url(text),
                    folder_id=folder_id,
                )
                self.changelog.record(
                    actor,
                    T.ChangeAction.channel_add,
                    {"label": info.title, "channel_id": info.id},
                    T.UndoChannelAdd(channel_id=info.id, before=None),
                )
        return self._require(target_id)

    def _resolve(self, text: str) -> T.ChannelInfo:
        if self.youtube is None:
            raise T.YouTubeError("no YouTubeClient to resolve the channel")
        try:
            info = self.youtube.resolve_channel(text)
        except T.TubeError:
            raise
        except (
            Exception
        ) as exc:  # the client should never raise this; turn it into a readable error
            raise T.YouTubeError(f"could not resolve {text!r}: {exc}") from exc
        if info is None or not dedup.is_channel_id(getattr(info, "id", "")):
            raise T.YouTubeError(f"YouTube did not return a valid channel for {text!r}")
        return info

    # ------------------------------------------------------------------ upsert_many

    def upsert_many(
        self,
        channels: Sequence[T.ChannelIn],
        *,
        source: T.ChannelSource,
        relation: T.Relation | None = None,
        actor: T.Actor = T.Actor.extension,
    ) -> T.UpsertReport:
        source = T.ChannelSource(source)
        relation = _relation(relation) if relation is not None else None
        actor = T.Actor(actor)
        items = [c for c in channels if isinstance(c, T.ChannelIn)]

        # phase 1 — resolve over the network what has no id and no local duplicate (outside a
        # transaction)
        resolved: dict[int, str] = {}
        idx = _Index.load(self.db)
        for i, item in enumerate(items):
            if _clean_id(item.channel_id):
                continue
            keys = dedup.channel_match_keys(handle=item.handle, url=item.url, title=item.title)
            if idx.find(keys) or self.youtube is None:
                continue
            ref_text = item.handle or item.url
            if not ref_text:
                continue
            try:
                info = self.youtube.resolve_channel(ref_text)
            except Exception as exc:  # one bad item never breaks the batch
                log.info("could not resolve %r: %s", ref_text, exc)
                continue
            if info is not None and dedup.is_channel_id(getattr(info, "id", "")):
                resolved[i] = info.id

        # phase 2 — write everything in one transaction
        inserted: list[str] = []
        updated: list[str] = []
        duplicates: dict[str, str] = {}
        unresolved: list[str] = []
        user = actor is T.Actor.user
        with self._group("upsert", user), self.db.transaction():
            idx = _Index.load(self.db)
            folders = {r["id"] for r in self.db.query("SELECT id FROM folders")}
            tags = {r["id"] for r in self.db.query("SELECT id FROM tags")}
            for i, item in enumerate(items):
                cid_in = _clean_id(item.channel_id)
                keys = dedup.channel_match_keys(
                    channel_id=cid_in, handle=item.handle, url=item.url, title=item.title
                )
                existing_id = idx.find(keys)
                target = cid_in or resolved.get(i)
                if existing_id is None and target and idx.has(target):
                    existing_id = target
                if existing_id is not None:
                    if item.channel_id != existing_id:
                        duplicates[(keys or (existing_id,))[0]] = existing_id
                    if self._merge_existing(existing_id, item, relation, actor, folders, tags):
                        if existing_id not in updated and existing_id not in inserted:
                            updated.append(existing_id)
                    ch = self.get(existing_id)
                    if ch is not None:
                        idx.put(ch.id, handle=ch.handle, url=ch.url, title=ch.title)
                    continue
                if not target:
                    unresolved.append(item.title or item.handle or item.url or "?")
                    continue
                new_rel = relation or T.Relation.followed
                self._insert(
                    channel_id=target,
                    title=item.title,
                    relation=new_rel,
                    source=source,
                    handle=item.handle,
                    thumb=item.thumb,
                    url=item.url,
                    folder_id=item.folder_id if item.folder_id in folders else None,
                    favorite=bool(item.favorite),
                )
                good_tags = [t for t in item.tag_ids if t in tags]
                if good_tags:
                    self._write_tags(target, good_tags)
                inserted.append(target)
                idx.put(target, handle=item.handle, url=item.url, title=item.title)
                if user:
                    self.changelog.record(
                        actor,
                        T.ChangeAction.channel_add,
                        {"label": item.title, "channel_id": target},
                        T.UndoChannelAdd(channel_id=target, before=None),
                    )
        return T.UpsertReport(
            inserted=tuple(inserted),
            updated=tuple(updated),
            duplicates=duplicates,
            unresolved=tuple(unresolved),
        )

    def _merge_existing(
        self,
        channel_id: str,
        item: T.ChannelIn,
        relation: T.Relation | None,
        actor: T.Actor,
        folders: set[str],
        tags: set[str],
    ) -> bool:
        """Updates an existing channel from *item*; returns whether anything changed.

        Title/thumb/handle/url: whatever is filled in and different. Folder and tags: only filled
        in when the channel has none yet (never replaces the user's choice). ⭐: never. Relation:
        only when requested and the transition is valid."""
        ch = self.get(channel_id)
        if ch is None:  # pragma: no cover - it just came out of the index
            return False
        values: dict[str, Any] = {}
        title = (item.title or "").strip()
        if title and title != ch.title:
            values["title"] = title
        if item.thumb and item.thumb != ch.thumb:
            values["thumb"] = item.thumb
        handle = dedup.normalize_handle(item.handle) if item.handle else None
        if handle and handle != ch.handle:
            values["handle"] = handle
        if item.url and item.url != ch.url:
            values["url"] = item.url
        if ch.folder_id is None and item.folder_id and item.folder_id in folders:
            values["folder_id"] = item.folder_id
        if (
            relation is not None
            and ch.relation is not relation
            and self._can_move(ch.relation, relation)
        ):
            values["relation"] = relation.value
            values["unsubscribed_at"] = _unsub_for(relation, ch.unsubscribed_at, self._now())
        new_tags = [t for t in dict.fromkeys(item.tag_ids) if t in tags] if not ch.tag_ids else []
        if not values and not new_tags:
            return False
        before = {k: _plain(getattr(ch, k)) for k in values}
        if "handle" in values:
            self._take_handle(values["handle"], ch.id)
        self._set_fields(ch.id, values)
        if new_tags:
            before["tag_ids"] = list(ch.tag_ids)
            self._write_tags(ch.id, new_tags)
        if actor is T.Actor.user:
            self.changelog.record(
                actor,
                T.ChangeAction.channel_add,
                {"label": ch.title, "channel_id": ch.id, "existing": True},
                T.UndoChannelAdd(channel_id=ch.id, before=before),
            )
        return True

    # ------------------------------------------------------------------ edit

    def _validated_patch(self, current: T.Channel, patch: T.ChannelPatch) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for f in dataclasses.fields(patch):
            value = getattr(patch, f.name)
            if value is T.UNSET:
                continue
            if f.name == "title":
                if not isinstance(value, str) or not value.strip():
                    raise T.ValidationError("empty title", field="title")
                value = value.strip()
            elif f.name == "handle":
                if value is not None:
                    norm = dedup.normalize_handle(value) if isinstance(value, str) else None
                    if norm is None:
                        raise T.ValidationError("invalid handle", field="handle")
                    value = norm
                    other = self.db.query_one(
                        "SELECT id FROM channels WHERE handle = ? AND id <> ?", (value, current.id)
                    )
                    if other is not None:
                        raise T.Conflict(
                            f"handle {value} already belongs to another channel", field="handle"
                        )
            elif f.name in _BOOL_COLUMNS:
                if not isinstance(value, bool):
                    raise T.ValidationError(f"{f.name} must be true/false", field=f.name)
            elif f.name == "folder_id":
                if value is not None:
                    if not isinstance(value, str):
                        raise T.ValidationError("invalid folder", field="folder_id")
                    self._require_folder(value)
            elif f.name in _TEXT_OR_NONE:
                if value is not None and not isinstance(value, str):
                    raise T.ValidationError(f"{f.name} must be text", field=f.name)
            if getattr(current, f.name) != value:
                values[f.name] = value
        return values

    def update(
        self, channel_id: str, patch: T.ChannelPatch, *, actor: T.Actor = T.Actor.user
    ) -> T.Channel:
        actor = T.Actor(actor)
        current = self._require(channel_id)
        values = self._validated_patch(current, patch)
        if not values:
            return current
        before = {k: _plain(getattr(current, k)) for k in values}
        with self.db.transaction():
            self._set_fields(channel_id, values)
            self.changelog.record(
                actor,
                T.ChangeAction.channel_update,
                {"label": current.title, "fields": sorted(values)},
                T.UndoChannelUpdate(channel_id=channel_id, before=before),
            )
        return self._require(channel_id)

    def set_relation(
        self,
        channel_id: str,
        relation: T.Relation,
        *,
        actor: T.Actor = T.Actor.user,
        reason: str | None = None,
    ) -> T.Channel:
        relation = _relation(relation)
        actor = T.Actor(actor)
        current = self._require(channel_id)
        if current.relation is relation:
            return current
        if relation not in T.RELATION_TRANSITIONS[current.relation]:
            raise T.Conflict(
                f"transition {current.relation.value} → {relation.value} not allowed",
                current=current.relation.value,
                target=relation.value,
            )
        with self.db.transaction():
            self._write_relation(
                channel_id, relation, _unsub_for(relation, current.unsubscribed_at, self._now())
            )
            self.changelog.record(
                actor,
                T.ChangeAction.channel_relation,
                {
                    "label": current.title,
                    "from": current.relation.value,
                    "to": relation.value,
                    "reason": reason,
                },
                T.UndoChannelRelation(
                    channel_id=channel_id,
                    before=current.relation.value,
                    before_unsubscribed_at=current.unsubscribed_at,
                ),
            )
        return self._require(channel_id)

    def move(
        self, channel_ids: Sequence[str], folder_id: str | None, *, actor: T.Actor = T.Actor.user
    ) -> int:
        actor = T.Actor(actor)
        self._require_folder(folder_id)
        before: dict[str, str | None] = {}
        for cid in dict.fromkeys(channel_ids):
            ch = self._require(cid)
            if ch.folder_id != folder_id:
                before[cid] = ch.folder_id
        if not before:
            return 0
        with self.db.transaction():
            for cid in before:
                self._set_fields(cid, {"folder_id": folder_id})
            self.changelog.record(
                actor,
                T.ChangeAction.channel_move,
                {"count": len(before), "folder_id": folder_id},
                T.UndoChannelMove(before=before),
            )
        return len(before)

    def set_tags(
        self, channel_id: str, tag_ids: Sequence[str], *, actor: T.Actor = T.Actor.user
    ) -> T.Channel:
        actor = T.Actor(actor)
        current = self._require(channel_id)
        new = self._require_tags(tag_ids)
        if new == current.tag_ids:
            return current
        with self.db.transaction():
            self._write_tags(channel_id, new)
            self.changelog.record(
                actor,
                T.ChangeAction.channel_tags,
                {"label": current.title, "tags": list(new)},
                T.UndoChannelTags(before={channel_id: current.tag_ids}),
            )
        return self._require(channel_id)

    def apply_patch(
        self,
        channel_id: str,
        patch: T.ChannelPatch,
        *,
        tag_ids: Sequence[str] | None = None,
        relation: T.Relation | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.Channel:
        """``PATCH /channels/{id}``: ``update`` + ``set_tags`` + ``set_relation`` in one transaction
        and one history group (a single undo). *relation* only ``followed|ignored``."""
        rel = _relation(relation) if relation is not None else None
        if rel is not None and rel not in PATCH_RELATIONS:
            raise T.ValidationError(
                "from Manage the relation can only become follow/ignore", field="relation"
            )
        current = self._require(channel_id)
        if rel is not None and not self._can_move(current.relation, rel):
            raise T.Conflict(
                f"transition {current.relation.value} → {rel.value} not allowed",
                current=current.relation.value,
                target=rel.value,
            )
        with self.changelog.group("patch"), self.db.transaction():
            self.update(channel_id, patch, actor=actor)
            if tag_ids is not None:
                self.set_tags(channel_id, tag_ids, actor=actor)
            if rel is not None:
                self.set_relation(channel_id, rel, actor=actor)
        return self._require(channel_id)

    # ------------------------------------------------------------------ batch

    def batch(
        self,
        op: T.BatchOp,
        channel_ids: Sequence[str],
        *,
        value: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.BatchResult:
        try:
            op = T.BatchOp(op)
        except ValueError as exc:
            raise T.ValidationError(f"invalid batch operation: {op!r}", field="op") from exc
        actor = T.Actor(actor)
        if op in (T.BatchOp.tag, T.BatchOp.untag):
            if not isinstance(value, str) or not value:
                raise T.ValidationError("provide the tag", field="value")
            self._require_tags([value])
        elif op is T.BatchOp.move:
            if value is not None and not isinstance(value, str):
                raise T.ValidationError("invalid folder", field="value")
            self._require_folder(value)
        current = {cid: self._require(cid) for cid in dict.fromkeys(channel_ids)}
        if not current:
            return T.BatchResult()
        changed: list[str] = []
        skipped: list[str] = []
        before: dict[str, dict[str, Any]] = {}
        change_id: int | None = None
        now = self._now()
        with self.db.transaction():
            for cid, ch in current.items():
                values: dict[str, Any] = {}
                new_tags: tuple[str, ...] | None = None
                if op is T.BatchOp.favorite and not ch.favorite:
                    values["favorite"] = True
                elif op is T.BatchOp.unfavorite and ch.favorite:
                    values["favorite"] = False
                elif op is T.BatchOp.mute and not ch.muted:
                    values["muted"] = True
                elif op is T.BatchOp.unmute and ch.muted:
                    values["muted"] = False
                elif op is T.BatchOp.move and ch.folder_id != value:
                    values["folder_id"] = value
                elif op is T.BatchOp.tag and value not in ch.tag_ids:
                    new_tags = (*ch.tag_ids, str(value))
                elif op is T.BatchOp.untag and value in ch.tag_ids:
                    new_tags = tuple(t for t in ch.tag_ids if t != value)
                elif op in (T.BatchOp.follow, T.BatchOp.ignore):
                    target = T.Relation.followed if op is T.BatchOp.follow else T.Relation.ignored
                    if ch.relation is not target and target in T.RELATION_TRANSITIONS[ch.relation]:
                        values["relation"] = target.value
                        values["unsubscribed_at"] = _unsub_for(target, ch.unsubscribed_at, now)
                if not values and new_tags is None:
                    skipped.append(cid)
                    continue
                snap: dict[str, Any] = {k: _plain(getattr(ch, k)) for k in values}
                self._set_fields(cid, values)
                if new_tags is not None:
                    snap["tag_ids"] = list(ch.tag_ids)
                    self._write_tags(cid, new_tags)
                before[cid] = snap
                changed.append(cid)
            if changed:
                rec = self.changelog.record(
                    actor,
                    T.ChangeAction.channel_batch,
                    {"op": op.value, "count": len(changed), "value": value},
                    T.UndoChannelBatch(before=before),
                )
                change_id = rec.id
        return T.BatchResult(changed=tuple(changed), skipped=tuple(skipped), change_id=change_id)

    # ------------------------------------------------------------------ no history

    def update_stats(self, stats: Sequence[T.ChannelStats]) -> int:
        """Writes whatever is valid; unknown channels and bad items are ignored (never raises
        because of one item). Returns how many channels changed."""
        count = 0
        with self.db.transaction():
            for s in stats or ():
                try:
                    values = _stats_values(s)
                    if not values:
                        continue
                    with (
                        self.db.transaction()
                    ):  # SAVEPOINT: one bad item does not take the others down
                        res = self.db.execute(
                            f"UPDATE channels SET {', '.join(f'{k} = ?' for k in values)},"
                            " updated_at = ? WHERE id = ?",
                            (*values.values(), self._now(), s.channel_id),
                        )
                    if res.rowcount:
                        count += 1
                except Exception:  # noqa: BLE001 - contract: never raise because of one item
                    log.warning("update_stats skipped %r", s, exc_info=True)
        return count

    def remove_by_source(self, source: T.ChannelSource) -> int:
        """Only ``followed``/``ignored``: anything that went through a subscription
        (``subscribed``/``ex``) stays."""
        source = T.ChannelSource(source)
        with self.db.transaction():
            res = self.db.execute(
                "DELETE FROM channels WHERE source = ? AND relation IN ('followed', 'ignored')",
                (source.value,),
            )
        return res.rowcount

    # ------------------------------------------------------------------ undo

    def apply_undo(self, change: T.ChangeRecord) -> None:
        if T.CHANGE_ACTION_OWNER.get(change.action) != "channels":
            raise T.UndoRefused("not_undoable", f"channels cannot undo {change.action}")
        u = change.undo
        if isinstance(u, T.UndoChannelAdd):
            if u.before is None:
                self._undo_insert(u.channel_id)
            else:
                self._restore(u.channel_id, u.before)
        elif isinstance(u, T.UndoChannelUpdate):
            self._restore(u.channel_id, u.before)
        elif isinstance(u, T.UndoChannelRelation):
            self._undo_relation(change, u)
        elif isinstance(u, T.UndoChannelMove):
            for cid, folder_id in u.before.items():
                self._restore(cid, {"folder_id": folder_id})
        elif isinstance(u, T.UndoChannelTags):
            for cid, tag_ids in u.before.items():
                self._restore(cid, {"tag_ids": list(tag_ids)})
        elif isinstance(u, T.UndoChannelBatch):
            for cid, snap in u.before.items():
                self._restore(cid, snap)
        else:
            raise T.UndoRefused("not_undoable", f"channels cannot undo {change.action}")

    def _undo_insert(self, channel_id: str) -> None:
        ch = self.get(channel_id)
        if ch is None:
            return
        if ch.relation in (T.Relation.subscribed, T.Relation.ex):
            raise T.UndoRefused(
                "not_undoable",
                "the extension has since subscribed to the channel; the add cannot be undone",
                channel_id=channel_id,
            )
        self.db.execute("DELETE FROM channels WHERE id = ?", (channel_id,))

    def _undo_relation(self, change: T.ChangeRecord, u: T.UndoChannelRelation) -> None:
        ch = self.get(u.channel_id)
        if ch is None:
            return
        target = change.payload.get("to") if isinstance(change.payload, Mapping) else None
        if target and ch.relation.value != target:
            raise T.UndoRefused(
                "not_undoable",
                f"the relation changed since ({target} → {ch.relation.value})",
                channel_id=u.channel_id,
            )
        before = _relation(u.before)
        executed = self._executed_by_queue(change, before, ch.relation)
        if executed:
            raise T.UndoRefused(
                "already_executed",
                "already executed — use Resubscribe in Cleanup → Ex-subscriptions",
                channel_id=u.channel_id,
            )
        self._write_relation(u.channel_id, before, u.before_unsubscribed_at)

    def _executed_by_queue(
        self, change: T.ChangeRecord, before: T.Relation, after: T.Relation
    ) -> bool:
        """The relation change came from a queue item already executed (read from ``unsub_queue``,
        owned by the cleanup queue): undoing it here would lie about YouTube."""
        if change.actor is not T.Actor.extension:
            return False
        if before is T.Relation.subscribed and after is T.Relation.ex:
            action = T.QueueAction.unsubscribe
        elif before is T.Relation.ex and after is T.Relation.subscribed:
            action = T.QueueAction.resubscribe
        else:
            return False
        row = self.db.query_one(
            "SELECT 1 AS x FROM unsub_queue WHERE channel_id = ? AND action = ?"
            " AND status IN ('running', 'done') AND approved_at <= ? LIMIT 1",
            (change.undo.channel_id, action.value, change.ts),  # type: ignore[attr-defined]
        )
        return row is not None

    def _restore(self, channel_id: str, snapshot: Mapping[str, Any]) -> None:
        """Restores a channel's fields from a ``before`` snapshot (``RESTORABLE`` keys only)."""
        if self.get(channel_id) is None:
            return  # channel deleted since: nothing to restore
        snap = {k: v for k, v in dict(snapshot).items() if k in RESTORABLE}
        ignored = set(snapshot) - set(snap)
        if ignored:
            log.warning("undo of %s ignored keys %s", channel_id, sorted(ignored))
        tags = snap.pop("tag_ids", None)
        if "relation" in snap:
            snap["relation"] = _relation(snap["relation"]).value
        if snap.get("folder_id") is not None and not self._folder_exists(snap["folder_id"]):
            snap["folder_id"] = None  # the folder no longer exists: no folder
        if snap.get("handle"):
            self._take_handle(snap["handle"], channel_id)
        self._set_fields(channel_id, snap)
        if tags is not None:
            existing = self._existing_tags(list(tags))
            self._write_tags(channel_id, [t for t in tags if t in existing])


# --------------------------------------------------------------------------- module functions


def _plain(value: Any) -> Any:
    if isinstance(value, T.Relation):
        return value.value
    if isinstance(value, tuple):
        return list(value)
    return value


def _clean_id(value: Any) -> str | None:
    if isinstance(value, str) and dedup.is_channel_id(value.strip()):
        return value.strip()
    return None


def _stats_values(s: Any) -> dict[str, Any]:
    if not isinstance(s, T.ChannelStats) or not isinstance(s.channel_id, str):
        raise TypeError("item is not a ChannelStats")
    out: dict[str, Any] = {}
    last = s.last_video_at
    if isinstance(last, int) and not isinstance(last, bool) and last >= 0:
        out["last_video_at"] = last
    vpw = s.videos_per_week
    if isinstance(vpw, int | float) and not isinstance(vpw, bool):
        if math.isfinite(vpw) and vpw >= 0:
            out["videos_per_week"] = float(vpw)
    ratio = s.shorts_ratio
    if isinstance(ratio, int | float) and not isinstance(ratio, bool) and math.isfinite(ratio):
        out["shorts_ratio"] = min(1.0, max(0.0, float(ratio)))
    if isinstance(s.title, str) and s.title.strip():
        out["title"] = s.title.strip()
    if isinstance(s.thumb, str) and s.thumb.strip():
        out["thumb"] = s.thumb.strip()
    return out


def batch_or_propose(
    channels: T.ChannelService,
    cleanup: T.Cleanup | None,
    op: str,
    channel_ids: Sequence[str],
    *,
    value: str | None = None,
    reason: str | None = None,
    actor: T.Actor = T.Actor.user,
) -> BatchOutcome:
    """Body of ``POST /channels/batch``: ``op`` = ``BatchOp`` → ``ChannelService.batch``;
    ``op = "unsubscribe"`` → **only** ``Cleanup.propose`` (manual cleanup candidates; never a queue
    item, never an approval)."""
    if op == UNSUBSCRIBE_OP:
        if cleanup is None:
            raise T.ValidationError("cleanup is unavailable to propose an unsubscribe", field="op")
        proposed = cleanup.propose(list(channel_ids), reason=reason, actor=actor)
        return BatchOutcome(batch=None, proposed=tuple(proposed))
    return BatchOutcome(batch=channels.batch(op, channel_ids, value=value, actor=actor))


_TRUE = frozenset({"1", "true", "yes", "on", "sim"})
_FALSE = frozenset({"0", "false", "no", "off", "nao", "não"})


def _flag(query: Mapping[str, Any], key: str) -> bool | None:
    raw = query.get(key)
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    raise T.ValidationError(f"{key} must be true/false", field=key)


def _int(query: Mapping[str, Any], key: str, minimum: int) -> int | None:
    raw = query.get(key)
    if raw is None or raw == "":
        return None
    try:
        value = int(str(raw).strip())
    except ValueError as exc:
        raise T.ValidationError(f"{key} must be an integer", field=key) from exc
    if value < minimum:
        raise T.ValidationError(f"{key} must be ≥ {minimum}", field=key)
    return value


def _csv(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list | tuple):
        parts = [str(p) for p in raw]
    else:
        parts = str(raw).split(",")
    return [p.strip() for p in parts if p.strip()]


def parse_filter(query: Mapping[str, Any]) -> T.ChannelFilter:
    """``GET /channels`` query (api.yaml) → ``ChannelFilter``; invalid value →
    ``ValidationError``. ``folder=none`` = no folder."""
    relations = tuple(_relation(r) for r in _csv(query.get("relation")))
    folder: Any = T.UNSET
    raw_folder = query.get("folder")
    if raw_folder not in (None, ""):
        folder = None if str(raw_folder).strip().lower() == "none" else str(raw_folder).strip()
    source = query.get("source")
    if source not in (None, ""):
        try:
            source = T.ChannelSource(str(source))
        except ValueError as exc:
            raise T.ValidationError(f"invalid source: {source!r}", field="source") from exc
    else:
        source = None
    recursive = _flag(query, "recursive")
    q = query.get("q")
    tag = query.get("tag")
    return T.ChannelFilter(
        relations=relations,
        folder_id=folder,
        recursive=True if recursive is None else recursive,
        tag_id=str(tag).strip() if tag not in (None, "") else None,
        favorite=_flag(query, "favorite"),
        muted=_flag(query, "muted"),
        source=source,
        query=str(q).strip() if q not in (None, "") and str(q).strip() else None,
        ids=tuple(_csv(query.get("ids"))),
        limit=_int(query, "limit", 1),
        offset=_int(query, "offset", 0) or 0,
    )


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    youtube: T.YouTubeClient,
    changelog: T.ChangeLog,
    clock: T.Clock | None = None,
) -> T.ChannelService:
    """``ChannelService`` over *db*. No network, no thread (network only in ``add`` and in
    ``upsert_many`` for items without an id, always outside a transaction)."""
    return ChannelService(
        db=db, settings=settings, youtube=youtube, changelog=changelog, clock=clock
    )


__all__ = [
    "PATCH_FIELDS",
    "PATCH_RELATIONS",
    "RESTORABLE",
    "UNSUBSCRIBE_OP",
    "BatchOutcome",
    "ChannelService",
    "batch_or_propose",
    "build",
    "parse_filter",
]
