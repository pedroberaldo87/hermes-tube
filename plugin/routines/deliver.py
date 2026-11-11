"""Direct delivery of routine cards through the public ``hermes send`` command.

The Hermes cron delivers a script's stdout as a text message followed by a separate photo, wrapped
in a header and footer. For the ``favoritos`` routine the owner wants one photo bubble per video
with the text as its caption. ``hermes send --to telegram:<chat> --json`` does exactly that when
the message (read from stdin) ends with a ``MEDIA:<absolute path>`` line. This module runs it.

Rules:

- **Target.** Read only from the profile's own ``cron/jobs.json``: the job named like the routine
  (``catalog.job_name``) must have ``deliver == "origin"`` and an ``origin`` on ``telegram`` with a
  chat id that is digits with an optional leading minus (and, when set, a numeric thread id).
  Any other shape, file or platform means "no direct target". The id is never logged.
- **Command.** ``[hermes, "send", "--to", target, "--json"]``, fixed, ``shell=False``, the message
  as UTF-8 on stdin (never in the argument list), ``HERMES_HOME`` set to the profile home, stdout
  and stderr captured and never echoed. 40 s per message, 75 s for the whole run.
  Success is exit code 0 **and** a JSON object with ``"success": true`` on stdout.
- **Fallback.** The first failure of any kind (no executable, exit code, bad JSON, timeout, any
  exception) stops direct delivery. :func:`send_cards` returns how many cards (a prefix, in order)
  were delivered; the runner prints the rest on stdout for the cron. Nothing is sent twice by this
  module, but a timeout can leave a message that was delivered without confirmation.
- ``TUBE_NO_DIRECT_SEND=1`` turns it off (used by the subprocess tests).

The plugin never imports Hermes core, never calls the Bot API and never reads the bot token:
``hermes send`` owns the token.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tube_pkg.routines.catalog import job_name

DISABLE_ENV = "TUBE_NO_DIRECT_SEND"
PER_MESSAGE_TIMEOUT_S = 40.0
TOTAL_BUDGET_S = 75.0
MAX_JOBS_BYTES = 2 * 1024 * 1024

_CHAT_ID = re.compile(r"-?[0-9]+")
_THREAD_ID = re.compile(r"[0-9]+")


@dataclass(frozen=True)
class Card:
    """One message: text (no ``MEDIA:`` line) and the cover file that rides with it."""

    text: str
    media: str | None = None


def media_line(path: object) -> str | None:
    """``MEDIA:<path>`` for an absolute, single-line path of an existing file; else ``None``."""
    raw = str(path or "")
    if not raw or "\n" in raw or "\r" in raw or not Path(raw).is_absolute():
        return None
    return f"MEDIA:{raw}" if Path(raw).is_file() else None


def message_text(card: Card) -> str:
    """What ``hermes send`` reads: the text, then a final ``MEDIA:`` line when a cover exists."""
    line = media_line(card.media)
    return card.text if line is None else f"{card.text}\n{line}"


# =========================================================================== target


def _target_of(job: Any) -> str | None:
    if not isinstance(job, dict) or job.get("deliver") != "origin":
        return None
    origin = job.get("origin")
    if not isinstance(origin, dict) or origin.get("platform") != "telegram":
        return None
    chat = origin.get("chat_id")
    if not isinstance(chat, str) or not _CHAT_ID.fullmatch(chat):
        return None
    thread = origin.get("thread_id")
    if thread is None or thread == "":
        return f"telegram:{chat}"
    if isinstance(thread, bool):
        return None
    if isinstance(thread, int) and thread >= 0:
        thread = str(thread)
    if isinstance(thread, str) and _THREAD_ID.fullmatch(thread):
        return f"telegram:{chat}:{thread}"
    return None


def resolve_target(home: Path, key: str = "favoritos") -> str | None:
    """``telegram:CHAT[:THREAD]`` of the routine's cron job, or ``None`` (read-only, no raise)."""
    try:
        path = Path(home) / "cron" / "jobs.json"
        if not path.is_file() or path.stat().st_size > MAX_JOBS_BYTES:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        jobs = data.get("jobs") if isinstance(data, dict) else None
        if not isinstance(jobs, list):
            return None
        name = job_name(key)
        targets = {_target_of(j) for j in jobs if isinstance(j, dict) and j.get("name") == name}
        # two jobs with the same name and different places: do not guess
        return targets.pop() if len(targets) == 1 else None
    except Exception:  # noqa: BLE001 - no usable file means no direct target
        return None


# =========================================================================== send

Runner = Callable[..., Any]

_run: Runner = subprocess.run
_which: Callable[[str], str | None] = shutil.which
"""Seams for the tests (patched there); the real functions at run time."""


def _ok(proc: Any) -> bool:
    if getattr(proc, "returncode", None) != 0:
        return False
    out = getattr(proc, "stdout", b"")
    text = out.decode("utf-8", "replace") if isinstance(out, bytes) else str(out or "")
    try:
        data = json.loads(text)
    except ValueError:
        return False
    return isinstance(data, dict) and data.get("success") is True


def send_cards(
    cards: Sequence[Card],
    home: Path,
    *,
    key: str = "favoritos",
    note: Callable[[str], None] = lambda _msg: None,
    run: Runner | None = None,
    which: Callable[[str], str | None] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> int:
    """Send *cards* in order through ``hermes send``; returns how many were delivered.

    Stops at the first failure; the caller delivers ``cards[returned:]`` some other way.
    Reasons go to *note* (short, without the chat id or the message).
    """
    if not cards or os.environ.get(DISABLE_ENV) == "1":
        return 0
    target = resolve_target(home, key)
    if target is None:
        return 0
    exe = (which or _which)("hermes")
    if not exe:
        note("direct delivery skipped: the hermes command was not found")
        return 0
    argv = [exe, "send", "--to", target, "--json"]
    env = {**os.environ, "HERMES_HOME": str(home)}
    deadline = clock() + TOTAL_BUDGET_S
    sent = 0
    for card in cards:
        remaining = deadline - clock()
        if remaining < 1.0:
            note("direct delivery stopped: time budget used up")
            break
        try:
            proc = (run or _run)(
                argv,
                input=message_text(card).encode("utf-8"),
                capture_output=True,
                timeout=min(PER_MESSAGE_TIMEOUT_S, remaining),
                env=env,
                shell=False,
                check=False,
            )
            if not _ok(proc):
                note(f"direct delivery failed (exit {getattr(proc, 'returncode', '?')})")
                break
        except subprocess.TimeoutExpired:
            note("direct delivery failed (timeout)")
            break
        except Exception as exc:  # noqa: BLE001 - never lose the message: fall back to stdout
            note(f"direct delivery failed ({type(exc).__name__})")
            break
        sent += 1
    return sent


__all__ = ["DISABLE_ENV", "Card", "media_line", "message_text", "resolve_target", "send_cards"]
