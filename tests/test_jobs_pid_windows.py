"""``core.jobs.pid_alive`` on Windows, without Windows: the kernel32 calls go through a small
interface that the tests replace. A job whose process died must read as abandoned there too."""

from __future__ import annotations

import os
import time
from typing import Any

import pytest

from tube_pkg.core import jobs


class FakeKernel:
    """Answers like ``OpenProcess``, ``GetLastError``, ``GetExitCodeProcess``, ``CloseHandle``."""

    def __init__(self, *, handle: int | None = 7, error: int = 0, code: int | None = 259) -> None:
        self.handle, self.error, self.code = handle, error, code
        self.opened: list[int] = []
        self.closed: list[int] = []

    def open(self, pid: int) -> int | None:
        self.opened.append(pid)
        return self.handle

    def last_error(self) -> int:
        return self.error

    def exit_code(self, handle: int) -> int | None:
        return self.code

    def close(self, handle: int) -> None:
        self.closed.append(handle)


def test_running_process_is_alive_and_the_handle_is_closed() -> None:
    k = FakeKernel(code=jobs.WIN_STILL_ACTIVE)
    assert jobs._windows_pid_alive(4242, kernel=k) is True
    assert k.opened == [4242] and k.closed == [7]


def test_exited_process_is_dead_and_the_handle_is_closed() -> None:
    k = FakeKernel(code=0)
    assert jobs._windows_pid_alive(4242, kernel=k) is False
    assert k.closed == [7]


def test_no_such_process_is_dead() -> None:
    k = FakeKernel(handle=None, error=jobs.WIN_ERROR_INVALID_PARAMETER)
    assert jobs._windows_pid_alive(4242, kernel=k) is False


def test_access_denied_means_it_exists() -> None:
    k = FakeKernel(handle=None, error=jobs.WIN_ERROR_ACCESS_DENIED)
    assert jobs._windows_pid_alive(4242, kernel=k) is True


@pytest.mark.parametrize("kernel", [FakeKernel(code=None), FakeKernel(handle=None, error=31)])
def test_unsure_answers_count_as_alive(kernel: Any) -> None:
    assert jobs._windows_pid_alive(4242, kernel=kernel) is True


def test_without_kernel32_it_stays_on_the_safe_side(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken() -> Any:
        raise OSError("no kernel32 here")

    monkeypatch.setattr(jobs, "_win_kernel", broken)
    assert jobs._windows_pid_alive(4242) is True


def test_pid_alive_on_windows_asks_kernel32_not_os_kill(monkeypatch: pytest.MonkeyPatch) -> None:
    k = FakeKernel(handle=None, error=jobs.WIN_ERROR_INVALID_PARAMETER)
    monkeypatch.setattr(jobs, "_IS_WINDOWS", True)
    monkeypatch.setattr(jobs, "_win_kernel", lambda: k)

    def no_kill(*_a: Any) -> None:
        raise AssertionError("os.kill terminates the process on Windows")

    monkeypatch.setattr(jobs.os, "kill", no_kill)
    assert jobs.pid_alive(4242) is False
    assert k.opened == [4242]
    assert jobs.pid_alive(0) is False


def test_dead_owner_on_windows_closes_the_job_as_orphan(
    db: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Through the real runner: a running job of another, dead process is closed on read
    (before, on Windows, it stayed "running" until the inactivity deadline)."""
    from fakes import FakeEventSink, FakeSettings

    monkeypatch.setattr(jobs, "_IS_WINDOWS", True)
    monkeypatch.setattr(
        jobs, "_win_kernel", lambda: FakeKernel(handle=None, error=jobs.WIN_ERROR_INVALID_PARAMETER)
    )
    runner = jobs.build(db=db, settings=FakeSettings(), events=FakeEventSink())
    job_id = f"job_{os.getpid() + 100_000}_abcdef012345"
    now = int(time.time())
    db.execute(
        "INSERT INTO jobs (id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (job_id, "organize", "running", now, now),
    )
    job = runner.get(job_id)
    assert job is not None and job.status.value == "error"
    assert job.error and job.error["message"] == jobs.ORPHAN_MESSAGE
