"""Data: real ``DataOps`` — demo, MyTube import and the plugin's JSON export/import.

Everything goes through the services (``TaxonomyService``, ``ChannelService``, ``TabService``,
``VideoStateService``); the only SQL here is **reading** (export of ``video_state``/``themes``).

Invariants (``DataOps`` contract + ``tests/fakes/invariants.py``):

- export never carries ``EXPORT_EXCLUDED_TABLES`` (queue, jobs, searches, devices…); import reads
  only the known sections and ignores everything else — it **never** creates a ``unsub_queue``
  item;
- import merges: what already exists stays as the user left it (folder, ⭐, tags, relation, muted,
  video state); only what is new comes in with the file's data;
- imports record ``data_import`` in the history (not undoable) in the same group as the creations;
- a backup file is untrusted input: channel ``url`` and ``thumb`` are kept only when they point to
  YouTube (``safe_channel_url``/``safe_thumb_url``), since the Desktop opens the link with the
  system's opener and loads the image.

Export format (``schema_version`` = ``T.SCHEMA_VERSION``)::

    {"schema_version": 1, "app": PLUGIN_ID, "exported_at": ts,
     "folders": [{id, name, parent_id, color, sort}], "tags": [{id, name, color}],
     "channels": [{id, title, handle, thumb, url, relation, source, folder_id, favorite, muted,
                   added_at, unsubscribed_at, ai_note, tag_ids}],
     "tabs": [{id, name, icon, kind, rules, filters, sort, builtin}],
     "themes": [{...themes row, "items": [...theme_items]}],
     "video_state": [{video_id, state, reaction, updated_at}]}

Import also accepts the nested layout ``{"schema_version", "tables": {...}}`` (the fake's) and
``channel_tags`` as a list of links. Themes are exported but **not** imported (``Themes`` is not
among the dependencies): theme references in tabs are dropped with a warning.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import dedup
from tube_pkg.core import types as T

GROUP_DEMO_LOAD = "demo mode"
GROUP_DEMO_CLEAR = "clear demo"
GROUP_IMPORT_JSON = "import JSON"
GROUP_IMPORT_MYTUBE = "import MyTube"

_THEME_JSON_COLUMNS = ("searches", "seeds")
_MYTUBE_NON_CHANNEL = ("playlist", "video")


# --------------------------------------------------------------------------- tolerant reading


def _pick(d: Mapping[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def _str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _section(data: Mapping[str, Any], key: str, what: str) -> list[Mapping[str, Any]]:
    """List of objects (missing = empty); another type → ``ValidationError``."""
    raw = data.get(key)
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(isinstance(x, Mapping) for x in raw):
        raise T.ValidationError(f"{what}: expected a list of objects", field=key)
    return raw


_THUMB_HOST_SUFFIXES = ("ggpht.com", "googleusercontent.com", "ytimg.com")
"""Image hosts YouTube serves channel avatars and video thumbnails from."""


def safe_channel_url(value: Any) -> str | None:
    """A channel link from an untrusted source, kept only if it is an ``https`` YouTube URL.

    A backup file or an extension batch could carry ``file:``, ``javascript:``, a look-alike host
    or a private address; the Desktop hands this URL to the system's opener ("Open on YouTube").
    A bare ``@handle`` or ``UC…`` id becomes its canonical URL; anything else is dropped.
    """
    text = _str(value)
    if text is None:
        return None
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    if parts.scheme:
        if parts.scheme.lower() != "https" or host not in dedup.YOUTUBE_HOSTS:
            return None
        if parts.username or parts.password or parts.port not in (None, 443):
            return None
        return text
    return dedup.canonical_channel_url(text)


def safe_thumb_url(value: Any) -> str | None:
    """An avatar/thumbnail URL from an untrusted source: ``https`` on a YouTube image host only
    (anything else would make the Desktop and the extension load an image from anywhere)."""
    text = _str(value)
    if text is None:
        return None
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return None
    if parts.scheme.lower() != "https" or parts.username or parts.password:
        return None
    if port not in (None, 443):
        return None
    if not any(host == s or host.endswith("." + s) for s in _THUMB_HOST_SUFFIXES):
        return None
    return text


def _json_obj(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


@dataclass
class _Rows:
    """Normalized input shared by MyTube and the plugin JSON."""

    folders: list[dict[str, Any]] = field(default_factory=list)
    tags: list[dict[str, Any]] = field(default_factory=list)
    channels: list[dict[str, Any]] = field(default_factory=list)
    skipped: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class _Applied:
    folder_map: dict[str, str] = field(default_factory=dict)
    tag_map: dict[str, str] = field(default_factory=dict)
    channels: int = 0
    folders: int = 0
    tags: int = 0
    skipped: int = 0
    warnings: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- DataOps


class DataOps:
    """``DataOps`` through the services (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        channels: T.ChannelService,
        taxonomy: T.TaxonomyService,
        tabs: T.TabService,
        video_state: T.VideoStateService,
        demo: T.DemoLoader,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.channels = channels
        self.taxonomy = taxonomy
        self.tabs = tabs
        self.video_state = video_state
        self.demo = demo
        self.changelog = changelog
        self.clock = clock or T.SystemClock()

    # ------------------------------------------------------------------ demo

    def load_demo(self, ui_locale: str | None = None) -> T.DataReport:
        with self.db.transaction(), self.changelog.group(GROUP_DEMO_LOAD):
            report = self.demo.load(ui_locale=ui_locale)
            if report.channels or report.folders or report.tabs:
                self.changelog.record(
                    T.Actor.user,
                    T.ChangeAction.demo_load,
                    {"label": GROUP_DEMO_LOAD, "channels": report.channels},
                    T.UndoDemoLoad(),
                )
        return report

    def clear_demo(self) -> T.DataReport:
        with self.db.transaction(), self.changelog.group(GROUP_DEMO_CLEAR):
            return self.demo.clear()

    def demo_loaded(self) -> bool:
        return bool(self.demo.is_loaded())

    # ------------------------------------------------------------------ export

    def export_json(self) -> dict[str, Any]:
        folders = [
            {
                "id": f.id,
                "name": f.name,
                "parent_id": f.parent_id,
                "color": f.color,
                "sort": f.sort,
            }
            for f in self.taxonomy.list_folders()
        ]
        tags = [{"id": t.id, "name": t.name, "color": t.color} for t in self.taxonomy.list_tags()]
        channels = [
            {
                "id": c.id,
                "title": c.title,
                "handle": c.handle,
                "thumb": c.thumb,
                "url": c.url,
                "relation": c.relation.value,
                "source": c.source.value,
                "folder_id": c.folder_id,
                "favorite": c.favorite,
                "muted": c.muted,
                "added_at": c.added_at,
                "unsubscribed_at": c.unsubscribed_at,
                "ai_note": c.ai_note,
                "tag_ids": list(c.tag_ids),
            }
            for c in self.channels.list(T.ChannelFilter())
        ]
        tabs = [
            {
                "id": t.id,
                "name": t.name,
                "icon": t.icon,
                "kind": t.kind.value,
                "rules": t.rules.to_dict(),
                "filters": T.to_jsonable(dict(t.filters)),
                "sort": t.sort,
                "builtin": t.builtin,
            }
            for t in self.tabs.list()
        ]
        return {
            "schema_version": T.SCHEMA_VERSION,
            "app": PLUGIN_ID,
            "exported_at": self.clock.now(),
            "folders": folders,
            "tags": tags,
            "channels": channels,
            "tabs": tabs,
            "themes": self._export_themes(),
            "video_state": [
                {
                    "video_id": r["video_id"],
                    "state": r["state"],
                    "reaction": r["reaction"],
                    "updated_at": r["updated_at"],
                }
                for r in self.db.query(
                    "SELECT video_id, state, reaction, updated_at FROM video_state"
                    " ORDER BY video_id"
                )
            ],
        }

    def _export_themes(self) -> list[dict[str, Any]]:
        """Reads ``themes``/``theme_items`` (for the backup; import does not recreate themes)."""
        items: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in self.db.query("SELECT * FROM theme_items ORDER BY theme_id, video_id"):
            row = dict(r)
            items[str(row.pop("theme_id"))].append(row)
        out = []
        for r in self.db.query("SELECT * FROM themes ORDER BY id"):
            row = dict(r)
            for col in _THEME_JSON_COLUMNS:
                if col in row:
                    row[col] = _json_obj(row[col])
            row["items"] = items.get(str(row["id"]), [])
            out.append(row)
        return out

    # ------------------------------------------------------------------ import JSON

    def import_json(self, data: Mapping[str, Any]) -> T.DataReport:
        if not isinstance(data, Mapping):
            raise T.ValidationError("import: expected a JSON object")
        version = data.get("schema_version")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise T.ValidationError(
                "import: file without schema_version (not an export of this plugin)",
                field="schema_version",
            )
        if version > T.SCHEMA_VERSION:
            raise T.ValidationError(
                f"import: export of version {version}, newer than this one ({T.SCHEMA_VERSION})",
                field="schema_version",
            )
        nested = data.get("tables")
        tables: Mapping[str, Any] = nested if isinstance(nested, Mapping) else data
        folders = _section(tables, "folders", "folders")
        tags = _section(tables, "tags", "tags")
        channels = _section(tables, "channels", "channels")
        links = _section(tables, "channel_tags", "tag links")
        tabs = _section(tables, "tabs", "tabs")
        themes = _section(tables, "themes", "themes")
        states = _section(tables, "video_state", "video state")

        rows = _Rows()
        rows.folders = [
            {
                "id": _str(f.get("id")),
                "name": f.get("name"),
                "parent_id": _str(f.get("parent_id")),
                "color": _str(f.get("color")),
                "sort": f.get("sort") if isinstance(f.get("sort"), int) else 0,
            }
            for f in folders
        ]
        rows.tags = [
            {"id": _str(t.get("id")), "name": t.get("name"), "color": _str(t.get("color"))}
            for t in tags
        ]
        linked: dict[str, list[str]] = defaultdict(list)
        for link in links:
            cid, tid = _str(link.get("channel_id")), _str(link.get("tag_id"))
            if cid and tid:
                linked[cid].append(tid)
        for c in channels:
            cid = _str(c.get("id"))
            if not cid or not dedup.is_channel_id(cid):
                rows.skipped += 1
                continue
            try:
                relation = T.Relation(c.get("relation") or T.Relation.followed)
                source = T.ChannelSource(c.get("source") or T.ChannelSource.link)
            except ValueError:
                rows.skipped += 1
                continue
            tag_ids = c.get("tag_ids")
            tag_list = (
                [t for t in tag_ids if isinstance(t, str)] if isinstance(tag_ids, list) else []
            )
            rows.channels.append(
                {
                    "id": cid,
                    "title": _str(c.get("title")) or cid,
                    "handle": _str(c.get("handle")),
                    "url": safe_channel_url(c.get("url")),
                    "thumb": safe_thumb_url(c.get("thumb")),
                    "folder_id": _str(c.get("folder_id")),
                    "tag_ids": tag_list + linked.get(cid, []),
                    "favorite": bool(c.get("favorite")),
                    "muted": bool(c.get("muted")),
                    "ai_note": _str(c.get("ai_note")),
                    "relation": relation,
                    "source": source,
                }
            )
        if rows.skipped:
            rows.warnings.append(f"{rows.skipped} channels without a valid UC… id were not kept")

        with self.db.transaction(), self.changelog.group(GROUP_IMPORT_JSON):
            applied = self._apply_tree(rows, keep_relation=True)
            tabs_created, tab_warnings = self._import_tabs(tabs, applied)
            applied.warnings.extend(tab_warnings)
            if themes:
                applied.warnings.append(
                    f"{len(themes)} themes were not imported (create them again in Home or chat)"
                )
            videos = self._import_video_state(states)
            self.changelog.record(
                T.Actor.user,
                T.ChangeAction.data_import,
                {"label": GROUP_IMPORT_JSON, "kind": "json", "channels": applied.channels},
                T.UndoNotSupported(),
            )
        return T.DataReport(
            channels=applied.channels,
            folders=applied.folders,
            tags=applied.tags,
            tabs=tabs_created,
            videos=videos,
            skipped=applied.skipped,
            warnings=tuple(applied.warnings),
        )

    # ------------------------------------------------------------------ import MyTube

    def import_mytube(self, data: Mapping[str, Any]) -> T.DataReport:
        """MyTube v0.9 backup — sidebar export ``{version, exportedAt, state, watchHistory}`` or
        options-page export ``{organizables, folders, tags, …, watchHistory}``. Also accepts
        ``channels`` instead of ``organizables`` (the fake's tolerant format)."""
        if not isinstance(data, Mapping):
            raise T.ValidationError("MyTube backup: expected a JSON object")
        state: Any = data.get("state", data)
        if not isinstance(state, Mapping):
            raise T.ValidationError('MyTube backup: invalid "state"', field="state")
        orgs_key = "organizables" if "organizables" in state else "channels"
        if orgs_key not in state and "folders" not in state and "tags" not in state:
            raise T.ValidationError(
                "this does not look like a MyTube backup (channels and folders are missing)"
            )
        orgs = _section(state, orgs_key, "MyTube channels")
        folders = _section(state, "folders", "MyTube folders")
        tags = _section(state, "tags", "MyTube tags")
        history_raw = data.get("watchHistory", state.get("watchHistory"))
        history = (
            [h for h in history_raw if isinstance(h, Mapping)]
            if isinstance(history_raw, list)
            else []
        )

        rows = _Rows()
        rows.folders = [
            {
                "id": _str(_pick(f, "id")),
                "name": _pick(f, "name", "title"),
                "parent_id": _str(_pick(f, "parentId", "parent_id")),
                "color": _str(_pick(f, "color")),
                "sort": _pick(f, "order", "sort")
                if isinstance(_pick(f, "order", "sort"), int)
                else 0,
            }
            for f in folders
        ]
        rows.tags = [
            {
                "id": _str(_pick(t, "id")),
                "name": _pick(t, "name"),
                "color": _str(_pick(t, "color")),
            }
            for t in tags
        ]
        not_channels = 0
        no_id = 0
        for o in orgs:
            kind = o.get("type", "channel")
            if kind != "channel":
                not_channels += 1
                continue
            cid = next(
                (
                    v
                    for v in (_pick(o, k) for k in ("youtubeId", "channelId", "channel_id", "id"))
                    if isinstance(v, str) and dedup.is_channel_id(v)
                ),
                None,
            )
            if cid is None:
                no_id += 1
                continue
            handle = _str(o.get("handle"))
            if handle and not handle.startswith("@"):
                handle = "@" + handle
            tag_ids = _pick(o, "tagIds", "tags", "tag_ids")
            rows.channels.append(
                {
                    "id": cid,
                    "title": _str(_pick(o, "name", "title")) or cid,
                    "handle": handle,
                    "url": safe_channel_url(o.get("url")),
                    "thumb": safe_thumb_url(_pick(o, "thumbnailUrl", "thumb")),
                    "folder_id": _str(_pick(o, "folderId", "folder_id")),
                    "tag_ids": [t for t in tag_ids if isinstance(t, str)]
                    if isinstance(tag_ids, list)
                    else [],
                    "favorite": bool(_pick(o, "favorite", "starred")),
                    "muted": bool(o.get("muted")),
                    "ai_note": None,
                    "relation": T.Relation.followed,
                    "source": T.ChannelSource.mytube,
                }
            )
        rows.skipped = not_channels + no_id
        if not_channels:
            rows.warnings.append(
                f"{not_channels} MyTube playlists/videos are not channels and were not kept"
            )
        if no_id:
            rows.warnings.append(f"{no_id} channels without a UC… id were not kept")

        watched = [
            vid
            for vid in dict.fromkeys(_str(h.get("videoId")) for h in history)
            if vid and dedup.is_video_id(vid)
        ]
        with self.db.transaction(), self.changelog.group(GROUP_IMPORT_MYTUBE):
            applied = self._apply_tree(rows, keep_relation=False)
            videos = self._import_video_state(
                [{"video_id": v, "state": T.VideoState.watched.value} for v in watched]
            )
            self.changelog.record(
                T.Actor.user,
                T.ChangeAction.data_import,
                {"label": GROUP_IMPORT_MYTUBE, "kind": "mytube", "channels": applied.channels},
                T.UndoNotSupported(),
            )
        return T.DataReport(
            channels=applied.channels,
            folders=applied.folders,
            tags=applied.tags,
            videos=videos,
            skipped=applied.skipped,
            warnings=tuple(applied.warnings),
        )

    # ------------------------------------------------------------------ shared parts

    def _apply_tree(self, rows: _Rows, *, keep_relation: bool) -> _Applied:
        out = _Applied(skipped=rows.skipped, warnings=list(rows.warnings))
        self._import_folders(rows.folders, out)
        self._import_tags(rows.tags, out)
        self._import_channels(rows.channels, out, keep_relation=keep_relation)
        return out

    def _import_folders(self, folders: Sequence[Mapping[str, Any]], out: _Applied) -> None:
        """Folders in tree order (parent before child; siblings by ``sort``/name). The same folder
        (normalized name under the same parent) is reused; a cycle becomes a root."""
        by_id = {f["id"]: f for f in folders if f.get("id")}
        bad = sum(1 for f in folders if not f.get("id") or not _str(f.get("name")))
        children: dict[str | None, list[Mapping[str, Any]]] = defaultdict(list)
        for f in by_id.values():
            parent = f.get("parent_id")
            parent = parent if parent in by_id and parent != f["id"] else None
            children[parent].append(f)

        def order(items: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
            return sorted(items, key=lambda f: (f.get("sort") or 0, str(f.get("name") or "")))

        done: set[str] = set()
        queue: list[Mapping[str, Any]] = order(children[None])
        while True:
            while queue:
                f = queue.pop(0)
                if f["id"] in done:
                    continue
                done.add(f["id"])
                name = _str(f.get("name"))
                if name is not None:
                    parent_new = out.folder_map.get(f.get("parent_id") or "")
                    found = self.taxonomy.find_folder_by_name(name, parent_id=parent_new)
                    if found is None:
                        found = self._create_folder(name, parent_new, f.get("color"))
                        out.folders += 1
                    out.folder_map[f["id"]] = found.id
                queue.extend(order(children.get(f["id"], [])))
            rest = [f for f in by_id.values() if f["id"] not in done]
            if not rest:
                break
            queue = order(rest[:1])  # cycle: the first one becomes a root
            queue[0] = {**queue[0], "parent_id": None}
        if bad:
            out.warnings.append(f"{bad} folders without a name or id were not kept")

    def _create_folder(self, name: str, parent_id: str | None, color: Any) -> T.Folder:
        try:
            return self.taxonomy.create_folder(
                name, parent_id=parent_id, color=_str(color), actor=T.Actor.user
            )
        except T.ValidationError:
            if color is None:
                raise
            return self.taxonomy.create_folder(name, parent_id=parent_id, actor=T.Actor.user)

    def _import_tags(self, tags: Sequence[Mapping[str, Any]], out: _Applied) -> None:
        for t in tags:
            name, old = _str(t.get("name")), t.get("id")
            if not name or not old:
                continue
            found = self.taxonomy.find_tag_by_name(name)
            if found is None:
                try:
                    found = self.taxonomy.create_tag(name, color=t.get("color"), actor=T.Actor.user)
                except T.ValidationError:
                    found = self.taxonomy.create_tag(name, actor=T.Actor.user)
                out.tags += 1
            out.tag_map[old] = found.id

    def _import_channels(
        self, rows: Sequence[Mapping[str, Any]], out: _Applied, *, keep_relation: bool
    ) -> None:
        unique: dict[str, Mapping[str, Any]] = {}
        for r in rows:
            unique.setdefault(r["id"], r)
        present = (
            {c.id for c in self.channels.list(T.ChannelFilter(ids=tuple(unique)))}
            if unique
            else set()
        )

        def channel_in(r: Mapping[str, Any]) -> T.ChannelIn:
            return T.ChannelIn(
                title=r["title"],
                channel_id=r["id"],
                handle=r.get("handle"),
                url=r.get("url"),
                thumb=r.get("thumb"),
                folder_id=out.folder_map.get(r.get("folder_id") or ""),
                tag_ids=tuple(
                    dict.fromkeys(
                        out.tag_map[t] for t in r.get("tag_ids") or [] if t in out.tag_map
                    )
                ),
                favorite=bool(r.get("favorite")),
            )

        # existing: merge without changing relation, folder/tags already set, ⭐ or muted
        existing = [channel_in(r) for cid, r in unique.items() if cid in present]
        if existing:
            by_source: dict[T.ChannelSource, list[T.ChannelIn]] = defaultdict(list)
            for item in existing:
                by_source[unique[str(item.channel_id)]["source"]].append(item)
            for source, items in by_source.items():
                self.channels.upsert_many(items, source=source, relation=None, actor=T.Actor.user)

        # new: come in with the file's source and relation
        groups: dict[tuple[T.ChannelSource, T.Relation], list[T.ChannelIn]] = defaultdict(list)
        for cid, r in unique.items():
            if cid in present:
                continue
            relation = r["relation"] if keep_relation else T.Relation.followed
            groups[(r["source"], relation)].append(channel_in(r))
        inserted: list[str] = []
        for (source, relation), items in groups.items():
            report = self.channels.upsert_many(
                items, source=source, relation=relation, actor=T.Actor.user
            )
            inserted.extend(report.inserted)
        out.channels = len(inserted)

        muted = [cid for cid in inserted if unique[cid].get("muted")]
        if muted:
            self.channels.batch(T.BatchOp.mute, muted, actor=T.Actor.user)
        for cid in inserted:
            note = unique[cid].get("ai_note")
            if note:
                self.channels.update(cid, T.ChannelPatch(ai_note=note), actor=T.Actor.user)

    def _import_tabs(
        self, rows: Sequence[Mapping[str, Any]], applied: _Applied
    ) -> tuple[int, list[str]]:
        warnings: list[str] = []
        existing = {(dedup.normalize_name(t.name), t.kind.value) for t in self.tabs.list()}
        created = 0
        builtin = False
        dropped_refs = 0
        dropped_themes = 0
        failed = 0

        def remap(ids: Any, mapping: Mapping[str, str]) -> list[str]:
            nonlocal dropped_refs
            out = []
            for i in ids if isinstance(ids, list) else []:
                if i in mapping:
                    out.append(mapping[i])
                else:
                    dropped_refs += 1
            return out

        for row in sorted(
            rows, key=lambda r: r.get("sort") if isinstance(r.get("sort"), int) else 0
        ):
            if row.get("builtin"):
                builtin = True
                continue
            name = _str(row.get("name"))
            try:
                kind = T.TabKind(row.get("kind"))
            except ValueError:
                failed += 1
                continue
            if name is None:
                failed += 1
                continue
            key = (dedup.normalize_name(name), kind.value)
            if key in existing:
                continue
            rules = _json_obj(row.get("rules"))
            rules = dict(rules) if isinstance(rules, Mapping) else {}
            for part in ("include", "exclude"):
                section = rules.get(part)
                if not isinstance(section, Mapping):
                    continue
                section = dict(section)
                if "folders" in section:
                    section["folders"] = remap(section["folders"], applied.folder_map)
                if "tags" in section:
                    section["tags"] = remap(section["tags"], applied.tag_map)
                if part == "include" and section.get("themes"):
                    dropped_themes += len(section["themes"])
                    section["themes"] = []
                rules[part] = section
            filters = _json_obj(row.get("filters"))
            try:
                tab_rules = T.TabRules.from_dict(rules)
                self.tabs.create(
                    T.TabDraft(
                        name=name,
                        kind=kind,
                        rules=tab_rules,
                        icon=_str(row.get("icon")),
                        filters=dict(filters) if isinstance(filters, Mapping) else {},
                    ),
                    actor=T.Actor.user,
                )
            except T.TubeError:
                failed += 1
                continue
            existing.add(key)
            created += 1
        if builtin:
            self.tabs.ensure_builtin()
        if dropped_refs:
            warnings.append(f"{dropped_refs} folders/tags named in tabs were not in the file")
        if dropped_themes:
            warnings.append(
                f"{dropped_themes} theme references left the tabs (themes are not imported)"
            )
        if failed:
            warnings.append(f"{failed} invalid tabs were not kept")
        return created, warnings

    def _import_video_state(self, rows: Sequence[Mapping[str, Any]]) -> int:
        """Only videos without a row in the database (the user's current state wins)."""
        wanted: dict[str, tuple[T.VideoState, T.Reaction | None]] = {}
        for r in rows:
            vid = _str(r.get("video_id"))
            if not vid or not dedup.is_video_id(vid):
                continue
            try:
                state = T.VideoState(r.get("state") or T.VideoState.new)
                reaction = T.Reaction(r["reaction"]) if r.get("reaction") else None
            except ValueError:
                continue
            wanted.setdefault(vid, (state, reaction))
        if not wanted:
            return 0
        have = self.video_state.get(list(wanted))
        fresh = {vid: v for vid, v in wanted.items() if vid not in have}
        by_state: dict[T.VideoState, list[str]] = defaultdict(list)
        for vid, (state, _) in fresh.items():
            by_state[state].append(vid)
        for state, vids in by_state.items():
            self.video_state.set_state(vids, state, actor=T.Actor.extension)
        for vid, (_, reaction) in fresh.items():
            if reaction is not None:
                self.video_state.set_reaction(vid, reaction, actor=T.Actor.extension)
        return len(fresh)

    # ------------------------------------------------------------------ undo

    def apply_undo(self, change: T.ChangeRecord) -> None:
        if change.action is T.ChangeAction.demo_load and isinstance(change.undo, T.UndoDemoLoad):
            # demo channels leave here; folders and the tab created in the same group are undone
            # by their owners (folder_create / tab_create) right after, in ChangeLog order
            self.channels.remove_by_source(T.ChannelSource.demo)
            forget: Callable[[], None] | None = getattr(self.demo, "mark_unloaded", None)
            if callable(forget):
                forget()
            else:  # foreign DemoLoader: reset the contract flag
                self.db.execute(
                    "INSERT INTO meta (key, value) VALUES (?, '0')"
                    " ON CONFLICT(key) DO UPDATE SET value = '0'",
                    (T.META_DEMO_LOADED,),
                )
            return
        raise T.UndoRefused("not_undoable", f"an import cannot be undone ({change.action})")


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    channels: T.ChannelService,
    taxonomy: T.TaxonomyService,
    tabs: T.TabService,
    video_state: T.VideoStateService,
    demo: T.DemoLoader,
    changelog: T.ChangeLog,
    clock: T.Clock | None = None,
) -> T.DataOps:
    """``DataOps`` over the given services. No network and no thread."""
    return DataOps(
        db=db,
        settings=settings,
        channels=channels,
        taxonomy=taxonomy,
        tabs=tabs,
        video_state=video_state,
        demo=demo,
        changelog=changelog,
        clock=clock,
    )


__all__ = ["DataOps", "build", "safe_channel_url", "safe_thumb_url"]
