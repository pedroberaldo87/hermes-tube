"""Extension feed handlers: ``GET /ext/feed``, ``POST /ext/videos/state``, ``POST /ext/read``.

Mounted by ``_mount.py`` via ``wiring.ext_handlers``; dependencies by name (``x-deps``). Pure
functions: no process state, no environment, no profile lookup. They read their input with the
**same** functions as the Desktop routes (``core.feed.page_for_query`` and
``core.video_state.change_from_body``): same tab = same feed. Actions coming from the extension
are user clicks (``actor=user``, undoable in the history). The mount only calls them with an
authenticated device (``auth=True`` routes).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.core import feed as core_feed
from tube_pkg.core import types as T
from tube_pkg.core import video_state as core_state


@contract.real
def get_feed(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    feed: T.FeedEngine,
) -> Envelope:
    """GET /ext/feed — one of ``tab``, ``folder``, ``channel`` (+ ``limit``, ``cursor``)."""
    return ok(core_feed.page_for_query(feed, query))


@contract.real
def post_videos_state(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    video_state: T.VideoStateService,
) -> Envelope:
    """POST /ext/videos/state — seen, later, archive, 👍/👎 (same body as the Desktop)."""
    return ok({"changed": core_state.change_from_body(video_state, body)})


@contract.real
def post_read(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    refresher: T.Refresher,
) -> Envelope:
    """POST /ext/read ``{kind: channel|folder|all, id?}`` — ``Refresher.mark_read``."""
    body = body or {}
    if not isinstance(body, Mapping):
        raise T.ValidationError("the body must be an object")
    unknown = sorted(set(body) - {"kind", "id"})
    if unknown:
        raise T.ValidationError(f"unknown keys {unknown}")
    try:
        kind = T.ReadScopeKind(body.get("kind"))
    except ValueError as exc:
        raise T.ValidationError(f"invalid kind: {body.get('kind')!r}", field="kind") from exc
    scope_id = body.get("id")
    if scope_id is not None and not isinstance(scope_id, str):
        raise T.ValidationError("id: expected text", field="id")
    if kind is T.ReadScopeKind.all:
        scope_id = None
    elif not scope_id:
        raise T.ValidationError(f"id is required for kind={kind.value}", field="id")
    changed = refresher.mark_read(T.ReadScope(kind, scope_id), actor=T.Actor.user)
    return ok({"changed": int(changed)})
