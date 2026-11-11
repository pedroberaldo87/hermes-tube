// Hermes sidebar inside youtube.com (content/sidebar), in jsdom over the guide's HTML.
//
// The HTML below is YouTube's left guide as the app leaves it in the DOM (saved from www.youtube.com with
// an anonymous test Chrome; SVG icons, build comments and `style-scope` classes removed). The subscriptions
// section with channels (only exists when logged in) follows the same entry template, with the "Subscriptions >" header that leads to
// /feed/channels and avatars (visible `yt-img-shadow`). Fixture in the test itself (tests/fixtures is read-only).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Envelope, ExtState, FeedItem, FeedPage } from '../../shared/api-types'
import type { ConnectionStatus } from '../../shared/ext-messages'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import type { ContentContext, ContentStateListener } from '../src/lib/content'
import { catalog, setLanguage, t } from '../src/lib/i18n'
import { REAL_ROUTES, ROUTES, SIDEBAR_TREE_KEY, createSidebarModule, sidebar } from '../src/content/sidebar/index'
import { chromeFake } from './setup-chrome'

// ------------------------------------------------------------------ saved guide HTML

const entry = (href: string | null, title: string, opts: { avatar?: boolean; active?: boolean; arrow?: boolean; dot?: boolean } = {}) => `
<ytd-guide-entry-renderer${opts.active ? ' active=""' : ''} line-end-style="${opts.dot ? 'dot' : 'none'}"><a id="endpoint" tabindex="-1" role="link"${href ? ` href="${href}"` : ''} title="${title}">
  <tp-yt-paper-item role="link" tabindex="0">
    <yt-icon class="guide-icon"${opts.avatar ? ' hidden=""' : ''}><span><div><svg></svg></div></span></yt-icon>
    <yt-img-shadow height="24" width="24"${opts.avatar ? '' : ' hidden=""'}><img id="img" draggable="false" alt="" height="24" width="24"></yt-img-shadow>
    <yt-formatted-string class="title">${title}</yt-formatted-string>
    <yt-icon class="arrow-icon" icon="chevron_right" size="16"${opts.arrow ? '' : ' hidden=""'}></yt-icon>
    <span class="guide-entry-count">  </span>
    <yt-icon class="guide-entry-badge" size="16"></yt-icon>
    <div id="newness-dot"></div>
  </tp-yt-paper-item>
</a></ytd-guide-entry-renderer>`

const section = (title: string | null, items: string, id = '') => `
<ytd-guide-section-renderer${id ? ` data-test="${id}"` : ''} guide-persistent-and-visible=""><h3${title ? '' : ' hidden=""'}>
  <yt-formatted-string id="guide-section-title" link-inherit-color="">${title ?? ''}</yt-formatted-string>
</h3>
<div id="items">${items}</div>
</ytd-guide-section-renderer>`

const HOME_SECTION = section(
  null,
  entry('/', 'Início', { active: true }) + entry(null, 'Shorts') + entry('/feed/subscriptions', 'Inscrições'),
  'home'
)
const YOU_SECTION = section(null, entry('/feed/you', 'Você', { arrow: true }) + entry('/feed/history', 'Histórico'), 'you')
const SUBS_SECTION = section(
  null,
  entry('/feed/channels', 'Inscrições', { arrow: true }) +
    entry('/@Fireship', 'Fireship', { avatar: true, dot: true }) +
    entry('/@veritasium', 'Veritasium', { avatar: true }) +
    entry('/channel/UCsBjURrPoezykLs9EqgamOA', 'Fireship 2', { avatar: true }),
  'subs'
)
const EXPLORE_SECTION = section(
  'Explorar',
  entry('/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ', 'Música') + entry('/feed/storefront?bp=ogUCKAU%3D', 'Filmes'),
  'explore'
)

const miniEntry = (href: string, title: string) =>
  `<ytd-mini-guide-entry-renderer><a id="endpoint" aria-label="${title}" title="${title}" href="${href}"><yt-icon id="icon" class="guide-icon"></yt-icon><span class="title">${title}</span></a></ytd-mini-guide-entry-renderer>`

const MINI = `<ytd-mini-guide-renderer role="navigation" mini-guide-visible=""><div id="items">${
  miniEntry('/', 'Início') + miniEntry('/shorts/', 'Shorts') + miniEntry('/feed/subscriptions', 'Inscrições') + miniEntry('/feed/you', 'Você')
}</div></ytd-mini-guide-renderer>`

const page = (sections: string, opts: { drawer?: 'persistent' | 'closed' | 'open'; mini?: boolean } = {}) => {
  const drawer = opts.drawer ?? 'persistent'
  const attrs = drawer === 'persistent' ? ' opened="" persistent=""' : drawer === 'open' ? ' opened=""' : ''
  return `<ytd-app${drawer === 'persistent' ? ' guide-persistent-and-visible=""' : ''}><div id="content">
<div id="masthead-container"></div>
<tp-yt-app-drawer id="guide" align="start" role="navigation" position="left"${attrs}><div id="contentContainer"><div id="guide-wrapper"><div id="guide-content"><div id="guide-inner-content">
<ytd-guide-renderer id="guide-renderer"><div id="sections">${sections}</div></ytd-guide-renderer>
</div></div></div></div></tp-yt-app-drawer>
${opts.mini === false ? '' : MINI}
<div id="page-manager"><a id="outside" href="/x">outside</a><p id="plain">page text</p></div>
</div></ytd-app>`
}

const LOGGED_IN = page(HOME_SECTION + YOU_SECTION + SUBS_SECTION + EXPLORE_SECTION)

// ------------------------------------------------------------------ fake state and context

const baseState = (over: Partial<ExtState> = {}): ExtState => ({
  new_total: 12,
  tabs: [
    { tab_id: 'all-new', name: 'Tudo novo', count: 12, icon: null },
    { tab_id: 'favs', name: 'Favoritos', count: 0, icon: null }
  ],
  folders: [
    { folder_id: 'f_tech', name: 'Tech', count: 9, parent_id: null },
    { folder_id: 'f_rust', name: 'Rust', count: 5, parent_id: 'f_tech' },
    { folder_id: 'f_async', name: 'Async', count: 2, parent_id: 'f_rust' },
    { folder_id: 'f_music', name: 'Música', count: 0, parent_id: null }
  ],
  search_pending: 0,
  queue_pending: 0,
  home_on_youtube: false,
  extras_honest_thumbnails: false,
  extras_hn_lens: false,
  extras_hn_channels: false,
  extras_import_lists: false,
  refresh_running: false,
  last_rss_at: 1762700000,
  language: 'en',
  device_id: 'dev_1',
  server_time: 1762700100,
  ...over
})

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0)

const video = (id: string, title: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  video: {
    id,
    channel_id: 'UCsBjURrPoezykLs9EqgamOA',
    title,
    published_at: NOW / 1000 - 3 * 3600,
    description: null,
    channel_title: 'Fireship',
    duration_s: 754,
    is_short: false,
    views: null,
    first_seen_at: NOW / 1000 - 3600,
    origin: 'rss'
  },
  channel: null,
  state: 'new',
  reaction: null,
  is_new: true,
  why: { via: 'folder', label: 'Tech', detail: null },
  badges: [],
  ...extra
})

const feedPage = (items: FeedItem[], next_cursor: string | null = null): FeedPage => ({ items, next_cursor, counts: { total: items.length, new: items.length } })

type Handler = (payload: unknown) => Envelope<unknown> | Promise<Envelope<unknown>>

interface World {
  ctx: ContentContext
  sent: Array<[string, unknown]>
  emit(state: ExtState | null): void
  handlers: Record<string, Handler>
  roots: Record<string, ShadowRoot>
  mod: ReturnType<typeof createSidebarModule>
}

const okEnv = <T>(data: T): Envelope<T> => ({ ok: true, data }) as Envelope<T>
const conn = (state: ConnectionStatus['state']): ConnectionStatus => ({ state, port: 47615, device_id: 'dev_1', last_ok_at: null, error: null })

function world(state: ExtState = baseState(), handlers: Record<string, Handler> = {}): World {
  const listeners = new Set<ContentStateListener>()
  const sent: Array<[string, unknown]> = []
  const roots: Record<string, ShadowRoot> = {}
  const all: Record<string, Handler> = {
    'conn.status': () => okEnv(conn('connected')),
    'feed.get': () => okEnv(feedPage([video('aaaaaaaaaaa', 'Primeiro'), video('bbbbbbbbbbb', 'Segundo')])),
    'read.mark': () => okEnv({ changed: 2 }),
    'state.get': () => okEnv(null),
    ...handlers
  }
  const ctx: ContentContext = {
    url: new URL('https://www.youtube.com/'),
    state,
    send: (async (type: string, payload: unknown) => {
      sent.push([type, payload])
      const h = all[type]
      return h ? h(payload) : okEnv(null)
    }) as ContentContext['send'],
    t,
    onState(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
  const mod = createSidebarModule({ inspect: (kind, root) => (roots[kind] = root), now: () => NOW })
  return {
    ctx,
    sent,
    handlers: all,
    roots,
    mod,
    emit(s) {
      for (const cb of listeners) cb(s)
    }
  }
}

async function tick(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
  // with a fake clock the fake chrome's flush (setTimeout) does not advance: only the microtasks
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
  else await chromeFake().flush()
}

async function started(state?: ExtState, handlers?: Record<string, Handler>, html = LOGGED_IN): Promise<World> {
  document.body.innerHTML = html
  const w = world(state, handlers)
  await w.mod.start(w.ctx)
  await tick()
  return w
}

const hosts = (tag: string) => document.querySelectorAll(tag)
const sectionHost = () => document.querySelector('tube-guide-section')
const miniHost = () => document.querySelector('tube-guide-mini')
const subsSection = () => document.querySelector('[data-test="subs"]')
const row = (w: World, key: string) => w.roots.section.querySelector<HTMLElement>(`[data-key="${key}"]`)
const rows = (w: World) => [...w.roots.section.querySelectorAll<HTMLElement>('[role="treeitem"]')]
const countOf = (el: Element | null) => el?.querySelector('[data-part="count"]')?.textContent ?? null
const panel = (w: World) => w.roots.panel?.querySelector<HTMLElement>('[data-part="panel"]') ?? null
const panelOpen = (w: World) => Boolean(panel(w)) && !panel(w)!.hidden

function key(target: Element, k: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...opts })
  target.dispatchEvent(ev)
  return ev
}

function click(el: Element | null): void {
  if (!el) throw new Error('missing element')
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
  ;(el as HTMLElement).click()
}

const pageErrors: string[] = []
const onError = (e: ErrorEvent) => pageErrors.push(String(e.message || e.error))
const onRejection = (e: PromiseRejectionEvent) => pageErrors.push(String(e.reason))

let current: World | null = null

beforeEach(() => {
  setLanguage('en')
  document.documentElement.removeAttribute('dark')
  pageErrors.length = 0
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
})

afterEach(() => {
  current?.mod.stop()
  current = null
  window.removeEventListener('error', onError)
  window.removeEventListener('unhandledrejection', onRejection)
  document.body.innerHTML = ''
})

const go = async (state?: ExtState, handlers?: Record<string, Handler>, html?: string) => (current = await started(state, handlers, html))

// ------------------------------------------------------------------ module contract

describe('module', () => {
  it('real routes = the contract routes it uses; attaches only with state; sidebar namespace EN = PT-BR', () => {
    expect([...REAL_ROUTES].sort()).toEqual([...ROUTES].sort())
    expect(sidebar.matches(new URL('https://www.youtube.com/'), null)).toBe(false)
    expect(sidebar.matches(new URL('https://www.youtube.com/watch?v=x'), baseState())).toBe(true)
    const en = Object.keys(catalog('en', 'sidebar')).sort()
    expect(en.length).toBeGreaterThan(10)
    expect(Object.keys(catalog('pt-BR', 'sidebar')).sort()).toEqual(en)
  })
})

// ------------------------------------------------------------------ mounting

describe('mounting in the guide', () => {
  it('"HermesTube" section right above Subscriptions, once, in a closed Shadow DOM', async () => {
    const w = await go()
    expect(hosts('tube-guide-section')).toHaveLength(1)
    expect(sectionHost()!.nextElementSibling).toBe(subsSection())
    expect(sectionHost()!.shadowRoot).toBeNull() // closed: the page cannot read the content
    expect(w.roots.section.textContent).toContain('HermesTube')
    // the wing mark sits right before the name, in the section heading
    const head = w.roots.section.querySelector('.head')!
    expect(head.firstElementChild?.getAttribute('data-part')).toBe('wing')
    expect(head.firstElementChild?.querySelector('svg')).not.toBeNull()
    expect(head.firstElementChild?.nextElementSibling?.textContent).toBe('HermesTube')
    // nothing written to the page DOM besides the two host elements
    expect(document.querySelectorAll('script, style, link').length).toBe(0)
    expect(document.querySelector('[data-test="home"]')!.outerHTML).not.toContain('tube')
  })

  it('no subscriptions section (logged out): right after the first section', async () => {
    await go(undefined, undefined, page(HOME_SECTION + EXPLORE_SECTION))
    expect(sectionHost()!.previousElementSibling).toBe(document.querySelector('[data-test="home"]'))
  })

  it('subscriptions section far down the guide (seen on a real account): right after the first section, in view', async () => {
    const more = section('Mais do YouTube', entry('/premium', 'YouTube Premium'), 'more')
    const settings = section(null, entry('/reporthistory', 'Histórico de denúncias'), 'settings')
    const lateSubs = section(
      'Inscrições',
      entry('/feed/subscriptions', 'Inscrições') + entry('/@TED', 'TED', { avatar: true }) + entry('/@NASA', 'NASA', { avatar: true }),
      'late-subs'
    )
    const home = section(null, entry('/', 'Início', { active: true }) + entry(null, 'Shorts'), 'home')
    await go(undefined, undefined, page(home + YOU_SECTION + more + EXPLORE_SECTION + settings + lateSubs))
    expect(hosts('tube-guide-section')).toHaveLength(1)
    expect(sectionHost()!.previousElementSibling).toBe(document.querySelector('[data-test="home"]'))
    expect(sectionHost()!.nextElementSibling).toBe(document.querySelector('[data-test="you"]'))
  })

  it('the "Explore" section (YouTube channels with an icon) is not mistaken for subscriptions', async () => {
    await go(undefined, undefined, page(HOME_SECTION + YOU_SECTION + EXPLORE_SECTION))
    expect(sectionHost()!.nextElementSibling).not.toBe(document.querySelector('[data-test="explore"]'))
    expect(sectionHost()!.previousElementSibling).toBe(document.querySelector('[data-test="home"]'))
  })

  it('guide that does not exist yet: mounts when YouTube draws it', async () => {
    document.body.innerHTML = '<ytd-app><div id="content"></div></ytd-app>'
    const w = world()
    current = w
    await w.mod.start(w.ctx)
    await tick()
    expect(sectionHost()).toBeNull()
    document.querySelector('#content')!.innerHTML = LOGGED_IN.replace(/^<ytd-app[^>]*><div id="content">/, '').replace(/<\/div><\/ytd-app>$/, '')
    await tick()
    expect(hosts('tube-guide-section')).toHaveLength(1)
    expect(sectionHost()!.nextElementSibling).toBe(subsSection())
  })

  it('redrawn guide (sections swapped): goes back in place, without duplicating or remounting', async () => {
    const w = await go()
    const before = row(w, 'f:f_tech')
    document.querySelector('#sections')!.innerHTML = HOME_SECTION + SUBS_SECTION + EXPLORE_SECTION
    await tick()
    expect(hosts('tube-guide-section')).toHaveLength(1)
    expect(sectionHost()!.nextElementSibling).toBe(subsSection())
    expect(row(w, 'f:f_tech')).toBe(before)
  })

  it('whole guide renderer swapped: comes back', async () => {
    await go()
    const renderer = document.querySelector('ytd-guide-renderer')!
    const fresh = document.createElement('ytd-guide-renderer')
    fresh.innerHTML = `<div id="sections">${HOME_SECTION + SUBS_SECTION}</div>`
    renderer.replaceWith(fresh)
    await tick()
    expect(hosts('tube-guide-section')).toHaveLength(1)
    expect(sectionHost()!.nextElementSibling).toBe(subsSection())
  })

  it('SPA navigation (yt-navigate-finish) after the section vanished: comes back, only one', async () => {
    await go()
    sectionHost()!.remove()
    document.dispatchEvent(new Event('yt-navigate-finish'))
    await tick()
    expect(hosts('tube-guide-section')).toHaveLength(1)
    document.dispatchEvent(new Event('yt-navigate-finish'))
    await tick()
    expect(hosts('tube-guide-section')).toHaveLength(1)
  })

  it('collapsed guide (mini): only the icon with the total of new items, after Subscriptions', async () => {
    const w = await go()
    expect(hosts('tube-guide-mini')).toHaveLength(1)
    const subsMini = [...document.querySelectorAll('ytd-mini-guide-entry-renderer')].find((e) => e.querySelector('a')?.getAttribute('href') === '/feed/subscriptions')
    expect(miniHost()!.previousElementSibling).toBe(subsMini)
    expect(w.roots.mini.querySelector('[data-part="badge"]')!.textContent).toBe('12')
    expect(w.roots.mini.textContent).toContain('HermesTube')
    w.emit(baseState({ new_total: 0 }))
    await tick()
    expect(w.roots.mini.querySelector('[data-part="badge"]')).toBeNull()
  })

  it('video page (guide in a closed drawer): section mounted inside the drawer', async () => {
    await go(undefined, undefined, page(HOME_SECTION + SUBS_SECTION, { drawer: 'closed', mini: false }))
    expect(sectionHost()!.closest('tp-yt-app-drawer#guide')).not.toBeNull()
    expect(miniHost()).toBeNull()
  })

  it('follows YouTube light/dark (html[dark])', async () => {
    await go()
    expect(sectionHost()!.getAttribute('data-theme')).toBe('light')
    document.documentElement.setAttribute('dark', 'true')
    await tick()
    expect(sectionHost()!.getAttribute('data-theme')).toBe('dark')
    expect(miniHost()!.getAttribute('data-theme')).toBe('dark')
  })

  it('stop() removes everything from the page and stops observing', async () => {
    const w = await go()
    w.mod.stop()
    current = null
    expect(sectionHost()).toBeNull()
    expect(miniHost()).toBeNull()
    document.querySelector('#sections')!.innerHTML = HOME_SECTION + SUBS_SECTION
    document.dispatchEvent(new Event('yt-navigate-finish'))
    await tick()
    expect(sectionHost()).toBeNull()
  })
})

// ------------------------------------------------------------------ content

describe('section content', () => {
  it('tabs with counter, collapsed folder tree, total in the header, zero disappears', async () => {
    const w = await go()
    expect(rows(w).map((r) => r.getAttribute('data-key'))).toEqual(['t:all-new', 't:favs', 'f:f_tech', 'f:f_music'])
    expect(countOf(row(w, 't:all-new'))).toBe('12')
    expect(countOf(row(w, 't:favs'))).toBeNull()
    expect(countOf(row(w, 'f:f_tech'))).toBe('9')
    expect(countOf(row(w, 'f:f_music'))).toBeNull()
    expect(w.roots.section.querySelector('[data-part="total"]')!.textContent).toBe('12')
    expect(row(w, 'f:f_tech')!.getAttribute('aria-expanded')).toBe('false')
    expect(row(w, 'f:f_music')!.hasAttribute('aria-expanded')).toBe(false)
  })

  it('3-level tree: opens, counts recursively, remembers open/closed', async () => {
    const w = await go(
      baseState({
        folders: [
          { folder_id: 'f_tech', name: 'Tech', count: 1, parent_id: null },
          { folder_id: 'f_rust', name: 'Rust', count: 5, parent_id: 'f_tech' },
          { folder_id: 'f_async', name: 'Async', count: 2, parent_id: 'f_rust' }
        ]
      })
    )
    expect(countOf(row(w, 'f:f_tech'))).toBe('5') // parent never smaller than the children
    click(row(w, 'f:f_tech')!.querySelector('[data-part="toggle"]'))
    await tick()
    expect(row(w, 'f:f_tech')!.getAttribute('aria-expanded')).toBe('true')
    expect(row(w, 'f:f_rust')!.getAttribute('aria-level')).toBe('2')
    click(row(w, 'f:f_rust')!.querySelector('[data-part="toggle"]'))
    await tick()
    expect(row(w, 'f:f_async')!.getAttribute('aria-level')).toBe('3')
    expect(countOf(row(w, 'f:f_async'))).toBe('2')
    expect(chromeFake().storage.get(SIDEBAR_TREE_KEY)).toEqual({ expanded: ['f_tech', 'f_rust'] })
    expect(w.sent.filter(([type]) => type === 'feed.get')).toHaveLength(0) // opening/closing does not open the pane

    // another page load: back to how it was
    w.mod.stop()
    const w2 = await go(baseState({ folders: w.ctx.state!.folders }))
    expect(row(w2, 'f:f_async')).not.toBeNull()
  })

  it('counters update without remounting (same nodes)', async () => {
    const w = await go()
    const tech = row(w, 'f:f_tech')
    const tabRow = row(w, 't:all-new')
    w.emit(baseState({ new_total: 20, tabs: [{ tab_id: 'all-new', name: 'Tudo novo', count: 20, icon: null }, { tab_id: 'favs', name: 'Favoritos', count: 3, icon: null }] }))
    await tick()
    expect(row(w, 'f:f_tech')).toBe(tech)
    expect(row(w, 't:all-new')).toBe(tabRow)
    expect(countOf(tabRow)).toBe('20')
    expect(countOf(row(w, 't:favs'))).toBe('3')
    expect(w.roots.section.querySelector('[data-part="total"]')!.textContent).toBe('20')
    expect(hosts('tube-guide-section')).toHaveLength(1)
  })

  it('discreet indicator while refresh_running', async () => {
    const w = await go(baseState({ refresh_running: true }))
    const ind = w.roots.section.querySelector('[data-part="refreshing"]')
    expect(ind).not.toBeNull()
    expect(ind!.getAttribute('aria-label')).toBe(t('sidebar', 'refreshing'))
    w.emit(baseState({ refresh_running: false }))
    await tick()
    expect(w.roots.section.querySelector('[data-part="refreshing"]')).toBeNull()
  })

  it('empty state: one line that teaches how to organize in Hermes', async () => {
    const w = await go(baseState({ tabs: [], folders: [], new_total: 0 }))
    expect(rows(w)).toHaveLength(0)
    expect(w.roots.section.querySelector('[data-part="empty"]')!.textContent).toBe(t('sidebar', 'empty_hint'))
  })

  it('disconnected: "Open Hermes to reconnect", tree kept in a muted tone; comes back on reconnect', async () => {
    let status: ConnectionStatus['state'] = 'reconnect_needed'
    const w = await go(undefined, { 'conn.status': () => okEnv(conn(status)) })
    const note = w.roots.section.querySelector('[data-part="conn"]')
    expect(note!.textContent).toBe(t('sidebar', 'disconnected'))
    expect(w.roots.section.querySelector('[data-part="section"]')!.getAttribute('data-off')).toBe('true')
    expect(rows(w)).toHaveLength(4)
    status = 'connected'
    // the credential changed state: the content script only listens to the key, never reads the value
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: { status: { state: 'connected' } } })
    await tick()
    expect(w.roots.section.querySelector('[data-part="conn"]')).toBeNull()
    expect(w.roots.section.querySelector('[data-part="section"]')!.hasAttribute('data-off')).toBe(false)
  })

  it('token refused: own text', async () => {
    const w = await go(undefined, { 'conn.status': () => okEnv(conn('unauthorized')) })
    expect(w.roots.section.querySelector('[data-part="conn"]')!.textContent).toBe(t('sidebar', 'unauthorized'))
  })

  it('language from ExtState.language (pt-BR)', async () => {
    setLanguage('pt-BR')
    const w = await go(baseState({ language: 'pt-BR', tabs: [], folders: [] }))
    expect(w.roots.section.querySelector('[data-part="empty"]')!.textContent).toBe(catalog('pt-BR', 'sidebar').empty_hint)
  })
})

// ------------------------------------------------------------------ untrusted data

describe('untrusted data', () => {
  it('folder/tab names, title and channel are text, never HTML', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">'
    const w = await go(
      baseState({ tabs: [{ tab_id: 't<b>', name: evil, count: 1, icon: '<svg onload=alert(1)>' }], folders: [{ folder_id: 'f1', name: evil, count: 1, parent_id: null }] }),
      {
        'feed.get': () =>
          okEnv(
            feedPage([
              video('ccccccccccc', evil, { channel: null, why: { via: 'folder', label: evil, detail: null } }),
              video('javascript:alert(1)', 'link ruim'),
              video('ddddddddddd"><script>', 'id ruim')
            ])
          )
      }
    )
    expect(w.roots.section.querySelector('img')).toBeNull()
    expect(w.roots.section.textContent).toContain(evil)
    click(row(w, 'f:f1'))
    await tick()
    const p = panel(w)!
    expect(p.textContent).toContain(evil)
    expect(p.querySelectorAll('img').length).toBe(1) // only the thumbnail of the valid video
    expect(p.querySelector('img')!.getAttribute('src')).toBe('https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg')
    const links = [...p.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['https://www.youtube.com/watch?v=ccccccccccc'])
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    expect(p.querySelector('script')).toBeNull()
  })

  it('internal exception does not leak: the section disappears silently and the page carries on', async () => {
    const w = await go(undefined, {
      'feed.get': () => {
        throw new Error('internal boom')
      }
    })
    // send that throws synchronously
    w.ctx.send = (() => {
      throw new Error('send broke')
    }) as unknown as ContentContext['send']
    click(row(w, 'f:f_tech'))
    await tick()
    expect(pageErrors).toEqual([])
    expect(sectionHost()).toBeNull()
    expect(document.querySelector('#plain')!.textContent).toBe('page text')
  })

  it('error right at start (broken text): nothing mounted, start does not throw', async () => {
    document.body.innerHTML = LOGGED_IN
    const w = world()
    current = w
    w.ctx.t = (() => {
      throw new Error('i18n broke')
    }) as unknown as ContentContext['t']
    await expect(Promise.resolve(w.mod.start(w.ctx))).resolves.toBeUndefined()
    await tick()
    expect(sectionHost()).toBeNull()
    expect(pageErrors).toEqual([])
  })

  it('keys inside the section do not reach YouTube\'s shortcuts', async () => {
    const w = await go()
    const seen: string[] = []
    document.addEventListener('keydown', (e) => seen.push(e.key))
    row(w, 't:all-new')!.focus()
    key(row(w, 't:all-new')!, 'k')
    key(row(w, 't:all-new')!, 'ArrowDown')
    expect(seen).toEqual([])
  })
})

// ------------------------------------------------------------------ pane

describe('pane next to the guide', () => {
  it('click on a folder → feed.get and videos with thumbnail, title, channel, age and "why it is here"', async () => {
    const w = await go()
    click(row(w, 'f:f_tech'))
    await tick()
    expect(w.sent.find(([type]) => type === 'feed.get')![1]).toEqual({ folder: 'f_tech', limit: 20 })
    expect(panelOpen(w)).toBe(true)
    const cards = [...panel(w)!.querySelectorAll('[data-part="video"]')]
    expect(cards).toHaveLength(2)
    const first = cards[0]
    expect(first.getAttribute('href')).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa')
    expect(first.querySelector('[data-part="title"]')!.textContent).toBe('Primeiro')
    expect(first.querySelector('[data-part="channel"]')!.textContent).toBe('Fireship')
    expect(first.querySelector('[data-part="age"]')!.textContent).toBe('3 hours ago')
    expect(first.querySelector('[data-part="why"]')!.textContent).toBe('Tech')
    expect(first.querySelector('[data-part="duration"]')!.textContent).toBe('12:34')
    expect(panel(w)!.querySelector('[data-part="heading"]')!.textContent).toBe('Tech')
    expect(row(w, 'f:f_tech')!.getAttribute('aria-selected')).toBe('true')
  })

  it('tab → feed.get {tab}', async () => {
    const w = await go()
    click(row(w, 't:all-new'))
    await tick()
    expect(w.sent.find(([type]) => type === 'feed.get')![1]).toEqual({ tab: 'all-new', limit: 20 })
  })

  it('skeleton while loading; load more by cursor; disappears at the end', async () => {
    let release: (v: Envelope<FeedPage>) => void = () => undefined
    const pages: Array<Envelope<FeedPage> | Promise<Envelope<FeedPage>>> = [
      new Promise((r) => (release = r)),
      okEnv(feedPage([video('eeeeeeeeeee', 'Terceiro')], null))
    ]
    const w = await go(undefined, { 'feed.get': () => pages.shift()! })
    click(row(w, 'f:f_tech'))
    await tick()
    expect(panel(w)!.querySelectorAll('[data-part="skeleton"]').length).toBeGreaterThan(0)
    expect(panel(w)!.querySelector('[data-part="list"]')!.getAttribute('aria-busy')).toBe('true')
    release(okEnv(feedPage([video('aaaaaaaaaaa', 'Primeiro'), video('bbbbbbbbbbb', 'Segundo')], 'CUR2')))
    await tick()
    expect(panel(w)!.querySelectorAll('[data-part="skeleton"]').length).toBe(0)
    const more = panel(w)!.querySelector<HTMLButtonElement>('[data-part="more"]')!
    expect(more.textContent).toBe(t('sidebar', 'load_more'))
    click(more)
    await tick()
    expect(w.sent.filter(([type]) => type === 'feed.get').at(-1)![1]).toEqual({ folder: 'f_tech', limit: 20, cursor: 'CUR2' })
    expect(panel(w)!.querySelectorAll('[data-part="video"]')).toHaveLength(3)
    expect(panel(w)!.querySelector('[data-part="more"]')).toBeNull()
  })

  it('empty: own message', async () => {
    const w = await go(undefined, { 'feed.get': () => okEnv(feedPage([])) })
    click(row(w, 'f:f_music'))
    await tick()
    expect(panel(w)!.querySelector('[data-part="empty"]')!.textContent).toContain(t('sidebar', 'feed_empty'))
  })

  it('error → "try again" asks again and shows the videos', async () => {
    let fail = true
    const w = await go(undefined, {
      'feed.get': () => (fail ? ({ ok: false, error: { code: 'ext_endpoint_down', message: 'down' } } as Envelope<FeedPage>) : okEnv(feedPage([video('aaaaaaaaaaa', 'Primeiro')])))
    })
    click(row(w, 'f:f_tech'))
    await tick()
    const err = panel(w)!.querySelector('[data-part="error"]')!
    expect(err.textContent).toContain(t('sidebar', 'feed_error'))
    fail = false
    click(err.querySelector('button'))
    await tick()
    expect(panel(w)!.querySelector('[data-part="error"]')).toBeNull()
    expect(panel(w)!.querySelectorAll('[data-part="video"]')).toHaveLength(1)
  })

  it('Esc closes and focus goes back to the entry', async () => {
    const w = await go()
    const tech = row(w, 'f:f_tech')!
    tech.focus()
    key(tech, 'Enter')
    await tick()
    expect(panelOpen(w)).toBe(true)
    const link = panel(w)!.querySelector<HTMLElement>('[data-part="video"]')!
    link.focus()
    key(link, 'Escape')
    await tick()
    expect(panelOpen(w)).toBe(false)
    expect(w.roots.section.activeElement).toBe(tech)
  })

  it('click outside closes; click inside the pane does not', async () => {
    const w = await go()
    click(row(w, 'f:f_tech'))
    await tick()
    click(panel(w)!.querySelector('[data-part="heading"]'))
    await tick()
    expect(panelOpen(w)).toBe(true)
    click(document.querySelector('#plain'))
    await tick()
    expect(panelOpen(w)).toBe(false)
  })

  it('close button closes and returns focus', async () => {
    const w = await go()
    click(row(w, 't:all-new'))
    await tick()
    click(panel(w)!.querySelector('[data-part="close"]'))
    await tick()
    expect(panelOpen(w)).toBe(false)
    expect(w.roots.section.activeElement).toBe(row(w, 't:all-new'))
  })

  it('guide drawer closes (video page) → pane closes', async () => {
    const w = await go(undefined, undefined, page(HOME_SECTION + SUBS_SECTION, { drawer: 'open', mini: false }))
    click(row(w, 'f:f_tech'))
    await tick()
    expect(panelOpen(w)).toBe(true)
    document.querySelector('tp-yt-app-drawer#guide')!.removeAttribute('opened')
    await tick()
    expect(panelOpen(w)).toBe(false)
  })

  it('mini: click on the icon → list of tabs and folders in the pane → choosing opens the videos; back', async () => {
    const w = await go()
    click(w.roots.mini.querySelector('[data-part="mini"]'))
    await tick()
    expect(panelOpen(w)).toBe(true)
    const pick = panel(w)!.querySelector<HTMLElement>('[data-pick="f:f_rust"]')!
    expect(pick.textContent).toContain('Rust')
    click(pick)
    await tick()
    expect(w.sent.find(([type]) => type === 'feed.get')![1]).toEqual({ folder: 'f_rust', limit: 20 })
    click(panel(w)!.querySelector('[data-part="back"]'))
    await tick()
    expect(panel(w)!.querySelector('[data-pick="t:all-new"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ keyboard

describe('keyboard', () => {
  it('arrows in the tree, → opens/enters, ← closes/goes up, Home/End; roving tabindex', async () => {
    const w = await go()
    const first = row(w, 't:all-new')!
    expect(first.getAttribute('tabindex')).toBe('0')
    expect(rows(w).filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1)
    first.focus()
    key(first, 'ArrowDown')
    expect(w.roots.section.activeElement).toBe(row(w, 't:favs'))
    key(row(w, 't:favs')!, 'ArrowDown')
    const tech = row(w, 'f:f_tech')!
    expect(w.roots.section.activeElement).toBe(tech)
    key(tech, 'ArrowRight')
    await tick()
    expect(tech.getAttribute('aria-expanded')).toBe('true')
    key(tech, 'ArrowRight')
    expect(w.roots.section.activeElement).toBe(row(w, 'f:f_rust'))
    key(row(w, 'f:f_rust')!, 'ArrowLeft')
    expect(w.roots.section.activeElement).toBe(tech)
    key(tech, 'ArrowLeft')
    await tick()
    expect(tech.getAttribute('aria-expanded')).toBe('false')
    key(tech, 'End')
    expect(w.roots.section.activeElement).toBe(row(w, 'f:f_music'))
    key(row(w, 'f:f_music')!, 'Home')
    expect(w.roots.section.activeElement).toBe(first)
    expect(first.getAttribute('tabindex')).toBe('0')
    expect(tech.getAttribute('tabindex')).toBe('-1')
  })

  it('Enter opens; Tab enters the pane; Shift+Tab on the first goes back to the entry', async () => {
    const w = await go()
    const tech = row(w, 'f:f_tech')!
    tech.focus()
    key(tech, 'Enter')
    await tick()
    expect(panelOpen(w)).toBe(true)
    expect(w.roots.section.activeElement).toBe(tech) // focus stays on the entry
    const ev = key(tech, 'Tab')
    expect(ev.defaultPrevented).toBe(true)
    const first = w.roots.panel.activeElement as HTMLElement
    expect(first).not.toBeNull()
    expect(first.getAttribute('data-part')).toBe('mark')
    key(first, 'Tab', { shiftKey: true })
    expect(w.roots.section.activeElement).toBe(tech)
  })
})

// ------------------------------------------------------------------ mark as read

describe('mark as read', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  async function openTech(): Promise<World> {
    const w = await go()
    click(row(w, 'f:f_tech'))
    await tick()
    return w
  }

  const reads = (w: World) => w.sent.filter(([type]) => type === 'read.mark')

  it('waits 5 s with Undo visible; then sends once and asks for the new state', async () => {
    const w = await openTech()
    click(panel(w)!.querySelector('[data-part="mark"]'))
    await tick()
    const bar = panel(w)!.querySelector('[data-part="undo-bar"]')!
    expect(bar.textContent).toContain(t('sidebar', 'marked_read'))
    expect(bar.querySelector('button')!.textContent).toBe(t('sidebar', 'undo'))
    await vi.advanceTimersByTimeAsync(4900)
    expect(reads(w)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    await tick()
    expect(reads(w)).toEqual([['read.mark', { kind: 'folder', id: 'f_tech' }]])
    const after = w.sent.slice(w.sent.findIndex(([type]) => type === 'read.mark'))
    expect(after.some(([type, p]) => type === 'state.get' && (p as { refresh?: boolean }).refresh === true)).toBe(true)
    await vi.advanceTimersByTimeAsync(20000)
    expect(reads(w)).toHaveLength(1)
  })

  it('Undo = do not send', async () => {
    const w = await openTech()
    click(panel(w)!.querySelector('[data-part="mark"]'))
    await tick()
    click(panel(w)!.querySelector('[data-part="undo-bar"] button'))
    await tick()
    await vi.advanceTimersByTimeAsync(10000)
    expect(reads(w)).toHaveLength(0)
    expect(panel(w)!.querySelector('[data-part="undo-bar"]')).toBeNull()
    expect(panel(w)!.querySelector('[data-part="mark"]')).not.toBeNull()
  })

  it('closing the pane before the 5 s sends right away, once', async () => {
    const w = await openTech()
    click(panel(w)!.querySelector('[data-part="mark"]'))
    await tick()
    key(panel(w)!.querySelector('[data-part="undo-bar"] button')!, 'Escape')
    await tick()
    expect(panelOpen(w)).toBe(false)
    expect(reads(w)).toEqual([['read.mark', { kind: 'folder', id: 'f_tech' }]])
    await vi.advanceTimersByTimeAsync(10000)
    expect(reads(w)).toHaveLength(1)
  })

  it('tab uses kind tab', async () => {
    const w = await go()
    click(row(w, 't:all-new'))
    await tick()
    click(panel(w)!.querySelector('[data-part="mark"]'))
    await vi.advanceTimersByTimeAsync(5000)
    await tick()
    expect(reads(w)).toEqual([['read.mark', { kind: 'tab', id: 'all-new' }]])
  })
})
