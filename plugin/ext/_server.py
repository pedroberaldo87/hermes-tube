"""The extension's own HTTP server — stdlib, ``127.0.0.1`` only, started on demand.

Based on a server measured in an earlier prototype, hardened for production. Contract:
``contract/ext-protocol.md`` §1, §2, §4 and §9.

Single owner across the processes of one profile (gateway, plugin host, scripts):

1. this process already has a live server for this ``data_dir`` → use it;
2. ``meta.ext_port`` answers ``GET /health`` with the stored ``ext_instance`` → another process is
   the owner, use its port;
3. non-blocking exclusive lock on ``<data_dir>/ext-server.lock`` (mode 0600; ``flock`` on POSIX,
   ``msvcrt.locking`` on Windows — ``_filelock.py``): whoever gets it becomes the owner, starts
   the server and writes ``ext_port``/``ext_instance``/``ext_owner_pid``/``ext_owner_role`` to
   ``meta``; the lock stays open while the server lives and the system releases it if the process
   dies;
4. lock taken → wait up to ``WAIT_OWNER_S`` for health **and try the lock again** (the owner may
   have died during the wait).

Port: ``PORT_BASE`` and the next ``PORT_SPAN - 1``. Before binding, a test connection to
``127.0.0.1:P``: if anyone accepts (including an app on ``*:P``), skip it — on macOS
``SO_REUSEADDR`` (on, to reuse the previous owner's TIME_WAIT) would let us bind ``127.0.0.1:P``
over ``*:P`` and steal the other app's local traffic. On Windows ``SO_REUSEADDR`` would let a
second socket take a port that is in use, so it is never set there; the socket is bound with
``SO_EXCLUSIVEADDRUSE`` instead, and a probe that times out counts as free (Windows answers a
connection to a closed loopback port only after about two seconds of retries, while a real listener
accepts at once).

Transport security (before any route, and before the body is read): ``Host`` must be loopback
with the right port (anti DNS rebinding) → ``403 host_forbidden``; an ``Origin`` that is present
and not ``chrome-extension://`` → ``403 origin_forbidden`` without CORS headers, connection
closed; a missing ``Origin`` is accepted (service worker GETs; ``POST /pair/complete`` requires
it, and every other route requires the device token); ``OPTIONS`` preflight; a guard that re-reads
the profile's ``config.yaml`` ``plugins.enabled/disabled`` every ``GUARD_INTERVAL_S`` → ``503
plugin_disabled`` and the server shuts down.

Profile: the caller passes ``db`` and ``data_dir`` **already resolved** (in the gateway
``os.environ["HERMES_HOME"]`` is the launch profile and a new thread does not inherit the
contextvar). This module never looks the profile up on its own. The ``/ext/*`` routes come from
``_mount.py``.
"""

from __future__ import annotations

import contextlib
import errno
import http.client
import importlib
import json
import logging
import os
import re
import socket
import sys
import threading
import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core.types import ERROR_HTTP_STATUS, META_EXT_PORT, Db, Settings
from tube_pkg.ext import _filelock
from tube_pkg.ext import proof as proof_mod

logger = logging.getLogger(__name__)

PORT_BASE = 47615
"""Preferred port (high, below the macOS ephemeral range, 49152+)."""
PORT_SPAN = 10
"""Range 47615–47624 (``EXT_PORTS`` in ``shared/ids.ts``)."""
HOST = "127.0.0.1"
"""Never a wildcard: IPv4 loopback only."""

LOCK_NAME = "ext-server.lock"
META_INSTANCE = "ext_instance"
META_OWNER_PID = "ext_owner_pid"
META_OWNER_ROLE = "ext_owner_role"
META_KEYS = (META_EXT_PORT, META_INSTANCE, META_OWNER_PID, META_OWNER_ROLE)

MAX_BODY_BYTES = 16 * 1024 * 1024
"""Body limit: 5000 channels in one request and a search ``ytInitialData`` fit with room."""
DRAIN_CAP_BYTES = 4 * 1024 * 1024
"""A body over the limit is read and discarded up to this (avoids an RST before the reply)."""
GUARD_INTERVAL_S = 5.0
"""Re-read of the profile's ``config.yaml`` (plugin disabled → 503 and shut down)."""
POLL_INTERVAL_S = 0.25
"""``serve_forever`` loop: ``shutdown`` latency and guard cadence without requests."""
WAIT_OWNER_S = 1.5
HEALTH_TIMEOUT_S = 0.5
REQUEST_TIMEOUT_S = 15

EXT_ORIGIN_PREFIX = "chrome-extension://"
ALLOW_METHODS = "GET, POST, OPTIONS"
ALLOW_HEADERS = "Authorization, Content-Type"
MAX_AGE_S = "600"

PairingOpen = Callable[[], bool]


# ==================== request and response


@dataclass(frozen=True)
class Request:
    """Request already cleared by transport security, handed to the mounted route."""

    method: str
    path: str
    query: Mapping[str, str]
    """Query parameters (the last value wins)."""
    path_params: Mapping[str, str]
    """Path parameters (``/ext/queue/{id}/result`` → ``{"id": …}``), already decoded."""
    headers: Mapping[str, str]
    origin: str | None
    body: bytes
    """Raw body (``b""`` without a body); the limit was already applied."""
    port: int | None = None
    """Port this server listens on (the pairing proof is bound to it)."""


@dataclass
class Response:
    status: int
    payload: Any = None
    """Plain JSON (envelope); ``None`` = no body."""
    headers: list[tuple[str, str]] = field(default_factory=list)


RouteFn = Callable[[Request], Response]


def transport_error(code: str, message: str = "", **details: Any) -> Response:
    """Transport error envelope with the status from ``ERROR_HTTP_STATUS``."""
    error: dict[str, Any] = {"code": code, "message": message or code}
    if details:
        error["details"] = details
    return Response(ERROR_HTTP_STATUS.get(code, 500), {"ok": False, "error": error})


# ==================== profile configuration


def profile_home_of(data_dir: str | os.PathLike[str]) -> Path | None:
    """``<home>/plugin-data/<PLUGIN_ID>`` → ``<home>``; any other shape, ``None``."""
    d = Path(data_dir)
    if d.name == PLUGIN_ID and d.parent.name == "plugin-data":
        return d.parent.parent
    return None


def plugin_enabled(home: str | os.PathLike[str]) -> bool | None:
    """``True``/``False`` from ``plugins.enabled``/``plugins.disabled`` in the profile's
    ``config.yaml``; ``None`` = unknown (no file, unreadable YAML, no ``yaml``, no list) — does
    not block."""
    cfg = Path(home) / "config.yaml"
    try:
        # PyYAML or Hermes's ruamel.yaml (the Hermes runtime has no PyYAML)
        from tube_pkg._yaml import safe_load

        data = safe_load(cfg.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return None
    plugins = data.get("plugins") if isinstance(data, dict) else None
    if not isinstance(plugins, dict):
        return None
    disabled = plugins.get("disabled")
    if isinstance(disabled, list) and PLUGIN_ID in disabled:
        return False
    enabled = plugins.get("enabled")
    if isinstance(enabled, list):
        return PLUGIN_ID in enabled
    return None


def _detect_role() -> str:
    if os.environ.get("HERMES_PLUGIN_HOST_PROCESS") == "1":
        return "plugin_host"
    if "gateway.run" in sys.modules:
        return "gateway"
    return "process"


# ==================== meta (SQLite)


def _meta_get(db: Db) -> dict[str, str]:
    marks = ", ".join("?" for _ in META_KEYS)
    rows = db.query(f"SELECT key, value FROM meta WHERE key IN ({marks})", tuple(META_KEYS))
    return {r["key"]: r["value"] for r in rows if r["value"] is not None}


def _meta_set(db: Db, values: Mapping[str, Any]) -> None:
    with db.transaction():
        for key, value in values.items():
            db.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )


def _meta_clear_if_instance(db: Db, instance: str) -> None:
    with db.transaction():
        row = db.query_one("SELECT value FROM meta WHERE key = ?", (META_INSTANCE,))
        if row is not None and row["value"] == instance:
            marks = ", ".join("?" for _ in META_KEYS)
            db.execute(f"DELETE FROM meta WHERE key IN ({marks})", tuple(META_KEYS))


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def default_pairing_open(db: Db) -> PairingOpen:
    """Is a code active? Reads ``pair_codes`` (read only); same rule as
    ``DeviceAuth.pairing_open()``."""

    def check() -> bool:
        row = db.query_one(
            "SELECT 1 AS x FROM pair_codes WHERE used_at IS NULL AND expires_at > ? LIMIT 1",
            (int(time.time()),),
        )
        return row is not None

    return check


# ==================== HTTP


def _on_windows() -> bool:
    return sys.platform == "win32"


def _socket_options() -> list[tuple[str, int, int, int]]:
    """``(name, level, option, value)`` set on the listening socket before ``bind``.

    POSIX: ``SO_REUSEADDR`` (bind again over the previous owner's TIME_WAIT; ``*:P`` is covered
    by the probe). Windows: ``SO_EXCLUSIVEADDRUSE`` only — ``SO_REUSEADDR`` there lets a second
    socket bind a port that is already in use."""
    if _on_windows():
        exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
        return (
            [] if exclusive is None else [("SO_EXCLUSIVEADDRUSE", socket.SOL_SOCKET, exclusive, 1)]
        )
    return [("SO_REUSEADDR", socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)]


_SKIPPABLE_BIND_ERRORS = frozenset(
    code
    for code in (
        errno.EADDRINUSE,
        errno.EACCES,
        errno.EADDRNOTAVAIL,
        # Windows socket errors (a port inside a range Windows reserves for Hyper-V/WSL answers
        # WSAEACCES)
        getattr(errno, "WSAEACCES", 10013),
        getattr(errno, "WSAEADDRINUSE", 10048),
        getattr(errno, "WSAEADDRNOTAVAIL", 10049),
    )
)


def _skippable_bind_error(exc: OSError) -> bool:
    """A bind error that means "try the next port of the range"."""
    return exc.errno in _SKIPPABLE_BIND_ERRORS or getattr(exc, "winerror", None) in (
        _SKIPPABLE_BIND_ERRORS
    )


class _HTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # the options come from _socket_options(), per system
    request_queue_size = 64
    ext: ExtServer

    def server_bind(self) -> None:
        for _name, level, option, value in _socket_options():
            self.socket.setsockopt(level, option, value)
        super().server_bind()

    def service_actions(self) -> None:  # runs in the serve_forever loop (each poll)
        self.ext.periodic_guard()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "tube-ext"
    sys_version = ""
    timeout = REQUEST_TIMEOUT_S
    server: _HTTPServer

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 — no per-request log
        return

    # ------------------------------------------------------------------ verbs
    def do_GET(self) -> None:  # noqa: N802
        self._dispatch()

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._dispatch()

    def do_PUT(self) -> None:  # noqa: N802
        self._dispatch()

    def do_PATCH(self) -> None:  # noqa: N802
        self._dispatch()

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch()

    # ------------------------------------------------------------------ output
    def _origin(self) -> str | None:
        return self.headers.get("Origin")

    def _cors_headers(self) -> list[tuple[str, str]]:
        origin = self._origin()
        out = [("Vary", "Origin")]
        if origin is None or not is_extension_origin(origin):
            return out
        out.insert(0, ("Access-Control-Allow-Origin", origin))
        if self.command == "OPTIONS":
            out += [
                ("Access-Control-Allow-Methods", ALLOW_METHODS),
                ("Access-Control-Allow-Headers", ALLOW_HEADERS),
                ("Access-Control-Max-Age", MAX_AGE_S),
            ]
            if (self.headers.get("Access-Control-Request-Private-Network") or "").lower() == "true":
                out.append(("Access-Control-Allow-Private-Network", "true"))
            if (self.headers.get("Access-Control-Request-Local-Network") or "").lower() == "true":
                out.append(("Access-Control-Allow-Local-Network", "true"))
        return out

    def _write(self, resp: Response, *, cors: bool = True, close: bool = False) -> None:
        try:
            body = (
                b""
                if resp.payload is None
                else json.dumps(resp.payload, ensure_ascii=False).encode("utf-8")
            )
        except (TypeError, ValueError):
            logger.exception("%s: response is not serializable", PLUGIN_ID)
            resp = transport_error("internal", "internal error")
            body = json.dumps(resp.payload).encode("utf-8")
        if close:
            self.close_connection = True
        self.send_response(resp.status)
        for k, v in self._cors_headers() if cors else [("Vary", "Origin")]:
            self.send_header(k, v)
        for k, v in resp.headers:
            self.send_header(k, v)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if resp.payload is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if close:
            self.send_header("Connection", "close")
        self.end_headers()
        if body:
            self.wfile.write(body)

    # ------------------------------------------------------------------ input
    def _read_body(self) -> tuple[bytes, Response | None, bool]:
        """``(body, error, close)``. A body over the limit is discarded (up to ``DRAIN_CAP``)."""
        if self.headers.get("Transfer-Encoding"):
            return b"", transport_error("invalid", "Transfer-Encoding not supported"), True
        raw = self.headers.get("Content-Length")
        try:
            n = int(raw) if raw else 0
        except ValueError:
            n = -1
        if n < 0:
            return b"", transport_error("invalid", "invalid Content-Length"), True
        limit = MAX_BODY_BYTES
        if n > limit:
            left = min(n, limit + DRAIN_CAP_BYTES)
            while left > 0:
                chunk = self.rfile.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
            err = transport_error("invalid", f"body larger than {limit} bytes", max_bytes=limit)
            return b"", err, True
        return (self.rfile.read(n) if n else b""), None, False

    def _dispatch(self) -> None:
        ext = self.server.ext
        try:
            # 1. Host (anti DNS rebinding), no CORS. 2. Origin present and not
            # chrome-extension:// → 403 without CORS (OPTIONS included). Both run before the body
            # is read: a refused request never makes the server buffer up to MAX_BODY_BYTES; the
            # connection is closed instead of drained.
            host = (self.headers.get("Host") or "").strip().lower()
            port = ext.port
            if host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
                return self._write(transport_error("host_forbidden"), cors=False, close=True)
            origin = self._origin()
            if origin is not None and not is_extension_origin(origin):
                return self._write(transport_error("origin_forbidden"), cors=False, close=True)
            body, body_err, close = self._read_body()
            # 3. plugin disabled in the profile → 503 and shut down
            if not ext.still_enabled():
                self._write(transport_error("plugin_disabled"), close=True)
                ext.stop_async()
                return
            if body_err is not None:
                return self._write(body_err, close=close)
            # 4. preflight
            if self.command == "OPTIONS":
                return self._write(Response(204), close=close)
            split = urlsplit(self.path)
            path = split.path
            # 5. health (no auth)
            if path == "/health" and self.command == "GET":
                asked = dict(parse_qsl(split.query, keep_blank_values=True))
                return self._write(Response(200, {"ok": True, "data": ext.health_payload(asked)}))
            # 6. mounted routes
            found = ext.match(self.command, path)
            if found is None:
                return self._write(transport_error("not_found", "unknown route"), close=close)
            fn, params = found
            request = Request(
                method=self.command,
                path=path,
                query=dict(parse_qsl(split.query, keep_blank_values=True)),
                path_params=params,
                headers=self.headers,  # type: ignore[arg-type]
                origin=origin,
                body=body,
                port=port,
            )
            try:
                resp = fn(request)
            except Exception:  # noqa: BLE001 — the mounted route already handles TubeError
                logger.exception("%s: route %s %s failed", PLUGIN_ID, self.command, path)
                resp = transport_error("internal", "internal error")
            self._write(resp, close=close)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True


def is_extension_origin(origin: str) -> bool:
    return origin.startswith(EXT_ORIGIN_PREFIX) and len(origin) > len(EXT_ORIGIN_PREFIX)


# ==================== server


@dataclass
class _Route:
    method: str
    template: str
    regex: re.Pattern[str]
    fn: RouteFn


def _compile(template: str) -> re.Pattern[str]:
    parts = re.split(r"(\{[A-Za-z_][A-Za-z0-9_]*\})", template)
    out = []
    for part in parts:
        if part.startswith("{") and part.endswith("}"):
            out.append(f"(?P<{part[1:-1]}>[^/]+)")
        else:
            out.append(re.escape(part))
    return re.compile("^" + "".join(out) + "$")


class ExtServer:
    """One server instance (one ``data_dir``, one owner). Created only by ``ensure_server``."""

    def __init__(
        self,
        *,
        db: Db,
        data_dir: Path,
        role: str,
        lock_fd: int,
        pairing_open: PairingOpen | None = None,
    ) -> None:
        self.db = db
        self.data_dir = Path(data_dir)
        self.role = role
        self.lock_fd: int | None = lock_fd
        self.instance = uuid.uuid4().hex
        self.httpd: _HTTPServer | None = None
        self.thread: threading.Thread | None = None
        self._routes: list[_Route] = []
        self._pairing_open = pairing_open or default_pairing_open(db)
        self.profile_home = profile_home_of(self.data_dir)
        self._guard_at = time.monotonic()
        self._guard_ok = True
        self._guard_lock = threading.Lock()
        self._stop_lock = threading.Lock()
        self._stopping = False

    # ------------------------------------------------------------------ routes
    def add_route(self, method: str, template: str, fn: RouteFn) -> None:
        """Used by ``_mount.mount``. ``{name}`` in the path becomes a parameter."""
        self._routes.append(_Route(method.upper(), template, _compile(template), fn))

    def match(self, method: str, path: str) -> tuple[RouteFn, dict[str, str]] | None:
        for route in self._routes:
            if route.method != method:
                continue
            m = route.regex.match(path)
            if m:
                return route.fn, {k: unquote(v) for k, v in m.groupdict().items()}
        return None

    # ------------------------------------------------------------------ state
    @property
    def port(self) -> int | None:
        return None if self.httpd is None else int(self.httpd.server_address[1])

    @property
    def address(self) -> tuple[str, int] | tuple[None, None]:
        if self.httpd is None:
            return (None, None)
        host, port = self.httpd.server_address[:2]
        return (str(host), int(port))

    def alive(self) -> bool:
        return not self._stopping and self.thread is not None and self.thread.is_alive()

    def health_payload(self, query: Mapping[str, str] | None = None) -> dict[str, Any]:
        """``HealthResponse``: no pid and no path (nothing that identifies the user).

        With ``device`` and ``nonce`` (hex) in the query and a live device, it also carries
        ``proof`` = ``HMAC(sha256(token), nonce|port)``: the extension sends its token only to a
        server that proves it knows it (``ext/proof.py``)."""
        try:
            pairing = bool(self._pairing_open())
        except Exception:  # noqa: BLE001 — database busy/missing: pairing stays closed
            pairing = False
        out: dict[str, Any] = {
            "service": PLUGIN_ID,
            "instance": self.instance,
            "pairing_open": pairing,
        }
        proof = self._proof(query or {})
        if proof is not None:
            out["proof"] = proof
        return out

    def _proof(self, query: Mapping[str, str]) -> str | None:
        device, nonce, port = query.get("device"), query.get("nonce"), self.port
        if not device or len(device) > 64 or not proof_mod.valid_nonce(nonce) or port is None:
            return None
        try:
            row = self.db.query_one(
                "SELECT token_hash FROM devices WHERE id = ? AND revoked_at IS NULL", (device,)
            )
        except Exception:  # noqa: BLE001 — database busy: no proof (the extension waits)
            return None
        if row is None or not row["token_hash"]:
            return None
        return proof_mod.server_proof(str(row["token_hash"]), str(nonce), port)

    # ------------------------------------------------------------------ guard
    def still_enabled(self) -> bool:
        """Is the plugin still enabled in the profile? Re-reads at most every ``GUARD_INTERVAL_S``.

        Reads ``config.yaml`` through the ``data_dir`` path, never through ``get_hermes_home()``
        (in the gateway thread it points to the launch profile). No readable config: does not
        block.
        """
        if self.profile_home is None:
            return True
        with self._guard_lock:
            now = time.monotonic()
            if now - self._guard_at >= GUARD_INTERVAL_S:
                self._guard_at = now
                self._guard_ok = plugin_enabled(self.profile_home) is not False
            return self._guard_ok

    def periodic_guard(self) -> None:
        """Called by the server loop: shuts down even when no request arrives."""
        if not self._stopping and not self.still_enabled():
            logger.info("%s: plugin disabled in the profile; extension server stopping", PLUGIN_ID)
            self.stop_async()

    # ------------------------------------------------------------------ lifecycle
    def bind(self, port_base: int, span: int) -> int | None:
        for p in range(port_base, port_base + span):
            if _port_in_use(p):
                continue
            try:
                httpd = _HTTPServer((HOST, p), _Handler)
            except OSError as exc:
                if _skippable_bind_error(exc):
                    continue
                raise
            httpd.ext = self
            self.httpd = httpd
            return p
        return None

    def start(self) -> None:
        httpd = self.httpd
        assert httpd is not None
        self.thread = threading.Thread(
            target=httpd.serve_forever,
            kwargs={"poll_interval": POLL_INTERVAL_S},
            name=f"{PLUGIN_ID}-ext-server",
            daemon=True,
        )
        self.thread.start()

    def stop_async(self) -> None:
        """Stops in a separate thread (from inside the loop/handler ``shutdown`` would hang)."""
        if self._stopping:
            return
        threading.Thread(target=self.self_stop, name=f"{PLUGIN_ID}-ext-stop", daemon=True).start()

    def self_stop(self) -> None:
        with _LOCAL_LOCK:
            key = _key(self.data_dir)
            if _LOCAL.get(key) is self:
                _LOCAL.pop(key, None)
        self.stop()

    def stop(self) -> None:
        """Idempotent: closes the socket, clears ``meta`` (only if still the stored instance) and
        releases the lock."""
        with self._stop_lock:
            if self._stopping and self.lock_fd is None:
                return
            self._stopping = True
            httpd = self.httpd
            if httpd is not None:
                if self.thread is not None and self.thread is not threading.current_thread():
                    httpd.shutdown()
                httpd.server_close()
            if self.thread is not None and self.thread is not threading.current_thread():
                self.thread.join(2)
            try:
                _meta_clear_if_instance(self.db, self.instance)
            except Exception:  # noqa: BLE001 — database already closed (on_unload): meta stays stale
                logger.debug("%s: could not clear the server meta", PLUGIN_ID, exc_info=True)
            finally:
                if self.lock_fd is not None:
                    _release(self.lock_fd)
                    self.lock_fd = None


_LOCAL: dict[str, ExtServer] = {}
_LOCAL_LOCK = threading.RLock()


def _key(data_dir: str | os.PathLike[str]) -> str:
    return str(Path(data_dir).resolve())


def _port_in_use(port: int) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=0.3):
            return True
    except ConnectionRefusedError:
        return False
    except TimeoutError:
        # Windows: a closed loopback port answers only after ~2 s of retries; a listener
        # accepts at once. Elsewhere: be conservative, skip the port
        return not _on_windows()
    except OSError:
        return True  # odd error: be conservative, skip the port


def _try_lock(path: Path) -> int | None:
    fd = _filelock.try_lock(path)
    if fd is None:
        return None
    os.ftruncate(fd, 0)
    os.write(fd, f"{os.getpid()}\n".encode())
    return fd


def _release(fd: int) -> None:
    _filelock.release(fd)


def try_lock_free(data_dir: str | os.PathLike[str]) -> bool:
    """Is the owner lock free right now? (tests and diagnostics; does not hold it)."""
    fd = _try_lock(Path(data_dir) / LOCK_NAME)
    if fd is None:
        return False
    _release(fd)
    return True


def health(port: int, timeout: float = HEALTH_TIMEOUT_S) -> dict[str, Any] | None:
    """``data`` of ``GET /health`` on ``127.0.0.1:port`` if it is this plugin; else ``None``."""
    try:
        conn = http.client.HTTPConnection(HOST, int(port), timeout=timeout)
        try:
            conn.request("GET", "/health")
            r = conn.getresponse()
            raw = r.read()
        finally:
            conn.close()
        if r.status != 200:
            return None
        data = (json.loads(raw) or {}).get("data") or {}
        return data if isinstance(data, dict) and data.get("service") == PLUGIN_ID else None
    except (OSError, ValueError, http.client.HTTPException):
        return None


def _healthy_meta(db: Db, timeout: float) -> tuple[dict[str, str], dict[str, Any] | None]:
    meta = _meta_get(db)
    port = _int(meta.get(META_EXT_PORT))
    if port is None:
        return meta, None
    h = health(port, timeout)
    if h is None or h.get("instance") != meta.get(META_INSTANCE):
        return meta, None
    return meta, h


def _handlers_from_wiring(db: Db, settings: Settings) -> Any:
    wiring = importlib.import_module("tube_pkg.wiring")  # late import
    return wiring.ext_handlers(db=db, settings=settings)


# ==================== public API (contract §9)


def ensure_server(
    *,
    db: Db,
    settings: Settings,
    data_dir: str | Path,
    handlers: Any = None,
    port_base: int = PORT_BASE,
    port_span: int = PORT_SPAN,
    pairing_open: PairingOpen | None = None,
    role: str | None = None,
) -> int | None:
    """Starts (or reuses) the server and returns the port; ``None`` if it could not
    (→ ``ext_endpoint_down``). Never raises.

    *db* and *data_dir* (``<home>/plugin-data/<PLUGIN_ID>``) come **resolved** by the caller.
    *handlers* (``ExtHandlers``) default: ``tube_pkg.wiring.ext_handlers(db=, settings=)``.
    The other parameters are optional (tests/diagnostics): port range, ``pairing_open``
    reader (default: ``pair_codes``) and the role stored in ``meta.ext_owner_role``.
    """
    try:
        return _ensure(
            db=db,
            settings=settings,
            data_dir=Path(data_dir),
            handlers=handlers,
            port_base=int(port_base),
            port_span=int(port_span),
            pairing_open=pairing_open,
            role=role or _detect_role(),
        )
    except Exception:  # noqa: BLE001 — the caller (GET /status, pair.start) must not break
        logger.exception("%s: the extension server did not start", PLUGIN_ID)
        return None


def _ensure(
    *,
    db: Db,
    settings: Settings,
    data_dir: Path,
    handlers: Any,
    port_base: int,
    port_span: int,
    pairing_open: PairingOpen | None,
    role: str,
) -> int | None:
    data_dir.mkdir(parents=True, exist_ok=True)
    key = _key(data_dir)
    with _LOCAL_LOCK:
        mine = _LOCAL.get(key)
        if mine is not None and mine.alive():
            return mine.port
        home = profile_home_of(data_dir)
        if home is not None and plugin_enabled(home) is False:
            return None
        meta, h = _healthy_meta(db, HEALTH_TIMEOUT_S)
        if h is not None:
            return _int(meta.get(META_EXT_PORT))
        if mine is not None:  # the thread died in this process: release the lock and start over
            _LOCAL.pop(key, None)
            with contextlib.suppress(Exception):
                mine.stop()
        lock_path = data_dir / LOCK_NAME
        fd = _try_lock(lock_path)
        deadline = time.monotonic() + WAIT_OWNER_S
        while fd is None:
            # lock held by another process: it is starting (wait for health) or died (lock frees)
            if time.monotonic() >= deadline:
                logger.warning("%s: the extension server owner does not answer", PLUGIN_ID)
                return None
            time.sleep(0.05)
            meta, h = _healthy_meta(db, HEALTH_TIMEOUT_S)
            if h is not None:
                return _int(meta.get(META_EXT_PORT))
            fd = _try_lock(lock_path)
        srv: ExtServer | None = None
        try:
            if handlers is None:
                handlers = _handlers_from_wiring(db, settings)
            srv = ExtServer(
                db=db, data_dir=data_dir, role=role, lock_fd=fd, pairing_open=pairing_open
            )
            port = srv.bind(port_base, port_span)
            if port is None:
                logger.warning(
                    "%s: range %d–%d busy", PLUGIN_ID, port_base, port_base + port_span - 1
                )
                srv.stop()
                return None
            from tube_pkg.ext._mount import mount  # late import: _mount imports this module

            mount(srv, handlers=handlers)
            srv.start()
            _meta_set(
                db,
                {
                    META_EXT_PORT: port,
                    META_INSTANCE: srv.instance,
                    META_OWNER_PID: os.getpid(),
                    META_OWNER_ROLE: role,
                },
            )
        except BaseException:
            if srv is not None:
                with contextlib.suppress(Exception):
                    srv.stop()
            else:
                _release(fd)
            raise
        _LOCAL[key] = srv
        return port


def endpoint_up(*, db: Db, data_dir: str | Path) -> bool:
    """Real health: ``meta.ext_port`` answers ``/health`` with the stored ``ext_instance`` (short
    timeout). Becomes ``ext_endpoint_up`` of ``GET /status`` and ``BUILDS``. Never raises."""
    try:
        srv = local_server(data_dir)
        if srv is not None and srv.port is not None:
            return True
        return _healthy_meta(db, HEALTH_TIMEOUT_S)[1] is not None
    except Exception:  # noqa: BLE001
        return False


def current_port(*, db: Db) -> int | None:
    """Port stored in ``meta.ext_port`` (health not checked; combine with ``endpoint_up``)."""
    try:
        return _int(_meta_get(db).get(META_EXT_PORT))
    except Exception:  # noqa: BLE001
        return None


def local_server(data_dir: str | Path) -> ExtServer | None:
    """This process's server for *data_dir*, if alive."""
    with _LOCAL_LOCK:
        srv = _LOCAL.get(_key(data_dir))
    return srv if srv is not None and srv.alive() else None


def stop_local(data_dir: str | Path | None = None) -> bool:
    """Stops THIS process's server (if it is the owner). ``None`` → all. ``True`` if any stopped."""
    with _LOCAL_LOCK:
        keys = list(_LOCAL) if data_dir is None else [_key(data_dir)]
        servers = [s for s in (_LOCAL.pop(k, None) for k in keys) if s is not None]
    for s in servers:
        try:
            s.stop()
        except Exception:  # noqa: BLE001
            logger.exception("%s: failed to stop the extension server", PLUGIN_ID)
    return bool(servers)


def stop() -> bool:
    """``on_unload``: stops every extension server of this process."""
    return stop_local(None)


__all__ = [
    "HOST",
    "MAX_BODY_BYTES",
    "PORT_BASE",
    "PORT_SPAN",
    "ExtServer",
    "Request",
    "Response",
    "current_port",
    "endpoint_up",
    "ensure_server",
    "health",
    "is_extension_origin",
    "local_server",
    "plugin_enabled",
    "profile_home_of",
    "stop",
    "stop_local",
    "transport_error",
    "try_lock_free",
]
