"""The extension checks that the server is this Hermes before it trusts it.

- Pairing by PAKE (``ext/proof.py`` + ``ext/pair.py``): the code never travels; only a server that
  knows the code, answering on the port the extension dialled, produces the confirmation; every
  round-1 costs one attempt of the code; the code path without PAKE keeps working.
- ``GET /health?device=&nonce=`` answers ``proof = HMAC(sha256(token), nonce|port)`` for a live
  device only.
"""

from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import random
import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeSettings

from tube_pkg import wiring
from tube_pkg.api import pair as api_pair
from tube_pkg.core import db as core_db
from tube_pkg.core import devices as DV
from tube_pkg.ext import _mount, _server
from tube_pkg.ext import pair as ext_pair
from tube_pkg.ext import proof as PR

ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
PORT = 47616


@pytest.fixture(autouse=True)
def _fresh_sessions() -> Iterator[None]:
    PR.SESSIONS.clear()
    yield
    PR.SESSIONS.clear()


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "pairing.db"))
    yield db
    db.close()


@pytest.fixture
def auth(rdb: Any, clock: FakeClock) -> DV.DeviceAuthImpl:
    return DV.build(db=rdb, settings=FakeSettings(), clock=clock)


def _q(port: int = PORT) -> dict[str, str]:
    return {_mount.ORIGIN_QUERY_KEY: ORIGIN, _mount.PORT_QUERY_KEY: str(port)}


def _round1(auth: Any, code: str, port: int = PORT, server_port: int | None = None) -> Any:
    a, x = PR.client_start(code)
    env = ext_pair.pair_complete(
        None, {"name": "Chrome", "pake": {"x": x}}, _q(server_port or port), devices=auth
    )
    return a, x, env


def _remaining(auth: Any, code: str) -> int:
    """Attempts left: spends one wrong attempt to read the counter."""
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    env = ext_pair.pair_complete(None, {"code": wrong, "name": "x"}, _q(), devices=auth)
    return int(env["error"]["details"]["remaining"]) + 1


# --------------------------------------------------------------------------- group


def _probable_prime(n: int) -> bool:
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def test_group_is_a_safe_prime_and_the_constants_are_in_the_subgroup() -> None:
    assert PR.P.bit_length() == 2048 and PR.P % 8 == 7
    assert _probable_prime(PR.P) and _probable_prime(PR.Q)
    for e in (PR.G, PR.M, PR.N):
        assert 1 < e < PR.P - 1 and pow(e, PR.Q, PR.P) == 1
    assert PR.M != PR.N
    # the extension derives the same M and N (same values in extension/test/pake.test.ts)
    assert hashlib.sha256(PR.to_hex(PR.M).encode()).hexdigest()[:16] == "11592b14d066750d"
    assert hashlib.sha256(PR.to_hex(PR.N).encode()).hexdigest()[:16] == "1708fd85260dc428"


def test_known_answer_vector_matches_the_extension() -> None:
    """Fixed scalars: the same numbers are checked in extension/test/pake.test.ts."""
    code, a, b = "482913", 0x1234567, 0x7654321
    w = PR.password_scalar(code)
    assert hex(w)[:18] == "0x76ea58423e78e5cb"
    x = pow(PR.G, a, PR.P) * pow(PR.M, w, PR.P) % PR.P
    y = pow(PR.G, b, PR.P) * pow(PR.N, w, PR.P) % PR.P
    k = pow(y * pow(PR.N, PR.Q - w, PR.P) % PR.P, a, PR.P)
    assert k == pow(x * pow(PR.M, PR.Q - w, PR.P) % PR.P, b, PR.P)
    key = PR.session_key(PORT, x, y, k)
    assert hashlib.sha256(PR.to_hex(x).encode()).hexdigest()[:16] == "ecfcb15587aa5d5d"
    assert hashlib.sha256(PR.to_hex(y).encode()).hexdigest()[:16] == "91b5d9eb3a51733c"
    assert PR.confirm(key, "server")[:16] == "1e2ed59761ffcc92"
    assert PR.confirm(key, "client")[:16] == "53ee2422b94d6c44"
    th = hashlib.sha256(b"tok_test").hexdigest()
    assert PR.server_proof(th, "ab" * 16, PORT)[:16] == "2cf5ecdbc3f73a6a"


@pytest.mark.parametrize("bad", ["", "1", "0" * 512, PR.to_hex(1), PR.to_hex(PR.P - 1), "z" * 512])
def test_elements_outside_the_subgroup_are_refused(bad: str) -> None:
    assert PR.parse_element(bad) is None
    assert PR.server_round("123456", bad, PORT) is None


def test_non_residue_is_refused() -> None:
    # 3 is not a square mod p (p ≡ 7 mod 12 would make it one; check directly)
    nonres = next(v for v in range(3, 50) if pow(v, PR.Q, PR.P) != 1)
    assert PR.parse_element(PR.to_hex(nonres)) is None


def test_recover_code_from_the_stored_hash() -> None:
    salt = "a1b2c3d4e5f60718"
    stored = f"{salt}${hashlib.sha256((salt + '000123').encode()).hexdigest()}"
    assert PR.recover_code(stored) == "000123"
    assert PR.recover_code("no-dollar") is None
    assert PR.recover_code(f"{salt}${'0' * 64}") is None


# --------------------------------------------------------------------------- handler


def test_pake_pairing_never_sends_the_code_and_pins_the_origin(auth: Any) -> None:
    code = auth.start_pairing().code
    a, x, env = _round1(auth, code)
    assert env["ok"] is True, env
    pake = env["data"]["pake"]
    assert set(pake) == {"session", "y", "confirm", "remaining"}
    assert pake["remaining"] == 4
    key = PR.client_finish(code, a, x, pake["y"], PORT)
    assert key is not None and PR.same(pake["confirm"], PR.confirm(key, "server"))
    body = {
        "name": "Chrome",
        "pake": {"session": pake["session"], "confirm": PR.confirm(key, "client")},
    }
    env = ext_pair.pair_complete(None, body, _q(), devices=auth)
    assert env["ok"] is True, env
    assert env["data"]["device"]["origin"] == ORIGIN
    assert auth.verify(env["data"]["token"]).id == env["data"]["device"]["id"]
    assert auth.pairing_open() is False
    # the session is single use
    env = ext_pair.pair_complete(None, body, _q(), devices=auth)
    assert env["ok"] is False and env["error"]["code"] == "expired"


def test_an_impostor_without_the_code_cannot_confirm(auth: Any) -> None:
    """The extension holds the right code; the server's answer must match it."""
    code = auth.start_pairing().code
    wrong = f"{(int(code) + 7) % 1_000_000:06d}"
    a, x, env = _round1(auth, wrong)
    key = PR.client_finish(wrong, a, x, env["data"]["pake"]["y"], PORT)
    assert key is not None
    assert not PR.same(env["data"]["pake"]["confirm"], PR.confirm(key, "server"))


def test_relay_to_the_real_server_on_another_port_does_not_confirm(auth: Any) -> None:
    code = auth.start_pairing().code
    a, x, env = _round1(auth, code, port=PORT, server_port=PORT + 3)
    key = PR.client_finish(code, a, x, env["data"]["pake"]["y"], PORT)
    assert key is not None
    assert not PR.same(env["data"]["pake"]["confirm"], PR.confirm(key, "server"))


def test_each_round_one_spends_an_attempt_and_the_code_locks(auth: Any) -> None:
    code = auth.start_pairing().code
    for _ in range(4):
        _a, _x, env = _round1(auth, "000000")
        assert env["ok"] is True
    _a, _x, env = _round1(auth, "000000")
    assert env["ok"] is False and env["error"]["code"] == "locked"
    # the right code does not help any more
    _a, _x, env = _round1(auth, code)
    assert env["error"]["code"] in {"locked", "no_active_code"}


def test_a_wrong_client_confirmation_spends_an_attempt(auth: Any) -> None:
    code = auth.start_pairing().code
    _a, _x, env = _round1(auth, code)
    body = {
        "name": "Chrome",
        "pake": {"session": env["data"]["pake"]["session"], "confirm": "00" * 32},
    }
    env = ext_pair.pair_complete(None, body, _q(), devices=auth)
    assert env["ok"] is False and env["error"]["code"] == "invalid_code"
    assert env["error"]["details"] == {"remaining": 3}
    assert _remaining(auth, code) == 3  # round 1 + wrong confirmation


def test_success_resets_the_attempts(auth: Any) -> None:
    code = auth.start_pairing().code
    a, x, env = _round1(auth, code)
    key = PR.client_finish(code, a, x, env["data"]["pake"]["y"], PORT)
    assert key is not None
    body = {
        "name": "C",
        "pake": {"session": env["data"]["pake"]["session"], "confirm": PR.confirm(key, "client")},
    }
    assert ext_pair.pair_complete(None, body, _q(), devices=auth)["ok"] is True
    code2 = auth.start_pairing().code
    assert _remaining(auth, code2) == 5


def test_a_new_code_between_the_rounds_ends_the_session(auth: Any) -> None:
    code = auth.start_pairing().code
    a, x, env = _round1(auth, code)
    key = PR.client_finish(code, a, x, env["data"]["pake"]["y"], PORT)
    assert key is not None
    auth.start_pairing()
    body = {
        "name": "C",
        "pake": {"session": env["data"]["pake"]["session"], "confirm": PR.confirm(key, "client")},
    }
    env = ext_pair.pair_complete(None, body, _q(), devices=auth)
    assert env["ok"] is False and env["error"]["code"] == "no_active_code"


@pytest.mark.parametrize(
    "body",
    [
        {"name": "x", "pake": {}},
        {"name": "x", "pake": {"x": 5}},
        {"name": "x", "pake": "abc"},
        {"name": "x", "pake": {"session": "s"}},
        {"pake": {"x": "ab"}},
    ],
)
def test_malformed_pake_bodies_are_invalid_and_spend_nothing(auth: Any, body: Any) -> None:
    code = auth.start_pairing().code
    env = ext_pair.pair_complete(None, body, _q(), devices=auth)
    assert env["ok"] is False and env["error"]["code"] == "invalid"
    assert _remaining(auth, code) == 5


def test_round_one_without_the_server_port_is_invalid(auth: Any) -> None:
    auth.start_pairing()
    _a, x = PR.client_start("123456")
    env = ext_pair.pair_complete(
        None, {"name": "x", "pake": {"x": x}}, {_mount.ORIGIN_QUERY_KEY: ORIGIN}, devices=auth
    )
    assert env["ok"] is False and env["error"]["code"] == "invalid"


def test_no_active_code_answers_before_any_work(auth: Any) -> None:
    _a, _x, env = _round1(auth, "123456")
    assert env["ok"] is False and env["error"]["code"] == "no_active_code"


def test_the_plain_code_still_pairs(auth: Any) -> None:
    code = auth.start_pairing().code
    env = ext_pair.pair_complete(None, {"code": code, "name": "Old"}, _q(), devices=auth)
    assert env["ok"] is True and env["data"]["token"].startswith("tok_")


# --------------------------------------------------------------------------- real server


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
    port: int, method: str, path: str, body: Any = None, *, origin: str | None = ORIGIN
) -> Any:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"Host": f"127.0.0.1:{port}", "Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin
    try:
        conn.request(
            method,
            path,
            body=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        resp = conn.getresponse()
        return resp.status, json.loads(resp.read() or b"{}")
    finally:
        conn.close()


@pytest.fixture
def live(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, rdb: Any, auth: Any
) -> Iterator[tuple[int, str]]:
    base = _free_block()
    data_dir = tmp_path / "plugin-data"
    real_ensure = _server.ensure_server

    def in_test_range(**kwargs: Any) -> int | None:
        kwargs.update(port_base=base, port_span=3)
        return real_ensure(**kwargs)

    monkeypatch.setattr(_server, "ensure_server", in_test_range)
    monkeypatch.setattr(wiring, "get_devices", lambda: auth)
    monkeypatch.setattr(wiring, "get_db", lambda: rdb)
    settings = FakeSettings()
    monkeypatch.setattr(wiring, "get_settings", lambda: settings)
    monkeypatch.setattr(wiring, "data_dir", lambda: data_dir)
    try:
        env = api_pair.post_pair_start({}, {})
        assert env["ok"] is True, env
        yield int(env["data"]["port"]), str(env["data"]["code"])
    finally:
        _server.stop_local(data_dir)
        wiring.reset()


def test_end_to_end_pake_and_health_proof(live: tuple[int, str], auth: Any) -> None:
    port, code = live
    a, x = PR.client_start(code)
    # a forged port in the query is dropped: the server uses the port it listens on
    status, env = _call(
        port,
        "POST",
        f"/pair/complete?{_mount.PORT_QUERY_KEY}={port + 1}",
        {"name": "Chrome", "pake": {"x": x}},
    )
    assert status == 200, env
    pake = env["data"]["pake"]
    key = PR.client_finish(code, a, x, pake["y"], port)
    assert key is not None and PR.same(pake["confirm"], PR.confirm(key, "server"))
    status, env = _call(
        port,
        "POST",
        "/pair/complete",
        {
            "name": "Chrome",
            "pake": {"session": pake["session"], "confirm": PR.confirm(key, "client")},
        },
    )
    assert status == 200, env
    token, device_id = env["data"]["token"], env["data"]["device"]["id"]

    nonce = "ab" * 16
    status, health = _call(port, "GET", f"/health?device={device_id}&nonce={nonce}", origin=None)
    assert status == 200
    th = hashlib.sha256(token.encode()).hexdigest()
    want = hmac.new(
        th.encode(), f"hermestube-server-v1|{nonce}|{port}".encode(), hashlib.sha256
    ).hexdigest()
    assert health["data"]["proof"] == want
    assert set(health["data"]) == {"service", "instance", "pairing_open", "proof"}
    # no proof: unknown device, bad nonce, no parameters, revoked device
    for q in (f"device=dev_nobody&nonce={nonce}", f"device={device_id}&nonce=xyz", ""):
        status, h = _call(port, "GET", f"/health?{q}" if q else "/health", origin=None)
        assert status == 200 and "proof" not in h["data"], q
    auth.revoke(device_id)
    status, h = _call(port, "GET", f"/health?device={device_id}&nonce={nonce}", origin=None)
    assert "proof" not in h["data"]
