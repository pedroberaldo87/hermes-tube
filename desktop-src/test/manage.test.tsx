// Manage: channel table. Sorting, each filter and their combination, filters that survive leaving and coming back,
// selection (range, "all of the filtered", keyboard), each batch action on the right route with the right ids, undo through the
// `change_id`, inline editing (with an error that stays in the row), drag to folder, row windowing with 2000 channels,
// states (loading, zero, no result, error, extension disconnected), EN = PT-BR keys and preview scenarios.
// Fake backend per route; no network.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ChannelRow, Folder, StatusResponse, Tag } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import { currentSection, showSection } from '../lib/nav'
import enManage from '../locales/en/manage.json'
import ptManage from '../locales/pt-BR/manage.json'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { interpolate, registerLocales } from '../lib/i18n'
import { CLASS_PREFIX, CSS_TOKEN } from '../lib/style'
import { ManagePage } from '../pages/manage'
import {
  COLUMN_WIDTH,
  DEFAULT_FILTERS,
  NAME_MAX_NEED,
  ROW_H,
  applyFilters,
  dataColumns,
  fitColumns,
  folderCounts,
  gridTemplate,
  nameNeed,
  normalize,
  sortRows,
  windowRange
} from '../pages/manage/model'
import { scenarios } from '../pages/manage/preview.scenarios'
import { MANAGE_CSS } from '../pages/manage/style'
import { ScenarioView } from '../preview/ScenarioView'
import { installScenario } from '../preview/scenario'
import { click, flush, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

// ------------------------------------------------------------------ texts

type Tree = { [k: string]: Tree | string }

function pick(tree: Tree, key: string): string {
  let node: Tree | string = tree
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return node
}

const en = (key: string, vars?: Record<string, string | number>) => interpolate(pick(enManage as unknown as Tree, key), vars)

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
    last_video_at: NOW_S - 10 * D,
    videos_per_week: 1,
    shorts_ratio: 0.2,
    ai_note: null,
    tag_ids: [],
    ...over
  }
}

const FOLDERS: Folder[] = [
  { id: 'f_tech', name: 'Tech', parent_id: null, color: null, sort: 0 },
  { id: 'f_ai', name: 'AI', parent_id: 'f_tech', color: null, sort: 0 },
  { id: 'f_food', name: 'Food', parent_id: null, color: null, sort: 1 }
]

const TAGS: Tag[] = [
  { id: 't_rev', name: 'review', color: null },
  { id: 't_long', name: 'longform', color: null }
]

function baseRows(): ChannelRow[] {
  return [
    { channel: channel(1, { title: 'Alpha Tech', folder_id: 'f_tech', favorite: true, tag_ids: ['t_rev'], last_video_at: NOW_S - 2 * D, videos_per_week: 5, shorts_ratio: 0.1 }), new_count: 0, watched_90d: 4 },
    { channel: channel(2, { title: 'Beta AI', relation: 'followed', folder_id: 'f_ai', last_video_at: NOW_S - 40 * D, videos_per_week: 1, shorts_ratio: 0.5 }), new_count: 0, watched_90d: 0 },
    { channel: channel(3, { title: 'Gamma Food', folder_id: 'f_food', muted: true, tag_ids: ['t_long'], last_video_at: NOW_S - 200 * D, videos_per_week: 0.1, shorts_ratio: 0 }), new_count: 0, watched_90d: null },
    { channel: channel(4, { title: 'Delta', last_video_at: null, videos_per_week: null, shorts_ratio: null }), new_count: 0, watched_90d: 2 },
    { channel: channel(5, { title: 'Épsilon Ação', handle: '@epsilon', last_video_at: NOW_S - 400 * D, videos_per_week: 0, shorts_ratio: 0.9 }), new_count: 0, watched_90d: 1 },
    { channel: channel(6, { title: 'Zeta Ex', relation: 'ex', folder_id: 'f_tech', unsubscribed_at: NOW_S - D }), new_count: 0, watched_90d: 0 },
    { channel: channel(7, { title: 'Eta Ignored', relation: 'ignored' }), new_count: 0, watched_90d: 0 },
    { channel: channel(8, { title: 'Theta', relation: 'followed', folder_id: 'f_ai', favorite: true, last_video_at: NOW_S - 1 * D, videos_per_week: 3, shorts_ratio: 0.3 }), new_count: 0, watched_90d: 3 }
  ]
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
let rows: ChannelRow[]
let storage: Map<string, unknown>

function apiError(code: string, message = code, reason?: string) {
  return { code, message, ...(reason ? { reason } : {}) }
}

function defaultRoutes(): Record<string, Route> {
  return {
    'GET /channels': (req) => {
      const limit = Number(req.query.limit ?? 2000)
      const offset = Number(req.query.offset ?? 0)
      return { items: rows.slice(offset, offset + limit).map((r) => ({ ...r })), total: rows.length }
    },
    'GET /folders': () => ({ items: FOLDERS }),
    'GET /tags': () => ({ items: TAGS }),
    'GET /status': () => status(),
    'POST /channels/batch': (req) => {
      // the real server writes: the next GET already brings the change
      const body = req.body as { op: string; channel_ids: string[]; value?: string | null }
      for (const r of rows) {
        if (!body.channel_ids.includes(r.channel.id)) continue
        const c = (r.channel = { ...r.channel })
        if (body.op === 'move') c.folder_id = body.value ?? null
        if (body.op === 'favorite' || body.op === 'unfavorite') c.favorite = body.op === 'favorite'
        if (body.op === 'mute' || body.op === 'unmute') c.muted = body.op === 'mute'
        if (body.op === 'tag' && body.value && !c.tag_ids.includes(body.value)) c.tag_ids = [...c.tag_ids, body.value]
        if (body.op === 'untag') c.tag_ids = c.tag_ids.filter((t) => t !== body.value)
      }
      return { batch: { changed: body.channel_ids, skipped: [], change_id: 41 }, proposed: [] }
    },
    'PATCH /channels/{id}': (req) => {
      const id = req.path.split('/').pop()!
      const row = rows.find((r) => r.channel.id === id)!
      row.channel = { ...row.channel, ...(req.body as object) }
      return row.channel
    },
    'POST /changes/{id}/undo': () => ({ undone: [] }),
    'POST /read': () => ({ changed: 2, change_ids: [70] }),
    'POST /folders': (req) => ({ id: 'f_new', name: (req.body as { name: string }).name, parent_id: null, color: null, sort: 9 }),
    'PATCH /folders/{id}': (req) => ({ ...FOLDERS.find((f) => req.path.endsWith(f.id))!, ...(req.body as object) }),
    'POST /tags': (req) => ({ id: 't_new', name: (req.body as { name: string }).name, color: null })
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
}

const writes = () => calls.filter((c) => c.method !== 'GET')
const restTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path)

async function mount() {
  const v = render(<ManagePage />)
  await flush(15)
  return v
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const rowEl = (root: ParentNode, n: number) => q(root, `[data-part="manage-row"][data-channel="${cid(n)}"]`)
const rowIds = (root: ParentNode) => qa(root, '[data-part="manage-row"]').map((r) => r.getAttribute('data-channel'))
const rowNums = (root: ParentNode) => rowIds(root).map((id) => Number(String(id).replace(/^UCx*/, '')))
const selectedNums = (root: ParentNode) =>
  qa(root, '[data-part="manage-row"][aria-selected="true"]').map((r) => Number(String(r.getAttribute('data-channel')).replace(/^UCx*/, '')))
const grid = (root: ParentNode) => q(root, '[data-part="manage-table"]')!
const lastNotification = () =>
  sdkMock.notifications[sdkMock.notifications.length - 1] as { kind: string; message: string; action?: { label: string; onClick: () => void } }

function key(el: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  act(() => {
    el.dispatchEvent(ev)
  })
  return ev
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Click with modifiers (Shift/⌘) — the DOM `click()` carries no modifier. */
function clickWith(el: Element, init: MouseEventInit): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  })
}

function rowCheckbox(root: ParentNode, n: number): HTMLInputElement {
  return q(rowEl(root, n)!, '[data-col="select"] input[type="checkbox"]') as HTMLInputElement
}

/** Opens a selection filter in the bar and picks the `value` option. */
async function chooseFilter(root: ParentNode, filter: string, value: string) {
  click(q(root, `[data-part="manage-filter"][data-filter="${filter}"]`))
  const opt = q(root, `[data-part="manage-picker"] [role="option"][data-value="${value}"]`)
  click(opt)
  await flush()
}

function fakeDataTransfer() {
  const data = new Map<string, string>()
  return {
    data,
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()]
    },
    effectAllowed: 'all',
    dropEffect: 'move'
  }
}

function drag(el: Element, type: string, dt: ReturnType<typeof fakeDataTransfer>): void {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  act(() => {
    el.dispatchEvent(ev)
  })
}

beforeEach(() => {
  const handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  storage = handle.storage
  routes = defaultRoutes()
  calls = []
  rows = baseRows()
  $dialogStack.set([])
  install()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ------------------------------------------------------------------ pure model

describe('model', () => {
  const ctx = { folders: FOLDERS, nowS: NOW_S }

  it('normalize removes accents and case', () => {
    expect(normalize('Épsilon AÇÃO')).toBe('epsilon acao')
  })

  it('each filter and the combination', () => {
    const r = baseRows()
    const nums = (list: ChannelRow[]) => list.map((x) => Number(x.channel.id.replace(/^UCx*/, ''))).sort((a, b) => a - b)
    expect(nums(applyFilters(r, DEFAULT_FILTERS, ctx))).toEqual([1, 2, 3, 4, 5, 8])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, q: 'acao' }, ctx))).toEqual([5])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, q: '@eps' }, ctx))).toEqual([5])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, folder: 'f_tech' }, ctx))).toEqual([1, 2, 8]) // recursive
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, folder: 'none' }, ctx))).toEqual([4, 5])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, tag: 't_rev' }, ctx))).toEqual([1])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, relation: 'ex' }, ctx))).toEqual([6])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, relation: 'followed' }, ctx))).toEqual([2, 8])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, relation: 'ignored' }, ctx))).toEqual([7])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, favorite: true }, ctx))).toEqual([1, 8])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, muted: true }, ctx))).toEqual([3])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, staleMonths: 6 }, ctx))).toEqual([3, 5])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, staleMonths: 12 }, ctx))).toEqual([5])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, folder: 'f_tech', favorite: true }, ctx))).toEqual([1, 8])
    expect(nums(applyFilters(r, { ...DEFAULT_FILTERS, folder: 'f_tech', favorite: true, q: 'theta' }, ctx))).toEqual([8])
  })

  it('sorts with nulls always at the end', () => {
    const r = applyFilters(baseRows(), DEFAULT_FILTERS, ctx)
    const names = (list: ChannelRow[]) => list.map((x) => x.channel.title)
    const folderName = new Map(FOLDERS.map((f) => [f.id, f.name]))
    expect(names(sortRows(r, { key: 'name', dir: 'asc' }, folderName))).toEqual(['Alpha Tech', 'Beta AI', 'Delta', 'Épsilon Ação', 'Gamma Food', 'Theta'])
    expect(names(sortRows(r, { key: 'last', dir: 'desc' }, folderName))).toEqual(['Theta', 'Alpha Tech', 'Beta AI', 'Gamma Food', 'Épsilon Ação', 'Delta'])
    expect(names(sortRows(r, { key: 'last', dir: 'asc' }, folderName))).toEqual(['Épsilon Ação', 'Gamma Food', 'Beta AI', 'Alpha Tech', 'Theta', 'Delta'])
    expect(names(sortRows(r, { key: 'watched', dir: 'desc' }, folderName)).at(-1)).toBe('Gamma Food')
    expect(names(sortRows(r, { key: 'folder', dir: 'asc' }, folderName))).toEqual(['Beta AI', 'Theta', 'Gamma Food', 'Alpha Tech', 'Delta', 'Épsilon Ação'])
  })

  it('recursive folder at any depth (a grandchild counts toward the grandparent)', () => {
    const deep: Folder[] = [...FOLDERS, { id: 'f_llm', name: 'LLM', parent_id: 'f_ai', color: null, sort: 0 }]
    const r = [...baseRows(), { channel: channel(9, { title: 'Iota LLM', folder_id: 'f_llm' }), new_count: 0, watched_90d: 0 }]
    const got = applyFilters(r, { ...DEFAULT_FILTERS, folder: 'f_tech' }, { folders: deep, nowS: NOW_S }).map((x) => x.channel.title)
    expect(got).toContain('Iota LLM')
    expect(folderCounts(applyFilters(r, DEFAULT_FILTERS, { folders: deep, nowS: NOW_S }), deep).get('f_tech')).toBe(4)
  })

  it('the count per folder is recursive and counts "no folder"', () => {
    const c = folderCounts(applyFilters(baseRows(), DEFAULT_FILTERS, ctx), FOLDERS)
    expect(c.get('f_tech')).toBe(3)
    expect(c.get('f_ai')).toBe(2)
    expect(c.get('f_food')).toBe(1)
    expect(c.get('none')).toBe(2)
    expect(c.get('all')).toBe(6)
  })

  it('a column only exists if the route returns the data', () => {
    expect(dataColumns(baseRows())).toEqual(['select', 'name', 'folder', 'tags', 'last', 'rhythm', 'shorts', 'watched', 'relation'])
    const noData = baseRows().map((r) => ({ ...r, watched_90d: null, channel: { ...r.channel, shorts_ratio: null } }))
    expect(dataColumns(noData)).toEqual(['select', 'name', 'folder', 'tags', 'last', 'rhythm', 'relation'])
  })

  it('the name asks for the width of the list\'s names (p90, capped) and the secondary columns go first', () => {
    const short = baseRows()
    expect(nameNeed(short)).toBe(COLUMN_WIDTH.name)
    const long = Array.from({ length: 20 }, (_, i) => ({ ...short[0], channel: { ...short[0].channel, id: cid(100 + i), title: 'A Very Long Channel Name About Things' } }))
    const need = nameNeed(long)
    expect(need).toBeGreaterThan(COLUMN_WIDTH.name)
    expect(need).toBeLessThanOrEqual(NAME_MAX_NEED)
    const all = dataColumns(short)
    const width = 1100
    expect(fitColumns(all, width)).toContain('shorts')
    expect(fitColumns(all, width, need)).not.toContain('shorts')
    expect(gridTemplate(['select', 'name'], need)).toBe(`${COLUMN_WIDTH.select}px minmax(${need}px, 1fr)`)
  })

  it('secondary columns go before the name shrinks', () => {
    const all = dataColumns(baseRows())
    expect(fitColumns(all, 2000)).toEqual(all)
    const mid = fitColumns(all, 640)
    expect(mid).toContain('name')
    expect(mid).toContain('folder')
    expect(mid).not.toContain('shorts')
    expect(fitColumns(all, 300)).toEqual(['select', 'name'])
  })

  it('row windowing', () => {
    expect(windowRange({ scrollTop: 0, viewport: 380, bodyTop: 0, total: 2000, overscan: 5 })).toEqual({ start: 0, end: 15 })
    const w = windowRange({ scrollTop: ROW_H * 1000, viewport: 380, bodyTop: 0, total: 2000, overscan: 5 })
    expect(w.start).toBe(995)
    expect(w.end).toBe(1015)
    expect(windowRange({ scrollTop: ROW_H * 5000, viewport: 380, bodyTop: 0, total: 2000, overscan: 5 }).end).toBe(2000)
  })
})

// ------------------------------------------------------------------ table

describe('table', () => {
  it('one row per active channel, by name; N of M counter; header with the columns that have data', async () => {
    const v = await mount()
    expect(rowNums(v.container)).toEqual([1, 2, 4, 5, 3, 8])
    expect(q(v.container, '[data-part="manage-count"]')?.textContent).toBe(en('count', { shown: '6', total: '6' }))
    const heads = qa(v.container, '[role="columnheader"]').map((h) => h.getAttribute('data-col'))
    expect(heads).toEqual(['select', 'name', 'folder', 'tags', 'last', 'rhythm', 'shorts', 'watched', 'relation'])
    // numbers right-aligned with tabular figures
    const r1 = rowEl(v.container, 1)!
    expect(q(r1, '[data-col="rhythm"]')?.getAttribute('data-num')).toBe('true')
    expect(q(r1, '[data-col="shorts"]')?.textContent).toBe('10%')
    expect(q(r1, '[data-col="watched"]')?.textContent).toBe('4')
    // no data in the row = a dash, never a made-up 0
    expect(q(rowEl(v.container, 3)!, '[data-col="watched"]')?.textContent).toBe('–')
    expect(q(rowEl(v.container, 4)!, '[data-col="rhythm"]')?.textContent).toBe('–')
    // no history/create-tab button nor unsubscribe
    expect(v.text()).not.toMatch(/history|unsubscribe|create tab/i)
  })

  it('no history from any device: the "watched" column does not show', async () => {
    rows = baseRows().map((r) => ({ ...r, watched_90d: null }))
    const v = await mount()
    expect(qa(v.container, '[role="columnheader"]').map((h) => h.getAttribute('data-col'))).not.toContain('watched')
    expect(q(rowEl(v.container, 1)!, '[data-col="watched"]')).toBeNull()
  })

  it('sorts by the header (aria-sort) and remembers the order', async () => {
    const v = await mount()
    const head = (c: string) => q(v.container, `[role="columnheader"][data-col="${c}"]`)!
    click(q(head('last'), 'button'))
    expect(head('last').getAttribute('aria-sort')).toBe('descending')
    expect(rowNums(v.container)).toEqual([8, 1, 2, 3, 5, 4])
    click(q(head('last'), 'button'))
    expect(head('last').getAttribute('aria-sort')).toBe('ascending')
    expect(rowNums(v.container)).toEqual([5, 3, 2, 1, 8, 4])
    expect(head('name').getAttribute('aria-sort')).toBe('none')
    v.unmount()
    const again = await mount()
    expect(rowNums(again.container)).toEqual([5, 3, 2, 1, 8, 4])
  })

  it('2000 channels: only the window becomes DOM; scrolling swaps the window', async () => {
    rows = Array.from({ length: 2000 }, (_, i) => ({ channel: channel(i + 1, { title: `Channel ${String(i + 1).padStart(4, '0')}` }), new_count: 0, watched_90d: 1 }))
    const t0 = performance.now()
    const v = await mount()
    const ms = performance.now() - t0
    const g = grid(v.container)
    expect(g.getAttribute('aria-rowcount')).toBe('2001')
    const domRows = qa(v.container, '[data-part="manage-row"]')
    expect(domRows.length).toBeGreaterThan(10)
    expect(domRows.length).toBeLessThan(80)
    expect(q(v.container, '[data-part="manage-count"]')?.textContent).toBe(en('count', { shown: '2,000', total: '2,000' }))
    // the total height is reserved (honest scrolling)
    expect(q(v.container, '[data-part="manage-spacer-bottom"]')?.style.height).toBe(`${(2000 - domRows.length) * ROW_H}px`)
    expect(ms).toBeLessThan(3000)
    // asks for everything in one call (limit 2000)
    expect(restTo('GET', '/channels')[0].query.limit).toBe('2000')
    // scrolling the page body swaps the window (jsdom has no layout: simulated geometry)
    const scroller = q(v.container, '[data-part="page-body"]')!
    const body = domRows[0].parentElement!
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this === body ? 40 - scroller.scrollTop : 0
      return { top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true })
    Object.defineProperty(scroller, 'scrollHeight', { value: 40 + 2001 * ROW_H, configurable: true })
    scroller.scrollTop = 40 + ROW_H * 1000
    act(() => {
      scroller.dispatchEvent(new Event('scroll'))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40))
    })
    const after = qa(v.container, '[data-part="manage-row"]')
    const first = Number(after[0].getAttribute('aria-rowindex'))
    expect(first).toBeGreaterThanOrEqual(1000 - 10 + 2)
    expect(first).toBeLessThanOrEqual(1000 + 2)
    expect(after.length).toBeLessThan(80)
    expect(q(v.container, '[data-part="manage-spacer-top"]')?.style.height).toBe(`${(first - 2) * ROW_H}px`)
    vi.restoreAllMocks()
  })

  it('more than 2000: fetches the following pages by offset', async () => {
    rows = Array.from({ length: 2300 }, (_, i) => ({ channel: channel(i + 1), new_count: 0, watched_90d: 1 }))
    const v = await mount()
    expect(restTo('GET', '/channels').map((c) => c.query.offset ?? '0')).toEqual(['0', '2000'])
    expect(grid(v.container).getAttribute('aria-rowcount')).toBe('2301')
  })
})

// ------------------------------------------------------------------ filters

describe('filters', () => {
  it('search by name and handle, ignoring accents', async () => {
    const v = await mount()
    const input = q(v.container, '[data-part="filterbar"] input') as HTMLInputElement
    typeInto(input, 'acao')
    await flush()
    expect(rowNums(v.container)).toEqual([5])
    expect(q(v.container, '[data-part="manage-count"]')?.textContent).toBe(en('count', { shown: '1', total: '6' }))
  })

  it('folder through the list on the left (with a count, recursive) and "no folder"', async () => {
    const v = await mount()
    const rail = q(v.container, '[data-part="manage-rail"]')!
    expect(q(rail, '[data-folder="f_tech"] [data-part="rail-count"]')?.textContent).toBe('3')
    expect(q(rail, '[data-folder="none"] [data-part="rail-count"]')?.textContent).toBe('2')
    click(q(rail, '[data-folder="f_tech"] [data-part="rail-select"]'))
    await flush()
    expect(rowNums(v.container)).toEqual([1, 2, 8])
    expect(q(rail, '[data-folder="f_tech"]')?.getAttribute('aria-current')).toBe('true')
    click(q(rail, '[data-folder="none"] [data-part="rail-select"]'))
    await flush()
    expect(rowNums(v.container)).toEqual([4, 5])
  })

  it('tag, relation, ⭐, muted and "no video for N months"; removable chips; clear', async () => {
    const v = await mount()
    await chooseFilter(v.container, 'tag', 't_rev')
    expect(rowNums(v.container)).toEqual([1])
    await chooseFilter(v.container, 'tag', '')
    await chooseFilter(v.container, 'relation', 'ex')
    expect(rowNums(v.container)).toEqual([6])
    await chooseFilter(v.container, 'relation', 'active')
    click(q(v.container, '[data-part="manage-filter"][data-filter="favorite"]'))
    await flush()
    expect(q(v.container, '[data-part="manage-filter"][data-filter="favorite"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(rowNums(v.container)).toEqual([1, 8])
    click(q(v.container, '[data-part="manage-filter"][data-filter="favorite"]'))
    click(q(v.container, '[data-part="manage-filter"][data-filter="muted"]'))
    await flush()
    expect(rowNums(v.container)).toEqual([3])
    click(q(v.container, '[data-part="manage-filter"][data-filter="muted"]'))
    await chooseFilter(v.container, 'stale', '6')
    expect(rowNums(v.container)).toEqual([5, 3])
    // combination: no video for 6 months + Food folder
    click(q(v.container, '[data-part="manage-rail"] [data-folder="f_food"] [data-part="rail-select"]'))
    await flush()
    expect(rowNums(v.container)).toEqual([3])
    const chips = qa(v.container, '[data-part="manage-chip"]').map((c) => c.getAttribute('data-filter'))
    expect(chips).toEqual(['folder', 'stale'])
    // remover um chip
    click(q(v.container, '[data-part="manage-chip"][data-filter="folder"] [data-part="chip-remove"]'))
    await flush()
    expect(rowNums(v.container)).toEqual([5, 3])
    // clear all
    click(q(v.container, '[data-part="filter-clear"]'))
    await flush()
    expect(rowNums(v.container)).toEqual([1, 2, 4, 5, 3, 8])
    expect(qa(v.container, '[data-part="manage-chip"]')).toEqual([])
  })

  it('the filter state survives leaving and coming back', async () => {
    const v = await mount()
    click(q(v.container, '[data-part="manage-filter"][data-filter="favorite"]'))
    typeInto(q(v.container, '[data-part="filterbar"] input') as HTMLInputElement, 'the')
    await flush()
    expect(rowNums(v.container)).toEqual([8])
    v.unmount()
    expect(storage.get('manage.view')).toBeTruthy()
    const again = await mount()
    expect(rowNums(again.container)).toEqual([8])
    expect((q(again.container, '[data-part="filterbar"] input') as HTMLInputElement).value).toBe('the')
  })

  it('filter with no result: empty with "clear filters"', async () => {
    const v = await mount()
    typeInto(q(v.container, '[data-part="filterbar"] input') as HTMLInputElement, 'nada disso')
    await flush()
    expect(q(v.container, '[data-part="manage-no-results"]')).not.toBeNull()
    click(q(v.container, '[data-part="manage-no-results"] button'))
    await flush()
    expect(rowNums(v.container)).toHaveLength(6)
  })

  it('narrow (< 700 px): the folder list becomes a selector in the bar', async () => {
    class NarrowRO {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe(el: Element) {
        this.cb([{ target: el, contentRect: { width: 480, height: 600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NarrowRO)
    const v = await mount()
    expect(q(v.container, '[data-part="manage-rail"]')).toBeNull()
    await chooseFilter(v.container, 'folder', 'none')
    expect(rowNums(v.container)).toEqual([4, 5])
    // secondary columns left; the name stayed
    const heads = qa(v.container, '[role="columnheader"]').map((h) => h.getAttribute('data-col'))
    expect(heads).toContain('name')
    expect(heads).not.toContain('shorts')
  })
})

// ------------------------------------------------------------------ selection

describe('selection', () => {
  it('a checkbox per row and Shift+click for a range (in the shown order)', async () => {
    const v = await mount()
    clickWith(rowCheckbox(v.container, 1), {})
    expect(selectedNums(v.container)).toEqual([1])
    clickWith(rowCheckbox(v.container, 5), { shiftKey: true })
    expect(selectedNums(v.container)).toEqual([1, 2, 4, 5])
    expect(q(v.container, '[data-part="manage-batch"]')?.textContent).toContain(en('batch.selected_other', { count: '4' }))
  })

  it('the header checkbox selects only the filtered rows and says how many', async () => {
    const v = await mount()
    click(q(v.container, '[data-part="manage-filter"][data-filter="favorite"]'))
    await flush()
    const all = q(v.container, '[data-part="manage-select-all"]') as HTMLInputElement
    expect(all.getAttribute('aria-label')).toBe(en('select_all', { count: '2' }))
    clickWith(all, {})
    expect(selectedNums(v.container)).toEqual([1, 8])
    // removing the filter, only the two stay selected
    click(q(v.container, '[data-part="manage-filter"][data-filter="favorite"]'))
    await flush()
    expect(selectedNums(v.container)).toEqual([1, 8])
    clickWith(q(v.container, '[data-part="manage-select-all"]')!, {})
    expect(selectedNums(v.container)).toHaveLength(6)
    clickWith(q(v.container, '[data-part="manage-select-all"]')!, {})
    expect(selectedNums(v.container)).toEqual([])
  })

  it('keyboard: arrows, space, Shift+arrow, ⌘/Ctrl+A with focus on the table, Esc clears', async () => {
    const v = await mount()
    const g = grid(v.container)
    act(() => g.focus())
    key(g, 'ArrowDown')
    expect(g.getAttribute('aria-activedescendant')).toBe(rowEl(v.container, 1)!.id)
    key(g, ' ')
    expect(selectedNums(v.container)).toEqual([1])
    key(g, 'ArrowDown', { shiftKey: true })
    key(g, 'ArrowDown', { shiftKey: true })
    expect(selectedNums(v.container)).toEqual([1, 2, 4])
    key(g, 'End')
    expect(g.getAttribute('aria-activedescendant')).toBe(rowEl(v.container, 8)!.id)
    const ev = key(g, 'a', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(selectedNums(v.container)).toHaveLength(6)
    key(g, 'Escape')
    expect(selectedNums(v.container)).toEqual([])
    key(g, 'a', { metaKey: true })
    expect(selectedNums(v.container)).toHaveLength(6)
  })
})

// ------------------------------------------------------------------ batch

describe('lote', () => {
  async function withSelection(nums: number[]) {
    const v = await mount()
    for (const n of nums) clickWith(rowCheckbox(v.container, n), { metaKey: true })
    expect(selectedNums(v.container).sort()).toEqual([...nums].sort())
    return v
  }

  function batchBody(i = -1) {
    const list = restTo('POST', '/channels/batch')
    return list.at(i)?.body as { op: string; channel_ids: string[]; value?: string | null }
  }

  async function batchPick(root: ParentNode, action: string, value: string) {
    click(q(root, `[data-part="manage-batch"] [data-action="${action}"]`))
    click(q(root, `[data-part="manage-picker"] [role="option"][data-value="${value}"]`))
    await flush()
  }

  it('move to folder: right route, right ids, notice with Undo through the change_id, selection kept', async () => {
    const v = await withSelection([4, 5])
    await batchPick(v.container, 'move', 'f_food')
    expect(batchBody()).toEqual({ op: 'move', channel_ids: [cid(4), cid(5)], value: 'f_food' })
    const n = lastNotification()
    expect(n.message).toBe(en('toast.move_other', { count: '2', folder: 'Food' }))
    expect(selectedNums(v.container)).toEqual([4, 5])
    act(() => n.action!.onClick())
    await flush()
    expect(restTo('POST', '/changes/41/undo')).toHaveLength(1)
  })

  it('moving to "no folder" sends value null', async () => {
    const v = await withSelection([1])
    await batchPick(v.container, 'move', '')
    expect(batchBody()).toEqual({ op: 'move', channel_ids: [cid(1)], value: null })
  })

  it('"new folder…": creates it (POST /folders) and moves to it', async () => {
    const v = await withSelection([2, 4])
    click(q(v.container, '[data-part="manage-batch"] [data-action="move"]'))
    typeInto(q(v.container, '[data-part="manage-picker"] [data-part="picker-input"]') as HTMLInputElement, 'Novidades')
    click(q(v.container, '[data-part="manage-picker"] [data-part="picker-create"]'))
    await flush()
    expect(restTo('POST', '/folders')[0].body).toEqual({ name: 'Novidades' })
    expect(batchBody()).toEqual({ op: 'move', channel_ids: [cid(2), cid(4)], value: 'f_new' })
  })

  it('add and remove a tag', async () => {
    const v = await withSelection([2, 3])
    await batchPick(v.container, 'tag', 't_rev')
    expect(batchBody()).toEqual({ op: 'tag', channel_ids: [cid(2), cid(3)], value: 't_rev' })
    expect(lastNotification().message).toBe(en('toast.tag_other', { count: '2', tag: 'review' }))
    await batchPick(v.container, 'untag', 't_long')
    expect(batchBody()).toEqual({ op: 'untag', channel_ids: [cid(2), cid(3)], value: 't_long' })
  })

  it('⭐, mute and unmute', async () => {
    const v = await withSelection([2, 4])
    click(q(v.container, '[data-part="manage-batch"] [data-action="favorite"]'))
    await flush()
    expect(batchBody()).toEqual({ op: 'favorite', channel_ids: [cid(2), cid(4)] })
    click(q(v.container, '[data-part="manage-batch"] [data-action="unfavorite"]'))
    await flush()
    expect(batchBody().op).toBe('unfavorite')
    click(q(v.container, '[data-part="manage-batch"] [data-action="mute"]'))
    await flush()
    expect(batchBody()).toEqual({ op: 'mute', channel_ids: [cid(2), cid(4)] })
    expect(lastNotification().message).toBe(en('toast.mute_other', { count: '2' }))
    click(q(v.container, '[data-part="manage-batch"] [data-action="unmute"]'))
    await flush()
    expect(batchBody().op).toBe('unmute')
    expect(selectedNums(v.container)).toEqual([2, 4])
  })

  it('applies on screen before the response; a failure reverts and notifies', async () => {
    let release!: () => void
    routes['POST /channels/batch'] = () =>
      new Promise((_res, rej) => {
        release = () => rej(apiError('conflict', 'nope'))
      })
    const v = await withSelection([4])
    click(q(v.container, '[data-part="manage-batch"] [data-action="favorite"]'))
    await flush()
    expect(q(rowEl(v.container, 4)!, '[data-part="manage-fav"]')?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => release())
    await flush()
    expect(q(rowEl(v.container, 4)!, '[data-part="manage-fav"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(lastNotification().kind).toBe('error')
  })

  it('nothing changed (change_id null): notice without Undo', async () => {
    routes['POST /channels/batch'] = (req) => ({ batch: { changed: [], skipped: (req.body as { channel_ids: string[] }).channel_ids, change_id: null }, proposed: [] })
    const v = await withSelection([1])
    click(q(v.container, '[data-part="manage-batch"] [data-action="favorite"]'))
    await flush()
    expect(lastNotification().action).toBeUndefined()
    expect(lastNotification().message).toBe(en('toast.nothing'))
  })

  it('a refused undo notifies', async () => {
    routes['POST /changes/{id}/undo'] = () => {
      throw apiError('undo_refused', 'no', 'already_undone')
    }
    const v = await withSelection([1])
    click(q(v.container, '[data-part="manage-batch"] [data-action="mute"]'))
    await flush()
    act(() => lastNotification().action!.onClick())
    await flush()
    expect(lastNotification().kind).toBe('error')
  })

  it('mark as read: POST /read per channel (change_ids) and undo by id', async () => {
    let n = 0
    routes['POST /read'] = () => ({ changed: 1, change_ids: [100 + ++n] })
    const v = await withSelection([1, 2])
    click(q(v.container, '[data-part="manage-batch"] [data-action="read"]'))
    await flush(10)
    const reads = restTo('POST', '/read')
    expect(reads.map((r) => r.body)).toEqual([
      { kind: 'channel', id: cid(1) },
      { kind: 'channel', id: cid(2) }
    ])
    expect(reads.every((r) => r.query.change_ids === 'true')).toBe(true)
    act(() => lastNotification().action!.onClick())
    await flush(10)
    expect(calls.filter((c) => /\/changes\/\d+\/undo/.test(c.path)).map((c) => c.path).sort()).toEqual(['/changes/101/undo', '/changes/102/undo'])
  })

  it('"Organize with Hermes" opens the dialog with the ids', async () => {
    const v = await withSelection([3, 5])
    click(q(v.container, '[data-part="manage-batch"] [data-action="organize"]'))
    const top = $dialogStack.get().at(-1)
    expect(top?.id).toBe('organize')
    expect(top?.props).toEqual({ channelIds: [cid(3), cid(5)] })
    expect(writes()).toEqual([])
  })
})

// ------------------------------------------------------------------ inline editing

describe('inline editing', () => {
  it('folder: opens in place, typing filters, Enter confirms (PATCH)', async () => {
    const v = await mount()
    click(q(rowEl(v.container, 4)!, '[data-part="manage-folder-edit"]'))
    const picker = q(rowEl(v.container, 4)!, '[data-part="manage-picker"]')!
    expect(picker).not.toBeNull()
    const input = q(picker, '[data-part="picker-input"]') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    typeInto(input, 'foo')
    expect(qa(picker, '[role="option"]').map((o) => o.getAttribute('data-value'))).toEqual(['f_food'])
    key(input, 'Enter')
    await flush()
    expect(restTo('PATCH', `/channels/${cid(4)}`)[0].body).toEqual({ folder_id: 'f_food' })
    expect(q(rowEl(v.container, 4)!, '[data-part="manage-picker"]')).toBeNull()
    expect(q(rowEl(v.container, 4)!, '[data-col="folder"]')?.textContent).toContain('Food')
    // undo = inverse PATCH
    act(() => lastNotification().action!.onClick())
    await flush()
    expect(restTo('PATCH', `/channels/${cid(4)}`)[1].body).toEqual({ folder_id: null })
  })

  it('Esc cancels without calling anything', async () => {
    const v = await mount()
    click(q(rowEl(v.container, 1)!, '[data-part="manage-folder-edit"]'))
    key(q(v.container, '[data-part="picker-input"]')!, 'Escape')
    expect(q(v.container, '[data-part="manage-picker"]')).toBeNull()
    expect(writes()).toEqual([])
  })

  it('tags: check/uncheck and Enter saves the list', async () => {
    const v = await mount()
    click(q(rowEl(v.container, 1)!, '[data-part="manage-tags-edit"]'))
    const picker = q(rowEl(v.container, 1)!, '[data-part="manage-picker"]')!
    click(q(picker, '[role="option"][data-value="t_long"]'))
    expect(q(picker, '[role="option"][data-value="t_long"]')?.getAttribute('aria-selected')).toBe('true')
    key(q(picker, '[data-part="picker-input"]')!, 'Enter')
    await flush()
    expect(restTo('PATCH', `/channels/${cid(1)}`)[0].body).toEqual({ tag_ids: ['t_rev', 't_long'] })
  })

  it('⭐ with one click', async () => {
    const v = await mount()
    click(q(rowEl(v.container, 2)!, '[data-part="manage-fav"]'))
    await flush()
    expect(restTo('PATCH', `/channels/${cid(2)}`)[0].body).toEqual({ favorite: true })
  })

  it('an error on one row shows in the row and does not bring the table down', async () => {
    routes['PATCH /channels/{id}'] = () => {
      throw apiError('conflict', 'busy row')
    }
    const v = await mount()
    click(q(rowEl(v.container, 2)!, '[data-part="manage-fav"]'))
    await flush()
    expect(q(rowEl(v.container, 2)!, '[data-part="manage-row-error"]')).not.toBeNull()
    expect(q(rowEl(v.container, 2)!, '[data-part="manage-fav"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(rowNums(v.container)).toHaveLength(6)
    expect(q(rowEl(v.container, 1)!, '[data-part="manage-row-error"]')).toBeNull()
  })
})

// ------------------------------------------------------------------ drag

describe('drag to folder', () => {
  it('the dragged row goes to the folder (batch) and carries `channel:<id>` for the pane', async () => {
    const v = await mount()
    const dt = fakeDataTransfer()
    drag(rowEl(v.container, 4)!, 'dragstart', dt)
    expect(dt.getData('text/plain')).toBe(`channel:${cid(4)}`)
    const target = q(v.container, '[data-part="manage-rail"] [data-folder="f_food"]')!
    drag(target, 'dragover', dt)
    expect(target.getAttribute('data-drop')).toBe('true')
    drag(target, 'drop', dt)
    await flush()
    expect(restTo('POST', '/channels/batch')[0].body).toEqual({ op: 'move', channel_ids: [cid(4)], value: 'f_food' })
  })

  it('dragging a selected row carries the whole selection', async () => {
    const v = await mount()
    clickWith(rowCheckbox(v.container, 4), {})
    clickWith(rowCheckbox(v.container, 5), { metaKey: true })
    const dt = fakeDataTransfer()
    drag(rowEl(v.container, 5)!, 'dragstart', dt)
    drag(q(v.container, '[data-part="manage-rail"] [data-folder="none"]')!, 'drop', dt)
    await flush()
    expect(restTo('POST', '/channels/batch')[0].body).toEqual({ op: 'move', channel_ids: [cid(4), cid(5)], value: null })
  })

  it('create and rename a folder in place', async () => {
    const v = await mount()
    click(q(v.container, '[data-part="rail-new"]'))
    const input = q(v.container, '[data-part="rail-input"]') as HTMLInputElement
    typeInto(input, 'Music')
    key(input, 'Enter')
    await flush()
    expect(restTo('POST', '/folders')[0].body).toEqual({ name: 'Music' })
    click(q(v.container, '[data-part="manage-rail"] [data-folder="f_food"] [data-part="rail-rename"]'))
    const ren = q(v.container, '[data-part="manage-rail"] [data-folder="f_food"] [data-part="rail-input"]') as HTMLInputElement
    expect(ren.value).toBe('Food')
    typeInto(ren, 'Cooking')
    key(ren, 'Enter')
    await flush()
    expect(restTo('PATCH', '/folders/f_food')[0].body).toEqual({ name: 'Cooking' })
  })
})

// ------------------------------------------------------------------ states

describe('estados', () => {
  it('loading: skeleton with the table geometry', async () => {
    routes['GET /channels'] = () => new Promise(() => undefined)
    const v = render(<ManagePage />)
    await flush()
    expect(q(v.container, '[data-part="manage-table"][aria-busy="true"]')).not.toBeNull()
    expect(qa(v.container, '[data-part="manage-row"][data-skeleton]').length).toBeGreaterThan(5)
    expect(qa(v.container, '[role="columnheader"]').length).toBeGreaterThan(3)
  })

  it('zero channels: leads to Welcome', async () => {
    rows = []
    const v = await mount()
    const empty = q(v.container, '[data-part="empty"]')!
    expect(empty).not.toBeNull()
    showSection('manage')
    click(q(empty, 'button'))
    // the single page switches to Subscriptions (no other route)
    expect(currentSection()).toBe('home')
    expect(sdkMock.navigations).toEqual([])
  })

  it('error with "try again"', async () => {
    let fail = true
    const ok = routes['GET /channels']
    routes['GET /channels'] = (req) => {
      if (fail) throw apiError('internal', 'boom')
      return ok(req)
    }
    const v = await mount()
    expect(q(v.container, '[data-part="error"]')).not.toBeNull()
    fail = false
    click(q(v.container, '[data-part="error"] button'))
    await flush(10)
    expect(rowNums(v.container)).toHaveLength(6)
  })

  it('extension disconnected: kit strip with "Reconnect"', async () => {
    routes['GET /status'] = () => status({ devices_online: 0 })
    routes['GET /devices'] = () => ({ items: [{ id: 'd1', name: 'Chrome', created_at: 1, last_seen: 2, revoked_at: null, origin: null }] })
    const v = await mount()
    const banner = q(v.container, '[data-part="page-banner"]')!
    expect(banner.textContent).toContain(en('banner.ext_disconnected'))
    click(q(banner, 'button'))
    expect($dialogStack.get().at(-1)?.id).toBe('onboarding')
  })

  it('only followed (none subscribed): no extension strip', async () => {
    routes['GET /status'] = () => status({ devices_online: 0 })
    rows = baseRows().filter((r) => r.channel.relation === 'followed')
    const v = await mount()
    expect(q(v.container, '[data-part="page-banner"]')).toBeNull()
  })
})

// ------------------------------------------------------------------ text, style and preview

describe('text and style', () => {
  it('EN = PT-BR keys, none empty', () => {
    const a = leafKeys(enManage as unknown as Tree).sort()
    const b = leafKeys(ptManage as unknown as Tree).sort()
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(30)
    for (const k of b) expect(pick(ptManage as unknown as Tree, k).trim()).not.toBe('')
  })

  it('screen in PT-BR', async () => {
    sdkMock.locale.set('pt-BR')
    const v = await mount()
    expect(q(v.container, '[data-part="manage-count"]')?.textContent).toBe(interpolate(pick(ptManage as unknown as Tree, 'count'), { shown: '6', total: '6' }))
  })

  it('page CSS: only the plugin prefix, only theme variables, container and reduced motion', () => {
    expect(MANAGE_CSS).toContain(CSS_TOKEN)
    const classes = [...MANAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1])
    expect(classes.filter((c) => !c.startsWith(CSS_TOKEN))).toEqual([])
    expect(MANAGE_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|@import|url\(/)
    const vars = new Set([...MANAGE_CSS.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))
    expect([...vars].filter((v) => !/^--(ui-|dt-|theme-|PFX_)/.test(v))).toEqual([])
    expect(MANAGE_CSS).toMatch(/@container\s/)
    expect(MANAGE_CSS).not.toMatch(/@media[^{]*(min|max)-width/)
    expect(MANAGE_CSS).toMatch(/prefers-reduced-motion/)
  })

  it('the page stylesheet is mounted once and leaves on unmount', async () => {
    const sel = `style[data-${CLASS_PREFIX}manage]`
    const a = await mount()
    const b = await mount()
    expect(document.head.querySelectorAll(sel)).toHaveLength(1)
    a.unmount()
    expect(document.head.querySelectorAll(sel)).toHaveLength(1)
    b.unmount()
    expect(document.head.querySelectorAll(sel)).toHaveLength(0)
  })
})

describe('preview scenarios', () => {
  it('unique ids and the requested ones', () => {
    const ids = scenarios.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const want of ['full', 'selection', 'filters', 'edit-folder', 'empty', 'no-results', 'error', 'loading', 'narrow'])
      expect(ids).toContain(`manage-${want}`)
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
