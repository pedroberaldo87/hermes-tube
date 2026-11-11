"""Repository skeleton and verification scripts.

Covers the empty tree, the LICENSE, `scripts/check` and the plugin id literal detector
(`scripts/check_id_literal.py`), the latter against temporary trees.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DETECTOR = ROOT / "scripts" / "check_id_literal.py"
CHECK = ROOT / "scripts" / "check"

PACKAGES = ("core", "adapters", "api", "rpc", "ext", "tools", "routines")
KEPT_DIRS = (
    "contract",
    "shared",
    "tests/fixtures",
    "tests/fakes",
    "desktop-src",
    "extension/src",
    "extension/test",
    "extension/e2e/scenarios",
)

# made-up id for the temporary trees (the real literal never appears in this file)
FAKE_ID = "zz-fake-plugin-id"


def _load_detector():
    spec = importlib.util.spec_from_file_location("check_id_literal", DETECTOR)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------- tree


@pytest.mark.parametrize("pkg", PACKAGES)
def test_plugin_subpackage_init_exists_and_is_empty(pkg: str) -> None:
    init = ROOT / "plugin" / pkg / "__init__.py"
    assert init.is_file(), f"missing {init}"
    assert init.read_bytes() == b"", f"{init} must stay empty"


@pytest.mark.parametrize("rel", KEPT_DIRS)
def test_skeleton_dirs_exist(rel: str) -> None:
    assert (ROOT / rel).is_dir(), f"missing folder {rel}/"


def test_license_is_mit() -> None:
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert text.startswith("MIT License")
    assert "Copyright (c) 2026 Pedro Beraldo" in text
    assert "Permission is hereby granted, free of charge" in text


def test_check_script_is_executable_bash() -> None:
    assert CHECK.is_file()
    assert os.access(CHECK, os.X_OK), "scripts/check must be executable"
    first = CHECK.read_text(encoding="utf-8").splitlines()[0]
    assert first.startswith("#!") and "bash" in first
    assert "set -uo pipefail" in CHECK.read_text(encoding="utf-8")


def test_check_script_bash_syntax() -> None:
    subprocess.run(["bash", "-n", str(CHECK)], check=True)


# ---------------------------------------------------------------- literal detector


def _git_tree(tmp: Path, files: dict[str, str], *, commit: bool = True) -> Path:
    root = tmp / "repo"
    root.mkdir()
    for rel, body in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
    subprocess.run(["git", "init", "-q", str(root)], check=True, env=env)
    if commit:
        subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, env=env)
    return root


def _run_detector(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(DETECTOR), "--root", str(root)],
        capture_output=True,
        text=True,
    )


BASE_FILES = {
    "plugin/_id.py": f'PLUGIN_ID = "{FAKE_ID}"\n',
    "shared/ids.ts": f"export const PLUGIN_ID = '{FAKE_ID}'\n",
    "plugin/plugin.yaml": f"name: {FAKE_ID}\n",
    "plugin/dashboard/manifest.json": f'{{"name": "{FAKE_ID}"}}\n',
    f"plugin/skills/{FAKE_ID}/SKILL.md": f"# {FAKE_ID}\n",
    "README.md": f"{FAKE_ID}\n",
    "docs/SPEC.md": f"{FAKE_ID}\n",
    "demo/x.txt": f"{FAKE_ID}\n",
    "handoff/area-35.md": f"{FAKE_ID}\n",
    "units/area-35.md": f"{FAKE_ID}\n",
    "scripts/check": f"# {FAKE_ID}\n",
    "plugin/core/feed.py": "from tube_pkg._id import PLUGIN_ID\n",
}


def test_detector_passes_on_clean_tree(tmp_path: Path) -> None:
    root = _git_tree(tmp_path, BASE_FILES)
    r = _run_detector(root)
    assert r.returncode == 0, r.stdout + r.stderr


def test_detector_flags_tracked_violation_with_file_and_line(tmp_path: Path) -> None:
    files = {**BASE_FILES, "plugin/core/feed.py": f'X = 1\nURL = "/api/plugins/{FAKE_ID}"\n'}
    root = _git_tree(tmp_path, files)
    r = _run_detector(root)
    assert r.returncode == 1
    assert "plugin/core/feed.py:2" in r.stdout


def test_detector_flags_untracked_not_ignored_file(tmp_path: Path) -> None:
    root = _git_tree(tmp_path, {**BASE_FILES, ".gitignore": "ignored.txt\n"})
    (root / "loose.ts").write_text(f"const id = '{FAKE_ID}'\n", encoding="utf-8")
    (root / "ignored.txt").write_text(f"{FAKE_ID}\n", encoding="utf-8")
    r = _run_detector(root)
    assert r.returncode == 1
    assert "loose.ts:1" in r.stdout
    assert "ignored.txt" not in r.stdout


def test_detector_skill_folder_must_match_the_id(tmp_path: Path) -> None:
    files = {**BASE_FILES, "plugin/skills/other/SKILL.md": f"{FAKE_ID}\n"}
    r = _run_detector(_git_tree(tmp_path, files))
    assert r.returncode == 1
    assert "plugin/skills/other/SKILL.md:1" in r.stdout


def test_detector_uses_default_id_without_id_file(tmp_path: Path) -> None:
    det = _load_detector()
    files = {"src/a.py": f'ID = "{det.DEFAULT_ID}"\n', "docs/x.md": det.DEFAULT_ID}
    r = _run_detector(_git_tree(tmp_path, files))
    assert r.returncode == 1
    assert "src/a.py:1" in r.stdout
    assert "docs/x.md" not in r.stdout


def test_detector_reads_id_from_id_file() -> None:
    det = _load_detector()
    assert det.read_plugin_id_text(f'"""x"""\nPLUGIN_ID = "{FAKE_ID}"\n') == FAKE_ID
    assert det.read_plugin_id_text("PLUGIN_ID: str = 'a-b'\n") == "a-b"
    assert det.read_plugin_id_text("nothing here\n") is None


def test_detector_ignores_deleted_tracked_file(tmp_path: Path) -> None:
    root = _git_tree(tmp_path, {**BASE_FILES, "gone.txt": "x\n"})
    (root / "gone.txt").unlink()
    assert _run_detector(root).returncode == 0


@pytest.mark.skipif(shutil.which("git") is None, reason="git missing")
def test_check_id_literal_step_on_planted_violation(tmp_path: Path) -> None:
    """Only the id-literal step of `scripts/check` (via --only), with a planted violation."""
    det = _load_detector()
    plugin_id = det.read_plugin_id(ROOT)
    planted = ROOT / "zz_f02_planted_violation.txt"
    planted.write_text(f"{plugin_id}\n", encoding="utf-8")
    try:
        r = subprocess.run(
            ["bash", str(CHECK), "--only", "id-literal"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
    finally:
        planted.unlink()
    assert r.returncode != 0, r.stdout
    assert "FAIL id-literal" in r.stdout
    assert "zz_f02_planted_violation.txt:1" in r.stdout
    assert "CHECK: FAIL (id-literal)" in r.stdout
    assert "outside the allowed list" in r.stdout
    assert "\ntime: " in r.stdout
