// Cleanup: states (loading, never scanned, scanning, full, no model, no history, list up to date,
// error, no extension, server down), selection one by one and by group, approval ONLY via RPC (`cleanup.approve`)
// with the ApprovalCard (initial focus on "Not now", Enter does not approve, Esc dismisses), `approval_refused`, live queue,
// undo via REST before/after execution (`undo_refused`), "Keep" with undo, Former subscriptions with
// resubscribe (RPC), i18n EN = PT-BR and the preview scenarios. Fake backend per route; no network.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ChannelRow, CleanupCandidate, CleanupView as CleanupData, Job, QueueItem, StatusResponse } from '../../shared/api-types'
import { PLUGIN_ID, RPC_CAPABILITY, rpcMethod } from '../../shared/ids'
import { currentSection, showSection } from '../lib/nav'
import enCleanup from '../locales/en/cleanup.json'
import ptCleanup from '../locales/pt-BR/cleanup.json'
import enCommon from '../locales/en/common.json'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { interpolate, registerLocales } from '../lib/i18n'
import { CleanupPage, QUEUE_POLL_MS, UNDO_MS } from '../pages/cleanup'
import { isPluginUnavailable, pickBanner } from '../pages/cleanup/model'
import { TubeApiError } from '../lib/rest'
import { scenarios } from '../pages/cleanup/preview.scenarios'
import { ScenarioView } from '../preview/ScenarioView'
import { installScenario } from '../preview/scenario'
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

/** EN text of a key in the `cleanup` namespace (with interpolation). */
const en = (key: string, vars?: Record<string, string | number>) => interpolate(pick(enCleanup as unknown as Tree, key), vars)
const enC = (key: string, vars?: Record<string, string | number>) => interpolate(pick(enCommon as unknown as Tree, key), vars)

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)))
}

// ------------------------------------------------------------------ fixtures

const NOW_S = Math.floor(Date.now() / 1000)
const D = 86400

const cid = (n: number) => `UC${String(n).padStart(22, 'x')}`

function channel(n: number, over: Partial<Channel> = {}): Channel {
  return {
    id: cid(n),
    title: `Channel ${n}`,
    relation: 'subscribed',
    source: 'extension',
    added_at: NOW_S - 400 * D,
    handle: `@ch${n}`,
    thumb: null,
    url: null,
    folder_id: null,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: NOW_S - 200 * D,
    videos_per_week: 0,
    shorts_ratio: null,
    ai_note: null,
    tag_ids: [],
    ...over
  }
}

function cand(n: number, group: CleanupCandidate['group'], why: string): CleanupCandidate {
  return { id: `cc_${n}`, channel_id: cid(n), group, why, status: 'pending', scan_id: 'scan_3', created_at: NOW_S - 3 * D }
}

const CANDIDATES: CleanupCandidate[] = [
  cand(1, 'stale', 'No new video in 240 days.'),
  cand(2, 'stale', 'No new video in 200 days.'),
  cand(3, 'ignored', '14 videos in 90 days, none watched.'),
  cand(4, 'off_profile', 'Gaming streams; you follow science and music.'),
  cand(5, 'off_profile', 'Crypto news; nothing like your folders.')
]

function view(over: { model?: string | null; candidates?: CleanupCandidate[]; scan?: null } = {}): CleanupData {
  if (over.scan === null) return { scan: null, channels: {} }
  const candidates = over.candidates ?? CANDIDATES
  return {
    scan: { scan_id: 'scan_3', created_at: NOW_S - 3 * D, model: over.model === undefined ? 'claude-haiku-5-5' : over.model, candidates },
    channels: Object.fromEntries(candidates.map((c) => [c.channel_id, channel(Number(c.id.slice(3)))]))
  }
}

function qitem(id: string, n: number, status: QueueItem['status'], over: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    channel_id: cid(n),
    action: 'unsubscribe',
    status,
    approved_at: NOW_S - 60,
    approved_via: 'desktop_rpc',
    created_at: NOW_S - 60,
    updated_at: NOW_S - 30,
    reason: null,
    error: null,
    device_id: null,
    ...over
  }
}

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 0,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: NOW_S - 60,
    refresh_running: false,
    queue_pending: 0,
    search_pending: 0,
    devices_online: 1,
    ext_port: 47615,
    rss_down_since: null,
    rss_fallback_channels: 0,
    ...over
  }
}

const EX: ChannelRow[] = [
  { channel: channel(9, { title: 'Old Channel', relation: 'ex', unsubscribed_at: NOW_S - 2 * D }), new_count: 0, watched_90d: null }
]

function job(id: string, st: Job['status'], result: unknown = null, progress: Job['progress'] = null): Job {
  return { id, kind: 'cleanup_scan', status: st, created_at: NOW_S, updated_at: NOW_S, progress, result, error: st === 'error' ? { code: 'internal', message: 'boom' } : null }
}

// ------------------------------------------------------------------ fake backend

interface Req {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

type Route = (req: Req) => unknown

let routes: Record<string, Route>
let calls: Req[]
let rpcs: Record<string, (params: Record<string, unknown> | undefined) => unknown>
let capability: boolean

function apiError(code: string, message = code, reason?: string) {
  return { code, message, ...(reason ? { reason } : {}) }
}

function rowsFor(ids: string[]): ChannelRow[] {
  return ids.map((id) => {
    const n = Number(id.replace(/^UCx*/, ''))
    return { channel: channel(n), new_count: 0, watched_90d: n === 3 ? 0 : 2 }
  })
}

function defaultRoutes(): Record<string, Route> {
  return {
    'GET /cleanup': () => view(),
    'GET /queue': () => ({ items: [], pending: 0 }),
    'GET /status': () => status(),
    'GET /channels': (req) => {
      if (req.query.relation === 'ex') return { items: EX, total: EX.length }
      if (req.query.ids) return { items: rowsFor(req.query.ids.split(',')), total: req.query.ids.split(',').length }
      return { items: [{ channel: channel(99), new_count: 0, watched_90d: 4 }], total: 40 }
    },
    'POST /cleanup/dismiss': (req) => ({ count: (req.body as { ids: string[] }).ids.length }),
    'POST /queue/undo': (req) => ({ items: (req.body as { ids: string[] }).ids.map((id) => qitem(id, 1, 'undone')) })
  }
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
      return m === method && new RegExp(`^${p.replace(/\{\w+\}/g, '[^/]+')}$`).test(path)
    })
    if (!key) return { ok: false, error: apiError('not_found', `no route ${method} ${path}`) }
    return Promise.resolve()
      .then(() => routes[key](req))
      .then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error })
      )
  }
  sdkMock.requestHandler = (method, params) => {
    if (method === 'runtime.describe') return { capabilities: capability ? [RPC_CAPABILITY] : [] }
    const short = method.startsWith(`plugin.${PLUGIN_ID}.`) ? method.slice(`plugin.${PLUGIN_ID}.`.length) : method
    const h = rpcs[short]
    if (!h) throw rpcError(-32601, `unknown method ${method}`)
    return h(params)
  }
}

const restTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path)
const writes = () => calls.filter((c) => c.method !== 'GET')
const rpcCalls = (name: string) => sdkMock.requests.filter((r) => r.method === rpcMethod(name as never))

async function mount() {
  const v = render(<CleanupPage />)
  await flush(15)
  return v
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const row = (root: ParentNode, n: number) => q(root, `[data-part="cleanup-row"][data-channel="${cid(n)}"]`)
const rowIds = (root: ParentNode) => qa(root, '[data-part="cleanup-row"]').map((r) => r.getAttribute('data-channel'))
const group = (root: ParentNode, g: string) => q(root, `[data-part="cleanup-group"][data-group="${g}"]`)
const checkbox = (el: ParentNode | null) => q(el!, 'input[type="checkbox"]') as HTMLInputElement
const lastNotification = () => sdkMock.notifications[sdkMock.notifications.length - 1] as { kind: string; message: string; action?: { label: string; onClick: () => void } }

function toggle(input: HTMLInputElement): void {
  act(() => {
    input.click()
  })
}

function key(el: Element, k: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => {
    el.dispatchEvent(ev)
  })
  return ev
}

beforeEach(() => {
  const handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  routes = defaultRoutes()
  calls = []
  capability = true
  rpcs = {
    'cleanup.approve': (p) => ({
      ok: true,
      data: { items: ((p?.channel_ids as string[]) ?? []).map((id, i) => ({ ...qitem(`q_${i + 1}`, Number(id.replace(/^UCx*/, '')), 'approved') })) }
    }),
    'cleanup.resubscribe': (p) => ({
      ok: true,
      data: { items: ((p?.channel_ids as string[]) ?? []).map((id) => qitem('q_r', Number(id.replace(/^UCx*/, '')), 'approved', { action: 'resubscribe' })) }
    }),
    'cleanup.scan': () => ({ ok: true, data: { job: job('job_2', 'queued') } })
  }
  install()
})

afterEach(() => {
  vi.useRealTimers()
})

// ------------------------------------------------------------------ states

describe('Cleanup states', () => {
  it('loading: skeleton of the groups with the final geometry, no "0" and no false empty', async () => {
    routes['GET /cleanup'] = () => new Promise(() => undefined)
    const v = await mount()
    expect(qa(v.container, '[data-part="suggestion-row"][data-skeleton]').length).toBeGreaterThanOrEqual(3)
    expect(v.text()).not.toContain(en('empty.clean_title'))
    expect(v.text()).not.toContain(en('empty.never_title'))
    expect(qa(v.container, '[data-part="section-count"], .num').map((e) => e.textContent)).not.toContain('0')
  })

  it('never scanned: invitation with "Scan now" (main action); scanning starts cleanup.scan and follows the job', async () => {
    let scanned = false
    routes['GET /cleanup'] = () => (scanned ? view() : view({ scan: null }))
    let jobStatus: Job['status'] = 'running'
    routes['GET /jobs/{id}'] = () => job('job_2', jobStatus, null, { stage: 'rules', done: 12, total: 40, message: null })
    const v = await mount()
    expect(v.text()).toContain(en('empty.never_title'))
    const start = qa(v.container, '[data-part="empty"] button').find((b) => b.textContent === en('actions.scan_first'))!
    expect(start.getAttribute('data-variant') ?? 'default').toBe('default') // no variant = main (accent)
    click(start)
    await flush(15)
    expect(rpcCalls('cleanup.scan')).toHaveLength(1)
    expect(rpcCalls('cleanup.scan')[0].params).toEqual({})
    // scanning: strip with progress + skeleton (no empty state)
    expect(q(v.container, '[data-part="banner"]')?.textContent).toContain(en('banner.scanning_progress', { done: '12', total: '40' }))
    expect(qa(v.container, '[data-part="suggestion-row"][data-skeleton]').length).toBeGreaterThan(0)
    // end of the job: refetches GET /cleanup and shows the groups
    jobStatus = 'done'
    scanned = true
    emitEvent(`plugin.${PLUGIN_ID}.cleanup.scanned`, { job: 'job_2', status: 'done' })
    await flush(20)
    expect(rowIds(v.container)).toHaveLength(5)
  })

  it('full: 3 groups with a count, the rule in one line, a factual reason, last video and watched counts', async () => {
    const v = await mount()
    for (const g of ['stale', 'ignored', 'off_profile']) expect(group(v.container, g)).not.toBeNull()
    expect(group(v.container, 'manual')).toBeNull()
    const stale = group(v.container, 'stale')!
    expect(stale.textContent).toContain(en('groups.stale.title'))
    expect(stale.textContent).toContain(en('groups.stale.rule'))
    expect(q(stale, '[data-part="section-count"]')?.textContent ?? stale.textContent).toContain('2')
    expect(group(v.container, 'off_profile')!.textContent).toContain(en('groups.off_profile.rule'))
    expect(row(v.container, 1)?.textContent).toContain('No new video in 240 days')
    expect(row(v.container, 1)?.textContent).toContain('Channel 1')
    expect(row(v.container, 1)?.textContent).toContain(en('row.watched', { count: '2' }))
    // the "You don't watch" reason already says the watched count: the line has the last video
    expect(row(v.container, 3)?.textContent).toMatch(/last video/)
    expect(row(v.container, 4)?.textContent).toMatch(/last video/)
    expect(row(v.container, 4)?.textContent).toContain(en('row.watched', { count: '2' }))
    // header: last scan + model
    expect(v.text()).toContain(en('subtitle.by_model', { model: 'claude-haiku-5-5' }))
    expect(v.text()).toMatch(/Last scan .*3 days ago/)
  })

  it('no model: "reasons by rule" and the invitation to pick a model in the strip (the empty group does not show)', async () => {
    routes['GET /cleanup'] = () => view({ model: null, candidates: CANDIDATES.filter((c) => c.group !== 'off_profile') })
    const v = await mount()
    expect(v.text()).toContain(en('subtitle.by_rule'))
    expect(q(v.container, '[data-part="banner"]')?.textContent).toContain(en('banner.no_model'))
    expect(group(v.container, 'off_profile')).toBeNull()
  })

  it('rule-only scan while the configured provider is unreachable: "couldn\'t reach your model", not "pick a model"', async () => {
    const PROVIDER = 'claude-subscription-directsdk-experimental'
    routes['GET /cleanup'] = () => view({ model: null, candidates: CANDIDATES.filter((c) => c.group !== 'off_profile') })
    routes['GET /ai/status'] = () => ({ available: false, model: 'claude-sonnet-5-5', reason: 'provider_unavailable', provider: PROVIDER })
    const v = await mount()
    const strip = q(v.container, '[data-part="banner"]')
    expect(strip?.textContent).toContain(en('banner.provider_unavailable', { route: `${PROVIDER} · claude-sonnet-5-5` }))
    expect(strip?.textContent).not.toContain(en('banner.no_model'))
    click(q(strip!, '[data-part="banner-action"]'))
    expect(sdkMock.navigations).toContain(`/settings?tab=config:model&aux=${PLUGIN_ID.replace(/-/g, '_')}_curator`)
  })

  it('ignored without extension history: explains and offers to connect (opens pairing)', async () => {
    routes['GET /cleanup'] = () => view({ candidates: CANDIDATES.filter((c) => c.group !== 'ignored') })
    routes['GET /channels'] = (req) =>
      req.query.relation === 'ex' ? { items: [], total: 0 } : req.query.ids ? { items: [], total: 0 } : { items: [{ channel: channel(99), new_count: 0, watched_90d: null }], total: 40 }
    const v = await mount()
    const ignored = group(v.container, 'ignored')!
    expect(ignored.textContent).toContain(en('groups.ignored.needs_history'))
    click(qa(ignored, 'button').find((b) => b.textContent === en('actions.connect'))!)
    expect($dialogStack.get().at(-1)?.id).toBe('onboarding')
  })

  it('all clean: "list up to date" with a way forward (Subscriptions), no groups', async () => {
    routes['GET /cleanup'] = () => view({ candidates: [] })
    const v = await mount()
    const empty = q(v.container, '[data-part="empty"]')!
    expect(empty.textContent).toContain(en('empty.clean_title'))
    showSection('cleanup')
    click(qa(empty, 'button').find((b) => b.textContent === en('actions.home'))!)
    // the single page switches to Subscriptions (no other route)
    expect(currentSection()).toBe('home')
    expect(sdkMock.navigations).toEqual([])
    expect(rowIds(v.container)).toHaveLength(0)
  })

  it('GET /cleanup error: ErrorView with try again (never a false "list up to date")', async () => {
    let fail = true
    routes['GET /cleanup'] = () => {
      if (fail) throw apiError('internal', 'database is locked')
      return view()
    }
    const v = await mount()
    expect(q(v.container, '[data-part="error"]')).not.toBeNull()
    expect(v.text()).not.toContain(en('empty.clean_title'))
    expect(v.text()).not.toContain(en('empty.never_title'))
    fail = false
    click(qa(q(v.container, '[data-part="error"]')!, 'button').find((b) => b.textContent === enC('retry'))!)
    await flush(15)
    expect(rowIds(v.container)).toHaveLength(5)
  })

  it('scan error: error strip with try again; the old groups stay', async () => {
    rpcs['cleanup.scan'] = () => ({ ok: false, error: apiError('busy', 'scan running') })
    const v = await mount()
    click(qa(v.container, '[data-part="page-head"] button').find((b) => b.textContent?.includes(en('actions.scan')))!)
    await flush(15)
    const banner = q(v.container, '[data-part="banner"][data-tone="error"]')!
    expect(banner.textContent).toContain(en('banner.scan_failed', { error: enC('errors.busy') }))
    expect(rowIds(v.container)).toHaveLength(5)
  })

  it('no extension (pending queue): "stays queued until the browser opens" strip with reconnect', async () => {
    routes['GET /status'] = () => status({ devices_online: 0, queue_pending: 1 })
    routes['GET /devices'] = () => ({ items: [{ id: 'd1', name: 'Chrome', created_at: 1, last_seen: 2, revoked_at: null, origin: null }] })
    routes['GET /queue'] = () => ({ items: [qitem('q_1', 7, 'approved')], pending: 1 })
    const v = await mount()
    const banner = q(v.container, '[data-part="banner"]')!
    expect(banner.textContent).toContain(en('banner.ext_disconnected'))
    expect(q(v.container, '[data-part="cleanup-queue"]')?.textContent).toContain(en('queue.status.approved_offline'))
  })

  it('server down (GET /status failed): warning strip, never "0 queued"', async () => {
    routes['GET /status'] = () => {
      throw apiError('internal', 'down')
    }
    const v = await mount()
    expect(q(v.container, '[data-part="banner"]')?.textContent).toContain(en('banner.server_down'))
  })

  it('plugin turned off in the profile (plugin_disabled everywhere): only the turned-off notice, no "no contact" strip', async () => {
    for (const k of Object.keys(routes)) {
      routes[k] = () => {
        throw apiError('plugin_disabled', 'plugin disabled in this profile')
      }
    }
    const v = await mount()
    expect(q(v.container, '[data-part="error"]')?.textContent).toContain(enC('errors.plugin_disabled'))
    expect(v.container.textContent).not.toContain(en('banner.server_down'))
    expect(q(v.container, '[data-part="banner"]')).toBeNull()
  })

  it('plugin missing (transport 404 everywhere): no "no contact" strip', async () => {
    sdkMock.restHandler = (rawPath) => Promise.reject(new Error(`HTTP 404: Not Found (${rawPath})`))
    const v = await mount()
    expect(q(v.container, '[data-part="error"]')?.textContent).toContain(enC('errors.plugin_disabled'))
    expect(v.container.textContent).not.toContain(en('banner.server_down'))
  })

  it('pickBanner: an unavailable plugin silences server and extension; the scan continues', () => {
    const base = { scanPhase: 'idle' as const, status: undefined, statusFailed: true, needsExtension: true, noModel: false }
    expect(pickBanner(base)).toBe('server_down')
    expect(pickBanner({ ...base, pluginUnavailable: true })).toBeNull()
    expect(pickBanner({ ...base, pluginUnavailable: true, scanPhase: 'error' })).toBe('scan_failed')
    expect(isPluginUnavailable(new TubeApiError({ code: 'plugin_disabled', message: 'off' }))).toBe(true)
    expect(isPluginUnavailable(new TubeApiError({ code: 'internal', message: 'HTTP 404: Not Found' }, true))).toBe(true)
    expect(isPluginUnavailable(new TubeApiError({ code: 'internal', message: 'Failed to fetch' }, true))).toBe(false)
    expect(isPluginUnavailable(new TubeApiError({ code: 'internal', message: 'db locked' }))).toBe(false)
    expect(isPluginUnavailable(null)).toBe(false)
  })
})

// ------------------------------------------------------------------ finishing touches (visual review)

describe('finishing touches', () => {
  const reasonOf = (el: HTMLElement | null) => q(el!, '[data-part="row-reason"]')!

  it('1 · same geometry in both lists: checkbox · avatar 28 · title + reason', async () => {
    const v = await mount()
    for (const r of [row(v.container, 1)!, q(v.container, '[data-part="ex-row"]')!]) {
      expect(r.getAttribute('data-selectable')).toBe('true')
      const cells = [...r.children] as HTMLElement[]
      expect(q(cells[1], '[data-part="avatar"]')?.style.width).toBe('28px')
      expect(cells[2].textContent).not.toBe('')
    }
    // the checkbox only exists on a candidate; on a Former subscription the cell stays empty (aligns the avatars)
    expect(q([...row(v.container, 1)!.children][0] as HTMLElement, 'input[type="checkbox"]')).not.toBeNull()
    expect(([...q(v.container, '[data-part="ex-row"]')!.children][0] as HTMLElement).textContent).toBe('')
    // the avatar is no longer on the title line
    expect(q(q(row(v.container, 1)!, '[data-part="row-title"]')!, '[data-part="avatar"]')).toBeNull()
  })

  it('2 · the reason comes first, with no final period, and only with the numbers it did not say', async () => {
    routes['GET /cleanup'] = () =>
      view({ candidates: [cand(1, 'stale', 'No new video in 391 days.'), cand(3, 'ignored', '14 videos in 90 days, none watched.'), cand(4, 'off_profile', 'Gaming streams.')] })
    const v = await mount()
    const stale = reasonOf(row(v.container, 1)).textContent!
    expect(stale).toBe(`No new video in 391 days · ${en('row.watched', { count: '2' })}`)
    const ignored = reasonOf(row(v.container, 3)).textContent!
    expect(ignored.startsWith('14 videos in 90 days, none watched · ')).toBe(true)
    expect(ignored).not.toContain(en('row.watched', { count: '0' }))
    expect(ignored).toMatch(/last video/)
    const off = reasonOf(row(v.container, 4)).textContent!
    expect(off.startsWith('Gaming streams · ')).toBe(true)
    expect(off).toMatch(/last video/)
    for (const r of [stale, ignored, off]) {
      expect(r).not.toMatch(/\.\s*·/)
      expect(r).not.toMatch(/\.$/)
    }
  })

  it('3 · the model name stays only in the top subtitle (the rule says "according to Hermes")', async () => {
    const v = await mount()
    const off = group(v.container, 'off_profile')!
    expect(off.textContent).toContain(en('groups.off_profile.rule'))
    expect(off.textContent).not.toContain('claude-haiku-5-5')
    expect(q(v.container, '[data-part="page-head"]')?.textContent).toContain(en('subtitle.by_model', { model: 'claude-haiku-5-5' }))
    expect(v.text().split('claude-haiku-5-5')).toHaveLength(2)
    for (const tree of [enCleanup, ptCleanup]) expect(pick(tree as unknown as Tree, 'groups.off_profile.rule')).not.toContain('{model}')
    expect(pick(ptCleanup as unknown as Tree, 'groups.off_profile.rule')).toBe('Longe das pastas e favoritos que você mais usa, segundo o Hermes.')
  })

  it('4 · the reason wraps to up to 3 lines (not cut with …)', async () => {
    const v = await mount()
    const reason = reasonOf(row(v.container, 4))
    expect(reason.className).toContain('srow-reason-wrap')
  })

  it('5 · a group with 0 candidates does not show (not even when the channels go to the queue)', async () => {
    const v = await mount()
    click(q(group(v.container, 'stale')!, '[data-part="group-select"]'))
    click(q(v.container, '[data-part="review"]'))
    await flush()
    click(q(v.container, '[data-part="approval-confirm"]'))
    await flush(15)
    expect(q(v.container, '[data-part="cleanup-queue"]')).not.toBeNull()
    expect(group(v.container, 'stale')).toBeNull()
    expect(v.text()).not.toContain(en('groups.stale.title'))
    expect(group(v.container, 'ignored')).not.toBeNull()
    expect(group(v.container, 'off_profile')).not.toBeNull()
  })

  it('5 · with history and a model, groups with nobody disappear', async () => {
    routes['GET /cleanup'] = () => view({ candidates: CANDIDATES.filter((c) => c.group === 'stale') })
    const v = await mount()
    expect(group(v.container, 'off_profile')).toBeNull()
    expect(group(v.container, 'ignored')).toBeNull() // with history: truly empty
    expect(group(v.container, 'stale')).not.toBeNull()
  })

  it('6 · card with many channels: "see all" lists exactly the selected ones, with inner scrolling', async () => {
    const many = Array.from({ length: 9 }, (_, i) => cand(i + 1, 'stale', `No new video in ${300 + i} days.`))
    routes['GET /cleanup'] = () => view({ candidates: many })
    const v = await mount()
    click(q(group(v.container, 'stale')!, '[data-part="group-select"]'))
    toggle(checkbox(row(v.container, 5))) // removes one: 8 selected
    click(q(v.container, '[data-part="review"]'))
    await flush()
    const card = q(v.container, '[data-part="approval"]')!
    const chosen = [1, 2, 3, 4, 6, 7, 8, 9].map(cid)
    expect(q(card, '[data-part="approval-confirm"]')?.textContent).toBe(en('approve.confirm_other', { count: '8' }))
    expect(card.textContent).toContain(en('approve.more', { count: '2' }))
    expect(q(card, '[data-part="approval-list"]')).toBeNull()
    expect(document.activeElement).toBe(q(card, '[data-part="approval-cancel"]'))
    const toggleAll = q(card, '[data-part="approval-show-all"]')!
    expect(toggleAll.textContent).toBe(en('approve.show_all', { count: '8' }))
    expect(toggleAll.getAttribute('aria-expanded')).toBe('false')
    click(toggleAll)
    const list = q(card, '[data-part="approval-list"]')!
    expect(qa(list, '[role="listitem"]').map((li) => li.getAttribute('data-channel')).sort()).toEqual(chosen.sort())
    expect(list.textContent).toContain('Channel 9')
    expect(list.textContent).not.toContain('Channel 5')
    expect(list.style.maxHeight).not.toBe('')
    expect(list.style.overflowY).toBe('auto')
    expect(q(card, '[data-part="approval-show-all"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(q(card, '[data-part="approval-show-all"]')?.textContent).toBe(en('approve.show_less'))
    // the open list does not change the button (exact number) and approves nothing
    expect(q(card, '[data-part="approval-confirm"]')?.textContent).toBe(en('approve.confirm_other', { count: '8' }))
    expect(rpcCalls('cleanup.approve')).toHaveLength(0)
    click(q(card, '[data-part="approval-show-all"]'))
    expect(q(card, '[data-part="approval-list"]')).toBeNull()
  })

  it('6 · few channels: full names, no "see all"', async () => {
    const v = await mount()
    click(q(group(v.container, 'stale')!, '[data-part="group-select"]'))
    click(q(v.container, '[data-part="review"]'))
    await flush()
    const card = q(v.container, '[data-part="approval"]')!
    expect(q(card, '[data-part="approval-show-all"]')).toBeNull()
    expect(card.textContent).toContain('Channel 1')
    expect(card.textContent).toContain('Channel 2')
  })

  it('7 · no scan: Hero and the three criteria with an icon before "Scan now"', async () => {
    routes['GET /cleanup'] = () => view({ scan: null })
    const v = await mount()
    const empty = q(v.container, '[data-part="empty"]')!
    const hero = q(empty, '[data-part="hero"]')!
    expect(hero.textContent).toContain(en('empty.never_title'))
    const items = qa(q(empty, '[data-part="cleanup-criteria"]')!, '[role="listitem"]')
    expect(items.map((i) => i.textContent)).toEqual([en('empty.criteria.stale'), en('empty.criteria.ignored'), en('empty.criteria.off_profile')])
    for (const i of items) expect(q(i, '[data-slot="codicon"]')).not.toBeNull()
    const start = qa(empty, 'button').find((b) => b.textContent === en('actions.scan_first'))!
    expect(q(empty, '[data-part="cleanup-criteria"]')!.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// ------------------------------------------------------------------ selection and approval

describe('selection', () => {
  it('one by one and by group; the bar counts and the review button describes', async () => {
    const v = await mount()
    const bar = () => q(v.container, '[data-part="selection-bar"]')!
    expect(bar().textContent).toContain(en('selection.none'))
    expect(q(bar(), '[data-part="review"]')?.hasAttribute('disabled')).toBe(true)
    toggle(checkbox(row(v.container, 3)))
    expect(bar().textContent).toContain(en('selection.count_one', { count: '1' }))
    click(q(group(v.container, 'stale')!, '[data-part="group-select"]'))
    expect(bar().textContent).toContain(en('selection.count_other', { count: '3' }))
    expect(checkbox(row(v.container, 1)).checked).toBe(true)
    expect(checkbox(row(v.container, 2)).checked).toBe(true)
    // whole group checked → the same button unchecks
    const sel = q(group(v.container, 'stale')!, '[data-part="group-select"]')!
    expect(sel.textContent).toBe(en('groups.clear'))
    click(sel)
    expect(bar().textContent).toContain(en('selection.count_one', { count: '1' }))
    expect(q(bar(), '[data-part="review"]')?.textContent).toBe(en('selection.review_one', { count: '1' }))
  })
})

describe('approval (RPC only)', () => {
  async function review(v: Awaited<ReturnType<typeof mount>>, groups = ['stale', 'ignored']) {
    for (const g of groups) click(q(group(v.container, g)!, '[data-part="group-select"]'))
    click(q(v.container, '[data-part="review"]'))
    await flush()
    return q(v.container, '[data-part="approval"]')!
  }

  it('card: describes the effect, initial focus on "Not now", Enter does not approve, Esc dismisses', async () => {
    const v = await mount()
    const card = await review(v)
    expect(card).not.toBeNull()
    const confirm = q(card, '[data-part="approval-confirm"]')!
    const cancel = q(card, '[data-part="approval-cancel"]')!
    expect(confirm.textContent).toBe(en('approve.confirm_other', { count: '3' }))
    expect(cancel.textContent).toBe(enC('kit.approval.not_now'))
    expect(cancel.textContent).not.toMatch(/cancel/i)
    expect(document.activeElement).toBe(cancel)
    expect(document.activeElement).not.toBe(confirm)
    expect(card.textContent).toContain(en('approve.effect_other', { count: '3' }))
    expect(card.textContent).toContain(en('approve.effect_resubscribe', { days: '30' }))
    // a plain Enter (on the approve button or the card) does not approve
    const ev = key(confirm, 'Enter')
    expect(ev.defaultPrevented).toBe(true)
    key(card, 'Enter')
    await flush()
    expect(rpcCalls('cleanup.approve')).toHaveLength(0)
    // Esc dismisses: the card leaves, the selection stays
    key(card, 'Escape')
    await flush()
    expect(q(v.container, '[data-part="approval"]')).toBeNull()
    expect(q(v.container, '[data-part="selection-bar"]')!.textContent).toContain(en('selection.count_other', { count: '3' }))
    expect(rpcCalls('cleanup.approve')).toHaveLength(0)
  })

  it('approving calls ONLY the cleanup.approve RPC with the right ids; the channels go to the queue (optimistic) with undo', async () => {
    const v = await mount()
    const card = await review(v)
    const before = writes().length
    click(q(card, '[data-part="approval-confirm"]'))
    // optimistic: they leave the groups at once
    expect(row(v.container, 1)).toBeNull()
    await flush(15)
    const sent = rpcCalls('cleanup.approve')
    expect(sent).toHaveLength(1)
    expect([...((sent[0].params?.channel_ids as string[]) ?? [])].sort()).toEqual([cid(1), cid(2), cid(3)].sort())
    expect(Object.keys(sent[0].params ?? {})).toEqual(['channel_ids'])
    expect(writes().length).toBe(before) // no REST write
    expect(q(v.container, '[data-part="approval"]')).toBeNull()
    expect(rowIds(v.container).sort()).toEqual([cid(4), cid(5)].sort())
    const queue = q(v.container, '[data-part="cleanup-queue"]')!
    expect(queue.textContent).toContain('Channel 1')
    expect(qa(queue, 'li[data-status="waiting"]')).toHaveLength(3)
    const n = lastNotification()
    expect(n.message).toBe(en('toast.queued_other', { count: '3' }))
    expect(n.action?.label).toBe(en('toast.undo'))
  })

  it('approval_refused: the card stays with the message, the channels come back (nothing queued)', async () => {
    rpcs['cleanup.approve'] = () => ({ ok: false, error: apiError('approval_refused', 'refused') })
    const v = await mount()
    const card = await review(v, ['stale'])
    click(q(card, '[data-part="approval-confirm"]'))
    await flush(15)
    const again = q(v.container, '[data-part="approval"]')!
    expect(again.textContent).toContain(en('approve.refused'))
    expect(rowIds(v.container)).toHaveLength(5)
    expect(q(v.container, '[data-part="cleanup-queue"]')).toBeNull()
  })

  it('no RPC on this backend: "open from Desktop" notice on the card, never falls back to REST', async () => {
    capability = false
    const v = await mount()
    const card = await review(v, ['stale'])
    click(q(card, '[data-part="approval-confirm"]'))
    await flush(15)
    expect(q(v.container, '[data-rpc-unavailable]')).not.toBeNull()
    expect(writes()).toHaveLength(0)
    expect(rowIds(v.container)).toHaveLength(5)
  })
})

// ------------------------------------------------------------------ queue and undo

describe('live queue and undo', () => {
  it('approved → in progress → done/failed with a readable reason; polls every 2 s while pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    let items = [qitem('q_1', 7, 'approved'), qitem('q_2', 8, 'running')]
    routes['GET /queue'] = () => ({ items, pending: items.filter((i) => i.status === 'approved' || i.status === 'running').length })
    const v = await mount()
    const queue = () => q(v.container, '[data-part="cleanup-queue"]')!
    expect(qa(queue(), 'li[data-status="waiting"]')).toHaveLength(1)
    expect(qa(queue(), 'li[data-status="running"]')).toHaveLength(1)
    expect(queue().textContent).toContain(en('queue.status.running'))
    const before = restTo('GET', '/queue').length
    items = [qitem('q_1', 7, 'done', { updated_at: NOW_S - 5 }), qitem('q_2', 8, 'failed', { error: 'Subscribe button not found' })]
    await advance(QUEUE_POLL_MS)
    expect(restTo('GET', '/queue').length).toBeGreaterThan(before)
    expect(qa(queue(), 'li[data-status="done"]')).toHaveLength(1)
    const failed = q(queue(), 'li[data-status="failed"]')!
    expect(failed.textContent).toContain(en('queue.status.failed', { reason: 'Subscribe button not found' }))
  })

  it('done with a "nothing was clicked" note says so in plain words; unknown notes are not shown', async () => {
    const items = [
      qitem('q_1', 1, 'done', { error: 'not_subscribed' }),
      qitem('q_2', 2, 'done', { action: 'resubscribe', error: 'already_subscribed' }),
      qitem('q_3', 3, 'done', { error: 'something_else' }),
      qitem('q_4', 4, 'done')
    ]
    routes['GET /queue'] = () => ({ items, pending: 0 })
    const v = await mount()
    const rows = qa(q(v.container, '[data-part="cleanup-queue"]')!, 'li[data-status="done"]')
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Already unsubscribed on YouTube; nothing was clicked.')
    expect(rows[0].textContent).toContain(en('queue.note.not_subscribed'))
    expect(rows[1].textContent).toContain(en('queue.note.already_subscribed'))
    for (const row of rows.slice(2)) {
      expect(row.textContent).not.toContain('nothing was clicked')
      expect(row.textContent).not.toContain('something_else')
    }
  })

  it('the "nothing was clicked" note in PT-BR', async () => {
    sdkMock.locale.set('pt-BR')
    routes['GET /queue'] = () => ({ items: [qitem('q_1', 1, 'done', { error: 'not_subscribed' })], pending: 0 })
    const v = await mount()
    const row = q(q(v.container, '[data-part="cleanup-queue"]')!, 'li[data-status="done"]')!
    expect(row.textContent).toContain(pick(ptCleanup as unknown as Tree, 'queue.note.not_subscribed'))
  })

  it('undo before running: POST /queue/undo with the id; the channel goes back to the list', async () => {
    let items = [qitem('q_1', 1, 'approved')]
    routes['GET /queue'] = () => ({ items, pending: items.length })
    routes['GET /cleanup'] = () => view({ candidates: CANDIDATES.filter((c) => items.length === 0 || c.channel_id !== cid(1)) })
    routes['POST /queue/undo'] = (req) => {
      items = []
      return { items: (req.body as { ids: string[] }).ids.map((id) => qitem(id, 1, 'undone')) }
    }
    const v = await mount()
    expect(row(v.container, 1)).toBeNull()
    click(q(v.container, '[data-part="queue-undo"]'))
    await flush(15)
    expect(restTo('POST', '/queue/undo').map((c) => c.body)).toEqual([{ ids: ['q_1'] }])
    expect(q(v.container, '[data-part="cleanup-queue"]')).toBeNull()
    expect(row(v.container, 1)).not.toBeNull()
    expect(lastNotification().message).toBe(en('toast.undone_one', { count: '1' }))
  })

  it('undo after running: undo_refused (already_executed) with the right message; the item stays', async () => {
    routes['GET /queue'] = () => ({ items: [qitem('q_1', 1, 'approved')], pending: 1 })
    routes['GET /cleanup'] = () => view({ candidates: CANDIDATES.filter((c) => c.channel_id !== cid(1)) })
    routes['POST /queue/undo'] = () => {
      throw apiError('undo_refused', 'Already executed', 'already_executed')
    }
    const v = await mount()
    click(q(v.container, '[data-part="queue-undo"]'))
    await flush(15)
    const n = lastNotification()
    expect(n.kind).toBe('error')
    expect(n.message).toBe(en('toast.undo_failed', { error: enC('already_executed') }))
    expect(q(v.container, '[data-part="cleanup-queue"]')?.textContent).toContain('Channel 1')
  })

  it('undo from the notice right after approving', async () => {
    const v = await mount()
    click(q(group(v.container, 'ignored')!, '[data-part="group-select"]'))
    click(q(v.container, '[data-part="review"]'))
    await flush()
    click(q(v.container, '[data-part="approval-confirm"]'))
    await flush(15)
    act(() => lastNotification().action!.onClick())
    await flush(15)
    expect(restTo('POST', '/queue/undo').map((c) => c.body)).toEqual([{ ids: ['q_1'] }])
    expect(row(v.container, 3)).not.toBeNull()
  })
})

describe('Keep (dismiss with undo)', () => {
  it('disappears at once; undo brings it back and nothing is saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const v = await mount()
    click(q(row(v.container, 2)!, '[data-part="row-keep"]'))
    expect(row(v.container, 2)).toBeNull()
    const n = lastNotification()
    expect(n.message).toBe(en('toast.kept', { name: 'Channel 2' }))
    act(() => n.action!.onClick())
    await flush()
    expect(row(v.container, 2)).not.toBeNull()
    await advance(UNDO_MS + 100)
    expect(restTo('POST', '/cleanup/dismiss')).toHaveLength(0)
  })

  it('without undo: saves POST /cleanup/dismiss with the candidate id after the notice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    let dismissed = false
    routes['GET /cleanup'] = () => view({ candidates: dismissed ? CANDIDATES.filter((c) => c.id !== 'cc_2') : CANDIDATES })
    routes['POST /cleanup/dismiss'] = () => {
      dismissed = true
      return { count: 1 }
    }
    const v = await mount()
    click(q(row(v.container, 2)!, '[data-part="row-keep"]'))
    await advance(UNDO_MS + 100)
    expect(restTo('POST', '/cleanup/dismiss').map((c) => c.body)).toEqual([{ ids: ['cc_2'] }])
    expect(row(v.container, 2)).toBeNull()
    expect(rpcCalls('cleanup.approve')).toHaveLength(0)
  })

  it('failure saving: the channel comes back and the notice says why', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    routes['POST /cleanup/dismiss'] = () => {
      throw apiError('invalid', 'bad')
    }
    const v = await mount()
    click(q(row(v.container, 2)!, '[data-part="row-keep"]'))
    await advance(UNDO_MS + 100)
    expect(row(v.container, 2)).not.toBeNull()
    expect(lastNotification().message).toBe(en('toast.keep_failed', { error: enC('errors.invalid') }))
  })
})

describe('Former subscriptions', () => {
  it('list with "unsubscribed X ago"; resubscribe asks for confirmation and calls ONLY the cleanup.resubscribe RPC', async () => {
    const v = await mount()
    const ex = q(v.container, `[data-part="ex-row"][data-channel="${cid(9)}"]`)!
    expect(ex.textContent).toContain('Old Channel')
    expect(ex.textContent).toMatch(/cancelled .*2 days ago/)
    click(q(ex, '[data-part="ex-resubscribe"]'))
    await flush()
    const card = q(v.container, '[data-part="approval"]')!
    expect(q(card, '[data-part="approval-confirm"]')?.textContent).toBe(en('resub.confirm', { name: 'Old Channel' }))
    expect(document.activeElement).toBe(q(card, '[data-part="approval-cancel"]'))
    const before = writes().length
    click(q(card, '[data-part="approval-confirm"]'))
    await flush(15)
    expect(rpcCalls('cleanup.resubscribe').map((r) => r.params)).toEqual([{ channel_ids: [cid(9)] }])
    expect(rpcCalls('cleanup.approve')).toHaveLength(0)
    expect(writes().length).toBe(before)
    expect(q(v.container, `[data-part="ex-row"][data-channel="${cid(9)}"]`)?.textContent).toContain(en('ex.queued'))
    expect(lastNotification().message).toBe(en('toast.resub_queued', { name: 'Old Channel' }))
  })

  it('shows the expiry only when the data comes', async () => {
    const until = NOW_S + 28 * D
    routes['GET /channels'] = (req) =>
      req.query.relation === 'ex'
        ? { items: [{ ...EX[0], expires_at: until }], total: 1 }
        : req.query.ids
          ? { items: rowsFor(req.query.ids.split(',')), total: 1 }
          : { items: [], total: 0 }
    const v = await mount()
    const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(until * 1000))
    expect(q(v.container, '[data-part="ex-row"]')?.textContent).toContain(en('ex.until', { date }))
  })

  it('no former subscriptions: explained empty state; error: error (never a false empty)', async () => {
    routes['GET /channels'] = (req) => {
      if (req.query.relation === 'ex') throw apiError('internal', 'x')
      return { items: [], total: 0 }
    }
    const v = await mount()
    const section = q(v.container, '[data-part="cleanup-ex"]')!
    expect(q(section, '[data-part="error"]')).not.toBeNull()
    expect(section.textContent).not.toContain(en('ex.empty', { days: '30' }))
  })
})

// ------------------------------------------------------------------ i18n and preview

describe('i18n', () => {
  it('EN = PT-BR keys (cleanup)', () => {
    expect(leafKeys(ptCleanup as unknown as Tree).sort()).toEqual(leafKeys(enCleanup as unknown as Tree).sort())
  })

  it('in PT-BR the screen speaks Portuguese, with the language\'s numbers and dates', async () => {
    sdkMock.locale.set('pt-BR')
    const v = await mount()
    expect(v.text()).toContain('Faxina')
    expect(v.text()).toContain(pick(ptCleanup as unknown as Tree, 'groups.stale.title'))
  })
})

describe('preview scenarios', () => {
  it('unique ids, widths 420/900/1440 and the minimum states', () => {
    const ids = scenarios.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of scenarios) expect(s.widths).toEqual([420, 900, 1440])
    for (const want of ['never', 'scanning', 'full', 'selection', 'queue', 'queue-failed', 'clean', 'ex', 'no-extension', 'error'])
      expect(ids).toContain(`cleanup-${want}`)
  })

  it.each(scenarios.map((s) => [s.id, s] as const))('%s renders with no missing route and no error', async (_id, s) => {
    const runtime = installScenario(s, PLUGIN_ID)
    try {
      const v = render(<ScenarioView scenario={s} runtime={runtime} />)
      await flush(25)
      expect(v.container.querySelector('[data-preview-crash]')).toBeNull()
      expect(runtime.missing()).toEqual([])
      v.unmount()
    } finally {
      runtime.dispose()
    }
  })
})
