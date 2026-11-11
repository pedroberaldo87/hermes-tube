"""REST routes of ``plugin/api/themes.py``: reading topics (of topic tabs) and stored previews.

Create, save and refresh live in the RPC (``plugin/rpc/themes.py``): here there is no AI, no
search and no event (< 2 s). A topic in ``preview`` with ``error`` filled in is a **partial** or
empty preview with the explanation (see ``core/themes.py``).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import types as T


@contract.real
def get_themes(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /themes.

    Topics (newest first)
    """
    return ok({"items": wiring.get_themes().list()})


@contract.real
def get_theme(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /themes/{id}.

    The topic's stored preview (kept videos, seeds)
    """
    theme_id = query.get("id")
    if not isinstance(theme_id, str) or not theme_id:
        return fail("not_found", "topic without an id")
    try:
        return ok(wiring.get_themes().preview(theme_id))
    except T.TubeError as exc:
        return error_envelope(exc)
