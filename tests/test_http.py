"""``core/http.py`` (``HttpClient``) with a fake transport and a local server on 127.0.0.1.

Real network only in the test marked ``live`` (left out of ``scripts/check``).
"""

from __future__ import annotations

import gzip
import http.server
import importlib.util
import inspect
import os
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load_bootstrap():
    spec = importlib.util.spec_from_file_location(
        "_tube_bootstrap_test_http", ROOT / "plugin" / "_bootstrap.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_load_bootstrap().ensure()

from tube_pkg.core import http as H  # noqa: E402
from tube_pkg.core import types as T  # noqa: E402


class FakeSettings:
    def get(self, key, default=None):
        return T.SETTINGS_DEFAULTS.get(key, default)

    def snapshot(self):
        return T.SettingsSnapshot()

    def set(self, key, value):
        raise AssertionError("http does not write settings")


class FakeTransport:
    """Answers via a ``(request, n) -> HttpResponse | Exception`` function; records requests."""

    def __init__(self, respond=None, delay: float = 0.0):
        self.respond = respond or (lambda req, n: T.HttpResponse(200, req.url, {}, b"ok"))
        self.delay = delay
        self.requests: list[H.TransportRequest] = []
        self._lock = threading.Lock()
        self.active: dict[str, int] = {}
        self.max_active: dict[str, int] = {}
        self.active_total = 0
        self.max_total = 0

    def __call__(self, req: H.TransportRequest) -> T.HttpResponse:
        host = urlsplit(req.url).hostname or ""
        with self._lock:
            n = len(self.requests)
            self.requests.append(req)
            self.active[host] = self.active.get(host, 0) + 1
            self.max_active[host] = max(self.max_active.get(host, 0), self.active[host])
            self.active_total += 1
            self.max_total = max(self.max_total, self.active_total)
        try:
            if self.delay:
                time.sleep(self.delay)
            out = self.respond(req, n)
            if isinstance(out, BaseException):
                raise out
            if req.sink is not None and 200 <= out.status < 300:
                req.sink.write(out.content)
                return T.HttpResponse(out.status, out.url, out.headers, b"")
            return out
        finally:
            with self._lock:
                self.active[host] -= 1
                self.active_total -= 1


class Sleeps(list):
    def __call__(self, seconds: float) -> None:
        self.append(seconds)


def _client(transport, *, sleep=None, limiter=None, **kw) -> H.Client:
    return H.Client(
        settings=FakeSettings(),
        transport=transport,
        sleep=sleep if sleep is not None else Sleeps(),
        limiter=limiter if limiter is not None else H.HostLimiter(4),
        **kw,
    )


def _header(req: H.TransportRequest, name: str) -> str | None:
    for k, v in req.headers.items():
        if k.lower() == name.lower():
            return v
    return None


def _status_seq(*statuses, headers=None):
    def respond(req, n):
        item = statuses[min(n, len(statuses) - 1)]
        if isinstance(item, BaseException):
            return item
        return T.HttpResponse(item, req.url, dict(headers or {}), f"s{item}".encode())

    return respond


# --------------------------------------------------------------------------- module contract


def test_build_signature_and_protocol():
    sig = inspect.signature(H.build)
    params = list(sig.parameters.values())
    assert [p.name for p in params] == ["settings", "clock"]
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params)
    assert sig.parameters["settings"].default is inspect.Parameter.empty
    assert sig.parameters["clock"].default is None
    assert T.BUILD_SIGNATURES["plugin/core/http.py:build"] == (
        "build(*, settings, clock=None) -> HttpClient"
    )
    client = H.build(settings=FakeSettings())
    assert isinstance(client, T.HttpClient)


def test_build_does_no_network(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network in build")

    monkeypatch.setattr(H.UrllibTransport, "__call__", boom)
    H.build(settings=FakeSettings())


# --------------------------------------------------------------------------- headers


def test_default_headers_and_timeout():
    tr = FakeTransport()
    resp = _client(tr).get("https://i.ytimg.com/vi/abc/hq2.jpg")
    assert resp.status == 200 and resp.content == b"ok"
    req = tr.requests[0]
    ua = _header(req, "User-Agent")
    assert ua and ua.startswith("Mozilla/5.0") and "Chrome/" in ua and "Mobile" not in ua
    assert req.timeout == 10.0
    assert req.method == "GET"


def test_caller_headers_override_defaults():
    tr = FakeTransport()
    _client(tr).get("https://hackertube.org/x", headers={"user-agent": "custom", "X-A": "1"})
    req = tr.requests[0]
    assert _header(req, "User-Agent") == "custom"
    assert _header(req, "X-A") == "1"
    assert sum(1 for k in req.headers if k.lower() == "user-agent") == 1


def test_params_are_encoded_and_merged():
    tr = FakeTransport()
    _client(tr).get(
        "https://www.youtube.com/results?hl=en",
        params={"search_query": "rust é bom", "sp": "CAI="},
    )
    query = parse_qs(urlsplit(tr.requests[0].url).query)
    assert query == {"hl": ["en"], "search_query": ["rust é bom"], "sp": ["CAI="]}


@pytest.mark.parametrize("host", ["youtube.com", "www.youtube.com", "m.youtube.com"])
def test_socs_cookie_on_youtube_hosts(host):
    tr = FakeTransport()
    _client(tr).get(f"https://{host}/feeds/videos.xml?channel_id=UC123")
    cookie = _header(tr.requests[0], "Cookie")
    assert cookie is not None and "SOCS=CAI" in cookie


@pytest.mark.parametrize(
    "url",
    [
        "https://i.ytimg.com/vi/abc/hq2.jpg",
        "https://hackertube.org/data.zip",
        "http://127.0.0.1:9/x",
        "http://localhost:9/x",
        "https://evil-youtube.com/",
        "https://youtube.com.evil.org/",
        "https://notyoutube.com/",
        "https://example.org/?u=https://www.youtube.com/",
    ],
)
def test_no_socs_cookie_elsewhere(url):
    tr = FakeTransport()
    _client(tr).get(url)
    cookie = _header(tr.requests[0], "Cookie") or ""
    assert "SOCS" not in cookie


def test_socs_merged_with_caller_cookie_on_youtube():
    tr = FakeTransport()
    _client(tr).get("https://www.youtube.com/", headers={"Cookie": "PREF=hl=en"})
    cookie = _header(tr.requests[0], "Cookie")
    assert cookie is not None and "PREF=hl=en" in cookie and "SOCS=CAI" in cookie


def test_socs_not_carried_across_redirect_to_other_host():
    def respond(req, n):
        if n == 0:
            return T.HttpResponse(302, req.url, {"location": "https://example.org/landing"})
        return T.HttpResponse(200, req.url, {}, b"done")

    tr = FakeTransport(respond)
    resp = _client(tr).get("https://www.youtube.com/@x")
    assert resp.url == "https://example.org/landing"
    assert "SOCS" in (_header(tr.requests[0], "Cookie") or "")
    assert "SOCS" not in (_header(tr.requests[1], "Cookie") or "")


# --------------------------------------------------------------------------- redirects


def test_follow_redirects_false_returns_3xx():
    tr = FakeTransport(_status_seq(303, headers={"location": "https://www.youtube.com/watch?v=x"}))
    resp = _client(tr).get("https://www.youtube.com/shorts/abcdefghijk", follow_redirects=False)
    assert resp.status == 303
    assert resp.headers["location"].endswith("watch?v=x")
    assert len(tr.requests) == 1


def test_follow_redirects_relative_location():
    def respond(req, n):
        if n == 0:
            return T.HttpResponse(301, req.url, {"location": "/channel/UC1"})
        return T.HttpResponse(200, req.url, {}, b"page")

    tr = FakeTransport(respond)
    resp = _client(tr).get("https://www.youtube.com/c/foo")
    assert resp.status == 200
    assert resp.url == "https://www.youtube.com/channel/UC1"


def test_too_many_redirects():
    tr = FakeTransport(lambda req, n: T.HttpResponse(302, req.url, {"location": f"/r{n}"}))
    with pytest.raises(T.HttpError, match="redirec"):
        _client(tr).get("https://www.youtube.com/loop")
    assert len(tr.requests) == H.MAX_REDIRECTS + 1


def test_redirect_to_non_http_scheme_is_refused():
    tr = FakeTransport(_status_seq(302, headers={"location": "file:///etc/passwd"}))
    with pytest.raises(T.HttpError):
        _client(tr).get("https://www.youtube.com/x")


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://x.org/a", "data:,x", "https://"])
def test_non_http_urls_refused_without_transport(url):
    tr = FakeTransport()
    with pytest.raises(T.HttpError):
        _client(tr).get(url)
    assert tr.requests == []


# --------------------------------------------------------------------------- retries


def test_retry_on_5xx_then_success_with_exponential_backoff():
    sleeps = Sleeps()
    tr = FakeTransport(_status_seq(503, 502, 200))
    resp = _client(tr, sleep=sleeps).get("https://www.youtube.com/x")
    assert resp.status == 200
    assert len(tr.requests) == 3 == H.ATTEMPTS
    assert len(sleeps) == 2
    assert H.BACKOFF_BASE_S <= sleeps[0] <= H.BACKOFF_BASE_S * 1.25
    assert 2 * H.BACKOFF_BASE_S <= sleeps[1] <= 2 * H.BACKOFF_BASE_S * 1.25


def test_retry_on_429_honors_retry_after():
    sleeps = Sleeps()
    tr = FakeTransport(_status_seq(429, 200, headers={"retry-after": "3"}))
    resp = _client(tr, sleep=sleeps).get("https://www.youtube.com/x")
    assert resp.status == 200
    assert sleeps == [3.0]


def test_retry_after_is_capped():
    sleeps = Sleeps()
    tr = FakeTransport(_status_seq(429, 200, headers={"retry-after": "3600"}))
    _client(tr, sleep=sleeps).get("https://www.youtube.com/x")
    assert sleeps == [H.MAX_BACKOFF_S]


def test_exhausted_5xx_returns_last_response_without_raising():
    tr = FakeTransport(_status_seq(500))
    resp = _client(tr).get("https://www.youtube.com/x")
    assert resp.status == 500
    assert len(tr.requests) == H.ATTEMPTS


def test_4xx_is_not_retried_and_not_raised():
    tr = FakeTransport(_status_seq(404))
    resp = _client(tr).get("https://www.youtube.com/x")
    assert resp.status == 404
    assert len(tr.requests) == 1


def test_retry_on_network_error_then_success():
    sleeps = Sleeps()
    tr = FakeTransport(
        _status_seq(H.TransportError("conn reset"), ConnectionResetError("reset"), 200)
    )
    resp = _client(tr, sleep=sleeps).get("https://hackertube.org/x")
    assert resp.status == 200
    assert len(tr.requests) == 3
    assert len(sleeps) == 2


def test_network_errors_exhausted_raise_http_error():
    tr = FakeTransport(_status_seq(H.TransportError("dns")))
    with pytest.raises(T.HttpError) as info:
        _client(tr).get("https://hackertube.org/x")
    assert info.value.code == "http_error"
    assert "hackertube.org" in info.value.message
    assert len(tr.requests) == H.ATTEMPTS


def test_too_large_is_not_retried():
    tr = FakeTransport(_status_seq(H.ResponseTooLarge("too large")))
    with pytest.raises(T.HttpError):
        _client(tr).get("https://hackertube.org/x")
    assert len(tr.requests) == 1


# --------------------------------------------------------------------------- timeout


def test_timeout_passed_through_and_retried_then_http_error():
    tr = FakeTransport(_status_seq(H.TransportTimeout("slow")))
    with pytest.raises(T.HttpError, match="timeout"):
        _client(tr).get("https://www.youtube.com/x", timeout=2.5)
    assert [r.timeout for r in tr.requests] == [2.5] * H.ATTEMPTS


def test_builtin_timeout_error_counts_as_timeout():
    tr = FakeTransport(_status_seq(TimeoutError("timed out"), 200))
    assert _client(tr).get("https://www.youtube.com/x").status == 200


# --------------------------------------------------------------------------- concurrency


def _run_parallel(fn, n: int) -> list[BaseException]:
    errors: list[BaseException] = []

    def wrap(i: int) -> None:
        try:
            fn(i)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=wrap, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return errors


def test_at_most_four_concurrent_per_host():
    tr = FakeTransport(delay=0.05)
    client = _client(tr)
    errors = _run_parallel(lambda i: client.get(f"https://www.youtube.com/v{i}"), 16)
    assert errors == []
    assert len(tr.requests) == 16
    assert tr.max_active["www.youtube.com"] == 4


def test_hosts_have_independent_limits():
    tr = FakeTransport(delay=0.1)
    client = _client(tr)
    hosts = ["www.youtube.com", "i.ytimg.com"]
    errors = _run_parallel(lambda i: client.get(f"https://{hosts[i % 2]}/v{i}"), 16)
    assert errors == []
    assert tr.max_active["www.youtube.com"] == 4
    assert tr.max_active["i.ytimg.com"] == 4
    assert tr.max_total == 8


def test_limit_is_shared_between_clients_by_default():
    """Without an explicit ``limiter``, two clients share the same per-host semaphore."""
    tr = FakeTransport(delay=0.05)
    a = H.Client(settings=FakeSettings(), transport=tr, sleep=Sleeps())
    b = H.Client(settings=FakeSettings(), transport=tr, sleep=Sleeps())
    errors = _run_parallel(
        lambda i: (a if i % 2 else b).get(f"https://shared-limit.test.invalid/v{i}"), 16
    )
    assert errors == []
    assert tr.max_active["shared-limit.test.invalid"] == 4


def test_slot_released_during_backoff():
    """The wait between attempts does not hold a semaphore slot."""
    limiter = H.HostLimiter(1)
    seen: list[bool] = []

    def sleep(_s: float) -> None:
        got = limiter._semaphore("www.youtube.com").acquire(blocking=False)
        seen.append(got)
        if got:
            limiter._semaphore("www.youtube.com").release()

    tr = FakeTransport(_status_seq(503, 200))
    _client(tr, sleep=sleep, limiter=limiter).get("https://www.youtube.com/x")
    assert seen == [True]


# --------------------------------------------------------------------------- download_to


def test_download_to_writes_atomically(tmp_path):
    payload = os.urandom(50_000)
    tr = FakeTransport(lambda req, n: T.HttpResponse(200, req.url, {}, payload))
    dest = tmp_path / "sub" / "data.zip"
    n = _client(tr).download_to("https://hackertube.org/data.zip", str(dest))
    assert n == len(payload)
    assert dest.read_bytes() == payload
    assert tr.requests[0].timeout == 120.0
    assert sorted(p.name for p in dest.parent.iterdir()) == ["data.zip"]


def test_download_retry_does_not_duplicate_bytes(tmp_path):
    def respond(req, n):
        if n == 0:
            req.sink.write(b"partial-garbage")
            return H.TransportError("cut off midway")
        return T.HttpResponse(200, req.url, {}, b"complete")

    tr = FakeTransport(respond)
    dest = tmp_path / "d.bin"
    assert _client(tr).download_to("https://hackertube.org/d.bin", str(dest)) == 8
    assert dest.read_bytes() == b"complete"


@pytest.mark.parametrize("failure", [404, 500, "network"])
def test_download_failure_leaves_nothing(tmp_path, failure):
    if failure == "network":
        tr = FakeTransport(_status_seq(H.TransportError("x")))
    else:
        tr = FakeTransport(_status_seq(failure))
    dest = tmp_path / "d.bin"
    dest.write_bytes(b"old")  # the old destination stays intact
    with pytest.raises(T.HttpError):
        _client(tr).download_to("https://hackertube.org/d.bin", str(dest))
    assert dest.read_bytes() == b"old"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["d.bin"]


# ------------------------------------------------------------- real transport (127.0.0.1)


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet in tests
        pass

    def do_GET(self):  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/plain":
            body = b"hello"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("X-Echo-Cookie", self.headers.get("Cookie") or "")
            self.send_header("X-Echo-UA", self.headers.get("User-Agent") or "")
            self.send_header("X-Echo-Query", urlsplit(self.path).query)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/gzip":
            body = gzip.compress(b"compressed body " * 100)
            self.send_response(200)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/redirect":
            self.send_response(303)
            self.send_header("Location", "/plain")
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif path == "/missing":
            body = b"nope"
            self.send_response(404)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/slow":
            time.sleep(1.5)
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
        elif path == "/big":
            body = b"x" * 200_000
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(500)
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


def _real_client(**kw) -> H.Client:
    # the local test server is on loopback, which the default transport refuses
    transport = H.UrllibTransport(allow_private_networks=True)
    return H.Client(
        settings=FakeSettings(), transport=transport, sleep=Sleeps(), limiter=H.HostLimiter(4), **kw
    )


def test_real_transport_basic(server):
    resp = _real_client().get(f"{server}/plain", params={"q": "a b"})
    assert resp.status == 200 and resp.text == "hello"
    assert resp.headers["content-type"] == "text/plain"
    assert resp.headers["x-echo-cookie"] == ""  # 127.0.0.1 never gets SOCS
    assert resp.headers["x-echo-ua"].startswith("Mozilla/5.0")
    assert resp.headers["x-echo-query"] == "q=a+b"


def test_real_transport_gzip(server):
    resp = _real_client().get(f"{server}/gzip")
    assert resp.content == b"compressed body " * 100


def test_real_transport_redirects(server):
    no_follow = _real_client().get(f"{server}/redirect", follow_redirects=False)
    assert no_follow.status == 303
    assert no_follow.headers["location"] == "/plain"
    followed = _real_client().get(f"{server}/redirect")
    assert followed.status == 200
    assert followed.url == f"{server}/plain"


def test_real_transport_error_status_is_a_response(server):
    resp = _real_client().get(f"{server}/missing")
    assert resp.status == 404 and resp.content == b"nope"


def test_real_transport_timeout(server):
    tr = H.UrllibTransport(allow_private_networks=True)
    t0 = time.monotonic()
    with pytest.raises(H.TransportTimeout):
        tr(H.TransportRequest("GET", f"{server}/slow", {}, 0.3))
    assert time.monotonic() - t0 < 1.4


def test_real_client_timeout_becomes_http_error(server):
    with pytest.raises(T.HttpError, match="timeout"):
        _real_client().get(f"{server}/slow", timeout=0.3)


def test_real_transport_size_cap(server):
    with pytest.raises(T.HttpError):
        _real_client(max_bytes=1000).get(f"{server}/big")


def test_real_transport_connection_refused():
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    with pytest.raises(T.HttpError):
        _real_client().get(f"http://127.0.0.1:{port}/x", timeout=1)


def test_real_download(server, tmp_path):
    dest = tmp_path / "big.bin"
    n = _real_client().download_to(f"{server}/big", str(dest))
    assert n == 200_000 and dest.stat().st_size == 200_000


@pytest.mark.live
def test_live_youtube_rss():
    client = H.build(settings=FakeSettings())
    resp = client.get(
        "https://www.youtube.com/feeds/videos.xml",
        params={"channel_id": "UCBJycsmduvYEL83R_U4JriQ"},
    )
    assert resp.status == 200
    assert b"<feed" in resp.content
