"""Data REST routes: demo, MyTube import, JSON export/import.

Thin shell over ``wiring.get_data()`` (``DataOps``). No network: the demo comes from the committed
JSON and the body's ``path`` is a file **on the backend** (picked in the Desktop).

Expected errors (``invalid``/``not_found``) and a dependency still stubbed (``NotImplementedError``
→ ``internal``) become envelopes right here — the route never raises.

``path`` is untrusted input from the route's caller: only ``.json`` regular files up to
``MAX_IMPORT_BYTES`` are read, and errors name the file without echoing its content or full path.
"""

from __future__ import annotations

import functools
import json
import logging
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, error_envelope, ok
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

MAX_IMPORT_BYTES = 50 * 1024 * 1024
"""Cap of the file read through ``path`` (a large MyTube backup is a few MB)."""

RestFn = Callable[[Mapping[str, Any] | None, Mapping[str, str]], Envelope]


def _enveloped(fn: RestFn) -> RestFn:
    """Domain error or stubbed dependency → error envelope (never raises)."""

    @functools.wraps(fn)
    def wrapper(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
        try:
            return fn(body, query)
        except (T.TubeError, NotImplementedError) as exc:
            return error_envelope(exc)

    return wrapper


def _import_payload(body: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """``ImportBody``: exactly one of ``data`` (object) or ``path`` (JSON file on the backend)."""
    if not isinstance(body, Mapping) or len(body) != 1 or not ({"data", "path"} & set(body)):
        raise T.ValidationError("send exactly one of: data or path", field="body")
    if "data" in body:
        data = body["data"]
        if not isinstance(data, Mapping):
            raise T.ValidationError("data: expected an object", field="data")
        return data
    raw_path = body["path"]
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise T.ValidationError("path: expected a file path", field="path")
    path = Path(raw_path.strip()).expanduser()
    if path.suffix.lower() != ".json":
        # the route reads a file on the backend's disk: only JSON backups, never an arbitrary file
        raise T.ValidationError("path: only .json backup files can be imported", field="path")
    if not path.is_file():
        raise T.NotFound(f"file not found: {path.name}")
    if path.stat().st_size > MAX_IMPORT_BYTES:
        raise T.ValidationError("file too large to import", field="path")
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise T.ValidationError(f"could not read the JSON in {path.name}", field="path") from exc
    if not isinstance(data, Mapping):
        raise T.ValidationError("the file does not hold a JSON object", field="path")
    return data


def _kick_refresh() -> None:
    """Channels just arrived in bulk: fetch their videos now (non-blocking; if a cycle is running,
    the next ``kick_if_due`` picks up the new ones — ``COLD_RETRY_S``). Never breaks the route."""
    try:
        wiring.get_refresher().kick_if_due(force=True)
    except Exception:  # noqa: BLE001
        log.warning("kick_if_due after a bulk load failed", exc_info=True)


@contract.real
@_enveloped
def get_demo(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /demo — is the demo mode loaded?"""
    return ok({"loaded": bool(wiring.get_data().demo_loaded())})


@contract.real
@_enveloped
def post_demo_load(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /demo/load — ~40 public channels, 6 folders, ⭐ and a theme tab (idempotent)."""
    ui_locale = (body or {}).get("ui_locale")
    out = wiring.get_data().load_demo(ui_locale=ui_locale if isinstance(ui_locale, str) else None)
    _kick_refresh()
    return ok(out)


@contract.real
@_enveloped
def post_demo_clear(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /demo/clear — removes only what belongs to the demo."""
    return ok(wiring.get_data().clear_demo())


@contract.real
@_enveloped
def post_import_mytube(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /import/mytube ``{data}`` or ``{path}`` — MyTube backup."""
    out = wiring.get_data().import_mytube(_import_payload(body))
    _kick_refresh()
    return ok(out)


@contract.real
@_enveloped
def get_export(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /export — JSON without queue, jobs, searches or devices."""
    return ok(wiring.get_data().export_json())


@contract.real
@_enveloped
def post_import(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /import ``{data}`` or ``{path}`` — merges with dedup; never creates a queue item."""
    return ok(wiring.get_data().import_json(_import_payload(body)))
