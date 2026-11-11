"""RPC methods of ``plugin/rpc/themes.py``: ``theme.create`` and ``theme.refresh`` (job) and
``theme.save`` (direct).

Registered by ``register(ctx)`` (``ctx.register_rpc``) from ``wiring.RPC_METHODS``; they only
exist on the gateway. They answer in < 1 s: the jobs only record the work (``JobRunner.submit``)
and the search/AI runs on the job's thread, with the **same** ``Themes.create`` as the tool and
``/tube tema``, and the same budget (``TOOL_TIMEOUT_S``). Per-step progress on
``theme.progress`` (``{job, progress}``), the end on ``theme.ready`` (an accelerator; the screen
reads ``GET /jobs/{id}`` and then ``GET /themes/{id}``). No model → ``llm_unavailable`` at once, no
job. One theme job at a time → ``busy`` (a job cancelled by ``job.cancel`` no longer counts).
``theme.create`` accepts ``language``/``classics`` (passed on only when given: without them, the
call to the core is the same as before).
"""

from __future__ import annotations

import threading
from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, error_envelope, fail, ok
from tube_pkg.core import dedup
from tube_pkg.core import types as T
from tube_pkg.core.themes import NO_MODEL_MESSAGE, QUERY_MAX, QUERY_MIN, clean_options

JOB_TIMEOUT_S = T.TOOL_TIMEOUT_S
"""Same budget as the other entry points (a tab in < 90 s)."""
READY_EVENT = "theme.ready"
PROGRESS_EVENT = "theme.progress"
BUSY_MESSAGE = "A topic tab is already being built; follow its progress."
MAX_ITEMS = 500
"""Cap on ``edits.seed_actions`` and ``edits.removed_video_ids`` (a theme holds far fewer)."""

_SUBMIT_LOCK = threading.Lock()
"""Check \"a theme job is already active\" and record the new one with no race between calls."""

_EDIT_KEYS = frozenset(
    {"name", "icon", "create_folder", "folder_name", "seed_actions", "removed_video_ids"}
)


class _Invalid(Exception):
    pass


def _theme_id(params: Mapping[str, Any]) -> str:
    value = params.get("theme_id")
    if not isinstance(value, str) or not value.strip():
        raise _Invalid("theme_id: expected a string")
    return value.strip()


def _opt_text(edits: Mapping[str, Any], key: str) -> str | None:
    value = edits.get(key)
    if value is not None and not isinstance(value, str):
        raise _Invalid(f"edits.{key}: expected a string or null")
    return value


def _edits(value: Any) -> T.ThemeSaveEdits | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise _Invalid("edits: expected an object")
    unknown = sorted(set(value) - _EDIT_KEYS)
    if unknown:
        raise _Invalid(f"edits: unknown keys {unknown}"[:200])
    create_folder = value.get("create_folder", False)
    if not isinstance(create_folder, bool):
        raise _Invalid("edits.create_folder: expected true or false")
    actions = value.get("seed_actions") or {}
    if not isinstance(actions, Mapping):
        raise _Invalid("edits.seed_actions: expected an object channel → action")
    if len(actions) > MAX_ITEMS:
        raise _Invalid(f"edits.seed_actions: at most {MAX_ITEMS} channels")
    seed_actions: dict[str, T.SeedAction] = {}
    for channel_id, action in actions.items():
        if not isinstance(channel_id, str) or not dedup.is_channel_id(channel_id):
            raise _Invalid(
                f"edits.seed_actions: keys must be channel ids (UC…), got {str(channel_id)[:40]!r}"
            )
        try:
            seed_actions[str(channel_id)] = T.SeedAction(action)
        except ValueError as exc:
            raise _Invalid(f"edits.seed_actions: invalid action {action!r}"[:200]) from exc
    removed = value.get("removed_video_ids") or []
    if not isinstance(removed, list) or not all(isinstance(v, str) for v in removed):
        raise _Invalid("edits.removed_video_ids: expected a list of video ids")
    if len(removed) > MAX_ITEMS:
        raise _Invalid(f"edits.removed_video_ids: at most {MAX_ITEMS} videos")
    return T.ThemeSaveEdits(
        name=_opt_text(value, "name"),
        icon=_opt_text(value, "icon"),
        create_folder=create_folder,
        folder_name=_opt_text(value, "folder_name"),
        seed_actions=seed_actions,
        removed_video_ids=tuple(removed),
    )


def _submit(fn: Any, session_id: str | None) -> Envelope:
    jobs = wiring.get_jobs()
    with _SUBMIT_LOCK:
        if any(job.kind is T.JobKind.theme for job in jobs.list_active()):
            return fail("busy", BUSY_MESSAGE)
        job = jobs.submit(
            T.JobKind.theme,
            fn,
            event=READY_EVENT,
            progress_event=PROGRESS_EVENT,
            session_id=session_id,
        )
    return ok({"job": job})


@contract.real
def theme_create(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """theme.create.

    Builds a theme tab by research (expand, batch search, curate) up to the preview
    """
    query = params.get("query")
    if not isinstance(query, str) or not QUERY_MIN <= len(query.strip()) <= QUERY_MAX:
        return fail("invalid", f"query: a topic of {QUERY_MIN} to {QUERY_MAX} characters")
    text = query.strip()
    language, classics = params.get("language"), params.get("classics")
    try:
        clean_options(language, classics)  # invalid → ``invalid`` at once, no job
    except T.ValidationError as exc:
        return fail("invalid", exc.message)
    options: dict[str, Any] = {}
    if language is not None:
        options["language"] = language
    if classics is not None:
        options["classics"] = classics
    try:
        if not wiring.get_llm().available():
            return fail("llm_unavailable", NO_MODEL_MESSAGE)
        themes = wiring.get_themes()
        create: Any = themes.create
        return _submit(
            lambda progress: create(
                text, origin=T.Actor.user, timeout=JOB_TIMEOUT_S, on_progress=progress, **options
            ),
            session_id,
        )
    except T.TubeError as exc:
        return error_envelope(exc)


@contract.real
def theme_save(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """theme.save.

    Saves the theme as a tab (and an optional folder); applies seed follow/subscribe/ignore
    """
    try:
        theme_id = _theme_id(params)
        edits = _edits(params.get("edits"))
    except _Invalid as exc:
        return fail("invalid", str(exc))
    try:
        saved = wiring.get_themes().save(theme_id, edits, actor=T.Actor.user)
    except T.TubeError as exc:
        return error_envelope(exc)
    return ok(saved)


@contract.real
def theme_refresh(
    params: Mapping[str, Any], *, session_id: str | None = None, **kwargs: Any
) -> Envelope:
    """theme.refresh.

    New search + curation of a theme (kept videos stay)
    """
    try:
        theme_id = _theme_id(params)
    except _Invalid as exc:
        # the theme.refresh contract does not declare ``invalid``: a missing id = a missing theme
        return fail("not_found", str(exc))
    try:
        themes = wiring.get_themes()
        if themes.get(theme_id) is None:
            return fail("not_found", f"theme {theme_id[:80]} does not exist")
        if not wiring.get_llm().available():
            return fail("llm_unavailable", NO_MODEL_MESSAGE)
        refresh: Any = themes.refresh
        return _submit(
            lambda progress: refresh(
                theme_id, timeout=JOB_TIMEOUT_S, on_progress=progress, search=True
            ),
            session_id,
        )
    except T.TubeError as exc:
        return error_envelope(exc)
