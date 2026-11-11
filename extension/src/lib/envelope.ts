// Contract envelope (`Envelope<T>` in shared/api-types.ts): `{ok: true, data}` | `{ok: false, error}`.
import type { ApiError, Envelope, ErrorCode } from '../../../shared/api-types'
import { ERROR_CODES } from '../../../shared/api-types'

export const ok = <T>(data: T): Envelope<T> => ({ ok: true, data })

export function fail<T = never>(code: ErrorCode, message: string, extra: Pick<ApiError, 'reason' | 'details'> = {}): Envelope<T> {
  const error: ApiError = { code, message }
  if (extra.reason !== undefined) error.reason = extra.reason
  if (extra.details !== undefined) error.details = extra.details
  return { ok: false, error }
}

const CODES = new Set<string>(ERROR_CODES)

/** Does the value have the shape of a contract envelope? (decided by the body, not the HTTP status) */
export function isEnvelope(v: unknown): v is Envelope<unknown> {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  if (e.ok === true) return 'data' in e
  if (e.ok !== false || !e.error || typeof e.error !== 'object') return false
  const err = e.error as Record<string, unknown>
  return typeof err.code === 'string' && CODES.has(err.code) && typeof err.message === 'string'
}

/** Short message for any exception (no stack). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  return String(e)
}
