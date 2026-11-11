// background/sync — YouTube subscriptions → Hermes (ext-protocol.md, `POST /ext/sync/subscriptions`).
// Behavior derived from the MyTube background script (same author, relicensed under MIT here).
//
// - `sync.now` (popup/Desktop) and the `ALARMS.sync` alarm every 6 h while paired: opens /feed/channels in a tab,
//   waits for it to load, installs the continuation trigger in the MAIN world (`installContinuationNudger`), sends
//   `scrape.subscriptions {visible}` to content/scraper (which scrolls to the end), completes ids through the tab's MAIN world
//   (`chrome.scripting.executeScript`, read-only access to the elements' `.data` and to `ytcfg`), closes the tab and sends the
//   whole list in one request.
// - Chrome does not render a hidden tab and YouTube loads the continuation when the item enters the screen.
//   · `sync.now` (user trigger) opens a **visible** tab (`active: true`) in the current window, next to the
//     origin tab (`openerTabId`); the scraper shows the notice (content/sync-overlay: counter, "nothing is changed", Cancel/
//     Esc). When done (success, error, cancel) it closes the tab and returns focus to the origin — if the
//     sync tab was still the active one (a user who went to another tab is not pulled back) or if the user
//     closed it. Cancelled → nothing sent (`error.code = cancelled`).
//   · The alarm keeps using a **background** tab (does not steal focus). If the scraper returns `scroll_stalled` or `timeout`
//     (`NEEDS_VISIBLE_REASONS`), it sends the `partial` and records `sync_status.needs_visible = true`: the screens show
//     "needs a visible sync" (message `done_partial_needs_visible`). It does not retry: the next
//     alarm (6 h) or "sync now" decides. Only a `complete` (or a visible `partial`) clears the field.
// - Every row sent has a `channel_id` (without it the server resolves over the network and stalls the missing-channel marking): an item
//   without an id is dropped from the batch and the signal falls to `partial`. Logged out (MAIN world), > 5000 items → `partial`.
// - Responses: ok → `ok` state. `invalid` (422) is a bug: logs and does not resend. `unauthorized` (401/not paired):
//   stops and signals (the client marks the connection; the popup shows it). Network/timeout: keeps the batch and resends once when the
//   server is back (next `ExtState`); an old batch (> 15 min) goes back as `partial` (an old list does not mark missing channels).
// - `sync.subscriptions` (list coming from a content script) follows the same rules, is always sent as `partial` (never
//   proof of the whole list) and returns the `SyncReport`. A `complete` batch the server answers as `partial` (too many
//   channels missing at once) is saved as partial with reason `server_partial`.
// - State of the last sync in `chrome.storage.local['sync_status']` (the popup reads it; the SW dies).
// No cookies and no account actions: it only reads the page.
import type { ChannelIn, Envelope, ExtRouteKey, SubscriptionBatchBody, SyncReport, SyncSignal } from '../../../shared/api-types'
import { ALARMS, STORAGE_KEYS, type SyncStatus as SharedSyncStatus } from '../../../shared/ext-messages'
import type { BackgroundContext, BackgroundModule } from '../lib/background'
import type { StoredConnection } from '../lib/client'
import { errorMessage, fail, ok } from '../lib/envelope'
import { t } from '../lib/i18n'

export const MODULE = 'background/sync'
export const ROUTES = ['POST /ext/sync/subscriptions'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = ['POST /ext/sync/subscriptions']
export const MESSAGES = ['sync.subscriptions', 'sync.now'] as const

export const FEED_CHANNELS_URL = 'https://www.youtube.com/feed/channels'
/** subscriptions alarm: 6 h */
export const SYNC_PERIOD_MIN = 360
/** contract: `SubscriptionBatchBody.channels` ≤ 5000 */
export const MAX_CHANNELS = 5000
const SYNC_STATUS_KEY = STORAGE_KEYS.syncStatus
const SYNC_PENDING_KEY = STORAGE_KEYS.syncPending
const SYNC_RUN_KEY = STORAGE_KEYS.syncRun
/** scraper reasons that, in a background tab, mean "the list did not load without the tab in view" */
export const NEEDS_VISIBLE_REASONS: readonly string[] = ['scroll_stalled', 'timeout']

/** a stored batch (network failure) older than this goes back as `partial` */
const PENDING_FRESH_MS = 15 * 60_000
/** and older than this is discarded (the next alarm scrapes again) */
const PENDING_MAX_AGE_MS = SYNC_PERIOD_MIN * 60_000
const TAB_LOAD_TIMEOUT_MS = 60_000
/** the scraper has a 5 min scroll cap */
const SCRAPE_TIMEOUT_MS = 330_000
/** the content script has not answered yet ("Receiving end does not exist"): retry up to this */
const READY_TIMEOUT_MS = 20_000
const READY_RETRY_MS = 500
/** an API call every 20 s keeps the SW awake during the scroll (MV3 sleeps after 30 s idle) */
const KEEPALIVE_MS = 20_000

const CHANNEL_ID = /^UC[\w-]{22}$/

/** `pair`: 1st sync right after pairing — visible, like `manual`. */
export type SyncTrigger = 'manual' | 'pair' | 'alarm' | 'page' | 'retry'

/**
 * `SyncStatus` from `shared/ext-messages.ts` with the extra field:
 * - `needs_visible`: the last background sync (alarm) stalled (`scroll_stalled`/`timeout`) and sent
 *   `partial` — unsubscribes made outside the app will not be recognized until a **visible** sync ("Sync
 *   now"). Stays `true` until something proves otherwise (error, cancel, sync running).
 * - `error.code`: from the server (`invalid`, `unauthorized`, `ext_endpoint_down`, …) or local (`tab_closed`,
 *   `tab_timeout`, `logged_out`, `scrape_failed`, `nothing_to_send`, `cancelled`).
 */
export interface SyncStatus extends SharedSyncStatus {
  trigger: SyncTrigger
  message: string
  last_ok_at: number | null
  needs_visible: boolean
}

interface PendingBatch {
  batch: SubscriptionBatchBody
  /** epoch ms of the scrape */
  scraped_at: number
  reason: string | null
  dropped: number
  needs_visible?: boolean
}

/** Content/scraper response (`ScrapeResult` carries extra `reason`/`stats`; optional here). */
interface ScrapeReply {
  channels: ChannelIn[]
  signal: SyncSignal
  reason?: string
}

// ------------------------------------------------------------------ MAIN world

export interface ProbeItem {
  channel_id: string
  url: string | null
  handle: string | null
}
export interface ProbeResult {
  /** `ytcfg.get('LOGGED_IN')`; null = could not tell */
  logged_in: boolean | null
  items: ProbeItem[]
}

/**
 * Runs **in the tab's MAIN world** (`chrome.scripting.executeScript({func, world: 'MAIN'})`): Chrome serializes only
 * the function body — no references to outer scope. Reads the `.data` YouTube keeps on each list item
 * (invisible to the isolated-world content script) and the `ytcfg`. Read-only.
 */
export function probeSubscriptionIds(): ProbeResult {
  const UC = /^UC[\w-]{22}$/
  const g = globalThis as unknown as Record<string, unknown>
  let logged_in: boolean | null = null
  try {
    const cfg = g.ytcfg as { get?: (k: string) => unknown; data_?: Record<string, unknown> } | undefined
    const v = typeof cfg?.get === 'function' ? cfg.get('LOGGED_IN') : cfg?.data_?.LOGGED_IN
    if (typeof v === 'boolean') logged_in = v
  } catch {
    logged_in = null
  }
  const find = (node: unknown, depth: number, test: (k: string, v: unknown) => boolean): unknown => {
    if (depth > 10 || !node || typeof node !== 'object') return undefined
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (test(k, v)) return v
    }
    for (const v of Object.values(node as Record<string, unknown>)) {
      const hit = find(v, depth + 1, test)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const abs = (href: unknown): string | null => {
    if (typeof href !== 'string' || !href) return null
    try {
      return new URL(href, 'https://www.youtube.com').href
    } catch {
      return null
    }
  }
  const handleOf = (url: string | null): string | null => {
    const m = url ? /\/@([^/?#]+)/.exec(url) : null
    if (!m) return null
    try {
      return `@${decodeURIComponent(m[1]).toLowerCase()}`
    } catch {
      return `@${m[1].toLowerCase()}`
    }
  }
  const items: ProbeItem[] = []
  const root = document.querySelector('ytd-browse:not([hidden])') ?? document
  for (const el of Array.from(root.querySelectorAll('ytd-channel-renderer, ytd-grid-channel-renderer, yt-lockup-view-model'))) {
    const e = el as unknown as Record<string, unknown>
    const inner = e.__data as Record<string, unknown> | undefined
    const ctrl = e.polymerController as Record<string, unknown> | undefined
    const data = e.data ?? inner?.data ?? ctrl?.data
    if (!data || typeof data !== 'object') continue
    const id = find(data, 0, (k, v) => (k === 'channelId' || k === 'browseId' || k === 'contentId') && typeof v === 'string' && UC.test(v))
    if (typeof id !== 'string') continue
    const canonical = find(data, 0, (k, v) => k === 'canonicalBaseUrl' && typeof v === 'string')
    const link = el.querySelector('a[href*="/@"], a[href*="/channel/"]')
    const url = abs(canonical) ?? abs(link?.getAttribute('href'))
    items.push({ channel_id: id, url, handle: handleOf(url) })
  }
  return { logged_in, items }
}

/**
 * Runs **in the tab's MAIN world** before the scrape (serialized function: no outer scope; the names below are
 * those of `NUDGE_EVENT`/`NUDGE_ATTR` in content/scraper, checked in a test). Installs a listener for the DOM event the
 * scraper fires when the list stalls: finds the page's `ytd-continuation-item-renderer` and calls **once** the
 * loading method the element itself exposes (on the element or on the `polymerController`), if any.
 * It builds no request and reads no cookie or token: it only asks YouTube for what it would do on seeing the item on screen.
 * Response in `<html data-tube-nudge>`: `called:<method>`, `already`, `none` (no method), `no_element`,
 * `error:<method>`. Returns `false` if it was already installed.
 */
export function installContinuationNudger(): boolean {
  const g = globalThis as unknown as Record<symbol, unknown>
  const key = Symbol.for('tube.continuationNudger')
  if (g[key]) return false
  g[key] = true
  const METHODS = ['triggerIfNotPreviouslyTriggered', 'trigger']
  const done = new WeakSet<object>()
  document.addEventListener('tube:nudge-continuation', () => {
    const answer = (v: string) => document.documentElement.setAttribute('data-tube-nudge', v)
    const root = document.querySelector('ytd-browse:not([hidden])') ?? document
    const el = root.querySelector('ytd-continuation-item-renderer')
    if (!el) return answer('no_element')
    if (done.has(el)) return answer('already')
    const e = el as unknown as Record<string, unknown>
    const targets = [e, e.polymerController, e.inst].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    for (const target of targets) {
      for (const name of METHODS) {
        const fn = target[name]
        if (typeof fn !== 'function') continue
        done.add(el)
        try {
          ;(fn as () => unknown).call(target)
          return answer(`called:${name}`)
        } catch {
          return answer(`error:${name}`)
        }
      }
    }
    return answer('none')
  })
  return true
}

// ------------------------------------------------------------------ final batch

export interface FinalBatch {
  batch: SubscriptionBatchBody
  dropped: number
  /** reason for the downgrade to `partial` here (null = not downgraded) */
  reason: 'logged_out' | 'missing_ids' | 'too_many' | null
}

/** Completes ids through the MAIN world, drops items without a valid id, dedupes, caps at 5000. When in doubt, `partial`. */
export function finalizeBatch(channels: ChannelIn[], signal: SyncSignal, probe: ProbeResult | null): FinalBatch {
  const byHandle = new Map<string, string>()
  const byUrl = new Map<string, string>()
  for (const it of probe?.items ?? []) {
    if (!CHANNEL_ID.test(it.channel_id)) continue
    if (it.handle) byHandle.set(it.handle.toLowerCase(), it.channel_id)
    if (it.url) byUrl.set(it.url.toLowerCase(), it.channel_id)
  }
  let reason: FinalBatch['reason'] = null
  let out: SyncSignal = signal === 'complete' ? 'complete' : 'partial'
  if (probe?.logged_in === false) {
    out = 'partial'
    reason = 'logged_out'
  }
  const seen = new Set<string>()
  const kept: ChannelIn[] = []
  let dropped = 0
  for (const c of Array.isArray(channels) ? channels : []) {
    if (!c || typeof c.title !== 'string') {
      dropped++
      continue
    }
    let id = typeof c.channel_id === 'string' && CHANNEL_ID.test(c.channel_id) ? c.channel_id : null
    if (!id) id = (c.handle && byHandle.get(c.handle.toLowerCase())) || (c.url && byUrl.get(c.url.toLowerCase())) || null
    if (!id) {
      dropped++
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    kept.push(id === c.channel_id ? c : { ...c, channel_id: id })
  }
  if (dropped > 0 && out === 'complete') {
    out = 'partial'
    reason = 'missing_ids'
  }
  if (kept.length > MAX_CHANNELS) {
    kept.length = MAX_CHANNELS
    if (out === 'complete') reason = 'too_many'
    out = 'partial'
  }
  return { batch: { channels: kept, signal: out }, dropped, reason }
}

// ------------------------------------------------------------------ sync tab

type TabOutcome = { ok: true; scrape: ScrapeReply; probe: ProbeResult | null } | { ok: false; code: string; message: string }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Origin {
  tabId: number
  windowId: number
}

/** active tab of the focused window (where the user asked for "sync now") */
async function originTab(): Promise<Origin | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return tab?.id != null && tab.windowId != null ? { tabId: tab.id, windowId: tab.windowId } : null
  } catch {
    return null
  }
}

/** Visible: active, in the origin's window, next to it; if the window does not accept a tab (popup, app), in the focused window. */
async function createSyncTab(visible: boolean, origin: Origin | null): Promise<chrome.tabs.Tab> {
  if (!visible) return chrome.tabs.create({ url: 'about:blank', active: false })
  if (origin) {
    try {
      return await chrome.tabs.create({ url: 'about:blank', active: true, windowId: origin.windowId, openerTabId: origin.tabId })
    } catch {
      // origin window closed or of another type: fall back to the focused window
    }
  }
  return chrome.tabs.create({ url: 'about:blank', active: true })
}

/**
 * Closes the sync tab and, if it was in view (or the user closed it), returns focus to the origin tab.
 * Never throws (the origin window/tab may be gone).
 */
async function closeAndRestore(tabId: number | null, origin: Origin | null, closedByUser: boolean): Promise<void> {
  let wasActive = closedByUser
  if (tabId !== null && !closedByUser) {
    wasActive = (await chrome.tabs.get(tabId).catch(() => null))?.active === true
  }
  // activate the origin before closing: the user does not see Chrome jump to the neighboring tab
  if (origin && wasActive) await chrome.tabs.update(origin.tabId, { active: true }).catch(() => undefined)
  if (tabId !== null && !closedByUser) await chrome.tabs.remove(tabId).catch(() => undefined)
}

async function scrapeInTab(ctx: BackgroundContext, visible: boolean): Promise<TabOutcome> {
  let tabId: number | null = null
  let closed = false
  const origin = visible ? await originTab() : null
  const closers = new Set<() => void>()
  const onRemoved = (id: number) => {
    if (id !== tabId) return
    closed = true
    for (const fn of closers) fn()
  }
  /** resolves null when the tab closes */
  const untilClosed = new Promise<null>((r) => closers.add(() => r(null)))
  chrome.tabs.onRemoved.addListener(onRemoved)
  try {
    // empty tab first and navigation afterwards: the listeners (closed/loaded) are already attached when the page starts
    const tab = await createSyncTab(visible, origin)
    if (tab?.id == null) return { ok: false, code: 'scrape_failed', message: 'tab not created' }
    tabId = tab.id
    await chrome.storage.local.set({ [SYNC_RUN_KEY]: { tab_id: tabId, origin_tab_id: origin?.tabId ?? null, visible, started_at: ctx.now() } })
    await chrome.tabs.update(tabId, { url: FEED_CHANNELS_URL })

    // 1. loaded? where did it stop? (logged out, YouTube redirects to the Google login)
    const loaded = await Promise.race([waitTabComplete(tabId), untilClosed])
    if (closed || loaded === null) return { ok: false, code: 'tab_closed', message: 'tab closed' }
    if (loaded === false) return { ok: false, code: 'tab_timeout', message: 'feed/channels did not load' }
    const landed = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? ''
    if (!landed.startsWith(FEED_CHANNELS_URL)) {
      const signin = /^https:\/\/accounts\.google\.com\//.test(landed) || /\/signin|ServiceLogin/.test(landed)
      return { ok: false, code: signin ? 'logged_out' : 'scrape_failed', message: `landed on ${landed.split('?')[0] || '(unknown)'}` }
    }

    // 2. continuation trigger in the MAIN world (the scraper calls it when the scroll stalls)
    await runInMain(tabId, installContinuationNudger)
    if (closed) return { ok: false, code: 'tab_closed', message: 'tab closed' }

    // 3. scrape (retries while the content script is not listening yet)
    const deadline = Date.now() + READY_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), SCRAPE_TIMEOUT_MS)))
    try {
      for (;;) {
        const res = await Promise.race([ctx.sendTabCommand(tabId, 'scrape.subscriptions', { visible }), untilClosed, timeout])
        if (closed || res === null) return { ok: false, code: 'tab_closed', message: 'tab closed' }
        if (res === 'timeout') return { ok: false, code: 'tab_timeout', message: 'scrape did not finish' }
        if (res.ok) {
          const probe = await runProbe(tabId)
          if (closed) return { ok: false, code: 'tab_closed', message: 'tab closed' }
          return { ok: true, scrape: res.data as ScrapeReply, probe }
        }
        const notReady = /Receiving end does not exist|Could not establish connection/i.test(res.error.message)
        if (!notReady || Date.now() > deadline) return { ok: false, code: 'scrape_failed', message: res.error.message }
        await sleep(READY_RETRY_MS)
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    return { ok: false, code: closed ? 'tab_closed' : 'scrape_failed', message: errorMessage(e) }
  } finally {
    chrome.tabs.onRemoved.removeListener(onRemoved)
    await closeAndRestore(tabId, origin, closed)
    await chrome.storage.local.remove(SYNC_RUN_KEY)
  }
}

/** loaded a real page (not the initial about:blank)? */
const loadedPage = (tab: { status?: string; url?: string } | null | undefined): boolean =>
  tab?.status === 'complete' && typeof tab.url === 'string' && /^https?:\/\//.test(tab.url)

/** true = loaded; false = timed out */
function waitTabComplete(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve(v)
    }
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo, tab?: chrome.tabs.Tab) => {
      if (id === tabId && info.status === 'complete' && loadedPage({ status: 'complete', url: tab?.url })) finish(true)
    }
    const timer = setTimeout(() => finish(false), TAB_LOAD_TIMEOUT_MS)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (loadedPage(tab)) finish(true)
      })
      .catch(() => undefined)
  })
}

async function runInMain(tabId: number, func: () => unknown): Promise<unknown> {
  try {
    const out = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func })
    return out?.[0]?.result
  } catch (e) {
    console.warn(`[tube] sync: MAIN world (${func.name}) failed`, errorMessage(e))
    return undefined
  }
}

async function runProbe(tabId: number): Promise<ProbeResult | null> {
  const r = (await runInMain(tabId, probeSubscriptionIds)) as ProbeResult | undefined
  return r && Array.isArray(r.items) ? r : null
}

// ------------------------------------------------------------------ state

async function readStatus(): Promise<SyncStatus | null> {
  const got = await chrome.storage.local.get(SYNC_STATUS_KEY)
  return (got[SYNC_STATUS_KEY] as SyncStatus | undefined) ?? null
}
async function readPending(): Promise<PendingBatch | null> {
  const got = await chrome.storage.local.get(SYNC_PENDING_KEY)
  return (got[SYNC_PENDING_KEY] as PendingBatch | undefined) ?? null
}

function messageFor(s: Omit<SyncStatus, 'message'>): string {
  if (s.state === 'running') return t('sync', 'running')
  if (s.state === 'ok') {
    if (s.signal === 'complete') return t('sync', 'done_complete', { count: s.sent })
    return t('sync', s.needs_visible ? 'done_partial_needs_visible' : 'done_partial', { count: s.sent })
  }
  const code = s.error?.code ?? 'internal'
  const known = ['invalid', 'unauthorized', 'ext_endpoint_down', 'timeout', 'tab_closed', 'tab_timeout', 'scrape_failed', 'nothing_to_send', 'logged_out', 'cancelled']
  return t('sync', known.includes(code) ? `error_${code}` : 'error_other')
}

// ------------------------------------------------------------------ synchronizer

export interface Syncer {
  /** `sync.now`/alarm: starts (or joins) the sync; error if not paired */
  start(trigger: SyncTrigger): Promise<Envelope<{ started: boolean }>>
  /** sends a batch (applies the `finalizeBatch` rules first) */
  send(channels: ChannelIn[], signal: SyncSignal, trigger: SyncTrigger, meta?: { reason?: string | null; probe?: ProbeResult | null }): Promise<Envelope<SyncReport>>
  /** resends the batch stored after a network failure (on the new `ExtState`) */
  retryPending(): Promise<void>
  ensureAlarm(): Promise<void>
  running(): Promise<void> | null
}

export function createSyncer(ctx: BackgroundContext): Syncer {
  let current: Promise<void> | null = null
  let retrying: Promise<void> | null = null

  /** `needs_visible` omitted = keeps the previous one (nothing proved the list loads in full) */
  async function saveStatus(s: Omit<SyncStatus, 'message' | 'last_ok_at' | 'needs_visible'> & { last_ok_at?: number | null; needs_visible?: boolean }): Promise<void> {
    const prev = await readStatus()
    const full = { ...s, last_ok_at: s.last_ok_at ?? prev?.last_ok_at ?? null, needs_visible: s.needs_visible ?? prev?.needs_visible ?? false }
    await chrome.storage.local.set({ [SYNC_STATUS_KEY]: { ...full, message: messageFor(full) } })
  }

  async function post(
    batch: SubscriptionBatchBody,
    trigger: SyncTrigger,
    meta: { started_at: number; scraped_at: number; reason: string | null; dropped: number; needs_visible?: boolean }
  ) {
    const res = await ctx.client.request('POST /ext/sync/subscriptions', { body: batch })
    const base = {
      trigger,
      started_at: meta.started_at,
      finished_at: ctx.now(),
      signal: batch.signal,
      reason: meta.reason,
      sent: batch.channels.length,
      dropped: meta.dropped,
      needs_visible: meta.needs_visible
    }
    if (res.ok) {
      await chrome.storage.local.remove(SYNC_PENDING_KEY)
      const r = res.data
      // the server may refuse to trust a complete list (too many channels missing at once): it counts as partial
      const downgraded = batch.signal === 'complete' && r.signal === 'partial'
      await saveStatus({
        ...base,
        ...(downgraded ? { signal: 'partial' as const, reason: 'server_partial' } : {}),
        state: 'ok',
        report: { added: r.added?.length ?? 0, updated: r.updated?.length ?? 0, marked_ex: r.marked_ex?.length ?? 0 },
        error: null,
        last_ok_at: ctx.now()
      })
      return res
    }
    const code = res.error.code
    if (code === 'invalid') {
      // batch outside the contract = extension bug: log and do not resend
      console.error('[tube] POST /ext/sync/subscriptions rejected the batch (invalid): bug, not resent', res.error)
      await chrome.storage.local.remove(SYNC_PENDING_KEY)
    } else if (code === 'unauthorized') {
      // not paired or token refused: the client already marked the connection; pairing again fixes it
      await chrome.storage.local.remove(SYNC_PENDING_KEY)
    } else {
      // network/timeout/server: keep for resending when it is back (idempotent on the server)
      const pending: PendingBatch = { batch, scraped_at: meta.scraped_at, reason: meta.reason, dropped: meta.dropped, needs_visible: meta.needs_visible }
      await chrome.storage.local.set({ [SYNC_PENDING_KEY]: pending })
    }
    await saveStatus({ ...base, state: 'error', report: null, error: { code, message: res.error.message } })
    return res
  }

  async function send(channels: ChannelIn[], signal: SyncSignal, trigger: SyncTrigger, meta: { reason?: string | null; probe?: ProbeResult | null } = {}) {
    const started_at = ctx.now()
    const fin = finalizeBatch(channels, signal, meta.probe ?? null)
    const reason = fin.reason ?? meta.reason ?? null
    return post(fin.batch, trigger, { started_at, scraped_at: started_at, reason, dropped: fin.dropped })
  }

  async function run(trigger: SyncTrigger): Promise<void> {
    const started_at = ctx.now()
    const idle = { trigger, started_at, finished_at: null, signal: null, reason: null, sent: 0, dropped: 0, report: null, error: null }
    await saveStatus({ ...idle, state: 'running' })
    const getInfo = (chrome.runtime as unknown as { getPlatformInfo?: () => Promise<unknown> }).getPlatformInfo
    const keepalive = setInterval(() => void getInfo?.call(chrome.runtime)?.catch?.(() => undefined), KEEPALIVE_MS)
    // user trigger (button or pairing): tab in view (YouTube's continuation only loads with a rendered tab)
    const visible = trigger === 'manual' || trigger === 'pair'
    try {
      const out = await scrapeInTab(ctx, visible)
      if (!out.ok) {
        await saveStatus({ ...idle, state: 'error', finished_at: ctx.now(), error: { code: out.code, message: out.message } })
        return
      }
      if (out.scrape.reason === 'cancelled') {
        // the user cancelled in the notice: the list is half done and they asked to stop — nothing goes to the server
        await saveStatus({ ...idle, state: 'error', finished_at: ctx.now(), reason: 'cancelled', error: { code: 'cancelled', message: 'cancelled by user' } })
        return
      }
      const fin = finalizeBatch(out.scrape.channels, out.scrape.signal, out.probe)
      const reason = fin.reason ?? out.scrape.reason ?? null
      // background and stalled: the list does not load without the tab in view → the screens ask for "sync now"
      const stalledInBackground = !visible && NEEDS_VISIBLE_REASONS.includes(out.scrape.reason ?? '')
      const needs_visible = fin.batch.signal === 'complete' ? false : stalledInBackground ? true : visible ? false : undefined
      if (fin.batch.channels.length === 0) {
        // nothing identifiable (logged out, empty page): nothing to send
        await saveStatus({
          ...idle,
          state: 'error',
          finished_at: ctx.now(),
          signal: fin.batch.signal,
          reason,
          dropped: fin.dropped,
          error: { code: 'nothing_to_send', message: reason ?? 'empty' }
        })
        return
      }
      await post(fin.batch, trigger, { started_at, scraped_at: ctx.now(), reason, dropped: fin.dropped, needs_visible })
    } catch (e) {
      await saveStatus({ ...idle, state: 'error', finished_at: ctx.now(), error: { code: 'scrape_failed', message: errorMessage(e) } })
    } finally {
      clearInterval(keepalive)
    }
  }

  async function retryPending(): Promise<void> {
    if (current || retrying) return
    retrying = (async () => {
      const p = await readPending()
      if (!p) return
      const age = ctx.now() - p.scraped_at
      if (!(age >= 0) || age > PENDING_MAX_AGE_MS) {
        await chrome.storage.local.remove(SYNC_PENDING_KEY)
        return
      }
      let batch = p.batch
      let reason = p.reason
      if (age > PENDING_FRESH_MS && batch.signal === 'complete') {
        batch = { ...batch, signal: 'partial' }
        reason = 'stale'
      }
      await post(batch, 'retry', { started_at: ctx.now(), scraped_at: p.scraped_at, reason, dropped: p.dropped, needs_visible: p.needs_visible })
    })().finally(() => (retrying = null))
    return retrying
  }

  async function ensureAlarm(): Promise<void> {
    const got = await chrome.storage.local.get(STORAGE_KEYS.connection)
    const paired = Boolean((got[STORAGE_KEYS.connection] as StoredConnection | undefined)?.token)
    if (!paired) {
      await chrome.alarms.clear(ALARMS.sync)
      return
    }
    const existing = await chrome.alarms.get(ALARMS.sync)
    if (existing && existing.periodInMinutes === SYNC_PERIOD_MIN) return
    // first time (or old sync): in 1 min; otherwise, what remains of the 6 h
    const last = (await readStatus())?.last_ok_at ?? null
    const since = last ? (ctx.now() - last) / 60_000 : Infinity
    const delay = since < SYNC_PERIOD_MIN ? Math.max(1, SYNC_PERIOD_MIN - since) : 1
    await chrome.alarms.create(ALARMS.sync, { periodInMinutes: SYNC_PERIOD_MIN, delayInMinutes: delay })
  }

  return {
    async start(trigger) {
      if (current) return ok({ started: true })
      const conn = await ctx.client.status()
      if (current) return ok({ started: true })
      if (conn.state === 'unpaired') return fail('unauthorized', t('common', 'unpaired'), { reason: 'unpaired' })
      // token already refused (401): do not open a tab for nothing; pairing again changes the state
      if (conn.state === 'unauthorized') return fail('unauthorized', t('common', 'unauthorized'), { reason: 'unauthorized' })
      current = run(trigger).finally(() => (current = null))
      return ok({ started: true })
    },
    send,
    retryPending,
    ensureAlarm,
    running: () => current
  }
}

export const sync: BackgroundModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  MESSAGES,
  register(ctx) {
    const syncer = createSyncer(ctx)
    ctx.router.onEnvelope('sync.now', (p) => syncer.start(p?.trigger === 'pair' ? 'pair' : 'manual'))
    // a list handed over by a content script is never proof of the whole list: never marks missing channels
    ctx.router.onEnvelope('sync.subscriptions', (p) => syncer.send(p.channels, 'partial', 'page'))
    ctx.onAlarm(ALARMS.sync, async () => {
      await syncer.start('alarm')
    })
    // server answered the state: resend the batch stored after a network failure (without holding up the state cycle)
    ctx.onState(() => {
      void syncer.retryPending()
    })
    // 6 h alarm follows the pairing (synchronous listeners: an MV3 requirement)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(STORAGE_KEYS.connection in changes)) return
      const { oldValue, newValue } = changes[STORAGE_KEYS.connection] as { oldValue?: StoredConnection; newValue?: StoredConnection }
      if (oldValue?.token === newValue?.token) return
      void syncer.ensureAlarm()
    })
    chrome.runtime.onStartup?.addListener(() => void syncer.ensureAlarm())
    chrome.runtime.onInstalled?.addListener(() => void syncer.ensureAlarm())
    void syncer.ensureAlarm()
    // previous SW died midway through a sync: close the leftover tab (and return focus, if it was the visible one)
    void (async () => {
      const got = await chrome.storage.local.get(SYNC_RUN_KEY)
      const run = got[SYNC_RUN_KEY] as { tab_id?: number; origin_tab_id?: number | null } | undefined
      if (!run || syncer.running()) return
      if (typeof run.tab_id === 'number') {
        const origin = typeof run.origin_tab_id === 'number' ? { tabId: run.origin_tab_id, windowId: -1 } : null
        await closeAndRestore(run.tab_id, origin, false)
      }
      await chrome.storage.local.remove(SYNC_RUN_KEY)
    })().catch(() => undefined)
  }
}
