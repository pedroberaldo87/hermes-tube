"""Portable owner lock for the extension server: one place, same rules on every system.

``try_lock(path)`` opens (or creates, mode 0600) the lock file and takes an **exclusive,
non-blocking** lock on it; it returns the open descriptor, or ``None`` when another descriptor
(in this process or another) holds it. ``release(fd)`` unlocks and closes. Closing the descriptor
or the process ending also frees the lock, so a crashed owner never blocks the next one.

- POSIX (macOS, Linux, WSL): ``fcntl.flock`` on the whole file.
- Windows: ``msvcrt.locking`` (``LK_NBLCK``, one byte). Windows byte-range locks are mandatory, so
  the locked byte sits at ``WINDOWS_LOCK_OFFSET``, far past the pid the owner writes at the start
  of the file: that pid stays readable. Windows frees the lock when the handle closes or the
  process ends.

The platform is read when called (``sys.platform``), and the backend module is imported only
then: importing this module never needs ``fcntl`` or ``msvcrt``.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from typing import Any

WINDOWS_LOCK_OFFSET = 1 << 30
"""Windows: the single locked byte (beyond the end of the file is allowed there)."""


def backend_name() -> str:
    """``msvcrt`` on native Windows, ``fcntl`` everywhere else (Cygwin and WSL are POSIX)."""
    return "msvcrt" if sys.platform == "win32" else "fcntl"


def _backend() -> Any:
    return importlib.import_module(backend_name())


def try_lock(path: str | os.PathLike[str]) -> int | None:
    """Exclusive, non-blocking lock on *path*; the open descriptor, or ``None`` if taken."""
    fd = os.open(Path(path), os.O_RDWR | os.O_CREAT, 0o600)  # not inheritable (PEP 446)
    try:
        mod = _backend()
        if backend_name() == "msvcrt":
            os.lseek(fd, WINDOWS_LOCK_OFFSET, os.SEEK_SET)
            try:
                mod.locking(fd, mod.LK_NBLCK, 1)
            finally:
                os.lseek(fd, 0, os.SEEK_SET)
        else:
            mod.flock(fd, mod.LOCK_EX | mod.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    except BaseException:
        os.close(fd)
        raise
    return fd


def release(fd: int) -> None:
    """Unlock and close *fd* (closing alone also frees the lock)."""
    try:
        mod = _backend()
        if backend_name() == "msvcrt":
            os.lseek(fd, WINDOWS_LOCK_OFFSET, os.SEEK_SET)
            mod.locking(fd, mod.LK_UNLCK, 1)
        else:
            mod.flock(fd, mod.LOCK_UN)
    except OSError:
        pass  # closing below frees it anyway
    finally:
        os.close(fd)


__all__ = ["WINDOWS_LOCK_OFFSET", "backend_name", "release", "try_lock"]
