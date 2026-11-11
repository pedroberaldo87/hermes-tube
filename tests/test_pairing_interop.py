"""The extension's pairing code (TypeScript) against the real local server (Python), over HTTP.

Each side has unit tests with shared known-answer vectors; this is the one place where the
extension's own ``lib/pake.ts`` talks to the plugin's own server. Needs a Node that runs
TypeScript files directly (23.6 or newer); skipped otherwise.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from test_security_pairing import auth, live, rdb  # noqa: F401 — fixtures

CLIENT = Path(__file__).resolve().parent / "interop" / "pair_client.mjs"


def _node() -> str | None:
    node = shutil.which("node")
    if not node:
        return None
    try:
        version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10)
        major, minor = (int(p) for p in version.stdout.strip().lstrip("v").split(".")[:2])
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return node if (major, minor) >= (23, 6) else None


def _run(node: str, port: int, code: str) -> tuple[int, dict[str, Any]]:
    done = subprocess.run(
        [node, str(CLIENT), str(port), code], capture_output=True, text=True, timeout=60
    )
    lines = [ln for ln in done.stdout.splitlines() if ln.startswith("{")]
    assert lines, done.stderr[-800:]
    return done.returncode, json.loads(lines[-1])


def test_extension_pairs_with_the_real_server(live: tuple[int, str], auth: Any) -> None:  # noqa: F811
    node = _node()
    if node is None:
        pytest.skip("needs Node 23.6+ (runs the extension's TypeScript directly)")
    port, code = live
    status, out = _run(node, port, code)
    assert out == {
        "round1": True,
        "serverConfirmed": True,
        "paired": True,
        "proof": True,
        "codeOnTheWire": False,
    }
    assert status == 0
    assert [d.name for d in auth.list()] == ["Node interop"]


def test_extension_refuses_a_server_with_another_code(live: tuple[int, str], auth: Any) -> None:  # noqa: F811
    node = _node()
    if node is None:
        pytest.skip("needs Node 23.6+ (runs the extension's TypeScript directly)")
    port, code = live
    wrong = "000000" if code != "000000" else "111111"
    status, out = _run(node, port, wrong)
    assert status == 1
    assert out["round1"] is True and out["serverConfirmed"] is False and out["paired"] is False
    assert auth.list() == []
