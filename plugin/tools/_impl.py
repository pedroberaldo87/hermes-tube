"""Bodies of the 9 agent tools. The public handlers live in ``catalog.py``; here, one
``run_<tool>(args, call) -> dict`` function per tool.

Rules:

- **Services only** — everything through ``wiring.get_<service>()`` at call time; no SQL.
- **Short, structured answers** — ids, titles, counts and "why it is here"; a cap on items per
  tool and on characters per answer (``MAX_CHARS``), with ``truncated``.
- **Errors** — invalid input and domain errors become ``T.TubeError`` (``catalog`` turns them
  into ``{"ok": false, "error": {code, message, hint}}``); never an exception for Hermes.
- **No approval** — no tool approves an unsubscription, resubscribes or touches the queue;
  organize, cleanup and theme only create a suggestion/candidate/preview.
- **Writes** — ``tube_add_channel`` and ``tube_tab`` write with ``actor=hermes`` (the history
  records it and undo works); ``tube_mark`` writes with ``actor=user`` because
  ``VideoStateService`` only records history (undo) for ``user`` and it was the user who asked.
- **Videos** — ``url`` always; ``card`` (``::tube-video`` directive) only on a platform that draws.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit

from tube_pkg import wiring
from tube_pkg.api import playlists as api_playlists
from tube_pkg.core import lang as L
from tube_pkg.core import types as T
from tube_pkg.tools import _text as X
from tube_pkg.tools import directive

MAX_CHARS = 8000
"""Character cap (JSON) of each answer."""
MAX_OPTIONS = 25
"""Options listed on a ``not_found``/ambiguity."""
FRESH_DAYS = 30
"""Window of the feed's ``fresh`` mode (older videos do not show in the regular tabs)."""
ORGANIZABLE = (T.Relation.subscribed, T.Relation.followed)

UC_RE = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
VIDEO_RE = directive.VIDEO_ID_RE
_URL_CHANNEL = re.compile(r"youtube\.com/channel/(UC[A-Za-z0-9_-]{22})", re.IGNORECASE)
_URL_HANDLE = re.compile(r"youtube\.com/(@[A-Za-z0-9._-]+)", re.IGNORECASE)

APP_UNDO = "The user can undo this in the app (history drawer in Manage)."
PLAYLIST_NOTE = (
    "Playlists are local to HermesTube (Subscriptions > Playlists tab); nothing is saved to the "
    "YouTube account."
)
LIST_PLAYLISTS = "*"
"""``tube_feed`` ``playlist`` value that lists the playlists instead of one playlist's videos."""
MAX_PLAYLISTS_OUT = 50
NO_APPROVAL = (
    "Nothing was approved or cancelled: Hermes never cancels subscriptions. The user approves in "
    "the app's Cleanup page or with /tube cleanup (in a chat app with buttons); only after that "
    "human approval does the browser extension unsubscribe."
)


class ThemeFailed(T.TubeError):
    """The theme came back with ``status=error`` (message from ``Themes``)."""

    code = "theme_error"


class Call:
    """Context of a call: Hermes ``kwargs``, clock and whether the chat draws cards."""

    def __init__(self, kwargs: Mapping[str, Any]) -> None:
        self.kwargs = dict(kwargs)
        self._render: bool | None = None
        self.now = float(wiring.get_clock().now())

    @property
    def render(self) -> bool:
        value = self._render
        if value is None:
            value = self._render = directive.renders_cards(self.kwargs)
        return value


# =========================================================================== arguments


def _invalid(message: str, field: str | None = None) -> T.ValidationError:
    return T.ValidationError(message, field=field) if field else T.ValidationError(message)


def opt_str(args: Mapping[str, Any], key: str, *, max_len: int = 300) -> str | None:
    """Optional text (``None``/empty = missing); any other type → ``invalid``."""
    value = args.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _invalid(f"{key}: expected a string", key)
    value = value.strip()
    if len(value) > max_len:
        raise _invalid(f"{key}: at most {max_len} characters", key)
    return value or None


def opt_int(args: Mapping[str, Any], key: str, *, default: int, lo: int, hi: int) -> int:
    value = args.get(key)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise _invalid(f"{key}: expected an integer from {lo} to {hi}", key)
    return value


def opt_bool(args: Mapping[str, Any], key: str) -> bool | None:
    value = args.get(key)
    if value is None:
        return None
    if not isinstance(value, bool):
        raise _invalid(f"{key}: expected true or false", key)
    return value


def opt_enum(args: Mapping[str, Any], key: str, choices: Sequence[str]) -> str | None:
    value = opt_str(args, key, max_len=40)
    if value is not None and value not in choices:
        raise _invalid(f"{key}: expected one of {', '.join(choices)}", key)
    return value


def str_list(
    args: Mapping[str, Any], key: str, *, max_items: int, required: bool = False
) -> list[str] | None:
    value = args.get(key)
    if value is None:
        if required:
            raise _invalid(f"{key}: required (a list of strings)", key)
        return None
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise _invalid(f"{key}: expected a list of strings", key)
    items = list(dict.fromkeys(v.strip() for v in value if v.strip()))
    if not items:
        raise _invalid(f"{key}: give at least one item", key)
    if len(items) > max_items:
        raise _invalid(f"{key}: at most {max_items} items", key)
    return items


# =========================================================================== names → ids


def norm(text: Any) -> str:
    """Name comparison: no accents, no case, collapsed spaces."""
    raw = unicodedata.normalize("NFKD", str(text or ""))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return " ".join(raw.casefold().split())


def _options(values: Sequence[str]) -> list[str]:
    return [X.clean(v, 60) for v in values[:MAX_OPTIONS]]


def folder_paths(folders: Sequence[T.Folder]) -> dict[str, str]:
    """``folder_id → "Parent/Child"``."""
    by_id = {f.id: f for f in folders}
    out: dict[str, str] = {}

    def path(fid: str, depth: int = 0) -> str:
        if fid in out:
            return out[fid]
        f = by_id[fid]
        parent = f.parent_id
        name = X.clean(f.name, 60)
        if parent in by_id and depth < 20:
            return f"{path(parent, depth + 1)}/{name}"
        return name

    for fid in by_id:
        out[fid] = path(fid)
    return out


def resolve_folder(value: str) -> tuple[str, str]:
    """Folder by id, path (``A/B``) or name → ``(id, path)``."""
    folders = wiring.get_taxonomy().list_folders()
    paths = folder_paths(folders)
    if value in paths:
        return value, paths[value]
    wanted = norm(value)
    by_path = [fid for fid, p in paths.items() if norm(p) == wanted]
    if len(by_path) == 1:
        return by_path[0], paths[by_path[0]]
    by_name = [f.id for f in folders if norm(f.name) == wanted]
    if len(by_name) == 1:
        return by_name[0], paths[by_name[0]]
    if len(by_name) > 1:
        raise T.ValidationError(
            f"More than one folder is called {X.clean(value, 60)!r}; use the full path.",
            field="folder",
            options=_options([paths[f] for f in by_name]),
        )
    raise T.NotFound(
        f"Folder {X.clean(value, 60)!r} does not exist.",
        options=_options(sorted(paths.values(), key=norm)),
    )


def resolve_tag(value: str) -> tuple[str, str]:
    tags = wiring.get_taxonomy().list_tags()
    for tag in tags:
        if tag.id == value:
            return tag.id, X.clean(tag.name, 40)
    found = [t for t in tags if norm(t.name) == norm(value)]
    if found:
        return found[0].id, X.clean(found[0].name, 40)
    raise T.NotFound(
        f"Tag {X.clean(value, 40)!r} does not exist.",
        options=_options(sorted((t.name for t in tags), key=norm)),
    )


def tab_label(tab_id: Any, name: Any) -> str:
    """Tab name as the agent sees it: built-in tabs by their English name (the database stores a
    fixed name for them; the tools speak English), the others as the user saved them."""
    return X.clean(L.tab_name(tab_id, name, "en"), 40)


def _tab_names(tab: T.Tab) -> set[str]:
    """Every name a tab answers to: its own and, for a built-in tab, the name in each language."""
    return {norm(tab.name)} | {norm(L.tab_name(tab.id, tab.name, code)) for code in ("en", "pt")}


def resolve_tab(value: str) -> T.Tab:
    """Tab by id or by name (built-in tabs also by their English or Portuguese name)."""
    svc = wiring.get_tabs()
    seed = getattr(svc, "ensure_builtin", None)
    if callable(seed):
        seed()
    tabs = svc.list()
    for tab in tabs:
        if tab.id == value:
            return tab
    found = [t for t in tabs if norm(value) in _tab_names(t)]
    if len(found) == 1:
        return found[0]
    raise T.NotFound(
        f"Tab {X.clean(value, 60)!r} does not exist.",
        options=_options([f"{t.id} ({tab_label(t.id, t.name)})" for t in tabs]),
    )


def resolve_channel(value: str, *, must_exist: bool = True) -> tuple[str, T.Channel | None]:
    """Channel by ``UC…`` id, link, ``@handle`` or title → ``(id, channel or None)``."""
    svc = wiring.get_channels()
    text = value.strip()
    m = _URL_CHANNEL.search(text)
    if m:
        text = m.group(1)
    else:
        m = _URL_HANDLE.search(text)
        if m:
            text = m.group(1)
    if UC_RE.match(text):
        ch = svc.get(text)
        if ch is None and must_exist:
            raise T.NotFound(f"Channel {text} is not in the user's list.")
        return text, ch
    if text.startswith("@"):
        ch = svc.find_duplicate(handle=text.casefold())
        if ch is None:
            ch = next(
                (
                    c
                    for c in svc.list(T.ChannelFilter(query=text[1:]))
                    if (c.handle or "").casefold() == text.casefold()
                ),
                None,
            )
        if ch is None:
            raise T.NotFound(
                f"No channel {X.clean(text, 60)} in the user's list. To follow it, use "
                "tube_add_channel."
            )
        return ch.id, ch
    candidates = svc.list(T.ChannelFilter(query=text))
    exact = [c for c in candidates if norm(c.title) == norm(text)]
    pick = exact if len(exact) == 1 else candidates
    if len(pick) == 1:
        return pick[0].id, pick[0]
    if not pick:
        raise T.NotFound(f"No channel matching {X.clean(text, 60)!r} in the user's list.")
    raise T.ValidationError(
        f"{len(pick)} channels match {X.clean(text, 60)!r}; pass the channel id.",
        field="channel",
        options=_options([f"{c.id} ({X.clean(c.title, 40)})" for c in pick]),
    )


# =========================================================================== answer pieces


def why_text(why: T.Why | None) -> str | None:
    if why is None:
        return None
    via = why.via.value if isinstance(why.via, T.WhyVia) else str(why.via)
    if via in ("channel", "list", "hn"):
        label = X.untrusted(why.label, 60) or ""
    else:
        label = X.clean(why.label, 60)
    detail = X.untrusted(why.detail, 120) if why.detail else None
    return " ".join(p for p in (via, label, detail) if p)


def video_out(
    call: Call,
    video: T.Video,
    *,
    item: T.FeedItem | None = None,
    description: bool = True,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    channel_title = video.channel_title or (
        item.channel.title if item is not None and item.channel is not None else None
    )
    out: dict[str, Any] = {
        "id": video.id,
        "title": X.untrusted(video.title, 120),
        "channel": X.untrusted(channel_title, 60),
        "channel_id": video.channel_id,
        "published": X.date(video.published_at),
        "age": X.age(video.published_at, call.now),
        "duration": X.duration(video.duration_s),
        "short": True if video.is_short else None,
        "views": video.views,
    }
    if item is not None:
        out["new"] = bool(item.is_new)
        if item.state is not T.VideoState.new:
            out["state"] = item.state.value
        if item.reaction is not None:
            out["reaction"] = item.reaction.value
        out["why"] = why_text(item.why)
        if item.badges:
            out["badges"] = [X.clean(b, 20) for b in item.badges[:5]]
    if extra:
        out.update(extra)
    if description:
        out["description"] = X.untrusted(video.description, 200)
    out["url"] = f"https://www.youtube.com/watch?v={video.id}"
    if call.render:
        out["card"] = directive.display(video.id)
    return X.compact(out)


def with_notes(call: Call, payload: dict[str, Any], *, videos: bool) -> dict[str, Any]:
    payload["untrusted"] = X.UNTRUSTED_NOTE
    if videos and call.render:
        payload["cards"] = directive.CARD_HINT
    return payload


def finish(payload: dict[str, Any], path: tuple[str, ...], *, truncated: bool) -> dict[str, Any]:
    payload["truncated"] = truncated
    if X.fit(payload, path, MAX_CHARS):
        payload["truncated"] = True
    return payload


def _channel_names(ids: Sequence[str]) -> dict[str, T.Channel]:
    if not ids:
        return {}
    found = wiring.get_channels().list(T.ChannelFilter(ids=tuple(dict.fromkeys(ids))))
    return {c.id: c for c in found}


# =========================================================================== tube_status


def run_status(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    refresher = wiring.get_refresher()
    try:
        kick = str(refresher.kick_if_due())
    except T.Busy:
        kick = "running"
    except Exception:  # noqa: BLE001 — the overview goes out even without firing the RSS
        kick = "error"
    port = wiring.ensure_ext_server(role="gateway")
    snap = refresher.status()
    counts = wiring.get_feed().new_counts()
    paths = folder_paths(wiring.get_taxonomy().list_folders())

    tabs = [
        X.compact(
            {
                "id": t.tab_id,
                "name": tab_label(t.tab_id, t.name),
                "icon": X.clean(t.icon, 8) or None,
                "new": int(t.count),
            }
        )
        for t in snap.new_by_tab
    ]
    folders = [
        {"id": fid, "name": paths[fid], "new": int(n)}
        for fid, n in counts.by_folder.items()
        if fid in paths and n
    ]
    folders.sort(key=lambda f: (-f["new"], norm(f["name"])))
    loose = int(counts.by_folder.get("", 0) or 0)
    if loose:
        folders.append({"id": None, "name": "(no folder)", "new": loose})
    favorites = []
    for fav in snap.fav_new[:10]:
        latest = None
        if fav.latest_video_id and VIDEO_RE.match(fav.latest_video_id):
            latest = X.compact(
                {
                    "id": fav.latest_video_id,
                    "title": X.untrusted(fav.latest_title, 120),
                    "url": f"https://www.youtube.com/watch?v={fav.latest_video_id}",
                    "card": directive.display(fav.latest_video_id) if call.render else None,
                }
            )
        favorites.append(
            X.compact(
                {
                    "channel_id": fav.channel_id,
                    "channel": X.untrusted(fav.title, 60),
                    "new": int(fav.count),
                    "latest": latest,
                }
            )
        )
    server_up = port is not None
    online = int(snap.devices_online or 0)
    refresh = X.compact(
        {
            "kick": kick,
            "running": bool(snap.refresh_running) or kick == "running",
            "last_check": X.age(snap.last_rss_at, call.now) or "never",
        }
    )
    if snap.rss_down_since:
        refresh["outage"] = (
            "YouTube's RSS feeds have been failing (first failure "
            f"{X.age(snap.rss_down_since, call.now)}); {snap.rss_fallback_channels} channels were "
            "read from their channel pages instead, so lists may miss the newest videos."
        )
    summary = (
        f"{snap.new_total} new videos"
        + (f", {sum(f['new'] for f in favorites)} from favorite channels" if favorites else "")
        + f"; browser extension {'connected' if online else 'not connected'}"
        + (f"; {snap.queue_pending} approved cancellations waiting" if snap.queue_pending else "")
        + "."
    )
    payload: dict[str, Any] = {
        "ok": True,
        "summary": summary,
        "new_total": int(snap.new_total),
        "tabs": tabs[:20],
        "folders": folders[:15],
        "favorites": favorites,
        "extension": {"server_up": server_up, "devices_online": online, "connected": online > 0},
        "refresh": refresh,
        "queue": {"cancellations_pending": int(snap.queue_pending or 0)},
        "next": "Use tube_feed to list videos of a tab, folder or channel.",
    }
    if snap.search_pending:
        payload["searches_pending"] = int(snap.search_pending)
    with_notes(call, payload, videos=bool(favorites))
    return finish(payload, ("favorites",), truncated=len(tabs) > 20 or len(folders) > 15)


# =========================================================================== tube_feed


def _scoped(engine: T.FeedEngine, *, limit: int, **scope: str) -> T.FeedPage:
    scoped = getattr(engine, "scope_page", None)
    if callable(scoped):
        return scoped(**scope, limit=limit)
    if "folder" in scope:
        rules = T.TabRules(include=T.RuleInclude(folders=(scope["folder"],)))
    else:
        rules = T.TabRules(include=T.RuleInclude(channels=(scope["channel"],)))
    return engine.preview(rules, limit=limit)


def _playlists_out() -> dict[str, Any]:
    everything = api_playlists.service().list()
    payload: dict[str, Any] = {
        "ok": True,
        "playlists": [
            {"id": p.id, "name": X.clean(p.name, 80), "count": p.count}
            for p in everything[:MAX_PLAYLISTS_OUT]
        ],
        "note": PLAYLIST_NOTE,
    }
    if not everything:
        payload["message"] = (
            "No playlists yet. Add a video with tube_mark (playlist + create_playlist) or with "
            "Add to playlist in the app."
        )
    return finish(payload, ("playlists",), truncated=len(everything) > MAX_PLAYLISTS_OUT)


def _playlist_feed(value: str, limit: int, call: Call) -> dict[str, Any]:
    svc = api_playlists.service()
    playlist = svc.find(value)
    ids = svc.item_ids(playlist.id)
    page = api_playlists.feed_items(ids[:limit])
    items = [video_out(call, item.video, item=item) for item in page]
    payload: dict[str, Any] = {
        "ok": True,
        "source": {"playlist": playlist.id, "name": X.clean(playlist.name, 80)},
        "counts": {"total": len(ids), "new": sum(1 for it in page if it.is_new)},
        "items": items,
    }
    if not items:
        payload["message"] = "This playlist is empty."
    with_notes(call, payload, videos=bool(items))
    return finish(payload, ("items",), truncated=len(ids) > limit)


def run_feed(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    limit = opt_int(args, "limit", default=10, lo=1, hi=50)
    given = {k: opt_str(args, k, max_len=200) for k in ("tab", "folder", "channel", "playlist")}
    present = [k for k, v in given.items() if v]
    if len(present) > 1:
        raise _invalid("Pass only one of tab, folder, channel or playlist.", present[1])
    if present == ["playlist"]:
        value = given["playlist"] or ""
        return _playlists_out() if value == LIST_PLAYLISTS else _playlist_feed(value, limit, call)
    engine = wiring.get_feed()
    note = None
    if not present:
        given["tab"], present = T.BUILTIN_TAB_ALL_NEW, ["tab"]
        note = "No tab, folder or channel given: showing the All new tab."
    key = present[0]
    value = given[key] or ""
    if key == "tab":
        tab = resolve_tab(value)
        source: dict[str, Any] = {"tab": tab.id, "name": tab_label(tab.id, tab.name)}
        page = engine.page(tab.id, limit=limit)
    elif key == "folder":
        fid, path = resolve_folder(value)
        source = {"folder": fid, "name": path}
        page = _scoped(engine, folder=fid, limit=limit)
    else:
        cid, ch = resolve_channel(value, must_exist=False)
        source = {"channel": cid, "name": X.untrusted(ch.title, 60) if ch else None}
        page = _scoped(engine, channel=cid, limit=limit)
    items = [video_out(call, item.video, item=item) for item in page.items[:limit]]
    payload: dict[str, Any] = {
        "ok": True,
        "source": X.compact(source),
        "counts": {"total": int(page.counts.total), "new": int(page.counts.new)},
        "items": items,
    }
    if note:
        payload["note"] = note
    if not items:
        payload["message"] = (
            "No videos here right now (tabs, folders and channels show the last "
            f"{FRESH_DAYS} days unless the tab mode says otherwise)."
        )
    with_notes(call, payload, videos=bool(items))
    more = page.next_cursor is not None or len(page.items) > limit
    return finish(payload, ("items",), truncated=more)


# =========================================================================== tube_channels


def visibility(ch: T.Channel, now: float) -> str:
    """Why the channel shows (or not) in the tabs — answers "why don't I see channel X anymore"."""
    if ch.relation is T.Relation.ignored:
        return "Ignored: never shown in feeds (the user can follow it again in Manage)."
    if ch.relation is T.Relation.ex:
        since = X.date(ch.unsubscribed_at)
        return (
            "Ex-subscription"
            + (f" since {since}" if since else "")
            + ": the user unsubscribed, so it no longer appears in feeds. Re-subscribing is a "
            "human action in the app (Cleanup → Ex-subscriptions)."
        )
    if ch.muted:
        return "Muted: hidden from All new, folders and tags; only tabs that list it show it."
    days = X.days_since(ch.last_video_at, now)
    if days is None:
        return "No videos fetched yet (the next RSS check brings them)."
    if days > FRESH_DAYS:
        return f"No new video for {days} days (feeds show the last {FRESH_DAYS} days)."
    return "Visible in feeds."


def channel_out(
    ch: T.Channel,
    call: Call,
    *,
    paths: Mapping[str, str],
    tags: Mapping[str, str],
    new: Mapping[str, int],
) -> dict[str, Any]:
    return X.compact(
        {
            "id": ch.id,
            "title": X.untrusted(ch.title, 60),
            "handle": X.clean(ch.handle, 40) or None,
            "relation": ch.relation.value,
            "folder": paths.get(ch.folder_id or ""),
            "tags": [tags[t] for t in ch.tag_ids if t in tags],
            "favorite": True if ch.favorite else None,
            "muted": True if ch.muted else None,
            "new": int(new.get(ch.id, 0)),
            "last_video": X.age(ch.last_video_at, call.now),
            "per_week": round(ch.videos_per_week, 1) if ch.videos_per_week is not None else None,
            "shorts": f"{round(ch.shorts_ratio * 100)}%" if ch.shorts_ratio else None,
            "note": X.untrusted(ch.ai_note, 120),
            "visibility": visibility(ch, call.now),
            "url": _channel_page(ch),
        }
    )


_PAGE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"})


def _channel_page(ch: T.Channel) -> str:
    """The channel link handed to the model: the stored one only if it is an https YouTube page
    (older rows or a hostile backup may hold ``file:`` or any site), else the canonical page."""
    canonical = f"https://www.youtube.com/channel/{ch.id}"
    text = X.clean(ch.url, 120)
    if not text:
        return canonical
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return canonical
    if parts.scheme != "https" or host not in _PAGE_HOSTS or parts.username or parts.password:
        return canonical
    if port not in (None, 443):
        return canonical
    query = f"?{parts.query}" if parts.query else ""
    return f"https://www.youtube.com{parts.path}{query}"


def run_channels(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    limit = opt_int(args, "limit", default=20, lo=1, hi=100)
    query = opt_str(args, "query", max_len=100)
    relation = opt_enum(args, "relation", [r.value for r in T.Relation])
    favorite = opt_bool(args, "favorite")
    inactive = args.get("inactive_days")
    if inactive is not None:
        inactive = opt_int(args, "inactive_days", default=0, lo=1, hi=3650)
    folder_arg = opt_str(args, "folder", max_len=200)
    tag_arg = opt_str(args, "tag", max_len=100)
    folder_id: Any = T.UNSET
    if folder_arg is not None:
        no_folder = norm(folder_arg) in ("none", "no folder", "(no folder)", "sem pasta")
        folder_id = None if no_folder else resolve_folder(folder_arg)[0]
    tag_id = resolve_tag(tag_arg)[0] if tag_arg else None
    found = wiring.get_channels().list(
        T.ChannelFilter(
            relations=(T.Relation(relation),) if relation else (),
            folder_id=folder_id,
            tag_id=tag_id,
            favorite=favorite,
            query=query,
        )
    )
    if inactive:
        found = [
            c
            for c in found
            if (X.days_since(c.last_video_at, call.now) or 10**6) >= inactive
            and c.last_video_at is not None
        ]
    taxonomy = wiring.get_taxonomy()
    paths = folder_paths(taxonomy.list_folders())
    tags = {t.id: X.clean(t.name, 40) for t in taxonomy.list_tags()}
    new = dict(wiring.get_feed().new_counts().by_channel) if found else {}
    rows = [channel_out(c, call, paths=paths, tags=tags, new=new) for c in found[:limit]]
    payload: dict[str, Any] = {"ok": True, "total": len(found), "items": rows}
    if not rows:
        payload["message"] = (
            "No channel matches. To follow a new channel by link or @handle use tube_add_channel."
        )
    with_notes(call, payload, videos=False)
    return finish(payload, ("items",), truncated=len(found) > limit)


# =========================================================================== tube_add_channel


def run_add_channel(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    text = opt_str(args, "url_or_handle", max_len=300)
    if not text or len(text) < 2:
        raise _invalid(
            "url_or_handle: give a channel link, @handle, UC… id or a video link", "url_or_handle"
        )
    folder_arg = opt_str(args, "folder", max_len=200)
    folder_id, folder_path = resolve_folder(folder_arg) if folder_arg else (None, None)
    changelog = wiring.get_changelog()
    recent = changelog.list(limit=1)
    mark = recent[0].id if recent else 0
    svc = wiring.get_channels()
    ch = svc.add(text, folder_id=folder_id, actor=T.Actor.hermes)
    added = any(
        rec.id > mark
        and rec.action is T.ChangeAction.channel_add
        and rec.payload.get("channel_id") == ch.id
        for rec in changelog.list(limit=20)
    )
    if added:
        try:
            wiring.get_refresher().kick_channel(ch.id)
        except Exception:  # noqa: BLE001 — the channel is already in; the normal cycle picks it up later
            pass
    taxonomy = wiring.get_taxonomy()
    paths = folder_paths(taxonomy.list_folders())
    tags = {t.id: X.clean(t.name, 40) for t in taxonomy.list_tags()}
    out = channel_out(ch, call, paths=paths, tags=tags, new={})
    out.pop("visibility", None)
    if added:
        message = (
            f"Now following {out.get('title') or ch.id} without subscribing on YouTube"
            + (f", in folder {folder_path}" if folder_path else "")
            + ". Its latest videos arrive in a moment."
        )
    else:
        message = f"Already in the list ({ch.relation.value}); nothing changed."
    payload: dict[str, Any] = {"ok": True, "added": added, "channel": out, "message": message}
    if added:
        payload["undo"] = APP_UNDO
    return with_notes(call, payload, videos=False)


# =========================================================================== tube_organize


def run_organize(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    wanted = str_list(args, "channel_ids", max_items=500)
    svc = wiring.get_channels()
    ids: list[str] | None = None
    skipped: list[str] = []
    if wanted is not None:
        ids = []
        for value in wanted:
            try:
                cid, ch = resolve_channel(value)
            except T.NotFound:
                skipped.append(X.clean(value, 40))
                continue
            except T.ValidationError:
                if not UC_RE.match(value) and not value.startswith("@"):
                    raise _invalid(
                        "channel_ids: use channel ids (UC…) or @handles", "channel_ids"
                    ) from None
                raise
            if ch is not None and ch.relation in ORGANIZABLE:
                ids.append(cid)
            else:
                skipped.append(X.clean(value, 40))
        if not ids:
            raise T.NotFound(
                "None of these channels is followed or subscribed in the user's list.",
                options=skipped[:MAX_OPTIONS],
            )
        requested = len(ids)
    else:
        requested = len(svc.list(T.ChannelFilter(relations=ORGANIZABLE, folder_id=None)))
    payload: dict[str, Any] = {"ok": True, "requested": requested}
    if requested == 0:
        payload.update(
            covered=0,
            suggestions=[],
            applied=False,
            message="Nothing to organize: every followed channel already has a folder.",
        )
        return with_notes(call, payload, videos=False)
    result = wiring.get_organizer().organize(ids, timeout=T.TOOL_TIMEOUT_S)
    names = _channel_names([s.channel_id or "" for s in result.suggestions])
    groups: dict[str, dict[str, Any]] = {}
    covered: set[str] = set()
    for sug in result.suggestions:
        p = sug.payload or {}
        cid = str(sug.channel_id or p.get("channel_id") or "")
        covered.add(cid)
        folder = X.clean(p.get("folder"), 60) or "(no folder)"
        group = groups.setdefault(
            folder, {"folder": folder, "new_folder": bool(p.get("new_folder")), "channels": []}
        )
        ch = names.get(cid)
        group["channels"].append(
            X.compact(
                {
                    "id": cid,
                    "title": X.untrusted(ch.title if ch else cid, 60),
                    "tags": [X.clean(t, 30) for t in (p.get("tags") or [])][:5],
                    "confidence": round(float(p.get("confidence") or 0), 2),
                    "why": X.untrusted(p.get("why"), 140),
                }
            )
        )
    n = len(covered)
    message = f"Suggestions for {n} of {requested} channels"
    if n < requested:
        message += (
            " (partial: the 90 s limit or the AI skipped some channels; run again for the rest)"
        )
    payload.update(
        model=result.model,
        covered=n,
        message=message + ".",
        suggestions=sorted(groups.values(), key=lambda g: (-len(g["channels"]), norm(g["folder"]))),
        applied=False,
        next=(
            "Nothing was applied. The user reviews and accepts the suggestions in the app: "
            "Manage → Organize with Hermes."
        ),
    )
    if skipped:
        payload["skipped"] = skipped[:MAX_OPTIONS]
    with_notes(call, payload, videos=False)
    truncated = False
    while X.size(payload) > MAX_CHARS and any(g["channels"] for g in payload["suggestions"]):
        biggest = max(payload["suggestions"], key=lambda g: len(g["channels"]))
        biggest["channels"].pop()
        truncated = True
    payload["suggestions"] = [g for g in payload["suggestions"] if g["channels"]]
    payload["truncated"] = truncated
    return payload


# =========================================================================== tube_cleanup_scan

_GROUP_LABELS = {
    T.CleanupGroup.stale: "No new video in 180+ days",
    T.CleanupGroup.ignored: "Publishes a lot, nothing watched in 90 days",
    T.CleanupGroup.off_profile: "Off the user's profile (AI)",
    T.CleanupGroup.manual: "Proposed by the user",
}
_GROUP_CAP = 15


def run_cleanup_scan(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    use_last = opt_bool(args, "use_last")
    cleanup = wiring.get_cleanup()
    scan = cleanup.latest_scan() if use_last else cleanup.scan(timeout=T.TOOL_TIMEOUT_S)
    payload: dict[str, Any] = {"ok": True}
    if scan is None:
        payload.update(
            groups=[],
            approved=0,
            message="No cleanup scan yet. Call tube_cleanup_scan without use_last to build one.",
            next=NO_APPROVAL,
        )
        return with_notes(call, payload, videos=False)
    names = _channel_names([c.channel_id for c in scan.candidates])
    grouped = scan.by_group()
    groups = []
    truncated = False
    for group in (
        T.CleanupGroup.stale,
        T.CleanupGroup.ignored,
        T.CleanupGroup.off_profile,
        T.CleanupGroup.manual,
    ):
        cands = grouped.get(group, ())
        if not cands:
            continue
        truncated = truncated or len(cands) > _GROUP_CAP
        groups.append(
            {
                "group": group.value,
                "label": _GROUP_LABELS[group],
                "count": len(cands),
                "channels": [
                    X.compact(
                        {
                            "id": c.channel_id,
                            "title": X.untrusted(
                                names[c.channel_id].title if c.channel_id in names else None, 60
                            ),
                            "why": X.untrusted(c.why, 140),
                        }
                    )
                    for c in cands[:_GROUP_CAP]
                ],
            }
        )
    total = len(scan.candidates)
    payload.update(
        scan_id=scan.scan_id,
        created=X.age(scan.created_at, call.now),
        model=scan.model,
        total=total,
        groups=groups,
        approved=0,
        next=NO_APPROVAL,
    )
    if scan.model is None:
        payload["note"] = (
            "No AI model was used: only the rule-based groups (stale, ignored), without the "
            "'off profile' group and with factual reasons."
        )
    if not groups:
        payload["message"] = "Nothing to clean up: no subscribed channel matched the rules."
    with_notes(call, payload, videos=False)
    while X.size(payload) > MAX_CHARS and any(g["channels"] for g in groups):
        max(groups, key=lambda g: len(g["channels"]))["channels"].pop()
        truncated = True
    payload["truncated"] = truncated
    return payload


# =========================================================================== tube_theme_create


def run_theme_create(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    query = opt_str(args, "query", max_len=200)
    if not query or len(query) < 2:
        raise _invalid("query: describe the topic (2 to 200 characters)", "query")
    preview = wiring.get_themes().create(query, origin=T.Actor.hermes, timeout=T.TOOL_TIMEOUT_S)
    theme = preview.theme
    if theme.status is T.ThemeStatus.error:
        raise ThemeFailed(X.clean(theme.error, 300) or "The theme search failed.")
    videos = []
    for item in preview.items[:8]:
        video = preview.videos.get(item.video_id)
        if video is None:
            continue
        videos.append(
            video_out(
                call,
                video,
                description=False,
                extra={
                    "score": round(item.score, 2) if item.score is not None else None,
                    "reason": X.untrusted(item.reason, 140),
                },
            )
        )
    payload: dict[str, Any] = {
        "ok": True,
        "theme": X.compact(
            {
                "id": theme.id,
                "name": X.untrusted(theme.name, 40),
                "icon": X.clean(theme.icon, 8) or None,
                "status": theme.status.value,
                "searches": [X.untrusted(s, 80) for s in theme.searches[:8]],
            }
        ),
        "video_count": len(preview.items),
        "channel_count": int(preview.channel_count),
        "videos": videos,
        "seeds": [
            X.compact(
                {
                    "channel_id": s.channel_id,
                    "channel": X.untrusted(s.title, 60),
                    "kept_videos": s.kept_videos,
                }
            )
            for s in preview.seeds[:5]
        ],
        "saved": False,
        "next": (
            "This is a preview; nothing was saved or followed. To keep it as a tab the user saves "
            "it in the app (Home → + New tab → Theme), where seed channels can also be followed."
        ),
    }
    if theme.error:
        payload["note"] = X.clean(theme.error, 300)
    if not preview.items:
        payload["message"] = "The search found no video worth keeping for this topic."
    with_notes(call, payload, videos=bool(videos))
    return finish(payload, ("videos",), truncated=len(preview.items) > len(videos))


# =========================================================================== tube_tab

_RULE_SECTIONS = ("include", "exclude", "filters", "mode")
_TAB_KINDS = (T.TabKind.category.value, T.TabKind.channels.value, T.TabKind.mixed.value)


def _resolve_rules(rules: Mapping[str, Any]) -> dict[str, Any]:
    """Replace names with ids in ``include``/``exclude`` (folders, tags, channels); the rest goes
    through as is (``TabService.validate_rules`` validates)."""
    out = dict(rules)
    resolvers: dict[str, Callable[[str], str]] = {
        "folders": lambda v: resolve_folder(v)[0],
        "tags": lambda v: resolve_tag(v)[0],
        "channels": lambda v: v if UC_RE.match(v) else resolve_channel(v)[0],
    }
    for section in ("include", "exclude"):
        part = out.get(section)
        if not isinstance(part, Mapping):
            continue
        part = dict(part)
        for key, fn in resolvers.items():
            values = part.get(key)
            if isinstance(values, list) and all(isinstance(v, str) for v in values):
                part[key] = list(dict.fromkeys(fn(v.strip()) for v in values if v.strip()))
        out[section] = part
    return out


def _infer_kind(rules: T.TabRules) -> T.TabKind:
    inc = rules.include
    by_channel = bool(inc.channels)
    by_category = bool(inc.folders or inc.tags or inc.all or inc.favorites)
    by_other = bool(inc.themes or inc.lenses)
    if by_channel and not (by_category or by_other):
        return T.TabKind.channels
    if by_category and not (by_channel or by_other):
        return T.TabKind.category
    if not (by_channel or by_category or by_other):
        return T.TabKind.category
    return T.TabKind.mixed


def _rules_summary(rules: T.TabRules) -> dict[str, Any]:
    taxonomy = wiring.get_taxonomy()
    paths = folder_paths(taxonomy.list_folders())
    tags = {t.id: X.clean(t.name, 40) for t in taxonomy.list_tags()}
    inc, exc, flt = rules.include, rules.exclude, rules.filters
    return X.compact(
        {
            "all": True if inc.all else None,
            "favorites": True if inc.favorites else None,
            "folders": [paths.get(f, f) for f in inc.folders],
            "tags": [tags.get(t, t) for t in inc.tags],
            "channels": len(inc.channels) or None,
            "themes": len(inc.themes) or None,
            "exclude_folders": [paths.get(f, f) for f in exc.folders],
            "exclude_tags": [tags.get(t, t) for t in exc.tags],
            "exclude_channels": len(exc.channels) or None,
            "exclude_shorts": True if exc.shorts else None,
            "only_new": True if flt.only_new else None,
            "per_channel": flt.per_channel,
            "min_s": flt.min_s,
            "max_s": flt.max_s,
            "mode": rules.mode.value,
        }
    )


def run_tab(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    action = opt_enum(args, "action", ["create", "update"])
    if action is None:
        raise _invalid("action: 'create' or 'update'", "action")
    name = opt_str(args, "name", max_len=60)
    icon = opt_str(args, "icon", max_len=16)
    kind = opt_str(args, "kind", max_len=20)
    if kind is not None and kind not in _TAB_KINDS:
        raise _invalid(
            "kind: category, channels or mixed (theme tabs come from tube_theme_create)", "kind"
        )
    rules_raw = args.get("rules")
    if rules_raw is not None and not isinstance(rules_raw, Mapping):
        raise _invalid("rules: expected an object with include, exclude, filters, mode", "rules")
    tabs = wiring.get_tabs()
    if action == "create":
        if not name:
            raise _invalid("name: required to create a tab", "name")
        rules = tabs.validate_rules(_resolve_rules(rules_raw or {}))
        tab = tabs.create(
            T.TabDraft(
                name=name,
                kind=T.TabKind(kind) if kind else _infer_kind(rules),
                rules=rules,
                icon=icon,
            ),
            actor=T.Actor.hermes,
        )
        message = f"Tab {X.clean(tab.name, 40)!r} created."
    else:
        tab_arg = opt_str(args, "tab_id", max_len=100)
        if not tab_arg:
            raise _invalid("tab_id: required to update (tab id or name)", "tab_id")
        current = resolve_tab(tab_arg)
        if name is None and icon is None and kind is None and rules_raw is None:
            raise _invalid("give at least one of name, icon, kind or rules to update")
        rules_dict: Any = T.UNSET
        new_rules = None
        if rules_raw is not None:
            unknown = sorted(set(rules_raw) - set(_RULE_SECTIONS))
            if unknown:
                raise _invalid(f"rules: unknown keys {unknown}", "rules")
            merged = current.rules.to_dict()
            merged.update(_resolve_rules(rules_raw))
            new_rules = tabs.validate_rules(merged)
            rules_dict = new_rules.to_dict()
        patch = T.TabPatch(
            name=name if name is not None else T.UNSET,
            icon=icon if icon is not None else T.UNSET,
            kind=T.TabKind(kind) if kind else T.UNSET,
            rules=rules_dict,
        )
        tab = tabs.update(current.id, patch, actor=T.Actor.hermes)
        message = f"Tab {X.clean(tab.name, 40)!r} updated."
    preview: dict[str, Any] = {}
    try:
        page = wiring.get_feed().page(tab.id, limit=1)
        preview = {"videos": int(page.counts.total), "new": int(page.counts.new)}
    except T.TubeError:
        preview = {"videos": None}
    payload = {
        "ok": True,
        "tab": X.compact(
            {
                "id": tab.id,
                "name": X.clean(tab.name, 40),
                "kind": tab.kind.value,
                "icon": X.clean(tab.icon, 8) or None,
                "rules": _rules_summary(tab.rules),
            }
        ),
        "preview": preview,
        "message": message,
        "undo": APP_UNDO,
        "next": "Use tube_feed with this tab id to list its videos.",
    }
    return payload


# =========================================================================== tube_mark


def _playlist_target(name: str, *, create: bool) -> tuple[Any, bool]:
    """Playlist by id or name; missing + *create* → a new one. ``(playlist, created)``."""
    svc = api_playlists.service()
    try:
        return svc.find(name), False
    except T.NotFound:
        if not create:
            raise
    return svc.create(name), True


def run_mark(args: Mapping[str, Any], call: Call) -> dict[str, Any]:
    ids = str_list(args, "video_ids", max_items=50, required=True) or []
    bad = [v for v in ids if not VIDEO_RE.match(v)]
    if bad:
        raise _invalid(
            f"video_ids: YouTube video ids have 11 characters ({X.clean(bad[0], 20)!r} does not)",
            "video_ids",
        )
    state = opt_enum(args, "state", [s.value for s in T.VideoState])
    reaction = opt_enum(args, "reaction", ["up", "down", "none"])
    playlist_ref = opt_str(args, "playlist", max_len=200)
    create_playlist = bool(opt_bool(args, "create_playlist"))
    if state is None and reaction is None and playlist_ref is None:
        raise _invalid("give state, reaction and/or playlist", "state")
    known = wiring.get_video_store().get(ids)
    found = [v for v in ids if v in known]
    unknown = [v for v in ids if v not in known]
    if not found:
        raise T.NotFound("None of these videos is known; use ids from tube_feed results.")
    playlist_out: dict[str, Any] | None = None
    if playlist_ref is not None:
        # resolved first: an unknown playlist changes nothing (not even the state)
        target, created = _playlist_target(playlist_ref, create=create_playlist)
        added = api_playlists.service().add(target.id, found)
        after = api_playlists.service().get(target.id)
        playlist_out = {
            "id": after.id,
            "name": X.clean(after.name, 80),
            "added": added,
            "count": after.count,
        }
        if created:
            playlist_out["created"] = True
    svc = wiring.get_video_state()
    changed = 0
    if state is not None:
        changed = int(svc.set_state(found, T.VideoState(state), actor=T.Actor.hermes) or 0)
    if reaction is not None:
        value = None if reaction == "none" else T.Reaction(reaction)
        for vid in found:
            svc.set_reaction(vid, value, actor=T.Actor.hermes)
        changed = max(changed, len(found))
    payload = X.compact(
        {
            "ok": True,
            "changed": changed,
            "state": state,
            "reaction": reaction,
            "videos": [{"id": v, "title": X.untrusted(known[v].title, 120)} for v in found[:20]],
            "unknown": unknown,
            "undo": APP_UNDO if state is not None or reaction is not None else None,
        }
    )
    payload["changed"] = changed
    if playlist_out is not None:
        payload["playlist"] = playlist_out
        payload["playlist_note"] = PLAYLIST_NOTE
    return with_notes(call, payload, videos=False)


RUNNERS: dict[str, Callable[[Mapping[str, Any], Call], dict[str, Any]]] = {
    "tube_status": run_status,
    "tube_feed": run_feed,
    "tube_channels": run_channels,
    "tube_add_channel": run_add_channel,
    "tube_organize": run_organize,
    "tube_cleanup_scan": run_cleanup_scan,
    "tube_theme_create": run_theme_create,
    "tube_tab": run_tab,
    "tube_mark": run_mark,
}

__all__ = ["MAX_CHARS", "RUNNERS", "Call", "ThemeFailed"]
