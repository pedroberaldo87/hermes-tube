"""Local playlists: the person's own lists of videos, kept in the plugin database.

They live only on this machine (like "Watch later") and are **never** written to the YouTube
account: no network here. Owner of the ``playlists`` and ``playlist_items`` tables (created by
``core/db.migrate_2``; ``build`` also creates them on a ``Db`` that did not go through
``core/db``, e.g. the test ``MemDb``).

Rules
    - a name is trimmed, 1–``MAX_NAME_LEN`` characters, unique ignoring case and accents;
    - at most ``MAX_PLAYLISTS`` playlists and ``MAX_ITEMS`` videos per playlist (``Conflict``);
    - a video is at most once in a playlist (adding it again changes nothing) and may be in many;
    - deleting a playlist removes its items, never a video;
    - order = ``position``; new videos go to the end; ``reorder`` moves the given videos to the
      front, in the given order, and keeps the others after them in their relative order.
"""

from __future__ import annotations

import re
import threading
import unicodedata
import uuid
import weakref
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from tube_pkg.core import types as T
from tube_pkg.core.db import PLAYLIST_TABLES, PLAYLISTS_SQL, split_sql

MAX_NAME_LEN = 80
MAX_PLAYLISTS = 200
MAX_ITEMS = 5000
MAX_OPTIONS = 25
"""Names listed in a ``NotFound`` from ``find``."""

_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
_CHUNK = 500


@dataclass(frozen=True, slots=True)
class Playlist:
    """A playlist as the surfaces see it."""

    id: str
    name: str
    count: int = 0
    first_video_id: str | None = None
    """First video in play order (the list's thumbnail); ``None`` when empty."""
    created_at: T.Timestamp = 0
    updated_at: T.Timestamp = 0


def norm_name(text: Any) -> str:
    """Name comparison: no accents, no case, collapsed spaces."""
    raw = unicodedata.normalize("NFKD", str(text or ""))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return " ".join(raw.casefold().split())


def clean_name(value: Any) -> str:
    """A valid playlist name (trimmed) or ``ValidationError``."""
    if not isinstance(value, str):
        raise T.ValidationError("name: expected a string", field="name")
    name = " ".join(value.split())
    if not name:
        raise T.ValidationError("name: required", field="name")
    if len(name) > MAX_NAME_LEN:
        raise T.ValidationError(f"name: at most {MAX_NAME_LEN} characters", field="name")
    return name


def clean_video_ids(values: Any, *, field: str = "video_ids") -> list[str]:
    """Distinct video ids, in the given order; non-empty; each 11 characters."""
    if not isinstance(values, list | tuple) or not values:
        raise T.ValidationError(f"{field}: a non-empty list of video ids", field=field)
    out: list[str] = []
    for value in values:
        if not isinstance(value, str) or not _VIDEO_ID.fullmatch(value):
            raise T.ValidationError(
                f"{field}: {str(value)[:20]!r} is not a YouTube video id", field=field
            )
        out.append(value)
    return list(dict.fromkeys(out))


def _marks(n: int) -> str:
    return ",".join("?" for _ in range(n))


def _chunks(values: Sequence[str]) -> Iterable[list[str]]:
    for start in range(0, len(values), _CHUNK):
        yield list(values[start : start + _CHUNK])


_READY: weakref.WeakSet[Any] = weakref.WeakSet()
_READY_LOCK = threading.Lock()


def ensure_schema(db: T.Db) -> None:
    """Create the playlist tables when missing (idempotent; checked once per ``Db`` object)."""
    with _READY_LOCK:
        try:
            if db in _READY:
                return
        except TypeError:  # pragma: no cover - a Db that cannot be weakly referenced
            pass
    rows = db.query("SELECT name FROM sqlite_master WHERE type = 'table'")
    have = {r["name"] for r in rows}
    if not all(name in have for name in PLAYLIST_TABLES):
        with db.transaction():
            for statement in split_sql(PLAYLISTS_SQL):
                db.execute(statement)
    with _READY_LOCK:
        try:
            _READY.add(db)
        except TypeError:  # pragma: no cover
            pass


_SUMMARY_SQL = (
    "SELECT p.id, p.name, p.created_at, p.updated_at,"
    " (SELECT count(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS count,"
    " (SELECT i.video_id FROM playlist_items i WHERE i.playlist_id = p.id"
    "  ORDER BY i.position, i.added_at LIMIT 1) AS first_video_id"
    " FROM playlists p"
)


def _playlist(row: T.Row) -> Playlist:
    return Playlist(
        id=str(row["id"]),
        name=str(row["name"]),
        count=int(row["count"] or 0),
        first_video_id=row["first_video_id"],
        created_at=int(row["created_at"]),
        updated_at=int(row["updated_at"]),
    )


class PlaylistService:
    """CRUD of the local playlists over one ``Db`` (no network, no thread)."""

    def __init__(self, *, db: T.Db, clock: T.Clock | None = None) -> None:
        self.db = db
        self.clock = clock or T.SystemClock()
        ensure_schema(db)

    # ---------------------------------------------------------------- reads

    def list(self) -> list[Playlist]:
        """All playlists, most recently changed first."""
        rows = self.db.query(f"{_SUMMARY_SQL} ORDER BY p.updated_at DESC, p.created_at DESC, p.id")
        return [_playlist(r) for r in rows]

    def get(self, playlist_id: str) -> Playlist:
        row = self.db.query_one(f"{_SUMMARY_SQL} WHERE p.id = ?", (str(playlist_id),))
        if row is None:
            raise T.NotFound("This playlist does not exist (it may have been deleted).")
        return _playlist(row)

    def find(self, ref: str) -> Playlist:
        """By id, else by name (ignoring case and accents). ``NotFound`` lists the names."""
        text = str(ref or "").strip()
        row = self.db.query_one(f"{_SUMMARY_SQL} WHERE p.id = ?", (text,))
        if row is not None:
            return _playlist(row)
        everything = self.list()
        wanted = norm_name(text)
        for p in everything:
            if norm_name(p.name) == wanted:
                return p
        names = sorted((p.name for p in everything), key=norm_name)[:MAX_OPTIONS]
        raise T.NotFound(f"There is no playlist called {text[:60]!r}.", options=names)

    def item_ids(self, playlist_id: str) -> list[str]:
        """Video ids of the playlist, in play order."""
        self._require(playlist_id)
        rows = self.db.query(
            "SELECT video_id FROM playlist_items WHERE playlist_id = ?"
            " ORDER BY position, added_at, video_id",
            (playlist_id,),
        )
        return [r["video_id"] for r in rows]

    def member_of(self, video_id: str) -> list[str]:
        """Ids of the playlists that hold *video_id* (most recently changed first)."""
        rows = self.db.query(
            "SELECT p.id FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id"
            " WHERE i.video_id = ? ORDER BY p.updated_at DESC, p.created_at DESC, p.id",
            (str(video_id),),
        )
        return [r["id"] for r in rows]

    # ---------------------------------------------------------------- writes

    def create(self, name: str, video_ids: Sequence[str] = ()) -> Playlist:
        clean = clean_name(name)
        ids = clean_video_ids(list(video_ids)) if video_ids else []
        now = int(self.clock.now())
        playlist_id = f"pl_{uuid.uuid4().hex[:12]}"
        with self.db.transaction():
            row = self.db.query_one("SELECT count(*) AS n FROM playlists")
            if int(row["n"] if row else 0) >= MAX_PLAYLISTS:
                raise T.Conflict(
                    f"You already have {MAX_PLAYLISTS} playlists, the most this app keeps. "
                    "Delete one to make room."
                )
            self._check_unique(clean)
            self.db.execute(
                "INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (playlist_id, clean, now, now),
            )
            if ids:
                self._append(playlist_id, ids, now)
        return self.get(playlist_id)

    def rename(self, playlist_id: str, name: str) -> Playlist:
        clean = clean_name(name)
        with self.db.transaction():
            self._require(playlist_id)
            self._check_unique(clean, except_id=playlist_id)
            self.db.execute(
                "UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?",
                (clean, int(self.clock.now()), playlist_id),
            )
        return self.get(playlist_id)

    def delete(self, playlist_id: str) -> None:
        with self.db.transaction():
            self._require(playlist_id)
            self.db.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
            self.db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))

    def add(self, playlist_id: str, video_ids: Sequence[str]) -> int:
        """Append the videos not in the playlist yet; returns how many were added."""
        ids = clean_video_ids(list(video_ids))
        now = int(self.clock.now())
        with self.db.transaction():
            self._require(playlist_id)
            added = self._append(playlist_id, ids, now)
            if added:
                self._touch(playlist_id, now)
        return added

    def remove(self, playlist_id: str, video_ids: Sequence[str]) -> int:
        """Take the videos out of the playlist (never out of the library); returns how many."""
        ids = clean_video_ids(list(video_ids))
        removed = 0
        with self.db.transaction():
            self._require(playlist_id)
            for part in _chunks(ids):
                res = self.db.execute(
                    f"DELETE FROM playlist_items WHERE playlist_id = ? AND video_id IN"
                    f" ({_marks(len(part))})",
                    (playlist_id, *part),
                )
                removed += max(int(res.rowcount or 0), 0)
            if removed:
                self._touch(playlist_id, int(self.clock.now()))
        return removed

    def reorder(self, playlist_id: str, video_ids: Sequence[str]) -> int:
        """The given videos first, in that order; the others after, as they were. Returns the
        playlist size. A video that is not in the playlist → ``ValidationError``."""
        ids = clean_video_ids(list(video_ids), field="ids")
        with self.db.transaction():
            current = self.item_ids(playlist_id)
            present = set(current)
            stray = [v for v in ids if v not in present]
            if stray:
                raise T.ValidationError(
                    f"ids: {stray[0]} is not in this playlist", field="ids", missing=stray[:20]
                )
            wanted = set(ids)
            order = [*ids, *(v for v in current if v not in wanted)]
            self.db.executemany(
                "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND video_id = ?",
                [(i, playlist_id, v) for i, v in enumerate(order)],
            )
            self._touch(playlist_id, int(self.clock.now()))
        return len(order)

    # ---------------------------------------------------------------- internals

    def _require(self, playlist_id: str) -> None:
        row = self.db.query_one("SELECT 1 AS x FROM playlists WHERE id = ?", (str(playlist_id),))
        if row is None:
            raise T.NotFound("This playlist does not exist (it may have been deleted).")

    def _check_unique(self, name: str, *, except_id: str | None = None) -> None:
        wanted = norm_name(name)
        for row in self.db.query("SELECT id, name FROM playlists"):
            if row["id"] != except_id and norm_name(row["name"]) == wanted:
                raise T.Conflict(f"A playlist called {row['name']!r} already exists.")

    def _touch(self, playlist_id: str, now: int) -> None:
        self.db.execute("UPDATE playlists SET updated_at = ? WHERE id = ?", (now, playlist_id))

    def _append(self, playlist_id: str, ids: Sequence[str], now: int) -> int:
        """Inside a transaction: add what is missing at the end, within ``MAX_ITEMS``."""
        have: set[str] = set()
        for part in _chunks(list(ids)):
            rows = self.db.query(
                f"SELECT video_id FROM playlist_items WHERE playlist_id = ? AND video_id IN"
                f" ({_marks(len(part))})",
                (playlist_id, *part),
            )
            have.update(r["video_id"] for r in rows)
        fresh = [v for v in ids if v not in have]
        if not fresh:
            return 0
        row = self.db.query_one(
            "SELECT count(*) AS n, coalesce(max(position), -1) AS last FROM playlist_items"
            " WHERE playlist_id = ?",
            (playlist_id,),
        )
        count = int(row["n"]) if row else 0
        last = int(row["last"]) if row else -1
        if count + len(fresh) > MAX_ITEMS:
            raise T.Conflict(
                f"A playlist holds at most {MAX_ITEMS} videos; this one has {count}. "
                "Remove some or start another playlist."
            )
        self.db.executemany(
            "INSERT INTO playlist_items (playlist_id, video_id, position, added_at)"
            " VALUES (?, ?, ?, ?)",
            [(playlist_id, v, last + 1 + i, now) for i, v in enumerate(fresh)],
        )
        return len(fresh)


def build(*, db: T.Db, clock: T.Clock | None = None) -> PlaylistService:
    """Stores the dependencies and makes sure the tables exist (no network, no thread)."""
    return PlaylistService(db=db, clock=clock)


__all__ = [
    "MAX_ITEMS",
    "MAX_NAME_LEN",
    "MAX_PLAYLISTS",
    "Playlist",
    "PlaylistService",
    "build",
    "clean_name",
    "clean_video_ids",
    "ensure_schema",
    "norm_name",
]
