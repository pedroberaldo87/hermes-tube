"""Code reload inside the same process.

Hermes keeps the process that hosts the plugin alive: it loads ``dashboard/plugin_api.py`` once and,
when reloading the plugin, only forgets ``hermes_plugins.<id>``. These tests copy ``plugin/`` to a
temporary folder and, **in a separate process** (without ``TUBE_NO_RELOAD``), load the code the way
Hermes does, change a file and check that the next request already runs the new code.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

PRELUDE = r"""
import importlib, importlib.util, json, os, sys
from pathlib import Path

PLUGIN = Path(sys.argv[1])

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=None)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

def patch_status(marker):
    # "update": the /status handler now returns a recognizable number
    path = PLUGIN / "api" / "status.py"
    text = path.read_text(encoding="utf-8").split("# --- reload test ---")[0]
    text += (
        "# --- reload test ---\n_orig_get_status = get_status\n\n\n"
        "def get_status(body, query):\n    env = _orig_get_status(body, query)\n"
        f"    env['data']['new_total'] = {marker}\n    return env\n"
    )
    path.write_text(text, encoding="utf-8")

def client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    api = load("hermes_dashboard_plugin_x", PLUGIN / "dashboard" / "plugin_api.py")  # only once
    app = FastAPI()
    app.include_router(api.router)
    return api, TestClient(app)

def status(c):
    body = c.get("/status").json()
    assert body["ok"], body
    return body["data"]["new_total"]

out = {}
"""


def _run(tmp_path: Path, body: str, **env: str) -> dict:
    plugin = tmp_path / "plugin"
    shutil.copytree(
        ROOT / "plugin", plugin, ignore=shutil.ignore_patterns("__pycache__", "desktop", "*.pyc")
    )
    script = tmp_path / "scenario.py"
    script.write_text(PRELUDE + textwrap.dedent(body) + "\nprint(json.dumps(out))\n", "utf-8")
    full_env = {k: v for k, v in os.environ.items() if k != "TUBE_NO_RELOAD"}
    full_env.update({"TUBE_DB_PATH": str(tmp_path / "data" / "tube.db"), **env})
    proc = subprocess.run(
        [sys.executable, str(script), str(plugin)],
        capture_output=True,
        text=True,
        timeout=120,
        env=full_env,
        cwd=str(tmp_path),
    )
    assert proc.returncode == 0, proc.stderr[-3000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_env_var_name_matches_wiring() -> None:
    from tube_pkg import wiring

    assert wiring.ENV_DB_PATH == "TUBE_DB_PATH"


def test_rest_serves_new_code_after_files_change(tmp_path: Path) -> None:
    out = _run(
        tmp_path,
        """
        api, c = client()
        api._boot.CHECK_EVERY_S = 0.0
        out["before"] = status(c)
        gen1 = sys.modules["tube_pkg"]
        w1 = sys.modules["tube_pkg.wiring"]
        w1.bind_ctx("ctx-do-hermes")
        key = w1.home_key()
        db1 = w1.get_db()
        patch_status(4242)
        out["after"] = status(c)
        w2 = sys.modules["tube_pkg.wiring"]
        out["new_generation"] = sys.modules["tube_pkg"] is not gen1 and w2 is not w1
        out["ctx_carried"] = w2._CTX.get(key) == "ctx-do-hermes"
        out["old_state_cleared"] = not w1._DBS and not w1._GRAPHS and not w1._CTX
        try:
            db1.read("SELECT 1")
            out["old_db_closed"] = False
        except Exception:
            out["old_db_closed"] = True
        patch_status(77)
        out["again"] = status(c)
        """,
    )
    assert out["before"] != 4242
    assert out["after"] == 4242 and out["again"] == 77
    assert out["new_generation"] and out["ctx_carried"]
    assert out["old_state_cleared"] and out["old_db_closed"]


def test_unchanged_code_keeps_the_generation(tmp_path: Path) -> None:
    out = _run(
        tmp_path,
        """
        api, c = client()
        api._boot.CHECK_EVERY_S = 0.0
        status(c)
        gen1, w1 = sys.modules["tube_pkg"], sys.modules["tube_pkg.wiring"]
        for _ in range(5):
            status(c)
        out["same"] = sys.modules["tube_pkg"] is gen1 and sys.modules["tube_pkg.wiring"] is w1
        """,
    )
    assert out["same"]


def test_check_is_throttled_and_can_be_disabled(tmp_path: Path) -> None:
    out = _run(
        tmp_path,
        """
        api, c = client()
        status(c)
        patch_status(4242)
        out["throttled"] = status(c)          # inside the window: still the old code
        out["forced"] = api._boot.refresh(force=True)
        out["after_force"] = status(c)
        os.environ["TUBE_NO_RELOAD"] = "1"
        patch_status(77)
        out["disabled"] = api._boot.refresh(force=True)
        out["after_disabled"] = status(c)
        """,
    )
    assert out["throttled"] != 4242
    assert out["forced"] is True and out["after_force"] == 4242
    assert out["disabled"] is False and out["after_disabled"] == 4242


def test_hermes_reexecuting_the_plugin_swaps_generation_for_old_closures(tmp_path: Path) -> None:
    """The gateway re-runs ``__init__.py`` when reloading the plugin; closures registered earlier
    (RPC, tools) and the ``plugin_api`` loaded earlier start using the new code."""
    out = _run(
        tmp_path,
        """
        api, c = client()                       # REST loaded first, never reloaded
        init1 = load("hermes_plugins.x", PLUGIN / "__init__.py")
        out["shared"] = init1._module("tube_pkg.wiring") is sys.modules["tube_pkg.wiring"]
        status(c)
        patch_status(4242)
        sys.modules.pop("hermes_plugins.x")     # what Hermes does on unload
        init2 = load("hermes_plugins.x", PLUGIN / "__init__.py")
        out["rest_after"] = status(c)           # no window wait: __init__ already swapped
        fn = init1._module("tube_pkg.api.status").get_status
        out["old_closure_sees_new"] = fn.__module__ == "tube_pkg.api.status" and (
            fn is sys.modules["tube_pkg.api.status"].get_status
        )
        out["one_wiring"] = init2._module("tube_pkg.wiring") is sys.modules["tube_pkg.wiring"]
        """,
    )
    assert out["shared"] and out["one_wiring"] and out["old_closure_sees_new"]
    assert out["rest_after"] == 4242


def test_generation_from_an_old_bootstrap_is_replaced(tmp_path: Path) -> None:
    """A process that already had ``tube_pkg`` from a version without reload (no fingerprint)."""
    out = _run(
        tmp_path,
        """
        import types
        legacy = types.ModuleType("tube_pkg")
        legacy.__path__ = [str(PLUGIN)]
        sys.modules["tube_pkg"] = legacy
        import tube_pkg.wiring as w1
        boot = load("_b", PLUGIN / "_bootstrap.py")
        out["replaced"] = boot.refresh(force=True)
        import tube_pkg.wiring as w2
        out["fresh"] = w2 is not w1 and hasattr(sys.modules["tube_pkg"], "__tube_fp__")
        out["stable"] = boot.refresh(force=True) is False
        """,
    )
    assert out["replaced"] and out["fresh"] and out["stable"]


@pytest.mark.parametrize("broken", ["shutdown", "fingerprint"])
def test_refresh_never_raises(tmp_path: Path, broken: str) -> None:
    out = _run(
        tmp_path,
        f"""
        api, c = client()
        api._boot.CHECK_EVERY_S = 0.0
        status(c)
        w1 = sys.modules["tube_pkg.wiring"]
        def boom(*a, **k):
            raise RuntimeError("broken")
        if {broken!r} == "shutdown":
            w1.shutdown = boom
            patch_status(4242)
            out["value"] = status(c)            # a broken old generation does not block the new one
        else:
            api._boot.fingerprint = boom
            patch_status(4242)
            out["value"] = status(c)            # no check: keep going with what is in memory
        """,
    )
    assert out["value"] == (4242 if broken == "shutdown" else out["value"])
    if broken == "fingerprint":
        assert out["value"] != 4242


@pytest.mark.skipif(os.name != "posix", reason="POSIX permissions")
def test_reload_refuses_code_writable_by_group_or_others(tmp_path: Path) -> None:
    """A ``.py`` (or a folder) of the plugin that group/others can write is not hot-loaded: the
    code in memory stays, one warning per change; fixing the permission lets the reload happen."""
    out = _run(
        tmp_path,
        """
        import logging, stat
        records = []
        class Grab(logging.Handler):
            def emit(self, r):
                records.append(r)
        logging.getLogger("tube_pkg").addHandler(Grab())
        api, c = client()
        before = status(c)
        target = PLUGIN / "api" / "status.py"
        patch_status(4242)
        os.chmod(target, 0o666)
        out["refused"] = api._boot.refresh(force=True)
        api._boot.refresh(force=True)
        out["value_refused"] = status(c) != 4242
        warn = [r.getMessage() for r in records if r.levelno >= logging.WARNING]
        out["warned_once"] = len([m for m in warn if "reload refused" in m]) == 1
        out["names_file"] = any("status.py" in m for m in warn)
        os.chmod(target, 0o644)
        os.chmod(PLUGIN / "core", 0o777)
        patch_status(77)
        out["dir_refused"] = api._boot.refresh(force=True) is False
        os.chmod(PLUGIN / "core", 0o755)
        out["fixed"] = api._boot.refresh(force=True)
        out["value_fixed"] = status(c)
        """,
    )
    assert out["refused"] is False and out["value_refused"]
    assert out["warned_once"] and out["names_file"]
    assert out["dir_refused"]
    assert out["fixed"] is True and out["value_fixed"] == 77
