"""The feed engine is built with on-demand Short detection wired to the Refresher."""

from __future__ import annotations

from fakes import FakeSettings

from tube_pkg import wiring
from tube_pkg.core import db as core_db


def test_feed_from_graph_has_shorts_resolver(tmp_path):
    db = core_db.build(path=str(tmp_path / "t.db"))
    try:
        graph = wiring.Graph(db=db, settings=FakeSettings(), ctx=None)
        feed = graph.get("feed")
        assert feed.has_shorts_resolver
    finally:
        db.close()


def test_builtin_tabs_exist_before_any_reader(tmp_path):
    """Whoever reads `tabs` before Home already finds the built-in tabs."""
    db = core_db.build(path=str(tmp_path / "t.db"))
    try:
        graph = wiring.Graph(db=db, settings=FakeSettings(), ctx=None)
        graph.get("feed")
        rows = db.query("SELECT id FROM tabs")
        assert len(rows) >= 1
    finally:
        db.close()
