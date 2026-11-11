#!/usr/bin/env python3
"""Generator and checker of the surface contract.

Sources:
- ``plugin/core/types.py`` → ``shared/domain.schema.json`` (JSON Schema 2020-12 of every
  dataclass/enum, in the shape ``to_jsonable`` produces)
- ``contract/api.yaml`` (OpenAPI 3.1: routes of ``plugin_api`` and of the extension's own server),
  ``contract/rpc.yaml`` (RPC methods and events, format ``tube-rpc/1``), ``contract/owners.yaml``

Generated outputs (committed): ``shared/domain.schema.json`` and ``shared/api-types.ts``.

    python scripts/gen_types.py                regenerates both files and validates the contract
    python scripts/gen_types.py --check        checks only; exits 1 on a problem or a difference
    python scripts/gen_types.py --root <dir>   works on another tree (tests)

``--check`` fails on: a route/method without ``x-module``/``x-unit``; a module without an owner in
``owners.yaml`` (or owner ≠ ``x-unit``); a broken ``$ref``; an invalid schema; an undeclared error
code; an example that does not validate; events ≠ ``EVENT_NAMES``; ``shared/ids.ts`` with a
``PLUGIN_ID`` other than ``plugin/_id.py``'s; a stale generated file.

Also a library (``gen_stubs.py`` and ``test_contract_surface.py`` load it by path):
``load_contract(root)``, ``iter_operations(contract)``, ``data_schema_resolved(contract, op_id)``,
``validate_instance(schema, instance, root)``, ``domain_ref(name)``, ``run_check(root)``.
"""

from __future__ import annotations

import argparse
import ast
import collections.abc
import dataclasses
import enum
import importlib
import importlib.util
import json
import posixpath
import re
import sys
import types as pytypes
import typing
from pathlib import Path
from typing import Any

import jsonschema
import yaml

ROOT_DEFAULT = Path(__file__).resolve().parents[1]

API_DOC = "contract/api.yaml"
RPC_DOC = "contract/rpc.yaml"
OWNERS_DOC = "contract/owners.yaml"
DOMAIN_DOC = "shared/domain.schema.json"
TS_OUT = "shared/api-types.ts"
IDS_TS = "shared/ids.ts"
ID_PY = "plugin/_id.py"
TYPES_PY = "plugin/core/types.py"

DOMAIN_REF_PREFIX = "../shared/domain.schema.json#/$defs/"
"""``$ref`` prefix for domain types from ``contract/*.yaml``."""

HTTP_METHODS = ("get", "post", "put", "patch", "delete")
TRANSPORT_PREFIX = {"rest": "plugin/api/", "ext": "plugin/ext/", "rpc": "plugin/rpc/"}

# types.py dataclasses that do not become a schema (internal, with UNSET or bytes)
DOMAIN_EXCLUDED = frozenset(
    {
        "ChannelPatch",
        "TabPatch",
        "ChannelFilter",
        "HttpResponse",
        "ExecResult",
        "BuildSpec",
        "UndoTargets",
    }
)
DOMAIN_EXCLUDED_BASES = ("UndoData",)  # UndoData subclasses: only the generic type
# input only: ``required`` = fields without a default
DOMAIN_INPUT_ONLY = frozenset(
    {"ChannelIn", "WatchEvent", "OrganizeEdit", "ThemeSaveEdits", "ReadScope", "SubscriptionBatch"}
)
# input and output: they also get a ``<Name>Input`` variant (fields with a default are optional)
DOMAIN_INPUT_VARIANTS = ("TabRules", "RuleInclude", "RuleExclude", "RuleFilters")

_DATA_KEYS = frozenset({"example", "examples", "const", "enum", "default", "x-example-error"})


# =========================================================================== loading


class ContractError(Exception):
    pass


@dataclasses.dataclass
class Contract:
    root: Path
    api: dict[str, Any]
    rpc: dict[str, Any]
    owners: dict[str, Any]
    domain: dict[str, Any]
    """Domain schema **derived now** from ``types.py`` (not the file on disk)."""
    types_mod: Any
    plugin_id: str

    @property
    def docs(self) -> dict[str, Any]:
        return {API_DOC: self.api, RPC_DOC: self.rpc, DOMAIN_DOC: self.domain}


_CACHE: dict[str, Contract] = {}


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ContractError(f"{path}: file missing")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ContractError(f"{path}: expected a YAML mapping")
    return data


def read_plugin_id(root: Path) -> str:
    text = (root / ID_PY).read_text(encoding="utf-8")
    m = re.search(r"""^PLUGIN_ID\s*=\s*["']([^"']+)["']""", text, re.MULTILINE)
    if not m:
        raise ContractError(f"{ID_PY}: PLUGIN_ID not found")
    return m.group(1)


def load_types(root: Path) -> Any:
    """``tube_pkg.core.types`` of the *root* tree (through ``plugin/_bootstrap.py``)."""
    plugin_dir = (root / "plugin").resolve()
    existing = sys.modules.get("tube_pkg")
    if existing is not None:
        paths = [Path(p).resolve() for p in getattr(existing, "__path__", [])]
        if plugin_dir not in paths:
            raise ContractError(
                f"tube_pkg already points to {paths}; run the generator in a process of its own"
                f" for {root}"
            )
    else:
        spec = importlib.util.spec_from_file_location(
            "_tube_bootstrap_gen_types", plugin_dir / "_bootstrap.py"
        )
        if spec is None or spec.loader is None:
            raise ContractError("plugin/_bootstrap.py missing")
        boot = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(boot)
        boot.ensure()
    return importlib.import_module("tube_pkg.core.types")


def load_contract(root: Path | str = ROOT_DEFAULT, *, fresh: bool = False) -> Contract:
    root = Path(root).resolve()
    key = str(root)
    if not fresh and key in _CACHE:
        return _CACHE[key]
    types_mod = load_types(root)
    contract = Contract(
        root=root,
        api=_read_yaml(root / API_DOC),
        rpc=_read_yaml(root / RPC_DOC),
        owners=_read_yaml(root / OWNERS_DOC),
        domain=build_domain_schema(types_mod, root),
        types_mod=types_mod,
        plugin_id=read_plugin_id(root),
    )
    _CACHE[key] = contract
    return contract


# =========================================================================== domain


def _field_docs(source: str) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """Class and field docstrings (the string right after the field) of ``types.py``."""
    tree = ast.parse(source)
    class_docs: dict[str, str] = {}
    field_docs: dict[str, dict[str, str]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        doc = ast.get_docstring(node)
        if doc:
            class_docs[node.name] = doc
        fd: dict[str, str] = {}
        body = node.body
        for i, stmt in enumerate(body):
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                nxt = body[i + 1] if i + 1 < len(body) else None
                if (
                    isinstance(nxt, ast.Expr)
                    and isinstance(nxt.value, ast.Constant)
                    and isinstance(nxt.value.value, str)
                ):
                    fd[stmt.target.id] = nxt.value.value.strip()
        field_docs[node.name] = fd
    return class_docs, field_docs


def _clean_doc(text: str) -> str:
    text = re.sub(r"``([^`]+)``", r"`\1`", text)
    return " ".join(text.split())


def _domain_classes(types_mod: Any) -> tuple[list[type], list[type]]:
    dcs: list[type] = []
    enums: list[type] = []
    base = getattr(types_mod, DOMAIN_EXCLUDED_BASES[0])
    for name, obj in vars(types_mod).items():
        if not isinstance(obj, type) or obj.__module__ != types_mod.__name__:
            continue
        if name.startswith("_"):
            continue
        if issubclass(obj, enum.Enum):
            enums.append(obj)
        elif dataclasses.is_dataclass(obj):
            if name in DOMAIN_EXCLUDED:
                continue
            if obj is not base and issubclass(obj, base):
                continue
            dcs.append(obj)
    return dcs, enums


def _nullable(schema: dict[str, Any]) -> dict[str, Any]:
    t = schema.get("type")
    if isinstance(t, str) and set(schema) <= {"type", "description"}:
        return {**schema, "type": [t, "null"]}
    return {"anyOf": [schema, {"type": "null"}]}


def _type_schema(tp: Any, raw: str, types_mod: Any, input_mode: bool) -> dict[str, Any]:
    raw = raw.strip()
    if raw == "Timestamp":
        return {"$ref": "#/$defs/Timestamp"}
    if tp is Any:
        return {}
    if tp is type(None):
        return {"type": "null"}
    if tp is bool:
        return {"type": "boolean"}
    if tp is int:
        return {"type": "integer"}
    if tp is float:
        return {"type": "number"}
    if tp is str or tp is bytes:
        return {"type": "string"}
    if isinstance(tp, type) and issubclass(tp, enum.Enum):
        return {"$ref": f"#/$defs/{tp.__name__}"}
    if isinstance(tp, type) and dataclasses.is_dataclass(tp):
        name = tp.__name__
        if input_mode and name in DOMAIN_INPUT_VARIANTS:
            name = f"{name}Input"
        return {"$ref": f"#/$defs/{name}"}
    origin = typing.get_origin(tp)
    args = typing.get_args(tp)
    if origin in (typing.Union, pytypes.UnionType):
        parts = [a for a in args if a is not type(None)]
        raw_parts = [p.strip() for p in raw.split("|")] if "|" in raw else []
        raw_parts = [p for p in raw_parts if p != "None"]
        subs = []
        for i, a in enumerate(parts):
            sub_raw = raw_parts[i] if i < len(raw_parts) else ""
            subs.append(_type_schema(a, sub_raw, types_mod, input_mode))
        base: dict[str, Any] = subs[0] if len(subs) == 1 else {"anyOf": subs}
        return _nullable(base) if len(parts) < len(args) else base
    if origin is typing.Literal:
        return {"enum": list(args)}
    if origin in (tuple, list, collections.abc.Sequence, set, frozenset):
        if origin is tuple and not (len(args) == 2 and args[1] is Ellipsis):
            return {"type": "array"}
        item = args[0] if args else Any
        inner_raw = ""
        m = re.match(r"^(?:tuple|list|Sequence)\[(.+?)(?:, \.\.\.)?\]$", raw)
        if m:
            inner_raw = m.group(1)
        return {"type": "array", "items": _type_schema(item, inner_raw, types_mod, input_mode)}
    if origin in (dict, collections.abc.Mapping):
        val = args[1] if len(args) == 2 else Any
        inner_raw = ""
        m = re.match(r"^(?:dict|Mapping)\[str, (.+)\]$", raw)
        if m:
            inner_raw = m.group(1)
        return {
            "type": "object",
            "additionalProperties": _type_schema(val, inner_raw, types_mod, input_mode),
        }
    if callable(tp):
        raise ContractError(f"type not serialisable to JSON: {tp!r}")
    return {}


def _dataclass_schema(
    cls: type,
    types_mod: Any,
    class_docs: dict[str, str],
    field_docs: dict[str, dict[str, str]],
    *,
    input_mode: bool,
) -> dict[str, Any]:
    hints = typing.get_type_hints(cls, globalns=vars(types_mod))
    raw_ann = {}
    for klass in reversed(cls.__mro__):
        raw_ann.update(getattr(klass, "__annotations__", {}))
    props: dict[str, Any] = {}
    required: list[str] = []
    docs = field_docs.get(cls.__name__, {})
    for f in dataclasses.fields(cls):
        raw = raw_ann.get(f.name, "")
        sch = _type_schema(
            hints[f.name], raw if isinstance(raw, str) else "", types_mod, input_mode
        )
        if f.name in docs:
            sch = {**sch, "description": _clean_doc(docs[f.name])}
        props[f.name] = sch
        has_default = (
            f.default is not dataclasses.MISSING or f.default_factory is not dataclasses.MISSING
        )
        # output field added later (additive): ``field(..., metadata={"optional": True})`` comes
        # out optional in the schema/TS — an old client that builds the object stays valid
        optional_out = has_default and bool(f.metadata.get("optional"))
        if (not input_mode and not optional_out) or not has_default:
            required.append(f.name)
    out: dict[str, Any] = {"type": "object"}
    if cls.__name__ in class_docs:
        out["description"] = _clean_doc(class_docs[cls.__name__])
    out["properties"] = props
    out["required"] = required
    return out


def build_domain_schema(types_mod: Any, root: Path) -> dict[str, Any]:
    source = (root / TYPES_PY).read_text(encoding="utf-8")
    class_docs, field_docs = _field_docs(source)
    dcs, enums = _domain_classes(types_mod)
    defs: dict[str, Any] = {
        "Timestamp": {
            "type": "integer",
            "description": "Seconds since the Unix epoch, UTC.",
        }
    }
    for e in enums:
        sch: dict[str, Any] = {"type": "string", "enum": [m.value for m in list(e)]}  # type: ignore[call-overload]
        if e.__name__ in class_docs:
            sch = {"description": _clean_doc(class_docs[e.__name__]), **sch}
        defs[e.__name__] = sch
    for cls in dcs:
        name = cls.__name__
        if name == DOMAIN_EXCLUDED_BASES[0]:
            defs[name] = {
                "type": "object",
                "description": "Undo data (`changes.undo`); its shape depends on `action` "
                "(`UNDO_TYPES` in types.py). Opaque to the interface.",
            }
            continue
        input_only = name in DOMAIN_INPUT_ONLY
        defs[name] = _dataclass_schema(
            cls, types_mod, class_docs, field_docs, input_mode=input_only
        )
        if name in DOMAIN_INPUT_VARIANTS:
            sch = _dataclass_schema(cls, types_mod, class_docs, field_docs, input_mode=True)
            sch["description"] = (
                f"Input of `{name}`: fields with a default are optional. "
                + sch.get("description", "")
            ).strip()
            defs[f"{name}Input"] = sch
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$comment": "GENERATED by scripts/gen_types.py from plugin/core/types.py — do not edit.",
        "title": "Domain types (to_jsonable)",
        "$defs": defs,
    }


def domain_ref(name: str) -> dict[str, str]:
    """``$ref`` (relative to ``contract/``) to a domain type."""
    return {"$ref": DOMAIN_REF_PREFIX + name}


# =========================================================================== $ref


def _unescape(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def resolve_ref(contract: Contract, ref: str, current: str) -> tuple[str, Any]:
    """``(document, node)`` that *ref* points to from the document *current*."""
    file_part, _, pointer = ref.partition("#")
    if file_part:
        doc_name = posixpath.normpath(posixpath.join(posixpath.dirname(current), file_part))
    else:
        doc_name = current
    docs = contract.docs
    if doc_name not in docs:
        raise ContractError(f"$ref to an unknown document: {ref} (in {current})")
    node: Any = docs[doc_name]
    if pointer:
        for token in pointer.lstrip("/").split("/"):
            token = _unescape(token)
            if isinstance(node, dict) and token in node:
                node = node[token]
            elif isinstance(node, list) and token.isdigit() and int(token) < len(node):
                node = node[int(token)]
            else:
                raise ContractError(f"broken $ref: {ref} (in {current})")
    return doc_name, node


def deref(contract: Contract, node: Any, current: str, _depth: int = 0) -> Any:
    """Schema with every ``$ref`` inlined (the contract has no cycles)."""
    if _depth > 60:
        raise ContractError("$ref nesting too deep (cycle?)")
    if isinstance(node, list):
        return [deref(contract, v, current, _depth + 1) for v in node]
    if not isinstance(node, dict):
        return node
    if "$ref" in node and isinstance(node["$ref"], str):
        doc, target = resolve_ref(contract, node["$ref"], current)
        inner = deref(contract, target, doc, _depth + 1)
        rest = {k: v for k, v in node.items() if k not in ("$ref", "description")}
        if not rest:
            return inner
        return {"allOf": [inner, deref(contract, rest, current, _depth + 1)]}
    out: dict[str, Any] = {}
    for k, v in node.items():
        if k in _DATA_KEYS or k.startswith("x-"):
            out[k] = v
        elif k == "properties" and isinstance(v, dict):
            out[k] = {pk: deref(contract, pv, current, _depth + 1) for pk, pv in v.items()}
        else:
            out[k] = deref(contract, v, current, _depth + 1)
    return out


def _iter_refs(node: Any, path: str = ""):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "$ref" and isinstance(v, str):
                yield path, v
            elif k in _DATA_KEYS:
                continue
            else:
                yield from _iter_refs(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _iter_refs(v, f"{path}/{i}")


def check_refs(contract: Contract) -> list[str]:
    problems: list[str] = []
    for doc_name, doc in contract.docs.items():
        for where, ref in _iter_refs(doc):
            try:
                resolve_ref(contract, ref, doc_name)
            except ContractError as exc:
                problems.append(f"{doc_name}{where}: {exc}")
    return problems


# ====================================================================== instance validation


def _merge_all_of(schema: dict[str, Any]) -> dict[str, Any]:
    parts = schema.get("allOf")
    if not isinstance(parts, list):
        return schema
    if not all(isinstance(p, dict) and ("properties" in p or "required" in p) for p in parts):
        return schema
    if any(set(p) - {"type", "properties", "required", "description", "title"} for p in parts):
        return schema
    merged: dict[str, Any] = {"type": "object", "properties": {}, "required": []}
    for p in parts:
        merged["properties"].update(p.get("properties", {}))
        for r in p.get("required", []):
            if r not in merged["required"]:
                merged["required"].append(r)
    rest = {k: v for k, v in schema.items() if k != "allOf"}
    merged["properties"].update(rest.pop("properties", {}))
    for r in rest.pop("required", []):
        if r not in merged["required"]:
            merged["required"].append(r)
    rest.pop("type", None)
    merged.update({k: v for k, v in rest.items() if k not in ("description", "title")})
    return merged


def close_schema(node: Any) -> Any:
    """Strict version (objects with ``properties`` do not accept unknown keys) to check
    examples. The contract itself stays open (additive evolution)."""
    if isinstance(node, list):
        return [close_schema(v) for v in node]
    if not isinstance(node, dict):
        return node
    node = _merge_all_of(node)
    out: dict[str, Any] = {}
    for k, v in node.items():
        if k in _DATA_KEYS or k.startswith("x-"):
            out[k] = v
        elif k == "properties" and isinstance(v, dict):
            out[k] = {pk: close_schema(pv) for pk, pv in v.items()}
        else:
            out[k] = close_schema(v)
    if "properties" in out and "additionalProperties" not in out and "allOf" not in out:
        out["additionalProperties"] = False
    return out


def validate_instance(
    schema: dict[str, Any],
    instance: Any,
    root: Path | str = ROOT_DEFAULT,
    *,
    current: str = API_DOC,
    strict: bool = True,
) -> None:
    """Validate *instance* against *schema* (may hold ``$ref``s relative to *current*); raises
    ``jsonschema.ValidationError``."""
    contract = load_contract(root)
    resolved = deref(contract, schema, current)
    if strict:
        resolved = close_schema(resolved)
    jsonschema.Draft202012Validator(resolved).validate(instance)


def _errors_for(schema: Any, instance: Any) -> list[str]:
    v = jsonschema.Draft202012Validator(schema)
    out = []
    for e in sorted(v.iter_errors(instance), key=lambda e: list(e.path)):
        loc = "/".join(str(p) for p in e.absolute_path)
        out.append(f"{loc or '<root>'}: {e.message[:200]}")
    return out


def collect_properties(schema: Any) -> set[str]:
    """Property names of an already resolved schema (goes through ``allOf``)."""
    found: set[str] = set()
    if isinstance(schema, dict):
        found |= set(schema.get("properties", {}))
        for key in ("allOf", "anyOf", "oneOf"):
            for part in schema.get(key, []) or []:
                found |= collect_properties(part)
    return found


# =========================================================================== operations


@dataclasses.dataclass
class Operation:
    transport: str
    """``rest`` (plugin_api), ``ext`` (the extension's own server) or ``rpc``."""
    method: str
    """Upper-case HTTP verb, or ``RPC``."""
    path: str
    """Path (REST/ext) or short name of the RPC method (``organize.run``)."""
    operation_id: str
    module: str | None
    unit: str | None
    errors: list[str]
    data_schema: Any
    body_schema: Any
    example_data: Any
    example_error: Any
    example_body: Any
    raw: dict[str, Any]
    doc: str

    @property
    def key(self) -> str:
        return self.path if self.transport == "rpc" else f"{self.method} {self.path}"


def _api_transport(api: dict[str, Any], path_item: dict[str, Any], op: dict[str, Any]) -> str:
    t = op.get("x-transport") or path_item.get("x-transport") or "rest"
    return str(t)


def iter_operations(contract: Contract):
    api = contract.api
    for path, item in (api.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for method in HTTP_METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            body = None
            example_body = None
            rb = op.get("requestBody")
            if isinstance(rb, dict):
                media = (rb.get("content") or {}).get("application/json") or {}
                body = media.get("schema")
                example_body = media.get("example")
            example = None
            resp = (op.get("responses") or {}).get("200") or {}
            media = (resp.get("content") or {}).get("application/json") or {}
            example = media.get("example")
            ex_data = (
                example.get("data") if isinstance(example, dict) and example.get("ok") else None
            )
            ex_err = op.get("x-example-error")
            if isinstance(example, dict) and example.get("ok") is False:
                ex_err = example
            yield Operation(
                transport=_api_transport(api, item, op),
                method=method.upper(),
                path=path,
                operation_id=str(op.get("operationId", "")),
                module=op.get("x-module"),
                unit=op.get("x-unit"),
                errors=list(op.get("x-errors") or []),
                data_schema=op.get("x-data"),
                body_schema=body,
                example_data=ex_data,
                example_error=ex_err,
                example_body=example_body,
                raw=op,
                doc=API_DOC,
            )
    for name, m in (contract.rpc.get("methods") or {}).items():
        ex = m.get("example") or {}
        result = ex.get("result") if isinstance(ex, dict) else None
        ex_data = result.get("data") if isinstance(result, dict) and result.get("ok") else None
        ex_err = result if isinstance(result, dict) and result.get("ok") is False else None
        yield Operation(
            transport="rpc",
            method="RPC",
            path=name,
            operation_id=name,
            module=m.get("x-module"),
            unit=m.get("x-unit"),
            errors=list(m.get("errors") or []),
            data_schema=m.get("result"),
            body_schema=m.get("params"),
            example_data=ex_data,
            example_error=ex_err,
            example_body=ex.get("params") if isinstance(ex, dict) else None,
            raw=m,
            doc=RPC_DOC,
        )


def get_operation(contract: Contract, operation_id: str) -> Operation:
    for op in iter_operations(contract):
        if op.operation_id == operation_id:
            return op
    raise KeyError(operation_id)


def data_schema_resolved(contract: Contract, operation_id: str) -> Any:
    op = get_operation(contract, operation_id)
    return deref(contract, op.data_schema, op.doc)


# =========================================================================== meta-validation

_OPENAPI_PARAM_IN = {"path", "query", "header", "cookie"}


def validate_openapi(api: dict[str, Any]) -> list[str]:
    """Structural OpenAPI 3.1 check (no external validator in the venv) + project rules."""
    p: list[str] = []
    if not str(api.get("openapi", "")).startswith("3.1."):
        p.append("api.yaml: openapi must be 3.1.x")
    info = api.get("info") or {}
    if not info.get("title") or not info.get("version"):
        p.append("api.yaml: info.title and info.version are required")
    if not isinstance(api.get("paths"), dict):
        p.append("api.yaml: paths missing")
        return p
    schemes = ((api.get("components") or {}).get("securitySchemes")) or {}
    dt = schemes.get("deviceToken") or {}
    if dt.get("type") != "http" or dt.get("scheme") != "bearer":
        p.append("api.yaml: components.securitySchemes.deviceToken must be http/bearer")
    seen_ids: set[str] = set()
    for path, item in api["paths"].items():
        if not path.startswith("/"):
            p.append(f"{path}: path must start with /")
        if not isinstance(item, dict):
            p.append(f"{path}: invalid path item")
            continue
        transport = item.get("x-transport", "rest")
        if transport not in ("rest", "ext"):
            p.append(f"{path}: unknown x-transport {transport!r}")
        if transport == "ext" and not item.get("servers"):
            p.append(f"{path}: an extension route needs servers (own server)")
        templ = set(re.findall(r"\{([^}]+)\}", path))
        for method, op in item.items():
            if method in ("servers", "parameters", "summary", "description") or method.startswith(
                "x-"
            ):
                continue
            if method not in HTTP_METHODS:
                p.append(f"{path}: unknown method {method}")
                continue
            where = f"{method.upper()} {path}"
            if not isinstance(op, dict):
                p.append(f"{where}: invalid operation")
                continue
            oid = op.get("operationId")
            if not oid:
                p.append(f"{where}: no operationId")
            elif oid in seen_ids:
                p.append(f"{where}: repeated operationId {oid}")
            else:
                seen_ids.add(oid)
            if not op.get("x-module"):
                p.append(f"{where}: no x-module")
            if not op.get("x-unit"):
                p.append(f"{where}: no x-unit")
            if "x-data" not in op:
                p.append(f"{where}: no x-data (schema of the envelope's `data`)")
            responses = op.get("responses")
            if not isinstance(responses, dict) or not responses:
                p.append(f"{where}: no responses")
            else:
                for code, r in responses.items():
                    if not (re.fullmatch(r"[1-5]\d\d", str(code)) or code == "default"):
                        p.append(f"{where}: invalid response code {code}")
                    if not isinstance(r, dict) or not r.get("description"):
                        p.append(f"{where}: response {code} without description")
            declared: set[str] = set()
            for prm in op.get("parameters") or []:
                if not isinstance(prm, dict) or not prm.get("name") or "schema" not in prm:
                    p.append(f"{where}: parameter without name/schema")
                    continue
                if prm.get("in") not in _OPENAPI_PARAM_IN:
                    p.append(f"{where}: parameter {prm.get('name')} with an invalid `in`")
                if prm.get("in") == "path":
                    declared.add(prm["name"])
                    if prm.get("required") is not True:
                        p.append(f"{where}: path parameter {prm['name']} without required")
            if templ != declared:
                p.append(f"{where}: path parameters {sorted(templ)} ≠ {sorted(declared)}")
            rb = op.get("requestBody")
            if rb is not None and not (isinstance(rb, dict) and rb.get("content")):
                p.append(f"{where}: requestBody without content")
            if transport == "ext" and "security" not in op:
                p.append(f"{where}: extension route without an explicit `security`")
    return p


RPC_META: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["format", "info", "methods", "events"],
    "properties": {
        "format": {"const": "tube-rpc/1"},
        "info": {"type": "object", "required": ["title", "version"]},
        "components": {
            "type": "object",
            "properties": {"schemas": {"type": "object"}},
        },
        "methods": {
            "type": "object",
            "propertyNames": {"pattern": r"^[a-z_]+\.[a-z_]+$"},
            "additionalProperties": {
                "type": "object",
                "required": [
                    "summary",
                    "x-module",
                    "x-unit",
                    "kind",
                    "params",
                    "result",
                    "errors",
                    "fallback",
                    "example",
                ],
                "properties": {
                    "summary": {"type": "string"},
                    "description": {"type": "string"},
                    "x-module": {"type": "string", "pattern": r"^plugin/rpc/[a-z_]+\.py$"},
                    "x-unit": {"type": "string"},
                    "kind": {"enum": ["job", "direct"]},
                    "job_kind": {"type": "string"},
                    "events": {"type": "array", "items": {"type": "string"}},
                    "emits": {"type": "array", "items": {"type": "string"}},
                    "approved_via": {"type": "string"},
                    "params": {"type": "object"},
                    "result": {"type": "object"},
                    "job_result": {"type": "object"},
                    "errors": {"type": "array", "items": {"type": "string"}},
                    "fallback": {
                        "oneOf": [
                            {
                                "type": "object",
                                "required": ["rest"],
                                "properties": {"rest": {"type": "string"}},
                                "additionalProperties": False,
                            },
                            {
                                "type": "object",
                                "required": ["message"],
                                "properties": {"message": {"type": "string"}},
                                "additionalProperties": False,
                            },
                        ]
                    },
                    "example": {
                        "type": "object",
                        "required": ["params", "result"],
                        "properties": {
                            "params": {},
                            "result": {"type": "object"},
                            "job_result": {},
                        },
                        "additionalProperties": False,
                    },
                },
                "additionalProperties": False,
            },
        },
        "events": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "required": ["summary", "payload", "emitters", "example"],
                "properties": {
                    "summary": {"type": "string"},
                    "payload": {"type": "object"},
                    "emitters": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                    "example": {},
                },
                "additionalProperties": False,
            },
        },
    },
}


def validate_rpc(rpc: dict[str, Any]) -> list[str]:
    errs = _errors_for(RPC_META, rpc)
    p = [f"rpc.yaml: {e}" for e in errs]
    for name, m in (rpc.get("methods") or {}).items():
        if not isinstance(m, dict):
            continue
        if m.get("kind") == "job":
            for key in ("job_kind", "job_result", "events"):
                if key not in m:
                    p.append(f"rpc.yaml: {name}: job method without {key}")
        if m.get("kind") == "direct" and "job_kind" in m:
            p.append(f"rpc.yaml: {name}: direct method with job_kind")
    return p


def iter_schemas(contract: Contract):
    """``(where, schema)`` of every schema of the contract (for ``check_schema``)."""
    for name, sch in (contract.domain.get("$defs") or {}).items():
        yield f"{DOMAIN_DOC}#/$defs/{name}", sch
    for doc_name, doc in ((API_DOC, contract.api), (RPC_DOC, contract.rpc)):
        for name, sch in ((doc.get("components") or {}).get("schemas") or {}).items():
            yield f"{doc_name}#/components/schemas/{name}", sch
    for op in iter_operations(contract):
        if op.data_schema is not None:
            yield f"{op.key} data", op.data_schema
        if op.body_schema is not None:
            yield f"{op.key} body", op.body_schema
        for prm in op.raw.get("parameters") or []:
            if isinstance(prm, dict) and "schema" in prm:
                yield f"{op.key} param {prm.get('name')}", prm["schema"]
        if op.transport == "rpc" and "job_result" in op.raw:
            yield f"{op.key} job_result", op.raw["job_result"]
    for name, ev in (contract.rpc.get("events") or {}).items():
        if isinstance(ev, dict) and "payload" in ev:
            yield f"event {name}", ev["payload"]


def _check_schema_validity(contract: Contract) -> list[str]:
    p = []
    for where, sch in iter_schemas(contract):
        try:
            jsonschema.Draft202012Validator.check_schema(sch)
        except jsonschema.SchemaError as exc:
            p.append(f"{where}: invalid schema: {exc.message[:200]}")
    return p


# =========================================================================== project rules


def check_owners(contract: Contract) -> list[str]:
    p: list[str] = []
    owners = contract.owners
    modules = owners.get("modules") or {}
    units = set(owners.get("units") or [])
    for module, unit in modules.items():
        if unit not in units:
            p.append(f"owners.yaml: {module}: unknown owner {unit!r}")
    for op in iter_operations(contract):
        if not op.module:
            p.append(f"{op.key}: no x-module")
            continue
        if not op.unit:
            p.append(f"{op.key}: no x-unit")
        prefix = TRANSPORT_PREFIX[op.transport]
        if not str(op.module).startswith(prefix):
            p.append(f"{op.key}: x-module {op.module} outside {prefix}")
        if op.module not in modules:
            p.append(f"{op.key}: module {op.module} without an owner in owners.yaml")
        elif op.unit and modules[op.module] != op.unit:
            p.append(f"{op.key}: x-unit {op.unit} ≠ owner {modules[op.module]} of {op.module}")
    for section in ("desktop_routes", "dialogs"):
        for key, unit in (owners.get(section) or {}).items():
            if unit not in units:
                p.append(f"owners.yaml: {section}.{key}: unknown owner {unit!r}")
    return p


def check_errors(contract: Contract) -> list[str]:
    p: list[str] = []
    declared = contract.api.get("x-error-codes") or {}
    for err in contract.types_mod.ERRORS:
        if err.code not in declared:
            p.append(f"api.yaml: x-error-codes lacks the domain code {err.code!r}")
    enum_codes = (
        ((contract.api.get("components") or {}).get("schemas") or {}).get("ErrorCode") or {}
    ).get("enum")
    if enum_codes != list(declared):
        p.append("api.yaml: components.schemas.ErrorCode.enum ≠ x-error-codes keys (same order)")
    for code, spec in declared.items():
        if not isinstance(spec, dict) or "http" not in spec or "where" not in spec:
            p.append(f"api.yaml: x-error-codes.{code} needs http and where")
    for op in iter_operations(contract):
        for code in op.errors:
            if code not in declared:
                p.append(f"{op.key}: undeclared error code {code!r}")
        if op.transport == "rest" and set(op.raw.get("responses") or {}) != {"200"}:
            p.append(f"{op.key}: a REST route answers only 200 (errors go in the envelope)")
    return p


def check_events(contract: Contract) -> list[str]:
    p: list[str] = []
    names = list(contract.types_mod.EVENT_NAMES)
    events = list((contract.rpc.get("events") or {}).keys())
    if sorted(events) != sorted(names):
        p.append(f"rpc.yaml: events {sorted(events)} ≠ EVENT_NAMES {sorted(names)}")
    for name, m in (contract.rpc.get("methods") or {}).items():
        for ev in list(m.get("events") or []) + list(m.get("emits") or []):
            if ev not in names:
                p.append(f"rpc.yaml: {name}: unknown event {ev!r}")
    md = contract.root / "contract" / "events.md"
    if md.is_file():
        text = md.read_text(encoding="utf-8")
        for name in names:
            if f"`{name}`" not in text:
                p.append(f"events.md: event {name} not documented")
    else:
        p.append("contract/events.md missing")
    job_kinds = {k.value for k in contract.types_mod.JobKind}
    for name, m in (contract.rpc.get("methods") or {}).items():
        if m.get("kind") == "job" and m.get("job_kind") not in job_kinds:
            p.append(f"rpc.yaml: {name}: job_kind {m.get('job_kind')!r} outside JobKind")
    return p


def _envelope_problems(contract: Contract, op: Operation, example: Any, label: str) -> list[str]:
    env = {"$ref": "#/components/schemas/AnyEnvelope"}
    sch = close_schema(deref(contract, env, API_DOC))
    return [f"{op.key} {label}: {e}" for e in _errors_for(sch, example)]


def check_examples(contract: Contract) -> list[str]:
    p: list[str] = []
    for op in iter_operations(contract):
        # success answer
        if op.data_schema is not None and op.example_data is not None:
            sch = close_schema(deref(contract, op.data_schema, op.doc))
            p += [f"{op.key} example data: {e}" for e in _errors_for(sch, op.example_data)]
        if op.transport != "rpc":
            resp = (op.raw.get("responses") or {}).get("200") or {}
            ex = ((resp.get("content") or {}).get("application/json") or {}).get("example")
            if ex is not None:
                p += _envelope_problems(contract, op, ex, "example envelope")
        else:
            res = (op.raw.get("example") or {}).get("result")
            if res is not None:
                p += _envelope_problems(contract, op, res, "example envelope")
        if op.example_error is not None:
            p += _envelope_problems(contract, op, op.example_error, "error example")
            code = ((op.example_error or {}).get("error") or {}).get("code")
            if code not in op.errors and code not in (contract.api.get("x-transport-errors") or {}):
                p.append(f"{op.key} error example: code {code!r} outside x-errors")
        if op.example_data is None and op.example_error is None:
            p.append(f"{op.key}: no example")
        # body/parameters
        if op.body_schema is not None and op.example_body is not None:
            sch = close_schema(deref(contract, op.body_schema, op.doc))
            p += [f"{op.key} example body: {e}" for e in _errors_for(sch, op.example_body)]
        elif op.body_schema is not None and op.transport != "rpc":
            p.append(f"{op.key}: requestBody without an example")
        if op.transport == "rpc" and "job_result" in op.raw:
            jr = (op.raw.get("example") or {}).get("job_result")
            if jr is None:
                p.append(f"{op.key}: job method without example.job_result")
            else:
                sch = close_schema(deref(contract, op.raw["job_result"], RPC_DOC))
                p += [f"{op.key} example job_result: {e}" for e in _errors_for(sch, jr)]
        for prm in op.raw.get("parameters") or []:
            if isinstance(prm, dict) and "example" in prm:
                sch = deref(contract, prm.get("schema", {}), op.doc)
                p += [
                    f"{op.key} example of parameter {prm.get('name')}: {e}"
                    for e in _errors_for(sch, prm["example"])
                ]
    for name, ev in (contract.rpc.get("events") or {}).items():
        sch = close_schema(deref(contract, ev.get("payload", {}), RPC_DOC))
        p += [f"event {name} example: {e}" for e in _errors_for(sch, ev.get("example"))]
    return p


def check_ids_ts(contract: Contract) -> list[str]:
    p: list[str] = []
    path = contract.root / IDS_TS
    if not path.is_file():
        return [f"{IDS_TS} missing"]
    text = path.read_text(encoding="utf-8")
    if f"export const PLUGIN_ID = '{contract.plugin_id}'" not in text:
        p.append(f"{IDS_TS}: PLUGIN_ID differs from {ID_PY}")
    for section, const in (("desktop_routes", "DESKTOP_ROUTES"), ("dialogs", "DIALOG_IDS")):
        m = re.search(rf"export const {const} = \{{(.*?)\}} as const", text, re.DOTALL)
        if not m:
            p.append(f"{IDS_TS}: {const} missing")
            continue
        keys = re.findall(r"""^\s*['"]?([a-z][a-zA-Z0-9-]*)['"]?\s*:""", m.group(1), re.MULTILINE)
        keys_norm = {k for k in keys}
        expected = set((contract.owners.get(section) or {}).keys())
        expected_norm = {_camel(k) for k in expected} | expected
        if not keys_norm or not keys_norm <= expected_norm or len(keys_norm) != len(expected):
            p.append(
                f"{IDS_TS}: {const} {sorted(keys_norm)} ≠ owners.yaml {section} {sorted(expected)}"
            )
    return p


def _camel(key: str) -> str:
    head, *rest = key.split("-")
    return head + "".join(r.capitalize() for r in rest)


def check_ext(contract: Contract) -> list[str]:
    """Extension routes: ``x-handler`` declared in ext-protocol.md's ``ExtHandlers`` and ``x-deps``
    with ``DEPENDENCY_TYPES`` names."""
    p: list[str] = []
    md = contract.root / "contract" / "ext-protocol.md"
    text = md.read_text(encoding="utf-8") if md.is_file() else ""
    if not text:
        p.append("contract/ext-protocol.md missing")
    deps_known = set(getattr(contract.types_mod, "DEPENDENCY_TYPES", {}))
    seen: set[str] = set()
    for op in iter_operations(contract):
        if op.transport != "ext":
            continue
        handler = op.raw.get("x-handler")
        if op.raw.get("security") == [] and op.path == "/health":
            continue
        if not handler:
            p.append(f"{op.key}: extension route without x-handler")
            continue
        if handler in seen:
            p.append(f"{op.key}: repeated x-handler {handler}")
        seen.add(handler)
        if text and f"    {handler}: Handler" not in text:
            p.append(f"{op.key}: x-handler {handler} missing from ExtHandlers in ext-protocol.md")
        for dep in op.raw.get("x-deps") or []:
            if dep not in deps_known:
                p.append(f"{op.key}: x-deps {dep!r} outside DEPENDENCY_TYPES")
    return p


def check_no_literal(contract: Contract) -> list[str]:
    p = []
    for rel in (API_DOC, RPC_DOC, OWNERS_DOC, "contract/events.md", "contract/ext-protocol.md"):
        path = contract.root / rel
        if path.is_file() and contract.plugin_id in path.read_text(encoding="utf-8"):
            p.append(f"{rel}: contains the plugin id literal (use PLUGIN_ID / <id>)")
    return p


# =========================================================================== TypeScript


_IDENT = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _ts_key(name: str) -> str:
    return name if _IDENT.match(name) else json.dumps(name)


def _jsdoc(text: str | None, indent: str) -> str:
    if not text:
        return ""
    text = text.replace("*/", "*\\/")
    return f"{indent}/** {text} */\n"


class TsGen:
    def __init__(self, contract: Contract) -> None:
        self.c = contract

    def ref_name(self, ref: str) -> str:
        return ref.rsplit("/", 1)[-1]

    def ts(self, sch: Any, indent: str = "") -> str:
        if sch is True or sch == {}:
            return "unknown"
        if not isinstance(sch, dict):
            return "unknown"
        if "$ref" in sch:
            return self.ref_name(sch["$ref"])
        if "const" in sch:
            return json.dumps(sch["const"], ensure_ascii=False)
        if "enum" in sch:
            return " | ".join(json.dumps(v, ensure_ascii=False) for v in sch["enum"])
        if "allOf" in sch:
            parts = [self.ts(s, indent) for s in sch["allOf"]]
            extra = {k: v for k, v in sch.items() if k in ("properties", "required", "type")}
            if extra.get("properties"):
                parts.append(self.ts({"type": "object", **extra}, indent))
            return " & ".join(
                f"({x})" if " | " in x and not x.startswith("{") else x for x in parts
            )
        for key in ("oneOf", "anyOf"):
            if key in sch:
                return " | ".join(self.ts(s, indent) for s in sch[key])
        t = sch.get("type")
        if isinstance(t, list):
            return " | ".join(self.ts({**sch, "type": x}, indent) for x in t)
        if t == "null":
            return "null"
        if t == "boolean":
            return "boolean"
        if t in ("integer", "number"):
            return "number"
        if t == "string":
            return "string"
        if t == "array":
            inner = self.ts(sch.get("items", {}), indent)
            return f"({inner})[]" if (" | " in inner or " & " in inner) else f"{inner}[]"
        if t == "object" or "properties" in sch:
            props = sch.get("properties") or {}
            addl = sch.get("additionalProperties")
            if not props:
                if isinstance(addl, dict):
                    return f"Record<string, {self.ts(addl, indent)}>"
                return "Record<string, unknown>"
            req = set(sch.get("required") or [])
            inner_indent = indent + "  "
            lines = ["{"]
            for name, ps in props.items():
                doc = ps.get("description") if isinstance(ps, dict) else None
                opt = "" if name in req else "?"
                if doc:
                    lines.append(_jsdoc(doc, inner_indent).rstrip("\n"))
                lines.append(f"{inner_indent}{_ts_key(name)}{opt}: {self.ts(ps, inner_indent)};")
            lines.append(f"{indent}}}")
            return "\n".join(lines)
        return "unknown"

    def decl(self, name: str, sch: Any) -> str:
        doc = sch.get("description") if isinstance(sch, dict) else None
        head = _jsdoc(doc, "")
        is_iface = (
            isinstance(sch, dict)
            and sch.get("type") == "object"
            and sch.get("properties")
            and not any(k in sch for k in ("allOf", "anyOf", "oneOf"))
        )
        if is_iface:
            return f"{head}export interface {name} {self.ts(sch)}\n"
        return f"{head}export type {name} = {self.ts(sch)};\n"


def _query_type(gen: TsGen, op: Operation) -> str:
    params = [p for p in op.raw.get("parameters") or [] if p.get("in") == "query"]
    if not params:
        return "Record<string, never>"
    lines = ["{"]
    for prm in params:
        opt = "" if prm.get("required") else "?"
        lines.append(f"      {_ts_key(prm['name'])}{opt}: {gen.ts(prm['schema'], '      ')};")
    lines.append("    }")
    return "\n".join(lines)


def _path_type(gen: TsGen, op: Operation) -> str:
    params = [p for p in op.raw.get("parameters") or [] if p.get("in") == "path"]
    if not params:
        return "Record<string, never>"
    inner = "; ".join(f"{_ts_key(p['name'])}: {gen.ts(p['schema'])}" for p in params)
    return "{ " + inner + " }"


def _errors_union(op: Operation) -> str:
    return " | ".join(json.dumps(e) for e in op.errors) if op.errors else "never"


def generate_ts(contract: Contract) -> str:
    gen = TsGen(contract)
    out: list[str] = [
        "// GENERATED by scripts/gen_types.py from plugin/core/types.py and contract/*.yaml"
        " — do not edit.\n",
        "// Regenerate: python scripts/gen_types.py · check: python scripts/gen_types.py --check\n",
        "// Ids, Desktop routes and full RPC/event names: ./ids.ts\n",
        "/* eslint-disable */\n\n",
        "// ------------------------------------------------------------- domain (types.py)\n\n",
    ]
    names_seen: dict[str, str] = {}

    def add(name: str, sch: Any, origin: str) -> None:
        if name in names_seen:
            raise ContractError(f"repeated type name {name} ({origin} and {names_seen[name]})")
        names_seen[name] = origin
        out.append(gen.decl(name, sch))
        out.append("\n")

    for name, sch in contract.domain["$defs"].items():
        add(name, sch, DOMAIN_DOC)
    out.append(
        "// ---------------------------------------------------------------- API (api.yaml)\n\n"
    )
    for name, sch in ((contract.api.get("components") or {}).get("schemas") or {}).items():
        add(name, sch, API_DOC)
    out.append(
        "// ---------------------------------------------------------------- RPC (rpc.yaml)\n\n"
    )
    for name, sch in ((contract.rpc.get("components") or {}).get("schemas") or {}).items():
        add(name, sch, RPC_DOC)

    ops = list(iter_operations(contract))
    for transport, iface, label in (
        ("rest", "RestRoutes", "plugin_api (prefix /api/plugins/<id>), through ctx.rest"),
        ("ext", "ExtRoutes", "extension's own server (http://127.0.0.1:<port>)"),
    ):
        out.append(f'/** Routes of the {label}. Key = "METHOD /path". */\n')
        out.append(f"export interface {iface} {{\n")
        for op in ops:
            if op.transport != transport:
                continue
            body = gen.ts(op.body_schema, "    ") if op.body_schema is not None else "never"
            summary = op.raw.get("summary")
            out.append(_jsdoc(f"{summary} · {op.module}", "  "))
            out.append(f"  {json.dumps(op.key)}: {{\n")
            out.append(f"    operationId: {json.dumps(op.operation_id)};\n")
            out.append(f"    path: {_path_type(gen, op)};\n")
            out.append(f"    query: {_query_type(gen, op)};\n")
            out.append(f"    body: {body};\n")
            out.append(f"    data: {gen.ts(op.data_schema, '    ')};\n")
            out.append(f"    errors: {_errors_union(op)};\n")
            out.append("  };\n")
        out.append("}\n\n")
        out.append(f"export type {iface[:-1]}Key = keyof {iface};\n\n")

    out.append(
        "/** RPC methods (`host.request(rpcMethod(name), params)`); answer = Envelope<data>. */\n"
    )
    out.append("export interface RpcMethods {\n")
    for op in ops:
        if op.transport != "rpc":
            continue
        m = op.raw
        out.append(_jsdoc(f"{m.get('summary')} · {op.module} · {m['kind']}", "  "))
        out.append(f"  {json.dumps(op.path)}: {{\n")
        out.append(f"    kind: {json.dumps(m['kind'])};\n")
        out.append(f"    params: {gen.ts(op.body_schema, '    ')};\n")
        out.append(f"    data: {gen.ts(op.data_schema, '    ')};\n")
        jr = gen.ts(m["job_result"], "    ") if "job_result" in m else "never"
        out.append(f"    jobResult: {jr};\n")
        out.append(f"    errors: {_errors_union(op)};\n")
        out.append("  };\n")
    out.append("}\n\nexport type RpcMethodName = keyof RpcMethods;\n\n")

    out.append("/** Events (`ctx.onEvent(eventType(name), …)`): payload by short name. */\n")
    out.append("export interface TubeEvents {\n")
    for name, ev in (contract.rpc.get("events") or {}).items():
        out.append(_jsdoc(ev.get("summary"), "  "))
        out.append(f"  {json.dumps(name)}: {gen.ts(ev['payload'], '  ')};\n")
    out.append("}\n\nexport type TubeEventName = keyof TubeEvents;\n\n")

    codes = list((contract.api.get("x-error-codes") or {}).keys())
    out.append("/** Every error code, in x-error-codes order. */\n")
    out.append(f"export const ERROR_CODES = {json.dumps(codes)} as const;\n\n")
    out.append("/** Envelope of every REST, ext and RPC answer. */\n")
    out.append(
        "export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };\n"
    )
    text = "".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text).rstrip("\n") + "\n"
    return text


def generate_domain_json(contract: Contract) -> str:
    return json.dumps(contract.domain, ensure_ascii=False, indent=2) + "\n"


# =========================================================================== running


def validate_contract(contract: Contract) -> list[str]:
    problems: list[str] = []
    problems += validate_openapi(contract.api)
    problems += validate_rpc(contract.rpc)
    problems += _check_schema_validity(contract)
    ref_problems = check_refs(contract)
    problems += ref_problems
    problems += check_owners(contract)
    problems += check_errors(contract)
    problems += check_events(contract)
    problems += check_ids_ts(contract)
    problems += check_ext(contract)
    problems += check_no_literal(contract)
    if not ref_problems:
        problems += check_examples(contract)
    # no duplicates, in order
    seen: set[str] = set()
    return [x for x in problems if not (x in seen or seen.add(x))]


def _outputs(contract: Contract) -> dict[str, str]:
    return {DOMAIN_DOC: generate_domain_json(contract), TS_OUT: generate_ts(contract)}


def run_check(root: Path | str = ROOT_DEFAULT) -> list[str]:
    try:
        contract = load_contract(root, fresh=True)
    except (ContractError, yaml.YAMLError, OSError) as exc:
        return [f"loading the contract: {exc}"]
    problems = validate_contract(contract)
    try:
        outputs = _outputs(contract)
    except ContractError as exc:
        return problems + [f"generation: {exc}"]
    for rel, text in outputs.items():
        path = contract.root / rel
        if not path.is_file():
            problems.append(f"{rel}: missing — run python scripts/gen_types.py")
        elif path.read_text(encoding="utf-8") != text:
            problems.append(f"{rel}: stale — run python scripts/gen_types.py")
    return problems


def regenerate(root: Path | str = ROOT_DEFAULT) -> tuple[list[str], list[str]]:
    contract = load_contract(root, fresh=True)
    written = []
    for rel, text in _outputs(contract).items():
        path = contract.root / rel
        if not path.is_file() or path.read_text(encoding="utf-8") != text:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            written.append(rel)
    return written, validate_contract(contract)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="check only; exit 1 on a problem")
    ap.add_argument("--root", default=str(ROOT_DEFAULT), help="repository root")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    if args.check:
        problems = run_check(root)
        for line in problems:
            print(f"FAIL {line}")
        if problems:
            print(f"gen_types --check: {len(problems)} problem(s)")
            return 1
        contract = load_contract(root)
        n = sum(1 for _ in iter_operations(contract))
        print(f"gen_types --check: OK ({n} operations, {len(contract.rpc['events'])} events)")
        return 0
    try:
        written, problems = regenerate(root)
    except (ContractError, yaml.YAMLError, OSError) as exc:
        print(f"FAIL {exc}")
        return 1
    for rel in written:
        print(f"wrote {rel}")
    for line in problems:
        print(f"FAIL {line}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
