// First experience on a laptop screen:
//   1. the Welcome dialog's "Connect the browser extension" step is laid out to fit without scrolling — setup on the
//      left, the code / expiry / "Copy code" / "Waiting for the extension…" together on the right, "Or do it by hand"
//      folded (open when it is the way forward) without repeating the folder path shown above it, "Stuck? Hermes can
//      help" on one line with its promises in the tooltip, smaller code boxes, a taller dialog body (the real
//      measurement at 1280×720 is in pair-fit.browser.test.tsx);
//   2. the browser-extension notice sits at the top of the central area of Subscriptions (every tab), Manage and
//      Cleanup: never paired → "Connect the browser extension…" + Connect; paired but offline → the page's own
//      "disconnected" text + Reconnect; both open the dialog on the pairing step; none while /status or /devices is
//      unknown, none with a browser online.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, ExtensionSetupResult, ExtensionSetupStatus, StatusResponse, Tab, TabRules } from '../../shared/api-types'
import { PLUGIN_ID, RPC_CAPABILITY, rpcMethod } from '../../shared/ids'
import { OnboardingDialog } from '../dialogs/onboarding'
import { ONBOARDING_CSS } from '../dialogs/onboarding/style'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { pickExtNotice } from '../lib/ext-notice'
import { registerLocales } from '../lib/i18n'
import { $windowVisible } from '../lib/status'
import { CSS_TOKEN } from '../lib/style'
import enCleanup from '../locales/en/cleanup.json'
import enHome from '../locales/en/home.json'
import enManage from '../locales/en/manage.json'
import enOnboarding from '../locales/en/onboarding.json'
import ptCleanup from '../locales/pt-BR/cleanup.json'
import ptManage from '../locales/pt-BR/manage.json'
import ptOnboarding from '../locales/pt-BR/onboarding.json'
import { advance, click, flush, render } from './render'
import { createMockCtx, rpcError, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }

function from(tree: unknown, key: string, vars: Record<string, string | number> = {}): string {
  let node: unknown = tree
  for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Tree)[part] : undefined
  if (typeof node !== 'string') throw new Error(`missing key: ${key}`)
  return node.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m))
}
const O = (key: string, vars?: Record<string, string | number>) => from(enOnboarding, key, vars)

const NOW_S = 1_762_700_000
const PATH = '/home-folder/someone/HermesTube Extension'
const CHROME = { key: 'chrome', name: 'Google Chrome', extensions_url: 'chrome://extensions/', sandbox: null, app_id: null, folder_visible: true } as const

function setupStatus(extra: Partial<ExtensionSetupStatus> = {}): ExtensionSetupStatus {
  return { state: 'not_installed', path: PATH, bundled_version: '0.1.0', installed_version: null, platform: 'macos', browsers: [CHROME], ...extra }
}

function setupResult(extra: Partial<ExtensionSetupResult> = {}): ExtensionSetupResult {
  return {
    state: 'installed',
    action: 'installed',
    path: PATH,
    version: '0.1.0',
    opened: { extensions_page: true, folder: true },
    open_problem: null,
    platform: 'macos',
    browser: CHROME,
    ...extra
  }
}

function serverStatus(extra: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 0,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: null,
    refresh_running: false,
    queue_pending: 0,
    search_pending: 0,
    devices_online: 0,
    ext_port: 47615,
    rss_down_since: null,
    rss_fallback_channels: 0,
    ...extra
  }
}

function device(id: string, extra: Partial<Device> = {}): Device {
  return { id, name: 'Chrome on Mac', created_at: NOW_S - 86400, last_seen: NOW_S - 3 * 86400, revoked_at: null, origin: null, ...extra }
}

type Route = unknown | ((body: unknown) => unknown)

/** `ctx.rest` through the contract routes: value = envelope `data`; a throwing function = error envelope. */
function backend(routes: Record<string, Route>) {
  sdkMock.restHandler = (path, opts) => {
    const method = String(opts?.method ?? 'GET').toUpperCase()
    const key = `${method} ${path.split('?')[0]}`
    if (!(key in routes)) return { ok: false, error: { code: 'not_found', message: `no route ${key}` } }
    const route = routes[key]
    return Promise.resolve()
      .then(() => (typeof route === 'function' ? (route as (b: unknown) => unknown)(opts?.body) : route))
      .then(
        (data) => ({ ok: true, data }),
        (error: unknown) => ({ ok: false, error })
      )
  }
}

const $ = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const $$ = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label) ?? null
const copies = (root: ParentNode | null) => (root ? $$(root, '[data-slot="copy-button"]').map((b) => b.getAttribute('data-text')) : [])

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_S * 1000)
  const h = createMockCtx(PLUGIN_ID)
  setPluginContext(h.ctx)
  registerLocales(h.ctx)
  $windowVisible.set(true)
  $dialogStack.set([])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ------------------------------------------------------------------ 1. the pairing step, laid out to fit

const CODE = '482913'

function pairWorld(setup: Route, extra: Record<string, Route> = {}) {
  backend({
    'GET /extension/setup': setup,
    'POST /extension/setup': setupResult(),
    'GET /devices': { items: [] },
    'GET /channels': { items: [], total: 0 },
    'GET /status': serverStatus(),
    'GET /demo': { loaded: false },
    ...extra
  })
  sdkMock.requestHandler = (method) => {
    if (method === 'runtime.describe') return { capabilities: [RPC_CAPABILITY] }
    if (method === rpcMethod('pair.start')) return { ok: true, data: { code: CODE, expires_at: Math.floor(Date.now() / 1000) + 300, port: 47615 } }
    throw rpcError(-32601, method)
  }
}

async function openPair() {
  const view = render(<OnboardingDialog step="pair" onClose={() => undefined} />)
  await flush(15)
  return view
}

const side = (root: ParentNode) => $(root, '[data-part="pair"] [data-part="pair-side"]')
const main = (root: ParentNode) => $(root, '[data-part="pair"] [data-part="pair-main"]')
const manual = (root: ParentNode) => $(root, '[data-part="ext-setup-manual"]') as HTMLDetailsElement | null

describe('pairing step: laid out to fit a laptop window', () => {
  it('two columns: setup (and the browser list) on the left; code, expiry, "Copy code" and "Waiting…" together on the right', async () => {
    pairWorld(setupStatus({ state: 'installed', installed_version: '0.1.0' }), { 'GET /devices': { items: [device('d_old')] } })
    const view = await openPair()
    const pair = $(view.container, '[data-part="pair"]')!
    expect(pair.getAttribute('data-columns')).toBe('2')
    expect($(side(view.container)!, '[data-part="ext-setup"]')).not.toBeNull()
    expect($(side(view.container)!, '[data-part="devices"]')).not.toBeNull()
    const right = main(view.container)!
    expect($(right, '[data-part="pairing"]')).not.toBeNull()
    expect($(right, '[data-part="pair-live"]')?.textContent).toContain(O('pair.waiting'))
    expect(copies(right)).toContain(CODE) // "Copy code" next to the code
    // only one browser list in the dialog
    expect($$(view.container, '[data-part="devices"]')).toHaveLength(1)
  })

  it('the dialog is the wide size on this step, with its own sheet (taller body, smaller code boxes)', async () => {
    pairWorld(setupStatus())
    const view = await openPair()
    const dialog = $(document.body, '[data-slot="dialog-content"]') ?? $(view.container, '[data-slot="dialog-content"]')
    expect(dialog?.getAttribute('data-size')).toBe('xl')
    expect(ONBOARDING_CSS).toContain(CSS_TOKEN)
    expect(ONBOARDING_CSS).toMatch(/dialog-body\s*\{\s*max-height:\s*min\(calc\(85vh/)
    expect(ONBOARDING_CSS).toMatch(/@container\s+PFX_dialog\s*\(min-width:/)
    expect(ONBOARDING_CSS).toMatch(/code-digit\s*\{[^}]*height:\s*44px/)
    expect(ONBOARDING_CSS).toMatch(/prefers-reduced-motion/)
    const sheet = [...document.head.querySelectorAll('style')].find((s) => (s.textContent ?? '').includes('obpair'))
    expect(sheet).toBeTruthy()
  })

  it('folder ready: "Or do it by hand" is folded and does not repeat the folder path shown above', async () => {
    pairWorld(setupStatus({ state: 'installed', installed_version: '0.1.0' }))
    const view = await openPair()
    const m = manual(view.container)!
    expect(m.tagName).toBe('DETAILS')
    expect(m.open).toBe(false)
    expect($(m, 'summary')?.textContent).toContain(O('pair.setup.manual_title'))
    // the path is on screen once (the ready line), with its copy button; the manual way refers to it
    expect($$(view.container, '[data-part="ext-setup-path"]').map((e) => e.textContent)).toEqual([PATH])
    expect(copies(view.container).filter((t) => t === PATH)).toHaveLength(1)
    expect(m.textContent).not.toContain(PATH)
    expect(m.textContent).toContain(O('pair.setup.manual_load_above', { load: O('pair.setup.browsers.chrome.load') }))
    // still all there: the Extensions page address with its copy button
    expect(copies(m)).toContain('chrome://extensions/')
  })

  it('offered (no folder yet): folded too; the path stays inside, as it is not shown anywhere else', async () => {
    pairWorld(setupStatus())
    const view = await openPair()
    const m = manual(view.container)!
    expect(m.open).toBe(false)
    expect(copies(m)).toEqual(expect.arrayContaining(['chrome://extensions/', PATH]))
    expect($$(view.container, '[data-part="ext-setup-path"]')).toHaveLength(0)
  })

  it('the folder check failed: the button is there, the manual way folded, the code still on the right', async () => {
    pairWorld(() => {
      throw { code: 'internal', message: 'database is locked' }
    })
    const view = await openPair()
    expect($(view.container, '[data-part="ext-setup"]')?.getAttribute('data-phase')).toBe('offer')
    expect($(view.container, '[data-part="ext-setup-read-failed"]')).not.toBeNull()
    expect(manual(view.container)?.open).toBe(false)
    expect($(main(view.container)!, '[data-part="pair-live"]')).not.toBeNull()
  })

  it('the button failed: then the manual way is the way forward, so it opens by itself (and a click folds it again)', async () => {
    pairWorld(setupStatus(), { 'POST /extension/setup': () => Promise.reject({ code: 'internal', message: 'x' }) })
    const view = await openPair()
    click($(view.container, '[data-part="ext-setup-action"]'))
    await flush(10)
    const m = manual(view.container)!
    expect(view.text()).toContain(O('pair.setup.error_title'))
    expect(m.open).toBe(true)
    act(() => {
      m.open = false
      m.dispatchEvent(new Event('toggle'))
    })
    await flush(2)
    expect(manual(view.container)?.open).toBe(false)
  })

  it('no bundled extension (manual): the install instructions are on screen, not folded away', async () => {
    pairWorld(setupStatus({ state: 'unavailable', bundled_version: null }))
    const view = await openPair()
    const setup = $(view.container, '[data-part="ext-setup"]')!
    expect(setup.getAttribute('data-phase')).toBe('manual')
    expect(setup.textContent).toContain(O('pair.install.title'))
    expect(setup.textContent).toContain(O('pair.install.body'))
    expect(setup.closest('details')).toBeNull()
    expect($(main(view.container)!, '[data-part="pairing"]')).not.toBeNull()
  })

  it('after "Set up the extension": the browser gestures on the left, the code on the right, no manual block', async () => {
    pairWorld(setupStatus())
    const view = await openPair()
    click($(view.container, '[data-part="ext-setup-action"]'))
    await flush(10)
    expect($(view.container, '[data-part="ext-setup"]')?.getAttribute('data-phase')).toBe('done')
    expect($(side(view.container)!, '[data-part="steps"]')).not.toBeNull()
    expect(manual(view.container)).toBeNull()
    expect($(main(view.container)!, '[data-part="pair-live"]')?.textContent).toContain(O('pair.waiting'))
  })

  it('"Stuck? Hermes can help": one short line with the button; the promises are its tooltip and description', async () => {
    pairWorld(setupStatus({ state: 'installed', installed_version: '0.1.0' }))
    const view = await openPair()
    const box = $(view.container, '[data-part="ext-setup-ask"]')!
    // the mock Desktop has no composer API: the copy variant, on one row
    expect(box.textContent).toContain(O('pair.setup.ask.copy_title'))
    expect(box.getAttribute('title')).toBe(O('pair.setup.ask.copy_desc'))
    expect($(box, '[data-part="ext-setup-ask-desc"]')?.textContent).toBe(O('pair.setup.ask.copy_desc'))
    expect($$(box, 'p')).toHaveLength(0) // no paragraph block any more
    expect(copies(box)).toHaveLength(1)
  })

  it('once the browser pairs, one column again (the setup steps aside) and the browser list follows the status', async () => {
    let items: Device[] = []
    pairWorld(setupStatus(), { 'GET /devices': () => ({ items }) })
    const view = await openPair()
    items = [device('dev_new', { created_at: NOW_S + 5, last_seen: NOW_S + 5 })]
    await act(async () => {
      await advance(2_000)
    })
    await flush(5)
    const pair = $(view.container, '[data-part="pair"]')!
    expect(pair.getAttribute('data-phase')).toBe('syncing')
    expect(pair.getAttribute('data-columns')).toBe('1')
    expect(side(view.container)).toBeNull()
    const success = $(pair, '[data-part="pair-success"]')!
    const devices = $(pair, '[data-part="devices"]')!
    expect(success.compareDocumentPosition(devices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the new texts exist in both languages', () => {
    for (const tree of [enOnboarding, ptOnboarding]) expect(from(tree, 'pair.setup.manual_load_above', { load: 'X' })).toContain('X')
    expect(from(ptOnboarding, 'pair.setup.manual_load_above')).not.toBe(from(enOnboarding, 'pair.setup.manual_load_above'))
  })
})

// ------------------------------------------------------------------ 2. the extension notice on every page

describe('pickExtNotice: one rule for the three pages', () => {
  it('never paired → connect; paired and offline with something depending on it → disconnected; unknown → nothing', () => {
    const off = serverStatus({ devices_online: 0 })
    expect(pickExtNotice({ status: off, neverPaired: true, needed: false })).toBe('ext_not_paired')
    expect(pickExtNotice({ status: off, neverPaired: true, needed: true })).toBe('ext_not_paired')
    expect(pickExtNotice({ status: off, neverPaired: false, needed: true })).toBe('ext_disconnected')
    expect(pickExtNotice({ status: off, neverPaired: false, needed: false })).toBeNull()
    expect(pickExtNotice({ status: serverStatus({ devices_online: 1 }), neverPaired: false, needed: true })).toBeNull()
    // /devices or /status loading/failed
    expect(pickExtNotice({ status: off, neverPaired: null, needed: true })).toBeNull()
    expect(pickExtNotice({ status: undefined, neverPaired: true, needed: true })).toBeNull()
    expect(pickExtNotice({ status: undefined, neverPaired: false, needed: true })).toBeNull()
  })
})

type Case = 'never' | 'offline' | 'online'

const STATUS: Record<Case, Partial<StatusResponse>> = {
  never: { devices_online: 0 },
  offline: { devices_online: 0 },
  online: { devices_online: 1 }
}
const DEVICES: Record<Case, Device[]> = {
  never: [],
  offline: [device('d1')],
  online: [device('d1', { last_seen: NOW_S })]
}

function rules(include: Partial<TabRules['include']>, onlyNew = false): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: onlyNew, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  } as TabRules
}

const TABS: Tab[] = [
  { id: 'all-new', name: 'All new', kind: 'mixed', rules: rules({ all: true }, true), icon: null, filters: {}, sort: 0, builtin: true },
  { id: 'favorites', name: 'Favorites', kind: 'mixed', rules: rules({ favorites: true }, true), icon: null, filters: {}, sort: 1, builtin: true },
  { id: 'tab_science', name: 'Science', kind: 'theme', rules: rules({ themes: ['science'] }), icon: null, filters: {}, sort: 2, builtin: false }
]

function stubObservers() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
}

const topBanner = (root: ParentNode) => $$(root, '[data-part="banner"]')

function expectNotice(root: ParentNode, c: Case, text: { notPaired: string; connect: string; disconnected: string; reconnect: string }) {
  const banners = topBanner(root).filter((b) => [text.notPaired, text.disconnected].some((t) => (b.textContent ?? '').includes(t)))
  if (c === 'online') {
    expect(banners).toHaveLength(0)
    return
  }
  expect(banners).toHaveLength(1) // one strip per page
  const strip = banners[0]
  expect(strip.getAttribute('data-tone')).toBe('info')
  expect(strip.textContent).toContain(c === 'never' ? text.notPaired : text.disconnected)
  expect(strip.textContent).not.toContain(c === 'never' ? text.disconnected : text.notPaired)
  $dialogStack.set([])
  click(button(strip, c === 'never' ? text.connect : text.reconnect))
  expect($dialogStack.get().map((d) => [d.id, d.props])).toEqual([['onboarding', { step: 'pair' }]])
}

const HOME_TEXT = {
  notPaired: enHome.banner.ext_not_paired,
  connect: enHome.banner.connect,
  disconnected: enHome.banner.ext_disconnected,
  reconnect: enHome.banner.reconnect
}
const MANAGE_TEXT = {
  notPaired: enManage.banner.ext_not_paired,
  connect: enManage.banner.connect,
  disconnected: enManage.banner.ext_disconnected,
  reconnect: enManage.banner.reconnect
}
const CLEANUP_TEXT = {
  notPaired: enCleanup.banner.ext_not_paired,
  connect: enCleanup.banner.connect,
  disconnected: enCleanup.banner.ext_disconnected,
  reconnect: enCleanup.banner.reconnect
}

describe('Subscriptions: the notice on top of every tab', () => {
  async function mountHome(c: Case, extra: Record<string, Route> = {}) {
    const { HomePage } = await import('../pages/home')
    stubObservers()
    backend({
      'GET /tabs': { items: TABS },
      'GET /status': serverStatus({ ...STATUS[c], channels_total: 871, subscribed_total: 871 }),
      'GET /feed': { items: [], next_cursor: null, counts: { total: 0, new: 0 } },
      'GET /devices': { items: DEVICES[c] },
      'GET /playlists': { items: [] },
      ...extra
    })
    const view = render(<HomePage />)
    await flush(15)
    return view
  }

  async function selectTab(root: ParentNode, id: string) {
    click($(root, `[data-tab-id="${id}"]`))
    await flush(10)
  }

  it.each(['never', 'offline', 'online'] as const)('%s: the same strip on All new, Favorites, a theme tab, Watch later and Playlists', async (c) => {
    const view = await mountHome(c)
    for (const id of ['all-new', 'favorites', 'tab_science', ':later', ':playlists']) {
      if (id !== 'all-new') await selectTab(view.container, id)
      // the tab really changed: its feed (or the playlists) was read
      const paths = sdkMock.restCalls.map((r) => r.path)
      if (id === ':playlists') expect(paths.some((p) => p.startsWith('/playlists')), id).toBe(true)
      else if (id === ':later') expect(paths.some((p) => p.startsWith('/feed') && p.includes('later')), id).toBe(true)
      else expect(paths.some((p) => p.startsWith('/feed') && p.includes(`tab=${id}`)), id).toBe(true)
      expectNotice(view.container, c, HOME_TEXT)
    }
  })

  it('nothing while /devices loads or fails, nor while /status fails', async () => {
    let view = await mountHome('never', { 'GET /devices': () => new Promise(() => undefined) })
    expect(view.text()).not.toContain(HOME_TEXT.notPaired)
    expect(view.text()).not.toContain(HOME_TEXT.disconnected)
    view.unmount()
    view = await mountHome('offline', {
      'GET /devices': () => {
        throw { code: 'internal', message: 'locked' }
      }
    })
    expect(view.text()).not.toContain(HOME_TEXT.disconnected)
    expect(view.text()).not.toContain(HOME_TEXT.notPaired)
    view.unmount()
    view = await mountHome('never', {
      'GET /status': () => {
        throw { code: 'internal', message: 'down' }
      }
    })
    expect(view.text()).not.toContain(HOME_TEXT.notPaired)
  })

  it('not on the Welcome card of an empty library (it already offers to connect)', async () => {
    const view = await mountHome('never', { 'GET /status': serverStatus({ devices_online: 0, channels_total: 0, subscribed_total: 0 }) })
    expect(view.text()).not.toContain(HOME_TEXT.notPaired)
    expect(topBanner(view.container)).toHaveLength(0)
  })
})

describe('Manage: the notice on top', () => {
  async function mountManage(c: Case, extra: Record<string, Route> = {}) {
    const { ManagePage } = await import('../pages/manage')
    stubObservers()
    const channel = (n: number) => ({
      channel: {
        id: `UC${String(n).padStart(22, 'x')}`,
        title: `Channel ${n}`,
        relation: 'subscribed',
        source: 'extension',
        added_at: NOW_S - 86400 * 30,
        handle: `@channel${n}`,
        thumb: null,
        url: null,
        folder_id: null,
        favorite: false,
        muted: false,
        unsubscribed_at: null,
        last_video_at: null,
        videos_per_week: null,
        shorts_ratio: null,
        ai_note: null,
        tag_ids: []
      },
      new_count: 0,
      watched_90d: null
    })
    backend({
      'GET /channels': { items: [channel(1), channel(2)], total: 2 },
      'GET /folders': { items: [] },
      'GET /tags': { items: [] },
      'GET /status': serverStatus({ ...STATUS[c], channels_total: 2, subscribed_total: 2 }),
      'GET /devices': { items: DEVICES[c] },
      ...extra
    })
    const view = render(<ManagePage />)
    await flush(15)
    return view
  }

  it.each(['never', 'offline', 'online'] as const)('%s', async (c) => {
    const view = await mountManage(c)
    expectNotice(view.container, c, MANAGE_TEXT)
    if (c !== 'online') expect($(view.container, '[data-part="page-banner"]')).not.toBeNull()
  })

  it('nothing while /devices fails', async () => {
    const view = await mountManage('never', {
      'GET /devices': () => {
        throw { code: 'internal', message: 'locked' }
      }
    })
    expect(view.text()).not.toContain(MANAGE_TEXT.notPaired)
  })
})

describe('Cleanup: the notice on top, also with nothing queued yet', () => {
  async function mountCleanup(c: Case, extra: Record<string, Route> = {}) {
    const { CleanupPage } = await import('../pages/cleanup')
    stubObservers()
    backend({
      'GET /cleanup': { scan: null, channels: {} },
      'GET /queue': { items: [], pending: 0 },
      'GET /channels': { items: [], total: 0 },
      'GET /status': serverStatus({ ...STATUS[c], channels_total: 871, subscribed_total: 871 }),
      'GET /devices': { items: DEVICES[c] },
      ...extra
    })
    const view = render(<CleanupPage />)
    await flush(15)
    return view
  }

  it.each(['never', 'offline', 'online'] as const)('%s', async (c) => {
    const view = await mountCleanup(c)
    expectNotice(view.container, c, CLEANUP_TEXT)
  })

  it('only followed channels and nothing queued: no "disconnected" strip (nothing depends on the extension)', async () => {
    const view = await mountCleanup('offline', { 'GET /status': serverStatus({ devices_online: 0, channels_total: 3, subscribed_total: 0 }) })
    expect(view.text()).not.toContain(CLEANUP_TEXT.disconnected)
  })

  it('nothing while /devices loads', async () => {
    const view = await mountCleanup('never', { 'GET /devices': () => new Promise(() => undefined) })
    expect(view.text()).not.toContain(CLEANUP_TEXT.notPaired)
  })
})

describe('the notice texts exist in both languages', () => {
  it('Manage and Cleanup have their own "never paired" text and buttons, in en and pt-BR', () => {
    for (const tree of [enManage, ptManage]) for (const k of ['ext_not_paired', 'connect', 'ext_disconnected', 'reconnect']) expect(from(tree, `banner.${k}`)).toBeTruthy()
    for (const tree of [enCleanup, ptCleanup]) for (const k of ['ext_not_paired', 'connect', 'ext_disconnected', 'reconnect']) expect(from(tree, `banner.${k}`)).toBeTruthy()
    expect(ptManage.banner.ext_not_paired).not.toBe(enManage.banner.ext_not_paired)
    expect(ptCleanup.banner.reconnect).not.toBe(enCleanup.banner.reconnect)
  })
})
