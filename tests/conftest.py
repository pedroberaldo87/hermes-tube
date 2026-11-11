"""Test harness.

- ``_bootstrap.ensure()`` runs when this file loads (before any test): ``tube_pkg`` is the
  synthetic package for ``plugin/``; ``tests/`` goes onto ``sys.path`` for ``from fakes import …``.
- ``db``: ``tube_pkg.core.db.build(path=tmp_path/"tube.db")`` when the real database module exists
  and works; otherwise ``MemDb``. ``TUBE_TEST_DB=mem`` forces ``MemDb``; ``TUBE_TEST_DB=real``
  requires the real one.
- ``clock``, ``world`` (every fake on top of ``db``), ``seed_world`` (seeded world),
  ``fake_ctx``, ``fake_llm``, ``fake_youtube``, ``fixtures_dir``.
- ``wire``: replaces ``tube_pkg.wiring.get_<name>`` through ``monkeypatch`` (late import; without
  the module it creates a synthetic ``tube_pkg.wiring`` for the duration of the test).
- ``live`` marker: test that uses the real network; skipped unless ``-m live`` or ``TUBE_LIVE=1``.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
import types
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
FIXTURES_DIR = TESTS_DIR / "fixtures"


def _load_bootstrap() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(
        "_tube_bootstrap_conftest", ROOT / "plugin" / "_bootstrap.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# tests run with the code frozen: no ``tube_pkg`` generation swap midway; the reload tests use a
# separate process, without this variable (tests/test_reload.py)
os.environ.setdefault("TUBE_NO_RELOAD", "1")
_bootstrap = _load_bootstrap()
_bootstrap.ensure()
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from fakes import (  # noqa: E402
    FakeClock,
    FakeCtx,
    FakeLLM,
    FakeWorld,
    FakeYouTube,
    MemDb,
    build_fake_world,
)
from fakes import seed_world as _seed_world  # noqa: E402

# --------------------------------------------------------------------------- session and markers


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "live: uses the real network (left out of scripts/check)")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    wants_live = "live" in (config.getoption("-m") or "") or os.environ.get("TUBE_LIVE") == "1"
    if wants_live:
        return
    skip = pytest.mark.skip(reason="live test: run with -m live or TUBE_LIVE=1")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


# ---------------------------------------------------------------- cut without third-party pages

# ``scripts/export-public --no-third-party-pages`` leaves out the real third-party pages
# (YouTube, Hacker News) and lists them in ``THIRD_PARTY_OMITTED.txt``. With that list, a test that
# fails after trying to read one of them is skipped with a reason (also when the read happens inside
# a fake transport that turns the error into a report: open attempts are recorded by an audit hook,
# installed only in this mode). Without the list (full repository), nothing changes.
THIRD_PARTY_OMITTED = FIXTURES_DIR / "THIRD_PARTY_OMITTED.txt"


def _omitted_fixtures() -> frozenset[str]:
    if not THIRD_PARTY_OMITTED.is_file():
        return frozenset()
    lines = THIRD_PARTY_OMITTED.read_text(encoding="utf-8").splitlines()
    return frozenset(x.strip() for x in lines if x.startswith("tests/fixtures/"))


_OMITTED = _omitted_fixtures()
_ROOT_PREFIX = str(ROOT.resolve()) + os.sep
_ATTEMPTED: set[str] = set()


def _omitted_rel(path: object) -> str | None:
    if not isinstance(path, str | bytes | os.PathLike):
        return None
    try:
        full = os.path.abspath(os.fsdecode(path))
    except (TypeError, ValueError):
        return None
    if not full.startswith(_ROOT_PREFIX):
        return None
    rel = full[len(_ROOT_PREFIX) :].replace(os.sep, "/")
    return rel if rel in _OMITTED else None


def _audit(event: str, args: tuple[Any, ...]) -> None:
    if event == "open" and args:
        rel = _omitted_rel(args[0])
        if rel:
            _ATTEMPTED.add(rel)


if _OMITTED:
    sys.addaudithook(_audit)


def omitted_fixture_reason(exc: BaseException, attempted: set[str] | None = None) -> str | None:
    """Skip reason when the failure comes from a third-party page left out of the cut."""
    if not _OMITTED or not isinstance(exc, Exception):
        return None
    missing = set(attempted or ())
    if isinstance(exc, FileNotFoundError) and exc.filename:
        rel = _omitted_rel(exc.filename)
        if rel:
            missing.add(rel)
    if not missing:
        return None
    return "third-party page left out of this cut (--no-third-party-pages): " + ", ".join(
        sorted(missing)
    )


@pytest.hookimpl(wrapper=True)
def pytest_runtest_setup(item: pytest.Item):
    _ATTEMPTED.clear()
    try:
        return (yield)
    except Exception as exc:
        reason = omitted_fixture_reason(exc, _ATTEMPTED)
        if reason:
            pytest.skip(reason)
        raise


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item: pytest.Item):
    try:
        return (yield)
    except Exception as exc:
        reason = omitted_fixture_reason(exc, _ATTEMPTED)
        if reason:
            pytest.skip(reason)
        raise


@pytest.fixture(scope="session", autouse=True)
def tube_pkg() -> types.ModuleType:
    """The synthetic ``tube_pkg`` package (ensured at session start)."""
    return _bootstrap.ensure()


# --------------------------------------------------------------------------- database


def real_db_factory() -> Callable[..., Any] | None:
    """``core.db.build`` (or ``connect``) when the real module exists; ``None`` = use ``MemDb``."""
    mode = os.environ.get("TUBE_TEST_DB", "auto")
    if mode == "mem":
        return None
    try:
        module = importlib.import_module("tube_pkg.core.db")
    except ModuleNotFoundError as exc:
        if mode == "real" or not (exc.name or "").startswith("tube_pkg.core.db"):
            raise
        return None
    factory = getattr(module, "build", None) or getattr(module, "connect", None)
    if factory is None and mode == "real":
        raise RuntimeError("tube_pkg.core.db has no build/connect")
    return factory


def make_test_db(tmp_path: Path) -> Any:
    """A new ``Db`` for the test (real in ``tmp_path`` or ``MemDb``)."""
    factory = real_db_factory()
    if factory is not None:
        try:
            return factory(path=str(tmp_path / "tube.db"))
        except NotImplementedError:
            if os.environ.get("TUBE_TEST_DB") == "real":
                raise
    return MemDb()


@pytest.fixture
def db(tmp_path: Path) -> Iterator[Any]:
    """``Db`` with the schema applied (the real one when available; otherwise ``MemDb``)."""
    instance = make_test_db(tmp_path)
    try:
        yield instance
    finally:
        instance.close()


# --------------------------------------------------------------------------- fakes


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def world(db: Any, clock: FakeClock) -> FakeWorld:
    """Every fake wired on top of ``db`` (in ``BUILDS`` order)."""
    return build_fake_world(db, clock=clock)


@pytest.fixture
def seed_world(world: FakeWorld):
    """``world`` populated by ``fakes.seed_world`` (returns the ``SeedWorld`` with the ids)."""
    return _seed_world(world)


@pytest.fixture
def fake_ctx(monkeypatch: pytest.MonkeyPatch) -> FakeCtx:
    """``FakeCtx`` with ``broadcast_plugin_event`` captured in ``fake_ctx.broadcasts``."""
    ctx = FakeCtx()
    ctx.patch_broadcast(monkeypatch)
    return ctx


@pytest.fixture
def fake_llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def fake_youtube() -> FakeYouTube:
    return FakeYouTube()


@pytest.fixture
def fixtures_dir() -> Path:
    """``tests/fixtures`` (read-only; may not exist yet)."""
    return FIXTURES_DIR


# --------------------------------------------------------------------------- wiring


class Rewire:
    """Replaces ``tube_pkg.wiring.get_<name>`` providers for the duration of the test."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._mp = monkeypatch
        self._module: types.ModuleType | None = None
        self.synthetic = False

    @property
    def module(self) -> types.ModuleType:
        if self._module is None:
            try:
                self._module = importlib.import_module("tube_pkg.wiring")
            except ModuleNotFoundError as exc:
                if exc.name != "tube_pkg.wiring":
                    raise
                module = types.ModuleType("tube_pkg.wiring")
                module.__doc__ = "synthetic wiring from conftest (no real module yet)"
                self._mp.setitem(sys.modules, "tube_pkg.wiring", module)
                self._mp.setattr(sys.modules["tube_pkg"], "wiring", module, raising=False)
                self._module = module
                self.synthetic = True
        return self._module

    def set(self, name: str, value: Any) -> None:
        """``wiring.get_<name>()`` now returns *value*."""
        self._mp.setattr(self.module, f"get_{name}", lambda *a, **k: value, raising=False)

    def set_many(self, **providers: Any) -> None:
        for name, value in providers.items():
            self.set(name, value)

    def use_world(self, world: FakeWorld) -> None:
        """Every ``get_<name>`` of the world (``BuildSpec.provides`` + ``lenses``, ``clock``,
        ``ctx``, ``ext_endpoint_up``)."""
        self.set_many(**world.providers())


@pytest.fixture
def wire(monkeypatch: pytest.MonkeyPatch) -> Rewire:
    return Rewire(monkeypatch)
