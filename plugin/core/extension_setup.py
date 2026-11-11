"""\"Set up the extension\": put the bundled extension in a fixed folder and open the browser.

No Chromium browser lets a program install an extension from outside its store without a
gesture from the person. This module does everything up to that point, on the computer where
Hermes runs:

- finds the Chromium browsers installed there from fixed lists (``BROWSERS``: Chrome, Edge,
  Brave, Chromium, Vivaldi, Opera and, on macOS, Arc) — macOS by bundle id in the Applications
  folders, Linux by command name, fixed paths, snap and Flatpak exports, Windows by known install
  paths; nothing is run to find them and the Windows registry is not read;
- copies the extension shipped inside the plugin (``plugin/extension/``, a build of
  ``extension/``) to ``<home>/HermesTube Extension`` — a fixed, visible folder — with a marker
  file (``<PLUGIN_ID>-folder.json``) that says the folder is ours, its version and the files we
  wrote;
- opens the chosen browser's own Extensions page (``edge://extensions/``…) and shows the folder
  in the file manager, each with a fixed argument list and no shell (macOS ``open -b <bundle
  id>``; Linux the browser's program and ``xdg-open``; Windows the browser's ``.exe`` — a
  ``chrome://`` address does not open through file association there — and ``explorer
  /select,``), with time limits;
- reports the path (with backslashes on Windows), the version, the browser and what it could or
  could not open; for a snap or Flatpak browser, whether its sandbox can see the folder.

Hermes inside WSL (Linux in a Windows virtual machine; the browser runs on Windows): detected from
the kernel name (``microsoft``) or ``WSL_DISTRO_NAME``. The folder then goes to the Windows user
folder seen from Linux (``C:\\Users\\<you>`` under ``/mnt/c``, found from ``USERPROFILE``
or the only personal folder in ``C:\\Users`` — no shell, nothing run); the path is shown as
Windows writes it (``C:\\Users\\<you>\\HermesTube Extension``), the status says
``platform: windows``, and the
browser's ``.exe`` and ``explorer.exe`` are started through WSL interop with the same fixed
argument lists and time limits. Without interop, only the folder is prepared. Without a Windows
user folder, the folder stays in the Linux home and is shown as ``\\\\wsl.localhost\\<distro>\\…``.

Rules: the destination is never taken from the caller and the caller can only name one browser
from the closed list (never a path or a command); the home folder must be an absolute path; a
folder with that name that is not ours (no marker, a foreign marker, a file, a link) is refused and
left alone; an update rewrites our own files in place (the browser keeps loading from the same
path; the person presses \"reload\") and only removes files the previous marker lists, never a link
and never anything else. Where the system has it (macOS, Linux, WSL), the folder is opened once
(``O_NOFOLLOW``) and checked to be the one inspected, every read and write goes relative to that
descriptor, and a folder swapped meanwhile ends the update with an error; native Windows has no
``dir_fd`` and writes path by path, never through a link. A file of ours whose bytes differ from
the bundled build (``sha256``) makes the folder ``update_available``, and the button repairs it.
Names Windows reads as a drive, a stream or a device (``C:x``, ``a:b``, ``CON``, ``nul.txt``…) are
never written, on any system. Browser
profiles are never read or written. Only the Desktop route calls this, on a click: no tool,
routine, command or ``register()`` path reaches it.

Test mode (``TUBE_DB_PATH`` set, or running under pytest): the home folder is a sandbox next to
the database (or in the temporary folder) and no program is opened.
"""

from __future__ import annotations

import configparser
import errno
import hashlib
import json
import logging
import os
import plistlib
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Protocol

from tube_pkg._id import PLUGIN_ID

logger = logging.getLogger(__name__)

FOLDER_NAME = "HermesTube Extension"
"""Name of the folder created in the home folder (fixed: the person drags it into Chrome)."""
MARKER_NAME = f"{PLUGIN_ID}-folder.json"
MARKER_KIND = "chrome-extension-folder"
EXTENSIONS_URL = "chrome://extensions/"

MAC_OPEN = "/usr/bin/open"
"""macOS: always this program, never whatever ``open`` comes first in ``PATH``."""
WINDOWS_ROOT = "C:\\Windows"
"""Windows folder when ``SYSTEMROOT`` is missing or not absolute."""

RUN_TIMEOUT_S = 3.0
"""Time limit of a command that returns at once (macOS ``open``)."""
SPAWN_GRACE_S = 1.0
"""How long a started program may take to fail before it counts as opened (Linux, Windows)."""

MAX_FILES = 1000
MAX_BYTES = 20 * 1024 * 1024
MAX_LISTED = 200
"""Most folder names read from ``C:\\Users`` (WSL) while looking for the person's own."""
MAX_TEXT_BYTES = 256 * 1024
"""Largest Info.plist / Flatpak metadata file read while looking for browsers."""
_VERSION_RE = re.compile(r"^\d+(\.\d+){0,3}$")

STATES = ("not_installed", "installed", "update_available", "not_ours", "unavailable")
PLATFORMS = ("macos", "linux", "windows", "other")
OPEN_PROBLEMS = ("no_browser", "no_display", "failed", "unsupported", "disabled")
SANDBOXES = ("snap", "flatpak")

# =========================================================================== browsers


@dataclass(frozen=True)
class BrowserSpec:
    """One Chromium browser: where it is installed on each system and its Extensions page."""

    key: str
    name: str
    extensions_url: str
    mac_apps: tuple[tuple[str, str], ...] = ()
    """``(app folder name, bundle id)`` — the bundle id is checked in ``Info.plist``."""
    linux_commands: tuple[str, ...] = ()
    linux_snap: str | None = None
    linux_wrappers: tuple[str, ...] = ()
    """Commands that only start the snap (Ubuntu's ``chromium-browser``)."""
    linux_flatpak: str | None = None
    windows_paths: tuple[tuple[str, tuple[str, ...]], ...] = ()
    """``(environment variable, path parts)`` of the browser's ``.exe``."""


def _win(*parts: str) -> tuple[str, ...]:
    return parts


BROWSERS: dict[str, BrowserSpec] = {
    spec.key: spec
    for spec in (
        BrowserSpec(
            key="chrome",
            name="Google Chrome",
            extensions_url=EXTENSIONS_URL,
            mac_apps=(("Google Chrome.app", "com.google.Chrome"),),
            linux_commands=("google-chrome", "google-chrome-stable"),
            linux_flatpak="com.google.Chrome",
            windows_paths=tuple(
                (var, _win("Google", "Chrome", "Application", "chrome.exe"))
                for var in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")
            ),
        ),
        BrowserSpec(
            key="edge",
            name="Microsoft Edge",
            extensions_url="edge://extensions/",
            mac_apps=(("Microsoft Edge.app", "com.microsoft.edgemac"),),
            linux_commands=("microsoft-edge", "microsoft-edge-stable"),
            linux_flatpak="com.microsoft.Edge",
            windows_paths=tuple(
                (var, _win("Microsoft", "Edge", "Application", "msedge.exe"))
                for var in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA")
            ),
        ),
        BrowserSpec(
            key="brave",
            name="Brave",
            extensions_url="brave://extensions/",
            mac_apps=(("Brave Browser.app", "com.brave.Browser"),),
            linux_commands=("brave-browser", "brave-browser-stable", "brave"),
            linux_snap="brave",
            linux_flatpak="com.brave.Browser",
            windows_paths=tuple(
                (var, _win("BraveSoftware", "Brave-Browser", "Application", "brave.exe"))
                for var in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")
            ),
        ),
        BrowserSpec(
            key="chromium",
            name="Chromium",
            extensions_url=EXTENSIONS_URL,
            mac_apps=(("Chromium.app", "org.chromium.Chromium"),),
            linux_commands=("chromium",),
            linux_snap="chromium",
            linux_wrappers=("chromium-browser",),
            linux_flatpak="org.chromium.Chromium",
            windows_paths=(
                ("LOCALAPPDATA", _win("Chromium", "Application", "chrome.exe")),
                ("PROGRAMFILES", _win("Chromium", "Application", "chrome.exe")),
            ),
        ),
        BrowserSpec(
            key="vivaldi",
            name="Vivaldi",
            extensions_url="vivaldi://extensions/",
            mac_apps=(("Vivaldi.app", "com.vivaldi.Vivaldi"),),
            linux_commands=("vivaldi", "vivaldi-stable"),
            linux_snap="vivaldi",
            linux_flatpak="com.vivaldi.Vivaldi",
            windows_paths=(
                ("LOCALAPPDATA", _win("Vivaldi", "Application", "vivaldi.exe")),
                ("PROGRAMFILES", _win("Vivaldi", "Application", "vivaldi.exe")),
            ),
        ),
        BrowserSpec(
            key="opera",
            name="Opera",
            extensions_url="opera://extensions/",
            mac_apps=(("Opera.app", "com.operasoftware.Opera"),),
            linux_commands=("opera",),
            linux_snap="opera",
            linux_flatpak="com.opera.Opera",
            windows_paths=(
                ("LOCALAPPDATA", _win("Programs", "Opera", "opera.exe")),
                ("LOCALAPPDATA", _win("Programs", "Opera", "launcher.exe")),
                ("PROGRAMFILES", _win("Opera", "opera.exe")),
                ("PROGRAMFILES", _win("Opera", "launcher.exe")),
            ),
        ),
        BrowserSpec(
            key="arc",
            name="Arc",
            # Arc answers to Chrome's own address for its Extensions page
            extensions_url=EXTENSIONS_URL,
            mac_apps=(("Arc.app", "company.thebrowser.Browser"),),
        ),
    )
}
BROWSER_KEYS: tuple[str, ...] = tuple(BROWSERS)
"""The closed list the caller may choose from, in the order offered (first = default)."""
MAC_FALLBACK = ("chrome", "chromium")
"""macOS, nothing found in the Applications folders and no choice: ask Launch Services for these."""
MAC_APP_DIRS = ("/Applications",)
LINUX_FIXED_DIRS = ("/usr/bin", "/usr/local/bin")
SNAP_BIN = "/snap/bin"
FLATPAK_SYSTEM = "/var/lib/flatpak"
FLATPAK_USER = (".local", "share", "flatpak")


@dataclass(frozen=True)
class FoundBrowser:
    """A browser found on this computer (internal: ``program`` never leaves the backend)."""

    key: str
    program: str
    """macOS: the bundle id; Linux/Windows: the program to run."""
    sandbox: str | None = None
    app_id: str | None = None
    folder_visible: bool = True

    @property
    def spec(self) -> BrowserSpec:
        return BROWSERS[self.key]

    def public(self) -> dict[str, Any]:
        """``ExtensionBrowser``."""
        return {
            "key": self.key,
            "name": self.spec.name,
            "extensions_url": self.spec.extensions_url,
            "sandbox": self.sandbox,
            "app_id": self.app_id,
            "folder_visible": self.folder_visible,
        }


def check_browser_key(key: Any) -> str | None:
    """``None`` or one key of ``BROWSER_KEYS``; anything else raises ``ValueError``."""
    if key is None:
        return None
    if not isinstance(key, str) or key not in BROWSERS:
        raise ValueError("unknown browser")
    return key


class SetupRefused(Exception):
    """The setup cannot run: ``reason`` = ``not_ours`` (the folder belongs to somebody else) or
    ``no_bundle`` (this copy of the plugin ships no built extension)."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


# =========================================================================== environment


def current_platform() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform in ("win32", "cygwin"):
        return "windows"
    return "other"


def bundle_root() -> Path:
    """The built extension shipped inside the plugin (``plugin/extension``)."""
    return Path(__file__).resolve().parent.parent / "extension"


def _test_mode() -> str | None:
    db = os.environ.get("TUBE_DB_PATH", "").strip()
    if db:
        return db
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return ""
    return None


def default_home() -> Path:
    """The person's home folder; in test mode a sandbox (created if needed), never the real one."""
    test = _test_mode()
    if test is None:
        return Path.home()
    if test:
        sandbox = Path(test).expanduser().resolve().parent / "home"
    else:
        sandbox = Path(tempfile.gettempdir()).resolve() / f"{PLUGIN_ID}-test-home"
    sandbox.mkdir(parents=True, exist_ok=True)
    return sandbox


def apps_home() -> Path:
    """The real home folder, only to look for per-user browser installs (``~/Applications``,
    per-user Flatpaks). Read only: nothing is ever written there by the detection."""
    return Path.home()


def apps_allowed() -> bool:
    """Opening the browser and the file manager is off in test mode."""
    return _test_mode() is None


def destination(home: Path) -> Path:
    return Path(home) / FOLDER_NAME


def display_path(path: Path, platform: str, wsl: WslHost | None = None) -> str:
    """The path as the person types it on that system (backslashes on Windows; inside WSL, as
    Windows sees it)."""
    if wsl is not None:
        return wsl_windows_path(path, wsl)
    if platform == "windows":
        return str(PureWindowsPath(str(path)))
    return str(path)


def _is_absolute(path: Path | str, platform: str) -> bool:
    text = str(path)
    if not text:
        return False
    if Path(text).is_absolute():
        return True
    return platform == "windows" and PureWindowsPath(text).is_absolute()


def _require_absolute(path: Path | str, platform: str) -> None:
    """A relative home (``HOME=-a Calculator``…) would turn into an argument that looks like an
    option, or into a folder under the current folder: refused."""
    if not _is_absolute(path, platform):
        raise OSError(f"the home folder is not an absolute path: {str(path)!r}")


# =========================================================================== bundle


@dataclass(frozen=True)
class Bundle:
    root: Path
    version: str
    digest: str
    files: tuple[str, ...]
    """Relative POSIX paths, sorted."""
    hashes: Mapping[str, str] = field(default_factory=dict)
    """``sha256`` (hex) of each file, by relative path."""

    def read(self, rel: str) -> bytes:
        return (self.root / rel).read_bytes()

    def hash_of(self, rel: str) -> str:
        known = self.hashes.get(rel)
        return known if known else hashlib.sha256(self.read(rel)).hexdigest()


def version_key(version: str | None) -> tuple[int, ...]:
    parts = [int(p) if p.isdigit() else 0 for p in str(version or "").split(".")]
    return tuple((parts + [0, 0, 0, 0])[:4])


def _list_files(root: Path) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        base = Path(dirpath)
        dirnames[:] = sorted(
            d for d in dirnames if not d.startswith(".") and not (base / d).is_symlink()
        )
        for name in sorted(filenames):
            path = base / name
            if name.startswith(".") or name == MARKER_NAME or path.is_symlink():
                continue
            if path.is_file():
                out.append(path.relative_to(root).as_posix())
    return sorted(out)


def load_bundle(root: Path) -> Bundle | None:
    """The built extension at *root*, or ``None`` (missing, no readable manifest, too large)."""
    try:
        root = Path(root)
        if not root.is_dir() or root.is_symlink():
            return None
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        version = str(manifest.get("version") or "") if isinstance(manifest, dict) else ""
        if not _VERSION_RE.match(version):
            return None
        files = _list_files(root)
        if not files or len(files) > MAX_FILES:
            return None
        if any(_safe_rel(rel) != rel for rel in files):
            logger.warning("%s: bundled extension has a name Windows cannot hold", PLUGIN_ID)
            return None
        total = 0
        digest = hashlib.sha256()
        hashes: dict[str, str] = {}
        for rel in files:
            data = (root / rel).read_bytes()
            total += len(data)
            if total > MAX_BYTES:
                return None
            hashes[rel] = hashlib.sha256(data).hexdigest()
            digest.update(f"{rel}\0{hashes[rel]}\n".encode())
    except (OSError, ValueError):
        logger.warning("%s: bundled extension unreadable at %s", PLUGIN_ID, root, exc_info=True)
        return None
    return Bundle(
        root=root, version=version, digest=digest.hexdigest(), files=tuple(files), hashes=hashes
    )


# =========================================================================== marker


_WINDOWS_BAD_CHARS = frozenset('<>:"|?*')
_WINDOWS_DEVICE = re.compile(
    r"^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\..*)?$", re.I
)


def _safe_part(part: str) -> bool:
    """A file or folder name every system can hold: no drive (``C:``), stream (``a:b``),
    device (``CON``, ``nul.txt``), trailing dot or space, or control character."""
    if part in ("", ".", ".."):
        return False
    if any(c in _WINDOWS_BAD_CHARS or ord(c) < 32 for c in part):
        return False
    if part.endswith((".", " ")):
        return False
    return not _WINDOWS_DEVICE.match(part)


def _safe_rel(rel: Any) -> str | None:
    if not isinstance(rel, str) or not rel or "\\" in rel or "\0" in rel:
        return None
    pure = PurePosixPath(rel)
    if pure.is_absolute() or not all(_safe_part(part) for part in rel.split("/")):
        return None
    return pure.as_posix()


def _ownership(dest: Path) -> tuple[str, dict[str, Any] | None, os.stat_result | None]:
    """``("absent", None, None)``, ``("ours", marker, lstat)`` or ``("not_ours", None, None)``.
    The ``lstat`` lets the writer check that the folder it opens is the one inspected here."""
    try:
        st = os.lstat(dest)
    except FileNotFoundError:
        return "absent", None, None
    if _link_like(st) or not stat.S_ISDIR(st.st_mode):  # a link, a junction or a file
        return "not_ours", None, None
    marker_path = dest / MARKER_NAME
    if marker_path.is_symlink() or not marker_path.is_file():
        return "not_ours", None, None
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "not_ours", None, None
    if not isinstance(marker, dict):
        return "not_ours", None, None
    if marker.get("created_by") != PLUGIN_ID or marker.get("kind") != MARKER_KIND:
        return "not_ours", None, None
    return "ours", marker, st


def _marker_files(marker: Mapping[str, Any]) -> list[str]:
    raw = marker.get("files")
    if not isinstance(raw, list):
        return []
    return [rel for rel in (_safe_rel(x) for x in raw) if rel]


def _marker_body(bundle: Bundle, now: float) -> dict[str, Any]:
    return {
        "created_by": PLUGIN_ID,
        "kind": MARKER_KIND,
        "version": bundle.version,
        "digest": bundle.digest,
        "files": list(bundle.files),
        "updated_at": int(now),
        "note": (
            "Created by the HermesTube plugin for Hermes Agent. Chrome loads the extension from "
            "this folder, so keep it here. Hermes only rewrites the files listed above."
        ),
    }


def _needs_copy(folder: _Folder, marker: Mapping[str, Any], bundle: Bundle) -> bool:
    """Newer build, another build of the same version, or a file of ours missing or changed (its
    ``sha256`` differs from the bundled one; a link is never followed and counts as changed). An
    older build never replaces a newer one."""
    installed = str(marker.get("version") or "")
    if version_key(bundle.version) > version_key(installed):
        return True
    if version_key(bundle.version) < version_key(installed):
        return False  # never downgrade
    if marker.get("digest") != bundle.digest:
        return True
    for rel in bundle.files:
        data = folder.read(rel, MAX_BYTES)
        if data is None or hashlib.sha256(data).hexdigest() != bundle.hash_of(rel):
            return True
    return False


def _public_platform(platform: str, wsl: WslHost | None) -> str:
    """Inside WSL the person works on Windows: the browser, the folder and Explorer are there."""
    return "windows" if wsl is not None else platform


def inspect(
    *,
    home: Path,
    bundle: Bundle | None,
    platform: str,
    browsers: Sequence[FoundBrowser] = (),
    wsl: WslHost | None = None,
) -> dict[str, Any]:
    """``ExtensionSetupStatus``: what the button should offer. Reads only; writes nothing."""
    dest = destination(home)
    owner, marker, st = _ownership(dest)
    installed = (str(marker.get("version") or "") or None) if marker else None
    if bundle is None:
        state = "unavailable"
    elif owner == "absent":
        state = "not_installed"
    elif owner == "not_ours":
        state = "not_ours"
    elif marker is not None:
        with _open_folder(dest, st) as folder:
            state = "update_available" if _needs_copy(folder, marker, bundle) else "installed"
    else:
        state = "installed"
    out: dict[str, Any] = {
        "state": state,
        "path": display_path(dest, platform, wsl),
        "bundled_version": bundle.version if bundle else None,
        "installed_version": installed,
        "platform": _public_platform(platform, wsl),
        "browsers": [b.public() for b in browsers],
    }
    if wsl is not None:
        out["wsl"] = wsl.public()
    return out


# =========================================================================== copy

FD_WRITES: bool = (
    os.open in os.supports_dir_fd
    and os.mkdir in os.supports_dir_fd
    and os.unlink in os.supports_dir_fd
    and os.rename in os.supports_dir_fd
    and hasattr(os, "O_DIRECTORY")
    and hasattr(os, "O_NOFOLLOW")
)
"""Reads and writes go relative to a descriptor of the folder (macOS, Linux, WSL). Native Windows
has no ``dir_fd``: the path writer below, which checks every folder on the way for links."""

_O_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_O_DIR_FLAGS = os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW | _O_CLOEXEC
_LINK_ERRNOS = frozenset({errno.ELOOP, errno.ENOTDIR, getattr(errno, "EMLINK", errno.ELOOP)})


_REPARSE_POINT = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT: Windows links and junctions


def _link_like(st: os.stat_result) -> bool:
    return stat.S_ISLNK(st.st_mode) or bool(getattr(st, "st_file_attributes", 0) & _REPARSE_POINT)


def _same(a: os.stat_result, b: os.stat_result) -> bool:
    return (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)


def _tmp_name(name: str) -> str:
    return f".{name}.{secrets.token_hex(4)}.tmp"


class _Folder(Protocol):
    def read(self, rel: str, limit: int) -> bytes | None:
        """A regular file of the folder (never through a link), or ``None``."""
        ...

    def write(self, rel: str, data: bytes) -> None: ...

    def remove(self, rel: str) -> None:
        """Remove a regular file; a link, a folder or a missing file is left alone."""
        ...

    def still_there(self) -> None:
        """``OSError`` if the folder at the path is no longer the one opened."""
        ...

    def close(self) -> None: ...


class _FdFolder:
    """The folder, opened once (``O_NOFOLLOW``); every read and write relative to it."""

    def __init__(self, path: Path, expected: os.stat_result | None) -> None:
        self.path = Path(path)
        fd = os.open(self.path, _O_DIR_FLAGS)
        try:
            self.st = os.fstat(fd)
            if expected is not None and not _same(self.st, expected):
                raise OSError(f"the folder changed while it was checked: {self.path}")
        except BaseException:
            os.close(fd)
            raise
        self.fd = fd

    def close(self) -> None:
        os.close(self.fd)

    def still_there(self) -> None:
        if not _same(os.lstat(self.path), self.st):
            raise OSError(f"the folder was replaced while it was written: {self.path}")

    def _parent(self, rel: str, *, create: bool) -> tuple[int, str, list[int]]:
        parts = rel.split("/")
        current = self.fd
        opened: list[int] = []
        try:
            for part in parts[:-1]:
                try:
                    sub = os.open(part, _O_DIR_FLAGS, dir_fd=current)
                except FileNotFoundError:
                    if not create:
                        raise
                    os.mkdir(part, 0o755, dir_fd=current)
                    sub = os.open(part, _O_DIR_FLAGS, dir_fd=current)
                opened.append(sub)
                current = sub
        except OSError as exc:
            for fd in opened:
                os.close(fd)
            if exc.errno in _LINK_ERRNOS:
                raise OSError(f"refusing to go through a link or a file: {rel}") from exc
            raise
        return current, parts[-1], opened

    def read(self, rel: str, limit: int) -> bytes | None:
        try:
            parent, name, opened = self._parent(rel, create=False)
        except OSError:
            return None
        try:
            fd = os.open(name, os.O_RDONLY | _O_NOFOLLOW | _O_CLOEXEC, dir_fd=parent)
        except OSError:
            return None
        finally:
            for sub in opened:
                os.close(sub)
        with os.fdopen(fd, "rb") as fh:
            if not stat.S_ISREG(os.fstat(fh.fileno()).st_mode):
                return None
            data = fh.read(limit + 1)
        return None if len(data) > limit else data

    def write(self, rel: str, data: bytes) -> None:
        parent, name, opened = self._parent(rel, create=True)
        try:
            try:
                old = os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                old = None
            if old is not None and stat.S_ISDIR(old.st_mode):
                raise OSError(f"a folder is in the way: {rel}")
            tmp = _tmp_name(name)
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | _O_NOFOLLOW | _O_CLOEXEC
            fd = os.open(tmp, flags, 0o644, dir_fd=parent)
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(data)
                    try:
                        os.fchmod(fh.fileno(), 0o644)
                    except OSError:  # a mounted Windows drive may not keep modes; 0644 & umask
                        logger.debug("%s: could not set the mode of %s", PLUGIN_ID, rel)
                # a link at *name* is replaced, its target never written
                os.rename(tmp, name, src_dir_fd=parent, dst_dir_fd=parent)
            except BaseException:
                try:
                    os.unlink(tmp, dir_fd=parent)
                except OSError:
                    pass
                raise
        finally:
            for sub in opened:
                os.close(sub)

    def remove(self, rel: str) -> None:
        try:
            parent, name, opened = self._parent(rel, create=False)
        except OSError:
            return  # missing, or through a link: left alone
        try:
            st = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if stat.S_ISREG(st.st_mode):
                os.unlink(name, dir_fd=parent)
        except FileNotFoundError:
            pass
        except OSError:
            logger.warning("%s: could not remove an old extension file", PLUGIN_ID, exc_info=True)
        finally:
            for sub in opened:
                os.close(sub)

    def __enter__(self) -> _FdFolder:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def _ensure_parent(dest: Path, rel: str) -> Path:
    """Parent folder of *rel* inside *dest*, created if needed; never through a link."""
    current = dest
    for part in PurePosixPath(rel).parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise OSError(f"refusing to write through a link: {current}")
        if not current.exists():
            current.mkdir(mode=0o755)
        elif not current.is_dir():
            raise OSError(f"not a folder: {current}")
    return current


class _PathFolder:
    """No ``dir_fd`` (native Windows): path by path, checking each folder for a link."""

    def __init__(self, path: Path, expected: os.stat_result | None) -> None:
        self.path = Path(path)
        st = os.lstat(self.path)
        if (
            _link_like(st)
            or not stat.S_ISDIR(st.st_mode)
            or (expected is not None and not _same(st, expected))
        ):
            raise OSError(f"the folder changed while it was checked: {self.path}")
        self.st = st

    def close(self) -> None:
        return None

    def still_there(self) -> None:
        if not _same(os.lstat(self.path), self.st):
            raise OSError(f"the folder was replaced while it was written: {self.path}")

    def _links_on_the_way(self, rel: str) -> bool:
        parts = rel.split("/")
        for i in range(1, len(parts)):
            try:
                if _link_like(os.lstat(self.path.joinpath(*parts[:i]))):
                    return True
            except FileNotFoundError:
                return False
        return False

    def read(self, rel: str, limit: int) -> bytes | None:
        if self._links_on_the_way(rel):
            return None
        path = self.path.joinpath(*rel.split("/"))
        try:
            st = os.lstat(path)
            if _link_like(st) or not stat.S_ISREG(st.st_mode) or st.st_size > limit:
                return None
            with open(path, "rb") as fh:
                data = fh.read(limit + 1)
        except OSError:
            return None
        return None if len(data) > limit else data

    def write(self, rel: str, data: bytes) -> None:
        parent = _ensure_parent(self.path, rel)
        final = parent / PurePosixPath(rel).name
        if final.is_dir() and not final.is_symlink():
            raise OSError(f"a folder is in the way: {final}")
        tmp = parent / _tmp_name(final.name)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | _O_NOFOLLOW | getattr(os, "O_BINARY", 0)
        fd = os.open(tmp, flags, 0o644)
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.chmod(tmp, 0o644)
            os.replace(tmp, final)  # a link at *final* is replaced, its target never written
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def remove(self, rel: str) -> None:
        if self._links_on_the_way(rel):
            return
        path = self.path.joinpath(*rel.split("/"))
        try:
            st = os.lstat(path)
        except OSError:
            return
        if _link_like(st) or not stat.S_ISREG(st.st_mode):
            return
        try:
            path.unlink()
        except OSError:
            logger.warning("%s: could not remove an old extension file", PLUGIN_ID, exc_info=True)

    def __enter__(self) -> _PathFolder:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def _open_folder(path: Path, expected: os.stat_result | None) -> _FdFolder | _PathFolder:
    return _FdFolder(path, expected) if FD_WRITES else _PathFolder(path, expected)


def _marker_bytes(bundle: Bundle, now: float) -> bytes:
    body = json.dumps(_marker_body(bundle, now), indent=2, ensure_ascii=False) + "\n"
    return body.encode("utf-8")


def _copy_all(folder: _Folder, bundle: Bundle) -> None:
    for rel in bundle.files:
        folder.write(rel, bundle.read(rel))


def _remove_dropped(folder: _Folder, old: Sequence[str], bundle: Bundle) -> None:
    """Remove files the previous version wrote and this one no longer ships (regular files only,
    never a link, never anything outside our list)."""
    keep = set(bundle.files)
    for rel in old:
        if rel in keep or rel == MARKER_NAME:
            continue
        folder.remove(rel)


def install(*, home: Path, bundle: Bundle, now: float | None = None) -> tuple[str, str]:
    """Copy or update the folder. Returns ``(action, version in the folder)`` with ``action`` =
    ``installed`` | ``updated`` | ``unchanged``. Raises ``SetupRefused`` or ``OSError``."""
    when = time.time() if now is None else now
    home = Path(home)
    _require_absolute(home, "native")
    dest = destination(home)
    owner, marker, st = _ownership(dest)
    if owner == "not_ours":
        raise SetupRefused(
            "not_ours", "a folder with this name already exists and was not created by Hermes"
        )
    if owner == "ours" and marker is not None:
        with _open_folder(dest, st) as folder:
            if not _needs_copy(folder, marker, bundle):
                return "unchanged", str(marker.get("version") or bundle.version)
            _copy_all(folder, bundle)
            _remove_dropped(folder, _marker_files(marker), bundle)
            folder.write(MARKER_NAME, _marker_bytes(bundle, when))
            folder.still_there()
        return "updated", bundle.version
    if not home.is_dir():
        raise OSError(f"home folder missing: {home}")
    staging = home / f".{FOLDER_NAME}.partial-{secrets.token_hex(4)}"
    staging.mkdir(mode=0o755)
    try:
        with _open_folder(staging, os.lstat(staging)) as folder:
            _copy_all(folder, bundle)
            folder.write(MARKER_NAME, _marker_bytes(bundle, when))
            folder.still_there()
        if os.path.lexists(dest):
            raise SetupRefused(
                "not_ours", "a folder with this name appeared while the extension was copied"
            )
        os.rename(staging, dest)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)  # created just above, by us
        raise
    return "installed", bundle.version


# =========================================================================== processes and files


class Launcher(Protocol):
    def run(self, argv: Sequence[str], timeout: float) -> int | None:
        """Run and wait (at most *timeout*); the exit code, or ``None`` on timeout/missing."""
        ...

    def spawn(
        self, argv: Sequence[str], grace: float, *, accept_exit: tuple[int, ...] = (0,)
    ) -> bool:
        """Start and wait up to *grace*: ``True`` if still running or exited with an accepted
        code."""
        ...

    def which(self, name: str) -> str | None: ...

    def is_file(self, path: str) -> bool: ...

    def is_dir(self, path: str) -> bool: ...

    def bundle_id(self, app: str) -> str | None:
        """macOS: ``CFBundleIdentifier`` of the ``.app`` folder *app*, or ``None``."""
        ...

    def read_text(self, path: str) -> str | None:
        """A small text file (at most ``MAX_TEXT_BYTES``), or ``None``."""
        ...

    def realpath(self, path: str) -> str: ...

    def list_dirs(self, path: str) -> list[str]:
        """Names of the folders directly inside *path* (links excluded); ``[]`` if unreadable."""
        ...


_QUIET: dict[str, Any] = {
    "stdin": subprocess.DEVNULL,
    "stdout": subprocess.DEVNULL,
    "stderr": subprocess.DEVNULL,
    "close_fds": True,
}


def _detach() -> dict[str, Any]:
    """The started browser must not live and die with the Hermes process."""
    if os.name == "posix":
        return {"start_new_session": True}
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
        subprocess, "CREATE_NEW_PROCESS_GROUP", 0
    )
    return {"creationflags": flags} if flags else {}


class SystemLauncher:
    """Real processes: fixed argument lists, never a shell, always a time limit."""

    def run(self, argv: Sequence[str], timeout: float) -> int | None:
        try:
            done = subprocess.run(list(argv), timeout=timeout, check=False, **_QUIET)
        except subprocess.TimeoutExpired:
            logger.warning("%s: %s took longer than %.0f s", PLUGIN_ID, argv[0], timeout)
            return None
        except OSError as exc:
            logger.warning("%s: could not run %s: %s", PLUGIN_ID, argv[0], exc)
            return None
        return done.returncode

    def spawn(
        self, argv: Sequence[str], grace: float, *, accept_exit: tuple[int, ...] = (0,)
    ) -> bool:
        try:
            proc = subprocess.Popen(list(argv), **_QUIET, **_detach())
        except OSError as exc:
            logger.warning("%s: could not start %s: %s", PLUGIN_ID, argv[0], exc)
            return False
        try:
            code = proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            return True  # still running: the browser or file manager took over
        if code not in accept_exit:
            logger.warning("%s: %s exited with %s", PLUGIN_ID, argv[0], code)
            return False
        return True

    def which(self, name: str) -> str | None:
        return shutil.which(name)

    def is_file(self, path: str) -> bool:
        return os.path.isfile(path)

    def is_dir(self, path: str) -> bool:
        return os.path.isdir(path)

    def bundle_id(self, app: str) -> str | None:
        data = self._read_bytes(os.path.join(app, "Contents", "Info.plist"))
        if data is None:
            return None
        try:
            info = plistlib.loads(data)
        except (plistlib.InvalidFileException, ValueError, OverflowError):
            return None
        value = info.get("CFBundleIdentifier") if isinstance(info, dict) else None
        return value if isinstance(value, str) else None

    def read_text(self, path: str) -> str | None:
        data = self._read_bytes(path)
        if data is None:
            return None
        return data.decode("utf-8", errors="replace")

    def realpath(self, path: str) -> str:
        return os.path.realpath(path)

    def list_dirs(self, path: str) -> list[str]:
        names: list[str] = []
        try:
            with os.scandir(path) as entries:
                for entry in entries:
                    if len(names) >= MAX_LISTED:
                        break
                    if entry.is_dir(follow_symlinks=False):
                        names.append(entry.name)
        except OSError:
            return []
        return sorted(names)

    @staticmethod
    def _read_bytes(path: str) -> bytes | None:
        try:
            if not os.path.isfile(path) or os.path.getsize(path) > MAX_TEXT_BYTES:
                return None
            with open(path, "rb") as fh:
                return fh.read(MAX_TEXT_BYTES + 1)[:MAX_TEXT_BYTES]
        except OSError:
            return None


def default_launcher() -> Launcher:
    return SystemLauncher()


# =========================================================================== finding browsers


def _find_mac(spec: BrowserSpec, launcher: Launcher, home: Path) -> FoundBrowser | None:
    for app_name, bundle_id in spec.mac_apps:
        for base in (*MAC_APP_DIRS, str(Path(home) / "Applications")):
            app = f"{base.rstrip('/')}/{app_name}"
            if launcher.is_dir(app) and launcher.bundle_id(app) == bundle_id:
                return FoundBrowser(key=spec.key, program=bundle_id)
    return None


def _linux_command(launcher: Launcher, name: str) -> str | None:
    found = launcher.which(name)
    if found:
        return found
    return next((f"{d}/{name}" for d in LINUX_FIXED_DIRS if launcher.is_file(f"{d}/{name}")), None)


def _is_snap(launcher: Launcher, path: str) -> bool:
    return path.startswith(f"{SNAP_BIN}/") or launcher.realpath(path).startswith("/snap/")


def _snap_sees(dest: Path) -> bool:
    """A snap browser (``home`` interface) sees non-hidden files under ``/home``."""
    parts = PurePosixPath(str(dest)).parts
    return (
        len(parts) > 3
        and parts[:2] == ("/", "home")
        and not any(p.startswith(".") for p in parts[2:])
    )


def _flatpak_entries(text: str | None) -> list[str]:
    if not text:
        return []
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        parser.read_string(text)
    except configparser.Error:
        return []
    raw = parser.get("Context", "filesystems", fallback="") or ""
    return [e.strip() for e in raw.split(";") if e.strip()]


def _flatpak_covers(entry: str, dest: Path, home: Path) -> bool:
    for suffix in (":ro", ":rw", ":create"):
        if entry.endswith(suffix):
            entry = entry[: -len(suffix)]
            break
    if entry == "host":
        return True
    if entry == "home":
        base = Path(home)
    elif entry == "~" or entry.startswith("~/"):
        base = Path(home) / entry[2:]
    elif entry.startswith("/"):
        base = Path(entry)
    else:
        return False  # xdg-* and other named places never hold a folder of the home itself
    return dest == base or base in dest.parents


def _flatpak_sees(app_id: str, dest: Path, home: Path, launcher: Launcher) -> bool:
    """Read the Flatpak's permissions (metadata, then system and user overrides) — files only,
    nothing is run. Unknown = not visible (the screen then explains how to give access)."""
    user = str(Path(home).joinpath(*FLATPAK_USER))
    sources = [
        f"{FLATPAK_SYSTEM}/app/{app_id}/current/active/metadata",
        f"{user}/app/{app_id}/current/active/metadata",
        f"{FLATPAK_SYSTEM}/overrides/global",
        f"{FLATPAK_SYSTEM}/overrides/{app_id}",
        f"{user}/overrides/global",
        f"{user}/overrides/{app_id}",
    ]
    visible = False
    for source in sources:
        for entry in _flatpak_entries(launcher.read_text(source)):
            negate = entry.startswith("!")
            if _flatpak_covers(entry.lstrip("!"), dest, home):
                visible = not negate
    return visible


def _find_linux(
    spec: BrowserSpec, launcher: Launcher, home: Path, dest: Path
) -> FoundBrowser | None:
    def snap(path: str) -> FoundBrowser:
        return FoundBrowser(
            key=spec.key,
            program=path,
            sandbox="snap",
            app_id=spec.linux_snap or os.path.basename(path),
            folder_visible=_snap_sees(dest),
        )

    for name in spec.linux_commands:
        path = _linux_command(launcher, name)
        if path:
            return snap(path) if _is_snap(launcher, path) else FoundBrowser(spec.key, path)
    if spec.linux_snap and launcher.is_file(f"{SNAP_BIN}/{spec.linux_snap}"):
        return snap(f"{SNAP_BIN}/{spec.linux_snap}")
    for name in spec.linux_wrappers:
        path = _linux_command(launcher, name)
        if path:
            return snap(path) if _is_snap(launcher, path) else FoundBrowser(spec.key, path)
    if spec.linux_flatpak:
        user = str(Path(home).joinpath(*FLATPAK_USER))
        for base in (FLATPAK_SYSTEM, user):
            exported = f"{base}/exports/bin/{spec.linux_flatpak}"
            if launcher.is_file(exported):
                return FoundBrowser(
                    key=spec.key,
                    program=exported,
                    sandbox="flatpak",
                    app_id=spec.linux_flatpak,
                    folder_visible=_flatpak_sees(spec.linux_flatpak, dest, home, launcher),
                )
    return None


def _find_windows(
    spec: BrowserSpec, launcher: Launcher, env: Mapping[str, str], sep: str = "\\"
) -> FoundBrowser | None:
    for var, parts in spec.windows_paths:
        base = env.get(var)
        if base:
            candidate = sep.join([base.rstrip(sep), *parts])
            if launcher.is_file(candidate):
                return FoundBrowser(key=spec.key, program=candidate)
    return None


def detect_browsers(
    *,
    platform: str,
    launcher: Launcher,
    env: Mapping[str, str],
    home: Path,
    dest: Path,
    wsl: WslHost | None = None,
) -> list[FoundBrowser]:
    """The Chromium browsers installed on this computer, in ``BROWSER_KEYS`` order. Reads a few
    known paths and files; runs nothing. *home* is where per-user installs live. Inside WSL, the
    Windows browsers, through the mounted Windows drive."""
    found: list[FoundBrowser] = []
    wsl_env = _wsl_program_folders(wsl) if wsl is not None else None
    for spec in BROWSERS.values():
        try:
            if wsl_env is not None:
                hit = _find_windows(spec, launcher, wsl_env, sep="/")
            elif platform == "macos":
                hit = _find_mac(spec, launcher, home)
            elif platform == "linux":
                hit = _find_linux(spec, launcher, home, dest)
            elif platform == "windows":
                hit = _find_windows(spec, launcher, env)
            else:
                hit = None
        except (OSError, ValueError):
            logger.warning("%s: could not look for %s", PLUGIN_ID, spec.name, exc_info=True)
            hit = None
        if hit:
            found.append(hit)
    return found


def choose_browser(found: Sequence[FoundBrowser], key: str | None) -> FoundBrowser | None:
    """The chosen browser if installed; without a choice, the first one found."""
    if key:
        return next((b for b in found if b.key == key), None)
    return found[0] if found else None


# =========================================================================== Hermes inside WSL

WSL_RELEASE_FILES = ("/proc/sys/kernel/osrelease", "/proc/version")
WSL_CONF = "/etc/wsl.conf"
WSL_INTEROP_FILES = (
    "/proc/sys/fs/binfmt_misc/WSLInterop",
    "/proc/sys/fs/binfmt_misc/WSLInterop-late",
)
WSL_DEFAULT_ROOT = "/mnt"
WINDOWS_SYSTEM_PROFILES = frozenset(
    {
        "all users",
        "default",
        "default user",
        "public",
        "defaultuser0",
        "defaultuser100000",
        "wdagutilityaccount",
    }
)
"""Folders of ``C:\\Users`` that are never a person's own."""
_DISTRO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_DRIVE_RE = re.compile(r"^[a-z]$")
_OFF = ("false", "0", "no", "off")


@dataclass(frozen=True)
class WslHost:
    """Hermes runs inside WSL; the browser runs on Windows."""

    distro: str | None
    """``WSL_DISTRO_NAME`` when it looks like a name (for ``\\\\wsl.localhost\\<distro>``)."""
    mount_root: str
    """Where the Windows drives are mounted (``/mnt``; ``[automount] root`` of ``wsl.conf``)."""
    interop: bool
    """Windows programs can be started from WSL."""
    windows_home: Path | None
    """The Windows user folder seen from Linux (``C:\\Users\\<you>`` under ``/mnt/c``), if
    found."""

    def public(self) -> dict[str, Any]:
        return {
            "distro": self.distro,
            "interop": self.interop,
            "windows_folder": self.windows_home is not None,
        }


def _ini(text: str | None) -> configparser.ConfigParser:
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    if text:
        try:
            parser.read_string(text)
        except configparser.Error:
            return configparser.ConfigParser(interpolation=None, strict=False)
    return parser


def _conf_value(conf: configparser.ConfigParser, section: str, key: str) -> str:
    return (conf.get(section, key, fallback="") or "").strip().strip("\"'").strip()


def _wsl_mount_root(conf: configparser.ConfigParser) -> str:
    raw = _conf_value(conf, "automount", "root")
    pure = PurePosixPath(raw) if raw else None
    if pure is None or not pure.is_absolute() or ".." in pure.parts:
        return WSL_DEFAULT_ROOT
    return str(pure)


def _wsl_interop(
    conf: configparser.ConfigParser, env: Mapping[str, str], launcher: Launcher
) -> bool:
    if _conf_value(conf, "interop", "enabled").lower() in _OFF:
        return False
    if any(launcher.is_file(path) for path in WSL_INTEROP_FILES):
        return True
    return bool((env.get("WSL_INTEROP") or "").strip())


def _from_windows_path(text: str, mount: str) -> str | None:
    """``C:\\Users\\Ana`` → the same folder under the mount root (``/mnt/c/…``); ``None`` for
    anything else."""
    pure = PureWindowsPath(text)
    drive = pure.drive.rstrip(":").lower()
    if not pure.is_absolute() or not _DRIVE_RE.match(drive):
        return None
    rest = pure.parts[1:]
    if any(part in ("..", ".") for part in rest):
        return None
    return "/".join([mount.rstrip("/"), drive, *rest])


def _under(path: str, base: str) -> bool:
    parts, root = PurePosixPath(path).parts, PurePosixPath(base).parts
    return len(parts) > len(root) and parts[: len(root)] == root and ".." not in parts


def _windows_home(env: Mapping[str, str], launcher: Launcher, mount: str) -> Path | None:
    """The person's Windows user folder seen from Linux, found without running anything:
    ``USERPROFILE`` when WSL passes it on (``WSLENV``), else the only personal folder in
    ``C:\\Users`` (or the one named like the Linux user when there are several)."""
    profile = (env.get("USERPROFILE") or "").strip()
    if profile:
        linux = (
            _from_windows_path(profile, mount)
            if PureWindowsPath(profile).drive
            else (profile if PurePosixPath(profile).is_absolute() else None)
        )
        if linux and _under(linux, mount) and launcher.is_dir(linux):
            return Path(linux)
    users = f"{mount.rstrip('/')}/c/Users"
    lister = getattr(launcher, "list_dirs", None)
    names = [
        n
        for n in (lister(users) if callable(lister) else [])
        if isinstance(n, str)
        and n
        and not n.startswith(".")
        and n.lower() not in WINDOWS_SYSTEM_PROFILES
        and _safe_part(n)
    ]
    if len(names) == 1:
        return Path(f"{users}/{names[0]}")
    me = (env.get("USER") or env.get("LOGNAME") or "").strip().lower()
    same = [n for n in names if n.lower() == me]
    if me and len(same) == 1:
        return Path(f"{users}/{same[0]}")
    return None


def detect_wsl(*, env: Mapping[str, str], launcher: Launcher) -> WslHost | None:
    """``WslHost`` when Hermes runs inside WSL (kernel name with ``microsoft``, or
    ``WSL_DISTRO_NAME``); ``None`` otherwise. Reads a few files; runs nothing."""
    distro_env = (env.get("WSL_DISTRO_NAME") or "").strip()
    kernel = any(
        "microsoft" in (launcher.read_text(path) or "").lower() for path in WSL_RELEASE_FILES
    )
    if not distro_env and not kernel:
        return None
    conf = _ini(launcher.read_text(WSL_CONF))
    mount = _wsl_mount_root(conf)
    return WslHost(
        distro=distro_env if _DISTRO_RE.match(distro_env) else None,
        mount_root=mount,
        interop=_wsl_interop(conf, env, launcher),
        windows_home=_windows_home(env, launcher, mount),
    )


def wsl_home(wsl: WslHost, linux_home: Path) -> Path:
    """Where the folder goes inside WSL: the Windows user folder, so the Windows browser loads it
    from a normal Windows path; without one, the Linux home."""
    return wsl.windows_home if wsl.windows_home is not None else Path(linux_home)


def wsl_windows_path(path: Path, wsl: WslHost) -> str:
    """A Linux path as Windows writes it: ``/mnt/c/<path>`` → ``C:\\<path>``; a path
    of the Linux disk → ``\\\\wsl.localhost\\<distro>\\…`` (unchanged without a distro name)."""
    parts = PurePosixPath(str(path)).parts
    root = PurePosixPath(wsl.mount_root).parts
    n = len(root)
    if len(parts) > n and parts[:n] == root and _DRIVE_RE.match(parts[n]):
        return f"{parts[n].upper()}:\\" + "\\".join(parts[n + 1 :])
    if wsl.distro and len(parts) > 1 and parts[0] == "/":
        return "\\\\wsl.localhost\\" + "\\".join([wsl.distro, *parts[1:]])
    return str(path)


def _wsl_program_folders(wsl: WslHost) -> dict[str, str]:
    """The Windows folders browsers install into, seen from Linux (``_find_windows`` input)."""
    mount = wsl.mount_root.rstrip("/")
    folders = {
        "PROGRAMFILES": f"{mount}/c/Program Files",
        "PROGRAMFILES(X86)": f"{mount}/c/Program Files (x86)",
    }
    if wsl.windows_home is not None:
        folders["LOCALAPPDATA"] = f"{wsl.windows_home}/AppData/Local"
    return folders


# =========================================================================== opening


def _windows_explorer(launcher: Launcher, env: Mapping[str, str]) -> str:
    """``<SYSTEMROOT>\\explorer.exe``; ``which`` only as a last resort, and only an absolute
    ``explorer.exe`` outside the current folder (Windows searches the current folder first, and
    ``PATHEXT`` would accept an ``explorer.bat``)."""
    root = (env.get("SYSTEMROOT") or "").strip()
    if not root or not PureWindowsPath(root).is_absolute():
        root = WINDOWS_ROOT
    candidate = "\\".join([root.rstrip("\\"), "explorer.exe"])
    if launcher.is_file(candidate):
        return candidate
    found = launcher.which("explorer")
    if found:
        pure = PureWindowsPath(found)
        here = os.path.normcase(os.getcwd())
        if (
            pure.is_absolute()
            and pure.name.lower() == "explorer.exe"
            and os.path.normcase(str(pure.parent)) != here
        ):
            return found
    return candidate


def _open_wsl(
    dest: Path, *, launcher: Launcher, target: FoundBrowser | None, wsl: WslHost
) -> tuple[dict[str, bool], str | None, FoundBrowser | None]:
    """Hermes inside WSL: the Windows browser and Explorer, started through interop."""
    if not wsl.interop:
        return {"extensions_page": False, "folder": False}, "unsupported", target
    page = folder = False
    if target is not None:
        page = launcher.spawn([target.program, target.spec.extensions_url], SPAWN_GRACE_S)
    explorer = f"{wsl.mount_root.rstrip('/')}/c/Windows/explorer.exe"
    if launcher.is_file(explorer):
        # explorer exits with 1 even when the window opened
        folder = launcher.spawn(
            [explorer, "/select,", wsl_windows_path(dest, wsl)],
            SPAWN_GRACE_S,
            accept_exit=(0, 1),
        )
    problem = None if page else ("failed" if target is not None else "no_browser")
    return {"extensions_page": page, "folder": folder}, problem, target


def _open_all(
    dest: Path,
    *,
    platform: str,
    launcher: Launcher,
    env: Mapping[str, str],
    target: FoundBrowser | None,
    key: str | None = None,
    wsl: WslHost | None = None,
) -> tuple[dict[str, bool], str | None, FoundBrowser | None]:
    _require_absolute(dest, platform)
    if wsl is not None:
        return _open_wsl(dest, launcher=launcher, target=target, wsl=wsl)
    page = folder = False
    tried_browser = False
    used: FoundBrowser | None = target
    if platform == "macos":
        if target is not None:
            candidates = [target]
        elif key is not None:
            candidates = [FoundBrowser(key, bid) for _app, bid in BROWSERS[key].mac_apps]
        else:
            candidates = [FoundBrowser(k, BROWSERS[k].mac_apps[0][1]) for k in MAC_FALLBACK]
        used = None
        for cand in candidates:
            argv = [MAC_OPEN, "-b", cand.program, cand.spec.extensions_url]
            if launcher.run(argv, RUN_TIMEOUT_S) == 0:
                page, used = True, cand
                break
        tried_browser = target is not None
        if target is not None and not page:
            used = target
        folder = launcher.run([MAC_OPEN, "-R", str(dest)], RUN_TIMEOUT_S) == 0
    elif platform == "linux":
        has_x11 = bool(env.get("DISPLAY"))
        has_wayland = bool(env.get("WAYLAND_DISPLAY"))
        if not has_x11 and not has_wayland:
            return {"extensions_page": False, "folder": False}, "no_display", target
        if target is not None:
            tried_browser = True
            hint = ["--ozone-platform-hint=auto"] if has_wayland and not has_x11 else []
            page = launcher.spawn(
                [target.program, *hint, target.spec.extensions_url], SPAWN_GRACE_S
            )
        opener = launcher.which("xdg-open")
        if opener:
            folder = launcher.spawn([opener, str(Path(dest).parent)], SPAWN_GRACE_S)
    elif platform == "windows":
        # a chrome:// address has no file association: the browser's .exe gets it as an argument
        if target is not None:
            tried_browser = True
            page = launcher.spawn([target.program, target.spec.extensions_url], SPAWN_GRACE_S)
        explorer = _windows_explorer(launcher, env)
        # explorer exits with 1 even when the window opened
        folder = launcher.spawn(
            [explorer, "/select,", display_path(dest, "windows")],
            SPAWN_GRACE_S,
            accept_exit=(0, 1),
        )
    else:
        return {"extensions_page": False, "folder": False}, "unsupported", target
    problem = None if page else ("failed" if tried_browser else "no_browser")
    return {"extensions_page": page, "folder": folder}, problem, used


def open_targets(
    dest: Path,
    *,
    platform: str,
    launcher: Launcher,
    env: Mapping[str, str],
    target: FoundBrowser | None,
    key: str | None = None,
    wsl: WslHost | None = None,
) -> tuple[dict[str, bool], str | None]:
    """Open *target*'s Extensions page and show *dest* in the file manager.

    Returns ``({"extensions_page": bool, "folder": bool}, problem)``; ``problem`` explains a page
    that did not open (``no_browser`` | ``no_display`` | ``failed`` | ``unsupported``). A *dest*
    that is not an absolute path raises ``OSError`` before anything runs."""
    opened, problem, _used = _open_all(
        dest, platform=platform, launcher=launcher, env=env, target=target, key=key, wsl=wsl
    )
    return opened, problem


# =========================================================================== entry points


def setup(
    *,
    home: Path,
    bundle: Bundle | None,
    platform: str,
    launcher: Launcher,
    env: Mapping[str, str],
    open_apps: bool = True,
    now: float | None = None,
    browser: str | None = None,
    apps_home: Path | None = None,
    wsl: WslHost | None = None,
) -> dict[str, Any]:
    """Copy (or update) the folder, then open the browser and the file manager.

    *browser* is ``None`` or one key of ``BROWSER_KEYS`` (``ValueError`` otherwise, before
    anything is written). *wsl*: Hermes runs inside WSL — Windows browsers, Explorer through
    interop, Windows paths on screen. Returns ``ExtensionSetupResult``."""
    key = check_browser_key(browser)
    if bundle is None:
        raise SetupRefused("no_bundle", "this copy of the plugin has no built extension")
    action, version = install(home=home, bundle=bundle, now=now)
    dest = destination(home)
    found = detect_browsers(
        platform=platform, launcher=launcher, env=env, home=apps_home or home, dest=dest, wsl=wsl
    )
    target = choose_browser(found, key)
    if open_apps:
        opened, problem, used = _open_all(
            dest, platform=platform, launcher=launcher, env=env, target=target, key=key, wsl=wsl
        )
    else:
        opened, problem, used = {"extensions_page": False, "folder": False}, "disabled", target
    logger.info(
        "%s: extension folder %s (version %s); browser %s; opened %s",
        PLUGIN_ID,
        action,
        version,
        used.key if used else None,
        opened,
    )
    out: dict[str, Any] = {
        "state": "installed",
        "action": action,
        "path": display_path(dest, platform, wsl),
        "version": version,
        "opened": opened,
        "open_problem": problem,
        "platform": _public_platform(platform, wsl),
        "browser": used.public() if used else None,
    }
    if wsl is not None:
        out["wsl"] = wsl.public()
    return out


def _this_host(launcher: Launcher) -> tuple[str, WslHost | None, Path]:
    """``(platform, wsl, home)`` of the machine where Hermes runs. Inside WSL the home is the
    Windows user folder — except in test mode, which always keeps the sandbox."""
    platform = current_platform()
    wsl: WslHost | None = None
    if platform == "linux":
        try:
            wsl = detect_wsl(env=os.environ, launcher=launcher)
        except OSError:
            logger.warning("%s: could not tell whether this is WSL", PLUGIN_ID, exc_info=True)
    home = default_home()
    if wsl is not None and _test_mode() is None:
        home = wsl_home(wsl, home)
    return platform, wsl, home


def status() -> dict[str, Any]:
    """Status for the active machine (the route ``GET /extension/setup``)."""
    launcher = default_launcher()
    platform, wsl, home = _this_host(launcher)
    try:
        browsers = detect_browsers(
            platform=platform,
            launcher=launcher,
            env=os.environ,
            home=apps_home(),
            dest=destination(home),
            wsl=wsl,
        )
    except OSError:
        logger.warning("%s: could not look for browsers", PLUGIN_ID, exc_info=True)
        browsers = []
    return inspect(
        home=home, bundle=load_bundle(bundle_root()), platform=platform, browsers=browsers, wsl=wsl
    )


def run(browser: str | None = None) -> dict[str, Any]:
    """The click (the route ``POST /extension/setup``): fixed destination, real launcher, at
    most one browser key from the closed list."""
    launcher = default_launcher()
    platform, wsl, home = _this_host(launcher)
    return setup(
        home=home,
        bundle=load_bundle(bundle_root()),
        platform=platform,
        launcher=launcher,
        env=os.environ,
        open_apps=apps_allowed(),
        browser=browser,
        apps_home=apps_home(),
        wsl=wsl,
    )


__all__ = [
    "BROWSERS",
    "BROWSER_KEYS",
    "EXTENSIONS_URL",
    "FOLDER_NAME",
    "MARKER_NAME",
    "Bundle",
    "BrowserSpec",
    "FoundBrowser",
    "Launcher",
    "SetupRefused",
    "SystemLauncher",
    "WslHost",
    "apps_allowed",
    "apps_home",
    "bundle_root",
    "check_browser_key",
    "choose_browser",
    "current_platform",
    "default_home",
    "default_launcher",
    "destination",
    "detect_browsers",
    "detect_wsl",
    "display_path",
    "inspect",
    "install",
    "load_bundle",
    "open_targets",
    "run",
    "setup",
    "status",
    "version_key",
    "wsl_home",
    "wsl_windows_path",
]
