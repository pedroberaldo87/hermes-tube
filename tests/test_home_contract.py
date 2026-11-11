"""Contract gaps found by the Home page.

1. ``GET /feed?q=`` — server-side search inside the tab (title and channel; accent- and
   case-insensitive), combinable with cursor and filters; ``counts`` reflect the search.
2. ``GET /status`` with ``channels_total`` and ``subscribed_total``.
3. ``POST /read`` returns ``change_ids`` (undo by exact id).
4. ``ReadScope {kind: 'tab', id}`` — the channels the tab shows, through the same feed engine.
5. ``GET /feed?state=later`` — "Watch later" as a feed source, by cursor.
6. Video state history with ``Actor.hermes`` (same history/undo as ``user``).

Each case runs against the **real** code (``core/feed.py``, ``core/refresh.py``,
``core/video_state.py`` on the real database) and against the **fake** (``tests/fakes``), through
the REST routes; every ``ok`` is validated strictly against ``x-data`` in ``contract/api.yaml``.
"""

from __future__ import annotations

import importlib.util
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fakes import build_fake_world
from fakes import seed_world as _seed

from tube_pkg import wiring
from tube_pkg.api import _common
from tube_pkg.api import changes as api_changes
from tube_pkg.api import feed as api_feed
from tube_pkg.api import refresh as api_refresh
from tube_pkg.api import status as api_status
from tube_pkg.core import feed as F
from tube_pkg.core import refresh as R
from tube_pkg.core import types as T
from tube_pkg.core import video_state as VS

ROOT = Path(__file__).resolve().parents[1]
DAY = 86_400
FAKE_PORT = 23457


def _load_gen_types() -> Any:
    name = "_gen_types_b10"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "gen_types.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


GEN = _load_gen_types()
CONTRACT = GEN.load_contract(ROOT)


def check_ok(operation_id: str, env: Any) -> Any:
    assert _common.is_envelope(env), env
    assert env["ok"] is True, env
    op = GEN.get_operation(CONTRACT, operation_id)
    GEN.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    return env["data"]


def check_err(operation_id: str, env: Any) -> str:
    assert _common.is_envelope(env), env
    assert env["ok"] is False, env
    GEN.validate_instance({"$ref": "#/components/schemas/ErrorEnvelope"}, env, ROOT, strict=True)
    code = env["error"]["code"]
    assert code in GEN.get_operation(CONTRACT, operation_id).errors, code
    return code


# =========================================================================== worlds


def _real(world: Any, *, refresher: bool = True) -> Any:
    """Swaps in the real ``VideoStateService``, ``FeedEngine`` and (if *refresher*) Refresher."""
    world.video_state = VS.build(
        db=world.db, settings=world.settings, changelog=world.changelog, clock=world.clock
    )
    world.feed = F.build(
        db=world.db,
        settings=world.settings,
        youtube=world.youtube,
        video_store=world.video_store,
        lenses=world.lenses,
        tabs=world.tabs,
        taxonomy=world.taxonomy,
        channels=world.channels,
        video_state=world.video_state,
        clock=world.clock,
    )
    if refresher:
        _real_refresher(world)
    return world


def _real_refresher(world: Any) -> Any:
    world.refresher = R.Refresher(
        db=world.db,
        settings=world.settings,
        youtube=world.youtube,
        channels=world.channels,
        video_store=R.build_video_store(db=world.db, settings=world.settings, clock=world.clock),
        feed=world.feed,
        events=world.events,
        changelog=world.changelog,
        ext_endpoint_up=world.ext_endpoint_up,
        clock=world.clock,
        shorts_per_cycle=0,
        cold_start_pages=0,
    )
    return world


@pytest.fixture(autouse=True)
def _fresh_route_state() -> Any:
    api_status.reset()
    api_refresh.reset()
    yield
    api_status.reset()
    api_refresh.reset()


@pytest.fixture(params=["real", "fake"])
def env(request: Any, db: Any, wire: Any, monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    world = build_fake_world(db)
    if request.param == "real":
        _real(world, refresher=False)
    seed = _seed(world)  # seeds through the fake (owner of the watermarks in the seed)
    if request.param == "real":
        _real_refresher(world)
    world.clock.advance(60)
    wire.use_world(world)
    wire.set("undo_targets", world.targets())
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: FAKE_PORT)
    # /status without starting a cycle (fake and real only record/check the grace period)
    monkeypatch.setattr(world.refresher, "kick_if_due", lambda *a, **k: "skipped")
    return SimpleNamespace(kind=request.param, w=world, s=seed, db=world.db)


def feed(query: dict[str, str]) -> dict[str, Any]:
    return check_ok("getFeed", _common.call_rest(api_feed.get_feed, None, query))


def feed_err(query: dict[str, str]) -> str:
    return check_err("getFeed", _common.call_rest(api_feed.get_feed, None, query))


IDS = {"change_ids": "true"}


def read(body: Any, query: dict[str, str] | None = None) -> dict[str, Any]:
    """``POST /read?change_ids=true`` (opt-in: without the parameter the answer is the old one)."""
    q = IDS if query is None else query
    return check_ok("postRead", _common.call_rest(api_refresh.post_read, body, q))


def vids(data: dict[str, Any]) -> list[str]:
    return [i["video"]["id"] for i in data["items"]]


def walk(query: dict[str, str], *, limit: int, between: Any = None) -> list[str]:
    """Every page of ``GET /feed`` with *limit*; *between(n)* runs between pages."""
    out: list[str] = []
    cursor: str | None = None
    for n in range(500):
        q = dict(query, limit=str(limit))
        if cursor:
            q["cursor"] = cursor
        data = feed(q)
        assert len(data["items"]) <= limit
        out += vids(data)
        cursor = data["next_cursor"]
        if not cursor:
            return out
        if between is not None:
            between(n)
    raise AssertionError("pagination did not finish")


def new_by_channel(env: SimpleNamespace) -> dict[str, int]:
    return {c: n for c, n in env.w.feed.new_counts().by_channel.items() if n}


def active_channels(env: SimpleNamespace, *, muted: bool = False) -> set[str]:
    sql = "SELECT id FROM channels WHERE relation IN ('subscribed', 'followed')"
    if not muted:
        sql += " AND muted = 0"
    return {r["id"] for r in env.db.query(sql)}


def watermarks(env: SimpleNamespace) -> dict[str, int]:
    return {
        r["channel_id"]: int(r["seen_up_to"])
        for r in env.db.query("SELECT channel_id, seen_up_to FROM watermarks")
    }


# =========================================================================== 1 · GET /feed?q=


def test_feed_search_accent_case_title_and_channel(env: SimpleNamespace) -> None:
    s = env.s
    whole = feed({"tab": "all-new", "limit": "100"})
    assert whole["counts"]["total"] > 3

    # channel with an accent: "Ciência Todo Dia" by "CIENCIA todo", "ciência" and "Ciencia"
    expect = [
        i["video"]["id"]
        for i in whole["items"]
        if i["video"]["channel_id"] == s.channels["cienciatododia"]
    ]
    assert expect
    for q in ("CIENCIA todo", "ciência", "Ciencia", "  ciÊncia  "):
        data = feed({"tab": "all-new", "q": q, "limit": "100"})
        assert vids(data) == expect, q
        assert data["counts"] == {"total": len(expect), "new": len(expect)}, q

    # title: "Rust em 45 segundos" (Fireship Short), case-insensitive
    data = feed({"tab": "all-new", "q": "rust EM 45"})
    assert vids(data) == [s.short_video]

    # channel name that is not in the title
    env.w.video_store.upsert(
        [
            T.VideoIn(
                id="b10review01",
                channel_id=s.channels["mkbhd"],
                channel_title="Marques Brownlee",
                title="Review do celular dobrável",
                published_at=env.w.clock.now() - 3600,
            )
        ],
        T.VideoOrigin.rss,
    )
    data = feed({"tab": "all-new", "q": "marques"})
    assert vids(data) == ["b10review01", s.videos["mkbhd-new"]]
    assert vids(feed({"tab": "all-new", "q": "dobravel"})) == ["b10review01"]

    # several words: each in the title or the channel (here one in each)
    data = feed({"tab": "all-new", "q": "fireship rust"})
    assert vids(data) == [s.short_video]

    # no result: empty list, zero counts
    data = feed({"tab": "all-new", "q": "nada-disso-existe"})
    assert data == {"items": [], "next_cursor": None, "counts": {"total": 0, "new": 0}}

    # empty q = no search
    plain = feed({"tab": "all-new", "limit": "100"})
    assert len(plain["items"]) == len(whole["items"]) + 1  # + the video inserted above
    assert feed({"tab": "all-new", "q": "   ", "limit": "100"}) == plain


def test_feed_search_combines_with_scope_and_filters(env: SimpleNamespace) -> None:
    s = env.s
    # folder (recursive) + search: only the subtree videos that match
    tech = feed({"folder": s.folders["Tecnologia"], "limit": "100"})
    hits = feed({"folder": s.folders["Tecnologia"], "q": "novidade", "limit": "100"})
    expect = [i["video"]["id"] for i in tech["items"] if "novidade" in i["video"]["title"]]
    assert expect and vids(hits) == expect
    assert hits["counts"]["total"] == len(expect) < tech["counts"]["total"]

    # tab with exclude.shorts: the search does not bring the Short back
    tab = env.w.tabs.create(
        T.TabDraft(
            name="Sem Shorts",
            kind=T.TabKind.category,
            rules=T.TabRules(include=T.RuleInclude(all=True), exclude=T.RuleExclude(shorts=True)),
        ),
        actor=T.Actor.user,
    )
    assert feed({"tab": tab.id, "q": "rust"})["items"] == []
    assert vids(feed({"tab": tab.id, "q": "fireship"})) == [
        s.videos["fireship-new"],
        s.videos["fireship-seen"],
    ]

    # channel + search
    data = feed({"channel": s.channels["fireship"], "q": "rust"})
    assert vids(data) == [s.short_video]


def test_feed_search_pages_without_repeat_or_loss(env: SimpleNamespace) -> None:
    s = env.s
    query = {"tab": "all-new", "q": "a"}  # matches almost everything
    full = vids(feed(dict(query, limit="100")))
    assert len(full) >= 5
    for limit in (1, 2, 3):
        got = walk(query, limit=limit)
        assert got == full, limit
        assert len(set(got)) == len(got)

    # stable across pages even with a video archived in between (keyset cursor)
    if env.kind == "real":
        victim = full[len(full) // 2]
        got = walk(
            query,
            limit=2,
            between=lambda n: (
                n == 0
                and env.w.video_state.set_state([victim], T.VideoState.archived, actor=T.Actor.user)
            ),
        )
        assert got == [v for v in full if v != victim]
    _ = s


@pytest.mark.parametrize("q", ["x" * 201])
def test_feed_search_invalid(env: SimpleNamespace, q: str) -> None:
    assert feed_err({"tab": "all-new", "q": q}) == "invalid"


# =========================================================================== 2 · /status


def test_status_has_channel_totals(env: SimpleNamespace) -> None:
    data = check_ok("getStatus", api_status.get_status(None, {}))
    subscribed = env.db.query_one(
        "SELECT COUNT(*) AS n FROM channels WHERE relation = 'subscribed'"
    )["n"]
    assert data["subscribed_total"] == subscribed == 8
    assert data["channels_total"] == len(active_channels(env, muted=True)) == 10

    # changes with the database (route cache renewed)
    env.w.channels.set_relation(env.s.channels["verge"], T.Relation.ignored, actor=T.Actor.user)
    api_status.reset()
    data = check_ok("getStatus", api_status.get_status(None, {}))
    assert (data["channels_total"], data["subscribed_total"]) == (9, 8)


def test_status_totals_zero_world(db: Any, wire: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    for maker in (lambda w: w, _real):
        world = maker(build_fake_world(db))
        wire.use_world(world)
        monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: None)
        monkeypatch.setattr(world.refresher, "kick_if_due", lambda *a, **k: "skipped")
        api_status.reset()
        data = check_ok("getStatus", api_status.get_status(None, {}))
        assert (data["channels_total"], data["subscribed_total"]) == (0, 0)


def test_status_old_fields_unchanged(env: SimpleNamespace) -> None:
    """Additive: every previous field is still there, with the same type."""
    data = check_ok("getStatus", api_status.get_status(None, {}))
    for key in api_status.DEFAULTS:
        assert key in data, key
    op = GEN.get_operation(CONTRACT, "getStatus")
    schema = GEN.deref(CONTRACT, op.data_schema, op.doc)
    required: set[str] = set(schema.get("required", []))
    for part in schema.get("allOf", []):
        required |= set(part.get("required", []))
    assert "channels_total" not in required and "subscribed_total" not in required
    assert set(api_status.DEFAULTS) <= required | {"ext_port"}


# =========================================================================== 3 · /read change_ids


def test_read_returns_change_ids_and_undo_by_id(env: SimpleNamespace) -> None:
    fire = env.s.channels["fireship"]
    before = new_by_channel(env)
    assert before[fire] > 0

    data = read({"kind": "channel", "id": fire})
    assert data["changed"] == 1 and len(data["change_ids"]) == 1
    rec = env.w.changelog.get(data["change_ids"][0])
    assert rec is not None and rec.action is T.ChangeAction.mark_read
    assert rec.actor is T.Actor.user
    assert fire not in new_by_channel(env)

    # nothing changed → empty list
    assert read({"kind": "channel", "id": fire}) == {"changed": 0, "change_ids": []}

    # another mark afterwards: undo uses the exact id (not the last entry)
    later = read({"kind": "folder", "id": env.s.folders["Ciência"]})
    assert later["changed"] > 0 and later["change_ids"] != data["change_ids"]
    undo = _common.call_rest(api_changes.post_change_undo, None, {"id": str(data["change_ids"][0])})
    assert undo["ok"], undo
    after = new_by_channel(env)
    assert after.get(fire) == before[fire]
    science = {env.s.channels[k] for k in ("veritasium", "cienciatododia", "kurzgesagt")}
    assert all(after.get(c, 0) == 0 for c in science)  # the other mark still holds


# =========================================================================== 4 · ReadScope tab


def test_read_tab_category_with_nested_folder_marks_what_the_tab_shows(
    env: SimpleNamespace,
) -> None:
    s = env.s
    wm0 = watermarks(env)
    data = read({"kind": "tab", "id": s.category_tab})  # Tecnologia ⊃ IA
    shown = {
        s.channels[k] for k in ("fireship", "twominute", "aiexplained", "mkbhd", "verge")
    }  # linus (muted) does not show in the tab → not marked
    wm1 = watermarks(env)
    changed = {c for c in wm1 if wm1[c] != wm0.get(c)}
    assert changed == shown
    assert data["changed"] == len(shown) and len(data["change_ids"]) == 1
    assert wm1[s.channels["linus"]] == wm0[s.channels["linus"]]
    assert env.w.feed.new_counts().by_tab[s.category_tab] == 0
    rec = env.w.changelog.get(data["change_ids"][0])
    assert rec is not None and rec.payload.get("scope") == "tab"

    # comparison: kind=folder also marks the muted one (old rule intact)
    _common.call_rest(api_changes.post_change_undo, None, {"id": str(data["change_ids"][0])})
    assert watermarks(env) == wm0
    folder = read({"kind": "folder", "id": s.folders["Tecnologia"]})
    assert folder["changed"] == len(shown) + 1


def test_read_tab_favorites_and_builtin_without_row(env: SimpleNamespace) -> None:
    s = env.s
    favs = {
        r["id"]
        for r in env.db.query(
            "SELECT id FROM channels WHERE favorite = 1 AND muted = 0"
            " AND relation IN ('subscribed', 'followed')"
        )
    }
    assert favs
    wm0 = watermarks(env)
    data = read({"kind": "tab", "id": T.BUILTIN_TAB_FAVORITES})
    wm1 = watermarks(env)
    assert {c for c in wm1 if wm1[c] != wm0.get(c)} == favs
    assert data["changed"] == len(favs)

    # built-in tab with no row in ``tabs`` (all-new) = every active, non-muted channel
    env.db.execute("DELETE FROM tabs WHERE id = ?", (T.BUILTIN_TAB_ALL_NEW,))
    data = read({"kind": "tab", "id": T.BUILTIN_TAB_ALL_NEW})
    assert data["changed"] == len(active_channels(env) - favs)
    assert not set(new_by_channel(env)) & active_channels(env)
    _ = s


def test_read_tab_by_tag_with_exclude(env: SimpleNamespace) -> None:
    s = env.s
    tab = env.w.tabs.create(
        T.TabDraft(
            name="Aprender sem Ciência",
            kind=T.TabKind.mixed,
            rules=T.TabRules(
                include=T.RuleInclude(tags=(s.tags["aprender"],)),
                exclude=T.RuleExclude(folders=(s.folders["Ciência"],)),
            ),
        ),
        actor=T.Actor.user,
    )
    expect = {
        r["channel_id"]
        for r in env.db.query(
            "SELECT ct.channel_id FROM channel_tags ct JOIN channels c ON c.id = ct.channel_id"
            " WHERE ct.tag_id = ? AND c.muted = 0 AND c.relation IN ('subscribed', 'followed')"
            " AND (c.folder_id IS NULL OR c.folder_id <> ?)",
            (s.tags["aprender"], s.folders["Ciência"]),
        )
    }
    assert expect and s.channels["veritasium"] not in expect
    wm0 = watermarks(env)
    data = read({"kind": "tab", "id": tab.id})
    wm1 = watermarks(env)
    assert {c for c in wm1 if wm1[c] != wm0.get(c)} == expect
    assert data["changed"] == len(expect)


@pytest.mark.parametrize(
    ("which", "code"),
    [
        ("theme", "invalid"),
        ("later", "invalid"),
        (":later", "invalid"),
        ("missing", "not_found"),
        ("noid", "invalid"),
    ],
)
def test_read_tab_errors(env: SimpleNamespace, which: str, code: str) -> None:
    body: dict[str, Any] = {"kind": "tab"}
    if which == "theme":
        body["id"] = env.s.theme_tab
    elif which == "missing":
        body["id"] = "aba-que-nao-existe"
    elif which != "noid":
        body["id"] = which
    env_ = _common.call_rest(api_refresh.post_read, body, IDS)
    assert check_err("postRead", env_) == code
    if code == "invalid" and which != "noid":
        assert env_["error"]["message"]
    assert env.w.changelog.list() == []


def test_read_without_flag_answers_exactly_as_before(env: SimpleNamespace) -> None:
    """Additive: without ``?change_ids`` the answer is ``{changed}`` (the Desktop compares it)."""
    fire = env.s.channels["fireship"]
    assert read({"kind": "channel", "id": fire}, {}) == {"changed": 1}
    assert read({"kind": "channel", "id": fire}, {"change_ids": "false"}) == {"changed": 0}
    data = read({"kind": "all"})
    assert set(data) == {"changed", "change_ids"} and data["changed"] > 0
    out = _common.call_rest(api_refresh.post_read, {"kind": "all"}, {"change_ids": "talvez"})
    assert check_err("postRead", out) == "invalid"


# =========================================================================== 5 · state=later


def _mark_later(env: SimpleNamespace, keys: list[str]) -> list[str]:
    out = []
    for k in keys:
        env.w.clock.advance(10)
        vid = env.s.videos[k]
        env.w.video_state.set_state([vid], T.VideoState.later, actor=T.Actor.user)
        out.append(vid)
    return out


def test_feed_state_later_order_why_and_pages(env: SimpleNamespace) -> None:
    s = env.s
    marked = _mark_later(env, ["fireship-new", "veritasium-seen", "nerdologia-old"])
    # most recent first; the seed one (mkbhd-seen) was marked before all others
    expect = list(reversed(marked)) + [s.videos["mkbhd-seen"]]
    data = feed({"state": "later", "limit": "100"})
    assert vids(data) == expect
    assert data["counts"] == {"total": len(expect), "new": 0}
    for item in data["items"]:
        assert item["state"] == "later" and item["is_new"] is False
        assert item["why"] is not None and item["why"]["label"]
    by_id = {i["video"]["id"]: i for i in data["items"]}
    # channel without folder → channel; channel in a folder → folder (the origin reason)
    assert by_id[s.videos["nerdologia-old"]]["why"]["via"] == "channel"
    assert by_id[s.videos["veritasium-seen"]]["why"] == {
        "via": "folder",
        "label": "Ciência",
        "detail": None,
    }
    # an old video (200 days) and one from a channel outside the window show too:
    # "Watch later" has no mode

    # cursor pagination without repeats or losses
    for limit in (1, 2):
        assert walk({"state": "later"}, limit=limit) == expect

    # removing an item from "Watch later" between pages neither repeats nor skips the others
    got = walk(
        {"state": "later"},
        limit=1,
        between=lambda n: (
            n == 0
            and env.w.video_state.set_state([expect[2]], T.VideoState.seen, actor=T.Actor.user)
        ),
    )
    assert got == [v for v in expect if v != expect[2]]

    # search can be combined
    data = feed({"state": "later", "q": "VERITASIUM"})
    assert vids(data) == [s.videos["veritasium-seen"]]


def test_feed_state_errors(env: SimpleNamespace) -> None:
    assert feed_err({"state": "seen"}) == "invalid"
    assert feed_err({"state": "later", "tab": "all-new"}) == "invalid"
    assert feed_err({"state": "later", "cursor": "p:1:dQw4w9WgXcQ"}) == "invalid"
    assert feed_err({"tab": "all-new", "cursor": "l:1:dQw4w9WgXcQ"}) == "invalid"


def test_feed_state_later_empty(env: SimpleNamespace) -> None:
    env.w.video_state.set_state([env.s.videos["mkbhd-seen"]], T.VideoState.seen)
    assert feed({"state": "later"}) == {
        "items": [],
        "next_cursor": None,
        "counts": {"total": 0, "new": 0},
    }


# =========================================================================== 6 · Actor.hermes


@pytest.mark.parametrize("actor", [T.Actor.user, T.Actor.hermes])
def test_video_state_history_for_user_and_hermes(env: SimpleNamespace, actor: T.Actor) -> None:
    vid = env.s.videos["fireship-new"]
    env.w.video_state.set_state([vid], T.VideoState.later, actor=actor)
    env.w.video_state.set_reaction(vid, T.Reaction.up, actor=actor)
    recs = env.w.changelog.list()
    assert [r.actor for r in recs[:2]] == [actor, actor]
    assert all(r.action is T.ChangeAction.video_state for r in recs[:2])
    for rec in recs[:2]:
        env.w.changelog.undo(rec.id, targets=env.w.targets())
    assert env.w.video_state.get([vid]) == {}


@pytest.mark.parametrize("actor", [T.Actor.extension, T.Actor.routine])
def test_video_state_no_history_for_extension_and_routine(
    env: SimpleNamespace, actor: T.Actor
) -> None:
    vid = env.s.videos["fireship-new"]
    env.w.video_state.set_state([vid], T.VideoState.later, actor=actor)
    env.w.video_state.set_reaction(vid, T.Reaction.up, actor=actor)
    assert env.w.changelog.list() == []


# =========================================================================== timings (400 × 15)


def _big_world(db: Any) -> SimpleNamespace:
    world = _real(build_fake_world(db))
    now = world.clock.now()
    folders = [f"fb10_{i}" for i in range(10)]
    db.executemany(
        "INSERT INTO folders (id, name, parent_id, sort, created_at) VALUES (?, ?, NULL, ?, ?)",
        [(f, f"Pasta {i}", i, now) for i, f in enumerate(folders)],
    )
    chans = [f"UCb10big{n:016d}" for n in range(400)]
    db.executemany(
        "INSERT INTO channels (id, title, relation, source, added_at, favorite, folder_id)"
        " VALUES (?, ?, ?, 'extension', ?, ?, ?)",
        [
            (c, f"Canal Ção {n}", "subscribed" if n % 4 else "followed", now, 0, folders[n % 10])
            for n, c in enumerate(chans)
        ],
    )
    db.executemany(
        "INSERT INTO videos (id, channel_id, title, published_at, channel_title, first_seen_at,"
        " origin) VALUES (?, ?, ?, ?, ?, ?, 'rss')",
        [
            (
                f"b{n:05d}_{j:04d}",
                c,
                f"Vídeo {j} sobre Programação {n}",
                now - (2 * j + 1) * DAY + n,
                f"Canal Ção {n}",
                now,
            )
            for n, c in enumerate(chans)
            for j in range(15)
        ],
    )
    db.executemany(
        "INSERT INTO watermarks (channel_id, seen_up_to) VALUES (?, ?)",
        [(c, now - 7 * DAY) for c in chans],
    )
    world.tabs.ensure_builtin()
    tab = world.tabs.create(
        T.TabDraft(
            name="Tudo",
            kind=T.TabKind.category,
            rules=T.TabRules(include=T.RuleInclude(all=True)),
        ),
        actor=T.Actor.user,
    )
    return SimpleNamespace(w=world, tab=tab.id)


def _median_ms(fn: Any, n: int = 15) -> float:
    fn()
    ts = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t0) * 1000)
    return statistics.median(ts)


def test_times_400x15(db: Any, wire: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    big = _big_world(db)
    wire.use_world(big.w)
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: FAKE_PORT)
    monkeypatch.setattr(big.w.refresher, "kick_if_due", lambda *a, **k: "skipped")
    snap = big.w.refresher.status()
    assert isinstance(snap, T.StatusSnapshot)
    totals = big.w.refresher.channel_totals()
    assert totals == {"channels_total": 400, "subscribed_total": 300}
    t_totals = _median_ms(big.w.refresher.channel_totals)
    t_status = _median_ms(big.w.refresher.status)
    full = feed({"tab": big.tab})
    assert full["counts"]["total"] == 6000
    t_feed = _median_ms(lambda: _common.call_rest(api_feed.get_feed, None, {"tab": big.tab}))
    hit = feed({"tab": big.tab, "q": "programacao 12"})
    assert 0 < hit["counts"]["total"] < 6000
    t_q = _median_ms(
        lambda: _common.call_rest(api_feed.get_feed, None, {"tab": big.tab, "q": "programacao 12"})
    )
    t_q_all = _median_ms(
        lambda: _common.call_rest(api_feed.get_feed, None, {"tab": big.tab, "q": "cao"})
    )
    print(
        f"\n400x15: channel_totals {t_totals:.2f} ms · Refresher.status {t_status:.1f} ms ·"
        f" /feed {t_feed:.1f} ms · /feed?q (few) {t_q:.1f} ms · /feed?q (all) {t_q_all:.1f} ms"
    )
    assert t_totals < 5, t_totals  # does not weigh on the /status budget
    assert t_q < 3 * t_feed + 50 and t_q_all < 3 * t_feed + 50, (t_feed, t_q, t_q_all)
