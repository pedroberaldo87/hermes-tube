"""REST routes of ``plugin/api/jobs.py``.

SQLite reads only: a job is born in the gateway (RPC → ``JobRunner.submit``) and is polled here,
in the plugin host, every 2 s while ``queued``/``running``. Reading also closes orphan jobs of a
dead or stalled process (``JobRunner.get``/``list_active``). No AI, no events, < 2 s.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, fail, ok
from tube_pkg.core import types as T


@contract.real
def get_job(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /jobs/{id}.

    State of an AI job (polled every 2 s while queued/running)
    """
    job_id = str(query.get("id") or "").strip()
    job = wiring.get_jobs().get(job_id) if job_id else None
    if job is None:
        return fail("not_found", f"job {job_id or '?'} not found")
    return ok(job)


@contract.real
def get_jobs(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /jobs.

    Active jobs (resume progress after reloading the page)
    """
    raw_kind = str(query.get("kind") or "").strip()
    kind: T.JobKind | None = None
    if raw_kind:
        try:
            kind = T.JobKind(raw_kind)
        except ValueError:
            return fail("invalid", f"unknown kind: {raw_kind}")
    items = [job for job in wiring.get_jobs().list_active() if kind is None or job.kind is kind]
    return ok({"items": items})
