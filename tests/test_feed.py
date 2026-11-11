"""``core/feed.py`` (``FeedEngine``), ``core/video_state.py`` (``VideoStateService``) and the
surfaces ``plugin/api/feed.py``, ``plugin/api/state.py``, ``plugin/ext/feed.py``.

Real database (``core.db.build`` through the conftest ``db`` fixture) + fakes for the other
services; ``seed_world`` with the real ``VideoStateService`` in place of the fake.
"""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import threading
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fakes import FakeLens, build_fake_world
from fakes import seed_world as _seed

from tube_pkg.api import _common
from tube_pkg.api import feed as api_feed
from tube_pkg.api import state as api_state
from tube_pkg.core import feed as F
from tube_pkg.core import types as T
from tube_pkg.core import video_state as VS
from tube_pkg.ext import feed as ext_feed

ROOT = Path(__file__).resolve().parents[1]
DAY = 86_400
UC_OUT = "UCb03outsider00000000001"  # channel outside the table (theme/lens)


def _load_gen_types() -> Any:
    name = "_gen_types_b03"
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "gen_types.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    import sys

    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


GEN = _load_gen_types()
CONTRACT = GEN.load_contract(ROOT)


def check_op(operation_id: str, env: Any) -> Any:
    """``ok`` envelope validated **strictly** against the operation's ``x-data``; returns data."""
    assert _common.is_envelope(env), env
    assert env["ok"] is True, env
    assert set(env) == {"ok", "data"}
    op = GEN.get_operation(CONTRACT, operation_id)
    GEN.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    return env["data"]


def err_code(fn: Any, body: Any, query: dict[str, str]) -> str:
    env = _common.call_rest(fn, body, query)
    assert env["ok"] is False, env
    return env["error"]["code"]


def make_engine(world: Any, **kw: Any) -> Any:
    if kw:
        return F.FeedEngine(
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
            **kw,
        )
    return F.build(
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


def real_world(db: Any, clock: Any, **kw: Any) -> Any:
    world = build_fake_world(db, clock=clock, **kw)
    world.video_state = VS.build(
        db=db, settings=world.settings, changelog=world.changelog, clock=clock
    )
    return world


@pytest.fixture
def env(db: Any, clock: Any) -> SimpleNamespace:
    world = real_world(db, clock)
    seed = _seed(world)
    return SimpleNamespace(world=world, seed=seed, engine=make_engine(world), V=seed.videos)


def ids(page: T.FeedPage) -> list[str]:
    return [i.video.id for i in page.items]


def everything(engine: Any, rules: T.TabRules) -> list[T.FeedItem]:
    return list(engine.preview(rules, limit=100).items)


def R(**kw: Any) -> T.TabRules:
    return T.TabRules.from_dict(kw)


# =========================================================================== construction


def test_build_signatures_and_protocols(env: SimpleNamespace) -> None:
    for module, spec_key in (
        (F, "plugin/core/feed.py:build"),
        (VS, "plugin/core/video_state.py:build"),
    ):
        spec = next(s for s in T.BUILDS if s.key == spec_key)
        params = inspect.signature(module.build).parameters
        kw_only = [n for n, p in params.items() if p.kind is inspect.Parameter.KEYWORD_ONLY]
        required = [n for n in kw_only if params[n].default is inspect.Parameter.empty]
        assert required == list(spec.deps)
        assert params["clock"].default is None
    assert isinstance(env.engine, T.FeedEngine)
    assert isinstance(env.world.video_state, T.VideoStateService)
    assert not getattr(env.engine, "__contract_stub__", None)
    assert not getattr(env.world.video_state, "__contract_stub__", None)


def test_build_is_inert(db: Any, clock: Any) -> None:
    world = build_fake_world(db, clock=clock)
    before = threading.active_count()
    make_engine(world)
    VS.build(db=db, settings=world.settings, changelog=world.changelog, clock=clock)
    assert threading.active_count() == before
    assert world.youtube.network_calls() == []


def test_modules_are_pure() -> None:
    for name in (
        "core/feed.py",
        "core/video_state.py",
        "api/feed.py",
        "api/state.py",
        "ext/feed.py",
    ):
        text = (ROOT / "plugin" / name).read_text(encoding="utf-8")
        for banned in ("os.environ", "getenv", "from plugin", "import plugin", "get_hermes_home"):
            assert banned not in text, (name, banned)
        for other in ("channels", "changes", "refresh", "taxonomy", "tabs", "themes", "youtube"):
            assert f"tube_pkg.core.{other}" not in text, (name, other)
            assert f"from tube_pkg.core import {other}" not in text, (name, other)
    for name in ("api/feed.py", "api/state.py", "ext/feed.py"):
        module = {"api/feed.py": api_feed, "api/state.py": api_state, "ext/feed.py": ext_feed}[name]
        for fn_name, fn in inspect.getmembers(module, inspect.isfunction):
            if getattr(fn, "__module__", "") == module.__name__ and not fn_name.startswith("_"):
                assert _common.is_real(fn), (name, fn_name)


# =========================================================================== rules × seed_world


def _cases(s: Any) -> list[tuple[str, Any, set[str]]]:
    f, t, c = s.folders, s.tags, s.channels
    k = lambda *names: set(names)  # noqa: E731
    act_fresh = k(
        "fireship-new",
        "fireship-seen",
        "fireship-short",
        "twominute-new",
        "twominute-seen",
        "aiexplained-new",
        "aiexplained-seen",
        "mkbhd-new",
        "mkbhd-seen",
        "verge-new",
        "veritasium-new",
        "veritasium-seen",
        "cienciatododia-new",
        "cienciatododia-seen",
        "kurzgesagt-new",
        "kurzgesagt-seen",
    )
    return [
        (
            "tab all-new",
            T.BUILTIN_TAB_ALL_NEW,
            k(
                "fireship-new",
                "fireship-short",
                "twominute-new",
                "aiexplained-new",
                "mkbhd-new",
                "verge-new",
                "veritasium-new",
                "cienciatododia-new",
                "kurzgesagt-new",
            ),
        ),
        (
            "tab favorites",
            T.BUILTIN_TAB_FAVORITES,
            k(
                "fireship-new",
                "fireship-seen",
                "fireship-short",
                "mkbhd-new",
                "mkbhd-seen",
            ),
        ),
        (
            "tab categoria (pasta recursiva, sem silenciado/arquivado)",
            s.category_tab,
            k(
                "fireship-new",
                "fireship-seen",
                "fireship-short",
                "twominute-new",
                "twominute-seen",
                "aiexplained-new",
                "aiexplained-seen",
                "mkbhd-new",
                "mkbhd-seen",
                "verge-new",
            ),
        ),
        ("tab tema", s.theme_tab, {f"theme-{v}" for v in s.theme_videos}),
        (
            "all (fresh: nada > 30 dias, sem ex/ignored/silenciado)",
            R(include={"all": True}),
            act_fresh,
        ),
        (
            "tag",
            R(include={"tags": [t["aprender"]]}),
            k(
                "fireship-new",
                "fireship-seen",
                "fireship-short",
                "twominute-new",
                "twominute-seen",
                "veritasium-new",
                "veritasium-seen",
                "cienciatododia-new",
                "cienciatododia-seen",
            ),
        ),
        (
            "canal silenciado só por include.channels",
            R(include={"channels": [c["linus"]]}),
            k(
                "linus-new",
                "linus-seen",
            ),
        ),
        ("ex por canal, fresh", R(include={"channels": [c["manualdomundo"]]}), set()),
        (
            "ex por canal, classics",
            R(include={"channels": [c["manualdomundo"]]}, mode="classics"),
            k("manualdomundo-old"),
        ),
        (
            "exclude tag",
            R(include={"all": True}, exclude={"tags": [t["relaxar"]]}),
            act_fresh - k("mkbhd-new", "mkbhd-seen"),
        ),
        (
            "exclude pasta (recursiva)",
            R(include={"folders": [f["Tecnologia"]]}, exclude={"folders": [f["IA"]]}),
            k("mkbhd-new", "mkbhd-seen", "verge-new"),
        ),
        (
            "exclude canal",
            R(include={"folders": [f["Tecnologia"]]}, exclude={"channels": [c["fireship"]]}),
            k(
                "twominute-new",
                "twominute-seen",
                "aiexplained-new",
                "aiexplained-seen",
                "mkbhd-new",
                "mkbhd-seen",
                "verge-new",
            ),
        ),
        (
            "exclude shorts",
            R(include={"all": True}, exclude={"shorts": True}),
            act_fresh - k("fireship-short"),
        ),
        (
            "per_channel 1",
            R(include={"folders": [f["IA"]]}, filters={"per_channel": 1}),
            k("fireship-short", "twominute-new", "aiexplained-new"),
        ),
        ("min_s", R(include={"all": True}, filters={"min_s": 1200}), k("twominute-new")),
        ("max_s", R(include={"all": True}, filters={"max_s": 60}), k("fireship-short")),
        ("mode long", R(include={"all": True}, mode="long"), k("twominute-new")),
        (
            "mode classics (todos os tempos)",
            R(include={"all": True}, mode="classics"),
            act_fresh | k("nerdologia-old"),
        ),
        (
            "tag classics: ex nunca entra por tag",
            R(include={"tags": [t["PT-BR"]]}, mode="classics"),
            k("cienciatododia-new", "cienciatododia-seen", "nerdologia-old"),
        ),
        (
            "pasta only_new",
            R(include={"folders": [f["Ciência"]]}, filters={"only_new": True}),
            k("veritasium-new", "cienciatododia-new", "kurzgesagt-new"),
        ),
        (
            "pasta + tema",
            R(include={"folders": [f["Ciência"]], "themes": [s.theme]}, filters={"only_new": True}),
            k("veritasium-new", "cienciatododia-new", "kurzgesagt-new")
            | {f"theme-{v}" for v in s.theme_videos},
        ),
        ("vazia", R(), set()),
    ]


def test_rule_table_against_seed_world(env: SimpleNamespace) -> None:
    for name, target, expected_keys in _cases(env.seed):
        if isinstance(target, str):
            page = env.engine.page(target, limit=100)
        else:
            page = env.engine.preview(target, limit=100)
        got = set(ids(page))
        assert got == {env.V[k] for k in expected_keys}, name
        assert page.next_cursor is None, name
        assert page.counts.total == len(got), name
        assert page.counts.new == sum(1 for i in page.items if i.is_new), name
        # never: archived, ignored, ex outside include.channels
        assert env.V["verge-seen"] not in got, name
        assert env.V["fofoca-old"] not in got, name


def test_sorting_fresh_and_classics(env: SimpleNamespace) -> None:
    fresh = everything(env.engine, R(include={"all": True}))
    keys = [(-(i.video.published_at or 0), i.video.id) for i in fresh]
    assert keys == sorted(keys)
    assert fresh[0].video.id == env.V["fireship-short"]
    classics = everything(env.engine, R(include={"all": True}, mode="classics"))
    vkeys = [(-(i.video.views or 0), i.video.id) for i in classics]
    assert vkeys == sorted(vkeys)
    assert classics[0].video.id == env.V["fireship-short"]  # 50 thousand views


def test_items_carry_channel_state_reaction_and_new(env: SimpleNamespace) -> None:
    items = {i.video.id: i for i in everything(env.engine, R(include={"all": True}))}
    V, c = env.V, env.seed.channels
    assert items[V["mkbhd-seen"]].state is T.VideoState.later and not items[V["mkbhd-seen"]].is_new
    assert items[V["fireship-seen"]].state is T.VideoState.seen
    assert items[V["veritasium-seen"]].reaction is T.Reaction.up
    assert items[V["veritasium-seen"]].state is T.VideoState.new
    assert not items[V["veritasium-seen"]].is_new  # before the watermark
    assert items[V["cienciatododia-seen"]].reaction is T.Reaction.down
    assert items[V["fireship-new"]].is_new and items[V["fireship-new"]].state is T.VideoState.new
    ch = items[V["fireship-new"]].channel
    assert ch is not None and ch.id == c["fireship"] and ch.favorite
    assert ch.tag_ids == (env.seed.tags["aprender"],)
    theme = everything(env.engine, R(include={"themes": [env.seed.theme]}))
    assert theme and all(i.channel is None for i in theme)
    assert all(i.is_new for i in theme)  # channel without a watermark


def test_why_by_origin(env: SimpleNamespace) -> None:
    s, V = env.seed, env.V

    def why(rules_or_tab: Any, key: str) -> T.Why:
        page = (
            env.engine.page(rules_or_tab, limit=100)
            if isinstance(rules_or_tab, str)
            else env.engine.preview(rules_or_tab, limit=100)
        )
        (item,) = [i for i in page.items if i.video.id == V[key]]
        assert item.why is not None
        return item.why

    assert why(s.category_tab, "fireship-new") == T.Why(T.WhyVia.folder, "Tecnologia")
    assert why(T.BUILTIN_TAB_ALL_NEW, "fireship-new") == T.Why(T.WhyVia.folder, "IA")
    assert why(T.BUILTIN_TAB_ALL_NEW, "verge-new") == T.Why(T.WhyVia.folder, "Tecnologia")
    nerd = R(include={"all": True}, mode="classics")
    assert why(nerd, "nerdologia-old") == T.Why(T.WhyVia.channel, "Nerdologia")
    assert why(R(include={"tags": [s.tags["aprender"]]}), "veritasium-new") == T.Why(
        T.WhyVia.tag, "aprender"
    )
    assert why(R(include={"channels": [s.channels["linus"]]}), "linus-new") == T.Why(
        T.WhyVia.channel, "Linus Tech Tips"
    )
    assert why(T.BUILTIN_TAB_FAVORITES, "mkbhd-new") == T.Why(T.WhyVia.channel, "Marques Brownlee")
    theme_key = f"theme-{s.theme_videos[0]}"
    assert why(s.theme_tab, theme_key) == T.Why(T.WhyVia.theme, "Agentes de IA")
    # precedence: explicit channel > folder > tag
    both = R(
        include={
            "channels": [s.channels["fireship"]],
            "folders": [s.folders["IA"]],
            "tags": [s.tags["aprender"]],
        }
    )
    assert why(both, "fireship-new").via is T.WhyVia.channel
    assert why(both, "twominute-new") == T.Why(T.WhyVia.folder, "IA")
    assert why(both, "veritasium-new") == T.Why(T.WhyVia.tag, "aprender")


def test_parity_with_fake_engine(env: SimpleNamespace) -> None:
    """Same behavior as ``FakeFeedEngine`` where the fake does not simplify."""
    fake = env.world.feed

    def flat(page: T.FeedPage) -> list[tuple[Any, ...]]:
        return [
            (i.video.id, i.why, i.is_new, i.state, i.reaction, i.channel.id if i.channel else None)
            for i in page.items
        ]

    for name, target, _ in _cases(env.seed):
        if isinstance(target, str):
            real, other = env.engine.page(target, limit=100), fake.page(target, limit=100)
        else:
            real, other = env.engine.preview(target, limit=100), fake.preview(target, limit=100)
        assert flat(real) == flat(other), name
        assert real.counts == other.counts, name
    assert env.engine.new_counts() == fake.new_counts()


# =========================================================================== pagination


def test_cursor_pages_cover_the_list_without_gaps(env: SimpleNamespace) -> None:
    for rules in (R(include={"all": True}), R(include={"all": True}, mode="classics")):
        full = [i.video.id for i in everything(env.engine, rules)]
        seen: list[str] = []
        cursor = None
        pages = 0
        while True:
            page = env.engine.preview(rules, limit=4, cursor=cursor)
            assert len(page.items) <= 4
            assert page.counts.total == len(full)
            seen += ids(page)
            pages += 1
            cursor = page.next_cursor
            if cursor is None:
                break
            assert isinstance(cursor, str)
        assert seen == full
        assert pages == -(-len(full) // 4)


def test_cursor_is_stable_when_new_videos_arrive(env: SimpleNamespace) -> None:
    rules = R(include={"all": True})
    full = [i.video.id for i in everything(env.engine, rules)]
    first = env.engine.preview(rules, limit=5)
    # a video newer than everything arrives, and an item from the 1st page is archived
    env.world.video_store.upsert(
        [
            T.VideoIn(
                id="b03brandnew",
                channel_id=env.seed.channels["fireship"],
                title="Novo",
                published_at=env.seed.now - 60,
                duration_s=300,
            )
        ],
        T.VideoOrigin.rss,
    )
    env.world.video_state.set_state([full[0]], T.VideoState.archived)
    second = env.engine.preview(rules, limit=5, cursor=first.next_cursor)
    assert ids(second) == full[5:10]
    assert "b03brandnew" in ids(env.engine.preview(rules, limit=5))


def test_tab_page_cursor_and_bad_inputs(env: SimpleNamespace) -> None:
    p1 = env.engine.page(env.seed.category_tab, limit=3)
    p2 = env.engine.page(env.seed.category_tab, limit=3, cursor=p1.next_cursor)
    assert not set(ids(p1)) & set(ids(p2))
    classics_cursor = env.engine.preview(R(include={"all": True}, mode="classics"), limit=2)
    with pytest.raises(T.ValidationError):
        env.engine.page(env.seed.category_tab, limit=3, cursor=classics_cursor.next_cursor)
    for bad in ("lixo", "p:abc:seedvid0001", "p:1:", ""):
        if bad:
            with pytest.raises(T.ValidationError):
                env.engine.page(env.seed.category_tab, cursor=bad)
    for limit in (0, 501, -1):  # routes: 1..100 (parse_limit); engine: 1..500
        with pytest.raises(T.ValidationError):
            env.engine.page(env.seed.category_tab, limit=limit)
    assert len(env.engine.preview(R(include={"all": True}), limit=500).items) == 16
    with pytest.raises(T.NotFound):
        env.engine.page("nao-existe")


def test_builtin_tabs_work_without_rows(db: Any, clock: Any) -> None:
    world = real_world(db, clock)
    engine = make_engine(world)
    assert world.db.query("SELECT id FROM tabs") == []
    for tab in (T.BUILTIN_TAB_ALL_NEW, T.BUILTIN_TAB_FAVORITES):
        page = engine.page(tab)
        assert page == T.FeedPage(items=(), next_cursor=None, counts=T.FeedCounts())
    counts = engine.new_counts()
    assert counts.total == 0
    assert counts.by_tab == {T.BUILTIN_TAB_ALL_NEW: 0, T.BUILTIN_TAB_FAVORITES: 0}
    assert counts.by_folder == {"": 0}


def test_preview_equals_saved_tab(env: SimpleNamespace) -> None:
    for tab in env.world.tabs.list():
        assert env.engine.preview(tab.rules, limit=7) == env.engine.page(tab.id, limit=7), tab.id


# =========================================================================== counts


def test_new_counts_by_tab_folder_channel(env: SimpleNamespace) -> None:
    s, V = env.seed, env.V
    counts = env.engine.new_counts()
    assert counts.total == 9
    assert counts.by_tab[T.BUILTIN_TAB_ALL_NEW] == 9
    assert counts.by_tab[T.BUILTIN_TAB_FAVORITES] == 3
    assert counts.by_tab[s.category_tab] == 6
    assert counts.by_tab[s.theme_tab] == 3
    for tab in env.world.tabs.list():
        only_new = replace(tab.rules, filters=replace(tab.rules.filters, only_new=True))
        assert counts.by_tab[tab.id] == env.engine.preview(only_new).counts.total, tab.id
    assert counts.by_folder[s.folders["Tecnologia"]] == 6
    assert counts.by_folder[s.folders["IA"]] == 4
    assert counts.by_folder[s.folders["Ciência"]] == 3
    assert counts.by_folder[""] == 0
    assert counts.by_channel[s.channels["fireship"]] == 2
    assert s.channels["linus"] not in counts.by_channel  # muted
    assert sum(counts.by_channel.values()) == counts.total
    assert env.engine.page(T.BUILTIN_TAB_ALL_NEW).counts == T.FeedCounts(total=9, new=9)
    # marking as seen lowers the counts
    env.world.video_state.set_state([V["fireship-new"], V["fireship-short"]], T.VideoState.seen)
    after = env.engine.new_counts()
    assert after.total == 7 and after.by_tab[T.BUILTIN_TAB_FAVORITES] == 1
    assert s.channels["fireship"] not in after.by_channel
    # the watermark (Refresher.mark_read) too
    env.world.refresher.mark_read(T.ReadScope(T.ReadScopeKind.folder, s.folders["Ciência"]))
    assert env.engine.new_counts().by_folder[s.folders["Ciência"]] == 0


def test_new_counts_never_hits_the_network(env: SimpleNamespace) -> None:
    env.world.video_store.upsert(
        [
            T.VideoIn(
                id="b03nodurat1",
                channel_id=env.seed.channels["fireship"],
                title="sem duração",
                published_at=env.seed.now - 100,
            )
        ],
        T.VideoOrigin.rss,
    )
    env.world.tabs.create(
        T.TabDraft(
            name="Longos",
            kind=T.TabKind.mixed,
            rules=R(include={"all": True}, filters={"min_s": 1200}),
        )
    )
    env.engine.new_counts()
    assert env.world.youtube.network_calls() == []


# =========================================================================== lenses


def test_lens_items_and_enrich(db: Any, clock: Any) -> None:
    video = T.Video(
        id="lensvideo01",
        channel_id=UC_OUT,
        title="HN gosta",
        published_at=None,
        views=9,
        duration_s=1300,
    )
    lens = FakeLens(
        items=[T.LensItem(video=video, why=T.Why(T.WhyVia.hn, "HN"), badges=("hn",))],
        details={"lensvideo01": "o HN gosta"},
    )
    world = real_world(db, clock, lenses=[lens])
    seed = _seed(world)
    engine = make_engine(world)
    tab = world.tabs.create(
        T.TabDraft(
            name="HackerTube",
            kind=T.TabKind.mixed,
            rules=R(include={"lenses": [T.HN_LENS]}, mode="classics"),
        )
    )
    (item,) = engine.page(tab.id).items
    assert item.badges == ("hn",) and item.why == T.Why(T.WhyVia.hn, "HN", "o HN gosta")
    assert item.channel is None and item.is_new
    # enrich from every lens enabled on any tab, only on the built page
    lens.details[seed.videos["fireship-new"]] = "citado no HN"
    lens.calls.clear()
    page = engine.page(T.BUILTIN_TAB_ALL_NEW, limit=2)
    assert ("enrich", 2) in lens.calls
    assert not [c for c in lens.calls if c[0] == "items"]  # tab without include.lenses
    hit = [i for i in page.items if i.video.id == seed.videos["fireship-new"]]
    assert hit and hit[0].badges == ("hn",) and hit[0].why.detail == "citado no HN"
    # lens disabled: no items, badges nor calls to items/enrich
    lens.set_enabled(False)
    lens.calls.clear()
    assert engine.page(tab.id).items == ()
    page = engine.page(T.BUILTIN_TAB_ALL_NEW, limit=100)
    assert all(i.badges == () for i in page.items)
    assert lens.calls == []
    # filters the engine can apply hold for lens items
    lens.set_enabled(True)
    world.video_state.set_state(["lensvideo01"], T.VideoState.archived)
    assert engine.page(tab.id).items == ()


def test_lens_failure_does_not_break_the_feed(env: SimpleNamespace) -> None:
    class Broken(FakeLens):
        def enrich(self, items):  # noqa: ANN001
            raise RuntimeError("quebrou")

        def items(self, rules, mode, limit):  # noqa: ANN001
            raise RuntimeError("quebrou")

    engine = make_engine(replace_lenses(env.world, [Broken()]))
    page = engine.page(T.BUILTIN_TAB_ALL_NEW)
    assert page.counts.total == 9
    rules = R(include={"lenses": [T.HN_LENS]})
    assert engine.preview(rules).items == ()


def replace_lenses(world: Any, lenses: list[Any]) -> Any:
    world.lenses = lenses
    return world


# =========================================================================== duration and Short


class SlowYouTube:
    """Wraps ``FakeYouTube`` with a delay in ``video_details``."""

    def __init__(self, inner: Any, delay: float) -> None:
        self.inner = inner
        self.delay = delay

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    def video_details(self, video_id: str) -> T.VideoDetails:
        time.sleep(self.delay)
        return self.inner.video_details(video_id)


def _unknown_world(db: Any, clock: Any) -> SimpleNamespace:
    world = real_world(db, clock)
    cid = "UCb03durations0000000001"
    world.channels.upsert_many(
        [T.ChannelIn(title="Durações", channel_id=cid)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
    )
    now = clock.now()
    vids = [f"b03dur{n:05d}" for n in range(1, 6)]
    world.video_store.upsert(
        [
            T.VideoIn(id=v, channel_id=cid, title=v, published_at=now - n * 3600)
            for n, v in enumerate(vids, start=1)
        ],
        T.VideoOrigin.rss,
    )
    return SimpleNamespace(world=world, cid=cid, vids=vids)


def test_duration_on_demand_in_batch_with_cache(db: Any, clock: Any) -> None:
    u = _unknown_world(db, clock)
    yt = u.world.youtube
    yt.add_details(T.VideoDetails(u.vids[0], 1500))
    yt.add_details(T.VideoDetails(u.vids[1], 300))
    yt.add_details(T.VideoDetails(u.vids[2], None, is_live=True))
    yt.fail("video_details", u.vids[3], T.YouTubeError("fora do ar"))
    yt.add_details(T.VideoDetails(u.vids[4], 2000))
    engine = make_engine(u.world, details_budget_s=5.0)
    rules = R(include={"channels": [u.cid]}, filters={"min_s": 1200})
    got = ids(engine.preview(rules))
    # long ones stay; short goes; live and failure pass without the filter (unknown duration)
    assert got == [u.vids[0], u.vids[2], u.vids[3], u.vids[4]]
    stored = u.world.video_store.get(u.vids)
    assert stored[u.vids[0]].duration_s == 1500 and stored[u.vids[1]].duration_s == 300
    assert stored[u.vids[2]].duration_s is None
    calls = [c for c in yt.calls if c[0] == "video_details"]
    assert sorted(a for _, a in calls) == sorted(u.vids)
    # cache: written to the database + recent failures are not retried
    assert ids(engine.preview(rules)) == got
    assert [c for c in yt.calls if c[0] == "video_details"] == calls
    # no duration filter: no calls
    engine.preview(R(include={"channels": [u.cid]}))
    assert [c for c in yt.calls if c[0] == "video_details"] == calls
    assert not [c for c in yt.calls if c[0] == "is_short"]


def test_duration_over_budget_finishes_in_background(db: Any, clock: Any) -> None:
    u = _unknown_world(db, clock)
    for v in u.vids:
        u.world.youtube.add_details(T.VideoDetails(v, 100))
    u.world.youtube = SlowYouTube(u.world.youtube, delay=0.3)
    engine = make_engine(u.world, details_budget_s=0.05)
    rules = R(include={"channels": [u.cid]}, filters={"min_s": 1200})
    t0 = time.monotonic()
    first = ids(engine.preview(rules))
    assert time.monotonic() - t0 < 0.3 + 0.25
    assert first == u.vids  # still without duration: they pass without the filter on this page
    assert engine.wait_details(timeout=5.0)
    assert all(v.duration_s == 100 for v in u.world.video_store.get(u.vids).values())
    assert ids(engine.preview(rules)) == []


def test_mode_long_uses_on_demand_duration(db: Any, clock: Any) -> None:
    u = _unknown_world(db, clock)
    for n, v in enumerate(u.vids):
        u.world.youtube.add_details(T.VideoDetails(v, 1300 if n % 2 == 0 else 200))
    engine = make_engine(u.world, details_budget_s=5.0)
    got = ids(engine.preview(R(include={"channels": [u.cid]}, mode="long")))
    assert got == [u.vids[0], u.vids[2], u.vids[4]]


def test_shorts_on_demand_only_through_refresher(db: Any, clock: Any) -> None:
    u = _unknown_world(db, clock)
    rules = R(include={"channels": [u.cid]}, exclude={"shorts": True})
    engine = make_engine(u.world, details_budget_s=5.0)
    # no Refresher wired: unknown passes and the engine does not call YouTube
    assert ids(engine.preview(rules)) == u.vids
    assert u.world.youtube.network_calls() == []
    asked: list[tuple[list[str], dict[str, Any]]] = []

    def resolver(video_ids: Any, **kw: Any) -> dict[str, bool]:
        asked.append((list(video_ids), kw))
        out = {}
        for v in video_ids:
            out[v] = v == u.vids[1]
            u.world.video_store.set_details(v, None, out[v])
        return out

    engine.attach_shorts_resolver(resolver)
    assert ids(engine.preview(rules)) == [v for v in u.vids if v != u.vids[1]]
    (call,) = asked
    assert set(call[0]) == set(u.vids) and 0 < call[1]["timeout"] <= 5.0
    assert u.world.youtube.network_calls() == []  # never YouTube directly
    assert u.world.video_store.get([u.vids[1]])[u.vids[1]].is_short is True
    ids(engine.preview(rules))
    assert len(asked) == 1  # already resolved: nothing to ask


def test_shorts_with_the_refresher_resolver_and_failures(db: Any, clock: Any) -> None:
    u = _unknown_world(db, clock)
    u.world.youtube.add_short(u.vids[0])
    rules = R(include={"channels": [u.cid]}, exclude={"shorts": True})
    # a broken resolver does not take the feed down (unknown passes)
    other = make_engine(u.world, details_budget_s=5.0)

    def broken(video_ids: Any, **kw: Any) -> dict[str, bool]:
        raise RuntimeError("quebrou")

    other.attach_shorts_resolver(broken)
    assert ids(other.preview(rules)) == u.vids
    # the (fake) Refresher resolves through its YouTube and writes through set_details
    engine = make_engine(u.world, details_budget_s=5.0)
    engine.attach_shorts_resolver(u.world.refresher.resolve_shorts)
    assert ids(engine.preview(rules)) == u.vids[1:]
    assert u.world.video_store.get([u.vids[0]])[u.vids[0]].is_short is True


# =========================================================================== VideoStateService


def test_video_state_service_rules(db: Any, clock: Any) -> None:
    world = real_world(db, clock)
    vs = world.video_state
    a, b, c = "b03stateaaa", "b03statebbb", "b03stateccc"
    assert vs.get([a, b]) == {}
    assert vs.set_state([a, b, a], T.VideoState.seen) == 2
    assert vs.set_state([a, b], T.VideoState.seen) == 0  # idempotent
    assert len(world.changelog.list()) == 1
    rows = vs.get([a, b, c])
    assert set(rows) == {a, b}
    assert rows[a] == T.VideoStateRow(a, T.VideoState.seen, None, clock.now())
    clock.advance(10)
    row = vs.set_reaction(a, T.Reaction.up)
    assert row == T.VideoStateRow(a, T.VideoState.seen, T.Reaction.up, clock.now())
    assert vs.reactions() == {a: T.Reaction.up}
    assert vs.reactions([b]) == {}
    clock.advance(10)
    vs.set_state([c], T.VideoState.later)
    clock.advance(10)
    vs.set_state([b], T.VideoState.later)
    assert [r.video_id for r in vs.list_by_state(T.VideoState.later)] == [b, c]
    assert [r.video_id for r in vs.list_by_state(T.VideoState.later, limit=1)] == [b]
    assert vs.set_reaction(a, None).reaction is None
    assert vs.set_reaction("b03statezzz", None) == T.VideoStateRow("b03statezzz")
    for bad in (["curto"], ["b03stateaaa", "x" * 12]):
        with pytest.raises(T.ValidationError):
            vs.set_state(bad, T.VideoState.seen)
    with pytest.raises(T.ValidationError):
        vs.set_state([a], "voando")  # type: ignore[arg-type]
    with pytest.raises(T.ValidationError):
        vs.set_reaction(a, "meh")  # type: ignore[arg-type]
    with pytest.raises(T.ValidationError):
        vs.list_by_state(T.VideoState.later, limit=0)
    n = len(world.changelog.list())
    vs.set_state([a], T.VideoState.watched, actor=T.Actor.extension)
    assert len(world.changelog.list()) == n  # only user actions go to history


def test_video_state_change_and_undo(db: Any, clock: Any) -> None:
    world = real_world(db, clock)
    vs = world.video_state
    a, b = "b03undoaaaa", "b03undobbbb"
    vs.set_state([a], T.VideoState.later)
    assert vs.change([a, b], state=T.VideoState.seen, reaction=T.Reaction.down) == 2
    rec = world.changelog.list()[0]
    assert rec.action is T.ChangeAction.video_state and rec.actor is T.Actor.user
    assert rec.payload["count"] == 2 and rec.payload["label"]
    assert rec.undo == T.UndoVideoState(before={a: {"state": "later", "reaction": None}, b: None})
    world.changelog.undo(rec.id, targets=world.targets())
    rows = vs.get([a, b])
    assert rows[a].state is T.VideoState.later and rows[a].reaction is None
    assert b not in rows
    with pytest.raises(T.ValidationError):
        vs.change([a])  # neither state nor reaction
    with pytest.raises(T.UndoRefused):
        vs.apply_undo(replace(rec, action=T.ChangeAction.mark_read, undo=T.UndoMarkRead(before={})))


# ======================================================================== REST routes and extension


@pytest.fixture
def api(env: SimpleNamespace, wire: Any) -> SimpleNamespace:
    wire.use_world(env.world)
    wire.set("feed", env.engine)
    return env


def _jsonable(value: Any) -> Any:
    return T.to_jsonable(value)


def test_get_feed_by_tab_folder_channel(api: SimpleNamespace) -> None:
    s = api.seed
    data = check_op("getFeed", api_feed.get_feed(None, {"tab": T.BUILTIN_TAB_ALL_NEW}))
    assert data == _jsonable(api.engine.page(T.BUILTIN_TAB_ALL_NEW))
    data = check_op("getFeed", api_feed.get_feed(None, {"tab": s.category_tab, "limit": "2"}))
    assert len(data["items"]) == 2 and data["next_cursor"]
    more = check_op(
        "getFeed",
        api_feed.get_feed(
            None, {"tab": s.category_tab, "limit": "2", "cursor": data["next_cursor"]}
        ),
    )
    assert more == _jsonable(api.engine.page(s.category_tab, limit=2, cursor=data["next_cursor"]))
    folder = check_op("getFeed", api_feed.get_feed(None, {"folder": s.folders["Tecnologia"]}))
    assert folder == _jsonable(
        api.engine.preview(R(include={"folders": [s.folders["Tecnologia"]]}))
    )
    assert folder["items"][0]["why"] == {"via": "folder", "label": "Tecnologia", "detail": None}
    chan = check_op("getFeed", api_feed.get_feed(None, {"channel": s.channels["mkbhd"]}))
    assert {i["video"]["id"] for i in chan["items"]} == {api.V["mkbhd-new"], api.V["mkbhd-seen"]}
    out = check_op("getFeed", api_feed.get_feed(None, {"channel": "UCseedthemechan000000001"}))
    assert len(out["items"]) == 3  # channel outside the table with videos (theme)
    assert out["items"][0]["why"]["label"] == "Canal de Agentes"


def test_get_feed_errors(api: SimpleNamespace) -> None:
    s = api.seed
    fn = api_feed.get_feed
    assert err_code(fn, None, {}) == "invalid"
    assert err_code(fn, None, {"tab": "all-new", "folder": s.folders["IA"]}) == "invalid"
    assert err_code(fn, None, {"tab": "nao-existe"}) == "not_found"
    assert err_code(fn, None, {"folder": "nao-existe"}) == "not_found"
    assert err_code(fn, None, {"channel": "nao-e-canal"}) == "invalid"
    assert err_code(fn, None, {"channel": "UCnobodyhere0000000000xy"}) == "not_found"
    for limit in ("0", "101", "abc"):
        assert err_code(fn, None, {"tab": "all-new", "limit": limit}) == "invalid"
    assert err_code(fn, None, {"tab": "all-new", "cursor": "lixo"}) == "invalid"


def test_post_feed_preview(api: SimpleNamespace) -> None:
    s = api.seed
    for tab in api.world.tabs.list():
        body = {"rules": tab.rules.to_dict(), "limit": 5}
        data = check_op("postFeedPreview", api_feed.post_feed_preview(body, {}))
        assert data == _jsonable(api.engine.page(tab.id, limit=5)), tab.id
    body = {"rules": {"include": {"folders": [s.folders["IA"]]}, "filters": {"min_s": 1200}}}
    data = check_op("postFeedPreview", api_feed.post_feed_preview(body, {}))
    assert [i["video"]["id"] for i in data["items"]] == [api.V["twominute-new"]]
    first = check_op(
        "postFeedPreview",
        api_feed.post_feed_preview({"rules": {"include": {"all": True}}, "limit": 3}, {}),
    )
    nxt = check_op(
        "postFeedPreview",
        api_feed.post_feed_preview(
            {"rules": {"include": {"all": True}}, "limit": 3, "cursor": first["next_cursor"]}, {}
        ),
    )
    assert not {i["video"]["id"] for i in first["items"]} & {i["video"]["id"] for i in nxt["items"]}
    # missing folder in the preview: empty list (the editor has not saved yet)
    data = check_op(
        "postFeedPreview",
        api_feed.post_feed_preview({"rules": {"include": {"folders": ["f_tech"]}}}, {}),
    )
    assert data == {"items": [], "next_cursor": None, "counts": {"total": 0, "new": 0}}
    fn = api_feed.post_feed_preview
    assert err_code(fn, {}, {}) == "invalid"
    assert err_code(fn, {"rules": {"include": {"nope": []}}}, {}) == "invalid"
    assert err_code(fn, {"rules": {"mode": "voando"}}, {}) == "invalid"
    assert err_code(fn, {"rules": {}, "limit": 0}, {}) == "invalid"
    assert err_code(fn, {"rules": "x"}, {}) == "invalid"


def test_get_videos(api: SimpleNamespace) -> None:
    V = api.V
    q = {"ids": f"{V['mkbhd-seen']},{V['theme-' + api.seed.theme_videos[0]]},b03unknown1"}
    data = check_op("getVideos", api_feed.get_videos(None, q))
    got = {i["video"]["id"]: i for i in data["items"]}
    assert set(got) == {V["mkbhd-seen"], api.seed.theme_videos[0]}
    assert got[V["mkbhd-seen"]]["state"] == "later" and got[V["mkbhd-seen"]]["why"] is None
    assert got[V["mkbhd-seen"]]["channel"]["id"] == api.seed.channels["mkbhd"]
    assert got[api.seed.theme_videos[0]]["channel"] is None
    assert [i["video"]["id"] for i in data["items"]] == [V["mkbhd-seen"], api.seed.theme_videos[0]]
    fn = api_feed.get_videos
    assert err_code(fn, None, {}) == "invalid"
    assert err_code(fn, None, {"ids": "curto"}) == "invalid"
    assert err_code(fn, None, {"ids": ",".join(["seedvid0001"] * 51)}) == "invalid"


def test_get_state_and_videos_by_state(api: SimpleNamespace) -> None:
    V = api.V
    data = check_op("getState", api_state.get_state(None, {}))
    assert data == {"counts": _jsonable(api.engine.new_counts()), "videos": {}}
    q = {"ids": f"{V['mkbhd-seen']},{V['veritasium-seen']},{V['fireship-new']}"}
    data = check_op("getState", api_state.get_state(None, q))
    assert set(data["videos"]) == {V["mkbhd-seen"], V["veritasium-seen"]}
    assert data["videos"][V["veritasium-seen"]]["reaction"] == "up"
    assert err_code(api_state.get_state, None, {"ids": "nope"}) == "invalid"
    assert (
        err_code(api_state.get_state, None, {"ids": ",".join(["seedvid0001"] * 201)}) == "invalid"
    )
    data = check_op("getVideosByState", api_state.get_videos_by_state(None, {"state": "later"}))
    assert [r["video_id"] for r in data["items"]] == [V["mkbhd-seen"]]
    data = check_op(
        "getVideosByState", api_state.get_videos_by_state(None, {"state": "seen", "limit": "2"})
    )
    assert len(data["items"]) == 2
    fn = api_state.get_videos_by_state
    assert err_code(fn, None, {}) == "invalid"
    assert err_code(fn, None, {"state": "voando"}) == "invalid"
    assert err_code(fn, None, {"state": "seen", "limit": "501"}) == "invalid"


def test_post_videos_state(api: SimpleNamespace) -> None:
    V, w = api.V, api.world
    body = {"video_ids": [V["fireship-new"], V["twominute-new"]], "state": "seen"}
    assert check_op("postVideosState", api_state.post_videos_state(body, {})) == {"changed": 2}
    assert check_op("postVideosState", api_state.post_videos_state(body, {})) == {"changed": 0}
    rec = w.changelog.list()[0]
    assert rec.actor is T.Actor.user and rec.action is T.ChangeAction.video_state
    body = {"video_ids": [V["fireship-new"]], "reaction": "down"}
    assert check_op("postVideosState", api_state.post_videos_state(body, {})) == {"changed": 1}
    assert w.video_state.get([V["fireship-new"]])[V["fireship-new"]].reaction is T.Reaction.down
    body = {"video_ids": [V["fireship-new"]], "reaction": None}
    assert check_op("postVideosState", api_state.post_videos_state(body, {})) == {"changed": 1}
    assert w.video_state.reactions([V["fireship-new"]]) == {}
    # undoable through the history route (ChangeLog.undo)
    w.changelog.undo(w.changelog.list()[-1].id, targets=w.targets())
    assert V["fireship-new"] in {i.video.id for i in api.engine.page(T.BUILTIN_TAB_ALL_NEW).items}
    fn = api_state.post_videos_state
    assert err_code(fn, {}, {}) == "invalid"
    assert err_code(fn, {"video_ids": []}, {}) == "invalid"
    assert err_code(fn, {"video_ids": [V["fireship-new"]]}, {}) == "invalid"
    assert err_code(fn, {"video_ids": ["x"], "state": "seen"}, {}) == "invalid"
    assert err_code(fn, {"video_ids": [V["fireship-new"]], "state": "voando"}, {}) == "invalid"
    assert err_code(fn, {"video_ids": [V["fireship-new"]], "reaction": "meh"}, {}) == "invalid"
    assert err_code(fn, {"video_ids": "seedvid0001", "state": "seen"}, {}) == "invalid"


def test_ext_handlers_and_same_feed_everywhere(api: SimpleNamespace) -> None:
    """Same tab = same feed on the Desktop (REST), in the extension and in the engine (tool)."""
    device = T.Device(id="dev_1", name="Chrome", created_at=1)
    s = api.seed
    for query in (
        {"tab": T.BUILTIN_TAB_ALL_NEW},
        {"tab": s.category_tab, "limit": "3"},
        {"folder": s.folders["Ciência"]},
        {"channel": s.channels["fireship"]},
    ):
        rest = check_op("getFeed", api_feed.get_feed(None, dict(query)))
        ext = check_op("extGetFeed", ext_feed.get_feed(device, None, dict(query), feed=api.engine))
        assert rest == ext, query
    assert rest == _jsonable(api.engine.preview(F.scope_rules(channel=s.channels["fireship"])))
    with pytest.raises(T.ValidationError):
        ext_feed.get_feed(device, None, {}, feed=api.engine)
    body = {"video_ids": [api.V["kurzgesagt-new"]], "state": "later"}
    env = ext_feed.post_videos_state(device, body, {}, video_state=api.world.video_state)
    assert check_op("extPostVideosState", env) == {"changed": 1}
    assert api.world.changelog.list()[0].actor is T.Actor.user
    env = ext_feed.post_read(device, {"kind": "all"}, {}, refresher=api.world.refresher)
    assert check_op("extPostRead", env)["changed"] > 0
    assert api.engine.new_counts().total == 0
    with pytest.raises(T.ValidationError):
        ext_feed.post_read(device, {"kind": "folder"}, {}, refresher=api.world.refresher)
    with pytest.raises(T.ValidationError):
        ext_feed.post_read(device, {"kind": "tudo"}, {}, refresher=api.world.refresher)


def test_feed_routes_attach_the_refresher_for_shorts(api: SimpleNamespace, wire: Any) -> None:
    engine = make_engine(api.world)
    wire.set("feed", engine)
    assert not engine.has_shorts_resolver
    check_op("getFeed", api_feed.get_feed(None, {"tab": T.BUILTIN_TAB_ALL_NEW}))
    assert engine.has_shorts_resolver
