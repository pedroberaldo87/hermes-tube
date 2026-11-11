"""RPC methods of ``plugin/rpc/jobs.py``: ``job.cancel`` (direct).

Registered by ``register(ctx)`` (``ctx.register_rpc``) from ``wiring.RPC_METHODS``; it only
exists in the gateway, where the AI jobs run. **Cooperative** cancellation through
``JobRunner.cancel``: the job closes at once (``status: error`` with ``error.code: cancelled``,
``T.JOB_CANCELLED_CODE``), which frees the \"one at a time\" of ``organize.run``/``theme.create``;
the end is announced by the method's own event (``organize.done``/``theme.ready``…) and the thread
stops at the next checkpoint (organize: between batches; theme: between steps and searches).
Nothing already done is undone; nothing new is applied. Idempotent: finished or missing →
``ok`` with ``cancelled: false``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import types as T

_ACTIVE = (T.JobStatus.queued, T.JobStatus.running)


@contract.real
def job_cancel(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """job.cancel.

    Cancels an AI job (cooperative; idempotent)
    """
    job_id = params.get("job_id")
    if not isinstance(job_id, str) or not job_id.strip():
        return fail("invalid", "job_id: expected the job id")
    job_id = job_id.strip()
    try:
        jobs = wiring.get_jobs()
        before = jobs.get(job_id)
        after = jobs.cancel(job_id) if before is not None else None
    except T.TubeError as exc:
        return error_envelope(exc)
    cancelled = (
        before is not None
        and before.status in _ACTIVE
        and after is not None
        and T.is_job_cancelled(after)
    )
    return ok({"job": after if after is not None else before, "cancelled": cancelled})
