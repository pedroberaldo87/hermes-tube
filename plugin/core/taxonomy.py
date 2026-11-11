"""Real ``TaxonomyService``: folders and tags. Owner of the ``folders`` and ``tags`` tables.

Rules (``types.TaxonomyService``):

- names compared with ``dedup.normalize_name``: a duplicate folder **under the same parent** and a
  duplicate tag → ``Conflict``; empty or too long name → ``ValidationError``;
- ``move_folder`` refuses a cycle (``ValidationError``) and puts the folder after its new siblings;
- ``reorder_folders`` is stable: the given ids come first, in the given order, and the remaining
  siblings follow in their current order; ``sort`` is renumbered ``0..n-1``;
- ``delete_folder`` = ``ChannelService.move(..., None)`` (channels → "no folder") + subfolders move
  up to the parent, in a single history group; ``delete_tag`` = ``ChannelService.batch(untag)`` +
  delete, also grouped. Each owner undoes only its own part;
- every write records ``ChangeLog.record`` in the same transaction; ``apply_undo`` writes straight
  to its own tables, never records history, and refuses (``UndoRefused``) when the state moved on
  in a way that undoing would lose data (folder/tag already in use, parent gone, cycle).

No network, no thread; ``build`` only stores the dependencies.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import types as T

MAX_NAME = 200
MAX_COLOR = 64

NewId = Callable[[str], str]


def _uuid_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _folder_from_row(row: Mapping[str, Any]) -> T.Folder:
    return T.Folder(
        id=str(row["id"]),
        name=str(row["name"]),
        parent_id=row["parent_id"],
        color=row["color"],
        sort=int(row["sort"] or 0),
    )


def _tag_from_row(row: Mapping[str, Any]) -> T.Tag:
    return T.Tag(id=str(row["id"]), name=str(row["name"]), color=row["color"])


def clean_name(value: Any, what: str = "name") -> str:
    """Stripped name; empty, not text, or longer than ``MAX_NAME`` → ``ValidationError``."""
    if not isinstance(value, str) or not value.strip():
        raise T.ValidationError(f"{what} is empty", field="name")
    name = value.strip()
    if len(name) > MAX_NAME:
        raise T.ValidationError(f"{what} is longer than {MAX_NAME} characters", field="name")
    return name


def clean_color(value: Any) -> str | None:
    """Free-form color (e.g. ``#7c3aed``) or ``None``; empty text becomes ``None``."""
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > MAX_COLOR:
        raise T.ValidationError("invalid color", field="color")
    return value.strip() or None


def clean_ids(ids: Any, what: str) -> list[str]:
    """Non-empty list of text ids without duplicates (otherwise ``ValidationError``)."""
    if isinstance(ids, str | bytes) or not isinstance(ids, Sequence):
        raise T.ValidationError(f"{what}: expected a list of ids", field="ids")
    out = list(ids)
    if not out:
        raise T.ValidationError(f"{what}: empty list", field="ids")
    if not all(isinstance(i, str) and i for i in out):
        raise T.ValidationError(f"{what}: ids must be text", field="ids")
    if len(set(out)) != len(out):
        raise T.ValidationError(f"{what}: duplicate ids", field="ids")
    return out


class TaxonomyService:
    """Folders and tags over ``folders``/``tags`` (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        channels: T.ChannelService,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        new_id: NewId | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.channels = channels
        self.changelog = changelog
        self.clock = clock or T.SystemClock()
        self._new_id = new_id or _uuid_id

    def _now(self) -> int:
        return int(self.clock.now())

    # ================================================================== folders: read

    def list_folders(self) -> list[T.Folder]:
        folders = [_folder_from_row(r) for r in self.db.query("SELECT * FROM folders")]
        folders.sort(
            key=lambda f: (
                f.parent_id is not None,
                f.parent_id or "",
                f.sort,
                dedup.normalize_name(f.name),
                f.id,
            )
        )
        return folders

    def get_folder(self, folder_id: str) -> T.Folder | None:
        if not isinstance(folder_id, str):
            return None
        row = self.db.query_one("SELECT * FROM folders WHERE id = ?", (folder_id,))
        return _folder_from_row(row) if row else None

    def _require_folder(self, folder_id: Any) -> T.Folder:
        folder = self.get_folder(folder_id)
        if folder is None:
            raise T.NotFound(f"folder {folder_id} does not exist", folder_id=folder_id)
        return folder

    def descendants(self, folder_id: str) -> list[str]:
        if self.get_folder(folder_id) is None:
            return []
        out = [folder_id]
        seen = {folder_id}
        frontier = [folder_id]
        while frontier:
            marks = ",".join("?" for _ in frontier)
            rows = self.db.query(
                f"SELECT id FROM folders WHERE parent_id IN ({marks}) ORDER BY sort, id",
                tuple(frontier),
            )
            frontier = []
            for r in rows:
                child = str(r["id"])
                if child not in seen:  # guard against a cycle written from outside
                    seen.add(child)
                    out.append(child)
                    frontier.append(child)
        return out

    def find_folder_by_name(self, name: str, *, parent_id: Any = T.UNSET) -> T.Folder | None:
        needle = dedup.normalize_name(name)
        if not needle:
            return None
        for folder in self.list_folders():
            if parent_id is not T.UNSET and folder.parent_id != parent_id:
                continue
            if dedup.normalize_name(folder.name) == needle:
                return folder
        return None

    def _check_unique(self, name: str, parent_id: str | None, *, skip: str | None = None) -> None:
        found = self.find_folder_by_name(name, parent_id=parent_id)
        if found is not None and found.id != skip:
            raise T.Conflict(f"a folder named {name!r} already exists here", folder_id=found.id)

    def _next_sort(self, parent_id: str | None) -> int:
        row = self.db.query_one(
            "SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM folders WHERE parent_id IS ?",
            (parent_id,),
        )
        return int(row["s"]) if row else 0

    # ================================================================== folders: write

    def create_folder(
        self,
        name: str,
        *,
        parent_id: str | None = None,
        color: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.Folder:
        actor = T.Actor(actor)
        clean = clean_name(name, "folder name")
        clean_c = clean_color(color)
        if parent_id is not None and not isinstance(parent_id, str):
            raise T.ValidationError("invalid parent_id", field="parent_id")
        folder_id = self._new_id("f")
        with self.db.transaction():
            if parent_id is not None:
                self._require_folder(parent_id)
            self._check_unique(clean, parent_id)
            self.db.execute(
                "INSERT INTO folders (id, name, parent_id, color, sort, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (folder_id, clean, parent_id, clean_c, self._next_sort(parent_id), self._now()),
            )
            self.changelog.record(
                actor,
                T.ChangeAction.folder_create,
                {"label": clean, "parent_id": parent_id},
                T.UndoFolderCreate(folder_id=folder_id),
            )
        return self._require_folder(folder_id)

    def _write_update(
        self, current: T.Folder, values: Mapping[str, Any], actor: T.Actor, label: str
    ) -> T.Folder:
        before = {k: getattr(current, k) for k, v in values.items() if getattr(current, k) != v}
        if not before:
            return current
        cols = ", ".join(f"{k} = ?" for k in before)
        self.db.execute(
            f"UPDATE folders SET {cols} WHERE id = ?",
            (*[values[k] for k in before], current.id),
        )
        self.changelog.record(
            actor,
            T.ChangeAction.folder_update,
            {"label": label, "fields": sorted(before)},
            T.UndoFolderUpdate(folder_id=current.id, before=before),
        )
        return self._require_folder(current.id)

    def update_folder(
        self,
        folder_id: str,
        *,
        name: Any = T.UNSET,
        color: Any = T.UNSET,
        actor: T.Actor = T.Actor.user,
    ) -> T.Folder:
        actor = T.Actor(actor)
        values: dict[str, Any] = {}
        if name is not T.UNSET:
            values["name"] = clean_name(name, "folder name")
        if color is not T.UNSET:
            values["color"] = clean_color(color)
        with self.db.transaction():
            current = self._require_folder(folder_id)
            if "name" in values:
                self._check_unique(values["name"], current.parent_id, skip=current.id)
            return self._write_update(current, values, actor, current.name)

    def move_folder(
        self, folder_id: str, parent_id: str | None, *, actor: T.Actor = T.Actor.user
    ) -> T.Folder:
        actor = T.Actor(actor)
        if parent_id is not None and not isinstance(parent_id, str):
            raise T.ValidationError("invalid parent_id", field="parent_id")
        with self.db.transaction():
            current = self._require_folder(folder_id)
            if parent_id is not None:
                self._require_folder(parent_id)
                if parent_id in self.descendants(folder_id):
                    raise T.ValidationError("the move would create a cycle", field="parent_id")
            if current.parent_id == parent_id:
                return current
            self._check_unique(current.name, parent_id, skip=current.id)
            values = {"parent_id": parent_id, "sort": self._next_sort(parent_id)}
            return self._write_update(current, values, actor, current.name)

    def delete_folder(self, folder_id: str, *, actor: T.Actor = T.Actor.user) -> None:
        actor = T.Actor(actor)
        with self.db.transaction():
            folder = self._require_folder(folder_id)
            row = self.db.query_one("SELECT * FROM folders WHERE id = ?", (folder_id,))
            channel_ids = [
                str(r["id"])
                for r in self.db.query(
                    "SELECT id FROM channels WHERE folder_id = ? ORDER BY id", (folder_id,)
                )
            ]
            children = [
                str(r["id"])
                for r in self.db.query(
                    "SELECT id FROM folders WHERE parent_id = ? ORDER BY sort, id", (folder_id,)
                )
            ]
            with self.changelog.group(f"delete folder {folder.name}"):
                if channel_ids:
                    self.channels.move(channel_ids, None, actor=actor)
                if children:
                    self.db.execute(
                        "UPDATE folders SET parent_id = ? WHERE parent_id = ?",
                        (folder.parent_id, folder_id),
                    )
                self.db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
                self.changelog.record(
                    actor,
                    T.ChangeAction.folder_delete,
                    {"label": folder.name, "channels": len(channel_ids)},
                    T.UndoFolderDelete(
                        folder=dict(row or {}),
                        channel_ids=tuple(channel_ids),
                        child_folder_ids=tuple(children),
                    ),
                )

    def reorder_folders(self, folder_ids: Sequence[str], *, actor: T.Actor = T.Actor.user) -> None:
        actor = T.Actor(actor)
        ids = clean_ids(folder_ids, "reorder folders")
        with self.db.transaction():
            folders = [self._require_folder(fid) for fid in ids]
            parents = {f.parent_id for f in folders}
            if len(parents) != 1:
                raise T.ValidationError("only sibling folders can be reordered", field="ids")
            (parent_id,) = parents
            siblings = [f for f in self.list_folders() if f.parent_id == parent_id]
            given = set(ids)
            order = ids + [f.id for f in siblings if f.id not in given]
            current = {f.id: f.sort for f in siblings}
            before = {fid: current[fid] for i, fid in enumerate(order) if current[fid] != i}
            if not before:
                return
            for i, fid in enumerate(order):
                if fid in before:
                    self.db.execute("UPDATE folders SET sort = ? WHERE id = ?", (i, fid))
            self.changelog.record(
                actor,
                T.ChangeAction.folder_reorder,
                {"count": len(ids), "parent_id": parent_id},
                T.UndoReorder(before=before),
            )

    # ================================================================== tags

    def list_tags(self) -> list[T.Tag]:
        tags = [_tag_from_row(r) for r in self.db.query("SELECT * FROM tags")]
        tags.sort(key=lambda t: (dedup.normalize_name(t.name), t.id))
        return tags

    def _get_tag(self, tag_id: Any) -> T.Tag | None:
        if not isinstance(tag_id, str):
            return None
        row = self.db.query_one("SELECT * FROM tags WHERE id = ?", (tag_id,))
        return _tag_from_row(row) if row else None

    def _require_tag(self, tag_id: Any) -> T.Tag:
        tag = self._get_tag(tag_id)
        if tag is None:
            raise T.NotFound(f"tag {tag_id} does not exist", tag_id=tag_id)
        return tag

    def find_tag_by_name(self, name: str) -> T.Tag | None:
        needle = dedup.normalize_name(name)
        if not needle:
            return None
        return next((t for t in self.list_tags() if dedup.normalize_name(t.name) == needle), None)

    def _check_tag_unique(self, name: str, *, skip: str | None = None) -> None:
        found = self.find_tag_by_name(name)
        if found is not None and found.id != skip:
            raise T.Conflict(f"a tag named {name!r} already exists", tag_id=found.id)

    def create_tag(
        self, name: str, *, color: str | None = None, actor: T.Actor = T.Actor.user
    ) -> T.Tag:
        actor = T.Actor(actor)
        clean = clean_name(name, "tag name")
        clean_c = clean_color(color)
        tag_id = self._new_id("t")
        with self.db.transaction():
            self._check_tag_unique(clean)
            self.db.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
                (tag_id, clean, clean_c, self._now()),
            )
            self.changelog.record(
                actor, T.ChangeAction.tag_create, {"label": clean}, T.UndoTagCreate(tag_id=tag_id)
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
        actor = T.Actor(actor)
        values: dict[str, Any] = {}
        if name is not T.UNSET:
            values["name"] = clean_name(name, "tag name")
        if color is not T.UNSET:
            values["color"] = clean_color(color)
        with self.db.transaction():
            current = self._require_tag(tag_id)
            if "name" in values:
                self._check_tag_unique(values["name"], skip=current.id)
            before = {k: getattr(current, k) for k, v in values.items() if getattr(current, k) != v}
            if not before:
                return current
            cols = ", ".join(f"{k} = ?" for k in before)
            self.db.execute(
                f"UPDATE tags SET {cols} WHERE id = ?", (*[values[k] for k in before], tag_id)
            )
            self.changelog.record(
                actor,
                T.ChangeAction.tag_update,
                {"label": current.name, "fields": sorted(before)},
                T.UndoTagUpdate(tag_id=tag_id, before=before),
            )
        return self._require_tag(tag_id)

    def delete_tag(self, tag_id: str, *, actor: T.Actor = T.Actor.user) -> None:
        actor = T.Actor(actor)
        with self.db.transaction():
            tag = self._require_tag(tag_id)
            row = self.db.query_one("SELECT * FROM tags WHERE id = ?", (tag_id,))
            linked = [
                str(r["channel_id"])
                for r in self.db.query(
                    "SELECT channel_id FROM channel_tags WHERE tag_id = ? ORDER BY channel_id",
                    (tag_id,),
                )
            ]
            with self.changelog.group(f"delete tag {tag.name}"):
                if linked:
                    self.channels.batch(T.BatchOp.untag, linked, value=tag_id, actor=actor)
                self.db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
                self.changelog.record(
                    actor,
                    T.ChangeAction.tag_delete,
                    {"label": tag.name, "channels": len(linked)},
                    T.UndoTagDelete(tag=dict(row or {}), channel_ids=tuple(linked)),
                )

    # ================================================================== undo

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        action = T.ChangeAction(change.action)
        if action is T.ChangeAction.folder_create and isinstance(u, T.UndoFolderCreate):
            self._undo_folder_create(u.folder_id)
        elif action is T.ChangeAction.folder_update and isinstance(u, T.UndoFolderUpdate):
            self._undo_folder_update(u)
        elif action is T.ChangeAction.folder_delete and isinstance(u, T.UndoFolderDelete):
            self._undo_folder_delete(u)
        elif action is T.ChangeAction.folder_reorder and isinstance(u, T.UndoReorder):
            for fid, sort in u.before.items():
                self.db.execute("UPDATE folders SET sort = ? WHERE id = ?", (int(sort), fid))
        elif action is T.ChangeAction.tag_create and isinstance(u, T.UndoTagCreate):
            self._undo_tag_create(u.tag_id)
        elif action is T.ChangeAction.tag_update and isinstance(u, T.UndoTagUpdate):
            if self._get_tag(u.tag_id) is None:
                raise T.UndoRefused("not_undoable", "the tag no longer exists", tag_id=u.tag_id)
            before = {k: v for k, v in u.before.items() if k in ("name", "color")}
            if before:
                cols = ", ".join(f"{k} = ?" for k in before)
                self.db.execute(
                    f"UPDATE tags SET {cols} WHERE id = ?", (*before.values(), u.tag_id)
                )
        elif action is T.ChangeAction.tag_delete and isinstance(u, T.UndoTagDelete):
            t = dict(u.tag)
            if self._get_tag(t.get("id")) is not None:
                raise T.UndoRefused("not_undoable", "the tag exists again", tag_id=t.get("id"))
            self.db.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
                (t["id"], t["name"], t.get("color"), t.get("created_at") or self._now()),
            )
        else:
            raise T.UndoRefused("not_undoable", f"taxonomy cannot undo {action.value}")

    def _undo_folder_create(self, folder_id: str) -> None:
        if self.get_folder(folder_id) is None:
            return
        in_use = self.db.query_one(
            "SELECT 1 AS x FROM channels WHERE folder_id = ?"
            " UNION ALL SELECT 1 AS x FROM folders WHERE parent_id = ? LIMIT 1",
            (folder_id, folder_id),
        )
        if in_use:
            raise T.UndoRefused(
                "not_undoable",
                "the folder already has channels or subfolders; delete the folder instead of"
                " undoing",
                folder_id=folder_id,
            )
        self.db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))

    def _undo_folder_update(self, u: T.UndoFolderUpdate) -> None:
        if self.get_folder(u.folder_id) is None:
            raise T.UndoRefused(
                "not_undoable", "the folder no longer exists", folder_id=u.folder_id
            )
        before = {k: v for k, v in u.before.items() if k in ("name", "color", "parent_id", "sort")}
        if "parent_id" in before and before["parent_id"] is not None:
            parent = before["parent_id"]
            if self.get_folder(parent) is None:
                raise T.UndoRefused(
                    "not_undoable",
                    "the original parent folder no longer exists",
                    folder_id=u.folder_id,
                )
            if parent in self.descendants(u.folder_id):
                raise T.UndoRefused(
                    "not_undoable",
                    "moving the folder back would create a cycle",
                    folder_id=u.folder_id,
                )
        if before:
            cols = ", ".join(f"{k} = ?" for k in before)
            self.db.execute(
                f"UPDATE folders SET {cols} WHERE id = ?", (*before.values(), u.folder_id)
            )

    def _undo_folder_delete(self, u: T.UndoFolderDelete) -> None:
        f = dict(u.folder)
        folder_id = f.get("id")
        if not folder_id or self.get_folder(folder_id) is not None:
            raise T.UndoRefused("not_undoable", "the folder exists again", folder_id=folder_id)
        parent_id = f.get("parent_id")
        if parent_id is not None and self.get_folder(parent_id) is None:
            parent_id = None  # the parent vanished since: restore at the root
        children = [c for c in u.child_folder_ids if self.get_folder(c) is not None]
        if parent_id is not None:
            for child in children:
                if parent_id in self.descendants(child):
                    raise T.UndoRefused(
                        "not_undoable",
                        "restoring the folder would create a cycle",
                        folder_id=folder_id,
                    )
        self.db.execute(
            "INSERT INTO folders (id, name, parent_id, color, sort, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                folder_id,
                f["name"],
                parent_id,
                f.get("color"),
                int(f.get("sort") or 0),
                f.get("created_at") or self._now(),
            ),
        )
        for child in children:
            self.db.execute("UPDATE folders SET parent_id = ? WHERE id = ?", (folder_id, child))

    def _undo_tag_create(self, tag_id: str) -> None:
        if self._get_tag(tag_id) is None:
            return
        if self.db.query_one("SELECT 1 AS x FROM channel_tags WHERE tag_id = ? LIMIT 1", (tag_id,)):
            raise T.UndoRefused(
                "not_undoable",
                "the tag is already on channels; delete the tag instead of undoing",
                tag_id=tag_id,
            )
        self.db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    channels: T.ChannelService,
    changelog: T.ChangeLog,
    clock: T.Clock | None = None,
) -> T.TaxonomyService:
    """Only stores the dependencies (no network, no thread, no write)."""
    return TaxonomyService(
        db=db, settings=settings, channels=channels, changelog=changelog, clock=clock
    )
