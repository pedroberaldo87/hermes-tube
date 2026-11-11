"""``JobRunner``: asynchronous AI jobs whose state lives **only in SQLite**.

- ``submit`` writes the job as ``queued`` and returns at once; *fn* runs on a new thread started
  with ``contextvars.copy_context()`` (the profile Hermes is serving is a contextvar; the ``Db``
  is already resolved by the caller);
- **semaphore of ``MAX_RUNNING`` = 4** per runner: full → ``Busy`` at once (nothing written, no
  unbounded queue);
- progress (``on_progress``) goes to ``jobs.progress`` + ``updated_at``; ``GET /jobs/{id}``
  (plugin host, another process) reads the database every 2 s; ``progress_event`` and ``event``
  only speed up that poll (``{job, progress}`` and ``{job, status}``; ``session_id`` → that
  session only);
- the result goes through ``to_jsonable`` and must become JSON; ``TubeError`` →
  ``{code, message}``; any other exception → ``{"code": "internal", "message": <exception text>}``;
- **nothing stays "running" forever**: every read (``get``, ``list_active``, ``purge``) closes as
  ``error`` an active job whose owner process died (pid in the id itself, ``job_<pid>_<hex>``;
  code ``internal``, "interrupted") or that has given no sign of life for ``stale_after_s`` (code
  ``timeout``). A late finish of an already closed job does not bring it back.

Cancellation (``cancel``/``job.cancel``) is **cooperative**: ``cancel`` closes the job at once as
``error`` with ``error.code = T.JOB_CANCELLED_CODE`` (it leaves ``list_active``, so the RPCs'
\"one at a time\" rule frees up) and announces the end through *event*; the thread runs until the
next checkpoint — any ``on_progress(...)`` or ``T.check_cancelled(on_progress)`` — and gets
``T.Cancelled`` there. The mark lives in the database (another instance/process may cancel) and
in a local ``Event`` (shortcut). A dedicated ``JobStatus.cancelled`` would need the ``CHECK`` on
``jobs.status`` to change (contract request).

Known limit: a pid reused by another process after a restart is only caught by
``stale_after_s``. A model call already in flight is not interrupted: the cancelled job's thread
only ends when it returns (the semaphore of 4 counts the thread until then; \"one at a time\"
does not).
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import threading
import uuid
from collections.abc import Callable, Mapping
from typing import Any

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import types as T

logger = logging.getLogger(__name__)

MAX_RUNNING = 4
"""Concurrent AI jobs per runner (the 5th gets ``Busy``)."""
STALE_AFTER_S = 600
"""Active job with no write (start, progress) for longer than this → ``timeout``."""
MESSAGE_CHARS = 500

_ACTIVE = (T.JobStatus.queued.value, T.JobStatus.running.value)
_FINISHED = (T.JobStatus.done.value, T.JobStatus.error.value)
_ID_RE = re.compile(r"^job_(\d+)_[0-9a-f]+$")

CANCELLED_MESSAGE = "Job cancelled on request. Whatever was already done stays saved."

BUSY_MESSAGE = "{n} AI jobs are already running. Wait for one to finish and try again."
ORPHAN_MESSAGE = (
    "Job interrupted: the Hermes process running it ended before it finished "
    "(restart or crash). Run it again."
)
STALE_MESSAGE = "The job gave no sign of life for more than {m} min and was stopped. Run it again."


_IS_WINDOWS = os.name == "nt"
WIN_STILL_ACTIVE = 259
"""``GetExitCodeProcess`` code of a process that has not exited."""
WIN_ERROR_ACCESS_DENIED = 5
"""``OpenProcess`` refused: the process exists (another user's, or protected)."""
WIN_ERROR_INVALID_PARAMETER = 87
"""``OpenProcess`` error for a pid that names no process."""
_WIN_QUERY_LIMITED = 0x1000  # PROCESS_QUERY_LIMITED_INFORMATION
_win_kernel_cache: Any = None


class _Kernel32:
    """The four kernel32 calls ``pid_alive`` needs (standard library ``ctypes`` only)."""

    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes

        k = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
        k.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k.OpenProcess.restype = wintypes.HANDLE
        k.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        k.GetExitCodeProcess.restype = wintypes.BOOL
        k.CloseHandle.argtypes = (wintypes.HANDLE,)
        k.CloseHandle.restype = wintypes.BOOL
        self._ctypes, self._wintypes, self._k = ctypes, wintypes, k

    def open(self, pid: int) -> Any:
        return self._k.OpenProcess(_WIN_QUERY_LIMITED, False, pid) or None

    def last_error(self) -> int:
        return int(self._ctypes.get_last_error())  # type: ignore[attr-defined]

    def exit_code(self, handle: Any) -> int | None:
        code = self._wintypes.DWORD()
        if not self._k.GetExitCodeProcess(handle, self._ctypes.byref(code)):
            return None
        return int(code.value)

    def close(self, handle: Any) -> None:
        self._k.CloseHandle(handle)


def _win_kernel() -> Any:
    global _win_kernel_cache
    if _win_kernel_cache is None:
        _win_kernel_cache = _Kernel32()
    return _win_kernel_cache


def _windows_pid_alive(pid: int, *, kernel: Any = None) -> bool:
    """Windows probe: open the process for a limited query and read its exit code. Only a
    pid that names no process, or a process that has exited, reads as dead; anything unsure
    (kernel32 not loadable, another error) reads as alive."""
    try:
        k = kernel if kernel is not None else _win_kernel()
        handle = k.open(pid)
        if not handle:
            return k.last_error() != WIN_ERROR_INVALID_PARAMETER
        try:
            code = k.exit_code(handle)
        finally:
            k.close(handle)
    except Exception:  # noqa: BLE001 — a probe never raises; unsure = alive
        return True
    return code is None or code == WIN_STILL_ACTIVE


def pid_alive(pid: int) -> bool:
    """Does process *pid* exist on this machine? When unsure, ``True`` (the inactivity deadline
    covers it)."""
    if pid <= 0:
        return False
    if _IS_WINDOWS:  # os.kill on Windows terminates the process: never use it as a probe
        return _windows_pid_alive(pid)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:  # PermissionError = exists, owned by another user
        return True
    return True


def owner_pid(job_id: str) -> int | None:
    """Pid of the process that created the job (``None`` if the id does not follow
    ``job_<pid>_<hex>``)."""
    match = _ID_RE.match(job_id)
    return int(match.group(1)) if match else None


def _cut(text: str) -> str:
    return text if len(text) <= MESSAGE_CHARS else text[: MESSAGE_CHARS - 1] + "…"


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


def _loads(raw: Any) -> Any:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _step(data: Any) -> T.ProgressStep | None:
    """Stored ``Progress.step`` (dict) → ``ProgressStep``; unexpected shape → ``None``."""
    if isinstance(data, T.ProgressStep):
        return data
    if not isinstance(data, Mapping):
        return None
    try:
        name = T.ThemeStep(data.get("name"))
    except ValueError:
        return None
    return T.ProgressStep(
        name=name, done=_int(data.get("done")) or 0, total=_int(data.get("total"))
    )


def _progress(raw: Any) -> T.Progress | None:
    data = _loads(raw)
    if not isinstance(data, Mapping) or not isinstance(data.get("stage"), str):
        return None
    message = data.get("message")
    return T.Progress(
        stage=data["stage"],
        done=_int(data.get("done")) or 0,
        total=_int(data.get("total")),
        message=message if isinstance(message, str) else None,
        step=_step(data.get("step")),
    )


def _error(raw: Any) -> Mapping[str, str] | None:
    data = _loads(raw)
    if not isinstance(data, Mapping):
        return None
    return {str(k): str(v) for k, v in data.items()}


def _as_progress(value: Any) -> T.Progress:
    if isinstance(value, T.Progress):
        return value
    if isinstance(value, Mapping) and isinstance(value.get("stage"), str):
        return T.Progress(
            stage=value["stage"],
            done=int(value.get("done") or 0),
            total=value.get("total"),
            message=value.get("message"),
            step=_step(value.get("step")),
        )
    raise T.ValidationError("on_progress expects a Progress")


def _cancelled_error() -> dict[str, str]:
    return {"code": T.JOB_CANCELLED_CODE, "message": CANCELLED_MESSAGE}


def _error_of(exc: BaseException) -> dict[str, str]:
    if isinstance(exc, T.Cancelled):
        return _cancelled_error()
    if isinstance(exc, T.TubeError):
        return {"code": exc.code, "message": _cut(exc.message)}
    # The text of an unexpected exception (paths, SQL, provider replies) stays in the log: ``_run``
    # logs it with ``exc_info``. The job, which clients read, gets only the type.
    return {
        "code": "internal",
        "message": _cut(f"Internal error ({type(exc).__name__}); see the Hermes log."),
    }


class _Local:
    """In-memory state of a job with a thread in this runner."""

    def __init__(self, *, event: str | None, session_id: str | None) -> None:
        self.event = event
        self.session_id = session_id
        self.flag = threading.Event()
        """Set by ``cancel`` (shortcut; the source of truth is the database row)."""
        self._announced = False
        self._lock = threading.Lock()

    def take_announcement(self) -> bool:
        """``True`` only once: whoever takes it announces the end (``cancel`` or the thread
        finishing)."""
        with self._lock:
            if self._announced:
                return False
            self._announced = True
            return True


class _JobProgress:
    """``on_progress`` handed to *fn*: writes and announces progress and is a cancellation
    checkpoint (``T.check_cancelled``/``T.is_cancelled`` recognise it by its methods)."""

    def __init__(
        self, runner: SqliteJobRunner, job_id: str, local: _Local, progress_event: str | None
    ) -> None:
        self._runner = runner
        self._job_id = job_id
        self._local = local
        self._event = progress_event

    def is_cancelled(self) -> bool:
        """Cancelled (or closed from outside: orphaned/stalled) — the work no longer counts."""
        if self._local.flag.is_set():
            return True
        row = self._runner.db.query_one("SELECT status FROM jobs WHERE id = ?", (self._job_id,))
        return row is None or row["status"] not in _ACTIVE

    def check_cancelled(self) -> None:
        if self.is_cancelled():
            raise T.Cancelled()

    def __call__(self, progress: T.Progress) -> None:
        if self._local.flag.is_set():
            raise T.Cancelled()
        data = T.to_jsonable(_as_progress(progress))
        runner = self._runner
        res = runner.db.execute(
            "UPDATE jobs SET progress = ?, updated_at = ?"
            " WHERE id = ? AND status IN ('queued', 'running')",
            (_dumps(data), runner.clock.now(), self._job_id),
        )
        if not res.rowcount:
            # closed from outside (cancelled in another instance, stalled, orphaned)
            raise T.Cancelled()
        if self._event:
            runner._emit(
                self._local.session_id, self._event, {"job": self._job_id, "progress": data}
            )


class SqliteJobRunner:
    """``T.JobRunner`` implementation over the ``jobs`` table (see the module docstring)."""

    def __init__(
        self,
        *,
        db: T.Db,
        settings: T.Settings,
        events: T.EventSink,
        clock: T.Clock | None = None,
        max_running: int = MAX_RUNNING,
        stale_after_s: int = STALE_AFTER_S,
        is_alive: Callable[[int], bool] = pid_alive,
    ) -> None:
        self.db = db
        self.settings = settings
        self.events = events
        self.clock = clock or T.SystemClock()
        self.max_running = max_running
        self.stale_after_s = stale_after_s
        self.is_alive = is_alive
        self._slots = threading.BoundedSemaphore(max_running)
        self._lock = threading.Lock()
        self._local: dict[str, _Local] = {}
        """Jobs with a thread in this runner: cancellation mark and event options."""

    # ------------------------------------------------------------------ submit

    def submit(
        self,
        kind: T.JobKind,
        fn: Callable[[T.ProgressFn], Any],
        *,
        event: str | None = None,
        progress_event: str | None = None,
        session_id: str | None = None,
    ) -> T.Job:
        kind = T.JobKind(kind)
        if not self._slots.acquire(blocking=False):
            raise T.Busy(BUSY_MESSAGE.format(n=self.max_running))
        job_id = f"job_{os.getpid()}_{uuid.uuid4().hex[:12]}"
        now = self.clock.now()
        try:
            self.db.execute(
                "INSERT INTO jobs (id, kind, status, session_id, created_at, updated_at)"
                " VALUES (?, ?, 'queued', ?, ?, ?)",
                (job_id, kind.value, session_id, now, now),
            )
        except BaseException:
            self._slots.release()
            raise
        opts = {"event": event, "progress_event": progress_event, "session_id": session_id}
        with self._lock:
            self._local[job_id] = _Local(event=event, session_id=session_id)
        thread = threading.Thread(
            target=contextvars.copy_context().run,
            args=(self._run, job_id, fn, opts),
            name=f"{PLUGIN_ID}-{job_id}",
            daemon=True,
        )
        try:
            thread.start()
        except BaseException as exc:
            self._slots.release()
            with self._lock:
                self._local.pop(job_id, None)
            self._finish(job_id, error={"code": "internal", "message": _cut(str(exc) or "thread")})
            raise
        return T.Job(
            id=job_id, kind=kind, status=T.JobStatus.queued, created_at=now, updated_at=now
        )

    # ------------------------------------------------------------------ job thread

    def _emit(self, session_id: str | None, event: str, payload: dict[str, Any]) -> None:
        try:
            if session_id:
                self.events.emit_to_session(session_id, event, payload)
            else:
                self.events.broadcast(event, payload)
        except Exception:  # noqa: BLE001 — EventSink should not raise; never let it break the job
            logger.debug("event %s failed", event, exc_info=True)

    def _run(self, job_id: str, fn: Callable[[T.ProgressFn], Any], opts: Mapping[str, Any]) -> None:
        session_id = opts.get("session_id")
        with self._lock:
            local = self._local.get(job_id) or _Local(event=None, session_id=session_id)
        try:
            started = self.db.execute(
                "UPDATE jobs SET status = 'running', updated_at = ?"
                " WHERE id = ? AND status = 'queued'",
                (self.clock.now(), job_id),
            )
            if not started.rowcount:
                raise T.Cancelled()  # cancelled (or closed) before starting: fn does not even run
            on_progress = _JobProgress(self, job_id, local, opts.get("progress_event"))
            value = fn(on_progress)
            try:
                result_text = _dumps(T.to_jsonable(value))
            except (TypeError, ValueError) as exc:
                raise T.ValidationError(f"the job result is not JSON serializable ({exc})") from exc
        except BaseException as exc:  # noqa: BLE001 — every error becomes a readable state
            if isinstance(exc, T.Cancelled):
                logger.info("job %s stopped at a cancellation checkpoint", job_id)
            elif not isinstance(exc, Exception):
                logger.warning("job %s interrupted by %s", job_id, type(exc).__name__)
            else:
                logger.info("job %s finished with an error", job_id, exc_info=True)
            closed = self._finish(job_id, error=_error_of(exc))
            status = T.JobStatus.error
        else:
            closed = self._finish(job_id, result_text=result_text)
            status = T.JobStatus.done
        finally:
            self._slots.release()
            with self._lock:
                self._local.pop(job_id, None)
        event = opts.get("event")
        if event and not local.take_announcement():
            return  # ``cancel`` already announced the end
        if event:
            if (
                not closed
            ):  # already closed by a read (stalled/orphaned): report what the database says
                try:
                    current = self.get(job_id)
                except Exception:  # noqa: BLE001 — database closed during shutdown
                    current = None
                status = current.status if current is not None else T.JobStatus.error
            self._emit(session_id, event, {"job": job_id, "status": status.value})

    # ------------------------------------------------------------------ cancel

    def cancel(self, job_id: str) -> T.Job | None:
        job = self.get(str(job_id))
        if job is None or job.status not in (T.JobStatus.queued, T.JobStatus.running):
            return job
        now = self.clock.now()
        res = self.db.execute(
            "UPDATE jobs SET status = ?, error = ?, updated_at = ?, finished_at = ?"
            " WHERE id = ? AND status IN ('queued', 'running')",
            (T.JobStatus.error.value, _dumps(_cancelled_error()), now, now, job.id),
        )
        with self._lock:
            local = self._local.get(job.id)
        if local is not None:
            local.flag.set()
        if res.rowcount:
            logger.info("job %s cancelled", job.id)
            if local is not None and local.event and local.take_announcement():
                payload = {"job": job.id, "status": T.JobStatus.error.value}
                self._emit(local.session_id, local.event, payload)
        return self.get(job.id)

    def _finish(
        self,
        job_id: str,
        *,
        result_text: str | None = None,
        error: Mapping[str, str] | None = None,
    ) -> bool:
        """Closes the job if still active; ``False`` if another path already closed it (no
        resurrection)."""
        now = self.clock.now()
        status = T.JobStatus.error.value if error is not None else T.JobStatus.done.value
        try:
            res = self.db.execute(
                "UPDATE jobs SET status = ?, result = ?, error = ?, updated_at = ?, finished_at = ?"
                " WHERE id = ? AND status IN ('queued', 'running')",
                (
                    status,
                    result_text,
                    _dumps(dict(error)) if error is not None else None,
                    now,
                    now,
                    job_id,
                ),
            )
        except Exception:  # noqa: BLE001 — database closed during shutdown, etc.
            logger.warning("job %s: could not record the end", job_id, exc_info=True)
            return False
        if not res.rowcount:
            logger.info("job %s was already closed; late finish ignored", job_id)
        return bool(res.rowcount)

    # ------------------------------------------------------------------ read

    def _reconcile(self, row: Mapping[str, Any]) -> bool:
        """Closes *row* (active) if its owner died or it stalled. ``True`` if it changed."""
        if row["status"] not in _ACTIVE:
            return False
        pid = owner_pid(row["id"])
        error: dict[str, str] | None = None
        if pid is not None and pid != os.getpid() and not self.is_alive(pid):
            error = {"code": "internal", "message": ORPHAN_MESSAGE}
        elif self.clock.now() - int(row["updated_at"]) > self.stale_after_s:
            minutes = max(1, self.stale_after_s // 60)
            error = {"code": "timeout", "message": STALE_MESSAGE.format(m=minutes)}
        if error is None:
            return False
        logger.warning("job %s closed on read: %s", row["id"], error["code"])
        return self._finish(row["id"], error=error) or True

    def _row_to_job(self, row: Mapping[str, Any]) -> T.Job:
        return T.Job(
            id=row["id"],
            kind=T.JobKind(row["kind"]),
            status=T.JobStatus(row["status"]),
            created_at=int(row["created_at"]),
            updated_at=int(row["updated_at"]),
            progress=_progress(row.get("progress")),
            result=_loads(row.get("result")),
            error=_error(row.get("error")),
        )

    _SELECT = "SELECT id, kind, status, progress, result, error, created_at, updated_at FROM jobs"

    def get(self, job_id: str) -> T.Job | None:
        row = self.db.query_one(f"{self._SELECT} WHERE id = ?", (str(job_id),))
        if row is None:
            return None
        if self._reconcile(row):
            row = self.db.query_one(f"{self._SELECT} WHERE id = ?", (str(job_id),))
            if row is None:
                return None
        return self._row_to_job(row)

    def _active_rows(self) -> list[dict[str, Any]]:
        sql = f"{self._SELECT} WHERE status IN (?, ?) ORDER BY created_at, id"
        rows = self.db.query(sql, _ACTIVE)
        if any([self._reconcile(row) for row in rows]):
            rows = self.db.query(sql, _ACTIVE)
        return rows

    def list_active(self) -> list[T.Job]:
        return [self._row_to_job(row) for row in self._active_rows()]

    def purge(self, older_than: T.Timestamp) -> int:
        self._active_rows()  # orphans are closed first so they get purged eventually too
        marks = ", ".join("?" for _ in _FINISHED)
        res = self.db.execute(
            f"DELETE FROM jobs WHERE status IN ({marks}) AND updated_at < ?",
            (*_FINISHED, int(older_than)),
        )
        return int(res.rowcount or 0)


def build(
    *,
    db: T.Db,
    settings: T.Settings,
    events: T.EventSink,
    clock: T.Clock | None = None,
    **options: Any,
) -> T.JobRunner:
    """``JobRunner`` over *db* (no thread here; each ``submit`` starts its own).

    *options* (tests): ``max_running``, ``stale_after_s``, ``is_alive``."""
    return SqliteJobRunner(db=db, settings=settings, events=events, clock=clock, **options)


__all__ = [
    "CANCELLED_MESSAGE",
    "MAX_RUNNING",
    "STALE_AFTER_S",
    "SqliteJobRunner",
    "build",
    "owner_pid",
    "pid_alive",
]
