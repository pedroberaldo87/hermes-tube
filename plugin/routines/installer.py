"""The real ``RoutinesInstaller``.

- **Shims** in ``<profile>/scripts/<id>-<routine>.py`` (``catalog.shim_text``: 9 lines, standard
  library only; they find the profile from their own path and run
  ``<profile>/plugins/<id>/routines/<script>``). Idempotent write (only rewritten if changed).
- **Jobs** through ``ctx.dispatch_tool("cronjob_manage", …)`` (in process, right profile —
  measured): ``no_agent`` for ``bom-dia``, ``favoritos``, ``faxina-mensal``, ``pasta-novos`` and
  the maintenance scripts; an agent job with a pre-check ``script`` + ``enabled_toolsets=[]`` for
  ``resumo-pasta``. Never passes ``model``/``provider``/``pinned``: the plugin pins no model.
- **Confirmation**: one question through *confirm* (``ctx.ask_choice``); only the exact value
  ``install`` (a real ``str``) installs. ``None``, refusal, label, number, similar text → nothing
  written, no ``create``. Before the answer there are only reads (``cronjob_manage list``).
- **Idempotent**: a job with the same name already exists → skipped; identical shim → untouched.
- **Maintenance**: ``MAINTENANCE_SCRIPTS`` by fixed name; file missing in the installed plugin →
  skipped with a note in the report.
- ``remove(confirm, keys=None)`` (extra, outside the ``Protocol``): same confirmation, deletes the
  jobs by name and the shims.

Profile: ``settings.home`` (resolved in the request context by ``adapters/settings``), or
``hermes_constants.get_hermes_home()`` through ``resolve_home``; never ``os.environ``. Test mode
(``TUBE_DB_PATH``) → no profile → install answers with text and writes nothing outside the test.
Short texts, no tables or markdown (Telegram). ``build`` does no network and starts no thread.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from tube_pkg._id import PLUGIN_ID
from tube_pkg.core import lang as lang_rule
from tube_pkg.core import types as T
from tube_pkg.routines.catalog import (
    BY_KEY,
    DIGEST_PROMPT,
    MAINTENANCE,
    ROUTINES,
    UNTRUSTED_CLOSE,
    UNTRUSTED_OPEN,
    MaintenanceSpec,
    RoutineSpec,
    job_name,
    shim_name,
    shim_text,
)

logger = logging.getLogger(__name__)

CRON_TOOL = "cronjob_manage"
INSTALL = "install"
REMOVE = "remove"
CANCEL = "cancel"
DELIVER = "origin"
"""The chat where ``/tube rotinas`` was typed (Telegram); failures go there too."""

QUESTION_MAX = 500
_RESOLVE: Any = object()

_TEXT: dict[str, dict[str, str]] = {
    "pt": {
        "cron_unreadable": "Não consegui ler as rotinas do Hermes (cron). Nada feito.",
        "cancel": "Cancelar",
        "install": "Instalar",
        "remove": "Remover",
        "nothing_installed": "Nada instalado.",
        "nothing_removed": "Nada removido.",
        "none_installed": "Nenhuma rotina instalada.",
        "failed": "Falhou: {items}.",
        "remove_q": (
            "Remover {n} rotina(s) do YouTube neste perfil: {keys}? "
            "Os jobs saem do cron e os scripts são apagados."
        ),
        "remove_failed": "falha ao remover o job",
        "unknown": "rotinas desconhecidas: {keys}",
        "no_home": "Perfil do Hermes não encontrado; instale as rotinas pelo chat do Hermes.",
        "no_dispatch": "Rotinas só se instalam pelo chat do Hermes (/tube rotinas).",
        "no_plugin": "O plugin não está em {path}; as rotinas precisam dele instalado no perfil.",
        "install_q": "Instalar {n} rotina(s) do YouTube neste perfil?",
        "uses_model": "usa o modelo só com novidade",
        "no_ai": "sem IA",
        "maintenance": "+ manutenção diária às 04:00, sem IA",
        "install_tail": (
            "Avisos vêm nesta conversa; sem novidade, silêncio. Nada é cancelado sozinho."
        ),
        "shim_failed": "não gravei o script: {err}",
        "cron_refused": "o cron recusou",
        "missing": "Manutenção ({names}) ainda não existe neste plugin: pulei.",
    },
    "en": {
        "cron_unreadable": "Could not read the Hermes routines (cron). Nothing done.",
        "cancel": "Cancel",
        "install": "Install",
        "remove": "Remove",
        "nothing_installed": "Nothing installed.",
        "nothing_removed": "Nothing removed.",
        "none_installed": "No routines installed.",
        "failed": "Failed: {items}.",
        "remove_q": (
            "Remove {n} YouTube routine(s) from this profile: {keys}? "
            "The jobs leave the cron and the scripts are deleted."
        ),
        "remove_failed": "could not remove the job",
        "unknown": "unknown routines: {keys}",
        "no_home": "Hermes profile not found; install the routines from the Hermes chat.",
        "no_dispatch": "Routines can only be installed from the Hermes chat (/tube routines).",
        "no_plugin": "The plugin is not in {path}; the routines need it installed in the profile.",
        "install_q": "Install {n} YouTube routine(s) in this profile?",
        "uses_model": "uses the model only when there is news",
        "no_ai": "no AI",
        "maintenance": "+ daily maintenance at 04:00, no AI",
        "install_tail": (
            "Messages arrive in this chat; no news, no message. Nothing is cancelled on its own."
        ),
        "shim_failed": "could not write the script: {err}",
        "cron_refused": "the cron refused it",
        "missing": "Maintenance ({names}) does not exist in this plugin yet: skipped.",
    },
}


class RoutinesInstaller:
    """``T.RoutinesInstaller`` implementation (see the module docstring)."""

    def __init__(self, *, settings: T.Settings, ctx: Any, home: Path | None) -> None:
        self.settings = settings
        self.ctx = ctx
        self.home = home

    # ------------------------------------------------------------------ Protocol

    def list(self, *, lang: str | None = None) -> list[T.RoutineInfo]:
        jobs = self._jobs() if self._can_dispatch() else None
        code = self._lang(lang)
        out: list[T.RoutineInfo] = []
        for spec in ROUTINES:
            out.append(
                T.RoutineInfo(
                    key=spec.key,
                    kind=spec.kind,
                    schedule=spec.schedule,
                    description=spec.text(code)[2],
                    installed=self._installed(spec.key, jobs),
                )
            )
        return out

    def install(
        self,
        confirm: T.AskChoice,
        keys: Sequence[str] | None = None,
        *,
        lang: str | None = None,
    ) -> T.InstallReport:
        """*lang*: language of the question, buttons and message (``None`` = the ``core/lang``
        rule over the settings)."""
        code = self._lang(lang)
        wanted = self._wanted(keys, code)
        blocker = self._blocker(code)
        if blocker:
            return T.InstallReport(message=blocker)
        jobs = self._jobs()
        if jobs is None:
            return T.InstallReport(message=_t(code, "cron_unreadable"))
        maint = [m for m in MAINTENANCE if job_name(m.key) not in jobs]
        missing = [m for m in maint if not (self._plugin_dir() / "routines" / m.script).is_file()]
        maint = [m for m in maint if m not in missing]
        todo = [s for s in wanted if not self._installed(s.key, jobs)]
        skipped = tuple(s.key for s in wanted if s not in todo)
        if not todo and not maint:
            return T.InstallReport(skipped=skipped, message=self._missing_note(missing, code))

        question = self._install_question(todo, maint, code)
        choices = [
            {"value": CANCEL, "label": _t(code, "cancel")},
            {"value": INSTALL, "label": _t(code, "install")},
        ]
        if not _exact(self._ask(confirm, question, choices), INSTALL):
            return T.InstallReport(
                cancelled=True, skipped=skipped, message=_t(code, "nothing_installed")
            )

        installed: list[str] = []
        problems: list[str] = []
        for spec in todo:
            err = self._install_one(spec.key, spec.script, self._job_args(spec), jobs, code)
            if err:
                problems.append(f"{spec.key}: {err}")
            else:
                installed.append(spec.key)
        for m in maint:
            err = self._install_one(m.key, m.script, self._maintenance_args(m), jobs, code)
            if err:
                problems.append(f"{m.key}: {err}")
        notes = []
        if problems:
            notes.append(_t(code, "failed", items="; ".join(problems)))
        note = self._missing_note(missing, code)
        if note:
            notes.append(note)
        # the model hint for agent routines is the /tube command's own line (plain ASCII there)
        return T.InstallReport(
            installed=tuple(installed),
            skipped=skipped,
            message=" ".join(notes)[:400],
        )

    # ------------------------------------------------------------------ extra: remove

    def remove(
        self,
        confirm: T.AskChoice,
        keys: Sequence[str] | None = None,
        *,
        lang: str | None = None,
    ) -> T.InstallReport:
        """Turn routines off (jobs by name + shims), with the same confirmation. Without *keys*:
        all of them, including maintenance. Returns the removed ones in ``installed``."""
        code = self._lang(lang)
        wanted = self._wanted(keys, code)
        names = [s.key for s in wanted] + ([m.key for m in MAINTENANCE] if keys is None else [])
        blocker = self._blocker(code)
        if blocker:
            return T.InstallReport(message=blocker)
        jobs = self._jobs()
        if jobs is None:
            return T.InstallReport(message=_t(code, "cron_unreadable"))
        present = [k for k in names if job_name(k) in jobs or self._shim(k).exists()]
        if not present:
            return T.InstallReport(message=_t(code, "none_installed"))
        question = _clip(
            _t(code, "remove_q", n=len(present), keys=", ".join(present)), QUESTION_MAX
        )
        choices = [
            {"value": CANCEL, "label": _t(code, "cancel")},
            {"value": REMOVE, "label": _t(code, "remove")},
        ]
        if not _exact(self._ask(confirm, question, choices), REMOVE):
            return T.InstallReport(cancelled=True, message=_t(code, "nothing_removed"))
        removed: list[str] = []
        problems: list[str] = []
        for key in present:
            err = None
            for job_id in jobs.get(job_name(key), ()):
                res = self._dispatch({"action": "remove", "job_id": job_id})
                if not res.get("success"):
                    err = _short(res.get("error") or _t(code, "remove_failed"))
            try:
                self._shim(key).unlink(missing_ok=True)
            except OSError as exc:
                err = err or _short(str(exc))
            if err:
                problems.append(f"{key}: {err}")
            else:
                removed.append(key)
        msg = _t(code, "failed", items="; ".join(problems)) if problems else ""
        return T.InstallReport(installed=tuple(removed), message=msg[:400])

    # ------------------------------------------------------------------ internals

    def _lang(self, lang: str | None) -> str:
        return lang_rule.normalize(lang) or lang_rule.resolve(self.settings)

    def _wanted(self, keys: Sequence[str] | None, code: str = lang_rule.EN) -> list[RoutineSpec]:
        if keys is None:
            return list(ROUTINES)
        unknown = [k for k in keys if k not in BY_KEY]
        if unknown:
            raise T.ValidationError(_t(code, "unknown", keys=", ".join(map(str, unknown))))
        chosen = set(keys)
        return [s for s in ROUTINES if s.key in chosen]

    def _can_dispatch(self) -> bool:
        return self.ctx is not None and callable(getattr(self.ctx, "dispatch_tool", None))

    def _blocker(self, code: str = lang_rule.EN) -> str | None:
        if self.home is None:
            return _t(code, "no_home")
        if not self._can_dispatch():
            return _t(code, "no_dispatch")
        if not (self._plugin_dir() / "_bootstrap.py").is_file():
            return _t(code, "no_plugin", path=self._plugin_dir())
        return None

    def _plugin_dir(self) -> Path:
        assert self.home is not None
        return self.home / "plugins" / PLUGIN_ID

    def _shim(self, key: str) -> Path:
        assert self.home is not None
        return self.home / "scripts" / shim_name(key)

    def _installed(self, key: str, jobs: dict[str, list[str]] | None) -> bool:
        if self.home is None or not self._shim(key).is_file():
            return False
        return jobs is None or job_name(key) in jobs

    def _dispatch(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            raw = self.ctx.dispatch_tool(CRON_TOOL, args)
        except Exception as exc:  # noqa: BLE001 — a host error becomes text
            logger.warning(
                "%s: cronjob_manage %s failed", PLUGIN_ID, args.get("action"), exc_info=True
            )
            return {"success": False, "error": f"{type(exc).__name__}: {exc}"}
        if isinstance(raw, dict):
            return raw
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return {"success": False, "error": _short(str(raw))}
        return data if isinstance(data, dict) else {"success": False, "error": _short(str(data))}

    def _jobs(self) -> dict[str, list[str]] | None:
        """Job name → ids (only the plugin's). ``None`` = the cron could not be read."""
        if not self._can_dispatch():
            return None
        res = self._dispatch({"action": "list"})  # the handler already includes paused ones
        if res.get("success") is False or not isinstance(res.get("jobs"), list):
            return None  # error, missing tool or answer without a list: unknown what exists
        out: dict[str, list[str]] = {}
        for job in res.get("jobs") or []:
            if not isinstance(job, dict):
                continue
            name = str(job.get("name") or "")
            jid = str(job.get("job_id") or job.get("id") or "")
            if name.startswith(f"{PLUGIN_ID}-") and jid:
                out.setdefault(name, []).append(jid)
        return out

    def _ask(self, confirm: T.AskChoice, question: str, choices: list[dict[str, str]]) -> Any:
        try:
            return confirm(question, choices)
        except Exception:  # noqa: BLE001 — no valid answer = refusal
            logger.warning("%s: routines confirmation failed", PLUGIN_ID, exc_info=True)
            return None

    def _install_question(
        self, todo: list[RoutineSpec], maint: list[MaintenanceSpec], code: str
    ) -> str:
        lines = [_t(code, "install_q", n=len(todo))]
        for spec in todo:
            cost = _t(code, "uses_model" if spec.kind is T.RoutineKind.agent else "no_ai")
            title, when, _ = spec.text(code)
            lines.append(f"- {spec.key} ({title}): {when}, {cost}")
        if maint:
            lines.append(_t(code, "maintenance"))
        lines.append(_t(code, "install_tail"))
        return _clip("\n".join(lines), QUESTION_MAX)

    def _job_args(self, spec: RoutineSpec) -> dict[str, Any]:
        args: dict[str, Any] = {
            "action": "create",
            "name": job_name(spec.key),
            "schedule": spec.schedule,
            "script": shim_name(spec.key),
            "deliver": DELIVER,
        }
        if spec.kind is T.RoutineKind.no_agent:
            args["no_agent"] = True
        else:
            args["prompt"] = DIGEST_PROMPT
            args["enabled_toolsets"] = []
        return args

    def _maintenance_args(self, m: MaintenanceSpec) -> dict[str, Any]:
        return {
            "action": "create",
            "name": job_name(m.key),
            "schedule": m.schedule,
            "script": shim_name(m.key),
            "deliver": DELIVER,
            "no_agent": True,
        }

    def _install_one(
        self,
        key: str,
        script: str,
        args: dict[str, Any],
        jobs: dict[str, list[str]],
        code: str = lang_rule.EN,
    ) -> str | None:
        try:
            self._write_shim(key, script)
        except OSError as exc:
            return _short(_t(code, "shim_failed", err=exc))
        if job_name(key) in jobs:
            return None
        res = self._dispatch(args)
        if not res.get("success"):
            return _short(str(res.get("error") or _t(code, "cron_refused")))
        jobs.setdefault(job_name(key), []).append(str(res.get("job_id") or ""))
        return None

    def _write_shim(self, key: str, script: str) -> None:
        target = self._shim(key)
        text = shim_text(script)
        if target.is_file() and target.read_text(encoding="utf-8") == text:
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f".{target.name}.tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, target)

    @staticmethod
    def _missing_note(missing: list[MaintenanceSpec], code: str = lang_rule.EN) -> str:
        if not missing:
            return ""
        return _t(code, "missing", names=", ".join(m.script for m in missing))


def _t(lang: str, key: str, **kw: Any) -> str:
    text = _TEXT[lang_rule.short(lang)][key]
    return text.format(**kw) if kw else text


def _exact(answer: Any, value: str) -> bool:
    """Only a plain ``str`` identical to the value (subclass, label, number, case → no)."""
    return type(answer) is str and answer == value


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _short(text: str, limit: int = 120) -> str:
    return _clip(" ".join(str(text).split()), limit)


def _home_from(settings: T.Settings) -> Path | None:
    home = getattr(settings, "home", None)
    if isinstance(home, (str, os.PathLike)):
        return Path(home)
    from tube_pkg.adapters.settings import resolve_home

    return resolve_home()


def build(
    *,
    settings: T.Settings,
    ctx: Any,
    clock: T.Clock | None = None,
    home: str | os.PathLike[str] | None = _RESOLVE,
) -> T.RoutinesInstaller:
    """Installer of the active profile. *home* missing → ``settings.home`` or ``resolve_home()``
    now (request context). ``home=None`` → no profile (list only). No network, no threads."""
    del clock
    resolved = _home_from(settings) if home is _RESOLVE else (Path(home) if home else None)
    return RoutinesInstaller(settings=settings, ctx=ctx, home=resolved)


__all__ = [
    "CRON_TOOL",
    "DIGEST_PROMPT",
    "MAINTENANCE",
    "ROUTINES",
    "UNTRUSTED_CLOSE",
    "UNTRUSTED_OPEN",
    "RoutinesInstaller",
    "build",
    "job_name",
    "shim_name",
]
