"""Wall-clock budgets for the "answers without waiting" tests.

The budgets prove that a call does not block on a refresh cycle or on a held database.
On an idle machine the budget is the strict one (50 ms). When the machine is oversubscribed
(many test runs at once) the scheduler alone can add more than that to a single call, so the
budget grows with the load average, up to a cap that still sits far below what a blocking
implementation would take.

Inside a container the load average is the one of the container's VM, not the host's, so a
busy host can look idle: there the budget starts at ``CONTAINER_FACTOR`` times the strict one.
``TUBE_TIMING_FACTOR`` (a number from 1 up) asks for more room by hand; the cap still holds.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

STRICT_S = 0.05
MAX_FACTOR = 8.0
CONTAINER_FACTOR = 2.0
FACTOR_ENV = "TUBE_TIMING_FACTOR"


def _in_container() -> bool:
    if Path("/.dockerenv").exists() or Path("/run/.containerenv").exists():
        return True
    try:
        cgroup = Path("/proc/1/cgroup").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return any(word in cgroup for word in ("docker", "containerd", "kubepods", "libpod"))


def _env_factor() -> float:
    try:
        value = float(os.environ.get(FACTOR_ENV, "") or 1.0)
    except ValueError:
        return 1.0
    return value if math.isfinite(value) and value >= 1.0 else 1.0


def fast_budget(base: float = STRICT_S) -> float:
    """Seconds a non-blocking call may take right now."""
    try:
        load = os.getloadavg()[0] / (os.cpu_count() or 1)
    except (AttributeError, OSError):
        load = 1.0
    floor = max(_env_factor(), CONTAINER_FACTOR if _in_container() else 1.0)
    return base * min(MAX_FACTOR, max(floor, load))
