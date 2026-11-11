"""Public YouTube client: implementation of the ``YouTubeClient`` protocol.

Everything goes through the plugin's ``HttpClient`` (timeout, retries, 4 per host, ``SOCS=CAI``).
No cache, no database, no threads: pace and batching belong to the caller. A network or parse
failure becomes a ``YouTubeError`` with a readable message; invalid input becomes a
``ValidationError`` **before** any request.

Sources (formats measured on saved pages in ``tests/fixtures/youtube``):

- RSS ``/feeds/videos.xml?channel_id=`` — Atom; the feed's ``yt:channelId`` comes **without** the
  ``UC``; ``media:description`` and ``media:statistics/@views``; Short = a ``/shorts/<id>`` link
  in the entry (a ``/watch`` link proves nothing: ``is_short`` stays ``None``).
- Channel page — ``ytInitialData.metadata.channelMetadataRenderer`` (id, title, avatar,
  ``vanityChannelUrl``); current header ``pageHeaderViewModel`` with the old
  ``c4TabbedHeaderRenderer`` as a fallback.
- Search — ``ytInitialData`` with ``videoRenderer`` (and video ``lockupViewModel``, the new
  format). ``shortsLockupViewModel`` is left out (no channel, no duration). Recent
  (``SearchOrder.date``): the month filter, ``sp=EgIIBA==``.
  Portuguese interface only with the ``Accept-Language: pt-BR`` header (``hl`` alone is ignored).
- Video page — ``ytInitialPlayerResponse.videoDetails`` (``lengthSeconds``, ``isLive``,
  ``isUpcoming``); live and scheduled videos have no duration.
- ``/shorts/<id>`` without following redirects: 200 = Short, 3xx = regular video. The 200 page
  carries ``ytInitialPlayerResponse.videoDetails.lengthSeconds`` (``short_details``).
- Channel uploads playlists (measured 2026-11-10): ``/playlist?list=UU<id without UC>`` = the 100
  most recent uploads (``lockupViewModel``), with the duration in the badge **Shorts included**;
  ``UUSH…`` = Shorts only (``shortsLockupViewModel``, no duration). A channel without Shorts: HTTP
  200 with ``alerts`` "The playlist does not exist." (``PlaylistPage.exists=False``).

RSS plan B: the feed server goes down almost every US night (404/500 for every channel, sporadic
200) while the pages stay up. ``fetch_channel_uploads`` reads ``/channel/<id>/videos``
(``ytInitialData``) and returns the **same** ``RssFeed``, with approximate dates (the page only
says "2 days ago") marked as such (``ChannelPageFeed``). RSS 404/5xx carries
``feed_unavailable=True`` and **never** ``channel_missing``: only the page says a channel is gone
(HTTP 404 or, as measured on 2026-11-10, HTTP 200 with ``alerts`` "This channel does not exist.").
"""

from __future__ import annotations

import functools
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, TypeVar
from urllib.parse import quote, urlsplit

from tube_pkg.core import dedup
from tube_pkg.core.types import (
    ChannelInfo,
    Clock,
    HttpClient,
    HttpError,
    HttpResponse,
    RssFeed,
    SearchHit,
    SearchOrder,
    Settings,
    SystemClock,
    Timestamp,
    TubeError,
    ValidationError,
    VideoDetails,
    VideoIn,
    YouTubeClient,
    YouTubeError,
)

BASE_URL = "https://www.youtube.com"
RSS_URL = f"{BASE_URL}/feeds/videos.xml"
SEARCH_URL = f"{BASE_URL}/results"
WATCH_URL = f"{BASE_URL}/watch"
CHANNEL_VIDEOS_URL = BASE_URL + "/channel/{channel_id}/videos"
PLAYLIST_URL = f"{BASE_URL}/playlist"
FRAME_URL = "https://i.ytimg.com/vi/{video_id}/hq2.jpg"

RSS_MAX_VIDEOS = 15
SEARCH_SP: Mapping[SearchOrder, str | None] = {
    SearchOrder.relevance: None,
    SearchOrder.date: "EgIIBA==",
}
"""``sp`` value per order (becomes ``sp=EgIIBA%3D%3D`` in the URL).

``SearchOrder.date`` = **recent**: YouTube's "uploaded this month" filter. Measured on 2026-11-10:
sorting by date (``sp=CAI=``) stopped sorting — it returned videos from a year back, mixed, and
10 of 20 equal to the relevance search; the month filter only returns videos up to ~4 weeks
old."""

LANG_PT = {"Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5"}
LANG_EN = {"Accept-Language": "en-US,en;q=0.9"}
AVATAR_TARGET_PX = 176

_ATOM = "{http://www.w3.org/2005/Atom}"
_YT = "{http://www.youtube.com/xml/schemas/2015}"
_MEDIA = "{http://search.yahoo.com/mrss/}"
_CHANNEL_ID_RE = re.compile(r"UC[0-9A-Za-z_-]{22}")
_DTD_RE = re.compile(r"<!(?:DOCTYPE|ENTITY)", re.IGNORECASE)

_F = TypeVar("_F", bound=Callable[..., Any])


# --------------------------------------------------------------------------------------------
# Erros
# --------------------------------------------------------------------------------------------


def _guard(what: str) -> Callable[[_F], _F]:
    """No loose exceptions: ``TubeError`` passes (``HttpError`` becomes ``YouTubeError``); any
    other becomes a ``YouTubeError`` with the *what* context."""

    def deco(fn: _F) -> _F:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return fn(*args, **kwargs)
            except HttpError as err:
                raise YouTubeError(f"{what}: {err.message}", **err.details) from err
            except TubeError:
                raise
            except Exception as err:  # noqa: BLE001 - contract: never a loose exception
                raise YouTubeError(
                    f"{what}: YouTube response in an unexpected format "
                    f"({type(err).__name__}: {err})"
                ) from err

        return wrapper  # type: ignore[return-value]

    return deco


def _status_error(what: str, resp: HttpResponse) -> YouTubeError:
    status = resp.status
    if status == 404:
        reason = "not found (HTTP 404)"
    elif status == 410:
        reason = "removed (HTTP 410)"
    elif status == 429:
        reason = "YouTube throttled the requests (HTTP 429); try again later"
    elif status >= 500:
        reason = f"YouTube unavailable (HTTP {status})"
    else:
        reason = f"unexpected response (HTTP {status})"
    return YouTubeError(f"{what}: {reason}", status=status, url=resp.url)


def is_feed_outage(err: BaseException) -> bool:
    """``True`` if *err* is the RSS (or another source) answering 404/5xx: the feed server is
    down, **not** a missing channel. Network error/timeout (no status) → ``False``."""
    details = _error_details(err)
    if details.get("channel_missing"):
        return False
    status = details.get("status")
    return isinstance(status, int) and (status == 404 or 500 <= status <= 599)


def is_channel_missing(err: BaseException) -> bool:
    """``True`` only when the channel **page** said it does not exist (404 or alert)."""
    return _error_details(err).get("channel_missing") is True


def _error_details(err: BaseException) -> Mapping[str, Any]:
    details = getattr(err, "details", None) if isinstance(err, YouTubeError) else None
    return details if isinstance(details, Mapping) else {}


def _check_consent(what: str, resp: HttpResponse) -> None:
    host = (urlsplit(resp.url).hostname or "").lower()
    if host.startswith("consent."):
        raise YouTubeError(
            f"{what}: YouTube asked for the cookie consent page instead of the content",
            url=resp.url,
        )


# --------------------------------------------------------------------------------------------
# Input validation
# --------------------------------------------------------------------------------------------


def _require_channel_id(channel_id: Any) -> str:
    if not isinstance(channel_id, str) or not dedup.is_channel_id(channel_id.strip()):
        raise ValidationError(
            f"invalid channel id: {channel_id!r} (expected UC + 22 characters)",
            field="channel_id",
        )
    return channel_id.strip()


def _require_video_id(video_id: Any) -> str:
    if not isinstance(video_id, str) or not dedup.is_video_id(video_id.strip()):
        raise ValidationError(
            f"invalid video id: {video_id!r} (expected 11 characters)", field="video_id"
        )
    return video_id.strip()


# --------------------------------------------------------------------------------------------
# JSON embedded in pages
# --------------------------------------------------------------------------------------------


def extract_json_var(text: str, name: str) -> Any | None:
    """First JSON object assigned to *name* in a page (``var x = {…}``,
    ``window["x"] = {…}``, ``x = {…}``); ``None`` if there is none that decodes."""
    pattern = re.compile(rf"""(?:\bvar\s+|window\[["']|\b){re.escape(name)}["']?\]?\s*=\s*""")
    decoder = json.JSONDecoder()
    for match in pattern.finditer(text):
        start = match.end()
        if start >= len(text) or text[start] != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text, start)
        except ValueError:
            continue
        return value
    return None


def extract_initial_data(text: str) -> dict[str, Any]:
    """``ytInitialData`` of an HTML page (or the JSON itself); missing → ``YouTubeError``."""
    stripped = text.lstrip()
    if stripped.startswith("{"):
        try:
            data = json.loads(stripped)
        except ValueError as err:
            raise YouTubeError(f"page JSON unreadable: {err}") from err
    else:
        data = extract_json_var(text, "ytInitialData")
        if data is None:
            raise YouTubeError("page without ytInitialData (YouTube changed the format or blocked)")
    if not isinstance(data, dict):
        raise YouTubeError("ytInitialData is not an object")
    return data


def _iter_key(node: Any, key: str) -> Iterator[Any]:
    """Values of *key* at any depth, in document order (no recursion)."""
    stack: list[Any] = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            if key in cur:
                yield cur[key]
            stack.extend(reversed(list(cur.values())))
        elif isinstance(cur, list):
            stack.extend(reversed(cur))


def _get(node: Any, *path: str | int) -> Any:
    """Tolerant path: ``None`` at the first step that does not exist."""
    cur = node
    for step in path:
        if isinstance(step, int):
            if not isinstance(cur, list) or not -len(cur) <= step < len(cur):
                return None
            cur = cur[step]
        else:
            if not isinstance(cur, dict):
                return None
            cur = cur.get(step)
    return cur


def _text(node: Any) -> str | None:
    """Text of ``{"simpleText"}``, ``{"runs": [...]}`` or ``{"content"}`` (new format)."""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return None
    for key in ("simpleText", "content"):
        value = node.get(key)
        if isinstance(value, str):
            return value
    runs = node.get("runs")
    if isinstance(runs, list):
        out = "".join(str(r.get("text", "")) for r in runs if isinstance(r, dict))
        return out or None
    return None


def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    text = text.strip()
    return text or None


# --------------------------------------------------------------------------------------------
# Texts: duration, count, relative age
# --------------------------------------------------------------------------------------------

_DURATION_RE = re.compile(r"\d{1,3}(?::[0-5]\d){1,2}")


def parse_duration(text: str | None) -> int | None:
    """``"3:05:04"`` → 11104; ``"SHORTS"``, ``"LIVE"``, empty → ``None``."""
    if not isinstance(text, str):
        return None
    value = text.strip()
    if not _DURATION_RE.fullmatch(value):
        return None
    total = 0
    for part in value.split(":"):
        total = total * 60 + int(part)
    return total


_ZERO_COUNT_RE = re.compile(r"^\s*(?:no|nenhuma?|sem)\b", re.IGNORECASE)
_LIVE_COUNT_RE = re.compile(r"watching|assistindo|aguardando|waiting", re.IGNORECASE)
_COUNT_RE = re.compile(
    r"(\d[\d.,\u00a0\u202f ]*)\s*(k|m|b|mil|mi|bi|mil\.|mi\.|bi\.)?(?![a-z])",
    re.IGNORECASE,
)
_COUNT_SUFFIX = {
    "k": 1_000,
    "m": 1_000_000,
    "b": 1_000_000_000,
    "mil": 1_000,
    "mi": 1_000_000,
    "bi": 1_000_000_000,
}


def parse_count(text: str | None) -> int | None:
    """Views: ``"676,779 views"``, ``"10.472.419 visualizações"``, ``"509K"``,
    ``"94 mil"``, ``"1,5 mi"``; ``"No views"`` → 0; live (``"watching"``) and unreadable →
    ``None``."""
    if not isinstance(text, str) or not text.strip():
        return None
    if _LIVE_COUNT_RE.search(text):
        return None
    if _ZERO_COUNT_RE.search(text):
        return 0
    match = _COUNT_RE.search(text)
    if match is None:
        return None
    number = re.sub(r"[\s\u00a0\u202f]", "", match.group(1)).rstrip(".,")
    suffix = (match.group(2) or "").lower().rstrip(".")
    if not number:
        return None
    if suffix:
        try:
            value = float(number.replace(",", "."))
        except ValueError:
            return None
        return int(round(value * _COUNT_SUFFIX[suffix]))
    digits = re.sub(r"\D", "", number)
    return int(digits) if digits else None


_UNIT_SECONDS = {
    "second": 1,
    "minute": 60,
    "hour": 3_600,
    "day": 86_400,
    "week": 7 * 86_400,
    "month": 30 * 86_400,
    "year": 365 * 86_400,
}
_UNIT_ALIASES = {
    "s": "second",
    "sec": "second",
    "secs": "second",
    "second": "second",
    "seconds": "second",
    "segundo": "second",
    "segundos": "second",
    "m": "minute",
    "min": "minute",
    "mins": "minute",
    "minute": "minute",
    "minutes": "minute",
    "minuto": "minute",
    "minutos": "minute",
    "h": "hour",
    "hr": "hour",
    "hrs": "hour",
    "hour": "hour",
    "hours": "hour",
    "hora": "hour",
    "horas": "hour",
    "d": "day",
    "day": "day",
    "days": "day",
    "dia": "day",
    "dias": "day",
    "w": "week",
    "wk": "week",
    "wks": "week",
    "week": "week",
    "weeks": "week",
    "semana": "week",
    "semanas": "week",
    "mo": "month",
    "mos": "month",
    "month": "month",
    "months": "month",
    "mes": "month",
    "meses": "month",
    "y": "year",
    "yr": "year",
    "yrs": "year",
    "year": "year",
    "years": "year",
    "ano": "year",
    "anos": "year",
}
_AGO_EN_RE = re.compile(r"(\d+)\s*([a-z]+)\s+ago\b", re.IGNORECASE)
_AGO_PT_RE = re.compile(r"\bha\s+(\d+)\s*([a-z]+)", re.IGNORECASE)


def _ascii_fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def parse_relative_time(text: str | None, now: Timestamp) -> Timestamp | None:
    """Age as YouTube shows it → approximate instant (month = 30 days, year = 365).

    English (``"2y ago"``, ``"3 days ago"``, ``"Streamed 1 hour ago"``) and Portuguese
    (``"há 6 anos"``, ``"Transmitido há 2 dias"``); anything else → ``None``.
    """
    if not isinstance(text, str) or not text.strip():
        return None
    folded = _ascii_fold(text)
    match = _AGO_EN_RE.search(folded) or _AGO_PT_RE.search(folded)
    if match is None:
        return None
    unit = _UNIT_ALIASES.get(match.group(2).lower())
    if unit is None:
        return None
    return int(now) - int(match.group(1)) * _UNIT_SECONDS[unit]


# --------------------------------------------------------------------------------------------
# RSS
# --------------------------------------------------------------------------------------------


def _iso_ts(text: str | None) -> Timestamp | None:
    if not text:
        return None
    try:
        return int(datetime.fromisoformat(text.strip().replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def _feed_channel_id(raw: str | None) -> str | None:
    value = (raw or "").strip()
    if len(value) == 22 and not value.startswith("UC"):
        value = "UC" + value  # the feed carries the id without the prefix
    return value if dedup.is_channel_id(value) else None


def parse_rss(xml_text: str, channel_id: str | None = None) -> RssFeed:
    """Channel RSS (Atom) → ``RssFeed`` with up to 15 videos, newest first.

    *channel_id* (the request) applies when the feed has no readable id. XML with a DTD is refused.
    """
    if not isinstance(xml_text, str) or not xml_text.strip():
        raise YouTubeError("empty RSS")
    if _DTD_RE.search(xml_text):
        raise YouTubeError("RSS refused: contains a DTD/ENTITY declaration")
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as err:
        raise YouTubeError(f"RSS unreadable: {err}") from err
    if root.tag != f"{_ATOM}feed":
        raise YouTubeError("the response is not a YouTube Atom feed")

    link = root.find(f"{_ATOM}link[@rel='alternate']")
    link_href = link.get("href") if link is not None else None
    author_uri = root.findtext(f"{_ATOM}author/{_ATOM}uri")
    cid = _feed_channel_id(root.findtext(f"{_YT}channelId"))
    if cid is None:
        for candidate in (link_href, author_uri):
            found = _CHANNEL_ID_RE.search(candidate or "")
            if found:
                cid = found.group(0)
                break
    if cid is None and channel_id and dedup.is_channel_id(channel_id):
        cid = channel_id
    if cid is None:
        raise YouTubeError("RSS without a channel id")
    title = _clean(root.findtext(f"{_ATOM}title")) or _clean(
        root.findtext(f"{_ATOM}author/{_ATOM}name")
    )
    channel = ChannelInfo(
        id=cid,
        title=title or "",
        url=link_href or author_uri or f"{BASE_URL}/channel/{cid}",
    )

    videos: list[VideoIn] = []
    for entry in root.findall(f"{_ATOM}entry"):
        vid = (entry.findtext(f"{_YT}videoId") or "").strip()
        if not dedup.is_video_id(vid):
            continue
        entry_cid = _feed_channel_id(entry.findtext(f"{_YT}channelId")) or cid
        group = entry.find(f"{_MEDIA}group")
        description = None
        views = None
        if group is not None:
            description = group.findtext(f"{_MEDIA}description") or None
            stats = group.find(f"{_MEDIA}community/{_MEDIA}statistics")
            raw_views = (stats.get("views") or "").strip() if stats is not None else ""
            views = int(raw_views) if raw_views.isdigit() else None
        entry_link = entry.find(f"{_ATOM}link[@rel='alternate']")
        href = (entry_link.get("href") or "") if entry_link is not None else ""
        videos.append(
            VideoIn(
                id=vid,
                channel_id=entry_cid,
                title=(entry.findtext(f"{_ATOM}title") or "").strip(),
                published_at=_iso_ts(entry.findtext(f"{_ATOM}published")),
                description=description,
                channel_title=title,
                views=views,
                is_short=True if "/shorts/" in href else None,
            )
        )
    videos.sort(key=lambda v: v.published_at if v.published_at is not None else -1, reverse=True)
    return RssFeed(channel=channel, videos=tuple(videos[:RSS_MAX_VIDEOS]))


# --------------------------------------------------------------------------------------------
# Channel page
# --------------------------------------------------------------------------------------------


def _pick_image(sources: Any) -> str | None:
    """URL of the image closest to ``AVATAR_TARGET_PX`` (list of ``{url, width}``)."""
    if not isinstance(sources, list):
        return None
    best: tuple[int, str] | None = None
    for item in sources:
        url = _get(item, "url")
        if not isinstance(url, str) or not url:
            continue
        width = _get(item, "width")
        score = abs(int(width) - AVATAR_TARGET_PX) if isinstance(width, int) else 10_000
        if best is None or score < best[0]:
            best = (score, url)
    if best is None:
        return None
    url = best[1]
    return "https:" + url if url.startswith("//") else url


def _handle_from(text: Any) -> str | None:
    """``@Handle`` (display form) from a ``…/@Handle`` URL or a ``@Handle`` text."""
    if not isinstance(text, str):
        return None
    value = text.strip()
    if "/" in value:
        segments = [s for s in urlsplit(value).path.split("/") if s]
        value = segments[0] if segments else ""
    if not value.startswith("@"):
        return None
    return value if dedup.normalize_handle(value) else None


def parse_channel_page(html: str) -> ChannelInfo:
    """Channel page (``/@handle``, ``/channel/``, ``/c/``, ``/user/``) → ``ChannelInfo``."""
    return _channel_info_from_data(extract_initial_data(html))


def _channel_info_from_data(data: Mapping[str, Any]) -> ChannelInfo:
    meta = _get(data, "metadata", "channelMetadataRenderer")
    meta = meta if isinstance(meta, dict) else {}
    header = _get(data, "header")
    c4 = _get(header, "c4TabbedHeaderRenderer")
    c4 = c4 if isinstance(c4, dict) else {}
    phvm = _get(header, "pageHeaderRenderer", "content", "pageHeaderViewModel")
    phvm = phvm if isinstance(phvm, dict) else {}

    candidates = [
        meta.get("externalId"),
        c4.get("channelId"),
        _get(data, "microformat", "microformatDataRenderer", "urlCanonical"),
        meta.get("channelUrl"),
    ]
    channel_id = None
    for candidate in candidates:
        if isinstance(candidate, str):
            found = _CHANNEL_ID_RE.search(candidate)
            if found and dedup.is_channel_id(found.group(0)):
                channel_id = found.group(0)
                break
    if channel_id is None:
        raise YouTubeError("channel page without a channel id (unknown format)")

    title = (
        _clean(meta.get("title") if isinstance(meta.get("title"), str) else None)
        or _clean(_text(_get(phvm, "title", "dynamicTextViewModel", "text")))
        or _clean(c4.get("title") if isinstance(c4.get("title"), str) else None)
        or _clean(_get(header, "pageHeaderRenderer", "pageTitle"))
    )
    if not title:
        raise YouTubeError(f"channel page {channel_id} without a title")

    handle = _handle_from(meta.get("vanityChannelUrl"))
    if handle is None:
        for part in _iter_key(_get(phvm, "metadata"), "text"):
            handle = _handle_from(_text(part))
            if handle:
                break
    if handle is None:
        handle = _handle_from(_text(c4.get("channelHandleText")))
    if handle is None:
        owner_urls = meta.get("ownerUrls")
        if isinstance(owner_urls, list):
            handle = next((h for h in map(_handle_from, owner_urls) if h), None)

    avatar_vm = _get(phvm, "image", "decoratedAvatarViewModel", "avatar", "avatarViewModel")
    thumb = (
        _pick_image(_get(avatar_vm, "image", "sources"))
        or _pick_image(_get(c4, "avatar", "thumbnails"))
        or _pick_image(_get(meta, "avatar", "thumbnails"))
    )
    return ChannelInfo(
        id=channel_id,
        title=title,
        handle=handle,
        thumb=thumb,
        url=f"{BASE_URL}/channel/{channel_id}",
    )


# --------------------------------------------------------------------------------------------
# Channel /videos page (RSS plan B)
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ChannelPageFeed(RssFeed):
    """``RssFeed`` read from the ``/channel/<id>/videos`` page: same type, but ``published_at`` is
    **approximate** (relative text "3 days ago" → instant; month = 30 days, year = 365). The
    writer does not let an approximate date overwrite one already stored; the RSS, once back,
    overwrites the approximate one with the exact one (``VideoStore.upsert`` rule)."""

    approximate_dates: bool = True
    source: str = "channel_page"


def dates_are_approximate(feed: Any) -> bool:
    """``True`` for plan B feeds (approximate dates); ``False`` for the RSS."""
    return bool(getattr(feed, "approximate_dates", False))


def _page_error_alert(data: Mapping[str, Any]) -> str | None:
    """Text of the ERROR alert of a page without content (missing/terminated channel)."""
    if _get(data, "contents") is not None:
        return None
    for alert in _iter_key(_get(data, "alerts"), "alertRenderer"):
        if isinstance(alert, dict) and str(alert.get("type", "")).upper() == "ERROR":
            return _clean(_text(alert.get("text"))) or "YouTube error"
    return None


def _selected_videos_tab(data: Mapping[str, Any]) -> Any | None:
    """Content of the selected **Videos** tab; ``None`` if the page served another tab (a channel
    without long videos falls back to Home, and Home carries videos from other channels)."""
    tabs = _get(data, "contents", "twoColumnBrowseResultsRenderer", "tabs")
    for tab in tabs if isinstance(tabs, list) else []:
        renderer = _get(tab, "tabRenderer")
        if not isinstance(renderer, dict) or not renderer.get("selected"):
            continue
        url = _get(renderer, "endpoint", "commandMetadata", "webCommandMetadata", "url")
        title = str(renderer.get("title") or "").strip().lower()
        if (isinstance(url, str) and url.rstrip("/").endswith("/videos")) or title in (
            "videos",
            "vídeos",
        ):
            return renderer.get("content")
        return None
    return None


def _iter_upload_renderers(node: Any) -> Iterator[tuple[str, Any]]:
    """``(kind, renderer)`` of grid videos in document order: ``lockupViewModel`` (current),
    ``videoRenderer`` inside ``richItemRenderer`` and ``gridVideoRenderer`` (old)."""
    stack: list[Any] = [node]
    keys = ("lockupViewModel", "videoRenderer", "gridVideoRenderer")
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            found = False
            for key in keys:
                if key in cur:
                    yield key, cur[key]
                    found = True
            if not found:
                stack.extend(reversed(list(cur.values())))
        elif isinstance(cur, list):
            stack.extend(reversed(cur))


_VIEWS_LABEL_RE = re.compile(r"views?\b|visualiza", re.IGNORECASE)


def _lockup_upload(lvm: Any, *, now: Timestamp, channel: ChannelInfo) -> VideoIn | None:
    if not isinstance(lvm, dict) or lvm.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO":
        return None
    vid = lvm.get("contentId")
    if not isinstance(vid, str) or not dedup.is_video_id(vid):
        return None
    meta = _get(lvm, "metadata", "lockupMetadataViewModel")
    rows = _get(meta, "metadata", "contentMetadataViewModel", "metadataRows")
    views: int | None = None
    published: Timestamp | None = None
    for row in rows if isinstance(rows, list) else []:
        parts = _get(row, "metadataParts")
        for part in parts if isinstance(parts, list) else []:
            text = _clean(_text(_get(part, "text"))) or ""
            label = _get(part, "accessibilityLabel")
            label = label if isinstance(label, str) else ""
            if published is None:
                published = parse_relative_time(text, now) or parse_relative_time(label, now)
                if published is not None:
                    continue
            is_views = (
                _get(part, "leadingIcon") is not None
                or _VIEWS_LABEL_RE.search(label)
                or _VIEWS_LABEL_RE.search(text)
            )
            if views is None and is_views and not _LIVE_COUNT_RE.search(f"{text} {label}"):
                views = parse_count(text)
    duration = None
    for badge in _iter_key(_get(lvm, "contentImage"), "thumbnailBadgeViewModel"):
        duration = parse_duration(_text(_get(badge, "text")))
        if duration is not None:
            break
    return VideoIn(
        id=vid,
        channel_id=channel.id,
        title=(_text(_get(meta, "title")) or "").strip(),
        published_at=published,
        channel_title=channel.title or None,
        views=views,
        duration_s=duration,
    )


def _renderer_upload(vr: Any, *, now: Timestamp, channel: ChannelInfo) -> VideoIn | None:
    hit = _video_renderer_hit(vr, now, channel.id)
    if hit is None:
        return None
    return VideoIn(
        id=hit.video_id,
        channel_id=channel.id,  # the /videos grid only has the channel's uploads (collabs included)
        title=hit.title,
        published_at=hit.published_at,
        channel_title=channel.title or None,
        views=hit.views,
        duration_s=hit.duration_s,
    )


def parse_channel_uploads(
    payload: Mapping[str, Any] | str, *, now: Timestamp, channel_id: str | None = None
) -> ChannelPageFeed:
    """``/channel/<id>/videos`` page (HTML, JSON or the already decoded ``ytInitialData``) →
    ``ChannelPageFeed`` with up to 15 videos, newest first (undated last).

    Missing channel (page with ERROR ``alerts`` and no content) → ``YouTubeError`` with
    ``status=404`` and ``channel_missing=True``. A *channel_id* different from the page's → error.
    """
    if isinstance(payload, str):
        data: Mapping[str, Any] = extract_initial_data(payload)
    elif isinstance(payload, Mapping):
        data = payload
    else:
        raise YouTubeError(f"videos page of unexpected type: {type(payload).__name__}")
    alert = _page_error_alert(data)
    if alert is not None:
        raise YouTubeError(
            f"channel does not exist on YouTube ({alert})",
            status=404,
            channel_missing=True,
            channel_id=channel_id,
        )
    channel = _channel_info_from_data(data)
    if channel_id is not None and channel.id != channel_id:
        raise YouTubeError(
            f"the page returned another channel ({channel.id}) instead of {channel_id}",
            channel_id=channel_id,
        )
    content = _selected_videos_tab(data)
    videos: list[VideoIn] = []
    seen: set[str] = set()
    for kind, renderer in _iter_upload_renderers(content) if content is not None else ():
        if kind == "lockupViewModel":
            video = _lockup_upload(renderer, now=now, channel=channel)
        else:
            video = _renderer_upload(renderer, now=now, channel=channel)
        if video is None or video.id in seen:
            continue
        seen.add(video.id)
        videos.append(video)
    videos.sort(key=lambda v: v.published_at if v.published_at is not None else -1, reverse=True)
    return ChannelPageFeed(channel=channel, videos=tuple(videos[:RSS_MAX_VIDEOS]))


# --------------------------------------------------------------------------------------------
# Channel uploads playlists (duration and kind of every video)
# --------------------------------------------------------------------------------------------


def uploads_playlist_id(channel_id: str, *, shorts: bool = False) -> str:
    """The channel's automatic uploads playlist: ``UU…`` (all, newest first) or ``UUSH…``
    (Shorts only). Invalid channel id → ``ValidationError``."""
    cid = _require_channel_id(channel_id)
    return ("UUSH" if shorts else "UU") + cid[2:]


@dataclass(frozen=True, slots=True)
class PlaylistPage:
    """First page of a playlist (up to 100 items, in page order).

    ``exists=False``: YouTube answered "The playlist does not exist." (HTTP 200 with an alert) —
    on ``UUSH…`` it is a channel **without Shorts** (measured on 2026-11-10 on a real channel).
    ``durations`` only has the items that carried the duration badge (Shorts included on
    ``UU…``; ``UUSH…`` carries no duration).
    """

    playlist_id: str
    exists: bool
    video_ids: tuple[str, ...] = ()
    durations: Mapping[str, int] = field(default_factory=dict)


def _reel_video_id(node: Any) -> str | None:
    for endpoint in _iter_key(node, "reelWatchEndpoint"):
        vid = _get(endpoint, "videoId")
        if isinstance(vid, str) and dedup.is_video_id(vid):
            return vid
    entity = _get(node, "entityId")
    if isinstance(entity, str):
        tail = entity.rsplit("-", 1)[-1] if entity.startswith("shorts-shelf-item-") else ""
        if dedup.is_video_id(tail):
            return tail
    return None


def _iter_playlist_items(node: Any) -> Iterator[tuple[str, int | None]]:
    """``(video_id, duration)`` in document order: ``lockupViewModel`` (current),
    ``shortsLockupViewModel`` (Shorts), ``playlistVideoRenderer`` and ``reelItemRenderer``
    (old)."""
    keys = (
        "lockupViewModel",
        "shortsLockupViewModel",
        "playlistVideoRenderer",
        "reelItemRenderer",
    )
    stack: list[Any] = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, list):
            stack.extend(reversed(cur))
            continue
        if not isinstance(cur, dict):
            continue
        key = next((k for k in keys if k in cur), None)
        if key is None:
            stack.extend(reversed(list(cur.values())))
            continue
        item = cur[key]
        if key == "lockupViewModel":
            if not isinstance(item, dict) or item.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO":
                continue
            vid = item.get("contentId")
            duration = None
            for badge in _iter_key(_get(item, "contentImage"), "thumbnailBadgeViewModel"):
                duration = parse_duration(_text(_get(badge, "text")))
                if duration is not None:
                    break
        elif key == "playlistVideoRenderer":
            vid = _get(item, "videoId")
            raw = _get(item, "lengthSeconds")
            raw = str(raw).strip() if raw is not None else ""
            duration = int(raw) if raw.isdigit() and int(raw) > 0 else None
            if duration is None:
                duration = parse_duration(_text(_get(item, "lengthText")))
        elif key == "shortsLockupViewModel":
            vid, duration = _reel_video_id(item), None
        else:
            vid, duration = _get(item, "videoId"), None
        if isinstance(vid, str) and dedup.is_video_id(vid):
            yield vid, duration


def parse_playlist_page(
    payload: Mapping[str, Any] | str, *, playlist_id: str | None = None
) -> PlaylistPage:
    """``/playlist?list=…`` page (HTML, JSON or ``ytInitialData``) → ``PlaylistPage``.

    ERROR alert without content ("The playlist does not exist.") → ``exists=False`` (not an
    error); no ``contents`` and no alert → ``YouTubeError`` (unknown format or blocked).
    """
    if isinstance(payload, str):
        data: Mapping[str, Any] = extract_initial_data(payload)
    elif isinstance(payload, Mapping):
        data = payload
    else:
        raise YouTubeError(f"playlist page of unexpected type: {type(payload).__name__}")
    pid = playlist_id or ""
    if _page_error_alert(data) is not None:
        return PlaylistPage(playlist_id=pid, exists=False)
    contents = _get(data, "contents")
    if not isinstance(contents, dict):
        raise YouTubeError("playlist page without content (did YouTube change the format?)")
    ids: list[str] = []
    durations: dict[str, int] = {}
    for vid, duration in _iter_playlist_items(contents):
        if vid not in durations and duration is not None:
            durations[vid] = duration
        if vid not in ids:
            ids.append(vid)
    return PlaylistPage(playlist_id=pid, exists=True, video_ids=tuple(ids), durations=durations)


def parse_short_length(html: str) -> int | None:
    """Duration (s) on the ``/shorts/<id>`` page (``ytInitialPlayerResponse.videoDetails``);
    without it → ``None`` (the 200 page already proves it is a Short)."""
    player = extract_json_var(html, "ytInitialPlayerResponse")
    raw = _get(player, "videoDetails", "lengthSeconds") if isinstance(player, dict) else None
    raw = str(raw).strip() if raw is not None else ""
    return int(raw) if raw.isdigit() and int(raw) > 0 else None


# --------------------------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------------------------


def _browse_channel_id(node: Any) -> str | None:
    for browse_id in _iter_key(node, "browseId"):
        if isinstance(browse_id, str) and dedup.is_channel_id(browse_id):
            return browse_id
    return None


def _video_renderer_hit(
    vr: Any, now: Timestamp, default_channel_id: str | None
) -> SearchHit | None:
    if not isinstance(vr, dict):
        return None
    vid = vr.get("videoId")
    if not isinstance(vid, str) or not dedup.is_video_id(vid):
        return None
    owner = vr.get("ownerText") or vr.get("longBylineText") or vr.get("shortBylineText")
    channel_id = (
        _browse_channel_id(owner)
        or _browse_channel_id(vr.get("channelThumbnailSupportedRenderers"))
        or default_channel_id
    )
    if channel_id is None:
        return None  # without an owner the video cannot be stored; we do not invent a channel
    length = _text(vr.get("lengthText"))
    if length is None:
        for overlay in _iter_key(vr.get("thumbnailOverlays"), "thumbnailOverlayTimeStatusRenderer"):
            length = _text(_get(overlay, "text"))
            if length:
                break
    published_text = _clean(_text(vr.get("publishedTimeText")))
    snippet = _text(_get(vr, "detailedMetadataSnippets", 0, "snippetText"))
    views = parse_count(_text(vr.get("viewCountText")))
    if views is None and not _LIVE_COUNT_RE.search(_text(vr.get("viewCountText")) or ""):
        views = parse_count(_text(vr.get("shortViewCountText")))
    return SearchHit(
        video_id=vid,
        title=(_text(vr.get("title")) or "").strip(),
        channel_id=channel_id,
        channel_title=_clean(_text(owner)),
        duration_s=parse_duration(length),
        views=views,
        published_text=published_text,
        published_at=parse_relative_time(published_text, now),
        description=_clean(snippet) or _clean(_text(vr.get("descriptionSnippet"))),
    )


def _lockup_hit(lvm: Any, now: Timestamp, default_channel_id: str | None) -> SearchHit | None:
    if not isinstance(lvm, dict) or lvm.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO":
        return None
    vid = lvm.get("contentId")
    if not isinstance(vid, str) or not dedup.is_video_id(vid):
        return None
    meta = _get(lvm, "metadata", "lockupMetadataViewModel")
    rows = _get(meta, "metadata", "contentMetadataViewModel", "metadataRows")
    channel_id = _browse_channel_id(rows) or default_channel_id
    if channel_id is None:
        return None
    channel_title = None
    views = None
    published_text = None
    for row in rows if isinstance(rows, list) else []:
        parts = _get(row, "metadataParts")
        for part in parts if isinstance(parts, list) else []:
            text = _clean(_text(_get(part, "text")))
            if not text:
                continue
            if _browse_channel_id(part) and channel_title is None:
                channel_title = text
            elif parse_relative_time(text, now) is not None and published_text is None:
                published_text = text
            elif re.search(r"views?|visualiza|watching|assistindo", text, re.IGNORECASE):
                views = parse_count(text)
    duration = None
    for badge in _iter_key(_get(lvm, "contentImage"), "thumbnailBadgeViewModel"):
        duration = parse_duration(_text(_get(badge, "text")))
        if duration is not None:
            break
    return SearchHit(
        video_id=vid,
        title=(_text(_get(meta, "title")) or "").strip(),
        channel_id=channel_id,
        channel_title=channel_title,
        duration_s=duration,
        views=views,
        published_text=published_text,
        published_at=parse_relative_time(published_text, now),
    )


def _iter_renderers(node: Any) -> Iterator[tuple[str, Any]]:
    """``(kind, renderer)`` of ``videoRenderer`` and ``lockupViewModel`` in document order."""
    stack: list[Any] = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            for key in ("videoRenderer", "lockupViewModel"):
                if key in cur:
                    yield key, cur[key]
            stack.extend(reversed(list(cur.values())))
        elif isinstance(cur, list):
            stack.extend(reversed(cur))


_INITIAL_DATA_KEYS = ("contents", "onResponseReceivedCommands", "onResponseReceivedActions")


def _coerce_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, Mapping) and "ytInitialData" in payload:
        payload = payload["ytInitialData"]
    if isinstance(payload, str):
        return extract_initial_data(payload)
    if isinstance(payload, Mapping):
        data = dict(payload)
        if not any(key in data for key in _INITIAL_DATA_KEYS):
            raise YouTubeError("payload does not look like a search ytInitialData (no 'contents')")
        return data
    raise YouTubeError(f"search payload of unexpected type: {type(payload).__name__}")


def parse_search_payload(
    payload: Mapping[str, Any] | str,
    *,
    now: Timestamp,
    default_channel_id: str | None = None,
) -> list[SearchHit]:
    """Search ``ytInitialData`` (``dict``, JSON, HTML or ``{"ytInitialData": …}``) → videos.

    No duplicates, in page order. Shorts, channels and playlists are left out; so is a video
    without an identifiable channel, unless *default_channel_id* (a channel's ``/videos`` page).
    """
    data = _coerce_payload(payload)
    if default_channel_id is not None and not dedup.is_channel_id(default_channel_id):
        default_channel_id = None
    hits: list[SearchHit] = []
    seen: set[str] = set()
    for kind, renderer in _iter_renderers(data):
        if kind == "videoRenderer":
            hit = _video_renderer_hit(renderer, now, default_channel_id)
        else:
            hit = _lockup_hit(renderer, now, default_channel_id)
        if hit is None or hit.video_id in seen:
            continue
        seen.add(hit.video_id)
        hits.append(hit)
    return hits


_PT_HINT_RE = re.compile(r"[ãõçâêôáéíóúà]", re.IGNORECASE)
_PT_WORDS = frozenset(
    "de do da dos das para como com sem que não nao uma um em no na pelo pela receita "
    "aula curso melhor melhores".split()
)


def _looks_portuguese(query: str) -> bool:
    if _PT_HINT_RE.search(query):
        return True
    words = re.findall(r"[a-zà-ú]+", query.lower())
    return sum(1 for w in words if w in _PT_WORDS) >= 1 and len(words) >= 2


def _search_language(settings: Settings | None, query: str) -> str:
    """``pt`` or ``en`` for the search: the ``language`` setting (``pt*``/``en*``) or, under
    ``auto``, the apparent language of the query."""
    lang = "auto"
    if settings is not None:
        try:
            value = settings.get("language", "auto")
        except Exception:  # noqa: BLE001 - an unreadable setting does not block the search
            value = "auto"
        if isinstance(value, str) and value.strip():
            lang = value.strip().lower()
    if lang.startswith("pt"):
        return "pt"
    if lang.startswith("en"):
        return "en"
    return "pt" if _looks_portuguese(query) else "en"


# --------------------------------------------------------------------------------------------
# Video page
# --------------------------------------------------------------------------------------------


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return False


def _player_response(html: str) -> dict[str, Any]:
    data = extract_json_var(html, "ytInitialPlayerResponse")
    if not isinstance(data, dict):
        raise YouTubeError("video page without ytInitialPlayerResponse")
    return data


def parse_video_page(html: str, video_id: str) -> VideoDetails:
    """``/watch`` page → ``VideoDetails``. Live and scheduled: ``duration_s=None``."""
    player = _player_response(html)
    details = player.get("videoDetails")
    if not isinstance(details, dict):
        reason = _text(_get(player, "playabilityStatus", "reason")) or _get(
            player, "playabilityStatus", "status"
        )
        suffix = f": {reason}" if reason else ""
        raise YouTubeError(f"video {video_id} unavailable{suffix}", video_id=video_id)
    page_id = details.get("videoId")
    if isinstance(page_id, str) and page_id and page_id != video_id:
        raise YouTubeError(
            f"the page returned another video ({page_id}) instead of {video_id}", video_id=video_id
        )
    live_details = _get(player, "microformat", "playerMicroformatRenderer", "liveBroadcastDetails")
    is_upcoming = _as_bool(details.get("isUpcoming"))
    is_live = not is_upcoming and (
        _as_bool(details.get("isLive")) or _as_bool(_get(live_details, "isLiveNow"))
    )
    raw_length = details.get("lengthSeconds")
    if raw_length is None:
        raw_length = _get(player, "microformat", "playerMicroformatRenderer", "lengthSeconds")
    length = str(raw_length).strip() if raw_length is not None else ""
    if length and not length.isdigit():
        raise YouTubeError(f"unreadable duration for {video_id}: {raw_length!r}", video_id=video_id)
    duration = int(length) if length else None
    if is_live or is_upcoming or not duration:
        duration = None
    channel_id = details.get("channelId")
    title = details.get("title")
    return VideoDetails(
        video_id=video_id,
        duration_s=duration,
        is_live=is_live,
        is_upcoming=is_upcoming,
        title=title if isinstance(title, str) and title else None,
        channel_id=channel_id
        if isinstance(channel_id, str) and dedup.is_channel_id(channel_id)
        else None,
    )


# --------------------------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------------------------


class YouTube:
    """Real ``YouTubeClient`` (see the module docstring)."""

    def __init__(
        self, *, http: HttpClient, settings: Settings | None = None, clock: Clock | None = None
    ) -> None:
        self._http = http
        self._settings = settings
        self._clock = clock if clock is not None else SystemClock()

    # ---------------------------------------------------------------- internals

    def _get(
        self,
        what: str,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
        follow_redirects: bool = True,
    ) -> HttpResponse:
        try:
            resp = self._http.get(
                url, params=params, headers=headers, follow_redirects=follow_redirects
            )
        except HttpError as err:
            raise YouTubeError(f"{what}: {err.message}", **err.details) from err
        if not isinstance(resp, HttpResponse):
            raise YouTubeError(f"{what}: HTTP client returned {type(resp).__name__}")
        return resp

    def _get_ok(self, what: str, url: str, **kwargs: Any) -> HttpResponse:
        resp = self._get(what, url, **kwargs)
        _check_consent(what, resp)
        if resp.status != 200:
            raise _status_error(what, resp)
        return resp

    def _channel_page(self, what: str, url: str) -> ChannelInfo:
        resp = self._get_ok(what, url)
        try:
            return parse_channel_page(resp.text)
        except YouTubeError as err:
            raise YouTubeError(f"{what}: {err.message}", url=url) from err

    def _watch_page(self, what: str, video_id: str) -> str:
        return self._get_ok(what, WATCH_URL, params={"v": video_id}).text

    def _now(self) -> Timestamp:
        return int(self._clock.now())

    # ---------------------------------------------------------------- YouTubeClient

    @_guard("channel RSS")
    def fetch_channel_rss(self, channel_id: str) -> RssFeed:
        cid = _require_channel_id(channel_id)
        what = f"RSS of channel {cid}"
        resp = self._get(what, RSS_URL, params={"channel_id": cid})
        _check_consent(what, resp)
        if resp.status != 200:
            err = _status_error(what, resp)
            if resp.status == 404 or resp.status >= 500:
                # the feed server goes down for hours (404/500 for every channel): it is the feed
                # being down, never proof of a missing channel
                raise YouTubeError(
                    f"{what}: YouTube feed unavailable (HTTP {resp.status})",
                    status=resp.status,
                    url=resp.url,
                    channel_id=cid,
                    feed_unavailable=True,
                )
            raise err
        try:
            return parse_rss(resp.text, channel_id=cid)
        except YouTubeError as err:
            raise YouTubeError(f"{what}: {err.message}", channel_id=cid) from err

    @_guard("channel videos page")
    def fetch_channel_uploads(self, channel_id: str) -> RssFeed:
        """RSS plan B: ``/channel/<id>/videos`` → ``ChannelPageFeed`` (an ``RssFeed`` with
        approximate dates, duration and views; up to 15 videos). A 404 page or one with a missing
        channel alert → ``YouTubeError`` with ``channel_missing=True``. The page weighs ~40× the
        RSS: the caller controls the budget."""
        cid = _require_channel_id(channel_id)
        what = f"videos page of channel {cid}"
        resp = self._get(
            what, CHANNEL_VIDEOS_URL.format(channel_id=cid), params={"hl": "en"}, headers=LANG_EN
        )
        _check_consent(what, resp)
        if resp.status in (404, 410):
            raise YouTubeError(
                f"{what}: channel does not exist on YouTube (HTTP {resp.status})",
                status=404,
                url=resp.url,
                channel_id=cid,
                channel_missing=True,
            )
        if resp.status != 200:
            err = _status_error(what, resp)
            raise YouTubeError(err.message, channel_id=cid, **err.details)
        try:
            return parse_channel_uploads(resp.text, now=self._now(), channel_id=cid)
        except YouTubeError as err:
            raise YouTubeError(
                f"{what}: {err.message}", **{**err.details, "channel_id": cid}
            ) from err

    @_guard("channel uploads playlist")
    def fetch_uploads_playlist(self, channel_id: str, *, shorts: bool = False) -> PlaylistPage:
        """First page of the uploads playlist (``UU…``, 100 items with the duration in the badge,
        Shorts included) or of the Shorts one (``UUSH…``, ids only). "Does not exist" →
        ``exists=False``; HTTP ≠ 200 → ``YouTubeError`` with ``status`` (429 included: the caller
        backs off). The page is as heavy as ``/videos``: the caller controls the budget
        (``core/details``)."""
        pid = uploads_playlist_id(channel_id, shorts=shorts)
        what = f"playlist {pid}"
        resp = self._get_ok(what, PLAYLIST_URL, params={"list": pid, "hl": "en"}, headers=LANG_EN)
        try:
            return parse_playlist_page(resp.text, playlist_id=pid)
        except YouTubeError as err:
            raise YouTubeError(f"{what}: {err.message}", **err.details) from err

    @_guard("Short check")
    def short_details(self, video_id: str) -> tuple[bool, int | None]:
        """``(is_short, duration)`` in a single request — ``/shorts/<id>`` without following
        redirects: 200 = Short (the duration comes in the page itself); 3xx to ``/watch`` =
        regular video (duration ``None``: 0 bytes, whoever needs it asks ``video_details``)."""
        vid = _require_video_id(video_id)
        what = f"Short {vid}"
        resp = self._get(what, f"{BASE_URL}/shorts/{vid}", follow_redirects=False)
        if resp.status == 200:
            _check_consent(what, resp)
            return True, parse_short_length(resp.text)
        return self._short_redirect(what, resp), None

    def _short_redirect(self, what: str, resp: HttpResponse) -> bool:
        if 300 <= resp.status < 400:
            location = next((v for k, v in resp.headers.items() if k.lower() == "location"), "")
            target = urlsplit(location)
            host = (target.hostname or "").lower()
            if target.path.startswith("/watch") and (not host or host.endswith("youtube.com")):
                return False  # regular video: /shorts/<id> → /watch?v=<id>
            raise YouTubeError(
                f"{what}: unexpected redirect (HTTP {resp.status} to {location or 'nowhere'})",
                status=resp.status,
                url=resp.url,
            )
        raise _status_error(what, resp)

    @_guard("resolve channel")
    def resolve_channel(self, url_or_handle: str) -> ChannelInfo:
        ref = dedup.parse_channel_ref(url_or_handle) if isinstance(url_or_handle, str) else None
        if ref is None:
            raise ValidationError(
                f"no YouTube channel recognised in {url_or_handle!r} "
                "(use @handle, the channel link, a UC… id or a video link)",
                field="url_or_handle",
            )
        what = f"channel {url_or_handle.strip()}"
        if ref.kind == "id":
            return self._channel_page(what, f"{BASE_URL}/channel/{ref.value}")
        if ref.kind == "handle":
            return self._channel_page(what, f"{BASE_URL}/{quote(ref.value, safe='@._-')}")
        if ref.kind == "user":
            return self._channel_page(what, f"{BASE_URL}/user/{quote(ref.value, safe='._-')}")
        if ref.kind == "custom":
            name = quote(ref.value, safe="._-")
            try:
                return self._channel_page(what, f"{BASE_URL}/c/{name}")
            except YouTubeError as err:
                if err.details.get("status") != 404:
                    raise
            # /c/<name> may be dead (e.g. /c/kurzgesagt → 404); try the legacy vanity /<name>
            try:
                return self._channel_page(what, f"{BASE_URL}/{name}")
            except YouTubeError as err:
                if err.details.get("status") == 404:
                    raise YouTubeError(
                        f"{what}: channel not found (HTTP 404 on /c/{name} and /{name}); "
                        "try the @handle or the /channel/UC… link",
                        status=404,
                    ) from err
                raise
        # video link: the owner comes from the video page
        html = self._watch_page(what, ref.value)
        details = parse_video_page(html, ref.value)
        if details.channel_id is None:
            raise YouTubeError(f"{what}: video page without the channel id")
        try:
            return self._channel_page(what, f"{BASE_URL}/channel/{details.channel_id}")
        except YouTubeError:
            author = _get(_player_response(html), "videoDetails", "author")
            if not isinstance(author, str) or not author.strip():
                raise
            return ChannelInfo(
                id=details.channel_id,
                title=author.strip(),
                url=f"{BASE_URL}/channel/{details.channel_id}",
            )

    @_guard("search")
    def search(self, query: str, order: SearchOrder = SearchOrder.relevance) -> list[SearchHit]:
        if not isinstance(query, str) or not query.strip():
            raise ValidationError("empty search", field="query")
        try:
            sort = SearchOrder(order)
        except ValueError as err:
            raise ValidationError(f"invalid search order: {order!r}", field="order") from err
        q = query.strip()
        lang = _search_language(self._settings, q)
        params: dict[str, str] = {"search_query": q}
        if lang == "pt":
            params.update(hl="pt-BR", gl="BR")
        else:
            params["hl"] = "en"
        sp = SEARCH_SP[sort]
        if sp:
            params["sp"] = sp
        what = f"search {q!r}"
        resp = self._get_ok(
            what, SEARCH_URL, params=params, headers=LANG_PT if lang == "pt" else LANG_EN
        )
        try:
            return parse_search_payload(resp.text, now=self._now())
        except YouTubeError as err:
            raise YouTubeError(f"{what}: {err.message}") from err

    @_guard("extension search result")
    def parse_search_payload(self, payload: Mapping[str, Any] | str) -> list[SearchHit]:
        return parse_search_payload(payload, now=self._now())

    @_guard("video details")
    def video_details(self, video_id: str) -> VideoDetails:
        vid = _require_video_id(video_id)
        what = f"video {vid}"
        html = self._watch_page(what, vid)
        try:
            return parse_video_page(html, vid)
        except YouTubeError as err:
            raise YouTubeError(f"{what}: {err.message}", video_id=vid) from err

    @_guard("Short check")
    def is_short(self, video_id: str) -> bool:
        vid = _require_video_id(video_id)
        what = f"Short {vid}"
        resp = self._get(what, f"{BASE_URL}/shorts/{vid}", follow_redirects=False)
        if resp.status == 200:
            _check_consent(what, resp)
            return True
        return self._short_redirect(what, resp)

    def frame_url(self, video_id: str) -> str:
        return FRAME_URL.format(video_id=_require_video_id(video_id))


def build(*, http: HttpClient, settings: Settings, clock: Clock | None = None) -> YouTubeClient:
    """``YouTubeClient`` over the plugin's ``HttpClient``. No network and no thread here."""
    return YouTube(http=http, settings=settings, clock=clock)


__all__ = [
    "BASE_URL",
    "CHANNEL_VIDEOS_URL",
    "FRAME_URL",
    "RSS_MAX_VIDEOS",
    "SEARCH_SP",
    "ChannelPageFeed",
    "PLAYLIST_URL",
    "PlaylistPage",
    "YouTube",
    "build",
    "dates_are_approximate",
    "extract_initial_data",
    "extract_json_var",
    "is_channel_missing",
    "is_feed_outage",
    "parse_channel_page",
    "parse_channel_uploads",
    "parse_count",
    "parse_duration",
    "parse_playlist_page",
    "parse_relative_time",
    "parse_rss",
    "parse_search_payload",
    "parse_short_length",
    "parse_video_page",
    "uploads_playlist_id",
]
