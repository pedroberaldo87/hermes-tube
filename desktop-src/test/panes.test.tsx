// Side panel "Subscriptions": tree (All, Watch later, nested folders with a recursive counter, channels with
// avatar, "No folder"), remembered expand/collapse, select → Home, tree keyboard, context menu (mouse and
// Shift+F10), OPTIMISTIC drag and drop with undo and failure, mark as read, search, strips (extension
// disconnected, RSS down, counters failed), skeleton, empty, error (never a false "0").
// Fake backend per route (the contract envelope) over the sdk-mock's `ctx.rest`; no network.
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ChannelRow, Folder, StatusResponse, Tab, TabRules } from '../../shared/api-types'
import { DESKTOP_ROUTES, DIALOG_IDS, PLUGIN_ID } from '../../shared/ids'
import enPanes from '../locales/en/panes.json'
import ptPanes from '../locales/pt-BR/panes.json'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { interpolate, registerLocales } from '../lib/i18n'
import { currentSection } from '../lib/nav'
import { PaneView, SubscriptionsPane } from '../panes'
import { buildTree, filterTree, folderCounts, isInside, parseDrag } from '../panes/model'
import { click, flush, render } from './render'
import { listRepoFiles, readRepoFile } from './repo.mjs'
import { createMockCtx, queryClient, sdkMock } from './sdk-mock'

// The sdk-mock passes SearchField's `onClear` down to the <input> (a React warning); here it behaves like the app's.
vi.mock('@hermes/plugin-sdk', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>()
  const { createElement } = await import('react')
  type AnyProps = Record<string, unknown>
  const SearchField = ({ onChange, value, inputRef, onClear: _c, variant: _v, ...rest }: AnyProps) =>
    createElement('input', {
      'data-slot': 'search-field',
      ref: inputRef,
      value,
      onChange: (e: { target: { value: string } }) => (onChange as (v: string) => void)?.(e.target.value),
      ...rest
    })
  return { ...mod, SearchField }
})

// ------------------------------------------------------------------ fixtures

type Tree = { [k: string]: Tree | string }
const EN = enPanes as unknown as Tree

function en(key: string, vars?: Record<string, string | number>): string {
  let node: Tree | string = EN
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`key without text: ${key}`)
  return interpolate(node, vars)
}

const NOW_S = Math.floor(Date.now() / 1000)

const FOLDERS: Folder[] = [
  { id: 'f_tech', name: 'Tech', parent_id: null, color: null, sort: 0 },
  { id: 'f_ai', name: 'AI', parent_id: 'f_tech', color: null, sort: 0 },
  { id: 'f_science', name: 'Science', parent_id: null, color: null, sort: 1 }
]

function channel(id: string, title: string, folder: string | null, over: Partial<Channel> = {}): Channel {
  return {
    id,
    title,
    relation: 'subscribed',
    source: 'extension',
    added_at: NOW_S - 86400,
    handle: `@${title.toLowerCase().replace(/\W/g, '')}`,
    thumb: null,
    url: `https://www.youtube.com/@${title.toLowerCase().replace(/\W/g, '')}`,
    folder_id: folder,
    favorite: false,
    muted: false,
    unsubscribed_at: null,
    last_video_at: NOW_S,
    videos_per_week: 1,
    shorts_ratio: 0,
    ai_note: null,
    tag_ids: [],
    ...over
  }
}

const FIRESHIP = 'UCsBjURrPoezykLs9EqgamOA'
const KARPATHY = 'UCXUPKJO5MZQN11PqgIvyuvQ'
const VERITASIUM = 'UCHnyfMqiRRG1u-2MsSQLbXA'
const NEELY = 'UCnkp4xDOwqqJD7sSM3xdUiQ'

function channels(): Channel[] {
  return [
    channel(FIRESHIP, 'Fireship', 'f_tech', { favorite: true }),
    channel(KARPATHY, 'Andrej Karpathy', 'f_ai'),
    channel(VERITASIUM, 'Veritasium', 'f_science'),
    channel(NEELY, 'Adam Neely', null, { muted: true })
  ]
}

const BY_CHANNEL: Record<string, number> = { [FIRESHIP]: 2, [KARPATHY]: 3, [VERITASIUM]: 1, [NEELY]: 4 }

function rules(include: Partial<TabRules['include']>): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  }
}

const TABS: Tab[] = [
  { id: 'all-new', name: 'Tudo novo', kind: 'mixed', rules: rules({ all: true }), icon: null, filters: {}, sort: 0, builtin: true },
  { id: 'tab_science', name: 'Ciência', kind: 'category', rules: rules({ folders: ['f_science'] }), icon: null, filters: {}, sort: 2, builtin: false }
]

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 10,
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
let handle: ReturnType<typeof createMockCtx>
let world: { channels: Channel[]; folders: Folder[]; byChannel: Record<string, number> }

function rowsOf(list: Channel[]): ChannelRow[] {
  return list.map((c) => ({ channel: c, new_count: world.byChannel[c.id] ?? 0, watched_90d: null }))
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
      return new RegExp(`^${p.replace(/\{\w+\}/g, '[^/]+')}$`).test(path)
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

function defaultRoutes(): Record<string, Route> {
  return {
    'GET /folders': () => ({ items: world.folders }),
    'GET /channels': () => ({ items: rowsOf(world.channels), total: world.channels.length }),
    'GET /state': () => ({
      counts: { total: Object.values(world.byChannel).reduce((a, b) => a + b, 0), by_tab: {}, by_folder: {}, by_channel: { ...world.byChannel } },
      videos: {}
    }),
    'GET /status': () => status(),
    'GET /tabs': () => ({ items: TABS }),
    'PATCH /channels/{id}': (req) => {
      const id = req.path.split('/').pop()!
      const c = world.channels.find((x) => x.id === id)!
      Object.assign(c, req.body as Partial<Channel>)
      return c
    },
    'PATCH /folders/{id}': (req) => {
      const id = req.path.split('/').pop()!
      const f = world.folders.find((x) => x.id === id)!
      Object.assign(f, req.body as Partial<Folder>)
      return f
    },
    'POST /read': (req) => {
      const scope = req.body as { kind: string; id?: string }
      let changed = 0
      for (const c of world.channels) {
        const inScope = scope.kind === 'all' || (scope.kind === 'channel' && c.id === scope.id) || (scope.kind === 'folder' && folderOf(c, scope.id!))
        if (inScope && world.byChannel[c.id]) {
          world.byChannel[c.id] = 0
          changed++
        }
      }
      return { changed }
    },
    'GET /changes': () => ({ items: [{ id: 91, ts: Math.floor(Date.now() / 1000), actor: 'user', action: 'mark_read', payload: {}, undo: {}, group_id: null, undone_at: null }] }),
    'POST /changes/{id}/undo': () => ({ undone: [] })
  }
}

function folderOf(c: Channel, folderId: string): boolean {
  let f = c.folder_id
  while (f) {
    if (f === folderId) return true
    f = world.folders.find((x) => x.id === f)?.parent_id ?? null
  }
  return false
}

beforeEach(() => {
  world = { channels: channels(), folders: FOLDERS.map((f) => ({ ...f })), byChannel: { ...BY_CHANNEL } }
  calls = []
  routes = defaultRoutes()
  handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  install()
})

async function mount(ui = <SubscriptionsPane />) {
  const view = render(ui)
  await flush(12)
  return view
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const item = (root: ParentNode, id: string) => q(root, `[role="treeitem"][data-id="${id}"]`)
const row = (root: ParentNode, id: string) => q(root, `[role="treeitem"][data-id="${id}"] > [data-part="tree-row"]`)
const countOf = (root: ParentNode, id: string) => q(root, `[role="treeitem"][data-id="${id}"] > [data-part="tree-row"] [class$="tree-count"]`)?.textContent ?? null
const parentOf = (root: ParentNode, id: string) => item(root, id)?.parentElement?.closest('[role="treeitem"]')?.getAttribute('data-id') ?? null
const caret = (root: ParentNode, id: string) => q(root, `[role="treeitem"][data-id="${id}"] > [data-part="tree-row"] button[aria-label]`)
const menuItems = (root: ParentNode) => qa(root, '[role="menuitem"]')
const menuItem = (root: ParentNode, label: string) => menuItems(root).find((m) => (m.textContent ?? '').trim() === label) ?? null
const lastNotification = () => sdkMock.notifications[sdkMock.notifications.length - 1]
const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path)
const button = (root: ParentNode, label: string) =>
  qa(root, 'button').find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label || b.getAttribute('aria-label') === label) ?? null

function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

function contextMenu(el: Element | null): void {
  if (!el) throw new Error('contextMenu: element missing')
  act(() => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  })
}

function drop(target: Element | null, data: string): void {
  if (!target) throw new Error('drop: target missing')
  const dataTransfer = { getData: (type: string) => (type === 'text/plain' ? data : ''), setData: () => undefined, dropEffect: 'move', effectAllowed: 'move' }
  for (const type of ['dragover', 'drop']) {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    act(() => {
      target.dispatchEvent(ev)
    })
  }
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function expandAll(view: { container: HTMLElement }): void {
  for (const id of ['folder:f_tech', 'folder:f_science', 'unfiled']) if (item(view.container, id)?.getAttribute('aria-expanded') === 'false') click(caret(view.container, id))
  if (item(view.container, 'folder:f_ai')?.getAttribute('aria-expanded') === 'false') click(caret(view.container, 'folder:f_ai'))
}

// ------------------------------------------------------------------ model (pure)

describe('tree model', () => {
  it('builds nested folders, channels per folder and \"no folder\"; recursive counters', () => {
    const tree = buildTree(FOLDERS, channels())
    expect(tree.roots.map((n) => n.folder.id)).toEqual(['f_tech', 'f_science'])
    expect(tree.roots[0].children.map((n) => n.folder.id)).toEqual(['f_ai'])
    expect(tree.roots[0].channels.map((c) => c.id)).toEqual([FIRESHIP])
    expect(tree.unfiled.map((c) => c.id)).toEqual([NEELY])
    const counts = folderCounts(tree, BY_CHANNEL)
    expect(counts.get('f_tech')).toBe(5)
    expect(counts.get('f_ai')).toBe(3)
    expect(counts.get('f_science')).toBe(1)
  })

  it('a channel whose folder no longer exists goes to \"no folder\"', () => {
    const tree = buildTree(FOLDERS, [channel(FIRESHIP, 'Fireship', 'f_gone')])
    expect(tree.unfiled.map((c) => c.id)).toEqual([FIRESHIP])
  })

  it('accent- and case-insensitive search keeps the path to the channel', () => {
    const tree = buildTree(FOLDERS, channels())
    const f = filterTree(tree, 'KARPÁTHY')
    expect(f.tree.roots.map((n) => n.folder.id)).toEqual(['f_tech'])
    expect(f.tree.roots[0].channels).toEqual([])
    expect(f.tree.roots[0].children[0].channels.map((c) => c.id)).toEqual([KARPATHY])
    expect(f.matches).toBe(1)
    // a matching folder brings its content along
    const g = filterTree(tree, 'science')
    expect(g.tree.roots[0].channels.map((c) => c.id)).toEqual([VERITASIUM])
  })

  it('drag: accepts channel, folder and a raw channel id; refuses garbage', () => {
    expect(parseDrag('channel:' + FIRESHIP)).toEqual({ kind: 'channel', id: FIRESHIP })
    expect(parseDrag('folder:f_ai')).toEqual({ kind: 'folder', id: 'f_ai' })
    expect(parseDrag(FIRESHIP)).toEqual({ kind: 'channel', id: FIRESHIP })
    expect(parseDrag('https://example.com')).toBeNull()
    expect(isInside(FOLDERS, 'f_ai', 'f_tech')).toBe(true)
    expect(isInside(FOLDERS, 'f_tech', 'f_ai')).toBe(false)
  })
})

// ------------------------------------------------------------------ states

describe('panel: states', () => {
  it('loading: skeleton with the tree geometry, no number', async () => {
    routes['GET /folders'] = () => new Promise(() => undefined)
    const view = await mount()
    expect(qa(view.container, '[data-skeleton]').length).toBeGreaterThan(4)
    expect(q(view.container, '[role="tree"]')).not.toBeNull()
    expect(view.text()).not.toMatch(/\d/)
  })

  it('full: All and Watch later on top, folders with a recursive counter, channels with avatar', async () => {
    const view = await mount()
    const top = qa(view.container, '[role="tree"] > [role="treeitem"]').map((li) => li.getAttribute('data-id'))
    expect(top).toEqual(['all', 'later', 'folder:f_tech', 'folder:f_science', 'unfiled'])
    expect(countOf(view.container, 'all')).toBe('10')
    expect(countOf(view.container, 'later')).toBeNull()
    expect(countOf(view.container, 'folder:f_tech')).toBe('5')
    expect(countOf(view.container, 'unfiled')).toBe('4')
    expandAll(view)
    expect(parentOf(view.container, 'folder:f_ai')).toBe('folder:f_tech')
    expect(parentOf(view.container, `channel:${KARPATHY}`)).toBe('folder:f_ai')
    expect(countOf(view.container, `channel:${KARPATHY}`)).toBe('3')
    expect(q(view.container, `[data-id="channel:${KARPATHY}"] [data-part="avatar"]`)).not.toBeNull()
    // ⭐ and muted show
    expect(q(view.container, `[data-id="channel:${FIRESHIP}"] [data-icon="star-full"]`)).not.toBeNull()
    expect(q(view.container, `[data-id="channel:${NEELY}"] [data-icon="bell-slash"]`)).not.toBeNull()
  })

  it('no folders: channels straight at the root (no \"no folder\" group)', async () => {
    world.folders = []
    const view = await mount()
    expect(item(view.container, 'unfiled')).toBeNull()
    expect(item(view.container, `channel:${FIRESHIP}`)).not.toBeNull()
  })

  it('empty: the path forward leads to the Home welcome', async () => {
    world.folders = []
    world.channels = []
    const view = await mount()
    expect(q(view.container, '[data-part="empty"]')).not.toBeNull()
    expect(view.text()).toContain(en('empty.title'))
    click(button(view.container, en('empty.action')))
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
  })

  it('error: ErrorView with retry (never an empty tree or 0)', async () => {
    let fail = true
    routes['GET /folders'] = () => (fail ? Promise.reject({ code: 'internal', message: 'database is locked' }) : { items: world.folders })
    const view = await mount()
    expect(q(view.container, '[data-part="error"]')).not.toBeNull()
    expect(view.text()).not.toMatch(/\b0\b/)
    fail = false
    click(button(view.container, 'Try again'))
    await flush(12)
    expect(q(view.container, '[data-part="error"]')).toBeNull()
    expect(item(view.container, 'folder:f_tech')).not.toBeNull()
  })

  it('transport error 404: explains that the profile does not have the plugin', async () => {
    sdkMock.restHandler = () => Promise.reject(new Error('404: Not Found'))
    const view = await mount()
    expect(q(view.container, '[data-part="error"]')).not.toBeNull()
    expect(view.text()).toContain(en('error.unavailable', { profile: 'default' }))
    expect(view.text()).toContain(en('error.unavailable_hint', { profile: 'default' }))
  })

  it('counters failed: the tree shows WITHOUT numbers and with an error strip (not 0)', async () => {
    routes['GET /state'] = () => Promise.reject({ code: 'internal', message: 'boom' })
    const view = await mount()
    expect(item(view.container, 'folder:f_tech')).not.toBeNull()
    expect(qa(view.container, '[class$="tree-count"]')).toHaveLength(0)
    expect(q(view.container, '[data-part="banner"][data-tone="error"]')).not.toBeNull()
    expect(view.text()).toContain(en('banner.counts_failed'))
  })

  it('extension disconnected: subtle strip with Reconnect', async () => {
    routes['GET /status'] = () => status({ devices_online: 0 })
    const view = await mount()
    const banner = q(view.container, '[data-part="banner"][data-tone="info"]')
    expect(banner?.textContent).toContain(en('banner.ext_disconnected'))
    click(button(view.container, en('banner.reconnect')))
    expect($dialogStack.get().at(-1)).toMatchObject({ id: DIALOG_IDS.onboarding, props: { step: 'pair' } })
  })

  it('only followed channels (no subscription): no extension strip', async () => {
    routes['GET /status'] = () => status({ devices_online: 0 })
    world.channels = world.channels.map((c) => ({ ...c, relation: 'followed' }))
    const view = await mount()
    expect(view.text()).not.toContain(en('banner.ext_disconnected'))
  })

  it('YouTube RSS down: warning strip', async () => {
    routes['GET /status'] = () => status({ rss_down_since: NOW_S - 3600, rss_fallback_channels: 12 })
    const view = await mount()
    expect(q(view.container, '[data-part="banner"][data-tone="warning"]')?.textContent).toContain(en('banner.rss_down'))
  })

  // the panel became a tab that hides without disabling the plugin; the "closing disables the plugin" notice is gone
  it('no notice about closing the panel (no informational strip in the body when all is well)', async () => {
    const view = await mount()
    expect(q(view.container, '[data-part="pane-body"] [data-part="banner"]')).toBeNull()
    expect(view.text()).not.toMatch(/turns the plugin off|Capabilities → Plugins/)
  })
})

// ------------------------------------------------------------------ expand, select, navigate, keyboard

describe('panel: tree', () => {
  it('expand/collapse is remembered between openings', async () => {
    const view = await mount()
    expect(item(view.container, 'folder:f_tech')?.getAttribute('aria-expanded')).toBe('false')
    click(caret(view.container, 'folder:f_tech'))
    expect(item(view.container, 'folder:f_tech')?.getAttribute('aria-expanded')).toBe('true')
    expect(item(view.container, 'folder:f_ai')).not.toBeNull()
    view.unmount()
    const again = await mount()
    expect(item(again.container, 'folder:f_tech')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('Watch later → Home on the Watch later tab', async () => {
    const view = await mount()
    click(row(view.container, 'later'))
    expect(handle.storage.get('home.tab')).toBe(':later')
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
    expect(item(view.container, 'later')?.getAttribute('aria-selected')).toBe('true')
  })

  it('All → default tab \"all-new\"', async () => {
    const view = await mount()
    click(row(view.container, 'all'))
    expect(handle.storage.get('home.tab')).toBe('all-new')
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
  })

  it('folder with its own tab → Home on that tab; the request is recorded', async () => {
    const view = await mount()
    click(row(view.container, 'folder:f_science'))
    expect(handle.storage.get('home.tab')).toBe('tab_science')
    expect(handle.storage.get('pane.target')).toMatchObject({ kind: 'folder', id: 'f_science' })
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
    expect(sdkMock.notifications).toHaveLength(0)
  })

  it('folder without a tab → Home + an honest notice with \"create tab\" (editor with the folder)', async () => {
    const view = await mount()
    click(row(view.container, 'folder:f_tech'))
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
    const n = lastNotification()
    expect(n.message).toBe(en('nav.no_tab', { name: 'Tech' }))
    act(() => n.action.onClick())
    expect($dialogStack.get().at(-1)).toMatchObject({
      id: DIALOG_IDS.tabEditor,
      props: { preset: { name: 'Tech', kind: 'category', rules: { include: { folders: ['f_tech'] } } } }
    })
  })

  it('keyboard: ↓ moves, → expands, ← collapses, Enter opens, Shift+F10 opens the menu', async () => {
    const view = await mount()
    const all = item(view.container, 'all')!
    act(() => all.focus())
    key(all, 'ArrowDown')
    expect(document.activeElement).toBe(item(view.container, 'later'))
    key(document.activeElement!, 'ArrowDown')
    const tech = item(view.container, 'folder:f_tech')!
    expect(document.activeElement).toBe(tech)
    key(tech, 'ArrowRight')
    expect(tech.getAttribute('aria-expanded')).toBe('true')
    key(tech, 'ArrowLeft')
    expect(tech.getAttribute('aria-expanded')).toBe('false')
    key(item(view.container, 'later')!, 'Enter')
    expect(handle.storage.get('home.tab')).toBe(':later')
    key(tech, 'F10', { shiftKey: true })
    expect(menuItem(view.container, en('menu.mark_read'))).not.toBeNull()
    expect(menuItem(view.container, en('menu.move'))).not.toBeNull()
  })

  it('search: filters keeping the path; no result → empty with clear; ↓ goes to the tree', async () => {
    const view = await mount()
    const input = q(view.container, '[data-slot="search-field"]') as HTMLInputElement
    typeInto(input, 'karpathy')
    expect(item(view.container, `channel:${KARPATHY}`)).not.toBeNull()
    expect(item(view.container, 'folder:f_science')).toBeNull()
    expect(item(view.container, 'all')).toBeNull()
    key(input, 'ArrowDown')
    expect(document.activeElement?.getAttribute('role')).toBe('treeitem')
    typeInto(input, 'zzzz')
    expect(view.text()).toContain(en('search.empty_title', { query: 'zzzz' }))
    click(button(view.container, en('search.clear')))
    expect(item(view.container, 'all')).not.toBeNull()
    typeInto(input, 'x')
    key(input, 'Escape')
    expect(input.value).toBe('')
  })
})

// ------------------------------------------------------------------ drag and drop

describe('panel: drag and drop (optimistic + undo + failure)', () => {
  it('channel → folder: changes at once, writes, undoes', async () => {
    const pending = deferred()
    const real = routes['PATCH /channels/{id}']
    routes['PATCH /channels/{id}'] = (req) => pending.promise.then(() => real(req))
    const view = await mount()
    expandAll(view)
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_science')
    drop(row(view.container, 'folder:f_tech'), `channel:${VERITASIUM}`)
    // optimistic: before the response
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_tech')
    expect(countOf(view.container, 'folder:f_tech')).toBe('6')
    expect(callsTo('PATCH', `/channels/${VERITASIUM}`).map((c) => c.body)).toEqual([{ folder_id: 'f_tech' }])
    await act(async () => pending.resolve(undefined))
    await flush(12)
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_tech')
    const n = lastNotification()
    expect(n.message).toBe(en('toast.moved_channel', { name: 'Veritasium', folder: 'Tech' }))
    routes['PATCH /channels/{id}'] = real
    act(() => n.action.onClick())
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_science')
    await flush(12)
    expect(callsTo('PATCH', `/channels/${VERITASIUM}`).map((c) => c.body)).toEqual([{ folder_id: 'f_tech' }, { folder_id: 'f_science' }])
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_science')
  })

  it('channel → \"All\" removes it from the folder', async () => {
    const view = await mount()
    expandAll(view)
    drop(row(view.container, 'all'), `channel:${FIRESHIP}`)
    expect(parentOf(view.container, `channel:${FIRESHIP}`)).toBe('unfiled')
    await flush(12)
    expect(callsTo('PATCH', `/channels/${FIRESHIP}`)[0].body).toEqual({ folder_id: null })
  })

  it('failure: goes back in place and says why', async () => {
    routes['PATCH /channels/{id}'] = () => Promise.reject({ code: 'conflict', message: 'nope' })
    const view = await mount()
    expandAll(view)
    drop(row(view.container, 'folder:f_tech'), `channel:${VERITASIUM}`)
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_tech')
    await flush(12)
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_science')
    expect(lastNotification().kind).toBe('error')
    expect(lastNotification().action).toBeUndefined()
  })

  it('undo that fails: the change takes effect again and says so', async () => {
    const view = await mount()
    expandAll(view)
    drop(row(view.container, 'folder:f_tech'), `channel:${VERITASIUM}`)
    await flush(12)
    const n = lastNotification()
    routes['PATCH /channels/{id}'] = () => Promise.reject({ code: 'internal', message: 'x' })
    act(() => n.action.onClick())
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_science')
    await flush(12)
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_tech')
    expect(lastNotification().kind).toBe('error')
  })

  it('folder → folder (PATCH /folders) and a folder into itself is refused without a request', async () => {
    const view = await mount()
    expandAll(view)
    drop(row(view.container, 'folder:f_science'), 'folder:f_ai')
    expect(parentOf(view.container, 'folder:f_ai')).toBe('folder:f_science')
    await flush(12)
    expect(callsTo('PATCH', '/folders/f_ai').map((c) => c.body)).toEqual([{ parent_id: 'f_science' }])
    expect(lastNotification().message).toBe(en('toast.moved_folder', { name: 'AI', folder: 'Science' }))
    // cycle: Science into AI (which is now in Science)
    drop(row(view.container, 'folder:f_ai'), 'folder:f_science')
    await flush()
    expect(callsTo('PATCH', '/folders/f_science')).toHaveLength(0)
    expect(lastNotification().message).toBe(en('toast.cycle'))
  })

  it('dropping in the same place does nothing', async () => {
    const view = await mount()
    drop(row(view.container, 'folder:f_science'), `channel:${VERITASIUM}`)
    await flush()
    expect(callsTo('PATCH', `/channels/${VERITASIUM}`)).toHaveLength(0)
  })
})

// ------------------------------------------------------------------ context menu and mark as read

describe('panel: context menu', () => {
  it('channel: favorite and mute are optimistic and undoable', async () => {
    const view = await mount()
    expandAll(view)
    contextMenu(row(view.container, `channel:${VERITASIUM}`))
    click(menuItem(view.container, en('menu.favorite')))
    expect(q(view.container, `[data-id="channel:${VERITASIUM}"] [data-icon="star-full"]`)).not.toBeNull()
    await flush(12)
    expect(callsTo('PATCH', `/channels/${VERITASIUM}`)[0].body).toEqual({ favorite: true })
    act(() => lastNotification().action.onClick())
    expect(q(view.container, `[data-id="channel:${VERITASIUM}"] [data-icon="star-full"]`)).toBeNull()
    await flush(12)
    expect(callsTo('PATCH', `/channels/${VERITASIUM}`)[1].body).toEqual({ favorite: false })

    contextMenu(row(view.container, `channel:${NEELY}`))
    click(menuItem(view.container, en('menu.unmute')))
    expect(q(view.container, `[data-id="channel:${NEELY}"] [data-icon="bell-slash"]`)).toBeNull()
    await flush(12)
    expect(callsTo('PATCH', `/channels/${NEELY}`)[0].body).toEqual({ muted: false })
  })

  it('move to…: dialog with the folders; choosing moves (optimistic)', async () => {
    const view = await mount()
    expandAll(view)
    contextMenu(row(view.container, `channel:${VERITASIUM}`))
    click(menuItem(view.container, en('menu.move')))
    const dialog = q(view.container, '[role="dialog"]')!
    expect(dialog.textContent).toContain(en('move.title', { name: 'Veritasium' }))
    click(q(dialog, '[role="treeitem"][data-id="dest:f_ai"] > [data-part="tree-row"]'))
    expect(q(view.container, '[role="dialog"]')).toBeNull()
    expect(parentOf(view.container, `channel:${VERITASIUM}`)).toBe('folder:f_ai')
    await flush(12)
    expect(callsTo('PATCH', `/channels/${VERITASIUM}`)[0].body).toEqual({ folder_id: 'f_ai' })
  })

  it('the row\'s \"⋯\" opens the same menu', async () => {
    const view = await mount()
    click(q(view.container, '[data-id="folder:f_tech"] > [data-part="tree-row"] [data-part="row-menu"]'))
    expect(menuItem(view.container, en('menu.new_tab'))).not.toBeNull()
  })

  it('mark folder as read: counters vanish at once (with subfolders); undo through history', async () => {
    const view = await mount()
    expandAll(view)
    contextMenu(row(view.container, 'folder:f_tech'))
    click(menuItem(view.container, en('menu.mark_read')))
    expect(countOf(view.container, 'folder:f_tech')).toBeNull()
    expect(countOf(view.container, 'folder:f_ai')).toBeNull()
    expect(countOf(view.container, `channel:${KARPATHY}`)).toBeNull()
    expect(countOf(view.container, 'all')).toBe('5')
    await flush(12)
    expect(callsTo('POST', '/read').map((c) => c.body)).toEqual([{ kind: 'folder', id: 'f_tech' }])
    const n = lastNotification()
    expect(n.message).toBe(en('toast.read', { name: 'Tech' }))
    act(() => n.action.onClick())
    await flush(12)
    expect(callsTo('POST', '/changes/91/undo')).toHaveLength(1)
  })

  it('mark as read with nothing new: a calm notice, no undo', async () => {
    world.byChannel[VERITASIUM] = 0
    const view = await mount()
    contextMenu(row(view.container, 'folder:f_science'))
    click(menuItem(view.container, en('menu.mark_read')))
    await flush(12)
    expect(lastNotification()).toMatchObject({ kind: 'info', message: en('toast.read_nothing', { name: 'Science' }) })
    expect(lastNotification().action).toBeUndefined()
  })

  it('mark as read that fails: the counters come back', async () => {
    routes['POST /read'] = () => Promise.reject({ code: 'internal', message: 'x' })
    const view = await mount()
    contextMenu(row(view.container, 'all'))
    click(menuItem(view.container, en('menu.mark_all_read')))
    expect(countOf(view.container, 'all')).toBeNull()
    await flush(12)
    expect(countOf(view.container, 'all')).toBe('10')
    expect(lastNotification().kind).toBe('error')
  })

  it('folder: \"new tab with this folder\" opens the editor with the rule', async () => {
    const view = await mount()
    contextMenu(row(view.container, 'folder:f_science'))
    click(menuItem(view.container, en('menu.new_tab')))
    expect($dialogStack.get().at(-1)).toMatchObject({ id: DIALOG_IDS.tabEditor, props: { preset: { rules: { include: { folders: ['f_science'] } } } } })
  })

  it('channel: open on YouTube', async () => {
    const view = await mount()
    expandAll(view)
    contextMenu(row(view.container, `channel:${VERITASIUM}`))
    click(menuItem(view.container, en('menu.open_youtube')))
    await flush()
    expect(sdkMock.openedExternal).toEqual(['https://www.youtube.com/@veritasium'])
  })

  it.each([
    ['file:///Applications/Calculator.app'],
    ['javascript:alert(1)'],
    ['https://evil.example/@veritasium'],
    ['http://www.youtube.com/@veritasium'],
    ['https://www.youtube.com.evil.example/x'],
    ['https://user:pw' + '@www.youtube.com/@veritasium'],
    ['https://www.youtube.com:8443/@veritasium']
  ])('channel with a url outside YouTube (%s): opens the channel\'s canonical page, never the stored url', async (bad) => {
    world.channels = world.channels.map((c) => (c.id === VERITASIUM ? { ...c, url: bad } : c))
    const view = await mount()
    expandAll(view)
    contextMenu(row(view.container, `channel:${VERITASIUM}`))
    click(menuItem(view.container, en('menu.open_youtube')))
    await flush()
    expect(sdkMock.openedExternal).toEqual([`https://www.youtube.com/channel/${VERITASIUM}`])
  })
})

// ------------------------------------------------------------------ preview and text

describe('preview scenarios (panes/preview.scenarios.tsx)', () => {
  function useScenarioRoutes(rest: Record<string, unknown>): void {
    routes = {}
    for (const [k, v] of Object.entries(rest))
      routes[k] = (req) => (typeof v === 'function' ? (v as (r: unknown) => unknown)({ path: {}, query: req.query, body: req.body }) : v)
  }

  const EXPECT: Record<string, string> = {
    'pane-full': '[role="treeitem"][data-id^="channel:"] [data-part="avatar"]',
    'pane-nested': '[role="treeitem"][data-id^="folder:"] [role="group"] [role="treeitem"][data-id^="folder:"]',
    'pane-empty': '[data-part="empty"]',
    'pane-loading': '[data-skeleton]',
    'pane-error': '[data-part="error"]',
    'pane-no-plugin': '[data-part="error"] [data-slot="error-description"]',
    'pane-ext-disconnected': '[data-part="banner"][data-tone="info"]',
    'pane-rss-down': '[data-part="banner"][data-tone="warning"]',
    'pane-narrow': '[role="tree"]',
    'pane-search': '[data-slot="search-field"]',
    'pane-lone-zone': '[data-part="pane-head"] [data-part="pane-head-count"]'
  }

  it('each panel scenario renders the state it promises, with no raw key', async () => {
    const { scenarios } = await import('../panes/preview.scenarios')
    expect(scenarios.map((s) => s.id).sort()).toEqual(Object.keys(EXPECT).sort())
    for (const s of scenarios) {
      queryClient.clear()
      useScenarioRoutes(s.rest ?? {})
      const view = render(<>{s.render()}</>)
      await flush(12)
      expect(q(view.container, EXPECT[s.id]), s.id).not.toBeNull()
      expect(view.text(), s.id).not.toMatch(/\bpanes\.[a-z_]+/)
      view.unmount()
    }
  })

  it('chip scenarios: the 5 states (+ mascot), width 360', async () => {
    const { scenarios } = await import('../chrome/preview.scenarios')
    const states = new Set<string>()
    for (const s of scenarios) {
      expect(s.widths).toEqual([360])
      queryClient.clear()
      useScenarioRoutes(s.rest ?? {})
      const view = render(<>{s.render()}</>)
      await flush(12)
      for (const el of qa(view.container, '[data-status-chip]')) states.add(el.getAttribute('data-state') ?? '')
      expect(view.text(), s.id).not.toMatch(/\bchrome\.[a-z_]+/)
      view.unmount()
    }
    expect([...states].sort()).toEqual(['error', 'loading', 'new', 'refreshing', 'zero'])
  })
})

type Leaf = { [k: string]: Leaf | string }
function leafKeys(tree: Leaf, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)))
}

describe('panel text', () => {
  it('panes.json: same keys in EN and PT-BR, none empty', () => {
    const enKeys = leafKeys(enPanes as unknown as Leaf).sort()
    expect(enKeys.length).toBeGreaterThan(30)
    expect(leafKeys(ptPanes as unknown as Leaf).sort()).toEqual(enKeys)
    for (const tree of [enPanes, ptPanes] as unknown as Leaf[])
      for (const k of leafKeys(tree)) {
        let node: Leaf | string = tree
        for (const p of k.split('.')) node = (node as Leaf)[p]
        expect(String(node).trim(), k).not.toBe('')
      }
  })

  it("every t('…') key used in panes/ exists in panes.json", () => {
    const enKeys = new Set(leafKeys(enPanes as unknown as Leaf))
    const files = listRepoFiles('desktop-src/panes', ['.tsx', '.ts']).filter((f) => !f.endsWith('preview.scenarios.tsx'))
    const used = new Set<string>()
    for (const f of files) for (const m of readRepoFile(f).matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1])
    expect(used.size).toBeGreaterThan(25)
    expect([...used].filter((k) => !enKeys.has(k))).toEqual([])
  })

  it('in PT-BR the panel comes out in Portuguese', async () => {
    sdkMock.locale.set('pt-br')
    const view = await mount(<PaneView />)
    const pt = ptPanes as unknown as { tree: Leaf }
    expect(view.text()).toContain(pt.tree.all as string)
    expect(view.text()).toContain(pt.tree.later as string)
  })
})

// ------------------------------------------------------------------ own title when the zone has no tab strip

describe('panel\'s own header', () => {
  const head = (root: ParentNode) => q(root, '[data-part="pane-head"]')

  it('shows "Subscriptions" + the total of new videos', async () => {
    const view = await mount()
    const h = head(view.container)
    expect(h).not.toBeNull()
    expect(h?.textContent).toContain('Subscriptions')
    expect(q(h!, '[data-part="pane-head-count"]')?.textContent).toBe(countOf(view.container, 'all'))
    // typography of the app's strips: a small label (not a big title)
    expect(qa(h!, 'h1, h2, [class*="t-title"]')).toHaveLength(0)
  })

  it('has a button that opens the HermesTube page in the center, on Subscriptions', async () => {
    const view = await mount()
    const open = q(head(view.container)!, '[data-part="pane-open-page"]') as HTMLButtonElement | null
    expect(open).not.toBeNull()
    expect(open?.tagName).toBe('BUTTON')
    expect(open?.getAttribute('aria-label')).toBe('Open HermesTube')
    sdkMock.navigations.length = 0
    click(open!)
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
    expect(currentSection()).toBe('home')
  })

  it('does not depend on the app\'s markup (catalog rules; the `catalog` check step watches the bundle)', async () => {
    const view = render(
      <div data-tree-group="zone-right" data-zone-header="true">
        <SubscriptionsPane />
      </div>
    )
    await flush(12)
    expect(head(view.container)).not.toBeNull()
  })
})
