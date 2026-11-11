"""Extension handlers for delegated searches: ``GET /ext/search-jobs`` and
``POST /ext/search-jobs/{id}/result`` (contract/ext-protocol.md §6).

Mounted by ``_mount.py`` via ``wiring.ext_handlers``; dependency ``searcher`` by name
(``x-deps``). Pure functions: no ``os.environ`` and no ``get_hermes_home()``. Domain errors become
envelopes (the extension server maps the code to an HTTP status: ``conflict`` → 409, ``invalid``
→ 400, ``not_found`` → 404).

The result body is **untrusted data**: only the envelope shape is checked here (exactly one of
``payload``/``error``); the content is validated by ``Searcher.complete`` (size, shape, ids).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import types as T

DEFAULT_LIMIT = 4
MAX_LIMIT = 8
MAX_ERROR_CHARS = 500


def _limit(query: Mapping[str, str]) -> int:
    """``?limit`` (1..8, default 4). An odd value is not an error: it becomes the default
    or the cap."""
    raw = query.get("limit") if isinstance(query, Mapping) else None
    try:
        value = int(str(raw).strip()) if raw not in (None, "") else DEFAULT_LIMIT
    except ValueError:
        return DEFAULT_LIMIT
    return max(1, min(MAX_LIMIT, value))


@contract.real
def get_search_jobs(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    searcher: T.Searcher,
) -> Envelope:
    """GET /ext/search-jobs.

    Delegated searches (pending → claimed, one device per job); polled every 3 s only while
    search_pending > 0. A job past ``expires_at`` is not delivered.
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    try:
        jobs = searcher.claim(device.id, _limit(query))
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok({"items": jobs})


@contract.real
def post_search_result(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    searcher: T.Searcher,
) -> Envelope:
    """POST /ext/search-jobs/{id}/result ``{payload}`` ou ``{error}``.

    Returns the search's ytInitialData (expired → conflict: the host already covered it and the
    late result is discarded; the extension ignores it).
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    job_id = query.get("id") if isinstance(query, Mapping) else None
    if not isinstance(job_id, str) or not job_id.strip():
        return fail("not_found", "search without id")
    if not isinstance(body, Mapping):
        return fail("invalid", "the body must be an object")
    keys = set(body)
    if len(keys) != 1 or not keys <= {"payload", "error"}:
        return fail("invalid", "send exactly one of 'payload' or 'error'")
    try:
        if "error" in body:
            message = body["error"]
            if not isinstance(message, str):
                return fail("invalid", "'error' must be text")
            report = getattr(searcher, "fail", None)
            if not callable(report):
                return fail("invalid", "this server does not accept search error reports")
            job = report(job_id.strip(), message[:MAX_ERROR_CHARS], device_id=device.id)
        else:
            payload = body["payload"]
            if not isinstance(payload, Mapping | str):
                return fail("invalid", "'payload' must be an object or text")
            job = searcher.complete(job_id.strip(), payload, device_id=device.id)
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok(job)
