"""Public docs: README layout in both languages, cited paths, Hermes floor, images, notices.

Runs the checks of ``docs/catalog/check_docs.py``. That script is not part of the public cut, so in
the published repository these tests are skipped.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "docs" / "catalog" / "check_docs.py"

pytestmark = pytest.mark.skipif(not CHECKER.is_file(), reason="docs checker not in this checkout")


def _checker():
    spec = importlib.util.spec_from_file_location("_check_docs", CHECKER)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def cd():
    return _checker()


def _run(fn, *args, **kwargs) -> list[str]:
    problems: list[str] = []
    fn(ROOT, problems, *args, **kwargs)
    return problems


def test_both_root_readmes_follow_the_shared_layout(cd) -> None:
    assert _run(cd.check_root_layout) == []


def test_plugin_readme_keeps_its_catalog_sections(cd) -> None:
    assert _run(cd.check_plugin_readme) == []


def test_public_text_has_no_internal_names_or_machine_paths(cd) -> None:
    assert _run(cd.check_public_text) == []


def test_every_cited_path_and_link_is_in_the_public_cut(cd) -> None:
    assert _run(cd.check_links) == []


def test_images_live_in_screenshots_or_assets(cd) -> None:
    problems = _run(cd.check_links)
    assert [p for p in problems if "image" in p] == []


def test_minimum_hermes_version_matches_the_manifest(cd) -> None:
    assert _run(cd.check_versions) == []


def test_third_party_notices_and_export_list(cd) -> None:
    assert _run(cd.check_notices) == []


def test_pending_author_blocks_are_the_drafts_word_for_word(cd) -> None:
    assert _run(cd.check_pending) == []


def test_public_text_uses_the_current_interface_words(cd) -> None:
    assert _run(cd.check_wording) == []


def test_security_disclosure_is_in_both_documents(cd) -> None:
    assert _run(cd.check_disclosure) == []


def test_pending_code_blocks_are_well_formed(cd) -> None:
    assert _run(cd.check_pending_code) == []


def test_catalog_entry_points_at_the_cover_and_the_screenshots(cd) -> None:
    assert _run(cd.check_catalog_media) == []


# --- the checker itself catches what it should --------------------------------------------


def _mini_repo(tmp: Path, readme: str, pt: str | None = None) -> Path:
    (tmp / "plugin").mkdir(parents=True)
    (tmp / "plugin" / "plugin.yaml").write_text('requires_hermes: ">=0.23.1"\n', encoding="utf-8")
    (tmp / "README.md").write_text(readme, encoding="utf-8")
    (tmp / "README.pt-BR.md").write_text(pt if pt is not None else readme, encoding="utf-8")
    return tmp


def test_checker_flags_a_wrong_hermes_floor(cd, tmp_path: Path) -> None:
    root = _mini_repo(tmp_path, "# X\n\nNeeds Hermes Agent 0.23.0 or newer.\n")
    problems: list[str] = []
    cd.check_versions(root, problems)
    assert any("0.23.0 differs" in p for p in problems)


def test_checker_flags_images_outside_the_allowed_folders(cd, tmp_path: Path) -> None:
    root = _mini_repo(
        tmp_path, "# X\n\n![a](docs/design/shots/a.png)\n![b](https://example.com/b.png)\n"
    )
    (root / "docs" / "design" / "shots").mkdir(parents=True)
    (root / "docs" / "design" / "shots" / "a.png").write_bytes(b"png")
    problems: list[str] = []
    cd.check_links(root, problems)
    assert any("image outside" in p for p in problems)
    assert any("remote image" in p for p in problems)


def test_checker_flags_sections_out_of_order(cd, tmp_path: Path) -> None:
    body = (
        "# X\n\nWhat it is.\n\n**English** · [Português](README.pt-BR.md)\n\n"
        "![l](https://img.shields.io/badge/a-b-c)\n\n![s](assets/a.jpg)\n\n"
        "## Installation\n\n## Features\n"
    )
    root = _mini_repo(tmp_path, body)
    problems: list[str] = []
    cd.check_root_layout(root, problems)
    assert any("out of order: ## Installation" in p or "out of order" in p for p in problems)
    assert any("section missing: ## Usage" in p for p in problems)


def test_missing_screenshot_is_a_note_in_draft_and_a_problem_in_final(cd, tmp_path: Path) -> None:
    root = _mini_repo(tmp_path, "# X\n\n![s](docs/screenshots/home.png)\n")
    problems: list[str] = []
    pending = cd.check_links(root, problems)
    assert problems == [] and pending == ["docs/screenshots/home.png"]
    cd.check_links(root, problems, final=True)
    assert any("not captured yet" in p for p in problems)


def test_checker_flags_stale_interface_words_outside_author_blocks(cd, tmp_path: Path) -> None:
    readme = (
        "# X\n\n"
        "<!-- PENDING AUTHOR APPROVAL: description -->\n"
        "A Home with theme tabs.\n"
        "<!-- /PENDING -->\n\n"
        "Press the Approve button. Videos open in a Watching tab. Make a theme tab.\n"
        "Open the Home. Manage and Cleanup are pages of the plugin. Each call is started by you.\n"
        "Fine: `tube_theme_create`, ![t](docs/screenshots/theme-tab-preview.png), $HOME, "
        "the Home on youtube.com.\n"
    )
    root = _mini_repo(tmp_path, readme)
    problems: list[str] = []
    cd.check_wording(root, problems)
    en = [p for p in problems if p.startswith("README.md:")]
    assert all(":4:" not in p for p in en), en  # inside the author block: not flagged
    for why in ("Approve", "Watch section", "topic tab", "Subscriptions", "sections", "nobody"):
        assert any(why in p for p in en), (why, en)
    assert all(":9:" not in p for p in en), en  # code, image file names, $HOME, youtube.com


def test_pending_code_is_allowed_in_draft_and_refused_in_final(cd, tmp_path: Path) -> None:
    root = _mini_repo(tmp_path, "# X\n")
    (root / "SECURITY.md").write_text(
        "# S\n\n<!-- PENDING CODE: run-now (replaces the sentence above once it ships) -->\n"
        "- After the fix.\n<!-- /PENDING CODE -->\n",
        encoding="utf-8",
    )
    problems: list[str] = []
    cd.check_pending_code(root, problems)
    assert problems == []
    cd.check_pending_code(root, problems, final=True)
    assert any("PENDING CODE" in p and "SECURITY.md" in p for p in problems)


def test_checker_flags_an_unclosed_or_unexplained_pending_code_block(cd, tmp_path: Path) -> None:
    root = _mini_repo(tmp_path, "# X\n\n<!-- PENDING CODE: -->\nText.\n<!-- /PENDING CODE -->\n")
    (root / "SECURITY.md").write_text("<!-- PENDING CODE: x (why) -->\nText.\n", encoding="utf-8")
    problems: list[str] = []
    cd.check_pending_code(root, problems)
    assert any("README.md" in p and "reason" in p for p in problems), problems
    assert any("SECURITY.md" in p and "not closed" in p for p in problems), problems


def test_checker_wants_the_same_install_commands_in_both_readmes(cd, tmp_path: Path) -> None:
    def readme(selector: str, section: str, cmd: str) -> str:
        return (
            f"# X\n\nWhat it is.\n\n{selector}\n\n![l](https://img.shields.io/badge/a-b-c)\n\n"
            f"![c](assets/c.jpg)\n\n{section}\n\n```bash\n{cmd}\n```\n"
        )

    root = _mini_repo(
        tmp_path,
        readme("**English** · [Português](README.pt-BR.md)", "## Installation", "a install"),
        readme("[English](README.md) · **Português**", "## Instalação", "a instalar"),
    )
    problems: list[str] = []
    cd.check_root_layout(root, problems)
    assert any("install commands" in p for p in problems), problems


def test_checker_flags_catalog_media_outside_the_cover_and_screenshots(cd, tmp_path: Path) -> None:
    root = _mini_repo(tmp_path, "# X\n\n![s](docs/screenshots/home.png)\n")
    (root / "plugin" / "README.md").write_text("![s](../docs/screenshots/home.png)\n", "utf-8")
    (root / "docs" / "catalog").mkdir(parents=True)
    base = "https://raw.githubusercontent.com/o/r/TODO(area-67)/"
    (root / "docs" / "catalog" / f"{cd.CATALOG_NAME}.yaml").write_text(
        "sha: TODO(area-67)\n"
        f"image: {base}docs/catalog/banner.png\n"
        "screenshots:\n"
        f"  - {base}docs/design/shots/a.png\n"
        f"  - {base}docs/screenshots/other.png\n"
        + "".join(f"  - {base}docs/screenshots/home.png\n" for _ in range(6)),
        encoding="utf-8",
    )
    problems: list[str] = []
    cd.check_catalog_media(root, problems)
    text = "\n".join(problems)
    assert "image" in text and "assets/" in text
    assert "docs/design/shots/a.png" in text
    assert "other.png" in text
    assert "at most 6" in text
