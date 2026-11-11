"""World of fakes assembled in ``BUILDS`` order, and ``seed_world`` (small, realistic data).

``build_fake_world(db)`` wires every fake over the same ``Db`` and the same clock. To test
a real implementation, build it with the world's dependencies (``world.channels``,
``world.changelog``…) and, if needed, swap the attribute: ``world.cleanup = real``.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from tube_pkg.core import types as T

from .ctx import FakeCtx
from .db import MemDb
from .infra import (
    FakeClock,
    FakeDeviceAuth,
    FakeEventSink,
    FakeHttp,
    FakeJobRunner,
    FakeLens,
    FakeLLM,
    FakeLLMBackend,
    FakeSettings,
)
from .ops import (
    FakeCleanup,
    FakeDataOps,
    FakeDemoLoader,
    FakeFeedEngine,
    FakeListImporter,
    FakeMaintenance,
    FakeOrganizer,
    FakeRefresher,
    FakeRoutinesInstaller,
    FakeSearcher,
    FakeSyncIngest,
    FakeThemes,
)
from .services import (
    FakeChangeLog,
    FakeChannelService,
    FakeTabService,
    FakeTaxonomyService,
    FakeVideoStateService,
    FakeVideoStore,
    IdGen,
)
from .youtube import FakeYouTube

DAY = 86_400


@dataclass(eq=False)
class FakeWorld:
    """Every ``BUILDS`` dependency (names = ``BuildSpec.provides``) + ``ctx``/``clock``."""

    db: Any
    clock: FakeClock
    ids: IdGen
    settings: Any
    http: Any
    events: Any
    youtube: Any
    llm_backend: Any
    llm: Any
    jobs: Any
    changelog: Any
    channels: Any
    taxonomy: Any
    tabs: Any
    video_state: Any
    video_store: Any
    lenses: list[Any]
    feed: Any
    devices: Any
    searcher: Any
    refresher: Any
    cleanup: Any
    sync: Any
    organizer: Any
    themes: Any
    demo: Any
    data: Any
    lists: Any
    maintenance: Any
    routines: Any
    ctx: Any
    ext_up: bool = True
    """Value of ``ext_endpoint_up()`` (mutable in the test)."""
    _spare_lens: Any = field(default=None, repr=False)

    def ext_endpoint_up(self) -> bool:
        return self.ext_up

    def targets(self) -> T.UndoTargets:
        return T.UndoTargets(
            channels=self.channels,
            taxonomy=self.taxonomy,
            tabs=self.tabs,
            video_state=self.video_state,
            refresher=self.refresher,
            organizer=self.organizer,
            cleanup=self.cleanup,
            themes=self.themes,
            data=self.data,
        )

    def providers(self) -> dict[str, Any]:
        """``name → object`` for ``wiring.get_<name>`` (``BuildSpec.provides`` + external ones)."""
        out = {spec.provides: getattr(self, spec.provides) for spec in T.BUILDS}
        out.update(
            {
                "lenses": list(self.lenses),
                "clock": self.clock,
                "ctx": self.ctx,
                "ext_endpoint_up": self.ext_endpoint_up,
            }
        )
        return out

    def instances(self) -> dict[str, Any]:
        """``Protocol`` → instance (for the fakes' conformance tests)."""
        lens = self.lenses[0] if self.lenses else self._spare_lens
        return {
            "Clock": self.clock,
            "Db": self.db,
            "Settings": self.settings,
            "HttpClient": self.http,
            "EventSink": self.events,
            "LLMBackend": self.llm_backend,
            "LLM": self.llm,
            "JobRunner": self.jobs,
            "YouTubeClient": self.youtube,
            "Lens": lens,
            "DeviceAuth": self.devices,
            "Undoable": self.channels,
            "ChangeLog": self.changelog,
            "ChannelService": self.channels,
            "TaxonomyService": self.taxonomy,
            "TabService": self.tabs,
            "VideoStateService": self.video_state,
            "VideoStore": self.video_store,
            "FeedEngine": self.feed,
            "Refresher": self.refresher,
            "Organizer": self.organizer,
            "Cleanup": self.cleanup,
            "Searcher": self.searcher,
            "Themes": self.themes,
            "ListImporter": self.lists,
            "SyncIngest": self.sync,
            "DemoLoader": self.demo,
            "DataOps": self.data,
            "RoutinesInstaller": self.routines,
            "Maintenance": self.maintenance,
        }


def build_fake_world(
    db: T.Db | None = None,
    *,
    clock: FakeClock | None = None,
    settings: Any = None,
    http: Any = None,
    events: Any = None,
    youtube: Any = None,
    llm: Any = None,
    llm_backend: Any = None,
    lenses: Sequence[Any] | None = None,
    ctx: Any = None,
    inline_refresh: bool = False,
) -> FakeWorld:
    """Builds every fake over *db* (a new ``MemDb`` if ``None``), in ``BUILDS`` order.

    ``lenses=None`` = ``[]`` (like ``wiring`` before lenses existed); ``llm=None`` = a scripted
    ``FakeLLM()`` (without ``auto``).
    """
    db = db if db is not None else MemDb()
    clock = clock or FakeClock()
    ids = IdGen()
    settings = settings or FakeSettings()
    http = http or FakeHttp()
    events = events or FakeEventSink()
    youtube = youtube or FakeYouTube()
    llm_backend = llm_backend or FakeLLMBackend()
    llm = llm or FakeLLM()
    lens_list = list(lenses or [])
    jobs = FakeJobRunner(events=events, clock=clock)
    changelog = FakeChangeLog(db, clock=clock, ids=ids)
    channels = FakeChannelService(db, changelog=changelog, youtube=youtube, clock=clock, ids=ids)
    taxonomy = FakeTaxonomyService(db, channels=channels, changelog=changelog, clock=clock, ids=ids)
    tabs = FakeTabService(
        db,
        changelog=changelog,
        known_lenses={T.HN_LENS, *(lens.name for lens in lens_list)},
        clock=clock,
        ids=ids,
    )
    video_state = FakeVideoStateService(db, changelog=changelog, clock=clock, ids=ids)
    video_store = FakeVideoStore(db, clock=clock, ids=ids)
    feed = FakeFeedEngine(
        db,
        tabs=tabs,
        taxonomy=taxonomy,
        channels=channels,
        video_state=video_state,
        video_store=video_store,
        lenses=lens_list,
        clock=clock,
        ids=ids,
    )
    holder: dict[str, FakeWorld] = {}

    def ext_up() -> bool:
        return holder["world"].ext_up if "world" in holder else True

    refresher = FakeRefresher(
        db,
        settings=settings,
        youtube=youtube,
        channels=channels,
        video_store=video_store,
        feed=feed,
        events=events,
        changelog=changelog,
        ext_endpoint_up=ext_up,
        inline=inline_refresh,
        clock=clock,
        ids=ids,
    )
    devices = FakeDeviceAuth(clock=clock)
    searcher = FakeSearcher(youtube=youtube, clock=clock, ids=ids)
    cleanup = FakeCleanup(
        db,
        settings=settings,
        llm=llm,
        channels=channels,
        events=events,
        changelog=changelog,
        clock=clock,
        ids=ids,
    )
    sync = FakeSyncIngest(
        db,
        settings=settings,
        channels=channels,
        video_state=video_state,
        refresher=refresher,
        feed=feed,
        tabs=tabs,
        taxonomy=taxonomy,
        searcher=searcher,
        cleanup=cleanup,
        clock=clock,
        ids=ids,
    )
    organizer = FakeOrganizer(
        db,
        llm=llm,
        channels=channels,
        taxonomy=taxonomy,
        changelog=changelog,
        clock=clock,
        ids=ids,
    )
    themes = FakeThemes(
        db,
        settings=settings,
        llm=llm,
        searcher=searcher,
        lenses=lens_list,
        tabs=tabs,
        taxonomy=taxonomy,
        channels=channels,
        video_state=video_state,
        video_store=video_store,
        changelog=changelog,
        clock=clock,
        ids=ids,
    )
    demo = FakeDemoLoader(
        db, settings=settings, channels=channels, taxonomy=taxonomy, tabs=tabs, clock=clock, ids=ids
    )
    data = FakeDataOps(
        db,
        settings=settings,
        channels=channels,
        taxonomy=taxonomy,
        tabs=tabs,
        video_state=video_state,
        demo=demo,
        changelog=changelog,
        clock=clock,
        ids=ids,
    )
    lists = FakeListImporter(
        db,
        settings=settings,
        http=http,
        llm=llm,
        youtube=youtube,
        channels=channels,
        tabs=tabs,
        video_store=video_store,
        clock=clock,
        ids=ids,
    )
    maintenance = FakeMaintenance(
        db,
        settings=settings,
        channels=channels,
        themes=themes,
        jobs=jobs,
        searcher=searcher,
        clock=clock,
    )
    world = FakeWorld(
        db=db,
        clock=clock,
        ids=ids,
        settings=settings,
        http=http,
        events=events,
        youtube=youtube,
        llm_backend=llm_backend,
        llm=llm,
        jobs=jobs,
        changelog=changelog,
        channels=channels,
        taxonomy=taxonomy,
        tabs=tabs,
        video_state=video_state,
        video_store=video_store,
        lenses=lens_list,
        feed=feed,
        devices=devices,
        searcher=searcher,
        refresher=refresher,
        cleanup=cleanup,
        sync=sync,
        organizer=organizer,
        themes=themes,
        demo=demo,
        data=data,
        lists=lists,
        maintenance=maintenance,
        routines=FakeRoutinesInstaller(),
        ctx=ctx or FakeCtx(),
        _spare_lens=FakeLens(enabled=False),
    )
    holder["world"] = world
    return world


# --------------------------------------------------------------------------- seed_world


def channel_id(n: int) -> str:
    """Channel id of the seeded world (``UC`` + 22)."""
    return f"UCseedchannel{n:011d}"


def video_id(n: int) -> str:
    """Video id of the seeded world (11 characters)."""
    return f"seedvid{n:04d}"


THEME_CHANNEL = "UCseedthemechan000000001"

# key, title, handle, relation, folder, tags, ⭐, muted
SEED_CHANNELS: tuple[tuple[str, str, str, str, str | None, tuple[str, ...], bool, bool], ...] = (
    ("fireship", "Fireship", "@fireship", "subscribed", "IA", ("aprender",), True, False),
    (
        "twominute",
        "Two Minute Papers",
        "@twominutepapers",
        "subscribed",
        "IA",
        ("aprender", "longo"),
        False,
        False,
    ),
    ("aiexplained", "AI Explained", "@aiexplained", "subscribed", "IA", (), False, False),
    ("mkbhd", "Marques Brownlee", "@mkbhd", "subscribed", "Tecnologia", ("relaxar",), True, False),
    (
        "linus",
        "Linus Tech Tips",
        "@linustechtips",
        "subscribed",
        "Tecnologia",
        ("relaxar",),
        False,
        True,
    ),
    ("verge", "The Verge", "@verge", "followed", "Tecnologia", (), False, False),
    (
        "veritasium",
        "Veritasium",
        "@veritasium",
        "subscribed",
        "Ciência",
        ("aprender", "longo"),
        False,
        False,
    ),
    (
        "cienciatododia",
        "Ciência Todo Dia",
        "@cienciatododia",
        "subscribed",
        "Ciência",
        ("PT-BR", "aprender"),
        False,
        False,
    ),
    ("kurzgesagt", "Kurzgesagt", "@kurzgesagt", "followed", "Ciência", (), False, False),
    ("nerdologia", "Nerdologia", "@nerdologia", "subscribed", None, ("PT-BR",), False, False),
    ("manualdomundo", "Manual do Mundo", "@manualdomundo", "ex", None, ("PT-BR",), False, False),
    ("fofoca", "Canal de Fofoca", "@fofocadiaria", "ignored", None, (), False, False),
)
"""12 channels: 8 subscribed, 2 followed, 1 ex, 1 ignored; 2 ⭐; 1 muted; 1 stale."""


@dataclass(frozen=True)
class SeedWorld:
    """Ids and milestones of the seeded world (deterministic)."""

    now: int
    folders: dict[str, str]
    tags: dict[str, str]
    channels: dict[str, str]
    videos: dict[str, str]
    new_videos: tuple[str, ...]
    seen_videos: tuple[str, ...]
    short_video: str
    long_video: str
    stale_channel: str
    theme: str
    theme_tab: str
    theme_videos: tuple[str, ...]
    category_tab: str
    watermark: int


def seed_world(target: FakeWorld | T.Db, *, clock: FakeClock | None = None) -> SeedWorld:
    """Populates *target* (a ``FakeWorld`` or a ``Db``) with a small, realistic world.

    - 3 folders: Tecnologia ⊃ IA, Ciência · 4 tags: aprender, relaxar, PT-BR, longo
    - 12 channels (see ``SEED_CHANNELS``), stats and watermarks (``now - 7 days``)
    - videos with descriptions: one new (after the watermark) and one seen (before) per active
      channel; 1 Short; 1 long video (25 min); 1 stale channel (last video 200 days ago);
      states ``seen``, ``later``, ``archived`` and 👍/👎 reactions
    - tabs: default (``all-new``, ``favorites``), category "Tecnologia" and 1 saved theme tab
      (3 videos from a channel that is not followed)
    - empty history at the end (seeding is not a user action); nothing in the queue, jobs or devices
    """
    world = target if isinstance(target, FakeWorld) else build_fake_world(target, clock=clock)
    now = world.clock.now()
    watermark = now - 7 * DAY
    actor = T.Actor.user

    folders: dict[str, str] = {}
    folders["Tecnologia"] = world.taxonomy.create_folder("Tecnologia", actor=actor).id
    folders["IA"] = world.taxonomy.create_folder(
        "IA", parent_id=folders["Tecnologia"], actor=actor
    ).id
    folders["Ciência"] = world.taxonomy.create_folder("Ciência", actor=actor).id
    tags = {
        name: world.taxonomy.create_tag(name, actor=actor).id
        for name in ("aprender", "relaxar", "PT-BR", "longo")
    }

    channels: dict[str, str] = {}
    for n, (key, title, handle, relation, folder, tag_names, fav, muted) in enumerate(
        SEED_CHANNELS, start=1
    ):
        cid = channel_id(n)
        channels[key] = cid
        initial = T.Relation.subscribed if relation in ("subscribed", "ex") else T.Relation.followed
        source = (
            T.ChannelSource.extension if initial is T.Relation.subscribed else T.ChannelSource.link
        )
        world.channels.upsert_many(
            [
                T.ChannelIn(
                    title=title,
                    channel_id=cid,
                    handle=handle,
                    url=f"https://www.youtube.com/{handle}",
                    thumb=f"https://yt3.ggpht.com/{key}.jpg",
                    folder_id=folders[folder] if folder else None,
                    tag_ids=tuple(tags[t] for t in tag_names),
                    favorite=fav,
                )
            ],
            source=source,
            relation=initial,
            actor=T.Actor.extension,
        )
        if relation == "ex":
            world.clock.set(now - 10 * DAY)
            world.channels.set_relation(cid, T.Relation.ex, actor=actor, reason="seed")
            world.clock.set(now)
        elif relation == "ignored":
            world.channels.set_relation(cid, T.Relation.ignored, actor=actor)
        if muted:
            world.channels.update(cid, T.ChannelPatch(muted=True), actor=actor)

    videos: dict[str, str] = {}
    new_videos: list[str] = []
    seen_videos: list[str] = []
    counter = iter(range(1, 1000))
    stats: list[T.ChannelStats] = []

    def add(key: str, cid: str, title: str, published: int, **kw: Any) -> str:
        vid = video_id(next(counter))
        videos[key] = vid
        world.video_store.upsert(
            [
                T.VideoIn(
                    id=vid,
                    channel_id=cid,
                    title=title,
                    published_at=published,
                    description=f"Descrição de {title}. Links e patrocínio no fim.",
                    channel_title=next(t for k, t, *_ in SEED_CHANNELS if channels[k] == cid),
                    views=kw.get("views", 10_000),
                    duration_s=kw.get("duration_s", 600),
                    is_short=kw.get("is_short"),
                )
            ],
            T.VideoOrigin.rss,
        )
        return vid

    for n, (key, title, *_rest) in enumerate(SEED_CHANNELS, start=1):
        cid = channels[key]
        relation = _rest[1]
        if key == "nerdologia":
            vid = add(f"{key}-old", cid, f"{title}: último vídeo", now - 200 * DAY)
            seen_videos.append(vid)
            stats.append(
                T.ChannelStats(channel_id=cid, last_video_at=now - 200 * DAY, videos_per_week=0.0)
            )
            continue
        if relation in ("ex", "ignored"):
            add(f"{key}-old", cid, f"{title}: vídeo antigo", now - 40 * DAY)
            stats.append(
                T.ChannelStats(channel_id=cid, last_video_at=now - 40 * DAY, videos_per_week=0.5)
            )
            continue
        fresh = now - (n * 3600 + DAY)
        long_kw = {"duration_s": 1500} if key == "twominute" else {}
        new_videos.append(
            add(f"{key}-new", cid, f"{title}: novidade", fresh, views=n * 1000, **long_kw)
        )
        seen_videos.append(add(f"{key}-seen", cid, f"{title}: da semana passada", now - 12 * DAY))
        stats.append(
            T.ChannelStats(
                channel_id=cid,
                last_video_at=fresh,
                videos_per_week=1.0 + n / 10,
                shorts_ratio=0.2 if key == "fireship" else 0.0,
            )
        )
    short = add(
        "fireship-short",
        channels["fireship"],
        "Fireship: Rust em 45 segundos",
        now - 2 * 3600,
        duration_s=45,
        is_short=True,
        views=50_000,
    )
    new_videos.append(short)
    world.channels.update_stats(stats)
    for key, cid in channels.items():
        if key not in ("manualdomundo", "fofoca"):
            world.refresher.set_watermark(cid, watermark)

    by_key = {k: v for k, v in videos.items()}
    world.video_state.set_state(
        [by_key["fireship-seen"], by_key["twominute-seen"], by_key["aiexplained-seen"]],
        T.VideoState.seen,
        actor=actor,
    )
    world.video_state.set_state([by_key["mkbhd-seen"]], T.VideoState.later, actor=actor)
    world.video_state.set_state([by_key["verge-seen"]], T.VideoState.archived, actor=actor)
    world.video_state.set_reaction(by_key["veritasium-seen"], T.Reaction.up, actor=actor)
    world.video_state.set_reaction(by_key["cienciatododia-seen"], T.Reaction.down, actor=actor)

    world.tabs.ensure_builtin()
    category = world.tabs.create(
        T.TabDraft(
            name="Tecnologia",
            kind=T.TabKind.category,
            icon="💻",
            rules=T.TabRules(include=T.RuleInclude(folders=(folders["Tecnologia"],))),
        ),
        actor=actor,
    )

    theme_videos = [
        T.VideoIn(
            id=video_id(900 + i),
            channel_id=THEME_CHANNEL,
            channel_title="Canal de Agentes",
            title=f"Agentes de IA, parte {i}",
            description=f"Parte {i} da série sobre agentes.",
            published_at=now - (i + 3) * DAY,
            views=5_000 * i,
            duration_s=900,
        )
        for i in (1, 2, 3)
    ]
    theme_id = world.themes.seed_theme(
        "agentes de IA", theme_videos, name="Agentes de IA", icon="🤖"
    )
    theme_tab = world.themes.save_seeded(theme_id)
    for v in theme_videos:
        videos[f"theme-{v.id}"] = v.id

    world.db.execute("DELETE FROM changes")
    return SeedWorld(
        now=now,
        folders=folders,
        tags=tags,
        channels=channels,
        videos=videos,
        new_videos=tuple(new_videos),
        seen_videos=tuple(seen_videos),
        short_video=short,
        long_video=by_key["twominute-new"],
        stale_channel=channels["nerdologia"],
        theme=theme_id,
        theme_tab=theme_tab.id,
        theme_videos=tuple(v.id for v in theme_videos),
        category_tab=category.id,
        watermark=watermark,
    )


ProviderMap = dict[str, Any]
WorldFactory = Callable[[], FakeWorld]

__all__ = [
    "FakeWorld",
    "SEED_CHANNELS",
    "SeedWorld",
    "THEME_CHANNEL",
    "build_fake_world",
    "channel_id",
    "seed_world",
    "video_id",
]
