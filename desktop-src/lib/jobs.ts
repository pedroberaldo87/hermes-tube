// Long-running jobs (AI): the RPC returns `{job}` in < 1 s; the screen follows it through `GET /jobs/{id}` every
// 2 s (JOB_POLL_MS) while `queued`/`running` — mandatory — and job events only bring it forward.
// Theme built in the background: the job the theme dialog started lives in `ctx.storage` (THEME_PENDING_KEY), so
// closing the dialog or reloading the screen never loses it; `useThemeBuild` (Home) follows it and reports the end.
import { atom, useValue } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiStatus, ApiError, Job, Progress, RpcMethodName, RpcMethods, ThemeCreateParams, TubeEventName } from '../../shared/api-types'
import { JOB_POLL_MS, MESSAGE_KEYS } from '../../shared/ids'
import { maybePluginContext } from './ctx'
import { $dialogStack } from './dialogs'
import { useTubeEvents } from './events'
import { onShellReset } from './lifecycle'
import { TubeApiError, invalidateRestExact, restCall, useRest } from './rest'
import { callRpc } from './rpc'

/** Job finish/progress events (payload with `job`). */
export const JOB_EVENTS = ['organize.done', 'theme.progress', 'theme.ready', 'lists.ready', 'cleanup.scanned'] as const satisfies readonly TubeEventName[]

export function isJobActive(job: Pick<Job, 'status'> | null | undefined): boolean {
  return !!job && (job.status === 'queued' || job.status === 'running')
}

/** Poll interval: active (or no response yet) → 2 s; finished or contract error → stops. */
export function jobPollInterval(job: Job | undefined, error: unknown): number | false {
  if (error instanceof TubeApiError && !error.transport) return false
  if (!job) return JOB_POLL_MS
  return isJobActive(job) ? JOB_POLL_MS : false
}

/** Follows a job by id. Events with `payload.job === id` bring the query forward. */
export function useJob(jobId: string | null | undefined, events: readonly TubeEventName[] = JOB_EVENTS) {
  const id = jobId ?? ''
  const query = useRest('GET /jobs/{id}', { path: { id } }, { enabled: !!jobId, refetchInterval: jobPollInterval })
  useTubeEvents(
    events,
    (_name, payload) => {
      const p = payload as { job?: unknown } | undefined
      if (jobId && p && p.job === jobId) void invalidateRestExact('GET /jobs/{id}', { path: { id: jobId } })
    },
    !!jobId
  )
  return query
}

// ------------------------------------------------------------------ RPC + job

/** RPC methods with `kind: job`. */
export type JobMethodName = {
  [K in RpcMethodName]: RpcMethods[K]['kind'] extends 'job' ? K : never
}[RpcMethodName]

export type JobPhase = 'idle' | 'starting' | 'running' | 'done' | 'error' | 'unavailable'

export interface RpcJobState<N extends JobMethodName> {
  phase: JobPhase
  jobId: string | null
  job: Job | null
  progress: Progress | null
  /** `Job.result` when `done` (shape = the method's `job_result`). */
  result: RpcMethods[N]['jobResult'] | null
  error: ApiError | null
  /** With `phase: 'unavailable'`: i18n key in `common` (`open_desktop_backend`). */
  messageKey: typeof MESSAGE_KEYS.openDesktopBackend | null
  start: (params: RpcMethods[N]['params']) => Promise<void>
  /** Resumes an existing job (e.g. a `jobId` coming from the dialog props). */
  resume: (jobId: string) => void
  reset: () => void
}

interface Local {
  phase: 'idle' | 'starting' | 'tracking' | 'error' | 'unavailable'
  jobId: string | null
  error: ApiError | null
}

const IDLE: Local = { phase: 'idle', jobId: null, error: null }

/**
 * Fires an RPC method with `kind: job` and follows the job to the end:
 * `start(params)` → `starting` → `running` (2 s poll + events) → `done` | `error`;
 * no RPC on this backend → `unavailable` (show `<RpcUnavailableNotice/>`).
 */
export function useRpcJob<N extends JobMethodName>(name: N, initialJobId?: string | null): RpcJobState<N> {
  const [local, setLocal] = useState<Local>(
    initialJobId ? { phase: 'tracking', jobId: initialJobId, error: null } : IDLE
  )
  const query = useJob(local.phase === 'tracking' ? local.jobId : null)
  const job = (query.data as Job | undefined) ?? null

  const start = useCallback(
    async (params: RpcMethods[N]['params']) => {
      setLocal({ phase: 'starting', jobId: null, error: null })
      const out = await callRpc(name, params as never)
      if (out.kind === 'ok') {
        const accepted = out.data as { job?: Job }
        if (accepted?.job?.id) setLocal({ phase: 'tracking', jobId: accepted.job.id, error: null })
        else setLocal({ phase: 'error', jobId: null, error: { code: 'internal', message: 'RPC returned no job' } })
      } else if (out.kind === 'error') setLocal({ phase: 'error', jobId: null, error: out.error })
      else setLocal({ phase: 'unavailable', jobId: null, error: null })
    },
    [name]
  )
  const resume = useCallback((jobId: string) => setLocal({ phase: 'tracking', jobId, error: null }), [])
  const reset = useCallback(() => setLocal(IDLE), [])

  useEffect(() => {
    if (initialJobId) resume(initialJobId)
  }, [initialJobId, resume])

  return useMemo<RpcJobState<N>>(() => {
    const base = {
      jobId: local.jobId,
      job: local.phase === 'tracking' ? job : null,
      progress: local.phase === 'tracking' ? (job?.progress ?? null) : null,
      result: null,
      error: local.error,
      messageKey: null,
      start,
      resume,
      reset
    }
    if (local.phase === 'unavailable') return { ...base, phase: 'unavailable', messageKey: MESSAGE_KEYS.openDesktopBackend }
    if (local.phase !== 'tracking') return { ...base, phase: local.phase }
    if (query.error && !(query.error instanceof TubeApiError && query.error.transport)) {
      return { ...base, phase: 'error', error: toError(query.error) }
    }
    if (!job || isJobActive(job)) return { ...base, phase: 'running' }
    if (job.status === 'done') return { ...base, phase: 'done', result: job.result as RpcMethods[N]['jobResult'] }
    const err = job.error ?? {}
    return {
      ...base,
      phase: 'error',
      error: { code: (err.code as ApiError['code']) ?? 'internal', message: err.message ?? 'job failed' }
    }
  }, [local, job, query.error, start, resume, reset])
}

function toError(error: unknown): ApiError {
  return error instanceof TubeApiError ? error.toApiError() : { code: 'internal', message: String(error) }
}

/** `Job.error` as an `ApiError` (a job closed by `job.cancel` has `code: 'cancelled'`). */
export function jobError(job: Pick<Job, 'error'>): ApiError {
  const err = job.error ?? {}
  return { code: (err.code as ApiError['code']) ?? 'internal', message: err.message ?? 'job failed' }
}

// ------------------------------------------------------------------ clock

/** `Date.now()`, refreshed every `ms` while `enabled` (elapsed time on screen). */
export function useNowTicker(enabled: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [enabled, ms])
  return now
}

/** Elapsed time as a clock: `0:07`, `2:41`, `1:02:03`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// ------------------------------------------------------------------ is there an AI model?

/** After this with no answer, `GET /ai/status` counts as "unknown" (a late answer is ignored). */
export const AI_STATUS_DEADLINE_MS = 4_000

function isAiStatus(value: unknown): value is AiStatus {
  return !!value && typeof value === 'object' && typeof (value as AiStatus).available === 'boolean'
}

/**
 * `GET /ai/status` before the click. TOLERANT: a route that fails, is slow or answers 404 (plugin host without the
 * route until Hermes restarts) = "unknown" (`null`): nothing is blocked. Only an explicit `available: false` warns.
 */
export function useAiStatus(enabled = true): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const deadline = setTimeout(() => {
      alive = false
    }, AI_STATUS_DEADLINE_MS)
    restCall('GET /ai/status').then(
      (data) => {
        if (alive && isAiStatus(data)) setStatus(data)
      },
      () => undefined // 404, network, error envelope: "unknown"
    )
    return () => {
      alive = false
      clearTimeout(deadline)
    }
  }, [enabled])
  return status
}

// ------------------------------------------------------------------ theme built in the background

/** `ctx.storage` key of the theme job being built (the theme dialog writes it; Home reads it). */
export const THEME_PENDING_KEY = 'theme.pending'
/** Previews without a tab expire in 7 days in the core; the stored job does too. */
export const THEME_PENDING_MAX_AGE_MS = 7 * 86_400_000

/** Numbers each step of a theme produced (read from progress; never invented). */
export interface ThemeStageCounts {
  /** Searches planned in the expansion. */
  searches?: number
  /** Videos found (curation candidates). */
  found?: number
  /** Videos the AI has evaluated so far. */
  rated?: number
  /** Videos kept in the preview. */
  kept?: number
}

export interface ThemePending {
  jobId: string
  /** The user's text (without hints). */
  query: string
  /** When the request went out (ms): the elapsed time counts from here. */
  at: number
  counts?: ThemeStageCounts
  /** The exact request ("Try again" repeats it). */
  params?: ThemeCreateParams
  /** The end of this job was already shown (preview on screen or notice given): no new notice. */
  seen?: boolean
}

/** Bumped on every write: whoever reads the stored job re-reads it. */
const $themePendingRev = atom(0)

function themeStorage() {
  try {
    return maybePluginContext()?.storage ?? null
  } catch {
    return null
  }
}

export function readThemePending(now = Date.now()): ThemePending | null {
  try {
    const v = themeStorage()?.get<unknown>(THEME_PENDING_KEY, null) as Partial<ThemePending> | null
    if (!v || typeof v !== 'object' || typeof v.jobId !== 'string' || !v.jobId) return null
    if (typeof v.at !== 'number' || now - v.at > THEME_PENDING_MAX_AGE_MS) return null
    return {
      jobId: v.jobId,
      query: typeof v.query === 'string' ? v.query : '',
      at: v.at,
      counts: v.counts && typeof v.counts === 'object' ? v.counts : undefined,
      params: v.params && typeof v.params === 'object' && typeof v.params.query === 'string' ? v.params : undefined,
      seen: v.seen === true ? true : undefined
    }
  } catch {
    return null
  }
}

export function writeThemePending(p: ThemePending): void {
  try {
    themeStorage()?.set(THEME_PENDING_KEY, p)
  } catch {
    // no storage: following it only holds for this opening
  }
  $themePendingRev.set($themePendingRev.get() + 1)
}

export function clearThemePending(): void {
  try {
    themeStorage()?.remove(THEME_PENDING_KEY)
  } catch {
    // same
  }
  $themePendingRev.set($themePendingRev.get() + 1)
}

/** A theme being built right now (Home's notice in the tab strip). */
export interface ThemeBuild {
  jobId: string
  /** The user's text; `''` when the job did not start on this screen (name unknown). */
  query: string
  /** Start (ms): when the request went out, or the job's `created_at`. */
  startedAt: number
  progress: Progress | null
}

/** How a background build ended (Home turns it into a notice). Cancelled ends say nothing. */
export type ThemeBuildEnd =
  | { kind: 'ready'; jobId: string; query: string }
  | { kind: 'failed'; jobId: string; query: string; error: ApiError; params: ThemeCreateParams | null }

/** Ends already announced (two Homes mounted, remounts): one notice per job. */
const announced = new Set<string>()
onShellReset(() => announced.clear())

/**
 * Follows the theme job built in the background: the stored one (the dialog closed or the screen reloaded) or,
 * if none, the one the server says is active (`GET /jobs?kind=theme`, one theme at a time). Returns it while it
 * runs; when it ends, calls `onEnd` once — unless the theme dialog is open (it shows the end itself).
 */
export function useThemeBuild(onEnd?: (end: ThemeBuildEnd) => void): ThemeBuild | null {
  const rev = useValue($themePendingRev)
  // `rev` changes on every write of the stored job
  const pending = useMemo(() => readThemePending(), [rev])
  const activeQ = useRest('GET /jobs', { query: { kind: 'theme' } })
  const active = ((activeQ.data as { items?: Job[] } | undefined)?.items ?? []).find((j) => isJobActive(j)) ?? null
  const trackedId = pending && !pending.seen ? pending.jobId : (active?.id ?? null)
  const jobQ = useJob(trackedId)
  const polled = (jobQ.data as Job | undefined) ?? null
  const job = polled && polled.id === trackedId ? polled : active && active.id === trackedId ? active : null
  const endRef = useRef(onEnd)
  endRef.current = onEnd

  const gone = jobQ.error instanceof TubeApiError && !jobQ.error.transport
  useEffect(() => {
    if (!trackedId) return
    const mine = pending?.jobId === trackedId ? pending : null
    if (gone) {
      // the job no longer exists (purged): nothing to say, nothing to follow
      if (mine) writeThemePending({ ...mine, seen: true })
      return
    }
    if (!job || isJobActive(job) || announced.has(job.id)) return
    announced.add(job.id)
    const dialogOpen = $dialogStack.get().some((d) => d.id === 'theme')
    const query = mine?.query ?? ''
    if (job.status === 'done') {
      if (mine) writeThemePending({ ...mine, seen: true }) // reopening the dialog still shows the preview
      if (!dialogOpen) endRef.current?.({ kind: 'ready', jobId: job.id, query })
      return
    }
    const error = jobError(job)
    if (mine) clearThemePending() // failed or cancelled: the dialog starts fresh
    if (!dialogOpen && (error.code as string) !== 'cancelled') endRef.current?.({ kind: 'failed', jobId: job.id, query, error, params: mine?.params ?? null })
  }, [trackedId, job, gone, pending])

  if (!trackedId || !job || !isJobActive(job)) return null
  const mine = pending?.jobId === job.id ? pending : null
  return {
    jobId: job.id,
    query: mine?.query ?? '',
    startedAt: mine?.at ?? job.created_at * 1000,
    progress: job.progress ?? null
  }
}

/**
 * "Try again" after a background failure: the same request (`theme.create`); accepted → stored and followed
 * again. Refused (busy, no model, no RPC…) → `false`: the caller opens the dialog, which explains it.
 */
export async function retryThemeBuild(params: ThemeCreateParams, query: string): Promise<boolean> {
  const out = await callRpc('theme.create', params).catch(() => null)
  const id = out && out.kind === 'ok' ? out.data?.job?.id : null
  if (!id) return false
  writeThemePending({ jobId: id, query, at: Date.now(), counts: {}, params })
  void invalidateRestExact('GET /jobs', { query: { kind: 'theme' } })
  return true
}
