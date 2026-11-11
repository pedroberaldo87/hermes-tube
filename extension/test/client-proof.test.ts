// The client only trusts a server that proves it is this Hermes (lib/client.ts + lib/pake.ts):
// - pairing never sends the 6-digit code: PAKE rounds; a program on another port of the range that does not know
//   the code never gets anything, and the pairing continues with the real server;
// - the token is only sent to a port that answered `/health?device=&nonce=` with the right proof (stored port and
//   rediscovery alike); a stored pairing from before keeps working with a server that proves.
import { describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import { EXT_PORTS } from '../../shared/ids'
import { ExtClient, chromeConnectionStore, type StoredConnection } from '../src/lib/client'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { FakeNet } from './setup-net'

const P = EXT_PORTS
const CODE = '246810'

function makeClient(net: FakeNet) {
  return new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), now: () => 1_000 })
}

const stored = async () => (await chrome.storage.local.get(STORAGE_KEYS.connection))[STORAGE_KEYS.connection] as StoredConnection | undefined
const bodies = (net: FakeNet, port?: number) => net.requests({ path: '/pair/complete', port }).map((r) => r.body as Record<string, unknown>)
const withToken = (net: FakeNet, token: string) => net.log.filter((r) => r.headers.authorization === `Bearer ${token}`)

describe('pairing without sending the code', () => {
  it('two PAKE rounds, no `code` field anywhere, token stored with the port', async () => {
    const net = new FakeNet()
    net.addServer(P[2], { pairingCode: CODE, issuedToken: 'tok-real', deviceId: 'dev-real' })
    const res = await makeClient(net).pair(CODE, 'Chrome')
    expect(res.ok).toBe(true)
    const sent = bodies(net)
    expect(sent).toHaveLength(2)
    for (const b of sent) expect(b).not.toHaveProperty('code')
    expect(JSON.stringify(net.log)).not.toContain(CODE)
    expect((sent[0].pake as { x: string }).x).toMatch(/^[0-9a-f]{512}$/)
    expect(await stored()).toMatchObject({ port: P[2], token: 'tok-real', device_id: 'dev-real', auth: 'pake1' })
  })

  it('a program on a lower port that does not know the code gets no code and no second round; the real server pairs', async () => {
    const net = new FakeNet()
    const fake = net.addServer(P[0], { pairingCode: '999999', impostor: true })
    net.addServer(P[3], { pairingCode: CODE, issuedToken: 'tok-real', deviceId: 'dev-real' })
    const res = await makeClient(net).pair(CODE, 'Chrome')
    expect(res.ok).toBe(true)
    expect(bodies(net, P[0])).toHaveLength(1) // round 1 only: its confirmation did not match
    expect(JSON.stringify(net.requests({ port: P[0] }))).not.toContain(CODE)
    expect(fake.attempts).toBe(1)
    expect((await stored())?.port).toBe(P[3])
  })

  it('only impostors → it looks like a wrong code (server_unverified), nothing stored, no second round', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { pairingCode: CODE, impostor: true })
    const res = await makeClient(net).pair(CODE, 'Chrome')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatchObject({ code: 'invalid_code', reason: 'server_unverified' })
    expect(bodies(net)).toHaveLength(1)
    expect(await stored()).toBeUndefined()
  })

  it('an impostor that does not even say how many attempts are left → unauthorized/server_unverified', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { pairingCode: CODE }).route('POST /pair/complete', () => ({
      body: { ok: true, data: { pake: { session: 's', y: 'ab'.repeat(256), confirm: '00'.repeat(32) } } }
    }))
    const res = await makeClient(net).pair(CODE, 'Chrome')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatchObject({ code: 'unauthorized', reason: 'server_unverified' })
    expect(bodies(net)).toHaveLength(1)
  })

  it('a server from before the PAKE → server_outdated (the code is still not sent)', async () => {
    const net = new FakeNet()
    net.addServer(P[0], { pairingCode: CODE, legacyPairing: true })
    const res = await makeClient(net).pair(CODE, 'Chrome')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatchObject({ code: 'invalid', reason: 'server_outdated' })
    for (const b of bodies(net)) expect(b).not.toHaveProperty('code')
  })

  it('server errors of round 1 pass through (locked, no_active_code)', async () => {
    const net = new FakeNet()
    const s = net.addServer(P[0], { pairingCode: CODE })
    s.attempts = 4
    const res = await makeClient(net).pair(CODE, 'Chrome')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('locked')
  })
})

describe('the token only goes to a server that proves it knows it', () => {
  async function seed(conn: Partial<StoredConnection> = {}) {
    const full: StoredConnection = { port: P[0], token: 'tok-A', device_id: 'dev-A', paired_at: 1, ...conn }
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: full })
  }
  const state = () => ({ body: { ok: true, data: EXT_STATE_EXAMPLE } })

  it('stored port proves → the request goes with Bearer (a pairing from before the PAKE keeps working)', async () => {
    await seed()
    const net = new FakeNet()
    net.addServer(P[0], { token: 'tok-A', deviceId: 'dev-A' }).route('GET /ext/state', state)
    const client = makeClient(net)
    const res = await client.request('GET /ext/state')
    expect(res.ok).toBe(true)
    const health = net.requests({ path: '/health', port: P[0] })
    expect(health).toHaveLength(1)
    expect(health[0].query.device).toBe('dev-A')
    expect(health[0].query.nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(health[0].headers.authorization).toBeUndefined()
    // the proof is remembered for a while: no /health before every request
    await client.request('GET /ext/state')
    expect(net.requests({ path: '/health', port: P[0] })).toHaveLength(1)
  })

  it('something else on the stored port (no proof, or a wrong one) → the token is never sent; unauthorized', async () => {
    for (const opts of [{ proves: false }, { impostor: true }]) {
      chrome.storage.local.clear()
      await seed()
      const net = new FakeNet()
      net.addServer(P[0], { token: 'tok-A', deviceId: 'dev-A', ...opts }).route('GET /ext/state', state)
      const res = await makeClient(net).request('GET /ext/state')
      expect(res.ok, JSON.stringify(opts)).toBe(false)
      if (!res.ok) expect(res.error.reason).toBe('server_unverified')
      expect(withToken(net, 'tok-A')).toEqual([])
      expect((await stored())?.status?.state).toBe('unauthorized')
    }
  })

  it('rediscovery: the token goes only to the port that proves; another program in the range never sees it', async () => {
    await seed({ port: P[0] })
    const net = new FakeNet()
    net.addServer(P[1], { token: 'tok-A', deviceId: 'dev-A', impostor: true }).route('GET /ext/state', state)
    net.addServer(P[4], { token: 'tok-A', deviceId: 'dev-A' }).route('GET /ext/state', state)
    const res = await makeClient(net).request('GET /ext/state')
    expect(res.ok).toBe(true)
    expect(withToken(net, 'tok-A').map((r) => r.port)).toEqual([P[4]])
    expect((await stored())?.port).toBe(P[4])
  })

  it('the stored port went away and came back: it is checked again before the token', async () => {
    await seed()
    const net = new FakeNet()
    const real = net.addServer(P[0], { token: 'tok-A', deviceId: 'dev-A' }).route('GET /ext/state', state)
    const client = makeClient(net)
    expect((await client.request('GET /ext/state')).ok).toBe(true)
    net.down(P[0])
    expect((await client.request('GET /ext/state')).ok).toBe(false)
    // a program takes the port while Hermes is down
    net.addServer(P[0], { token: 'tok-A', deviceId: 'dev-A', impostor: true }).route('GET /ext/state', state)
    const before = withToken(net, 'tok-A').length
    expect((await client.request('GET /ext/state')).ok).toBe(false)
    expect(withToken(net, 'tok-A').length).toBe(before)
    void real
  })
})

describe('popup texts for the proof failures', () => {
  it('server_unverified and server_outdated have their own sentence; a wrong code keeps "attempts left"', async () => {
    const { pairErrorText } = await import('../src/popup/text')
    const { setLanguage } = await import('../src/lib/i18n')
    setLanguage('en')
    expect(pairErrorText({ code: 'unauthorized', message: 'x', reason: 'server_unverified' })).toMatch(/answered instead of Hermes/)
    expect(pairErrorText({ code: 'invalid', message: 'x', reason: 'server_outdated' })).toMatch(/Update the HermesTube plugin/)
    expect(pairErrorText({ code: 'invalid_code', message: 'x', reason: 'server_unverified', details: { remaining: 3 } })).toMatch(/3/)
  })
})
