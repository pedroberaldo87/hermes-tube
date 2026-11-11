"""Topic tabs built from YouTube search: ``ThemeService`` — owner of ``themes`` and
``theme_items``.

One function for every entry point: the ``theme.create`` RPC (Desktop, through ``JobRunner``),
the ``tube_theme_create`` tool and ``/tube theme`` all call the same ``create``.

- **create** (blocking, one ``timeout`` budget for everything, progress per named stage
  ``expand`` → ``search`` → ``curate`` → ``preview``): ``theme_expand`` (with earlier 👎)
  → **one** ``Searcher.search_many`` with every search by relevance **and** by date → dedup by
  ``video_id`` (up to ``MAX_CANDIDATES``) → candidates stored through ``VideoStore.upsert(origin=
  search)`` → ``Lens.classics`` of the enabled lenses when the mode is ``classics`` →
  ``theme_curate`` in batches of up to ``BATCH_SIZE`` (👎/👍 as examples; a video with 👎 never
  goes back to the model) → seeds = channels with ≥ ``SEED_MIN_KEEP`` kept videos →
  ``status=preview``. Nothing is followed and no tab exists before ``save``.
- **budget**: whatever does not fit becomes a **marked partial preview** in ``Theme.error`` (the
  topic stays ``preview``); an expansion with no answer uses the text itself as the search; an
  empty search becomes an empty preview with an explanation. Only two errors are raised: "no
  model" (``LLMUnavailable``, before anything is written) and total model failure (the topic
  becomes ``error`` with the message).
- **model output = untrusted data**: searches/names/terms cleaned and cut; a verdict only counts
  for a ``video_id`` of the batch, with no repeats, exact fields and the right types; the rest
  is ignored.
- **save**: tab ``kind=theme`` (``include.themes``, mode ``classics`` or ``long``: see
  ``tab_mode``) through ``TabService``, optional folder through ``TaxonomyService`` (reuses the
  one with the same name), seeds ``follow``/``subscribe`` → ``followed`` through
  ``ChannelService`` (actually subscribing is up to the person: ``ThemeSaved.to_subscribe``),
  ``ignore`` drops the seed; all in one undo group.
- **refresh**: new videos from the seeds already in the database (the ``Refresher``'s RSS;
  0 tokens) and, when ``cadence_days`` is due (or on request), a new search + curation of the
  new candidates only (kept videos stay). 👎 becomes ``user_down`` and leaves the tab.
- **expire**: abandoned previews (no tab) are deleted after ``PREVIEW_TTL_S``.
- **options and cancel**: structured options (``language``/``classics``, stored for later
  ``refresh`` runs), progress with ``Progress.step`` (the stage's numbers) and cancel points
  (``job.cancel``) between stages, between searches (lenses, seed RSS) and between batches; a
  cancelled ``create`` discards the preview, a cancelled ``refresh`` leaves the saved topic as
  it was.

The topic's mode (``fresh``/``classics``/``long``) and its ignored seeds live in
``meta['theme:<id>']`` (JSON) until there is a column for them.
"""

from __future__ import annotations

import contextvars
import json
import logging
import math
import re
import time
import uuid
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, replace
from typing import Any

from tube_pkg.core import dedup
from tube_pkg.core import types as T

log = logging.getLogger(__name__)

DAY = 86_400
BATCH_SIZE = 40
"""Videos per ``theme_curate`` call. The answer (one verdict per video) is what takes time, so
small calls finish sooner and can run side by side (see ``CURATE_PARALLEL``)."""
CURATE_PARALLEL = 4
"""``theme_curate`` calls in flight at once (the user's own model; a modest number so a
provider with low rate limits still copes)."""
MAX_CANDIDATES = BATCH_SIZE * CURATE_PARALLEL
"""Candidates per search: one wave of parallel calls (about 150 is the target)."""
CURATE_POLL_S = 0.25
"""While waiting for the model, how often the job checks for a cancel request."""
SEED_MIN_KEEP = 3
"""A channel with at least this many kept videos becomes a seed."""
CLASSICS_LIMIT = 50
"""Candidates asked of each ``Lens.classics`` call."""
PREVIEW_TTL_S = 7 * DAY
"""A preview (or error) with no tab is deleted after this long untouched."""
SEARCHING_TTL_S = DAY
"""A topic stuck in ``searching`` (the process died mid-way) is deleted after this long."""
SEED_WINDOW_S = 30 * DAY
"""Seed videos older than this are left out of ``refresh``."""
SEED_VIDEOS_MAX = 100
EXPAND_TIMEOUT_S = 30.0
"""Cap for the expansion (the rest of the budget goes to search and curation)."""
MIN_CALL_S = 3.0
"""Minimum budget to start a model call."""
SEARCH_RESERVE_S = 10.0
"""Time kept for curation when opening the search window."""

QUERY_MIN, QUERY_MAX = 2, 200
NAME_CHARS = 40
TAB_NAME_CHARS = 80
ICON_CHARS = 16
SEARCH_MIN, SEARCH_CHARS, MAX_SEARCHES = 2, 100, 8
TERM_CHARS, MAX_TERMS = 40, 12
TITLE_CHARS = 200
WHY_CHARS = 280
REACTION_TITLES = 30

STAGES = ("expand", "search", "curate", "preview")
"""``create`` stages in order (``refresh`` starts with ``seeds``)."""

NO_MODEL_MESSAGE = "No AI model is available. Pick one and sign in under Settings → Models."
"""Same text as ``core.ai.NO_MODEL_MESSAGE`` (a test keeps them equal); cores do not import
each other, so the text is repeated here."""
NO_MODEL = T.AI_STATUS_REASONS[0]
"""``details["reason"]`` of the "no model" ``LLMUnavailable`` (as ``core.ai.NO_MODEL``)."""
SEED_REASON = "New video from one of the topic's seed channels."
DOWN_REASON = "You marked it 👎."
REMOVED_REASON = "You removed it from the tab."

_VERDICT_KEYS = frozenset({"video_id", "keep", "score", "why"})
_CONTROL = re.compile(r"[\x00-\x1f\x7f\u2028\u2029]")
_JSON_LISTS = ("searches", "seeds", "include_terms", "exclude_terms")
_META_PREFIX = "theme:"


# --------------------------------------------------------------------------- cleaning


def one_line(value: Any, limit: int) -> str | None:
    """One line of text (control characters become spaces), cut at *limit*; empty → ``None``."""
    if not isinstance(value, str):
        return None
    text = " ".join(_CONTROL.sub(" ", value).split())
    if not text:
        return None
    return text[:limit].rstrip() or None


def clean_query(query: Any) -> str:
    text = one_line(query, QUERY_MAX + 1) if isinstance(query, str) else None
    if text is None or len(text) < QUERY_MIN:
        raise T.ValidationError("Write the topic with at least 2 characters.", field="query")
    if len(text) > QUERY_MAX:
        raise T.ValidationError(f"Topic too long (max. {QUERY_MAX}).", field="query")
    return text


def _texts(value: Any, *, limit: int, count: int, min_len: int = 1) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return ()
    out: list[str] = []
    seen: set[str] = set()
    for raw in value:
        text = one_line(raw, limit)
        if text is None or len(text) < min_len or text.casefold() in seen:
            continue
        seen.add(text.casefold())
        out.append(text)
        if len(out) >= count:
            break
    return tuple(out)


@dataclass(frozen=True)
class Plan:
    """Cleaned output of ``theme_expand``."""

    name: str
    icon: str | None
    searches: tuple[str, ...]
    include_terms: tuple[str, ...] = ()
    exclude_terms: tuple[str, ...] = ()
    mode: T.FeedMode = T.FeedMode.fresh
    classics: bool | None = None
    """The person's choice about adding classics (``None`` = ``mode`` decides)."""
    ask: str | None = None
    """The topic as the model reads it in curation (``model_query``); ``None`` = plain text."""


def fallback_plan(query: str) -> Plan:
    return Plan(name=query[:NAME_CHARS].rstrip(), icon=None, searches=(query[:SEARCH_CHARS],))


def clean_plan(raw: Any, query: str) -> Plan:
    """``theme_expand`` output → ``Plan`` (untrusted data: everything checked and cut)."""
    if not isinstance(raw, Mapping):
        return fallback_plan(query)
    searches = _texts(
        raw.get("searches"), limit=SEARCH_CHARS, count=MAX_SEARCHES, min_len=SEARCH_MIN
    )
    try:
        mode = T.FeedMode(raw.get("mode"))
    except ValueError:
        mode = T.FeedMode.fresh
    return Plan(
        name=one_line(raw.get("name"), NAME_CHARS) or query[:NAME_CHARS].rstrip(),
        icon=one_line(raw.get("icon"), ICON_CHARS),
        searches=searches or (query[:SEARCH_CHARS],),
        include_terms=_texts(raw.get("include_terms"), limit=TERM_CHARS, count=MAX_TERMS),
        exclude_terms=_texts(raw.get("exclude_terms"), limit=TERM_CHARS, count=MAX_TERMS),
        mode=mode,
    )


@dataclass(frozen=True)
class Options:
    """Structured choices of ``theme.create``. ``language=None`` = no restriction;
    ``classics=None`` = the model decides."""

    language: str | None = None
    classics: bool | None = None

    def to_meta(self) -> dict[str, Any]:
        return {"language": self.language, "classics": self.classics}


_LANGUAGE_HINTS = {
    "pt": "only videos in Portuguese (write the searches in Portuguese)",
    "en": "only videos in English (write the searches in English)",
}
_CLASSICS_HINTS = {
    True: "include the best videos of all time (evergreen classics), not only recent ones",
    False: "prefer recent videos",
}


def clean_options(language: Any = None, classics: Any = None) -> Options:
    """Validates ``language`` (``T.THEME_LANGUAGES`` or ``None``) and ``classics`` (bool or
    ``None``)."""
    if language is not None and (
        not isinstance(language, str) or language not in T.THEME_LANGUAGES
    ):
        raise T.ValidationError(
            f"language: use one of {', '.join(T.THEME_LANGUAGES)}", field="language"
        )
    if classics is not None and not isinstance(classics, bool):
        raise T.ValidationError("classics: expected true/false", field="classics")
    return Options(language=None if language == "any" else language, classics=classics)


def options_from_meta(meta: Mapping[str, Any]) -> Options:
    raw = meta.get("options")
    if not isinstance(raw, Mapping):
        return Options()
    try:
        return clean_options(raw.get("language"), raw.get("classics"))
    except T.ValidationError:
        return Options()


def model_query(query: str, options: Options) -> str:
    """The topic as the model reads it (expansion and curation): the person's text + the
    choices in English (the language of the instructions). No choices = the plain text (earlier
    behaviour). The text stored in ``themes.query`` stays the person's."""
    hints = []
    if options.language in _LANGUAGE_HINTS:
        hints.append(_LANGUAGE_HINTS[options.language])
    if options.classics is not None:
        hints.append(_CLASSICS_HINTS[options.classics])
    return f"{query} — {'; '.join(hints)}" if hints else query


def plan_mode(mode: T.FeedMode, options: Options) -> T.FeedMode:
    """The topic's mode with the person's choice over the model's: ``classics=True`` →
    ``classics`` (but ``long`` stays ``long``: the tab keeps filtering for long content, and the
    classics come in through ``Plan.classics``); ``False`` removes ``classics``."""
    if options.classics is True and mode is not T.FeedMode.long:
        return T.FeedMode.classics
    if options.classics is False and mode is T.FeedMode.classics:
        return T.FeedMode.fresh
    return mode


def joins_classics(plan: Plan) -> bool:
    """Add ``Lens.classics`` to the search? The person's choice (``Plan.classics``) wins;
    without it, the model's mode decides (earlier behaviour)."""
    return plan.classics if plan.classics is not None else plan.mode is T.FeedMode.classics


def tab_mode(mode: T.FeedMode) -> T.FeedMode:
    """Mode of the topic tab: ``classics`` (topic and HN tabs show everything curated), or
    ``long`` if the topic asks for long content. ``fresh`` on the tab would hide what was curated
    more than 30 days ago (in the live test, 64 of 75 videos); the topic's ``fresh`` mode only
    decides not to add classics."""
    return T.FeedMode.long if mode is T.FeedMode.long else T.FeedMode.classics


def _nonneg_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _valid_hit(hit: Any) -> bool:
    return (
        isinstance(hit, T.SearchHit)
        and isinstance(hit.video_id, str)
        and dedup.is_video_id(hit.video_id)
        and isinstance(hit.channel_id, str)
        and dedup.is_channel_id(hit.channel_id)
        and one_line(hit.title, TITLE_CHARS) is not None
    )


def _verdicts(out: Any, allowed: set[str], seen: set[str]) -> list[tuple[str, bool, float, str]]:
    """Valid ``theme_curate`` items: an id from the batch, no repeats, exact fields, right types."""
    items = out.get("items") if isinstance(out, Mapping) else None
    if not isinstance(items, list):
        return []
    result: list[tuple[str, bool, float, str]] = []
    for item in items:
        if not isinstance(item, Mapping) or set(item) != _VERDICT_KEYS:
            continue
        video_id, keep, score = item["video_id"], item["keep"], item["score"]
        if not isinstance(video_id, str) or video_id not in allowed or video_id in seen:
            continue
        if not isinstance(keep, bool):
            continue
        if isinstance(score, bool) or not isinstance(score, int | float):
            continue
        if not math.isfinite(score) or not 0 <= score <= 1:
            continue
        if not isinstance(item["why"], str):
            continue
        seen.add(video_id)
        result.append((video_id, keep, float(score), one_line(item["why"], WHY_CHARS) or ""))
    return result


def _matches(title: str, terms: Sequence[str]) -> bool:
    folded = title.casefold()
    return any(term.casefold() in folded for term in terms)


def _json_list(value: Any) -> tuple[str, ...]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return ()
    if not isinstance(value, list | tuple):
        return ()
    return tuple(v for v in value if isinstance(v, str))


def _theme_from_row(row: Mapping[str, Any]) -> T.Theme:
    return T.Theme(
        id=row["id"],
        query=row["query"],
        status=T.ThemeStatus(row["status"]),
        created_at=int(row["created_at"]),
        name=row["name"],
        icon=row["icon"],
        tab_id=row["tab_id"],
        searches=_json_list(row["searches"]),
        seeds=_json_list(row["seeds"]),
        include_terms=_json_list(row["include_terms"]),
        exclude_terms=_json_list(row["exclude_terms"]),
        last_search_at=row["last_search_at"],
        cadence_days=int(row["cadence_days"]),
        error=row["error"],
    )


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _log_phase(theme_id: str, phase: str, seconds: float, **sizes: Any) -> None:
    """One INFO line per phase (``theme <id> phase=<name> seconds=<s> key=value…``): what the
    server log needs to tell where the time of a theme went."""
    extra = "".join(f" {k}={v}" for k, v in sizes.items())
    log.info("theme %s phase=%s seconds=%.1f%s", theme_id, phase, seconds, extra)


# --------------------------------------------------------------------------- run


class _Run:
    """Budget, per-stage progress and timings of one ``create``/``refresh`` run."""

    def __init__(
        self, monotonic: Callable[[], float], timeout: float, on_progress: T.ProgressFn | None
    ) -> None:
        self.mono = monotonic
        self.start = monotonic()
        self.deadline = self.start + max(0.0, float(timeout))
        self.on_progress = on_progress
        self.timings: dict[str, float] = {}
        self.notes: list[str] = []
        self._stage: str | None = None
        self._since = self.start

    def remaining(self) -> float:
        return self.deadline - self.mono()

    def check(self) -> None:
        """Cancel point: cancelled job → ``T.Cancelled``; outside a job, nothing."""
        T.check_cancelled(self.on_progress)

    def stage(
        self,
        name: str,
        done: int = 0,
        total: int | None = None,
        message: str | None = None,
        *,
        step: tuple[int, int | None] | None = None,
    ) -> None:
        """Progress of stage *name*; *step* = ``(done, total)`` in the screen's numbers
        (``T.ProgressStep``). Calling ``on_progress`` is also a cancel point."""
        now = self.mono()
        if name != self._stage:
            self._close(now)
            self._stage, self._since = name, now
        if self.on_progress is not None:
            numbers = (
                T.ProgressStep(name=T.ThemeStep(name), done=step[0], total=step[1])
                if step is not None
                else None
            )
            self.on_progress(
                T.Progress(stage=name, done=done, total=total, message=message, step=numbers)
            )

    def _close(self, now: float) -> None:
        if self._stage is not None:
            self.timings[self._stage] = self.timings.get(self._stage, 0.0) + (now - self._since)

    def finish(self) -> dict[str, float]:
        self._close(self.mono())
        self._stage = None
        self.timings["total"] = self.mono() - self.start
        return {k: round(v, 3) for k, v in self.timings.items()}

    def note(self) -> str | None:
        return " ".join(self.notes) or None


@dataclass
class _Cand:
    hit: T.SearchHit
    source: T.ThemeItemSource


class ThemeService:
    """The real ``Themes`` (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        llm: T.LLM,
        searcher: T.Searcher,
        lenses: Sequence[T.Lens],
        tabs: T.TabService,
        taxonomy: T.TaxonomyService,
        channels: T.ChannelService,
        video_state: T.VideoStateService,
        video_store: T.VideoStore,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        monotonic: Callable[[], float] | None = None,
        new_id: Callable[[], str] | None = None,
        fetch_seed: Callable[[str], Any] | None = None,
        curate_parallel: int = CURATE_PARALLEL,
    ) -> None:
        self.db = db
        self.settings = settings
        self.llm = llm
        self.searcher = searcher
        self.lenses = list(lenses)
        self.tabs = tabs
        self.taxonomy = taxonomy
        self.channels = channels
        self.video_state = video_state
        self.video_store = video_store
        self.changelog = changelog
        self.clock = clock or T.SystemClock()
        self.monotonic = monotonic or time.monotonic
        self._new_id = new_id or (lambda: f"th_{uuid.uuid4().hex[:16]}")
        self.fetch_seed = fetch_seed
        """Optional: fetches the RSS of an unfollowed seed (e.g. ``Refresher.refresh_channel``)."""
        self.curate_parallel = max(1, int(curate_parallel))
        """``theme_curate`` calls in flight at once (1 = one after the other, in order)."""
        self.last_timings: dict[str, float] = {}
        """Seconds per stage of the last run (diagnostics)."""

    def _now(self) -> int:
        return int(self.clock.now())

    # ================================================================== reading

    def get(self, theme_id: str) -> T.Theme | None:
        if not isinstance(theme_id, str):
            return None
        row = self.db.query_one("SELECT * FROM themes WHERE id = ?", (theme_id,))
        return _theme_from_row(row) if row else None

    def _require(self, theme_id: Any) -> T.Theme:
        theme = self.get(theme_id)
        if theme is None:
            raise T.NotFound(f"topic {theme_id} does not exist", theme_id=theme_id)
        return theme

    def list(self) -> list[T.Theme]:
        rows = self.db.query("SELECT * FROM themes ORDER BY created_at DESC, id DESC")
        return [_theme_from_row(r) for r in rows]

    def preview(self, theme_id: str) -> T.ThemePreview:
        theme = self._require(theme_id)
        rows = self.db.query(
            "SELECT * FROM theme_items WHERE theme_id = ? AND verdict = 'keep'"
            " ORDER BY score DESC, video_id",
            (theme_id,),
        )
        ids = [r["video_id"] for r in rows]
        videos = self.video_store.get(ids) if ids else {}
        downs = self._downs(ids)
        items: list[T.ThemeItem] = []
        shown: dict[str, T.Video] = {}
        for r in rows:
            video = videos.get(r["video_id"])
            if video is None or r["video_id"] in downs:
                continue
            shown[video.id] = video
            items.append(
                T.ThemeItem(
                    theme_id=r["theme_id"],
                    video_id=r["video_id"],
                    verdict=T.ThemeVerdict(r["verdict"]),
                    source=T.ThemeItemSource(r["source"]),
                    score=r["score"],
                    reason=r["reason"],
                )
            )
        by_channel: dict[str, list[T.Video]] = {}
        for video in shown.values():
            by_channel.setdefault(video.channel_id, []).append(video)
        seeds = tuple(
            T.ThemeSeed(
                channel_id=c,
                title=self._channel_title(c, by_channel.get(c, [])),
                kept_videos=len(by_channel.get(c, [])),
            )
            for c in theme.seeds
        )
        return T.ThemePreview(
            theme=theme,
            items=tuple(items),
            videos=shown,
            seeds=seeds,
            channel_count=len(by_channel),
        )

    def _channel_title(self, channel_id: str, videos: Sequence[T.Video]) -> str:
        for video in videos:
            if video.channel_title:
                return video.channel_title
        channel = self.channels.get(channel_id)
        if channel is not None:
            return channel.title
        row = self.db.query_one(
            "SELECT channel_title FROM videos WHERE channel_id = ? AND channel_title IS NOT NULL"
            " LIMIT 1",
            (channel_id,),
        )
        return row["channel_title"] if row else channel_id

    def due(self, now: T.Timestamp | None = None) -> list[str]:
        now = self._now() if now is None else int(now)
        rows = self.db.query(
            "SELECT id FROM themes WHERE status = 'saved' AND"
            " (last_search_at IS NULL OR last_search_at + cadence_days * 86400 <= ?)"
            " ORDER BY id",
            (now,),
        )
        return [r["id"] for r in rows]

    # ================================================================== reactions

    def _downs(self, video_ids: Sequence[str]) -> set[str]:
        if not video_ids:
            return set()
        reactions = self.video_state.reactions(list(video_ids))
        return {v for v, r in reactions.items() if r is T.Reaction.down}

    def _reaction_titles(self, reaction: T.Reaction, first: Sequence[str] = ()) -> list[str]:
        """Titles with the reaction (newest first), *first* in front; up to 30."""
        marked = [v for v, r in self.video_state.reactions().items() if r is reaction]
        states = self.video_state.get(marked) if marked else {}
        marked.sort(key=lambda v: (-(states[v].updated_at if v in states else 0), v))
        ids = list(dict.fromkeys([*first, *marked]))[: REACTION_TITLES * 2]
        videos = self.video_store.get(ids) if ids else {}
        titles = [t for v in ids if v in videos and (t := one_line(videos[v].title, TITLE_CHARS))]
        return list(dict.fromkeys(titles))[:REACTION_TITLES]

    def _user_down_ids(self, theme_id: str) -> list[str]:
        rows = self.db.query(
            "SELECT video_id FROM theme_items WHERE theme_id = ? AND verdict = 'user_down'"
            " ORDER BY video_id",
            (theme_id,),
        )
        return [r["video_id"] for r in rows]

    def _sync_downs(self, theme_id: str) -> int:
        """A kept item that got 👎 becomes ``user_down`` (it leaves the tab)."""
        rows = self.db.query(
            "SELECT video_id FROM theme_items WHERE theme_id = ? AND verdict = 'keep'", (theme_id,)
        )
        downs = self._downs([r["video_id"] for r in rows])
        for video_id in sorted(downs):
            self.db.execute(
                "UPDATE theme_items SET verdict = 'user_down', reason = ? WHERE theme_id = ?"
                " AND video_id = ?",
                (DOWN_REASON, theme_id, video_id),
            )
        return len(downs)

    # ================================================================== meta

    def _meta(self, theme_id: str) -> dict[str, Any]:
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (_META_PREFIX + theme_id,))
        try:
            data = json.loads(row["value"]) if row and row["value"] else {}
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    def _set_meta(self, theme_id: str, data: Mapping[str, Any]) -> None:
        self.db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (_META_PREFIX + theme_id, _dump(dict(data))),
        )

    def mode(self, theme_id: str) -> T.FeedMode:
        try:
            return T.FeedMode(self._meta(theme_id).get("mode"))
        except ValueError:
            return T.FeedMode.fresh

    # ================================================================== create

    def create(
        self,
        query: str,
        *,
        origin: T.Actor = T.Actor.user,
        timeout: float = T.TOOL_TIMEOUT_S,
        on_progress: T.ProgressFn | None = None,
        language: str | None = None,
        classics: bool | None = None,
    ) -> T.ThemePreview:
        text = clean_query(query)
        options = clean_options(language, classics)
        origin = T.Actor(origin)
        if not self.llm.available():
            raise T.LLMUnavailable(NO_MODEL_MESSAGE, reason=NO_MODEL)
        run = _Run(self.monotonic, timeout, on_progress)
        self.expire()
        run.stage("expand", 0, 1, "Understanding the topic…", step=(0, None))
        theme_id = self._new_id()
        now = self._now()
        self.db.execute(
            "INSERT INTO themes (id, query, name, cadence_days, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, 'searching', ?, ?)",
            (theme_id, text, text[:NAME_CHARS].rstrip(), self._cadence(), now, now),
        )
        log.info("topic %s created by %s: %r", theme_id, origin.value, text)
        try:
            ask = model_query(text, options)
            plan = self._expand(text, run, ask=ask, theme_id=theme_id)
            plan = replace(
                plan,
                mode=plan_mode(plan.mode, options),
                classics=options.classics,
                ask=ask if ask != text else None,
            )
            self.db.execute(
                "UPDATE themes SET name = ?, icon = ?, searches = ?, include_terms = ?,"
                " exclude_terms = ?, updated_at = ? WHERE id = ?",
                (
                    plan.name,
                    plan.icon,
                    _dump(list(plan.searches)),
                    _dump(list(plan.include_terms)),
                    _dump(list(plan.exclude_terms)),
                    self._now(),
                    theme_id,
                ),
            )
            meta: dict[str, Any] = {"mode": plan.mode.value, "ignored_seeds": []}
            if options != Options():
                meta["options"] = options.to_meta()
            self._set_meta(theme_id, meta)
            n = len(plan.searches)
            run.stage("expand", 1, 1, f"{n} searches planned", step=(n, n))
            evaluated = self._search_and_curate(
                theme_id, text, plan, run, known=set(), explain_empty=True
            )
            run.check()
            seeds = self._compute_seeds(theme_id, ignored=())
            self.db.execute(
                "UPDATE themes SET status = 'preview', seeds = ?, last_search_at = ?, error = ?,"
                " updated_at = ? WHERE id = ?",
                (_dump(seeds), self._now(), run.note(), self._now(), theme_id),
            )
        except T.Cancelled:
            self._discard(theme_id)
            raise
        except T.TubeError as exc:
            self._fail(theme_id, exc.message)
            raise
        except Exception as exc:
            self._fail(theme_id, f"Internal error while building the topic ({type(exc).__name__}).")
            raise
        result = self.preview(theme_id)
        try:
            run.stage(
                "preview", 1, 1, self._summary(result, run), step=(result.video_count, evaluated)
            )
        except T.Cancelled:
            self._discard(theme_id)
            raise
        self.last_timings = run.finish()
        log.info("topic %s ready in %s", theme_id, self.last_timings)
        _log_phase(theme_id, "total", self.last_timings.get("total", 0.0), kept=result.video_count)
        return result

    def _discard(self, theme_id: str) -> None:
        """Cancelled mid-way: the preview does not stay — the topic with no tab and what it wrote
        are deleted (videos found stay in the ``videos`` cache, like any search)."""
        try:
            with self.db.transaction():
                row = self.db.query_one(
                    "SELECT id FROM themes WHERE id = ? AND tab_id IS NULL"
                    " AND status IN ('searching', 'preview', 'error')",
                    (theme_id,),
                )
                if row is None:
                    return
                self.db.execute("DELETE FROM theme_items WHERE theme_id = ?", (theme_id,))
                self.db.execute("DELETE FROM meta WHERE key = ?", (_META_PREFIX + theme_id,))
                self.db.execute("DELETE FROM themes WHERE id = ?", (theme_id,))
            log.info("topic %s cancelled: discarded", theme_id)
        except Exception:  # noqa: BLE001 — the cancel is what matters; expiry cleans up
            log.exception("could not discard the cancelled topic %s", theme_id)

    def _cadence(self) -> int:
        try:
            value = int(self.settings.get("theme_refresh_days", 7))
        except (TypeError, ValueError):
            value = 7
        return max(1, value)

    def _fail(self, theme_id: str, message: str) -> None:
        try:
            self.db.execute(
                "UPDATE themes SET status = 'error', error = ?, updated_at = ? WHERE id = ?"
                " AND status = 'searching'",
                (message, self._now(), theme_id),
            )
        except Exception:  # noqa: BLE001 — the original error is what matters
            log.exception("could not mark topic %s as an error", theme_id)

    @staticmethod
    def _summary(preview: T.ThemePreview, run: _Run) -> str:
        text = (
            f"{preview.video_count} videos from {preview.channel_count} channels,"
            f" {len(preview.seeds)} seeds"
        )
        note = run.note()
        return f"{text}. {note}" if note else text

    def _expand(
        self, query: str, run: _Run, *, ask: str | None = None, theme_id: str = "?"
    ) -> Plan:
        budget = min(EXPAND_TIMEOUT_S, run.remaining() - SEARCH_RESERVE_S)
        if budget < MIN_CALL_S:
            run.notes.append("No time to plan the searches; searched for the topic itself.")
            plan = fallback_plan(query)
            _log_phase(theme_id, "expand", 0.0, searches=len(plan.searches), fallback="no_time")
            return plan
        payload = {"query": ask or query, "disliked_titles": self._reaction_titles(T.Reaction.down)}
        started = self.monotonic()
        try:
            raw = self.llm.complete_structured(T.AiTask.theme_expand, payload, timeout=budget)
        except (T.OperationTimeout, T.LLMInvalidResponse) as exc:
            log.info("theme_expand failed (%s); searching for the topic itself", exc.message)
            run.notes.append(
                "The model did not plan the searches in time; searched for the topic itself."
            )
            plan = fallback_plan(query)
            _log_phase(
                theme_id,
                "expand",
                self.monotonic() - started,
                searches=len(plan.searches),
                input_chars=len(_dump(payload)),
                fallback=type(exc).__name__,
            )
            return plan
        run.check()  # an expansion that came back after a cancel goes no further
        plan = clean_plan(raw, query)
        _log_phase(
            theme_id,
            "expand",
            self.monotonic() - started,
            searches=len(plan.searches),
            input_chars=len(_dump(payload)),
        )
        return plan

    # ------------------------------------------------------------------ search + curation

    def _search_and_curate(
        self,
        theme_id: str,
        query: str,
        plan: Plan,
        run: _Run,
        *,
        known: set[str],
        explain_empty: bool,
    ) -> int:
        """One ``search_many`` + classics + curation; returns how many videos were rated."""
        requests = [
            T.SearchRequest(query=s, order=order, theme_id=theme_id)
            for s in plan.searches
            for order in (T.SearchOrder.relevance, T.SearchOrder.date)
        ]
        run.stage(
            "search",
            0,
            len(requests),
            f"Running {len(plan.searches)} searches on YouTube…",
            step=(0, None),
        )
        window = max(1.0, min(T.SEARCH_WINDOW_S, run.remaining() - SEARCH_RESERVE_S))
        started = self.monotonic()
        errors: list[str] = []
        try:
            outcomes = list(self.searcher.search_many(requests, timeout=window))
        except T.TubeError as exc:
            outcomes, errors = [], [exc.message]
        run.check()  # between the YouTube search and classics/curation
        cands: dict[str, _Cand] = {}
        for outcome in outcomes:
            if outcome.error:
                errors.append(outcome.error)
            for hit in outcome.hits:
                if _valid_hit(hit) and hit.video_id not in known:
                    cands.setdefault(hit.video_id, _Cand(hit, T.ThemeItemSource.search))
        if joins_classics(plan):
            for hit in self._classics(query, run):
                if _valid_hit(hit) and hit.video_id not in known:
                    cands.setdefault(hit.video_id, _Cand(hit, T.ThemeItemSource.classics))
        downs = self._downs(list(cands))
        for video_id in downs:
            cands.pop(video_id)
        chosen = list(cands.values())[:MAX_CANDIDATES]
        found = len(chosen)
        _log_phase(
            theme_id,
            "search",
            self.monotonic() - started,
            requests=len(requests),
            hits=sum(len(o.hits) for o in outcomes),
            unique=len(cands),
            candidates=found,
            errors=len(errors),
        )
        run.stage(
            "search",
            len(requests),
            len(requests),
            f"{found} videos found",
            step=(found, found),
        )
        if chosen:
            self.video_store.upsert([c.hit.to_video_in() for c in chosen], T.VideoOrigin.search)
        elif explain_empty:
            if errors and len(errors) >= len(requests):
                run.notes.append(f"No videos: the YouTube search failed ({errors[0]}).")
            else:
                run.notes.append("No videos found for this topic. Try other words.")
        return self._curate(theme_id, query, plan, chosen, run)

    def _classics(self, query: str, run: _Run | None = None) -> list[T.SearchHit]:
        out: list[T.SearchHit] = []
        for lens in self.lenses:
            if run is not None:
                run.check()  # between lens searches (outside the ``try`` that swallows errors)
            try:
                if lens.enabled():
                    out.extend(lens.classics(query, CLASSICS_LIMIT))
            except Exception:  # noqa: BLE001 — a broken lens does not bring the topic down
                log.warning("lens %r failed in classics", getattr(lens, "name", lens))
        return out

    def _curate(
        self, theme_id: str, query: str, plan: Plan, chosen: Sequence[_Cand], run: _Run
    ) -> int:
        total_batches = (len(chosen) + BATCH_SIZE - 1) // BATCH_SIZE
        found = len(chosen)
        run.stage("curate", 0, total_batches, f"Rating {found} videos…", step=(0, found))
        if not chosen:
            return 0
        context = {
            "query": plan.ask or query,
            "include_terms": list(plan.include_terms),
            "exclude_terms": list(plan.exclude_terms),
            "disliked_titles": self._reaction_titles(
                T.Reaction.down, first=self._user_down_ids(theme_id)
            ),
            "liked_titles": self._reaction_titles(T.Reaction.up),
        }
        batches = [chosen[i : i + BATCH_SIZE] for i in range(0, len(chosen), BATCH_SIZE)]
        payloads = [{**context, "items": [self._curate_item(c) for c in b]} for b in batches]
        sizes = [len(_dump(p)) for p in payloads]
        workers = min(self.curate_parallel, total_batches)
        seen: set[str] = set()
        evaluated = failed = finished = kept = 0
        stopped = False
        last_invalid: T.LLMInvalidResponse | None = None
        started = self.monotonic()
        queue = deque(range(total_batches))
        running: dict[Future[Any], int] = {}
        # Up to ``workers`` calls in flight; a new one starts when one ends (never after the
        # budget ran out). Only this thread writes, reports progress and checks for a cancel:
        # the pool threads just call the model.
        pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tube-theme-curate")
        try:
            while queue or running:
                while queue and len(running) < workers and not stopped:
                    run.check()  # between curation batches
                    index = queue.popleft()
                    # Each call runs in a copy of this thread's context: the host keeps the
                    # profile it is serving in a context variable and checks the AI route against
                    # it; a bare pool thread would be refused.
                    call_ctx = contextvars.copy_context()
                    future = pool.submit(call_ctx.run, self._curate_call, payloads[index], run)
                    running[future] = index
                if not running:
                    break
                done, _ = wait(list(running), timeout=CURATE_POLL_S, return_when=FIRST_COMPLETED)
                run.check()  # a cancel lands here without waiting for the model
                for future in sorted(done, key=lambda f: running[f]):
                    index = running.pop(future)
                    batch = batches[index]
                    try:
                        got = future.result()
                    except T.OperationTimeout:
                        stopped = True
                        continue
                    except T.LLMInvalidResponse as exc:
                        log.info("theme_curate: batch %d rejected: %s", index + 1, exc.message)
                        failed += len(batch)
                        last_invalid = exc
                        continue
                    if got is None:  # no budget left when its turn came
                        stopped = True
                        continue
                    out, seconds = got
                    sources = {c.hit.video_id: c.source for c in batch}
                    verdicts = _verdicts(out, set(sources), seen)
                    self._write_items(theme_id, [(*v, sources[v[0]]) for v in verdicts])
                    evaluated += len(batch)
                    finished += 1
                    batch_kept = sum(1 for v in verdicts if v[1])
                    kept += batch_kept
                    _log_phase(
                        theme_id,
                        "curate_batch",
                        seconds,
                        index=f"{index + 1}/{total_batches}",
                        items=len(batch),
                        input_chars=sizes[index],
                        kept=batch_kept,
                    )
                    run.stage(
                        "curate",
                        finished,
                        total_batches,
                        f"{evaluated} of {found} videos rated",
                        step=(evaluated, found),
                    )
        finally:
            # cancelled or failed: calls still in flight end on their own; nothing is written
            pool.shutdown(wait=False, cancel_futures=True)
        _log_phase(
            theme_id,
            "curate",
            self.monotonic() - started,
            candidates=found,
            batches=total_batches,
            parallel=workers,
            evaluated=evaluated,
            kept=kept,
            input_chars=sum(sizes),
            stopped=stopped,
        )
        if evaluated == 0 and last_invalid is not None and not stopped:
            raise last_invalid
        total = len(chosen)
        if stopped:
            run.notes.append(f"Partial preview: time ran out with {evaluated} of {total} rated.")
        elif failed:
            run.notes.append(f"Partial preview: the model did not rate {failed} of {total} videos.")
        return evaluated

    def _curate_call(self, payload: Mapping[str, Any], run: _Run) -> tuple[Any, float] | None:
        """One ``theme_curate`` call (runs on a pool thread): ``(answer, seconds)``, or ``None``
        when the budget is gone by the time its turn comes. Writes nothing."""
        remaining = run.remaining()
        if remaining < MIN_CALL_S:
            return None
        started = self.monotonic()
        out = self.llm.complete_structured(
            T.AiTask.theme_curate, payload, timeout=max(1.0, remaining - 0.5)
        )
        return out, self.monotonic() - started

    @staticmethod
    def _curate_item(cand: _Cand) -> dict[str, Any]:
        hit = cand.hit
        return {
            "video_id": hit.video_id,
            "title": one_line(hit.title, TITLE_CHARS) or hit.video_id,
            "channel_title": one_line(hit.channel_title, TITLE_CHARS),
            "duration_s": _nonneg_int(hit.duration_s),
            "views": _nonneg_int(hit.views),
            "published_text": one_line(hit.published_text, TITLE_CHARS),
            "source": cand.source.value,
        }

    def _write_items(
        self,
        theme_id: str,
        rows: Sequence[tuple[str, bool, float | None, str | None, T.ThemeItemSource]],
    ) -> None:
        if not rows:
            return
        with self.db.transaction():
            for video_id, keep, score, reason, source in rows:
                self.db.execute(
                    "INSERT INTO theme_items (theme_id, video_id, reason, score, source, verdict)"
                    " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(theme_id, video_id) DO UPDATE SET"
                    " reason = excluded.reason, score = excluded.score, verdict = CASE"
                    " WHEN theme_items.verdict IN ('keep', 'user_down') THEN theme_items.verdict"
                    " ELSE excluded.verdict END",
                    (theme_id, video_id, reason, score, source.value, "keep" if keep else "cut"),
                )

    def _compute_seeds(self, theme_id: str, *, ignored: Sequence[str]) -> list[str]:
        rows = self.db.query(
            "SELECT v.channel_id AS c, COUNT(*) AS n FROM theme_items ti JOIN videos v"
            " ON v.id = ti.video_id WHERE ti.theme_id = ? AND ti.verdict = 'keep'"
            " GROUP BY v.channel_id HAVING COUNT(*) >= ? ORDER BY n DESC, c",
            (theme_id, SEED_MIN_KEEP),
        )
        skip = set(ignored)
        return [r["c"] for r in rows if r["c"] not in skip]

    # ================================================================== refresh

    def refresh(
        self,
        theme_id: str,
        *,
        timeout: float = T.TOOL_TIMEOUT_S,
        on_progress: T.ProgressFn | None = None,
        search: bool | None = None,
    ) -> T.ThemePreview:
        """New videos from the seeds (0 tokens) and, if ``search`` (``None`` = when
        ``cadence_days`` is due), a new search + curation of the new candidates only."""
        theme = self._require(theme_id)
        if theme.status is T.ThemeStatus.searching:
            raise T.Conflict("the topic is still being built", theme_id=theme_id)
        if search is True and not self.llm.available():
            raise T.LLMUnavailable(NO_MODEL_MESSAGE, reason=NO_MODEL)
        run = _Run(self.monotonic, timeout, on_progress)
        meta = self._meta(theme_id)
        ignored = _json_list(meta.get("ignored_seeds"))
        options = options_from_meta(meta)
        n_seeds = len(theme.seeds)
        run.stage("seeds", 0, n_seeds, "Reading new videos from the seeds…", step=(0, n_seeds))
        evaluated: int | None = None
        try:
            self._sync_downs(theme_id)
            added = self._pull_seeds(theme, run)
            run.stage(
                "seeds", n_seeds, n_seeds, f"{added} videos from the seeds", step=(n_seeds, n_seeds)
            )
            now = self._now()
            due = theme.last_search_at is None or (
                theme.last_search_at + theme.cadence_days * DAY <= now
            )
            do_search = due if search is None else search
            if do_search and not self.llm.available():
                run.notes.append("No AI model: only the seed channels' videos were refreshed.")
                do_search = False
            last_search_at = theme.last_search_at
            if do_search:
                ask = model_query(theme.query, options)
                plan = Plan(
                    name=theme.name or theme.query,
                    icon=theme.icon,
                    searches=theme.searches or (theme.query[:SEARCH_CHARS],),
                    include_terms=theme.include_terms,
                    exclude_terms=theme.exclude_terms,
                    mode=self.mode(theme_id),
                    classics=options.classics,
                    ask=ask if ask != theme.query else None,
                )
                known = {
                    r["video_id"]
                    for r in self.db.query(
                        "SELECT video_id FROM theme_items WHERE theme_id = ?", (theme_id,)
                    )
                }
                evaluated = self._search_and_curate(
                    theme_id, theme.query, plan, run, known=known, explain_empty=False
                )
                last_search_at = self._now()
            run.check()
            seeds = self._compute_seeds(theme_id, ignored=ignored)
            self.db.execute(
                "UPDATE themes SET seeds = ?, last_search_at = ?, error = ?, updated_at = ?"
                " WHERE id = ?",
                (_dump(seeds), last_search_at, run.note(), self._now(), theme_id),
            )
        except T.TubeError as exc:
            self.db.execute(
                "UPDATE themes SET error = ?, updated_at = ? WHERE id = ?",
                (exc.message, self._now(), theme_id),
            )
            raise
        # ``T.Cancelled`` passes straight through: the saved topic stays as it was (no error
        # stored); what already came in (seed videos, curated batches) still counts
        result = self.preview(theme_id)
        run.stage("preview", 1, 1, self._summary(result, run), step=(result.video_count, evaluated))
        self.last_timings = run.finish()
        return result

    def _pull_seeds(self, theme: T.Theme, run: _Run) -> int:
        """Recent seed videos already in the database become ``keep``/``rss``."""
        if not theme.seeds:
            return 0
        if self.fetch_seed is not None:
            for channel_id in theme.seeds:
                run.check()  # between the seeds' RSS fetches
                channel = self.channels.get(channel_id)
                followed = channel is not None and channel.relation in (
                    T.Relation.subscribed,
                    T.Relation.followed,
                )
                if followed or run.remaining() < MIN_CALL_S:
                    continue  # the Refresher already handles followed channels
                try:
                    self.fetch_seed(channel_id)
                except Exception:  # noqa: BLE001 — one bad seed does not bring the rest down
                    log.info("RSS of seed %s failed", channel_id, exc_info=True)
        marks = ",".join("?" for _ in theme.seeds)
        rows = self.db.query(
            f"SELECT id, title FROM videos WHERE channel_id IN ({marks})"
            " AND (published_at IS NULL OR published_at >= ?)"
            " AND id NOT IN (SELECT video_id FROM theme_items WHERE theme_id = ?)"
            " ORDER BY published_at DESC, id LIMIT ?",
            (*theme.seeds, self._now() - SEED_WINDOW_S, theme.id, SEED_VIDEOS_MAX),
        )
        downs = self._downs([r["id"] for r in rows])
        picked = [
            (r["id"], True, None, SEED_REASON, T.ThemeItemSource.rss)
            for r in rows
            if r["id"] not in downs and not _matches(r["title"] or "", theme.exclude_terms)
        ]
        self._write_items(theme.id, picked)
        return len(picked)

    # ================================================================== save

    def save(
        self,
        theme_id: str,
        edits: T.ThemeSaveEdits | None = None,
        *,
        actor: T.Actor = T.Actor.user,
    ) -> T.ThemeSaved:
        actor = T.Actor(actor)
        edits = edits if edits is not None else T.ThemeSaveEdits()
        if not isinstance(edits, T.ThemeSaveEdits):
            raise T.ValidationError("invalid topic edits", field="edits")
        theme = self._require(theme_id)
        if theme.status is T.ThemeStatus.saved:
            raise T.Conflict("this topic is already a tab", theme_id=theme_id, tab_id=theme.tab_id)
        if theme.status is not T.ThemeStatus.preview:
            raise T.Conflict(
                "the topic has no preview yet (still building, or it failed)", theme_id=theme_id
            )
        name = self._edit_text(edits.name, "name", TAB_NAME_CHARS) or theme.name or theme.query
        folder_name = self._edit_text(edits.folder_name, "folder_name", TAB_NAME_CHARS) or name
        icon = theme.icon if edits.icon is None else self._edit_text(edits.icon, "icon", 64)
        kept = self.db.query(
            "SELECT ti.video_id, v.channel_id, v.channel_title FROM theme_items ti"
            " LEFT JOIN videos v ON v.id = ti.video_id WHERE ti.theme_id = ?"
            " AND ti.verdict = 'keep'",
            (theme_id,),
        )
        kept_ids = {r["video_id"] for r in kept}
        titles: dict[str, str] = {}
        for r in kept:
            if r["channel_id"]:
                titles.setdefault(r["channel_id"], r["channel_title"] or r["channel_id"])
        actions = self._seed_actions(edits.seed_actions, titles)
        removed = self._removed(edits.removed_video_ids, kept_ids)
        meta = self._meta(theme_id)
        mode = self.mode(theme_id)
        ignored_before = list(_json_list(meta.get("ignored_seeds")))
        follow_ids = [c for c, a in actions.items() if a is not T.SeedAction.ignore]
        subscribe_ids = [c for c, a in actions.items() if a is T.SeedAction.subscribe]
        ignore_ids = [c for c, a in actions.items() if a is T.SeedAction.ignore]
        followed: list[str] = []
        to_subscribe: list[str] = []
        with self.db.transaction(), self.changelog.group(f"save topic {name}"):
            folder_id = None
            if edits.create_folder:
                found = self.taxonomy.find_folder_by_name(folder_name, parent_id=None)
                folder = found or self.taxonomy.create_folder(folder_name, actor=actor)
                folder_id = folder.id
            tab = self.tabs.create(
                T.TabDraft(
                    name=name,
                    kind=T.TabKind.theme,
                    icon=icon,
                    rules=T.TabRules(
                        include=T.RuleInclude(themes=(theme_id,)), mode=tab_mode(mode)
                    ),
                ),
                actor=actor,
            )
            if follow_ids:
                # history always as a user action: the whole group has to undo
                self.channels.upsert_many(
                    [
                        T.ChannelIn(title=titles[c], channel_id=c, folder_id=folder_id)
                        for c in follow_ids
                    ],
                    source=T.ChannelSource.theme,
                    relation=T.Relation.followed,
                    actor=T.Actor.user,
                )
                relations = {c: getattr(self.channels.get(c), "relation", None) for c in follow_ids}
                followed = [
                    c
                    for c in follow_ids
                    if relations[c] in (T.Relation.followed, T.Relation.subscribed)
                ]
                to_subscribe = [c for c in subscribe_ids if relations[c] is T.Relation.followed]
            for video_id in removed:
                self.db.execute(
                    "UPDATE theme_items SET verdict = 'user_down', reason = ? WHERE theme_id = ?"
                    " AND video_id = ?",
                    (REMOVED_REASON, theme_id, video_id),
                )
            ignored_now = list(dict.fromkeys([*ignored_before, *ignore_ids]))
            seeds = [s for s in theme.seeds if s not in ignore_ids]
            self.db.execute(
                "UPDATE themes SET status = 'saved', tab_id = ?, name = ?, icon = ?, seeds = ?,"
                " updated_at = ? WHERE id = ?",
                (tab.id, name, icon, _dump(seeds), self._now(), theme_id),
            )
            self._set_meta(theme_id, {**meta, "mode": mode.value, "ignored_seeds": ignored_now})
            rec = self.changelog.record(
                actor,
                T.ChangeAction.theme_save,
                {
                    "label": name,
                    "theme_id": theme_id,
                    "count": len(kept_ids) - len(removed),
                    "removed": list(removed),
                    "before": {
                        "name": theme.name,
                        "icon": theme.icon,
                        "seeds": list(theme.seeds),
                        "ignored_seeds": ignored_before,
                    },
                },
                T.UndoThemeSave(
                    theme_id=theme_id, tab_id=tab.id, folder_id=folder_id, followed=tuple(followed)
                ),
            )
        return T.ThemeSaved(
            theme_id=theme_id,
            tab=tab,
            folder_id=folder_id,
            followed=tuple(followed),
            to_subscribe=tuple(to_subscribe),
            change_id=rec.id,
        )

    @staticmethod
    def _edit_text(value: Any, label: str, limit: int) -> str | None:
        if value is None:
            return None
        text = one_line(value, limit + 1) if isinstance(value, str) else None
        if text is None:
            raise T.ValidationError(f"{label} empty or invalid", field=label)
        if len(text) > limit:
            raise T.ValidationError(f"{label} too long (max. {limit})", field=label)
        return text

    @staticmethod
    def _seed_actions(raw: Any, titles: Mapping[str, str]) -> dict[str, T.SeedAction]:
        if raw is None:
            return {}
        if not isinstance(raw, Mapping):
            raise T.ValidationError("seed_actions: expected an object channel → action")
        out: dict[str, T.SeedAction] = {}
        for channel_id, action in raw.items():
            if not isinstance(channel_id, str) or not dedup.is_channel_id(channel_id):
                raise T.ValidationError(f"seed_actions: invalid channel {channel_id!r}")
            if channel_id not in titles:
                raise T.ValidationError(
                    f"seed_actions: channel {channel_id} has no videos in this topic",
                    field="seed_actions",
                )
            try:
                out[channel_id] = T.SeedAction(action)
            except ValueError as exc:
                raise T.ValidationError(f"seed_actions: invalid action {action!r}") from exc
        return out

    @staticmethod
    def _removed(raw: Any, kept: set[str]) -> list[str]:
        if raw is None:
            return []
        if not isinstance(raw, list | tuple) or not all(isinstance(v, str) for v in raw):
            raise T.ValidationError("removed_video_ids: expected a list of ids")
        bad = [v for v in raw if v not in kept]
        if bad:
            raise T.ValidationError(f"removed_video_ids: not in the preview {bad[:5]}")
        return list(dict.fromkeys(raw))

    # ================================================================== undo

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if T.ChangeAction(change.action) is not T.ChangeAction.theme_save or not isinstance(
            u, T.UndoThemeSave
        ):
            raise T.UndoRefused("not_undoable", f"topics do not undo {change.action}")
        if self.get(u.theme_id) is None:
            raise T.UndoRefused("not_undoable", "the topic no longer exists", theme_id=u.theme_id)
        payload = change.payload if isinstance(change.payload, Mapping) else {}
        before = payload.get("before") if isinstance(payload.get("before"), Mapping) else {}
        current = self._require(u.theme_id)
        name = before.get("name") if isinstance(before.get("name"), str) else current.name
        icon = before.get("icon") if "icon" in before else current.icon
        seeds = list(_json_list(before.get("seeds"))) if "seeds" in before else None
        self.db.execute(
            "UPDATE themes SET status = 'preview', tab_id = NULL, name = ?, icon = ?,"
            " seeds = COALESCE(?, seeds), updated_at = ? WHERE id = ?",
            (
                name,
                icon if isinstance(icon, str) or icon is None else current.icon,
                _dump(seeds) if seeds is not None else None,
                self._now(),
                u.theme_id,
            ),
        )
        for video_id in _json_list(payload.get("removed")):
            self.db.execute(
                "UPDATE theme_items SET verdict = 'keep', reason = NULL WHERE theme_id = ?"
                " AND video_id = ? AND verdict = 'user_down'",
                (u.theme_id, video_id),
            )
        if "ignored_seeds" in before:
            meta = self._meta(u.theme_id)
            meta["ignored_seeds"] = list(_json_list(before.get("ignored_seeds")))
            self._set_meta(u.theme_id, meta)

    # ================================================================== maintenance

    def expire(self, now: T.Timestamp | None = None) -> int:
        """Deletes previews/errors with no tab untouched for ``PREVIEW_TTL_S`` (and ``searching``
        stuck for ``SEARCHING_TTL_S``). Idempotent; returns how many topics."""
        now = self._now() if now is None else int(now)
        rows = self.db.query(
            "SELECT id FROM themes WHERE tab_id IS NULL AND ("
            "(status IN ('preview', 'error') AND updated_at < ?)"
            " OR (status = 'searching' AND updated_at < ?))",
            (now - PREVIEW_TTL_S, now - SEARCHING_TTL_S),
        )
        ids = [r["id"] for r in rows]
        if not ids:
            return 0
        with self.db.transaction():
            for theme_id in ids:
                self.db.execute("DELETE FROM theme_items WHERE theme_id = ?", (theme_id,))
                self.db.execute("DELETE FROM themes WHERE id = ?", (theme_id,))
                self.db.execute("DELETE FROM meta WHERE key = ?", (_META_PREFIX + theme_id,))
        log.info("expired topic previews: %s", ids)
        return len(ids)

    def import_rows(self, rows: Sequence[Mapping[str, Any]]) -> int:
        """Restores topics from a backup (``export_json`` format: a ``themes`` row + ``items``).

        A topic that already exists is skipped (idempotent); a tab that does not exist → null
        ``tab_id`` and the topic goes back to ``preview``. An invalid row is ignored. Returns
        how many topics came in."""
        count = 0
        for row in rows if isinstance(rows, list | tuple) else ():
            try:
                if self._import_one(row):
                    count += 1
            except (T.TubeError, ValueError, TypeError) as exc:
                log.info("topic from the backup ignored: %s", exc)
        return count

    def _import_one(self, row: Any) -> bool:
        if not isinstance(row, Mapping):
            return False
        theme_id, query = row.get("id"), one_line(row.get("query"), QUERY_MAX)
        if not isinstance(theme_id, str) or not theme_id.strip() or query is None:
            return False
        if self.get(theme_id) is not None:
            return False
        try:
            status = T.ThemeStatus(row.get("status"))
        except ValueError:
            status = T.ThemeStatus.preview
        tab_id = row.get("tab_id") if isinstance(row.get("tab_id"), str) else None
        if tab_id is not None and self.tabs.get(tab_id) is None:
            tab_id = None
        if status in (T.ThemeStatus.saved, T.ThemeStatus.searching) and tab_id is None:
            status = T.ThemeStatus.preview
        if status is not T.ThemeStatus.saved:
            tab_id = None
        now = self._now()
        created = row.get("created_at")
        created_at = created if isinstance(created, int) and not isinstance(created, bool) else now
        cadence = row.get("cadence_days")
        if isinstance(cadence, bool) or not isinstance(cadence, int) or cadence < 1:
            cadence = self._cadence()
        last = row.get("last_search_at")
        last_search_at = last if isinstance(last, int) and not isinstance(last, bool) else None
        with self.db.transaction():
            self.db.execute(
                "INSERT INTO themes (id, tab_id, query, name, icon, searches, seeds,"
                " include_terms, exclude_terms, last_search_at, cadence_days, status, error,"
                " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    theme_id,
                    tab_id,
                    query,
                    one_line(row.get("name"), TAB_NAME_CHARS),
                    one_line(row.get("icon"), 64),
                    *(_dump(list(_json_list(row.get(col)))) for col in _JSON_LISTS),
                    last_search_at,
                    cadence,
                    status.value,
                    one_line(row.get("error"), 500),
                    created_at,
                    now,
                ),
            )
            for item in row.get("items") or ():
                self._import_item(theme_id, item)
        return True

    def _import_item(self, theme_id: str, item: Any) -> None:
        if not isinstance(item, Mapping):
            return
        video_id = item.get("video_id")
        if not isinstance(video_id, str) or not dedup.is_video_id(video_id):
            return
        try:
            verdict = T.ThemeVerdict(item.get("verdict"))
            source = T.ThemeItemSource(item.get("source"))
        except ValueError:
            return
        score = item.get("score")
        if isinstance(score, bool) or not isinstance(score, int | float):
            score = None
        self.db.execute(
            "INSERT OR IGNORE INTO theme_items (theme_id, video_id, reason, score, source,"
            " verdict) VALUES (?, ?, ?, ?, ?, ?)",
            (
                theme_id,
                video_id,
                one_line(item.get("reason"), WHY_CHARS),
                score,
                source.value,
                verdict.value,
            ),
        )


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    llm: T.LLM,
    searcher: T.Searcher,
    lenses: Sequence[T.Lens],
    tabs: T.TabService,
    taxonomy: T.TaxonomyService,
    channels: T.ChannelService,
    video_state: T.VideoStateService,
    video_store: T.VideoStore,
    changelog: T.ChangeLog,
    clock: T.Clock | None = None,
) -> T.Themes:
    """Only stores the dependencies (no network, no thread, no write)."""
    return ThemeService(
        db=db,
        settings=settings,
        llm=llm,
        searcher=searcher,
        lenses=lenses,
        tabs=tabs,
        taxonomy=taxonomy,
        channels=channels,
        video_state=video_state,
        video_store=video_store,
        changelog=changelog,
        clock=clock,
    )


__all__ = [
    "BATCH_SIZE",
    "CLASSICS_LIMIT",
    "MAX_CANDIDATES",
    "NO_MODEL_MESSAGE",
    "PREVIEW_TTL_S",
    "SEED_MIN_KEEP",
    "STAGES",
    "Plan",
    "ThemeService",
    "build",
    "clean_plan",
    "clean_query",
    "one_line",
]
