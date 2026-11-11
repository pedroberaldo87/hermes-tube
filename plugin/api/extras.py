"""REST routes of ``plugin/api/extras.py``.

The Extras do not exist in this version (page hidden, ``Lens`` still a stub, settings left out of
the form). Instead of the contract example, the routes tell the truth:

- ``GET /extras`` → everything off, HN dataset not downloaded, zero videos;
- ``POST /extras`` → validates the body (``ExtrasPatch``) and **turns nothing on**: returns the same
  state;
- ``POST /extras/hn/download`` and ``GET /extras/hn/channels`` → ``conflict`` (Extra turned off).

No network, no thread, no settings written. The bodies get replaced when the Extras exist (names
and signatures stay). Signatures: ``plugin/api/_common.py``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg.api._common import Envelope, contract, fail, ok

HN_CREDIT = "HackerTube (hackertube.org), ODC-By"
PATCH_KEYS = ("honest_thumbnails", "hn_lens", "hn_channels", "import_lists")

_TEXT = {
    "pt": {
        "off": "Os Extras não estão disponíveis nesta versão.",
        "invalid": "Mande ao menos um destes campos, com true/false: {keys}.",
    },
    "en": {
        "off": "Extras are not available in this version.",
        "invalid": "Send at least one of these fields, with true/false: {keys}.",
    },
}


def _msg(key: str, **kw: Any) -> str:
    from tube_pkg import wiring
    from tube_pkg.core import lang

    try:
        settings = wiring.get_settings()
    except Exception:  # noqa: BLE001 — without readable settings, the rule falls back to English
        settings = None
    return _TEXT[lang.short(lang.resolve(settings))][key].format(**kw)


def extras_off() -> Envelope:
    """The answer of everything that belongs to an Extra while Extras are off: ``conflict``."""
    return fail("conflict", _msg("off"))


def _state() -> dict[str, Any]:
    return {
        "honest_thumbnails": False,
        "hn_lens": False,
        "hn_channels": False,
        "import_lists": False,
        "hn_dataset_ready": False,
        "hn_video_count": 0,
        "hn_credit": HN_CREDIT,
    }


@contract.real
def get_extras(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /extras — the real state: no Extra turned on in this version."""
    return ok(_state())


@contract.real
def post_extras(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /extras — validates the request and turns nothing on (no Extras in this version)."""
    data = body if isinstance(body, Mapping) else {}
    valid = bool(data) and all(k in PATCH_KEYS and type(v) is bool for k, v in data.items())
    if not valid:
        return fail("invalid", _msg("invalid", keys=", ".join(PATCH_KEYS)))
    return ok(_state())


@contract.real
def post_extras_hn_download(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /extras/hn/download — Extra turned off: ``conflict``, nothing downloaded."""
    return fail("conflict", _msg("off"))


@contract.real
def get_extras_hn_channels(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /extras/hn/channels — Extra turned off: ``conflict``."""
    return fail("conflict", _msg("off"))
