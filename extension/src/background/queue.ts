// background/queue — executor of the unsubscribe/resubscribe queue (ext-protocol.md, "Unsubscribe queue";
// server: plugin/ext/queue.py). Behavior derived from the MyTube content script (same author, relicensed under MIT here),
// rewritten for the Hermes queue.
//
// Product invariant: **nothing is unsubscribed without a human click.** This module only acts on the item that `GET /ext/queue`
// just delivered (the server only delivers `approved` items with a human `approved_via`). Never on chrome.storage,
// a page/content script message or another tab; it does not decide, group or repeat on its own. There is no
// `ExtRequests` message that orders an execution (MESSAGES is empty).
//
// - A human click before each round (`lib/queue-release`): with `queue_pending > 0` the module only **lists** the
//   approved items (`GET /ext/queue?peek=1`, nothing lent) for the popup and puts the count on the toolbar badge.
//   A round runs only after "Run now" in the popup released ids in `chrome.storage.session`, and it runs only those
//   ids, each once; an item that was not in the list the user saw ends the round before any click.
// - Trigger: each new `ExtState` (the core's 30 s alarm) with `queue_pending > 0` and a release starts a round, if
//   none is running and the queue is not stopped/held. No loop of its own.
// - Round: up to `ROUND_CAP` (20) items, **one at a time**: `GET /ext/queue` → (random 3–6 s pause if there was already an
//   item in this round) → `POST …/result {running}` (409 conflict = undone/other device: skip) → **visible** tab
//   (one per round, next to the origin tab) navigated to `/channel/<UC…>` → `queue.execute` in content/unsubscribe
//   (checks the channel, clicks, confirms, verifies) → `POST …/result {done|failed, error}` with a short, stable reason.
// - Stops at once on: logged out (`logged_out`, holds 1 h), challenge/captcha (`challenge`, 6 h), 2 failures in a row
//   (30 min), "Stop" (popup or in-page notice: `QUEUE_CTL_KEY`; stays stopped until `resumeQueue()`), tab closed by the
//   user (= Stop). Round cap → holds 5 min.
// - Never twice: each item that starts goes in the ledger `QUEUE_LEDGER_KEY` (with the result and whether it was reported);
//   an item that comes back from the queue and is already in the ledger does not run again (if the result did not reach the server, it is only
//   reported). SW that sleeps midway: the item in progress (`QUEUE_RUN_KEY.current`) becomes `failed/interrupted` on
//   rebirth (or the real result, if it already existed) — reported once, never repeated; orphan tab closed, focus returned.
// - Progress for the popup in `QUEUE_RUN_KEY` (`QueueProgress`, `message` already translated: "unsubscribing 2 of 5 · …").
import type { Channel, ExtQueueView, ExtRouteKey, ExtState, QueueAction, QueueItem } from '../../../shared/api-types'
import { type ExtTabCommands, type QueueCurrentItem, type QueueProgress, STORAGE_KEYS } from '../../../shared/ext-messages'
import type { BackgroundContext, BackgroundModule } from '../lib/background'
import { errorMessage } from '../lib/envelope'
import { t } from '../lib/i18n'
import {
  QUEUE_RELEASE_KEY,
  WAITING_MAX,
  consumeRelease,
  readRelease,
  readSnooze,
  unreleased,
  writeWaiting,
  type QueueRelease,
  type WaitingItem
} from '../lib/queue-release'

export const MODULE = 'background/queue'
export const ROUTES = ['GET /ext/queue', 'POST /ext/queue/{id}/result'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = ['GET /ext/queue', 'POST /ext/queue/{id}/result']
/**
 * No message orders an execution: only the server queue. The two from the popup only **stop** (`queue.stop`) or
 * **release** the queue and ask for a new `ExtState` (`queue.resume`) — what runs afterwards still comes from `GET /ext/queue`.
 */
export const MESSAGES = ['queue.stop', 'queue.resume'] as const

/**
 * Keys in chrome.storage.local (`STORAGE_KEYS.queueRun/queueCtl/queueLedger`).
 * - `queue_run`: `QueueProgress` (progress for the popup + item in progress for the SW's rebirth).
 * - `queue_ctl`: `{stopped, by, at}` — "Stop" (popup/notice). It only **stops**; never orders anything to run.
 * - `queue_ledger`: items already started (`LedgerEntry`), never executed again.
 */
export const QUEUE_RUN_KEY = STORAGE_KEYS.queueRun
export const QUEUE_CTL_KEY = STORAGE_KEYS.queueCtl
export const QUEUE_LEDGER_KEY = STORAGE_KEYS.queueLedger

export const ROUND_CAP = 20
export const PAUSE_MIN_MS = 3000
export const PAUSE_MAX_MS = 6000
export const MAX_CONSECUTIVE_FAILURES = 2
export const HOLD_MS = {
  logged_out: 60 * 60_000,
  challenge: 6 * 60 * 60_000,
  failures: 30 * 60_000,
  cap: 5 * 60_000
} as const
export type HoldReason = keyof typeof HOLD_MS

/** how many items the ledger keeps (the oldest drop out; the server will already have them as done/failed) */
const LEDGER_MAX = 300
const TAB_LOAD_TIMEOUT_MS = 45_000
/** the content script is not listening yet ("Receiving end does not exist"): retry up to this */
const READY_TIMEOUT_MS = 20_000
const READY_RETRY_MS = 300
/** cap for the whole command on the page (the content script has per-step deadlines, much shorter) */
const EXECUTE_TIMEOUT_MS = 120_000
const KEEPALIVE_MS = 20_000

const YT = 'https://www.youtube.com'
const CHANNEL_ID = /^UC[\w-]{22}$/
const ACTIONS: readonly QueueAction[] = ['unsubscribe', 'resubscribe']

/** Short, stable reasons (they go in the `error` of `POST …/result`). `done` notes: `not_subscribed`, `already_subscribed`. */
export const QUEUE_REASONS = [
  'not_subscribed',
  'already_subscribed',
  'button_not_found',
  'confirm_not_found',
  'state_unchanged',
  'wrong_channel',
  'logged_out',
  'challenge',
  'timeout',
  'stopped',
  'interrupted',
  'tab_closed',
  'invalid_item',
  'page_error'
] as const
export type QueueReason = (typeof QUEUE_REASONS)[number]
export const DONE_NOTES: readonly QueueReason[] = ['not_subscribed', 'already_subscribed']

export type ExecResult = ExtTabCommands['queue.execute']['res']

export const channelPageUrl = (channelId: string): string => `${YT}/channel/${channelId}`

// ------------------------------------------------------------------ stored state

/** Shapes moved to `shared/ext-messages.ts` (the popup reads `QueueProgress`), re-exported here. */
export type CurrentItem = QueueCurrentItem
export type { QueueProgress }

export interface LedgerEntry {
  status: 'done' | 'failed' | 'skipped'
  error: string | null
  reported: boolean
  at: number
}
type Ledger = Record<string, LedgerEntry>

export interface QueueCtl {
  stopped: boolean
  /** who asked: `popup`, `overlay`, `tab`, `page` */
  by: string
  at: number
}

/** "Stop" (popup or in-page notice): the queue stops after the click in progress and does not restart on its own. */
export async function requestQueueStop(by: string): Promise<void> {
  const ctl: QueueCtl = { stopped: true, by, at: Date.now() }
  await chrome.storage.local.set({ [QUEUE_CTL_KEY]: ctl })
}

/** Resume after "Stop" (popup). Also releases a held queue (logged out, failures, cap). */
export async function resumeQueue(): Promise<void> {
  await chrome.storage.local.remove(QUEUE_CTL_KEY)
  const run = await readProgress()
  if (run && run.state !== 'running') {
    await writeProgress({ ...run, state: 'idle', hold_reason: null, hold_until: null, consecutive_failures: 0 })
  }
}

async function readCtl(): Promise<QueueCtl | null> {
  const got = await chrome.storage.local.get(QUEUE_CTL_KEY)
  const ctl = got[QUEUE_CTL_KEY] as QueueCtl | undefined
  return ctl?.stopped ? ctl : null
}

async function readProgress(): Promise<QueueProgress | null> {
  const got = await chrome.storage.local.get(QUEUE_RUN_KEY)
  const v = got[QUEUE_RUN_KEY] as QueueProgress | undefined
  return v && typeof v === 'object' ? v : null
}

function messageFor(p: Omit<QueueProgress, 'message'>): string {
  const channel = p.channel_title || p.channel_id || ''
  if (p.state === 'running') {
    if (!p.action || p.index === 0) return t('queue', 'status_starting')
    return t('queue', `progress_${p.action}`, { index: p.index, total: Math.max(p.total, p.index), channel })
  }
  if (p.state === 'stopped') return t('queue', 'status_stopped')
  if (p.state === 'paused' && p.hold_reason) return t('queue', `status_paused_${p.hold_reason}`, { count: ROUND_CAP })
  return t('queue', 'status_idle', { done: p.done, failed: p.failed })
}

async function writeProgress(p: Omit<QueueProgress, 'message'> & { message?: string }): Promise<QueueProgress> {
  const full = { ...p, message: messageFor(p) } as QueueProgress
  await chrome.storage.local.set({ [QUEUE_RUN_KEY]: full })
  return full
}

function emptyProgress(now: number): Omit<QueueProgress, 'message'> {
  return {
    state: 'idle',
    action: null,
    index: 0,
    total: 0,
    channel_id: null,
    channel_title: null,
    done: 0,
    failed: 0,
    last: null,
    consecutive_failures: 0,
    hold_reason: null,
    hold_until: null,
    started_at: null,
    updated_at: now,
    tab_id: null,
    origin_tab_id: null,
    current: null
  }
}

async function readLedger(): Promise<Ledger> {
  const got = await chrome.storage.local.get(QUEUE_LEDGER_KEY)
  const v = got[QUEUE_LEDGER_KEY]
  return v && typeof v === 'object' ? (v as Ledger) : {}
}

async function writeLedgerEntry(id: string, entry: LedgerEntry): Promise<void> {
  const led = await readLedger()
  led[id] = entry
  const ids = Object.keys(led)
  if (ids.length > LEDGER_MAX) {
    ids.sort((a, b) => led[a].at - led[b].at)
    for (const old of ids.slice(0, ids.length - LEDGER_MAX)) delete led[old]
  }
  await chrome.storage.local.set({ [QUEUE_LEDGER_KEY]: led })
}

// ------------------------------------------------------------------ validation (server and page response)

interface Picked {
  item: QueueItem
  channel: Channel | null
}

/** Executable item: only `approved`, with human approval, a valid channel and action. */
function validItem(raw: unknown): QueueItem | null {
  const it = raw as Partial<QueueItem> | null | undefined
  if (!it || typeof it !== 'object') return null
  if (typeof it.id !== 'string' || !it.id || it.id.length > 200) return null
  if (it.status !== 'approved') return null
  if (typeof it.approved_via !== 'string' || !it.approved_via) return null
  if (typeof it.approved_at !== 'number' || !(it.approved_at > 0)) return null
  if (typeof it.channel_id !== 'string' || !CHANNEL_ID.test(it.channel_id)) return null
  if (!ACTIONS.includes(it.action as QueueAction)) return null
  return it as QueueItem
}

function channelOf(view: Partial<ExtQueueView> | null, channelId: string): Channel | null {
  const ch = (view?.channels as Record<string, Channel> | undefined)?.[channelId]
  return ch && typeof ch === 'object' ? ch : null
}

/** The item the server delivered, if executable. */
export function pickItem(view: unknown): Picked | null {
  const v = view as Partial<ExtQueueView> | null
  const it = validItem(Array.isArray(v?.items) ? v!.items[0] : undefined)
  return it ? { item: it, channel: channelOf(v, it.channel_id) } : null
}

/** The listing for the "Run now" prompt (`GET /ext/queue?peek=1`): executable items only, at most `WAITING_MAX`. */
export function waitingItems(view: unknown): WaitingItem[] {
  const v = view as Partial<ExtQueueView> | null
  const out: WaitingItem[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(v?.items) ? v!.items : []) {
    const it = validItem(raw)
    if (!it || seen.has(it.id)) continue
    seen.add(it.id)
    out.push({ id: it.id, channel_id: it.channel_id, channel_title: titleOf(channelOf(v, it.channel_id)), action: it.action })
    if (out.length >= WAITING_MAX) break
  }
  return out
}

/** Toolbar badge: how many approved items wait for "Run now" (empty = none). Never throws. */
async function setBadge(count: number): Promise<void> {
  const action = (globalThis.chrome as { action?: typeof chrome.action } | undefined)?.action
  if (!action?.setBadgeText) return
  try {
    await action.setBadgeText({ text: count > 0 ? String(Math.min(count, 999)) : '' })
    if (count > 0) await action.setBadgeBackgroundColor?.({ color: '#b45309' })
  } catch {
    // the badge is a hint only
  }
}

/** Content script response → stable result. When in doubt, `failed/page_error` (never `done` without certainty). */
export function normalizeResult(res: unknown): ExecResult {
  const r = res as { status?: unknown; error?: unknown } | null
  const err = typeof r?.error === 'string' ? r.error : r?.error === null || r?.error === undefined ? null : undefined
  if (r?.status === 'done' && (err === null || DONE_NOTES.includes(err as QueueReason))) return { status: 'done', error: err ?? null }
  if (r?.status === 'failed' && typeof err === 'string' && (QUEUE_REASONS as readonly string[]).includes(err)) return { status: 'failed', error: err }
  return { status: 'failed', error: 'page_error' }
}

const titleOf = (c: Channel | null): string | null => (typeof c?.title === 'string' ? c.title.slice(0, 200) : null)

// ------------------------------------------------------------------ tabs

interface Origin {
  tabId: number
  windowId: number
}

async function originTab(): Promise<Origin | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return tab?.id != null ? { tabId: tab.id, windowId: tab.windowId ?? -1 } : null
  } catch {
    return null
  }
}

/** **Visible** tab (Chrome does not render a background tab), in the origin's window, next to it. */
async function createVisibleTab(origin: Origin | null): Promise<chrome.tabs.Tab> {
  if (origin && origin.windowId >= 0) {
    try {
      return await chrome.tabs.create({ url: 'about:blank', active: true, windowId: origin.windowId, openerTabId: origin.tabId })
    } catch {
      // origin window closed or of another type: fall back to the focused window
    }
  }
  return chrome.tabs.create({ url: 'about:blank', active: true })
}

/** Closes the queue tab; if it was in view (or the user closed it), returns focus to the origin. Never throws. */
async function closeAndRestore(tabId: number | null, originId: number | null, closedByUser: boolean): Promise<void> {
  let wasActive = closedByUser
  if (tabId !== null && !closedByUser) wasActive = (await chrome.tabs.get(tabId).catch(() => null))?.active === true
  if (originId !== null && wasActive) await chrome.tabs.update(originId, { active: true }).catch(() => undefined)
  if (tabId !== null && !closedByUser) await chrome.tabs.remove(tabId).catch(() => undefined)
}

const isSignin = (url: string) => /^https:\/\/accounts\.google\.com\//.test(url) || /\/(ServiceLogin|signin)\b/.test(url)
const isChallenge = (url: string) => /^https:\/\/(www\.)?google\.[a-z.]+\/sorry\//.test(url) || /^https:\/\/www\.youtube\.com\/sorry\b/.test(url) || /^https:\/\/consent\./.test(url)

/** true = loaded a page (≠ the previous one); false = deadline. */
function waitTabLoaded(tabId: number, prevUrl: string | undefined, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearInterval(poll)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve(v)
    }
    const good = (tab: { status?: string; url?: string } | null | undefined) =>
      tab?.status === 'complete' && typeof tab.url === 'string' && /^https?:\/\//.test(tab.url) && tab.url !== prevUrl
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo, tab?: chrome.tabs.Tab) => {
      if (id === tabId && info.status === 'complete' && typeof tab?.url === 'string' && /^https?:\/\//.test(tab.url)) finish(true)
    }
    const check = () =>
      void chrome.tabs
        .get(tabId)
        .then((tab) => good(tab) && finish(true))
        .catch(() => undefined)
    const timer = setTimeout(() => finish(false), timeoutMs)
    const poll = setInterval(check, 500)
    chrome.tabs.onUpdated.addListener(onUpdated)
    check()
  })
}

// ------------------------------------------------------------------ executor

export interface QueueModuleOptions {
  /** [0, 1) — pause = 3 s + random × 3 s */
  random?: () => number
  /** pause between items (default: setTimeout; wakes early if "Stop" is requested) */
  sleep?: (ms: number) => Promise<void>
  tabLoadTimeoutMs?: number
  readyTimeoutMs?: number
  executeTimeoutMs?: number
}

export interface QueueModule extends BackgroundModule {
  /** waits for recovery, reports and a round in progress (tests and debugging) */
  idle(): Promise<void>
}

export function createQueueModule(opts: QueueModuleOptions = {}): QueueModule {
  const random = opts.random ?? Math.random
  const busy = new Set<Promise<unknown>>()
  const track = <T>(p: Promise<T>): Promise<T> => {
    busy.add(p)
    void p.finally(() => busy.delete(p)).catch(() => undefined)
    return p
  }
  let round: Promise<void> | null = null
  let flushing: Promise<boolean> | null = null
  let recovered: Promise<void> = Promise.resolve()
  /** "Stop" arrived in this SW lifetime (wakes the pause) */
  const stopWaiters = new Set<() => void>()

  const sleep =
    opts.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          stopWaiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, ms)
        stopWaiters.add(done)
      }))

  function register(ctx: BackgroundContext): void {
    // synchronous listeners (MV3)
    chrome.storage.onChanged.addListener((changes, area) => {
      // "Run now" in the popup (session storage: extension pages and this worker only) → a fresh ExtState
      if (area === 'session' && QUEUE_RELEASE_KEY in changes && changes[QUEUE_RELEASE_KEY].newValue) {
        void ctx.refreshState()
        return
      }
      if (area !== 'local' || !(QUEUE_CTL_KEY in changes)) return
      if ((changes[QUEUE_CTL_KEY].newValue as QueueCtl | undefined)?.stopped) for (const wake of [...stopWaiters]) wake()
    })
    ctx.onState((state) => {
      // does not hold up the state cycle: the round runs on its own
      void track(onState(ctx, state))
    })
    // popup: "Stop" only stops; "Resume" only releases and asks for a new ExtState — the usual path
    // (`onState` → `GET /ext/queue`) decides what runs. No item leaves from here.
    ctx.router.on('queue.stop', async () => {
      await requestQueueStop('popup')
      return readProgress()
    })
    ctx.router.on('queue.resume', async () => {
      await resumeQueue()
      void ctx.refreshState()
      return readProgress()
    })
    recovered = track(recover(ctx))
  }

  // -------------------------------------------------------------- reports

  async function report(ctx: BackgroundContext, id: string, result: { status: 'done' | 'failed'; error: string | null }): Promise<'ok' | 'gone' | 'error'> {
    const res = await ctx.client.request('POST /ext/queue/{id}/result', { path: { id }, body: { status: result.status, error: result.error } })
    if (res.ok) return 'ok'
    // undone on the Desktop, from another device, already finished or deleted: nothing more to say about it
    if (res.error.code === 'conflict' || res.error.code === 'not_found') return 'gone'
    return 'error'
  }

  /** reports whatever is left unanswered by the server (once each); false = server still down */
  function flushReports(ctx: BackgroundContext): Promise<boolean> {
    if (flushing) return flushing
    flushing = (async () => {
      const led = await readLedger()
      for (const [id, e] of Object.entries(led)) {
        if (e.reported || e.status === 'skipped') continue
        const r = await report(ctx, id, { status: e.status, error: e.error })
        if (r === 'error') return false
        await writeLedgerEntry(id, { ...e, reported: true })
      }
      return true
    })().finally(() => (flushing = null))
    return flushing
  }

  // -------------------------------------------------------------- SW rebirth

  async function recover(ctx: BackgroundContext): Promise<void> {
    try {
      const run = await readProgress()
      if (!run) return
      const cur = run.current
      if (cur && typeof cur.queue_id === 'string' && cur.queue_id) {
        const led = await readLedger()
        if (!led[cur.queue_id]) {
          // the SW died midway: never repeat blindly. Ready result → that; otherwise → interrupted.
          const result = cur.phase === 'finished' && cur.result ? normalizeResult(cur.result) : { status: 'failed' as const, error: 'interrupted' }
          await writeLedgerEntry(cur.queue_id, { status: result.status, error: result.error, reported: false, at: ctx.now() })
        }
      }
      const tabId = typeof run.tab_id === 'number' ? run.tab_id : null
      const originId = typeof run.origin_tab_id === 'number' ? run.origin_tab_id : null
      if (tabId !== null) await closeAndRestore(tabId, originId, false)
      const ctl = await readCtl()
      await writeProgress({
        ...emptyProgress(ctx.now()),
        ...run,
        state: ctl ? 'stopped' : run.hold_until && run.hold_until > ctx.now() ? 'paused' : 'idle',
        current: null,
        tab_id: null,
        updated_at: ctx.now()
      })
      if (cur) await flushReports(ctx)
    } catch (e) {
      console.warn('[tube] queue: recovery failed', errorMessage(e))
    }
  }

  // -------------------------------------------------------------- round

  async function onState(ctx: BackgroundContext, state: ExtState): Promise<void> {
    await recovered
    // a round in progress reports its own items (a flush now would post the same result twice)
    if (round) return
    const flushed = await flushReports(ctx)
    if (!flushed) return
    if (!(typeof state?.queue_pending === 'number' && state.queue_pending > 0)) {
      if (!round) await announce(ctx, [])
      return
    }
    if (round) return
    // assigned synchronously: two ExtStates in a row never start two rounds
    round = (async () => {
      const release = await readRelease(ctx.now())
      if (release) await runRound(ctx, state, release)
      await announce(ctx)
    })().finally(() => (round = null))
    await round
  }

  /**
   * Lists what waits for "Run now" (`GET /ext/queue?peek=1`: nothing is lent) for the popup and the badge.
   * `known` = already known list (`[]` = nothing pending). Never runs anything.
   */
  async function announce(ctx: BackgroundContext, known?: WaitingItem[]): Promise<void> {
    try {
      let items = known
      if (!items) {
        const conn = await ctx.client.status()
        if (conn.state === 'unpaired' || conn.state === 'unauthorized') return
        const peek = ctx.client.request as unknown as (key: 'GET /ext/queue', params: { query: { peek: string } }) => ReturnType<BackgroundContext['client']['request']>
        const res = await peek.call(ctx.client, 'GET /ext/queue', { query: { peek: '1' } })
        if (!res.ok) return
        items = waitingItems(res.data)
      }
      await writeWaiting(items.length ? { items, at: ctx.now() } : null)
      const release = await readRelease(ctx.now())
      await setBadge(unreleased({ items, at: 0 }, release, await readSnooze()).length)
    } catch (e) {
      console.warn('[tube] queue: listing failed', errorMessage(e))
    }
  }

  async function runRound(ctx: BackgroundContext, state: ExtState, release: QueueRelease): Promise<void> {
    const released = new Set(release.ids)
    const conn = await ctx.client.status()
    if (conn.state === 'unpaired' || conn.state === 'unauthorized') return
    const prev = await readProgress()
    if (await readCtl()) {
      if (prev?.state !== 'stopped') await writeProgress({ ...emptyProgress(ctx.now()), ...prev, state: 'stopped', updated_at: ctx.now() })
      return
    }
    if (prev?.hold_until && prev.hold_until > ctx.now()) return

    const origin = await originTab()
    let p: Omit<QueueProgress, 'message'> = {
      ...emptyProgress(ctx.now()),
      state: 'running',
      total: Math.min(ROUND_CAP, state.queue_pending, released.size),
      consecutive_failures: prev?.consecutive_failures ?? 0,
      started_at: ctx.now(),
      origin_tab_id: origin?.tabId ?? null
    }
    const save = async (patch: Partial<QueueProgress> = {}) => {
      p = { ...p, ...patch, updated_at: ctx.now() }
      await writeProgress(p)
    }
    await save()

    let tabId: number | null = null
    let userClosed = false
    const closers = new Set<() => void>()
    const onRemoved = (id: number) => {
      if (id !== tabId) return
      userClosed = true
      for (const fn of [...closers]) fn()
    }
    chrome.tabs.onRemoved.addListener(onRemoved)
    const getInfo = (chrome.runtime as unknown as { getPlatformInfo?: () => Promise<unknown> }).getPlatformInfo
    const keepalive = setInterval(() => void getInfo?.call(chrome.runtime)?.catch?.(() => undefined), KEEPALIVE_MS)
    let end: QueueProgress['state'] = 'idle'
    let hold: HoldReason | null = null

    const stopRequested = async () => userClosed || (await readCtl()) !== null

    try {
      let executedThisRound = 0
      for (let n = 0; n < ROUND_CAP; n++) {
        if (await stopRequested()) {
          end = 'stopped'
          break
        }
        if (released.size === 0) break // every released id was taken: nothing more without a new click
        const res = await ctx.client.request('GET /ext/queue')
        if (!res.ok) break
        const picked = pickItem(res.data)
        if (!picked) break
        const { item, channel } = picked
        const known = (await readLedger())[item.id]
        if (known) {
          // already started before (in this or another SW lifetime): never again; only ensures the report
          if (!known.reported && known.status !== 'skipped') await flushReports(ctx)
          break
        }
        // not in the list the user released with "Run now": no click; the next prompt lists it
        if (!released.has(item.id)) break
        if (executedThisRound > 0) {
          await sleep(PAUSE_MIN_MS + Math.floor(Math.min(Math.max(random(), 0), 0.999999) * (PAUSE_MAX_MS - PAUSE_MIN_MS + 1)))
          if (await stopRequested()) {
            end = 'stopped'
            break
          }
        }

        // 1. the server learns before anything happens on the page (5 min lease → running)
        await save({ current: { queue_id: item.id, channel_id: item.channel_id, action: item.action, phase: 'claimed', started_at: ctx.now() } })
        const running = await ctx.client.request('POST /ext/queue/{id}/result', { path: { id: item.id }, body: { status: 'running' } })
        if (!running.ok) {
          await save({ current: null })
          if (running.error.code === 'conflict' || running.error.code === 'not_found') {
            await writeLedgerEntry(item.id, { status: 'skipped', error: running.error.code, reported: true, at: ctx.now() })
            released.delete(item.id)
            await consumeRelease(item.id)
            continue
          }
          break // server down: the lease expires and the item goes back to the queue (nothing was done)
        }
        // the click released this id once
        released.delete(item.id)
        await consumeRelease(item.id)
        executedThisRound++
        await save({
          current: { ...p.current!, phase: 'running' },
          index: p.index + 1,
          total: Math.max(p.total, p.index + 1),
          action: item.action,
          channel_id: item.channel_id,
          channel_title: titleOf(channel)
        })

        // 2. channel page by id, in a visible tab
        let result: ExecResult
        try {
          if (tabId === null) {
            const tab = await createVisibleTab(origin)
            if (tab?.id == null) throw new Error('tab not created')
            tabId = tab.id
            await save({ tab_id: tabId })
          }
          await save({ current: { ...p.current!, phase: 'executing' } })
          result = await executeInTab(ctx, tabId, item, titleOf(channel), p.index, p.total)
        } catch (e) {
          console.warn('[tube] queue: tab failed', errorMessage(e))
          result = { status: 'failed', error: userClosed ? 'tab_closed' : 'page_error' }
        }
        if (userClosed && result.status !== 'done') result = { status: 'failed', error: 'tab_closed' }

        // 3. ledger before the report: if the SW dies now, the real result is reported on rebirth
        await save({ current: { ...p.current!, phase: 'finished', result } })
        await writeLedgerEntry(item.id, { status: result.status, error: result.error, reported: false, at: ctx.now() })
        const sent = await report(ctx, item.id, result)
        if (sent !== 'error') await writeLedgerEntry(item.id, { status: result.status, error: result.error, reported: true, at: ctx.now() })
        const failed = result.status === 'failed'
        await save({
          current: null,
          done: p.done + (failed ? 0 : 1),
          failed: p.failed + (failed ? 1 : 0),
          consecutive_failures: failed ? p.consecutive_failures + 1 : 0,
          last: { queue_id: item.id, status: result.status, error: result.error }
        })

        // 4. stops
        if (result.error === 'stopped' || result.error === 'tab_closed' || userClosed) {
          if (!(await readCtl())) await requestQueueStop(userClosed || result.error === 'tab_closed' ? 'tab' : 'page')
          end = 'stopped'
          break
        }
        if (result.error === 'logged_out' || result.error === 'challenge') {
          hold = result.error
          break
        }
        if (p.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
          hold = 'failures'
          break
        }
        if (sent === 'error') break // server gone: the report goes out on the next ExtState; does not act without it any more
        if (n === ROUND_CAP - 1) hold = 'cap'
      }
    } catch (e) {
      console.warn('[tube] queue: round failed', errorMessage(e))
    } finally {
      clearInterval(keepalive)
      chrome.tabs.onRemoved.removeListener(onRemoved)
      await closeAndRestore(tabId, origin?.tabId ?? null, userClosed)
      if (p.current) {
        // exception midway through an item: same treatment as rebirth
        const led = await readLedger()
        if (!led[p.current.queue_id]) {
          const r = p.current.phase === 'finished' && p.current.result ? p.current.result : { status: 'failed' as const, error: 'interrupted' }
          await writeLedgerEntry(p.current.queue_id, { status: r.status, error: r.error, reported: false, at: ctx.now() })
        }
      }
      if (end !== 'stopped' && hold) end = 'paused'
      if (end !== 'stopped' && (await readCtl())) end = 'stopped'
      await save({
        state: end,
        current: null,
        tab_id: null,
        hold_reason: end === 'paused' ? hold : null,
        hold_until: end === 'paused' && hold ? ctx.now() + HOLD_MS[hold] : null
      })
    }
  }

  async function executeInTab(
    ctx: BackgroundContext,
    tabId: number,
    item: QueueItem,
    title: string | null,
    index: number,
    total: number
  ): Promise<ExecResult> {
    let closed = false
    let wake: () => void = () => undefined
    const untilClosed = new Promise<null>((r) => (wake = () => r(null)))
    const onRemoved = (id: number) => {
      if (id !== tabId) return
      closed = true
      wake()
    }
    chrome.tabs.onRemoved.addListener(onRemoved)
    try {
      const target = channelPageUrl(item.channel_id)
      const prevUrl = (await chrome.tabs.get(tabId)).url
      await chrome.tabs.update(tabId, { url: target })
      const loaded = await Promise.race([waitTabLoaded(tabId, prevUrl, opts.tabLoadTimeoutMs ?? TAB_LOAD_TIMEOUT_MS), untilClosed])
      if (closed || loaded === null) return { status: 'failed', error: 'tab_closed' }
      if (!loaded) return { status: 'failed', error: 'timeout' }
      const landed = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? ''
      if (isSignin(landed)) return { status: 'failed', error: 'logged_out' }
      if (isChallenge(landed)) return { status: 'failed', error: 'challenge' }
      if (!landed.startsWith(`${YT}/`)) return { status: 'failed', error: 'wrong_channel' }

      // content/unsubscribe checks the channel on the page before any click
      const payload = {
        queue_id: item.id,
        action: item.action,
        channel_url: target,
        channel_id: item.channel_id,
        channel_title: title,
        index,
        total: Math.max(total, index)
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), opts.executeTimeoutMs ?? EXECUTE_TIMEOUT_MS)))
      const deadline = Date.now() + (opts.readyTimeoutMs ?? READY_TIMEOUT_MS)
      try {
        for (;;) {
          const res = await Promise.race([ctx.sendTabCommand(tabId, 'queue.execute', payload), untilClosed, timeout])
          if (closed || res === null) return { status: 'failed', error: 'tab_closed' }
          if (res === 'timeout') return { status: 'failed', error: 'timeout' }
          if (res.ok) return normalizeResult(res.data)
          // only retries when nobody heard (the command did not reach the page): never two executions
          const notReady = /Receiving end does not exist|Could not establish connection/i.test(res.error.message)
          if (!notReady) return { status: 'failed', error: 'page_error' }
          if (Date.now() > deadline) return { status: 'failed', error: 'timeout' }
          await new Promise((r) => setTimeout(r, READY_RETRY_MS))
        }
      } finally {
        clearTimeout(timer)
      }
    } finally {
      chrome.tabs.onRemoved.removeListener(onRemoved)
    }
  }

  return {
    MODULE,
    ROUTES,
    REAL_ROUTES,
    MESSAGES,
    register,
    async idle() {
      while (busy.size) await Promise.allSettled([...busy])
    }
  }
}

export const queue: QueueModule = createQueueModule()
