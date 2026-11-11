"""Routine header: finds the profile, the installed plugin and the database from the shim.

Hermes' ``no_agent`` job runs ``<home>/scripts/<shim>.py`` with a sanitized environment (no
``PYTHONPATH``, the system ``TMPDIR``, sometimes with an ``--interpreter`` without Hermes on
``sys.path``). That is why:

- the profile comes from the **shim's own path** (``Path(script_file).resolve().parents[1]``),
  never from the environment — ``HERMES_HOME`` is only a cross-check (``check_env``); in the
  multiplexed gateway it points to the launch profile;
- plugin in ``<home>/plugins/<PLUGIN_ID>`` (symlink or copy; both measured);
- database in ``<home>/plugin-data/<PLUGIN_ID>/tube.db`` (the same file that the gateway and the
  plugin host open); this module creates and opens nothing;
- standard library only (runs even with ``env -i python -I``) and compatible with Python 3.9;
- failure = ``HeaderError`` (``SystemExit`` with a message, in English: the language cannot be
  read here yet without ``yaml``): exit ≠ 0, which the cron delivers as an alert.

Use from the shim, loading this file by path::

    h = runpy.run_path(str(home / "plugins" / "<id>" / "routines" / "_header.py"))
    home, plugin_dir, db_path = h["bootstrap"](__file__)   # + tube_pkg registered

Command line (diagnostics): ``python -I _header.py <shim>`` prints the resolved JSON.
"""

from __future__ import annotations

import importlib.util
import json
import os
import runpy
import sys
from pathlib import Path
from typing import NamedTuple

DB_FILE = "tube.db"
SCRIPTS_DIR = "scripts"
_PLUGIN_ID_CACHE: list[str] = []


class HeaderError(SystemExit):
    """Failed to locate the profile/plugin: message on stderr and exit 1 (becomes a cron alert)."""

    def __init__(self, message: str) -> None:
        super().__init__(f"[{_safe_plugin_id()}] routine: {message}")


class Resolved(NamedTuple):
    home: Path
    """Profile folder (the job's real ``HERMES_HOME``)."""
    plugin_dir: Path
    """``<home>/plugins/<PLUGIN_ID>`` (may be a symlink)."""
    db_path: Path
    """``<home>/plugin-data/<PLUGIN_ID>/tube.db`` (may not exist yet)."""


def plugin_id() -> str:
    """``PLUGIN_ID`` read from ``_id.py`` next to this folder (without importing ``tube_pkg``)."""
    if not _PLUGIN_ID_CACHE:
        id_file = Path(__file__).resolve().parents[1] / "_id.py"
        try:
            value = runpy.run_path(str(id_file)).get("PLUGIN_ID")
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(f"routine: could not read {id_file}: {exc}") from None
        if not isinstance(value, str) or not value:
            raise SystemExit(f"routine: PLUGIN_ID missing in {id_file}")
        _PLUGIN_ID_CACHE.append(value)
    return _PLUGIN_ID_CACHE[0]


def _safe_plugin_id() -> str:
    try:
        return plugin_id()
    except SystemExit:
        return "plugin"


def resolve(script_file: str | os.PathLike[str]) -> Resolved:
    """``(home, plugin_dir, db_path)`` from the shim path ``<home>/scripts/<x>.py``."""
    script = Path(script_file).resolve()
    if script.parent.name != SCRIPTS_DIR or len(script.parents) < 3:
        raise HeaderError(f"the shim must be in <profile>/{SCRIPTS_DIR}/ (it is in {script})")
    home = script.parents[1]
    pid = plugin_id()
    plugin_dir = home / "plugins" / pid
    if not (plugin_dir / "_bootstrap.py").is_file():
        raise HeaderError(
            f"plugin {pid} not installed in {plugin_dir}; reinstall the plugin"
            " or remove the routine"
        )
    return Resolved(home, plugin_dir, home / "plugin-data" / pid / DB_FILE)


def bootstrap(script_file: str | os.PathLike[str]) -> Resolved:
    """``resolve`` + registers the ``tube_pkg`` package from the installed plugin."""
    resolved = resolve(script_file)
    boot = resolved.plugin_dir / "_bootstrap.py"
    spec = importlib.util.spec_from_file_location("_tube_bootstrap_routine", boot)
    if spec is None or spec.loader is None:
        raise HeaderError(f"could not load {boot}")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        pkg = module.ensure()
    except Exception as exc:  # noqa: BLE001
        raise HeaderError(f"bootstrap of {boot} failed: {exc}") from None
    expected = resolved.plugin_dir.resolve()
    paths = [Path(p).resolve() for p in getattr(pkg, "__path__", [])]
    if paths and expected not in paths:
        raise HeaderError(f"tube_pkg already points to {paths[0]}, not to {expected}")
    return resolved


def check_env(resolved: Resolved) -> str | None:
    """Cross-check: environment ``HERMES_HOME`` differs from the shim profile → warning (text)."""
    raw = os.environ.get("HERMES_HOME", "").strip()
    if not raw:
        return None
    try:
        same = Path(raw).resolve() == resolved.home
    except OSError:
        same = False
    if same:
        return None
    return (
        f"environment HERMES_HOME ({raw}) differs from the shim profile ({resolved.home}); used the"
        " shim"
    )


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write("usage: python -I _header.py <shim path>\n")
        return 2
    r = resolve(argv[0])
    out = {"home": str(r.home), "plugin_dir": str(r.plugin_dir), "db_path": str(r.db_path)}
    warn = check_env(r)
    if warn:
        out["warning"] = warn
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
