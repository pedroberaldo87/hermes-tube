"""RPC methods of ``plugin/rpc/pair.py``.

Registered by ``register(ctx)`` (``ctx.register_rpc``) from ``wiring.RPC_METHODS``; they only
exist in the gateway. ``pair.start`` = ``POST /pair/start`` with the extension server started by
the gateway (``wiring.ensure_ext_server(role="gateway")``, profile resolved before the thread).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract
from tube_pkg.api.pair import start_pairing_envelope


@contract.real
def pair_start(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """pair.start.

    Pairing code; starts the extension server in the gateway if nobody has
    """
    return start_pairing_envelope("gateway")
