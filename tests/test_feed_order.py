"""``GET /feed`` sorts (``sort``) and groups (``group``) on the server.

Contract (in ``contract/api.yaml``, used by the Desktop feed): ``sort`` = ``newest`` (default: the
previous behavior, byte for byte) · ``oldest`` · ``longest`` · ``shortest`` (no duration last)
· ``views`` (no count last); ``group`` = ``none`` · ``channel`` (name ignoring accents/case) ·
``folder`` (folder order; no folder last) · ``day`` (local publish day, most recent first, with
``tz_offset_min``) · ``kind`` (videos, Shorts, unknown). The server only sorts by the group and
then by ``sort`` (ties broken by id); the cursor carries ``sort`` and ``group``.

Real database + ``seed_world`` + 60 extra videos with deliberate ties (same date, same duration,
same views, missing data).
"""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import random
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fakes import build_fake_world
from fakes import seed_world as _seed

from tube_pkg.api import _common
from tube_pkg.api import feed as api_feed
from tube_pkg.core import dedup
from tube_pkg.core import feed as F
from tube_pkg.core import types as T
from tube_pkg.core import video_state as VS

ROOT = Path(__file__).resolve().parents[1]
DAY = 86_400
SORTS = ("newest", "oldest", "longest", "shortest", "views")
GROUPS = ("none", "channel", "folder", "day", "kind")


def _gen() -> Any:
    name = "_gen_types_b13_order"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "gen_types.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


def check_op(operation_id: str, env: Any) -> Any:
    gen = _gen()
    assert _common.is_envelope(env) and env["ok"] is True, env
    op = gen.get_operation(gen.load_contract(ROOT), operation_id)
    gen.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    return env["data"]


def err(fn: Any, body: Any, query: dict[str, str]) -> dict[str, Any]:
    env = _common.call_rest(fn, body, query)
    assert env["ok"] is False, env
    return env["error"]


def make_engine(world: Any) -> Any:
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


def vid(k: int) -> str:
    return f"o13vid{k:05d}"


def build(db: Any, clock: Any, *, extras: bool = True, settings: Any = None) -> SimpleNamespace:
    world = build_fake_world(db, clock=clock, settings=settings)
    world.video_state = VS.build(
        db=db, settings=world.settings, changelog=world.changelog, clock=clock
    )
    seed = _seed(world)
    now = clock.now()
    later: list[str] = []
    if extras:
        rng = random.Random(13)
        active = [
            seed.channels[k]
            for k in ("fireship", "twominute", "aiexplained", "mkbhd", "linus", "veritasium")
            if k in seed.channels
        ]
        rows = []
        for k in range(60):
            cid = active[k % len(active)]
            published = None if k % 17 == 0 else now - rng.randrange(0, 12) * 6 * 3600 - 60
            duration = None if k % 5 == 0 else rng.choice([45, 59, 600, 600, 1500, 3600])
            views = None if k % 7 == 0 else rng.choice([10, 1000, 1000, 50_000])
            short = None if k % 4 == 0 else (duration is not None and duration < 61)
            rows.append(
                T.VideoIn(
                    id=vid(k),
                    channel_id=cid,
                    title=f"Extra {k} {'agentes' if k % 3 == 0 else 'outro'}",
                    published_at=published,
                    channel_title=None,
                    views=views,
                    duration_s=duration,
                    is_short=short,
                )
            )
        world.video_store.upsert(rows, T.VideoOrigin.rss)
        later = [vid(k) for k in range(0, 60, 4)]
        for n, chunk in enumerate((later[:5], later[5:9], later[9:])):  # ties in updated_at
            clock.set(now + n)
            world.video_state.set_state(chunk, T.VideoState.later, actor=T.Actor.user)
        clock.set(now)
    return SimpleNamespace(world=world, seed=seed, engine=make_engine(world), later=later)


@pytest.fixture
def env(db: Any, clock: Any) -> SimpleNamespace:
    return build(db, clock)


def query_all(engine: Any, query: dict[str, Any], *, limit: int) -> tuple[list[str], list[Any]]:
    """Every page of *query* with *limit*; returns ids and items in order."""
    out: list[str] = []
    items: list[Any] = []
    cursor = None
    for _ in range(200):
        q = {**query, "limit": str(limit)}
        if cursor:
            q["cursor"] = cursor
        page = F.page_for_query(engine, q)
        out += [i.video.id for i in page.items]
        items += list(page.items)
        cursor = page.next_cursor
        if not cursor:
            return out, items
    raise AssertionError("pagination never ends")


def sources(env: SimpleNamespace) -> list[dict[str, str]]:
    s = env.seed
    category = env.world.db.query_one("SELECT id FROM tabs WHERE kind = 'category'")["id"]
    return [
        {"tab": T.BUILTIN_TAB_ALL_NEW},
        {"tab": T.BUILTIN_TAB_FAVORITES},
        {"tab": category},
        {"tab": s.theme_tab},
        {"folder": s.folders["Tecnologia"]},
        {"channel": s.channels["fireship"]},
        {"state": "later"},
        {"tab": T.BUILTIN_TAB_ALL_NEW, "q": "agentes"},
        {"folder": s.folders["Tecnologia"], "q": "extra"},
    ]


# --------------------------------------------------------------------------- reference (the rule)


def _norm(text: str) -> str:
    return dedup.normalize_name(text)


def folder_rank(env: SimpleNamespace) -> dict[str, int]:
    """Sidebar folder order: depth-first tree, siblings by (sort, name, id)."""
    rows = env.world.db.query("SELECT id, name, parent_id, sort FROM folders")
    kids: dict[Any, list[Any]] = {}
    for r in rows:
        kids.setdefault(r["parent_id"], []).append(r)
    order: list[str] = []

    def walk(parent: Any) -> None:
        for r in sorted(kids.get(parent, []), key=lambda r: (r["sort"], r["name"], r["id"])):
            order.append(r["id"])
            walk(r["id"])

    walk(None)
    return {fid: n for n, fid in enumerate(order)}


def expected_group(item: Any, group: str, ranks: dict[str, int], tz: int) -> tuple[Any, ...]:
    v = item.video
    if group == "channel":
        name = (item.channel.title if item.channel else None) or v.channel_title or v.channel_id
        return (_norm(name), v.channel_id)
    if group == "folder":
        fid = item.channel.folder_id if item.channel else None
        return (0, ranks[fid]) if fid in ranks else (1, 0)
    if group == "day":
        if not v.published_at:
            return (1, 0)
        return (0, -((v.published_at + tz * 60) // DAY))
    if group == "kind":
        return ({False: 0, True: 1, None: 2}[v.is_short],)
    return ()


def expected_sort(item: Any, sort: str) -> tuple[Any, ...]:
    v = item.video
    if sort == "oldest":
        return (0, v.published_at) if v.published_at else (1, 0)
    if sort == "longest":
        return (0, -v.duration_s) if v.duration_s is not None else (1, 0)
    if sort == "shortest":
        return (0, v.duration_s) if v.duration_s is not None else (1, 0)
    if sort == "views":
        return (0, -v.views) if v.views is not None else (1, 0)
    return ()


def check_order(
    items: list[Any], baseline: list[Any], sort: str, group: str, ranks: dict[str, int], tz: int
) -> None:
    """*items* = the *baseline* set (default order), arranged by group → sort → id; with
    ``newest``, the source default order applies inside the group."""
    assert sorted(i.video.id for i in items) == sorted(i.video.id for i in baseline)
    position = {i.video.id: n for n, i in enumerate(baseline)}

    def key(i: Any) -> tuple[Any, ...]:
        tail = (
            (position[i.video.id],) if sort == "newest" else (*expected_sort(i, sort), i.video.id)
        )
        return (*expected_group(i, group, ranks, tz), *tail)

    want = [i.video.id for i in sorted(baseline, key=key)]
    assert [i.video.id for i in items] == want, (sort, group)


# --------------------------------------------------------------------------- default = before


def _digest(env: SimpleNamespace) -> str:
    """Fingerprint of the default feed (every source, pages of 7, cursors included)."""
    out = []
    for query in sources(env):
        cursor = None
        while True:
            q = {**query, "limit": "7", **({"cursor": cursor} if cursor else {})}
            page = T.to_jsonable(F.page_for_query(env.engine, q))
            out.append(page)
            cursor = page["next_cursor"]
            if not cursor:
                break
    blob = json.dumps(out, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(blob).hexdigest()


GOLDEN_DEFAULT = "79b9924571b3717376fa8cfc3ad4ec22217bea1edf692d8aa3984a4da5568941"
"""``_digest`` with ``core/feed.py`` as it was before sort and group (``main`` at 73d8c56)."""


def test_default_order_is_byte_for_byte_the_old_one(env: SimpleNamespace) -> None:
    assert _digest(env) == GOLDEN_DEFAULT


def test_explicit_newest_none_equals_omitted(env: SimpleNamespace) -> None:
    for query in sources(env):
        plain = query_all(env.engine, query, limit=7)[0]
        explicit = query_all(
            env.engine,
            {**query, "sort": "newest", "group": "none", "tz_offset_min": "-180"},
            limit=7,
        )[0]
        assert plain == explicit, query
        page = F.page_for_query(env.engine, {**query, "sort": "newest", "group": "none"})
        assert page.next_cursor is None or page.next_cursor[:2] in ("p:", "v:", "l:")


# --------------------------------------------------------------------------- each sort and group


@pytest.mark.parametrize("group", GROUPS)
@pytest.mark.parametrize("sort", SORTS)
def test_every_sort_and_group_and_pages_of_7_equal_the_whole_list(
    env: SimpleNamespace, sort: str, group: str
) -> None:
    ranks = folder_rank(env)
    for query in sources(env):
        baseline = query_all(env.engine, query, limit=100)[1]
        q = {**query, "sort": sort, "group": group, "tz_offset_min": "-180"}
        whole_ids, whole = query_all(env.engine, q, limit=100)
        paged_ids, _ = query_all(env.engine, q, limit=7)
        assert len(whole_ids) == len(set(whole_ids)), (query, sort, group)
        assert paged_ids == whole_ids, (query, sort, group)
        check_order(whole, baseline, sort, group, ranks, -180)


def test_unknown_duration_and_views_go_last(env: SimpleNamespace) -> None:
    # 0 views is a known count: it comes before videos with no count
    env.world.video_store.upsert(
        [
            T.VideoIn(
                id="zzzviews000",
                channel_id=env.seed.channels["fireship"],
                title="ninguém viu",
                published_at=env.seed.now - 60,
                views=0,
                duration_s=1,
            )
        ],
        T.VideoOrigin.rss,
    )
    for sort, attr in (("longest", "duration_s"), ("shortest", "duration_s"), ("views", "views")):
        _, items = query_all(env.engine, {"tab": T.BUILTIN_TAB_ALL_NEW, "sort": sort}, limit=100)
        values = [getattr(i.video, attr) for i in items]
        first_none = values.index(None)
        assert first_none > 0 and all(v is None for v in values[first_none:]), sort


def test_group_channel_ignores_accents_and_case(db: Any, clock: Any) -> None:
    env = build(db, clock, extras=False)
    now = clock.now()
    names = {
        f"UCb13acc{n:016d}": name for n, name in enumerate(("Ábaco", "abacate", "Zebra", "árvore"))
    }
    db.executemany(
        "INSERT INTO channels (id, title, relation, source, added_at) VALUES (?, ?, 'subscribed',"
        " 'extension', 0)",
        list(names.items()),
    )
    env.world.video_store.upsert(
        [
            T.VideoIn(id=f"acc{n:08d}", channel_id=c, title="zqxacc", published_at=now - n * 60)
            for n, c in enumerate(names)
        ],
        T.VideoOrigin.rss,
    )
    _, items = query_all(
        env.engine, {"tab": T.BUILTIN_TAB_ALL_NEW, "group": "channel", "q": "zqxacc"}, limit=100
    )
    assert [i.channel.title for i in items] == ["abacate", "Ábaco", "árvore", "Zebra"]


def test_group_day_uses_the_local_day(db: Any, clock: Any) -> None:
    env = build(db, clock, extras=False)
    cid = env.seed.channels["fireship"]
    midnight = (clock.now() // DAY) * DAY  # 00:00 UTC today
    env.world.video_store.upsert(
        [
            T.VideoIn(
                id="day00000001", channel_id=cid, title="zz 01h UTC", published_at=midnight + 3600
            ),
            T.VideoIn(
                id="day00000002",
                channel_id=cid,
                title="zz 05h UTC",
                published_at=midnight + 5 * 3600,
            ),
        ],
        T.VideoOrigin.rss,
    )
    base = {"channel": cid, "q": "zz", "group": "day", "sort": "oldest"}
    _, utc = query_all(env.engine, base, limit=100)
    assert [i.video.id for i in utc] == ["day00000001", "day00000002"]  # same day, oldest first
    _, brt = query_all(env.engine, {**base, "tz_offset_min": "-180"}, limit=100)
    # in Brasília 01:00 UTC is 22:00 the day before: the latest day (the 05:00 UTC one) is first
    assert [i.video.id for i in brt] == ["day00000002", "day00000001"]


def test_group_folder_follows_the_folder_tree_and_no_folder_is_last(env: SimpleNamespace) -> None:
    s = env.seed
    rules = T.TabRules.from_dict({"include": {"all": True, "themes": [s.theme]}})
    items = list(env.engine.preview(rules, limit=500, group="folder").items)
    assert any(i.channel is None for i in items)  # theme videos: channel not in the table
    order: list[Any] = []
    for i in items:
        fid = i.channel.folder_id if i.channel else None
        if not order or order[-1] != fid:
            order.append(fid)
    assert len(order) == len(set(order))  # each folder in a single block
    known = [f for f in order if f is not None]
    assert known == sorted(known, key=folder_rank(env).__getitem__)
    assert s.folders["Tecnologia"] in known and s.folders["IA"] in known
    assert known.index(s.folders["Tecnologia"]) < known.index(s.folders["IA"])  # parent first
    assert order[-1] is None


def test_group_kind_videos_then_shorts_then_unknown(env: SimpleNamespace) -> None:
    _, items = query_all(env.engine, {"tab": T.BUILTIN_TAB_ALL_NEW, "group": "kind"}, limit=100)
    kinds = [i.video.is_short for i in items]
    assert kinds == sorted(kinds, key=lambda k: {False: 0, True: 1, None: 2}[k])
    assert {False, True, None} <= set(kinds)


# --------------------------------------------------------------------------- tab rule


def test_tab_rules_still_hold_with_sort_and_group(env: SimpleNamespace) -> None:
    rules = T.TabRules.from_dict(
        {"include": {"all": True}, "filters": {"per_channel": 2}, "mode": "classics"}
    )
    default = env.engine.preview(rules, limit=500)
    for sort in SORTS:
        for group in GROUPS:
            page = env.engine.preview(rules, limit=500, sort=sort, group=group)
            assert {i.video.id for i in page.items} == {i.video.id for i in default.items}
            per: dict[str, int] = {}
            for i in page.items:
                per[i.video.channel_id] = per.get(i.video.channel_id, 0) + 1
            assert max(per.values()) <= 2
            assert page.counts == default.counts
    # classics: the default stays by views (the tab rule), not by date
    views = [i.video.views or 0 for i in default.items]
    assert views == sorted(views, reverse=True)


# --------------------------------------------------------------------------- cursor


def test_deeply_nested_cursor_is_invalid_not_internal(env: SimpleNamespace) -> None:
    """A cursor whose JSON nests deeper than the parser allows is a bad cursor (``invalid``), not
    an internal error with a stack in the log for every request."""
    base = {"tab": T.BUILTIN_TAB_ALL_NEW, "limit": "7", "sort": "longest", "group": "channel"}
    first = F.page_for_query(env.engine, base)
    assert first.next_cursor
    prefix = first.next_cursor.rsplit(":", 1)[0]
    # 3000 levels fit under the length cap and pass the recursion limit; 200 000 hit the cap
    for depth in (3000, 200_000):
        nested = base64.urlsafe_b64encode(b"[" * depth).decode("ascii").rstrip("=")
        with pytest.raises(T.ValidationError) as exc:
            F.page_for_query(env.engine, {**base, "cursor": f"{prefix}:{nested}"})
        assert exc.value.details.get("field") == "cursor", depth


def test_cursor_carries_sort_and_group(env: SimpleNamespace) -> None:
    base = {"tab": T.BUILTIN_TAB_ALL_NEW, "limit": "7"}
    first = F.page_for_query(env.engine, {**base, "sort": "longest", "group": "channel"})
    assert first.next_cursor
    for other in (
        {"sort": "longest", "group": "kind"},
        {"sort": "views", "group": "channel"},
        {},  # default
        {"sort": "newest", "group": "none"},
    ):
        with pytest.raises(T.ValidationError) as exc:
            F.page_for_query(env.engine, {**base, **other, "cursor": first.next_cursor})
        assert exc.value.details.get("field") == "cursor"
    # keys with the same shape (folder and day: two integers) do not mix either
    folder = F.page_for_query(env.engine, {**base, "sort": "longest", "group": "folder"})
    with pytest.raises(T.ValidationError):
        F.page_for_query(
            env.engine,
            {**base, "sort": "longest", "group": "day", "cursor": folder.next_cursor},
        )
    plain = F.page_for_query(env.engine, base)
    assert plain.next_cursor
    with pytest.raises(T.ValidationError) as exc:
        F.page_for_query(env.engine, {**base, "group": "day", "cursor": plain.next_cursor})
    assert exc.value.details.get("field") == "cursor"
    day = F.page_for_query(env.engine, {**base, "group": "day", "tz_offset_min": "-180"})
    with pytest.raises(T.ValidationError):  # same grouping, another time zone
        F.page_for_query(
            env.engine, {**base, "group": "day", "tz_offset_min": "60", "cursor": day.next_cursor}
        )
    for bad in ("o:longest:channel:0:%%%", "o:longest:channel:0:W10", "o:x:y:0:W10"):
        with pytest.raises(T.ValidationError):
            F.page_for_query(
                env.engine, {**base, "sort": "longest", "group": "channel", "cursor": bad}
            )


def test_video_arriving_mid_pagination_repeats_and_skips_nothing(env: SimpleNamespace) -> None:
    for sort, group in (("longest", "channel"), ("oldest", "day"), ("views", "kind")):
        q = {"tab": T.BUILTIN_TAB_ALL_NEW, "sort": sort, "group": group, "limit": "7"}
        before = query_all(env.engine, q, limit=100)[0]
        first = F.page_for_query(env.engine, q)
        seen = [i.video.id for i in first.items]
        cid = env.seed.channels["fireship"]
        new_id = f"mid{sort[:4]}{group[:4]}".ljust(11, "0")[:11]
        env.world.video_store.upsert(
            [
                T.VideoIn(
                    id=new_id,
                    channel_id=cid,
                    title="chegou agora",
                    published_at=env.seed.now,
                    duration_s=700,
                    views=1000,
                    is_short=False,
                )
            ],
            T.VideoOrigin.rss,
        )
        cursor = first.next_cursor
        while cursor:
            page = F.page_for_query(env.engine, {**q, "cursor": cursor})
            seen += [i.video.id for i in page.items]
            cursor = page.next_cursor
        assert len(seen) == len(set(seen)), (sort, group)
        assert set(before) <= set(seen), (sort, group)


# --------------------------------------------------------------------------- errors and routes


def test_invalid_values_name_the_field(env: SimpleNamespace) -> None:
    base = {"tab": T.BUILTIN_TAB_ALL_NEW}
    for extra, field in (
        ({"sort": "random"}, "sort"),
        ({"group": "tag"}, "group"),
        ({"tz_offset_min": "abc"}, "tz_offset_min"),
        ({"tz_offset_min": "900"}, "tz_offset_min"),
        ({"tz_offset_min": "-841"}, "tz_offset_min"),
    ):
        with pytest.raises(T.ValidationError) as exc:
            F.page_for_query(env.engine, {**base, **extra})
        assert exc.value.details.get("field") == field, extra


def test_messages_follow_the_language_rule(db: Any, clock: Any) -> None:
    env_en = build(db, clock, extras=False)
    with pytest.raises(T.ValidationError) as exc:
        F.page_for_query(env_en.engine, {"tab": T.BUILTIN_TAB_ALL_NEW, "sort": "random"})
    assert "expected one of" in exc.value.message
    env_en.world.settings.values["language"] = "pt-BR"
    with pytest.raises(T.ValidationError) as exc:
        F.page_for_query(env_en.engine, {"tab": T.BUILTIN_TAB_ALL_NEW, "group": "tag"})
    assert "esperava um de" in exc.value.message
    with pytest.raises(T.ValidationError) as exc:
        F.page_for_query(
            env_en.engine,
            {"tab": T.BUILTIN_TAB_ALL_NEW, "sort": "views", "cursor": "p:1:abcdefghijk"},
        )
    # the cursor message is English in every language (API text, not a screen)
    assert exc.value.message == (
        "cursor is invalid or from another sort or group; start again without a cursor"
    )
    assert exc.value.details.get("field") == "cursor"


def test_get_feed_route_with_sort_and_group(env: SimpleNamespace, wire: Any) -> None:
    wire.use_world(env.world)
    wire.set("feed", env.engine)
    data = check_op(
        "getFeed",
        api_feed.get_feed(
            None,
            {"tab": T.BUILTIN_TAB_ALL_NEW, "sort": "shortest", "group": "kind", "limit": "5"},
        ),
    )
    assert len(data["items"]) == 5 and data["next_cursor"].startswith("o:shortest:kind:")
    more = check_op(
        "getFeed",
        api_feed.get_feed(
            None,
            {
                "tab": T.BUILTIN_TAB_ALL_NEW,
                "sort": "shortest",
                "group": "kind",
                "limit": "5",
                "cursor": data["next_cursor"],
            },
        ),
    )
    assert not {i["video"]["id"] for i in more["items"]} & {i["video"]["id"] for i in data["items"]}
    e = err(api_feed.get_feed, None, {"tab": T.BUILTIN_TAB_ALL_NEW, "group": "tags"})
    assert e["code"] == "invalid" and e["details"]["field"] == "group"
    e = err(api_feed.get_feed, None, {"state": "later", "sort": "worst"})
    assert e["code"] == "invalid" and e["details"]["field"] == "sort"


def test_post_feed_preview_accepts_the_same_parameters(env: SimpleNamespace, wire: Any) -> None:
    wire.use_world(env.world)
    wire.set("feed", env.engine)
    rules = {"include": {"all": True}}
    body = {"rules": rules, "limit": 100, "sort": "longest", "group": "folder", "tz_offset_min": 0}
    data = check_op("postFeedPreview", api_feed.post_feed_preview(body, {}))
    want = env.engine.preview(
        T.TabRules.from_dict(rules), limit=100, sort="longest", group="folder"
    )
    assert [i["video"]["id"] for i in data["items"]] == [i.video.id for i in want.items]
    e = err(api_feed.post_feed_preview, {"rules": rules, "sort": 3}, {})
    assert e["code"] == "invalid" and e["details"]["field"] == "sort"
    e = err(api_feed.post_feed_preview, {"rules": rules, "tz_offset_min": True}, {})
    assert e["details"]["field"] == "tz_offset_min"


def test_ext_feed_shares_the_same_parser(env: SimpleNamespace) -> None:
    """``GET /ext/feed`` goes through ``page_for_query``: without the parameters nothing changes."""
    a = F.page_for_query(env.engine, {"tab": T.BUILTIN_TAB_ALL_NEW})
    b = env.engine.page(T.BUILTIN_TAB_ALL_NEW)
    assert T.to_jsonable(a) == T.to_jsonable(b)
