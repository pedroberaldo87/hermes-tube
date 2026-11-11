"""REST routes for video state: ``GET /state``, ``GET /videos/state``,
``POST /videos/state``.

Thin shell over ``FeedEngine.new_counts`` and ``VideoStateService`` (``wiring``). The body of
``POST /videos/state`` is parsed by ``video_state.change_from_body`` — the same as in the
``POST /ext/videos/state`` handler.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.core import feed as core_feed
from tube_pkg.core import types as T
from tube_pkg.core import video_state as core_state

MAX_STATE_IDS = 200
MAX_BY_STATE = 500


@contract.real
def get_state(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /state?ids= — ``NewCounts`` + state of the requested videos that have a row."""
    ids = core_state.split_csv_ids(query.get("ids"), maximum=MAX_STATE_IDS, required=False)
    counts = wiring.get_feed().new_counts()
    videos = wiring.get_video_state().get(ids) if ids else {}
    return ok({"counts": counts, "videos": {vid: videos[vid] for vid in ids if vid in videos}})


@contract.real
def get_videos_by_state(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /videos/state?state=&limit= — most recent first (e.g. "Later")."""
    if not query.get("state"):
        raise T.ValidationError("state: required", field="state")
    state = core_state.parse_state(query["state"])
    limit = core_feed.parse_limit(query.get("limit"), default=100, maximum=MAX_BY_STATE)
    return ok({"items": wiring.get_video_state().list_by_state(state, limit=limit)})


@contract.real
def post_videos_state(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /videos/state — watched, later, archive, 👍/👎 (``actor=user``, undoable)."""
    return ok({"changed": core_state.change_from_body(wiring.get_video_state(), body)})
