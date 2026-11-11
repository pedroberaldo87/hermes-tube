// Background core (extension/src/lib/background.ts + background/index.ts): 30 s alarm
// while paired, ExtState cache, common messages and module registration.
import { describe, expect, it } from 'vitest'
import { ALARMS, STORAGE_KEYS, type ExtRequests } from '../../shared/ext-messages'
import { EXT_PORTS, EXT_STATE_ALARM_S } from '../../shared/ids'
import type { ExtState } from '../../shared/api-types'
import { createBackground, type BackgroundModule } from '../src/lib/background'
import { ExtClient, chromeConnectionStore } from '../src/lib/client'
import { BACKGROUND_MODULES } from '../src/lib/registry-background'
import { EXT_REQUEST_TYPES } from '../src/lib/routes'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { chromeFake } from './setup-chrome'
import { FakeNet } from './setup-net'

const PORT = EXT_PORTS[0]
const CONN = { port: PORT, token: 'tok-A', device_id: 'dev-A', paired_at: 1 }

function world(modules: readonly BackgroundModule[] = BACKGROUND_MODULES) {
  const net = new FakeNet()
  const server = net.addServer(PORT, { token: 'tok-A' })
  server.route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, search_pending: 2 } } }))
  const client = new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), now: () => 42_000 })
  const bg = createBackground({ client, modules, now: () => 42_000 })
  return { net, server, client, bg }
}

const send = <K extends keyof ExtRequests>(type: K, payload: ExtRequests[K]['req']) =>
  chromeFake().chrome.runtime.sendMessage({ type, payload }) as Promise<unknown>

describe('state alarm', () => {
  it('not paired: no alarm', async () => {
    const { bg } = world()
    bg.start()
    await chromeFake().flush()
    expect(chromeFake().alarms.has(ALARMS.state)).toBe(false)
  })

  it('paired: 30 s alarm (periodInMinutes 0.5)', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    const { bg } = world()
    bg.start()
    await chromeFake().flush()
    expect(chromeFake().alarms.get(ALARMS.state)?.periodInMinutes).toBe(EXT_STATE_ALARM_S / 60)
    expect(EXT_STATE_ALARM_S / 60).toBe(0.5)
  })

  it('does not recreate the existing alarm (does not push back the next firing)', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    await chrome.alarms.create(ALARMS.state, { periodInMinutes: 0.5 })
    const before = chromeFake().alarms.get(ALARMS.state)?.scheduledTime
    const { bg } = world()
    bg.start()
    await chromeFake().flush()
    expect(chromeFake().alarms.get(ALARMS.state)?.scheduledTime).toBe(before)
  })

  it('pairing sets the alarm and fetches the state right away; unpairing clears it', async () => {
    const { bg, net } = world()
    bg.start()
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    await chromeFake().flush()
    expect(chromeFake().alarms.has(ALARMS.state)).toBe(true)
    await expect.poll(() => net.requests({ path: '/ext/state' }).length).toBe(1)
    await chrome.storage.local.remove(STORAGE_KEYS.connection)
    await chromeFake().flush()
    expect(chromeFake().alarms.has(ALARMS.state)).toBe(false)
  })

  it('firing: GET /ext/state with Bearer, writes the cache and notifies the modules', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    const seen: ExtState[] = []
    const probe: BackgroundModule = {
      MODULE: 'probe',
      ROUTES: [],
      REAL_ROUTES: [],
      MESSAGES: [],
      register: (ctx) => {
        ctx.onState((s) => {
          seen.push(s)
        })
      }
    }
    const { bg, net } = world([...BACKGROUND_MODULES, probe])
    bg.start()
    await chromeFake().flush()
    const before = net.requests({ path: '/ext/state' }).length
    await chromeFake().fire(ALARMS.state)

    await expect.poll(() => net.requests({ path: '/ext/state' }).length).toBe(before + 1)
    const reqs = net.requests({ path: '/ext/state' })
    expect(reqs.at(-1)?.headers.authorization).toBe('Bearer tok-A')
    // the cache is written and the modules are told after the answer is read: wait for it, not for the request
    await expect.poll(() => chromeFake().storage.get(STORAGE_KEYS.stateCache)).toEqual({
      state: { ...EXT_STATE_EXAMPLE, search_pending: 2 },
      fetched_at: 42_000
    })
    await expect.poll(() => seen.at(-1)?.search_pending).toBe(2)
  })

  it('another module\'s alarm goes only to whoever registered it', async () => {
    const hits: string[] = []
    const mod: BackgroundModule = {
      MODULE: 'm',
      ROUTES: [],
      REAL_ROUTES: [],
      MESSAGES: [],
      register: (ctx) => ctx.onAlarm(ALARMS.sync, () => void hits.push('sync'))
    }
    const { bg, net } = world([mod])
    bg.start()
    await chromeFake().fire(ALARMS.sync)
    expect(hits).toEqual(['sync'])
    expect(net.requests({ path: '/ext/state' })).toHaveLength(0)
  })
})

describe('common messages', () => {
  it('every ExtRequests has a handler (core + modules)', () => {
    const { bg } = world()
    expect([...bg.router.types()].sort()).toEqual([...EXT_REQUEST_TYPES].sort())
  })

  it('state.get returns the cache; refresh forces GET /ext/state', async () => {
    const { bg, net } = world()
    bg.start()
    expect(await send('state.get', {})).toEqual({ ok: true, data: null })
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    await chromeFake().flush()
    // the new connection starts a fetch of its own; a refresh asked while it is in flight would join it
    await expect.poll(() => chromeFake().storage.get(STORAGE_KEYS.stateCache)).toBeTruthy()
    const n = net.requests({ path: '/ext/state' }).length
    const res = (await send('state.get', { refresh: true })) as { ok: boolean; data: ExtState }
    expect(res.ok).toBe(true)
    expect(res.data.search_pending).toBe(2)
    expect(net.requests({ path: '/ext/state' })).toHaveLength(n + 1)
    expect(await send('state.get', {})).toEqual(res)
  })

  it('conn.status without network; probe tests the connection', async () => {
    const { bg, net } = world()
    bg.start()
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    await chromeFake().flush()
    net.down(PORT)
    const before = net.log.length
    const st = (await send('conn.status', {})) as { ok: true; data: { state: string } }
    expect(net.log.length).toBe(before)
    expect(st.data.state).toBe('connected')
    const probed = (await send('conn.status', { probe: true })) as { ok: true; data: { state: string } }
    expect(probed.data.state).toBe('reconnect_needed')
  })

  it('feed.get, videos.state and read.mark go to the contract routes', async () => {
    const { bg, net, server } = world()
    server.route('GET /ext/feed', () => ({ body: { ok: true, data: { items: [], next_cursor: null, counts: { total: 0 } } } }))
    server.route('POST /ext/videos/state', () => ({ body: { ok: true, data: { changed: 1 } } }))
    server.route('POST /ext/read', () => ({ body: { ok: true, data: { changed: 3 } } }))
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    bg.start()

    await send('feed.get', { tab: 't-1', limit: 10, cursor: null })
    expect(await send('videos.state', { video_ids: ['abcdefghijk'], state: 'seen' })).toEqual({ ok: true, data: { changed: 1 } })
    expect(await send('read.mark', { kind: 'all' })).toEqual({ ok: true, data: { changed: 3 } })

    expect(net.requests({ path: '/ext/feed' })[0].query).toEqual({ tab: 't-1', limit: '10' })
    expect(net.requests({ path: '/ext/videos/state' })[0].body).toEqual({ video_ids: ['abcdefghijk'], state: 'seen' })
    expect(net.requests({ path: '/ext/read' })[0].body).toEqual({ kind: 'all' })
  })

  it('feed.get requires exactly one of tab/folder/channel', async () => {
    const { bg, net } = world()
    bg.start()
    const res = (await send('feed.get', { tab: 'a', folder: 'b' })) as { ok: boolean; error?: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid')
    expect(net.log).toHaveLength(0)
  })
})
