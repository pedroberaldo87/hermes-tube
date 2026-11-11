"""Unsubscribe-queue invariants ("nothing is unsubscribed without a human click"), reusable.

Each ``check_*`` takes a ``QueueImpls`` (the implementations) and only uses ``Protocol`` methods
plus direct database **reads** — so it runs the same against the fakes and against the
real implementations at the integration gates::

    from fakes.invariants import INVARIANTS, QueueImpls

    @pytest.mark.parametrize("name", [n for n, _ in INVARIANTS])
    def test_queue_invariants(name, real_impls):
        dict(INVARIANTS)[name](real_impls)

Each check creates its own channels (ids ``UCinv…``) and can run over an already populated
database; the only data written directly with SQL is the operational "bait" of the export/import
check (rows in ``unsub_queue``/``jobs``/``search_jobs``/``devices`` that the import must ignore).

List:

1. export/import never carry ``unsub_queue``, ``jobs``, ``search_jobs``, ``devices`` (nor the rest
   of ``EXPORT_EXCLUDED_TABLES``);
2. ``undo`` and batches never create an ``approved`` item;
3. ``undo_approval`` on a ``done`` item (and ``running``/``failed``) changes neither ``unsub_queue``
   nor ``channels.relation``;
4. only ``ApprovedVia.desktop_rpc|ask_choice`` approve;
5. two ``upsert`` calls for the same video with different origins keep the first one.
"""

from __future__ import annotations

import copy
import itertools
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pytest

from tube_pkg.core import types as T


@dataclass
class QueueImpls:
    """Implementations the invariants exercise (all over the same ``db``)."""

    db: T.Db
    channels: T.ChannelService
    cleanup: T.Cleanup
    changelog: T.ChangeLog
    data: T.DataOps
    video_store: T.VideoStore
    targets: T.UndoTargets
    taxonomy: T.TaxonomyService | None = None
    prefix: str = field(default="inv")
    """Prefix of the created ids (change it to run twice on the same database)."""

    @classmethod
    def from_world(cls, world: Any, **kw: Any) -> QueueImpls:
        """From a ``fakes.FakeWorld`` (or any object with the same attributes)."""
        return cls(
            db=world.db,
            channels=world.channels,
            cleanup=world.cleanup,
            changelog=world.changelog,
            data=world.data,
            video_store=world.video_store,
            targets=world.targets(),
            taxonomy=getattr(world, "taxonomy", None),
            **kw,
        )


_counter = itertools.count(1)


def _cid(impls: QueueImpls, tag: str) -> str:
    """Valid, unique channel id (``UC`` + 22)."""
    body = f"{impls.prefix}{tag}{next(_counter)}"
    body = "".join(ch for ch in body if ch.isalnum())[:22]
    return "UC" + body.ljust(22, "0")


def _vid(tag: str) -> str:
    body = "".join(ch for ch in f"{tag}{next(_counter)}" if ch.isalnum())[:11]
    return body.ljust(11, "0")


def _subscribed(impls: QueueImpls, tag: str, n: int = 1) -> list[str]:
    ids = [_cid(impls, f"{tag}{i}") for i in range(n)]
    impls.channels.upsert_many(
        [T.ChannelIn(title=f"Canal {cid[-6:]}", channel_id=cid) for cid in ids],
        source=T.ChannelSource.extension,
        relation=T.Relation.subscribed,
        actor=T.Actor.extension,
    )
    for cid in ids:
        ch = impls.channels.get(cid)
        assert ch is not None and ch.relation is T.Relation.subscribed, cid
    return ids


def _queue_rows(impls: QueueImpls) -> list[dict[str, Any]]:
    return impls.db.query("SELECT * FROM unsub_queue ORDER BY id")


def _approved_count(impls: QueueImpls) -> int:
    row = impls.db.query_one("SELECT COUNT(*) AS n FROM unsub_queue WHERE status = 'approved'")
    return int(row["n"]) if row else 0


def _relation(impls: QueueImpls, channel_id: str) -> str:
    row = impls.db.query_one("SELECT relation FROM channels WHERE id = ?", (channel_id,))
    assert row is not None, channel_id
    return str(row["relation"])


def _latest_change(impls: QueueImpls, action: T.ChangeAction) -> T.ChangeRecord:
    for rec in impls.changelog.list(limit=200):
        if rec.action == action:
            return rec
    raise AssertionError(f"no {action} entry in the history")


def _count(impls: QueueImpls, table: str) -> int:
    row = impls.db.query_one(f"SELECT COUNT(*) AS n FROM {table}")
    return int(row["n"]) if row else 0


# --------------------------------------------------------------------------- 1. export/import


def _walk_keys(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for k, v in value.items():
            keys.add(str(k))
            keys |= _walk_keys(v)
    elif isinstance(value, list | tuple):
        for v in value:
            keys |= _walk_keys(v)
    return keys


def _bait_rows(now: int, channel_id: str) -> dict[str, list[dict[str, Any]]]:
    return {
        "unsub_queue": [
            {
                "id": "bait-queue",
                "channel_id": channel_id,
                "action": "unsubscribe",
                "reason": "bait",
                "approved_at": now,
                "approved_via": "desktop_rpc",
                "status": "approved",
                "created_at": now,
                "updated_at": now,
            }
        ],
        "jobs": [
            {
                "id": "bait-job",
                "kind": "organize",
                "status": "queued",
                "created_at": now,
                "updated_at": now,
            }
        ],
        "search_jobs": [
            {
                "id": "bait-search",
                "batch_id": "bait",
                "query": "bait",
                "search_order": "relevance",
                "status": "pending",
                "created_at": now,
                "expires_at": now + 15,
            }
        ],
        "devices": [
            {"id": "bait-device", "name": "bait", "token_hash": "bait-hash", "created_at": now}
        ],
        "pair_codes": [{"code_hash": "bait-code", "created_at": now, "expires_at": now + 600}],
        "cleanup_candidates": [
            {
                "id": "bait-cand",
                "scan_id": "bait",
                "channel_id": channel_id,
                "group_key": "manual",
                "why": "bait",
                "status": "approved",
                "created_at": now,
            }
        ],
    }


def check_export_import_never_carry_operational_tables(impls: QueueImpls) -> None:
    (cid,) = _subscribed(impls, "exp")
    items = impls.cleanup.approve([cid], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    assert len(items) == 1
    queue_id = items[0].id
    # extra operational rows (written directly: they are bait, not business rules)
    impls.db.execute(
        "INSERT INTO jobs (id, kind, status, created_at, updated_at)"
        " VALUES ('inv-job', 'organize', 'done', 1, 1)"
    )
    impls.db.execute(
        "INSERT INTO search_jobs (id, batch_id, query, search_order, status, created_at,"
        " expires_at) VALUES ('inv-search', 'b', 'q', 'relevance', 'pending', 1, 16)"
    )
    impls.db.execute(
        "INSERT INTO devices (id, name, token_hash, created_at)"
        " VALUES ('inv-device', 'd', 'inv-hash', 1)"
    )

    exported = impls.data.export_json()
    assert isinstance(exported, dict)
    text = json.dumps(T.to_jsonable(exported), ensure_ascii=False)
    leaked = _walk_keys(exported) & set(T.EXPORT_EXCLUDED_TABLES)
    assert not leaked, f"export levou tabelas operacionais: {sorted(leaked)}"
    for needle in (queue_id, "approved_via", "inv-job", "inv-search", "inv-device", "inv-hash"):
        assert needle not in text, f"export vazou {needle!r}"

    before = {t: _count(impls, t) for t in T.EXPORT_EXCLUDED_TABLES}
    queue_before = _queue_rows(impls)
    bait = _bait_rows(1_700_000_000, cid)
    payload = copy.deepcopy(T.to_jsonable(exported))
    payload.update(copy.deepcopy(bait))
    nested = payload.get("tables")
    if isinstance(nested, dict):
        nested.update(copy.deepcopy(bait))
    impls.data.import_json(payload)

    after = {t: _count(impls, t) for t in T.EXPORT_EXCLUDED_TABLES}
    assert after == before, f"import trouxe tabelas operacionais: {before} -> {after}"
    assert _queue_rows(impls) == queue_before
    for table, rows in bait.items():
        key = "code_hash" if table == "pair_codes" else "id"
        got = impls.db.query(f"SELECT {key} FROM {table} WHERE {key} = ?", (rows[0][key],))
        assert got == [], f"import wrote bait into {table}"


# --------------------------------------------------------------------------- 2. undo and batch


def check_undo_and_batch_never_create_approved(impls: QueueImpls) -> None:
    a, b, c = _subscribed(impls, "und", 3)
    total_before = len(_queue_rows(impls))
    approved_before = _approved_count(impls)

    def assert_no_new_approved(where: str) -> None:
        assert _approved_count(impls) == approved_before, f"{where} criou item approved"

    tag_id: str | None = None
    if impls.taxonomy is not None:
        tag_id = impls.taxonomy.create_tag(f"inv-tag-{next(_counter)}").id
    values: dict[T.BatchOp, str | None] = {T.BatchOp.move: None}
    for op in T.BatchOp:
        if op in (T.BatchOp.tag, T.BatchOp.untag):
            if tag_id is None:
                continue
            values[op] = tag_id
        try:
            result = impls.channels.batch(op, [a, b], value=values.get(op), actor=T.Actor.user)
        except T.TubeError:
            assert_no_new_approved(f"lote {op} recusado")
            continue
        assert_no_new_approved(f"lote {op}")
        if result.change_id is not None:
            try:
                impls.changelog.undo(result.change_id, targets=impls.targets)
            except T.UndoRefused:
                pass
            assert_no_new_approved(f"desfazer lote {op}")

    # the Manage "unsubscribe" batch = candidates only
    impls.cleanup.propose([a, b], reason="lote", actor=T.Actor.user)
    assert_no_new_approved("Cleanup.propose")
    assert len(_queue_rows(impls)) == total_before

    # relation: undoing ex goes back to subscribed with no queue
    impls.channels.set_relation(c, T.Relation.ex, actor=T.Actor.user)
    rel_change = _latest_change(impls, T.ChangeAction.channel_relation)
    impls.changelog.undo(rel_change.id, targets=impls.targets)
    assert _relation(impls, c) == "subscribed"
    assert_no_new_approved("desfazer channel_relation")
    assert len(_queue_rows(impls)) == total_before

    # legitimate approval and undo through history: approved → undone, never a new item
    (item,) = impls.cleanup.approve([a], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
    assert _approved_count(impls) == approved_before + 1
    approve_change = _latest_change(impls, T.ChangeAction.cleanup_approve)
    impls.changelog.undo(approve_change.id, targets=impls.targets)
    assert_no_new_approved("desfazer cleanup_approve")
    rows = {r["id"]: r for r in _queue_rows(impls)}
    assert len(rows) == total_before + 1
    assert rows[item.id]["status"] == "undone"
    with pytest.raises(T.UndoRefused) as refused:
        impls.changelog.undo(approve_change.id, targets=impls.targets)
    assert refused.value.reason == "already_undone"
    impls.cleanup.undo_approval([item.id])  # undone → undone: no-op
    assert_no_new_approved("undo_approval repetido")
    assert len(_queue_rows(impls)) == total_before + 1

    # an undone resubscription (legitimate human path) does not leave approved either
    impls.channels.set_relation(b, T.Relation.ex, actor=T.Actor.user)
    (resub,) = impls.cleanup.resubscribe([b], T.ApprovedVia.ask_choice, actor=T.Actor.user)
    assert resub.action is T.QueueAction.resubscribe
    resub_change = _latest_change(impls, T.ChangeAction.cleanup_resubscribe)
    impls.changelog.undo(resub_change.id, targets=impls.targets)
    assert_no_new_approved("desfazer cleanup_resubscribe")
    assert len(_queue_rows(impls)) == total_before + 2


# --------------------------------------------------------------------------- 3. undo_approval


def _drive(impls: QueueImpls, item: T.QueueItem, final: T.QueueStatus) -> None:
    impls.cleanup.queue_result(item.id, T.QueueStatus.running, device_id="inv-dev")
    if final is not T.QueueStatus.running:
        impls.cleanup.queue_result(item.id, final, device_id="inv-dev", error=None)


def check_undo_approval_after_execution_changes_nothing(impls: QueueImpls) -> None:
    done_c, running_c, failed_c, pending_c = _subscribed(impls, "exe", 4)
    items = {
        cid: impls.cleanup.approve([cid], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)[0]
        for cid in (done_c, running_c, failed_c, pending_c)
    }
    approve_changes = [
        rec
        for rec in impls.changelog.list(limit=200)
        if rec.action is T.ChangeAction.cleanup_approve
    ][:4]
    _drive(impls, items[done_c], T.QueueStatus.done)
    _drive(impls, items[running_c], T.QueueStatus.running)
    _drive(impls, items[failed_c], T.QueueStatus.failed)
    assert _relation(impls, done_c) == "ex", "unsubscribe done → relation ex"

    def snapshot() -> tuple[list[dict[str, Any]], dict[str, str]]:
        return _queue_rows(impls), {cid: _relation(impls, cid) for cid in items}

    before = snapshot()
    for cid in (done_c, running_c, failed_c):
        with pytest.raises(T.UndoRefused) as refused:
            impls.cleanup.undo_approval([items[cid].id])
        assert refused.value.reason == "already_executed"
        assert snapshot() == before, f"undo_approval on {cid} changed the state"
    # all or nothing: a mixed list does not undo even the item that is still approved
    with pytest.raises(T.UndoRefused):
        impls.cleanup.undo_approval([items[pending_c].id, items[done_c].id])
    assert snapshot() == before
    # through history: same refusal, nothing changes
    for rec in approve_changes:
        queue_ids = set(getattr(rec.undo, "queue_ids", ()))
        if queue_ids & {items[c].id for c in (done_c, running_c, failed_c)}:
            with pytest.raises(T.UndoRefused) as refused:
                impls.changelog.undo(rec.id, targets=impls.targets)
            assert refused.value.reason == "already_executed"
            assert snapshot() == before
    # and the item still approved remains undoable
    impls.cleanup.undo_approval([items[pending_c].id])
    rows = {r["id"]: r for r in _queue_rows(impls)}
    assert rows[items[pending_c].id]["status"] == "undone"


# --------------------------------------------------------------------------- 4. human vias

BAD_VIAS: tuple[Any, ...] = (
    None,
    "",
    "rest",
    "tool",
    "routine",
    "cron",
    "agent",
    "hermes",
    "DESKTOP_RPC",
    "desktop",
    "ask",
    T.Actor.hermes,
    T.Actor.routine,
    T.Actor.user,
    0,
    1,
    True,
)
"""Values that ``approve``/``resubscribe`` must refuse with ``ApprovalRefused``."""


def check_only_human_vias_approve(impls: QueueImpls) -> None:
    (sub,) = _subscribed(impls, "via")
    (ex,) = _subscribed(impls, "vex")
    impls.channels.set_relation(ex, T.Relation.ex, actor=T.Actor.user)
    rows_before = _queue_rows(impls)
    for via in BAD_VIAS:
        with pytest.raises(T.ApprovalRefused):
            impls.cleanup.approve([sub], via, actor=T.Actor.user)
        with pytest.raises(T.ApprovalRefused):
            impls.cleanup.resubscribe([ex], via, actor=T.Actor.user)
        assert _queue_rows(impls) == rows_before, f"via {via!r} touched the queue"
    assert _relation(impls, sub) == "subscribed"

    for via in T.ApprovedVia:
        (cid,) = _subscribed(impls, f"ok{via.value[:3]}")
        (item,) = impls.cleanup.approve([cid], via, actor=T.Actor.user)
        assert item.status is T.QueueStatus.approved
        assert item.approved_via is via
        assert isinstance(item.approved_at, int) and item.approved_at > 0
        row = impls.db.query_one("SELECT * FROM unsub_queue WHERE id = ?", (item.id,))
        assert row is not None
        assert row["approved_via"] == via.value and row["approved_at"] == item.approved_at
    for pending in impls.cleanup.queue_pending():
        assert pending.status is T.QueueStatus.approved
        assert pending.approved_via in T.HUMAN_APPROVAL_VIAS and pending.approved_at


# --------------------------------------------------------------------------- 5. VideoStore


def check_first_video_origin_wins(impls: QueueImpls) -> None:
    store = impls.video_store
    channel = _cid(impls, "vid")
    origins = list(T.VideoOrigin)
    for first, second in itertools.permutations(origins, 2):
        vid = _vid(f"o{first.value[:2]}{second.value[:2]}")
        store.upsert(
            [T.VideoIn(id=vid, channel_id=channel, title="t1", description="d1", views=10)],
            first,
        )
        v1 = store.get([vid])[vid]
        assert v1.origin is first and v1.first_seen_at > 0
        store.upsert(
            [
                T.VideoIn(
                    id=vid,
                    channel_id=channel,
                    title="t2",
                    description="d2",
                    views=20,
                    published_at=123,
                )
            ],
            second,
        )
        v2 = store.get([vid])[vid]
        assert v2.origin is first, f"{first} → {second}: origin changed to {v2.origin}"
        assert v2.first_seen_at == v1.first_seen_at
        assert (v2.title, v2.description, v2.views, v2.published_at) == ("t2", "d2", 20, 123)

    # empty fields do not erase; duration only fills in when NULL
    vid = _vid("keep")
    store.upsert([T.VideoIn(id=vid, channel_id=channel, title="a", description="d")], origins[0])
    store.upsert([T.VideoIn(id=vid, channel_id=channel, title="a", duration_s=100)], origins[1])
    store.upsert(
        [
            T.VideoIn(
                id=vid, channel_id=channel, title="a", description="", views=None, duration_s=200
            )
        ],
        origins[2],
    )
    v = store.get([vid])[vid]
    assert v.origin is origins[0]
    assert v.description == "d"
    assert v.duration_s == 100


INVARIANTS: tuple[tuple[str, Callable[[QueueImpls], None]], ...] = (
    (
        "export_import_never_carry_operational_tables",
        check_export_import_never_carry_operational_tables,
    ),
    ("undo_and_batch_never_create_approved", check_undo_and_batch_never_create_approved),
    (
        "undo_approval_after_execution_changes_nothing",
        check_undo_approval_after_execution_changes_nothing,
    ),
    ("only_human_vias_approve", check_only_human_vias_approve),
    ("first_video_origin_wins", check_first_video_origin_wins),
)
"""``(name, check)`` in the order of the list in the module docstring."""


def run_invariants(make_impls: Callable[[], QueueImpls]) -> dict[str, str | None]:
    """Runs all of them outside pytest, each with fresh implementations; ``None`` = passed."""
    out: dict[str, str | None] = {}
    for name, fn in INVARIANTS:
        try:
            fn(make_impls())
        except BaseException as exc:  # noqa: BLE001
            out[name] = f"{type(exc).__name__}: {exc}"
        else:
            out[name] = None
    return out


__all__ = [
    "BAD_VIAS",
    "INVARIANTS",
    "QueueImpls",
    "check_export_import_never_carry_operational_tables",
    "check_first_video_origin_wins",
    "check_only_human_vias_approve",
    "check_undo_and_batch_never_create_approved",
    "check_undo_approval_after_execution_changes_nothing",
    "run_invariants",
]
