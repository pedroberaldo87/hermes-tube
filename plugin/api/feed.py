"""REST routes for the feed: ``GET /feed``, ``POST /feed/preview``, ``GET /videos``.

Thin shell over ``FeedEngine`` (``wiring.get_feed()``); ``tab|folder|channel`` is interpreted the
same way as in the ``/ext/feed`` handler (``core.feed.page_for_query``) — same tab, same feed.
Before using the engine, it attaches ``Refresher.resolve_shorts`` as the on-demand Short resolver
(in the request context, with the right profile).
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.core import feed as core_feed
from tube_pkg.core import types as T
from tube_pkg.core import video_state as core_state

log = logging.getLogger(__name__)

MAX_VIDEO_IDS = 50


def _engine() -> T.FeedEngine:
    """Engine of the active profile, with the ``Refresher`` attached for on-demand Shorts (once)."""
    engine = wiring.get_feed()
    attach = getattr(engine, "attach_shorts_resolver", None)
    if callable(attach) and not getattr(engine, "has_shorts_resolver", True):
        try:
            refresher = wiring.get_refresher()
            resolver = getattr(refresher, "resolve_shorts", None)
            if callable(resolver) and not getattr(refresher, "__contract_stub__", None):
                attach(resolver)
        except Exception:  # noqa: BLE001 — the feed works without on-demand Shorts
            log.warning("Refresher unavailable for on-demand Shorts", exc_info=True)
    return engine


@contract.real
def get_feed(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /feed — exactly one of ``tab``, ``folder``, ``channel``, ``state=later`` (+ ``limit``,
    ``cursor``, ``q``: search in title and channel, ignoring accents and case; ``sort``,
    ``group``, ``tz_offset_min``)."""
    return ok(core_feed.page_for_query(_engine(), query))


@contract.real
def post_feed_preview(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /feed/preview ``{rules, limit?, cursor?, sort?, group?, tz_offset_min?}`` — unsaved
    rules (tab editor); order and grouping as in ``GET /feed``."""
    body = body or {}
    if "rules" not in body or not isinstance(body.get("rules"), Mapping):
        raise T.ValidationError("rules: required (object)", field="rules")
    rules = T.TabRules.from_dict(body["rules"])
    limit = core_feed.parse_limit(body.get("limit"))
    cursor = body.get("cursor")
    if cursor is not None and not isinstance(cursor, str):
        raise T.ValidationError("cursor: expected a string", field="cursor")
    engine = _engine()
    order = core_feed.parse_order(
        body.get("sort"),
        body.get("group"),
        body.get("tz_offset_min"),
        settings=getattr(engine, "settings", None),
    )
    extra = core_feed.order_kwargs(order)
    return ok(engine.preview(rules, limit=limit, cursor=cursor or None, **extra))


@contract.real
def get_videos(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /videos?ids= — ``FeedItem`` of each known id (``why: null``), in the requested order."""
    ids = core_state.split_csv_ids(query.get("ids"), maximum=MAX_VIDEO_IDS, required=True)
    engine = _engine()
    items_of = getattr(engine, "items", None)
    if callable(items_of):
        return ok({"items": items_of(ids)})
    # engine without ``items`` (fake): build it from the services
    videos = wiring.get_video_store().get(ids)
    states = wiring.get_video_state().get(ids)
    items = []
    for vid in ids:
        video = videos.get(vid)
        if video is None:
            continue
        st = states.get(vid)
        items.append(
            T.FeedItem(
                video=video,
                state=st.state if st else T.VideoState.new,
                reaction=st.reaction if st else None,
            )
        )
    return ok({"items": items})
