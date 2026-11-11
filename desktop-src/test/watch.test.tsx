// Watching inside Hermes: the Watch section of the single HermesTube page (no center tab of its own; opening
// another video swaps the content), with the core's OWN player (`MessageTextContent` with the bare video
// link) on top and ours below — title, channel, folder, date, duration, reason, collapsed description, the
// card actions (the same toggle and undo rule from lib/video-actions) and "Open on YouTube" always
// at hand; "Up next" with the list the video came from (no autoplay promised). Opening does NOT mark as watched.
// Then (item 2): a click on the card goes to the section; ⌘/Ctrl+click and "Open on YouTube" go outside.
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FeedItem, Folder, Tab } from '../../shared/api-types'
import { DESKTOP_ROUTES, PLUGIN_ID } from '../../shared/ids'
import { ChatVideoCard } from '../chat'
import { VideoCard } from '../components'
import enWatch from '../locales/en/watch.json'
import ptWatch from '../locales/pt-BR/watch.json'
import { setPluginContext } from '../lib/ctx'
import { closeAllDialogs, openDialog } from '../lib/dialogs'
import { openVideo, youtubeWatchUrl } from '../lib/format'
import { NAMESPACES, interpolate, registerLocales } from '../lib/i18n'
import {
  $watch,
  OPEN_MODE_KEY,
  OpenModeSwitch,
  LARGE_PLAYER_KEY,
  TIP_DISMISSED_KEY,
  getOpenMode,
  setOpenMode,
  setWatchRenderer,
  tabTitle,
  watchVideo
} from '../lib/player'
import { $nav, closeWatch, currentSection } from '../lib/nav'
import { registerShell } from '../main'
import { HomeView } from '../pages/home'
import { WatchPage } from '../pages/watch'
import { WATCH_CSS } from '../pages/watch/styles'
import { click, flush, render } from './render'
import { listRepoFiles, readRepoFile } from './repo.mjs'
import { createMockCtx, host, sdkMock } from './sdk-mock'

// ------------------------------------------------------------------ fixtures

type Tree = { [k: string]: Tree | string }

function textOf(tree: unknown, key: string, vars?: Record<string, string | number>): string {
  let node = tree as Tree | string
  for (const part of key.split('.')) node = (node as Tree)[part]
  if (typeof node !== 'string') throw new Error(`no text for key: ${key}`)
  return interpolate(node, vars)
}
const en = (key: string, vars?: Record<string, string | number>) => textOf(enWatch, key, vars)

const NOW_S = Math.floor(Date.now() / 1000)
const IDS = ['wjZofJX0v4M', 'VMj-3S1tku0', 'ujkD4SxPKOI', 'G_em1hHPnXY', 'aircAruvnKk', 'nEaJMdM1djM', 'dQw4w9WgXcQ', 'jNQXAC9IVRw', 'M7lc1UVf-VE', 'aqz-KE-bpKQ', 'kCc8FmEb1nY']

const FOLDER: Folder = { id: 'f-sci', name: 'Ciência', parent_id: null, color: null, sort: 0 } as unknown as Folder

function item(id: string, over: Partial<FeedItem> = {}): FeedItem {
  const n = IDS.indexOf(id)
  return {
    video: {
      id,
      channel_id: 'UCYO_jab_esuFRV4b17AJtAw',
      title: `Video number ${n} about transformers and the tech behind large language models`,
      published_at: NOW_S - 3 * 86400,
      description: `First line of ${id}.\nSecond line with more detail.\nThird line.\nFourth line.`,
      channel_title: '3Blue1Brown',
      duration_s: 1648,
      is_short: false,
      views: 6_400_000,
      first_seen_at: NOW_S - 3 * 86400,
      origin: 'rss'
    },
    channel: {
      id: 'UCYO_jab_esuFRV4b17AJtAw',
      title: '3Blue1Brown',
      relation: 'subscribed',
      source: 'extension',
      added_at: NOW_S - 400 * 86400,
      handle: '@3blue1brown',
      thumb: null,
      url: null,
      folder_id: FOLDER.id,
      favorite: false,
      muted: false,
      unsubscribed_at: null,
      last_video_at: null,
      videos_per_week: 1,
      shorts_ratio: 0,
      ai_note: null,
      tag_ids: []
    },
    state: 'new',
    reaction: null,
    is_new: true,
    why: { via: 'folder', label: 'Ciência', detail: null },
    badges: [],
    ...over
  }
}

const LIST = IDS.map((id) => item(id))

interface Req {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

let calls: Req[]
let routes: Record<string, (req: Req) => unknown>
let handle: ReturnType<typeof createMockCtx>

function install(): void {
  sdkMock.restHandler = (rawPath, opts) => {
    const [path, qs = ''] = rawPath.split('?')
    const method = String(opts?.method ?? 'GET')
    const req: Req = { method, path, query: Object.fromEntries(new URLSearchParams(qs)), body: opts?.body }
    calls.push(req)
    const route = routes[`${method} ${path}`]
    if (!route) return { ok: false, error: { code: 'not_found', message: `no route ${method} ${path}` } }
    return Promise.resolve()
      .then(() => route(req))
      .then(
        (data) => ({ ok: true, data }),
        (error: unknown) => ({ ok: false, error })
      )
  }
}

const stateCalls = () => calls.filter((c) => c.method === 'POST' && c.path === '/videos/state')
const videoCalls = () => calls.filter((c) => c.method === 'GET' && c.path === '/videos')

beforeEach(() => {
  handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
  calls = []
  routes = {
    'GET /videos': (req) => ({ items: req.query.ids.split(',').filter((id) => IDS.includes(id)).map((id) => item(id)) }),
    'GET /folders': () => ({ items: [FOLDER] }),
    'POST /videos/state': (req) => ({ changed: (req.body as { video_ids: string[] }).video_ids.length }),
    'GET /status': () => ({})
  }
  install()
  setWatchRenderer(() => <WatchPage />)
})

/** Mounts the Watch section as the shell does (it reads the open video from `$watch`). */
async function mountTab() {
  if (!$watch.get()) throw new Error('no video open')
  const v = render(<WatchPage />)
  await flush()
  return v
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)
const btn = (root: ParentNode, action: string) => q(root, `[data-watch-action="${action}"]`)

function keydown(el: Element, key: string, extra: Partial<KeyboardEventInit> = {}): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
  })
}

// queue helpers
const row = (root: ParentNode, id: string) => q(root, `[data-part="watch-next-item"][data-video="${id}"]`)
const rowButton = (root: ParentNode, id: string) => q(root, `[data-part="watch-next-item"][data-video="${id}"] [data-part="watch-next-row"]`)
const rowTool = (root: ParentNode, id: string, part: string) => q(root, `[data-part="watch-next-item"][data-video="${id}"] [data-part="${part}"]`)
const queueIds = (root: ParentNode) => [...root.querySelectorAll('[data-part="watch-next-item"]')].map((r) => r.getAttribute('data-video'))
const position = (root: ParentNode) => q(root, '[data-part="watch-next-pos"]')?.textContent ?? null

/** Pointer events as the browser sends them (jsdom has no PointerEvent: a MouseEvent with the pointer type). */
function pointer(target: EventTarget, type: string, clientY: number): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY }))
  })
}

const ROW_TOP = 100
const ROW_H = 80
/** Vertical center of the row at index `i`. */
const rowY = (i: number) => ROW_TOP + i * ROW_H + ROW_H / 2

/** Lays the queue rows out (jsdom has no layout): row i at ROW_TOP + i × ROW_H; the list's scroll box as given. */
function mockRowRects(box: { top: number; bottom: number } = { top: 0, bottom: 4000 }): () => void {
  const real = Element.prototype.getBoundingClientRect
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.getAttribute('data-part') === 'watch-next-item') {
      const i = [...(this.parentElement?.children ?? [])].indexOf(this)
      return rect(ROW_TOP + i * ROW_H, ROW_H)
    }
    if (this.getAttribute('data-part') === 'watch-next-scroll') return rect(box.top, box.bottom - box.top)
    return real.call(this)
  }
  return () => {
    Element.prototype.getBoundingClientRect = real
  }
}

// ------------------------------------------------------------------ opening the tab

describe('watchVideo: the Watch section of the single page (no center tab of its own)', () => {
  it('no Watch screen registered (plugin unloaded / old tests): false, the caller opens YouTube', () => {
    setWatchRenderer(null)
    expect(watchVideo(IDS[0], { item: LIST[0] })).toBe(false)
    expect($watch.get()).toBeNull()
    expect(currentSection()).toBe('home')
  })

  it('invalid id (the chat directive is untrusted input): false', () => {
    expect(watchVideo('javascript:alert(1)')).toBe(false)
    expect($watch.get()).toBeNull()
  })

  it('opens the Watch section and brings the page to the front; another video swaps it; never openWorkspace', () => {
    expect(watchVideo(IDS[0], { item: LIST[0], list: LIST, source: 'Ciência' })).toBe(true)
    expect(watchVideo(IDS[1], { item: LIST[1], list: LIST, source: 'Ciência' })).toBe(true)
    expect(sdkMock.workspaceOpens).toEqual([])
    expect(currentSection()).toBe('watch')
    expect($nav.get().filter((e) => e.section === 'watch')).toHaveLength(1)
    expect($watch.get()?.id).toBe(IDS[1])
    expect(new Set(sdkMock.navigations)).toEqual(new Set([DESKTOP_ROUTES.home]))
  })

  it('works without host.openWorkspace (it is no longer needed)', () => {
    host.openWorkspace = undefined
    expect(watchVideo(IDS[0], { item: LIST[0] })).toBe(true)
  })

  it('tabTitle: a short one stays whole; a long one is cut at a word with an ellipsis; empty uses the label', () => {
    expect(tabTitle('Short title', 'Watching')).toBe('Short title')
    expect(tabTitle('', 'Watching')).toBe('Watching')
    expect(tabTitle(null, 'Watching')).toBe('Watching')
    const cut = tabTitle('A '.repeat(60), 'Watching')
    expect(cut.length).toBeLessThanOrEqual(40)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('closing the video (✕ of the internal tab) clears the state', () => {
    watchVideo(IDS[0], { item: LIST[0] })
    closeWatch()
    expect($watch.get()).toBeNull()
    expect(currentSection()).toBe('home')
  })

  it('main.tsx registers the screen (opens nothing, no network); unloading the plugin turns it off', () => {
    setWatchRenderer(null)
    const h = createMockCtx(PLUGIN_ID)
    calls = []
    registerShell(h.ctx)
    expect(sdkMock.workspaceOpens).toEqual([])
    expect(calls).toEqual([])
    expect(watchVideo(IDS[0], { item: LIST[0] })).toBe(true)
    h.dispose()
    expect($watch.get()).toBeNull()
    expect(watchVideo(IDS[0], { item: LIST[0] })).toBe(false)
  })

  it('opening does NOT mark as watched (no write)', async () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST })
    await mountTab()
    expect(stateCalls()).toEqual([])
  })
})

// ------------------------------------------------------------------ the section

describe('Watch section', () => {
  it('core player on top: MessageTextContent with the BARE video link (no iframe of its own)', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    const player = q(v.container, '[data-part="watch-player"] [data-slot="message-text"]')
    expect(player?.getAttribute('data-text')).toBe(youtubeWatchUrl(IDS[0]))
    expect(v.container.querySelector('iframe, webview')).toBeNull()
  })

  it('folder: chip next to the channel, but not repeated when the reason is already the folder itself', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    expect(q(v.container, '[data-part="why"]')?.textContent).toContain('Ciência')
    expect(q(v.container, '[data-part="watch-meta"] [data-folder]')).toBeNull()
  })

  it('what is ours: title, channel, folder, date, duration, reason, collapsed description', async () => {
    watchVideo(IDS[0], { item: item(IDS[0], { why: { via: 'theme', label: 'Agentes de IA', detail: null } }) })
    const v = await mountTab()
    expect(q(v.container, '[data-part="watch-title"]')?.textContent).toBe(LIST[0].video.title)
    const meta = q(v.container, '[data-part="watch-meta"]')!
    expect(meta.textContent).toContain('3Blue1Brown')
    expect(q(meta, '[data-folder="f-sci"]')?.textContent).toContain('Ciência')
    expect(meta.textContent).toContain('27:28')
    expect(q(meta, 'time')?.getAttribute('dateTime')).toBe(new Date(LIST[0].video.published_at! * 1000).toISOString())
    expect(q(v.container, '[data-part="why"]')?.textContent).toContain('Agentes de IA')
    const desc = q(v.container, '[data-part="watch-desc"]')!
    expect(desc.getAttribute('data-open')).toBe('false')
    const toggle = q(v.container, '[data-part="watch-desc-toggle"]')!
    expect(toggle.textContent).toBe(en('description.more'))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    click(toggle)
    expect(desc.getAttribute('data-open')).toBe('true')
    expect(q(v.container, '[data-part="watch-desc-toggle"]')?.textContent).toBe(en('description.less'))
  })

  it('no description: no description block nor button', async () => {
    const bare = item(IDS[0], { video: { ...LIST[0].video, description: null } })
    watchVideo(IDS[0], { item: bare })
    const v = await mountTab()
    expect(q(v.container, '[data-part="watch-desc"]')).toBeNull()
    expect(q(v.container, '[data-part="watch-desc-toggle"]')).toBeNull()
  })

  it('"Mark as watched" highlighted; clicking saves, notifies with Undo, and undo goes back to the previous state (new)', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    const watched = btn(v.container, 'watched')!
    // its own monochrome highlight (contrast, not the app's accent color)
    expect(watched.className).toContain('watch-primary')
    expect(watched.textContent).toContain(en('actions.mark_watched'))
    click(watched)
    await flush()
    expect(stateCalls().map((c) => c.body)).toEqual([{ video_ids: [IDS[0]], state: 'watched' }])
    expect(btn(v.container, 'watched')?.getAttribute('aria-pressed')).toBe('true')
    expect(btn(v.container, 'watched')?.textContent).toContain(en('actions.watched'))
    const toast = sdkMock.notifications.at(-1)!
    expect(toast.message).toBe(en('toast.watched'))
    act(() => toast.action.onClick())
    await flush()
    expect(stateCalls().map((c) => c.body)[1]).toEqual({ video_ids: [IDS[0]], state: 'new' })
    expect(btn(v.container, 'watched')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('failure saving: the section reverts and the notice says why', async () => {
    routes['POST /videos/state'] = () => Promise.reject({ code: 'invalid', message: 'nope' })
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    click(btn(v.container, 'later'))
    await flush()
    expect(btn(v.container, 'later')?.getAttribute('aria-pressed')).toBe('false')
    expect(sdkMock.notifications.at(-1)?.kind).toBe('error')
  })

  it('Later, Archive, Like, Dislike: the same shortcuts (l, e, u, d) and the same rule', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    const root = q(v.container, '[data-part="watch"]')!
    keydown(root, 'l')
    keydown(root, 'u')
    await flush()
    keydown(root, 'u') // turns the reaction off
    keydown(root, 'e')
    await flush()
    expect(stateCalls().map((c) => c.body)).toEqual([
      { video_ids: [IDS[0]], state: 'later' },
      { video_ids: [IDS[0]], reaction: 'up' },
      { video_ids: [IDS[0]], reaction: null },
      { video_ids: [IDS[0]], state: 'archived' }
    ])
    for (const a of ['later', 'archive', 'up', 'down']) expect(btn(v.container, a)).not.toBeNull()
  })

  it('a shortcut with a modifier or coming from a text field: nothing', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    const root = q(v.container, '[data-part="watch"]')!
    keydown(root, 'w', { metaKey: true })
    keydown(root, 'w', { ctrlKey: true })
    const input = document.createElement('input')
    root.appendChild(input)
    keydown(input, 'w')
    await flush()
    expect(stateCalls()).toEqual([])
  })

  it('"Open on YouTube" always at hand (button and the o key) — opens outside through ctx.os', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    const open = btn(v.container, 'youtube')!
    expect(open.textContent).toContain(en('actions.open'))
    click(open)
    keydown(q(v.container, '[data-part="watch"]')!, 'o')
    await flush()
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[0]), youtubeWatchUrl(IDS[0])])
  })

  it('only the id (chat): fetches GET /videos and shows the data when it arrives; the tab title follows', async () => {
    watchVideo(IDS[2])
    const v = await mountTab()
    expect(videoCalls().map((c) => c.query.ids)).toEqual([IDS[2]])
    expect(q(v.container, '[data-part="watch-title"]')?.textContent).toBe(LIST[2].video.title)
    expect($watch.get()?.item?.video.title.startsWith('Video number 2')).toBe(true)
  })

  it('a video the backend does not know (removed / outside the library): the player stays, a notice and Open on YouTube', async () => {
    watchVideo('zzzzzzzzzzz')
    const v = await mountTab()
    expect(q(v.container, '[data-part="watch-player"] [data-slot="message-text"]')?.getAttribute('data-text')).toBe(youtubeWatchUrl('zzzzzzzzzzz'))
    expect(q(v.container, '[data-part="watch-unknown"]')?.textContent).toContain(en('state.unknown_title'))
    expect(btn(v.container, 'youtube')).not.toBeNull()
    expect(btn(v.container, 'watched')).toBeNull() // no data, no state actions
  })

  it('error fetching the data: notice with try again; player and Open on YouTube stay', async () => {
    routes['GET /videos'] = () => Promise.reject({ code: 'internal', message: 'boom' })
    watchVideo(IDS[2])
    const v = await mountTab()
    await flush(10)
    expect(q(v.container, '[data-part="watch-error"]')).not.toBeNull()
    expect(btn(v.container, 'youtube')).not.toBeNull()
    expect(q(v.container, '[data-part="watch-player"]')).not.toBeNull()
  })

  it('nothing playing (tab restored without state): empty state with a way back', async () => {
    const v = render(<WatchPage />)
    await flush()
    expect(q(v.container, '[data-part="watch-empty"]')).not.toBeNull()
  })
})

// ------------------------------------------------------------------ player at native size, list beside

describe('player at the size the app gives it, "Up next" beside it', () => {
  const larger = (root: ParentNode) => q(root, '[data-part="watch-larger"]')
  const box = (root: ParentNode) => q(root, '[data-part="watch-player"] [data-zoom]')

  it('no zoom by default: the core player draws at its own size (sharp)', async () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST })
    const v = await mountTab()
    expect(box(v.container)?.style.zoom).toBe('')
    expect(box(v.container)?.getAttribute('data-zoom')).toBe('1')
    expect(q(v.container, '[data-part="watch"]')?.getAttribute('data-large')).toBe('false')
    expect(larger(v.container)?.getAttribute('aria-pressed')).toBe('false')
  })

  it('"Larger player" turns the zoom mode on and off and is remembered', async () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST })
    const v = await mountTab()
    expect(larger(v.container)?.textContent).toContain(en('player.larger'))
    click(larger(v.container))
    expect(larger(v.container)?.getAttribute('aria-pressed')).toBe('true')
    expect(q(v.container, '[data-part="watch"]')?.getAttribute('data-large')).toBe('true')
    expect(handle.storage.get(LARGE_PLAYER_KEY)).toBe(true)
    v.unmount()
    const w = await mountTab()
    expect(larger(w.container)?.getAttribute('aria-pressed')).toBe('true')
    click(larger(w.container))
    expect(handle.storage.get(LARGE_PLAYER_KEY)).toBe(false)
    expect(q(w.container, '[data-part="watch"]')?.getAttribute('data-large')).toBe('false')
  })

  it('one grid holds the player, the line under it, the queue and the details (no separate band)', async () => {
    watchVideo(IDS[1], { item: LIST[1], list: LIST, source: 'Ciência' })
    const v = await mountTab()
    const layout = q(v.container, '[data-part="watch-layout"]')!
    expect([...layout.children].map((c) => c.getAttribute('data-part'))).toEqual(['watch-player', 'watch-foot', 'watch-next', 'watch-below'])
    expect(q(v.container, '[data-part="watch"]')?.getAttribute('data-queue')).toBe('true')
    expect(q(v.container, '[data-part="watch-band"]')).toBeNull()
    // without a list (chat), a video that is not queued: no queue
    v.unmount()
    watchVideo('zzzzzzzzzzz')
    const w = await mountTab()
    expect([...q(w.container, '[data-part="watch-layout"]')!.children].map((c) => c.getAttribute('data-part'))).toEqual(['watch-player', 'watch-foot', 'watch-below'])
    expect(q(w.container, '[data-part="watch"]')?.getAttribute('data-queue')).toBe('false')
  })

  it('"Always allow" tip: shows once under the player and goes away for good when dismissed', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    const tip = q(v.container, '[data-part="watch-tip"]')!
    expect(tip).not.toBeNull()
    expect(tip.textContent).toContain('Always allow YouTube')
    expect(tip.textContent).toContain('Load YouTube')
    click(q(v.container, '[data-part="watch-tip-dismiss"]'))
    expect(q(v.container, '[data-part="watch-tip"]')).toBeNull()
    expect(handle.storage.get(TIP_DISMISSED_KEY)).toBe(true)
    v.unmount()
    const w = await mountTab()
    expect(q(w.container, '[data-part="watch-tip"]')).toBeNull()
  })

  it('PT-BR: tip and button', async () => {
    act(() => sdkMock.locale.set('pt-br'))
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    // the app's consent buttons are English-only: the tip quotes them as they appear
    expect(q(v.container, '[data-part="watch-tip"]')?.textContent).toContain('Dica')
    expect(q(v.container, '[data-part="watch-tip"]')?.textContent).toContain('"Always allow YouTube"')
    expect(larger(v.container)?.textContent).toContain('Player maior')
  })
})

// ------------------------------------------------------------------ Up next

describe('Up next', () => {
  it('the whole list as a queue, the current video marked; the source and "n of m" in the header', async () => {
    watchVideo(IDS[1], { item: LIST[1], list: LIST, source: 'Ciência' })
    const v = await mountTab()
    expect(queueIds(v.container)).toEqual(IDS)
    expect(row(v.container, IDS[1])?.getAttribute('data-current')).toBe('true')
    expect(rowButton(v.container, IDS[1])?.getAttribute('aria-current')).toBe('true')
    expect(row(v.container, IDS[2])?.getAttribute('data-current')).toBe('false')
    expect(q(v.container, '[data-part="watch-next"]')?.textContent).toContain('Ciência')
    expect(position(v.container)).toBe(en('next.position', { index: 2, total: IDS.length }))
    // no autoplay promised
    expect(v.text()).not.toMatch(/autoplay|toca em seguida/i)
  })

  it('clicking a row plays it in the same section; the queue and its order stay', async () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST, source: 'Ciência' })
    const v = await mountTab()
    click(rowButton(v.container, IDS[3]))
    await flush()
    expect($watch.get()?.id).toBe(IDS[3])
    expect(q(v.container, '[data-part="watch-title"]')?.textContent).toBe(LIST[3].video.title)
    expect(sdkMock.workspaceOpens).toEqual([])
    expect($nav.get().filter((e) => e.section === 'watch')).toHaveLength(1)
    expect(queueIds(v.container)).toEqual(IDS)
    expect(row(v.container, IDS[3])?.getAttribute('data-current')).toBe('true')
    expect(position(v.container)).toBe(en('next.position', { index: 4, total: IDS.length }))
  })

  it('N/J/→ next; P/K/← previous; at the ends, nothing', async () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST })
    const v = await mountTab()
    const root = () => q(v.container, '[data-part="watch"]')!
    keydown(root(), 'n')
    expect($watch.get()?.id).toBe(IDS[1])
    keydown(root(), 'j')
    expect($watch.get()?.id).toBe(IDS[2])
    keydown(root(), 'ArrowRight')
    expect($watch.get()?.id).toBe(IDS[3])
    keydown(root(), 'p')
    keydown(root(), 'k')
    keydown(root(), 'ArrowLeft')
    expect($watch.get()?.id).toBe(IDS[0])
    keydown(root(), 'p')
    expect($watch.get()?.id).toBe(IDS[0])
    await flush()
    expect(stateCalls()).toEqual([])
  })

  it('Previous/Next buttons; without a list (chat), no "Up next"', async () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST.slice(0, 5) })
    const v = await mountTab()
    expect(q(v.container, '[data-part="watch-prev"]')?.hasAttribute('disabled')).toBe(true)
    click(q(v.container, '[data-part="watch-next-btn"]'))
    expect($watch.get()?.id).toBe(IDS[1])
    v.unmount()
    // from the chat, a video that is not in the queue (a queued one keeps the queue: see the queue tests)
    watchVideo(IDS[8], { item: LIST[8] })
    const w = await mountTab()
    expect(q(w.container, '[data-part="watch-next"]')).toBeNull()
  })

  it('an action done here shows in the Up next row (watched veil) and holds when going back to the video', async () => {
    watchVideo(IDS[0], { item: LIST[0], list: LIST })
    const v = await mountTab()
    keydown(q(v.container, '[data-part="watch"]')!, 'w')
    await flush()
    keydown(q(v.container, '[data-part="watch"]')!, 'n')
    keydown(q(v.container, '[data-part="watch"]')!, 'p')
    await flush()
    expect(btn(v.container, 'watched')?.getAttribute('aria-pressed')).toBe('true')
  })
})

// ------------------------------------------------------------------ editing the queue

describe('Up next: an editable queue', () => {
  async function open(current = 1, list: readonly FeedItem[] = LIST, source = 'Ciência') {
    watchVideo(IDS[current], { item: LIST[current], list, source })
    return mountTab()
  }
  const root = (c: ParentNode) => q(c, '[data-part="watch"]')!
  const live = (c: ParentNode) => q(c, '[data-part="watch-next-live"]')?.textContent ?? ''
  const without = (...gone: string[]) => IDS.filter((id) => !gone.includes(id))

  it('✕ removes from the queue only (no state write, the source list untouched); Undo puts it back', async () => {
    const v = await open()
    click(rowTool(v.container, IDS[3], 'watch-next-remove'))
    expect(queueIds(v.container)).toEqual(without(IDS[3]))
    expect(position(v.container)).toBe(en('next.position', { index: 2, total: IDS.length - 1 }))
    expect($watch.get()?.list.map((it) => it.video.id)).toEqual(IDS)
    expect($watch.get()?.id).toBe(IDS[1])
    await flush()
    expect(stateCalls()).toEqual([])
    const toast = sdkMock.notifications.at(-1)!
    expect(toast.message).toBe(en('next.removed', { title: LIST[3].video.title }))
    expect(toast.action.label).toBe(en('toast.undo'))
    act(() => toast.action.onClick())
    expect(queueIds(v.container)).toEqual(IDS)
    expect(position(v.container)).toBe(en('next.position', { index: 2, total: IDS.length }))
  })

  it('Delete and Backspace on a focused row remove it; focus goes to the row that took its place', async () => {
    const v = await open()
    rowButton(v.container, IDS[4])!.focus()
    keydown(rowButton(v.container, IDS[4])!, 'Delete')
    expect(queueIds(v.container)).toEqual(without(IDS[4]))
    expect(document.activeElement).toBe(rowButton(v.container, IDS[5]))
    keydown(document.activeElement!, 'Backspace')
    expect(queueIds(v.container)).toEqual(without(IDS[4], IDS[5]))
    expect(document.activeElement).toBe(rowButton(v.container, IDS[6]))
    expect(live(v.container)).toBe(en('next.removed', { title: LIST[5].video.title }))
    expect($watch.get()?.id).toBe(IDS[1])
  })

  it('removing the current video plays the next one; Undo brings it back and plays it again', async () => {
    const v = await open(1)
    click(rowTool(v.container, IDS[1], 'watch-next-remove'))
    await flush()
    expect($watch.get()?.id).toBe(IDS[2])
    expect(q(v.container, '[data-part="watch-title"]')?.textContent).toBe(LIST[2].video.title)
    expect(row(v.container, IDS[2])?.getAttribute('data-current')).toBe('true')
    expect(position(v.container)).toBe(en('next.position', { index: 2, total: IDS.length - 1 }))
    act(() => sdkMock.notifications.at(-1)!.action.onClick())
    await flush()
    expect($watch.get()?.id).toBe(IDS[1])
    expect(queueIds(v.container)).toEqual(IDS)
    expect(row(v.container, IDS[1])?.getAttribute('data-current')).toBe('true')
  })

  it('empty queue: the video keeps playing, the panel says so, N does nothing; Undo fills it again', async () => {
    const v = await open(0, [LIST[0]])
    click(rowTool(v.container, IDS[0], 'watch-next-remove'))
    await flush()
    expect($watch.get()?.id).toBe(IDS[0])
    expect(queueIds(v.container)).toEqual([])
    expect(q(v.container, '[data-part="watch-next-empty"]')?.textContent).toContain(en('next.empty'))
    expect(q(v.container, '[data-part="watch-next-btn"]')?.hasAttribute('disabled')).toBe(true)
    keydown(root(v.container), 'n')
    expect($watch.get()?.id).toBe(IDS[0])
    act(() => sdkMock.notifications.at(-1)!.action.onClick())
    await flush()
    expect(queueIds(v.container)).toEqual([IDS[0]])
    expect(position(v.container)).toBe(en('next.position', { index: 1, total: 1 }))
  })

  it('an Undo from a queue that was since replaced by another list does nothing', async () => {
    const v = await open(1)
    click(rowTool(v.container, IDS[3], 'watch-next-remove'))
    const undo = sdkMock.notifications.at(-1)!.action
    watchVideo(IDS[0], { item: LIST[0], list: LIST.slice(0, 3), source: 'Favorites' })
    await flush()
    act(() => undo.onClick())
    expect(queueIds(v.container)).toEqual(IDS.slice(0, 3))
  })

  it('Alt+↑ / Alt+↓ move the focused row, keep the focus on it and announce the new position; N follows', async () => {
    const v = await open(0)
    const moved = () => rowButton(v.container, IDS[4])!
    moved().focus()
    for (let i = 0; i < 3; i++) keydown(moved(), 'ArrowUp', { altKey: true })
    expect(queueIds(v.container).slice(0, 3)).toEqual([IDS[0], IDS[4], IDS[1]])
    expect(document.activeElement).toBe(moved())
    expect(live(v.container)).toBe(en('next.moved', { title: LIST[4].video.title, index: 2, total: IDS.length }))
    keydown(root(v.container), 'n')
    expect($watch.get()?.id).toBe(IDS[4])
    // moving the current one keeps it current; "n of m" follows
    moved().focus()
    keydown(moved(), 'ArrowDown', { altKey: true })
    expect(position(v.container)).toBe(en('next.position', { index: 3, total: IDS.length }))
    expect($watch.get()?.id).toBe(IDS[4])
    expect(row(v.container, IDS[4])?.getAttribute('data-current')).toBe('true')
    // at the top: nothing moves
    rowButton(v.container, IDS[0])!.focus()
    keydown(rowButton(v.container, IDS[0])!, 'ArrowUp', { altKey: true })
    expect(queueIds(v.container)[0]).toBe(IDS[0])
    await flush()
    expect(stateCalls()).toEqual([])
  })

  it('↑ / ↓ move the focus between rows (without moving anything)', async () => {
    const v = await open(0)
    rowButton(v.container, IDS[2])!.focus()
    keydown(rowButton(v.container, IDS[2])!, 'ArrowDown')
    expect(document.activeElement).toBe(rowButton(v.container, IDS[3]))
    keydown(document.activeElement!, 'ArrowUp')
    keydown(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(rowButton(v.container, IDS[1]))
    expect(queueIds(v.container)).toEqual(IDS)
  })

  it('"Play next" puts the video right after the current one; N plays it', async () => {
    const v = await open(1)
    expect(rowTool(v.container, IDS[1], 'watch-next-playnext')).toBeNull() // the current one
    expect(rowTool(v.container, IDS[2], 'watch-next-playnext')).toBeNull() // already next
    click(rowTool(v.container, IDS[7], 'watch-next-playnext'))
    expect(queueIds(v.container).slice(0, 4)).toEqual([IDS[0], IDS[1], IDS[7], IDS[2]])
    expect(live(v.container)).toBe(en('next.queued_next', { title: LIST[7].video.title }))
    keydown(root(v.container), 'n')
    expect($watch.get()?.id).toBe(IDS[7])
  })

  it('dragging by the handle (pointer events): the row is marked, a line shows where it lands, the drop moves it', async () => {
    const v = await open(0)
    const restore = mockRowRects()
    try {
      pointer(rowTool(v.container, IDS[5], 'watch-next-grip')!, 'pointerdown', rowY(5))
      pointer(document, 'pointermove', rowY(1) - 20) // upper half of row 1 → before it
      expect(row(v.container, IDS[5])?.getAttribute('data-dragging')).toBe('true')
      expect(row(v.container, IDS[1])?.getAttribute('data-drop')).toBe('before')
      expect(v.container.querySelectorAll('[data-drop]')).toHaveLength(1)
      pointer(document, 'pointerup', rowY(1) - 20)
      expect(queueIds(v.container).slice(0, 3)).toEqual([IDS[0], IDS[5], IDS[1]])
      expect(v.container.querySelectorAll('[data-drop], [data-dragging="true"]')).toHaveLength(0)
      expect(live(v.container)).toBe(en('next.moved', { title: LIST[5].video.title, index: 2, total: IDS.length }))
      // the current video dragged to the end stays current; "n of m" follows
      pointer(rowTool(v.container, IDS[0], 'watch-next-grip')!, 'pointerdown', rowY(0))
      pointer(document, 'pointermove', rowY(IDS.length - 1) + 30) // lower half of the last row → after it
      expect(row(v.container, IDS[10])?.getAttribute('data-drop')).toBe('after')
      pointer(document, 'pointerup', rowY(IDS.length - 1) + 30)
      expect(queueIds(v.container).at(-1)).toBe(IDS[0])
      expect($watch.get()?.id).toBe(IDS[0])
      expect(position(v.container)).toBe(en('next.position', { index: IDS.length, total: IDS.length }))
      // dropping where it already is, or Escape: nothing moves
      const before = queueIds(v.container)
      pointer(rowTool(v.container, IDS[3], 'watch-next-grip')!, 'pointerdown', rowY(3))
      pointer(document, 'pointermove', rowY(3) + 10)
      expect(v.container.querySelectorAll('[data-drop]')).toHaveLength(0)
      pointer(document, 'pointermove', rowY(7))
      keydown(document.body, 'Escape')
      expect(v.container.querySelectorAll('[data-drop], [data-dragging="true"]')).toHaveLength(0)
      pointer(document, 'pointerup', rowY(7))
      expect(queueIds(v.container)).toEqual(before)
    } finally {
      restore()
    }
  })

  it('while dragging near the bottom edge of the list, it scrolls by itself; it stops with the drop', async () => {
    const v = await open(0)
    const restore = mockRowRects({ top: 100, bottom: 400 })
    const scroller = q(v.container, '[data-part="watch-next-scroll"]')!
    let top = 0
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (x: number) => (top = x) })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 2000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 300 })
    try {
      pointer(rowTool(v.container, IDS[2], 'watch-next-grip')!, 'pointerdown', rowY(2))
      pointer(document, 'pointermove', 396)
      await act(() => new Promise((r) => setTimeout(r, 150)))
      expect(top).toBeGreaterThan(0)
      pointer(document, 'pointerup', 396)
      const reached = top
      await act(() => new Promise((r) => setTimeout(r, 80)))
      expect(top).toBe(reached)
    } finally {
      restore()
    }
  })

  it('the queue survives leaving the section and coming back; the same tab keeps the edits; another list replaces it', async () => {
    const v = await open(1)
    click(rowTool(v.container, IDS[3], 'watch-next-remove'))
    v.unmount()
    const w = await mountTab()
    expect(queueIds(w.container)).toEqual(without(IDS[3]))
    watchVideo(IDS[5], { item: LIST[5], list: LIST, source: 'Ciência' })
    await flush()
    expect(queueIds(w.container)).toEqual(without(IDS[3]))
    expect(row(w.container, IDS[5])?.getAttribute('data-current')).toBe('true')
    watchVideo(IDS[0], { item: LIST[0], list: LIST.slice(0, 3), source: 'Favorites' })
    await flush()
    expect(queueIds(w.container)).toEqual(IDS.slice(0, 3))
    expect(q(w.container, '[data-part="watch-next"]')?.textContent).toContain('Favorites')
  })
})

// ------------------------------------------------------------------ i18n, style, catalog rules

describe('i18n, stylesheet and rules', () => {
  it('watch namespace registered; EN and PT-BR with the same keys', () => {
    expect(NAMESPACES).toContain('watch')
    const keys = (tree: Tree, p = ''): string[] => Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v, `${p}${k}.`)))
    expect(keys(ptWatch as Tree).sort()).toEqual(keys(enWatch as Tree).sort())
  })

  it('section stylesheet: only prefix classes, only theme variables, no network; display only "none" in a container query', () => {
    const css = WATCH_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) expect(m[1].startsWith('PFX_'), m[1]).toBe(true)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)
    expect(css).not.toMatch(/@import|url\(|@font-face/)
    for (const block of css.split('@container').slice(1)) {
      const body = block.slice(0, block.indexOf('\n}'))
      for (const d of body.matchAll(/display:\s*([a-z-]+)/g)) expect(d[1]).toBe('none')
    }
  })

  it('alignment: one box with the side padding; player, line and details share one column and its edges', () => {
    const css = WATCH_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    // the rules outside any container query (balanced braces)
    let top = ''
    for (let i = 0; i < css.length; ) {
      const at = css.indexOf('@container', i)
      if (at < 0) {
        top += css.slice(i)
        break
      }
      top += css.slice(i, at)
      let j = css.indexOf('{', at) + 1
      for (let depth = 1; depth && j < css.length; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0
      i = j
    }
    const rule = (sel: string) => {
      const m = top.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))
      if (!m) throw new Error(`no rule ${sel}`)
      return m[1]
    }
    // the only side padding is the page's: nothing below or beside the player has a width or margins of its own
    expect(rule('.PFX_watch-page')).toMatch(/padding:/)
    for (const sel of ['.PFX_watch-layout', '.PFX_watch-stage', '.PFX_watch-foot', '.PFX_watch-below', '.PFX_watch-next']) {
      expect(rule(sel), sel).not.toMatch(/(?:^|[\s;])(?:padding(?:-inline|-left|-right)?|margin(?:-inline|-left|-right)?):/)
    }
    // left-aligned in the section (never centered by auto margins)
    expect(rule('.PFX_watch-layout')).not.toMatch(/margin[^:;]*:[^;]*auto/)
    // the player sits at the start of its column (not centered): its left edge is the details' left edge
    expect(rule('.PFX_watch-stage')).toMatch(/justify-content: flex-start/)
    // narrow: one column, the queue under the player (and its line)
    expect(rule('.PFX_watch-layout')).toMatch(/grid-template-areas:\s*'player'\s*'foot'\s*'next'\s*'below'/)
    // wide: the queue is a column of its own from the top, beside the player and the details
    const wide = css.split('@container').find((b) => /min-width: 820px/.test(b.slice(0, 60)))!
    expect(wide).toMatch(/grid-template-areas:\s*'player next'\s*'foot next'\s*'below next'/)
    expect(css).not.toMatch(/PFX_watch-(band|top)\b/)
  })

  it('catalog rule 8: no raw iframe/webview, no window.hermesDesktop, no reading of the app markup', () => {
    const files = [...listRepoFiles('desktop-src/pages/watch', ['.ts', '.tsx']), 'desktop-src/lib/player.ts']
    for (const f of files) {
      const code = readRepoFile(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      // (the only selector is the one of the stylesheet's own <style>, in styles.ts)
      expect(code, f).not.toMatch(/<iframe|<webview|['"]iframe['"]|['"]webview['"]|hermesDesktop|data-slot|aui_|\.closest\(|MutationObserver/)
    }
  })
})

// ------------------------------------------------------------------ item 2: the click on the card

const TAB: Tab = {
  id: 'tab_sci',
  name: 'Ciência',
  kind: 'category',
  rules: {
    include: { folders: [FOLDER.id], tags: [], channels: [], themes: [], lenses: [], all: false, favorites: false },
    exclude: { folders: [], tags: [], channels: [], shorts: false },
    filters: { only_new: false, per_channel: null, min_s: null, max_s: null },
    mode: 'fresh'
  },
  icon: null,
  filters: {},
  sort: 0,
  builtin: false
}

function homeRoutes(): void {
  routes['GET /tabs'] = () => ({ items: [TAB] })
  routes['GET /status'] = () => ({
    new_total: 3,
    new_by_tab: [],
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
  })
  routes['GET /channels'] = () => ({ items: [], total: 40 })
  routes['GET /feed'] = () => ({ items: LIST.slice(0, 4), next_cursor: null, counts: { total: 4, new: 4 } })
}

const cardTitle = (root: ParentNode, id: string) => q(root, `[data-part="card"][data-video="${id}"] [data-open-video]`)

function auxclick(el: Element | null, button: number): void {
  act(() => {
    el?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button }))
  })
}

function modClick(el: Element | null, init: MouseEventInit): void {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }))
  })
}

describe('openVideo: where the click goes', () => {
  it('default "In Hermes" (the app supports it): opens the section, nothing outside', () => {
    expect(getOpenMode()).toBe('hermes')
    openVideo(IDS[0], { item: LIST[0] })
    expect($watch.get()?.id).toBe(IDS[0])
    expect(sdkMock.openedExternal).toEqual([])
  })

  it('"On YouTube" chosen (saved in ctx.storage): opens outside', () => {
    setOpenMode('youtube')
    expect(handle.storage.get(OPEN_MODE_KEY)).toBe('youtube')
    openVideo(IDS[0], { item: LIST[0] })
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[0])])
    expect(sdkMock.workspaceOpens).toEqual([])
  })

  it('a preference saved before (another session) applies', () => {
    handle.storage.set(OPEN_MODE_KEY, 'youtube')
    expect(getOpenMode()).toBe('youtube')
  })

  it('an odd saved value falls back to the default', () => {
    handle.storage.set(OPEN_MODE_KEY, 42)
    expect(getOpenMode()).toBe('hermes')
  })

  it('without the Watch screen registered: the click keeps opening YouTube', () => {
    setWatchRenderer(null)
    openVideo(IDS[0], { item: LIST[0] })
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[0])])
  })

  it('with a plugin dialog open (topic tab list): outside — the tab would open hidden behind the dialog', () => {
    openDialog('theme', {})
    openVideo(IDS[0], { item: LIST[0] })
    closeAllDialogs()
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[0])])
    expect(sdkMock.workspaceOpens).toEqual([])
  })
})

describe('VideoCard: click → section; ⌘/Ctrl+click and middle button → YouTube', () => {
  it('a click on the title opens the section with the card\'s item (no refetch)', async () => {
    const v = render(<VideoCard item={LIST[0]} />)
    click(cardTitle(v.container, IDS[0]))
    await flush()
    expect($watch.get()?.id).toBe(IDS[0])
    expect($watch.get()?.item?.video.id).toBe(IDS[0])
    expect(sdkMock.openedExternal).toEqual([])
  })

  it('⌘+click, Ctrl+click and middle button: YouTube; right button: nothing', () => {
    const v = render(<VideoCard item={LIST[0]} />)
    modClick(cardTitle(v.container, IDS[0]), { metaKey: true })
    modClick(cardTitle(v.container, IDS[0]), { ctrlKey: true })
    auxclick(cardTitle(v.container, IDS[0]), 1)
    auxclick(cardTitle(v.container, IDS[0]), 2)
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[0]), youtubeWatchUrl(IDS[0]), youtubeWatchUrl(IDS[0])])
    expect(sdkMock.workspaceOpens).toEqual([])
  })
})

describe('Subscriptions: the click carries the tab\'s list into "Up next"', () => {
  it('Subscriptions card (every density) → section with the list in screen order and the tab name', async () => {
    homeRoutes()
    for (const density of ['comfortable', 'compact', 'list'] as const) {
      const v = render(<HomeView initialTab={TAB.id} initialDensity={density} />)
      await flush(12)
      click(cardTitle(v.container, IDS[1]))
      const st = $watch.get()
      expect(st?.id, density).toBe(IDS[1])
      expect(st?.source).toBe('Ciência')
      expect(st?.list.map((it) => it.video.id)).toEqual(IDS.slice(0, 4))
      v.unmount()
    }
    expect(sdkMock.openedExternal).toEqual([])
  })

  it('Enter in the grid also opens the section; ⌘+click opens outside', async () => {
    homeRoutes()
    const v = render(<HomeView initialTab={TAB.id} initialDensity="compact" />)
    await flush(12)
    const cell = q(v.container, '[role="gridcell"][tabindex="0"]')!
    keydown(cell, 'Enter')
    expect($watch.get()?.id).toBe(IDS[0])
    modClick(cardTitle(v.container, IDS[2]), { metaKey: true })
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[2])])
  })

  it('"Open videos: In Hermes | On YouTube" setting in the Subscriptions bar (same mechanism as the density)', async () => {
    homeRoutes()
    const v = render(<HomeView initialTab={TAB.id} initialDensity="list" />)
    await flush(12)
    const group = q(v.container, '[data-part="open-mode"]')!
    expect(group).not.toBeNull()
    expect(q(group, '[data-mode="hermes"]')?.getAttribute('aria-pressed')).toBe('true')
    click(q(group, '[data-mode="youtube"]'))
    expect(handle.storage.get(OPEN_MODE_KEY)).toBe('youtube')
    expect(q(v.container, '[data-part="open-mode"] [data-mode="youtube"]')?.getAttribute('aria-pressed')).toBe('true')
    click(cardTitle(v.container, IDS[0]))
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[0])])
  })

  it('without the Watch screen: the setting does not even show', async () => {
    setWatchRenderer(null)
    const v = render(<OpenModeSwitch />)
    expect(v.container.innerHTML).toBe('')
  })
})

describe('chat: the card opens the section; "Open on YouTube" goes outside', () => {
  it('card title → section; button/o key → YouTube', async () => {
    const v = render(<ChatVideoCard attrs={{ id: IDS[0] }} />)
    await flush(8)
    click(cardTitle(v.container, IDS[0]))
    expect($watch.get()?.id).toBe(IDS[0])
    click(q(v.container, '[data-action="open"]'))
    keydown(q(v.container, `[data-chat-video="${IDS[0]}"]`)!, 'o')
    expect(sdkMock.openedExternal).toEqual([youtubeWatchUrl(IDS[0]), youtubeWatchUrl(IDS[0])])
  })

  it('a video the backend does not know (minimal card): the title also opens the section', async () => {
    const v = render(<ChatVideoCard attrs={{ id: 'zzzzzzzzzzz' }} />)
    await flush(8)
    click(q(v.container, '[data-chat-video="zzzzzzzzzzz"] [data-open-video]'))
    expect($watch.get()?.id).toBe('zzzzzzzzzzz')
    expect(sdkMock.openedExternal).toEqual([])
  })
})

describe('section: the same setting at hand', () => {
  it('"Open videos" shows in the section and changes the preference', async () => {
    watchVideo(IDS[0], { item: LIST[0] })
    const v = await mountTab()
    click(q(v.container, '[data-part="open-mode"] [data-mode="youtube"]'))
    expect(getOpenMode()).toBe('youtube')
  })
})

// ------------------------------------------------------------------ item 4: preview

describe('preview: a frame in place of the core player and the section scenarios', () => {
  it('preview MessageTextContent: 16:9 frame labeled "Hermes player" (no iframe)', async () => {
    const { MessageTextContent } = await import('../preview/sdk')
    const v = render(<MessageTextContent text={youtubeWatchUrl(IDS[0])} />)
    const frame = q(v.container, '[data-preview-player] > span')!
    expect(frame.style.aspectRatio.replace(/\s/g, '')).toBe('16/9')
    expect(v.text()).toContain('Hermes player')
    expect(v.container.querySelector('iframe')).toBeNull()
  })

  it('scenarios: section with Up next, watched, chat, outside the library, error and empty; 420/900/1440; no raw key', async () => {
    const { scenarios } = await import('../pages/watch/preview.scenarios')
    expect(scenarios.map((s) => s.id)).toEqual([
      'watch-tab',
      'watch-watched',
      'watch-larger',
      'watch-queue-end',
      'watch-queue-empty',
      'watch-chat',
      'watch-unknown',
      'watch-error',
      'watch-empty'
    ])
    const { installScenario } = await import('../preview/scenario')
    const expectPart: Record<string, string> = {
      'watch-tab': 'watch-next-item',
      'watch-watched': 'watch-title',
      'watch-larger': 'watch-larger',
      'watch-queue-end': 'watch-next-item',
      'watch-queue-empty': 'watch-next-empty',
      'watch-chat': 'watch-title',
      'watch-unknown': 'watch-unknown',
      'watch-error': 'watch-error',
      'watch-empty': 'watch-empty'
    }
    for (const sc of scenarios) {
      expect(sc.widths).toEqual([420, 900, 1440])
      const rt = installScenario(sc)
      const v = render(<>{sc.render()}</>)
      await flush(12)
      expect(q(v.container, `[data-part="${expectPart[sc.id]}"]`), sc.id).not.toBeNull()
      expect(v.text(), sc.id).not.toMatch(/\bwatch\.[a-z_]+\.[a-z_]+|\bcommon\.[a-z_]+\./)
      v.unmount()
      rt.dispose()
    }
  })
})
