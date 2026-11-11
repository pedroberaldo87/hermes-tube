"""Language sweep: everything the server writes for the person comes out in the resolved language.

With ``language: en`` no output of ``/tube`` (every subcommand, question, button), of the routine
installer, the routines, the blueprints and the tools contains a word from the Portuguese list
(built from the texts that existed before the language rule); with ``pt-BR``, the essentials do not
come out in English. Third-party data (titles, descriptions, channel/folder/tab names of the test
world, text between ``⟦ ⟧``) is stripped before searching.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import re
import types
from collections import deque
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeCtx, FakeLLM, FakeSettings, build_fake_world
from fakes import seed_world as _seed_world

from tube_pkg import commands, wiring
from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugin"

PT_WORDS = (
    "não nenhum nenhuma nada vídeo vídeos canal canais pasta pastas aba abas faxina triar "
    "triagem rotina rotinas instalar instalada instaladas cancelar remover removidas novos novo "
    "próximo extensão fila resumo ajuda assunto parar pular depois salvar agora você modelo "
    "horário entregar perfil inscrição inscrições buscas aprovado aprovados conectada "
    "desconectada sem para está já até mais outro outros uso erro descrição favorito favoritos "
    "tudo marcados parados ignorados manutenção cada quando só nunca dia mês arquivar visto "
    "confirmar varredura prévia tema exemplos sementes"
).split()

EN_WORDS = (
    "the nothing videos channels folder install cancel remove unsubscribe you your with without "
    "and new tabs help stop skip later save routines cleanup triage"
).split()

_UNTRUSTED = re.compile(r"⟦[^⟧]*⟧")
_MARKERS = ("<<<DADOS_DO_YOUTUBE", "DADOS_DO_YOUTUBE>>>")


class ChatCtx(FakeCtx):
    def session_surface(self) -> str:
        return "telegram"


class LocalCtx(FakeCtx):
    def session_surface(self) -> str:
        return "desktop"


class FakeCron:
    """Minimal ``cronjob_manage`` (list/create/remove) in the JSON format of the real tool."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}

    def __call__(self, args: dict[str, Any]) -> str:
        action = args.get("action")
        if action == "list":
            jobs = [{"job_id": k, **v} for k, v in self.jobs.items()]
            return json.dumps({"success": True, "jobs": jobs})
        if action == "create":
            jid = f"{len(self.jobs) + 1:012x}"
            self.jobs[jid] = {k: v for k, v in args.items() if k != "action"}
            return json.dumps({"success": True, "job_id": jid})
        if action == "remove":
            self.jobs.pop(str(args.get("job_id")), None)
            return json.dumps({"success": True})
        return json.dumps({"success": False, "error": "?"})


# =========================================================================== sweep


def data_strings(world: Any) -> list[str]:
    """Third-party/user texts in the test world (stripped before searching)."""
    out: list[str] = []
    for row in world.db.query("SELECT title, description, channel_title FROM videos"):
        out += [row["title"] or "", row["description"] or "", row["channel_title"] or ""]
    for row in world.db.query("SELECT title, handle FROM channels"):
        out += [row["title"] or "", row["handle"] or ""]
    out += [f.name for f in world.taxonomy.list_folders()]
    out += [t.name for t in world.taxonomy.list_tags()]
    out += [t.name for t in world.tabs.list() if not t.builtin]
    for row in world.db.query("SELECT query, name FROM themes"):
        out += [row["query"] or "", row["name"] or ""]
    out += list(T.ROUTINE_KEYS)  # identifiers (job name, argument of /tube rotinas)
    return sorted({s for s in out if s and len(s) > 2}, key=len, reverse=True)


def strip_data(text: str, data: Iterable[str]) -> str:
    text = _UNTRUSTED.sub(" ", text)
    for marker in _MARKERS:
        text = text.replace(marker, " ")
    for s in data:
        text = text.replace(s, " ")
    return text


def offending(text: str, words: Iterable[str], data: Iterable[str]) -> list[str]:
    clean = strip_data(text, data).casefold()
    return [w for w in words if re.search(rf"(?<![\w/-]){re.escape(w)}(?![\w-])", clean)]


def assert_lang(texts: Iterable[tuple[str, str]], lang: str, data: list[str]) -> None:
    words = PT_WORDS if lang == "en" else EN_WORDS
    bad = {}
    for where, text in texts:
        found = offending(text, words, data)
        if found:
            bad[where] = (found, text[:300])
    assert not bad, json.dumps(bad, ensure_ascii=False, indent=1)


# =========================================================================== fixtures


@pytest.fixture
def w(db: Any, clock: FakeClock, wire: Any) -> Any:
    world = build_fake_world(db, clock=clock, llm=FakeLLM(auto=True))
    world.seed = _seed_world(world)
    wire.use_world(world)
    return world


def _install_routines(wire: Any, tmp_path: Path, ctx: FakeCtx, lang: str) -> FakeCron:
    from tube_pkg._id import PLUGIN_ID
    from tube_pkg.routines import installer

    home = tmp_path / "profile"
    (home / "plugins").mkdir(parents=True, exist_ok=True)
    link = home / "plugins" / PLUGIN_ID
    if not link.exists():
        link.symlink_to(PLUGIN_DIR, target_is_directory=True)
    cron = FakeCron()
    ctx.tool_responses["cronjob_manage"] = cron
    inst = installer.build(settings=FakeSettings(language=lang), ctx=ctx, home=home)
    wire.set("routines", inst)
    return cron


def collect_ctx(ctx: FakeCtx) -> Iterator[tuple[str, str]]:
    for i, (question, choices) in enumerate(getattr(ctx, "asked", [])):
        yield f"q{i}", question
        for c in choices:
            yield f"q{i}.label", str(c.get("label") or c["value"])


def first_label(*prefixes: str) -> Any:
    def pick(q: str, choices: list) -> str:
        for c in choices:
            label = str(c.get("label") or "").casefold()
            if any(label.startswith(p) for p in prefixes):
                return str(c["value"])
        return str(choices[0]["value"])

    return pick


SCRIPTS: dict[str, tuple[str, ...]] = {
    "en": ("", "status", "tabs", "help", "nada-disso", "triage 0", "cleanup x", "theme"),
    "pt-BR": ("", "status", "abas", "ajuda", "nada-disso", "triar 0", "faxina x", "tema"),
}


def run_all_commands(w: Any, wire: Any, tmp_path: Path, lang: str) -> list[tuple[str, str]]:
    wire.set("settings", FakeSettings(language=lang))
    texts: list[tuple[str, str]] = []
    # without buttons (Desktop/CLI) and with buttons (Telegram), in both subcommand languages
    words = ["", "status", "abas", "tabs", "ajuda", "help", "nada-disso", "triar 0", "faxina x"]
    words += ["triar", "triage", "faxina", "cleanup", "tema IA", "theme AI", "tema", "rotinas"]
    words += ["routines", "rotinas remover", "routines remove", "rotinas xyz"]
    for word in words:
        for ctx in (LocalCtx(), ChatCtx()):
            _install_routines(wire, tmp_path, ctx, lang)
            if word.startswith(("triar", "triage")) and word not in ("triar 0",):
                ctx.script_choices(first_label("seen", "visto"), first_label("stop", "parar"))
            elif word in ("faxina", "cleanup"):
                ctx.script_choices(
                    first_label("unsubscribe", "cancelar estes"),
                    first_label("no,", "não,"),
                    first_label("stop", "parar"),
                )
            elif word.startswith(("tema", "theme")):
                ctx.script_choices(first_label("not now", "agora não"))
            elif word.startswith(("rotinas", "routines")):
                ctx.script_choices(first_label("cancel"))
            texts.append(
                (f"/tube {word} [{ctx.session_surface()}]", commands.handle(word, ctx=ctx))
            )
            texts += [(f"/tube {word} {k}", v) for k, v in collect_ctx(ctx)]
    # really install and then remove (success messages)
    word = "rotinas" if lang == "pt-BR" else "routines"
    ctx = ChatCtx()
    _install_routines(wire, tmp_path, ctx, lang)
    ctx.script_choices(first_label("install", "instalar"))
    texts.append((f"/tube {word} install", commands.handle(word, ctx=ctx)))
    ctx.choice_script = deque([first_label("remove", "remover")])
    texts.append((f"/tube {word} remove ok", commands.handle(f"{word} remove", ctx=ctx)))
    texts += [(f"install/remove {k}", v) for k, v in collect_ctx(ctx)]
    return texts


@pytest.mark.parametrize("lang", ["en", "pt-BR"])
def test_commands_and_installer_speak_one_language(
    w: Any, wire: Any, tmp_path: Path, lang: str
) -> None:
    texts = run_all_commands(w, wire, tmp_path, lang)
    assert len(texts) > 60
    assert_lang(texts, lang, data_strings(w))


def test_auto_without_information_is_english_everywhere_in_commands(
    w: Any, wire: Any, tmp_path: Path
) -> None:
    texts = run_all_commands(w, wire, tmp_path, "auto")
    # in auto the typed word is the surface hint: only the English/neutral ones count
    english = [
        (k, v)
        for k, v in texts
        if not any(f"/tube {p}" in k for p in ("abas", "ajuda", "triar", "faxina", "tema", "rot"))
    ]
    assert english
    assert_lang(english, "en", data_strings(w))


# =========================================================================== routines


def routine_outputs(w: Any, lang: str) -> list[tuple[str, str]]:
    from tube_pkg.core import lang as lang_rule
    from tube_pkg.routines.compose import COMPOSERS
    from tube_pkg.routines.runner import RoutineEnv

    graph = types.SimpleNamespace(get=lambda name: getattr(w, name))
    out: list[tuple[str, str]] = []
    for key, composer in COMPOSERS.items():
        env = RoutineEnv(
            key=key,
            home=Path("/nonexistent"),
            db=w.db,
            settings=FakeSettings(language=lang),
            graph=graph,
            now=int(w.clock.now()),
            lang=lang_rule.resolve(FakeSettings(language=lang)),
        )
        text = composer(env).text
        assert text, key  # the seeded world has something new for all of them
        out.append((key, text))
    return out


@pytest.mark.parametrize("lang", ["en", "pt-BR"])
def test_routine_messages_speak_one_language(w: Any, lang: str) -> None:
    assert_lang(routine_outputs(w, lang), lang, data_strings(w))


def test_digest_tells_the_model_which_language_to_use(w: Any) -> None:
    from tube_pkg.routines import catalog

    en = dict(routine_outputs(w, "en"))["resumo-pasta"]
    pt = dict(routine_outputs(w, "pt-BR"))["resumo-pasta"]
    assert en.splitlines()[0] == "Reply language: English"
    assert pt.splitlines()[0] == "Reply language: Brazilian Portuguese"
    assert "Reply language" in catalog.DIGEST_PROMPT
    assert "português" not in catalog.DIGEST_PROMPT.casefold()


# =========================================================================== blueprints


def _blueprint_texts(items: Iterable[dict[str, Any]]) -> list[tuple[str, str]]:
    out = []
    for bp in items:
        key = bp["key"]
        out += [(f"{key}.title", bp["title"]), (f"{key}.description", bp["description"])]
        out.append((f"{key}.prompt", bp["prompt_template"]))
        for slot in bp.get("slots", []):
            out.append((f"{key}.{slot['name']}.label", slot["label"]))
            out.append((f"{key}.{slot['name']}.help", slot.get("help", "")))
            out.append((f"{key}.{slot['name']}.default", str(slot.get("default", ""))))
    return out


@pytest.mark.parametrize("lang", ["en", "pt-BR"])
def test_blueprints_speak_one_language(lang: str) -> None:
    blueprints = importlib.import_module("tube_pkg.blueprints")
    items = blueprints.build(lang)
    assert [b["key"] for b in items] == [b["key"] for b in blueprints.build("en")]
    assert_lang(_blueprint_texts(items), lang, ["folder={folder}"])  # tool parameter


def test_blueprints_registered_follow_the_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    blueprints = importlib.import_module("tube_pkg.blueprints")
    from tube_pkg.core import lang as lang_rule

    monkeypatch.setattr(lang_rule, "resolve", lambda *a, **k: "pt-BR")
    assert blueprints.BLUEPRINTS == tuple(blueprints.build("pt-BR"))
    monkeypatch.setattr(lang_rule, "resolve", lambda *a, **k: "en")
    assert blueprints.BLUEPRINTS == tuple(blueprints.build("en"))
    assert blueprints.BLUEPRINTS[0]["title"].startswith("Daily summary")


def test_command_registration_hint_is_english() -> None:
    assert not offending(commands.ARGS_HINT, PT_WORDS + ["nova", "tema"], [])
    assert not offending(commands.DESCRIPTION, PT_WORDS, [])


# =========================================================================== tools


def _load_by_path(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_tool_texts_are_english(w: Any, wire: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """The tools talk to the model (always in English); the model replies in the language of the
    conversation. No Portuguese word in their fixed texts."""
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda **_: 47615)
    for var in ("HERMES_SESSION_PLATFORM", "HERMES_SESSION_SOURCE", "HERMES_PLATFORM"):
        monkeypatch.delenv(var, raising=False)
    wire.set("settings", FakeSettings(language="en"))
    fake = FakeCtx()
    _load_by_path("_tube_plugin_init_lang", PLUGIN_DIR / "__init__.py").register(fake)
    calls = [
        ("tube_status", {}),
        ("tube_feed", {}),
        ("tube_feed", {"folder": "nenhuma-pasta"}),
        ("tube_channels", {}),
        ("tube_channels", {"query": "zzz-sem-canal"}),
        ("tube_organize", {}),
        ("tube_cleanup_scan", {}),
        ("tube_tab", {"action": "create", "name": "Tab EN", "kind": "category"}),
        ("tube_mark", {"video_ids": ["zzzzzzzzzzz"], "state": "seen"}),
    ]
    texts = []
    for name, args in calls:
        out = fake.dispatch_tool(name, args)
        texts.append((name, out))
    catalog = importlib.import_module("tube_pkg.tools.catalog")
    for tool in catalog.TOOLS:
        texts.append((f"{tool.name}.description", tool.description))
        texts.append((f"{tool.name}.parameters", json.dumps(tool.parameters, ensure_ascii=False)))
    data = data_strings(w)
    bad = {
        k: offending(v, ["faxina", "triar", "rotinas", "nenhum", "você"], data) for k, v in texts
    }
    assert not {k: v for k, v in bad.items() if v}, bad
