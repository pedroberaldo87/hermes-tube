// content/tracker — on /watch, counts a watched video and sends `sync.watch` to the background (which batches it).
// Based on the MyTube tracker (same author, relicensed under MIT here), which counted on page open;
// here the contract rule (ext-protocol.md): watched = > 60 % of the video **or** > 4 min of real playback.
//
// "Real playback" = advance of the main player's `currentTime` (`#movie_player video`) between samples
// (`timeupdate`), accepted only when it fits the wall clock × speed (+ slack): seeks, an idle open tab,
// pauses and background tab time without playing do not count; a video playing in a background tab counts (samples
// arrive spaced out, and so does the clock). Ads (`.ad-showing`/`.ad-interrupting` in the player) do not count and reset the
// baseline. YouTube's SPA navigation swaps the video without reloading: the id comes from the URL on every sample and, if it changed, the
// counters reset. One event per video per page session. Read-only: no account actions.
// Owner (`channel_id`): a `/channel/UC…` owner link, else the inline player response when it describes this video
// (signed-in pages link the owner as `/@handle`); null otherwise — background/history then asks the tab's player.
import type { Envelope, ExtRouteKey, WatchEvent } from '../../../shared/api-types'
import type { ContentModule } from '../lib/content'
import { sendRequest } from '../lib/messaging'

export const MODULE = 'content/tracker'
export const ROUTES = ['POST /ext/sync/watch'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = ['POST /ext/sync/watch']

/** fraction of the video that counts as watched (strictly greater) */
export const WATCH_RATIO = 0.6
/** seconds of playback that count as watched (strictly greater) */
export const WATCH_MIN_S = 240
/** slack on the accepted advance: delta ≤ wall × speed × 1.25 + 1 s */
const SLACK_FACTOR = 1.25
const SLACK_S = 1

const VIDEO_ID = /^[\w-]{11}$/
const CHANNEL_ID = /^UC[\w-]{22}$/

export interface PlaybackSample {
  videoId: string | null
  currentTime: number
  duration: number
  paused: boolean
  /** ad playing in the player */
  ad: boolean
  /** playbackRate */
  rate: number
  /** wall clock (ms) */
  at: number
  channelId?: string | null
}

/** Pure rule: takes player samples, returns the `WatchEvent` when it passes the threshold (once per video). */
export class WatchCounter {
  private videoId: string | null = null
  private watched = 0
  private lastPos: number | null = null
  private lastAt = 0
  private readonly sent = new Set<string>()

  /** seconds of real playback of the current video */
  watchedSeconds(): number {
    return this.watched
  }

  /** resets the baseline (seek, ad, long pause): the next sample only fixes the position */
  resetBase(): void {
    this.lastPos = null
  }

  sample(s: PlaybackSample): WatchEvent | null {
    if (!s.videoId || !VIDEO_ID.test(s.videoId)) {
      this.lastPos = null
      return null
    }
    if (s.videoId !== this.videoId) {
      this.videoId = s.videoId
      this.watched = 0
      this.lastPos = null
    }
    if (s.ad || !Number.isFinite(s.currentTime)) {
      this.lastPos = null
      return null
    }
    if (this.lastPos !== null && !s.paused) {
      const delta = s.currentTime - this.lastPos
      const wall = Math.max(0, (s.at - this.lastAt) / 1000)
      const rate = Number.isFinite(s.rate) && s.rate > 0 ? s.rate : 1
      if (delta > 0 && delta <= wall * rate * SLACK_FACTOR + SLACK_S) this.watched += delta
    }
    this.lastPos = s.currentTime
    this.lastAt = s.at
    if (this.sent.has(s.videoId)) return null
    const byRatio = Number.isFinite(s.duration) && s.duration > 0 && this.watched / s.duration > WATCH_RATIO
    if (!byRatio && !(this.watched > WATCH_MIN_S)) return null
    this.sent.add(s.videoId)
    const ev: WatchEvent = { video_id: s.videoId, watched_at: Math.floor(s.at / 1000) }
    ev.channel_id = s.channelId && CHANNEL_ID.test(s.channelId) ? s.channelId : null
    return ev
  }
}

// ------------------------------------------------------------------ DOM adapter

type Send = (type: 'sync.watch', ev: WatchEvent) => Promise<Envelope<{ queued: number }>>

export interface TrackerOptions {
  doc?: Document
  url?: () => URL
  now?: () => number
  send?: Send
  /** shared counter (one event per video per page session, even with stop/start) */
  counter?: WatchCounter
}

export interface Tracker {
  start(): void
  stop(): void
  counter: WatchCounter
}

const PLAYER = '#movie_player'
/** retry delivering to the background: 2 s, 4 s, … up to 60 s */
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 60_000
const AD_CLASSES = ['ad-showing', 'ad-interrupting']

function videoIdOf(url: URL): string | null {
  if (url.pathname !== '/watch') return null
  const v = url.searchParams.get('v')
  return v && VIDEO_ID.test(v) ? v : null
}

/** Cuts out the JSON object starting at `start`, respecting strings and escapes. */
function sliceJsonObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const DETAILS_MARKER = '"videoDetails":'

/**
 * Owner id from the inline player response (`ytInitialPlayerResponse.videoDetails`) of the page as it was loaded, only
 * when that object describes `videoId`. After a SPA switch the inline script still describes the first video: no id.
 */
export function inlineOwnerOf(doc: Document, videoId: string): string | null {
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = s.textContent ?? ''
    const idx = text.indexOf(DETAILS_MARKER)
    if (idx === -1) continue
    const json = sliceJsonObject(text, idx + DETAILS_MARKER.length)
    if (!json) continue
    try {
      const d = JSON.parse(json) as { videoId?: unknown; channelId?: unknown }
      if (d.videoId !== videoId) return null
      return typeof d.channelId === 'string' && CHANNEL_ID.test(d.channelId) ? d.channelId : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Owner of the video, only if the page already shows the current video (in the SPA the old DOM lingers for a while).
 * The signed-in page links the owner as `/@handle` (no id): then the inline player response, if it is this video's.
 * `cache` keeps the inline answer per video (the inline scripts never change after load; samples arrive ~4×/s).
 */
function channelIdFor(doc: Document, videoId: string, cache: Map<string, string | null>): string | null {
  const flexy = doc.querySelector('ytd-watch-flexy')
  const shown = flexy?.getAttribute('video-id')
  if (shown && shown !== videoId) return null
  const root = flexy ?? doc
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('ytd-video-owner-renderer a[href*="/channel/UC"]'))) {
    const m = /\/channel\/(UC[\w-]{22})/.exec(a.getAttribute('href') ?? '')
    if (m) return m[1]
  }
  if (!cache.has(videoId)) cache.set(videoId, inlineOwnerOf(doc, videoId))
  return cache.get(videoId) ?? null
}

export function createTracker(opts: TrackerOptions = {}): Tracker {
  const doc = opts.doc ?? document
  const urlOf = opts.url ?? (() => new URL(doc.defaultView?.location.href ?? location.href))
  const now = opts.now ?? (() => Date.now())
  const send: Send = opts.send ?? ((type, ev) => sendRequest(type, ev))
  const counter = opts.counter ?? new WatchCounter()
  const pending: WatchEvent[] = []
  const owners = new Map<string, string | null>()
  let delivering = false
  let on = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let backoff = RETRY_MIN_MS

  /** delivers to the background; failed → retries on the next sample **or** by timer (the video may have ended) */
  async function deliver(): Promise<void> {
    if (delivering || pending.length === 0) return
    delivering = true
    let failed = false
    try {
      while (pending.length > 0) {
        const res = await send('sync.watch', pending[0])
        if (!res.ok) {
          // a malformed event does not improve with a retry; the rest (SW waking up, no response) retries
          if (res.error.code === 'invalid') pending.shift()
          else failed = true
          break
        }
        pending.shift()
      }
    } catch {
      failed = true // never takes down the player
    } finally {
      delivering = false
    }
    if (failed && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        void deliver()
      }, backoff)
      backoff = Math.min(backoff * 2, RETRY_MAX_MS)
    } else if (!failed) {
      backoff = RETRY_MIN_MS
    }
  }

  const onSample = (e: Event): void => {
    const video = e.target
    if (!(video instanceof HTMLMediaElement)) return
    const player = video.closest(PLAYER)
    if (!player) return // previews and miniplayers outside the main player
    const videoId = videoIdOf(urlOf())
    const ad = AD_CLASSES.some((c) => player.classList.contains(c))
    const ev = counter.sample({
      videoId,
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      ad,
      rate: video.playbackRate,
      at: now(),
      channelId: videoId ? channelIdFor(doc, videoId, owners) : null
    })
    if (ev) pending.push(ev)
    void deliver()
  }
  const onJump = (e: Event): void => {
    if (e.target instanceof HTMLMediaElement && e.target.closest(PLAYER)) counter.resetBase()
  }

  return {
    counter,
    start() {
      if (on) return
      on = true
      // `timeupdate` does not bubble: capturing on the document catches the <video> even if YouTube swaps the element
      doc.addEventListener('timeupdate', onSample, true)
      doc.addEventListener('seeking', onJump, true)
      doc.addEventListener('emptied', onJump, true)
    },
    stop() {
      if (!on) return
      on = false
      doc.removeEventListener('timeupdate', onSample, true)
      doc.removeEventListener('seeking', onJump, true)
      doc.removeEventListener('emptied', onJump, true)
      counter.resetBase()
    }
  }
}

// ------------------------------------------------------------------ module

/** one per page: the runtime calls stop/start on every navigation; videos already sent are remembered */
const sessionCounter = new WatchCounter()
let active: Tracker | null = null

export const tracker: ContentModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  COMMANDS: [],
  matches: (url) => url.pathname === '/watch',
  start(ctx) {
    active?.stop()
    active = createTracker({ counter: sessionCounter, send: (type, ev) => ctx.send(type, ev) })
    active.start()
  },
  stop() {
    active?.stop()
    active = null
  }
}
