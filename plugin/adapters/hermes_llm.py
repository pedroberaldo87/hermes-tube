"""Bridge to Hermes: ``LLMBackend`` over ``ctx.llm`` and ``EventSink`` over
``broadcast_plugin_event``/``ctx.emit_to_session``.

``LLMBackend`` (``build(ctx=...)``) makes **one** raw call: no batches, no retry and no schema
validation (that belongs to ``core/ai.py``). What it takes care of:

- route: ``ctx.llm.complete_structured(task=CURATOR_TASK, ...)`` — the auxiliary task that
  ``register(ctx)`` registers; it shows up in Settings → Models;
- "no model" without network: ``available()`` reads the profile configuration
  (``auxiliary.<task>`` and ``model``); without ``ctx`` (plugin host, scripts) it is always
  ``False``;
- "configured but unreachable": an auth refusal or a "no provider" from the host while a route is
  configured becomes ``LLMUnavailable`` with ``details = {reason: provider_unavailable, provider,
  model}`` and is remembered for ``UNAVAILABLE_TTL_S`` (``unreachable()``, read by
  ``GET /ai/status``). It does **not** block the next call: "Try again" after signing in works at
  once. The provider's own text (paths, account hints) only goes to the log, redacted;
- the input goes through ``agent.redact.redact_sensitive_text(force=True)`` before leaving the
  machine;
- answer: ``result.parsed``; if the host did not parse it, the text is parsed here (fenced block
  or whole JSON); prose → ``LLMInvalidResponse``;
- host errors become the contract ones: unreachable (above) / denied / provider failure →
  ``LLMUnavailable``,
  any ``*Timeout*`` → ``OperationTimeout``, ``ValueError`` (schema/JSON) →
  ``LLMInvalidResponse``.

``EventSink`` (``build_events(ctx=...)``) never raises; in the plugin host the global event is
dropped by Hermes itself — no flow depends on it. In a process without a gateway (routine
scripts, tests) the event is dropped **without** importing the gateway, which would replace
``sys.stdout``.

Nothing here touches the network or starts a thread in ``build``.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import types as T
from tube_pkg.core.ai import (
    NO_MODEL,
    NO_MODEL_MESSAGE,
    PROVIDER_UNAVAILABLE,
    provider_unavailable_message,
)
from tube_pkg.wiring import CURATOR_TASK

logger = logging.getLogger(__name__)

UNAVAILABLE_TTL_S = 60.0
"""After the provider refused the sign-in (or the host said "no provider"), ``unreachable()``
reports it for this long."""
ERROR_CHARS = 300

_FENCE = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL | re.IGNORECASE)
_NO_PROVIDER = ("no llm provider", "hermes setup", "no provider")
_AUTH_CLASSES = frozenset(
    {
        "AuthError",  # hermes_cli.auth_constants (and its subclasses)
        "AuthenticationError",  # OpenAI / Anthropic SDKs (401)
        "ProviderNotConfiguredError",  # agent.auxiliary_unavailable
        "ClaudeCodeLoggedOut",  # Claude subscription provider: no usable login
        "ClaudeCodeMissing",  # Claude subscription provider: CLI not installed
    }
)
"""Host/provider exception classes that mean "this provider cannot be used until the person signs
in again (or picks another model)". Matched by name: the plugin does not import them."""
_AUTH_TEXT = (
    "no usable login",
    "not logged in",
    "not logged into",
    "invalid api key",
    "invalid x-api-key",
    "authentication_error",
    "authentication failed",
)
"""The same, recognised by text when the host wraps the error in a plain exception."""

ConfigReader = Callable[[], Mapping[str, Any] | None]


def _read_config() -> Mapping[str, Any] | None:
    """``config.yaml`` of the active profile (Hermes contextvar), read-only; ``None`` = unknown."""
    try:
        from hermes_cli.config import load_config_readonly
    except ImportError:
        return None
    try:
        cfg = load_config_readonly()
    except Exception:  # noqa: BLE001
        logger.debug("load_config_readonly failed", exc_info=True)
        return None
    return cfg if isinstance(cfg, Mapping) else None


def _redact(text: str) -> str:
    try:
        from agent.redact import redact_sensitive_text
    except ImportError:
        return text
    try:
        return redact_sensitive_text(text, force=True)
    except Exception:  # noqa: BLE001
        logger.debug("redact failed", exc_info=True)
        return text


def _clean_text(value: Any) -> str:
    return str(value).strip() if isinstance(value, str) else ""


def _parse_json_text(text: str) -> Any:
    """JSON from a text answer: the first fenced block, else the whole text, else the slice
    between the first ``{`` and the last ``}``. Failure → ``LLMInvalidResponse``."""
    candidates: list[str] = []
    match = _FENCE.search(text)
    if match:
        candidates.append(match.group(1).strip())
    candidates.append(text.strip())
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    raise T.LLMInvalidResponse("The AI did not answer in JSON.")


def _class_names(exc: BaseException) -> list[str]:
    return [cls.__name__ for cls in type(exc).__mro__]


def _is_auth_error(exc: BaseException, names: list[str]) -> bool:
    if any(name in _AUTH_CLASSES for name in names):
        return True
    if getattr(exc, "status_code", None) == 401:
        return True
    lowered = str(exc).lower()
    return any(s in lowered for s in _AUTH_TEXT)


def _short_error(exc: BaseException) -> str:
    text = _redact(f"{type(exc).__name__}: {exc}".strip())
    return text if len(text) <= ERROR_CHARS else text[: ERROR_CHARS - 1] + "…"


class HermesLLMBackend:
    """``T.LLMBackend`` over ``ctx.llm`` (see the module docstring).

    *task* = auxiliary task (``None`` = main model, used only in the ``live`` test);
    ``config_reader`` can be swapped in tests.
    """

    def __init__(
        self,
        ctx: Any,
        *,
        task: str | None = CURATOR_TASK,
        config_reader: ConfigReader | None = None,
    ) -> None:
        self.ctx = ctx
        self.task = task
        self.config_reader: ConfigReader = config_reader or _read_config
        self._lock = threading.Lock()
        self._unreachable: tuple[float, str | None, str | None] | None = None
        """(until, provider, model) of the last refusal (see ``unreachable``)."""
        self._answered: tuple[str | None, str] | None = None
        """(model configured at the time, model that answered) of the last good call."""

    # ------------------------------------------------------------------ state

    def _llm(self) -> Any:
        if self.ctx is None:
            return None
        try:
            return getattr(self.ctx, "llm", None)
        except Exception:  # noqa: BLE001 — ctx without llm in this Hermes version
            logger.debug("ctx.llm unavailable", exc_info=True)
            return None

    def _route(self) -> tuple[bool | None, str | None]:
        """(is a route configured?, configured model). ``None`` = cannot tell."""
        configured, _provider, model = self._route_details()
        return configured, model

    def provider_name(self) -> str | None:
        """Provider of the configured route (the task's pinned one, else the main one; ``auto``
        = ``None``). Configuration only, no network."""
        return self._route_details()[1]

    def _route_details(self) -> tuple[bool | None, str | None, str | None]:
        """(is a route configured?, provider, model). ``None`` = cannot tell / unknown."""
        cfg = self.config_reader()
        if cfg is None:
            return None, None, None
        aux_cfg: Any = {}
        aux = cfg.get("auxiliary")
        if self.task and isinstance(aux, Mapping):
            aux_cfg = aux.get(self.task) or {}
        aux_provider = _clean_text(aux_cfg.get("provider")) if isinstance(aux_cfg, Mapping) else ""
        aux_model = _clean_text(aux_cfg.get("model")) if isinstance(aux_cfg, Mapping) else ""
        if aux_model.lower() == "auto":
            aux_model = ""
        main = cfg.get("model")
        main_model = main_provider = ""
        if isinstance(main, str):
            main_model = main.strip()
        elif isinstance(main, Mapping):
            main_model = _clean_text(main.get("default")) or _clean_text(main.get("model"))
            main_provider = _clean_text(main.get("provider"))
        pinned = bool(aux_provider and aux_provider.lower() != "auto")
        configured = pinned or bool(aux_model or main_model or main_provider)
        provider = aux_provider if pinned else main_provider
        if provider.lower() == "auto":
            provider = ""
        return configured, (provider or None), (aux_model or main_model or None)

    def available(self) -> bool:
        if self._llm() is None:
            return False
        configured, _model = self._route()
        return True if configured is None else configured

    def unreachable(self) -> tuple[str | None, str | None] | None:
        """``(provider, model)`` if the configured provider refused the sign-in (or the host said
        "no provider") less than ``UNAVAILABLE_TTL_S`` ago; otherwise ``None``. No network."""
        with self._lock:
            mark = self._unreachable
            if mark is None:
                return None
            if time.monotonic() >= mark[0]:
                self._unreachable = None
                return None
            return mark[1], mark[2]

    def model_name(self) -> str | None:
        if not self.available():
            return None
        _configured, model = self._route()
        with self._lock:
            answered = self._answered
        if answered is not None and answered[0] == model:
            return answered[1]
        return model

    def _mark_unavailable(self, provider: str | None, model: str | None) -> None:
        with self._lock:
            self._unreachable = (time.monotonic() + UNAVAILABLE_TTL_S, provider, model)

    def _clear_unavailable(self) -> None:
        with self._lock:
            self._unreachable = None

    # ------------------------------------------------------------------ call

    def complete_structured(
        self,
        *,
        instructions: str,
        input_text: str,
        json_schema: Mapping[str, Any],
        schema_name: str,
        timeout: float,
    ) -> Any:
        llm = self._llm()
        if llm is None:
            raise T.LLMUnavailable(
                "The AI only runs in the Hermes process that loaded the plugin (Desktop, chat or "
                "/tube); this process has no access to the model."
            )
        try:
            result = llm.complete_structured(
                instructions=instructions,
                input=[{"type": "text", "text": _redact(input_text)}],
                json_schema=dict(json_schema),
                schema_name=schema_name,
                task=self.task,
                timeout=timeout,
                purpose=f"{PLUGIN_ID}.{schema_name}",
            )
        except T.TubeError:
            raise
        except Exception as exc:  # noqa: BLE001 — translated into the contract errors
            raise self._translate(exc) from exc
        self._clear_unavailable()  # the provider answered: no longer unreachable
        parsed = getattr(result, "parsed", None)
        if parsed is None:
            text = getattr(result, "text", None)
            if not isinstance(text, str) or not text.strip():
                raise T.LLMInvalidResponse("The AI returned an empty answer.")
            parsed = _parse_json_text(text)
        model = getattr(result, "model", None)
        if isinstance(model, str) and model:
            _configured, route_model = self._route()
            with self._lock:
                self._answered = (route_model, model)
        return parsed

    def _translate(self, exc: Exception) -> T.TubeError:
        names = _class_names(exc)
        detail = _short_error(exc)
        lowered = str(exc).lower()
        no_provider = "AuxiliaryClientUnavailable" in names or (
            isinstance(exc, RuntimeError) and any(s in lowered for s in _NO_PROVIDER)
        )
        if no_provider or _is_auth_error(exc, names):
            configured, provider, model = self._route_details()
            if no_provider and not configured:
                # nothing (readable) configured: the host's "no provider" is the plain "no model"
                return T.LLMUnavailable(NO_MODEL_MESSAGE, reason=NO_MODEL)
            provider = provider or _clean_text(getattr(exc, "provider", None)) or None
            self._mark_unavailable(provider, model)
            # the provider's text (CLI paths, account hints, stderr) stays in the log, redacted
            logger.warning(
                "%s: AI provider %s (model %s) is unreachable: %s",
                PLUGIN_ID,
                provider or "auto",
                model or "default",
                detail,
            )
            return T.LLMUnavailable(
                provider_unavailable_message(provider, model),
                reason=PROVIDER_UNAVAILABLE,
                provider=provider,
                model=model,
            )
        if "PluginLlmTrustError" in names:
            return T.LLMUnavailable(
                "Hermes refused the plugin's AI route (auxiliary task not registered?).",
                detail=detail,
            )
        if isinstance(exc, TimeoutError) or any("Timeout" in name for name in names):
            return T.OperationTimeout("The AI model took too long to answer.", detail=detail)
        if isinstance(exc, ValueError):
            return T.LLMInvalidResponse(f"The AI answered in the wrong format: {detail}")
        return T.LLMUnavailable(f"The AI provider failed: {detail}", detail=detail)


def build(*, ctx: Any) -> T.LLMBackend:
    """``LLMBackend`` over ``ctx.llm`` (``ctx=None`` → always unavailable)."""
    return HermesLLMBackend(ctx)


_GATEWAY_MODULE = "tui_gateway.server"
"""Module that ``broadcast_plugin_event`` imports to deliver; only loaded where there is a gateway
(the ``register(ctx)`` process and the plugin host)."""


def _is_hermes_broadcast(fn: Any) -> bool:
    """``True`` if *fn* is the Hermes function (not a test fake swapped in by monkeypatch)."""
    return getattr(fn, "__module__", "") == "hermes_cli.plugin_events"


class HermesEventSink:
    """``T.EventSink``: global through ``hermes_cli.plugin_events.broadcast_plugin_event`` (looked
    up on every call) and per session through ``ctx.emit_to_session``. Never raises."""

    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx

    @staticmethod
    def _payload(payload: Mapping[str, Any] | None) -> dict[str, Any]:
        data = T.to_jsonable(dict(payload or {}))
        return json.loads(json.dumps(data, default=str, allow_nan=False))

    def broadcast(self, event: str, payload: Mapping[str, Any] | None = None) -> None:
        try:
            import hermes_cli.plugin_events as plugin_events

            send = plugin_events.broadcast_plugin_event
            if _GATEWAY_MODULE not in sys.modules and _is_hermes_broadcast(send):
                # no gateway in this process (routine scripts, tests): nobody to receive it, and
                # importing the gateway replaces ``sys.stdout`` (breaks "empty stdout = silence")
                logger.debug("event %s dropped: no gateway in this process", event)
                return
            send(PLUGIN_ID, event, self._payload(payload))
        except Exception:  # noqa: BLE001 — events speed things up, polling guarantees
            logger.debug("event %s dropped", event, exc_info=True)

    def emit_to_session(
        self, session_id: str, event: str, payload: Mapping[str, Any] | None = None
    ) -> bool:
        emit = getattr(self.ctx, "emit_to_session", None) if self.ctx is not None else None
        if not session_id or not callable(emit):
            return False
        try:
            return bool(emit(session_id, event, self._payload(payload)))
        except Exception:  # noqa: BLE001
            logger.debug("session event %s dropped", event, exc_info=True)
            return False


def build_events(*, ctx: Any) -> T.EventSink:
    """The process ``EventSink`` (``ctx=None`` → global only, which the host drops)."""
    return HermesEventSink(ctx)


__all__ = [
    "UNAVAILABLE_TTL_S",
    "HermesEventSink",
    "HermesLLMBackend",
    "build",
    "build_events",
]
