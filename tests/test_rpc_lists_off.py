"""List import is an Extra, and Extras are off in this version: its RPC methods say so.

They must never answer success with made-up data.
"""

from __future__ import annotations

import pytest

from tube_pkg.api import _common as common
from tube_pkg.rpc import lists as rpc_lists

CASES = [
    (rpc_lists.lists_import, {"url": "https://example.com/best-science-channels"}),
    (rpc_lists.lists_to_tab, {"list_id": "li_1", "name": "Science"}),
    (rpc_lists.lists_import, {}),
    (rpc_lists.lists_to_tab, {}),
]


@pytest.mark.parametrize(("method", "params"), CASES)
def test_list_methods_refuse_while_extras_are_off(method, params) -> None:
    env = method(params, session_id="s")
    assert env["ok"] is False
    assert env["error"]["code"] == "conflict"
    assert "Extras are not available" in env["error"]["message"]


def test_list_methods_are_not_contract_stubs() -> None:
    for method in (rpc_lists.lists_import, rpc_lists.lists_to_tab):
        assert common.is_real(method)
        assert common.stub_operation(method) is None
