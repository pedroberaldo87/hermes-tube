"""Gate: the real database meets the contract and the queue invariants.

Runs the same conformance suite as ``MemDb`` against ``core/db.py``.
"""

from __future__ import annotations

import pytest
from fakes.db_conformance import DbConformance

from tube_pkg.core import db as core_db


class TestCoreDbConformance(DbConformance):
    shared_path = True

    @pytest.fixture
    def make_db(self, tmp_path):
        path = str(tmp_path / "g0.db")
        made = []

        def factory():
            made.append(core_db.build(path=path))
            return made[-1]

        yield factory
        for d in made:
            d.close()


def test_embedded_schema_matches_contract():
    from pathlib import Path

    contract = (Path(__file__).resolve().parents[1] / "contract" / "schema.sql").read_text(
        encoding="utf-8"
    )
    assert core_db.SCHEMA_SQL.strip() == contract.strip()
