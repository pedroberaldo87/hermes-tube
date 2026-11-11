"""REST routes of the local playlists (``core/playlists.py``).

Plain ``def`` routes (< 2 s, no AI, no events, no network). A ``TubeError`` becomes the error
envelope right in the handler (a direct call answers the same as the router). Body validated here;
the rules (limits, unique names, no duplicates) live in ``PlaylistService``.

Playlists are local to this machine: nothing here writes to the YouTube account.
"""

from __future__ import annotations

import functools
from collections.abc import Mapping, Sequence
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, RestHandler, contract, error_envelope, ok
from tube_pkg.core import playlists as core_playlists
from tube_pkg.core import types as T

MAX_BATCH = 200
"""Video ids per add/remove/reorder request."""


def service() -> core_playlists.PlaylistService:
    """The playlist service on the active profile's database (built at the time of use)."""
    return core_playlists.build(db=wiring.get_db(), clock=wiring.get_clock())


def guard(fn: RestHandler) -> RestHandler:
    @functools.wraps(fn)
    def wrapper(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
        try:
            return fn(body, query)
        except T.TubeError as exc:
            return error_envelope(exc)

    return wrapper


def _body(body: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if not isinstance(body, Mapping):
        raise T.ValidationError("body must be a JSON object")
    return body


def _path_id(query: Mapping[str, str]) -> str:
    value = str((query or {}).get("id") or "")
    if not value:
        raise T.NotFound("playlist id missing")
    return value


def _ids(body: Mapping[str, Any], key: str, *, required: bool = True) -> list[str]:
    if key not in body:
        if required:
            raise T.ValidationError(f"{key}: required", field=key)
        return []
    value = body[key]
    if not isinstance(value, list):
        raise T.ValidationError(f"{key}: expected a list of video ids", field=key)
    if len(value) > MAX_BATCH:
        raise T.ValidationError(f"{key}: at most {MAX_BATCH} per request", field=key)
    if not value and not required:
        return []
    return core_playlists.clean_video_ids(value, field=key)


def known_videos(ids: Sequence[str]) -> list[str]:
    """The ids the library knows, in the given order; none known → ``NotFound``."""
    found = wiring.get_video_store().get(list(ids))
    known = [v for v in ids if v in found]
    if not known:
        raise T.NotFound("None of these videos is in your library.")
    return known


def feed_items(ids: Sequence[str]) -> list[T.FeedItem]:
    """``FeedItem`` of each known id, in the given order (same source as ``GET /videos``)."""
    if not ids:
        return []
    engine = wiring.get_feed()
    items_of = getattr(engine, "items", None)
    if callable(items_of):
        return list(items_of(list(ids)))
    videos = wiring.get_video_store().get(list(ids))
    states = wiring.get_video_state().get(list(ids))
    out = []
    for vid in ids:
        video = videos.get(vid)
        if video is None:
            continue
        st = states.get(vid)
        out.append(
            T.FeedItem(
                video=video,
                state=st.state if st else T.VideoState.new,
                reaction=st.reaction if st else None,
            )
        )
    return out


@contract.real
@guard
def get_playlists(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /playlists?video_id= — every playlist (count, first video) and, with ``video_id``,
    the ids of the playlists that hold it (the "Add to playlist" picker)."""
    svc = service()
    video_id = str((query or {}).get("video_id") or "")
    member_of: list[str] = []
    if video_id:
        (video_id,) = core_playlists.clean_video_ids([video_id], field="video_id")
        member_of = svc.member_of(video_id)
    return ok({"items": svc.list(), "member_of": member_of})


@contract.real
@guard
def post_playlist(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /playlists — create (optionally with its first videos)."""
    data = _body(body)
    if "name" not in data:
        raise T.ValidationError("name: required", field="name")
    ids = _ids(data, "video_ids", required=False)
    if ids:
        ids = known_videos(ids)
    return ok(service().create(data["name"], ids))


@contract.real
@guard
def get_playlist(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /playlists/{id} — the playlist and its videos in play order."""
    svc = service()
    playlist = svc.get(_path_id(query))
    return ok({"playlist": playlist, "items": feed_items(svc.item_ids(playlist.id))})


@contract.real
@guard
def patch_playlist(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """PATCH /playlists/{id} — rename."""
    data = _body(body)
    if "name" not in data:
        raise T.ValidationError("name: required", field="name")
    return ok(service().rename(_path_id(query), data["name"]))


@contract.real
@guard
def delete_playlist(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """DELETE /playlists/{id} — the playlist goes; its videos stay in the library."""
    playlist_id = _path_id(query)
    service().delete(playlist_id)
    return ok({"id": playlist_id})


@contract.real
@guard
def post_playlist_items(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /playlists/{id}/items — append videos (one already there is left as is)."""
    svc = service()
    playlist_id = _path_id(query)
    svc.get(playlist_id)
    ids = known_videos(_ids(_body(body), "video_ids"))
    changed = svc.add(playlist_id, ids)
    return ok({"playlist": svc.get(playlist_id), "changed": changed})


@contract.real
@guard
def post_playlist_items_remove(
    body: Mapping[str, Any] | None, query: Mapping[str, str]
) -> Envelope:
    """POST /playlists/{id}/items/remove — take videos out of the playlist (not the library)."""
    svc = service()
    playlist_id = _path_id(query)
    changed = svc.remove(playlist_id, _ids(_body(body), "video_ids"))
    return ok({"playlist": svc.get(playlist_id), "changed": changed})


@contract.real
@guard
def post_playlist_reorder(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /playlists/{id}/reorder — the given videos first, in that order."""
    return ok({"count": service().reorder(_path_id(query), _ids(_body(body), "ids"))})


__all__ = [
    "MAX_BATCH",
    "delete_playlist",
    "feed_items",
    "get_playlist",
    "get_playlists",
    "known_videos",
    "patch_playlist",
    "post_playlist",
    "post_playlist_items",
    "post_playlist_items_remove",
    "post_playlist_reorder",
    "service",
]
