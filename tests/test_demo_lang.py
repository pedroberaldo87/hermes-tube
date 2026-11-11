"""Demo in the resolved language (``plugin/core/demo.py``).

Folder and tab names of the demo come out in the language given by the ``core/lang`` rule at
``load`` time (the screen's ``ui_locale`` wins under ``auto``); loading again in another language
only renames what the demo created and still has a catalog name. Real data is never renamed.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeSettings
from test_data import _new_world, _real_factories

from tube_pkg.core import demo as DM
from tube_pkg.core import types as T

EN_FOLDERS = {"Technology", "Science", "Cooking", "Music", "News", "Games"}
PT_FOLDERS = {"Tecnologia", "Ciência", "Culinária", "Música", "Notícias", "Games"}


@pytest.fixture
def real(monkeypatch: pytest.MonkeyPatch) -> None:
    _real_factories(monkeypatch)


@pytest.fixture
def rw(real: None, tmp_path: Path, clock: FakeClock) -> Iterator[Any]:
    world = _new_world(real, tmp_path / "b12.db", clock)
    yield world
    world.db.close()


def folder_names(w: Any) -> set[str]:
    return {f.name for f in w.taxonomy.list_folders()}


def theme_tab(w: Any) -> Any:
    (tab,) = [t for t in w.tabs.list() if t.kind is T.TabKind.theme]
    return tab


def set_lang(w: Any, value: str) -> None:
    w.settings.set("language", value)
    w.demo.settings = w.settings


def test_every_catalog_folder_and_tab_has_an_english_name() -> None:
    catalog = DM.load_catalog()
    for f in catalog.folders:
        assert f"folder:{f.key}" in DM.EN_NAMES, f.key
    for t in catalog.tabs:
        assert f"tab:{t.key}" in DM.EN_NAMES, t.key


def test_auto_without_information_loads_english_names(rw: Any) -> None:
    rw.demo.load()
    assert EN_FOLDERS <= folder_names(rw)
    assert not (PT_FOLDERS - {"Games"}) & folder_names(rw)
    assert theme_tab(rw).name == "Artificial intelligence"


def test_ui_locale_from_the_screen_wins_in_auto(rw: Any) -> None:
    rw.demo.load(ui_locale="pt-BR")
    assert PT_FOLDERS <= folder_names(rw)
    assert theme_tab(rw).name == "Inteligência artificial"


def test_explicit_setting_wins_over_ui_locale(rw: Any) -> None:
    set_lang(rw, "en")
    rw.demo.load(ui_locale="pt-BR")
    assert EN_FOLDERS <= folder_names(rw)


def test_reload_in_other_language_renames_only_demo_names(rw: Any) -> None:
    user = rw.taxonomy.create_folder("Ciência")  # real folder with a pt-BR catalog name
    rw.demo.load(ui_locale="en")
    assert EN_FOLDERS <= folder_names(rw)
    # the user renamed a demo folder: it is their data now
    tech = rw.taxonomy.find_folder_by_name("Technology", parent_id=None)
    rw.taxonomy.update_folder(tech.id, name="My tech")
    before_ids = {f.id for f in rw.taxonomy.list_folders()}

    assert rw.demo.load(ui_locale="pt-BR") == T.DataReport()

    names = folder_names(rw)
    assert {"Ciência", "Culinária", "Música", "Notícias", "Games", "My tech"} <= names
    assert "Science" in names, (
        "the 'Ciência' folder already belongs to the user: the demo one stays as is"
    )
    assert rw.taxonomy.get_folder(user.id).name == "Ciência"
    assert {f.id for f in rw.taxonomy.list_folders()} == before_ids, "renames, does not recreate"
    assert theme_tab(rw).name == "Inteligência artificial"
    assert rw.demo.manifest()["lang"] == "pt-BR"
    # same language again: nothing changes
    assert rw.demo.load(ui_locale="pt-BR") == T.DataReport()
    assert folder_names(rw) == names
    # back to English and clear: only what belongs to the demo goes away
    rw.demo.load(ui_locale="en")
    assert "Cooking" in folder_names(rw)
    rw.data.clear_demo()
    assert folder_names(rw) == {"Ciência"}, "empty demo folders go away"


def test_old_manifest_without_language_is_renamed_by_name(rw: Any) -> None:
    import json

    rw.demo.load(ui_locale="pt-BR")

    data = json.loads(rw.demo._meta_get(DM.META_DEMO_MANIFEST))
    data.pop("lang")
    data.pop("folder_keys")
    data.pop("tab_key")
    rw.demo._meta_set(DM.META_DEMO_MANIFEST, json.dumps(data))  # manifest from an older version
    rw.demo.load(ui_locale="en")
    assert EN_FOLDERS <= folder_names(rw)
    assert theme_tab(rw).name == "Artificial intelligence"


def test_report_warnings_follow_the_language(rw: Any) -> None:
    rw.channels.upsert_many(
        [T.ChannelIn(title="Fireship", channel_id="UCsBjURrPoezykLs9EqgamOA")],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    report = rw.demo.load(ui_locale="en")
    assert report.warnings and "already in your list" in report.warnings[0]
    rw.data.clear_demo()
    set_lang(rw, "pt-BR")
    report = rw.demo.load()
    assert report.warnings and "já estavam" in report.warnings[0]


def test_demo_loader_signature_keeps_protocol() -> None:
    loader = DM.DemoLoader(
        db=None, settings=FakeSettings(), channels=None, taxonomy=None, tabs=None
    )
    assert isinstance(loader, T.DemoLoader)
