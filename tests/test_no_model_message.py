"""One "no AI model" message everywhere the user (or the agent) can read it.

``core.ai.NO_MODEL_MESSAGE`` is the source; the cores, the Hermes adapter, the chat command, the
agent tool hint and the Desktop locales say the same thing (en, and the pt-BR equivalent).
"""

from __future__ import annotations

import json
from pathlib import Path

from fakes import FakeCtx

from tube_pkg import commands
from tube_pkg.adapters import hermes_llm
from tube_pkg.core import ai, organize, themes
from tube_pkg.core import types as T
from tube_pkg.tools import catalog

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "desktop-src" / "locales"

EN = "No AI model is available. Pick one and sign in under Settings → Models."
PT = "Nenhum modelo de IA disponível. Escolha um e entre na conta em Ajustes → Modelos."


class AuxiliaryClientUnavailable(RuntimeError):
    """Same class name the host raises when no provider is configured for the task."""


def _locale(lang: str, name: str) -> dict:
    return json.loads((LOCALES / lang / f"{name}.json").read_text(encoding="utf-8"))


def test_the_source_message_is_the_plain_one() -> None:
    assert ai.NO_MODEL_MESSAGE == EN


def test_cores_reuse_the_ai_message() -> None:
    assert organize.NO_MODEL_MESSAGE == ai.NO_MODEL_MESSAGE
    assert themes.NO_MODEL_MESSAGE == ai.NO_MODEL_MESSAGE


def test_hermes_adapter_no_provider_says_the_same() -> None:
    """With nothing configured; a configured model whose provider says "no provider" reads as
    "couldn't reach your model" instead (``test_ai_unreachable``)."""
    backend = hermes_llm.build(ctx=FakeCtx())
    backend.config_reader = lambda: {}
    err = backend._translate(AuxiliaryClientUnavailable("No LLM provider configured for task"))
    assert isinstance(err, T.LLMUnavailable)
    assert err.message == ai.NO_MODEL_MESSAGE


def test_chat_command_says_the_same_in_both_languages() -> None:
    assert commands._t("en", "theme_no_model") == ai.NO_MODEL_MESSAGE
    assert commands._t("pt", "theme_no_model") == PT


def test_agent_hint_starts_with_the_same_message() -> None:
    hint = catalog._hints()["llm_unavailable"]
    assert hint.startswith(ai.NO_MODEL_MESSAGE)
    assert "Ask the user" in hint


def test_desktop_common_locale_says_the_same() -> None:
    for lang, text in (("en", EN), ("pt-BR", PT)):
        common = _locale(lang, "common")
        assert common["no_model"] == text, lang
        assert common["errors"]["llm_unavailable"] == text, lang


def test_desktop_dialog_titles_and_texts_say_the_same() -> None:
    title = {"en": "No AI model is available", "pt-BR": "Nenhum modelo de IA disponível"}
    hint = {"en": "Pick one and sign in under Settings → Models", "pt-BR": PT.split(". ", 1)[1]}
    for lang in ("en", "pt-BR"):
        for name in ("organize", "theme"):
            data = _locale(lang, name)
            assert data["ai"]["no_model_title"] == title[lang], (lang, name)
            assert hint[lang].rstrip(".") in data["ai"]["no_model_desc"], (lang, name)
            assert hint[lang].rstrip(".") in data["no_model"]["desc"], (lang, name)
