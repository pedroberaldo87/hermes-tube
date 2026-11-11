"""Input caps and client messages of the plugin RPC methods (``plugin/rpc/**``).

Lists sent by a gateway client are bounded before any service runs; ``edits`` keys must be
channel ids; every message a client receives is in English (error codes do not change).
Services are replaced by recorders: validation happens before them, so no database is needed.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from tube_pkg import wiring
from tube_pkg.rpc import organize as rpc_org
from tube_pkg.rpc import themes as rpc_themes

RPC_DIR = Path(__file__).resolve().parents[1] / "plugin" / "rpc"


def cid(n: int) -> str:
    return f"UCsec5limits{n:012d}"


def vid(n: int) -> str:
    return f"v{n:010d}"


class Recorder:
    """Stands in for a service: records the call and answers something harmless."""

    def __init__(self, answer: Any = None) -> None:
        self.calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
        self.answer = answer

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append((args, kwargs))
        return self.answer


@pytest.fixture
def organizer(monkeypatch: pytest.MonkeyPatch) -> Any:
    org = SimpleNamespace(accept=Recorder({"accepted": []}), reject=Recorder(0))
    monkeypatch.setattr(wiring, "get_organizer", lambda: org)
    return org


@pytest.fixture
def themes(monkeypatch: pytest.MonkeyPatch) -> Any:
    svc = SimpleNamespace(save=Recorder({"tab": None}))
    monkeypatch.setattr(wiring, "get_themes", lambda: svc)
    return svc


def error(env: Any) -> dict[str, Any]:
    assert env["ok"] is False, env
    return env["error"]


# --------------------------------------------------------------------------- organize


@pytest.mark.parametrize("key", ["suggestion_ids", "channel_ids"])
@pytest.mark.parametrize("fn", [rpc_org.organize_accept, rpc_org.organize_reject])
def test_organize_lists_are_capped(organizer: Any, fn: Any, key: str) -> None:
    cap = rpc_org.MAX_ITEMS
    make = cid if key == "channel_ids" else (lambda n: f"sg_{n}")
    err = error(fn({key: [make(n) for n in range(cap + 1)]}))
    assert err["code"] == "invalid" and str(cap) in err["message"]
    assert organizer.accept.calls == [] and organizer.reject.calls == []
    env = fn({key: [make(n) for n in range(cap)]})
    assert env["ok"] is True, env


def test_organize_cap_holds_a_whole_subscription_list() -> None:
    """``Accept all`` sends every pending suggestion: the cap must not be below what one run can
    suggest (a subscription list, up to the 5000 of ``SubscriptionBatchBody``)."""
    assert rpc_org.MAX_ITEMS >= 5000


def test_organize_edits_keys_are_channel_ids(organizer: Any) -> None:
    for bad in ("nope", "UCshort", "../x", "", "UC" + "x" * 30):
        err = error(
            rpc_org.organize_accept({"channel_ids": [cid(1)], "edits": {bad: {"folder": "A"}}})
        )
        assert err["code"] == "invalid", bad
    assert organizer.accept.calls == []
    env = rpc_org.organize_accept({"channel_ids": [cid(1)], "edits": {cid(1): {"folder": "A"}}})
    assert env["ok"] is True
    assert list(organizer.accept.calls[0][1]["edits"]) == [cid(1)]


def test_organize_edits_are_capped(organizer: Any) -> None:
    cap = rpc_org.MAX_ITEMS
    edits = {cid(n): {"folder": "A"} for n in range(cap + 1)}
    err = error(rpc_org.organize_accept({"channel_ids": [cid(1)], "edits": edits}))
    assert err["code"] == "invalid" and organizer.accept.calls == []


# --------------------------------------------------------------------------- theme.save


def test_theme_save_removed_videos_are_capped(themes: Any) -> None:
    cap = rpc_themes.MAX_ITEMS
    assert cap == 500
    removed = [vid(n) for n in range(cap + 1)]
    err = error(
        rpc_themes.theme_save({"theme_id": "th_1", "edits": {"removed_video_ids": removed}})
    )
    assert err["code"] == "invalid" and str(cap) in err["message"]
    assert themes.save.calls == []
    env = rpc_themes.theme_save({"theme_id": "th_1", "edits": {"removed_video_ids": removed[:cap]}})
    assert env["ok"] is True


def test_theme_save_seed_actions_are_capped_and_keyed_by_channel(themes: Any) -> None:
    cap = rpc_themes.MAX_ITEMS
    many = {cid(n): "follow" for n in range(cap + 1)}
    err = error(rpc_themes.theme_save({"theme_id": "th_1", "edits": {"seed_actions": many}}))
    assert err["code"] == "invalid"
    err = error(
        rpc_themes.theme_save({"theme_id": "th_1", "edits": {"seed_actions": {"x": "follow"}}})
    )
    assert err["code"] == "invalid"
    assert themes.save.calls == []
    env = rpc_themes.theme_save({"theme_id": "th_1", "edits": {"seed_actions": {cid(1): "follow"}}})
    assert env["ok"] is True


# --------------------------------------------------------------------------- language

_PT = re.compile(
    r"[ãõçáéíóúâêôà]|\b(esperava|tema|não|já|existe|letras|chaves|objeto|ação|texto|lista|canal)\b",
    re.IGNORECASE,
)


def _client_strings(path: Path) -> list[str]:
    """String literals a client can receive: arguments of ``fail``/``_Invalid``/errors and
    module-level ``*_MESSAGE`` constants (docstrings are not messages)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[str] = []

    def strings(node: ast.AST) -> None:
        for sub in ast.walk(node):
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                out.append(sub.value)

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None) or ""
            if name in ("fail", "_Invalid") or name.endswith("Error") or name == "ApprovalRefused":
                for arg in node.args[1:] if name == "fail" else node.args:
                    strings(arg)
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id.endswith("_MESSAGE") for t in node.targets
        ):
            strings(node.value)
    return out


@pytest.mark.parametrize("path", sorted(RPC_DIR.glob("*.py")), ids=lambda p: p.name)
def test_client_messages_are_english(path: Path) -> None:
    found = [s for s in _client_strings(path) if _PT.search(s)]
    assert found == [], found


def test_theme_messages_reach_the_client_in_english(
    themes: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    for bad in (
        {},
        {"theme_id": "th_1", "edits": "x"},
        {"theme_id": "th_1", "edits": {"nope": 1}},
        {"theme_id": "th_1", "edits": {"create_folder": "yes"}},
        {"theme_id": "th_1", "edits": {"seed_actions": {cid(1): "adore"}}},
        {"theme_id": "th_1", "edits": {"removed_video_ids": "x"}},
        {"theme_id": "th_1", "edits": {"name": 3}},
    ):
        err = error(rpc_themes.theme_save(bad))
        assert err["code"] == "invalid" and not _PT.search(err["message"]), err
    err = error(rpc_themes.theme_create({"query": "x"}))
    assert err["code"] == "invalid" and not _PT.search(err["message"]), err
    assert not _PT.search(rpc_themes.BUSY_MESSAGE)
