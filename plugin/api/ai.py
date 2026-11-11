"""REST routes of ``plugin/api/ai.py``: ``GET /ai/status``.

\"Is there an AI model?\" before the click. Only reads the Hermes configuration through the adapter
(``core.ai.status_of``): no network, no model call, < 2 s. In the plugin host (where REST runs)
there is no ``ctx``: the answer says whether the gateway, with this same configuration, will try
to call it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.core import ai as core_ai


@contract.real
def get_ai_status(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /ai/status.

    Is an AI model configured? (no network; to warn before the click)
    """
    return ok(core_ai.status_of(wiring.get_llm()))
