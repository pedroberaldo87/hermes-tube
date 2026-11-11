"""Pure normalisation of YouTube identifiers (no network, no database).

Used by ``ChannelService.find_duplicate``, by the extension ingestion, by the importers and by
anything that needs to recognise a link pasted by the user.

Accepted forms:

- channel id ``UC`` + 22 characters; video id of 11 characters
- URLs with or without scheme, ``www.``/``m.``/``music.``, with or without query/fragment:
  ``/@handle``, ``/channel/UC…``, ``/c/name``, ``/user/name``, ``/<name>`` (legacy vanity),
  ``watch?v=``, ``youtu.be/<id>``, ``/shorts/<id>``, ``/live/<id>``, ``/embed/<id>``
- handle with or without ``@``, upper case, accents, unicode and ``%``-encoding
- name: casefold, accents stripped, zero-width characters removed, whitespace collapsed

Comparison keys (``channel_match_keys``) have the form ``<kind>:<value>``, strongest first:
``id`` > ``handle`` > ``custom`` > ``user`` > ``name``.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qs, unquote, urlsplit

__all__ = [
    "ChannelRef",
    "RefKind",
    "YOUTUBE_HOSTS",
    "SHORT_LINK_HOSTS",
    "is_channel_id",
    "is_video_id",
    "normalize_handle",
    "normalize_name",
    "parse_channel_ref",
    "parse_video_id",
    "canonical_channel_url",
    "canonical_video_url",
    "channel_match_keys",
    "same_channel",
]

RefKind = Literal["id", "handle", "custom", "user", "video"]

YOUTUBE_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    }
)
SHORT_LINK_HOSTS = frozenset({"youtu.be", "www.youtu.be"})

_CHANNEL_ID_RE = re.compile(r"UC[0-9A-Za-z_-]{22}")
_VIDEO_ID_RE = re.compile(r"[0-9A-Za-z_-]{11}")
_VANITY_RE = re.compile(r"[\w.\-]+")
_HANDLE_PUNCT = frozenset("._-·")
_ZERO_WIDTH = frozenset("\u200b\u200c\u200d\u2060\ufeff\u00ad")
_MAX_HANDLE = 100

# First path segment that is never a channel name (legacy vanity).
_RESERVED_FIRST_SEGMENTS = frozenset(
    {
        "about",
        "account",
        "attribution_link",
        "c",
        "channel",
        "e",
        "embed",
        "feed",
        "gaming",
        "hashtag",
        "history",
        "index",
        "kids",
        "live",
        "logout",
        "music",
        "oembed",
        "playlist",
        "post",
        "premium",
        "redirect",
        "results",
        "s",
        "shorts",
        "signin",
        "source",
        "sw.js",
        "t",
        "upload",
        "user",
        "v",
        "watch",
    }
)

_VIDEO_PATH_PREFIXES = frozenset({"shorts", "live", "embed", "v", "e"})

_KEY_RANK = {"id": 0, "handle": 1, "custom": 2, "user": 3, "name": 4}


@dataclass(frozen=True, slots=True)
class ChannelRef:
    """Reference to a channel extracted from free text.

    ``kind='video'`` means "the channel of this video" (``value`` = video id): it needs
    ``YouTubeClient.resolve_channel`` to become a channel id.
    """

    kind: RefKind
    value: str

    @property
    def key(self) -> str:
        """Comparison key ``<kind>:<value>`` (same format as ``channel_match_keys``)."""
        return f"{self.kind}:{self.value}"


def is_channel_id(text: str) -> bool:
    """``True`` if *text* is exactly a channel id ``UC`` + 22 characters."""
    return isinstance(text, str) and _CHANNEL_ID_RE.fullmatch(text) is not None


def is_video_id(text: str) -> bool:
    """``True`` if *text* is exactly an 11-character video id."""
    return isinstance(text, str) and _VIDEO_ID_RE.fullmatch(text) is not None


def _fold(text: str) -> str:
    """NFC + casefold + NFC (casefold may decompose; ``ß`` becomes ``ss``)."""
    return unicodedata.normalize("NFC", unicodedata.normalize("NFC", text).casefold())


def normalize_handle(text: str) -> str | None:
    """Canonical handle ``@<casefold NFC>`` or ``None`` if invalid.

    Accepts with or without ``@`` (a single one), ``%``-encoding, upper case and unicode. Rejects
    spaces, ``/``, ``?``, ``#`` and any character other than letters, digits, marks and ``._-·``.
    """
    if not isinstance(text, str):
        return None
    value = unquote(text.strip())
    if value.startswith("@"):
        value = value[1:]
    if not value or value.startswith("@"):
        return None
    value = _fold(value)
    if len(value) > _MAX_HANDLE:
        return None
    for ch in value:
        if ch.isalnum() or ch in _HANDLE_PUNCT or unicodedata.category(ch).startswith("M"):
            continue
        return None
    return "@" + value


def normalize_name(text: str) -> str:
    """Name for comparison: no accents, casefold, compatibility (NFKD), collapsed whitespace."""
    if not isinstance(text, str):
        return ""
    value = unicodedata.normalize("NFKD", text).casefold()
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch) and ch not in _ZERO_WIDTH)
    return " ".join(value.split())


def _split_url(text: str) -> tuple[str, list[str], dict[str, list[str]]] | None:
    """``(host, decoded path segments, query)`` or ``None`` if it does not look like a URL."""
    value = text.strip()
    if not value or any(ch.isspace() for ch in value):
        return None
    if "://" not in value:
        head = value.split("/", 1)[0]
        if "." not in head:
            return None
        value = "https://" + value
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    host = (parts.hostname or "").lower()
    if not host:
        return None
    segments = [unquote(seg) for seg in parts.path.split("/") if seg]
    return host, segments, parse_qs(parts.query)


def parse_video_id(text: str) -> str | None:
    """Video id from a raw id or from any YouTube video URL; ``None`` if there is none."""
    if not isinstance(text, str):
        return None
    value = text.strip()
    if is_video_id(value):
        return value
    split = _split_url(value)
    if split is None:
        return None
    host, segments, query = split
    if host in SHORT_LINK_HOSTS:
        if segments and is_video_id(segments[0]):
            return segments[0]
        return None
    if host not in YOUTUBE_HOSTS or not segments:
        return None
    first = segments[0].lower()
    if first == "watch":
        candidates = query.get("v") or []
        if candidates and is_video_id(candidates[0]):
            return candidates[0]
        return None
    if first in _VIDEO_PATH_PREFIXES and len(segments) >= 2 and is_video_id(segments[1]):
        return segments[1]
    return None


def _vanity(value: str) -> str | None:
    folded = _fold(value)
    return folded if _VANITY_RE.fullmatch(folded) else None


def parse_channel_ref(text: str) -> ChannelRef | None:
    """Parse an id, ``@handle`` or channel/video URL; ``None`` if it is none of these.

    A bare word without ``@`` (``mkbhd``) is ambiguous and returns ``None``.
    """
    if not isinstance(text, str):
        return None
    value = text.strip()
    if not value:
        return None
    if is_channel_id(value):
        return ChannelRef("id", value)
    if value.startswith("@"):
        handle = normalize_handle(value)
        return ChannelRef("handle", handle) if handle else None
    split = _split_url(value)
    if split is None:
        return None
    host, segments, _query = split
    if host in SHORT_LINK_HOSTS:
        video = parse_video_id(value)
        return ChannelRef("video", video) if video else None
    if host not in YOUTUBE_HOSTS or not segments:
        return None
    first = segments[0]
    lowered = first.lower()
    if first.startswith("@"):
        handle = normalize_handle(first)
        return ChannelRef("handle", handle) if handle else None
    if lowered == "channel":
        if len(segments) >= 2 and is_channel_id(segments[1]):
            return ChannelRef("id", segments[1])
        return None
    if lowered in ("c", "user"):
        if len(segments) >= 2:
            name = _vanity(segments[1])
            if name:
                return ChannelRef("custom" if lowered == "c" else "user", name)
        return None
    video = parse_video_id(value)
    if video:
        return ChannelRef("video", video)
    if lowered in _RESERVED_FIRST_SEGMENTS:
        return None
    if host.startswith("music.") or "nocookie" in host:
        return None
    name = _vanity(first)
    return ChannelRef("custom", name) if name else None


def canonical_channel_url(text: str) -> str | None:
    """Canonical ``https://www.youtube.com/...`` channel URL; ``None`` otherwise (videos too)."""
    ref = parse_channel_ref(text)
    if ref is None:
        return None
    base = "https://www.youtube.com/"
    if ref.kind == "id":
        return f"{base}channel/{ref.value}"
    if ref.kind == "handle":
        return f"{base}{ref.value}"
    if ref.kind == "custom":
        return f"{base}c/{ref.value}"
    if ref.kind == "user":
        return f"{base}user/{ref.value}"
    return None


def canonical_video_url(text: str) -> str | None:
    """``https://www.youtube.com/watch?v=<id>`` or ``None``."""
    video = parse_video_id(text)
    return f"https://www.youtube.com/watch?v={video}" if video else None


def channel_match_keys(
    *,
    channel_id: str | None = None,
    handle: str | None = None,
    url: str | None = None,
    title: str | None = None,
) -> tuple[str, ...]:
    """``<kind>:<value>`` keys without repetition, from strongest (``id``) to weakest (``name``).

    Invalid inputs are silently ignored; video links produce no key.
    """
    keys: list[str] = []

    def add(key: str) -> None:
        if key not in keys:
            keys.append(key)

    if channel_id and is_channel_id(channel_id.strip()):
        add(f"id:{channel_id.strip()}")
    if handle:
        normalized = normalize_handle(handle)
        if normalized:
            add(f"handle:{normalized}")
    if url:
        ref = parse_channel_ref(url)
        if ref is not None and ref.kind != "video":
            add(ref.key)
    if title:
        name = normalize_name(title)
        if name:
            add(f"name:{name}")
    keys.sort(key=lambda k: _KEY_RANK[k.split(":", 1)[0]])
    return tuple(keys)


def _by_kind(keys: tuple[str, ...] | list[str]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for key in keys:
        kind, _, value = key.partition(":")
        out.setdefault(kind, set()).add(value)
    return out


def same_channel(
    a: tuple[str, ...] | list[str],
    b: tuple[str, ...] | list[str],
    *,
    allow_name: bool = True,
) -> bool:
    """Decide whether two key sets describe the same channel.

    - ids present on both sides decide alone (equal = same channel; different = not)
    - different handles on both sides = different channels
    - any strong key in common (``handle``, ``custom``, ``user``) = same channel
    - with no conflict and no strong key in common, the name decides only if ``allow_name``
    """
    ka, kb = _by_kind(a), _by_kind(b)
    if "id" in ka and "id" in kb:
        return bool(ka["id"] & kb["id"])
    if "handle" in ka and "handle" in kb and not ka["handle"] & kb["handle"]:
        return False
    for kind in ("handle", "custom", "user"):
        if ka.get(kind, set()) & kb.get(kind, set()):
            return True
    if allow_name and ka.get("name", set()) & kb.get("name", set()):
        return True
    return False
