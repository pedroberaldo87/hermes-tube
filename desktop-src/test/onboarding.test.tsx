// Welcome and pairing: the 3 paths, pairing with live waiting (fake clock), each error with the
// right text, paste link/@handle (optimistic, with undo), demo (load, follow, clear), devices
// (revoke with confirmation), closing by itself when the channels arrive, EN = PT-BR and the code never in a log.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ChangeRecord, Device, StatusResponse } from '../../shared/api-types'
import { PLUGIN_ID, RPC_CAPABILITY, STATUS_POLL_MS, rpcMethod } from '../../shared/ids'
import { OnboardingDialog } from '../dialogs/onboarding'
import { AUTO_CLOSE_S, LIVE_POLL_MS, parseChannelInput } from '../dialogs/onboarding/model'
import { scenarios } from '../dialogs/onboarding/preview.scenarios'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { $windowVisible } from '../lib/status'
import enJson from '../locales/en/onboarding.json'
import ptJson from '../locales/pt-BR/onboarding.json'
import enCommon from '../locales/en/common.json'
import { advance, click, flush, render } from './render'
import { listRepoFiles, readRepoFile } from './repo.mjs'
import { act } from 'react'
import { createMockCtx, queryClient, rpcError, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }
const EN = enJson as unknown as Tree
const PT = ptJson as unknown as Tree

/** EN text of a key in the `onboarding` namespace (fails if the key does not exist). */
function L(key: string, vars: Record<string, string | number> = {}): string {
  let node: Tree | string | undefined = EN
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
  if (typeof node !== 'string') throw new Error(`chave ausente em en/onboarding.json: ${key}`)
  return node.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m))
}

const NOW_S = 1_762_700_000
const NOW_MS = NOW_S * 1000
const CODE = '482913'
const CODE2 = '730115'

function device(id: string, name: string, extra: Partial<Device> = {}): Device {
  return { id, name, created_at: NOW_S + 5, last_seen: NOW_S + 5, revoked_at: null, origin: null, ...extra }
}

function channel(id: string, title: string, handle: string | null): Channel {
  return {
    id,
    title,
    relation: 'followed',
    source: 'link',
    added_at: NOW_S,
    handle,
    thumb: null,
    url: handle ? `https://www.youtube.com/${handle}` : null,
    folder_id: null,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: null,
    videos_per_week: null,
    shorts_ratio: null,
    ai_note: null,
    tag_ids: []
  }
}

function status(extra: Partial<StatusResponse> = {}): StatusResponse {
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

// ------------------------------------------------------------------ fake backend

interface Req {
  body?: any
  query: URLSearchParams
  params: Record<string, string>
}
type Route = unknown | ((req: Req) => unknown)

/** `ctx.rest` answers through the contract routes: value = the envelope's `data`; a function that throws = error envelope. */
function backend(routes: Record<string, Route>) {
  sdkMock.restHandler = (path, opts) => {
    const method = String(opts?.method ?? 'GET').toUpperCase()
    const [p, qs = ''] = path.split('?')
    for (const [key, route] of Object.entries(routes)) {
      const [m, tmpl] = key.split(' ')
      if (m !== method) continue
      const names: string[] = []
      const re = new RegExp(`^${tmpl.replace(/\{(\w+)\}/g, (_x, n: string) => (names.push(n), '([^/]+)'))}$`)
      const hit = p.match(re)
      if (!hit) continue
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])]))
      const req: Req = { body: opts?.body, query: new URLSearchParams(qs), params }
      return Promise.resolve()
        .then(() => (typeof route === 'function' ? (route as (r: Req) => unknown)(req) : route))
        .then(
          (data) => ({ ok: true, data }),
          (error: unknown) => {
            if (error && typeof error === 'object' && 'transport' in error) throw new Error('network down')
            return { ok: false, error }
          }
        )
    }
    return { ok: false, error: { code: 'not_found', message: `no route ${method} ${p}` } }
  }
}

/** RPC: with or without `plugin-rpc-v1`; `pairStart` returns the envelope (or throws). */
function rpc(opts: { capability: boolean; pairStart?: () => unknown }) {
  sdkMock.requestHandler = (method) => {
    if (method === 'runtime.describe') return { capabilities: opts.capability ? [RPC_CAPABILITY] : [] }
    if (method === rpcMethod('pair.start') && opts.pairStart) return opts.pairStart()
    throw rpcError(-32601, `unknown method ${method}`)
  }
}

const restCount = (method: string, path: string) =>
  sdkMock.restCalls.filter((c) => String(c.opts?.method ?? 'GET') === method && c.path.split('?')[0] === path).length

const $ = (root: ParentNode, sel: string) => root.querySelector(sel)
const $$ = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)]
const digits = (root: ParentNode) => $$(root, '[data-part="code-digit"]').map((d) => d.textContent).join('')

function type(input: Element | null, value: string) {
  if (!input) throw new Error('type: field missing')
  act(() => {
    const el = input as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submit(root: ParentNode) {
  const form = $(root, 'form[data-part="link-form"]') as HTMLFormElement | null
  if (!form) throw new Error('submit: form missing')
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function key(target: Element, k: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let onClose: ReturnType<typeof vi.fn<() => void>>

// several tests move minutes of fake clock (a 5-minute code, 2 s polls): on a loaded machine one of them can pass the
// project's default 5 s and take the rest of the file down with it
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
  const h = createMockCtx(PLUGIN_ID)
  setPluginContext(h.ctx)
  registerLocales(h.ctx)
  onClose = vi.fn<() => void>()
  $windowVisible.set(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A new code is valid for 300 s from now (fake clock). */
const pairOk = (code = CODE) => ({ ok: true, data: { code, expires_at: Math.floor(Date.now() / 1000) + 300, port: 47615 } })

function pairWorld(over: Record<string, Route> = {}) {
  backend({
    'GET /devices': { items: [] },
    'GET /channels': { items: [], total: 0 },
    'GET /status': status(),
    'GET /demo': { loaded: false },
    ...over
  })
}

// ------------------------------------------------------------------ paths

describe('welcome: the 3 paths', () => {
  it('shows the sentence, the 3 paths and marks the recommended one (connect the extension)', async () => {
    pairWorld()
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush()
    expect(view.text()).toContain(L('hero.tagline'))
    const cards = $$(view.container, '[data-part="path-card"]')
    expect(cards).toHaveLength(3)
    expect(cards.map((c) => c.getAttribute('data-primary'))).toEqual(['true', 'false', 'false'])
    expect(cards[0].textContent).toContain(L('paths.pair.title'))
    expect(cards[0].textContent).toContain(L('paths.pair.hint'))
    expect(cards[1].textContent).toContain(L('paths.link.title'))
    expect(cards[2].textContent).toContain(L('paths.demo.title'))
    // no pairing network without the user choosing
    expect(sdkMock.requests.some((r) => r.method === rpcMethod('pair.start'))).toBe(false)
  })

  it('the product line is the kit Hero (h1), with the supporting text; nothing repeated', async () => {
    pairWorld()
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush()
    const hero = $(view.container, '[data-part="hero"]')
    expect(hero).not.toBeNull()
    expect(hero?.querySelector('h1')?.textContent).toBe(L('hero.tagline'))
    expect(hero?.textContent).toContain(L('hero.lead'))
    expect(view.text().split(L('hero.tagline'))).toHaveLength(2) // only once
  })

  it('keyboard: 1/2/3 only move the focus to a path; Enter or a click on the focused button acts', async () => {
    pairWorld()
    rpc({ capability: true, pairStart: () => pairOk() })
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush()
    const root = $(view.container, '[data-part="onboarding"]')!
    const actions = () => $$(view.container, '[data-part="path-card"] [data-part="path-foot"] button')
    key(root, '2')
    expect(root.getAttribute('data-view')).toBe('paths')
    expect(document.activeElement).toBe(actions()[1])
    // pressing the focused button (Enter fires its click) opens the path
    click(document.activeElement)
    expect(root.getAttribute('data-view')).toBe('link')
    expect(document.activeElement).toBe($(view.container, '[data-part="link-input"]'))
    // a key inside the field does not change the path
    key($(view.container, '[data-part="link-input"]')!, '1')
    expect(root.getAttribute('data-view')).toBe('link')
    click($(view.container, '[data-part="onboarding-back"]'))
    expect(root.getAttribute('data-view')).toBe('paths')
    key(root, '1')
    await flush()
    expect(root.getAttribute('data-view')).toBe('paths')
    expect(document.activeElement).toBe(actions()[0])
  })

  it('keyboard: 3 never loads the demo and 1 never opens a pairing code by itself', async () => {
    const loads: unknown[] = []
    pairWorld({
      'POST /demo/load': () => {
        loads.push(true)
        return { channels: 40, folders: 6, tabs: 1, warnings: [] }
      }
    })
    rpc({ capability: true, pairStart: () => pairOk() })
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush()
    const root = $(view.container, '[data-part="onboarding"]')!
    key(root, '3')
    await flush()
    key(root, '1')
    await advance(2000)
    expect(root.getAttribute('data-view')).toBe('paths')
    expect(loads).toEqual([])
    expect(restCount('POST', '/demo/load')).toBe(0)
    expect(sdkMock.requests.some((r) => r.method === rpcMethod('pair.start'))).toBe(false)
    expect(restCount('POST', '/pair/start')).toBe(0)
    // a modifier or a key typed in a field does nothing at all
    const before = document.activeElement
    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
    })
    expect(document.activeElement).toBe(before)
  })

  it('`step` opens straight on the requested path', async () => {
    pairWorld()
    const view = render(<OnboardingDialog step="link" onClose={onClose} />)
    await flush()
    expect($(view.container, '[data-part="onboarding"]')?.getAttribute('data-view')).toBe('link')
  })

  it('PT-BR: texts come from the app language', async () => {
    sdkMock.locale.set('pt-BR')
    pairWorld()
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush()
    expect(view.text()).toContain('Suas inscrições. Do seu jeito.')
    expect(view.text()).toContain('Conectar a extensão do navegador')
  })
})

// ------------------------------------------------------------------ pairing

describe('pairing', () => {
  it('pair.start via RPC: large code, countdown, copy and step by step', async () => {
    pairWorld()
    rpc({ capability: true, pairStart: () => pairOk() })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    expect(sdkMock.requests.filter((r) => r.method === rpcMethod('pair.start'))).toHaveLength(1)
    expect(restCount('POST', '/pair/start')).toBe(0)
    expect(digits(view.container)).toBe(CODE)
    expect(view.text()).toContain('Expires in 5:00')
    expect($(view.container, '[data-slot="copy-button"]')?.getAttribute('data-text')).toBe(CODE)
    const steps = $$(view.container, '[data-part="steps"] li')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toContain(L('pair.step_open'))
    expect(steps.map((s) => s.getAttribute('data-status'))).toEqual(['running', 'waiting', 'waiting'])
    expect(view.text()).toContain(L('pair.waiting'))
    expect(view.text()).toContain(L('pair.install.title'))
    await advance(61_000)
    expect(view.text()).toContain('Expires in 3:59')
  })

  it('no RPC on the backend: falls back to POST /pair/start by itself', async () => {
    pairWorld({ 'POST /pair/start': { code: CODE, expires_at: NOW_S + 300, port: 47615 } })
    rpc({ capability: false })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    expect(restCount('POST', '/pair/start')).toBe(1)
    expect(digits(view.container)).toBe(CODE)
  })

  it('expired code → generate another with one click', async () => {
    pairWorld()
    let n = 0
    rpc({ capability: true, pairStart: () => pairOk(++n === 1 ? CODE : CODE2) })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    expect(digits(view.container)).toBe(CODE)
    await advance(300_000)
    expect($(view.container, '[data-part="pair"]')?.getAttribute('data-phase')).toBe('expired')
    expect(view.text()).toContain(L('pair.expired_hint'))
    expect($(view.container, '[data-slot="copy-button"]')).toBeNull()
    click($(view.container, '[data-part="pairing-regenerate"]'))
    await flush(10)
    expect(n).toBe(2)
    expect(digits(view.container)).toBe(CODE2)
    expect($(view.container, '[data-part="pair"]')?.getAttribute('data-phase')).toBe('waiting')
    expect(view.text()).toContain('Expires in 5:00')
  })

  it('live waiting: a new device shows up → drawn success → follows until the channels arrive → closes by itself', async () => {
    const old = device('dev_old', 'Firefox — Linux', { created_at: NOW_S - 9000, last_seen: NOW_S - 9000 })
    let items: Device[] = [old]
    let total = 0
    pairWorld({ 'GET /devices': () => ({ items }), 'GET /channels': () => ({ items: [], total }) })
    rpc({ capability: true, pairStart: () => pairOk() })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    const phase = () => $(view.container, '[data-part="pair"]')?.getAttribute('data-phase')
    expect(phase()).toBe('waiting')
    const devicePolls = restCount('GET', '/devices')
    await advance(LIVE_POLL_MS)
    expect(restCount('GET', '/devices')).toBe(devicePolls + 1) // live polling
    expect(phase()).toBe('waiting') // the old device does not count

    items = [old, device('dev_1', 'Chrome — Mac')]
    await advance(LIVE_POLL_MS)
    expect(phase()).toBe('syncing')
    expect(view.text()).toContain(L('pair.connected_title', { name: 'Chrome — Mac' }))
    expect(view.text()).toContain(L('pair.connected_desc'))
    const steps = $$(view.container, '[data-part="steps"] li').map((s) => s.getAttribute('data-status'))
    expect(steps).toEqual(['done', 'running', 'waiting'])
    expect(onClose).not.toHaveBeenCalled()

    // the list still empty: keeps waiting, no false "0 channels"
    await advance(LIVE_POLL_MS)
    expect(phase()).toBe('syncing')
    expect(view.text()).not.toContain(L('plural.channels_other', { count: 0 }))

    total = 212
    await advance(LIVE_POLL_MS)
    expect(phase()).toBe('done')
    expect(view.text()).toContain(L('pair.done_title'))
    expect(view.text()).toContain(L('plural.channels_other', { count: 212 }))
    expect(view.text()).toContain(L('done.closing', { seconds: AUTO_CLOSE_S }))
    await advance(AUTO_CLOSE_S * 1000)
    expect(onClose).toHaveBeenCalledTimes(1)
    // tells Subscriptions: invalidates the plugin queries
    expect(invalidate.mock.calls.some(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify([PLUGIN_ID]))).toBe(true)
  })

  it('once paired, the subtitle says the current state (no longer asks for the code)', async () => {
    let items: Device[] = []
    let total = 0
    pairWorld({ 'GET /devices': () => ({ items }), 'GET /channels': () => ({ items: [], total }) })
    rpc({ capability: true, pairStart: () => pairOk() })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    const subtitle = () => $(view.container, '[data-part="onboarding"] [data-part="section"] [class*="section-desc"]')?.textContent
    expect(subtitle()).toBe(L('pair.desc'))
    items = [device('dev_1', 'Chrome — Mac')]
    await advance(LIVE_POLL_MS)
    expect($(view.container, '[data-part="pair"]')?.getAttribute('data-phase')).toBe('syncing')
    expect(subtitle()).toBe(L('pair.desc_syncing'))
    expect(view.text()).not.toContain(L('pair.desc'))
    // the same state does not show twice (subtitle and success card)
    expect(view.text().split(L('pair.desc_syncing'))).toHaveLength(2)
    total = 12
    await advance(LIVE_POLL_MS)
    expect($(view.container, '[data-part="pair"]')?.getAttribute('data-phase')).toBe('done')
    expect(subtitle()).toBe(L('pair.desc_done'))
  })

  it('"stay here" cancels the automatic close', async () => {
    let items: Device[] = []
    let total = 0
    pairWorld({ 'GET /devices': () => ({ items }), 'GET /channels': () => ({ items: [], total }) })
    rpc({ capability: true, pairStart: () => pairOk() })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    items = [device('dev_1', 'Chrome — Mac')]
    total = 3 // the list already grew: connected → ready in the same cycle
    await advance(LIVE_POLL_MS)
    expect($(view.container, '[data-part="pair"]')?.getAttribute('data-phase')).toBe('done')
    expect(view.text()).toContain(L('done.closing', { seconds: AUTO_CLOSE_S }))
    click($(view.container, '[data-part="auto-close-stay"]'))
    await advance(AUTO_CLOSE_S * 3000)
    expect(onClose).not.toHaveBeenCalled()
    click($(view.container, '[data-part="auto-close-now"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hidden window: the live waiting stops polling', async () => {
    pairWorld()
    rpc({ capability: true, pairStart: () => pairOk() })
    render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    act(() => $windowVisible.set(false))
    await flush()
    const before = restCount('GET', '/devices')
    await advance(LIVE_POLL_MS * 5)
    expect(restCount('GET', '/devices')).toBe(before)
    act(() => $windowVisible.set(true))
    await advance(LIVE_POLL_MS)
    expect(restCount('GET', '/devices')).toBeGreaterThan(before)
  })

  it('extension server down in /status → "open Hermes to reconnect" strip with a human explanation', async () => {
    pairWorld({ 'GET /status': status({ ext_endpoint_up: false, ext_port: null }) })
    rpc({ capability: true, pairStart: () => pairOk() })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    await advance(STATUS_POLL_MS)
    const banner = $(view.container, '[data-part="pair"] [data-part="banner"][data-tone="warning"]')
    expect(banner?.textContent).toContain(enCommon.reconnect_open_hermes)
    expect(banner?.textContent).toContain(L('pair.endpoint_down'))
  })

  it.each([
    ['ext_endpoint_down', () => ({ ok: false, error: { code: 'ext_endpoint_down', message: 'extension server did not start' } })],
    ['timeout', () => Promise.reject(new Error('Request timed out after 30000ms'))],
    ['generic', () => ({ ok: false, error: { code: 'internal', message: 'boom' } })]
  ] as const)('error %s: the right text and try again', async (kind, fail) => {
    pairWorld()
    let n = 0
    rpc({ capability: true, pairStart: () => (++n === 1 ? fail() : pairOk()) })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    expect($(view.container, '[data-part="pair"]')?.getAttribute('data-phase')).toBe('error')
    expect(view.text()).toContain(L(`pair.errors.${kind}.title`))
    expect(view.text()).toContain(L(`pair.errors.${kind}.body`))
    expect(view.text()).not.toContain('boom') // no raw backend message
    expect(digits(view.container)).toBe('') // no fake code
    click($(view.container, '[data-part="pair"] [data-part="banner-action"]'))
    await flush(10)
    expect(digits(view.container)).toBe(CODE)
  })

  it('the code never goes to a log or a notification', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    let items: Device[] = []
    let total = 0
    pairWorld({ 'GET /devices': () => ({ items }), 'GET /channels': () => ({ items: [], total }) })
    rpc({ capability: true, pairStart: () => pairOk() })
    const view = render(<OnboardingDialog step="pair" onClose={onClose} />)
    await flush(10)
    await advance(300_000)
    click($(view.container, '[data-part="pairing-regenerate"]'))
    await flush(10)
    items = [device('dev_1', 'Chrome — Mac')]
    total = 5
    await advance(LIVE_POLL_MS * 3)
    const logged = spies.flatMap((s) => s.mock.calls).map((args) => JSON.stringify(args.map(String)))
    expect(logged.filter((l) => l.includes(CODE))).toEqual([])
    expect(JSON.stringify(sdkMock.notifications)).not.toContain(CODE)
  })
})

// ------------------------------------------------------------------ paste link

describe('paste link or @handle', () => {
  it('validates before calling: empty and odd formats do not reach the backend', async () => {
    pairWorld()
    const view = render(<OnboardingDialog step="link" onClose={onClose} />)
    await flush()
    submit(view.container)
    expect($(view.container, '[data-part="link-error"]')?.textContent).toBe(L('link.errors.empty'))
    type($(view.container, '[data-part="link-input"]'), 'some channel')
    submit(view.container)
    expect($(view.container, '[data-part="link-error"]')?.textContent).toBe(L('link.errors.format'))
    expect($(view.container, '[data-part="link-input"]')?.getAttribute('aria-invalid')).toBe('true')
    expect(restCount('POST', '/channels/add')).toBe(0)
  })

  it('optimistic: the row shows at once, becomes the real channel and undoes through the history', async () => {
    const add = deferred<Channel>()
    const veritasium = channel('UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium', '@veritasium')
    const change: ChangeRecord = {
      id: 41,
      ts: NOW_S,
      actor: 'user',
      action: 'channel_add',
      payload: { label: 'Veritasium', channel_id: veritasium.id },
      undo: {} as ChangeRecord['undo'],
      group_id: null,
      undone_at: null
    }
    const other: ChangeRecord = { ...change, id: 42, payload: { label: 'x', channel_id: 'UCxxxxxxxxxxxxxxxxxxxxxx' } }
    pairWorld({
      'POST /channels/add': (req: Req) => (req.body?.url_or_handle === '@veritasium' ? add.promise : Promise.reject({ code: 'invalid', message: 'x' })),
      'GET /changes': { items: [other, change] },
      'POST /changes/{id}/undo': (req: Req) => ({ undone: [{ ...change, id: Number(req.params.id), undone_at: NOW_S }] })
    })
    const view = render(<OnboardingDialog step="link" onClose={onClose} />)
    await flush()
    type($(view.container, '[data-part="link-input"]'), '  @veritasium ')
    submit(view.container)
    await flush()
    const row = () => $(view.container, '[data-part="link-row"]')
    expect(row()?.getAttribute('data-state')).toBe('pending')
    expect(row()?.textContent).toContain('@veritasium')
    expect(row()?.textContent).toContain(L('link.status.pending'))
    expect(($(view.container, '[data-part="link-input"]') as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe($(view.container, '[data-part="link-input"]'))

    add.resolve(veritasium)
    await flush()
    expect(row()?.getAttribute('data-state')).toBe('added')
    expect(row()?.textContent).toContain('Veritasium')
    expect(row()?.textContent).toContain(L('link.status.added', { handle: '@veritasium' }))
    expect($(view.container, '[data-part="link-done"]')).not.toBeNull()

    click($(view.container, '[data-part="link-undo"]'))
    await flush(10)
    expect(sdkMock.restCalls.some((c) => c.path === '/changes/41/undo')).toBe(true)
    expect(sdkMock.restCalls.some((c) => c.path === '/changes/42/undo')).toBe(false)
    expect(row()?.getAttribute('data-state')).toBe('undone')
    expect(row()?.textContent).toContain(L('link.status.undone'))
  })

  it.each([
    ['duplicate', { code: 'conflict', message: 'x', details: { channel: { title: 'Marques Brownlee' }, channel_id: 'UCBJycsmduvYEL83R_U4JriQ' } }, 'exists', 'link.status.exists'],
    ['not found', { code: 'youtube_error', message: 'x', details: { status: 404 } }, 'error', 'link.errors.not_found'],
    ['removed', { code: 'youtube_error', message: 'x', details: { status: 410 } }, 'error', 'link.errors.not_found'],
    ['YouTube rate limiting', { code: 'youtube_error', message: 'x', details: { status: 429 } }, 'error', 'link.errors.rate_limited'],
    ['YouTube down', { code: 'youtube_error', message: 'x', details: { status: 503 } }, 'error', 'link.errors.youtube_down'],
    ['YouTube down (network)', { code: 'youtube_error', message: 'x' }, 'error', 'link.errors.youtube_down'],
    ['slow (pending)', { code: 'timeout', message: 'x', details: { pending: true } }, 'late', 'link.status.late'],
    ['timed out', { code: 'timeout', message: 'x' }, 'error', 'link.errors.timeout'],
    ['invalid on the server', { code: 'invalid', message: 'x', details: { field: 'url_or_handle' } }, 'error', 'link.errors.format'],
    ['transport failure', { transport: true }, 'error', 'link.errors.generic']
  ])('readable error: %s', async (_name, error, state, textKey) => {
    pairWorld({ 'POST /channels/add': () => Promise.reject(error) })
    const view = render(<OnboardingDialog step="link" onClose={onClose} />)
    await flush()
    type($(view.container, '[data-part="link-input"]'), '@mkbhd')
    submit(view.container)
    await flush(10)
    const row = $(view.container, '[data-part="link-row"]')
    expect(row?.getAttribute('data-state')).toBe(state)
    expect(row?.textContent).toContain(L(textKey))
    if (state === 'exists') expect(row?.textContent).toContain('Marques Brownlee')
    expect(row?.textContent).not.toContain('network down')
  })

  it('transient error: try again repeats the request', async () => {
    let n = 0
    const mkbhd = channel('UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee', '@mkbhd')
    pairWorld({
      'POST /channels/add': () => (++n === 1 ? Promise.reject({ code: 'youtube_error', message: 'x', details: { status: 502 } }) : mkbhd)
    })
    const view = render(<OnboardingDialog step="link" onClose={onClose} />)
    await flush()
    type($(view.container, '[data-part="link-input"]'), '@mkbhd')
    submit(view.container)
    await flush(10)
    click($(view.container, '[data-part="link-retry"]'))
    await flush(10)
    expect(n).toBe(2)
    const rows = $$(view.container, '[data-part="link-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('data-state')).toBe('added')
  })

  it('"done" closes and tells Subscriptions', async () => {
    pairWorld({ 'POST /channels/add': channel('UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee', '@mkbhd') })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const view = render(<OnboardingDialog step="link" onClose={onClose} />)
    await flush()
    type($(view.container, '[data-part="link-input"]'), 'https://www.youtube.com/@mkbhd')
    submit(view.container)
    await flush(10)
    click($(view.container, '[data-part="link-done"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalled()
  })

  it('parseChannelInput accepts what the server accepts and refuses the rest', () => {
    expect(parseChannelInput('@mkbhd')).toBe('handle')
    expect(parseChannelInput('UCBJycsmduvYEL83R_U4JriQ')).toBe('channel_id')
    expect(parseChannelInput('https://www.youtube.com/@mkbhd')).toBe('channel_url')
    expect(parseChannelInput('youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ')).toBe('channel_url')
    expect(parseChannelInput('https://youtu.be/dQw4w9WgXcQ')).toBe('video_url')
    expect(parseChannelInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('video_url')
    expect(parseChannelInput('m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('video_url')
    expect(parseChannelInput('mkbhd')).toBeNull()
    expect(parseChannelInput('https://vimeo.com/@x')).toBeNull()
    expect(parseChannelInput('@ with space')).toBeNull()
    expect(parseChannelInput('')).toBeNull()
  })
})

// ------------------------------------------------------------------ demo

describe('demo mode', () => {
  const report = { channels: 40, folders: 6, tags: 0, tabs: 1, videos: 0, skipped: 0, warnings: [] }

  it('one click: loads, follows the videos arriving, shows "clear" and closes by itself', async () => {
    let st = status({ refresh_running: true })
    pairWorld({ 'POST /demo/load': report, 'POST /refresh': { result: 'started' }, 'GET /status': () => st })
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush()
    click($$(view.container, '[data-part="path-card"] button')[2])
    await flush(10)
    expect(restCount('POST', '/demo/load')).toBe(1)
    expect(sdkMock.restCalls.find((c) => c.path === '/refresh')?.opts?.body).toEqual({ force: true })
    const phase = () => $(view.container, '[data-part="demo"]')?.getAttribute('data-phase')
    expect(phase()).toBe('arriving')
    const steps = () => $$(view.container, '[data-part="demo"] [data-part="steps"] li').map((s) => s.getAttribute('data-status'))
    expect(steps()).toEqual(['done', 'running', 'waiting'])
    expect(view.text()).toContain(`${L('plural.channels_other', { count: 40 })} · ${L('plural.folders_other', { count: 6 })}`)
    // no destructive action during the load; the way forward is to see the subscriptions
    expect($(view.container, '[data-part="demo-clear"]')).toBeNull()
    expect($(view.container, '[data-part="demo-open"]')?.textContent).toBe(L('done.open_now'))

    st = status({ refresh_running: true, new_total: 12 })
    await advance(LIVE_POLL_MS)
    expect(view.text()).toContain(L('plural.videos_other', { count: 12 }))
    expect(phase()).toBe('arriving')
    expect($(view.container, '[data-part="demo-clear"]')).toBeNull()

    st = status({ refresh_running: false, new_total: 37, last_rss_at: NOW_S + 3 })
    await advance(LIVE_POLL_MS)
    expect(phase()).toBe('ready')
    expect(steps()).toEqual(['done', 'done', 'done'])
    expect(view.text()).toContain(L('plural.videos_other', { count: 37 }))
    expect($(view.container, '[data-part="demo-clear"]')).not.toBeNull()
    await advance(AUTO_CLOSE_S * 1000)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('flaky YouTube: degraded strip while the videos arrive', async () => {
    pairWorld({ 'POST /demo/load': report, 'POST /refresh': { result: 'started' }, 'GET /status': status({ refresh_running: true, rss_down_since: NOW_S - 600 }) })
    const view = render(<OnboardingDialog step="demo" onClose={onClose} />)
    await flush(10)
    await advance(LIVE_POLL_MS)
    expect($(view.container, '[data-part="demo"] [data-part="banner"][data-tone="warning"]')?.textContent).toContain(L('demo.rss_down'))
  })

  it('clear demo (optimistic) and load again', async () => {
    const clear = deferred<typeof report>()
    pairWorld({ 'GET /demo': { loaded: true }, 'POST /demo/clear': () => clear.promise, 'POST /demo/load': report, 'POST /refresh': { result: 'started' } })
    const view = render(<OnboardingDialog step="demo" onClose={onClose} />)
    await flush(10)
    expect(restCount('POST', '/demo/load')).toBe(0) // already loaded: does not reload
    const phase = () => $(view.container, '[data-part="demo"]')?.getAttribute('data-phase')
    expect(phase()).toBe('loaded')
    expect(view.text()).toContain(L('demo.loaded_title'))
    click($(view.container, '[data-part="demo-clear"]'))
    await flush()
    expect(phase()).toBe('cleared') // before the response
    clear.resolve(report)
    await flush()
    expect(view.text()).toContain(L('demo.cleared_title'))
    click($(view.container, '[data-part="demo-load-again"]'))
    await flush(10)
    expect(restCount('POST', '/demo/load')).toBe(1)
    expect(phase()).toBe('arriving')
  })

  it('clear failed: back to the previous state and shows the error', async () => {
    pairWorld({ 'GET /demo': { loaded: true }, 'POST /demo/clear': () => Promise.reject({ transport: true }) })
    const view = render(<OnboardingDialog step="demo" onClose={onClose} />)
    await flush(10)
    click($(view.container, '[data-part="demo-clear"]'))
    await flush(10)
    expect($(view.container, '[data-part="demo"]')?.getAttribute('data-phase')).toBe('loaded')
    expect(view.text()).toContain(L('demo.errors.clear'))
  })

  it('load failed: an error is an error (no "0 channels"), with try again', async () => {
    let n = 0
    pairWorld({
      'POST /demo/load': () => (++n === 1 ? Promise.reject({ code: 'conflict', message: 'x' }) : report),
      'POST /refresh': { result: 'started' }
    })
    const view = render(<OnboardingDialog step="demo" onClose={onClose} />)
    await flush(10)
    expect($(view.container, '[data-part="demo"]')?.getAttribute('data-phase')).toBe('error')
    expect(view.text()).toContain(L('demo.errors.load'))
    expect(view.text()).not.toContain(L('plural.channels_other', { count: 0 }))
    click($(view.container, '[data-part="demo"] [data-part="banner-action"]'))
    await flush(10)
    expect($(view.container, '[data-part="demo"]')?.getAttribute('data-phase')).toBe('arriving')
  })
})

// ------------------------------------------------------------------ devices

describe('connected devices', () => {
  it('list with revoke: confirmation (focus on "not now"), disappears at once and calls the route', async () => {
    const revoke = deferred<{ revoked: boolean }>()
    pairWorld({
      'GET /devices': { items: [device('dev_1', 'Chrome — Mac', { last_seen: NOW_S - 180 })] },
      'POST /devices/{id}/revoke': () => revoke.promise
    })
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush(10)
    const row = () => $(view.container, '[data-part="device-row"][data-id="dev_1"]')
    expect(row()?.textContent).toContain('Chrome — Mac')
    expect(row()?.textContent).toContain('3 min. ago')
    click($(view.container, '[data-part="device-revoke"]'))
    expect(view.text()).toContain(L('devices.revoke_title', { name: 'Chrome — Mac' }))
    expect(document.activeElement).toBe($(view.container, '[data-part="approval-cancel"]'))
    expect(view.text()).toContain(L('devices.revoke_cancel'))
    click($(view.container, '[data-part="approval-cancel"]'))
    expect($(view.container, '[data-part="approval"]')).toBeNull()
    expect(restCount('POST', '/devices/dev_1/revoke')).toBe(0)

    click($(view.container, '[data-part="device-revoke"]'))
    click($(view.container, '[data-part="approval-confirm"]'))
    await flush()
    expect(restCount('POST', '/devices/dev_1/revoke')).toBe(1)
    expect(row()).toBeNull() // optimistic
    revoke.resolve({ revoked: true })
    await flush()
    expect(row()).toBeNull()
  })

  it('revoke failed: the device comes back and the error shows', async () => {
    pairWorld({
      'GET /devices': { items: [device('dev_1', 'Chrome — Mac')] },
      'POST /devices/{id}/revoke': () => Promise.reject({ transport: true })
    })
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush(10)
    click($(view.container, '[data-part="device-revoke"]'))
    click($(view.container, '[data-part="approval-confirm"]'))
    await flush(10)
    expect($(view.container, '[data-part="device-row"][data-id="dev_1"]')).not.toBeNull()
    expect(view.text()).toContain(L('devices.revoke_failed', { name: 'Chrome — Mac' }))
  })

  it('error listing: message + try again (no false empty list)', async () => {
    let n = 0
    pairWorld({ 'GET /devices': () => (++n === 1 ? Promise.reject({ code: 'internal', message: 'x' }) : { items: [device('dev_1', 'Chrome — Mac')] }) })
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush(10)
    const section = $(view.container, '[data-part="devices"]')
    expect(section?.textContent).toContain(L('devices.error'))
    click($(view.container, '[data-part="devices"] [data-part="banner-action"]'))
    await flush(10)
    expect($(view.container, '[data-part="device-row"][data-id="dev_1"]')).not.toBeNull()
  })

  it('no devices: the subtle section does not show on the initial screen', async () => {
    pairWorld()
    const view = render(<OnboardingDialog onClose={onClose} />)
    await flush(10)
    expect($(view.container, '[data-part="devices"]')).toBeNull()
  })
})

// ------------------------------------------------------------------ preview scenarios

describe('preview scenarios', () => {
  it('cover the requested states, at widths 420 and 900', () => {
    const ids = scenarios.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [
      'onboarding-initial',
      'onboarding-pair-code',
      'onboarding-pair-waiting',
      'onboarding-pair-syncing',
      'onboarding-pair-expired',
      'onboarding-pair-down',
      'onboarding-link-success',
      'onboarding-link-error',
      'onboarding-demo-loading',
      'onboarding-devices'
    ])
      expect(ids).toContain(id)
    for (const s of scenarios) expect(s.widths).toEqual([420, 900])
  })

  it.each(scenarios.map((s) => ({ id: s.id, s })))('$id mounts over the fake map', async ({ s }) => {
    const errors = vi.spyOn(console, 'error')
    backend(Object.fromEntries(Object.entries(s.rest ?? {}).map(([k, v]) => [k, v as Route])))
    sdkMock.requestHandler = (method) => {
      const short = method.replace(`plugin.${PLUGIN_ID}.`, '')
      const v = s.rpc?.[method] ?? s.rpc?.[short]
      if (v === undefined) throw rpcError(-32601, `unknown method ${method}`)
      return typeof v === 'function' ? (v as (p: unknown) => unknown)(undefined) : v
    }
    const view = render(<>{s.render()}</>)
    await flush(10)
    expect(view.text()).toContain(L('title'))
    expect(view.text()).not.toMatch(/onboarding\.[a-z_]+/) // no raw key
    expect(errors).not.toHaveBeenCalled()
  })

  it('server down and link with error show the error text', async () => {
    const pick = (id: string) => scenarios.find((s) => s.id === id)!
    for (const [id, text] of [
      ['onboarding-pair-down', L('pair.errors.ext_endpoint_down.title')],
      ['onboarding-pair-reconnect', enCommon.reconnect_open_hermes],
      ['onboarding-link-error', L('link.errors.not_found')],
      ['onboarding-pair-expired', L('pair.expired_hint')]
    ] as const) {
      const s = pick(id)
      backend(Object.fromEntries(Object.entries(s.rest ?? {}).map(([k, v]) => [k, v as Route])))
      const view = render(<>{s.render()}</>)
      await flush(10)
      expect(view.text(), id).toContain(text)
      view.unmount()
    }
  })
})

// ------------------------------------------------------------------ texts

describe('texts', () => {
  const leafKeys = (tree: Tree, prefix = ''): string[] =>
    Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)))
  const leaf = (tree: Tree, k: string) => k.split('.').reduce<Tree | string | undefined>((n, p) => (typeof n === 'object' ? n[p] : undefined), tree)

  it('EN and PT-BR have exactly the same keys', () => {
    expect(leafKeys(EN).length).toBeGreaterThan(50)
    expect(leafKeys(PT).sort()).toEqual(leafKeys(EN).sort())
  })

  it('no empty text (except the store link, which does not exist yet) and the same {placeholders}', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const k of leafKeys(EN)) {
      const en = leaf(EN, k) as string
      const pt = leaf(PT, k) as string
      if (k === 'pair.install.store_url') continue
      expect(en.trim(), `en ${k}`).not.toBe('')
      expect(pt.trim(), `pt ${k}`).not.toBe('')
      expect(vars(pt), k).toEqual(vars(en))
    }
  })

  it('every literal key used by the dialog exists', () => {
    const files = listRepoFiles('desktop-src/dialogs/onboarding', ['.ts', '.tsx']).filter((f) => !f.endsWith('preview.scenarios.tsx'))
    const used = new Set<string>()
    for (const f of files) for (const m of readRepoFile(f).matchAll(/\bt\(\s*'([a-z0-9_.]+)'/g)) used.add(m[1])
    expect(used.size).toBeGreaterThan(30)
    const missing = [...used].filter((k) => typeof leaf(EN, k) !== 'string')
    expect(missing).toEqual([])
  })
})
