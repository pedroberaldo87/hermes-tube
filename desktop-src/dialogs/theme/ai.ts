// What the AI dialogs get from the backend, the way the screen uses it:
//   useAiStatus  — "is there a model?" before the click (GET /ai/status). TOLERANT: a route that fails, is slow or answers
//                  404 (plugin host without the route until Hermes restarts) = "unknown" (`null`):
//                  the screen opens normally, with no warning and no blocking. Only an explicit `available: false` warns.
//   cancelJob    — really cancel (`job.cancel`). A gateway without the method = 'failed':
//                  the screen warns and keeps following; it never hangs.
//   isCancelled  — a cancelled job is `status: error` + `error.code: 'cancelled'`: not an error to show.
//   useAiProblem — which "AI unavailable" case an `llm_unavailable` is: no model, a configured provider that cannot be
//                  reached, or another failure (the error itself).
// Sibling copy of dialogs/organize/ai.ts (a screen does not import another one).
import { useEffect, useState } from 'react'
import type { AiStatus, ApiError, Job } from '../../../shared/api-types'
import { PLUGIN_ID } from '../../../shared/ids'
import { AI_STATUS_DEADLINE_MS } from '../../lib/jobs'
import { invalidateRestExact, restCall } from '../../lib/rest'
import { callRpc } from '../../lib/rpc'

/** `error.code` of a job cancelled by `job.cancel` (`T.JOB_CANCELLED_CODE`). */
export const JOB_CANCELLED_CODE = 'cancelled'
/** Error (from a job or the contract) that only says "it was cancelled". */
export function isCancelledError(error: { code?: string } | null | undefined): boolean {
  return (error?.code as string | undefined) === JOB_CANCELLED_CODE
}

export function isJobCancelled(job: Pick<Job, 'status' | 'error'> | null | undefined): boolean {
  return !!job && job.status === 'error' && isCancelledError(job.error)
}

/** `GET /ai/status` before the click (shared with Home's "New theme" button: lib/jobs). */
export { AI_STATUS_DEADLINE_MS, useAiStatus } from '../../lib/jobs'

function isAiStatus(value: unknown): value is AiStatus {
  return !!value && typeof value === 'object' && typeof (value as AiStatus).available === 'boolean'
}

/** Settings → Model → Auxiliary models, already on the plugin task's row (the Desktop's `aux` deep link; mirror of
 * `wiring.CURATOR_TASK`, derived from the id). */
export function modelSettingsPath(): string {
  return `/settings?tab=config:model&aux=${encodeURIComponent(`${PLUGIN_ID.replace(/-/g, '_')}_curator`)}`
}

// ------------------------------------------------------------------ which "AI unavailable" case

/** `AiStatus.reason` / `details.reason` of an `llm_unavailable` (`T.AI_STATUS_REASONS`). */
export const NO_MODEL_REASON = 'no_model'
export const PROVIDER_UNAVAILABLE_REASON = 'provider_unavailable'
/** Cut for the provider and the model on screen (same as the backend's message). */
const ROUTE_PART_CHARS = 80

/**
 * What to tell the person: nothing configured (`no_model`), a configured model whose provider refused the sign-in or is
 * unavailable (`provider_unavailable`, with `provider · model` when known), or another failure (`other`: the error itself).
 */
export type AiProblem = { kind: 'no_model' } | { kind: 'provider_unavailable'; route: string } | { kind: 'other' }

function routePart(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim()
  // a local model may be configured by path: only its file name goes on screen
  if (/^([/~\\]|[A-Za-z]:[\\/])/.test(text)) text = text.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return text.length <= ROUTE_PART_CHARS ? text : `${text.slice(0, ROUTE_PART_CHARS - 1)}…`
}

/** `provider · model` (either may be missing; `''` = neither). */
export function providerRoute(provider: unknown, model: unknown): string {
  return [routePart(provider), routePart(model)].filter(Boolean).join(' · ')
}

/** Before the click: the explicit `available: false` of `GET /ai/status`; `null` = available or unknown. */
export function statusProblem(status: AiStatus | null): AiProblem | null {
  if (!status || status.available !== false) return null
  if (status.reason === PROVIDER_UNAVAILABLE_REASON) return { kind: 'provider_unavailable', route: providerRoute(status.provider, status.model) }
  return { kind: 'no_model' }
}

type AiError = Pick<ApiError, 'code'> & { reason?: string; details?: Record<string, unknown> }

/**
 * After an `llm_unavailable`: the error's own reason (`reason` / `details.reason`, from the RPC envelope) wins; a job error
 * only carries `code`/`message`, so then the status read right after the failure decides (the backend keeps
 * `provider_unavailable` there for a while). `null` = not an AI error, or the status must be read.
 */
export function errorProblem(error: AiError | null | undefined): AiProblem | null {
  if (!error || error.code !== 'llm_unavailable') return null
  const details = error.details && typeof error.details === 'object' ? error.details : {}
  const reason = error.reason ?? details.reason
  if (reason === PROVIDER_UNAVAILABLE_REASON) return { kind: 'provider_unavailable', route: providerRoute(details.provider, details.model) }
  if (reason === NO_MODEL_REASON) return { kind: 'no_model' }
  return null
}

/** Status read after a failure without a reason: available = another failure; unknown/no route = "no model" (as before). */
function afterFailure(status: AiStatus | null): AiProblem {
  if (status?.available === true) return { kind: 'other' }
  return statusProblem(status) ?? { kind: 'no_model' }
}

/**
 * `AiProblem` of *error* (see `errorProblem`); reads `GET /ai/status` once per error when the error alone cannot tell.
 * `pending` while that read is in flight (≤ `AI_STATUS_DEADLINE_MS`): the screen shows neither message yet.
 */
export function useAiProblem(error: AiError | null | undefined): { problem: AiProblem | null; pending: boolean } {
  const direct = errorProblem(error)
  const needsStatus = !!error && error.code === 'llm_unavailable' && !direct
  const [read, setRead] = useState<{ error: unknown; problem: AiProblem } | null>(null)
  useEffect(() => {
    if (!needsStatus) return undefined
    let alive = true
    const settle = (status: AiStatus | null) => {
      if (!alive) return
      alive = false
      setRead({ error, problem: afterFailure(status) })
    }
    const deadline = setTimeout(() => settle(null), AI_STATUS_DEADLINE_MS)
    restCall('GET /ai/status').then(
      (data) => settle(isAiStatus(data) ? data : null),
      () => settle(null)
    )
    return () => {
      alive = false
      clearTimeout(deadline)
    }
  }, [error, needsStatus])
  if (!error || error.code !== 'llm_unavailable') return { problem: null, pending: false }
  if (direct) return { problem: direct, pending: false }
  if (read && read.error === error) return { problem: read.problem, pending: false }
  return { problem: null, pending: true }
}


/**
 * Requests `job.cancel`. `cancelled` = the job was closed (or no longer exists): the screen goes back to the start.
 * `finished` = it had already finished before the request (the screen carries on and shows the result). `failed` = it did not work
 * (gateway without the method, error): the job finishes on its own and the screen keeps following.
 */
export type CancelOutcome = 'cancelled' | 'finished' | 'failed'

export async function cancelJob(jobId: string): Promise<CancelOutcome> {
  const out = await callRpc('job.cancel', { job_id: jobId }).catch(() => null)
  if (!out || out.kind !== 'ok') return 'failed'
  const job = out.data?.job ?? null
  if (out.data?.cancelled || !job || isJobCancelled(job)) return 'cancelled'
  void invalidateRestExact('GET /jobs/{id}', { path: { id: jobId } })
  return 'finished'
}
