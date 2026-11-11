"""Video card in the chat: the ``::tube-video{id="…"}`` directive.

The directive is only taught where the chat draws the card (``RENDERING_PLATFORMS``, today the
Desktop); anywhere else (Telegram, CLI, TUI) it would become raw text, so there the tools return
only the normal YouTube link.

- **Tools** — ``renders_cards()`` decides per call, from the Hermes session variables
  (``HERMES_SESSION_PLATFORM``, set by the gateway per messaging platform, and
  ``HERMES_SESSION_SOURCE``, set by the Desktop/CLI/TUI), read through
  ``gateway.session_context.get_session_env`` (contextvar, with ``os.environ`` as a fallback).
  It draws if the platform is in ``RENDERING_PLATFORMS``, or if the platform is neutral
  (empty/``local``) and the source is in ``RENDERING_PLATFORMS``. Each returned video gets
  ``card`` = ``display(id)``.
- **Hook** ``pre_llm_call`` (``provides_hooks``) — the same 3 instruction lines, only when the
  agent's ``platform`` is in ``RENDERING_PLATFORMS`` (measured: ``'desktop'``).

Both log (INFO, once per value) what they received, to check in the real chat.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from collections.abc import Mapping
from typing import Any

logger = logging.getLogger(__name__)

DIRECTIVE = "tube-video"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
RENDERING_PLATFORMS: frozenset[str] = frozenset({"desktop", "gui"})
"""``platform`` of the sessions that draw ``::tube-video`` (Desktop = ``'desktop'``)."""

NEUTRAL_PLATFORMS: frozenset[str] = frozenset({"", "local"})
"""``HERMES_SESSION_PLATFORM`` values that say nothing about the screen (local session)."""

HOOK_LINES = (
    "To show a YouTube video as a card in this app, write on its own line: "
    f'::{DIRECTIVE}{{id="<11-character video id>"}}',
    "Only the id attribute; one directive per video; nothing else on that line; "
    "leave a blank line before and after each directive.",
    f'Example: ::{DIRECTIVE}{{id="dQw4w9WgXcQ"}}',
)

CARD_HINT = (
    "This chat renders video cards: to show a video, copy its `card` value exactly, alone on its "
    "own line with a blank line before and after (one per video, only for videos from these "
    "results). Otherwise use the url."
)
"""Instruction attached to results with ``card`` (only on a platform that draws)."""

_SEEN: set[str] = set()
_SEEN_LOCK = threading.Lock()


def _log_once(key: str, message: str, *args: Any) -> None:
    with _SEEN_LOCK:
        first = key not in _SEEN
        _SEEN.add(key)
    if first:
        logger.info(message, *args)


def display(video_id: Any) -> str | None:
    """Directive line for *video_id* (``None`` if the id is not 11 valid characters)."""
    if not isinstance(video_id, str) or not VIDEO_ID_RE.match(video_id):
        return None
    return f'::{DIRECTIVE}{{id="{video_id}"}}'


def _session_value(name: str) -> str:
    try:
        from gateway.session_context import get_session_env
    except Exception:  # noqa: BLE001 — outside Hermes: environment only
        return os.environ.get(name, "")
    try:
        return str(get_session_env(name, "") or "")
    except Exception:  # noqa: BLE001
        return os.environ.get(name, "")


def session_platform(kwargs: Mapping[str, Any] | None = None) -> tuple[str, str]:
    """``(platform, source)`` of the session that called the tool, lowercase. An explicit
    ``platform`` in the call *kwargs* (if Hermes ever passes one) wins over the session variable."""
    given = (kwargs or {}).get("platform")
    platform = given if isinstance(given, str) else ""
    platform = (
        platform
        or os.environ.get("HERMES_PLATFORM", "")
        or _session_value("HERMES_SESSION_PLATFORM")
    )
    source = _session_value("HERMES_SESSION_SOURCE")
    return platform.strip().lower(), source.strip().lower()


def renders_cards(kwargs: Mapping[str, Any] | None = None) -> bool:
    """Does this call's chat draw ``::tube-video``? (see the module docstring; never raises)."""
    try:
        platform, source = session_platform(kwargs)
    except Exception:  # noqa: BLE001
        return False
    _log_once(
        f"tool:{platform}|{source}",
        "tube directive (tools): platform=%r source=%r",
        platform,
        source,
    )
    if platform in RENDERING_PLATFORMS:
        return True
    return platform in NEUTRAL_PLATFORMS and source in RENDERING_PLATFORMS


def pre_llm_call(**kwargs: Any) -> dict[str, str] | None:
    """``pre_llm_call`` hook: injects the 3 lines only on ``RENDERING_PLATFORMS``; never raises."""
    platform = str(kwargs.get("platform") or "")
    _log_once(f"hook:{platform}", "tube directive hook: platform=%r", platform)
    if platform not in RENDERING_PLATFORMS:
        return None
    return {"context": "\n".join(HOOK_LINES)}


__all__ = [
    "CARD_HINT",
    "DIRECTIVE",
    "HOOK_LINES",
    "NEUTRAL_PLATFORMS",
    "RENDERING_PLATFORMS",
    "VIDEO_ID_RE",
    "display",
    "pre_llm_call",
    "renders_cards",
    "session_platform",
]
