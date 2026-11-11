// background/history — watch history outbox (ext-protocol.md, `POST /ext/sync/watch`).
//
// - `sync.watch {video_id, watched_at, channel_id?}` (from content/tracker) → validates and merges into
//   `STORAGE_KEYS.watchOutbox` (chrome.storage.local: survives the service worker going to sleep). A repeated
//   `(video_id, watched_at)` is stored once. An event without `channel_id` coming from a tab gets the owner from that
//   tab's player (`probeWatchOwner`, MAIN world, read-only, only if the player is still on that video).
// - Sends in batches of up to 500, in order, when 50 accumulate or on every new `ExtState` (30 s alarm → `ctx.onState`).
//   Removes from the outbox only **after the ok**, and only the events of that batch (what arrived during the send stays). If the SW
//   dies with the request in flight, the next one resends the batch: the server is idempotent by `(video_id, watched_at)`.
// - Network/timeout/401/not-paired failure: stops and keeps everything (retries on the next trigger; no loop).
// - `invalid` (422) is a bug, not queue material: the batch leaves the outbox for `watch_rejected` (diagnostics) and is not resent.
import type { Envelope, ErrorCode, ExtRouteKey, WatchEvent } from '../../../shared/api-types'
import { STORAGE_KEYS } from '../../../shared/ext-messages'
import type { BackgroundModule } from '../lib/background'
import type { ExtClient } from '../lib/client'
import { fail, ok } from '../lib/envelope'

export const MODULE = 'background/history'
export const ROUTES = ['POST /ext/sync/watch'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = ['POST /ext/sync/watch']
export const MESSAGES = ['sync.watch'] as const

/** max per `POST /ext/sync/watch` (contract: `WatchBatchBody.events` 1..500) */
export const WATCH_BATCH_MAX = 500
/** reached this many → send right away (without waiting for the alarm) */
export const WATCH_FLUSH_AT = 50
/** batches rejected with `invalid` (bug): kept for diagnostics, never resent. Local key. */
export const WATCH_REJECTED_KEY = STORAGE_KEYS.watchRejected
const REJECTED_CAP = 20
/** outbox cap (storage protection): past it, drops the oldest */
const OUTBOX_CAP = 20_000

const VIDEO_ID = /^[\w-]{11}$/

export interface RejectedBatch {
  at: number
  events: WatchEvent[]
  error: { code: ErrorCode; message: string }
}

export interface FlushResult {
  sent: number
  batches: number
  /** code that stopped the send (null = outbox empty) */
  stopped: ErrorCode | null
}

export interface Outbox {
  enqueue(ev: WatchEvent): Promise<Envelope<{ queued: number }>>
  flush(): Promise<FlushResult>
  pending(): Promise<WatchEvent[]>
}

const keyOf = (e: WatchEvent) => `${e.video_id}|${e.watched_at}`

function validate(raw: unknown): WatchEvent | string {
  const e = raw as Partial<WatchEvent> | null
  if (!e || typeof e !== 'object') return 'event must be an object'
  if (typeof e.video_id !== 'string' || !VIDEO_ID.test(e.video_id)) return 'video_id must be an 11-character YouTube id'
  if (typeof e.watched_at !== 'number' || !Number.isInteger(e.watched_at) || e.watched_at < 0) return 'watched_at must be integer seconds (UTC)'
  if (e.channel_id != null && typeof e.channel_id !== 'string') return 'channel_id must be text or null'
  return { video_id: e.video_id, watched_at: e.watched_at, channel_id: e.channel_id ?? null }
}

async function read(): Promise<WatchEvent[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.watchOutbox)
  const v = got[STORAGE_KEYS.watchOutbox]
  return Array.isArray(v) ? (v as WatchEvent[]) : []
}
const write = (list: WatchEvent[]) => chrome.storage.local.set({ [STORAGE_KEYS.watchOutbox]: list })

/** read-modify-write of the outbox one at a time (messages and sending compete in the same SW) */
let chain: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

export function createOutbox(opts: { client: ExtClient; now?: () => number }): Outbox {
  const now = opts.now ?? (() => Date.now())
  let flushing: Promise<FlushResult> | null = null

  async function removeSent(batch: WatchEvent[]): Promise<void> {
    const done = new Set(batch.map(keyOf))
    await locked(async () => write((await read()).filter((e) => !done.has(keyOf(e)))))
  }

  async function reject(batch: WatchEvent[], error: RejectedBatch['error']): Promise<void> {
    await removeSent(batch)
    const got = await chrome.storage.local.get(WATCH_REJECTED_KEY)
    const prev = Array.isArray(got[WATCH_REJECTED_KEY]) ? (got[WATCH_REJECTED_KEY] as RejectedBatch[]) : []
    await chrome.storage.local.set({ [WATCH_REJECTED_KEY]: [...prev, { at: now(), events: batch, error }].slice(-REJECTED_CAP) })
  }

  async function runFlush(): Promise<FlushResult> {
    const out: FlushResult = { sent: 0, batches: 0, stopped: null }
    for (;;) {
      const batch = (await read()).slice(0, WATCH_BATCH_MAX)
      if (batch.length === 0) return out
      const res = await opts.client.request('POST /ext/sync/watch', { body: { events: batch } })
      if (res.ok) {
        await removeSent(batch)
        out.sent += batch.length
        out.batches++
        continue
      }
      out.stopped = res.error.code
      if (res.error.code === 'invalid') {
        console.error('[tube] POST /ext/sync/watch rejected the batch (invalid): bug, not resent', res.error)
        await reject(batch, { code: res.error.code, message: res.error.message })
      }
      return out
    }
  }

  return {
    async enqueue(raw) {
      const ev = validate(raw)
      if (typeof ev === 'string') return fail('invalid', ev, { details: { field: 'event' } })
      return locked(async () => {
        const list = await read()
        const k = keyOf(ev)
        if (!list.some((e) => keyOf(e) === k)) {
          list.push(ev)
          await write(list.length > OUTBOX_CAP ? list.slice(-OUTBOX_CAP) : list)
        }
        return ok({ queued: Math.min(list.length, OUTBOX_CAP) })
      })
    },
    flush() {
      if (!flushing) flushing = runFlush().finally(() => (flushing = null))
      return flushing
    },
    pending: read
  }
}

// ------------------------------------------------------------------ owner of the video (MAIN world)

const CHANNEL_ID = /^UC[\w-]{22}$/
/** the probe never holds up the outbox longer than this */
const OWNER_PROBE_MS = 3000

/**
 * Runs **in the tab's MAIN world** (`chrome.scripting.executeScript({func, args, world: 'MAIN'})`): serialized, no outer
 * scope. Owner of `videoId` from the player's own response (`#movie_player.getPlayerResponse()`, then the page's
 * `ytInitialPlayerResponse`), only when that response describes `videoId`. Read-only; null when in doubt.
 */
export function probeWatchOwner(videoId: string): string | null {
  const UC = /^UC[\w-]{22}$/
  const pick = (resp: unknown): string | null => {
    const d = (resp as { videoDetails?: { videoId?: unknown; channelId?: unknown } } | null)?.videoDetails
    if (!d || d.videoId !== videoId) return null
    return typeof d.channelId === 'string' && UC.test(d.channelId) ? d.channelId : null
  }
  const sources: Array<() => unknown> = [
    () => (document.getElementById('movie_player') as unknown as { getPlayerResponse?: () => unknown } | null)?.getPlayerResponse?.(),
    () => (globalThis as unknown as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse
  ]
  for (const source of sources) {
    try {
      const id = pick(source())
      if (id) return id
    } catch {
      // player not ready or another layout: next source
    }
  }
  return null
}

/** Fills a missing `channel_id` from the sender tab's player; never fails the event (null stays null). */
async function withOwner<T>(raw: T, sender: chrome.runtime.MessageSender | null): Promise<T> {
  const e = raw as Partial<WatchEvent> | null
  const tabId = sender?.tab?.id
  if (!e || typeof e !== 'object' || e.channel_id != null || typeof tabId !== 'number') return raw
  if (typeof e.video_id !== 'string' || !VIDEO_ID.test(e.video_id)) return raw
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const probe = chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: probeWatchOwner, args: [e.video_id] })
    const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), OWNER_PROBE_MS)))
    const out = await Promise.race([probe, timeout])
    const id = out?.[0]?.result
    return typeof id === 'string' && CHANNEL_ID.test(id) ? ({ ...e, channel_id: id } as T) : raw
  } catch {
    return raw // tab closed, navigated or not scriptable
  } finally {
    clearTimeout(timer)
  }
}

export const history: BackgroundModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  MESSAGES,
  register(ctx) {
    const box = createOutbox({ client: ctx.client, now: ctx.now })
    ctx.router.onEnvelope('sync.watch', async (p, sender) => {
      const res = await box.enqueue(await withOwner(p, sender))
      if (res.ok && res.data.queued >= WATCH_FLUSH_AT) void box.flush()
      return res
    })
    // 30 s alarm (new state = server is up): sends whatever is in the outbox, without holding up the state cycle
    ctx.onState(() => {
      void box.flush()
    })
  }
}
