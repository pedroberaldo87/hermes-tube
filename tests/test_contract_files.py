"""Surface contract (REST, RPC, extension, events, Desktop).

Validates the documents in ``contract/`` and the ``scripts/gen_types.py`` generator:

- ``api.yaml`` is OpenAPI 3.1 and every schema is valid JSON Schema 2020-12; ``rpc.yaml`` follows
  the generator's ``tube-rpc/1`` meta-schema
- every route/method has ``x-module`` and ``x-unit``; every module has an owner in ``owners.yaml``
  and the owner is the ``x-unit``; ``$ref``s resolve; examples validate against their own schemas
- domain types come from ``plugin/core/types.py`` (``to_jsonable``), error codes from
  ``ERRORS``, events from ``EVENT_NAMES``
- ``gen_types.py --check`` shows no difference, and fails on a module without an owner, a route
  without ``x-module`` or a stale ``shared/api-types.ts``
- coverage: every route/method/screen the plugin relies on exists in the contract
"""

from __future__ import annotations

import dataclasses
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "scripts" / "gen_types.py"
CONTRACT = ROOT / "contract"
SHARED = ROOT / "shared"


def _load_gen():
    spec = importlib.util.spec_from_file_location("_tube_gen_types_test", GEN)
    assert spec is not None and spec.loader is not None, "scripts/gen_types.py ausente"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def gen():
    return _load_gen()


@pytest.fixture(scope="module")
def contract(gen):
    return gen.load_contract(ROOT)


@pytest.fixture(scope="module")
def types_mod():
    import tube_pkg.core.types as t  # conftest already called _bootstrap.ensure()

    return t


# --------------------------------------------------------------------------- coverage

# plugin_api routes (prefix /api/plugins/<id>) and the module the contract records for each
REST_ROUTES = {
    # refresh and status
    ("GET", "/status"): "plugin/api/status.py",
    ("POST", "/refresh"): "plugin/api/refresh.py",
    ("POST", "/refresh/{channel_id}"): "plugin/api/refresh.py",
    ("POST", "/read"): "plugin/api/refresh.py",
    # feed and video state
    ("GET", "/state"): "plugin/api/state.py",
    ("GET", "/feed"): "plugin/api/feed.py",
    ("POST", "/feed/preview"): "plugin/api/feed.py",
    ("POST", "/videos/state"): "plugin/api/state.py",
    ("GET", "/videos/state"): "plugin/api/state.py",
    ("GET", "/videos"): "plugin/api/feed.py",
    # channels and history
    ("GET", "/channels"): "plugin/api/channels.py",
    ("GET", "/channels/{id}"): "plugin/api/channels.py",
    ("PATCH", "/channels/{id}"): "plugin/api/channels.py",
    ("POST", "/channels/batch"): "plugin/api/channels.py",
    ("POST", "/channels/add"): "plugin/api/channels.py",
    ("GET", "/changes"): "plugin/api/changes.py",
    ("POST", "/changes/{id}/undo"): "plugin/api/changes.py",
    # folders, tags and tabs
    ("GET", "/folders"): "plugin/api/taxonomy.py",
    ("POST", "/folders"): "plugin/api/taxonomy.py",
    ("PATCH", "/folders/{id}"): "plugin/api/taxonomy.py",
    ("DELETE", "/folders/{id}"): "plugin/api/taxonomy.py",
    ("POST", "/folders/reorder"): "plugin/api/taxonomy.py",
    ("GET", "/tags"): "plugin/api/taxonomy.py",
    ("POST", "/tags"): "plugin/api/taxonomy.py",
    ("PATCH", "/tags/{id}"): "plugin/api/taxonomy.py",
    ("DELETE", "/tags/{id}"): "plugin/api/taxonomy.py",
    ("GET", "/tabs"): "plugin/api/tabs.py",
    ("POST", "/tabs"): "plugin/api/tabs.py",
    ("PATCH", "/tabs/{id}"): "plugin/api/tabs.py",
    ("DELETE", "/tabs/{id}"): "plugin/api/tabs.py",
    ("POST", "/tabs/reorder"): "plugin/api/tabs.py",
    ("POST", "/tabs/from-channels"): "plugin/api/tabs.py",
    # pairing and devices (POST /pair/start on plugin_api starts the extension's own server)
    ("POST", "/pair/start"): "plugin/api/pair.py",
    ("GET", "/devices"): "plugin/api/pair.py",
    ("POST", "/devices/{id}/revoke"): "plugin/api/pair.py",
    # demo and import/export
    ("POST", "/demo/load"): "plugin/api/data.py",
    ("POST", "/demo/clear"): "plugin/api/data.py",
    ("POST", "/import/mytube"): "plugin/api/data.py",
    ("GET", "/export"): "plugin/api/data.py",
    ("POST", "/import"): "plugin/api/data.py",
    # jobs
    ("GET", "/jobs/{id}"): "plugin/api/jobs.py",
    ("GET", "/jobs"): "plugin/api/jobs.py",
    # organize suggestions
    ("GET", "/suggestions"): "plugin/api/organize.py",
    # cleanup and queue
    ("GET", "/cleanup"): "plugin/api/cleanup.py",
    ("GET", "/queue"): "plugin/api/cleanup.py",
    ("POST", "/cleanup/dismiss"): "plugin/api/cleanup.py",
    ("POST", "/queue/undo"): "plugin/api/cleanup.py",
    # themes
    ("GET", "/themes"): "plugin/api/themes.py",
    ("GET", "/themes/{id}"): "plugin/api/themes.py",
    # extras
    ("GET", "/extras"): "plugin/api/extras.py",
    ("POST", "/extras"): "plugin/api/extras.py",
    ("POST", "/extras/hn/download"): "plugin/api/extras.py",
    ("GET", "/extras/hn/channels"): "plugin/api/extras.py",
}

# routes of the extension's own server (127.0.0.1:47615 + range)
EXT_ROUTES = {
    ("GET", "/health"): "plugin/ext/_server.py",
    ("POST", "/pair/complete"): "plugin/ext/pair.py",
    ("POST", "/ext/unpair"): "plugin/ext/pair.py",
    ("GET", "/ext/state"): "plugin/ext/state.py",
    ("POST", "/ext/sync/subscriptions"): "plugin/ext/sync.py",
    ("POST", "/ext/sync/watch"): "plugin/ext/sync.py",
    ("GET", "/ext/feed"): "plugin/ext/feed.py",
    ("POST", "/ext/videos/state"): "plugin/ext/feed.py",
    ("POST", "/ext/read"): "plugin/ext/feed.py",
    ("GET", "/ext/queue"): "plugin/ext/queue.py",
    ("POST", "/ext/queue/{id}/result"): "plugin/ext/queue.py",
    ("GET", "/ext/search-jobs"): "plugin/ext/search.py",
    ("POST", "/ext/search-jobs/{id}/result"): "plugin/ext/search.py",
}

RPC_METHODS = {
    "organize.run": "plugin/rpc/organize.py",
    "organize.accept": "plugin/rpc/organize.py",
    "organize.reject": "plugin/rpc/organize.py",
    "cleanup.scan": "plugin/rpc/cleanup.py",
    "cleanup.approve": "plugin/rpc/cleanup.py",
    "cleanup.resubscribe": "plugin/rpc/cleanup.py",
    "theme.create": "plugin/rpc/themes.py",
    "theme.save": "plugin/rpc/themes.py",
    "theme.refresh": "plugin/rpc/themes.py",
    "lists.import": "plugin/rpc/lists.py",
    "lists.to_tab": "plugin/rpc/lists.py",
    "pair.start": "plugin/rpc/pair.py",
}

DESKTOP_ROUTES = ("home", "manage", "cleanup", "extras")
DIALOGS = ("onboarding", "tab-editor", "organize", "theme", "list-import", "history", "create-tab")

# route/method/handler files; each must have an owner in owners.yaml
ROUTE_MODULES = (
    "plugin/api/refresh.py",
    "plugin/api/status.py",
    "plugin/api/feed.py",
    "plugin/api/state.py",
    "plugin/ext/feed.py",
    "plugin/api/channels.py",
    "plugin/api/changes.py",
    "plugin/api/taxonomy.py",
    "plugin/api/tabs.py",
    "plugin/ext/pair.py",
    "plugin/ext/auth.py",
    "plugin/ext/sync.py",
    "plugin/ext/state.py",
    "plugin/api/data.py",
    "plugin/api/jobs.py",
    "plugin/rpc/organize.py",
    "plugin/api/organize.py",
    "plugin/rpc/cleanup.py",
    "plugin/api/cleanup.py",
    "plugin/ext/queue.py",
    "plugin/rpc/themes.py",
    "plugin/api/themes.py",
    "plugin/ext/search.py",
    "plugin/api/extras.py",
    "plugin/rpc/lists.py",
    "plugin/ext/_mount.py",
    "plugin/ext/_server.py",
)

EXT_ERROR_CODES = {
    "unauthorized": 401,
    "origin_forbidden": 403,
    "origin_required": 403,
    "origin_mismatch": 403,
    "host_forbidden": 403,
    "plugin_disabled": 503,
    "no_active_code": 400,
    "invalid_code": 400,
    "expired": 400,
    "used": 400,
    "locked": 400,
}


# --------------------------------------------------------------------------- files


def test_files_exist():
    for name in ("api.yaml", "rpc.yaml", "owners.yaml", "events.md", "ext-protocol.md"):
        assert (CONTRACT / name).is_file(), name
    for name in ("api-types.ts", "ids.ts", "domain.schema.json"):
        assert (SHARED / name).is_file(), name
    assert GEN.is_file()


def test_yaml_parse():
    for name in ("api.yaml", "rpc.yaml", "owners.yaml"):
        data = yaml.safe_load((CONTRACT / name).read_text(encoding="utf-8"))
        assert isinstance(data, dict), name


# --------------------------------------------------------------------------- OpenAPI


def test_api_is_openapi_31(contract):
    api = contract.api
    assert str(api["openapi"]).startswith("3.1.")
    assert api["info"]["title"] and api["info"]["version"]
    assert isinstance(api["paths"], dict) and api["paths"]


def test_api_structure_and_schemas_valid(gen, contract):
    assert gen.validate_openapi(contract.api) == []


def test_rpc_meta_schema(gen, contract):
    assert gen.validate_rpc(contract.rpc) == []


def test_all_schemas_are_2020_12(gen, contract):
    for where, schema in gen.iter_schemas(contract):
        jsonschema.Draft202012Validator.check_schema(schema), where


def test_refs_resolve(gen, contract):
    assert gen.check_refs(contract) == []


def test_operation_ids_unique(gen, contract):
    ids = [op.operation_id for op in gen.iter_operations(contract)]
    assert len(ids) == len(set(ids)), [i for i in ids if ids.count(i) > 1]


# --------------------------------------------------------------------------- coverage


def test_rest_coverage(gen, contract):
    ops = {
        (op.method, op.path): op for op in gen.iter_operations(contract) if op.transport == "rest"
    }
    missing = sorted(set(REST_ROUTES) - set(ops))
    assert not missing, missing
    for key, module in REST_ROUTES.items():
        assert ops[key].module == module, (key, ops[key].module)


def test_ext_coverage(gen, contract):
    ops = {
        (op.method, op.path): op for op in gen.iter_operations(contract) if op.transport == "ext"
    }
    missing = sorted(set(EXT_ROUTES) - set(ops))
    assert not missing, missing
    for key, module in EXT_ROUTES.items():
        assert ops[key].module == module, (key, ops[key].module)


def test_rpc_coverage(contract):
    methods = contract.rpc["methods"]
    missing = sorted(set(RPC_METHODS) - set(methods))
    assert not missing, missing
    for name, module in RPC_METHODS.items():
        assert methods[name]["x-module"] == module, name
        assert methods[name]["x-unit"], name


def test_events_cover_event_names(contract, types_mod):
    assert set(contract.rpc["events"]) == set(types_mod.EVENT_NAMES)
    text = (CONTRACT / "events.md").read_text(encoding="utf-8")
    for name in types_mod.EVENT_NAMES:
        assert f"`{name}`" in text, name


def test_desktop_routes_and_dialogs(contract):
    owners = contract.owners
    assert tuple(owners["desktop_routes"]) == DESKTOP_ROUTES
    assert tuple(owners["dialogs"]) == DIALOGS
    units = set(owners["units"])
    assert set(owners["desktop_routes"].values()) <= units
    assert set(owners["dialogs"].values()) <= units
    ids_ts = (SHARED / "ids.ts").read_text(encoding="utf-8")
    for key in DESKTOP_ROUTES:
        suffix = "" if key == "home" else f"/{key}"
        assert f"`/${{PLUGIN_ID}}{suffix}`" in ids_ts, key
    for key in DIALOGS:
        assert f"'{key}'" in ids_ts or f'"{key}"' in ids_ts, key


# --------------------------------------------------------------------------- owners and modules


def test_every_operation_has_module_and_owner(gen, contract):
    modules = contract.owners["modules"]
    for op in gen.iter_operations(contract):
        assert op.module, op.operation_id
        assert op.module in modules, (op.operation_id, op.module)
        assert modules[op.module] == op.unit, (op.operation_id, op.module, op.unit)
        prefix = {"rest": "plugin/api/", "rpc": "plugin/rpc/", "ext": "plugin/ext/"}[op.transport]
        assert op.module.startswith(prefix), (op.operation_id, op.module)


def test_route_module_owners(contract):
    modules = contract.owners["modules"]
    for module in ROUTE_MODULES:
        assert modules.get(module), module
        assert (ROOT / module).is_file(), module


def test_owner_units_are_known(contract):
    units = set(contract.owners["units"])
    for module, unit in contract.owners["modules"].items():
        assert unit in units, (module, unit)


# Files that ship in the public repository and must not spell the build-time owner labels of
# ``contract/owners.yaml`` (they are bookkeeping of how the project was built, not product text).
LABEL_FREE_FILES = (
    "tests/test_contract_files.py",
    "tests/test_contract_domain.py",
    "tests/test_channels_api.py",
    "tests/test_commands.py",
    "tests/conftest.py",
    "contract/llm.md",
    "plugin/core/lists.py",
    "plugin/core/maintenance.py",
    "plugin/core/extras_hn.py",
)
LABEL_FREE_GLOBS = ("tests/fakes/*.py",)


def test_public_files_carry_no_owner_labels(contract):
    labels = sorted(map(str, contract.owners["units"]), key=len, reverse=True)
    rx = re.compile(r"(?<![\w-])(?:" + "|".join(map(re.escape, labels)) + r")(?![\w-])")
    files = [ROOT / rel for rel in LABEL_FREE_FILES]
    for pattern in LABEL_FREE_GLOBS:
        files += sorted(ROOT.glob(pattern))
    found = []
    for path in files:
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if m := rx.search(line):
                found.append(f"{path.relative_to(ROOT)}:{n}: {m.group(0)}")
    assert not found, found[:20]


def test_stub_marker_names_no_owner_label(contract):
    labels = set(map(str, contract.owners["units"]))
    stubs_dir = ROOT / "plugin" / "core"
    for path in sorted(stubs_dir.glob("*.py")):
        for m in re.finditer(r'__contract_stub__ = "([^"]+)"', path.read_text(encoding="utf-8")):
            assert m.group(1) not in labels, (path.name, m.group(1))


# --------------------------------------------------------------------------- errors


def test_error_codes_cover_domain(contract, types_mod):
    declared = contract.api["x-error-codes"]
    for err in types_mod.ERRORS:
        assert err.code in declared, err.code


def test_ext_error_codes(contract):
    declared = contract.api["x-error-codes"]
    for code, status in EXT_ERROR_CODES.items():
        assert code in declared, code
        assert declared[code]["http"] == status, code


def test_operation_errors_are_declared(gen, contract):
    declared = set(contract.api["x-error-codes"])
    for op in gen.iter_operations(contract):
        for code in op.errors:
            assert code in declared, (op.operation_id, code)


def test_rest_is_always_http_200(gen, contract):
    # the Desktop treats 401/403 as re-authentication and 5xx as backend down: REST never uses them
    for op in gen.iter_operations(contract):
        if op.transport != "rest":
            continue
        assert set(op.raw["responses"]) == {"200"}, op.operation_id


# --------------------------------------------------------------------------- invariants


def test_no_rest_approval(gen, contract):
    for op in gen.iter_operations(contract):
        if op.transport == "rpc":
            continue
        low = op.path.lower()
        assert "approve" not in low and "resubscribe" not in low, op.path


def test_approval_methods_are_rpc_only(contract):
    methods = contract.rpc["methods"]
    for name in ("cleanup.approve", "cleanup.resubscribe"):
        m = methods[name]
        assert m["approved_via"] == "desktop_rpc"
        assert m["fallback"] == {"message": "open_desktop_backend"}


def test_job_methods(contract, types_mod):
    job_kinds = {k.value for k in types_mod.JobKind}
    for name, m in contract.rpc["methods"].items():
        assert m["kind"] in ("job", "direct"), name
        if m["kind"] == "job":
            assert m["job_kind"] in job_kinds, name
            assert set(m.get("events", [])) <= set(types_mod.EVENT_NAMES), name
            assert "job_result" in m, name


def test_ext_security(gen, contract):
    for op in gen.iter_operations(contract):
        if op.transport != "ext":
            continue
        open_route = op.path in ("/health", "/pair/complete")
        sec = op.raw.get("security")
        if open_route:
            assert sec == [], op.path
        else:
            assert sec == [{"deviceToken": []}], op.path
            assert op.raw.get("x-handler"), op.path


def test_rest_routes_not_on_ext_server(gen, contract):
    for op in gen.iter_operations(contract):
        if op.transport == "rest":
            assert not op.path.startswith("/ext/") and op.path not in ("/health", "/pair/complete")


def test_status_fields(gen, contract):
    schema = gen.data_schema_resolved(contract, "getStatus")
    props = gen.collect_properties(schema)
    for f in (
        "new_total",
        "new_by_tab",
        "fav_new",
        "ext_endpoint_up",
        "ext_port",
        "last_rss_at",
        "refresh_running",
    ):
        assert f in props, f


def test_ext_state_fields(gen, contract):
    props = gen.collect_properties(gen.data_schema_resolved(contract, "extGetState"))
    for f in (
        "search_pending",
        "tabs",
        "folders",
        "home_on_youtube",
        "extras_honest_thumbnails",
        "extras_hn_lens",
        "extras_hn_channels",
        "extras_import_lists",
    ):
        assert f in props, f


# --------------------------------------------------------------------------- domain


def test_domain_schema_matches_dataclasses(gen, types_mod):
    domain = json.loads((SHARED / "domain.schema.json").read_text(encoding="utf-8"))
    defs = domain["$defs"]
    for name in ("StatusSnapshot", "ExtState", "FeedPage", "Job", "QueueItem", "ListPreview"):
        cls = getattr(types_mod, name)
        fields = [f.name for f in dataclasses.fields(cls)]
        assert list(defs[name]["properties"]) == fields, name
        assert set(defs[name]["required"]) == set(fields), name
    for err_enum in ("JobStatus", "QueueStatus", "ApprovedVia", "SyncSignal"):
        assert defs[err_enum]["enum"] == [e.value for e in getattr(types_mod, err_enum)]


def test_to_jsonable_validates_against_domain(gen, types_mod):
    t = types_mod
    samples = {
        "StatusSnapshot": t.StatusSnapshot(
            new_total=3,
            new_by_tab=(t.TabCount("all-new", "All new", 3),),
            fav_new=(t.FavNew("UC" + "a" * 22, "Channel", 1, "dQw4w9WgXcQ", "Video"),),
            ext_endpoint_up=True,
            last_rss_at=1762700000,
            refresh_running=False,
        ),
        "Job": t.Job(
            "j1",
            t.JobKind.theme,
            t.JobStatus.running,
            1,
            2,
            progress=t.Progress("search", 2, 8),
        ),
        "FeedPage": t.FeedPage(
            items=(
                t.FeedItem(
                    video=t.Video("dQw4w9WgXcQ", "UC" + "a" * 22, "T", 1762700000),
                    why=t.Why(t.WhyVia.folder, "Tech"),
                ),
            ),
            next_cursor=None,
        ),
        "ChangeRecord": t.ChangeRecord(
            1, 2, t.Actor.user, t.ChangeAction.tab_create, {"label": "x"}, t.UndoTabCreate("t1")
        ),
    }
    for name, value in samples.items():
        gen.validate_instance(gen.domain_ref(name), t.to_jsonable(value), ROOT)


# --------------------------------------------------------------------------- examples


def test_examples_validate(gen, contract):
    problems = gen.check_examples(contract)
    assert problems == [], problems[:10]


def test_every_operation_has_example(gen, contract):
    for op in gen.iter_operations(contract):
        assert op.example_data is not None or op.example_error is not None, op.operation_id


# --------------------------------------------------------------------------- generator


def test_generated_files_up_to_date(gen):
    assert gen.run_check(ROOT) == []


def test_gen_types_check_cli():
    proc = subprocess.run(
        [sys.executable, str(GEN), "--check"], cwd=ROOT, capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_ids_ts_matches_plugin_id():
    text = (ROOT / "plugin" / "_id.py").read_text(encoding="utf-8")
    plugin_id = re.search(r'PLUGIN_ID\s*=\s*"([^"]+)"', text).group(1)
    ids_ts = (SHARED / "ids.ts").read_text(encoding="utf-8")
    assert f"export const PLUGIN_ID = '{plugin_id}'" in ids_ts
    # the literal shows up in no other contract or shared file
    for path in [
        *CONTRACT.glob("*.yaml"),
        *CONTRACT.glob("*.md"),
        SHARED / "api-types.ts",
        SHARED / "domain.schema.json",
        GEN,
    ]:
        assert plugin_id not in path.read_text(encoding="utf-8"), path


def test_api_types_ts_shape():
    ts = (SHARED / "api-types.ts").read_text(encoding="utf-8")
    assert ts.startswith("// GENERATED by scripts/gen_types.py")
    for needle in (
        "export interface StatusSnapshot",
        "export interface ExtState",
        "export type Envelope<T>",
        "export type ErrorCode",
        "export interface RestRoutes",
        "export interface ExtRoutes",
        "export interface RpcMethods",
        "export interface TubeEvents",
        '"GET /status"',
        '"organize.run"',
        '"refresh.done"',
    ):
        assert needle in ts, needle


# --------------------------------------------------------------------------- negative --check


def _copy_tree(tmp_path: Path) -> Path:
    dst = tmp_path / "repo"
    for rel in ("contract", "shared", "plugin", "scripts"):
        shutil.copytree(ROOT / rel, dst / rel, ignore=shutil.ignore_patterns("__pycache__"))
    return dst


def _check(root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(root / "scripts" / "gen_types.py"), "--check", "--root", str(root)],
        capture_output=True,
        text=True,
    )


def test_check_passes_on_copy(tmp_path):
    root = _copy_tree(tmp_path)
    proc = _check(root)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_check_fails_module_without_owner(tmp_path):
    root = _copy_tree(tmp_path)
    p = root / "contract" / "owners.yaml"
    text = p.read_text(encoding="utf-8")
    stripped = re.sub(r"(?m)^  plugin/api/status\.py: .*\n", "", text)
    assert stripped != text
    p.write_text(stripped, encoding="utf-8")
    proc = _check(root)
    assert proc.returncode != 0
    assert "plugin/api/status.py" in proc.stdout + proc.stderr


def test_check_fails_route_without_module(tmp_path):
    root = _copy_tree(tmp_path)
    p = root / "contract" / "api.yaml"
    text = p.read_text(encoding="utf-8")
    assert "      x-module: plugin/api/status.py\n" in text
    p.write_text(text.replace("      x-module: plugin/api/status.py\n", "", 1), encoding="utf-8")
    proc = _check(root)
    assert proc.returncode != 0
    assert "x-module" in proc.stdout + proc.stderr


def test_check_fails_stale_types(tmp_path):
    root = _copy_tree(tmp_path)
    p = root / "shared" / "api-types.ts"
    p.write_text(p.read_text(encoding="utf-8") + "\n// tampered\n", encoding="utf-8")
    proc = _check(root)
    assert proc.returncode != 0
    assert "api-types.ts" in proc.stdout + proc.stderr


def test_check_fails_when_domain_changes(tmp_path):
    root = _copy_tree(tmp_path)
    p = root / "plugin" / "core" / "types.py"
    text = p.read_text(encoding="utf-8")
    anchor = "    devices_online: int = 0\n"
    assert anchor in text
    p.write_text(text.replace(anchor, anchor + "    extra_field: int = 0\n", 1), encoding="utf-8")
    proc = _check(root)
    assert proc.returncode != 0
    out = proc.stdout + proc.stderr
    assert "domain.schema.json" in out or "api-types.ts" in out


def test_check_fails_bad_example(tmp_path):
    root = _copy_tree(tmp_path)
    p = root / "contract" / "api.yaml"
    text = p.read_text(encoding="utf-8")
    anchor = "                  devices_online: 1\n"
    assert anchor in text
    # wrong type and unknown key in the GET /status example
    bad = "                  devices_online: one\n                  made_up_field: 1\n"
    p.write_text(text.replace(anchor, bad, 1), encoding="utf-8")
    proc = _check(root)
    out = proc.stdout + proc.stderr
    assert proc.returncode != 0
    assert "GET /status example" in out
    assert "made_up_field" in out


def test_check_fails_undeclared_error_code(tmp_path):
    root = _copy_tree(tmp_path)
    p = root / "contract" / "rpc.yaml"
    text = p.read_text(encoding="utf-8")
    anchor = "    errors: [llm_unavailable, busy, invalid]\n"
    assert anchor in text
    p.write_text(text.replace(anchor, "    errors: [llm_unavailable, no_such_code]\n", 1), "utf-8")
    proc = _check(root)
    assert proc.returncode != 0
    assert "no_such_code" in proc.stdout + proc.stderr


def test_regenerate_writes_files(tmp_path):
    root = _copy_tree(tmp_path)
    (root / "shared" / "api-types.ts").unlink()
    (root / "shared" / "domain.schema.json").unlink()
    proc = subprocess.run(
        [sys.executable, str(root / "scripts" / "gen_types.py"), "--root", str(root)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert (root / "shared" / "api-types.ts").read_bytes() == (SHARED / "api-types.ts").read_bytes()
    assert (root / "shared" / "domain.schema.json").read_bytes() == (
        SHARED / "domain.schema.json"
    ).read_bytes()
    assert _check(root).returncode == 0
