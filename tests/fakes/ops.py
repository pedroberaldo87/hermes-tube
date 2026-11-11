"""Fakes of the operations (feed, refresh, AI, cleanup/queue, search, themes, lists, extension,
data, routines, maintenance).

Those that own a table write into the contract tables; the others keep state in memory.
Simplifications are marked with "fake:". ``Cleanup`` follows the contract to the letter (it is the
target of the queue invariants).
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from typing import Any, Literal

from tube_pkg.core import dedup
from tube_pkg.core import types as T

from .infra import FakeClock, json_text
from .services import IdGen, _placeholders, _SqlFake, _video_from_row

DAY = 86_400


def _progress(
    fn: T.ProgressFn | None,
    stage: str,
    done: int = 0,
    total: int | None = None,
    *,
    step: tuple[int, int | None] | None = None,
) -> None:
    """*step* = ``(done, total)`` of ``T.ProgressStep`` (themes only)."""
    if fn is not None:
        numbers = (
            T.ProgressStep(name=T.ThemeStep(stage), done=step[0], total=step[1])
            if step is not None
            else None
        )
        fn(T.Progress(stage=stage, done=done, total=total, step=numbers))


_THEME_HINTS = {
    "pt": "only videos in Portuguese (write the searches in Portuguese)",
    "en": "only videos in English (write the searches in English)",
}


# --------------------------------------------------------------------------- FeedEngine


class FakeFeedEngine(_SqlFake):
    """Simplified tab engine that reads the contract tables.

    fake: unknown duration passes the ``min_s``/``max_s`` filters (the real one fetches on demand);
    ``archived`` never shows up; ``fresh`` = last 30 days (unknown date passes);
    ``classics`` sorts by views. ``scripted_pages[tab_id]`` replaces the computation.
    """

    def __init__(
        self,
        db: T.Db,
        *,
        tabs: T.TabService,
        taxonomy: T.TaxonomyService,
        channels: T.ChannelService,
        video_state: T.VideoStateService,
        video_store: T.VideoStore,
        lenses: Sequence[T.Lens] = (),
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.tabs = tabs
        self.taxonomy = taxonomy
        self.channels = channels
        self.video_state = video_state
        self.video_store = video_store
        self.lenses = list(lenses)
        self.scripted_pages: dict[str, T.FeedPage] = {}

    def _channel_scope(
        self, rules: T.TabRules
    ) -> tuple[dict[str, T.Channel], dict[str, T.Why], set[str]]:
        """``include − exclude`` for the channel part: (channels, reason per channel, excluded)."""
        channels = {c.id: c for c in self.channels.list()}
        folder_names = {f.id: f.name for f in self.taxonomy.list_folders()}
        tag_names = {t.id: t.name for t in self.taxonomy.list_tags()}
        active = {
            cid: c
            for cid, c in channels.items()
            if c.relation in (T.Relation.subscribed, T.Relation.followed) and not c.muted
        }
        why_by_channel: dict[str, T.Why] = {}

        def include(cid: str, why: T.Why) -> None:
            why_by_channel.setdefault(cid, why)

        inc = rules.include
        for cid in inc.channels:
            if cid in channels:
                include(cid, T.Why(T.WhyVia.channel, channels[cid].title))
        for fid in inc.folders:
            desc = set(self.taxonomy.descendants(fid))
            for cid, c in active.items():
                if c.folder_id in desc:
                    include(cid, T.Why(T.WhyVia.folder, folder_names.get(fid, fid)))
        for tid in inc.tags:
            for cid, c in active.items():
                if tid in c.tag_ids:
                    include(cid, T.Why(T.WhyVia.tag, tag_names.get(tid, tid)))
        if inc.favorites:
            for cid, c in active.items():
                if c.favorite:
                    include(cid, T.Why(T.WhyVia.channel, c.title))
        if inc.all:
            for cid, c in active.items():
                label = folder_names.get(c.folder_id or "", c.title)
                via = T.WhyVia.folder if c.folder_id in folder_names else T.WhyVia.channel
                include(cid, T.Why(via, label))
        exc = rules.exclude
        excluded = set(exc.channels)
        for fid in exc.folders:
            desc = set(self.taxonomy.descendants(fid))
            excluded |= {cid for cid, c in channels.items() if c.folder_id in desc}
        for tid in exc.tags:
            excluded |= {cid for cid, c in channels.items() if tid in c.tag_ids}
        for cid in excluded:
            why_by_channel.pop(cid, None)
        return channels, why_by_channel, excluded

    def _channel_whys(self, rules: T.TabRules) -> dict[str, T.Why]:
        return self._channel_scope(rules)[1]

    def _items(self, rules: T.TabRules) -> list[T.FeedItem]:
        now = self._now()
        channels, why_by_channel, excluded = self._channel_scope(rules)
        inc, exc = rules.include, rules.exclude
        candidates: list[tuple[T.Video, T.Why, tuple[str, ...]]] = []
        ids = list(why_by_channel)
        if ids:
            rows = self.db.query(
                f"SELECT * FROM videos WHERE channel_id IN ({_placeholders(ids)})", tuple(ids)
            )
            for r in rows:
                v = _video_from_row(r)
                candidates.append((v, why_by_channel[v.channel_id], ()))
        for theme_id in inc.themes:
            theme = self.db.query_one("SELECT name, query FROM themes WHERE id = ?", (theme_id,))
            label = (theme or {}).get("name") or (theme or {}).get("query") or theme_id
            kept = self.db.query(
                "SELECT video_id FROM theme_items WHERE theme_id = ? AND verdict = 'keep'",
                (theme_id,),
            )
            videos = self.video_store.get([k["video_id"] for k in kept])
            for v in videos.values():
                if v.channel_id not in excluded:
                    candidates.append((v, T.Why(T.WhyVia.theme, label), ()))
        lens_items: list[T.FeedItem] = []
        for lens in self.lenses:
            if lens.name in inc.lenses and lens.enabled():
                for li in lens.items(rules, rules.mode, 500):
                    lens_items.append(
                        T.FeedItem(
                            video=li.video,
                            channel=channels.get(li.video.channel_id),
                            why=li.why,
                            badges=li.badges,
                        )
                    )

        states = self.video_state.get(
            [v.id for v, _, _ in candidates] + [i.video.id for i in lens_items]
        )
        wm_rows = self.db.query("SELECT channel_id, seen_up_to FROM watermarks")
        watermarks = {r["channel_id"]: r["seen_up_to"] for r in wm_rows}

        def is_new(v: T.Video) -> bool:
            st = states.get(v.id)
            if st is not None and st.state is not T.VideoState.new:
                return False
            mark = watermarks.get(v.channel_id)
            return mark is None or (v.published_at or 0) > mark

        out: list[T.FeedItem] = []
        seen: set[str] = set()
        flt = rules.filters
        for v, why, badges in candidates:
            if v.id in seen:
                continue
            st = states.get(v.id)
            if st is not None and st.state is T.VideoState.archived:
                continue
            if exc.shorts and v.is_short:
                continue
            if (
                rules.mode is T.FeedMode.fresh
                and v.published_at
                and v.published_at < now - 30 * DAY
            ):
                continue
            if rules.mode is T.FeedMode.long and (v.duration_s or 0) < 1200:
                continue
            if flt.min_s is not None and v.duration_s is not None and v.duration_s < flt.min_s:
                continue
            if flt.max_s is not None and v.duration_s is not None and v.duration_s > flt.max_s:
                continue
            new = is_new(v)
            if flt.only_new and not new:
                continue
            seen.add(v.id)
            out.append(
                T.FeedItem(
                    video=v,
                    channel=channels.get(v.channel_id),
                    state=st.state if st else T.VideoState.new,
                    reaction=st.reaction if st else None,
                    is_new=new,
                    why=why,
                    badges=badges,
                )
            )
        for item in lens_items:
            if item.video.id not in seen and not (flt.only_new and not is_new(item.video)):
                seen.add(item.video.id)
                out.append(replace(item, is_new=is_new(item.video)))
        if rules.mode is T.FeedMode.classics:
            out.sort(key=lambda i: (-(i.video.views or 0), i.video.id))
        else:
            out.sort(key=lambda i: (-(i.video.published_at or 0), i.video.id))
        if flt.per_channel:
            per: dict[str, int] = {}
            capped = []
            for item in out:
                n = per.get(item.video.channel_id, 0)
                if n < flt.per_channel:
                    capped.append(item)
                    per[item.video.channel_id] = n + 1
            out = capped
        return out

    @staticmethod
    def _search(items: list[T.FeedItem], q: str | None) -> list[T.FeedItem]:
        """Search: every word in the title or in the channel name (``normalize_name``)."""
        if q is not None and (not isinstance(q, str) or len(q) > 200):
            raise T.ValidationError("invalid q", field="q")
        terms = dedup.normalize_name(q or "").split()
        if not terms:
            return items

        def hit(i: T.FeedItem) -> bool:
            title = dedup.normalize_name(i.video.title or "")
            name = (i.channel.title if i.channel else "") or i.video.channel_title or ""
            channel = dedup.normalize_name(name)
            return all(t in title or t in channel for t in terms)

        return [i for i in items if hit(i)]

    def _paginate(
        self, items: list[T.FeedItem], limit: int, cursor: str | None, *, prefix: str = ""
    ) -> T.FeedPage:
        """fake: cursor = position (``<n>`` in tabs, ``l:<n>`` in "Watch later")."""
        start = 0
        if cursor:
            if not cursor.startswith(prefix) or not cursor[len(prefix) :].isdigit():
                raise T.ValidationError("invalid cursor", field="cursor")
            start = int(cursor[len(prefix) :])
        chunk = items[start : start + limit]
        for lens in self.lenses:
            if lens.enabled():
                chunk = lens.enrich(chunk)
        nxt = f"{prefix}{start + limit}" if start + limit < len(items) else None
        counts = T.FeedCounts(total=len(items), new=sum(1 for i in items if i.is_new))
        return T.FeedPage(items=tuple(chunk), next_cursor=nxt, counts=counts)

    def _tab_rules(self, tab_id: str) -> T.TabRules:
        tab = self.tabs.get(tab_id)
        if tab is not None:
            return tab.rules
        builtin = {
            T.BUILTIN_TAB_ALL_NEW: T.TabRules(
                include=T.RuleInclude(all=True), filters=T.RuleFilters(only_new=True)
            ),
            T.BUILTIN_TAB_FAVORITES: T.TabRules(include=T.RuleInclude(favorites=True)),
        }.get(tab_id)
        if builtin is None:
            raise T.NotFound(f"tab {tab_id} does not exist")
        return builtin

    def page(
        self, tab_id: str, *, limit: int = 30, cursor: str | None = None, q: str | None = None
    ) -> T.FeedPage:
        if tab_id in self.scripted_pages:
            return self.scripted_pages[tab_id]
        tab = self.tabs.get(tab_id)
        if tab is None:
            raise T.NotFound(f"tab {tab_id} does not exist")
        return self._paginate(self._search(self._items(tab.rules), q), limit, cursor)

    def preview(
        self, rules: T.TabRules, *, limit: int = 30, cursor: str | None = None, q: str | None = None
    ) -> T.FeedPage:
        return self._paginate(self._search(self._items(rules), q), limit, cursor)

    def later_page(
        self, *, limit: int = 30, cursor: str | None = None, q: str | None = None
    ) -> T.FeedPage:
        """fake: "Watch later" by ``updated_at`` desc; ``why`` = channel folder › channel."""
        rows = self.db.query(
            "SELECT s.video_id AS video_id FROM video_state s JOIN videos v ON v.id = s.video_id"
            " WHERE s.state = 'later' ORDER BY s.updated_at DESC, s.video_id"
        )
        ids = [r["video_id"] for r in rows]
        videos = self.video_store.get(ids)
        states = self.video_state.get(ids)
        channels = {c.id: c for c in self.channels.list()}
        folder_names = {f.id: f.name for f in self.taxonomy.list_folders()}
        items: list[T.FeedItem] = []
        for vid in ids:
            v = videos[vid]
            c = channels.get(v.channel_id)
            if c is not None and c.folder_id in folder_names:
                why = T.Why(T.WhyVia.folder, folder_names[c.folder_id])
            else:
                why = T.Why(T.WhyVia.channel, (c.title if c else "") or v.channel_title or "?")
            st = states[vid]
            items.append(
                T.FeedItem(
                    video=v, channel=c, state=st.state, reaction=st.reaction, is_new=False, why=why
                )
            )
        return self._paginate(self._search(items, q), limit, cursor, prefix="l:")

    def tab_channels(self, tab_id: str) -> list[str]:
        if tab_id in ("later", ":later"):
            raise T.ValidationError('"Watch later" has no channels', field="id")
        tab = self.tabs.get(tab_id)
        if tab is not None and tab.kind is T.TabKind.theme:
            raise T.ValidationError("a topic tab has no channels", field="id")
        rules = self._tab_rules(tab_id)
        inc = rules.include
        if not (inc.channels or inc.folders or inc.tags or inc.favorites or inc.all):
            if inc.themes or inc.lenses:
                raise T.ValidationError("tab made only of topics/lenses", field="id")
            return []
        return sorted(self._channel_whys(rules))

    def new_counts(self) -> T.NewCounts:
        everything = self._items(
            T.TabRules(include=T.RuleInclude(all=True), filters=T.RuleFilters(only_new=True))
        )
        by_channel: dict[str, int] = {}
        for item in everything:
            by_channel[item.video.channel_id] = by_channel.get(item.video.channel_id, 0) + 1
        channels = {c.id: c for c in self.channels.list()}
        by_folder: dict[str, int] = {}
        folders = self.taxonomy.list_folders()
        for f in folders:
            desc = set(self.taxonomy.descendants(f.id))
            by_folder[f.id] = sum(
                n for cid, n in by_channel.items() if channels[cid].folder_id in desc
            )
        by_folder[""] = sum(n for cid, n in by_channel.items() if channels[cid].folder_id is None)
        by_tab = {
            tab.id: sum(
                1
                for i in self._items(
                    replace(tab.rules, filters=replace(tab.rules.filters, only_new=True))
                )
            )
            for tab in self.tabs.list()
        }
        return T.NewCounts(
            total=len(everything), by_tab=by_tab, by_folder=by_folder, by_channel=by_channel
        )


# --------------------------------------------------------------------------- Refresher


class FakeRefresher(_SqlFake):
    """``Refresher``: owner of ``watermarks`` and of the RSS ``meta`` keys.

    ``refresh_all``/``refresh_channel`` really use ``YouTubeClient.fetch_channel_rss`` (the
    fake). ``kick_if_due``/``kick_channel`` record into ``kicks`` and only run something if
    ``inline=True`` (fake: synchronous). ``set_running`` simulates a cycle in progress.
    """

    def __init__(
        self,
        db: T.Db,
        *,
        settings: T.Settings,
        youtube: T.YouTubeClient,
        channels: T.ChannelService,
        video_store: T.VideoStore,
        feed: T.FeedEngine,
        events: T.EventSink,
        changelog: T.ChangeLog,
        ext_endpoint_up: Callable[[], bool] = lambda: True,
        inline: bool = False,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.settings = settings
        self.youtube = youtube
        self.channels = channels
        self.video_store = video_store
        self.feed = feed
        self.events = events
        self.changelog = changelog
        self.ext_endpoint_up = ext_endpoint_up
        self.inline = inline
        self.kicks: list[tuple[str, Any]] = []
        self._running = False

    def set_running(self, value: bool) -> None:
        self._running = value

    def _meta(self, key: str) -> str | None:
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else None

    def _set_meta(self, key: str, value: str | None) -> None:
        self.db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def _refresh(self, channel_ids: Sequence[str]) -> T.RefreshReport:
        started = self._now()
        new_videos = 0
        errors: dict[str, str] = {}
        stats: list[T.ChannelStats] = []
        for cid in channel_ids:
            try:
                feed = self.youtube.fetch_channel_rss(cid)
            except T.TubeError as exc:
                errors[cid] = exc.message
                continue
            count = self.video_store.upsert(feed.videos, T.VideoOrigin.rss)
            new_videos += count.inserted
            dates = [v.published_at for v in feed.videos if v.published_at]
            stats.append(
                T.ChannelStats(channel_id=cid, last_video_at=max(dates) if dates else None)
            )
        self.channels.update_stats(stats)
        return T.RefreshReport(
            channels=len(channel_ids),
            new_videos=new_videos,
            errors=errors,
            started_at=started,
            finished_at=self._now(),
        )

    def refresh_all(
        self, *, timeout: float = 600.0, on_progress: T.ProgressFn | None = None
    ) -> T.RefreshReport:
        if self._running:
            raise T.Busy("refresh in progress")
        self._running = True
        try:
            active = self.channels.list(
                T.ChannelFilter(relations=(T.Relation.subscribed, T.Relation.followed))
            )
            _progress(on_progress, "rss", 0, len(active))
            report = self._refresh([c.id for c in active])
            _progress(on_progress, "rss", len(active), len(active))
            self._set_meta(T.META_LAST_RSS_AT, str(report.finished_at))
            self.events.broadcast("refresh.done", {"new_videos": report.new_videos})
            return report
        finally:
            self._running = False

    def refresh_channel(self, channel_id: str, *, timeout: float = 30.0) -> T.RefreshReport:
        return self._refresh([channel_id])

    def _due(self) -> bool:
        last = self.last_rss_at()
        interval = int(self.settings.get("rss_interval_min", 30)) * 60
        return last is None or self._now() - last >= interval

    def kick_if_due(
        self, force: bool = False, *, wait: bool = False
    ) -> Literal["started", "skipped", "running"]:
        self.kicks.append(("all", force))
        if self._running:
            return "running"
        if not (force or self._due()):
            return "skipped"
        if self.inline:
            self.refresh_all()
        return "started"

    def kick_channel(self, channel_id: str) -> Literal["started", "running"]:
        self.kicks.append(("channel", channel_id))
        if self.inline:
            self.refresh_channel(channel_id)
        return "started"

    def is_running(self) -> bool:
        return self._running

    def last_rss_at(self) -> T.Timestamp | None:
        value = self._meta(T.META_LAST_RSS_AT)
        return int(value) if value else None

    def resolve_shorts(
        self, video_ids: Sequence[str], *, limit: int = 50, timeout: float = 20.0
    ) -> dict[str, bool]:
        wanted = list(dict.fromkeys(video_ids))
        known = self.video_store.get(wanted)
        todo = [v for v in wanted if v in known and known[v].is_short is None][: max(limit, 0)]
        out: dict[str, bool] = {}
        for vid in todo:
            try:
                out[vid] = self.youtube.is_short(vid)
            except T.TubeError:
                continue
            self.video_store.set_details(vid, known[vid].duration_s, out[vid])
        return out

    def set_watermark(self, channel_id: str, seen_up_to: int) -> None:
        """Test shortcut (this fake owns the watermarks)."""
        self.db.execute(
            "INSERT INTO watermarks (channel_id, seen_up_to) VALUES (?, ?)"
            " ON CONFLICT(channel_id) DO UPDATE SET seen_up_to = excluded.seen_up_to",
            (channel_id, seen_up_to),
        )

    def mark_read(self, scope: T.ReadScope, *, actor: T.Actor = T.Actor.user) -> int:
        return self.mark_read_changes(scope, actor=actor)[0]

    def channel_totals(self) -> dict[str, int]:
        row = self.db.query_one(
            "SELECT SUM(relation IN ('subscribed', 'followed')) AS active,"
            " SUM(relation = 'subscribed') AS subs FROM channels"
        )
        return {
            "channels_total": int((row or {}).get("active") or 0),
            "subscribed_total": int((row or {}).get("subs") or 0),
        }

    def mark_read_changes(
        self, scope: T.ReadScope, *, actor: T.Actor = T.Actor.user
    ) -> tuple[int, tuple[int, ...]]:
        if scope.kind is T.ReadScopeKind.tab:
            if not scope.id:
                raise T.ValidationError("tab required", field="id")
            ids = list(self.feed.tab_channels(scope.id))
        elif scope.kind is T.ReadScopeKind.channel:
            if scope.id and self.channels.get(scope.id) is None:
                raise T.NotFound(f"channel {scope.id} does not exist")
            ids = [scope.id] if scope.id else []
        elif scope.kind is T.ReadScopeKind.folder:
            if not scope.id:
                raise T.ValidationError("folder required")
            ids = [c.id for c in self.channels.list(T.ChannelFilter(folder_id=scope.id))]
        else:
            ids = [
                c.id
                for c in self.channels.list(
                    T.ChannelFilter(relations=(T.Relation.subscribed, T.Relation.followed))
                )
            ]
        before: dict[str, int | None] = {}
        for cid in ids:
            row = self.db.query_one(
                "SELECT MAX(published_at) AS p FROM videos WHERE channel_id = ?", (cid,)
            )
            target = max(int(row["p"] or 0) if row else 0, self._now())
            wm = self.db.query_one("SELECT seen_up_to FROM watermarks WHERE channel_id = ?", (cid,))
            current = wm["seen_up_to"] if wm else None
            if current is None or current < target:
                before[cid] = current
        if not before:
            return 0, ()
        with self.db.transaction():
            for cid in before:
                self.set_watermark(cid, self._now())
            rec = self.changelog.record(
                actor,
                T.ChangeAction.mark_read,
                {"scope": scope.kind.value, "id": scope.id, "count": len(before)},
                T.UndoMarkRead(before=before),
            )
        return len(before), (rec.id,)

    def status(self) -> T.StatusSnapshot:
        counts = self.feed.new_counts()
        tabs = self.db.query("SELECT id, name, icon FROM tabs ORDER BY sort, id")
        fav_new = []
        for c in self.channels.list(T.ChannelFilter(favorite=True)):
            n = counts.by_channel.get(c.id, 0)
            if n:
                latest = self.db.query_one(
                    "SELECT id, title FROM videos WHERE channel_id = ?"
                    " ORDER BY published_at DESC LIMIT 1",
                    (c.id,),
                )
                fav_new.append(
                    T.FavNew(
                        channel_id=c.id,
                        title=c.title,
                        count=n,
                        latest_video_id=latest["id"] if latest else None,
                        latest_title=latest["title"] if latest else None,
                    )
                )
        queue = self.db.query_one("SELECT COUNT(*) AS n FROM unsub_queue WHERE status = 'approved'")
        search = self.db.query_one(
            "SELECT COUNT(*) AS n FROM search_jobs WHERE status = 'pending' AND expires_at > ?",
            (self._now(),),
        )
        return T.StatusSnapshot(
            new_total=counts.total,
            new_by_tab=tuple(
                T.TabCount(
                    tab_id=t["id"],
                    name=t["name"],
                    icon=t["icon"],
                    count=counts.by_tab.get(t["id"], 0),
                )
                for t in tabs
            ),
            fav_new=tuple(fav_new),
            ext_endpoint_up=bool(self.ext_endpoint_up()),
            last_rss_at=self.last_rss_at(),
            refresh_running=self._running,
            queue_pending=int(queue["n"]) if queue else 0,
            search_pending=int(search["n"]) if search else 0,
        )

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if not isinstance(u, T.UndoMarkRead):
            raise T.UndoRefused("not_undoable", f"the refresher does not undo {change.action}")
        for cid, prev in u.before.items():
            if prev is None:
                self.db.execute("DELETE FROM watermarks WHERE channel_id = ?", (cid,))
            else:
                self.set_watermark(cid, int(prev))


# --------------------------------------------------------------------------- Organizer


def _suggestion_from_row(row: Mapping[str, Any]) -> T.Suggestion:
    return T.Suggestion(
        id=row["id"],
        kind=T.SuggestionKind(row["kind"]),
        status=T.SuggestionStatus(row["status"]),
        payload=json.loads(row["payload"]),
        created_at=int(row["created_at"]),
        channel_id=row["channel_id"],
        model=row["model"],
        decided_at=row["decided_at"],
    )


class FakeOrganizer(_SqlFake):
    """``Organizer`` over ``suggestions`` (``kind=organize``), applying through the services."""

    def __init__(
        self,
        db: T.Db,
        *,
        llm: T.LLM,
        channels: T.ChannelService,
        taxonomy: T.TaxonomyService,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.llm = llm
        self.channels = channels
        self.taxonomy = taxonomy
        self.changelog = changelog

    def _folder_paths(self) -> dict[str, str]:
        folders = {f.id: f for f in self.taxonomy.list_folders()}

        def path(fid: str) -> str:
            f = folders[fid]
            return f"{path(f.parent_id)}/{f.name}" if f.parent_id in folders else f.name

        return {fid: path(fid) for fid in folders}

    def organize(
        self,
        channel_ids: Sequence[str] | None = None,
        *,
        timeout: float = T.TOOL_TIMEOUT_S,
        on_progress: T.ProgressFn | None = None,
    ) -> T.OrganizeResult:
        if not self.llm.available():
            raise T.LLMUnavailable("sem modelo configurado")
        if channel_ids is None:
            targets = self.channels.list(
                T.ChannelFilter(
                    folder_id=None, relations=(T.Relation.subscribed, T.Relation.followed)
                )
            )
        else:
            targets = [c for c in (self.channels.get(i) for i in channel_ids) if c is not None]
        if not targets:
            return T.OrganizeResult(suggestions=(), model=self.llm.model_name())
        items = []
        for c in targets:
            titles = [
                r["title"]
                for r in self.db.query(
                    "SELECT title FROM videos WHERE channel_id = ?"
                    " ORDER BY published_at DESC LIMIT 5",
                    (c.id,),
                )
            ]
            items.append(
                {"channel_id": c.id, "title": c.title, "handle": c.handle, "recent_titles": titles}
            )
        examples = []
        for s in self._by_status(T.SuggestionStatus.accepted):
            edited = s.payload.get("edited")
            if edited:
                ch = self.channels.get(s.channel_id or "")
                examples.append(
                    {
                        "channel_title": ch.title if ch else "",
                        "folder": edited.get("folder"),
                        "tags": list(edited.get("tags") or []),
                    }
                )
        payload = {
            "items": items,
            "folders": sorted(self._folder_paths().values()),
            "tags": [t.name for t in self.taxonomy.list_tags()],
            "examples": examples,
        }
        _progress(on_progress, "organize", 0, len(items))
        out = self.llm.complete_structured(
            T.AiTask.organize, payload, timeout=timeout, on_progress=on_progress
        )
        T.check_cancelled(on_progress)  # an answer after cancellation is not written
        model = self.llm.model_name()
        created = []
        with self.db.transaction():
            for item in out["items"]:
                cid = item["channel_id"]
                self.db.execute(
                    "UPDATE suggestions SET status = 'superseded', decided_at = ?"
                    " WHERE kind = 'organize' AND status = 'pending' AND channel_id = ?",
                    (self._now(), cid),
                )
                sid = self.ids.next("sug")
                self.db.execute(
                    "INSERT INTO suggestions (id, kind, channel_id, payload, status, model,"
                    " created_at) VALUES (?, 'organize', ?, ?, 'pending', ?, ?)",
                    (sid, cid, json_text(item), model, self._now()),
                )
                created.append(sid)
        _progress(on_progress, "organize", len(items), len(items))
        return T.OrganizeResult(suggestions=tuple(self._get(s) for s in created), model=model)

    def _get(self, sid: str) -> T.Suggestion:
        row = self.db.query_one("SELECT * FROM suggestions WHERE id = ?", (sid,))
        if row is None:
            raise T.NotFound(f"suggestion {sid} does not exist")
        return _suggestion_from_row(row)

    def _by_status(self, status: T.SuggestionStatus) -> list[T.Suggestion]:
        rows = self.db.query(
            "SELECT * FROM suggestions WHERE kind = 'organize' AND status = ?"
            " ORDER BY created_at, id",
            (status.value,),
        )
        return [_suggestion_from_row(r) for r in rows]

    def pending(self) -> list[T.Suggestion]:
        return self._by_status(T.SuggestionStatus.pending)

    def _select(
        self, suggestion_ids: Sequence[str] | None, channel_ids: Sequence[str] | None
    ) -> list[T.Suggestion]:
        pending = self.pending()
        if suggestion_ids is None and channel_ids is None:
            return pending
        wanted_s = set(suggestion_ids or ())
        wanted_c = set(channel_ids or ())
        return [s for s in pending if s.id in wanted_s or s.channel_id in wanted_c]

    def accept(
        self,
        suggestion_ids: Sequence[str] | None = None,
        *,
        channel_ids: Sequence[str] | None = None,
        edits: Mapping[str, T.OrganizeEdit] | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> T.AcceptReport:
        chosen = self._select(suggestion_ids, channel_ids)
        if not chosen:
            return T.AcceptReport()
        edits = dict(edits or {})
        created_folders: list[str] = []
        created_tags: list[str] = []
        last = self.changelog.list(limit=1)
        last_id = last[0].id if last else 0
        with self.db.transaction(), self.changelog.group("organizar") as gid:
            for s in chosen:
                cid = s.channel_id or s.payload["channel_id"]
                edit = edits.get(cid)
                folder_path = (edit.folder if edit and edit.folder else None) or s.payload["folder"]
                tag_names = (
                    list(edit.tags)
                    if edit and edit.tags is not None
                    else list(s.payload.get("tags", []))
                )
                parent: str | None = None
                for part in [p for p in folder_path.split("/") if p.strip()]:
                    found = self.taxonomy.find_folder_by_name(part, parent_id=parent)
                    if found is None:
                        found = self.taxonomy.create_folder(part, parent_id=parent, actor=actor)
                        created_folders.append(found.id)
                    parent = found.id
                if parent is not None:
                    self.channels.move([cid], parent, actor=actor)
                tag_ids = []
                for name in tag_names:
                    tag = self.taxonomy.find_tag_by_name(name)
                    if tag is None:
                        tag = self.taxonomy.create_tag(name, actor=actor)
                        created_tags.append(tag.id)
                    tag_ids.append(tag.id)
                if tag_ids:
                    ch = self.channels.get(cid)
                    if ch is not None:
                        self.channels.set_tags(cid, [*ch.tag_ids, *tag_ids], actor=actor)
                payload = dict(s.payload)
                if edit is not None:
                    payload["edited"] = {"folder": edit.folder, "tags": edit.tags}
                self.db.execute(
                    "UPDATE suggestions SET status = 'accepted', decided_at = ?, payload = ?"
                    " WHERE id = ?",
                    (self._now(), json_text(payload), s.id),
                )
            self.changelog.record(
                actor,
                T.ChangeAction.organize_accept,
                {"count": len(chosen)},
                T.UndoOrganizeAccept(suggestion_ids=tuple(s.id for s in chosen)),
            )
        change_ids = sorted(
            r.id for r in self.changelog.list(limit=10_000) if r.id > last_id and r.group_id == gid
        )
        return T.AcceptReport(
            accepted=tuple(s.id for s in chosen),
            created_folders=tuple(created_folders),
            created_tags=tuple(created_tags),
            change_group=gid,
            change_ids=tuple(change_ids),
        )

    def reject(
        self,
        suggestion_ids: Sequence[str] | None = None,
        *,
        channel_ids: Sequence[str] | None = None,
    ) -> int:
        chosen = self._select(suggestion_ids, channel_ids)
        for s in chosen:
            self.db.execute(
                "UPDATE suggestions SET status = 'rejected', decided_at = ? WHERE id = ?",
                (self._now(), s.id),
            )
        return len(chosen)

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if not isinstance(u, T.UndoOrganizeAccept):
            raise T.UndoRefused("not_undoable", f"organize does not undo {change.action}")
        for sid in u.suggestion_ids:
            self.db.execute(
                "UPDATE suggestions SET status = 'pending', decided_at = NULL WHERE id = ?", (sid,)
            )


# --------------------------------------------------------------------------- Cleanup


def _queue_from_row(row: Mapping[str, Any]) -> T.QueueItem:
    return T.QueueItem(
        id=row["id"],
        channel_id=row["channel_id"],
        action=T.QueueAction(row["action"]),
        status=T.QueueStatus(row["status"]),
        approved_at=int(row["approved_at"]),
        approved_via=T.ApprovedVia(row["approved_via"]),
        created_at=int(row["created_at"]),
        updated_at=int(row["updated_at"]),
        reason=row["reason"],
        error=row["error"],
        device_id=row["device_id"],
    )


def _candidate_from_row(row: Mapping[str, Any]) -> T.CleanupCandidate:
    return T.CleanupCandidate(
        id=row["id"],
        channel_id=row["channel_id"],
        group=T.CleanupGroup(row["group_key"]),
        why=row["why"],
        status=T.CandidateStatus(row["status"]),
        scan_id=row["scan_id"],
        created_at=int(row["created_at"]),
    )


_EXECUTED = (T.QueueStatus.running, T.QueueStatus.done, T.QueueStatus.failed)


class FakeCleanup(_SqlFake):
    """``Cleanup`` over ``cleanup_candidates``/``unsub_queue``, faithful to the contract.

    ``strict_via=False`` simulates a wrong implementation (accepts any ``via``) — only to
    prove that the invariants catch the error.
    """

    STALE_DAYS = 180
    IGNORED_DAYS = 90
    IGNORED_MIN_VIDEOS = 8

    def __init__(
        self,
        db: T.Db,
        *,
        settings: T.Settings,
        llm: T.LLM,
        channels: T.ChannelService,
        events: T.EventSink,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.settings = settings
        self.llm = llm
        self.channels = channels
        self.events = events
        self.changelog = changelog
        self.strict_via = True

    # ------------------------------------------------------------------ scan

    def _rule_groups(self) -> dict[str, tuple[T.CleanupGroup, dict[str, Any]]]:
        now = self._now()
        out: dict[str, tuple[T.CleanupGroup, dict[str, Any]]] = {}
        for c in self.channels.list(T.ChannelFilter(relations=(T.Relation.subscribed,))):
            last = c.last_video_at
            if last is None:
                row = self.db.query_one(
                    "SELECT MAX(published_at) AS p FROM videos WHERE channel_id = ?", (c.id,)
                )
                last = row["p"] if row else None
            v90 = self.db.query_one(
                "SELECT COUNT(*) AS n FROM videos WHERE channel_id = ? AND published_at >= ?",
                (c.id, now - self.IGNORED_DAYS * DAY),
            )
            w90 = self.db.query_one(
                "SELECT COUNT(*) AS n FROM watch_history WHERE channel_id = ? AND watched_at >= ?",
                (c.id, now - self.IGNORED_DAYS * DAY),
            )
            facts = {
                "days_since_last_video": (now - last) // DAY if last else None,
                "videos_90d": int(v90["n"]) if v90 else 0,
                "watched_90d": int(w90["n"]) if w90 else 0,
            }
            if last is not None and now - last > self.STALE_DAYS * DAY:
                out[c.id] = (T.CleanupGroup.stale, facts)
            elif facts["videos_90d"] >= self.IGNORED_MIN_VIDEOS and facts["watched_90d"] == 0:
                out[c.id] = (T.CleanupGroup.ignored, facts)
        return out

    def scan(
        self, *, timeout: float = T.TOOL_TIMEOUT_S, on_progress: T.ProgressFn | None = None
    ) -> T.CleanupScan:
        _progress(on_progress, "rules")
        rules = self._rule_groups()
        why: dict[str, str] = {
            cid: (
                "Sem vídeo novo há mais de 180 dias."
                if g is T.CleanupGroup.stale
                else "Publicou bastante e você não assistiu nada em 90 dias."
            )
            for cid, (g, _) in rules.items()
        }
        groups = {cid: g for cid, (g, _) in rules.items()}
        model = None
        if self.llm.available():
            subs = self.channels.list(T.ChannelFilter(relations=(T.Relation.subscribed,)))
            items = [
                {
                    "channel_id": c.id,
                    "title": c.title,
                    "rule_group": groups[c.id].value if c.id in groups else None,
                    **(rules[c.id][1] if c.id in rules else {}),
                }
                for c in subs
            ]
            if items:
                _progress(on_progress, "ai", 0, len(items))
                try:
                    out = self.llm.complete_structured(
                        T.AiTask.cleanup_reasons, {"items": items}, timeout=timeout
                    )
                except (T.LLMUnavailable, T.LLMInvalidResponse):
                    out = {"items": []}
                model = self.llm.model_name()
                for item in out["items"]:
                    cid = item["channel_id"]
                    if cid in groups:
                        why[cid] = item["why"]
                    elif item["group"] == "off_profile":
                        groups[cid] = T.CleanupGroup.off_profile
                        why[cid] = item["why"]
        scan_id = self.ids.next("scan")
        now = self._now()
        with self.db.transaction():
            for cid, group in groups.items():
                self.db.execute(
                    "INSERT INTO cleanup_candidates (id, scan_id, channel_id, group_key, why,"
                    " status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                    (self.ids.next("cand"), scan_id, cid, group.value, why.get(cid, ""), now),
                )
        self.events.broadcast("cleanup.scanned", {"scan_id": scan_id, "count": len(groups)})
        _progress(on_progress, "done", len(groups), len(groups))
        scan = self._scan(scan_id)
        return replace(scan, model=model)

    def _scan(self, scan_id: str) -> T.CleanupScan:
        rows = self.db.query(
            "SELECT * FROM cleanup_candidates WHERE (scan_id = ? OR group_key = 'manual')"
            " AND status = 'pending' ORDER BY created_at, id",
            (scan_id,),
        )
        created = self.db.query_one(
            "SELECT MIN(created_at) AS c FROM cleanup_candidates WHERE scan_id = ?", (scan_id,)
        )
        return T.CleanupScan(
            scan_id=scan_id,
            created_at=int(created["c"] or self._now()) if created else self._now(),
            candidates=tuple(_candidate_from_row(r) for r in rows),
        )

    def latest_scan(self) -> T.CleanupScan | None:
        row = self.db.query_one(
            "SELECT scan_id FROM cleanup_candidates WHERE group_key <> 'manual'"
            " ORDER BY created_at DESC, rowid DESC LIMIT 1"
        )
        if row is not None:
            return self._scan(row["scan_id"])
        manual = self.db.query_one(
            "SELECT scan_id FROM cleanup_candidates WHERE group_key = 'manual' LIMIT 1"
        )
        return self._scan(manual["scan_id"]) if manual else None

    def propose(
        self,
        channel_ids: Sequence[str],
        *,
        reason: str | None = None,
        actor: T.Actor = T.Actor.user,
    ) -> list[T.CleanupCandidate]:
        scan_id = self.ids.next("manual")
        created = []
        with self.db.transaction():
            for cid in dict.fromkeys(channel_ids):
                ch = self.channels.get(cid)
                if ch is None or ch.relation is not T.Relation.subscribed:
                    continue
                cand_id = self.ids.next("cand")
                self.db.execute(
                    "INSERT INTO cleanup_candidates (id, scan_id, channel_id, group_key, why,"
                    " status, created_at) VALUES (?, ?, ?, 'manual', ?, 'pending', ?)",
                    (cand_id, scan_id, cid, reason or "Proposto por você.", self._now()),
                )
                created.append(cand_id)
        rows = [
            self.db.query_one("SELECT * FROM cleanup_candidates WHERE id = ?", (c,))
            for c in created
        ]
        return [_candidate_from_row(r) for r in rows if r]

    def dismiss(self, candidate_ids: Sequence[str]) -> int:
        ids = list(candidate_ids)
        if not ids:
            return 0
        res = self.db.execute(
            f"UPDATE cleanup_candidates SET status = 'dismissed' WHERE id IN ({_placeholders(ids)})"
            " AND status = 'pending'",
            tuple(ids),
        )
        return res.rowcount

    # ------------------------------------------------------------------ queue

    def _check_via(self, via: Any) -> T.ApprovedVia:
        if not self.strict_via:
            return T.ApprovedVia.desktop_rpc
        if not isinstance(via, T.ApprovedVia) or via not in T.HUMAN_APPROVAL_VIAS:
            raise T.ApprovalRefused(f"approval refused: via {via!r} is not human")
        return via

    def _item(self, queue_id: str) -> T.QueueItem | None:
        row = self.db.query_one("SELECT * FROM unsub_queue WHERE id = ?", (queue_id,))
        return _queue_from_row(row) if row else None

    def _enqueue(
        self,
        ids: Sequence[str],
        via: T.ApprovedVia,
        action: T.QueueAction,
        relation: T.Relation,
        change: T.ChangeAction,
        actor: T.Actor,
    ) -> list[T.QueueItem]:
        items: list[T.QueueItem] = []
        new_ids: list[str] = []
        now = self._now()
        with self.db.transaction():
            for cid in dict.fromkeys(ids):
                ch = self.channels.get(cid)
                if ch is None or ch.relation is not relation:
                    continue
                active = self.db.query_one(
                    "SELECT * FROM unsub_queue WHERE channel_id = ? AND action = ?"
                    " AND status IN ('approved', 'running')",
                    (cid, action.value),
                )
                if active is not None:
                    items.append(_queue_from_row(active))
                    continue
                reason_row = self.db.query_one(
                    "SELECT why FROM cleanup_candidates WHERE channel_id = ? AND status = 'pending'"
                    " ORDER BY created_at DESC LIMIT 1",
                    (cid,),
                )
                qid = self.ids.next("q")
                self.db.execute(
                    "INSERT INTO unsub_queue (id, channel_id, action, reason, approved_at,"
                    " approved_via, status, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)",
                    (
                        qid,
                        cid,
                        action.value,
                        reason_row["why"] if reason_row else None,
                        now,
                        via.value,
                        now,
                        now,
                    ),
                )
                if action is T.QueueAction.unsubscribe:
                    self.db.execute(
                        "UPDATE cleanup_candidates SET status = 'approved'"
                        " WHERE channel_id = ? AND status = 'pending'",
                        (cid,),
                    )
                new_ids.append(qid)
                item = self._item(qid)
                assert item is not None
                items.append(item)
            if new_ids:
                self.changelog.record(
                    actor,
                    change,
                    {"count": len(new_ids), "via": via.value},
                    T.UndoCleanupQueue(queue_ids=tuple(new_ids)),
                )
        if new_ids:
            self.events.broadcast("queue.changed", {"approved": len(new_ids)})
        return items

    def approve(
        self, ids: Sequence[str], via: T.ApprovedVia, *, actor: T.Actor = T.Actor.user
    ) -> list[T.QueueItem]:
        via = self._check_via(via)
        return self._enqueue(
            ids,
            via,
            T.QueueAction.unsubscribe,
            T.Relation.subscribed,
            T.ChangeAction.cleanup_approve,
            actor,
        )

    def resubscribe(
        self, ids: Sequence[str], via: T.ApprovedVia, *, actor: T.Actor = T.Actor.user
    ) -> list[T.QueueItem]:
        via = self._check_via(via)
        return self._enqueue(
            ids,
            via,
            T.QueueAction.resubscribe,
            T.Relation.ex,
            T.ChangeAction.cleanup_resubscribe,
            actor,
        )

    def _undo_items(self, queue_ids: Sequence[str]) -> list[T.QueueItem]:
        items = []
        for qid in dict.fromkeys(queue_ids):
            item = self._item(qid)
            if item is None:
                raise T.NotFound(f"item {qid} is not in the queue")
            items.append(item)
        if any(i.status in _EXECUTED for i in items):
            raise T.UndoRefused(
                "already_executed",
                "already done: use Resubscribe in Cleanup → Ex-subscriptions",
            )
        changed = False
        for item in items:
            if item.status is T.QueueStatus.approved:
                self.db.execute(
                    "UPDATE unsub_queue SET status = 'undone', updated_at = ? WHERE id = ?",
                    (self._now(), item.id),
                )
                if item.action is T.QueueAction.unsubscribe:
                    self.db.execute(
                        "UPDATE cleanup_candidates SET status = 'pending'"
                        " WHERE channel_id = ? AND status = 'approved'",
                        (item.channel_id,),
                    )
                changed = True
        if changed:
            self.events.broadcast("queue.changed", {"undone": len(items)})
        return [i for i in (self._item(x.id) for x in items) if i is not None]

    def undo_approval(self, queue_ids: Sequence[str]) -> list[T.QueueItem]:
        with self.db.transaction():
            return self._undo_items(queue_ids)

    def queue_pending(self) -> list[T.QueueItem]:
        rows = self.db.query(
            "SELECT * FROM unsub_queue WHERE status = 'approved' AND approved_via IS NOT NULL"
            " AND approved_at IS NOT NULL ORDER BY approved_at, id"
        )
        return [_queue_from_row(r) for r in rows]

    def queue_result(
        self,
        queue_id: str,
        status: T.QueueStatus,
        *,
        error: str | None = None,
        device_id: str | None = None,
    ) -> T.QueueItem:
        status = T.QueueStatus(status)
        if status not in _EXECUTED:
            raise T.ValidationError(f"invalid result: {status}")
        item = self._item(queue_id)
        if item is None:
            raise T.NotFound(f"item {queue_id} is not in the queue")
        if item.status is T.QueueStatus.undone:
            raise T.Conflict("item undone before it ran")
        if item.status is status:
            return item
        if item.status in (T.QueueStatus.done, T.QueueStatus.failed):
            raise T.Conflict(f"item already finished ({item.status})")
        with self.db.transaction():
            self.db.execute(
                "UPDATE unsub_queue SET status = ?, error = ?, device_id = COALESCE(?, device_id),"
                " updated_at = ? WHERE id = ?",
                (status.value, error, device_id, self._now(), queue_id),
            )
            if status is T.QueueStatus.done:
                ch = self.channels.get(item.channel_id)
                target = (
                    T.Relation.ex
                    if item.action is T.QueueAction.unsubscribe
                    else T.Relation.subscribed
                )
                if ch is not None and target in T.RELATION_TRANSITIONS[ch.relation]:
                    self.channels.set_relation(
                        item.channel_id, target, actor=T.Actor.extension, reason="fila"
                    )
        self.events.broadcast("queue.changed", {"id": queue_id, "status": status.value})
        result = self._item(queue_id)
        assert result is not None
        return result

    def queue(
        self, statuses: Sequence[T.QueueStatus] | None = None, *, limit: int = 200
    ) -> list[T.QueueItem]:
        if statuses:
            values = [T.QueueStatus(s).value for s in statuses]
            rows = self.db.query(
                f"SELECT * FROM unsub_queue WHERE status IN ({_placeholders(values)})"
                " ORDER BY created_at DESC, id DESC LIMIT ?",
                (*values, limit),
            )
        else:
            rows = self.db.query(
                "SELECT * FROM unsub_queue ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)
            )
        return [_queue_from_row(r) for r in rows]

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if not isinstance(u, T.UndoCleanupQueue):
            raise T.UndoRefused("not_undoable", f"cleanup does not undo {change.action}")
        self._undo_items(u.queue_ids)


# --------------------------------------------------------------------------- Searcher


class FakeSearcher:
    """In-memory ``Searcher``.

    ``script(query, hits, order=None, via=extension)`` defines results (``query="*"`` matches
    any search); ``fail(query, msg)`` becomes ``SearchOutcome.error``. With no script, uses
    ``youtube.search`` (via ``host``) if there is a ``youtube``. ``batches`` keeps each
    ``search_many`` call (proves "a single window per batch"). ``enqueue`` creates jobs to test
    ``claim``/``complete``/``pending_count``.
    """

    def __init__(
        self,
        *,
        youtube: T.YouTubeClient | None = None,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        self.youtube = youtube
        self.clock = clock or FakeClock()
        self.ids = ids or IdGen()
        self.scripted: dict[
            tuple[str, T.SearchOrder | None], tuple[list[T.SearchHit], T.SearchVia]
        ] = {}
        self.failures: dict[str, str] = {}
        self.batches: list[list[T.SearchRequest]] = []
        self.jobs: dict[str, T.SearchJob] = {}

    def script(
        self,
        query: str,
        hits: Sequence[T.SearchHit],
        *,
        order: T.SearchOrder | None = None,
        via: T.SearchVia = T.SearchVia.extension,
    ) -> FakeSearcher:
        self.scripted[(query, order)] = (list(hits), via)
        return self

    def fail(self, query: str, message: str = "falhou") -> None:
        self.failures[query] = message

    def _outcome(self, req: T.SearchRequest) -> T.SearchOutcome:
        if req.query in self.failures:
            return T.SearchOutcome(request=req, error=self.failures[req.query])
        for key in ((req.query, req.order), (req.query, None), ("*", req.order), ("*", None)):
            if key in self.scripted:
                hits, via = self.scripted[key]
                return T.SearchOutcome(request=req, hits=tuple(hits), via=via)
        if self.youtube is not None:
            try:
                hits = self.youtube.search(req.query, req.order)
            except T.TubeError as exc:
                return T.SearchOutcome(request=req, error=exc.message)
            return T.SearchOutcome(request=req, hits=tuple(hits), via=T.SearchVia.host)
        return T.SearchOutcome(request=req)

    def search_many(
        self, requests: Sequence[T.SearchRequest], timeout: float = T.SEARCH_WINDOW_S
    ) -> list[T.SearchOutcome]:
        self.batches.append(list(requests))
        return [self._outcome(r) for r in requests]

    def search(
        self,
        query: str,
        order: T.SearchOrder = T.SearchOrder.relevance,
        *,
        timeout: float = T.SEARCH_WINDOW_S,
    ) -> list[T.SearchHit]:
        (outcome,) = self.search_many([T.SearchRequest(query=query, order=order)], timeout)
        if outcome.error:
            raise T.YouTubeError(outcome.error)
        return list(outcome.hits)

    def enqueue(
        self,
        query: str,
        order: T.SearchOrder = T.SearchOrder.relevance,
        theme_id: str | None = None,
    ) -> T.SearchJob:
        now = self.clock.now()
        job = T.SearchJob(
            id=self.ids.next("sj"),
            batch_id="fake",
            query=query,
            order=order,
            status=T.SearchJobStatus.pending,
            created_at=now,
            expires_at=now + int(T.SEARCH_WINDOW_S),
            theme_id=theme_id,
        )
        self.jobs[job.id] = job
        return job

    def pending_count(self) -> int:
        now = self.clock.now()
        return sum(
            1
            for j in self.jobs.values()
            if j.status is T.SearchJobStatus.pending and j.expires_at > now
        )

    def claim(self, device_id: str, limit: int = 4) -> list[T.SearchJob]:
        now = self.clock.now()
        out = []
        for job in list(self.jobs.values()):
            if len(out) >= limit:
                break
            if job.status is T.SearchJobStatus.pending and job.expires_at > now:
                job = replace(job, status=T.SearchJobStatus.claimed, device_id=device_id)
                self.jobs[job.id] = job
                out.append(job)
        return out

    def complete(
        self, job_id: str, payload: Mapping[str, Any] | str, *, device_id: str
    ) -> T.SearchJob:
        job = self.jobs.get(job_id)
        if job is None:
            raise T.NotFound(f"search {job_id} does not exist")
        if job.expires_at <= self.clock.now() or job.status is T.SearchJobStatus.expired:
            raise T.Conflict("search expired; the host already covered it")
        job = replace(job, status=T.SearchJobStatus.done, payload=payload, device_id=device_id)
        self.jobs[job_id] = job
        return job

    def purge_expired(self, now: T.Timestamp | None = None) -> int:
        now = self.clock.now() if now is None else now
        dead = [
            k
            for k, j in self.jobs.items()
            if j.expires_at <= now or j.status is not T.SearchJobStatus.pending
        ]
        for key in dead:
            del self.jobs[key]
        return len(dead)


# --------------------------------------------------------------------------- Themes


def _theme_from_row(row: Mapping[str, Any]) -> T.Theme:
    return T.Theme(
        id=row["id"],
        query=row["query"],
        status=T.ThemeStatus(row["status"]),
        created_at=int(row["created_at"]),
        name=row["name"],
        icon=row["icon"],
        tab_id=row["tab_id"],
        searches=tuple(json.loads(row["searches"])),
        seeds=tuple(json.loads(row["seeds"])),
        include_terms=tuple(json.loads(row["include_terms"])),
        exclude_terms=tuple(json.loads(row["exclude_terms"])),
        last_search_at=row["last_search_at"],
        cadence_days=int(row["cadence_days"]),
        error=row["error"],
    )


class FakeThemes(_SqlFake):
    """``Themes`` over ``themes``/``theme_items`` with the themes pipeline (fake: no
    parallelism, no size cuts beyond the ``LLM`` batches).

    ``save`` writes everything inside ``ChangeLog.group`` (tab, folder, followed channels and
    ``theme_save``), so undoing the group undoes the whole set.
    """

    SEED_MIN_KEEP = 3

    def __init__(
        self,
        db: T.Db,
        *,
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
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
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

    # ------------------------------------------------------------------ writing

    def _insert_theme(
        self,
        query: str,
        *,
        name: str | None,
        icon: str | None,
        searches: Sequence[str],
        include_terms: Sequence[str] = (),
        exclude_terms: Sequence[str] = (),
        status: T.ThemeStatus = T.ThemeStatus.searching,
    ) -> str:
        theme_id = self.ids.next("th")
        now = self._now()
        self.db.execute(
            "INSERT INTO themes (id, query, name, icon, searches, seeds, include_terms,"
            " exclude_terms, cadence_days, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)",
            (
                theme_id,
                query,
                name,
                icon,
                json_text(list(searches)),
                json_text(list(include_terms)),
                json_text(list(exclude_terms)),
                int(self.settings.get("theme_refresh_days", 7)),
                status.value,
                now,
                now,
            ),
        )
        return theme_id

    def _write_items(
        self,
        theme_id: str,
        verdicts: Sequence[tuple[str, bool, float | None, str | None, T.ThemeItemSource]],
    ) -> None:
        for video_id, keep, score, reason, source in verdicts:
            self.db.execute(
                "INSERT INTO theme_items (theme_id, video_id, reason, score, source, verdict)"
                " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(theme_id, video_id) DO UPDATE SET"
                " reason = excluded.reason, score = excluded.score, verdict = CASE"
                " WHEN theme_items.verdict = 'keep' THEN 'keep' ELSE excluded.verdict END",
                (theme_id, video_id, reason, score, source.value, "keep" if keep else "cut"),
            )
        keeps = self.db.query(
            "SELECT v.channel_id AS c, COUNT(*) AS n FROM theme_items ti JOIN videos v"
            " ON v.id = ti.video_id WHERE ti.theme_id = ? AND ti.verdict = 'keep'"
            " GROUP BY v.channel_id",
            (theme_id,),
        )
        seeds = sorted(r["c"] for r in keeps if r["n"] >= self.SEED_MIN_KEEP)
        self.db.execute(
            "UPDATE themes SET seeds = ?, last_search_at = ?, updated_at = ? WHERE id = ?",
            (json_text(seeds), self._now(), self._now(), theme_id),
        )

    def seed_theme(
        self,
        query: str,
        videos: Sequence[T.VideoIn],
        *,
        name: str | None = None,
        icon: str | None = None,
        reason: str = "Selecionado para o tema.",
    ) -> str:
        """Test shortcut: theme in ``preview`` with *videos* kept (no AI, no search)."""
        theme_id = self._insert_theme(
            query, name=name, icon=icon, searches=[query], status=T.ThemeStatus.preview
        )
        self.video_store.upsert(list(videos), T.VideoOrigin.search)
        self._write_items(
            theme_id,
            [
                (v.id, True, round(1 - i / (len(videos) + 1), 4), reason, T.ThemeItemSource.search)
                for i, v in enumerate(videos)
            ],
        )
        return theme_id

    # ------------------------------------------------------------------ pipeline

    def _search_and_curate(
        self,
        theme_id: str,
        query: str,
        searches: Sequence[str],
        include_terms: Sequence[str],
        exclude_terms: Sequence[str],
        mode: str,
        timeout: float,
        on_progress: T.ProgressFn | None,
        ask: str | None = None,
    ) -> int:
        _progress(on_progress, "search", 0, len(searches) * 2, step=(0, None))
        requests = [
            T.SearchRequest(query=s, order=order, theme_id=theme_id)
            for s in searches
            for order in (T.SearchOrder.relevance, T.SearchOrder.date)
        ]
        outcomes = self.searcher.search_many(requests)
        T.check_cancelled(on_progress)
        hits: dict[str, tuple[T.SearchHit, T.ThemeItemSource]] = {}
        for outcome in outcomes:
            for hit in outcome.hits:
                hits.setdefault(hit.video_id, (hit, T.ThemeItemSource.search))
        if mode == T.FeedMode.classics.value:
            for lens in self.lenses:
                if lens.enabled():
                    for hit in lens.classics(query, 50):
                        hits.setdefault(hit.video_id, (hit, T.ThemeItemSource.classics))
        _progress(on_progress, "search", len(requests), len(requests), step=(len(hits), len(hits)))
        if hits:
            self.video_store.upsert(
                [h.to_video_in() for h, _ in hits.values()], T.VideoOrigin.search
            )
        _progress(on_progress, "curate", 0, len(hits), step=(0, len(hits)))
        verdicts: list[tuple[str, bool, float | None, str | None, T.ThemeItemSource]] = []
        if hits:
            reactions = self.video_state.reactions()
            disliked_ids = [v for v, r in reactions.items() if r is T.Reaction.down]
            liked_ids = [v for v, r in reactions.items() if r is T.Reaction.up]
            known = self.video_store.get(disliked_ids + liked_ids)
            payload = {
                "query": ask or query,
                "include_terms": list(include_terms),
                "exclude_terms": list(exclude_terms),
                "items": [
                    {
                        "video_id": h.video_id,
                        "title": h.title or h.video_id,
                        "channel_title": h.channel_title,
                        "duration_s": h.duration_s,
                        "views": h.views,
                        "published_text": h.published_text,
                        "source": src.value,
                    }
                    for h, src in hits.values()
                ],
                "disliked_titles": [known[v].title for v in disliked_ids if v in known],
                "liked_titles": [known[v].title for v in liked_ids if v in known],
            }
            out = self.llm.complete_structured(
                T.AiTask.theme_curate, payload, timeout=timeout, on_progress=on_progress
            )
            for item in out["items"]:
                if item["video_id"] in hits:
                    verdicts.append(
                        (
                            item["video_id"],
                            bool(item["keep"]),
                            float(item["score"]),
                            item["why"],
                            hits[item["video_id"]][1],
                        )
                    )
            T.check_cancelled(on_progress)
        self._write_items(theme_id, verdicts)
        _progress(on_progress, "curate", len(verdicts), len(hits), step=(len(hits), len(hits)))
        return len(hits)

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
        """Fake: ``language`` becomes a hint in the text the model reads; ``classics`` forces the
        mode; cancelled → ``Cancelled`` and the theme is not kept (like the real one)."""
        if not query or not query.strip():
            raise T.ValidationError("tema vazio", field="query")
        if language not in (None, *T.THEME_LANGUAGES) or classics not in (None, True, False):
            raise T.ValidationError("invalid options", field="language")
        hints = [_THEME_HINTS[language]] if language in _THEME_HINTS else []
        if classics is not None:
            hints.append(
                "include the best videos of all time (evergreen classics)"
                if classics
                else "prefer recent videos"
            )
        ask = f"{query.strip()} — {'; '.join(hints)}" if hints else None
        _progress(on_progress, "expand", step=(0, None))
        reactions = self.video_state.reactions()
        disliked = self.video_store.get([v for v, r in reactions.items() if r is T.Reaction.down])
        exp = self.llm.complete_structured(
            T.AiTask.theme_expand,
            {
                "query": ask or query.strip(),
                "disliked_titles": [v.title for v in disliked.values()],
            },
            timeout=timeout,
        )
        mode = exp["mode"]
        if classics is True and mode != T.FeedMode.long.value:
            mode = T.FeedMode.classics.value
        elif classics is False and mode == T.FeedMode.classics.value:
            mode = T.FeedMode.fresh.value
        n = len(exp["searches"])
        _progress(on_progress, "expand", 1, 1, step=(n, n))
        theme_id = self._insert_theme(
            query.strip(),
            name=exp["name"],
            icon=exp["icon"],
            searches=exp["searches"],
            include_terms=exp["include_terms"],
            exclude_terms=exp["exclude_terms"],
        )
        try:
            evaluated = self._search_and_curate(
                theme_id,
                query.strip(),
                exp["searches"],
                exp["include_terms"],
                exp["exclude_terms"],
                mode,
                timeout,
                on_progress,
                ask,
            )
        except T.Cancelled:
            self.db.execute("DELETE FROM theme_items WHERE theme_id = ?", (theme_id,))
            self.db.execute("DELETE FROM themes WHERE id = ?", (theme_id,))
            raise
        except T.TubeError as exc:
            self.db.execute(
                "UPDATE themes SET status = 'error', error = ? WHERE id = ?",
                (exc.message, theme_id),
            )
            raise
        self.db.execute(
            "UPDATE themes SET status = 'preview', updated_at = ? WHERE id = ?",
            (self._now(), theme_id),
        )
        result = self.preview(theme_id)
        _progress(on_progress, "preview", 1, 1, step=(len(result.items), evaluated))
        return result

    def get(self, theme_id: str) -> T.Theme | None:
        row = self.db.query_one("SELECT * FROM themes WHERE id = ?", (theme_id,))
        return _theme_from_row(row) if row else None

    def list(self) -> list[T.Theme]:
        rows = self.db.query("SELECT * FROM themes ORDER BY created_at DESC, id DESC")
        return [_theme_from_row(r) for r in rows]

    def preview(self, theme_id: str) -> T.ThemePreview:
        theme = self.get(theme_id)
        if theme is None:
            raise T.NotFound(f"topic {theme_id} does not exist")
        rows = self.db.query(
            "SELECT * FROM theme_items WHERE theme_id = ? AND verdict = 'keep'"
            " ORDER BY score DESC, video_id",
            (theme_id,),
        )
        items = tuple(
            T.ThemeItem(
                theme_id=r["theme_id"],
                video_id=r["video_id"],
                verdict=T.ThemeVerdict(r["verdict"]),
                source=T.ThemeItemSource(r["source"]),
                score=r["score"],
                reason=r["reason"],
            )
            for r in rows
        )
        videos = self.video_store.get([i.video_id for i in items])
        by_channel: dict[str, list[T.Video]] = {}
        for v in videos.values():
            by_channel.setdefault(v.channel_id, []).append(v)
        seeds = tuple(
            T.ThemeSeed(
                channel_id=cid,
                title=(by_channel[cid][0].channel_title or cid) if by_channel.get(cid) else cid,
                kept_videos=len(by_channel.get(cid, [])),
            )
            for cid in theme.seeds
        )
        return T.ThemePreview(
            theme=theme, items=items, videos=videos, seeds=seeds, channel_count=len(by_channel)
        )

    def save(
        self,
        theme_id: str,
        edits: T.ThemeSaveEdits | None = None,
        *,
        actor: T.Actor = T.Actor.user,
    ) -> T.ThemeSaved:
        theme = self.get(theme_id)
        if theme is None:
            raise T.NotFound(f"topic {theme_id} does not exist")
        if theme.status is T.ThemeStatus.saved and theme.tab_id:
            raise T.Conflict("topic already saved")
        edits = edits or T.ThemeSaveEdits()
        name = edits.name or theme.name or theme.query
        followed: list[str] = []
        to_subscribe: list[str] = []
        with self.db.transaction(), self.changelog.group(f"salvar tema {name}"):
            folder_id = None
            if edits.create_folder:
                folder = self.taxonomy.create_folder(edits.folder_name or name, actor=actor)
                folder_id = folder.id
            tab = self.tabs.create(
                T.TabDraft(
                    name=name,
                    kind=T.TabKind.theme,
                    icon=edits.icon or theme.icon,
                    rules=T.TabRules(include=T.RuleInclude(themes=(theme_id,))),
                ),
                actor=actor,
            )
            videos = self.preview(theme_id).videos
            titles = {v.channel_id: v.channel_title or v.channel_id for v in videos.values()}
            follow_ids = [
                cid
                for cid, action in edits.seed_actions.items()
                if T.SeedAction(action) in (T.SeedAction.follow, T.SeedAction.subscribe)
            ]
            if follow_ids:
                self.channels.upsert_many(
                    [
                        T.ChannelIn(title=titles.get(cid, cid), channel_id=cid, folder_id=folder_id)
                        for cid in follow_ids
                    ],
                    source=T.ChannelSource.theme,
                    relation=T.Relation.followed,
                    actor=actor,
                )
                followed = follow_ids
                to_subscribe = [
                    cid
                    for cid, action in edits.seed_actions.items()
                    if T.SeedAction(action) is T.SeedAction.subscribe
                ]
            for vid in edits.removed_video_ids:
                self.db.execute(
                    "UPDATE theme_items SET verdict = 'cut' WHERE theme_id = ? AND video_id = ?",
                    (theme_id, vid),
                )
            self.db.execute(
                "UPDATE themes SET status = 'saved', tab_id = ?, name = ?, updated_at = ?"
                " WHERE id = ?",
                (tab.id, name, self._now(), theme_id),
            )
            rec = self.changelog.record(
                actor,
                T.ChangeAction.theme_save,
                {"label": name},
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

    def refresh(
        self,
        theme_id: str,
        *,
        timeout: float = T.TOOL_TIMEOUT_S,
        on_progress: T.ProgressFn | None = None,
    ) -> T.ThemePreview:
        theme = self.get(theme_id)
        if theme is None:
            raise T.NotFound(f"topic {theme_id} does not exist")
        self._search_and_curate(
            theme_id,
            theme.query,
            theme.searches,
            theme.include_terms,
            theme.exclude_terms,
            T.FeedMode.fresh.value,
            timeout,
            on_progress,
        )
        return self.preview(theme_id)

    def due(self, now: T.Timestamp | None = None) -> list[str]:
        now = self._now() if now is None else now
        rows = self.db.query(
            "SELECT id FROM themes WHERE status = 'saved' AND"
            " (last_search_at IS NULL OR last_search_at + cadence_days * 86400 <= ?)"
            " ORDER BY id",
            (now,),
        )
        return [r["id"] for r in rows]

    def apply_undo(self, change: T.ChangeRecord) -> None:
        u = change.undo
        if not isinstance(u, T.UndoThemeSave):
            raise T.UndoRefused("not_undoable", f"topics do not undo {change.action}")
        self.db.execute(
            "UPDATE themes SET status = 'preview', tab_id = NULL, updated_at = ? WHERE id = ?",
            (self._now(), u.theme_id),
        )

    def save_seeded(self, theme_id: str, *, actor: T.Actor = T.Actor.routine) -> T.Tab:
        """Test shortcut: saves without history (``seed_world``)."""
        theme = self.get(theme_id)
        assert theme is not None
        tab_id = self.ids.next("tab")
        draft = T.TabDraft(
            id=tab_id,
            name=theme.name or theme.query,
            kind=T.TabKind.theme,
            icon=theme.icon,
            rules=T.TabRules(include=T.RuleInclude(themes=(theme_id,))),
        )
        self.tabs._insert(tab_id, draft, self.tabs._next_sort())  # type: ignore[attr-defined]
        self.db.execute(
            "UPDATE themes SET status = 'saved', tab_id = ? WHERE id = ?", (tab_id, theme_id)
        )
        tab = self.tabs.get(tab_id)
        assert tab is not None
        return tab


# --------------------------------------------------------------------------- ListImporter


class FakeListImporter(_SqlFake):
    """``ListImporter`` over ``list_imports`` (fake: HTML becomes text through a simple regex)."""

    def __init__(
        self,
        db: T.Db,
        *,
        settings: T.Settings,
        http: T.HttpClient,
        llm: T.LLM,
        youtube: T.YouTubeClient,
        channels: T.ChannelService,
        tabs: T.TabService,
        video_store: T.VideoStore,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.settings = settings
        self.http = http
        self.llm = llm
        self.youtube = youtube
        self.channels = channels
        self.tabs = tabs
        self.video_store = video_store

    def import_list(
        self,
        url: str,
        *,
        timeout: float = T.TOOL_TIMEOUT_S,
        on_progress: T.ProgressFn | None = None,
    ) -> T.ListPreview:
        if not self.settings.get("extras_import_lists", False):
            raise T.Conflict('Extra "importar lista" desligado')
        _progress(on_progress, "download")
        resp = self.http.get(url, timeout=min(timeout, 20.0))
        if resp.status >= 400:
            raise T.HttpError(f"HTTP {resp.status} em {url}")
        text = re.sub(r"<[^>]+>", " ", resp.text)
        text = re.sub(r"[ \t]+", " ", text).strip() or url
        _progress(on_progress, "extract")
        out = self.llm.complete_structured(
            T.AiTask.list_extract, {"url": url, "text": text[:12_000]}, timeout=timeout
        )
        _progress(on_progress, "resolve", 0, len(out["items"]))
        entries = []
        for item in out["items"]:
            ref = item.get("handle_or_url")
            info = None
            if ref:
                try:
                    info = self.youtube.resolve_channel(ref)
                except T.TubeError:
                    info = None
            entries.append(
                T.ListEntry(
                    name=item["name"],
                    handle_or_url=ref,
                    note=item.get("note"),
                    channel_id=info.id if info else None,
                    title=info.title if info else None,
                )
            )
        list_id = self.ids.next("list")
        self.db.execute(
            "INSERT INTO list_imports (id, url, title, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            (list_id, url, out.get("title"), json_text({"entries": entries}), self._now()),
        )
        preview = self.get_preview(list_id)
        assert preview is not None
        return preview

    def get_preview(self, list_id: str) -> T.ListPreview | None:
        row = self.db.query_one("SELECT * FROM list_imports WHERE id = ?", (list_id,))
        if row is None:
            return None
        payload = json.loads(row["payload"])
        return T.ListPreview(
            id=row["id"],
            url=row["url"],
            entries=tuple(T.ListEntry(**e) for e in payload.get("entries", [])),
            created_at=int(row["created_at"]),
            title=row["title"],
            video_ids=tuple(payload.get("video_ids", [])),
            tab_id=row["tab_id"],
        )

    def to_tab(
        self,
        list_id: str,
        *,
        name: str | None = None,
        follow: bool = True,
        actor: T.Actor = T.Actor.user,
    ) -> T.Tab:
        preview = self.get_preview(list_id)
        if preview is None:
            raise T.NotFound(f"list {list_id} does not exist")
        resolved = [e for e in preview.entries if e.channel_id]
        if not resolved:
            raise T.ValidationError("nenhum canal resolvido na lista")
        if follow:
            self.channels.upsert_many(
                [T.ChannelIn(title=e.title or e.name, channel_id=e.channel_id) for e in resolved],
                source=T.ChannelSource.list,
                relation=T.Relation.followed,
                actor=actor,
            )
        tab = self.tabs.create_from_channels(
            name or preview.title or "Lista importada",
            [e.channel_id for e in resolved if e.channel_id],
            actor=actor,
        )
        self.db.execute("UPDATE list_imports SET tab_id = ? WHERE id = ?", (tab.id, list_id))
        return tab


# --------------------------------------------------------------------------- SyncIngest


class FakeSyncIngest(_SqlFake):
    """``SyncIngest`` over ``watch_history``, using the services for the rest."""

    def __init__(
        self,
        db: T.Db,
        *,
        settings: T.Settings,
        channels: T.ChannelService,
        video_state: T.VideoStateService,
        refresher: T.Refresher,
        feed: T.FeedEngine,
        tabs: T.TabService,
        taxonomy: T.TaxonomyService,
        searcher: T.Searcher,
        cleanup: T.Cleanup,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.settings = settings
        self.channels = channels
        self.video_state = video_state
        self.refresher = refresher
        self.feed = feed
        self.tabs = tabs
        self.taxonomy = taxonomy
        self.searcher = searcher
        self.cleanup = cleanup

    def ingest_subscriptions(self, device_id: str, batch: T.SubscriptionBatch) -> T.SyncReport:
        signal = T.SyncSignal(batch.signal)
        report = self.channels.upsert_many(
            batch.channels,
            source=T.ChannelSource.extension,
            relation=T.Relation.subscribed,
            actor=T.Actor.extension,
        )
        marked: list[str] = []
        if signal is T.SyncSignal.complete:
            seen = set(report.inserted) | set(report.updated) | set(report.duplicates.values())
            seen |= {c.channel_id for c in batch.channels if c.channel_id}
            for ch in self.channels.list(T.ChannelFilter(relations=(T.Relation.subscribed,))):
                if ch.id not in seen:
                    self.channels.set_relation(
                        ch.id,
                        T.Relation.ex,
                        actor=T.Actor.extension,
                        reason="cancelado fora do app",
                    )
                    marked.append(ch.id)
        return T.SyncReport(
            signal=signal, added=report.inserted, updated=report.updated, marked_ex=tuple(marked)
        )

    def ingest_watch(self, device_id: str, events: Sequence[T.WatchEvent]) -> int:
        added = 0
        new_ids: list[str] = []
        for e in events:
            res = self.db.execute(
                "INSERT OR IGNORE INTO watch_history (video_id, channel_id, watched_at, device_id)"
                " VALUES (?, ?, ?, ?)",
                (e.video_id, e.channel_id, e.watched_at, device_id),
            )
            if res.rowcount:
                added += 1
                new_ids.append(e.video_id)
        if new_ids:
            self.video_state.set_state(new_ids, T.VideoState.watched, actor=T.Actor.extension)
        return added

    def ext_state(self, device_id: str | None = None) -> T.ExtState:
        self.refresher.kick_if_due()
        counts = self.feed.new_counts()
        snap = self.settings.snapshot()
        return T.ExtState(
            new_total=counts.total,
            tabs=tuple(
                T.TabCount(tab_id=t.id, name=t.name, icon=t.icon, count=counts.by_tab.get(t.id, 0))
                for t in self.tabs.list()
            ),
            folders=tuple(
                T.FolderCount(
                    folder_id=f.id,
                    name=f.name,
                    parent_id=f.parent_id,
                    count=counts.by_folder.get(f.id, 0),
                )
                for f in self.taxonomy.list_folders()
            ),
            search_pending=self.searcher.pending_count(),
            queue_pending=len(self.cleanup.queue_pending()),
            home_on_youtube=snap.home_on_youtube,
            extras_honest_thumbnails=snap.extras_honest_thumbnails,
            extras_hn_lens=snap.extras_hn_lens,
            extras_hn_channels=snap.extras_hn_channels,
            extras_import_lists=snap.extras_import_lists,
            refresh_running=self.refresher.is_running(),
            last_rss_at=self.refresher.last_rss_at(),
            language=snap.language,
            device_id=device_id,
            server_time=self._now(),
        )


# --------------------------------------------------------------------------- DemoLoader / DataOps

DEMO_FOLDERS = ("Demo · Tecnologia", "Demo · Ciência")
DEMO_CHANNELS: tuple[tuple[str, str, int, bool], ...] = (
    ("UCdemo0000000000000000t1", "Demo Tech Um", 0, True),
    ("UCdemo0000000000000000t2", "Demo Tech Dois", 0, False),
    ("UCdemo0000000000000000c1", "Demo Ciência", 1, False),
)
"""fake: 3 channels in 2 folders (the real one loads ~40 in 6)."""


class FakeDemoLoader(_SqlFake):
    """Minimal ``DemoLoader``, through the services; sets ``meta.demo_loaded``."""

    def __init__(
        self,
        db: T.Db,
        *,
        settings: T.Settings,
        channels: T.ChannelService,
        taxonomy: T.TaxonomyService,
        tabs: T.TabService,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.settings = settings
        self.channels = channels
        self.taxonomy = taxonomy
        self.tabs = tabs

    def _set_loaded(self, value: bool) -> None:
        self.db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (T.META_DEMO_LOADED, "1" if value else "0"),
        )

    def is_loaded(self) -> bool:
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (T.META_DEMO_LOADED,))
        return bool(row and row["value"] == "1")

    def load(self) -> T.DataReport:
        if self.is_loaded():
            return T.DataReport()
        folder_ids = []
        created_folders = 0
        for name in DEMO_FOLDERS:
            folder = self.taxonomy.find_folder_by_name(name, parent_id=None)
            if folder is None:
                folder = self.taxonomy.create_folder(name, actor=T.Actor.user)
                created_folders += 1
            folder_ids.append(folder.id)
        report = self.channels.upsert_many(
            [
                T.ChannelIn(title=title, channel_id=cid, folder_id=folder_ids[f], favorite=fav)
                for cid, title, f, fav in DEMO_CHANNELS
            ],
            source=T.ChannelSource.demo,
            relation=T.Relation.followed,
            actor=T.Actor.extension,
        )
        self._set_loaded(True)
        return T.DataReport(channels=len(report.inserted), folders=created_folders)

    def purge(self) -> int:
        """Removes demo channels and the empty demo folders (no history)."""
        removed = self.channels.remove_by_source(T.ChannelSource.demo)
        for name in DEMO_FOLDERS:
            folder = self.taxonomy.find_folder_by_name(name, parent_id=None)
            if folder is not None and not self.db.query_one(
                "SELECT 1 AS x FROM channels WHERE folder_id = ?", (folder.id,)
            ):
                self.db.execute("DELETE FROM folders WHERE id = ?", (folder.id,))
        self._set_loaded(False)
        return removed

    def clear(self) -> T.DataReport:
        return T.DataReport(channels=self.purge())


EXPORT_TABLES = (
    "folders",
    "tags",
    "channels",
    "channel_tags",
    "tabs",
    "themes",
    "theme_items",
    "video_state",
)
"""Tables the fake exports (never ``EXPORT_EXCLUDED_TABLES``)."""


class FakeDataOps(_SqlFake):
    """``DataOps``: export reads only ``EXPORT_TABLES``; import uses the services and ignores any
    other key (including the operational ones) — it never creates a queue item."""

    def __init__(
        self,
        db: T.Db,
        *,
        settings: T.Settings,
        channels: T.ChannelService,
        taxonomy: T.TaxonomyService,
        tabs: T.TabService,
        video_state: T.VideoStateService,
        demo: T.DemoLoader,
        changelog: T.ChangeLog,
        clock: T.Clock | None = None,
        ids: IdGen | None = None,
    ) -> None:
        super().__init__(db, clock=clock, ids=ids)
        self.settings = settings
        self.channels = channels
        self.taxonomy = taxonomy
        self.tabs = tabs
        self.video_state = video_state
        self.demo = demo
        self.changelog = changelog

    def load_demo(self, ui_locale: str | None = None) -> T.DataReport:
        with self.db.transaction(), self.changelog.group("demo mode"):
            report = self.demo.load()
            if report.channels or report.folders:
                self.changelog.record(
                    T.Actor.user,
                    T.ChangeAction.demo_load,
                    {"channels": report.channels},
                    T.UndoDemoLoad(),
                )
        return report

    def clear_demo(self) -> T.DataReport:
        return self.demo.clear()

    def demo_loaded(self) -> bool:
        return self.demo.is_loaded()

    def export_json(self) -> dict[str, Any]:
        return {
            "schema_version": T.SCHEMA_VERSION,
            "exported_at": self._now(),
            "tables": {t: self.db.query(f"SELECT * FROM {t} ORDER BY 1") for t in EXPORT_TABLES},
        }

    def _import_tree(
        self,
        folders: Sequence[Mapping[str, Any]],
        tags: Sequence[Mapping[str, Any]],
        channels: Sequence[Mapping[str, Any]],
        channel_tags: Mapping[str, list[str]],
        source_default: T.ChannelSource,
    ) -> T.DataReport:
        warnings: list[str] = []
        folder_map: dict[str, str] = {}
        pending = [dict(f) for f in folders if f.get("id") and f.get("name")]
        created_f = 0
        for _ in range(len(pending) + 1):
            if not pending:
                break
            rest = []
            for f in pending:
                parent = f.get("parent_id")
                if parent and parent not in folder_map:
                    if any(p["id"] == parent for p in pending):
                        rest.append(f)
                        continue
                    parent = None
                parent_new = folder_map.get(parent) if parent else None
                found = self.taxonomy.find_folder_by_name(f["name"], parent_id=parent_new)
                if found is None:
                    found = self.taxonomy.create_folder(
                        f["name"], parent_id=parent_new, color=f.get("color")
                    )
                    created_f += 1
                folder_map[f["id"]] = found.id
            pending = rest
        tag_map: dict[str, str] = {}
        created_t = 0
        for t in tags:
            if not t.get("id") or not t.get("name"):
                continue
            found = self.taxonomy.find_tag_by_name(t["name"])
            if found is None:
                found = self.taxonomy.create_tag(t["name"], color=t.get("color"))
                created_t += 1
            tag_map[t["id"]] = found.id
        groups: dict[tuple[T.ChannelSource, T.Relation], list[T.ChannelIn]] = {}
        skipped = 0
        for c in channels:
            cid = c.get("id")
            if not isinstance(cid, str) or not dedup.is_channel_id(cid):
                skipped += 1
                warnings.append(f"channel without a valid id: {c.get('title') or cid!r}")
                continue
            try:
                source = T.ChannelSource(c.get("source") or source_default)
                relation = T.Relation(c.get("relation") or T.Relation.followed)
            except ValueError:
                skipped += 1
                continue
            groups.setdefault((source, relation), []).append(
                T.ChannelIn(
                    title=c.get("title") or cid,
                    channel_id=cid,
                    handle=c.get("handle"),
                    url=c.get("url"),
                    thumb=c.get("thumb"),
                    folder_id=folder_map.get(c.get("folder_id") or ""),
                    tag_ids=tuple(tag_map[t] for t in channel_tags.get(cid, []) if t in tag_map),
                    favorite=bool(c.get("favorite")),
                )
            )
        inserted = 0
        for (source, relation), items in groups.items():
            report = self.channels.upsert_many(
                items, source=source, relation=relation, actor=T.Actor.user
            )
            inserted += len(report.inserted)
        return T.DataReport(
            channels=inserted,
            folders=created_f,
            tags=created_t,
            skipped=skipped,
            warnings=tuple(warnings),
        )

    def import_mytube(self, data: Mapping[str, Any]) -> T.DataReport:
        """fake: lenient format (``folders``/``tags``/``channels`` with ``id``/``channelId``,
        ``title``/``name``, ``folderId``/``folder_id``, ``tags``/``tagIds``)."""

        def pick(d: Mapping[str, Any], *keys: str) -> Any:
            return next((d[k] for k in keys if k in d), None)

        folders = [
            {
                "id": pick(f, "id"),
                "name": pick(f, "name", "title"),
                "parent_id": pick(f, "parentId", "parent_id"),
            }
            for f in data.get("folders", [])
        ]
        tags = [
            {"id": pick(t, "id"), "name": pick(t, "name"), "color": pick(t, "color")}
            for t in data.get("tags", [])
        ]
        channels = []
        links: dict[str, list[str]] = {}
        for c in data.get("channels", []):
            cid = pick(c, "id", "channelId", "channel_id")
            channels.append(
                {
                    "id": cid,
                    "title": pick(c, "title", "name"),
                    "handle": pick(c, "handle"),
                    "folder_id": pick(c, "folderId", "folder_id"),
                    "favorite": pick(c, "favorite", "starred"),
                    "relation": "followed",
                    "source": "mytube",
                }
            )
            links[str(cid)] = list(pick(c, "tags", "tagIds", "tag_ids") or [])
        with self.db.transaction(), self.changelog.group("importar MyTube"):
            report = self._import_tree(folders, tags, channels, links, T.ChannelSource.mytube)
            self.changelog.record(
                T.Actor.user, T.ChangeAction.data_import, {"kind": "mytube"}, T.UndoNotSupported()
            )
        return report

    def import_json(self, data: Mapping[str, Any]) -> T.DataReport:
        tables = data.get("tables") if isinstance(data.get("tables"), Mapping) else data
        assert isinstance(tables, Mapping)
        links: dict[str, list[str]] = {}
        for link in tables.get("channel_tags", []) or []:
            links.setdefault(link["channel_id"], []).append(link["tag_id"])
        with self.db.transaction(), self.changelog.group("importar JSON"):
            report = self._import_tree(
                tables.get("folders", []) or [],
                tables.get("tags", []) or [],
                tables.get("channels", []) or [],
                links,
                T.ChannelSource.link,
            )
            tabs = 0
            for row in tables.get("tabs", []) or []:
                if row.get("builtin") or self.tabs.get(row.get("id", "")) is not None:
                    continue
                try:
                    self.tabs.create(
                        T.TabDraft(
                            id=row["id"],
                            name=row["name"],
                            kind=T.TabKind(row["kind"]),
                            icon=row.get("icon"),
                            rules=T.TabRules.from_dict(json.loads(row.get("rules") or "{}")),
                        )
                    )
                    tabs += 1
                except (T.TubeError, KeyError, ValueError):
                    continue
            by_state: dict[str, list[str]] = {}
            for row in tables.get("video_state", []) or []:
                by_state.setdefault(row.get("state", "new"), []).append(row["video_id"])
            for state, vids in by_state.items():
                self.video_state.set_state(vids, T.VideoState(state), actor=T.Actor.extension)
            self.changelog.record(
                T.Actor.user, T.ChangeAction.data_import, {"kind": "json"}, T.UndoNotSupported()
            )
        return replace(report, tabs=tabs, videos=sum(len(v) for v in by_state.values()))

    def apply_undo(self, change: T.ChangeRecord) -> None:
        if isinstance(change.undo, T.UndoDemoLoad):
            self.channels.remove_by_source(T.ChannelSource.demo)
            self.db.execute("UPDATE meta SET value = '0' WHERE key = ?", (T.META_DEMO_LOADED,))
            return
        raise T.UndoRefused("not_undoable", f"data does not undo {change.action}")


# --------------------------------------------------------------------------- RoutinesInstaller

ROUTINE_SPECS: dict[str, tuple[T.RoutineKind, str, str]] = {
    "bom-dia": (T.RoutineKind.no_agent, "0 8 * * *", "Novos dos ⭐ + contagem por aba"),
    "favoritos": (T.RoutineKind.no_agent, "*/30 * * * *", "Só quando há vídeo novo de ⭐"),
    "resumo-pasta": (T.RoutineKind.agent, "0 19 * * *", "Resumo dos novos de uma pasta"),
    "faxina-mensal": (T.RoutineKind.no_agent, "0 10 1 * *", "Lista da faxina + /tube faxina"),
    "pasta-novos": (T.RoutineKind.no_agent, "0 9 * * *", "Sugestões para canais recém-adicionados"),
}


class FakeRoutinesInstaller:
    """In-memory ``RoutinesInstaller``: asks through *confirm* with the
    ``install``/``cancel`` choices and marks the routines as installed (includes
    ``MAINTENANCE_SCRIPTS``).
    ``remove`` like the real one: nothing installed → does not ask; ``cancel`` first; only the exact
    value ``remove`` (a plain ``str``) removes."""

    CHOICES = (
        {"value": "install", "label": "Instalar"},
        {"value": "cancel", "label": "Cancelar"},
    )
    REMOVE_CHOICES = (
        {"value": "cancel", "label": "Cancelar"},
        {"value": "remove", "label": "Remover"},
    )

    def __init__(self) -> None:
        self.installed: set[str] = set()
        self.scripts: set[str] = set()
        self.questions: list[str] = []

    def list(self) -> list[T.RoutineInfo]:
        return [
            T.RoutineInfo(
                key=key,
                kind=ROUTINE_SPECS[key][0],
                schedule=ROUTINE_SPECS[key][1],
                description=ROUTINE_SPECS[key][2],
                installed=key in self.installed,
            )
            for key in T.ROUTINE_KEYS
        ]

    def install(self, confirm: T.AskChoice, keys: Sequence[str] | None = None) -> T.InstallReport:
        wanted = list(keys) if keys is not None else list(T.ROUTINE_KEYS)
        unknown = [k for k in wanted if k not in ROUTINE_SPECS]
        if unknown:
            raise T.ValidationError(f"rotinas desconhecidas: {unknown}")
        question = f"Instalar {len(wanted)} rotina(s): {', '.join(wanted)}?"
        self.questions.append(question)
        answer = confirm(question, [dict(c) for c in self.CHOICES])
        if answer != "install":
            return T.InstallReport(cancelled=True, message="Nada instalado.")
        new = [k for k in wanted if k not in self.installed]
        self.installed.update(new)
        self.scripts.update(T.MAINTENANCE_SCRIPTS)
        return T.InstallReport(
            installed=tuple(new),
            skipped=tuple(k for k in wanted if k not in new),
            message=f"{len(new)} rotina(s) instalada(s).",
        )

    def remove(self, confirm: T.AskChoice, keys: Sequence[str] | None = None) -> T.InstallReport:
        wanted = list(keys) if keys is not None else list(T.ROUTINE_KEYS)
        unknown = [k for k in wanted if k not in ROUTINE_SPECS]
        if unknown:
            raise T.ValidationError(f"rotinas desconhecidas: {unknown}")
        present = [k for k in T.ROUTINE_KEYS if k in wanted and k in self.installed]
        maint = sorted(self.scripts) if keys is None else []
        names = present + [m.removesuffix(".py") for m in maint]
        if not names:
            return T.InstallReport(message="Nenhuma rotina instalada.")
        question = f"Remover {len(names)} rotina(s) do YouTube neste perfil: {', '.join(names)}?"
        self.questions.append(question)
        answer = confirm(question, [dict(c) for c in self.REMOVE_CHOICES])
        if not (type(answer) is str and answer == "remove"):
            return T.InstallReport(cancelled=True, message="Nada removido.")
        self.installed.difference_update(present)
        self.scripts.difference_update(maint)
        return T.InstallReport(installed=tuple(names))


# --------------------------------------------------------------------------- Maintenance


class FakeMaintenance:
    """``Maintenance`` through the services: ``ex → ignored``, expired themes, purges."""

    JOB_RETENTION_S = 7 * DAY

    def __init__(
        self,
        db: T.Db,
        *,
        settings: T.Settings,
        channels: T.ChannelService,
        themes: T.Themes,
        jobs: T.JobRunner,
        searcher: T.Searcher,
        clock: T.Clock | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.channels = channels
        self.themes = themes
        self.jobs = jobs
        self.searcher = searcher
        self.clock = clock or FakeClock()

    def run(self, *, now: T.Timestamp | None = None) -> T.MaintenanceReport:
        now = self.clock.now() if now is None else now
        days = int(self.settings.get("ex_retention_days", 30))
        moved = []
        for ch in self.channels.list(T.ChannelFilter(relations=(T.Relation.ex,))):
            if ch.unsubscribed_at is not None and ch.unsubscribed_at <= now - days * DAY:
                self.channels.set_relation(
                    ch.id, T.Relation.ignored, actor=T.Actor.routine, reason="retention"
                )
                moved.append(ch.id)
        refreshed = []
        for theme_id in self.themes.due(now):
            try:
                self.themes.refresh(theme_id)
            except T.TubeError:
                continue
            refreshed.append(theme_id)
        return T.MaintenanceReport(
            ex_to_ignored=tuple(moved),
            themes_refreshed=tuple(refreshed),
            jobs_purged=self.jobs.purge(now - self.JOB_RETENTION_S),
            search_jobs_purged=self.searcher.purge_expired(now),
        )


__all__ = [
    "DEMO_CHANNELS",
    "EXPORT_TABLES",
    "FakeCleanup",
    "FakeDataOps",
    "FakeDemoLoader",
    "FakeFeedEngine",
    "FakeListImporter",
    "FakeMaintenance",
    "FakeOrganizer",
    "FakeRefresher",
    "FakeRoutinesInstaller",
    "FakeSearcher",
    "FakeSyncIngest",
    "FakeThemes",
]
