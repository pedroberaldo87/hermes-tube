"""Demo mode: the real ``DemoLoader``.

Loads ``plugin/data/demo_channels.json`` (~40 real public channels in 6 folders, a few ⭐ and one
theme tab) **through the services** — ``TaxonomyService`` for folders,
``ChannelService.upsert_many`` for channels (``source=demo``, ``followed``) and ``TabService`` for
the tab. It never writes SQL into another module's table; its only own data lives in ``meta``
(``demo_loaded`` and the manifest of what the demo created, so it can be cleared without touching
anything else).

"Do not touch real data" rules:

- a demo channel that already exists in the database (real subscription, link, import…) stays as
  it is — no folder, title or ⭐ change (``skipped`` + warning);
- a folder with the same name as a user folder is reused and never deleted;
- clearing removes only ``source=demo`` channels that never became subscriptions
  (``ChannelService.remove_by_source``), the tab created by the demo and the folders created by
  the demo that ended up empty.

Language: folder and tab names use the language resolved at ``load`` time (``core/lang``:
explicit setting; in ``auto``, the ``ui_locale`` the screen sends; then the profile's Hermes
language; otherwise English). The JSON catalog stores pt-BR names; the English ones live in
``EN_NAMES``. Loading again in another language **only renames** what the demo created and still
has a catalog name (a folder renamed by the user, or reused from the user, stays as it is).

No network, no thread; the channels' RSS arrives later through ``Refresher.kick_if_due``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import lang as lang_rule
from tube_pkg.core import types as T

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "demo_channels.json"
"""Committed catalog (ids checked by the ``live`` test in ``tests/test_data.py``)."""

META_DEMO_MANIFEST = "demo_manifest"
"""``meta``: JSON ``{"folders": [ids created by the demo], "tab": id | null}`` plus
``"lang"`` (language of the names), ``"folder_keys"`` (id → catalog key) and ``"tab_key"``."""

EN_NAMES: dict[str, str] = {
    "folder:tech": "Technology",
    "folder:science": "Science",
    "folder:cooking": "Cooking",
    "folder:music": "Music",
    "folder:news": "News",
    "folder:games": "Games",
    "tab:ai": "Artificial intelligence",
}
"""English names of the catalog folders and tabs (the JSON has the pt-BR ones), by ``kind:key``."""

_TEXT: dict[str, dict[str, str]] = {
    "pt": {
        "skipped": "{n} canais da demo já estavam na sua lista e ficaram como estavam",
        "kept": "{n} canais da demo já eram inscrições reais e ficaram",
        "in_use": "{n} pastas da demo ficaram porque ainda têm canais seus",
    },
    "en": {
        "skipped": "{n} demo channels were already in your list and were left as they were",
        "kept": "{n} demo channels had become real subscriptions and were kept",
        "in_use": "{n} demo folders were kept because they still hold your channels",
    },
}


def demo_name(kind: str, key: str, pt_name: str, lang: str) -> str:
    """Name of catalog folder/tab *key* in language *lang* (``kind`` = ``folder``/``tab``)."""
    if lang_rule.normalize(lang) == lang_rule.PT:
        return pt_name
    return EN_NAMES.get(f"{kind}:{key}", pt_name)


def _msg(lang: str, key: str, **kw: Any) -> str:
    return _TEXT[lang_rule.short(lang)][key].format(**kw)


# --------------------------------------------------------------------------- catalog


@dataclass(frozen=True, slots=True)
class DemoFolder:
    key: str
    name: str
    color: str | None = None


@dataclass(frozen=True, slots=True)
class DemoChannel:
    id: str
    title: str
    folder: str
    handle: str | None = None
    url: str | None = None
    thumb: str | None = None
    favorite: bool = False


@dataclass(frozen=True, slots=True)
class DemoTab:
    key: str
    name: str
    kind: T.TabKind
    channels: tuple[str, ...]
    icon: str | None = None


@dataclass(frozen=True, slots=True)
class DemoCatalog:
    folders: tuple[DemoFolder, ...]
    channels: tuple[DemoChannel, ...]
    tabs: tuple[DemoTab, ...]


def _text(value: Any, where: str, *, required: bool = True) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise T.ValidationError(f"demo catalog: invalid {where}")
    return value.strip()


def _items(data: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    raw = data.get(key) or []
    if not isinstance(raw, list) or not all(isinstance(x, Mapping) for x in raw):
        raise T.ValidationError(f"demo catalog: {key} must be a list of objects")
    return raw


def parse_catalog(data: Mapping[str, Any]) -> DemoCatalog:
    """Validates the catalog JSON (``ValidationError`` if anything is malformed)."""
    if not isinstance(data, Mapping):
        raise T.ValidationError("demo catalog: expected an object")
    folders = tuple(
        DemoFolder(
            key=str(_text(f.get("key"), "folders.key")),
            name=str(_text(f.get("name"), "folders.name")),
            color=_text(f.get("color"), "folders.color", required=False),
        )
        for f in _items(data, "folders")
    )
    keys = {f.key for f in folders}
    if len(keys) != len(folders):
        raise T.ValidationError("demo catalog: duplicate folder")
    channels: list[DemoChannel] = []
    for c in _items(data, "channels"):
        cid = str(_text(c.get("id"), "channels.id"))
        if not dedup.is_channel_id(cid):
            raise T.ValidationError(f"demo catalog: invalid channel id {cid!r}")
        folder = str(_text(c.get("folder"), "channels.folder"))
        if folder not in keys:
            raise T.ValidationError(f"demo catalog: unknown folder {folder!r}")
        channels.append(
            DemoChannel(
                id=cid,
                title=str(_text(c.get("title"), "channels.title")),
                folder=folder,
                handle=_text(c.get("handle"), "channels.handle", required=False),
                url=_text(c.get("url"), "channels.url", required=False),
                thumb=_text(c.get("thumb"), "channels.thumb", required=False),
                favorite=bool(c.get("favorite")),
            )
        )
    ids = [c.id for c in channels]
    if len(set(ids)) != len(ids):
        raise T.ValidationError("demo catalog: duplicate channel")
    tabs: list[DemoTab] = []
    for t in _items(data, "tabs"):
        tab_channels = tuple(t.get("channels") or ())
        if not tab_channels or not set(tab_channels) <= set(ids):
            raise T.ValidationError("demo catalog: tab with a channel outside the catalog")
        try:
            kind = T.TabKind(t.get("kind"))
        except ValueError as exc:
            raise T.ValidationError("demo catalog: invalid tab kind") from exc
        tabs.append(
            DemoTab(
                key=str(_text(t.get("key"), "tabs.key")),
                name=str(_text(t.get("name"), "tabs.name")),
                kind=kind,
                channels=tab_channels,
                icon=_text(t.get("icon"), "tabs.icon", required=False),
            )
        )
    return DemoCatalog(folders=folders, channels=tuple(channels), tabs=tuple(tabs))


@lru_cache(maxsize=4)
def load_catalog(path: str | None = None) -> DemoCatalog:
    """Reads and validates the committed catalog (cached; local file, no network)."""
    target = Path(path) if path else CATALOG_PATH
    return parse_catalog(json.loads(target.read_text(encoding="utf-8")))


# --------------------------------------------------------------------------- loader


class DemoLoader:
    """``DemoLoader`` through the services (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        channels: T.ChannelService,
        taxonomy: T.TaxonomyService,
        tabs: T.TabService,
        clock: T.Clock | None = None,
        catalog: DemoCatalog | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.channels = channels
        self.taxonomy = taxonomy
        self.tabs = tabs
        self.clock = clock or T.SystemClock()
        self._catalog = catalog

    @property
    def catalog(self) -> DemoCatalog:
        return self._catalog or load_catalog()

    # ------------------------------------------------------------------ meta (own)

    def _meta_get(self, key: str) -> str | None:
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (key,))
        return None if row is None else row["value"]

    def _meta_set(self, key: str, value: str | None) -> None:
        if value is None:
            self.db.execute("DELETE FROM meta WHERE key = ?", (key,))
            return
        self.db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def manifest(self) -> dict[str, Any]:
        """What the last load created: ``{"folders": [...], "tab": id | None}``."""
        raw = self._meta_get(META_DEMO_MANIFEST)
        try:
            data = json.loads(raw) if raw else {}
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        folders = [f for f in data.get("folders") or [] if isinstance(f, str)]
        tab = data.get("tab") if isinstance(data.get("tab"), str) else None
        raw_keys = data.get("folder_keys")
        keys = (
            {k: v for k, v in raw_keys.items() if isinstance(k, str) and isinstance(v, str)}
            if isinstance(raw_keys, dict)
            else {}
        )
        lang = lang_rule.normalize(data.get("lang"))
        tab_key = data.get("tab_key") if isinstance(data.get("tab_key"), str) else None
        return {
            "folders": folders,
            "tab": tab,
            "lang": lang,
            "folder_keys": keys,
            "tab_key": tab_key,
        }

    def mark_unloaded(self) -> None:
        """Forgets the demo (``demo_loaded = 0`` and manifest). Also used by undo."""
        self._meta_set(T.META_DEMO_LOADED, "0")
        self._meta_set(META_DEMO_MANIFEST, None)

    def is_loaded(self) -> bool:
        return self._meta_get(T.META_DEMO_LOADED) == "1"

    # ------------------------------------------------------------------ load

    def load(self, ui_locale: str | None = None) -> T.DataReport:
        """Loads the demo with names in the resolved language (*ui_locale* = what the screen
        reported). Already loaded: same language does nothing; another one only renames
        (``_relabel``)."""
        lang = lang_rule.resolve(self.settings, ui_locale)
        if self.is_loaded():
            with self.db.transaction():
                self._relabel(lang)
            return T.DataReport()
        catalog = self.catalog
        warnings: list[str] = []
        with self.db.transaction():
            folder_ids: dict[str, str] = {}
            created_folders: list[str] = []
            folder_keys: dict[str, str] = {}
            for f in catalog.folders:
                name = demo_name("folder", f.key, f.name, lang)
                found = self.taxonomy.find_folder_by_name(name, parent_id=None)
                if found is None:
                    found = self.taxonomy.create_folder(name, color=f.color, actor=T.Actor.user)
                    created_folders.append(found.id)
                    folder_keys[found.id] = f.key
                folder_ids[f.key] = found.id

            wanted = tuple(c.id for c in catalog.channels)
            existing = {c.id for c in self.channels.list(T.ChannelFilter(ids=wanted))}
            fresh = [c for c in catalog.channels if c.id not in existing]
            report = self.channels.upsert_many(
                [
                    T.ChannelIn(
                        title=c.title,
                        channel_id=c.id,
                        handle=c.handle,
                        url=c.url,
                        thumb=c.thumb,
                        folder_id=folder_ids[c.folder],
                        favorite=c.favorite,
                    )
                    for c in fresh
                ],
                source=T.ChannelSource.demo,
                relation=T.Relation.followed,
                actor=T.Actor.extension,  # no per-channel history: the group holds the demo_load
            )
            skipped = len(catalog.channels) - len(report.inserted)
            if skipped:
                warnings.append(_msg(lang, "skipped", n=skipped))

            tab_id: str | None = None
            tab_key: str | None = None
            for t in catalog.tabs[:1]:
                tab = self.tabs.create(
                    T.TabDraft(
                        name=demo_name("tab", t.key, t.name, lang),
                        kind=t.kind,
                        icon=t.icon,
                        rules=T.TabRules(include=T.RuleInclude(channels=t.channels)),
                    ),
                    actor=T.Actor.user,
                )
                tab_id = tab.id
                tab_key = t.key

            manifest = {
                "folders": created_folders,
                "tab": tab_id,
                "lang": lang,
                "folder_keys": folder_keys,
                "tab_key": tab_key,
            }
            self._meta_set(META_DEMO_MANIFEST, json.dumps(manifest))
            self._meta_set(T.META_DEMO_LOADED, "1")
        return T.DataReport(
            channels=len(report.inserted),
            folders=len(created_folders),
            tabs=1 if tab_id else 0,
            skipped=skipped,
            warnings=tuple(warnings),
        )

    def _relabel(self, lang: str) -> int:
        """Demo already loaded in another language: renames the folders and the tab **created by the
        demo** that still have a catalog name (in any language). A name changed by the user, a
        reused user folder or a name already taken → left as it is. Returns how many changed."""
        manifest = self.manifest()
        if manifest["lang"] == lang:
            return 0
        catalog = self.catalog
        by_key = {f.key: f for f in catalog.folders}
        changed = 0
        for folder_id in manifest["folders"]:
            folder = self.taxonomy.get_folder(folder_id)
            if folder is None:
                continue
            key = manifest["folder_keys"].get(folder_id) or self._key_by_name(folder.name)
            spec = by_key.get(key or "")
            if spec is None or not self._is_catalog_name(
                "folder", spec.key, spec.name, folder.name
            ):
                continue
            target = demo_name("folder", spec.key, spec.name, lang)
            if target == folder.name:
                continue
            try:
                self.taxonomy.update_folder(folder_id, name=target, actor=T.Actor.user)
                changed += 1
            except T.TubeError:  # name taken by a user folder: leave it as it is
                continue
        tab = self.tabs.get(manifest["tab"]) if manifest["tab"] else None
        tab_spec = next(
            (t for t in catalog.tabs if t.key == manifest["tab_key"]),
            catalog.tabs[0] if catalog.tabs else None,
        )
        if tab is not None and tab_spec is not None:
            if self._is_catalog_name("tab", tab_spec.key, tab_spec.name, tab.name):
                target = demo_name("tab", tab_spec.key, tab_spec.name, lang)
                if target != tab.name:
                    self.tabs.update(tab.id, T.TabPatch(name=target), actor=T.Actor.user)
                    changed += 1
        data = json.loads(self._meta_get(META_DEMO_MANIFEST) or "{}")
        if isinstance(data, dict):
            data["lang"] = lang
            self._meta_set(META_DEMO_MANIFEST, json.dumps(data))
        return changed

    @staticmethod
    def _is_catalog_name(kind: str, key: str, pt_name: str, current: str) -> bool:
        return current in {demo_name(kind, key, pt_name, code) for code in lang_rule.SUPPORTED}

    def _key_by_name(self, name: str) -> str | None:
        for f in self.catalog.folders:
            if self._is_catalog_name("folder", f.key, f.name, name):
                return f.key
        return None

    # ------------------------------------------------------------------ clear

    def clear(self) -> T.DataReport:
        manifest = self.manifest()
        lang = lang_rule.resolve(self.settings)
        warnings: list[str] = []
        with self.db.transaction():
            removed = self.channels.remove_by_source(T.ChannelSource.demo)
            kept = self.channels.list(T.ChannelFilter(source=T.ChannelSource.demo))
            if kept:
                warnings.append(_msg(lang, "kept", n=len(kept)))
            tabs_removed = 0
            tab_id = manifest["tab"]
            if tab_id and self.tabs.get(tab_id) is not None:
                self.tabs.delete(tab_id, actor=T.Actor.user)
                tabs_removed = 1
            folders_removed = 0
            in_use = 0
            for folder_id in reversed(manifest["folders"]):  # children before parents
                if self.taxonomy.get_folder(folder_id) is None:
                    continue
                if self._folder_in_use(folder_id):
                    in_use += 1
                    continue
                self.taxonomy.delete_folder(folder_id, actor=T.Actor.user)
                folders_removed += 1
            if in_use:
                warnings.append(_msg(lang, "in_use", n=in_use))
            self.mark_unloaded()
        return T.DataReport(
            channels=removed,
            folders=folders_removed,
            tabs=tabs_removed,
            skipped=len(kept),
            warnings=tuple(warnings),
        )

    def _folder_in_use(self, folder_id: str) -> bool:
        if self.channels.list(T.ChannelFilter(folder_id=folder_id, recursive=False, limit=1)):
            return True
        return any(f.parent_id == folder_id for f in self.taxonomy.list_folders())


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    channels: T.ChannelService,
    taxonomy: T.TaxonomyService,
    tabs: T.TabService,
    clock: T.Clock | None = None,
) -> T.DemoLoader:
    """``DemoLoader`` over the given services. No network, no thread (the catalog is read on the
    first ``load``)."""
    return DemoLoader(
        db=db, settings=settings, channels=channels, taxonomy=taxonomy, tabs=tabs, clock=clock
    )


__all__ = [
    "CATALOG_PATH",
    "EN_NAMES",
    "META_DEMO_MANIFEST",
    "DemoCatalog",
    "DemoChannel",
    "DemoFolder",
    "DemoLoader",
    "DemoTab",
    "build",
    "demo_name",
    "load_catalog",
    "parse_catalog",
]
