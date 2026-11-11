"""RPC methods of ``plugin/rpc/organize.py``: ``organize.run`` (job), ``organize.accept``
and ``organize.reject``.

Registered by ``register(ctx)`` (``ctx.register_rpc``) from ``wiring.RPC_METHODS``; they only
exist in the gateway. They answer in < 1 s: ``organize.run`` only records the job
(``JobRunner.submit``) and the AI runs in the job thread; the result (``OrganizeResult``) is in
``GET /jobs/{id}`` and the end is announced by ``organize.done`` (a speed-up; the screen polls).
No model → ``llm_unavailable`` at once, no job. One organization at a time → ``busy``.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import dedup
from tube_pkg.core import types as T
from tube_pkg.core.organize import NO_MODEL_MESSAGE

JOB_TIMEOUT_S = 1200.0
"""Ceiling for the whole organization inside the job (``JobRunner`` still closes silent jobs)."""
DONE_EVENT = "organize.done"
BUSY_MESSAGE = "An organization is already in progress; follow its progress."
MAX_ITEMS = 5000
"""Cap on each list (``suggestion_ids``, ``channel_ids``, ``edits``) a client may send. "Accept
all" sends every pending suggestion of a run, which can cover a whole subscription list, so the
cap is that list's own ceiling (``SubscriptionBatchBody.channels``), not cleanup's 500."""

_SUBMIT_LOCK = threading.Lock()
"""Check \"is there an active job\" and record the new one without a race between two calls."""


class _Invalid(Exception):
    pass


def _ids(params: Mapping[str, Any], key: str, *, channels: bool = False) -> list[str] | None:
    value = params.get(key)
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise _Invalid(f"{key}: expected a list of strings")
    if len(value) > MAX_ITEMS:
        raise _Invalid(f"{key}: at most {MAX_ITEMS} items at a time")
    if channels and not all(dedup.is_channel_id(v) for v in value):
        raise _Invalid(f"{key}: expected channel ids (UC…)")
    return list(dict.fromkeys(value))


def _edits(value: Any) -> dict[str, T.OrganizeEdit] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise _Invalid("edits: expected an object channel → {folder, tags}")
    if len(value) > MAX_ITEMS:
        raise _Invalid(f"edits: at most {MAX_ITEMS} channels at a time")
    out: dict[str, T.OrganizeEdit] = {}
    for cid, edit in value.items():
        if not isinstance(cid, str) or not dedup.is_channel_id(cid):
            raise _Invalid(f"edits: keys must be channel ids (UC…), got {str(cid)[:40]!r}")
        if not isinstance(edit, Mapping) or set(edit) - {"folder", "tags"}:
            raise _Invalid(f"edits[{cid}]: only folder and tags")
        folder, tags = edit.get("folder"), edit.get("tags")
        if folder is not None and not isinstance(folder, str):
            raise _Invalid(f"edits[{cid}].folder: expected a string or null")
        if tags is not None and (
            not isinstance(tags, list) or not all(isinstance(t, str) for t in tags)
        ):
            raise _Invalid(f"edits[{cid}].tags: expected a list of strings or null")
        out[str(cid)] = T.OrganizeEdit(
            folder=folder, tags=tuple(tags) if tags is not None else None
        )
    return out


def _selection(params: Mapping[str, Any]) -> tuple[list[str] | None, list[str] | None]:
    sids = _ids(params, "suggestion_ids")
    cids = _ids(params, "channel_ids")
    if sids is None and cids is None:
        raise _Invalid("provide suggestion_ids or channel_ids")
    return sids, cids


@contract.real
def organize_run(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """organize.run.

    Generates folder/tag suggestions with AI (nothing is applied)
    """
    try:
        ids = _ids(params, "channel_ids", channels=True)
    except _Invalid as exc:
        return fail("invalid", str(exc))
    try:
        if not wiring.get_llm().available():
            return fail("llm_unavailable", NO_MODEL_MESSAGE)
        organizer = wiring.get_organizer()
        jobs = wiring.get_jobs()
        with _SUBMIT_LOCK:
            if any(job.kind is T.JobKind.organize for job in jobs.list_active()):
                return fail("busy", BUSY_MESSAGE)
            job = jobs.submit(
                T.JobKind.organize,
                lambda progress: organizer.organize(
                    ids, timeout=JOB_TIMEOUT_S, on_progress=progress
                ),
                event=DONE_EVENT,
                session_id=session_id,
            )
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok({"job": job})


@contract.real
def organize_accept(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """organize.accept.

    Applies suggestions (block or channel) through the services, in one history group
    """
    try:
        sids, cids = _selection(params)
        edits = _edits(params.get("edits"))
    except _Invalid as exc:
        return fail("invalid", str(exc))
    try:
        report = wiring.get_organizer().accept(
            sids, channel_ids=cids, edits=edits, actor=T.Actor.user
        )
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok(report)


@contract.real
def organize_reject(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """organize.reject.

    Rejects suggestions (block or channel)
    """
    try:
        sids, cids = _selection(params)
    except _Invalid as exc:
        return fail("invalid", str(exc))
    try:
        count = wiring.get_organizer().reject(sids, channel_ids=cids)
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok({"count": count})
