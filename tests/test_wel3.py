"""Last subscription read — ``POST /ext/sync/subscriptions`` records when the extension delivered a
read of the subscription list, and ``GET /status`` exposes it as ``ext_last_sync_at``.

The welcome dialog uses that instant to finish "Reading your subscriptions" when a re-pairing (or a
sync with no new channel) leaves the channel total unchanged.
"""

from __future__ import annotations

import importlib.util
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from tube_pkg import wiring
from tube_pkg.api import _common
from tube_pkg.api import status as api_status
from tube_pkg.core import db as core_db
from tube_pkg.core import types as T
from tube_pkg.ext import sync as ext_sync

ROOT = Path(__file__).resolve().parents[1]
NOW = 1_762_700_000
DEVICE = T.Device(id="dev_1", name="Chrome", created_at=NOW - 100)


def _load_gen_types() -> Any:
    name = "_gen_types_last_sync"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "gen_types.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


GEN = _load_gen_types()
CONTRACT = GEN.load_contract(ROOT)


def check_ok(operation_id: str, env: Any) -> Any:
    assert _common.is_envelope(env), env
    assert env["ok"] is True, env
    op = GEN.get_operation(CONTRACT, operation_id)
    GEN.validate_instance(op.data_schema, env["data"], ROOT, current=op.doc, strict=True)
    return env["data"]


def cid(n: int) -> str:
    return f"UCwel3sync{n:014d}"


class Clock:
    def __init__(self, now: int = NOW) -> None:
        self.t = now

    def now(self) -> int:
        return self.t


class StubSync:
    """Just what the handler touches: ``db``, ``clock`` and ``ingest_subscriptions``."""

    def __init__(self, db: Any, clock: Clock, *, fail: bool = False) -> None:
        self.db = db
        self.clock = clock
        self.fail = fail
        self.calls = 0

    def ingest_subscriptions(self, device_id: str, batch: T.SubscriptionBatch) -> T.SyncReport:
        self.calls += 1
        if self.fail:
            raise T.TubeError("broken ingest")
        return T.SyncReport(signal=T.SyncSignal(batch.signal))

    def ingest_watch(self, device_id: str, events: Any) -> int:
        return len(events)


@pytest.fixture
def rdb(tmp_path: Path) -> Iterator[Any]:
    db = core_db.build(path=str(tmp_path / "last_sync.db"))
    yield db
    db.close()


def body(signal: str = "complete", n: int = 2) -> dict[str, Any]:
    return {
        "signal": signal,
        "channels": [{"title": f"Channel {i}", "channel_id": cid(i)} for i in range(n)],
    }


# --------------------------------------------------------------------------- recording


def test_complete_read_records_the_instant(rdb: Any) -> None:
    clock = Clock()
    sync = StubSync(rdb, clock)
    assert ext_sync.last_subscription_read(rdb) is None
    env = ext_sync.sync_subscriptions(DEVICE, body(), {}, sync=sync)
    assert env["ok"] is True
    assert ext_sync.last_subscription_read(rdb) == NOW
    # a re-pairing that brings exactly the same channels still moves the instant forward
    clock.t = NOW + 42
    assert ext_sync.sync_subscriptions(DEVICE, body(), {}, sync=sync)["ok"] is True
    assert ext_sync.last_subscription_read(rdb) == NOW + 42


def test_complete_but_empty_list_counts(rdb: Any) -> None:
    sync = StubSync(rdb, Clock())
    assert ext_sync.sync_subscriptions(DEVICE, body(n=0), {}, sync=sync)["ok"] is True
    assert ext_sync.last_subscription_read(rdb) == NOW


def test_partial_read_with_channels_counts_but_empty_partial_does_not(rdb: Any) -> None:
    clock = Clock()
    sync = StubSync(rdb, clock)
    ext_sync.sync_subscriptions(DEVICE, body("partial", n=0), {}, sync=sync)
    assert ext_sync.last_subscription_read(rdb) is None, "an empty partial read proves nothing"
    ext_sync.sync_subscriptions(DEVICE, body("partial", n=3), {}, sync=sync)
    assert ext_sync.last_subscription_read(rdb) == NOW


def test_refused_or_failed_batch_records_nothing(rdb: Any) -> None:
    sync = StubSync(rdb, Clock())
    assert ext_sync.sync_subscriptions(None, body(), {}, sync=sync)["ok"] is False
    assert ext_sync.sync_subscriptions(DEVICE, {"signal": "x"}, {}, sync=sync)["ok"] is False
    broken = StubSync(rdb, Clock(), fail=True)
    assert ext_sync.sync_subscriptions(DEVICE, body(), {}, sync=broken)["ok"] is False
    assert ext_sync.last_subscription_read(rdb) is None


def test_recording_failure_never_breaks_the_sync(rdb: Any) -> None:
    class ReadOnly:
        def __getattr__(self, name: str) -> Any:
            raise RuntimeError("database gone")

    sync = StubSync(ReadOnly(), Clock())
    env = ext_sync.sync_subscriptions(DEVICE, body(), {}, sync=sync)
    assert env["ok"] is True and sync.calls == 1


def test_unreadable_meta_value_reads_as_unknown(rdb: Any) -> None:
    rdb.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)", (ext_sync.META_LAST_SUBSCRIPTION_READ, "x")
    )
    assert ext_sync.last_subscription_read(rdb) is None


def test_watch_batches_do_not_count(rdb: Any) -> None:
    sync = StubSync(rdb, Clock())
    events = {"events": [{"video_id": "wel3vid0001", "watched_at": NOW}]}
    assert ext_sync.sync_watch(DEVICE, events, {}, sync=sync)["ok"] is True
    assert ext_sync.last_subscription_read(rdb) is None


# --------------------------------------------------------------------------- GET /status


class StubRefresher:
    def __init__(self, db: Any) -> None:
        self.db = db

    def kick_if_due(self, force: bool = False) -> None:
        return None

    def status(self) -> T.StatusSnapshot:
        return T.StatusSnapshot(
            new_total=0,
            new_by_tab=(),
            fav_new=(),
            ext_endpoint_up=True,
            last_rss_at=None,
            refresh_running=False,
        )

    def last_rss_at(self) -> int | None:
        return None

    def is_running(self) -> bool:
        return False


@pytest.fixture
def status_env(rdb: Any, wire: Any, monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    api_status.reset()
    wire.set("refresher", StubRefresher(rdb))
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: 47615)
    yield rdb
    api_status.reset()


def status() -> dict[str, Any]:
    return check_ok("getStatus", api_status.get_status(None, {}))


def test_status_exposes_null_before_any_read(status_env: Any) -> None:
    data = status()
    assert "ext_last_sync_at" in data and data["ext_last_sync_at"] is None


def test_status_exposes_the_last_read(status_env: Any) -> None:
    sync = StubSync(status_env, Clock(NOW + 7))
    ext_sync.sync_subscriptions(DEVICE, body(), {}, sync=sync)
    assert status()["ext_last_sync_at"] == NOW + 7
    sync.clock.t = NOW + 60
    ext_sync.sync_subscriptions(DEVICE, body(), {}, sync=sync)
    assert status()["ext_last_sync_at"] == NOW + 60


def test_status_without_a_database_omits_the_field(
    wire: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A refresher without ``db`` (fakes, older builds): the field stays absent, not null."""

    class NoDb(StubRefresher):
        def __init__(self) -> None:
            pass

    api_status.reset()
    wire.set("refresher", NoDb())
    monkeypatch.setattr(wiring, "ensure_ext_server", lambda *, role=None: 47615)
    try:
        assert "ext_last_sync_at" not in status()
    finally:
        api_status.reset()


def test_contract_declares_the_optional_field() -> None:
    op = GEN.get_operation(CONTRACT, "getStatus")
    text = (ROOT / "contract" / "api.yaml").read_text(encoding="utf-8")
    assert "ext_last_sync_at" in text
    assert "ext_last_sync_at" in (ROOT / "shared" / "api-types.ts").read_text(encoding="utf-8")
    assert op is not None
