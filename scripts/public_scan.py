#!/usr/bin/env python3
"""Public-cut scanner: finds personal, internal or secret data in a folder before publishing.

    python3 scripts/public_scan.py <folder>

Reads every text file in the folder (except `.git/` and `node_modules/`) and lists
`file:line: rule: snippet` for each finding. Images and binaries are not read: they go into the
report with name and size.
Exit 0 = nothing found; 1 = findings; 2 = usage error.

The searched texts that identify someone (machine user, Telegram id) are built from pieces, so
this file, which also goes public, neither contains the literal nor triggers itself.
Standard library only.
"""

from __future__ import annotations

import fnmatch
import ipaddress
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SKIP_DIRS = {".git", "node_modules"}

BINARY_EXT = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".icns",
    ".bmp",
    ".avif",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".zip",
    ".gz",
    ".tgz",
    ".npy",
    ".pdf",
    ".mp4",
    ".webm",
    ".mov",
    ".mp3",
    ".wasm",
    ".db",
    ".sqlite",
}

# --------------------------------------------------------------------------- pieced texts

_USER = "pedro" + "beraldo"  # the author's machine user
_GH = _USER + "87"  # the author's public GitHub account

# Allowed contexts for the user: the public repository, the old app's, the GitHub profile and the
# X profile (the two public contacts of the credits).
ALLOWED_USER_CONTEXTS = (
    _GH + "/" + "hermes" + "-tube",
    _GH + "/" + "MyTube",
    "github.com/" + _GH,
    "x.com/" + _USER,
)
_ALLOWED_USER_RX = tuple(
    # whole host and whole name only: "dropbox.com/<user>" or "x.com/<user>_other" are not the
    # X profile; a subdomain ("www.x.com") or a path after the name still is
    re.compile(r"(?<![\w-])" + re.escape(ctx) + r"(?![\w-])", re.IGNORECASE)
    for ctx in ALLOWED_USER_CONTEXTS
)

# Allowed e-mails: (address pattern, file pattern, why). A short list, each item justified.
ALLOWED_EMAILS: tuple[tuple[str, str, str], ...] = (
    # domains reserved for examples (RFC 2606): tests and documentation
    ("*@example.com", "*", "example domain (RFC 2606)"),
    ("*@example.org", "*", "example domain (RFC 2606)"),
    ("*@example.net", "*", "example domain (RFC 2606)"),
    # public third-party pages saved as fixtures (only there): the site's own public contact
    ("hn" + "@ycombinator.com", "tests/fixtures/lists/*", "Hacker News public footer"),
    (
        "receitadaminhafamilia" + "@gmail.com",
        "tests/fixtures/youtube/search/*",
        "business contact in the public description of a video (saved YouTube search)",
    ),
)


@dataclass(frozen=True)
class Rule:
    name: str
    rx: re.Pattern[str]
    secret: bool = False  # snippet masked in the report, without context
    reveal: int = 4  # how many characters of the masked finding are shown


def _global_ipv4(text: str) -> bool:
    """A real public address (not local/private/documentation, nor a version like 142.0.0.0)."""
    if text.endswith(".0.0"):
        return False
    try:
        ip = ipaddress.ip_address(text)
        return ip.is_global and not ip.is_multicast
    except ValueError:
        return False


_IPV6 = r"[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}"
_IPV4 = r"\d{1,3}(?:\.\d{1,3}){3}"


RULES: tuple[Rule, ...] = (
    Rule("macos-path", re.compile("/Us" + "ers/")),
    Rule("home-path", re.compile(r"(?<![\w.-])/home/[a-z_][a-z0-9_.-]*")),
    Rule("machine-user", re.compile(re.escape(_USER), re.IGNORECASE)),
    Rule("machine-name", re.compile("mac" + "book", re.IGNORECASE)),
    Rule("internal-profile", re.compile(r"(?<![\w-])tube-(?:dev|s[1-5])(?![\w])")),
    Rule("profile-folder", re.compile(re.escape(".her" + "mes/prof" + "iles/"))),
    Rule("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    Rule("telegram-token", re.compile(r"(?<!\d)\d{8,10}:[A-Za-z0-9_-]{30,}"), secret=True),
    Rule("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), secret=True),
    Rule("sk-key", re.compile(r"(?<![\w-])sk-[A-Za-z0-9_-]{16,}"), secret=True),
    Rule("slack-token", re.compile(r"\bxox[abpr]-[A-Za-z0-9-]{10,}"), secret=True),
    Rule(
        "private-key",
        re.compile(r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----"),
        secret=True,
    ),
    # IP of whoever captured a page (YouTube writes the client address into ytcfg and into URLs)
    Rule("client-ip", re.compile('"remote' + 'Host":"' + '[^"]+"'), secret=True, reveal=0),
    Rule(
        "client-ip",
        re.compile(r"(?:\\u0026|[?&;]|%26)ip(?:=|%3D)(?:" + _IPV4 + "|" + _IPV6 + ")"),
        secret=True,
        reveal=0,
    ),
    Rule("public-ip", re.compile(r"(?<![\w.\-/])" + _IPV4 + r"(?![\w.])"), secret=True, reveal=0),
)
CHECKS = {"public-ip": _global_ipv4}


@dataclass(frozen=True)
class Hit:
    path: str
    line: int
    rule: str
    snippet: str

    def render(self) -> str:
        return f"{self.path}:{self.line}: {self.rule}: {self.snippet}"


# Private terms (account ids, machine names, anything specific to whoever publishes) are NOT in this
# file: they live in an untracked list, one literal per line (`#` starts a comment), read from
# PUBLIC_SCAN_PRIVATE or from `public_scan.private` next to this script. Without the list the
# generic rules still run.
PRIVATE_ENV = "PUBLIC_SCAN_PRIVATE"
PRIVATE_FILE = Path(__file__).resolve().with_name("public_scan.private")


def private_terms(path: Path | None = None) -> tuple[str, ...]:
    """Literals from the untracked list (empty when there is none)."""
    src = path or Path(os.environ.get(PRIVATE_ENV) or PRIVATE_FILE)
    try:
        lines = src.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ()
    return tuple(t for t in (ln.strip() for ln in lines) if t and not t.startswith("#"))


def _private_rules(terms: tuple[str, ...]) -> tuple[Rule, ...]:
    return tuple(
        Rule(
            "private-term",
            re.compile(r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])", re.IGNORECASE),
            secret=True,
            reveal=0,
        )
        for t in terms
    )


# Public addresses that are fine to publish: (address, file pattern, why).
ALLOWED_IPS: tuple[tuple[str, str, str], ...] = (
    ("8.8." + "8.8", "tests/*", "well-known public DNS resolver, used as a test vector"),
    (
        "142.250." + "78.14",
        "tests/test_security_http.py",
        "a public web address, used as a test vector",
    ),
)


def _ip_allowed(addr: str, path: str) -> bool:
    return any(addr == ip and fnmatch.fnmatchcase(path, where) for ip, where, _why in ALLOWED_IPS)


def _email_allowed(addr: str, path: str) -> bool:
    a = addr.lower()
    return any(
        fnmatch.fnmatchcase(a, pat) and fnmatch.fnmatchcase(path, where)
        for pat, where, _why in ALLOWED_EMAILS
    )


def _mask(text: str, reveal: int) -> str:
    return text[:reveal] + "…(" + str(len(text)) + " chars, masked)"


def _snippet(line: str, start: int, end: int, rule: Rule) -> str:
    found = line[start:end]
    if rule.secret:
        return _mask(found, rule.reveal)
    before = line[max(0, start - 40) : start]
    after = line[end : end + 40]
    return (before + found + after).strip()


def scan_text(text: str, path: str) -> list[Hit]:
    """Findings in a text; `path` is the relative path (with `/`), used by the allow lists."""
    hits: list[Hit] = []
    for n, line in enumerate(text.splitlines(), start=1):
        masked = line
        for rx in _ALLOWED_USER_RX:
            masked = rx.sub(lambda m: "#" * len(m.group(0)), masked)
        for rule in RULES + _private_rules(private_terms()):
            subject = masked if rule.name == "machine-user" else line
            for m in rule.rx.finditer(subject):
                if rule.name == "email" and _email_allowed(m.group(0), path):
                    continue
                if rule.name == "public-ip" and _ip_allowed(m.group(0), path):
                    continue
                check = CHECKS.get(rule.name)
                if check and not check(m.group(0)):
                    continue
                hits.append(Hit(path, n, rule.name, _snippet(line, m.start(), m.end(), rule)))
    return hits


def _is_binary(path: Path, head: bytes) -> bool:
    return path.suffix.lower() in BINARY_EXT or b"\x00" in head


def iter_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            yield Path(dirpath) / name


def scan_tree(root: Path) -> tuple[list[Hit], list[tuple[str, int]], int]:
    """(findings, binaries [(path, bytes)], number of text files read)."""
    hits: list[Hit] = []
    binaries: list[tuple[str, int]] = []
    texts = 0
    for p in iter_files(root):
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            hits.append(Hit(rel, 0, "symlink", "-> " + os.readlink(p)))
            continue
        data = p.read_bytes()
        if _is_binary(p, data[:8192]):
            binaries.append((rel, len(data)))
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            binaries.append((rel, len(data)))
            continue
        texts += 1
        hits.extend(scan_text(text, rel))
        # the file name is public text too
        hits.extend(Hit(rel, 0, h.rule, "(file name)") for h in scan_text(rel, rel))
    return hits, binaries, texts


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] in ("-h", "--help"):
        print("usage: python3 scripts/public_scan.py <folder>", file=sys.stderr)
        return 2
    root = Path(argv[0])
    if not root.is_dir():
        print(f"public_scan: not a folder: {root}", file=sys.stderr)
        return 2
    hits, binaries, texts = scan_tree(root)
    for h in hits:
        print(h.render())
    if binaries:
        print(f"binary files ({len(binaries)}, not read):")
        for rel, size in binaries:
            print(f"  {rel} {size} bytes")
    print(
        f"public_scan: {len(hits)} finding(s); {texts} text file(s); {len(binaries)} binary file(s)"
    )
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
