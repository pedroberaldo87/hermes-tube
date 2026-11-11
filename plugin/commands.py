"""The ``/tube`` command.

``register(ctx)`` (``__init__.py``) registers ``NAME`` with ``handle(raw_args, ctx=ctx)``: a
**synchronous** handler, so it can use ``ctx.ask_choice``. Thin shell over the ``wiring`` services.

Rules (measured in a spike):

- **Buttons only on a messaging platform** (Telegram etc.). Local session (Desktop/TUI/CLI), cron,
  no session or a ``ctx`` without ``ask_choice`` → a text answer pointing to the Home; nothing is
  approved and no long call runs (the Desktop cuts off at 30 s and re-runs the command).
- **Direct chats only.** On a messaging platform, a group, channel, forum or thread (or a run
  where Hermes passed no ``source``) gets one line pointing to a direct chat with the bot (plus
  the help for ``help``): no question, no subscriptions, no routine, nothing approved.
- A loop of at most ``MAX_LOOP`` questions per command; numbered options, no ``description``;
  question and answer in plain text, ≤ ``MAX_CHARS`` characters.
- ``None`` (timeout, cancelled, free text, "Other", no human) = **stop without acting**. An
  exception while asking = ``None``. Each decision is saved right away (``/stop`` does not stop
  the loop and swallows the summary).
- ``faxina``: two steps per group; only the confirmation choice (a new, unpredictable value per
  question) calls ``Cleanup.approve(ids, ApprovedVia.ask_choice)``. Hermes maps a typed number
  or label to its choice, so typing the confirmation's number or label approves too; that is why
  the confirmation never sits where "Unsubscribe these N" was in the first step (a repeated "2"
  stops) and the two labels differ (no typed text passes both steps). ``None``, free text, a
  value that is merely similar and an exception never approve.
- Everything inside ``try/except`` returning text (an exception in the handler becomes "unknown
  command").
- Language: the single ``core/lang`` rule — an explicit ``language`` setting wins; with ``auto``,
  the language of the typed subcommand (``triar``/``triage``…), then the profile's Hermes
  language, else English.
"""

from __future__ import annotations

import logging
import re
import secrets
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from tube_pkg.core import types as T
from tube_pkg.core.ai import (
    NO_MODEL_MESSAGE,
    PROVIDER_UNAVAILABLE,
    PROVIDER_UNAVAILABLE_MESSAGE,
    provider_route,
)

logger = logging.getLogger(__name__)

NAME = "tube"
DESCRIPTION = "YouTube subscriptions: summary, triage, cleanup, topic tabs and routines"
ARGS_HINT = "[triage [n]|cleanup [new]|topic <subject>|tabs|status|routines [remove]|help]"
"""Registration hint (fixed, in English); the Portuguese aliases keep working."""
SUBCOMMANDS = ("triar", "faxina", "tema", "abas", "status", "rotinas", "ajuda")

MAX_LOOP = 10
"""Cap on questions (``ask_choice``) per command run."""
MAX_CHARS = 500
"""Character cap of each answer and each question (Telegram card)."""
MAX_THEME_CHARS = 200

NON_MESSAGING_SURFACES = frozenset(
    {
        "",
        "acp",
        "api_server",
        "cli",
        "codex",
        "cron",
        "desktop",
        "gateway",
        "kanban",
        "local",
        "msgraph_webhook",
        "tool",
        "tui",
        "webhook",
    }
)
"""Surfaces without a human in a messaging chat (mirrors Hermes'
``NON_MESSAGING_SESSION_SURFACES`` + ``acp``/``cron``). Anything else = messaging platform
(deny by default, like Hermes)."""

DIRECT_CHAT_TYPES = frozenset({"dm", "direct", "private"})
"""``source.chat_type`` values of a direct chat with the bot (Hermes' adapters normalize a
private chat to ``dm``). In a group, channel, forum or thread any admitted member may answer a
button, so on a messaging surface ``/tube`` only works here; any other value — including an
empty one or no ``source`` at all — counts as shared (fail closed)."""

_UNSET: Any = object()
"""Default of ``handle(source=...)``: the caller did not say (direct calls inside the plugin and
tests). The registered command always passes what Hermes sent, ``None`` included."""

CLEANUP_ORDER = (
    T.CleanupGroup.stale,
    T.CleanupGroup.ignored,
    T.CleanupGroup.off_profile,
    T.CleanupGroup.manual,
)

_ALIASES: dict[str, tuple[str, str | None]] = {
    "triar": ("triar", "pt"),
    "triagem": ("triar", "pt"),
    "triage": ("triar", "en"),
    "faxina": ("faxina", "pt"),
    "limpar": ("faxina", "pt"),
    "cleanup": ("faxina", "en"),
    "tema": ("tema", "pt"),
    "theme": ("tema", "en"),
    "topic": ("tema", "en"),
    "assunto": ("tema", "pt"),
    "abas": ("abas", "pt"),
    "tabs": ("abas", "en"),
    "status": ("status", None),
    "rotinas": ("rotinas", "pt"),
    "routines": ("rotinas", "en"),
    "ajuda": ("ajuda", "pt"),
    "help": ("ajuda", "en"),
    "?": ("ajuda", None),
}

# --------------------------------------------------------------------------- texts

_TEXT: dict[str, dict[str, str]] = {
    "pt": {
        "help": (
            "/tube — resumo\n"
            "/tube triar [n] — até 10 vídeos novos com botões\n"
            "/tube faxina [nova] — canais para cancelar, por grupo\n"
            "/tube assunto <assunto> — monta uma aba sobre um assunto\n"
            "/tube abas · status · rotinas · ajuda\n"
            "Para parar um laço, escolha parar (o /stop não para)."
        ),
        "short_help": "Mais: /tube triar · faxina · assunto <assunto> · ajuda",
        "shared_chat": (
            "O /tube só funciona em conversa direta com o bot: aqui qualquer membro veria suas"
            " inscrições e poderia responder aos botões."
        ),
        "unknown": "Subcomando desconhecido: {sub}",
        "home": "Abra a Home do plugin no Hermes Desktop.",
        "error": "/tube: erro — {err}",
        "internal": "erro interno (detalhes no log do Hermes)",
        "unavailable": "/tube {sub}: ainda não disponível nesta versão.",
        "new_total": "Novos: {n}",
        "no_tabs": "nenhuma aba",
        "favs": "⭐ com novidade: {items}",
        "no_favs": "⭐ sem novidade",
        "ext_on": "Extensão: conectada ({n} navegador(es))",
        "ext_idle": "Extensão: nenhum navegador conectado agora",
        "ext_off": "Extensão: desconectada (abra a Home para religar)",
        "rss_down": "RSS do YouTube fora do ar há {ago}; mostrando o que já tem.",
        "next": "Próximo: {title} — {channel}",
        "last_rss": "Última leitura RSS: {ago}",
        "never": "nunca",
        "refreshing": "atualizando agora",
        "queue": "Fila de cancelamento: {n} aprovado(s)",
        "search": "Buscas esperando a extensão: {n}",
        "tabs_title": "Abas (novos):",
        "triage_usage": "Uso: /tube triar [n] — n de 1 a 10 (inválido: {arg}).",
        "nothing_new": "Nada novo para triar.",
        "triage_text": "Vídeos novos para triar:",
        "triage_local": "Aqui não dá para usar botões. Trie na Home (Desktop) ou no Telegram.",
        "nothing_changed": "Nada foi alterado.",
        "no_answer_first": "Sem resposta (tempo esgotado, cancelado ou fora dos botões).",
        "ask_failed": "Não deu para perguntar: {err}",
        "triage_summary": "Triagem: {done}/{total}",
        "stopped_at": "Você parou no vídeo {i}/{total}.",
        "no_answer_at": "Sem resposta no vídeo {i}/{total}: nada feito com ele.",
        "write_failed": "Erro ao gravar o vídeo {i}/{total}: {err}",
        "capped": "(máximo 10 por vez)",
        "remaining": "Ainda há novos: /tube triar",
        "c_seen": "visto",
        "c_later": "depois",
        "c_archive": "arquivar",
        "c_up": "👍",
        "c_stop": "parar",
        "c_skip": "pular",
        "c_back": "não, pular",
        "c_review": "Cancelar estes {n}",
        "c_confirm": "Confirmar ({n})",
        "c_save": "salvar",
        "c_later_save": "agora não",
        "g_stale": "Parados",
        "g_ignored": "Ignorados",
        "g_off_profile": "Fora do perfil",
        "g_manual": "Propostos por você",
        "cleanup_usage": "Uso: /tube faxina [nova] (recebi: {arg}). Nada foi aprovado.",
        "cleanup_scanning": "Varrendo as inscrições… (até 1 min e meio)",
        "cleanup_none": "Nenhuma varredura de faxina ainda.",
        "cleanup_empty": (
            "Nada para faxinar na última varredura. Para varrer de novo: /tube faxina nova"
        ),
        "cleanup_list": "Faxina: {n} canal(is) na última varredura:",
        "cleanup_local": (
            "Aprove na página Faxina da Home (Desktop) ou com /tube faxina no Telegram."
        ),
        "cleanup_q1": "Faxina · {group} · {n} canal(is)",
        "cleanup_q1_tail": "Cancelar a inscrição destes?",
        "cleanup_q2": (
            "Confirmar o cancelamento de {n} canal(is) ({group})? A extensão executa depois, um"
            " por vez; até lá dá para desfazer na Home."
        ),
        "more": "+{n} outro(s)",
        "more_next": "(+{n} na próxima pergunta)",
        "cleanup_summary": "Faxina: {n} canal(is) aprovado(s) para cancelar (a extensão executa).",
        "cleanup_none_approved": "Faxina: nada aprovado.",
        "cleanup_skipped": "Grupos pulados: {n}",
        "cleanup_stopped": "Você parou a faxina.",
        "cleanup_no_answer": "Sem resposta: parei sem aprovar nada mais.",
        "cleanup_failed": "Aprovação não feita: {err}",
        "cleanup_cap": "Limite de perguntas atingido; continue com /tube faxina.",
        "theme_usage": "Uso: /tube assunto <assunto> (até 200 caracteres).",
        "theme_local": (
            "Montar uma aba por assunto leva até 1 min e meio; aqui não dá. Use Nova aba por"
            " assunto na Home (Desktop) ou peça ao agente: monta uma aba sobre {query}."
        ),
        "theme_wait": 'Montando uma aba sobre "{query}"… (até 1 min e meio)',
        "theme_head": "{icon}{name}: {videos} vídeos · {channels} canais",
        "theme_seeds": "Canais-semente: {names}",
        "theme_note": "Nota: {note}",
        "theme_top": "Exemplos:",
        "theme_ask": "Salvar como aba?",
        "theme_empty": (
            'Nenhum vídeo encontrado para "{query}" (0 na prévia). Tente outro assunto.'
        ),
        "theme_saved": "Aba criada: {name}. Veja na Home ou com /tube abas.",
        "theme_kept": "Prévia guardada, não salva. Salve depois na Home (Nova aba por assunto).",
        "theme_save_failed": "Não salvei: {err}",
        "theme_no_model": (
            "Nenhum modelo de IA disponível. Escolha um e entre na conta em Ajustes → Modelos."
        ),
        # the Desktop has no pt-BR interface: its labels are quoted as the person sees them
        "ai_unreachable": (
            "O Hermes não conseguiu acessar seu modelo de IA ({route}). Entre na conta de novo ou "
            "escolha outro modelo para “YouTube curator” em Settings → Model → Auxiliary models."
        ),
        "ai_unreachable_plain": (
            "O Hermes não conseguiu acessar seu modelo de IA. Entre na conta de novo ou escolha "
            "outro modelo para “YouTube curator” em Settings → Model → Auxiliary models."
        ),
        "theme_busy": "Já há uma aba por assunto em andamento; espere ela terminar.",
        "theme_timeout": "A aba demorou demais e foi interrompida; tente de novo.",
        "routines_usage": "Rotinas desconhecidas: {keys}. Válidas: {valid}.",
        "routines_local": "Instale pelo Telegram (/tube rotinas) ou pela Home. Rotinas:",
        "routines_installed": "instalada",
        "routines_missing": "não instalada",
        "routines_cancelled": "Nada instalado.",
        "routines_done": "Instaladas: {installed}. Já existiam: {skipped}.",
        "routines_model": (
            "{keys} usa o modelo principal; para um mais barato: "
            "hermes cron edit <id> --model <modelo>"
        ),
        "routines_remove_hint": "Para desligar: /tube rotinas remover",
        "routines_none": "Nenhuma rotina instalada.",
        "routines_removed": "Removidas: {keys}.",
        "routines_remove_cancelled": "Nada removido.",
        "routines_remove_local": (
            "Aqui não dá para confirmar com botão; nada foi removido. Instaladas: {keys}.\n"
            "Para desligar: hermes cron list (jobs {prefix}-…) e hermes cron remove <id> para"
            " cada um; os scripts {prefix}-*.py em scripts/ do perfil podem ser apagados."
            " Ou use /tube rotinas remover no Telegram."
        ),
    },
    "en": {
        "help": (
            "Subcommands:\n"
            "/tube — summary\n"
            "/tube triage [n] — up to 10 new videos with buttons\n"
            "/tube cleanup [new] — channels to unsubscribe, by group\n"
            "/tube topic <subject> — builds a tab about a topic\n"
            "/tube tabs · status · routines · help\n"
            "To stop a loop, pick stop (/stop does not stop it)."
        ),
        "short_help": "More: /tube triage · cleanup · topic <subject> · help",
        "shared_chat": (
            "/tube only works in a direct chat with the bot: here any member would see your"
            " subscriptions and could answer its buttons."
        ),
        "unknown": "Unknown subcommand: {sub}",
        "home": "Open the plugin Home in Hermes Desktop.",
        "error": "/tube: error — {err}",
        "internal": "internal error (details in the Hermes log)",
        "unavailable": "/tube {sub}: not available in this version yet.",
        "new_total": "New: {n}",
        "no_tabs": "no tabs",
        "favs": "⭐ with news: {items}",
        "no_favs": "⭐ nothing new",
        "ext_on": "Extension: connected ({n} browser(s))",
        "ext_idle": "Extension: no browser connected right now",
        "ext_off": "Extension: disconnected (open the Home to reconnect)",
        "rss_down": "YouTube RSS down for {ago}; showing what is already here.",
        "next": "Next: {title} — {channel}",
        "last_rss": "Last RSS read: {ago}",
        "never": "never",
        "refreshing": "refreshing now",
        "queue": "Unsubscribe queue: {n} approved",
        "search": "Searches waiting for the extension: {n}",
        "tabs_title": "Tabs (new):",
        "triage_usage": "Usage: /tube triage [n] — n from 1 to 10 (invalid: {arg}).",
        "nothing_new": "Nothing new to triage.",
        "triage_text": "New videos to triage:",
        "triage_local": (
            "Buttons are not available here. Triage in the Home (Desktop) or on Telegram."
        ),
        "nothing_changed": "Nothing was changed.",
        "no_answer_first": "No answer (timed out, cancelled or not a button).",
        "ask_failed": "Could not ask: {err}",
        "triage_summary": "Triage: {done}/{total}",
        "stopped_at": "You stopped at video {i}/{total}.",
        "no_answer_at": "No answer at video {i}/{total}: left untouched.",
        "write_failed": "Error saving video {i}/{total}: {err}",
        "capped": "(10 at most)",
        "remaining": "More new videos: /tube triage",
        "c_seen": "seen",
        "c_later": "later",
        "c_archive": "archive",
        "c_up": "👍",
        "c_stop": "stop",
        "c_skip": "skip",
        "c_back": "no, skip",
        "c_review": "Unsubscribe these {n}",
        "c_confirm": "Confirm ({n})",
        "c_save": "save",
        "c_later_save": "not now",
        "g_stale": "Inactive",
        "g_ignored": "Ignored",
        "g_off_profile": "Off profile",
        "g_manual": "Proposed by you",
        "cleanup_usage": "Usage: /tube cleanup [new] (got: {arg}). Nothing was approved.",
        "cleanup_scanning": "Scanning subscriptions… (up to 1.5 min)",
        "cleanup_none": "No cleanup scan yet.",
        "cleanup_empty": "Nothing to clean up in the last scan. To scan again: /tube cleanup new",
        "cleanup_list": "Cleanup: {n} channel(s) in the last scan:",
        "cleanup_local": (
            "Approve in the Cleanup page of the Home (Desktop) or with /tube cleanup on Telegram."
        ),
        "cleanup_q1": "Cleanup · {group} · {n} channel(s)",
        "cleanup_q1_tail": "Unsubscribe from these?",
        "cleanup_q2": (
            "Confirm unsubscribing from {n} channel(s) ({group})? The extension runs it later, one"
            " at a time; until then you can undo it in the Home."
        ),
        "more": "+{n} more",
        "more_next": "(+{n} in the next question)",
        "cleanup_summary": (
            "Cleanup: {n} channel(s) approved to unsubscribe (the extension runs it)."
        ),
        "cleanup_none_approved": "Cleanup: nothing approved.",
        "cleanup_skipped": "Groups skipped: {n}",
        "cleanup_stopped": "You stopped the cleanup.",
        "cleanup_no_answer": "No answer: stopped without approving anything else.",
        "cleanup_failed": "Not approved: {err}",
        "cleanup_cap": "Question limit reached; continue with /tube cleanup.",
        "theme_usage": "Usage: /tube topic <subject> (up to 200 characters).",
        "theme_local": (
            "Building a topic tab takes up to 1.5 min; not here. Use New topic tab in the Home"
            " (Desktop) or ask the agent: build a tab about {query}."
        ),
        "theme_wait": 'Building a tab about "{query}"… (up to 1.5 min)',
        "theme_head": "{icon}{name}: {videos} videos · {channels} channels",
        "theme_seeds": "Seed channels: {names}",
        "theme_note": "Note: {note}",
        "theme_top": "Examples:",
        "theme_ask": "Save as a tab?",
        "theme_empty": 'No videos found for "{query}" (0 in the preview). Try another topic.',
        "theme_saved": "Tab created: {name}. See it in the Home or with /tube tabs.",
        "theme_kept": "Preview kept, not saved. Save it later in the Home (New topic tab).",
        "theme_save_failed": "Not saved: {err}",
        "theme_no_model": NO_MODEL_MESSAGE,
        "ai_unreachable": PROVIDER_UNAVAILABLE_MESSAGE.replace("{route}", " ({route})"),
        "ai_unreachable_plain": PROVIDER_UNAVAILABLE_MESSAGE.replace("{route}", ""),
        "theme_busy": "A topic tab is already being built; wait for it to finish.",
        "theme_timeout": "The topic tab took too long and was interrupted; try again.",
        "routines_usage": "Unknown routines: {keys}. Valid: {valid}.",
        "routines_local": "Install from Telegram (/tube routines) or from the Home. Routines:",
        "routines_installed": "installed",
        "routines_missing": "not installed",
        "routines_cancelled": "Nothing installed.",
        "routines_done": "Installed: {installed}. Already there: {skipped}.",
        "routines_model": (
            "{keys} uses the main model; for a cheaper one: hermes cron edit <id> --model <model>"
        ),
        "routines_remove_hint": "To turn them off: /tube routines remove",
        "routines_none": "No routines installed.",
        "routines_removed": "Removed: {keys}.",
        "routines_remove_cancelled": "Nothing removed.",
        "routines_remove_local": (
            "No buttons here to confirm; nothing was removed. Installed: {keys}.\n"
            "To turn them off: hermes cron list (jobs {prefix}-…) and hermes cron remove <id>"
            " for each; the {prefix}-*.py scripts in the profile scripts/ folder can be deleted."
            " Or use /tube routines remove on Telegram."
        ),
    },
}


def _t(lang: str, key: str, **kw: Any) -> str:
    table = _TEXT.get(lang) or _TEXT["en"]
    text = table.get(key) or _TEXT["en"][key]
    return text.format(**kw) if kw else text


# --------------------------------------------------------------------------- utilities


_LINK_JOIN = re.compile(r"\]\s*(?=[(\[:])")
"""``](``, ``][`` and ``]:`` — inline link, reference link and link definition."""
_WORD_START_UNDERSCORE = re.compile(r"(?<!\w)_+(?=\S)")
_HTML_TAG_START = re.compile(r"<(?=[A-Za-z/!?])")
_LINE_START_MARK = re.compile(r"^(?:#{1,6}|>{1,3})\s+")


def _plain(text: str) -> str:
    """*text* (already on one line) with no Markdown that could change how the answer renders.

    Titles, channel names and reasons come from YouTube or the model and land in a chat that
    renders Markdown (Telegram, the Desktop): ``[Claim](https://evil.example)`` must stay text,
    never a link whose target is hidden. Ordinary titles (``[4K] …``, ``(2024)``, ``snake_case``,
    ``3 < 4``) keep their characters."""
    s = text.replace("**", "").replace("```", "").replace("`", "'")
    s = _LINK_JOIN.sub("] ", s)  # "[x](url)" -> "[x] (url)": plain text everywhere
    s = s.replace("*", "\u2217")  # same look; no emphasis can open or close
    s = _WORD_START_UNDERSCORE.sub("", s)  # "_x_" would be italics in CommonMark
    s = re.sub(r"~{2,}", "~", s)
    s = re.sub(r"\|{2,}", "|", s)  # spoiler
    s = _HTML_TAG_START.sub("\u2039", s)  # "<a href=…>" -> "‹a href=…>"
    return _LINE_START_MARK.sub("", s)


def _one_line(text: Any, limit: int = 120) -> str:
    """Text on a single line, without markup (``_plain``), clipped at *limit*. Every piece of
    text from YouTube, the model or the database goes through here before it reaches an answer."""
    s = _plain(" ".join(str(text or "").split()))
    return s if len(s) <= limit else s[: max(1, limit - 1)].rstrip() + "…"


def _icon(icon: Any) -> str:
    """A tab or theme icon (user or model text) followed by a space, or ``""``."""
    s = _one_line(icon, 16)
    return f"{s} " if s else ""


def _clip(text: str, limit: int = MAX_CHARS) -> str:
    """Clip at *limit* characters, preferring a line end."""
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    nl = cut.rfind("\n")
    if nl >= limit // 2:
        cut = cut[:nl]
    return cut.rstrip() + "…"


def _ago(seconds: float, lang: str) -> str:
    s = max(0, int(seconds))
    if s < 3600:
        return f"{max(1, s // 60)} min"
    if s < 2 * 86400:
        return f"{s // 3600} h"
    return f"{s // 86400} {'days' if lang == 'en' else 'dias'}"


def ai_unavailable_text(lang: str, exc: T.LLMUnavailable) -> str:
    """Chat text for an ``LLMUnavailable``: a configured provider that cannot be reached
    (``details["reason"] == provider_unavailable``, with the route when known) or "no model"."""
    details = exc.details if isinstance(exc.details, Mapping) else {}
    if details.get("reason") != PROVIDER_UNAVAILABLE:
        return _t(lang, "theme_no_model")
    # same route text as the backend message (one line, cut, no file paths)
    route = provider_route(details.get("provider"), details.get("model"))
    return _t(lang, "ai_unreachable", route=route) if route else _t(lang, "ai_unreachable_plain")


def _err(exc: BaseException, lang: str) -> str:
    """What the chat may see of *exc*: a ``TubeError``'s own message; for anything else (paths,
    SQL, provider text) a generic text — every caller logs the exception itself."""
    if isinstance(exc, T.LLMUnavailable) and isinstance(exc.details, Mapping):
        if exc.details.get("reason") == PROVIDER_UNAVAILABLE:
            return ai_unavailable_text(lang, exc)
    if isinstance(exc, T.TubeError):
        return _one_line(getattr(exc, "message", "") or getattr(exc, "code", "error"), 200)
    return _t(lang, "internal")


def _wiring() -> Any:
    from tube_pkg import wiring

    return wiring


def _now() -> int:
    try:
        return int(_wiring().get_clock().now())
    except Exception:  # noqa: BLE001
        import time

        return int(time.time())


def _resolve_lang(hint: str | None) -> str:
    """``"pt"``/``"en"`` by the single rule (``core/lang``): an explicit setting wins; with
    ``auto``, the language of the typed subcommand; then the profile's Hermes language; else
    English."""
    from tube_pkg.core import lang

    try:
        settings = _wiring().get_settings()
    except Exception:  # noqa: BLE001
        settings = None
    return lang.short(lang.resolve(settings, hint))


def _surface(ctx: Any, platform: Any) -> str:
    if platform:
        return str(getattr(platform, "value", platform)).strip().lower()
    fn = getattr(ctx, "session_surface", None)
    if not callable(fn):
        return ""
    try:
        return str(fn() or "").strip().lower()
    except Exception:  # noqa: BLE001
        return ""


def _is_stub(obj: Any) -> bool:
    return bool(getattr(obj, "__contract_stub__", None))


def _exact(picked: Any, expected: str) -> bool:
    """Only the exact button value: a plain, equal ``str``, without normalization."""
    return type(picked) is str and picked == expected


@dataclass
class _Asker:
    """``ctx.ask_choice`` with a ``MAX_LOOP`` cap, the question clipped at ``MAX_CHARS`` and an
    exception treated as ``None``. Without ``ctx``/a messaging platform, it never asks."""

    ctx: Any
    enabled: bool
    count: int = 0
    error: str | None = None
    capped: bool = False
    lang: str = "en"

    def __call__(self, question: str, choices: Sequence[Mapping[str, Any]]) -> str | None:
        if not self.enabled:
            return None
        if self.count >= MAX_LOOP:
            self.capped = True
            return None
        self.count += 1
        options = [
            {"value": str(c["value"]), "label": str(c.get("label") or c["value"])} for c in choices
        ]
        try:
            picked = self.ctx.ask_choice(_clip(question), options)
        except Exception as exc:  # noqa: BLE001 — a surface failure = no answer
            logger.warning("/tube: ask_choice failed: %s", exc)
            self.error = _err(exc, self.lang)
            return None
        return picked if type(picked) is str else None


@dataclass
class _Call:
    ctx: Any
    lang: str
    surface: str
    ask: _Asker
    args: list[str] = field(default_factory=list)

    @property
    def human(self) -> bool:
        return self.ask.enabled

    def t(self, key: str, **kw: Any) -> str:
        return _t(self.lang, key, **kw)


# --------------------------------------------------------------------------- entry point


def _shared_chat(surface: str, source: Any) -> bool:
    """Whether this run happens where other people can read the answer and press its buttons.

    Local surfaces never are. On a messaging surface only a ``source`` whose ``chat_type`` is in
    ``DIRECT_CHAT_TYPES`` is private; ``source=None`` (the host did not say) is shared."""
    if surface in NON_MESSAGING_SURFACES or source is _UNSET:
        return False
    if source is None:
        return True
    chat_type = str(getattr(source, "chat_type", "") or "").strip().lower()
    return chat_type not in DIRECT_CHAT_TYPES


def handle(
    raw_args: str = "",
    *,
    ctx: Any = None,
    platform: str | None = None,
    source: Any = _UNSET,
    **_: Any,
) -> str:
    """Run ``/tube <raw_args>`` and return the answer text (never raises).

    *platform* (optional) is the ``platform`` Hermes passes to handlers that declare it; without
    it, ``ctx.session_surface()`` is used. *source* is the chat Hermes passes (its ``chat_type``
    tells a direct chat from a group): in a shared chat ``/tube`` asks nothing, shows none of the
    user's data and only answers with the help and a pointer to a direct chat."""
    parts = (raw_args or "").split()
    word = parts[0].lower() if parts else ""
    sub, hint = _ALIASES.get(word, (word, None))
    lang = _resolve_lang(hint)
    surface = _surface(ctx, platform)
    if _shared_chat(surface, source):
        shared = _t(lang, "shared_chat")
        return _clip(_t(lang, "help") + "\n" + shared if sub == "ajuda" else shared)
    can_ask = (
        ctx is not None
        and callable(getattr(ctx, "ask_choice", None))
        and surface not in NON_MESSAGING_SURFACES
    )
    call = _Call(
        ctx=ctx, lang=lang, surface=surface, ask=_Asker(ctx, can_ask, lang=lang), args=parts[1:]
    )
    try:
        if not sub:
            out = _summary(call)
        elif sub == "triar":
            out = _triage(call)
        elif sub == "faxina":
            out = _cleanup(call)
        elif sub == "tema":
            out = _theme(call, " ".join(parts[1:]))
        elif sub == "abas":
            out = _tabs(call)
        elif sub == "status":
            out = _status(call)
        elif sub == "rotinas":
            out = _routines(call)
        elif sub == "ajuda":
            out = call.t("help")
        else:
            out = call.t("unknown", sub=_one_line(word, 40)) + "\n" + call.t("help")
    except NotImplementedError:
        out = call.t("unavailable", sub=sub or "")
    except Exception as exc:  # noqa: BLE001 — an exception would become "unknown command"
        logger.exception("/tube %s failed", sub)
        out = call.t("error", err=_err(exc, lang))
    return _clip(out)


# --------------------------------------------------------------------------- summary / status


def _ext_line(call: _Call, snap: T.StatusSnapshot) -> str:
    if snap.devices_online > 0:
        return call.t("ext_on", n=snap.devices_online)
    if snap.ext_endpoint_up:
        return call.t("ext_idle")
    return call.t("ext_off")


def _tab_name(tab_id: str, name: str, lang: str) -> str:
    from tube_pkg.core import lang as lang_rule

    return lang_rule.tab_name(tab_id, name, lang)


def _tab_counts(snap: T.StatusSnapshot, lang: str, limit: int = 6) -> str:
    items = [
        f"{_icon(c.icon)}{_one_line(_tab_name(c.tab_id, c.name, lang), 30)} {c.count}"
        for c in snap.new_by_tab
        if c.count
    ]
    more = len(items) - limit
    text = " · ".join(items[:limit])
    return text + (f" · +{more}" if more > 0 else "")


def _next_video(call: _Call) -> T.FeedItem | None:
    items = _new_items(1)
    return items[0] if items else None


def _summary(call: _Call) -> str:
    wiring = _wiring()
    refresher = wiring.get_refresher()
    try:
        refresher.kick_if_due()
    except Exception:  # noqa: BLE001 — refreshing is a courtesy; the summary shows what there is
        logger.debug("/tube: kick_if_due failed", exc_info=True)
    snap = refresher.status()
    lines = [call.t("new_total", n=snap.new_total)]
    counts = _tab_counts(snap, call.lang)
    if counts:
        lines[0] += f" — {counts}"
    if snap.fav_new:
        favs = ", ".join(f"{_one_line(f.title, 30)} ({f.count})" for f in snap.fav_new[:5])
        lines.append(call.t("favs", items=favs))
    else:
        lines.append(call.t("no_favs"))
    lines.append(_ext_line(call, snap))
    if snap.rss_down_since:
        lines.append(call.t("rss_down", ago=_ago(_now() - snap.rss_down_since, call.lang)))
    try:
        item = _next_video(call)
    except Exception:  # noqa: BLE001
        item = None
    if item is not None:
        lines.append(
            call.t(
                "next",
                title=_one_line(item.video.title, 90),
                channel=_one_line(_channel_title(item), 40),
            )
        )
    lines.append(call.t("short_help"))
    return "\n".join(lines)


def _status(call: _Call) -> str:
    snap = _wiring().get_refresher().status()
    lines = [call.t("new_total", n=snap.new_total)]
    counts = _tab_counts(snap, call.lang, limit=8)
    if counts:
        lines.append(counts)
    if snap.refresh_running:
        last = call.t("refreshing")
    elif snap.last_rss_at:
        last = _ago(_now() - snap.last_rss_at, call.lang)
    else:
        last = call.t("never")
    lines.append(call.t("last_rss", ago=last))
    if snap.rss_down_since:
        lines.append(call.t("rss_down", ago=_ago(_now() - snap.rss_down_since, call.lang)))
    lines.append(_ext_line(call, snap))
    lines.append(call.t("queue", n=snap.queue_pending))
    if snap.search_pending:
        lines.append(call.t("search", n=snap.search_pending))
    return "\n".join(lines)


def _tabs(call: _Call) -> str:
    wiring = _wiring()
    tabs = wiring.get_tabs().list()
    by_tab: Mapping[str, int] = {}
    try:
        by_tab = wiring.get_feed().new_counts().by_tab
    except Exception:  # noqa: BLE001
        logger.debug("/tube abas: new_counts failed", exc_info=True)
    if not tabs:
        return call.t("tabs_title") + " " + call.t("no_tabs")
    lines = [call.t("tabs_title")]
    for tab in tabs[:15]:
        name = _tab_name(tab.id, tab.name, call.lang)
        lines.append(f"{_icon(tab.icon)}{_one_line(name, 40)}: {by_tab.get(tab.id, 0)}")
    if len(tabs) > 15:
        lines.append(_t(call.lang, "more", n=len(tabs) - 15))
    return "\n".join(lines)


# --------------------------------------------------------------------------- triage (triar)


def _new_items(limit: int) -> list[T.FeedItem]:
    page = _wiring().get_feed().page(T.BUILTIN_TAB_ALL_NEW, limit=limit)
    return [i for i in page.items if i.state is T.VideoState.new][:limit]


def _channel_title(item: T.FeedItem) -> str:
    return (item.channel.title if item.channel else None) or item.video.channel_title or "?"


def _video_question(i: int, total: int, item: T.FeedItem) -> str:
    return (
        f"{i}/{total} · {_one_line(_channel_title(item), 60)}\n"
        f"{_one_line(item.video.title, 200)}\n{item.video.url}"
    )


def _video_listing(call: _Call, items: Sequence[T.FeedItem], head: str, tail: str) -> str:
    lines = [head]
    budget = MAX_CHARS - len(head) - len(tail) - 10
    for n, item in enumerate(items, start=1):
        line = (
            f"{n}. {_one_line(item.video.title, 80)} — {_one_line(_channel_title(item), 30)}"
            f"\n{item.video.url}"
        )
        if len(line) + 1 > budget:
            break
        budget -= len(line) + 1
        lines.append(line)
    lines.append(tail)
    return "\n".join(lines)


def _parse_count(call: _Call) -> tuple[int | None, bool, str | None]:
    """``(n, capped, error)`` of ``triar [n]``."""
    if not call.args:
        return MAX_LOOP, False, None
    arg = " ".join(call.args)
    if len(call.args) != 1 or not call.args[0].isdigit():
        return None, False, arg
    n = int(call.args[0])
    if n < 1:
        return None, False, arg
    return min(n, MAX_LOOP), n > MAX_LOOP, None


def _triage(call: _Call) -> str:
    n, capped, bad = _parse_count(call)
    if n is None:
        return call.t("triage_usage", arg=_one_line(bad, 30))
    items = _new_items(n)
    if not items:
        return call.t("nothing_new")
    if not call.human:
        tail = call.t("triage_local") + " " + call.t("nothing_changed")
        return _video_listing(call, items[:3], call.t("triage_text"), tail)
    choices = [
        {"value": "seen", "label": call.t("c_seen")},
        {"value": "later", "label": call.t("c_later")},
        {"value": "archive", "label": call.t("c_archive")},
        {"value": "up", "label": call.t("c_up")},
        {"value": "stop", "label": call.t("c_stop")},
    ]
    total = len(items)
    done = 0
    counts: dict[str, int] = {}
    tail = ""
    video_state = _wiring().get_video_state()
    for i, item in enumerate(items, start=1):
        picked = call.ask(_video_question(i, total, item), choices)
        if picked == "stop":
            tail = call.t("stopped_at", i=i, total=total)
            break
        if picked not in ("seen", "later", "archive", "up"):
            if done == 0:
                head = (
                    call.t("ask_failed", err=call.ask.error)
                    if call.ask.error
                    else call.t("no_answer_first")
                )
                tail = call.t("nothing_changed") + " " + call.t("home")
                return _video_listing(call, items[:3], head, tail)
            tail = call.t("no_answer_at", i=i, total=total)
            break
        try:
            vid = item.video.id
            if picked == "up":
                video_state.set_reaction(vid, T.Reaction.up, actor=T.Actor.user)
                video_state.set_state([vid], T.VideoState.seen, actor=T.Actor.user)
            else:
                state = {
                    "seen": T.VideoState.seen,
                    "later": T.VideoState.later,
                    "archive": T.VideoState.archived,
                }[picked]
                video_state.set_state([vid], state, actor=T.Actor.user)
        except Exception as exc:  # noqa: BLE001 — saved right away; an error ends the loop
            logger.warning("/tube triar: failed to save %s: %s", item.video.id, exc)
            tail = call.t("write_failed", i=i, total=total, err=_err(exc, call.lang))
            break
        done += 1
        counts[picked] = counts.get(picked, 0) + 1
    label = {c["value"]: c["label"] for c in choices}
    parts = [call.t("triage_summary", done=done, total=total)]
    parts += [f"{label[k]} {v}" for k, v in counts.items()]
    lines = [" · ".join(parts)]
    if capped:
        lines[0] += " " + call.t("capped")
    if tail:
        lines.append(tail)
    elif done == total:
        try:
            if _new_items(1):
                lines.append(call.t("remaining"))
        except Exception:  # noqa: BLE001
            pass
    return "\n".join(lines)


# --------------------------------------------------------------------------- cleanup (faxina)


def _group_label(call: _Call, group: T.CleanupGroup) -> str:
    return call.t(f"g_{group.value}")


def _cleanup_groups(scan: T.CleanupScan) -> list[tuple[T.CleanupGroup, list[T.CleanupCandidate]]]:
    by = scan.by_group()
    out = []
    for group in (*CLEANUP_ORDER, *[g for g in by if g not in CLEANUP_ORDER]):
        cands = list(by.get(group, ()))
        seen: set[str] = set()
        unique = [c for c in cands if not (c.channel_id in seen or seen.add(c.channel_id))]
        if unique:
            out.append((group, unique))
    return out


def _titles(ids: Sequence[str]) -> dict[str, str]:
    channels = _wiring().get_channels()
    out = {}
    for cid in ids:
        try:
            ch = channels.get(cid)
        except Exception:  # noqa: BLE001
            ch = None
        out[cid] = ch.title if ch is not None else cid
    return out


def _candidate_lines(
    call: _Call,
    cands: Sequence[T.CleanupCandidate],
    titles: Mapping[str, str],
    budget: int,
    more_key: str = "more",
) -> tuple[list[str], int]:
    """Lines "- channel: reason" that fit in *budget* and **how many channels were shown by name**.
    Whoever approves only approves what they read: the caller limits approval to those first *n*."""
    lines: list[str] = []
    shown = 0
    for k, cand in enumerate(cands):
        why = _one_line(cand.why, 90)
        line = f"- {_one_line(titles.get(cand.channel_id, cand.channel_id), 40)}" + (
            f": {why}" if why else ""
        )
        rest = len(cands) - k - 1
        reserve = len(call.t(more_key, n=rest)) + 1 if rest else 0
        if len(line) + 1 + reserve > budget:
            lines.append(call.t(more_key, n=len(cands) - k))
            break
        budget -= len(line) + 1
        lines.append(line)
        shown += 1
    return lines, shown


def _cleanup(call: _Call) -> str:
    force = False
    if call.args:
        if [a.lower() for a in call.args] in (["nova"], ["new"]):
            force = True
        else:
            return call.t("cleanup_usage", arg=_one_line(" ".join(call.args), 40))
    cleanup = _wiring().get_cleanup()
    if not call.human:
        return _cleanup_text(call, cleanup.latest_scan())
    scan = None if force else cleanup.latest_scan()
    if scan is None:
        _post(call, call.t("cleanup_scanning"))
        scan = cleanup.scan(timeout=T.TOOL_TIMEOUT_S)
    groups = _cleanup_groups(scan)
    if not groups:
        return call.t("cleanup_empty")
    titles = _titles([c.channel_id for _, cands in groups for c in cands])
    approved: list[str] = []
    skipped = 0
    tail = ""
    # A big group does not fit in one question: it goes in pages. Each confirmation approves **only
    # the channels whose name appeared in that question** — never "+35 more" that nobody read.
    pending = [(group, list(cands)) for group, cands in groups]
    while pending:
        group, cands = pending.pop(0)
        label = _group_label(call, group)
        ask_tail = call.t("cleanup_q1_tail")
        widest = call.t("cleanup_q1", group=label, n=len(cands))
        body, shown = _candidate_lines(
            call, cands, titles, MAX_CHARS - len(widest) - len(ask_tail) - 4, "more_next"
        )
        if shown == 0:  # nothing readable to show: nothing to approve
            skipped += 1
            continue
        rest = cands[shown:]
        ids = [c.channel_id for c in cands[:shown]]
        head = call.t("cleanup_q1", group=label, n=len(ids))
        step1 = [
            {"value": "skip", "label": call.t("c_skip")},
            {"value": "review", "label": call.t("c_review", n=len(ids))},
            {"value": "stop", "label": call.t("c_stop")},
        ]
        picked = call.ask("\n".join([head, *body, ask_tail]), step1)
        if picked == "skip":
            skipped += 1
            continue
        if picked != "review":
            tail = _cleanup_end(call, picked)
            break
        token = "approve-" + secrets.token_hex(8)  # new for every question: nobody can guess it
        # "Unsubscribe these N" was option 2: here 2 is "stop", so a repeated "2" never approves
        step2 = [
            {"value": "back", "label": call.t("c_back")},
            {"value": "stop", "label": call.t("c_stop")},
            {"value": token, "label": call.t("c_confirm", n=len(ids))},
        ]
        picked = call.ask(call.t("cleanup_q2", n=len(ids), group=label), step2)
        if not _exact(picked, token):
            if picked == "back":
                skipped += 1
                continue
            tail = _cleanup_end(call, picked)
            break
        try:
            items = cleanup.approve(ids, T.ApprovedVia.ask_choice)
        except T.TubeError as exc:
            tail = call.t("cleanup_failed", err=_err(exc, call.lang))
            break
        approved += [it.channel_id for it in items]
        if rest:  # next page of the same group (skip/back drops the whole group)
            pending.insert(0, (group, rest))
    lines = [
        call.t("cleanup_summary", n=len(dict.fromkeys(approved)))
        if approved
        else call.t("cleanup_none_approved")
    ]
    if skipped:
        lines.append(call.t("cleanup_skipped", n=skipped))
    if tail:
        lines.append(tail)
    return "\n".join(lines)


def _cleanup_end(call: _Call, picked: str | None) -> str:
    if picked == "stop":
        return call.t("cleanup_stopped")
    if call.ask.capped:
        return call.t("cleanup_cap")
    if call.ask.error:
        return call.t("ask_failed", err=call.ask.error)
    return call.t("cleanup_no_answer")


def _cleanup_text(call: _Call, scan: T.CleanupScan | None) -> str:
    """No human/local: the last scan as text + the approval path (never approves)."""
    tail = call.t("cleanup_local")
    if scan is None:
        return call.t("cleanup_none") + "\n" + tail
    groups = _cleanup_groups(scan)
    if not groups:
        return call.t("cleanup_empty") + "\n" + tail
    total = sum(len(c) for _, c in groups)
    lines = [call.t("cleanup_list", n=total)]
    titles = _titles([c.channel_id for _, cands in groups for c in cands][:30])
    budget = MAX_CHARS - len(lines[0]) - len(tail) - 10
    for group, cands in groups:
        names = ", ".join(_one_line(titles.get(c.channel_id, c.channel_id), 30) for c in cands[:4])
        more = f" {call.t('more', n=len(cands) - 4)}" if len(cands) > 4 else ""
        line = f"{_group_label(call, group)} ({len(cands)}): {names}{more}"
        line = _one_line(line, max(40, budget - 1))
        if len(line) + 1 > budget:
            break
        budget -= len(line) + 1
        lines.append(line)
    lines.append(tail)
    return "\n".join(lines)


def _post(call: _Call, text: str) -> None:
    """Notice before a long call (``ctx.post_message``; never raises)."""
    fn = getattr(call.ctx, "post_message", None)
    if not callable(fn):
        return
    try:
        fn(_clip(text))
    except Exception:  # noqa: BLE001
        logger.debug("/tube: post_message failed", exc_info=True)


# --------------------------------------------------------------------------- theme (tema)


def _theme_preview_text(call: _Call, prev: T.ThemePreview) -> str:
    theme = prev.theme
    lines = [
        call.t(
            "theme_head",
            icon=_icon(theme.icon),
            name=_one_line(theme.name or theme.query, 60),
            videos=prev.video_count,
            channels=prev.channel_count,
        )
    ]
    if prev.seeds:
        names = ", ".join(_one_line(s.title, 30) for s in prev.seeds[:3])
        lines.append(call.t("theme_seeds", names=names))
    if theme.status is T.ThemeStatus.preview and theme.error:
        lines.append(call.t("theme_note", note=_one_line(theme.error, 150)))
    tops = [prev.videos.get(it.video_id) for it in prev.items[:3]]
    tops = [v for v in tops if v is not None]
    if tops:
        lines.append(call.t("theme_top"))
        lines += [f"- {_one_line(v.title, 70)}" for v in tops]
    return "\n".join(lines)


def _theme(call: _Call, query: str) -> str:
    query = " ".join(query.split())
    if not query or len(query) > MAX_THEME_CHARS:
        return call.t("theme_usage")
    if not call.human:
        return call.t("theme_local", query=_one_line(query, 80))
    themes = _wiring().get_themes()
    _post(call, call.t("theme_wait", query=_one_line(query, 80)))
    try:
        prev = themes.create(query, origin=T.Actor.user, timeout=T.TOOL_TIMEOUT_S)
    except T.LLMUnavailable as exc:
        return ai_unavailable_text(call.lang, exc)
    except T.Busy:
        return call.t("theme_busy")
    except T.OperationTimeout:
        return call.t("theme_timeout")
    except T.TubeError as exc:
        return call.t("error", err=_err(exc, call.lang))
    preview = _theme_preview_text(call, prev)
    if prev.video_count == 0:
        note = ""
        if prev.theme.error:
            note = "\n" + call.t("theme_note", note=_one_line(prev.theme.error, 150))
        return call.t("theme_empty", query=_one_line(query, 80)) + note
    ask_line = call.t("theme_ask")
    question = _clip(preview, MAX_CHARS - len(ask_line) - 1) + "\n" + ask_line
    choices = [
        {"value": "later", "label": call.t("c_later_save")},
        {"value": "save", "label": call.t("c_save")},
    ]
    picked = call.ask(question, choices)
    if picked != "save":
        return _clip(preview, MAX_CHARS - 120) + "\n" + call.t("theme_kept")
    try:
        saved = themes.save(prev.theme.id, actor=T.Actor.user)
    except T.TubeError as exc:
        return call.t("theme_save_failed", err=_err(exc, call.lang))
    return call.t("theme_saved", name=_one_line(saved.tab.name, 60))


# --------------------------------------------------------------------------- routines (rotinas)


_REMOVE_WORDS = frozenset({"remover", "remove"})


def _with_lang(fn: Callable[..., Any], lang: str) -> Callable[..., Any]:
    """*fn* with ``lang=`` (the language of this answer) if it accepts it; the ``Protocol`` lacks
    the argument, so another implementation (fake, stub) is called as before."""
    import functools
    import inspect

    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return fn
    if "lang" in params or any(p.kind is p.VAR_KEYWORD for p in params.values()):
        return functools.partial(fn, lang="pt-BR" if lang == "pt" else "en")
    return fn


def _routine_label(info: T.RoutineInfo, lang: str) -> str:
    """``title, schedule`` of the routine in the language (catalog); else the cron expression."""
    from tube_pkg.routines.catalog import BY_KEY

    spec = BY_KEY.get(info.key)
    if spec is None:
        return info.schedule
    title, when, _ = spec.text("pt-BR" if lang == "pt" else "en")
    return f"{title}, {when}"


def _routines(call: _Call) -> str:
    args = [a.lower() for a in call.args]
    removing = bool(args) and args[0] in _REMOVE_WORDS
    keys = (args[1:] if removing else args) or None
    if keys:
        unknown = [k for k in keys if k not in T.ROUTINE_KEYS]
        if unknown:
            return call.t(
                "routines_usage",
                keys=", ".join(_one_line(k, 20) for k in unknown),
                valid=", ".join(T.ROUTINE_KEYS),
            )
    installer = _wiring().get_routines()
    if _is_stub(installer):
        raise NotImplementedError("RoutinesInstaller")
    if removing:
        return _routines_remove(call, installer, keys)
    if not call.human:
        lines = [call.t("routines_local")]
        for info in _with_lang(installer.list, call.lang)():
            state = call.t("routines_installed" if info.installed else "routines_missing")
            lines.append(f"- {info.key} ({_routine_label(info, call.lang)}): {state}")
        lines.append(call.t("routines_remove_hint"))
        return "\n".join(lines)
    confirm: Callable[[str, list[Any]], str | None] = call.ask
    report = _with_lang(installer.install, call.lang)(confirm=confirm, keys=keys)
    if report.cancelled:
        return call.t("routines_cancelled")
    lines = [
        call.t(
            "routines_done",
            installed=", ".join(report.installed) or "-",
            skipped=", ".join(report.skipped) or "-",
        )
    ]
    if report.message:
        lines.append(_one_line(report.message, 150))
    agents = [k for k in report.installed if _is_agent_routine(k)]
    if agents:
        # our own text, not passed through _one_line: "<id>" must stay ASCII
        lines.append(call.t("routines_model", keys=", ".join(agents)))
    return "\n".join(lines)


def _is_agent_routine(key: str) -> bool:
    from tube_pkg.routines.catalog import BY_KEY

    spec = BY_KEY.get(key)
    return spec is not None and spec.kind is T.RoutineKind.agent


@dataclass
class _ConfirmOnce:
    """*confirm* for ``RoutinesInstaller.remove``: at most **one** question per command, and only
    an offered value, raw and exact (plain ``str``), reaches the installer; anything else becomes
    ``None``. A defense in ``/tube`` on top of the installer's ``_exact``."""

    ask: _Asker
    asked: bool = False

    def __call__(self, question: str, choices: Sequence[Mapping[str, Any]]) -> str | None:
        if self.asked:
            return None
        self.asked = True
        offered = [str(c["value"]) for c in choices]
        picked = self.ask(question, choices)
        return picked if type(picked) is str and picked in offered else None


def _installed_keys(installer: Any, keys: Sequence[str] | None) -> list[str]:
    return [i.key for i in installer.list() if i.installed and (keys is None or i.key in keys)]


def _routines_remove(call: _Call, installer: Any, keys: list[str] | None) -> str:
    """``/tube rotinas remover [keys…]``: one question through ``RoutinesInstaller.remove`` (which
    does not ask if nothing is installed); only the exact value removes. No buttons → text with
    the ``hermes cron`` path, nothing removed."""
    remove = getattr(installer, "remove", None)
    if not callable(remove):
        raise NotImplementedError("RoutinesInstaller.remove")
    if not call.human:
        present = _installed_keys(installer, keys)
        if not present:
            return call.t("routines_none")
        from tube_pkg._id import PLUGIN_ID

        return call.t("routines_remove_local", keys=", ".join(present), prefix=PLUGIN_ID)
    confirm = _ConfirmOnce(call.ask)
    report: T.InstallReport = _with_lang(remove, call.lang)(confirm=confirm, keys=keys)
    note = _one_line(report.message, 150) if report.message else ""
    if report.installed:
        lines = [call.t("routines_removed", keys=", ".join(report.installed))]
    elif not confirm.asked and not report.cancelled:
        # did not ask: nothing installed (or installer without profile/cron: the message says so)
        if not _installed_keys(installer, keys) or not note:
            return call.t("routines_none")
        return note
    else:
        lines = [call.t("routines_remove_cancelled")]
        if call.ask.error:
            lines.append(call.t("ask_failed", err=call.ask.error))
        if report.cancelled:
            note = ""
    if note:
        lines.append(note)
    return "\n".join(lines)


__all__ = [
    "ARGS_HINT",
    "CLEANUP_ORDER",
    "DESCRIPTION",
    "MAX_CHARS",
    "MAX_LOOP",
    "NAME",
    "NON_MESSAGING_SURFACES",
    "SUBCOMMANDS",
    "handle",
]
