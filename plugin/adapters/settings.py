"""Plugin ``Settings``: the flat keys of ``SETTINGS_DEFAULTS`` (``config_schema`` in
``plugin.yaml``), read from ``plugins.entries.<PLUGIN_ID>.settings`` in the profile's
``config.yaml``.

Works in the three places where the plugin runs:

- **gateway** (``register(ctx)``, tools, RPC, ``/tube``) and **plugin host** (``plugin_api``):
  the profile comes from ``hermes_constants.get_hermes_home()`` **resolved in** ``build()``
  (inside the gateway ``os.environ["HERMES_HOME"]`` is the launch profile, and a new thread does
  not inherit the contextvar) — that is why the object keeps the profile path and always reads
  from it;
- **routine scripts** (sanitized environment, maybe without an importable Hermes): pass
  ``home=<profile>`` (``routines/_header.resolve``); without ``hermes_cli`` the ``config.yaml`` is
  read with ``yaml`` directly.

Read on every use (the Desktop form writes without reloading the plugin). Invalid value in the
file → default (with a log); ``set`` validates and writes through the Hermes writer
(``hermes_cli.config.save_config``, merging, inside the stored profile) or, without a profile,
through ``ctx.set_config``.

Without a profile (tests, ``TUBE_DB_PATH`` set, outside Hermes): only defaults + values stored in
memory by ``set``. No network and no threads.
"""

from __future__ import annotations

import contextlib
import dataclasses
import logging
import os
import threading
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core.types import (
    SETTINGS_DEFAULTS,
    Clock,
    Settings,
    SettingsSnapshot,
    ValidationError,
)

logger = logging.getLogger(__name__)

ENV_DB_PATH = "TUBE_DB_PATH"
"""Test/development mode (same rule as ``adapters/storage.py``): no Hermes profile."""

CHOICES: dict[str, tuple[str, ...]] = {"language": ("auto", "en", "pt-BR")}
"""Accepted values per text key with choices (same as ``config_schema``)."""

MIN_INT: dict[str, int] = {"rss_interval_min": 5, "ex_retention_days": 1, "theme_refresh_days": 1}
"""Minimum accepted per integer key (below it the value is invalid → default)."""

_RESOLVE: Any = object()


class _Invalid(Exception):
    pass


def _coerce(key: str, value: Any) -> Any:
    """Convert *value* to the type of *key*'s default; ``_Invalid`` if it cannot."""
    default = SETTINGS_DEFAULTS[key]
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in ("true", "1", "yes", "on"):
            return True
        if isinstance(value, str) and value.strip().lower() in ("false", "0", "no", "off"):
            return False
        if isinstance(value, int) and value in (0, 1):
            return bool(value)
        raise _Invalid
    if isinstance(default, int):
        if isinstance(value, bool):
            raise _Invalid
        if isinstance(value, int):
            out = value
        elif isinstance(value, float) and value.is_integer():
            out = int(value)  # the Desktop form stores numbers as float
        elif isinstance(value, str) and value.strip().lstrip("-").isdigit():
            out = int(value.strip())
        else:
            raise _Invalid
        if out < MIN_INT.get(key, 0):
            raise _Invalid
        return out
    if not isinstance(value, str) or not value.strip():
        raise _Invalid
    value = value.strip()
    choices = CHOICES.get(key)
    if choices is not None and value not in choices:
        raise _Invalid
    return value


@contextlib.contextmanager
def _home_scope(home: Path) -> Iterator[None]:
    """Pin the Hermes profile (contextvar) during the read/write."""
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


def _settings_entry(config: Any) -> Mapping[str, Any]:
    node: Any = config
    for part in ("plugins", "entries", PLUGIN_ID, "settings"):
        if not isinstance(node, Mapping):
            return {}
        node = node.get(part)
    return node if isinstance(node, Mapping) else {}


def _save_setting(config_mod: Any, key: str, value: Any) -> None:
    """Write ``plugins.entries.<PLUGIN_ID>.settings.<key>`` through the public ``hermes_cli.config``
    API (same path as Hermes' internal ``save_plugin_setting``): reads the raw file first (fails
    closed on invalid YAML) and writes merging with what exists."""
    if config_mod.is_managed():
        raise PermissionError("managed configuration: plugin settings cannot be written")
    full_path = ("plugins", "entries", PLUGIN_ID, "settings", key)
    config_mod.read_user_config_raw()
    partial: dict[str, Any] = {key: value}
    for part in reversed(full_path[:-1]):
        partial = {part: partial}
    config_mod.save_config(partial, preserve_keys={full_path}, merge_existing=True)


class PluginSettings:
    """``Settings`` implementation (see the module docstring)."""

    def __init__(self, *, home: Path | None, ctx: Any = None) -> None:
        self._home = home
        self._ctx = ctx
        self._memory: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._yaml_cache: tuple[tuple[int, int], Mapping[str, Any]] | None = None

    @property
    def home(self) -> Path | None:
        """Hermes profile the configuration is read from (``None`` = defaults only)."""
        return self._home

    # ------------------------------------------------------------------ reading

    def _raw(self) -> Mapping[str, Any]:
        if self._home is None:
            return {}
        try:
            from hermes_cli.config import load_config_readonly
        except ImportError:
            return self._raw_yaml()
        try:
            with _home_scope(self._home):
                return dict(_settings_entry(load_config_readonly() or {}))
        except Exception:  # noqa: BLE001 — an unreadable config does not bring the plugin down
            logger.warning("%s: unreadable config.yaml; using defaults", PLUGIN_ID, exc_info=True)
            return {}

    def _raw_yaml(self) -> Mapping[str, Any]:
        assert self._home is not None
        path = self._home / "config.yaml"
        try:
            st = path.stat()
        except OSError:
            return {}
        sig = (st.st_mtime_ns, st.st_size)
        cached = self._yaml_cache
        if cached is not None and cached[0] == sig:
            return cached[1]
        try:
            from tube_pkg._yaml import safe_load  # the Hermes runtime has no PyYAML

            data = safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:  # noqa: BLE001
            logger.warning("%s: could not read %s; using defaults", PLUGIN_ID, path, exc_info=True)
            return {}
        entry = dict(_settings_entry(data))
        self._yaml_cache = (sig, entry)
        return entry

    def _values(self) -> dict[str, Any]:
        raw = self._raw()
        out = dict(SETTINGS_DEFAULTS)
        for key in SETTINGS_DEFAULTS:
            if key in self._memory:
                out[key] = self._memory[key]
                continue
            if key not in raw or raw[key] is None:
                continue
            try:
                out[key] = _coerce(key, raw[key])
            except _Invalid:
                logger.warning("%s: invalid value %s=%r; using default", PLUGIN_ID, key, raw[key])
        return out

    def get(self, key: str, default: Any = None) -> Any:
        if key not in SETTINGS_DEFAULTS:
            return default
        return self._values()[key]

    def snapshot(self) -> SettingsSnapshot:
        return SettingsSnapshot(**self._values())

    # ------------------------------------------------------------------ writing

    def set(self, key: str, value: Any) -> None:
        if key not in SETTINGS_DEFAULTS:
            raise ValidationError(f"unknown setting key: {key}", field=key)
        try:
            value = _coerce(key, value)
        except _Invalid:
            raise ValidationError(f"invalid value for {key}", field=key) from None
        with self._lock:
            if self._write(key, value):
                self._memory.pop(key, None)
            else:
                self._memory[key] = value

    def _write(self, key: str, value: Any) -> bool:
        """Write to the profile; ``False`` = could not write the file from here (kept in memory)."""
        if self._home is not None:
            try:
                from hermes_cli import config as config_mod
            except ImportError:
                config_mod = None
            if config_mod is not None:
                with _home_scope(self._home):
                    _save_setting(config_mod, key, value)
                self._yaml_cache = None
                return True
        if self._ctx is not None and hasattr(self._ctx, "set_config"):
            self._ctx.set_config(key, value)
        return False


def resolve_home() -> Path | None:
    """The active Hermes profile **now** (contextvar → env), or ``None`` in test mode/outside
    Hermes. ``TUBE_DB_PATH`` set = test mode: never touches a real profile."""
    if os.environ.get(ENV_DB_PATH, "").strip():
        return None
    try:
        from hermes_constants import get_hermes_home
    except ImportError:
        env = os.environ.get("HERMES_HOME", "").strip()
        return Path(env) if env else None
    try:
        return Path(get_hermes_home())
    except Exception:  # noqa: BLE001
        return None


def build(
    *,
    ctx: Any = None,
    clock: Clock | None = None,
    home: str | os.PathLike[str] | None = _RESOLVE,
) -> Settings:
    """The profile's ``Settings``. *home* missing → ``resolve_home()`` now (call it in the
    request/handler context, before starting a thread); ``home=None`` → defaults only (and
    ``ctx``)."""
    del clock
    if home is _RESOLVE:
        resolved = resolve_home()
    else:
        resolved = Path(home) if home is not None else None
    return PluginSettings(home=resolved, ctx=ctx)


def snapshot_dict(settings: Settings) -> dict[str, Any]:
    """``SettingsSnapshot`` as a ``dict`` (useful for routes and diagnostics)."""
    return dataclasses.asdict(settings.snapshot())


__all__ = ["CHOICES", "MIN_INT", "PluginSettings", "build", "resolve_home", "snapshot_dict"]
