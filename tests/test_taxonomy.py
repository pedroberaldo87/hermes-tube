"""Folders, tags and tabs — ``TaxonomyService`` (``core/taxonomy.py``), ``TabService``
(``core/tabs.py``) and the REST routes in ``api/taxonomy.py`` / ``api/tabs.py``.

Real database (``core.db.build``) with the real ``ChangeLog``/``ChannelService``. For
conformance, the world of fakes is built with the four real services instead of the fakes (same
composition as ``build_fake_world``) and runs the same service suite as ``tests/test_fakes.py``.
"""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import json
import sys
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import fakes.world as fake_world_module
import pytest
import test_fakes
from fakes import (
    FakeChangeLog,
    FakeChannelService,
    FakeClock,
    FakeSettings,
    FakeTabService,
    FakeTaxonomyService,
    FakeYouTube,
    MemDb,
    build_fake_world,
)
from fakes import seed_world as _seed

from tube_pkg.api import _common
from tube_pkg.api import tabs as api_tabs
from tube_pkg.api import taxonomy as api_tax
from tube_pkg.core import changes as CG
from tube_pkg.core import channels as CH
from tube_pkg.core import db as core_db
from tube_pkg.core import tabs as TB
from tube_pkg.core import taxonomy as TX
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]


def cid(n: int) -> str:
    """Valid channel id (``UC`` + 22)."""
    return f"UCb05test{n:015d}"


def _load_by_path(name: str, path: Path) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_b05", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "b05.db"))
    yield db
    db.close()


def _make_changelog(db: Any, *, clock: Any = None, ids: Any = None) -> Any:
    return CG.build(db=db, settings=FakeSettings(), clock=clock)


def _make_channels(
    db: Any, *, changelog: Any, youtube: Any = None, clock: Any = None, ids: Any = None
) -> Any:
    return CH.build(
        db=db,
        settings=FakeSettings(),
        youtube=youtube or FakeYouTube(),
        changelog=changelog,
        clock=clock,
    )


def _make_taxonomy(
    db: Any, *, channels: Any, changelog: Any, clock: Any = None, ids: Any = None
) -> Any:
    return TX.TaxonomyService(
        db=db,
        settings=FakeSettings(),
        channels=channels,
        changelog=changelog,
        clock=clock,
        new_id=ids.next if ids is not None else None,
    )


def _make_tabs(
    db: Any,
    *,
    changelog: Any,
    known_lenses: Any = (T.HN_LENS,),
    clock: Any = None,
    ids: Any = None,
) -> Any:
    return TB.TabService(
        db=db,
        settings=FakeSettings(),
        changelog=changelog,
        clock=clock,
        new_id=ids.next if ids is not None else None,
        known_lenses=known_lenses,
    )


def _real_factories(mp: pytest.MonkeyPatch) -> None:
    """``build_fake_world`` now builds real ``ChangeLog``/``ChannelService`` and
    ``TaxonomyService``/``TabService``."""
    mp.setattr(fake_world_module, "FakeChangeLog", _make_changelog)
    mp.setattr(fake_world_module, "FakeChannelService", _make_channels)
    mp.setattr(fake_world_module, "FakeTaxonomyService", _make_taxonomy)
    mp.setattr(fake_world_module, "FakeTabService", _make_tabs)


@pytest.fixture
def real(monkeypatch: pytest.MonkeyPatch) -> None:
    _real_factories(monkeypatch)


@pytest.fixture
def rw(real: None, rdb: Any, clock: FakeClock) -> Any:
    """World of fakes with the real channel and taxonomy services on the real database."""
    world = build_fake_world(rdb, clock=clock)
    assert isinstance(world.taxonomy, TX.TaxonomyService)
    assert isinstance(world.tabs, TB.TabService)
    assert isinstance(world.channels, CH.ChannelService)
    return world


def _sub(w: Any, *ns: int) -> list[str]:
    w.channels.upsert_many(
        [T.ChannelIn(title=f"Canal {n}", channel_id=cid(n)) for n in ns],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
        actor=T.Actor.extension,
    )
    return [cid(n) for n in ns]


def _snapshot(db: Any) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for table in ("folders", "tags", "tabs", "channels", "channel_tags"):
        rows = db.query(f"SELECT * FROM {table} ORDER BY 1, 2")
        for r in rows:
            r.pop("updated_at", None)
            for col in ("rules", "filters"):
                if table == "tabs" and col in r:
                    r[col] = json.loads(r[col])
        out[table] = rows
    return out


def _last_change_id(w: Any) -> int:
    recs = w.changelog.list(limit=1)
    return recs[0].id if recs else 0


def _undo_since(w: Any, mark: int) -> None:
    """Undoes everything recorded after *mark*, newest to oldest."""
    for rec in w.changelog.list(limit=200):
        if rec.id <= mark:
            break
        current = w.changelog.get(rec.id)
        if current is not None and current.undone_at is None:
            w.changelog.undo(rec.id, targets=w.targets())


# --------------------------------------------------------------------------- contract


def test_build_signatures_match_contract() -> None:
    assert T.BUILD_SIGNATURES["plugin/core/taxonomy.py:build"] == (
        "build(*, db, settings, channels, changelog, clock=None) -> TaxonomyService"
    )
    assert T.BUILD_SIGNATURES["plugin/core/tabs.py:build"] == (
        "build(*, db, settings, changelog, clock=None) -> TabService"
    )
    for fn, names in (
        (TX.build, ["db", "settings", "channels", "changelog", "clock"]),
        (TB.build, ["db", "settings", "changelog", "clock"]),
    ):
        params = inspect.signature(fn).parameters
        assert list(params) == names
        assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params.values())
        assert params["clock"].default is None


def _shape(fn: Any) -> list[tuple[str, Any, Any]]:
    return [
        (p.name, p.kind, p.default)
        for p in inspect.signature(fn).parameters.values()
        if p.name != "self"
    ]


def _protocol_methods(proto: type) -> list[str]:
    names: set[str] = set()
    for klass in proto.__mro__:
        if klass is object or not getattr(klass, "_is_protocol", False):
            continue
        names |= {n for n, v in vars(klass).items() if not n.startswith("_") and callable(v)}
    return sorted(names)


@pytest.mark.parametrize(
    ("proto", "impl"),
    [
        ("TaxonomyService", TX.TaxonomyService),
        ("TabService", TB.TabService),
        ("Undoable", TX.TaxonomyService),
        ("Undoable", TB.TabService),
    ],
)
def test_methods_match_protocol(proto: str, impl: type) -> None:
    protocol = getattr(T, proto)
    for name in _protocol_methods(protocol):
        want = _shape(getattr(protocol, name))
        got = _shape(getattr(impl, name))
        assert got[: len(want)] == want, name
        for extra in got[len(want) :]:
            assert extra[1] is inspect.Parameter.KEYWORD_ONLY, (name, extra)
            assert extra[2] is not inspect.Parameter.empty, (name, extra)


def test_build_is_inert_and_satisfies_protocols(rdb: Any) -> None:
    before = threading.active_count()
    settings = FakeSettings()
    log = CG.build(db=rdb, settings=settings)
    ch = CH.build(db=rdb, settings=settings, youtube=FakeYouTube(), changelog=log)
    tax = TX.build(db=rdb, settings=settings, channels=ch, changelog=log)
    tabs = TB.build(db=rdb, settings=settings, changelog=log)
    assert isinstance(tax, T.TaxonomyService) and isinstance(tax, T.Undoable)
    assert isinstance(tabs, T.TabService) and isinstance(tabs, T.Undoable)
    assert not hasattr(tax, "__contract_stub__") and not hasattr(tabs, "__contract_stub__")
    assert threading.active_count() == before
    for table in ("changes", "folders", "tags", "tabs"):
        assert rdb.query(f"SELECT COUNT(*) AS n FROM {table}") == [{"n": 0}], table


@pytest.mark.parametrize("module", [TX, TB, api_tax, api_tabs])
def test_module_hygiene(module: Any) -> None:
    source = Path(module.__file__).read_text(encoding="utf-8")
    for forbidden in (
        "os.environ",
        "getenv",
        "HERMES_HOME",
        "TUBE_DB_PATH",
        "from plugin",
        "import threading",
        "eval(",
        "contract.stub",
        "NotImplementedError",
    ):
        assert forbidden not in source, forbidden
    for other in ("channels", "changes", "feed", "refresh", "themes", "db", "cleanup"):
        assert f"tube_pkg.core.{other}" not in source
        assert f"tube_pkg.core import {other}" not in source


def test_world_fixture_uses_real_db(rw: Any) -> None:
    assert isinstance(rw.db, core_db.SqliteDb)


# --------------------------------------------------------------------------- folders


def test_folder_lifecycle(rw: Any) -> None:
    w = rw
    tax = w.taxonomy
    tech = tax.create_folder("  Tech  ", color="#7c3aed")
    assert (tech.name, tech.parent_id, tech.color, tech.sort) == ("Tech", None, "#7c3aed", 0)
    games = tax.create_folder("Games")
    ia = tax.create_folder("IA", parent_id=tech.id)
    web = tax.create_folder("Web", parent_id=tech.id)
    assert (games.sort, ia.sort, web.sort) == (1, 0, 1)
    assert tax.get_folder(ia.id) == ia
    assert tax.get_folder("nope") is None
    assert [f.id for f in tax.list_folders()] == [tech.id, games.id, ia.id, web.id]
    assert set(tax.descendants(tech.id)) == {tech.id, ia.id, web.id}
    assert tax.descendants(games.id) == [games.id]
    assert tax.descendants("nope") == []

    # duplicate name under the same parent (normalized) → Conflict; under another parent, allowed
    for dup in ("tech", "TÉCH", " tech "):
        with pytest.raises(T.Conflict):
            tax.create_folder(dup)
    tax.create_folder("Games", parent_id=tech.id)
    for bad in ("", "   ", None, 42, "x" * 201):
        with pytest.raises(T.ValidationError):
            tax.create_folder(bad)  # type: ignore[arg-type]
    with pytest.raises(T.ValidationError):
        tax.create_folder("Cor", color=123)  # type: ignore[arg-type]
    with pytest.raises(T.NotFound):
        tax.create_folder("Órfã", parent_id="nope")

    # find_folder_by_name
    assert tax.find_folder_by_name("ia") == ia
    assert tax.find_folder_by_name("IA", parent_id=None) is None
    assert tax.find_folder_by_name("ia", parent_id=tech.id) == ia
    assert tax.find_folder_by_name("games", parent_id=None) == games
    assert tax.find_folder_by_name("nada") is None

    # rename/recolor
    renamed = tax.update_folder(ia.id, name="IA & ML", color=None)
    assert (renamed.name, renamed.color) == ("IA & ML", None)
    with pytest.raises(T.Conflict):
        tax.update_folder(ia.id, name="web")
    with pytest.raises(T.ValidationError):
        tax.update_folder(ia.id, name="  ")
    with pytest.raises(T.NotFound):
        tax.update_folder("nope", name="x")
    assert tax.update_folder(ia.id, name="IA & ML") == renamed, "no-op"

    rec = w.changelog.list()[0]
    assert rec.action is T.ChangeAction.folder_update
    assert dict(rec.undo.before) == {"name": "IA"}, "only what changed"


def test_move_folder_rules(rw: Any) -> None:
    tax = rw.taxonomy
    tech = tax.create_folder("Tech")
    ia = tax.create_folder("IA", parent_id=tech.id)
    llm = tax.create_folder("LLM", parent_id=ia.id)
    games = tax.create_folder("Games")
    for target in (tech.id, ia.id, llm.id):
        with pytest.raises(T.ValidationError):
            tax.move_folder(tech.id, target)
    with pytest.raises(T.NotFound):
        tax.move_folder(tech.id, "nope")
    with pytest.raises(T.NotFound):
        tax.move_folder("nope", None)
    tax.create_folder("LLM", parent_id=games.id)
    with pytest.raises(T.Conflict):
        tax.move_folder(llm.id, games.id)

    moved = tax.move_folder(llm.id, None)
    assert moved.parent_id is None
    assert moved.sort == 2, "goes to the end of the new siblings"
    assert set(tax.descendants(tech.id)) == {tech.id, ia.id}
    marks = len(rw.changelog.list())
    assert tax.move_folder(llm.id, None) == moved, "same parent: no-op"
    assert len(rw.changelog.list()) == marks
    moved_in = tax.move_folder(llm.id, tech.id)
    assert moved_in.parent_id == tech.id
    rec = rw.changelog.list()[0]
    assert rec.action is T.ChangeAction.folder_update
    assert rec.undo.before["parent_id"] is None


def test_delete_folder_moves_channels_to_no_folder_and_lifts_subfolders(rw: Any) -> None:
    w = rw
    a, b, c, d = _sub(w, 1, 2, 3, 4)
    tech = w.taxonomy.create_folder("Tech")
    ia = w.taxonomy.create_folder("IA", parent_id=tech.id)
    llm = w.taxonomy.create_folder("LLM", parent_id=ia.id)
    web = w.taxonomy.create_folder("Web", parent_id=ia.id)
    w.channels.move([a, b], ia.id)
    w.channels.move([c], llm.id)
    w.channels.move([d], tech.id)
    before = _snapshot(w.db)
    mark = _last_change_id(w)

    w.taxonomy.delete_folder(ia.id)
    assert w.taxonomy.get_folder(ia.id) is None
    assert w.channels.get(a).folder_id is None and w.channels.get(b).folder_id is None
    assert w.channels.get(c).folder_id == llm.id, "the subfolder channel stays in the subfolder"
    assert w.channels.get(d).folder_id == tech.id
    assert w.taxonomy.get_folder(llm.id).parent_id == tech.id, "the subfolder moves up a level"
    assert w.taxonomy.get_folder(web.id).parent_id == tech.id
    new = [r for r in w.changelog.list() if r.id > mark]
    assert [r.action for r in new] == [T.ChangeAction.folder_delete, T.ChangeAction.channel_move]
    assert len({r.group_id for r in new}) == 1 and new[0].group_id
    u = new[0].undo
    assert set(u.channel_ids) == {a, b} and set(u.child_folder_ids) == {llm.id, web.id}

    w.changelog.undo(new[0].id, targets=w.targets())
    assert _snapshot(w.db) == before
    with pytest.raises(T.NotFound):
        w.taxonomy.delete_folder("nope")


def test_delete_root_folder_lifts_children_to_root(rw: Any) -> None:
    tax = rw.taxonomy
    tech = tax.create_folder("Tech")
    ia = tax.create_folder("IA", parent_id=tech.id)
    tax.delete_folder(tech.id)
    assert tax.get_folder(ia.id).parent_id is None
    assert [f.id for f in tax.list_folders()] == [ia.id]


def test_delete_folder_is_atomic(rw: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    w = rw
    (a,) = _sub(w, 1)
    tech = w.taxonomy.create_folder("Tech")
    w.taxonomy.create_folder("IA", parent_id=tech.id)
    w.channels.move([a], tech.id)
    before = _snapshot(w.db)
    n_changes = len(w.changelog.list())
    real_record = w.changelog.record

    def failing(actor: Any, action: Any, payload: Any, undo: Any) -> Any:
        if action is T.ChangeAction.folder_delete:
            raise RuntimeError("failure midway")
        return real_record(actor, action, payload, undo)

    monkeypatch.setattr(w.changelog, "record", failing)
    with pytest.raises(RuntimeError):
        w.taxonomy.delete_folder(tech.id)
    assert _snapshot(w.db) == before
    assert len(w.changelog.list()) == n_changes


def test_reorder_folders_is_stable_and_validated(rw: Any) -> None:
    w = rw
    tax = w.taxonomy
    a = tax.create_folder("A")
    b = tax.create_folder("B")
    c = tax.create_folder("C")
    d = tax.create_folder("D")
    child = tax.create_folder("Filha", parent_id=a.id)

    def roots() -> list[str]:
        return [f.id for f in tax.list_folders() if f.parent_id is None]

    assert roots() == [a.id, b.id, c.id, d.id]
    tax.reorder_folders([d.id, b.id])
    assert roots() == [d.id, b.id, a.id, c.id], "the listed ones first; the rest as they were"
    assert [f.sort for f in tax.list_folders() if f.parent_id is None] == [0, 1, 2, 3]
    rec = w.changelog.list()[0]
    assert rec.action is T.ChangeAction.folder_reorder
    marks = len(w.changelog.list())
    tax.reorder_folders([d.id, b.id, a.id, c.id])
    assert len(w.changelog.list()) == marks, "same order: nothing in the history"
    tax.reorder_folders([c.id, d.id, b.id, a.id])
    tax.reorder_folders([c.id, d.id, b.id, a.id])
    assert roots() == [c.id, d.id, b.id, a.id]

    state = _snapshot(w.db)
    for bad, exc in (
        ([a.id, child.id], T.ValidationError),
        ([a.id, a.id], T.ValidationError),
        ([], T.ValidationError),
        ([a.id, "nope"], T.NotFound),
        ("abc", T.ValidationError),
    ):
        with pytest.raises(exc):
            tax.reorder_folders(bad)  # type: ignore[arg-type]
    assert _snapshot(w.db) == state

    w.changelog.undo(w.changelog.list()[0].id, targets=w.targets())
    assert roots() == [d.id, b.id, a.id, c.id]


# --------------------------------------------------------------------------- tags


def test_tag_lifecycle_and_delete_unlinks(rw: Any) -> None:
    w = rw
    tax = w.taxonomy
    a, b, c = _sub(w, 1, 2, 3)
    review = tax.create_tag(" review ")
    tut = tax.create_tag("Tutorial", color="#16a34a")
    assert review.name == "review" and tut.color == "#16a34a"
    assert [t.name for t in tax.list_tags()] == ["review", "Tutorial"]
    for dup in ("Review", "REVIEW", "réview"):
        with pytest.raises(T.Conflict):
            tax.create_tag(dup)
    for bad in ("", " ", None):
        with pytest.raises(T.ValidationError):
            tax.create_tag(bad)  # type: ignore[arg-type]
    assert tax.find_tag_by_name("TUTORIAL") == tut
    assert tax.find_tag_by_name("nada") is None

    upd = tax.update_tag(tut.id, color="#000000")
    assert upd.color == "#000000"
    with pytest.raises(T.Conflict):
        tax.update_tag(tut.id, name="review")
    with pytest.raises(T.NotFound):
        tax.update_tag("nope", name="x")
    assert tax.update_tag(tut.id, name="Tutorial") == upd, "no-op"

    w.channels.set_tags(a, [review.id, tut.id])
    w.channels.set_tags(b, [review.id])
    w.channels.set_tags(c, [tut.id])
    before = _snapshot(w.db)
    mark = _last_change_id(w)
    tax.delete_tag(review.id)
    assert w.channels.get(a).tag_ids == (tut.id,)
    assert w.channels.get(b).tag_ids == ()
    assert w.channels.get(c).tag_ids == (tut.id,)
    assert [t.id for t in tax.list_tags()] == [tut.id]
    new = [r for r in w.changelog.list() if r.id > mark]
    assert new[0].action is T.ChangeAction.tag_delete
    assert set(new[0].undo.channel_ids) == {a, b}
    assert len({r.group_id for r in new}) == 1
    w.changelog.undo(new[-1].id, targets=w.targets())
    assert _snapshot(w.db) == before
    with pytest.raises(T.NotFound):
        tax.delete_tag("nope")


# --------------------------------------------------------------------------- tabs


def test_ensure_builtin_is_idempotent_and_protected(rw: Any) -> None:
    w = rw
    tabs = w.tabs
    first = tabs.ensure_builtin()
    assert [t.id for t in first] == [T.BUILTIN_TAB_ALL_NEW, T.BUILTIN_TAB_FAVORITES]
    assert all(t.builtin for t in first)
    all_new, fav = first
    assert all_new.rules.include.all and all_new.rules.filters.only_new
    assert fav.rules.include.favorites
    assert tabs.ensure_builtin() == first
    assert w.changelog.list() == [], "no history"
    assert w.db.query("SELECT COUNT(*) AS n FROM tabs") == [{"n": 2}]
    for tab_id in (T.BUILTIN_TAB_ALL_NEW, T.BUILTIN_TAB_FAVORITES):
        with pytest.raises(T.Conflict):
            tabs.delete(tab_id)
    renamed = tabs.update(T.BUILTIN_TAB_FAVORITES, T.TabPatch(name="⭐ Favoritos"))
    assert renamed.builtin and tabs.ensure_builtin()[1].name == "⭐ Favoritos", "does not overwrite"


INVALID_RULES: list[tuple[str, Any]] = [
    ("unknown key", {"include": {"pastas": []}}),
    ("unknown root", {"bogus": 1}),
    ("wrong type", {"include": {"folders": "f1"}}),
    ("non-boolean flag", {"include": {"all": 1}}),
    ("invalid mode", {"mode": "viral"}),
    ("min > max", {"filters": {"min_s": 600, "max_s": 60}}),
    ("per_channel 0", {"filters": {"per_channel": 0}}),
    ("missing folder", {"include": {"folders": ["nope"]}}),
    ("missing excluded folder", {"exclude": {"folders": ["nope"]}}),
    ("missing tag", {"include": {"tags": ["nope"]}}),
    ("missing theme", {"include": {"themes": ["nope"]}}),
    ("invalid channel", {"include": {"channels": ["mkbhd"]}}),
    ("invalid excluded channel", {"exclude": {"channels": ["UCcurto"]}}),
    ("unknown lens", {"include": {"lenses": ["desconhecida"]}}),
    ("not an object", ["include"]),
]


@pytest.mark.parametrize(("label", "data"), INVALID_RULES, ids=[c[0] for c in INVALID_RULES])
def test_invalid_rules_are_rejected(rw: Any, label: str, data: Any) -> None:
    w = rw
    w.tabs.ensure_builtin()
    custom = w.tabs.create(T.TabDraft(name="Minha", kind=T.TabKind.category))
    before = _snapshot(w.db)
    n_changes = len(w.changelog.list())
    with pytest.raises(T.ValidationError):
        w.tabs.validate_rules(data)
    with pytest.raises(T.ValidationError):
        w.tabs.update(custom.id, T.TabPatch(rules=data))
    try:
        rules = T.TabRules.from_dict(data)
    except T.ValidationError:
        pass
    else:  # passes the schema, fails the reference: create refuses too
        with pytest.raises(T.ValidationError):
            w.tabs.create(T.TabDraft(name="X", kind=T.TabKind.mixed, rules=rules))
    assert _snapshot(w.db) == before, label
    assert len(w.changelog.list()) == n_changes


def test_valid_rules_with_references(rw: Any) -> None:
    w = rw
    tech = w.taxonomy.create_folder("Tech")
    tag = w.taxonomy.create_tag("review")
    data = {
        "include": {"folders": [tech.id], "tags": [tag.id], "lenses": [T.HN_LENS]},
        "exclude": {"channels": [cid(1)], "shorts": True},
        "filters": {"min_s": 1200, "per_channel": 3},
        "mode": "long",
    }
    rules = w.tabs.validate_rules(data)
    assert rules.include.folders == (tech.id,) and rules.mode is T.FeedMode.long
    assert w.tabs.validate_rules(rules.to_dict()) == rules
    assert w.tabs.validate_rules({}) == T.TabRules()


def test_tab_lifecycle(rw: Any) -> None:
    w = rw
    tabs = w.tabs
    tabs.ensure_builtin()
    tech = w.taxonomy.create_folder("Tech")
    rules = T.TabRules(include=T.RuleInclude(folders=(tech.id,)), mode=T.FeedMode.long)
    tab = tabs.create(T.TabDraft(name=" Longos ", kind=T.TabKind.category, rules=rules, icon="🧠"))
    assert (tab.name, tab.kind, tab.icon, tab.sort, tab.builtin) == (
        "Longos",
        T.TabKind.category,
        "🧠",
        2,
        False,
    )
    assert tab.rules == rules and dict(tab.filters) == {}
    assert tabs.get(tab.id) == tab and tabs.get("nope") is None
    assert [t.id for t in tabs.list()] == [T.BUILTIN_TAB_ALL_NEW, T.BUILTIN_TAB_FAVORITES, tab.id]
    with pytest.raises(T.ValidationError):
        tabs.create(T.TabDraft(name="  ", kind=T.TabKind.category))
    with pytest.raises(T.ValidationError):
        tabs.create(T.TabDraft(name="X", kind="nope"))  # type: ignore[arg-type]
    with pytest.raises(T.ValidationError):
        tabs.create(T.TabDraft(name="X", kind=T.TabKind.mixed, filters=["a"]))  # type: ignore[arg-type]
    with pytest.raises(T.Conflict):
        tabs.create(T.TabDraft(name="X", kind=T.TabKind.mixed, id=tab.id))

    upd = tabs.update(
        tab.id,
        T.TabPatch(
            name="Tech longo",
            kind=T.TabKind.mixed,
            rules={"include": {"folders": [tech.id]}, "mode": "classics"},
            icon=None,
            filters={"view": "grid"},
        ),
    )
    assert (upd.name, upd.kind, upd.icon, upd.rules.mode) == (
        "Tech longo",
        T.TabKind.mixed,
        None,
        T.FeedMode.classics,
    )
    assert dict(upd.filters) == {"view": "grid"}
    with pytest.raises(T.ValidationError):
        tabs.update(tab.id, T.TabPatch(kind="nope"))
    with pytest.raises(T.ValidationError):
        tabs.update(tab.id, T.TabPatch(name=""))
    with pytest.raises(T.NotFound):
        tabs.update("nope", T.TabPatch(name="x"))
    n = len(w.changelog.list())
    assert tabs.update(tab.id, T.TabPatch()) == upd
    assert tabs.update(tab.id, T.TabPatch(name="Tech longo")) == upd, "no-op"
    assert len(w.changelog.list()) == n

    tabs.delete(tab.id)
    assert tabs.get(tab.id) is None
    with pytest.raises(T.NotFound):
        tabs.delete(tab.id)


def test_reorder_tabs_is_stable(rw: Any) -> None:
    w = rw
    tabs = w.tabs
    tabs.ensure_builtin()
    x = tabs.create(T.TabDraft(name="X", kind=T.TabKind.category))
    y = tabs.create(T.TabDraft(name="Y", kind=T.TabKind.category))
    tabs.reorder([y.id, T.BUILTIN_TAB_FAVORITES])
    ids = [t.id for t in tabs.list()]
    assert ids == [y.id, T.BUILTIN_TAB_FAVORITES, T.BUILTIN_TAB_ALL_NEW, x.id]
    assert [t.sort for t in tabs.list()] == [0, 1, 2, 3]
    for bad, exc in (
        ([x.id, x.id], T.ValidationError),
        ([], T.ValidationError),
        ([x.id, "nope"], T.NotFound),
    ):
        with pytest.raises(exc):
            tabs.reorder(bad)
    n = len(w.changelog.list())
    tabs.reorder(ids)
    assert len(w.changelog.list()) == n
    w.changelog.undo(w.changelog.list()[0].id, targets=w.targets())
    assert [t.id for t in tabs.list()] == [
        T.BUILTIN_TAB_ALL_NEW,
        T.BUILTIN_TAB_FAVORITES,
        x.id,
        y.id,
    ]


def test_create_from_channels(rw: Any) -> None:
    w = rw
    a, b = _sub(w, 1, 2)
    tab = w.tabs.create_from_channels("Meus reviews", [a, b, a], icon="🎬")
    assert tab.kind is T.TabKind.channels and tab.icon == "🎬"
    assert tab.rules.include.channels == (a, b)
    assert w.changelog.list()[0].action is T.ChangeAction.tab_create
    for name, ids in (("", [a]), ("X", []), ("X", ["mkbhd"]), ("X", "abc")):
        with pytest.raises(T.ValidationError):
            w.tabs.create_from_channels(name, ids)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- undo


def _prepare(w: Any) -> SimpleNamespace:
    a, b, c = _sub(w, 1, 2, 3)
    w.tabs.ensure_builtin()
    tech = w.taxonomy.create_folder("Tech", color="#111111")
    ia = w.taxonomy.create_folder("IA", parent_id=tech.id)
    games = w.taxonomy.create_folder("Games")
    review = w.taxonomy.create_tag("review")
    tut = w.taxonomy.create_tag("tutorial")
    w.channels.move([a, b], ia.id)
    w.channels.move([c], tech.id)
    w.channels.set_tags(a, [review.id])
    w.channels.set_tags(c, [review.id, tut.id])
    tab = w.tabs.create(
        T.TabDraft(
            name="Longos",
            kind=T.TabKind.category,
            rules=T.TabRules(include=T.RuleInclude(folders=(tech.id,))),
            filters={"view": "list"},
        )
    )
    tab2 = w.tabs.create(T.TabDraft(name="Outra", kind=T.TabKind.mixed, icon="x"))
    return SimpleNamespace(
        a=a, b=b, c=c, tech=tech, ia=ia, games=games, review=review, tut=tut, tab=tab, tab2=tab2
    )


ACTIONS: dict[str, Callable[[Any, SimpleNamespace], Any]] = {
    "folder_create": lambda w, s: w.taxonomy.create_folder("Nova", parent_id=s.games.id),
    "folder_update": lambda w, s: w.taxonomy.update_folder(s.ia.id, name="ML", color="#abcdef"),
    "folder_move": lambda w, s: w.taxonomy.move_folder(s.ia.id, s.games.id),
    "folder_move_root": lambda w, s: w.taxonomy.move_folder(s.ia.id, None),
    "folder_delete": lambda w, s: w.taxonomy.delete_folder(s.tech.id),
    "folder_delete_leaf": lambda w, s: w.taxonomy.delete_folder(s.ia.id),
    "folder_reorder": lambda w, s: w.taxonomy.reorder_folders([s.games.id, s.tech.id]),
    "tag_create": lambda w, s: w.taxonomy.create_tag("nova"),
    "tag_update": lambda w, s: w.taxonomy.update_tag(s.review.id, name="Reviews", color="#fff"),
    "tag_delete": lambda w, s: w.taxonomy.delete_tag(s.review.id),
    "tab_create": lambda w, s: w.tabs.create(T.TabDraft(name="N", kind=T.TabKind.mixed)),
    "tab_update": lambda w, s: w.tabs.update(
        s.tab.id,
        T.TabPatch(
            name="Z",
            kind=T.TabKind.mixed,
            rules={"mode": "long", "include": {"all": True}},
            icon="i",
            filters={"a": 1},
        ),
    ),
    "tab_delete": lambda w, s: w.tabs.delete(s.tab.id),
    "tab_reorder": lambda w, s: w.tabs.reorder([s.tab2.id, s.tab.id]),
    "tab_from_channels": lambda w, s: w.tabs.create_from_channels("Sel", [s.a, s.c]),
}


@pytest.mark.parametrize("name", list(ACTIONS))
def test_do_and_undo_per_action(rw: Any, name: str) -> None:
    w = rw
    s = _prepare(w)
    before = _snapshot(w.db)
    mark = _last_change_id(w)
    ACTIONS[name](w, s)
    assert _snapshot(w.db) != before, "the action changed something"
    new = [r for r in w.changelog.list() if r.id > mark]
    assert new, "the action recorded history"
    _undo_since(w, mark)
    assert _snapshot(w.db) == before
    for rec in new:
        assert w.changelog.get(rec.id).undone_at is not None


def test_undo_folder_create_refused_when_folder_in_use(rw: Any) -> None:
    w = rw
    (a,) = _sub(w, 1)
    f = w.taxonomy.create_folder("F")
    rec = w.changelog.list()[0]
    w.channels.move([a], f.id)
    with pytest.raises(T.UndoRefused):
        w.changelog.undo(rec.id, targets=w.targets())
    assert w.taxonomy.get_folder(f.id) is not None and w.channels.get(a).folder_id == f.id
    g = w.taxonomy.create_folder("G")
    rec_g = w.changelog.list()[0]
    w.taxonomy.create_folder("Sub", parent_id=g.id)
    with pytest.raises(T.UndoRefused):
        w.changelog.undo(rec_g.id, targets=w.targets())
    assert w.taxonomy.get_folder(g.id) is not None


def test_undo_tag_create_refused_when_tag_in_use(rw: Any) -> None:
    w = rw
    (a,) = _sub(w, 1)
    t = w.taxonomy.create_tag("t")
    rec = w.changelog.list()[0]
    w.channels.set_tags(a, [t.id])
    with pytest.raises(T.UndoRefused):
        w.changelog.undo(rec.id, targets=w.targets())
    assert w.channels.get(a).tag_ids == (t.id,)


def test_undo_move_refused_when_it_would_create_a_cycle(rw: Any) -> None:
    tax = rw.taxonomy
    a = tax.create_folder("A")
    b = tax.create_folder("B", parent_id=a.id)  # A > B
    tax.move_folder(b.id, None)
    rec_mv = rw.changelog.list()[0]  # before: parent_id = A
    tax.move_folder(a.id, b.id)  # now B > A; moving B back inside A would be a cycle
    with pytest.raises(T.UndoRefused):
        rw.changelog.undo(rec_mv.id, targets=rw.targets())
    assert tax.get_folder(b.id).parent_id is None
    assert tax.get_folder(a.id).parent_id == b.id
    # parent deleted afterwards: undoing the move is refused too (does not make up a parent)
    c = tax.create_folder("C")
    d = tax.create_folder("D", parent_id=c.id)
    tax.move_folder(d.id, None)
    rec_d = rw.changelog.list()[0]
    tax.delete_folder(c.id)
    with pytest.raises(T.UndoRefused):
        rw.changelog.undo(rec_d.id, targets=rw.targets())


def test_undo_tab_update_refused_when_tab_is_gone(rw: Any) -> None:
    w = rw
    tab = w.tabs.create(T.TabDraft(name="X", kind=T.TabKind.mixed))
    w.tabs.update(tab.id, T.TabPatch(name="Y"))
    rec = w.changelog.list()[0]
    w.tabs.delete(tab.id)
    with pytest.raises(T.UndoRefused):
        w.changelog.undo(rec.id, targets=w.targets())


def test_services_refuse_foreign_undo(rw: Any) -> None:
    rec = T.ChangeRecord(
        id=1,
        ts=0,
        actor=T.Actor.user,
        action=T.ChangeAction.channel_move,
        payload={},
        undo=T.UndoChannelMove(before={}),
    )
    for svc in (rw.taxonomy, rw.tabs):
        with pytest.raises(T.UndoRefused):
            svc.apply_undo(rec)
    tab_reorder = T.ChangeRecord(
        id=2,
        ts=0,
        actor=T.Actor.user,
        action=T.ChangeAction.tab_reorder,
        payload={},
        undo=T.UndoReorder(before={}),
    )
    with pytest.raises(T.UndoRefused):
        rw.taxonomy.apply_undo(tab_reorder)


def test_apply_undo_never_records(rw: Any) -> None:
    """``FakeChangeLog`` fails if ``apply_undo`` writes; here the real one: stable count."""
    w = rw
    s = _prepare(w)
    for name in ("folder_delete", "tag_delete", "tab_delete", "folder_reorder"):
        mark = _last_change_id(w)
        ACTIONS[name](w, s)
        n = len(w.changelog.list(limit=500))
        _undo_since(w, mark)
        assert len(w.changelog.list(limit=500)) == n, name


# --------------------------------------------------------------------------- REST routes


def _op(operation_id: str) -> Any:
    return gen_types.get_operation(CONTRACT, operation_id)


def _check(operation_id: str, env: Any, *, ok: bool = True) -> Any:
    op = _op(operation_id)
    assert _common.is_envelope(env), env
    if env["ok"]:
        gen_types.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    else:
        assert env["error"]["code"] in set(op.errors) | {"internal"}, env
    assert env["ok"] is ok, env
    return env.get("data") if ok else env["error"]


def _call(fn: Any, body: Any = None, query: Any = None) -> Any:
    """Like the router: ``TubeError`` becomes an envelope."""
    try:
        return fn(body, query or {})
    except T.TubeError as exc:
        return _common.error_envelope(exc)


HANDLERS = {
    "getFolders": api_tax.get_folders,
    "postFolder": api_tax.post_folder,
    "patchFolder": api_tax.patch_folder,
    "deleteFolder": api_tax.delete_folder,
    "postFoldersReorder": api_tax.post_folders_reorder,
    "getTags": api_tax.get_tags,
    "postTag": api_tax.post_tag,
    "patchTag": api_tax.patch_tag,
    "deleteTag": api_tax.delete_tag,
    "getTabs": api_tabs.get_tabs,
    "postTab": api_tabs.post_tab,
    "patchTab": api_tabs.patch_tab,
    "deleteTab": api_tabs.delete_tab,
    "postTabsReorder": api_tabs.post_tabs_reorder,
    "postTabFromChannels": api_tabs.post_tab_from_channels,
}


HANDLER_BAD_CALLS: list[tuple[Any, Any]] = [
    (api_tax.post_folder, {}),
    (api_tax.patch_folder, {"name": "x"}),
    (api_tax.delete_folder, None),
    (api_tax.post_folders_reorder, {"ids": ["nope"]}),
    (api_tax.post_tag, None),
    (api_tax.patch_tag, {"name": "x"}),
    (api_tax.delete_tag, None),
    (api_tabs.post_tab, {}),
    (api_tabs.patch_tab, {"name": "x"}),
    (api_tabs.delete_tab, None),
    (api_tabs.post_tabs_reorder, {"ids": ["nope"]}),
    (api_tabs.post_tab_from_channels, {"name": "x", "channel_ids": ["mkbhd"]}),
]


def test_every_taxonomy_route_is_real_and_covered() -> None:
    ours = {
        op.operation_id
        for op in gen_types.iter_operations(CONTRACT)
        if op.raw.get("x-unit") == "area-taxonomy"
    }
    assert ours == set(HANDLERS)
    for op_id, fn in HANDLERS.items():
        assert _common.is_real(fn), op_id
        assert _common.stub_operation(fn) is None, op_id


@pytest.fixture
def api(rw: Any, wire: Any) -> Any:
    wire.use_world(rw)
    return rw


def test_folder_routes(api: Any) -> None:
    w = api
    data = _check("getFolders", _call(api_tax.get_folders))
    assert data == {"items": []}
    tech = _check("postFolder", _call(api_tax.post_folder, {"name": "Tech", "color": "#7c3aed"}))
    ia = _check("postFolder", _call(api_tax.post_folder, {"name": "IA", "parent_id": tech["id"]}))
    assert ia["parent_id"] == tech["id"]
    err = _check("postFolder", _call(api_tax.post_folder, {"name": "tech"}), ok=False)
    assert err["code"] == "conflict"
    for bad in (
        {},
        {"name": ""},
        {"name": 3},
        {"name": "X", "parent_id": 3},
        None,
        {"name": "X", "color": 1},
    ):
        assert _check("postFolder", _call(api_tax.post_folder, bad), ok=False)["code"] == "invalid"
    err = _check(
        "postFolder", _call(api_tax.post_folder, {"name": "X", "parent_id": "nope"}), ok=False
    )
    assert err["code"] == "not_found"
    items = _check("getFolders", _call(api_tax.get_folders))["items"]
    assert [f["id"] for f in items] == [tech["id"], ia["id"]]

    # patch: rename + move in a single group; cycle → invalid and nothing changes
    moved = _check(
        "patchFolder",
        _call(api_tax.patch_folder, {"name": "IA & ML", "parent_id": None}, {"id": ia["id"]}),
    )
    assert (moved["name"], moved["parent_id"]) == ("IA & ML", None)
    recs = w.changelog.list(limit=2)
    assert recs[0].group_id and recs[0].group_id == recs[1].group_id
    w.taxonomy.move_folder(ia["id"], tech["id"])
    before = _snapshot(w.db)
    err = _check(
        "patchFolder",
        _call(api_tax.patch_folder, {"name": "Outro", "parent_id": ia["id"]}, {"id": tech["id"]}),
        ok=False,
    )
    assert err["code"] == "invalid"
    assert _snapshot(w.db) == before, "patch is atomic"
    assert _call(api_tax.patch_folder, {}, {"id": tech["id"]})["error"]["code"] == "invalid"
    assert (
        _call(api_tax.patch_folder, {"name": "x"}, {"id": "nope"})["error"]["code"] == "not_found"
    )
    colored = _check(
        "patchFolder", _call(api_tax.patch_folder, {"color": None}, {"id": tech["id"]})
    )
    assert colored["color"] is None

    games = _check("postFolder", _call(api_tax.post_folder, {"name": "Games"}))
    data = _check(
        "postFoldersReorder",
        _call(api_tax.post_folders_reorder, {"ids": [games["id"], tech["id"]]}),
    )
    assert data == {"count": 2}
    roots = [
        f["id"]
        for f in _check("getFolders", _call(api_tax.get_folders))["items"]
        if f["parent_id"] is None
    ]
    assert roots == [games["id"], tech["id"]]
    for bad in ({}, {"ids": []}, {"ids": "a"}, {"ids": [1]}):
        assert _call(api_tax.post_folders_reorder, bad)["error"]["code"] == "invalid"
    assert _call(api_tax.post_folders_reorder, {"ids": ["nope"]})["error"]["code"] == "not_found"

    (a,) = _sub(w, 1)
    w.channels.move([a], tech["id"])
    assert _check("deleteFolder", _call(api_tax.delete_folder, None, {"id": tech["id"]})) == {
        "id": tech["id"]
    }
    assert w.channels.get(a).folder_id is None
    assert _call(api_tax.delete_folder, None, {"id": tech["id"]})["error"]["code"] == "not_found"
    assert _call(api_tax.delete_folder, None, {})["error"]["code"] == "not_found"


def test_tag_routes(api: Any) -> None:
    assert _check("getTags", _call(api_tax.get_tags)) == {"items": []}
    tag = _check("postTag", _call(api_tax.post_tag, {"name": "review"}))
    assert tag == {"id": tag["id"], "name": "review", "color": None}
    assert _call(api_tax.post_tag, {"name": "Review"})["error"]["code"] == "conflict"
    for bad in ({}, {"name": ""}, {"name": "x", "color": 3}, None):
        assert _check("postTag", _call(api_tax.post_tag, bad), ok=False)["code"] == "invalid"
    upd = _check("patchTag", _call(api_tax.patch_tag, {"color": "#16a34a"}, {"id": tag["id"]}))
    assert upd["color"] == "#16a34a"
    assert _call(api_tax.patch_tag, {}, {"id": tag["id"]})["error"]["code"] == "invalid"
    assert _call(api_tax.patch_tag, {"name": "x"}, {"id": "nope"})["error"]["code"] == "not_found"
    assert [t["id"] for t in _check("getTags", _call(api_tax.get_tags))["items"]] == [tag["id"]]
    assert _check("deleteTag", _call(api_tax.delete_tag, None, {"id": tag["id"]})) == {
        "id": tag["id"]
    }
    assert _call(api_tax.delete_tag, None, {"id": tag["id"]})["error"]["code"] == "not_found"
    # direct call (no router) also returns an envelope, never raises TubeError
    for fn, body in HANDLER_BAD_CALLS:
        env = fn(body, {"id": "nope"})
        assert env["ok"] is False and env["error"]["code"] in ("invalid", "not_found"), fn


def test_tab_routes(api: Any) -> None:
    w = api
    items = _check("getTabs", _call(api_tabs.get_tabs))["items"]
    assert [t["id"] for t in items] == [T.BUILTIN_TAB_ALL_NEW, T.BUILTIN_TAB_FAVORITES]
    assert w.changelog.list() == []
    tech = w.taxonomy.create_folder("Tech")
    body = {
        "name": "Longos de tech",
        "kind": "category",
        "rules": {"include": {"folders": [tech.id]}, "filters": {"min_s": 1200}, "mode": "long"},
        "icon": "🧠",
    }
    tab = _check("postTab", _call(api_tabs.post_tab, body))
    assert tab["rules"]["filters"]["min_s"] == 1200 and tab["builtin"] is False
    assert tab["sort"] == 2
    no_rules = _check("postTab", _call(api_tabs.post_tab, {"name": "Vazia", "kind": "mixed"}))
    assert no_rules["rules"] == T.TabRules().to_dict()
    for bad in (
        {},
        {"name": "X"},
        {"name": "X", "kind": "nope"},
        {"name": "", "kind": "mixed"},
        {"name": "X", "kind": "mixed", "rules": {"include": {"folders": ["nope"]}}},
        {"name": "X", "kind": "mixed", "rules": "x"},
        {"name": "X", "kind": "mixed", "filters": []},
        {"name": "X", "kind": "mixed", "icon": 1},
        None,
    ):
        assert _check("postTab", _call(api_tabs.post_tab, bad), ok=False)["code"] == "invalid"

    upd = _check(
        "patchTab",
        _call(
            api_tabs.patch_tab,
            {"name": "Tech longo", "rules": {"mode": "classics"}},
            {"id": tab["id"]},
        ),
    )
    assert upd["name"] == "Tech longo" and upd["rules"]["mode"] == "classics"
    assert (
        _check("patchTab", _call(api_tabs.patch_tab, {"name": "x"}, {"id": "nope"}), ok=False)[
            "code"
        ]
        == "not_found"
    )
    assert _call(api_tabs.patch_tab, {}, {"id": tab["id"]})["error"]["code"] == "invalid"
    assert _call(api_tabs.patch_tab, {"kind": "z"}, {"id": tab["id"]})["error"]["code"] == "invalid"

    data = _check(
        "postTabsReorder",
        _call(api_tabs.post_tabs_reorder, {"ids": [tab["id"], T.BUILTIN_TAB_ALL_NEW]}),
    )
    assert data == {"count": 2}
    assert [t["id"] for t in _check("getTabs", _call(api_tabs.get_tabs))["items"]][:2] == [
        tab["id"],
        T.BUILTIN_TAB_ALL_NEW,
    ]
    assert _call(api_tabs.post_tabs_reorder, {"ids": ["nope"]})["error"]["code"] == "not_found"

    err = _check(
        "deleteTab", _call(api_tabs.delete_tab, None, {"id": T.BUILTIN_TAB_ALL_NEW}), ok=False
    )
    assert err["code"] == "conflict"
    assert _check("deleteTab", _call(api_tabs.delete_tab, None, {"id": tab["id"]})) == {
        "id": tab["id"]
    }
    assert _call(api_tabs.delete_tab, None, {"id": tab["id"]})["error"]["code"] == "not_found"


def test_tab_from_channels_route(api: Any) -> None:
    w = api
    a, b = _sub(w, 1, 2)
    tab = _check(
        "postTabFromChannels",
        _call(api_tabs.post_tab_from_channels, {"name": "Meus reviews", "channel_ids": [a, b]}),
    )
    assert tab["kind"] == "channels" and tab["rules"]["include"]["channels"] == [a, b]
    err = _check(
        "postTabFromChannels",
        _call(api_tabs.post_tab_from_channels, {"name": "X", "channel_ids": [a, cid(99)]}),
        ok=False,
    )
    assert err["code"] == "not_found"
    for bad in (
        {},
        {"name": "X"},
        {"name": "X", "channel_ids": []},
        {"name": "X", "channel_ids": ["mkbhd"]},
    ):
        assert _call(api_tabs.post_tab_from_channels, bad)["error"]["code"] == "invalid"


# --------------------------------------------------------------------------- fake conformance


CONFORMANCE = (
    "test_changelog_group_undo_dispatches_to_owners",
    "test_channel_service_rules",
    "test_fake_world_targets_cover_undo_owners",
    "test_organizer_accept_and_undo",
    "test_refresher_cycle_kick_and_mark_read",
    "test_sync_ingest_partial_never_marks_absent",
    "test_list_importer_flow",
    "test_demo_load_clear_and_undo_never_touch_real_data",
    "test_import_mytube_and_json_roundtrip",
    "test_maintenance_run",
    "test_themes_pipeline_with_fake_llm_and_searcher",
    "test_theme_save_is_one_undoable_group",
    "test_seed_world_is_consistent",
    "test_cleanup_scan_rules_ai_and_no_model",
    "test_status_and_new_counts_on_seeded_world",
    "test_queue_invariants_on_seeded_world",
    "test_run_invariants_reports_each",
    "test_seed_world_is_deterministic",
    "test_feed_uses_lenses_only_when_enabled",
)


@pytest.mark.parametrize("name", CONFORMANCE)
def test_fake_suite_passes_with_real_services(rw: Any, name: str) -> None:
    """The ``test_fakes.py`` service tests with ``TaxonomyService``/``TabService`` (and the real
    channel services) — the patch also applies to the worlds the test itself builds."""
    fn = getattr(test_fakes, name)
    params = list(inspect.signature(fn).parameters)
    args: dict[str, Any] = {}
    if params:
        args["fresh_world"] = rw
        args["world"] = rw
        if "seed_world" in params:
            args["seed_world"] = _seed(rw)
    fn(**{p: args[p] for p in params})


def _fake_only_world(db: Any) -> Any:
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(fake_world_module, "FakeChangeLog", FakeChangeLog)
        mp.setattr(fake_world_module, "FakeChannelService", FakeChannelService)
        mp.setattr(fake_world_module, "FakeTaxonomyService", FakeTaxonomyService)
        mp.setattr(fake_world_module, "FakeTabService", FakeTabService)
        return build_fake_world(db)
    finally:
        mp.undo()


def test_seed_world_on_real_matches_fake(real: None) -> None:
    """Same ``seed_world`` on both: identical folders, tags, tabs and links."""
    real_world = build_fake_world(MemDb())
    assert isinstance(real_world.taxonomy, TX.TaxonomyService)
    fake_world = _fake_only_world(MemDb())
    assert isinstance(fake_world.taxonomy, FakeTaxonomyService)
    dumps = []
    for world in (real_world, fake_world):
        _seed(world)
        dumps.append(_snapshot(world.db))
    assert dumps[0] == dumps[1]
