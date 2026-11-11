// Typed client for the plugin's own server (contract: contract/ext-protocol.md).
// Only the service worker uses it (web pages and content scripts get "Failed to fetch" on loopback).
//
// - Discovery: `GET /health` on the 10 ports (`EXT_PORTS`) in parallel; keeps the one with `service === PLUGIN_ID`.
// - Pairing: only where `pairing_open` (trying the wrong server burns an attempt), and **the code is never sent**:
//   PAKE rounds (`lib/pake.ts`); a server that cannot confirm it knows the code (another program on one of the ports)
//   gets no second round. Stores `{port, token, device_id, paired_at, auth}` in `chrome.storage.local`
//   (`STORAGE_KEYS.connection`). Never logs the token.
// - Request: before the token goes to a port, that port proves it knows the token (`GET /health?device=&nonce=` →
//   `proof`, remembered for `VERIFY_TTL_MS`, forgotten when the port stops answering). Then the Bearer header.
//   Connection refused, 401 or no proof → scan again; the token goes only to another port of the service that proves
//   it (another profile may have taken the old port); found → store the new port. No proof anywhere → `unauthorized`
//   (`reason: server_unverified`). Nobody answers → `ext_endpoint_down` + "open Hermes to reconnect" (`reconnect_needed`).
// - Decides by the body (envelope), not the HTTP status. A response outside the envelope → `internal`.
import type { ApiError, Envelope, ErrorCode, ExtRoutes, HealthResponse, PairedDevice } from '../../../shared/api-types'
import type { ConnectionState, ConnectionStatus } from '../../../shared/ext-messages'
import { STORAGE_KEYS } from '../../../shared/ext-messages'
import { EXT_PORTS, MESSAGE_KEYS, PLUGIN_ID, extBaseUrl } from '../../../shared/ids'
import { fail, isEnvelope, ok } from './envelope'
import { t } from './i18n'
import { clientFinish, clientStart, confirmOf, newNonce, sameHex, serverProof } from './pake'
import type { AuthedRouteKey } from './routes'

/** Status persisted alongside the connection (the service worker dies and respawns; the popup reads it from here). */
export interface PersistedStatus {
  state: ConnectionState
  last_ok_at: number | null
  error: ApiError | null
}

/** Value in `STORAGE_KEYS.connection`. `status` is optional. */
export interface StoredConnection {
  port: number
  token: string
  device_id: string
  paired_at: number
  /** `pake1`: paired without sending the code (absent on pairings made before; they keep working) */
  auth?: 'pake1'
  status?: PersistedStatus
}

/** How long a port's proof is trusted before it is asked again. */
export const VERIFY_TTL_MS = 60_000

export interface ConnectionStore {
  load(): Promise<StoredConnection | null>
  save(conn: StoredConnection): Promise<void>
  /** erases the credential and the state cache */
  clear(): Promise<void>
}

export function chromeConnectionStore(): ConnectionStore {
  return {
    async load() {
      const got = await chrome.storage.local.get(STORAGE_KEYS.connection)
      const c = got[STORAGE_KEYS.connection] as StoredConnection | undefined
      return c && typeof c.token === 'string' && typeof c.port === 'number' ? c : null
    },
    async save(conn) {
      await chrome.storage.local.set({ [STORAGE_KEYS.connection]: conn })
    },
    async clear() {
      await chrome.storage.local.remove([STORAGE_KEYS.connection, STORAGE_KEYS.stateCache])
    }
  }
}

export interface DiscoveredServer {
  port: number
  health: HealthResponse
}

export interface ClientOptions {
  fetch?: typeof fetch
  store?: ConnectionStore
  ports?: readonly number[]
  /** per port, during the scan (measured: 10 ports in ~20 ms) */
  healthTimeoutMs?: number
  requestTimeoutMs?: number
  now?: () => number
}

type Route<K extends keyof ExtRoutes> = ExtRoutes[K]
type PathArg<K extends AuthedRouteKey> = Route<K>['path'] extends Record<string, never> ? { path?: undefined } : { path: Route<K>['path'] }
type BodyArg<K extends AuthedRouteKey> = [Route<K>['body']] extends [never] ? { body?: undefined } : { body: Route<K>['body'] }
type QueryArg<K extends AuthedRouteKey> = Route<K>['query'] extends Record<string, never>
  ? { query?: undefined }
  : { query?: { [P in keyof Route<K>['query']]?: Route<K>['query'][P] | null } }
export type RequestParams<K extends AuthedRouteKey> = PathArg<K> & BodyArg<K> & QueryArg<K>
type RequestArgs<K extends AuthedRouteKey> = object extends RequestParams<K> ? [params?: RequestParams<K>] : [params: RequestParams<K>]

type Attempt =
  | { kind: 'refused' }
  | { kind: 'timeout' }
  | { kind: 'response'; status: number; envelope: Envelope<unknown> | null }

type Proven = 'ok' | 'refused' | 'timeout' | 'unverified'

/** Errors answered by the transport before the handler: the token was not checked. */
const TRANSPORT_ERRORS = new Set<ErrorCode>(['origin_forbidden', 'origin_required', 'origin_mismatch', 'host_forbidden', 'plugin_disabled', 'internal'])
/** Writes `last_ok_at` to storage at most once a minute (the rest of the status only when it changes). */
const PERSIST_OK_EVERY_MS = 60_000

const is401 = (a: Attempt): boolean =>
  a.kind === 'response' &&
  (a.envelope ? !a.envelope.ok && a.envelope.error.code === 'unauthorized' : a.status === 401)

export class ExtClient {
  private readonly fetchImpl: typeof fetch
  private readonly store: ConnectionStore
  private readonly ports: readonly number[]
  private readonly healthTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly now: () => number
  private lastEmitted: ConnectionState | null = null
  /** port → until when its proof is trusted (memory of this service-worker lifetime only) */
  private readonly verified = new Map<number, number>()
  private readonly listeners = new Set<(s: ConnectionStatus) => void>()

  constructor(opts: ClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.store = opts.store ?? chromeConnectionStore()
    this.ports = opts.ports ?? EXT_PORTS
    this.healthTimeoutMs = opts.healthTimeoutMs ?? 800
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000
    this.now = opts.now ?? (() => Date.now())
  }

  // ---------------------------------------------------------------- discovery

  /** `GET /health` on one port (no auth); `null` if it does not answer or is not a valid envelope. */
  async health(port: number): Promise<HealthResponse | null> {
    const a = await this.send(port, 'GET', '/health', {}, this.healthTimeoutMs)
    if (a.kind !== 'response' || !a.envelope?.ok) return null
    const d = a.envelope.data as Partial<HealthResponse> | null
    if (!d || typeof d.service !== 'string') return null
    return { service: d.service, instance: String(d.instance ?? ''), pairing_open: d.pairing_open === true }
  }

  /** Scans the ports in parallel and returns those of our service, in port order. */
  async discover(): Promise<DiscoveredServer[]> {
    const all = await Promise.all(this.ports.map(async (port) => ({ port, health: await this.health(port) })))
    return all.filter((s): s is DiscoveredServer => s.health?.service === PLUGIN_ID)
  }

  // ---------------------------------------------------------------- pairing

  /** 6-digit code → token. Tries only the servers with `pairing_open`. */
  async pair(code: string, name = 'Chrome'): Promise<Envelope<ConnectionStatus>> {
    const clean = code.trim()
    if (!/^\d{6}$/.test(clean)) return fail('invalid', 'pairing code must have 6 digits', { details: { field: 'code' } })
    const servers = await this.discover()
    if (servers.length === 0) return this.reconnectError()
    const open = servers.filter((s) => s.health.pairing_open)
    if (open.length === 0) return fail('no_active_code', 'no active pairing code in Hermes')
    let last: Envelope<ConnectionStatus> = fail('no_active_code', 'no active pairing code in Hermes')
    for (const s of open) {
      const res = await this.pakePair(s.port, clean, name)
      if (res.ok) {
        const paired = res.data
        const conn: StoredConnection = {
          port: s.port,
          token: paired.token,
          device_id: paired.device.id,
          paired_at: this.now(),
          auth: 'pake1',
          status: { state: 'connected', last_ok_at: this.now(), error: null }
        }
        await this.store.save(conn)
        this.verified.set(s.port, this.now() + VERIFY_TTL_MS)
        const st = this.toStatus(conn)
        this.emit(st)
        return ok(st)
      }
      last = res as Envelope<ConnectionStatus>
    }
    return last
  }

  /** Both PAKE rounds on one port. The code itself never leaves; round 2 only after the server confirmed. */
  private async pakePair(port: number, code: string, name: string): Promise<Envelope<PairedDevice>> {
    const json = { 'Content-Type': 'application/json' }
    const start = await clientStart(code)
    const a1 = await this.send(port, 'POST', '/pair/complete', json, this.requestTimeoutMs, { name, pake: { x: start.xHex } })
    if (a1.kind !== 'response' || !a1.envelope?.ok) {
      // a server from before the PAKE answers `invalid` (it wants `code`): never fall back to sending the code
      if (a1.kind === 'response' && a1.envelope && !a1.envelope.ok && a1.envelope.error.code === 'invalid') {
        return fail('invalid', t('common', 'server_outdated'), { reason: 'server_outdated' })
      }
      return this.attemptError(a1)
    }
    const pake = (a1.envelope.data as { pake?: { session?: unknown; y?: unknown; confirm?: unknown; remaining?: unknown } } | null)?.pake
    const key = pake && typeof pake.session === 'string' ? await clientFinish(code, start, pake.y, pake.confirm, port) : null
    if (!key || !pake) {
      // a typo in the code and a program that is not Hermes look the same from here: nothing more is sent
      const remaining = pake?.remaining
      if (typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0 && remaining < 5) {
        return fail('invalid_code', t('common', 'code_mismatch'), { reason: 'server_unverified', details: { remaining } })
      }
      return fail('unauthorized', t('common', 'server_unverified'), { reason: 'server_unverified' })
    }
    const a2 = await this.send(port, 'POST', '/pair/complete', json, this.requestTimeoutMs, {
      name,
      pake: { session: pake.session, confirm: await confirmOf(key, 'client') }
    })
    if (a2.kind === 'response' && a2.envelope?.ok) {
      const paired = a2.envelope.data as PairedDevice
      if (paired && typeof paired.token === 'string' && typeof paired.device?.id === 'string') return ok(paired)
      return fail('internal', t('common', 'invalid_response'))
    }
    return this.attemptError(a2)
  }

  /** Does `port` prove it knows this pairing's token? (`GET /health?device=&nonce=`; no token is sent.) */
  private async proves(conn: StoredConnection, port: number): Promise<Proven> {
    const until = this.verified.get(port)
    if (until !== undefined && until > this.now()) return 'ok'
    const nonce = newNonce()
    const path = `/health?device=${encodeURIComponent(conn.device_id ?? '')}&nonce=${nonce}`
    const a = await this.send(port, 'GET', path, {}, this.healthTimeoutMs)
    if (a.kind === 'refused' || a.kind === 'timeout') {
      this.verified.delete(port)
      return a.kind
    }
    const data = (a.envelope?.ok ? a.envelope.data : null) as { service?: unknown; proof?: unknown } | null
    if (data?.service === PLUGIN_ID && sameHex(data.proof, await serverProof(conn.token, nonce, port))) {
      this.verified.set(port, this.now() + VERIFY_TTL_MS)
      return 'ok'
    }
    this.verified.delete(port)
    return 'unverified'
  }

  /** `POST /ext/unpair` (best effort) and erases the local data. */
  async unpair(): Promise<ConnectionStatus> {
    if (await this.store.load()) {
      try {
        await this.request('POST /ext/unpair')
      } catch {
        // best effort: erasing the local data is what matters
      }
    }
    await this.store.clear()
    const st = this.toStatus(null)
    this.emit(st)
    return st
  }

  // ---------------------------------------------------------------- authenticated requests

  async request<K extends AuthedRouteKey>(key: K, ...args: RequestArgs<K>): Promise<Envelope<Route<K>['data']>> {
    const params = (args[0] ?? {}) as { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }
    const [method, tpl] = key.split(' ') as [string, string]
    const path = buildPath(tpl, params.path, params.query)
    const conn = await this.store.load()
    if (!conn) {
      this.emit(this.toStatus(null))
      return fail('unauthorized', t('common', 'unpaired'), { reason: 'unpaired' })
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${conn.token}` }
    if (params.body !== undefined) headers['Content-Type'] = 'application/json'
    const go = (port: number) => this.send(port, method, path, headers, this.requestTimeoutMs, params.body)

    // the token goes only to a port that proved it knows it
    const proven = await this.proves(conn, conn.port)
    if (proven === 'timeout') return this.finishError(conn, conn.port, fail('timeout', t('common', 'timeout')))
    const first: Attempt | { kind: 'unverified' } = proven === 'ok' ? await go(conn.port) : { kind: proven }
    if (first.kind === 'timeout') return this.finishError(conn, conn.port, fail('timeout', t('common', 'timeout')))
    if (first.kind === 'response' && !is401(first)) return this.finish(conn, conn.port, first)
    if (first.kind !== 'unverified') this.verified.delete(conn.port)

    // refused, 401 or no proof: the server may have moved to another port (or another profile took ours)
    const others = (await this.discover()).filter((s) => s.port !== conn.port)
    for (const s of others) {
      if ((await this.proves(conn, s.port)) !== 'ok') continue
      const again = await go(s.port)
      if (again.kind === 'response' && !is401(again)) return this.finish(conn, s.port, again)
    }
    if (first.kind === 'refused') {
      const err = this.reconnectError<Route<K>['data']>()
      await this.saveStatus(conn, conn.port, 'reconnect_needed', null, err.ok ? null : err.error)
      return err
    }
    if (first.kind === 'unverified') {
      const err = fail<Route<K>['data']>('unauthorized', t('common', 'server_unverified'), { reason: 'server_unverified' })
      await this.saveStatus(conn, conn.port, 'unauthorized', null, err.ok ? null : err.error)
      return err
    }
    const env = (first.envelope && !first.envelope.ok ? first.envelope : fail('unauthorized', t('common', 'unauthorized'))) as Envelope<never>
    await this.saveStatus(conn, conn.port, 'unauthorized', null, env.ok ? null : env.error)
    return env
  }

  // ---------------------------------------------------------------- status

  async status(): Promise<ConnectionStatus> {
    return this.toStatus(await this.store.load())
  }

  /** Notifies when the connection state changes (connected → reconnect_needed etc.). */
  onStatus(cb: (s: ConnectionStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ---------------------------------------------------------------- internal

  private toStatus(conn: StoredConnection | null): ConnectionStatus {
    if (!conn) return { state: 'unpaired', port: null, device_id: null, last_ok_at: null, error: null }
    const s = conn.status
    return {
      state: s?.state ?? 'connected',
      port: conn.port,
      device_id: conn.device_id,
      last_ok_at: s?.last_ok_at ?? null,
      error: s?.error ?? null
    }
  }

  private emit(st: ConnectionStatus): void {
    if (st.state === this.lastEmitted) return
    this.lastEmitted = st.state
    for (const cb of this.listeners) {
      try {
        cb(st)
      } catch {
        // a faulty listener does not take down the client
      }
    }
  }

  private reconnectError<T>(): Envelope<T> {
    return fail('ext_endpoint_down', t('common', MESSAGE_KEYS.reconnectOpenHermes), { reason: 'reconnect_needed' })
  }

  private attemptError<T>(a: Attempt): Envelope<T> {
    if (a.kind === 'refused') return this.reconnectError()
    if (a.kind === 'timeout') return fail('timeout', t('common', 'timeout'))
    if (a.envelope && !a.envelope.ok) return a.envelope as Envelope<T>
    return fail('internal', t('common', 'invalid_response'), { details: { http_status: a.status } })
  }

  private async finish<T>(conn: StoredConnection, port: number, a: Attempt & { kind: 'response' }): Promise<Envelope<T>> {
    if (!a.envelope) return this.finishError(conn, port, this.attemptError<T>(a))
    const env = a.envelope as Envelope<T>
    if (!env.ok && TRANSPORT_ERRORS.has(env.error.code)) return this.finishError(conn, port, env)
    // ok or domain error: the server checked the token
    await this.saveStatus(conn, port, 'connected', this.now(), null)
    return env
  }

  private async finishError<T>(conn: StoredConnection, port: number, env: Envelope<T>): Promise<Envelope<T>> {
    await this.saveStatus(conn, port, 'error', null, env.ok ? null : env.error)
    return env
  }

  private async saveStatus(conn: StoredConnection, port: number, state: ConnectionState, okAt: number | null, error: ApiError | null): Promise<void> {
    const prev = conn.status
    const status: PersistedStatus = { state, last_ok_at: okAt ?? prev?.last_ok_at ?? null, error }
    const next: StoredConnection = { ...conn, port, status }
    this.emit(this.toStatus(next))
    const changed =
      port !== conn.port ||
      prev?.state !== state ||
      JSON.stringify(prev?.error ?? null) !== JSON.stringify(error) ||
      (okAt !== null && (prev?.last_ok_at == null || okAt - prev.last_ok_at >= PERSIST_OK_EVERY_MS))
    if (!changed) return
    // do not resurrect an erased connection (unpair) nor overwrite a new pairing during the request
    const current = await this.store.load()
    if (!current || current.token !== conn.token) return
    await this.store.save({ ...current, port, status })
  }

  private async send(
    port: number,
    method: string,
    path: string,
    headers: Record<string, string>,
    timeoutMs: number,
    body?: unknown
  ): Promise<Attempt> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
    try {
      const res = await this.fetchImpl(`${extBaseUrl(port)}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
        cache: 'no-store'
      })
      let parsed: unknown = null
      try {
        parsed = await res.json()
      } catch {
        parsed = null
      }
      return { kind: 'response', status: res.status, envelope: isEnvelope(parsed) ? parsed : null }
    } catch {
      // TypeError "Failed to fetch" = connection refused (no server on the port, or loopback blocked)
      if (ctrl.signal.aborted) return { kind: 'timeout' }
      return { kind: 'refused' }
    } finally {
      clearTimeout(timer)
    }
  }
}

function buildPath(tpl: string, path?: Record<string, string>, query?: Record<string, unknown>): string {
  let out = tpl.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = path?.[name]
    if (v === undefined || v === null || v === '') throw new Error(`missing path parameter "${name}" for ${tpl}`)
    return encodeURIComponent(String(v))
  })
  if (query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    const s = qs.toString()
    if (s) out += `?${s}`
  }
  return out
}
