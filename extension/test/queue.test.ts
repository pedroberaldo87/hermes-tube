// background/queue: executor of the unsubscribe/resubscribe queue (ext-protocol.md).
// Invariant: nothing is unsubscribed without a human click → the extension only acts on what `GET /ext/queue` delivers (already
// `approved` by a human): never on chrome.storage, a page message or another tab; one at a time; 3–6 s pause;
// cap of 20 per round; stops on logged out, challenge, 2 failures in a row, "Stop"; a SW that is reborn reports the
// item in progress as `failed/interrupted` and never repeats it; each result is reported once.
import { describe, expect, it, vi } from 'vitest'
import type { ExtState, QueueItem } from '../../shared/api-types'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import { EXT_PORTS } from '../../shared/ids'
import {
  MAX_CONSECUTIVE_FAILURES,
  PAUSE_MAX_MS,
  PAUSE_MIN_MS,
  QUEUE_CTL_KEY,
  QUEUE_LEDGER_KEY,
  QUEUE_RUN_KEY,
  ROUND_CAP,
  channelPageUrl,
  createQueueModule,
  queue,
  requestQueueStop,
  resumeQueue,
  type QueueProgress
} from '../src/background/queue'
import { createBackground } from '../src/lib/background'
import { QUEUE_RELEASE_KEY, QUEUE_WAITING_KEY, releaseQueue, snoozeQueue, type QueueRelease, type QueueWaiting } from '../src/lib/queue-release'
import { ExtClient, chromeConnectionStore } from '../src/lib/client'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { chromeFake } from './setup-chrome'
import { FakeNet, errorBody, type FakeResponse } from './setup-net'

const PORT = EXT_PORTS[0]
const CONN = { port: PORT, token: 'tok-A', device_id: 'dev-A', paired_at: 1 }
const uc = (n: number) => `UC${String(n).padStart(22, 'q')}`

type Status = QueueItem['status']
type Exec = { status: 'done' | 'failed'; error: string | null }

// ---------------------------------------------------------------- fake queue server
interface ServerItem {
  item: QueueItem
  status: Status
}

function item(n: number, action: QueueItem['action'] = 'unsubscribe'): QueueItem {
  return {
    id: `q_${n}`,
    channel_id: uc(n),
    action,
    status: 'approved',
    approved_at: 1762700000 + n,
    approved_via: 'desktop_rpc',
    created_at: 1762700000,
    updated_at: 1762700000,
    reason: null,
    error: null,
    device_id: null
  }
}

// ---------------------------------------------------------------- browser: windows, tabs, focus
function browserModel() {
  const fake = chromeFake()
  const windowOf = new Map<number, number>()
  const created: chrome.tabs.CreateProperties[] = []
  let nextId = 700
  const inWindow = (w: number) => [...windowOf.entries()].filter(([id, win]) => win === w && fake.tabs.has(id)).map(([id]) => id)
  const activate = (id: number) => {
    const w = windowOf.get(id) ?? 1
    for (const other of inWindow(w)) fake.tabs.get(other)!.active = other === id
  }
  const view = (id: number) => {
    const t = fake.tabs.get(id)
    return t ? { ...t, windowId: windowOf.get(id) ?? 1 } : null
  }
  const remove = (id: number) => {
    const wasActive = fake.tabs.get(id)?.active
    if (!fake.tabs.delete(id)) return
    fake.events.tabRemoved.emit(id, { windowId: windowOf.get(id) ?? 1, isWindowClosing: false })
    const rest = inWindow(windowOf.get(id) ?? 1)
    if (wasActive && rest.length) activate(rest[rest.length - 1]) // "Chrome" activates the last one, not the origin
  }
  const tabs = chrome.tabs as unknown as Record<string, unknown>
  tabs.create = async (props: chrome.tabs.CreateProperties) => {
    created.push({ ...props })
    const id = nextId++
    fake.tabs.set(id, { id, url: props.url ?? 'about:blank', active: false, status: 'complete' })
    windowOf.set(id, props.windowId ?? 1)
    if (props.active !== false) activate(id)
    return view(id)
  }
  tabs.get = async (id: number) => {
    const v = view(id)
    if (!v) throw new Error(`No tab with id: ${id}.`)
    return v
  }
  tabs.update = async (id: number, props: chrome.tabs.UpdateProperties) => {
    const t = fake.tabs.get(id)
    if (!t) throw new Error(`No tab with id: ${id}.`)
    if (props.url) t.url = redirect(props.url)
    if (props.active) activate(id)
    return view(id)
  }
  tabs.remove = async (ids: number | number[]) => {
    for (const id of Array.isArray(ids) ? ids : [ids]) remove(id)
  }
  tabs.query = async (q: chrome.tabs.QueryInfo = {}) =>
    [...fake.tabs.keys()].map(view).filter((v): v is NonNullable<ReturnType<typeof view>> => !!v && (q.active === undefined || v.active === q.active))
  let redirect = (u: string) => u
  return {
    created,
    openTab(url: string) {
      const id = nextId++
      fake.tabs.set(id, { id, url, active: false, status: 'complete' })
      windowOf.set(id, 1)
      activate(id)
      return id
    },
    isActive: (id: number) => fake.tabs.get(id)?.active === true,
    closeTab: (id: number) => remove(id),
    setRedirect: (fn: (u: string) => string) => (redirect = fn),
    tabIds: () => [...fake.tabs.keys()]
  }
}

// ---------------------------------------------------------------- world
interface WorldOpts {
  items?: QueueItem[]
  /** content script result per channel (default: done) */
  exec?: (channelId: string, payload: Record<string, unknown>) => Exec | Promise<Exec>
  random?: () => number
  sleep?: (ms: number) => Promise<void>
  /** uses the module's real pause (setTimeout; stops the fake clock) */
  realSleep?: boolean
  paired?: boolean
  statePending?: number
  browser?: ReturnType<typeof browserModel>
  /** server down since before the SW was born (`net.servers.set(PORT, w.server)` brings it back) */
  startDown?: boolean
  /** no automatic "Run now" before each tick (the release tests click themselves) */
  manual?: boolean
}

async function world(opts: WorldOpts = {}) {
  if (opts.paired !== false) await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
  const net = new FakeNet()
  const server = net.addServer(PORT, { token: 'tok-A' })
  const items = new Map<string, ServerItem>((opts.items ?? []).map((i) => [i.id, { item: i, status: 'approved' as Status }]))
  const order = [...items.keys()]
  let getReply: (() => FakeResponse) | null = null
  let postReply: ((id: string, body: { status: string; error?: string | null }) => FakeResponse | null) | null = null
  const posts: Array<{ id: string; status: string; error: string | null | undefined }> = []
  server.route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, queue_pending: opts.statePending ?? items.size } } }))
  server.route('GET /ext/queue', (req) => {
    if (req.query.peek === '1') {
      // list without lending: every approved item, oldest first
      const all = [...items.values()].filter((x) => x.status === 'approved')
      const channels = Object.fromEntries(all.map((x) => [x.item.channel_id, { id: x.item.channel_id, title: `Canal ${x.item.id}`, url: null, handle: null }]))
      return { body: { ok: true, data: { items: all.map((x) => ({ ...x.item, status: x.status })), channels } } }
    }
    if (getReply) return getReply()
    if ([...items.values()].some((x) => x.status === 'running')) return { body: { ok: true, data: { items: [], channels: {} } } }
    const next = order.map((id) => items.get(id)!).find((x) => x.status === 'approved')
    if (!next) return { body: { ok: true, data: { items: [], channels: {} } } }
    const channel = { id: next.item.channel_id, title: `Canal ${next.item.id}`, url: null, handle: null }
    return { body: { ok: true, data: { items: [{ ...next.item, status: next.status }], channels: { [next.item.channel_id]: channel } } } }
  })
  server.route('POST /ext/queue/{id}/result', (req, params) => {
    const body = req.body as { status: string; error?: string | null }
    posts.push({ id: params.id, status: body.status, error: body.error })
    const forced = postReply?.(params.id, body)
    if (forced) return forced
    const it = items.get(params.id)
    if (!it) return { status: 404, body: errorBody('not_found') }
    if (it.status === 'undone') return { status: 409, body: errorBody('conflict', 'undone') }
    if (it.status === body.status) return { body: { ok: true, data: { ...it.item, status: it.status } } }
    const next: Record<string, string[]> = { approved: ['running', 'done', 'failed'], running: ['done', 'failed'] }
    if (!(next[it.status] ?? []).includes(body.status)) return { status: 409, body: errorBody('conflict', 'finished') }
    it.status = body.status as Status
    return { body: { ok: true, data: { ...it.item, status: it.status } } }
  })

  const fake = chromeFake()
  const browser = opts.browser ?? browserModel()
  const executed: Array<{ tabId: number; payload: Record<string, unknown> }> = []
  let inflight = 0
  let maxInflight = 0
  fake.tabResponder = async (tabId, msg) => {
    const m = msg as { type: string; payload: Record<string, unknown> }
    if (m.type !== 'queue.execute') return errorBody('not_found', m.type)
    executed.push({ tabId, payload: m.payload })
    inflight++
    maxInflight = Math.max(maxInflight, inflight)
    try {
      const id = String(m.payload.channel_id ?? '')
      const out = opts.exec ? await opts.exec(id, m.payload) : { status: 'done' as const, error: null }
      return { ok: true, data: out }
    } finally {
      inflight--
    }
  }
  const sleeps: number[] = []
  const sleep = opts.sleep ?? (async (ms: number) => void sleeps.push(ms))
  if (opts.startDown) net.down(PORT)
  const client = new ExtClient({ fetch: net.fetch, store: chromeConnectionStore() })
  const mod = createQueueModule({ sleep: opts.realSleep ? undefined : sleep, random: opts.random })
  const bg = createBackground({ client, modules: [mod] })
  bg.start()
  return {
    net,
    server,
    items,
    posts,
    executed,
    sleeps,
    bg,
    fake,
    browser,
    mod,
    maxInflight: () => maxInflight,
    /** `GET /ext/queue` that lend an item (the listing for the prompt is not counted) */
    gets: () => net.requests({ path: '/ext/queue' }).filter((r) => r.query.peek !== '1'),
    peeks: () => net.requests({ path: '/ext/queue' }).filter((r) => r.query.peek === '1'),
    setGet: (fn: (() => FakeResponse) | null) => (getReply = fn),
    setPost: (fn: typeof postReply) => (postReply = fn),
    /**
     * a new `ExtState` (the 30 s alarm) and waits for the round to finish. Unless `manual`, the user clicks
     * "Run now" for every approved item first (the release the popup writes).
     */
    async tick() {
      if (!opts.manual) await releaseQueue([...items.keys()], Date.now())
      await bg.refreshState()
      await mod.idle()
    }
  }
}

const progress = async () => (await chrome.storage.local.get(QUEUE_RUN_KEY))[QUEUE_RUN_KEY] as QueueProgress | undefined
const ledger = async () => ((await chrome.storage.local.get(QUEUE_LEDGER_KEY))[QUEUE_LEDGER_KEY] ?? {}) as Record<string, { status: string; reported: boolean }>
const resultPosts = (w: Awaited<ReturnType<typeof world>>) => w.posts.filter((p) => p.status !== 'running')

describe('only what /ext/queue delivers', () => {
  it('queue_pending > 0 → GET /ext/queue → running → channel tab by id → queue.execute → done', async () => {
    const w = await world({ items: [item(1)] })
    await w.tick()
    expect(w.gets()).toHaveLength(1) // only the released item: nothing else is asked for
    expect(w.posts).toEqual([
      { id: 'q_1', status: 'running', error: undefined },
      { id: 'q_1', status: 'done', error: null }
    ])
    expect(w.executed).toHaveLength(1)
    expect(w.executed[0].payload).toMatchObject({
      queue_id: 'q_1',
      action: 'unsubscribe',
      channel_url: `https://www.youtube.com/channel/${uc(1)}`,
      channel_id: uc(1),
      channel_title: 'Canal q_1'
    })
    expect(channelPageUrl(uc(1))).toBe(`https://www.youtube.com/channel/${uc(1)}`)
    expect(w.items.get('q_1')!.status).toBe('done')
  })

  it('queue_pending = 0 → does not even ask the queue', async () => {
    const w = await world({ items: [item(1)], statePending: 0 })
    await w.tick()
    expect(w.gets()).toHaveLength(0)
    expect(w.executed).toHaveLength(0)
  })

  it('not paired → nothing', async () => {
    const w = await world({ items: [item(1)], paired: false })
    await w.bg.refreshState()
    await w.mod.idle()
    expect(w.gets()).toHaveLength(0)
    expect(w.executed).toHaveLength(0)
  })

  it('empty queue (even with queue_pending > 0) → no tab, no command', async () => {
    const w = await world({ items: [], statePending: 3 })
    await w.tick()
    expect(w.gets()).toHaveLength(0) // nothing released: only the listing
    expect(w.peeks()).toHaveLength(1)
    expect(w.fake.tabs.size).toBe(0)
    expect(w.executed).toHaveLength(0)
  })

  it('item outside the contract (not approved, no approved_via, invalid channel id, odd action) → nothing runs', async () => {
    const bad: Array<Partial<QueueItem> & Record<string, unknown>> = [
      { status: 'running' },
      { status: 'done' },
      { approved_via: '' as never },
      { approved_via: null as never },
      { approved_at: 0 },
      { channel_id: 'not-a-channel' },
      { channel_id: '@fireship' },
      { action: 'delete' as never },
      { id: '' }
    ]
    for (const over of bad) {
      const w = await world({ items: [], statePending: 1 })
      w.setGet(() => ({ body: { ok: true, data: { items: [{ ...item(9), ...over }], channels: {} } } }))
      await w.tick()
      expect(w.executed, JSON.stringify(over)).toHaveLength(0)
      expect(w.posts, JSON.stringify(over)).toHaveLength(0)
    }
  })

  it('an item that only exists in chrome.storage (forged or from another SW lifetime) is never executed', async () => {
    // q_8: "cache" of an item that never went through execution; q_7: item in progress from another SW lifetime
    await chrome.storage.local.set({
      queue_items: [item(8)],
      queue_next: item(8),
      [QUEUE_RUN_KEY]: { state: 'idle', current: { queue_id: 'q_7', channel_id: uc(7), action: 'unsubscribe', phase: 'claimed', started_at: 1 } }
    })
    // server with nothing approved, but the state says there are pending items
    const w = await world({ items: [], statePending: 2 })
    await w.mod.idle()
    await w.tick()
    expect(w.executed).toHaveLength(0)
    expect(w.fake.tabs.size).toBe(0)
    expect(w.posts.filter((p) => p.status !== 'failed')).toEqual([]) // at most the interruption report
  })

  it('server down: nothing runs', async () => {
    const w = await world({ items: [item(7)] })
    await w.mod.idle()
    w.net.down(PORT)
    await w.bg.refreshState().catch(() => undefined)
    await w.mod.idle()
    expect(w.executed).toHaveLength(0)
    expect(w.fake.tabs.size).toBe(0)
  })

  it('page/content script message asking the background to execute → refused, nothing runs', async () => {
    const w = await world({ items: [item(1)], statePending: 0 })
    const r = await w.bg.router.dispatch({ type: 'queue.execute', payload: { queue_id: 'q_1', action: 'unsubscribe', channel_url: channelPageUrl(uc(1)) } })
    expect(r.ok).toBe(false)
    const r2 = await w.bg.router.dispatch({ type: 'queue.run', payload: { items: [item(1)] } })
    expect(r2.ok).toBe(false)
    await w.mod.idle()
    expect(w.executed).toHaveLength(0)
    // only the popup's (which stop/release and never execute)
    expect(queue.MESSAGES).toEqual(['queue.stop', 'queue.resume'])
  })

  it('409 conflict on running (undone on the Desktop / another device) → skips without executing', async () => {
    const w = await world({ items: [item(1), item(2)] })
    w.items.get('q_1')!.status = 'undone'
    w.setGet(null)
    // the queue still delivers q_1 once (undone between delivery and running)
    let first = true
    w.setGet(() => {
      if (first) {
        first = false
        return { body: { ok: true, data: { items: [{ ...item(1) }], channels: {} } } }
      }
      const next = [...w.items.values()].find((x) => x.status === 'approved')
      return { body: { ok: true, data: { items: next ? [next.item] : [], channels: {} } } }
    })
    await w.tick()
    expect(w.executed.map((e) => e.payload.queue_id)).toEqual(['q_2'])
    expect(w.posts.filter((p) => p.id === 'q_1')).toEqual([{ id: 'q_1', status: 'running', error: undefined }])
  })
})

describe('one at a time, pause, cap', () => {
  it('three items: one at a time, in order, 3–6 s pause between them (none after the last)', async () => {
    const w = await world({ items: [item(1), item(2), item(3)], random: () => 0.5 })
    await w.tick()
    expect(w.executed.map((e) => e.payload.queue_id)).toEqual(['q_1', 'q_2', 'q_3'])
    expect(w.maxInflight()).toBe(1)
    expect(w.sleeps).toHaveLength(2)
    for (const ms of w.sleeps) {
      expect(ms).toBeGreaterThanOrEqual(PAUSE_MIN_MS)
      expect(ms).toBeLessThanOrEqual(PAUSE_MAX_MS)
    }
    expect([PAUSE_MIN_MS, PAUSE_MAX_MS]).toEqual([3000, 6000])
  })

  it('the random pause covers 3 s and 6 s at the extremes', async () => {
    const lo = await world({ items: [item(1), item(2)], random: () => 0 })
    await lo.tick()
    expect(lo.sleeps).toEqual([3000])
    // same chrome.storage as the test: new ids (the ledger already has q_1/q_2)
    const hi = await world({ items: [item(3), item(4)], random: () => 0.999999 })
    await hi.tick()
    expect(hi.sleeps[0]).toBeGreaterThan(5990)
    expect(hi.sleeps[0]).toBeLessThanOrEqual(6000)
  })

  it('fake clock: the 2nd item only starts (running + page) after the pause (4.5 s with random 0.5)', async () => {
    // real timers first: the server's proof (WebCrypto) is checked and remembered before the clock is faked
    const w = await world({ items: [item(1), item(2)], random: () => 0.5, realSleep: true, manual: true })
    await w.bg.refreshState()
    await w.mod.idle()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const running = () => w.posts.filter((p) => p.status === 'running').map((p) => p.id)
      await releaseQueue(['q_1', 'q_2'])
      void w.bg.refreshState()
      await vi.advanceTimersByTimeAsync(300)
      expect(w.executed).toHaveLength(1)
      expect(running()).toEqual(['q_1'])
      await vi.advanceTimersByTimeAsync(4000)
      expect(w.executed).toHaveLength(1)
      expect(running()).toEqual(['q_1'])
      await vi.advanceTimersByTimeAsync(1000)
      expect(running()).toEqual(['q_1', 'q_2'])
      expect(w.executed).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(w.executed).toHaveLength(2)
      expect(w.sleeps).toEqual([]) // real pause, not the injected one
    } finally {
      vi.useRealTimers()
    }
  })

  it('two ExtStates in a row during the round do not open a second round (one tab, one command at a time)', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const w = await world({
      items: [item(1), item(2)],
      exec: async () => {
        await gate
        return { status: 'done', error: null }
      }
    })
    await releaseQueue(['q_1', 'q_2'])
    await w.bg.refreshState()
    await w.bg.refreshState()
    await w.bg.refreshState()
    await expect.poll(() => w.executed.length).toBe(1)
    await new Promise((r) => setTimeout(r, 30))
    expect(w.executed).toHaveLength(1)
    release()
    await w.mod.idle()
    expect(w.executed.map((e) => e.payload.queue_id)).toEqual(['q_1', 'q_2'])
    expect(w.maxInflight()).toBe(1)
    expect(w.browser.created).toHaveLength(1) // the same tab for the whole round
  })

  it(`cap of ${ROUND_CAP} per round; the next ExtState right after does not restart`, async () => {
    const many = Array.from({ length: ROUND_CAP + 5 }, (_, i) => item(i + 1))
    const w = await world({ items: many })
    await w.tick()
    expect(w.executed).toHaveLength(ROUND_CAP)
    expect((await progress())?.hold_reason).toBe('cap')
    await w.tick()
    expect(w.executed).toHaveLength(ROUND_CAP)
  })
})

describe('stops', () => {
  it(`${MAX_CONSECUTIVE_FAILURES} failures in a row → stops (the 3rd does not run) and holds the queue`, async () => {
    const w = await world({
      items: [item(1), item(2), item(3)],
      exec: (id) => (id === uc(3) ? { status: 'done', error: null } : { status: 'failed', error: 'button_not_found' })
    })
    await w.tick()
    expect(w.executed.map((e) => e.payload.queue_id)).toEqual(['q_1', 'q_2'])
    expect(resultPosts(w)).toEqual([
      { id: 'q_1', status: 'failed', error: 'button_not_found' },
      { id: 'q_2', status: 'failed', error: 'button_not_found' }
    ])
    expect(await progress()).toMatchObject({ state: 'paused', hold_reason: 'failures' })
    await w.tick()
    expect(w.executed).toHaveLength(2)
  })

  it('one failure (wrong_channel) in the middle does not take down the others', async () => {
    const w = await world({
      items: [item(1), item(2), item(3)],
      exec: (id) => (id === uc(2) ? { status: 'failed', error: 'wrong_channel' } : { status: 'done', error: null })
    })
    await w.tick()
    expect(resultPosts(w).map((p) => `${p.id}:${p.status}:${p.error}`)).toEqual(['q_1:done:null', 'q_2:failed:wrong_channel', 'q_3:done:null'])
  })

  it('logged out → stops at once (the rest is left for later)', async () => {
    const w = await world({ items: [item(1), item(2)], exec: () => ({ status: 'failed', error: 'logged_out' }) })
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect(await progress()).toMatchObject({ state: 'paused', hold_reason: 'logged_out' })
  })

  it('tab landed on the Google login → logged_out without sending a command to the page', async () => {
    const w = await world({ items: [item(1), item(2)] })
    w.browser.setRedirect(() => 'https://accounts.google.com/ServiceLogin?continue=x')
    await w.tick()
    expect(w.executed).toHaveLength(0)
    expect(resultPosts(w)).toEqual([{ id: 'q_1', status: 'failed', error: 'logged_out' }])
    expect(await progress()).toMatchObject({ hold_reason: 'logged_out' })
  })

  it('captcha/challenge (/sorry page or challenge response) → stops', async () => {
    const w = await world({ items: [item(1), item(2)] })
    w.browser.setRedirect(() => 'https://www.google.com/sorry/index?continue=x')
    await w.tick()
    expect(w.executed).toHaveLength(0)
    expect(resultPosts(w)).toEqual([{ id: 'q_1', status: 'failed', error: 'challenge' }])
    expect(await progress()).toMatchObject({ state: 'paused', hold_reason: 'challenge' })
  })

  it('page answers challenge → stops and holds', async () => {
    const w = await world({ items: [item(1), item(2)], exec: () => ({ status: 'failed', error: 'challenge' }) })
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect(await progress()).toMatchObject({ state: 'paused', hold_reason: 'challenge' })
  })

  it('"Stop" (popup or notice) in the middle → finishes the current item, takes no other and does not restart on its own; resume brings it back', async () => {
    const w = await world({
      items: [item(1), item(2), item(3)],
      exec: async (id) => {
        if (id === uc(2)) await requestQueueStop('popup')
        return { status: 'done', error: null }
      }
    })
    await w.tick()
    expect(w.executed.map((e) => e.payload.queue_id)).toEqual(['q_1', 'q_2'])
    expect(await progress()).toMatchObject({ state: 'stopped' })
    await w.tick()
    expect(w.executed).toHaveLength(2)
    await resumeQueue()
    await w.tick()
    expect(w.executed.map((e) => e.payload.queue_id)).toEqual(['q_1', 'q_2', 'q_3'])
  })

  it('"Stop" during the pause between items → does not take the next one', async () => {
    const w = await world({
      items: [item(1), item(2)],
      sleep: async () => {
        await requestQueueStop('popup')
      }
    })
    await w.tick()
    expect(w.executed).toHaveLength(1)
    // q_2 was even delivered (and stays leased for 5 min), but did not even get `running`
    expect(w.posts.filter((p) => p.id === 'q_2')).toEqual([])
  })

  it('content returns stopped (Stop on the notice) → stops the round', async () => {
    const w = await world({ items: [item(1), item(2)], exec: () => ({ status: 'failed', error: 'stopped' }) })
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect(resultPosts(w)).toEqual([{ id: 'q_1', status: 'failed', error: 'stopped' }])
    expect(await progress()).toMatchObject({ state: 'stopped' })
  })

  it('user closes the queue tab → counts as Stop', async () => {
    let w: Awaited<ReturnType<typeof world>> | null = null
    w = await world({
      items: [item(1), item(2)],
      exec: async () => {
        const tab = w!.browser.tabIds().find((id) => (chromeFake().tabs.get(id)?.url ?? '').includes('/channel/'))!
        w!.browser.closeTab(tab)
        return new Promise<Exec>(() => undefined) // the page is gone: never answers
      }
    })
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect(resultPosts(w)).toEqual([{ id: 'q_1', status: 'failed', error: 'tab_closed' }])
    expect(await progress()).toMatchObject({ state: 'stopped' })
  })
})

describe('never twice; result once', () => {
  it('a failure is not repeated: the queue returns the same id again → does not run again', async () => {
    const w = await world({ items: [item(1)], exec: () => ({ status: 'failed', error: 'confirm_not_found' }) })
    // server that "forgot" the result: keeps delivering q_1 as approved
    w.setGet(() => ({ body: { ok: true, data: { items: [item(1)], channels: {} } } }))
    w.setPost((_id, body) => (body.status === 'running' ? null : { body: { ok: true, data: item(1) } }))
    await w.tick()
    await w.tick()
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect(resultPosts(w)).toHaveLength(1)
  })

  it('done is not repeated either (contract example always delivered the same)', async () => {
    const w = await world({ items: [item(1)] })
    w.setGet(() => ({ body: { ok: true, data: { items: [item(1)], channels: {} } } }))
    w.setPost(() => ({ body: { ok: true, data: item(1) } }))
    await w.tick()
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect(resultPosts(w)).toEqual([{ id: 'q_1', status: 'done', error: null }])
  })

  it('result reported once; network dropped on the report → keeps it and reports on the next ExtState, without executing again', async () => {
    const w = await world({ items: [item(1)] })
    let down = true
    w.setPost((_id, body) => (body.status !== 'running' && down ? { status: 503, body: errorBody('ext_endpoint_down', 'x') } : null))
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect((await ledger()).q_1).toMatchObject({ status: 'done', reported: false })
    down = false
    await w.tick()
    expect(w.executed).toHaveLength(1)
    expect(w.posts.filter((p) => p.status === 'done' && p.id === 'q_1')).toHaveLength(2) // 1 that failed + 1 accepted
    expect((await ledger()).q_1).toMatchObject({ status: 'done', reported: true })
    await w.tick()
    expect(w.posts.filter((p) => p.status === 'done' && p.id === 'q_1')).toHaveLength(2)
  })

  it('SW reborn with an item in progress → reports failed/interrupted, closes the orphan tab, returns focus and never repeats', async () => {
    const b = browserModel()
    const origin = b.openTab('https://example.org/origem')
    const orphan = (await chrome.tabs.create({ url: channelPageUrl(uc(1)), active: true, windowId: 1 })).id!
    expect(b.isActive(origin)).toBe(false)
    await chrome.storage.local.set({
      [QUEUE_RUN_KEY]: {
        state: 'running',
        tab_id: orphan,
        origin_tab_id: origin,
        current: { queue_id: 'q_1', channel_id: uc(1), action: 'unsubscribe', phase: 'executing', started_at: 1 }
      }
    })
    const w = await world({ items: [item(1), item(2)], statePending: 0, browser: b })
    w.items.get('q_1')!.status = 'running'
    await w.mod.idle()
    await expect.poll(() => w.posts.find((p) => p.id === 'q_1' && p.status === 'failed')).toEqual({ id: 'q_1', status: 'failed', error: 'interrupted' })
    await expect.poll(() => chromeFake().tabs.has(orphan)).toBe(false)
    expect(chromeFake().tabs.get(origin)?.active).toBe(true)
    // the queue goes back to delivering q_1 (server lost the report): does not run
    w.setGet(() => ({ body: { ok: true, data: { items: [item(1)], channels: {} } } }))
    await w.tick()
    expect(w.executed).toHaveLength(0)
    expect(w.posts.filter((p) => p.id === 'q_1' && p.status === 'failed')).toHaveLength(1)
  })

  it('SW reborn with a ready but unreported result → reports the real result (not interrupted)', async () => {
    await chrome.storage.local.set({
      [QUEUE_RUN_KEY]: {
        state: 'running',
        current: { queue_id: 'q_1', channel_id: uc(1), action: 'unsubscribe', phase: 'finished', result: { status: 'done', error: null }, started_at: 1 }
      }
    })
    const w = await world({ items: [item(1)], statePending: 0 })
    w.items.get('q_1')!.status = 'running'
    await expect.poll(() => w.posts.find((p) => p.id === 'q_1')).toEqual({ id: 'q_1', status: 'done', error: null })
    expect(w.executed).toHaveLength(0)
  })

  it('SW reborn without a server → keeps the interrupted and reports when the server is back', async () => {
    await chrome.storage.local.set({
      [QUEUE_RUN_KEY]: { state: 'running', current: { queue_id: 'q_1', channel_id: uc(1), action: 'unsubscribe', phase: 'running', started_at: 1 } }
    })
    const w = await world({ items: [item(1)], statePending: 0, startDown: true })
    w.items.get('q_1')!.status = 'running'
    await w.mod.idle()
    expect((await ledger()).q_1).toMatchObject({ status: 'failed', reported: false })
    w.net.servers.set(PORT, w.server)
    await w.tick()
    expect(w.posts.filter((p) => p.id === 'q_1')).toEqual([{ id: 'q_1', status: 'failed', error: 'interrupted' }])
    expect(w.executed).toHaveLength(0)
  })
})

describe('visible tab, focus and progress', () => {
  it('visible tab in the origin\'s window; same tab for the round; closes and returns focus to the origin', async () => {
    const w = await world({ items: [item(1), item(2)], statePending: 0 })
    const origin = w.browser.openTab('https://www.youtube.com/')
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: { ...CONN } })
    w.server.route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, queue_pending: 2 } } }))
    await w.tick()
    expect(w.browser.created).toHaveLength(1)
    expect(w.browser.created[0]).toMatchObject({ active: true, openerTabId: origin })
    expect(new Set(w.executed.map((e) => e.tabId)).size).toBe(1)
    expect(w.browser.tabIds()).toEqual([origin])
    expect(w.browser.isActive(origin)).toBe(true)
  })

  it('progress in chrome.storage for the popup: "unsubscribing 2 of 3 · <channel>"', async () => {
    const seen: QueueProgress[] = []
    const w = await world({
      items: [item(1), item(2), item(3)],
      exec: async () => {
        seen.push((await progress())!)
        return { status: 'done', error: null }
      }
    })
    await w.tick()
    expect(seen.map((p) => `${p.index}/${p.total}`)).toEqual(['1/3', '2/3', '3/3'])
    expect(seen[1]).toMatchObject({ state: 'running', action: 'unsubscribe', channel_title: 'Canal q_2' })
    expect(seen[1].message).toMatch(/2/)
    expect(seen[1].message).toMatch(/3/)
    expect(seen[1].message).toContain('Canal q_2')
    expect(w.executed[1].payload).toMatchObject({ index: 2, total: 3 })
    expect(await progress()).toMatchObject({ state: 'idle', done: 3, failed: 0 })
  })

  it('resubscribe follows the same queue and the same path', async () => {
    const w = await world({ items: [item(1, 'resubscribe')] })
    await w.tick()
    expect(w.executed[0].payload).toMatchObject({ action: 'resubscribe', channel_id: uc(1) })
    expect(resultPosts(w)).toEqual([{ id: 'q_1', status: 'done', error: null }])
  })

  it('odd content script response → failed page_error (stable reason), never done', async () => {
    const w = await world({ items: [item(1)], exec: () => ({ status: 'done!!' as never, error: 'x'.repeat(5000) }) })
    await w.tick()
    expect(resultPosts(w)).toEqual([{ id: 'q_1', status: 'failed', error: 'page_error' }])
  })

  it('unknown content reason becomes page_error; done note is short and stable', async () => {
    const w = await world({ items: [item(1), item(2)], exec: (id) => (id === uc(1) ? { status: 'failed', error: 'anything\nwith a break' } : { status: 'done', error: 'not_subscribed' }) })
    await w.tick()
    expect(resultPosts(w)).toEqual([
      { id: 'q_1', status: 'failed', error: 'page_error' },
      { id: 'q_2', status: 'done', error: 'not_subscribed' }
    ])
  })
})

describe('a human click before each round ("Run now")', () => {
  const waiting = () => chromeFake().session.get(QUEUE_WAITING_KEY) as QueueWaiting | undefined
  const release = () => chromeFake().session.get(QUEUE_RELEASE_KEY) as QueueRelease | undefined
  const state = async (w: Awaited<ReturnType<typeof world>>) => {
    await w.bg.refreshState()
    await w.mod.idle()
  }

  it('approved items alone do not run: the extension lists them, shows a badge and lends nothing', async () => {
    const w = await world({ items: [item(1), item(2)], manual: true })
    await state(w)
    await state(w)
    expect(w.executed).toHaveLength(0)
    expect(w.gets()).toHaveLength(0)
    expect(w.posts).toHaveLength(0)
    expect(w.fake.tabs.size).toBe(0)
    expect(waiting()?.items.map((i) => i.id)).toEqual(['q_1', 'q_2'])
    expect(waiting()?.items[0]).toMatchObject({ channel_id: uc(1), channel_title: 'Canal q_1', action: 'unsubscribe' })
    expect(w.fake.badge.text).toBe('2')
  })

  it('"Run now" releases exactly the listed ids; an item approved afterwards waits for a new click', async () => {
    const w = await world({ items: [item(1), item(2)], manual: true })
    await state(w)
    await releaseQueue(waiting()!.items.map((i) => i.id))
    // approved after the click (also older than nothing: it is just not in the list the user saw)
    const late = item(3)
    w.items.set(late.id, { item: late, status: 'approved' })
    await state(w)
    expect(w.executed.map((e) => e.payload.queue_id)).toEqual(['q_1', 'q_2'])
    expect(w.items.get('q_3')!.status).toBe('approved')
    expect(release()?.ids ?? []).toEqual([]) // used up
    expect(waiting()?.items.map((i) => i.id)).toEqual(['q_3'])
    expect(w.fake.badge.text).toBe('1')
    await state(w)
    expect(w.executed).toHaveLength(2)
  })

  it('an item the server hands out first but that the user never saw stops the round before any click', async () => {
    const w = await world({ items: [item(1)], manual: true })
    await state(w)
    await releaseQueue(['q_1'])
    // written straight into the database with an old approval: it comes out first
    w.setGet(() => ({ body: { ok: true, data: { items: [item(0)], channels: {} } } }))
    await state(w)
    expect(w.executed).toHaveLength(0)
    expect(w.posts).toHaveLength(0)
    expect(release()?.ids).toEqual(['q_1'])
  })

  it('a release written anywhere but chrome.storage.session (where content scripts cannot write) is ignored', async () => {
    const w = await world({ items: [item(1)], manual: true })
    await chrome.storage.local.set({ [QUEUE_RELEASE_KEY]: { ids: ['q_1'], at: Date.now() } })
    const r = await w.bg.router.dispatch({ type: 'queue.resume', payload: { ids: ['q_1'] } }, { id: chrome.runtime.id, tab: { id: 5 } as chrome.tabs.Tab })
    expect(r.ok).toBe(true)
    await state(w)
    expect(w.executed).toHaveLength(0)
    expect(w.fake.sessionAccessLevels).toEqual([]) // never opened to content scripts
  })

  it('closing the browser or reloading the extension drops the release (session storage is cleared)', async () => {
    const w = await world({ items: [item(1)], manual: true })
    await state(w)
    await releaseQueue(['q_1'])
    w.fake.session.clear()
    await state(w)
    expect(w.executed).toHaveLength(0)
  })

  it('an old release expires', async () => {
    const w = await world({ items: [item(1)], manual: true })
    await state(w)
    await releaseQueue(['q_1'], Date.now() - 3 * 3600_000)
    await state(w)
    expect(w.executed).toHaveLength(0)
  })

  it('"Not now" hides the badge for the listed items; a new item brings it back', async () => {
    const w = await world({ items: [item(1)], manual: true })
    await state(w)
    expect(w.fake.badge.text).toBe('1')
    await snoozeQueue(['q_1'])
    await state(w)
    expect(w.fake.badge.text).toBe('')
    const late = item(2)
    w.items.set(late.id, { item: late, status: 'approved' })
    await state(w)
    expect(w.fake.badge.text).toBe('1')
    expect(w.executed).toHaveLength(0)
  })

  it('the release survives a hold (cap) but each id runs at most once', async () => {
    const many = Array.from({ length: ROUND_CAP + 2 }, (_, i) => item(i + 1))
    const w = await world({ items: many, manual: true })
    await state(w)
    await releaseQueue(waiting()!.items.map((i) => i.id))
    await state(w)
    expect(w.executed).toHaveLength(ROUND_CAP)
    expect(release()?.ids).toHaveLength(2)
    await resumeQueue()
    await state(w)
    expect(w.executed).toHaveLength(ROUND_CAP + 2)
    expect(new Set(w.executed.map((e) => e.payload.queue_id)).size).toBe(ROUND_CAP + 2)
  })
})
