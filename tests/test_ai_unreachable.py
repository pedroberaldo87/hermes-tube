"""A configured model whose provider cannot be reached (no sign-in, provider unavailable).

Three cases on every AI surface:

- **no model** (nothing configured): ``reason = no_model`` and the plain "pick one" text;
- **provider unreachable** (an auth error or "no provider" from ``ctx.llm`` while a route *is*
  configured): ``reason = provider_unavailable`` + ``provider``/``model``, a "sign in again or pick
  another model" text, and ``GET /ai/status`` says so for ``UNAVAILABLE_TTL_S`` (no network);
- **any other error** (network, invalid answer): the error that already existed.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fakes import FakeCtx, FakeLLMBackend, FakeSettings

from tube_pkg import commands
from tube_pkg.adapters import hermes_llm
from tube_pkg.core import ai
from tube_pkg.core import types as T
from tube_pkg.tools import catalog
from tube_pkg.wiring import CURATOR_TASK

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "desktop-src" / "locales"
CURATOR_DISPLAY_NAME = re.search(
    r'^CURATOR_DISPLAY_NAME = "([^"]+)"', (ROOT / "plugin" / "__init__.py").read_text("utf-8"), re.M
).group(1)  # type: ignore[union-attr]

PROVIDER = "claude-subscription-directsdk-experimental"
MODEL = "claude-sonnet-5-5"
MAIN_ROUTE = {"model": {"default": MODEL, "provider": PROVIDER}}

# The exact host error behind the field report: the Claude Code provider raises it (status 401)
# and the auxiliary ladder re-raises it after "all fallbacks exhausted".
LOGGED_OUT_HINT = (
    "Claude Code is installed but has no usable login in the environment Hermes runs it in. "
    "Run `claude auth login` as the user Hermes runs as, set CLAUDE_CODE_OAUTH_TOKEN (from "
    "`claude setup-token`) in Hermes' environment, or point the claude_config_dir plugin setting "
    "(or CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR) at a logged-in config directory, then try again."
)


class ClaudeCodeLoggedOut(RuntimeError):
    status_code = 401


class ClaudeCodeMissing(RuntimeError):
    status_code = 503


class AuxiliaryClientUnavailable(RuntimeError):
    pass


class AuthError(RuntimeError):
    """Shape of ``hermes_cli.auth_constants.AuthError``."""

    def __init__(self, message: str, *, provider: str = "", relogin_required: bool = False) -> None:
        super().__init__(message)
        self.provider = provider
        self.relogin_required = relogin_required


class AuthenticationError(Exception):
    """Shape of the OpenAI/Anthropic SDK 401."""

    status_code = 401


class APIConnectionError(Exception):
    pass


# Built from parts so the public scanner does not read them as a real path or key.
HOME_DIR = "/" + "Users/"
KEY_PREFIX = "sk" + "-ant"


def logged_out() -> ClaudeCodeLoggedOut:
    return ClaudeCodeLoggedOut(
        f"{LOGGED_OUT_HINT} (native: authentication_failed;"
        f" cli: {HOME_DIR}someone/.local/bin/claude;"
        f" login: none) stderr: token {KEY_PREFIX}-oat01-SECRETSECRETSECRET"
    )


def backend_for(config: dict[str, Any] | None = None, ctx: Any = None) -> Any:
    ctx = ctx or FakeCtx()
    cfg = MAIN_ROUTE if config is None else config
    return hermes_llm.HermesLLMBackend(ctx, config_reader=lambda: cfg)


def call(backend: Any) -> Any:
    return backend.complete_structured(
        instructions="x", input_text="y", json_schema={}, schema_name="s", timeout=5
    )


def organize_payload() -> dict[str, Any]:
    return {
        "items": [{"channel_id": "UC" + "a" * 22, "title": "Channel"}],
        "folders": ["Science"],
        "language": "en",
    }


def _locale(lang: str, name: str) -> dict[str, Any]:
    return json.loads((LOCALES / lang / f"{name}.json").read_text(encoding="utf-8"))


# ----------------------------------------------------------------------- adapter: known shapes


@pytest.mark.parametrize(
    "exc",
    [
        logged_out(),
        ClaudeCodeMissing("Claude Code is not installed (no `claude` on PATH)."),
        AuthError("Not logged into Nous Portal.", provider="nous", relogin_required=True),
        AuthenticationError("Error code: 401 - invalid x-api-key"),
        RuntimeError("Claude Code is installed but has no usable login in the environment"),
        AuxiliaryClientUnavailable("No LLM provider configured for task=x provider=auto."),
        AuxiliaryClientUnavailable(
            "Provider 'nous' is set in config.yaml but no credentials were found."
        ),
    ],
    ids=["claude-logged-out", "claude-missing", "auth-error", "sdk-401", "text", "aux", "aux-cred"],
)
def test_adapter_reads_auth_and_no_provider_as_provider_unavailable(exc: BaseException) -> None:
    ctx = FakeCtx()
    ctx.llm.script(exc)
    backend = backend_for(ctx=ctx)
    with pytest.raises(T.LLMUnavailable) as info:
        call(backend)
    err = info.value
    assert err.details.get("reason") == ai.PROVIDER_UNAVAILABLE
    assert err.details.get("provider") == PROVIDER
    assert err.details.get("model") == MODEL
    assert err.message == ai.provider_unavailable_message(PROVIDER, MODEL)
    assert err.message != ai.NO_MODEL_MESSAGE


def test_the_field_report_error_says_sign_in_again_and_leaks_nothing() -> None:
    ctx = FakeCtx()
    ctx.llm.script(logged_out())
    with pytest.raises(T.LLMUnavailable) as info:
        call(backend_for(ctx=ctx))
    err = info.value
    assert err.message == (
        f"Hermes couldn't reach your AI model ({PROVIDER} · {MODEL}). Sign in to it again, or "
        "pick another model for “YouTube curator” in Settings → Model → Auxiliary models."
    )
    shown = json.dumps({"message": err.message, "details": err.details}, ensure_ascii=False)
    for raw in (HOME_DIR, KEY_PREFIX, "SECRET", "claude auth login", "stderr", "no usable login"):
        assert raw not in shown, raw


@pytest.mark.parametrize(
    "exc",
    [
        RuntimeError("HTTP 500 from provider"),
        APIConnectionError("Connection error."),
        ConnectionResetError("reset by peer"),
        type("RateLimitError", (Exception,), {"status_code": 429})("slow down"),
        type("PermissionDeniedError", (Exception,), {"status_code": 403})("policy"),
    ],
    ids=["500", "connection", "reset", "429", "403"],
)
def test_adapter_other_errors_keep_their_own_message(exc: BaseException) -> None:
    ctx = FakeCtx()
    ctx.llm.script(exc)
    backend = backend_for(ctx=ctx)
    with pytest.raises(T.TubeError) as info:
        call(backend)
    assert info.value.details.get("reason") != ai.PROVIDER_UNAVAILABLE
    assert info.value.message.startswith("The AI provider failed")
    assert backend.unreachable() is None


def test_no_provider_without_a_configured_route_is_still_no_model() -> None:
    ctx = FakeCtx()
    ctx.llm.script(AuxiliaryClientUnavailable("No LLM provider configured for task"))
    backend = hermes_llm.HermesLLMBackend(ctx, config_reader=lambda: None)  # cannot tell
    with pytest.raises(T.LLMUnavailable) as info:
        call(backend)
    assert info.value.message == ai.NO_MODEL_MESSAGE
    assert info.value.details.get("reason") == ai.NO_MODEL


def test_pinned_task_provider_wins_over_the_main_one() -> None:
    cfg = {
        "model": {"default": "main-m", "provider": "main-p"},
        "auxiliary": {CURATOR_TASK: {"provider": "openrouter", "model": "aux-m"}},
    }
    ctx = FakeCtx()
    ctx.llm.script(AuthenticationError("401"))
    with pytest.raises(T.LLMUnavailable) as info:
        call(backend_for(cfg, ctx=ctx))
    assert info.value.details["provider"] == "openrouter"
    assert info.value.details["model"] == "aux-m"


def test_message_without_provider_or_model() -> None:
    assert ai.provider_unavailable_message(None, None) == (
        "Hermes couldn't reach your AI model. Sign in to it again, or pick another model for "
        "“YouTube curator” in Settings → Model → Auxiliary models."
    )
    assert "(m1)" in ai.provider_unavailable_message(None, "m1")
    assert "(p1)" in ai.provider_unavailable_message("p1", "")
    assert CURATOR_DISPLAY_NAME in ai.PROVIDER_UNAVAILABLE_MESSAGE


# ----------------------------------------------------------------------- status after a failure


def test_status_says_provider_unavailable_for_the_ttl_then_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = [1000.0]
    monkeypatch.setattr(hermes_llm.time, "monotonic", lambda: now[0])
    ctx = FakeCtx()
    ctx.llm.script(logged_out())
    backend = backend_for(ctx=ctx)
    llm = ai.build(settings=FakeSettings(), llm_backend=backend)
    assert ai.status_of(llm) == T.AiStatus(
        available=True, model=MODEL, reason=None, provider=PROVIDER
    )
    with pytest.raises(T.LLMUnavailable):
        llm.complete_structured(T.AiTask.organize, organize_payload())
    assert ai.status_of(llm) == T.AiStatus(
        available=False, model=MODEL, reason=ai.PROVIDER_UNAVAILABLE, provider=PROVIDER
    )
    assert len(ctx.llm.calls) == 1, "status never calls the provider"
    now[0] += hermes_llm.UNAVAILABLE_TTL_S + 1
    assert ai.status_of(llm).reason is None


def test_try_again_calls_the_provider_and_a_success_clears_the_warning() -> None:
    """Signing in again and pressing "Try again" must work at once: the warning does not block."""
    ctx = FakeCtx()
    item = organize_payload()["items"][0]
    answer = {
        "items": [
            {
                "channel_id": item["channel_id"],
                "folder": "Science",
                "new_folder": True,
                "tags": [],
                "confidence": 0.9,
                "why": "Science channel.",
            }
        ]
    }
    ctx.llm.script(logged_out(), answer)
    llm = ai.build(settings=FakeSettings(), llm_backend=backend_for(ctx=ctx))
    with pytest.raises(T.LLMUnavailable) as info:
        llm.complete_structured(T.AiTask.organize, organize_payload())
    assert info.value.details["reason"] == ai.PROVIDER_UNAVAILABLE
    assert llm.available() is True
    out = llm.complete_structured(T.AiTask.organize, organize_payload())
    assert out["items"][0]["folder"] == "Science"
    assert ai.status_of(llm).available is True


def test_plugin_host_without_ctx_reports_the_configured_provider() -> None:
    backend = hermes_llm.HermesLLMBackend(None, config_reader=lambda: MAIN_ROUTE)
    status = ai.status_of(ai.build(settings=FakeSettings(), llm_backend=backend))
    assert status == T.AiStatus(available=True, model=MODEL, reason=None, provider=PROVIDER)


def test_core_llm_no_model_error_is_structured() -> None:
    llm = ai.build(settings=FakeSettings(), llm_backend=FakeLLMBackend(available=False))
    with pytest.raises(T.LLMUnavailable) as info:
        llm.complete_structured(T.AiTask.organize, organize_payload())
    assert info.value.details.get("reason") == ai.NO_MODEL


def test_ai_status_json_has_the_provider() -> None:
    out = T.to_jsonable(T.AiStatus(available=False, model="m", reason="no_model", provider="p"))
    assert out == {"available": False, "model": "m", "reason": "no_model", "provider": "p"}


# ----------------------------------------------------------------------- chat (/tube, Telegram)


def _unreachable(provider: str | None = PROVIDER, model: str | None = MODEL) -> T.LLMUnavailable:
    return T.LLMUnavailable(
        ai.provider_unavailable_message(provider, model),
        reason=ai.PROVIDER_UNAVAILABLE,
        provider=provider,
        model=model,
    )


def test_chat_text_for_each_case_in_both_languages() -> None:
    en = commands.ai_unavailable_text("en", _unreachable())
    assert en == ai.provider_unavailable_message(PROVIDER, MODEL)
    pt = commands.ai_unavailable_text("pt", _unreachable())
    assert pt.startswith(f"O Hermes não conseguiu acessar seu modelo de IA ({PROVIDER} · {MODEL}).")
    assert "Settings → Model → Auxiliary models" in pt
    assert commands.ai_unavailable_text("pt", _unreachable(None, None)).startswith(
        "O Hermes não conseguiu acessar seu modelo de IA. "
    )
    plain = T.LLMUnavailable(ai.NO_MODEL_MESSAGE, reason=ai.NO_MODEL)
    assert commands.ai_unavailable_text("en", plain) == ai.NO_MODEL_MESSAGE
    assert commands.ai_unavailable_text("pt", T.LLMUnavailable("x")) == commands._t(
        "pt", "theme_no_model"
    )


def test_chat_topic_command_uses_the_provider_text(monkeypatch: pytest.MonkeyPatch) -> None:
    class Themes:
        def create(self, *args: Any, **kwargs: Any) -> Any:
            raise _unreachable()

    monkeypatch.setattr(commands, "_wiring", lambda: SimpleNamespace(get_themes=Themes))
    for lang in ("en", "pt"):
        call_ = SimpleNamespace(
            lang=lang, human=True, ctx=None, t=lambda k, _l=lang, **kw: commands._t(_l, k, **kw)
        )
        assert commands._theme(call_, "astrophysics") == commands.ai_unavailable_text(
            lang, _unreachable()
        )


# ----------------------------------------------------------------------- agent tools


def test_tool_error_carries_reason_provider_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(args: Any, call_: Any) -> Any:
        raise _unreachable()

    monkeypatch.setitem(catalog._impl.RUNNERS, "tube_status", boom)
    data = json.loads(catalog._run("tube_status", {}, {}))
    err = data["error"]
    assert err["code"] == "llm_unavailable"
    assert err["reason"] == ai.PROVIDER_UNAVAILABLE
    assert err["provider"] == PROVIDER and err["model"] == MODEL
    assert "sign in" in err["hint"].lower() and ai.NO_MODEL_MESSAGE not in err["hint"]


def test_tool_no_model_error_keeps_the_pick_one_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(args: Any, call_: Any) -> Any:
        raise T.LLMUnavailable(ai.NO_MODEL_MESSAGE, reason=ai.NO_MODEL)

    monkeypatch.setitem(catalog._impl.RUNNERS, "tube_status", boom)
    err = json.loads(catalog._run("tube_status", {}, {}))["error"]
    assert err["hint"].startswith(ai.NO_MODEL_MESSAGE)
    assert err.get("reason") == ai.NO_MODEL


# ----------------------------------------------------------------------- Desktop locales


def test_desktop_common_provider_text_matches_the_backend() -> None:
    common = _locale("en", "common")
    route = f"{PROVIDER} · {MODEL}"
    assert common["provider_unavailable"].replace("{route}", route) == (
        ai.provider_unavailable_message(PROVIDER, MODEL)
    )
    assert common["provider_unavailable_plain"] == ai.provider_unavailable_message(None, None)
    pt = _locale("pt-BR", "common")
    assert pt["provider_unavailable"].replace("{route}", route) == commands.ai_unavailable_text(
        "pt", _unreachable()
    )
    assert pt["provider_unavailable_plain"] == commands.ai_unavailable_text(
        "pt", _unreachable(None, None)
    )


@pytest.mark.parametrize("name", ["organize", "theme", "cleanup"])
def test_desktop_locales_have_the_provider_keys_in_both_languages(name: str) -> None:
    def ai_keys(data: Any, prefix: str = "") -> set[str]:
        out: set[str] = set()
        for key, value in data.items():
            path = f"{prefix}{key}"
            if isinstance(value, dict):
                out |= ai_keys(value, path + ".")
            elif "provider" in path:
                out.add(path)
        return out

    en, pt = ai_keys(_locale("en", name)), ai_keys(_locale("pt-BR", name))
    assert en, name
    assert en == pt, name
