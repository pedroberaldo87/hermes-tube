"""Pairing and device auth (``core/devices.py``, ``ext/pair.py``, ``ext/auth.py``,
``api/pair.py``, ``rpc/pair.py``).

Real database (``core.db.build``) and a fake clock. Conformance runs the same script against the
fake (``FakeDeviceAuth``) and the real one. The end-to-end test starts the extension server on a
test port range (20000–40000, never 47615–47624) with the real ``wiring`` handlers.
"""

from __future__ import annotations

import hashlib
import http.client
import importlib.util
import inspect
import json
import random
import re
import socket
import sys
import threading
import types
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeDeviceAuth, FakeSettings

from tube_pkg import wiring
from tube_pkg.api import _common as common
from tube_pkg.api import pair as api_pair
from tube_pkg.core import db as core_db
from tube_pkg.core import devices as DV
from tube_pkg.core import types as T
from tube_pkg.ext import _mount, _server
from tube_pkg.ext import auth as ext_auth
from tube_pkg.ext import pair as ext_pair
from tube_pkg.rpc import pair as rpc_pair

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
OTHER_ORIGIN = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba"


def _load_by_path(name: str, path: Path) -> types.ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_b07", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)


def _validate_ok(operation_id: str, env: Any) -> None:
    """``ok`` envelope; ``data`` checked strictly against the operation's ``x-data``/``result``."""
    op = gen_types.get_operation(CONTRACT, operation_id)
    assert common.is_envelope(env) and env["ok"] is True, env
    assert set(env) == {"ok", "data"}
    gen_types.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)


def _validate_error(operation_id: str, env: Any, code: str) -> None:
    op = gen_types.get_operation(CONTRACT, operation_id)
    gen_types.validate_instance(
        {"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True
    )
    assert env["error"]["code"] == code, env
    assert code in set(op.errors) | {"internal"}, (operation_id, code)


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "b07.db"


@pytest.fixture
def rdb(db_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(db_path))
    yield db
    db.close()


@pytest.fixture
def auth(rdb: Any, clock: FakeClock) -> DV.DeviceAuthImpl:
    return DV.build(db=rdb, settings=FakeSettings(), clock=clock)


def _reason(fn: Any, *args: Any, **kwargs: Any) -> str:
    with pytest.raises(T.PairingFailed) as info:
        fn(*args, **kwargs)
    return info.value.reason


def _wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


# =========================================================================== core


def test_build_signature_and_protocol(auth: Any) -> None:
    spec = next(s for s in T.BUILDS if s.provides == "devices")
    assert spec.module == "plugin/core/devices.py"
    params = inspect.signature(DV.build).parameters
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params.values())
    assert set(spec.deps) <= set(params) and "clock" in params
    assert isinstance(auth, T.DeviceAuth)
    assert not getattr(auth, "__contract_stub__", None)
    for name, member in inspect.getmembers(T.DeviceAuth, inspect.isfunction):
        if name.startswith("_"):
            continue
        want = list(inspect.signature(member).parameters)
        got = list(inspect.signature(getattr(type(auth), name)).parameters)
        assert got == want, name


def test_start_pairing_six_digits_300s(auth: Any, clock: FakeClock) -> None:
    assert auth.pairing_open() is False
    code = auth.start_pairing()
    assert isinstance(code, T.PairingCode)
    assert re.fullmatch(r"[0-9]{6}", code.code)
    assert code.expires_at == clock.now() + 300 == clock.now() + DV.PAIRING_TTL_S
    assert auth.pairing_open() is True


def test_complete_pairing_returns_token_and_pins_origin(auth: Any, clock: FakeClock) -> None:
    code = auth.start_pairing()
    clock.advance(10)
    paired = auth.complete_pairing(code.code, "  Chrome — Mac  ", origin=ORIGIN)
    assert isinstance(paired, T.PairedDevice)
    device = paired.device
    assert device.name == "Chrome — Mac"
    assert device.origin == ORIGIN
    assert device.created_at == clock.now()
    assert device.last_seen is None and device.revoked_at is None
    assert device.id.startswith("dev_")
    # Bearer token of 32 random bytes (urlsafe) with a prefix
    assert paired.token.startswith(DV.TOKEN_PREFIX)
    assert len(paired.token) == len(DV.TOKEN_PREFIX) + 43
    assert auth.pairing_open() is False, "a used code closes pairing"
    assert [d.id for d in auth.list()] == [device.id]

    clock.advance(5)
    seen = auth.verify(paired.token)
    assert seen.id == device.id and seen.last_seen == clock.now() and seen.origin == ORIGIN
    assert auth.list()[0].last_seen == clock.now(), "verify stores last_seen"


def test_origin_is_optional(auth: Any) -> None:
    code = auth.start_pairing()
    paired = auth.complete_pairing(code.code, "curl")
    assert paired.device.origin is None
    assert auth.verify(paired.token).origin is None


def test_expired_code(auth: Any, clock: FakeClock) -> None:
    code = auth.start_pairing()
    clock.advance(299)
    assert auth.pairing_open() is True
    clock.advance(1)
    assert auth.pairing_open() is False
    assert _reason(auth.complete_pairing, code.code, "tarde") == "expired"
    assert _reason(auth.complete_pairing, code.code, "tarde") == "expired", "segue expirado"
    assert auth.list() == []


def test_reused_code(auth: Any) -> None:
    code = auth.start_pairing()
    auth.complete_pairing(code.code, "primeiro")
    assert _reason(auth.complete_pairing, code.code, "segundo") == "used"
    assert len(auth.list()) == 1


def test_wrong_code_counts_and_locks_after_five(auth: Any) -> None:
    code = auth.start_pairing()
    wrong = _wrong(code.code)
    remaining = []
    for _ in range(4):
        with pytest.raises(T.PairingFailed) as info:
            auth.complete_pairing(wrong, "x")
        assert info.value.reason == "invalid_code"
        remaining.append(info.value.details.get("remaining"))
    assert remaining == [4, 3, 2, 1]
    assert auth.pairing_open() is True
    assert _reason(auth.complete_pairing, wrong, "x") == "locked"
    assert auth.pairing_open() is False, "locked is not open"
    assert _reason(auth.complete_pairing, code.code, "x") == "locked", "not even the right code"
    assert auth.list() == []
    # a new code unlocks
    fresh = auth.start_pairing()
    assert auth.pairing_open() is True
    assert auth.complete_pairing(fresh.code, "ok").device.name == "ok"


def test_new_code_invalidates_previous(auth: Any) -> None:
    first = auth.start_pairing()
    second = auth.start_pairing()
    if first.code == second.code:  # 1 in 10⁶: generate another
        second = auth.start_pairing()
    assert _reason(auth.complete_pairing, first.code, "velho") == "invalid_code"
    paired = auth.complete_pairing(second.code, "novo")
    assert auth.verify(paired.token).name == "novo"


def test_no_active_code(auth: Any) -> None:
    assert _reason(auth.complete_pairing, "123456", "x") == "no_active_code"
    code = auth.start_pairing()
    auth.complete_pairing(code.code, "x")
    assert _reason(auth.complete_pairing, _wrong(code.code), "y") == "no_active_code"


def test_attempt_is_committed_before_raising(auth: Any, db_path: Path, clock: FakeClock) -> None:
    """Error raised **after** the COMMIT: another connection (another process) sees the attempt."""
    code = auth.start_pairing()
    wrong = _wrong(code.code)
    for _ in range(3):
        with pytest.raises(T.PairingFailed):
            auth.complete_pairing(wrong, "x")
    other_db = core_db.build(path=str(db_path))
    try:
        other = DV.build(db=other_db, settings=FakeSettings(), clock=clock)
        with pytest.raises(T.PairingFailed) as info:
            other.complete_pairing(wrong, "x")
        assert info.value.reason == "invalid_code" and info.value.details["remaining"] == 1
        assert _reason(other.complete_pairing, wrong, "x") == "locked"
    finally:
        other_db.close()
    assert _reason(auth.complete_pairing, code.code, "x") == "locked"


def test_concurrent_wrong_attempts_lock_exactly_once(db_path: Path, rdb: Any) -> None:
    clock = FakeClock()
    auth = DV.build(db=rdb, settings=FakeSettings(), clock=clock)
    code = auth.start_pairing()
    wrong = _wrong(code.code)
    reasons: list[str] = []
    lock = threading.Lock()

    def worker() -> None:
        own = core_db.build(path=str(db_path))
        try:
            mine = DV.build(db=own, settings=FakeSettings(), clock=clock)
            for _ in range(3):
                try:
                    mine.complete_pairing(wrong, "x")
                except T.PairingFailed as exc:
                    with lock:
                        reasons.append(exc.reason)
        finally:
            own.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert len(reasons) == 12
    assert reasons.count("invalid_code") == 4
    assert reasons.count("locked") == 8


def test_verify_rejects_unknown_empty_and_revoked(auth: Any, clock: FakeClock) -> None:
    for bad in ("", "tok_nada", "x" * 200):
        with pytest.raises(T.Unauthorized):
            auth.verify(bad)
    code = auth.start_pairing()
    paired = auth.complete_pairing(code.code, "Chrome")
    assert auth.revoke(paired.device.id) is True
    with pytest.raises(T.Unauthorized) as info:
        auth.verify(paired.token)
    assert not isinstance(info.value, T.PairingFailed)
    first = next(r["revoked_at"] for r in auth.db.query("SELECT revoked_at FROM devices"))
    clock.advance(100)
    assert auth.revoke(paired.device.id) is True, "idempotente"
    assert auth.db.query_one("SELECT revoked_at FROM devices")["revoked_at"] == first
    assert auth.revoke("dev_nao_existe") is False
    assert auth.list() == []


def test_list_and_any_seen_within(auth: Any, clock: FakeClock) -> None:
    tokens = []
    for name in ("a", "b"):
        code = auth.start_pairing()
        tokens.append(auth.complete_pairing(code.code, name).token)
        clock.advance(1)
    assert [d.name for d in auth.list()] == ["a", "b"]
    assert auth.any_seen_within() is False, "never seen"
    auth.verify(tokens[0])
    assert auth.any_seen_within(60) is True
    clock.advance(61)
    assert auth.any_seen_within(60) is False
    assert auth.any_seen_within(61) is True
    auth.revoke(auth.list()[0].id)
    assert auth.any_seen_within(10_000) is False, "revoked does not count"


def test_db_keeps_only_hashes(auth: Any, rdb: Any, db_path: Path) -> None:
    codes = [auth.start_pairing() for _ in range(3)]
    paired = auth.complete_pairing(codes[-1].code, "Chrome", origin=ORIGIN)
    auth.verify(paired.token)
    rows = rdb.query("SELECT token_hash FROM devices")
    assert rows == [{"token_hash": hashlib.sha256(paired.token.encode()).hexdigest()}]
    blob = b""
    for suffix in ("", "-wal", "-shm"):
        path = Path(str(db_path) + suffix)
        if path.exists():
            blob += path.read_bytes()
    assert blob, "empty database?"
    secret = paired.token[len(DV.TOKEN_PREFIX) :]
    assert paired.token.encode() not in blob and secret.encode() not in blob
    for code in codes:
        assert code.code.encode() not in blob, "plaintext code in the database"
    for row in rdb.query("SELECT code_hash FROM pair_codes"):
        assert all(c.code not in row["code_hash"] for c in codes)


def test_pairing_open_matches_server_default_reader(auth: Any, rdb: Any, clock: FakeClock) -> None:
    """The default ``_server`` reader (``pair_codes``) agrees with ``pairing_open`` also when
    locked (the real one closes the locked code in ``pair_codes``)."""
    sql = "SELECT 1 FROM pair_codes WHERE used_at IS NULL AND expires_at > ?"  # = _server
    code = auth.start_pairing()
    assert rdb.query(sql, (clock.now(),)) != []
    for _ in range(5):
        with pytest.raises(T.PairingFailed):
            auth.complete_pairing(_wrong(code.code), "x")
    assert auth.pairing_open() is False
    assert rdb.query(sql, (clock.now(),)) == []
    auth.start_pairing()
    assert auth.pairing_open() is True and len(rdb.query(sql, (clock.now(),))) == 1


# --------------------------------------------------------------------------- conformidade


@pytest.fixture(params=["fake", "real"])
def impl(request: pytest.FixtureRequest, rdb: Any) -> tuple[Any, FakeClock]:
    clock = FakeClock(1000)
    if request.param == "fake":
        return FakeDeviceAuth(clock=clock), clock
    return DV.build(db=rdb, settings=FakeSettings(), clock=clock), clock


def test_conformance_with_fake(impl: tuple[Any, FakeClock]) -> None:
    """The ``tests/test_fakes.py::test_device_auth_and_search_jobs`` script on both."""
    auth, clock = impl
    ttl = getattr(auth, "PAIRING_TTL_S", 300)
    first = auth.start_pairing()
    second = auth.start_pairing()
    with pytest.raises(T.Unauthorized):
        auth.complete_pairing(first.code, "velho")
    paired = auth.complete_pairing(second.code, "Chrome", origin=ORIGIN)
    assert paired.device.origin == ORIGIN
    with pytest.raises(T.Unauthorized):
        auth.complete_pairing(second.code, "de novo")
    assert auth.verify(paired.token).id == paired.device.id
    assert auth.any_seen_within(60)
    clock.advance(61)
    assert not auth.any_seen_within(60)
    expired = auth.start_pairing()
    assert auth.pairing_open()
    clock.advance(ttl + 1)
    assert not auth.pairing_open()
    with pytest.raises(T.Unauthorized):
        auth.complete_pairing(expired.code, "tarde")
    assert auth.revoke(paired.device.id) and auth.revoke(paired.device.id)
    assert auth.revoke("nao-existe") is False
    with pytest.raises(T.Unauthorized):
        auth.verify(paired.token)
    assert auth.list() == []


# =========================================================================== ext/auth.py


def _paired(auth: Any, origin: str | None = ORIGIN) -> T.PairedDevice:
    return auth.complete_pairing(auth.start_pairing().code, "Chrome", origin=origin)


def test_authenticate_bearer(auth: Any) -> None:
    assert common.is_real(ext_auth.authenticate)
    paired = _paired(auth)
    device = ext_auth.authenticate(f"Bearer {paired.token}", ORIGIN, devices=auth)
    assert device.id == paired.device.id
    assert ext_auth.authenticate(f"bearer  {paired.token} ", None, devices=auth).id == device.id
    for header in (None, "", "Bearer", f"Basic {paired.token}", "Bearer tok_errado"):
        with pytest.raises(T.Unauthorized):
            ext_auth.authenticate(header, ORIGIN, devices=auth)
    with pytest.raises(_mount.TransportError) as info:
        ext_auth.authenticate(f"Bearer {paired.token}", OTHER_ORIGIN, devices=auth)
    assert info.value.code == "origin_mismatch"
    auth.revoke(paired.device.id)
    with pytest.raises(T.Unauthorized):
        ext_auth.authenticate(f"Bearer {paired.token}", ORIGIN, devices=auth)


def test_authenticate_without_pinned_origin_accepts_any(auth: Any) -> None:
    paired = _paired(auth, origin=None)
    assert ext_auth.authenticate(f"Bearer {paired.token}", OTHER_ORIGIN, devices=auth)


def test_authenticate_stub_devices_refuses() -> None:
    class Stub:
        __contract_stub__ = "devices"

        def verify(self, token: str) -> T.Device:
            raise NotImplementedError("stub")

    with pytest.raises(T.Unauthorized):
        ext_auth.authenticate("Bearer abc", None, devices=Stub())  # type: ignore[arg-type]


# =========================================================================== ext/pair.py


def test_ext_pair_complete_ok_pins_origin(auth: Any) -> None:
    assert common.is_real(ext_pair.pair_complete) and common.is_real(ext_pair.unpair)
    code = auth.start_pairing()
    env = ext_pair.pair_complete(
        None,
        {"code": code.code, "name": "Chrome — Mac"},
        {_mount.ORIGIN_QUERY_KEY: ORIGIN},
        devices=auth,
    )
    _validate_ok("extPairComplete", env)
    assert env["data"]["device"]["origin"] == ORIGIN
    token = env["data"]["token"]
    assert auth.verify(token).origin == ORIGIN


def test_ext_pair_complete_errors_are_envelopes(auth: Any) -> None:
    env = ext_pair.pair_complete(None, {"code": "123456", "name": "x"}, {}, devices=auth)
    _validate_error("extPairComplete", env, "no_active_code")
    code = auth.start_pairing()
    env = ext_pair.pair_complete(None, {"code": _wrong(code.code), "name": "x"}, {}, devices=auth)
    _validate_error("extPairComplete", env, "invalid_code")
    assert env["error"]["details"] == {"remaining": 4}
    for body in (
        None,
        {},
        {"code": code.code},
        {"code": "12345", "name": "x"},
        {"code": "abcdef", "name": "x"},
        {"code": 123456, "name": "x"},
        {"code": code.code, "name": "   "},
        {"code": code.code, "name": 5},
    ):
        env = ext_pair.pair_complete(None, body, {}, devices=auth)
        _validate_error("extPairComplete", env, "invalid")
    # invalid format does not use up an attempt
    env = ext_pair.pair_complete(None, {"code": _wrong(code.code), "name": "x"}, {}, devices=auth)
    assert env["error"]["details"] == {"remaining": 3}
    env = ext_pair.pair_complete(
        None, {"code": f" {code.code} ", "name": "n" * 200}, {}, devices=auth
    )
    assert env["ok"] is True and len(env["data"]["device"]["name"]) == 80


def test_ext_unpair_revokes_own_device(auth: Any) -> None:
    paired = _paired(auth)
    env = ext_pair.unpair(paired.device, {}, {}, devices=auth)
    _validate_ok("extUnpair", env)
    assert env["data"] == {"revoked": True}
    with pytest.raises(T.Unauthorized):
        auth.verify(paired.token)
    env = ext_pair.unpair(None, {}, {}, devices=auth)  # no device (the mount never does this)
    assert env["ok"] is False and env["error"]["code"] == "unauthorized"


# =========================================================================== api/ + rpc/


@pytest.fixture
def wired(monkeypatch: pytest.MonkeyPatch, auth: Any) -> list[str | None]:
    """``wiring.get_devices`` → real; fake ``ensure_ext_server`` that records the role."""
    roles: list[str | None] = []

    def fake_ensure(*, role: str | None = None) -> int | None:
        roles.append(role)
        return 23456

    monkeypatch.setattr(wiring, "get_devices", lambda: auth)
    monkeypatch.setattr(wiring, "ensure_ext_server", fake_ensure)
    return roles


def test_rest_pair_start_ensures_server_as_host(wired: list, auth: Any, clock: FakeClock) -> None:
    assert common.is_real(api_pair.post_pair_start)
    env = api_pair.post_pair_start({}, {})
    _validate_ok("postPairStart", env)
    assert wired == ["host"]
    data = env["data"]
    assert data["port"] == 23456 and data["expires_at"] == clock.now() + 300
    assert re.fullmatch(r"[0-9]{6}", data["code"])
    assert auth.pairing_open() is True
    assert auth.complete_pairing(data["code"], "x").device.name == "x"


def test_rpc_pair_start_ensures_server_as_gateway(wired: list, auth: Any) -> None:
    assert common.is_real(rpc_pair.pair_start)
    env = rpc_pair.pair_start({}, session_id="s1")
    _validate_ok("pair.start", env)
    assert wired == ["gateway"]
    assert auth.pairing_open() is True


def test_pair_start_without_server_is_ext_endpoint_down(
    monkeypatch: pytest.MonkeyPatch, auth: Any
) -> None:
    monkeypatch.setattr(wiring, "get_devices", lambda: auth)
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: None)
    for env in (api_pair.post_pair_start({}, {}), rpc_pair.pair_start({})):
        _validate_error("postPairStart", env, "ext_endpoint_down")
    assert auth.pairing_open() is False, "no server, no code"


def test_rest_devices_and_revoke(wired: list, auth: Any) -> None:
    assert common.is_real(api_pair.get_devices) and common.is_real(api_pair.post_device_revoke)
    env = api_pair.get_devices(None, {})
    _validate_ok("getDevices", env)
    assert env["data"] == {"items": []}
    paired = _paired(auth)
    env = api_pair.get_devices(None, {})
    _validate_ok("getDevices", env)
    assert [d["id"] for d in env["data"]["items"]] == [paired.device.id]
    env = api_pair.post_device_revoke({}, {"id": paired.device.id})
    _validate_ok("postDeviceRevoke", env)
    assert env["data"] == {"revoked": True}
    assert api_pair.post_device_revoke({}, {"id": paired.device.id})["data"] == {"revoked": True}
    assert api_pair.post_device_revoke({}, {"id": "dev_x"})["data"] == {"revoked": False}
    assert api_pair.get_devices(None, {})["data"] == {"items": []}
    with pytest.raises(T.Unauthorized):
        auth.verify(paired.token)


# =========================================================================== end to end


def _free_block(span: int = 3) -> int:
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


def _call(
    port: int,
    method: str,
    path: str,
    body: Any = None,
    *,
    token: str | None = None,
    origin: str | None = ORIGIN,
) -> tuple[int, dict[str, Any]]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Host": f"127.0.0.1:{port}", "Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    try:
        conn.request(method, path, body=data, headers=headers)
        resp = conn.getresponse()
        return resp.status, json.loads(resp.read() or b"{}")
    finally:
        conn.close()


def test_end_to_end_real_server(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, rdb: Any, auth: Any
) -> None:
    """``POST /pair/start`` (REST) liga o servidor de verdade (``wiring.ensure_ext_server``),
    ``/health.pairing_open`` acompanha, ``/pair/complete`` fixa a origem, ``/ext/unpair`` revoga."""
    base = _free_block()
    data_dir = tmp_path / "plugin-data"
    real_ensure = _server.ensure_server
    roles: list[str | None] = []

    def ensure_in_test_range(**kwargs: Any) -> int | None:
        roles.append(kwargs.get("role"))
        kwargs.update(port_base=base, port_span=3)
        return real_ensure(**kwargs)

    monkeypatch.setattr(_server, "ensure_server", ensure_in_test_range)
    monkeypatch.setattr(wiring, "get_devices", lambda: auth)
    monkeypatch.setattr(wiring, "get_db", lambda: rdb)
    settings = FakeSettings()
    monkeypatch.setattr(wiring, "get_settings", lambda: settings)
    monkeypatch.setattr(wiring, "data_dir", lambda: data_dir)
    try:
        env = api_pair.post_pair_start({}, {})
        assert env["ok"] is True, env
        port = env["data"]["port"]
        assert base <= port < base + 3 and roles == ["host"]
        code = env["data"]["code"]

        status, health = _call(port, "GET", "/health", origin=None)
        assert status == 200 and health["data"]["pairing_open"] is True

        status, err = _call(port, "POST", "/pair/complete", {"code": _wrong(code), "name": "x"})
        assert status == 400 and err["error"]["code"] == "invalid_code"
        assert err["error"]["details"] == {"remaining": 4}

        status, err = _call(
            port, "POST", "/pair/complete", {"code": code, "name": "x"}, origin=None
        )
        assert status == 403 and err["error"]["code"] == "origin_required"

        status, ok = _call(port, "POST", "/pair/complete", {"code": code, "name": "Chrome — Mac"})
        assert status == 200, ok
        _validate_ok("extPairComplete", ok)
        token = ok["data"]["token"]
        assert ok["data"]["device"]["origin"] == ORIGIN

        status, again = _call(port, "POST", "/pair/complete", {"code": code, "name": "x"})
        assert status == 400 and again["error"]["code"] == "used"

        status, health = _call(port, "GET", "/health", origin=None)
        assert health["data"]["pairing_open"] is False

        # RPC reuses the same server and reopens pairing
        rpc_env = rpc_pair.pair_start({})
        assert rpc_env["data"]["port"] == port and roles[-1] == "gateway"
        assert _call(port, "GET", "/health", origin=None)[1]["data"]["pairing_open"] is True

        status, err = _call(port, "POST", "/ext/unpair", {}, token=token, origin=OTHER_ORIGIN)
        assert status == 403 and err["error"]["code"] == "origin_mismatch"
        status, err = _call(port, "POST", "/ext/unpair", {}, token="tok_errado")
        assert status == 401 and err["error"]["code"] == "unauthorized"
        status, ok = _call(port, "POST", "/ext/unpair", {}, token=token, origin=None)
        assert status == 200 and ok == {"ok": True, "data": {"revoked": True}}
        status, err = _call(port, "POST", "/ext/unpair", {}, token=token)
        assert status == 401 and err["error"]["code"] == "unauthorized"
    finally:
        _server.stop_local(data_dir)
        wiring.reset()
