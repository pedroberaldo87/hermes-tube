"""Where the plugin database lives: ``open_db() -> Db``.

Order of choice (the first one that exists wins):

1. explicit ``path``;
2. ``TUBE_DB_PATH`` — tests, ``scripts/dev`` and worktrees (never set in a real Hermes; winning
   over Hermes keeps a test with Hermes on ``sys.path`` from writing to the real profile);
3. Hermes: ``plugins.plugin_storage.plugin_db(PLUGIN_ID, "tube.db")`` →
   ``<hermes home>/plugin-data/<id>/tube.db``, which follows the active profile and survives
   ``hermes plugins update/remove``. Chosen over ``plugin_data_dir(...) / "tube.db"`` because it
   opens through ``hermes_cli.sqlite_util.open_db``: WAL with the Hermes policy (safety gate for
   the WAL-reset bug, fallback to ``DELETE`` on network file systems, fsync barriers on macOS),
   ``busy_timeout=5000``, ``foreign_keys`` and ``check_same_thread=False``. The connection is
   wrapped by ``core/db.from_connection``, which switches to autocommit, ensures
   ``busy_timeout`` ≥ 5 s and ``foreign_keys=ON`` and migrates the schema;
4. old Hermes without ``plugin_db``: ``plugin_data_dir(PLUGIN_ID) / "tube.db"`` opened by
   ``core/db.build`` (WAL forced);
5. none of these → a readable ``RuntimeError``.

Whatever the choice, ``tube.db`` and its ``-wal``/``-shm`` files are set to 0600 right after
opening (best effort: only files this user owns; SQLite gives new ``-wal``/``-shm`` files the mode
of the database file). Native Windows has no owner/mode bits to set (``chmod`` can only toggle
read-only): there the files keep the access list they inherit from their folder — under the user
folder (``%USERPROFILE%``, ``%LOCALAPPDATA%``, ``%APPDATA%``), only that user, SYSTEM and the
administrators can read them. A database outside those folders is logged once as a warning.

Late, tolerant Hermes import: this module imports without Hermes; no network and no threads.
"""

from __future__ import annotations

import importlib
import logging
import os
import stat
import sys
from pathlib import Path
from types import ModuleType

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import db as dbmod
from tube_pkg.core.types import Db

log = logging.getLogger(__name__)

DB_FILENAME = "tube.db"


def _hermes_storage() -> ModuleType | None:
    try:
        return importlib.import_module("plugins.plugin_storage")
    except ImportError:
        return None


def hermes_db_path() -> str | None:
    """Database path in the active Hermes profile, or ``None`` outside Hermes."""
    mod = _hermes_storage()
    if mod is None or not hasattr(mod, "plugin_data_dir"):
        return None
    try:
        return str(Path(mod.plugin_data_dir(PLUGIN_ID)) / DB_FILENAME)
    except ImportError:
        return None


_PRIVATE = 0o600
_SIDE_FILES = ("", "-wal", "-shm", "-journal")
_USER_FOLDERS = ("USERPROFILE", "LOCALAPPDATA", "APPDATA")
_WARNED: set[str] = set()


def _inside(path: str, folder: str) -> bool:
    try:
        target = os.path.normcase(os.path.abspath(path))
        base = os.path.normcase(os.path.abspath(folder))
        return os.path.commonpath([target, base]) == base
    except ValueError:  # other drive
        return False


def _windows_private(main: str) -> None:
    """Windows: nothing to chmod; say so when the folder's access list is not the user's own."""
    folders = [os.environ.get(name, "").strip() for name in _USER_FOLDERS]
    if any(f and _inside(main, f) for f in folders):
        return
    if main not in _WARNED:
        _WARNED.add(main)
        log.warning(
            "the plugin database %s is outside your user folder: who can read it depends on that"
            " folder's permissions",
            main,
        )


def _make_private(db: Db) -> Db:
    """chmod 0600 on the database and its side files (best effort, never raises)."""
    main = getattr(db, "path", None)
    if not isinstance(main, str) or not main or main == ":memory:":
        return db
    if sys.platform == "win32" or not hasattr(os, "getuid"):
        try:
            _windows_private(main)
        except Exception:  # noqa: BLE001 — best effort
            log.debug("could not check where the database lives", exc_info=True)
        return db
    uid = os.getuid()
    for suffix in _SIDE_FILES:
        target = f"{main}{suffix}"
        try:
            st = os.lstat(target)
            # a symlink is left alone (chmod would follow it; lchmod does not exist on Linux)
            if (
                stat.S_ISREG(st.st_mode)
                and st.st_uid == uid
                and stat.S_IMODE(st.st_mode) != _PRIVATE
            ):
                os.chmod(target, _PRIVATE)
        except FileNotFoundError:
            continue
        except OSError:
            log.debug("could not restrict the permissions of %s", target, exc_info=True)
    return db


def open_db(*, path: str | None = None) -> Db:
    """Open the plugin database (see the order in the module docstring)."""
    return _make_private(_open(path))


def _open(path: str | None) -> Db:
    if path is not None:
        return dbmod.build(path=path)
    if os.environ.get(dbmod.ENV_DB_PATH, "").strip():
        return dbmod.build()

    mod = _hermes_storage()
    if mod is not None:
        plugin_db = getattr(mod, "plugin_db", None)
        if plugin_db is not None:
            try:
                conn = plugin_db(PLUGIN_ID, DB_FILENAME)
            except ImportError:
                log.debug("plugin_db unavailable (incomplete Hermes)", exc_info=True)
            else:
                return dbmod.from_connection(conn)
        fallback = hermes_db_path()
        if fallback is not None:
            return dbmod.build(path=fallback)

    raise RuntimeError(
        f"could not find where to open the database: outside Hermes set {dbmod.ENV_DB_PATH} or pass"
        " path=..."
    )


__all__ = ["DB_FILENAME", "hermes_db_path", "open_db"]
