"""``/ext/queue`` handlers: the extension runs the unsubscribe/resubscribe queue.

Mounted by ``_mount.py`` via ``wiring.ext_handlers``; dependencies by name (``x-deps``). Pure
functions: no environment variable and no ``get_hermes_home()``.

- ``GET /ext/queue`` — **one** item at a time, only ``approved`` with ``approved_via`` (human
  approval), oldest first, lent to the device that asked (``Cleanup.claim_next``): another device
  does not get the same item. The channel goes along with its ``url`` (the ``/channel/<id>`` page
  if the database has none) for the extension to open. Cleanup candidates and items that were not
  approved never leave. The extension navigates by ``channel_id`` and checks the channel on the
  page before clicking. ``?peek=1`` lists every approved item (oldest first, up to ``PEEK_MAX``)
  **without lending** any: the extension shows that list and runs only the ids the user releases
  with a click ("Run now").
- ``POST /ext/queue/{id}/result`` — ``{status: running|done|failed, error?}`` →
  ``Cleanup.queue_result(..., device_id=<device>)``. ``done`` of ``unsubscribe`` → channel ``ex``
  (``actor=extension``); of ``resubscribe`` → ``subscribed``. Repeated = idempotent; an undone item
  or one lent to another device → ``conflict`` (the extension skips it).
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import types as T

PEEK_MAX = 100
"""Items listed by ``GET /ext/queue?peek=1`` (the extension lists the same number)."""
_RESULT_STATUSES = ("running", "done", "failed")
_RESULT_KEYS = frozenset({"status", "error"})
ERROR_MAX = 2000


def _channel_url(channel: T.Channel) -> T.Channel:
    if channel.url:
        return channel
    return dataclasses.replace(channel, url=f"https://www.youtube.com/channel/{channel.id}")


def _next_item(cleanup: T.Cleanup, device_id: str) -> T.QueueItem | None:
    claim = getattr(cleanup, "claim_next", None)
    if callable(claim):
        return claim(device_id)
    # adapter (Cleanup without per-device lending): the oldest approved item, not reserved
    pending = [i for i in cleanup.queue_pending() if i.status is T.QueueStatus.approved]
    return pending[0] if pending else None


def _human(item: T.QueueItem) -> bool:
    return (
        item.status is T.QueueStatus.approved
        and item.approved_via in T.HUMAN_APPROVAL_VIAS
        and bool(item.approved_at)
    )


def _peek(cleanup: T.Cleanup, channels: T.ChannelService) -> dict[str, Any]:
    """Every approved item, oldest first (at most ``PEEK_MAX``), **without lending** any of them.

    The extension shows this list and runs a round only after the user clicks "Run now" for
    these ids.
    """
    items = [i for i in cleanup.queue_pending() if _human(i)][:PEEK_MAX]
    found: dict[str, T.Channel] = {}
    for item in items:
        if item.channel_id in found:
            continue
        channel = channels.get(item.channel_id)
        if channel is not None:
            found[channel.id] = _channel_url(channel)
    return {"items": items, "channels": found}


@contract.real
def get_queue(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    cleanup: T.Cleanup,
    channels: T.ChannelService,
) -> Envelope:
    """GET /ext/queue.

    Approved items to run (only approved with approved_via)
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    try:
        if str((query or {}).get("peek") or "") == "1":
            return ok(_peek(cleanup, channels))
        item = _next_item(cleanup, device.id)
        if (
            item is None
            or item.status is not T.QueueStatus.approved
            or item.approved_via not in T.HUMAN_APPROVAL_VIAS
            or not item.approved_at
        ):
            return ok({"items": [], "channels": {}})
        channel = channels.get(item.channel_id)
        found = {channel.id: _channel_url(channel)} if channel is not None else {}
        return ok({"items": [item], "channels": found})
    except Exception as exc:  # noqa: BLE001 — the handler answers with an envelope
        return error_envelope(exc)


def _result_body(body: Mapping[str, Any] | None) -> tuple[T.QueueStatus, str | None]:
    if not isinstance(body, Mapping):
        raise T.ValidationError("the body must be an object {status, error?}")
    extra = set(body) - _RESULT_KEYS
    if extra:
        raise T.ValidationError(f"unknown fields: {sorted(extra)}")
    status = body.get("status")
    if status not in _RESULT_STATUSES:
        raise T.ValidationError("status: running, done or failed", field="status")
    error = body.get("error")
    if error is not None and not isinstance(error, str):
        raise T.ValidationError("error must be text or null", field="error")
    return T.QueueStatus(status), (error[:ERROR_MAX] if error else None)


@contract.real
def post_queue_result(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    cleanup: T.Cleanup,
) -> Envelope:
    """POST /ext/queue/{id}/result.

    Result of the run (running → done|failed); done of unsubscribe → the channel becomes ex
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    try:
        status, error = _result_body(body)
        queue_id = str((query or {}).get("id") or "")
        if not queue_id:
            raise T.NotFound("item without id")
        item = cleanup.queue_result(queue_id, status, error=error, device_id=device.id)
        return ok(item)
    except Exception as exc:  # noqa: BLE001 — the handler answers with an envelope
        return error_envelope(exc)
