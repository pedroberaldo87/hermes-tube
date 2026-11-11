"""REST routes of ``plugin/api/pair.py``.

- ``POST /pair/start`` — REST path of ``pair.start`` (plugin host): starts the extension server
  with ``wiring.ensure_ext_server(role="host")`` and only then creates the code (no server →
  ``ext_endpoint_down`` and no code is opened). ``start_pairing_envelope`` also serves the RPC.
- ``GET /devices`` — devices that are not revoked.
- ``POST /devices/{id}/revoke`` — revoke from the Desktop (``revoked: false`` = did not exist).

Plain ``def`` routes, < 2 s (``ensure`` waits at most ~1.5 s for the owner's lock), no AI and no
event; services only through ``wiring``.

These routes sit behind the Hermes dashboard gate (the Desktop's own credential). The pairing
code is returned only here, never on the extension's server, and is never logged.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, fail, ok


def start_pairing_envelope(role: str) -> Envelope:
    """Starts (or reuses) the extension server and opens a code → ``PairStartResponse``."""
    port = wiring.ensure_ext_server(role=role)
    if not port:
        return fail("ext_endpoint_down", "the extension server did not start; try again")
    code = wiring.get_devices().start_pairing()
    return ok({"code": code.code, "expires_at": code.expires_at, "port": int(port)})


@contract.real
def post_pair_start(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /pair/start.

    Pairing code (starts the extension server if needed)
    """
    return start_pairing_envelope("host")


@contract.real
def get_devices(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /devices.

    Paired devices (not revoked)
    """
    return ok({"items": wiring.get_devices().list()})


@contract.real
def post_device_revoke(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /devices/{id}/revoke.

    Revoke a device from the Desktop
    """
    device_id = str((query or {}).get("id") or "")
    if not device_id:
        return ok({"revoked": False})
    return ok({"revoked": bool(wiring.get_devices().revoke(device_id))})
