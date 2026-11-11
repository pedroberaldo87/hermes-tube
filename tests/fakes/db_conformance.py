"""``Db`` conformance suite (contract in ``tube_pkg.core.types.Db``).

Reusable: ``MemDb``, ``core/db.py`` and the integration gate run **the same** suite.

Usage with pytest (subclass it and provide the ``make_db`` fixture, a no-argument factory)::

    from fakes.db_conformance import DbConformance

    class TestCoreDb(DbConformance):
        shared_path = True  # two instances on the same path see the same data

        @pytest.fixture
        def make_db(self, tmp_path):
            from tube_pkg.core import db as core_db
            path = str(tmp_path / "t.db")
            made = []
            def factory():
                made.append(core_db.build(path=path))
                return made[-1]
            yield factory
            for d in made:
                d.close()

Without pytest (e.g. from a script): ``run_conformance(factory)`` runs every ``check_*`` and returns
``{name: None | error message}``.

Assumptions the suite pins down:

- the ``Db`` starts with ``contract/schema.sql`` applied and ``foreign_keys=ON``;
- a CHECK/FK/UNIQUE violation raises ``sqlite3.IntegrityError`` (unwrapped);
- outside ``transaction()`` every ``execute`` is autocommit;
- ``transaction()`` is reentrant on the same thread (``SAVEPOINT``) and another thread never sees
  nor inherits uncommitted writes.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from collections.abc import Callable
from typing import Any

import pytest

from tube_pkg.core import types as T

DbFactory = Callable[[], Any]

EXPECTED_TABLES = frozenset(
    {
        "meta",
        "channels",
        "folders",
        "tags",
        "channel_tags",
        "videos",
        "video_state",
        "watermarks",
        "tabs",
        "themes",
        "theme_items",
        "suggestions",
        "cleanup_candidates",
        "unsub_queue",
        "jobs",
        "search_jobs",
        "watch_history",
        "changes",
        "devices",
        "pair_codes",
        "hn_videos",
        "list_imports",
    }
)

UC_A = "UCconformance0000000000a"
UC_B = "UCconformance0000000000b"


def _tag(db: Any, tag_id: str, name: str = "t") -> None:
    db.execute("INSERT INTO tags (id, name, created_at) VALUES (?, ?, 1)", (tag_id, name))


def _count(db: Any, table: str, where: str = "1=1", params: Any = ()) -> int:
    row = db.query_one(f"SELECT COUNT(*) AS n FROM {table} WHERE {where}", params)
    assert row is not None
    return int(row["n"])


# --------------------------------------------------------------------------- checks


def check_satisfies_protocol(make_db: DbFactory) -> None:
    db = make_db()
    assert isinstance(db, T.Db)
    assert isinstance(db.path, str) and db.path


def check_schema_applied(make_db: DbFactory) -> None:
    db = make_db()
    rows = db.query("SELECT name FROM sqlite_master WHERE type = 'table'")
    names = {r["name"] for r in rows if not r["name"].startswith("sqlite_")}
    assert EXPECTED_TABLES <= names, sorted(EXPECTED_TABLES - names)
    version = db.query_one("SELECT value FROM meta WHERE key = ?", (T.META_SCHEMA_VERSION,))
    assert version is not None and int(version["value"]) >= T.SCHEMA_VERSION


def check_foreign_keys_on(make_db: DbFactory) -> None:
    db = make_db()
    db.execute(
        "INSERT INTO channels (id, title, relation, source, added_at)"
        " VALUES (?, 'a', 'subscribed', 'extension', 1)",
        (UC_A,),
    )
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO channel_tags (channel_id, tag_id) VALUES (?, 'nope')", (UC_A,))
    _tag(db, "t1")
    db.execute("INSERT INTO channel_tags (channel_id, tag_id) VALUES (?, 't1')", (UC_A,))
    db.execute("DELETE FROM tags WHERE id = 't1'")
    assert _count(db, "channel_tags") == 0, "ON DELETE CASCADE exige foreign_keys=ON"


def check_checks_enforced(make_db: DbFactory) -> None:
    db = make_db()
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO channels (id, title, relation, source, added_at)"
            " VALUES (?, 'a', 'fan', 'extension', 1)",
            (UC_A,),
        )
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO unsub_queue (id, channel_id, approved_at, approved_via, created_at,"
            " updated_at) VALUES ('q', ?, 1, 'rest', 1, 1)",
            (UC_A,),
        )


def check_query_returns_dicts(make_db: DbFactory) -> None:
    db = make_db()
    assert db.query("SELECT id FROM tags") == []
    _tag(db, "t1", "Um")
    rows = db.query("SELECT id, name, created_at, color FROM tags")
    assert rows == [{"id": "t1", "name": "Um", "created_at": 1, "color": None}]
    assert isinstance(rows, list) and isinstance(rows[0], dict)
    row = db.query("SELECT 1.5 AS f, 2 AS i, 'x' AS s, NULL AS n")[0]
    assert row == {"f": 1.5, "i": 2, "s": "x", "n": None}
    assert type(row["i"]) is int


def check_query_one(make_db: DbFactory) -> None:
    db = make_db()
    assert db.query_one("SELECT id FROM tags WHERE id = ?", ("x",)) is None
    _tag(db, "t1")
    _tag(db, "t2")
    first = db.query_one("SELECT id FROM tags ORDER BY id")
    assert first == {"id": "t1"}


def check_params_sequence_and_mapping(make_db: DbFactory) -> None:
    db = make_db()
    db.execute("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)", ["a", "A", 1])
    db.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (:id, :name, :ts)",
        {"id": "b", "name": "B", "ts": 2},
    )
    got = db.query("SELECT id FROM tags WHERE created_at >= :min ORDER BY id", {"min": 1})
    assert [r["id"] for r in got] == ["a", "b"]


def check_execute_result(make_db: DbFactory) -> None:
    db = make_db()
    res = db.execute(
        "INSERT INTO changes (ts, actor, action, payload, undo) VALUES (1, 'user', 'x', '{}', '{}')"
    )
    assert isinstance(res, T.ExecResult)
    assert res.rowcount == 1
    assert isinstance(res.lastrowid, int) and res.lastrowid >= 1
    res2 = db.execute(
        "INSERT INTO changes (ts, actor, action, payload, undo) VALUES (2, 'user', 'x', '{}', '{}')"
    )
    assert res2.lastrowid is not None and res2.lastrowid > res.lastrowid
    _tag(db, "t1")
    _tag(db, "t2")
    upd = db.execute("UPDATE tags SET color = 'red'")
    assert upd.rowcount == 2
    none = db.execute("UPDATE tags SET color = 'blue' WHERE id = 'zzz'")
    assert none.rowcount == 0


def check_executemany(make_db: DbFactory) -> None:
    db = make_db()
    n = db.executemany(
        "INSERT INTO tags (id, name, created_at) VALUES (?, ?, 1)",
        [("a", "A"), ("b", "B"), ("c", "C")],
    )
    assert n == 3
    assert _count(db, "tags") == 3
    assert db.executemany("DELETE FROM tags WHERE id = ?", [("a",), ("zz",)]) == 1
    assert db.executemany("INSERT INTO tags (id, name, created_at) VALUES (?, ?, 1)", []) == 0


def check_autocommit_outside_transaction(make_db: DbFactory) -> None:
    db = make_db()
    _tag(db, "t1")
    seen: list[int] = []

    def reader() -> None:
        seen.append(_count(db, "tags"))

    th = threading.Thread(target=reader)
    th.start()
    th.join(10)
    assert seen == [1], "escrita fora de transaction() precisa estar confirmada"


def check_transaction_commit_and_rollback(make_db: DbFactory) -> None:
    db = make_db()
    with db.transaction():
        _tag(db, "a")
        assert _count(db, "tags") == 1, "the owning thread sees its own transaction"
    assert _count(db, "tags") == 1

    class Boom(Exception):
        pass

    with pytest.raises(Boom):
        with db.transaction():
            _tag(db, "b")
            raise Boom
    assert [r["id"] for r in db.query("SELECT id FROM tags")] == ["a"]
    # IntegrityError inside the transaction: rollback and re-raise
    with pytest.raises(sqlite3.IntegrityError):
        with db.transaction():
            _tag(db, "c")
            _tag(db, "c")
    assert _count(db, "tags") == 1


def check_transaction_reentrant_savepoint(make_db: DbFactory) -> None:
    db = make_db()

    class Inner(Exception):
        pass

    with db.transaction():
        _tag(db, "outer")
        try:
            with db.transaction():
                _tag(db, "inner")
                raise Inner
        except Inner:
            pass
        with db.transaction():
            _tag(db, "inner2")
    ids = sorted(r["id"] for r in db.query("SELECT id FROM tags"))
    assert ids == ["inner2", "outer"]

    class Outer(Exception):
        pass

    with pytest.raises(Outer):
        with db.transaction():
            _tag(db, "x")
            with db.transaction():
                _tag(db, "y")
            raise Outer
    ids = sorted(r["id"] for r in db.query("SELECT id FROM tags"))
    assert ids == ["inner2", "outer"], "outer rollback undoes the already released savepoint"


def check_transaction_is_context_manager_returning_none(make_db: DbFactory) -> None:
    db = make_db()
    with db.transaction() as value:
        assert value is None


def check_other_thread_never_inherits_uncommitted(make_db: DbFactory) -> None:
    """Another thread writes during an open transaction: its write survives the other
    transaction's rollback, and it never reads uncommitted data."""
    db = make_db()
    started = threading.Event()
    observed: list[int] = []
    errors: list[BaseException] = []

    def other() -> None:
        try:
            started.wait(10)
            observed.append(_count(db, "tags", "id = 'mine'"))
            db.execute(
                "INSERT INTO changes (ts, actor, action, payload, undo)"
                " VALUES (9, 'user', 'other', '{}', '{}')"
            )
        except BaseException as exc:  # noqa: BLE001 - reported below
            errors.append(exc)

    class Abort(Exception):
        pass

    th = threading.Thread(target=other)
    th.start()
    with pytest.raises(Abort):
        with db.transaction():
            _tag(db, "mine")
            started.set()
            time.sleep(0.3)
            raise Abort
    th.join(15)
    assert not th.is_alive(), "the other thread got stuck"
    assert not errors, errors
    assert observed == [0], "the other thread read an uncommitted write"
    assert _count(db, "tags") == 0
    assert _count(db, "changes", "action = 'other'") == 1, "the other thread's write was lost"


def check_concurrent_writers(make_db: DbFactory) -> None:
    db = make_db()
    errors: list[BaseException] = []

    def writer(k: int) -> None:
        try:
            for i in range(25):
                if i % 5 == 0:
                    with db.transaction():
                        _tag(db, f"w{k}-{i}")
                else:
                    _tag(db, f"w{k}-{i}")
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(k,)) for k in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(30)
    assert not errors, errors
    assert _count(db, "tags") == 8 * 25


def check_json_columns_are_text(make_db: DbFactory) -> None:
    db = make_db()
    db.execute(
        "INSERT INTO changes (ts, actor, action, payload, undo)"
        " VALUES (1, 'user', 'x', '{\"a\": 1}', '{}')"
    )
    row = db.query_one("SELECT payload, json_extract(payload, '$.a') AS a FROM changes")
    assert row is not None
    assert row["payload"] == '{"a": 1}' and row["a"] == 1


def check_close_is_idempotent(make_db: DbFactory) -> None:
    db = make_db()
    db.close()
    db.close()


CHECKS: tuple[tuple[str, Callable[[DbFactory], None]], ...] = tuple(
    (name, fn) for name, fn in sorted(globals().items()) if name.startswith("check_")
)
"""Every ``check_*`` in this module, in alphabetical order."""


def run_conformance(make_db: DbFactory) -> dict[str, str | None]:
    """Runs every check outside pytest; ``None`` = passed."""
    results: dict[str, str | None] = {}
    for name, fn in CHECKS:
        try:
            fn(make_db)
        except BaseException as exc:  # noqa: BLE001
            results[name] = f"{type(exc).__name__}: {exc}"
        else:
            results[name] = None
    return results


class DbConformance:
    """pytest test base. Subclass it in a ``Test*`` class and define the ``make_db`` fixture.

    ``shared_path = True`` enables the two-instances-on-one-file test (on-disk
    implementations); ``MemDb`` leaves it ``False``.
    """

    shared_path = False

    @pytest.fixture
    def make_db(self) -> DbFactory:  # pragma: no cover - always overridden
        raise NotImplementedError("defina a fixture make_db na subclasse")

    @pytest.mark.parametrize("check", [name for name, _ in CHECKS])
    def test_db_conformance(self, make_db: DbFactory, check: str) -> None:
        dict(CHECKS)[check](make_db)

    def test_two_instances_share_the_file(self, make_db: DbFactory) -> None:
        if not self.shared_path:
            pytest.skip("in-memory implementation: each instance is a separate database")
        a = make_db()
        b = make_db()
        assert a.path == b.path
        _tag(a, "shared")
        assert _count(b, "tags", "id = 'shared'") == 1
        with pytest.raises(RuntimeError):
            with a.transaction():
                _tag(a, "pending")
                assert _count(b, "tags", "id = 'pending'") == 0
                raise RuntimeError
        assert _count(b, "tags", "id = 'pending'") == 0


__all__ = [
    "CHECKS",
    "DbConformance",
    "DbFactory",
    "EXPECTED_TABLES",
    "run_conformance",
]
