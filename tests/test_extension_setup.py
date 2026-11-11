"""\"Set up the extension\": the backend copies the bundled Chrome extension into a fixed folder in
the home folder and opens Chrome's Extensions page and the file manager.

Everything here runs against a fake home (``tmp_path``) and a fake launcher: no real folder in the
real home, no real program started. Covered: first copy with the marker, refusing a folder that is
not ours (and symlinks), updates that only touch our own files, version comparison, each operating
system's fixed argument lists, failures to open, and the REST envelopes.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import stat
from collections.abc import Sequence
from pathlib import Path, PureWindowsPath
from typing import Any

import pytest

from tube_pkg._id import PLUGIN_ID

setup_mod = importlib.import_module("tube_pkg.core.extension_setup")
api = importlib.import_module("tube_pkg.api.extension")

URL = "chrome://extensions/"
OPEN = "/usr/bin/open"
"""macOS: always the absolute path, never whatever ``open`` comes first in PATH."""


# --------------------------------------------------------------------------- fixtures


def make_bundle(root: Path, version: str = "0.1.0", *, extra: dict[str, str] | None = None) -> Path:
    """A small built extension: manifest, a script, a nested asset and an icon."""
    files = {
        "manifest.json": json.dumps(
            {"manifest_version": 3, "name": "HermesTube", "version": version}
        ),
        "background.js": f"// background {version}\n",
        "assets/popup.js": f"// popup {version}\n",
        "popup/index.html": "<!doctype html><title>x</title>\n",
        "icons/icon-16.png": "png",
    }
    files.update(extra or {})
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return root


class FakeLauncher:
    """Records every command. ``run`` answers from ``codes`` (argv[0..2] prefix → exit code);
    ``spawn`` answers from ``spawn_ok``. Commands never reach a real process; the file checks
    (``is_file``, ``is_dir``, ``bundle_id``, ``read_text``) answer from the given tables."""

    def __init__(
        self,
        *,
        codes: dict[tuple[str, ...], int | None] | None = None,
        spawn_ok: bool = True,
        which: dict[str, str] | None = None,
        files: set[str] | None = None,
        bundles: dict[str, str] | None = None,
        texts: dict[str, str] | None = None,
        links: dict[str, str] | None = None,
        dirs: dict[str, list[str]] | None = None,
    ) -> None:
        self.dirs = dirs or {}
        self.codes = codes or {}
        self.spawn_ok = spawn_ok
        self.which_map = which or {}
        self.files = files or set()
        self.bundles = bundles or {}
        self.texts = texts or {}
        self.links = links or {}
        self.calls: list[tuple[str, list[str], float]] = []
        self.accepts: list[tuple[int, ...]] = []

    def run(self, argv: Sequence[str], timeout: float) -> int | None:
        self.calls.append(("run", list(argv), timeout))
        for n in (3, 2, 1):
            key = tuple(argv[:n])
            if key in self.codes:
                return self.codes[key]
        return 0

    def spawn(
        self, argv: Sequence[str], grace: float, *, accept_exit: tuple[int, ...] = (0,)
    ) -> bool:
        self.calls.append(("spawn", list(argv), grace))
        self.accepts.append(accept_exit)
        return self.spawn_ok

    def which(self, name: str) -> str | None:
        return self.which_map.get(name)

    def is_file(self, path: str) -> bool:
        return path in self.files

    def is_dir(self, path: str) -> bool:
        if path in self.dirs or any(
            path in [f"{d}/{n}" for n in ns] for d, ns in self.dirs.items()
        ):
            return True
        return path in self.bundles or any(f.startswith(path.rstrip("/") + "/") for f in self.files)

    def list_dirs(self, path: str) -> list[str]:
        return list(self.dirs.get(path, []))

    def bundle_id(self, app: str) -> str | None:
        return self.bundles.get(app)

    def read_text(self, path: str) -> str | None:
        return self.texts.get(path)

    def realpath(self, path: str) -> str:
        return self.links.get(path, path)

    @property
    def argvs(self) -> list[list[str]]:
        return [argv for _kind, argv, _t in self.calls]


@pytest.fixture
def home(tmp_path: Path) -> Path:
    h = tmp_path / "home"
    h.mkdir()
    return h


@pytest.fixture
def bundle_dir(tmp_path: Path) -> Path:
    return make_bundle(tmp_path / "bundle")


def bundle_of(path: Path) -> Any:
    b = setup_mod.load_bundle(path)
    assert b is not None
    return b


def run_setup(
    home: Path,
    bundle_dir: Path | None,
    launcher: FakeLauncher,
    platform: str = "macos",
    *,
    browser: str | None = None,
    env: dict[str, str] | None = None,
):
    bundle = setup_mod.load_bundle(bundle_dir) if bundle_dir is not None else None
    return setup_mod.setup(
        home=home,
        bundle=bundle,
        platform=platform,
        launcher=launcher,
        env={"DISPLAY": ":0"} if env is None else env,
        browser=browser,
    )


def dest_of(home: Path) -> Path:
    return home / setup_mod.FOLDER_NAME


# --------------------------------------------------------------------------- bundle and status


def test_bundle_reads_version_and_lists_files(bundle_dir: Path) -> None:
    b = bundle_of(bundle_dir)
    assert b.version == "0.1.0"
    assert set(b.files) == {
        "manifest.json",
        "background.js",
        "assets/popup.js",
        "popup/index.html",
        "icons/icon-16.png",
    }
    assert len(b.digest) == 64


def test_bundle_missing_or_broken_is_none(tmp_path: Path) -> None:
    assert setup_mod.load_bundle(tmp_path / "nope") is None
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "manifest.json").write_text("{not json", encoding="utf-8")
    assert setup_mod.load_bundle(broken) is None


def test_the_shipped_bundle_location_is_inside_the_plugin() -> None:
    root = setup_mod.bundle_root()
    assert root.name == "extension"
    assert root.parent.name == "plugin"


def test_destination_is_fixed_under_home(home: Path) -> None:
    assert setup_mod.destination(home) == home / "HermesTube Extension"
    assert setup_mod.MARKER_NAME == f"{PLUGIN_ID}-folder.json"


def test_status_not_installed_then_installed(home: Path, bundle_dir: Path) -> None:
    b = bundle_of(bundle_dir)
    st = setup_mod.inspect(home=home, bundle=b, platform="macos")
    assert st["state"] == "not_installed"
    assert st["path"] == str(dest_of(home))
    assert st["bundled_version"] == "0.1.0"
    assert st["installed_version"] is None
    run_setup(home, bundle_dir, FakeLauncher())
    st = setup_mod.inspect(home=home, bundle=b, platform="macos")
    assert st["state"] == "installed"
    assert st["installed_version"] == "0.1.0"


def test_status_without_bundle_is_unavailable(home: Path) -> None:
    st = setup_mod.inspect(home=home, bundle=None, platform="linux")
    assert st["state"] == "unavailable"
    assert st["bundled_version"] is None
    assert st["platform"] == "linux"


# --------------------------------------------------------------------------- first copy


def test_first_setup_copies_everything_and_writes_the_marker(home: Path, bundle_dir: Path) -> None:
    out = run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    assert out["action"] == "installed"
    assert out["state"] == "installed"
    assert out["path"] == str(dest)
    assert out["version"] == "0.1.0"
    for rel in bundle_of(bundle_dir).files:
        assert (dest / rel).read_bytes() == (bundle_dir / rel).read_bytes(), rel
    marker = json.loads((dest / setup_mod.MARKER_NAME).read_text(encoding="utf-8"))
    assert marker["created_by"] == PLUGIN_ID
    assert marker["version"] == "0.1.0"
    assert marker["digest"] == bundle_of(bundle_dir).digest
    assert sorted(marker["files"]) == sorted(bundle_of(bundle_dir).files)
    # no staging folder is left next to it
    assert sorted(p.name for p in home.iterdir()) == [setup_mod.FOLDER_NAME]


def test_setup_without_bundle_is_refused(home: Path) -> None:
    with pytest.raises(setup_mod.SetupRefused) as err:
        run_setup(home, None, FakeLauncher())
    assert err.value.reason == "no_bundle"
    assert list(home.iterdir()) == []


def test_setup_again_when_up_to_date_copies_nothing_but_opens_again(
    home: Path, bundle_dir: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    before = (dest / "background.js").stat().st_mtime_ns
    launcher = FakeLauncher()
    out = run_setup(home, bundle_dir, launcher)
    assert out["action"] == "unchanged"
    assert (dest / "background.js").stat().st_mtime_ns == before
    assert launcher.calls  # the pages open again


# --------------------------------------------------------------------------- somebody else's folder


def test_refuses_an_existing_folder_without_the_marker(home: Path, bundle_dir: Path) -> None:
    dest = dest_of(home)
    dest.mkdir()
    (dest / "notes.txt").write_text("mine", encoding="utf-8")
    assert setup_mod.inspect(home=home, bundle=bundle_of(bundle_dir), platform="macos")[
        "state"
    ] == ("not_ours")
    launcher = FakeLauncher()
    with pytest.raises(setup_mod.SetupRefused) as err:
        run_setup(home, bundle_dir, launcher)
    assert err.value.reason == "not_ours"
    assert sorted(p.name for p in dest.iterdir()) == ["notes.txt"]
    assert launcher.calls == []  # nothing opened either


def test_refuses_a_marker_written_by_someone_else(home: Path, bundle_dir: Path) -> None:
    dest = dest_of(home)
    dest.mkdir()
    (dest / setup_mod.MARKER_NAME).write_text(json.dumps({"created_by": "other"}), "utf-8")
    with pytest.raises(setup_mod.SetupRefused):
        run_setup(home, bundle_dir, FakeLauncher())


def test_refuses_a_file_where_the_folder_should_be(home: Path, bundle_dir: Path) -> None:
    dest_of(home).write_text("x", encoding="utf-8")
    with pytest.raises(setup_mod.SetupRefused) as err:
        run_setup(home, bundle_dir, FakeLauncher())
    assert err.value.reason == "not_ours"
    assert dest_of(home).read_text(encoding="utf-8") == "x"


def test_refuses_a_symlinked_destination(home: Path, bundle_dir: Path, tmp_path: Path) -> None:
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    # even a symlink to a folder that carries our marker is refused: we never write through links
    run_setup(elsewhere, bundle_dir, FakeLauncher())
    dest_of(home).symlink_to(dest_of(elsewhere), target_is_directory=True)
    assert setup_mod.inspect(home=home, bundle=bundle_of(bundle_dir), platform="macos")[
        "state"
    ] == ("not_ours")
    with pytest.raises(setup_mod.SetupRefused):
        run_setup(home, bundle_dir, FakeLauncher())


def test_never_writes_through_a_symlinked_subfolder(
    home: Path, bundle_dir: Path, tmp_path: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    outside = tmp_path / "outside"
    outside.mkdir()
    for child in (dest / "assets").iterdir():
        child.unlink()
    (dest / "assets").rmdir()
    (dest / "assets").symlink_to(outside, target_is_directory=True)
    newer = make_bundle(tmp_path / "bundle2", "0.2.0")
    with pytest.raises(OSError):
        run_setup(home, newer, FakeLauncher())
    assert list(outside.iterdir()) == []


# --------------------------------------------------------------------------- updates


def test_newer_bundle_means_update_available_and_update_rewrites_in_place(
    home: Path, bundle_dir: Path, tmp_path: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    (dest / "my-notes.txt").write_text("keep me", encoding="utf-8")
    newer = make_bundle(tmp_path / "bundle2", "0.2.0", extra={"assets/new.js": "// new\n"})
    (newer / "icons" / "icon-16.png").unlink()  # a file the new build no longer ships
    st = setup_mod.inspect(home=home, bundle=bundle_of(newer), platform="macos")
    assert st["state"] == "update_available"
    assert st["installed_version"] == "0.1.0"
    assert st["bundled_version"] == "0.2.0"
    out = run_setup(home, newer, FakeLauncher())
    assert out["action"] == "updated"
    assert out["version"] == "0.2.0"
    assert (dest / "background.js").read_text(encoding="utf-8") == "// background 0.2.0\n"
    assert (dest / "assets" / "new.js").is_file()
    # our old file that the new build dropped is gone; the person's own file stays
    assert not (dest / "icons" / "icon-16.png").exists()
    assert (dest / "my-notes.txt").read_text(encoding="utf-8") == "keep me"
    marker = json.loads((dest / setup_mod.MARKER_NAME).read_text(encoding="utf-8"))
    assert marker["version"] == "0.2.0"
    assert setup_mod.inspect(home=home, bundle=bundle_of(newer), platform="macos")["state"] == (
        "installed"
    )


def test_update_keeps_a_file_that_replaced_ours_with_a_link(
    home: Path, bundle_dir: Path, tmp_path: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    target = tmp_path / "precious.png"
    target.write_text("precious", encoding="utf-8")
    (dest / "icons" / "icon-16.png").unlink()
    (dest / "icons" / "icon-16.png").symlink_to(target)
    newer = make_bundle(tmp_path / "bundle2", "0.2.0")
    (newer / "icons" / "icon-16.png").unlink()
    run_setup(home, newer, FakeLauncher())
    # a link we did not create is not removed, and its target is never touched
    assert (dest / "icons" / "icon-16.png").is_symlink()
    assert target.read_text(encoding="utf-8") == "precious"


def test_same_version_with_other_files_is_an_update(
    home: Path, bundle_dir: Path, tmp_path: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    rebuilt = make_bundle(tmp_path / "rebuilt", "0.1.0", extra={"background.js": "// fixed\n"})
    assert setup_mod.inspect(home=home, bundle=bundle_of(rebuilt), platform="macos")["state"] == (
        "update_available"
    )


def test_a_missing_file_in_our_folder_is_repaired(home: Path, bundle_dir: Path) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    (dest_of(home) / "background.js").unlink()
    b = bundle_of(bundle_dir)
    assert setup_mod.inspect(home=home, bundle=b, platform="macos")["state"] == "update_available"
    out = run_setup(home, bundle_dir, FakeLauncher())
    assert out["action"] == "updated"
    assert (dest_of(home) / "background.js").is_file()


def test_an_older_bundle_never_downgrades(home: Path, bundle_dir: Path, tmp_path: Path) -> None:
    newer = make_bundle(tmp_path / "bundle2", "0.3.0")
    run_setup(home, newer, FakeLauncher())
    st = setup_mod.inspect(home=home, bundle=bundle_of(bundle_dir), platform="macos")
    assert st["state"] == "installed"
    out = run_setup(home, bundle_dir, FakeLauncher())
    assert out["action"] == "unchanged"
    assert out["version"] == "0.3.0"


@pytest.mark.parametrize(
    ("a", "b", "newer"),
    [("0.2.0", "0.1.9", True), ("0.10.0", "0.9.0", True), ("1.0", "1.0.0", False)],
)
def test_version_order(a: str, b: str, newer: bool) -> None:
    assert (setup_mod.version_key(a) > setup_mod.version_key(b)) is newer


def test_copied_files_are_readable_by_chrome(home: Path, bundle_dir: Path) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    mode = (dest_of(home) / "background.js").stat().st_mode
    assert mode & stat.S_IRUSR
    assert not mode & stat.S_IWOTH


# --------------------------------------------------------------------------- opening, per system


def test_macos_opens_chrome_by_bundle_id_and_reveals_the_folder(
    home: Path, bundle_dir: Path
) -> None:
    launcher = FakeLauncher()
    out = run_setup(home, bundle_dir, launcher, "macos")
    dest = str(dest_of(home))
    assert launcher.argvs == [[OPEN, "-b", "com.google.Chrome", URL], [OPEN, "-R", dest]]
    assert all(kind == "run" and 0 < t <= 5 for kind, _a, t in launcher.calls)
    assert out["opened"] == {"extensions_page": True, "folder": True}
    assert out["open_problem"] is None
    assert out["platform"] == "macos"


def test_macos_falls_back_to_chromium_then_reports_no_browser(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(codes={(OPEN, "-b", "com.google.Chrome"): 1})
    out = run_setup(home, bundle_dir, launcher, "macos")
    assert [OPEN, "-b", "org.chromium.Chromium", URL] in launcher.argvs
    assert out["opened"]["extensions_page"] is True
    launcher = FakeLauncher(
        codes={(OPEN, "-b", "com.google.Chrome"): 1, (OPEN, "-b", "org.chromium.Chromium"): 1}
    )
    out = run_setup(home, bundle_dir, launcher, "macos")
    assert out["opened"] == {"extensions_page": False, "folder": True}
    assert out["open_problem"] == "no_browser"


def test_macos_timeout_counts_as_a_failure(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(codes={(OPEN, "-b"): None, (OPEN, "-R"): None})
    out = run_setup(home, bundle_dir, launcher, "macos")
    assert out["opened"] == {"extensions_page": False, "folder": False}
    assert out["open_problem"] == "no_browser"
    # the copy itself still happened
    assert out["action"] == "installed"


def test_linux_uses_the_chrome_binary_and_xdg_open(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(
        which={
            "google-chrome": "/usr/bin/google-chrome",
            "xdg-open": "/usr/bin/xdg-open",
            "chromium": "/usr/bin/chromium",
        }
    )
    out = run_setup(home, bundle_dir, launcher, "linux")
    assert launcher.calls[0][:2] == ("spawn", ["/usr/bin/google-chrome", URL])
    # the home folder, so the extension folder can be dragged from it
    assert launcher.calls[1][:2] == ("spawn", ["/usr/bin/xdg-open", str(home)])
    assert out["opened"] == {"extensions_page": True, "folder": True}


def test_linux_without_chrome_or_display(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(which={"xdg-open": "/usr/bin/xdg-open"})
    out = run_setup(home, bundle_dir, launcher, "linux")
    assert out["opened"] == {"extensions_page": False, "folder": True}
    assert out["open_problem"] == "no_browser"
    launcher = FakeLauncher(which={"google-chrome": "/usr/bin/google-chrome"})
    out = setup_mod.setup(
        home=home,
        bundle=bundle_of(bundle_dir),
        platform="linux",
        launcher=launcher,
        env={},  # no DISPLAY / WAYLAND_DISPLAY: a server without a screen
    )
    assert launcher.calls == []
    assert out["opened"] == {"extensions_page": False, "folder": False}
    assert out["open_problem"] == "no_display"


def test_linux_chrome_that_exits_at_once_is_a_failure(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(spawn_ok=False, which={"chromium": "/usr/bin/chromium"})
    out = run_setup(home, bundle_dir, launcher, "linux")
    assert out["opened"]["extensions_page"] is False
    assert out["open_problem"] == "failed"


def test_windows_uses_chrome_exe_and_explorer_select(home: Path, bundle_dir: Path) -> None:
    exe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    launcher = FakeLauncher(files={exe}, which={"explorer": "C:\\Windows\\explorer.exe"})
    out = setup_mod.setup(
        home=home,
        bundle=bundle_of(bundle_dir),
        platform="windows",
        launcher=launcher,
        env={"PROGRAMFILES": "C:\\Program Files"},
    )
    assert launcher.calls[0][:2] == ("spawn", [exe, URL])
    shown = str(PureWindowsPath(dest_of(home)))
    assert launcher.calls[1][:2] == ("spawn", ["C:\\Windows\\explorer.exe", "/select,", shown])
    assert out["opened"] == {"extensions_page": True, "folder": True}
    assert out["path"] == shown  # backslashes on screen and in the copy button
    assert out["browser"]["key"] == "chrome"


def test_other_systems_open_nothing(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher()
    out = run_setup(home, bundle_dir, launcher, "other")
    assert launcher.calls == []
    assert out["open_problem"] == "unsupported"
    assert out["action"] == "installed"


def test_every_command_is_a_fixed_list_without_a_shell(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher()
    run_setup(home, bundle_dir, launcher, "macos")
    for argv in launcher.argvs:
        assert isinstance(argv, list) and all(isinstance(a, str) for a in argv)
        assert argv[0] in (OPEN,)
        assert not any(a in ("sh", "bash", "-c", "cmd", "/c") for a in argv)


# --------------------------------------------------------------------------- real launcher


def test_real_launcher_run_has_a_timeout_and_no_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    def fake_run(argv: Any, **kw: Any) -> Any:
        seen.update(kw, argv=argv)

        class Done:
            returncode = 0

        return Done()

    monkeypatch.setattr(setup_mod.subprocess, "run", fake_run)
    rc = setup_mod.SystemLauncher().run(["open", "-R", "/x"], timeout=2.5)
    assert rc == 0
    assert seen["argv"] == ["open", "-R", "/x"]
    assert seen["timeout"] == 2.5
    assert seen.get("shell", False) is False


def test_real_launcher_turns_timeouts_and_missing_programs_into_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom_timeout(argv: Any, **kw: Any) -> Any:
        raise setup_mod.subprocess.TimeoutExpired(argv, kw.get("timeout", 0))

    monkeypatch.setattr(setup_mod.subprocess, "run", boom_timeout)
    assert setup_mod.SystemLauncher().run(["open"], timeout=1) is None

    def boom_missing(argv: Any, **kw: Any) -> Any:
        raise FileNotFoundError(argv[0])

    monkeypatch.setattr(setup_mod.subprocess, "run", boom_missing)
    assert setup_mod.SystemLauncher().run(["open"], timeout=1) is None


def test_real_launcher_spawn_never_uses_a_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    class Proc:
        def wait(self, timeout: float) -> int:
            raise setup_mod.subprocess.TimeoutExpired("x", timeout)

    def fake_popen(argv: Any, **kw: Any) -> Any:
        seen.update(kw, argv=argv)
        return Proc()

    monkeypatch.setattr(setup_mod.subprocess, "Popen", fake_popen)
    assert setup_mod.SystemLauncher().spawn(["/usr/bin/chromium", URL], 0.5) is True
    assert seen["argv"] == ["/usr/bin/chromium", URL]
    assert seen.get("shell", False) is False


def test_real_launcher_reads_a_bundle_id_and_small_texts(tmp_path: Path) -> None:
    import plistlib

    app = tmp_path / "Brave Browser.app"
    (app / "Contents").mkdir(parents=True)
    (app / "Contents" / "Info.plist").write_bytes(
        plistlib.dumps({"CFBundleIdentifier": "com.brave.Browser"})
    )
    real = setup_mod.SystemLauncher()
    assert real.bundle_id(str(app)) == "com.brave.Browser"
    assert real.bundle_id(str(tmp_path / "Nope.app")) is None
    (tmp_path / "metadata").write_text("[Context]\nfilesystems=home;\n", encoding="utf-8")
    assert "home" in (real.read_text(str(tmp_path / "metadata")) or "")
    assert real.read_text(str(tmp_path / "missing")) is None
    big = tmp_path / "big"
    big.write_bytes(b"x" * (setup_mod.MAX_TEXT_BYTES + 1))
    assert real.read_text(str(big)) is None  # never reads a large file


# --------------------------------------------------------------------------- any Chromium browser

ALL_KEYS = ("chrome", "edge", "brave", "chromium", "vivaldi", "opera", "arc")


def test_the_browser_list_is_closed_and_each_has_its_own_extensions_page() -> None:
    assert setup_mod.BROWSER_KEYS == ALL_KEYS
    pages = {k: setup_mod.BROWSERS[k].extensions_url for k in ALL_KEYS}
    assert pages == {
        "chrome": "chrome://extensions/",
        "edge": "edge://extensions/",
        "brave": "brave://extensions/",
        "chromium": "chrome://extensions/",
        "vivaldi": "vivaldi://extensions/",
        "opera": "opera://extensions/",
        "arc": "chrome://extensions/",
    }
    # Arc exists only on macOS (and Windows, where it is not a Chromium we can open by path)
    assert not setup_mod.BROWSERS["arc"].linux_commands
    assert not setup_mod.BROWSERS["arc"].windows_paths


def detect(platform: str, launcher: FakeLauncher, home: str = "/home/Ana", env=None) -> list[dict]:
    found = setup_mod.detect_browsers(
        platform=platform,
        launcher=launcher,
        env=env or {},
        home=Path(home),
        dest=Path(home) / setup_mod.FOLDER_NAME,
    )
    return [f.public() for f in found]


def test_macos_detects_installed_browsers_by_bundle_id(tmp_path: Path) -> None:
    home = str(tmp_path / "u")
    launcher = FakeLauncher(
        bundles={
            "/Applications/Google Chrome.app": "com.google.Chrome",
            "/Applications/Brave Browser.app": "com.brave.Browser",
            f"{home}/Applications/Microsoft Edge.app": "com.microsoft.edgemac",
            "/Applications/Arc.app": "company.thebrowser.Browser",
            "/Applications/Chromium.app": "com.example.NotChromium",  # right name, wrong app
        }
    )
    found = detect("macos", launcher, home)
    assert [b["key"] for b in found] == ["chrome", "edge", "brave", "arc"]
    assert all(b["sandbox"] is None and b["folder_visible"] is True for b in found)
    assert found[1] == {
        "key": "edge",
        "name": "Microsoft Edge",
        "extensions_url": "edge://extensions/",
        "sandbox": None,
        "app_id": None,
        "folder_visible": True,
    }
    assert launcher.calls == []  # detecting runs nothing


def test_macos_opens_the_chosen_browser_with_its_own_page(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(
        bundles={
            "/Applications/Google Chrome.app": "com.google.Chrome",
            "/Applications/Microsoft Edge.app": "com.microsoft.edgemac",
        }
    )
    out = run_setup(home, bundle_dir, launcher, "macos", browser="edge")
    assert launcher.argvs[0] == [OPEN, "-b", "com.microsoft.edgemac", "edge://extensions/"]
    assert out["browser"]["key"] == "edge"
    assert out["opened"]["extensions_page"] is True


def test_macos_without_a_choice_uses_the_only_or_the_first_installed(
    home: Path, bundle_dir: Path
) -> None:
    only_brave = FakeLauncher(bundles={"/Applications/Brave Browser.app": "com.brave.Browser"})
    out = run_setup(home, bundle_dir, only_brave, "macos")
    assert only_brave.argvs[0] == [OPEN, "-b", "com.brave.Browser", "brave://extensions/"]
    assert out["browser"]["key"] == "brave"
    both = FakeLauncher(
        bundles={
            "/Applications/Vivaldi.app": "com.vivaldi.Vivaldi",
            "/Applications/Opera.app": "com.operasoftware.Opera",
        }
    )
    out = run_setup(home, bundle_dir, both, "macos")
    assert both.argvs[0] == [OPEN, "-b", "com.vivaldi.Vivaldi", "vivaldi://extensions/"]


def test_macos_chosen_browser_that_fails_does_not_fall_back_to_another(
    home: Path, bundle_dir: Path
) -> None:
    launcher = FakeLauncher(codes={(OPEN, "-b", "com.operasoftware.Opera"): 1})
    out = run_setup(home, bundle_dir, launcher, "macos", browser="opera")
    browser_calls = [a for a in launcher.argvs if a[:2] == [OPEN, "-b"]]
    assert browser_calls == [[OPEN, "-b", "com.operasoftware.Opera", "opera://extensions/"]]
    assert out["opened"]["extensions_page"] is False
    assert out["open_problem"] == "no_browser"


@pytest.mark.parametrize(
    ("which", "files", "key", "sandbox", "app_id", "program"),
    [
        (
            {"google-chrome": "/usr/bin/google-chrome"},
            set(),
            "chrome",
            None,
            None,
            "/usr/bin/google-chrome",
        ),
        (
            {"microsoft-edge-stable": "/usr/bin/microsoft-edge-stable"},
            set(),
            "edge",
            None,
            None,
            "/usr/bin/microsoft-edge-stable",
        ),
        (
            {"brave-browser": "/usr/bin/brave-browser"},
            set(),
            "brave",
            None,
            None,
            "/usr/bin/brave-browser",
        ),
        (
            {"vivaldi-stable": "/usr/bin/vivaldi-stable"},
            set(),
            "vivaldi",
            None,
            None,
            "/usr/bin/vivaldi-stable",
        ),
        ({"opera": "/usr/bin/opera"}, set(), "opera", None, None, "/usr/bin/opera"),
        ({"chromium": "/usr/bin/chromium"}, set(), "chromium", None, None, "/usr/bin/chromium"),
        # Ubuntu: `chromium` is the snap
        (
            {"chromium": "/snap/bin/chromium"},
            set(),
            "chromium",
            "snap",
            "chromium",
            "/snap/bin/chromium",
        ),
        # not on PATH (a service with a short PATH): the snap's fixed place
        ({}, {"/snap/bin/chromium"}, "chromium", "snap", "chromium", "/snap/bin/chromium"),
        # Ubuntu's `chromium-browser` is a wrapper around the snap: the snap is what runs
        (
            {"chromium-browser": "/usr/bin/chromium-browser"},
            {"/snap/bin/chromium"},
            "chromium",
            "snap",
            "chromium",
            "/snap/bin/chromium",
        ),
        ({}, {"/snap/bin/brave"}, "brave", "snap", "brave", "/snap/bin/brave"),
        ({}, {"/usr/bin/microsoft-edge"}, "edge", None, None, "/usr/bin/microsoft-edge"),
        (
            {},
            {"/var/lib/flatpak/exports/bin/com.google.Chrome"},
            "chrome",
            "flatpak",
            "com.google.Chrome",
            "/var/lib/flatpak/exports/bin/com.google.Chrome",
        ),
        (
            {},
            {"/home/Ana/.local/share/flatpak/exports/bin/org.chromium.Chromium"},
            "chromium",
            "flatpak",
            "org.chromium.Chromium",
            "/home/Ana/.local/share/flatpak/exports/bin/org.chromium.Chromium",
        ),
        (
            {},
            {"/var/lib/flatpak/exports/bin/com.brave.Browser"},
            "brave",
            "flatpak",
            "com.brave.Browser",
            "/var/lib/flatpak/exports/bin/com.brave.Browser",
        ),
        (
            {},
            {"/var/lib/flatpak/exports/bin/com.microsoft.Edge"},
            "edge",
            "flatpak",
            "com.microsoft.Edge",
            "/var/lib/flatpak/exports/bin/com.microsoft.Edge",
        ),
    ],
)
def test_linux_detects_native_snap_and_flatpak_browsers(
    which: dict[str, str],
    files: set[str],
    key: str,
    sandbox: str | None,
    app_id: str | None,
    program: str,
) -> None:
    launcher = FakeLauncher(which=which, files=files)
    found = setup_mod.detect_browsers(
        platform="linux",
        launcher=launcher,
        env={},
        home=Path("/home/Ana"),
        dest=Path("/home/Ana") / setup_mod.FOLDER_NAME,
    )
    assert [f.key for f in found] == [key]
    assert found[0].public()["sandbox"] == sandbox
    assert found[0].public()["app_id"] == app_id
    assert found[0].program == program
    assert launcher.calls == []


def test_linux_several_browsers_keep_the_fixed_order() -> None:
    launcher = FakeLauncher(
        which={"opera": "/usr/bin/opera", "brave-browser": "/usr/bin/brave-browser"},
        files={"/var/lib/flatpak/exports/bin/com.google.Chrome"},
    )
    assert [b["key"] for b in detect("linux", launcher)] == ["chrome", "brave", "opera"]


FLATPAK_META = "/var/lib/flatpak/app/com.google.Chrome/current/active/metadata"
FLATPAK_USER_OVERRIDE = "/home/Ana/.local/share/flatpak/overrides/com.google.Chrome"


@pytest.mark.parametrize(
    ("texts", "visible"),
    [
        ({}, False),  # no metadata readable: assume it does not see the home folder
        ({FLATPAK_META: "[Context]\nfilesystems=xdg-download;\n"}, False),
        ({FLATPAK_META: "[Context]\nfilesystems=xdg-download;home;\n"}, True),
        ({FLATPAK_META: "[Context]\nfilesystems=host;\n"}, True),
        ({FLATPAK_META: "[Context]\nfilesystems=~/HermesTube Extension:ro;\n"}, True),
        (
            {
                FLATPAK_META: "[Context]\nfilesystems=xdg-download;\n",
                FLATPAK_USER_OVERRIDE: (
                    "[Context]\nfilesystems=/home/Ana/HermesTube Extension:ro;\n"
                ),
            },
            True,
        ),
        (
            {
                FLATPAK_META: "[Context]\nfilesystems=home;\n",
                FLATPAK_USER_OVERRIDE: "[Context]\nfilesystems=!home;\n",
            },
            False,
        ),
        ({FLATPAK_META: "not an ini file ["}, False),
    ],
)
def test_linux_flatpak_folder_visibility_is_read_from_its_permissions(
    texts: dict[str, str], visible: bool
) -> None:
    launcher = FakeLauncher(files={"/var/lib/flatpak/exports/bin/com.google.Chrome"}, texts=texts)
    (chrome,) = detect("linux", launcher)
    assert chrome["sandbox"] == "flatpak"
    assert chrome["folder_visible"] is visible


def test_linux_snap_sees_the_folder_only_under_home() -> None:
    launcher = FakeLauncher(files={"/snap/bin/chromium"})
    assert detect("linux", launcher, "/home/Ana")[0]["folder_visible"] is True
    assert detect("linux", launcher, "/srv/hermes")[0]["folder_visible"] is False


def test_linux_opens_the_chosen_browser_and_wayland_gets_the_platform_hint(
    home: Path, bundle_dir: Path
) -> None:
    exported = "/var/lib/flatpak/exports/bin/com.brave.Browser"
    launcher = FakeLauncher(
        which={"google-chrome": "/usr/bin/google-chrome", "xdg-open": "/usr/bin/xdg-open"},
        files={exported},
    )
    out = run_setup(home, bundle_dir, launcher, "linux", browser="brave", env={"DISPLAY": ":0"})
    assert launcher.calls[0][:2] == ("spawn", [exported, "brave://extensions/"])
    assert out["browser"]["key"] == "brave"
    assert out["browser"]["sandbox"] == "flatpak"
    wayland = FakeLauncher(which={"google-chrome": "/usr/bin/google-chrome"})
    run_setup(home, bundle_dir, wayland, "linux", env={"WAYLAND_DISPLAY": "wayland-0"})
    assert wayland.calls[0][:2] == (
        "spawn",
        ["/usr/bin/google-chrome", "--ozone-platform-hint=auto", URL],
    )


def test_linux_chosen_browser_not_installed_opens_no_other(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(which={"google-chrome": "/usr/bin/google-chrome"})
    out = run_setup(home, bundle_dir, launcher, "linux", browser="vivaldi")
    assert all("/usr/bin/google-chrome" not in a for a in launcher.argvs)
    assert out["open_problem"] == "no_browser"
    assert out["browser"] is None


WIN_ENV = {
    "PROGRAMFILES": "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    "LOCALAPPDATA": "C:\\Users\\Ana\\AppData\\Local",
    "SYSTEMROOT": "C:\\Windows",
}


@pytest.mark.parametrize(
    ("exe", "key", "page"),
    [
        ("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "chrome", URL),
        ("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "chrome", URL),
        ("C:\\Users\\Ana\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe", "chrome", URL),
        (
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "edge",
            "edge://extensions/",
        ),
        (
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
            "edge",
            "edge://extensions/",
        ),
        (
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            "brave",
            "brave://extensions/",
        ),
        (
            "C:\\Users\\Ana\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            "brave",
            "brave://extensions/",
        ),
        ("C:\\Users\\Ana\\AppData\\Local\\Chromium\\Application\\chrome.exe", "chromium", URL),
        (
            "C:\\Users\\Ana\\AppData\\Local\\Vivaldi\\Application\\vivaldi.exe",
            "vivaldi",
            "vivaldi://extensions/",
        ),
        (
            "C:\\Users\\Ana\\AppData\\Local\\Programs\\Opera\\opera.exe",
            "opera",
            "opera://extensions/",
        ),
        (
            "C:\\Users\\Ana\\AppData\\Local\\Programs\\Opera\\launcher.exe",
            "opera",
            "opera://extensions/",
        ),
    ],
)
def test_windows_finds_each_browser_in_its_known_place_and_runs_the_exe(
    exe: str, key: str, page: str
) -> None:
    launcher = FakeLauncher(files={exe})
    dest = Path("C:\\Users\\Ana") / setup_mod.FOLDER_NAME
    found = setup_mod.detect_browsers(
        platform="windows", launcher=launcher, env=WIN_ENV, home=Path("C:\\Users\\Ana"), dest=dest
    )
    assert [f.key for f in found] == [key]
    opened, problem = setup_mod.open_targets(
        dest, platform="windows", launcher=launcher, env=WIN_ENV, target=found[0]
    )
    assert problem is None
    assert launcher.calls[0][:2] == ("spawn", [exe, page])
    # the folder shown in Explorer, with backslashes, as a separate argument after /select,
    assert launcher.calls[1][:2] == (
        "spawn",
        ["C:\\Windows\\explorer.exe", "/select,", "C:\\Users\\Ana\\HermesTube Extension"],
    )
    assert launcher.accepts[1] == (0, 1)  # explorer exits with 1 even when the window opened
    assert opened == {"extensions_page": True, "folder": True}


def test_windows_never_opens_a_chrome_url_through_file_association() -> None:
    launcher = FakeLauncher()  # nothing installed
    opened, problem = setup_mod.open_targets(
        Path("C:\\Users\\Ana") / setup_mod.FOLDER_NAME,
        platform="windows",
        launcher=launcher,
        env=WIN_ENV,
        target=None,
    )
    assert problem == "no_browser"
    assert opened["extensions_page"] is False
    for argv in launcher.argvs:
        assert not any(a.startswith(("chrome://", "edge://")) for a in argv)
        assert argv[0].lower().endswith("explorer.exe")
        assert not any(a.lower() in ("start", "cmd", "/c", "cmd.exe") for a in argv)


def test_windows_path_is_shown_with_backslashes(home: Path) -> None:
    dest = Path("C:\\Users\\Ana") / setup_mod.FOLDER_NAME
    assert setup_mod.display_path(dest, "windows") == "C:\\Users\\Ana\\HermesTube Extension"
    assert setup_mod.display_path(dest_of(home), "macos") == str(dest_of(home))
    st = setup_mod.inspect(home=home, bundle=None, platform="windows")
    assert "/" not in st["path"]


def test_status_lists_the_detected_browsers(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher(which={"google-chrome": "/usr/bin/google-chrome"})
    browsers = setup_mod.detect_browsers(
        platform="linux", launcher=launcher, env={}, home=home, dest=dest_of(home)
    )
    st = setup_mod.inspect(
        home=home, bundle=bundle_of(bundle_dir), platform="linux", browsers=browsers
    )
    assert [b["key"] for b in st["browsers"]] == ["chrome"]
    assert set(st["browsers"][0]) == {
        "key",
        "name",
        "extensions_url",
        "sandbox",
        "app_id",
        "folder_visible",
    }


@pytest.mark.parametrize("platform", ["macos", "linux", "windows"])
def test_every_command_on_every_system_is_a_fixed_list_without_a_shell(
    home: Path, bundle_dir: Path, platform: str
) -> None:
    launcher = FakeLauncher(
        which={"google-chrome": "/usr/bin/google-chrome", "xdg-open": "/usr/bin/xdg-open"},
        files={"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"},
        bundles={"/Applications/Google Chrome.app": "com.google.Chrome"},
    )
    env = {"DISPLAY": ":0", **WIN_ENV}
    for key in (None, *ALL_KEYS):
        run_setup(home, bundle_dir, launcher, platform, browser=key, env=env)
    assert launcher.argvs
    for argv in launcher.argvs:
        assert isinstance(argv, list) and all(isinstance(a, str) for a in argv)
        shells = ("sh", "bash", "-c", "cmd", "cmd.exe", "/c", "start")
        assert not any(a.lower() in shells for a in argv)
        assert not any("--load-extension" in a for a in argv)


def test_setup_refuses_a_browser_key_outside_the_list(home: Path, bundle_dir: Path) -> None:
    with pytest.raises(ValueError):
        run_setup(home, bundle_dir, FakeLauncher(), "macos", browser="firefox")
    assert not dest_of(home).exists()


# --------------------------------------------------------------------------- safety net


def test_test_mode_never_uses_the_real_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TUBE_DB_PATH", str(tmp_path / "db" / "tube.db"))
    assert setup_mod.default_home() == (tmp_path / "db" / "home").resolve()
    assert setup_mod.apps_allowed() is False
    monkeypatch.delenv("TUBE_DB_PATH")
    # under pytest, even without TUBE_DB_PATH, the default home is a sandbox and nothing opens
    assert setup_mod.default_home() != Path.home()
    assert setup_mod.apps_allowed() is False


# --------------------------------------------------------------------------- REST


@pytest.fixture
def wired(monkeypatch: pytest.MonkeyPatch, home: Path, bundle_dir: Path) -> FakeLauncher:
    launcher = FakeLauncher()
    monkeypatch.setattr(setup_mod, "default_home", lambda: home)
    monkeypatch.setattr(setup_mod, "bundle_root", lambda: bundle_dir)
    monkeypatch.setattr(setup_mod, "current_platform", lambda: "macos")
    monkeypatch.setattr(setup_mod, "default_launcher", lambda: launcher)
    monkeypatch.setattr(setup_mod, "apps_allowed", lambda: True)
    monkeypatch.setattr(setup_mod, "apps_home", lambda: home)
    return launcher


def test_rest_get_status(wired: FakeLauncher, home: Path) -> None:
    env = api.get_extension_setup(None, {})
    assert env["ok"] is True
    assert env["data"]["state"] == "not_installed"
    assert env["data"]["path"] == str(dest_of(home))
    assert env["data"]["browsers"] == []
    assert wired.calls == []  # reading the status never opens anything
    assert not dest_of(home).exists()  # and never writes


def test_rest_post_installs_and_opens(wired: FakeLauncher, home: Path) -> None:
    env = api.post_extension_setup({}, {})
    assert env["ok"] is True, env
    assert env["data"]["action"] == "installed"
    assert env["data"]["opened"] == {"extensions_page": True, "folder": True}
    assert (dest_of(home) / "manifest.json").is_file()


def test_rest_post_refuses_a_path_or_a_command_from_the_caller(
    wired: FakeLauncher, home: Path, tmp_path: Path
) -> None:
    other = tmp_path / "attacker"
    for body in (
        {"path": str(other)},
        {"home": str(other)},
        {"browser": "chrome", "path": str(other)},
        {"browser": str(other)},
        {"browser": "/usr/bin/google-chrome"},
        {"browser": "chrome --load-extension=/tmp/x"},
        {"browser": ["chrome"]},
        {"browser": "CHROME"},
    ):
        env = api.post_extension_setup(body, {})
        assert env["ok"] is False, body
        assert env["error"]["code"] == "invalid", body
    assert wired.calls == []
    assert not other.exists()
    assert not dest_of(home).exists()
    # the query is never read
    env = api.post_extension_setup({}, {"path": str(other), "browser": "x"})
    assert env["ok"] is True
    assert env["data"]["path"] == str(dest_of(home))
    assert not other.exists()


def test_rest_post_accepts_one_browser_key(wired: FakeLauncher, home: Path) -> None:
    env = api.post_extension_setup({"browser": "brave"}, {})
    assert env["ok"] is True, env
    # nothing detected in the fake launcher: macOS still asks Launch Services for that browser only
    assert wired.argvs[0] == [OPEN, "-b", "com.brave.Browser", "brave://extensions/"]
    assert env["data"]["browser"]["key"] == "brave"
    env = api.post_extension_setup({"browser": None}, {})
    assert env["ok"] is True


def test_rest_post_not_ours_is_a_conflict(wired: FakeLauncher, home: Path) -> None:
    dest_of(home).mkdir()
    env = api.post_extension_setup({}, {})
    assert env["ok"] is False
    assert env["error"]["code"] == "conflict"
    assert env["error"]["reason"] == "not_ours"
    assert wired.calls == []


def test_rest_post_without_bundle_is_a_conflict(
    wired: FakeLauncher, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(setup_mod, "bundle_root", lambda: tmp_path / "missing")
    env = api.post_extension_setup({}, {})
    assert env["ok"] is False
    assert env["error"]["code"] == "conflict"
    assert env["error"]["reason"] == "no_bundle"


def test_rest_post_write_failure_is_generic_outside_detailed_in_the_log(
    wired: FakeLauncher, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(*_a: Any, **_kw: Any) -> Any:
        raise PermissionError(13, "Permission denied", "/secret/place")

    monkeypatch.setattr(setup_mod, "install", broken)
    with caplog.at_level("ERROR"):
        env = api.post_extension_setup({}, {})
    assert env["ok"] is False
    assert env["error"]["code"] == "internal"
    assert env["error"]["reason"] == "write_failed"
    assert "/secret/place" not in json.dumps(env)
    assert "Permission denied" in caplog.text


def test_rest_post_in_test_mode_opens_nothing(
    monkeypatch: pytest.MonkeyPatch, home: Path, bundle_dir: Path
) -> None:
    launcher = FakeLauncher()
    monkeypatch.setattr(setup_mod, "default_home", lambda: home)
    monkeypatch.setattr(setup_mod, "bundle_root", lambda: bundle_dir)
    monkeypatch.setattr(setup_mod, "default_launcher", lambda: launcher)
    env = api.post_extension_setup({}, {})
    assert env["ok"] is True
    assert launcher.calls == []
    assert env["data"]["open_problem"] == "disabled"


def test_no_tool_routine_or_command_reaches_the_setup() -> None:
    # only the REST route (a click in the Desktop) imports the module
    root = Path(__file__).resolve().parents[1] / "plugin"
    importers = sorted(
        str(p.relative_to(root))
        for p in root.rglob("*.py")
        if re.search(r"core\.extension_setup|import extension_setup", p.read_text("utf-8"))
    )
    assert importers == [os.path.join("api", "extension.py")]
    # and nothing the agent, a routine or a chat command runs names the route
    agent_side = [
        *(root / "tools").rglob("*.py"),
        *(root / "routines").rglob("*.py"),
        root / "commands.py",
        root / "blueprints.py",
        root / "__init__.py",
    ]
    for path in agent_side:
        assert "/extension/setup" not in path.read_text("utf-8"), path


# --------------------------------------------------------------------------- hardening


def _swap_inside(monkeypatch: pytest.MonkeyPatch, swap: Any) -> None:
    """Run *swap* the first time the setup decides whether the folder needs a copy: the window
    between checking the folder and writing into it."""
    original = setup_mod._needs_copy
    done: list[bool] = []

    def racing(*args: Any, **kwargs: Any) -> bool:
        if not done:
            done.append(True)
            swap()
        return original(*args, **kwargs)

    monkeypatch.setattr(setup_mod, "_needs_copy", racing)


@pytest.mark.skipif(not setup_mod.FD_WRITES, reason="this system has no dir_fd")
def test_a_folder_swapped_for_a_link_during_an_update_gets_nothing_written_there(
    home: Path, bundle_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    target = tmp_path / "LaunchAgents"
    target.mkdir()

    def swap() -> None:
        dest.rename(home / "moved-away")
        dest.symlink_to(target, target_is_directory=True)

    _swap_inside(monkeypatch, swap)
    newer = make_bundle(tmp_path / "bundle2", "0.2.0")
    with pytest.raises((OSError, setup_mod.SetupRefused)):
        run_setup(home, newer, FakeLauncher())
    assert list(target.iterdir()) == []


@pytest.mark.skipif(not setup_mod.FD_WRITES, reason="this system has no dir_fd")
def test_a_folder_swapped_for_another_folder_during_an_update_is_left_alone(
    home: Path, bundle_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)

    def swap() -> None:
        dest.rename(home / "moved-away")
        dest.mkdir()
        (dest / "theirs.txt").write_text("theirs", encoding="utf-8")

    _swap_inside(monkeypatch, swap)
    newer = make_bundle(tmp_path / "bundle2", "0.2.0")
    with pytest.raises((OSError, setup_mod.SetupRefused)):
        run_setup(home, newer, FakeLauncher())
    assert sorted(p.name for p in dest.iterdir()) == ["theirs.txt"]


def test_writes_go_through_a_folder_descriptor_where_the_system_has_one() -> None:
    expected = (
        os.open in os.supports_dir_fd
        and os.mkdir in os.supports_dir_fd
        and os.unlink in os.supports_dir_fd
        and os.rename in os.supports_dir_fd
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
    )
    assert setup_mod.FD_WRITES is expected
    if os.name == "posix":
        assert setup_mod.FD_WRITES is True


def test_without_dir_fd_the_path_writer_still_installs_and_updates(
    home: Path, bundle_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Windows: no dir_fd; the old path-by-path writer (never through a link) stays
    monkeypatch.setattr(setup_mod, "FD_WRITES", False)
    assert run_setup(home, bundle_dir, FakeLauncher())["action"] == "installed"
    newer = make_bundle(tmp_path / "bundle2", "0.2.0", extra={"assets/new.js": "// new\n"})
    (newer / "icons" / "icon-16.png").unlink()
    assert run_setup(home, newer, FakeLauncher())["action"] == "updated"
    dest = dest_of(home)
    assert (dest / "assets" / "new.js").is_file()
    assert not (dest / "icons" / "icon-16.png").exists()
    assert setup_mod.inspect(home=home, bundle=bundle_of(newer), platform="windows")["state"] == (
        "installed"
    )


def test_fd_writer_refuses_a_link_inside_our_folder(
    home: Path, bundle_dir: Path, tmp_path: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    outside = tmp_path / "outside"
    outside.mkdir()
    for child in (dest / "popup").iterdir():
        child.unlink()
    (dest / "popup").rmdir()
    (dest / "popup").symlink_to(outside, target_is_directory=True)
    with pytest.raises(OSError):
        run_setup(home, bundle_dir, FakeLauncher())
    assert list(outside.iterdir()) == []


@pytest.mark.parametrize(
    ("platform", "env", "which", "files", "expected"),
    [
        # the system folder first, even when PATH or the current folder has another "explorer"
        (
            "windows",
            {"SYSTEMROOT": "D:\\Win"},
            {"explorer": "C:\\work\\explorer.bat"},
            {"D:\\Win\\explorer.exe"},
            "D:\\Win\\explorer.exe",
        ),
        # a relative SYSTEMROOT is ignored
        ("windows", {"SYSTEMROOT": "Windows"}, {}, set(), "C:\\Windows\\explorer.exe"),
        # which() only as a last resort, and only an absolute explorer.exe
        ("windows", {}, {"explorer": ".\\explorer.bat"}, set(), "C:\\Windows\\explorer.exe"),
        ("windows", {}, {"explorer": "explorer.exe"}, set(), "C:\\Windows\\explorer.exe"),
        (
            "windows",
            {},
            {"explorer": "E:\\Windows\\explorer.exe"},
            set(),
            "E:\\Windows\\explorer.exe",
        ),
    ],
)
def test_windows_explorer_comes_from_the_system_folder(
    platform: str, env: dict[str, str], which: dict[str, str], files: set[str], expected: str
) -> None:
    launcher = FakeLauncher(which=which, files=files)
    setup_mod.open_targets(
        Path("C:\\Users\\Ana") / setup_mod.FOLDER_NAME,
        platform=platform,
        launcher=launcher,
        env=env,
        target=None,
    )
    assert launcher.argvs[-1][0] == expected


def test_macos_open_is_always_the_absolute_system_program(home: Path, bundle_dir: Path) -> None:
    launcher = FakeLauncher()
    run_setup(home, bundle_dir, launcher, "macos", browser="edge")
    assert launcher.argvs and all(argv[0] == "/usr/bin/open" for argv in launcher.argvs)


@pytest.mark.parametrize("bad", ["-a Calculator", "relative/home", "", "."])
def test_a_home_folder_that_is_not_absolute_is_refused(
    bad: str, bundle_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    launcher = FakeLauncher()
    with pytest.raises(OSError):
        setup_mod.install(home=Path(bad), bundle=bundle_of(bundle_dir))
    with pytest.raises(OSError):
        run_setup(Path(bad), bundle_dir, launcher)
    with pytest.raises(OSError):
        setup_mod.open_targets(
            Path(bad) / setup_mod.FOLDER_NAME,
            platform="macos",
            launcher=launcher,
            env={},
            target=None,
        )
    assert launcher.calls == []
    assert not any(p.name == setup_mod.FOLDER_NAME for p in tmp_path.rglob("*"))


def test_a_windows_home_is_absolute_only_with_a_drive_and_a_root() -> None:
    launcher = FakeLauncher()
    with pytest.raises(OSError):
        setup_mod.open_targets(
            Path("Users\\Ana") / setup_mod.FOLDER_NAME,
            platform="windows",
            launcher=launcher,
            env=WIN_ENV,
            target=None,
        )
    assert launcher.calls == []


def test_a_changed_file_in_our_folder_is_an_update_and_the_button_repairs_it(
    home: Path, bundle_dir: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    (dest / "background.js").write_text("// tampered\n", encoding="utf-8")
    b = bundle_of(bundle_dir)
    assert setup_mod.inspect(home=home, bundle=b, platform="macos")["state"] == "update_available"
    out = run_setup(home, bundle_dir, FakeLauncher())
    assert out["action"] == "updated"
    assert (dest / "background.js").read_bytes() == (bundle_dir / "background.js").read_bytes()
    assert setup_mod.inspect(home=home, bundle=b, platform="macos")["state"] == "installed"


def test_a_file_of_ours_replaced_by_a_link_is_never_followed_when_checking(
    home: Path, bundle_dir: Path, tmp_path: Path
) -> None:
    run_setup(home, bundle_dir, FakeLauncher())
    dest = dest_of(home)
    twin = tmp_path / "twin.js"
    twin.write_bytes((bundle_dir / "background.js").read_bytes())  # same bytes, but a link
    (dest / "background.js").unlink()
    (dest / "background.js").symlink_to(twin)
    b = bundle_of(bundle_dir)
    assert setup_mod.inspect(home=home, bundle=b, platform="macos")["state"] == "update_available"
    run_setup(home, bundle_dir, FakeLauncher())
    assert not (dest / "background.js").is_symlink()
    assert twin.read_bytes() == (bundle_dir / "background.js").read_bytes()


def test_the_bundle_knows_the_hash_of_each_file(bundle_dir: Path) -> None:
    import hashlib

    b = bundle_of(bundle_dir)
    assert set(b.hashes) == set(b.files)
    for rel in b.files:
        assert b.hashes[rel] == hashlib.sha256((bundle_dir / rel).read_bytes()).hexdigest()


@pytest.mark.parametrize(
    "rel",
    [
        "C:evil.js",
        "D:/x.js",
        "assets/a.js:stream",
        "CON",
        "nul.txt",
        "assets/AUX",
        "com1.js",
        "a/LPT9.png",
        "x.",
        "x ",
        'a"b',
        "a<b",
        "a>b",
        "a|b",
        "a?b",
        "a*b",
        "a\x01b",
    ],
)
def test_names_that_windows_reads_as_a_drive_stream_or_device_are_refused(rel: str) -> None:
    assert setup_mod._safe_rel(rel) is None
    assert setup_mod._safe_rel("assets/popup.js") == "assets/popup.js"
    assert setup_mod._safe_rel("icons/icon-16.png") == "icons/icon-16.png"


def test_a_bundle_with_a_name_windows_cannot_hold_is_refused(tmp_path: Path) -> None:
    root = make_bundle(tmp_path / "b", extra={"assets/con.js": "x"})
    assert setup_mod.load_bundle(root) is None


# --------------------------------------------------------------------------- Hermes inside WSL

OSRELEASE = "/proc/sys/kernel/osrelease"
PROC_VERSION = "/proc/version"
WSL_CONF = "/etc/wsl.conf"
BINFMT = "/proc/sys/fs/binfmt_misc/WSLInterop"
USERS = "Users"  # built in pieces: a literal macOS home path never lands in the public cut
WSL2_KERNEL = ".".join(["5", "15", "167", "4-microsoft-standard-WSL2"])  # no dotted quad in the cut


@pytest.mark.parametrize(
    ("env", "texts", "found"),
    [
        ({"WSL_DISTRO_NAME": "Ubuntu"}, {}, True),
        ({}, {OSRELEASE: WSL2_KERNEL}, True),
        ({}, {PROC_VERSION: "Linux version 4.4.0-19041-Microsoft (gcc version 5.4.0 (GCC))"}, True),
        (
            {},
            {OSRELEASE: "6.8.0-45-generic", PROC_VERSION: "Linux version 6.8.0-45-generic"},
            False,
        ),
        ({}, {}, False),
    ],
)
def test_wsl_is_detected_from_the_kernel_or_the_distro_variable(
    env: dict[str, str], texts: dict[str, str], found: bool
) -> None:
    launcher = FakeLauncher(texts=texts)
    host = setup_mod.detect_wsl(env=env, launcher=launcher)
    assert (host is not None) is found
    assert launcher.calls == []  # reading files only, nothing run


def test_wsl_distro_name_is_kept_only_when_it_looks_like_a_name() -> None:
    launcher = FakeLauncher(texts={OSRELEASE: WSL2_KERNEL})
    good = setup_mod.detect_wsl(env={"WSL_DISTRO_NAME": "Ubuntu-24.04"}, launcher=launcher)
    bad = setup_mod.detect_wsl(env={"WSL_DISTRO_NAME": "a\\b c"}, launcher=launcher)
    assert good is not None and good.distro == "Ubuntu-24.04"
    assert bad is not None and bad.distro is None


@pytest.mark.parametrize(
    ("conf", "root"),
    [
        (None, "/mnt"),
        ("[automount]\nroot = /windir/\n", "/windir"),
        ('[automount]\nroot = "/drives"\n', "/drives"),
        ("[automount]\nroot = relative/\n", "/mnt"),
        ("[automount]\nroot = /a/../etc\n", "/mnt"),
        ("not an ini file [[[", "/mnt"),
    ],
)
def test_wsl_mount_root_comes_from_wsl_conf(conf: str | None, root: str) -> None:
    texts = {OSRELEASE: WSL2_KERNEL, **({WSL_CONF: conf} if conf is not None else {})}
    host = setup_mod.detect_wsl(env={}, launcher=FakeLauncher(texts=texts))
    assert host is not None and host.mount_root == root


@pytest.mark.parametrize(
    ("env", "files", "conf", "interop"),
    [
        ({}, {BINFMT}, None, True),
        ({}, {BINFMT + "-late"}, None, True),
        ({"WSL_INTEROP": "/run/WSL/1_interop"}, set(), None, True),
        ({}, set(), None, False),
        ({}, {BINFMT}, "[interop]\nenabled = false\n", False),
    ],
)
def test_wsl_interop_is_read_from_files(
    env: dict[str, str], files: set[str], conf: str | None, interop: bool
) -> None:
    texts = {OSRELEASE: WSL2_KERNEL, **({WSL_CONF: conf} if conf is not None else {})}
    host = setup_mod.detect_wsl(env=env, launcher=FakeLauncher(texts=texts, files=files))
    assert host is not None and host.interop is interop


SYSTEM_PROFILES = ["All " + USERS, "Default", "Default User", "Public", "defaultuser0"]


@pytest.mark.parametrize(
    ("env", "names", "expected"),
    [
        ({}, ["Ana", *SYSTEM_PROFILES], "Ana"),
        ({"USER": "bea"}, ["Ana", "Bea", *SYSTEM_PROFILES], "Bea"),
        ({"USER": "carl"}, ["Ana", "Bea", *SYSTEM_PROFILES], None),
        ({}, SYSTEM_PROFILES, None),
        ({}, [".hidden", "Ana"], "Ana"),
        ({"USERPROFILE": "C:\\" + USERS + "\\Bea"}, ["Ana", "Bea"], "Bea"),
        ({"USERPROFILE": "/mnt/c/" + USERS + "/Bea"}, ["Ana", "Bea"], "Bea"),
        # a USERPROFILE outside the mounted drives is not used
        ({"USERPROFILE": "/etc"}, ["Ana"], "Ana"),
    ],
)
def test_wsl_finds_the_windows_user_folder_without_a_shell(
    env: dict[str, str], names: list[str], expected: str | None
) -> None:
    users = f"/mnt/c/{USERS}"
    launcher = FakeLauncher(texts={OSRELEASE: WSL2_KERNEL}, dirs={users: names})
    host = setup_mod.detect_wsl(env=env, launcher=launcher)
    assert host is not None
    want = f"{users}/{expected}" if expected else None
    assert (str(host.windows_home) if host.windows_home else None) == want
    assert launcher.calls == []


def _wsl(mount: str = "/mnt", **kw: Any) -> Any:
    base = {"distro": "Ubuntu", "mount_root": mount, "interop": True, "windows_home": None}
    base.update(kw)
    return setup_mod.WslHost(**base)


@pytest.mark.parametrize(
    ("path", "host", "shown"),
    [
        (
            f"/mnt/c/{USERS}/Ana/HermesTube Extension",
            _wsl(),
            f"C:\\{USERS}\\Ana\\HermesTube Extension",
        ),
        (f"/windir/d/{USERS}/Ana/x", _wsl("/windir"), f"D:\\{USERS}\\Ana\\x"),
        (
            "/home/Ana/HermesTube Extension",
            _wsl(),
            "\\\\wsl.localhost\\Ubuntu\\home\\Ana\\HermesTube Extension",
        ),
        ("/home/Ana/HermesTube Extension", _wsl(distro=None), "/home/Ana/HermesTube Extension"),
    ],
)
def test_wsl_paths_are_shown_the_way_windows_writes_them(path: str, host: Any, shown: str) -> None:
    assert setup_mod.wsl_windows_path(Path(path), host) == shown


def _wsl_world(tmp_path: Path, *, interop: bool = True, user_folder: bool = True) -> Any:
    """A fake Windows drive mounted inside a fake WSL: real folders under *tmp_path*."""
    mount = tmp_path / "mnt"
    win_home = mount / "c" / USERS / "Ana"
    if user_folder:
        win_home.mkdir(parents=True)
    host = setup_mod.WslHost(
        distro="Ubuntu",
        mount_root=str(mount),
        interop=interop,
        windows_home=win_home if user_folder else None,
    )
    chrome = f"{mount}/c/Program Files/Google/Chrome/Application/chrome.exe"
    explorer = f"{mount}/c/Windows/explorer.exe"
    launcher = FakeLauncher(files={chrome, explorer})
    return host, launcher, win_home, chrome, explorer


def test_wsl_setup_uses_the_windows_user_folder_and_opens_through_interop(
    tmp_path: Path, bundle_dir: Path
) -> None:
    host, launcher, win_home, chrome, explorer = _wsl_world(tmp_path)
    linux_home = tmp_path / "linux-home"
    linux_home.mkdir()
    out = setup_mod.setup(
        home=setup_mod.wsl_home(host, linux_home),
        bundle=bundle_of(bundle_dir),
        platform="linux",
        launcher=launcher,
        env={},  # no DISPLAY: the browser runs on Windows, not in WSL
        wsl=host,
    )
    shown = f"C:\\{USERS}\\Ana\\HermesTube Extension"
    assert out["platform"] == "windows"
    assert out["path"] == shown
    assert (win_home / setup_mod.FOLDER_NAME / "manifest.json").is_file()
    assert not (linux_home / setup_mod.FOLDER_NAME).exists()
    assert launcher.calls[0][:2] == ("spawn", [chrome, URL])
    assert launcher.calls[1][:2] == ("spawn", [explorer, "/select,", shown])
    assert launcher.accepts[1] == (0, 1)
    assert out["opened"] == {"extensions_page": True, "folder": True}
    assert out["open_problem"] is None
    assert out["browser"]["key"] == "chrome"
    assert out["wsl"] == {"distro": "Ubuntu", "interop": True, "windows_folder": True}


def test_wsl_status_says_windows_and_lists_the_windows_browsers(
    tmp_path: Path, bundle_dir: Path
) -> None:
    host, launcher, win_home, _chrome, _explorer = _wsl_world(tmp_path)
    edge = f"{win_home}/AppData/Local/Microsoft/Edge/Application/msedge.exe"
    launcher.files.add(edge)
    found = setup_mod.detect_browsers(
        platform="linux", launcher=launcher, env={}, home=win_home, dest=win_home, wsl=host
    )
    assert [b.key for b in found] == ["chrome", "edge"]
    st = setup_mod.inspect(
        home=setup_mod.wsl_home(host, tmp_path),
        bundle=bundle_of(bundle_dir),
        platform="linux",
        browsers=found,
        wsl=host,
    )
    assert st["platform"] == "windows"
    assert st["path"] == f"C:\\{USERS}\\Ana\\HermesTube Extension"
    assert st["wsl"] == {"distro": "Ubuntu", "interop": True, "windows_folder": True}


def test_wsl_without_interop_only_prepares_the_folder(tmp_path: Path, bundle_dir: Path) -> None:
    host, launcher, win_home, _c, _e = _wsl_world(tmp_path, interop=False)
    out = setup_mod.setup(
        home=setup_mod.wsl_home(host, tmp_path),
        bundle=bundle_of(bundle_dir),
        platform="linux",
        launcher=launcher,
        env={},
        wsl=host,
    )
    assert launcher.calls == []
    assert out["open_problem"] == "unsupported"
    assert out["opened"] == {"extensions_page": False, "folder": False}
    assert (win_home / setup_mod.FOLDER_NAME / "manifest.json").is_file()
    assert out["wsl"]["interop"] is False


def test_wsl_without_a_windows_user_folder_keeps_the_folder_in_the_linux_home(
    tmp_path: Path, bundle_dir: Path
) -> None:
    host, launcher, _w, _c, explorer = _wsl_world(tmp_path, user_folder=False)
    linux_home = tmp_path / "linux-home"
    linux_home.mkdir()
    home = setup_mod.wsl_home(host, linux_home)
    assert home == linux_home
    out = setup_mod.setup(
        home=home,
        bundle=bundle_of(bundle_dir),
        platform="linux",
        launcher=launcher,
        env={},
        wsl=host,
    )
    assert (linux_home / setup_mod.FOLDER_NAME / "manifest.json").is_file()
    assert out["path"].startswith("\\\\wsl.localhost\\Ubuntu\\")
    assert out["path"].endswith("\\HermesTube Extension")
    assert "/" not in out["path"]
    assert out["wsl"] == {"distro": "Ubuntu", "interop": True, "windows_folder": False}
    assert launcher.argvs[-1] == [explorer, "/select,", out["path"]]


def test_wsl_commands_are_fixed_lists_of_windows_programs_never_a_shell(
    tmp_path: Path, bundle_dir: Path
) -> None:
    host, launcher, _w, _c, _e = _wsl_world(tmp_path)
    for key in (None, *ALL_KEYS):
        setup_mod.setup(
            home=setup_mod.wsl_home(host, tmp_path),
            bundle=bundle_of(bundle_dir),
            platform="linux",
            launcher=launcher,
            env={"DISPLAY": ":0"},
            browser=key,
            wsl=host,
        )
    assert launcher.argvs
    for argv in launcher.argvs:
        assert argv[0].endswith(".exe") and argv[0].startswith(str(tmp_path))
        bad = ("sh", "bash", "-c", "cmd", "cmd.exe", "/c", "start", "powershell.exe", "wslview")
        assert not any(a.lower() in bad for a in argv)
        assert all(kind == "spawn" and 0 < t <= 5 for kind, _a, t in launcher.calls)


def test_status_and_run_use_wsl_outside_test_mode_only(
    tmp_path: Path, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    host, launcher, win_home, _c, _e = _wsl_world(tmp_path)
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir()
    monkeypatch.setattr(setup_mod, "current_platform", lambda: "linux")
    monkeypatch.setattr(setup_mod, "detect_wsl", lambda **_kw: host)
    monkeypatch.setattr(setup_mod, "default_launcher", lambda: launcher)
    monkeypatch.setattr(setup_mod, "bundle_root", lambda: bundle_dir)
    monkeypatch.setattr(setup_mod, "default_home", lambda: sandbox)
    # test mode (pytest): never the Windows user folder, and nothing opens
    out = setup_mod.run()
    assert (sandbox / setup_mod.FOLDER_NAME).is_dir()
    assert not (win_home / setup_mod.FOLDER_NAME).exists()
    assert out["platform"] == "windows" and out["open_problem"] == "disabled"
    # a real run (test mode off): the Windows user folder
    monkeypatch.setattr(setup_mod, "_test_mode", lambda: None)
    st = setup_mod.status()
    assert st["path"] == f"C:\\{USERS}\\Ana\\HermesTube Extension"
    out = setup_mod.run("chrome")
    assert (win_home / setup_mod.FOLDER_NAME / "manifest.json").is_file()
    assert out["opened"]["extensions_page"] is True
