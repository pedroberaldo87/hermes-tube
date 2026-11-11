"""``FakeYouTube``: ``YouTubeClient`` without network.

Data comes from two sources:

- in-memory registry: ``add_channel``, ``add_rss``, ``add_search``, ``add_details``,
  ``add_short``, ``fail`` (scripted error per method/argument);
- ``fixtures_dir`` (optional): every ``*.xml`` with ``yt:channelId`` becomes an ``RssFeed`` (minimal
  YouTube Atom parser) and ``load_search_fixture(query, path)`` registers a saved search page
  (HTML with ``ytInitialData`` or the plain JSON).

``calls`` records ``(method, argument)`` — useful to prove "no request at all".
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Iterator, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import types as T

_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def _ts(text: str | None) -> int | None:
    if not text:
        return None
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def parse_rss(xml_text: str) -> T.RssFeed:
    """Minimal parser of a YouTube channel RSS (Atom) feed → ``RssFeed`` (up to 15 videos)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise T.YouTubeError(f"unreadable RSS: {exc}") from exc
    channel_id = root.findtext("yt:channelId", default="", namespaces=_NS)
    if not channel_id.startswith("UC") and len(channel_id) == 22:
        channel_id = "UC" + channel_id
    title = root.findtext("atom:title", default="", namespaces=_NS)
    author_url = root.findtext("atom:author/atom:uri", default=None, namespaces=_NS)
    link = root.find("atom:link[@rel='alternate']", _NS)
    info = T.ChannelInfo(
        id=channel_id,
        title=title,
        url=(link.get("href") if link is not None else None) or author_url,
    )
    videos: list[T.VideoIn] = []
    for entry in root.findall("atom:entry", _NS)[:15]:
        group = entry.find("media:group", _NS)
        views = None
        desc = None
        if group is not None:
            desc = group.findtext("media:description", default=None, namespaces=_NS)
            stats = group.find("media:community/media:statistics", _NS)
            if stats is not None and (stats.get("views") or "").isdigit():
                views = int(stats.get("views") or 0)
        videos.append(
            T.VideoIn(
                id=entry.findtext("yt:videoId", default="", namespaces=_NS),
                channel_id=entry.findtext("yt:channelId", default=channel_id, namespaces=_NS)
                or channel_id,
                title=entry.findtext("atom:title", default="", namespaces=_NS),
                published_at=_ts(entry.findtext("atom:published", default=None, namespaces=_NS)),
                description=desc or None,
                channel_title=title or None,
                views=views,
            )
        )
    return T.RssFeed(channel=info, videos=tuple(videos))


# --------------------------------------------------------------------------- search


def extract_initial_data(text: str) -> dict[str, Any]:
    """``ytInitialData`` of an HTML page (or the JSON itself)."""
    stripped = text.lstrip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    match = re.search(r"ytInitialData\s*=\s*", text)
    if match is None:
        raise T.YouTubeError("page without ytInitialData")
    data, _ = json.JSONDecoder().raw_decode(text, match.end())
    return data


_CHANNEL_ID_RE = re.compile(r"UC[0-9A-Za-z_-]{22}")


def _walk(node: Any) -> Iterator[dict[str, Any]]:
    if isinstance(node, dict):
        if "videoRenderer" in node and isinstance(node["videoRenderer"], dict):
            yield node["videoRenderer"]
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _text(node: Any) -> str | None:
    if not isinstance(node, dict):
        return None
    if "simpleText" in node:
        return str(node["simpleText"])
    runs = node.get("runs")
    if isinstance(runs, list):
        return "".join(str(r.get("text", "")) for r in runs if isinstance(r, dict))
    return None


def _duration(text: str | None) -> int | None:
    if not text or not re.fullmatch(r"\d+(:\d{1,2}){0,2}", text.strip()):
        return None
    total = 0
    for part in text.strip().split(":"):
        total = total * 60 + int(part)
    return total


def _views(text: str | None) -> int | None:
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    return int(digits) if digits else None


def parse_search(payload: Mapping[str, Any] | str) -> list[T.SearchHit]:
    """``videoRenderer``s of ``ytInitialData`` → ``SearchHit``s (no duplicates, in order)."""
    data = extract_initial_data(payload) if isinstance(payload, str) else payload
    hits: list[T.SearchHit] = []
    seen: set[str] = set()
    for vr in _walk(data):
        vid = vr.get("videoId")
        if not isinstance(vid, str) or vid in seen:
            continue
        owner = vr.get("ownerText") or vr.get("longBylineText") or {}
        runs = owner.get("runs") if isinstance(owner, dict) else None
        channel_id = ""
        if isinstance(runs, list) and runs:
            nav = runs[0].get("navigationEndpoint", {}) if isinstance(runs[0], dict) else {}
            channel_id = str(nav.get("browseEndpoint", {}).get("browseId", ""))
        if not dedup.is_channel_id(channel_id):
            # collaboration video: the owner becomes a dialog with several channels; first one wins
            found = _CHANNEL_ID_RE.search(json.dumps(owner)) or _CHANNEL_ID_RE.search(
                json.dumps(vr.get("channelThumbnailSupportedRenderers", {}))
            )
            channel_id = found.group(0) if found else ""
        snippet = None
        snippets = vr.get("detailedMetadataSnippets")
        if isinstance(snippets, list) and snippets and isinstance(snippets[0], dict):
            snippet = _text(snippets[0].get("snippetText"))
        seen.add(vid)
        hits.append(
            T.SearchHit(
                video_id=vid,
                title=_text(vr.get("title")) or "",
                channel_id=channel_id,
                channel_title=_text(owner) if isinstance(owner, dict) else None,
                duration_s=_duration(_text(vr.get("lengthText"))),
                views=_views(_text(vr.get("viewCountText"))),
                published_text=_text(vr.get("publishedTimeText")),
                description=snippet or _text(vr.get("descriptionSnippet")),
            )
        )
    return hits


# --------------------------------------------------------------------------- fake


class FakeYouTube:
    """In-memory ``YouTubeClient`` (see the module docstring)."""

    def __init__(self, fixtures_dir: str | Path | None = None) -> None:
        self.channels: dict[str, T.ChannelInfo] = {}
        self._aliases: dict[str, str] = {}
        self.rss: dict[str, T.RssFeed] = {}
        self.uploads: dict[str, T.RssFeed] = {}
        self.searches: dict[tuple[str, T.SearchOrder | None], list[T.SearchHit]] = {}
        self.details: dict[str, T.VideoDetails] = {}
        self.shorts: set[str] = set()
        self.video_owner: dict[str, str] = {}
        self.failures: dict[tuple[str, str], BaseException] = {}
        self.calls: list[tuple[str, Any]] = []
        self.loaded_rss: list[str] = []
        if fixtures_dir is not None:
            self.load_fixtures(fixtures_dir)

    # ------------------------------------------------------------------ registry

    def add_channel(self, info: T.ChannelInfo, *aliases: str) -> T.ChannelInfo:
        """Registers the channel; *aliases* = extra URLs/handles that resolve to it."""
        self.channels[info.id] = info
        self._aliases[f"id:{info.id}"] = info.id
        for text in (info.handle, info.url, *aliases):
            if not text:
                continue
            ref = dedup.parse_channel_ref(text) or (
                dedup.ChannelRef("handle", h) if (h := dedup.normalize_handle(text)) else None
            )
            if ref is not None:
                self._aliases[f"{ref.kind}:{ref.value}"] = info.id
        return info

    def add_rss(self, feed: T.RssFeed) -> None:
        if feed.channel.id not in self.channels:
            self.add_channel(feed.channel)
        self.rss[feed.channel.id] = feed
        for v in feed.videos:
            self.video_owner.setdefault(v.id, feed.channel.id)

    def add_search(
        self, query: str, hits: Iterable[T.SearchHit], order: T.SearchOrder | None = None
    ) -> None:
        """Result for *query* (``order=None`` applies to both orders)."""
        self.searches[(query, order)] = list(hits)
        for h in self.searches[(query, order)]:
            self.video_owner.setdefault(h.video_id, h.channel_id)

    def add_details(self, details: T.VideoDetails) -> None:
        self.details[details.video_id] = details

    def add_short(self, *video_ids: str) -> None:
        self.shorts.update(video_ids)

    def fail(self, method: str, arg: str, error: BaseException) -> None:
        """Scripted error: ``fail("fetch_channel_rss", channel_id, YouTubeError(...))``."""
        self.failures[(method, arg)] = error

    def load_fixtures(self, fixtures_dir: str | Path) -> int:
        """Indexes every RSS ``*.xml`` in the directory (recursive); returns how many."""
        root = Path(fixtures_dir)
        count = 0
        if not root.is_dir():
            return 0
        for path in sorted(root.rglob("*.xml")):
            text = path.read_text(encoding="utf-8", errors="replace")
            if "yt:channelId" not in text:
                continue
            feed = parse_rss(text)
            if not dedup.is_channel_id(feed.channel.id):
                continue
            self.add_rss(feed)
            self.loaded_rss.append(feed.channel.id)
            count += 1
        return count

    def load_search_fixture(
        self, query: str, path: str | Path, order: T.SearchOrder | None = None
    ) -> list[T.SearchHit]:
        hits = parse_search(Path(path).read_text(encoding="utf-8"))
        self.add_search(query, hits, order)
        return hits

    def _check_fail(self, method: str, arg: str) -> None:
        err = self.failures.get((method, arg))
        if err is not None:
            raise err

    # ------------------------------------------------------------------ YouTubeClient

    def fetch_channel_rss(self, channel_id: str) -> T.RssFeed:
        self.calls.append(("fetch_channel_rss", channel_id))
        self._check_fail("fetch_channel_rss", channel_id)
        feed = self.rss.get(channel_id)
        if feed is None:
            raise T.YouTubeError(f"RSS unavailable for {channel_id}", channel_id=channel_id)
        return feed

    def fetch_channel_uploads(self, channel_id: str) -> T.RssFeed:
        """Plan B (channel page): only what was scripted in ``uploads``; with no script, the page
        is unavailable (an ordinary error, **not** "channel does not exist")."""
        self.calls.append(("fetch_channel_uploads", channel_id))
        self._check_fail("fetch_channel_uploads", channel_id)
        feed = self.uploads.get(channel_id)
        if feed is None:
            raise T.YouTubeError(f"page unavailable for {channel_id}", channel_id=channel_id)
        return feed

    def resolve_channel(self, url_or_handle: str) -> T.ChannelInfo:
        self.calls.append(("resolve_channel", url_or_handle))
        self._check_fail("resolve_channel", url_or_handle)
        ref = dedup.parse_channel_ref(url_or_handle)
        if ref is None:
            raise T.ValidationError(f"no channel recognized in {url_or_handle!r}")
        key = f"{ref.kind}:{ref.value}"
        if ref.kind == "video":
            owner = self.video_owner.get(ref.value)
            key = f"id:{owner}" if owner else key
        channel_id = self._aliases.get(key)
        if channel_id is None:
            raise T.YouTubeError(f"channel not found: {url_or_handle}")
        return self.channels[channel_id]

    def search(
        self, query: str, order: T.SearchOrder = T.SearchOrder.relevance
    ) -> list[T.SearchHit]:
        self.calls.append(("search", query))
        self._check_fail("search", query)
        hits = self.searches.get((query, T.SearchOrder(order)))
        if hits is None:
            hits = self.searches.get((query, None), [])
        return list(hits)

    def parse_search_payload(self, payload: Mapping[str, Any] | str) -> list[T.SearchHit]:
        self.calls.append(("parse_search_payload", None))
        return parse_search(payload)

    def video_details(self, video_id: str) -> T.VideoDetails:
        self.calls.append(("video_details", video_id))
        self._check_fail("video_details", video_id)
        details = self.details.get(video_id)
        if details is None:
            raise T.YouTubeError(f"video unavailable: {video_id}")
        return details

    def is_short(self, video_id: str) -> bool:
        self.calls.append(("is_short", video_id))
        self._check_fail("is_short", video_id)
        return video_id in self.shorts

    def frame_url(self, video_id: str) -> str:
        return f"https://i.ytimg.com/vi/{video_id}/hq2.jpg"

    def network_calls(self) -> list[tuple[str, Any]]:
        """Calls that would hit the network in the real one (everything except parse and frame)."""
        return [c for c in self.calls if c[0] != "parse_search_payload"]


def hits_for(videos: Sequence[T.VideoIn]) -> list[T.SearchHit]:
    """Turns videos into search results (to script ``add_search``)."""
    return [
        T.SearchHit(
            video_id=v.id,
            title=v.title,
            channel_id=v.channel_id,
            channel_title=v.channel_title,
            duration_s=v.duration_s,
            views=v.views,
            published_at=v.published_at,
            description=v.description,
        )
        for v in videos
    ]


__all__ = ["FakeYouTube", "extract_initial_data", "hits_for", "parse_rss", "parse_search"]
