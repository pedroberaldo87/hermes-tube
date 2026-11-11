// Local stub server for the extension's background. Mimics the plugin's own server
// (contract/ext-protocol.md §2–§5) on 127.0.0.1, on a free port of the EXT_PORTS range (the extension finds it by
// scanning): `/health` without auth (with `proof` for `?device=&nonce=` once it has a token), `POST /pair/complete`
// with the PAKE rounds like the real server (plugin/ext/proof.py; also the plain code of older extensions), Bearer on
// the `/ext/*` routes (401 + envelope), and the contract `example` on each route (contract/api.yaml), with the HTTP
// status from `x-error-codes`.
//
//   const stub = await StubServer.start({ token: 'tok', pairingCode: '123456' })
//   stub.set('GET /ext/state', { body: { ok: true, data: {...} } })   // overrides a route
//   await stub.waitFor((r) => r.path === '/ext/state')                 // waits for a request
//
// Never binds 0.0.0.0. Skips a port that already accepts connections (e.g. the real plugin in a development profile).
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { EXT_HOST, EXT_PORTS, PLUGIN_ID, extBaseUrl } from '../../../shared/ids.ts'
import { loadContractExamples } from './contract.ts'
import { confirmOf, sameHex, serverProof, serverRound } from '../../src/lib/pake.ts'

export interface StubRequest {
  at: number
  method: string
  path: string
  key: string
  query: Record<string, string>
  headers: Record<string, string>
  body: unknown
  status: number
}

export interface StubReply {
  status?: number
  body: unknown
  headers?: Record<string, string>
}

export type StubHandler = (req: StubRequest, params: Record<string, string>) => StubReply | Promise<StubReply>

export interface StubServerOptions {
  /** fixed port; default = 1st free one of EXT_PORTS */
  port?: number
  /** token accepted on the Bearer routes */
  token?: string | null
  /** code accepted by POST /pair/complete (turns pairing_open on) */
  pairingCode?: string | null
  /** `service` of /health (default PLUGIN_ID) */
  service?: string
}

const NO_AUTH = new Set(['GET /health', 'POST /pair/complete'])

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: EXT_HOST, port })
    const done = (busy: boolean) => {
      s.destroy()
      resolve(busy)
    }
    s.setTimeout(300, () => done(true))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => resolve(false)
    server.once('error', onError)
    server.listen(port, EXT_HOST, () => {
      server.off('error', onError)
      resolve(true)
    })
  })
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (!chunks.length) return null
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export class StubServer {
  readonly log: StubRequest[] = []
  readonly instance = randomBytes(6).toString('hex')
  private readonly overrides = new Map<string, StubHandler>()
  private waiters: Array<{ pred: (r: StubRequest) => boolean; resolve: (r: StubRequest) => void }> = []
  token: string | null
  pairingCode: string | null
  /** PAKE round-1 sessions (id → key) */
  private readonly pakeSessions = new Map<string, Uint8Array>()
  service: string

  private constructor(
    private readonly server: Server,
    readonly port: number,
    opts: StubServerOptions
  ) {
    this.token = opts.token === undefined ? `stub-token-${randomBytes(8).toString('hex')}` : opts.token
    this.pairingCode = opts.pairingCode ?? null
    this.service = opts.service ?? PLUGIN_ID
  }

  get url(): string {
    return extBaseUrl(this.port)
  }

  static async start(opts: StubServerOptions = {}): Promise<StubServer> {
    const candidates = opts.port ? [opts.port] : [...EXT_PORTS]
    for (const port of candidates) {
      if (await portBusy(port)) continue
      let stub: StubServer | null = null
      const server = createServer((req, res) => void stub?.handle(req, res))
      if (!(await listen(server, port))) continue
      stub = new StubServer(server, port, opts)
      return stub
    }
    throw new Error(`StubServer: no free port in ${candidates.join(', ')}`)
  }

  /** overrides the response of a route ("METHOD /path/{param}") */
  set(key: string, reply: StubHandler | StubReply): this {
    this.overrides.set(key, typeof reply === 'function' ? reply : () => reply)
    return this
  }

  requests(filter: Partial<Pick<StubRequest, 'method' | 'path' | 'key'>> = {}): StubRequest[] {
    return this.log.filter(
      (r) =>
        (filter.method === undefined || r.method === filter.method) &&
        (filter.path === undefined || r.path === filter.path) &&
        (filter.key === undefined || r.key === filter.key)
    )
  }

  /** waits for a request that satisfies `pred` (including one already received after `since`) */
  waitFor(pred: (r: StubRequest) => boolean, { timeout = 15_000, since = 0 } = {}): Promise<StubRequest> {
    const hit = this.log.find((r) => r.at >= since && pred(r))
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const w = { pred: (r: StubRequest) => r.at >= since && pred(r), resolve }
      this.waiters.push(w)
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w)
        reject(new Error(`StubServer.waitFor: no request in ${timeout} ms (log: ${this.log.map((r) => r.key).join(', ') || 'empty'})`))
      }, timeout)
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.closeAllConnections?.()
      this.server.close(() => resolve())
    })
  }

  // ------------------------------------------------------------------ internal

  private match(method: string, path: string): { key: string; params: Record<string, string> } | null {
    const keys = [...this.overrides.keys(), ...Object.keys(loadContractExamples().routes)]
    for (const key of keys) {
      const [m, tpl] = key.split(' ')
      if (m !== method) continue
      const names: string[] = []
      const re = new RegExp(
        `^${tpl.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_x, n: string) => {
          names.push(n)
          return '([^/]+)'
        })}$`
      )
      const hit = re.exec(path)
      if (!hit) continue
      const params: Record<string, string> = {}
      names.forEach((n, i) => (params[n] = decodeURIComponent(hit[i + 1])))
      return { key, params }
    }
    return null
  }

  private async reply(key: string, req: StubRequest, params: Record<string, string>): Promise<StubReply> {
    const override = this.overrides.get(key)
    if (override) return override(req, params)
    if (key === 'GET /health') {
      const data: Record<string, unknown> = { service: this.service, instance: this.instance, pairing_open: this.pairingCode !== null }
      const { device, nonce } = req.query
      if (this.token && device && nonce && /^[0-9a-f]{32,128}$/.test(nonce)) data.proof = await serverProof(this.token, nonce, this.port)
      return { body: { ok: true, data } }
    }
    if (key === 'POST /pair/complete') return this.pairComplete(req)
    // Empty queue by default: the contract example carries an approved item, and with the real executor
    // every scenario that pairs would open the unsubscribe tab. Queue scenarios set their own.
    if (key === 'GET /ext/queue') return { body: { ok: true, data: { items: [], channels: {} } } }
    const ex = loadContractExamples().routes[key]
    return { body: ex ?? { ok: false, error: { code: 'not_found', message: `no stub for ${key}` } } }
  }

  /**
   * Both PAKE rounds, as the real server answers them, for `code` (`issue` builds the success reply). Specs that
   * override `POST /pair/complete` call this for bodies with `pake`.
   */
  async pake(req: StubRequest, code: string, issue: () => StubReply, remaining = 4): Promise<StubReply> {
    const body = req.body as { pake?: { x?: unknown; session?: unknown; confirm?: unknown } } | null
    const err = (c: string, extra: Record<string, unknown> = {}) => ({ body: { ok: false, error: { code: c, message: c, ...extra } } })
    const pake = body?.pake ?? {}
    if (typeof pake.x === 'string') {
      const r = await serverRound(code, pake.x, this.port)
      if (!r) return err('invalid')
      const session = randomBytes(8).toString('hex')
      this.pakeSessions.set(session, r.key)
      return { body: { ok: true, data: { pake: { session, y: r.yHex, confirm: r.confirm, remaining } } } }
    }
    const key = typeof pake.session === 'string' ? this.pakeSessions.get(pake.session) : undefined
    if (!key) return err('expired')
    this.pakeSessions.delete(pake.session as string)
    if (!sameHex(pake.confirm, await confirmOf(key, 'client'))) return err('invalid_code', { details: { remaining: Math.max(0, remaining - 1) } })
    return issue()
  }

  private async pairComplete(req: StubRequest): Promise<StubReply> {
    if ((req.body as { pake?: unknown } | null)?.pake !== undefined) {
      if (this.pairingCode === null) return { body: { ok: false, error: { code: 'no_active_code', message: 'no_active_code' } } }
      return this.pake(req, this.pairingCode, () => this.issue(req))
    }
    const code = (req.body as { code?: string } | null)?.code
    const err = (c: string) => ({ body: { ok: false, error: { code: c, message: c } } })
    if (this.pairingCode === null) return err('no_active_code')
    if (code !== this.pairingCode) return err('invalid_code')
    return this.issue(req)
  }

  private issue(req: StubRequest): StubReply {
    this.pairingCode = null
    this.token = `stub-token-${randomBytes(8).toString('hex')}`
    const ex = loadContractExamples().routes['POST /pair/complete'] as { data?: { device?: object } } | undefined
    return {
      body: {
        ok: true,
        data: {
          device: { ...(ex?.data?.device ?? {}), id: 'dev_stub', name: (req.body as { name?: string }).name ?? 'stub', origin: req.headers.origin ?? null },
          token: this.token
        }
      }
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url)
    const method = (req.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
    const rec: StubRequest = {
      at: Date.now(),
      method,
      path: url.pathname,
      key: `${method} ${url.pathname}`,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body: await readBody(req),
      status: 0
    }
    let out: StubReply
    try {
      const m = this.match(method, url.pathname)
      if (m) rec.key = m.key
      if (!m) {
        out = { status: 404, body: { ok: false, error: { code: 'not_found', message: `no route ${rec.key}` } } }
      } else if (!NO_AUTH.has(m.key) && (!this.token || headers.authorization !== `Bearer ${this.token}`)) {
        out = { status: 401, headers: { 'WWW-Authenticate': 'Bearer' }, body: { ok: false, error: { code: 'unauthorized', message: 'invalid token' } } }
      } else {
        out = await this.reply(m.key, rec, m.params)
      }
    } catch (e) {
      out = { status: 500, body: { ok: false, error: { code: 'internal', message: String(e) } } }
    }
    const body = out.body as { ok?: boolean; error?: { code?: string } } | null
    const status = out.status ?? (body && body.ok === false ? (loadContractExamples().http[body.error?.code ?? ''] ?? 500) : 200)
    rec.status = status
    this.log.push(rec)
    for (const w of [...this.waiters]) {
      if (w.pred(rec)) {
        this.waiters = this.waiters.filter((x) => x !== w)
        w.resolve(rec)
      }
    }
    const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...(out.headers ?? {}) })
    res.end(text)
  }
}

/** Other instances of the service in the range (e.g. the real plugin running in a development profile on this machine). */
export async function otherServicesInRange(except: number[] = []): Promise<number[]> {
  const found: number[] = []
  await Promise.all(
    EXT_PORTS.filter((p) => !except.includes(p)).map(async (p) => {
      try {
        const r = await fetch(`${extBaseUrl(p)}/health`, { signal: AbortSignal.timeout(500) })
        const j = (await r.json()) as { data?: { service?: string } }
        if (j?.data?.service === PLUGIN_ID) found.push(p)
      } catch {
        // empty port
      }
    })
  )
  return found.sort()
}
