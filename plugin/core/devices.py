"""Device pairing and auth: ``DeviceAuth`` over ``devices`` and ``pair_codes``.

Rules (``types.DeviceAuth``):

- **Code** — 6 digits (``secrets.randbelow``), valid for **300 s**, single use, **5 wrong
  attempts** lock it (``locked``); a new code invalidates the previous unused one and resets the
  attempts.
- **Token** — ``tok_`` + 32 random bytes (``token_urlsafe``); shown once.
- **Hashes only** — ``devices.token_hash`` = ``sha256(token)`` (hex); ``pair_codes.code_hash`` =
  ``<salt>$sha256(salt + code)``: the per-code salt avoids key collisions when a code repeats and
  nothing in clear goes to the file/WAL. The code and the token are never logged.
- **Code state** in ``pair_codes`` (schema v1, no new columns):
  active = ``used_at IS NULL``; used = ``used_at`` + ``device_id``; replaced or locked =
  ``used_at`` without ``device_id``. The attempt count of the current code lives in ``meta``
  (``pair_attempts`` = ``{"code_hash", "attempts"}``; one current code at a time). Locking also
  closes the row, so the ``_server`` default reader (``used_at IS NULL AND expires_at > now``)
  agrees with ``pairing_open``.
- **Atomic across processes** — ``complete_pairing`` runs in ``Db.transaction()`` (``BEGIN
  IMMEDIATE``) and ``PairingFailed`` is raised only **after** the ``COMMIT``: the attempt counts
  even when it fails.
- Token lookup is by ``sha256(token)``; the code is compared with ``hmac.compare_digest``.
- ``verify`` updates ``last_seen``; ``revoke`` is idempotent (keeps the first ``revoked_at``).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
from typing import Any

from tube_pkg.core import types as T

log = logging.getLogger(__name__)

PAIRING_TTL_S = 300
"""Validity of the pairing code."""
MAX_ATTEMPTS = 5
"""Wrong attempts before the current code locks."""
CODE_DIGITS = 6
TOKEN_PREFIX = "tok_"
TOKEN_BYTES = 32
DEVICE_NAME_MAX = 80
CODE_RETENTION_S = 86_400
"""Closed ``pair_codes`` rows older than this are deleted on the next ``start``."""
USED_LOOKBACK = 20
"""Recent used codes checked to answer ``used`` (instead of ``no_active_code``)."""
META_ATTEMPTS = "pair_attempts"


def token_hash(token: str) -> str:
    """``sha256(token)`` in hex (what goes to ``devices.token_hash``)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _code_hash(code: str, salt: str) -> str:
    return f"{salt}${hashlib.sha256((salt + code).encode('utf-8')).hexdigest()}"


def _code_matches(code: str, stored: str) -> bool:
    salt, sep, _ = stored.partition("$")
    if not sep:
        return False
    return hmac.compare_digest(_code_hash(code, salt), stored)


_DEVICE_COLS = "id, name, created_at, last_seen, revoked_at, origin"


def _device(row: T.Row) -> T.Device:
    return T.Device(
        id=str(row["id"]),
        name=str(row["name"] or ""),
        created_at=int(row["created_at"]),
        last_seen=None if row["last_seen"] is None else int(row["last_seen"]),
        revoked_at=None if row["revoked_at"] is None else int(row["revoked_at"]),
        origin=row["origin"] or None,
    )


def _locked() -> T.PairingFailed:
    return T.PairingFailed("locked", "too many attempts; create a new code in Hermes")


def _no_active() -> T.PairingFailed:
    return T.PairingFailed("no_active_code", "no active pairing code")


class DeviceAuthImpl:
    """Real ``DeviceAuth`` over the plugin's SQLite."""

    PAIRING_TTL_S = PAIRING_TTL_S
    MAX_ATTEMPTS = MAX_ATTEMPTS

    def __init__(self, *, db: T.Db, settings: T.Settings, clock: T.Clock | None = None) -> None:
        self.db = db
        self.settings = settings
        self.clock = clock or T.SystemClock()

    def _now(self) -> int:
        return int(self.clock.now())

    # ------------------------------------------------------------------ pairing

    def start_pairing(self) -> T.PairingCode:
        code = f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"
        stored = _code_hash(code, secrets.token_hex(8))
        with self.db.transaction():
            now = self._now()
            expires = now + PAIRING_TTL_S
            # invalidate the previous unused code ("replaced": closed and without a device)
            self.db.execute("UPDATE pair_codes SET used_at = ? WHERE used_at IS NULL", (now,))
            self.db.execute(
                "DELETE FROM pair_codes WHERE used_at IS NOT NULL AND created_at < ?",
                (now - CODE_RETENTION_S,),
            )
            self.db.execute(
                "INSERT INTO pair_codes (code_hash, created_at, expires_at) VALUES (?, ?, ?)",
                (stored, now, expires),
            )
            self.db.execute("DELETE FROM meta WHERE key = ?", (META_ATTEMPTS,))
        return T.PairingCode(code=code, expires_at=expires)

    def complete_pairing(
        self, code: str, device_name: str, origin: str | None = None
    ) -> T.PairedDevice:
        code = "".join(str(code or "").split())
        name = " ".join(str(device_name or "").split())[:DEVICE_NAME_MAX]
        pinned = (str(origin).strip() or None) if origin else None
        error: T.PairingFailed | None = None
        paired: T.PairedDevice | None = None
        with self.db.transaction():
            now = self._now()
            latest = self.db.query_one(
                "SELECT rowid AS rid, code_hash, expires_at, used_at, device_id"
                " FROM pair_codes ORDER BY created_at DESC, rowid DESC LIMIT 1"
            )
            if latest is None:
                error = _no_active()
            elif latest["used_at"] is not None:
                error = self._closed_reason(code, latest)
            elif now >= int(latest["expires_at"]):
                error = T.PairingFailed("expired", "code expired; create a new one in Hermes")
            elif not _code_matches(code, str(latest["code_hash"])):
                error = self._count_wrong(latest, now)
            else:
                paired = self._pair(latest, name, pinned, now)
        # raise only after the COMMIT: the attempt and the lock stay recorded
        if error is not None:
            raise error
        assert paired is not None
        return paired

    def _count_wrong(self, latest: T.Row, now: int) -> T.PairingFailed:
        stored = str(latest["code_hash"])
        attempts = self._attempts(stored) + 1
        self.db.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (META_ATTEMPTS, json.dumps({"code_hash": stored, "attempts": attempts})),
        )
        if attempts >= MAX_ATTEMPTS:
            self.db.execute(
                "UPDATE pair_codes SET used_at = ? WHERE rowid = ?", (now, latest["rid"])
            )
            return _locked()
        remaining = MAX_ATTEMPTS - attempts
        error = T.PairingFailed("invalid_code", f"wrong code ({remaining} attempts left)")
        error.details["remaining"] = remaining
        return error

    def _pair(self, row: T.Row, name: str, origin: str | None, now: int) -> T.PairedDevice:
        token = TOKEN_PREFIX + secrets.token_urlsafe(TOKEN_BYTES)
        device = T.Device(
            id=f"dev_{secrets.token_hex(6)}", name=name, created_at=now, origin=origin
        )
        self.db.execute(
            "INSERT INTO devices (id, name, token_hash, created_at, origin) VALUES (?, ?, ?, ?, ?)",
            (device.id, device.name, token_hash(token), now, origin),
        )
        self.db.execute(
            "UPDATE pair_codes SET used_at = ?, device_id = ? WHERE rowid = ?",
            (now, device.id, row["rid"]),
        )
        self.db.execute("DELETE FROM meta WHERE key = ?", (META_ATTEMPTS,))
        return T.PairedDevice(device=device, token=token)

    def _closed_reason(self, code: str, latest: T.Row) -> T.PairingFailed:
        """Latest code already closed: locked, this code already used, or none active."""
        if latest["device_id"] is None and self._attempts(str(latest["code_hash"])) >= MAX_ATTEMPTS:
            return _locked()
        rows = self.db.query(
            "SELECT code_hash FROM pair_codes WHERE device_id IS NOT NULL"
            " ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (USED_LOOKBACK,),
        )
        if any(_code_matches(code, str(r["code_hash"])) for r in rows):
            return T.PairingFailed("used", "code already used; create a new one in Hermes")
        return _no_active()

    def _attempts(self, stored: str) -> int:
        """Wrong attempts of code *stored* (0 if ``meta`` refers to another code)."""
        row = self.db.query_one("SELECT value FROM meta WHERE key = ?", (META_ATTEMPTS,))
        if row is None or not row["value"]:
            return 0
        try:
            data: Any = json.loads(row["value"])
            if data.get("code_hash") != stored:
                return 0
            return max(0, int(data.get("attempts", 0)))
        except (ValueError, TypeError, AttributeError):
            log.warning("meta.%s unreadable; attempts reset", META_ATTEMPTS)
            return 0

    def pairing_open(self) -> bool:
        row = self.db.query_one(
            "SELECT 1 AS x FROM pair_codes WHERE used_at IS NULL AND expires_at > ? LIMIT 1",
            (self._now(),),
        )
        return row is not None

    # ------------------------------------------------------------------ devices

    def verify(self, token: str) -> T.Device:
        if not isinstance(token, str) or not token:
            raise T.Unauthorized("invalid or revoked token")
        row = self.db.query_one(
            f"SELECT {_DEVICE_COLS} FROM devices WHERE token_hash = ?", (token_hash(token),)
        )
        if row is None or row["revoked_at"] is not None:
            raise T.Unauthorized("invalid or revoked token")
        now = self._now()
        self.db.execute(
            "UPDATE devices SET last_seen = ?"
            " WHERE id = ? AND revoked_at IS NULL AND (last_seen IS NULL OR last_seen <> ?)",
            (now, row["id"], now),
        )
        device = _device(row)
        return T.Device(
            id=device.id,
            name=device.name,
            created_at=device.created_at,
            last_seen=now,
            revoked_at=None,
            origin=device.origin,
        )

    def revoke(self, device_id: str) -> bool:
        with self.db.transaction():
            row = self.db.query_one(
                "SELECT revoked_at FROM devices WHERE id = ?", (str(device_id),)
            )
            if row is None:
                return False
            if row["revoked_at"] is None:
                self.db.execute(
                    "UPDATE devices SET revoked_at = ? WHERE id = ?",
                    (self._now(), str(device_id)),
                )
        return True

    def list(self) -> list[T.Device]:
        rows = self.db.query(
            f"SELECT {_DEVICE_COLS} FROM devices WHERE revoked_at IS NULL"
            " ORDER BY created_at, rowid"
        )
        return [_device(r) for r in rows]

    def any_seen_within(self, seconds: float = T.DEVICE_ONLINE_WINDOW_S) -> bool:
        since = float(self._now()) - float(seconds)
        row = self.db.query_one(
            "SELECT 1 AS x FROM devices WHERE revoked_at IS NULL AND last_seen IS NOT NULL"
            " AND last_seen >= ? LIMIT 1",
            (since,),
        )
        return row is not None


def build(*, db: T.Db, settings: T.Settings, clock: T.Clock | None = None) -> T.DeviceAuth:
    """Real ``DeviceAuth`` (signature from ``BUILD_SIGNATURES``; no network or thread)."""
    return DeviceAuthImpl(db=db, settings=settings, clock=clock)


__all__ = [
    "CODE_DIGITS",
    "MAX_ATTEMPTS",
    "PAIRING_TTL_S",
    "TOKEN_PREFIX",
    "DeviceAuthImpl",
    "build",
    "token_hash",
]
