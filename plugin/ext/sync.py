"""Extension handlers of ``plugin/ext/sync.py``.

Mounted by ``_mount.py`` via ``wiring.ext_handlers``; dependencies by name (``x-deps``). Pure
functions: never read the environment to find the profile or database.

- ``sync_subscriptions`` (``POST /ext/sync/subscriptions``): body ``SubscriptionBatchBody``
  (``{channels: ChannelIn[] ≤ 5000, signal: complete|partial}``) →
  ``SyncIngest.ingest_subscriptions`` → ``SyncReport``. Any malformed item refuses the **whole**
  batch (``invalid``): skipping an item in a ``complete`` batch would turn its channel into
  ``ex``. Channel ``url``/``thumb`` outside YouTube are dropped (set to null), not refused.
  Every accepted read of the list (``complete``, or ``partial`` with at least one channel) stores
  its instant in ``meta`` (``META_LAST_SUBSCRIPTION_READ``, UTC seconds); ``GET /status`` exposes
  it as ``ext_last_sync_at`` (``last_subscription_read``). A re-pairing that brings the same
  channels leaves the total unchanged but still moves this instant, so the welcome dialog can
  tell that the read finished. Recording never fails the sync (logged and skipped).
- ``sync_watch`` (``POST /ext/sync/watch``): body ``WatchBatchBody`` (``{events: WatchEvent[]
  1..500}``) → ``SyncIngest.ingest_watch`` → ``{count}`` (new events; a resend = 0).

Errors become envelopes here (the mount sets the status from ``ERROR_HTTP_STATUS``), so the
handler can be called directly without raising.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import types as T
from tube_pkg.core.importers import safe_channel_url, safe_thumb_url

log = logging.getLogger(__name__)

META_LAST_SUBSCRIPTION_READ = "ext_last_sync_at"
"""``meta`` key: UTC seconds of the last subscription read accepted from the extension."""

MAX_CHANNELS = 5000
MAX_EVENTS = 500
_OPT_TEXT = ("channel_id", "handle", "url", "thumb", "folder_id")


class _Invalid(Exception):
    pass


def _opt_str(item: Mapping[str, Any], key: str, where: str) -> str | None:
    value = item.get(key)
    if value is not None and not isinstance(value, str):
        raise _Invalid(f"{where}.{key}: expected text or null")
    return value


def _channel_in(raw: Any, where: str) -> T.ChannelIn:
    if not isinstance(raw, Mapping):
        raise _Invalid(f"{where}: expected an object")
    title = raw.get("title")
    if not isinstance(title, str):
        raise _Invalid(f"{where}.title: required (text)")
    text = {k: _opt_str(raw, k, where) for k in _OPT_TEXT}
    # links and images only to YouTube: a non-YouTube value is dropped, not refused (refusing
    # would fail the whole batch, and a "complete" batch must stay whole)
    text["url"] = safe_channel_url(text["url"])
    text["thumb"] = safe_thumb_url(text["thumb"])
    tag_ids = raw.get("tag_ids", [])
    if tag_ids is None:
        tag_ids = []
    if not isinstance(tag_ids, list) or not all(isinstance(t, str) for t in tag_ids):
        raise _Invalid(f"{where}.tag_ids: expected a list of texts")
    favorite = raw.get("favorite")
    if favorite is not None and not isinstance(favorite, bool):
        raise _Invalid(f"{where}.favorite: expected a boolean or null")
    return T.ChannelIn(title=title, tag_ids=tuple(tag_ids), favorite=favorite, **text)


def _subscription_batch(body: Mapping[str, Any] | None) -> T.SubscriptionBatch:
    if not isinstance(body, Mapping):
        raise _Invalid("the body must be {channels, signal}")
    try:
        signal = T.SyncSignal(body.get("signal"))
    except ValueError as exc:
        raise _Invalid("signal must be complete or partial") from exc
    channels = body.get("channels")
    if not isinstance(channels, list):
        raise _Invalid("channels must be a list")
    if len(channels) > MAX_CHANNELS:
        raise _Invalid(f"channels: at most {MAX_CHANNELS}")
    items = tuple(_channel_in(c, f"channels[{i}]") for i, c in enumerate(channels))
    return T.SubscriptionBatch(channels=items, signal=signal)


def _watch_event(raw: Any, where: str) -> T.WatchEvent:
    if not isinstance(raw, Mapping):
        raise _Invalid(f"{where}: expected an object")
    video_id = raw.get("video_id")
    if not isinstance(video_id, str):
        raise _Invalid(f"{where}.video_id: required (text)")
    watched_at = raw.get("watched_at")
    if isinstance(watched_at, bool) or not isinstance(watched_at, int):
        raise _Invalid(f"{where}.watched_at: required (integer, UTC seconds)")
    channel_id = _opt_str(raw, "channel_id", where)
    return T.WatchEvent(video_id=video_id, watched_at=watched_at, channel_id=channel_id)


def _watch_events(body: Mapping[str, Any] | None) -> list[T.WatchEvent]:
    if not isinstance(body, Mapping):
        raise _Invalid("the body must be {events}")
    events = body.get("events")
    if not isinstance(events, list) or not events:
        raise _Invalid("events must be a non-empty list")
    if len(events) > MAX_EVENTS:
        raise _Invalid(f"events: at most {MAX_EVENTS}")
    return [_watch_event(e, f"events[{i}]") for i, e in enumerate(events)]


def last_subscription_read(db: T.Db) -> int | None:
    """UTC seconds of the last accepted subscription read (``None`` = never, or unreadable)."""
    row = db.query_one("SELECT value FROM meta WHERE key = ?", (META_LAST_SUBSCRIPTION_READ,))
    if row is None:
        return None
    try:
        return int(row["value"])
    except (TypeError, ValueError):
        log.warning("meta.%s unreadable; treated as unknown", META_LAST_SUBSCRIPTION_READ)
        return None


def _record_read(sync: Any, batch: T.SubscriptionBatch) -> None:
    """Store the instant of an accepted read. An empty ``partial`` batch (logged out, scrolling
    stopped before the first item) proves nothing and is not recorded. Never raises."""
    if batch.signal is not T.SyncSignal.complete and not batch.channels:
        return
    try:
        db = sync.db
        clock = getattr(sync, "clock", None)
        now = int(clock.now()) if clock is not None else int(time.time())
        db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (META_LAST_SUBSCRIPTION_READ, str(now)),
        )
    except Exception:  # noqa: BLE001 — the read itself was already ingested
        log.warning("could not record the subscription read instant", exc_info=True)


@contract.real
def sync_subscriptions(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    sync: T.SyncIngest,
) -> Envelope:
    """POST /ext/sync/subscriptions.

    Subscriptions read from /feed/channels (whole list, signal complete|partial)
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    try:
        batch = _subscription_batch(body)
    except _Invalid as exc:
        return fail("invalid", str(exc))
    try:
        report = sync.ingest_subscriptions(device.id, batch)
    except T.TubeError as exc:
        return error_envelope(exc)
    _record_read(sync, batch)
    return ok(report)


@contract.real
def sync_watch(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    sync: T.SyncIngest,
) -> Envelope:
    """POST /ext/sync/watch.

    Watch history in batches (watched > 60% or > 4 min)
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    try:
        events = _watch_events(body)
    except _Invalid as exc:
        return fail("invalid", str(exc))
    try:
        count = sync.ingest_watch(device.id, events)
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok({"count": int(count)})
