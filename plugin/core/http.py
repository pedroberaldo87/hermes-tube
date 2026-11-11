"""Synchronous HTTP client of the plugin: implementation of the ``HttpClient`` protocol.

- **stdlib** (``urllib``), no ``httpx``: ``httpx`` is not a declared dependency of the plugin and
  the real gain (connection pooling) does not pay off — RSS runs in the background, 4 at a time.
- **Injectable transport**: ``Transport`` = ``Callable[[TransportRequest], HttpResponse]``, one
  request, **without** following redirects; status >= 400 is a response, not an exception; network
  failure → ``TransportError``/``OSError``; timeout → ``TransportTimeout``/``TimeoutError``. The
  default is ``UrllibTransport``. Tests pass a fake to ``Client(transport=...)``; ``build`` keeps
  the contract signature.
- **Redirects** are followed here (up to ``MAX_REDIRECTS``), one hop at a time: headers, cookie
  and semaphore are recomputed for each hop's host (``SOCS`` never leaves YouTube).
- **Retries**: ``ATTEMPTS`` in total for 429, 5xx and network error/timeout, with exponential
  backoff (``BACKOFF_BASE_S`` · 2ⁿ, +0–25 % jitter) or ``Retry-After`` (capped at
  ``MAX_BACKOFF_S``). The semaphore slot is released while waiting. Once exhausted: 429/5xx return
  the last response; network/timeout → ``HttpError``.
- **Concurrency**: at most ``MAX_PER_HOST`` requests in flight per host, in a ``HostLimiter``
  shared by the process (the only mutable global state of this module).
- **Headers**: desktop browser ``User-Agent``, English ``Accept-Language`` (the parsers read texts
  such as "3 days ago"), ``gzip``; cookie ``SOCS=CAI`` only on ``YOUTUBE_COOKIE_HOSTS``.
- Only ``http``/``https``. There is no closed host list (importing a list may fetch a page from any
  public site); ``KNOWN_HOSTS`` documents the plugin's hosts for the catalog disclosure.
- **Public addresses only** (anti-SSRF): ``UrllibTransport`` refuses to connect to loopback,
  private, link-local (cloud metadata ``169.254.169.254``), carrier-grade NAT, multicast, reserved
  and unspecified addresses, including IPv4 hidden in IPv6 (mapped, NAT64, 6to4). The check runs
  on every hop (each redirect is a new request) and on the addresses actually dialled, so DNS
  rebinding between check and connect does not get through. Behind a proxy the socket goes to the
  proxy, so the target host is resolved and checked before the request is sent. Tests that talk
  to a local server opt in with ``UrllibTransport(allow_private_networks=True)``.
- **Body limits**: ``max_bytes`` caps both the bytes on the wire and the decompressed body (no
  gzip bomb); the total deadline is checked after every socket read, so a server that drips one
  byte at a time cannot hold a request open past ``timeout``.
"""

from __future__ import annotations

import contextlib
import email.utils
import functools
import http.client
import ipaddress
import os
import random
import socket
import ssl
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zlib
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit

from tube_pkg.core.types import Clock, HttpClient, HttpError, HttpResponse, Settings, SystemClock

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DEFAULT_HEADERS: Mapping[str, str] = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}
YOUTUBE_COOKIE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"})
"""The only hosts that receive the anonymous consent cookie."""
CONSENT_COOKIE = "SOCS=CAI"
KNOWN_HOSTS = (
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "i.ytimg.com",
    "hackertube.org",
    "127.0.0.1",
    "localhost",
)

DEFAULT_TIMEOUT_S = 10.0
DOWNLOAD_TIMEOUT_S = 120.0
ATTEMPTS = 3
"""Attempts in total (1 + 2 retries)."""
BACKOFF_BASE_S = 0.5
MAX_BACKOFF_S = 10.0
MAX_PER_HOST = 4
MAX_REDIRECTS = 10
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
"""Cap for ``get`` (YouTube pages are ~1–2 MB), on the wire and after decompression."""
MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_CHUNK = 64 * 1024
_SENSITIVE_ON_CROSS_HOST = frozenset({"cookie", "authorization"})


# --------------------------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------------------------


class TransportError(Exception):
    """Network failure (connection, DNS, TLS, truncated body). Retryable."""


class TransportTimeout(TransportError):
    """Request deadline exceeded. Retryable."""


class ResponseTooLarge(TransportError):
    """Body larger than ``max_bytes``. **Not** retried."""


class AddressBlocked(TransportError):
    """The host resolves to a non-public address (loopback, private network...). **Not** retried."""


@dataclass(frozen=True, slots=True)
class TransportRequest:
    method: str
    url: str
    headers: Mapping[str, str]
    timeout: float
    sink: BinaryIO | None = None
    """If given, a 2xx response body goes here (the response comes back with ``content=b""``)."""
    max_bytes: int | None = None


Transport = Callable[[TransportRequest], HttpResponse]


# ------------------------------------------------------------------ address policy (anti-SSRF)

_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_FAKE_IP = ipaddress.ip_network("198.18.0.0/15")
"""Benchmarking range that "fake-IP" proxy tools (TUN mode) hand out for every public name; no
local service lives there, so it is allowed or those users could not reach YouTube at all."""


def is_public_address(ip: str) -> bool:
    """``True`` only for a globally routable unicast address (plus the fake-IP range).

    IPv4 carried inside IPv6 (``::ffff:a.b.c.d``, NAT64 ``64:ff9b::/96``, 6to4 ``2002::/16``) is
    judged by the embedded IPv4. Anything that does not parse is not public.
    """
    try:
        addr: ipaddress.IPv4Address | ipaddress.IPv6Address = ipaddress.ip_address(
            str(ip).split("%", 1)[0]
        )
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            addr = addr.ipv4_mapped
        elif addr in _NAT64:
            addr = ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF)
        elif addr.sixtofour is not None:
            addr = addr.sixtofour
    if isinstance(addr, ipaddress.IPv4Address) and addr in _FAKE_IP:
        return True
    return bool(addr.is_global) and not addr.is_multicast


def _blocked(host: str, ip: str) -> AddressBlocked:
    shown = host if host == ip else f"{host} ({ip})"
    return AddressBlocked(f"refusing to connect to non-public address {shown}")


def _resolve(host: str, port: int) -> list[tuple]:
    return socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)


def check_host(host: str, port: int) -> None:
    """Raises ``AddressBlocked`` if *host* is, or resolves to, any non-public address.

    A name that does not resolve is left alone (the request fails on its own later)."""
    try:
        infos = _resolve(host, port)
    except (OSError, UnicodeError):
        return
    for info in infos:
        ip = str(info[4][0])
        if not is_public_address(ip):
            raise _blocked(host, ip)


def _proxy_hosts(proxies: Mapping[str, str]) -> frozenset[str]:
    hosts = set()
    for scheme, value in proxies.items():
        if scheme == "no" or not value:
            continue
        with contextlib.suppress(ValueError):
            h = urlsplit(value if "://" in value else f"http://{value}").hostname
            if h:
                hosts.add(h.lower())
    return frozenset(hosts)


_DEFAULT_TIMEOUT = getattr(socket, "_GLOBAL_DEFAULT_TIMEOUT", object())


def _connect_public(
    address,
    timeout=_DEFAULT_TIMEOUT,
    source_address=None,
    *,
    proxy_hosts: frozenset[str] = frozenset(),
):
    """``socket.create_connection`` that only dials public addresses.

    The resolved addresses are filtered **before** ``connect`` (no SYN to an internal host), and
    the connection is made to the vetted IP itself, so a second DNS answer cannot swap it. The
    configured proxy (often on loopback) is the one exception: the target behind it was checked by
    ``UrllibTransport`` before the request.
    """
    host, port = address[0], address[1]
    if str(host).lower() in proxy_hosts:
        return socket.create_connection(address, timeout, source_address)
    infos = _resolve(host, port)
    allowed = [i for i in infos if is_public_address(str(i[4][0]))]
    if not allowed:
        raise _blocked(str(host), str(infos[0][4][0]) if infos else "?")
    last: OSError | None = None
    for family, kind, proto, _canon, sockaddr in allowed:
        sock = socket.socket(family, kind, proto)
        try:
            if timeout is not _DEFAULT_TIMEOUT:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
            return sock
        except OSError as err:
            last = err
            sock.close()
    assert last is not None
    raise last


def _public_connection(base: type, proxy_hosts: frozenset[str]) -> type:
    connect = functools.partial(_connect_public, proxy_hosts=proxy_hosts)

    class _Public(base):  # type: ignore[valid-type, misc]
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, **kwargs)
            self._create_connection = connect

    _Public.__name__ = f"Public{base.__name__}"
    return _Public


class _PublicHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, proxy_hosts: frozenset[str]) -> None:
        super().__init__()
        self._conn = _public_connection(http.client.HTTPConnection, proxy_hosts)

    def http_open(self, req):
        return self.do_open(self._conn, req)


class _PublicHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, context: ssl.SSLContext, proxy_hosts: frozenset[str]) -> None:
        super().__init__(context=context)
        self._public_context = context
        self._conn = _public_connection(http.client.HTTPSConnection, proxy_hosts)

    def https_open(self, req):
        return self.do_open(self._conn, req, context=self._public_context)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # the Client follows (or not) on its own


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # optional: present in the Hermes environment

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001 - without certifi, use the system store
        return ssl.create_default_context()


class UrllibTransport:
    """Default transport over ``urllib``: one request, no redirect following, no stored cookies,
    a total deadline of ``timeout`` to connect and read the body, public addresses only (unless
    *allow_private_networks*)."""

    def __init__(
        self, ssl_context: ssl.SSLContext | None = None, *, allow_private_networks: bool = False
    ) -> None:
        context = ssl_context or _ssl_context()
        self._allow_private = bool(allow_private_networks)
        self._proxies = dict(urllib.request.getproxies())
        handlers: list[urllib.request.BaseHandler] = [urllib.request.ProxyHandler(self._proxies)]
        if self._allow_private:
            handlers.append(urllib.request.HTTPSHandler(context=context))
        else:
            hosts = _proxy_hosts(self._proxies)
            handlers += [_PublicHTTPHandler(hosts), _PublicHTTPSHandler(context, hosts)]
        self._opener = urllib.request.build_opener(_NoRedirect(), *handlers)

    def _proxied(self, url: str) -> bool:
        parts = urlsplit(url)
        if parts.scheme.lower() not in self._proxies:
            return False
        return not urllib.request.proxy_bypass(parts.hostname or "")

    def _precheck(self, url: str) -> None:
        """Behind a proxy the socket goes to the proxy, so the target host is resolved and checked
        here, before the request leaves (without a proxy the connect-time filter does it)."""
        if not self._proxied(url):
            return
        parts = urlsplit(url)
        try:
            port = parts.port or (443 if parts.scheme.lower() == "https" else 80)
        except ValueError:
            return
        check_host(parts.hostname or "", port)

    def __call__(self, req: TransportRequest) -> HttpResponse:
        if not self._allow_private:
            self._precheck(req.url)
        deadline = time.monotonic() + req.timeout
        request = urllib.request.Request(req.url, headers=dict(req.headers), method=req.method)
        try:
            try:
                resp = self._opener.open(request, timeout=req.timeout)
            except urllib.error.HTTPError as err:  # 3xx/4xx/5xx: a response, not an exception
                resp = err
            with contextlib.closing(resp):
                status = int(resp.getcode() or 0)
                headers = _merge_headers(resp.headers.items() if resp.headers else ())
                sink = req.sink if (req.sink is not None and 200 <= status < 300) else None
                body = _read_body(resp, sink, deadline, req.max_bytes)
        except TransportError:
            raise
        except urllib.error.URLError as err:
            reason = err.reason
            if isinstance(reason, TransportError):
                raise reason from err
            if isinstance(reason, TimeoutError):
                raise TransportTimeout(f"timeout: {reason}") from err
            raise TransportError(str(reason)) from err
        except TimeoutError as err:
            raise TransportTimeout(f"timeout: {err}") from err
        except (OSError, http.client.HTTPException) as err:
            raise TransportError(f"{type(err).__name__}: {err}") from err
        if sink is None:
            body = _decode(body, _header(headers, "content-encoding") or "", req.max_bytes)
        return HttpResponse(status=status, url=req.url, headers=headers, content=body)


def _merge_headers(items) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in items:
        k = key.lower()
        out[k] = f"{out[k]}, {value}" if k in out else value
    return out


def _too_large(max_bytes: int) -> ResponseTooLarge:
    return ResponseTooLarge(f"response larger than {max_bytes} bytes")


def _read_body(resp, sink: BinaryIO | None, deadline: float, max_bytes: int | None) -> bytes:
    # ``read1`` returns after a single socket read: the deadline is checked between reads, so a
    # body dripped byte by byte cannot outlive ``timeout`` (``read(n)`` would wait for n bytes)
    read = getattr(resp, "read1", None) or resp.read
    chunks: list[bytes] = []
    total = 0
    while True:
        if time.monotonic() > deadline:
            raise TransportTimeout("timeout reading the body")
        chunk = read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if max_bytes is not None and total > max_bytes:
            raise _too_large(max_bytes)
        if sink is not None:
            sink.write(chunk)
        else:
            chunks.append(chunk)
    if time.monotonic() > deadline:
        raise TransportTimeout("timeout reading the body")
    return b"".join(chunks)


def _inflate(body: bytes, wbits: int, max_bytes: int | None) -> bytes:
    """Decompresses every member of *body*, never producing more than *max_bytes*."""
    out = bytearray()
    data = body
    while data:
        d = zlib.decompressobj(wbits)
        room = 0 if max_bytes is None else max_bytes - len(out) + 1
        out += d.decompress(data, room) if max_bytes is not None else d.decompress(data)
        if max_bytes is not None and (len(out) > max_bytes or d.unconsumed_tail):
            raise _too_large(max_bytes)
        out += d.flush()
        if max_bytes is not None and len(out) > max_bytes:
            raise _too_large(max_bytes)
        if not d.eof:
            raise zlib.error("truncated stream")
        data = d.unused_data
        if wbits != 16 + zlib.MAX_WBITS or not data.strip(b"\0"):
            break  # only gzip has several members; zero padding after the last one is ignored
    return bytes(out)


def _decode(body: bytes, encoding: str, max_bytes: int | None = None) -> bytes:
    enc = encoding.strip().lower()
    if not body or enc in ("", "identity"):
        return body
    try:
        if enc in ("gzip", "x-gzip"):
            return _inflate(body, 16 + zlib.MAX_WBITS, max_bytes)
        if enc == "deflate":
            try:
                return _inflate(body, zlib.MAX_WBITS, max_bytes)
            except zlib.error:
                return _inflate(body, -zlib.MAX_WBITS, max_bytes)
    except (OSError, EOFError, zlib.error) as err:
        raise TransportError(f"unreadable {enc} body: {err}") from err
    return body


# --------------------------------------------------------------------------------------------
# Per-host limit
# --------------------------------------------------------------------------------------------


class HostLimiter:
    """One ``BoundedSemaphore(limit)`` per host, created on demand."""

    def __init__(self, limit: int = MAX_PER_HOST) -> None:
        if limit < 1:
            raise ValueError("limit >= 1")
        self.limit = limit
        self._lock = threading.Lock()
        self._sems: dict[str, threading.BoundedSemaphore] = {}

    def _semaphore(self, host: str) -> threading.BoundedSemaphore:
        with self._lock:
            sem = self._sems.get(host)
            if sem is None:
                sem = self._sems[host] = threading.BoundedSemaphore(self.limit)
            return sem

    @contextlib.contextmanager
    def slot(self, host: str) -> Iterator[None]:
        sem = self._semaphore(host)
        sem.acquire()
        try:
            yield
        finally:
            sem.release()


_SHARED_LIMITER = HostLimiter(MAX_PER_HOST)
"""Process semaphores: every ``Client`` without its own ``limiter`` shares the per-host limit."""


# --------------------------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------------------------


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def is_youtube_cookie_host(url: str) -> bool:
    return _host(url) in YOUTUBE_COOKIE_HOSTS


def _check_url(url: str) -> None:
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError as err:
        raise HttpError(f"invalid URL: {url!r} ({err})", url=url) from err
    if parts.scheme.lower() not in ("http", "https") or not host:
        raise HttpError(f"URL not allowed (only http/https with a host): {url!r}", url=url)


def _with_params(url: str, params: Mapping[str, str] | None) -> str:
    if not params:
        return url
    parts = urlsplit(url)
    extra = urlencode([(str(k), str(v)) for k, v in params.items()])
    query = f"{parts.query}&{extra}" if parts.query else extra
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _header(headers: Mapping[str, str], name: str) -> str | None:
    """Case-insensitive header lookup (fake transports may not normalize)."""
    value = headers.get(name)
    if value is not None:
        return value
    lname = name.lower()
    for k, v in headers.items():
        if k.lower() == lname:
            return v
    return None


def _retry_after(resp: HttpResponse, now: float) -> float | None:
    raw = _header(resp.headers, "retry-after")
    if not raw:
        return None
    raw = raw.strip()
    if raw.isdigit():
        return float(raw)
    try:
        when = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if when is None:
        return None
    return max(0.0, when.timestamp() - now)


class Client:
    """The plugin's ``HttpClient`` (see the module docstring)."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        clock: Clock | None = None,
        transport: Transport | None = None,
        sleep: Callable[[float], None] | None = None,
        limiter: HostLimiter | None = None,
        attempts: int = ATTEMPTS,
        max_bytes: int = MAX_RESPONSE_BYTES,
        rng: Callable[[], float] | None = None,
    ) -> None:
        self._settings = settings  # reserved (e.g. language); changes nothing today
        self._clock = clock if clock is not None else SystemClock()
        self._transport: Transport = transport if transport is not None else UrllibTransport()
        self._sleep = sleep if sleep is not None else time.sleep
        self._limiter = limiter if limiter is not None else _SHARED_LIMITER
        self._attempts = max(1, attempts)
        self._max_bytes = max_bytes
        self._rng = rng if rng is not None else random.random

    # ---------------------------------------------------------------- HttpClient protocol

    def get(
        self,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
        timeout: float = DEFAULT_TIMEOUT_S,
        follow_redirects: bool = True,
    ) -> HttpResponse:
        return self._fetch(
            _with_params(url, params),
            headers=headers,
            timeout=timeout,
            follow_redirects=follow_redirects,
            sink=None,
            max_bytes=self._max_bytes,
        )

    def download_to(self, url: str, dest: str, *, timeout: float = DOWNLOAD_TIMEOUT_S) -> int:
        _check_url(url)
        target = Path(dest)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".part", dir=target.parent
        )
        try:
            with os.fdopen(fd, "w+b") as sink:
                resp = self._fetch(
                    url,
                    headers={"Accept-Encoding": "identity", "Accept": "*/*"},
                    timeout=timeout,
                    follow_redirects=True,
                    sink=sink,
                    max_bytes=MAX_DOWNLOAD_BYTES,
                )
                if not 200 <= resp.status < 300:
                    raise HttpError(
                        f"download of {url} failed: HTTP {resp.status}", url=url, status=resp.status
                    )
                sink.flush()
                os.fsync(sink.fileno())
                size = sink.tell()
            os.replace(tmp_name, target)
            return size
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp_name)
            raise

    # ---------------------------------------------------------------- internals

    def _headers_for(self, url: str, extra: Mapping[str, str] | None) -> dict[str, str]:
        merged: dict[str, tuple[str, str]] = {k.lower(): (k, v) for k, v in DEFAULT_HEADERS.items()}
        for k, v in (extra or {}).items():
            merged[k.lower()] = (k, v)
        if is_youtube_cookie_host(url):
            name, cookie = merged.get("cookie", ("Cookie", ""))
            if "SOCS=" not in cookie:
                cookie = f"{cookie}; {CONSENT_COOKIE}" if cookie.strip() else CONSENT_COOKIE
            merged["cookie"] = (name, cookie)
        return dict(merged.values())

    def _fetch(
        self,
        url: str,
        *,
        headers: Mapping[str, str] | None,
        timeout: float,
        follow_redirects: bool,
        sink: BinaryIO | None,
        max_bytes: int,
    ) -> HttpResponse:
        _check_url(url)
        current = url
        extra = dict(headers or {})
        for hop in range(MAX_REDIRECTS + 1):
            req = TransportRequest(
                method="GET",
                url=current,
                headers=self._headers_for(current, extra),
                timeout=timeout,
                sink=sink,
                max_bytes=max_bytes,
            )
            resp = self._send(req)
            location = _header(resp.headers, "location")
            if not (follow_redirects and resp.status in REDIRECT_STATUSES and location):
                return resp
            if hop == MAX_REDIRECTS:
                break
            nxt = urljoin(current, location)
            _check_url(nxt)
            if _host(nxt) != _host(current):
                extra = {
                    k: v for k, v in extra.items() if k.lower() not in _SENSITIVE_ON_CROSS_HOST
                }
            current = nxt
        raise HttpError(f"too many redirects (> {MAX_REDIRECTS}) from {url}", url=url)

    def _send(self, req: TransportRequest) -> HttpResponse:
        host = _host(req.url)
        last_error: BaseException | None = None
        resp: HttpResponse | None = None
        for attempt in range(self._attempts):
            resp, last_error = None, None
            if req.sink is not None:
                req.sink.seek(0)
                req.sink.truncate()
            with self._limiter.slot(host):
                try:
                    resp = self._transport(req)
                except (ResponseTooLarge, AddressBlocked) as err:
                    reason = "blocked" if isinstance(err, AddressBlocked) else "too_large"
                    raise HttpError(f"{req.url}: {err}", url=req.url, reason=reason) from err
                except (TransportError, OSError) as err:
                    last_error = err
                except Exception as err:  # noqa: BLE001 - never a bare exception for the caller
                    raise HttpError(f"{req.url}: {type(err).__name__}: {err}", url=req.url) from err
            if resp is not None and resp.status not in RETRY_STATUSES:
                return resp
            if attempt + 1 < self._attempts:
                self._sleep(self._backoff(attempt, resp))
        if resp is not None:
            return resp  # 429/5xx exhausted: the caller decides
        assert last_error is not None
        kind = (
            "timeout"
            if isinstance(last_error, TransportTimeout | TimeoutError)
            else "network failure"
        )
        raise HttpError(
            f"{kind} on {req.url} after {self._attempts} attempts: {last_error}",
            url=req.url,
            attempts=self._attempts,
            reason=kind,
        ) from last_error

    def _backoff(self, attempt: int, resp: HttpResponse | None) -> float:
        if resp is not None:
            hinted = _retry_after(resp, float(self._clock.now()))
            if hinted is not None:
                return min(hinted, MAX_BACKOFF_S)
        base = min(BACKOFF_BASE_S * (2**attempt), MAX_BACKOFF_S)
        return base * (1.0 + 0.25 * self._rng())


def build(*, settings: Settings, clock: Clock | None = None) -> HttpClient:
    """Client over the ``urllib`` transport. No network and no thread here."""
    return Client(settings=settings, clock=clock)


__all__ = [
    "ATTEMPTS",
    "BACKOFF_BASE_S",
    "CONSENT_COOKIE",
    "DEFAULT_HEADERS",
    "KNOWN_HOSTS",
    "MAX_BACKOFF_S",
    "MAX_PER_HOST",
    "MAX_REDIRECTS",
    "USER_AGENT",
    "YOUTUBE_COOKIE_HOSTS",
    "AddressBlocked",
    "Client",
    "HostLimiter",
    "ResponseTooLarge",
    "Transport",
    "TransportError",
    "TransportRequest",
    "TransportTimeout",
    "UrllibTransport",
    "build",
    "check_host",
    "is_public_address",
    "is_youtube_cookie_host",
]
