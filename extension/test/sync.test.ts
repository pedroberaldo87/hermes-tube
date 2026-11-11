// background/sync: `sync.now` and the 6 h alarm → tab on /feed/channels → `scrape.subscriptions` →
// POST /ext/sync/subscriptions. Every row sent has a `channel_id`; `invalid` (422) is a bug (no loop);
// not paired / 401 stops and signals; a network failure keeps the batch to resend (idempotent).
// `sync.now` (user trigger) opens the **visible** tab in the current window, with the notice, and returns focus to the
// origin tab when done; the alarm keeps using a background tab and, if it stalls, sends `partial` and sets
// `needs_visible` (without retrying in a loop).
import { describe, expect, it, vi } from 'vitest'
import type { ChannelIn, SubscriptionBatchBody, SyncSignal } from '../../shared/api-types'
import { ALARMS, STORAGE_KEYS } from '../../shared/ext-messages'
import { EXT_PORTS } from '../../shared/ids'
import { NUDGE_ATTR, NUDGE_EVENT } from '../src/content/scraper'
import {
  FEED_CHANNELS_URL,
  NEEDS_VISIBLE_REASONS,
  SYNC_PERIOD_MIN,
  finalizeBatch,
  installContinuationNudger,
  probeSubscriptionIds,
  sync,
  type ProbeResult,
  type SyncStatus
} from '../src/background/sync'
import { createBackground } from '../src/lib/background'
import { ExtClient, chromeConnectionStore } from '../src/lib/client'
import { ok } from '../src/lib/envelope'
import { t } from '../src/lib/i18n'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { chromeFake } from './setup-chrome'
import { FakeNet, errorBody, type FakeResponse } from './setup-net'

const PORT = EXT_PORTS[0]
const CONN = { port: PORT, token: 'tok-A', device_id: 'dev-A', paired_at: 1 }
const id22 = (n: number) => `UC${String(n).padStart(22, 'x')}`
const ch = (n: number, withId = true): ChannelIn => ({
  title: `Canal ${n}`,
  channel_id: withId ? id22(n) : null,
  handle: `@canal${n}`,
  url: `https://www.youtube.com/@canal${n}`,
  thumb: null
})

type Scrape = { channels: ChannelIn[]; signal: SyncSignal; reason?: string }

// ---------------------------------------------------------------- browser: windows, tabs, focus (local fixture)
interface TabMeta {
  windowId: number
  openerTabId?: number
}

/**
 * Window/tab model on top of the shared chrome fake: `active` per window, `windowId`, `openerTabId`, focused window,
 * `tabs.get/update` that reject a nonexistent tab (like Chrome) and `query({active, lastFocusedWindow})`.
 * When the active tab closes, the "Chrome" here activates the window's **last** tab (not the origin): the focus
 * returned has to come from the code.
 */
function browserModel() {
  const fake = chromeFake()
  const meta = new Map<number, TabMeta>()
  const closedWindows = new Set<number>()
  const created: chrome.tabs.CreateProperties[] = []
  const activations: number[] = []
  let focusedWindow = 1
  let nextId = 500
  const tabsInWindow = (w: number) => [...meta.entries()].filter(([id, m]) => m.windowId === w && fake.tabs.has(id)).map(([id]) => id)
  const activate = (id: number) => {
    const m = meta.get(id)
    if (!m) return
    for (const other of tabsInWindow(m.windowId)) fake.tabs.get(other)!.active = other === id
    activations.push(id)
  }
  const view = (id: number) => {
    const tab = fake.tabs.get(id)
    if (!tab) return null
    const m = meta.get(id)
    return { ...tab, windowId: m?.windowId ?? 1, openerTabId: m?.openerTabId, index: tabsInWindow(m?.windowId ?? 1).indexOf(id) }
  }
  const remove = (id: number, isWindowClosing = false) => {
    const m = meta.get(id)
    const wasActive = fake.tabs.get(id)?.active
    if (!fake.tabs.delete(id)) return
    fake.events.tabRemoved.emit(id, { windowId: m?.windowId ?? 1, isWindowClosing })
    const rest = m ? tabsInWindow(m.windowId) : []
    if (wasActive && rest.length && !isWindowClosing) activate(rest[rest.length - 1])
  }
  const tabs = chrome.tabs as unknown as Record<string, unknown>
  tabs.create = async (props: chrome.tabs.CreateProperties) => {
    created.push({ ...props })
    const windowId = props.windowId ?? focusedWindow
    if (closedWindows.has(windowId)) throw new Error(`No window with id: ${windowId}.`)
    const id = nextId++
    fake.tabs.set(id, { id, url: props.url ?? 'about:blank', active: false, status: 'complete' })
    meta.set(id, { windowId, openerTabId: props.openerTabId })
    if (props.active !== false) activate(id)
    return view(id)
  }
  tabs.get = async (id: number) => {
    const v = view(id)
    if (!v) throw new Error(`No tab with id: ${id}.`)
    return v
  }
  tabs.update = async (id: number, props: chrome.tabs.UpdateProperties) => {
    const tab = fake.tabs.get(id)
    if (!tab) throw new Error(`No tab with id: ${id}.`)
    if (props.url) tab.url = props.url
    if (props.active) activate(id)
    return view(id)
  }
  tabs.remove = async (ids: number | number[]) => {
    for (const id of Array.isArray(ids) ? ids : [ids]) remove(id)
  }
  tabs.query = async (q: chrome.tabs.QueryInfo = {}) =>
    [...fake.tabs.keys()]
      .map(view)
      .filter((v): v is NonNullable<ReturnType<typeof view>> => v !== null)
      .filter((v) => (q.active === undefined || v.active === q.active) && (!q.lastFocusedWindow || v.windowId === focusedWindow))
  return {
    created,
    activations,
    /** user's tab (already existed before the sync) */
    openTab(url: string, windowId = 1, active = true) {
      const id = nextId++
      fake.tabs.set(id, { id, url, active: false, status: 'complete' })
      meta.set(id, { windowId })
      if (active) activate(id)
      return id
    },
    activate,
    isActive: (id: number) => fake.tabs.get(id)?.active === true,
    exists: (id: number) => fake.tabs.has(id),
    /** user closes the tab */
    closeTab: (id: number) => remove(id),
    /** user closes the whole window */
    closeWindow(windowId: number) {
      closedWindows.add(windowId)
      for (const id of tabsInWindow(windowId)) remove(id, true)
      if (focusedWindow === windowId) focusedWindow = 99
    },
    focus: (w: number) => (focusedWindow = w),
    /** tab opened by the sync (the last one created) */
    syncTabId: () => nextId - 1
  }
}

function world(
  opts: { scrape?: Scrape | ((tabId: number) => Scrape | Promise<Scrape>); probe?: ProbeResult | null; browser?: ReturnType<typeof browserModel> } = {}
) {
  const net = new FakeNet()
  const server = net.addServer(PORT, { token: 'tok-A' })
  const bodies: SubscriptionBatchBody[] = []
  /** forced error response; null = server answers ok (SyncReport) */
  let reply: (() => FakeResponse) | null = null
  server.route('GET /ext/state', () => ({ body: { ok: true, data: EXT_STATE_EXAMPLE } }))
  server.route('POST /ext/sync/subscriptions', (req) => {
    const body = req.body as SubscriptionBatchBody
    if (reply) return reply()
    bodies.push(body)
    return { body: { ok: true, data: { signal: body.signal, added: body.channels.map((c) => c.channel_id), updated: [], marked_ex: [] } } }
  })
  const fake = chromeFake()
  const browser = opts.browser ?? browserModel()
  const scrapeOf = opts.scrape ?? { channels: [ch(1), ch(2), ch(3)], signal: 'complete' as const, reason: 'end_of_list' }
  fake.tabResponder = async (tabId, msg) => {
    const m = msg as { type: string }
    if (m.type !== 'scrape.subscriptions') return { ok: false, error: { code: 'not_found', message: m.type } }
    return ok(typeof scrapeOf === 'function' ? await scrapeOf(tabId) : scrapeOf)
  }
  const probe = opts.probe === undefined ? { logged_in: true, items: [] } : opts.probe
  /** order of the calls to the MAIN world and of the commands to the tab */
  const order: string[] = []
  const executeScript = vi.fn(async (inj: { func?: { name?: string } }) => {
    order.push(`main:${inj.func?.name ?? '?'}`)
    return probe ? [{ result: probe }] : []
  })
  ;(chrome.scripting as unknown as { executeScript: unknown }).executeScript = executeScript
  const send = chrome.tabs.sendMessage
  ;(chrome.tabs as unknown as { sendMessage: unknown }).sendMessage = (id: number, msg: { type: string }) => {
    order.push(`tab:${msg.type}`)
    return send(id, msg)
  }
  const client = new ExtClient({ fetch: net.fetch, store: chromeConnectionStore() })
  const bg = createBackground({ client, modules: [sync] })
  return {
    net,
    server,
    bodies,
    bg,
    fake,
    browser,
    order,
    executeScript,
    reply: (fn: () => FakeResponse) => (reply = fn),
    posts: () => net.requests({ path: '/ext/sync/subscriptions' }),
    scrapePayloads: () => fake.tabMessages.filter(([, m]) => (m as { type: string }).type === 'scrape.subscriptions').map(([, m]) => (m as { payload: unknown }).payload)
  }
}

const status = async (): Promise<SyncStatus | undefined> =>
  (await chrome.storage.local.get(STORAGE_KEYS.syncStatus))[STORAGE_KEYS.syncStatus] as SyncStatus | undefined
const pending = async () => (await chrome.storage.local.get(STORAGE_KEYS.syncPending))[STORAGE_KEYS.syncPending]
const settled = () => expect.poll(async () => (await status())?.state, { timeout: 5000 }).not.toBe('running')
const paired = () => chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
const syncNow = (w: ReturnType<typeof world>) => w.bg.router.dispatch({ type: 'sync.now', payload: {} })

describe('sync.now', () => {
  it('not paired: does not open a tab, answers unauthorized/unpaired (the popup shows it)', async () => {
    const w = world()
    const r = await syncNow(w)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ code: 'unauthorized', reason: 'unpaired' })
    expect(w.fake.tabs.size).toBe(0)
    expect(w.posts()).toHaveLength(0)
  })

  it('token already refused (unauthorized connection): stops early, does not open a tab', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.connection]: { ...CONN, status: { state: 'unauthorized', last_ok_at: null, error: { code: 'unauthorized', message: 'x' } } }
    })
    const w = world()
    const r = await syncNow(w)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ code: 'unauthorized', reason: 'unauthorized' })
    expect(w.fake.tabs.size).toBe(0)
  })

  it('SW died midway through a sync: on rebirth it closes the leftover tab and returns focus to the origin', async () => {
    await paired()
    const b = browserModel()
    const origin = b.openTab('https://example.org/origem')
    const orphan = await chrome.tabs.create({ url: FEED_CHANNELS_URL, active: true, windowId: 1 })
    await chrome.storage.local.set({ [STORAGE_KEYS.syncRun]: { tab_id: orphan.id, origin_tab_id: origin, started_at: 1 } })
    expect(b.isActive(origin)).toBe(false)
    world({ browser: b }) // new SW
    await expect.poll(() => chromeFake().tabs.has(orphan.id!)).toBe(false)
    await expect.poll(async () => (await chrome.storage.local.get(STORAGE_KEYS.syncRun))[STORAGE_KEYS.syncRun]).toBeUndefined()
    expect(b.isActive(origin)).toBe(true)
  })

  it('paired: scrapes → POST with complete and ids → closes the tab', async () => {
    await paired()
    const w = world()
    w.browser.openTab('https://example.org/origem')
    const r = await syncNow(w)
    expect(r).toEqual({ ok: true, data: { started: true } })
    await settled()
    expect(w.fake.tabMessages.map(([, m]) => (m as { type: string }).type)).toContain('scrape.subscriptions')
    expect(w.bodies).toHaveLength(1)
    expect(w.bodies[0].signal).toBe('complete')
    expect(w.bodies[0].channels.map((c) => c.channel_id)).toEqual([id22(1), id22(2), id22(3)])
    expect(w.net.requests({ path: '/ext/sync/subscriptions' })[0].headers.authorization).toBe('Bearer tok-A')
    expect(w.browser.exists(w.browser.syncTabId())).toBe(false) // tab closed
    expect(await status()).toMatchObject({ state: 'ok', signal: 'complete', sent: 3, dropped: 0, error: null, needs_visible: false })
  })

  it('the server treats a complete list as partial (too many channels missing at once): the status says partial', async () => {
    await paired()
    const w = world()
    w.reply(() => ({ body: { ok: true, data: { signal: 'partial', added: [], updated: [], marked_ex: [] } } }))
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ state: 'ok', signal: 'partial', reason: 'server_partial', report: { marked_ex: 0 } })
  })

  it('scraper says partial → POST partial', async () => {
    await paired()
    const w = world({ scrape: { channels: [ch(1)], signal: 'partial', reason: 'scroll_stalled' } })
    await syncNow(w)
    await settled()
    expect(w.bodies[0]).toEqual({ channels: [ch(1)], signal: 'partial' })
    expect(await status()).toMatchObject({ state: 'ok', signal: 'partial', reason: 'scroll_stalled' })
  })

  it('items without an id: the MAIN world completes them → complete; every item sent has a channel_id', async () => {
    await paired()
    const w = world({
      scrape: { channels: [ch(1), ch(2, false), ch(3, false)], signal: 'complete' },
      probe: {
        logged_in: true,
        items: [
          { channel_id: id22(2), url: 'https://www.youtube.com/@canal2', handle: '@canal2' },
          { channel_id: id22(3), url: null, handle: '@CANAL3' }
        ]
      }
    })
    await syncNow(w)
    await settled()
    expect(w.bodies[0].signal).toBe('complete')
    expect(w.bodies[0].channels.map((c) => c.channel_id)).toEqual([id22(1), id22(2), id22(3)])
  })

  it('items without an id that nobody resolves: leave the batch and the signal falls to partial', async () => {
    await paired()
    const w = world({ scrape: { channels: [ch(1), ch(2, false)], signal: 'complete' }, probe: null })
    await syncNow(w)
    await settled()
    expect(w.bodies[0]).toEqual({ channels: [ch(1)], signal: 'partial' })
    for (const c of w.bodies[0].channels) expect(c.channel_id).toMatch(/^UC[\w-]{22}$/)
    expect(await status()).toMatchObject({ signal: 'partial', dropped: 1, reason: 'missing_ids' })
  })

  it('MAIN world says logged out → partial', async () => {
    await paired()
    const w = world({ probe: { logged_in: false, items: [] } })
    await syncNow(w)
    await settled()
    expect(w.bodies[0].signal).toBe('partial')
    expect(await status()).toMatchObject({ reason: 'logged_out' })
  })

  it('tab closed midway (content does not answer): nothing sent, tab not left open, error state', async () => {
    await paired()
    const w = world()
    w.fake.tabResponder = async (tabId) => {
      w.browser.closeTab(tabId)
      throw new Error('The message port closed before a response was received.')
    }
    await syncNow(w)
    await settled()
    expect(w.posts()).toHaveLength(0)
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'tab_closed' } })
  })

  it('really logged out (YouTube redirects to the Google login): fails fast, nothing sent, tab closed', async () => {
    await paired()
    const w = world()
    const update = chrome.tabs.update
    ;(chrome.tabs as unknown as { update: unknown }).update = async (id: number, props: chrome.tabs.UpdateProperties) => {
      if (props.url) props = { ...props, url: 'https://accounts.google.com/v3/signin/identifier?continue=https://www.youtube.com/signin' }
      return update(id, props)
    }
    await syncNow(w)
    await settled()
    expect(w.posts()).toHaveLength(0)
    expect(w.fake.tabMessages).toHaveLength(0) // it did not even try to scrape
    expect(w.fake.tabs.size).toBe(0)
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'logged_out' } })
  })

  it('tab created empty and only then navigated (listeners attached before the page starts)', async () => {
    await paired()
    const w = world()
    const updated = vi.spyOn(chrome.tabs, 'update')
    await syncNow(w)
    await settled()
    expect(w.browser.created[0]).toMatchObject({ url: 'about:blank' })
    expect(updated).toHaveBeenCalledWith(expect.any(Number), { url: FEED_CHANNELS_URL })
  })

  it('two requests at the same time → one tab, one send', async () => {
    await paired()
    let resolve!: (s: Scrape) => void
    const w = world({ scrape: () => new Promise<Scrape>((r) => (resolve = r)) })
    const [a, b] = await Promise.all([syncNow(w), syncNow(w)])
    expect(a).toEqual({ ok: true, data: { started: true } })
    expect(b).toEqual({ ok: true, data: { started: true } })
    await expect.poll(() => w.fake.tabMessages.length).toBe(1)
    resolve({ channels: [ch(1)], signal: 'complete' })
    await settled()
    expect(w.browser.created).toHaveLength(1)
    expect(w.bodies).toHaveLength(1)
  })

  it('installs the MAIN world loader before asking for the scrape (and reads the ids afterwards)', async () => {
    await paired()
    const w = world()
    await syncNow(w)
    await settled()
    const i = w.order.indexOf('main:installContinuationNudger')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(w.order.indexOf('tab:scrape.subscriptions'))
    expect(w.order.lastIndexOf('main:probeSubscriptionIds')).toBeGreaterThan(w.order.indexOf('tab:scrape.subscriptions'))
  })
})

// ---------------------------------------------------------------- user trigger = visible tab
describe('sync.now is the user\'s: visible tab, notice and focus returned', () => {
  it('opens active in the current window, next to the origin; asks for the notice (visible); at the end closes and returns focus', async () => {
    await paired()
    let activeWhileScraping: boolean | undefined
    const w = world({
      scrape: async (tabId) => {
        activeWhileScraping = (await chrome.tabs.get(tabId)).active
        return { channels: [ch(1), ch(2)], signal: 'complete', reason: 'end_of_list' }
      }
    })
    const origin = w.browser.openTab('https://example.org/origem')
    w.browser.openTab('https://example.org/outra', 1, false) // the "Chrome" activates this one when the sync tab closes
    await syncNow(w)
    await settled()
    expect(w.browser.created).toHaveLength(1)
    expect(w.browser.created[0]).toMatchObject({ url: 'about:blank', active: true, windowId: 1, openerTabId: origin })
    expect(activeWhileScraping).toBe(true)
    expect(w.scrapePayloads()).toEqual([{ visible: true }])
    expect(w.bodies[0].signal).toBe('complete')
    expect(w.browser.exists(w.browser.syncTabId())).toBe(false)
    expect(w.browser.isActive(origin)).toBe(true)
    expect(await status()).toMatchObject({ state: 'ok', trigger: 'manual' })
  })

  it('scrape error: closes and returns focus', async () => {
    await paired()
    const w = world()
    w.fake.tabResponder = async () => ({ ok: false, error: { code: 'internal', message: 'boom' } })
    const origin = w.browser.openTab('https://example.org/origem')
    w.browser.openTab('https://example.org/outra', 1, false) // the "Chrome" activates this one when the sync tab closes
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'scrape_failed' } })
    expect(w.browser.exists(w.browser.syncTabId())).toBe(false)
    expect(w.browser.isActive(origin)).toBe(true)
  })

  it('server error after scraping: focus returned the same way', async () => {
    await paired()
    const w = world()
    w.net.down(PORT)
    const origin = w.browser.openTab('https://example.org/origem')
    w.browser.openTab('https://example.org/outra', 1, false) // the "Chrome" activates this one when the sync tab closes
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'ext_endpoint_down' } })
    expect(w.browser.isActive(origin)).toBe(true)
  })

  it('Cancel on the notice: nothing sent, cancelled state, tab closed, focus returned', async () => {
    await paired()
    const w = world({ scrape: { channels: [ch(1)], signal: 'partial', reason: 'cancelled' } })
    const origin = w.browser.openTab('https://example.org/origem')
    w.browser.openTab('https://example.org/outra', 1, false) // the "Chrome" activates this one when the sync tab closes
    await syncNow(w)
    await settled()
    expect(w.posts()).toHaveLength(0)
    expect(await pending()).toBeUndefined()
    const s = await status()
    expect(s).toMatchObject({ state: 'error', error: { code: 'cancelled' }, reason: 'cancelled' })
    expect(s?.message).toBe(t('sync', 'error_cancelled'))
    expect(w.browser.exists(w.browser.syncTabId())).toBe(false)
    expect(w.browser.isActive(origin)).toBe(true)
  })

  it('tab closed by the user: Chrome activates another tab; the code returns focus to the origin', async () => {
    await paired()
    const w = world()
    w.fake.tabResponder = async (tabId) => {
      w.browser.closeTab(tabId)
      throw new Error('The message port closed before a response was received.')
    }
    const origin = w.browser.openTab('https://example.org/origem')
    const last = w.browser.openTab('https://example.org/ultima', 1, false)
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'tab_closed' } })
    expect(w.browser.isActive(last)).toBe(false)
    expect(w.browser.isActive(origin)).toBe(true)
  })

  it('origin window closed midway: does not break, nothing sent, no new tab, tab_closed state', async () => {
    await paired()
    const w = world()
    w.fake.tabResponder = async () => {
      w.browser.closeWindow(1)
      throw new Error('The message port closed before a response was received.')
    }
    const origin = w.browser.openTab('https://example.org/origem')
    await syncNow(w)
    await settled()
    expect(w.posts()).toHaveLength(0)
    expect(w.browser.created).toHaveLength(1)
    expect(w.browser.exists(origin)).toBe(false)
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'tab_closed' } })
    expect(w.fake.tabs.size).toBe(0)
  })

  it('origin window does not accept a new tab: opens active in the focused window', async () => {
    await paired()
    const w = world()
    w.browser.openTab('https://example.org/origem')
    const create = chrome.tabs.create
    ;(chrome.tabs as unknown as { create: unknown }).create = async (p: chrome.tabs.CreateProperties) => {
      if (p.windowId !== undefined) throw new Error('Tabs can only be created in normal windows.')
      return create(p)
    }
    await syncNow(w)
    await settled()
    expect(w.bodies[0].signal).toBe('complete')
    expect(w.browser.created.at(-1)).toMatchObject({ url: 'about:blank', active: true })
  })

  it('user went to another tab during the read: at the end focus is not pulled back', async () => {
    await paired()
    let other = 0
    const w = world({
      scrape: async () => {
        w.browser.activate(other)
        return { channels: [ch(1)], signal: 'complete' }
      }
    })
    const origin = w.browser.openTab('https://example.org/origem')
    other = w.browser.openTab('https://example.org/outra', 1, false)
    await syncNow(w)
    await settled()
    expect(w.browser.isActive(other)).toBe(true)
    expect(w.browser.isActive(origin)).toBe(false)
  })
})

// ---------------------------------------------------------------- alarm = background tab
describe('6 h alarm: background tab, without stealing focus', () => {
  async function alarmWorld(scrape?: Scrape) {
    await paired()
    const w = world(scrape ? { scrape } : {})
    const origin = w.browser.openTab('https://example.org/origem')
    w.bg.start()
    await chromeFake().flush()
    await expect.poll(() => w.fake.alarms.get(ALARMS.sync)?.periodInMinutes).toBe(SYNC_PERIOD_MIN)
    return { w, origin }
  }

  it('opens in the background (active:false, no window/opener), visible:false, and does not touch focus', async () => {
    const { w, origin } = await alarmWorld()
    const before = w.browser.activations.length
    await w.fake.fire(ALARMS.sync)
    await settled()
    expect(w.browser.created).toEqual([{ url: 'about:blank', active: false }])
    expect(w.scrapePayloads()).toEqual([{ visible: false }])
    expect(w.browser.activations.length).toBe(before)
    expect(w.browser.isActive(origin)).toBe(true)
    expect(await status()).toMatchObject({ trigger: 'alarm', state: 'ok', signal: 'complete', needs_visible: false })
  })

  it('reasons that ask for a visible sync: scroll_stalled and timeout', () => {
    expect([...NEEDS_VISIBLE_REASONS].sort()).toEqual(['scroll_stalled', 'timeout'])
  })

  for (const reason of ['scroll_stalled', 'timeout']) {
    it(`${reason} on the alarm → partial sent + needs_visible; no new firing`, async () => {
      const { w } = await alarmWorld({ channels: [ch(1), ch(2)], signal: 'partial', reason })
      await w.fake.fire(ALARMS.sync)
      await settled()
      expect(w.bodies).toEqual([{ channels: [ch(1), ch(2)], signal: 'partial' }])
      const s = await status()
      expect(s).toMatchObject({ state: 'ok', signal: 'partial', reason, needs_visible: true, trigger: 'alarm' })
      expect(s?.message).toBe(t('sync', 'done_partial_needs_visible', { count: 2 }))
      // no loop: no new tab, no new scrape, no resend in the state cycle
      await w.bg.refreshState()
      await chromeFake().flush()
      await new Promise((r) => setTimeout(r, 50))
      expect(w.browser.created).toHaveLength(1)
      expect(w.scrapePayloads()).toHaveLength(1)
      expect(w.bodies).toHaveLength(1)
      expect(await pending()).toBeUndefined()
    })
  }

  it('afterwards, "sync now" (visible) completes → needs_visible goes back to false', async () => {
    let n = 0
    await paired()
    const w = world({
      scrape: () => (n++ === 0 ? { channels: [ch(1)], signal: 'partial', reason: 'scroll_stalled' } : { channels: [ch(1), ch(2)], signal: 'complete', reason: 'end_of_list' })
    })
    w.browser.openTab('https://example.org/origem')
    w.bg.start()
    await chromeFake().flush()
    await w.fake.fire(ALARMS.sync)
    await settled()
    expect(await status()).toMatchObject({ needs_visible: true })
    await syncNow(w)
    await expect.poll(async () => (await status())?.trigger).toBe('manual')
    await settled()
    expect(await status()).toMatchObject({ state: 'ok', signal: 'complete', needs_visible: false })
  })

  it('while the visible one runs, the previous needs_visible stays (the screen keeps knowing)', async () => {
    let release!: () => void
    let n = 0
    await paired()
    const w = world({
      scrape: async () => {
        if (n++ === 0) return { channels: [ch(1)], signal: 'partial', reason: 'timeout' }
        await new Promise<void>((r) => (release = r))
        return { channels: [ch(1)], signal: 'complete' }
      }
    })
    w.bg.start()
    await chromeFake().flush()
    await w.fake.fire(ALARMS.sync)
    await settled()
    await syncNow(w)
    await expect.poll(async () => (await status())?.state).toBe('running')
    expect(await status()).toMatchObject({ needs_visible: true })
    await expect.poll(() => typeof release).toBe('function')
    release()
    await settled()
  })

  it('a manual sync that stalls (tab already visible) does not set needs_visible', async () => {
    await paired()
    const w = world({ scrape: { channels: [ch(1)], signal: 'partial', reason: 'scroll_stalled' } })
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ signal: 'partial', reason: 'scroll_stalled', needs_visible: false })
  })
})

describe('server responses', () => {
  it('422 invalid is a bug: logs and does not resend (not even on the next state alarm)', async () => {
    await paired()
    const w = world()
    w.reply(() => ({ status: 422, body: errorBody('invalid', 'channels[0].title: required') }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'invalid' } })
    expect(await pending()).toBeUndefined()
    expect(err).toHaveBeenCalled()
    await w.bg.refreshState()
    await w.bg.refreshState()
    await chromeFake().flush()
    expect(w.posts()).toHaveLength(1)
  })

  it('401: stops and signals (unauthorized connection), without keeping it to resend', async () => {
    await paired()
    const w = world()
    w.server.opts.token = 'other'
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'unauthorized' } })
    expect(await pending()).toBeUndefined()
    expect((await w.bg.client.status()).state).toBe('unauthorized')
  })

  it('server down: keeps the batch; when it is back (onState) resends once, the same', async () => {
    await paired()
    const w = world()
    w.net.down(PORT)
    await syncNow(w)
    await settled()
    expect(await status()).toMatchObject({ state: 'error', error: { code: 'ext_endpoint_down' } })
    expect(await pending()).toMatchObject({ batch: { signal: 'complete' } })
    w.net.servers.set(PORT, w.server)
    await w.bg.refreshState()
    await expect.poll(() => w.bodies.length).toBe(1)
    expect(w.bodies[0].signal).toBe('complete')
    expect(w.bodies[0].channels).toHaveLength(3)
    await expect.poll(pending).toBeUndefined()
    await w.bg.refreshState()
    await chromeFake().flush()
    expect(w.bodies).toHaveLength(1)
    expect(await status()).toMatchObject({ state: 'ok', trigger: 'retry' })
  })

  it('a batch stored for a long time becomes partial on resend (does not mark missing channels with an old list)', async () => {
    await paired()
    const w = world()
    await chrome.storage.local.set({
      [STORAGE_KEYS.syncPending]: { batch: { channels: [ch(1)], signal: 'complete' }, scraped_at: Date.now() - 60 * 60_000 }
    })
    await w.bg.refreshState()
    await expect.poll(() => w.bodies.length).toBe(1)
    expect(w.bodies[0].signal).toBe('partial')
  })
})

describe('sync.subscriptions (list sent by the content script)', () => {
  it('passes to the server and returns the SyncReport; an item without an id leaves and becomes partial', async () => {
    await paired()
    const w = world()
    const r = await w.bg.router.dispatch({ type: 'sync.subscriptions', payload: { channels: [ch(1), ch(2, false)], signal: 'complete' } })
    expect(r).toMatchObject({ ok: true, data: { signal: 'partial', added: [id22(1)] } })
    expect(w.bodies[0]).toEqual({ channels: [ch(1)], signal: 'partial' })
  })

  it('a list handed over by a content script is never proof of the whole list: always sent as partial', async () => {
    await paired()
    const w = world()
    const r = await w.bg.router.dispatch({ type: 'sync.subscriptions', payload: { channels: [ch(1), ch(2)], signal: 'complete' } })
    expect(r).toMatchObject({ ok: true, data: { signal: 'partial' } })
    expect(w.bodies[0]).toEqual({ channels: [ch(1), ch(2)], signal: 'partial' })
  })

  it('server error comes back in the envelope', async () => {
    await paired()
    const w = world()
    w.reply(() => ({ status: 422, body: errorBody('invalid', 'x') }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await w.bg.router.dispatch({ type: 'sync.subscriptions', payload: { channels: [ch(1)], signal: 'partial' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid')
  })
})

describe('6 h alarm', () => {
  it('pairing creates ALARMS.sync (360 min); unpairing erases it; firing runs the sync', async () => {
    const w = world()
    w.bg.start()
    await chromeFake().flush()
    expect(w.fake.alarms.has(ALARMS.sync)).toBe(false)
    await paired()
    await chromeFake().flush()
    await expect.poll(() => w.fake.alarms.get(ALARMS.sync)?.periodInMinutes).toBe(SYNC_PERIOD_MIN)
    expect(SYNC_PERIOD_MIN).toBe(360)
    await w.fake.fire(ALARMS.sync)
    await settled()
    expect(w.bodies).toHaveLength(1)
    expect(await status()).toMatchObject({ trigger: 'alarm' })
    await chrome.storage.local.remove(STORAGE_KEYS.connection)
    await expect.poll(() => w.fake.alarms.has(ALARMS.sync)).toBe(false)
  })
})

describe('finalizeBatch', () => {
  it('caps at 5000 (rest → partial) and dedupes by channel_id', () => {
    const many = Array.from({ length: 5003 }, (_, i) => ch(i))
    const r = finalizeBatch([...many, ch(1)], 'complete', null)
    expect(r.batch.channels).toHaveLength(5000)
    expect(r.batch.signal).toBe('partial')
    const d = finalizeBatch([ch(1), ch(1), ch(2)], 'complete', null)
    expect(d.batch).toEqual({ channels: [ch(1), ch(2)], signal: 'complete' })
  })

  it('an invalid id counts as missing', () => {
    const r = finalizeBatch([{ ...ch(1), channel_id: '@canal1' }], 'complete', null)
    expect(r.batch).toEqual({ channels: [], signal: 'partial' })
  })
})

describe('probeSubscriptionIds (runs in the tab\'s MAIN world)', () => {
  it('reads the .data of YouTube\'s elements and the ytcfg', () => {
    document.body.innerHTML =
      '<ytd-browse><ytd-channel-renderer id="a"><a id="main-link" href="/@Canal2">x</a></ytd-channel-renderer>' +
      '<yt-lockup-view-model id="b"><a href="/@canal3">y</a></yt-lockup-view-model>' +
      '<ytd-grid-channel-renderer id="c"><a id="main-link" href="/@semdados">z</a></ytd-grid-channel-renderer></ytd-browse>'
    ;(document.getElementById('a') as unknown as { data: unknown }).data = {
      channelId: id22(2),
      navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@Canal2' } }
    }
    ;(document.getElementById('b') as unknown as { __data: unknown }).__data = {
      data: { rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: id22(3), canonicalBaseUrl: '/@canal3' } } } } } }
    }
    const g = globalThis as unknown as { ytcfg?: unknown }
    g.ytcfg = { get: (k: string) => (k === 'LOGGED_IN' ? true : undefined) }
    try {
      const r = probeSubscriptionIds()
      expect(r.logged_in).toBe(true)
      expect(r.items).toEqual([
        { channel_id: id22(2), url: 'https://www.youtube.com/@Canal2', handle: '@canal2' },
        { channel_id: id22(3), url: 'https://www.youtube.com/@canal3', handle: '@canal3' }
      ])
    } finally {
      delete g.ytcfg
      document.body.innerHTML = ''
    }
  })

  it('no ytcfg → logged_in null (does not decide)', () => {
    expect(probeSubscriptionIds()).toEqual({ logged_in: null, items: [] })
  })
})

describe('installContinuationNudger (MAIN world): triggers the loading the element itself exposes', () => {
  it('calls the continuation element\'s method once; reports in the attribute; with no element/method says so', () => {
    const fire = () => {
      document.documentElement.removeAttribute(NUDGE_ATTR)
      document.dispatchEvent(new CustomEvent(NUDGE_EVENT))
      return document.documentElement.getAttribute(NUDGE_ATTR)
    }
    try {
      expect(installContinuationNudger()).toBe(true)
      expect(installContinuationNudger()).toBe(false) // idempotent: only one listener
      document.body.innerHTML = '<ytd-browse><div id="contents"></div></ytd-browse>'
      expect(fire()).toBe('no_element')
      document.querySelector('#contents')!.innerHTML = '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>'
      expect(fire()).toBe('none')
      document.querySelector('#contents')!.innerHTML = '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>'
      const el = document.querySelector('ytd-continuation-item-renderer') as unknown as { polymerController: { trigger: () => void } }
      const trigger = vi.fn()
      el.polymerController = { trigger }
      expect(fire()).toBe('called:trigger')
      expect(fire()).toBe('already')
      expect(trigger).toHaveBeenCalledTimes(1)
      // the element is swapped by YouTube on every page: the new one is triggered again
      document.querySelector('#contents')!.innerHTML = '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>'
      const el2 = document.querySelector('ytd-continuation-item-renderer') as unknown as { trigger: () => void }
      el2.trigger = vi.fn(() => {
        throw new Error('x')
      })
      expect(fire()).toBe('error:trigger')
    } finally {
      document.body.innerHTML = ''
      document.documentElement.removeAttribute(NUDGE_ATTR)
    }
  })
})

describe('popup text for a list the server did not trust', () => {
  it('server_partial has its own sentence', async () => {
    const { reasonText } = await import('../src/popup/text')
    const { setLanguage } = await import('../src/lib/i18n')
    setLanguage('en')
    expect(reasonText('server_partial')).toMatch(/did not mark them as unsubscribed/)
  })
})
