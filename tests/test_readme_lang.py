"""The READMEs describe the language support and the settings as they are now."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_README = (ROOT / "plugin" / "README.md").read_text(encoding="utf-8")
ROOT_README = (ROOT / "README.md").read_text(encoding="utf-8")
SKILL = ROOT / "plugin" / "skills"
CATALOG = ROOT / "docs" / "catalog"


def _section(text: str, title: str) -> str:
    match = re.search(rf"^## {re.escape(title)}\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    assert match, title
    return match.group(1)


def test_limitations_no_longer_list_fixed_language_gaps() -> None:
    limits = _section(PLUGIN_README, "Known limitations")
    for gone in (
        "answer in Portuguese",
        "in Portuguese for now",
        "show up in the plugin settings but do nothing",
    ):
        assert gone not in limits, gone


def test_language_rule_is_documented() -> None:
    text = PLUGIN_README
    assert "display.language" in text and "plugin/core/lang.py" in text
    lang = re.search(r"^- Language:.*$", text, re.M)
    assert lang, "line about the language"
    line = lang.group(0)
    assert "English" in line and "Brazilian Portuguese" in line and "auto" in line
    assert "English and Brazilian Portuguese" in ROOT_README


def test_settings_form_is_described_honestly() -> None:
    limits = _section(PLUGIN_README, "Known limitations")
    assert "Topic tabs refresh" in limits
    assert "Extras" not in limits or "not in the settings" in limits


def test_the_english_skill_is_not_listed_as_portuguese() -> None:
    skills = list(SKILL.rglob("SKILL.md"))
    assert skills
    accents = re.compile("[ãõçáéíóúâêô]")
    if any(accents.search(p.read_text(encoding="utf-8")) for p in skills):
        return  # a skill went back to Portuguese: the docs may say so
    limits = _section(PLUGIN_README, "Known limitations")
    assert not re.search(r"skill[^.]*Portuguese", limits)
    for entry in CATALOG.glob("*.yaml"):  # the catalog draft is not part of the public cut
        issues = yaml.safe_load(entry.read_text(encoding="utf-8")).get("known_issues") or []
        assert not any(re.search(r"skill[^.]*Portuguese", str(i)) for i in issues), issues
