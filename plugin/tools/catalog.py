"""Agent tools.

``TOOLS`` is the registry read by ``register(ctx)`` (``__init__.py``): each ``ToolSpec.name`` is
also the name of the handler function in this module (``handler(args, **kwargs) -> str`` JSON;
never raises). The names match ``provides_tools`` in ``plugin.yaml`` (``validate`` and
``tests/test_tools.py`` check it). The body of each tool is in ``_impl.py``; the answer shape in
``_text.py``; the video card (``::tube-video``) in ``directive.py``.

Answer (JSON, for the model):

- success: ``{"ok": true, …short data…, "truncated"?, "untrusted"?, "cards"?}``;
- error: ``{"ok": false, "error": {"code", "message", "hint"?, "options"?}}`` — domain errors
  (``llm_unavailable``, ``not_found``, ``busy``…) and invalid input (``invalid``) become useful
  text; an unexpected exception becomes ``internal`` (traceback only in the log). Never raises.

No tool approves an unsubscription, resubscribes or runs the queue: the cleanup only **lists**,
and approval is human (the app's Cleanup page or ``/tube faxina``).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any, NamedTuple

from tube_pkg import wiring
from tube_pkg._id import PLUGIN_ID
from tube_pkg.api._common import contract
from tube_pkg.core import types as T
from tube_pkg.core.ai import NO_MODEL_MESSAGE, PROVIDER_UNAVAILABLE
from tube_pkg.tools import _impl
from tube_pkg.tools import _text as X

logger = logging.getLogger(__name__)

MAX_CHARS = _impl.MAX_CHARS
SKILL_NAME = f"{PLUGIN_ID}:{PLUGIN_ID}"
"""Explicit load name of the skill (``skill_view``): ``<plugin>:<skill folder>``."""


class ToolSpec(NamedTuple):
    name: str
    description: str
    parameters: dict[str, Any]
    emoji: str = "▶"

    def schema(self) -> dict[str, Any]:
        """Schema for ``ctx.register_tool`` (``name``, ``description``, ``parameters``)."""
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


def _params(properties: dict[str, Any], required: tuple[str, ...] = ()) -> dict[str, Any]:
    out: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        out["required"] = list(required)
    return out


TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="tube_status",
        description=(
            "Overview of the user's YouTube subscriptions: new videos per tab and folder, new "
            "videos from favorite channels, approved cancellations waiting, and whether the "
            "browser extension is connected. Also starts an RSS check when one is due. Use first "
            "when the user asks what is new on YouTube; then use tube_feed to list videos. "
            f"Workflow and examples: load the skill {SKILL_NAME}."
        ),
        parameters=_params({}),
        emoji="📊",
    ),
    ToolSpec(
        name="tube_feed",
        description=(
            "Videos of one tab, folder or channel, newest first, each with why it is there "
            "(folder, tag, channel, theme). Use to answer 'what came out today?', 'show my Tech "
            "folder', 'anything new from @channel?'. Pass at most one of tab, folder, channel or "
            "playlist (none = the All new tab). playlist='*' lists the user's local playlists; a "
            "playlist name or id lists its videos in play order. Do not use to search YouTube for "
            "new topics: that is tube_theme_create."
        ),
        parameters=_params(
            {
                "tab": {"type": "string", "description": "Tab id or name (e.g. all-new)."},
                "folder": {"type": "string", "description": "Folder id, name or path (A/B)."},
                "channel": {
                    "type": "string",
                    "description": "Channel id (UC...), @handle, link or exact title.",
                },
                "playlist": {
                    "type": "string",
                    "description": "Local playlist name or id; '*' lists the playlists.",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            }
        ),
        emoji="▶",
    ),
    ToolSpec(
        name="tube_channels",
        description=(
            "Search and filter the user's channels by text, folder, tag, relation, favorite or "
            "inactivity, with new-video counts and a visibility note. Use to find a channel or "
            "to answer 'why don't I see channel X anymore?' (ex-subscription, ignored, muted or "
            "inactive). Does not change anything."
        ),
        parameters=_params(
            {
                "query": {"type": "string", "description": "Text to match title or handle."},
                "folder": {
                    "type": "string",
                    "description": "Folder id, name or path; 'none' = channels without folder.",
                },
                "tag": {"type": "string", "description": "Tag id or name."},
                "relation": {"type": "string", "enum": ["subscribed", "followed", "ex", "ignored"]},
                "favorite": {"type": "boolean"},
                "inactive_days": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 3650,
                    "description": "Only channels with no new video for at least this many days.",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            }
        ),
        emoji="📺",
    ),
    ToolSpec(
        name="tube_add_channel",
        description=(
            "Follow a YouTube channel by link, @handle or UC id (optionally into a folder) "
            "without subscribing on YouTube; undoable in the app. Use when the user wants to "
            "follow or add a channel. It never subscribes or unsubscribes on YouTube."
        ),
        parameters=_params(
            {
                "url_or_handle": {
                    "type": "string",
                    "description": "Channel or video link, @handle or UC id.",
                },
                "folder": {"type": "string", "description": "Optional folder id, name or path."},
            },
            ("url_or_handle",),
        ),
        emoji="➕",
    ),
    ToolSpec(
        name="tube_organize",
        description=(
            "Ask the AI to suggest folders and tags for channels (default: followed channels "
            "without a folder). Use when the user asks to organize their subscriptions. Only "
            "creates suggestions, nothing is applied: the user accepts them in the app "
            "(Manage > Organize with Hermes). Takes up to 90 s; may cover only part of the "
            "channels."
        ),
        parameters=_params(
            {
                "channel_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": 500,
                    "description": "Channel ids (UC...) or @handles; omit for channels "
                    "without a folder.",
                }
            }
        ),
        emoji="🗂",
    ),
    ToolSpec(
        name="tube_cleanup_scan",
        description=(
            "Build and list the cleanup candidates (stale, ignored, off-profile channels) with "
            "reasons. Use when the user asks for a cleanup or which subscriptions to cancel. It "
            "never approves or cancels anything and you must never promise a cancellation: the "
            "user approves in the app's Cleanup page or with /tube cleanup."
        ),
        parameters=_params(
            {
                "use_last": {
                    "type": "boolean",
                    "description": "Return the last scan instead of running a new one.",
                }
            }
        ),
        emoji="🧹",
    ),
    ToolSpec(
        name="tube_theme_create",
        description=(
            "Research YouTube for a topic (e.g. 'AI agents', 'rust for beginners') and return a "
            "preview of a theme tab: curated videos and seed channels. Use when the user asks "
            "for a tab about a subject. Returns a preview only; nothing is applied or saved "
            "until the user saves it in the app. Takes up to 90 s."
        ),
        parameters=_params(
            {
                "query": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 200,
                    "description": "Topic in free text.",
                }
            },
            ("query",),
        ),
        emoji="🔭",
    ),
    ToolSpec(
        name="tube_tab",
        description=(
            "Create or edit a tab of the user's own channels: category (folders, tags), channels "
            "or mixed, with filters and mode (fresh, classics, long); undoable in the app. Use "
            "when the user asks for a tab like 'long science videos'. Folder, tag and channel "
            "names are accepted in rules. For a tab about a new topic use tube_theme_create."
        ),
        parameters=_params(
            {
                "action": {"type": "string", "enum": ["create", "update"]},
                "tab_id": {"type": "string", "description": "Tab id or name (update only)."},
                "name": {"type": "string", "maxLength": 60},
                "icon": {"type": "string", "maxLength": 16, "description": "One emoji."},
                "kind": {
                    "type": "string",
                    "enum": ["category", "channels", "mixed"],
                    "description": "Optional; inferred from the rules.",
                },
                "rules": {
                    "type": "object",
                    "description": (
                        "TabRules: include {folders, tags, channels, all, favorites}, exclude "
                        "{folders, tags, channels, shorts}, filters {only_new, per_channel, "
                        "min_s, max_s}, mode (fresh|classics|long). On update, given sections "
                        "replace the current ones."
                    ),
                },
            },
            ("action",),
        ),
        emoji="🗃",
    ),
    ToolSpec(
        name="tube_mark",
        description=(
            "Mark videos as new, seen, watch later, archived or watched, and/or react thumbs "
            "up/down (none clears), and/or add them to one of the user's local playlists. Use "
            "when the user asks to save a video for later, archive it, rate it or 'add this to my "
            "Physics playlist'; use ids from tube_feed. A thumbs down also teaches theme "
            "curation. Playlists live only in HermesTube, never on the YouTube account; an "
            "unknown playlist is an error listing the existing ones unless create_playlist is "
            "true."
        ),
        parameters=_params(
            {
                "video_ids": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 11, "maxLength": 11},
                    "minItems": 1,
                    "maxItems": 50,
                },
                "state": {
                    "type": "string",
                    "enum": ["new", "seen", "later", "archived", "watched"],
                },
                "reaction": {"type": "string", "enum": ["up", "down", "none"]},
                "playlist": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Local playlist name or id to add the videos to.",
                },
                "create_playlist": {
                    "type": "boolean",
                    "description": "Create the playlist when no playlist has that name.",
                },
            },
            ("video_ids",),
        ),
        emoji="✅",
    ),
)


# =========================================================================== execution


def _hints() -> dict[str, str]:
    return {
        "llm_unavailable": (
            f"{NO_MODEL_MESSAGE} Ask the user to do that (auxiliary task "
            f"{wiring.CURATOR_TASK}, or the main model). Status, feed, channels, tabs and "
            "marking still work."
        ),
        "busy": "Another run of this task is in progress. Wait a minute and try again.",
        "timeout": "It took longer than the 90 s limit. Try again later or with fewer items.",
        "youtube_error": (
            "YouTube did not answer as expected. Check the link or @handle, or try again later."
        ),
        "not_found": "Check the name or id; the options list shows what exists.",
        "invalid": "Fix the arguments as described and call again.",
        "conflict": "The current state does not allow this; explain it to the user.",
        "theme_error": "Tell the user the theme search failed; they can retry with other words.",
        "internal": "Tell the user something went wrong; details are in the Hermes log.",
    }


_UNREACHABLE_HINT = (
    "A model is configured but its provider refused the sign-in or is unavailable. Ask the user "
    "to sign in to that provider again, or to pick another model for the plugin's auxiliary task "
    f"({wiring.CURATOR_TASK}) in Settings → Model → Auxiliary models; then try again. Status, "
    "feed, channels, tabs and marking still work."
)


def _fail(code: str, message: str, **extra: Any) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": X.clean(message, 400) or code}
    hint = _hints().get(code)
    if code == "llm_unavailable" and extra.get("reason") == PROVIDER_UNAVAILABLE:
        hint = _UNREACHABLE_HINT
    if hint:
        error["hint"] = hint
    for key, value in extra.items():
        if value:
            error[key] = value
    return {"ok": False, "error": error}


def _run(name: str, args: Any, kwargs: Mapping[str, Any]) -> str:
    try:
        if args is None:
            args = {}
        if not isinstance(args, Mapping):
            data = _fail("invalid", "Arguments must be a JSON object.")
        else:
            data = _impl.RUNNERS[name](args, _impl.Call(kwargs))
    except T.TubeError as exc:
        details = exc.details if isinstance(exc.details, Mapping) else {}
        extra: dict[str, Any] = {"options": details.get("options")}
        if isinstance(exc, T.LLMUnavailable):
            # which AI case it is (no model / provider unreachable) and the route, when known
            extra.update({k: details.get(k) for k in ("reason", "provider", "model")})
        data = _fail(exc.code if exc.code != "error" else "internal", exc.message, **extra)
    except Exception:  # noqa: BLE001 — a tool never raises
        logger.exception("%s: tool %s failed", PLUGIN_ID, name)
        data = _fail("internal", f"{name} failed with an internal error.")
    try:
        return json.dumps(data, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        logger.exception("%s: answer of %s is not serializable", PLUGIN_ID, name)
        return json.dumps(_fail("internal", f"{name} failed with an internal error."))


@contract.real
def tube_status(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Overview: new per tab/folder, ⭐, queue, extension; fires an overdue RSS and the extension
    server (``Refresher.kick_if_due``, ``wiring.ensure_ext_server(role="gateway")``)."""
    return _run("tube_status", args, kwargs)


@contract.real
def tube_feed(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Videos of a tab, folder or channel (same feed as the Desktop and the extension)."""
    return _run("tube_feed", args, kwargs)


@contract.real
def tube_channels(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Searches and filters channels, with a visibility note (\"why don't I see X anymore\")."""
    return _run("tube_channels", args, kwargs)


@contract.real
def tube_add_channel(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Follows a channel by link/@handle (``followed``, undoable); never subscribes."""
    return _run("tube_add_channel", args, kwargs)


@contract.real
def tube_organize(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Folder/tag suggestions (``Organizer.organize``, 90 s); nothing is applied."""
    return _run("tube_organize", args, kwargs)


@contract.real
def tube_cleanup_scan(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Cleanup list (``Cleanup.scan``/``latest_scan``); never approves."""
    return _run("tube_cleanup_scan", args, kwargs)


@contract.real
def tube_theme_create(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Theme tab preview (``Themes.create``, 90 s); nothing is saved."""
    return _run("tube_theme_create", args, kwargs)


@contract.real
def tube_tab(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Creates/edits a category/channels/mixed tab (undoable)."""
    return _run("tube_tab", args, kwargs)


@contract.real
def tube_mark(args: Mapping[str, Any], **kwargs: Any) -> str:
    """Video state (seen, later, archived…) and 👍/👎."""
    return _run("tube_mark", args, kwargs)


__all__ = [
    "MAX_CHARS",
    "SKILL_NAME",
    "TOOLS",
    "ToolSpec",
    "tube_add_channel",
    "tube_channels",
    "tube_cleanup_scan",
    "tube_feed",
    "tube_mark",
    "tube_organize",
    "tube_status",
    "tube_tab",
    "tube_theme_create",
]
