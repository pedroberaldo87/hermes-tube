"""What each routine delivers. One function per key: ``RoutineEnv -> Outcome``.

Common rules:

- nothing new → ``Outcome(None)`` (silence; 0 tokens);
- short messages for Telegram: plain text, one piece of information per line, no tables/markdown
  (the one exception is the bold first line of the ``favoritos`` card, see ``fav_card``);
  third-party titles on a single line, without control characters, clipped;
- no routine changes a channel, approves or unsubscribes: the cleanup **only builds the list**
  (rule-based scan, the same as ``tube_cleanup_scan``) and points to ``/tube faxina``;
  ``pasta-novos`` only points to organizing;
- ``resumo-pasta`` is the only one that reaches the model, and only through the Hermes agent job:
  the script prints titles + descriptions **delimited as untrusted data**
  (``UNTRUSTED_OPEN``/``_CLOSE``), already neutralized (no backticks — Hermes fences the output
  with ``` —, no markers, no invisible characters, none of the injection phrases the Hermes cron
  blocks).

Marks (``meta routine.<key>.mark``): how far the routine already notified (the video's
``first_seen_at`` or the channel's ``added_at``). Missing on the first run → a
``FIRST_RUN_WINDOW_S`` window.
"""

from __future__ import annotations

import re
import time
import unicodedata
from collections.abc import Iterable

from tube_pkg.core import lang as lang_rule
from tube_pkg.core import types as T
from tube_pkg.routines import cover, deliver
from tube_pkg.routines.catalog import REPLY_LANGUAGE, UNTRUSTED_CLOSE, UNTRUSTED_OPEN
from tube_pkg.routines.runner import Composer, Outcome, RoutineEnv, is_lock_error

FIRST_RUN_WINDOW_S = 86400
FAV_WINDOW_S = 3600
"""``favoritos`` without a mark: only reports what arrived in the last hour (no install flood)."""
REUSE_SCAN_S = 7 * 86400
"""Cleanup: a scan newer than this is reused (keeps the AI reasons and group)."""
PAGE_LIMIT = 100
MAX_PAGES = 3
DIGEST_MAX_VIDEOS = 30
DIGEST_PER_CHANNEL = 3
DIGEST_DESC_CHARS = 280
FAV_MAX_ITEMS = 5
NAMES_PER_GROUP = 5

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_BAD_CATEGORIES = frozenset({"Cc", "Cf", "Co", "Cs", "Zl", "Zp"})
_INJECTION = tuple(
    re.compile(p, re.I)
    for p in (
        r"ignore\s+(?:\w+\s+)*(?:previous|all|above|prior)\s+(?:\w+\s+)*instructions",
        r"do\s+not\s+tell\s+the\s+user",
        r"system\s+prompt\s+override",
        r"disregard\s+(?:your|all|any)\s+(?:instructions|rules|guidelines)",
        r"ignor[ea]\s+(?:\w+\s+)*(?:instru[çc][õo]es|regras)\s+(?:\w+\s+)*anteriores",
    )
)
_MARKER = re.compile(r"DADOS_DO_YOUTUBE", re.I)


# =========================================================================== text


def _strip_controls(text: str) -> str:
    return "".join(" " if unicodedata.category(ch) in _BAD_CATEGORIES else ch for ch in text)


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def line(text: object, limit: int = 80) -> str:
    """Third-party text on one message line (channel/video title)."""
    raw = _strip_controls(str(text or "")).replace("`", "'")
    return _clip(" ".join(raw.split()), limit)


_HAIR = "\u200a"  # hair space: nearly invisible, and it breaks an adjacent markup pair
_WORD_JOINER = "\u2060"
_TG_TAG = re.compile(r"<(?=/?[A-Za-z])")
_TG_MEDIA = re.compile(r"(media)(?=:)", re.I)
_TG_STARS = re.compile(r"\*")
_TG_TILDES = re.compile(r"~{2,}")
_TG_BARS = re.compile(r"\|{2,}")


def telegram_safe(text: str) -> str:
    """Make one line of third-party text literal for ``hermes send`` (Telegram).

    ``hermes send`` turns the message into MarkdownV2 with the Telegram plugin's
    ``to_markdown_v2``. That formatter has **no escape**: a backslash before ``*`` is itself
    escaped and the asterisk still opens bold. It treats as markup ``*`` (bold and italic runs),
    ``[text](target)`` (link), ``~~x~~`` (strike), ``||x||`` (spoiler), a leading ``#`` (header)
    or ``>`` (quote), backticks (already turned into quotes by ``line``) and, outside the
    formatter, a Telegram HTML tag (``<b>``, ``<a ...>``) flips the whole message to HTML, and a
    ``MEDIA:`` tag or ``[[as_document]]`` directive is read by ``hermes send`` itself. Underscore,
    a single pipe or tilde, a single bracket, ``$`` and ``(`` are plain text there (escaped).

    So each trigger is replaced by a look-alike or broken with a hair space; nothing else changes.
    """
    out = _TG_STARS.sub("\u2217", text)  # asterisk operator
    out = _TG_TILDES.sub(lambda m: "\u223c" * len(m.group(0)), out)  # tilde operator
    out = _TG_BARS.sub(lambda m: "\u2223" * len(m.group(0)), out)  # divides
    out = out.replace("](", "]" + _HAIR + "(")
    out = re.sub(r"\[(?=\[)", "[" + _HAIR, out)
    out = _TG_TAG.sub("\u2039", out)
    out = _TG_MEDIA.sub(lambda m: m.group(1) + _HAIR, out)
    if out[:1] in ("#", ">"):
        out = _WORD_JOINER + out
    return out


def untrusted(text: object, limit: int) -> str:
    """YouTube text that goes to the model: one line, neutralized and clipped."""
    raw = _strip_controls(str(text or "")).replace("`", "'")
    raw = re.sub(r"<{2,}|>{2,}", " ", raw)
    raw = _MARKER.sub("data", raw)
    raw = " ".join(raw.split())
    for pattern in _INJECTION:
        raw = pattern.sub("[removed]", raw)
    return _clip(raw, limit)


def video_url(video_id: str) -> str:
    if _YT_ID.match(video_id or ""):
        return f"https://youtu.be/{video_id}"
    return "https://www.youtube.com/watch?v=" + re.sub(r"[^A-Za-z0-9_-]", "", video_id or "")


def _names(names: Iterable[str], limit: int = NAMES_PER_GROUP) -> str:
    items = [n for n in names if n]
    shown = ", ".join(items[:limit])
    extra = len(items) - limit
    return f"{shown} +{extra}" if extra > 0 else shown


def _when(ts: int, lang: str) -> str:
    fmt = lang_rule.pick(lang, "%d/%m %H:%M", "%Y-%m-%d %H:%M")
    return time.strftime(fmt, time.localtime(ts))


# =========================================================================== services


def _refresh(env: RoutineEnv) -> None:
    """RSS clock (``kick_if_due(wait=True)``: respects the grace period and the refresh lock). No
    network, RSS down or database busy → carries on with what is already stored."""
    try:
        result = env.get("refresher").kick_if_due(wait=True)
        env.notes.append(f"RSS: {result}")
    except Exception as exc:  # noqa: BLE001
        kind = "database busy" if is_lock_error(exc) else type(exc).__name__
        env.notes.append(f"RSS not refreshed ({kind}: {' '.join(str(exc).split())[:160]})")


def _cover(env: RoutineEnv, video_id: str | None) -> str | None:
    """Cover file of one video for its message (``None`` on any failure)."""
    try:
        return cover.fetch(env.get("http"), env.home, video_id)
    except Exception:  # noqa: BLE001 - a cover is optional
        return None


def _new_items(env: RoutineEnv, tab_id: str) -> list[T.FeedItem]:
    feed = env.get("feed")
    items: list[T.FeedItem] = []
    cursor: str | None = None
    for _ in range(MAX_PAGES):
        page = feed.page(tab_id, limit=PAGE_LIMIT, cursor=cursor)
        items.extend(it for it in page.items if it.is_new)
        cursor = page.next_cursor
        if not cursor:
            break
    return items


def _folder_paths(env: RoutineEnv) -> dict[str, str]:
    folders = {f.id: f for f in env.get("taxonomy").list_folders()}

    def path(fid: str) -> str:
        parts: list[str] = []
        seen: set[str] = set()
        cur = folders.get(fid)
        while cur is not None and cur.id not in seen:
            seen.add(cur.id)
            parts.append(line(cur.name, 40))
            cur = folders.get(cur.parent_id or "")
        return " / ".join(reversed(parts))

    return {fid: path(fid) for fid in folders}


# =========================================================================== routines


def bom_dia(env: RoutineEnv) -> Outcome:
    """☀️ 08:00: new videos from ⭐ + count per tab. Nothing new → silence."""
    _refresh(env)
    st = env.get("refresher").status()
    if st.new_total <= 0:
        return Outcome()
    lines = [
        env.t(
            f"☀️ Bom dia! {st.new_total} vídeo(s) novo(s) no YouTube.",
            f"☀️ Good morning! {st.new_total} new YouTube video(s).",
        )
    ]
    favs = sorted(st.fav_new, key=lambda f: (-f.count, f.title))
    for fav in favs[:FAV_MAX_ITEMS]:
        latest = f" — {line(fav.latest_title, 70)}" if fav.latest_title else ""
        lines.append(f"⭐ {line(fav.title, 40)}: {fav.count}{latest}")
    if len(favs) > FAV_MAX_ITEMS:
        rest = len(favs) - FAV_MAX_ITEMS
        lines.append(env.t(f"⭐ +{rest} canal(is) favorito(s)", f"⭐ +{rest} favorite channel(s)"))
    tabs = [t for t in st.new_by_tab if t.count > 0]
    if tabs:
        shown = " · ".join(
            f"{line(lang_rule.tab_name(t.tab_id, t.name, env.lang), 24)} {t.count}"
            for t in tabs[:6]
        )
        lines.append(env.t("Abas: ", "Tabs: ") + shown)
    if st.rss_down_since:
        since = _when(st.rss_down_since, env.lang)
        lines.append(
            env.t(
                f"O RSS do YouTube está fora do ar desde {since}; mostrei o que já havia.",
                f"YouTube's RSS has been down since {since}; showing what I already had.",
            )
        )
    lines.append(
        env.t("Para ver: Home do Hermes ou /tube triar.", "To watch: Hermes Home or /tube triage.")
    )
    return Outcome("\n".join(lines))


def fav_card(env: RoutineEnv, it: T.FeedItem, cover_path: str | None) -> deliver.Card:
    """The approved message of one new favorite video (see ``routines.deliver``)::

        ⭐ **New from CHANNEL**
        TITLE
        <empty line>
        ▶️ https://youtu.be/ID

    The name is bold unless it held anything that had to be neutralised (``telegram_safe``).
    """
    who = line(it.channel.title if it.channel else it.video.channel_title, 40) or "YouTube"
    safe_who = telegram_safe(who)
    head = f"{env.t('Novo de', 'New from')} {safe_who}"
    if safe_who == who:
        head = f"**{head}**"
    title = telegram_safe(line(it.video.title, 90))
    text = f"\u2b50 {head}\n{title}\n\n\u25b6\ufe0f {video_url(it.video.id)}"
    return deliver.Card(text, cover_path)


def favoritos(env: RoutineEnv) -> Outcome:
    """⚡ every 30 min: only when a new ⭐ video arrived since the last notice."""
    _refresh(env)
    mark = env.mark()
    since = mark if mark is not None else env.now - FAV_WINDOW_S
    fresh = [
        it for it in _new_items(env, T.BUILTIN_TAB_FAVORITES) if it.video.first_seen_at > since
    ]
    if not fresh:
        return Outcome()
    fresh.sort(key=lambda it: (-(it.video.published_at or 0), it.video.id))
    cards = [fav_card(env, it, _cover(env, it.video.id)) for it in fresh[:FAV_MAX_ITEMS]]
    if len(fresh) > FAV_MAX_ITEMS:
        rest = len(fresh) - FAV_MAX_ITEMS
        more = env.t(f"+{rest} outro(s) — /tube triar", f"+{rest} more — /tube triage")
        cards[-1] = deliver.Card(f"{cards[-1].text}\n\n{more}", cards[-1].media)
    newest = max(it.video.first_seen_at for it in fresh)
    return Outcome(
        "\n\n".join(c.text for c in cards),
        marks={env.key: max(newest, since)},
        cards=tuple(cards),
    )


def resumo_pasta(env: RoutineEnv) -> Outcome:
    """🧠 19:00: pre-check of the agent job. Nothing new → empty stdout (the model is not even
    called). Something new → delimited untrusted data, grouped by folder."""
    _refresh(env)
    mark = env.mark()
    since = mark if mark is not None else env.now - FIRST_RUN_WINDOW_S
    fresh = [it for it in _new_items(env, T.BUILTIN_TAB_ALL_NEW) if it.video.first_seen_at > since]
    if not fresh:
        return Outcome()
    fresh.sort(key=lambda it: (-(it.video.published_at or 0), it.video.id))
    per_channel: dict[str, int] = {}
    chosen: list[T.FeedItem] = []
    for it in fresh:
        n = per_channel.get(it.video.channel_id, 0)
        if n >= DIGEST_PER_CHANNEL:
            continue
        per_channel[it.video.channel_id] = n + 1
        chosen.append(it)
        if len(chosen) >= DIGEST_MAX_VIDEOS:
            break
    paths = _folder_paths(env)
    no_folder = env.t("(sem pasta)", "(no folder)")
    groups: dict[str, list[T.FeedItem]] = {}
    for it in chosen:
        fid = it.channel.folder_id if it.channel else None
        groups.setdefault(paths.get(fid or "", no_folder), []).append(it)
    out = [
        REPLY_LANGUAGE.format(name=lang_rule.NAMES[lang_rule.normalize(env.lang) or "en"]),
        env.t(
            f"Vídeos novos do YouTube desde o último resumo: {len(fresh)} "
            f"(listados {len(chosen)}, até {DIGEST_PER_CHANNEL} por canal).",
            f"New YouTube videos since the last digest: {len(fresh)} "
            f"(listed {len(chosen)}, up to {DIGEST_PER_CHANNEL} per channel).",
        ),
        UNTRUSTED_OPEN,
    ]
    for folder in sorted(groups, key=lambda f: (f == no_folder, f.casefold())):
        out.append(f"{env.t('Pasta', 'Folder')}: {untrusted(folder, 80)}")
        for it in groups[folder]:
            who = untrusted(it.channel.title if it.channel else it.video.channel_title, 60)
            out.append(f"- {who} · {untrusted(it.video.title, 160)} · {video_url(it.video.id)}")
            desc = untrusted(it.video.description, DIGEST_DESC_CHARS)
            if desc:
                out.append(f"  {env.t('Descrição', 'Description')}: {desc}")
    out.append(UNTRUSTED_CLOSE)
    newest = max(it.video.first_seen_at for it in fresh)
    return Outcome("\n".join(out), marks={env.key: max(newest, since)})


_GROUP_LABEL = {
    T.CleanupGroup.stale: ("Parados", "Inactive"),
    T.CleanupGroup.ignored: ("Sem assistir", "Not watched"),
    T.CleanupGroup.off_profile: ("Fora do perfil", "Off profile"),
    T.CleanupGroup.manual: ("Marcados por você", "Marked by you"),
}


def faxina_mensal(env: RoutineEnv) -> Outcome:
    """🧹 day 1: only the list (rules; no AI here) + a pointer. Never approves or unsubscribes."""
    cleanup = env.get("cleanup")
    latest = cleanup.latest_scan()
    if latest is None or env.now - int(latest.created_at or 0) > REUSE_SCAN_S:
        cleanup.scan(timeout=float(T.TOOL_TIMEOUT_S))
        latest = cleanup.latest_scan()
    cands = [
        c for c in (latest.candidates if latest else ()) if c.status is T.CandidateStatus.pending
    ]
    if not cands:
        return Outcome()
    titles = {
        ch.id: ch.title
        for ch in env.get("channels").list(T.ChannelFilter(ids=tuple(c.channel_id for c in cands)))
    }
    total = len({c.channel_id for c in cands})
    lines = [
        env.t(
            f"🧹 Faxina do mês: {total} canal(is) para revisar.",
            f"🧹 Monthly cleanup: {total} channel(s) to review.",
        )
    ]
    for group, (pt, en) in _GROUP_LABEL.items():
        names = [
            line(titles.get(c.channel_id, c.channel_id), 40) for c in cands if c.group is group
        ]
        if names:
            lines.append(f"- {env.t(pt, en)} ({len(names)}): {_names(names)}")
    lines.append(
        env.t(
            "Nada foi cancelado. Abra a Faxina na Home ou use /tube faxina para revisar e aprovar.",
            "Nothing was cancelled. Open Cleanup in the Home or use /tube cleanup to review.",
        )
    )
    return Outcome("\n".join(lines))


def pasta_novos(env: RoutineEnv) -> Outcome:
    """🗂️ 09:00: recently added channels still without a folder + a pointer to organize them (no AI
    here; nothing is applied)."""
    mark = env.mark()
    since = mark if mark is not None else env.now - FIRST_RUN_WINDOW_S
    active = (T.Relation.subscribed, T.Relation.followed)
    chans = env.get("channels").list(T.ChannelFilter(relations=active, folder_id=None))
    fresh = sorted((c for c in chans if c.added_at > since), key=lambda c: (c.added_at, c.title))
    if not fresh:
        return Outcome()
    names = _names([line(c.title, 40) for c in fresh], limit=8)
    lines = [
        env.t(
            f"🗂️ {len(fresh)} canal(is) novo(s) sem pasta: {names}.",
            f"🗂️ {len(fresh)} new channel(s) without a folder: {names}.",
        ),
        env.t(
            'Para organizar: Organizar na Home, ou peça ao Hermes "organize meus canais novos". '
            "Nada muda sem o seu aceite.",
            'To organize: Organize in the Home, or ask Hermes "organize my new channels". '
            "Nothing changes without your OK.",
        ),
    ]
    newest = max(c.added_at for c in fresh)
    return Outcome("\n".join(lines), marks={env.key: max(newest, since)})


COMPOSERS: dict[str, Composer] = {
    "bom-dia": bom_dia,
    "favoritos": favoritos,
    "resumo-pasta": resumo_pasta,
    "faxina-mensal": faxina_mensal,
    "pasta-novos": pasta_novos,
}
assert tuple(COMPOSERS) == T.ROUTINE_KEYS

__all__ = ["COMPOSERS", "fav_card", "line", "telegram_safe", "untrusted", "video_url"]
