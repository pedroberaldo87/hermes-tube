"""Security tests for the extension's local server (``plugin/ext``) and device pairing.

Raw sockets against a server bound to a free port block outside the real range; handlers are
minimal stand-ins (the transport checks run before any handler).
"""

from __future__ import annotations

import json
import random
import socket
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeDeviceAuth, FakeSettings

import tube_pkg.core.types as T
from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import db as core_db
from tube_pkg.core import devices as DV
from tube_pkg.ext import _mount, _server

SPAN = 3
EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"


def _free_block(span: int = SPAN) -> int:
    rng = random.Random()
    for _ in range(300):
        p = rng.randrange(20000, 40000 - span)
        ok = True
        for q in range(p, p + span):
            s = socket.socket()
            try:
                s.bind(("127.0.0.1", q))
            except OSError:
                ok = False
            finally:
                s.close()
        if ok:
            return p
    raise RuntimeError("no free port block")


def _handlers(devices: FakeDeviceAuth, calls: list[str]) -> _mount.ExtHandlers:
    def make(name: str):
        def handler(device, body, query):
            calls.append(name)
            return {"ok": True, "data": {}}

        return handler

    fields: dict[str, Any] = {
        f.name: make(f.name) for f in _mount.ExtHandlers.__dataclass_fields__.values()
    }
    fields["authenticate"] = _mount.bearer_authenticator(devices)
    return _mount.ExtHandlers(**fields)


@pytest.fixture
def calls() -> list[str]:
    return []


@pytest.fixture
def port(tmp_path: Path, calls: list[str]) -> Iterator[int]:
    data_dir = tmp_path / "home" / "plugin-data" / PLUGIN_ID
    data_dir.mkdir(parents=True)
    db = core_db.build(path=str(data_dir / "tube.db"))
    devices = FakeDeviceAuth()
    devices.add_device("Chrome")
    base = _free_block()
    p = _server.ensure_server(
        db=db,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=_handlers(devices, calls),
        port_base=base,
        port_span=SPAN,
    )
    assert p is not None
    try:
        yield p
    finally:
        _server.stop_local(data_dir)
        db.close()


def _raw(port: int, head: str, *, timeout: float = 3.0) -> tuple[int, bytes]:
    """Sends *head* (no body even if it announces one) and reads the status line + rest."""
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as s:
        s.sendall(head.encode("latin-1"))
        chunks = []
        try:
            while True:
                chunk = s.recv(65536)
                if not chunk:
                    break
                chunks.append(chunk)
                if b"\r\n\r\n" in b"".join(chunks):
                    break
        except TimeoutError:
            pass
    data = b"".join(chunks)
    if not data:
        return 0, b""
    return int(data.split(b" ", 2)[1]), data


@pytest.mark.parametrize(
    ("host", "origin"),
    [
        ("evil.example:{port}", None),  # DNS rebinding
        ("127.0.0.1:{port}", "https://evil.example"),  # web page CSRF
    ],
)
def test_forbidden_request_is_answered_without_waiting_for_its_body(port, host, origin):
    """A request that fails the Host/Origin check must not make the server buffer its body:
    the 403 comes at once and the connection closes (no 16 MB read on behalf of a web page)."""
    head = (
        "POST /pair/complete HTTP/1.1\r\n"
        f"Host: {host.format(port=port)}\r\n"
        + (f"Origin: {origin}\r\n" if origin else "")
        + "Content-Type: application/json\r\n"
        + "Content-Length: 1000000\r\n\r\n"
    )
    t0 = time.monotonic()
    status, data = _raw(port, head)
    assert status == 403, data[:200]
    assert time.monotonic() - t0 < 2.5
    assert b"access-control-allow-origin" not in data.lower()


def test_allowed_request_with_body_still_works(port, calls):
    body = json.dumps({"code": "123456", "name": "x"})
    head = (
        "POST /pair/complete HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        f"Origin: {EXT_ORIGIN}\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n\r\n" + body
    )
    status, _ = _raw(port, head)
    assert status == 200
    assert calls == ["pair_complete"]


@pytest.mark.parametrize("path", [r.path.replace("{id}", "q1") for r in _mount.ROUTES if r.auth])
def test_every_device_route_requires_a_token(port, calls, path):
    route = next(r for r in _mount.ROUTES if r.path.replace("{id}", "q1") == path)
    head = (
        f"{route.method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
        f"Origin: {EXT_ORIGIN}\r\nContent-Length: 0\r\n\r\n"
    )
    status, _ = _raw(port, head)
    assert status == 401
    assert calls == []


def test_null_origin_is_refused(port):
    head = (
        f"GET /ext/state HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: null\r\n"
        "Authorization: Bearer tok-dev-1\r\n\r\n"
    )
    status, _ = _raw(port, head)
    assert status == 403


# ------------------------------------------------------------------ pairing (real DeviceAuth)


@pytest.fixture
def auth(tmp_path: Path) -> Iterator[DV.DeviceAuthImpl]:
    db = core_db.build(path=str(tmp_path / "pair.db"))
    yield DV.DeviceAuthImpl(db=db, settings=FakeSettings(), clock=FakeClock())
    db.close()


def test_pairing_code_locks_after_five_wrong_attempts(auth):
    code = auth.start_pairing().code
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(DV.MAX_ATTEMPTS - 1):
        with pytest.raises(T.PairingFailed) as exc:
            auth.complete_pairing(wrong, "x")
        assert exc.value.reason == "invalid_code"
    with pytest.raises(T.PairingFailed) as exc:
        auth.complete_pairing(wrong, "x")
    assert exc.value.reason == "locked"
    with pytest.raises(T.PairingFailed) as exc:
        auth.complete_pairing(code, "x")  # the right code no longer works
    assert exc.value.reason == "locked"


def test_only_hashes_are_stored(auth):
    code = auth.start_pairing().code
    paired = auth.complete_pairing(code, "Chrome", origin=EXT_ORIGIN)
    devices = [dict(r) for r in auth.db.query("SELECT * FROM devices")]
    codes = [dict(r) for r in auth.db.query("SELECT * FROM pair_codes")]
    assert paired.token not in json.dumps(devices + codes, default=str)
    assert devices[0]["token_hash"] == DV.token_hash(paired.token)
    salt, _, digest = codes[0]["code_hash"].partition("$")
    assert salt and len(digest) == 64 and code not in (salt, digest)
    assert len(paired.token) >= len(DV.TOKEN_PREFIX) + 43  # 32 random bytes, base64url


def test_pairing_code_expires(auth):
    code = auth.start_pairing().code
    auth.clock.advance(DV.PAIRING_TTL_S)
    with pytest.raises(T.PairingFailed) as exc:
        auth.complete_pairing(code, "x")
    assert exc.value.reason == "expired"
