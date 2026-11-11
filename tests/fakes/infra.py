"""Infrastructure fakes: clock, settings, HTTP, events, AI, jobs, lens, devices.

All in memory and deterministic; they record calls for the tests to check.
"""

from __future__ import annotations

import copy
import hashlib
import itertools
import json
from collections import defaultdict, deque
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

from tube_pkg.core import prompts as P
from tube_pkg.core import types as T

DEFAULT_NOW = 1_794_225_600
"""2026-11-09 12:00:00 UTC — the fakes' default "now"."""


# --------------------------------------------------------------------------- Clock


class FakeClock:
    """Controllable ``Clock``: ``advance(s)``, ``set(ts)``."""

    def __init__(self, now: int = DEFAULT_NOW) -> None:
        self._now = int(now)

    def now(self) -> T.Timestamp:
        return self._now

    def advance(self, seconds: float) -> int:
        self._now += int(seconds)
        return self._now

    def set(self, ts: int) -> None:
        self._now = int(ts)


# --------------------------------------------------------------------------- Settings


class FakeSettings:
    """In-memory ``Settings`` built from ``SETTINGS_DEFAULTS`` (+ kwargs)."""

    def __init__(self, **overrides: Any) -> None:
        self.values: dict[str, Any] = dict(T.SETTINGS_DEFAULTS)
        for key, value in overrides.items():
            self.set(key, value)
        self.writes: list[tuple[str, Any]] = []

    def get(self, key: str, default: Any = None) -> Any:
        if key in self.values:
            return self.values[key]
        return default

    def snapshot(self) -> T.SettingsSnapshot:
        return T.SettingsSnapshot(**self.values)

    def set(self, key: str, value: Any) -> None:
        if key not in T.SETTINGS_DEFAULTS:
            raise T.ValidationError(f"chave desconhecida: {key}", field=key)
        expected = type(T.SETTINGS_DEFAULTS[key])
        ok = isinstance(value, expected) and (expected is bool or not isinstance(value, bool))
        if not ok:
            raise T.ValidationError(f"{key}: esperava {expected.__name__}", field=key)
        self.values[key] = value
        if hasattr(self, "writes"):
            self.writes.append((key, value))


# --------------------------------------------------------------------------- HttpClient

Route = T.HttpResponse | bytes | str | BaseException | Callable[..., Any]


class FakeHttp:
    """``HttpClient`` driven by a route table ``url → response``.

    Response: ``HttpResponse``, ``bytes``/``str`` (status 200), an exception (raised) or a
    ``(url, params) -> any of those`` function. URL not in the table → 404.
    """

    def __init__(self, routes: Mapping[str, Route] | None = None) -> None:
        self.routes: dict[str, Route] = dict(routes or {})
        self.requests: list[tuple[str, dict[str, str] | None]] = []

    def _resolve(self, url: str, params: Mapping[str, str] | None) -> T.HttpResponse:
        route = self.routes.get(url)
        if callable(route) and not isinstance(route, T.HttpResponse | BaseException):
            route = route(url, params)
        if route is None:
            return T.HttpResponse(status=404, url=url)
        if isinstance(route, BaseException):
            raise route
        if isinstance(route, T.HttpResponse):
            return route
        content = route.encode("utf-8") if isinstance(route, str) else bytes(route)
        return T.HttpResponse(status=200, url=url, content=content)

    def get(
        self,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
        timeout: float = 10.0,
        follow_redirects: bool = True,
    ) -> T.HttpResponse:
        self.requests.append((url, dict(params) if params else None))
        return self._resolve(url, params)

    def download_to(self, url: str, dest: str, *, timeout: float = 120.0) -> int:
        self.requests.append((url, None))
        resp = self._resolve(url, None)
        if resp.status >= 400:
            raise T.HttpError(f"HTTP {resp.status} em {url}")
        Path(dest).write_bytes(resp.content)
        return len(resp.content)


# --------------------------------------------------------------------------- EventSink


class FakeEventSink:
    """``EventSink`` that records ``events`` (global) and ``session_events``."""

    def __init__(self, *, session_delivery: bool = True) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.session_events: list[tuple[str, str, dict[str, Any]]] = []
        self.session_delivery = session_delivery

    def broadcast(self, event: str, payload: Mapping[str, Any] | None = None) -> None:
        self.events.append((event, dict(payload or {})))

    def emit_to_session(
        self, session_id: str, event: str, payload: Mapping[str, Any] | None = None
    ) -> bool:
        self.session_events.append((session_id, event, dict(payload or {})))
        return self.session_delivery

    def names(self) -> list[str]:
        return [name for name, _ in self.events]


# --------------------------------------------------------------------------- AI

Scripted = Any  # dict | callable(payload) -> dict | BaseException


class FakeLLMBackend:
    """Scripted ``LLMBackend``: raw responses (unvalidated) in a queue."""

    def __init__(self, *, available: bool = True, model: str | None = "fake-model") -> None:
        self._available = available
        self.model = model
        self.queue: deque[Scripted] = deque()
        self.calls: list[dict[str, Any]] = []

    def script(self, *responses: Scripted) -> FakeLLMBackend:
        self.queue.extend(responses)
        return self

    def available(self) -> bool:
        return self._available

    def model_name(self) -> str | None:
        return self.model if self._available else None

    def complete_structured(
        self,
        *,
        instructions: str,
        input_text: str,
        json_schema: Mapping[str, Any],
        schema_name: str,
        timeout: float,
    ) -> Any:
        self.calls.append(
            {
                "instructions": instructions,
                "input_text": input_text,
                "json_schema": json_schema,
                "schema_name": schema_name,
                "timeout": timeout,
            }
        )
        if not self._available:
            raise T.LLMUnavailable("sem modelo para a tarefa curator")
        if not self.queue:
            raise AssertionError(f"FakeLLMBackend: no scripted response ({schema_name})")
        resp = self.queue.popleft()
        if isinstance(resp, BaseException):
            raise resp
        if callable(resp):
            resp = resp(input_text)
        return copy.deepcopy(resp)


def default_response(task: T.AiTask, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Plausible, deterministic, schema-valid output derived from the *payload*."""
    task = T.AiTask(task)
    items = list(payload.get("items") or [])
    if task is T.AiTask.organize:
        folders = list(payload.get("folders") or [])
        folder = folders[0] if folders else "Geral"
        return {
            "items": [
                {
                    "channel_id": it["channel_id"],
                    "folder": folder,
                    "new_folder": not folders,
                    "tags": [],
                    "confidence": 0.5,
                    "why": f"Sugestão automática para {it.get('title', '')}"[:200],
                }
                for it in items
            ]
        }
    if task is T.AiTask.cleanup_reasons:
        return {
            "items": [
                {
                    "channel_id": it["channel_id"],
                    "group": it.get("rule_group") or "keep",
                    "why": "Motivo automático do falso.",
                }
                for it in items
            ]
        }
    if task is T.AiTask.theme_expand:
        query = str(payload.get("query", "tema"))[:60] or "tema"
        return {
            "name": query[:40],
            "icon": "🔎",
            "searches": [
                f"{query} {suffix}"[:100]
                for suffix in ("", "tutorial", "explicado", "2026", "guia")
            ],
            "include_terms": [query.split()[0][:40]] if query.split() else [],
            "exclude_terms": [],
            "mode": "fresh",
        }
    if task is T.AiTask.theme_curate:
        return {
            "items": [
                {
                    "video_id": it["video_id"],
                    "keep": True,
                    "score": round(1.0 - i / (len(items) + 1), 4),
                    "why": "Mantido pelo falso.",
                }
                for i, it in enumerate(items)
            ]
        }
    if task is T.AiTask.list_extract:
        text = str(payload.get("text", ""))
        out = []
        seen: set[str] = set()
        for word in text.split():
            handle = word.strip(".,;:()!?")
            if handle.startswith("@") and len(handle) > 1 and handle.casefold() not in seen:
                seen.add(handle.casefold())
                out.append({"name": handle.lstrip("@"), "handle_or_url": handle, "note": None})
        return {"title": payload.get("title"), "items": out}
    if task is T.AiTask.digest:
        return {
            "items": [
                {"video_id": it["video_id"], "summary": f"Resumo de: {it['title']}"[:400]}
                for it in items
            ]
        }
    raise AssertionError(task)  # pragma: no cover


class FakeLLM:
    """``LLM`` scripted per task, with input and output validated by the schemas in
    ``core/prompts.py``.

    - ``script(task, *responses)``: queues responses (``dict``, a ``payload -> dict`` function or
      an exception to raise);
    - ``auto=True``: with no script, answers with ``default_response`` (schema-valid);
    - output outside the schema → ``LLMInvalidResponse`` ("refusal");
    - input outside the schema → ``ValidationError`` (a bug in whoever built the *payload*);
    - ``available=False`` → ``LLMUnavailable``.
    """

    def __init__(
        self,
        *,
        available: bool = True,
        model: str | None = "fake-model",
        auto: bool = False,
        strict_input: bool = True,
    ) -> None:
        self._available = available
        self.model = model
        self.auto = auto
        self.strict_input = strict_input
        self.queues: dict[T.AiTask, deque[Scripted]] = defaultdict(deque)
        self.calls: list[tuple[T.AiTask, Mapping[str, Any]]] = []

    def script(self, task: T.AiTask | str, *responses: Scripted) -> FakeLLM:
        self.queues[T.AiTask(task)].extend(responses)
        return self

    def set_available(self, value: bool) -> None:
        self._available = value

    def available(self) -> bool:
        return self._available

    def model_name(self) -> str | None:
        return self.model if self._available else None

    def complete_structured(
        self,
        task: T.AiTask,
        payload: Mapping[str, Any],
        *,
        timeout: float = 60.0,
        on_progress: T.ProgressFn | None = None,
    ) -> Any:
        task = T.AiTask(task)
        if not self._available:
            raise T.LLMUnavailable("sem modelo configurado para a tarefa curator")
        errors = P.validate_input(task, payload)
        if errors and self.strict_input:
            raise T.ValidationError(f"invalid {task} payload: {errors[:3]}", errors=errors)
        self.calls.append((task, payload))
        queue = self.queues[task]
        if queue:
            resp = queue.popleft()
        elif self.auto:
            resp = default_response(task, payload)
        else:
            raise AssertionError(f"FakeLLM: no scripted response for task {task.value}")
        if isinstance(resp, BaseException):
            raise resp
        if callable(resp):
            resp = resp(payload)
        problems = P.validate_output(task, resp)
        if problems:
            raise T.LLMInvalidResponse(
                f"resposta de {task.value} fora do schema: {problems[:3]}", errors=problems
            )
        if on_progress is not None:
            on_progress(T.Progress(stage="llm", done=1, total=1, message=task.value))
        return copy.deepcopy(resp)

    def calls_for(self, task: T.AiTask | str) -> list[Mapping[str, Any]]:
        task = T.AiTask(task)
        return [payload for t, payload in self.calls if t is task]


# --------------------------------------------------------------------------- JobRunner


class _FakeJobProgress:
    """The fake's ``on_progress``: records/announces and is a cancellation point (like the real
    one)."""

    def __init__(
        self, runner: FakeJobRunner, job_id: str, event: str | None, session_id: str | None
    ) -> None:
        self.runner = runner
        self.job_id = job_id
        self.event = event
        self.session_id = session_id

    def is_cancelled(self) -> bool:
        return self.runner.jobs[self.job_id].status is not T.JobStatus.running

    def check_cancelled(self) -> None:
        if self.is_cancelled():
            raise T.Cancelled()

    def __call__(self, progress: T.Progress) -> None:
        self.check_cancelled()
        jobs = self.runner.jobs
        jobs[self.job_id] = replace(jobs[self.job_id], progress=progress)
        if self.event:
            self.runner._emit(
                self.session_id,
                self.event,
                {"job": self.job_id, "progress": T.to_jsonable(progress)},
            )


class FakeJobRunner:
    """Synchronous ``JobRunner``: ``submit`` runs *fn* right away (or holds it, with ``defer=True``,
    until ``run_pending()``) and returns the job in the ``queued`` state, like the real one.
    ``cancel`` closes it as ``error``/``JOB_CANCELLED_CODE`` and *fn* stops at the next
    ``on_progress``/``check_cancelled``."""

    def __init__(
        self,
        *,
        events: FakeEventSink | T.EventSink | None = None,
        clock: T.Clock | None = None,
        defer: bool = False,
    ) -> None:
        self.events = events
        self.clock = clock or FakeClock()
        self.defer = defer
        self.jobs: dict[str, T.Job] = {}
        self._pending: dict[str, tuple[Callable[[T.ProgressFn], Any], dict[str, Any]]] = {}
        self._ids = itertools.count(1)
        self.submitted: list[tuple[T.JobKind, str]] = []
        self._opts: dict[str, dict[str, Any]] = {}

    def submit(
        self,
        kind: T.JobKind,
        fn: Callable[[T.ProgressFn], Any],
        *,
        event: str | None = None,
        progress_event: str | None = None,
        session_id: str | None = None,
    ) -> T.Job:
        now = self.clock.now()
        job = T.Job(
            id=f"job-{next(self._ids)}",
            kind=T.JobKind(kind),
            status=T.JobStatus.queued,
            created_at=now,
            updated_at=now,
        )
        self.jobs[job.id] = job
        self.submitted.append((job.kind, job.id))
        opts = {"event": event, "progress_event": progress_event, "session_id": session_id}
        self._opts[job.id] = opts
        if self.defer:
            self._pending[job.id] = (fn, opts)
        else:
            self._run(job.id, fn, **opts)
        return job

    def _emit(self, session_id: str | None, event: str, payload: dict[str, Any]) -> None:
        if self.events is None:
            return
        if session_id:
            self.events.emit_to_session(session_id, event, payload)
        else:
            self.events.broadcast(event, payload)

    def _run(
        self,
        job_id: str,
        fn: Callable[[T.ProgressFn], Any],
        *,
        event: str | None,
        progress_event: str | None,
        session_id: str | None,
    ) -> None:
        if self.jobs[job_id].status is not T.JobStatus.queued:
            return  # cancelled before starting: fn does not even run (like the real one)
        self.jobs[job_id] = replace(
            self.jobs[job_id], status=T.JobStatus.running, updated_at=self.clock.now()
        )
        on_progress = _FakeJobProgress(self, job_id, progress_event, session_id)

        try:
            result = T.to_jsonable(fn(on_progress))
        except T.Cancelled:
            if T.is_job_cancelled(self.jobs[job_id]):
                return  # the end was already announced by ``cancel``
            self._close_cancelled(job_id)
        except Exception as exc:  # noqa: BLE001 - the real one also converts any error
            if T.is_job_cancelled(self.jobs[job_id]):
                return  # already closed and announced: a late finish does not revive it
            self._fail(job_id, exc)
        else:
            if T.is_job_cancelled(self.jobs[job_id]):
                return  # cancelled without passing a checkpoint: result discarded
            self.jobs[job_id] = replace(
                self.jobs[job_id],
                status=T.JobStatus.done,
                result=result,
                updated_at=self.clock.now(),
            )
        if event:
            self._emit(session_id, event, {"job": job_id, "status": self.jobs[job_id].status.value})

    def _fail(self, job_id: str, exc: Exception) -> None:
        if isinstance(exc, T.TubeError):
            self.jobs[job_id] = replace(
                self.jobs[job_id],
                status=T.JobStatus.error,
                error={"code": exc.code, "message": exc.message},
                updated_at=self.clock.now(),
            )
        else:
            self.jobs[job_id] = replace(
                self.jobs[job_id],
                status=T.JobStatus.error,
                error={"code": "internal", "message": str(exc) or type(exc).__name__},
                updated_at=self.clock.now(),
            )

    def _close_cancelled(self, job_id: str) -> None:
        self.jobs[job_id] = replace(
            self.jobs[job_id],
            status=T.JobStatus.error,
            result=None,
            error={"code": T.JOB_CANCELLED_CODE, "message": "Trabalho cancelado a pedido."},
            updated_at=self.clock.now(),
        )

    def cancel(self, job_id: str) -> T.Job | None:
        """Like the real one: active → ``error``/``cancelled`` right away + *event*; *fn* stops at
        the next ``on_progress``/``check_cancelled``; finished → left as is; unknown → ``None``."""
        job = self.jobs.get(job_id)
        if job is None or job.status not in (T.JobStatus.queued, T.JobStatus.running):
            return job
        self._close_cancelled(job_id)
        opts = self._opts.get(job_id) or {}
        if opts.get("event"):
            self._emit(opts.get("session_id"), opts["event"], {"job": job_id, "status": "error"})
        return self.jobs[job_id]

    def run_pending(self) -> int:
        """Runs the held jobs (``defer=True``); returns how many."""
        pending, self._pending = self._pending, {}
        for job_id, (fn, opts) in pending.items():
            self._run(job_id, fn, **opts)
        return len(pending)

    def get(self, job_id: str) -> T.Job | None:
        return self.jobs.get(job_id)

    def list_active(self) -> list[T.Job]:
        active = (T.JobStatus.queued, T.JobStatus.running)
        return [j for j in self.jobs.values() if j.status in active]

    def purge(self, older_than: T.Timestamp) -> int:
        done = (T.JobStatus.done, T.JobStatus.error)
        old = [k for k, j in self.jobs.items() if j.status in done and j.updated_at < older_than]
        for key in old:
            del self.jobs[key]
        return len(old)


# --------------------------------------------------------------------------- Lens


class FakeLens:
    """``Lens`` with fixed items, badges and classics. Disabled: nothing (and ``calls`` shows that
    no data was read beyond ``enabled``)."""

    def __init__(
        self,
        *,
        name: str = T.HN_LENS,
        enabled: bool = True,
        items: Sequence[T.LensItem] = (),
        details: Mapping[str, str] | None = None,
        badge: str | None = None,
        classics: Sequence[T.SearchHit] = (),
    ) -> None:
        self._name = name
        self._enabled = enabled
        self.lens_items = list(items)
        self.details = dict(details or {})
        self.badge = badge or name
        self.classic_hits = list(classics)
        self.calls: list[tuple[str, Any]] = []

    @property
    def name(self) -> str:
        return self._name

    def set_enabled(self, value: bool) -> None:
        self._enabled = value

    def enabled(self) -> bool:
        return self._enabled

    def items(self, rules: T.TabRules, mode: T.FeedMode, limit: int) -> list[T.LensItem]:
        self.calls.append(("items", (mode, limit)))
        if not self._enabled:
            return []
        out = list(self.lens_items)
        if mode is T.FeedMode.long:
            out = [i for i in out if (i.video.duration_s or 0) >= 1200]
        if rules.exclude.shorts:
            out = [i for i in out if not i.video.is_short]
        return out[: max(0, limit)]

    def enrich(self, items: Sequence[T.FeedItem]) -> list[T.FeedItem]:
        self.calls.append(("enrich", len(items)))
        if not self._enabled:
            return list(items)
        out = []
        for item in items:
            detail = self.details.get(item.video.id)
            if detail is None:
                out.append(item)
                continue
            badges = item.badges if self.badge in item.badges else (*item.badges, self.badge)
            why = replace(item.why, detail=detail) if item.why is not None else None
            out.append(replace(item, badges=badges, why=why))
        return out

    def classics(self, query: str, limit: int) -> list[T.SearchHit]:
        self.calls.append(("classics", (query, limit)))
        if not self._enabled:
            return []
        return list(self.classic_hits)[: max(0, limit)]


# --------------------------------------------------------------------------- DeviceAuth


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class FakeDeviceAuth:
    """In-memory ``DeviceAuth``: codes ``100001``, ``100002``…; tokens ``tok-1``…"""

    PAIRING_TTL_S = 300
    MAX_ATTEMPTS = 5

    def __init__(self, *, clock: T.Clock | None = None) -> None:
        self.clock = clock or FakeClock()
        self._codes = itertools.count(100001)
        self._devices = itertools.count(1)
        self.pair_codes: dict[str, dict[str, Any]] = {}
        self.devices: dict[str, T.Device] = {}
        self.tokens: dict[str, str] = {}
        """hash do token → device_id."""

    def start_pairing(self) -> T.PairingCode:
        for data in self.pair_codes.values():
            if data["used_at"] is None:
                data["used_at"] = -1  # replaced: closed and without a device
        code = str(next(self._codes))
        expires = self.clock.now() + self.PAIRING_TTL_S
        self.pair_codes[_hash(code)] = {
            "expires_at": expires,
            "used_at": None,
            "device_id": None,
            "attempts": 0,
        }
        self._latest = _hash(code)
        return T.PairingCode(code=code, expires_at=expires)

    def complete_pairing(
        self, code: str, device_name: str, origin: str | None = None
    ) -> T.PairedDevice:
        """Same semantics as the real one: only the latest code counts; 5 wrong tries lock it."""
        now = self.clock.now()
        latest = self.pair_codes.get(getattr(self, "_latest", ""))
        if latest is None:
            raise T.PairingFailed("no_active_code")
        if latest["used_at"] is not None:
            if latest["device_id"] is None and latest["attempts"] >= self.MAX_ATTEMPTS:
                raise T.PairingFailed("locked")
            mine = self.pair_codes.get(_hash(str(code)))
            if mine is not None and mine["device_id"] is not None:
                raise T.PairingFailed("used")
            raise T.PairingFailed("no_active_code")
        if now >= latest["expires_at"]:
            raise T.PairingFailed("expired")
        if _hash(str(code)) != self._latest:
            latest["attempts"] += 1
            if latest["attempts"] >= self.MAX_ATTEMPTS:
                latest["used_at"] = now
                raise T.PairingFailed("locked")
            error = T.PairingFailed("invalid_code")
            error.details["remaining"] = self.MAX_ATTEMPTS - latest["attempts"]
            raise error
        device = replace(self.add_device(device_name), origin=origin)
        self.devices[device.id] = device
        latest["used_at"] = now
        latest["device_id"] = device.id
        token = f"tok-{device.id}"
        self.tokens[_hash(token)] = device.id
        return T.PairedDevice(device=device, token=token)

    def add_device(self, name: str = "Chrome", *, seen_at: int | None = None) -> T.Device:
        """Test shortcut: paired device (no code)."""
        n = next(self._devices)
        device = T.Device(id=f"dev-{n}", name=name, created_at=self.clock.now(), last_seen=seen_at)
        self.devices[device.id] = device
        self.tokens.setdefault(_hash(f"tok-{device.id}"), device.id)
        return device

    def verify(self, token: str) -> T.Device:
        device_id = self.tokens.get(_hash(str(token)))
        device = self.devices.get(device_id or "")
        if device is None or device.revoked_at is not None:
            raise T.Unauthorized("invalid or revoked token")
        device = replace(device, last_seen=self.clock.now())
        self.devices[device.id] = device
        return device

    def pairing_open(self) -> bool:
        now = self.clock.now()
        return any(
            d["used_at"] is None and d["expires_at"] >= now for d in self.pair_codes.values()
        )

    def revoke(self, device_id: str) -> bool:
        device = self.devices.get(device_id)
        if device is None:
            return False
        if device.revoked_at is None:
            self.devices[device_id] = replace(device, revoked_at=self.clock.now())
        return True

    def list(self) -> list[T.Device]:
        return [d for d in self.devices.values() if d.revoked_at is None]

    def any_seen_within(self, seconds: float = T.DEVICE_ONLINE_WINDOW_S) -> bool:
        now = self.clock.now()
        return any(d.last_seen is not None and now - d.last_seen <= seconds for d in self.list())


def json_text(value: Any) -> str:
    """Deterministic JSON (same format the fakes write into the JSON columns)."""
    return json.dumps(T.to_jsonable(value), ensure_ascii=False, sort_keys=True)


__all__ = [
    "DEFAULT_NOW",
    "FakeClock",
    "FakeDeviceAuth",
    "FakeEventSink",
    "FakeHttp",
    "FakeJobRunner",
    "FakeLLM",
    "FakeLLMBackend",
    "FakeLens",
    "FakeSettings",
    "default_response",
    "json_text",
]
