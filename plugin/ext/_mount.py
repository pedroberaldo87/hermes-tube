"""Mounts the extension routes on the plugin's own server.

Contract: ``contract/ext-protocol.md`` §4, §5 and §9. Binds each route of ``ROUTES`` (= the
``x-transport: ext`` routes of ``contract/api.yaml``, except ``/health``, which belongs to
``_server.py``) to the matching pure handler of ``ExtHandlers``:

- ``Handler = (device, body, query) -> Envelope``; ``device`` = authenticated device (``None`` on
  routes without Bearer); ``body`` = JSON body (``None`` on GET, ``{}`` on POST without a body);
  ``query`` = query parameters + path parameters (the path wins);
- routes with ``deviceToken``: an ``Authorization`` Bearer header is required (otherwise
  ``401 unauthorized`` + ``WWW-Authenticate: Bearer``) and checked by ``ExtHandlers.authenticate``
  (``ext/auth.py``; ``bearer_authenticator(devices)`` is the adapter over the ``DeviceAuth``
  protocol); a token with a pinned origin and a different ``Origin`` present → ``403
  origin_mismatch``;
- ``POST /pair/complete`` without ``Origin`` → ``403 origin_required``; with ``Origin``, it reaches
  the handler in ``query[ORIGIN_QUERY_KEY]`` (to pin the origin at pairing) — reserved key: any
  value sent by the client is discarded on every route; the port the server listens on goes in
  ``query[PORT_QUERY_KEY]`` there too (the pairing proof is bound to it; same reservation);
- ``TubeError`` raised by the handler → error envelope with the status from ``ERROR_HTTP_STATUS``
  (``PairingFailed`` uses its ``reason`` as ``code``); any other exception → ``500 internal`` with
  a short message (no exception text);
- invalid JSON body or one that is not an object → ``422 invalid``; the body limit lives in
  ``_server.py`` (``MAX_BODY_BYTES``); unknown route → ``404 not_found`` (``_server.py``).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core.types import (
    ERROR_HTTP_STATUS,
    Device,
    DeviceAuth,
    PairingFailed,
    TubeError,
    Unauthorized,
    to_jsonable,
)
from tube_pkg.ext._server import Request, Response, transport_error

logger = logging.getLogger(__name__)

# {"ok": True, "data": <JSON>} | {"ok": False, "error": {"code", "message", "reason"?, "details"?}}
Envelope = dict[str, Any]

# (device, body, query) -> Envelope. Pure function: no process state, no os.environ, no
# get_hermes_home(). May raise TubeError: the mount turns it into envelope + HTTP status.
Handler = Callable[[Device | None, Mapping[str, Any] | None, Mapping[str, str]], Envelope]

# (Authorization, Origin) -> Device; raises Unauthorized / an origin error
Authenticator = Callable[[str | None, str | None], Device]

ORIGIN_QUERY_KEY = "_origin"
"""Reserved ``query`` key carrying the request's ``Origin`` on ``POST /pair/complete``."""
PORT_QUERY_KEY = "_port"
"""Reserved ``query`` key carrying the port the server listens on, on ``POST /pair/complete``."""
_RESERVED = frozenset({ORIGIN_QUERY_KEY, PORT_QUERY_KEY})

WWW_AUTHENTICATE: tuple[str, str] = ("WWW-Authenticate", f'Bearer realm="{PLUGIN_ID}"')


@dataclass(frozen=True)
class ExtHandlers:
    """One field per ``x-handler`` of api.yaml (x-transport: ext routes, except /health)."""

    authenticate: Authenticator
    pair_complete: Handler
    unpair: Handler
    get_state: Handler
    sync_subscriptions: Handler
    sync_watch: Handler
    get_feed: Handler
    post_videos_state: Handler
    post_read: Handler
    get_queue: Handler
    post_queue_result: Handler
    get_search_jobs: Handler
    post_search_result: Handler


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    handler: str
    """Field name in ``ExtHandlers`` (= ``x-handler``)."""
    auth: bool
    """Requires ``deviceToken`` (non-empty ``security`` in api.yaml)."""
    origin_required: bool = False


ROUTES: tuple[Route, ...] = (
    Route("POST", "/pair/complete", "pair_complete", auth=False, origin_required=True),
    Route("POST", "/ext/unpair", "unpair", auth=True),
    Route("GET", "/ext/state", "get_state", auth=True),
    Route("POST", "/ext/sync/subscriptions", "sync_subscriptions", auth=True),
    Route("POST", "/ext/sync/watch", "sync_watch", auth=True),
    Route("GET", "/ext/feed", "get_feed", auth=True),
    Route("POST", "/ext/videos/state", "post_videos_state", auth=True),
    Route("POST", "/ext/read", "post_read", auth=True),
    Route("GET", "/ext/queue", "get_queue", auth=True),
    Route("POST", "/ext/queue/{id}/result", "post_queue_result", auth=True),
    Route("GET", "/ext/search-jobs", "get_search_jobs", auth=True),
    Route("POST", "/ext/search-jobs/{id}/result", "post_search_result", auth=True),
)


class TransportError(TubeError):
    """Transport error with a ``code`` from ``x-error-codes`` (e.g. ``origin_mismatch``)."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


# ==================== authentication


def bearer_token(authorization: str | None) -> str | None:
    """Bearer token from ``Authorization``; ``None`` if absent, another scheme or empty."""
    if not authorization:
        return None
    scheme, _, rest = authorization.strip().partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = rest.strip()
    return token or None


def check_origin(device: Any, origin: str | None) -> None:
    """Origin pinned at pairing and a different ``Origin`` present → ``origin_mismatch``.

    Without ``Origin`` (service worker GET) there is nothing to compare: the token is the
    boundary."""
    pinned = getattr(device, "origin", None)
    if origin is not None and pinned and origin != pinned:
        raise TransportError("origin_mismatch", "token paired by another extension")


def bearer_authenticator(devices: DeviceAuth) -> Authenticator:
    """``Authenticator`` over the ``DeviceAuth`` protocol (``verify`` updates ``last_seen``)."""

    def authenticate(authorization: str | None, origin: str | None) -> Device:
        token = bearer_token(authorization)
        if token is None:
            raise Unauthorized("Bearer device token required")
        device = devices.verify(token)
        check_origin(device, origin)
        return device

    return authenticate


# ==================== envelopes


def error_response(exc: TubeError) -> tuple[int, Envelope, list[tuple[str, str]]]:
    """``TubeError`` → ``(status, envelope, headers)`` per ``x-error-codes``."""
    is_pairing = isinstance(exc, PairingFailed)
    code = exc.reason if is_pairing else str(getattr(exc, "code", "internal"))
    message = getattr(exc, "message", "") or code
    if code not in ERROR_HTTP_STATUS:
        logger.error("%s: error code outside the contract: %r", PLUGIN_ID, code)
        code, message = "internal", "internal error"
        error: dict[str, Any] = {"code": code, "message": message}
    else:
        error = {"code": code, "message": message}
        reason = getattr(exc, "reason", None)
        if reason and not is_pairing:
            error["reason"] = str(reason)
        details = dict(getattr(exc, "details", None) or {})
        if is_pairing:
            details.pop("reason", None)
        if details:
            error["details"] = to_jsonable(details)
    headers = [WWW_AUTHENTICATE] if code == "unauthorized" else []
    return ERROR_HTTP_STATUS[code], {"ok": False, "error": error}, headers


def _from_error(exc: TubeError) -> Response:
    status, env, headers = error_response(exc)
    return Response(status, env, list(headers))


def _internal() -> Response:
    return transport_error("internal", "internal error")


def envelope_response(env: Any) -> Response:
    """Envelope returned by the handler → HTTP response (status from ``error.code``)."""
    if not isinstance(env, Mapping) or not isinstance(env.get("ok"), bool):
        logger.error("%s: handler returned something that is not an envelope", PLUGIN_ID)
        return _internal()
    payload = to_jsonable(env)
    if payload["ok"]:
        if "data" not in payload:
            logger.error("%s: ok envelope without data", PLUGIN_ID)
            return _internal()
        return Response(200, payload)
    error = payload.get("error")
    code = error.get("code") if isinstance(error, Mapping) else None
    if code not in ERROR_HTTP_STATUS:
        logger.error("%s: error envelope outside the contract: %r", PLUGIN_ID, code)
        return _internal()
    headers = [WWW_AUTHENTICATE] if code == "unauthorized" else []
    return Response(ERROR_HTTP_STATUS[code], payload, headers)


def _parse_body(raw: bytes) -> dict[str, Any] | Response:
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return transport_error("invalid", "the body is not valid JSON")
    if not isinstance(data, dict):
        return transport_error("invalid", "the body must be a JSON object")
    return data


# ==================== mounting


def _endpoint(route: Route, fn: Handler, authenticate: Authenticator) -> Callable[..., Response]:
    def endpoint(request: Request) -> Response:
        origin = request.origin
        if route.origin_required and origin is None:
            return transport_error("origin_required", "request without Origin")
        device: Device | None = None
        if route.auth:
            authorization = request.headers.get("Authorization")
            if bearer_token(authorization) is None:
                return _from_error(Unauthorized("Bearer device token required"))
            try:
                device = authenticate(authorization, origin)
                if device is None:
                    raise Unauthorized("invalid token")
                check_origin(device, origin)
            except TubeError as exc:
                return _from_error(exc)
            except Exception:  # noqa: BLE001
                logger.exception("%s: device authentication failed", PLUGIN_ID)
                return _internal()
        body: dict[str, Any] | None = None
        if request.method != "GET":
            parsed = _parse_body(request.body)
            if isinstance(parsed, Response):
                return parsed
            body = parsed
        query = {k: v for k, v in request.query.items() if k not in _RESERVED}
        query.update(request.path_params)
        if route.origin_required and origin is not None:
            query[ORIGIN_QUERY_KEY] = origin
            port = getattr(request, "port", None)
            if isinstance(port, int):
                query[PORT_QUERY_KEY] = str(port)
        try:
            env = fn(device, body, query)
        except TubeError as exc:
            return _from_error(exc)
        except Exception:  # noqa: BLE001
            logger.exception("%s: handler %s failed", PLUGIN_ID, route.handler)
            return _internal()
        return envelope_response(env)

    endpoint.__name__ = f"ext_{route.handler}"
    return endpoint


def mount(server: Any, *, handlers: ExtHandlers) -> None:
    """Binds the §5 routes to the plugin's server (``server.add_route(method, path, fn)``).

    Transport security from §4 (Host, Origin, CORS, plugin disabled, body limit, unknown
    route) is applied by ``_server.py`` before a request gets here."""
    for route in ROUTES:
        fn = getattr(handlers, route.handler)
        server.add_route(route.method, route.path, _endpoint(route, fn, handlers.authenticate))


__all__ = [
    "ORIGIN_QUERY_KEY",
    "PORT_QUERY_KEY",
    "ROUTES",
    "Authenticator",
    "Envelope",
    "ExtHandlers",
    "Handler",
    "Route",
    "TransportError",
    "bearer_authenticator",
    "bearer_token",
    "check_origin",
    "envelope_response",
    "error_response",
    "mount",
]
