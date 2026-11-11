// First connection: what a brand-new install sees before the browser is paired.
//   - the setup button stays on screen even when the status read fails (the POST does not depend on it), the read
//     retries by itself with a growing delay, and after the setup two plain buttons reopen the Extensions page and the
//     folder;
//   - a gateway on another computer, or a profile where the plugin does not answer, gets a plain explanation in the
//     connect dialog (no code, no steps) and on the main screen (no "Unexpected error");
//   - the REST cache is per connection and profile, so switching gateways reads again;
//   - Subscriptions says early, once, that the extension still has to be connected;
//   - a fixed way into the Welcome dialog: a ⌘K command and a button on Manage.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, ExtensionSetupResult, ExtensionSetupStatus, StatusResponse } from '../../shared/api-types'
import { DIALOG_IDS, PLUGIN_ID, rpcMethod } from '../../shared/ids'
import { CONNECT_COMMAND, PluginGate } from '../chrome'
import { OnboardingDialog } from '../dialogs/onboarding'
import { ExtensionSetup } from '../dialogs/onboarding/setup'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { registerLocales } from '../lib/i18n'
import { RETRY_BASE_MS, restQueryKey, retryDelay, useRest } from '../lib/rest'
import { $windowVisible } from '../lib/status'
import enChrome from '../locales/en/chrome.json'
import enCommon from '../locales/en/common.json'
import enHome from '../locales/en/home.json'
import enManage from '../locales/en/manage.json'
import enOnboarding from '../locales/en/onboarding.json'
import enPanes from '../locales/en/panes.json'
import ptChrome from '../locales/pt-BR/chrome.json'
import ptCommon from '../locales/pt-BR/common.json'
import ptPanes from '../locales/pt-BR/panes.json'
import plugin from '../main'
import { pickBanner } from '../pages/home/banners'
import { advance, click, flush, render } from './render'
import { createMockCtx, host, queryClient, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }

function from(tree: unknown, key: string, vars: Record<string, string | number> = {}): string {
  let node: unknown = tree
  for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Tree)[part] : undefined
  if (typeof node !== 'string') throw new Error(`missing key: ${key}`)
  return node.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m))
}
const O = (key: string, vars?: Record<string, string | number>) => from(enOnboarding, key, vars)

const NOW_S = 1_762_700_000
const PATH = '/home-folder/ana/HermesTube Extension'
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
  return { id, name: 'Chrome on Mac', created_at: NOW_S, last_seen: NOW_S, revoked_at: null, origin: null, ...extra }
}

/** What the Desktop throws when the active gateway has no such plugin route (plugin missing in that profile). */
const NOT_HERE = () => Promise.reject(new Error('404: Not Found'))

type Route = unknown | ((body: unknown) => unknown)

/** `ctx.rest` through the contract routes; `NOT_HERE` = transport 404; a throwing function = error envelope. */
function backend(routes: Record<string, Route>, fallback: 'envelope' | 'transport' = 'envelope') {
  sdkMock.restHandler = (path, opts) => {
    const method = String(opts?.method ?? 'GET').toUpperCase()
    const key = `${method} ${path.split('?')[0]}`
    if (!(key in routes)) return fallback === 'transport' ? NOT_HERE() : { ok: false, error: { code: 'not_found', message: `no route ${key}` } }
    const route = routes[key]
    if (route === NOT_HERE) return NOT_HERE()
    return Promise.resolve()
      .then(() => (typeof route === 'function' ? (route as (b: unknown) => unknown)(opts?.body) : route))
      .then(
        (data) => ({ ok: true, data }),
        (error: unknown) => ({ ok: false, error })
      )
  }
}

const calls = (method: string, path: string) =>
  sdkMock.restCalls.filter((c) => String(c.opts?.method ?? 'GET') === method && c.path.split('?')[0] === path).length
const $ = (root: ParentNode, sel: string) => root.querySelector(sel)
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label) ?? null

const hostAny = host as unknown as Record<string, unknown>

/** The Desktop's connection registry: this computer plus another one. */
function connections(active: 'local' | 'max', viaState = true) {
  const list = [
    { id: 'local', kind: 'local', label: 'This device', primary: true, tokenSet: false, tokenPreview: null },
    { id: 'studio', kind: 'remote', label: 'Studio', url: 'https://studio.example:9443', primary: false, tokenSet: true, tokenPreview: null }
  ]
  hostAny.connections = () => Promise.resolve(list)
  hostAny.activeConnectionId = () => (active === 'local' ? null : 'studio')
  if (viaState) act(() => host.state.connectionId.set(active === 'local' ? null : 'studio'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_S * 1000)
  const h = createMockCtx(PLUGIN_ID)
  setPluginContext(h.ctx)
  registerLocales(h.ctx)
  $windowVisible.set(true)
})

afterEach(() => {
  delete hostAny.activeConnectionId
  delete hostAny.connections
  host.state.connectionId.set(null)
  host.state.profile.set('default')
  vi.restoreAllMocks()
})

// ------------------------------------------------------------------ 1. the setup button is always there

describe('setup button with the status read failing', () => {
  it('the read fails: the button is still offered, the POST works, and the manual way stays as an alternative', async () => {
    let failing = true
    backend({
      'GET /extension/setup': () => {
        if (failing) throw { code: 'internal', message: 'database is locked' }
        return setupStatus()
      },
      'POST /extension/setup': setupResult()
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const root = $(view.container, '[data-part="ext-setup"]')!
    expect(root.getAttribute('data-phase')).toBe('offer')
    expect($(root, '[data-part="ext-setup-action"]')?.textContent).toContain(O('pair.setup.action'))
    expect($(root, '[data-part="ext-setup-read-failed"]')?.textContent).toContain(O('pair.setup.read_failed'))
    expect($(root, '[data-part="ext-setup-manual"]')).not.toBeNull()
    // without the read there is no browser key: the POST goes without a body
    click($(root, '[data-part="ext-setup-action"]'))
    await flush(10)
    expect(calls('POST', '/extension/setup')).toBe(1)
    expect(root.getAttribute('data-phase')).toBe('done')
    failing = false
  })

  it('the failed read retries by itself, waiting longer each time, and stops once it works', async () => {
    let failures = 3
    backend({
      'GET /extension/setup': () => {
        if (failures > 0) {
          failures -= 1
          throw { code: 'internal', message: 'busy' }
        }
        return setupStatus()
      }
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(calls('GET', '/extension/setup')).toBe(1)
    await advance(retryDelay(0) - 100)
    expect(calls('GET', '/extension/setup')).toBe(1)
    await advance(200)
    expect(calls('GET', '/extension/setup')).toBe(2)
    // the second wait is longer than the first
    await advance(retryDelay(0) + 100)
    expect(calls('GET', '/extension/setup')).toBe(2)
    await advance(retryDelay(1))
    expect(calls('GET', '/extension/setup')).toBe(3)
    await advance(retryDelay(2) + 100)
    expect(calls('GET', '/extension/setup')).toBe(4)
    expect($(view.container, '[data-part="ext-setup-read-failed"]')).toBeNull()
    await advance(120_000)
    expect(calls('GET', '/extension/setup')).toBe(4)
    expect(retryDelay(0)).toBe(RETRY_BASE_MS)
    expect(retryDelay(20)).toBeLessThanOrEqual(30_000)
  })

  it('an older backend without the route still gets the manual instructions (no button that cannot work)', async () => {
    backend({})
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect($(view.container, '[data-part="ext-setup"]')?.getAttribute('data-phase')).toBe('manual')
    expect($(view.container, '[data-part="ext-setup-action"]')).toBeNull()
  })

  it('after the setup: "Open the Extensions page" (the same POST) and "Show the folder" (the file manager)', async () => {
    const revealed: string[] = []
    const ctx = createMockCtx(PLUGIN_ID).ctx as unknown as { os: { revealPath: (p: string) => Promise<boolean> } }
    ctx.os.revealPath = (p: string) => {
      revealed.push(p)
      return Promise.resolve(true)
    }
    setPluginContext(ctx as never)
    backend({ 'GET /extension/setup': setupStatus(), 'POST /extension/setup': setupResult() })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    click($(view.container, '[data-part="ext-setup-action"]'))
    await flush(10)
    const page = $(view.container, '[data-part="ext-setup-open-page"]')
    const folder = $(view.container, '[data-part="ext-setup-show-folder"]')
    expect(page?.textContent).toContain(O('pair.setup.reopen'))
    expect(folder?.textContent).toContain(O('pair.setup.show_folder'))
    click(page)
    await flush(10)
    expect(calls('POST', '/extension/setup')).toBe(2)
    click($(view.container, '[data-part="ext-setup-show-folder"]'))
    await flush(10)
    expect(revealed).toEqual([PATH])
    expect(calls('POST', '/extension/setup')).toBe(2)
  })

  it('"Show the folder" falls back to the POST (which opens the folder) when the app cannot reveal paths', async () => {
    backend({ 'GET /extension/setup': setupStatus({ state: 'installed', installed_version: '0.1.0' }), 'POST /extension/setup': setupResult({ action: 'unchanged' }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    // already set up: both buttons are there before any click
    expect($(view.container, '[data-part="ext-setup-action"]')?.textContent).toContain(O('pair.setup.reopen'))
    click($(view.container, '[data-part="ext-setup-show-folder"]'))
    await flush(10)
    expect(calls('POST', '/extension/setup')).toBe(1)
  })
})

// ------------------------------------------------------------------ 2. remote gateway / plugin off

function pairWorld(extra: Record<string, Route> = {}) {
  backend({
    'GET /devices': { items: [] },
    'GET /channels': { items: [], total: 0 },
    'GET /status': serverStatus(),
    'GET /demo': { loaded: false },
    'GET /extension/setup': setupStatus(),
    'POST /pair/start': { code: '482913', expires_at: NOW_S + 300, port: 47615 },
    ...extra
  })
  sdkMock.requestHandler = (method) => {
    if (method === 'runtime.describe') return { capabilities: [] }
    throw Object.assign(new Error('nope'), { code: -32601 })
  }
}

const pairStarts = () => calls('POST', '/pair/start') + sdkMock.requests.filter((r) => r.method === rpcMethod('pair.start')).length

describe('connect dialog on a gateway of another computer', () => {
  it('no code and no steps: a plain notice with the connection name and the way out', async () => {
    connections('max')
    pairWorld()
    const view = render(<OnboardingDialog step="pair" onClose={() => undefined} />)
    await flush(12)
    const notice = $(view.container, '[data-part="pair-remote"]')
    expect(notice?.textContent).toContain(O('reach.remote_title', { name: 'Studio' }))
    expect(notice?.textContent).toContain(O('reach.remote_body', { local: 'This device' }))
    expect($(view.container, '[data-part="pair"]')).toBeNull()
    expect($(view.container, '[data-part="code-digit"]')).toBeNull()
    expect($(view.container, '[data-part="ext-setup"]')).toBeNull()
    expect(pairStarts()).toBe(0)
    // the browser really is on that computer: the steps come back, with the existing note about where the button acts
    click($(notice!, '[data-part="pair-remote-anyway"]'))
    await flush(12)
    expect($(view.container, '[data-part="pair"]')).not.toBeNull()
    expect($(view.container, '[data-part="ext-setup-remote"]')).not.toBeNull()
    expect(pairStarts()).toBe(1)
  })

  it('also when only the primary connection says it (no active id): the primary is the remote one', async () => {
    hostAny.connections = () =>
      Promise.resolve([
        { id: 'local', kind: 'local', label: 'This device', primary: false, tokenSet: false, tokenPreview: null },
        { id: 'studio', kind: 'remote', label: 'Studio', primary: true, tokenSet: true, tokenPreview: null }
      ])
    hostAny.activeConnectionId = () => null
    pairWorld()
    const view = render(<OnboardingDialog step="pair" onClose={() => undefined} />)
    await flush(12)
    expect($(view.container, '[data-part="pair-remote"]')).not.toBeNull()
  })

  it('a "remote" connection that points at this computer (localhost) is this computer', async () => {
    hostAny.connections = () =>
      Promise.resolve([{ id: 'loop', kind: 'remote', label: 'Loopback', url: 'http://127.0.0.1:9119', primary: true, tokenSet: false, tokenPreview: null }])
    hostAny.activeConnectionId = () => 'loop'
    pairWorld()
    const view = render(<OnboardingDialog step="pair" onClose={() => undefined} />)
    await flush(12)
    expect($(view.container, '[data-part="pair-remote"]')).toBeNull()
    expect($(view.container, '[data-part="pair"]')).not.toBeNull()
  })

  it('switching to This device brings the code back', async () => {
    connections('max')
    pairWorld()
    const view = render(<OnboardingDialog step="pair" onClose={() => undefined} />)
    await flush(12)
    expect($(view.container, '[data-part="pair-remote"]')).not.toBeNull()
    connections('local')
    await flush(12)
    expect($(view.container, '[data-part="pair-remote"]')).toBeNull()
    expect($(view.container, '[data-part="pair"]')).not.toBeNull()
  })
})

describe('connect dialog when the plugin does not answer in the active profile', () => {
  it('the side-panel explanation instead of the code; nothing else fails in red', async () => {
    act(() => host.state.profile.set('work'))
    pairWorld({ 'GET /status': NOT_HERE, 'GET /devices': NOT_HERE, 'GET /extension/setup': NOT_HERE })
    const view = render(<OnboardingDialog step="pair" onClose={() => undefined} />)
    await flush(20)
    const notice = $(view.container, '[data-part="pair-off"]')
    expect(notice?.textContent).toContain(O('reach.off_title', { profile: 'work' }))
    expect(notice?.textContent).toContain(O('reach.off_body', { profile: 'work' }))
    expect($(view.container, '[data-part="code-digit"]')).toBeNull()
    expect($(view.container, '[data-part="devices"]')).toBeNull()
  })
})

describe('main screen when the plugin does not answer', () => {
  function Page() {
    return <p data-part="page">the page</p>
  }

  it('the explanation of the side panel, never "Something went wrong / Unexpected error."', async () => {
    act(() => host.state.profile.set('work'))
    backend({}, 'transport')
    const view = render(
      <PluginGate>
        <Page />
      </PluginGate>
    )
    await flush(20)
    await advance(10_000)
    expect($(view.container, '[data-part="page"]')).toBeNull()
    const text = view.text()
    expect(text).toContain(from(enChrome, 'gate.title', { profile: 'work' }))
    expect(text).toContain(from(enChrome, 'gate.hint', { profile: 'work' }))
    expect(text).not.toContain(enCommon.error_title)
    expect(text).not.toContain(enCommon.errors.internal)
  })

  it('on a remote gateway it names the connection and the way back', async () => {
    connections('max')
    backend({}, 'transport')
    const view = render(
      <PluginGate>
        <Page />
      </PluginGate>
    )
    await flush(20)
    await advance(10_000)
    expect(view.text()).toContain(from(enChrome, 'gate.remote', { name: 'Studio', local: 'This device' }))
  })

  it('one route missing (older backend) is not "the plugin is off": the page stays', async () => {
    backend({ 'GET /status': NOT_HERE, 'GET /extras': { honest_thumbnails: false } })
    const view = render(
      <PluginGate>
        <Page />
      </PluginGate>
    )
    await flush(20)
    await advance(10_000)
    expect($(view.container, '[data-part="page"]')).not.toBeNull()
  })

  it('the texts name the real tab of the app (Capabilities), not "Settings"', () => {
    const texts = [
      enPanes.error.unavailable_hint,
      enChrome.chip.reason_unavailable,
      enCommon.errors.plugin_disabled,
      ptPanes.error.unavailable_hint,
      ptChrome.chip.reason_unavailable,
      ptCommon.errors.plugin_disabled,
      from(enChrome, 'gate.hint'),
      from(ptChrome, 'gate.hint')
    ]
    for (const s of texts) {
      expect(s).toContain('Capabilities → Plugins')
      expect(s).not.toMatch(/Settings →|Ajustes →/)
    }
  })
})

// ------------------------------------------------------------------ 3. cache per connection

describe('REST cache per connection and profile', () => {
  it('the key changes with the connection and with the profile', () => {
    const a = restQueryKey('GET /status')
    act(() => host.state.connectionId.set('studio'))
    const b = restQueryKey('GET /status')
    act(() => host.state.profile.set('work'))
    const c = restQueryKey('GET /status')
    expect(new Set([JSON.stringify(a), JSON.stringify(b), JSON.stringify(c)]).size).toBe(3)
    // the prefix stays (invalidation by route keeps working)
    expect(c.slice(0, 3)).toEqual([PLUGIN_ID, 'rest', 'GET /status'])
  })

  it('switching the gateway reads again and never shows the other gateway\'s answer', async () => {
    let n = 0
    sdkMock.restHandler = () => ({ ok: true, data: { items: [], gateway: host.state.connectionId.get() ?? 'local', n: ++n } })
    function Probe() {
      const q = useRest('GET /devices', {})
      const d = q.data as unknown as { gateway: string } | undefined
      return <span>{d ? d.gateway : 'loading'}</span>
    }
    const view = render(<Probe />)
    await flush()
    expect(view.text()).toBe('local')
    act(() => host.state.connectionId.set('studio'))
    // right after the switch: not the old answer
    expect(view.text()).not.toBe('local')
    await flush()
    expect(view.text()).toBe('studio')
    expect(sdkMock.restCalls).toHaveLength(2)
    expect(queryClient.queries.size).toBe(2)
  })
})

// ------------------------------------------------------------------ 4. early notice on Subscriptions

describe('Subscriptions: early notice while no browser was ever paired', () => {
  it('pickBanner: no paired browser → the connect notice; one paired (even revoked) → none', () => {
    const s = serverStatus({ subscribed_total: 0 })
    expect(pickBanner({ status: s, subscribed: 0, arriving: false, neverPaired: true })).toBe('ext_not_paired')
    expect(pickBanner({ status: s, subscribed: 0, arriving: false, neverPaired: false })).toBeNull()
    expect(pickBanner({ status: s, subscribed: 0, arriving: false, neverPaired: null })).toBeNull()
    // arriving videos and a flaky feed come first
    expect(pickBanner({ status: s, subscribed: 0, arriving: true, neverPaired: true })).toBe('arriving')
    expect(pickBanner({ status: serverStatus({ rss_down_since: NOW_S }), subscribed: 0, arriving: false, neverPaired: true })).toBe('rss_down')
    // "Reconnect" makes no sense for a browser that never connected
    expect(pickBanner({ status: serverStatus({ devices_online: 0 }), subscribed: 5, arriving: false, neverPaired: true })).toBe('ext_not_paired')
  })

  async function mountHome(devices: Device[]) {
    const { HomePage } = await import('../pages/home')
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    backend({
      'GET /tabs': { items: [{ id: 'all', name: 'All', kind: 'builtin', builtin: true, icon: null, position: 0, rules: null, pinned: false }] },
      'GET /status': serverStatus({ channels_total: 3, subscribed_total: 0 }),
      'GET /feed': { items: [], next_cursor: null, total: 0 },
      'GET /devices': { items: devices }
    })
    const view = render(<HomePage />)
    await flush(15)
    return view
  }

  it('zero browsers: one discreet notice with "Connect", which opens the dialog on the connect step', async () => {
    const view = await mountHome([])
    const banner = $(view.container, '[data-part="banner"]')
    expect(banner?.textContent).toContain(enHome.banner.ext_not_paired)
    click(button(banner!, enHome.banner.connect))
    expect($dialogStack.get().map((d) => [d.id, d.props])).toEqual([['onboarding', { step: 'pair' }]])
    vi.unstubAllGlobals()
  })

  it('a paired browser (or one that was revoked): no notice', async () => {
    const view = await mountHome([device('d1', { revoked_at: NOW_S })])
    expect(view.text()).not.toContain(enHome.banner.ext_not_paired)
    vi.unstubAllGlobals()
  })
})

// ------------------------------------------------------------------ 5. fixed entry to the Welcome dialog

describe('a fixed way into the Welcome dialog', () => {
  it('⌘K "HermesTube: Connect a browser or add a channel" opens the Welcome dialog', () => {
    backend({})
    const handle = createMockCtx(PLUGIN_ID)
    plugin.register(handle.ctx)
    const cmd = handle.registrations.find((r) => r.area === 'palette' && r.id === CONNECT_COMMAND)
    expect(cmd?.data.label).toBe(from(enChrome, `palette.${CONNECT_COMMAND}.label`))
    expect(cmd?.data.label).toBe('HermesTube: Connect a browser or add a channel')
    expect(cmd?.data.id).toBe(`${PLUGIN_ID}.${CONNECT_COMMAND}`)
    expect(cmd?.data.keywords).toEqual(expect.arrayContaining(['extension', 'extensão']))
    act(() => cmd?.data.run())
    expect($dialogStack.get().at(-1)?.id).toBe(DIALOG_IDS.onboarding)
  })

  it('Manage has a "Connect a browser" button that opens the same dialog', async () => {
    const { ManagePage } = await import('../pages/manage')
    backend({
      'GET /channels': { items: [], total: 0 },
      'GET /folders': { items: [] },
      'GET /tags': { items: [] },
      'GET /status': serverStatus()
    })
    const view = render(<ManagePage />)
    await flush(15)
    const btn = $(view.container, '[data-part="manage-connect"]')
    expect(btn?.textContent).toContain(enManage.actions.connect)
    click(btn)
    expect($dialogStack.get().at(-1)?.id).toBe(DIALOG_IDS.onboarding)
  })

  it('with a browser online, that button says so instead of asking to connect, and still opens the dialog', async () => {
    const { ManagePage } = await import('../pages/manage')
    backend({
      'GET /channels': { items: [], total: 0 },
      'GET /folders': { items: [] },
      'GET /tags': { items: [] },
      'GET /status': serverStatus({ devices_online: 1 })
    })
    const view = render(<ManagePage />)
    await flush(15)
    const btn = $(view.container, '[data-part="manage-connect"]')
    expect(btn?.textContent).toContain(enManage.actions.connected)
    expect(btn?.textContent).not.toContain(enManage.actions.connect)
    expect(btn?.getAttribute('data-state')).toBe('connected')
    click(btn)
    expect($dialogStack.get().at(-1)?.id).toBe(DIALOG_IDS.onboarding)
  })
})
