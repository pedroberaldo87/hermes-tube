"""In-memory fakes of every ``Protocol`` in ``tube_pkg.core.types``.

Import with ``from fakes import ...`` (``tests/conftest.py`` puts ``tests/`` on ``sys.path``).

- ``FAKES``: ``Protocol`` → fake class (the 30 in ``types.PROTOCOLS``)
- ``build_fake_world(db)``: all of them wired over the same ``Db``; ``seed_world(world)``: data
- ``fakes.db_conformance``: reusable ``Db`` suite
- ``fakes.invariants``: reusable unsubscribe-queue invariants
"""

from __future__ import annotations

from .ctx import FakeCtx, FakeLlmResult, FakePluginLlm
from .db import MemDb
from .infra import (
    DEFAULT_NOW,
    FakeClock,
    FakeDeviceAuth,
    FakeEventSink,
    FakeHttp,
    FakeJobRunner,
    FakeLens,
    FakeLLM,
    FakeLLMBackend,
    FakeSettings,
    default_response,
)
from .ops import (
    FakeCleanup,
    FakeDataOps,
    FakeDemoLoader,
    FakeFeedEngine,
    FakeListImporter,
    FakeMaintenance,
    FakeOrganizer,
    FakeRefresher,
    FakeRoutinesInstaller,
    FakeSearcher,
    FakeSyncIngest,
    FakeThemes,
)
from .services import (
    FakeChangeLog,
    FakeChannelService,
    FakeTabService,
    FakeTaxonomyService,
    FakeVideoStateService,
    FakeVideoStore,
    IdGen,
)
from .world import FakeWorld, SeedWorld, build_fake_world, seed_world
from .youtube import FakeYouTube

FAKES: dict[str, type] = {
    "Clock": FakeClock,
    "Db": MemDb,
    "Settings": FakeSettings,
    "HttpClient": FakeHttp,
    "EventSink": FakeEventSink,
    "LLMBackend": FakeLLMBackend,
    "LLM": FakeLLM,
    "JobRunner": FakeJobRunner,
    "YouTubeClient": FakeYouTube,
    "Lens": FakeLens,
    "DeviceAuth": FakeDeviceAuth,
    "Undoable": FakeChannelService,
    "ChangeLog": FakeChangeLog,
    "ChannelService": FakeChannelService,
    "TaxonomyService": FakeTaxonomyService,
    "TabService": FakeTabService,
    "VideoStateService": FakeVideoStateService,
    "VideoStore": FakeVideoStore,
    "FeedEngine": FakeFeedEngine,
    "Refresher": FakeRefresher,
    "Organizer": FakeOrganizer,
    "Cleanup": FakeCleanup,
    "Searcher": FakeSearcher,
    "Themes": FakeThemes,
    "ListImporter": FakeListImporter,
    "SyncIngest": FakeSyncIngest,
    "DemoLoader": FakeDemoLoader,
    "DataOps": FakeDataOps,
    "RoutinesInstaller": FakeRoutinesInstaller,
    "Maintenance": FakeMaintenance,
}
"""``Protocol`` → fake. ``Undoable`` is satisfied by every service that owns history."""

__all__ = [
    "DEFAULT_NOW",
    "FAKES",
    "FakeChangeLog",
    "FakeChannelService",
    "FakeCleanup",
    "FakeClock",
    "FakeCtx",
    "FakeDataOps",
    "FakeDemoLoader",
    "FakeDeviceAuth",
    "FakeEventSink",
    "FakeFeedEngine",
    "FakeHttp",
    "FakeJobRunner",
    "FakeLLM",
    "FakeLLMBackend",
    "FakeLens",
    "FakeListImporter",
    "FakeLlmResult",
    "FakeMaintenance",
    "FakeOrganizer",
    "FakePluginLlm",
    "FakeRefresher",
    "FakeRoutinesInstaller",
    "FakeSearcher",
    "FakeSettings",
    "FakeSyncIngest",
    "FakeTabService",
    "FakeTaxonomyService",
    "FakeThemes",
    "FakeVideoStateService",
    "FakeVideoStore",
    "FakeWorld",
    "FakeYouTube",
    "IdGen",
    "MemDb",
    "SeedWorld",
    "build_fake_world",
    "default_response",
    "seed_world",
]
