"""Security tests for ``core/http.py``: SSRF guard, decompression cap and slow-body deadline.

The real ``UrllibTransport`` is exercised against a throwaway server on ``127.0.0.1`` (no outside
network). Loopback is exactly what the guard refuses by default, so the tests that need to talk
to that server build the transport with ``allow_private_networks=True``.
"""

from __future__ import annotations

import gzip
import http.server
import socket
import threading
import time
from collections.abc import Iterator

import pytest

from tube_pkg.core import http as H
from tube_pkg.core import types as T


class _Settings:
    def get(self, key, default=None):
        return default

    def snapshot(self):
        return {}

    def set(self, key, value):
        raise NotImplementedError


BOMB_PLAIN = 8 * 1024 * 1024
"""Decompressed size of the gzip bomb (the compressed body is a few KB)."""


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):  # noqa: N802
        if self.path == "/plain":
            body = b"hello"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/bomb":
            body = gzip.compress(b"\0" * BOMB_PLAIN, compresslevel=9)
            self.send_response(200)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/drip":
            # 40 bytes, one every 0.15 s: each recv beats the socket timeout, the whole body
            # takes ~6 s
            self.send_response(200)
            self.send_header("Content-Length", "40")
            self.end_headers()
            self.wfile.flush()
            try:
                for _ in range(40):
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.15)
            except OSError:
                pass
        elif self.path == "/to-loopback":
            self.send_response(302)
            self.send_header("Location", f"http://localhost:{self.server.server_address[1]}/plain")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()


@pytest.fixture
def server() -> Iterator[str]:
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()


def _client(transport=None, **kw) -> H.Client:
    return H.Client(
        settings=_Settings(),
        transport=transport,
        sleep=lambda _s: None,
        limiter=H.HostLimiter(4),
        **kw,
    )


# ------------------------------------------------------------------ address policy


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "127.1.2.3",
        "0.0.0.0",
        "10.0.0.5",
        "172.16.3.4",
        "192.168.1.1",
        "169.254.169.254",  # cloud metadata
        "100.64.0.1",  # carrier-grade NAT
        "224.0.0.1",
        "255.255.255.255",
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",  # IPv4-mapped loopback
        "::ffff:169.254.169.254",
        "64:ff9b::a9fe:a9fe",  # NAT64 of 169.254.169.254
        "2002:7f00:1::",  # 6to4 of 127.0.0.1
        "not-an-ip",
    ],
)
def test_non_public_addresses_are_refused(ip):
    assert H.is_public_address(ip) is False


@pytest.mark.parametrize(
    "ip",
    [
        "142.250.78.14",
        "8.8.8.8",
        "2607:f8b0:4004:c07::64",
        "64:ff9b::8efa:4e0e",  # NAT64 of a public address
        "198.18.0.7",  # fake-IP proxy range (TUN mode tools): must keep working
    ],
)
def test_public_addresses_are_allowed(ip):
    assert H.is_public_address(ip) is True


def test_default_transport_refuses_loopback(server):
    with pytest.raises(H.AddressBlocked):
        H.UrllibTransport()(H.TransportRequest("GET", f"{server}/plain", {}, 2.0))


def test_default_transport_refuses_localhost_name(server):
    port = server.rsplit(":", 1)[1]
    with pytest.raises(H.AddressBlocked):
        H.UrllibTransport()(H.TransportRequest("GET", f"http://localhost:{port}/plain", {}, 2.0))


def test_client_turns_blocked_address_into_http_error_without_retry(server, monkeypatch):
    calls = []
    real = H.UrllibTransport()

    def counting(req):
        calls.append(req.url)
        return real(req)

    with pytest.raises(T.HttpError, match="non-public"):
        _client(transport=counting).get(f"{server}/plain")
    assert len(calls) == 1  # a refused address is not retried


def test_redirect_into_loopback_is_refused(server):
    """First hop allowed (opt-in), the redirect target is checked on its own hop."""
    allow_first = H.UrllibTransport(allow_private_networks=True)
    strict = H.UrllibTransport()

    def transport(req):
        return (allow_first if req.url.endswith("/to-loopback") else strict)(req)

    with pytest.raises(T.HttpError, match="non-public"):
        _client(transport=transport).get(f"{server}/to-loopback")


def test_proxied_request_still_checks_the_target(monkeypatch):
    """With a proxy the socket goes to the proxy, so the target host is checked before sending."""
    monkeypatch.setattr(
        H.urllib.request,
        "getproxies",
        lambda: {"http": "http://127.0.0.1:9", "https": "http://127.0.0.1:9"},
    )
    monkeypatch.setattr(H.urllib.request, "proxy_bypass", lambda host: False)
    with pytest.raises(H.AddressBlocked):
        H.UrllibTransport()(H.TransportRequest("GET", "http://169.254.169.254/latest/", {}, 1.0))


def test_opt_in_allows_loopback(server):
    resp = H.UrllibTransport(allow_private_networks=True)(
        H.TransportRequest("GET", f"{server}/plain", {}, 2.0)
    )
    assert resp.status == 200 and resp.content == b"hello"


def test_blocked_connect_never_opens_a_socket_to_the_address(monkeypatch):
    """The guard filters resolved addresses before ``connect``: no SYN to an internal host."""
    attempted = []
    real_connect = socket.socket.connect

    def spy(self, address):
        attempted.append(address)
        return real_connect(self, address)

    monkeypatch.setattr(socket.socket, "connect", spy)
    with pytest.raises(H.AddressBlocked):
        H.UrllibTransport()(H.TransportRequest("GET", "http://10.255.255.1:81/", {}, 1.0))
    assert attempted == []


# ------------------------------------------------------------------ body limits


def test_gzip_bomb_is_capped_by_max_bytes(server):
    client = _client(
        transport=H.UrllibTransport(allow_private_networks=True), max_bytes=1024 * 1024
    )
    with pytest.raises(T.HttpError, match="larger than"):
        client.get(f"{server}/bomb")


def test_slow_drip_body_respects_the_total_deadline(server):
    transport = H.UrllibTransport(allow_private_networks=True)
    t0 = time.monotonic()
    with pytest.raises(H.TransportTimeout):
        transport(H.TransportRequest("GET", f"{server}/drip", {}, 0.6))
    assert time.monotonic() - t0 < 3.0
