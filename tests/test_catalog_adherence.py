"""Adherence to the Hermes plugin guide and the plugin catalog admission rules.

Each test pins one rule to the code that satisfies it, so a later change that breaks the rule
fails here instead of at catalog review:

- rule 14: ``requires_hermes`` is a true SemVer floor for every Hermes API the plugin calls, and
  the catalog entry declares the same floor, version and capabilities as ``plugin.yaml``;
- the catalog entry's known issues describe this version;
- rule 17: nothing compiled or archived is tracked under ``plugin/`` (a regression guard: the
  tree is clean today; ``__pycache__`` is ignored by git).
"""

from __future__ import annotations

import importlib
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

from tube_pkg._id import PLUGIN_ID

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugin"
CATALOG_ENTRY = ROOT / "docs" / "catalog" / f"{PLUGIN_ID}.yaml"
MANIFEST: dict[str, Any] = yaml.safe_load((PLUGIN_DIR / "plugin.yaml").read_text(encoding="utf-8"))

# --------------------------------------------------------------------------- rule 14: floor

API_FLOORS: tuple[tuple[str, str, str], ...] = (
    # (call made by plugin code, first Hermes SemVer release that ships it, file that makes it)
    ("ctx.register_rpc(", "0.23.1", "plugin/__init__.py"),
    ("ctx.emit_to_session", "0.23.1", "plugin/adapters/hermes_llm.py"),
    ("ctx.ask_choice(", "0.22.5", "plugin/commands.py"),
    ("ctx.session_surface()", "0.22.3", "plugin/commands.py"),
    ("post_message", "0.22.3", "plugin/commands.py"),
    ("ctx.register_automation_blueprint(", "0.21.6", "plugin/__init__.py"),
    ("ctx.register_auxiliary_task(", "0.21.6", "plugin/__init__.py"),
    ("ctx.register_skill(", "0.21.6", "plugin/__init__.py"),
    ("ctx.on_unload(", "0.21.6", "plugin/__init__.py"),
    ("ctx.dispatch_tool(", "0.21.6", "plugin/routines/installer.py"),
    ("plugin_db", "0.21.6", "plugin/adapters/storage.py"),
    ("broadcast_plugin_event", "0.21.6", "plugin/adapters/hermes_llm.py"),
    ("llm.complete_structured(", "0.21.6", "plugin/adapters/hermes_llm.py"),
)
"""Floors read from the Hermes git history: ``git log --reverse -S'def <name>'`` gives the commit
that added each API and ``git tag --contains`` the first ``v0.x.y`` release with it. 0.21.6 is the
oldest SemVer tag (everything before it is CalVer). ``register_rpc``/``emit_to_session`` landed
after 0.23.0 was cut (``hermes_cli/plugin_rpc.py`` is absent from the v0.23.0 tree), which makes
0.23.1 the floor."""


def _floor(spec: str) -> tuple[int, ...]:
    match = re.fullmatch(r"\s*>=\s*(\d+)\.(\d+)\.(\d+)\s*", spec)
    assert match, f"requires_hermes must be a plain SemVer floor, got {spec!r}"
    return tuple(int(part) for part in match.groups())


def _version(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))


@pytest.mark.parametrize(("needle", "since", "where"), API_FLOORS)
def test_api_floor_table_matches_the_code(needle: str, since: str, where: str) -> None:
    # the table stays honest: every API listed is really called where it says
    assert needle in (ROOT / where).read_text(encoding="utf-8"), f"{needle} not used in {where}"


def test_requires_hermes_covers_every_api_used() -> None:
    floor = _floor(MANIFEST["requires_hermes"])
    needed = max(_version(since) for _needle, since, _where in API_FLOORS)
    assert floor >= needed, (
        f"requires_hermes {MANIFEST['requires_hermes']!r} is below {'.'.join(map(str, needed))}, "
        "the first Hermes release with every API the plugin calls"
    )


# --------------------------------------------------------------------------- catalog entry


def _load_entry() -> dict[str, Any]:
    # the entry goes to the Hermes catalog, not to the public cut (export-public leaves it out)
    if not CATALOG_ENTRY.is_file():
        pytest.skip("catalog entry not in this checkout")
    return yaml.safe_load(CATALOG_ENTRY.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def entry() -> dict[str, Any]:
    return _load_entry()


def test_catalog_entry_tests_skip_where_the_entry_is_absent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # the public cut leaves docs/catalog/ out: its test suite must still pass there
    monkeypatch.setattr(sys.modules[__name__], "CATALOG_ENTRY", tmp_path / "missing.yaml")
    with pytest.raises(pytest.skip.Exception):
        _load_entry()


def test_catalog_entry_mirrors_the_manifest(entry: dict[str, Any]) -> None:
    assert entry["name"] == MANIFEST["name"] == PLUGIN_ID
    assert entry["version"] == MANIFEST["version"]
    assert isinstance(entry["version"], str)
    assert entry["requires_hermes"] == MANIFEST["requires_hermes"]
    caps = entry["capabilities"]
    assert caps["provides_tools"] == MANIFEST["provides_tools"]
    assert caps["provides_hooks"] == MANIFEST["provides_hooks"]
    assert caps["provides_middleware"] == list(MANIFEST.get("provides_middleware") or [])
    assert caps["requires_env"] == list(MANIFEST.get("requires_env") or [])
    assert entry["subdir"] == "plugin"
    assert entry["tier"] == "community"


def test_catalog_known_issues_match_the_code(entry: dict[str, Any]) -> None:
    lang = importlib.import_module("tube_pkg.core.lang")
    issues = " ".join(entry.get("known_issues") or [])
    # on ``auto`` without a usable Hermes language the plugin answers in English
    assert lang.DEFAULT == lang.EN
    assert "answer in Portuguese" not in issues
    assert "blueprints are in Portuguese" not in issues
    # the hidden settings are left out of the form, not shown inactive
    form = set(MANIFEST["config_schema"])
    assert not form & {"home_on_youtube", "extras_hn_lens", "extras_import_lists"}
    assert "shown but inactive" not in issues


# --------------------------------------------------------------------------- rule 17

_BINARY_MAGIC = (
    b"\x7fELF",  # ELF
    b"\xfe\xed\xfa\xce",  # Mach-O
    b"\xfe\xed\xfa\xcf",
    b"\xce\xfa\xed\xfe",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",  # Mach-O fat / Java class
    b"MZ",  # PE
    b"\x00asm",  # WebAssembly
    b"PK\x03\x04",  # zip, wheel, jar
    b"\x1f\x8b",  # gzip
)
_BINARY_SUFFIXES = frozenset(
    {".pyc", ".pyo", ".so", ".dylib", ".dll", ".exe", ".wasm", ".whl", ".zip", ".tar", ".gz"}
)


def _tracked(prefix: str) -> list[str]:
    try:
        done = subprocess.run(
            ["git", "ls-files", prefix], cwd=ROOT, capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git is not available")
    return done.stdout.splitlines()


def test_no_compiled_or_archived_payload_is_tracked_under_plugin() -> None:
    offenders = []
    for rel in _tracked("plugin"):
        path = ROOT / rel
        if not path.is_file():
            continue
        head = path.read_bytes()[:4]
        if path.suffix in _BINARY_SUFFIXES or any(head.startswith(m) for m in _BINARY_MAGIC):
            offenders.append(rel)
    assert offenders == []
