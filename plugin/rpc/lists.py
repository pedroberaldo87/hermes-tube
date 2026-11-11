"""RPC methods of ``plugin/rpc/lists.py``: importing a list of channels from a web page.

List import is an Extra, and Extras are not part of this version (``GET /extras`` reports
``import_lists: false``). Both methods answer ``conflict`` and do nothing: no page is fetched, no
model is called, nothing is stored.

Registered by ``register(ctx)`` (``ctx.register_rpc``) from ``wiring.RPC_METHODS``; they only
exist in the gateway.

Security note for when ``lists.import`` is implemented: ``params.url`` is untrusted (any gateway
client can send it). Validate it as ``http``/``https`` and fetch it only through the plugin's
``HttpClient``, which refuses non-public addresses and caps size and time.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract
from tube_pkg.api.extras import extras_off


@contract.real
def lists_import(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """lists.import — Extra turned off: ``conflict``, nothing downloaded."""
    return extras_off()


@contract.real
def lists_to_tab(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """lists.to_tab — Extra turned off: ``conflict``, no tab created."""
    return extras_off()
