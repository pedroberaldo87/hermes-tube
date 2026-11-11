// background/pairing: 6-digit code → token, discovered port (or the "advanced" one, as the `port`
// parameter), alarms on/off, first sync (`trigger: 'pair'`) right after pairing, unpairing
// clears everything.
import { describe, expect, it } from 'vitest'
import type { Envelope } from '../../shared/api-types'
import { ALARMS, STORAGE_KEYS, type ConnectionStatus, type ExtRequests } from '../../shared/ext-messages'
import { EXT_PORTS, EXT_STATE_ALARM_S } from '../../shared/ids'
import { createPairing, deviceName, normalizeCode, PAIR_INFO_KEY, PAIR_PORT_KEY, parseAddress, ROUTES, REAL_ROUTES } from '../src/background/pairing'
import { sync as realSync } from '../src/background/sync'
import { createBackground, type BackgroundModule } from '../src/lib/background'
import { ExtClient, chromeConnectionStore } from '../src/lib/client'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { chromeFake } from './setup-chrome'
import { FakeNet, errorBody } from './setup-net'

const PORT = EXT_PORTS[2]
const CODE = '481516'
const TOKEN = 'tok_secret_value_never_shown_0123456789abcdef'

/** fake `sync.now`: only records (the real one belongs to the sync module). */
function syncProbe() {
  const calls: number[] = []
  const payloads: unknown[] = []
  const mod: BackgroundModule = {
    MODULE: 'background/sync',
    ROUTES: [],
    REAL_ROUTES: [],
    MESSAGES: ['sync.now'],
    register(ctx) {
      ctx.router.on('sync.now', (p) => {
        calls.push(Date.now())
        payloads.push(p)
        return { started: true }
      })
    }
  }
  return { mod, calls, payloads }
}

function world(opts: { pairingCode?: string; servers?: number[]; firstSyncDelayMs?: number; realSync?: boolean } = {}) {
  const net = new FakeNet()
  const servers = (opts.servers ?? [PORT]).map((p) =>
    net.addServer(p, { pairingCode: opts.pairingCode ?? CODE, issuedToken: TOKEN, deviceId: 'dev_1' })
  )
  for (const s of servers) s.route('GET /ext/state', () => ({ body: { ok: true, data: EXT_STATE_EXAMPLE } }))
  for (const s of servers) s.route('POST /ext/unpair', () => ({ body: { ok: true, data: { revoked: true } } }))
  const client = new ExtClient({ fetch: net.fetch, store: chromeConnectionStore() })
  const sync = syncProbe()
  const pairing = createPairing({
    firstSyncDelayMs: opts.firstSyncDelayMs ?? 0,
    deviceName: () => 'Chrome — macOS',
    clientFor: (ports) => new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), ports })
  })
  const bg = createBackground({ client, modules: [pairing, opts.realSync ? realSync : sync.mod] })
  bg.start()
  return { net, servers, client, bg, sync }
}

const send = <K extends keyof ExtRequests>(type: K, payload: ExtRequests[K]['req']) =>
  chromeFake().chrome.runtime.sendMessage({ type, payload }) as Promise<Envelope<ExtRequests[K]['res']>>

const settle = async () => {
  await chromeFake().flush()
  await new Promise((r) => setTimeout(r, 5))
  await chromeFake().flush()
}

describe('normalizeCode / parseAddress / deviceName', () => {
  it('keeps only the digits (pasting with a space, hyphen, surrounding text) and at most 6', () => {
    expect(normalizeCode('481 516')).toBe('481516')
    expect(normalizeCode('481-516')).toBe('481516')
    expect(normalizeCode(' 48-15 16 ')).toBe('481516')
    expect(normalizeCode('Código: 481516.')).toBe('481516')
    expect(normalizeCode('4815169999')).toBe('481516')
    expect(normalizeCode('٤٨١')).toBe('') // only ASCII 0-9
    expect(normalizeCode('')).toBe('')
  })

  it('advanced address: empty = automatic; port or http://127.0.0.1:port; anything else is invalid', () => {
    expect(parseAddress('')).toEqual({ ok: true, port: null })
    expect(parseAddress('  ')).toEqual({ ok: true, port: null })
    expect(parseAddress('47630')).toEqual({ ok: true, port: 47630 })
    expect(parseAddress('127.0.0.1:47630')).toEqual({ ok: true, port: 47630 })
    expect(parseAddress('http://127.0.0.1:47630/')).toEqual({ ok: true, port: 47630 })
    expect(parseAddress('http://localhost:47630')).toEqual({ ok: true, port: 47630 })
    expect(parseAddress('http://example.com:47630').ok).toBe(false)
    expect(parseAddress('http://127.0.0.1').ok).toBe(false)
    expect(parseAddress('99999').ok).toBe(false)
    expect(parseAddress('80').ok).toBe(false)
    expect(parseAddress('abc').ok).toBe(false)
  })

  it('device name: browser — system', () => {
    const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' }
    expect(deviceName(mac)).toBe('Chrome — macOS')
    const edge = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0' }
    expect(deviceName(edge)).toBe('Edge — Windows')
    const brave = { ...mac, brave: {} }
    expect(deviceName(brave)).toBe('Brave — macOS')
    expect(deviceName({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0 OPR/115.0' })).toBe('Opera — Linux')
    expect(deviceName({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/131.0' })).toBe('Chrome — ChromeOS')
    expect(deviceName({ userAgent: '' })).toBe('Chrome')
  })
})

describe('pair.submit', () => {
  it('exchanges the code for a token on the discovered port, stores the connection and the device name', async () => {
    const { net } = world()
    const res = await send('pair.submit', { code: CODE })
    expect(res.ok).toBe(true)
    const st = (res as { data: ConnectionStatus }).data
    expect(st).toMatchObject({ state: 'connected', port: PORT, device_id: 'dev_1' })
    expect(JSON.stringify(st)).not.toContain(TOKEN)

    // scanned the 10 ports and only tried the code where there is a server
    expect(new Set(net.requests({ path: '/health' }).map((r) => r.port))).toEqual(new Set(EXT_PORTS))
    // two PAKE rounds on that port; the code itself never travels
    const posts = net.requests({ path: '/pair/complete' })
    expect(posts).toHaveLength(2)
    expect(posts[0]).toMatchObject({ port: PORT, body: { name: 'Chrome — macOS', pake: { x: expect.any(String) } } })
    expect(JSON.stringify(net.log)).not.toContain(CODE)

    const stored = chromeFake().storage.get(STORAGE_KEYS.connection) as { port: number; token: string; device_id: string }
    expect(stored).toMatchObject({ port: PORT, token: TOKEN, device_id: 'dev_1' })
    expect(chromeFake().storage.get(PAIR_INFO_KEY)).toMatchObject({ device_name: 'Chrome — macOS' })
  })

  it('a code pasted with a space or hyphen is cleaned (the server confirms the same code)', async () => {
    const { net } = world()
    expect((await send('pair.submit', { code: '481-516' })).ok).toBe(true)
    expect(net.requests({ path: '/pair/complete' })).toHaveLength(2)
  })

  it('fewer than 6 digits: invalid without touching the network (does not burn an attempt)', async () => {
    const { net } = world()
    const res = await send('pair.submit', { code: '48151' })
    expect(res).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(net.log).toHaveLength(0)
  })

  it('sets the 30 s alarm, fetches the state and triggers the first sync (trigger: pair)', async () => {
    const { net, sync } = world()
    await send('pair.submit', { code: CODE })
    await settle()
    expect(chromeFake().alarms.get(ALARMS.state)?.periodInMinutes).toBe(EXT_STATE_ALARM_S / 60)
    await expect.poll(() => net.requests({ path: '/ext/state' }).length).toBeGreaterThanOrEqual(1)
    await expect.poll(() => sync.calls.length).toBe(1)
    expect(sync.payloads).toEqual([{ trigger: 'pair' }])
  })

  it('with the real sync module: the 1st sync records trigger "pair" and opens the visible tab (like "Sync now")', async () => {
    const created: chrome.tabs.CreateProperties[] = []
    const tabs = chrome.tabs as unknown as { create: (p: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab> }
    const create = tabs.create
    tabs.create = (p) => {
      created.push(p)
      return create(p)
    }
    // page without subscriptions: the scrape comes back empty and the sync ends without sending anything
    chromeFake().tabResponder = (_tab, msg) =>
      (msg as { type: string }).type === 'scrape.subscriptions' ? { ok: true, data: { channels: [], signal: 'partial', reason: 'empty' } } : errorBody('not_found')
    world({ realSync: true })
    await send('pair.submit', { code: CODE })
    for (let i = 0; i < 10 && (chromeFake().storage.get(STORAGE_KEYS.syncStatus) as { state?: string } | undefined)?.state !== 'error'; i++) {
      await settle()
    }
    const status = chromeFake().storage.get(STORAGE_KEYS.syncStatus) as { trigger: string; state: string }
    expect(status.trigger).toBe('pair')
    expect(created[0]).toMatchObject({ active: true })
  })

  it('sync.now from the popup without a trigger stays "manual"; an unknown trigger too', async () => {
    chromeFake().tabResponder = (_tab, msg) =>
      (msg as { type: string }).type === 'scrape.subscriptions' ? { ok: true, data: { channels: [], signal: 'partial', reason: 'empty' } } : errorBody('not_found')
    world({ realSync: true })
    const finished = async () => {
      for (let i = 0; i < 10 && (chromeFake().storage.get(STORAGE_KEYS.syncStatus) as { state?: string } | undefined)?.state !== 'error'; i++) await settle()
      return chromeFake().storage.get(STORAGE_KEYS.syncStatus) as { trigger: string; state: string }
    }
    await send('pair.submit', { code: CODE })
    expect((await finished()).trigger).toBe('pair')
    for (const payload of [{}, { trigger: 'alarm' }] as Array<ExtRequests['sync.now']['req']>) {
      await chrome.storage.local.remove(STORAGE_KEYS.syncStatus)
      expect((await send('sync.now', payload)).ok).toBe(true)
      expect((await finished()).trigger).toBe('manual')
    }
  })

  it('the first sync waits a little (the popup shows "connected" before the tab opens)', async () => {
    const { sync } = world({ firstSyncDelayMs: 60 })
    await send('pair.submit', { code: CODE })
    await settle()
    expect(sync.calls).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 90))
    expect(sync.calls).toHaveLength(1)
  })

  it.each([
    ['invalid_code', { details: { remaining: 3 } }],
    ['expired', {}],
    ['used', {}],
    ['locked', {}]
  ])('server error %s passes through (with details) and nothing is stored', async (code, extra) => {
    const { servers, sync } = world()
    servers[0].route('POST /pair/complete', () => ({ status: 400, body: errorBody(code, code, extra) }))
    const res = await send('pair.submit', { code: CODE })
    expect(res).toMatchObject({ ok: false, error: { code, ...extra } })
    await settle()
    expect(chromeFake().storage.has(STORAGE_KEYS.connection)).toBe(false)
    expect(chromeFake().storage.has(PAIR_INFO_KEY)).toBe(false)
    expect(chromeFake().alarms.size).toBe(0)
    expect(sync.calls).toHaveLength(0)
  })

  it('Hermes open with no active code → no_active_code (does not try the code)', async () => {
    const { net, servers } = world()
    servers[0].opts.pairingCode = undefined
    const res = await send('pair.submit', { code: CODE })
    expect(res).toMatchObject({ ok: false, error: { code: 'no_active_code' } })
    expect(net.requests({ path: '/pair/complete' })).toHaveLength(0)
  })

  it('nothing answering in the range → ext_endpoint_down', async () => {
    world({ servers: [] })
    const res = await send('pair.submit', { code: CODE })
    expect(res).toMatchObject({ ok: false, error: { code: 'ext_endpoint_down' } })
  })

  it('advanced address as a parameter (port): only that port is used and the choice is stored', async () => {
    const custom = 47700
    const { net } = world({ servers: [custom] })
    const res = await send('pair.submit', { code: CODE, port: custom })
    expect(res).toMatchObject({ ok: true, data: { state: 'connected', port: custom } })
    expect(new Set(net.log.map((r) => r.port))).toEqual(new Set([custom]))
    expect(chromeFake().storage.get(PAIR_PORT_KEY)).toBe(custom)
  })

  it('the stored choice does not apply without the parameter: no port = automatic discovery (and the memory is forgotten)', async () => {
    const { net } = world()
    await chrome.storage.local.set({ [PAIR_PORT_KEY]: 47700 })
    const res = await send('pair.submit', { code: CODE })
    expect(res).toMatchObject({ ok: true, data: { state: 'connected', port: PORT } })
    expect(new Set(net.requests({ path: '/health' }).map((r) => r.port))).toEqual(new Set(EXT_PORTS))
    expect(chromeFake().storage.has(PAIR_PORT_KEY)).toBe(false)
  })

  it('invalid port → invalid without touching the network', async () => {
    const { net } = world()
    for (const port of [80, 70000, 1.5, -1, '47615' as unknown as number]) {
      const res = await send('pair.submit', { code: CODE, port })
      expect(res, String(port)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    }
    expect(net.log).toHaveLength(0)
  })

  it('error with port: the choice is stored anyway (the advanced field remembers)', async () => {
    const custom = 47701
    world({ servers: [] })
    const res = await send('pair.submit', { code: CODE, port: custom })
    expect(res).toMatchObject({ ok: false, error: { code: 'ext_endpoint_down' } })
    expect(chromeFake().storage.get(PAIR_PORT_KEY)).toBe(custom)
  })
})

describe('pair.unpair', () => {
  async function pairedWorld() {
    const w = world()
    await send('pair.submit', { code: CODE })
    // the work pairing starts in the background (state, sync) ends before the test unpairs
    await expect.poll(() => w.net.requests({ path: '/ext/state' }).length).toBeGreaterThanOrEqual(1)
    await settle()
    await settle()
    // data that other modules store locally
    await chrome.storage.local.set({
      [STORAGE_KEYS.syncStatus]: { state: 'ok', sent: 10 },
      [STORAGE_KEYS.watchOutbox]: [{ video_id: 'dQw4w9WgXcQ', watched_at: 1 }],
      [STORAGE_KEYS.syncPending]: { batch: {} },
      [PAIR_PORT_KEY]: 47700
    })
    await chrome.alarms.create(ALARMS.sync, { periodInMinutes: 360 })
    return w
  }

  it('calls POST /ext/unpair with the token, erases all local storage and the alarms', async () => {
    const { net } = await pairedWorld()
    const res = await send('pair.unpair', {})
    expect(res).toMatchObject({ ok: true, data: { state: 'unpaired', port: null, device_id: null } })
    const [req] = net.requests({ path: '/ext/unpair' })
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`)
    await settle()
    await expect.poll(() => [...chromeFake().storage.keys()]).toEqual([])
    expect(chromeFake().alarms.size).toBe(0)
  })

  it('Hermes closed: erases the local data anyway', async () => {
    const { net } = await pairedWorld()
    net.down(PORT)
    const res = await send('pair.unpair', {})
    expect(res).toMatchObject({ ok: true, data: { state: 'unpaired' } })
    await settle()
    await expect.poll(() => [...chromeFake().storage.keys()]).toEqual([])
    expect(chromeFake().alarms.size).toBe(0)
  })
})

describe('module', () => {
  it('real routes = the contract routes it uses', () => {
    expect([...ROUTES].sort()).toEqual(['POST /ext/unpair', 'POST /pair/complete'])
    expect([...REAL_ROUTES].sort()).toEqual([...ROUTES].sort())
  })
})
