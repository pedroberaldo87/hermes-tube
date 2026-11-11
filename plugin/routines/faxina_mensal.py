"""Routine ``faxina-mensal``.

🧹 day 1, 10:00: only the cleanup list + a pointer to /tube faxina (never approves).

Self-contained script of the cron job: the shim ``<profile>/scripts/<id>-faxina-mensal.py``
runs this file with ``argv[1]`` = the shim path. Up to ``_header.bootstrap`` (loaded by path) it
only uses the standard library; the rest is ``tube_pkg.routines.runner``.
stdout = delivery; empty = silence; exit ≠ 0 = alert.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

KEY = "faxina-mensal"


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        sys.stderr.write(f"usage: python {Path(__file__).name} <shim path>\n")
        return 2
    header = runpy.run_path(str(Path(__file__).resolve().with_name("_header.py")))
    resolved = header["bootstrap"](args[0])
    from tube_pkg.routines import runner

    return runner.run(KEY, resolved, warn=header["check_env"](resolved))


if __name__ == "__main__":
    sys.exit(main())
