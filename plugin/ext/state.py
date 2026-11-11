"""Extension handler of ``plugin/ext/state.py``.

``GET /ext/state`` → ``SyncIngest.ext_state(device_id)``: calls ``Refresher.kick_if_due()``
without waiting (the RSS cycle runs in its own thread) and answers at once (< 2 s; target
< 100 ms). Read by the extension's background every 30 s while paired.

Mounted by ``_mount.py`` via ``wiring.ext_handlers``; dependencies by name (``x-deps``). Pure
function: never reads the environment to find the profile or database.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import types as T


@contract.real
def get_state(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    sync: T.SyncIngest,
) -> Envelope:
    """GET /ext/state.

    State for the extension (chrome.alarms every 30 s while paired)
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    try:
        state = sync.ext_state(device.id)
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok(state)
