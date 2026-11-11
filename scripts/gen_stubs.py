#!/usr/bin/env python3
"""Generator of the stubs of the runnable skeleton.

Sources: ``contract/api.yaml`` + ``contract/rpc.yaml`` (through ``scripts/gen_types.py``, loaded by
path) and the ``Protocol``s/``BUILDS`` of ``plugin/core/types.py``.

Generates **only files that do not exist** (it never overwrites: a real file always wins):

- REST ``x-module`` (``plugin/api/*.py``): one function per operation, ``<operationId in
  snake_case>(body, query) -> Envelope``, returning the ``example`` of ``responses.200``;
- RPC ``x-module`` (``plugin/rpc/*.py``): ``<group>_<verb>(params, *, session_id=None, **kw)``,
  returning ``example.result``;
- extension ``x-module`` (``plugin/ext/*.py``): ``<x-handler>(device, body, query, *, <x-deps>)``,
  returning the ``example``; plus ``plugin/ext/auth.py`` (``authenticate``);
- every ``BUILDS`` module (``plugin/core``, ``plugin/adapters``,
  ``plugin/routines/installer.py``): a class that implements the ``Protocol`` (every method raises
  ``NotImplementedError``) + the ``build`` with the ``BUILD_SIGNATURES`` signature;
- ``plugin/tools/catalog.py`` and ``plugin/tools/directive.py``, ``plugin/commands.py``,
  ``plugin/blueprints.py``, ``plugin/routines/maintenance.py``,
  ``plugin/skills/<PLUGIN_ID>/SKILL.md``.

Always rewrites the tables block of ``plugin/wiring.py`` (REST routes, RPC methods and extension
handlers), between the ``# >>> gen_stubs`` / ``# <<< gen_stubs`` markers.

    python scripts/gen_stubs.py              generates what is missing and updates the wiring tables
    python scripts/gen_stubs.py --check      checks only (exits 1 if a file/handler or table is off)
    python scripts/gen_stubs.py --list       lists the contract modules: owner, stub|real|missing
    python scripts/gen_stubs.py --root <dir> another tree

Also a library (``tests/test_contract_surface.py``): ``run_check(root) -> list[str]``.
"""

from __future__ import annotations

import argparse
import ast
import importlib.util
import pprint
import re
import subprocess
import sys
import textwrap
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT_DEFAULT = Path(__file__).resolve().parents[1]
WIRING = "plugin/wiring.py"
BEGIN = "# >>> gen_stubs: tables"
END = "# <<< gen_stubs: tables <<<"

STD_NAMES = {
    "Any": "typing",
    "Literal": "typing",
    "Callable": "collections.abc",
    "Iterator": "collections.abc",
    "Iterable": "collections.abc",
    "Mapping": "collections.abc",
    "Sequence": "collections.abc",
    "AbstractContextManager": "contextlib",
}
BUILTINS = {
    "str",
    "int",
    "float",
    "bool",
    "dict",
    "list",
    "tuple",
    "set",
    "None",
    "object",
    "bytes",
}

# owners of the files that are not in contract/owners.yaml
OWNER_PREFIXES = (
    ("plugin/tools/", "area-47"),
    ("plugin/skills/", "area-47"),
    ("plugin/routines/maintenance", "area-maintenance"),
    ("plugin/routines/", "area-blueprints"),
)

# tool → contract operation whose example the stub returns (REST data or RPC job_result)
TOOL_EXAMPLES = {
    "tube_status": "getStatus",
    "tube_feed": "getFeed",
    "tube_channels": "getChannels",
    "tube_add_channel": "postChannelsAdd",
    "tube_organize": "organize.run",
    "tube_cleanup_scan": "cleanup.scan",
    "tube_theme_create": "theme.create",
    "tube_tab": "postTab",
    "tube_mark": "postVideosState",
}


# =========================================================================== loading


def _load_by_path(name: str, path: Path) -> Any:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _gen_types(root: Path) -> Any:
    return _load_by_path("_gen_types_for_stubs", root / "scripts" / "gen_types.py")


def snake(operation_id: str) -> str:
    """``getChannelsBatch`` → ``get_channels_batch`` (REST handler name)."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", operation_id).lower()


def rpc_handler_name(method: str) -> str:
    """``organize.run`` → ``organize_run``."""
    return method.replace(".", "_")


def module_name(path: str) -> str:
    return "tube_pkg." + path.removeprefix("plugin/").removesuffix(".py").replace("/", ".")


def owner_of(path: str, owners: dict[str, str]) -> str:
    if path in owners:
        return owners[path]
    for prefix, unit in OWNER_PREFIXES:
        if path.startswith(prefix):
            return unit
    return "?"


def literal(value: Any) -> str:
    return pprint.pformat(value, width=88, sort_dicts=False)


# =========================================================================== model


@dataclass
class StubFile:
    path: str
    owner: str
    kind: str
    render: Any  # () -> str
    handlers: list[str] = field(default_factory=list)


@dataclass
class Plan:
    root: Path
    files: list[StubFile]
    rest: list[tuple[str, str, str, str, str]]
    rpc: list[tuple[str, str, str]]
    ext: list[tuple[str, str, tuple[str, ...], str]]


def _ops(gt: Any, contract: Any) -> list[Any]:
    return list(gt.iter_operations(contract))


def build_plan(root: Path) -> Plan:
    gt = _gen_types(root)
    contract = gt.load_contract(root)
    T = contract.types_mod  # noqa: N806
    owners: dict[str, str] = dict(contract.owners.get("modules") or {})
    ops = _ops(gt, contract)

    by_module: dict[str, list[Any]] = {}
    for op in ops:
        if op.module and (op.transport != "ext" or op.raw.get("x-handler")):
            by_module.setdefault(op.module, []).append(op)

    files: list[StubFile] = []
    for path, mops in sorted(by_module.items()):
        transport = mops[0].transport
        handlers = [_handler_name(op) for op in mops]
        renderer = {"rest": _render_rest, "rpc": _render_rpc, "ext": _render_ext}[transport]
        files.append(
            StubFile(
                path,
                owner_of(path, owners),
                transport,
                (lambda p=path, m=mops, r=renderer: r(p, m, owner_of(p, owners), contract)),
                handlers,
            )
        )
    files.append(
        StubFile(
            "plugin/ext/auth.py",
            owner_of("plugin/ext/auth.py", owners),
            "ext-auth",
            lambda: _render_auth(owner_of("plugin/ext/auth.py", owners)),
            ["authenticate"],
        )
    )

    builds: dict[str, list[Any]] = {}
    for spec in T.BUILDS:
        builds.setdefault(spec.module, []).append(spec)
    for path, specs in sorted(builds.items()):
        files.append(
            StubFile(
                path,
                specs[0].owner,
                "build",
                (lambda p=path, s=specs: _render_build_module(p, s, root, T)),
                [s.function for s in specs],
            )
        )

    examples = {op.operation_id: op for op in ops}
    files.append(
        StubFile(
            "plugin/tools/catalog.py", "area-47", "tools", lambda: _render_tools(examples, contract)
        )
    )
    files.append(StubFile("plugin/tools/directive.py", "area-47", "directive", _render_directive))
    files.append(StubFile("plugin/commands.py", "area-commands", "command", _render_commands))
    files.append(
        StubFile(
            "plugin/blueprints.py",
            "area-blueprints",
            "blueprints",
            _render_blueprints,
        )
    )
    files.append(
        StubFile(
            "plugin/routines/maintenance.py",
            "area-maintenance",
            "script",
            _render_maintenance,
        )
    )
    files.append(
        StubFile(f"plugin/skills/{contract.plugin_id}/SKILL.md", "area-47", "skill", _render_skill)
    )

    rest = [
        (op.method, op.path, module_name(op.module), snake(op.operation_id), op.operation_id)
        for op in ops
        if op.transport == "rest"
    ]
    rpc = [
        (op.path, module_name(op.module), rpc_handler_name(op.path))
        for op in ops
        if op.transport == "rpc"
    ]
    ext = [
        (
            op.raw["x-handler"],
            module_name(op.module),
            tuple(op.raw.get("x-deps") or ()),
            op.operation_id,
        )
        for op in ops
        if op.transport == "ext" and op.raw.get("x-handler")
    ]
    return Plan(root, files, rest, rpc, ext)


def full_example(op: Any) -> Any:
    """Full envelope of the example (REST/ext: ``responses.200…example``; RPC:
    ``example.result``) — may be ``{ok: false, error}`` when the contract shows an error."""
    if op.transport == "rpc":
        return (op.raw.get("example") or {}).get("result")
    resp = (op.raw.get("responses") or {}).get("200") or {}
    return ((resp.get("content") or {}).get("application/json") or {}).get("example")


def _handler_name(op: Any) -> str:
    if op.transport == "rest":
        return snake(op.operation_id)
    if op.transport == "rpc":
        return rpc_handler_name(op.path)
    return str(op.raw["x-handler"])


# =========================================================================== render: surfaces


def _header(path: str, owner: str, what: str, extra: str = "") -> str:
    return (
        f'"""{what}.\n\nStub generated by ``scripts/gen_stubs.py``. Owner: **{owner}**.\n\n'
        "Each function returns the contract ``example`` (``@contract.stub``). When implementing:\n"
        "replace the body, keep name and signature and mark the function with ``@contract.real``\n"
        "(the surface test then validates the schema only, strictly). Signatures:\n"
        "``plugin/api/_common.py``.\n"
        f"{extra}"
        '"""\n'
    )


def _doc_line(op: Any) -> str:
    """Docstring (already quoted and indented for a function) with the operation and the contract
    summary."""
    summary = str(op.raw.get("summary") or "").strip().replace('"""', "'")
    if not summary:
        return f'"""{op.key}."""'
    body = textwrap.fill(summary, width=90, initial_indent="    ", subsequent_indent="    ")
    return f'"""{op.key}.\n\n{body}\n    """'


def _render_rest(path: str, ops: list[Any], owner: str, contract: Any) -> str:
    lines = [
        _header(path, owner, f"REST routes of ``{path}``"),
        "from __future__ import annotations",
        "",
        "from collections.abc import Mapping",
        "from typing import Any",
        "",
        "from tube_pkg.api._common import Envelope, contract",
        "",
    ]
    for op in ops:
        lines += [
            "",
            f'@contract.stub("{op.operation_id}")',
            f"def {snake(op.operation_id)}(",
            "    body: Mapping[str, Any] | None, query: Mapping[str, str]",
            ") -> Envelope:",
            f"    {_doc_line(op)}",
            f"    return {literal(full_example(op))}",
            "",
        ]
    return "\n".join(lines)


def _render_rpc(path: str, ops: list[Any], owner: str, contract: Any) -> str:
    lines = [
        _header(
            path,
            owner,
            f"RPC methods of ``{path}``",
            "\nRegistered by ``register(ctx)`` (``ctx.register_rpc``) from\n"
            "``wiring.RPC_METHODS``; they only exist in the gateway.\n",
        ),
        "from __future__ import annotations",
        "",
        "from collections.abc import Mapping",
        "from typing import Any",
        "",
        "from tube_pkg.api._common import Envelope, contract",
        "",
    ]
    for op in ops:
        lines += [
            "",
            f'@contract.stub("{op.operation_id}")',
            f"def {rpc_handler_name(op.path)}(",
            "    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any",
            ") -> Envelope:",
            f"    {_doc_line(op)}",
            f"    return {literal(full_example(op))}",
            "",
        ]
    return "\n".join(lines)


def _render_ext(path: str, ops: list[Any], owner: str, contract: Any) -> str:
    T = contract.types_mod  # noqa: N806
    lines = [
        _header(
            path,
            owner,
            f"Extension handlers of ``{path}``",
            "\nMounted by ``_mount.py`` through ``wiring.ext_handlers``; dependencies by\n"
            "name (``x-deps``). Pure functions: no ``os.environ`` and no ``get_hermes_home()``.\n",
        ),
        "from __future__ import annotations",
        "",
        "from collections.abc import Mapping",
        "from typing import Any",
        "",
        "from tube_pkg.api._common import Envelope, contract",
        "from tube_pkg.core import types as T",
        "",
    ]
    for op in ops:
        deps = list(op.raw.get("x-deps") or [])
        dep_params = ", ".join(f"{d}: T.{T.DEPENDENCY_TYPES[d][0]}" for d in deps)
        lines += [
            "",
            f'@contract.stub("{op.operation_id}")',
            f"def {op.raw['x-handler']}(",
            "    device: T.Device | None,",
            "    body: Mapping[str, Any] | None,",
            "    query: Mapping[str, str],",
            f"    *,{' ' + dep_params if dep_params else ''}",
            ") -> Envelope:",
            f"    {_doc_line(op)}",
            f"    return {literal(full_example(op))}",
            "",
        ]
    return "\n".join(lines)


def _render_auth(owner: str) -> str:
    return f'''"""Device authentication on the ``/ext/*`` routes.

Stub generated by ``scripts/gen_stubs.py``. Owner: **{owner}**.

``authenticate(authorization, origin, *, devices) -> Device`` (ext-protocol.md §9), called by
``_mount.py`` before every handler with Bearer. The stub delegates to
``_mount.bearer_authenticator`` (which uses ``DeviceAuth.verify``); while ``DeviceAuth`` is a stub,
it **refuses everything** with ``Unauthorized`` (it never accepts a token without a real pairing).
"""

from __future__ import annotations

from tube_pkg.api._common import contract
from tube_pkg.core import types as T
from tube_pkg.ext._mount import bearer_authenticator


@contract.stub("authenticate")
def authenticate(
    authorization: str | None, origin: str | None, *, devices: T.DeviceAuth
) -> T.Device:
    """``Authorization: Bearer <token>`` → ``Device``; raises ``Unauthorized``/an origin error."""
    try:
        return bearer_authenticator(devices)(authorization, origin)
    except NotImplementedError:
        raise T.Unauthorized("pairing not implemented yet") from None
'''


# =========================================================================== render: BUILDS


class _Qualify(ast.NodeTransformer):
    """``types.py`` names become ``T.<name>``; standard library names are recorded."""

    def __init__(self, types_mod: Any) -> None:
        self.types_mod = types_mod
        self.std: set[str] = set()

    def visit_Name(self, node: ast.Name) -> ast.AST:  # noqa: N802
        if node.id in STD_NAMES:
            self.std.add(node.id)
            return node
        if node.id in BUILTINS or node.id == "self":
            return node
        if hasattr(self.types_mod, node.id):
            return ast.copy_location(
                ast.Attribute(value=ast.Name(id="T", ctx=ast.Load()), attr=node.id, ctx=node.ctx),
                node,
            )
        return node


def _qualify_expr(expr: ast.AST | None, q: _Qualify) -> str | None:
    if expr is None:
        return None
    import copy

    return ast.unparse(q.visit(copy.deepcopy(expr)))


def _protocol_methods(source_tree: ast.Module, name: str) -> list[ast.FunctionDef]:
    classes = {n.name: n for n in source_tree.body if isinstance(n, ast.ClassDef)}
    out: list[ast.FunctionDef] = []
    seen: set[str] = set()

    def walk(cls_name: str) -> None:
        cls = classes.get(cls_name)
        if cls is None:
            return
        for item in cls.body:
            if isinstance(item, ast.FunctionDef) and item.name not in seen:
                seen.add(item.name)
                out.append(item)
        for base in cls.bases:
            if isinstance(base, ast.Name) and base.id != "Protocol":
                walk(base.id)

    walk(name)
    return out


def _dep_annotation(type_text: str, q: _Qualify) -> str:
    if type_text.startswith("hermes "):
        q.std.add("Any")
        return "Any"
    return _qualify_expr(ast.parse(type_text, mode="eval").body, q) or "Any"


def _render_build_module(path: str, specs: list[Any], root: Path, T: Any) -> str:  # noqa: N803
    tree = ast.parse((root / "plugin" / "core" / "types.py").read_text(encoding="utf-8"))
    q = _Qualify(T)
    stem = Path(path).stem
    body: list[str] = []
    for spec in specs:
        proto = spec.returns
        cls = f"{proto}Stub"
        body += [
            "",
            "",
            f"class {cls}:",
            f'    """Stub of ``{proto}``: every call raises ``NotImplementedError``."""',
            "",
            f'    __contract_stub__ = "{stem}"',
        ]
        for fn in _protocol_methods(tree, proto):
            is_prop = any(isinstance(d, ast.Name) and d.id == "property" for d in fn.decorator_list)
            args = _qualify_expr(fn.args, q)
            ret = _qualify_expr(fn.returns, q)
            body.append("")
            if is_prop:
                body.append("    @property")
            body.append(f"    def {fn.name}({args}){' -> ' + ret if ret else ''}:")
            if is_prop and ret == "bool":
                body.append("        return False")
            elif is_prop and ret == "str" and proto == "Lens":
                body.append("        return T.HN_LENS")
            else:
                body.append(f'        raise NotImplementedError(_stub("{proto}.{fn.name}"))')
        params = []
        for dep in spec.deps:
            params.append(f"{dep}: {_dep_annotation(T.DEPENDENCY_TYPES[dep][0], q)}")
        for opt in spec.optional:
            ann = _dep_annotation(T.DEPENDENCY_TYPES[opt][0], q)
            params.append(f"{opt}: {ann} = None" if ann == "Any" else f"{opt}: {ann} | None = None")
        body += [
            "",
            "",
            f"def {spec.function}(*, {', '.join(params)}) -> T.{proto}:",
            '    """Stub: ignores the dependencies (signature in ``BUILD_SIGNATURES``)."""',
            f"    return {cls}()",
        ]
    imports = ["from __future__ import annotations", ""]
    by_mod: dict[str, list[str]] = {}
    for name in sorted(q.std):
        by_mod.setdefault(STD_NAMES[name], []).append(name)
    for mod in sorted(by_mod):
        imports.append(f"from {mod} import {', '.join(sorted(by_mod[mod]))}")
    if by_mod:
        imports.append("")
    imports.append("from tube_pkg.core import types as T")
    head = (
        f'"""Implementation of ``{", ".join(s.returns for s in specs)}``.\n\n'
        "Stub generated by ``scripts/gen_stubs.py``. Replace the classes with the real\n"
        "implementation, keeping the ``build`` function(s) with the signature of\n"
        '``BUILD_SIGNATURES`` (by name only, no network and no thread).\n"""\n'
    )
    helper = [
        "",
        "",
        "def _stub(what: str) -> str:",
        '    return f"stub: {what} is not implemented in this version"',
    ]
    return head + "\n" + "\n".join(imports + helper + body) + "\n"


# =========================================================================== render: agent


def _tool_example(op: Any, contract: Any) -> Any:
    if op.transport == "rpc":
        return (op.raw.get("example") or {}).get("job_result", op.example_data)
    return op.example_data


TOOL_SPECS: list[tuple[str, str, dict[str, Any], str]] = [
    (
        "tube_status",
        "Counts of new YouTube videos per tab and folder, the cancellation queue and whether the "
        "browser extension is connected. Use when the user asks what is new on YouTube or for a "
        "quick overview of their subscriptions.",
        {"type": "object", "properties": {}},
        "📊",
    ),
    (
        "tube_feed",
        "Videos of one tab, folder or channel, newest first, each with why it is there. Use to "
        "answer 'what came out today', 'show my Tech folder', etc. Pass exactly one of tab, "
        "folder or channel.",
        {
            "type": "object",
            "properties": {
                "tab": {"type": "string", "description": "Tab id (e.g. all-new, favorites)."},
                "folder": {"type": "string", "description": "Folder id or name."},
                "channel": {"type": "string", "description": "Channel id (UC…) or @handle."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            },
        },
        "▶",
    ),
    (
        "tube_channels",
        "Search and filter the user's YouTube channels (folder, tag, relation, activity). Use to "
        "find a channel or answer 'why don't I see channel X anymore'.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Text to match title or handle."},
                "folder": {"type": "string"},
                "tag": {"type": "string"},
                "relation": {"type": "string", "enum": ["subscribed", "followed", "ex", "ignored"]},
                "favorite": {"type": "boolean"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
        },
        "📺",
    ),
    (
        "tube_add_channel",
        "Follow a YouTube channel by link or @handle without subscribing on YouTube (undoable). "
        "Never subscribes or unsubscribes on YouTube.",
        {
            "type": "object",
            "properties": {
                "url_or_handle": {
                    "type": "string",
                    "description": "Channel/video link, @handle or UC id.",
                },
                "folder": {"type": "string", "description": "Optional folder id or name."},
            },
            "required": ["url_or_handle"],
        },
        "➕",
    ),
    (
        "tube_organize",
        "Suggest folders and tags for channels with AI. Only creates suggestions; nothing is "
        "applied until the user accepts them in the app.",
        {
            "type": "object",
            "properties": {
                "channel_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Channels to organize; omit for channels without a folder.",
                }
            },
        },
        "🗂",
    ),
    (
        "tube_cleanup_scan",
        "Build the cleanup list (stale, ignored, off-profile channels) with reasons. Never "
        "approves or cancels anything: the user approves with /tube cleanup or in the app's "
        "Cleanup page.",
        {"type": "object", "properties": {}},
        "🧹",
    ),
    (
        "tube_theme_create",
        "Create a themed tab by researching YouTube for a topic (e.g. 'AI agents') and return a "
        "preview of the curated videos and seed channels.",
        {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 200,
                    "description": "Topic in free text.",
                }
            },
            "required": ["query"],
        },
        "🔭",
    ),
    (
        "tube_tab",
        "Create or edit a tab (category, channels or mixed) with rules over folders, tags and "
        "channels (undoable).",
        {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["create", "update"]},
                "tab_id": {"type": "string", "description": "Required for update."},
                "name": {"type": "string"},
                "icon": {"type": "string"},
                "rules": {
                    "type": "object",
                    "description": "TabRules: include, exclude, filters, mode.",
                },
            },
            "required": ["action"],
        },
        "🗃",
    ),
    (
        "tube_mark",
        "Mark videos as seen, watch later, archived or watched, or react thumbs up/down.",
        {
            "type": "object",
            "properties": {
                "video_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "state": {
                    "type": "string",
                    "enum": ["new", "seen", "later", "archived", "watched"],
                },
                "reaction": {"type": "string", "enum": ["up", "down", "none"]},
            },
            "required": ["video_ids"],
        },
        "✅",
    ),
]


def _render_tools(examples: dict[str, Any], contract: Any) -> str:
    specs = []
    funcs = []
    for name, desc, params, emoji in TOOL_SPECS:
        specs.append(
            f"    ToolSpec(\n        name={name!r},\n        description=(\n"
            + "".join(f"            {chunk!r}\n" for chunk in _chunks(desc))
            + f"        ),\n        parameters={literal(params)},\n        emoji={emoji!r},\n    ),"
        )
        example = _tool_example(examples[TOOL_EXAMPLES[name]], contract)
        funcs += [
            "",
            "",
            f'@contract.stub("{name}")',
            f"def {name}(args: Mapping[str, Any], **kwargs: Any) -> str:",
            f'    """Stub: returns the contract example of ``{TOOL_EXAMPLES[name]}``."""',
            f"    return _stub_result({name!r}, {literal(example)})",
        ]
    return (
        '''"""The agent's tools.

Stub generated by ``scripts/gen_stubs.py``. Owner: **area-47**.

``TOOLS`` is the registry read by ``register(ctx)`` (``__init__.py``): each ``ToolSpec.name`` is
also the name of this module's handler function (``handler(args, **kwargs) -> str`` JSON; never
raises).
The names must match ``provides_tools`` in ``plugin.yaml`` (``validate`` checks it).

Rules for the real implementation: themes/organise call ``Themes.create``/``Organizer.organize``
with ``TOOL_TIMEOUT_S``; ``tube_status`` calls ``Refresher.kick_if_due`` and
``wiring.ensure_ext_server(role="gateway")``; no tool approves an unsubscribe; returned videos
carry ``display`` with the directive (``directive.display(video_id)``).
Stubs return ``{"stub": true, "tool", "data": <contract example>}``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, NamedTuple

from tube_pkg.api._common import contract


class ToolSpec(NamedTuple):
    name: str
    description: str
    parameters: dict[str, Any]
    emoji: str = "▶"

    def schema(self) -> dict[str, Any]:
        """Schema for ``ctx.register_tool`` (``name``, ``description``, ``parameters``)."""
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


TOOLS: tuple[ToolSpec, ...] = (
'''
        + "\n".join(specs)
        + """
)


def _stub_result(tool: str, data: Any) -> str:
    return json.dumps({"stub": True, "tool": tool, "data": data}, ensure_ascii=False)
"""
        + "\n".join(funcs)
        + "\n"
    )


def _chunks(text: str, size: int = 80) -> Iterable[str]:
    words = text.split(" ")
    line = ""
    for word in words:
        if line and len(line) + len(word) + 1 > size:
            yield line + " "
            line = word
        else:
            line = f"{line} {word}" if line else word
    if line:
        yield line


def _render_directive() -> str:
    return '''"""Teaching the ``::tube-video`` directive.

Stub generated by ``scripts/gen_stubs.py``. Owner: **area-47**.

- main path: ``display(video_id)`` in the result of the tools that return videos (works in
  every topology);
- reinforcement: the ``pre_llm_call`` hook (``provides_hooks``), **only** on a platform that renders
  the card (Desktop). Without the filter it would leak to Telegram, where the directive becomes raw
  text. The ``platform`` value of Desktop sessions was not measured: the hook logs (INFO, once per
  value) the ``platform`` it receives, so it can be checked and ``RENDERING_PLATFORMS`` adjusted.
"""

from __future__ import annotations

import logging
import re
import threading
from typing import Any

logger = logging.getLogger(__name__)

DIRECTIVE = "tube-video"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
RENDERING_PLATFORMS: frozenset[str] = frozenset({"desktop", "gui"})
"""``platform`` of the sessions that render ``::tube-video`` (to be confirmed; CLI = ``cli``)."""

HOOK_LINES = (
    "To show a YouTube video as a card in this app, write on its own line: "
    f'::{DIRECTIVE}{{id="<11-character video id>"}}',
    "Only the id attribute; one directive per video; nothing else on that line.",
    f'Example: ::{DIRECTIVE}{{id="dQw4w9WgXcQ"}}',
)

_SEEN: set[str] = set()
_SEEN_LOCK = threading.Lock()


def display(video_id: str) -> str | None:
    """Directive line for *video_id* (``None`` if the id does not have 11 valid characters)."""
    if not isinstance(video_id, str) or not VIDEO_ID_RE.match(video_id):
        return None
    return f'::{DIRECTIVE}{{id="{video_id}"}}'


def pre_llm_call(**kwargs: Any) -> dict[str, str] | None:
    """``pre_llm_call`` hook: injects the 3 lines only on ``RENDERING_PLATFORMS``; never raises."""
    platform = str(kwargs.get("platform") or "")
    with _SEEN_LOCK:
        first = platform not in _SEEN
        _SEEN.add(platform)
    if first:
        logger.info("tube directive hook: platform=%r", platform)
    if platform not in RENDERING_PLATFORMS:
        return None
    return {"context": "\\n".join(HOOK_LINES)}
'''


def _render_commands() -> str:
    return '''"""The ``/tube`` command.

Stub generated by ``scripts/gen_stubs.py``. Owner: **area-commands**.

``register(ctx)`` registers ``NAME`` with ``handle(raw_args, ctx=ctx)`` (synchronous, so it can use
``ctx.ask_choice``). Rules for the real implementation: ``ask_choice`` only outside
``platform == "local"`` (in the Desktop the loop blocks the connection and the app re-runs the
command after 30 s); ``None`` = stop without acting; ``try/except`` returning text (an exception
becomes "unknown command"); ``faxina`` approves only with ``Cleanup.approve(ids, via=ask_choice)``.
"""

from __future__ import annotations

from typing import Any

NAME = "tube"
DESCRIPTION = "YouTube subscriptions: summary, triage, cleanup, theme tabs and routines"
ARGS_HINT = "[triar|faxina|tema <texto>|abas|status|rotinas|ajuda]"
SUBCOMMANDS = ("triar", "faxina", "tema", "abas", "status", "rotinas", "ajuda")

__contract_stub__ = "commands"


def handle(raw_args: str = "", *, ctx: Any = None) -> str:
    """Stub: answers in text without touching anything."""
    sub = (raw_args or "").strip().split(" ", 1)[0].lower()
    lines = ["/tube — still under construction (skeleton)."]
    if sub and sub not in SUBCOMMANDS:
        lines.append(f"Unknown subcommand: {sub}")
    lines.append("Subcommands: " + ", ".join(SUBCOMMANDS))
    return "\\n".join(lines)
'''


def _render_blueprints() -> str:
    return '''"""Agent routines offered as blueprints.

Stub generated by ``scripts/gen_stubs.py``. Owner: **area-blueprints**.

``BLUEPRINTS`` is read by ``register(ctx)``: each item becomes
``ctx.register_automation_blueprint(key, **fields)`` (Hermes' real validation; an error only goes
to the log). The ``no_agent`` routines (``bom-dia``, ``favoritos``) are scripts + a shim installed
by ``/tube routines`` (``RoutinesInstaller``), not blueprints. No routine approves an unsubscribe.
"""

from __future__ import annotations

from typing import Any

_TIME = {"name": "time", "type": "time", "label": "Time", "default": "19:00"}
_DELIVER = {
    "name": "deliver",
    "type": "enum",
    "label": "Deliver where?",
    "default": "origin",
    "options": ["origin", "local", "telegram"],
    "strict": False,
}

BLUEPRINTS: tuple[dict[str, Any], ...] = (
    {
        "key": "resumo-pasta",
        "title": "Summary of the new videos of a YouTube folder",
        "description": "Every day, a short summary of the new videos of a folder.",
        "category": "general",
        "schedule_template": "{minute} {hour} * * *",
        "prompt_template": (
            "Use the tube_feed tool with folder={folder} and summarise the new videos in a few "
            "lines (title + one sentence based on the description). If nothing is new, say "
            "only that."
        ),
        "slots": [
            _TIME,
            {"name": "folder", "type": "text", "label": "Folder", "default": "Tech"},
            _DELIVER,
        ],
        "deliver_default": "origin",
        "tags": ["youtube"],
    },
    {
        "key": "faxina-mensal",
        "title": "Monthly cleanup of YouTube subscriptions",
        "description": (
            "Every month, the list of stale or ignored channels — without unsubscribing anything."
        ),
        "category": "general",
        "schedule_template": "0 10 1 * *",
        "prompt_template": (
            "Use the tube_cleanup_scan tool and deliver the list by group, with the reason. Do not "
            "unsubscribe anything: end with 'use /tube cleanup to approve'."
        ),
        "slots": [_DELIVER],
        "deliver_default": "origin",
        "tags": ["youtube"],
    },
    {
        "key": "pasta-novos",
        "title": "Organize newly added YouTube channels",
        "description": (
            "Every day, folder suggestions for new channels (nothing is applied on its own)."
        ),
        "category": "general",
        "schedule_template": "{minute} {hour} * * *",
        "prompt_template": (
            "Use the tube_organize tool for the channels without a folder and summarise the "
            "suggestions. Remember that nothing is applied before it is accepted in the app."
        ),
        "slots": [{**_TIME, "default": "09:00"}, _DELIVER],
        "deliver_default": "origin",
        "tags": ["youtube"],
    },
)
'''


def _render_maintenance() -> str:
    return '''"""Maintenance script.

Stub generated by ``scripts/gen_stubs.py``. Owner: **area-maintenance**.

Installed by the ``RoutinesInstaller`` as a shim in ``<profile>/scripts/`` (fixed name in
``MAINTENANCE_SCRIPTS``) and run by the ``no_agent`` cron with a sanitised environment: only the
standard library on the path until ``_header.bootstrap``. Empty stdout = silence; exit ≠ 0 = alert.
The stub does nothing.
"""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    del argv
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
'''


def _render_skill() -> str:
    return """---
description: >-
  How to use the YouTube subscriptions tools (status, feed, channels, themes,
  cleanup). Load explicitly.
---

# YouTube subscriptions — skill (stub generated by scripts/gen_stubs.py, owner area-47)

Skeleton. The real skill says when to use each tool (`tube_status`, `tube_feed`,
`tube_channels`, `tube_add_channel`, `tube_organize`, `tube_cleanup_scan`, `tube_theme_create`,
`tube_tab`, `tube_mark`), typical phrases and the rule: never promise an unsubscribe — point to
`/tube cleanup` or the app's Cleanup page.
"""


# =========================================================================== wiring


def render_tables(plan: Plan) -> str:
    lines = [
        f"{BEGIN} (generated by scripts/gen_stubs.py from the contract; do not edit) >>>",
        "REST_ROUTES: tuple[RestRoute, ...] = (",
    ]
    lines += [f"    RestRoute{r!r}," for r in plan.rest]
    lines += [")", "RPC_METHODS: tuple[RpcMethod, ...] = ("]
    lines += [f"    RpcMethod{r!r}," for r in plan.rpc]
    lines += [")", "EXT_HANDLERS: tuple[ExtHandlerSpec, ...] = ("]
    lines += [f"    ExtHandlerSpec{r!r}," for r in plan.ext]
    lines += [")", END]
    return "\n".join(lines)


def _replace_tables(text: str, block: str) -> str:
    start = text.find(BEGIN)
    end = text.find(END)
    if start < 0 or end < 0 or end < start:
        raise RuntimeError(f"{WIRING}: markers {BEGIN!r}/{END!r} missing")
    return text[:start] + block + text[end + len(END) :]


def read_tables(path: Path) -> dict[str, list[tuple[Any, ...]]]:
    """Values of the tables in ``wiring.py`` (through the AST; formatting does not matter)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: dict[str, list[tuple[Any, ...]]] = {}
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name = node.target.id
            if name in ("REST_ROUTES", "RPC_METHODS", "EXT_HANDLERS") and isinstance(
                node.value, ast.Tuple
            ):
                out[name] = [
                    tuple(ast.literal_eval(a) for a in call.args)
                    for call in node.value.elts
                    if isinstance(call, ast.Call)
                ]
    return out


def _tables_problems(plan: Plan) -> list[str]:
    path = plan.root / WIRING
    if not path.is_file():
        return [f"{WIRING} missing"]
    found = read_tables(path)
    expected = {"REST_ROUTES": plan.rest, "RPC_METHODS": plan.rpc, "EXT_HANDLERS": plan.ext}
    problems = []
    for name, rows in expected.items():
        if found.get(name) != [tuple(r) for r in rows]:
            problems.append(f"{WIRING}: {name} stale (run scripts/gen_stubs.py)")
    return problems


# =========================================================================== running


def _defined_functions(path: Path) -> set[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return set()
    names = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
    for node in tree.body:  # also accepts an assignment (e.g. get_state = _impl)
        if isinstance(node, ast.Assign):
            names |= {t.id for t in node.targets if isinstance(t, ast.Name)}
    return names


def run_check(root: Path | str = ROOT_DEFAULT) -> list[str]:
    plan = build_plan(Path(root).resolve())
    problems = []
    for f in plan.files:
        path = plan.root / f.path
        if not path.is_file():
            problems.append(f"{f.path}: missing (owner {f.owner}; run scripts/gen_stubs.py)")
            continue
        if f.path.endswith(".py"):
            missing = [h for h in f.handlers if h not in _defined_functions(path)]
            if missing:
                problems.append(f"{f.path}: missing function: {', '.join(missing)}")
    problems += _tables_problems(plan)
    return problems


def _ruff_format(paths: list[Path]) -> None:
    py = [str(p) for p in paths if p.suffix == ".py"]
    if not py:
        return
    for args in (["check", "--fix", "--quiet", "--select", "I,F401,UP"], ["format", "--quiet"]):
        try:
            subprocess.run([sys.executable, "-m", "ruff", *args, *py], check=False)
        except OSError:
            return


def generate(root: Path | str = ROOT_DEFAULT) -> tuple[list[str], list[str]]:
    """Generate the missing stubs and rewrite the wiring tables. ``(created, skipped)``."""
    plan = build_plan(Path(root).resolve())
    created: list[str] = []
    skipped: list[str] = []
    written: list[Path] = []
    for f in plan.files:
        path = plan.root / f.path
        if path.exists():
            skipped.append(f.path)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f.render(), encoding="utf-8")
        created.append(f.path)
        written.append(path)
    wiring = plan.root / WIRING
    if wiring.is_file():
        text = wiring.read_text(encoding="utf-8")
        new = _replace_tables(text, render_tables(plan))
        if new != text:
            wiring.write_text(new, encoding="utf-8")
            written.append(wiring)
    _ruff_format(written)
    return created, skipped


def listing(root: Path | str = ROOT_DEFAULT) -> list[str]:
    plan = build_plan(Path(root).resolve())
    out = []
    for f in sorted(plan.files, key=lambda f: (f.owner, f.path)):
        path = plan.root / f.path
        if not path.exists():
            state = "missing"
        else:
            text = path.read_text(encoding="utf-8")
            head = text[:400]
            state = "stub" if ("gen_stubs.py" in head or "stub generated" in head) else "real"
        out.append(f"{f.owner:6} {state:8} {f.path}")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--root", default=str(ROOT_DEFAULT))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args(argv)
    if args.list:
        print("\n".join(listing(args.root)))
        return 0
    if args.check:
        problems = run_check(args.root)
        for p in problems:
            print(p)
        print("gen_stubs --check: " + ("OK" if not problems else f"{len(problems)} problem(s)"))
        return 1 if problems else 0
    created, skipped = generate(args.root)
    for path in created:
        print(f"created  {path}")
    print(f"gen_stubs: {len(created)} created, {len(skipped)} already there")
    problems = run_check(args.root)
    for p in problems:
        print(p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
