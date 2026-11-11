"""The server proves to the extension that it is this Hermes, without a new route.

Two proofs, both additive on existing routes (``contract/ext-protocol.md`` §3):

**Pairing (PAKE).** The extension must not send the 6-digit code to whatever listens on
127.0.0.1:47615-47624: another program could be there. So the code is never sent. Both sides run
SPAKE2 over the 2048-bit MODP group of RFC 3526 (prime-order subgroup, generator 2) with the
password ``w = SHA-256("hermestube-pair-v1|" + code) mod q``:

- round 1, ``POST /pair/complete {name, pake: {x}}`` → ``{pake: {session, y, confirm}}``. The
  server spends one attempt of the code (as a wrong code would): every guess an impostor makes
  costs an attempt and a code locks after 5.
- the extension checks ``confirm`` before anything else: only a server that knows the code (and
  answers on the port the extension dialled, which is part of the transcript, so relaying to the
  real server fails) can produce it. A program that does not know the code learns nothing it can
  test offline.
- round 2, ``POST /pair/complete {name, pake: {session, confirm}}`` → ``PairedDevice``.

The server keeps only a salted hash of the code (``core/devices``), so it recovers the code from
its own hash once per code (10⁶ candidates, ~0.4 s) and caches it in memory.

**Later requests.** Before the extension sends its token to a port it asks
``GET /health?device=<id>&nonce=<hex>``; the server answers ``proof = HMAC-SHA256(key=sha256(token)
as hex, "hermestube-server-v1|" + nonce + "|" + port)``. The database already holds
``sha256(token)``; an impostor does not.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

# RFC 3526, group 14 (2048-bit MODP). p is a safe prime, p ≡ 7 (mod 8): 2 is a quadratic residue
# and generates the subgroup of prime order q = (p - 1) / 2.
P = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
    "15728E5A8AACAA68FFFFFFFFFFFFFFFF",
    16,
)
Q = (P - 1) // 2
G = 2
PAKE_VERSION = "hermestube-pair-v1"
SERVER_PROOF_VERSION = "hermestube-server-v1"
SESSION_TTL_S = 60.0
MAX_SESSIONS = 16
ELEMENT_HEX = 512
"""A group element travels as 512 lowercase hex digits (2048 bits, zero-padded)."""

_HEX = re.compile(r"[0-9a-f]+")
_NONCE = re.compile(r"[0-9a-f]{32,128}")


def _hash_to_group(label: str) -> int:
    """An element of the order-q subgroup whose discrete log nobody knows: a hash squared mod p."""
    blocks = b"".join(
        hashlib.sha256(f"{label}|{i}".encode()).digest() for i in range(9)
    )  # 2304 bits, reduced mod p
    return pow(int.from_bytes(blocks, "big") % P, 2, P)


M = _hash_to_group(f"{PAKE_VERSION}|M")
N = _hash_to_group(f"{PAKE_VERSION}|N")


def to_hex(value: int) -> str:
    return format(value, "x").rjust(ELEMENT_HEX, "0")


def parse_element(text: object) -> int | None:
    """A received element, only if it is in the order-q subgroup (and not 1)."""
    if not isinstance(text, str) or len(text) != ELEMENT_HEX or not _HEX.fullmatch(text):
        return None
    value = int(text, 16)
    if not 1 < value < P - 1 or pow(value, Q, P) != 1:
        return None
    return value


def password_scalar(code: str) -> int:
    digest = hashlib.sha256(f"{PAKE_VERSION}|{code}".encode()).digest()
    return int.from_bytes(digest, "big") % Q


def _random_scalar() -> int:
    return 1 + secrets.randbelow(Q - 1)


def session_key(port: int, x: int, y: int, k: int) -> bytes:
    transcript = f"{PAKE_VERSION}|127.0.0.1:{int(port)}|{to_hex(x)}|{to_hex(y)}|{to_hex(k)}"
    return hashlib.sha256(transcript.encode()).digest()


def confirm(key: bytes, role: str) -> str:
    return hmac.new(key, f"{PAKE_VERSION}|{role}".encode(), hashlib.sha256).hexdigest()


def server_round(code: str, x_hex: object, port: int) -> tuple[str, str, bytes] | None:
    """Round 1 on the server: ``(y_hex, server_confirm, key)``; ``None`` if ``x`` is not valid."""
    x = parse_element(x_hex)
    if x is None:
        return None
    w = password_scalar(code)
    b = _random_scalar()
    y = pow(G, b, P) * pow(N, w, P) % P
    k = pow(x * pow(M, Q - w, P) % P, b, P)
    key = session_key(port, x, y, k)
    return to_hex(y), confirm(key, "server"), key


def client_start(code: str) -> tuple[int, str]:
    """Extension side (tests and reference): ``(a, x_hex)``."""
    a = _random_scalar()
    x = pow(G, a, P) * pow(M, password_scalar(code), P) % P
    return a, to_hex(x)


def client_finish(code: str, a: int, x_hex: str, y_hex: object, port: int) -> bytes | None:
    """Extension side: the session key, or ``None`` if ``y`` is not a valid element."""
    y = parse_element(y_hex)
    if y is None:
        return None
    w = password_scalar(code)
    k = pow(y * pow(N, Q - w, P) % P, a, P)
    return session_key(port, int(x_hex, 16), y, k)


def same(a: object, b: str) -> bool:
    return isinstance(a, str) and hmac.compare_digest(a.encode(), b.encode())


# ------------------------------------------------------------------ server proof for /health


def valid_nonce(nonce: object) -> bool:
    return isinstance(nonce, str) and bool(_NONCE.fullmatch(nonce))


def server_proof(token_hash_hex: str, nonce: str, port: int) -> str:
    message = f"{SERVER_PROOF_VERSION}|{nonce}|{int(port)}".encode()
    return hmac.new(token_hash_hex.encode(), message, hashlib.sha256).hexdigest()


# ------------------------------------------------------------------ code recovery and sessions


def recover_code(stored: str, digits: int = 6) -> str | None:
    """The code behind ``<salt>$sha256(salt + code)`` (the format of ``pair_codes.code_hash``)."""
    salt, sep, digest = str(stored or "").partition("$")
    if not sep or not re.fullmatch(r"[0-9a-f]{64}", digest):
        return None
    target = bytes.fromhex(digest)
    base = hashlib.sha256(salt.encode())
    for i in range(10**digits):
        h = base.copy()
        h.update(f"{i:0{digits}d}".encode())
        if h.digest() == target:
            return f"{i:0{digits}d}"
    return None


@dataclass
class _Session:
    key: bytes
    code: str
    stored: str
    expires: float


class PakeSessions:
    """Round-1 results waiting for round 2 (memory of the server process; single use)."""

    def __init__(
        self, ttl_s: float = SESSION_TTL_S, now: Callable[[], float] | None = None
    ) -> None:
        self.ttl_s = ttl_s
        self._now = now or time.monotonic
        self._lock = threading.Lock()
        self._sessions: dict[str, _Session] = {}
        self._codes: dict[str, str] = {}

    def code_for(self, stored: str) -> str | None:
        with self._lock:
            known = self._codes.get(stored)
        if known is not None:
            return known
        code = recover_code(stored)
        if code is not None:
            with self._lock:
                if len(self._codes) >= 4:
                    self._codes.clear()
                self._codes[stored] = code
        return code

    def open(self, key: bytes, code: str, stored: str) -> str:
        sid = secrets.token_hex(16)
        now = self._now()
        with self._lock:
            for old in [s for s, v in self._sessions.items() if v.expires <= now]:
                del self._sessions[old]
            while len(self._sessions) >= MAX_SESSIONS:
                del self._sessions[next(iter(self._sessions))]
            self._sessions[sid] = _Session(key, code, stored, now + self.ttl_s)
        return sid

    def take(self, sid: object) -> _Session | None:
        """The session (removed: single use), if it exists and has not expired."""
        if not isinstance(sid, str):
            return None
        with self._lock:
            found = self._sessions.pop(sid, None)
        if found is None or found.expires <= self._now():
            return None
        return found

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()
            self._codes.clear()


SESSIONS = PakeSessions()


__all__ = [
    "ELEMENT_HEX",
    "G",
    "M",
    "N",
    "P",
    "PAKE_VERSION",
    "Q",
    "SESSIONS",
    "PakeSessions",
    "client_finish",
    "client_start",
    "confirm",
    "parse_element",
    "password_scalar",
    "recover_code",
    "same",
    "server_proof",
    "server_round",
    "session_key",
    "to_hex",
    "valid_nonce",
]
