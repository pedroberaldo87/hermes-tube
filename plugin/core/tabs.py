"""Real ``TabService``: tabs. Owner of the ``tabs`` table.

Rules (``types.TabService``):

- ``validate_rules`` = ``TabRules.from_dict`` (schema: unknown key, type, ``mode``,
  ``min_s > max_s``) + references: existing folders and tags (``include`` and ``exclude``) and
  themes, channels with a valid ``UC…`` id and known lenses (``HN_LENS`` by default). Error →
  ``ValidationError`` and nothing is written;
- ``create`` puts the tab last; ``reorder`` is stable (given ids first, in the given order; the rest
  follow in their current order; ``sort`` renumbered ``0..n-1``);
- built-in tabs (``builtin``) cannot be deleted (``Conflict``); ``ensure_builtin`` creates
  ``all-new`` and ``favorites`` when missing, without history and without overwriting edits;
- every write records ``ChangeLog.record`` in the same transaction; ``apply_undo`` writes straight
  to ``tabs`` and never records history.

No network, no thread; ``build`` only stores the dependencies.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import fields
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import types as T
from tube_pkg.core.taxonomy import clean_ids, clean_name

MAX_ICON = 64

NewId = Callable[[str], str]

_TAB_COLUMNS = (
    "id",
    "name",
    "icon",
    "kind",
    "rules",
    "filters",
    "sort",
    "builtin",
    "created_at",
    "updated_at",
)

BUILTIN_DRAFTS: tuple[T.TabDraft, ...] = (
    T.TabDraft(
        id=T.BUILTIN_TAB_ALL_NEW,
        name="Tudo novo",
        kind=T.TabKind.category,
        icon="▶",
        builtin=True,
        rules=T.TabRules(include=T.RuleInclude(all=True), filters=T.RuleFilters(only_new=True)),
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
"""Built-in tabs (same values as the ``FakeTabService`` fake)."""


def _uuid_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _json(value: Any) -> str:
    return json.dumps(T.to_jsonable(value), ensure_ascii=False, sort_keys=True)


def _loads(text: Any, default: Any) -> Any:
    try:
        return json.loads(text) if text else default
    except (TypeError, ValueError):
        return default


def _tab_from_row(row: Mapping[str, Any]) -> T.Tab:
    rules_raw = _loads(row["rules"], {})
    try:
        rules = T.TabRules.from_dict(rules_raw)
    except T.ValidationError:
        rules = T.TabRules()  # row written from outside with a broken rule: empty tab, not an error
    filters = _loads(row["filters"], {})
    return T.Tab(
        id=str(row["id"]),
        name=str(row["name"]),
        kind=T.TabKind(row["kind"]),
        rules=rules,
        icon=row["icon"],
        filters=filters if isinstance(filters, dict) else {},
        sort=int(row["sort"] or 0),
        builtin=bool(row["builtin"]),
    )


def _kind(value: Any) -> T.TabKind:
    try:
        return T.TabKind(value)
    except ValueError as exc:
        raise T.ValidationError(f"invalid tab kind: {value!r}", field="kind") from exc


def _icon(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > MAX_ICON:
        raise T.ValidationError("invalid icon", field="icon")
    return value.strip() or None


def _filters(value: Any) -> dict[str, Any]:
    """``tabs.filters`` (UI state): JSON object; ``None`` becomes ``{}``."""
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise T.ValidationError("filters must be an object", field="filters")
    try:
        return json.loads(_json(dict(value)))
    except (TypeError, ValueError) as exc:
        raise T.ValidationError("filters must be JSON", field="filters") from exc


def _channel_ids(ids: Any) -> tuple[str, ...]:
    if isinstance(ids, str | bytes) or not isinstance(ids, Sequence):
        raise T.ValidationError("channel_ids: expected a list", field="channel_ids")
    out = tuple(dict.fromkeys(ids))
    if not out:
        raise T.ValidationError("select at least one channel", field="channel_ids")
    bad = [c for c in out if not dedup.is_channel_id(c)]
    if bad:
        raise T.ValidationError(f"invalid channels: {bad}", field="channel_ids")
    return out


class TabService:
    """Tabs over ``tabs`` (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        new_id: NewId | None = None,
        known_lenses: Iterable[str] = (T.HN_LENS,),
    ) -> None:
        self.db = db
        self.settings = settings
        self.changelog = changelog
        self.clock = clock or T.SystemClock()
        self._new_id = new_id or _uuid_id
        self.known_lenses = frozenset(known_lenses)

    def _now(self) -> int:
        return int(self.clock.now())

    # ================================================================== read

    def list(self) -> list[T.Tab]:
        rows = self.db.query("SELECT * FROM tabs ORDER BY sort, created_at, id")
        return [_tab_from_row(r) for r in rows]

    def get(self, tab_id: str) -> T.Tab | None:
        if not isinstance(tab_id, str):
            return None
        row = self.db.query_one("SELECT * FROM tabs WHERE id = ?", (tab_id,))
        return _tab_from_row(row) if row else None

    def _require(self, tab_id: Any) -> T.Tab:
        tab = self.get(tab_id)
        if tab is None:
            raise T.NotFound(f"tab {tab_id} does not exist", tab_id=tab_id)
        return tab

    # ================================================================== rules

    def _missing(self, table: str, ids: Sequence[str]) -> list[str]:
        return [
            i
            for i in dict.fromkeys(ids)
            if not self.db.query_one(f"SELECT 1 AS x FROM {table} WHERE id = ?", (i,))
        ]

    def validate_rules(self, data: Mapping[str, Any]) -> T.TabRules:
        raw: Any = data.to_dict() if isinstance(data, T.TabRules) else data
        rules = T.TabRules.from_dict(raw)
        for label, table, ids in (
            ("folders", "folders", rules.include.folders + rules.exclude.folders),
            ("tags", "tags", rules.include.tags + rules.exclude.tags),
            ("themes", "themes", rules.include.themes),
        ):
            bad = self._missing(table, ids)
            if bad:
                raise T.ValidationError(f"unknown {label}: {bad}", field=table, ids=bad)
        bad_channels = [
            c for c in rules.include.channels + rules.exclude.channels if not dedup.is_channel_id(c)
        ]
        if bad_channels:
            raise T.ValidationError(
                f"invalid channels: {bad_channels}", field="channels", ids=bad_channels
            )
        unknown = [n for n in rules.include.lenses if n not in self.known_lenses]
        if unknown:
            raise T.ValidationError(f"unknown lenses: {unknown}", field="lenses", ids=unknown)
        return rules

    # ================================================================== write

    def _next_sort(self) -> int:
        row = self.db.query_one("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM tabs")
        return int(row["s"]) if row else 0

    def _insert(self, tab_id: str, draft: T.TabDraft, sort: int, *, ignore: bool = False) -> None:
        """Writes the row without history (used by ``create``, ``ensure_builtin`` and by the
        ``FakeThemes.save_seeded`` test shortcut)."""
        now = self._now()
        verb = "INSERT OR IGNORE" if ignore else "INSERT"
        self.db.execute(
            f"{verb} INTO tabs (id, name, icon, kind, rules, filters, sort, builtin, created_at,"
            " updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                tab_id,
                draft.name.strip(),
                draft.icon,
                T.TabKind(draft.kind).value,
                _json(draft.rules.to_dict()),
                _json(draft.filters or {}),
                sort,
                int(bool(draft.builtin)),
                now,
                now,
            ),
        )

    def create(self, draft: T.TabDraft, *, actor: T.Actor = T.Actor.user) -> T.Tab:
        actor = T.Actor(actor)
        if not isinstance(draft, T.TabDraft):
            raise T.ValidationError("invalid tab draft")
        name = clean_name(draft.name, "tab name")
        kind = _kind(draft.kind)
        icon = _icon(draft.icon)
        filters = _filters(draft.filters)
        if draft.id is not None and (not isinstance(draft.id, str) or not draft.id.strip()):
            raise T.ValidationError("invalid tab id", field="id")
        tab_id = draft.id or self._new_id("tab")
        with self.db.transaction():
            rules = self.validate_rules(draft.rules.to_dict())
            if self.get(tab_id) is not None:
                raise T.Conflict(f"tab {tab_id} already exists", tab_id=tab_id)
            clean = T.TabDraft(
                id=tab_id,
                name=name,
                kind=kind,
                rules=rules,
                icon=icon,
                filters=filters,
                builtin=bool(draft.builtin),
            )
            self._insert(tab_id, clean, self._next_sort())
            self.changelog.record(
                actor,
                T.ChangeAction.tab_create,
                {"label": name, "kind": kind.value},
                T.UndoTabCreate(tab_id=tab_id),
            )
        return self._require(tab_id)

    def update(self, tab_id: str, patch: T.TabPatch, *, actor: T.Actor = T.Actor.user) -> T.Tab:
        actor = T.Actor(actor)
        if not isinstance(patch, T.TabPatch):
            raise T.ValidationError("invalid tab patch")
        with self.db.transaction():
            current = self._require(tab_id)
            now_values: dict[str, Any] = {}
            old_values: dict[str, Any] = {}
            for f in fields(patch):
                value = getattr(patch, f.name)
                if value is T.UNSET:
                    continue
                if f.name == "name":
                    new, old = clean_name(value, "tab name"), current.name
                elif f.name == "kind":
                    new, old = _kind(value).value, current.kind.value
                elif f.name == "icon":
                    new, old = _icon(value), current.icon
                elif f.name == "filters":
                    new, old = _filters(value), dict(current.filters)
                elif f.name == "rules":
                    new, old = self.validate_rules(value).to_dict(), current.rules.to_dict()
                else:  # pragma: no cover - TabPatch only has the fields above
                    continue
                if new != old:
                    now_values[f.name] = new
                    old_values[f.name] = old
            if not now_values:
                return current
            self._write(tab_id, now_values)
            self.changelog.record(
                actor,
                T.ChangeAction.tab_update,
                {"label": current.name, "fields": sorted(now_values)},
                T.UndoTabUpdate(tab_id=tab_id, before=old_values),
            )
        return self._require(tab_id)

    def _write(self, tab_id: str, values: Mapping[str, Any]) -> None:
        cols = [k for k in values if k in ("name", "kind", "icon", "filters", "rules")]
        if not cols:
            return
        params = [_json(values[k]) if k in ("rules", "filters") else values[k] for k in cols]
        self.db.execute(
            f"UPDATE tabs SET {', '.join(f'{k} = ?' for k in cols)}, updated_at = ? WHERE id = ?",
            (*params, self._now(), tab_id),
        )

    def delete(self, tab_id: str, *, actor: T.Actor = T.Actor.user) -> None:
        actor = T.Actor(actor)
        with self.db.transaction():
            tab = self._require(tab_id)
            if tab.builtin:
                raise T.Conflict("a built-in tab cannot be deleted", tab_id=tab_id)
            row = self.db.query_one("SELECT * FROM tabs WHERE id = ?", (tab_id,))
            self.db.execute("DELETE FROM tabs WHERE id = ?", (tab_id,))
            self.changelog.record(
                actor,
                T.ChangeAction.tab_delete,
                {"label": tab.name},
                T.UndoTabDelete(tab=dict(row or {})),
            )

    def reorder(self, tab_ids: Sequence[str], *, actor: T.Actor = T.Actor.user) -> None:
        actor = T.Actor(actor)
        ids = clean_ids(tab_ids, "reorder tabs")
        with self.db.transaction():
            for tid in ids:
                self._require(tid)
            tabs = self.list()
            given = set(ids)
            order = ids + [t.id for t in tabs if t.id not in given]
            current = {t.id: t.sort for t in tabs}
            before = {tid: current[tid] for i, tid in enumerate(order) if current[tid] != i}
            if not before:
                return
            for i, tid in enumerate(order):
                if tid in before:
                    self.db.execute("UPDATE tabs SET sort = ? WHERE id = ?", (i, tid))
            self.changelog.record(
                actor,
                T.ChangeAction.tab_reorder,
                {"count": len(ids)},
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
        ids = _channel_ids(channel_ids)
        rules = T.TabRules(include=T.RuleInclude(channels=ids))
        return self.create(
            T.TabDraft(name=name, kind=T.TabKind.channels, rules=rules, icon=icon), actor=actor
        )

    def ensure_builtin(self) -> list[T.Tab]:
        with self.db.transaction():
            for draft in BUILTIN_DRAFTS:
                assert draft.id is not None
                if self.get(draft.id) is None:
                    self._insert(draft.id, draft, self._next_sort(), ignore=True)
        return [self._require(d.id) for d in BUILTIN_DRAFTS]

    # ================================================================== undo

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        action = T.ChangeAction(change.action)
        if action is T.ChangeAction.tab_create and isinstance(u, T.UndoTabCreate):
            self.db.execute("DELETE FROM tabs WHERE id = ?", (u.tab_id,))
        elif action is T.ChangeAction.tab_update and isinstance(u, T.UndoTabUpdate):
            if self.get(u.tab_id) is None:
                raise T.UndoRefused("not_undoable", "the tab no longer exists", tab_id=u.tab_id)
            self._write(u.tab_id, dict(u.before))
        elif action is T.ChangeAction.tab_delete and isinstance(u, T.UndoTabDelete):
            row = {k: v for k, v in dict(u.tab).items() if k in _TAB_COLUMNS}
            if not row.get("id") or self.get(row["id"]) is not None:
                raise T.UndoRefused("not_undoable", "the tab exists again", tab_id=row.get("id"))
            cols = list(row)
            self.db.execute(
                f"INSERT INTO tabs ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                tuple(row[c] for c in cols),
            )
        elif action is T.ChangeAction.tab_reorder and isinstance(u, T.UndoReorder):
            for tid, sort in u.before.items():
                self.db.execute("UPDATE tabs SET sort = ? WHERE id = ?", (int(sort), tid))
        else:
            raise T.UndoRefused("not_undoable", f"tabs cannot undo {action.value}")


def build(
    *, db: T.Db, settings: T.Settings, changelog: T.ChangeLog, clock: T.Clock | None = None
) -> T.TabService:
    """Only stores the dependencies (no network, no thread, no write)."""
    return TabService(db=db, settings=settings, changelog=changelog, clock=clock)
