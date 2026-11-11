"""``core/db.py`` (``Db`` over SQLite) and ``adapters/storage.py`` (``open_db``).

Does not depend on ``tests/conftest.py``: finds ``plugin/_bootstrap.py`` by path. Every database
lives in ``tmp_path``; no network.
"""

from __future__ import annotations

import importlib.util
import inspect
import os
import sqlite3
import stat
import sys
import threading
import time
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_SCHEMA = ROOT / "contract" / "schema.sql"


def _load_bootstrap():
    spec = importlib.util.spec_from_file_location(
        "_tube_bootstrap_test_db", ROOT / "plugin" / "_bootstrap.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_load_bootstrap().ensure()

from tube_pkg._id import PLUGIN_ID  # noqa: E402
from tube_pkg.adapters import storage  # noqa: E402
from tube_pkg.core import db as dbmod  # noqa: E402
from tube_pkg.core import types as T  # noqa: E402

CHANNEL_A = "UC" + "a" * 22
CHANNEL_B = "UC" + "b" * 22


# --------------------------------------------------------------------------- utilities


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "data" / "tube.db"


@pytest.fixture
def db(db_path: Path):
    handle = dbmod.build(path=str(db_path))
    try:
        yield handle
    finally:
        handle.close()


def _raw(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), isolation_level=None)
    return conn


def _schema_dump(conn: sqlite3.Connection) -> list[tuple]:
    return conn.execute(
        "SELECT type, name, tbl_name, sql FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).fetchall()


def _contract_tables() -> set[str]:
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(CONTRACT_SCHEMA.read_text(encoding="utf-8"))
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    finally:
        conn.close()
    return {r[0] for r in rows}


def _create_v1(path: Path) -> None:
    """A v1 database as an old install would leave it: contract schema, no WAL, with data."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = _raw(path)
    try:
        conn.executescript(CONTRACT_SCHEMA.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO folders (id, name, created_at) VALUES ('f1', 'Tech', 1700000000)")
        conn.execute(
            "INSERT INTO channels (id, title, relation, source, added_at, folder_id) "
            "VALUES (?, 'Canal A', 'subscribed', 'extension', 1700000000, 'f1')",
            (CHANNEL_A,),
        )
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    finally:
        conn.close()


def _insert_channel(db, cid: str, title: str = "x") -> None:
    db.execute(
        "INSERT INTO channels (id, title, relation, source, added_at) "
        "VALUES (?, ?, 'followed', 'link', 1700000000)",
        (cid, title),
    )


def _cid(n: int) -> str:
    return "UC" + f"{n:022d}"


# --------------------------------------------------------------------------- module contract


def test_build_signature_matches_contract():
    sig = inspect.signature(dbmod.build)
    params = list(sig.parameters.values())
    assert [p.name for p in params] == ["path"]
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params)
    assert all(p.default is None for p in params)
    assert T.BUILD_SIGNATURES["plugin/core/db.py:build"] == "build(*, path=None) -> Db"


def test_build_returns_db_protocol(db):
    assert isinstance(db, T.Db)


def test_embedded_schema_matches_contract_file():
    """The published package only has ``plugin/``: the schema lives embedded in ``core/db.py``."""
    assert dbmod.SCHEMA_SQL == CONTRACT_SCHEMA.read_text(encoding="utf-8")


def test_migrations_list_shape():
    assert len(dbmod.MIGRATIONS) == T.SCHEMA_VERSION
    for n, fn in enumerate(dbmod.MIGRATIONS, start=1):
        assert callable(fn)
        assert fn.__name__ == f"migrate_{n}"


def test_module_has_no_domain_sql():
    """Domain SQL belongs to each module: ``db.py`` only has ``meta`` and the embedded schema."""
    source = Path(dbmod.__file__).read_text(encoding="utf-8")
    code = source.replace(dbmod.SCHEMA_SQL, "")
    for table in _contract_tables() - {"meta"}:
        for verb in ("INSERT INTO", "UPDATE", "DELETE FROM"):
            assert f"{verb} {table} " not in code, f"domain SQL in db.py: {verb} {table}"


# --------------------------------------------------------------------------- schema and migration


def test_empty_db_gets_schema(db, db_path):
    assert db_path.is_file()
    tables = {
        r["name"]
        for r in db.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    # the contract schema + the additive steps not versioned yet (``PENDING_TABLES``)
    assert tables == _contract_tables() | set(dbmod.PENDING_TABLES)
    row = db.query_one("SELECT value FROM meta WHERE key = ?", (T.META_SCHEMA_VERSION,))
    assert row == {"value": str(T.SCHEMA_VERSION)}


def test_zero_byte_file_gets_schema(tmp_path):
    path = tmp_path / "tube.db"
    path.write_bytes(b"")
    handle = dbmod.build(path=str(path))
    try:
        assert handle.query_one("SELECT count(*) AS n FROM tabs") == {"n": 0}
        assert dbmod.schema_version(handle) == T.SCHEMA_VERSION
    finally:
        handle.close()


def test_v1_db_is_migrated_and_keeps_data(db_path):
    _create_v1(db_path)
    handle = dbmod.build(path=str(db_path))
    try:
        assert handle.query_one("PRAGMA journal_mode") == {"journal_mode": "wal"}
        assert dbmod.schema_version(handle) == T.SCHEMA_VERSION
        rows = handle.query("SELECT id, title, folder_id FROM channels")
        assert rows == [{"id": CHANNEL_A, "title": "Canal A", "folder_id": "f1"}]
    finally:
        handle.close()


def test_migration_v1_to_v2_runs_once_and_is_additive(db_path, monkeypatch):
    """Simulates the next version: an additive ``migrate_2`` runs once, without losing data."""
    _create_v1(db_path)
    calls: list[int] = []

    def migrate_2(conn: sqlite3.Connection) -> None:
        calls.append(2)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(channels)")}
        if "nickname" not in cols:
            conn.execute("ALTER TABLE channels ADD COLUMN nickname TEXT")
        conn.execute("CREATE TABLE IF NOT EXISTS extra_v2 (id TEXT PRIMARY KEY)")

    monkeypatch.setattr(dbmod, "MIGRATIONS", [*dbmod.MIGRATIONS, migrate_2])

    first = dbmod.build(path=str(db_path))
    try:
        assert calls == [2]
        assert dbmod.schema_version(first) == 2
        assert first.query_one("SELECT title, nickname FROM channels") == {
            "title": "Canal A",
            "nickname": None,
        }
        assert first.query_one("SELECT count(*) AS n FROM extra_v2") == {"n": 0}
    finally:
        first.close()

    raw = _raw(db_path)
    before = _schema_dump(raw)
    raw.close()

    second = dbmod.build(path=str(db_path))  # already at v2: nothing runs
    second.close()
    assert calls == [2]

    raw = _raw(db_path)
    try:
        assert _schema_dump(raw) == before
        # migrate_2 itself is idempotent
        migrate_2(raw)
        assert _schema_dump(raw) == before
    finally:
        raw.close()


def test_repeated_migrations_change_nothing(db, db_path):
    _insert_channel(db, CHANNEL_A, "Canal A")
    db.close()

    raw = _raw(db_path)
    before = _schema_dump(raw)
    meta_before = raw.execute("SELECT key, value FROM meta ORDER BY key").fetchall()
    try:
        for fn in dbmod.MIGRATIONS:  # again, over an already migrated database
            fn(raw)
        assert _schema_dump(raw) == before
        assert raw.execute("SELECT key, value FROM meta ORDER BY key").fetchall() == meta_before
        assert raw.execute("SELECT count(*) FROM channels").fetchone()[0] == 1
    finally:
        raw.close()

    again = dbmod.build(path=str(db_path))
    try:
        assert again.query_one("SELECT title FROM channels") == {"title": "Canal A"}
        raw = _raw(db_path)
        assert _schema_dump(raw) == before
        raw.close()
    finally:
        again.close()


def test_failed_migration_rolls_back_everything(db_path, monkeypatch):
    _create_v1(db_path)

    def migrate_2(conn: sqlite3.Connection) -> None:
        conn.execute("CREATE TABLE half_done (id TEXT)")
        raise RuntimeError("falhou no meio")

    monkeypatch.setattr(dbmod, "MIGRATIONS", [*dbmod.MIGRATIONS, migrate_2])
    with pytest.raises(RuntimeError, match="falhou no meio"):
        dbmod.build(path=str(db_path))

    raw = _raw(db_path)
    try:
        names = {r[0] for r in raw.execute("SELECT name FROM sqlite_master")}
        assert "half_done" not in names
        version = raw.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
        assert version == "1"
        assert raw.execute("SELECT count(*) FROM channels").fetchone()[0] == 1
    finally:
        raw.close()


def test_newer_db_is_opened_without_touching(db_path):
    _create_v1(db_path)
    raw = _raw(db_path)
    raw.execute("UPDATE meta SET value='99' WHERE key='schema_version'")
    before = _schema_dump(raw)
    raw.close()

    handle = dbmod.build(path=str(db_path))
    try:
        assert dbmod.schema_version(handle) == 99
    finally:
        handle.close()
    raw = _raw(db_path)
    assert _schema_dump(raw) == before
    raw.close()


def test_two_processes_style_bootstrap_concurrently(tmp_path):
    """Several simultaneous opens of the same new file: schema applied once, no error."""
    path = tmp_path / "race.db"
    errors: list[BaseException] = []
    handles: list = []
    barrier = threading.Barrier(6)

    def opener() -> None:
        try:
            barrier.wait()
            handles.append(dbmod.build(path=str(path)))
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=opener) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    try:
        assert errors == []
        assert len(handles) == 6
        assert dbmod.schema_version(handles[0]) == T.SCHEMA_VERSION
    finally:
        for h in handles:
            h.close()


# --------------------------------------------------------------------------- PRAGMAs


def test_pragmas(db):
    assert db.query_one("PRAGMA journal_mode") == {"journal_mode": "wal"}
    assert db.query_one("PRAGMA busy_timeout")["timeout"] >= 5000
    assert db.query_one("PRAGMA foreign_keys") == {"foreign_keys": 1}


def test_foreign_keys_enforced(db):
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO channel_tags (channel_id, tag_id) VALUES (?, 't1')", (CHANNEL_A,))


def test_cascade_delete(db):
    _insert_channel(db, CHANNEL_A)
    db.execute("INSERT INTO tags (id, name, created_at) VALUES ('t1', 'x', 1)")
    db.execute("INSERT INTO channel_tags VALUES (?, 't1')", (CHANNEL_A,))
    db.execute("DELETE FROM channels WHERE id = ?", (CHANNEL_A,))
    assert db.query_one("SELECT count(*) AS n FROM channel_tags") == {"n": 0}


# --------------------------------------------------------------------------- Db API


def test_path_is_absolute(db, db_path):
    assert db.path == str(db_path.resolve())


def test_query_execute_roundtrip(db):
    res = db.execute(
        "INSERT INTO tags (id, name, color, created_at) VALUES (:id, :name, :color, :ts)",
        {"id": "t1", "name": "Música", "color": None, "ts": 5},
    )
    assert isinstance(res, T.ExecResult)
    assert res.rowcount == 1
    assert db.query("SELECT id, name, color, created_at FROM tags") == [
        {"id": "t1", "name": "Música", "color": None, "created_at": 5}
    ]
    assert db.query_one("SELECT id FROM tags WHERE id = ?", ["t1"]) == {"id": "t1"}
    assert db.query_one("SELECT id FROM tags WHERE id = ?", ("zz",)) is None
    assert db.query("SELECT id FROM tags WHERE id = 'zz'") == []
    upd = db.execute("UPDATE tags SET color = ? WHERE id = ?", ("#fff", "t1"))
    assert upd.rowcount == 1


def test_execute_lastrowid(db):
    res = db.execute(
        "INSERT INTO changes (ts, actor, action) VALUES (?, ?, ?)",
        (1, T.Actor.user, T.ChangeAction.tag_create),
    )
    assert res.lastrowid == 1
    res2 = db.execute(
        "INSERT INTO changes (ts, actor, action) VALUES (?, ?, ?)", (2, "user", "tag_create")
    )
    assert res2.lastrowid == 2
    row = db.query_one("SELECT actor, action FROM changes WHERE id = 1")
    assert row == {"actor": "user", "action": "tag_create"}  # StrEnum is stored as text


def test_executemany_total_and_atomic(db):
    n = db.executemany(
        "INSERT INTO tags (id, name, created_at) VALUES (?, ?, 1)",
        [("a", "A"), ("b", "B"), ("c", "C")],
    )
    assert n == 3
    assert db.executemany("INSERT INTO tags (id, name, created_at) VALUES (?, ?, 1)", []) == 0
    with pytest.raises(sqlite3.IntegrityError):
        db.executemany(
            "INSERT INTO tags (id, name, created_at) VALUES (?, ?, 1)",
            [("d", "D"), ("a", "dup"), ("e", "E")],
        )
    assert [r["id"] for r in db.query("SELECT id FROM tags ORDER BY id")] == ["a", "b", "c"]


def test_memory_db(tmp_path):
    handle = dbmod.build(path=":memory:")
    try:
        assert handle.path == ":memory:"
        _insert_channel(handle, CHANNEL_A)
        assert handle.query_one("SELECT count(*) AS n FROM channels") == {"n": 1}
    finally:
        handle.close()


def test_path_from_env(tmp_path, monkeypatch):
    target = tmp_path / "env" / "tube.db"
    monkeypatch.setenv("TUBE_DB_PATH", str(target))
    handle = dbmod.build()
    try:
        assert handle.path == str(target.resolve())
        assert target.is_file()
    finally:
        handle.close()


def test_no_path_no_env_is_an_error(monkeypatch):
    monkeypatch.delenv("TUBE_DB_PATH", raising=False)
    with pytest.raises(RuntimeError, match="TUBE_DB_PATH"):
        dbmod.build()


def test_close_is_idempotent(db_path):
    handle = dbmod.build(path=str(db_path))
    handle.close()
    handle.close()
    with pytest.raises(sqlite3.ProgrammingError):
        handle.query("SELECT 1")


# --------------------------------------------------------------------------- transactions


def test_transaction_commits(db):
    with db.transaction():
        _insert_channel(db, CHANNEL_A)
        # the same thread sees the open transaction
        assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 1}
    assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 1}


def test_transaction_rolls_back_on_exception(db):
    with pytest.raises(ValueError, match="boom"):
        with db.transaction():
            _insert_channel(db, CHANNEL_A)
            raise ValueError("boom")
    assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 0}
    # the Db stays usable after the rollback
    _insert_channel(db, CHANNEL_B)
    assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 1}


def test_transaction_rolls_back_on_base_exception(db):
    with pytest.raises(KeyboardInterrupt):
        with db.transaction():
            _insert_channel(db, CHANNEL_A)
            raise KeyboardInterrupt
    assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 0}


def test_nested_transaction_is_savepoint(db):
    with db.transaction():
        _insert_channel(db, CHANNEL_A)
        with pytest.raises(ValueError):
            with db.transaction():
                _insert_channel(db, CHANNEL_B)
                raise ValueError("inner")
        # only the inner one was undone
        assert [r["id"] for r in db.query("SELECT id FROM channels")] == [CHANNEL_A]
        with db.transaction():
            _insert_channel(db, _cid(3))
    assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 2}


def test_outer_rollback_discards_committed_inner(db):
    with pytest.raises(ValueError):
        with db.transaction():
            with db.transaction():
                _insert_channel(db, CHANNEL_A)
            raise ValueError("outer")
    assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 0}


def test_executemany_inside_transaction_joins_it(db):
    with pytest.raises(RuntimeError):
        with db.transaction():
            db.executemany("INSERT INTO tags (id, name, created_at) VALUES (?, ?, 1)", [("a", "A")])
            raise RuntimeError("x")
    assert db.query_one("SELECT count(*) AS n FROM tags") == {"n": 0}


def test_other_thread_does_not_join_open_transaction(db):
    """A write from another thread waits for the transaction to end and is not undone with it."""
    inside = threading.Event()
    other_done = threading.Event()
    errors: list[BaseException] = []

    def other() -> None:
        inside.wait(5)
        try:
            _insert_channel(db, CHANNEL_B)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        other_done.set()

    t = threading.Thread(target=other)
    t.start()
    with pytest.raises(ValueError):
        with db.transaction():
            _insert_channel(db, CHANNEL_A)
            inside.set()
            time.sleep(0.2)
            assert not other_done.is_set()  # blocked until the transaction ends
            raise ValueError("rollback")
    t.join(10)
    assert errors == []
    assert [r["id"] for r in db.query("SELECT id FROM channels")] == [CHANNEL_B]


# --------------------------------------------------------------------------- concurrency


def test_threads_sharing_one_db(db):
    errors: list[BaseException] = []

    def worker(k: int) -> None:
        try:
            for i in range(40):
                if i % 2:
                    with db.transaction():
                        _insert_channel(db, _cid(k * 1000 + i))
                else:
                    _insert_channel(db, _cid(k * 1000 + i))
                db.query("SELECT count(*) FROM channels")
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(k,)) for k in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert errors == []
    assert db.query_one("SELECT count(*) AS n FROM channels") == {"n": 320}


def test_two_connections_in_threads_write_without_locked(db_path):
    """Two ``Db`` (like gateway and script) on the same file, writing at the same time."""
    first = dbmod.build(path=str(db_path))
    second = dbmod.build(path=str(db_path))
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def writer(handle, base: int) -> None:
        try:
            barrier.wait()
            for i in range(60):
                with handle.transaction():
                    _insert_channel(handle, _cid(base + i))
                    handle.query("SELECT count(*) FROM channels")
                    time.sleep(0.001)  # holds the write lock for a moment
                _insert_channel(handle, _cid(base + 500 + i))
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [
        threading.Thread(target=writer, args=(first, 0)),
        threading.Thread(target=writer, args=(second, 10_000)),
    ]
    try:
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
        assert not any("locked" in str(e) for e in errors), errors
        assert errors == []
        assert first.query_one("SELECT count(*) AS n FROM channels") == {"n": 240}
        assert second.query_one("SELECT count(*) AS n FROM channels") == {"n": 240}
    finally:
        first.close()
        second.close()


def test_reader_in_other_connection_not_blocked_by_writer(db_path):
    """WAL: a read from another connection does not wait for an open write transaction."""
    writer = dbmod.build(path=str(db_path))
    reader = dbmod.build(path=str(db_path))
    try:
        with writer.transaction():
            _insert_channel(writer, CHANNEL_A)
            t0 = time.monotonic()
            assert reader.query_one("SELECT count(*) AS n FROM channels") == {"n": 0}
            assert time.monotonic() - t0 < 1.0
        assert reader.query_one("SELECT count(*) AS n FROM channels") == {"n": 1}
    finally:
        writer.close()
        reader.close()


# --------------------------------------------------------------------------- adapters/storage.py


def _fake_hermes(monkeypatch, data_dir: Path, calls: list) -> None:
    """Installs a fake ``plugins.plugin_storage`` (same shape as Hermes's) in ``sys.modules``."""

    def plugin_data_dir(name: str) -> Path:
        calls.append(("plugin_data_dir", name))
        root = data_dir / name
        root.mkdir(parents=True, exist_ok=True)
        return root

    def plugin_db(name: str, filename: str = "data.db") -> sqlite3.Connection:
        calls.append(("plugin_db", name, filename))
        conn = sqlite3.connect(str(plugin_data_dir(name) / filename), check_same_thread=False)
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    pkg = types.ModuleType("plugins")
    pkg.__path__ = []  # type: ignore[attr-defined]
    mod = types.ModuleType("plugins.plugin_storage")
    mod.plugin_data_dir = plugin_data_dir  # type: ignore[attr-defined]
    mod.plugin_db = plugin_db  # type: ignore[attr-defined]
    pkg.plugin_storage = mod  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "plugins", pkg)
    monkeypatch.setitem(sys.modules, "plugins.plugin_storage", mod)


def _no_hermes(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "plugins", None)
    monkeypatch.setitem(sys.modules, "plugins.plugin_storage", None)


def test_storage_explicit_path(tmp_path, monkeypatch):
    _no_hermes(monkeypatch)
    monkeypatch.delenv("TUBE_DB_PATH", raising=False)
    handle = storage.open_db(path=str(tmp_path / "x.db"))
    try:
        assert isinstance(handle, T.Db)
        assert handle.path == str((tmp_path / "x.db").resolve())
    finally:
        handle.close()


def test_storage_env_wins_over_hermes(tmp_path, monkeypatch):
    calls: list = []
    _fake_hermes(monkeypatch, tmp_path / "hermes", calls)
    monkeypatch.setenv("TUBE_DB_PATH", str(tmp_path / "env.db"))
    handle = storage.open_db()
    try:
        assert handle.path == str((tmp_path / "env.db").resolve())
        assert calls == []
    finally:
        handle.close()


def test_storage_uses_hermes_plugin_db(tmp_path, monkeypatch):
    calls: list = []
    _fake_hermes(monkeypatch, tmp_path / "hermes", calls)
    monkeypatch.delenv("TUBE_DB_PATH", raising=False)
    handle = storage.open_db()
    try:
        assert ("plugin_db", PLUGIN_ID, "tube.db") in calls
        expected = (tmp_path / "hermes" / PLUGIN_ID / "tube.db").resolve()
        assert handle.path == str(expected)
        assert handle.query_one("PRAGMA journal_mode") == {"journal_mode": "wal"}
        assert handle.query_one("PRAGMA busy_timeout")["timeout"] >= 5000
        assert handle.query_one("PRAGMA foreign_keys") == {"foreign_keys": 1}
        assert dbmod.schema_version(handle) == T.SCHEMA_VERSION
        # autocommit outside transaction(): another connection sees it immediately
        _insert_channel(handle, CHANNEL_A)
        raw = _raw(expected)
        assert raw.execute("SELECT count(*) FROM channels").fetchone()[0] == 1
        raw.close()
        with pytest.raises(ValueError):
            with handle.transaction():
                _insert_channel(handle, CHANNEL_B)
                raise ValueError
        assert handle.query_one("SELECT count(*) AS n FROM channels") == {"n": 1}
    finally:
        handle.close()


def test_storage_raises_busy_timeout_below_minimum(tmp_path, monkeypatch):
    calls: list = []
    _fake_hermes(monkeypatch, tmp_path / "hermes", calls)
    monkeypatch.delenv("TUBE_DB_PATH", raising=False)
    original = sys.modules["plugins.plugin_storage"].plugin_db

    def low_timeout(name: str, filename: str = "data.db") -> sqlite3.Connection:
        conn = original(name, filename)
        conn.execute("PRAGMA busy_timeout=100")
        conn.execute("PRAGMA foreign_keys=OFF")
        return conn

    monkeypatch.setattr(sys.modules["plugins.plugin_storage"], "plugin_db", low_timeout)
    handle = storage.open_db()
    try:
        assert handle.query_one("PRAGMA busy_timeout")["timeout"] >= 5000
        assert handle.query_one("PRAGMA foreign_keys") == {"foreign_keys": 1}
    finally:
        handle.close()


@pytest.mark.skipif(os.name != "posix", reason="POSIX permissions")
@pytest.mark.parametrize("how", ["path", "hermes"])
def test_storage_db_and_wal_files_are_private(tmp_path, monkeypatch, how):
    """``tube.db``, ``-wal`` and ``-shm`` end up 0600 (best effort): another account on the
    machine cannot read them even if the profile folder is opened up."""
    old = os.umask(0o022)
    try:
        if how == "path":
            _no_hermes(monkeypatch)
            monkeypatch.delenv("TUBE_DB_PATH", raising=False)
            handle = storage.open_db(path=str(tmp_path / "x.db"))
        else:
            _fake_hermes(monkeypatch, tmp_path / "hermes", [])
            monkeypatch.delenv("TUBE_DB_PATH", raising=False)
            handle = storage.open_db()
        try:
            _insert_channel(handle, CHANNEL_A)
            main = Path(handle.path)
            files = [main, *(Path(f"{main}{s}") for s in ("-wal", "-shm"))]
            present = [f for f in files if f.exists()]
            assert main in present
            for f in present:
                assert stat.S_IMODE(f.stat().st_mode) == 0o600, f
        finally:
            handle.close()
    finally:
        os.umask(old)


def test_storage_without_hermes_and_env_is_an_error(monkeypatch):
    _no_hermes(monkeypatch)
    monkeypatch.delenv("TUBE_DB_PATH", raising=False)
    with pytest.raises(RuntimeError, match="TUBE_DB_PATH"):
        storage.open_db()


def test_storage_does_not_import_hermes_at_module_load():
    source = Path(storage.__file__).read_text(encoding="utf-8")
    top = [ln for ln in source.splitlines() if ln.startswith(("import ", "from "))]
    assert not any("plugins" in ln or "hermes" in ln for ln in top), top


def test_storage_with_real_hermes(tmp_path, monkeypatch):
    """Integration with the real ``plugin_storage`` (if Hermes is on ``sys.path``)."""
    try:
        import plugins.plugin_storage  # noqa: F401
    except Exception:  # noqa: BLE001
        pytest.skip("Hermes is not on sys.path")
    monkeypatch.delenv("TUBE_DB_PATH", raising=False)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes-home"))
    handle = storage.open_db()
    try:
        expected = tmp_path / "hermes-home" / "plugin-data" / PLUGIN_ID / "tube.db"
        assert handle.path == str(expected.resolve())
        assert handle.query_one("PRAGMA busy_timeout")["timeout"] >= 5000
        assert handle.query_one("PRAGMA foreign_keys") == {"foreign_keys": 1}
        assert dbmod.schema_version(handle) == T.SCHEMA_VERSION
    finally:
        handle.close()
