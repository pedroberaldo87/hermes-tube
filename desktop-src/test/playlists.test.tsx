// Local playlists on the Desktop: the "Add to playlist" picker (card, Watch), the Playlists tab of
// Subscriptions (list, open, Play all → the Watch queue, remove, rename, delete) and the texts in EN and PT-BR.
// Fake backend per route (the contract envelope) over the sdk-mock's `ctx.rest`; no network.
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FeedItem, Playlist, StatusResponse, Tab, TabRules } from '../../shared/api-types'
import { PLUGIN_ID } from '../../shared/ids'
import { PlaylistPicker } from '../components/PlaylistPicker'
import enCommon from '../locales/en/common.json'
import enHome from '../locales/en/home.json'
import enWatch from '../locales/en/watch.json'
import ptCommon from '../locales/pt-BR/common.json'
import ptHome from '../locales/pt-BR/home.json'
import ptWatch from '../locales/pt-BR/watch.json'
import { setPluginContext } from '../lib/ctx'
import { interpolate, registerLocales } from '../lib/i18n'
import { $watch, setWatchRenderer } from '../lib/player'
import { getQueue, setQueue } from '../lib/queue'
import { $playlistPick, closePlaylistPicker, openPlaylistPicker, playAll } from '../lib/video-actions'
import { HomeView, PLAYLISTS_TAB } from '../pages/home'
import { WatchPage } from '../pages/watch'
import { click, flush, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

type Tree = { [k: string]: Tree | string }

function textOf(tree: unknown, key: string, vars?: Record<string, string | number>): string {
  let node = tree as Tree | string
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return interpolate(node, vars)
}
const common = (key: string, vars?: Record<string, string | number>) => textOf(enCommon, key, vars)
const home = (key: string, vars?: Record<string, string | number>) => textOf(enHome, key, vars)

const NOW_S = Math.floor(Date.now() / 1000)

function vid(n: number): string {
  return `p${String(n).padStart(10, '0')}`
}

function item(n: number): FeedItem {
  return {
    video: {
      id: vid(n),
      channel_id: 'UCsBjURrPoezykLs9EqgamOA',
      title: `Video number ${n}`,
      published_at: NOW_S - n * 3600,
      description: null,
      channel_title: 'Fireship',
      duration_s: 300 + n,
      is_short: false,
      views: 1000 * n,
      first_seen_at: NOW_S - n * 3600,
      origin: 'rss'
    },
    channel: null,
    state: 'new',
    reaction: null,
    is_new: false,
    why: null,
    badges: []
  }
}

function playlist(id: string, name: string, ids: string[]): Playlist {
  return { id, name, count: ids.length, first_video_id: ids[0] ?? null, created_at: NOW_S - 100, updated_at: NOW_S - 10 }
}

function rules(include: Partial<TabRules['include']>): TabRules {
  return {
    include: { folders: [], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false, ...include },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  }
}

const TABS: Tab[] = [{ id: 'all-new', name: 'All new', kind: 'mixed', rules: rules({ all: true }), icon: null, filters: {}, sort: 0, builtin: true }]

function status(): StatusResponse {
  return {
    new_total: 3,
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
    channels_total: 4,
    subscribed_total: 4
  }
}

// ------------------------------------------------------------------ fake backend (a tiny in-memory playlist store)

interface Req {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

let calls: Req[]
let store: Map<string, { name: string; ids: string[] }>
let seq: number

function summary(id: string): Playlist {
  const p = store.get(id)
  if (!p) throw { code: 'not_found', message: 'gone' }
  return playlist(id, p.name, p.ids)
}

function route(req: Req): unknown {
  const m = req.path.match(/^\/playlists(?:\/([^/]+))?(\/items\/remove|\/items|\/reorder)?$/)
  if (req.method === 'GET' && req.path === '/tabs') return { items: TABS }
  if (req.method === 'GET' && req.path === '/status') return status()
  if (req.method === 'GET' && req.path === '/feed') return { items: [item(1), item(2), item(3)], next_cursor: null, counts: { total: 3, new: 0 } }
  if (req.method === 'POST' && req.path === '/videos/state') return { changed: 1 }
  if (!m) throw { code: 'not_found', message: `no route ${req.method} ${req.path}` }
  const id = m[1] ? decodeURIComponent(m[1]) : null
  const sub = m[2] ?? ''
  const body = (req.body ?? {}) as { name?: string; video_ids?: string[]; ids?: string[] }
  if (!id && req.method === 'GET') {
    const vidq = req.query.video_id
    return { items: [...store.keys()].map(summary), member_of: vidq ? [...store].filter(([, p]) => p.ids.includes(vidq)).map(([k]) => k) : [] }
  }
  if (!id && req.method === 'POST') {
    const newId = `pl_new${++seq}`
    store.set(newId, { name: String(body.name), ids: [...(body.video_ids ?? [])] })
    return summary(newId)
  }
  const p = id ? store.get(id) : undefined
  if (!id || !p) throw { code: 'not_found', message: 'gone' }
  if (req.method === 'GET') return { playlist: summary(id), items: p.ids.map((v) => item(Number(v.slice(1)))) }
  if (req.method === 'PATCH') {
    p.name = String(body.name)
    return summary(id)
  }
  if (req.method === 'DELETE') {
    store.delete(id)
    return { id }
  }
  if (sub === '/items') {
    const fresh = (body.video_ids ?? []).filter((v) => !p.ids.includes(v))
    p.ids.push(...fresh)
    return { playlist: summary(id), changed: fresh.length }
  }
  if (sub === '/items/remove') {
    const before = p.ids.length
    p.ids = p.ids.filter((v) => !(body.video_ids ?? []).includes(v))
    return { playlist: summary(id), changed: before - p.ids.length }
  }
  throw { code: 'not_found', message: 'no route' }
}

function install(): void {
  sdkMock.restHandler = (rawPath, opts) => {
    const [path, qs = ''] = rawPath.split('?')
    const req: Req = { method: String(opts?.method ?? 'GET'), path, query: Object.fromEntries(new URLSearchParams(qs)), body: opts?.body }
    calls.push(req)
    return Promise.resolve()
      .then(() => route(req))
      .then(
        (data) => ({ ok: true, data }),
        (error) => ({ ok: false, error })
      )
  }
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]
const callsTo = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path)
const lastNotification = () => sdkMock.notifications[sdkMock.notifications.length - 1] as { kind: string; message: string } | undefined

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function toggle(el: HTMLElement | null): void {
  if (!el) throw new Error('toggle: missing element')
  act(() => {
    el.click()
  })
}

beforeEach(() => {
  const handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  calls = []
  seq = 0
  store = new Map([
    ['pl_phys', { name: 'Physics', ids: [vid(1)] }],
    ['pl_cook', { name: 'Cooking', ids: [] }]
  ])
  install()
  closePlaylistPicker()
  setQueue(null)
  $watch.set(null)
  setWatchRenderer(() => <WatchPage />)
})

// ------------------------------------------------------------------ the picker

describe('Add to playlist picker', () => {
  it('lists the playlists with the ones holding the video checked', async () => {
    const view = render(<PlaylistPicker />)
    expect(q(view.container, '[data-part="playlist-picker"]')).toBeNull()
    act(() => openPlaylistPicker(item(1)))
    await flush()
    expect(callsTo('GET', '/playlists')[0]?.query).toEqual({ video_id: vid(1) })
    const options = qa(view.container, '[data-part="playlist-option"]')
    expect(options.map((o) => o.getAttribute('data-playlist'))).toEqual(['pl_phys', 'pl_cook'])
    const box = (id: string) => q(view.container, `[data-playlist="${id}"] input[type="checkbox"]`) as HTMLInputElement
    expect(box('pl_phys').checked).toBe(true)
    expect(box('pl_cook').checked).toBe(false)
    expect(view.text()).toContain(common('playlists.picker.title'))
  })

  it('checking saves to the playlist and says so; unchecking removes', async () => {
    const view = render(<PlaylistPicker />)
    act(() => openPlaylistPicker(item(1)))
    await flush()
    toggle(q(view.container, '[data-playlist="pl_cook"] input[type="checkbox"]'))
    await flush()
    expect(callsTo('POST', '/playlists/pl_cook/items').map((c) => c.body)).toEqual([{ video_ids: [vid(1)] }])
    expect(lastNotification()).toMatchObject({ kind: 'success', message: common('playlists.saved', { name: 'Cooking' }) })
    expect((q(view.container, '[data-playlist="pl_cook"] input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)

    toggle(q(view.container, '[data-playlist="pl_phys"] input[type="checkbox"]'))
    await flush()
    expect(callsTo('POST', '/playlists/pl_phys/items/remove').map((c) => c.body)).toEqual([{ video_ids: [vid(1)] }])
    expect(lastNotification()?.message).toBe(common('playlists.removed', { name: 'Physics' }))
    expect(store.get('pl_phys')?.ids).toEqual([])
  })

  it('"New playlist…" creates one with the video in it', async () => {
    const view = render(<PlaylistPicker />)
    act(() => openPlaylistPicker(item(2)))
    await flush()
    click(q(view.container, '[data-part="playlist-new"]'))
    typeInto(q(view.container, '[data-part="playlist-new-name"]') as HTMLInputElement, '  Rust talks ')
    click(q(view.container, '[data-part="playlist-new-create"]'))
    await flush()
    expect(callsTo('POST', '/playlists').map((c) => c.body)).toEqual([{ name: 'Rust talks', video_ids: [vid(2)] }])
    expect(lastNotification()?.message).toBe(common('playlists.saved', { name: 'Rust talks' }))
    expect(qa(view.container, '[data-part="playlist-option"]').map((o) => o.getAttribute('data-playlist'))).toContain('pl_new1')
  })

  it('an error is shown and the checkbox goes back', async () => {
    const view = render(<PlaylistPicker />)
    act(() => openPlaylistPicker(item(1)))
    await flush()
    store.delete('pl_cook')
    toggle(q(view.container, '[data-playlist="pl_cook"] input[type="checkbox"]'))
    await flush()
    expect(lastNotification()?.kind).toBe('error')
  })

  it('closing clears the request', async () => {
    const view = render(<PlaylistPicker />)
    act(() => openPlaylistPicker(item(1)))
    await flush()
    click(q(view.container, '[data-part="playlist-picker-done"]'))
    expect($playlistPick.get()).toBeNull()
    expect(q(view.container, '[data-part="playlist-picker"]')).toBeNull()
  })
})

// ------------------------------------------------------------------ the card and the Watch screen

describe('where "Add to playlist" lives', () => {
  it('every Subscriptions card has the action; it opens the picker for that video', async () => {
    const view = render(<HomeView initialTab="all-new" initialDensity="compact" />)
    await flush(12)
    const action = q(view.container, `[data-part="card"][data-video="${vid(2)}"] [data-action="playlist"]`)
    expect(action).not.toBeNull()
    click(action)
    await flush()
    expect($playlistPick.get()?.item.video.id).toBe(vid(2))
    expect(q(view.container, '[data-part="playlist-picker"]')).not.toBeNull()
  })

  it('the Watch screen has the button next to the other actions', async () => {
    $watch.set({ id: vid(3), item: item(3), list: [], source: null, seq: 1 })
    const view = render(<WatchPage />)
    await flush()
    const button = q(view.container, '[data-watch-action="playlist"]')
    expect(button?.textContent).toContain(common('playlists.add'))
    click(button)
    await flush()
    expect($playlistPick.get()?.item.video.id).toBe(vid(3))
    expect(q(view.container, '[data-part="playlist-picker"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ Play all → the queue

describe('Play all', () => {
  it('sends the playlist to the Watch queue, in order, playing the first', () => {
    const items = [item(4), item(5), item(6)]
    expect(playAll({ id: 'pl_phys', name: 'Physics' }, items)).toBe(true)
    const queue = getQueue()
    expect(queue?.origin).toEqual({ kind: 'playlist', id: 'pl_phys', label: 'Physics' })
    expect(queue?.items.map((i) => i.video.id)).toEqual([vid(4), vid(5), vid(6)])
    expect(queue?.current).toBe(vid(4))
    expect($watch.get()?.id).toBe(vid(4))
  })

  it('an empty playlist plays nothing', () => {
    expect(playAll({ id: 'pl_cook', name: 'Cooking' }, [])).toBe(false)
    expect(getQueue()).toBeNull()
  })
})

// ------------------------------------------------------------------ the Playlists tab

describe('Playlists tab', () => {
  async function openTab() {
    const view = render(<HomeView initialTab="all-new" />)
    await flush(12)
    const tab = q(view.container, `[data-tab-id="${PLAYLISTS_TAB}"]`)
    expect(tab?.textContent).toContain(home('tabs.playlists'))
    click(tab)
    await flush(12)
    return view
  }

  it('sits next to Watch later and lists the playlists (count + first thumbnail)', async () => {
    const view = await openTab()
    const ids = qa(view.container, '[data-tab-id]').map((t) => t.getAttribute('data-tab-id'))
    expect(ids.slice(-2)).toEqual([':later', PLAYLISTS_TAB])
    const cards = qa(view.container, '[data-part="playlist-card"]')
    expect(cards.map((c) => c.getAttribute('data-playlist'))).toEqual(['pl_phys', 'pl_cook'])
    expect(cards[0].textContent).toContain(home('playlists.count_one'))
    expect(cards[1].textContent).toContain(home('playlists.count', { count: '0' }))
    expect(q(cards[0], `[data-part="thumb"]`)).not.toBeNull()
    // no feed controls on this tab
    expect(q(view.container, '[data-part="feed-more"]')).toBeNull()
  })

  it('empty: one sentence and the way there', async () => {
    store.clear()
    const view = await openTab()
    expect(view.text()).toContain(home('playlists.empty_title'))
    expect(view.text()).toContain(home('playlists.empty_desc'))
  })

  it('opening one shows its videos; Play all fills the queue; remove takes a video out', async () => {
    store.get('pl_phys')!.ids = [vid(1), vid(2), vid(3)]
    const view = await openTab()
    click(q(view.container, '[data-playlist="pl_phys"] [data-part="playlist-open"]'))
    await flush(12)
    const detail = q(view.container, '[data-part="playlist-detail"]')
    expect(detail?.textContent).toContain('Physics')
    const shown = () => qa(view.container, '[data-part="playlist-detail"] [data-part="card"][data-video]').map((c) => c.getAttribute('data-video'))
    expect(shown()).toEqual([vid(1), vid(2), vid(3)])

    click(q(view.container, '[data-part="playlist-play-all"]'))
    expect(getQueue()?.origin).toEqual({ kind: 'playlist', id: 'pl_phys', label: 'Physics' })
    expect(getQueue()?.items.map((i) => i.video.id)).toEqual([vid(1), vid(2), vid(3)])
    expect($watch.get()?.id).toBe(vid(1))

    click(q(view.container, `[data-part="card"][data-video="${vid(2)}"] [data-action="remove_from_playlist"]`))
    await flush(12)
    expect(callsTo('POST', '/playlists/pl_phys/items/remove').map((c) => c.body)).toEqual([{ video_ids: [vid(2)] }])
    expect(shown()).toEqual([vid(1), vid(3)])
  })

  it('rename and delete (with confirmation)', async () => {
    const view = await openTab()
    click(q(view.container, '[data-playlist="pl_phys"] [data-part="playlist-open"]'))
    await flush(12)
    click(q(view.container, '[data-part="playlist-rename"]'))
    typeInto(q(view.container, '[data-part="playlist-rename-input"]') as HTMLInputElement, 'Lectures')
    click(q(view.container, '[data-part="playlist-rename-save"]'))
    await flush(12)
    expect(callsTo('PATCH', '/playlists/pl_phys').map((c) => c.body)).toEqual([{ name: 'Lectures' }])
    expect(q(view.container, '[data-part="playlist-detail"]')?.textContent).toContain('Lectures')

    click(q(view.container, '[data-part="playlist-delete"]'))
    const confirm = q(view.container, '[data-slot="confirm-dialog"]')
    expect(confirm?.textContent).toContain(home('playlists.delete_title', { name: 'Lectures' }))
    expect(callsTo('DELETE', '/playlists/pl_phys')).toHaveLength(0)
    click(qa(confirm!, 'button').find((b) => b.textContent === home('playlists.delete_confirm')) ?? null)
    await flush(12)
    expect(callsTo('DELETE', '/playlists/pl_phys')).toHaveLength(1)
    expect(q(view.container, '[data-part="playlist-detail"]')).toBeNull()
    expect(qa(view.container, '[data-part="playlist-card"]').map((c) => c.getAttribute('data-playlist'))).toEqual(['pl_cook'])
  })
})

// ------------------------------------------------------------------ texts

describe('texts', () => {
  const keysOf = (tree: unknown, prefix = ''): string[] =>
    Object.entries(tree as Tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keysOf(v, `${prefix}${k}.`)))

  it('EN and PT-BR have the same playlist keys', () => {
    const pick = (keys: string[], re: RegExp) => keys.filter((k) => re.test(k)).sort()
    expect(pick(keysOf(ptCommon), /^playlists\./)).toEqual(pick(keysOf(enCommon), /^playlists\./))
    expect(pick(keysOf(ptHome), /^(playlists\.|tabs\.playlists)/)).toEqual(pick(keysOf(enHome), /^(playlists\.|tabs\.playlists)/))
    expect(pick(keysOf(enCommon), /^playlists\./).length).toBeGreaterThan(5)
    expect(keysOf(ptWatch).sort()).toEqual(keysOf(enWatch).sort())
  })

  it('the empty state points to Add to playlist', () => {
    expect(home('playlists.empty_desc')).toContain(common('playlists.add'))
  })
})
