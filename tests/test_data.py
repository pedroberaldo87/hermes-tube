"""Demo mode, MyTube import and JSON export/import (``DataOps``/``DemoLoader``).

Real database (``core.db.build``). The world of fakes is built with the real implementations
(``ChangeLog``/``ChannelService``, ``VideoStateService``) and with the two real ones under test
(``core/demo.py``, ``core/importers.py``) in place of ``FakeDemoLoader``/``FakeDataOps``.
Folders/tags/tabs stay on the fakes.
"""

from __future__ import annotations

import inspect
import json
import re
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fakes.world as fake_world_module
import pytest
import test_fakes
from fakes import FakeClock, FakeSettings, FakeYouTube, MemDb, build_fake_world
from fakes.invariants import INVARIANTS, QueueImpls

from tube_pkg import wiring
from tube_pkg.api import _common as common
from tube_pkg.api import data as api_data
from tube_pkg.core import changes as CG
from tube_pkg.core import channels as CH
from tube_pkg.core import db as core_db
from tube_pkg.core import demo as DM
from tube_pkg.core import importers as IM
from tube_pkg.core import types as T
from tube_pkg.core import video_state as VS

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mytube"
MYTUBE_SIDEBAR = FIXTURES / "mytube-backup-2026-11-09.json"
MYTUBE_DASHBOARD = FIXTURES / "mytube-backup-2026-11-09.dashboard.json"
DEMO_JSON = ROOT / "plugin" / "data" / "demo_channels.json"

UC_REAL = "UCb09realchannel00000001"
UC_REAL2 = "UCb09realchannel00000002"
VERITASIUM = "UCHnyfMqiRRG1u-2MsSQLbXA"
FIRESHIP = "UCsBjURrPoezykLs9EqgamOA"


# --------------------------------------------------------------------------- fixtures


def _real_factories(monkeypatch: pytest.MonkeyPatch) -> None:
    """``build_fake_world`` now builds the real implementations and the ones under test."""

    def make_changelog(db: Any, *, clock: Any = None, ids: Any = None) -> Any:
        return CG.build(db=db, settings=FakeSettings(), clock=clock)

    def make_channels(
        db: Any, *, changelog: Any, youtube: Any = None, clock: Any = None, ids: Any = None
    ) -> Any:
        return CH.build(
            db=db,
            settings=FakeSettings(),
            youtube=youtube or FakeYouTube(),
            changelog=changelog,
            clock=clock,
        )

    def make_video_state(db: Any, *, changelog: Any, clock: Any = None, ids: Any = None) -> Any:
        return VS.build(db=db, settings=FakeSettings(), changelog=changelog, clock=clock)

    def make_demo(
        db: Any,
        *,
        settings: Any,
        channels: Any,
        taxonomy: Any,
        tabs: Any,
        clock: Any = None,
        ids: Any = None,
    ) -> Any:
        return DM.build(
            db=db, settings=settings, channels=channels, taxonomy=taxonomy, tabs=tabs, clock=clock
        )

    def make_data(
        db: Any,
        *,
        settings: Any,
        channels: Any,
        taxonomy: Any,
        tabs: Any,
        video_state: Any,
        demo: Any,
        changelog: Any,
        clock: Any = None,
        ids: Any = None,
    ) -> Any:
        return IM.build(
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

    monkeypatch.setattr(fake_world_module, "FakeChangeLog", make_changelog)
    monkeypatch.setattr(fake_world_module, "FakeChannelService", make_channels)
    monkeypatch.setattr(fake_world_module, "FakeVideoStateService", make_video_state)
    monkeypatch.setattr(fake_world_module, "FakeDemoLoader", make_demo)
    monkeypatch.setattr(fake_world_module, "FakeDataOps", make_data)


@pytest.fixture
def real(monkeypatch: pytest.MonkeyPatch) -> None:
    _real_factories(monkeypatch)


def _new_world(real: None, path: Path, clock: FakeClock | None = None) -> Any:
    db = core_db.build(path=str(path))
    world = build_fake_world(db, clock=clock or FakeClock())
    assert isinstance(world.data, IM.DataOps)
    assert isinstance(world.demo, DM.DemoLoader)
    world.cleanup.ids = _LongQueueIds(world.cleanup.ids)
    return world


class _LongQueueIds:
    """``FakeCleanup`` queue ids longer than ``q-1``: the export check in ``invariants.py`` looks
    for the queue id as a **substring** of the JSON, and ``q-1`` shows up inside real avatar URLs
    (``…Byq-1GoA=s176…``) — a false positive, not a leak."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.n = 0

    def next(self, prefix: str) -> str:
        if prefix != "q":
            return self.inner.next(prefix)
        self.n += 1
        return f"queue-b09-{self.n:06d}"


@pytest.fixture
def rw(real: None, tmp_path: Path, clock: FakeClock) -> Iterator[Any]:
    world = _new_world(real, tmp_path / "b09.db", clock)
    yield world
    world.db.close()


@pytest.fixture
def rw2(real: None, tmp_path: Path) -> Iterator[Any]:
    world = _new_world(real, tmp_path / "b09-other.db")
    yield world
    world.db.close()


def _mytube(path: Path = MYTUBE_SIDEBAR) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _seed_real(w: Any) -> dict[str, Any]:
    """The user's \"real\" data: folder Ciência (same name as a demo folder), tag, tab,
    a subscribed channel that is also in the demo list (Veritasium) and one only the user has."""
    folder = w.taxonomy.create_folder("Ciência")
    tag = w.taxonomy.create_tag("meu")
    w.channels.upsert_many(
        [
            T.ChannelIn(title="Veritasium (meu)", channel_id=VERITASIUM, folder_id=folder.id),
            T.ChannelIn(title="Real", channel_id=UC_REAL, folder_id=folder.id, tag_ids=(tag.id,)),
        ],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    w.channels.upsert_many(
        [T.ChannelIn(title="Seguido", channel_id=UC_REAL2, favorite=True)],
        source=T.ChannelSource.link,
        relation=T.Relation.followed,
    )
    tab = w.tabs.create(
        T.TabDraft(
            name="Minha aba",
            kind=T.TabKind.category,
            rules=T.TabRules(include=T.RuleInclude(folders=(folder.id,))),
        )
    )
    return {"folder": folder, "tag": tag, "tab": tab}


def _real_snapshot(w: Any) -> dict[str, Any]:
    """Everything that is not demo, row by row."""
    channels = w.db.query("SELECT * FROM channels WHERE source != 'demo' ORDER BY id")
    links = w.db.query(
        "SELECT * FROM channel_tags WHERE channel_id IN"
        " (SELECT id FROM channels WHERE source != 'demo') ORDER BY channel_id, tag_id"
    )
    return {
        "channels": channels,
        "channel_tags": links,
        "tags": w.db.query("SELECT * FROM tags ORDER BY id"),
        "user_tabs": w.db.query("SELECT * FROM tabs WHERE name = 'Minha aba'"),
        "user_folder": w.db.query("SELECT * FROM folders WHERE name = 'Ciência'"),
        "unsub_queue": w.db.query("SELECT * FROM unsub_queue"),
        "video_state": w.db.query("SELECT * FROM video_state ORDER BY video_id"),
    }


# --------------------------------------------------------------------------- demo data


def test_demo_json_is_well_formed() -> None:
    data = json.loads(DEMO_JSON.read_text(encoding="utf-8"))
    folders = {f["key"]: f for f in data["folders"]}
    assert len(folders) == 6
    assert {f["name"] for f in folders.values()} == {
        "Tecnologia",
        "Ciência",
        "Culinária",
        "Música",
        "Notícias",
        "Games",
    }
    ids = [c["id"] for c in data["channels"]]
    assert 35 <= len(ids) <= 45 and len(set(ids)) == len(ids)
    for c in data["channels"]:
        assert re.fullmatch(r"UC[0-9A-Za-z_-]{22}", c["id"]), c
        assert c["folder"] in folders and c["title"].strip()
        assert c["handle"].startswith("@")
    assert all(any(c["folder"] == k for c in data["channels"]) for k in folders)
    assert sum(1 for c in data["channels"] if c["favorite"]) >= 3
    (tab,) = data["tabs"]
    assert tab["kind"] == "theme" and set(tab["channels"]) <= set(ids)
    assert DM.load_catalog() == DM.load_catalog()  # read and validated by the module


@pytest.mark.live
def test_demo_channel_ids_are_real_public_channels() -> None:
    """Real network: each id opens ``/channel/<id>`` and the page points to the same id."""
    data = json.loads(DEMO_JSON.read_text(encoding="utf-8"))
    bad: list[str] = []
    for c in data["channels"]:
        req = urllib.request.Request(
            f"https://www.youtube.com/channel/{c['id']}",
            headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                page = resp.read().decode("utf-8", "replace")
        except urllib.error.URLError as exc:
            bad.append(f"{c['id']} {c['title']}: {exc}")
            continue
        if f'"externalId":"{c["id"]}"' not in page and f"/channel/{c['id']}" not in page:
            bad.append(f"{c['id']} {c['title']}: página não confirma o id")
    assert not bad, "\n".join(bad)


# --------------------------------------------------------------------------- demo


def test_load_demo_through_services_never_touches_real_data(rw: Any) -> None:
    w = rw
    w.settings.set("language", "pt-BR")  # demo names follow the language (here, pt-BR)
    seeded = _seed_real(w)
    before = _real_snapshot(w)
    catalog = DM.load_catalog()
    total = len(catalog.channels)

    report = w.data.load_demo()

    assert w.data.demo_loaded() and w.demo.is_loaded()
    # Veritasium was already real: it stays as it was (folder, title, relation, origin)
    assert report.channels == total - 1 and report.skipped == 1
    assert report.folders == 5, "Ciência already existed and was reused"
    assert report.tabs == 1 and report.warnings
    assert _real_snapshot(w) == before
    demo = w.channels.list(T.ChannelFilter(source=T.ChannelSource.demo))
    assert len(demo) == total - 1
    assert all(c.relation is T.Relation.followed for c in demo)
    assert all(c.folder_id is not None for c in demo)
    assert {c.id for c in demo if c.favorite} == {
        c.id for c in catalog.channels if c.favorite and c.id != VERITASIUM
    }
    names = {f.name for f in w.taxonomy.list_folders()}
    assert {"Tecnologia", "Ciência", "Culinária", "Música", "Notícias", "Games"} <= names
    assert len([f for f in w.taxonomy.list_folders() if f.name == "Ciência"]) == 1
    theme = [t for t in w.tabs.list() if t.kind is T.TabKind.theme]
    assert len(theme) == 1 and theme[0].rules.include.channels
    assert w.db.query("SELECT COUNT(*) AS n FROM unsub_queue") == [{"n": 0}]
    # history: one group with demo_load
    rec = next(r for r in w.changelog.list(limit=200) if r.action is T.ChangeAction.demo_load)
    assert rec.group_id is not None

    assert w.data.load_demo() == T.DataReport(), "idempotente"

    cleared = w.data.clear_demo()
    assert cleared.channels == total - 1 and cleared.tabs == 1 and cleared.folders == 5
    assert not w.data.demo_loaded()
    assert w.channels.list(T.ChannelFilter(source=T.ChannelSource.demo)) == []
    assert _real_snapshot(w) == before
    assert {f.name for f in w.taxonomy.list_folders()} == {"Ciência"}
    assert [t.id for t in w.tabs.list() if not t.builtin] == [seeded["tab"].id]
    assert w.data.clear_demo().channels == 0, "clearing again does nothing"


def test_clear_keeps_demo_channel_that_became_a_real_subscription(rw: Any) -> None:
    w = rw
    w.data.load_demo()
    # the extension synced: the demo channel became a real subscription
    w.channels.upsert_many(
        [T.ChannelIn(title="Fireship", channel_id=FIRESHIP)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    kept = w.channels.get(FIRESHIP)
    report = w.data.clear_demo()
    assert report.skipped == 1 and any("kept" in m or "ficaram" in m for m in report.warnings)
    after = w.channels.get(FIRESHIP)
    assert after is not None and after.relation is T.Relation.subscribed
    assert after.folder_id == kept.folder_id, "the real channel's folder does not disappear"
    remaining = [c.id for c in w.channels.list(T.ChannelFilter(source=T.ChannelSource.demo))]
    assert remaining == [FIRESHIP]


def test_undo_demo_load_removes_the_whole_demo(rw: Any) -> None:
    w = rw
    _seed_real(w)
    before = _real_snapshot(w)
    w.data.load_demo()
    rec = next(r for r in w.changelog.list(limit=200) if r.action is T.ChangeAction.demo_load)
    w.changelog.undo(rec.id, targets=w.targets())
    assert not w.data.demo_loaded()
    assert w.channels.list(T.ChannelFilter(source=T.ChannelSource.demo)) == []
    assert {f.name for f in w.taxonomy.list_folders()} == {"Ciência"}
    assert all(t.kind is not T.TabKind.theme for t in w.tabs.list())
    assert _real_snapshot(w) == before
    # it can be loaded again after undoing
    assert w.data.load_demo().channels > 0


def test_data_import_is_not_undoable(rw: Any) -> None:
    w = rw
    w.data.import_mytube(_mytube())
    rec = next(r for r in w.changelog.list(limit=500) if r.action is T.ChangeAction.data_import)
    with pytest.raises(T.UndoRefused):
        w.data.apply_undo(rec)


# --------------------------------------------------------------------------- MyTube


def _folder_path(w: Any, folder_id: str | None) -> str:
    names: list[str] = []
    while folder_id:
        f = w.taxonomy.get_folder(folder_id)
        names.append(f.name)
        folder_id = f.parent_id
    return " › ".join(reversed(names))


def _tag_names(w: Any, ch: T.Channel) -> set[str]:
    by_id = {t.id: t.name for t in w.taxonomy.list_tags()}
    return {by_id[t] for t in ch.tag_ids}


@pytest.mark.parametrize("path", [MYTUBE_SIDEBAR, MYTUBE_DASHBOARD], ids=["sidebar", "dashboard"])
def test_import_mytube_fixture_preserves_folders_and_tags(rw: Any, path: Path) -> None:
    w = rw
    raw = _mytube(path)
    state = raw.get("state", raw)
    report = w.data.import_mytube(raw)

    channels = [o for o in state["organizables"] if o["type"] == "channel"]
    assert report.channels == len(channels) == 15
    assert report.folders == 3 and report.tags == 4
    assert report.skipped == 2, "saved playlist and video are not channels"
    assert report.videos == len(raw["watchHistory"])
    assert any("playlist" in m.lower() or "vídeo" in m.lower() for m in report.warnings)

    # nested folders kept
    paths = {_folder_path(w, f.id) for f in w.taxonomy.list_folders()}
    assert paths == {"Ciência", "Ciência › Espaço", "Ciência › Espaço › Lançamentos"}
    colors = {f.name: f.color for f in w.taxonomy.list_folders()}
    assert colors["Ciência"] == "#2196f3"
    assert {t.name: t.color for t in w.taxonomy.list_tags()} == {
        t["name"]: t["color"] for t in state["tags"]
    }

    folder_by_old = {f["id"]: f["name"] for f in state["folders"]}
    tag_by_old = {t["id"]: t["name"] for t in state["tags"]}
    for o in channels:
        ch = w.channels.get(o["youtubeId"])
        assert ch is not None, o["name"]
        assert ch.title == o["name"] and ch.source is T.ChannelSource.mytube
        assert ch.relation is T.Relation.followed
        assert ch.muted is bool(o.get("muted"))
        expected_folder = folder_by_old.get(o["folderId"]) if o["folderId"] else None
        got = w.taxonomy.get_folder(ch.folder_id).name if ch.folder_id else None
        assert got == expected_folder, o["name"]
        assert _tag_names(w, ch) == {tag_by_old[t] for t in o["tagIds"]}, o["name"]
        if o.get("handle"):
            assert ch.handle == "@" + o["handle"].lower()
    # watched history becomes the watched state
    watched = {e["videoId"] for e in raw["watchHistory"]}
    states = w.video_state.get(sorted(watched))
    assert {v: s.state for v, s in states.items()} == {v: T.VideoState.watched for v in watched}
    # nothing in the queue
    assert w.db.query("SELECT COUNT(*) AS n FROM unsub_queue") == [{"n": 0}]

    again = w.data.import_mytube(raw)
    assert (again.channels, again.folders, again.tags) == (0, 0, 0), "reimporting is idempotent"
    assert len(w.taxonomy.list_folders()) == 3 and len(w.taxonomy.list_tags()) == 4


def test_import_mytube_never_overrides_user_choices(rw: Any) -> None:
    w = rw
    mine = w.taxonomy.create_folder("Minha pasta")
    w.channels.upsert_many(
        [T.ChannelIn(title="Veritasium", channel_id=VERITASIUM, folder_id=mine.id)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    w.video_state.set_state(["iw9SZgyahqg"], T.VideoState.later)
    w.data.import_mytube(_mytube())
    ch = w.channels.get(VERITASIUM)
    assert ch.folder_id == mine.id and ch.relation is T.Relation.subscribed
    assert ch.source is T.ChannelSource.extension and not ch.muted
    assert w.video_state.get(["iw9SZgyahqg"])["iw9SZgyahqg"].state is T.VideoState.later


@pytest.mark.parametrize(
    "bad",
    [{}, {"foo": 1}, {"state": "x"}, {"organizables": "x"}, {"folders": [1, 2]}],
)
def test_import_mytube_rejects_garbage(rw: Any, bad: Any) -> None:
    with pytest.raises(T.ValidationError):
        rw.data.import_mytube(bad)
    assert rw.channels.list() == []


# --------------------------------------------------------------------------- export / import


def _rich_state(w: Any) -> None:
    w.data.import_mytube(_mytube())
    w.data.load_demo()
    folders = {f.name: f.id for f in w.taxonomy.list_folders()}
    tags = {t.name: t.id for t in w.taxonomy.list_tags()}
    w.tabs.create(
        T.TabDraft(
            name="Aprender sem Shorts",
            kind=T.TabKind.mixed,
            icon="📚",
            filters={"view": "grid"},
            rules=T.TabRules(
                include=T.RuleInclude(
                    folders=(folders["Espaço"],), tags=(tags["aprender"],), channels=(FIRESHIP,)
                ),
                exclude=T.RuleExclude(tags=(tags["PT-BR"],), shorts=True),
                filters=T.RuleFilters(only_new=True, min_s=60),
            ),
        )
    )
    w.channels.upsert_many(
        [T.ChannelIn(title="Inscrito", channel_id=UC_REAL)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    w.channels.update(UC_REAL, T.ChannelPatch(ai_note="nota da IA", muted=True))
    w.channels.upsert_many(
        [T.ChannelIn(title="Ex", channel_id=UC_REAL2)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    w.channels.set_relation(UC_REAL2, T.Relation.ex)
    w.video_state.set_state(["vidlater001"], T.VideoState.later)
    w.video_state.set_reaction("vidreact001", T.Reaction.down)


def _normalized(w: Any) -> dict[str, Any]:
    """State comparable across databases (opaque folder/tag/tab ids replaced by names)."""
    fpath = {f.id: _folder_path(w, f.id) for f in w.taxonomy.list_folders()}
    tname = {t.id: t.name for t in w.taxonomy.list_tags()}
    channels = []
    for c in w.channels.list():
        channels.append(
            {
                "id": c.id,
                "title": c.title,
                "handle": c.handle,
                "thumb": c.thumb,
                "url": c.url,
                "relation": c.relation.value,
                "source": c.source.value,
                "folder": fpath.get(c.folder_id or ""),
                "favorite": c.favorite,
                "muted": c.muted,
                "ai_note": c.ai_note,
                "tags": sorted(tname[t] for t in c.tag_ids),
            }
        )

    def rules(r: T.TabRules) -> dict[str, Any]:
        d = r.to_dict()
        for part in ("include", "exclude"):
            d[part]["folders"] = sorted(fpath[f] for f in d[part]["folders"])
            d[part]["tags"] = sorted(tname[t] for t in d[part]["tags"])
            d[part]["channels"] = sorted(d[part]["channels"])
        return d

    tabs = [
        {
            "name": t.name,
            "kind": t.kind.value,
            "icon": t.icon,
            "filters": dict(t.filters),
            "rules": rules(t.rules),
        }
        for t in w.tabs.list()
        if not t.builtin
    ]
    states = sorted(
        (r["video_id"], r["state"], r["reaction"])
        for r in w.db.query("SELECT video_id, state, reaction FROM video_state")
    )
    return {
        "folders": sorted((fpath[f.id], f.color) for f in w.taxonomy.list_folders()),
        "tags": sorted((t.name, t.color) for t in w.taxonomy.list_tags()),
        "channels": sorted(channels, key=lambda c: c["id"]),
        "tabs": tabs,
        "video_state": states,
    }


def test_export_then_import_gives_the_same_state(rw: Any, rw2: Any) -> None:
    _rich_state(rw)
    exported = rw.data.export_json()
    assert exported["schema_version"] == T.SCHEMA_VERSION
    for key in ("channels", "folders", "tags", "tabs", "themes", "video_state"):
        assert isinstance(exported[key], list), key
    text = json.dumps(exported, ensure_ascii=False)  # plain JSON
    for table in T.EXPORT_EXCLUDED_TABLES:
        assert f'"{table}"' not in text

    report = rw2.data.import_json(json.loads(text))
    assert report.channels == len(rw.channels.list())
    assert report.tabs == len([t for t in rw.tabs.list() if not t.builtin])
    assert _normalized(rw2) == _normalized(rw)
    # the imported demo is still demo (clearable) and demo mode does not stay \"on\"
    assert rw2.channels.list(T.ChannelFilter(source=T.ChannelSource.demo))
    assert rw2.db.query("SELECT COUNT(*) AS n FROM unsub_queue") == [{"n": 0}]

    # reimporting into the same database: merges without duplicating
    again = rw2.data.import_json(json.loads(text))
    assert (again.channels, again.folders, again.tags, again.tabs) == (0, 0, 0, 0)
    assert _normalized(rw2) == _normalized(rw)


def test_import_never_creates_queue_items_and_invariants_hold(rw: Any, rw2: Any) -> None:
    _rich_state(rw)
    payload = rw.data.export_json()
    payload["unsub_queue"] = [
        {
            "id": "q-evil",
            "channel_id": UC_REAL,
            "action": "unsubscribe",
            "approved_at": 1,
            "approved_via": "desktop_rpc",
            "status": "approved",
        }
    ]
    payload["channels"][0]["approved_via"] = "desktop_rpc"
    payload["channels"][0]["queue"] = {"status": "approved"}
    rw2.data.import_json(payload)
    assert rw2.db.query("SELECT COUNT(*) AS n FROM unsub_queue") == [{"n": 0}]
    for name, check in INVARIANTS:
        check(QueueImpls.from_world(rw2, prefix=f"b09{name[:4]}"))


@pytest.mark.parametrize("name", [n for n, _ in INVARIANTS])
def test_queue_invariants_with_real_data_ops(rw: Any, name: str) -> None:
    _rich_state(rw)
    dict(INVARIANTS)[name](QueueImpls.from_world(rw))


def test_import_json_drops_theme_refs_and_warns(rw: Any, rw2: Any) -> None:
    rw.data.load_demo()
    exported = rw.data.export_json()
    exported["themes"] = [{"id": "th1", "tab_id": None, "query": "rust", "items": []}]
    tab = next(t for t in exported["tabs"] if t["kind"] == "theme")
    tab["rules"]["include"]["themes"] = ["th1"]
    report = rw2.data.import_json(exported)
    assert any("theme" in m for m in report.warnings)
    imported = next(t for t in rw2.tabs.list() if t.kind is T.TabKind.theme)
    assert imported.rules.include.themes == ()


@pytest.mark.parametrize(
    "bad",
    [
        {},
        {"channels": []},
        {"schema_version": "1"},
        {"schema_version": T.SCHEMA_VERSION + 1},
        {"schema_version": 1, "channels": "x"},
    ],
)
def test_import_json_rejects_invalid(rw: Any, bad: Any) -> None:
    with pytest.raises(T.ValidationError):
        rw.data.import_json(bad)


def test_import_accepts_nested_tables_layout(rw: Any, rw2: Any) -> None:
    rw.data.import_mytube(_mytube())
    exported = rw.data.export_json()
    nested = {
        "schema_version": 1,
        "tables": {k: v for k, v in exported.items() if k != "schema_version"},
    }
    report = rw2.data.import_json(nested)
    assert report.channels == 15


# --------------------------------------------------------------------------- conformance


CONFORMANCE = ("test_import_mytube_and_json_roundtrip",)


@pytest.mark.parametrize("name", CONFORMANCE)
def test_fake_suite_passes_with_real_data_ops(rw: Any, name: str) -> None:
    """``DataOps`` tests from ``test_fakes.py`` against the real ones (the patch also applies to the
    world the test builds over ``MemDb``)."""
    fn = getattr(test_fakes, name)
    params = list(inspect.signature(fn).parameters)
    fn(**{p: rw for p in params})


def test_fake_demo_scenario_with_real_demo(rw: Any) -> None:
    """Same script as ``test_fakes.test_demo_load_clear_and_undo_never_touch_real_data`` (the
    fake loads 3 channels; the real one, the whole catalog)."""
    w = rw
    uc1 = "UCfakeworldchannel000001"
    w.channels.upsert_many(
        [T.ChannelIn(title="Real", channel_id=uc1)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    report = w.data.load_demo()
    assert report.channels == len(DM.load_catalog().channels) and w.data.demo_loaded()
    assert w.data.load_demo() == T.DataReport(), "idempotente"
    rec = next(r for r in w.changelog.list() if r.action is T.ChangeAction.demo_load)
    w.changelog.undo(rec.id, targets=w.targets())
    assert [c.id for c in w.channels.list()] == [uc1]
    assert not w.data.demo_loaded()
    w.data.load_demo()
    w.data.clear_demo()
    assert [c.id for c in w.channels.list()] == [uc1]
    assert w.taxonomy.list_folders() == []


def test_build_signatures_match_contract() -> None:
    for module, key in ((DM, "plugin/core/demo.py:build"), (IM, "plugin/core/importers.py:build")):
        sig = inspect.signature(module.build)
        spec = next(s for s in T.BUILDS if s.key == key)
        assert list(sig.parameters) == list(spec.deps) + list(spec.optional)
        assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in sig.parameters.values())
        assert not getattr(
            module.build(**{n: None for n in sig.parameters}), "__contract_stub__", None
        )
    assert isinstance(IM.DataOps, type)


# --------------------------------------------------------------------------- REST routes


_gen_types = None


def _validate(operation_id: str, env: dict[str, Any]) -> None:
    global _gen_types
    import importlib.util
    import sys

    if _gen_types is None:
        name = "_gen_types_b09"
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "gen_types.py")
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # gen_types dataclasses need the module registered
        spec.loader.exec_module(module)
        _gen_types = module
    contract = _gen_types.load_contract(ROOT)
    op = next(o for o in _gen_types.iter_operations(contract) if o.operation_id == operation_id)
    assert common.is_envelope(env), env
    if env["ok"]:
        _gen_types.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    else:
        _gen_types.validate_instance(
            {"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True
        )
        assert env["error"]["code"] in set(op.errors) | {"internal"}, env


@pytest.fixture
def wired(rw: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(wiring, "get_data", lambda: rw.data)
    return rw


def test_routes_are_real() -> None:
    for name in (
        "get_demo",
        "post_demo_load",
        "post_demo_clear",
        "post_import_mytube",
        "get_export",
        "post_import",
    ):
        fn = getattr(api_data, name)
        assert common.is_real(fn), name
        assert common.stub_operation(fn) is None, name


def test_rest_demo_load_and_import_kick_the_refresh(
    wired: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Batch of channels → fetch their videos right away (live, the demo sat 30 min empty)."""
    kicks: list[bool] = []

    class Spy:
        def kick_if_due(self, force: bool = False, **_: Any) -> str:
            kicks.append(force)
            return "started"

    monkeypatch.setattr(api_data.wiring, "get_refresher", lambda: Spy())
    assert api_data.post_demo_load({}, {})["ok"] is True
    assert kicks == [True]

    def boom() -> Any:
        raise RuntimeError("sem refresher")

    monkeypatch.setattr(api_data.wiring, "get_refresher", boom)
    assert api_data.post_demo_load({}, {})["ok"] is True  # the route never fails because of it


def test_rest_demo_routes(wired: Any) -> None:
    env = api_data.get_demo(None, {})
    _validate("getDemo", env)
    assert env["data"] == {"loaded": False}
    env = api_data.post_demo_load({}, {})
    _validate("postDemoLoad", env)
    assert env["data"]["channels"] == len(DM.load_catalog().channels)
    assert api_data.get_demo(None, {})["data"] == {"loaded": True}
    env = api_data.post_demo_clear({}, {})
    _validate("postDemoClear", env)
    assert env["data"]["channels"] == len(DM.load_catalog().channels)
    assert api_data.get_demo(None, {})["data"] == {"loaded": False}


def test_rest_import_mytube_by_path_and_data(wired: Any, tmp_path: Path) -> None:
    env = api_data.post_import_mytube({"path": str(MYTUBE_SIDEBAR)}, {})
    _validate("postImportMytube", env)
    assert env["ok"] and env["data"]["channels"] == 15
    env = api_data.post_import_mytube({"data": _mytube(MYTUBE_DASHBOARD)}, {})
    _validate("postImportMytube", env)
    assert env["ok"] and env["data"]["channels"] == 0

    missing = api_data.post_import_mytube({"path": str(tmp_path / "nao-existe.json")}, {})
    _validate("postImportMytube", missing)
    assert missing["error"]["code"] == "not_found"
    broken = tmp_path / "quebrado.json"
    broken.write_text("{nope", encoding="utf-8")
    env = api_data.post_import_mytube({"path": str(broken)}, {})
    _validate("postImportMytube", env)
    assert env["error"]["code"] == "invalid"
    for body in ({}, {"data": {}, "path": "x"}, {"data": [1]}, {"path": ""}, None):
        env = api_data.post_import_mytube(body, {})
        _validate("postImportMytube", env)
        assert env["error"]["code"] == "invalid", body


def test_rest_export_and_import(
    wired: Any, rw2: Any, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    wired.data.import_mytube(_mytube())
    env = api_data.get_export(None, {})
    _validate("getExport", env)
    exported = env["data"]
    path = tmp_path / "backup.json"
    path.write_text(json.dumps(exported), encoding="utf-8")

    monkeypatch.setattr(wiring, "get_data", lambda: rw2.data)
    env = api_data.post_import({"path": str(path)}, {})
    _validate("postImport", env)
    assert env["ok"] and env["data"]["channels"] == 15
    env = api_data.post_import({"data": exported}, {})
    _validate("postImport", env)
    assert env["ok"] and env["data"]["channels"] == 0
    env = api_data.post_import({"data": {"schema_version": 99}}, {})
    _validate("postImport", env)
    assert env["error"]["code"] == "invalid"


def test_rest_routes_degrade_when_a_dependency_is_a_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    class Stub:
        __contract_stub__ = "X"

        def __getattr__(self, name: str) -> Any:
            def boom(*a: Any, **k: Any) -> Any:
                raise NotImplementedError("stub")

            return boom

    monkeypatch.setattr(wiring, "get_data", lambda: Stub())
    for name, op, body in (
        ("get_demo", "getDemo", None),
        ("post_demo_load", "postDemoLoad", {}),
        ("post_demo_clear", "postDemoClear", {}),
        ("get_export", "getExport", None),
        ("post_import", "postImport", {"data": {"schema_version": 1}}),
    ):
        env = getattr(api_data, name)(body, {})
        _validate(op, env)
        assert env["ok"] is False and env["error"]["code"] == "internal", name


def test_memdb_world_also_works(real: None) -> None:
    """The real ones also run over ``MemDb`` (conftest with ``TUBE_TEST_DB=mem``)."""
    w = build_fake_world(MemDb())
    report = w.data.import_mytube(_mytube())
    assert report.channels == 15
    assert w.data.load_demo().channels > 0
