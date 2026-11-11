"""YAML parsing that works inside the Hermes runtime.

Hermes parses YAML with ruamel.yaml and does not ship PyYAML, so a bare ``import yaml`` fails on a
stock install. ``safe_load`` uses PyYAML when it is importable (tests, older environments) and
otherwise ruamel.yaml's safe loader with YAML 1.1 rules, the same policy as Hermes's own loader.
Standard library plus whichever parser is present; no network, no thread.
"""

from __future__ import annotations

from typing import Any


def safe_load(text: str) -> Any:
    """Parse *text* as YAML data (``None`` for an empty document).

    Raises ``ImportError`` when neither PyYAML nor ruamel.yaml is importable, and the parser's own
    error on invalid YAML; callers already treat both as "unreadable".
    """
    try:
        import yaml
    except ImportError:
        yaml = None
    if yaml is not None:
        return yaml.safe_load(text)
    from ruamel.yaml import YAML

    # one instance per call: ruamel parsers are not thread-safe
    parser = YAML(typ="safe", pure=True)
    parser.version = (1, 1)
    return parser.load(text)


__all__ = ["safe_load"]
