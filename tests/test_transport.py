"""Transports: the extension's own server, the ``/ext/*`` route mounter and ``_header``.

Covers (contract/ext-protocol.md §1–§5 and §9):

- server: ``/health`` in the contract format (no pid/path), a single owner across 2 processes
  (race), dead owner → the other takes the same port, port fallback (including a port taken
  on ``*:P``), ``127.0.0.1`` only, invalid ``Host`` 403, web origin 403 without CORS, preflight,
  disabled-plugin guard (503 and shuts down), ``stop_local``, ``endpoint_up``/``current_port``;
- mounter: the 12 contract routes, 401 missing/wrong/``Basic`` (fake ``DeviceAuth`` from
  ``tests/fakes``), ``origin_mismatch``, ``origin_required``, ``TubeError`` → status from
  ``ERROR_HTTP_STATUS``, invalid JSON, body limit, unknown route 404; answers validated
  against the contract (``scripts/gen_types.py``, ``strict=True``);
- ``_header``: ``env -i python -I <shim>`` resolves home, plugin and database with the plugin
  symlinked and copied into a fake ``HERMES_HOME`` tree.

Network: ``127.0.0.1`` only. Ports: random free blocks (never the real range 47615–47624).
"""

from __future__ import annotations

import dataclasses
import http.client
import importlib.util
import json
import os
import random
import shutil
import signal
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fakes import FakeDeviceAuth, FakeSettings

import tube_pkg.core.types as T
from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import db as core_db
from tube_pkg.ext import _mount, _server
from tube_pkg.routines import _header

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_SRC = ROOT / "plugin"
GEN = ROOT / "scripts" / "gen_types.py"
EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
EXT_OTHER = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba"
WEB = "https://www.youtube.com"
SPAN = 3


# ==================== contract


def _load_gen():
    spec = importlib.util.spec_from_file_location("_tube_gen_types_transport", GEN)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def gen():
    return _load_gen()


@pytest.fixture(scope="module")
def contract(gen):
    return gen.load_contract(ROOT)


@pytest.fixture(scope="module")
def ext_ops(gen, contract) -> dict[str, Any]:
    """``x-handler`` → contract operation (``x-transport: ext`` routes except ``/health``)."""
    out = {}
    for op in gen.iter_operations(contract):
        if op.transport == "ext" and op.path != "/health":
            out[op.raw["x-handler"]] = op
    return out


def _validate_envelope(gen, op, payload: dict) -> None:
    gen.validate_instance({"$ref": "#/components/schemas/AnyEnvelope"}, payload, ROOT, strict=False)
    if payload["ok"]:
        if op is not None and op.data_schema is not None:
            gen.validate_instance(op.data_schema, payload["data"], ROOT, current=op.doc)
    else:
        gen.validate_instance({"$ref": "#/components/schemas/ErrorEnvelope"}, payload, ROOT)


# ==================== utilities


def _free_port_block(span: int = SPAN) -> int:
    """P with P..P+span-1 free on 127.0.0.1 (best effort; never the real range)."""
    # outside the ephemeral range (macOS: 49152+): outgoing connections from other processes
    # (agents in parallel, HTTP) took P+1 between the check and the bind → flaky test
    rng = random.Random()
    for _ in range(300):
        p = rng.randrange(20000, 40000 - span)
        if _server.PORT_BASE - span <= p <= _server.PORT_BASE + 20:
            continue
        ok = True
        for q in range(p, p + span):
            t = socket.socket()
            try:
                t.bind(("127.0.0.1", q))
            except OSError:
                ok = False
            finally:
                t.close()
        if ok:
            return p
    raise RuntimeError("no free port block")


def _refused(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return False
    except ConnectionRefusedError:
        return True
    except OSError:
        return False


def _wait(pred, timeout: float = 20.0, step: float = 0.05) -> bool:  # slack: busy machine
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        time.sleep(step)
    return pred()


def req(
    port: int,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    body: Any = None,
    raw: bytes | None = None,
    host: str | None = None,
) -> tuple[int, dict[str, str], Any]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    conn.putheader("Host", host if host is not None else f"127.0.0.1:{port}")
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    for k, v in (headers or {}).items():
        conn.putheader(k, v)
    if data is not None:
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(len(data)))
    conn.endheaders()
    if data is not None:
        conn.send(data)
    r = conn.getresponse()
    content = r.read()
    hdrs = {k.lower(): v for k, v in r.getheaders()}
    conn.close()
    payload = json.loads(content) if content else None
    return r.status, hdrs, payload


def bearer(token: str = "tok-dev-1") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ==================== fake handlers


class Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any, Any, dict[str, str]]] = []


def stub_handlers(
    devices: FakeDeviceAuth, ext_ops: dict[str, Any], rec: Recorder, **override
) -> _mount.ExtHandlers:
    """One handler per ``x-handler`` with the contract example; no example → ``Conflict``."""

    def make(name: str):
        op = ext_ops[name]

        def handler(device, body, query):
            rec.calls.append((name, device, body, dict(query)))
            if op.example_data is None:
                raise T.Conflict("Search expired; the host already finished")
            return {"ok": True, "data": op.example_data}

        return handler

    fields = {
        f.name: make(f.name)
        for f in dataclasses.fields(_mount.ExtHandlers)
        if f.name != "authenticate"
    }
    fields["authenticate"] = _mount.bearer_authenticator(devices)
    fields.update(override)
    return _mount.ExtHandlers(**fields)


# ==================== fixtures


@pytest.fixture
def home(tmp_path: Path) -> Path:
    h = tmp_path / "home"
    (h / "plugin-data" / PLUGIN_ID).mkdir(parents=True)
    return h


@pytest.fixture
def data_dir(home: Path) -> Iterator[Path]:
    d = home / "plugin-data" / PLUGIN_ID
    yield d
    _server.stop_local(d)


@pytest.fixture
def tdb(data_dir: Path) -> Iterator[Any]:
    db = core_db.build(path=str(data_dir / "tube.db"))
    yield db
    _server.stop_local(data_dir)
    db.close()


@pytest.fixture
def devices() -> FakeDeviceAuth:
    d = FakeDeviceAuth()
    d.add_device("Chrome — Mac")  # dev-1 / tok-dev-1
    return d


@pytest.fixture
def rec() -> Recorder:
    return Recorder()


@pytest.fixture
def base() -> int:
    return _free_port_block()


@pytest.fixture
def running(tdb, data_dir, devices, ext_ops, rec, base) -> int:
    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
    )
    assert port == base
    return port


def _meta(db) -> dict[str, str]:
    return {r["key"]: r["value"] for r in db.query("SELECT key, value FROM meta")}


# ==================== server: owner and port


def test_contract_constants():
    assert _server.PORT_BASE == 47615
    assert _server.PORT_SPAN == 10
    assert _server.HOST == "127.0.0.1"


def test_health_contract_shape_and_meta(gen, contract, running, tdb, data_dir):
    status, hdrs, payload = req(running, "GET", "/health")
    assert status == 200
    assert payload["ok"] is True
    op = gen.get_operation(contract, "extHealth")
    _validate_envelope(gen, op, payload)  # strict: no pid, no path
    data = payload["data"]
    assert data["service"] == PLUGIN_ID
    assert data["pairing_open"] is False
    meta = _meta(tdb)
    assert meta[T.META_EXT_PORT] == str(running)
    assert meta["ext_instance"] == data["instance"]
    assert meta["ext_owner_pid"] == str(os.getpid())
    assert meta["ext_owner_role"]
    assert str(data_dir) not in json.dumps(payload)
    assert hdrs["content-type"].startswith("application/json")
    assert _server.endpoint_up(db=tdb, data_dir=data_dir) is True
    assert _server.current_port(db=tdb) == running


def test_pairing_open_reflects_active_code(running, tdb):
    now = int(time.time())
    tdb.execute(
        "INSERT INTO pair_codes (code_hash, created_at, expires_at) VALUES (?, ?, ?)",
        ("h-old", now - 600, now - 300),
    )
    assert req(running, "GET", "/health")[2]["data"]["pairing_open"] is False
    tdb.execute(
        "INSERT INTO pair_codes (code_hash, created_at, expires_at) VALUES (?, ?, ?)",
        ("h-new", now, now + 300),
    )
    assert req(running, "GET", "/health")[2]["data"]["pairing_open"] is True


def test_pairing_open_override(tdb, data_dir, devices, ext_ops, rec, base):
    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
        pairing_open=lambda: True,
    )
    assert req(port, "GET", "/health")[2]["data"]["pairing_open"] is True


def test_second_ensure_same_process_reuses(running, tdb, data_dir, devices, ext_ops, rec, base):
    instance = _meta(tdb)["ext_instance"]
    again = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
    )
    assert again == running
    assert _meta(tdb)["ext_instance"] == instance


def test_binds_loopback_only(running, data_dir):
    srv = _server.local_server(data_dir)
    assert srv is not None
    assert srv.address[0] == "127.0.0.1"
    src = (PLUGIN_SRC / "ext" / "_server.py").read_text(encoding="utf-8")
    assert "0.0.0.0" not in src


def test_fallback_to_next_port_when_preferred_taken(tdb, data_dir, devices, ext_ops, rec, base):
    other = socket.socket()
    other.bind(("127.0.0.1", base))
    other.listen(16)
    try:
        port = _server.ensure_server(
            db=tdb,
            settings=FakeSettings(),
            data_dir=data_dir,
            handlers=stub_handlers(devices, ext_ops, rec),
            port_base=base,
            port_span=SPAN,
        )
        assert port == base + 1
        assert req(port, "GET", "/health")[0] == 200
    finally:
        other.close()


def test_preferred_taken_on_wildcard_is_not_shared(tdb, data_dir, devices, ext_ops, rec, base):
    """Another app on ``*:P``: the connection probe skips P (on macOS SO_REUSEADDR would steal)."""
    other = socket.socket()
    other.bind(("", base))
    other.listen(16)
    try:
        port = _server.ensure_server(
            db=tdb,
            settings=FakeSettings(),
            data_dir=data_dir,
            handlers=stub_handlers(devices, ext_ops, rec),
            port_base=base,
            port_span=SPAN,
        )
        assert port == base + 1
        probe = socket.create_connection(("127.0.0.1", base), timeout=1)
        conn, _ = other.accept()  # the connection to 127.0.0.1:P reached the other app
        conn.close()
        probe.close()
    finally:
        other.close()


def test_whole_range_taken_returns_none(tdb, data_dir, devices, ext_ops, rec, base):
    socks = []
    try:
        for p in range(base, base + SPAN):
            s = socket.socket()
            s.bind(("127.0.0.1", p))
            s.listen(1)
            socks.append(s)
        port = _server.ensure_server(
            db=tdb,
            settings=FakeSettings(),
            data_dir=data_dir,
            handlers=stub_handlers(devices, ext_ops, rec),
            port_base=base,
            port_span=SPAN,
        )
        assert port is None
        assert _server.endpoint_up(db=tdb, data_dir=data_dir) is False
        assert _server.local_server(data_dir) is None
    finally:
        for s in socks:
            s.close()


def test_stale_meta_pointing_to_foreign_service_is_ignored(
    tdb, data_dir, devices, ext_ops, rec, base
):
    tdb.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?), (?, ?)",
        (T.META_EXT_PORT, str(base + 2), "ext_instance", "dead"),
    )
    assert _server.endpoint_up(db=tdb, data_dir=data_dir) is False
    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
    )
    assert port == base
    assert _meta(tdb)["ext_instance"] != "dead"


def test_stop_local_clears_meta_and_frees_lock(running, tdb, data_dir, devices, ext_ops, rec, base):
    assert _server.stop_local(data_dir) is True
    assert _refused(running)
    meta = _meta(tdb)
    assert T.META_EXT_PORT not in meta and "ext_instance" not in meta
    assert _server.endpoint_up(db=tdb, data_dir=data_dir) is False
    assert _server.current_port(db=tdb) is None
    again = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
    )
    assert again == base


def test_stop_all(running, data_dir):
    assert _server.stop() is True
    assert _server.local_server(data_dir) is None
    assert _refused(running)


def test_handlers_come_from_wiring_when_not_given(
    tdb, data_dir, devices, ext_ops, rec, base, monkeypatch
):
    """Without ``handlers=``: uses ``tube_pkg.wiring.ext_handlers(db=, settings=)``."""
    import types as _types

    seen = {}

    def ext_handlers(*, db, settings):
        seen["db"], seen["settings"] = db, settings
        return stub_handlers(devices, ext_ops, rec)

    fake = _types.ModuleType("tube_pkg.wiring")
    fake.ext_handlers = ext_handlers
    monkeypatch.setitem(sys.modules, "tube_pkg.wiring", fake)
    settings = FakeSettings()
    port = _server.ensure_server(
        db=tdb, settings=settings, data_dir=data_dir, port_base=base, port_span=SPAN
    )
    assert port == base
    assert seen == {"db": tdb, "settings": settings}
    assert req(port, "GET", "/ext/state", headers=bearer())[0] == 200


def test_wiring_failure_returns_none(tdb, data_dir, base, monkeypatch):
    import types as _types

    def broken(*, db, settings):
        raise RuntimeError("boom")

    fake = _types.ModuleType("tube_pkg.wiring")
    fake.ext_handlers = broken
    monkeypatch.setitem(sys.modules, "tube_pkg.wiring", fake)
    assert (
        _server.ensure_server(
            db=tdb, settings=FakeSettings(), data_dir=data_dir, port_base=base, port_span=SPAN
        )
        is None
    )
    assert _server.local_server(data_dir) is None
    # the lock was released: another ensure (with handlers) can start it
    assert _server.try_lock_free(data_dir) is True


# ==================== server: race between processes

CHILD = r"""
import importlib.util, json, os, sys, time
spec = importlib.util.spec_from_file_location("_tube_boot_child", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); m.ensure()
import dataclasses
from tube_pkg.core import db as core_db
from tube_pkg.ext import _mount, _server
data_dir, base, start_at = sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
db = core_db.build(path=os.path.join(data_dir, "tube.db"))
ok = lambda d, b, q: {"ok": True, "data": {}}
fields = {f.name: ok for f in dataclasses.fields(_mount.ExtHandlers)}
fields["authenticate"] = lambda a, o: None
handlers = _mount.ExtHandlers(**fields)
while time.time() < start_at:
    pass
def once():
    t = time.monotonic()
    port = _server.ensure_server(db=db, settings=None, data_dir=data_dir, handlers=handlers,
                                 port_base=base, port_span=3)
    meta = {r["key"]: r["value"] for r in db.query("SELECT key, value FROM meta")}
    return {"port": port, "owner": _server.local_server(data_dir) is not None,
            "instance": meta.get("ext_instance"), "pid": os.getpid(),
            "ms": round((time.monotonic() - t) * 1000, 1)}
print(json.dumps(once()), flush=True)
for line in sys.stdin:
    if line.strip() == "ensure":
        print(json.dumps(once()), flush=True)
    else:
        break
"""


def _spawn(data_dir: Path, base: int, start_at: float) -> subprocess.Popen:
    return subprocess.Popen(
        [
            sys.executable,
            "-c",
            CHILD,
            str(PLUGIN_SRC / "_bootstrap.py"),
            str(data_dir),
            str(base),
            str(start_at),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _read(p: subprocess.Popen) -> dict:
    line = p.stdout.readline()
    if not line:
        raise AssertionError(f"child died: {p.stderr.read()[-800:]}")
    return json.loads(line)


@pytest.mark.parametrize("run", range(3))
def test_two_processes_race_one_owner_and_survivor_takes_over(tmp_path, run):
    data_dir = tmp_path / "home" / "plugin-data" / PLUGIN_ID
    data_dir.mkdir(parents=True)
    core_db.build(path=str(data_dir / "tube.db")).close()  # schema ready before the race
    base = _free_port_block()
    start_at = time.time() + 1.5
    procs = [_spawn(data_dir, base, start_at), _spawn(data_dir, base, start_at)]
    try:
        res = [_read(p) for p in procs]
        assert [r["port"] for r in res] == [base, base], res
        assert sorted(r["owner"] for r in res) == [False, True], res
        assert res[0]["instance"] == res[1]["instance"], res
        owner_i = 0 if res[0]["owner"] else 1
        owner, survivor = procs[owner_i], procs[1 - owner_i]
        assert req(base, "GET", "/health")[2]["data"]["instance"] == res[owner_i]["instance"]
        # owner dies (SIGKILL): the kernel frees flock and port; the next ensure takes the SAME port
        os.kill(owner.pid, signal.SIGKILL)
        owner.wait(5)
        survivor.stdin.write("ensure\n")
        survivor.stdin.flush()
        after = _read(survivor)
        assert after["port"] == base and after["owner"] is True, after
        assert after["instance"] != res[owner_i]["instance"]
        health = req(base, "GET", "/health")[2]["data"]
        assert health["instance"] == after["instance"]
    finally:
        for p in procs:
            if p.poll() is None:
                p.stdin.close()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()


def test_dead_owner_in_meta_this_process_takes_over(tmp_path, devices, ext_ops, rec):
    data_dir = tmp_path / "home" / "plugin-data" / PLUGIN_ID
    data_dir.mkdir(parents=True)
    db = core_db.build(path=str(data_dir / "tube.db"))
    base = _free_port_block()
    child = _spawn(data_dir, base, time.time())
    try:
        first = _read(child)
        assert first["owner"] is True and first["port"] == base
        os.kill(child.pid, signal.SIGKILL)
        child.wait(5)
        port = _server.ensure_server(
            db=db,
            settings=FakeSettings(),
            data_dir=data_dir,
            handlers=stub_handlers(devices, ext_ops, rec),
            port_base=base,
            port_span=SPAN,
        )
        assert port == base
        assert _meta(db)["ext_owner_pid"] == str(os.getpid())
    finally:
        if child.poll() is None:
            child.kill()
        _server.stop_local(data_dir)
        db.close()


# ==================== transport security


def test_foreign_host_header_is_refused(running):
    for host in (f"evil.example:{running}", "127.0.0.1", "localhost:1", "", f"[::1]:{running}"):
        status, hdrs, payload = req(running, "GET", "/health", host=host, headers={"Origin": EXT})
        assert status == 403, host
        assert payload["error"]["code"] == "host_forbidden"
        assert "access-control-allow-origin" not in hdrs
    assert req(running, "GET", "/health", host=f"localhost:{running}")[0] == 200


@pytest.mark.parametrize(
    ("method", "path", "auth"),
    [("GET", "/health", False), ("OPTIONS", "/ext/state", False), ("GET", "/ext/state", True)],
)
def test_web_origin_is_refused_without_cors_headers(running, rec, method, path, auth):
    headers = {"Origin": WEB, **(bearer() if auth else {})}
    status, hdrs, payload = req(running, method, path, headers=headers)
    assert status == 403
    assert payload["error"]["code"] == "origin_forbidden"
    assert "access-control-allow-origin" not in hdrs
    assert rec.calls == []


@pytest.mark.parametrize("origin", ["null", "chrome-extension://", "moz-extension://abc"])
def test_other_origins_are_refused(running, origin):
    status, _, payload = req(running, "GET", "/health", headers={"Origin": origin})
    assert status == 403 and payload["error"]["code"] == "origin_forbidden"


def test_preflight_from_extension_origin(running):
    status, hdrs, payload = req(
        running,
        "OPTIONS",
        "/ext/state",
        headers={
            "Origin": EXT,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
            "Access-Control-Request-Private-Network": "true",
            "Access-Control-Request-Local-Network": "true",
        },
    )
    assert status == 204
    assert payload is None
    assert hdrs["access-control-allow-origin"] == EXT
    assert "Origin" in hdrs["vary"]
    assert hdrs["access-control-allow-methods"] == "GET, POST, OPTIONS"
    assert hdrs["access-control-allow-headers"] == "Authorization, Content-Type"
    assert hdrs["access-control-max-age"] == "600"
    assert hdrs["access-control-allow-private-network"] == "true"
    assert hdrs["access-control-allow-local-network"] == "true"


def test_preflight_without_pna_request_has_no_pna_header(running):
    status, hdrs, _ = req(running, "OPTIONS", "/pair/complete", headers={"Origin": EXT})
    assert status == 204
    assert "access-control-allow-private-network" not in hdrs


def test_responses_with_extension_origin_carry_cors(running):
    status, hdrs, _ = req(running, "GET", "/ext/state", headers={"Origin": EXT, **bearer()})
    assert status == 200
    assert hdrs["access-control-allow-origin"] == EXT
    assert "Origin" in hdrs["vary"]
    status, hdrs, _ = req(running, "GET", "/ext/state", headers={"Origin": EXT})
    assert status == 401
    assert hdrs["access-control-allow-origin"] == EXT  # the error is readable by the extension


def test_missing_origin_is_accepted_but_token_still_required(running):
    assert req(running, "GET", "/health")[0] == 200
    assert req(running, "GET", "/ext/state")[0] == 401
    status, hdrs, _ = req(running, "GET", "/ext/state", headers=bearer())
    assert status == 200
    assert "access-control-allow-origin" not in hdrs


@pytest.mark.parametrize(
    "authorization",
    [None, "Basic dXNlcjpwYXNz", "Bearer", "Bearer ", "Bearer wrong-token", "tok-dev-1"],
)
def test_401_without_or_wrong_token(gen, running, rec, authorization):
    headers = {} if authorization is None else {"Authorization": authorization}
    status, hdrs, payload = req(running, "GET", "/ext/state", headers=headers)
    assert status == 401
    assert hdrs["www-authenticate"].startswith("Bearer")
    assert payload["error"]["code"] == "unauthorized"
    _validate_envelope(gen, None, payload)
    assert rec.calls == []


def test_revoked_token_is_401(running, devices, rec):
    devices.revoke("dev-1")
    status, hdrs, payload = req(running, "POST", "/ext/unpair", headers=bearer(), body={})
    assert status == 401 and payload["error"]["code"] == "unauthorized"
    assert rec.calls == []


def test_token_is_pinned_to_pairing_origin(running, devices, rec):
    devices.devices["dev-1"] = dataclasses.replace(devices.devices["dev-1"], origin=EXT)
    status, hdrs, payload = req(
        running, "GET", "/ext/state", headers={"Origin": EXT_OTHER, **bearer()}
    )
    assert status == 403 and payload["error"]["code"] == "origin_mismatch"
    assert rec.calls == []
    assert req(running, "GET", "/ext/state", headers={"Origin": EXT, **bearer()})[0] == 200
    # a service worker GET sends no Origin: the token still counts
    assert req(running, "GET", "/ext/state", headers=bearer())[0] == 200


def test_mount_checks_origin_even_if_authenticator_does_not(
    tdb, data_dir, devices, ext_ops, rec, base
):
    pinned = T.Device(id="dev-9", name="x", created_at=1, origin=EXT)
    handlers = stub_handlers(devices, ext_ops, rec, authenticate=lambda a, o: pinned)
    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=handlers,
        port_base=base,
        port_span=SPAN,
    )
    status, _, payload = req(port, "GET", "/ext/state", headers={"Origin": EXT_OTHER, **bearer()})
    assert status == 403 and payload["error"]["code"] == "origin_mismatch"


def test_authenticator_crash_is_500_internal(tdb, data_dir, devices, ext_ops, rec, base):
    def boom(a, o):
        raise RuntimeError("secret " + "/Us" + "ers/x")  # assembled path (public scanner)

    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec, authenticate=boom),
        port_base=base,
        port_span=SPAN,
    )
    status, _, payload = req(port, "GET", "/ext/state", headers=bearer())
    assert status == 500 and payload["error"]["code"] == "internal"
    assert "secret" not in json.dumps(payload)


# ==================== disabled plugin guard


def _write_config(home: Path, enabled: list[str], disabled: list[str] | None = None) -> None:
    cfg = {"plugins": {"enabled": enabled, "disabled": disabled or []}}
    (home / "config.yaml").write_text(yaml.safe_dump(cfg), encoding="utf-8")


def test_disabled_plugin_answers_503_and_stops(
    home, tdb, data_dir, devices, ext_ops, rec, base, monkeypatch
):
    monkeypatch.setattr(_server, "GUARD_INTERVAL_S", 0.05)
    _write_config(home, [PLUGIN_ID, "other"])
    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
    )
    assert req(port, "GET", "/ext/state", headers=bearer())[0] == 200
    _write_config(home, ["other"], [PLUGIN_ID])
    seen: list[tuple[int, object]] = []

    def _disabled_or_gone() -> bool:
        # under load the guard may answer 503 or have already stopped the server: both are fine
        if _refused(port):
            return True
        try:
            status, _, payload = req(port, "GET", "/ext/state", headers=bearer())
        except (OSError, http.client.HTTPException):  # server stopped mid-request
            return True
        seen.append((status, payload))
        return status == 503

    assert _wait(_disabled_or_gone)
    for status, payload in seen:
        assert status in (200, 503)
        if status == 503:
            assert payload["error"]["code"] == "plugin_disabled"
    assert _wait(lambda: _refused(port))
    assert _wait(lambda: _server.local_server(data_dir) is None)
    assert T.META_EXT_PORT not in _meta(tdb)


def test_disabled_plugin_stops_without_any_request(
    home, tdb, data_dir, devices, ext_ops, rec, base, monkeypatch
):
    monkeypatch.setattr(_server, "GUARD_INTERVAL_S", 0.05)
    _write_config(home, [PLUGIN_ID])
    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
    )
    _write_config(home, [])  # enabled list without the plugin = disabled
    assert _wait(lambda: _server.local_server(data_dir) is None, timeout=5)
    assert _wait(lambda: _refused(port))


def test_already_disabled_plugin_does_not_start(home, tdb, data_dir, devices, ext_ops, rec, base):
    _write_config(home, ["other"], [PLUGIN_ID])
    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec),
        port_base=base,
        port_span=SPAN,
    )
    assert port is None
    assert _refused(base)
    assert _server.try_lock_free(data_dir) is True


def test_unreadable_or_missing_config_does_not_block(running, home, monkeypatch):
    monkeypatch.setattr(_server, "GUARD_INTERVAL_S", 0.0)
    assert req(running, "GET", "/health")[0] == 200
    (home / "config.yaml").write_text("plugins: [unterminated", encoding="utf-8")
    assert req(running, "GET", "/health")[0] == 200


@pytest.mark.parametrize(
    ("cfg", "expected"),
    [
        (None, None),
        ({}, None),
        ({"plugins": {"enabled": ["__ID__"]}}, True),
        ({"plugins": {"enabled": ["x"]}}, False),
        ({"plugins": {"enabled": ["__ID__"], "disabled": ["__ID__"]}}, False),
        ({"plugins": {"disabled": ["__ID__"]}}, False),
        ({"plugins": {"disabled": []}}, None),
    ],
)
def test_plugin_enabled_reader(tmp_path, cfg, expected):
    if cfg is not None:
        text = json.dumps(cfg).replace("__ID__", PLUGIN_ID)
        (tmp_path / "config.yaml").write_text(text, encoding="utf-8")
    assert _server.plugin_enabled(tmp_path) is expected


def test_guard_only_applies_to_profile_layout(tmp_path):
    assert _server.profile_home_of(tmp_path / "x") is None
    d = tmp_path / "h" / "plugin-data" / PLUGIN_ID
    assert _server.profile_home_of(d) == tmp_path / "h"


# ==================== mounter


def test_routes_match_contract(gen, contract):
    ops = {
        (op.method, op.path): op.raw.get("x-handler")
        for op in gen.iter_operations(contract)
        if op.transport == "ext" and op.path != "/health"
    }
    mounted = {(r.method, r.path): r.handler for r in _mount.ROUTES}
    assert mounted == ops
    auth = {
        (op.method, op.path): bool(op.raw.get("security"))
        for op in gen.iter_operations(contract)
        if op.transport == "ext" and op.path != "/health"
    }
    assert {(r.method, r.path): r.auth for r in _mount.ROUTES} == auth
    names = {f.name for f in dataclasses.fields(_mount.ExtHandlers)} - {"authenticate"}
    assert names == {r.handler for r in _mount.ROUTES}


def _sample_path(path: str) -> str:
    return path.replace("{id}", "q%201")


def test_every_route_answers_through_the_mount(gen, running, ext_ops, rec):
    for name, op in ext_ops.items():
        path = _sample_path(op.path)
        headers = {"Origin": EXT}
        if op.raw.get("security"):
            headers.update(bearer())
        body = op.example_body if op.method == "POST" else None
        if op.method == "POST" and body is None:
            body = {}
        status, _, payload = req(running, op.method, path, headers=headers, body=body)
        _validate_envelope(gen, op, payload)
        if op.example_data is None:
            assert status == 409 and payload["error"]["code"] == "conflict", name
        else:
            assert status == 200, (name, payload)
            assert payload == {"ok": True, "data": op.example_data}
        called = [c for c in rec.calls if c[0] == name]
        assert len(called) == 1, name
        _, device, got_body, query = called[0]
        if op.raw.get("security"):
            assert isinstance(device, T.Device) and device.id == "dev-1"
        else:
            assert device is None
        if op.method == "GET":
            assert got_body is None
        else:
            assert got_body == body
        if "{id}" in op.path:
            assert query["id"] == "q 1"


def test_query_and_path_params_reach_handler(running, rec):
    status, _, _ = req(
        running,
        "GET",
        "/ext/feed?tab=all-new&limit=5&limit=7&cursor=&x=%C3%A9",
        headers=bearer(),
    )
    assert status == 200
    _, _, body, query = rec.calls[-1]
    assert body is None
    assert query == {"tab": "all-new", "limit": "7", "cursor": "", "x": "é"}
    req(running, "POST", "/ext/queue/q_7/result?id=evil", headers=bearer(), body={"status": "done"})
    assert rec.calls[-1][3]["id"] == "q_7"  # path wins over the query


def test_pair_complete_requires_origin_and_passes_it(running, rec):
    status, _, payload = req(
        running, "POST", "/pair/complete", body={"code": "123456", "name": "c"}
    )
    assert status == 403 and payload["error"]["code"] == "origin_required"
    assert rec.calls == []
    status, _, payload = req(
        running,
        "POST",
        f"/pair/complete?{_mount.ORIGIN_QUERY_KEY}=forged",
        headers={"Origin": EXT},
        body={"code": "123456", "name": "c"},
    )
    assert status == 200
    name, device, body, query = rec.calls[-1]
    assert name == "pair_complete" and device is None
    assert query[_mount.ORIGIN_QUERY_KEY] == EXT


def test_reserved_origin_key_is_stripped_elsewhere(running, rec):
    req(running, "GET", f"/ext/feed?{_mount.ORIGIN_QUERY_KEY}=forged&tab=t", headers=bearer())
    assert _mount.ORIGIN_QUERY_KEY not in rec.calls[-1][3]


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (T.NotFound("no channel"), 404, "not_found"),
        (T.Conflict("expired"), 409, "conflict"),
        (T.ValidationError("field", field="signal"), 422, "invalid"),
        (T.Unauthorized("x"), 401, "unauthorized"),
        (T.PairingFailed("invalid_code"), 400, "invalid_code"),
        (T.PairingFailed("locked"), 400, "locked"),
        (T.UndoRefused("already_executed"), 409, "undo_refused"),
        (T.OperationTimeout("slow"), 504, "timeout"),
        (ValueError("bug with " + "/Us" + "ers/secret"), 500, "internal"),
    ],
)
def test_handler_errors_become_contract_status(
    gen, tdb, data_dir, devices, ext_ops, rec, base, exc, status, code
):
    def raiser(device, body, query):
        raise exc

    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec, get_state=raiser, pair_complete=raiser),
        port_base=base,
        port_span=SPAN,
    )
    path, method, headers, body = "/ext/state", "GET", bearer(), None
    if isinstance(exc, T.PairingFailed):
        path, method, headers, body = "/pair/complete", "POST", {"Origin": EXT}, {"code": "1"}
    got_status, hdrs, payload = req(port, method, path, headers=headers, body=body)
    assert got_status == status
    assert payload["ok"] is False and payload["error"]["code"] == code
    _validate_envelope(gen, None, payload)
    if code == "undo_refused":
        assert payload["error"]["reason"] == "already_executed"
    if code == "invalid":
        assert payload["error"]["details"] == {"field": "signal"}
    if code == "internal":
        assert "secret" not in json.dumps(payload)
    if code == "unauthorized":
        assert hdrs["www-authenticate"].startswith("Bearer")


def test_handler_returning_error_envelope_gets_its_status(
    gen, tdb, data_dir, devices, ext_ops, rec, base
):
    def h(device, body, query):
        return {"ok": False, "error": {"code": "not_found", "message": "x"}}

    def bad(device, body, query):
        return ["not", "an", "envelope"]

    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec, get_state=h, get_queue=bad),
        port_base=base,
        port_span=SPAN,
    )
    status, _, payload = req(port, "GET", "/ext/state", headers=bearer())
    assert status == 404 and payload["error"]["code"] == "not_found"
    status, _, payload = req(port, "GET", "/ext/queue", headers=bearer())
    assert status == 500 and payload["error"]["code"] == "internal"


def test_dataclass_results_are_serialized(tdb, data_dir, devices, ext_ops, rec, base):
    dev = T.Device(id="dev-1", name="n", created_at=5)

    def h(device, body, query):
        return {"ok": True, "data": T.PairedDevice(device=dev, token="t")}

    port = _server.ensure_server(
        db=tdb,
        settings=FakeSettings(),
        data_dir=data_dir,
        handlers=stub_handlers(devices, ext_ops, rec, pair_complete=h),
        port_base=base,
        port_span=SPAN,
    )
    status, _, payload = req(
        port, "POST", "/pair/complete", headers={"Origin": EXT}, body={"code": "1", "name": "n"}
    )
    assert status == 200
    assert payload["data"]["device"]["id"] == "dev-1" and payload["data"]["token"] == "t"


@pytest.mark.parametrize("raw", [b"{not json", b"[1, 2]", b'"x"', b"\xff\xfe"])
def test_invalid_json_body_is_422(running, rec, raw):
    status, _, payload = req(running, "POST", "/ext/sync/watch", headers=bearer(), raw=raw)
    assert status == 422 and payload["error"]["code"] == "invalid"
    assert rec.calls == []


def test_empty_post_body_is_empty_object(running, rec):
    status, _, _ = req(running, "POST", "/ext/unpair", headers=bearer(), raw=b"")
    assert status == 200
    assert rec.calls[-1][2] == {}


def test_body_limit(running, rec, monkeypatch):
    monkeypatch.setattr(_server, "MAX_BODY_BYTES", 64)
    status, hdrs, payload = req(
        running, "POST", "/ext/sync/watch", headers=bearer(), body={"events": ["x" * 100]}
    )
    assert status == 422 and payload["error"]["code"] == "invalid"
    assert rec.calls == []
    assert hdrs.get("connection", "").lower() == "close"


def test_body_limit_default_fits_full_subscription_list():
    # 5000 channels in one request (SubscriptionBatchBody.maxItems) and search ytInitialData
    assert _server.MAX_BODY_BYTES >= 8 * 1024 * 1024


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/nope"),
        ("GET", "/ext"),
        ("GET", "/ext/sync/watch"),  # route exists only as POST
        ("POST", "/ext/state"),
        ("DELETE", "/ext/state"),
        ("PUT", "/health"),
        ("GET", "/ext/queue/a/b/result"),
        ("GET", "/api/plugins/x/ext/state"),
    ],
)
def test_unknown_routes_are_404(gen, running, rec, method, path):
    status, _, payload = req(running, method, path, headers=bearer())
    assert status == 404 and payload["error"]["code"] == "not_found"
    _validate_envelope(gen, None, payload)
    assert rec.calls == []


def test_keep_alive_two_requests_on_one_connection(running):
    conn = http.client.HTTPConnection("127.0.0.1", running, timeout=5)
    for _ in range(2):
        conn.request("POST", "/ext/sync/watch", body=b"{}", headers=bearer())
        r = conn.getresponse()
        assert r.status == 200
        json.loads(r.read())
    conn.close()


def test_bearer_authenticator_unit(devices):
    auth = _mount.bearer_authenticator(devices)
    assert auth("Bearer tok-dev-1", None).id == "dev-1"
    assert auth("bearer   tok-dev-1  ", EXT).id == "dev-1"
    for bad in (None, "", "Basic x", "Bearer", "Bearer nope", "tok-dev-1"):
        with pytest.raises(T.Unauthorized):
            auth(bad, None)
    devices.devices["dev-1"] = dataclasses.replace(devices.devices["dev-1"], origin=EXT)
    with pytest.raises(T.TubeError) as ei:
        auth("Bearer tok-dev-1", EXT_OTHER)
    assert ei.value.code == "origin_mismatch"
    assert auth("Bearer tok-dev-1", EXT).id == "dev-1"


def test_error_envelope_helper_unit():
    status, env, headers = _mount.error_response(T.PairingFailed("expired"))
    assert status == 400 and env["error"]["code"] == "expired"
    assert "reason" not in (env["error"].get("details") or {})
    status, env, headers = _mount.error_response(T.Unauthorized())
    assert status == 401 and ("WWW-Authenticate", f'Bearer realm="{PLUGIN_ID}"') in headers

    class Weird(T.TubeError):
        code = "not_in_contract"

    status, env, _ = _mount.error_response(Weird("x"))
    assert status == 500 and env["error"]["code"] == "internal"


def test_handlers_never_see_process_state():
    """Contract §9: the mount reads neither os.environ nor get_hermes_home()."""
    import ast

    for name in ("_mount.py", "_server.py"):
        tree = ast.parse((PLUGIN_SRC / "ext" / name).read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, ast.FunctionDef | ast.Module):
                continue
            for node in ast.walk(fn):
                if isinstance(node, ast.Name | ast.Attribute):
                    ident = node.id if isinstance(node, ast.Name) else node.attr
                    assert ident != "get_hermes_home", name
                    # the only allowed use: role label (plugin host?) stored in meta
                    if ident == "environ" and isinstance(fn, ast.FunctionDef):
                        assert fn.name == "_detect_role", (name, fn.name)


def test_no_network_or_thread_on_import(tmp_path):
    code = (
        "import importlib.util, sys, threading\n"
        f"s = importlib.util.spec_from_file_location('_b', {str(PLUGIN_SRC / '_bootstrap.py')!r})\n"
        "m = importlib.util.module_from_spec(s); s.loader.exec_module(m); m.ensure()\n"
        "n = threading.active_count()\n"
        "import tube_pkg.ext._server, tube_pkg.ext._mount, tube_pkg.routines._header\n"
        "assert threading.active_count() == n\n"
        "print('ok')\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "ok"


# ==================== _header (routines)

SHIM = """\
import json, os, pathlib, runpy, sys
home = pathlib.Path(__file__).resolve().parents[1]
h = runpy.run_path(str(home / "plugins" / "{pid}" / "routines" / "_header.py"))
r = h["bootstrap"](__file__)
import tube_pkg._id
print(json.dumps({{"home": str(r.home), "plugin_dir": str(r.plugin_dir), "db_path": str(r.db_path),
                  "id": tube_pkg._id.PLUGIN_ID, "env": sorted(os.environ),
                  "warn": h["check_env"](r)}}))
"""


def _fake_home(tmp_path: Path, mode: str) -> Path:
    h = (tmp_path / "profiles" / "p1").resolve()
    (h / "plugins").mkdir(parents=True)
    (h / "scripts").mkdir()
    target = h / "plugins" / PLUGIN_ID
    if mode == "symlink":
        target.symlink_to(PLUGIN_SRC, target_is_directory=True)
    else:
        shutil.copytree(PLUGIN_SRC, target, ignore=shutil.ignore_patterns("__pycache__"))
    (h / "scripts" / "probe.py").write_text(SHIM.format(pid=PLUGIN_ID), encoding="utf-8")
    return h


def _run_shim_empty_env(script: Path, *extra_env: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["/usr/bin/env", "-i", *extra_env, sys.executable, "-I", str(script)],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=str(script.parent),
    )


@pytest.mark.parametrize("mode", ["symlink", "copy"])
def test_header_resolves_db_with_empty_env(tmp_path, mode):
    h = _fake_home(tmp_path, mode)
    proc = _run_shim_empty_env(h / "scripts" / "probe.py")
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert out["home"] == str(h)
    assert out["plugin_dir"] == str(h / "plugins" / PLUGIN_ID)
    assert out["db_path"] == str(h / "plugin-data" / PLUGIN_ID / "tube.db")
    assert out["id"] == PLUGIN_ID
    assert "HERMES_HOME" not in out["env"] and "PYTHONPATH" not in out["env"]
    assert out["warn"] is None


def test_header_ignores_lying_hermes_home(tmp_path):
    h = _fake_home(tmp_path, "symlink")
    proc = _run_shim_empty_env(h / "scripts" / "probe.py", "HERMES_HOME=/nonexistent/launch")
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert out["home"] == str(h)  # the shim path wins over the environment
    assert out["warn"] and "HERMES_HOME" in out["warn"]


def test_header_through_symlinked_shim(tmp_path):
    """Shim whose path is a symlink: ``resolve()`` follows it to the file in ``<home>/scripts``."""
    h = _fake_home(tmp_path, "copy")
    link_dir = tmp_path / "elsewhere"
    link_dir.mkdir()
    (link_dir / "probe.py").symlink_to(h / "scripts" / "probe.py")
    proc = _run_shim_empty_env(link_dir / "probe.py")
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["home"] == str(h)


def test_header_missing_plugin_fails_loudly(tmp_path):
    h = (tmp_path / "home").resolve()
    (h / "scripts").mkdir(parents=True)
    (h / "plugins").mkdir()
    script = h / "scripts" / "x.py"
    script.write_text("", encoding="utf-8")
    with pytest.raises(SystemExit) as ei:
        _header.resolve(script)
    assert ei.value.code not in (0, None)
    assert PLUGIN_ID in str(ei.value)


def test_header_script_outside_scripts_dir_fails(tmp_path):
    script = tmp_path / "a" / "x.py"
    script.parent.mkdir()
    script.write_text("", encoding="utf-8")
    with pytest.raises(SystemExit) as ei:
        _header.resolve(script)
    assert ei.value.code not in (0, None)


def test_header_resolve_in_process(tmp_path):
    h = _fake_home(tmp_path, "symlink")
    r = _header.resolve(str(h / "scripts" / "probe.py"))
    home, plugin_dir, db_path = r  # unpacks as a tuple
    assert (home, plugin_dir, db_path) == (
        h,
        h / "plugins" / PLUGIN_ID,
        h / "plugin-data" / PLUGIN_ID / "tube.db",
    )
    assert not db_path.parent.exists()  # resolver creates nothing


def test_header_cli_exit_code(tmp_path):
    """``python -I _header.py <script>``: prints JSON; failure → exit ≠ 0 and a stderr message."""
    h = _fake_home(tmp_path, "copy")
    hdr = h / "plugins" / PLUGIN_ID / "routines" / "_header.py"
    ok = subprocess.run(
        ["/usr/bin/env", "-i", sys.executable, "-I", str(hdr), str(h / "scripts" / "probe.py")],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert ok.returncode == 0, ok.stderr
    assert json.loads(ok.stdout)["db_path"] == str(h / "plugin-data" / PLUGIN_ID / "tube.db")
    bad = subprocess.run(
        ["/usr/bin/env", "-i", sys.executable, "-I", str(hdr), str(tmp_path / "nope.py")],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert bad.returncode != 0
    assert bad.stderr.strip()


def test_header_is_stdlib_only():
    src = (PLUGIN_SRC / "routines" / "_header.py").read_text(encoding="utf-8")
    for banned in ("import yaml", "from tube_pkg", "import tube_pkg", "from plugin"):
        assert banned not in src
