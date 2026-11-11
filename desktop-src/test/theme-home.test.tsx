// Theme tab with AI from Home: the "New theme" button next to "+ New tab" (opens the theme dialog; disabled with
// the reason when there is no AI model; icon only when narrow) and the theme built in the background (notice in the
// tab strip with the elapsed time, survives a reload, a notice when it ends — ready / failed with "Try again" —,
// nothing when cancelled or when the dialog is showing it). Fake backend per route; no network.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedItem, FeedPage, Job, StatusResponse, Tab, TabRules } from '../../shared/api-types'
import { PLUGIN_ID, RPC_CAPABILITY, rpcMethod } from '../../shared/ids'
import enCommon from '../locales/en/common.json'
import enHome from '../locales/en/home.json'
import ptHome from '../locales/pt-BR/home.json'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { interpolate, registerLocales } from '../lib/i18n'
import { THEME_PENDING_KEY, formatElapsed } from '../lib/jobs'
import { HomePage } from '../pages/home'
import { advance, click, flush, render } from './render'
import { createMockCtx, emitEvent, rpcError, sdkMock } from './sdk-mock'

// ------------------------------------------------------------------ texts

type Tree = { [k: string]: Tree | string }

function pick(tree: Tree, key: string): string {
  let node: Tree | string = tree
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return node
}

const en = (key: string, vars?: Record<string, string | number>) => interpolate(pick(enHome as unknown as Tree, key), vars)
const enC = (key: string) => pick(enCommon as unknown as Tree, key)

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)))
}

// ------------------------------------------------------------------ fixtures

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
  { id: 'all-new', name: 'All new', kind: 'mixed', rules: rules({ all: true }, true), icon: null, filters: {}, sort: 0, builtin: true },
  { id: 'tab_tech', name: 'Tech', kind: 'category', rules: rules({ folders: ['f_tech'] }), icon: null, filters: {}, sort: 1, builtin: false }
]

function item(n: number): FeedItem {
  return {
    video: {
      id: `v${String(n).padStart(10, '0')}`,
      channel_id: 'UCsBjURrPoezykLs9EqgamOA',
      title: `Video number ${n}`,
      published_at: NOW_S - n * 3600,
      description: null,
      channel_title: 'Fireship',
      duration_s: 300,
      is_short: false,
      views: 1000,
      first_seen_at: NOW_S - n * 3600,
      origin: 'rss'
    },
    channel: null,
    state: 'new',
    reaction: null,
    is_new: true,
    why: { via: 'folder', label: 'Tech', detail: null },
    badges: []
  }
}

const page = (items: FeedItem[]): FeedPage => ({ items, next_cursor: null, counts: { total: items.length, new: items.length } })

function status(): StatusResponse {
  return {
    new_total: 2,
    new_by_tab: [{ tab_id: 'all-new', name: 'All new', count: 2, icon: null }],
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
    subscribed_total: 34
  }
}

function job(id: string, status: Job['status'], over: Partial<Job> = {}): Job {
  return { id, kind: 'theme', status, created_at: NOW_S, updated_at: NOW_S, progress: null, result: null, error: null, ...over }
}

// ------------------------------------------------------------------ fake backend

interface Req {
  method: string
  path: string
  query: Record<string, string>
}

type Route = (req: Req) => unknown

let routes: Record<string, Route>
let calls: Req[]
let handle: ReturnType<typeof createMockCtx>
let jobs: Record<string, Job>
let rpcs: Record<string, (params: Record<string, unknown> | undefined) => unknown>

function install(): void {
  sdkMock.restHandler = (rawPath, opts) => {
    const [path, qs = ''] = rawPath.split('?')
    const method = String(opts?.method ?? 'GET')
    const req: Req = { method, path, query: Object.fromEntries(new URLSearchParams(qs)) }
    calls.push(req)
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ')
      return m === method && new RegExp(`^${p.replace(/\{\w+\}/g, '[^/]+')}$`).test(path)
    })
    if (!key) return { ok: false, error: { code: 'not_found', message: `no route ${method} ${path}` } }
    return Promise.resolve()
      .then(() => routes[key](req))
      .then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error })
      )
  }
  sdkMock.requestHandler = (method, params) => {
    if (method === 'runtime.describe') return { capabilities: [RPC_CAPABILITY] }
    const short = method.startsWith(`plugin.${PLUGIN_ID}.`) ? method.slice(`plugin.${PLUGIN_ID}.`.length) : method
    const h = rpcs[short]
    if (!h) throw rpcError(-32601, `unknown method ${method}`)
    return h(params)
  }
}

function defaultRoutes(): Record<string, Route> {
  return {
    'GET /tabs': () => ({ items: TABS }),
    'GET /status': () => status(),
    'GET /channels': () => ({ items: [], total: 40 }),
    'GET /feed': () => page([item(1), item(2)]),
    'GET /changes': () => ({ items: [] }),
    'GET /ai/status': () => ({ available: true, model: 'm', reason: null }),
    'GET /jobs': () => ({ items: Object.values(jobs).filter((j) => j.status === 'queued' || j.status === 'running') }),
    'GET /jobs/{id}': (req) => {
      const found = jobs[req.path.split('/').pop() ?? '']
      if (!found) throw { code: 'not_found', message: 'gone' }
      return found
    }
  }
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const slot = (root: ParentNode) => q(root, '[data-part="tabbar"] [data-part="tab-add-slot"]')
const building = (root: ParentNode) => q(root, '[data-part="theme-building"]')
const magic = (root: ParentNode) => q(root, '[data-part="new-theme"]')
const notes = () => sdkMock.notifications as Array<{ kind: string; message: string; action?: { label: string; onClick: () => void } }>
const rpcCalls = (name: string) => sdkMock.requests.filter((r) => r.method === rpcMethod(name as never))
const topDialog = () => $dialogStack.get().at(-1)

async function mount() {
  const view = render(<HomePage />)
  await flush(15)
  return view
}

function store(over: Record<string, unknown> = {}): void {
  handle.storage.set(THEME_PENDING_KEY, { jobId: 'job_3', query: 'Astrophysics', at: Date.now(), counts: {}, params: { query: 'Astrophysics', language: 'en' }, ...over })
}

/** The job changes on the server and its event arrives (the screen also polls every 2 s). */
async function serverSays(next: Job) {
  jobs[next.id] = next
  emitEvent(`plugin.${PLUGIN_ID}.theme.ready`, { job: next.id, status: next.status })
  await flush(20)
}

class NarrowRO {
  constructor(private readonly cb: (entries: Array<{ contentRect: { width: number }; target: Element }>) => void) {}
  observe(el: Element) {
    this.cb([{ contentRect: { width: 400 }, target: el }])
  }
  unobserve() {}
  disconnect() {}
}

class FakeIO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  routes = defaultRoutes()
  calls = []
  jobs = {}
  rpcs = {}
  vi.stubGlobal('IntersectionObserver', FakeIO)
  install()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ------------------------------------------------------------------ the button

describe('"New theme" next to "+ New tab"', () => {
  it('sits in the tab strip slot, after "+ New tab", with the wand, and opens the theme dialog straight away', async () => {
    const v = await mount()
    const s = slot(v.container)!
    const parts = [...s.querySelectorAll<HTMLElement>('[data-part="new-tab"], [data-part="new-theme"]')].map((b) => b.getAttribute('data-part'))
    expect(parts).toEqual(['new-tab', 'new-theme'])
    const btn = magic(v.container)!
    expect(btn.textContent).toContain(en('theme_build.button'))
    expect(btn.getAttribute('aria-label')).toBe(en('theme_build.button'))
    expect(btn.querySelector('[data-icon="wand"]')).not.toBeNull()
    expect(btn.getAttribute('data-tip')).toBe(en('theme_build.button_tip'))
    expect(btn.hasAttribute('disabled')).toBe(false)
    click(btn)
    expect(topDialog()).toMatchObject({ id: 'theme', props: {} })
  })

  it('"Theme" stays inside the "+ New tab" menu', async () => {
    const v = await mount()
    click(q(v.container, '[data-part="new-tab"]'))
    await flush()
    expect(q(v.container, '[data-entry="theme"]')).not.toBeNull()
  })

  it('no AI model (GET /ai/status available: false): disabled, with the same reason the dialog gives', async () => {
    routes['GET /ai/status'] = () => ({ available: false, model: null, reason: 'no_model' })
    const v = await mount()
    const btn = magic(v.container)!
    expect(btn.hasAttribute('disabled')).toBe(true)
    const wrap = q(v.container, '[data-part="new-theme-off"]')!
    expect(wrap.getAttribute('data-tip')).toBe(en('theme_build.no_ai'))
    expect(wrap.getAttribute('tabindex')).toBe('0')
    click(btn)
    expect(topDialog()).toBeUndefined()
  })

  it('status unknown (route missing or failing): enabled, nothing blocked', async () => {
    delete routes['GET /ai/status']
    const v = await mount()
    expect(magic(v.container)?.hasAttribute('disabled')).toBe(false)
    expect(q(v.container, '[data-part="new-theme-off"]')).toBeNull()
  })

  it('narrow: icon only, the label in the tip and in aria-label', async () => {
    vi.stubGlobal('ResizeObserver', NarrowRO)
    const v = await mount()
    const btn = magic(v.container)!
    expect(btn.textContent?.trim()).toBe('')
    expect(btn.getAttribute('aria-label')).toBe(en('theme_build.button'))
    expect(btn.getAttribute('data-tip')).toBe(en('theme_build.button'))
  })
})

// ------------------------------------------------------------------ background build

describe('theme built in the background', () => {
  it('stored job still running: notice in the tab strip with the elapsed time (fake clock); click reopens that job', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    store({ at: Date.now() - 65_000 })
    jobs.job_3 = job('job_3', 'running', { progress: { stage: 'curate', done: 0, total: 4, message: null } })
    const v = await mount()
    const note = building(v.container)!
    expect(note.textContent).toContain(en('theme_build.building', { name: 'Astrophysics' }))
    expect(q(note, '[data-part="theme-building-time"]')?.textContent).toBe('1:05')
    expect(magic(v.container)).toBeNull()
    await advance(10_000)
    expect(q(building(v.container)!, '[data-part="theme-building-time"]')?.textContent).toBe('1:15')
    click(building(v.container))
    expect(topDialog()).toMatchObject({ id: 'theme', props: { jobId: 'job_3' } })
  })

  it('reload with nothing stored: GET /jobs?kind=theme says a theme is running → the notice comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    jobs.job_9 = job('job_9', 'running', { created_at: Math.floor(Date.now() / 1000) - 30 })
    const v = await mount()
    expect(calls.some((c) => c.path === '/jobs' && c.query.kind === 'theme')).toBe(true)
    const note = building(v.container)!
    expect(note.textContent).toContain(en('theme_build.building_unnamed'))
    expect(q(note, '[data-part="theme-building-time"]')?.textContent).toBe('0:30')
  })

  it('nothing running: no notice, the button is there', async () => {
    const v = await mount()
    expect(building(v.container)).toBeNull()
    expect(magic(v.container)).not.toBeNull()
  })

  it('ends ready: one notice "Theme “X” is ready" with "Open preview" (that job); the button comes back', async () => {
    store()
    jobs.job_3 = job('job_3', 'running')
    const v = await mount()
    expect(building(v.container)).not.toBeNull()
    await serverSays(job('job_3', 'done', { result: {} }))
    expect(building(v.container)).toBeNull()
    expect(magic(v.container)).not.toBeNull()
    const ready = notes().filter((n) => n.message === en('theme_build.ready', { name: 'Astrophysics' }))
    expect(ready).toHaveLength(1)
    expect(ready[0].kind).toBe('success')
    expect(ready[0].action?.label).toBe(en('theme_build.open_preview'))
    act(() => ready[0].action!.onClick())
    expect(topDialog()).toMatchObject({ id: 'theme', props: { jobId: 'job_3' } })
    // the preview stays reachable (reopening the dialog shows it) and nobody announces it again
    expect(handle.storage.get(THEME_PENDING_KEY)).toMatchObject({ jobId: 'job_3', seen: true })
    v.unmount()
    await mount()
    expect(notes().filter((n) => n.message.includes('Astrophysics'))).toHaveLength(1)
  })

  it('ends failed: notice with the reason and "Try again", which repeats the same request and follows it', async () => {
    store()
    jobs.job_3 = job('job_3', 'running')
    rpcs['theme.create'] = () => ({ ok: true, data: { job: job('job_4', 'queued') } })
    const v = await mount()
    await serverSays(job('job_3', 'error', { error: { code: 'youtube_error', message: 'search down' } }))
    const failed = notes().at(-1)!
    expect(failed.kind).toBe('error')
    expect(failed.message).toBe(en('theme_build.failed', { name: 'Astrophysics', error: enC('errors.youtube_error') }))
    expect(failed.action?.label).toBe(en('theme_build.retry'))
    expect(handle.storage.has(THEME_PENDING_KEY)).toBe(false)
    jobs.job_4 = job('job_4', 'running')
    act(() => failed.action!.onClick())
    await flush(20)
    expect(rpcCalls('theme.create').map((r) => r.params)).toEqual([{ query: 'Astrophysics', language: 'en' }])
    expect(handle.storage.get(THEME_PENDING_KEY)).toMatchObject({ jobId: 'job_4', query: 'Astrophysics' })
    expect(building(v.container)?.getAttribute('data-job')).toBe('job_4')
  })

  it('"Try again" refused (busy, no model…): opens the dialog with the text, which explains it', async () => {
    store()
    jobs.job_3 = job('job_3', 'running')
    rpcs['theme.create'] = () => ({ ok: false, error: { code: 'busy', message: 'one at a time' } })
    await mount()
    await serverSays(job('job_3', 'error', { error: { code: 'internal', message: 'boom' } }))
    act(() => notes().at(-1)!.action!.onClick())
    await flush(20)
    expect(topDialog()).toMatchObject({ id: 'theme', props: { query: 'Astrophysics' } })
  })

  it('cancelled (here or elsewhere): no notice, the stored job is dropped', async () => {
    store()
    jobs.job_3 = job('job_3', 'running')
    const v = await mount()
    await serverSays(job('job_3', 'error', { error: { code: 'cancelled', message: 'cancelled' } }))
    expect(notes()).toHaveLength(0)
    expect(building(v.container)).toBeNull()
    expect(handle.storage.has(THEME_PENDING_KEY)).toBe(false)
  })

  it('theme dialog open: Home stays quiet (the dialog shows the end itself)', async () => {
    store()
    jobs.job_3 = job('job_3', 'running')
    await mount()
    act(() => $dialogStack.set([{ id: 'theme', props: { jobId: 'job_3' }, seq: 1 }]))
    await serverSays(job('job_3', 'done', { result: {} }))
    expect(notes()).toHaveLength(0)
  })

  it('a job already shown (seen) is not followed again', async () => {
    store({ seen: true })
    jobs.job_3 = job('job_3', 'done', { result: {} })
    const v = await mount()
    expect(calls.filter((c) => c.path === '/jobs/job_3')).toHaveLength(0)
    expect(notes()).toHaveLength(0)
    expect(magic(v.container)).not.toBeNull()
  })

  it('stored job gone from the server (purged): no notice, not followed again', async () => {
    store()
    const v = await mount()
    expect(notes()).toHaveLength(0)
    expect(building(v.container)).toBeNull()
    expect(handle.storage.get(THEME_PENDING_KEY)).toMatchObject({ seen: true })
  })
})

// ------------------------------------------------------------------ texts

describe('texts', () => {
  it('home keys EN = PT-BR (theme_build)', () => {
    const pt = leafKeys((ptHome as unknown as Tree).theme_build as Tree)
    expect(pt.sort()).toEqual(leafKeys((enHome as unknown as Tree).theme_build as Tree).sort())
  })

  it('in PT-BR the button says "Nova aba por assunto"', async () => {
    sdkMock.locale.set('pt-BR')
    const v = await mount()
    expect(magic(v.container)?.textContent).toContain('Nova aba por assunto')
  })

  it('formatElapsed is a clock', () => {
    expect([0, 7_000, 65_000, 161_000, 3_723_000].map(formatElapsed)).toEqual(['0:00', '0:07', '1:05', '2:41', '1:02:03'])
  })
})
