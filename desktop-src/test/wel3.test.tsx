// Pairing step 2 ("Reading your subscriptions") must finish when the extension delivers a read even if
// the channel total does not grow (re-pairing a browser whose channels are already in the library).
// The backend exposes the instant of the last read in `GET /status` (`ext_last_sync_at`); an older
// backend without the field keeps the "total grew" rule and the "slow" notice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, StatusResponse } from '../../shared/api-types'
import { PLUGIN_ID, RPC_CAPABILITY, STATUS_POLL_MS, rpcMethod } from '../../shared/ids'
import { PairPanel } from '../dialogs/onboarding/pair'
import { AUTO_CLOSE_S, LIVE_POLL_MS, SYNC_PATIENCE_MS } from '../dialogs/onboarding/model'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { $windowVisible } from '../lib/status'
import enJson from '../locales/en/onboarding.json'
import { advance, flush, render } from './render'
import { createMockCtx, rpcError, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }
const EN = enJson as unknown as Tree

function L(key: string, vars: Record<string, string | number> = {}): string {
  let node: Tree | string | undefined = EN
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
  if (typeof node !== 'string') throw new Error(`missing key in en/onboarding.json: ${key}`)
  return node.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m))
}

const NOW_S = 1_762_700_000
const NOW_MS = NOW_S * 1000
const CODE = '482913'

function device(id: string, name: string, extra: Partial<Device> = {}): Device {
  return { id, name, created_at: NOW_S + 5, last_seen: NOW_S + 5, revoked_at: null, origin: null, ...extra }
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

type Route = () => unknown

/** `ctx.rest` answers GET routes by path (value = the envelope's `data`). */
function backend(routes: Record<string, Route>) {
  sdkMock.restHandler = (path, opts) => {
    const method = String(opts?.method ?? 'GET').toUpperCase()
    const route = routes[`${method} ${path.split('?')[0]}`]
    if (!route) return { ok: false, error: { code: 'not_found', message: `no route ${method} ${path}` } }
    return Promise.resolve().then(() => ({ ok: true, data: route() }))
  }
  sdkMock.requestHandler = (method) => {
    if (method === 'runtime.describe') return { capabilities: [RPC_CAPABILITY] }
    if (method === rpcMethod('pair.start')) {
      return { ok: true, data: { code: CODE, expires_at: Math.floor(Date.now() / 1000) + 300, port: 47615 } }
    }
    throw rpcError(-32601, `unknown method ${method}`)
  }
}

/** A library that already has `total` channels, one old device and (optionally) an old read. */
function world(opts: { total: number; lastSync?: number | null }) {
  const old = device('dev_old', 'Chrome — Mac (old)', { created_at: NOW_S - 9000, last_seen: NOW_S - 9000 })
  const w = {
    items: [old] as Device[],
    total: opts.total,
    st: status('lastSync' in opts ? { ext_last_sync_at: opts.lastSync } : {})
  }
  backend({
    'GET /devices': () => ({ items: w.items }),
    'GET /channels': () => ({ items: [], total: w.total }),
    'GET /status': () => w.st
  })
  return { w, old }
}

let onFinish: ReturnType<typeof vi.fn<() => void>>

vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
  const h = createMockCtx(PLUGIN_ID)
  setPluginContext(h.ctx)
  registerLocales(h.ctx)
  onFinish = vi.fn<() => void>()
  $windowVisible.set(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function pairedAndSyncing(w: { items: Device[] }, old: Device) {
  const view = render(<PairPanel onFinish={onFinish} onDirty={() => undefined} />)
  await flush(10)
  const phase = () => view.container.querySelector('[data-part="pair"]')?.getAttribute('data-phase')
  expect(phase()).toBe('waiting')
  await advance(STATUS_POLL_MS) // the status baseline is known before the browser pairs
  w.items = [old, device('dev_new', 'Chrome — Mac', { created_at: NOW_S + 10, last_seen: NOW_S + 10 })]
  vi.setSystemTime(NOW_MS + 12_000)
  await advance(LIVE_POLL_MS)
  expect(phase()).toBe('syncing')
  return { view, phase }
}

describe('pairing: step 2 finishes on a delivered read', () => {
  it('re-pairing with the same total finishes once a new read instant arrives', async () => {
    const { w, old } = world({ total: 871, lastSync: NOW_S - 3600 })
    const { view, phase } = await pairedAndSyncing(w, old)

    // the old read (before the code) does not count; the total is unchanged
    await advance(STATUS_POLL_MS * 2)
    expect(phase()).toBe('syncing')

    // the extension delivers the whole list again: 0 new channels, a newer instant
    w.st = { ...w.st, ext_last_sync_at: NOW_S + 20 }
    await advance(STATUS_POLL_MS)
    expect(phase()).toBe('done')
    expect(view.text()).toContain(L('pair.done_title'))
    expect(view.text()).toContain(L('plural.channels_other', { count: '871' }))
    const steps = [...view.container.querySelectorAll('[data-part="steps"] li')].map((s) => s.getAttribute('data-status'))
    expect(steps).toEqual(['done', 'done', 'done'])
    await advance(AUTO_CLOSE_S * 1000)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('first read ever (null before) also finishes when the instant arrives', async () => {
    const { w, old } = world({ total: 871, lastSync: null })
    const { view, phase } = await pairedAndSyncing(w, old)
    await advance(STATUS_POLL_MS)
    expect(phase()).toBe('syncing')
    w.st = { ...w.st, ext_last_sync_at: NOW_S + 20 }
    await advance(STATUS_POLL_MS)
    expect(phase()).toBe('done')
    expect(view.text()).toContain(L('plural.channels_other', { count: '871' }))
  })

  it('the final count is the current total, not a stale one', async () => {
    const { w, old } = world({ total: 871, lastSync: NOW_S - 3600 })
    const { view, phase } = await pairedAndSyncing(w, old)
    // a read that removed one channel (marked ex) and finished
    w.total = 870
    w.st = { ...w.st, ext_last_sync_at: NOW_S + 20 }
    await advance(STATUS_POLL_MS)
    expect(phase()).toBe('done')
    expect(view.text()).toContain(L('plural.channels_other', { count: '870' }))
  })

  it('a growing total still finishes (no read instant needed)', async () => {
    const { w, old } = world({ total: 0, lastSync: null })
    const { view, phase } = await pairedAndSyncing(w, old)
    await advance(LIVE_POLL_MS)
    expect(phase()).toBe('syncing')
    expect(view.text()).not.toContain(L('plural.channels_other', { count: 0 }))
    w.total = 212
    await advance(LIVE_POLL_MS)
    expect(phase()).toBe('done')
    expect(view.text()).toContain(L('plural.channels_other', { count: 212 }))
  })

  it('older backend without the field: same total keeps waiting and shows the slow notice', async () => {
    const { w, old } = world({ total: 871 })
    const { view, phase } = await pairedAndSyncing(w, old)
    await advance(STATUS_POLL_MS * 2)
    expect(phase()).toBe('syncing')
    expect(view.text()).not.toContain(L('pair.slow'))
    await advance(SYNC_PATIENCE_MS)
    expect(phase()).toBe('syncing')
    expect(view.text()).toContain(L('pair.slow'))
    // and the total growing still finishes, as before
    w.total = 872
    await advance(LIVE_POLL_MS)
    expect(phase()).toBe('done')
  })
})
