"""Domain contract: bootstrap, types, builds, SQL schema and dedup.

This file does not depend on ``tests/conftest.py``: it finds ``plugin/_bootstrap.py`` by path.
"""

from __future__ import annotations

import dataclasses
import importlib.util
import inspect
import json
import re
import shutil
import sqlite3
import sys
import typing
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugin"
BOOTSTRAP_FILE = PLUGIN_DIR / "_bootstrap.py"
SCHEMA_FILE = ROOT / "contract" / "schema.sql"


def _load_bootstrap(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_bootstrap = _load_bootstrap(BOOTSTRAP_FILE, "_tube_bootstrap_contract_test")
_bootstrap.ensure()

from tube_pkg import _id as ID  # noqa: E402
from tube_pkg.core import dedup  # noqa: E402
from tube_pkg.core import types as T  # noqa: E402


@pytest.fixture
def isolated_modules():
    """Saves and restores exactly the ``tube_pkg*`` entries in ``sys.modules``."""
    saved = {k: v for k, v in sys.modules.items() if k == "tube_pkg" or k.startswith("tube_pkg.")}
    try:
        yield saved
    finally:
        for key in [k for k in sys.modules if k == "tube_pkg" or k.startswith("tube_pkg.")]:
            del sys.modules[key]
        sys.modules.update(saved)


def _drop_tube_pkg() -> None:
    for key in [k for k in sys.modules if k == "tube_pkg" or k.startswith("tube_pkg.")]:
        del sys.modules[key]


# --------------------------------------------------------------------------- _id and _bootstrap


def test_plugin_id_shape():
    assert isinstance(ID.PLUGIN_ID, str)
    assert re.fullmatch(r"[a-z][a-z0-9-]{1,40}", ID.PLUGIN_ID)


def test_ensure_is_idempotent_and_synthetic(isolated_modules):
    first = _bootstrap.ensure()
    second = _bootstrap.ensure()
    assert first is second is sys.modules["tube_pkg"]
    assert first.__file__ is None
    assert list(first.__path__) == [str(PLUGIN_DIR)]
    assert first.__spec__.name == "tube_pkg"
    assert first.__spec__.origin is None
    assert not hasattr(first, "register")  # no plugin/__init__.py inside the package


def test_two_bootstrap_copies_share_the_same_package(isolated_modules):
    _drop_tube_pkg()
    copy_a = _load_bootstrap(BOOTSTRAP_FILE, "_tube_bootstrap_copy_a")
    copy_b = _load_bootstrap(BOOTSTRAP_FILE, "_tube_bootstrap_copy_b")
    pkg_a = copy_a.ensure()
    pkg_b = copy_b.ensure()
    assert pkg_a is pkg_b is sys.modules["tube_pkg"]
    assert copy_a.ensure() is pkg_a
    assert pkg_a.__file__ is None


def test_ensure_never_executes_plugin_init(isolated_modules, tmp_path):
    tree = tmp_path / "plugin"
    shutil.copytree(PLUGIN_DIR, tree, ignore=shutil.ignore_patterns("__pycache__", "__init__.py"))
    (tree / "__init__.py").write_text(
        "raise RuntimeError('plugin/__init__.py must not run')\n", encoding="utf-8"
    )
    _drop_tube_pkg()
    copy = _load_bootstrap(tree / "_bootstrap.py", "_tube_bootstrap_tmp_tree")
    pkg = copy.ensure()
    assert list(pkg.__path__) == [str(tree.resolve())]
    assert pkg.__file__ is None
    types_mod = importlib.import_module("tube_pkg.core.types")
    assert Path(types_mod.__file__).resolve() == (tree / "core" / "types.py").resolve()
    importlib.import_module("tube_pkg._id")


def test_ensure_keeps_existing_package_object(isolated_modules):
    existing = sys.modules["tube_pkg"]
    other = _load_bootstrap(BOOTSTRAP_FILE, "_tube_bootstrap_copy_c")
    assert other.ensure() is existing


# --------------------------------------------------------------------------- types: Protocols

PRINCIPLE_3 = {
    "crud": [
        "ChannelService",
        "TaxonomyService",
        "TabService",
        "VideoStateService",
        "VideoStore",
        "ChangeLog",
    ],
    "ops": [
        "Refresher",
        "Organizer",
        "Cleanup",
        "Themes",
        "Searcher",
        "ListImporter",
        "SyncIngest",
        "DataOps",
        "RoutinesInstaller",
    ],
    "infra": [
        "Db",
        "YouTubeClient",
        "FeedEngine",
        "Lens",
        "DeviceAuth",
        "JobRunner",
        "LLM",
        "Settings",
    ],
}


def _all_principle_3():
    return [name for group in PRINCIPLE_3.values() for name in group]


@pytest.mark.parametrize("name", _all_principle_3())
def test_principle_3_protocols_exist_and_are_runtime_checkable(name):
    proto = getattr(T, name)
    assert getattr(proto, "_is_protocol", False), name
    assert getattr(proto, "_is_runtime_protocol", False), name
    assert isinstance(object(), proto) is False
    assert name in T.PROTOCOLS
    assert (proto.__doc__ or "").strip(), f"{name} has no docstring"


def test_every_protocol_is_registered_and_runtime_checkable():
    found = {
        name
        for name, obj in vars(T).items()
        if inspect.isclass(obj)
        and getattr(obj, "_is_protocol", False)
        and obj.__module__ == T.__name__
    }
    assert found == set(T.PROTOCOLS)
    for name in found:
        assert getattr(T, name)._is_runtime_protocol, name


def test_protocol_methods_have_docstrings_and_annotations():
    for name in T.PROTOCOLS:
        proto = getattr(T, name)
        for attr, member in vars(proto).items():
            if attr.startswith("_") or not callable(member):
                continue
            assert (member.__doc__ or "").strip(), f"{name}.{attr} has no docstring"
            sig = inspect.signature(member)
            assert sig.return_annotation is not inspect.Signature.empty, f"{name}.{attr}"
            for pname, param in sig.parameters.items():
                if pname == "self" or param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                    continue
                assert param.annotation is not inspect.Parameter.empty, f"{name}.{attr}({pname})"


def _params(func) -> dict[str, inspect.Parameter]:
    return dict(inspect.signature(func).parameters)


def test_db_protocol_shape():
    for meth in ("query", "query_one", "execute", "executemany", "transaction"):
        assert callable(getattr(T.Db, meth))
    assert isinstance(inspect.getattr_static(T.Db, "path"), property)


def test_video_store_contract():
    p = _params(T.VideoStore.upsert)
    assert list(p)[1:3] == ["videos", "origin"]
    assert "set_details" in dir(T.VideoStore) and "get" in dir(T.VideoStore)
    assert list(_params(T.VideoStore.set_details))[1:4] == ["video_id", "duration_s", "is_short"]
    doc = T.VideoStore.upsert.__doc__
    assert "first_seen_at" in doc and "origin" in doc and "description" in doc


def test_cleanup_contract():
    p = _params(T.Cleanup.approve)
    assert list(p)[1:3] == ["ids", "via"]
    for meth in (
        "scan",
        "approve",
        "undo_approval",
        "queue_pending",
        "queue_result",
        "resubscribe",
    ):
        assert callable(getattr(T.Cleanup, meth)), meth
    assert {v.value for v in T.ApprovedVia} == {"desktop_rpc", "ask_choice"}
    assert T.HUMAN_APPROVAL_VIAS == frozenset({T.ApprovedVia.desktop_rpc, T.ApprovedVia.ask_choice})
    err = T.UndoRefused("already_executed")
    assert err.reason == "already_executed"
    assert isinstance(err, T.TubeError)
    assert "already_executed" in T.Cleanup.undo_approval.__doc__


def test_refresher_kick_if_due_contract():
    p = _params(T.Refresher.kick_if_due)
    assert p["force"].default is False
    hints = typing.get_type_hints(T.Refresher.kick_if_due)
    assert typing.get_origin(hints["return"]) is typing.Literal
    assert set(typing.get_args(hints["return"])) == {"started", "skipped", "running"}


def test_searcher_contract():
    p = _params(T.Searcher.search_many)
    assert list(p)[1:3] == ["requests", "timeout"]
    assert p["timeout"].default == 15.0
    assert callable(T.Searcher.search)


def test_lens_contract():
    assert list(_params(T.Lens.items))[1:4] == ["rules", "mode", "limit"]
    assert list(_params(T.Lens.enrich))[1:2] == ["items"]
    assert list(_params(T.Lens.classics))[1:3] == ["query", "limit"]


@pytest.mark.parametrize(
    "proto,meth",
    [
        ("Organizer", "organize"),
        ("Cleanup", "scan"),
        ("Themes", "create"),
        ("ListImporter", "import_list"),
        ("Refresher", "refresh_all"),
    ],
)
def test_blocking_operations_take_timeout_and_progress(proto, meth):
    p = _params(getattr(getattr(T, proto), meth))
    assert p["timeout"].kind is inspect.Parameter.KEYWORD_ONLY
    assert p["on_progress"].kind is inspect.Parameter.KEYWORD_ONLY
    assert p["on_progress"].default is None
    assert isinstance(p["timeout"].default, float)


def test_routines_installer_contract():
    assert callable(T.RoutinesInstaller.list)
    assert "confirm" in _params(T.RoutinesInstaller.install)
    assert "confirm" in _params(T.RoutinesInstaller.remove)


def test_changelog_undo_dispatch_contract():
    p = _params(T.ChangeLog.undo)
    assert "targets" in p
    target_fields = {f.name for f in dataclasses.fields(T.UndoTargets)}
    assert set(T.ChangeAction) == set(T.CHANGE_ACTION_OWNER)
    assert set(T.ChangeAction) == set(T.UNDO_TYPES)
    for action, owner in T.CHANGE_ACTION_OWNER.items():
        assert owner in target_fields, (action, owner)
    for cls in T.UNDO_TYPES.values():
        assert dataclasses.is_dataclass(cls)
        assert issubclass(cls, T.UndoData)


def test_undo_roundtrip_json():
    undo = T.UndoChannelMove(before={"UCaaaaaaaaaaaaaaaaaaaaaa": None})
    data = json.loads(json.dumps(T.undo_to_dict(undo)))
    back = T.undo_from_dict(T.ChangeAction.channel_move, data)
    assert back == undo
    tags = T.UndoChannelTags(before={"UCaaaaaaaaaaaaaaaaaaaaaa": ("t1", "t2")})
    data = json.loads(json.dumps(T.undo_to_dict(tags)))
    assert T.undo_from_dict(T.ChangeAction.channel_tags, data) == tags
    with pytest.raises(T.ValidationError):
        T.undo_from_dict(T.ChangeAction.channel_move, {"nope": 1})


# --------------------------------------------------------------------------- types: entities


def test_entities_are_frozen():
    video = T.Video(id="dQw4w9WgXcQ", channel_id="UC" + "a" * 22, title="t", published_at=1)
    with pytest.raises(dataclasses.FrozenInstanceError):
        video.title = "x"  # type: ignore[misc]
    assert video.thumb_url.endswith("/dQw4w9WgXcQ/hqdefault.jpg")


def test_ext_state_fields():
    fields = {f.name for f in dataclasses.fields(T.ExtState)}
    required = {
        "search_pending",
        "queue_pending",
        "home_on_youtube",
        "extras_honest_thumbnails",
        "extras_hn_lens",
        "extras_hn_channels",
        "extras_import_lists",
        "new_total",
        "tabs",
        "folders",
    }
    assert required <= fields


def test_status_snapshot_fields():
    fields = {f.name for f in dataclasses.fields(T.StatusSnapshot)}
    assert {
        "new_total",
        "new_by_tab",
        "fav_new",
        "ext_endpoint_up",
        "last_rss_at",
        "refresh_running",
    } <= fields


def test_why_vias():
    assert {v.value for v in T.WhyVia} == {"folder", "tag", "channel", "theme", "hn", "list"}
    why = T.Why(via=T.WhyVia.folder, label="IA")
    assert why.detail is None


def test_feed_page_shape():
    page = T.FeedPage(items=(), next_cursor=None, counts=T.FeedCounts(total=0, new=0))
    assert page.items == ()


def test_errors_have_unique_codes():
    codes = [cls.code for cls in T.ERRORS]
    assert len(codes) == len(set(codes))
    for cls in T.ERRORS:
        assert issubclass(cls, T.TubeError)
    for name in ("UndoRefused", "NotFound", "Conflict", "ApprovalRefused", "OperationTimeout"):
        assert getattr(T, name) in T.ERRORS


def test_relation_transitions_cover_enum():
    assert set(T.RELATION_TRANSITIONS) == set(T.Relation)
    assert T.Relation.ex in T.RELATION_TRANSITIONS[T.Relation.subscribed]
    assert T.Relation.ignored not in T.RELATION_TRANSITIONS[T.Relation.subscribed]


def test_tab_rules_roundtrip_and_validation():
    raw = {
        "include": {"folders": ["f1"], "tags": ["t2"], "channels": [], "lenses": ["hn"]},
        "exclude": {"channels": [], "shorts": True},
        "filters": {"only_new": True, "per_channel": 3, "min_s": 1200, "max_s": None},
        "mode": "fresh",
    }
    rules = T.TabRules.from_dict(raw)
    assert rules.include.lenses == ("hn",)
    assert rules.exclude.shorts is True
    assert rules.mode is T.FeedMode.fresh
    again = T.TabRules.from_dict(json.loads(json.dumps(rules.to_dict())))
    assert again == rules
    assert T.TabRules.from_dict({}) == T.TabRules()
    bad = [
        {"include": {"lenses": "hn"}},
        {"include": {"folder": ["x"]}},
        {"mode": "weird"},
        {"filters": {"min_s": -1}},
        {"filters": {"min_s": 100, "max_s": 10}},
        {"surprise": 1},
        {"include": {"all": "yes"}},
    ]
    for case in bad:
        with pytest.raises(T.ValidationError):
            T.TabRules.from_dict(case)


def test_settings_defaults_match_spec():
    assert T.SETTINGS_DEFAULTS == {
        "rss_interval_min": 30,
        "language": "auto",
        "home_on_youtube": True,
        "ex_retention_days": 30,
        "theme_refresh_days": 7,
        "extras_honest_thumbnails": False,
        "extras_hn_lens": False,
        "extras_hn_channels": False,
        "extras_import_lists": False,
    }
    snap = T.SettingsSnapshot()
    for key, value in T.SETTINGS_DEFAULTS.items():
        assert getattr(snap, key) == value
    assert all("." not in key for key in T.SETTINGS_DEFAULTS)


def test_export_never_carries_operational_tables():
    assert set(T.EXPORT_EXCLUDED_TABLES) >= {"unsub_queue", "jobs", "search_jobs", "devices"}


# --------------------------------------------------------------------------- builds

CORE_MODULES = (
    "plugin/core/db.py",
    "plugin/core/http.py",
    "plugin/core/youtube.py",
    "plugin/core/refresh.py",
    "plugin/core/feed.py",
    "plugin/core/video_state.py",
    "plugin/core/channels.py",
    "plugin/core/changes.py",
    "plugin/core/taxonomy.py",
    "plugin/core/tabs.py",
    "plugin/core/devices.py",
    "plugin/core/sync.py",
    "plugin/core/demo.py",
    "plugin/core/importers.py",
    "plugin/core/ai.py",
    "plugin/core/jobs.py",
    "plugin/core/organize.py",
    "plugin/core/cleanup.py",
    "plugin/core/themes.py",
    "plugin/core/search_jobs.py",
    "plugin/core/maintenance.py",
    "plugin/core/extras_hn.py",
    "plugin/core/lists.py",
)


def test_every_core_module_has_a_build_spec():
    modules = {spec.module for spec in T.BUILDS}
    for module in CORE_MODULES:
        assert module in modules, module
        owners = {s.owner for s in T.BUILDS if s.module == module}
        assert len(owners) == 1 and all(owners), (module, owners)  # one owner per file


def test_build_specs_are_consistent():
    keys = [spec.key for spec in T.BUILDS]
    assert len(keys) == len(set(keys))
    assert set(T.BUILD_SIGNATURES) == set(keys)
    for spec in T.BUILDS:
        assert spec.returns in T.PROTOCOLS, spec.key
        for dep in spec.deps + spec.optional:
            assert dep in T.DEPENDENCY_TYPES, (spec.key, dep)
        sig = T.BUILD_SIGNATURES[spec.key]
        assert sig.startswith(f"{spec.function}(*, ")
        assert sig.endswith(f"-> {spec.returns}")
        for dep in spec.deps:
            assert re.search(rf"\b{dep}\b", sig), (spec.key, dep)


def test_themes_build_signature_matches_plan():
    spec = next(s for s in T.BUILDS if s.key == "plugin/core/themes.py:build")
    assert spec.deps == (
        "db",
        "settings",
        "llm",
        "searcher",
        "lenses",
        "tabs",
        "taxonomy",
        "channels",
        "video_state",
        "video_store",
        "changelog",
    )


def test_build_graph_is_acyclic_and_resolvable():
    provider: dict[str, str] = {}
    for spec in T.BUILDS:
        provider.setdefault(spec.provides, spec.key)
    for dep, (_type, origin) in T.DEPENDENCY_TYPES.items():
        if origin == "external":
            continue
        assert dep in provider, f"nobody provides {dep}"
    graph = {
        spec.key: {
            provider[d]
            for d in spec.deps
            if T.DEPENDENCY_TYPES[d][1] != "external" and provider[d] != spec.key
        }
        for spec in T.BUILDS
    }
    done: set[str] = set()
    visiting: set[str] = set()

    def visit(node: str, path: tuple[str, ...]) -> None:
        if node in done:
            return
        assert node not in visiting, f"ciclo: {' -> '.join(path + (node,))}"
        visiting.add(node)
        for nxt in graph[node]:
            visit(nxt, path + (node,))
        visiting.discard(node)
        done.add(node)

    for node in graph:
        visit(node, ())


# --------------------------------------------------------------------------- coverage per area

AREA_CONSUMES: dict[str, list[str]] = {
    "youtube": [
        "YouTubeClient.fetch_channel_rss",
        "YouTubeClient.resolve_channel",
        "YouTubeClient.search",
        "YouTubeClient.parse_search_payload",
        "YouTubeClient.video_details",
        "YouTubeClient.is_short",
        "YouTubeClient.frame_url",
        "HttpClient.get",
        "HttpResponse.status",
        "Settings.snapshot",
        "RssFeed",
        "ChannelInfo",
        "SearchHit.to_video_in",
        "VideoDetails",
        "VideoIn",
        "YouTubeError",
        "SearchOrder",
    ],
    "refresh": [
        "Refresher.refresh_all",
        "Refresher.refresh_channel",
        "Refresher.kick_if_due",
        "Refresher.is_running",
        "Refresher.last_rss_at",
        "Refresher.mark_read",
        "Refresher.status",
        "Refresher.apply_undo",
        "VideoStore.upsert",
        "VideoStore.set_details",
        "VideoStore.get",
        "YouTubeClient.fetch_channel_rss",
        "ChannelService.list",
        "ChannelService.update_stats",
        "FeedEngine.new_counts",
        "EventSink.broadcast",
        "ChangeLog.record",
        "Db.transaction",
        "Clock.now",
        "StatusSnapshot",
        "ReadScope",
        "RefreshReport",
        "ChannelStats",
        "UndoMarkRead",
        "META_LAST_RSS_AT",
        "META_REFRESH_LOCK",
    ],
    "feed": [
        "FeedEngine.page",
        "FeedEngine.preview",
        "FeedEngine.new_counts",
        "VideoStateService.get",
        "VideoStateService.set_state",
        "VideoStateService.set_reaction",
        "VideoStateService.reactions",
        "VideoStateService.list_by_state",
        "VideoStateService.apply_undo",
        "Lens.name",
        "Lens.enabled",
        "Lens.items",
        "Lens.enrich",
        "VideoStore.set_details",
        "VideoStore.get",
        "YouTubeClient.video_details",
        "YouTubeClient.is_short",
        "TabService.get",
        "TabService.list",
        "TaxonomyService.descendants",
        "ChannelService.list",
        "TabRules.from_dict",
        "FeedPage",
        "FeedItem",
        "FeedCounts",
        "NewCounts",
        "Why",
        "LensItem",
        "BUILTIN_TAB_ALL_NEW",
        "BUILTIN_TAB_FAVORITES",
    ],
    "channels": [
        "ChannelService.get",
        "ChannelService.list",
        "ChannelService.find_duplicate",
        "ChannelService.add",
        "ChannelService.upsert_many",
        "ChannelService.update",
        "ChannelService.set_relation",
        "ChannelService.move",
        "ChannelService.set_tags",
        "ChannelService.batch",
        "ChannelService.remove_by_source",
        "ChannelService.apply_undo",
        "ChangeLog.record",
        "ChangeLog.undo",
        "ChangeLog.list",
        "ChangeLog.get",
        "ChangeLog.group",
        "Undoable.apply_undo",
        "UndoTargets",
        "CHANGE_ACTION_OWNER",
        "RELATION_TRANSITIONS",
        "YouTubeClient.resolve_channel",
        "Cleanup.propose",
        "BatchOp",
        "ChannelPatch",
        "UNSET",
    ],
    "folders-and-tabs": [
        "TaxonomyService.list_folders",
        "TaxonomyService.create_folder",
        "TaxonomyService.update_folder",
        "TaxonomyService.move_folder",
        "TaxonomyService.delete_folder",
        "TaxonomyService.reorder_folders",
        "TaxonomyService.descendants",
        "TaxonomyService.list_tags",
        "TaxonomyService.create_tag",
        "TaxonomyService.update_tag",
        "TaxonomyService.delete_tag",
        "TaxonomyService.find_folder_by_name",
        "TaxonomyService.apply_undo",
        "TabService.list",
        "TabService.create",
        "TabService.update",
        "TabService.delete",
        "TabService.reorder",
        "TabService.create_from_channels",
        "TabService.ensure_builtin",
        "TabService.validate_rules",
        "TabService.apply_undo",
        "ChannelService.move",
        "ChangeLog.record",
        "TabDraft",
        "TabPatch",
    ],
    "pairing": [
        "DeviceAuth.start_pairing",
        "DeviceAuth.complete_pairing",
        "DeviceAuth.verify",
        "DeviceAuth.revoke",
        "DeviceAuth.list",
        "DeviceAuth.any_seen_within",
        "PairingCode",
        "PairedDevice",
        "Device",
        "Unauthorized",
    ],
    "sync": [
        "SyncIngest.ingest_subscriptions",
        "SyncIngest.ingest_watch",
        "SyncIngest.ext_state",
        "ChannelService.upsert_many",
        "ChannelService.set_relation",
        "ChannelService.list",
        "Refresher.kick_if_due",
        "Searcher.pending_count",
        "Cleanup.queue_pending",
        "FeedEngine.new_counts",
        "TabService.list",
        "TaxonomyService.list_folders",
        "VideoStateService.set_state",
        "Settings.snapshot",
        "ExtState.search_pending",
        "SubscriptionBatch",
        "SyncSignal",
        "WatchEvent",
        "SyncReport",
    ],
    "data": [
        "DataOps.load_demo",
        "DataOps.clear_demo",
        "DataOps.demo_loaded",
        "DataOps.import_mytube",
        "DataOps.export_json",
        "DataOps.import_json",
        "DemoLoader.load",
        "DemoLoader.clear",
        "ChannelService.upsert_many",
        "ChannelService.remove_by_source",
        "TaxonomyService.create_folder",
        "TaxonomyService.create_tag",
        "TabService.create",
        "VideoStateService.set_state",
        "EXPORT_EXCLUDED_TABLES",
        "DataReport",
    ],
    "ai-and-jobs": [
        "LLM.available",
        "LLM.model_name",
        "LLM.complete_structured",
        "LLMBackend.complete_structured",
        "JobRunner.submit",
        "JobRunner.get",
        "JobRunner.list_active",
        "JobRunner.purge",
        "EventSink.broadcast",
        "EventSink.emit_to_session",
        "AiTask",
        "Job",
        "JobKind",
        "JobStatus",
        "Progress",
        "LLMUnavailable",
        "LLMInvalidResponse",
        "EVENT_NAMES",
    ],
    "organize": [
        "Organizer.organize",
        "Organizer.pending",
        "Organizer.accept",
        "Organizer.reject",
        "Organizer.apply_undo",
        "LLM.complete_structured",
        "ChannelService.move",
        "ChannelService.set_tags",
        "TaxonomyService.create_folder",
        "TaxonomyService.create_tag",
        "TaxonomyService.find_folder_by_name",
        "ChangeLog.group",
        "JobRunner.submit",
        "Suggestion",
        "OrganizeProposal",
        "OrganizeResult",
        "AcceptReport",
    ],
    "cleanup": [
        "Cleanup.scan",
        "Cleanup.latest_scan",
        "Cleanup.propose",
        "Cleanup.dismiss",
        "Cleanup.approve",
        "Cleanup.undo_approval",
        "Cleanup.queue_pending",
        "Cleanup.queue_result",
        "Cleanup.resubscribe",
        "Cleanup.queue",
        "Cleanup.apply_undo",
        "ChannelService.set_relation",
        "LLM.complete_structured",
        "EventSink.broadcast",
        "JobRunner.submit",
        "ApprovedVia",
        "UndoRefused",
        "ApprovalRefused",
        "QueueItem",
        "QueueAction",
        "CleanupScan",
        "CleanupCandidate",
        "CleanupGroup",
    ],
    "topic-tabs": [
        "Themes.create",
        "Themes.get",
        "Themes.list",
        "Themes.preview",
        "Themes.save",
        "Themes.refresh",
        "Themes.due",
        "Themes.apply_undo",
        "Searcher.search_many",
        "Lens.classics",
        "VideoStore.upsert",
        "TabService.create",
        "TaxonomyService.create_folder",
        "ChannelService.upsert_many",
        "VideoStateService.reactions",
        "LLM.complete_structured",
        "JobRunner.submit",
        "ChangeLog.record",
        "ThemePreview",
        "ThemeSaveEdits",
        "ThemeSaved",
        "SeedAction",
        "SearchRequest",
    ],
    "search": [
        "Searcher.search_many",
        "Searcher.search",
        "Searcher.pending_count",
        "Searcher.claim",
        "Searcher.complete",
        "Searcher.purge_expired",
        "YouTubeClient.search",
        "YouTubeClient.parse_search_payload",
        "DeviceAuth.any_seen_within",
        "SearchJob",
        "SearchOutcome",
        "SearchVia",
        "SEARCH_WINDOW_S",
    ],
    "agent-tools": [
        "Refresher.kick_if_due",
        "Refresher.status",
        "FeedEngine.page",
        "FeedEngine.preview",
        "ChannelService.list",
        "ChannelService.add",
        "Organizer.organize",
        "Cleanup.scan",
        "Themes.create",
        "TabService.create",
        "TabService.update",
        "VideoStateService.set_state",
        "VideoStateService.set_reaction",
        "TOOL_TIMEOUT_S",
    ],
    "tube-command": [
        "Cleanup.approve",
        "Cleanup.latest_scan",
        "Cleanup.scan",
        "Themes.create",
        "RoutinesInstaller.install",
        "RoutinesInstaller.list",
        "RoutinesInstaller.remove",
        "FeedEngine.page",
        "VideoStateService.set_state",
        "Refresher.status",
        "AskChoice",
        "TOOL_TIMEOUT_S",
    ],
    "routines": [
        "RoutinesInstaller.list",
        "RoutinesInstaller.install",
        "FeedEngine.page",
        "Refresher.status",
        "LLM.complete_structured",
        "ROUTINE_KEYS",
        "MAINTENANCE_SCRIPTS",
        "RoutineInfo",
        "InstallReport",
    ],
    "maintenance": [
        "Maintenance.run",
        "ChannelService.list",
        "ChannelService.set_relation",
        "Themes.due",
        "Themes.refresh",
        "JobRunner.purge",
        "Searcher.purge_expired",
        "Clock.now",
        "Settings.snapshot",
        "MaintenanceReport",
        "MAINTENANCE_SCRIPTS",
    ],
    "extras-hn": [
        "Lens.name",
        "Lens.enabled",
        "Lens.items",
        "Lens.enrich",
        "Lens.classics",
        "VideoStore.upsert",
        "TabService.create",
        "ChannelService.list",
        "HttpClient.get",
        "HttpClient.download_to",
        "Settings.set",
        "ExtrasState",
        "HN_LENS",
    ],
    "list-import": [
        "ListImporter.import_list",
        "ListImporter.get_preview",
        "ListImporter.to_tab",
        "HttpClient.get",
        "LLM.complete_structured",
        "YouTubeClient.resolve_channel",
        "VideoStore.upsert",
        "TabService.create",
        "ChannelService.upsert_many",
        "ListPreview",
        "ListEntry",
    ],
    "extras-ui": ["ExtrasState", "ListPreview", "ListEntry"],
}

IMPLEMENTS: dict[str, list[str]] = {
    "plugin/core/youtube.py": ["YouTubeClient"],
    "plugin/core/refresh.py": ["Refresher", "VideoStore"],
    "plugin/core/feed.py": ["FeedEngine"],
    "plugin/core/video_state.py": ["VideoStateService"],
    "plugin/core/channels.py": ["ChannelService"],
    "plugin/core/changes.py": ["ChangeLog"],
    "plugin/core/taxonomy.py": ["TaxonomyService"],
    "plugin/core/tabs.py": ["TabService"],
    "plugin/core/devices.py": ["DeviceAuth"],
    "plugin/core/sync.py": ["SyncIngest"],
    "plugin/core/importers.py": ["DataOps"],
    "plugin/core/demo.py": ["DemoLoader"],
    "plugin/core/ai.py": ["LLM"],
    "plugin/adapters/hermes_llm.py": ["LLMBackend", "EventSink"],
    "plugin/core/jobs.py": ["JobRunner"],
    "plugin/core/organize.py": ["Organizer"],
    "plugin/core/cleanup.py": ["Cleanup"],
    "plugin/core/themes.py": ["Themes"],
    "plugin/core/search_jobs.py": ["Searcher"],
    "plugin/routines/installer.py": ["RoutinesInstaller"],
    "plugin/core/maintenance.py": ["Maintenance"],
    "plugin/core/extras_hn.py": ["Lens"],
    "plugin/core/lists.py": ["ListImporter"],
}


def _resolve(name: str) -> bool:
    head, _, tail = name.partition(".")
    obj = getattr(T, head, None)
    if obj is None:
        return False
    if not tail:
        return True
    if dataclasses.is_dataclass(obj) and tail in {f.name for f in dataclasses.fields(obj)}:
        return True
    return hasattr(obj, tail)


@pytest.mark.parametrize("area", sorted(AREA_CONSUMES))
def test_area_contract_coverage(area):
    missing = [name for name in AREA_CONSUMES[area] if not _resolve(name)]
    assert not missing, f"{area}: missing from the contract {missing}"


@pytest.mark.parametrize("module", sorted(IMPLEMENTS))
def test_module_builds_its_protocols(module):
    provided = {s.returns for s in T.BUILDS if s.module == module}
    for proto in IMPLEMENTS[module]:
        assert proto in provided, f"{module} implements {proto} but has no build"


def test_undoable_services_expose_apply_undo():
    for field in dataclasses.fields(T.UndoTargets):
        assert field.name in T.UNDO_TARGET_TYPES
        proto = getattr(T, T.UNDO_TARGET_TYPES[field.name])
        assert hasattr(proto, "apply_undo"), field.name


# --------------------------------------------------------------------------- SQL schema

UC = "UC" + "a" * 22
UC2 = "UC" + "b" * 22


@pytest.fixture
def conn():
    con = sqlite3.connect(":memory:")
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
    yield con
    con.close()


EXPECTED_TABLES = {
    "meta",
    "channels",
    "folders",
    "tags",
    "channel_tags",
    "videos",
    "video_state",
    "watermarks",
    "tabs",
    "themes",
    "theme_items",
    "suggestions",
    "cleanup_candidates",
    "unsub_queue",
    "jobs",
    "search_jobs",
    "watch_history",
    "changes",
    "devices",
    "pair_codes",
    "hn_videos",
    "list_imports",
}


def test_schema_applies_and_is_idempotent(conn):
    names = {
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        if not r[0].startswith("sqlite_")
    }
    assert names == EXPECTED_TABLES
    conn.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
    version = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
    assert int(version) == T.SCHEMA_VERSION
    code = "\n".join(
        line.split("--", 1)[0] for line in SCHEMA_FILE.read_text(encoding="utf-8").splitlines()
    )
    assert "pragma" not in code.lower(), "PRAGMAs (WAL etc.) belong to whoever opens the connection"


def test_schema_columns(conn):
    def cols(table: str) -> set[str]:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}

    assert {"description", "origin", "first_seen_at", "duration_s", "is_short"} <= cols("videos")
    assert {"approved_via", "approved_at", "status", "action"} <= cols("unsub_queue")
    assert {"expires_at", "query", "search_order", "status", "payload"} <= cols("search_jobs")
    assert {"kind", "payload", "status", "model"} <= cols("suggestions")
    assert {"kind", "status", "progress", "result", "error"} <= cols("jobs")
    assert {"rules", "filters", "kind", "builtin"} <= cols("tabs")
    assert {"group_id", "undone_at", "undo", "actor", "action"} <= cols("changes")


def _insert_channel(conn, cid=UC, **kw):
    row = {
        "id": cid,
        "title": "x",
        "relation": "subscribed",
        "source": "extension",
        "added_at": 1,
    }
    row.update(kw)
    keys = ",".join(row)
    marks = ",".join("?" for _ in row)
    conn.execute(f"INSERT INTO channels ({keys}) VALUES ({marks})", tuple(row.values()))


def _queue(conn, qid, **kw):
    row = {
        "id": qid,
        "channel_id": UC,
        "action": "unsubscribe",
        "approved_at": 1,
        "approved_via": "desktop_rpc",
        "status": "approved",
        "created_at": 1,
        "updated_at": 1,
    }
    row.update(kw)
    keys = ",".join(row)
    marks = ",".join("?" for _ in row)
    conn.execute(f"INSERT INTO unsub_queue ({keys}) VALUES ({marks})", tuple(row.values()))


def test_enums_accepted_by_schema(conn):
    for i, rel in enumerate(T.Relation):
        _insert_channel(conn, "UC" + str(i) * 22, relation=rel.value)
    for i, src in enumerate(T.ChannelSource):
        _insert_channel(conn, "UC" + chr(ord("k") + i) * 22, source=src.value)
    _insert_channel(conn)
    _insert_channel(conn, UC2)
    for status in T.QueueStatus:
        cid = UC2 if status is T.QueueStatus.running else UC
        _queue(conn, f"q-{status.value}", status=status.value, channel_id=cid)
    for via in T.ApprovedVia:
        _queue(conn, f"v-{via.value}", approved_via=via.value, status="done")
    for action in T.QueueAction:
        _queue(conn, f"a-{action.value}", action=action.value, status="failed")
    for i, origin in enumerate(T.VideoOrigin):
        conn.execute(
            "INSERT INTO videos (id, channel_id, title, first_seen_at, origin)"
            " VALUES (?, ?, 't', 1, ?)",
            (f"vid{i:08d}", UC, origin.value),
        )
    for i, state in enumerate(T.VideoState):
        conn.execute(
            "INSERT INTO video_state (video_id, state, reaction, updated_at) VALUES (?, ?, ?, 1)",
            (f"vid{i:08d}", state.value, list(T.Reaction)[i % 2].value),
        )
    for i, kind in enumerate(T.TabKind):
        conn.execute(
            "INSERT INTO tabs (id, name, kind, rules, sort, builtin, created_at, updated_at)"
            " VALUES (?, 'n', ?, '{}', 0, 0, 1, 1)",
            (f"tab{i}", kind.value),
        )
    for i, kind in enumerate(T.SuggestionKind):
        for j, status in enumerate(T.SuggestionStatus):
            conn.execute(
                "INSERT INTO suggestions (id, kind, payload, status, created_at)"
                " VALUES (?, ?, '{}', ?, 1)",
                (f"s{i}{j}", kind.value, status.value),
            )
    for i, kind in enumerate(T.JobKind):
        for j, status in enumerate(T.JobStatus):
            conn.execute(
                "INSERT INTO jobs (id, kind, status, created_at, updated_at)"
                " VALUES (?, ?, ?, 1, 1)",
                (f"j{i}{j}", kind.value, status.value),
            )
    for i, order in enumerate(T.SearchOrder):
        for j, status in enumerate(T.SearchJobStatus):
            conn.execute(
                "INSERT INTO search_jobs (id, batch_id, query, search_order, status, created_at,"
                " expires_at) VALUES (?, 'b', 'q', ?, ?, 1, 16)",
                (f"sj{i}{j}", order.value, status.value),
            )
    for i, actor in enumerate(T.Actor):
        conn.execute(
            "INSERT INTO changes (ts, actor, action, payload, undo) VALUES (1, ?, ?, '{}', '{}')",
            (actor.value, list(T.ChangeAction)[i].value),
        )
    for i, status in enumerate(T.ThemeStatus):
        conn.execute(
            "INSERT INTO themes (id, query, status, created_at, updated_at)"
            " VALUES (?, 'q', ?, 1, 1)",
            (f"th{i}", status.value),
        )
    for i, verdict in enumerate(T.ThemeVerdict):
        for j, source in enumerate(T.ThemeItemSource):
            conn.execute(
                "INSERT INTO theme_items (theme_id, video_id, source, verdict)"
                " VALUES ('th0', ?, ?, ?)",
                (f"vi{i}{j:07d}x", source.value, verdict.value),
            )
    for i, group in enumerate(T.CleanupGroup):
        for j, status in enumerate(T.CandidateStatus):
            conn.execute(
                "INSERT INTO cleanup_candidates (id, scan_id, channel_id, group_key, why, status,"
                " created_at) VALUES (?, 's', ?, ?, 'w', ?, 1)",
                (f"c{i}{j}x", UC, group.value, status.value),
            )


def _rejects(conn, sql, params=()):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql, params)


def test_schema_checks_reject_invalid_values(conn):
    _insert_channel(conn)
    _rejects(
        conn,
        "INSERT INTO channels (id, title, relation, source, added_at)"
        " VALUES (?, 'x', 'fan', 'link', 1)",
        (UC2,),
    )
    _rejects(
        conn,
        "INSERT INTO channels (id, title, relation, source, added_at)"
        " VALUES (?, 'x', 'followed', 'x', 1)",
        (UC2,),
    )
    _rejects(
        conn,
        "INSERT INTO channels (id, title, relation, source, added_at)"
        " VALUES ('@handle', 'x', 'followed', 'link', 1)",
    )
    _rejects(
        conn,
        "INSERT INTO channels (id, title, relation, source, added_at, favorite)"
        " VALUES (?, 'x', 'followed', 'link', 1, 2)",
        (UC2,),
    )
    # queue: human approval is mandatory and has a known value
    with pytest.raises(sqlite3.IntegrityError):
        _queue(conn, "q1", approved_via="rest")
    with pytest.raises(sqlite3.IntegrityError):
        _queue(conn, "q2", approved_via="tool")
    with pytest.raises(sqlite3.IntegrityError):
        _queue(conn, "q3", approved_via=None)
    with pytest.raises(sqlite3.IntegrityError):
        _queue(conn, "q4", approved_at=None)
    with pytest.raises(sqlite3.IntegrityError):
        _queue(conn, "q5", status="pending")
    with pytest.raises(sqlite3.IntegrityError):
        _queue(conn, "q6", action="delete")
    # one active item per channel and action
    _queue(conn, "q7")
    with pytest.raises(sqlite3.IntegrityError):
        _queue(conn, "q8", status="running")
    _queue(conn, "q9", action="resubscribe")
    _queue(conn, "q10", status="done")
    _rejects(
        conn,
        "INSERT INTO videos (id, channel_id, title, first_seen_at, origin)"
        " VALUES ('abcdefghijk', ?, 't', 1, 'tiktok')",
        (UC,),
    )
    _rejects(
        conn,
        "INSERT INTO videos (id, channel_id, title, first_seen_at, origin)"
        " VALUES ('short', ?, 't', 1, 'rss')",
        (UC,),
    )
    _rejects(
        conn,
        "INSERT INTO video_state (video_id, state, updated_at) VALUES ('abcdefghijk', 'liked', 1)",
    )
    _rejects(
        conn,
        "INSERT INTO video_state (video_id, state, reaction, updated_at)"
        " VALUES ('abcdefghijk', 'seen', 'love', 1)",
    )
    tab = (
        "INSERT INTO tabs (id, name, kind, rules, sort, builtin, created_at, updated_at)"
        " VALUES (?, 'n', ?, ?, 0, 0, 1, 1)"
    )
    _rejects(conn, tab, ("t1", "playlist", "{}"))
    _rejects(conn, tab, ("t2", "category", "not json"))
    _rejects(conn, tab, ("t3", "category", "[]"))
    _rejects(conn, tab, ("t4", "category", '{"include": {"lenses": "hn"}}'))
    conn.execute(tab, ("t5", "mixed", '{"include": {"lenses": ["hn"]}, "mode": "classics"}'))
    _rejects(
        conn,
        "INSERT INTO suggestions (id, kind, payload, status, created_at)"
        " VALUES ('s1', 'banana', '{}', 'pending', 1)",
    )
    _rejects(
        conn,
        "INSERT INTO jobs (id, kind, status, created_at, updated_at)"
        " VALUES ('j1', 'organize', 'paused', 1, 1)",
    )
    _rejects(
        conn,
        "INSERT INTO jobs (id, kind, status, created_at, updated_at)"
        " VALUES ('j2', 'mining', 'queued', 1, 1)",
    )
    _rejects(
        conn,
        "INSERT INTO search_jobs (id, batch_id, query, search_order, status, created_at)"
        " VALUES ('sj1', 'b', 'q', 'relevance', 'pending', 1)",
    )
    _rejects(
        conn,
        "INSERT INTO search_jobs (id, batch_id, query, search_order, status, created_at,"
        " expires_at) VALUES ('sj2', 'b', 'q', 'views', 'pending', 1, 16)",
    )
    _rejects(
        conn,
        "INSERT INTO changes (ts, actor, action, payload, undo)"
        " VALUES (1, 'robot', 'x', '{}', '{}')",
    )
    _rejects(
        conn,
        "INSERT INTO devices (id, name, token_hash, created_at) VALUES ('d1', 'n', NULL, 1)",
    )


def test_schema_foreign_keys(conn):
    conn.execute("INSERT INTO folders (id, name, sort, created_at) VALUES ('f1', 'F', 0, 1)")
    _insert_channel(conn, folder_id="f1")
    conn.execute("INSERT INTO tags (id, name, created_at) VALUES ('t1', 'T', 1)")
    conn.execute("INSERT INTO channel_tags (channel_id, tag_id) VALUES (?, 't1')", (UC,))
    _rejects(conn, "INSERT INTO channel_tags (channel_id, tag_id) VALUES (?, 'nope')", (UC,))
    conn.execute("DELETE FROM folders WHERE id='f1'")
    assert conn.execute("SELECT folder_id FROM channels").fetchone()[0] is None
    conn.execute("DELETE FROM tags WHERE id='t1'")
    assert conn.execute("SELECT COUNT(*) FROM channel_tags").fetchone()[0] == 0


# --------------------------------------------------------------------------- dedup

CID = "UCBJycsmduvYEL83R_U4JriQ"
VID = "dQw4w9WgXcQ"

CHANNEL_REF_CASES = [
    (CID, ("id", CID)),
    (f"  {CID}  ", ("id", CID)),
    (f"https://www.youtube.com/channel/{CID}", ("id", CID)),
    (f"https://youtube.com/channel/{CID}/videos?view=0", ("id", CID)),
    (f"http://m.youtube.com/channel/{CID}#about", ("id", CID)),
    (f"youtube.com/channel/{CID}", ("id", CID)),
    (f"www.youtube.com/channel/{CID}/", ("id", CID)),
    ("@MKBHD", ("handle", "@mkbhd")),
    ("mkbhd", None),
    ("https://www.youtube.com/@MKBHD", ("handle", "@mkbhd")),
    ("https://www.youtube.com/@mkbhd/videos", ("handle", "@mkbhd")),
    ("https://m.youtube.com/@MKBHD?si=abc", ("handle", "@mkbhd")),
    ("youtube.com/@MKBHD/", ("handle", "@mkbhd")),
    ("https://www.youtube.com/@%E3%81%82%E3%81%84", ("handle", "@あい")),
    ("@Café.Tech", ("handle", "@café.tech")),
    ("https://www.youtube.com/c/LinusTechTips", ("custom", "linustechtips")),
    ("https://www.youtube.com/c/LinusTechTips/videos", ("custom", "linustechtips")),
    ("https://www.youtube.com/user/marquesbrownlee", ("user", "marquesbrownlee")),
    ("https://youtube.com/user/MarquesBrownlee?feature=x", ("user", "marquesbrownlee")),
    ("https://www.youtube.com/LinusTechTips", ("custom", "linustechtips")),
    (f"https://www.youtube.com/watch?v={VID}", ("video", VID)),
    (f"https://youtu.be/{VID}", ("video", VID)),
    ("https://www.youtube.com/feed/channels", None),
    ("https://www.youtube.com/results?search_query=x", None),
    ("https://example.com/@mkbhd", None),
    ("https://www.youtube.com/", None),
    ("", None),
    ("   ", None),
    ("not a url at all", None),
]


@pytest.mark.parametrize("text,expected", CHANNEL_REF_CASES)
def test_parse_channel_ref(text, expected):
    ref = dedup.parse_channel_ref(text)
    if expected is None:
        assert ref is None
    else:
        assert ref is not None
        assert (ref.kind, ref.value) == expected


VIDEO_CASES = [
    (VID, VID),
    (f"https://www.youtube.com/watch?v={VID}", VID),
    (f"https://www.youtube.com/watch?v={VID}&t=42s&list=PL123", VID),
    (f"https://www.youtube.com/watch?feature=share&v={VID}", VID),
    (f"https://m.youtube.com/watch?v={VID}", VID),
    (f"youtube.com/watch?v={VID}", VID),
    (f"https://youtu.be/{VID}", VID),
    (f"https://youtu.be/{VID}?si=xyz&t=3", VID),
    (f"youtu.be/{VID}", VID),
    (f"https://www.youtube.com/shorts/{VID}", VID),
    (f"https://youtube.com/shorts/{VID}?feature=share", VID),
    (f"https://m.youtube.com/shorts/{VID}", VID),
    (f"https://www.youtube.com/live/{VID}", VID),
    (f"https://www.youtube.com/embed/{VID}", VID),
    (f"https://www.youtube-nocookie.com/embed/{VID}", VID),
    (f"https://music.youtube.com/watch?v={VID}", VID),
    ("https://www.youtube.com/watch?v=short", None),
    ("https://www.youtube.com/watch", None),
    (f"https://example.com/watch?v={VID}", None),
    (f"https://www.youtube.com/channel/{CID}", None),
    ("dQw4w9WgXc", None),
    ("", None),
]


@pytest.mark.parametrize("text,expected", VIDEO_CASES)
def test_parse_video_id(text, expected):
    assert dedup.parse_video_id(text) == expected


HANDLE_CASES = [
    ("@MKBHD", "@mkbhd"),
    ("MKBHD", "@mkbhd"),
    ("  @mkbhd ", "@mkbhd"),
    ("@@mkbhd", None),
    ("@Café", "@café"),
    ("@Cafe\u0301", "@café"),
    ("@ÇÃO_tv", "@ção_tv"),
    ("@straße", "@strasse"),
    ("@a-b.c_d", "@a-b.c_d"),
    ("@has space", None),
    ("@bad/slash", None),
    ("@", None),
    ("", None),
    ("@%E3%81%82", "@あ"),
]


@pytest.mark.parametrize("text,expected", HANDLE_CASES)
def test_normalize_handle(text, expected):
    assert dedup.normalize_handle(text) == expected


NAME_CASES = [
    ("Ciência Todo Dia", "ciencia todo dia"),
    ("  CIÊNCIA   todo\tdia ", "ciencia todo dia"),
    ("Café\u0301", "cafe"),
    ("ＭＫＢＨＤ", "mkbhd"),
    ("Straße", "strasse"),
    ("A\u200bB", "ab"),
    ("", ""),
]


@pytest.mark.parametrize("text,expected", NAME_CASES)
def test_normalize_name(text, expected):
    assert dedup.normalize_name(text) == expected


def test_channel_id_and_video_id_predicates():
    assert dedup.is_channel_id(CID)
    assert not dedup.is_channel_id(CID.lower())
    assert not dedup.is_channel_id(CID[:-1])
    assert not dedup.is_channel_id("@" + CID)
    assert dedup.is_video_id(VID)
    assert not dedup.is_video_id(VID + "x")


def test_canonical_channel_url():
    assert dedup.canonical_channel_url(f"youtube.com/channel/{CID}/videos") == (
        f"https://www.youtube.com/channel/{CID}"
    )
    assert dedup.canonical_channel_url("https://m.youtube.com/@MKBHD?x=1") == (
        "https://www.youtube.com/@mkbhd"
    )
    assert dedup.canonical_channel_url("@MKBHD") == "https://www.youtube.com/@mkbhd"
    assert dedup.canonical_channel_url("https://www.youtube.com/c/Foo") == (
        "https://www.youtube.com/c/foo"
    )
    assert dedup.canonical_channel_url(f"https://youtu.be/{VID}") is None
    assert dedup.canonical_video_url(f"https://youtu.be/{VID}?t=1") == (
        f"https://www.youtube.com/watch?v={VID}"
    )


def test_channel_match_keys_ordered_by_strength():
    keys = dedup.channel_match_keys(
        channel_id=CID,
        handle="@MKBHD",
        url="https://www.youtube.com/c/MKBHD",
        title="Marques Brownlee",
    )
    assert keys == (
        f"id:{CID}",
        "handle:@mkbhd",
        "custom:mkbhd",
        "name:marques brownlee",
    )
    # a channel URL with redundant id and handle does not duplicate keys
    keys = dedup.channel_match_keys(channel_id=CID, url=f"https://youtube.com/channel/{CID}")
    assert keys == (f"id:{CID}",)
    assert dedup.channel_match_keys() == ()
    assert dedup.channel_match_keys(title="   ") == ()


def test_same_channel():
    a = dedup.channel_match_keys(handle="@Café.Tech", title="Café Tech")
    b = dedup.channel_match_keys(url="https://m.youtube.com/@CAFÉ.TECH/videos")
    assert dedup.same_channel(a, b)
    c = dedup.channel_match_keys(channel_id=CID, title="Café Tech")
    d = dedup.channel_match_keys(channel_id="UC" + "z" * 22, title="Café Tech")
    assert not dedup.same_channel(c, d), "different ids are never the same channel"
    e = dedup.channel_match_keys(title="Cafe tech")
    assert dedup.same_channel(a, e)
    assert not dedup.same_channel(e, a, allow_name=False)


def test_dedup_is_pure():
    src = Path(dedup.__file__).read_text(encoding="utf-8")
    for forbidden in ("import socket", "import http", "import urllib.request", "httpx", "requests"):
        assert forbidden not in src
