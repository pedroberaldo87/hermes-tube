"""Fakes of the CRUD services, writing into the **same tables** as the real owner (over any ``Db``).

So ``seed_world`` produces rows in the contract format and a real implementation from another
module (e.g. the ``FeedEngine``) reads the same database. Rules from the ``tube_pkg.core.types``
docstrings are followed where the invariants and the consumers depend on them;
simplifications are marked with "fake:".

Undo patterns used here (recommended to the real implementations):

- compound action = several ``record`` calls inside ``ChangeLog.group``; each owner undoes only its
  part (e.g. ``delete_folder`` = ``channel_move`` + ``folder_delete``; ``delete_tag`` =
  ``channel_tags`` + ``tag_delete``);
- ``apply_undo`` writes directly into the owner's own table and **never** calls ``record``
  (``FakeChangeLog`` fails the test if that happens).
"""

from __future__ import annotations

import contextvars
import itertools
import json
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import fields
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import types as T

from .infra import FakeClock, json_text


class IdGen:
    """Deterministic opaque ids: ``next("f")`` → ``"f-1"``, ``"f-2"``…"""

    def __init__(self) -> None:
        self._counters: dict[str, Iterator[int]] = {}

    def next(self, prefix: str) -> str:
        counter = self._counters.setdefault(prefix, itertools.count(1))
        return f"{prefix}-{next(counter)}"


class _SqlFake:
    def __init__(self, db: T.Db, *, clock: T.Clock | None = None, ids: IdGen | None = None):
        self.db = db
        self.clock = clock or FakeClock()
        self.ids = ids or IdGen()

    def _now(self) -> int:
        return self.clock.now()


def _placeholders(values: Sequence[Any]) -> str:
    return ",".join("?" for _ in values)


# --------------------------------------------------------------------------- ChangeLog

_GROUP: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "fake_change_group", default=None
)
_UNDOING: contextvars.ContextVar[bool] = contextvars.ContextVar("fake_undoing", default=False)


def _change_from_row(row: Mapping[str, Any]) -> T.ChangeRecord:
    action = T.ChangeAction(row["action"])
    return T.ChangeRecord(
        id=int(row["id"]),
        ts=int(row["ts"]),
        actor=T.Actor(row["actor"]),
        action=action,
        payload=json.loads(row["payload"] or "{}"),
        undo=T.undo_from_dict(action, json.loads(row["undo"] or "{}")),
        group_id=row["group_id"],
        undone_at=row["undone_at"],
    )


class FakeChangeLog(_SqlFake):
    """``ChangeLog`` over the ``changes`` table; ``group`` through ``contextvars``."""

    def record(
        self,
        actor: T.Actor,
        action: T.ChangeAction,
        payload: Mapping[str, Any],
        undo: T.UndoData,
    ) -> T.ChangeRecord:
        if _UNDOING.get():
            raise AssertionError(
                f"apply_undo must not write history (tried {action}); write directly into the "
                "owner's own table"
            )
        action = T.ChangeAction(action)
        expected = T.UNDO_TYPES[action]
        if type(undo) is not expected:
            raise T.ValidationError(f"{action}: undo deve ser {expected.__name__}")
        res = self.db.execute(
            "INSERT INTO changes (ts, actor, action, group_id, payload, undo)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                self._now(),
                T.Actor(actor).value,
                action.value,
                _GROUP.get(),
                json_text(payload),
                json_text(T.undo_to_dict(undo)),
            ),
        )
        rec = self.get(int(res.lastrowid or 0))
        assert rec is not None
        return rec

    @contextmanager
    def group(self, label: str) -> Iterator[str]:
        current = _GROUP.get()
        if current is not None:
            yield current
            return
        gid = self.ids.next("g")
        token = _GROUP.set(gid)
        try:
            yield gid
        finally:
            _GROUP.reset(token)

    def list(self, *, limit: int = 50, before_id: int | None = None) -> list[T.ChangeRecord]:
        if before_id is None:
            rows = self.db.query("SELECT * FROM changes ORDER BY id DESC LIMIT ?", (limit,))
        else:
            rows = self.db.query(
                "SELECT * FROM changes WHERE id < ? ORDER BY id DESC LIMIT ?", (before_id, limit)
            )
        return [_change_from_row(r) for r in rows]

    def get(self, change_id: int) -> T.ChangeRecord | None:
        row = self.db.query_one("SELECT * FROM changes WHERE id = ?", (change_id,))
        return _change_from_row(row) if row else None

    def undo(
        self, change_id: int, *, targets: T.UndoTargets, actor: T.Actor = T.Actor.user
    ) -> list[T.ChangeRecord]:
        rec = self.get(change_id)
        if rec is None:
            raise T.NotFound(f"history entry {change_id} does not exist")
        if rec.undone_at is not None:
            raise T.UndoRefused("already_undone")
        if rec.group_id:
            rows = self.db.query(
                "SELECT * FROM changes WHERE group_id = ? AND undone_at IS NULL ORDER BY id DESC",
                (rec.group_id,),
            )
            entries = [_change_from_row(r) for r in rows]
        else:
            entries = [rec]
        token = _UNDOING.set(True)
        try:
            with self.db.transaction():
                for entry in entries:
                    if isinstance(entry.undo, T.UndoNotSupported):
                        raise T.UndoRefused("not_undoable")
                    owner = getattr(targets, T.CHANGE_ACTION_OWNER[entry.action], None)
                    if owner is None:
                        raise T.UndoRefused("not_undoable", f"sem dono para {entry.action}")
                    owner.apply_undo(entry)
                    self.db.execute(
                        "UPDATE changes SET undone_at = ? WHERE id = ?", (self._now(), entry.id)
                    )
        finally:
            _UNDOING.reset(token)
        return [r for e in entries if (r := self.get(e.id)) is not None]


# --------------------------------------------------------------------------- ChannelService

_CHANNEL_FIELDS = ("title", "handle", "thumb", "url", "folder_id", "favorite", "muted", "ai_note")
_ACTIVE = (T.Relation.subscribed.value, T.Relation.followed.value)


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


def _folder_descendants(db: T.Db, folder_id: str) -> list[str]:
    rows = db.query(
        "WITH RECURSIVE d(id) AS (SELECT ? UNION SELECT f.id FROM folders f JOIN d"
        " ON f.parent_id = d.id) SELECT id FROM d",
        (folder_id,),
    )
    return [r["id"] for r in rows]


class FakeChannelService(_SqlFake):
    """``ChannelService`` over ``channels``/``channel_tags``."""

    def __init__(
        self,
        db: T.Db,
        *,
        changelog: T.ChangeLog,
        youtube: T.YouTubeClient | None = None,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.changelog = changelog
        self.youtube = youtube

    # ------------------------------------------------------------------ reading

    def _tags_of(self, ids: Sequence[str]) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {i: [] for i in ids}
        if not ids:
            return out
        rows = self.db.query(
            "SELECT channel_id, tag_id FROM channel_tags"
            f" WHERE channel_id IN ({_placeholders(ids)})",
            tuple(ids),
        )
        for r in rows:
            out.setdefault(r["channel_id"], []).append(r["tag_id"])
        return out

    def _rows_to_channels(self, rows: Sequence[Mapping[str, Any]]) -> list[T.Channel]:
        tags = self._tags_of([r["id"] for r in rows])
        return [_channel_from_row(r, tags.get(r["id"], [])) for r in rows]

    def get(self, channel_id: str) -> T.Channel | None:
        row = self.db.query_one("SELECT * FROM channels WHERE id = ?", (channel_id,))
        return self._rows_to_channels([row])[0] if row else None

    def _require(self, channel_id: str) -> T.Channel:
        ch = self.get(channel_id)
        if ch is None:
            raise T.NotFound(f"channel {channel_id} does not exist", channel_id=channel_id)
        return ch

    def list(self, filter: T.ChannelFilter | None = None) -> list[T.Channel]:
        f = filter or T.ChannelFilter()
        where: list[str] = []
        params: list[Any] = []
        if f.relations:
            where.append(f"relation IN ({_placeholders(f.relations)})")
            params += [T.Relation(r).value for r in f.relations]
        if f.folder_id is not T.UNSET:
            if f.folder_id is None:
                where.append("folder_id IS NULL")
            else:
                folders = (
                    _folder_descendants(self.db, f.folder_id) if f.recursive else [f.folder_id]
                )
                where.append(f"folder_id IN ({_placeholders(folders)})")
                params += folders
        if f.tag_id is not None:
            where.append("id IN (SELECT channel_id FROM channel_tags WHERE tag_id = ?)")
            params.append(f.tag_id)
        if f.favorite is not None:
            where.append("favorite = ?")
            params.append(int(f.favorite))
        if f.muted is not None:
            where.append("muted = ?")
            params.append(int(f.muted))
        if f.source is not None:
            where.append("source = ?")
            params.append(T.ChannelSource(f.source).value)
        if f.ids:
            where.append(f"id IN ({_placeholders(f.ids)})")
            params += list(f.ids)
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
        channels.sort(key=lambda c: (dedup.normalize_name(c.title), c.id))
        end = None if f.limit is None else f.offset + f.limit
        return channels[f.offset : end]

    def find_duplicate(
        self,
        *,
        channel_id: str | None = None,
        handle: str | None = None,
        url: str | None = None,
        title: str | None = None,
    ) -> T.Channel | None:
        if channel_id:
            hit = self.get(channel_id)
            if hit is not None:
                return hit
        keys = dedup.channel_match_keys(channel_id=channel_id, handle=handle, url=url, title=title)
        if not keys:
            return None
        for ch in self.list():
            other = dedup.channel_match_keys(
                channel_id=ch.id, handle=ch.handle, url=ch.url, title=ch.title
            )
            if dedup.same_channel(keys, other):
                return ch
        return None

    # ------------------------------------------------------------------ writing

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
        self.db.execute(
            "INSERT INTO channels (id, handle, title, thumb, url, relation, folder_id, favorite,"
            " muted, source, added_at, unsubscribed_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
            (
                channel_id,
                dedup.normalize_handle(handle) if handle else None,
                title or "",
                thumb,
                url,
                T.Relation(relation).value,
                folder_id,
                int(bool(favorite)),
                T.ChannelSource(source).value,
                now,
                now if relation is T.Relation.ex else None,
                now,
            ),
        )

    def _write_relation(self, channel_id: str, relation: T.Relation, unsub_at: int | None) -> None:
        self.db.execute(
            "UPDATE channels SET relation = ?, unsubscribed_at = ?, updated_at = ? WHERE id = ?",
            (T.Relation(relation).value, unsub_at, self._now(), channel_id),
        )

    def _write_tags(self, channel_id: str, tag_ids: Sequence[str]) -> None:
        self.db.execute("DELETE FROM channel_tags WHERE channel_id = ?", (channel_id,))
        self.db.executemany(
            "INSERT INTO channel_tags (channel_id, tag_id) VALUES (?, ?)",
            [(channel_id, t) for t in dict.fromkeys(tag_ids)],
        )

    def _set_fields(self, channel_id: str, values: Mapping[str, Any]) -> None:
        if not values:
            return
        cols = ", ".join(f"{k} = ?" for k in values)
        params = [int(v) if isinstance(v, bool) else v for v in values.values()]
        self.db.execute(
            f"UPDATE channels SET {cols}, updated_at = ? WHERE id = ?",
            (*params, self._now(), channel_id),
        )

    @staticmethod
    def _can_move(current: T.Relation, target: T.Relation) -> bool:
        return current is target or target in T.RELATION_TRANSITIONS[current]

    def add(
        self,
        url_or_handle: str,
        *,
        relation: T.Relation = T.Relation.followed,
        source: T.ChannelSource = T.ChannelSource.link,
        folder_id: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.Channel:
        if T.Relation(relation) is T.Relation.subscribed:
            raise T.Conflict("only the extension subscribes; a link makes the channel followed")
        ref = dedup.parse_channel_ref(url_or_handle)
        if ref is None:
            raise T.ValidationError(f"no channel recognized in {url_or_handle!r}")
        existing = None
        if ref.kind == "id":
            existing = self.get(ref.value)
        elif ref.kind == "handle":
            existing = self.find_duplicate(handle=ref.value)
        if existing is None:
            if self.youtube is None:
                raise T.YouTubeError("sem YouTubeClient para resolver o canal")
            info = self.youtube.resolve_channel(url_or_handle)
            existing = self.find_duplicate(channel_id=info.id, handle=info.handle, url=info.url)
        else:
            info = None
        if existing is not None:
            if existing.relation in (T.Relation.ignored, T.Relation.ex) and self._can_move(
                existing.relation, relation
            ):
                return self.set_relation(existing.id, relation, actor=actor)
            return existing
        assert info is not None
        with self.db.transaction():
            self._insert(
                channel_id=info.id,
                title=info.title,
                relation=T.Relation(relation),
                source=T.ChannelSource(source),
                handle=info.handle,
                thumb=info.thumb,
                url=info.url,
                folder_id=folder_id,
            )
            self.changelog.record(
                actor,
                T.ChangeAction.channel_add,
                {"label": info.title, "channel_id": info.id},
                T.UndoChannelAdd(channel_id=info.id, before=None),
            )
        return self._require(info.id)

    def upsert_many(
        self,
        channels: Sequence[T.ChannelIn],
        *,
        source: T.ChannelSource,
        relation: T.Relation | None = None,
        actor: T.Actor = T.Actor.extension,
    ) -> T.UpsertReport:
        inserted: list[str] = []
        updated: list[str] = []
        duplicates: dict[str, str] = {}
        unresolved: list[str] = []
        with self.db.transaction():
            for item in channels:
                existing = self.find_duplicate(
                    channel_id=item.channel_id, handle=item.handle, url=item.url, title=item.title
                )
                channel_id = item.channel_id
                if existing is None and channel_id is None and self.youtube is not None:
                    ref_text = item.handle or item.url
                    if ref_text:
                        try:
                            info = self.youtube.resolve_channel(ref_text)
                        except T.TubeError:
                            info = None
                        if info is not None:
                            channel_id = info.id
                            existing = self.get(info.id)
                if existing is not None:
                    key = (
                        dedup.channel_match_keys(
                            channel_id=item.channel_id,
                            handle=item.handle,
                            url=item.url,
                            title=item.title,
                        )
                        or (existing.id,)
                    )[0]
                    if item.channel_id != existing.id:
                        duplicates[key] = existing.id
                    values: dict[str, Any] = {}
                    if item.title and item.title != existing.title:
                        values["title"] = item.title
                    if item.thumb and item.thumb != existing.thumb:
                        values["thumb"] = item.thumb
                    handle = dedup.normalize_handle(item.handle) if item.handle else None
                    if handle and handle != existing.handle:
                        values["handle"] = handle
                    if item.url and item.url != existing.url:
                        values["url"] = item.url
                    self._set_fields(existing.id, values)
                    if (
                        relation is not None
                        and existing.relation is not relation
                        and self._can_move(existing.relation, relation)
                    ):
                        unsub = self._now() if relation is T.Relation.ex else None
                        self._write_relation(existing.id, relation, unsub)
                        values["relation"] = relation
                    if values:
                        updated.append(existing.id)
                    continue
                if channel_id is None or not dedup.is_channel_id(channel_id):
                    unresolved.append(item.title or item.handle or item.url or "?")
                    continue
                self._insert(
                    channel_id=channel_id,
                    title=item.title,
                    relation=T.Relation(relation or T.Relation.followed),
                    source=T.ChannelSource(source),
                    handle=item.handle,
                    thumb=item.thumb,
                    url=item.url,
                    folder_id=item.folder_id,
                    favorite=bool(item.favorite),
                )
                if item.tag_ids:
                    self._write_tags(channel_id, item.tag_ids)
                inserted.append(channel_id)
                if T.Actor(actor) is T.Actor.user:
                    self.changelog.record(
                        actor,
                        T.ChangeAction.channel_add,
                        {"label": item.title, "channel_id": channel_id},
                        T.UndoChannelAdd(channel_id=channel_id, before=None),
                    )
        return T.UpsertReport(
            inserted=tuple(inserted),
            updated=tuple(updated),
            duplicates=duplicates,
            unresolved=tuple(unresolved),
        )

    def update(
        self, channel_id: str, patch: T.ChannelPatch, *, actor: T.Actor = T.Actor.user
    ) -> T.Channel:
        current = self._require(channel_id)
        values: dict[str, Any] = {}
        before: dict[str, Any] = {}
        for f in fields(patch):
            value = getattr(patch, f.name)
            if value is T.UNSET:
                continue
            if f.name == "title" and not (isinstance(value, str) and value.strip()):
                raise T.ValidationError("empty title", field="title")
            if f.name == "handle" and value is not None:
                value = dedup.normalize_handle(value)
                if value is None:
                    raise T.ValidationError("invalid handle", field="handle")
            old = getattr(current, f.name)
            if old != value:
                values[f.name] = value
                before[f.name] = old
        if not values:
            return current
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
        current = self._require(channel_id)
        relation = T.Relation(relation)
        if current.relation is relation:
            return current
        if relation not in T.RELATION_TRANSITIONS[current.relation]:
            raise T.Conflict(f"transition {current.relation} → {relation} not allowed")
        if relation is T.Relation.ex:
            unsub = self._now()
        elif relation is T.Relation.ignored:
            unsub = current.unsubscribed_at
        else:
            unsub = None
        with self.db.transaction():
            self._write_relation(channel_id, relation, unsub)
            self.changelog.record(
                actor,
                T.ChangeAction.channel_relation,
                {"label": current.title, "to": relation.value, "reason": reason},
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
        if folder_id is not None and not self.db.query_one(
            "SELECT id FROM folders WHERE id = ?", (folder_id,)
        ):
            raise T.NotFound(f"folder {folder_id} does not exist")
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
        current = self._require(channel_id)
        new = tuple(sorted(dict.fromkeys(tag_ids)))
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

    def batch(
        self,
        op: T.BatchOp,
        channel_ids: Sequence[str],
        *,
        value: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.BatchResult:
        op = T.BatchOp(op)
        current = {cid: self._require(cid) for cid in dict.fromkeys(channel_ids)}
        if op in (T.BatchOp.tag, T.BatchOp.untag) and not (
            value and self.db.query_one("SELECT id FROM tags WHERE id = ?", (value,))
        ):
            raise T.NotFound(f"tag {value} does not exist")
        if (
            op is T.BatchOp.move
            and value is not None
            and not self.db.query_one("SELECT id FROM folders WHERE id = ?", (value,))
        ):
            raise T.NotFound(f"folder {value} does not exist")
        changed: list[str] = []
        skipped: list[str] = []
        before: dict[str, dict[str, Any]] = {}
        with self.db.transaction():
            for cid, ch in current.items():
                new_values: dict[str, Any] = {}
                new_tags: tuple[str, ...] | None = None
                new_rel: T.Relation | None = None
                if op is T.BatchOp.favorite and not ch.favorite:
                    new_values["favorite"] = True
                elif op is T.BatchOp.unfavorite and ch.favorite:
                    new_values["favorite"] = False
                elif op is T.BatchOp.mute and not ch.muted:
                    new_values["muted"] = True
                elif op is T.BatchOp.unmute and ch.muted:
                    new_values["muted"] = False
                elif op is T.BatchOp.move and ch.folder_id != value:
                    new_values["folder_id"] = value
                elif op is T.BatchOp.tag and value not in ch.tag_ids:
                    new_tags = (*ch.tag_ids, str(value))
                elif op is T.BatchOp.untag and value in ch.tag_ids:
                    new_tags = tuple(t for t in ch.tag_ids if t != value)
                elif op in (T.BatchOp.follow, T.BatchOp.ignore):
                    target = T.Relation.followed if op is T.BatchOp.follow else T.Relation.ignored
                    if ch.relation is not target and target in T.RELATION_TRANSITIONS[ch.relation]:
                        new_rel = target
                if not new_values and new_tags is None and new_rel is None:
                    skipped.append(cid)
                    continue
                snap: dict[str, Any] = {k: getattr(ch, k) for k in new_values}
                self._set_fields(cid, new_values)
                if new_tags is not None:
                    snap["tag_ids"] = list(ch.tag_ids)
                    self._write_tags(cid, new_tags)
                if new_rel is not None:
                    snap["relation"] = ch.relation.value
                    snap["unsubscribed_at"] = ch.unsubscribed_at
                    unsub = ch.unsubscribed_at if new_rel is T.Relation.ignored else None
                    self._write_relation(cid, new_rel, unsub)
                before[cid] = snap
                changed.append(cid)
            change_id = None
            if changed:
                rec = self.changelog.record(
                    actor,
                    T.ChangeAction.channel_batch,
                    {"op": op.value, "count": len(changed), "value": value},
                    T.UndoChannelBatch(before=before),
                )
                change_id = rec.id
        return T.BatchResult(changed=tuple(changed), skipped=tuple(skipped), change_id=change_id)

    def update_stats(self, stats: Sequence[T.ChannelStats]) -> int:
        count = 0
        for s in stats:
            values: dict[str, Any] = {}
            for name in ("last_video_at", "videos_per_week", "shorts_ratio", "title", "thumb"):
                value = getattr(s, name)
                if value is not None:
                    values[name] = value
            if values and self.get(s.channel_id) is not None:
                self._set_fields(s.channel_id, values)
                count += 1
        return count

    def remove_by_source(self, source: T.ChannelSource) -> int:
        """fake: "never subscribed through the extension" = relation ``followed`` or ``ignored``."""
        res = self.db.execute(
            "DELETE FROM channels WHERE source = ? AND relation IN ('followed', 'ignored')",
            (T.ChannelSource(source).value,),
        )
        return res.rowcount

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if isinstance(u, T.UndoChannelAdd):
            if u.before is None:
                self.db.execute("DELETE FROM channels WHERE id = ?", (u.channel_id,))
            else:
                self._set_fields(u.channel_id, dict(u.before))
        elif isinstance(u, T.UndoChannelUpdate):
            self._set_fields(u.channel_id, dict(u.before))
        elif isinstance(u, T.UndoChannelRelation):
            self._write_relation(u.channel_id, T.Relation(u.before), u.before_unsubscribed_at)
        elif isinstance(u, T.UndoChannelMove):
            for cid, folder_id in u.before.items():
                self._set_fields(cid, {"folder_id": folder_id})
        elif isinstance(u, T.UndoChannelTags):
            for cid, tag_ids in u.before.items():
                self._write_tags(cid, tag_ids)
        elif isinstance(u, T.UndoChannelBatch):
            for cid, snap in u.before.items():
                snap = dict(snap)
                if "tag_ids" in snap:
                    self._write_tags(cid, snap.pop("tag_ids"))
                if "relation" in snap:
                    self._write_relation(
                        cid, T.Relation(snap.pop("relation")), snap.pop("unsubscribed_at", None)
                    )
                self._set_fields(cid, snap)
        else:
            raise T.UndoRefused("not_undoable", f"channels do not undo {change.action}")


# --------------------------------------------------------------------------- TaxonomyService


def _folder_from_row(row: Mapping[str, Any]) -> T.Folder:
    return T.Folder(
        id=row["id"],
        name=row["name"],
        parent_id=row["parent_id"],
        color=row["color"],
        sort=int(row["sort"]),
    )


def _tag_from_row(row: Mapping[str, Any]) -> T.Tag:
    return T.Tag(id=row["id"], name=row["name"], color=row["color"])


class FakeTaxonomyService(_SqlFake):
    """``TaxonomyService`` over ``folders``/``tags``."""

    def __init__(
        self,
        db: T.Db,
        *,
        channels: T.ChannelService,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.channels = channels
        self.changelog = changelog

    # folders

    def list_folders(self) -> list[T.Folder]:
        rows = self.db.query("SELECT * FROM folders")
        folders = [_folder_from_row(r) for r in rows]
        folders.sort(key=lambda f: (f.parent_id or "", f.sort, dedup.normalize_name(f.name)))
        return folders

    def get_folder(self, folder_id: str) -> T.Folder | None:
        row = self.db.query_one("SELECT * FROM folders WHERE id = ?", (folder_id,))
        return _folder_from_row(row) if row else None

    def _require_folder(self, folder_id: str) -> T.Folder:
        folder = self.get_folder(folder_id)
        if folder is None:
            raise T.NotFound(f"folder {folder_id} does not exist")
        return folder

    def _check_name(self, name: Any, parent_id: str | None, *, skip: str | None = None) -> str:
        if not isinstance(name, str) or not name.strip():
            raise T.ValidationError("nome vazio", field="name")
        found = self.find_folder_by_name(name, parent_id=parent_id)
        if found is not None and found.id != skip:
            raise T.Conflict(f"folder {name!r} already exists here")
        return name.strip()

    def create_folder(
        self,
        name: str,
        *,
        parent_id: str | None = None,
        color: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.Folder:
        if parent_id is not None:
            self._require_folder(parent_id)
        clean = self._check_name(name, parent_id)
        folder_id = self.ids.next("f")
        sort_row = self.db.query_one(
            "SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM folders WHERE parent_id IS ?",
            (parent_id,),
        )
        with self.db.transaction():
            self.db.execute(
                "INSERT INTO folders (id, name, parent_id, color, sort, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (folder_id, clean, parent_id, color, sort_row["s"] if sort_row else 0, self._now()),
            )
            self.changelog.record(
                actor,
                T.ChangeAction.folder_create,
                {"label": clean},
                T.UndoFolderCreate(folder_id=folder_id),
            )
        return self._require_folder(folder_id)

    def _update(self, folder_id: str, values: Mapping[str, Any], actor: T.Actor) -> T.Folder:
        current = self._require_folder(folder_id)
        before = {k: getattr(current, k) for k in values if getattr(current, k) != values[k]}
        if not before:
            return current
        with self.db.transaction():
            cols = ", ".join(f"{k} = ?" for k in before)
            self.db.execute(
                f"UPDATE folders SET {cols} WHERE id = ?",
                (*[values[k] for k in before], folder_id),
            )
            self.changelog.record(
                actor,
                T.ChangeAction.folder_update,
                {"label": current.name, "fields": sorted(before)},
                T.UndoFolderUpdate(folder_id=folder_id, before=before),
            )
        return self._require_folder(folder_id)

    def update_folder(
        self,
        folder_id: str,
        *,
        name: Any = T.UNSET,
        color: Any = T.UNSET,
        actor: T.Actor = T.Actor.user,
    ) -> T.Folder:
        current = self._require_folder(folder_id)
        values: dict[str, Any] = {}
        if name is not T.UNSET:
            values["name"] = self._check_name(name, current.parent_id, skip=folder_id)
        if color is not T.UNSET:
            values["color"] = color
        return self._update(folder_id, values, actor)

    def move_folder(
        self, folder_id: str, parent_id: str | None, *, actor: T.Actor = T.Actor.user
    ) -> T.Folder:
        current = self._require_folder(folder_id)
        if parent_id is not None:
            self._require_folder(parent_id)
            if parent_id in self.descendants(folder_id):
                raise T.ValidationError("mover criaria um ciclo", field="parent_id")
        self._check_name(current.name, parent_id, skip=folder_id)
        return self._update(folder_id, {"parent_id": parent_id}, actor)

    def delete_folder(self, folder_id: str, *, actor: T.Actor = T.Actor.user) -> None:
        folder = self._require_folder(folder_id)
        row = self.db.query_one("SELECT * FROM folders WHERE id = ?", (folder_id,))
        channel_ids = [
            r["id"]
            for r in self.db.query("SELECT id FROM channels WHERE folder_id = ?", (folder_id,))
        ]
        children = [
            r["id"]
            for r in self.db.query("SELECT id FROM folders WHERE parent_id = ?", (folder_id,))
        ]
        with self.db.transaction(), self.changelog.group(f"apagar pasta {folder.name}"):
            if channel_ids:
                self.channels.move(channel_ids, None, actor=actor)
            self.db.execute(
                "UPDATE folders SET parent_id = ? WHERE parent_id = ?",
                (folder.parent_id, folder_id),
            )
            self.db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
            self.changelog.record(
                actor,
                T.ChangeAction.folder_delete,
                {"label": folder.name},
                T.UndoFolderDelete(
                    folder=dict(row or {}),
                    channel_ids=tuple(channel_ids),
                    child_folder_ids=tuple(children),
                ),
            )

    def reorder_folders(self, folder_ids: Sequence[str], *, actor: T.Actor = T.Actor.user) -> None:
        before = {fid: self._require_folder(fid).sort for fid in folder_ids}
        with self.db.transaction():
            for i, fid in enumerate(folder_ids):
                self.db.execute("UPDATE folders SET sort = ? WHERE id = ?", (i, fid))
            self.changelog.record(
                actor,
                T.ChangeAction.folder_reorder,
                {"count": len(before)},
                T.UndoReorder(before=before),
            )

    def descendants(self, folder_id: str) -> list[str]:
        return _folder_descendants(self.db, folder_id)

    def find_folder_by_name(self, name: str, *, parent_id: Any = T.UNSET) -> T.Folder | None:
        needle = dedup.normalize_name(name)
        for folder in self.list_folders():
            if parent_id is not T.UNSET and folder.parent_id != parent_id:
                continue
            if dedup.normalize_name(folder.name) == needle:
                return folder
        return None

    # tags

    def list_tags(self) -> list[T.Tag]:
        tags = [_tag_from_row(r) for r in self.db.query("SELECT * FROM tags")]
        tags.sort(key=lambda t: (dedup.normalize_name(t.name), t.id))
        return tags

    def _require_tag(self, tag_id: str) -> T.Tag:
        row = self.db.query_one("SELECT * FROM tags WHERE id = ?", (tag_id,))
        if row is None:
            raise T.NotFound(f"tag {tag_id} does not exist")
        return _tag_from_row(row)

    def create_tag(
        self, name: str, *, color: str | None = None, actor: T.Actor = T.Actor.user
    ) -> T.Tag:
        if not isinstance(name, str) or not name.strip():
            raise T.ValidationError("nome vazio", field="name")
        if self.find_tag_by_name(name) is not None:
            raise T.Conflict(f"tag {name!r} already exists")
        tag_id = self.ids.next("t")
        with self.db.transaction():
            self.db.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
                (tag_id, name.strip(), color, self._now()),
            )
            self.changelog.record(
                actor, T.ChangeAction.tag_create, {"label": name}, T.UndoTagCreate(tag_id=tag_id)
            )
        return self._require_tag(tag_id)

    def update_tag(
        self,
        tag_id: str,
        *,
        name: Any = T.UNSET,
        color: Any = T.UNSET,
        actor: T.Actor = T.Actor.user,
    ) -> T.Tag:
        current = self._require_tag(tag_id)
        values: dict[str, Any] = {}
        if name is not T.UNSET:
            if not isinstance(name, str) or not name.strip():
                raise T.ValidationError("nome vazio", field="name")
            other = self.find_tag_by_name(name)
            if other is not None and other.id != tag_id:
                raise T.Conflict(f"tag {name!r} already exists")
            values["name"] = name.strip()
        if color is not T.UNSET:
            values["color"] = color
        before = {k: getattr(current, k) for k in values if getattr(current, k) != values[k]}
        if not before:
            return current
        with self.db.transaction():
            cols = ", ".join(f"{k} = ?" for k in before)
            self.db.execute(
                f"UPDATE tags SET {cols} WHERE id = ?", (*[values[k] for k in before], tag_id)
            )
            self.changelog.record(
                actor,
                T.ChangeAction.tag_update,
                {"label": current.name},
                T.UndoTagUpdate(tag_id=tag_id, before=before),
            )
        return self._require_tag(tag_id)

    def delete_tag(self, tag_id: str, *, actor: T.Actor = T.Actor.user) -> None:
        tag = self._require_tag(tag_id)
        row = self.db.query_one("SELECT * FROM tags WHERE id = ?", (tag_id,))
        linked = [
            r["channel_id"]
            for r in self.db.query(
                "SELECT channel_id FROM channel_tags WHERE tag_id = ?", (tag_id,)
            )
        ]
        with self.db.transaction(), self.changelog.group(f"apagar tag {tag.name}"):
            for cid in linked:
                ch = self.channels.get(cid)
                if ch is not None:
                    self.channels.set_tags(cid, [t for t in ch.tag_ids if t != tag_id], actor=actor)
            self.db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
            self.changelog.record(
                actor,
                T.ChangeAction.tag_delete,
                {"label": tag.name},
                T.UndoTagDelete(tag=dict(row or {}), channel_ids=tuple(linked)),
            )

    def find_tag_by_name(self, name: str) -> T.Tag | None:
        needle = dedup.normalize_name(name)
        return next((t for t in self.list_tags() if dedup.normalize_name(t.name) == needle), None)

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if isinstance(u, T.UndoFolderCreate):
            self.db.execute("DELETE FROM folders WHERE id = ?", (u.folder_id,))
        elif isinstance(u, T.UndoFolderUpdate):
            cols = ", ".join(f"{k} = ?" for k in u.before)
            self.db.execute(
                f"UPDATE folders SET {cols} WHERE id = ?", (*u.before.values(), u.folder_id)
            )
        elif isinstance(u, T.UndoFolderDelete):
            f = dict(u.folder)
            self.db.execute(
                "INSERT INTO folders (id, name, parent_id, color, sort, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    f["id"],
                    f["name"],
                    f.get("parent_id"),
                    f.get("color"),
                    f.get("sort", 0),
                    f.get("created_at", self._now()),
                ),
            )
            for child in u.child_folder_ids:
                self.db.execute("UPDATE folders SET parent_id = ? WHERE id = ?", (f["id"], child))
        elif isinstance(u, T.UndoReorder):
            for fid, sort in u.before.items():
                self.db.execute("UPDATE folders SET sort = ? WHERE id = ?", (sort, fid))
        elif isinstance(u, T.UndoTagCreate):
            self.db.execute("DELETE FROM tags WHERE id = ?", (u.tag_id,))
        elif isinstance(u, T.UndoTagUpdate):
            cols = ", ".join(f"{k} = ?" for k in u.before)
            self.db.execute(f"UPDATE tags SET {cols} WHERE id = ?", (*u.before.values(), u.tag_id))
        elif isinstance(u, T.UndoTagDelete):
            t = dict(u.tag)
            self.db.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
                (t["id"], t["name"], t.get("color"), t.get("created_at", self._now())),
            )
        else:
            raise T.UndoRefused("not_undoable", f"taxonomy does not undo {change.action}")


# --------------------------------------------------------------------------- TabService


def _tab_from_row(row: Mapping[str, Any]) -> T.Tab:
    return T.Tab(
        id=row["id"],
        name=row["name"],
        kind=T.TabKind(row["kind"]),
        rules=T.TabRules.from_dict(json.loads(row["rules"])),
        icon=row["icon"],
        filters=json.loads(row["filters"] or "{}"),
        sort=int(row["sort"]),
        builtin=bool(row["builtin"]),
    )


class FakeTabService(_SqlFake):
    """``TabService`` over ``tabs``. ``known_lenses`` = lenses accepted in ``include.lenses``."""

    def __init__(
        self,
        db: T.Db,
        *,
        changelog: T.ChangeLog,
        known_lenses: Sequence[str] = (T.HN_LENS,),
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.changelog = changelog
        self.known_lenses = set(known_lenses)

    def list(self) -> list[T.Tab]:
        rows = self.db.query("SELECT * FROM tabs ORDER BY sort, created_at, id")
        return [_tab_from_row(r) for r in rows]

    def get(self, tab_id: str) -> T.Tab | None:
        row = self.db.query_one("SELECT * FROM tabs WHERE id = ?", (tab_id,))
        return _tab_from_row(row) if row else None

    def _require(self, tab_id: str) -> T.Tab:
        tab = self.get(tab_id)
        if tab is None:
            raise T.NotFound(f"tab {tab_id} does not exist")
        return tab

    def validate_rules(self, data: Mapping[str, Any]) -> T.TabRules:
        rules = T.TabRules.from_dict(data)

        def missing(table: str, ids: Sequence[str]) -> list[str]:
            return [
                i
                for i in ids
                if not self.db.query_one(f"SELECT 1 AS x FROM {table} WHERE id = ?", (i,))
            ]

        for label, table, ids in (
            ("pastas", "folders", rules.include.folders + rules.exclude.folders),
            ("tags", "tags", rules.include.tags + rules.exclude.tags),
            ("temas", "themes", rules.include.themes),
        ):
            bad = missing(table, ids)
            if bad:
                raise T.ValidationError(f"{label} inexistentes: {bad}", field=table)
        bad_channels = [
            c for c in rules.include.channels + rules.exclude.channels if not dedup.is_channel_id(c)
        ]
        if bad_channels:
            raise T.ValidationError(f"invalid channels: {bad_channels}", field="channels")
        unknown = [name for name in rules.include.lenses if name not in self.known_lenses]
        if unknown:
            raise T.ValidationError(f"lentes desconhecidas: {unknown}", field="lenses")
        return rules

    def _insert(self, tab_id: str, draft: T.TabDraft, sort: int) -> None:
        now = self._now()
        self.db.execute(
            "INSERT INTO tabs (id, name, icon, kind, rules, filters, sort, builtin, created_at,"
            " updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                tab_id,
                draft.name.strip(),
                draft.icon,
                T.TabKind(draft.kind).value,
                json_text(draft.rules.to_dict()),
                json_text(draft.filters),
                sort,
                int(draft.builtin),
                now,
                now,
            ),
        )

    def _next_sort(self) -> int:
        row = self.db.query_one("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM tabs")
        return int(row["s"]) if row else 0

    def create(self, draft: T.TabDraft, *, actor: T.Actor = T.Actor.user) -> T.Tab:
        if not draft.name or not draft.name.strip():
            raise T.ValidationError("nome vazio", field="name")
        self.validate_rules(draft.rules.to_dict())
        tab_id = draft.id or self.ids.next("tab")
        if self.get(tab_id) is not None:
            raise T.Conflict(f"tab {tab_id} already exists")
        with self.db.transaction():
            self._insert(tab_id, draft, self._next_sort())
            self.changelog.record(
                actor,
                T.ChangeAction.tab_create,
                {"label": draft.name},
                T.UndoTabCreate(tab_id=tab_id),
            )
        return self._require(tab_id)

    def update(self, tab_id: str, patch: T.TabPatch, *, actor: T.Actor = T.Actor.user) -> T.Tab:
        current = self._require(tab_id)
        values: dict[str, Any] = {}
        before: dict[str, Any] = {}
        for f in fields(patch):
            value = getattr(patch, f.name)
            if value is T.UNSET:
                continue
            if f.name == "rules":
                rules = value if isinstance(value, T.TabRules) else T.TabRules.from_dict(value)
                self.validate_rules(rules.to_dict())
                values["rules"] = json_text(rules.to_dict())
                before["rules"] = current.rules.to_dict()
            elif f.name == "kind":
                values["kind"] = T.TabKind(value).value
                before["kind"] = current.kind.value
            elif f.name == "filters":
                values["filters"] = json_text(value or {})
                before["filters"] = dict(current.filters)
            elif f.name == "name":
                if not isinstance(value, str) or not value.strip():
                    raise T.ValidationError("nome vazio", field="name")
                values["name"] = value.strip()
                before["name"] = current.name
            else:
                values[f.name] = value
                before[f.name] = getattr(current, f.name)
        if not values:
            return current
        with self.db.transaction():
            self._write(tab_id, values)
            self.changelog.record(
                actor,
                T.ChangeAction.tab_update,
                {"label": current.name, "fields": sorted(values)},
                T.UndoTabUpdate(tab_id=tab_id, before=before),
            )
        return self._require(tab_id)

    def _write(self, tab_id: str, values: Mapping[str, Any]) -> None:
        cols = ", ".join(f"{k} = ?" for k in values)
        self.db.execute(
            f"UPDATE tabs SET {cols}, updated_at = ? WHERE id = ?",
            (*values.values(), self._now(), tab_id),
        )

    def delete(self, tab_id: str, *, actor: T.Actor = T.Actor.user) -> None:
        tab = self._require(tab_id)
        if tab.builtin:
            raise T.Conflict("a built-in tab cannot be deleted")
        row = self.db.query_one("SELECT * FROM tabs WHERE id = ?", (tab_id,))
        with self.db.transaction():
            self.db.execute("DELETE FROM tabs WHERE id = ?", (tab_id,))
            self.changelog.record(
                actor,
                T.ChangeAction.tab_delete,
                {"label": tab.name},
                T.UndoTabDelete(tab=dict(row or {})),
            )

    def reorder(self, tab_ids: Sequence[str], *, actor: T.Actor = T.Actor.user) -> None:
        before = {tid: self._require(tid).sort for tid in tab_ids}
        with self.db.transaction():
            for i, tid in enumerate(tab_ids):
                self.db.execute("UPDATE tabs SET sort = ? WHERE id = ?", (i, tid))
            self.changelog.record(
                actor,
                T.ChangeAction.tab_reorder,
                {"count": len(before)},
                T.UndoReorder(before=before),
            )

    def create_from_channels(
        self,
        name: str,
        channel_ids: Sequence[str],
        *,
        icon: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.Tab:
        rules = T.TabRules(include=T.RuleInclude(channels=tuple(dict.fromkeys(channel_ids))))
        return self.create(
            T.TabDraft(name=name, kind=T.TabKind.channels, rules=rules, icon=icon), actor=actor
        )

    def ensure_builtin(self) -> list[T.Tab]:
        drafts = (
            T.TabDraft(
                id=T.BUILTIN_TAB_ALL_NEW,
                name="Tudo novo",
                kind=T.TabKind.category,
                icon="▶",
                builtin=True,
                rules=T.TabRules(
                    include=T.RuleInclude(all=True), filters=T.RuleFilters(only_new=True)
                ),
            ),
            T.TabDraft(
                id=T.BUILTIN_TAB_FAVORITES,
                name="Favoritos",
                kind=T.TabKind.category,
                icon="⭐",
                builtin=True,
                rules=T.TabRules(include=T.RuleInclude(favorites=True)),
            ),
        )
        for draft in drafts:
            assert draft.id is not None
            if self.get(draft.id) is None:
                self._insert(draft.id, draft, self._next_sort())
        return [self._require(d.id) for d in drafts if d.id]

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if isinstance(u, T.UndoTabCreate):
            self.db.execute("DELETE FROM tabs WHERE id = ?", (u.tab_id,))
        elif isinstance(u, T.UndoTabUpdate):
            values = {
                k: json_text(v) if k in ("rules", "filters") else v for k, v in u.before.items()
            }
            self._write(u.tab_id, values)
        elif isinstance(u, T.UndoTabDelete):
            t = dict(u.tab)
            cols = ", ".join(t)
            self.db.execute(
                f"INSERT INTO tabs ({cols}) VALUES ({_placeholders(list(t))})", tuple(t.values())
            )
        elif isinstance(u, T.UndoReorder):
            for tid, sort in u.before.items():
                self.db.execute("UPDATE tabs SET sort = ? WHERE id = ?", (sort, tid))
        else:
            raise T.UndoRefused("not_undoable", f"tabs do not undo {change.action}")


# --------------------------------------------------------------------------- VideoStateService


def _state_from_row(row: Mapping[str, Any]) -> T.VideoStateRow:
    return T.VideoStateRow(
        video_id=row["video_id"],
        state=T.VideoState(row["state"]),
        reaction=T.Reaction(row["reaction"]) if row["reaction"] else None,
        updated_at=int(row["updated_at"]),
    )


_VIDEO_HISTORY_ACTORS = frozenset({T.Actor.user, T.Actor.hermes})
"""Like the real one: person and agent write video-state history; extension/routine do not."""


class FakeVideoStateService(_SqlFake):
    """``VideoStateService`` over ``video_state``."""

    def __init__(
        self,
        db: T.Db,
        *,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.changelog = changelog

    def get(self, video_ids: Sequence[str]) -> dict[str, T.VideoStateRow]:
        ids = list(dict.fromkeys(video_ids))
        if not ids:
            return {}
        rows = self.db.query(
            f"SELECT * FROM video_state WHERE video_id IN ({_placeholders(ids)})", tuple(ids)
        )
        return {r["video_id"]: _state_from_row(r) for r in rows}

    def _before(self, ids: Sequence[str]) -> dict[str, dict[str, Any] | None]:
        current = self.get(ids)
        return {
            vid: (
                {"state": current[vid].state.value, "reaction": current[vid].reaction}
                if vid in current
                else None
            )
            for vid in ids
        }

    def _write(self, video_id: str, state: str, reaction: str | None) -> None:
        self.db.execute(
            "INSERT INTO video_state (video_id, state, reaction, updated_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(video_id) DO UPDATE SET state = excluded.state,"
            " reaction = excluded.reaction, updated_at = excluded.updated_at",
            (video_id, state, reaction, self._now()),
        )

    def set_state(
        self, video_ids: Sequence[str], state: T.VideoState, *, actor: T.Actor = T.Actor.user
    ) -> int:
        ids = list(dict.fromkeys(video_ids))
        state = T.VideoState(state)
        before = self._before(ids)
        with self.db.transaction():
            for vid in ids:
                prev = before[vid]
                self._write(vid, state.value, prev["reaction"] if prev else None)
            if ids and T.Actor(actor) in _VIDEO_HISTORY_ACTORS:
                self.changelog.record(
                    actor,
                    T.ChangeAction.video_state,
                    {"state": state.value, "count": len(ids)},
                    T.UndoVideoState(before=before),
                )
        return len(ids)

    def set_reaction(
        self, video_id: str, reaction: T.Reaction | None, *, actor: T.Actor = T.Actor.user
    ) -> T.VideoStateRow:
        before = self._before([video_id])
        prev = before[video_id]
        value = T.Reaction(reaction).value if reaction is not None else None
        with self.db.transaction():
            self._write(video_id, prev["state"] if prev else T.VideoState.new.value, value)
            if T.Actor(actor) in _VIDEO_HISTORY_ACTORS:
                self.changelog.record(
                    actor,
                    T.ChangeAction.video_state,
                    {"reaction": value, "count": 1},
                    T.UndoVideoState(before=before),
                )
        return self.get([video_id])[video_id]

    def reactions(self, video_ids: Sequence[str] | None = None) -> dict[str, T.Reaction]:
        if video_ids is None:
            rows = self.db.query("SELECT * FROM video_state WHERE reaction IS NOT NULL")
            states = {r["video_id"]: _state_from_row(r) for r in rows}
        else:
            states = self.get(video_ids)
        return {vid: s.reaction for vid, s in states.items() if s.reaction is not None}

    def list_by_state(self, state: T.VideoState, *, limit: int = 100) -> list[T.VideoStateRow]:
        rows = self.db.query(
            "SELECT * FROM video_state WHERE state = ? ORDER BY updated_at DESC, video_id LIMIT ?",
            (T.VideoState(state).value, limit),
        )
        return [_state_from_row(r) for r in rows]

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if not isinstance(u, T.UndoVideoState):
            raise T.UndoRefused("not_undoable", f"video state does not undo {change.action}")
        for vid, prev in u.before.items():
            if prev is None:
                self.db.execute("DELETE FROM video_state WHERE video_id = ?", (vid,))
            else:
                self._write(vid, prev["state"], prev.get("reaction"))


# --------------------------------------------------------------------------- VideoStore


def _video_from_row(row: Mapping[str, Any]) -> T.Video:
    return T.Video(
        id=row["id"],
        channel_id=row["channel_id"],
        title=row["title"],
        published_at=row["published_at"],
        description=row["description"],
        channel_title=row["channel_title"],
        duration_s=row["duration_s"],
        is_short=None if row["is_short"] is None else bool(row["is_short"]),
        views=row["views"],
        first_seen_at=int(row["first_seen_at"]),
        origin=T.VideoOrigin(row["origin"]),
    )


def _filled(value: Any) -> bool:
    return value is not None and value != ""


class FakeVideoStore(_SqlFake):
    """``VideoStore`` over ``videos`` with the contract's upsert rule."""

    def upsert(self, videos: Sequence[T.VideoIn], origin: T.VideoOrigin) -> T.UpsertCount:
        origin = T.VideoOrigin(origin)
        inserted = updated = 0
        now = self._now()
        with self.db.transaction():
            for v in videos:
                row = self.db.query_one("SELECT * FROM videos WHERE id = ?", (v.id,))
                if row is None:
                    self.db.execute(
                        "INSERT INTO videos (id, channel_id, channel_title, title, description,"
                        " published_at, duration_s, is_short, views, first_seen_at, origin,"
                        " updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            v.id,
                            v.channel_id,
                            v.channel_title,
                            v.title or "",
                            v.description or None,
                            v.published_at,
                            v.duration_s,
                            None if v.is_short is None else int(v.is_short),
                            v.views,
                            now,
                            origin.value,
                            now,
                        ),
                    )
                    inserted += 1
                    continue
                values: dict[str, Any] = {}
                for name in (
                    "title",
                    "channel_id",
                    "channel_title",
                    "published_at",
                    "description",
                    "views",
                ):
                    new = getattr(v, name)
                    if _filled(new) and new != row[name]:
                        values[name] = new
                if v.duration_s is not None and row["duration_s"] is None:
                    values["duration_s"] = v.duration_s
                if v.is_short is not None and row["is_short"] is None:
                    values["is_short"] = int(v.is_short)
                if values:
                    cols = ", ".join(f"{k} = ?" for k in values)
                    self.db.execute(
                        f"UPDATE videos SET {cols}, updated_at = ? WHERE id = ?",
                        (*values.values(), now, v.id),
                    )
                    updated += 1
        return T.UpsertCount(inserted=inserted, updated=updated)

    def set_details(self, video_id: str, duration_s: int | None, is_short: bool | None) -> None:
        if not self.db.query_one("SELECT id FROM videos WHERE id = ?", (video_id,)):
            raise T.NotFound(f"video {video_id} does not exist")
        values: dict[str, Any] = {}
        if duration_s is not None:
            values["duration_s"] = int(duration_s)
        if is_short is not None:
            values["is_short"] = int(bool(is_short))
        if values:
            cols = ", ".join(f"{k} = ?" for k in values)
            self.db.execute(
                f"UPDATE videos SET {cols}, updated_at = ? WHERE id = ?",
                (*values.values(), self._now(), video_id),
            )

    def get(self, ids: Sequence[str]) -> dict[str, T.Video]:
        ids = list(dict.fromkeys(ids))
        if not ids:
            return {}
        rows = self.db.query(f"SELECT * FROM videos WHERE id IN ({_placeholders(ids)})", tuple(ids))
        return {r["id"]: _video_from_row(r) for r in rows}


__all__ = [
    "FakeChangeLog",
    "FakeChannelService",
    "FakeTabService",
    "FakeTaxonomyService",
    "FakeVideoStateService",
    "FakeVideoStore",
    "IdGen",
]
