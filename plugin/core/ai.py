"""The plugin's ``LLM``: the tasks of ``core/prompts.py`` over an ``LLMBackend``.

What this module guarantees to its callers (organize, cleanup reasons, topic tabs, digests, list
import):

- **its own validation** of every output (``prompts.validate_output`` + ``check_output``): it
  does not depend on the optional ``jsonschema`` package that Hermes uses when present;
- **batches** (``prompts.batches``) concatenated in order (``prompts.merge_outputs``), with
  ``on_progress`` per batch; ``timeout`` covers the whole task;
- **one** retry per batch, with the validation errors handed back to the model **in the input**
  (never in the instructions: text that came from the model does not move up a channel);
- readable errors: ``LLMUnavailable`` (no model, detected before calling, or a configured
  provider that refused the sign-in; ``details["reason"]`` says which), ``LLMInvalidResponse``
  (wrong format twice), ``OperationTimeout``; input with the wrong structure →
  ``ValidationError`` (a bug in whoever built the *payload*).

**Model output is untrusted data.** Besides the schema (types, ``additionalProperties: false``,
sizes, ``pattern`` of the ids), ``check_output`` rejects: an id that was not in that batch's
input, a repeated id, text with a line break/control character, a chat directive, HTML markup,
special *tokens* or classic instruction-injection phrases, a folder path with ``..``/leading
slash/``\\``/empty segment, a URL whose scheme is not ``http(s)`` and a cleanup ``group`` that
contradicts the rule. Consumers still check against the database before writing (the model only
sees ids that came from the database, but the database may have changed in the meantime).
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Mapping
from typing import Any

from tube_pkg.core import prompts as P
from tube_pkg.core import types as T

logger = logging.getLogger(__name__)

MAX_PROBLEMS_SHOWN = 8
"""How many validation errors go back to the model on the retry."""
PROBLEM_CHARS = 200
"""Cut for each error (an error may quote the model's text)."""
NO_MODEL_MESSAGE = "No AI model is available. Pick one and sign in under Settings → Models."
"""Said when no model is configured (neither for the plugin's task nor the main one)."""
PROVIDER_UNAVAILABLE_MESSAGE = (
    "Hermes couldn't reach your AI model{route}. Sign in to it again, or pick another model for "
    "“YouTube curator” in Settings → Model → Auxiliary models."
)
"""Said when a model *is* configured but its provider refused the sign-in or is unavailable.
``{route}`` = `` (provider · model)`` or empty (``provider_unavailable_message``). The labels are
the Desktop's own (Settings → Model → Auxiliary models; the task row shows the plugin's display
name)."""
ROUTE_PART_CHARS = 80
"""Cut for the provider and the model in the message."""

_ID_KEYS: dict[T.AiTask, str] = {
    T.AiTask.organize: "channel_id",
    T.AiTask.cleanup_reasons: "channel_id",
    T.AiTask.theme_curate: "video_id",
    T.AiTask.digest: "video_id",
}
"""List tasks whose output item points to an input item by id."""

_CONTROL = re.compile(r"[\x00-\x1f\x7f\u2028\u2029]")
_DIRECTIVE = re.compile(r"(^|\s)::[A-Za-z][\w-]*\s*[{\[]")
_HTML = re.compile(r"<\s*/?\s*(script|iframe|object|embed|style|img|svg)\b|javascript:", re.I)
_SPECIAL_TOKENS = re.compile(r"<\|[^|]*\|>|\[/?INST\]|<<\s*/?SYS\s*>>", re.IGNORECASE)
_INJECTION = re.compile(
    # narrow on purpose: videos about AI mention "system prompt" and "instructions" all the time
    r"\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+|your\s+)?"
    r"(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|messages?)\b"
    r"|\b(ignor|esque[çc])\w*\s+(todas\s+)?(as\s+)?(suas\s+)?instru[çc][õo]es\s+"
    r"(anteriores|acima|pr[ée]vias)\b"
    r"|^\s*(system|assistant|developer)\s*:",
    re.IGNORECASE,
)
_SCHEME = re.compile(r"^\s*([A-Za-z][A-Za-z0-9+.-]*):")
_SAFE_SCHEMES = frozenset({"http", "https"})


def _route_part(value: Any) -> str:
    """Provider or model as the screen may show it: one line, cut, and a local file path reduced
    to its file name (a local model may be configured by path)."""
    if not isinstance(value, str):
        return ""
    text = _CONTROL.sub(" ", value).strip()
    if text.startswith(("/", "~", "\\")) or re.match(r"^[A-Za-z]:[\\/]", text):
        text = re.split(r"[\\/]", text.rstrip("/\\"))[-1]
    return text if len(text) <= ROUTE_PART_CHARS else text[: ROUTE_PART_CHARS - 1] + "…"


def provider_route(provider: str | None, model: str | None) -> str:
    """``provider · model`` as the screens show it (either may be missing; ``""`` = neither)."""
    return " · ".join(p for p in (_route_part(provider), _route_part(model)) if p)


def provider_unavailable_message(provider: str | None, model: str | None) -> str:
    """``PROVIDER_UNAVAILABLE_MESSAGE`` for this route (``provider_route``)."""
    route = provider_route(provider, model)
    return PROVIDER_UNAVAILABLE_MESSAGE.format(route=f" ({route})" if route else "")


def _short(text: Any) -> str:
    text = str(text)
    return text if len(text) <= PROBLEM_CHARS else text[: PROBLEM_CHARS - 1] + "…"


def _strings(value: Any, path: str = "$") -> list[tuple[str, str]]:
    """Every text in *value* with its path (``$.items[0].why``)."""
    if isinstance(value, str):
        return [(path, value)]
    out: list[tuple[str, str]] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            out.extend(_strings(item, f"{path}.{key}"))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            out.extend(_strings(item, f"{path}[{i}]"))
    return out


def _text_problems(path: str, text: str) -> list[str]:
    if _CONTROL.search(text):
        return [f"{path}: text with a line break or control character"]
    if _DIRECTIVE.search(text):
        return [f"{path}: chat directive not allowed ({_short(text)!r})"]
    if _HTML.search(text) or _SPECIAL_TOKENS.search(text):
        return [f"{path}: markup not allowed ({_short(text)!r})"]
    if _INJECTION.search(text):
        return [f"{path}: text with instructions for the system ({_short(text)!r})"]
    return []


def _folder_problems(path: str, folder: str) -> list[str]:
    bad = "\\" in folder or folder.startswith("/") or folder.endswith("/")
    bad = bad or any(part.strip() in ("", ".", "..") for part in folder.split("/"))
    return [f"{path}: invalid folder path {_short(folder)!r}"] if bad else []


def _url_problems(path: str, value: str) -> list[str]:
    match = _SCHEME.match(value)
    if match and match.group(1).lower() not in _SAFE_SCHEMES:
        # "youtube.com/@x" and "@x" have no scheme: they pass
        return [f"{path}: address with a scheme that is not allowed {_short(value)!r}"]
    return []


def _cleanup_group_problem(i: int, rule: Any, group: str) -> list[str]:
    if rule is not None and group != rule:
        return [f"$.items[{i}].group: must repeat the rule {rule!r}"]
    if rule is None and group not in ("off_profile", "keep"):
        return [f"$.items[{i}].group: no rule, use 'off_profile' or 'keep'"]
    return []


def check_output(task: T.AiTask | str, payload: Mapping[str, Any], data: Any) -> list[str]:
    """Errors in the model's output *data* for the batch *payload* (empty = accepted).

    The task's schema (``prompts.validate_output``) **and** the untrusted-data rules of the
    module docstring. Does not raise.
    """
    task = T.AiTask(task)
    problems = list(P.validate_output(task, data))
    if problems:
        return problems  # wrong shape: the rules below assume the right shape
    for path, text in _strings(data):
        problems.extend(_text_problems(path, text))
    items = data.get("items") if isinstance(data, Mapping) else None
    if not isinstance(items, list):
        return problems
    id_key = _ID_KEYS.get(task)
    if id_key:
        given = {
            it[id_key]: it
            for it in (payload.get("items") or [])
            if isinstance(it, Mapping) and isinstance(it.get(id_key), str)
        }
        seen: set[str] = set()
        for i, item in enumerate(items):
            ref = item[id_key]
            where = f"$.items[{i}].{id_key}"
            if ref not in given:
                problems.append(
                    f"{where}: {_short(ref)!r} is not in the input (copy the ids given)"
                )
                continue
            if ref in seen:
                problems.append(f"{where}: {ref!r} repeated")
            seen.add(ref)
            if task is T.AiTask.cleanup_reasons:
                problems.extend(
                    _cleanup_group_problem(i, given[ref].get("rule_group"), item["group"])
                )
    if task is T.AiTask.organize:
        for i, item in enumerate(items):
            problems.extend(_folder_problems(f"$.items[{i}].folder", item["folder"]))
            for j, tag in enumerate(item["tags"]):
                if "/" in tag or "\\" in tag:
                    problems.append(f"$.items[{i}].tags[{j}]: tag with a slash {_short(tag)!r}")
    if task is T.AiTask.list_extract:
        for i, item in enumerate(items):
            value = item.get("handle_or_url")
            if isinstance(value, str):
                problems.extend(_url_problems(f"$.items[{i}].handle_or_url", value))
    return problems


def _retry_note(problems: list[str]) -> str:
    shown = "\n".join(f"- {_short(p)}" for p in problems[:MAX_PROBLEMS_SHOWN])
    more = len(problems) - MAX_PROBLEMS_SHOWN
    if more > 0:
        shown += f"\n- (+{more} more)"
    return (
        "\n\n---\nYour previous answer was rejected by validation:\n"
        f"{shown}\n"
        "Answer again with JSON only, matching the schema exactly, copying ids from the input "
        "above and fixing every problem listed."
    )


class HermesLLM:
    """``T.LLM`` implementation over a ``T.LLMBackend`` (see the module docstring)."""

    def __init__(
        self, *, settings: T.Settings, llm_backend: T.LLMBackend, clock: T.Clock | None = None
    ) -> None:
        self.settings = settings
        self.backend = llm_backend
        self.clock = clock or T.SystemClock()

    # ------------------------------------------------------------------ state

    def available(self) -> bool:
        try:
            return bool(self.backend.available())
        except Exception:  # noqa: BLE001 — "no model" never raises
            logger.debug("LLMBackend.available failed", exc_info=True)
            return False

    def model_name(self) -> str | None:
        try:
            name = self.backend.model_name()
        except Exception:  # noqa: BLE001
            logger.debug("LLMBackend.model_name failed", exc_info=True)
            return None
        return str(name) if name else None

    def status(self) -> T.AiStatus:
        """``GET /ai/status``: from the configuration and the last call's outcome only, no
        network (see ``_backend_route`` and ``_backend_unreachable``)."""
        configured, model = _backend_route(self.backend)
        provider = _backend_provider(self.backend)
        unreachable = _backend_unreachable(self.backend)
        if unreachable is not None:
            # the provider refused the sign-in (or said "no provider") a moment ago: say so
            # before the next click, with the route that failed
            failed_provider, failed_model = unreachable
            return T.AiStatus(
                available=False,
                model=failed_model or model,
                reason=PROVIDER_UNAVAILABLE,
                provider=failed_provider or provider,
            )
        if self.available():
            return T.AiStatus(
                available=True, model=self.model_name(), reason=None, provider=provider
            )
        if configured is False:
            return T.AiStatus(available=False, model=None, reason=NO_MODEL)
        if configured is None and not _has_route_probe(self.backend):
            return T.AiStatus(available=False, model=None, reason=NO_MODEL)
        if getattr(self.backend, "ctx", None) is None:
            # a process with no ``ctx`` (the REST plugin host, scripts): AI runs in the gateway,
            # with this same configuration — there ``available()`` will say the same
            return T.AiStatus(available=True, model=model, reason=None, provider=provider)
        # gateway with a configuration, but this process's Hermes cannot call now (no ``ctx.llm``)
        return T.AiStatus(
            available=False, model=model, reason=PROVIDER_UNAVAILABLE, provider=provider
        )

    # ------------------------------------------------------------------ call

    def complete_structured(
        self,
        task: T.AiTask,
        payload: Mapping[str, Any],
        *,
        timeout: float = 60.0,
        on_progress: T.ProgressFn | None = None,
    ) -> Any:
        task = T.AiTask(task)
        sp = P.spec(task)
        payload = self._with_language(payload)
        errors = P.validate_input(task, payload)
        if errors:
            raise T.ValidationError(
                f"invalid {task.value} input: {'; '.join(errors[:3])}", errors=errors
            )
        if not self.available():
            raise T.LLMUnavailable(NO_MODEL_MESSAGE, reason=NO_MODEL)
        deadline = time.monotonic() + max(0.0, float(timeout))
        parts = P.batches(task, payload)
        outputs: list[Any] = []
        for index, part in enumerate(parts, start=1):
            outputs.append(self._one_batch(task, sp, part, deadline, index, len(parts)))
            if on_progress is not None:
                on_progress(
                    T.Progress(stage="llm", done=index, total=len(parts), message=task.value)
                )
        return P.merge_outputs(task, outputs)

    def _with_language(self, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        """The model answers in the language resolved by the single rule (``core/lang``): the
        caller may send ``language``; otherwise the explicit setting, the profile's Hermes
        language or English applies."""
        if not isinstance(payload, Mapping) or payload.get("language"):
            return payload
        from tube_pkg.core import lang

        return {**payload, "language": lang.resolve(self.settings)}

    @staticmethod
    def _remaining(deadline: float, task: T.AiTask) -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise T.OperationTimeout(f"The AI took too long on task {task.value}.")
        return remaining

    def _one_batch(
        self,
        task: T.AiTask,
        sp: P.TaskSpec,
        part: Mapping[str, Any],
        deadline: float,
        index: int,
        total: int,
    ) -> Any:
        text = P.render_input(task, part)
        input_text = text
        problems: list[str] = []
        for attempt in (1, 2):
            remaining = self._remaining(deadline, task)
            try:
                raw = self.backend.complete_structured(
                    instructions=sp.instructions,
                    input_text=input_text,
                    json_schema=sp.output_schema,
                    schema_name=sp.schema_name,
                    timeout=remaining,
                )
            except T.LLMInvalidResponse as exc:
                problems = [f"$: {exc.message}"]
            except T.LLMUnavailable as exc:
                # The backend already says which case it is (``details["reason"]``: no model, or
                # a configured provider that refused the sign-in), and other failures (provider
                # error, refused route) keep their own message. Only a backend that went
                # unavailable without saying why reads as "no model".
                if exc.details.get("reason") or self.available():
                    raise
                detail = exc.details.get("detail") or exc.message
                raise T.LLMUnavailable(NO_MODEL_MESSAGE, reason=NO_MODEL, detail=detail) from exc
            else:
                problems = check_output(task, part, raw)
                if not problems:
                    return raw
            logger.info(
                "AI: %s answer in the wrong format (batch %d/%d, attempt %d): %s",
                task.value,
                index,
                total,
                attempt,
                problems[:3],
            )
            input_text = text + _retry_note(problems)
        lot = f" (batch {index} of {total})" if total > 1 else ""
        shown = "; ".join(_short(p) for p in problems[:3])
        raise T.LLMInvalidResponse(
            f"The AI answered in the wrong format twice on task {task.value}{lot}: {shown}",
            task=task.value,
            errors=[_short(p) for p in problems[:50]],
        )


NO_MODEL = T.AI_STATUS_REASONS[0]
PROVIDER_UNAVAILABLE = T.AI_STATUS_REASONS[1]


def _has_route_probe(backend: Any) -> bool:
    return callable(getattr(backend, "_route", None))


def _backend_provider(backend: Any) -> str | None:
    """Provider of the configured route from the adapter (``provider_name()``, config only).
    ``None`` = unknown. Never raises."""
    probe = getattr(backend, "provider_name", None)
    if not callable(probe):
        return None
    try:
        name = probe()
    except Exception:  # noqa: BLE001 — probe
        logger.debug("LLMBackend provider probe failed", exc_info=True)
        return None
    return name.strip() if isinstance(name, str) and name.strip() else None


def _backend_unreachable(backend: Any) -> tuple[str | None, str | None] | None:
    """``(provider, model)`` when the adapter remembers that the configured provider refused the
    sign-in (or said "no provider") less than its TTL ago (``unreachable()``); otherwise ``None``.
    Never raises."""
    probe = getattr(backend, "unreachable", None)
    if not callable(probe):
        return None
    try:
        out = probe()
    except Exception:  # noqa: BLE001 — probe
        logger.debug("LLMBackend unreachable probe failed", exc_info=True)
        return None
    if not isinstance(out, tuple) or len(out) != 2:
        return None
    provider, model = (v if isinstance(v, str) and v.strip() else None for v in out)
    return provider, model


def _backend_route(backend: Any) -> tuple[bool | None, str | None]:
    """(is a route configured?, model) from the Hermes adapter's configuration probe
    (``HermesLLMBackend._route``: reads the profile's ``config.yaml``, no network). ``None`` =
    cannot tell (backend with no probe, unreadable config). Never raises.

    The adapter could make this probe public (``route()``)."""
    probe = getattr(backend, "_route", None)
    if not callable(probe):
        return None, None
    try:
        configured, model = probe()
    except Exception:  # noqa: BLE001 — probe; "cannot tell" is a valid answer
        logger.debug("LLMBackend configuration probe failed", exc_info=True)
        return None, None
    model = str(model) if isinstance(model, str) and model.strip() else None
    return (None if configured is None else bool(configured)), model


def status_of(llm: Any) -> T.AiStatus:
    """``AiStatus`` of any ``T.LLM``: ``status()`` when it exists (``HermesLLM``), otherwise
    ``available()``/``model_name()`` (fakes, other ``LLM`` implementations). Never raises."""
    probe = getattr(llm, "status", None)
    if callable(probe):
        try:
            out = probe()
        except Exception:  # noqa: BLE001
            logger.debug("LLM.status failed", exc_info=True)
        else:
            if isinstance(out, T.AiStatus):
                return out
    try:
        available = bool(llm.available())
    except Exception:  # noqa: BLE001
        available = False
    if not available:
        return T.AiStatus(available=False, model=None, reason=NO_MODEL)
    try:
        name = llm.model_name()
    except Exception:  # noqa: BLE001
        name = None
    return T.AiStatus(available=True, model=str(name) if name else None, reason=None)


def build(
    *, settings: T.Settings, llm_backend: T.LLMBackend, clock: T.Clock | None = None
) -> T.LLM:
    """``LLM`` over *llm_backend* (no network or thread here)."""
    return HermesLLM(settings=settings, llm_backend=llm_backend, clock=clock)


__all__ = [
    "NO_MODEL",
    "NO_MODEL_MESSAGE",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_UNAVAILABLE_MESSAGE",
    "HermesLLM",
    "build",
    "check_output",
    "provider_route",
    "provider_unavailable_message",
    "status_of",
]
