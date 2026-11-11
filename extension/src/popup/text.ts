// Popup texts: everything through the `popup` namespace, chosen by the contract's `code`/`reason` — the server's raw message
// (English, technical) never appears. Plurals via `Intl.PluralRules`, relative time via
// `Intl.RelativeTimeFormat` in the current language.
import type { ApiError } from '../../../shared/api-types'
import type { SyncStatus } from '../../../shared/ext-messages'
import { getLanguage, t } from '../lib/i18n'

export const p = (key: string, vars?: Record<string, string | number>): string => t('popup', key, vars)

/** `key_one` / `key_other` by number (zero uses `other`: "0 channels"). */
export function plural(key: string, count: number, vars: Record<string, string | number> = {}): string {
  const cat = count !== 0 && new Intl.PluralRules(getLanguage()).select(count) === 'one' ? 'one' : 'other'
  return p(`${key}_${cat}`, { count, ...vars })
}

/** "5 minutes ago", "the day before yesterday", "just now"; very old → date. */
export function relTime(ms: number, now: number): string {
  const diffS = (ms - now) / 1000
  const abs = Math.abs(diffS)
  if (abs < 45) return p('just_now')
  const rtf = new Intl.RelativeTimeFormat(getLanguage(), { numeric: 'auto' })
  if (abs < 45 * 60) return rtf.format(Math.round(diffS / 60), 'minute')
  if (abs < 22 * 3600) return rtf.format(Math.round(diffS / 3600), 'hour')
  if (abs < 26 * 86400) return rtf.format(Math.round(diffS / 86400), 'day')
  return shortDate(ms)
}

export function shortDate(ms: number): string {
  return new Intl.DateTimeFormat(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms))
}

// ------------------------------------------------------------------ pairing

const PAIR_ERRORS = new Set(['expired', 'used', 'locked', 'no_active_code', 'ext_endpoint_down', 'invalid', 'timeout', 'plugin_disabled'])
const REFUSED = new Set(['origin_forbidden', 'origin_required', 'origin_mismatch', 'host_forbidden', 'unauthorized'])

/** Text for each `pair.submit` failure (`error.code` = reason; `invalid_code` carries `details.remaining`). */
export function pairErrorText(err: ApiError): string {
  const code = err.code as string
  // the server did not prove it knows the code (a wrong code is told apart by `remaining`), or it predates the proof
  if (err.reason === 'server_outdated') return p('err_server_outdated')
  if (err.reason === 'server_unverified' && code !== 'invalid_code') return p('err_server_unverified')
  if (code === 'invalid_code') {
    const remaining = (err.details as { remaining?: unknown } | undefined)?.remaining
    if (typeof remaining === 'number' && Number.isFinite(remaining)) {
      if (remaining <= 0) return p('err_locked')
      return plural('err_invalid_code', remaining)
    }
    return p('err_invalid_code')
  }
  if (PAIR_ERRORS.has(code)) return p(`err_${code}`)
  if (REFUSED.has(code)) return p('err_refused')
  return p('err_other')
}

// ------------------------------------------------------------------ sync

const SYNC_ERRORS = new Set([
  'tab_closed',
  'tab_timeout',
  'scrape_failed',
  'nothing_to_send',
  'logged_out',
  'ext_endpoint_down',
  'timeout',
  'invalid',
  'cancelled',
  'unauthorized',
  'not_started'
])
const REASONS = new Set(['scroll_stalled', 'timeout', 'logged_out', 'missing_ids', 'too_many', 'stale', 'cancelled', 'aborted', 'empty', 'server_partial'])

export function reasonText(reason: string | null | undefined): string | null {
  if (!reason) return null
  return REASONS.has(reason) ? p(`reason_${reason}`) : p('reason_other')
}

export function syncErrorText(code: string | null | undefined): string {
  return code && SYNC_ERRORS.has(code) ? p(`sync_err_${code}`) : p('sync_err_other')
}

/** Not logged in to YouTube: becomes the popup's "problem" state. */
export function isLoggedOut(s: SyncStatus | null): boolean {
  return Boolean(s && s.state === 'error' && (s.error?.code === 'logged_out' || s.reason === 'logged_out'))
}

/** A sync marked `running` for longer than this belongs to a service worker that died midway. */
export const RUNNING_STALE_MS = 10 * 60_000

export function isRunning(s: SyncStatus | null, now: number): boolean {
  return Boolean(s && s.state === 'running' && now - s.started_at < RUNNING_STALE_MS)
}

export interface SyncLines {
  /** main line */
  main: string
  /** supporting lines (reason, last success) */
  notes: string[]
}

/** Summary of the last sync: when, how many channels, signal and the reason in plain language. */
export function syncLines(s: SyncStatus | null, now: number): SyncLines {
  const lastOk = s?.last_ok_at ?? null
  if (!s || s.state === 'running') {
    return { main: lastOk ? p('sync_last_ok', { when: relTime(lastOk, now) }) : p('sync_never'), notes: [] }
  }
  if (s.state === 'ok') {
    const when = relTime(s.finished_at ?? lastOk ?? s.started_at, now)
    const signal = s.signal === 'complete' ? p('sync_complete') : p('sync_partial')
    const main = [when, plural('sync_channels', s.sent), signal].join(' · ')
    const notes: string[] = []
    if (s.signal !== 'complete') {
      if (s.needs_visible) notes.push(p('needs_visible'))
      else {
        const r = reasonText(s.reason)
        if (r) notes.push(r)
      }
      notes.push(p('sync_partial_note'))
    }
    return { main, notes }
  }
  const notes: string[] = []
  const r = s.error?.code === 'nothing_to_send' ? reasonText(s.reason) : null
  if (r) notes.push(r)
  notes.push(lastOk ? p('sync_last_ok', { when: relTime(lastOk, now) }) : p('sync_never_ok'))
  return { main: syncErrorText(s.error?.code), notes }
}
