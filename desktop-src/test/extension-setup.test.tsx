// "Set up the extension" in the pairing dialog: the button asks the plugin backend to copy the bundled
// extension into a folder and open Chrome (POST /extension/setup, only on a click); the screen then shows the
// gestures Chrome still needs, numbered, with the folder path to copy; update, a folder that is not ours,
// Chrome not opened (and Hermes on another computer), an older backend without the route, the screen moving
// on by itself once the browser pairs, and both languages.
//
// Any Chromium browser: the detected browsers can be chosen (one → used, several → a choice), each with its own
// Extensions page and button names; the manual way (written steps, the address and the folder path with copy buttons)
// is always on screen; Windows paths keep their backslashes; a Flatpak/snap browser that can't see the folder is told
// how to fix it; "Ask Hermes to help" opens a new chat with a fixed request as a draft (never sent by itself) or, on a
// Desktop without that API, copies the same request.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, ExtensionBrowser, ExtensionSetupResult, ExtensionSetupStatus, StatusResponse } from '../../shared/api-types'
import { PLUGIN_ID, RPC_CAPABILITY, rpcMethod } from '../../shared/ids'
import { OnboardingDialog } from '../dialogs/onboarding'
import { LIVE_POLL_MS } from '../dialogs/onboarding/model'
import { ExtensionSetup } from '../dialogs/onboarding/setup'
import { ASK_ATTEMPTS, ASK_RETRY_MS, buildHermesRequest, flatpakAccessCommand } from '../dialogs/onboarding/setup-request'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { $windowVisible } from '../lib/status'
import enJson from '../locales/en/onboarding.json'
import ptJson from '../locales/pt-BR/onboarding.json'
import { advance, click, flush, render } from './render'
import { createMockCtx, host, rpcError, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }

function from(tree: Tree, key: string, vars: Record<string, string | number> = {}): string {
  let node: Tree | string | undefined = tree
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
  if (typeof node !== 'string') throw new Error(`missing key in onboarding.json: ${key}`)
  return node.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m))
}
const L = (key: string, vars?: Record<string, string | number>) => from(enJson as unknown as Tree, key, vars)
const P = (key: string, vars?: Record<string, string | number>) => from(ptJson as unknown as Tree, key, vars)

const NOW_S = 1_762_700_000
const PATH = '/home-folder/ana/HermesTube Extension'

function browserOf(key: ExtensionBrowser['key'], extra: Partial<ExtensionBrowser> = {}): ExtensionBrowser {
  const names: Record<string, [string, string]> = {
    chrome: ['Google Chrome', 'chrome://extensions/'],
    edge: ['Microsoft Edge', 'edge://extensions/'],
    brave: ['Brave', 'brave://extensions/'],
    chromium: ['Chromium', 'chrome://extensions/'],
    vivaldi: ['Vivaldi', 'vivaldi://extensions/'],
    opera: ['Opera', 'opera://extensions/'],
    arc: ['Arc', 'chrome://extensions/']
  }
  const [name, url] = names[key]
  return { key, name, extensions_url: url, sandbox: null, app_id: null, folder_visible: true, ...extra }
}
const CHROME = browserOf('chrome')

function statusOf(extra: Partial<ExtensionSetupStatus> = {}): ExtensionSetupStatus {
  return { state: 'not_installed', path: PATH, bundled_version: '0.1.0', installed_version: null, platform: 'macos', browsers: [CHROME], ...extra }
}

function resultOf(extra: Partial<ExtensionSetupResult> = {}): ExtensionSetupResult {
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

const postBodies = () =>
  sdkMock.restCalls.filter((c) => String(c.opts?.method ?? 'GET') === 'POST' && c.path.startsWith('/extension/setup')).map((c) => c.opts?.body)

function serverStatus(): StatusResponse {
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
    rss_fallback_channels: 0
  }
}

type Route = unknown | ((body: unknown) => unknown)

/** `ctx.rest` through the contract routes: value = envelope `data`; a function that throws = error envelope. */
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

const posts = () => sdkMock.restCalls.filter((c) => String(c.opts?.method ?? 'GET') === 'POST' && c.path.startsWith('/extension/setup')).length
const $ = (root: ParentNode, sel: string) => root.querySelector(sel)
const $$ = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)]
const setupButton = (root: ParentNode) => $(root, '[data-part="ext-setup-action"]')
const stepStatuses = (root: ParentNode) => $$(root, '[data-part="ext-setup"] [data-part="steps"] li').map((li) => li.getAttribute('data-status'))

const hostAny = host as unknown as Record<string, unknown>

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
  delete hostAny.newChat
  delete hostAny.composer
  vi.restoreAllMocks()
})

describe('set up the extension', () => {
  it('offers the button and does nothing on its own (only reads the status)', async () => {
    backend({ 'GET /extension/setup': statusOf(), 'POST /extension/setup': resultOf() })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(view.text()).toContain(L('pair.setup.title'))
    expect(view.text()).toContain(L('pair.setup.desc', { browser: 'Google Chrome' }))
    expect(setupButton(view.container)?.textContent).toContain(L('pair.setup.action'))
    await advance(60_000)
    expect(posts()).toBe(0)
  })

  it('click → one POST; numbered steps with the folder path to copy; the next gesture is Developer mode', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    backend({ 'GET /extension/setup': statusOf(), 'POST /extension/setup': () => gate.then(() => resultOf()) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    click(setupButton(view.container))
    click(setupButton(view.container)) // a second click while busy does not send another request
    await flush(5)
    expect(posts()).toBe(1)
    release()
    await flush(10)
    const root = $(view.container, '[data-part="ext-setup"]')!
    expect(root.getAttribute('data-phase')).toBe('done')
    const steps = $$(root, '[data-part="steps"] li')
    expect(steps).toHaveLength(4)
    expect(steps[0].textContent).toContain(`1. ${L('pair.setup.step_folder')}`)
    expect(steps[1].textContent).toContain(`2. ${L('pair.setup.step_dev', { dev: L('pair.setup.browsers.chrome.dev') })}`)
    expect(steps[1].textContent).toContain(L('pair.setup.browsers.chrome.where'))
    expect(steps[2].textContent).toContain(`3. ${L('pair.setup.step_drag')}`)
    expect(steps[2].textContent).toContain(L('pair.setup.step_drag_detail', { load: L('pair.setup.browsers.chrome.load') }))
    expect(steps[3].textContent).toContain(`4. ${L('pair.setup.step_code')}`)
    expect(postBodies()).toEqual([{ browser: 'chrome' }])
    expect(stepStatuses(view.container)).toEqual(['done', 'running', 'waiting', 'waiting'])
    expect($(root, '[data-part="ext-setup-path"]')?.textContent).toBe(PATH)
    expect($(root, '[data-part="ext-setup-path-copy"] [data-slot="copy-button"]')?.getAttribute('data-text')).toBe(PATH)
    expect(view.text()).toContain(L('pair.setup.opened', { browser: 'Google Chrome' }))
    expect(view.text()).not.toContain(L('pair.setup.not_opened_title', { browser: 'Google Chrome' }))
  })

  it('Chrome did not open: says so, the address can be copied, and Hermes-on-another-computer is explained', async () => {
    backend({
      'GET /extension/setup': statusOf(),
      'POST /extension/setup': resultOf({ opened: { extensions_page: false, folder: false }, open_problem: 'no_display' })
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    click(setupButton(view.container))
    await flush(10)
    const banner = $(view.container, '[data-part="ext-setup-not-opened"]')!
    expect(banner.textContent).toContain(L('pair.setup.not_opened_title', { browser: 'Google Chrome' }))
    expect(banner.textContent).toContain(L('pair.setup.problem.no_display', { browser: 'Google Chrome' }))
    expect(banner.textContent).toContain(L('pair.setup.other_computer'))
    expect($(banner, '[data-slot="copy-button"]')?.getAttribute('data-text')).toBe('chrome://extensions/')
    // the path is still there to copy
    expect($(view.container, '[data-part="ext-setup-path-copy"] [data-slot="copy-button"]')?.getAttribute('data-text')).toBe(PATH)
  })

  it('a newer bundled version: the same button becomes "Update the extension" and then asks for Reload', async () => {
    backend({
      'GET /extension/setup': statusOf({ state: 'update_available', installed_version: '0.1.0', bundled_version: '0.2.0' }),
      'POST /extension/setup': resultOf({ action: 'updated', version: '0.2.0' })
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(view.text()).toContain(L('pair.setup.update_title'))
    expect(view.text()).toContain(L('pair.setup.update_desc', { version: '0.2.0' }))
    expect(setupButton(view.container)?.textContent).toContain(L('pair.setup.update_action'))
    click(setupButton(view.container))
    await flush(10)
    const steps = $$(view.container, '[data-part="ext-setup"] [data-part="steps"] li')
    expect(steps).toHaveLength(2)
    expect(steps[0].textContent).toContain(L('pair.setup.step_updated', { version: '0.2.0' }))
    expect(steps[1].textContent).toContain(L('pair.setup.step_reload', { browser: 'Google Chrome' }))
    expect(stepStatuses(view.container)).toEqual(['done', 'running'])
  })

  it('already set up: a quiet line with the path and a way to open the Extensions page again', async () => {
    backend({ 'GET /extension/setup': statusOf({ state: 'installed', installed_version: '0.1.0' }), 'POST /extension/setup': resultOf({ action: 'unchanged' }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const root = $(view.container, '[data-part="ext-setup"]')!
    expect(root.getAttribute('data-phase')).toBe('ready')
    expect(view.text()).toContain(L('pair.setup.ready_title'))
    expect($(root, '[data-part="ext-setup-path"]')?.textContent).toBe(PATH)
    expect(setupButton(view.container)?.textContent).toContain(L('pair.setup.reopen'))
    click(setupButton(view.container))
    await flush(10)
    expect(posts()).toBe(1)
    expect(root.getAttribute('data-phase')).toBe('done')
  })

  it('a folder that is not ours: explains, offers no setup button, and checks again on request', async () => {
    let state: ExtensionSetupStatus = statusOf({ state: 'not_ours' })
    backend({ 'GET /extension/setup': () => state, 'POST /extension/setup': resultOf() })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(view.text()).toContain(L('pair.setup.not_ours_title'))
    expect(view.text()).toContain(L('pair.setup.not_ours_body'))
    expect(setupButton(view.container)).toBeNull()
    state = statusOf()
    click($(view.container, '[data-part="ext-setup"] [data-part="banner-action"]'))
    await flush(10)
    expect(setupButton(view.container)?.textContent).toContain(L('pair.setup.action'))
    expect(posts()).toBe(0)
  })

  it('the POST is refused (not ours) or fails: a readable message, no raw backend text, try again', async () => {
    let n = 0
    backend({
      'GET /extension/setup': statusOf(),
      'POST /extension/setup': () => {
        n += 1
        if (n === 1) throw { code: 'internal', message: 'boom /secret/path', reason: 'write_failed' }
        if (n === 2) throw { code: 'conflict', message: 'x', reason: 'not_ours' }
        return resultOf()
      }
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    click(setupButton(view.container))
    await flush(10)
    expect(view.text()).toContain(L('pair.setup.error_title'))
    expect(view.text()).not.toContain('/secret/path')
    click($(view.container, '[data-part="ext-setup"] [data-part="banner-action"]'))
    await flush(10)
    expect(view.text()).toContain(L('pair.setup.not_ours_title'))
  })

  it('a backend without the route (older plugin): the manual instructions, as before', async () => {
    backend({})
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(view.text()).toContain(L('pair.install.title'))
    expect(view.text()).toContain(L('pair.install.body'))
    expect(setupButton(view.container)).toBeNull()
  })

  it('no extension shipped in this copy of the plugin: the manual instructions', async () => {
    backend({ 'GET /extension/setup': statusOf({ state: 'unavailable', bundled_version: null }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(view.text()).toContain(L('pair.install.title'))
    expect(setupButton(view.container)).toBeNull()
  })

  it('Hermes on another computer (remote connection): says where the button acts', async () => {
    hostAny.activeConnectionId = () => 'conn-2'
    hostAny.connections = () => Promise.resolve([{ id: 'conn-2', kind: 'remote', label: 'Studio Mac', primary: false, tokenSet: true, tokenPreview: null }])
    backend({ 'GET /extension/setup': statusOf(), 'POST /extension/setup': resultOf() })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const notice = $(view.container, '[data-part="ext-setup-remote"]')
    expect(notice?.textContent).toContain(L('pair.setup.remote_title', { name: 'Studio Mac' }))
    expect(notice?.textContent).toContain(L('pair.setup.remote_body'))
    // the button stays (it acts on the Hermes computer), the person is just told so
    expect(setupButton(view.container)).not.toBeNull()
  })

  it('a local connection says nothing about another computer', async () => {
    hostAny.activeConnectionId = () => 'conn-1'
    hostAny.connections = () => Promise.resolve([{ id: 'conn-1', kind: 'local', label: 'This Mac', primary: true, tokenSet: false, tokenPreview: null }])
    backend({ 'GET /extension/setup': statusOf() })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect($(view.container, '[data-part="ext-setup-remote"]')).toBeNull()
  })

  it('PT-BR: the texts follow the app language', async () => {
    sdkMock.locale.set('pt-BR')
    try {
      backend({ 'GET /extension/setup': statusOf(), 'POST /extension/setup': resultOf() })
      const view = render(<ExtensionSetup connected={false} />)
      await flush(10)
      expect(view.text()).toContain(P('pair.setup.title'))
      expect(setupButton(view.container)?.textContent).toContain(P('pair.setup.action'))
      // the manual way is in Portuguese too
      expect($(view.container, '[data-part="ext-setup-manual"]')?.textContent).toContain(P('pair.setup.manual_title'))
      click(setupButton(view.container))
      await flush(10)
      expect(view.text()).toContain(P('pair.setup.step_dev', { dev: P('pair.setup.browsers.chrome.dev') }))
      expect(P('pair.setup.browsers.chrome.dev')).toBe('Modo do desenvolvedor')
      expect(P('pair.setup.browsers.chrome.load')).toBe('Carregar sem compactação')
    } finally {
      sdkMock.locale.set('en')
    }
  })
})

const manual = (root: ParentNode) => $(root, '[data-part="ext-setup-manual"]')
const copies = (root: ParentNode | null) => (root ? $$(root, '[data-slot="copy-button"]').map((b) => b.getAttribute('data-text')) : [])
const browserButtons = (root: ParentNode) => $$(root, '[data-part="ext-setup-browser"]')

describe('any Chromium browser', () => {
  it('several browsers: the person picks one; the POST names only that key and the steps follow it', async () => {
    const EDGE = browserOf('edge')
    backend({
      'GET /extension/setup': statusOf({ browsers: [CHROME, EDGE, browserOf('brave')] }),
      'POST /extension/setup': resultOf({ browser: EDGE })
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const buttons = browserButtons(view.container)
    expect(buttons.map((b) => b.textContent)).toEqual(['Google Chrome', 'Microsoft Edge', 'Brave'])
    expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    click(buttons[1])
    await flush(5)
    expect(browserButtons(view.container).map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    // the manual way already follows the choice: Edge's own page and where its switch is
    expect(copies(manual(view.container))).toContain('edge://extensions/')
    expect(manual(view.container)?.textContent).toContain(L('pair.setup.browsers.edge.where'))
    click(setupButton(view.container))
    await flush(10)
    expect(postBodies()).toEqual([{ browser: 'edge' }])
    const steps = $$(view.container, '[data-part="ext-setup"] [data-part="steps"] li')
    expect(steps[1].textContent).toContain(L('pair.setup.browsers.edge.where'))
    expect(view.text()).toContain(L('pair.setup.opened', { browser: 'Microsoft Edge' }))
  })

  it('one browser: no choice to make, its name is said and used', async () => {
    const BRAVE = browserOf('brave')
    backend({ 'GET /extension/setup': statusOf({ browsers: [BRAVE] }), 'POST /extension/setup': resultOf({ browser: BRAVE }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(browserButtons(view.container)).toHaveLength(0)
    expect(view.text()).toContain(L('pair.setup.desc', { browser: 'Brave' }))
    click(setupButton(view.container))
    await flush(10)
    expect(postBodies()).toEqual([{ browser: 'brave' }])
  })

  it('no Chromium browser found (or an older backend that does not list them): says so; the folder can still be prepared', async () => {
    for (const status of [statusOf({ browsers: [] }), { ...statusOf(), browsers: undefined } as unknown as ExtensionSetupStatus]) {
      sdkMock.restCalls.length = 0
      backend({ 'GET /extension/setup': status, 'POST /extension/setup': resultOf({ browser: null }) })
      const view = render(<ExtensionSetup connected={false} />)
      await flush(10)
      const st = status as ExtensionSetupStatus
      if (st.browsers) expect($(view.container, '[data-part="ext-setup-no-browser"]')?.textContent).toContain(L('pair.setup.no_browser_found'))
      expect(copies(manual(view.container))).toContain('chrome://extensions/')
      click(setupButton(view.container))
      await flush(10)
      expect(postBodies()).toEqual([undefined])
      view.unmount()
    }
  })

  it('the manual way is always there: steps, the address and the folder path, each with a copy button', async () => {
    for (const st of ['not_installed', 'installed', 'update_available', 'not_ours'] as const) {
      backend({ 'GET /extension/setup': statusOf({ state: st, installed_version: st === 'not_installed' ? null : '0.1.0' }) })
      const view = render(<ExtensionSetup connected={false} />)
      await flush(10)
      const m = manual(view.container)
      expect(m, st).not.toBeNull()
      expect(m!.textContent).toContain(L('pair.setup.manual_title'))
      expect(m!.textContent).toContain(L('pair.setup.manual_dev', { dev: L('pair.setup.browsers.chrome.dev') }))
      // the folder path is not repeated when it is already on screen above (folder ready, a folder not ours)
      const above = st === 'installed' || st === 'not_ours'
      expect(m!.textContent).toContain(L(above ? 'pair.setup.manual_load_above' : 'pair.setup.manual_load', { load: L('pair.setup.browsers.chrome.load') }))
      expect(copies(m)).toEqual(expect.arrayContaining(above ? ['chrome://extensions/'] : ['chrome://extensions/', PATH]))
      if (above) expect(copies(view.container)).toContain(PATH)
      view.unmount()
    }
    // and after a POST error too
    backend({ 'GET /extension/setup': statusOf(), 'POST /extension/setup': () => Promise.reject({ code: 'internal', message: 'x' }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    click(setupButton(view.container))
    await flush(10)
    expect(view.text()).toContain(L('pair.setup.error_title'))
    expect(copies(manual(view.container))).toEqual(expect.arrayContaining(['chrome://extensions/', PATH]))
  })

  it('Windows: the path keeps its backslashes on screen and in the copy button', async () => {
    const WIN = 'C:\\Users\\Ana\\HermesTube Extension'
    backend({
      'GET /extension/setup': statusOf({ platform: 'windows', path: WIN, browsers: [browserOf('edge')] }),
      'POST /extension/setup': resultOf({ platform: 'windows', path: WIN, browser: browserOf('edge') })
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(copies(manual(view.container))).toContain(WIN)
    expect(view.text()).toContain(WIN)
    click(setupButton(view.container))
    await flush(10)
    expect($(view.container, '[data-part="ext-setup-path"]')?.textContent).toBe(WIN)
    expect($(view.container, '[data-part="ext-setup-path-copy"] [data-slot="copy-button"]')?.getAttribute('data-text')).toBe(WIN)
  })

  it('Linux, a Flatpak browser that cannot see the folder: says so and offers the one command that gives read access', async () => {
    const path = "/home/Ana/HermesTube Extension"
    const FLAT = browserOf('chrome', { sandbox: 'flatpak', app_id: 'com.google.Chrome', folder_visible: false })
    backend({ 'GET /extension/setup': statusOf({ platform: 'linux', path, browsers: [FLAT] }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const box = $(view.container, '[data-part="ext-setup-sandbox"]')!
    expect(box.textContent).toContain(L('pair.setup.sandbox.flatpak_title', { browser: 'Google Chrome' }))
    const cmd = `flatpak override --user --filesystem='/home/Ana/HermesTube Extension:ro' com.google.Chrome`
    expect(copies(box)).toEqual([cmd])
    expect(flatpakAccessCommand(FLAT, path)).toBe(cmd)
    // a path with a quote stays one argument; an odd app id gets no command at all
    expect(flatpakAccessCommand(FLAT, "/home/O'Neil/HermesTube Extension")).toBe(
      `flatpak override --user --filesystem='/home/O'\\''Neil/HermesTube Extension:ro' com.google.Chrome`
    )
    expect(flatpakAccessCommand({ ...FLAT, app_id: 'x; rm -rf ~' }, path)).toBeNull()
  })

  it('Linux, a snap browser outside /home and a Flatpak that sees the folder', async () => {
    backend({
      'GET /extension/setup': statusOf({ platform: 'linux', path: '/srv/h/HermesTube Extension', browsers: [browserOf('chromium', { sandbox: 'snap', app_id: 'chromium', folder_visible: false })] })
    })
    let view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect($(view.container, '[data-part="ext-setup-sandbox"]')?.textContent).toContain(L('pair.setup.sandbox.snap_title', { browser: 'Chromium' }))
    view.unmount()
    backend({ 'GET /extension/setup': statusOf({ platform: 'linux', browsers: [browserOf('brave', { sandbox: 'flatpak', app_id: 'com.brave.Browser', folder_visible: true })] }) })
    view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect($(view.container, '[data-part="ext-setup-sandbox"]')).toBeNull()
  })
})

describe('ask Hermes to help', () => {
  const askButton = (root: ParentNode) => $(root, '[data-part="ext-setup-ask-action"]')

  it('with the composer API: one click opens a new chat with the request as a draft — never sent, nothing before the click', async () => {
    const newChat = vi.fn()
    const drafts: [string | null, string][] = []
    const submit = vi.fn(() => true)
    let ready = false
    hostAny.newChat = newChat
    hostAny.composer = {
      setDraft: (id: string | null, text: string) => {
        drafts.push([id, text])
        return Promise.resolve(ready)
      },
      submit
    }
    backend({ 'GET /extension/setup': statusOf({ browsers: [CHROME, browserOf('vivaldi')] }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    await advance(10_000)
    expect(newChat).not.toHaveBeenCalled()
    click(browserButtons(view.container)[1])
    await flush(5)
    expect(askButton(view.container)?.textContent).toContain(L('pair.setup.ask.action'))
    click(askButton(view.container))
    await advance(ASK_RETRY_MS)
    await flush(5)
    ready = true // the new chat's composer is there on the second try
    await advance(ASK_RETRY_MS)
    await flush(10)
    expect(newChat).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
    const [id, text] = drafts.at(-1)!
    expect(id).toBe('new')
    expect(text).toBe(buildHermesRequest({ platform: 'macos', path: PATH, browser: browserOf('vivaldi'), folderReady: false, remote: false }))
    expect($(view.container, '[data-part="ext-setup-ask"]')?.textContent).toContain(L('pair.setup.ask.sent'))
    expect(postBodies()).toEqual([]) // asking Hermes does not run the setup either
  })

  it('the chat could not take the draft: the same request can be copied instead', async () => {
    hostAny.newChat = vi.fn()
    hostAny.composer = { setDraft: () => Promise.resolve(false) }
    backend({ 'GET /extension/setup': statusOf() })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    click(askButton(view.container))
    await advance(ASK_RETRY_MS * (ASK_ATTEMPTS + 1))
    await flush(10)
    const box = $(view.container, '[data-part="ext-setup-ask"]')!
    expect(box.textContent).toContain(L('pair.setup.ask.failed'))
    expect(copies(box)).toEqual([buildHermesRequest({ platform: 'macos', path: PATH, browser: CHROME, folderReady: false, remote: false })])
  })

  it('a Desktop without the composer API: the button becomes "Copy a request for Hermes" with the same text', async () => {
    backend({ 'GET /extension/setup': statusOf({ state: 'installed', installed_version: '0.1.0' }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(askButton(view.container)).toBeNull()
    const box = $(view.container, '[data-part="ext-setup-ask"]')!
    expect(box.textContent).toContain(L('pair.setup.ask.copy_title'))
    expect(copies(box)).toEqual([buildHermesRequest({ platform: 'macos', path: PATH, browser: CHROME, folderReady: true, remote: false })])
  })

  it('the request: in English, says the system, folder and browser, the steps, and the rules', () => {
    const text = buildHermesRequest({
      platform: 'linux',
      path: '/home/Ana/HermesTube Extension',
      browser: browserOf('chrome', { sandbox: 'flatpak', app_id: 'com.google.Chrome', folder_visible: false }),
      folderReady: true,
      remote: true
    })
    expect(text).toContain('Computer where Hermes runs: Linux')
    expect(text).toContain('/home/Ana/HermesTube Extension')
    expect(text).toContain('Google Chrome (Extensions page: chrome://extensions/)')
    expect(text).toContain('Flatpak (com.google.Chrome)')
    expect(text).toContain('another computer')
    expect(text).toContain('"Developer mode"')
    expect(text).toContain('"Load unpacked"')
    expect(text).toMatch(/Do not read, change or delete anything in the browser's profile/)
    expect(text).toMatch(/Do not try to get around the steps the browser requires/)
    expect(text).toContain('--load-extension')
    expect(text).toMatch(/Do not install, download, update or remove anything without first telling me/)
    // nothing from the screen's language: always English
    sdkMock.locale.set('pt-BR')
    try {
      expect(buildHermesRequest({ platform: 'windows', path: 'C:\\Users\\Ana\\HermesTube Extension', browser: null, folderReady: false, remote: false })).toContain(
        'Computer where Hermes runs: Windows'
      )
    } finally {
      sdkMock.locale.set('en')
    }
  })

  it('Hermes inside WSL: the request says so, and what to do when something on the Windows side is missing', () => {
    const base = { platform: 'windows' as const, path: 'C:\\Users\\Ana\\HermesTube Extension', browser: CHROME, folderReady: true, remote: false }
    const plain = buildHermesRequest(base)
    expect(plain).not.toContain('WSL')
    const all = buildHermesRequest({ ...base, wsl: { distro: 'Ubuntu', interop: true, windows_folder: true } })
    expect(all).toContain('Computer where Hermes runs: Windows, with Hermes inside WSL (Ubuntu)')
    expect(all).toContain('127.0.0.1')
    expect(all).toContain('networkingMode=mirrored')
    expect(all).not.toContain('interop is off')
    const bare = buildHermesRequest({
      ...base,
      path: '\\\\wsl.localhost\\Ubuntu\\home\\Ana\\HermesTube Extension',
      wsl: { distro: null, interop: false, windows_folder: false }
    })
    expect(bare).toContain('Computer where Hermes runs: Windows, with Hermes inside WSL\n')
    expect(bare).toContain('interop is off')
    expect(bare).toContain('copy the folder to my Windows user folder')
  })

  it('Hermes inside WSL: the screen passes what the backend says about WSL to the request', async () => {
    const WIN = 'C:\\Users\\Ana\\HermesTube Extension'
    const wsl = { distro: 'Ubuntu', interop: true, windows_folder: true }
    backend({ 'GET /extension/setup': { ...statusOf({ platform: 'windows', path: WIN }), wsl } })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const box = $(view.container, '[data-part="ext-setup-ask"]')!
    expect(copies(box)).toEqual([buildHermesRequest({ platform: 'windows', path: WIN, browser: CHROME, folderReady: false, remote: false, wsl })])
  })
})

describe('Hermes inside WSL: what the screen says', () => {
  const WIN = 'C:\\Users\\Ana\\HermesTube Extension'
  const LINUX = '\\\\wsl.localhost\\Ubuntu\\home\\ana\\HermesTube Extension'
  const notice = (root: ParentNode) => $(root, '[data-part="ext-setup-wsl"]')

  it('not WSL: no WSL notice', async () => {
    backend({ 'GET /extension/setup': statusOf({ platform: 'windows', path: WIN }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    expect(notice(view.container)).toBeNull()
    expect(view.text()).not.toContain(L('pair.setup.wsl.title'))
  })

  it('WSL with everything on: only the short note about localhost forwarding', async () => {
    backend({ 'GET /extension/setup': statusOf({ platform: 'windows', path: WIN, wsl: { distro: 'Ubuntu', interop: true, windows_folder: true } }) })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const box = notice(view.container)!
    expect(box.textContent).toContain(L('pair.setup.wsl.title'))
    expect(box.textContent).toContain(L('pair.setup.wsl.localhost', { ask: L('pair.setup.ask.action') }))
    expect(box.textContent).not.toContain(L('pair.setup.wsl.no_interop'))
    expect(box.textContent).not.toContain(L('pair.setup.wsl.wsl_disk'))
  })

  it('WSL with interop off and the folder on the WSL disk: says to open the browser yourself and to copy the folder', async () => {
    const wsl = { distro: null, interop: false, windows_folder: false }
    backend({
      'GET /extension/setup': statusOf({ platform: 'windows', path: LINUX, wsl }),
      'POST /extension/setup': resultOf({ platform: 'windows', path: LINUX, wsl, opened: { extensions_page: false, folder: false }, open_problem: 'unsupported' })
    })
    const view = render(<ExtensionSetup connected={false} />)
    await flush(10)
    const box = notice(view.container)!
    expect(box.textContent).toContain(L('pair.setup.wsl.no_interop'))
    expect(box.textContent).toContain(L('pair.setup.wsl.wsl_disk'))
    click(setupButton(view.container))
    await flush(10)
    // the "could not open" banner gives the WSL reason, not the generic "this system"
    const banner = $(view.container, '[data-part="ext-setup-not-opened"]')!
    expect(banner.textContent).toContain(L('pair.setup.wsl.no_interop'))
    expect(banner.textContent).not.toContain(L('pair.setup.problem.unsupported'))
    expect(notice(view.container)?.textContent).toContain(L('pair.setup.wsl.wsl_disk'))
  })

  it('the WSL texts exist in pt-BR too and are plain', () => {
    for (const key of ['title', 'localhost', 'no_interop', 'wsl_disk']) {
      const en = L(`pair.setup.wsl.${key}`)
      const pt = P(`pair.setup.wsl.${key}`)
      expect(en).not.toBe(`pair.setup.wsl.${key}`)
      expect(pt).not.toBe(`pair.setup.wsl.${key}`)
      expect(pt).not.toBe(en)
    }
    expect(L('pair.setup.wsl.no_interop')).toBe('Hermes runs inside WSL with interop off: open the browser yourself.')
    expect(L('pair.setup.wsl.wsl_disk')).toContain('copy it to your Windows user folder if the browser refuses this path')
  })
})

describe('inside the pairing dialog', () => {
  const pairOk = () => ({ ok: true, data: { code: '482913', expires_at: Math.floor(Date.now() / 1000) + 300, port: 47615 } })

  it('the setup comes first; once the browser pairs, the dialog moves on by itself and the setup steps go away', async () => {
    let items: Device[] = []
    backend({
      'GET /extension/setup': statusOf(),
      'POST /extension/setup': resultOf(),
      'GET /devices': () => ({ items }),
      'GET /channels': { items: [], total: 0 },
      'GET /status': serverStatus(),
      'GET /demo': { loaded: false }
    })
    sdkMock.requestHandler = (method) => {
      if (method === 'runtime.describe') return { capabilities: [RPC_CAPABILITY] }
      if (method === rpcMethod('pair.start')) return pairOk()
      throw rpcError(-32601, method)
    }
    const view = render(<OnboardingDialog step="pair" onClose={() => undefined} />)
    await flush(10)
    const pair = $(view.container, '[data-part="pair"]')!
    const setup = $(pair, '[data-part="ext-setup"]')!
    // order on screen: setup before the code
    const code = $(pair, '[data-part="pairing"]')!
    expect(setup.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    click(setupButton(view.container))
    await flush(10)
    expect(stepStatuses(view.container)).toEqual(['done', 'running', 'waiting', 'waiting'])
    items = [{ id: 'dev_1', name: 'Chrome — macOS', created_at: NOW_S + 5, last_seen: NOW_S + 5, revoked_at: null, origin: null }]
    await act(async () => {
      await advance(LIVE_POLL_MS)
    })
    expect(pair.getAttribute('data-phase')).toBe('syncing')
    expect($(view.container, '[data-part="ext-setup"]')).toBeNull()
  })
})
