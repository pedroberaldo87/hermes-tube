"""REST routes of ``plugin/api/taxonomy.py``: folders and tags.

Plain ``def`` routes (< 2 s, no AI, no events); services only through ``wiring``. A ``TubeError``
goes up and the router returns the error envelope with HTTP 200. Body validated here (type of
each field, ``minProperties`` of the PATCHes); domain rules live in ``TaxonomyService``.

``PATCH /folders/{id}`` with ``parent_id`` + ``name``/``color`` runs in a single transaction and a
single history group (one undo reverts everything; a cycle → ``invalid`` and nothing changes).
"""

from __future__ import annotations

import functools
from collections.abc import Mapping
from typing import Any

from tube_pkg import wiring
from tube_pkg.api._common import Envelope, RestHandler, contract, error_envelope, ok
from tube_pkg.core import types as T

_STR_OR_NULL = (str, type(None))


def guard(fn: RestHandler) -> RestHandler:
    """A ``TubeError`` becomes an error envelope right in the handler (a direct call = the same
    answer as the router); any other exception goes up to the router (``internal`` + log)."""

    @functools.wraps(fn)
    def wrapper(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
        try:
            return fn(body, query)
        except T.TubeError as exc:
            return error_envelope(exc)

    return wrapper


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


def _path_id(query: Mapping[str, str], what: str) -> str:
    value = str((query or {}).get("id") or "")
    if not value:
        raise T.NotFound(f"{what} id missing")
    return value


def id_list(body: Mapping[str, Any] | None) -> list[str]:
    """``IdList``: ``{"ids": [str, ...]}`` with at least 1 item."""
    ids = _field(_body(body), "ids", (list,), required=True)
    if not ids or not all(isinstance(i, str) for i in ids):
        raise T.ValidationError("ids: non-empty list of strings", field="ids")
    return ids


# =========================================================================== folders


@contract.real
@guard
def get_folders(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /folders.

    All folders (counters in GET /state)
    """
    return ok({"items": wiring.get_taxonomy().list_folders()})


@contract.real
@guard
def post_folder(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /folders.

    Create a folder
    """
    data = _body(body)
    name = _field(data, "name", (str,), required=True)
    parent_id = _field(data, "parent_id", _STR_OR_NULL, required=False)
    color = _field(data, "color", _STR_OR_NULL, required=False)
    folder = wiring.get_taxonomy().create_folder(
        name,
        parent_id=None if parent_id is T.UNSET else parent_id,
        color=None if color is T.UNSET else color,
    )
    return ok(folder)


@contract.real
@guard
def patch_folder(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """PATCH /folders/{id}.

    Rename, recolor or move a folder
    """
    data = _body(body)
    folder_id = _path_id(query, "folder")
    name = _field(data, "name", (str,), required=False)
    color = _field(data, "color", _STR_OR_NULL, required=False)
    parent_id = _field(data, "parent_id", _STR_OR_NULL, required=False)
    if name is T.UNSET and color is T.UNSET and parent_id is T.UNSET:
        raise T.ValidationError("provide name, color or parent_id")
    tax = wiring.get_taxonomy()
    with wiring.get_db().transaction(), wiring.get_changelog().group("edit folder"):
        if tax.get_folder(folder_id) is None:
            raise T.NotFound(f"folder {folder_id} does not exist", folder_id=folder_id)
        if parent_id is not T.UNSET:
            tax.move_folder(folder_id, parent_id)
        folder = tax.update_folder(folder_id, name=name, color=color)
    return ok(folder)


@contract.real
@guard
def delete_folder(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """DELETE /folders/{id}.

    Delete a folder (channels → no folder; subfolders move up)
    """
    folder_id = _path_id(query, "folder")
    wiring.get_taxonomy().delete_folder(folder_id)
    return ok({"id": folder_id})


@contract.real
@guard
def post_folders_reorder(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /folders/reorder.

    Reorder sibling folders
    """
    ids = id_list(body)
    wiring.get_taxonomy().reorder_folders(ids)
    return ok({"count": len(ids)})


# =========================================================================== tags


@contract.real
@guard
def get_tags(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """GET /tags.

    All tags
    """
    return ok({"items": wiring.get_taxonomy().list_tags()})


@contract.real
@guard
def post_tag(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """POST /tags.

    Create a tag
    """
    data = _body(body)
    name = _field(data, "name", (str,), required=True)
    color = _field(data, "color", _STR_OR_NULL, required=False)
    tag = wiring.get_taxonomy().create_tag(name, color=None if color is T.UNSET else color)
    return ok(tag)


@contract.real
@guard
def patch_tag(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """PATCH /tags/{id}.

    Rename/recolor a tag
    """
    data = _body(body)
    tag_id = _path_id(query, "tag")
    name = _field(data, "name", (str,), required=False)
    color = _field(data, "color", _STR_OR_NULL, required=False)
    if name is T.UNSET and color is T.UNSET:
        raise T.ValidationError("provide name or color")
    return ok(wiring.get_taxonomy().update_tag(tag_id, name=name, color=color))


@contract.real
@guard
def delete_tag(body: Mapping[str, Any] | None, query: Mapping[str, str]) -> Envelope:
    """DELETE /tags/{id}.

    Delete a tag
    """
    tag_id = _path_id(query, "tag")
    wiring.get_taxonomy().delete_tag(tag_id)
    return ok({"id": tag_id})
