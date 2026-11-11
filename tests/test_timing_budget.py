"""``tests/_timing.fast_budget``: the strict budget on an idle machine, more room under load,
inside a container (whose load average is the VM's, not the host's) and when asked for."""

from __future__ import annotations

import _timing
import pytest


@pytest.fixture
def idle(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_timing.os, "getloadavg", lambda: (0.0, 0.0, 0.0))
    monkeypatch.delenv(_timing.FACTOR_ENV, raising=False)
    monkeypatch.setattr(_timing, "_in_container", lambda: False)


def test_idle_machine_gets_the_strict_budget(idle: None) -> None:
    assert _timing.fast_budget() == pytest.approx(_timing.STRICT_S)


def test_load_grows_the_budget_up_to_the_cap(idle: None, monkeypatch: pytest.MonkeyPatch) -> None:
    cpus = _timing.os.cpu_count() or 1
    monkeypatch.setattr(_timing.os, "getloadavg", lambda: (cpus * 3.0, 0.0, 0.0))
    assert _timing.fast_budget() == pytest.approx(_timing.STRICT_S * 3)
    monkeypatch.setattr(_timing.os, "getloadavg", lambda: (cpus * 100.0, 0.0, 0.0))
    assert _timing.fast_budget() == pytest.approx(_timing.STRICT_S * _timing.MAX_FACTOR)


def test_container_gets_a_floor(idle: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_timing, "_in_container", lambda: True)
    assert _timing.fast_budget() == pytest.approx(_timing.STRICT_S * _timing.CONTAINER_FACTOR)


def test_factor_from_the_environment(idle: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(_timing.FACTOR_ENV, "3")
    assert _timing.fast_budget() == pytest.approx(_timing.STRICT_S * 3)
    monkeypatch.setenv(_timing.FACTOR_ENV, "1000")
    assert _timing.fast_budget() == pytest.approx(_timing.STRICT_S * _timing.MAX_FACTOR)
    for bad in ("", "abc", "-2", "0.5", "nan"):
        monkeypatch.setenv(_timing.FACTOR_ENV, bad)
        assert _timing.fast_budget() == pytest.approx(_timing.STRICT_S), bad
