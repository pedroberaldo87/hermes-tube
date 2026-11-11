// Fake network for the extension tests: plugin servers on 127.0.0.1 ports, with the
// contract's transport behavior (contract/ext-protocol.md): `/health` without auth,
// `POST /pair/complete` with a code, `Authorization: Bearer <token>` on the `/ext/*` routes (401 + `unauthorized` envelope).
// A port with no server = connection refused (`TypeError: Failed to fetch`, like Chrome).
//
//   const net = new FakeNet()
//   const s = net.addServer(47616, { token: 'tok', pairingCode: '123456' })
//   s.route('GET /ext/state', () => ({ body: { ok: true, data: EXT_STATE } }))
//   const client = new ExtClient({ fetch: net.fetch })
// The servers also prove who they are, like the real one (plugin/ext/proof.py): `/health?device=&nonce=` answers
// `proof`, and `POST /pair/complete` accepts the PAKE rounds (`{name, pake: {x}}` → `{pake: {session, y, confirm}}`,
// then `{name, pake: {session, confirm}}` → `PairedDevice`). `proves: false` / `impostor: true` play a program that
// is not Hermes.
// relative import: tsconfig.ext.json does not map `@shared/` (only Vite/vitest)
import { PLUGIN_ID, extBaseUrl } from '../../shared/ids'
import { confirmOf, sameHex, serverProof, serverRound } from '../src/lib/pake'

export interface FakeRequest {
  method: string
  port: number
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: unknown
}

export interface FakeResponse {
  status?: number
  body: unknown
  /** delay before answering (ms) */
  delayMs?: number
}

export type FakeHandler = (req: FakeRequest, params: Record<string, string>) => FakeResponse | Promise<FakeResponse>

export interface FakeServerOptions {
  service?: string
  instance?: string
  pairingOpen?: boolean
  /** token accepted on Bearer routes; `null` = no token accepted */
  token?: string | null
  /** code accepted by `POST /pair/complete` (turns on `pairing_open`) */
  pairingCode?: string
  /** token issued on pairing (default: `token`) */
  issuedToken?: string
  deviceId?: string
  /** answers `/health` proofs (default true; false = an older server or a program that is not Hermes) */
  proves?: boolean
  /** a program on the port that does not know the code (PAKE answers with a random code) */
  impostor?: boolean
  /** accepts only `{code, name}` (a server from before the PAKE) */
  legacyPairing?: boolean
}

const NO_AUTH = new Set(['GET /health', 'POST /pair/complete'])

export const errorBody = (code: string, message = code, extra: Record<string, unknown> = {}) => ({
  ok: false,
  error: { code, message, ...extra }
})

export class FakeServer {
  readonly routes = new Map<string, FakeHandler>()
  constructor(
    readonly port: number,
    public opts: FakeServerOptions
  ) {}

  route(key: string, handler: FakeHandler): this {
    this.routes.set(key, handler)
    return this
  }

  get pairingOpen(): boolean {
    return this.opts.pairingOpen ?? Boolean(this.opts.pairingCode)
  }

  /** PAKE round-1 sessions: id → key */
  private readonly sessions = new Map<string, Uint8Array>()
  /** attempts spent on the current code (like the real server: round 1 counts one) */
  attempts = 0

  async handle(req: FakeRequest): Promise<FakeResponse> {
    const key = `${req.method} ${req.path}`
    if (key === 'GET /health') {
      const data: Record<string, unknown> = {
        service: this.opts.service ?? PLUGIN_ID,
        instance: this.opts.instance ?? `inst-${this.port}`,
        pairing_open: this.pairingOpen
      }
      const { device, nonce } = req.query
      const token = this.opts.token
      const known = this.opts.deviceId === undefined || device === this.opts.deviceId
      if (this.opts.proves !== false && token && device && nonce && known && /^[0-9a-f]{32,128}$/.test(nonce)) {
        data.proof = this.opts.impostor ? await serverProof(`not-${token}`, nonce, this.port) : await serverProof(token, nonce, this.port)
      }
      return { body: { ok: true, data } }
    }
    if (!NO_AUTH.has(this.matchKey(req)?.key ?? key)) {
      const want = this.opts.token
      if (!want || req.headers.authorization !== `Bearer ${want}`) {
        return { status: 401, body: errorBody('unauthorized', 'invalid token') }
      }
    }
    const m = this.matchKey(req)
    if (m) return m.handler(req, m.params)
    if (key === 'POST /pair/complete') return this.pairComplete(req)
    return { status: 404, body: errorBody('not_found', `no route ${key}`) }
  }

  private async pake(req: FakeRequest): Promise<FakeResponse> {
    const body = req.body as { name?: string; pake?: { x?: string; session?: string; confirm?: string } }
    if (this.opts.legacyPairing) return { status: 422, body: errorBody('invalid', 'code must have 6 digits') }
    if (!this.opts.pairingCode) return { status: 400, body: errorBody('no_active_code') }
    const pake = body.pake ?? {}
    if (typeof pake.x === 'string') {
      this.attempts++
      if (this.attempts >= 5) {
        this.opts.pairingCode = undefined
        return { status: 400, body: errorBody('locked') }
      }
      const code = this.opts.impostor ? '000000' : this.opts.pairingCode
      const r = await serverRound(code, pake.x, this.port)
      if (!r) return { status: 422, body: errorBody('invalid', 'pake.x must be a group element') }
      const session = `s${this.sessions.size + 1}-${this.port}`
      this.sessions.set(session, r.key)
      return { body: { ok: true, data: { pake: { session, y: r.yHex, confirm: r.confirm, remaining: 5 - this.attempts } } } }
    }
    const k = typeof pake.session === 'string' ? this.sessions.get(pake.session) : undefined
    if (!k) return { status: 400, body: errorBody('expired') }
    this.sessions.delete(pake.session!)
    if (!sameHex(pake.confirm, await confirmOf(k, 'client'))) return { status: 400, body: errorBody('invalid_code', 'wrong code', { details: { remaining: 4 - this.attempts } }) }
    return this.issue(body.name)
  }

  private async pairComplete(req: FakeRequest): Promise<FakeResponse> {
    if ((req.body as { pake?: unknown } | null)?.pake !== undefined) return this.pake(req)
    const code = (req.body as { code?: string } | null)?.code
    if (!this.opts.pairingCode) return { status: 400, body: errorBody('no_active_code') }
    if (code !== this.opts.pairingCode) return { status: 400, body: errorBody('invalid_code', 'wrong code', { details: { remaining: 4 } }) }
    return this.issue((req.body as { name?: string }).name)
  }

  private issue(name: string | undefined): FakeResponse {
    this.opts.pairingCode = undefined
    this.attempts = 0
    const token = this.opts.issuedToken ?? this.opts.token ?? `tok-${this.port}`
    this.opts.token = token
    return {
      body: {
        ok: true,
        data: {
          device: {
            id: this.opts.deviceId ?? `dev-${this.port}`,
            name: name ?? 'x',
            created_at: 1762700000,
            last_seen: null,
            revoked_at: null,
            origin: null
          },
          token
        }
      }
    }
  }

  private matchKey(req: FakeRequest): { key: string; handler: FakeHandler; params: Record<string, string> } | null {
    for (const [key, handler] of this.routes) {
      const [method, tpl] = key.split(' ')
      if (method !== req.method) continue
      const names: string[] = []
      const re = new RegExp(
        `^${tpl.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, n: string) => {
          names.push(n)
          return '([^/]+)'
        })}$`
      )
      const hit = re.exec(req.path)
      if (!hit) continue
      const params: Record<string, string> = {}
      names.forEach((n, i) => (params[n] = decodeURIComponent(hit[i + 1])))
      return { key, handler, params }
    }
    return null
  }
}

export class FakeNet {
  readonly servers = new Map<number, FakeServer>()
  readonly log: FakeRequest[] = []
  /** requests in flight now / peak (proof of parallel scanning) */
  inflight = 0
  maxInflight = 0

  addServer(port: number, opts: FakeServerOptions = {}): FakeServer {
    const s = new FakeServer(port, opts)
    this.servers.set(port, s)
    return s
  }

  down(port: number): void {
    this.servers.delete(port)
  }

  requests(filter?: { port?: number; path?: string; method?: string }): FakeRequest[] {
    return this.log.filter(
      (r) =>
        (filter?.port === undefined || r.port === filter.port) &&
        (filter?.path === undefined || r.path === filter.path) &&
        (filter?.method === undefined || r.method === filter.method)
    )
  }

  readonly fetch = (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const port = Number(url.port)
    if (url.hostname !== '127.0.0.1' || `${extBaseUrl(port)}` !== url.origin) {
      throw new TypeError(`FakeNet: host outside loopback: ${url.href}`)
    }
    const headers: Record<string, string> = {}
    new Headers(init.headers ?? {}).forEach((v, k) => (headers[k.toLowerCase()] = v))
    const req: FakeRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      port,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null
    }
    this.log.push(req)
    this.inflight++
    this.maxInflight = Math.max(this.maxInflight, this.inflight)
    try {
      await new Promise((r) => setTimeout(r, 1))
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const server = this.servers.get(port)
      if (!server) throw new TypeError('Failed to fetch')
      const res = await server.handle(req)
      if (res.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, res.delayMs)
          init.signal?.addEventListener('abort', () => {
            clearTimeout(t)
            reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
          })
        })
      }
      const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
      return new Response(text, { status: res.status ?? 200, headers: { 'content-type': 'application/json' } })
    } finally {
      this.inflight--
    }
  }) as typeof fetch
}
