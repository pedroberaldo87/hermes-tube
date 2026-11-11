// Subscriptions: tabs (counters, remembered tab), paged feed without duplicates, remembered densities, highlight,
// "why it is here", optimistic quick actions with undo and failure, keyboard, strips by priority, true
// empty (3 paths: extension, paste link, demo), empty tab, error with try again and i18n EN = PT-BR.
// Fake backend per route (the contract envelope) over the sdk-mock's `ctx.rest`; no network.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedItem, FeedPage, StatusResponse, Tab, TabRules } from '../../shared/api-types'
import { DESKTOP_ROUTES, PLUGIN_ID } from '../../shared/ids'
import enCommon from '../locales/en/common.json'
import enHome from '../locales/en/home.json'
import ptHome from '../locales/pt-BR/home.json'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { EXTRAS_PAGE_READY } from '../lib/extras'
import { interpolate, registerLocales } from '../lib/i18n'
import { HomePage, HomeView, STORAGE_KEYS } from '../pages/home'
import { pickBanner } from '../pages/home/banners'
import { advance, click, flush, render } from './render'
import { createMockCtx, queryClient, sdkMock } from './sdk-mock'
import { listRepoFiles, readRepoFile } from './repo.mjs'

// The base mock draws the SegmentedControl as an empty <div> and ignores the SearchField's `inputRef` and the
// DropdownMenu's `open`/`onOpenChange`; here they behave like the app's (clickable options, ref on the
// input, controlled menu with no stray attribute in the DOM).
vi.mock('@hermes/plugin-sdk', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>()
  const { createElement } = await import('react')
  type Opt = { id: string; label: string }
  type AnyProps = Record<string, unknown> & { children?: unknown }
  const SegmentedControl = ({ options, value, onChange }: { options: Opt[]; value: string; onChange: (id: string) => void }) =>
    createElement(
      'div',
      { 'data-slot': 'segmented-control' },
      options.map((o) => createElement('button', { key: o.id, type: 'button', 'data-id': o.id, 'aria-pressed': o.id === value, onClick: () => onChange(o.id) }, o.label))
    )
  const SearchField = ({ onChange, value, inputRef, onClear: _c, ...rest }: AnyProps) =>
    createElement('input', {
      'data-slot': 'search-field',
      ref: inputRef,
      value,
      onChange: (e: { target: { value: string } }) => (onChange as (v: string) => void)?.(e.target.value),
      ...rest
    })
  // controlled menu like Radix: the trigger toggles `onOpenChange`, the content only exists while open, an item closes it
  const { createContext, useContext, cloneElement, isValidElement } = await import('react')
  type MenuCtx = { open: boolean; set: (v: boolean) => void }
  const Ctx = createContext<MenuCtx>({ open: false, set: () => undefined })
  const DropdownMenu = ({ children, open, onOpenChange }: AnyProps) =>
    createElement(
      Ctx.Provider,
      { value: { open: !!open, set: (v: boolean) => (onOpenChange as (v: boolean) => void)?.(v) } },
      createElement('div', { 'data-slot': 'dropdown-menu', 'data-open': open ? 'true' : 'false' }, children as never)
    )
  const DropdownMenuTrigger = ({ children }: AnyProps) => {
    const ctx = useContext(Ctx)
    const extra = { 'aria-haspopup': 'menu', 'aria-expanded': ctx.open, onClick: () => ctx.set(!ctx.open) }
    return isValidElement(children) ? cloneElement(children, extra) : createElement('button', extra, children as never)
  }
  const DropdownMenuContent = ({ children, align: _a, sideOffset: _s, ...rest }: AnyProps) =>
    useContext(Ctx).open ? createElement('div', { role: 'menu', 'data-slot': 'dropdown-menu-content', ...rest }, children as never) : null
  const DropdownMenuItem = ({ children, onSelect, ...rest }: AnyProps) => {
    const ctx = useContext(Ctx)
    return createElement(
      'div',
      {
        role: 'menuitem',
        'data-slot': 'dropdown-menu-item',
        onClick: () => {
          ;(onSelect as () => void)?.()
          ctx.set(false)
        },
        ...rest
      },
      children as never
    )
  }
  return { ...mod, SegmentedControl, SearchField, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
})

// ------------------------------------------------------------------ fixtures

type Tree = { [k: string]: Tree | string }
const EN = enHome as unknown as Tree

/** EN text of a key in the `home` namespace (with interpolation). */
function en(key: string, vars?: Record<string, string | number>): string {
  let node: Tree | string = EN
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return interpolate(node, vars)
}

const NOW_S = Math.floor(Date.now() / 1000)

function rules(include: Partial<TabRules['include']>, onlyNew = false): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: onlyNew, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  }
}

const TABS: Tab[] = [
  { id: 'all-new', name: 'Tudo novo', kind: 'mixed', rules: rules({ all: true }, true), icon: null, filters: {}, sort: 0, builtin: true },
  { id: 'favorites', name: 'Favoritos', kind: 'mixed', rules: rules({ favorites: true }, true), icon: '⭐', filters: {}, sort: 1, builtin: true },
  { id: 'tab_tech', name: 'Tecnologia', kind: 'category', rules: rules({ folders: ['f_tech'] }), icon: null, filters: {}, sort: 2, builtin: false }
]

function vid(n: number): string {
  return `v${String(n).padStart(10, '0')}`
}

function item(n: number, over: Partial<FeedItem> = {}): FeedItem {
  const id = vid(n)
  return {
    video: {
      id,
      channel_id: 'UCsBjURrPoezykLs9EqgamOA',
      title: `Video number ${n}`,
      published_at: NOW_S - n * 3600,
      description: n === 1 ? 'The first one.' : null,
      channel_title: 'Fireship',
      duration_s: 300 + n,
      is_short: false,
      views: 1000 * n,
      first_seen_at: NOW_S - n * 3600,
      origin: 'rss'
    },
    channel: {
      id: 'UCsBjURrPoezykLs9EqgamOA',
      title: 'Fireship',
      relation: 'subscribed',
      source: 'extension',
      added_at: NOW_S - 86400 * 100,
      handle: '@fireship',
      thumb: null,
      url: null,
      folder_id: 'f_tech',
      favorite: false,
      muted: false,
      unsubscribed_at: null,
      last_video_at: NOW_S,
      videos_per_week: 2,
      shorts_ratio: 0,
      ai_note: null,
      tag_ids: []
    },
    state: 'new',
    reaction: null,
    is_new: true,
    why: { via: 'folder', label: `Folder ${n}`, detail: null },
    badges: [],
    ...over
  }
}

function page(items: FeedItem[], next: string | null = null, total = items.length): FeedPage {
  return { items, next_cursor: next, counts: { total, new: items.filter((i) => i.is_new).length } }
}

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 15,
    new_by_tab: [
      { tab_id: 'all-new', name: 'Tudo novo', count: 12, icon: null },
      { tab_id: 'tab_tech', name: 'Tecnologia', count: 3, icon: null }
    ],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: NOW_S - 120,
    refresh_running: false,
    queue_pending: 0,
    search_pending: 0,
    devices_online: 1,
    ext_port: 47615,
    rss_down_since: null,
    rss_fallback_channels: 0,
    channels_total: 40,
    subscribed_total: 34,
    ...over
  }
}

/** `/status` without the totals (optional field missing = "not known yet"). */
function statusWithoutTotals(over: Partial<StatusResponse> = {}): StatusResponse {
  const s = status(over)
  delete s.channels_total
  delete s.subscribed_total
  return s
}

// ------------------------------------------------------------------ fake backend

interface Req {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

type Route = (req: Req) => unknown

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let routes: Record<string, Route>
let calls: Req[]
let handle: ReturnType<typeof createMockCtx>

function apiError(code: string, message = code, details?: Record<string, unknown>) {
  return { code, message, ...(details ? { details } : {}) }
}

function install(): void {
  sdkMock.restHandler = (rawPath, opts) => {
    const [path, qs = ''] = rawPath.split('?')
    const method = String(opts?.method ?? 'GET')
    const query = Object.fromEntries(new URLSearchParams(qs))
    const req: Req = { method, path, query, body: opts?.body }
    calls.push(req)
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ')
      if (m !== method) return false
      const re = new RegExp(`^${p.replace(/\{\w+\}/g, '[^/]+')}$`)
      return re.test(path)
    })
    if (!key) return { ok: false, error: apiError('not_found', `no route ${method} ${path}`) }
    return Promise.resolve()
      .then(() => routes[key](req))
      .then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error })
      )
  }
}

function callsTo(method: string, path: string): Req[] {
  return calls.filter((c) => c.method === method && c.path === path)
}

function defaultRoutes(): Record<string, Route> {
  return {
    'GET /tabs': () => ({ items: TABS }),
    'GET /status': () => status(),
    'GET /channels': () => ({ items: [], total: 40 }),
    'GET /feed': (req) => (req.query.tab === 'tab_tech' ? page([item(50), item(51)]) : page([item(1), item(2), item(3)])),
    'POST /videos/state': () => ({ changed: 1 }),
    'POST /read': (req) => (req.query.change_ids === 'true' ? { changed: 3, change_ids: [91] } : { changed: 3 }),
    'POST /refresh': () => ({ result: 'started' }),
    'GET /changes': () => ({ items: [] })
  }
}

async function mount(ui = <HomePage />) {
  const view = render(ui)
  await flush(12)
  return view
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
// real cards in the grid (the place of an item archived by a click, `card-gone`, does not count as a card)
const cards = (root: ParentNode) =>
  qa(root, '[data-part="grid"] [data-part="card"][data-video]')
    .filter((c) => !c.closest('[data-part="card-gone"]'))
    .map((c) => c.getAttribute('data-video'))
const card = (root: ParentNode, n: number) => q(root, `[data-part="card"][data-video="${vid(n)}"]`)
const button = (root: ParentNode, label: string) =>
  qa(root, 'button').find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) ?? null
const lastNotification = () => sdkMock.notifications[sdkMock.notifications.length - 1]

function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// controllable IntersectionObserver (jsdom has none)
class FakeIO {
  static all: FakeIO[] = []
  targets: Element[] = []
  constructor(private readonly cb: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) {
    FakeIO.all.push(this)
  }
  observe(el: Element) {
    this.targets.push(el)
  }
  unobserve() {}
  disconnect() {
    this.targets = []
    FakeIO.all = FakeIO.all.filter((x) => x !== this)
  }
  static async fire(): Promise<void> {
    for (const io of [...FakeIO.all]) {
      const entries = io.targets.map((target) => ({ isIntersecting: true, target }))
      if (entries.length) act(() => io.cb(entries))
    }
    await flush(12)
  }
}

beforeEach(() => {
  handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  routes = defaultRoutes()
  calls = []
  FakeIO.all = []
  vi.stubGlobal('IntersectionObserver', FakeIO)
  install()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ------------------------------------------------------------------ states

describe('estados da Home', () => {
  it('loading: skeleton of the tabs and the grid with the same density, no empty text and no zero', async () => {
    routes['GET /tabs'] = () => new Promise(() => undefined)
    routes['GET /status'] = () => new Promise(() => undefined)
    const view = await mount()
    expect(q(view.container, '[data-part="tabbar"][data-skeleton]')).not.toBeNull()
    const grid = q(view.container, '[data-part="grid"][aria-busy="true"]')
    expect(grid?.getAttribute('data-density')).toBe('comfortable')
    expect(view.text()).not.toContain(en('empty.tab_title'))
    expect(view.text()).not.toMatch(/\b0 new\b/)
  })

  it('full: tabs from GET /tabs with counters from /status, "Watch later", cards with "why it is here"', async () => {
    const view = await mount()
    const tabIds = qa(view.container, '[data-tab-id]').map((t) => t.getAttribute('data-tab-id'))
    expect(tabIds).toEqual(['all-new', 'favorites', 'tab_tech', ':later', ':playlists'])
    const allNew = q(view.container, '[data-tab-id="all-new"]')
    expect(allNew?.textContent).toContain(en('tabs.all-new'))
    expect(q(allNew!, '[data-part="tab-count"]')?.textContent).toBe('12')
    expect(q(view.container, '[data-tab-id="tab_tech"] [data-part="tab-count"]')?.textContent).toBe('3')
    expect(q(view.container, '[data-tab-id="favorites"] [data-part="tab-count"]')).toBeNull()
    expect(q(view.container, '[data-tab-id=":later"]')?.textContent).toContain(en('tabs.later'))
    // "why it is here" comes from the backend, on every card
    for (const n of [1, 2, 3]) expect(view.text()).toContain(`Folder ${n}`)
    expect(callsTo('GET', '/feed')[0].query).toMatchObject({ tab: 'all-new', limit: '30' })
    // header: N new · updated X ago
    expect(view.text()).toContain(en('subtitle.new', { count: '15' }))
  })

  it('highlight: the first new/favorite becomes featured only in comfortable (and leaves the grid)', async () => {
    const view = await mount()
    const featured = q(view.container, '[data-variant="featured"]')
    expect(featured?.getAttribute('data-video')).toBe(vid(1))
    expect(cards(view.container)).toEqual([vid(2), vid(3)])
  })

  it('highlight: a Short is never the highlight — the first normal video goes; only Shorts = no highlight', async () => {
    const short = (n: number) => { const it = item(n); return { ...it, video: { ...it.video, is_short: true } } }
    routes['GET /feed'] = () => page([short(1), item(2), item(3)])
    let view = await mount()
    expect(q(view.container, '[data-variant="featured"]')?.getAttribute('data-video')).toBe(vid(2))
    expect(cards(view.container)).toEqual([vid(1), vid(3)])
    view.unmount()

    routes['GET /feed'] = () => page([short(1), short(2)])
    view = await mount()
    expect(q(view.container, '[data-variant="featured"]')).toBeNull()
    expect(cards(view.container)).toEqual([vid(1), vid(2)])
  })

  it('highlight: with no new or favorite item, there is no highlight', async () => {
    routes['GET /feed'] = () => page([item(1, { is_new: false, state: 'seen' }), item(2, { is_new: false, state: 'seen' })])
    const view = await mount()
    expect(q(view.container, '[data-variant="featured"]')).toBeNull()
    expect(cards(view.container)).toEqual([vid(1), vid(2)])
  })

  it('feed error: ErrorView with try again (never a false empty); try again reloads', async () => {
    let fail = true
    routes['GET /feed'] = () => {
      if (fail) throw apiError('internal', 'boom')
      return page([item(1), item(2)])
    }
    const view = await mount()
    expect(q(view.container, '[data-part="error"]')).not.toBeNull()
    expect(view.text()).not.toContain(en('empty.tab_title'))
    fail = false
    click(button(q(view.container, '[data-part="error"]')!, 'Try again'))
    await flush(12)
    expect(q(view.container, '[data-part="error"]')).toBeNull()
    expect(card(view.container, 2)).not.toBeNull()
  })

  it('tabs error: ErrorView with try again, never a blank screen', async () => {
    routes['GET /tabs'] = () => {
      throw apiError('internal', 'down')
    }
    const view = await mount()
    expect(q(view.container, '[data-part="error"]')).not.toBeNull()
    expect(view.text()).toContain(en('title'))
  })

  it('status failed: no false "0 new" in the header and no made-up counters', async () => {
    routes['GET /status'] = () => {
      throw apiError('internal', 'x')
    }
    const view = await mount()
    expect(view.text()).not.toMatch(/\b0 new\b/)
    expect(qa(view.container, '[data-part="tab-count"]')).toHaveLength(0)
    expect(view.text()).toContain(en('subtitle.status_error'))
  })

  it('empty tab (there are channels, nothing new): calm message + "see all"/"show watched"', async () => {
    routes['GET /feed'] = () => page([])
    routes['POST /feed/preview'] = () => page([item(7, { is_new: false, state: 'watched' })])
    const view = await mount()
    const empty = q(view.container, '[data-part="empty"]')
    expect(empty?.textContent).toContain(en('empty.tab_title'))
    expect(button(empty!, en('empty.show_seen'))).not.toBeNull()
    click(button(empty!, en('empty.show_seen')))
    await flush(12)
    const preview = callsTo('POST', '/feed/preview')
    expect(preview).toHaveLength(1)
    const body = JSON.parse(JSON.stringify(preview[0].body)) as { rules: TabRules }
    expect(body.rules.include.all).toBe(true)
    expect(body.rules.filters.only_new).toBe(false)
    expect(card(view.container, 7)).not.toBeNull()
  })

  it('empty tab: "see all" goes from any tab to "All new"', async () => {
    routes['GET /feed'] = (req) => (req.query.tab === 'tab_tech' ? page([]) : page([item(1), item(2)]))
    const view = await mount(<HomeView initialTab="tab_tech" />)
    const empty = q(view.container, '[data-part="empty"]')
    click(button(empty!, en('empty.see_all')))
    await flush(12)
    expect(handle.storage.get(STORAGE_KEYS.tab)).toBe('all-new')
    expect(card(view.container, 2)).not.toBeNull()
  })
})

// ------------------------------------------------------------------ tabs and density

describe('remembered tabs and density', () => {
  it('switching tabs requests the tab\'s feed and saves it to storage; reopening returns to it', async () => {
    const view = await mount()
    click(q(view.container, '[data-tab-id="tab_tech"]'))
    await flush(12)
    expect(callsTo('GET', '/feed').some((c) => c.query.tab === 'tab_tech')).toBe(true)
    expect(handle.storage.get(STORAGE_KEYS.tab)).toBe('tab_tech')
    expect(card(view.container, 50)).not.toBeNull()
    view.unmount()
    calls = []
    const again = await mount()
    expect(callsTo('GET', '/feed')[0].query.tab).toBe('tab_tech')
    expect(q(again.container, '[data-tab-id="tab_tech"]')?.getAttribute('data-state') ?? 'active').toBeTruthy()
  })

  it('a remembered tab that no longer exists falls back to the first', async () => {
    handle.storage.set(STORAGE_KEYS.tab, 'tab_apagada')
    await mount()
    expect(callsTo('GET', '/feed')[0].query.tab).toBe('all-new')
  })

  it('"Watch later": GET /feed?state=later as the source, with cursor and the origin\'s "why it is here"', async () => {
    const later = (n: number) => item(n, { state: 'later', is_new: false, why: { via: 'folder', label: `Origem ${n}`, detail: null } })
    routes['GET /feed'] = (req) => {
      if (req.query.state !== 'later') return page([item(1), item(2), item(3)])
      return req.query.cursor === 'l:2' ? page([later(10), later(11)], null, 4) : page([later(8), later(9)], 'l:2', 4)
    }
    const view = await mount(<HomeView initialDensity="compact" />)
    click(q(view.container, '[data-tab-id=":later"]'))
    await flush(12)
    const laterCalls = () => callsTo('GET', '/feed').filter((c) => c.query.state === 'later')
    expect(laterCalls()[0].query).toEqual({ state: 'later', limit: '30' })
    expect(cards(view.container)).toEqual([vid(8), vid(9)])
    expect(view.text()).toContain('Origem 8')
    expect(view.text()).toContain(en('feed.count', { count: '4' }))
    await FakeIO.fire()
    expect(laterCalls().map((c) => c.query.cursor ?? null)).toEqual([null, 'l:2'])
    expect(cards(view.container)).toEqual([vid(8), vid(9), vid(10), vid(11)])
    // the old pair (GET /videos/state + GET /videos?ids=) is gone
    expect(callsTo('GET', '/videos/state')).toHaveLength(0)
    expect(callsTo('GET', '/videos')).toHaveLength(0)
    // "Watch later" does not offer "mark as read" (the server answers invalid)
    expect(button(view.container, en('actions.mark_read'))).toBeNull()
  })

  it('density: the change persists, compact has no highlight, list uses the row card; reopening remembers', async () => {
    const view = await mount()
    expect(q(view.container, '[data-variant="featured"]')).not.toBeNull()
    click(qa(view.container, '[data-part="mode"] button').find((b) => b.textContent === 'Compact') ?? null)
    await flush()
    expect(handle.storage.get(STORAGE_KEYS.density)).toBe('compact')
    expect(q(view.container, '[data-variant="featured"]')).toBeNull()
    expect(q(view.container, '[data-part="grid"]')?.getAttribute('data-density')).toBe('compact')
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3)])
    view.unmount()
    const again = await mount()
    expect(q(again.container, '[data-part="grid"]')?.getAttribute('data-density')).toBe('compact')
    click(qa(again.container, '[data-part="mode"] button').find((b) => b.textContent === 'List') ?? null)
    await flush()
    expect(q(again.container, '[data-part="card"][data-video]')?.getAttribute('data-variant')).toBe('row')
  })
})

// ------------------------------------------------------------------ pagination

describe('cursor pagination', () => {
  it('2 pages when getting near the end, no duplicate item; end = stops asking', async () => {
    routes['GET /feed'] = (req) =>
      req.query.cursor === 'c1' ? page([item(3), item(4), item(5)], null, 5) : page([item(1), item(2), item(3)], 'c1', 5)
    const view = await mount(<HomeView initialDensity="compact" />)
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3)])
    await FakeIO.fire()
    const feedCalls = callsTo('GET', '/feed')
    expect(feedCalls.map((c) => c.query.cursor ?? null)).toEqual([null, 'c1'])
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3), vid(4), vid(5)])
    await FakeIO.fire()
    expect(callsTo('GET', '/feed')).toHaveLength(2)
  })

  it('next page failed: notice with try again, without losing what already came', async () => {
    let fail = true
    routes['GET /feed'] = (req) => {
      if (req.query.cursor === 'c1') {
        if (fail) throw apiError('internal', 'x')
        return page([item(4)], null)
      }
      return page([item(1), item(2), item(3)], 'c1')
    }
    const view = await mount(<HomeView initialDensity="compact" />)
    await FakeIO.fire()
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3)])
    const err = q(view.container, '[data-part="error"]')
    expect(err).not.toBeNull()
    fail = false
    click(button(err!, 'Try again'))
    await flush(12)
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3), vid(4)])
  })
})

// ------------------------------------------------------------------ quick actions

describe('optimistic quick actions', () => {
  it('watched: changes at once, saves, notifies with undo; undo calls the inverse route', async () => {
    const gate = deferred()
    routes['POST /videos/state'] = () => gate.promise.then(() => ({ changed: 1 }))
    const view = await mount()
    click(q(card(view.container, 2)!, '[data-action="watched"]'))
    expect(card(view.container, 2)?.getAttribute('data-state')).toBe('watched')
    gate.resolve(undefined)
    await flush(12)
    expect(callsTo('POST', '/videos/state')[0].body).toEqual({ video_ids: [vid(2)], state: 'watched' })
    const note = lastNotification()
    expect(note.message).toBe(en('toast.watched'))
    routes['POST /videos/state'] = () => ({ changed: 1 })
    act(() => note.action.onClick())
    expect(card(view.container, 2)?.getAttribute('data-state')).toBe('new')
    await flush(12)
    expect(callsTo('POST', '/videos/state')[1].body).toEqual({ video_ids: [vid(2)], state: 'new' })
    expect(callsTo('GET', '/status').length).toBeGreaterThan(1)
  })

  it('archive: leaves the grid at once; undo puts it back in the same place', async () => {
    const view = await mount()
    click(q(card(view.container, 2)!, '[data-action="archive"]'))
    expect(cards(view.container)).toEqual([vid(3)])
    await flush(12)
    expect(callsTo('POST', '/videos/state')[0].body).toEqual({ video_ids: [vid(2)], state: 'archived' })
    act(() => lastNotification().action.onClick())
    expect(cards(view.container)).toEqual([vid(2), vid(3)])
    await flush(12)
    expect(callsTo('POST', '/videos/state')[1].body).toEqual({ video_ids: [vid(2)], state: 'new' })
  })

  it('later and 👍/👎: mark and unmark (reaction goes back to null)', async () => {
    const view = await mount()
    click(q(card(view.container, 3)!, '[data-action="later"]'))
    await flush(12)
    expect(card(view.container, 3)?.getAttribute('data-state')).toBe('later')
    click(q(card(view.container, 3)!, '[data-action="up"]'))
    await flush(12)
    expect(q(card(view.container, 3)!, '[data-action="up"]')?.getAttribute('aria-pressed')).toBe('true')
    click(q(card(view.container, 3)!, '[data-action="up"]'))
    await flush(12)
    click(q(card(view.container, 3)!, '[data-action="down"]'))
    await flush(12)
    expect(callsTo('POST', '/videos/state').map((c) => c.body)).toEqual([
      { video_ids: [vid(3)], state: 'later' },
      { video_ids: [vid(3)], reaction: 'up' },
      { video_ids: [vid(3)], reaction: null },
      { video_ids: [vid(3)], reaction: 'down' }
    ])
  })

  it('failure: back to the previous state and a notice (readable error)', async () => {
    routes['POST /videos/state'] = () => {
      throw apiError('invalid', 'bad id')
    }
    const view = await mount()
    click(q(card(view.container, 2)!, '[data-action="archive"]'))
    expect(cards(view.container)).toEqual([vid(3)])
    await flush(12)
    expect(cards(view.container)).toEqual([vid(2), vid(3)])
    const note = lastNotification()
    expect(note.kind).toBe('error')
    expect(note.message).toContain('Some of the information is invalid.')
  })

  it('an undo that fails reapplies the action and notifies', async () => {
    const view = await mount()
    click(q(card(view.container, 2)!, '[data-action="watched"]'))
    await flush(12)
    routes['POST /videos/state'] = () => {
      throw apiError('internal', 'x')
    }
    act(() => lastNotification().action.onClick())
    await flush(12)
    expect(card(view.container, 2)?.getAttribute('data-state')).toBe('watched')
    expect(lastNotification().kind).toBe('error')
  })

  it('mark the tab as read: POST /read?change_ids=true {kind: tab}, optimistic; undo uses the returned id', async () => {
    routes['POST /read'] = () => ({ changed: 12, change_ids: [77, 78] })
    // a more recent mark_read entry in the history that is NOT from this action: undo must not touch it
    routes['GET /changes'] = () => ({
      items: [{ id: 99, ts: NOW_S + 5, actor: 'user', action: 'mark_read', payload: {}, undo: {}, group_id: null, undone_at: null }]
    })
    routes['POST /changes/{id}/undo'] = () => ({ undone: [] })
    const view = await mount()
    click(button(view.container, en('actions.mark_read')))
    expect(q(view.container, '[data-tab-id="all-new"] [data-part="tab-count"]')).toBeNull()
    expect(q(view.container, '[data-part="card"][data-new="true"]')).toBeNull()
    await flush(12)
    const reads = callsTo('POST', '/read')
    expect(reads).toHaveLength(1)
    expect(reads[0].query).toEqual({ change_ids: 'true' })
    expect(reads[0].body).toEqual({ kind: 'tab', id: 'all-new' })
    const note = lastNotification()
    expect(note.message).toBe(en('toast.read', { tab: en('tabs.all-new') }))
    act(() => note.action.onClick())
    await flush(12)
    const undone = calls.filter((c) => c.method === 'POST' && c.path.startsWith('/changes/')).map((c) => c.path)
    expect(undone.sort()).toEqual(['/changes/77/undo', '/changes/78/undo'])
    // without searching the history by time
    expect(callsTo('GET', '/changes')).toHaveLength(0)
    expect(q(view.container, '[data-tab-id="all-new"] [data-part="tab-count"]')?.textContent).toBe('12')
  })

  it('mark as read: nothing changed (empty change_ids) notifies without offering undo', async () => {
    routes['POST /read'] = () => ({ changed: 0, change_ids: [] })
    const view = await mount()
    click(button(view.container, en('actions.mark_read')))
    await flush(12)
    const note = lastNotification()
    expect(note.message).toBe(en('toast.read_nothing'))
    expect(note.action).toBeUndefined()
  })

  it('mark as read: scope tab on any tab that is not a topic tab (⭐, folder); topic tab and "Watch later" without the action', async () => {
    routes['GET /tabs'] = () => ({
      items: [
        ...TABS,
        { id: 'tab_ai', name: 'Agentes de IA', kind: 'theme', rules: rules({ themes: ['th'] }), icon: '🤖', filters: {}, sort: 5, builtin: false },
        // a topic tab that also lists a channel: still a topic tab (the server answers invalid)
        { id: 'tab_ai_ch', name: 'IA + Karpathy', kind: 'theme', rules: rules({ themes: ['th'], channels: ['UCXUPKJO5MZQN11PqgIvyuvQ'] }), icon: null, filters: {}, sort: 6, builtin: false }
      ]
    })
    for (const id of ['favorites', 'tab_tech']) {
      calls = []
      const view = await mount(<HomeView initialTab={id} />)
      click(button(view.container, en('actions.mark_read')))
      await flush(12)
      expect(callsTo('POST', '/read').map((c) => c.body)).toEqual([{ kind: 'tab', id }])
      // ⭐ and tags no longer become channels on the client
      expect(callsTo('GET', '/channels').filter((c) => c.query.favorite || c.query.tag)).toHaveLength(0)
      view.unmount()
    }
    for (const id of ['tab_ai', 'tab_ai_ch', ':later', ':playlists']) {
      const view = await mount(<HomeView initialTab={id} />)
      expect(button(view.container, en('actions.mark_read')), id).toBeNull()
      view.unmount()
    }
  })

  it('mark as read in the pane filter (folder without a tab) stays by folder', async () => {
    routes['GET /folders'] = () => ({ items: [{ id: 'f_music', name: 'Música', parent_id: null, color: null, sort: 0 }] })
    const view = await mount(<HomeView initialFilter={{ kind: 'folder', id: 'f_music' }} />)
    click(button(view.container, en('actions.mark_read')))
    await flush(12)
    expect(callsTo('POST', '/read').map((c) => c.body)).toEqual([{ kind: 'folder', id: 'f_music' }])
  })
})

// ------------------------------------------------------------------ keyboard

describe('keyboard', () => {
  it('in the grid: e archives, w marks watched, u likes, Enter opens in the browser, / focuses the search', async () => {
    const view = await mount(<HomeView initialDensity="compact" />)
    const cell = () => q(view.container, '[role="gridcell"][tabindex="0"]')!
    expect(cell().getAttribute('data-key')).toBe(vid(1))
    key(cell(), 'w')
    expect(card(view.container, 1)?.getAttribute('data-state')).toBe('watched')
    key(cell(), 'j')
    expect(cell().getAttribute('data-key')).toBe(vid(2))
    key(cell(), 'e')
    expect(cards(view.container)).toEqual([vid(1), vid(3)])
    key(cell(), 'u')
    key(cell(), 'Enter')
    await flush(12)
    expect(sdkMock.openedExternal.at(-1)).toContain(vid(3))
    key(cell(), '/')
    expect(document.activeElement?.getAttribute('data-slot')).toBe('search-field')
    const bodies = callsTo('POST', '/videos/state').map((c) => c.body)
    expect(bodies).toEqual([
      { video_ids: [vid(1)], state: 'watched' },
      { video_ids: [vid(2)], state: 'archived' },
      { video_ids: [vid(3)], reaction: 'up' }
    ])
  })
})

// ------------------------------------------------------------------ search and filters

describe('server search (GET /feed?q=)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const searchInput = (root: HTMLElement) => q(root, '[data-slot="search-field"]') as HTMLInputElement
  const feedQs = () => callsTo('GET', '/feed').map((c) => c.query.q ?? null)

  it('waits for typing (~250 ms): a single request, with q, in the tab; count = the search\'s counts.total', async () => {
    routes['GET /feed'] = (req) => (req.query.q ? page([item(7, { is_new: false })], null, 42) : page([item(1), item(2), item(3)]))
    const view = await mount(<HomeView initialDensity="compact" />)
    const input = searchInput(view.container)
    typeInto(input, 'r')
    await advance(100)
    typeInto(input, 'ru')
    await advance(100)
    typeInto(input, 'rust')
    await advance(100)
    // still inside the wait: no search request; the list was not filtered on the client
    expect(feedQs()).toEqual([null])
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3)])
    await advance(200)
    await flush(12)
    expect(feedQs()).toEqual([null, 'rust'])
    expect(callsTo('GET', '/feed')[1].query).toEqual({ tab: 'all-new', q: 'rust', limit: '30' })
    expect(cards(view.container)).toEqual([vid(7)])
    expect(view.text()).toContain('42 results')
    expect(view.text()).toContain(en('feed.count', { count: '42' }))
    // the old "among the loaded videos" text is gone
    expect(view.text()).not.toContain('loaded videos')
  })

  it('typing again cancels the previous request: the stale answer never shows', async () => {
    const gates: Record<string, Deferred<FeedPage>> = { ru: deferred(), rust: deferred() }
    routes['GET /feed'] = (req) => (req.query.q ? gates[req.query.q].promise : page([item(1), item(2), item(3)]))
    const cancel = vi.spyOn(queryClient, 'cancelQueries')
    const view = await mount(<HomeView initialDensity="compact" />)
    const input = searchInput(view.container)
    typeInto(input, 'ru')
    await advance(300)
    expect(feedQs()).toEqual([null, 'ru'])
    typeInto(input, 'rust')
    await advance(300)
    expect(feedQs()).toEqual([null, 'ru', 'rust'])
    // the request for "ru" was cancelled (by its exact key)
    const cancelled = cancel.mock.calls.map((args) => JSON.stringify(((args as unknown[])[0] as { queryKey?: unknown[] } | undefined)?.queryKey ?? null))
    expect(cancelled.some((k) => k.includes('"q":"ru"'))).toBe(true)
    expect(cancelled.some((k) => k.includes('"q":"rust"'))).toBe(false)
    // until the new search arrives, the previous list stays (no skeleton, the search keeps focus)
    expect(q(view.container, '[data-part="grid"][aria-busy="true"]')).toBeNull()
    expect(searchInput(view.container)).toBe(input)
    gates.rust.resolve(page([item(20, { is_new: false })], null, 1))
    await flush(12)
    expect(cards(view.container)).toEqual([vid(20)])
    // the stale answer arrives later and is ignored
    gates.ru.resolve(page([item(30, { is_new: false })], null, 1))
    await flush(12)
    expect(cards(view.container)).toEqual([vid(20)])
    cancel.mockRestore()
  })

  it('cursor pagination kept with the search (q goes on every page); changing q resets the cursor', async () => {
    routes['GET /feed'] = (req) => {
      if (!req.query.q) return page([item(1), item(2), item(3)])
      if (req.query.q === 'neural') return page([item(60, { is_new: false })], null, 1)
      return req.query.cursor === 's1' ? page([item(42), item(43)], null, 4) : page([item(40), item(41)], 's1', 4)
    }
    const view = await mount(<HomeView initialDensity="compact" />)
    typeInto(searchInput(view.container), 'fireship')
    await advance(300)
    await flush(12)
    expect(cards(view.container)).toEqual([vid(40), vid(41)])
    await FakeIO.fire()
    const searchCalls = () => callsTo('GET', '/feed').filter((c) => c.query.q)
    expect(searchCalls().map((c) => [c.query.q, c.query.cursor ?? null])).toEqual([
      ['fireship', null],
      ['fireship', 's1']
    ])
    expect(cards(view.container)).toEqual([vid(40), vid(41), vid(42), vid(43)])
    typeInto(searchInput(view.container), 'neural')
    await advance(300)
    await flush(12)
    expect(searchCalls().at(-1)?.query.cursor).toBeUndefined()
    expect(cards(view.container)).toEqual([vid(60)])
  })

  it('nothing found for «x»: its own empty state (with the search bar) and "clear search" goes back to the tab', async () => {
    routes['GET /feed'] = (req) => (req.query.q ? page([], null, 0) : page([item(1), item(2), item(3)]))
    const view = await mount(<HomeView initialDensity="compact" />)
    typeInto(searchInput(view.container), 'nada disso')
    await advance(300)
    await flush(12)
    const empty = q(view.container, '[data-part="empty"]')
    expect(empty?.textContent).toContain(en('empty.search_title', { query: 'nada disso' }))
    expect(empty?.textContent).not.toContain(en('empty.tab_title'))
    // the bar is still there (the text can be fixed)
    expect(searchInput(view.container)).not.toBeNull()
    click(button(empty!, en('empty.clear_search')))
    await flush(12)
    expect(searchInput(view.container).value).toBe('')
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3)])
  })

  it('"Watch later" and the pane filter also search on the server', async () => {
    routes['GET /feed'] = () => page([item(1, { is_new: false })])
    const view = await mount(<HomeView initialTab=":later" initialDensity="compact" />)
    typeInto(searchInput(view.container), 'einstein')
    await advance(300)
    await flush(12)
    expect(callsTo('GET', '/feed').at(-1)?.query).toEqual({ state: 'later', q: 'einstein', limit: '30' })
    view.unmount()
    routes['GET /folders'] = () => ({ items: [{ id: 'f_music', name: 'Música', parent_id: null, color: null, sort: 0 }] })
    const pane = await mount(<HomeView initialFilter={{ kind: 'folder', id: 'f_music' }} initialDensity="compact" />)
    typeInto(searchInput(pane.container), 'jazz')
    await advance(300)
    await flush(12)
    expect(callsTo('GET', '/feed').at(-1)?.query).toEqual({ folder: 'f_music', q: 'jazz', limit: '30' })
  })

  it('"Show watched" (POST /feed/preview has no q): the search filters what came and says so', async () => {
    routes['GET /feed'] = () => page([])
    routes['POST /feed/preview'] = () => page([item(7, { is_new: false, state: 'watched' }), item(8, { is_new: false, state: 'watched' })])
    const view = await mount(<HomeView initialDensity="compact" />)
    click(button(q(view.container, '[data-part="empty"]')!, en('empty.show_seen')))
    await flush(12)
    typeInto(searchInput(view.container), 'number 8')
    await advance(300)
    await flush(12)
    expect(cards(view.container)).toEqual([vid(8)])
    expect(callsTo('GET', '/feed').filter((c) => c.query.q)).toHaveLength(0)
    typeInto(searchInput(view.container), 'zzz')
    await advance(300)
    await flush(12)
    expect(q(view.container, '[data-part="empty"]')?.textContent).toContain(en('empty.search_loaded_desc', { query: 'zzz' }))
  })
})

// ------------------------------------------------------------------ header

describe('header', () => {
  it('Refresh: POST /refresh {force: true} and shows progress through refresh_running', async () => {
    const view = await mount()
    routes['GET /status'] = () => status({ refresh_running: true })
    click(button(view.container, en('actions.refresh')))
    await flush(12)
    expect(callsTo('POST', '/refresh')[0].body).toEqual({ force: true })
    expect(view.text()).toContain(en('subtitle.refreshing'))
    expect(button(view.container, en('actions.refresh'))?.getAttribute('aria-busy')).toBe('true')
  })

  it('end of the cycle (last_rss_at changed) renews the feed without going back to the skeleton', async () => {
    const view = await mount()
    const before = callsTo('GET', '/feed').length
    routes['GET /feed'] = () => page([item(0), item(1), item(2), item(3)])
    routes['GET /status'] = () => status({ last_rss_at: NOW_S })
    await act(async () => {
      await import('../lib/rest').then((m) => m.invalidateRest('GET /status'))
    })
    expect(q(view.container, '[aria-busy="true"]')).toBeNull()
    await flush(12)
    expect(callsTo('GET', '/feed').length).toBe(before + 1)
    expect(q(view.container, '[data-variant="featured"]')?.getAttribute('data-video')).toBe(vid(0))
  })

  it('Extras navigates to the Extras page; "+ New tab" opens the type menu', async () => {
    const view = await mount()
    if (EXTRAS_PAGE_READY) {
      click(button(view.container, en('actions.extras')))
      expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.extras])
    } else {
      // the Extras page is still "coming soon": no button leads to it
      expect(qa(view.container, 'button').some((b) => (b.textContent ?? '').trim() === en('actions.extras'))).toBe(false)
    }
    const pick = (label: string) => {
      click(q(view.container, '[data-part="new-tab"]'))
      click(qa(view.container, '[role="menuitem"]').find((m) => m.textContent?.includes(label)) ?? null)
    }
    pick(en('new_tab.channels'))
    pick(en('new_tab.theme'))
    pick(en('new_tab.category'))
    expect($dialogStack.get().map((d) => [d.id, d.props])).toEqual([
      ['tab-editor', { preset: { kind: 'channels' } }],
      ['theme', {}],
      ['tab-editor', { preset: { kind: 'category' } }]
    ])
  })

  it('subtle channels-pane button in the header actions (icon, tooltip, shows the pane)', async () => {
    const view = await mount()
    const toggle = q(view.container, '[data-part="page-head"] [data-part="pane-toggle"]')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('data-variant')).toBe('ghost')
    expect(q(toggle as HTMLElement, '[data-icon]')?.getAttribute('data-icon')).toMatch(/^layout-sidebar-right/)
    expect(toggle?.getAttribute('data-tip')).toBeTruthy()
    click(toggle)
    expect(sdkMock.paneReveals).toEqual([`${PLUGIN_ID}:subscriptions`])
  })
})

// ------------------------------------------------------------------ strips

describe('strips (one at a time, by priority)', () => {
  it('pickBanner: arriving > RSS down > extension disconnected', () => {
    const down = status({ rss_down_since: NOW_S - 600, devices_online: 0 })
    expect(pickBanner({ status: down, subscribed: 10, arriving: true })).toBe('arriving')
    expect(pickBanner({ status: down, subscribed: 10, arriving: false })).toBe('rss_down')
    expect(pickBanner({ status: status({ devices_online: 0 }), subscribed: 10, arriving: false, neverPaired: false })).toBe('ext_disconnected')
    // while GET /devices is unknown (loading/failed) no extension strip is invented
    expect(pickBanner({ status: status({ devices_online: 0 }), subscribed: 10, arriving: false })).toBeNull()
    expect(pickBanner({ status: status({ devices_online: 0 }), subscribed: 0, arriving: false, neverPaired: false })).toBeNull()
    expect(pickBanner({ status: status({ devices_online: 0 }), subscribed: null, arriving: false, neverPaired: false })).toBeNull()
    expect(pickBanner({ status: undefined, subscribed: 10, arriving: false })).toBeNull()
  })

  it('RSS down: a short human sentence (time, another way); the detail goes in the try-again tooltip', async () => {
    routes['GET /status'] = () => status({ rss_down_since: NOW_S - 60, rss_fallback_channels: 4, devices_online: 0 })
    const view = await mount()
    const banners = qa(view.container, '[data-part="banner"]')
    expect(banners).toHaveLength(1)
    const text = (q(banners[0], '[data-part="rss-down"]')?.textContent ?? '').trim()
    const [before, after] = en('banner.rss_down').split('{time}')
    expect(text.startsWith(before)).toBe(true)
    expect(text.endsWith(after)).toBe(true)
    // time of day (same day), never a long date nor a technical count in the text
    const time = new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(new Date((NOW_S - 60) * 1000))
    expect(text).toBe(`${before}${time}${after}`)
    expect(text.length).toBeLessThan(110)
    expect(banners[0].textContent).not.toContain(en('banner.rss_fallback', { count: '4' }))
    const retry = button(banners[0], en('banner.retry'))
    expect(retry?.getAttribute('title')).toBe(en('banner.rss_fallback', { count: '4' }))
    click(retry)
    await flush(12)
    expect(callsTo('POST', '/refresh')).toHaveLength(1)
    expect(card(view.container, 2)).not.toBeNull()
  })

  it('RSS down with no alternative path: says it shows what we already have (no promise of arrival), no tooltip', async () => {
    routes['GET /status'] = () => status({ rss_down_since: NOW_S - 2 * 86400, rss_fallback_channels: 0 })
    const view = await mount()
    const text = q(view.container, '[data-part="rss-down"]')?.textContent ?? ''
    const [before, after] = en('banner.rss_down_stale').split('{time}')
    expect(text.startsWith(before) && text.endsWith(after)).toBe(true)
    expect(button(view.container, en('banner.retry'))?.hasAttribute('title')).toBe(false)
  })

  it('extension disconnected with subscribed channels (status.subscribed_total): strip with reconnect (onboarding)', async () => {
    routes['GET /status'] = () => status({ devices_online: 0, subscribed_total: 12 })
    routes['GET /devices'] = () => ({ items: [{ id: 'd1', name: 'Chrome', created_at: NOW_S - 86400, last_seen: NOW_S - 86400, revoked_at: null, origin: null }] })
    const view = await mount()
    const banner = q(view.container, '[data-part="banner"]')
    expect(banner?.textContent).toContain(en('banner.ext_disconnected'))
    click(button(banner!, en('banner.reconnect')))
    expect($dialogStack.get().map((d) => [d.id, d.props])).toEqual([['onboarding', { step: 'pair' }]])
    // the totals come from /status: no GET /channels?limit=1
    expect(callsTo('GET', '/channels')).toHaveLength(0)
  })

  it('no subscribed channels (only followed/demo): no extension strip', async () => {
    routes['GET /status'] = () => status({ devices_online: 0, subscribed_total: 0 })
    const view = await mount()
    expect(q(view.container, '[data-part="banner"]')).toBeNull()
  })

  it('subscribed_total missing (not known yet): no made-up extension strip', async () => {
    routes['GET /status'] = () => statusWithoutTotals({ devices_online: 0 })
    const view = await mount()
    expect(q(view.container, '[data-part="banner"]')).toBeNull()
    expect(card(view.container, 2)).not.toBeNull()
  })
})

// ------------------------------------------------------------------ true empty

describe('zero channels (status.channels_total = 0): welcome with the 3 paths', () => {
  let total = 0
  beforeEach(() => {
    total = 0
    routes['GET /status'] = () => status({ new_total: 0, new_by_tab: [], channels_total: total, subscribed_total: 0 })
    routes['GET /feed'] = () => page([])
    routes['POST /channels/add'] = (req) => {
      const body = req.body as { url_or_handle: string }
      if (body.url_or_handle === '@dup') throw apiError('conflict', 'exists', { channel: { title: 'Veritasium' } })
      if (body.url_or_handle === 'lixo') throw apiError('invalid', 'not a channel')
      if (body.url_or_handle === '@sumiu') throw apiError('youtube_error', 'resolve failed')
      total = 1
      return { ...item(1).channel, title: 'Marques Brownlee', relation: 'followed', source: 'link' }
    }
    routes['POST /demo/load'] = () => {
      total = 40
      return { channels: 40, folders: 6, tags: 0, tabs: 1, videos: 0, skipped: 0, warnings: [] }
    }
  })

  /** Opens the paste field inside the "Paste a channel" card and returns the input. */
  function openPaste(root: HTMLElement): HTMLInputElement {
    const cardEl = qa(root, '[data-part="path-card"]').find((c) => c.textContent?.includes(en('welcome.link_title')))
    expect(cardEl).toBeTruthy()
    if (!q(cardEl!, 'input[name="channel"]')) click(button(cardEl!, en('welcome.link_action')))
    const input = q(cardEl!, 'input[name="channel"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    return input!
  }

  it('channels_total missing from /status (not known yet): skeleton, never welcome by mistake', async () => {
    routes['GET /status'] = () => statusWithoutTotals({ new_total: 0, new_by_tab: [] })
    routes['GET /channels'] = () => ({ items: [], total: 0 })
    const view = await mount()
    expect(qa(view.container, '[data-part="path-card"]')).toHaveLength(0)
    expect(q(view.container, '[data-part="grid"][aria-busy="true"]')).not.toBeNull()
    expect(view.text()).not.toContain(en('empty.tab_title'))
    // the decision belongs to /status: no GET /channels?limit=1
    expect(callsTo('GET', '/channels')).toHaveLength(0)
  })

  it('/status has not arrived yet: skeleton, never welcome', async () => {
    routes['GET /status'] = () => new Promise(() => undefined)
    const view = await mount()
    expect(qa(view.container, '[data-part="path-card"]')).toHaveLength(0)
    expect(q(view.container, '[data-part="grid"][aria-busy="true"]')).not.toBeNull()
  })

  it('channels_total > 0 with an empty feed: empty tab, not welcome', async () => {
    total = 3
    const view = await mount()
    expect(qa(view.container, '[data-part="path-card"]')).toHaveLength(0)
    expect(q(view.container, '[data-part="empty"]')?.textContent).toContain(en('empty.tab_title'))
  })

  it('shows the 3 paths; connect extension opens onboarding', async () => {
    const view = await mount()
    const paths = qa(view.container, '[data-part="path-card"]')
    expect(paths).toHaveLength(3)
    expect(paths[0].getAttribute('data-primary')).toBe('true')
    expect(paths[0].getAttribute('data-recommended')).toBe('true')
    expect(q(view.container, '[data-part="grid"]')).toBeNull()
    click(button(paths[0], en('welcome.pair_action')))
    expect($dialogStack.get().map((d) => [d.id, d.props])).toEqual([['onboarding', { step: 'pair' }]])
  })

  it('welcome: centered Hero (title + product line), max width, nothing repeated', async () => {
    const view = await mount()
    expect(q(view.container, '[data-part="page"]')?.getAttribute('data-narrow')).toBe('true')
    const hero = q(view.container, '[data-part="hero"]')
    expect(hero?.querySelector('h1')?.textContent).toBe('Welcome')
    expect(hero?.textContent).toContain('Your subscriptions. Your way.')
    // no page header nor a loose "Follow a channel" section: the field lives in the card
    expect(q(view.container, '[data-part="page-head"]')).toBeNull()
    expect(q(view.container, '[data-part="section"]')).toBeNull()
    expect(qa(view.container, 'input')).toHaveLength(0)
    // the product line appears only once
    expect(view.text().split('Your subscriptions. Your way.').length - 1).toBe(1)
  })

  it('paste a channel: the field opens INSIDE the card, with the whole example and focus', async () => {
    const view = await mount()
    const input = openPaste(view.container)
    expect(input.getAttribute('placeholder')).toBe(en('welcome.link_placeholder'))
    expect(document.activeElement).toBe(input)
    // the open button goes away; the submit stays
    expect(button(view.container, en('welcome.link_action'))).toBeNull()
    expect(button(view.container, en('welcome.link_submit'))).not.toBeNull()
  })

  it('paste link: invalid, duplicate (conflict) and youtube_error with a readable error; success makes the channel appear', async () => {
    const view = await mount()
    const input = openPaste(view.container)
    const submit = () => click(button(view.container, en('welcome.link_submit')))
    typeInto(input, 'lixo')
    submit()
    await flush(12)
    expect(q(view.container, '[data-part="link-error"]')?.textContent).toBe(en('welcome.errors.invalid'))
    typeInto(input, '@dup')
    submit()
    await flush(12)
    expect(q(view.container, '[data-part="link-error"]')?.textContent).toBe(en('welcome.errors.conflict', { title: 'Veritasium' }))
    typeInto(input, '@sumiu')
    submit()
    await flush(12)
    expect(q(view.container, '[data-part="link-error"]')?.textContent).toBe(en('welcome.errors.youtube_error'))
    typeInto(input, '@mkbhd')
    submit()
    await flush(20)
    expect(callsTo('POST', '/channels/add').at(-1)?.body).toEqual({ url_or_handle: '@mkbhd' })
    // the channel came in: leaves the welcome, the arriving strip shows the channel name
    expect(qa(view.container, '[data-part="path-card"]')).toHaveLength(0)
    expect(q(view.container, '[data-part="banner"]')?.textContent).toContain(en('banner.channel_arriving', { title: 'Marques Brownlee' }))
  })

  it('an empty field does not call the route and explains', async () => {
    const view = await mount()
    openPaste(view.container)
    click(button(view.container, en('welcome.link_submit')))
    await flush()
    expect(callsTo('POST', '/channels/add')).toHaveLength(0)
    expect(q(view.container, '[data-part="link-error"]')?.textContent).toBe(en('welcome.errors.empty'))
  })

  it('demo: POST /demo/load, refreshes right away and shows progress while the videos arrive', async () => {
    let feedItems: FeedItem[] = []
    routes['GET /feed'] = () => page(feedItems)
    routes['GET /status'] = () => status({ refresh_running: true, new_by_tab: [], channels_total: total, subscribed_total: 0 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    const view = await mount()
    click(button(view.container, en('welcome.demo_action')))
    await flush(20)
    expect(callsTo('POST', '/demo/load')).toHaveLength(1)
    expect(callsTo('POST', '/refresh')).toHaveLength(1)
    expect(qa(view.container, '[data-part="path-card"]')).toHaveLength(0)
    const banner = () => q(view.container, '[data-part="banner"]')
    expect(banner()?.textContent).toContain(en('banner.demo_arriving', { count: '0', channels: '40' }))
    // while arriving: skeleton (not "nothing new")
    expect(q(view.container, '[data-part="grid"][aria-busy="true"]')).not.toBeNull()
    expect(view.text()).not.toContain(en('empty.tab_title'))
    feedItems = [item(1), item(2)]
    await advance(3500)
    await flush(12)
    expect(card(view.container, 2)).not.toBeNull()
    expect(banner()?.textContent).toContain(en('banner.demo_arriving', { count: '2', channels: '40' }))
  })

  it('a demo that fails notifies and stays on the welcome', async () => {
    routes['POST /demo/load'] = () => {
      throw apiError('conflict', 'already')
    }
    const view = await mount()
    click(button(view.container, en('welcome.demo_action')))
    await flush(12)
    expect(lastNotification().kind).toBe('error')
    expect(qa(view.container, '[data-part="path-card"]')).toHaveLength(3)
  })
})

// ------------------------------------------------------------------ preview scenarios

describe('preview scenarios (pages/home/preview.scenarios.tsx)', () => {
  /** Mini collector: the scenario's `rest` map becomes the fake backend (same rule as the collector: value = `data`). */
  function useScenarioRoutes(rest: Record<string, unknown>): void {
    routes = {}
    for (const [k, v] of Object.entries(rest))
      routes[k] = (req) => (typeof v === 'function' ? (v as (r: unknown) => unknown)({ path: {}, query: req.query, body: req.body }) : v)
  }

  const EXPECT: Record<string, string> = {
    'home-comfortable': '[data-variant="featured"]',
    'home-compact': '[data-part="grid"][data-density="compact"] [data-video]',
    'home-list': '[data-variant="row"][data-video]',
    'home-theme-tab': '[data-via="hn"]',
    'home-later': '[data-video="eyZEqSPeMwg"]',
    'home-tab-empty': '[data-part="empty"]',
    'home-welcome': '[data-part="path-card"]',
    'home-loading': '[data-part="tabbar"][data-skeleton]',
    'home-loading-feed': '[data-part="grid"][aria-busy="true"]',
    'home-error': '[data-part="error"]',
    'home-rss-down': '[data-part="banner"][data-tone="warning"]',
    'home-ext-disconnected': '[data-part="banner"][data-tone="info"]',
    'home-refreshing': '[data-part="grid"][data-density="list"]',
    'home-new-tab-menu': '[data-part="tabbar"] [data-part="tab-add-slot"] [role="menu"]',
    'home-pane-filter': '[data-part="pane-filter"]',
    'home-search': '[data-part="filterbar"] [data-slot="search-field"]',
    'home-search-empty': '[data-part="search-empty"] [data-part="empty"]',
    'home-seen-in-place': '[data-part="featured-slot"] [data-variant="featured"][data-state="watched"]',
    'home-tab-menu': '[data-part="tabbar"] [data-tab-cell="tab_science"] [role="menu"] [data-menu="delete"]',
    'home-tab-delete': '[data-slot="confirm-dialog"]',
    'home-quick-tip': '[data-preview-tip-open] [data-part="grid"] [data-action="watched"][data-tip]',
    'home-marks-comfortable': '[data-part="grid"][data-density="comfortable"] [data-part="thumb"] [data-part="thumb-mark"][data-kind="short"]',
    'home-marks-compact': '[data-part="grid"][data-density="compact"] [data-part="thumb"] [data-part="thumb-mark"][data-kind="unknown"]',
    'home-marks-list': '[data-part="grid"][data-density="list"] [data-part="meta"] [data-part="thumb-mark"][data-kind="video"]',
    'home-group-channel': '[data-part="feed-groups"][data-group-by="channel"] [data-part="group-head"] [data-part="avatar"]',
    'home-group-day': '[data-part="feed-groups"][data-group-by="day"] [data-part="group-head"]',
    'home-sort-menu': '[data-part="view-controls"] [role="menu"] [data-sort="longest"][aria-checked="true"]'
  }

  it('scenarios use the newer routes (server search, Watch later through the feed, totals in /status)', async () => {
    const { scenarios } = await import('../pages/home/preview.scenarios')
    for (const s of scenarios) {
      const rest = s.rest ?? {}
      expect(Object.keys(rest), s.id).not.toContain('GET /videos/state')
      expect(Object.keys(rest), s.id).not.toContain('GET /videos')
      expect(Object.keys(rest), s.id).not.toContain('GET /channels')
      const st = rest['GET /status']
      if (st && typeof st === 'object') expect(typeof (st as StatusResponse).channels_total, s.id).toBe('number')
    }
    const base = scenarios.find((x) => x.id === 'home-comfortable')!.rest!['GET /feed'] as (r: unknown) => FeedPage
    const later = base({ query: { state: 'later' } })
    expect(later.items.length).toBeGreaterThan(0)
    for (const it of later.items) expect(it.state).toBe('later')
    expect(later.items.every((it) => it.why)).toBe(true)
    const found = base({ query: { tab: 'all-new', q: 'neural' } })
    expect(found.counts.total).toBe(found.items.length)
    expect(found.items.length).toBeGreaterThan(0)
    for (const it of found.items) expect(`${it.video.title} ${it.channel?.title}`.toLowerCase()).toContain('neural')
    // the search scenarios open with the text in the field
    for (const id of ['home-search', 'home-search-empty']) {
      queryClient.clear()
      useScenarioRoutes(scenarios.find((x) => x.id === id)!.rest ?? {})
      const view = render(<>{scenarios.find((x) => x.id === id)!.render()}</>)
      await flush(12)
      expect((q(view.container, '[data-slot="search-field"]') as HTMLInputElement | null)?.value, id).toBeTruthy()
      expect(calls.some((c) => c.path === '/feed' && c.query.q), id).toBe(true)
      view.unmount()
    }
  })

  it('each scenario renders the state it promises, with no raw translation key', async () => {
    const { scenarios } = await import('../pages/home/preview.scenarios')
    expect(scenarios.map((s) => s.id).sort()).toEqual(Object.keys(EXPECT).sort())
    for (const s of scenarios) {
      expect(s.widths).toEqual([420, 900, 1440])
      queryClient.clear() // each scenario is a new page (no cache from the previous one)
      useScenarioRoutes(s.rest ?? {})
      const view = render(<>{s.render()}</>)
      await flush(12)
      expect(q(view.container, EXPECT[s.id]), s.id).not.toBeNull()
      expect(view.text(), s.id).not.toMatch(/\bhome\.[a-z_]+\./)
      // menu closed in every scenario that is not the menu one (the stand-in must not always draw the content)
      if (s.id !== 'home-new-tab-menu' && s.id !== 'home-tab-menu' && s.id !== 'home-sort-menu') expect(q(view.container, '[role="menu"]'), s.id).toBeNull()
      // real avatars: every channel with a card on screen has a photo (no letters only)
      const avatars = qa(view.container, '[data-part="avatar"]').filter((a) => !a.closest('[data-skeleton], [aria-busy="true"]'))
      if (avatars.length) expect(avatars.filter((a) => a.matches('img[data-avatar]')).length, s.id).toBe(avatars.length)
      view.unmount()
    }
  }, 20_000)

  it('the scenarios\' GET /feed sorts by group and then by sort (the server rule); cards with and without duration/type', async () => {
    const { scenarios } = await import('../pages/home/preview.scenarios')
    const feed = scenarios.find((x) => x.id === 'home-comfortable')!.rest!['GET /feed'] as (r: unknown) => FeedPage
    const runs = (items: FeedItem[], key: (it: FeedItem) => string) => items.map(key).filter((k, i, a) => i === 0 || a[i - 1] !== k)
    const byChannel = feed({ query: { tab: 'all-new', group: 'channel' } }).items
    const chans = runs(byChannel, (it) => it.channel?.title ?? '')
    expect(new Set(chans).size).toBe(chans.length) // each channel in a single run
    expect([...chans]).toEqual([...chans].sort((a, b) => a.localeCompare(b)))
    const longest = feed({ query: { tab: 'all-new', sort: 'longest' } }).items.map((it) => it.video.duration_s ?? -1)
    expect(longest).toEqual([...longest].sort((a, b) => b - a))
    const days = feed({ query: { tab: 'all-new', group: 'day', tz_offset_min: '-180' } }).items.map((it) => Math.floor(((it.video.published_at ?? 0) - 180 * 60) / 86400))
    expect(days).toEqual([...days].sort((a, b) => b - a))
    // mark scenarios: there is a card without duration, without type, a Short without duration and a video with duration
    const marks = scenarios.find((x) => x.id === 'home-marks-compact')!.rest!['GET /feed'] as (r: unknown) => FeedPage
    const vids = marks({ query: { tab: 'all-new' } }).items.map((it) => [it.video.duration_s == null, it.video.is_short])
    for (const want of [[true, null], [false, null], [true, true], [false, false]]) expect(vids, JSON.stringify(want)).toContainEqual(want)
  })

  it('the scenarios\' channels use the demo\'s real photo (yt3)', async () => {
    const { scenarios } = await import('../pages/home/preview.scenarios')
    const s = scenarios.find((x) => x.id === 'home-comfortable')!
    const feed = (s.rest!['GET /feed'] as (r: unknown) => FeedPage)({ query: { tab: 'all-new' } })
    const thumbs = feed.items.map((i) => i.channel?.thumb ?? '')
    expect(thumbs.length).toBeGreaterThan(0)
    for (const t of thumbs) expect(t).toMatch(/^https:\/\/yt3\.(googleusercontent|ggpht)\.com\//)
  })
})

// ------------------------------------------------------------------ visual review

describe('header and "+ New tab"', () => {
  it('a single "+ New tab": none in the header; the tab bar\'s one opens the menu anchored to it', async () => {
    const view = await mount()
    const head = q(view.container, '[data-part="page-head"]')!
    // header: only Extras and Refresh (+ the pane icon); Subscriptions is read-only (no accent button)
    const textButtons = qa(head, 'button').filter((b) => b.getAttribute('data-part') !== 'pane-toggle')
    expect(textButtons.map((b) => (b.textContent ?? '').trim())).toEqual([...(EXTRAS_PAGE_READY ? [en('actions.extras')] : []), en('actions.refresh')])
    expect(qa(head, '[data-part="pane-toggle"]')).toHaveLength(1)
    expect(qa(view.container, '[data-slot="button"][data-variant="default"]')).toHaveLength(0)
    const triggers = qa(view.container, 'button').filter((b) => (b.textContent ?? '').includes(en('actions.new_tab')))
    expect(triggers).toHaveLength(1)
    const slot = q(view.container, '[data-part="tabbar"] [data-part="tab-add-slot"]')
    expect(slot?.contains(triggers[0])).toBe(true)
    // the kit default does not show alongside
    expect(q(view.container, '[data-part="tabbar"] [data-part="tab-add"]')).toBeNull()
    // closed until clicked; opens in the same place (anchored), closes on choosing
    expect(q(view.container, '[role="menu"]')).toBeNull()
    expect(triggers[0].getAttribute('aria-expanded')).toBe('false')
    click(triggers[0])
    const menu = q(view.container, '[role="menu"]')
    expect(slot?.contains(menu)).toBe(true)
    expect(qa(menu!, '[role="menuitem"]').map((m) => m.getAttribute('data-entry'))).toEqual(['category', 'channels', 'theme', 'mixed'])
    click(q(menu!, '[data-entry="mixed"]'))
    expect(q(view.container, '[role="menu"]')).toBeNull()
    expect($dialogStack.get().map((d) => [d.id, d.props])).toEqual([['tab-editor', { preset: { kind: 'mixed' } }]])
  })

  it('a tab with its own emoji shows only the emoji (no type icon); without an emoji, the type icon', async () => {
    routes['GET /tabs'] = () => ({
      items: [...TABS, { id: 'tab_ai', name: 'Agentes de IA', kind: 'theme', rules: rules({ themes: ['th'] }), icon: '🤖', filters: {}, sort: 5, builtin: false }]
    })
    const view = await mount()
    const ai = q(view.container, '[data-tab-id="tab_ai"]')!
    expect(ai.textContent?.trim()).toBe('🤖 Agentes de IA')
    expect(q(ai, '[data-slot="codicon"]')).toBeNull()
    expect(q(view.container, '[data-tab-id="tab_tech"] [data-slot="codicon"]')?.getAttribute('data-icon')).toBe('folder')
    // the Favorites ⭐ is its own emoji: a single icon
    const fav = q(view.container, '[data-tab-id="favorites"]')!
    expect(qa(fav, '[data-slot="codicon"]').length + ((fav.textContent ?? '').includes('⭐') ? 1 : 0)).toBe(1)
  })
})

describe('filters and reason', () => {
  it('filter chips are controls: aria-pressed, visible active state (kit chip) and they toggle', async () => {
    const view = await mount(<HomeView initialDensity="compact" />)
    const chips = qa(view.container, '[data-part="filterbar"] button[aria-pressed]')
    expect(chips.map((c) => (c.textContent ?? '').trim())).toEqual([en('filters.new_only'), en('filters.no_shorts'), en('filters.show_seen')])
    for (const c of chips) {
      expect(c.className).toContain(`${PLUGIN_ID.toLowerCase()}`)
      expect(c.className).toMatch(/-chip\b/)
      expect(c.getAttribute('aria-pressed')).toBe('false')
      expect(c.hasAttribute('data-active')).toBe(false)
    }
    click(chips[1])
    const on = qa(view.container, '[data-part="filterbar"] button[aria-pressed="true"]')
    expect(on.map((c) => (c.textContent ?? '').trim())).toEqual([en('filters.no_shorts')])
    expect(on[0].getAttribute('data-active')).toBe('true')
    // on swaps the icon for the check mark (does not rely on color only)
    expect(q(on[0], '[data-slot="codicon"]')?.getAttribute('data-icon')).toBe('check')
    click(on[0])
    expect(qa(view.container, '[data-part="filterbar"] button[aria-pressed="true"]')).toHaveLength(0)
  })

  it('compact: "why it is here" with only the main part, whole (no complement)', async () => {
    routes['GET /feed'] = () =>
      page([
        item(1, { why: { via: 'hn', label: 'HN: melhor ponto de partida para backprop', detail: null } }),
        item(2, { why: { via: 'theme', label: 'Agentes de IA', detail: 'citado 3× nas buscas' } }),
        item(3, { why: { via: 'folder', label: 'Ciência', detail: 'IA' } })
      ])
    const compact = await mount(<HomeView initialDensity="compact" />)
    const whys = qa(compact.container, '[data-part="grid"] [data-part="why"]')
    const shown = (w: HTMLElement) => [...w.children].filter((c) => !c.className.includes('-sr')).map((c) => c.textContent ?? '').join('').trim()
    expect(whys.map(shown)).toEqual(['HN', 'Agentes de IA', 'Ciência'])
    compact.unmount()
    // comfortable and list keep the full reason
    const list = await mount(<HomeView initialDensity="list" />)
    expect(list.text()).toContain('citado 3× nas buscas')
    expect(list.text()).toContain('HN: melhor ponto de partida para backprop')
  })

  it('narrow (< 560 px): density becomes icons with an accessible label and state', async () => {
    class NarrowRO {
      constructor(private readonly cb: (entries: Array<{ contentRect: { width: number }; target: Element }>) => void) {}
      observe(el: Element) {
        this.cb([{ contentRect: { width: 400 }, target: el }])
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NarrowRO)
    const view = await mount(<HomeView initialDensity="comfortable" />)
    const group = q(view.container, '[data-part="density-icons"]')
    expect(group).not.toBeNull()
    expect(q(view.container, '[data-part="mode"]')).toBeNull()
    const btns = qa(group!, 'button')
    expect(btns.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    for (const b of btns) expect(b.getAttribute('aria-label')).toBeTruthy()
    click(btns[2])
    expect(q(view.container, '[data-part="grid"]')?.getAttribute('data-density')).toBe('list')
    expect(handle.storage.get(STORAGE_KEYS.density)).toBe('list')
  })
})

describe('pane → Subscriptions (an open Subscriptions follows it)', () => {
  const FOLDERS = [
    { id: 'f_tech', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
    { id: 'f_music', name: 'Música', parent_id: null, color: null, sort: 1 }
  ]

  beforeEach(() => {
    routes['GET /folders'] = () => ({ items: FOLDERS })
    routes['GET /channels/{id}'] = (req) => ({ channel: { ...item(1).channel, id: req.path.split('/').pop(), title: 'Veritasium' }, new_count: 2, watched_90d: null })
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('the pane saves another tab while Subscriptions is open → Subscriptions switches tab by itself', async () => {
    const view = await mount()
    expect(callsTo('GET', '/feed').at(-1)?.query.tab).toBe('all-new')
    handle.storage.set(STORAGE_KEYS.tab, 'tab_tech')
    await advance(1000)
    await flush(12)
    expect(callsTo('GET', '/feed').at(-1)?.query.tab).toBe('tab_tech')
    expect(card(view.container, 50)).not.toBeNull()
    // a switch coming from the pane is not saved again by Subscriptions (no echo)
    expect(handle.storage.get(STORAGE_KEYS.tab)).toBe('tab_tech')
  })

  it('folder without a tab → temporary filtered feed with "Filtering by: X ✕" and "Create tab from this"', async () => {
    const view = await mount()
    handle.storage.set('pane.target', { kind: 'folder', id: 'f_music', at: Date.now() })
    await advance(1000)
    await flush(12)
    expect(callsTo('GET', '/feed').at(-1)?.query).toMatchObject({ folder: 'f_music' })
    expect(callsTo('GET', '/feed').at(-1)?.query.tab).toBeUndefined()
    const chip = q(view.container, '[data-part="pane-filter"]')
    expect(chip?.textContent).toContain(en('pane_filter.label', { name: 'Música' }))
    // no tab is active while filtering
    click(button(chip!, en('pane_filter.create_tab')))
    expect($dialogStack.get().map((d) => [d.id, d.props])).toEqual([
      ['tab-editor', { preset: { name: 'Música', kind: 'category', rules: { include: { folders: ['f_music'] } } } }]
    ])
    // ✕ goes back to the previous tab
    click(q(chip!, '[data-part="pane-filter-clear"]'))
    await flush(12)
    expect(q(view.container, '[data-part="pane-filter"]')).toBeNull()
    expect(callsTo('GET', '/feed').at(-1)?.query.tab).toBe('all-new')
  })

  it('channel without a tab → filters by channel (name from GET /channels/{id}); picking a tab leaves the filter', async () => {
    const view = await mount()
    handle.storage.set('pane.target', { kind: 'channel', id: 'UCHnyfMqiRRG1u-2MsSQLbXA', at: Date.now() })
    await advance(1000)
    await flush(12)
    expect(callsTo('GET', '/feed').at(-1)?.query).toMatchObject({ channel: 'UCHnyfMqiRRG1u-2MsSQLbXA' })
    expect(q(view.container, '[data-part="pane-filter"]')?.textContent).toContain(en('pane_filter.label', { name: 'Veritasium' }))
    click(q(view.container, '[data-tab-id="tab_tech"]'))
    await flush(12)
    expect(q(view.container, '[data-part="pane-filter"]')).toBeNull()
    expect(callsTo('GET', '/feed').at(-1)?.query.tab).toBe('tab_tech')
  })

  it('folder with its own tab → goes to the tab (no filter)', async () => {
    const view = await mount()
    handle.storage.set('pane.target', { kind: 'folder', id: 'f_tech', at: Date.now() })
    await advance(1000)
    await flush(12)
    expect(q(view.container, '[data-part="pane-filter"]')).toBeNull()
    expect(callsTo('GET', '/feed').at(-1)?.query.tab).toBe('tab_tech')
  })

  it('a pane request made right before opening Subscriptions applies on mount; an old request does not', async () => {
    handle.storage.set('pane.target', { kind: 'folder', id: 'f_music', at: Date.now() - 500 })
    const view = await mount()
    await flush(12)
    expect(q(view.container, '[data-part="pane-filter"]')).not.toBeNull()
    view.unmount()
    handle.storage.set('pane.target', { kind: 'folder', id: 'f_music', at: Date.now() - 10 * 60_000 })
    const again = await mount()
    await flush(12)
    expect(q(again.container, '[data-part="pane-filter"]')).toBeNull()
  })
})

// ------------------------------------------------------------------ text

type Leaf = { [k: string]: Leaf | string }
function leafKeys(tree: Leaf, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)))
}

describe('Subscriptions text', () => {
  it('home.json: same keys in EN and PT-BR, none empty', () => {
    const enKeys = leafKeys(enHome as unknown as Leaf).sort()
    expect(enKeys.length).toBeGreaterThan(40)
    expect(leafKeys(ptHome as unknown as Leaf).sort()).toEqual(enKeys)
    for (const tree of [enHome, ptHome] as unknown as Leaf[])
      for (const k of leafKeys(tree)) {
        let node: Leaf | string = tree
        for (const p of k.split('.')) node = (node as Leaf)[p]
        expect(String(node).trim(), k).not.toBe('')
      }
  })

  it('every t(...) key used in the Subscriptions screens exists in home.json (no hard-coded text)', () => {
    const enKeys = new Set(leafKeys(enHome as unknown as Leaf))
    const files = listRepoFiles('desktop-src/pages/home', ['.tsx', '.ts']).filter((f) => !f.endsWith('preview.scenarios.tsx'))
    const used = new Set<string>()
    for (const f of files) for (const m of readRepoFile(f).matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1])
    expect(used.size).toBeGreaterThan(20)
    expect([...used].filter((k) => !enKeys.has(k))).toEqual([])
  })

  it('in PT-BR Subscriptions comes out in Portuguese', async () => {
    sdkMock.locale.set('pt-BR')
    const view = await mount()
    expect(view.text()).toContain((ptHome as unknown as Leaf).title as string)
    expect(view.text()).toContain(((ptHome as unknown as Leaf).tabs as Leaf).later as string)
  })
})

// ------------------------------------------------------------------ "watched" undoes and nothing moves

describe('action on the card: nothing moves, the 2nd click undoes', () => {
  /** Stateful server: `POST /videos/state` changes the video; `/status` counts the real new videos. */
  function statefulServer(items: FeedItem[]) {
    const state = new Map(items.map((it) => [it.video.id, it.state]))
    const fresh = () => items.filter((it) => state.get(it.video.id) === 'new').length
    routes['GET /feed'] = () => page(items.map((it) => ({ ...it, state: state.get(it.video.id)!, is_new: state.get(it.video.id) === 'new' })))
    routes['POST /videos/state'] = (req) => {
      const body = req.body as { video_ids: string[]; state?: FeedItem['state'] }
      if (body.state) for (const id of body.video_ids) state.set(id, body.state)
      return { changed: 1 }
    }
    routes['GET /status'] = () =>
      status({ new_total: fresh() + 10, new_by_tab: [{ tab_id: 'all-new', name: 'Tudo novo', count: fresh(), icon: null }] })
    return state
  }
  const featuredId = (root: ParentNode) => q(root, '[data-variant="featured"]')?.getAttribute('data-video')
  const tabCount = (root: ParentNode) => q(root, '[data-tab-id="all-new"] [data-part="tab-count"]')?.textContent ?? null
  const ckit = (k: string) => (enCommon as unknown as { kit: { actions: Record<string, string> } }).kit.actions[k]

  it('highlight: marking as watched does NOT swap the highlighted video (the next click lands on the same button)', async () => {
    statefulServer([item(1), item(2), item(3)])
    const view = await mount()
    expect(featuredId(view.container)).toBe(vid(1))
    const btn = () => q(q(view.container, '[data-variant="featured"]')!, '[data-action="watched"]')!
    click(btn())
    await flush(12)
    expect(featuredId(view.container)).toBe(vid(1))
    expect(q(view.container, '[data-variant="featured"]')?.getAttribute('data-state')).toBe('watched')
    expect(cards(view.container)).toEqual([vid(2), vid(3)])
    // the 2nd click in the same place undoes (does not open the video, does not send `seen`)
    click(btn())
    await flush(12)
    expect(sdkMock.openedExternal).toHaveLength(0)
    expect(featuredId(view.container)).toBe(vid(1))
    expect(q(view.container, '[data-variant="featured"]')?.getAttribute('data-new')).toBe('true')
    expect(callsTo('POST', '/videos/state').map((c) => c.body)).toEqual([
      { video_ids: [vid(1)], state: 'watched' },
      { video_ids: [vid(1)], state: 'new' }
    ])
  })

  it('"Watched" and "Later" go back to the previous state (new is new again), with aria-pressed and a label of what the click will do', async () => {
    statefulServer([item(1), item(2), item(3)])
    const view = await mount()
    const w = () => q(card(view.container, 2)!, '[data-action="watched"]')!
    expect(w().getAttribute('aria-pressed')).toBe('false')
    expect(w().getAttribute('aria-label')).toBe(`${ckit('watched_do')} (w)`)
    click(w())
    await flush(12)
    expect(w().getAttribute('aria-pressed')).toBe('true')
    expect(w().getAttribute('aria-label')).toBe(`${ckit('watched_undo')} (w)`)
    click(w())
    await flush(12)
    expect(card(view.container, 2)?.getAttribute('data-state')).toBe('new')
    expect(card(view.container, 2)?.getAttribute('data-new')).toBe('true')
    const l = () => q(card(view.container, 3)!, '[data-action="later"]')!
    click(l())
    await flush(12)
    expect(l().getAttribute('aria-label')).toBe(`${ckit('later_undo')} (l)`)
    click(l())
    await flush(12)
    expect(card(view.container, 3)?.getAttribute('data-state')).toBe('new')
    expect(callsTo('POST', '/videos/state').map((c) => c.body)).toEqual([
      { video_ids: [vid(2)], state: 'watched' },
      { video_ids: [vid(2)], state: 'new' },
      { video_ids: [vid(3)], state: 'later' },
      { video_ids: [vid(3)], state: 'new' }
    ])
    // the notice with "Undo" stays
    expect(lastNotification().action?.label).toBe(en('toast.undo'))
  })

  it('watched on a video that already came watched from the server: turning it off sends `seen` (no previous state to remember)', async () => {
    statefulServer([item(1), item(2, { state: 'watched', is_new: false }), item(3)])
    const view = await mount()
    click(q(card(view.container, 2)!, '[data-action="watched"]'))
    await flush(12)
    expect(callsTo('POST', '/videos/state').map((c) => c.body)).toEqual([{ video_ids: [vid(2)], state: 'seen' }])
  })

  it('counters (tab and header) follow the change and its undo', async () => {
    statefulServer([item(1), item(2), item(3)])
    const view = await mount()
    expect(tabCount(view.container)).toBe('3')
    expect(view.text()).toContain(en('subtitle.new', { count: '13' }))
    click(q(card(view.container, 2)!, '[data-action="watched"]'))
    await flush(12)
    expect(tabCount(view.container)).toBe('2')
    expect(view.text()).toContain(en('subtitle.new', { count: '12' }))
    click(q(card(view.container, 2)!, '[data-action="watched"]'))
    await flush(12)
    expect(tabCount(view.container)).toBe('3')
    expect(view.text()).toContain(en('subtitle.new', { count: '13' }))
  })

  it('"Only new": the marked item stays in place (dimmed, with the badge) until the filter changes', async () => {
    statefulServer([item(1), item(2), item(3)])
    const view = await mount()
    click(button(view.container, en('filters.new_only')))
    await flush(12)
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3)])
    click(q(card(view.container, 2)!, '[data-action="watched"]'))
    await flush(12)
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3)])
    expect(card(view.container, 2)?.getAttribute('data-state')).toBe('watched')
    // the hover actions stay on the same card
    expect(qa(card(view.container, 2)!, '[data-action]').map((b) => b.getAttribute('data-action'))).toEqual(['watched', 'later', 'archive', 'up', 'down', 'playlist'])
    // changing the filter (off and on) → then it leaves
    click(button(view.container, en('filters.new_only')))
    click(button(view.container, en('filters.new_only')))
    await flush(12)
    expect(cards(view.container)).toEqual([vid(1), vid(3)])
  })

  it('archive by click: the place shows "Archived · Undo"; no button of another video falls under the cursor', async () => {
    statefulServer([item(1), item(2), item(3), item(4)])
    const view = await mount()
    const cellOf = (n: number) => q(view.container, `[role="gridcell"][data-key="${vid(n)}"]`)
    const slot = () => q(view.container, '[role="gridcell"][data-index="0"]')!
    expect(slot().getAttribute('data-key')).toBe(vid(2))
    click(q(card(view.container, 2)!, '[data-action="archive"]'))
    await flush(12)
    // the card leaves (no longer a card), but the place stays its own: the neighbour does not move up
    expect(cards(view.container)).toEqual([vid(3), vid(4)])
    expect(slot().getAttribute('data-key')).toBe(vid(2))
    expect(q(slot(), '[data-part="card-gone"]')).not.toBeNull()
    // under the cursor there is only this video's "Undo"; no action button of another card
    // (the card underneath only keeps the geometry: invisible and inert)
    const live = (sel: string) => qa(slot(), sel).filter((el) => !el.closest('[inert]'))
    expect(live('[data-action]')).toHaveLength(0)
    expect(live('a[data-open-video]')).toHaveLength(0)
    expect(live('button').map((b) => b.textContent)).toEqual([en('gone.undo')])
    expect(cellOf(3)?.getAttribute('data-index')).toBe('1')
    click(button(slot(), en('gone.undo')))
    await flush(12)
    expect(cards(view.container)).toEqual([vid(2), vid(3), vid(4)])
    expect(callsTo('POST', '/videos/state').map((c) => c.body)).toEqual([
      { video_ids: [vid(2)], state: 'archived' },
      { video_ids: [vid(2)], state: 'new' }
    ])
  })

  it('archiving the highlight by click: the highlight does not move to another video (the place shows the archived one)', async () => {
    statefulServer([item(1), item(2), item(3)])
    const view = await mount()
    click(q(q(view.container, '[data-variant="featured"]')!, '[data-action="archive"]'))
    await flush(12)
    const section = q(view.container, '[data-part="featured-slot"]')!
    expect(q(section, '[data-part="card-gone"]')).not.toBeNull()
    expect(qa(section, '[data-action]').filter((el) => !el.closest('[inert]'))).toHaveLength(0)
    expect(q(section, '[inert] [data-variant="featured"]')?.getAttribute('data-video')).toBe(vid(1))
    expect(cards(view.container)).toEqual([vid(2), vid(3)])
  })

  it('scenario home-seen-in-place: watched highlight in place, one archived place and one in Watch later', async () => {
    const { scenarios } = await import('../pages/home/preview.scenarios')
    const s = scenarios.find((x) => x.id === 'home-seen-in-place')!
    routes = {}
    for (const [k, v] of Object.entries(s.rest ?? {}))
      routes[k] = (req) => (typeof v === 'function' ? (v as (r: unknown) => unknown)({ path: {}, query: req.query, body: req.body }) : v)
    const view = render(<>{s.render()}</>)
    await flush(16)
    expect(q(view.container, '[data-part="featured-slot"] [data-variant="featured"]')?.getAttribute('data-state')).toBe('watched')
    expect(qa(view.container, '[data-part="grid"] [data-part="card-gone"]')).toHaveLength(1)
    expect(qa(view.container, '[data-part="grid"] [data-part="card"][data-state="later"]').length).toBeGreaterThan(0)
  })

  it('switching tabs and back: the highlight and the watched items reorganize (only then)', async () => {
    statefulServer([item(1), item(2), item(3)])
    const view = await mount()
    click(q(q(view.container, '[data-variant="featured"]')!, '[data-action="watched"]'))
    await flush(12)
    expect(featuredId(view.container)).toBe(vid(1))
    click(q(view.container, '[data-tab-id="tab_tech"]'))
    await flush(12)
    click(q(view.container, '[data-tab-id="all-new"]'))
    await flush(12)
    expect(featuredId(view.container)).toBe(vid(2))
  })
})

// ------------------------------------------------------------------ quick tooltips on the actions

describe('tooltips of the video actions', () => {
  it('grid, compact and list: every quick action has a tooltip with name + shortcut; the featured card (labelled) does not', async () => {
    for (const density of ['comfortable', 'compact', 'list'] as const) {
      const view = await mount(<HomeView initialDensity={density} />)
      const inGrid = qa(view.container, '[data-part="grid"] [data-part="quick"] button')
      expect(inGrid.length, density).toBeGreaterThan(0)
      for (const b of inGrid) expect(b.getAttribute('data-tip'), density).toMatch(/ · [A-Z]$/)
      expect(qa(view.container, '[data-part="grid"] [data-part="quick"] [title]'), density).toHaveLength(0)
      expect(qa(view.container, '[data-variant="featured"] [data-tip]')).toHaveLength(0)
      view.unmount()
    }
  })

  it('the tooltip does not steal the click: clicking the button with a tooltip marks as watched', async () => {
    const view = await mount(<HomeView initialDensity="compact" />)
    const b = q(card(view.container, 2)!, '[data-action="watched"]')!
    expect(b.getAttribute('data-tip')).toBe(`${(enCommon as unknown as { kit: { actions: Record<string, string> } }).kit.actions.watched_do} · W`)
    click(b)
    await flush(12)
    expect(callsTo('POST', '/videos/state')).toHaveLength(1)
    expect(sdkMock.openedExternal).toHaveLength(0)
  })
})

// ------------------------------------------------------------------ tab management

describe('tab management in Subscriptions', () => {
  const order = (root: ParentNode) => qa(root, '[data-tab-id]').map((t) => t.getAttribute('data-tab-id'))
  const tabEl = (root: ParentNode, id: string) => q(root, `[data-tab-id="${id}"]`)!
  const menuLabels = (root: ParentNode) => qa(root, '[role="menuitem"]').map((m) => (m.textContent ?? '').trim())
  const openMenu = (root: ParentNode, id: string) =>
    act(() => {
      tabEl(root, id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
  const pick = (root: ParentNode, label: string) => click(qa(root, '[role="menuitem"]').find((m) => (m.textContent ?? '').trim() === label) ?? null)

  function dragTo(from: Element, to: Element): void {
    const store: Record<string, string> = {}
    const dt = { setData: (k: string, v: string) => void (store[k] = v), getData: (k: string) => store[k] ?? '', effectAllowed: 'move', dropEffect: 'move' }
    for (const [el, type] of [[from, 'dragstart'], [to, 'dragenter'], [to, 'dragover'], [to, 'drop'], [from, 'dragend']] as const) {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      act(() => {
        el.dispatchEvent(ev)
      })
    }
  }

  it('tab menu: Edit… opens the editor with the id; move; Delete… only on a tab that is not built-in; "Watch later" has no menu', async () => {
    const view = await mount()
    openMenu(view.container, 'tab_tech')
    expect(menuLabels(view.container)).toEqual([en('tab_menu.edit'), en('tab_menu.move_left'), en('tab_menu.move_right'), en('tab_menu.delete')])
    pick(view.container, en('tab_menu.edit'))
    expect($dialogStack.get().at(-1)).toMatchObject({ id: 'tab-editor', props: { tabId: 'tab_tech' } })
    openMenu(view.container, 'all-new')
    expect(menuLabels(view.container)).toEqual([en('tab_menu.edit'), en('tab_menu.move_left'), en('tab_menu.move_right')])
    // the first one can no longer move left
    expect(q(view.container, '[role="menuitem"][data-menu="move_left"]')?.hasAttribute('disabled')).toBe(true)
    openMenu(view.container, ':later')
    expect(menuLabels(view.container)).toEqual([])
    // the subtle "⋯" stays on the active tab
    expect(q(view.container, '[data-tab-cell="all-new"] [data-part="tab-more"]')).not.toBeNull()
    expect(qa(view.container, '[data-part="tab-more"]')).toHaveLength(1)
  })

  it('reorder through the menu: the order changes at once and goes to POST /tabs/reorder (without "Watch later")', async () => {
    const gate = deferred()
    routes['POST /tabs/reorder'] = () => gate.promise.then(() => ({ count: 3 }))
    const view = await mount()
    openMenu(view.container, 'all-new')
    pick(view.container, en('tab_menu.move_right'))
    expect(order(view.container)).toEqual(['favorites', 'all-new', 'tab_tech', ':later', ':playlists'])
    expect(callsTo('POST', '/tabs/reorder').map((c) => c.body)).toEqual([{ ids: ['favorites', 'all-new', 'tab_tech'] }])
    routes['GET /tabs'] = () => ({ items: [TABS[1], TABS[0], TABS[2]] })
    gate.resolve(undefined)
    await flush(12)
    expect(order(view.container)).toEqual(['favorites', 'all-new', 'tab_tech', ':later', ':playlists'])
  })

  it('reorder by dragging; if the server refuses, the order goes back and the notice says why', async () => {
    routes['POST /tabs/reorder'] = () => {
      throw apiError('invalid', 'nope')
    }
    const view = await mount()
    dragTo(tabEl(view.container, 'tab_tech'), tabEl(view.container, 'all-new'))
    expect(order(view.container)).toEqual(['tab_tech', 'all-new', 'favorites', ':later', ':playlists'])
    await flush(12)
    expect(callsTo('POST', '/tabs/reorder').map((c) => c.body)).toEqual([{ ids: ['tab_tech', 'all-new', 'favorites'] }])
    expect(order(view.container)).toEqual(['all-new', 'favorites', 'tab_tech', ':later', ':playlists'])
    expect(lastNotification().kind).toBe('error')
    expect(lastNotification().message).toContain('Some of the information is invalid.')
    // "Watch later" does not drag (it is not a server tab)
    expect(tabEl(view.container, ':later').getAttribute('draggable')).not.toBe('true')
  })

  it('keyboard: Alt+Shift+← on the active tab moves it left', async () => {
    routes['POST /tabs/reorder'] = () => ({ count: 3 })
    const view = await mount(<HomeView initialTab="tab_tech" />)
    key(tabEl(view.container, 'tab_tech'), 'ArrowLeft')
    expect(callsTo('POST', '/tabs/reorder')).toHaveLength(0)
    act(() => {
      tabEl(view.container, 'tab_tech').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(order(view.container)).toEqual(['all-new', 'tab_tech', 'favorites', ':later', ':playlists'])
    expect(callsTo('POST', '/tabs/reorder').map((c) => c.body)).toEqual([{ ids: ['all-new', 'tab_tech', 'favorites'] }])
  })

  it('delete: the confirmation says the name and that channels/videos stay; DELETE /tabs/{id}; the neighbour becomes active; no Undo', async () => {
    let tabs = [...TABS]
    routes['GET /tabs'] = () => ({ items: tabs })
    routes['DELETE /tabs/{id}'] = (req) => {
      const id = req.path.split('/').pop()!
      tabs = tabs.filter((x) => x.id !== id)
      return { id }
    }
    const view = await mount(<HomeView initialTab="tab_tech" />)
    openMenu(view.container, 'tab_tech')
    pick(view.container, en('tab_menu.delete'))
    const dialog = q(document.body, '[data-slot="confirm-dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain(en('tab_menu.delete_title', { name: 'Tecnologia' }))
    expect(dialog.textContent).toContain(en('tab_menu.delete_desc'))
    expect(callsTo('DELETE', '/tabs/tab_tech')).toHaveLength(0)
    click(button(dialog, en('tab_menu.delete_confirm')))
    await flush(12)
    expect(callsTo('DELETE', '/tabs/tab_tech')).toHaveLength(1)
    expect(order(view.container)).toEqual(['all-new', 'favorites', ':later', ':playlists'])
    // the neighbour (on the left, the last remaining server tab) becomes active and remembered
    expect(q(view.container, '[data-tab-id="favorites"]')?.getAttribute('aria-selected') ?? q(view.container, '[data-tab-cell="favorites"] [data-part="tab-more"]')).toBeTruthy()
    expect(q(view.container, '[data-tab-cell="favorites"] [data-part="tab-more"]')).not.toBeNull()
    expect(callsTo('GET', '/feed').at(-1)?.query.tab).toBe('favorites')
    const note = lastNotification()
    expect(note.message).toBe(en('toast.tab_deleted', { name: 'Tecnologia' }))
    expect(note.action).toBeUndefined()
    expect(q(document.body, '[data-slot="confirm-dialog"]')).toBeNull()
  })

  it('delete: "Not now" does not delete; with a change_id in the response, the notice offers Undo', async () => {
    routes['DELETE /tabs/{id}'] = (req) => ({ id: req.path.split('/').pop(), change_id: 501 })
    routes['POST /changes/{id}/undo'] = () => ({ undone: [] })
    const view = await mount()
    openMenu(view.container, 'tab_tech')
    pick(view.container, en('tab_menu.delete'))
    click(button(q(document.body, '[data-slot="confirm-dialog"]')!, en('tab_menu.delete_cancel')))
    expect(q(document.body, '[data-slot="confirm-dialog"]')).toBeNull()
    expect(callsTo('DELETE', '/tabs/tab_tech')).toHaveLength(0)
    openMenu(view.container, 'tab_tech')
    pick(view.container, en('tab_menu.delete'))
    click(button(q(document.body, '[data-slot="confirm-dialog"]')!, en('tab_menu.delete_confirm')))
    await flush(12)
    const note = lastNotification()
    expect(note.action?.label).toBe(en('toast.undo'))
    act(() => note.action.onClick())
    await flush(12)
    expect(calls.some((c) => c.method === 'POST' && c.path === '/changes/501/undo')).toBe(true)
  })

  it('a delete that fails: the error shows in the dialog and the tab stays', async () => {
    routes['DELETE /tabs/{id}'] = () => {
      throw apiError('conflict', 'builtin')
    }
    const view = await mount()
    openMenu(view.container, 'tab_tech')
    pick(view.container, en('tab_menu.delete'))
    click(button(q(document.body, '[data-slot="confirm-dialog"]')!, en('tab_menu.delete_confirm')))
    await flush(12)
    expect(q(document.body, '[data-slot="confirm-error"]')?.textContent).toBeTruthy()
    expect(order(view.container)).toContain('tab_tech')
  })
})

// ------------------------------------------------------------------ type and duration on every card

describe('type and duration on every card', () => {
  const kinds = (root: ParentNode) =>
    qa(root, '[data-part="card"][data-video]').map((c) => {
      const mark = q(c, '[data-part="thumb-mark"]')
      return [c.getAttribute('data-video'), mark?.getAttribute('data-kind') ?? null, mark?.textContent ?? null]
    })
  const mixed = () =>
    page([
      item(1, { video: { ...item(1).video, duration_s: 1034, is_short: false } }),
      item(2, { video: { ...item(2).video, duration_s: 58, is_short: true } }),
      item(3, { video: { ...item(3).video, duration_s: null, is_short: null } }),
      item(4, { video: { ...item(4).video, duration_s: 312, is_short: null } })
    ])

  it('in the 3 densities and the highlight: one mark per card (video, Short, nothing, duration only)', async () => {
    routes['GET /feed'] = mixed
    for (const density of ['comfortable', 'compact', 'list'] as const) {
      const view = await mount(<HomeView initialDensity={density} />)
      expect(kinds(view.container), density).toEqual([
        [vid(1), 'video', '17:14'],
        [vid(2), 'short', 'Short0:58'],
        [vid(3), null, null],
        [vid(4), 'unknown', '5:12']
      ])
      for (const c of qa(view.container, '[data-part="card"][data-video]')) expect(qa(c, '[data-part="thumb-mark"]').length, density).toBeLessThanOrEqual(1)
      view.unmount()
    }
  })

  it('cycle running without durations: no skeleton on a ready card (the mark only shows when the data arrives)', async () => {
    routes['GET /status'] = () => status({ refresh_running: true })
    routes['GET /feed'] = () => page([1, 2, 3].map((n) => item(n, { video: { ...item(n).video, duration_s: null, is_short: null } })))
    const view = await mount(<HomeView initialDensity="compact" />)
    const ready = qa(view.container, '[data-part="card"][data-video]')
    expect(ready).toHaveLength(3)
    for (const c of ready) {
      expect(q(c, '[data-skeleton], [aria-busy="true"]')).toBeNull()
      expect(q(c, '[data-part="thumb-mark"]')).toBeNull()
    }
  })
})

// ------------------------------------------------------------------ sort and group

describe('sort and group the list', () => {
  const FOLDER_ORDER = ['f_tech', 'f_science']
  const FOLDERS_D12 = [
    { id: 'f_tech', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
    { id: 'f_science', name: 'Ciência', parent_id: null, color: null, sort: 1 }
  ]
  const VERITASIUM = { ...item(1).channel!, id: 'UCHnyfMqiRRG1u-2MsSQLbXA', title: 'Veritasium', folder_id: 'f_science', thumb: 'https://yt3.ggpht.com/v=s88' }
  /** A Veritasium video (channel/folder different from the `item`'s Fireship). */
  const vt = (n: number, over: Partial<FeedItem> = {}) => {
    const it = item(n, over)
    return { ...it, channel: VERITASIUM, video: { ...it.video, channel_id: VERITASIUM.id, channel_title: 'Veritasium' } }
  }
  const short = (it: FeedItem): FeedItem => ({ ...it, video: { ...it.video, is_short: true, duration_s: 40 } })
  /** 6 videos: Fireship 1, 3, 5 · Veritasium 2, 4, 6 (2 is a Short); 1–2 today, 3–6 from earlier days. */
  const ALL = (): FeedItem[] => {
    const day = (it: FeedItem, ageS: number) => ({ ...it, video: { ...it.video, published_at: NOW_S - ageS } })
    return [day(item(1), 60), day(short(vt(2)), 120), day(item(3), 86400 + 60), day(vt(4), 86400 + 120), day(item(5), 3 * 86400), day(vt(6), 3 * 86400 + 60)]
  }

  /** Fake server with the server rule: sorts by group and then by `sort`; pages by offset. */
  function served(req: Req, all: FeedItem[] = ALL(), size = 30): FeedPage {
    const sort = req.query.sort ?? 'newest'
    const group = req.query.group ?? 'none'
    const tz = Number(req.query.tz_offset_min ?? 0)
    const by: Record<string, (a: FeedItem, b: FeedItem) => number> = {
      newest: (a, b) => (b.video.published_at ?? 0) - (a.video.published_at ?? 0),
      oldest: (a, b) => (a.video.published_at ?? 0) - (b.video.published_at ?? 0),
      longest: (a, b) => (b.video.duration_s ?? -1) - (a.video.duration_s ?? -1),
      shortest: (a, b) => (a.video.duration_s ?? 1e9) - (b.video.duration_s ?? 1e9),
      views: (a, b) => (b.video.views ?? -1) - (a.video.views ?? -1)
    }
    const groupRank = (it: FeedItem): string | number => {
      if (group === 'channel') return it.channel?.title ?? ''
      if (group === 'folder') return FOLDER_ORDER.indexOf(it.channel?.folder_id ?? '') + 1 || 99
      if (group === 'day') return -Math.floor(((it.video.published_at ?? 0) + tz * 60) / 86400)
      if (group === 'kind') return it.video.is_short === false ? 0 : it.video.is_short ? 1 : 2
      return 0
    }
    const sorted = [...all].sort((a, b) => {
      const ga = groupRank(a)
      const gb = groupRank(b)
      if (ga !== gb) return ga < gb ? -1 : 1
      return by[sort](a, b)
    })
    const at = Number(req.query.cursor ?? 0)
    const items = sorted.slice(at, at + size)
    return { items, next_cursor: at + size < sorted.length ? String(at + size) : null, counts: { total: sorted.length, new: sorted.filter((i) => i.is_new).length } }
  }

  const trigger = (root: HTMLElement, part: string) => q(root, `[data-part="${part}"]`)
  const openSort = (root: HTMLElement) => click(trigger(root, 'view-sort'))
  const openGroup = (root: HTMLElement) => click(trigger(root, 'view-group'))
  const option = (root: ParentNode, attr: string, value: string) => q(root, `[role="menu"] [${attr}="${value}"]`)
  async function pickSort(root: HTMLElement, value: string) {
    openSort(root)
    click(option(root, 'data-sort', value))
    await flush(12)
  }
  async function pickGroup(root: HTMLElement, value: string) {
    openGroup(root)
    click(option(root, 'data-group-option', value))
    await flush(12)
  }
  const heads = (root: HTMLElement) => qa(root, '[data-part="group-head"]').map((h) => [q(h, '[data-part="group-name"]')?.textContent, q(h, '[data-part="group-count"]')?.textContent])
  const lastFeed = () => callsTo('GET', '/feed').at(-1)!

  beforeEach(() => {
    routes['GET /feed'] = (req) => served(req)
    routes['GET /folders'] = () => ({ items: FOLDERS_D12 })
  })

  it('Sort and Group in the filter bar; the label shows the current choice', async () => {
    const view = await mount(<HomeView initialDensity="compact" />)
    const bar = q(view.container, '[data-part="filterbar"]')!.parentElement!.parentElement!
    expect(q(bar, '[data-part="view-sort"]')?.textContent).toContain(en('view.sort.newest'))
    expect(q(bar, '[data-part="view-sort"]')?.getAttribute('aria-label')).toBe(en('view.sort_label', { value: en('view.sort.newest') }))
    expect(q(bar, '[data-part="view-group"]')?.textContent).toContain(en('view.group_trigger.none'))
    openSort(view.container)
    const items = qa(view.container, '[role="menu"] [data-sort]')
    expect(items.map((i) => i.getAttribute('data-sort'))).toEqual(['newest', 'oldest', 'longest', 'shortest', 'views'])
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    expect(items.map((i) => i.getAttribute('role'))).toEqual(Array(5).fill('menuitemradio'))
    // without a choice, the request does not change (contract defaults)
    expect(callsTo('GET', '/feed')[0].query).toEqual({ tab: 'all-new', limit: '30' })
  })

  it('changing the sort: GET /feed?sort=…, list from the top (no cursor), keeps search and filters; saved per tab', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      const view = await mount(<HomeView initialDensity="compact" />)
      typeInto(q(view.container, '[data-slot="search-field"]') as HTMLInputElement, 'number')
      await advance(300)
      await flush(12)
      click(button(view.container, en('filters.new_only')))
      await pickSort(view.container, 'oldest')
      expect(lastFeed().query).toEqual({ tab: 'all-new', q: 'number', sort: 'oldest', limit: '30' })
      expect(cards(view.container)).toEqual([vid(6), vid(5), vid(4), vid(3), vid(2), vid(1)])
      expect((q(view.container, '[data-slot="search-field"]') as HTMLInputElement).value).toBe('number')
      expect(button(view.container, en('filters.new_only'))?.getAttribute('aria-pressed')).toBe('true')
      expect(trigger(view.container, 'view-sort')?.textContent).toContain(en('view.sort.oldest'))
      expect(handle.storage.get(STORAGE_KEYS.view)).toEqual({ 'all-new': { sort: 'oldest', group: 'none' } })
      // another tab: its own (default); going back: the saved one
      click(q(view.container, '[data-tab-id="tab_tech"]'))
      await flush(12)
      expect(lastFeed().query).toEqual({ tab: 'tab_tech', limit: '30' })
      expect(trigger(view.container, 'view-sort')?.textContent).toContain(en('view.sort.newest'))
      click(q(view.container, '[data-tab-id="all-new"]'))
      await flush(12)
      expect(lastFeed().query).toMatchObject({ tab: 'all-new', sort: 'oldest' })
    } finally {
      vi.useRealTimers()
    }
    // reopening remembers
    calls = []
    await mount(<HomeView initialTab="all-new" initialDensity="compact" />)
    expect(callsTo('GET', '/feed')[0].query).toMatchObject({ sort: 'oldest' })
  })

  it('group by channel: header with avatar, name and count of loaded items; no highlight; collapse/expand', async () => {
    const view = await mount(<HomeView initialDensity="comfortable" />)
    expect(q(view.container, '[data-variant="featured"]')).not.toBeNull()
    await pickGroup(view.container, 'channel')
    expect(lastFeed().query).toEqual({ tab: 'all-new', group: 'channel', limit: '30' })
    expect(q(view.container, '[data-variant="featured"]')).toBeNull()
    expect(heads(view.container)).toEqual([
      ['Fireship', '3'],
      ['Veritasium', '3']
    ])
    expect(q(qa(view.container, '[data-part="group-head"]')[1], '[data-part="avatar"]')).not.toBeNull()
    expect(cards(view.container)).toEqual([vid(1), vid(3), vid(5), vid(2), vid(4), vid(6)])
    expect(trigger(view.container, 'view-group')?.textContent).toContain(en('view.group_trigger.channel'))
    // collapse the 1st group: its cards leave; expand brings them back
    const toggle = () => q(qa(view.container, '[data-part="group-head"]')[0], 'button')!
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(cards(view.container)).toEqual([vid(2), vid(4), vid(6)])
    expect(heads(view.container)[0]).toEqual(['Fireship', '3'])
    click(toggle())
    expect(cards(view.container)).toEqual([vid(1), vid(3), vid(5), vid(2), vid(4), vid(6)])
    // "Mark as read" still applies to the whole list
    click(button(view.container, en('actions.mark_read')))
    await flush(12)
    expect(callsTo('POST', '/read').map((c) => c.body)).toEqual([{ kind: 'tab', id: 'all-new' }])
  })

  it('group by day sends the browser\'s tz_offset_min; "Today"/"Yesterday"/localized date', async () => {
    const view = await mount(<HomeView initialDensity="list" />)
    await pickGroup(view.container, 'day')
    expect(lastFeed().query).toEqual({ tab: 'all-new', group: 'day', tz_offset_min: String(-new Date().getTimezoneOffset()), limit: '30' })
    const names = heads(view.container).map(([n]) => n)
    expect(names.slice(0, 2)).toEqual([en('group.today'), en('group.yesterday')])
    expect(names).toHaveLength(3)
    expect(names[2]).toBeTruthy()
    expect(names[2]).not.toMatch(/today|yesterday/i)
  })

  it('group by type and by folder: "Videos"/"Shorts"; folder with its name (GET /folders) and the folder icon', async () => {
    const view = await mount(<HomeView initialDensity="compact" />)
    await pickGroup(view.container, 'kind')
    expect(heads(view.container)).toEqual([
      [en('group.kind.video'), '5'],
      [en('group.kind.short'), '1']
    ])
    await pickGroup(view.container, 'folder')
    expect(heads(view.container)).toEqual([
      ['Tecnologia', '3'],
      ['Ciência', '3']
    ])
    expect(q(qa(view.container, '[data-part="group-head"]')[0], '[data-icon="folder"]')).not.toBeNull()
  })

  it('the keyboard crosses groups (arrows, Home/End) and the shortcuts (w) work in any group', async () => {
    const view = await mount(<HomeView initialDensity="list" />)
    await pickGroup(view.container, 'channel')
    const focused = () => (document.activeElement as HTMLElement | null)?.getAttribute('data-key')
    const first = q(view.container, '[role="gridcell"][data-key="' + vid(1) + '"]')!
    act(() => first.focus())
    key(first, 'ArrowDown')
    key(document.activeElement!, 'ArrowDown')
    expect(focused()).toBe(vid(5))
    // end of the 1st group → 1st of the next
    key(document.activeElement!, 'ArrowDown')
    expect(focused()).toBe(vid(2))
    key(document.activeElement!, 'ArrowUp')
    expect(focused()).toBe(vid(5))
    key(document.activeElement!, 'j')
    expect(focused()).toBe(vid(2))
    key(document.activeElement!, 'k')
    expect(focused()).toBe(vid(5))
    key(document.activeElement!, 'End')
    expect(focused()).toBe(vid(6))
    key(document.activeElement!, 'w')
    expect(card(view.container, 6)?.getAttribute('data-state')).toBe('watched')
    key(document.activeElement!, 'Home')
    expect(focused()).toBe(vid(1))
    // collapsed: the keyboard skips the group
    click(q(qa(view.container, '[data-part="group-head"]')[1], 'button'))
    act(() => q(view.container, '[role="gridcell"][data-key="' + vid(1) + '"]')!.focus())
    key(document.activeElement!, 'End')
    expect(focused()).toBe(vid(5))
  })

  it('infinite scroll keeps the grouping (cursor, sort and group on every page); the last group\'s count says "N+" while there is more', async () => {
    routes['GET /feed'] = (req) => served(req, ALL(), 4)
    const view = await mount(<HomeView initialDensity="compact" />)
    await pickGroup(view.container, 'channel')
    expect(heads(view.container)).toEqual([
      ['Fireship', '3'],
      ['Veritasium', en('group.count_more', { count: '1' })]
    ])
    await FakeIO.fire()
    expect(lastFeed().query).toEqual({ tab: 'all-new', group: 'channel', cursor: '4', limit: '30' })
    expect(heads(view.container)).toEqual([
      ['Fireship', '3'],
      ['Veritasium', '3']
    ])
  })

  it('meaningless combinations do not show: channel only → no Channel/Folder; folder → no Folder', async () => {
    routes['GET /channels/{id}'] = () => ({ channel: VERITASIUM, new_count: 2, watched_90d: null })
    let view = await mount(<HomeView initialFilter={{ kind: 'channel', id: VERITASIUM.id }} initialDensity="compact" />)
    openGroup(view.container)
    expect(qa(view.container, '[role="menu"] [data-group-option]').map((i) => i.getAttribute('data-group-option'))).toEqual(['none', 'day', 'kind'])
    view.unmount()
    view = await mount(<HomeView initialFilter={{ kind: 'folder', id: 'f_science' }} initialDensity="compact" />)
    openGroup(view.container)
    expect(qa(view.container, '[role="menu"] [data-group-option]').map((i) => i.getAttribute('data-group-option'))).toEqual(['none', 'channel', 'day', 'kind'])
    view.unmount()
    // a saved choice that does not fit the source counts as "None" (no meaningless request)
    handle.storage.set(STORAGE_KEYS.view, { [`:channel:${VERITASIUM.id}`]: { sort: 'views', group: 'channel' } })
    calls = []
    view = await mount(<HomeView initialFilter={{ kind: 'channel', id: VERITASIUM.id }} initialDensity="compact" />)
    expect(lastFeed().query).toEqual({ channel: VERITASIUM.id, sort: 'views', limit: '30' })
    // single-folder tab: no grouping by folder
    view.unmount()
    view = await mount(<HomeView initialTab="tab_tech" initialDensity="compact" />)
    openGroup(view.container)
    expect(qa(view.container, '[role="menu"] [data-group-option]').map((i) => i.getAttribute('data-group-option'))).toEqual(['none', 'channel', 'day', 'kind'])
  })

  it('"Watch later" sorts and groups too', async () => {
    const view = await mount(<HomeView initialTab=":later" initialDensity="compact" />)
    await pickSort(view.container, 'longest')
    expect(lastFeed().query).toEqual({ state: 'later', sort: 'longest', limit: '30' })
    expect(handle.storage.get(STORAGE_KEYS.view)).toEqual({ ':later': { sort: 'longest', group: 'none' } })
  })

  it('narrow: both become a single "View" button with the two sections', async () => {
    class NarrowRO {
      constructor(private readonly cb: (entries: Array<{ contentRect: { width: number }; target: Element }>) => void) {}
      observe(el: Element) {
        this.cb([{ contentRect: { width: 400 }, target: el }])
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NarrowRO)
    const view = await mount(<HomeView initialDensity="compact" />)
    expect(trigger(view.container, 'view-sort')).toBeNull()
    expect(trigger(view.container, 'view-group')).toBeNull()
    const menu = trigger(view.container, 'view-menu')!
    expect(menu.textContent).toContain(en('view.label'))
    click(menu)
    expect(qa(view.container, '[role="menu"] [data-sort]')).toHaveLength(5)
    expect(qa(view.container, '[role="menu"] [data-group-option]')).toHaveLength(5)
    click(option(view.container, 'data-group-option', 'kind'))
    await flush(12)
    expect(lastFeed().query).toMatchObject({ group: 'kind' })
  })

  it('changing the sort holds the previous list (no skeleton, bar in place, "Sorting…") until the new one arrives', async () => {
    const gate = deferred<FeedPage>()
    routes['GET /feed'] = (req) => (req.query.group ? gate.promise : served(req))
    const view = await mount(<HomeView initialDensity="compact" />)
    const input = q(view.container, '[data-slot="search-field"]')
    await pickGroup(view.container, 'channel')
    expect(q(view.container, '[data-part="grid"][aria-busy="true"]')).toBeNull()
    expect(q(view.container, '[data-slot="search-field"]')).toBe(input)
    expect(q(view.container, '[data-part="feed-reordering"]')?.textContent).toBe(en('feed.reordering'))
    // the previous list stays without swapped headers
    expect(heads(view.container)).toEqual([])
    expect(cards(view.container)).toEqual([vid(1), vid(2), vid(3), vid(4), vid(5), vid(6)])
    gate.resolve(served({ method: 'GET', path: '/feed', query: { group: 'channel' }, body: undefined }))
    await flush(12)
    expect(q(view.container, '[data-part="feed-reordering"]')).toBeNull()
    expect(heads(view.container).map(([n]) => n)).toEqual(['Fireship', 'Veritasium'])
  })

  it('"Show watched" (POST /feed/preview neither sorts nor groups): the controls go away', async () => {
    routes['GET /feed'] = () => page([])
    routes['POST /feed/preview'] = () => page([item(7, { is_new: false, state: 'watched' })])
    const view = await mount(<HomeView initialDensity="compact" />)
    click(button(q(view.container, '[data-part="empty"]')!, en('empty.show_seen')))
    await flush(12)
    expect(card(view.container, 7)).not.toBeNull()
    expect(trigger(view.container, 'view-sort')).toBeNull()
    expect(trigger(view.container, 'view-group')).toBeNull()
  })
})
