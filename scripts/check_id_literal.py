#!/usr/bin/env python3
"""Detector for the plugin id literal (the id is written in only a few allowed files).

The id comes from `plugin/_id.py` (`PLUGIN_ID = "..."`); without that file, `DEFAULT_ID` applies.
Scans tracked files plus untracked, non-ignored ones (`git ls-files -co --exclude-standard`) and
fails if the literal appears outside the allowed list, printing `file:line: snippet` per
occurrence.

    python scripts/check_id_literal.py [--root <dir>]

Exit 0 = clean; 1 = violation; 2 = usage/environment error.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

# the plugin id; that is why this file is on the allowed list
DEFAULT_ID = "hermes-tube"

ID_FILE = "plugin/_id.py"
_ID_RE = re.compile(r"""^PLUGIN_ID\s*(?::\s*str\s*)?=\s*["']([^"']+)["']""", re.MULTILINE)

ALLOWED_FILES = frozenset(
    {
        "plugin/_id.py",
        "shared/ids.ts",
        "plugin/plugin.yaml",
        "plugin/dashboard/manifest.json",
        "README.md",
        "README.pt-BR.md",
        "plugin/README.md",  # the plugin's public README names the id (install, data folder)
        "CONTRIBUTING.md",  # public docs name the repository and the data folder
        "SECURITY.md",
        "scripts/check",
        "scripts/check_id_literal.py",
    }
)
ALLOWED_DIRS = (
    "docs/",
    "demo/",
    "handoff/",
    "units/",
    "extension/dist/",
    "plugin/desktop/",
    "plugin/extension/",  # the built extension shipped inside the plugin
)  # builds embed the id

# without git: folders that are never scanned
_WALK_SKIP = {".git", "node_modules", "ref", ".venv", "__pycache__"}


def read_plugin_id_text(text: str) -> str | None:
    m = _ID_RE.search(text)
    return m.group(1) if m else None


def read_plugin_id(root: Path) -> str:
    p = root / ID_FILE
    if p.is_file():
        found = read_plugin_id_text(p.read_text(encoding="utf-8"))
        if found:
            return found
    return DEFAULT_ID


def is_allowed(rel: str, plugin_id: str) -> bool:
    if rel in ALLOWED_FILES:
        return True
    if rel.startswith(ALLOWED_DIRS):
        return True
    return rel.startswith(f"plugin/skills/{plugin_id}/")


def list_files(root: Path) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", "-co", "--exclude-standard"],
            capture_output=True,
            check=True,
        ).stdout
        rels = {r for r in out.decode("utf-8", "surrogateescape").split("\0") if r}
    except (OSError, subprocess.CalledProcessError):
        rels = set()
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _WALK_SKIP]
            for name in filenames:
                rels.add(Path(dirpath, name).relative_to(root).as_posix())
    # files deleted in the worktree stay in the index; symbolic links are not followed
    return sorted(r for r in rels if (root / r).is_file() and not (root / r).is_symlink())


def scan(root: Path, plugin_id: str) -> list[tuple[str, int, str]]:
    needle = plugin_id.encode("utf-8")
    hits: list[tuple[str, int, str]] = []
    for rel in list_files(root):
        if is_allowed(rel, plugin_id):
            continue
        try:
            data = (root / rel).read_bytes()
        except OSError:
            continue
        if needle not in data:
            continue
        for n, line in enumerate(data.splitlines(), start=1):
            if needle in line:
                snippet = line.decode("utf-8", "replace").strip()
                hits.append((rel, n, snippet[:160]))
    return hits


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Detector for the plugin id literal")
    ap.add_argument("--root", default=".", help="repository root (default: current directory)")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"check_id_literal: root does not exist: {root}", file=sys.stderr)
        return 2
    plugin_id = read_plugin_id(root)
    hits = scan(root, plugin_id)
    for rel, n, snippet in hits:
        print(f"{rel}:{n}: {snippet}")
    if hits:
        print(
            f"check_id_literal: {len(hits)} occurrence(s) of the literal '{plugin_id}' "
            "outside the allowed list"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
