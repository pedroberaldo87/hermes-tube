"""Favoritos: one message per video, delivered directly through ``hermes send`` when possible.

No network and no real ``hermes``: the subprocess runner and ``shutil.which`` of
``routines.deliver`` are replaced by fakes, and the HTTP client by ``FakeHttp``. The fallback
contract is the runner's: whatever was not delivered directly is printed on stdout.
"""

from __future__ import annotations

import importlib
import json
import re
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from test_routine_covers import JPEG, FakeHttp, _home, _resolved
from test_routines import _seed, _sql

from tube_pkg._id import PLUGIN_ID

deliver = importlib.import_module("tube_pkg.routines.deliver")
runner = importlib.import_module("tube_pkg.routines.runner")
compose = importlib.import_module("tube_pkg.routines.compose")
cover = importlib.import_module("tube_pkg.routines.cover")

EXE = "/fake/bin/hermes"
CHAT = "424242424"
STAR = "\u2b50"
PLAY = "\u25b6\ufe0f"
VID = "abcdefghijk"


@pytest.fixture(autouse=True)
def _direct_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(deliver.DISABLE_ENV, raising=False)
    monkeypatch.delenv(cover.DISABLE_ENV, raising=False)


# =========================================================================== fakes


class FakeSend:
    """Stands for ``subprocess.run``: answers from a script, records every call."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.calls: list[tuple[list[str], str, dict[str, Any]]] = []

    def __call__(self, argv: list[str], **kwargs: Any) -> Any:
        self.calls.append((list(argv), kwargs.pop("input").decode("utf-8"), kwargs))
        answer = self.answers.pop(0) if self.answers else _good()
        if isinstance(answer, BaseException):
            raise answer
        return answer


def _good() -> Any:
    return subprocess.CompletedProcess([], 0, b'{"success": true, "message_id": "7"}', b"")


def _proc(code: int, out: bytes) -> Any:
    return subprocess.CompletedProcess([], code, out, b"")


def _jobs(home: Path, *jobs: Any, raw: str | None = None) -> None:
    folder = home / "cron"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "jobs.json").write_text(raw if raw is not None else json.dumps({"jobs": list(jobs)}))


def _job(
    chat: Any = CHAT,
    *,
    thread: Any = None,
    deliver_: Any = "origin",
    platform: Any = "telegram",
    name: str | None = None,
) -> dict[str, Any]:
    return {
        "name": name or deliver.job_name("favoritos"),
        "deliver": deliver_,
        "origin": {"platform": platform, "chat_id": chat, "thread_id": thread},
    }


def _go(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    home: Path,
    send: Any,
    *,
    exe: str | None = EXE,
    http: Any = None,
    key: str = "favoritos",
) -> tuple[str, str]:
    original = runner._open_env
    fake_http = FakeHttp() if http is None else http

    def open_env(*args: Any) -> Any:
        env = original(*args)
        env.graph._items["http"] = fake_http
        return env

    monkeypatch.setattr(runner, "_open_env", open_env)
    monkeypatch.setattr(deliver, "_run", send)
    monkeypatch.setattr(deliver, "_which", lambda _name: exe)
    capsys.readouterr()
    assert runner.run(key, _resolved(home)) == 0
    got = capsys.readouterr()
    return got.out, got.err


def _mark(home: Path) -> int | None:
    rows = _sql(home, "SELECT value FROM meta WHERE key = ?", ("routine.favoritos.mark",))
    return int(rows[0][0]) if rows else None


def _fresh_world(tmp_path: Path, name: str = "p1", *, target: bool = True) -> Path:
    home = _home(tmp_path, name)
    _seed(home)
    if target:
        _jobs(home, _job())
    return home


def _baseline(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: Any) -> str:
    """What the same run prints when direct delivery is off."""
    home = _fresh_world(tmp_path, "base")
    monkeypatch.setenv(deliver.DISABLE_ENV, "1")
    out, _ = _go(monkeypatch, capsys, home, FakeSend())
    monkeypatch.delenv(deliver.DISABLE_ENV)
    return out


def _env(lang: str = "en") -> Any:
    return SimpleNamespace(t=lambda pt, en: pt if lang == "pt-BR" else en)


def _item(channel: str, title: str, vid: str = VID) -> Any:
    return SimpleNamespace(
        channel=SimpleNamespace(title=channel),
        video=SimpleNamespace(id=vid, title=title, channel_title=channel),
    )


# =========================================================================== format


@pytest.mark.parametrize(
    ("lang", "head"), [("en", "New from"), ("pt-BR", "Novo de")], ids=["en", "pt-BR"]
)
@pytest.mark.parametrize("with_cover", [True, False], ids=["cover", "no-cover"])
def test_card_format_is_the_approved_one_byte_for_byte(
    tmp_path: Path, lang: str, head: str, with_cover: bool
) -> None:
    img = tmp_path / f"{VID}.jpg"
    img.write_bytes(JPEG)
    card = compose.fav_card(
        _env(lang), _item("Fireship", "Bun in 100 seconds"), str(img) if with_cover else None
    )
    expected = f"{STAR} **{head} Fireship**\nBun in 100 seconds\n\n{PLAY} https://youtu.be/{VID}"
    assert card.text == expected
    assert (
        STAR == "\u2b50" and PLAY == "\u25b6\ufe0f" and PLAY.encode() == b"\xe2\x96\xb6\xef\xb8\x8f"
    )
    sent = deliver.message_text(card)
    assert sent == (expected + f"\nMEDIA:{img}" if with_cover else expected)
    assert not sent.startswith("\n") and sent.splitlines()[2] == ""


def test_missing_cover_file_means_no_media_line(tmp_path: Path) -> None:
    card = deliver.Card("hello", str(tmp_path / "gone.jpg"))
    assert deliver.message_text(card) == "hello"
    assert deliver.message_text(deliver.Card("hello", "relative.jpg")) == "hello"
    assert (
        deliver.message_text(deliver.Card("hello", f"{tmp_path}/a\nMEDIA:/etc/passwd")) == "hello"
    )


NASTY = [
    "a*b*c",
    "**bold**",
    "***",
    "a\\*b",
    "[x](https://evil.example)",
    "[[as_document]]",
    "~~strike~~",
    "||spoiler||",
    "<b>bold</b>",
    "<a href='https://evil.example'>x</a>",
    "MEDIA:/etc/passwd.png",
    "[[audio_as_voice]] media:/tmp/x.jpg",
    "# header",
    "> quote",
    "`code` ```fence",
]


@pytest.mark.parametrize("raw", NASTY)
def test_nasty_text_comes_out_literal(raw: str) -> None:
    safe = compose.telegram_safe(compose.line(raw))
    assert "*" not in safe and "](" not in safe and "[[" not in safe and "`" not in safe
    assert "~~" not in safe and "||" not in safe
    assert not re.search(r"<\/?[A-Za-z]", safe)
    assert not re.search(r"(?i)media:", safe)
    assert not re.match(r"[#>]", safe)


def test_harmless_text_is_untouched() -> None:
    for plain in (
        "Plain title",
        "snake_case_name",
        "AT&T | 50% off ($5)",
        "a ~ b | c [4K] (HD)",
        "Ação, café — 日本語 🎉",
    ):
        assert compose.telegram_safe(plain) == plain


@pytest.mark.parametrize("raw", [n for n in NASTY if "`" not in n])
def test_nasty_channel_name_drops_bold_and_title_is_neutral(raw: str) -> None:
    card = compose.fav_card(_env(), _item(raw, raw), None)
    head, title, blank, link = card.text.split("\n")
    assert "**" not in card.text and "*" not in card.text
    assert (
        head.startswith(f"{STAR} New from ")
        and blank == ""
        and link == f"{PLAY} https://youtu.be/{VID}"
    )
    assert title == compose.telegram_safe(compose.line(raw, 90))


def test_clean_channel_name_keeps_bold_even_with_underscores_and_brackets() -> None:
    card = compose.fav_card(_env(), _item("Dr_Who [HD] (live)", "x"), None)
    assert card.text.startswith(f"{STAR} **New from Dr_Who [HD] (live)**\n")


def test_newlines_and_controls_are_stripped_from_names_and_titles() -> None:
    card = compose.fav_card(_env(), _item("Chan\nnel\r\nX", "Tit\nle\u2028two\x00three"), None)
    lines = card.text.split("\n")
    assert len(lines) == 4
    assert lines[0] == f"{STAR} **New from Chan nel X**" and lines[1] == "Tit le two three"


# =========================================================================== target


def _target(tmp_path: Path, *jobs: Any, raw: str | None = None) -> str | None:
    home = _home(tmp_path, f"t{len(list((tmp_path / 'profiles').glob('t*')))}")
    if jobs or raw is not None:
        _jobs(home, *jobs, raw=raw)
    return deliver.resolve_target(home)


def test_target_plain_chat(tmp_path: Path) -> None:
    assert _target(tmp_path, _job()) == f"telegram:{CHAT}"


def test_target_negative_chat_and_thread(tmp_path: Path) -> None:
    assert _target(tmp_path, _job("-1001234567890", thread="77")) == "telegram:-1001234567890:77"
    assert _target(tmp_path, _job(CHAT, thread=5)) == f"telegram:{CHAT}:5"
    assert _target(tmp_path, _job(CHAT, thread="")) == f"telegram:{CHAT}"


def test_target_picks_the_job_by_name(tmp_path: Path) -> None:
    other = _job("111", name=deliver.job_name("bom-dia"))
    assert _target(tmp_path, other, _job("222")) == "telegram:222"
    assert _target(tmp_path, other) is None


@pytest.mark.parametrize(
    "job",
    [
        _job(deliver_="local"),
        _job(deliver_="telegram"),
        _job(deliver_=None),
        _job(platform="discord"),
        _job(platform=None),
        _job(""),
        _job(None),
        _job(424242),
        _job("12 34"),
        _job("12\n34"),
        _job("+123"),
        _job("1-2"),
        _job("--5"),
        _job("@channel"),
        _job("123;rm -rf /"),
        _job("12３４"),
        _job(CHAT, thread="abc"),
        _job(CHAT, thread="-1"),
        _job(CHAT, thread="1:2"),
        _job(CHAT, thread=True),
        _job(CHAT, thread=-3),
        _job(CHAT, thread=[1]),
        {"name": deliver.job_name("favoritos"), "deliver": "origin"},
        {"name": deliver.job_name("favoritos"), "deliver": "origin", "origin": "x"},
    ],
    ids=lambda j: json.dumps(j)[:60],
)
def test_target_rejects_other_shapes(tmp_path: Path, job: Any) -> None:
    assert _target(tmp_path, job) is None


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "not json",
        "[1, 2",
        "null",
        "[]",
        '{"jobs": 5}',
        '{"jobs": [1, null, "x"]}',
        '{"jobs": {"a": 1}}',
    ],
)
def test_target_survives_garbage_files(tmp_path: Path, raw: str) -> None:
    assert _target(tmp_path, raw=raw) is None


def test_target_missing_file_or_folder(tmp_path: Path) -> None:
    assert deliver.resolve_target(_home(tmp_path, "none")) is None
    assert deliver.resolve_target(tmp_path / "does" / "not" / "exist") is None


def test_target_refuses_two_jobs_that_disagree(tmp_path: Path) -> None:
    assert _target(tmp_path, _job("111"), _job("222")) is None
    assert _target(tmp_path, _job("111"), _job("111")) == "telegram:111"


def test_target_ignores_a_huge_file(tmp_path: Path) -> None:
    home = _home(tmp_path, "big")
    _jobs(home, raw=" " * (deliver.MAX_JOBS_BYTES + 1))
    assert deliver.resolve_target(home) is None


def test_target_is_read_only(tmp_path: Path) -> None:
    home = _home(tmp_path, "ro")
    _jobs(home, _job())
    path = home / "cron" / "jobs.json"
    before = (path.read_bytes(), path.stat().st_mtime_ns)
    deliver.resolve_target(home)
    assert (path.read_bytes(), path.stat().st_mtime_ns) == before


# =========================================================================== direct delivery


def test_success_sends_one_message_per_video_and_prints_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    base = _baseline(tmp_path, monkeypatch, capsys)
    assert base.strip()
    expected_ids = re.findall(r"https://youtu\.be/([A-Za-z0-9_-]{11})", base)
    assert len(expected_ids) >= 2
    home = _fresh_world(tmp_path)
    send = FakeSend()
    out, err = _go(monkeypatch, capsys, home, send)
    assert out == ""
    assert len(send.calls) == len(expected_ids)
    assert _mark(home) is not None
    folder = home / "plugin-data" / PLUGIN_ID / "covers"
    for (argv, message, kwargs), vid in zip(send.calls, expected_ids, strict=True):
        assert argv == [EXE, "send", "--to", f"telegram:{CHAT}", "--json"]
        assert kwargs["shell"] is False and kwargs["env"]["HERMES_HOME"] == str(home)
        assert 0 < kwargs["timeout"] <= deliver.PER_MESSAGE_TIMEOUT_S
        assert kwargs["capture_output"] is True
        lines = message.split("\n")
        assert lines[0].startswith(f"{STAR} **New from ") and lines[0].endswith("**")
        assert lines[2] == "" and lines[3] == f"{PLAY} https://youtu.be/{vid}"
        assert lines[-1] == f"MEDIA:{folder / (vid + '.jpg')}"
        assert not any(message in a or "MEDIA" in a for a in argv)
    assert CHAT not in err


def test_more_line_goes_on_the_last_message_after_an_empty_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _fresh_world(tmp_path)
    total = len(re.findall("youtu.be", _baseline(tmp_path, monkeypatch, capsys)))
    monkeypatch.setattr(compose, "FAV_MAX_ITEMS", 2)
    send = FakeSend()
    out, _ = _go(monkeypatch, capsys, home, send)
    assert out == "" and len(send.calls) == 2
    first, last = send.calls[0][1], send.calls[1][1]
    assert "/tube triage" not in first
    rest = total - 2
    assert rest >= 1
    link, more, media = last.split("\n")[-4], last.split("\n")[-2], last.split("\n")[-1]
    assert link.startswith(PLAY) and last.split("\n")[-3] == ""
    assert more == f"+{rest} more — /tube triage" and media.startswith("MEDIA:")


def test_more_line_in_portuguese(tmp_path: Path) -> None:
    card = compose.fav_card(_env("pt-BR"), _item("Canal", "Título"), None)
    assert card.text.startswith(f"{STAR} **Novo de Canal**\nTítulo\n\n{PLAY} ")


def test_no_cover_sends_the_same_message_without_the_media_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _fresh_world(tmp_path)
    send = FakeSend()
    out, _ = _go(monkeypatch, capsys, home, send, http=FakeHttp(default=(404, b"x" * 3000)))
    assert out == "" and send.calls
    assert all("MEDIA:" not in m and m.endswith(m.split("\n")[3]) for _, m, _ in send.calls)
    assert all(len(m.split("\n")) == 4 or "/tube triage" in m for _, m, _ in send.calls)


def test_switch_turns_direct_delivery_off(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _fresh_world(tmp_path)
    monkeypatch.setenv(deliver.DISABLE_ENV, "1")
    send = FakeSend()
    out, _ = _go(monkeypatch, capsys, home, send)
    assert send.calls == [] and out.startswith(f"{STAR} **New from ")


@pytest.mark.parametrize(
    "setup",
    ["no jobs file", "other platform", "deliver local", "bad chat id", "garbage json"],
)
def test_no_target_means_stdout_and_no_subprocess(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], setup: str
) -> None:
    base = _baseline(tmp_path, monkeypatch, capsys)
    home = _fresh_world(tmp_path, "x", target=False)
    if setup == "other platform":
        _jobs(home, _job(platform="discord"))
    elif setup == "deliver local":
        _jobs(home, _job(deliver_="local"))
    elif setup == "bad chat id":
        _jobs(home, _job("12 34; ls"))
    elif setup == "garbage json":
        _jobs(home, raw="{{{")
    send = FakeSend()
    out, _ = _go(monkeypatch, capsys, home, send)
    assert send.calls == [] and out == base.replace(str(tmp_path / "profiles" / "base"), str(home))


FAILURES: dict[str, Any] = {
    "exit code 1": _proc(1, b'{"success": true}'),
    "success false": _proc(0, b'{"success": false, "error": "no"}'),
    "success missing": _proc(0, b"{}"),
    "success is a string": _proc(0, b'{"success": "true"}'),
    "not json": _proc(0, b"sent!"),
    "empty output": _proc(0, b""),
    "json list": _proc(0, b"[true]"),
    "timeout": subprocess.TimeoutExpired([EXE], 40),
    "os error": OSError("no such file"),
    "runtime error": RuntimeError("boom"),
}


@pytest.mark.parametrize("mode", list(FAILURES))
def test_every_failure_falls_back_to_the_stdout_the_cron_delivers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], mode: str
) -> None:
    base = _baseline(tmp_path, monkeypatch, capsys)
    home = _fresh_world(tmp_path)
    send = FakeSend(FAILURES[mode])
    out, err = _go(monkeypatch, capsys, home, send)
    assert len(send.calls) == 1  # the first failure stops direct delivery
    assert out == base.replace(str(tmp_path / "profiles" / "base"), str(home))
    assert _mark(home) is not None
    assert CHAT not in err and "New from" not in err and "youtu" not in err


def test_missing_hermes_executable_falls_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    base = _baseline(tmp_path, monkeypatch, capsys)
    home = _fresh_world(tmp_path)
    send = FakeSend()
    out, err = _go(monkeypatch, capsys, home, send, exe=None)
    assert send.calls == [] and out == base.replace(str(tmp_path / "profiles" / "base"), str(home))
    assert "hermes command was not found" in err and CHAT not in err


def test_partial_success_prints_only_what_was_not_delivered(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    base = _baseline(tmp_path, monkeypatch, capsys)
    ids = re.findall(r"https://youtu\.be/([A-Za-z0-9_-]{11})", base)
    home = _fresh_world(tmp_path)
    send = FakeSend(_good(), _proc(1, b""))
    out, _ = _go(monkeypatch, capsys, home, send)
    assert len(send.calls) == 2  # stopped at the failure; the rest is printed
    assert ids[0] not in out and ids[1] in out
    lines = out.splitlines()
    media = [x for x in lines if x.startswith("MEDIA:")]
    assert len(media) == len(ids) - 1 and lines[-len(media) :] == media
    assert all(ids[0] not in x for x in media)
    assert _mark(home) is not None


def test_marks_are_saved_before_the_first_message_is_sent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _fresh_world(tmp_path)
    seen: list[int | None] = []

    def probe(argv: list[str], **kwargs: Any) -> Any:
        seen.append(_mark(home))
        return _good()

    _go(monkeypatch, capsys, home, probe)
    assert seen and all(m is not None for m in seen)


def test_fixed_argument_list_and_message_only_on_stdin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    img = tmp_path / "c.jpg"
    img.write_bytes(JPEG)
    home = _home(tmp_path, "args")
    _jobs(home, _job("-100555", thread="9"))
    send = FakeSend()
    monkeypatch.setattr(deliver, "_which", lambda _n: EXE)
    n = deliver.send_cards([deliver.Card("Ünï ⭐ *x*", str(img))], home, run=send)
    assert n == 1
    argv, message, kwargs = send.calls[0]
    assert argv == [EXE, "send", "--to", "telegram:-100555:9", "--json"]
    assert message == f"Ünï ⭐ *x*\nMEDIA:{img}"
    assert kwargs["shell"] is False and kwargs["check"] is False
    assert kwargs["env"]["HERMES_HOME"] == str(home)
    assert "input" not in kwargs  # popped by the fake; the real call passes bytes
    assert not any("Ünï" in a or "MEDIA" in a for a in argv)


def test_real_call_passes_utf8_bytes_on_stdin(tmp_path: Path) -> None:
    seen: dict[str, Any] = {}

    def run(argv: list[str], **kwargs: Any) -> Any:
        seen.update(kwargs)
        return _good()

    home = _home(tmp_path, "bytes")
    _jobs(home, _job())
    deliver.send_cards([deliver.Card("é⭐")], home, run=run, which=lambda _n: EXE)
    assert seen["input"] == "é⭐".encode()


def test_total_budget_stops_further_messages(tmp_path: Path) -> None:
    home = _home(tmp_path, "budget")
    _jobs(home, _job())
    ticks = iter([0.0, 10.0, 70.0, 80.0])
    send = FakeSend()
    notes: list[str] = []
    sent = deliver.send_cards(
        [deliver.Card("a"), deliver.Card("b"), deliver.Card("c")],
        home,
        run=send,
        which=lambda _n: EXE,
        clock=lambda: next(ticks),
        note=notes.append,
    )
    assert sent == 2 and len(send.calls) == 2
    assert [c[2]["timeout"] for c in send.calls] == [40.0, 5.0]
    assert notes == ["direct delivery stopped: time budget used up"]


def test_per_message_timeout_is_capped_at_40_seconds(tmp_path: Path) -> None:
    home = _home(tmp_path, "cap")
    _jobs(home, _job())
    send = FakeSend()
    deliver.send_cards([deliver.Card("a")], home, run=send, which=lambda _n: EXE)
    assert [c[2]["timeout"] for c in send.calls] == [40.0]
    assert deliver.TOTAL_BUDGET_S == 75.0


def test_notes_never_carry_the_message_or_the_chat(tmp_path: Path) -> None:
    home = _home(tmp_path, "notes")
    _jobs(home, _job())
    notes: list[str] = []
    for answer in (
        _proc(3, b"secret body"),
        OSError("path /x/y"),
        subprocess.TimeoutExpired("x", 1),
    ):
        deliver.send_cards(
            [deliver.Card("SECRET TITLE")],
            home,
            run=FakeSend(answer),
            which=lambda _n: EXE,
            note=notes.append,
        )
    assert len(notes) == 3 and all(n.startswith("direct delivery failed") for n in notes)
    assert not any(CHAT in n or "SECRET" in n or "secret" in n for n in notes)


# =========================================================================== runner seam


def _fake_composer(monkeypatch: pytest.MonkeyPatch, outcome: Any) -> None:
    monkeypatch.setitem(compose.COMPOSERS, "favoritos", lambda env: outcome)


def test_runner_prints_remaining_cards_then_their_media_lines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    a, b = home / "a.jpg", home / "b.jpg"
    a.write_bytes(JPEG)
    b.write_bytes(JPEG)
    cards = (deliver.Card("one", str(a)), deliver.Card("two", str(b)), deliver.Card("three"))
    _fake_composer(monkeypatch, runner.Outcome("one\n\ntwo\n\nthree", cards=cards))
    out, _ = _go(monkeypatch, capsys, home, FakeSend(_proc(1, b"")), exe=None)
    assert out == f"one\n\ntwo\n\nthree\nMEDIA:{a}\nMEDIA:{b}\n"
    out, _ = _go(monkeypatch, capsys, home, FakeSend(_good(), _proc(1, b"")), exe=EXE)
    assert out == f"one\n\ntwo\n\nthree\nMEDIA:{a}\nMEDIA:{b}\n"  # no target in this profile


def test_runner_all_delivered_is_silent_and_partial_prints_the_tail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    _jobs(home, _job())
    a, b = home / "a.jpg", home / "b.jpg"
    a.write_bytes(JPEG)
    b.write_bytes(JPEG)
    cards = (deliver.Card("one", str(a)), deliver.Card("two", str(b)))
    _fake_composer(monkeypatch, runner.Outcome("one\n\ntwo", cards=cards))
    send = FakeSend()
    out, _ = _go(monkeypatch, capsys, home, send)
    assert out == "" and [c[1] for c in send.calls] == [f"one\nMEDIA:{a}", f"two\nMEDIA:{b}"]
    send = FakeSend(_good(), subprocess.TimeoutExpired("x", 1))
    out, _ = _go(monkeypatch, capsys, home, send)
    assert out == f"two\nMEDIA:{b}\n"


def test_runner_survives_a_crashing_sender(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _home(tmp_path)
    _seed(home)
    _fake_composer(monkeypatch, runner.Outcome("one", cards=(deliver.Card("one"),)))

    def boom(*args: Any, **kwargs: Any) -> int:
        raise RuntimeError("bug")

    monkeypatch.setattr(deliver, "send_cards", boom)
    out, err = _go(monkeypatch, capsys, home, FakeSend())
    assert out == "one\n" and "direct delivery failed (RuntimeError)" in err


def test_silence_sends_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _fresh_world(tmp_path)
    _go(monkeypatch, capsys, home, FakeSend())
    send = FakeSend()
    out, _ = _go(monkeypatch, capsys, home, send)
    assert out == "" and send.calls == []


# =========================================================================== bom-dia and the others


def test_bom_dia_is_text_only_and_never_uses_cards(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    home = _fresh_world(tmp_path)
    send = FakeSend()
    http = FakeHttp()
    out, _ = _go(monkeypatch, capsys, home, send, key="bom-dia", http=http)
    assert send.calls == [] and http.urls == [] and out.strip() and "MEDIA:" not in out
    assert not (home / "plugin-data" / PLUGIN_ID / "covers").exists()
    for key in ("bom-dia", "resumo-pasta", "faxina-mensal", "pasta-novos"):
        assert not hasattr(compose.COMPOSERS[key], "cards")
    assert set(runner.Outcome.__dataclass_fields__) == {"text", "marks", "media", "cards"}


def test_real_subprocess_with_a_fake_hermes_script(tmp_path: Path) -> None:
    """The real ``subprocess.run`` call: argv, stdin bytes, HERMES_HOME and the JSON check."""
    import os
    import sys

    log = tmp_path / "log.json"
    script = tmp_path / "hermes"
    script.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        f"json.dump({{'argv': sys.argv[1:], 'stdin': sys.stdin.buffer.read().decode('utf-8'),"
        f" 'home': os.environ.get('HERMES_HOME')}}, open({str(log)!r}, 'w'))\n"
        "print(json.dumps({'success': True}))\n"
    )
    script.chmod(0o755)
    home = _home(tmp_path, "real")
    _jobs(home, _job("-1009", thread="3"))
    sent = deliver.send_cards([deliver.Card("Olá ⭐ **x**")], home, which=lambda _n: str(script))
    seen = json.loads(log.read_text())
    assert sent == 1 and os.access(script, os.X_OK)
    assert seen == {
        "argv": ["send", "--to", "telegram:-1009:3", "--json"],
        "stdin": "Olá ⭐ **x**",
        "home": str(home),
    }
    script.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(3)\n")
    assert deliver.send_cards([deliver.Card("x")], home, which=lambda _n: str(script)) == 0
