"""Video cover for a routine message: one 16:9 JPEG saved on disk, delivered by the Hermes cron.

The file rides with a message either through ``routines.deliver`` (``hermes send``, one photo bubble
with the text as caption) or, as the fallback, as a ``MEDIA:<absolute path>`` line that
``routines.runner`` prints after the text and the Hermes cron delivers as a native photo. This
module only produces the file:

- ``i.ytimg.com/vi/<id>/`` ``maxresdefault.jpg``, then ``hq720.jpg``, then ``mqdefault.jpg``
  (YouTube answers 404 with a small grey placeholder for a size that does not exist);
- through the plugin's HTTP client (public-address checks, per-host limits), never raw urllib;
- accepts only HTTP 200 + JPEG magic number + a sane size; short timeouts;
- saved as ``<home>/plugin-data/<PLUGIN_ID>/covers/<video id>.jpg`` (atomic write, reused when it
  already exists, newest ``KEEP`` files kept). Under Hermes' strict media policy a file counts as
  deliverable while it is recent, so a reused file gets its modification time refreshed;
- any failure at all returns ``None`` and the routine prints exactly what it printed before.

``TUBE_NO_COVERS=1`` turns it off (used by the subprocess tests to stay offline).
"""

from __future__ import annotations

import contextlib
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any

from tube_pkg._id import PLUGIN_ID

HOST_URL = "https://i.ytimg.com/vi/"
FILES = ("maxresdefault.jpg", "hq720.jpg", "mqdefault.jpg")
MIN_BYTES = 2 * 1024
MAX_BYTES = 2 * 1024 * 1024
TRY_TIMEOUT_S = 4.0
TOTAL_TIMEOUT_S = 8.0
KEEP = 20
DISABLE_ENV = "TUBE_NO_COVERS"

VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")


def covers_dir(home: Path) -> Path:
    return Path(home) / "plugin-data" / PLUGIN_ID / "covers"


def _is_jpeg(data: bytes) -> bool:
    return MIN_BYTES <= len(data) <= MAX_BYTES and data[:2] == b"\xff\xd8"


def _reusable(path: Path) -> bool:
    try:
        if not path.is_file() or not MIN_BYTES <= path.stat().st_size <= MAX_BYTES:
            return False
        with path.open("rb") as fh:
            return fh.read(2) == b"\xff\xd8"
    except OSError:
        return False


def _prune(folder: Path, keep: int = KEEP) -> None:
    files = []
    for entry in folder.glob("*.jpg"):
        with contextlib.suppress(OSError):
            files.append((entry.stat().st_mtime, entry.name, entry))
    files.sort(key=lambda item: (item[0], item[1]), reverse=True)
    for _, _, entry in files[keep:]:
        with contextlib.suppress(OSError):
            entry.unlink()


def _save(folder: Path, target: Path, data: bytes) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".part", dir=folder)
    try:
        with os.fdopen(fd, "wb") as sink:
            sink.write(data)
            sink.flush()
            os.fsync(sink.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp_name)
        raise


def fetch(client: Any, home: Path, video_id: object) -> str | None:
    """Absolute path of the cover JPEG of *video_id*, or ``None`` on any failure."""
    try:
        if os.environ.get(DISABLE_ENV) == "1":
            return None
        if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
            return None
        folder = covers_dir(home)
        target = folder / f"{video_id}.jpg"
        if _reusable(target):
            os.utime(target)
            return str(target)
        deadline = time.monotonic() + TOTAL_TIMEOUT_S
        for name in FILES:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                resp = client.get(
                    f"{HOST_URL}{video_id}/{name}",
                    timeout=min(TRY_TIMEOUT_S, remaining),
                    follow_redirects=False,
                )
            except Exception:  # noqa: BLE001 - this try failed; the next size may work
                continue
            if resp.status == 200 and _is_jpeg(resp.content):
                _save(folder, target, bytes(resp.content))
                _prune(folder)
                return str(target)
        return None
    except Exception:  # noqa: BLE001 - a cover is optional; never break the message
        return None


__all__ = ["FILES", "KEEP", "covers_dir", "fetch"]
