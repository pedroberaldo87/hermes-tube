"""The ``/tube`` command (``plugin/commands.py``).

Fakes from ``tests/fakes`` wired through ``wiring`` (``wire`` fixture). Three kinds of ``ctx``:

- ``ChatCtx``: ``FakeCtx`` on a messaging platform (``session_surface() == "telegram"``);
  ``ask_choice`` scripted like Hermes's (text → value; outside the list → ``None``);
- ``RawCtx``: returns **raw** whatever the script sends (simulates a surface that returns text
  resembling the button value) — proves that only the exact click value approves;
- plain ``FakeCtx`` (``session_surface() == "cli"``) and local surfaces: never asks.

Invariants covered: only the exact click on the confirmation button calls ``Cleanup.approve`` (with
``ApprovedVia.ask_choice``); ``None``/timeout/free text/exception = nothing approved; a cap of 10
questions per loop; a local session neither asks nor approves; answers ≤ 500 characters, plain text.
"""

from __future__ import annotations

import dataclasses
import importlib
import importlib.util
from collections import deque
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeClock, FakeCtx, FakeLLM, FakeSettings, build_fake_world
from fakes import seed_world as _seed_world

from tube_pkg import commands, wiring
from tube_pkg.core import types as T

DAY = 86_400
MAX_CHARS = 500


# --------------------------------------------------------------------------- fake ctx


class ChatCtx(FakeCtx):
    """``FakeCtx`` numa plataforma de mensagem (Telegram)."""

    surface = "telegram"

    def session_surface(self) -> str:
        return self.surface


class RawCtx(ChatCtx):
    """``ask_choice`` that returns the scripted answer **without** matching it to the options."""

    def ask_choice(self, question: str, choices: list) -> str | None:
        self.asked.append((question, list(choices)))
        if not self.choice_script:
            return None
        answer = self.choice_script.popleft()
        if callable(answer):
            answer = answer(question, list(choices))
        if isinstance(answer, BaseException):
            raise answer
        return answer


class BoomCtx(ChatCtx):
    """``ask_choice`` that raises (surface failure)."""

    def ask_choice(self, question: str, choices: list) -> str | None:
        self.asked.append((question, list(choices)))
        raise RuntimeError("clarify quebrou")


class LocalCtx(FakeCtx):
    def __init__(self, surface: str = "desktop", **kw: Any) -> None:
        super().__init__(**kw)
        self.surface = surface

    def session_surface(self) -> str:
        return self.surface


class Liar(str):
    """Forged text that claims to equal anything."""

    def __eq__(self, other: object) -> bool:
        return True

    def __ne__(self, other: object) -> bool:
        return False

    __hash__ = str.__hash__


def value_of(choices: list, *prefixes: str) -> str:
    """Value of the option whose label starts with one of the *prefixes* (casefold)."""
    for choice in choices:
        label = str(choice.get("label") or choice["value"]).casefold()
        if any(label.startswith(p.casefold()) for p in prefixes):
            return str(choice["value"])
    raise AssertionError(f"option {prefixes} not in {choices}")


def confirm(q: str, choices: list) -> str:
    return value_of(choices, "confirmar", "confirm")


def review(q: str, choices: list) -> str:
    return value_of(choices, "cancelar estes", "unsubscribe these")


def labels(choices: list) -> list[str]:
    return [str(c.get("label") or c["value"]) for c in choices]


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def w(db: Any, clock: FakeClock, wire: Any) -> Any:
    world = build_fake_world(db, clock=clock, llm=FakeLLM(auto=True))
    world.seed = _seed_world(world)
    wire.use_world(world)
    return world


@pytest.fixture
def chat() -> ChatCtx:
    return ChatCtx()


def run(ctx: Any, args: str = "", **kw: Any) -> str:
    out = commands.handle(args, ctx=ctx, **kw)
    assert isinstance(out, str) and out.strip()
    assert len(out) <= MAX_CHARS, (len(out), out)
    assert "**" not in out and "```" not in out and "<b>" not in out
    for question, choices in getattr(ctx, "asked", []):
        assert len(question) <= MAX_CHARS, (len(question), question)
        assert "**" not in question
        assert len(choices) <= 10
        for choice in choices:
            assert (
                isinstance(choice, dict) and "description" not in choice
            )  # choices carry no description
            assert choice["value"] and choice.get("label")
    return out


def queue_rows(world: Any) -> list[dict[str, Any]]:
    return world.db.query("SELECT * FROM unsub_queue")


def states(world: Any, ids: list[str]) -> dict[str, T.VideoStateRow]:
    return world.video_state.get(ids)


def new_ids(world: Any) -> list[str]:
    page = world.feed.page(T.BUILTIN_TAB_ALL_NEW, limit=50)
    return [i.video.id for i in page.items]


def add_new_videos(world: Any, n: int, *, title: str | None = None) -> list[str]:
    cid = world.seed.channels["fireship"]
    now = world.clock.now()
    ids = [f"i06new{k:05d}" for k in range(n)]
    world.video_store.upsert(
        [
            T.VideoIn(
                id=vid,
                channel_id=cid,
                title=title or f"Vídeo extra {k}",
                published_at=now - 3600 - k * 60,
                channel_title="Fireship",
            )
            for k, vid in enumerate(ids)
        ],
        T.VideoOrigin.rss,
    )
    return ids


def stale_scan(world: Any) -> T.CleanupScan:
    """Cleanup with 2 groups: ``stale`` (Nerdologia, by rule) + ``manual`` (2 channels)."""
    world.cleanup.propose(
        [world.seed.channels["mkbhd"], world.seed.channels["veritasium"]], reason="Proposto."
    )
    scan = world.cleanup.scan()
    groups = scan.by_group()
    assert T.CleanupGroup.stale in groups and T.CleanupGroup.manual in groups
    return scan


# =========================================================================== registration and shape


def test_module_is_real_and_keeps_the_stub_surface() -> None:
    assert not getattr(commands, "__contract_stub__", None)
    assert commands.NAME == "tube"
    assert set(commands.SUBCOMMANDS) >= {
        "triar",
        "faxina",
        "tema",
        "abas",
        "status",
        "rotinas",
        "ajuda",
    }
    assert commands.MAX_LOOP == 10


def test_registered_through_the_plugin(w: Any) -> None:
    """The real ``register`` in ``__init__.py`` binds ``/tube`` to ``handle`` (no ``platform``)."""
    spec = importlib.util.spec_from_file_location(
        "_tube_plugin_init_i06", Path(__file__).resolve().parents[1] / "plugin" / "__init__.py"
    )
    assert spec is not None and spec.loader is not None
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    ctx = ChatCtx().script_choices("parar")
    plugin.register(ctx)
    handler = ctx.commands["tube"]["handler"]
    try:
        out = handler("ajuda")
        assert "triar" in out and len(out) <= MAX_CHARS
        handler("triar", source=src("dm"))
        assert len(ctx.asked) == 1  # platform from the ctx's ``session_surface``
        # no source on a messaging surface: treated as a shared chat, nothing asked
        handler("triar")
        assert len(ctx.asked) == 1
    finally:
        for cb in ctx.unload_callbacks:
            cb()


def test_ctx_none_and_no_ask_choice_answer_in_text(w: Any) -> None:
    out = run(None, "triar")
    assert "Home" in out
    bare = type("Bare", (), {"session_surface": lambda self: "telegram"})()
    out = run(bare, "faxina")
    assert queue_rows(w) == []


# =========================================================================== summary, status, tabs


def test_summary_without_args(w: Any) -> None:
    ctx = ChatCtx()
    out = run(ctx)
    assert ctx.asked == []  # the summary never asks
    snap = w.refresher.status()
    assert str(snap.new_total) in out
    assert "Fireship" in out  # ⭐ with something new
    assert "xtens" in out  # extension state
    assert "/tube triage" in out  # short help (auto with no information → English)
    assert w.refresher.kicks, "the summary asks for a refresh (kick_if_due, non-blocking)"


def test_summary_shows_rss_down_and_extension_down(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    snap = w.refresher.status()
    down = dataclasses.replace(
        snap, rss_down_since=w.clock.now() - 3 * 3600, ext_endpoint_up=False, devices_online=0
    )
    monkeypatch.setattr(w.refresher, "status", lambda: down)
    out = run(ChatCtx())
    assert "RSS" in out and "down" in out
    assert "disconnected" in out


def test_summary_extension_connected(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    snap = dataclasses.replace(w.refresher.status(), ext_endpoint_up=True, devices_online=2)
    monkeypatch.setattr(w.refresher, "status", lambda: snap)
    assert "connected (2" in run(ChatCtx())


def test_summary_survives_a_broken_service(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> Any:
        raise RuntimeError("banco sumiu")

    monkeypatch.setattr(w.refresher, "status", boom)
    out = run(ChatCtx())
    assert "erro" in out.casefold()


def test_status_subcommand(w: Any) -> None:
    out = run(ChatCtx(), "status")
    assert "queue" in out and "RSS" in out


def test_abas_lists_tabs_with_counts(w: Any) -> None:
    out = run(ChatCtx(), "abas")
    assert "Tecnologia" in out and "Favoritos" in out


@pytest.mark.parametrize("args", ["ajuda", "help", "?", "nada-disso"])
def test_help_and_unknown(w: Any, args: str) -> None:
    ctx = ChatCtx()
    out = run(ctx, args)
    assert ctx.asked == []
    assert "triar" in out or "triage" in out
    if args == "nada-disso":
        assert "nada-disso" in out


def test_english_aliases_answer_in_english(w: Any) -> None:
    out = run(ChatCtx(), "help")
    assert "triage" in out and "Subcommands" in out
    out = run(LocalCtx("desktop"), "triage")
    assert "Home" in out and "vídeo" not in out.casefold()


def test_settings_language_en_for_bare_command(w: Any, wire: Any) -> None:
    wire.set("settings", FakeSettings(language="en"))
    out = run(ChatCtx())
    assert "new" in out.casefold() and "novos" not in out.casefold()


# =========================================================================== triage


def test_triage_records_each_answer_on_the_spot(w: Any) -> None:
    ids = new_ids(w)
    assert len(ids) >= 5
    ctx = ChatCtx().script_choices("visto", "later", "Arquivar", "👍", "parar")
    out = run(ctx, "triar")
    assert len(ctx.asked) == 5
    first = ctx.asked[0]
    assert first[0].startswith("1/")
    assert labels(first[1]) == ["visto", "depois", "arquivar", "👍", "parar"]
    assert "youtube.com/watch?v=" in first[0]
    got = states(w, ids[:4])
    assert got[ids[0]].state is T.VideoState.seen
    assert got[ids[1]].state is T.VideoState.later
    assert got[ids[2]].state is T.VideoState.archived
    assert got[ids[3]].reaction is T.Reaction.up
    assert ids[4] not in states(w, [ids[4]])  # \"parar\" does not touch the video
    assert "4" in out and "parou" in out.casefold()


def test_triage_ceiling_is_ten(w: Any) -> None:
    add_new_videos(w, 8)
    assert len(new_ids(w)) > 10
    before = new_ids(w)
    ctx = ChatCtx().script_choices(*(["visto"] * 15))
    out = run(ctx, "triar 50")
    assert len(ctx.asked) == 10
    marked = {k for k, r in states(w, before).items() if r.state is T.VideoState.seen}
    assert marked == set(before[:10])
    assert "10/10" in out and "máximo 10" in out


def test_asker_ceiling_and_failures() -> None:
    ctx = RawCtx().script_choices(*(["a"] * 15))
    ask = commands._Asker(ctx, True)
    got = [ask("q", [{"value": "a", "label": "a"}]) for _ in range(15)]
    assert got == ["a"] * 10 + [None] * 5
    assert len(ctx.asked) == 10 and ask.capped
    ask = commands._Asker(RawCtx().script_choices(Liar("x"), 1, ["a"]), True)
    assert [ask("q", [{"value": "a"}]) for _ in range(3)] == [None, None, None]
    boom = commands._Asker(BoomCtx(), True)
    assert boom("q", [{"value": "a"}]) is None and boom.error
    off = commands._Asker(ChatCtx().script_choices("a"), False)
    assert off("q", [{"value": "a"}]) is None and off.ctx.asked == []
    long_q = RawCtx().script_choices("a")
    commands._Asker(long_q, True)("x" * 2000, [{"value": "a", "description": "d"}])
    question, choices = long_q.asked[0]
    assert len(question) <= MAX_CHARS and choices == [{"value": "a", "label": "a"}]


def test_exact_is_strict() -> None:
    assert commands._exact("approve-1", "approve-1")
    for bad in (
        "approve-1 ",
        "APPROVE-1",
        "approve-",
        None,
        1,
        Liar("x"),
        type("S", (str,), {})("approve-1"),
    ):
        assert not commands._exact(bad, "approve-1"), bad


def test_triage_n(w: Any) -> None:
    ctx = ChatCtx().script_choices("visto", "visto", "visto")
    out = run(ctx, "triar 2")
    assert len(ctx.asked) == 2
    assert "2/2" in out or "2 de 2" in out


@pytest.mark.parametrize("args", ["triar 0", "triar -1", "triar abc", "triar 2 3", "triar 1.5"])
def test_triage_invalid_args(w: Any, args: str) -> None:
    ctx = ChatCtx().script_choices("visto")
    before = w.db.query("SELECT COUNT(*) AS n FROM video_state")[0]["n"]
    out = run(ctx, args)
    assert ctx.asked == []
    assert "triar" in out and ("inválid" in out or "1 a 10" in out)
    assert w.db.query("SELECT COUNT(*) AS n FROM video_state")[0]["n"] == before


def test_triage_none_on_first_question_is_text_without_changes(w: Any) -> None:
    before = w.db.query("SELECT * FROM video_state ORDER BY video_id")
    ctx = ChatCtx()  # no script: None (timeout, cancelled, no human)
    out = run(ctx, "triar")
    assert len(ctx.asked) == 1
    assert "Nada foi alterado" in out and "Home" in out
    assert w.db.query("SELECT * FROM video_state ORDER BY video_id") == before


def test_triage_none_midway_stops_and_keeps_what_was_recorded(w: Any) -> None:
    ids = new_ids(w)
    ctx = ChatCtx().script_choices("visto", None, "visto")
    out = run(ctx, "triar")
    assert len(ctx.asked) == 2
    assert states(w, [ids[0]])[ids[0]].state is T.VideoState.seen
    assert ids[1] not in states(w, [ids[1]])
    assert "sem resposta" in out.casefold()


@pytest.mark.parametrize("answer", ["talvez", "Visto!", "", "2", " stop "])
def test_triage_answer_outside_the_list_does_nothing(w: Any, answer: str) -> None:
    ids = new_ids(w)
    ctx = RawCtx().script_choices(answer)
    run(ctx, "triar")
    assert len(ctx.asked) == 1
    assert states(w, ids) == {}


def test_triage_ask_choice_exception(w: Any) -> None:
    ctx = BoomCtx()
    out = run(ctx, "triar")
    assert len(ctx.asked) == 1
    assert "Nada foi alterado" in out or "erro" in out.casefold()
    assert states(w, new_ids(w)) == {}


def test_triage_service_failure_is_text(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a: Any, **k: Any) -> Any:
        raise T.Conflict("vídeo mudou")

    monkeypatch.setattr(w.video_state, "set_state", boom)
    ctx = ChatCtx().script_choices("visto", "visto")
    out = run(ctx, "triar")
    assert len(ctx.asked) == 1
    assert "vídeo mudou" in out


def test_triage_nothing_new(w: Any) -> None:
    w.video_state.set_state(new_ids(w), T.VideoState.seen)
    ctx = ChatCtx().script_choices("visto")
    out = run(ctx, "triar")
    assert ctx.asked == [] and "Nada novo" in out


def test_triage_long_titles_fit(w: Any) -> None:
    add_new_videos(w, 2, title="T" * 900)
    ctx = ChatCtx().script_choices("visto", "visto")
    run(ctx, "triar 2")
    assert len(ctx.asked) == 2


@pytest.mark.parametrize("surface", ["local", "desktop", "cli", "tui", "acp", "", "cron"])
def test_triage_local_or_no_human_never_asks(w: Any, surface: str) -> None:
    ctx = LocalCtx(surface).script_choices("visto", "visto")
    out = run(ctx, "triar")
    assert ctx.asked == []
    assert "Home" in out and "youtube.com/watch?v=" in out
    assert states(w, new_ids(w)) == {}


def test_platform_kwarg_wins_over_surface(w: Any) -> None:
    ctx = ChatCtx().script_choices("visto")
    out = run(ctx, "triar", platform="local")
    assert ctx.asked == [] and "Home" in out
    ctx = LocalCtx("").script_choices("parar")
    run(ctx, "triar", platform="telegram")
    assert len(ctx.asked) == 1


# =========================================================================== cleanup


def test_cleanup_exact_click_approves_only_that_group(w: Any) -> None:
    scan = stale_scan(w)
    groups = scan.by_group()
    first, *rest = [g for g in commands.CLEANUP_ORDER if g in groups]
    ids = sorted({c.channel_id for c in groups[first]})
    ctx = ChatCtx().script_choices(review, confirm, *(["pular"] * len(rest)))
    out = run(ctx, "faxina")
    rows = queue_rows(w)
    assert sorted(r["channel_id"] for r in rows) == ids
    assert {r["approved_via"] for r in rows} == {"ask_choice"}
    assert {r["status"] for r in rows} == {"approved"}
    assert str(len(ids)) in out
    # step 1: destructive not in position 1; step 2: confirmation not in position 1
    step1, step2 = ctx.asked[0][1], ctx.asked[1][1]
    assert labels(step1)[0].casefold().startswith("pular")
    assert not labels(step2)[0].casefold().startswith("confirmar")
    assert labels(step1)[-1].casefold() == "parar"
    # the confirmation never sits where "Unsubscribe these N" was: a repeated number stops
    review_at = [c["value"] for c in step1].index("review")
    confirm_at = next(i for i, c in enumerate(step2) if c["value"].startswith("approve-"))
    assert review_at != confirm_at
    assert labels(step2)[review_at].casefold() == "parar"


def test_cleanup_calls_approve_with_ask_choice_and_user(
    w: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    stale_scan(w)
    calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    real = w.cleanup.approve

    def spy(*args: Any, **kwargs: Any) -> Any:
        calls.append((args, kwargs))
        return real(*args, **kwargs)

    monkeypatch.setattr(w.cleanup, "approve", spy)
    ctx = ChatCtx().script_choices(review, confirm, "parar")
    run(ctx, "faxina")
    assert len(calls) == 1
    args, kwargs = calls[0]
    via = kwargs.get("via", args[1] if len(args) > 1 else None)
    assert via is T.ApprovedVia.ask_choice
    assert kwargs.get("actor", T.Actor.user) is T.Actor.user


@pytest.mark.parametrize(
    "answer",
    [
        None,
        "Confirmar",
        "confirmar",
        "sim",
        "yes",
        "2",
        "approve",
        "Não, pular",
        "voltar",
        lambda q, ch: confirm(q, ch).upper(),
        lambda q, ch: " " + confirm(q, ch) + " ",
        lambda q, ch: confirm(q, ch)[:-1],
        lambda q, ch: confirm(q, ch) + "x",
        lambda q, ch: confirm(q, ch).casefold().title(),
        lambda q, ch: next(c["label"] for c in ch if c["value"] == confirm(q, ch)),
        lambda q, ch: RuntimeError("timeout no clarify"),
        lambda q, ch: 1,
        lambda q, ch: [confirm(q, ch)],
        lambda q, ch: type("S", (str,), {})(confirm(q, ch)),  # str subclass
        lambda q, ch: Liar("sim"),  # str subclass whose __eq__ is always true
    ],
)
def test_cleanup_only_the_exact_click_approves(w: Any, answer: Any) -> None:
    stale_scan(w)
    ctx = RawCtx().script_choices(review, answer, *(["skip"] * 6))
    run(ctx, "faxina")
    assert len(ctx.asked) >= 2  # reached the confirmation
    assert queue_rows(w) == []


def test_cleanup_exact_value_through_raw_surface_approves(w: Any) -> None:
    """Positive control for the test above: the exact value returned raw approves."""
    stale_scan(w)
    ctx = RawCtx().script_choices(review, confirm, "stop")
    run(ctx, "faxina")
    assert len(queue_rows(w)) >= 1


@pytest.mark.parametrize("answer", [None, "pular", "parar", "talvez"])
def test_cleanup_step_one_never_approves(w: Any, answer: Any) -> None:
    stale_scan(w)
    ctx = ChatCtx().script_choices(answer, *([answer] * 6))
    run(ctx, "faxina")
    assert queue_rows(w) == []
    for _q, ch in ctx.asked:
        assert not any(str(c["label"]).casefold().startswith("confirmar") for c in ch)


def test_cleanup_stop_ends_the_loop(w: Any) -> None:
    stale_scan(w)
    ctx = ChatCtx().script_choices("parar", review, confirm)
    out = run(ctx, "faxina")
    assert len(ctx.asked) == 1 and queue_rows(w) == []
    assert "parou" in out.casefold() or "nada" in out.casefold()


def test_cleanup_exception_never_approves(w: Any) -> None:
    stale_scan(w)
    ctx = BoomCtx()
    out = run(ctx, "faxina")
    assert queue_rows(w) == [] and len(ctx.asked) == 1
    assert "Faxina" in out or "faxina" in out


def test_cleanup_two_groups_both_confirmed(w: Any) -> None:
    scan = stale_scan(w)
    ctx = ChatCtx().script_choices(review, confirm, review, confirm, "parar")
    run(ctx, "faxina")
    want = {c.channel_id for c in scan.candidates}
    assert {r["channel_id"] for r in queue_rows(w)} == want
    assert len(ctx.asked) <= commands.MAX_LOOP


def test_cleanup_back_on_confirmation_skips_group(w: Any) -> None:
    stale_scan(w)
    ctx = ChatCtx().script_choices(review, "não, pular", review, "parar")
    run(ctx, "faxina")
    assert queue_rows(w) == []
    assert len(ctx.asked) == 4


def test_cleanup_runs_a_scan_when_there_is_none(w: Any) -> None:
    assert w.cleanup.latest_scan() is None
    ctx = ChatCtx().script_choices("parar")
    out = run(ctx, "faxina")
    assert w.cleanup.latest_scan() is not None
    assert len(ctx.asked) == 1 and "Nerdologia" in ctx.asked[0][0]
    assert queue_rows(w) == [] and out


def test_cleanup_nova_forces_a_new_scan(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    stale_scan(w)
    scans: list[int] = []
    real = w.cleanup.scan

    def spy(**kw: Any) -> Any:
        scans.append(1)
        return real(**kw)

    monkeypatch.setattr(w.cleanup, "scan", spy)
    run(ChatCtx().script_choices("parar"), "faxina")
    assert scans == []
    run(ChatCtx().script_choices("parar"), "faxina nova")
    assert scans == [1]


def test_cleanup_nothing_to_do(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    empty = T.CleanupScan(scan_id="s", created_at=w.clock.now(), candidates=())
    monkeypatch.setattr(w.cleanup, "latest_scan", lambda: empty)
    ctx = ChatCtx().script_choices(review, confirm)
    out = run(ctx, "faxina")
    assert ctx.asked == [] and "faxina nova" in out


@pytest.mark.parametrize("args", ["faxina 1", "faxina aprovar tudo", "faxina tudo", "faxina sim"])
def test_cleanup_invalid_args_never_approve(w: Any, args: str) -> None:
    stale_scan(w)
    ctx = ChatCtx().script_choices(review, confirm, review, confirm)
    out = run(ctx, args)
    assert ctx.asked == [] and queue_rows(w) == []
    assert "faxina" in out


@pytest.mark.parametrize("surface", ["local", "desktop", "cli", "", "cron"])
def test_cleanup_local_points_to_home_and_never_asks(w: Any, surface: str) -> None:
    stale_scan(w)
    ctx = LocalCtx(surface).script_choices(review, confirm)
    out = run(ctx, "faxina")
    assert ctx.asked == [] and queue_rows(w) == []
    assert "Faxina" in out and "Home" in out
    assert "Nerdologia" in out or "3" in out


def test_cleanup_local_without_scan_does_not_scan(w: Any) -> None:
    out = run(LocalCtx("desktop"), "faxina")
    assert w.cleanup.latest_scan() is None
    assert "Home" in out


def test_cleanup_approval_refused_is_text(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    stale_scan(w)

    def refuse(*a: Any, **k: Any) -> Any:
        raise T.ApprovalRefused("recusado")

    monkeypatch.setattr(w.cleanup, "approve", refuse)
    out = run(ChatCtx().script_choices(review, confirm, review, confirm), "faxina")
    assert "recusado" in out
    assert queue_rows(w) == []


def _many(w: Any, n: int = 40) -> dict[str, str]:
    """*n* channels proposed by hand, with short, unique titles. Returns id → title."""
    ids = ["UC" + f"i06many{k:015d}"[:22] for k in range(n)]
    names = {cid: f"Canal-{k:02d}-fim" for k, cid in enumerate(ids)}
    w.channels.upsert_many(
        [T.ChannelIn(title=names[c], channel_id=c) for c in ids],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
        actor=T.Actor.extension,
    )
    w.cleanup.propose(ids, reason="Motivo longo " + "y" * 200)
    return names


def _approve_all_pages(q: str, choices: list) -> str:
    """Accepts everything asked (review → confirm), page after page."""
    try:
        return review(q, choices)
    except AssertionError:
        return confirm(q, choices)


def test_cleanup_big_group_approves_only_the_channels_named_in_the_question(w: Any) -> None:
    names = _many(w)
    ctx = ChatCtx().script_choices(*([_approve_all_pages] * commands.MAX_LOOP))
    run(ctx, "faxina")
    approved = {r["channel_id"] for r in queue_rows(w) if r["channel_id"] in names}
    assert approved, "no page was approved"
    assert len(approved) < len(names), "40 channels do not fit in 5 questions of 500 characters"
    shown_before_confirm: set[str] = set()
    for question, choices in ctx.asked:
        assert len(question) <= commands.MAX_CHARS
        for cid, title in names.items():
            if title in question:
                shown_before_confirm.add(cid)
        for label in labels(choices):
            if label.casefold().startswith(("cancelar estes", "confirmar")):
                # the button number is the count of channels named on screen, not of the whole group
                n = int("".join(ch for ch in label if ch.isdigit()))
                assert n < len(names)
    assert approved <= shown_before_confirm, sorted(approved - shown_before_confirm)


def test_cleanup_big_group_one_confirmation_is_one_page(w: Any) -> None:
    names = _many(w)

    def first_manual_page(q: str, choices: list) -> str:
        try:
            return confirm(q, choices)  # step 2 (only reached after reviewing the page)
        except AssertionError:
            pass
        if not any(t in q for t in names.values()):
            return "pular"  # other groups in the test world
        if any(r["channel_id"] in names for r in queue_rows(w)):
            return "parar"  # the group's 2nd page: stops here
        return review(q, choices)

    ctx = ChatCtx().script_choices(*([first_manual_page] * commands.MAX_LOOP))
    run(ctx, "faxina")
    approved = {r["channel_id"] for r in queue_rows(w) if r["channel_id"] in names}
    page = next(q for q, _ in ctx.asked if any(t in q for t in names.values()))
    on_page = {cid for cid, title in names.items() if title in page}
    assert approved == on_page and 0 < len(on_page) < len(names)
    assert "na próxima pergunta" in page


# =========================================================================== theme


@pytest.fixture
def tw(w: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    """World with a fake search that returns 8 videos from 2 channels for any query."""
    hits = [
        T.SearchHit(
            video_id=f"i06th{k:06d}",
            title=f"Agentes de IA na prática {k}",
            channel_id="UC" + f"i06themech{k % 2}".ljust(22, "0"),
            channel_title=f"Canal Tema {k % 2}",
        )
        for k in range(8)
    ]
    monkeypatch.setattr(w.youtube, "search", lambda query, order=None: list(hits))
    w.themes_before = {t.id for t in w.themes.list()}
    return w


def new_themes(world: Any) -> list[T.Theme]:
    return [t for t in world.themes.list() if t.id not in world.themes_before]


def test_theme_preview_and_save(tw: Any) -> None:
    ctx = ChatCtx().script_choices("salvar")
    out = run(ctx, "tema agentes de IA")
    themes = new_themes(tw)
    assert len(themes) == 1 and themes[0].status is T.ThemeStatus.saved
    question, choices = ctx.asked[0]
    assert "8 vídeos" in question and "2 canais" in question
    assert (themes[0].name or "") in question
    assert labels(choices)[0].casefold() != "salvar"  # saving is not the 1st option
    assert "aba" in out.casefold()
    assert ctx.posted, "warns that it is building before the long call"


@pytest.mark.parametrize("answer", [None, "agora não", "talvez"])
def test_theme_not_saved_without_exact_click(tw: Any, answer: Any) -> None:
    ctx = ChatCtx().script_choices(answer)
    out = run(ctx, "tema agentes de IA")
    (theme,) = new_themes(tw)
    assert theme.status is T.ThemeStatus.preview
    assert "Home" in out and "8" in out


def test_theme_in_english(tw: Any) -> None:
    ctx = ChatCtx().script_choices("save")
    out = run(ctx, "theme AI agents")
    assert "Save as a tab?" in ctx.asked[0][0]
    assert "Tab created" in out


def test_theme_note_is_shown(tw: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    w = tw
    real = w.themes.create

    def partial(query: str, **kw: Any) -> T.ThemePreview:
        assert kw.get("timeout") == T.TOOL_TIMEOUT_S
        assert kw.get("origin") is T.Actor.user
        prev = real(query, **kw)
        theme = dataclasses.replace(prev.theme, error="Prévia parcial: o tempo acabou.")
        return dataclasses.replace(prev, theme=theme)

    monkeypatch.setattr(w.themes, "create", partial)
    ctx = ChatCtx().script_choices("agora não")
    run(ctx, "tema agentes de IA")
    assert "Nota: Prévia parcial" in ctx.asked[0][0]


def test_theme_empty_preview_does_not_offer_save(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    theme = T.Theme(id="th1", query="x", status=T.ThemeStatus.preview, created_at=1, name="X")
    monkeypatch.setattr(w.themes, "create", lambda q, **kw: T.ThemePreview(theme=theme, items=()))
    ctx = ChatCtx().script_choices("salvar")
    out = run(ctx, "tema nada")
    assert ctx.asked == [] and "0" in out


@pytest.mark.parametrize(
    "exc, needle",
    [
        (T.LLMUnavailable("sem modelo"), "modelo"),
        (T.Busy("ocupado"), "andamento"),
        (T.OperationTimeout("demorou"), "demor"),
        (T.ValidationError("tema vazio"), "tema vazio"),
    ],
)
def test_theme_errors_are_text(
    w: Any, monkeypatch: pytest.MonkeyPatch, exc: Exception, needle: str
) -> None:
    def boom(*a: Any, **k: Any) -> Any:
        raise exc

    monkeypatch.setattr(w.themes, "create", boom)
    out = run(ChatCtx().script_choices("salvar"), "tema algo")
    assert needle in out


@pytest.mark.parametrize("args", ["tema", "tema    ", "tema " + "x" * 300])
def test_theme_invalid_args(tw: Any, args: str) -> None:
    ctx = ChatCtx().script_choices("salvar")
    out = run(ctx, args)
    assert ctx.asked == [] and new_themes(tw) == []
    assert "assunto" in out


@pytest.mark.parametrize("word", ["topic", "assunto", "theme", "tema"])
def test_topic_words_all_reach_the_same_subcommand(tw: Any, word: str) -> None:
    ctx = ChatCtx().script_choices("salvar")
    out = run(ctx, word)
    assert ctx.asked == [] and new_themes(tw) == []
    assert "/tube topic" in out or "/tube assunto" in out


@pytest.mark.parametrize("surface", ["local", "desktop", ""])
def test_theme_local_does_not_run_the_long_call(tw: Any, surface: str) -> None:
    ctx = LocalCtx(surface).script_choices("salvar")
    out = run(ctx, "tema agentes de IA")
    assert ctx.asked == [] and new_themes(tw) == []
    assert "Home" in out


# =========================================================================== routines


def test_routines_install_with_confirmation(w: Any) -> None:
    ctx = ChatCtx().script_choices("instalar")
    out = run(ctx, "rotinas")
    assert w.routines.installed == set(T.ROUTINE_KEYS)
    assert len(ctx.asked) == 1
    assert "hermes cron edit" in out


@pytest.mark.parametrize("answer", [None, "cancelar", "talvez"])
def test_routines_cancelled(w: Any, answer: Any) -> None:
    out = run(ChatCtx().script_choices(answer), "rotinas")
    assert w.routines.installed == set()
    assert "Nada instalado" in out


def test_routines_with_keys(w: Any) -> None:
    run(ChatCtx().script_choices("instalar"), "rotinas bom-dia favoritos")
    assert w.routines.installed == {"bom-dia", "favoritos"}


def test_routines_unknown_key(w: Any) -> None:
    ctx = ChatCtx().script_choices("instalar")
    out = run(ctx, "rotinas cafe")
    assert ctx.asked == [] and w.routines.installed == set()
    assert "cafe" in out


@pytest.mark.parametrize("surface", ["local", "desktop", ""])
def test_routines_local_lists_without_installing(w: Any, surface: str) -> None:
    ctx = LocalCtx(surface).script_choices("instalar")
    out = run(ctx, "rotinas")
    assert ctx.asked == [] and w.routines.installed == set()
    assert "bom-dia" in out


def test_routines_stub_installer(w: Any, wire: Any) -> None:
    class Stub:
        __contract_stub__ = "routines"

        def list(self) -> Any:
            raise NotImplementedError("stub")

        def install(self, confirm: Any, keys: Any = None) -> Any:
            raise NotImplementedError("stub")

    wire.set("routines", Stub())
    ctx = ChatCtx().script_choices("instalar")
    out = run(ctx, "rotinas")
    assert ctx.asked == []
    assert "disponível" in out


# =========================================================================== routines remove


def install_all(world: Any, keys: list[str] | None = None) -> None:
    report = world.routines.install(lambda q, c: "install", keys=keys)
    assert not report.cancelled


def installed_keys(world: Any) -> set[str]:
    return {i.key for i in world.routines.list() if i.installed}


def assert_remove_question(ctx: Any) -> None:
    """A single question, ``{value, label}`` options, the destructive one not in 1st position."""
    assert len(ctx.asked) == 1
    question, choices = ctx.asked[0]
    assert all(set(c) == {"value", "label"} for c in choices)
    values = [c["value"] for c in choices]
    assert "remove" in values and values[0] != "remove"
    return None


@pytest.mark.parametrize(
    ("args", "answer"), [("rotinas remover", "remover"), ("routines remove", "Remover")]
)
def test_routines_remove_exact_click_removes(w: Any, args: str, answer: str) -> None:
    install_all(w)
    ctx = ChatCtx().script_choices(answer)  # Hermes's ask_choice returns the button's *value*
    out = run(ctx, args)
    assert installed_keys(w) == set()
    assert_remove_question(ctx)
    question = ctx.asked[0][0]
    for key in T.ROUTINE_KEYS:
        assert key in question  # says what is installed
    assert "bom-dia" in out
    assert ("Removed" in out) if args.startswith("routines") else ("Removidas" in out)


def test_routines_remove_raw_exact_value_removes(w: Any) -> None:
    """Positive control for ``RawCtx``: the exact raw value removes."""
    install_all(w)
    ctx = RawCtx().script_choices("remove")
    run(ctx, "rotinas remover")
    assert installed_keys(w) == set()


REMOVE_REFUSALS: tuple[Any, ...] = (
    None,
    "cancel",
    "Remover",
    "remover",
    "REMOVE",
    "Remove",
    " remove",
    "remove ",
    "remove\n",
    "remov",
    "removed",
    "remove all",
    "sim",
    "yes",
    "2",
    "1",
    2,
    1,
    True,
    ["remove"],
    {"value": "remove"},
    Liar("x"),
    Liar("remove"),
)


@pytest.mark.parametrize("answer", REMOVE_REFUSALS, ids=repr)
@pytest.mark.parametrize("args", ["rotinas remover", "routines remove"])
def test_routines_remove_anything_but_exact_removes_nothing(w: Any, args: str, answer: Any) -> None:
    install_all(w)
    ctx = RawCtx().script_choices(answer)
    out = run(ctx, args)
    assert installed_keys(w) == set(T.ROUTINE_KEYS)
    assert w.routines.scripts == set(T.MAINTENANCE_SCRIPTS)
    assert len(ctx.asked) == 1
    assert ("Nothing removed" in out) if args.startswith("routines") else ("Nada removido" in out)


@pytest.mark.parametrize("answer", [None, "cancelar", "talvez", "2"])
def test_routines_remove_chat_refusals(w: Any, answer: Any) -> None:
    """Through the scripted ``ask_choice`` (text → value): cancel, free text, ``None``."""
    install_all(w)
    ctx = ChatCtx().script_choices(answer)
    out = run(ctx, "rotinas remover")
    assert installed_keys(w) == set(T.ROUTINE_KEYS)
    assert "Nada removido" in out


def test_routines_remove_ask_raises(w: Any) -> None:
    install_all(w)
    ctx = BoomCtx()
    out = run(ctx, "rotinas remover")
    assert installed_keys(w) == set(T.ROUTINE_KEYS)
    assert len(ctx.asked) == 1
    assert "Nada removido" in out and "clarify quebrou" not in out
    assert commands._t("pt", "internal") in out  # the detail stays in the log


@pytest.mark.parametrize("args", ["rotinas remover", "routines remove"])
def test_routines_remove_nothing_installed_does_not_ask(w: Any, args: str) -> None:
    ctx = ChatCtx().script_choices("remover")
    out = run(ctx, args)
    assert ctx.asked == []
    if args.startswith("routines"):
        assert "No routines installed" in out
    else:
        assert "Nenhuma rotina instalada" in out


@pytest.mark.parametrize("surface", ["local", "desktop", "tui", "cli", "cron", ""])
@pytest.mark.parametrize("args", ["rotinas remover", "routines remove"])
def test_routines_remove_local_never_asks_nor_removes(w: Any, surface: str, args: str) -> None:
    install_all(w, ["bom-dia", "favoritos"])
    ctx = LocalCtx(surface).script_choices("remove", "remove")
    out = run(ctx, args)
    assert ctx.asked == []
    assert installed_keys(w) == {"bom-dia", "favoritos"}
    assert "hermes cron list" in out and "hermes cron remove" in out
    assert "bom-dia" in out and "favoritos" in out and "resumo-pasta" not in out


def test_routines_remove_ctx_none_and_no_ask_choice(w: Any) -> None:
    install_all(w)
    out = run(None, "rotinas remover")
    assert "hermes cron remove" in out
    bare = type("Bare", (), {"session_surface": lambda self: "telegram"})()
    out = run(bare, "rotinas remover")
    assert "hermes cron remove" in out
    assert installed_keys(w) == set(T.ROUTINE_KEYS)


@pytest.mark.parametrize("args", ["rotinas remover", "routines remove"])
def test_routines_remove_local_nothing_installed(w: Any, args: str) -> None:
    ctx = LocalCtx("desktop")
    out = run(ctx, args)
    assert ctx.asked == []
    assert (
        ("No routines installed" in out)
        if args.startswith("routines")
        else ("Nenhuma rotina instalada" in out)
    )


def test_routines_remove_with_keys(w: Any) -> None:
    install_all(w)
    ctx = ChatCtx().script_choices("remover")
    out = run(ctx, "rotinas remover bom-dia favoritos")
    assert installed_keys(w) == set(T.ROUTINE_KEYS) - {"bom-dia", "favoritos"}
    assert "bom-dia" in ctx.asked[0][0] and "resumo-pasta" not in ctx.asked[0][0]
    assert "favoritos" in out


def test_routines_remove_unknown_key(w: Any) -> None:
    install_all(w)
    ctx = ChatCtx().script_choices("remover")
    out = run(ctx, "rotinas remover cafe")
    assert ctx.asked == [] and installed_keys(w) == set(T.ROUTINE_KEYS)
    assert "cafe" in out


def test_routines_remove_asks_once_even_if_the_installer_asks_again(w: Any, wire: Any) -> None:
    """``/tube`` lets the installer ask only once; the 2nd question is ``None``."""
    answers: list[Any] = []

    class Greedy:
        def list(self) -> list[T.RoutineInfo]:
            return w.routines.list()

        def install(self, confirm: Any, keys: Any = None) -> T.InstallReport:
            raise AssertionError("must not install")

        def remove(self, confirm: Any, keys: Any = None) -> T.InstallReport:
            choices = [
                {"value": "cancel", "label": "Cancelar"},
                {"value": "remove", "label": "Remover"},
            ]
            answers.append(confirm("1ª?", choices))
            answers.append(confirm("2ª?", choices))
            return T.InstallReport(cancelled=True)

    wire.set("routines", Greedy())
    ctx = ChatCtx().script_choices("remover", "remover")
    run(ctx, "rotinas remover")
    assert len(ctx.asked) == 1
    assert answers == ["remove", None]


def test_routines_remove_only_passes_offered_values(w: Any, wire: Any) -> None:
    """An answer outside the offered options does not reach the installer (defense in ``/tube``)."""
    got: list[Any] = []

    class Probe:
        def list(self) -> list[T.RoutineInfo]:
            return w.routines.list()

        def install(self, confirm: Any, keys: Any = None) -> T.InstallReport:
            raise AssertionError("must not install")

        def remove(self, confirm: Any, keys: Any = None) -> T.InstallReport:
            got.append(
                confirm(
                    "?",
                    [
                        {"value": "cancel", "label": "Cancelar"},
                        {"value": "remove", "label": "Remover"},
                    ],
                )
            )
            return T.InstallReport(cancelled=True)

    wire.set("routines", Probe())
    run(RawCtx().script_choices("Remover"), "rotinas remover")
    run(RawCtx().script_choices("remove"), "rotinas remover")
    assert got == [None, "remove"]


def test_routines_remove_installer_without_remove_or_stub(w: Any, wire: Any) -> None:
    class Old:
        def list(self) -> list[T.RoutineInfo]:
            return w.routines.list()

        def install(self, confirm: Any, keys: Any = None) -> T.InstallReport:
            raise AssertionError("must not install")

    wire.set("routines", Old())
    ctx = ChatCtx().script_choices("remover")
    out = run(ctx, "rotinas remover")
    assert ctx.asked == [] and "disponível" in out


def test_routines_remove_failure_is_reported(w: Any, wire: Any) -> None:
    class Failing:
        def list(self) -> list[T.RoutineInfo]:
            return w.routines.list()

        def install(self, confirm: Any, keys: Any = None) -> T.InstallReport:
            raise AssertionError("must not install")

        def remove(self, confirm: Any, keys: Any = None) -> T.InstallReport:
            confirm(
                "?",
                [{"value": "cancel", "label": "Cancelar"}, {"value": "remove", "label": "Remover"}],
            )
            return T.InstallReport(message="Falhou: bom-dia: cron recusou.")

    install_all(w)
    wire.set("routines", Failing())
    out = run(ChatCtx().script_choices("remover"), "rotinas remover")
    assert "Nada removido" in out and "cron recusou" in out


def test_routines_install_path_unchanged_mentions_remove(w: Any) -> None:
    """``/tube rotinas`` keeps installing; the local list explains how to turn them off."""
    out = run(LocalCtx("desktop"), "rotinas")
    assert "/tube rotinas remover" in out
    out = run(LocalCtx("desktop"), "routines")
    assert "/tube routines remove" in out


@pytest.mark.parametrize("args", ["rotinas remover", "routines remove", "rotinas remover bom-dia"])
@pytest.mark.parametrize("kind", ["chat", "local"])
def test_routines_remove_short_plain_text(w: Any, args: str, kind: str) -> None:
    install_all(w)
    ctx: Any = ChatCtx() if kind == "chat" else LocalCtx("desktop")
    ctx.script_choices(*([None] * 3))
    run(ctx, args)
    assert len(ctx.asked) == (1 if kind == "chat" else 0)
    assert installed_keys(w) == set(T.ROUTINE_KEYS)


# ---------------------------------------------------------- real installer through /tube


class FakeCron:
    """In-memory ``cronjob_manage`` with the real tool's JSON shape (list/create/remove)."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}
        self.calls: list[dict[str, Any]] = []
        self._n = 0

    def __call__(self, args: dict[str, Any]) -> str:
        import json

        args = dict(args)
        self.calls.append(args)
        action = args.get("action")
        if action == "list":
            jobs = [{"job_id": jid, **job} for jid, job in self.jobs.items()]
            return json.dumps({"success": True, "count": len(jobs), "jobs": jobs})
        if action == "create":
            self._n += 1
            jid = f"{self._n:012x}"
            self.jobs[jid] = {k: v for k, v in args.items() if k != "action"}
            return json.dumps({"success": True, "job_id": jid})
        if action == "remove":
            if self.jobs.pop(str(args.get("job_id")), None) is None:
                return json.dumps({"success": False, "error": "not found"})
            return json.dumps({"success": True})
        return json.dumps({"success": False, "error": f"Unknown cron action '{action}'"})

    def of(self, action: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if c.get("action") == action]


def make_home(tmp_path: Path) -> Path:
    """Fake profile with ``plugins/<id>`` → ``plugin/`` (symlink), like the installed one."""
    from tube_pkg._id import PLUGIN_ID

    home = (tmp_path / "profiles" / "p1").resolve()
    (home / "plugins").mkdir(parents=True)
    src = Path(__file__).resolve().parents[1] / "plugin"
    (home / "plugins" / PLUGIN_ID).symlink_to(src, target_is_directory=True)
    return home


def real_installer(ctx: Any, home: Path) -> Any:
    mod = importlib.import_module("tube_pkg.routines.installer")
    return mod.build(settings=FakeSettings(), ctx=ctx, home=home)


def shims(home: Path) -> list[str]:
    folder = home / "scripts"
    return sorted(p.name for p in folder.glob("*.py")) if folder.exists() else []


@pytest.fixture
def real_routines(tmp_path: Path, wire: Any) -> Iterator[tuple[Any, FakeCron, Path]]:
    """Real ``RoutinesInstaller`` (fake profile + fake cron) wired into ``wiring``."""
    home = make_home(tmp_path)
    cron = FakeCron()
    holder = RawCtx()
    holder.tool_responses["cronjob_manage"] = cron
    inst = real_installer(holder, home)
    wire.set("routines", inst)
    yield inst, cron, home


def _cron_ctx(ctx: Any, cron: FakeCron, inst: Any) -> Any:
    ctx.tool_responses["cronjob_manage"] = cron
    inst.ctx = ctx  # the same ctx asks (ask_choice) and talks to cron (dispatch_tool)
    return ctx


@pytest.mark.parametrize(
    "answer", ["Remover", "REMOVE", " remove", "2", 2, None, Liar("remove")], ids=repr
)
def test_real_installer_similar_answer_removes_nothing(real_routines: Any, answer: Any) -> None:
    inst, cron, home = real_routines
    assert not inst.install(lambda q, c: "install").cancelled
    jobs, files = dict(cron.jobs), shims(home)
    assert len(jobs) >= len(T.ROUTINE_KEYS) and files
    ctx = _cron_ctx(RawCtx().script_choices(answer), cron, inst)
    out = run(ctx, "rotinas remover")
    assert cron.jobs == jobs and shims(home) == files
    assert cron.of("remove") == []
    assert_remove_question(ctx)
    assert "Nada removido" in out


def test_real_installer_exact_click_removes(real_routines: Any) -> None:
    inst, cron, home = real_routines
    assert not inst.install(lambda q, c: "install").cancelled
    ctx = _cron_ctx(ChatCtx().script_choices("Remove"), cron, inst)
    out = run(ctx, "routines remove")
    assert cron.jobs == {} and shims(home) == []
    assert_remove_question(ctx)
    assert "Removed" in out and "bom-dia" in out
    again = _cron_ctx(ChatCtx().script_choices("Remover"), cron, inst)
    out = run(again, "rotinas remover")
    assert again.asked == [] and "Nenhuma rotina instalada" in out


def test_real_installer_local_only_explains(real_routines: Any) -> None:
    inst, cron, home = real_routines
    assert not inst.install(lambda q, c: "install").cancelled
    jobs = dict(cron.jobs)
    ctx = _cron_ctx(LocalCtx("desktop").script_choices("remove"), cron, inst)
    out = run(ctx, "rotinas remover")
    assert ctx.asked == [] and cron.jobs == jobs
    assert "hermes cron remove" in out


# ------------------------------------------------- real × fake conformance (RoutinesInstaller)


def _conformance_script(inst: Any) -> dict[str, Any]:
    """Same script for the real one and the fake; returns what must match."""
    out: dict[str, Any] = {}
    infos = inst.list()
    out["list"] = [(i.key, i.kind, i.schedule, i.installed) for i in infos]
    asked: list[tuple[str, list[Any]]] = []

    def answer(value: Any) -> Any:
        def confirm(q: str, choices: list[Any]) -> Any:
            asked.append((q, [dict(c) for c in choices]))
            return value

        return confirm

    report = inst.remove(answer("remove"))
    out["remove_empty"] = (report.cancelled, report.installed, len(asked))
    report = inst.install(answer("install"))
    out["install"] = (report.cancelled, set(report.installed))
    asked.clear()
    for refusal in (None, "Remover", "REMOVE", "2", 2, Liar("remove")):
        report = inst.remove(answer(refusal))
        assert report.cancelled and report.installed == (), refusal
    out["refusals_asked"] = len(asked)
    q, choices = asked[0]
    out["choices_shape"] = (
        all(set(c) == {"value", "label"} for c in choices),
        choices[0]["value"],
        [c["value"] for c in choices][1:].count("remove"),
    )
    out["question_lists_keys"] = all(k in q for k in T.ROUTINE_KEYS)
    out["after_refusals"] = {i.key for i in inst.list() if i.installed}
    asked.clear()
    report = inst.remove(answer("remove"), keys=["bom-dia"])
    out["remove_one"] = (report.cancelled, report.installed, len(asked))
    asked.clear()
    report = inst.remove(answer("remove"))
    out["remove_all"] = (report.cancelled, set(report.installed) & set(T.ROUTINE_KEYS), len(asked))
    out["after_remove"] = {i.key for i in inst.list() if i.installed}
    asked.clear()
    report = inst.remove(answer("remove"))
    out["remove_again"] = (report.cancelled, report.installed, len(asked))
    with pytest.raises(T.ValidationError):
        inst.remove(answer("remove"), keys=["cafe"])
    return out


def test_routines_installer_conformance_real_vs_fake(
    tmp_path: Path, db: Any, clock: FakeClock
) -> None:
    home = make_home(tmp_path)
    ctx = FakeCtx()
    ctx.tool_responses["cronjob_manage"] = FakeCron()
    real = real_installer(ctx, home)
    fake = build_fake_world(db, clock=clock).routines
    for inst in (real, fake):
        assert isinstance(inst, T.RoutinesInstaller)
    expected = _conformance_script(real)
    assert expected["remove_empty"] == (False, (), 0)
    assert expected["after_remove"] == set()
    assert expected["choices_shape"] == (True, "cancel", 1)
    assert _conformance_script(fake) == expected


def test_protocol_declares_remove() -> None:
    assert callable(getattr(T.RoutinesInstaller, "remove", None))
    import inspect

    params = inspect.signature(T.RoutinesInstaller.remove).parameters
    assert list(params) == ["self", "confirm", "keys"]
    assert params["keys"].default is None
    assert (T.RoutinesInstaller.remove.__doc__ or "").strip()


# =========================================================================== messages


ALL_INVOCATIONS = [
    "",
    "status",
    "abas",
    "ajuda",
    "triar",
    "triar 3",
    "faxina",
    "faxina nova",
    "tema agentes de IA",
    "rotinas",
    "xyz",
    "help",
    "tabs",
    "cleanup",
    "theme AI agents",
    "routines",
]


@pytest.mark.parametrize("args", ALL_INVOCATIONS)
@pytest.mark.parametrize("kind", ["chat", "local"])
def test_every_subcommand_answers_short_plain_text(w: Any, args: str, kind: str) -> None:
    add_new_videos(w, 3, title="Título bem comprido " * 20)
    ctx: Any = ChatCtx() if kind == "chat" else LocalCtx("desktop")
    ctx.script_choices(*([None] * 12))
    run(ctx, args)
    if kind == "local":
        assert ctx.asked == []
    assert queue_rows(w) == []


# ======================================================================= real database and services


@pytest.fixture
def real_graph(wire: Any, db: Any) -> Iterator[Any]:
    """Real ``wiring`` graph over the test database (``Cleanup``, ``ChannelService``, …)."""
    if type(db).__name__ == "MemDb":
        pytest.skip("needs the real database")
    wire.set("db", db)
    wire.set("settings", FakeSettings())
    wire.set("ctx", None)
    wiring.reset()
    g = wiring.graph()
    yield g
    wiring.reset()


def test_real_services_cleanup_exact_click(real_graph: Any) -> None:
    import time

    now = int(time.time())
    channels = real_graph.get("channels")
    stale = "UC" + "i06realstale".ljust(22, "0")
    fresh = "UC" + "i06realfresh".ljust(22, "0")
    channels.upsert_many(
        [
            T.ChannelIn(title="Canal Parado", channel_id=stale),
            T.ChannelIn(title="Canal Vivo", channel_id=fresh),
        ],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
        actor=T.Actor.extension,
    )
    real_graph.get("video_store").upsert(
        [
            T.VideoIn(
                id="i06realv001", channel_id=stale, title="velho", published_at=now - 300 * DAY
            ),
            T.VideoIn(id="i06realv002", channel_id=fresh, title="novo", published_at=now - DAY),
        ],
        T.VideoOrigin.rss,
    )
    # first: a look-alike answer does not approve
    ctx = RawCtx().script_choices(review, lambda q, ch: confirm(q, ch).upper(), "stop")
    run(ctx, "faxina")
    db = real_graph.db
    assert db.query("SELECT * FROM unsub_queue") == []
    # then: the exact click approves, with approved_via=ask_choice
    ctx = ChatCtx().script_choices(review, confirm, "parar")
    out = run(ctx, "faxina")
    rows = db.query("SELECT * FROM unsub_queue")
    assert [(r["channel_id"], r["approved_via"], r["status"]) for r in rows] == [
        (stale, "ask_choice", "approved")
    ]
    assert "1" in out


def test_real_services_triage(real_graph: Any) -> None:
    import time

    now = int(time.time())
    channels = real_graph.get("channels")
    cid = "UC" + "i06realtriage".ljust(22, "0")
    channels.upsert_many(
        [T.ChannelIn(title="Canal Triagem", channel_id=cid)],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
        actor=T.Actor.extension,
    )
    real_graph.get("video_store").upsert(
        [
            T.VideoIn(
                id=f"i06rt{k:06d}",
                channel_id=cid,
                title=f"novo {k}",
                published_at=now - 3600 * (k + 1),
            )
            for k in range(3)
        ],
        T.VideoOrigin.rss,
    )
    feed = real_graph.get("feed")
    ids = [i.video.id for i in feed.page(T.BUILTIN_TAB_ALL_NEW, limit=10).items]
    if not ids:
        pytest.skip("the real engine does not consider these videos new (watermark)")
    ctx = ChatCtx().script_choices("visto", "depois", "parar")
    run(ctx, "triar")
    got = real_graph.get("video_state").get(ids[:2])
    assert got[ids[0]].state is T.VideoState.seen
    assert got[ids[1]].state is T.VideoState.later


# =========================================================================== third-party text

EVIL = "[Claim your prize](https://evil.example/x)"


def no_markup_link(text: str) -> None:
    assert "](" not in text and "][" not in text and "]:" not in text, text
    md = pytest.importorskip("plugins.platforms.telegram.telegram_markdown")
    converted = md.to_markdown_v2(text)
    assert "](" not in converted, converted  # escaped "\\] \\(" is plain text, never a link


@pytest.mark.parametrize(
    "raw",
    [
        EVIL,
        "[Claim your prize] (https://evil.example/x)",
        "[Claim][ref]",
        "[ref]: https://evil.example/x",
        "Watch [this]\n(https://evil.example/x)",
        "[a](https://evil.example/(x))",
    ],
)
def test_one_line_breaks_markdown_links(raw: str) -> None:
    out = commands._one_line(raw, 200)
    no_markup_link(out)
    assert "Claim" in out or "this" in out or "ref" in out or "a" in out


@pytest.mark.parametrize(
    ("raw", "gone"),
    [
        ("**bold** title", "**"),
        ("`code` title", "`"),
        ("_hidden_ text", "_hidden"),
        ("*shout* now", "*shout"),
        ("~~strike~~ me", "~~"),
        ("||spoiler|| here", "||"),
        ("<a href='https://evil.example'>x</a>", "<a"),
    ],
)
def test_one_line_neutralizes_markup(raw: str, gone: str) -> None:
    assert gone not in commands._one_line(raw, 200)


@pytest.mark.parametrize(
    "title",
    [
        "[4K] Rust in 100 Seconds",
        "Rust (2024) — part 1",
        "snake_case vs camelCase",
        "Q&A: what's new? #shorts",
        "C++ 3 < 4 > 2",
        "10% off: the [BEST] deals (today)",
    ],
)
def test_one_line_keeps_ordinary_titles(title: str) -> None:
    assert commands._one_line(title, 200) == title


def test_summary_next_video_title_is_not_a_link(w: Any) -> None:
    add_new_videos(w, 1, title=EVIL)
    out = run(ChatCtx(), "", source=src("dm"), platform="telegram")
    no_markup_link(out)


def test_triage_listing_titles_are_not_links(w: Any) -> None:
    add_new_videos(w, 2, title=EVIL)
    out = run(LocalCtx("desktop"), "triar")
    assert "Claim your prize" in out
    no_markup_link(out)


def test_cleanup_names_and_reasons_are_not_links(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    stale_scan(w)
    real = commands._titles
    monkeypatch.setattr(commands, "_titles", lambda ids: {i: EVIL for i in real(ids)})
    out = run(LocalCtx("desktop"), "faxina")
    assert "Claim your prize" in out
    no_markup_link(out)
    ctx = ChatCtx().script_choices("parar")
    run(ctx, "faxina", source=src("dm"), platform="telegram")
    no_markup_link(ctx.asked[0][0])


def test_tab_icons_are_neutralized() -> None:
    assert "](" not in commands._icon(EVIL)
    assert commands._icon("🎮") == "🎮 "
    assert commands._icon(None) == "" and commands._icon("  ") == ""


# =========================================================================== error text

SECRET_DETAIL = "/srv/someone/hermes/tube.db: no such table: unsub_queue"


def test_unexpected_error_shows_a_generic_text(
    w: Any, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def boom() -> Any:
        raise RuntimeError(SECRET_DETAIL)

    monkeypatch.setattr(w.refresher, "status", boom)
    with caplog.at_level("ERROR"):
        out = run(ChatCtx(), "status", source=src("dm"), platform="telegram")
    assert "/Users" not in out and "no such table" not in out and "RuntimeError" not in out
    assert commands._t("en", "internal") in out or commands._t("pt", "internal") in out
    assert SECRET_DETAIL in caplog.text  # the detail is in the log


def test_ask_failure_detail_stays_in_the_log(w: Any) -> None:
    class LeakyCtx(ChatCtx):
        def ask_choice(self, question: str, choices: list) -> str | None:
            self.asked.append((question, list(choices)))
            raise OSError(SECRET_DETAIL)

    stale_scan(w)
    out = run(LeakyCtx(), "faxina", source=src("dm"), platform="telegram")
    assert "/Users" not in out and "no such table" not in out
    assert queue_rows(w) == []


def test_tube_error_message_is_shown(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a: Any, **k: Any) -> Any:
        raise T.Conflict("the video changed")

    monkeypatch.setattr(w.video_state, "set_state", boom)
    out = run(ChatCtx().script_choices("visto"), "triar", source=src("dm"), platform="telegram")
    assert "the video changed" in out


def test_err_helper() -> None:
    assert commands._err(T.NotFound("gone"), "en") == "gone"
    assert commands._err(T.TubeError(), "en") == "error"
    assert commands._err(KeyError(SECRET_DETAIL), "en") == commands._t("en", "internal")
    assert commands._err(ValueError("x"), "pt") == commands._t("pt", "internal")


# =========================================================================== typed answers


class TypedCtx(ChatCtx):
    """Maps a typed reply like Hermes does: a number picks the option at that position
    (``tools/clarify_gateway``), a value or label in any case picks that option
    (``hermes_cli/plugin_choices``); anything else is ``None``."""

    def ask_choice(self, question: str, choices: list) -> str | None:
        self.asked.append((question, list(choices)))
        if not self.choice_script:
            return None
        typed = str(self.choice_script.popleft()).strip()
        if typed.isdigit() and 0 < int(typed) <= len(choices):
            return str(choices[int(typed) - 1]["value"])
        key = typed.casefold()
        return next(
            (
                str(c["value"])
                for c in choices
                if key in (str(c["value"]).casefold(), str(c.get("label") or "").casefold())
            ),
            None,
        )


@pytest.mark.parametrize("typed", ["2", "1", "3"])
def test_cleanup_repeated_number_never_approves(w: Any, typed: str) -> None:
    stale_scan(w)
    ctx = TypedCtx().script_choices(*([typed] * 12))
    run(ctx, "faxina")
    assert queue_rows(w) == []


def test_cleanup_repeated_two_stops(w: Any) -> None:
    stale_scan(w)
    ctx = TypedCtx().script_choices("2", "2", "2")
    out = run(ctx, "cleanup")
    assert queue_rows(w) == [] and len(ctx.asked) == 2
    assert commands._t("en", "cleanup_stopped") in out


def test_cleanup_no_typed_text_satisfies_both_steps(w: Any) -> None:
    stale_scan(w)
    ctx = TypedCtx().script_choices("2", "1", "stop")
    run(ctx, "faxina")
    step1, step2 = ctx.asked[0][1], ctx.asked[1][1]
    candidates = {str(i) for i in range(1, 6)}
    for c in step1 + step2:
        candidates |= {str(c["value"]), str(c.get("label") or "")}
    for text in candidates:
        probe = TypedCtx().script_choices(text, text)
        first = probe.ask_choice("q1", step1)
        second = probe.ask_choice("q2", step2)
        assert not (first == "review" and str(second).startswith("approve-")), text


def test_cleanup_docstring_does_not_promise_typed_text_is_refused() -> None:
    doc = commands.__doc__ or ""
    assert "typed, ``None``" not in doc
    assert "typed" in doc and "number" in doc


# =========================================================================== shared chats


def src(chat_type: str) -> Any:
    """A ``SessionSource``-shaped object (only ``chat_type`` matters to ``/tube``)."""
    from types import SimpleNamespace

    return SimpleNamespace(chat_type=chat_type, platform="telegram", chat_id="-100", user_id="222")


class TrapCtx(ChatCtx):
    """A messaging ctx whose buttons and notices must never be used."""

    def ask_choice(self, question: str, choices: list) -> str | None:  # pragma: no cover
        raise AssertionError(f"asked in a shared chat: {question!r}")

    def post_message(self, text: str) -> Any:  # pragma: no cover
        raise AssertionError(f"posted in a shared chat: {text!r}")


SHARED_TYPES = ["group", "channel", "thread", "forum", "supergroup", "guild", "webhook", "x"]


@pytest.mark.parametrize("chat_type", SHARED_TYPES)
@pytest.mark.parametrize("args", [a for a in ALL_INVOCATIONS if a not in ("ajuda", "help")])
def test_shared_chat_shows_and_approves_nothing(w: Any, chat_type: str, args: str) -> None:
    stale_scan(w)
    ctx = TrapCtx()
    out = run(ctx, args, source=src(chat_type), platform="telegram")
    assert queue_rows(w) == [] and ctx.posted == []
    assert out in (commands._t("pt", "shared_chat"), commands._t("en", "shared_chat"))
    assert "\n" not in out
    for name in ("Nerdologia", "MKBHD", "Veritasium", "Fireship"):
        assert name.casefold() not in out.casefold()


def test_shared_chat_text_says_direct_chat(w: Any) -> None:
    out = run(TrapCtx(), "cleanup", source=src("group"), platform="telegram")
    assert out == commands._t("en", "shared_chat")
    assert "direct chat" in out and "/tube" in out
    assert "conversa direta" in commands._t("pt", "shared_chat")


@pytest.mark.parametrize("args", ["ajuda", "help"])
def test_shared_chat_help_still_answers(w: Any, args: str) -> None:
    out = run(TrapCtx(), args, source=src("group"), platform="telegram")
    assert "/tube" in out
    assert out.splitlines()[-1] in (
        commands._t("pt", "shared_chat"),
        commands._t("en", "shared_chat"),
    )


def test_shared_chat_routines_install_nothing(w: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    def trap(*a: Any, **k: Any) -> Any:  # pragma: no cover
        raise AssertionError("routines touched in a shared chat")

    monkeypatch.setattr(wiring, "get_routines", trap)
    monkeypatch.setattr(wiring, "get_themes", trap)
    monkeypatch.setattr(wiring, "get_cleanup", trap)
    for args in ("rotinas", "routines remove", "tema x", "faxina nova"):
        run(TrapCtx(), args, source=src("group"), platform="telegram")


@pytest.mark.parametrize("chat_type", ["dm", "DM", "private", "direct"])
def test_direct_chat_works_as_before(w: Any, chat_type: str) -> None:
    stale_scan(w)
    ctx = ChatCtx().script_choices(review, confirm, "parar")
    run(ctx, "faxina", source=src(chat_type), platform="telegram")
    assert len(ctx.asked) >= 2 and len(queue_rows(w)) >= 1


def test_messaging_without_source_fails_closed(w: Any) -> None:
    """The host said ``source=None`` on a messaging surface: treated as a shared chat."""
    stale_scan(w)
    out = run(TrapCtx(), "faxina", source=None, platform="telegram")
    assert out == commands._t("pt", "shared_chat") and queue_rows(w) == []
    out = run(TrapCtx(), "faxina", source=None)  # surface from ctx.session_surface()
    assert out == commands._t("pt", "shared_chat")


@pytest.mark.parametrize("surface", ["cli", "tui", "desktop", "local", ""])
def test_local_surfaces_without_source_keep_working(w: Any, surface: str) -> None:
    stale_scan(w)
    ctx = LocalCtx(surface)
    out = run(ctx, "faxina", source=None, platform=surface or None)
    assert out != commands._t("pt", "shared_chat") and ctx.asked == []
    assert "Nerdologia" in out  # the last scan as text, as before


def test_empty_chat_type_is_not_direct(w: Any) -> None:
    out = run(TrapCtx(), "", source=src(""), platform="telegram")
    assert out in (commands._t("pt", "shared_chat"), commands._t("en", "shared_chat"))


def _load_plugin(tag: str) -> Any:
    spec = importlib.util.spec_from_file_location(
        f"_tube_plugin_init_{tag}", Path(__file__).resolve().parents[1] / "plugin" / "__init__.py"
    )
    assert spec is not None and spec.loader is not None
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    return plugin


def test_command_wrapper_passes_source_and_platform_from_hermes(w: Any) -> None:
    """Hermes' own dispatcher hands the chat's ``source`` to ``/tube`` (Hermes >= 0.23.1)."""
    dispatch = pytest.importorskip("hermes_cli.plugin_command_dispatch")
    session = pytest.importorskip("gateway.session")
    config = pytest.importorskip("gateway.config")
    plugin = _load_plugin("sec_source")
    stale_scan(w)
    ctx = TrapCtx()
    plugin.register(ctx)
    handler = ctx.commands["tube"]["handler"]
    try:
        group = session.SessionSource(
            platform=config.Platform.TELEGRAM, chat_id="-100", chat_type="group", user_id="222"
        )
        out = dispatch.invoke_plugin_command(
            handler, "faxina", source=group, session_id="s", session_key="k", platform="telegram"
        )
        assert out == commands._t("pt", "shared_chat") and queue_rows(w) == []
        # a Telegram private chat arrives as "dm" (the SessionSource default too)
        dm = session.SessionSource(platform=config.Platform.TELEGRAM, chat_id="111")
        assert dm.chat_type == "dm"
        chat = ChatCtx().script_choices(review, confirm, "parar")
        plugin2 = _load_plugin("sec_source_dm")
        plugin2.register(chat)
        out = dispatch.invoke_plugin_command(
            chat.commands["tube"]["handler"],
            "faxina",
            source=dm,
            session_id="s",
            session_key="k",
            platform="telegram",
        )
        assert len(chat.asked) >= 2 and len(queue_rows(w)) >= 1
        for cb in chat.unload_callbacks:
            cb()
    finally:
        for cb in ctx.unload_callbacks:
            cb()


def test_telegram_private_chat_maps_to_dm() -> None:
    adapter = pytest.importorskip("plugins.platforms.telegram.adapter")
    norm = adapter.TelegramAdapter._normalize_chat_type
    assert norm("private", is_forum=False) == "dm"
    assert norm("supergroup", is_forum=False) not in commands.DIRECT_CHAT_TYPES
    assert norm("supergroup", is_forum=True) not in commands.DIRECT_CHAT_TYPES
    assert norm("channel", is_forum=False) not in commands.DIRECT_CHAT_TYPES


# --------------------------------------------------------------------------- test utilities


def test_helpers_sanity() -> None:
    assert value_of([{"value": "a", "label": "Confirmar (2)"}], "confirmar") == "a"
    raw = RawCtx().script_choices("x")
    assert raw.ask_choice("q", [{"value": "y", "label": "y"}]) == "x"
    assert isinstance(raw.choice_script, deque)
    assert Path(commands.__file__).name == "commands.py"


# --------------------------------------------------------------- routines: one model hint


def _real_routines(tmp_path: Path, wire: Any) -> Any:
    """The real installer over a throwaway profile and an in-memory cron (as in test_routines)."""
    from test_routines import FakeCron, _ctx, _make_home

    from tube_pkg.routines import installer as installer_mod

    inst = installer_mod.build(
        settings=FakeSettings(), ctx=_ctx(FakeCron()), home=_make_home(tmp_path)
    )
    wire.set("routines", inst)
    return inst


@pytest.mark.parametrize(
    ("words", "hint"),
    [
        ("routines", "hermes cron edit <id> --model <model>"),
        ("rotinas", "hermes cron edit <id> --model <modelo>"),
    ],
)
def test_routines_install_gives_the_model_hint_once_in_ascii(
    w: Any, tmp_path: Path, wire: Any, words: str, hint: str
) -> None:
    _real_routines(tmp_path, wire)
    out = run(ChatCtx().script_choices("install"), words)
    assert out.count("cron edit") == 1, out
    assert hint in out, out
    assert "\u2039" not in out and "\u203a" not in out, out


def test_routines_without_an_agent_routine_have_no_model_hint(
    w: Any, tmp_path: Path, wire: Any
) -> None:
    _real_routines(tmp_path, wire)
    out = run(ChatCtx().script_choices("install"), "routines bom-dia favoritos")
    assert "cron edit" not in out, out
