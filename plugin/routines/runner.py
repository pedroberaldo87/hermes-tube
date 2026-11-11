"""Running a routine inside the cron job (after ``_header.bootstrap``).

Contract with the Hermes cron: **stdout is the delivery** — empty = silence (not even the model is
called in the agent job); exit ≠ 0 = alert. That is why:

- everything that runs while the routine works has its stdout redirected to stderr (a library log
  never becomes a message); only the final text goes to stdout;
- missing database → silence, without creating the file (the plugin was never opened in this
  profile);
- database locked by another process (write transaction held beyond ``busy_timeout``) →
  silence + a warning on stderr, exit 0: the next run tries again and nothing is lost, because the
  "notified up to here" mark (``meta routine.<key>.mark``) is written **before** printing and
  only if the write succeeded;
- YouTube RSS down / no network → carries on with what is already in the database;
- any other failure → one line on stderr and exit 1 (the cron delivers it as an alert).

Paths come from the shim (``Resolved``); no ``os.environ`` to find the profile or database. No
model: routines have no ``ctx`` (they run outside the gateway), so they never call AI.
"""

from __future__ import annotations

import contextlib
import sqlite3
import sys
import time
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import lang as lang_rule
from tube_pkg.core import types as T
from tube_pkg.routines.catalog import mark_key

LOCK_PROBE_TIMEOUT_S = 3.0
"""Wait for the write lock before giving up on this run (macOS ``sqlite3`` sleeps in 1 s steps:
measured ~2× this value in total). A normal plugin transaction lasts milliseconds."""


@dataclass(frozen=True)
class Outcome:
    """Result of a routine: text to deliver (``None`` = silence) and marks to write."""

    text: str | None = None
    marks: Mapping[str, int] = field(default_factory=dict)


@dataclass
class RoutineEnv:
    """What a routine sees: database, settings and services of the shim profile."""

    key: str
    home: Path
    db: T.Db
    settings: T.Settings
    graph: Any
    now: int
    lang: str
    """Resolved language (``core/lang``: explicit setting; with ``auto``, the profile's Hermes
    language; else ``en``)."""
    notes: list[str] = field(default_factory=list)
    """Warnings for stderr (diagnostics; never delivered)."""

    def get(self, name: str) -> Any:
        return self.graph.get(name)

    def mark(self, key: str | None = None) -> int | None:
        row = self.db.query_one(
            "SELECT value FROM meta WHERE key = ?", (mark_key(key or self.key),)
        )
        try:
            return int(float(row["value"])) if row and row["value"] is not None else None
        except (TypeError, ValueError):
            return None

    def t(self, pt: str, en: str) -> str:
        return lang_rule.pick(self.lang, pt, en)


Composer = Callable[[RoutineEnv], Outcome]


def _err(text: str) -> None:
    sys.stderr.write(f"[{PLUGIN_ID}] {text}\n")
    sys.stderr.flush()


def is_lock_error(exc: BaseException) -> bool:
    if not isinstance(exc, sqlite3.OperationalError):
        return False
    msg = str(exc).lower()
    return "locked" in msg or "busy" in msg


def _write_lock_free(path: Path, timeout: float = LOCK_PROBE_TIMEOUT_S) -> bool:
    """Can the write lock be taken within *timeout*? (standard library; rolled back at once)."""
    conn = sqlite3.connect(str(path), timeout=timeout, isolation_level=None)
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("ROLLBACK")
        return True
    except sqlite3.OperationalError as exc:
        if is_lock_error(exc):
            return False
        raise
    finally:
        conn.close()


@contextlib.contextmanager
def _stdout_to_stderr() -> Iterator[None]:
    with contextlib.redirect_stdout(sys.stderr):
        yield


def _open_env(key: str, home: Path, db_path: Path) -> RoutineEnv:
    from tube_pkg import wiring
    from tube_pkg.adapters.settings import build as build_settings
    from tube_pkg.adapters.storage import open_db

    db = open_db(path=str(db_path))
    try:
        settings = build_settings(home=home)
        graph = wiring.Graph(db=db, settings=settings, ctx=None)
        return RoutineEnv(
            key=key,
            home=home,
            db=db,
            settings=settings,
            graph=graph,
            now=int(time.time()),
            lang=lang_rule.resolve(settings, home=home),
        )
    except BaseException:
        db.close()
        raise


def _alert_lang(home: Path) -> str:
    """Language of the cron alert (exit ≠ 0 becomes a message): same rule, DB left closed."""
    try:
        from tube_pkg.adapters.settings import build as build_settings

        return lang_rule.resolve(build_settings(home=home), home=home)
    except Exception:  # noqa: BLE001 — the alert goes out even without readable settings
        return lang_rule.DEFAULT


def save_marks(db: T.Db, marks: Mapping[str, int]) -> None:
    if not marks:
        return
    with db.transaction():
        for key, value in marks.items():
            db.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (mark_key(key), str(int(value))),
            )


def run(key: str, resolved: Any, *, warn: str | None = None) -> int:
    """Run routine *key* for the profile of *resolved* (``_header.Resolved``). Returns exit code."""
    from tube_pkg.routines.compose import COMPOSERS

    composer = COMPOSERS[key]
    home = Path(resolved.home)
    db_path = Path(resolved.db_path)
    lang = _alert_lang(home)
    if warn:
        _err(f"routine {key}: {warn}")
    if not db_path.is_file():
        _err(f"routine {key}: database does not exist yet ({db_path}); nothing to report")
        return 0
    text: str | None = None
    try:
        with _stdout_to_stderr():
            if not _write_lock_free(db_path):
                _err(f"routine {key}: database busy (locked by another process); retrying next run")
                return 0
            env = _open_env(key, home, db_path)
            try:
                outcome = composer(env)
                for note in env.notes:
                    _err(f"routine {key}: {note}")
                if outcome.text:
                    save_marks(env.db, outcome.marks)
                    text = outcome.text.strip()
            finally:
                env.db.close()
    except Exception as exc:  # noqa: BLE001 — becomes a readable cron alert
        if is_lock_error(exc):
            _err(f"routine {key}: database busy ({exc}); will retry next run")
            return 0
        detail = f"{type(exc).__name__}: {' '.join(str(exc).split())[:300]}"
        _err(
            lang_rule.pick(
                lang, f"rotina {key} falhou: {detail}", f"routine {key} failed: {detail}"
            )
        )
        return 1
    if text:
        sys.stdout.write(text + "\n")
        sys.stdout.flush()
    return 0


__all__ = ["Composer", "Outcome", "RoutineEnv", "is_lock_error", "run", "save_marks"]
