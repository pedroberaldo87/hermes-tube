"""Single server-side language rule: ``/tube``, tools, routines, AI and demo.

Languages: ``en`` and ``pt-BR``. Decision order (``resolve``):

1. **explicit** plugin ``language`` setting (``en`` / ``pt-BR``) — always wins;
2. in ``auto``, **what the surface reports** on this call (``hint``): the ``ui_locale`` the
   Desktop sends, the language of the typed subcommand (``/tube triage`` → ``en``), etc.;
3. **the Hermes language of the profile** (``display.language`` in ``config.yaml``; the same value
   the Desktop app writes and follows), read through the public ``hermes_cli.config`` API — or
   with ``yaml`` directly when Hermes is not importable (routine scripts);
4. no useful information (none of the above, or a language the plugin does not have, such as
   ``es``): **English**.

Without a profile (tests, ``TUBE_DB_PATH``, ``settings`` without ``home``) step 3 reads nothing:
it never touches a real profile. No network and no thread; the file is read on every call (the
Desktop writes it without reloading the plugin).
"""

from __future__ import annotations

import contextlib
import logging
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

EN = "en"
PT = "pt-BR"
SUPPORTED: tuple[str, ...] = (EN, PT)
DEFAULT = EN
AUTO = "auto"

_FROM_SETTINGS: Any = object()

NAMES: dict[str, str] = {EN: "English", PT: "Brazilian Portuguese"}
"""Language name in English (for instructions to the model)."""


def normalize(value: Any) -> str | None:
    """``en``/``pt-BR`` from any code (``en-US``, ``pt_br``, ``pt``…);
    ``None`` for ``auto``, empty, or a language the plugin does not have."""
    if not isinstance(value, str):
        return None
    v = value.strip().lower().replace("_", "-")
    if not v or v == AUTO:
        return None
    if v == "en" or v.startswith("en-"):
        return EN
    if v == "pt" or v.startswith("pt-"):
        return PT
    return None


def short(lang: Any) -> str:
    """``"en"`` or ``"pt"`` (key of the text tables); anything else → ``"en"``."""
    return "pt" if normalize(lang) == PT else "en"


def pick(lang: Any, pt: str, en: str) -> str:
    """The text in language *lang* (``pt``/``en`` side by side in the code)."""
    return pt if normalize(lang) == PT else en


_BUILTIN_TABS: dict[str, tuple[str, str]] = {
    "all-new": ("Tudo novo", "All new"),
    "favorites": ("Favoritos", "Favorites"),
}
"""Built-in tabs: the database stores a fixed name; whoever displays it translates (the Desktop
does the same)."""


def tab_name(tab_id: Any, name: Any, lang: Any) -> str:
    """Tab name for display: built-in tabs (``all-new``, ``favorites``) in language *lang*;
    the others as the user (or the demo) saved them."""
    names = _BUILTIN_TABS.get(str(tab_id))
    if names is None:
        return str(name or "")
    return pick(lang, *names)


def explicit(settings: Any) -> str | None:
    """Explicit value of the ``language`` setting (``None`` for ``auto``/unreadable)."""
    if settings is None:
        return None
    try:
        return normalize(settings.get("language", AUTO))
    except Exception:  # noqa: BLE001 — unreadable setting = auto
        return None


@contextlib.contextmanager
def _home_scope(home: Path) -> Iterator[None]:
    try:
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    except ImportError:
        yield
        return
    token = set_hermes_home_override(str(home))
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def _display_language_yaml(home: Path) -> Any:
    path = home / "config.yaml"
    if not path.is_file():
        return None
    from tube_pkg._yaml import safe_load  # the Hermes runtime has no PyYAML

    data = safe_load(path.read_text(encoding="utf-8")) or {}
    display = data.get("display") if isinstance(data, dict) else None
    return display.get("language") if isinstance(display, dict) else None


def _display_language(home: Path) -> Any:
    try:
        from hermes_cli.config import load_config_readonly
    except ImportError:
        return _display_language_yaml(home)
    with _home_scope(home):
        config = load_config_readonly() or {}
    display = config.get("display") if isinstance(config, dict) else None
    return display.get("language") if isinstance(display, dict) else None


def hermes_language(home: str | os.PathLike[str] | None) -> str | None:
    """Hermes language of profile *home* (``display.language``), if the plugin supports it."""
    if home is None:
        return None
    try:
        return normalize(_display_language(Path(home)))
    except Exception:  # noqa: BLE001 — unreadable config breaks nothing: fall through the rule
        logger.debug("lang: could not read display.language from %s", home, exc_info=True)
        return None


def _home_of(settings: Any) -> Any:
    home = getattr(settings, "home", None) if settings is not None else None
    return home if isinstance(home, (str, os.PathLike)) else None


def resolve(settings: Any = None, hint: Any = None, *, home: Any = _FROM_SETTINGS) -> str:
    """Language of this response (see the module docstring). *hint* = what the surface reported
    (language code; ``None``/``auto`` = nothing). *home* omitted → ``settings.home``."""
    chosen = explicit(settings)
    if chosen:
        return chosen
    chosen = normalize(hint)
    if chosen:
        return chosen
    chosen = hermes_language(_home_of(settings) if home is _FROM_SETTINGS else home)
    return chosen or DEFAULT


__all__ = [
    "AUTO",
    "DEFAULT",
    "EN",
    "NAMES",
    "PT",
    "SUPPORTED",
    "explicit",
    "hermes_language",
    "normalize",
    "pick",
    "resolve",
    "short",
    "tab_name",
]
