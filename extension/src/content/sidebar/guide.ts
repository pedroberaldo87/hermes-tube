// content/sidebar — YouTube's left guide: find it, put the section in place, measure and observe.
//
// All that is read from the page is this: where `ytd-guide-renderer #sections` and `ytd-mini-guide-renderer #items` are, which
// section is the subscriptions one (link to /feed/channels or entries with a channel avatar) and the computed style of a
// neighboring entry (height, radius, indent, font, section line) to align pixel by pixel. No page text.
//
// Measured on the real www.youtube.com (anonymous test Chrome, 1440 × 900) — the default values below:
//   section `ytd-guide-section-renderer`: padding 12px, `border-bottom: 1px solid rgba(0,0,0,.2)`, width 240
//   entry `ytd-guide-entry-renderer`: 204 × 40 at 12 px from the edge (12 left over on the right), radius 10
//   `tp-yt-paper-item`: padding 0 12px; icon 24 × 24 with right margin 24 (title starts at x = 72)
//   title: Roboto, Arial, sans-serif · 14px/20px · 400 (active 500) · #0f0f0f light / #f1f1f1 dark
//   section header (`#guide-section-title`): 16px/22px · 500 · padding 6px 12px 4px (h3 with 32 px)
//   active/hover: rgba(0,0,0,.05) light / rgba(255,255,255,.1) dark; new-content dot #065fd4 / #3ea6ff
//   mini-guide: 72 px (padding 0 4px); entry 64 × 76, radius 10, `a` with padding 16px 0 14px, icon 24 + 6, title 10/16

export const SECTION_TAG = 'tube-guide-section'
export const MINI_TAG = 'tube-guide-mini'
export const PANEL_TAG = 'tube-guide-panel'

const OURS = new Set([SECTION_TAG.toUpperCase(), MINI_TAG.toUpperCase(), PANEL_TAG.toUpperCase()])

export interface GuideMetrics {
  rowH: number
  rowEnd: number
  radius: number
  padX: number
  icon: number
  iconGap: number
  font: string
  fs: number
  lh: number
  secPad: string
  sepBorder: string
  headFs: number
  headLh: number
  /** informational only (diagnostics): the bar's colors come from the per-theme palette, equal to the measured ones */
  text: string | null
  accent: string | null
}

export const DEFAULT_METRICS: GuideMetrics = {
  rowH: 40,
  rowEnd: 12,
  radius: 10,
  padX: 12,
  icon: 24,
  iconGap: 24,
  font: 'Roboto, Arial, sans-serif',
  fs: 14,
  lh: 20,
  secPad: '12px',
  sepBorder: '',
  headFs: 16,
  headLh: 22,
  text: null,
  accent: null
}

export function guideSections(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('tp-yt-app-drawer#guide ytd-guide-renderer #sections') ?? doc.querySelector<HTMLElement>('ytd-guide-renderer #sections')
}

export function miniItems(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('ytd-mini-guide-renderer #items')
}

const isSection = (el: Element) => el.tagName === 'YTD-GUIDE-SECTION-RENDERER'

const hrefOf = (entry: Element) => entry.querySelector('a')?.getAttribute('href') ?? ''

/** Subscriptions section: has the subscriptions link (/feed/channels) or channel entries with a
 *  visible avatar (the "Explore" section also points to /channel/… but uses an icon, with the avatar hidden). */
export function subscriptionsSection(sections: Element): Element | null {
  const list = [...sections.children].filter(isSection)
  for (const s of list) if (s.querySelector('a[href^="/feed/channels"]')) return s
  for (const s of list) {
    const avatars = [...s.querySelectorAll('ytd-guide-entry-renderer')].filter((e) => {
      const img = e.querySelector('yt-img-shadow')
      return /^\/(@|channel\/)/.test(hrefOf(e)) && img !== null && !img.hasAttribute('hidden')
    })
    if (avatars.length > 0) return s
  }
  return null
}

/** How many of YouTube's own sections may sit above Subscriptions for "right above it" to still be in view. */
const SUBS_NEAR_TOP = 2

/** Puts (or keeps) the section right above Subscriptions when that is near the top of the guide; otherwise (no such
 *  section, or YouTube lists it far down, below the fold) right after the first section. Returns whether it moved anything. */
export function placeSection(sections: Element, host: Element): boolean | null {
  const found = subscriptionsSection(sections)
  const subs = found && [...sections.children].filter(isSection).indexOf(found) <= SUBS_NEAR_TOP ? found : null
  if (subs) {
    if (host.parentElement === sections && host.nextElementSibling === subs) return false
    sections.insertBefore(host, subs)
    return true
  }
  const first = [...sections.children].find(isSection)
  if (!first) return null
  if (host.parentElement === sections && first.nextElementSibling === host) return false
  first.after(host)
  return true
}

/** Mini-guide: after Subscriptions; otherwise before "You"; otherwise at the end. */
export function placeMini(items: Element, host: Element): boolean {
  const entries = [...items.children].filter((e) => !OURS.has(e.tagName))
  const subs = entries.find((e) => hrefOf(e) === '/feed/subscriptions')
  if (subs) {
    if (subs.nextElementSibling === host) return false
    subs.after(host)
    return true
  }
  const you = entries.find((e) => hrefOf(e).startsWith('/feed/you'))
  if (you) {
    if (you.previousElementSibling === host) return false
    you.before(host)
    return true
  }
  if (items.lastElementChild === host) return false
  items.append(host)
  return true
}

const px = (v: string | null | undefined, min: number, max: number, fallback: number): number => {
  const n = v ? parseFloat(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : fallback
}

/** Only sufficiently opaque `rgb()/rgba()`; transparent (alpha 0) will not do. */
function color(v: string | null | undefined): string | null {
  const s = v?.trim() ?? ''
  const m = /^rgba?\(([\d\s.,%]+)\)$/.exec(s)
  if (!m) return null
  const parts = m[1].split(',').map((p) => parseFloat(p))
  if (parts.length === 4 && !(parts[3] > 0)) return null
  return s
}

/** Reads the computed style of a neighboring entry; any odd value falls back to the measured default. */
export function measureGuide(sections: Element): GuideMetrics {
  const m: GuideMetrics = { ...DEFAULT_METRICS }
  const view = sections.ownerDocument.defaultView
  if (!view) return m
  const entries = [...sections.querySelectorAll('ytd-guide-entry-renderer')].filter((e) => !e.closest(SECTION_TAG))
  const entry = entries.find((e) => !e.hasAttribute('active') && e.querySelector('yt-img-shadow[hidden]')) ?? entries[0]
  if (!entry) return m
  const cs = (el: Element | null) => (el ? view.getComputedStyle(el) : null)
  const es = cs(entry)
  const rect = entry.getBoundingClientRect()
  m.rowH = px(es?.height === 'auto' ? `${rect.height}` : es?.height, 28, 64, rect.height >= 28 && rect.height <= 64 ? rect.height : m.rowH)
  m.radius = px(es?.borderTopLeftRadius, 0, 24, m.radius)
  const item = cs(entry.querySelector('tp-yt-paper-item'))
  m.padX = px(item?.paddingLeft, 0, 32, m.padX)
  const icon = cs(entry.querySelector('yt-icon.guide-icon, yt-icon'))
  m.icon = px(icon?.width, 16, 32, m.icon)
  m.iconGap = px(icon?.marginRight, 8, 40, m.iconGap)
  const title = cs(entry.querySelector('.title, yt-formatted-string'))
  if (title?.fontFamily && title.fontFamily.length < 120) m.font = title.fontFamily
  m.fs = px(title?.fontSize, 11, 18, m.fs)
  m.lh = px(title?.lineHeight, 14, 26, m.lh)
  m.text = color(title?.color)
  m.accent = color(cs(entry.querySelector('#newness-dot'))?.backgroundColor)
  const sec = entry.closest('ytd-guide-section-renderer')
  const ss = cs(sec)
  if (ss) {
    const pads = [ss.paddingTop, ss.paddingRight, ss.paddingBottom, ss.paddingLeft].map((v) => px(v, 0, 32, 12))
    m.secPad = pads.map((p) => `${p}px`).join(' ')
    const bw = px(ss.borderBottomWidth, 0, 4, 0)
    const bc = ss.borderBottomColor
    if (bw > 0 && ss.borderBottomStyle && ss.borderBottomStyle !== 'none' && /^rgba?\(/.test(bc ?? '')) m.sepBorder = `${bw}px ${ss.borderBottomStyle} ${bc}`
    const secRect = sec!.getBoundingClientRect()
    const inner = secRect.width - pads[1] - pads[3]
    if (rect.width > 0 && inner > 0) {
      const end = inner - (rect.left - secRect.left - pads[3]) - rect.width
      if (end >= 0 && end <= 48) m.rowEnd = Math.round(end * 10) / 10
    }
  }
  const head = cs(sections.querySelector('ytd-guide-section-renderer h3:not([hidden]) #guide-section-title'))
  m.headFs = px(head?.fontSize, 12, 22, m.headFs)
  m.headLh = px(head?.lineHeight, 14, 30, m.headLh)
  return m
}

export function metricsCss(m: GuideMetrics): string {
  const lines = [
    `--g-row-h:${m.rowH}px`,
    `--g-row-end:${m.rowEnd}px`,
    `--g-radius:${m.radius}px`,
    `--g-pad-x:${m.padX}px`,
    `--g-icon:${m.icon}px`,
    `--g-icon-gap:${m.iconGap}px`,
    `--g-font:${m.font.replace(/[;{}<>]/g, '')}`,
    `--g-fs:${m.fs}px`,
    `--g-lh:${m.lh}px`,
    `--g-sec-pad:${m.secPad}`,
    `--g-head-fs:${m.headFs}px`,
    `--g-head-lh:${m.headLh}px`
  ]
  if (m.sepBorder) lines.push(`--m-sep:${m.sepBorder}`)
  return `:host{${lines.join(';')}}`
}

/** The guide drawer is open (or there is no drawer: the guide is always in view). */
export function drawerOpen(host: Element): boolean {
  const drawer = host.closest('tp-yt-app-drawer')
  return !drawer || drawer.hasAttribute('opened')
}

export function miniVisible(host: Element): boolean {
  const mini = host.closest('ytd-mini-guide-renderer')
  return Boolean(mini) && !mini!.hasAttribute('hidden')
}

/** Right edge of the guide (for the pane to abut it); 0 when there is no layout (jsdom). */
export function guideEdge(host: Element, kind: 'section' | 'mini'): number {
  const box = kind === 'section' ? (host.closest('#contentContainer') ?? host.parentElement) : host.closest('ytd-mini-guide-renderer')
  const r = box?.getBoundingClientRect()
  return r && r.right > 0 ? r.right : kind === 'section' ? 240 : 72
}

export function mastheadBottom(doc: Document): number {
  const r = doc.querySelector('#masthead-container')?.getBoundingClientRect()
  return r && r.bottom > 0 && r.bottom < 200 ? r.bottom : 56
}

/**
 * Observes only what is needed: the theme (`html[dark]`), the guide drawer (subtree), the mini-guide, the attributes of
 * `ytd-app` and whatever holds the drawer (drawer swap). Before the guide exists, observes the document until it shows up.
 */
export function watchGuide(doc: Document, onChange: () => void): { retarget(): void; dispose(): void; booting(): boolean } {
  let targets: Element[] = []
  let boot = false
  const mo = new MutationObserver(() => onChange())

  function wanted(): Array<[Element, MutationObserverInit]> {
    const out: Array<[Element, MutationObserverInit]> = [[doc.documentElement, { attributes: true, attributeFilter: ['dark'] }]]
    const sections = guideSections(doc)
    const drawer = sections?.closest('tp-yt-app-drawer') ?? null
    const mini = doc.querySelector('ytd-mini-guide-renderer')
    const app = doc.querySelector('ytd-app')
    if (drawer) {
      out.push([drawer, { childList: true, subtree: true, attributes: true, attributeFilter: ['opened', 'persistent'] }])
      if (drawer.parentElement) out.push([drawer.parentElement, { childList: true }])
    } else if (sections?.parentElement) {
      out.push([sections.parentElement, { childList: true, subtree: true }])
    }
    if (mini) out.push([mini, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'mini-guide-visible'] }])
    if (app) out.push([app, { attributes: true, attributeFilter: ['mini-guide-visible', 'guide-persistent-and-visible'] }])
    // guide not drawn yet: the whole document until it shows up (afterwards only the drawer and whatever holds it)
    boot = !sections
    if (boot) out.push([doc.body ?? doc.documentElement, { childList: true, subtree: true }])
    return out
  }

  function retarget(): void {
    const next = wanted()
    const same = next.length === targets.length && next.every(([el], i) => el === targets[i] && el.isConnected)
    if (same) return
    mo.disconnect()
    targets = next.map(([el]) => el)
    for (const [el, init] of next) mo.observe(el, init)
  }

  retarget()
  return {
    retarget,
    /** observing the whole document (guide not drawn yet) */
    booting: () => boot,
    dispose() {
      mo.disconnect()
      targets = []
    }
  }
}
