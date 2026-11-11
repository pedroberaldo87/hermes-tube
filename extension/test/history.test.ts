// background/history: `watchOutbox` outbox in chrome.storage, batches ≤ 500 in POST /ext/sync/watch.
// Survives the service worker going to sleep; loses or duplicates no event on a network failure.
import { describe, expect, it } from 'vitest'
import type { WatchEvent } from '../../shared/api-types'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import { EXT_PORTS } from '../../shared/ids'
import { WATCH_BATCH_MAX, WATCH_REJECTED_KEY, createOutbox, history, probeWatchOwner } from '../src/background/history'
import { createBackground } from '../src/lib/background'
import { ExtClient, chromeConnectionStore } from '../src/lib/client'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { chromeFake } from './setup-chrome'
import { FakeNet, errorBody, type FakeResponse } from './setup-net'

const PORT = EXT_PORTS[0]
const CONN = { port: PORT, token: 'tok-A', device_id: 'dev-A', paired_at: 1 }

const vid = (n: number) => `v${String(n).padStart(10, '0')}`
const ev = (n: number, at = 1_762_700_000 + n): WatchEvent => ({ video_id: vid(n), watched_at: at, channel_id: null })

/** server with idempotent semantics by (video_id, watched_at) */
function world() {
  const net = new FakeNet()
  const server = net.addServer(PORT, { token: 'tok-A' })
  const stored = new Map<string, WatchEvent>()
  const batches: WatchEvent[][] = []
  let mode: 'ok' | 'down' | 'invalid' | 'unauthorized' | 'hang' = 'ok'
  let release: (() => void) | null = null
  server.route('GET /ext/state', () => ({ body: { ok: true, data: EXT_STATE_EXAMPLE } }))
  server.route('POST /ext/sync/watch', async (req): Promise<FakeResponse> => {
    const events = (req.body as { events: WatchEvent[] }).events
    if (mode === 'invalid') return { status: 422, body: errorBody('invalid', 'events[0].video_id: required') }
    if (mode === 'unauthorized') return { status: 401, body: errorBody('unauthorized') }
    if (mode === 'hang') await new Promise<void>((r) => (release = r))
    batches.push(events)
    let count = 0
    for (const e of events) {
      const k = `${e.video_id}|${e.watched_at}`
      if (!stored.has(k)) count++
      stored.set(k, e)
    }
    return { body: { ok: true, data: { count } } }
  })
  const client = () => new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), requestTimeoutMs: 60_000 })
  return {
    net,
    server,
    stored,
    batches,
    client,
    setMode: (m: typeof mode) => {
      mode = m
      if (m === 'down') net.down(PORT)
      else if (!net.servers.has(PORT)) net.servers.set(PORT, server)
    },
    release: () => release?.()
  }
}

const outboxNow = async (): Promise<WatchEvent[]> =>
  ((await chrome.storage.local.get(STORAGE_KEYS.watchOutbox))[STORAGE_KEYS.watchOutbox] as WatchEvent[] | undefined) ?? []

async function paired() {
  await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
}

describe('outbox (watchOutbox)', () => {
  it('sync.watch stores in chrome.storage and answers how many are queued', async () => {
    await paired()
    const w = world()
    const bg = createBackground({ client: w.client(), modules: [history] })
    const r1 = await bg.router.dispatch({ type: 'sync.watch', payload: ev(1) })
    const r2 = await bg.router.dispatch({ type: 'sync.watch', payload: ev(2) })
    expect(r1).toEqual({ ok: true, data: { queued: 1 } })
    expect(r2).toEqual({ ok: true, data: { queued: 2 } })
    expect(await outboxNow()).toEqual([ev(1), ev(2)])
    expect(w.net.requests({ path: '/ext/sync/watch' })).toHaveLength(0) // < 50: waits for the alarm
  })

  it('a repeated event (same video_id + watched_at) is stored only once; a malformed event is refused', async () => {
    await paired()
    const w = world()
    const bg = createBackground({ client: w.client(), modules: [history] })
    await bg.router.dispatch({ type: 'sync.watch', payload: ev(1) })
    const again = await bg.router.dispatch({ type: 'sync.watch', payload: ev(1) })
    expect(again).toEqual({ ok: true, data: { queued: 1 } })
    for (const bad of [{ video_id: '', watched_at: 1 }, { video_id: vid(3), watched_at: 1.5 }, { video_id: 'x y', watched_at: 10 }, { watched_at: 10 }]) {
      const r = await bg.router.dispatch({ type: 'sync.watch', payload: bad })
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('invalid')
    }
    expect(await outboxNow()).toEqual([ev(1)])
  })

  it('success empties it; the 30 s alarm (onState) triggers the send', async () => {
    await paired()
    const w = world()
    const bg = createBackground({ client: w.client(), modules: [history] })
    for (let i = 0; i < 3; i++) await bg.router.dispatch({ type: 'sync.watch', payload: ev(i) })
    await bg.refreshState() // = firing of ALARMS.state
    await chromeFake().flush()
    await expect.poll(outboxNow).toEqual([])
    expect(w.batches).toEqual([[ev(0), ev(1), ev(2)]])
    const [req] = w.net.requests({ path: '/ext/sync/watch' })
    expect(req.headers.authorization).toBe('Bearer tok-A')
  })

  it('on reaching 50 it sends right away', async () => {
    await paired()
    const w = world()
    const bg = createBackground({ client: w.client(), modules: [history] })
    for (let i = 0; i < 50; i++) await bg.router.dispatch({ type: 'sync.watch', payload: ev(i) })
    await expect.poll(() => w.batches.length).toBe(1)
    expect(w.batches[0]).toHaveLength(50)
    await expect.poll(outboxNow).toEqual([])
  })

  it('a network failure keeps everything (no resend loop); when it is back → sends once', async () => {
    await paired()
    const w = world()
    w.setMode('down')
    const box = createOutbox({ client: w.client() })
    for (let i = 0; i < 5; i++) await box.enqueue(ev(i))
    const r = await box.flush()
    expect(r).toMatchObject({ sent: 0, stopped: 'ext_endpoint_down' })
    expect(await outboxNow()).toHaveLength(5)
    // the stored port does not even answer its proof: nothing is sent, and no resend loop
    expect(w.net.requests({ path: '/ext/sync/watch' })).toHaveLength(0)
    expect(w.net.requests({ path: '/health', port: PORT }).length).toBeLessThanOrEqual(2)
    w.setMode('ok')
    expect(await box.flush()).toMatchObject({ sent: 5, stopped: null })
    expect(await outboxNow()).toEqual([])
    expect(w.stored.size).toBe(5)
  })

  it('server timeout keeps the events', async () => {
    await paired()
    const w = world()
    w.server.route('POST /ext/sync/watch', () => ({ body: { ok: true, data: { count: 1 } }, delayMs: 200 }))
    const box = createOutbox({ client: new ExtClient({ fetch: w.net.fetch, store: chromeConnectionStore(), requestTimeoutMs: 50 }) })
    await box.enqueue(ev(1))
    expect(await box.flush()).toMatchObject({ sent: 0, stopped: 'timeout' })
    expect(await outboxNow()).toEqual([ev(1)])
  })

  it(`1 200 events → 3 batches (≤ ${WATCH_BATCH_MAX}), in order, without repeats`, async () => {
    await paired()
    const w = world()
    const all = Array.from({ length: 1200 }, (_, i) => ev(i))
    await chrome.storage.local.set({ [STORAGE_KEYS.watchOutbox]: all })
    const box = createOutbox({ client: w.client() })
    expect(await box.flush()).toMatchObject({ sent: 1200, batches: 3, stopped: null })
    expect(w.batches.map((b) => b.length)).toEqual([500, 500, 200])
    expect(w.batches.flat()).toEqual(all)
    expect(await outboxNow()).toEqual([])
  })

  it('an event arriving during the send is not lost', async () => {
    await paired()
    const w = world()
    w.setMode('hang')
    const box = createOutbox({ client: w.client() })
    await box.enqueue(ev(1))
    const flushing = box.flush()
    await expect.poll(() => w.net.requests({ path: '/ext/sync/watch' }).length).toBe(1)
    await box.enqueue(ev(2))
    w.setMode('ok')
    w.release()
    await flushing
    await box.flush()
    expect(await outboxNow()).toEqual([])
    expect([...w.stored.keys()].sort()).toEqual([`${vid(1)}|${ev(1).watched_at}`, `${vid(2)}|${ev(2).watched_at}`])
  })

  it('SW restarted midway through the send → nothing lost or doubled', async () => {
    await paired()
    const w = world()
    const all = Array.from({ length: 700 }, (_, i) => ev(i))
    await chrome.storage.local.set({ [STORAGE_KEYS.watchOutbox]: all })
    // SW 1 starts sending the 1st batch and "dies" with the request in flight (the server has not answered yet)
    w.setMode('hang')
    const sw1 = createOutbox({ client: w.client() })
    void sw1.flush()
    await expect.poll(() => w.net.requests({ path: '/ext/sync/watch' }).length).toBe(1)
    expect(await outboxNow()).toHaveLength(700) // only leaves the outbox after the ok
    // SW 2 is reborn with the same storage and sends everything
    w.setMode('ok')
    const sw2 = createOutbox({ client: w.client() })
    expect(await sw2.flush()).toMatchObject({ sent: 700, stopped: null })
    expect(await outboxNow()).toEqual([])
    // the orphan request from SW 1 arrives later: the server is idempotent and the outbox stays empty
    w.release()
    await chromeFake().flush()
    await new Promise((r) => setTimeout(r, 20))
    expect(w.stored.size).toBe(700)
    expect(await outboxNow()).toEqual([])
    // 2 + 1 batches received (the first one twice), but each event stored once
    expect(w.batches.flat()).toHaveLength(700 + 500)
  })

  it('SW slept before sending: the next one wakes up and sends', async () => {
    await paired()
    const w = world()
    const bgA = createBackground({ client: w.client(), modules: [history] })
    for (let i = 0; i < 3; i++) await bgA.router.dispatch({ type: 'sync.watch', payload: ev(i) })
    // new SW (same storage); 30 s alarm → onState → send
    const bgB = createBackground({ client: w.client(), modules: [history] })
    await bgB.refreshState()
    await expect.poll(outboxNow).toEqual([])
    expect(w.stored.size).toBe(3)
  })

  it('422 invalid is a bug: takes the batch out of the queue, logs it and does not resend', async () => {
    await paired()
    const w = world()
    w.setMode('invalid')
    const box = createOutbox({ client: w.client() })
    await box.enqueue(ev(1))
    await box.enqueue(ev(2))
    expect(await box.flush()).toMatchObject({ sent: 0, stopped: 'invalid' })
    expect(await outboxNow()).toEqual([])
    const rejected = (await chrome.storage.local.get(WATCH_REJECTED_KEY))[WATCH_REJECTED_KEY] as { events: WatchEvent[]; error: { code: string } }[]
    expect(rejected[0].events).toEqual([ev(1), ev(2)])
    expect(rejected[0].error.code).toBe('invalid')
    await box.flush()
    await box.flush()
    expect(w.net.requests({ path: '/ext/sync/watch' })).toHaveLength(1)
  })

  it('401 or not paired: stops and keeps the events', async () => {
    await paired()
    const w = world()
    w.setMode('unauthorized')
    const box = createOutbox({ client: w.client() })
    await box.enqueue(ev(1))
    expect(await box.flush()).toMatchObject({ sent: 0, stopped: 'unauthorized' })
    expect(await outboxNow()).toEqual([ev(1)])
    await chrome.storage.local.remove(STORAGE_KEYS.connection)
    expect(await box.flush()).toMatchObject({ sent: 0, stopped: 'unauthorized' })
    expect(await outboxNow()).toEqual([ev(1)])
  })

  it('module declares the real route', () => {
    expect(history.REAL_ROUTES).toEqual(['POST /ext/sync/watch'])
    expect(history.MESSAGES).toEqual(['sync.watch'])
  })
})

// The signed-in page shows the owner only as `/@handle`; after a SPA switch the content script has no id at all.
// The background asks the tab's own player (MAIN world, read-only) for the owner of **that** video.
describe('owner of the watched video (MAIN world of the sender tab)', () => {
  const OWNER = 'UC4QobU6STFB0P71PMvOGN5A'
  const sender = { tab: { id: 7 } } as chrome.runtime.MessageSender

  function withProbe(answer: (inj: { func?: { name?: string }; args?: unknown[]; world?: string; target?: { tabId?: number } }) => unknown) {
    const calls: Array<{ func?: { name?: string }; args?: unknown[]; world?: string; target?: { tabId?: number } }> = []
    ;(chrome.scripting as unknown as { executeScript: unknown }).executeScript = async (inj: (typeof calls)[number]) => {
      calls.push(inj)
      return [{ result: answer(inj) }]
    }
    return calls
  }

  it('event without channel_id from a tab → filled from the player of that tab (same video only)', async () => {
    await paired()
    const w = world()
    const calls = withProbe(() => OWNER)
    const bg = createBackground({ client: w.client(), modules: [history] })
    const r = await bg.router.dispatch({ type: 'sync.watch', payload: ev(1) }, sender)
    expect(r.ok).toBe(true)
    expect(await outboxNow()).toEqual([{ ...ev(1), channel_id: OWNER }])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ world: 'MAIN', target: { tabId: 7 }, args: [vid(1)] })
    expect(calls[0].func?.name).toBe('probeWatchOwner')
  })

  it('probe answers nothing, garbage or throws → the event is kept with channel_id null', async () => {
    await paired()
    const w = world()
    const bg = createBackground({ client: w.client(), modules: [history] })
    const answers: unknown[] = [null, 'not-a-channel', { channelId: OWNER }]
    for (const [i, a] of answers.entries()) {
      withProbe(() => a)
      await bg.router.dispatch({ type: 'sync.watch', payload: ev(i) }, sender)
    }
    ;(chrome.scripting as unknown as { executeScript: unknown }).executeScript = async () => {
      throw new Error('Frame with ID 0 was removed.')
    }
    await bg.router.dispatch({ type: 'sync.watch', payload: ev(9) }, sender)
    expect((await outboxNow()).map((e) => e.channel_id)).toEqual([null, null, null, null])
  })

  it('event that already has the owner, or no sender tab → no probe', async () => {
    await paired()
    const w = world()
    const calls = withProbe(() => OWNER)
    const bg = createBackground({ client: w.client(), modules: [history] })
    await bg.router.dispatch({ type: 'sync.watch', payload: { ...ev(1), channel_id: 'UCsBjURrPoezykLs9EqgamOA' } }, sender)
    await bg.router.dispatch({ type: 'sync.watch', payload: ev(2) })
    expect(calls).toHaveLength(0)
    expect((await outboxNow()).map((e) => e.channel_id)).toEqual(['UCsBjURrPoezykLs9EqgamOA', null])
  })

  it('probeWatchOwner reads only a player response that describes the asked video', () => {
    const player = document.createElement('div')
    player.id = 'movie_player'
    let details: Record<string, unknown> = { videoId: vid(1), channelId: OWNER }
    ;(player as unknown as { getPlayerResponse: () => unknown }).getPlayerResponse = () => ({ videoDetails: details })
    document.body.append(player)
    try {
      expect(probeWatchOwner(vid(1))).toBe(OWNER)
      expect(probeWatchOwner(vid(2))).toBeNull() // player already on another video
      details = { videoId: vid(1), channelId: 'UC-too-short' }
      expect(probeWatchOwner(vid(1))).toBeNull()
      ;(player as unknown as { getPlayerResponse: () => unknown }).getPlayerResponse = () => {
        throw new Error('player not ready')
      }
      expect(probeWatchOwner(vid(1))).toBeNull()
    } finally {
      player.remove()
    }
  })
})
