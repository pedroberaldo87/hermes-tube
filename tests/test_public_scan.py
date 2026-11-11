"""Public-cut scanner (`scripts/public_scan.py`) and exporter (`scripts/export-public`).

The texts that must trigger the scanner are built from pieces (``_j``) so that this file, which
goes public, triggers neither the scanner itself nor the catalog validator.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCANNER = ROOT / "scripts" / "public_scan.py"
EXPORTER = ROOT / "scripts" / "export-public"


def _j(*parts: str) -> str:
    return "".join(parts)


def _load():
    spec = importlib.util.spec_from_file_location("public_scan", SCANNER)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["public_scan"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def ps():
    return _load()


USER = _j("pedro", "beraldo")

BAD = {
    "users_path": _j("cd /Us", "ers/someone/project"),
    "home_path": _j("HOME=/ho", "me/someone"),
    "machine_user": _j("owner: ", USER),
    "machine_user_url": _j("https://example.org/", USER, "/x"),
    "machine_laptop": _j("a ", "Mac", "Book", " Air"),
    "profile_dev": _j("hermes -p ", "tube", "-dev", " chat"),
    "profile_s3": _j("profile ", "tube", "-s3"),
    "profiles_dir": _j("~/.her", "mes/prof", "iles/x"),
    "email": _j("write to ", "someone", "@", "gmail", ".com"),
    "tg_token": _j("TOKEN=", "123456789", ":", "AAH", "x" * 32),
    "gh_token": _j("ghp", "_", "A" * 36),
    "openai_key": _j("key = ", "sk", "-", "proj", "Ab3" * 8),
    "slack_token": _j("xox", "b-", "1234567890-abcdefghij"),
    "pem": _j("-----BEGIN ", "RSA PRIVATE", " KEY-----"),
    "public_ip": _j("connected from ", "8.8.", "4.4", " now"),
    "remote_host": _j('{"gl":"US","remote', 'Host":"', "2001:db8::1", '"}'),
    "ip_in_url": _j("https://r1.example/play?id=1\\u0026", "ip=", "2804:14c::1", "\\u0026x=1"),
}

GOOD = {
    "repo_public": _j("hermes plugins install ", USER, "87/", "hermes", "-tube", "/plugin"),
    "repo_mytube": _j("continues ", USER, "87/", "MyTube"),
    "github_profile": _j("https://github.com/", USER, "87"),
    "youtube_word": "youtube-dev-tools and youtube-s1 are not profiles",
    "home_url": "https://example.org/home/page",
    "home_tilde": "$HOME/.hermes/hermes-agent",
    "example_email": _j("user", "@", "example", ".com"),
    "risk_free": "risk-free task-list disk-usage",
    "scoped_pkg": "@types/node and @vitejs/plugin-react",
    "short_number": "12345678 videos",
    "macintosh": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "chrome_version": "AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36",
    "local_ips": "127.0.0.1, 0.0.0.0, 192.168.0.10, 10.1.2.3 and 203.0.113.5 (documentation)",
    "remote_host_empty": '{"remoteHost":""}',
}


@pytest.mark.parametrize("name", sorted(BAD))
def test_bad_line_is_reported(ps, name: str) -> None:
    hits = ps.scan_text(BAD[name], "x.txt")
    assert hits, f"{name}: should have found something in {BAD[name]!r}"


@pytest.mark.parametrize("name", sorted(GOOD))
def test_allowed_line_is_clean(ps, name: str) -> None:
    assert ps.scan_text(GOOD[name], "x.txt") == []


@pytest.mark.parametrize(
    "line",
    [
        _j("https://x.com/", USER),
        _j("Follow on X: x.com/", USER, "."),
        _j("[X](https://X.com/", "Pedro", "Beraldo", ")"),
    ],
)
def test_x_profile_is_an_allowed_context(ps, line: str) -> None:
    """The author's X profile is a public contact of the credits, like the GitHub profile."""
    assert ps.scan_text(line, "README.md") == []


def test_x_profile_does_not_clear_the_rest_of_the_line(ps) -> None:
    line = _j("x.com/", USER, " and owner: ", USER)
    assert [h.rule for h in ps.scan_text(line, "README.md")] == ["machine-user"]


def test_x_profile_context_needs_the_x_host(ps) -> None:
    assert ps.scan_text(_j("https://dropbox.com/", USER), "README.md") != []


@pytest.mark.parametrize(
    "line",
    [
        _j("https://notgithub.com/", USER, "87"),
        _j("https://my-x.com/", USER),
        _j("https://x.com/", USER, "_evil"),
        _j("see ", "a", USER, "87/", "MyTube"),
    ],
)
def test_allowed_contexts_match_on_host_and_name_boundaries(ps, line: str) -> None:
    assert ps.scan_text(line, "README.md") != []


@pytest.mark.parametrize(
    "line",
    [
        _j("https://www.github.com/", USER, "87"),
        _j("https://www.x.com/", USER, "/status/1"),
        _j("git clone https://github.com/", USER, "87/", "hermes", "-tube", ".git"),
    ],
)
def test_allowed_contexts_still_pass_with_subdomain_or_path(ps, line: str) -> None:
    assert ps.scan_text(line, "README.md") == []


def test_scanner_source_has_no_literal_pieces(ps) -> None:
    # the scanner goes public: it carries no account id, and the user name only in pieces
    src = SCANNER.read_text(encoding="utf-8")
    assert USER not in src
    assert ps.scan_text(src, "scripts/public_scan.py") == []


def test_private_terms_come_from_an_untracked_list(ps, tmp_path, monkeypatch) -> None:
    listing = tmp_path / "private.txt"
    listing.write_text("# comment\n4242424242\nmy-host\n", encoding="utf-8")
    monkeypatch.setenv(ps.PRIVATE_ENV, str(listing))
    assert ps.private_terms() == ("4242424242", "my-host")
    hits = ps.scan_text("chat 4242424242 ok, ran on My-Host", "x.txt")
    assert [h.rule for h in hits] == ["private-term", "private-term"]
    assert all("4242424242" not in h.render() and "host" not in h.render().lower() for h in hits)
    assert ps.scan_text("id 14242424242", "x.txt") == [], "a longer number is another number"
    monkeypatch.setenv(ps.PRIVATE_ENV, str(tmp_path / "missing.txt"))
    assert ps.private_terms() == ()


def test_private_list_is_not_tracked() -> None:
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert "/scripts/public_scan.private" in ignored


def test_test_vector_addresses_are_allowed_only_where_listed(ps) -> None:
    dns = _j("8.8.", "8.8")
    assert ps.scan_text("resolver " + dns, "tests/test_x.py") == []
    assert ps.scan_text("resolver " + dns, "plugin/x.py")
    assert ps.scan_text("group " + _j("224.0.", "0.1"), "plugin/x.py") == [], (
        "multicast is nobody's"
    )


def test_secret_snippet_is_masked(ps) -> None:
    secret = _j("ghp", "_", "Z" * 36)
    hits = ps.scan_text(f"x = '{secret}'", "a.py")
    assert hits and secret not in hits[0].render()


def test_ip_snippet_is_masked(ps) -> None:
    addr = _j("8.8.", "4.4")
    hits = ps.scan_text("ip=" + addr, "a.html")
    assert hits and all(addr not in h.render() for h in hits)


def test_email_allowlist_is_per_file(ps) -> None:
    hn = _j("hn", "@", "ycombinator", ".com")
    assert ps.scan_text(hn, "tests/fixtures/lists/a.html") == []
    assert ps.scan_text(hn, "plugin/x.py")


def test_scan_tree_lists_binaries_and_exit_codes(tmp_path: Path) -> None:
    (tmp_path / "ok.md").write_text("all clean\n", encoding="utf-8")
    (tmp_path / "img.png").write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(range(256)))
    r = subprocess.run(
        [sys.executable, str(SCANNER), str(tmp_path)], capture_output=True, text=True
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "img.png" in r.stdout and "264" in r.stdout
    assert "public_scan: 0 finding(s); 1 text file(s); 1 binary file(s)" in r.stdout
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "bad.ts").write_text("a\n" + BAD["profile_dev"] + "\n", encoding="utf-8")
    r = subprocess.run(
        [sys.executable, str(SCANNER), str(tmp_path)], capture_output=True, text=True
    )
    assert r.returncode == 1
    assert "sub/bad.ts:2: internal-profile:" in r.stdout


# --------------------------------------------------------------------------- exporter


def _git(root: Path, *args: str) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z",
        "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
    }
    subprocess.run(["git", "-C", str(root), *args], check=True, env=env, capture_output=True)


def _fake_repo(root: Path, extra: dict[str, str] | None = None) -> Path:
    files = {
        "LICENSE": "MIT\n",
        "README.md": "# x\n",
        "Makefile": "all:\n",
        "tsconfig.json": "{}\n",
        "tsconfig.ext.json": "{}\n",
        "plugin/a.py": "A = 1\n",
        "docs/user/install.md": "install\n",
        "docs/media/hero.jpg": "jpg",
        "docs/screenshots/home.png": "png",
        "docs/SPEC.md": "internal\n",
        "docs/design/shots/app/01.png": "png",
        "docs/catalog/x.yaml": "x: 1\n",
        "units/U1.md": "brief\n",
        "handoff/U1.md": "handoff\n",
        "spikes/s1/x.py": "x\n",
        "scripts/dev/fila": "fila\n",
        "scripts/other.sh": "other\n",
        "tests/test_a.py": "def test_a():\n    pass\n",
        "tests/fixtures/youtube/watch/a.html": "<html>real</html>\n",
        "tests/fixtures/youtube/channel_videos.legacy.synthetic.html": "<html>synth</html>\n",
        "tests/fixtures/lists/hn.html": "<html>hn</html>\n",
        "tests/fixtures/mytube/feed.synthetic.html": "<html>s</html>\n",
        ".gitignore": "/ref/\n",
    }
    files.update(extra or {})
    for rel, content in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    # the real exporter and scanner, copied into the fake repository
    for rel in ("scripts/export-public", "scripts/public_scan.py"):
        (root / rel).write_bytes((ROOT / rel).read_bytes())
    (root / "scripts" / "export-public").chmod(0o755)
    _git(root, "init", "-q")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "x")
    (root / "plugin" / "untracked.py").write_text("U = 1\n", encoding="utf-8")
    return root


def _export(repo: Path, dest: Path, *flags: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(repo / "scripts" / "export-public"), *flags, str(dest)],
        capture_output=True,
        text=True,
    )


def _tree(root: Path) -> dict[str, tuple[bytes, int]]:
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = (p.read_bytes(), p.stat().st_mode & 0o777)
    return out


def test_export_includes_only_allowlist(tmp_path: Path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    dest = tmp_path / "out"
    r = _export(repo, dest)
    assert r.returncode == 0, r.stdout + r.stderr
    got = set(_tree(dest))
    assert {
        "LICENSE",
        "README.md",
        "Makefile",
        "tsconfig.json",
        "tsconfig.ext.json",
        "plugin/a.py",
        "docs/user/install.md",
        "docs/screenshots/home.png",
        "tests/test_a.py",
        "tests/fixtures/youtube/watch/a.html",
        "tests/fixtures/lists/hn.html",
        "scripts/export-public",
        "scripts/public_scan.py",
        ".gitignore",
    } <= got
    for bad in (
        "docs/SPEC.md",
        "docs/design/shots/app/01.png",
        "docs/catalog/x.yaml",
        "units/U1.md",
        "handoff/U1.md",
        "spikes/s1/x.py",
        "scripts/dev/fila",
        "scripts/other.sh",
        "plugin/untracked.py",
    ):
        assert bad not in got, bad
    assert not (dest / ".git").exists()
    # .gitignore is the cut's own, not the internal repository's
    assert "/ref/" not in (dest / ".gitignore").read_text(encoding="utf-8")
    assert (dest / "scripts" / "export-public").stat().st_mode & 0o111


def test_export_gitignore_keeps_the_private_list_out(tmp_path: Path) -> None:
    # the cut's own .gitignore must cover what the cut's tests require of it
    repo = _fake_repo(tmp_path / "repo")
    dest = tmp_path / "out"
    assert _export(repo, dest).returncode == 0
    assert "/scripts/public_scan.private" in (dest / ".gitignore").read_text(encoding="utf-8")


def test_export_is_deterministic(tmp_path: Path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    assert _export(repo, tmp_path / "a").returncode == 0
    assert _export(repo, tmp_path / "b").returncode == 0
    assert _tree(tmp_path / "a") == _tree(tmp_path / "b")


def test_export_refuses_non_empty_dest_and_dest_inside_repo(tmp_path: Path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    dest = tmp_path / "out"
    dest.mkdir()
    (dest / "x").write_text("x", encoding="utf-8")
    r = _export(repo, dest)
    assert r.returncode != 0 and "not empty" in (r.stdout + r.stderr)
    r = _export(repo, repo / "pub")
    assert r.returncode != 0
    empty = tmp_path / "empty"
    empty.mkdir()
    assert _export(repo, empty).returncode == 0


def test_export_without_third_party_pages(tmp_path: Path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    dest = tmp_path / "out"
    r = _export(repo, dest, "--no-third-party-pages")
    assert r.returncode == 0, r.stdout + r.stderr
    got = set(_tree(dest))
    assert "tests/fixtures/youtube/watch/a.html" not in got
    assert "tests/fixtures/lists/hn.html" not in got
    assert "tests/fixtures/youtube/channel_videos.legacy.synthetic.html" in got
    assert "tests/fixtures/mytube/feed.synthetic.html" in got
    marker = dest / "tests" / "fixtures" / "THIRD_PARTY_OMITTED.txt"
    assert "tests/fixtures/youtube/watch/a.html" in marker.read_text(encoding="utf-8")


def test_export_fails_when_scanner_finds_something(tmp_path: Path) -> None:
    repo = _fake_repo(tmp_path / "repo", {"plugin/b.py": "P = '" + BAD["profile_s3"] + "'\n"})
    r = _export(repo, tmp_path / "out")
    assert r.returncode != 0
    assert "plugin/b.py:1:" in r.stdout


def test_conftest_skips_only_listed_missing_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    import conftest

    rel = "tests/fixtures/youtube/watch/x.html"
    missing = FileNotFoundError(2, "No such file", str(ROOT / rel))
    assert conftest.omitted_fixture_reason(missing) is None  # without the list a missing file fails
    monkeypatch.setattr(conftest, "_OMITTED", frozenset({rel}))
    assert rel in (conftest.omitted_fixture_reason(missing) or "")
    other = FileNotFoundError(2, "No such file", str(ROOT / "tests/fixtures/mytube/y.json"))
    assert conftest.omitted_fixture_reason(other) is None
    assert conftest.omitted_fixture_reason(AssertionError("x")) is None
    # any failure after trying to open the omitted page (error swallowed by a fake transport)
    assert rel in (conftest.omitted_fixture_reason(AssertionError("x"), {rel}) or "")
    events: list[tuple[str, tuple]] = [("open", (str(ROOT / rel), "rb", 0))]
    monkeypatch.setattr(conftest, "_ATTEMPTED", set())
    for ev, args in events:
        conftest._audit(ev, args)
    assert conftest._ATTEMPTED == {rel}


# --------------------------------------------------------------------------- build labels

# Fake build labels (the real ones never appear in this file): "U1" owns two modules, "V2a" owns
# a dialog only, "W3" appears only as a brief file name, "X10" is a key name and not a label.
LABELLED = {
    "units/V2a.md": "brief\n",
    "handoff/W3.md": "handoff\n",
    "contract/owners.yaml": (
        "# owners (U1 writes the API)\n"
        "units: [\n  U1, V2a,\n]\n"
        "modules:\n"
        "  plugin/api/status.py: U1   # GET /status\n"
        "  plugin/core/_refresh.py: U1\n"
        "dialogs:\n"
        "  tab-editor: V2a\n"
    ),
    "contract/api.yaml": (
        "paths:\n  /status:\n    get:\n      x-module: plugin/api/status.py\n      x-unit: U1\n"
        "      description: U1 stays in prose here\n"
    ),
    "plugin/core/types.py": (
        'SPECS = [BuildSpec("plugin/api/status.py", "U1"), BuildSpec("x.py", "V2a")]\n'
        'KEY = "X10"\nTEXT = "U1 in a sentence"\n'
    ),
    "tests/test_taxonomy.py": 'OURS = [o for o in OPS if o.get("x-unit") == "U1"]\nOTHER = "U1"\n',
    "tests/fixtures/README.md": "# fixtures (unit W3)\n| a.html | V2a |\n",
    "desktop-src/keys.ts": "if (e.key === 'X10') open()\n",
}


def test_export_swaps_build_labels_for_area_names(tmp_path: Path) -> None:
    repo = _fake_repo(tmp_path / "repo", LABELLED)
    dest = tmp_path / "out"
    r = _export(repo, dest)
    assert r.returncode == 0, r.stdout + r.stderr
    owners = (dest / "contract" / "owners.yaml").read_text(encoding="utf-8")
    assert owners == (
        "# owners (area-status writes the API)\n"
        "units: [\n  area-status, area-tab-editor,\n]\n"
        "modules:\n"
        "  plugin/api/status.py: area-status   # GET /status\n"
        "  plugin/core/_refresh.py: area-status\n"
        "dialogs:\n"
        "  tab-editor: area-tab-editor\n"
    )
    api = (dest / "contract" / "api.yaml").read_text(encoding="utf-8")
    assert "x-unit: area-status\n" in api
    assert "U1 stays in prose here" in api, "only the x-unit lines of the contract change"
    types_py = (dest / "plugin" / "core" / "types.py").read_text(encoding="utf-8")
    assert '"area-status"' in types_py and '"area-tab-editor"' in types_py
    assert '"X10"' in types_py and '"U1 in a sentence"' in types_py
    tax = (dest / "tests" / "test_taxonomy.py").read_text(encoding="utf-8")
    assert '== "area-status"' in tax and 'OTHER = "U1"' in tax
    readme = (dest / "tests" / "fixtures" / "README.md").read_text(encoding="utf-8")
    assert "W3" not in readme and "V2a" not in readme and "(unit area-" in readme
    assert (dest / "desktop-src" / "keys.ts").read_text(encoding="utf-8") == (
        "if (e.key === 'X10') open()\n"
    ), "files outside the list are never touched"
    # the cut's own export (no briefs, labels already swapped) changes nothing
    cut = tmp_path / "cut"
    for p in sorted(dest.rglob("*")):
        if p.is_file():
            (cut / p.relative_to(dest)).parent.mkdir(parents=True, exist_ok=True)
            (cut / p.relative_to(dest)).write_bytes(p.read_bytes())
    for rel in ("scripts/export-public", "scripts/public_scan.py"):
        (cut / rel).write_bytes((repo / rel).read_bytes())
    _git(cut, "init", "-q")
    _git(cut, "add", "-A")
    _git(cut, "commit", "-q", "-m", "x")
    again = tmp_path / "again"
    assert _export(cut, again).returncode == 0
    for rel in LABELLED:
        if (dest / rel).is_file():
            assert (again / rel).read_bytes() == (dest / rel).read_bytes(), rel


def test_export_without_owners_file_changes_nothing(tmp_path: Path) -> None:
    files = {"tests/test_taxonomy.py": 'OURS = o.get("x-unit") == "U1"\n'}
    repo = _fake_repo(tmp_path / "repo", files)
    dest = tmp_path / "out"
    assert _export(repo, dest).returncode == 0
    assert (dest / "tests" / "test_taxonomy.py").read_text(encoding="utf-8") == (
        files["tests/test_taxonomy.py"]
    ), "without contract/owners.yaml there is no label map: U1 is only a brief name here"


def _exporter():
    from importlib.machinery import SourceFileLoader

    loader = SourceFileLoader("export_public", str(EXPORTER))
    spec = importlib.util.spec_from_loader("export_public", loader)
    assert spec is not None
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def _real_labels() -> set[str]:
    import re

    owners = (ROOT / "contract" / "owners.yaml").read_text(encoding="utf-8")
    m = re.search(r"^units:\s*\[(.*?)\]", owners, re.MULTILINE | re.DOTALL)
    assert m
    labels = {u.strip() for u in m.group(1).replace("\n", " ").split(",") if u.strip()}
    labels = {u for u in labels if _exporter().LABEL_SHAPE.fullmatch(u)}
    if not labels:
        pytest.skip("the owners file carries area names, not build labels (public cut)")
    return labels


def test_exporter_source_names_no_real_label() -> None:
    import re

    text = EXPORTER.read_text(encoding="utf-8")
    labels = sorted(_real_labels(), key=len, reverse=True)
    rx = re.compile(r"(?<![\w-])(?:" + "|".join(map(re.escape, labels)) + r")(?![\w-])")
    assert not rx.findall(text)


def test_label_files_of_this_repository_come_out_without_labels() -> None:
    """Every file listed for the swap, as it is in this checkout, keeps no label of the owners
    file once swapped (a label added in a new place of those files shows up here)."""
    import re

    real = _real_labels()
    ex = _exporter()
    paths = [
        p.relative_to(ROOT).as_posix()
        for d in ex.LABEL_DIRS
        if (ROOT / d).is_dir()
        for p in (ROOT / d).iterdir()
    ]
    names = ex.label_map(paths, (ROOT / ex.OWNERS_FILE).read_text(encoding="utf-8"))
    assert real <= set(names)
    assert len(set(names.values())) == len(names), "one area per label"
    rx = re.compile(
        r"(?<![\w-])(?:" + "|".join(map(re.escape, sorted(names, key=len, reverse=True))) + r")"
        r"(?![\w])"
    )
    left = []
    for rel, mode in ex.LABEL_FILES.items():
        path = ROOT / rel
        if not path.is_file():
            continue
        out = ex.swap_labels(path.read_text(encoding="utf-8"), mode, names)
        left += [f"{rel}: {m}" for m in rx.findall(out)]
    assert not left, left[:20]


def test_real_cut_stays_ruff_clean_after_the_label_swap(tmp_path: Path) -> None:
    """The exporter swaps short build labels for longer area names. A line that fits here can
    overflow in the cut, and the cut's own check then fails on ruff. Export HEAD and lint it."""
    if subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True
    ).returncode:
        pytest.skip("not a git checkout (the public cut itself)")
    try:
        import ruff  # noqa: F401
    except ImportError:
        pytest.skip("ruff is not installed")
    dest = tmp_path / "cut"
    _export(ROOT, dest, "--no-third-party-pages")
    assert (dest / "pyproject.toml").is_file(), "export wrote nothing"
    for args in (["check", "--quiet", "."], ["format", "--check", "--quiet", "."]):
        r = subprocess.run(
            [sys.executable, "-m", "ruff", *args], cwd=dest, capture_output=True, text=True
        )
        assert r.returncode == 0, f"ruff {args[0]} fails in the public cut:\n{r.stdout[-1500:]}"
