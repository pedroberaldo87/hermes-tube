// Live probe: the built extension against the real https://www.youtube.com, signed out.
//
// One long test, one step per question (load · pairing · channel pages · watch page · sync · unsubscribe queue ·
// themes). Each step records what it saw in `<LIVE_OUT>/report.json` and keeps going when something fails
// (soft assertions), so one run answers every question. Evidence (screenshots, minimal DOM cuts, console) goes to
// `<LIVE_OUT>/` — never into the repository.
//
// Limits built in:
// - Chrome for Testing with a brand-new profile in a temporary folder (deleted at the end); headless; no sign-in.
// - Network: only YouTube's public hosts (`*.youtube.com`, `*.ytimg.com`, `*.ggpht.com`, `*.googlevideo.com`) and the
//   disposable server on 127.0.0.1. Every other host is aborted (listed in the report). The other ports of the
//   extension range are aborted too: a real plugin running on this machine is never contacted.
// - At most `MAX_LOADS` YouTube page loads, with a pause of `PACE_MS` before each load the probe makes.
// - The probe clicks on YouTube only ordinary links to other videos (internal navigation) and, signed out, the
//   Appearance menu (dark theme: a local preference); it never clicks "Subscribe". The extension's own clicks are what
//   is being observed (a MAIN-world listener logs every click).
// - The server is the real plugin code on a throwaway database (`server.py`), driven over stdin/stdout.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type BrowserContext, type Page, type Request, type Route, type Worker } from '@playwright/test'
import { build } from 'esbuild'
import { STORAGE_KEYS } from '../../../shared/ext-messages.ts'
import { ROOT, chromeExecutable } from '../harness/paths.ts'
import { extensionIdOf, extensionServiceWorker, type SwScope } from '../harness/service-worker.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.LIVE_OUT || join(process.env.TMPDIR || tmpdir(), 'tube-live')
const DIST = process.env.EXT_DIST_DIR || join(OUT, 'dist')
const PYTHON = process.env.TUBE_PY || 'python'
/** page-load budget of this run (`LIVE_MAX_LOADS` lowers it when earlier runs already used part of the 40) */
const MAX_LOADS = Math.min(40, Number(process.env.LIVE_MAX_LOADS) || 40)
const PACE_MS = 4000
const YT = 'https://www.youtube.com'

/** Big public channels, by id and by handle. */
const CHANNELS = [
  { name: 'Fireship', id: 'UCsBjURrPoezykLs9EqgamOA', handle: '@Fireship' },
  { name: 'MrBeast', id: 'UCX6OQ3DkcsbYNE6H8uQQuVA', handle: '@MrBeast' },
  { name: 'Kurzgesagt', id: 'UCsXVk37bltHxD1rDPwtNM8Q', handle: '@kurzgesagt' }
] as const
/** steps to run (`LIVE_STEPS=4,7`; default all). Steps 5 and 6 need step 2 (pairing). */
const STEPS = new Set((process.env.LIVE_STEPS || '1,2,3,4,5,6,7').split(',').map((x) => x.trim()))
const want = (step: string) => STEPS.has(step)
/** how many of CHANNELS to visit (`LIVE_CHANNELS`, default all) */
const CHANNEL_COUNT = Math.max(1, Math.min(CHANNELS.length, Number(process.env.LIVE_CHANNELS) || CHANNELS.length))
/** Short public video (19 s). */
const VIDEO_A = 'jNQXAC9IVRw'

const ALLOWED_HOST = /(^|\.)(youtube\.com|ytimg\.com|ggpht\.com|googlevideo\.com)$/

// ------------------------------------------------------------------ report

type Verdict = 'proved' | 'failed' | 'impossible_signed_out' | 'partial' | 'not_run'
const report: Record<string, unknown> & { items: Record<string, { verdict: Verdict; notes: string[]; data: Record<string, unknown> }> } = {
  started_at: new Date().toISOString(),
  items: {}
}
function item(key: string) {
  report.items[key] ??= { verdict: 'not_run', notes: [], data: {} }
  return report.items[key]
}
function saveReport(): void {
  report.loads = loads
  report.load_log = loadLog
  report.blocked_hosts = [...blockedHosts].sort()
  report.blocked_navigations = blockedLog.filter((b) => b.navigation)
  report.blocked_loopback = [...blockedLoopback].sort()
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ disposable server

class LiveServer {
  private readonly waiting: Array<(line: string) => void> = []
  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    readonly dir: string
  ) {
    createInterface({ input: proc.stdout }).on('line', (line) => this.waiting.shift()?.(line))
    proc.stderr.on('data', (b: Buffer) => appendFileSync(join(OUT, 'server.log'), b))
  }

  static start(): LiveServer {
    const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tube-live-server-'))
    const proc = spawn(PYTHON, [join(HERE, 'server.py')], {
      cwd: ROOT,
      env: { ...process.env, TUBE_DB_PATH: join(dir, 'tube.db'), TMPDIR: process.env.TMPDIR || tmpdir() },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return new LiveServer(proc, dir)
  }

  call<T = unknown>(cmd: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server: no answer to ${String(cmd.cmd)}`)), 30_000)
      this.waiting.push((line) => {
        clearTimeout(timer)
        const msg = JSON.parse(line) as { ok: boolean; data?: T; error?: string }
        if (msg.ok) resolve(msg.data as T)
        else reject(new Error(`server: ${msg.error}`))
      })
      this.proc.stdin.write(`${JSON.stringify(cmd)}\n`)
    })
  }

  async stop(): Promise<void> {
    await this.call({ cmd: 'stop' }).catch(() => undefined)
    this.proc.kill()
    rmSync(this.dir, { recursive: true, force: true })
  }
}

interface ServerCall {
  at: number
  handler: string
  ok: boolean
  error: string | null
  summary?: unknown
  round?: number
  remaining?: number | null
  paired?: boolean
  id?: string
}

// ------------------------------------------------------------------ network policy, page budget, console

let loads = 0
const loadLog: string[] = []
let lastLoadAt = 0
const blockedHosts = new Set<string>()
/** blocked requests with time and path (no query string) */
const blockedLog: Array<{ at: number; host: string; path: string; navigation: boolean }> = []
const blockedLoopback = new Set<string>()
const loopbackLog: Array<{ at: number; method: string; path: string; hasCode?: boolean }> = []
const consoleLog: Array<{ at: number; source: string; type: string; text: string; url: string }> = []
let serverPort = 0
let pairingCodes: string[] = []

function isMainFrameNavigation(req: Request): boolean {
  try {
    if (req.serviceWorker()) return false
    return req.isNavigationRequest() && req.frame().parentFrame() === null
  } catch {
    return false
  }
}

async function onRoute(route: Route): Promise<void> {
  const req = route.request()
  const url = new URL(req.url())
  // the extension's own files, data: and blob: are not network
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue()
  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
    if (Number(url.port) === serverPort) {
      const body = req.postData() ?? ''
      loopbackLog.push({ at: Date.now(), method: req.method(), path: url.pathname + url.search, hasCode: pairingCodes.some((c) => body.includes(c)) })
      return route.continue()
    }
    blockedLoopback.add(`${url.host}${url.pathname}`)
    return route.abort('blockedbyclient')
  }
  if (url.protocol === 'https:' && ALLOWED_HOST.test(url.hostname)) {
    if (url.hostname === 'www.youtube.com' && isMainFrameNavigation(req)) {
      if (loads >= MAX_LOADS) {
        blockedHosts.add(`(budget) ${url.pathname}`)
        return route.abort('blockedbyclient')
      }
      loads++
      loadLog.push(`${new Date().toISOString()} ${url.pathname}${url.search}`)
      lastLoadAt = Date.now()
    }
    return route.continue()
  }
  blockedHosts.add(url.hostname)
  blockedLog.push({ at: Date.now(), host: url.hostname, path: url.pathname.slice(0, 80), navigation: isMainFrameNavigation(req) })
  return route.abort('blockedbyclient')
}

/** Pause before a load the probe makes (the extension's own tabs count in the budget too). */
async function pace(): Promise<void> {
  const wait = lastLoadAt + PACE_MS - Date.now()
  if (wait > 0) await sleep(wait)
  if (loads >= MAX_LOADS) throw new Error(`page budget (${MAX_LOADS}) used up`)
}

async function load(page: Page, path: string): Promise<void> {
  await pace()
  await page.goto(`${YT}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
}

function watchConsole(context: BrowserContext): void {
  const add = (source: string, type: string, text: string, url: string) =>
    consoleLog.push({ at: Date.now(), source, type, text: text.slice(0, 500), url: url.slice(0, 200) })
  context.on('console', (msg) => add('page', msg.type(), msg.text(), msg.location().url || msg.page()?.url() || ''))
  context.on('weberror', (err) => add('pageerror', 'error', String(err.error()), err.page()?.url() ?? ''))
}

function watchWorkerConsole(sw: Worker): void {
  sw.on('console', (msg) => consoleLog.push({ at: Date.now(), source: 'service_worker', type: msg.type(), text: msg.text().slice(0, 500), url: sw.url() }))
}

/** Console entries that come from the extension (its files or its `[tube]` prefix). */
function extensionConsole(since = 0) {
  return consoleLog.filter((c) => c.at >= since && (c.source === 'service_worker' || c.url.startsWith('chrome-extension://') || c.text.includes('[tube]')))
}

/**
 * MAIN world, every youtube.com top frame: logs the extension's notices appearing/disappearing and **every click
 * event** (trusted or not) to the console, so the probe sees them even if the tab closes right after.
 */
const INIT_SCRIPT = String.raw`(() => {
  if (location.hostname !== 'www.youtube.com' || window.top !== window) return
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1 && /^TUBE-(SYNC|QUEUE)-OVERLAY$/.test(n.tagName)) console.info('[live-probe] overlay+ ' + n.tagName.toLowerCase() + ' ' + Date.now())
      for (const n of m.removedNodes) if (n.nodeType === 1 && /^TUBE-(SYNC|QUEUE)-OVERLAY$/.test(n.tagName)) console.info('[live-probe] overlay- ' + n.tagName.toLowerCase() + ' ' + Date.now())
    }
  }).observe(document, { childList: true, subtree: true })
  document.addEventListener('click', (e) => {
    const el = e.target
    const d = el && el.nodeType === 1 ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' ' + String(el.className || '').slice(0, 80) : String(el)
    console.info('[live-probe] click ' + JSON.stringify({ target: d, trusted: e.isTrusted, text: ((el && el.textContent) || '').trim().slice(0, 40), url: location.pathname }))
  }, true)
})()`

// ------------------------------------------------------------------ the extension's own page readers, in the page

/**
 * The extension's real functions (content/unsubscribe, content/scraper, content/sync-overlay), bundled and run in the
 * page's MAIN world (same DOM the content script sees). Exposes `__tubeLive.*` readers for the report.
 */
const PAGE_ENTRY = String.raw`
import { readPageChannelIds, detectLogin, detectChallenge, findSubscribeButton, subscriptionState, pageChannelNames } from './unsubscribe'
import { readInitialData } from './scraper'
import { showSyncOverlay } from './sync-overlay'

const HEADER_ROOTS = ['#page-header', 'yt-page-header-renderer', 'ytd-c4-tabbed-header-renderer', '#channel-header-container']
const SUB_CONTAINERS = ['ytd-subscribe-button-renderer', 'yt-subscribe-button-view-model']
const DIALOGS = 'tp-yt-paper-dialog, yt-confirm-dialog-renderer, yt-dialog-view-model, [role="dialog"], dialog'
const MENUS = 'tp-yt-iron-dropdown, ytd-menu-popup-renderer, yt-sheet-view-model, yt-contextual-sheet-layout, [role="menu"], [role="listbox"]'
/** mirrors of content/scraper.ts ITEM_NAME / ITEM_LINK (lockup entries), to test them on a real lockup */
const SCRAPER_NAME = ['.yt-lockup-metadata-view-model-wiz__title', '.yt-lockup-metadata-view-model__title']
const SCRAPER_LINK = ['a.yt-lockup-metadata-view-model-wiz__title', 'a.yt-lockup-metadata-view-model__title']

const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const describe = (el) => el ? {
  tag: el.tagName.toLowerCase(),
  id: el.id || null,
  classes: [...el.classList],
  attrs: Object.fromEntries([...el.attributes].filter((a) => a.name !== 'class' && a.name !== 'style').map((a) => [a.name, a.value.slice(0, 160)])),
  text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
  shown: shown(el)
} : null
const chain = (el, stop) => {
  const out = []
  for (let c = el; c && out.length < 10; c = c.parentElement) {
    out.push(describe(c))
    if (stop && c.matches(stop)) break
  }
  return out
}
/** minimal DOM cut: no scripts, no styles, no images, no svg paths */
const cut = (el, max = 8000) => {
  if (!el) return null
  const c = el.cloneNode(true)
  for (const n of c.querySelectorAll('script, style, img, source, iframe, video')) n.remove()
  for (const n of c.querySelectorAll('path, svg *')) n.removeAttribute('d')
  for (const n of [c, ...c.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) if (/^on|^style$|^src|^srcset$/.test(a.name)) n.removeAttribute(a.name)
  }
  return c.outerHTML.replace(/\s+/g, ' ').slice(0, max)
}
const dig = (o, ...path) => path.reduce((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), o)
const loggedInFlag = () => {
  for (const s of document.querySelectorAll('script:not([src])')) {
    const m = /"LOGGED_IN"\s*:\s*(true|false)/.exec(s.textContent || '')
    if (m) return m[1] === 'true'
  }
  return null
}
const parse = (c) => {
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return null
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
  return [p[0], p[1], p[2], p[3] ?? 1]
}
const lum = (c) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const blend = (fg, bg, a) => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100 }

globalThis.__tubeLive = {
  channel() {
    const btn = findSubscribeButton(document)
    const box = btn && btn.closest(SUB_CONTAINERS.join(', '))
    const data = readInitialData(document)
    const header = HEADER_ROOTS.map((s) => [...document.querySelectorAll(s)]).flat()
    return {
      url: location.href,
      title: document.title,
      ids: readPageChannelIds(document),
      sources: {
        canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
        og_url: [...document.querySelectorAll('meta[property="og:url"]')].map((m) => m.getAttribute('content')),
        itemprop_identifier: [...document.querySelectorAll('meta[itemprop="identifier"]')].map((m) => m.getAttribute('content')),
        itemprop_channelId: [...document.querySelectorAll('meta[itemprop="channelId"]')].map((m) => m.getAttribute('content')),
        initial_data_found: !!data,
        externalId: dig(data, 'metadata', 'channelMetadataRenderer', 'externalId') ?? null,
        urlCanonical: dig(data, 'microformat', 'microformatDataRenderer', 'urlCanonical') ?? null
      },
      login: detectLogin(document),
      logged_in_flag: loggedInFlag(),
      challenge: detectChallenge(document, location.href),
      header_roots: HEADER_ROOTS.map((s) => ({ sel: s, count: document.querySelectorAll(s).length, shown: [...document.querySelectorAll(s)].filter(shown).length })),
      sub_containers: SUB_CONTAINERS.map((s) => ({
        sel: s,
        count: document.querySelectorAll(s).length,
        in_header: [...document.querySelectorAll(s)].filter((b) => header.some((h) => h.contains(b))).length
      })),
      subscribed_attr_anywhere: document.querySelectorAll('[subscribed]').length,
      button: describe(btn),
      button_chain: btn ? chain(btn, SUB_CONTAINERS.join(', ')) : null,
      state: btn ? subscriptionState(btn) : null,
      names: pageChannelNames(document),
      dialogs_shown: [...document.querySelectorAll(DIALOGS)].filter(shown).map(describe),
      menus_shown: [...document.querySelectorAll(MENUS)].filter(shown).map((m) => m.tagName.toLowerCase()),
      box_html: cut(box),
      dark: document.documentElement.hasAttribute('dark'),
      inventory: this.inventory()
    }
  },
  /** what the real page has instead, when the code's selectors find nothing */
  inventory() {
    const root = document.querySelector('ytd-browse:not([hidden])') || document
    const tags = {}
    for (const el of root.querySelectorAll('*')) {
      const t = el.tagName.toLowerCase()
      if (t.includes('-') && /header|subscribe|button|action|channel|page|flexible|join/.test(t)) tags[t] = (tags[t] || 0) + 1
    }
    const subs = [...document.querySelectorAll('button, [role="button"], a')].filter((b) => /^(subscribe|subscribed)$/i.test((b.textContent || '').trim()) || /^subscribe/i.test(b.getAttribute('aria-label') || ''))
    return {
      browse_subtype: root.getAttribute && root.getAttribute('page-subtype'),
      state_by_code_of_header_subscribe: subs[0] && subs[0].tagName === 'BUTTON' ? subscriptionState(subs[0]) : null,
      tags,
      subscribe_like: subs.slice(0, 4).map((b) => ({ el: describe(b), chain: chain(b, 'ytd-browse, ytd-app') })),
      header_html: cut(subs[0] ? subs[0].closest('yt-page-header-view-model, yt-page-header-renderer, #page-header, ytd-tabbed-page-header, header') || subs[0].parentElement : null, 6000)
    }
  },
  watch() {
    const v = document.querySelector('#movie_player video')
    const player = document.querySelector('#movie_player')
    const flexy = document.querySelector('ytd-watch-flexy')
    return {
      url: location.href,
      flexy_video_id: flexy && flexy.getAttribute('video-id'),
      owner_links: [...document.querySelectorAll('ytd-video-owner-renderer a')].map((a) => a.getAttribute('href')).filter(Boolean).slice(0, 4),
      owner_uc_by_tracker_selector: [...document.querySelectorAll('ytd-video-owner-renderer a[href*="/channel/UC"]')].length,
      channel_id_sources: {
        meta_itemprop_channelId: [...document.querySelectorAll('meta[itemprop="channelId"]')].map((m) => m.getAttribute('content')),
        meta_itemprop_identifier: [...document.querySelectorAll('meta[itemprop="identifier"]')].map((m) => m.getAttribute('content')),
        itemprop_author_url: [...document.querySelectorAll('[itemprop="author"] link[itemprop="url"]')].map((m) => m.getAttribute('href')),
        any_channel_uc_links_in_flexy: [...document.querySelectorAll('ytd-watch-flexy a[href*="/channel/UC"]')].map((a) => a.getAttribute('href')).slice(0, 3),
        microformat_tags: [...document.querySelectorAll('ytd-player-microformat-renderer, #microformat')].map((m) => m.tagName.toLowerCase())
      },
      lockup: (() => {
        const l = document.querySelector('#secondary yt-lockup-view-model, #related yt-lockup-view-model')
        if (!l) return null
        const cls = new Set()
        for (const el of l.querySelectorAll('[class]')) for (const c of el.classList) if (/itle|etadata|ontentImage|content-image/.test(c)) cls.add(c)
        return {
          classes: [...cls].slice(0, 20),
          // the subscriptions reader's selectors (content/scraper.ts ITEM_NAME / ITEM_LINK, lockup entries), inside one real lockup
          scraper_name_selectors: SCRAPER_NAME.map((sel) => [sel, l.querySelectorAll(sel).length]),
          scraper_link_selectors: SCRAPER_LINK.map((sel) => [sel, l.querySelectorAll(sel).length])
        }
      })(),
      player_classes: player ? [...player.classList].filter((c) => /ad-|playing|paused|ended|unstarted|buffering/.test(c)) : null,
      video: v ? { t: Math.round(v.currentTime * 10) / 10, d: Math.round(v.duration * 10) / 10, paused: v.paused, muted: v.muted, ready: v.readyState } : null,
      error: (document.querySelector('.ytp-error') || {}).textContent || null
    }
  },
  showSyncOverlay(n) {
    const o = showSyncOverlay({ onCancel() {} })
    o.update(n)
    globalThis.__tubeLiveOverlay = o
    return true
  },
  removeSyncOverlay() {
    if (globalThis.__tubeLiveOverlay) globalThis.__tubeLiveOverlay.remove()
  },
  overlayContrast(tag) {
    const host = document.querySelector(tag)
    const root = host && host.shadowRoot
    const card = root && root.querySelector('.card')
    if (!card) return null
    const bg = parse(getComputedStyle(card).backgroundColor)
    const pageBg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1]
    const out = { card_bg: getComputedStyle(card).backgroundColor, page_bg: getComputedStyle(document.body).backgroundColor, texts: [] }
    for (const el of root.querySelectorAll('.title, .count, .progress, .note, button')) {
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)
      const own = parse(cs.backgroundColor)
      const base = own && own[3] > 0 ? own : bg
      const op = Number(cs.opacity)
      out.texts.push({ cls: el.className || el.tagName.toLowerCase(), text: el.textContent.slice(0, 60), ratio: ratio(blend(fg, base, op), base) })
    }
    const r = card.getBoundingClientRect()
    out.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth }
    out.card_vs_page = bg ? ratio(bg, pageBg) : null
    return out
  }
}
`

let pageBundle = ''
async function bundlePageReaders(): Promise<string> {
  const out = await build({
    stdin: { contents: PAGE_ENTRY, resolveDir: join(ROOT, 'extension', 'src', 'content'), loader: 'ts', sourcefile: 'live-page-readers.ts' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    loader: { '.json': 'json' },
    logLevel: 'silent'
  })
  return out.outputFiles[0].text
}

async function readers(page: Page): Promise<void> {
  if (await page.evaluate('typeof globalThis.__tubeLive === "object"')) return
  await page.evaluate(pageBundle)
}

// ------------------------------------------------------------------ extension state helpers

const storage = (sw: Worker, keys: string | string[] | null = null) =>
  sw.evaluate((k) => (globalThis as unknown as SwScope).chrome.storage.local.get(k), keys) as Promise<Record<string, unknown>>

const badge = (sw: Worker) =>
  sw.evaluate('chrome.action.getBadgeText({})') as Promise<string>

/** active tab of the last focused window: `{id, url}` */
const activeTab = (sw: Worker) =>
  sw.evaluate('chrome.tabs.query({active: true, lastFocusedWindow: true}).then((t) => t.map((x) => ({ id: x.id, url: x.url })))') as Promise<
    Array<{ id: number; url: string }>
  >

const tabsList = (sw: Worker) =>
  sw.evaluate('chrome.tabs.query({}).then((t) => t.map((x) => ({ id: x.id, url: x.url, active: x.active })))') as Promise<
    Array<{ id: number; url: string; active: boolean }>
  >

async function shot(page: Page, name: string, fullPage = false): Promise<string> {
  const path = join(OUT, 'shots', `${name}.png`)
  await page.screenshot({ path, fullPage }).catch(() => undefined)
  return path
}

function saveDom(name: string, html: string | null | undefined): string | null {
  if (!html) return null
  const path = join(OUT, 'dom', `${name}.html`)
  writeFileSync(path, `${html}\n`)
  return path
}

/**
 * Polls a page expression through CDP (`page.evaluate`) until it is truthy. Not `page.waitForFunction`: YouTube enforces
 * Trusted Types, which blocks the string predicates Playwright compiles in the page ("requires 'TrustedScript' assignment").
 */
async function until(page: Page, expression: string, timeout: number): Promise<boolean> {
  const end = Date.now() + timeout
  for (;;) {
    if (await page.evaluate(expression).catch(() => false)) return true
    if (Date.now() >= end) return false
    await sleep(250)
  }
}

async function waitExt(page: Page, timeout = 20_000): Promise<string | null> {
  await until(page, 'document.documentElement.getAttribute("data-tube-ext") === "ready"', timeout)
  return page.evaluate('document.documentElement.getAttribute("data-tube-ext-modules")') as Promise<string | null>
}

// ------------------------------------------------------------------ the probe

test('live: the extension on the real youtube.com, signed out', async () => {
  test.setTimeout(40 * 60_000)
  for (const d of ['shots', 'dom']) mkdirSync(join(OUT, d), { recursive: true })
  if (!existsSync(join(DIST, 'manifest.json'))) throw new Error(`build the extension first: EXT_DIST_DIR=${DIST} npm run build:ext`)
  pageBundle = await bundlePageReaders()

  const server = LiveServer.start()
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tube-live-profile-'))
  let context: BrowserContext | null = null
  try {
    serverPort = (await server.call<{ port: number }>({ cmd: 'start' })).port
    report.server_port = serverPort
    expect(serverPort, 'disposable server port').toBeGreaterThan(0)

    const executablePath = chromeExecutable()
    context = await chromium.launchPersistentContext(profile, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required'
      ],
      locale: 'en-US',
      viewport: { width: 1280, height: 800 },
      colorScheme: 'light'
    })
    report.browser = { version: context.browser()?.version() ?? null, executable: executablePath ?? 'channel:chromium', headless: true }
    // no locator read may hang the run (an absent element waits at most this long)
    context.setDefaultTimeout(20_000)
    await context.route('**/*', onRoute)
    await context.addInitScript(INIT_SCRIPT)
    watchConsole(context)
    const ctx = context

    // ================================================================ 1. load
    const sw = await extensionServiceWorker(ctx)
    watchWorkerConsole(sw)
    const extensionId = extensionIdOf(sw)
    report.extension_id = extensionId
    // a freshly loaded extension registers its content scripts asynchronously: the very first navigation right after
    // launch may get none (seen once here); a real install is never followed by a load within milliseconds
    await sleep(3000)
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await test.step('1. load: service worker, content scripts, console', async () => {
      if (!want('1')) return
      const it = item('1_load')
      const t0 = Date.now()
      it.data.service_worker = sw.url()
      it.data.manifest = await sw.evaluate(() => (globalThis as unknown as SwScope).chrome.runtime.getManifest().version)
      // the extension's isolated world and any exception in the page, through CDP
      const cdp = await ctx.newCDPSession(page)
      const worlds: Array<{ id: number; name: string; origin: string }> = []
      const exceptions: string[] = []
      cdp.on('Runtime.executionContextCreated', (e: { context: { id: number; name: string; origin: string; auxData?: { type?: string } } }) => {
        if (e.context.auxData?.type === 'isolated' && e.context.origin.startsWith('chrome-extension://')) worlds.push({ id: e.context.id, name: e.context.name, origin: e.context.origin })
      })
      cdp.on('Runtime.exceptionThrown', (e: { exceptionDetails: { text: string; url?: string; exception?: { description?: string } } }) => {
        const d = e.exceptionDetails
        if ((d.url ?? '').startsWith('chrome-extension://')) exceptions.push(`${d.text} ${d.exception?.description?.slice(0, 300) ?? ''}`)
      })
      await cdp.send('Runtime.enable')
      // a freshly loaded extension registers its content scripts asynchronously: give it a moment before the 1st page
      await sleep(3000)
      await load(page, '/')
      it.data.landed = page.url()
      const modules = await waitExt(page)
      it.data.data_tube_ext = await page.evaluate('document.documentElement.getAttribute("data-tube-ext")')
      it.data.modules = modules
      await sleep(6000)
      it.data.extension_worlds = worlds
      it.data.extension_exceptions = exceptions
      for (const w of worlds.slice(-1)) {
        const r = (await cdp.send('Runtime.evaluate', {
          contextId: w.id,
          expression: 'JSON.stringify({ attr: document.documentElement.getAttribute("data-tube-ext"), modules: document.documentElement.getAttribute("data-tube-ext-modules") })',
          returnByValue: true
        })) as { result?: { value?: string } }
        it.data.isolated_world_view = r.result?.value ?? null
      }
      it.data.data_tube_ext_late = await page.evaluate('document.documentElement.getAttribute("data-tube-ext")')
      await cdp.detach().catch(() => undefined)
      it.data.screenshot = await shot(page, '1-home.light')
      it.data.extension_console = extensionConsole(t0)
      it.data.extension_errors = extensionConsole(t0).filter((c) => c.type === 'error' || c.source === 'pageerror')
      it.data.page_console_errors_total = consoleLog.filter((c) => c.at >= t0 && (c.type === 'error' || c.source === 'pageerror')).length
      const ok = (it.data.data_tube_ext === 'ready' || it.data.data_tube_ext_late === 'ready') && exceptions.length === 0 && (it.data.extension_errors as unknown[]).length === 0 && new URL(page.url()).hostname === 'www.youtube.com'
      it.verdict = ok ? 'proved' : 'failed'
      expect.soft(it.data.data_tube_ext_late, 'content script marked the page').toBe('ready')
      expect.soft(it.data.extension_errors, 'no extension errors in the console').toEqual([])
      saveReport()
    })

    // ================================================================ 2. pairing through the popup
    const popup = await ctx.newPage()
    await test.step('2. pairing through the popup: 5 wrong codes lock, then a new code pairs', async () => {
      if (!want('2')) return
      const it = item('2_pairing')
      await popup.setViewportSize({ width: 344, height: 720 })
      await popup.goto(`chrome-extension://${extensionId}/popup/index.html`)
      await expect.soft(popup.getByTestId('conn-state')).toHaveAttribute('data-state', 'unpaired')
      const input = popup.getByTestId('code-input')
      const errorText = popup.getByTestId('pair-error')

      const a = await server.call<{ code: string; port: number }>({ cmd: 'code' })
      pairingCodes.push(a.code)
      const wrong = String((Number(a.code) + 1) % 1_000_000).padStart(6, '0')
      const pairCalls = async () => (await server.call<ServerCall[]>({ cmd: 'calls' })).filter((c) => c.handler === 'pair_complete').length
      /** types a code (the 6th digit submits by itself) and waits for the popup to settle */
      const submit = async (code: string) => {
        const before = await pairCalls()
        await expect(input).toBeEnabled({ timeout: 20_000 })
        await input.fill('')
        await input.focus()
        await popup.keyboard.type(code)
        const end = Date.now() + 15_000
        while (Date.now() < end && (await pairCalls()) === before) await sleep(200)
        await sleep(1200)
        await expect(input).toBeEnabled({ timeout: 20_000 })
        return { reached_server: (await pairCalls()) > before, error: (await errorText.textContent())?.trim() ?? '' }
      }
      const attempts: Array<{ n: number; reached_server: boolean; error: string }> = []
      for (let n = 1; n <= 5; n++) attempts.push({ n, ...(await submit(wrong)) })
      it.data.wrong_attempts = attempts
      await shot(popup, '2-popup-wrong-5')
      // the right code A after 5 wrong ones: must be refused (locked)
      const afterLock = await submit(a.code)
      it.data.right_code_after_lock = afterLock.error
      it.data.right_code_after_lock_reached_server = afterLock.reached_server
      it.data.state_after_lock = await popup.getByTestId('conn-state').getAttribute('data-state')
      it.data.server_calls_code_a = (await server.call<ServerCall[]>({ cmd: 'calls' })).filter((c) => c.handler === 'pair_complete')

      // a new code pairs
      const b = await server.call<{ code: string; port: number }>({ cmd: 'code' })
      pairingCodes.push(b.code)
      const since = Date.now()
      await input.fill('')
      await input.focus()
      await popup.keyboard.type(b.code)
      await expect.soft(popup.getByTestId('conn-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 })
      it.data.state_after_new_code = await popup.getByTestId('conn-state').getAttribute('data-state')
      it.data.device_name_shown = (await popup.getByTestId('device-name').textContent().catch(() => null))?.trim() ?? null
      await shot(popup, '2-popup-paired')
      it.data.devices = await server.call({ cmd: 'devices' })
      await sleep(3000)
      const wire = loopbackLog.filter((r) => r.at >= since)
      it.data.loopback_after_pairing = wire.slice(0, 12).map((r) => ({ method: r.method, path: r.path.replace(/nonce=[^&]+/, 'nonce=…') }))
      it.data.code_on_the_wire = loopbackLog.some((r) => r.hasCode)
      const conn = (await storage(sw, STORAGE_KEYS.connection))[STORAGE_KEYS.connection] as { port?: number; auth?: string; status?: { state?: string } } | undefined
      it.data.stored_connection = conn ? { port: conn.port, auth: conn.auth, state: conn.status?.state } : null
      const proofThenState = wire.findIndex((r) => r.path.startsWith('/health?device=')) >= 0 && wire.some((r) => r.path.startsWith('/ext/state'))
      it.data.health_proof_then_state = proofThenState
      it.data.server_get_state_ok = (await server.call<ServerCall[]>({ cmd: 'calls' })).some((c) => c.handler === 'get_state' && c.ok)
      const lockedOk = /blocked|Too many/i.test(String(it.data.right_code_after_lock)) || /blocked|Too many/i.test(attempts[4]?.error ?? '')
      it.data.lock_observed = lockedOk
      expect.soft(lockedOk, '5 wrong codes lock the code').toBe(true)
      expect.soft(it.data.code_on_the_wire, 'the code never travels').toBe(false)
      it.verdict = it.data.state_after_new_code === 'connected' && lockedOk && !it.data.code_on_the_wire ? 'proved' : 'failed'
      saveReport()
    })

    // the first sync after pairing (trigger `pair`) opens /feed/channels by itself
    await test.step('5a. first sync after pairing (opens /feed/channels by itself)', async () => {
      if (!want('2')) return
      const it = item('5_sync')
      const deadline = Date.now() + 120_000
      let status: Record<string, unknown> | undefined
      while (Date.now() < deadline) {
        status = (await storage(sw, STORAGE_KEYS.syncStatus))[STORAGE_KEYS.syncStatus] as Record<string, unknown> | undefined
        if (status && status.state !== 'running') break
        await sleep(1000)
      }
      it.data.after_pairing = status ?? null
      it.data.after_pairing_overlay_console = consoleLog.filter((c) => c.text.startsWith('[live-probe] overlay')).map((c) => c.text)
      saveReport()
    })

    // ================================================================ 3. channel pages
    const channelResults: Record<string, unknown>[] = []
    await test.step('3. channel pages: id, subscribe button, DOM', async () => {
      if (!want('3')) return
      const it = item('3_channel')
      for (const ch of CHANNELS.slice(0, CHANNEL_COUNT)) {
        for (const form of ['channel', 'handle'] as const) {
          const path = form === 'channel' ? `/channel/${ch.id}` : `/${ch.handle}`
          await load(page, path)
          const modules = await waitExt(page)
          // the code's containers, or any button that reads "Subscribe" (the real layout may differ)
          await until(
            page,
            '!!document.querySelector("ytd-subscribe-button-renderer button, yt-subscribe-button-view-model button") || [...document.querySelectorAll("button")].some((b) => /^subscribe$/i.test((b.textContent || "").trim()))',
            20_000
          )
          await sleep(1500)
          await readers(page)
          const r = (await page.evaluate('__tubeLive.channel()')) as Record<string, unknown> & {
            ids: string[]
            box_html: string | null
            inventory: { header_html: string | null }
          }
          const name = `3-${ch.name}-${form}`
          const domPath = saveDom(name, r.box_html)
          const headerPath = saveDom(`${name}-header`, r.inventory.header_html)
          const shotPath = await shot(page, `${name}.light`)
          const res = {
            channel: ch.name,
            form,
            expected_id: ch.id,
            ids_read: r.ids,
            id_matches: r.ids.length > 0 && r.ids.every((x) => x === ch.id),
            state: r.state,
            login: r.login,
            modules,
            ...r,
            box_html: undefined,
            inventory: { ...r.inventory, header_html: undefined, header_dom: headerPath },
            dom: domPath,
            screenshot: shotPath
          }
          channelResults.push(res)
          expect.soft(res.id_matches, `${ch.name} ${form}: id read from the page = ${ch.id}`).toBe(true)
          expect.soft(r.state, `${ch.name} ${form}: subscribe button state (signed out)`).toBe('not_subscribed')
        }
      }
      it.data.pages = channelResults
      const allIds = channelResults.every((r) => r.id_matches === true)
      const allButtons = channelResults.every((r) => r.state === 'not_subscribed')
      it.verdict = allIds && allButtons ? 'proved' : 'failed'
      saveReport()
    })

    // ================================================================ 4. watch page
    await test.step('4. watch page: id, watched once, SPA switch resets, ads', async () => {
      if (!want('4')) return
      const it = item('4_watch')
      const samples: Array<Record<string, unknown>> = []
      const outboxIds = async (): Promise<Array<{ video_id: string; watched_at: number; channel_id?: string | null }>> =>
        (((await storage(sw, STORAGE_KEYS.watchOutbox))[STORAGE_KEYS.watchOutbox] as Array<{ video_id: string; watched_at: number }> | undefined) ?? [])
      const seenEvents = new Map<string, { at_video_time: number | null; duration: number | null; channel_id: unknown; at: number }>()
      let adSeen = false
      const sampleUntil = async (pred: () => boolean, ms: number) => {
        const end = Date.now() + ms
        while (Date.now() < end) {
          const w = (await page.evaluate('__tubeLive.watch()').catch(() => null)) as {
            url: string
            video: { t: number; d: number; paused: boolean } | null
            player_classes: string[] | null
            error: string | null
          } | null
          if (w) {
            samples.push({ at: Date.now(), url: new URL(w.url).search, video: w.video, classes: w.player_classes, error: w.error })
            if (w.player_classes?.some((c) => c.startsWith('ad-'))) adSeen = true
          }
          // events: the outbox (before the 30 s flush) and anything already flushed to the server
          for (const ev of await outboxIds()) {
            if (!seenEvents.has(`${ev.video_id}@${ev.watched_at}`)) {
              seenEvents.set(`${ev.video_id}@${ev.watched_at}`, { at_video_time: w?.video?.t ?? null, duration: w?.video?.d ?? null, channel_id: ev.channel_id ?? null, at: Date.now() })
            }
          }
          if (pred()) return true
          await sleep(500)
        }
        return false
      }
      const eventsFor = (id: string) => [...seenEvents.entries()].filter(([k]) => k.startsWith(`${id}@`))
      const serverWatch = async () => server.call<Array<{ video_id: string; channel_id: string | null; watched_at: number }>>({ cmd: 'watch' })

      const apiLog: Array<{ at: number; path: string; status: number; playability: string | null }> = []
      const onResponse = (res: import('@playwright/test').Response) => {
        const u = new URL(res.url())
        if (u.hostname !== 'www.youtube.com' || !/^\/youtubei\/v1\/(player|next)\b/.test(u.pathname)) return
        const entry = { at: Date.now(), path: u.pathname, status: res.status(), playability: null as string | null }
        apiLog.push(entry)
        if (u.pathname.endsWith('/player')) {
          void res
            .json()
            .then((j: { playabilityStatus?: { status?: string; reason?: string } }) => {
              entry.playability = [j.playabilityStatus?.status, j.playabilityStatus?.reason].filter(Boolean).join(': ') || null
            })
            .catch(() => undefined)
        }
      }
      page.on('response', onResponse)
      await load(page, `/watch?v=${VIDEO_A}`)
      await waitExt(page)
      await page.waitForSelector('#movie_player video', { timeout: 30_000 }).catch(() => undefined)
      await until(page, `document.querySelector('ytd-watch-flexy')?.getAttribute('video-id') === ${JSON.stringify(VIDEO_A)}`, 20_000)
      await page.evaluate('window.__liveProbeMarker = Date.now()')
      await readers(page)
      const first = (await page.evaluate('__tubeLive.watch()')) as Record<string, unknown>
      it.data.page_a = first
      it.data.id_read = new URL(String(first.url)).searchParams.get('v') === VIDEO_A && first.flexy_video_id === VIDEO_A
      it.data.modules = await page.evaluate('document.documentElement.getAttribute("data-tube-ext-modules")')

      // A: until its event shows up (19 s video: 60 % ≈ 11.4 s), max 90 s
      const gotA = await sampleUntil(() => eventsFor(VIDEO_A).length > 0, 90_000)
      it.data.a_event = gotA ? eventsFor(VIDEO_A).map(([k, v]) => ({ key: k, ...v })) : null
      const played = samples.some((s) => (s.video as { t?: number } | null)?.t && ((s.video as { t: number }).t > 1))
      it.data.a_played = played
      if (!played) {
        it.data.a_last_samples = samples.slice(-5)
        it.data.a_screenshot = await shot(page, '4-watch-a-not-playing')
      }
      // once: play A again past the threshold (seek to 0 from the page, like the replay button) → no new event
      if (gotA) {
        await page.evaluate('(() => { const v = document.querySelector("#movie_player video"); v.currentTime = 0; return v.play().catch(String) })()')
        await sampleUntil(() => false, 16_000)
        it.data.a_events_after_replay = eventsFor(VIDEO_A).length
      }
      it.data.a_screenshot ??= await shot(page, '4-watch-a')

      // SPA switch (YouTube's internal navigation, no reload), tried in order until the player really changes video:
      // 1. click on a related video's title; 2. click on another one's thumbnail; 3. the app's own `yt-navigate` event.
      const candidates = (await page.evaluate(String.raw`(() => {
        const out = []
        for (const l of document.querySelectorAll('#secondary yt-lockup-view-model, #related yt-lockup-view-model, ytd-compact-video-renderer')) {
          const a = l.querySelector('a[href^="/watch?v="]')
          const h = a && a.getAttribute('href')
          if (!h || h.includes('${VIDEO_A}') || h.includes('list=')) continue
          const id = new URL(h, location.origin).searchParams.get('v')
          if (/^[\w-]{11}$/.test(id) && !out.includes(id)) out.push(id)
          if (out.length >= 3) break
        }
        return out
      })()`)) as string[]
      it.data.spa_candidates = candidates
      const attempts: Array<Record<string, unknown>> = []
      let bId: string | null = null
      let switched = false
      const methods = ['title_click', 'thumbnail_click', 'yt_navigate_event'] as const
      for (let i = 0; i < methods.length && i < candidates.length && !switched; i++) {
        const method = methods[i]
        const id = candidates[i]
        const before = loads
        const at = Date.now()
        let error: string | null = null
        if (method === 'yt_navigate_event') {
          await page.evaluate(
            `document.querySelector('ytd-app').dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=${id}', webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: { videoId: '${id}' } } } }))`
          ).catch((e: Error) => (error = e.message))
        } else {
          const sel =
            method === 'title_click'
              ? `#secondary a[href*="v=${id}"]:not([class*="ContentImage"]):not([class*="content-image"]):not(#thumbnail)`
              : `#secondary a[href*="v=${id}"]`
          const loc = page.locator(sel)
          const n = await loc.count()
          await loc
            .nth(method === 'title_click' ? Math.max(0, n - 1) : 0)
            .click({ timeout: 10_000 })
            .catch((e: Error) => (error = e.message.split('\n')[0]))
        }
        const urlChanged = await until(page, `location.search.includes(${JSON.stringify(id)})`, 15_000)
        switched = await until(page, `document.querySelector('ytd-watch-flexy')?.getAttribute('video-id') === ${JSON.stringify(id)}`, 25_000)
        attempts.push({
          method,
          id,
          error,
          url_changed: urlChanged,
          player_switched: switched,
          no_reload: (await page.evaluate('typeof window.__liveProbeMarker === "number"')) === true && loads === before,
          api: apiLog.filter((a) => a.at >= at).map((a) => `${a.status} ${a.path} ${a.playability ?? ''}`),
          blocked: blockedLog.filter((b) => b.at >= at).map((b) => `${b.host}${b.path}`).slice(0, 10),
          page_errors: consoleLog.filter((c) => c.at >= at && (c.type === 'error' || c.source === 'pageerror')).map((c) => c.text.slice(0, 160)).slice(0, 8)
        })
        bId = id
        // a player that did not switch: the tracker follows the URL — 5 s of samples show what it counts meanwhile
        if (!switched) await sampleUntil(() => false, 5000)
      }
      it.data.spa_attempts = attempts
      it.data.spa_player_switched = switched
      it.data.spa_no_reload = attempts.length > 0 && attempts.every((a) => a.no_reload === true)
      if (bId && switched) {
        const startB = (await page.evaluate('__tubeLive.watch()')) as { video: { t: number; d: number } | null }
        it.data.b_start = startB
        const dur = startB.video?.d && Number.isFinite(startB.video.d) ? startB.video.d : 300
        const need = Math.min(dur * 0.6, 240)
        const id = bId
        const gotB = await sampleUntil(() => eventsFor(id).length > 0, (need + 90) * 1000)
        it.data.b_id = id
        it.data.b_needed_s = Math.round(need)
        it.data.b_event = gotB ? eventsFor(id).map(([k, v]) => ({ key: k, ...v })) : null
        // reset proof: B's event fires only after B's own threshold (not right away with A's seconds)
        const bt = gotB ? eventsFor(id)[0][1] : null
        it.data.b_reset_ok = bt ? (bt.at_video_time ?? 0) >= Math.min(need * 0.8, need - 2) : null
      }
      it.data.events_seen = [...seenEvents.entries()].map(([k, v]) => ({ key: k, ...v }))
      await shot(page, '4-watch-b')
      page.off('response', onResponse)
      it.data.api_log = apiLog.map((a) => ({ ...a, at: new Date(a.at).toISOString() }))
      it.data.ad_seen = adSeen
      it.data.samples_n = samples.length
      it.data.sample_tail = samples.slice(-3)

      // delivery to the server: the outbox goes out on the next ExtState (30 s alarm)
      const flushDeadline = Date.now() + 80_000
      let rows = await serverWatch()
      while (Date.now() < flushDeadline && (await outboxIds()).length > 0) {
        await sleep(3000)
      }
      rows = await serverWatch()
      it.data.server_rows = rows
      it.data.server_sync_watch_calls = (await server.call<ServerCall[]>({ cmd: 'calls' })).filter((c) => c.handler === 'sync_watch')
      const aRows = rows.filter((r) => r.video_id === VIDEO_A).length
      it.data.server_rows_a = aRows
      expect.soft(aRows, 'video A recorded once on the server').toBe(1)
      const bOk = it.data.b_reset_ok === true && rows.filter((r) => r.video_id === it.data.b_id).length === 1
      it.verdict = aRows === 1 && it.data.id_read === true && it.data.a_events_after_replay === 1 && bOk && it.data.spa_no_reload === true ? 'proved' : played ? 'partial' : 'failed'
      if (!adSeen) it.notes.push('no ad showed up during the run: the ad rule was not exercised live')
      saveReport()
    })

    // ================================================================ 5. "Sync now" signed out
    await test.step('5. "Sync now" signed out: tab, notice, partial, nothing sent, focus back', async () => {
      if (!want('5')) return
      const it = item('5_sync')
      await popup.bringToFront()
      await popup.reload()
      await expect.soft(popup.getByTestId('conn-state')).toHaveAttribute('data-state', 'connected')
      const popupTab = (await tabsList(sw)).find((t) => t.url.startsWith(`chrome-extension://${extensionId}/popup`))
      it.data.popup_tab = popupTab?.id ?? null
      it.data.active_before = await activeTab(sw)
      const callsBefore = (await server.call<ServerCall[]>({ cmd: 'calls' })).length
      const since = Date.now()
      const opened: Array<{ url: string; at: number }> = []
      let syncShot: string | null = null
      const onPage = (p: Page) => {
        opened.push({ url: p.url(), at: Date.now() })
        void p
          .waitForSelector('tube-sync-overlay', { state: 'attached', timeout: 30_000 })
          .then(async () => {
            syncShot = await shot(p, '5-sync-tab-overlay.light')
          })
          .catch(() => undefined)
      }
      ctx.on('page', onPage)
      await popup.getByTestId('sync-now').click()
      const deadline = Date.now() + 120_000
      let status: Record<string, unknown> | undefined
      await sleep(1500)
      while (Date.now() < deadline) {
        status = (await storage(sw, STORAGE_KEYS.syncStatus))[STORAGE_KEYS.syncStatus] as Record<string, unknown> | undefined
        if (status && status.state !== 'running' && Number(status.started_at) >= since - 1000) break
        await sleep(1000)
      }
      ctx.off('page', onPage)
      await sleep(1500)
      it.data.opened_tabs = opened
      it.data.status = status ?? null
      it.data.overlay_console = consoleLog.filter((c) => c.at >= since && c.text.startsWith('[live-probe] overlay')).map((c) => c.text)
      it.data.overlay_screenshot = syncShot
      it.data.active_after = await activeTab(sw)
      it.data.tabs_after = (await tabsList(sw)).map((t) => t.url.replace(/\?.*/, ''))
      const calls = (await server.call<ServerCall[]>({ cmd: 'calls' })).slice(callsBefore)
      it.data.sync_calls = calls.filter((c) => c.handler === 'sync_subscriptions')
      it.data.ext_console = extensionConsole(since).map((c) => `${c.source} ${c.type}: ${c.text}`)
      await shot(popup, '5-popup-after-sync')
      it.data.popup_summary = (await popup.getByTestId('sync-summary').textContent({ timeout: 2000 }).catch(() => null))?.trim() ?? null
      it.data.popup_error = (await popup.getByTestId('sync-error').textContent({ timeout: 2000 }).catch(() => null))?.trim() ?? null
      // signed out, /feed/channels answers with a redirect to the Google sign-in page (blocked here: not a YouTube host)
      it.data.redirects_seen = blockedLog.filter((b) => b.at >= since && b.navigation).map((b) => `${b.host}${b.path}`)
      const focusBack = (it.data.active_after as Array<{ id: number }>)[0]?.id === popupTab?.id
      const noFeedTab = !(it.data.tabs_after as string[]).some((u) => u.includes('/feed/channels') || u.includes('accounts.google.com'))
      const nothingSent = (it.data.sync_calls as unknown[]).length === 0
      const code = (status?.error as { code?: string } | undefined)?.code
      const honest = status?.state === 'error' && (code === 'logged_out' || code === 'nothing_to_send')
      const overlaySeen = (it.data.overlay_console as string[]).some((t) => t.includes('overlay+ tube-sync-overlay'))
      it.data.checks = {
        opened_tab: opened.length > 0,
        overlay_seen: overlaySeen,
        closed: noFeedTab,
        focus_back: focusBack,
        signal: status?.signal ?? null,
        error_code: code ?? null,
        nothing_sent: nothingSent
      }
      expect.soft(nothingSent, 'nothing sent signed out').toBe(true)
      expect.soft(focusBack, 'focus returns to the origin tab').toBe(true)
      if (!overlaySeen) it.notes.push('the notice did not show: signed out the tab never reaches /feed/channels, so the reader never runs')
      it.verdict = nothingSent && focusBack && noFeedTab && honest && opened.length > 0 ? 'proved' : 'failed'
      saveReport()
    })

    // ================================================================ 6. unsubscribe queue signed out
    await test.step('6. queue signed out: nothing opens without Run now; Run now → channel tab, zero clicks, honest error', async () => {
      if (!want('6')) return
      const it = item('6_queue')
      const ch = CHANNELS[0]
      const approved = await server.call<{ items: Array<{ id: string }> }>({ cmd: 'approve', channel_id: ch.id, title: ch.name })
      it.data.approved = approved.items
      const since = Date.now()
      const opened: string[] = []
      const onPage = (p: Page) => opened.push(p.url())
      ctx.on('page', onPage)
      // 90 s with a YouTube tab open and no click: nothing may open
      const navs: string[] = []
      const onNav = (req: Request) => {
        if (isMainFrameNavigation(req) && req.url().includes('/channel/')) navs.push(req.url())
      }
      ctx.on('request', onNav)
      await page.bringToFront()
      await sleep(90_000)
      it.data.without_click = { opened_tabs: [...opened], channel_navigations: [...navs], badge: await badge(sw), queue: await server.call({ cmd: 'queue' }) }
      expect.soft(opened.length + navs.length, 'nothing opens without Run now').toBe(0)

      // the popup lists the item; Run now
      await popup.bringToFront()
      await popup.reload()
      const card = popup.getByTestId('queue-card')
      await expect.soft(card).toHaveAttribute('data-state', 'waiting', { timeout: 40_000 })
      it.data.card_before = { state: await card.getAttribute('data-state').catch(() => null), text: (await card.textContent().catch(() => null))?.trim() ?? null }
      await shot(popup, '6-popup-waiting')
      const clickAt = Date.now()
      let queueShot: string | null = null
      const onQueuePage = (p: Page) => {
        void p
          .waitForSelector('tube-queue-overlay', { state: 'attached', timeout: 60_000 })
          .then(async () => {
            await sleep(300)
            queueShot = await shot(p, '6-queue-tab-overlay.light')
          })
          .catch(() => undefined)
      }
      ctx.on('page', onQueuePage)
      await popup.getByTestId('queue-run-now').click()
      const deadline = Date.now() + 150_000
      let rows: Array<{ status: string; error: string | null }> = []
      while (Date.now() < deadline) {
        rows = await server.call({ cmd: 'queue' })
        if (rows.length && rows.every((r) => r.status === 'done' || r.status === 'failed')) break
        await sleep(2000)
      }
      await sleep(4000)
      ctx.off('page', onPage)
      ctx.off('page', onQueuePage)
      ctx.off('request', onNav)
      it.data.after_click = { opened_tabs: opened, channel_navigations: navs }
      it.data.queue_rows = rows
      it.data.queue_results = (await server.call<ServerCall[]>({ cmd: 'calls' })).filter((c) => c.handler === 'post_queue_result' && c.at * 1000 >= since)
      const clicks = consoleLog.filter((c) => c.at >= clickAt && c.text.startsWith('[live-probe] click') && c.text.includes('"url":"/channel/'))
      it.data.clicks_on_channel_page = clicks.map((c) => c.text)
      it.data.overlay_console = consoleLog.filter((c) => c.at >= clickAt && c.text.startsWith('[live-probe] overlay')).map((c) => c.text)
      it.data.overlay_screenshot = queueShot
      const run = (await storage(sw, STORAGE_KEYS.queueRun))[STORAGE_KEYS.queueRun] as Record<string, unknown> | undefined
      it.data.queue_run = run ? { state: run.state, hold_reason: run.hold_reason, message: run.message } : null
      it.data.tabs_after = (await tabsList(sw)).map((t) => `${t.active ? '*' : ' '} ${t.url.replace(/\?.*/, '')}`)
      it.data.ext_console = extensionConsole(clickAt).map((c) => `${c.source} ${c.type}: ${c.text}`)
      await sleep(1000)
      it.data.card_after = { state: await card.getAttribute('data-state').catch(() => null), text: (await card.textContent().catch(() => null))?.trim() ?? null }
      await shot(popup, '6-popup-after')
      const failedHonestly = rows.length === 1 && rows[0].status === 'failed' && !!rows[0].error
      const openedChannel = navs.some((u) => u.includes(`/channel/${ch.id}`))
      expect.soft(clicks, 'the extension clicked nothing on the channel page').toEqual([])
      expect.soft(failedHonestly, 'item ends failed with a reason').toBe(true)
      it.verdict = opened.length >= 1 && openedChannel && clicks.length === 0 && failedHonestly && (it.data.without_click as { opened_tabs: string[] }).opened_tabs.length === 0 ? 'proved' : 'failed'
      saveReport()
    })

    // ================================================================ 7. themes and widths
    await test.step('7. themes and widths: channel page and the sync notice, light and dark', async () => {
      if (!want('7')) return
      const it = item('7_themes')
      const results: Record<string, unknown>[] = []
      // one real page (signed out, /feed/channels redirects to sign-in): the channel page, light and dark, wide and
      // narrow, with the sync notice rendered on it by the extension's own code
      await page.setViewportSize({ width: 1280, height: 800 })
      // dark before the load: signed out, YouTube reads the device theme when the page starts
      await page.emulateMedia({ colorScheme: 'dark' })
      await load(page, `/channel/${CHANNELS[0].id}`)
      await waitExt(page)
      await until(page, '[...document.querySelectorAll("button")].some((b) => /^subscribe$/i.test((b.textContent || "").trim()))', 20_000)
      await sleep(1500)
      it.data.dark_by_device_theme = await page.evaluate('document.documentElement.hasAttribute("dark")')
      if (!it.data.dark_by_device_theme) {
        // signed out, YouTube's own Appearance setting (masthead ⋮ → Appearance → Dark theme): a local preference, no account
        const menu: string[] = []
        try {
          await page.locator('ytd-masthead button[aria-label="Settings"]').first().click({ timeout: 10_000 })
          menu.push('settings')
          await page.locator('ytd-toggle-theme-compact-link-renderer').first().click({ timeout: 10_000 })
          menu.push('appearance')
          await page.locator('ytd-compact-link-renderer', { hasText: /^\s*Dark theme\s*$/ }).first().click({ timeout: 10_000 })
          menu.push('dark_theme')
        } catch (e) {
          menu.push(`error: ${(e as Error).message.split('\n')[0]}`)
        }
        it.data.dark_by_menu = { steps: menu, dark: await until(page, 'document.documentElement.hasAttribute("dark")', 10_000) }
        await page.keyboard.press('Escape').catch(() => undefined)
        await sleep(1500)
      }
      for (const scheme of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await sleep(1000)
        for (const width of [1280, 420]) {
          await page.setViewportSize({ width, height: 800 })
          await sleep(600)
          await readers(page)
          const ch = (await page.evaluate('__tubeLive.channel()')) as Record<string, unknown> & { box_html: string | null; inventory: { header_html: string | null; subscribe_like: unknown } }
          await page.evaluate('__tubeLive.showSyncOverlay(37)')
          await sleep(400)
          const c = await page.evaluate('__tubeLive.overlayContrast("tube-sync-overlay")')
          results.push({
            page: `channel/${CHANNELS[0].id}`,
            scheme,
            width,
            yt_dark: ch.dark,
            state: ch.state,
            button: ch.button,
            subscribe_like: ch.inventory.subscribe_like,
            contrast: c,
            header_dom: saveDom(`7-channel-header.${scheme}.${width}`, ch.inventory.header_html),
            screenshot: await shot(page, `7-channel-with-sync-notice.${scheme}.${width}`)
          })
          await page.evaluate('__tubeLive.removeSyncOverlay()')
        }
      }
      await page.emulateMedia({ colorScheme: 'light' })
      await page.setViewportSize({ width: 1280, height: 800 })
      it.data.results = results
      const minRatio = Math.min(
        ...results.flatMap((r) => ((r.contrast as { texts?: Array<{ ratio: number }> } | null)?.texts ?? []).map((x) => x.ratio))
      )
      it.data.min_text_contrast = minRatio
      // with the device in dark the page must be dark; with the device back in light, a page dark by YouTube's own
      // setting stays dark (the notice follows the device: the mismatch case)
      const darkFollowed = results.filter((r) => r.scheme === 'dark').every((r) => r.yt_dark === true)
      it.data.youtube_followed_light_switch_without_reload = results.filter((r) => r.scheme === 'light').every((r) => r.yt_dark === false)
      it.data.youtube_followed_dark = darkFollowed
      it.data.button_states = results.map((r) => `${r.scheme}/${r.width}: ${String(r.state)}`)
      it.verdict = minRatio >= 4.5 && darkFollowed ? 'proved' : 'failed'
      it.notes.push('the notice is rendered by the extension code on a real page; the real sync never shows it signed out')
      expect.soft(minRatio, 'notice text contrast (WCAG AA)').toBeGreaterThanOrEqual(4.5)
      saveReport()
    })
  } finally {
    report.finished_at = new Date().toISOString()
    // the server proof (GET /health?device=&nonce=) is asked again once the 60 s trust after pairing runs out
    const proofs = loopbackLog.filter((r) => r.path.startsWith('/health?device='))
    item('2_pairing').data.health_proofs_in_run = proofs.length
    item('2_pairing').data.authed_requests_in_run = loopbackLog.filter((r) => r.path.startsWith('/ext/')).length
    item('2_pairing').data.first_proof_at = proofs[0] ? new Date(proofs[0].at).toISOString() : null
    report.extension_console_all = extensionConsole().map((c) => `${new Date(c.at).toISOString()} ${c.source} ${c.type}: ${c.text}`)
    report.load_log = loadLog
    saveReport()
    await context?.close().catch(() => undefined)
    rmSync(profile, { recursive: true, force: true })
    await server.stop()
  }
})
