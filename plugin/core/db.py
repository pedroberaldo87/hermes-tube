"""The plugin's SQLite database: implementation of the ``Db`` protocol from ``core/types.py``.

Connection model
    One ``Db`` = **one** ``sqlite3`` connection with ``check_same_thread=False`` and
    ``isolation_level=None`` (real autocommit) + a reentrant lock (``RLock``) that serialises
    access between threads of the same process (REST routes, jobs, refresh). Across processes
    (gateway, plugin host, routine scripts, ``hermes chat``) SQLite coordinates:
    ``journal_mode=WAL`` (readers do not wait for writers) and ``busy_timeout`` ≥ 5 s (a writer
    waits for another writer instead of failing).

Transactions
    ``transaction()`` runs ``BEGIN IMMEDIATE`` … ``COMMIT`` and holds the connection lock until
    the end: another thread calling ``query``/``execute`` waits for the transaction to finish
    (it never joins it nor gets rolled back with it). Reentrant on the same thread: the nested
    one becomes a ``SAVEPOINT``; an exception in the inner one rolls back only the inner one and
    re-raises. Any ``BaseException`` → ``ROLLBACK``. Rule for callers: no network and no long
    waits inside ``transaction()``.

Schema and migrations
    The schema is ``contract/schema.sql``, **embedded** in ``SCHEMA_SQL`` (the published package
    only contains ``plugin/``; ``tests/test_db.py`` fails if the two diverge).
    ``MIGRATIONS[n - 1]`` takes the database from version ``n - 1`` to ``n``
    (``meta.schema_version``):

    - ``migrate_1`` applies ``SCHEMA_SQL`` (``CREATE … IF NOT EXISTS``): a new database is born
      in the latest schema shape;
    - ``migrate_N`` (N ≥ 2) receives the connection inside the transaction, is **additive** and
      **idempotent** (e.g. ``ADD COLUMN`` only if missing, ``CREATE … IF NOT EXISTS``) — on a
      new database it runs right after ``migrate_1``, which already created everything; it never
      deletes data;
    - pending migrations run in a single ``IMMEDIATE`` transaction, with the version re-read
      **inside** it (two simultaneous opens do not migrate twice); failure → nothing changes;
    - a database with a version greater than ``len(MIGRATIONS)`` (newer plugin) opens without
      migrating.

No domain SQL here: each module writes the SQL for its own tables.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

from tube_pkg.core.types import (
    META_SCHEMA_VERSION,
    SCHEMA_VERSION,
    Db,
    ExecResult,
    Params,
    Row,
)

log = logging.getLogger(__name__)

ENV_DB_PATH = "TUBE_DB_PATH"
"""Database path outside Hermes (tests, scripts)."""
MIN_BUSY_TIMEOUT_MS = 5000
"""Minimum ``busy_timeout`` (gateway, plugin host, scripts and ``hermes chat`` on the same file)."""
LOCK_TIMEOUT_S = 60.0
"""Maximum wait for the internal lock (another thread with an open transaction) before giving up."""
SETUP_RETRY_S = 15.0
"""Total deadline for retrying the setup (PRAGMAs + migration) on ``locked``/``busy``."""
MEMORY = ":memory:"

Migration = Callable[[sqlite3.Connection], None]

# Literal copy of contract/schema.sql (generated from it; a test enforces equality).
SCHEMA_SQL = """\
-- Plugin SQLite schema — contract.
--
-- Rules:
--   * idempotent (IF NOT EXISTS / OR IGNORE): can be applied again over an existing database
--   * connection PRAGMAs (journal_mode=WAL, busy_timeout, foreign_keys=ON) belong to whoever opens
--     the connection (core/db.py), not to this file
--   * time = INTEGER, seconds since the Unix epoch (UTC); booleans = INTEGER 0/1
--   * JSON = TEXT checked by json_valid()
--   * additive evolution only: migrate_N in core/db.py + this file (meta.schema_version)
--   * the CHECK values are the same as the enums in plugin/core/types.py
--   * each table has one owner (its only writer): see the comment above each table

-- meta · key/value (schema version, last RSS run, RSS lock, own server port…)
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

-- folders · TaxonomyService · nested folders
CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    parent_id  TEXT REFERENCES folders (id) ON DELETE SET NULL,
    color      TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders (parent_id, sort);

-- channels · ChannelService
CREATE TABLE IF NOT EXISTS channels (
    id              TEXT PRIMARY KEY
                    CHECK (length(id) = 24 AND substr(id, 1, 2) = 'UC'),
    handle          TEXT,            -- canonical: dedup.normalize_handle ('@' + casefold)
    title           TEXT NOT NULL DEFAULT '',
    thumb           TEXT,
    url             TEXT,
    relation        TEXT NOT NULL
                    CHECK (relation IN ('subscribed', 'followed', 'ex', 'ignored')),
    folder_id       TEXT REFERENCES folders (id) ON DELETE SET NULL,
    favorite        INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    muted           INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
    source          TEXT NOT NULL
                    CHECK (source IN ('extension', 'link', 'demo', 'theme', 'list', 'mytube')),
    added_at        INTEGER NOT NULL,
    unsubscribed_at INTEGER,
    last_video_at   INTEGER,
    videos_per_week REAL,
    shorts_ratio    REAL CHECK (shorts_ratio IS NULL OR (shorts_ratio >= 0 AND shorts_ratio <= 1)),
    ai_note         TEXT,
    updated_at      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_handle ON channels (handle) WHERE handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channels_folder ON channels (folder_id);
CREATE INDEX IF NOT EXISTS idx_channels_relation ON channels (relation);
CREATE INDEX IF NOT EXISTS idx_channels_source ON channels (source);

-- tags · TaxonomyService
CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    color      TEXT,
    created_at INTEGER NOT NULL
);

-- channel_tags · ChannelService
CREATE TABLE IF NOT EXISTS channel_tags (
    channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_tags_tag ON channel_tags (tag_id);

-- videos · VideoStore. No FK to channels: theme/HN/list videos may come from channels that are
-- not followed (channel_title keeps the name in that case).
CREATE TABLE IF NOT EXISTS videos (
    id            TEXT PRIMARY KEY CHECK (length(id) = 11),
    channel_id    TEXT NOT NULL,
    channel_title TEXT,
    title         TEXT NOT NULL DEFAULT '',
    description   TEXT,               -- media:description from the RSS feed
    published_at  INTEGER,
    duration_s    INTEGER CHECK (duration_s IS NULL OR duration_s >= 0),
    is_short      INTEGER CHECK (is_short IS NULL OR is_short IN (0, 1)),
    views         INTEGER CHECK (views IS NULL OR views >= 0),
    first_seen_at INTEGER NOT NULL,    -- set on the first insert only
    origin        TEXT NOT NULL CHECK (origin IN ('rss', 'search', 'hn', 'list')),  -- same
    updated_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_videos_channel_pub ON videos (channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_pub ON videos (published_at DESC);

-- video_state · VideoStateService · inbox; no row = new
CREATE TABLE IF NOT EXISTS video_state (
    video_id   TEXT PRIMARY KEY,
    state      TEXT NOT NULL DEFAULT 'new'
               CHECK (state IN ('new', 'seen', 'later', 'archived', 'watched')),
    reaction   TEXT CHECK (reaction IS NULL OR reaction IN ('up', 'down')),
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_state_state ON video_state (state, updated_at DESC);

-- watermarks · Refresher · "new" = published_at > seen_up_to
CREATE TABLE IF NOT EXISTS watermarks (
    channel_id TEXT PRIMARY KEY REFERENCES channels (id) ON DELETE CASCADE,
    seen_up_to INTEGER NOT NULL
);

-- tabs · TabService. rules = TabRules with include.lenses; filters = view state of the
-- interface (the engine ignores it).
CREATE TABLE IF NOT EXISTS tabs (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    icon       TEXT,
    kind       TEXT NOT NULL CHECK (kind IN ('category', 'channels', 'theme', 'mixed')),
    rules      TEXT NOT NULL DEFAULT '{}'
               CHECK (json_valid(rules) AND json_type(rules) = 'object'
                      AND coalesce(json_type(rules, '$.include'), 'object') = 'object'
                      AND coalesce(json_type(rules, '$.include.lenses'), 'array') = 'array'
                      AND coalesce(json_type(rules, '$.exclude'), 'object') = 'object'
                      AND coalesce(json_type(rules, '$.filters'), 'object') = 'object'),
    filters    TEXT NOT NULL DEFAULT '{}'
               CHECK (json_valid(filters) AND json_type(filters) = 'object'),
    sort       INTEGER NOT NULL DEFAULT 0,
    builtin    INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- themes · Themes
CREATE TABLE IF NOT EXISTS themes (
    id             TEXT PRIMARY KEY,
    tab_id         TEXT REFERENCES tabs (id) ON DELETE SET NULL,
    query          TEXT NOT NULL,
    name           TEXT,
    icon           TEXT,
    searches       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(searches)),
    seeds          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(seeds)),
    include_terms  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(include_terms)),
    exclude_terms  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exclude_terms)),
    last_search_at INTEGER,
    cadence_days   INTEGER NOT NULL DEFAULT 7 CHECK (cadence_days > 0),
    status         TEXT NOT NULL CHECK (status IN ('searching', 'preview', 'saved', 'error')),
    error          TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

-- theme_items · Themes
CREATE TABLE IF NOT EXISTS theme_items (
    theme_id TEXT NOT NULL REFERENCES themes (id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    reason   TEXT,
    score    REAL,
    source   TEXT NOT NULL CHECK (source IN ('search', 'classics', 'rss')),
    verdict  TEXT NOT NULL CHECK (verdict IN ('keep', 'cut', 'user_down')),
    PRIMARY KEY (theme_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_theme_items_video ON theme_items (video_id);

-- suggestions · Organizer · nothing is applied until accepted
CREATE TABLE IF NOT EXISTS suggestions (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('organize', 'cleanup', 'seed')),
    channel_id TEXT,
    payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
    model      TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions (kind, status, created_at);

-- cleanup_candidates · Cleanup · cleanup reasons (kept out of suggestions)
CREATE TABLE IF NOT EXISTS cleanup_candidates (
    id         TEXT PRIMARY KEY,
    scan_id    TEXT NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    group_key  TEXT NOT NULL CHECK (group_key IN ('stale', 'ignored', 'off_profile', 'manual')),
    why        TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'dismissed')),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cleanup_candidates_scan ON cleanup_candidates (scan_id, status);
CREATE INDEX IF NOT EXISTS idx_cleanup_candidates_channel ON cleanup_candidates (channel_id);

-- unsub_queue · Cleanup · only the extension consumes it, and only items a human approved.
-- approved_at/approved_via NOT NULL: no item exists without approval. No FK to channels
-- (the queue history survives a deleted channel).
CREATE TABLE IF NOT EXISTS unsub_queue (
    id           TEXT PRIMARY KEY,
    channel_id   TEXT NOT NULL,
    action       TEXT NOT NULL DEFAULT 'unsubscribe'
                 CHECK (action IN ('unsubscribe', 'resubscribe')),
    reason       TEXT,
    approved_at  INTEGER NOT NULL,
    approved_via TEXT NOT NULL CHECK (approved_via IN ('desktop_rpc', 'ask_choice')),
    status       TEXT NOT NULL DEFAULT 'approved'
                 CHECK (status IN ('approved', 'running', 'done', 'failed', 'undone')),
    error        TEXT,
    device_id    TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
-- at most one active item per channel and action
CREATE UNIQUE INDEX IF NOT EXISTS idx_unsub_queue_active
    ON unsub_queue (channel_id, action) WHERE status IN ('approved', 'running');
CREATE INDEX IF NOT EXISTS idx_unsub_queue_status ON unsub_queue (status, approved_at);

-- jobs · JobRunner · asynchronous AI jobs (event + GET /jobs/{id})
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL
                CHECK (kind IN ('organize', 'cleanup_scan', 'theme', 'list_import', 'digest')),
    status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'error')),
    progress    TEXT CHECK (progress IS NULL OR json_valid(progress)),
    result      TEXT CHECK (result IS NULL OR json_valid(result)),
    error       TEXT CHECK (error IS NULL OR json_valid(error)),
    session_id  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_at);

-- search_jobs · Searcher · searches delegated to the extension; expire after 15 s (expires_at)
CREATE TABLE IF NOT EXISTS search_jobs (
    id           TEXT PRIMARY KEY,
    batch_id     TEXT NOT NULL,
    theme_id     TEXT,
    query        TEXT NOT NULL,
    search_order TEXT NOT NULL DEFAULT 'relevance' CHECK (search_order IN ('relevance', 'date')),
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'claimed', 'done', 'expired', 'failed')),
    payload      TEXT,                -- ytInitialData returned by the extension
    device_id    TEXT,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK (expires_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_search_jobs_status ON search_jobs (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_search_jobs_batch ON search_jobs (batch_id);

-- watch_history · SyncIngest · from the extension tracker; resending is idempotent
CREATE TABLE IF NOT EXISTS watch_history (
    video_id   TEXT NOT NULL,
    channel_id TEXT,
    watched_at INTEGER NOT NULL,
    device_id  TEXT,
    PRIMARY KEY (video_id, watched_at)
);
CREATE INDEX IF NOT EXISTS idx_watch_history_channel ON watch_history (channel_id, watched_at);

-- changes · ChangeLog · history + undo; increasing integer id = order
CREATE TABLE IF NOT EXISTS changes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        INTEGER NOT NULL,
    actor     TEXT NOT NULL CHECK (actor IN ('user', 'hermes', 'extension', 'routine')),
    action    TEXT NOT NULL,          -- ChangeAction (no CHECK: the list grows additively)
    group_id  TEXT,
    payload   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    undo      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(undo)),
    undone_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_changes_group ON changes (group_id) WHERE group_id IS NOT NULL;

-- devices · DeviceAuth · pairing; only the token hash is stored
CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER,
    revoked_at INTEGER,
    origin     TEXT
);

-- pair_codes · DeviceAuth · 6-digit codes (hash only), single use
CREATE TABLE IF NOT EXISTS pair_codes (
    code_hash  TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    device_id  TEXT
);

-- hn_videos · HN lens · optional extra; only filled when it is on
CREATE TABLE IF NOT EXISTS hn_videos (
    video_id   TEXT PRIMARY KEY,
    title      TEXT,
    channel    TEXT,
    channel_id TEXT,
    summary    TEXT,
    why        TEXT,
    topics     TEXT CHECK (topics IS NULL OR json_valid(topics)),
    categories TEXT CHECK (categories IS NULL OR json_valid(categories)),
    score      REAL
);
CREATE INDEX IF NOT EXISTS idx_hn_videos_channel ON hn_videos (channel_id);

-- list_imports · ListImporter · "import a list" previews
CREATE TABLE IF NOT EXISTS list_imports (
    id         TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    title      TEXT,
    payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    tab_id     TEXT,
    created_at INTEGER NOT NULL
);
"""


# --------------------------------------------------------------------------------------------
# Migrations
# --------------------------------------------------------------------------------------------


def split_sql(script: str) -> list[str]:
    """Split a script into complete statements (honours ``;`` inside comments/strings)."""
    out: list[str] = []
    buf: list[str] = []
    for line in script.splitlines(keepends=True):
        buf.append(line)
        chunk = "".join(buf)
        if sqlite3.complete_statement(chunk):
            if _strip_comments(chunk):
                out.append(chunk.strip())
            buf = []
    rest = "".join(buf)
    if _strip_comments(rest):
        out.append(rest.strip())
    return out


def _strip_comments(sql: str) -> str:
    lines = [ln.split("--", 1)[0] for ln in sql.splitlines()]
    return "\n".join(lines).strip()


def migrate_1(conn: sqlite3.Connection) -> None:
    """v0 → v1: applies ``SCHEMA_SQL`` (idempotent)."""
    for statement in split_sql(SCHEMA_SQL):
        conn.execute(statement)


PLAYLISTS_SQL = """\
-- playlists · PlaylistService (core/playlists.py) · the person's own local playlists; they live
-- only in this database and are never written to the YouTube account
CREATE TABLE IF NOT EXISTS playlists (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- playlist_items · PlaylistService · a video at most once per playlist, in `position` order.
-- No FK to videos (same as video_state); deleting a playlist removes its items, never a video.
CREATE TABLE IF NOT EXISTS playlist_items (
    playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    video_id    TEXT NOT NULL CHECK (length(video_id) = 11),
    position    INTEGER NOT NULL,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items (playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_items_video ON playlist_items (video_id);
"""
"""Tables of the local playlists (``migrate_2``; additive and idempotent)."""

PLAYLIST_TABLES: tuple[str, ...] = ("playlists", "playlist_items")


def migrate_2(conn: sqlite3.Connection) -> None:
    """v1 → v2: local playlists (``PLAYLISTS_SQL``; additive, idempotent)."""
    for statement in split_sql(PLAYLISTS_SQL):
        conn.execute(statement)


_ALL_MIGRATIONS: list[Migration] = [migrate_1, migrate_2]

MIGRATIONS: list[Migration] = _ALL_MIGRATIONS[:SCHEMA_VERSION]
"""``MIGRATIONS[n - 1]`` migrates to version ``n``. ``len(MIGRATIONS) == SCHEMA_VERSION``."""

PENDING_MIGRATIONS: list[Migration] = _ALL_MIGRATIONS[SCHEMA_VERSION:]
"""Additive steps written ahead of ``SCHEMA_VERSION`` (``core/types.py``). Until the version
catches up they run on every open, after the versioned ones, only when one of their tables is
missing (``PENDING_TABLES``), and without touching ``meta.schema_version``. Once
``SCHEMA_VERSION`` reaches them they move to ``MIGRATIONS`` by themselves (same functions, still
idempotent on a database that already has the tables)."""

PENDING_TABLES: tuple[str, ...] = PLAYLIST_TABLES if PENDING_MIGRATIONS else ()
"""Tables created by ``PENDING_MIGRATIONS`` (empty once they are versioned)."""


def _read_version(conn: sqlite3.Connection) -> int:
    has_meta = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'"
    ).fetchone()
    if not has_meta:
        return 0
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (META_SCHEMA_VERSION,)).fetchone()
    if row is None or row[0] is None:
        return 0
    try:
        return int(row[0])
    except (TypeError, ValueError):
        raise RuntimeError(f"meta.schema_version unreadable: {row[0]!r}") from None


def _write_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (META_SCHEMA_VERSION, str(version)),
    )


def _migrate(conn: sqlite3.Connection) -> None:
    """Versioned migrations, then the additive steps not versioned yet."""
    _migrate_versioned(conn)
    _apply_pending(conn)


def _missing_tables(conn: sqlite3.Connection, names: Sequence[str]) -> list[str]:
    have = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    return [name for name in names if name not in have]


def _apply_pending(conn: sqlite3.Connection) -> None:
    """``PENDING_MIGRATIONS`` in one ``IMMEDIATE`` transaction, only when a table is missing.
    A database of a newer plugin (version above ``MIGRATIONS``) is left alone."""
    steps = list(PENDING_MIGRATIONS)
    if not steps or not _missing_tables(conn, PENDING_TABLES):
        return  # common path: nothing to do, no write lock
    conn.execute("BEGIN IMMEDIATE")
    try:
        if _read_version(conn) <= len(MIGRATIONS) and _missing_tables(conn, PENDING_TABLES):
            for step in steps:
                log.info("applying additive schema step %s", step.__name__)
                step(conn)
        conn.execute("COMMIT")
    except BaseException:
        _safe_rollback(conn)
        raise


def _migrate_versioned(conn: sqlite3.Connection) -> None:
    """Run pending migrations in one ``IMMEDIATE`` transaction (all or nothing)."""
    migrations = list(MIGRATIONS)
    target = len(migrations)
    if _read_version(conn) == target:
        return  # common path: nothing to do, no write lock
    conn.execute("BEGIN IMMEDIATE")
    try:
        current = _read_version(conn)  # re-read under the lock: another open may have migrated
        if current > target:
            log.warning(
                "database at version %s, code knows up to %s: opening without migrating",
                current,
                target,
            )
        for version in range(current + 1, target + 1):
            log.info("migrating database to version %s", version)
            migrations[version - 1](conn)
            _write_version(conn, version)
        conn.execute("COMMIT")
    except BaseException:
        _safe_rollback(conn)
        raise


def _safe_rollback(conn: sqlite3.Connection) -> None:
    if conn.in_transaction:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:  # pragma: no cover - connection already without a transaction
            log.debug("rollback failed", exc_info=True)


# --------------------------------------------------------------------------------------------
# Connection
# --------------------------------------------------------------------------------------------


def _apply_pragmas(conn: sqlite3.Connection, *, force_wal: bool) -> None:
    current = conn.execute("PRAGMA busy_timeout").fetchone()[0]
    conn.execute(f"PRAGMA busy_timeout={max(int(current or 0), MIN_BUSY_TIMEOUT_MS)}")
    conn.execute("PRAGMA foreign_keys=ON")
    mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0]).lower()
    if force_wal and mode not in ("wal", "memory"):
        mode = str(conn.execute("PRAGMA journal_mode=WAL").fetchone()[0]).lower()
        if mode != "wal":
            log.warning("SQLite recusou journal_mode=WAL (ficou %s)", mode)
    elif mode not in ("wal", "memory"):
        log.warning("database opened without WAL (journal_mode=%s), kept as is", mode)


def _is_lock_error(exc: sqlite3.OperationalError) -> bool:
    msg = str(exc).lower()
    return "locked" in msg or "busy" in msg


def _retry_locked(fn: Callable[[], None], *, total_s: float = SETUP_RETRY_S) -> None:
    """Retry *fn* on ``database is locked``/``busy`` with growing waits up to *total_s*.

    Switching to WAL and recovering the WAL on first open can return ``SQLITE_BUSY`` without
    going through ``busy_timeout`` when several processes open the new file at the same time;
    *fn* must be safe to repeat (``_migrate`` rolls everything back on failure).
    """
    deadline = time.monotonic() + total_s
    delay = 0.01
    while True:
        try:
            fn()
            return
        except sqlite3.OperationalError as exc:
            if not _is_lock_error(exc) or time.monotonic() + delay > deadline:
                raise
            log.debug("database busy while preparing the connection; retrying in %.2fs", delay)
            time.sleep(delay)
            delay = min(delay * 2, 0.25)


def _main_file(conn: sqlite3.Connection) -> str:
    for row in conn.execute("PRAGMA database_list"):
        if row[1] == "main":
            return row[2] or MEMORY
    return MEMORY  # pragma: no cover


class SqliteDb:
    """``Db`` over one ``sqlite3`` connection (see the module docstring)."""

    def __init__(self, conn: sqlite3.Connection, path: str) -> None:
        self._conn: sqlite3.Connection | None = conn
        self._path = path
        self._lock = threading.RLock()
        self._depth = 0  # transaction() depth of the thread holding the lock

    # ---------------------------------------------------------------- Protocol Db

    @property
    def path(self) -> str:
        return self._path

    def query(self, sql: str, params: Params = ()) -> list[Row]:
        with self._locked() as conn:
            cur = conn.execute(sql, _params(params))
            try:
                if cur.description is None:
                    return []
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row, strict=True)) for row in cur.fetchall()]
            finally:
                cur.close()

    def query_one(self, sql: str, params: Params = ()) -> Row | None:
        with self._locked() as conn:
            cur = conn.execute(sql, _params(params))
            try:
                if cur.description is None:
                    return None
                row = cur.fetchone()
                if row is None:
                    return None
                cols = [d[0] for d in cur.description]
                return dict(zip(cols, row, strict=True))
            finally:
                cur.close()

    def execute(self, sql: str, params: Params = ()) -> ExecResult:
        with self._locked() as conn:
            cur = conn.execute(sql, _params(params))
            try:
                return ExecResult(rowcount=cur.rowcount, lastrowid=cur.lastrowid)
            finally:
                cur.close()

    def executemany(self, sql: str, seq: Sequence[Params]) -> int:
        items = [_params(p) for p in seq]
        if not items:
            return 0
        with self.transaction():  # atomic (becomes a SAVEPOINT if a transaction is open)
            conn = self._require()
            cur = conn.executemany(sql, items)
            try:
                return max(cur.rowcount, 0)
            finally:
                cur.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self._locked() as conn:
            depth = self._depth
            savepoint = f"tube_sp_{depth}"
            conn.execute("BEGIN IMMEDIATE" if depth == 0 else f"SAVEPOINT {savepoint}")
            self._depth = depth + 1
            try:
                yield
            except BaseException:
                self._depth = depth
                if depth == 0:
                    _safe_rollback(conn)
                else:
                    try:
                        conn.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                        conn.execute(f"RELEASE SAVEPOINT {savepoint}")
                    except sqlite3.Error:  # SQLite already rolled back the whole transaction
                        log.debug("rollback of savepoint %s failed", savepoint, exc_info=True)
                raise
            self._depth = depth
            if depth == 0:
                try:
                    conn.execute("COMMIT")
                except BaseException:
                    _safe_rollback(conn)
                    raise
            else:
                conn.execute(f"RELEASE SAVEPOINT {savepoint}")

    def close(self) -> None:
        with self._lock:
            conn, self._conn = self._conn, None
            if conn is not None:
                _safe_rollback(conn)
                conn.close()

    # ---------------------------------------------------------------- internals

    def _require(self) -> sqlite3.Connection:
        if self._conn is None:
            raise sqlite3.ProgrammingError("Cannot operate on a closed database.")
        return self._conn

    @contextmanager
    def _locked(self) -> Iterator[sqlite3.Connection]:
        if not self._lock.acquire(timeout=LOCK_TIMEOUT_S):
            raise sqlite3.OperationalError(
                "database is locked (another thread has held a transaction on this Db for "
                f"more than {LOCK_TIMEOUT_S:.0f} s)"
            )
        try:
            yield self._require()
        finally:
            self._lock.release()

    def __repr__(self) -> str:
        state = "closed" if self._conn is None else "open"
        return f"<SqliteDb {self._path!r} {state}>"


def _params(params: Params | None) -> Params:
    if params is None:
        return ()
    if isinstance(params, str | bytes):
        raise TypeError("params must be a sequence or a mapping, not a string")
    return params


def connect(path: str) -> sqlite3.Connection:
    """Raw connection with the plugin's options (no schema). ``:memory:`` is accepted."""
    if path != MEMORY:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(
        path,
        timeout=MIN_BUSY_TIMEOUT_MS / 1000,
        check_same_thread=False,
        isolation_level=None,
    )


def from_connection(conn: sqlite3.Connection, *, force_wal: bool = False) -> SqliteDb:
    """Wrap an already open connection (e.g. Hermes' ``plugin_db``) in a migrated ``Db``.

    Switches to autocommit, ensures ``busy_timeout`` ≥ 5 s and ``foreign_keys=ON`` and runs the
    migrations. ``journal_mode`` is forced to WAL only with *force_wal* (Hermes has its own WAL
    policy, which falls back to ``DELETE`` on network file systems — respected). Closes *conn* on
    failure.
    """
    try:
        if conn.in_transaction:
            conn.commit()
        conn.isolation_level = None
        conn.row_factory = None
        _retry_locked(lambda: _apply_pragmas(conn, force_wal=force_wal))
        _retry_locked(lambda: _migrate(conn))
        path = _main_file(conn)
    except BaseException:
        conn.close()
        raise
    return SqliteDb(conn, path)


def resolve_path(path: str | os.PathLike[str] | None = None) -> str:
    """Explicit *path*, else ``TUBE_DB_PATH``; absolute path (or ``:memory:``)."""
    raw = os.fspath(path) if path is not None else os.environ.get(ENV_DB_PATH, "").strip()
    if not raw:
        raise RuntimeError(
            f"database path missing: pass path=... or set {ENV_DB_PATH} "
            "(inside Hermes use adapters/storage.open_db)"
        )
    if raw == MEMORY:
        return MEMORY
    return str(Path(raw).expanduser().resolve())


def build(*, path: str | None = None) -> Db:
    """Open (creating if needed) the database at *path* or ``TUBE_DB_PATH``, with WAL,
    ``busy_timeout`` ≥ 5 s, ``foreign_keys=ON`` and a migrated schema. No Hermes; no network,
    no thread."""
    target = resolve_path(path)
    return from_connection(connect(target), force_wal=True)


def schema_version(db: Db) -> int:
    """Version stored in ``meta.schema_version`` (0 if missing)."""
    row = db.query_one("SELECT value FROM meta WHERE key = ?", (META_SCHEMA_VERSION,))
    return int(row["value"]) if row and row["value"] is not None else 0


assert len(MIGRATIONS) == SCHEMA_VERSION, "MIGRATIONS out of sync with SCHEMA_VERSION"

__all__ = [
    "ENV_DB_PATH",
    "MIGRATIONS",
    "MIN_BUSY_TIMEOUT_MS",
    "PENDING_MIGRATIONS",
    "PENDING_TABLES",
    "PLAYLISTS_SQL",
    "PLAYLIST_TABLES",
    "SCHEMA_SQL",
    "SqliteDb",
    "build",
    "connect",
    "from_connection",
    "migrate_1",
    "migrate_2",
    "resolve_path",
    "schema_version",
    "split_sql",
]
