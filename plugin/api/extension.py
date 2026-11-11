"""REST routes of ``plugin/api/extension.py`` — the \"Set up the extension\" button.

- ``GET /extension/setup`` — what the button offers (set up, update, already there, a folder that
  is not ours, no bundled extension) and the Chromium browsers installed on the computer where
  Hermes runs (with Hermes inside WSL: the Windows browsers, ``platform: windows`` and a ``wsl``
  object). Reads only.
- ``POST /extension/setup`` — the click: copies the extension shipped in the plugin to the fixed
  folder in the home folder and opens the browser's Extensions page and the file manager
  (``core/extension_setup.py``). The body may hold **one** field, ``browser``: a key of the
  closed list (``chrome``, ``edge``…), never a path or a command; any other field or value is
  refused (``invalid``) before anything is written. The query is ignored.

Only the Desktop calls these routes (behind the dashboard gate): no tool, routine, command or
messaging surface reaches them. Errors are generic outside; the details go to the log.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from tube_pkg._id import PLUGIN_ID
from tube_pkg.api._common import Envelope, contract, fail, ok
from tube_pkg.core import extension_setup

logger = logging.getLogger(__name__)

_REFUSED = {
    "not_ours": "a folder with this name already exists and was not created by Hermes",
    "no_bundle": "this copy of the plugin has no built extension",
}
_BODY_FIELDS = frozenset({"browser"})


@contract.real
def get_extension_setup(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /extension/setup.

    Extension folder status and the browsers found (reads only)
    """
    try:
        return ok(extension_setup.status())
    except OSError:
        logger.exception("%s: could not read the extension folder status", PLUGIN_ID)
        return fail("internal", "could not read the extension folder", reason="read_failed")


@contract.real
def post_extension_setup(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /extension/setup.

    Set up (or update) the extension folder and open the browser
    """
    data = dict(body or {})
    extra = sorted(set(data) - _BODY_FIELDS)
    if extra:
        return fail("invalid", "unknown field", details={"field": extra[0]})
    try:
        browser = extension_setup.check_browser_key(data.get("browser"))
    except ValueError:
        return fail("invalid", "unknown browser", details={"field": "browser"})
    try:
        return ok(extension_setup.run(browser))
    except extension_setup.SetupRefused as exc:
        return fail("conflict", _REFUSED.get(exc.reason, "refused"), reason=exc.reason)
    except OSError:
        logger.exception("%s: could not prepare the extension folder", PLUGIN_ID)
        return fail("internal", "could not prepare the extension folder", reason="write_failed")
