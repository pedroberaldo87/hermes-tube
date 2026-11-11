"""REST routes of ``plugin/api/tabs.py``: tabs.

Plain ``def`` routes (< 2 s, no AI, no events); services only through ``wiring``. A ``TubeError``
goes up and the router returns the error envelope with HTTP 200. ``GET /tabs`` ensures the
built-in tabs (``TabService.ensure_builtin``, idempotent and without history) before listing.
``POST /tabs/from-channels`` requires the channels to exist (``not_found``): it is the Manage
selection.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, contract, ok
from tube_pkg.api.taxonomy import guard, id_list
from tube_pkg.core import types as T

_STR_OR_NULL = (str, type(None))


def _body(body: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if not isinstance(body, Mapping):
        raise T.ValidationError("body must be a JSON object")
    return body


def _field(body: Mapping[str, Any], key: str, kinds: tuple[type, ...], *, required: bool) -> Any:
    if key not in body:
        if required:
            raise T.ValidationError(f"{key}: required", field=key)
        return T.UNSET
    value = body[key]
    if not isinstance(value, kinds) or isinstance(value, bool):
        raise T.ValidationError(f"{key}: invalid type", field=key)
    return value


def _kind(value: Any) -> T.TabKind:
    try:
        return T.TabKind(value)
    except ValueError as exc:
        raise T.ValidationError(f"invalid kind: {value!r}", field="kind") from exc


def _path_id(query: Mapping[str, str]) -> str:
    value = str((query or {}).get("id") or "")
    if not value:
        raise T.NotFound("tab id missing")
    return value


@contract.real
@guard
def get_tabs(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /tabs.

    Tabs (by `sort`; the built-in `all-new` and `favorites` always exist)
    """
    tabs = wiring.get_tabs()
    tabs.ensure_builtin()
    return ok({"items": tabs.list()})


@contract.real
@guard
def post_tab(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /tabs.

    Create a tab (category, channels, theme or mixed)
    """
    data = _body(body)
    name = _field(data, "name", (str,), required=True)
    kind = _kind(_field(data, "kind", (str,), required=True))
    rules_raw = _field(data, "rules", (Mapping,), required=False)
    icon = _field(data, "icon", _STR_OR_NULL, required=False)
    filters = _field(data, "filters", (Mapping,), required=False)
    tabs = wiring.get_tabs()
    rules = tabs.validate_rules({} if rules_raw is T.UNSET else rules_raw)
    draft = T.TabDraft(
        name=name,
        kind=kind,
        rules=rules,
        icon=None if icon is T.UNSET else icon,
        filters={} if filters is T.UNSET else dict(filters),
    )
    return ok(tabs.create(draft))


@contract.real
@guard
def patch_tab(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """PATCH /tabs/{id}.

    Edit a tab (including switching its mode)
    """
    data = _body(body)
    tab_id = _path_id(query)
    name = _field(data, "name", (str,), required=False)
    kind = _field(data, "kind", (str,), required=False)
    rules = _field(data, "rules", (Mapping,), required=False)
    icon = _field(data, "icon", _STR_OR_NULL, required=False)
    filters = _field(data, "filters", (Mapping,), required=False)
    if all(v is T.UNSET for v in (name, kind, rules, icon, filters)):
        raise T.ValidationError("provide at least one field")
    patch = T.TabPatch(
        name=name,
        kind=T.UNSET if kind is T.UNSET else _kind(kind),
        rules=T.UNSET if rules is T.UNSET else dict(rules),
        icon=icon,
        filters=T.UNSET if filters is T.UNSET else dict(filters),
    )
    return ok(wiring.get_tabs().update(tab_id, patch))


@contract.real
@guard
def delete_tab(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """DELETE /tabs/{id}.

    Delete a tab (built-in tab → conflict)
    """
    tab_id = _path_id(query)
    wiring.get_tabs().delete(tab_id)
    return ok({"id": tab_id})


@contract.real
@guard
def post_tabs_reorder(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /tabs/reorder.

    Reorder tabs
    """
    ids = id_list(body)
    wiring.get_tabs().reorder(ids)
    return ok({"count": len(ids)})


@contract.real
@guard
def post_tab_from_channels(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /tabs/from-channels.

    Create a tab from the Manage selection
    """
    data = _body(body)
    name = _field(data, "name", (str,), required=True)
    channel_ids = _field(data, "channel_ids", (list,), required=True)
    icon = _field(data, "icon", _STR_OR_NULL, required=False)
    if not channel_ids or not all(isinstance(c, str) for c in channel_ids):
        raise T.ValidationError("channel_ids: non-empty list of strings", field="channel_ids")
    tabs = wiring.get_tabs()
    rules = T.TabRules(include=T.RuleInclude(channels=tuple(dict.fromkeys(channel_ids))))
    tabs.validate_rules(rules.to_dict())  # malformed id → invalid before looking up
    channels = wiring.get_channels()
    missing = [c for c in dict.fromkeys(channel_ids) if channels.get(c) is None]
    if missing:
        raise T.NotFound(f"channels not found: {missing}", channel_ids=missing)
    tab = tabs.create_from_channels(name, channel_ids, icon=None if icon is T.UNSET else icon)
    return ok(tab)
