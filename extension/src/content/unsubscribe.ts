// content/unsubscribe — on the channel page that background/queue opened, the `queue.execute` command unsubscribes
// (`unsubscribe`) or subscribes again (`resubscribe`). Based on the MyTube content script
// (same author, relicensed under MIT here), rewritten: no sessionStorage/batching/own navigation, no translated text.
//
// Rules (nothing is unsubscribed without a human click; the YouTube page is **untrusted data**):
// - Never attaches on its own (`matches` always false): only acts on a command from the background, which only sends an item coming from
//   `GET /ext/queue`. A page message, DOM event or another extension does not get here (the router ignores it).
// - **Before any click** it checks that the page belongs to the item's channel: ids read from the page (`link canonical`,
//   `og:url`, `meta itemprop=identifier|channelId`, `ytInitialData.metadata.channelMetadataRenderer.externalId`,
//   `microformat…urlCanonical`) — at least one, and all equal to the item's id; the tab URL, if it is `/channel/UC…`,
//   must match too. Otherwise `wrong_channel` and zero clicks.
// - Logged out (`ytcfg LOGGED_IN` false, login promo/link) → `logged_out`; captcha/challenge → `challenge`; nothing clicked.
// - The button only in the channel header (shelves of other channels on the same page are ignored). State by
//   attribute/structure (`[subscribed]`, the button's `--tonal`/`--filled` class), never by text.
// - Unsubscribe: clicks the button → confirmation dialog (or the new layout's menu → unsubscribe item → dialog) →
//   confirms → **verifies** that the button turned into "Subscribe" → `done`. Already not subscribed → `done` + `not_subscribed`.
//   Resubscribe: clicks → verifies "Subscribed" → `done`; already subscribed → `done` + `already_subscribed`.
// - Every step has a deadline (`waitUntil` via MutationObserver + periodic check); no blind waits.
// - Visible notice (`<tube-queue-overlay>`, same style as the sync notice): "unsubscribing 2 of 5 · <channel> · Stop".
//   Stop/Esc before the click → `failed/stopped` (nothing clicked) and asks the queue to stop (`QUEUE_CTL_KEY`).
import type { ExtRouteKey } from '../../../shared/api-types'
import type { ExtTabCommands } from '../../../shared/ext-messages'
import { requestQueueStop, type QueueReason } from '../background/queue'
import type { ContentModule } from '../lib/content'
import { errorMessage } from '../lib/envelope'
import { t } from '../lib/i18n'

export const MODULE = 'content/unsubscribe'
/** the results go to the server through background/queue */
export const ROUTES = [] as const satisfies readonly ExtRouteKey[]
export const REAL_ROUTES: readonly ExtRouteKey[] = []

export const QUEUE_OVERLAY_TAG = 'tube-queue-overlay'

/**
 * Request from the background. The contract (`ExtTabCommands['queue.execute'].req`) has `{queue_id, action, channel_url}`;
 * the background also sends the channel id and the notice text (contract change requested).
 */
export type QueueExecuteRequest = ExtTabCommands['queue.execute']['req'] & {
  channel_id?: string
  channel_title?: string | null
  index?: number
  total?: number
}
export type QueueExecuteResult = ExtTabCommands['queue.execute']['res']

export interface StepTimeouts {
  /** page ready: channel identity + button (or logged-out/challenge signal) */
  ready: number
  /** dialog/menu after the click */
  dialog: number
  /** button changed state after confirming */
  verify: number
}
export const DEFAULT_TIMEOUTS: StepTimeouts = { ready: 20_000, dialog: 6_000, verify: 10_000 }

export interface ExecuteOptions {
  doc?: Document
  /** tab URL (default: `location.href`) */
  url?: string
  timeouts?: Partial<StepTimeouts>
  /** show the notice (default: yes) */
  overlay?: boolean
}

const CHANNEL_ID = /^UC[\w-]{22}$/
const fail = (error: QueueReason): QueueExecuteResult => ({ status: 'failed', error })
const done = (note: QueueReason | null = null): QueueExecuteResult => ({ status: 'done', error: note })

// ------------------------------------------------------------------ reading the page (untrusted)

/** `UC…` from a `https://www.youtube.com/channel/UC…` URL (or relative); null for anything else. */
export function channelIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url, 'https://www.youtube.com')
    if (u.hostname !== 'www.youtube.com' && u.hostname !== 'youtube.com' && u.hostname !== 'm.youtube.com') return null
    const m = /^\/channel\/(UC[\w-]{22})(?:\/|$)/.exec(u.pathname)
    return m ? m[1] : null
  } catch {
    return null
  }
}

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

function readInitialData(doc: Document): Record<string, unknown> | null {
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = s.textContent ?? ''
    for (const marker of DATA_MARKERS) {
      const idx = text.indexOf(marker)
      if (idx === -1) continue
      const json = sliceJsonObject(text, idx + marker.length)
      if (!json) continue
      try {
        const v = JSON.parse(json) as unknown
        if (v && typeof v === 'object') return v as Record<string, unknown>
      } catch {
        // next marker/script
      }
    }
  }
  return null
}

const dig = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), o)

/**
 * Channel ids the page claims to be itself. Only sources that describe **the page** (never a bare `channelId`, which
 * shows up in shelves of other channels). Sources that disagree all show up: the caller refuses.
 */
export function readPageChannelIds(doc: Document): string[] {
  const ids = new Set<string>()
  const add = (v: string | null | undefined) => {
    if (v && CHANNEL_ID.test(v)) ids.add(v)
  }
  for (const l of Array.from(doc.querySelectorAll('link[rel="canonical"]'))) add(channelIdFromUrl(l.getAttribute('href')))
  for (const m of Array.from(doc.querySelectorAll('meta[property="og:url"]'))) add(channelIdFromUrl(m.getAttribute('content')))
  for (const m of Array.from(doc.querySelectorAll('meta[itemprop="identifier"], meta[itemprop="channelId"]'))) add(m.getAttribute('content'))
  const data = readInitialData(doc)
  if (data) {
    const ext = dig(data, 'metadata', 'channelMetadataRenderer', 'externalId')
    if (typeof ext === 'string') add(ext)
    const canon = dig(data, 'microformat', 'microformatDataRenderer', 'urlCanonical')
    if (typeof canon === 'string') add(channelIdFromUrl(canon))
  }
  return [...ids]
}

const LOGGED_OUT_DOM = 'ytd-background-promo-renderer, a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"]'

/** `in` (ytcfg LOGGED_IN true), `out` (LOGGED_IN false or login promo/link), `unknown`. */
export function detectLogin(doc: Document): 'in' | 'out' | 'unknown' {
  let flag: boolean | null = null
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const m = /"LOGGED_IN"\s*:\s*(true|false)/.exec(s.textContent ?? '')
    if (m) {
      flag = m[1] === 'true'
      break
    }
  }
  if (flag === false) return 'out'
  if (doc.querySelector(LOGGED_OUT_DOM)) return 'out'
  return flag === true ? 'in' : 'unknown'
}

/** Captcha/challenge/consent in place of the channel page. */
export function detectChallenge(doc: Document, url: string | null | undefined): boolean {
  if (url && (/^https:\/\/(www\.)?google\.[a-z.]+\/sorry\//.test(url) || /^https:\/\/www\.youtube\.com\/sorry\b/.test(url) || /^https:\/\/consent\./.test(url))) {
    return true
  }
  return doc.querySelector('form#captcha-form, form[action*="/sorry/"], iframe[src*="recaptcha"], .g-recaptcha, #recaptcha') !== null
}

/** Visible: no `hidden`, `aria-hidden="true"` or `display:none` on the element itself or above it. */
function isShown(el: Element | null): boolean {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (cur.hasAttribute('hidden') || cur.getAttribute('aria-hidden') === 'true') return false
    const style = (cur as HTMLElement).style
    if (style?.display === 'none' || style?.visibility === 'hidden') return false
    const view = cur.ownerDocument?.defaultView
    if (view && cur instanceof view.HTMLElement) {
      const cs = view.getComputedStyle(cur)
      if (cs.display === 'none' || cs.visibility === 'hidden') return false
    }
  }
  return el !== null
}

/** Roots of the channel header (new and classic layout). Buttons outside them (shelves) do not count. */
const HEADER_ROOTS = '#page-header, yt-page-header-renderer, ytd-c4-tabbed-header-renderer, #channel-header-container'
const SUB_CONTAINERS = 'ytd-subscribe-button-renderer, yt-subscribe-button-view-model'

/** Subscribe button of the channel header, or null. */
export function findSubscribeButton(doc: Document): HTMLElement | null {
  for (const root of Array.from(doc.querySelectorAll(HEADER_ROOTS))) {
    if (!isShown(root)) continue
    for (const box of Array.from(root.querySelectorAll(SUB_CONTAINERS))) {
      if (!isShown(box)) continue
      const btn = box.querySelector('button')
      if (btn && isShown(btn)) return btn as HTMLElement
    }
  }
  return null
}

/**
 * Button shape classes, old and current naming. The live page (Nov 2026) renders the spec-button classes in camelCase
 * (`ytSpecButtonShapeNextFilled` on the signed-out "Subscribe"); the `yt-spec-button-shape-next--*` names are gone.
 */
const SHAPE_SUBSCRIBED = ['yt-spec-button-shape-next--tonal', 'ytSpecButtonShapeNextTonal']
const SHAPE_NOT_SUBSCRIBED = ['yt-spec-button-shape-next--filled', 'ytSpecButtonShapeNextFilled']

/** State from the `subscribed` attribute (classic layout) or the button shape (tonal subscribed, filled not). */
export function subscriptionState(button: Element): 'subscribed' | 'not_subscribed' | 'unknown' {
  const box = button.closest(SUB_CONTAINERS)
  if (button.hasAttribute('subscribed') || box?.hasAttribute('subscribed') || box?.querySelector('[subscribed]')) return 'subscribed'
  const cls = button.classList
  if (SHAPE_SUBSCRIBED.some((c) => cls.contains(c))) return 'subscribed'
  if (SHAPE_NOT_SUBSCRIBED.some((c) => cls.contains(c))) return 'not_subscribed'
  return 'unknown'
}

// ------------------------------------------------------------------ dialog and menu

const DIALOGS = 'tp-yt-paper-dialog, yt-confirm-dialog-renderer, yt-dialog-view-model, [role="dialog"], dialog'
const MENUS = 'tp-yt-iron-dropdown, ytd-menu-popup-renderer, yt-sheet-view-model, yt-contextual-sheet-layout, [role="menu"], [role="listbox"]'
const MENU_ITEMS = 'ytd-menu-service-item-renderer, yt-list-item-view-model, tp-yt-paper-item, [role="menuitem"], [role="option"]'

function confirmButtonIn(dialog: Element): HTMLElement | null {
  const direct = dialog.querySelector('#confirm-button button, #confirm-button [role="button"], [slot="primaryAction"] button')
  if (direct && isShown(direct)) return direct as HTMLElement
  // new-layout dialog (view-model): the last button of the button area is the main action
  const vm = dialog.matches('yt-dialog-view-model') ? dialog : dialog.querySelector('yt-dialog-view-model')
  if (vm) {
    const btns = Array.from(vm.querySelectorAll('[class*="dialog-view-model"][class*="buttons"] button')).filter(isShown)
    if (btns.length >= 2) return btns[btns.length - 1] as HTMLElement
  }
  return null
}

const shownSet = (doc: Document, sel: string): Set<Element> => new Set(Array.from(doc.querySelectorAll(sel)).filter(isShown))

const normText = (s: string | null | undefined): string => (s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** Header elements that carry the channel's name (new and classic layout). */
const NAME_NODES = `${HEADER_ROOTS
  .split(',')
  .map((r) => `${r.trim()} h1, ${r.trim()} #channel-name #text`)
  .join(', ')}, yt-page-header-renderer yt-dynamic-text-view-model`

/**
 * The channel's name as the page shows it (header, `og:title`/`itemprop=name`, `<title>`, `ytInitialData`). The
 * unsubscribe confirmation always names the channel, in any language; a survey or promotion does not. Names shorter
 * than 2 characters are ignored (too easy to find by chance).
 */
export function pageChannelNames(doc: Document): string[] {
  const names = new Set<string>()
  const add = (v: string | null | undefined) => {
    const n = normText(v)
    if (n.length >= 2 && n.length <= 200) names.add(n)
  }
  for (const el of Array.from(doc.querySelectorAll(NAME_NODES))) add(el.textContent)
  add(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'))
  add(doc.querySelector('meta[itemprop="name"]')?.getAttribute('content'))
  const title = doc.querySelector('title')?.textContent ?? ''
  if (/ - YouTube\s*$/.test(title)) add(title.replace(/ - YouTube\s*$/, ''))
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const m = /"channelMetadataRenderer"\s*:\s*\{\s*"title"\s*:\s*("(?:[^"\\]|\\.){1,400}")/.exec(s.textContent ?? '')
    if (!m) continue
    try {
      add(JSON.parse(m[1]) as string)
    } catch {
      // not a JSON string: ignore this source
    }
    break
  }
  return [...names]
}

/**
 * confirm button of a dialog that **appeared after** our click **and names the channel** (`names`). Any other
 * dialog (survey, Premium promotion, "still watching?") is never clicked: the caller fails with `confirm_not_found`.
 */
function newConfirm(doc: Document, before: Set<Element>, names: readonly string[]): HTMLElement | null {
  if (!names.length) return null
  for (const d of Array.from(doc.querySelectorAll(DIALOGS))) {
    if (before.has(d) || !isShown(d)) continue
    const text = normText(d.textContent)
    if (!names.some((n) => text.includes(n))) continue
    const b = confirmButtonIn(d)
    if (b) return b
  }
  return null
}

/**
 * Labels of the unsubscribe menu item (whole text, lowercase NFKC), when YouTube renders it without the icon name:
 * en, pt, es, fr, de, it (escaped: source files stay ASCII).
 */
const UNSUBSCRIBE_LABELS = new Set([
  'unsubscribe',
  'cancelar inscri\u00e7\u00e3o',
  'cancelar inscripci\u00f3n',
  'anular suscripci\u00f3n',
  'se d\u00e9sabonner',
  'abo beenden',
  'annulla iscrizione'
])

function isUnsubscribeItem(el: Element): boolean {
  if (Array.from(el.querySelectorAll('[icon]')).some((i) => /person_minus|unsubscribe/i.test(i.getAttribute('icon') ?? ''))) return true
  return UNSUBSCRIBE_LABELS.has(normText(el.textContent))
}

/**
 * unsubscribe item of a menu that **appeared after** our click: the one with the unsubscribe icon (or its exact
 * label). No such item → `null` (the caller fails with `confirm_not_found`): never "the last item" of a menu.
 */
function newMenuItem(doc: Document, before: Set<Element>): HTMLElement | null {
  for (const m of Array.from(doc.querySelectorAll(MENUS))) {
    if (before.has(m) || !isShown(m)) continue
    const all = Array.from(m.querySelectorAll(MENU_ITEMS)).filter(isShown)
    const top = all.filter((el) => !all.some((o) => o !== el && o.contains(el)))
    const pick = top.find(isUnsubscribeItem)
    if (!pick) continue
    const clickable = (pick.matches('tp-yt-paper-item, [role="menuitem"], [role="option"]') ? pick : pick.querySelector('tp-yt-paper-item, [role="menuitem"], [role="option"], button')) ?? pick
    return clickable as HTMLElement
  }
  return null
}

// ------------------------------------------------------------------ wait with a deadline

/** Waits for `probe` to return something (on every DOM mutation and every 100 ms), until the deadline or the abort. Never waits blindly. */
function waitUntil<T>(doc: Document, probe: () => T | null | undefined | false, ms: number, signal: AbortSignal): Promise<T | null> {
  const first = probe()
  if (first) return Promise.resolve(first)
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    let finished = false
    const finish = (v: T | null) => {
      if (finished) return
      finished = true
      obs.disconnect()
      clearInterval(poll)
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(v)
    }
    const check = () => {
      try {
        const v = probe()
        if (v) finish(v)
      } catch {
        // page changing: try on the next one
      }
    }
    const onAbort = () => finish(null)
    const obs = new MutationObserver(check)
    obs.observe(doc.documentElement, { childList: true, subtree: true, attributes: true })
    const poll = setInterval(check, 100)
    const timer = setTimeout(() => finish(null), ms)
    signal.addEventListener('abort', onAbort)
  })
}

// ------------------------------------------------------------------ notice

const CSS = `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  left: 50% !important;
  bottom: 24px !important;
  transform: translateX(-50%) !important;
  color-scheme: light dark !important;
  pointer-events: auto !important;
}
.card {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid GrayText;
  border-radius: 10px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 4px 18px color-mix(in srgb, CanvasText 22%, transparent);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: currentColor; opacity: 0.6; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.15; } }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { font-weight: 600; }
.progress { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.note { font-size: 12px; opacity: 0.8; }
button { flex: none; font: inherit; padding: 4px 12px; border: 1px solid ButtonBorder; border-radius: 6px; background: ButtonFace; color: ButtonText; cursor: pointer; }
button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
button:disabled { cursor: default; opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
`

interface QueueOverlay {
  status(text: string): void
  remove(): void
}

/** Notice "unsubscribing 2 of 5 · <channel> · Stop". Text only via `textContent` (the channel title is not HTML). */
function showQueueOverlay(doc: Document, req: QueueExecuteRequest, onStop: () => void): QueueOverlay {
  const view = doc.defaultView ?? window
  for (const old of Array.from(doc.querySelectorAll(QUEUE_OVERLAY_TAG))) old.remove()
  const host = doc.createElement(QUEUE_OVERLAY_TAG)
  const root = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = CSS
  const card = doc.createElement('div')
  card.className = 'card'
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')
  const dot = doc.createElement('span')
  dot.className = 'dot'
  dot.setAttribute('aria-hidden', 'true')
  const text = doc.createElement('div')
  text.className = 'text'
  const title = doc.createElement('span')
  title.className = 'title'
  title.textContent = t('queue', `overlay_title_${req.action}`)
  const progress = doc.createElement('span')
  progress.className = 'progress'
  progress.dataset.role = 'progress'
  const channel = (typeof req.channel_title === 'string' && req.channel_title) || req.channel_id || ''
  const index = Number.isFinite(req.index) ? Number(req.index) : 1
  const total = Math.max(index, Number.isFinite(req.total) ? Number(req.total) : 1)
  progress.textContent = t('queue', `progress_${req.action}`, { index, total, channel })
  const note = doc.createElement('span')
  note.className = 'note'
  note.textContent = t('queue', 'overlay_note')
  text.append(title, progress, note)
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = t('queue', 'overlay_stop')
  button.setAttribute('aria-keyshortcuts', 'Escape')
  card.append(dot, text, button)
  root.append(style, card)

  let stopped = false
  let removed = false
  const stop = () => {
    if (stopped || removed) return
    stopped = true
    button.disabled = true
    progress.textContent = t('queue', 'overlay_stopped')
    try {
      onStop()
    } catch (e) {
      console.warn('[tube] queue overlay: onStop failed', e)
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || removed) return
    e.preventDefault()
    e.stopPropagation()
    stop()
  }
  button.addEventListener('click', stop)
  view.addEventListener('keydown', onKey, true)
  ;(doc.body ?? doc.documentElement).append(host)
  return {
    status(s: string) {
      if (!removed && !stopped) progress.textContent = s
    },
    remove() {
      if (removed) return
      removed = true
      view.removeEventListener('keydown', onKey, true)
      host.remove()
    }
  }
}

// ------------------------------------------------------------------ execution

/** Runs a queue item on this page. Never throws; when in doubt, `failed` without clicking. */
export async function executeQueueItem(req: QueueExecuteRequest, opts: ExecuteOptions = {}): Promise<QueueExecuteResult> {
  const doc = opts.doc ?? document
  const url = opts.url ?? doc.defaultView?.location?.href ?? ''
  const tmo: StepTimeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts }
  const ctrl = new AbortController()
  const signal = ctrl.signal

  // coherent request? (the background already validated; this is defense)
  if (!req || (req.action !== 'unsubscribe' && req.action !== 'resubscribe')) return fail('invalid_item')
  const fromUrl = channelIdFromUrl(req.channel_url)
  const fromId = typeof req.channel_id === 'string' && CHANNEL_ID.test(req.channel_id) ? req.channel_id : null
  if ((req.channel_id !== undefined && !fromId) || (fromId && fromUrl && fromId !== fromUrl)) return fail('invalid_item')
  const expected = fromId ?? fromUrl
  if (!expected) return fail('invalid_item')

  const overlay =
    opts.overlay === false
      ? null
      : showQueueOverlay(doc, req, () => {
          ctrl.abort()
          void requestQueueStop('overlay').catch(() => undefined)
        })
  const channel = (typeof req.channel_title === 'string' && req.channel_title) || expected
  let result: QueueExecuteResult
  try {
    result = await run(doc, url, req.action, expected, tmo, signal)
  } catch (e) {
    console.warn('[tube] queue.execute failed', errorMessage(e))
    result = signal.aborted ? fail('stopped') : fail('page_error')
  }
  overlay?.status(t('queue', result.status === 'done' ? 'overlay_result_done' : 'overlay_result_failed', { channel, reason: t('queue', `reason_${result.error ?? 'none'}`) }))
  return result
}

async function run(doc: Document, url: string, action: 'unsubscribe' | 'resubscribe', expected: string, tmo: StepTimeouts, signal: AbortSignal): Promise<QueueExecuteResult> {
  // 1. where we are (tab URL): login, challenge, another channel
  if (/^https:\/\/accounts\.google\.com\//.test(url)) return fail('logged_out')
  if (detectChallenge(doc, url)) return fail('challenge')
  const urlId = channelIdFromUrl(url)
  if (urlId && urlId !== expected) return fail('wrong_channel')

  // 2. page ready: logged-out/challenge signal, or identity + (mismatch or button)
  await waitUntil(
    doc,
    () => {
      if (detectLogin(doc) === 'out' || detectChallenge(doc, url)) return true
      const ids = readPageChannelIds(doc)
      if (!ids.length) return false
      return ids.some((id) => id !== expected) || findSubscribeButton(doc) !== null
    },
    tmo.ready,
    signal
  )
  if (signal.aborted) return fail('stopped')
  if (detectLogin(doc) === 'out') return fail('logged_out')
  if (detectChallenge(doc, url)) return fail('challenge')

  // 3. identity: at least one source, all equal to the item. Otherwise no click.
  const ids = readPageChannelIds(doc)
  if (!ids.length || ids.some((id) => id !== expected)) return fail('wrong_channel')

  // 4. header button and current state
  const button = findSubscribeButton(doc)
  if (!button) return fail('button_not_found')
  const state = subscriptionState(button)
  if (state === 'unknown') return fail('button_not_found')
  const target = action === 'unsubscribe' ? 'not_subscribed' : 'subscribed'
  if (state === target) return done(action === 'unsubscribe' ? 'not_subscribed' : 'already_subscribed')

  // 5. click(s). The confirmation must name this channel (read now, before anything opens)
  const names = pageChannelNames(doc)
  const dialogsBefore = shownSet(doc, DIALOGS)
  const menusBefore = shownSet(doc, MENUS)
  if (signal.aborted) return fail('stopped')
  button.click()

  if (action === 'unsubscribe') {
    type Next = { kind: 'confirm'; el: HTMLElement } | { kind: 'menu'; el: HTMLElement }
    const next = await waitUntil<Next>(
      doc,
      () => {
        const c = newConfirm(doc, dialogsBefore, names)
        if (c) return { kind: 'confirm', el: c }
        const m = newMenuItem(doc, menusBefore)
        return m ? { kind: 'menu', el: m } : null
      },
      tmo.dialog,
      signal
    )
    if (signal.aborted) return fail('stopped')
    if (!next) return fail('confirm_not_found')
    let confirm: HTMLElement | null = next.kind === 'confirm' ? next.el : null
    if (next.kind === 'menu') {
      const before = shownSet(doc, DIALOGS)
      next.el.click()
      confirm = await waitUntil(doc, () => newConfirm(doc, before, names), tmo.dialog, signal)
      if (signal.aborted) return fail('stopped')
      if (!confirm) return fail('confirm_not_found')
    }
    if (signal.aborted) return fail('stopped')
    confirm!.click()
  }

  // 6. verification: the header button changed state (after the click there is no "Stop": it says what happened)
  const never = new AbortController().signal
  const changed = await waitUntil(
    doc,
    () => {
      const b = findSubscribeButton(doc)
      return b !== null && subscriptionState(b) === target
    },
    tmo.verify,
    never
  )
  return changed ? done() : fail('state_unchanged')
}

export const unsubscribe: ContentModule = {
  MODULE,
  ROUTES,
  REAL_ROUTES,
  COMMANDS: ['queue.execute'],
  /** never attaches on its own: only the background command (item coming from `GET /ext/queue`) */
  matches: () => false,
  start() {},
  commands: {
    'queue.execute': (payload) => executeQueueItem(payload as QueueExecuteRequest)
  }
}
