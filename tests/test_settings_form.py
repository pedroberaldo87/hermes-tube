"""Settings that do nothing leave the form; ``/extras`` tells the truth.

- ``config_schema`` (the Desktop form) = ``SETTINGS_DEFAULTS`` minus the keys with no effect in this
  version (``home_on_youtube`` and ``extras_*``); the defaults stay in the code for later use.
- ``theme_refresh_days`` **stays**: ``ThemeService`` reads the value (``_cadence`` →
  ``cadence_days`` of the new theme, shown in the preview) — proven below; the description says
  there is no automatic refresh in this version (the Desktop ``theme.refresh`` always searches
  again).
- ``GET/POST /extras``: lens off, zero videos, nothing ready; both HN Extras answer
  ``conflict`` (Extra turned off) instead of the contract example.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import pytest
import yaml
from fakes import FakeSettings

from tube_pkg.core import types as T

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = yaml.safe_load((ROOT / "plugin" / "plugin.yaml").read_text(encoding="utf-8"))
HIDDEN = {
    "home_on_youtube",
    "extras_honest_thumbnails",
    "extras_hn_lens",
    "extras_hn_channels",
    "extras_import_lists",
}


def test_form_hides_settings_that_do_nothing() -> None:
    schema = MANIFEST["config_schema"]
    assert set(schema) == set(T.SETTINGS_DEFAULTS) - HIDDEN
    assert {"rss_interval_min", "language", "ex_retention_days", "theme_refresh_days"} <= set(
        schema
    )
    for key in HIDDEN:  # defaults stay in the code (to be turned back on later)
        assert key in T.SETTINGS_DEFAULTS


def test_hidden_settings_keep_their_defaults() -> None:
    from tube_pkg.adapters.settings import build

    settings = build(home=None)
    assert settings.get("home_on_youtube") is True
    assert settings.get("extras_hn_lens") is False


def test_theme_refresh_days_is_read_by_the_theme_service() -> None:
    themes = importlib.import_module("tube_pkg.core.themes")
    svc = themes.ThemeService.__new__(themes.ThemeService)
    svc.settings = FakeSettings(theme_refresh_days=3)
    assert svc._cadence() == 3  # stored in themes.cadence_days on creation
    svc.settings = FakeSettings(theme_refresh_days=11)
    assert svc._cadence() == 11


def test_theme_refresh_description_is_honest() -> None:
    spec = MANIFEST["config_schema"]["theme_refresh_days"]
    text = (spec["label"] + " " + spec["description"]).lower()
    assert "does not refresh" in text and "by hand" in text  # no scheduler in this version


# =========================================================================== /extras


@pytest.fixture
def extras() -> Any:
    return importlib.import_module("tube_pkg.api.extras")


TRUTH = {
    "honest_thumbnails": False,
    "hn_lens": False,
    "hn_channels": False,
    "import_lists": False,
    "hn_dataset_ready": False,
    "hn_video_count": 0,
}


def test_get_extras_tells_the_truth(extras: Any) -> None:
    common = importlib.import_module("tube_pkg.api._common")
    env = extras.get_extras(None, {})
    assert env["ok"] is True
    assert {k: env["data"][k] for k in TRUTH} == TRUTH
    assert common.is_real(extras.get_extras)


def test_post_extras_turns_nothing_on(extras: Any) -> None:
    env = extras.post_extras({"hn_lens": True}, {})
    assert env["ok"] is True
    assert {k: env["data"][k] for k in TRUTH} == TRUTH
    bad = extras.post_extras({"hn_lens": "yes"}, {})
    assert bad["ok"] is False and bad["error"]["code"] == "invalid"
    assert extras.post_extras({}, {})["error"]["code"] == "invalid"
    assert extras.post_extras({"zzz": True}, {})["error"]["code"] == "invalid"


def test_hn_extras_are_off(extras: Any) -> None:
    assert extras.post_extras_hn_download({}, {})["error"]["code"] == "conflict"
    assert extras.get_extras_hn_channels(None, {})["error"]["code"] == "conflict"
