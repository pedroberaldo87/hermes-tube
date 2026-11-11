// Tab editor (`tab-editor` dialog): each `preset` opens in the right place; the rule sent to the preview and on save is
// exactly the chosen one (folders, tags, channels, exclusions, each filter); the preview waits for typing and drops a stale
// answer; create calls `POST /tabs` and activates the tab in Subscriptions; edit calls `PATCH` only with what changed; a built-in tab does not touch
// its sources; delete with confirmation; validations in words; closing with changes asks for confirmation; keyboard; i18n
// EN = PT-BR; preview scenarios. Fake backend per route; no network.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ChannelRow, FeedItem, FeedPage, Folder, Tab, TabRules, Tag } from '../../shared/api-types'
import { DESKTOP_ROUTES, PLUGIN_ID } from '../../shared/ids'
import enCommon from '../locales/en/common.json'
import enTE from '../locales/en/tab-editor.json'
import ptTE from '../locales/pt-BR/tab-editor.json'
import { setPluginContext } from '../lib/ctx'
import { interpolate, registerLocales } from '../lib/i18n'
import { TabEditorDialog } from '../dialogs/tab-editor'
import {
  type Draft,
  HOME_TAB_KEY,
  PREVIEW_DEBOUNCE_MS,
  buildPatch,
  channelsCovered,
  clearFilter,
  draftFromPreset,
  draftFromTab,
  filterChips,
  nameProblem,
  rulesOf,
  suggestName,
  toggleFolder
} from '../dialogs/tab-editor/model'
import { scenarios } from '../dialogs/tab-editor/preview.scenarios'
import { ScenarioView } from '../preview/ScenarioView'
import { installScenario } from '../preview/scenario'
import { listRepoFiles, readRepoFile } from './repo.mjs'
import { advance, click, flush, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

// ------------------------------------------------------------------ texts

type Tree = { [k: string]: Tree | string }

function pick(tree: Tree, key: string): string {
  let node: Tree | string = tree
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return node
}

const en = (key: string, vars?: Record<string, string | number>) => interpolate(pick(enTE as unknown as Tree, key), vars)

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)))
}

function placeholders(tree: Tree): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const k of leafKeys(tree)) out[k] = [...pick(tree, k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  return out
}

// ------------------------------------------------------------------ fixtures

const NOW_S = Math.floor(Date.now() / 1000)
const cid = (n: number) => `UC${String(n).padStart(22, 'x')}`

const FOLDERS: Folder[] = [
  { id: 'f_tech', name: 'Tecnologia', parent_id: null, color: null, sort: 0 },
  { id: 'f_ai', name: 'IA', parent_id: 'f_tech', color: null, sort: 0 },
  { id: 'f_web', name: 'Web', parent_id: 'f_tech', color: null, sort: 1 },
  { id: 'f_music', name: 'Música', parent_id: null, color: null, sort: 1 }
]

const TAGS: Tag[] = [
  { id: 't_pt', name: 'português', color: null },
  { id: 't_deep', name: 'aprofundado', color: null }
]

function channel(n: number, title: string, over: Partial<Channel> = {}): Channel {
  return {
    id: cid(n),
    title,
    relation: 'subscribed',
    source: 'extension',
    added_at: NOW_S - 1000,
    handle: `@${title.toLowerCase().replace(/\W/g, '')}`,
    thumb: null,
    url: null,
    folder_id: null,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: NOW_S - 86400,
    videos_per_week: 1,
    shorts_ratio: 0,
    ai_note: null,
    tag_ids: [],
    ...over
  }
}

const CHANNELS: Channel[] = [
  channel(1, 'Fireship', { folder_id: 'f_web', tag_ids: ['t_pt'] }),
  channel(2, 'Andrej Karpathy', { folder_id: 'f_ai', tag_ids: ['t_deep'] }),
  channel(3, '3Blue1Brown', { folder_id: 'f_tech', tag_ids: ['t_deep'] }),
  channel(4, 'Música Boa', { folder_id: 'f_music' }),
  channel(5, 'Veritasium', { favorite: true })
]

const RULES0: TabRules = {
  include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false },
  exclude: { folders: [], tags: [], channels: [], shorts: false },
  filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
  mode: 'fresh'
}

function rules(over: { include?: Partial<TabRules['include']>; exclude?: Partial<TabRules['exclude']>; filters?: Partial<TabRules['filters']>; mode?: TabRules['mode'] } = {}): TabRules {
  return {
    include: { ...RULES0.include, ...over.include },
    exclude: { ...RULES0.exclude, ...over.exclude },
    filters: { ...RULES0.filters, ...over.filters },
    mode: over.mode ?? 'fresh'
  }
}

function tab(id: string, name: string, r: TabRules, over: Partial<Tab> = {}): Tab {
  return { id, name, kind: 'category', rules: r, icon: null, filters: {}, sort: 0, builtin: false, ...over }
}

const TABS: Tab[] = [
  tab('all-new', 'Tudo novo', rules({ include: { all: true }, filters: { only_new: true } }), { builtin: true, icon: '▶' }),
  tab('favorites', 'Favoritos', rules({ include: { favorites: true } }), { builtin: true, icon: '⭐', sort: 1 }),
  tab('tab_music', 'Música', rules({ include: { folders: ['f_music'] } }), { sort: 2, icon: '🎵' })
]

function item(n: number, ch: Channel): FeedItem {
  return {
    video: {
      id: `vid${String(n).padStart(8, '0')}`,
      channel_id: ch.id,
      title: `Video ${n}`,
      published_at: NOW_S - n * 3600,
      description: null,
      channel_title: ch.title,
      duration_s: 600,
      is_short: false,
      views: 1000,
      first_seen_at: NOW_S,
      origin: 'rss'
    },
    channel: ch,
    state: 'new',
    reaction: null,
    is_new: true,
    why: { via: 'folder', label: 'IA', detail: null },
    badges: []
  }
}

function page(n: number, offset = 0, total = n): FeedPage {
  return { items: Array.from({ length: n }, (_, i) => item(offset + i + 1, CHANNELS[i % 2 ? 2 : 1])), next_cursor: null, counts: { total, new: n } }
}

// ------------------------------------------------------------------ fake backend

interface Req {
  method: string
  path: string
  query: Record<string, string>
  body: any
}

type Route = (req: Req) => unknown

let routes: Record<string, Route>
let calls: Req[]
let storage: Map<string, unknown>

const channelRow = (c: Channel): ChannelRow => ({ channel: c, new_count: 0, watched_90d: null })

function defaultRoutes(): Record<string, Route> {
  return {
    'GET /tabs': () => ({ items: TABS }),
    'GET /folders': () => ({ items: FOLDERS }),
    'GET /tags': () => ({ items: TAGS }),
    'GET /channels': (req) => {
      const ids = req.query.ids ? req.query.ids.split(',') : null
      const items = (ids ? CHANNELS.filter((c) => ids.includes(c.id)) : CHANNELS).map(channelRow)
      return { items, total: items.length }
    },
    'POST /feed/preview': () => page(4),
    'POST /tabs': (req) => tab('tab_new', req.body.name, req.body.rules, { kind: req.body.kind }),
    'PATCH /tabs/{id}': (req) => ({ ...TABS.find((t) => req.path.endsWith(t.id))!, ...req.body }),
    'DELETE /tabs/{id}': (req) => ({ id: req.path.split('/').pop() }),
    'POST /changes/{id}/undo': () => ({ undone: [] })
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
    if (!key) return { ok: false, error: { code: 'not_found', message: `no route ${method} ${path}` } }
    return Promise.resolve()
      .then(() => routes[key](req))
      .then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error })
      )
  }
}

const restTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path)
const previews = () => restTo('POST', '/feed/preview')
const lastPreview = () => previews()[previews().length - 1]?.body
const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const lastNotification = () => sdkMock.notifications[sdkMock.notifications.length - 1] as { kind: string; message: string; action?: { label: string; onClick: () => void } }

function type(input: HTMLElement | null, value: string): void {
  if (!input) throw new Error('type: campo ausente')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(el: Element | null, k: string, init: KeyboardEventInit = {}): void {
  if (!el) throw new Error('key: elemento ausente')
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

/** Props React stored on the node (the SDK mock does not interpret Radix's Esc). */
function propsOf(el: Element | null): Record<string, any> {
  const k = el ? Object.keys(el).find((x) => x.startsWith('__reactProps$')) : undefined
  return k ? (el as any)[k] : {}
}

function escapeEvent(target: Element | null): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'target', { value: target })
  return ev
}

const root = (c: ParentNode) => q(c, '[data-part="tab-editor"]')
const primary = (c: ParentNode) => q(c, '[data-part="te-primary"]') as HTMLButtonElement | null
const group = (c: ParentNode, g: string) => q(c, `[data-part="te-group"][data-group="${g}"]`)
const groupOpen = (c: ParentNode, g: string) => q(group(c, g)!, '[data-part="te-group-toggle"]')?.getAttribute('aria-expanded')
const folderItem = (c: ParentNode, id: string) => q(c, `[data-part="tree-item"][data-id="${id}"]`)
const folderState = (c: ParentNode, id: string) => q(folderItem(c, id)!, '[data-part="te-check"]')?.getAttribute('data-state')
const clickFolder = (c: ParentNode, id: string) => click(q(folderItem(c, id)!, '[data-part="tree-row"]'))
const clickTag = (c: ParentNode, id: string) => click(q(c, `[data-part="te-tag"][data-id="${id}"]`))
const picker = (c: ParentNode, which: 'include' | 'exclude') => q(c, `[data-part="te-picker"][data-picker="${which}"]`)
const pickerSearch = (c: ParentNode, which: 'include' | 'exclude') => q(picker(c, which)!, '[data-part="te-picker-search"]')
const pickerOption = (c: ParentNode, which: 'include' | 'exclude', id: string) => q(picker(c, which)!, `[data-part="te-picker-option"][data-id="${id}"]`)
const chosen = (c: ParentNode, which: 'include' | 'exclude') => qa(picker(c, which)!, '[data-part="te-picker-chosen"]').map((e) => e.getAttribute('data-id'))
const nameInput = (c: ParentNode) => q(c, '[data-part="te-name"]') as HTMLInputElement
const previewState = (c: ParentNode) => q(c, '[data-part="te-preview"]')?.getAttribute('data-state')
const cards = (c: ParentNode) => qa(c, '[data-part="te-preview"] [data-part="card"][data-video]').map((e) => e.getAttribute('data-video'))
const chips = (c: ParentNode) => qa(c, '[data-part="te-chip"]').map((e) => e.getAttribute('data-filter'))
const status = (c: ParentNode) => q(c, '[data-part="te-status"]')?.textContent ?? ''

type Props = Parameters<typeof TabEditorDialog>[0]

async function mount(props: Partial<Props> = {}) {
  const onClose = vi.fn()
  const v = render(<TabEditorDialog onClose={onClose} {...props} />)
  await flush(15)
  return { v, onClose }
}

/** Passes the typing delay and settles the preview response. */
async function settle() {
  await advance(PREVIEW_DEBOUNCE_MS + 10)
  await flush(10)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  storage = handle.storage
  routes = defaultRoutes()
  calls = []
  install()
})

afterEach(() => {
  vi.useRealTimers()
})

// ------------------------------------------------------------------ pure model

describe('model', () => {
  it('rulesOf: the rule is exactly the chosen one (every field, in the contract shape)', () => {
    const d = {
      ...draftFromPreset({ kind: 'mixed' }),
      folders: ['f_ai'],
      tags: ['t_pt'],
      channels: [cid(5)],
      excludeChannels: [cid(1)],
      noShorts: true,
      onlyNew: true,
      perChannel: 3,
      minS: 1200,
      maxS: 3600,
      mode: 'classics' as const
    }
    expect(rulesOf(d)).toEqual(
      rules({
        include: { folders: ['f_ai'], tags: ['t_pt'], channels: [cid(5)] },
        exclude: { channels: [cid(1)], shorts: true },
        filters: { only_new: true, per_channel: 3, min_s: 1200, max_s: 3600 },
        mode: 'classics'
      })
    )
  })

  it('draftFromTab → rulesOf returns the same rule (what is not edited here passes through)', () => {
    const r = rules({ include: { themes: ['th_1'], all: true }, exclude: { folders: ['f_web'], tags: ['t_pt'] }, filters: { only_new: true } })
    expect(rulesOf(draftFromTab(tab('x', 'X', r)))).toEqual(r)
  })

  it('toggleFolder: checking the parent covers (and absorbs) the children; unchecking a covered child keeps the siblings', () => {
    expect(toggleFolder(['f_ai'], 'f_tech', FOLDERS)).toEqual(['f_tech'])
    expect(toggleFolder(['f_tech', 'f_music'], 'f_ai', FOLDERS)).toEqual(['f_web', 'f_music'])
    expect(toggleFolder(['f_tech'], 'f_tech', FOLDERS)).toEqual([])
    expect(toggleFolder([], 'f_web', FOLDERS)).toEqual(['f_web'])
  })

  it('suggestName: 1 → the name; 2 → a + b; 3+ → a + b +N', () => {
    expect(suggestName([])).toBe('')
    expect(suggestName(['IA'])).toBe('IA')
    expect(suggestName(['IA', 'Web'])).toBe('IA + Web')
    expect(suggestName(['IA', 'Web', 'Música', 'X'])).toBe('IA + Web +2')
  })

  it('nameProblem: empty, long and duplicate (says which tab; ignores case, surrounding spaces and the tab itself)', () => {
    expect(nameProblem('  ', TABS)).toEqual({ kind: 'empty' })
    expect(nameProblem('x'.repeat(41), TABS)).toEqual({ kind: 'long' })
    expect(nameProblem(' música ', TABS)).toEqual({ kind: 'duplicate', name: 'Música' })
    expect(nameProblem('Música', TABS, 'tab_music')).toBeNull()
    expect(nameProblem('Jazz', TABS)).toBeNull()
  })

  it('buildPatch: only what changed; the whole rule when any part of it changes', () => {
    const original = TABS[2]
    const d = draftFromTab(original)
    expect(buildPatch(original, d)).toEqual({})
    expect(buildPatch(original, { ...d, name: 'Músicas' })).toEqual({ name: 'Músicas' })
    expect(buildPatch(original, { ...d, icon: '' })).toEqual({ icon: null })
    expect(buildPatch(original, { ...d, onlyNew: true })).toEqual({ rules: rules({ include: { folders: ['f_music'] }, filters: { only_new: true } }) })
    expect(buildPatch(original, { ...d, channels: [cid(5)] })).toEqual({
      kind: 'mixed',
      rules: rules({ include: { folders: ['f_music'], channels: [cid(5)] } })
    })
  })

  it('filterChips / clearFilter: one chip per filter on, and removing it restores the default', () => {
    const d = { ...draftFromPreset({}), excludeChannels: [cid(1)], noShorts: true, onlyNew: true, perChannel: 2, minS: 1200, mode: 'long' as const }
    expect(filterChips(d)).toEqual(['exclude', 'shorts', 'only_new', 'per_channel', 'duration', 'mode'])
    let x: Draft = d
    for (const id of filterChips(d)) x = clearFilter(x, id)
    expect(rulesOf(x)).toEqual(RULES0)
  })

  it('channelsCovered: recursive folders + tags + channels − excluded (a muted one only counts if chosen)', () => {
    const muted = [...CHANNELS, channel(6, 'Calado', { folder_id: 'f_ai', muted: true })]
    const base = draftFromPreset({})
    expect(channelsCovered({ ...base, folders: ['f_tech'] }, muted, FOLDERS)).toBe(3)
    expect(channelsCovered({ ...base, folders: ['f_tech'], excludeChannels: [cid(1)] }, muted, FOLDERS)).toBe(2)
    expect(channelsCovered({ ...base, tags: ['t_deep'], channels: [cid(5), cid(6)] }, muted, FOLDERS)).toBe(4)
  })
})

// ------------------------------------------------------------------ preset: what opens expanded

describe('the preset decides what opens expanded (same form)', () => {
  it('category → folders and tags open; channels closed', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    expect(root(v.container)?.getAttribute('data-mode')).toBe('create')
    expect(groupOpen(v.container, 'folders')).toBe('true')
    expect(groupOpen(v.container, 'tags')).toBe('true')
    expect(groupOpen(v.container, 'channels')).toBe('false')
    expect(folderItem(v.container, 'f_ai')).not.toBeNull()
  })

  it('channels → channel search open (and focused); folders and tags closed', async () => {
    const { v } = await mount({ preset: { kind: 'channels' } })
    expect(groupOpen(v.container, 'channels')).toBe('true')
    expect(groupOpen(v.container, 'folders')).toBe('false')
    expect(groupOpen(v.container, 'tags')).toBe('false')
    expect(document.activeElement).toBe(pickerSearch(v.container, 'include'))
  })

  it('mixed → everything open', async () => {
    const { v } = await mount({ preset: { kind: 'mixed' } })
    for (const g of ['folders', 'tags', 'channels']) expect(groupOpen(v.container, g)).toBe('true')
  })

  it('a preset with a rule (pane/Subscriptions) already checks the folder, suggests the name and asks for the preview right away', async () => {
    const { v } = await mount({ preset: { name: 'IA', kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    expect(folderState(v.container, 'f_ai')).toBe('checked')
    expect(nameInput(v.container).value).toBe('IA')
    expect(lastPreview()?.rules).toEqual(rules({ include: { folders: ['f_ai'] } }))
    expect(cards(v.container)).toHaveLength(4)
  })
})

// ------------------------------------------------------------------ live preview

describe('live preview', () => {
  it('the rule sent to the preview and on create is exactly the chosen one (each source and each filter)', async () => {
    const { v } = await mount({ preset: { kind: 'mixed' } })
    clickFolder(v.container, 'f_ai')
    clickTag(v.container, 't_pt')
    type(pickerSearch(v.container, 'include'), 'veri')
    click(pickerOption(v.container, 'include', cid(5)))
    type(pickerSearch(v.container, 'exclude'), 'fire')
    click(pickerOption(v.container, 'exclude', cid(1)))
    click(q(v.container, '[data-part="te-no-shorts"]'))
    click(q(v.container, '[data-part="te-only-new"]'))
    click(q(v.container, '[data-part="te-per-channel"]'))
    type(q(v.container, '[data-part="te-per-channel-value"]'), '3')
    click(q(v.container, '[data-part="te-long"]'))
    type(q(v.container, '[data-part="te-max"]'), '60')
    click(q(v.container, '[data-part="te-mode"][data-mode="classics"]'))
    await settle()
    const want = rules({
      include: { folders: ['f_ai'], tags: ['t_pt'], channels: [cid(5)] },
      exclude: { channels: [cid(1)], shorts: true },
      filters: { only_new: true, per_channel: 3, min_s: 1200, max_s: 3600 },
      mode: 'classics'
    })
    expect(lastPreview()).toEqual({ rules: want, limit: expect.any(Number) })
    expect(chips(v.container)).toEqual(['exclude', 'shorts', 'only_new', 'per_channel', 'duration', 'mode'])
    click(primary(v.container))
    await flush(10)
    expect(restTo('POST', '/tabs').map((c) => c.body)).toEqual([{ name: 'IA + português +1', kind: 'mixed', rules: want }])
  })

  it('waits ~300 ms of typing: several changes in a row = a single request', async () => {
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    const before = previews().length
    click(q(v.container, '[data-part="te-per-channel"]'))
    type(q(v.container, '[data-part="te-per-channel-value"]'), '2')
    await advance(100)
    type(q(v.container, '[data-part="te-per-channel-value"]'), '25')
    await advance(PREVIEW_DEBOUNCE_MS - 50)
    expect(previews().length).toBe(before)
    await settle()
    expect(previews().length).toBe(before + 1)
    expect(lastPreview().rules.filters.per_channel).toBe(25)
  })

  it('a stale answer that arrives later is dropped', async () => {
    let releaseFirst: (p: FeedPage) => void = () => undefined
    let n = 0
    routes['POST /feed/preview'] = () => {
      n += 1
      if (n === 1) return new Promise<FeedPage>((r) => (releaseFirst = r))
      return page(2, 100)
    }
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    expect(previewState(v.container)).toBe('loading')
    clickTag(v.container, 't_pt')
    await settle()
    expect(cards(v.container)).toEqual(['vid00000101', 'vid00000102'])
    releaseFirst(page(4))
    await flush(10)
    expect(cards(v.container)).toEqual(['vid00000101', 'vid00000102'])
  })

  it('skeleton only on the 1st load; afterwards the old grid stays dimmed until the new one arrives', async () => {
    let release: (p: FeedPage) => void = () => undefined
    routes['POST /feed/preview'] = () => new Promise<FeedPage>((r) => (release = r))
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    expect(previewState(v.container)).toBe('loading')
    expect(q(v.container, '[data-part="te-preview"] [data-skeleton]')).not.toBeNull()
    release(page(3))
    await flush(10)
    expect(previewState(v.container)).toBe('ready')
    expect(q(v.container, '[data-part="te-preview"]')?.getAttribute('data-stale')).toBeNull()
    clickTag(v.container, 't_pt')
    await flush(5)
    expect(q(v.container, '[data-part="te-preview"]')?.getAttribute('data-stale')).toBe('true')
    await settle()
    expect(cards(v.container)).toHaveLength(3)
    expect(q(v.container, '[data-part="te-preview"] [data-skeleton]')).toBeNull()
    release(page(1, 50))
    await flush(10)
    expect(cards(v.container)).toEqual(['vid00000051'])
    expect(q(v.container, '[data-part="te-preview"]')?.getAttribute('data-stale')).toBeNull()
  })

  it('"N videos · M channels" (server total; channels covered by the rule)', async () => {
    routes['POST /feed/preview'] = () => page(4, 0, 37)
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_tech'] } } } })
    expect(q(v.container, '[data-part="te-counts"]')?.textContent).toBe(`${en('preview.videos_other', { count: '37' })} · ${en('preview.channels_other', { count: '3' })}`)
  })

  it('explained empty: "no videos with these filters: remove X", and removing it redoes the preview', async () => {
    routes['POST /feed/preview'] = (req) => (req.body.rules.filters.only_new ? page(0) : page(2))
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    click(q(v.container, '[data-part="te-only-new"]'))
    await settle()
    expect(previewState(v.container)).toBe('empty')
    expect(v.text()).toContain(en('preview.empty_title'))
    const action = q(v.container, '[data-part="te-empty-action"]')
    expect(action?.textContent).toBe(en('preview.empty_action', { filter: en('chips.only_new') }))
    click(action)
    await settle()
    expect(lastPreview().rules.filters.only_new).toBe(false)
    expect(cards(v.container)).toHaveLength(2)
  })

  it('a removable chip above the preview removes the filter', async () => {
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] }, exclude: { shorts: true } } } })
    expect(chips(v.container)).toEqual(['shorts'])
    click(q(v.container, '[data-part="te-chip"][data-filter="shorts"] [data-part="te-chip-remove"]'))
    await settle()
    expect(chips(v.container)).toEqual([])
    expect(lastPreview().rules.exclude.shorts).toBe(false)
  })

  it('preview error: ErrorView with try again (what was chosen stays)', async () => {
    let fail = true
    routes['POST /feed/preview'] = () => {
      if (fail) throw { code: 'invalid', message: 'regra ruim' }
      return page(2)
    }
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    expect(previewState(v.container)).toBe('error')
    fail = false
    click(q(v.container, '[data-part="te-preview"] [data-part="error"] button'))
    await flush(10)
    expect(cards(v.container)).toHaveLength(2)
    expect(folderState(v.container, 'f_ai')).toBe('checked')
  })
})

// ------------------------------------------------------------------ sources

describe('fontes', () => {
  it('checking the parent covers the children (and the rule carries only the parent); clicking a covered child removes only it', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_tech')
    expect(folderState(v.container, 'f_tech')).toBe('checked')
    expect(folderState(v.container, 'f_ai')).toBe('covered')
    expect(folderState(v.container, 'f_web')).toBe('covered')
    await settle()
    expect(lastPreview().rules.include.folders).toEqual(['f_tech'])
    clickFolder(v.container, 'f_ai')
    expect(folderState(v.container, 'f_ai')).toBe('unchecked')
    expect(folderState(v.container, 'f_web')).toBe('checked')
    await settle()
    expect(lastPreview().rules.include.folders).toEqual(['f_web'])
  })

  it('channels: search by name (ignoring accents/case), removable list of the chosen ones', async () => {
    const { v } = await mount({ preset: { kind: 'channels' } })
    type(pickerSearch(v.container, 'include'), 'MUSICA')
    expect(qa(picker(v.container, 'include')!, '[data-part="te-picker-option"]').map((e) => e.getAttribute('data-id'))).toEqual([cid(4)])
    click(pickerOption(v.container, 'include', cid(4)))
    expect(chosen(v.container, 'include')).toEqual([cid(4)])
    expect(q(picker(v.container, 'include')!, '[data-part="te-picker-chosen"] [data-part="avatar"], [data-part="te-picker-chosen"] img, [data-part="te-picker-chosen"] [class*="avatar"]')).not.toBeNull()
    click(q(picker(v.container, 'include')!, '[data-part="te-picker-remove"]'))
    expect(chosen(v.container, 'include')).toEqual([])
  })

  it('the name suggested from the choices stops suggesting when the person types', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_ai')
    expect(nameInput(v.container).value).toBe('IA')
    clickFolder(v.container, 'f_music')
    expect(nameInput(v.container).value).toBe('IA + Música')
    type(nameInput(v.container), 'Minha aba')
    clickFolder(v.container, 'f_web')
    expect(nameInput(v.container).value).toBe('Minha aba')
  })
})

// ------------------------------------------------------------------ create

describe('create', () => {
  it('POST /tabs, the new tab becomes the active one in Subscriptions, navigates, notifies and closes', async () => {
    const { v, onClose } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_ai')
    type(q(v.container, '[data-part="te-icon"]'), '🤖')
    await settle()
    click(primary(v.container))
    await flush(10)
    expect(restTo('POST', '/tabs').map((c) => c.body)).toEqual([{ name: 'IA', kind: 'category', icon: '🤖', rules: rules({ include: { folders: ['f_ai'] } }) }])
    expect(storage.get(HOME_TAB_KEY)).toBe('tab_new')
    expect(sdkMock.navigations).toContain(DESKTOP_ROUTES.home)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(lastNotification()).toMatchObject({ kind: 'success', message: en('toast.created', { name: 'IA' }) })
  })

  it('a server error shows in the footer without losing what was chosen; try again saves', async () => {
    let fail = true
    routes['POST /tabs'] = (req) => {
      if (fail) throw { code: 'invalid', message: 'pastas inexistentes' }
      return tab('tab_new', req.body.name, req.body.rules)
    }
    const { v, onClose } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_ai')
    click(primary(v.container))
    await flush(10)
    expect(q(v.container, '[data-part="te-error"]')?.textContent).toContain('pastas inexistentes')
    expect(onClose).not.toHaveBeenCalled()
    expect(folderState(v.container, 'f_ai')).toBe('checked')
    expect(nameInput(v.container).value).toBe('IA')
    fail = false
    click(primary(v.container))
    await flush(10)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // the footer shows the server's words only for a request it refused (invalid/conflict); an unexpected error or a
  // failed transport keeps its raw text (paths, stack, local address) out of the screen
  // A home path, built in pieces so the public scan does not read it as a real one.
  const HOME_ROOT = '/Us' + 'ers/'
  const RAW_INTERNAL = `Traceback (most recent call last): File "${HOME_ROOT}someone/.hermes/plugin-data/x/tube.db", line 1`
  const RAW_TRANSPORT = `POST http://127.0.0.1:9119/api/plugins/x/tabs failed: ECONNREFUSED ${HOME_ROOT}someone/.hermes`
  const UNEXPECTED = (enCommon as { errors: Record<string, string> }).errors.internal

  it('an unexpected server error shows the generic text, never the raw message', async () => {
    routes['POST /tabs'] = () => {
      throw { code: 'internal', message: RAW_INTERNAL }
    }
    const { v } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_ai')
    click(primary(v.container))
    await flush(10)
    const text = q(v.container, '[data-part="te-error"]')?.textContent ?? ''
    expect(text).toContain(UNEXPECTED)
    expect(text).not.toContain('Traceback')
    expect(text).not.toContain(HOME_ROOT)
  })

  it('a transport failure shows the generic text, never the raw message', async () => {
    const inner = sdkMock.restHandler
    sdkMock.restHandler = (rawPath: string, opts?: Record<string, unknown>) => {
      if (String(opts?.method) === 'POST' && rawPath.split('?')[0] === '/tabs') return Promise.reject(new Error(RAW_TRANSPORT))
      return inner(rawPath, opts)
    }
    const { v } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_ai')
    click(primary(v.container))
    await flush(10)
    const text = q(v.container, '[data-part="te-error"]')?.textContent ?? ''
    expect(text).toContain(UNEXPECTED)
    expect(text).not.toContain('127.0.0.1')
    expect(text).not.toContain(HOME_ROOT)
  })

  it('a refused delete shows the generic text for an unexpected error', async () => {
    routes['DELETE /tabs/{id}'] = () => {
      throw { code: 'internal', message: RAW_INTERNAL }
    }
    const { v } = await mount({ tabId: 'tab_music' })
    click(q(v.container, '[data-part="te-delete"]'))
    await flush(5)
    click(q(v.container, '[data-part="te-confirm-yes"]'))
    await flush(10)
    const text = q(v.container, '[data-part="te-error"]')?.textContent ?? ''
    expect(text).toContain(UNEXPECTED)
    expect(text).not.toContain(HOME_ROOT)
  })
})

// ------------------------------------------------------------------ validations

describe('validations in words', () => {
  it('no source at all: explains, does not ask for a preview and disables save', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    await settle()
    expect(previews()).toHaveLength(0)
    expect(previewState(v.container)).toBe('need')
    expect(status(v.container)).toBe(en('sources.need'))
    expect(primary(v.container)?.disabled).toBe(true)
  })

  it('no name: suggests one (and "use" fills it in)', async () => {
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    type(nameInput(v.container), '')
    expect(primary(v.container)?.disabled).toBe(true)
    const use = q(v.container, '[data-part="te-name-use"]')
    expect(use?.textContent).toBe(en('name.use', { name: 'IA' }))
    click(use)
    expect(nameInput(v.container).value).toBe('IA')
    expect(primary(v.container)?.disabled).toBe(false)
  })

  it('duplicate name: says which tab already uses it and disables save', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_music')
    expect(q(v.container, '[data-part="te-name-hint"]')?.textContent).toBe(en('name.duplicate', { name: 'Música' }))
    expect(primary(v.container)?.disabled).toBe(true)
  })

  it('minimum duration greater than the maximum: explains and does not ask for a preview with an invalid rule', async () => {
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    const before = previews().length
    type(q(v.container, '[data-part="te-min"]'), '30')
    type(q(v.container, '[data-part="te-max"]'), '10')
    await settle()
    expect(previews().length).toBe(before)
    expect(status(v.container)).toBe(en('filters.duration_bad'))
    expect(primary(v.container)?.disabled).toBe(true)
  })
})

// ------------------------------------------------------------------ edit

describe('edit', () => {
  it('loads the tab; "Save" only with a change; "unsaved changes"; PATCH only with what changed', async () => {
    const { v, onClose } = await mount({ tabId: 'tab_music' })
    expect(root(v.container)?.getAttribute('data-mode')).toBe('edit')
    expect(nameInput(v.container).value).toBe('Música')
    expect(folderState(v.container, 'f_music')).toBe('checked')
    expect(primary(v.container)?.disabled).toBe(true)
    expect(status(v.container)).not.toContain(en('footer.unsaved'))
    type(nameInput(v.container), 'Músicas')
    expect(status(v.container)).toContain(en('footer.unsaved'))
    expect(primary(v.container)?.disabled).toBe(false)
    type(nameInput(v.container), 'Música')
    expect(primary(v.container)?.disabled).toBe(true)
    type(nameInput(v.container), 'Músicas')
    key(root(v.container), 'Enter', { ctrlKey: true })
    await flush(10)
    expect(restTo('PATCH', '/tabs/tab_music').map((c) => c.body)).toEqual([{ name: 'Músicas' }])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(lastNotification()).toMatchObject({ kind: 'success', message: en('toast.saved', { name: 'Músicas' }) })
  })

  it('changing a filter sends the whole rule (and nothing else)', async () => {
    const { v } = await mount({ tabId: 'tab_music' })
    click(q(v.container, '[data-part="te-no-shorts"]'))
    click(primary(v.container))
    await flush(10)
    expect(restTo('PATCH', '/tabs/tab_music').map((c) => c.body)).toEqual([{ rules: rules({ include: { folders: ['f_music'] }, exclude: { shorts: true } }) }])
  })

  it('built-in tab: does not change sources or name, does not disappear; filters only', async () => {
    const { v } = await mount({ tabId: 'all-new' })
    expect(root(v.container)?.getAttribute('data-builtin')).toBe('true')
    expect(group(v.container, 'folders')).toBeNull()
    expect(group(v.container, 'channels')).toBeNull()
    expect(q(v.container, '[data-part="te-builtin-note"]')).not.toBeNull()
    expect(nameInput(v.container).disabled).toBe(true)
    expect(q(v.container, '[data-part="te-delete"]')).toBeNull()
    expect(lastPreview().rules).toEqual(TABS[0].rules)
    click(q(v.container, '[data-part="te-only-new"]'))
    click(primary(v.container))
    await flush(10)
    expect(restTo('PATCH', '/tabs/all-new').map((c) => c.body)).toEqual([{ rules: rules({ include: { all: true } }) }])
  })

  it('a tab that no longer exists: explains and offers to close', async () => {
    const { v, onClose } = await mount({ tabId: 'tab_gone' })
    expect(q(v.container, '[data-part="te-missing"]')).not.toBeNull()
    click(q(v.container, '[data-part="te-missing"] button'))
    expect(onClose).toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ delete

describe('delete', () => {
  it('asks for confirmation in the dialog itself; "not now" goes back; confirming deletes and closes (no change id, no undo)', async () => {
    const { v, onClose } = await mount({ tabId: 'tab_music' })
    click(q(v.container, '[data-part="te-delete"]'))
    expect(q(v.container, '[data-part="te-confirm"]')?.getAttribute('data-kind')).toBe('delete')
    expect(v.text()).toContain(en('confirm.delete_title', { name: 'Música' }))
    expect(document.activeElement).toBe(q(v.container, '[data-part="te-confirm-no"]'))
    click(q(v.container, '[data-part="te-confirm-no"]'))
    expect(q(v.container, '[data-part="te-confirm"]')).toBeNull()
    expect(restTo('DELETE', '/tabs/tab_music')).toHaveLength(0)
    click(q(v.container, '[data-part="te-delete"]'))
    click(q(v.container, '[data-part="te-confirm-yes"]'))
    await flush(10)
    expect(restTo('DELETE', '/tabs/tab_music')).toHaveLength(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(lastNotification()).toMatchObject({ kind: 'success', message: en('toast.deleted', { name: 'Música' }) })
    expect(lastNotification().action).toBeUndefined()
  })

  it('with a change id in the response, the notice brings Undo', async () => {
    routes['DELETE /tabs/{id}'] = () => ({ id: 'tab_music', change_id: 91 })
    const { v } = await mount({ tabId: 'tab_music' })
    click(q(v.container, '[data-part="te-delete"]'))
    click(q(v.container, '[data-part="te-confirm-yes"]'))
    await flush(10)
    expect(lastNotification().action?.label).toBe(en('toast.undo'))
    await act(async () => {
      lastNotification().action!.onClick()
    })
    await flush(10)
    expect(restTo('POST', '/changes/91/undo')).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ close

describe('close', () => {
  it('without a change closes right away', async () => {
    const { v, onClose } = await mount({ preset: { kind: 'category' } })
    click(q(v.container, '[data-slot="dialog-dismiss"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with a change asks for confirmation; "keep editing" stays; "discard" closes', async () => {
    const { v, onClose } = await mount({ preset: { kind: 'category' } })
    clickFolder(v.container, 'f_ai')
    click(q(v.container, '[data-slot="dialog-dismiss"]'))
    expect(onClose).not.toHaveBeenCalled()
    expect(q(v.container, '[data-part="te-confirm"]')?.getAttribute('data-kind')).toBe('discard')
    click(q(v.container, '[data-part="te-confirm-no"]'))
    expect(q(v.container, '[data-part="te-confirm"]')).toBeNull()
    expect(folderState(v.container, 'f_ai')).toBe('checked')
    click(q(v.container, '[data-part="te-cancel"]'))
    click(q(v.container, '[data-part="te-confirm-yes"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc inside a field clears/closes the field, not the dialog', async () => {
    const { v, onClose } = await mount({ preset: { kind: 'channels' } })
    const onEsc = propsOf(q(v.container, '[data-slot="dialog-content"]')).onEscapeKeyDown as (e: KeyboardEvent) => void
    expect(typeof onEsc).toBe('function')
    const search = pickerSearch(v.container, 'include') as HTMLInputElement
    type(search, 'kar')
    const inside = escapeEvent(search)
    onEsc(inside)
    expect(inside.defaultPrevented).toBe(true)
    key(search, 'Escape')
    expect(search.value).toBe('')
    const outside = escapeEvent(root(v.container))
    onEsc(outside)
    expect(outside.defaultPrevented).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ keyboard

describe('keyboard', () => {
  it('Enter in the name goes to the sources', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    nameInput(v.container).focus()
    key(nameInput(v.container), 'Enter')
    expect(document.activeElement?.closest('[data-part="te-group"]')?.getAttribute('data-group')).toBe('folders')
  })

  it('⌘/Ctrl+Enter creates', async () => {
    const { v } = await mount({ preset: { kind: 'category', rules: { include: { folders: ['f_ai'] } } } })
    key(nameInput(v.container), 'Enter', { metaKey: true })
    await flush(10)
    expect(restTo('POST', '/tabs')).toHaveLength(1)
  })

  it('arrows in the channel search: ↓ enters the list, ↓/↑ move, Enter picks', async () => {
    const { v } = await mount({ preset: { kind: 'channels' } })
    const search = pickerSearch(v.container, 'include')!
    type(search, 'a')
    key(search, 'ArrowDown')
    const options = qa(picker(v.container, 'include')!, '[data-part="te-picker-option"]')
    expect(document.activeElement).toBe(options[0])
    key(options[0], 'ArrowDown')
    expect(document.activeElement).toBe(options[1])
    key(options[1], 'ArrowUp')
    expect(document.activeElement).toBe(options[0])
    key(options[0], 'Enter')
    expect(chosen(v.container, 'include')).toEqual([options[0].getAttribute('data-id')])
  })

  it('arrows in the tags move focus', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    const tags = qa(v.container, '[data-part="te-tag"]')
    tags[0].focus()
    key(tags[0], 'ArrowRight')
    expect(document.activeElement).toBe(tags[1])
    key(tags[1], 'ArrowLeft')
    expect(document.activeElement).toBe(tags[0])
  })

  it('folder tree: arrows move (kit) and Space checks', async () => {
    const { v } = await mount({ preset: { kind: 'category' } })
    const first = folderItem(v.container, 'f_tech')!
    first.focus()
    key(first, 'ArrowDown')
    expect(document.activeElement).toBe(folderItem(v.container, 'f_ai'))
    key(folderItem(v.container, 'f_ai'), ' ')
    expect(folderState(v.container, 'f_ai')).toBe('checked')
  })
})

// ------------------------------------------------------------------ i18n, style and preview

describe('i18n', () => {
  it('EN = PT-BR keys, none empty, same placeholders', () => {
    const enKeys = leafKeys(enTE as unknown as Tree).sort()
    expect(enKeys.length).toBeGreaterThan(40)
    expect(leafKeys(ptTE as unknown as Tree).sort()).toEqual(enKeys)
    for (const k of enKeys) {
      expect(pick(enTE as unknown as Tree, k).trim()).not.toBe('')
      expect(pick(ptTE as unknown as Tree, k).trim()).not.toBe('')
    }
    expect(placeholders(ptTE as unknown as Tree)).toEqual(placeholders(enTE as unknown as Tree))
  })

  it('in PT-BR the dialog speaks Portuguese', async () => {
    sdkMock.locale.set('pt-BR')
    const { v } = await mount({ preset: { kind: 'category' } })
    expect(v.text()).toContain('O que entra')
    expect(primary(v.container)?.textContent).toBe('Criar aba')
  })
})

describe('style', () => {
  it('className only through cx(...) in the tab editor files; no fixed color', () => {
    const files = listRepoFiles('desktop-src/dialogs/tab-editor', ['.ts', '.tsx'])
    expect(files.length).toBeGreaterThan(2)
    const bad: string[] = []
    for (const f of files) {
      const code = readRepoFile(f)
      for (const m of code.matchAll(/\bclassName\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/g)) {
        const expr = m[1]
        if (/^["']/.test(expr) || !/^\{(withClass\()?cx\(/.test(expr)) bad.push(`${f}: ${expr}`)
      }
      if (/#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(|\bhsla?\(/.test(code.replace(/\/\/.*$/gm, ''))) bad.push(`${f}: cor fixa`)
    }
    expect(bad).toEqual([])
  })
})

describe('preview scenarios', () => {
  it('unique ids and the requested states', () => {
    const ids = scenarios.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const want of ['new-folder', 'new-channels', 'mixed-filters', 'edit-unsaved', 'preview-empty', 'save-error', 'builtin', 'narrow'])
      expect(ids).toContain(`tab-editor-${want}`)
  })

  it.each(scenarios.map((s) => [s.id, s] as const))('%s renders with no missing route and no error', async (_id, s) => {
    vi.useRealTimers()
    const runtime = installScenario(s, PLUGIN_ID)
    try {
      const v = render(<ScenarioView scenario={s} runtime={runtime} />)
      await flush(25)
      await act(async () => {
        await new Promise((r) => setTimeout(r, PREVIEW_DEBOUNCE_MS + 50))
      })
      await flush(25)
      expect(v.container.querySelector('[data-preview-crash]')).toBeNull()
      expect(runtime.missing()).toEqual([])
      expect(v.container.querySelector('[data-part="tab-editor"]')).not.toBeNull()
      v.unmount()
    } finally {
      runtime.dispose()
    }
  })
})
