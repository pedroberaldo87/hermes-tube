"""Native Windows: what used to be POSIX-only in the plugin, checked with the platform simulated.

No real Windows here: ``sys.platform`` is set to ``win32`` for the duration of a test, ``fcntl`` is
made unimportable and ``msvcrt`` is a fake that keeps byte-range locks in a table. Covered: the
portable file lock of the extension server (exclusive, non-blocking, released by ``release``),
the server module importing without ``fcntl``, port probing and binding rules on Windows, the
hot-reload ownership check and the database's private mode.
"""

from __future__ import annotations

import errno
import importlib
import importlib.util
import logging
import os
import socket
import stat
import sys
import types
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
filelock = importlib.import_module("tube_pkg.ext._filelock")
_server = importlib.import_module("tube_pkg.ext._server")
storage = importlib.import_module("tube_pkg.adapters.storage")


# --------------------------------------------------------------------------- a fake Windows


class FakeMsvcrt(types.ModuleType):
    """``msvcrt.locking`` with Windows semantics for one process: a byte range locked through
    one descriptor cannot be locked through another; ``LK_NBLCK`` fails at once."""

    LK_UNLCK = 0
    LK_LOCK = 1
    LK_NBLCK = 2
    LK_RLCK = 3
    LK_NBRLCK = 4

    def __init__(self) -> None:
        super().__init__("msvcrt")
        self.held: dict[tuple[int, int, int], int] = {}
        self.calls: list[tuple[int, int, int]] = []

    def locking(self, fd: int, mode: int, nbytes: int) -> None:
        pos = os.lseek(fd, 0, os.SEEK_CUR)
        st = os.fstat(fd)
        key = (st.st_dev, st.st_ino, pos)
        self.calls.append((mode, pos, nbytes))
        if mode == self.LK_UNLCK:
            if self.held.get(key) != fd:
                raise PermissionError(errno.EACCES, "not locked by this descriptor")
            del self.held[key]
            return
        if mode != self.LK_NBLCK:
            raise AssertionError("only the non-blocking lock is used")
        if key in self.held:
            raise PermissionError(errno.EACCES, "Permission denied")
        self.held[key] = fd


@pytest.fixture
def windows(monkeypatch: pytest.MonkeyPatch) -> FakeMsvcrt:
    fake = FakeMsvcrt()
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setitem(sys.modules, "msvcrt", fake)
    monkeypatch.setitem(sys.modules, "fcntl", None)  # `import fcntl` raises ImportError
    return fake


# --------------------------------------------------------------------------- the lock


@pytest.mark.skipif(os.name != "posix", reason="real fcntl")
def test_posix_lock_is_exclusive_non_blocking_and_released(tmp_path: Path) -> None:
    path = tmp_path / "x.lock"
    first = filelock.try_lock(path)
    assert first is not None
    assert filelock.try_lock(path) is None  # another descriptor, same process: refused at once
    filelock.release(first)
    second = filelock.try_lock(path)
    assert second is not None
    os.close(second)  # closing the descriptor releases it too
    third = filelock.try_lock(path)
    assert third is not None
    filelock.release(third)
    assert stat.S_IMODE(path.stat().st_mode) & 0o077 == 0


def test_windows_lock_uses_msvcrt_and_never_fcntl(tmp_path: Path, windows: FakeMsvcrt) -> None:
    path = tmp_path / "x.lock"
    first = filelock.try_lock(path)
    assert first is not None
    assert filelock.try_lock(path) is None
    # one byte far past the pid, so the pid at the start of the file stays readable
    mode, pos, nbytes = windows.calls[0]
    assert (mode, pos, nbytes) == (windows.LK_NBLCK, filelock.WINDOWS_LOCK_OFFSET, 1)
    assert os.lseek(first, 0, os.SEEK_CUR) == 0
    filelock.release(first)
    assert windows.held == {}
    again = filelock.try_lock(path)
    assert again is not None
    filelock.release(again)


@pytest.mark.parametrize(
    ("platform", "backend"),
    [("win32", "msvcrt"), ("linux", "fcntl"), ("darwin", "fcntl"), ("cygwin", "fcntl")],
)
def test_the_lock_backend_follows_the_platform(
    platform: str, backend: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "platform", platform)
    assert filelock.backend_name() == backend


def test_server_writes_its_pid_under_the_windows_lock(tmp_path: Path, windows: FakeMsvcrt) -> None:
    path = tmp_path / _server.LOCK_NAME
    fd = _server._try_lock(path)
    assert fd is not None
    assert path.read_text(encoding="utf-8").strip() == str(os.getpid())
    assert _server._try_lock(path) is None
    _server._release(fd)
    assert _server.try_lock_free(tmp_path) is True


def test_the_server_module_imports_without_fcntl(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "fcntl", None)
    spec = importlib.util.spec_from_file_location(
        "_tube_server_without_fcntl", ROOT / "plugin" / "ext" / "_server.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)  # dataclasses look the module up
    spec.loader.exec_module(module)  # raised ModuleNotFoundError before
    assert module.HOST == "127.0.0.1"


def test_no_plugin_module_imports_a_posix_only_module_at_the_top() -> None:
    posix_only = ("fcntl", "pwd", "grp", "termios", "resource")
    offenders = []
    for path in (ROOT / "plugin").rglob("*.py"):
        if "desktop" in path.parts or "extension" in path.parts:
            continue
        for line in path.read_text("utf-8").splitlines():
            stripped = line.strip()
            if line.startswith(("import ", "from ")) and any(
                stripped in (f"import {m}",) or stripped.startswith(f"from {m} ")
                for m in posix_only
            ):
                offenders.append(f"{path.relative_to(ROOT)}: {stripped}")
    assert offenders == []


# --------------------------------------------------------------------------- ports


@pytest.mark.parametrize(
    ("code", "skip"),
    [
        (errno.EADDRINUSE, True),
        (errno.EACCES, True),
        (errno.EADDRNOTAVAIL, True),
        (10013, True),  # WSAEACCES: a port reserved by Windows (Hyper-V / WSL excluded ranges)
        (10048, True),  # WSAEADDRINUSE
        (10049, True),  # WSAEADDRNOTAVAIL
        (errno.ENOMEM, False),
    ],
)
def test_bind_errors_that_mean_try_the_next_port(code: int, skip: bool) -> None:
    assert _server._skippable_bind_error(OSError(code, "x")) is skip


@pytest.mark.parametrize(
    ("platform", "busy"), [("win32", False), ("linux", True), ("darwin", True)]
)
def test_a_probe_that_times_out_means_free_only_on_windows(
    platform: str, busy: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Windows answers a connection to a closed loopback port only after ~2 s of retries; a real
    # listener on loopback accepts at once
    def slow(*_a: Any, **_kw: Any) -> Any:
        raise TimeoutError("timed out")

    monkeypatch.setattr(_server.socket, "create_connection", slow)
    monkeypatch.setattr(sys, "platform", platform)
    assert _server._port_in_use(47615) is busy


def test_a_probe_that_connects_is_busy_everywhere(monkeypatch: pytest.MonkeyPatch) -> None:
    class Conn:
        def __enter__(self) -> Conn:
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

    monkeypatch.setattr(_server.socket, "create_connection", lambda *_a, **_kw: Conn())
    for platform in ("win32", "linux"):
        monkeypatch.setattr(sys, "platform", platform)
        assert _server._port_in_use(47615) is True


@pytest.mark.parametrize("platform", ["win32", "linux", "darwin"])
def test_socket_options_never_let_another_program_share_the_port_on_windows(
    platform: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "platform", platform)
    monkeypatch.setattr(socket, "SO_EXCLUSIVEADDRUSE", -5, raising=False)
    opts = _server._socket_options()
    names = [name for name, _level, _opt, _value in opts]
    if platform == "win32":
        # SO_REUSEADDR on Windows lets a second socket take the same port: never there
        assert names == ["SO_EXCLUSIVEADDRUSE"]
    else:
        assert names == ["SO_REUSEADDR"]


def test_the_http_server_does_not_set_reuse_address_by_itself() -> None:
    # the options above are the only ones applied (socketserver would add SO_REUSEADDR)
    assert _server._HTTPServer.allow_reuse_address is False


# --------------------------------------------------------------------------- hot reload


def _load_bootstrap() -> Any:
    spec = importlib.util.spec_from_file_location(
        "_tube_bootstrap_windows", ROOT / "plugin" / "_bootstrap.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_hot_reload_is_off_where_file_owners_cannot_be_checked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    boot = _load_bootstrap()
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.delattr(os, "getuid", raising=False)
    unsafe = boot.unsafe_sources()
    # the rule is not relaxed: without an owner check, the whole plugin folder is untrusted
    assert unsafe == [str(boot.PLUGIN_DIR)]
    assert "restart Hermes" in boot.refusal_reason(unsafe)


@pytest.mark.skipif(not hasattr(os, "getuid"), reason="POSIX owner check")
def test_hot_reload_keeps_the_posix_owner_and_mode_check() -> None:
    boot = _load_bootstrap()
    assert boot.unsafe_sources() == []  # this checkout: ours, not group/other writable
    assert "not yours" in boot.refusal_reason(["/x"])


# --------------------------------------------------------------------------- database mode


class _Db:
    def __init__(self, path: str) -> None:
        self.path = path


@pytest.mark.skipif(not hasattr(os, "getuid"), reason="POSIX modes")
def test_posix_database_files_become_private(tmp_path: Path) -> None:
    db = tmp_path / "tube.db"
    db.write_bytes(b"")
    (tmp_path / "tube.db-wal").write_bytes(b"")
    os.chmod(db, 0o644)
    os.chmod(tmp_path / "tube.db-wal", 0o644)
    storage._make_private(_Db(str(db)))
    assert stat.S_IMODE(db.stat().st_mode) == 0o600
    assert stat.S_IMODE((tmp_path / "tube.db-wal").stat().st_mode) == 0o600


@pytest.mark.parametrize(("inside", "warned"), [(True, False), (False, True)])
def test_windows_database_relies_on_the_user_folder_acl(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    inside: bool,
    warned: bool,
) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    other = tmp_path / "shared"
    other.mkdir()
    db = (profile if inside else other) / "tube.db"
    db.write_bytes(b"")
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.delattr(os, "getuid", raising=False)
    monkeypatch.setenv("USERPROFILE", str(profile))
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    chmods: list[Any] = []
    monkeypatch.setattr(storage.os, "chmod", lambda *a, **_k: chmods.append(a))
    storage._WARNED.clear()
    with caplog.at_level(logging.WARNING):
        storage._make_private(_Db(str(db)))
    assert chmods == []  # chmod can only set "read-only" on Windows: never used there
    assert ("outside your user folder" in caplog.text) is warned
