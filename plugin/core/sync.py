"""``SyncIngest``: ingestion of what the extension reads on youtube.com. Owns ``watch_history``.

- **Subscriptions** (``ingest_subscriptions``): the whole ``/feed/channels`` list goes through
  ``ChannelService.upsert_many(source=extension, relation=subscribed, actor=extension)`` (dedup and
  transitions live in the channel service; no history entry, it is a sync). Only with
  ``signal=complete`` do absent ``subscribed`` channels become ``ex`` ("cancelled outside the app"),
  via ``ChannelService.set_relation(actor=extension)`` — the channel undo recognises a cancellation
  executed by the queue through that actor. ``partial`` never marks absent channels. Guards: an
  empty list or an item that could not be identified (``unresolved``) makes "absent" unreliable →
  nothing becomes ``ex`` in that batch. Marking happens in a single transaction (all or nothing);
  resending is idempotent.
- **History** (``ingest_watch``): ``INSERT OR IGNORE`` by ``(video_id, watched_at)`` and
  ``VideoStateService.set_state(watched, actor=extension)`` only for new events, in the same
  transaction (failure → nothing written, the extension resends). An invalid video id or a
  negative instant is skipped; a missing/invalid ``channel_id`` comes from ``videos`` when the
  video is known.
- **State** (``ext_state``): ``Refresher.kick_if_due()`` without ``wait`` (the cycle goes to a
  worker thread) and answers right away. Each part that fails (service still a stub, database
  busy) becomes the neutral value with a log line — ``/ext/state`` never fails because of one field.

No network of its own (only ``upsert_many``'s, for items without an id), no thread, no reading the
environment to find the profile/database.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from typing import Any, TypeVar

from tube_pkg.core import dedup, lang
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

REASON_EX = "cancelled outside the app"
"""``reason`` of the ``channel_relation`` written when a ``complete`` sync lacks the channel."""

MAX_ABSENT_FLOOR = 10
MAX_ABSENT_SHARE = 0.20
"""A ``complete`` batch that would mark more than ``MAX_ABSENT_FLOOR`` channels **and** more than
``MAX_ABSENT_SHARE`` of the subscriptions as ``ex`` at once is treated as ``partial``. The list
comes from the YouTube page, which another extension or the page itself can tamper with, and a
half-loaded list looks the same; the marking undoes nothing on YouTube but empties the feed and
the history undo refuses ``actor=extension``. Ten channels keeps small lists and ordinary
clean-ups (a few channels dropped on YouTube between syncs) working; one in five is far above what
people drop between two syncs six hours apart. The channels stay ``subscribed`` until a complete
list under the limits arrives (or the user unsubscribes through the queue)."""

_CHUNK = 500
_R = TypeVar("_R")


def _clean_channel_id(value: Any) -> str | None:
    if isinstance(value, str) and dedup.is_channel_id(value.strip()):
        return value.strip()
    return None


def _placeholders(values: Sequence[Any]) -> str:
    return ",".join("?" for _ in values)


class SyncIngest:
    """``SyncIngest`` implementation over ``watch_history`` and the services."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        channels: T.ChannelService,
        video_state: T.VideoStateService,
        refresher: T.Refresher,
        feed: T.FeedEngine,
        tabs: T.TabService,
        taxonomy: T.TaxonomyService,
        searcher: T.Searcher,
        cleanup: T.Cleanup,
        clock: T.Clock | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.channels = channels
        self.video_state = video_state
        self.refresher = refresher
        self.feed = feed
        self.tabs = tabs
        self.taxonomy = taxonomy
        self.searcher = searcher
        self.cleanup = cleanup
        self.clock = clock or T.SystemClock()

    def _now(self) -> int:
        return int(self.clock.now())

    # ------------------------------------------------------------------ subscriptions

    def ingest_subscriptions(self, device_id: str, batch: T.SubscriptionBatch) -> T.SyncReport:
        signal = T.SyncSignal(batch.signal)
        items = tuple(c for c in batch.channels if isinstance(c, T.ChannelIn))
        report = self.channels.upsert_many(
            items,
            source=T.ChannelSource.extension,
            relation=T.Relation.subscribed,
            actor=T.Actor.extension,
        )
        marked: list[str] = []
        if signal is T.SyncSignal.complete:
            if not items:
                log.warning("empty complete sync from %s: nothing marked as ex", device_id)
            elif report.unresolved:
                log.warning(
                    "complete sync from %s with %d unidentified item(s): nothing marked as ex",
                    device_id,
                    len(report.unresolved),
                )
            else:
                marked = self._mark_absent(items, report, device_id)
                if marked is None:
                    signal = T.SyncSignal.partial
                    marked = []
        return T.SyncReport(
            signal=signal,
            added=tuple(report.inserted),
            updated=tuple(report.updated),
            marked_ex=tuple(marked),
        )

    def _mark_absent(
        self, items: Sequence[T.ChannelIn], report: T.UpsertReport, device_id: str
    ) -> list[str] | None:
        """``subscribed`` outside the batch → ``ex`` in one transaction (all or nothing).

        ``None`` = too many absent at once (see ``MAX_ABSENT_SHARE``): nothing marked, the batch
        counts as ``partial``."""
        present: set[str] = set(report.inserted) | set(report.updated)
        present |= set(report.duplicates.values())
        present |= {cid for c in items if (cid := _clean_channel_id(c.channel_id))}
        rows = self.db.query("SELECT id FROM channels WHERE relation = ?", ("subscribed",))
        absent = sorted(r["id"] for r in rows if r["id"] not in present)
        if not absent:
            return []
        if len(absent) > MAX_ABSENT_FLOOR and len(absent) > MAX_ABSENT_SHARE * len(rows):
            log.warning(
                "complete sync from %s would mark %d of %d subscriptions as ex: treated as partial"
                " (limit: more than %d and more than %d%%)",
                device_id,
                len(absent),
                len(rows),
                MAX_ABSENT_FLOOR,
                int(MAX_ABSENT_SHARE * 100),
            )
            return None
        marked: list[str] = []
        with self.db.transaction():
            for channel_id in absent:
                ch = self.channels.set_relation(
                    channel_id, T.Relation.ex, actor=T.Actor.extension, reason=REASON_EX
                )
                if ch.relation is T.Relation.ex:
                    marked.append(channel_id)
        return marked

    # ------------------------------------------------------------------ history

    def ingest_watch(self, device_id: str, events: Sequence[T.WatchEvent]) -> int:
        clean: list[tuple[str, str | None, int]] = []
        for e in events:
            if not isinstance(e, T.WatchEvent) or not dedup.is_video_id(e.video_id):
                continue
            if isinstance(e.watched_at, bool) or not isinstance(e.watched_at, int):
                continue
            if e.watched_at < 0:
                continue
            clean.append((e.video_id, _clean_channel_id(e.channel_id), e.watched_at))
        if not clean:
            return 0
        owners = self._video_owners([v for v, ch, _ in clean if ch is None])
        new_ids: list[str] = []
        with self.db.transaction():
            for video_id, channel_id, watched_at in clean:
                res = self.db.execute(
                    "INSERT OR IGNORE INTO watch_history"
                    " (video_id, channel_id, watched_at, device_id) VALUES (?, ?, ?, ?)",
                    (video_id, channel_id or owners.get(video_id), watched_at, device_id),
                )
                if res.rowcount:
                    new_ids.append(video_id)
            if new_ids:
                self._mark_watched(list(dict.fromkeys(new_ids)))
        return len(new_ids)

    def _video_owners(self, video_ids: Sequence[str]) -> dict[str, str]:
        ids = list(dict.fromkeys(video_ids))
        out: dict[str, str] = {}
        for i in range(0, len(ids), _CHUNK):
            chunk = ids[i : i + _CHUNK]
            rows = self.db.query(
                f"SELECT id, channel_id FROM videos WHERE id IN ({_placeholders(chunk)})",
                tuple(chunk),
            )
            out.update({r["id"]: r["channel_id"] for r in rows if r["channel_id"]})
        return out

    def _mark_watched(self, video_ids: list[str]) -> None:
        try:
            self.video_state.set_state(video_ids, T.VideoState.watched, actor=T.Actor.extension)
        except NotImplementedError:
            # VideoStateService still a stub in the wiring: the history (main data) stays
            log.warning(
                "video_state unavailable (stub): %d video(s) without 'watched'", len(video_ids)
            )

    # ------------------------------------------------------------------ state

    def _safe(self, what: str, fn: Callable[[], _R], default: _R) -> _R:
        try:
            return fn()
        except Exception:  # noqa: BLE001 — /ext/state always answers
            log.warning("ext_state: %s unavailable", what, exc_info=True)
            return default

    def _snapshot(self) -> T.SettingsSnapshot:
        try:
            return self.settings.snapshot()
        except Exception:  # noqa: BLE001
            log.warning("ext_state: settings unavailable; using defaults", exc_info=True)
            return T.SettingsSnapshot()

    def ext_state(self, device_id: str | None = None) -> T.ExtState:
        self._safe("kick_if_due", lambda: self.refresher.kick_if_due(), None)
        counts = self._safe("new_counts", self.feed.new_counts, T.NewCounts())
        by_tab = counts.by_tab or {}
        by_folder = counts.by_folder or {}
        tabs = self._safe("tabs", self.tabs.list, [])
        folders = self._safe("folders", self.taxonomy.list_folders, [])
        snap = self._snapshot()
        return T.ExtState(
            new_total=int(counts.total or 0),
            tabs=tuple(
                T.TabCount(tab_id=t.id, name=t.name, icon=t.icon, count=int(by_tab.get(t.id, 0)))
                for t in tabs
            ),
            folders=tuple(
                T.FolderCount(
                    folder_id=f.id,
                    name=f.name,
                    parent_id=f.parent_id,
                    count=int(by_folder.get(f.id, 0)),
                )
                for f in folders
            ),
            search_pending=int(self._safe("search_pending", self.searcher.pending_count, 0)),
            queue_pending=len(self._safe("queue_pending", self.cleanup.queue_pending, [])),
            home_on_youtube=bool(snap.home_on_youtube),
            extras_honest_thumbnails=bool(snap.extras_honest_thumbnails),
            extras_hn_lens=bool(snap.extras_hn_lens),
            extras_hn_channels=bool(snap.extras_hn_channels),
            extras_import_lists=bool(snap.extras_import_lists),
            refresh_running=bool(self._safe("is_running", self.refresher.is_running, False)),
            last_rss_at=self._safe("last_rss_at", self.refresher.last_rss_at, None),
            # Resolved (plugin setting → Hermes display.language → English), never the raw
            # "auto": otherwise the extension falls back to the browser and ignores Hermes.
            language=self._safe("language", lambda: lang.resolve(self.settings), lang.DEFAULT),
            device_id=device_id,
            server_time=self._now(),
        )


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    channels: T.ChannelService,
    video_state: T.VideoStateService,
    refresher: T.Refresher,
    feed: T.FeedEngine,
    tabs: T.TabService,
    taxonomy: T.TaxonomyService,
    searcher: T.Searcher,
    cleanup: T.Cleanup,
    clock: T.Clock | None = None,
) -> T.SyncIngest:
    """``SyncIngest`` with the ``Db`` already resolved. No network, no thread."""
    return SyncIngest(
        db=db,
        settings=settings,
        channels=channels,
        video_state=video_state,
        refresher=refresher,
        feed=feed,
        tabs=tabs,
        taxonomy=taxonomy,
        searcher=searcher,
        cleanup=cleanup,
        clock=clock,
    )


__all__ = ["REASON_EX", "SyncIngest", "build"]
