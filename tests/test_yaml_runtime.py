"""YAML reads work in the Hermes runtime, which ships no PyYAML.

Hermes parses YAML with ruamel.yaml (``hermes_yaml``) and does not declare PyYAML, so on a stock
install ``import yaml`` fails. Every place in the plugin that reads YAML by itself (the extension
server's enabled guard, the file fallbacks of the settings and the language rule, the skill
description) must keep working without it.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import types
from pathlib import Path

import pytest

from tube_pkg._id import PLUGIN_ID

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugin"


@pytest.fixture
def no_pyyaml(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make ``import yaml`` raise ``ImportError``, as in the Hermes runtime."""
    monkeypatch.setitem(sys.modules, "yaml", None)


def _write_config(home: Path, text: str) -> Path:
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(text, encoding="utf-8")
    return home


def test_loader_falls_back_to_ruamel(no_pyyaml: None) -> None:
    loader = importlib.import_module("tube_pkg._yaml")
    # YAML 1.1 like Hermes's own loader: a bare ``yes`` is a boolean
    parsed = loader.safe_load("a: [1, 2]\nb: yes\nc: pt-BR\n")
    assert parsed == {"a": [1, 2], "b": True, "c": "pt-BR"}
    assert loader.safe_load("") is None


def test_loader_uses_pyyaml_when_present() -> None:
    loader = importlib.import_module("tube_pkg._yaml")
    assert loader.safe_load("a: 1\n") == {"a": 1}


def test_loader_raises_import_error_without_any_parser(
    no_pyyaml: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(sys.modules, "ruamel", None)
    monkeypatch.setitem(sys.modules, "ruamel.yaml", None)
    loader = importlib.import_module("tube_pkg._yaml")
    with pytest.raises(ImportError):
        loader.safe_load("a: 1\n")


def test_ext_server_guard_reads_config_without_pyyaml(no_pyyaml: None, tmp_path: Path) -> None:
    server = importlib.import_module("tube_pkg.ext._server")
    home = _write_config(tmp_path / "home", f"plugins:\n  disabled:\n    - {PLUGIN_ID}\n")
    assert server.plugin_enabled(home) is False
    _write_config(home, f"plugins:\n  enabled: [{PLUGIN_ID}]\n")
    assert server.plugin_enabled(home) is True


def test_settings_file_fallback_reads_config_without_pyyaml(
    no_pyyaml: None, tmp_path: Path
) -> None:
    settings_mod = importlib.import_module("tube_pkg.adapters.settings")
    home = _write_config(
        tmp_path / "home",
        f"plugins:\n  entries:\n    {PLUGIN_ID}:\n      settings:\n        language: pt-BR\n",
    )
    settings = settings_mod.PluginSettings(home=home)
    assert settings._raw_yaml() == {"language": "pt-BR"}


def test_language_file_fallback_reads_config_without_pyyaml(
    no_pyyaml: None, tmp_path: Path
) -> None:
    lang = importlib.import_module("tube_pkg.core.lang")
    home = _write_config(tmp_path / "home", "display:\n  language: pt-BR\n")
    assert lang._display_language_yaml(home) == "pt-BR"


def _load_plugin_init() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(
        "_tube_plugin_init_yaml_runtime", PLUGIN_DIR / "__init__.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_skill_description_is_read_without_pyyaml(no_pyyaml: None) -> None:
    plugin_init = _load_plugin_init()
    skill_md = PLUGIN_DIR / "skills" / PLUGIN_ID / "SKILL.md"
    assert plugin_init._skill_description(skill_md).startswith(
        "How to use the YouTube subscriptions tools"
    )
