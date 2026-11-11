"""Surface test: every route, RPC method, extension handler and tool answers, and the shape
validates **strictly** against the contract.

- stub (no ``@contract.real``): besides the schema, the response must be **the example** from the
  contract;
- real (``@contract.real``): only the schema (strict) — a real one that does not validate fails;
- REST also through the ``plugin_api`` router (FastAPI ``TestClient``), always HTTP 200 + envelope;
- extension also through its own server (``ensure_server`` on a range of test ports);
- ``register(ctx)`` with ``FakeCtx``: 9 tools = ``provides_tools``, ``/tube``, 12 RPCs, hook,
  auxiliary task, blueprints validated by the real class, ``on_unload``; no network, no threads.
"""

from __future__ import annotations

import dataclasses
import importlib
import importlib.util
import inspect
import json
import socket
import sys
import threading
import types
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import yaml

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugin"


def _load_by_path(name: str, path: Path) -> types.ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gen_types = _load_by_path("_gen_types_surface", ROOT / "scripts" / "gen_types.py")
CONTRACT = gen_types.load_contract(ROOT)
OPS = list(gen_types.iter_operations(CONTRACT))
REST_OPS = [op for op in OPS if op.transport == "rest"]
RPC_OPS = [op for op in OPS if op.transport == "rpc"]
EXT_OPS = [op for op in OPS if op.transport == "ext" and op.raw.get("x-handler")]

MANIFEST = yaml.safe_load((PLUGIN_DIR / "plugin.yaml").read_text(encoding="utf-8"))


def _snake(operation_id: str) -> str:
    out = []
    for ch in operation_id:
        if ch.isupper():
            out.append("_" + ch.lower())
        else:
            out.append(ch)
    return "".join(out).lstrip("_")


def _module_name(path: str) -> str:
    assert path.startswith("plugin/") and path.endswith(".py"), path
    return "tube_pkg." + path[len("plugin/") : -3].replace("/", ".")


def _validate(op: Any, data: Any) -> None:
    gen_types.validate_instance(op.data_schema, data, ROOT, current=op.doc, strict=True)


def _full_example(op: Any) -> Any:
    if op.transport == "rpc":
        return op.raw["example"]["result"]
    return op.raw["responses"]["200"]["content"]["application/json"]["example"]


def _check_envelope(op: Any, fn: Any, env: Any) -> None:
    """Strict envelope: ``ok`` → ``data`` against ``x-data``/``result``; error → ``ErrorEnvelope``
    with a code declared on the operation. Stub (no ``@contract.real``) = literal example."""
    common = importlib.import_module("tube_pkg.api._common")
    assert common.is_envelope(env), f"{op.key}: not an envelope: {env!r}"
    if env["ok"] is True:
        assert set(env) == {"ok", "data"}, f"{op.key}: chaves {sorted(env)}"
        _validate(op, env["data"])
    else:
        gen_types.validate_instance(
            {"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True
        )
        assert env["error"]["code"] in set(op.errors) | {"internal"}, f"{op.key}: {env}"
    if not common.is_real(fn):
        assert env == _full_example(op), f"{op.key}: stub differs from the example"
        assert common.stub_operation(fn) == op.operation_id


def _params(op: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    for param in op.raw.get("parameters") or []:
        if param.get("in") not in ("path", "query"):
            continue
        if "example" in param:
            out[param["name"]] = str(param["example"])
        elif param.get("required"):
            out[param["name"]] = "x"
    return out


def _body(op: Any) -> Any:
    if op.method in ("GET", "DELETE"):
        return None
    return op.example_body if op.example_body is not None else {}


# =========================================================================== manifest


@pytest.fixture(autouse=True)
def _no_real_ext_server(monkeypatch: pytest.MonkeyPatch) -> None:
    """``GET /status`` and ``POST /pair/start`` start the extension server. Here only the shape of
    the responses is checked: no port is opened in the real range (47615–47624) during tests."""
    wiring = importlib.import_module("tube_pkg.wiring")
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda **_kw: None)


def test_manifest_basics() -> None:
    assert MANIFEST["name"] == PLUGIN_ID
    assert MANIFEST["manifest_version"] == 2
    assert MANIFEST["requires_hermes"].startswith(">=0.23")
    assert MANIFEST["license"] == "MIT"
    assert len(MANIFEST["provides_tools"]) == 9
    assert all(name.startswith("tube_") for name in MANIFEST["provides_tools"])


FORM_HIDDEN = {
    "home_on_youtube",
    "extras_honest_thumbnails",
    "extras_hn_lens",
    "extras_hn_channels",
    "extras_import_lists",
}
"""Keys with no effect in this version stay out of the form (the default stays in the code)."""


def test_config_schema_is_flat_and_matches_settings_defaults() -> None:
    schema = MANIFEST["config_schema"]
    assert set(schema) == set(T.SETTINGS_DEFAULTS) - FORM_HIDDEN
    for key, spec in schema.items():
        assert "." not in key
        assert spec["default"] == T.SETTINGS_DEFAULTS[key], key
        expected = {bool: "bool", int: "int", str: "str"}[type(T.SETTINGS_DEFAULTS[key])]
        assert spec["type"] == expected, key


def test_dashboard_manifest() -> None:
    data = json.loads((PLUGIN_DIR / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    assert data["name"] == PLUGIN_ID
    assert data["api"] == "plugin_api.py"
    assert (PLUGIN_DIR / "dashboard" / data["api"]).is_file()


# =========================================================================== stubs and tables


def test_every_contract_module_exists() -> None:
    missing = sorted(
        {op.module for op in OPS if op.module and not (ROOT / op.module).is_file()}
        | {spec.module for spec in T.BUILDS if not (ROOT / spec.module).is_file()}
    )
    assert not missing, f"modules without a file (run scripts/gen_stubs.py): {missing}"


def test_gen_stubs_check_is_clean() -> None:
    gen_stubs = _load_by_path("_gen_stubs_surface", ROOT / "scripts" / "gen_stubs.py")
    problems = gen_stubs.run_check(ROOT)
    assert problems == [], "\n".join(problems)


def test_wiring_tables_match_contract() -> None:
    wiring = importlib.import_module("tube_pkg.wiring")
    rest = {(r.method, r.path): (r.module, r.handler) for r in wiring.REST_ROUTES}
    assert rest == {
        (op.method, op.path): (_module_name(op.module), _snake(op.operation_id)) for op in REST_OPS
    }
    rpc = {m.name: (m.module, m.handler) for m in wiring.RPC_METHODS}
    assert rpc == {op.path: (_module_name(op.module), op.path.replace(".", "_")) for op in RPC_OPS}
    ext = {h.handler: (h.module, tuple(h.deps)) for h in wiring.EXT_HANDLERS}
    assert ext == {
        op.raw["x-handler"]: (_module_name(op.module), tuple(op.raw.get("x-deps") or []))
        for op in EXT_OPS
    }


# =========================================================================== REST


def _rest_fn(op: Any) -> Any:
    module = importlib.import_module(_module_name(op.module))
    return getattr(module, _snake(op.operation_id))


@pytest.mark.parametrize("op", REST_OPS, ids=lambda op: op.key)
def test_rest_handler_direct(op: Any) -> None:
    fn = _rest_fn(op)
    env = fn(_body(op), _params(op))
    _check_envelope(op, fn, env)


@pytest.fixture(scope="module")
def rest_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    plugin_api = _load_by_path(
        "_tube_plugin_api_surface", PLUGIN_DIR / "dashboard" / "plugin_api.py"
    )
    app = FastAPI()
    app.include_router(plugin_api.router, prefix=f"/api/plugins/{PLUGIN_ID}")
    with TestClient(app) as client:
        yield client


def _fill_path(op: Any) -> str:
    path = op.path
    for name, value in _params(op).items():
        path = path.replace("{" + name + "}", value)
    return path


@pytest.mark.parametrize("op", REST_OPS, ids=lambda op: op.key)
def test_rest_via_plugin_api_router(op: Any, rest_client: Any) -> None:
    path_names = {p["name"] for p in op.raw.get("parameters") or [] if p.get("in") == "path"}
    query = {k: v for k, v in _params(op).items() if k not in path_names}
    body = _body(op)
    resp = rest_client.request(
        op.method,
        f"/api/plugins/{PLUGIN_ID}{_fill_path(op)}",
        params=query,
        json=body if body is not None else None,
    )
    assert resp.status_code == 200, resp.text
    _check_envelope(op, _rest_fn(op), resp.json())


def test_rest_invalid_json_is_invalid_envelope(rest_client: Any) -> None:
    resp = rest_client.post(
        f"/api/plugins/{PLUGIN_ID}/refresh",
        content=b"{nope",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    env = resp.json()
    assert env["ok"] is False and env["error"]["code"] == "invalid"


def test_rest_errors_become_200_envelopes(monkeypatch: pytest.MonkeyPatch, rest_client) -> None:
    module = importlib.import_module("tube_pkg.api.jobs")

    def boom_not_found(body, query):
        raise T.NotFound("job sumiu")

    def boom_bug(body, query):
        raise RuntimeError("segredo interno")

    monkeypatch.setattr(module, "get_job", boom_not_found)
    resp = rest_client.get(f"/api/plugins/{PLUGIN_ID}/jobs/job_1")
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "error": {"code": "not_found", "message": "job sumiu"}}

    monkeypatch.setattr(module, "get_job", boom_bug)
    resp = rest_client.get(f"/api/plugins/{PLUGIN_ID}/jobs/job_1")
    assert resp.status_code == 200
    env = resp.json()
    assert env["ok"] is False and env["error"]["code"] == "internal"
    assert "segredo" not in json.dumps(env)
    gen_types.validate_instance(
        {"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True
    )


# =========================================================================== RPC


def _rpc_fn(op: Any) -> Any:
    module = importlib.import_module(_module_name(op.module))
    return getattr(module, op.path.replace(".", "_"))


@pytest.mark.parametrize("op", RPC_OPS, ids=lambda op: op.key)
def test_rpc_handler_direct(op: Any) -> None:
    fn = _rpc_fn(op)
    env = fn(dict(op.example_body or {}), session_id=None)
    _check_envelope(op, fn, env)


# =========================================================================== extension


def _ext_handlers(db: Any) -> Any:
    wiring = importlib.import_module("tube_pkg.wiring")
    settings = importlib.import_module("tube_pkg.adapters.settings").build()
    return wiring.ext_handlers(db=db, settings=settings)


def test_ext_handlers_cover_contract(db: Any) -> None:
    mount = importlib.import_module("tube_pkg.ext._mount")
    handlers = _ext_handlers(db)
    assert isinstance(handlers, mount.ExtHandlers)
    names = {f.name for f in dataclasses.fields(mount.ExtHandlers)} - {"authenticate"}
    assert names == {op.raw["x-handler"] for op in EXT_OPS}


@pytest.mark.parametrize("op", EXT_OPS, ids=lambda op: op.key)
def test_ext_handler_direct(op: Any, db: Any) -> None:
    handlers = _ext_handlers(db)
    module = importlib.import_module(_module_name(op.module))
    raw_fn = getattr(module, op.raw["x-handler"])
    device = T.Device(id="dev_1", name="Chrome", created_at=1762700000)
    env = getattr(handlers, op.raw["x-handler"])(device, _body(op), _params(op))
    _check_envelope(op, raw_fn, env)


def test_ext_auth_stub_refuses_without_pairing(db: Any) -> None:
    handlers = _ext_handlers(db)
    with pytest.raises(T.Unauthorized):
        handlers.authenticate("Bearer whatever", None)
    with pytest.raises(T.Unauthorized):
        handlers.authenticate(None, None)


def _free_base(span: int = 4) -> int:
    for base in range(49310, 64000, 37):
        ok = True
        for port in range(base, base + span):
            with socket.socket() as s:
                try:
                    s.bind(("127.0.0.1", port))
                except OSError:
                    ok = False
                    break
        if ok:
            return base
    raise RuntimeError("sem portas livres")


def test_ext_handlers_through_real_server(db: Any, tmp_path: Path) -> None:
    server = importlib.import_module("tube_pkg.ext._server")
    handlers = _ext_handlers(db)
    device = T.Device(id="dev_1", name="Chrome", created_at=1762700000)
    handlers = dataclasses.replace(handlers, authenticate=lambda authorization, origin: device)
    settings = importlib.import_module("tube_pkg.adapters.settings").build()
    data_dir = tmp_path / "plugin-data"
    base = _free_base()
    port = server.ensure_server(
        db=db, settings=settings, data_dir=data_dir, handlers=handlers, port_base=base, port_span=4
    )
    assert port is not None
    try:
        for op in EXT_OPS:
            path = _fill_path(op)
            query = {k: v for k, v in _params(op).items() if "{" + k + "}" not in op.path}
            if query:
                path += "?" + "&".join(f"{k}={v}" for k, v in query.items())
            body = _body(op)
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}{path}",
                method=op.method,
                data=json.dumps(body).encode() if body is not None else None,
                headers={
                    "Authorization": "Bearer tok",
                    "Content-Type": "application/json",
                    "Origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    status, env = resp.status, json.loads(resp.read())
            except urllib.error.HTTPError as exc:  # error example: status from x-error-codes
                status, env = exc.code, json.loads(exc.read())
            expected = 200 if env.get("ok") else T.ERROR_HTTP_STATUS[env["error"]["code"]]
            assert status == expected, (op.key, status, env)
            module = importlib.import_module(_module_name(op.module))
            _check_envelope(op, getattr(module, op.raw["x-handler"]), env)
    finally:
        server.stop_local(data_dir)


# =========================================================================== real vs stub


def test_contract_real_is_validated_strictly(db: Any) -> None:
    common = importlib.import_module("tube_pkg.api._common")
    op = gen_types.get_operation(CONTRACT, "postRefresh")

    @common.contract.real
    def good(body, query):
        return common.ok({"result": "skipped"})

    @common.contract.real
    def extra_key(body, query):
        return common.ok({"result": "skipped", "surprise": 1})

    @common.contract.real
    def wrong_enum(body, query):
        return common.ok({"result": "maybe"})

    def unmarked_other(body, query):
        return common.ok({"result": "skipped"})

    _check_envelope(op, good, good({}, {}))  # real: another value, same schema → passes
    for bad in (extra_key, wrong_enum):
        with pytest.raises(jsonschema.ValidationError):
            _check_envelope(op, bad, bad({}, {}))
    with pytest.raises(AssertionError):  # without @contract.real the literal example is required
        _check_envelope(op, unmarked_other, unmarked_other({}, {}))
    assert common.is_real(good) and not common.is_real(unmarked_other)


# =========================================================================== register(ctx)


@pytest.fixture
def registered(fake_ctx: Any, monkeypatch: pytest.MonkeyPatch):
    def no_network(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("register() tried to open a network connection")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    before = {t.ident for t in threading.enumerate()}
    plugin_init = _load_by_path("_tube_plugin_init_surface", PLUGIN_DIR / "__init__.py")
    plugin_init.register(fake_ctx)
    after = {t.ident for t in threading.enumerate()}
    assert after <= before, "register() subiu thread"
    yield fake_ctx
    for cb in fake_ctx.unload_callbacks:
        cb()


def test_register_tools_match_manifest(registered: Any) -> None:
    names = [t["name"] for t in registered.tools]
    assert sorted(names) == sorted(MANIFEST["provides_tools"])
    for tool in registered.tools:
        schema = tool["schema"]
        assert schema["name"] == tool["name"]
        assert schema["description"]
        jsonschema.Draft202012Validator.check_schema(schema["parameters"])
        assert schema["parameters"]["type"] == "object"
        assert tool["toolset"] == PLUGIN_ID


def test_tools_respond_with_json(registered: Any) -> None:
    for tool in registered.tools:
        out = tool["handler"]({}, session_id=None)
        assert isinstance(out, str)
        data = json.loads(out)
        assert isinstance(data, dict), tool["name"]


def test_register_rpc_methods(registered: Any) -> None:
    assert set(registered.rpc) == {op.path for op in RPC_OPS}
    for op in RPC_OPS:
        env = registered.call_rpc(op.path, op.example_body or {})
        _check_envelope(op, _rpc_fn(op), env)


def test_rpc_wrapper_never_raises(registered: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    module = importlib.import_module("tube_pkg.rpc.cleanup")

    def boom(params, *, session_id=None, **kwargs):
        raise RuntimeError("bug")

    def refused(params, *, session_id=None, **kwargs):
        raise T.ApprovalRefused("não")

    monkeypatch.setattr(module, "cleanup_approve", boom)
    env = registered.call_rpc("cleanup.approve", {"channel_ids": ["UCBJycsmduvYEL83R_U4JriQ"]})
    assert env["ok"] is False and env["error"]["code"] == "internal"
    monkeypatch.setattr(module, "cleanup_approve", refused)
    env = registered.call_rpc("cleanup.approve", {"channel_ids": ["UCBJycsmduvYEL83R_U4JriQ"]})
    assert env["error"]["code"] == "approval_refused"
    handler = registered.rpc["cleanup.approve"]
    assert handler(["not", "a", "dict"], session_id=None)["error"]["code"] == "invalid"


def test_register_command_hook_aux_blueprints_unload(registered: Any) -> None:
    assert "tube" in registered.commands
    out = registered.commands["tube"]["handler"]("")
    assert isinstance(out, str) and out
    assert set(registered.hooks) == set(MANIFEST.get("provides_hooks") or [])
    wiring = importlib.import_module("tube_pkg.wiring")
    assert wiring.CURATOR_TASK in registered.aux_tasks
    assert wiring.CURATOR_TASK != "curator"  # reserved Hermes key (built-in task)
    assert len(registered.blueprints) == 3
    assert {b.key.split(":", 1)[1] for b in registered.blueprints} <= set(T.ROUTINE_KEYS)
    assert registered.unload_callbacks
    assert any(key.startswith(f"{PLUGIN_ID}:") for key in registered.skills)


def test_pre_llm_call_hook_only_on_rendering_platforms(registered: Any) -> None:
    (hook,) = registered.hooks["pre_llm_call"]
    assert hook(platform="telegram") is None
    assert hook(platform="cli") is None
    out = hook(platform="desktop")
    assert out and "::tube-video" in out["context"]


def test_curator_aux_task_key_is_valid_for_hermes(registered: Any) -> None:
    from hermes_cli.plugins_aux_tasks import build_auxiliary_task_entry

    wiring = importlib.import_module("tube_pkg.wiring")
    build_auxiliary_task_entry(
        PLUGIN_ID,
        PLUGIN_ID,
        wiring.CURATOR_TASK,
        display_name="x",
        description="y",
        defaults=None,
        inherit_from=None,
        registered={},
    )


# =========================================================================== wiring and Settings


def test_wiring_providers_satisfy_protocols(db: Any, wire: Any) -> None:
    wiring = importlib.import_module("tube_pkg.wiring")
    wire.set("db", db)
    wiring.reset()
    assert wiring.get_lenses() == []
    proto_by_provides = {spec.provides: spec.returns for spec in T.BUILDS}
    for provides, proto in proto_by_provides.items():
        if provides == "lenses":
            continue
        obj = getattr(wiring, f"get_{provides}")()
        assert isinstance(obj, getattr(T, proto)), provides
    assert callable(wiring.get_ext_endpoint_up())
    wiring.reset()


def test_wiring_honors_monkeypatched_dependency(db: Any, wire: Any) -> None:
    wiring = importlib.import_module("tube_pkg.wiring")
    sentinel = object()
    wire.set("db", db)
    wire.set("channels", sentinel)
    wiring.reset()
    graph = wiring.graph()
    assert graph.get("channels") is sentinel
    wiring.reset()


def test_build_signatures_match_contract() -> None:
    for spec in T.BUILDS:
        module = importlib.import_module(_module_name(spec.module))
        fn = getattr(module, spec.function)
        params = inspect.signature(fn).parameters
        kw_only = [n for n, p in params.items() if p.kind is inspect.Parameter.KEYWORD_ONLY]
        required = [n for n in kw_only if params[n].default is inspect.Parameter.empty]
        assert required == list(spec.deps), spec.key
        for name in spec.optional:
            assert name in params and params[name].default is None, (spec.key, name)


def test_settings_defaults_and_coercion(tmp_path: Path) -> None:
    settings_mod = importlib.import_module("tube_pkg.adapters.settings")
    home = tmp_path / "home"
    home.mkdir()
    s = settings_mod.build(home=home)
    assert isinstance(s, T.Settings)
    assert s.snapshot() == T.SettingsSnapshot()
    assert s.get("unknown", "dflt") == "dflt"
    (home / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "plugins": {
                    "entries": {
                        PLUGIN_ID: {
                            "settings": {
                                "rss_interval_min": 45.0,
                                "extras_hn_lens": "true",
                                "language": "pt-BR",
                                "home_on_youtube": "garbage",
                            }
                        }
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    snap = s.snapshot()
    assert snap.rss_interval_min == 45 and isinstance(snap.rss_interval_min, int)
    assert snap.extras_hn_lens is True
    assert snap.language == "pt-BR"
    assert snap.home_on_youtube is True  # invalid value → default
    assert s.get("rss_interval_min") == 45


def test_settings_set_validates_and_persists(tmp_path: Path) -> None:
    settings_mod = importlib.import_module("tube_pkg.adapters.settings")
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text("model: x\n", encoding="utf-8")
    s = settings_mod.build(home=home)
    with pytest.raises(T.ValidationError):
        s.set("nope", 1)
    with pytest.raises(T.ValidationError):
        s.set("rss_interval_min", "abc")
    with pytest.raises(T.ValidationError):
        s.set("extras_hn_lens", "yes please")
    s.set("extras_hn_lens", True)
    s.set("rss_interval_min", 15)
    assert s.get("extras_hn_lens") is True
    assert settings_mod.build(home=home).snapshot().rss_interval_min == 15
    cfg = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert cfg["model"] == "x"
    assert cfg["plugins"]["entries"][PLUGIN_ID]["settings"]["extras_hn_lens"] is True


def test_settings_with_ctx_writes_through_ctx(fake_ctx: Any, tmp_path: Path) -> None:
    settings_mod = importlib.import_module("tube_pkg.adapters.settings")
    s = settings_mod.build(ctx=fake_ctx, home=None)
    s.set("language", "en")
    assert fake_ctx.config["language"] == "en"
    assert s.get("language") == "en"


def test_settings_without_hermes_home_uses_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    settings_mod = importlib.import_module("tube_pkg.adapters.settings")
    s = settings_mod.build(home=None)
    assert s.snapshot() == T.SettingsSnapshot()
    s.set("extras_import_lists", True)  # without Hermes or a home: stays in memory
    assert s.get("extras_import_lists") is True
