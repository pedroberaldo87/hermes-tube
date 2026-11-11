"""REST route of ``plugin/api/status.py``: ``GET /status``.

The Desktop polls every ≤ 5 s while the window is visible; the answer has to come out in
milliseconds even with an RSS cycle running and with SQLite busy in another process. That is why
the route does **no** database work on its own thread:

1. resolves the ``Refresher`` in the request context (the right profile);
2. fires two single tasks per profile (``api.refresh.run_once``, daemon threads with the copied
   context):

   - **extension server** — ``wiring.ensure_ext_server(role="host")`` (on demand, here and in
     ``pair.start``/``tube_status``; never in ``register()``). It may wait up to ~1.5 s for
     another owner's lock: that is why it stays off the answer path.
   - **read** — ``Refresher.kick_if_due()`` (non-blocking: only checks/takes the lock and starts
     the cycle thread), ``Refresher.channel_totals()`` (``channels_total`` and
     ``subscribed_total``, one query) and right after ``Refresher.status()``. If ``status()``
     fails, the cheap fields (``last_rss_at``, ``refresh_running``, RSS outage) are read one by
     one. ``Refresher.details_pending()`` → ``details_pending`` (videos still without a duration
     or type that the background lookup will request; absent when the lookup is turned off).
     ``ext_last_sync_at`` = instant of the last subscription read the extension delivered
     (``ext.sync.last_subscription_read`` on the Refresher's ``db``; ``null`` = never; absent when
     the Refresher has no ``db``).

3. waits for both at most ``STATUS_WAIT_S`` and builds the answer **field by field**: what
   arrived now, else the last known value for this profile, else the default
   (zero/``null``/``false``). A task that did not finish carries on alone and updates the cache
   for the next poll; a new poll does not pile up threads (it reuses the running task).

Never raises: any failure becomes a degraded field (``ok: true``). ``x-errors: []``.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.api.refresh import profile_key, run_once
from tube_pkg.core import types as T
from tube_pkg.ext.sync import last_subscription_read

log = logging.getLogger(__name__)

STATUS_WAIT_S = 0.035
"""Total budget the route waits for the tasks (the whole answer stays < 50 ms)."""

STATUS_COLD_WAIT_S = 1.0
"""First poll of the process (nothing known yet): wait this long for the read, so as not to answer
zero counts that the screen would show as "0 new"."""

ENSURE_ROLE = "host"
"""``GET /status`` is REST: it runs in the plugin host, like ``POST /pair/start``."""

DEFAULTS: dict[str, Any] = {
    "new_total": 0,
    "new_by_tab": [],
    "fav_new": [],
    "ext_endpoint_up": False,
    "last_rss_at": None,
    "refresh_running": False,
    "queue_pending": 0,
    "search_pending": 0,
    "devices_online": 0,
    "ext_port": None,
    "rss_down_since": None,
    "rss_fallback_channels": 0,
}
"""Value of each ``StatusResponse`` field when nothing is known yet (contract shape)."""

OPTIONAL_FIELDS: tuple[str, ...] = (
    "channels_total",
    "subscribed_total",
    "details_pending",
    "ext_last_sync_at",
)
"""Optional ``StatusResponse`` fields (``Refresher.channel_totals``,
``Refresher.details_pending``): only sent when known — "don't know" never becomes 0 (Home would
decide on the welcome screen from a false zero). ``ext_last_sync_at`` may be ``null`` (known: no
read yet)."""

_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_MX = threading.Lock()


def reset() -> None:
    """Forget the last known values (tests)."""
    with _CACHE_MX:
        _CACHE.clear()


def _remember(key: str, fields: Mapping[str, Any]) -> None:
    with _CACHE_MX:
        _CACHE.setdefault(key, {}).update(fields)


def _known(key: str) -> dict[str, Any]:
    with _CACHE_MX:
        return dict(_CACHE.get(key, {}))


def _try(name: str, fn: Callable[[], Any]) -> tuple[bool, Any]:
    try:
        return True, fn()
    except Exception:  # noqa: BLE001 — degraded field, never 500
        log.exception("GET /status: %s failed", name)
        return False, None


def _read_fields(refresher: Any) -> dict[str, Any]:
    """Read task: kicks the overdue RSS and reads the ``StatusSnapshot`` (or the cheap fields,
    one by one, if the snapshot fails)."""
    _try("kick_if_due", refresher.kick_if_due)
    fields: dict[str, Any] = {}
    totals_fn = getattr(refresher, "channel_totals", None)
    if callable(totals_fn):
        good, totals = _try("channel_totals", totals_fn)
        if good and isinstance(totals, Mapping):
            fields.update(
                {k: int(totals[k]) for k in OPTIONAL_FIELDS if isinstance(totals.get(k), int)}
            )
    pending_fn = getattr(refresher, "details_pending", None)
    if callable(pending_fn):
        good, pending = _try("details_pending", pending_fn)
        if good and isinstance(pending, int) and not isinstance(pending, bool):
            fields["details_pending"] = max(pending, 0)
    db = getattr(refresher, "db", None)
    if db is not None:
        good, last_read = _try("ext_last_sync_at", lambda: last_subscription_read(db))
        if good:
            fields["ext_last_sync_at"] = last_read
    good, snap = _try("status", refresher.status)
    if good and isinstance(snap, T.StatusSnapshot):
        fields.update(T.to_jsonable(snap))
        fields.pop("ext_port", None)  # the port comes from ensure
        return fields
    good, value = _try("last_rss_at", refresher.last_rss_at)
    if good:
        fields["last_rss_at"] = value
    good, value = _try("is_running", refresher.is_running)
    if good:
        fields["refresh_running"] = bool(value)
    outage_fn = getattr(refresher, "rss_outage", None)
    if callable(outage_fn):
        good, outage = _try("rss_outage", outage_fn)
        if good:
            outage = outage or {}
            fields["rss_down_since"] = outage.get("down_since")
            fields["rss_fallback_channels"] = int(outage.get("fallback_channels") or 0)
    return fields


def _ensure_fields() -> dict[str, Any]:
    port = wiring.ensure_ext_server(role=ENSURE_ROLE)
    port = int(port) if port else None
    return {"ext_port": port, "ext_endpoint_up": port is not None}


@contract.real
def get_status(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /status.

    Counters for the chip, dashboard and mascot; starts the extension server and fires an
    overdue RSS (without waiting for the cycle; degrades field by field, never an error).
    """
    key = profile_key()
    cold = "new_total" not in _known(key)
    deadline = time.monotonic() + STATUS_WAIT_S
    read_deadline = time.monotonic() + (STATUS_COLD_WAIT_S if cold else STATUS_WAIT_S)
    try:
        refresher = wiring.get_refresher()
    except Exception:  # noqa: BLE001
        log.exception("GET /status: Refresher unavailable")
        refresher = None

    def ensure_task() -> dict[str, Any]:
        fields = _ensure_fields()
        _remember(key, fields)
        return fields

    ensure = run_once(("status-ensure", key), ensure_task, name="tube-status-ensure")
    read = None
    if refresher is not None:

        def read_task() -> dict[str, Any]:
            fields = _read_fields(refresher)
            _remember(key, fields)
            return fields

        read = run_once(("status-read", key, id(refresher)), read_task, name="tube-status-read")

    if read is not None:
        read.wait(read_deadline - time.monotonic())
    ensure.wait(max(0.0, deadline - time.monotonic()))

    data = dict(DEFAULTS)
    data.update({k: v for k, v in _known(key).items() if k in DEFAULTS or k in OPTIONAL_FIELDS})
    if read is not None:
        data.update(read.result({}) or {})
    ensure_now = ensure.result(None)
    if ensure_now is not None:
        data.update(ensure_now)
    elif ensure.done.is_set():  # ensure just broke: no port
        data.update({"ext_port": None, "ext_endpoint_up": False})
    return ok(data)


__all__ = [
    "DEFAULTS",
    "ENSURE_ROLE",
    "OPTIONAL_FIELDS",
    "STATUS_COLD_WAIT_S",
    "STATUS_WAIT_S",
    "get_status",
    "reset",
]
