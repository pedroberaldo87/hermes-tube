"""Cleanup RPC methods: ``cleanup.scan``, ``cleanup.approve``, ``cleanup.resubscribe``.

Registered by ``register(ctx)`` (``ctx.register_rpc``) from ``wiring.RPC_METHODS``; they only
exist in the gateway and only the Desktop calls them (the profile's native credential, which the
agent does not have). That is why these are the **only** methods that approve, always with
``ApprovedVia.desktop_rpc``:

- ``cleanup.scan`` (``kind: job``) — resolves ``Cleanup``/``JobRunner`` here (profile context)
  and returns ``{job}`` at once; the thread runs ``Cleanup.scan`` and emits ``cleanup.scanned``.
- ``cleanup.approve`` / ``cleanup.resubscribe`` (``kind: direct``) — ``params.channel_ids``
  (1..500 ``UC…`` ids) → ``Cleanup.approve``/``resubscribe`` with ``via=desktop_rpc`` and
  ``actor=user``. A ``via``/``approved_via`` parameter sent by the caller chooses nothing: if it
  differs from ``desktop_rpc`` it is an attempt to forge the origin → ``approval_refused``.
"""

from __future__ import annotations

import functools
import re
from collections.abc import Callable, Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, error_envelope, ok
from tube_pkg.core import types as T

SCAN_JOB_TIMEOUT_S = 300.0
"""Deadline of a Desktop scan (AI batches for hundreds of channels)."""
MAX_CHANNELS = 500
_FORGEABLE = ("via", "approved_via")
_CHANNEL_ID = re.compile(r"^UC[A-Za-z0-9_-]{22}$")


def _channel_ids(params: Mapping[str, Any]) -> list[str]:
    raw = params.get("channel_ids")
    if not isinstance(raw, list) or not raw:
        raise T.ValidationError("channel_ids: a list of 1 to 500 channels", field="channel_ids")
    if len(raw) > MAX_CHANNELS:
        raise T.ValidationError(
            f"channel_ids: at most {MAX_CHANNELS} channels at a time", field="channel_ids"
        )
    for value in raw:
        if not isinstance(value, str) or not _CHANNEL_ID.match(value):
            raise T.ValidationError(f"channel_ids: invalid id {value!r}"[:120], field="channel_ids")
    return list(raw)


def _enveloped(fn: Callable[..., Envelope]) -> Callable[..., Envelope]:
    """Errors become an envelope on a direct call too (``register``'s ``call_rpc`` already does)."""

    @functools.wraps(fn)
    def wrapper(params: Any, *, session_id: str | None = None, **kwargs: Any) -> Envelope:
        if params is None:
            params = {}
        if not isinstance(params, Mapping):
            return error_envelope(T.ValidationError("params must be an object"))
        try:
            return fn(params, session_id=session_id, **kwargs)
        except Exception as exc:  # noqa: BLE001 — RPC never raises (rpc.yaml)
            return error_envelope(exc)

    return wrapper


def _refuse_forged_origin(params: Mapping[str, Any]) -> None:
    for key in _FORGEABLE:
        if key in params and params[key] != T.ApprovedVia.desktop_rpc.value:
            raise T.ApprovalRefused(
                "approval refused: the origin is always the Desktop in this method "
                f"({key}={params[key]!r} is not accepted)"[:200]
            )


@contract.real
@_enveloped
def cleanup_scan(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """cleanup.scan.

    Builds the cleanup (rules + AI reasons); approves nothing and changes no channel
    """
    cleanup = wiring.get_cleanup()
    jobs = wiring.get_jobs()

    def run(progress: T.ProgressFn) -> T.CleanupScan:
        return cleanup.scan(timeout=SCAN_JOB_TIMEOUT_S, on_progress=progress)

    job = jobs.submit(T.JobKind.cleanup_scan, run, event="cleanup.scanned", session_id=session_id)
    return ok({"job": job})


@contract.real
@_enveloped
def cleanup_approve(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """cleanup.approve.

    Human approval of unsubscriptions → queue items (approved_via = desktop_rpc)
    """
    _refuse_forged_origin(params)
    ids = _channel_ids(params)
    items = wiring.get_cleanup().approve(ids, T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    return ok({"items": items})


@contract.real
@_enveloped
def cleanup_resubscribe(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """cleanup.resubscribe.

    Resubscribe (Former subscriptions) → a resubscribe item in the same queue
    """
    _refuse_forged_origin(params)
    ids = _channel_ids(params)
    items = wiring.get_cleanup().resubscribe(ids, T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    return ok({"items": items})
