"""Device authentication on the ``/ext/*`` routes.

``authenticate(authorization, origin, *, devices) -> Device`` (ext-protocol.md §9), called by
``_mount.py`` before every Bearer handler. Delegates to ``_mount.bearer_authenticator`` (which uses
``DeviceAuth.verify`` — updates ``last_seen``):

- no ``Authorization``, another scheme, empty, unknown or revoked token → ``Unauthorized``
  (401 + ``WWW-Authenticate: Bearer`` in the mount);
- origin pinned at pairing and a different ``Origin`` present → ``_mount.TransportError
  ("origin_mismatch")`` (403); without ``Origin`` (service worker GET) the token is the boundary;
- ``DeviceAuth`` still a stub (``NotImplementedError``) → refuses everything with ``Unauthorized``.
"""

from __future__ import annotations

from tube_pkg.api._common import contract
from tube_pkg.core import types as T
from tube_pkg.ext._mount import bearer_authenticator


@contract.real
def authenticate(
    authorization: str | None, origin: str | None, *, devices: T.DeviceAuth
) -> T.Device:
    """``Authorization`` header (Bearer scheme) → ``Device``; raises ``Unauthorized`` or
    ``TransportError("origin_mismatch")``."""
    try:
        return bearer_authenticator(devices)(authorization, origin)
    except NotImplementedError:
        raise T.Unauthorized("pairing unavailable") from None
