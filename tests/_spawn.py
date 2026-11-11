"""Start ``multiprocessing`` ``spawn`` children from a test module, whatever the import mode.

A ``spawn`` child finds its target by importing the module that defines it, by name
(``target.__module__``), with the parent's ``sys.path``. Depending on the import mode and the
root folder, pytest names a test module ``test_refresh`` (its folder is on ``sys.path``) or
``tests.test_refresh`` (the repository root is *not* on ``sys.path``). In the second case every
child dies with ``ModuleNotFoundError: No module named 'tests'`` before running anything, and the
parent only sees a timeout (``queue.Empty``, an event never set).
"""

from __future__ import annotations

import contextlib
import sys
from collections.abc import Iterator
from pathlib import Path


def import_root(module_name: str, module_file: str) -> Path:
    """Folder that must be on ``sys.path`` to import *module_name* from *module_file*."""
    return Path(module_file).resolve().parents[module_name.count(".")]


@contextlib.contextmanager
def children_can_import(module_name: str, module_file: str) -> Iterator[None]:
    """While starting the children: the module's import root is on ``sys.path`` (appended, so it
    shadows nothing). ``spawn`` copies ``sys.path`` when each child starts."""
    root = str(import_root(module_name, module_file))
    added = root not in sys.path
    if added:
        sys.path.append(root)
    try:
        yield
    finally:
        if added and root in sys.path:
            sys.path.remove(root)
