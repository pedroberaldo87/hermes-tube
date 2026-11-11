"""``FeedEngine``: tab and feed engine. Read-only (except on-demand details, written through
``VideoStore.set_details``).

Tab rule = ``include − exclude → filters`` (``TabRules``), always evaluated the same way for a
saved tab (``page``), an unsaved rule (``preview``), a folder/channel (``scope_page``) and counts
(``new_counts``) — same tab = same feed on the Desktop, in the extension and in the tool.

- **include** — ``channels`` (any relation, including muted/ex; a channel not in the table counts
  if it has videos) · ``folders`` (recursive) · ``tags`` · ``favorites`` · ``all``: these four
  only with ``subscribed``/``followed`` channels that are not muted · ``themes`` (``theme_items``
  with ``verdict=keep``) · ``lenses`` (``Lens.items`` of the enabled lenses).
- **exclude** — channels, folders (recursive), tags (over all channels) and ``shorts``.
- **filters** — ``only_new`` (state ``new`` and ``published_at > watermarks.seen_up_to``; a
  channel without a watermark = new), ``per_channel`` (after sorting), ``min_s``/``max_s``.
- **modes** — ``fresh`` (last 30 days; unknown date passes), ``classics`` (all time, by views),
  ``long`` (≥ 20 min).
- **always** — ``archived`` never shows; a video shows once (the first origin wins, in the order
  channel › folder › tag › favorites › all › theme › lens).
- **why** — ``channel`` (title), ``folder`` (the rule's folder; under ``all``, the channel's
  folder), ``tag``, ``theme`` (theme name), ``hn``/``list`` (comes from the lens).
- **order and cursor** — ``fresh``/``long`` by ``published_at`` desc, ``classics`` by ``views``
  desc, ties broken by id. Cursor = key of the last item (``p:<published_at>:<id>`` or
  ``v:<views>:<id>``): stable when new videos arrive or items disappear.
- **sort and group** (``sort``/``group``/``tz_offset_min`` on every source and together with
  ``q``) — ``newest`` + ``none`` is the order above, byte for byte (cursors ``p:``/``v:``/``l:``).
  Otherwise, the **same set** the tab rule picked (mode, filters, ``per_channel`` by the tab's
  order, search) is arranged by group → sort → id: groups ``channel`` (name without accents/case,
  then id), ``folder`` (folder tree; no folder last), ``day`` (local day with ``tz_offset_min``,
  most recent first; undated last), ``kind`` (videos, Shorts, unknown); sorts ``newest`` (the
  source order: date; views in ``classics``; marking time in "Watch later"), ``oldest``,
  ``longest``/``shortest`` (no duration at the end), ``views`` (no count at the end). Cursor
  ``o:<sort>:<group>:<tz>:<key>`` (full key as base64 JSON): stable as videos come and go; a
  cursor from another combination → ``invalid``.
- **on-demand duration** — with ``min_s``/``max_s``/``long``, videos on the page (and a bit
  beyond) without a duration are fetched in batches through ``YouTubeClient.video_details`` (4 at
  a time) within a budget (< ``REST_BUDGET_S``); whatever does not fit continues in the background
  and is written later; the item goes out on this page without the filter. Cache = the database
  itself + recent failures in memory.
- **on-demand Short** — with ``exclude.shorts``, **only** through ``Refresher.resolve_shorts``
  (wired by ``attach_shorts_resolver``; never YouTube directly). Without a resolver, unknown
  passes.
- **lenses** — ``Lens.items`` of the enabled lenses named in ``include.lenses``; after building
  the page, ``Lens.enrich`` of every enabled lens. A failing lens is ignored (logged).
- **search** (``q``) — after all filters (including ``per_channel``): every word of *q* must be in
  the video title or the channel name, compared through ``dedup.normalize_name`` (no accents, no
  case — the same as ``GET /channels?q``). ``counts`` and the cursor apply to the filtered list.
- **"Watch later"** (``later_page``) — state ``later``, from the most recently marked to the
  oldest, with no date window; ``why`` = the video's origin (channel folder › channel › theme);
  cursor ``l:<updated_at>:<id>``.
- **tab channels** (``tab_channels``) — ``include − exclude`` of the channel part only (what the
  tab shows), for ``ReadScope(kind=tab)``; a theme tab, a themes/lenses-only tab or "Watch later"
  → ``ValidationError``.

Reads the tables directly (``channels``, ``channel_tags``, ``folders``, ``tags``, ``tabs``,
``videos``, ``video_state``, ``watermarks``, ``themes``, ``theme_items``); no writes outside
``VideoStore.set_details``. ``build`` does no network and starts no thread (the details pool is
created on first use, with the services already resolved).
"""

from __future__ import annotations

import base64
import binascii
import bisect
import contextvars
import functools
import json
import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field, replace
from typing import Any

from tube_pkg.core import dedup, lang
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

DAY = 86_400
FRESH_WINDOW_S = 30 * DAY
LONG_MIN_S = 20 * 60
DEFAULT_LIMIT = 30
API_MAX_LIMIT = 100
"""Cap on ``limit`` in the routes (``GET /feed``, ``/ext/feed``, ``/feed/preview``)."""
ENGINE_MAX_LIMIT = 500
LENS_LIMIT = 500

DETAILS_BUDGET_S = 1.2
"""Maximum wait for on-demand details in one call (fits in ``REST_BUDGET_S``)."""
DETAILS_LOOKAHEAD = 10
"""Beyond the page, how many items ahead already go into the details batch."""
DETAILS_BATCH = 40
DETAILS_WORKERS = 4
DETAILS_MAX_INFLIGHT = 64
DETAILS_RETRY_S = 6 * 3600
"""A video whose duration/Short did not come (failure, live) is only asked again after this."""
_KNOWN_MAX = 20_000
_CHUNK = 500

SEARCH_MAX_CHARS = 200
"""Cap on ``q`` in ``GET /feed``."""
FEED_SOURCES = ("tab", "folder", "channel", "state")
"""Sources of ``GET /feed``/``GET /ext/feed`` (exactly one)."""
FEED_STATES = ("later",)
"""States accepted as a source (``GET /feed?state=``)."""
LATER_TAB_IDS = frozenset({"later", ":later"})
"""Ids the interface uses for the local "Watch later" tab (not a ``tabs`` row)."""
_LATER_TAG = "l"

BUILTIN_TABS: Mapping[str, T.TabRules] = {
    T.BUILTIN_TAB_ALL_NEW: T.TabRules(
        include=T.RuleInclude(all=True), filters=T.RuleFilters(only_new=True)
    ),
    T.BUILTIN_TAB_FAVORITES: T.TabRules(include=T.RuleInclude(favorites=True)),
}
"""Rules of the default tabs, also used when the row does not exist yet in ``tabs``."""

_ACTIVE = (T.Relation.subscribed, T.Relation.followed)
_VIDEO_COLS = (
    "v.id, v.channel_id, v.channel_title, v.title, v.description, v.published_at, v.duration_s,"
    " v.is_short, v.views, v.first_seen_at, v.origin, s.state AS s_state, s.reaction AS s_reaction"
)

ShortsResolver = Callable[..., Mapping[str, bool]]

SORTS = ("newest", "oldest", "longest", "shortest", "views")
"""``sort`` of ``GET /feed`` (contract). ``newest`` = the source order, as before."""
GROUPS = ("none", "channel", "folder", "day", "kind")
"""``group`` of ``GET /feed`` (contract)."""
TZ_OFFSET_LIMIT = 840
"""``tz_offset_min`` in ``[-840, 840]`` (UTC−14 to UTC+14)."""
_ORDER_TAG = "o"


@dataclass(frozen=True, slots=True)
class FeedOrder:
    """Requested order: the server sorts by group and then by ``sort``; ties broken by id.
    ``tz_offset_min`` only applies to ``group=day`` (otherwise it is 0: the cursor ignores it)."""

    sort: str = "newest"
    group: str = "none"
    tz_offset_min: int = 0

    @property
    def is_default(self) -> bool:
        return self.sort == "newest" and self.group == "none"


DEFAULT_ORDER = FeedOrder()


def _say(settings: Any, pt: str, en: str) -> str:
    """New message in the language of the single language rule (``core/lang``)."""
    try:
        return lang.pick(lang.resolve(settings), pt, en)
    except Exception:  # noqa: BLE001 — unreadable language: English
        return en


def parse_order(
    sort: Any = None, group: Any = None, tz_offset_min: Any = None, *, settings: Any = None
) -> FeedOrder:
    """``sort``/``group``/``tz_offset_min`` from a query (text) or body → ``FeedOrder``; missing =
    default. A value outside the contract → ``ValidationError`` with ``field``."""
    s = "newest" if sort is None or sort == "" else sort
    if not isinstance(s, str) or s not in SORTS:
        raise T.ValidationError(
            _say(
                settings,
                f"sort: esperava um de {', '.join(SORTS)}",
                f"sort: expected one of {', '.join(SORTS)}",
            ),
            field="sort",
        )
    g = "none" if group is None or group == "" else group
    if not isinstance(g, str) or g not in GROUPS:
        raise T.ValidationError(
            _say(
                settings,
                f"group: esperava um de {', '.join(GROUPS)}",
                f"group: expected one of {', '.join(GROUPS)}",
            ),
            field="group",
        )
    tz = 0
    if tz_offset_min is not None and tz_offset_min != "":
        value: Any = tz_offset_min
        if isinstance(value, str):
            try:
                value = int(value.strip())
            except ValueError:
                value = None
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not -TZ_OFFSET_LIMIT <= value <= TZ_OFFSET_LIMIT
        ):
            raise T.ValidationError(
                _say(
                    settings,
                    f"tz_offset_min: esperava inteiro entre -{TZ_OFFSET_LIMIT} e {TZ_OFFSET_LIMIT}",
                    f"tz_offset_min: expected an integer between -{TZ_OFFSET_LIMIT} and"
                    f" {TZ_OFFSET_LIMIT}",
                ),
                field="tz_offset_min",
            )
        tz = value
    return FeedOrder(sort=s, group=g, tz_offset_min=tz if g == "day" else 0)


def order_kwargs(order: FeedOrder) -> dict[str, Any]:
    """Only pass non-default values to the engine (an old/fake engine without the parameters keeps
    serving the default)."""
    if order.is_default:
        return {}
    return {"sort": order.sort, "group": order.group, "tz_offset_min": order.tz_offset_min}


# =========================================================================== public helpers


def scope_rules(*, folder: str | None = None, channel: str | None = None) -> T.TabRules:
    """Feed rule of a folder (recursive) or a channel (``GET /feed?folder=|channel=``,
    ``tube_feed``)."""
    if (folder is None) == (channel is None):
        raise T.ValidationError("provide exactly one of folder, channel")
    if folder is not None:
        return T.TabRules(include=T.RuleInclude(folders=(folder,)))
    return T.TabRules(include=T.RuleInclude(channels=(str(channel),)))


def parse_limit(value: Any, *, default: int = DEFAULT_LIMIT, maximum: int = API_MAX_LIMIT) -> int:
    """``limit`` from a query/body (text or integer) → integer in ``[1, maximum]``."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise T.ValidationError("limit: expected an integer", field="limit")
    if isinstance(value, str):
        try:
            value = int(value.strip())
        except ValueError as exc:
            raise T.ValidationError("limit: expected an integer", field="limit") from exc
    if not isinstance(value, int) or not 1 <= value <= maximum:
        raise T.ValidationError(
            f"limit: expected an integer between 1 and {maximum}", field="limit"
        )
    return value


def search_terms(q: Any) -> tuple[str, ...]:
    """``q`` → normalised words (``dedup.normalize_name``), deduplicated; empty = no search.
    Not a string or more than ``SEARCH_MAX_CHARS`` → ``ValidationError``."""
    if q is None:
        return ()
    if not isinstance(q, str):
        raise T.ValidationError("q: expected a string", field="q")
    if len(q) > SEARCH_MAX_CHARS:
        raise T.ValidationError(f"q: at most {SEARCH_MAX_CHARS} characters", field="q")
    return tuple(dict.fromkeys(dedup.normalize_name(q).split()))


@functools.lru_cache(maxsize=65_536)
def _norm(text: str) -> str:
    return dedup.normalize_name(text)


def matches_search(item: T.FeedItem, terms: Sequence[str]) -> bool:
    """Every word of *terms* in the video title or the channel name (normalised)."""
    if not terms:
        return True
    title = _norm(item.video.title or "")
    channel_name = (item.channel.title if item.channel else "") or item.video.channel_title or ""
    channel = _norm(channel_name)
    return all(t in title or t in channel for t in terms)


def page_for_query(engine: T.FeedEngine, query: Mapping[str, Any]) -> T.FeedPage:
    """``GET /feed`` and ``GET /ext/feed``: exactly one of ``tab``, ``folder``, ``channel``,
    ``state`` (``later`` only) + ``limit``/``cursor``/``q`` + ``sort``/``group``/
    ``tz_offset_min``. One path for both surfaces (same feed). ``q`` and the order are only
    passed to the engine when they are not the default (an old engine without them keeps serving
    the rest)."""
    present = [k for k in FEED_SOURCES if query.get(k)]
    if len(present) != 1:
        raise T.ValidationError("provide exactly one of tab, folder, channel, state", field="tab")
    key = present[0]
    value = str(query[key])
    limit = parse_limit(query.get("limit"))
    cursor = query.get("cursor") or None
    q = query.get("q")
    order = parse_order(
        query.get("sort"),
        query.get("group"),
        query.get("tz_offset_min"),
        settings=getattr(engine, "settings", None),
    )
    extra: dict[str, Any] = {"q": q} if search_terms(q) else {}
    extra.update(order_kwargs(order))
    if key == "state":
        if value not in FEED_STATES:
            raise T.ValidationError(
                f"state: expected one of {', '.join(FEED_STATES)}", field="state"
            )
        later = getattr(engine, "later_page", None)
        if not callable(later):
            raise T.ValidationError("this engine does not serve state=later", field="state")
        return later(limit=limit, cursor=cursor, **extra)
    if key == "tab":
        return engine.page(value, limit=limit, cursor=cursor, **extra)
    scoped = getattr(engine, "scope_page", None)
    if callable(scoped):
        return scoped(**{key: value}, limit=limit, cursor=cursor, **extra)
    return engine.preview(scope_rules(**{key: value}), limit=limit, cursor=cursor, **extra)


# =========================================================================== internals


def _placeholders(values: Sequence[Any]) -> str:
    return ",".join("?" for _ in values)


def _chunks(values: Sequence[str], size: int = _CHUNK) -> list[Sequence[str]]:
    return [values[i : i + size] for i in range(0, len(values), size)]


def _channel(row: Mapping[str, Any], tag_ids: Sequence[str]) -> T.Channel:
    return T.Channel(
        id=row["id"],
        title=row["title"] or "",
        relation=T.Relation(row["relation"]),
        source=T.ChannelSource(row["source"]),
        added_at=int(row["added_at"]),
        handle=row["handle"],
        thumb=row["thumb"],
        url=row["url"],
        folder_id=row["folder_id"],
        favorite=bool(row["favorite"]),
        muted=bool(row["muted"]),
        unsubscribed_at=row["unsubscribed_at"],
        last_video_at=row["last_video_at"],
        videos_per_week=row["videos_per_week"],
        shorts_ratio=row["shorts_ratio"],
        ai_note=row["ai_note"],
        tag_ids=tuple(sorted(tag_ids)),
    )


def _video(row: Mapping[str, Any]) -> T.Video:
    return T.Video(
        id=row["id"],
        channel_id=row["channel_id"],
        title=row["title"] or "",
        published_at=row["published_at"],
        description=row["description"],
        channel_title=row["channel_title"],
        duration_s=row["duration_s"],
        is_short=None if row["is_short"] is None else bool(row["is_short"]),
        views=row["views"],
        first_seen_at=int(row["first_seen_at"] or 0),
        origin=T.VideoOrigin(row["origin"]),
    )


def _state_of(row: Mapping[str, Any]) -> tuple[T.VideoState, T.Reaction | None]:
    state = T.VideoState(row["s_state"]) if row.get("s_state") else T.VideoState.new
    reaction = T.Reaction(row["s_reaction"]) if row.get("s_reaction") else None
    return state, reaction


@dataclass(slots=True)
class _Cand:
    video: T.Video
    why: T.Why
    state: T.VideoState = T.VideoState.new
    reaction: T.Reaction | None = None
    badges: tuple[str, ...] = ()
    from_lens: bool = False


@dataclass(slots=True)
class _Snapshot:
    """One call's read: channels, folders, tags and watermarks."""

    now: int
    channels: dict[str, T.Channel]
    folder_names: dict[str, str]
    children: dict[str | None, list[str]]
    tag_names: dict[str, str]
    watermarks: dict[str, int]
    _desc: dict[str, frozenset[str]] = field(default_factory=dict)

    def descendants(self, folder_id: str) -> frozenset[str]:
        if folder_id not in self.folder_names:
            return frozenset()
        cached = self._desc.get(folder_id)
        if cached is None:
            out: list[str] = []
            stack = [folder_id]
            while stack:
                fid = stack.pop()
                if fid in out:
                    continue
                out.append(fid)
                stack.extend(self.children.get(fid, ()))
            cached = self._desc[folder_id] = frozenset(out)
        return cached

    def active(self) -> list[T.Channel]:
        return [c for c in self.channels.values() if c.relation in _ACTIVE and not c.muted]

    def is_new(self, video: T.Video, state: T.VideoState) -> bool:
        if state is not T.VideoState.new:
            return False
        mark = self.watermarks.get(video.channel_id)
        return mark is None or (video.published_at or 0) > mark


def _sort_key(mode: T.FeedMode, video: T.Video) -> tuple[int, str]:
    if mode is T.FeedMode.classics:
        return (-(video.views or 0), video.id)
    return (-(video.published_at or 0), video.id)


def _cursor_tag(mode: T.FeedMode) -> str:
    return "v" if mode is T.FeedMode.classics else "p"


def _encode_cursor(mode: T.FeedMode, video: T.Video) -> str:
    primary = video.views if mode is T.FeedMode.classics else video.published_at
    return f"{_cursor_tag(mode)}:{int(primary or 0)}:{video.id}"


def _decode_cursor(cursor: str | None, mode: T.FeedMode) -> tuple[int, str] | None:
    return _decode_key_cursor(cursor, _cursor_tag(mode))


def _decode_key_cursor(cursor: str | None, tag: str) -> tuple[int, str] | None:
    if cursor is None:
        return None
    if not isinstance(cursor, str):
        raise T.ValidationError("invalid cursor", field="cursor")
    parts = cursor.split(":", 2)
    if len(parts) != 3 or parts[0] != tag or not dedup.is_video_id(parts[2]):
        raise T.ValidationError("invalid cursor (from another tab or mode?)", field="cursor")
    try:
        primary = int(parts[1])
    except ValueError as exc:
        raise T.ValidationError("invalid cursor", field="cursor") from exc
    return (-primary, parts[2])


_KEY_SHAPES: Mapping[str, tuple[type, ...]] = {
    "none": (),
    "channel": (str, str),
    "folder": (int, int),
    "day": (int, int),
    "kind": (int,),
    "newest": (int,),
    "oldest": (int, int),
    "longest": (int, int),
    "shortest": (int, int),
    "views": (int, int),
}
"""Types of each key position (group, sort) — the video id comes last."""

_KIND_RANK = {False: 0, True: 1, None: 2}


def _bad_order_cursor(_settings: Any = None) -> T.ValidationError:
    """API text (no screen shows it): English in every language."""
    return T.ValidationError(
        "cursor is invalid or from another sort or group; start again without a cursor",
        field="cursor",
    )


_ORDER_CURSOR_MAX = 4096
"""Longest base64 key accepted in an order cursor (real keys are a few dozen characters)."""


def _encode_order_cursor(order: FeedOrder, key: tuple[Any, ...]) -> str:
    raw = json.dumps(list(key), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return f"{_ORDER_TAG}:{order.sort}:{order.group}:{order.tz_offset_min}:{payload}"


def _decode_order_cursor(cursor: Any, order: FeedOrder, settings: Any) -> tuple[Any, ...] | None:
    """Cursor ``o:<sort>:<group>:<tz>:<base64 JSON key>`` of the **same** order; anything else
    (default-order cursor, another ``sort``/``group``/offset, malformed) → ``invalid``."""
    if cursor is None:
        return None
    if not isinstance(cursor, str):
        raise _bad_order_cursor(settings)
    parts = cursor.split(":", 4)
    if len(parts) != 5 or parts[:4] != [
        _ORDER_TAG,
        order.sort,
        order.group,
        str(order.tz_offset_min),
    ]:
        raise _bad_order_cursor(settings)
    payload = parts[4]
    if len(payload) > _ORDER_CURSOR_MAX:
        raise _bad_order_cursor(settings)
    try:
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        key = json.loads(raw.decode("utf-8"))
    except (ValueError, binascii.Error, UnicodeDecodeError, RecursionError) as exc:
        # RecursionError: deeply nested JSON ("[[[[…") is a bad cursor, not an internal error
        raise _bad_order_cursor(settings) from exc
    shape = (*_KEY_SHAPES[order.group], *_KEY_SHAPES[order.sort], str)
    if (
        not isinstance(key, list)
        or len(key) != len(shape)
        or any(isinstance(k, bool) or not isinstance(k, t) for k, t in zip(key, shape, strict=True))
        or not dedup.is_video_id(key[-1])
    ):
        raise _bad_order_cursor(settings)
    return tuple(key)


def _folder_ranks(snap: _Snapshot) -> dict[str, int]:
    """Folder order as in the sidebar: depth-first tree, siblings by (sort, name, id) (the order of
    ``snap.children``); a folder whose parent is gone goes last."""
    order: list[str] = []
    seen: set[str] = set()

    def walk(parent: str | None) -> None:
        for fid in snap.children.get(parent, ()):
            if fid not in seen:
                seen.add(fid)
                order.append(fid)
                walk(fid)

    walk(None)
    for fid in snap.folder_names:
        if fid not in seen:
            seen.add(fid)
            order.append(fid)
            walk(fid)
    return {fid: n for n, fid in enumerate(order)}


def _order_keyer(
    order: FeedOrder, snap: _Snapshot, natural: Callable[[T.FeedItem], int]
) -> Callable[[T.FeedItem], tuple[Any, ...]]:
    """Total key of an item: group → sort → id. ``natural`` = the source's default order (date,
    views in ``classics``, marking time in "Watch later"), used by ``newest``."""
    ranks = _folder_ranks(snap) if order.group == "folder" else {}
    shift = order.tz_offset_min * 60

    def group_part(item: T.FeedItem) -> tuple[Any, ...]:
        v = item.video
        if order.group == "channel":
            name = (item.channel.title if item.channel else None) or v.channel_title or v.channel_id
            return (_norm(name), v.channel_id)
        if order.group == "folder":
            fid = item.channel.folder_id if item.channel else None
            return (0, ranks[fid]) if fid in ranks else (1, 0)
        if order.group == "day":
            return (0, -((v.published_at + shift) // DAY)) if v.published_at else (1, 0)
        if order.group == "kind":
            return (_KIND_RANK[v.is_short],)
        return ()

    def sort_part(item: T.FeedItem) -> tuple[int, ...]:
        v = item.video
        if order.sort == "oldest":
            return (0, v.published_at) if v.published_at else (1, 0)
        if order.sort == "longest":
            return (0, -v.duration_s) if v.duration_s is not None else (1, 0)
        if order.sort == "shortest":
            return (0, v.duration_s) if v.duration_s is not None else (1, 0)
        if order.sort == "views":
            return (0, -v.views) if v.views is not None else (1, 0)
        return (natural(item),)

    return lambda item: (*group_part(item), *sort_part(item), item.video.id)


def _check_limit(limit: Any) -> int:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= ENGINE_MAX_LIMIT:
        raise T.ValidationError(
            f"limit: expected an integer between 1 and {ENGINE_MAX_LIMIT}", field="limit"
        )
    return limit


# =========================================================================== engine


class FeedEngine:
    """``FeedEngine`` implementation (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        youtube: T.YouTubeClient,
        video_store: T.VideoStore,
        lenses: Sequence[T.Lens],
        tabs: T.TabService,
        taxonomy: T.TaxonomyService,
        channels: T.ChannelService,
        video_state: T.VideoStateService,
        clock: T.Clock | None = None,
        shorts_resolver: ShortsResolver | None = None,
        details_budget_s: float = DETAILS_BUDGET_S,
        details_batch: int = DETAILS_BATCH,
        details_workers: int = DETAILS_WORKERS,
        details_retry_s: float = DETAILS_RETRY_S,
    ) -> None:
        self.db = db
        self.settings = settings
        self.youtube = youtube
        self.video_store = video_store
        self.lenses = list(lenses)
        self.tabs = tabs
        self.taxonomy = taxonomy
        self.channels = channels
        self.video_state = video_state
        self.clock = clock or T.SystemClock()
        self._shorts_resolver = shorts_resolver
        self.details_budget_s = float(details_budget_s)
        self.details_batch = int(details_batch)
        self.details_workers = max(1, int(details_workers))
        self.details_retry_s = float(details_retry_s)
        self._lock = threading.Lock()
        self._pool: ThreadPoolExecutor | None = None
        self._inflight: dict[str, Future[int | None]] = {}
        self._known: OrderedDict[str, int] = OrderedDict()
        self._dur_retry: dict[str, float] = {}
        self._short_retry: dict[str, float] = {}

    # ------------------------------------------------------------------ Short on demand

    def attach_shorts_resolver(self, resolver: ShortsResolver | None) -> None:
        """Wire ``Refresher.resolve_shorts`` (the only door to on-demand Shorts)."""
        self._shorts_resolver = resolver

    @property
    def has_shorts_resolver(self) -> bool:
        return self._shorts_resolver is not None

    # ------------------------------------------------------------------ Protocol

    def page(
        self,
        tab_id: str,
        *,
        limit: int = DEFAULT_LIMIT,
        cursor: str | None = None,
        q: str | None = None,
        sort: str = "newest",
        group: str = "none",
        tz_offset_min: int = 0,
    ) -> T.FeedPage:
        terms = search_terms(q)
        order = parse_order(sort, group, tz_offset_min, settings=self.settings)
        return self._run(self._tab_rules(tab_id), limit, cursor, terms, order)

    def preview(
        self,
        rules: T.TabRules,
        *,
        limit: int = DEFAULT_LIMIT,
        cursor: str | None = None,
        q: str | None = None,
        sort: str = "newest",
        group: str = "none",
        tz_offset_min: int = 0,
    ) -> T.FeedPage:
        terms = search_terms(q)
        order = parse_order(sort, group, tz_offset_min, settings=self.settings)
        if not isinstance(rules, T.TabRules):
            rules = T.TabRules.from_dict(rules)
        return self._run(rules, limit, cursor, terms, order)

    def new_counts(self) -> T.NewCounts:
        snap = self._snapshot()
        everything = self._evaluate(snap, BUILTIN_TABS[T.BUILTIN_TAB_ALL_NEW])
        by_channel: dict[str, int] = {}
        for item in everything:
            cid = item.video.channel_id
            by_channel[cid] = by_channel.get(cid, 0) + 1
        by_folder: dict[str, int] = {}
        for fid in snap.folder_names:
            desc = snap.descendants(fid)
            by_folder[fid] = sum(
                n for cid, n in by_channel.items() if snap.channels[cid].folder_id in desc
            )
        by_folder[""] = sum(
            n for cid, n in by_channel.items() if snap.channels[cid].folder_id is None
        )
        by_tab: dict[str, int] = {}
        for tab_id, rules in self._all_tab_rules():
            only_new = replace(rules, filters=replace(rules.filters, only_new=True))
            try:
                by_tab[tab_id] = len(self._evaluate(snap, only_new))
            except Exception:  # noqa: BLE001 — one bad tab does not bring down the counts
                log.exception("count of tab %s failed", tab_id)
                by_tab[tab_id] = 0
        return T.NewCounts(
            total=len(everything), by_tab=by_tab, by_folder=by_folder, by_channel=by_channel
        )

    # ------------------------------------------------------------------ public extras

    def scope_page(
        self,
        *,
        folder: str | None = None,
        channel: str | None = None,
        limit: int = DEFAULT_LIMIT,
        cursor: str | None = None,
        q: str | None = None,
        sort: str = "newest",
        group: str = "none",
        tz_offset_min: int = 0,
    ) -> T.FeedPage:
        """Feed of a folder (recursive) or a channel; missing → ``NotFound``; malformed channel id
        → ``ValidationError``. A channel not in the table counts if it has videos."""
        terms = search_terms(q)
        order = parse_order(sort, group, tz_offset_min, settings=self.settings)
        rules = scope_rules(folder=folder, channel=channel)
        if folder is not None:
            if not self.db.query_one("SELECT id FROM folders WHERE id = ?", (folder,)):
                raise T.NotFound(f"folder {folder} does not exist")
        else:
            if not dedup.is_channel_id(str(channel)):
                raise T.ValidationError(f"invalid channel id: {channel!r}", field="channel")
            known = self.db.query_one(
                "SELECT 1 AS x FROM channels WHERE id = ?"
                " UNION ALL SELECT 1 AS x FROM videos WHERE channel_id = ? LIMIT 1",
                (channel, channel),
            )
            if not known:
                raise T.NotFound(f"channel {channel} does not exist")
        return self._run(rules, limit, cursor, terms, order)

    def later_page(
        self,
        *,
        limit: int = DEFAULT_LIMIT,
        cursor: str | None = None,
        q: str | None = None,
        sort: str = "newest",
        group: str = "none",
        tz_offset_min: int = 0,
    ) -> T.FeedPage:
        """The feed's "Watch later" source (see the module docstring)."""
        order = parse_order(sort, group, tz_offset_min, settings=self.settings)
        limit = _check_limit(limit)
        if not order.is_default:
            return self._later_ordered(limit, cursor, search_terms(q), order)
        self._refuse_order_cursor(cursor)
        after = _decode_key_cursor(cursor, _LATER_TAG)
        terms = search_terms(q)
        snap = self._snapshot()
        rows = self.db.query(
            f"SELECT {_VIDEO_COLS}, s.updated_at AS s_updated FROM video_state s"
            " JOIN videos v ON v.id = s.video_id WHERE s.state = 'later'"
            " ORDER BY s.updated_at DESC, v.id"
        )
        loose = [r["id"] for r in rows if r["channel_id"] not in snap.channels]
        themes = self._theme_labels(loose)
        items: list[T.FeedItem] = []
        keys: list[tuple[int, str]] = []
        for row in rows:
            video = _video(row)
            state, reaction = _state_of(row)
            item = T.FeedItem(
                video=video,
                channel=snap.channels.get(video.channel_id),
                state=state,
                reaction=reaction,
                is_new=snap.is_new(video, state),
                why=self._origin_why(snap, video, themes),
            )
            if matches_search(item, terms):
                items.append(item)
                keys.append((-int(row["s_updated"] or 0), video.id))
        start = 0 if after is None else bisect.bisect_right(keys, after)
        chunk = items[start : start + limit]
        next_cursor = None
        if chunk and start + limit < len(items):
            updated, last_id = keys[start + len(chunk) - 1]
            next_cursor = f"{_LATER_TAG}:{-updated}:{last_id}"
        counts = T.FeedCounts(total=len(items), new=sum(1 for i in items if i.is_new))
        return T.FeedPage(items=tuple(self._enrich(chunk)), next_cursor=next_cursor, counts=counts)

    def _later_items(
        self, terms: Sequence[str]
    ) -> tuple[_Snapshot, list[T.FeedItem], dict[str, int]]:
        """ "Watch later" filtered by *terms*: snapshot, items (default order) and when each one
        was marked."""
        snap = self._snapshot()
        rows = self.db.query(
            f"SELECT {_VIDEO_COLS}, s.updated_at AS s_updated FROM video_state s"
            " JOIN videos v ON v.id = s.video_id WHERE s.state = 'later'"
            " ORDER BY s.updated_at DESC, v.id"
        )
        loose = [r["id"] for r in rows if r["channel_id"] not in snap.channels]
        themes = self._theme_labels(loose)
        items: list[T.FeedItem] = []
        marked: dict[str, int] = {}
        for row in rows:
            video = _video(row)
            state, reaction = _state_of(row)
            item = T.FeedItem(
                video=video,
                channel=snap.channels.get(video.channel_id),
                state=state,
                reaction=reaction,
                is_new=snap.is_new(video, state),
                why=self._origin_why(snap, video, themes),
            )
            if matches_search(item, terms):
                items.append(item)
                marked[video.id] = int(row["s_updated"] or 0)
        return snap, items, marked

    def _later_ordered(
        self, limit: int, cursor: str | None, terms: Sequence[str], order: FeedOrder
    ) -> T.FeedPage:
        """ "Watch later" with ``sort``/``group``; ``newest`` within a group = most recently
        marked first (the source order)."""
        after = _decode_order_cursor(cursor, order, self.settings)
        snap, items, marked = self._later_items(terms)
        keyer = _order_keyer(order, snap, lambda i: -marked[i.video.id])
        return self._ordered_page(items, keyer, after, limit, order)

    def _ordered_page(
        self,
        items: Sequence[T.FeedItem],
        keyer: Callable[[T.FeedItem], tuple[Any, ...]],
        after: tuple[Any, ...] | None,
        limit: int,
        order: FeedOrder,
    ) -> T.FeedPage:
        keyed = sorted(((keyer(i), i) for i in items), key=lambda pair: pair[0])
        keys = [k for k, _ in keyed]
        start = 0 if after is None else bisect.bisect_right(keys, after)
        chunk = [i for _, i in keyed[start : start + limit]]
        next_cursor = None
        if chunk and start + limit < len(keyed):
            next_cursor = _encode_order_cursor(order, keys[start + len(chunk) - 1])
        counts = T.FeedCounts(total=len(items), new=sum(1 for i in items if i.is_new))
        return T.FeedPage(items=tuple(self._enrich(chunk)), next_cursor=next_cursor, counts=counts)

    def _refuse_order_cursor(self, cursor: Any) -> None:
        """A sort/group cursor used with the default order → ``invalid`` (the rule's message)."""
        if isinstance(cursor, str) and cursor.startswith(f"{_ORDER_TAG}:"):
            raise _bad_order_cursor(self.settings)

    def tab_channels(self, tab_id: str) -> list[str]:
        """Channels (from the ``channels`` table) the tab shows — see the module docstring."""
        if not isinstance(tab_id, str) or not tab_id:
            raise T.ValidationError("tab is required", field="id")
        if tab_id in LATER_TAB_IDS:
            raise T.ValidationError(
                '"Watch later" has no channels to mark as read; change the state of the videos'
                " (POST /videos/state)",
                field="id",
            )
        row = self.db.query_one("SELECT kind, rules FROM tabs WHERE id = ?", (tab_id,))
        if row is None:
            rules = BUILTIN_TABS.get(tab_id)
            if rules is None:
                raise T.NotFound(f"tab {tab_id} does not exist", tab_id=tab_id)
        else:
            if row["kind"] == T.TabKind.theme.value:
                raise T.ValidationError(
                    "a theme tab has no channels to mark as read (its videos come from search)",
                    field="id",
                )
            rules = self._parse_rules(row["rules"], tab_id)
        inc = rules.include
        if not (inc.channels or inc.folders or inc.tags or inc.favorites or inc.all):
            if inc.themes or inc.lenses:
                raise T.ValidationError(
                    "a themes/lenses-only tab has no channels to mark as read", field="id"
                )
            return []
        snap = self._snapshot()
        return sorted(c for c in self._included_channels(snap, rules) if c in snap.channels)

    def items(self, video_ids: Sequence[str]) -> list[T.FeedItem]:
        """``FeedItem`` of each known id, in the requested order, ``why=None`` (``GET /videos``)."""
        ids = [v for v in dict.fromkeys(video_ids) if dedup.is_video_id(v)]
        if not ids:
            return []
        snap = self._snapshot()
        found: dict[str, T.FeedItem] = {}
        for chunk in _chunks(ids):
            rows = self.db.query(
                f"SELECT {_VIDEO_COLS} FROM videos v"
                " LEFT JOIN video_state s ON s.video_id = v.id"
                f" WHERE v.id IN ({_placeholders(chunk)})",
                tuple(chunk),
            )
            for row in rows:
                video = _video(row)
                state, reaction = _state_of(row)
                found[video.id] = T.FeedItem(
                    video=video,
                    channel=snap.channels.get(video.channel_id),
                    state=state,
                    reaction=reaction,
                    is_new=snap.is_new(video, state),
                )
        return self._enrich([found[v] for v in ids if v in found])

    def wait_details(self, timeout: float | None = None) -> bool:
        """Wait for in-flight details fetches (tests, scripts). ``True`` if they finished."""
        with self._lock:
            pending = list(self._inflight.values())
        if not pending:
            return True
        _, not_done = wait(pending, timeout=timeout)
        return not not_done

    # ------------------------------------------------------------------ tab rules

    def _tab_rules(self, tab_id: str) -> T.TabRules:
        row = self.db.query_one("SELECT rules FROM tabs WHERE id = ?", (tab_id,))
        if row is None:
            builtin = BUILTIN_TABS.get(tab_id)
            if builtin is None:
                raise T.NotFound(f"tab {tab_id} does not exist")
            return builtin
        return self._parse_rules(row["rules"], tab_id)

    @staticmethod
    def _parse_rules(raw: Any, tab_id: str) -> T.TabRules:
        try:
            data = json.loads(raw) if isinstance(raw, str | bytes) else raw
        except ValueError as exc:
            raise T.ValidationError(f"rules of tab {tab_id} are unreadable") from exc
        return T.TabRules.from_dict(data or {})

    def _all_tab_rules(self) -> list[tuple[str, T.TabRules]]:
        out: list[tuple[str, T.TabRules]] = []
        rows = self.db.query("SELECT id, rules FROM tabs ORDER BY sort, id")
        for row in rows:
            try:
                out.append((row["id"], self._parse_rules(row["rules"], row["id"])))
            except T.TubeError:
                log.warning("tab %s has invalid rules and is left out of the counts", row["id"])
        present = {tab_id for tab_id, _ in out}
        out += [(tid, rules) for tid, rules in BUILTIN_TABS.items() if tid not in present]
        return out

    # ------------------------------------------------------------------ reads

    def _snapshot(self) -> _Snapshot:
        tags_by_channel: dict[str, list[str]] = {}
        for r in self.db.query("SELECT channel_id, tag_id FROM channel_tags"):
            tags_by_channel.setdefault(r["channel_id"], []).append(r["tag_id"])
        channels = {
            r["id"]: _channel(r, tags_by_channel.get(r["id"], ()))
            for r in self.db.query("SELECT * FROM channels")
        }
        folder_names: dict[str, str] = {}
        children: dict[str | None, list[str]] = {}
        for r in self.db.query("SELECT id, name, parent_id FROM folders ORDER BY sort, name, id"):
            folder_names[r["id"]] = r["name"]
            children.setdefault(r["parent_id"], []).append(r["id"])
        tag_names = {r["id"]: r["name"] for r in self.db.query("SELECT id, name FROM tags")}
        watermarks = {
            r["channel_id"]: int(r["seen_up_to"])
            for r in self.db.query("SELECT channel_id, seen_up_to FROM watermarks")
        }
        return _Snapshot(
            now=self.clock.now(),
            channels=channels,
            folder_names=folder_names,
            children=children,
            tag_names=tag_names,
            watermarks=watermarks,
        )

    def _included_channels(self, snap: _Snapshot, rules: T.TabRules) -> dict[str, T.Why]:
        inc, exc = rules.include, rules.exclude
        why: dict[str, T.Why] = {}
        active = snap.active()
        for cid in inc.channels:
            channel = snap.channels.get(cid)
            if channel is not None:
                why.setdefault(cid, T.Why(T.WhyVia.channel, channel.title))
            elif dedup.is_channel_id(cid):
                why.setdefault(cid, T.Why(T.WhyVia.channel, ""))  # label comes from the video
        for fid in inc.folders:
            desc = snap.descendants(fid)
            label = snap.folder_names.get(fid, fid)
            for c in active:
                if c.folder_id in desc:
                    why.setdefault(c.id, T.Why(T.WhyVia.folder, label))
        for tid in inc.tags:
            label = snap.tag_names.get(tid, tid)
            for c in active:
                if tid in c.tag_ids:
                    why.setdefault(c.id, T.Why(T.WhyVia.tag, label))
        if inc.favorites:
            for c in active:
                if c.favorite:
                    why.setdefault(c.id, T.Why(T.WhyVia.channel, c.title))
        if inc.all:
            for c in active:
                if c.folder_id in snap.folder_names:
                    why.setdefault(c.id, T.Why(T.WhyVia.folder, snap.folder_names[c.folder_id]))
                else:
                    why.setdefault(c.id, T.Why(T.WhyVia.channel, c.title))
        for cid in self._excluded(snap, exc):
            why.pop(cid, None)
        return why

    def _theme_labels(self, video_ids: Sequence[str]) -> dict[str, str]:
        """Video → name of the first theme that kept it (``verdict=keep``)."""
        out: dict[str, str] = {}
        for chunk in _chunks(list(dict.fromkeys(video_ids))):
            rows = self.db.query(
                "SELECT ti.video_id AS video_id, t.name AS name, t.query AS query, t.id AS id"
                " FROM theme_items ti JOIN themes t ON t.id = ti.theme_id"
                f" WHERE ti.verdict = 'keep' AND ti.video_id IN ({_placeholders(chunk)})"
                " ORDER BY t.id",
                tuple(chunk),
            )
            for r in rows:
                out.setdefault(r["video_id"], r["name"] or r["query"] or r["id"])
        return out

    @staticmethod
    def _origin_why(snap: _Snapshot, video: T.Video, themes: Mapping[str, str]) -> T.Why:
        """Where the video comes from: channel folder › channel › theme › name stored on it."""
        channel = snap.channels.get(video.channel_id)
        if channel is not None:
            if channel.folder_id in snap.folder_names:
                return T.Why(T.WhyVia.folder, snap.folder_names[channel.folder_id])
            return T.Why(T.WhyVia.channel, channel.title or video.channel_title or video.channel_id)
        if video.id in themes:
            return T.Why(T.WhyVia.theme, themes[video.id])
        return T.Why(T.WhyVia.channel, video.channel_title or video.channel_id)

    @staticmethod
    def _excluded(snap: _Snapshot, exc: T.RuleExclude) -> set[str]:
        out = set(exc.channels)
        for fid in exc.folders:
            desc = snap.descendants(fid)
            out |= {cid for cid, c in snap.channels.items() if c.folder_id in desc}
        for tid in exc.tags:
            out |= {cid for cid, c in snap.channels.items() if tid in c.tag_ids}
        return out

    def _video_rows(
        self, where: str, params: Sequence[Any], snap: _Snapshot, rules: T.TabRules
    ) -> list[Mapping[str, Any]]:
        sql = [
            f"SELECT {_VIDEO_COLS} FROM videos v LEFT JOIN video_state s ON s.video_id = v.id",
            "LEFT JOIN watermarks w ON w.channel_id = v.channel_id"
            if rules.filters.only_new
            else "",
            f"WHERE {where} AND (s.state IS NULL OR s.state <> 'archived')",
        ]
        args = list(params)
        if rules.mode is T.FeedMode.fresh:
            sql.append("AND (v.published_at IS NULL OR v.published_at = 0 OR v.published_at >= ?)")
            args.append(snap.now - FRESH_WINDOW_S)
        if rules.filters.only_new:
            sql.append(
                "AND (s.state IS NULL OR s.state = 'new')"
                " AND (w.seen_up_to IS NULL OR COALESCE(v.published_at, 0) > w.seen_up_to)"
            )
        return self.db.query(" ".join(s for s in sql if s), tuple(args))

    def _gather(self, snap: _Snapshot, rules: T.TabRules) -> list[_Cand]:
        """``include − exclude`` → candidates (video filters not applied yet)."""
        cands: list[_Cand] = []
        why_by_channel = self._included_channels(snap, rules)
        channel_ids = list(why_by_channel)
        for chunk in _chunks(channel_ids):
            rows = self._video_rows(
                f"v.channel_id IN ({_placeholders(chunk)})", tuple(chunk), snap, rules
            )
            for row in rows:
                video = _video(row)
                why = why_by_channel[video.channel_id]
                if not why.label:  # channel not in the table: name stored on the video
                    why = T.Why(T.WhyVia.channel, video.channel_title or video.channel_id)
                state, reaction = _state_of(row)
                cands.append(_Cand(video, why, state, reaction))
        excluded = self._excluded(snap, rules.exclude) if rules.include.themes else set()
        for theme_id in rules.include.themes:
            theme = self.db.query_one("SELECT name, query FROM themes WHERE id = ?", (theme_id,))
            if theme is None:
                continue
            label = theme["name"] or theme["query"] or theme_id
            rows = self._video_rows(
                "v.id IN (SELECT video_id FROM theme_items"
                " WHERE theme_id = ? AND verdict = 'keep')",
                (theme_id,),
                snap,
                rules,
            )
            for row in rows:
                video = _video(row)
                if video.channel_id in excluded:
                    continue
                state, reaction = _state_of(row)
                cands.append(_Cand(video, T.Why(T.WhyVia.theme, label), state, reaction))
        cands.extend(self._lens_candidates(snap, rules))
        return cands

    def _lens_candidates(self, snap: _Snapshot, rules: T.TabRules) -> list[_Cand]:
        wanted = set(rules.include.lenses)
        if not wanted:
            return []
        items: list[T.LensItem] = []
        for lens in self.lenses:
            try:
                if lens.name not in wanted or not lens.enabled():
                    continue
                items.extend(lens.items(rules, rules.mode, LENS_LIMIT))
            except Exception:  # noqa: BLE001 — a broken lens does not bring down the feed
                log.exception("lens %s failed in items()", getattr(lens, "name", "?"))
        if not items:
            return []
        excluded = self._excluded(snap, rules.exclude)
        states = self.video_state.get([i.video.id for i in items])
        out: list[_Cand] = []
        for li in items:
            if li.video.channel_id in excluded:
                continue
            st = states.get(li.video.id)
            out.append(
                _Cand(
                    li.video,
                    li.why,
                    st.state if st else T.VideoState.new,
                    st.reaction if st else None,
                    tuple(li.badges),
                    from_lens=True,
                )
            )
        return out

    # ------------------------------------------------------------------ filters

    def _filter(
        self, snap: _Snapshot, rules: T.TabRules, cands: Sequence[_Cand]
    ) -> list[T.FeedItem]:
        flt, mode = rules.filters, rules.mode
        cutoff = snap.now - FRESH_WINDOW_S
        min_s = flt.min_s
        if mode is T.FeedMode.long:
            min_s = max(min_s or 0, LONG_MIN_S)
        out: list[T.FeedItem] = []
        seen: set[str] = set()
        for c in cands:
            v = c.video
            if v.id in seen or c.state is T.VideoState.archived:
                continue
            if rules.exclude.shorts and v.is_short:
                continue
            if (
                not c.from_lens
                and mode is T.FeedMode.fresh
                and v.published_at
                and v.published_at < cutoff
            ):
                continue
            if v.duration_s is not None:
                if min_s is not None and v.duration_s < min_s:
                    continue
                if flt.max_s is not None and v.duration_s > flt.max_s:
                    continue
            new = snap.is_new(v, c.state)
            if flt.only_new and not new:
                continue
            seen.add(v.id)
            out.append(
                T.FeedItem(
                    video=v,
                    channel=snap.channels.get(v.channel_id),
                    state=c.state,
                    reaction=c.reaction,
                    is_new=new,
                    why=c.why,
                    badges=c.badges,
                )
            )
        out.sort(key=lambda i: _sort_key(mode, i.video))
        if flt.per_channel:
            per: dict[str, int] = {}
            capped: list[T.FeedItem] = []
            for item in out:
                n = per.get(item.video.channel_id, 0)
                if n < flt.per_channel:
                    capped.append(item)
                    per[item.video.channel_id] = n + 1
            out = capped
        return out

    def _evaluate(self, snap: _Snapshot, rules: T.TabRules) -> list[T.FeedItem]:
        return self._filter(snap, rules, self._gather(snap, rules))

    # ------------------------------------------------------------------ page

    def _select(
        self, snap: _Snapshot, rules: T.TabRules, cands: Sequence[_Cand], terms: Sequence[str]
    ) -> list[T.FeedItem]:
        items = self._filter(snap, rules, cands)
        if terms:
            items = [i for i in items if matches_search(i, terms)]
        return items

    def _run(
        self,
        rules: T.TabRules,
        limit: int,
        cursor: str | None,
        terms: Sequence[str] = (),
        order: FeedOrder = DEFAULT_ORDER,
    ) -> T.FeedPage:
        started = time.monotonic()
        limit = _check_limit(limit)
        if not order.is_default:
            return self._run_ordered(rules, limit, cursor, terms, order, started)
        self._refuse_order_cursor(cursor)
        after = _decode_cursor(cursor, rules.mode)
        snap = self._snapshot()
        cands = self._gather(snap, rules)
        items = self._select(snap, rules, cands, terms)
        need_duration = (
            rules.filters.min_s is not None
            or rules.filters.max_s is not None
            or rules.mode is T.FeedMode.long
        )
        need_short = rules.exclude.shorts and self._shorts_resolver is not None
        if need_duration or need_short:
            start = self._start(items, rules.mode, after)
            lens_ids = {c.video.id for c in cands if c.from_lens}
            window = [
                i.video
                for i in items[start : start + limit + DETAILS_LOOKAHEAD]
                if i.video.id not in lens_ids
            ]
            learned = self._fill_details(
                window, need_duration, need_short, started + self.details_budget_s
            )
            if learned:
                for c in cands:
                    patch = learned.get(c.video.id)
                    if patch:
                        c.video = replace(c.video, **patch)
                items = self._select(snap, rules, cands, terms)
        start = self._start(items, rules.mode, after)
        chunk = items[start : start + limit]
        next_cursor = (
            _encode_cursor(rules.mode, chunk[-1].video)
            if chunk and start + limit < len(items)
            else None
        )
        counts = T.FeedCounts(total=len(items), new=sum(1 for i in items if i.is_new))
        return T.FeedPage(items=tuple(self._enrich(chunk)), next_cursor=next_cursor, counts=counts)

    def _run_ordered(
        self,
        rules: T.TabRules,
        limit: int,
        cursor: str | None,
        terms: Sequence[str],
        order: FeedOrder,
        started: float,
    ) -> T.FeedPage:
        """``_run`` with ``sort``/``group``: the same set as the tab rule (mode, filters,
        ``per_channel`` picked by the tab's order, search), arranged by group → sort → id."""
        after = _decode_order_cursor(cursor, order, self.settings)
        snap = self._snapshot()
        cands = self._gather(snap, rules)
        items = self._select(snap, rules, cands, terms)
        keyer = _order_keyer(order, snap, lambda i: _sort_key(rules.mode, i.video)[0])
        need_duration = (
            rules.filters.min_s is not None
            or rules.filters.max_s is not None
            or rules.mode is T.FeedMode.long
        )
        need_short = rules.exclude.shorts and self._shorts_resolver is not None
        if need_duration or need_short:
            keyed = sorted(items, key=keyer)
            keys = [keyer(i) for i in keyed]
            start = 0 if after is None else bisect.bisect_right(keys, after)
            lens_ids = {c.video.id for c in cands if c.from_lens}
            window = [
                i.video
                for i in keyed[start : start + limit + DETAILS_LOOKAHEAD]
                if i.video.id not in lens_ids
            ]
            learned = self._fill_details(
                window, need_duration, need_short, started + self.details_budget_s
            )
            if learned:
                for c in cands:
                    patch = learned.get(c.video.id)
                    if patch:
                        c.video = replace(c.video, **patch)
                items = self._select(snap, rules, cands, terms)
        return self._ordered_page(items, keyer, after, limit, order)

    @staticmethod
    def _start(items: Sequence[T.FeedItem], mode: T.FeedMode, after: tuple[int, str] | None) -> int:
        if after is None:
            return 0
        keys = [_sort_key(mode, i.video) for i in items]
        if keys != sorted(keys):  # per_channel keeps the order; defensive
            return next((n for n, k in enumerate(keys) if k > after), len(items))
        return bisect.bisect_right(keys, after)

    def _enrich(self, items: list[T.FeedItem]) -> list[T.FeedItem]:
        for lens in self.lenses:
            try:
                if not lens.enabled():
                    continue
                enriched = list(lens.enrich(items))
            except Exception:  # noqa: BLE001
                log.exception("lens %s failed in enrich()", getattr(lens, "name", "?"))
                continue
            if len(enriched) == len(items) and all(
                a.video.id == b.video.id for a, b in zip(enriched, items, strict=True)
            ):
                items = enriched
            else:
                log.warning("lens %s changed the page in enrich(); ignored", lens.name)
        return items

    # ------------------------------------------------------------------ details on demand

    def _fill_details(
        self,
        window: Sequence[T.Video],
        need_duration: bool,
        need_short: bool,
        deadline: float,
    ) -> dict[str, dict[str, Any]]:
        learned: dict[str, dict[str, Any]] = {}
        futures: dict[str, Future[int | None]] = {}
        if need_duration:
            todo = [v.id for v in window if v.duration_s is None][: self.details_batch]
            futures = self._submit_durations(todo, learned)
        if need_short:
            todo = [v.id for v in window if v.is_short is None][: self.details_batch]
            for vid, value in self._resolve_shorts(todo, deadline).items():
                learned.setdefault(vid, {})["is_short"] = bool(value)
        if futures:
            remaining = max(0.0, deadline - time.monotonic())
            done, _ = wait(list(futures.values()), timeout=remaining)
            for vid, fut in futures.items():
                if fut in done and not fut.cancelled() and fut.exception() is None:
                    value = fut.result()
                    if value is not None:
                        learned.setdefault(vid, {})["duration_s"] = value
        return learned

    def _resolve_shorts(self, video_ids: Sequence[str], deadline: float) -> Mapping[str, bool]:
        resolver = self._shorts_resolver
        now = time.monotonic()
        todo = [v for v in video_ids if self._short_retry.get(v, 0.0) <= now]
        remaining = deadline - now
        if resolver is None or not todo or remaining <= 0.05:
            return {}
        try:
            result = dict(resolver(todo, limit=len(todo), timeout=remaining))
        except Exception:  # noqa: BLE001 — an unknown Short passes
            log.exception("resolve_shorts failed")
            result = {}
        retry_at = time.monotonic() + self.details_retry_s
        with self._lock:
            for vid in todo:
                if vid not in result:
                    self._short_retry[vid] = retry_at
        return {k: bool(v) for k, v in result.items() if isinstance(k, str)}

    def _executor(self) -> ThreadPoolExecutor:
        if self._pool is None:
            self._pool = ThreadPoolExecutor(
                max_workers=self.details_workers, thread_name_prefix="tube-feed-details"
            )
        return self._pool

    def _submit_durations(
        self, video_ids: Sequence[str], learned: dict[str, dict[str, Any]]
    ) -> dict[str, Future[int | None]]:
        out: dict[str, Future[int | None]] = {}
        now = time.monotonic()
        with self._lock:
            for vid in video_ids:
                if vid in self._known:
                    learned.setdefault(vid, {})["duration_s"] = self._known[vid]
                elif vid in self._inflight:
                    out[vid] = self._inflight[vid]
                elif self._dur_retry.get(vid, 0.0) > now:
                    continue
                elif len(self._inflight) < DETAILS_MAX_INFLIGHT:
                    ctx = contextvars.copy_context()
                    fut = self._executor().submit(ctx.run, self._fetch_duration, vid)
                    self._inflight[vid] = fut
                    out[vid] = fut
        return out

    def _fetch_duration(self, video_id: str) -> int | None:
        """Roda no pool: ``video_details`` → ``VideoStore.set_details``. Nunca levanta."""
        try:
            try:
                details = self.youtube.video_details(video_id)
                duration = details.duration_s
            except T.TubeError as exc:
                log.info("video_details(%s) got no answer: %s", video_id, exc.message)
                duration = None
            except Exception:  # noqa: BLE001
                log.exception("video_details(%s) failed", video_id)
                duration = None
            if duration is None or duration < 0:
                with self._lock:
                    self._dur_retry[video_id] = time.monotonic() + self.details_retry_s
                return None
            duration = int(duration)
            try:
                self.video_store.set_details(video_id, duration, None)
            except Exception:  # noqa: BLE001 — stays in the in-memory cache
                log.warning("set_details(%s) failed", video_id, exc_info=True)
            with self._lock:
                self._known[video_id] = duration
                while len(self._known) > _KNOWN_MAX:
                    self._known.popitem(last=False)
            return duration
        finally:
            with self._lock:
                self._inflight.pop(video_id, None)


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    youtube: T.YouTubeClient,
    video_store: T.VideoStore,
    lenses: Sequence[T.Lens],
    tabs: T.TabService,
    taxonomy: T.TaxonomyService,
    channels: T.ChannelService,
    video_state: T.VideoStateService,
    clock: T.Clock | None = None,
) -> T.FeedEngine:
    """``FeedEngine`` over *db*. No network, no thread. On-demand Shorts: wire
    ``Refresher.resolve_shorts`` through ``attach_shorts_resolver`` (the ``Refresher`` depends on
    the engine, so it does not come in here)."""
    return FeedEngine(
        db=db,
        settings=settings,
        youtube=youtube,
        video_store=video_store,
        lenses=lenses,
        tabs=tabs,
        taxonomy=taxonomy,
        channels=channels,
        video_state=video_state,
        clock=clock,
    )
