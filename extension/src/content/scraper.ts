// content/scraper — based on the MyTube scraper (same author, relicensed under MIT here).
//
// On https://www.youtube.com/feed/channels, at the background's request (`scrape.subscriptions`, background tab opened
// by background/sync): scrolls to the end of the list, reads `ytInitialData` (inline scripts) + DOM and returns the whole
// list with the signal:
// - `complete` **only** when it reached the end of the list (no `ytd-continuation-item-renderer` and a stable count),
//   with no error, logged in, non-empty list, every DOM item understood and every channel in the data present in the DOM;
// - `partial` on any doubt (logged out, empty, scroll stalled/cut off, timed out, missing selector,
//   item without name/link, tab closed/module stopped, exception). A false `complete` makes Hermes mark subscriptions
//   as unsubscribed: when in doubt, `partial`.
// The content script lives in the isolated world: the `.data` of YouTube's elements (where the ids of channels that
// arrived by scrolling are) is only visible in the MAIN world — background/sync completes the missing ids with
// `chrome.scripting.executeScript({world: 'MAIN'})` and drops (downgrading to `partial`) whatever it cannot resolve.
// Only reads the page: no clicks, cookies or account actions. Does not scrape on its own when the user opens the page.
//
// Do not rely on scrolling alone. YouTube's continuation loads when the element enters the screen, and Chrome does not
// render a hidden tab. Before concluding `scroll_stalled`, with the list stopped and the continuation present, it tries:
//  1. every round: `scrollIntoView` of the continuation + document at the bottom (the usual way);
//  2. stepped scrolling with a real wait (up one screen and down in `stepMs` steps, with a `scroll` event on each
//     step — for loaders that read the position on the scroll event, which does not arrive on its own in a hidden tab);
//  3. asking the MAIN world to trigger the loading the continuation element itself exposes (DOM event
//     `NUDGE_EVENT`; the listener is installed by background/sync with `installContinuationNudger`, which only calls one
//     method of the element itself and answers in the `NUDGE_ATTR` attribute). No cookie, no token, no crafted request.
// What was tried goes in `stats.attempts`. `complete` still requires proof of the end of the list.
// With `visible` (user-requested sync, tab in view) it shows the content/sync-overlay notice (counter,
// Cancel/Esc → `cancelled`) and does not count as stalled a round in which the tab was hidden (the user left it).
import type { ChannelIn, ExtRouteKey, SyncSignal } from '../../../shared/api-types'
import type { ExtTabCommands } from '../../../shared/ext-messages'
import type { ContentModule } from '../lib/content'
import { showSyncOverlay, type SyncOverlay } from './sync-overlay'

export const MODULE = 'content/scraper'
export const ROUTES = ['POST /ext/sync/subscriptions'] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = ['POST /ext/sync/subscriptions']

const YT = 'https://www.youtube.com'
/** DOM event that asks the MAIN world to trigger the continuation (listener: background/sync `installContinuationNudger`) */
export const NUDGE_EVENT = 'tube:nudge-continuation'
/** attribute on `<html>` with the MAIN world's response: `called:<method>`, `none`, `already`, `no_element`, `error:<method>` */
export const NUDGE_ATTR = 'data-tube-nudge'
const CHANNEL_ID = /^UC[\w-]{22}$/

/** Why the signal ended up as it did (goes along in the command response, for the sync state). */
export type ScrapeReason =
  | 'end_of_list'
  | 'wrong_page'
  | 'logged_out'
  | 'empty'
  | 'scroll_stalled'
  | 'timeout'
  | 'aborted'
  /** the user cancelled in the notice (Cancel/Esc) */
  | 'cancelled'
  | 'selector_missing'
  | 'unparsed_items'
  | 'dom_mismatch'
  | 'error'

export interface ScrapeStats {
  dom_items: number
  data_items: number
  rounds: number
  unparsed: number
  missing_ids: number
  /** ways to unstick tried while the list was stopped: `stepped_scroll`, `page_nudge:<response>` */
  attempts: string[]
  /** rounds with the visible tab hidden by the user (they do not count as stalled) */
  hidden_rounds: number
}

export interface ScrapeResult {
  channels: ChannelIn[]
  signal: SyncSignal
  reason: ScrapeReason
  stats: ScrapeStats
}

export interface ScrapeOptions {
  doc?: Document
  url?: URL
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** one scroll step (default: scrolls to the end and brings the continuation into view) */
  scroll?: () => void
  /** wait between scrolls (ms) */
  roundMs?: number
  /** consecutive rounds without a continuation and without a new item to call it the end */
  stableRounds?: number
  /** consecutive rounds with a continuation and without a new item to give up (network dropped, tab not rendering) */
  maxStallRounds?: number
  /** maximum time for the whole scroll (ms) */
  maxMs?: number
  /** wait for the first items (ms) */
  waitItemsMs?: number
  /** `abort('cancelled')` = the user cancelled; another reason = module stopped */
  abort?: AbortSignal
  /** stepped scroll with a real wait (default: up one screen and down in `steps` steps with a `scroll` event) */
  steppedScroll?: () => Promise<void>
  /** wait between the steps of the stepped scroll (ms) */
  stepMs?: number
  /** asks the MAIN world to load the continuation; returns the response (`unavailable` with no listener) */
  nudge?: () => Promise<string>
  /** count of items on the page each round (notice counter) */
  onProgress?: (count: number) => void
  /** visible sync: a round with the tab hidden does not count as stalled (the time cap still applies) */
  visible?: boolean
}

// ------------------------------------------------------------------ selectors (same as the previous scraper + the new layout)

const ITEM = 'ytd-channel-renderer, ytd-grid-channel-renderer, yt-lockup-view-model'
// ids by attribute (`[id="…"]`): YouTube repeats ids in every item and some selector engines (jsdom) resolve
// `#a #b` against the whole document instead of the item
const ITEM_NAME = [
  '[id="channel-info"] [id="text"]',
  '[id="channel-title"] [id="text"]',
  '[id="info"] [id="text"]',
  '.yt-lockup-metadata-view-model-wiz__title',
  '.yt-lockup-metadata-view-model__title',
  // live page (Nov 2026): YouTube renders the view-model classes in camelCase
  '.ytLockupMetadataViewModelTitle'
].join(', ')
const ITEM_LINK = [
  'a[id="main-link"]',
  'a[id="channel-info"]',
  '[id="channel-info"] a',
  'a.yt-lockup-metadata-view-model-wiz__title',
  'a.yt-lockup-metadata-view-model__title',
  'a.ytLockupMetadataViewModelTitle',
  'a[href*="/@"]',
  'a[href*="/channel/"]'
].join(', ')
const ITEM_AVATAR =
  '[id="avatar"] img, [id="img"] img, img[id="img"], .yt-lockup-view-model-wiz__content-image img, .yt-lockup-view-model__content-image img, .ytLockupViewModelContentImage img, img'
const CONTINUATION = 'ytd-continuation-item-renderer'
const LOGGED_OUT_DOM = 'ytd-background-promo-renderer, a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"]'

// ------------------------------------------------------------------ util

const absUrl = (href: string | null | undefined): string | null => {
  if (!href) return null
  try {
    return new URL(href, YT).href
  } catch {
    return null
  }
}
const absThumb = (src: string | null | undefined): string | null => {
  if (!src) return null
  if (src.startsWith('//')) return `https:${src}`
  return /^https?:\/\//.test(src) ? src : null
}
/** `/@Handle` → `@handle` (lowercase; Hermes normalizes again) */
export function handleOf(url: string | null | undefined): string | null {
  if (!url) return null
  const m = /\/@([^/?#]+)/.exec(url)
  if (!m) return null
  try {
    return `@${decodeURIComponent(m[1]).toLowerCase()}`
  } catch {
    return `@${m[1].toLowerCase()}`
  }
}
/** `/channel/UC…` → `UC…` */
export function channelIdOf(url: string | null | undefined): string | null {
  const m = url ? /\/channel\/(UC[\w-]{22})(?:[/?#]|$)/.exec(url) : null
  return m ? m[1] : null
}
const isChannelId = (v: unknown): v is string => typeof v === 'string' && CHANNEL_ID.test(v)

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null)
const at = (v: unknown, ...path: Array<string | number>): unknown => {
  let cur: unknown = v
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[k]
  }
  return cur
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// ------------------------------------------------------------------ ytInitialData (reads strings)

const DATA_MARKERS = ['var ytInitialData = ', 'window["ytInitialData"] = ', "window['ytInitialData'] = ", 'ytInitialData = ']

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

/** `ytInitialData` from the inline `<script>`s (the content script cannot see the page's global variable). */
export function readInitialData(doc: Document): unknown | null {
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = s.textContent ?? ''
    for (const marker of DATA_MARKERS) {
      const idx = text.indexOf(marker)
      if (idx === -1) continue
      const json = sliceJsonObject(text, idx + marker.length)
      if (!json) continue
      try {
        return JSON.parse(json)
      } catch {
        // try the next marker/script
      }
    }
  }
  return null
}

function lastThumb(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return null
  return absThumb(str(at(list[list.length - 1], 'url')))
}

/** A channel renderer → `ChannelIn`, or null if it is not a channel. */
function fromRenderer(r: Rec, kind: string): ChannelIn | null {
  let id: string | null = null
  let title: string | null = null
  let url: string | null = null
  let thumb: string | null = null
  let handle: string | null = null
  if (kind === 'lockupViewModel') {
    const browse = at(r, 'rendererContext', 'commandContext', 'onTap', 'innertubeCommand', 'browseEndpoint')
    const browseId = str(at(browse, 'browseId'))
    const contentId = str(r.contentId)
    const isChannel = r.contentType === 'LOCKUP_CONTENT_TYPE_CHANNEL' || isChannelId(browseId) || isChannelId(contentId)
    if (!isChannel) return null
    id = isChannelId(browseId) ? browseId : isChannelId(contentId) ? contentId : null
    if (contentId?.startsWith('@')) handle = contentId.toLowerCase()
    title = str(at(r, 'metadata', 'lockupMetadataViewModel', 'title', 'content'))
    url = absUrl(str(at(browse, 'canonicalBaseUrl')))
    thumb =
      absThumb(str(at(r, 'contentImage', 'collectionThumbnailViewModel', 'primaryThumbnail', 'thumbnailViewModel', 'image', 'sources', 0, 'url'))) ??
      absThumb(str(at(r, 'contentImage', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image', 'sources', 0, 'url'))) ??
      absThumb(str(at(r, 'contentImage', 'avatarViewModel', 'image', 'sources', 0, 'url')))
  } else {
    id = isChannelId(r.channelId) ? (r.channelId as string) : null
    title = str(at(r, 'title', 'runs', 0, 'text')) ?? str(at(r, 'title', 'simpleText'))
    thumb = lastThumb(at(r, 'thumbnail', 'thumbnails'))
    url =
      absUrl(str(at(r, 'navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'url'))) ??
      absUrl(str(at(r, 'navigationEndpoint', 'browseEndpoint', 'canonicalBaseUrl')))
    if (!id) {
      const b = str(at(r, 'navigationEndpoint', 'browseEndpoint', 'browseId'))
      if (isChannelId(b)) id = b
    }
  }
  if (!title || (!id && !url)) return null
  if (!url && id) url = `${YT}/channel/${id}`
  handle = handleOf(url) ?? handle
  if (!id) id = channelIdOf(url)
  return { title, channel_id: id, handle, url, thumb }
}

const RENDERERS = ['gridChannelRenderer', 'channelRenderer', 'lockupViewModel'] as const

/** Recursive search (depth ≤ 25) for channel renderers; dedup by id. */
export function extractFromInitialData(data: unknown): ChannelIn[] {
  const out: ChannelIn[] = []
  const seen = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (depth > 25 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const v of node) walk(v, depth + 1)
      return
    }
    const r = node as Rec
    for (const k of RENDERERS) {
      const inner = rec(r[k])
      if (!inner) continue
      const c = fromRenderer(inner, k)
      if (c) {
        const key = c.channel_id ?? c.handle ?? c.url ?? c.title
        if (!seen.has(key)) {
          seen.add(key)
          out.push(c)
        }
        return
      }
    }
    for (const v of Object.values(r)) if (v && typeof v === 'object') walk(v, depth + 1)
  }
  walk(data, 0)
  return out
}

// ------------------------------------------------------------------ login

/** `in` (ytcfg LOGGED_IN true), `out` (LOGGED_IN false or login promo), `unknown` (no clue). */
export function detectLogin(doc: Document): 'in' | 'out' | 'unknown' {
  let flag: boolean | null = null
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = s.textContent ?? ''
    const m = /"LOGGED_IN"\s*:\s*(true|false)/.exec(text)
    if (m) {
      flag = m[1] === 'true'
      break
    }
    if (text.includes('"backgroundPromoRenderer"') && text.includes('ytInitialData')) flag = false
  }
  if (flag === false) return 'out'
  if (doc.querySelector(LOGGED_OUT_DOM)) return 'out'
  return flag === true ? 'in' : 'unknown'
}

// ------------------------------------------------------------------ DOM

/** Root of the visible page (YouTube keeps other pages' `ytd-browse` hidden during SPA navigation). */
function scope(doc: Document): ParentNode {
  return doc.querySelector('ytd-browse:not([hidden])') ?? doc
}

const domItems = (doc: Document): Element[] => Array.from(scope(doc).querySelectorAll(ITEM))
const hasContinuation = (doc: Document): boolean => scope(doc).querySelector(CONTINUATION) !== null

function fromDom(el: Element): ChannelIn | null {
  const title = str(el.querySelector(ITEM_NAME)?.textContent)
  const link = el.querySelector<HTMLAnchorElement>(ITEM_LINK)
  const url = absUrl(link?.getAttribute('href'))
  if (!title || !url || (!handleOf(url) && !channelIdOf(url))) return null
  const img = el.querySelector<HTMLImageElement>(ITEM_AVATAR)
  return { title, channel_id: channelIdOf(url), handle: handleOf(url), url, thumb: absThumb(img?.getAttribute('src')) }
}

// ------------------------------------------------------------------ scraping

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function defaultScroll(doc: Document): () => void {
  return () => {
    const view = doc.defaultView
    try {
      doc.querySelector(CONTINUATION)?.scrollIntoView?.({ block: 'end' })
    } catch {
      // jsdom/element gone
    }
    try {
      view?.scrollTo?.(0, doc.documentElement.scrollHeight)
    } catch {
      // jsdom does not implement scrollTo
    }
  }
}

const STEPS = 4

function defaultSteppedScroll(doc: Document, sleep: (ms: number) => Promise<void>, stepMs: number): () => Promise<void> {
  return async () => {
    const view = doc.defaultView
    const el = doc.scrollingElement ?? doc.documentElement
    const fire = () => {
      try {
        view?.dispatchEvent(new Event('scroll'))
        doc.dispatchEvent(new Event('scroll'))
      } catch {
        // page going away
      }
    }
    const height = view?.innerHeight || 800
    const bottom = () => Math.max(el.scrollHeight - height, 0)
    const start = Math.max(bottom() - height, 0)
    for (let i = 0; i <= STEPS; i++) {
      el.scrollTop = start + ((bottom() - start) * i) / STEPS
      fire()
      await sleep(stepMs)
    }
    try {
      doc.querySelector(CONTINUATION)?.scrollIntoView?.({ block: 'center' })
    } catch {
      // jsdom/element gone
    }
    fire()
  }
}

function defaultNudge(doc: Document): () => Promise<string> {
  return async () => {
    const html = doc.documentElement
    html.removeAttribute(NUDGE_ATTR)
    // the MAIN world listener runs inside the (synchronous) dispatch and answers in the attribute
    doc.dispatchEvent(new CustomEvent(NUDGE_EVENT))
    return html.getAttribute(NUDGE_ATTR) ?? 'unavailable'
  }
}

/** Merges data + DOM: id from the data when the DOM has none (same handle/url); larger avatar. */
function merge(dom: ChannelIn[], data: ChannelIn[]): { channels: ChannelIn[]; missingFromDom: number } {
  const byId = new Map<string, ChannelIn>()
  const byHandle = new Map<string, ChannelIn>()
  const byUrl = new Map<string, ChannelIn>()
  for (const d of data) {
    if (d.channel_id) byId.set(d.channel_id, d)
    if (d.handle) byHandle.set(d.handle, d)
    if (d.url) byUrl.set(d.url.toLowerCase(), d)
  }
  const used = new Set<ChannelIn>()
  const out: ChannelIn[] = []
  const seen = new Set<string>()
  for (const item of dom) {
    const match =
      (item.channel_id && byId.get(item.channel_id)) ||
      (item.handle && byHandle.get(item.handle)) ||
      (item.url && byUrl.get(item.url.toLowerCase())) ||
      null
    if (match) used.add(match)
    const c: ChannelIn = {
      title: item.title,
      channel_id: item.channel_id ?? match?.channel_id ?? null,
      handle: item.handle ?? match?.handle ?? null,
      url: match?.url ?? item.url ?? null,
      thumb: match?.thumb ?? item.thumb ?? null
    }
    const key = c.channel_id ?? c.handle ?? c.url ?? c.title
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  let missingFromDom = 0
  for (const d of data) {
    if (used.has(d)) continue
    missingFromDom++
    const key = d.channel_id ?? d.handle ?? d.url ?? d.title
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return { channels: out, missingFromDom }
}

/** Scrolls /feed/channels to the end and returns the whole list + signal. Never throws. */
export async function scrapeSubscriptions(opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const doc = opts.doc ?? document
  const url = opts.url ?? new URL(doc.defaultView?.location.href ?? location.href)
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? (() => Date.now())
  const scroll = opts.scroll ?? defaultScroll(doc)
  const roundMs = opts.roundMs ?? 1000
  const stableRounds = opts.stableRounds ?? 2
  const maxStallRounds = opts.maxStallRounds ?? 15
  const maxMs = opts.maxMs ?? 300_000
  const waitItemsMs = opts.waitItemsMs ?? 20_000
  const steppedScroll = opts.steppedScroll ?? defaultSteppedScroll(doc, sleep, opts.stepMs ?? 250)
  const nudge = opts.nudge ?? defaultNudge(doc)
  const progress = (n: number) => {
    try {
      opts.onProgress?.(n)
    } catch {
      // the notice is cosmetic
    }
  }
  const stats: ScrapeStats = { dom_items: 0, data_items: 0, rounds: 0, unparsed: 0, missing_ids: 0, attempts: [], hidden_rounds: 0 }
  const attempt = (what: string) => {
    stats.attempts.push(what)
    if (stats.attempts.length > 20) stats.attempts.shift()
  }
  let collected: ChannelIn[] = []

  const finish = (signal: SyncSignal, reason: ScrapeReason): ScrapeResult => {
    stats.missing_ids = collected.filter((c) => !c.channel_id).length
    // `complete` requires a non-empty list (the server also refuses to mark missing channels with an empty batch)
    if (signal === 'complete' && collected.length === 0) return { channels: collected, signal: 'partial', reason: 'empty', stats }
    return { channels: collected, signal, reason, stats }
  }
  const aborted = () => opts.abort?.aborted === true || doc.defaultView?.closed === true
  const abortReason = (): ScrapeReason => (opts.abort?.aborted && opts.abort.reason === 'cancelled' ? 'cancelled' : 'aborted')

  try {
    if (url.pathname !== '/feed/channels') return finish('partial', 'wrong_page')
    const t0 = now()

    // 1. first items (or logged-out signal)
    while (domItems(doc).length === 0 && detectLogin(doc) !== 'out' && now() - t0 < waitItemsMs) {
      if (aborted()) return finish('partial', abortReason())
      await sleep(Math.min(500, roundMs))
    }

    // 2. scroll to the end
    let reason: ScrapeReason | null = null
    if (detectLogin(doc) === 'out') reason = 'logged_out'
    else if (domItems(doc).length > 0) {
      let prev = domItems(doc).length
      let stable = 0
      let stalled = 0
      let triedStepped = false
      let triedNudge = false
      progress(prev)
      for (;;) {
        if (aborted()) {
          reason = abortReason()
          break
        }
        if (now() - t0 > maxMs) {
          reason = 'timeout'
          break
        }
        scroll()
        stats.rounds++
        await sleep(roundMs)
        if (aborted()) {
          reason = abortReason()
          break
        }
        const count = domItems(doc).length
        const more = hasContinuation(doc)
        const grew = count !== prev
        if (grew) {
          stable = 0
          stalled = 0
        } else if (more) {
          // visible tab the user hid: the continuation waits for them to come back (the time cap still applies)
          if (opts.visible && doc.visibilityState === 'hidden') stats.hidden_rounds++
          else stalled++
        } else {
          stable++
        }
        prev = count
        progress(count)
        if (!more && stable >= stableRounds) break
        if (grew || !more || stalled === 0) continue
        // list stopped with a continuation: only gives up after giving each way at least one round to act
        if (stalled >= maxStallRounds && triedStepped && triedNudge) {
          reason = 'scroll_stalled'
          break
        }
        if (!triedStepped || stalled % 5 === 1) {
          await steppedScroll()
          triedStepped = true
          attempt('stepped_scroll')
        } else if (!triedNudge || stalled % 5 === 2) {
          let answer = 'error'
          try {
            answer = await nudge()
          } catch {
            // continues: the next round decides
          }
          triedNudge = true
          attempt(`page_nudge:${answer}`)
        }
      }
    }

    // 3. extraction (always: a `partial` still adds/updates channels in Hermes)
    const data = extractFromInitialData(readInitialData(doc))
    const els = domItems(doc)
    const parsed: ChannelIn[] = []
    for (const el of els) {
      const c = fromDom(el)
      if (c) parsed.push(c)
      else stats.unparsed++
    }
    stats.dom_items = els.length
    stats.data_items = data.length
    const merged = merge(parsed, data)
    collected = merged.channels

    if (reason) return finish('partial', reason)
    if (detectLogin(doc) === 'out') return finish('partial', 'logged_out')
    if (els.length === 0) return finish('partial', data.length > 0 ? 'selector_missing' : 'empty')
    if (stats.unparsed > 0) return finish('partial', 'unparsed_items')
    if (merged.missingFromDom > 0) return finish('partial', 'dom_mismatch')
    return finish('complete', 'end_of_list')
  } catch (e) {
    console.warn('[tube] scraper failed', e)
    return finish('partial', 'error')
  }
}

// ------------------------------------------------------------------ module

let running: { ctrl: AbortController; result: Promise<ScrapeResult> } | null = null

function overlayFor(ctrl: AbortController): SyncOverlay | null {
  try {
    return showSyncOverlay({ onCancel: () => ctrl.abort('cancelled') })
  } catch (e) {
    // without the notice the read goes on (the visible tab is still what unlocks the list)
    console.warn('[tube] sync overlay failed', e)
    return null
  }
}

export const scraper: ContentModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  COMMANDS: ['scrape.subscriptions'],
  matches: (url) => url.pathname === '/feed/channels',
  // only scrapes at the background's request (tab opened by it): does not scroll the page the user opened
  start() {},
  stop() {
    running?.ctrl.abort()
  },
  commands: {
    'scrape.subscriptions': async (req: ExtTabCommands['scrape.subscriptions']['req']) => {
      // repeated request while the scroll is running: same response
      if (running) return running.result
      const ctrl = new AbortController()
      const visible = req?.visible === true
      const overlay = visible ? overlayFor(ctrl) : null
      const result = scrapeSubscriptions({ abort: ctrl.signal, visible, onProgress: (n) => overlay?.update(n) }).finally(() => {
        overlay?.remove()
        running = null
      })
      running = { ctrl, result }
      return result
    }
  }
}
