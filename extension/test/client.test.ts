// Typed client for the plugin's own server (extension/src/lib/client.ts):
// discovery via /health on the 10 ports, pairing only where pairing_open, Bearer, 401, rediscovery.
import { describe, expect, it } from 'vitest'
import { EXT_PORTS, MESSAGE_KEYS, PLUGIN_ID } from '../../shared/ids'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import { ExtClient, chromeConnectionStore, type StoredConnection } from '../src/lib/client'
import { t } from '../src/lib/i18n'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { chromeFake } from './setup-chrome'
import { FakeNet, errorBody } from './setup-net'

const P = EXT_PORTS

function stateRoute() {
  return () => ({ body: { ok: true, data: EXT_STATE_EXAMPLE } })
}

async function seed(conn: Partial<StoredConnection> = {}) {
  const full: StoredConnection = { port: P[0], token: 'tok-A', device_id: 'dev-A', paired_at: 1, ...conn }
  await chrome.storage.local.set({ [STORAGE_KEYS.connection]: full })
  return full
}

function makeClient(net: FakeNet, now = () => 1_000) {
  return new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), now })
}

describe('discovery', () => {
  it('scans the 10 ports in parallel and keeps only service === PLUGIN_ID', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { service: 'other-plugin' })
    net.addServer(P[1], { pairingOpen: false })
    net.addServer(P[2], { pairingCode: '123456' })
    const client = makeClient(net)

    const found = await client.discover()

    expect(found.map((f) => f.port)).toEqual([P[1], P[2]])
    expect(found[1].health).toEqual({ service: PLUGIN_ID, instance: `inst-${P[2]}`, pairing_open: true })
    expect(net.requests({ path: '/health' }).map((r) => r.port).sort()).toEqual([...P].sort())
    expect(net.maxInflight).toBe(P.length)
  })

  it('/health does not send Authorization', async () => {
    const net = new FakeNet()
    net.addServer(P[0])
    await seed()
    await makeClient(net).discover()
    expect(net.requests({ path: '/health' }).every((r) => !('authorization' in r.headers))).toBe(true)
  })
})

describe('pairing', () => {
  it('tries the code only where pairing_open and stores {port, token, device_id}', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { pairingOpen: false })
    net.addServer(P[3], { pairingCode: '654321', issuedToken: 'tok-new', deviceId: 'dev-9' })
    const client = makeClient(net, () => 5_000)

    const res = await client.pair('654321', 'Chrome — Mac')

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.state).toBe('connected')
      expect(res.data.port).toBe(P[3])
      expect(res.data.device_id).toBe('dev-9')
    }
    // two PAKE rounds, only on the open server; the code itself never travels (client-proof.test.ts)
    expect(net.requests({ path: '/pair/complete' }).map((r) => r.port)).toEqual([P[3], P[3]])
    expect(net.requests({ path: '/pair/complete' })[0].body).toMatchObject({ name: 'Chrome — Mac', pake: { x: expect.any(String) } })
    expect(JSON.stringify(net.log)).not.toContain('654321')
    const stored = chromeFake().storage.get(STORAGE_KEYS.connection) as StoredConnection
    expect(stored).toMatchObject({ port: P[3], token: 'tok-new', device_id: 'dev-9', paired_at: 5_000 })
  })

  it('wrong code → invalid_code with the attempts left, and stores nothing', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { pairingCode: '111111' })
    const res = await makeClient(net).pair('222222')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatchObject({ code: 'invalid_code', details: { remaining: 4 } })
    expect(chromeFake().storage.has(STORAGE_KEYS.connection)).toBe(false)
  })

  it('server found without an active code → no_active_code, no POST', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { pairingOpen: false })
    const res = await makeClient(net).pair('123456')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('no_active_code')
    expect(net.requests({ path: '/pair/complete' })).toHaveLength(0)
  })

  it('no port answers → ext_endpoint_down / reconnect_needed', async () => {
    const res = await makeClient(new FakeNet()).pair('123456')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('ext_endpoint_down')
      expect(res.error.reason).toBe('reconnect_needed')
    }
  })

  it('invalid format → invalid, no network', async () => {
    const net = new FakeNet()
    const res = await makeClient(net).pair('12ab')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('invalid')
    expect(net.log).toHaveLength(0)
  })
})

describe('authenticated request', () => {
  it('sends Bearer on the stored port and marks connected', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'tok-A' }).route('GET /ext/state', stateRoute())
    await seed()
    const client = makeClient(net, () => 7_000)

    const res = await client.request('GET /ext/state')

    expect(res).toEqual({ ok: true, data: EXT_STATE_EXAMPLE })
    const [req] = net.requests({ path: '/ext/state' })
    expect(req.headers.authorization).toBe('Bearer tok-A')
    expect(req.port).toBe(P[0])
    const st = await client.status()
    expect(st).toMatchObject({ state: 'connected', port: P[0], device_id: 'dev-A', last_ok_at: 7_000, error: null })
  })

  it('no pairing → unauthorized/unpaired, no network', async () => {
    const net = new FakeNet()
    const client = makeClient(net)
    const res = await client.request('GET /ext/state')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('unauthorized')
      expect(res.error.reason).toBe('unpaired')
    }
    expect(net.log).toHaveLength(0)
    expect((await client.status()).state).toBe('unpaired')
  })

  it('path and query: {id} encoded, query without empty values', async () => {
    const net = new FakeNet()
    const s = net.addServer(P[0], { token: 'tok-A' })
    s.route('POST /ext/queue/{id}/result', (_req, params) => ({ body: { ok: true, data: { id: params.id } } }))
    s.route('GET /ext/feed', () => ({ body: { ok: true, data: { items: [], next_cursor: null } } }))
    await seed()
    const client = makeClient(net)

    const r1 = await client.request('POST /ext/queue/{id}/result', { path: { id: 'q/1 x' }, body: { status: 'running' } })
    const r2 = await client.request('GET /ext/feed', { query: { tab: 'tab 1', limit: 20, cursor: undefined } })

    expect(r1).toEqual({ ok: true, data: { id: 'q/1 x' } })
    expect(r2.ok).toBe(true)
    const post = net.requests({ method: 'POST' })[0]
    expect(post.path).toBe('/ext/queue/q%2F1%20x/result')
    expect(post.headers['content-type']).toBe('application/json')
    expect(post.body).toEqual({ status: 'running' })
    expect(net.requests({ path: '/ext/feed' })[0].query).toEqual({ tab: 'tab 1', limit: '20' })
  })

  it('domain error passes through and keeps connected', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'tok-A' }).route('POST /ext/read', () => ({ status: 404, body: errorBody('not_found', 'no folder') }))
    await seed()
    const client = makeClient(net)
    const res = await client.request('POST /ext/read', { body: { kind: 'folder', id: 'f-x' } })
    expect(res).toEqual(errorBody('not_found', 'no folder'))
    expect((await client.status()).state).toBe('connected')
  })

  it('response outside the envelope → internal with the HTTP status', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'tok-A' }).route('GET /ext/state', () => ({ status: 502, body: '<html>bad gateway</html>' }))
    await seed()
    const res = await makeClient(net).request('GET /ext/state')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('internal')
      expect(res.error.details).toMatchObject({ http_status: 502 })
    }
  })

  it('timeout → timeout code, no rediscovery', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'tok-A' }).route('GET /ext/state', () => ({ delayMs: 200, body: { ok: true, data: {} } }))
    await seed()
    const client = new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), requestTimeoutMs: 20 })
    const res = await client.request('GET /ext/state')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('timeout')
    // only the proof of the stored port: no rediscovery
    expect(net.requests({ path: '/health' }).map((r) => r.port)).toEqual([P[0]])
  })
})

describe('401 and rediscovery', () => {
  it('401 with no other server accepting the token → unauthorized (token stays stored)', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'other' }).route('GET /ext/state', stateRoute())
    net.addServer(P[1], { token: 'yet-another' }).route('GET /ext/state', stateRoute())
    await seed()
    const client = makeClient(net)

    const res = await client.request('GET /ext/state')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('unauthorized')
    // neither server proves it knows tok-A: the token is not sent to either
    expect(net.requests({ path: '/ext/state' })).toHaveLength(0)
    const st = await client.status()
    expect(st.state).toBe('unauthorized')
    expect(st.error?.code).toBe('unauthorized')
    expect((chromeFake().storage.get(STORAGE_KEYS.connection) as StoredConnection).token).toBe('tok-A')
  })

  it('401 on the stored port, another port of the service accepts the token → port switch', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'from-another-profile' }).route('GET /ext/state', stateRoute())
    net.addServer(P[4], { token: 'tok-A' }).route('GET /ext/state', stateRoute())
    await seed()
    const client = makeClient(net)

    const res = await client.request('GET /ext/state')

    expect(res.ok).toBe(true)
    expect((chromeFake().storage.get(STORAGE_KEYS.connection) as StoredConnection).port).toBe(P[4])
    expect((await client.status())).toMatchObject({ state: 'connected', port: P[4] })
  })

  it('stored port refuses the connection → scans again, confirms with the token and stores the new port', async () => {
    const net = new FakeNet()
    net.addServer(P[2], { service: 'other-plugin', token: 'tok-A' }).route('GET /ext/state', stateRoute())
    net.addServer(P[7], { token: 'tok-A' }).route('GET /ext/state', stateRoute())
    await seed({ port: P[0] })
    const client = makeClient(net)

    const res = await client.request('GET /ext/state')

    expect(res.ok).toBe(true)
    expect(net.requests({ path: '/ext/state', port: P[2] })).toHaveLength(0)
    const tries = net.requests({ path: '/ext/state' })
    // the stored port refused its proof (nothing sent there), then only the port found by the scan and proven
    expect(tries.map((r) => r.port)).toEqual([P[7]])
    expect(tries[0].headers.authorization).toBe('Bearer tok-A')
    expect((chromeFake().storage.get(STORAGE_KEYS.connection) as StoredConnection).port).toBe(P[7])
  })

  it('no port answers → ext_endpoint_down + "open Hermes to reconnect"', async () => {
    await seed()
    const client = makeClient(new FakeNet())
    const res = await client.request('GET /ext/state')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('ext_endpoint_down')
      expect(res.error.reason).toBe('reconnect_needed')
      expect(res.error.message).toBe(t('common', MESSAGE_KEYS.reconnectOpenHermes))
    }
    expect((await client.status()).state).toBe('reconnect_needed')
  })

  it('server comes back after reconnect_needed → connected', async () => {
    const net = new FakeNet()
    await seed()
    const client = makeClient(net)
    await client.request('GET /ext/state')
    net.addServer(P[0], { token: 'tok-A' }).route('GET /ext/state', stateRoute())
    const res = await client.request('GET /ext/state')
    expect(res.ok).toBe(true)
    expect((await client.status()).state).toBe('connected')
  })

  it('notifies status listeners only when the state changes', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'tok-A' }).route('GET /ext/state', stateRoute())
    await seed()
    const client = makeClient(net)
    const seen: string[] = []
    client.onStatus((s) => seen.push(s.state))
    await client.request('GET /ext/state')
    await client.request('GET /ext/state')
    net.down(P[0])
    await client.request('GET /ext/state')
    expect(seen).toEqual(['connected', 'reconnect_needed'])
  })
})

describe('unpairing', () => {
  it('POST /ext/unpair with Bearer and erases token and cache', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { token: 'tok-A' }).route('POST /ext/unpair', () => ({ body: { ok: true, data: { revoked: true } } }))
    await seed()
    await chrome.storage.local.set({ [STORAGE_KEYS.stateCache]: { state: EXT_STATE_EXAMPLE, fetched_at: 1 } })
    const client = makeClient(net)

    const st = await client.unpair()

    expect(st.state).toBe('unpaired')
    expect(net.requests({ path: '/ext/unpair' })[0].headers.authorization).toBe('Bearer tok-A')
    expect(chromeFake().storage.has(STORAGE_KEYS.connection)).toBe(false)
    expect(chromeFake().storage.has(STORAGE_KEYS.stateCache)).toBe(false)
  })

  it('erases the local data even with the server down', async () => {
    await seed()
    const st = await makeClient(new FakeNet()).unpair()
    expect(st.state).toBe('unpaired')
    expect(chromeFake().storage.has(STORAGE_KEYS.connection)).toBe(false)
  })
})
