"""Fakes, harness, AI prompts, ``Db`` conformance and queue invariants."""

from __future__ import annotations

import inspect
import json
import re
import sys
from pathlib import Path

import pytest
from fakes import (
    FAKES,
    FakeClock,
    FakeCtx,
    FakeHttp,
    FakeJobRunner,
    FakeLens,
    FakeLLM,
    FakeLLMBackend,
    FakeSettings,
    FakeYouTube,
    MemDb,
    build_fake_world,
)
from fakes.db_conformance import CHECKS, DbConformance, run_conformance
from fakes.invariants import INVARIANTS, QueueImpls, run_invariants
from fakes.world import SeedWorld

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import prompts as P
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"

UC1 = "UCtestfake000000000000a1"
UC2 = "UCtestfake000000000000b2"


@pytest.fixture
def fresh_world():
    world = build_fake_world(MemDb())
    yield world
    world.db.close()


# --------------------------------------------------------------------------- Protocols


def test_every_protocol_has_a_fake():
    assert set(FAKES) == set(T.PROTOCOLS)


@pytest.mark.parametrize("name", T.PROTOCOLS)
def test_fake_instances_satisfy_protocols(fresh_world, name):
    proto = getattr(T, name)
    instance = fresh_world.instances()[name]
    assert isinstance(instance, proto), name
    assert isinstance(instance, FAKES[name]), name


def _protocol_methods(proto):
    for attr in dir(proto):
        if attr.startswith("_"):
            continue
        member = inspect.getattr_static(proto, attr)
        if isinstance(member, property) or callable(member):
            yield attr, member


@pytest.mark.parametrize("name", T.PROTOCOLS)
def test_fake_signatures_accept_protocol_calls(name):
    """Stronger than ``runtime_checkable``: every Protocol parameter exists in the fake with the
    same name and kind, and any extra parameter of the fake has a default."""
    proto = getattr(T, name)
    fake = FAKES[name]
    for attr, member in _protocol_methods(proto):
        fake_member = inspect.getattr_static(fake, attr, None)
        assert fake_member is not None, f"{fake.__name__}.{attr} ausente"
        if isinstance(member, property):
            assert isinstance(fake_member, property), f"{fake.__name__}.{attr} must be a property"
            continue
        want = inspect.signature(member).parameters
        got = inspect.signature(getattr(fake, attr)).parameters
        for pname, param in want.items():
            if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                continue
            assert pname in got, f"{fake.__name__}.{attr} missing parameter {pname}"
            assert got[pname].kind == param.kind, f"{fake.__name__}.{attr}({pname}) kind"
            if param.default is not inspect.Parameter.empty:
                assert got[pname].default == param.default, f"{fake.__name__}.{attr}({pname})"
        for pname, param in got.items():
            if pname not in want and param.kind not in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                assert param.default is not inspect.Parameter.empty, (
                    f"{fake.__name__}.{attr}: extra parameter {pname} has no default"
                )


# --------------------------------------------------------------------------- Db


class TestMemDbConformance(DbConformance):
    @pytest.fixture
    def make_db(self):
        made: list[MemDb] = []

        def factory() -> MemDb:
            made.append(MemDb())
            return made[-1]

        yield factory
        for db in made:
            db.close()


def test_run_conformance_outside_pytest():
    results = run_conformance(MemDb)
    assert set(results) == {name for name, _ in CHECKS}
    assert all(v is None for v in results.values()), results


def test_conformance_catches_a_broken_db():
    class NoForeignKeys(MemDb):
        def __init__(self) -> None:
            super().__init__()
            self.execute("PRAGMA foreign_keys = OFF")

    results = run_conformance(NoForeignKeys)
    assert results["check_foreign_keys_on"] is not None


def test_memdb_path_and_schema():
    db = MemDb()
    assert db.path == ":memory:"
    assert db.query_one("SELECT value FROM meta WHERE key = 'schema_version'") == {
        "value": str(T.SCHEMA_VERSION)
    }
    assert db.query_one("PRAGMA foreign_keys") == {"foreign_keys": 1}


def test_db_fixture_is_a_db(db):
    assert isinstance(db, T.Db)
    assert db.query_one("SELECT COUNT(*) AS n FROM channels") == {"n": 0}


# --------------------------------------------------------------------------- invariants


@pytest.mark.parametrize("name", [n for n, _ in INVARIANTS])
def test_queue_invariants_hold_on_fakes(fresh_world, name):
    dict(INVARIANTS)[name](QueueImpls.from_world(fresh_world))


def test_queue_invariants_on_seeded_world(world, seed_world):
    assert isinstance(seed_world, SeedWorld)
    impls = QueueImpls.from_world(world, prefix="seeded")
    for _name, check in INVARIANTS:
        check(impls)


def test_run_invariants_reports_each():
    worlds = []

    def make():
        worlds.append(build_fake_world(MemDb()))
        return QueueImpls.from_world(worlds[-1])

    results = run_invariants(make)
    assert set(results) == {n for n, _ in INVARIANTS}
    assert all(v is None for v in results.values()), results


INVARIANT_FAILURE = (AssertionError, pytest.fail.Exception)


def test_invariants_catch_a_cleanup_that_approves_anything(fresh_world):
    cleanup = fresh_world.cleanup
    cleanup.strict_via = False  # simulates a wrong implementation
    with pytest.raises(INVARIANT_FAILURE):
        dict(INVARIANTS)["only_human_vias_approve"](QueueImpls.from_world(fresh_world))


def test_invariants_catch_undo_that_requeues(fresh_world, monkeypatch):
    cleanup = fresh_world.cleanup
    original = cleanup.undo_approval

    def bad_undo(queue_ids):
        original(queue_ids)
        rows = fresh_world.db.query(
            "SELECT channel_id FROM unsub_queue WHERE id = ?", (queue_ids[0],)
        )
        cleanup.approve([rows[0]["channel_id"]], T.ApprovedVia.desktop_rpc)
        return []

    monkeypatch.setattr(cleanup, "undo_approval", bad_undo)
    with pytest.raises(INVARIANT_FAILURE):
        dict(INVARIANTS)["undo_and_batch_never_create_approved"](QueueImpls.from_world(fresh_world))


def test_invariants_catch_origin_overwrite(fresh_world, monkeypatch):
    store = fresh_world.video_store
    original = store.upsert

    def bad_upsert(videos, origin):
        result = original(videos, origin)
        for v in videos:
            fresh_world.db.execute(
                "UPDATE videos SET origin = ? WHERE id = ?", (origin.value, v.id)
            )
        return result

    monkeypatch.setattr(store, "upsert", bad_upsert)
    with pytest.raises(INVARIANT_FAILURE):
        dict(INVARIANTS)["first_video_origin_wins"](QueueImpls.from_world(fresh_world))


def test_invariants_catch_export_leak(fresh_world, monkeypatch):
    data = fresh_world.data
    original = data.export_json

    def leaky():
        out = original()
        out["unsub_queue"] = fresh_world.db.query("SELECT * FROM unsub_queue")
        return out

    monkeypatch.setattr(data, "export_json", leaky)
    with pytest.raises(INVARIANT_FAILURE):
        dict(INVARIANTS)["export_import_never_carry_operational_tables"](
            QueueImpls.from_world(fresh_world)
        )


# --------------------------------------------------------------------------- seed_world


def test_seed_world_is_consistent(world, seed_world):
    s = seed_world
    db = world.db
    channels = world.channels.list()
    assert 10 <= len(channels) <= 14
    assert {c.id for c in channels} == set(s.channels.values())
    rels = {c.relation for c in channels}
    assert {T.Relation.subscribed, T.Relation.followed, T.Relation.ex} <= rels
    assert sum(c.favorite for c in channels) >= 2
    assert any(c.muted for c in channels)
    # 3 folders, nested
    folders = world.taxonomy.list_folders()
    assert len(folders) == 3
    assert any(f.parent_id for f in folders)
    root = s.folders["Tecnologia"]
    assert set(world.taxonomy.descendants(root)) == {root, s.folders["IA"]}
    assert len(world.taxonomy.list_tags()) == 4
    # every channel with a folder points to an existing folder; tags exist
    folder_ids = {f.id for f in folders}
    tag_ids = {t.id for t in world.taxonomy.list_tags()}
    for c in channels:
        assert c.folder_id is None or c.folder_id in folder_ids
        assert set(c.tag_ids) <= tag_ids
    # videos: new and seen, 1 Short, description
    videos = world.video_store.get(list(s.videos.values()))
    assert len(videos) == len(s.videos)
    shorts = [v for v in videos.values() if v.is_short]
    assert [v.id for v in shorts] == [s.short_video]
    assert all(v.description for v in videos.values() if v.origin is T.VideoOrigin.rss)
    assert s.new_videos and s.seen_videos
    assert not set(s.new_videos) & set(s.seen_videos)
    # the watermark explains new × seen
    for vid in s.new_videos:
        v = videos[vid]
        wm = db.query_one("SELECT seen_up_to FROM watermarks WHERE channel_id = ?", (v.channel_id,))
        assert wm is None or v.published_at > wm["seen_up_to"]
    states = world.video_state.get(list(s.videos.values()))
    assert {r.state for r in states.values()} >= {T.VideoState.seen, T.VideoState.later}
    # tabs: default + theme
    tabs = {t.id: t for t in world.tabs.list()}
    assert T.BUILTIN_TAB_ALL_NEW in tabs and T.BUILTIN_TAB_FAVORITES in tabs
    theme_tab = tabs[s.theme_tab]
    assert theme_tab.kind is T.TabKind.theme
    assert theme_tab.rules.include.themes == (s.theme,)
    theme = world.themes.get(s.theme)
    assert theme is not None and theme.status is T.ThemeStatus.saved
    assert world.themes.preview(s.theme).items
    # the fake engine sees the world
    page = world.feed.page(T.BUILTIN_TAB_ALL_NEW, limit=100)
    assert page.items and all(item.is_new for item in page.items)
    assert {i.video.id for i in page.items} <= set(s.new_videos)
    counts = world.feed.new_counts()
    assert counts.total == len({i.video.id for i in page.items})
    assert world.feed.page(s.theme_tab).items
    # nothing operational in the seeded world
    for table in ("unsub_queue", "jobs", "search_jobs", "devices"):
        assert db.query_one(f"SELECT COUNT(*) AS n FROM {table}") == {"n": 0}
    # clean history: seeding does not record user actions
    assert world.changelog.list() == []


def test_seed_world_is_deterministic():
    a = build_fake_world(MemDb())
    b = build_fake_world(MemDb())
    from fakes.world import seed_world

    sa, sb = seed_world(a), seed_world(b)
    assert sa == sb
    dump = "SELECT * FROM {} ORDER BY 1"
    for table in ("channels", "folders", "tags", "videos", "video_state", "tabs", "themes"):
        assert a.db.query(dump.format(table)) == b.db.query(dump.format(table)), table


# --------------------------------------------------------------------------- prompts


def test_prompts_cover_every_ai_task():
    assert set(P.TASKS) == set(T.AiTask)
    assert len(P.TASKS) == 6
    for task, spec in P.TASKS.items():
        assert spec.task is task
        assert re.fullmatch(r"\d+\.\d+\.\d+", spec.version), task
        assert spec.schema_name and re.fullmatch(r"[a-z0-9_]+", spec.schema_name)
        assert len(spec.instructions) > 200, task
        assert spec.output_schema["type"] == "object"
        assert spec.input_schema["type"] == "object"
        assert spec.max_input_chars > 0


def test_prompt_schemas_use_supported_keywords():
    for spec in P.TASKS.values():
        for schema in (spec.input_schema, spec.output_schema):
            assert P.unsupported_keywords(schema) == set(), spec.task


def test_prompt_examples_validate():
    for task, spec in P.TASKS.items():
        assert P.validate_input(task, spec.example_input) == [], task
        assert P.validate_output(task, spec.example_output) == [], task


def test_prompt_schemas_agree_with_jsonschema():
    jsonschema = pytest.importorskip("jsonschema")
    for spec in P.TASKS.values():
        for schema, example in (
            (spec.input_schema, spec.example_input),
            (spec.output_schema, spec.example_output),
        ):
            jsonschema.Draft202012Validator.check_schema(schema)
            jsonschema.Draft202012Validator(schema).validate(example)


@pytest.mark.parametrize(
    "schema,value,ok",
    [
        ({"type": "integer"}, 1, True),
        ({"type": "integer"}, True, False),
        ({"type": "number"}, 1.5, True),
        ({"type": "number"}, False, False),
        ({"type": ["string", "null"]}, None, True),
        ({"type": "string", "maxLength": 3}, "abcd", False),
        ({"type": "string", "minLength": 1}, "", False),
        ({"type": "string", "pattern": "^UC"}, "UCx", True),
        ({"type": "string", "pattern": "^UC"}, "xUC", False),
        ({"enum": ["a", "b"]}, "c", False),
        ({"type": "array", "items": {"type": "string"}, "maxItems": 1}, ["a", "b"], False),
        ({"type": "array", "minItems": 1}, [], False),
        ({"type": "number", "minimum": 0, "maximum": 1}, 1.1, False),
        (
            {
                "type": "object",
                "properties": {"a": {"type": "string"}},
                "required": ["a"],
                "additionalProperties": False,
            },
            {"a": "x", "b": 1},
            False,
        ),
        ({"type": "object", "required": ["a"]}, {}, False),
        ({"type": "object", "additionalProperties": {"type": "integer"}}, {"x": 1}, True),
    ],
)
def test_validator_basics(schema, value, ok):
    errors = P.validate(schema, value)
    assert (errors == []) is ok, errors


def test_validator_agrees_with_jsonschema_on_examples():
    jsonschema = pytest.importorskip("jsonschema")
    for spec in P.TASKS.values():
        schema = spec.output_schema
        broken = json.loads(json.dumps(spec.example_output))
        broken["surprise"] = 1
        for value in (spec.example_output, broken, {}, [], None):
            ours = P.validate(schema, value) == []
            theirs = jsonschema.Draft202012Validator(schema).is_valid(value)
            assert ours == theirs, (spec.task, value)


def test_digest_input_has_title_and_description():
    spec = P.TASKS[T.AiTask.digest]
    item = spec.input_schema["properties"]["items"]["items"]
    assert {"video_id", "title", "description"} <= set(item["required"])
    bad = {"items": [{"video_id": "abcdefghijk", "title": "t", "channel_title": "c"}]}
    assert P.validate_input(T.AiTask.digest, bad)


def test_prepare_input_trims_to_limits():
    long_text = "x" * 50_000
    payload = {"url": "https://example.com/post", "text": long_text}
    prepared = P.prepare_input(T.AiTask.list_extract, payload)
    assert len(prepared["text"]) == P.LIST_EXTRACT_MAX_CHARS == 12_000
    assert payload["text"] == long_text, "does not mutate the input"
    digest = {
        "items": [
            {
                "video_id": "abcdefghijk",
                "title": "t" * 1000,
                "description": "d" * 10_000,
                "channel_title": "c",
            }
        ]
    }
    out = P.prepare_input(T.AiTask.digest, digest)
    assert len(out["items"][0]["description"]) <= P.LIMITS["description_chars"]
    assert len(out["items"][0]["title"]) <= P.LIMITS["title_chars"]
    text = P.render_input(T.AiTask.digest, digest)
    assert len(text) <= P.TASKS[T.AiTask.digest].max_input_chars
    assert P.render_input(T.AiTask.digest, digest) == text, "deterministic"


def test_batches_respect_count_and_size_without_losing_items():
    big = {
        "items": [
            {
                "channel_id": f"UC{i:022d}",
                "title": "t" * 500,
                "description": "d" * 5_000,
                "recent_titles": ["r" * 300] * 9,
            }
            for i in range(150)
        ],
        "folders": [f"Pasta {i}" for i in range(50)],
        "tags": ["a"],
    }
    chunks = P.batches(T.AiTask.organize, big)
    spec = P.TASKS[T.AiTask.organize]
    assert sum(len(c["items"]) for c in chunks) == 150
    assert [it["channel_id"] for c in chunks for it in c["items"]] == [
        it["channel_id"] for it in big["items"]
    ]
    for chunk in chunks:
        assert 1 <= len(chunk["items"]) <= spec.batch_size
        assert chunk["folders"] == big["folders"], "context repeated in each batch"
        assert len(P.render_input(T.AiTask.organize, chunk)) <= spec.max_input_chars
    tight = P.batches(
        T.AiTask.digest,
        {
            "items": [
                {"video_id": f"v{i:010d}", "title": "x" * 300, "description": "y" * 900}
                for i in range(400)
            ]
        },
    )
    assert all(len(c["items"]) <= T.LLM_BATCH_VIDEOS for c in tight)
    assert sum(len(c["items"]) for c in tight) == 400
    with pytest.raises(T.ValidationError):
        P.render_input(
            T.AiTask.digest,
            {
                "items": [
                    {"video_id": f"v{i:010d}", "title": "x" * 300, "description": "y" * 900}
                    for i in range(400)
                ]
            },
        )
    merged = P.merge_outputs(T.AiTask.digest, [{"items": [1]}, {"items": [2, 3]}])
    assert merged == {"items": [1, 2, 3]}
    assert P.batches(T.AiTask.theme_expand, {"query": "x"}) == [{"query": "x"}]


def test_batching_metadata():
    assert P.TASKS[T.AiTask.organize].batch_size == T.LLM_BATCH_CHANNELS
    assert P.TASKS[T.AiTask.cleanup_reasons].batch_size == T.LLM_BATCH_CHANNELS
    assert P.TASKS[T.AiTask.theme_curate].batch_size == T.LLM_BATCH_VIDEOS
    assert P.TASKS[T.AiTask.digest].batch_size == T.LLM_BATCH_VIDEOS
    assert P.TASKS[T.AiTask.theme_expand].batch_size is None
    assert P.TASKS[T.AiTask.list_extract].batch_size is None
    for spec in P.TASKS.values():
        if spec.batch_size:
            assert spec.list_key == "items"
            assert "items" in spec.output_schema["required"]


def test_llm_md_documents_every_task():
    text = (ROOT / "contract" / "llm.md").read_text(encoding="utf-8")
    assert P.PROMPTS_VERSION in text
    for task, spec in P.TASKS.items():
        assert f"`{task.value}`" in text, task
        assert spec.version in text, task
        for key in spec.output_schema["properties"]:
            assert f"`{key}`" in text or f'"{key}"' in text, (task, key)
        assert spec.schema_name in text, task
        for example in (spec.example_input, spec.example_output):
            assert json.dumps(example, ensure_ascii=False) in text, f"exemplo de {task} divergiu"


def test_prompts_module_is_pure():
    src = Path(P.__file__).read_text(encoding="utf-8")
    imports = [line for line in src.splitlines() if line.startswith(("import ", "from "))]
    for line in imports:
        assert not any(bad in line for bad in ("hermes", "agent", "socket", "urllib", "httpx"))
        assert "tests" not in line and "fakes" not in line


# --------------------------------------------------------------------------- FakeLLM


def test_fake_llm_scripted_per_task():
    llm = FakeLLM()
    out = {"items": [{"video_id": "abcdefghijk", "summary": "Resumo."}]}
    llm.script(T.AiTask.digest, out)
    payload = {
        "items": [
            {"video_id": "abcdefghijk", "title": "t", "description": "d", "channel_title": "c"}
        ]
    }
    assert llm.complete_structured(T.AiTask.digest, payload) == out
    assert llm.calls == [(T.AiTask.digest, payload)]
    with pytest.raises(AssertionError, match="digest"):
        llm.complete_structured(T.AiTask.digest, payload)


def test_fake_llm_refuses_output_outside_schema():
    llm = FakeLLM()
    llm.script(T.AiTask.theme_expand, {"name": "IA"})
    with pytest.raises(T.LLMInvalidResponse):
        llm.complete_structured(T.AiTask.theme_expand, {"query": "agentes de IA"})
    llm.script(T.AiTask.organize, {"items": [{"channel_id": UC1, "folder": "x"}]})
    with pytest.raises(T.LLMInvalidResponse):
        llm.complete_structured(
            T.AiTask.organize, {"items": [{"channel_id": UC1, "title": "t"}], "folders": []}
        )


def test_fake_llm_refuses_bad_input_and_errors():
    llm = FakeLLM()
    with pytest.raises(T.ValidationError):
        llm.complete_structured(T.AiTask.theme_expand, {"nope": 1})
    llm.script(T.AiTask.theme_expand, T.OperationTimeout("lento"))
    with pytest.raises(T.OperationTimeout):
        llm.complete_structured(T.AiTask.theme_expand, {"query": "x"})
    off = FakeLLM(available=False)
    assert off.available() is False and off.model_name() is None
    with pytest.raises(T.LLMUnavailable):
        off.complete_structured(T.AiTask.theme_expand, {"query": "x"})


def test_fake_llm_auto_responses_are_valid():
    llm = FakeLLM(auto=True)
    for task, spec in P.TASKS.items():
        out = llm.complete_structured(task, spec.example_input)
        assert P.validate_output(task, out) == [], task
    expand = llm.complete_structured(T.AiTask.theme_expand, {"query": "agentes de IA"})
    assert 5 <= len(expand["searches"]) <= 8


def test_fake_llm_callable_response_and_progress():
    llm = FakeLLM()
    llm.script(
        T.AiTask.cleanup_reasons,
        lambda payload: {
            "items": [
                {"channel_id": it["channel_id"], "group": "stale", "why": "parado"}
                for it in payload["items"]
            ]
        },
    )
    seen = []
    out = llm.complete_structured(
        T.AiTask.cleanup_reasons,
        {"items": [{"channel_id": UC1, "title": "t", "rule_group": "stale"}]},
        on_progress=seen.append,
    )
    assert out["items"][0]["channel_id"] == UC1
    assert seen and isinstance(seen[-1], T.Progress)


def test_fake_llm_backend_records_and_scripts():
    be = FakeLLMBackend()
    be.script({"ok": 1}, T.LLMInvalidResponse("lixo"))
    kw = dict(instructions="i", input_text="x", json_schema={}, schema_name="s", timeout=5.0)
    assert be.complete_structured(**kw) == {"ok": 1}
    with pytest.raises(T.LLMInvalidResponse):
        be.complete_structured(**kw)
    assert len(be.calls) == 2 and be.calls[0]["schema_name"] == "s"


# --------------------------------------------------------------------------- other fakes


def test_fake_settings():
    s = FakeSettings(extras_hn_lens=True)
    assert s.get("extras_hn_lens") is True
    assert s.get("rss_interval_min") == 30
    assert s.get("unknown", 7) == 7
    assert s.snapshot().extras_hn_lens is True
    s.set("language", "pt-BR")
    assert s.snapshot().language == "pt-BR"
    with pytest.raises(T.ValidationError):
        s.set("nope", 1)
    with pytest.raises(T.ValidationError):
        s.set("rss_interval_min", "30")
    with pytest.raises(T.ValidationError):
        s.set("home_on_youtube", 1)


def test_fake_clock_and_http(tmp_path):
    clock = FakeClock(100)
    assert clock.now() == 100
    clock.advance(5)
    assert clock.now() == 105
    http = FakeHttp({"https://www.youtube.com/x": "<html>ok</html>"})
    resp = http.get("https://www.youtube.com/x")
    assert resp.status == 200 and resp.text == "<html>ok</html>"
    assert http.get("https://www.youtube.com/missing").status == 404
    http.routes["https://hackertube.org/boom"] = T.HttpError("rede")
    with pytest.raises(T.HttpError):
        http.get("https://hackertube.org/boom")
    dest = tmp_path / "f.bin"
    assert http.download_to("https://www.youtube.com/x", str(dest)) == len("<html>ok</html>")
    assert [c[0] for c in http.requests][:2] == ["https://www.youtube.com/x"] * 1 + [
        "https://www.youtube.com/missing"
    ]


def test_fake_job_runner_sync_and_deferred():
    from fakes import FakeEventSink

    events = FakeEventSink()
    jobs = FakeJobRunner(events=events)

    def work(progress):
        progress(T.Progress("a", 1, 2))
        return {"n": 1}

    job = jobs.submit(T.JobKind.organize, work, event="organize.done", progress_event="p")
    assert job.status is T.JobStatus.queued
    done = jobs.get(job.id)
    assert done.status is T.JobStatus.done and done.result == {"n": 1}
    assert done.progress == T.Progress("a", 1, 2)
    assert ("organize.done", {"job": job.id, "status": "done"}) in events.events

    def fail(_progress):
        raise T.LLMUnavailable("sem modelo")

    bad = jobs.submit(T.JobKind.theme, fail, session_id="s1", event="theme.ready")
    got = jobs.get(bad.id)
    assert got.status is T.JobStatus.error
    assert got.error == {"code": "llm_unavailable", "message": "sem modelo"}
    assert events.session_events[-1][0] == "s1"

    deferred = FakeJobRunner(defer=True)
    j = deferred.submit(T.JobKind.digest, lambda p: 1)
    assert [x.id for x in deferred.list_active()] == [j.id]
    deferred.run_pending()
    assert deferred.get(j.id).status is T.JobStatus.done
    assert deferred.purge(older_than=10**12) == 1


def test_fake_lens():
    video = T.Video(id="abcdefghijk", channel_id=UC1, title="t", published_at=1)
    item = T.LensItem(video=video, why=T.Why(T.WhyVia.hn, "HN", "discutido"), badges=("hn",))
    lens = FakeLens(items=[item], details={"abcdefghijk": "o HN gosta"}, enabled=False)
    assert lens.name == T.HN_LENS
    assert lens.items(T.TabRules(), T.FeedMode.fresh, 10) == []
    feed_item = T.FeedItem(video=video, why=T.Why(T.WhyVia.folder, "IA"))
    assert lens.enrich([feed_item]) == [feed_item]
    lens.set_enabled(True)
    assert lens.items(T.TabRules(), T.FeedMode.fresh, 10) == [item]
    (enriched,) = lens.enrich([feed_item])
    assert enriched.badges == ("hn",) and enriched.why.detail == "o HN gosta"
    assert enriched.video == video


def test_fake_youtube_in_memory():
    yt = FakeYouTube()
    info = T.ChannelInfo(id=UC1, title="Canal", handle="@canal")
    yt.add_channel(info, "https://www.youtube.com/c/Canal")
    assert yt.resolve_channel("@Canal") == info
    assert yt.resolve_channel(f"https://youtube.com/channel/{UC1}") == info
    assert yt.resolve_channel("https://www.youtube.com/c/canal") == info
    with pytest.raises(T.ValidationError):
        yt.resolve_channel("not a url at all")
    with pytest.raises(T.YouTubeError):
        yt.resolve_channel("@ninguem")
    vid = T.VideoIn(id="abcdefghijk", channel_id=UC1, title="t", description="d")
    yt.add_rss(T.RssFeed(channel=info, videos=(vid,)))
    assert yt.fetch_channel_rss(UC1).videos == (vid,)
    with pytest.raises(T.YouTubeError):
        yt.fetch_channel_rss(UC2)
    hit = T.SearchHit(video_id="abcdefghijk", title="t", channel_id=UC1)
    yt.add_search("agentes", [hit])
    assert yt.search("agentes") == [hit]
    assert yt.search("agentes", T.SearchOrder.date) == [hit]
    assert yt.search("nada") == []
    yt.add_short("abcdefghijk")
    assert yt.is_short("abcdefghijk") and not yt.is_short("zzzzzzzzzzz")
    assert yt.frame_url("abcdefghijk") == "https://i.ytimg.com/vi/abcdefghijk/hq2.jpg"
    yt.add_details(T.VideoDetails("abcdefghijk", 61))
    assert yt.video_details("abcdefghijk").duration_s == 61
    assert ("search", "agentes") in yt.calls


def test_fake_youtube_parses_search_payload():
    payload = {
        "contents": {
            "x": [
                {
                    "videoRenderer": {
                        "videoId": "abcdefghijk",
                        "title": {"runs": [{"text": "Agentes "}, {"text": "de IA"}]},
                        "ownerText": {
                            "runs": [
                                {
                                    "text": "Canal",
                                    "navigationEndpoint": {"browseEndpoint": {"browseId": UC1}},
                                }
                            ]
                        },
                        "lengthText": {"simpleText": "1:02:03"},
                        "viewCountText": {"simpleText": "1.234 visualizações"},
                        "publishedTimeText": {"simpleText": "3 days ago"},
                    }
                }
            ]
        }
    }
    yt = FakeYouTube()
    (hit,) = yt.parse_search_payload(payload)
    assert hit.video_id == "abcdefghijk" and hit.title == "Agentes de IA"
    assert hit.channel_id == UC1 and hit.duration_s == 3723 and hit.views == 1234
    html = "<script>var ytInitialData = " + json.dumps(payload) + ";</script>"
    assert yt.parse_search_payload(html)[0].video_id == "abcdefghijk"


def _fixture_files(pattern: str) -> list[Path]:
    if not FIXTURES.is_dir():
        return []
    return sorted(p for p in FIXTURES.rglob(pattern) if p.is_file())


def test_fake_youtube_reads_real_rss_fixture():
    candidates = [p for p in _fixture_files("*.xml") if "yt:channelId" in p.read_text("utf-8")]
    if not candidates:
        pytest.skip("tests/fixtures/ has no RSS yet")
    yt = FakeYouTube(fixtures_dir=FIXTURES)
    assert yt.loaded_rss, "nenhum RSS indexado"
    for channel_id in yt.loaded_rss:
        feed = yt.fetch_channel_rss(channel_id)
        assert feed.channel.id == channel_id and feed.videos
        assert all(len(v.id) == 11 and v.published_at for v in feed.videos)


def test_fake_youtube_reads_real_search_fixture():
    candidates = [
        p
        for p in _fixture_files("*")
        if "search" in p.name.lower() and p.suffix in {".html", ".json"}
    ]
    candidates = [p for p in candidates if "videoRenderer" in p.read_text("utf-8", "replace")]
    if not candidates:
        pytest.skip("tests/fixtures/ has no search page yet")
    yt = FakeYouTube()
    hits = yt.parse_search_payload(candidates[0].read_text("utf-8"))
    assert len(hits) >= 5
    assert all(len(h.video_id) == 11 and h.channel_id.startswith("UC") for h in hits)


# --------------------------------------------------------------------------- FakeCtx


def test_fake_ctx_registrations_and_dispatch():
    ctx = FakeCtx(config={"language": "pt-BR"})
    assert ctx.plugin_id == PLUGIN_ID
    ctx.register_tool("tube_status", "tube", {"name": "tube_status"}, lambda args, **kw: "{}")
    ctx.register_command("tube", lambda raw: "ok", description="d")
    ctx.register_rpc("cleanup.approve", lambda params, **kw: {"ok": True})
    ctx.register_hook("pre_llm_call", lambda **kw: None)
    ctx.register_auxiliary_task("curator", display_name="Curador", description="d")
    ctx.register_middleware("tool_request", lambda x: x)
    assert [t["name"] for t in ctx.tools] == ["tube_status"]
    assert "tube" in ctx.commands and "cleanup.approve" in ctx.rpc
    assert ctx.rpc_method("cleanup.approve") == f"plugin.{PLUGIN_ID}.cleanup.approve"
    assert ctx.hooks["pre_llm_call"] and "curator" in ctx.aux_tasks
    assert ctx.registrations["register_middleware"]
    assert ctx.get_config("language") == "pt-BR"
    assert ctx.get_config("nope", 3) == 3
    assert ctx.dispatch_tool("tube_status", {}) == "{}"
    ctx.tool_responses["cronjob_manage"] = lambda args: json.dumps({"ok": True, "args": args})
    assert json.loads(ctx.dispatch_tool("cronjob_manage", {"a": 1}))["ok"] is True
    assert "error" in json.loads(ctx.dispatch_tool("missing_tool", {}))
    assert [d[0] for d in ctx.dispatched] == ["tube_status", "cronjob_manage", "missing_tool"]
    assert ctx.emit_to_session("s1", "theme.ready", {"x": 1}) is True
    assert ctx.session_events == [("s1", "theme.ready", {"x": 1})]


def test_fake_ctx_ask_choice_script():
    ctx = FakeCtx()
    choices = [{"value": "approve", "label": "Aprovar grupo"}, "cancelar"]
    ctx.script_choices("approve", "Aprovar grupo", lambda q, c: "cancelar", None)
    assert ctx.ask_choice("Faxina?", choices) == "approve"
    assert ctx.ask_choice("Faxina?", choices) == "approve", "label maps to the value"
    assert ctx.ask_choice("Faxina?", choices) == "cancelar"
    assert ctx.ask_choice("Faxina?", choices) is None
    assert ctx.ask_choice("Sem roteiro", choices) is None, "no human = None"
    ctx.script_choices("outra coisa")
    assert ctx.ask_choice("?", choices) is None, "answer outside the options = None"
    assert len(ctx.asked) == 6


def test_fake_ctx_llm():
    ctx = FakeCtx()
    ctx.llm.script({"items": []})
    res = ctx.llm.complete_structured(
        instructions="i",
        input=[{"type": "text", "text": "x"}],
        json_schema={"type": "object"},
        schema_name="s",
        task="curator",
    )
    assert res.parsed == {"items": []} and json.loads(res.text) == {"items": []}
    assert res.model == ctx.llm.model and ctx.llm.calls[0]["task"] == "curator"


def test_fake_ctx_blueprint_uses_real_class():
    try:
        from cron.blueprint_catalog import AutomationBlueprint
    except ImportError:
        pytest.skip("Hermes not importable in this environment")
    ctx = FakeCtx()
    ctx.register_automation_blueprint(
        "bom-dia",
        title="Bom dia",
        description="Novos dos favoritos",
        schedule_template="{minute} {hour} * * *",
        prompt_template="Resumo",
        slots=[{"name": "time", "type": "time", "label": "Hora", "default": "08:00"}],
    )
    (bp,) = ctx.blueprints
    assert isinstance(bp, AutomationBlueprint)
    assert bp.key.endswith(":bom-dia") and bp.plugin
    with pytest.raises(ValueError):
        ctx.register_automation_blueprint(
            "bad key!",
            title="x",
            description="x",
            schedule_template="* * * * *",
            prompt_template="x",
        )
    lenient = FakeCtx(strict=False)
    assert (
        lenient.register_automation_blueprint(
            "bad key!", title="x", description="x", schedule_template="x", prompt_template="x"
        )
        is None
    )
    assert lenient.blueprint_errors


# --------------------------------------------------------------------------- services (samples)


def test_changelog_group_undo_dispatches_to_owners(fresh_world):
    w = fresh_world
    w.channels.upsert_many(
        [T.ChannelIn(title="A", channel_id=UC1)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    with w.changelog.group("organizar") as gid:
        folder = w.taxonomy.create_folder("IA")
        w.channels.move([UC1], folder.id)
    entries = w.changelog.list()
    assert [e.action for e in entries] == [
        T.ChangeAction.channel_move,
        T.ChangeAction.folder_create,
    ]
    assert {e.group_id for e in entries} == {gid}
    undone = w.changelog.undo(entries[-1].id, targets=w.targets())
    assert len(undone) == 2
    assert w.channels.get(UC1).folder_id is None
    assert w.taxonomy.list_folders() == []
    with pytest.raises(T.UndoRefused):
        w.changelog.undo(entries[0].id, targets=w.targets())


def test_channel_service_rules(fresh_world):
    w = fresh_world
    w.youtube.add_channel(T.ChannelInfo(id=UC2, title="Bê", handle="@be"))
    ch = w.channels.add("@be")
    assert ch.relation is T.Relation.followed and ch.source is T.ChannelSource.link
    assert w.channels.add("https://www.youtube.com/@BE").id == UC2, "dedup"
    with pytest.raises(T.Conflict):
        w.channels.add("@be", relation=T.Relation.subscribed)
    with pytest.raises(T.Conflict):
        w.channels.set_relation(UC2, T.Relation.ex)  # followed → ex forbidden
    assert w.channels.find_duplicate(title="BÊ") is not None
    with pytest.raises(T.NotFound):
        w.channels.update("UCnope00000000000000000x", T.ChannelPatch(title="x"))


def test_fake_world_targets_cover_undo_owners(fresh_world):
    targets = fresh_world.targets()
    for owner in set(T.CHANGE_ACTION_OWNER.values()):
        assert getattr(targets, owner) is not None, owner


def test_fake_routines_installer_confirm():
    world = build_fake_world(MemDb())
    report = world.routines.install(lambda q, c: None)
    assert report.cancelled and not report.installed
    report = world.routines.install(lambda q, c: "install")
    assert set(report.installed) == set(T.ROUTINE_KEYS)
    assert {r.key for r in world.routines.list() if r.installed} == set(T.ROUTINE_KEYS)
    again = world.routines.install(lambda q, c: "install")
    assert set(again.skipped) == set(T.ROUTINE_KEYS)


def test_themes_pipeline_with_fake_llm_and_searcher():
    llm = FakeLLM(auto=True)
    world = build_fake_world(MemDb(), llm=llm)
    hits = [
        T.SearchHit(video_id=f"themevid{i:03d}", title=f"Agentes {i}", channel_id=UC1)
        for i in range(4)
    ]
    world.searcher.script("*", hits)
    stages: list[str] = []
    preview = world.themes.create("agentes de IA", on_progress=lambda p: stages.append(p.stage))
    assert preview.theme.status is T.ThemeStatus.preview
    assert len(world.searcher.batches) == 1, "a single search_many"
    assert {"expand", "search", "curate", "preview"} <= set(stages)
    stored = world.video_store.get([h.video_id for h in hits])
    assert {v.origin for v in stored.values()} == {T.VideoOrigin.search}
    saved = world.themes.save(preview.theme.id)
    assert saved.tab.kind is T.TabKind.theme
    assert world.feed.page(saved.tab.id).items


def test_theme_save_is_one_undoable_group():
    world = build_fake_world(MemDb(), llm=FakeLLM(auto=True))
    hits = [
        T.SearchHit(video_id=f"seedhit{i:04d}", title=f"V{i}", channel_id=UC1, channel_title="A")
        for i in range(3)
    ]
    world.searcher.script("*", hits)
    preview = world.themes.create("tema")
    assert [s.channel_id for s in preview.seeds] == [UC1], "≥ 3 kept videos = seed"
    edits = T.ThemeSaveEdits(
        create_folder=True, folder_name="Tema", seed_actions={UC1: T.SeedAction.subscribe}
    )
    saved = world.themes.save(preview.theme.id, edits)
    assert saved.followed == (UC1,) and saved.to_subscribe == (UC1,)
    assert world.channels.get(UC1).relation is T.Relation.followed, "subscribing is human"
    assert world.channels.get(UC1).folder_id == saved.folder_id
    world.changelog.undo(saved.change_id, targets=world.targets())
    assert world.tabs.get(saved.tab.id) is None
    assert world.taxonomy.get_folder(saved.folder_id) is None
    assert world.channels.get(UC1) is None
    assert world.themes.get(preview.theme.id).status is T.ThemeStatus.preview


def test_organizer_accept_and_undo(fresh_world):
    w = fresh_world
    w.channels.upsert_many(
        [T.ChannelIn(title="A", channel_id=UC1), T.ChannelIn(title="B", channel_id=UC2)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    w.llm.script(
        T.AiTask.organize,
        lambda payload: {
            "items": [
                {
                    "channel_id": it["channel_id"],
                    "folder": "Tecnologia/IA",
                    "new_folder": True,
                    "tags": ["aprender"],
                    "confidence": 0.8,
                    "why": "IA",
                }
                for it in payload["items"]
            ]
        },
    )
    result = w.organizer.organize()
    assert len(result.suggestions) == 2 and result.model == "fake-model"
    assert w.channels.get(UC1).folder_id is None, "nothing applied before the accept"
    report = w.organizer.accept(channel_ids=[UC1], edits={UC1: T.OrganizeEdit(tags=())})
    assert len(report.accepted) == 1 and len(report.created_folders) == 2
    ia = w.taxonomy.find_folder_by_name("IA")
    assert w.channels.get(UC1).folder_id == ia.id
    assert w.channels.get(UC1).tag_ids == (), "the user's edit won"
    assert [s.channel_id for s in w.organizer.pending()] == [UC2]
    rec = next(r for r in w.changelog.list() if r.action is T.ChangeAction.organize_accept)
    w.changelog.undo(rec.id, targets=w.targets())
    assert w.channels.get(UC1).folder_id is None
    assert w.taxonomy.list_folders() == []
    assert {s.channel_id for s in w.organizer.pending()} == {UC1, UC2}
    assert w.organizer.reject(channel_ids=[UC2]) == 1


def test_refresher_cycle_kick_and_mark_read(fresh_world):
    w = fresh_world
    w.channels.upsert_many(
        [T.ChannelIn(title="A", channel_id=UC1)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    now = w.clock.now()
    info = T.ChannelInfo(id=UC1, title="A")
    w.youtube.add_rss(
        T.RssFeed(
            channel=info,
            videos=(T.VideoIn(id="rssvideo001", channel_id=UC1, title="x", published_at=now - 60),),
        )
    )
    assert w.refresher.kick_if_due() == "started"
    report = w.refresher.refresh_all()
    assert report.new_videos == 1 and not report.errors
    assert w.refresher.last_rss_at() == now
    assert ("refresh.done", {"new_videos": 1}) in w.events.events
    assert w.channels.get(UC1).last_video_at == now - 60
    assert w.refresher.kick_if_due() == "skipped"
    assert w.refresher.kick_if_due(force=True) == "started"
    w.refresher.set_running(True)
    assert w.refresher.kick_if_due() == "running"
    with pytest.raises(T.Busy):
        w.refresher.refresh_all()
    w.refresher.set_running(False)
    assert w.refresher.refresh_all().new_videos == 0, "re-running does not duplicate"
    assert w.feed.new_counts().total == 1
    assert w.refresher.mark_read(T.ReadScope(T.ReadScopeKind.all)) == 1
    assert w.feed.new_counts().total == 0
    rec = w.changelog.list()[0]
    w.changelog.undo(rec.id, targets=w.targets())
    assert w.feed.new_counts().total == 1
    status = w.refresher.status()
    assert status.new_total == 1 and status.ext_endpoint_up is True
    w.ext_up = False
    assert w.refresher.status().ext_endpoint_up is False


def test_sync_ingest_partial_never_marks_absent(fresh_world):
    w = fresh_world
    both = (T.ChannelIn(title="A", channel_id=UC1), T.ChannelIn(title="B", channel_id=UC2))
    first = w.sync.ingest_subscriptions("dev-1", T.SubscriptionBatch(both, T.SyncSignal.complete))
    assert set(first.added) == {UC1, UC2}
    only_a = (both[0],)
    partial = w.sync.ingest_subscriptions(
        "dev-1", T.SubscriptionBatch(only_a, T.SyncSignal.partial)
    )
    assert partial.marked_ex == () and w.channels.get(UC2).relation is T.Relation.subscribed
    complete = w.sync.ingest_subscriptions(
        "dev-1", T.SubscriptionBatch(only_a, T.SyncSignal.complete)
    )
    assert complete.marked_ex == (UC2,)
    assert w.channels.get(UC2).relation is T.Relation.ex
    again = w.sync.ingest_subscriptions("dev-1", T.SubscriptionBatch(only_a, T.SyncSignal.complete))
    assert again.added == () and again.marked_ex == (), "reenvio idempotente"
    events = [T.WatchEvent("abcdefghijk", 100, UC1), T.WatchEvent("abcdefghijk", 100, UC1)]
    assert w.sync.ingest_watch("dev-1", events) == 1
    assert w.sync.ingest_watch("dev-1", events) == 0
    assert w.video_state.get(["abcdefghijk"])["abcdefghijk"].state is T.VideoState.watched
    state = w.sync.ext_state("dev-1")
    assert state.device_id == "dev-1" and state.search_pending == 0
    assert ("all", False) in w.refresher.kicks, "/ext/state calls kick_if_due"


def test_cleanup_scan_rules_ai_and_no_model(world, seed_world):
    w, s = world, seed_world
    stale = s.stale_channel
    off = s.channels["linus"]

    def answer(payload):
        out = []
        for it in payload["items"]:
            group = it["rule_group"] or ("off_profile" if it["channel_id"] == off else "keep")
            out.append({"channel_id": it["channel_id"], "group": group, "why": f"motivo {group}"})
        return {"items": out}

    w.llm.script(T.AiTask.cleanup_reasons, answer)
    relations = {c.id: c.relation for c in w.channels.list()}
    scan = w.cleanup.scan()
    groups = {c.channel_id: c.group for c in scan.candidates}
    assert groups == {stale: T.CleanupGroup.stale, off: T.CleanupGroup.off_profile}
    assert {c.id: c.relation for c in w.channels.list()} == relations, (
        "scan does not change channels"
    )
    assert w.cleanup.queue() == [], "scan does not create queue items"
    assert "cleanup.scanned" in w.events.names()
    assert w.cleanup.latest_scan().scan_id == scan.scan_id
    w.llm.set_available(False)
    rules_only = w.cleanup.scan()
    assert {c.channel_id for c in rules_only.candidates} >= {stale}
    assert all(c.group is not T.CleanupGroup.off_profile for c in rules_only.candidates)
    (manual,) = w.cleanup.propose([s.channels["mkbhd"]], reason="não vejo mais")
    assert manual.group is T.CleanupGroup.manual and w.cleanup.queue() == []
    assert w.cleanup.dismiss([manual.id]) == 1


def test_list_importer_flow(fresh_world):
    w = fresh_world
    w.llm.auto = True
    url = "https://example.com/lista"
    with pytest.raises(T.Conflict):
        w.lists.import_list(url)
    w.settings.set("extras_import_lists", True)
    w.http.routes[url] = "<html><p>Gosto do @canal e do @sumido</p></html>"
    w.youtube.add_channel(T.ChannelInfo(id=UC1, title="Canal", handle="@canal"))
    preview = w.lists.import_list(url)
    assert [e.channel_id for e in preview.entries] == [UC1, None]
    assert preview.resolved_count == 1
    assert w.lists.get_preview(preview.id) == preview
    tab = w.lists.to_tab(preview.id, name="Lista")
    assert tab.kind is T.TabKind.channels and tab.rules.include.channels == (UC1,)
    assert w.channels.get(UC1).source is T.ChannelSource.list
    assert w.lists.get_preview(preview.id).tab_id == tab.id


def test_demo_load_clear_and_undo_never_touch_real_data(fresh_world):
    w = fresh_world
    w.channels.upsert_many(
        [T.ChannelIn(title="Real", channel_id=UC1)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    report = w.data.load_demo()
    assert report.channels == 3 and w.data.demo_loaded()
    assert w.data.load_demo() == T.DataReport(), "idempotente"
    rec = next(r for r in w.changelog.list() if r.action is T.ChangeAction.demo_load)
    w.changelog.undo(rec.id, targets=w.targets())
    assert [c.id for c in w.channels.list()] == [UC1]
    assert not w.data.demo_loaded()
    w.data.load_demo()
    w.data.clear_demo()
    assert [c.id for c in w.channels.list()] == [UC1]
    assert w.taxonomy.list_folders() == []


def test_import_mytube_and_json_roundtrip(fresh_world):
    w = fresh_world
    data = {
        "folders": [{"id": "a", "name": "Tech"}, {"id": "b", "name": "IA", "parentId": "a"}],
        "tags": [{"id": "x", "name": "aprender"}],
        "channels": [
            {"channelId": UC1, "title": "Um", "folderId": "b", "tags": ["x"], "starred": True},
            {"id": "legacy-id", "title": "Sem UC"},
        ],
    }
    report = w.data.import_mytube(data)
    assert (report.channels, report.folders, report.tags, report.skipped) == (1, 2, 1, 1)
    ch = w.channels.get(UC1)
    assert ch.source is T.ChannelSource.mytube and ch.favorite
    assert w.taxonomy.get_folder(ch.folder_id).name == "IA" and len(ch.tag_ids) == 1
    exported = w.data.export_json()
    other = build_fake_world(MemDb())
    other.data.import_json(exported)
    assert other.channels.get(UC1).folder_id is not None
    assert [f.name for f in other.taxonomy.list_folders()] == ["Tech", "IA"]


def test_maintenance_run(fresh_world):
    w = fresh_world
    w.llm.auto = True
    w.channels.upsert_many(
        [T.ChannelIn(title="A", channel_id=UC1), T.ChannelIn(title="B", channel_id=UC2)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    now = w.clock.now()
    w.clock.set(now - 31 * 86_400)
    w.channels.set_relation(UC1, T.Relation.ex)
    w.clock.set(now - 5 * 86_400)
    w.channels.set_relation(UC2, T.Relation.ex)
    w.clock.set(now)
    theme_id = w.themes.seed_theme(
        "q", [T.VideoIn(id="maintvid001", channel_id=UC1, title="t", published_at=now)]
    )
    w.themes.save(theme_id)
    w.db.execute("UPDATE themes SET last_search_at = ? WHERE id = ?", (now - 8 * 86_400, theme_id))
    w.searcher.enqueue("velha")
    w.jobs.submit(T.JobKind.digest, lambda p: None)
    w.clock.advance(8 * 86_400)
    report = w.maintenance.run()
    assert report.ex_to_ignored == (UC1,)
    assert report.themes_refreshed == (theme_id,)
    assert report.jobs_purged == 1 and report.search_jobs_purged == 1
    assert w.channels.get(UC2).relation is T.Relation.ex, "still within the 30 days"
    assert w.maintenance.run() == T.MaintenanceReport(), "idempotente"
    w.clock.advance(30 * 86_400)
    assert w.maintenance.run().ex_to_ignored == (UC2,)


def test_device_auth_and_search_jobs():
    from fakes import FakeDeviceAuth, FakeSearcher

    clock = FakeClock(1000)
    auth = FakeDeviceAuth(clock=clock)
    first = auth.start_pairing()
    second = auth.start_pairing()
    with pytest.raises(T.Unauthorized):
        auth.complete_pairing(first.code, "velho")
    paired = auth.complete_pairing(second.code, "Chrome")
    with pytest.raises(T.Unauthorized):
        auth.complete_pairing(second.code, "de novo")
    assert auth.verify(paired.token).id == paired.device.id
    assert auth.any_seen_within(60)
    clock.advance(61)
    assert not auth.any_seen_within(60)
    expired = auth.start_pairing()
    clock.advance(601)
    with pytest.raises(T.Unauthorized):
        auth.complete_pairing(expired.code, "tarde")
    assert auth.revoke(paired.device.id) and auth.revoke(paired.device.id)
    with pytest.raises(T.Unauthorized):
        auth.verify(paired.token)
    assert auth.list() == []

    searcher = FakeSearcher(clock=clock)
    job = searcher.enqueue("agentes")
    assert searcher.pending_count() == 1
    (claimed,) = searcher.claim("dev-1")
    assert claimed.status is T.SearchJobStatus.claimed and searcher.pending_count() == 0
    done = searcher.complete(job.id, {"contents": {}}, device_id="dev-1")
    assert done.status is T.SearchJobStatus.done
    late = searcher.enqueue("tarde")
    clock.advance(16)
    with pytest.raises(T.Conflict):
        searcher.complete(late.id, "{}", device_id="dev-1")
    assert searcher.purge_expired() == 2
    searcher.fail("quebrada")
    out = searcher.search_many([T.SearchRequest("quebrada"), T.SearchRequest("vazia")])
    assert out[0].error and out[1].hits == () and len(searcher.batches) == 1
    with pytest.raises(T.YouTubeError):
        searcher.search("quebrada")


def test_feed_uses_lenses_only_when_enabled():
    video = T.Video(id="lensvideo01", channel_id=UC1, title="HN", published_at=None, views=9)
    lens = FakeLens(
        items=[T.LensItem(video=video, why=T.Why(T.WhyVia.hn, "HN"), badges=("hn",))],
        details={"lensvideo01": "o HN gosta"},
    )
    world = build_fake_world(MemDb(), lenses=[lens])
    rules = T.TabRules(include=T.RuleInclude(lenses=(T.HN_LENS,)), mode=T.FeedMode.classics)
    tab = world.tabs.create(T.TabDraft(name="HackerTube", kind=T.TabKind.mixed, rules=rules))
    (item,) = world.feed.page(tab.id).items
    assert item.badges == ("hn",) and item.why.detail == "o HN gosta"
    lens.set_enabled(False)
    assert world.feed.page(tab.id).items == ()
    with pytest.raises(T.ValidationError):
        world.tabs.validate_rules({"include": {"lenses": ["desconhecida"]}})


def test_status_and_new_counts_on_seeded_world(world, seed_world):
    status = world.refresher.status()
    counts = world.feed.new_counts()
    assert status.new_total == counts.total > 0
    assert {f.channel_id for f in status.fav_new} == {
        seed_world.channels["fireship"],
        seed_world.channels["mkbhd"],
    }
    by_tab = {t.tab_id: t.count for t in status.new_by_tab}
    assert by_tab[T.BUILTIN_TAB_ALL_NEW] == counts.total
    assert (
        counts.by_folder[seed_world.folders["Tecnologia"]]
        >= counts.by_folder[seed_world.folders["IA"]]
    )
    long_tab = T.TabRules(include=T.RuleInclude(all=True), mode=T.FeedMode.long)
    assert [i.video.id for i in world.feed.preview(long_tab).items] == [seed_world.long_video]
    no_shorts = T.TabRules(include=T.RuleInclude(all=True), exclude=T.RuleExclude(shorts=True))
    ids = {i.video.id for i in world.feed.preview(no_shorts, limit=100).items}
    assert seed_world.short_video not in ids


# --------------------------------------------------------------------------- conftest


def test_bootstrap_ran_and_package_is_synthetic():
    pkg = sys.modules["tube_pkg"]
    assert pkg.__file__ is None


def test_wire_fixture_tolerates_missing_wiring(wire, fresh_world):
    wire.use_world(fresh_world)
    import tube_pkg.wiring as wiring

    assert wiring.get_cleanup() is fresh_world.cleanup
    assert wiring.get_db() is fresh_world.db
    assert wiring.get_lenses() == list(fresh_world.lenses)
    wire.set("cleanup", "outro")
    assert wiring.get_cleanup() == "outro"


def test_fake_ctx_fixture(fake_ctx):
    assert isinstance(fake_ctx, FakeCtx)
