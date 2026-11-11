"""Disposable extension server for the live probe (real plugin code, throwaway database).

Started by ``probe.ts`` as a child process; never run against a real profile. It refuses to start
unless ``TUBE_DB_PATH`` points at a file inside ``TMPDIR`` (the plugin's wiring then uses only that
database and default settings — no Hermes profile is read or written).

Protocol: one JSON object per line on stdin, one JSON answer per line on stdout (``{"ok": ...}``).

- ``{"cmd": "start"}`` → starts the real extension server in the usual range; ``{"port"}``
- ``{"cmd": "code"}`` → a new pairing code (``POST /pair/start`` handler); ``{"code", "port"}``
- ``{"cmd": "devices"}`` → paired devices (id, name, origin)
- ``{"cmd": "approve", "channel_id", "title"}`` → stores the channel as subscribed and approves its
  unsubscribe as a human would (``desktop_rpc``); ``{"items"}``
- ``{"cmd": "queue"}`` → rows of the unsubscribe queue
- ``{"cmd": "watch"}`` → rows of the watch history
- ``{"cmd": "calls"}`` → every extension route the server handled (name, ok, error code, summary)
- ``{"cmd": "stop"}`` → stops the server and exits
"""

from __future__ import annotations

import dataclasses
import importlib.util
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]


def _guard() -> None:
    db = os.environ.get("TUBE_DB_PATH", "")
    tmp = os.environ.get("TMPDIR", "")
    if not db or not tmp or not Path(db).resolve().is_relative_to(Path(tmp).resolve()):
        sys.exit("refusing to start: TUBE_DB_PATH must be a file inside TMPDIR")


def _bootstrap() -> None:
    spec = importlib.util.spec_from_file_location(
        "_tube_bootstrap_live_probe", ROOT / "plugin" / "_bootstrap.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ensure()


_guard()
os.environ.setdefault("TUBE_NO_RELOAD", "1")
_bootstrap()

from tube_pkg import wiring  # noqa: E402
from tube_pkg.api import pair as api_pair  # noqa: E402
from tube_pkg.core import types as T  # noqa: E402
from tube_pkg.ext import _server  # noqa: E402

CALLS: list[dict[str, Any]] = []
_CALLS_LOCK = threading.Lock()


def _summary(name: str, body: Any) -> Any:
    if not isinstance(body, dict):
        return None
    if name == "sync_subscriptions":
        return {"signal": body.get("signal"), "channels": len(body.get("channels") or [])}
    if name == "sync_watch":
        return {"events": body.get("events")}
    if name == "post_queue_result":
        return {k: body.get(k) for k in ("status", "error")}
    return None


def _wrap(name: str, fn: Any) -> Any:
    def logged(device: Any, body: Any, query: Any, *args: Any, **kwargs: Any) -> Any:
        env = fn(device, body, query, *args, **kwargs)
        ok = bool(isinstance(env, dict) and env.get("ok"))
        err = None if ok or not isinstance(env, dict) else (env.get("error") or {}).get("code")
        entry = {"at": time.time(), "handler": name, "ok": ok, "error": err}
        if name == "pair_complete" and isinstance(env, dict):
            data = env.get("data") or {}
            details = (env.get("error") or {}).get("details") or {}
            pake = (body.get("pake") or {}) if isinstance(body, dict) else {}
            entry["round"] = 2 if "session" in pake else 1
            entry["remaining"] = (data.get("pake") or {}).get("remaining", details.get("remaining"))
            entry["paired"] = bool(data.get("token"))
        else:
            entry["summary"] = _summary(name, body)
        if name == "post_queue_result":
            entry["id"] = (query or {}).get("id")
        with _CALLS_LOCK:
            CALLS.append(entry)
        return env

    return logged


_real_ext_handlers = wiring.ext_handlers


def _logged_ext_handlers(*, db: Any, settings: Any) -> Any:
    handlers = _real_ext_handlers(db=db, settings=settings)
    fields = {
        f.name: _wrap(f.name, getattr(handlers, f.name))
        for f in dataclasses.fields(handlers)
        if f.name != "authenticate"
    }
    return dataclasses.replace(handlers, **fields)


wiring.ext_handlers = _logged_ext_handlers


def _rows(sql: str) -> list[dict[str, Any]]:
    return [dict(r) for r in wiring.get_db().query(sql)]


def handle(cmd: dict[str, Any]) -> Any:
    name = cmd.get("cmd")
    if name == "start":
        return {"port": wiring.ensure_ext_server(role="host")}
    if name == "code":
        env = api_pair.post_pair_start({}, {})
        if not env.get("ok"):
            raise RuntimeError(json.dumps(env))
        return {"code": env["data"]["code"], "port": env["data"]["port"]}
    if name == "devices":
        return [
            {"id": d.id, "name": d.name, "origin": getattr(d, "origin", None)}
            for d in wiring.get_devices().list()
        ]
    if name == "approve":
        cid = str(cmd["channel_id"])
        wiring.get_channels().upsert_many(
            [
                T.ChannelIn(
                    title=str(cmd.get("title") or cid),
                    channel_id=cid,
                    url=f"https://www.youtube.com/channel/{cid}",
                )
            ],
            source=T.ChannelSource.extension,
            relation=T.Relation.subscribed,
            actor=T.Actor.extension,
        )
        items = wiring.get_cleanup().approve([cid], T.ApprovedVia.desktop_rpc, actor=T.Actor.user)
        return {"items": [{"id": i.id, "status": str(i.status)} for i in items]}
    if name == "queue":
        return _rows(
            "SELECT id, channel_id, action, status, error, approved_via"
            " FROM unsub_queue ORDER BY id"
        )
    if name == "watch":
        return _rows(
            "SELECT video_id, channel_id, watched_at FROM watch_history ORDER BY watched_at"
        )
    if name == "channels":
        return _rows("SELECT id, title, relation FROM channels ORDER BY id")
    if name == "calls":
        with _CALLS_LOCK:
            return list(CALLS)
    raise ValueError(f"unknown command {name!r}")


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            if cmd.get("cmd") == "stop":
                break
            out: dict[str, Any] = {"ok": True, "data": handle(cmd)}
        except Exception as exc:  # noqa: BLE001 — the probe reads the error
            out = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps(out, default=str), flush=True)
    _server.stop_local(wiring.data_dir())
    wiring.reset()
    print(json.dumps({"ok": True, "data": "stopped"}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
