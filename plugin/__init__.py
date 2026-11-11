"""Agent side of the plugin: ``register(ctx)``.

In the local Desktop it runs **in the gateway**: tools, ``/tube``, hook, RPC and blueprints live
here; ``plugin_api`` (REST) runs in another process and only shares the SQLite database.

Registers, from the tables and modules (stub or real):

- the 9 tools of ``tools/catalog.TOOLS`` (= ``provides_tools`` in ``plugin.yaml``);
- the ``pre_llm_call`` hook of ``tools/directive`` (= ``provides_hooks``);
- the ``/tube`` command (``commands.handle``);
- the blueprints of ``blueprints.BLUEPRINTS`` (agent routines);
- the AI auxiliary task ``wiring.CURATOR_TASK`` (the ``curator`` key is reserved by Hermes);
- the RPC methods of ``wiring.RPC_METHODS`` (``ctx.register_rpc``; they never raise);
- the skills in ``skills/*/SKILL.md`` (explicit load, ``<id>:<name>``);
- ``on_unload``: stops the extension server **before** closing the database.

**No network and no threads here** (the extension server only starts through
``wiring.ensure_ext_server`` in ``GET /status``, ``pair.start`` and ``tube_status``). Each handler
is looked up in its module **at call time**, so the real one replaces the stub and tests can swap
functions with ``monkeypatch``. A failure in one block is logged and does not stop the other
blocks (``doctor``/``validate`` flag a missing tool or hook).
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

_PLUGIN_DIR = Path(__file__).resolve().parent


def _ensure_alias() -> Any:
    """Register ``tube_pkg`` (synthetic package of ``plugin/``) by loading ``_bootstrap.py`` by
    path — works with or without a parent package."""
    spec = importlib.util.spec_from_file_location(
        "_tube_pkg_bootstrap_init", _PLUGIN_DIR / "_bootstrap.py"
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {_PLUGIN_DIR / '_bootstrap.py'}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ensure()
    # Hermes re-executes this file when reloading the plugin in the same process: if the code on
    # disk changed, swap the ``tube_pkg`` generation now
    module.refresh(force=True)
    return module


_BOOT = _ensure_alias()

from tube_pkg import wiring  # noqa: E402
from tube_pkg._id import PLUGIN_ID  # noqa: E402

logger = logging.getLogger(__name__)

CURATOR_DISPLAY_NAME = "YouTube curator"
CURATOR_DESCRIPTION = (
    "Organizes YouTube subscriptions into folders, writes cleanup reasons, curates theme tabs "
    "and imports channel lists (structured outputs)."
)


def _module(name: str) -> Any:
    """Module of the current ``tube_pkg`` generation (first checks if the code on disk changed)."""
    _BOOT.refresh()
    return importlib.import_module(name)


def _tool_handler(name: str) -> Callable[..., str]:
    def handler(args: dict[str, Any] | None = None, **kwargs: Any) -> str:
        try:
            fn = getattr(_module("tube_pkg.tools.catalog"), name)
            out = fn(args if isinstance(args, dict) else {}, **kwargs)
        except Exception as exc:  # noqa: BLE001 — a tool never raises
            logger.exception("%s: tool %s failed", PLUGIN_ID, name)
            return json.dumps({"error": f"{type(exc).__name__}: internal error"})
        return out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)

    handler.__name__ = name
    return handler


def _register_tools(ctx: Any) -> None:
    catalog = _module("tube_pkg.tools.catalog")
    for spec in catalog.TOOLS:
        ctx.register_tool(
            name=spec.name,
            toolset=PLUGIN_ID,
            schema=spec.schema(),
            handler=_tool_handler(spec.name),
            description=spec.description,
            emoji=spec.emoji,
        )


def _register_hook(ctx: Any) -> None:
    def pre_llm_call(**kwargs: Any) -> Any:
        try:
            return _module("tube_pkg.tools.directive").pre_llm_call(**kwargs)
        except Exception:  # noqa: BLE001 — the hook never breaks the conversation
            logger.exception("%s: pre_llm_call hook failed", PLUGIN_ID)
            return None

    ctx.register_hook("pre_llm_call", pre_llm_call)


def _register_command(ctx: Any) -> None:
    commands = _module("tube_pkg.commands")

    # Declaring ``source``/``platform`` makes Hermes pass the chat (``invoke_plugin_command``):
    # ``source=None`` on a messaging surface means "unknown chat" and ``/tube`` treats it as shared.
    def tube(raw_args: str = "", *, source: Any = None, platform: str | None = None) -> str:
        try:
            return _module("tube_pkg.commands").handle(
                raw_args or "", ctx=ctx, platform=platform, source=source
            )
        except Exception:  # noqa: BLE001 — an exception would become "unknown command"
            logger.exception("%s: /tube failed", PLUGIN_ID)
            return "/tube: internal error. See the Hermes log."

    ctx.register_command(
        commands.NAME, tube, description=commands.DESCRIPTION, args_hint=commands.ARGS_HINT
    )


def _register_blueprints(ctx: Any) -> None:
    for item in _module("tube_pkg.blueprints").BLUEPRINTS:
        fields = dict(item)
        key = fields.pop("key")
        ctx.register_automation_blueprint(key, **fields)


def _register_aux_task(ctx: Any) -> None:
    ctx.register_auxiliary_task(
        wiring.CURATOR_TASK, display_name=CURATOR_DISPLAY_NAME, description=CURATOR_DESCRIPTION
    )


def _rpc_entry(method: wiring.RpcMethod) -> Callable[..., Any]:
    def handler(params: Any = None, *, session_id: str | None = None, **kwargs: Any) -> Any:
        common = _module("tube_pkg.api._common")
        try:
            fn = _module("tube_pkg.wiring").resolve_handler(method.module, method.handler)
        except Exception as exc:  # noqa: BLE001
            return common.error_envelope(exc)
        return common.call_rpc(fn, params, session_id=session_id, **kwargs)

    handler.__name__ = method.handler
    return handler


def _register_rpc(ctx: Any) -> None:
    for method in wiring.RPC_METHODS:
        ctx.register_rpc(method.name, _rpc_entry(method))


def _skill_description(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    if not text.startswith("---"):
        return ""
    try:
        from tube_pkg._yaml import safe_load  # the Hermes runtime has no PyYAML

        front = safe_load(text.split("---", 2)[1]) or {}
    except Exception:  # noqa: BLE001
        return ""
    return str(front.get("description") or "") if isinstance(front, dict) else ""


def _register_skills(ctx: Any) -> None:
    skills_dir = _PLUGIN_DIR / "skills"
    if not skills_dir.is_dir():
        return
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.is_file():
            ctx.register_skill(child.name, skill_md, description=_skill_description(skill_md))


def _unload_callback(home: Path | None) -> Callable[[], None]:
    def unload() -> None:
        _module("tube_pkg.wiring").shutdown(home)

    return unload


_STEPS: tuple[tuple[str, Callable[[Any], None]], ...] = (
    ("tools", _register_tools),
    ("hook", _register_hook),
    ("command", _register_command),
    ("blueprints", _register_blueprints),
    ("aux_task", _register_aux_task),
    ("rpc", _register_rpc),
    ("skills", _register_skills),
)


def register(ctx: Any) -> None:
    """Hermes entry point (see the module docstring). No network and no threads."""
    # diagnostics: where the code was loaded from (shows whether a profile restart reloads Python)
    logger.info("%s: register (code in %s)", PLUGIN_ID, os.path.dirname(os.path.realpath(__file__)))
    current = _module("tube_pkg.wiring")
    current.bind_ctx(ctx)
    for label, step in _STEPS:
        try:
            step(ctx)
        except Exception:  # noqa: BLE001 — one broken block does not bring the others down
            logger.exception("%s: failed to register %s", PLUGIN_ID, label)
    ctx.on_unload(_unload_callback(current.current_home()))
