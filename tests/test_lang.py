"""The single language rule (``plugin/core/lang.py``) and who uses it.

Rule: an explicit setting (``en``/``pt-BR``) wins; in ``auto``, whatever the surface reports
(typed subcommand, the Desktop ``ui_locale``); then the Hermes language in the profile
(``display.language``, the same one the Desktop app follows); with no information, English.
"""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path
from typing import Any

import pytest
import yaml
from fakes import FakeClock, FakeCtx, FakeLLM, FakeSettings, build_fake_world
from fakes import seed_world as _seed_world

from tube_pkg import commands
from tube_pkg.core import lang
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
HERMES_SRC = Path(os.environ.get("HERMES_SRC") or Path.home() / ".hermes" / "hermes-agent")


class HomeSettings(FakeSettings):
    """``FakeSettings`` with ``home`` (like the gateway's ``PluginSettings``)."""

    def __init__(self, home: Path | None, **kw: Any) -> None:
        super().__init__(**kw)
        self.home = home


class ChatCtx(FakeCtx):
    def session_surface(self) -> str:
        return "telegram"


def make_home(tmp_path: Path, display: str | None) -> Path:
    home = tmp_path / "profile"
    home.mkdir(parents=True, exist_ok=True)
    config: dict[str, Any] = {}
    if display is not None:
        config["display"] = {"language": display}
    (home / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
    return home


# =========================================================================== the rule


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("en", "en"),
        ("EN-us", "en"),
        ("pt-BR", "pt-BR"),
        ("pt_br", "pt-BR"),
        ("pt", "pt-BR"),
        ("auto", None),
        ("", None),
        ("es", None),
        ("zh-hans", None),
        (None, None),
        (3, None),
    ],
)
def test_normalize(raw: Any, expected: str | None) -> None:
    assert lang.normalize(raw) == expected


def test_explicit_setting_wins_over_surface_and_hermes(tmp_path: Path) -> None:
    home = make_home(tmp_path, "pt-br")
    assert lang.resolve(HomeSettings(home, language="en"), "pt-BR") == "en"
    assert lang.resolve(HomeSettings(home, language="pt-BR"), "en") == "pt-BR"


def test_auto_uses_surface_hint_then_hermes_then_english(tmp_path: Path) -> None:
    pt_home = make_home(tmp_path / "a", "pt-br")
    assert lang.resolve(HomeSettings(pt_home), "en") == "en"  # the surface reported it
    assert lang.resolve(HomeSettings(pt_home)) == "pt-BR"  # Hermes language in the profile
    assert lang.resolve(HomeSettings(make_home(tmp_path / "b", None))) == "en"
    assert lang.resolve(HomeSettings(make_home(tmp_path / "c", "es"))) == "en"
    assert lang.resolve(FakeSettings()) == "en"  # no profile: nothing read
    assert lang.resolve(None) == "en"
    assert lang.resolve(FakeSettings(), "auto") == "en"


def test_hermes_language_yaml_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = make_home(tmp_path, "pt")
    assert lang.hermes_language(home) == "pt-BR"
    import builtins

    real_import = builtins.__import__

    def no_hermes(name: str, *a: Any, **kw: Any) -> Any:
        if name.startswith(("hermes_cli", "hermes_constants")):
            raise ImportError(name)
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_hermes)
    assert lang.hermes_language(home) == "pt-BR"
    assert lang.hermes_language(tmp_path / "missing") is None
    assert lang.hermes_language(None) is None


def test_broken_config_falls_back_to_english(tmp_path: Path) -> None:
    home = tmp_path / "broken"
    home.mkdir()
    (home / "config.yaml").write_text("display: [unclosed", encoding="utf-8")
    assert lang.resolve(HomeSettings(home)) == "en"


def test_lang_imports_only_public_hermes_surface() -> None:
    """Catalog rule 9: only modules from the public Hermes plugin API."""
    api_file = HERMES_SRC / "hermes_cli" / "data" / "plugin_api.json"
    if not api_file.is_file():
        pytest.skip("Hermes checkout missing")
    data = json.loads(api_file.read_text(encoding="utf-8"))
    public = {e for g in data["groups"] for e in g["entries"]}
    tree = ast.parse((ROOT / "plugin" / "core" / "lang.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and not node.level:
            top = node.module.split(".")[0]
            if top in {"hermes_cli", "hermes_constants", "agent", "gateway", "tools", "cron"}:
                for alias in node.names:
                    assert node.module in public or f"{node.module}:{alias.name}" in public, (
                        node.module,
                        alias.name,
                    )
                    assert not alias.name.startswith("_")


# =========================================================================== /tube


@pytest.fixture
def w(db: Any, clock: FakeClock, wire: Any) -> Any:
    world = build_fake_world(db, clock=clock, llm=FakeLLM(auto=True))
    world.seed = _seed_world(world)
    wire.use_world(world)
    return world


def test_bare_tube_in_auto_without_information_is_english(w: Any) -> None:
    out = commands.handle("", ctx=ChatCtx())
    assert "New:" in out and "Novos" not in out


def test_bare_tube_follows_hermes_language_in_auto(w: Any, wire: Any, tmp_path: Path) -> None:
    wire.set("settings", HomeSettings(make_home(tmp_path, "pt-br")))
    out = commands.handle("", ctx=ChatCtx())
    assert "Novos:" in out


def test_explicit_setting_wins_over_typed_subcommand(w: Any, wire: Any) -> None:
    wire.set("settings", FakeSettings(language="pt-BR"))
    assert "Subcommands" not in commands.handle("help", ctx=ChatCtx())
    wire.set("settings", FakeSettings(language="en"))
    out = commands.handle("ajuda", ctx=ChatCtx())
    assert "Subcommands" in out


def test_typed_subcommand_is_the_surface_hint_in_auto(w: Any) -> None:
    assert "Subcommands" in commands.handle("help", ctx=ChatCtx())
    assert "resumo" in commands.handle("ajuda", ctx=ChatCtx())


# =========================================================================== routines and AI


def test_routine_env_language_follows_rule(tmp_path: Path) -> None:
    from tube_pkg.adapters.storage import open_db
    from tube_pkg.routines import runner

    db_path = tmp_path / "tube.db"
    open_db(path=str(db_path)).close()
    env = runner._open_env("bom-dia", make_home(tmp_path / "a", None), db_path)
    try:
        assert env.lang == "en"
        assert env.t("pt", "en") == "en"
    finally:
        env.db.close()
    env = runner._open_env("bom-dia", make_home(tmp_path / "b", "pt-br"), db_path)
    try:
        assert env.lang == "pt-BR"
        assert env.t("pt", "en") == "pt"
    finally:
        env.db.close()


def _llm_language(settings: Any) -> Any:
    from test_ai import FakeLLMBackend, echo_organize, organize_payload

    from tube_pkg.core import ai

    backend = FakeLLMBackend().script(echo_organize)
    payload = dict(organize_payload(1))
    payload.pop("language", None)
    ai.build(settings=settings, llm_backend=backend).complete_structured(T.AiTask.organize, payload)
    return json.loads(backend.calls[0]["input_text"]).get("language")


def test_ai_always_gets_the_resolved_language(tmp_path: Path) -> None:
    assert _llm_language(FakeSettings()) == "en"
    assert _llm_language(FakeSettings(language="pt-BR")) == "pt-BR"
    assert _llm_language(HomeSettings(make_home(tmp_path, "pt-br"))) == "pt-BR"


# =========================================================================== contract (Desktop)


def test_contract_demo_load_accepts_ui_locale() -> None:
    api = yaml.safe_load((ROOT / "contract" / "api.yaml").read_text(encoding="utf-8"))
    op = api["paths"]["/demo/load"]["post"]
    body = op["requestBody"]
    assert body.get("required") is False
    schema = body["content"]["application/json"]["schema"]
    if "$ref" in schema:
        schema = api["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]]
    assert schema["properties"]["ui_locale"]["enum"] == ["en", "pt-BR"]
    assert "ui_locale" not in schema.get("required", [])
