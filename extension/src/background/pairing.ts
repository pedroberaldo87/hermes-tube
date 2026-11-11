// background/pairing — pairing the extension with Hermes (contract/ext-protocol.md).
//
// - `pair.submit {code, name?, port?}`: 6-digit code (only the digits of what was typed/pasted) → the client
//   scans the 10 ports (`EXT_PORTS`), tries only where `pairing_open` and stores `{port, token, device_id}` in
//   `STORAGE_KEYS.connection`. With `port` (address from the popup's "advanced" field) it uses only that port and stores the choice in
//   `PAIR_PORT_KEY` (only the field's memory; without `port` = automatic and the memory is erased).
//   Server errors pass through as they came (`invalid_code` + `details.remaining`, `expired`, `used`, `locked`,
//   `no_active_code`, `ext_endpoint_down`): the popup picks the text from the `code`.
// - Paired: stores the device name (`PAIR_INFO_KEY`), ensures the 30 s alarm (the core also sets it; idempotent)
//   and triggers the first sync (`sync.now {trigger: 'pair'}`, from the sync module; visible tab) a moment later — the popup
//   shows "connected" before the YouTube tab opens. The 6 h alarm belongs to the sync module (it follows the token in `storage.onChanged`).
// - `pair.unpair`: `POST /ext/unpair` (best effort) + erases **all** of `chrome.storage.local` (the extension only keeps
//   cache and credential; nothing carries over from one pairing to the next) + erases the alarms.
// Never logs or returns the token.
import type { ExtRouteKey } from '../../../shared/api-types'
import { ALARMS, STORAGE_KEYS } from '../../../shared/ext-messages'
import { EXT_STATE_ALARM_S } from '../../../shared/ids'
import type { BackgroundContext, BackgroundModule } from '../lib/background'
import { ExtClient } from '../lib/client'
import { fail } from '../lib/envelope'

export const MODULE = 'background/pairing'
export const ROUTES = ['POST /pair/complete', 'POST /ext/unpair'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = ROUTES
export const MESSAGES = ['pair.submit', 'pair.unpair'] as const

/** `{device_name, paired_at}` of the current pairing (the popup shows the name). */
export const PAIR_INFO_KEY = STORAGE_KEYS.pairInfo
/** Port chosen in the popup's "advanced" section (absent = automatic discovery). */
export const PAIR_PORT_KEY = STORAGE_KEYS.pairPort
/** Delay of the first sync after pairing (the popup shows the success before the tab opens). */
export const FIRST_SYNC_DELAY_MS = 1500
export const CODE_LENGTH = 6
/** The server truncates the name to 80. */
const NAME_MAX = 80

export interface PairInfo {
  device_name: string
  /** epoch ms */
  paired_at: number
}

// ------------------------------------------------------------------ pure functions (the popup uses them too)

/** Only the digits 0–9 of the text (pasting "481-516", "481 516", "Code: 481516"), at most 6. */
export function normalizeCode(raw: string): string {
  return (raw ?? '').replace(/[^0-9]/g, '').slice(0, CODE_LENGTH)
}

export type ParsedAddress = { ok: true; port: number | null } | { ok: false }

/**
 * "Advanced" address: empty = automatic; `47630`, `127.0.0.1:47630`, `http://127.0.0.1:47630` or `localhost`.
 * Loopback only (the manifest only allows `http://127.0.0.1/*`; the server never listens outside it).
 */
export function parseAddress(raw: string): ParsedAddress {
  const s = (raw ?? '').trim()
  if (!s) return { ok: true, port: null }
  const validPort = (n: number): ParsedAddress => (Number.isInteger(n) && n >= 1024 && n <= 65535 ? { ok: true, port: n } : { ok: false })
  if (/^\d+$/.test(s)) return validPort(Number(s))
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`)
  } catch {
    return { ok: false }
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) return { ok: false }
  if (url.pathname !== '/' || url.search || url.hash || url.username) return { ok: false }
  return validPort(Number(url.port))
}

/** "Chrome — macOS": the name Hermes shows in the device list. Nothing that identifies the person. */
export function deviceName(nav: { userAgent?: string; brave?: unknown } = globalThis.navigator ?? {}): string {
  const ua = nav.userAgent ?? ''
  const browser = nav.brave ? 'Brave' : / Edg\//.test(ua) ? 'Edge' : / OPR\//.test(ua) ? 'Opera' : / Vivaldi\//.test(ua) ? 'Vivaldi' : 'Chrome'
  const os = /CrOS/.test(ua)
    ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  return os ? `${browser} — ${os}` : browser
}

// ------------------------------------------------------------------ module

export interface PairingOptions {
  firstSyncDelayMs?: number
  deviceName?: () => string
  /** client for a manual port (tests inject the fake network) */
  clientFor?: (ports: readonly number[]) => ExtClient
}

/** Acceptable port in "advanced" (same range as `parseAddress`). */
export function isValidPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535
}

async function ensureStateAlarm(): Promise<void> {
  const period = EXT_STATE_ALARM_S / 60
  const existing = await chrome.alarms.get(ALARMS.state)
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create(ALARMS.state, { periodInMinutes: period, delayInMinutes: period })
  }
}

export function createPairing(opts: PairingOptions = {}): BackgroundModule {
  const delay = opts.firstSyncDelayMs ?? FIRST_SYNC_DELAY_MS
  const nameOf = opts.deviceName ?? (() => deviceName())
  const clientFor = opts.clientFor ?? ((ports: readonly number[]) => new ExtClient({ ports }))

  function firstSync(ctx: BackgroundContext): void {
    setTimeout(() => {
      void ctx.router.dispatch({ type: 'sync.now', payload: { trigger: 'pair' } }).then((res) => {
        if (!res.ok) console.warn('[tube] first sync did not start:', res.error.code)
      })
    }, delay)
  }

  return {
    MODULE,
    ROUTES,
    REAL_ROUTES,
    MESSAGES,
    register(ctx) {
      ctx.router.onEnvelope('pair.submit', async (p) => {
        const code = normalizeCode(String(p?.code ?? ''))
        if (code.length !== CODE_LENGTH) return fail('invalid', 'pairing code must have 6 digits', { details: { field: 'code' } })
        const port = p?.port ?? null
        if (port !== null && !isValidPort(port)) return fail('invalid', 'port must be an integer in 1024-65535', { details: { field: 'port' } })
        const name = (String(p?.name ?? '').trim() || nameOf()).slice(0, NAME_MAX)
        // the advanced choice is remembered for the field (the parameter is the source of truth)
        if (port === null) await chrome.storage.local.remove(PAIR_PORT_KEY)
        else await chrome.storage.local.set({ [PAIR_PORT_KEY]: port })
        const client = port === null ? ctx.client : clientFor([port])
        const res = await client.pair(code, name)
        if (!res.ok) return res
        const info: PairInfo = { device_name: name, paired_at: ctx.now() }
        await chrome.storage.local.set({ [PAIR_INFO_KEY]: info })
        await ensureStateAlarm()
        firstSync(ctx)
        return res
      })

      ctx.router.on('pair.unpair', async () => {
        const st = await ctx.client.unpair()
        await Promise.all([chrome.alarms.clear(ALARMS.state), chrome.alarms.clear(ALARMS.sync)])
        await chrome.storage.local.clear()
        return st
      })
    }
  }
}

// `@__PURE__`: the popup imports only the pure functions from here; without the mark the bundler would drag the HTTP client along.
export const pairing: BackgroundModule = /* @__PURE__ */ createPairing()
