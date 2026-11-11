"""Extension handlers of ``plugin/ext/pair.py``.

Mounted by ``_mount.py`` via ``wiring.ext_handlers``; dependencies by name (``x-deps``). Pure
functions: no ``os.environ`` and no ``get_hermes_home()``.

- ``pair_complete`` (``POST /pair/complete``, no Bearer, ``Origin`` required): validates the body
  (``PairCompleteBody``), reads the origin the mount injects in ``query[ORIGIN_QUERY_KEY]`` and
  pins it to the device (``DeviceAuth.complete_pairing(..., origin=)``). Failure → error envelope
  with the ``reason`` as code (``no_active_code|invalid_code|expired|used|locked``;
  ``invalid_code`` carries ``details.remaining``); a malformed body → ``invalid`` without spending
  an attempt.

  Two bodies (additive):

  - ``{code, name}`` — the code itself (older extensions).
  - ``{name, pake: {x}}`` then ``{name, pake: {session, confirm}}`` — the code never travels
    (``ext/proof.py``). Round 1 spends one attempt of the code (as a wrong code does) and answers
    ``{pake: {session, y, confirm, remaining}}``: only a server that knows the code, on the port the
    extension dialled (``query[PORT_QUERY_KEY]``, injected by the mount), can produce
    ``confirm``. Round 2 checks the extension's confirmation (a wrong one spends another attempt)
    and answers ``PairedDevice``.
- ``unpair`` (``POST /ext/unpair``, Bearer): revokes the calling device.

Errors become envelopes here (the mount sets the status from ``ERROR_HTTP_STATUS``), so the
handler can be called directly (surface test) without raising.
"""

from __future__ import annotations

import re
import time
from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import types as T
from tube_pkg.ext import proof
from tube_pkg.ext._mount import ORIGIN_QUERY_KEY, PORT_QUERY_KEY

_CODE_RE = re.compile(r"[0-9]{6}")
_NAME_MAX = 80
_SPEND = "pake-round"
"""Never a valid code (codes are digits): ``complete_pairing`` with it counts one wrong attempt."""
_PAKE_SHAPE = "body must be {name, pake: {x} | {session, confirm}}"


def _name(body: Mapping[str, Any]) -> str | None:
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    return " ".join(name.split())[:_NAME_MAX]


def _parse_body(body: Mapping[str, Any] | None) -> tuple[str, str] | Envelope:
    if not isinstance(body, Mapping):
        return fail("invalid", "body must be {code, name}")
    code = body.get("code")
    if not isinstance(code, str) or not _CODE_RE.fullmatch(code.strip()):
        return fail("invalid", "code must have 6 digits")
    name = _name(body)
    if name is None:
        return fail("invalid", "name is required")
    return code.strip(), name


def _active_code_hash(devices: T.DeviceAuth) -> str | None:
    """Salted hash of the open code (read only; same rule as ``pairing_open``)."""
    db = getattr(devices, "db", None)
    if db is None:
        return None
    clock = getattr(devices, "clock", None)
    now = int(clock.now()) if clock is not None else int(time.time())
    row = db.query_one(
        "SELECT code_hash FROM pair_codes WHERE used_at IS NULL AND expires_at > ?"
        " ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (now,),
    )
    return str(row["code_hash"]) if row is not None else None


def _spend_attempt(devices: T.DeviceAuth, name: str, origin: str | None) -> Envelope | int:
    """Counts one attempt of the open code: the attempts left, or the error if the code closed."""
    try:
        devices.complete_pairing(_SPEND, name, origin=origin)
    except T.PairingFailed as exc:
        if exc.reason == "invalid_code":
            left = exc.details.get("remaining")
            return int(left) if isinstance(left, int) else 0
        return error_envelope(exc)
    except T.TubeError as exc:
        return error_envelope(exc)
    return fail("internal", "pairing proof failed")  # unreachable: the marker never matches


def _round_one(
    pake: Mapping[str, Any], name: str, query: Mapping[str, str], devices: T.DeviceAuth
) -> Envelope:
    x = pake.get("x")
    if not isinstance(x, str) or len(x) != proof.ELEMENT_HEX:
        return fail("invalid", "pake.x must be a group element")
    try:
        port = int(query.get(PORT_QUERY_KEY) or "")
    except ValueError:
        return fail("invalid", "server port unknown")
    stored = _active_code_hash(devices)
    if stored is None:
        return error_envelope(T.PairingFailed("no_active_code", "no active pairing code"))
    spent = _spend_attempt(devices, name, query.get(ORIGIN_QUERY_KEY) or None)
    if not isinstance(spent, int):
        return spent
    code = proof.SESSIONS.code_for(stored)
    answer = proof.server_round(code, x, port) if code is not None else None
    if code is None or answer is None:
        return fail("invalid", "pake.x must be a group element")
    y, server_confirm, key = answer
    session = proof.SESSIONS.open(key, code, stored)
    # `remaining`: attempts left if the extension's code is wrong (it cannot tell a typo apart)
    return ok({"pake": {"session": session, "y": y, "confirm": server_confirm, "remaining": spent}})


def _round_two(
    pake: Mapping[str, Any], name: str, query: Mapping[str, str], devices: T.DeviceAuth
) -> Envelope:
    origin = query.get(ORIGIN_QUERY_KEY) or None
    found = proof.SESSIONS.take(pake.get("session"))
    if found is None:
        return error_envelope(T.PairingFailed("expired", "pairing step expired; try again"))
    if _active_code_hash(devices) != found.stored:
        return error_envelope(T.PairingFailed("no_active_code", "no active pairing code"))
    if not proof.same(pake.get("confirm"), proof.confirm(found.key, "client")):
        spent = _spend_attempt(devices, name, origin)
        if not isinstance(spent, int):
            return spent
        error = T.PairingFailed("invalid_code", f"wrong code ({spent} attempts left)")
        error.details["remaining"] = spent
        return error_envelope(error)
    try:
        return ok(devices.complete_pairing(found.code, name, origin=origin))
    except T.TubeError as exc:
        return error_envelope(exc)


def _pake(body: Mapping[str, Any], query: Mapping[str, str], devices: T.DeviceAuth) -> Envelope:
    pake = body.get("pake")
    name = _name(body)
    if not isinstance(pake, Mapping) or name is None:
        return fail("invalid", _PAKE_SHAPE)
    if "x" in pake:
        return _round_one(pake, name, query, devices)
    if isinstance(pake.get("session"), str) and isinstance(pake.get("confirm"), str):
        return _round_two(pake, name, query, devices)
    return fail("invalid", _PAKE_SHAPE)


@contract.real
def pair_complete(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    devices: T.DeviceAuth,
) -> Envelope:
    """POST /pair/complete.

    Exchanges the 6-digit code for a token (single use)
    """
    if isinstance(body, Mapping) and "pake" in body and "code" not in body:
        try:
            return _pake(body, query or {}, devices)
        except T.TubeError as exc:
            return error_envelope(exc)
    parsed = _parse_body(body)
    if isinstance(parsed, dict):
        return parsed
    code, name = parsed
    origin = (query or {}).get(ORIGIN_QUERY_KEY) or None
    try:
        paired = devices.complete_pairing(code, name, origin=origin)
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok(paired)


@contract.real
def unpair(
    device: T.Device | None,
    body: Mapping[str, Any] | None,
    query: Mapping[str, str],
    *,
    devices: T.DeviceAuth,
) -> Envelope:
    """POST /ext/unpair.

    Unpair from the device itself (revokes this device's token)
    """
    if device is None:
        return fail("unauthorized", "Bearer device token required")
    return ok({"revoked": bool(devices.revoke(device.id))})
