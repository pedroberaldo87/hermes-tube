"""``FakeCtx``: the ``ctx`` that ``register(ctx)`` receives, without Hermes.

- ``register_*`` record into lists/dicts (``tools``, ``commands``, ``rpc``, ``hooks``,
  ``aux_tasks``, ``skills``, ``blueprints``…); any other ``register_<x>`` is accepted and goes to
  ``registrations["register_<x>"]``;
- ``register_automation_blueprint`` delegates to Hermes's **real** validation
  (``cron.blueprint_plugins.build_plugin_blueprint`` →
  ``cron.blueprint_catalog.AutomationBlueprint``), with a lazy import; ``strict=True`` (default)
  raises the ``ValueError`` the host would only log;
- scripted ``ask_choice`` (``script_choices``): value, label, a ``(q, choices) -> str`` function or
  ``None``; with no script it returns ``None`` (= no human), like the host outside a synchronous
  command;
- ``llm`` = ``FakePluginLlm`` (shape of Hermes's ``ctx.llm.complete_structured``);
- ``get_config``/``set_config`` over ``config``; ``dispatch_tool`` calls a tool registered
  here or ``tool_responses[name]``; otherwise returns an error JSON, like the Hermes registry;
- ``emit_to_session`` records into ``session_events``; ``broadcasts`` receives the global events
  while ``patch_broadcast(monkeypatch)`` is active.
"""

from __future__ import annotations

import json
from collections import deque
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from tube_pkg._id import PLUGIN_ID


@dataclass
class FakeLlmResult:
    """Same shape as ``agent.plugin_llm.PluginLlmStructuredResult``."""

    text: str
    provider: str
    model: str
    parsed: Any = None
    usage: dict[str, int] = field(default_factory=dict)


class FakePluginLlm:
    """Scripted ``ctx.llm``: ``script(*responses)`` (``parsed``, a ``kwargs -> parsed`` function or
    an exception). ``calls`` keeps the kwargs of each call."""

    def __init__(self, *, provider: str = "fake", model: str = "fake-model") -> None:
        self.provider = provider
        self.model = model
        self.queue: deque[Any] = deque()
        self.calls: list[dict[str, Any]] = []

    def script(self, *responses: Any) -> FakePluginLlm:
        self.queue.extend(responses)
        return self

    def _next(self, kwargs: dict[str, Any]) -> Any:
        self.calls.append(kwargs)
        if not self.queue:
            raise AssertionError("FakePluginLlm: no scripted response")
        resp = self.queue.popleft()
        if isinstance(resp, BaseException):
            raise resp
        if callable(resp):
            resp = resp(kwargs)
        return resp

    def complete_structured(self, *, instructions: str, input: Any, **kwargs: Any) -> FakeLlmResult:
        parsed = self._next({"instructions": instructions, "input": input, **kwargs})
        text = parsed if isinstance(parsed, str) else json.dumps(parsed, ensure_ascii=False)
        return FakeLlmResult(
            text=text,
            provider=self.provider,
            model=self.model,
            parsed=None if isinstance(parsed, str) else parsed,
        )

    def complete(self, messages: list[dict[str, Any]], **kwargs: Any) -> FakeLlmResult:
        out = self._next({"messages": messages, **kwargs})
        return FakeLlmResult(text=str(out), provider=self.provider, model=self.model)


def _options(choices: Iterable[Any]) -> list[tuple[str, str]]:
    out = []
    for choice in choices:
        if isinstance(choice, str):
            out.append((choice, choice))
        else:
            value = str(choice["value"])
            out.append((value, str(choice.get("label") or value)))
    return out


class FakeCtx:
    """Fake of ``hermes_cli.plugins.PluginContext`` (see the module docstring)."""

    def __init__(
        self,
        *,
        config: Mapping[str, Any] | None = None,
        plugin_id: str = PLUGIN_ID,
        strict: bool = True,
        profile_name: str = "test",
        session_delivery: bool = True,
    ) -> None:
        self._plugin_id = plugin_id
        self.manifest = SimpleNamespace(name=plugin_id, key=plugin_id, version="0.0.0-test")
        self.strict = strict
        self.profile_name = profile_name
        self.config: dict[str, Any] = dict(config or {})
        self.tools: list[dict[str, Any]] = []
        self.commands: dict[str, dict[str, Any]] = {}
        self.cli_commands: dict[str, dict[str, Any]] = {}
        self.rpc: dict[str, Callable[..., Any]] = {}
        self.hooks: dict[str, list[Callable[..., Any]]] = {}
        self.aux_tasks: dict[str, dict[str, Any]] = {}
        self.skills: dict[str, dict[str, Any]] = {}
        self.blueprints: list[Any] = []
        self.blueprint_errors: list[tuple[str, str]] = []
        self.registrations: dict[str, list[tuple[tuple[Any, ...], dict[str, Any]]]] = {}
        self.unload_callbacks: list[Callable[[], None]] = []
        self.llm = FakePluginLlm()
        self.choice_script: deque[Any] = deque()
        self.asked: list[tuple[str, list[Any]]] = []
        self.tool_responses: dict[str, Any] = {}
        self.dispatched: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
        self.session_events: list[tuple[str, str, dict[str, Any]]] = []
        self.session_delivery = session_delivery
        self.broadcasts: list[tuple[str, dict[str, Any]]] = []
        self.emitted: list[tuple[str, dict[str, Any]]] = []
        self.posted: list[str] = []

    # ------------------------------------------------------------------ identity and config

    @property
    def plugin_id(self) -> str:
        return self._plugin_id

    def rpc_method(self, name: str) -> str:
        """Wire name of a registered method (``plugin.<id>.<name>``)."""
        return f"plugin.{self._plugin_id}.{name}"

    def get_config(self, key: str, default: Any = None) -> Any:
        node: Any = self.config
        for part in key.split("."):
            if not isinstance(node, Mapping) or part not in node:
                return default
            node = node[part]
        return node

    def set_config(self, key: str, value: Any) -> None:
        self.config[key] = value

    # ------------------------------------------------------------------ registrations

    def register_tool(
        self,
        name: str,
        toolset: str,
        schema: dict,
        handler: Callable,
        check_fn: Callable | None = None,
        requires_env: list | None = None,
        is_async: bool = False,
        description: str = "",
        emoji: str = "",
        override: bool = False,
    ) -> dict[str, Any]:
        entry = {
            "name": name,
            "toolset": toolset,
            "schema": schema,
            "handler": handler,
            "check_fn": check_fn,
            "requires_env": requires_env,
            "is_async": is_async,
            "description": description,
            "emoji": emoji,
            "override": override,
        }
        self.tools = [t for t in self.tools if t["name"] != name] + [entry]
        return entry

    def tool(self, name: str) -> dict[str, Any]:
        return next(t for t in self.tools if t["name"] == name)

    def register_command(
        self,
        name: str,
        handler: Callable,
        description: str = "",
        args_hint: str = "",
        argument_mode: str | None = None,
    ) -> dict[str, Any]:
        clean = name.lower().strip().lstrip("/").replace(" ", "-")
        entry = {
            "handler": handler,
            "description": description or "Plugin command",
            "args_hint": args_hint,
            "argument_mode": argument_mode,
        }
        self.commands[clean] = entry
        return entry

    def register_cli_command(
        self,
        name: str,
        help: str,
        setup_fn: Callable,
        handler_fn: Callable | None = None,
        description: str = "",
    ) -> dict[str, Any]:
        entry = {
            "help": help,
            "setup_fn": setup_fn,
            "handler_fn": handler_fn,
            "description": description,
        }
        self.cli_commands[name] = entry
        return entry

    def register_rpc(self, name: str, handler: Callable[..., Any]) -> str:
        if not callable(handler):
            raise TypeError("register_rpc() handler must be callable")
        self.rpc[name] = handler
        return self.rpc_method(name)

    def call_rpc(self, name: str, params: Mapping[str, Any] | None = None, **kwargs: Any) -> Any:
        """Calls the handler like the host: ``handler(params, *, session_id, **kwargs)``."""
        kwargs.setdefault("session_id", None)
        return self.rpc[name](dict(params or {}), **kwargs)

    def register_hook(
        self, hook_name: str, callback: Callable, *, hold_stream: bool = False
    ) -> Callable:
        self.hooks.setdefault(hook_name, []).append(callback)
        return callback

    def register_auxiliary_task(
        self,
        key: str,
        *,
        display_name: str,
        description: str,
        defaults: dict[str, Any] | None = None,
        inherit_from: str | None = None,
    ) -> dict[str, Any]:
        entry = {
            "display_name": display_name,
            "description": description,
            "defaults": defaults,
            "inherit_from": inherit_from,
        }
        self.aux_tasks[key] = entry
        return entry

    def register_skill(
        self,
        name: str,
        path: Any,
        description: str = "",
        frontmatter: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        from pathlib import Path

        if ":" in name:
            raise ValueError(f"Skill name '{name}' must not contain ':'")
        if not Path(path).exists():
            raise FileNotFoundError(f"SKILL.md not found at {path}")
        entry = {
            "path": Path(path),
            "description": description,
            "frontmatter": dict(frontmatter or {}),
        }
        self.skills[f"{self._plugin_id}:{name}"] = entry
        return entry

    def register_automation_blueprint(
        self,
        key: str,
        *,
        title: str,
        description: str,
        schedule_template: str,
        prompt_template: str,
        category: str = "general",
        slots: Iterable[Any] = (),
        deliver_default: str = "origin",
        skills: Iterable[str] = (),
        tags: Iterable[str] = (),
    ) -> Any:
        from cron.blueprint_plugins import build_plugin_blueprint  # lazy import (Hermes)

        try:
            blueprint = build_plugin_blueprint(
                self.manifest.name,
                key,
                title=title,
                description=description,
                schedule_template=schedule_template,
                prompt_template=prompt_template,
                category=category,
                slots=slots,
                deliver_default=deliver_default,
                skills=skills,
                tags=tags,
            )
        except ValueError as exc:
            self.blueprint_errors.append((key, str(exc)))
            if self.strict:
                raise
            return None
        if any(b.key == blueprint.key for b in self.blueprints):
            self.blueprint_errors.append((key, "duplicate"))
            if self.strict:
                raise ValueError(f"automation blueprint {blueprint.key!r} already registered")
            return None
        self.blueprints.append(blueprint)
        return blueprint

    def on_unload(self, callback: Callable[[], None]) -> Callable[[], None]:
        self.unload_callbacks.append(callback)
        return callback

    def __getattr__(self, name: str) -> Any:
        if name.startswith("register_"):

            def recorder(*args: Any, **kwargs: Any) -> tuple[tuple[Any, ...], dict[str, Any]]:
                self.registrations.setdefault(name, []).append((args, kwargs))
                return args, kwargs

            return recorder
        raise AttributeError(name)

    # ------------------------------------------------------------------ interaction

    def script_choices(self, *answers: Any) -> FakeCtx:
        """``ask_choice`` answers in order: value, label, a ``(q, choices)`` function or
        ``None`` (cancelled/timeout)."""
        self.choice_script.extend(answers)
        return self

    def ask_choice(self, question: str, choices: list) -> str | None:
        self.asked.append((question, list(choices)))
        options = _options(choices)
        if not self.choice_script or not options:
            return None
        answer = self.choice_script.popleft()
        if callable(answer):
            answer = answer(question, list(choices))
        if answer is None:
            return None
        typed = str(answer).strip().casefold()
        return next(
            (value for value, label in options if typed in (value.casefold(), label.casefold())),
            None,
        )

    def dispatch_tool(self, tool_name: str, args: dict, **kwargs: Any) -> str:
        self.dispatched.append((tool_name, dict(args), dict(kwargs)))
        registered = next((t for t in self.tools if t["name"] == tool_name), None)
        if registered is not None:
            return registered["handler"](args, **kwargs)
        response = self.tool_responses.get(tool_name)
        if response is None:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
        if callable(response):
            return response(args)
        return response if isinstance(response, str) else json.dumps(response)

    def emit_to_session(
        self, session_id: str, event: str, payload: dict[str, Any] | None = None
    ) -> bool:
        self.session_events.append((session_id, event, dict(payload or {})))
        return self.session_delivery

    def emit(self, event: str, payload: dict | None = None) -> int:
        self.emitted.append((event, dict(payload or {})))
        return 0

    def post_message(self, text: str) -> SimpleNamespace:
        self.posted.append(text)
        return SimpleNamespace(ok=True, edit=lambda new: self.posted.append(new))

    def session_surface(self) -> str:
        return "cli"

    def patch_broadcast(self, monkeypatch: Any) -> None:
        """Captures ``hermes_cli.plugin_events.broadcast_plugin_event`` into ``broadcasts``
        (only this plugin's events); without an importable Hermes, does nothing."""
        try:
            import hermes_cli.plugin_events as plugin_events
        except ImportError:
            return

        def fake_broadcast(plugin_id: str, event: str, payload: dict | None = None) -> None:
            if plugin_id == self._plugin_id:
                self.broadcasts.append((event, dict(payload or {})))

        monkeypatch.setattr(plugin_events, "broadcast_plugin_event", fake_broadcast)


__all__ = ["FakeCtx", "FakeLlmResult", "FakePluginLlm"]
