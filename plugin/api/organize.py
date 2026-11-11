"""REST routes of ``plugin/api/organize.py``: reading the "Organize with Hermes" suggestions.
Accepting/rejecting and generating live in the RPC (``plugin/rpc/organize.py``); here there is no
AI and no events (< 2 s). Reading drops suggestions for a channel that is gone or changed folder,
that would change nothing, or that were made with another folder list (``Organizer.pending``).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.core import dedup
from tube_pkg.core import types as T


def _rank(payload: Mapping[str, Any]) -> int:
    """0 = channel without a folder; 1 = moves a channel that has one; 2 = only adds tags."""
    if payload.get("same_folder") is True:
        return 2
    return 0 if payload.get("from_folder_id") is None else 1


def _order(s: T.Suggestion) -> tuple[Any, ...]:
    """Channels without a folder first, then moves of filed channels, then tag-only suggestions;
    grouped by folder (``payload.folder``) within each, most confident first within the group."""
    folder = s.payload.get("folder")
    confidence = s.payload.get("confidence")
    conf = float(confidence) if isinstance(confidence, int | float) else 0.0
    return (
        _rank(s.payload),
        dedup.normalize_name(folder) if isinstance(folder, str) else "",
        -conf,
        s.created_at,
        s.id,
    )


@contract.real
def get_suggestions(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /suggestions.

    Pending "Organize with Hermes" suggestions (the UI groups them by
    `payload.folder`)
    """
    items = sorted(wiring.get_organizer().pending(), key=_order)
    return ok({"items": items})
