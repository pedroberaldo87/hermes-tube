"""``MemDb``: ``Db`` over in-memory ``sqlite3`` with ``contract/schema.sql`` applied.

- one connection (``check_same_thread=False``) guarded by an ``RLock``: thread-safe;
- outside ``transaction()`` every statement is autocommit;
- ``transaction()`` holds the lock for the whole block (another thread waits, never sees nor
  inherits uncommitted writes) and is reentrant on the same thread (``SAVEPOINT``);
- ``foreign_keys=ON``; violations raise ``sqlite3.IntegrityError`` unwrapped.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from tube_pkg.core.types import ExecResult, Params, Row

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "contract" / "schema.sql"


def _dict_row(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> dict[str, Any]:
    return {col[0]: row[i] for i, col in enumerate(cursor.description)}


class MemDb:
    """In-memory ``Db`` fake (deterministic, no file)."""

    def __init__(self, *, schema_path: str | Path | None = None) -> None:
        self._lock = threading.RLock()
        self._local = threading.local()
        self._closed = False
        self._conn = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
        self._conn.row_factory = _dict_row
        self._conn.execute("PRAGMA foreign_keys = ON")
        schema = Path(schema_path or SCHEMA_PATH).read_text(encoding="utf-8")
        self._conn.executescript(schema)

    # ------------------------------------------------------------------ Db

    @property
    def path(self) -> str:
        return ":memory:"

    def query(self, sql: str, params: Params = ()) -> list[Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: Params = ()) -> Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def execute(self, sql: str, params: Params = ()) -> ExecResult:
        with self._lock:
            cur = self._conn.execute(sql, params)
            return ExecResult(rowcount=cur.rowcount, lastrowid=cur.lastrowid)

    def executemany(self, sql: str, seq: Sequence[Params]) -> int:
        rows = list(seq)
        if not rows:
            return 0
        with self._lock:
            cur = self._conn.executemany(sql, rows)
            return max(cur.rowcount, 0)

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self._lock:
            depth = getattr(self._local, "depth", 0)
            name = f"sp_{depth}"
            if depth == 0:
                self._conn.execute("BEGIN IMMEDIATE")
            else:
                self._conn.execute(f"SAVEPOINT {name}")
            self._local.depth = depth + 1
            try:
                yield None
            except BaseException:
                if depth == 0:
                    self._conn.execute("ROLLBACK")
                else:
                    self._conn.execute(f"ROLLBACK TO {name}")
                    self._conn.execute(f"RELEASE {name}")
                raise
            else:
                if depth == 0:
                    self._conn.execute("COMMIT")
                else:
                    self._conn.execute(f"RELEASE {name}")
            finally:
                self._local.depth = depth

    def close(self) -> None:
        with self._lock:
            if not self._closed:
                self._closed = True
                self._conn.close()

    # ------------------------------------------------------------------ test extras

    def tables(self) -> list[str]:
        """Schema tables (without SQLite's internal ones)."""
        rows = self.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        return [r["name"] for r in rows if not r["name"].startswith("sqlite_")]

    def dump(self, table: str) -> list[Row]:
        """All rows of *table* in a stable order (to compare states)."""
        return self.query(f"SELECT * FROM {table} ORDER BY 1")


__all__ = ["MemDb", "SCHEMA_PATH"]
