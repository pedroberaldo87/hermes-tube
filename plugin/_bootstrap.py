"""Fixed import alias: registers ``tube_pkg`` as a synthetic package pointing at ``plugin/``.

Callers: ``plugin/__init__.py``, ``dashboard/plugin_api.py`` (loaded by path, no package),
``tests/conftest.py`` and the routine scripts. After ``ensure()``, everything imports through
``tube_pkg.<subpackage>.<module>``.

Rules:

- the package is an empty shell (``ModuleSpec(name, None, is_package=True)``), like Hermes'
  ``register_synthetic_package``: ``plugin/__init__.py`` is **never** executed here;
- idempotent through its presence in ``sys.modules``: two copies of this file loaded by path
  return the same object and never replace it;
- standard library only; no network and no threads.

Reload. Hermes keeps the process hosting the plugin alive across ``disable``/``enable``, profile
restarts and ``hermes plugins update``: it only forgets ``hermes_plugins.<id>`` and loads
``plugin_api.py`` **once** per process. Since ``tube_pkg`` is our own alias, it would keep the old
code forever. That is why ``refresh()`` compares the fingerprint of the ``.py`` files in
``plugin/`` with the one of the package in use and, if it changed, retires the old generation
(``wiring.shutdown(all_profiles=True)``: extension server and databases closed), removes
``tube_pkg*`` from ``sys.modules`` and registers a new package; each profile's Hermes ``ctx``
survives the swap. Callers: ``plugin/__init__.py`` when executed and on every
tool/hook/command/RPC; ``plugin_api.py`` on every REST request (the check is limited to one every
``CHECK_EVERY_S``). ``TUBE_NO_RELOAD=1`` turns it off (the tests set it).
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import logging
import os
import sys
import threading
import time
from pathlib import Path
from types import ModuleType

PACKAGE_NAME = "tube_pkg"
PLUGIN_DIR = Path(__file__).resolve().parent

ENV_NO_RELOAD = "TUBE_NO_RELOAD"
CHECK_EVERY_S = 2.0
"""Minimum interval between two checks of the code fingerprint (per process)."""

_STATE_NAME = "_tube_pkg_state"
_SKIP_DIRS = frozenset({"__pycache__", "desktop", "data", "skills", "node_modules"})

logger = logging.getLogger(PACKAGE_NAME)

_LOCK = threading.Lock()


def _shared_lock() -> threading.RLock:
    """Single process lock, shared by every copy of this file loaded by path."""
    state = sys.modules.get(_STATE_NAME)
    if state is None:
        fresh = ModuleType(_STATE_NAME)
        fresh.lock = threading.RLock()  # type: ignore[attr-defined]
        state = sys.modules.setdefault(_STATE_NAME, fresh)
    return state.lock  # type: ignore[attr-defined,no-any-return]


def fingerprint() -> tuple[int, int, int]:
    """Fingerprint of the code on disk: (number of ``.py``, newest ``mtime_ns``, total size).

    Changes on any edit, ``git pull`` or folder swap; does not read contents (~1 ms).
    """
    count = newest = size = 0
    for root, dirs, files in os.walk(PLUGIN_DIR):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for name in files:
            if not name.endswith(".py"):
                continue
            try:
                st = os.stat(os.path.join(root, name))
            except OSError:
                continue
            count += 1
            size += st.st_size
            newest = max(newest, st.st_mtime_ns)
    return (count, newest, size)


def owner_check_available() -> bool:
    """POSIX: file owner and mode bits are there to check. Native Windows has neither through the
    standard library (``st_uid`` is 0 and the mode only says read-only; who may write is in the
    file's ACL), so the check below cannot run there."""
    return sys.platform != "win32" and hasattr(os, "getuid")


def unsafe_sources() -> list[str]:
    """Plugin ``.py`` files and folders that a hot reload must not trust: not owned by this user, or
    writable by group/others (someone else could put code in the gateway).

    Where the owner cannot be checked (native Windows) the rule is not relaxed: the whole plugin
    folder counts as untrusted, so a hot reload never happens there and new code loads the normal
    way, when Hermes restarts."""
    if not owner_check_available():
        return [str(PLUGIN_DIR)]
    uid = os.getuid()
    bad: list[str] = []

    def check(path: str) -> None:
        try:
            st = os.stat(path)
        except OSError:
            return
        if st.st_uid != uid or st.st_mode & 0o022:
            bad.append(path)

    for root, dirs, files in os.walk(PLUGIN_DIR):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        check(root)
        for name in files:
            if name.endswith(".py"):
                check(os.path.join(root, name))
    return bad


def refusal_reason(unsafe: list[str]) -> str:
    """Log line for a refused hot reload."""
    if not owner_check_available():
        return (
            f"reload refused: this system cannot check who owns the plugin files in {PLUGIN_DIR};"
            " restart Hermes to load the new code"
        )
    return (
        f"reload refused: {len(unsafe)} plugin file(s)/folder(s) in {PLUGIN_DIR} are not yours or"
        f" are writable by group/others: {', '.join(unsafe[:5])}"
    )


def ensure() -> ModuleType:
    """Register (once) and return the synthetic ``tube_pkg`` package.

    If ``tube_pkg`` already exists in ``sys.modules`` (registered by this or another copy of
    ``_bootstrap``), return the existing object without changing it.
    """
    existing = sys.modules.get(PACKAGE_NAME)
    if existing is not None:
        return existing
    with _LOCK:
        existing = sys.modules.get(PACKAGE_NAME)
        if existing is not None:
            return existing
        spec = importlib.machinery.ModuleSpec(PACKAGE_NAME, None, is_package=True)
        spec.submodule_search_locations = [str(PLUGIN_DIR)]
        module = importlib.util.module_from_spec(spec)
        module.__file__ = None  # like a namespace package: there is no source file
        module.__tube_fp__ = fingerprint()  # type: ignore[attr-defined]
        module.__tube_checked__ = time.monotonic()  # type: ignore[attr-defined]
        module.__tube_ctx__ = {}  # type: ignore[attr-defined]
        # setdefault: if another copy (with another lock) registered meanwhile, its one wins
        return sys.modules.setdefault(PACKAGE_NAME, module)


def _retire(pkg: ModuleType) -> dict[str, object]:
    """Retire the generation in use: stop what it started and remove it from ``sys.modules``.
    Return the Hermes ``ctx`` per profile (Hermes objects, not ours) for the next generation."""
    carried: dict[str, object] = dict(getattr(pkg, "__tube_ctx__", None) or {})
    wiring = sys.modules.get(PACKAGE_NAME + ".wiring")
    if wiring is not None:
        try:
            carried.update(dict(getattr(wiring, "_CTX", None) or {}))
        except Exception:  # noqa: BLE001
            logger.exception("reload: could not read the old generation's ctx")
        try:
            wiring.shutdown(all_profiles=True)
        except Exception:  # noqa: BLE001 — a broken old generation does not block the new one
            logger.exception("reload: shutdown of the old generation failed")
    prefix = PACKAGE_NAME + "."
    for name in [m for m in list(sys.modules) if m == PACKAGE_NAME or m.startswith(prefix)]:
        sys.modules.pop(name, None)
    return carried


def refresh(*, force: bool = False) -> bool:
    """Make sure the ``tube_pkg`` in use is the code on disk. Return ``True`` if it was swapped.

    Cheap when nothing changed (at most one check every ``CHECK_EVERY_S``; *force* checks right
    away). Never raises.
    """
    try:
        pkg = sys.modules.get(PACKAGE_NAME)
        if pkg is None:
            ensure()
            return False
        if os.environ.get(ENV_NO_RELOAD, "").strip():
            return False
        last = getattr(pkg, "__tube_checked__", None)
        if not force and last is not None and time.monotonic() - last < CHECK_EVERY_S:
            return False
        with _shared_lock():
            pkg = sys.modules.get(PACKAGE_NAME)
            if pkg is None:
                ensure()
                return False
            current = fingerprint()
            pkg.__tube_checked__ = time.monotonic()  # type: ignore[attr-defined]
            if getattr(pkg, "__tube_fp__", None) == current:
                return False
            unsafe = unsafe_sources()
            if unsafe:
                # keep the code in memory; warn once per change, check again on the next call (a
                # fixed permission does not change the fingerprint)
                if getattr(pkg, "__tube_refused__", None) != current:
                    pkg.__tube_refused__ = current  # type: ignore[attr-defined]
                    logger.warning("%s", refusal_reason(unsafe))
                return False
            carried = _retire(pkg)
            fresh = ensure()
            fresh.__tube_ctx__ = carried  # type: ignore[attr-defined]
            logger.info("reload: code in %s changed; tube_pkg reloaded", PLUGIN_DIR)
            return True
    except Exception:  # noqa: BLE001
        logger.exception("reload: check failed; keeping the code in memory")
        return False


__all__ = [
    "CHECK_EVERY_S",
    "ENV_NO_RELOAD",
    "PACKAGE_NAME",
    "PLUGIN_DIR",
    "ensure",
    "fingerprint",
    "owner_check_available",
    "refusal_reason",
    "unsafe_sources",
    "refresh",
]
