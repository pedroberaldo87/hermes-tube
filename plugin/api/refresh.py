"""REST routes of ``plugin/api/refresh.py``: refresh everything, refresh one channel and mark as
read.

- ``POST /refresh`` — ``Refresher.kick_if_due(force)`` (``force`` defaults to ``true``). Never runs
  the cycle on the request thread (the plugin host cuts off at 60 s): the kick only checks and
  takes the lock in ``meta`` and starts the cycle thread. Even the kick runs in a short task with
  a budget (``REFRESH_WAIT_S``): database busy in another process (``BEGIN IMMEDIATE`` waiting for
  ``busy_timeout``) → the route answers ``running`` at once and the kick finishes on its own.
- ``POST /refresh/{channel_id}`` — ``Refresher.kick_channel`` (thread); malformed id →
  ``invalid``; channel not in the table → ``not_found``.
- ``POST /read`` — ``Refresher.mark_read_changes(ReadScope, actor=user)``: channel, folder
  (recursive), tab (the channels it shows) or everything; the core records ``mark_read`` in the
  history with ``UndoMarkRead`` (undoable) and the route returns ``{changed}`` (+ ``change_ids``
  with ``?change_ids=true``).

Services only through ``wiring`` (resolved in the request context). A ``TubeError`` becomes an
envelope right in the handler (a direct call = the same answer as the router).

``run_once``/``Flight`` (one task per key, in a daemon thread with ``contextvars``) also serve
``GET /status`` (``api/status.py``).
"""

from __future__ import annotations

import contextvars
import functools
import logging
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, RestHandler, contract, error_envelope, ok
from tube_pkg.core import dedup
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

REFRESH_WAIT_S = 0.5
"""How long ``POST /refresh`` waits for the kick (normally < 50 ms). Beyond that (database busy in
another process) → ``running``: the request carries on alone, the lock guarantees a single cycle."""

WAIT_STEP_S = 0.0002
"""Step of the routes' deadline wait (see ``Flight.wait``)."""


# =========================================================================== single tasks


class Flight:
    """A task in a daemon thread; ``wait(timeout)`` tells whether it finished."""

    __slots__ = ("done", "error", "value")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.value: Any = None
        self.error: BaseException | None = None

    def wait(self, timeout: float) -> bool:
        """Wait up to *timeout* s in short steps (``WAIT_STEP_S``): on macOS, a background process
        has timed waits stretched by the system (measured: ``Event.wait(0.035)`` → 185 ms,
        ``sleep(0.0002)`` → 1.9 ms); short steps cap the overshoot at ~2 ms. The task finishing
        wakes it at once (``Event``)."""
        end = time.monotonic() + max(timeout, 0.0)
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0:
                return self.done.is_set()
            if self.done.wait(min(remaining, WAIT_STEP_S)):
                return True

    def result(self, default: Any = None) -> Any:
        """The value if it finished without error; otherwise *default*."""
        if not self.done.is_set() or self.error is not None:
            return default
        return self.value


_FLIGHTS: dict[tuple[Any, ...], Flight] = {}
_FLIGHTS_MX = threading.Lock()


def run_once(key: tuple[Any, ...], fn: Callable[[], Any], *, name: str) -> Flight:
    """Run *fn* in a daemon thread (with the caller's context) and return the ``Flight``. If a
    task with the same *key* is already running, return that one (no piling up threads when the
    database is busy and the Desktop polls every 5 s)."""
    with _FLIGHTS_MX:
        current = _FLIGHTS.get(key)
        if current is not None and not current.done.is_set():
            return current
        flight = Flight()
        _FLIGHTS[key] = flight

    def body() -> None:
        try:
            flight.value = fn()
        except BaseException as exc:  # noqa: BLE001 — the thread never raises unhandled
            flight.error = exc
            if isinstance(exc, T.TubeError):
                log.info("%s: %s", name, exc.message)
            else:
                log.exception("%s failed", name)
        finally:
            flight.done.set()

    ctx = contextvars.copy_context()
    try:
        threading.Thread(target=ctx.run, args=(body,), name=name, daemon=True).start()
    except BaseException as exc:  # noqa: BLE001 — no thread: failure recorded in the task itself
        flight.error = exc
        flight.done.set()
        log.exception("%s: thread did not start", name)
    return flight


def profile_key() -> str:
    """Key of the active profile (route tasks and caches are per profile and process)."""
    try:
        return wiring.home_key()
    except Exception:  # noqa: BLE001
        return "?"


def reset() -> None:
    """Forget the registered tasks (tests). Running threads finish on their own."""
    with _FLIGHTS_MX:
        _FLIGHTS.clear()


# =========================================================================== validation


def guard(fn: RestHandler) -> RestHandler:
    """``TubeError`` becomes an error envelope in the handler; other exceptions go to the router."""

    @functools.wraps(fn)
    def wrapper(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
        try:
            return fn(body, query)
        except T.TubeError as exc:
            return error_envelope(exc)

    return wrapper


def _optional_body(body: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if body is None:
        return {}
    if not isinstance(body, Mapping):
        raise T.ValidationError("body must be a JSON object")
    return body


_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off", ""})


def parse_flag(value: Any, *, field: str, default: bool) -> bool:
    """Query boolean (``true|false|1|0``; missing = *default*); any other value → ``invalid``."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    raise T.ValidationError(f"{field}: expected true/false", field=field)


def parse_read_scope(body: Mapping[str, Any] | None) -> T.ReadScope:
    """``ReadScope`` body ``{kind: channel|folder|tab|all, id?}`` → validated ``ReadScope``
    (same rule as ``POST /ext/read``: unknown keys refused; ``id`` required for channel, folder
    and tab; ignored for ``all``)."""
    if not isinstance(body, Mapping):
        raise T.ValidationError("body must be a JSON object")
    unknown = sorted(str(k) for k in set(body) - {"kind", "id"})
    if unknown:
        raise T.ValidationError(f"unknown keys: {unknown}")
    if "kind" not in body:
        raise T.ValidationError("kind: required", field="kind")
    try:
        kind = T.ReadScopeKind(body["kind"])
    except (ValueError, TypeError) as exc:
        raise T.ValidationError(f"invalid kind: {body['kind']!r}", field="kind") from exc
    scope_id = body.get("id")
    if scope_id is not None and not isinstance(scope_id, str):
        raise T.ValidationError("id: expected a string", field="id")
    if kind is T.ReadScopeKind.all:
        return T.ReadScope(kind, None)
    if not scope_id:
        raise T.ValidationError(f"id required for kind={kind.value}", field="id")
    return T.ReadScope(kind, scope_id)


# =========================================================================== routes


@contract.real
@guard
def post_refresh(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /refresh.

    Refresh everything now (RSS): ``kick_if_due(force)`` and an immediate answer
    (``started|skipped|running``); the end of the cycle shows in ``GET /status.last_rss_at``.
    """
    data = _optional_body(body)
    force = data.get("force", True)
    if not isinstance(force, bool):
        raise T.ValidationError("force: expected true/false", field="force")
    refresher = wiring.get_refresher()
    flight = run_once(
        ("kick", profile_key(), force),
        functools.partial(refresher.kick_if_due, force),
        name="tube-refresh-kick",
    )
    if not flight.wait(REFRESH_WAIT_S):
        return ok({"result": "running"})  # kick waiting for the database: carries on alone
    if flight.error is not None:
        raise flight.error
    return ok({"result": str(flight.value)})


@contract.real
@guard
def post_refresh_channel(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /refresh/{channel_id}.

    Refresh one channel now: ``kick_channel`` in a thread (``started``; the same channel already
    in progress in this process → ``running``).
    """
    channel_id = str((query or {}).get("channel_id") or "")
    if not dedup.is_channel_id(channel_id):
        raise T.ValidationError(f"invalid channel id: {channel_id!r}", field="channel_id")
    if wiring.get_channels().get(channel_id) is None:
        raise T.NotFound(f"channel {channel_id} does not exist", channel_id=channel_id)
    result = wiring.get_refresher().kick_channel(channel_id)
    return ok({"result": str(result)})


@contract.real
@guard
def post_read(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /read.

    Mark as read (channel, recursive folder, tab or everything); ``changed`` = channels whose
    watermark moved. With ``?change_ids=true`` the answer also carries ``change_ids`` = entries
    recorded in the history (``actor=user``), so undo can use the exact id
    (``POST /changes/{id}/undo``); empty when nothing changed. Without the parameter, the answer
    is the old one (``{changed}``).
    """
    want_ids = parse_flag((query or {}).get("change_ids"), field="change_ids", default=False)
    scope = parse_read_scope(body)
    refresher = wiring.get_refresher()
    with_ids = getattr(refresher, "mark_read_changes", None)
    if callable(with_ids):
        changed, change_ids = with_ids(scope, actor=T.Actor.user)
    else:  # Refresher without mark_read_changes: no ids (undo falls back to the history)
        changed, change_ids = refresher.mark_read(scope, actor=T.Actor.user), ()
    data: dict[str, Any] = {"changed": int(changed)}
    if want_ids:
        data["change_ids"] = [int(i) for i in change_ids]
    return ok(data)


__all__ = [
    "REFRESH_WAIT_S",
    "WAIT_STEP_S",
    "Flight",
    "guard",
    "parse_flag",
    "parse_read_scope",
    "post_read",
    "post_refresh",
    "post_refresh_channel",
    "profile_key",
    "reset",
    "run_once",
]
