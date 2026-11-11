// register(ctx): routes + menu (includes Extras), pane, chip, ⌘K, chat directive, dialogs and i18n
// are created complete; no network in register().
import type { ReactElement } from 'react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHAT_DIRECTIVE,
  DESKTOP_ROUTES,
  DIALOG_IDS,
  PALETTE_COMMANDS,
  PANE_ID,
  PLUGIN_ID,
  STATUS_CHIP_ID
} from '../../shared/ids'
import { maybePluginContext } from '../lib/ctx'
import { $dialogStack, DialogHost, openDialog } from '../lib/dialogs'
import { EXTRAS_PAGE_READY } from '../lib/extras'
import { NAMESPACES } from '../lib/i18n'
import { currentSection, showSection } from '../lib/nav'
import { watchVideo } from '../lib/player'
import plugin, { DIALOGS } from '../main'
import { SHOW_PANE_COMMAND } from '../panes/contribution'
import { CONNECT_COMMAND } from '../chrome'
import { mascotLines } from '../chat'
import { click, flush, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

const STATUS = {
  new_total: 2,
  new_by_tab: [],
  fav_new: [],
  ext_endpoint_up: true,
  last_rss_at: null,
  refresh_running: false,
  queue_pending: 0,
  search_pending: 0,
  devices_online: 0,
  ext_port: null,
  rss_down_since: null,
  rss_fallback_channels: 0
}

function genericBackend() {
  sdkMock.restHandler = (path) => {
    if (path.startsWith('/status')) return { ok: true, data: STATUS }
    if (path.startsWith('/extras'))
      return {
        ok: true,
        data: {
          honest_thumbnails: false,
          hn_lens: false,
          hn_channels: false,
          import_lists: false,
          hn_dataset_ready: false,
          hn_video_count: 0,
          hn_credit: ''
        }
      }
    if (path.startsWith('/refresh')) return { ok: true, data: { result: 'started' } }
    return { ok: true, data: { items: [] } }
  }
}

let handle: ReturnType<typeof createMockCtx>
const byArea = (area: string) => handle.registrations.filter((r) => r.area === area)

beforeEach(() => {
  genericBackend()
  handle = createMockCtx(PLUGIN_ID)
  plugin.register(handle.ctx)
})

describe('plugin', () => {
  it('id = PLUGIN_ID', () => {
    expect(plugin.id).toBe(PLUGIN_ID)
    expect(typeof plugin.name).toBe('string')
  })

  it('register does no network and no RPC', () => {
    expect(sdkMock.requests).toEqual([])
    expect(sdkMock.restCalls).toEqual([])
  })

  it('exactly one page route: the single HermesTube page (Manage, Cleanup, Extras and Watch are sections inside it)', () => {
    const routes = byArea('routes')
    expect(routes.map((r) => r.data.path)).toEqual([DESKTOP_ROUTES.home])
    expect(routes[0].title).toBe('HermesTube')
  })

  it('sidebar: a single entry, "HermesTube", leading to Subscriptions', () => {
    const nav = byArea('sidebar.nav')
    expect(nav).toHaveLength(1)
    expect(nav[0].data).toEqual({ path: DESKTOP_ROUTES.home, label: 'HermesTube', codicon: 'play-circle' })
    act(() => sdkMock.locale.set('pt-br'))
    expect(byArea('sidebar.nav').map((n) => n.data.label)).toEqual(['HermesTube'])
  })

  it('pane on the right with PANE_ID and a status bar chip with STATUS_CHIP_ID', () => {
    const pane = byArea('panes')
    expect(pane.map((p) => p.id)).toEqual([PANE_ID])
    expect(pane[0].data.placement).toBe('right')
    expect(pane[0].title).toBeTruthy()
    const chip = byArea('statusBar.right')
    expect(chip.map((c) => c.id)).toEqual([STATUS_CHIP_ID])
  })

  it('⌘K: one command per PALETTE_COMMANDS plus the connect and show-pane ones', () => {
    const palette = byArea('palette')
    const commands = [...Object.values(PALETTE_COMMANDS).filter((c) => c !== PALETTE_COMMANDS.openExtras || EXTRAS_PAGE_READY), CONNECT_COMMAND, SHOW_PANE_COMMAND]
    expect(palette.map((p) => p.id).sort()).toEqual(commands.sort())
    for (const p of palette) {
      expect(typeof p.data.run).toBe('function')
      expect(p.data.label).not.toMatch(/^common\./)
    }
  })

  it('⌘K commands open the single page at the right section (never another route), open dialogs or refresh', async () => {
    const run = (id: string) => byArea('palette').find((p) => p.id === id)?.data.run()
    run(PALETTE_COMMANDS.cleanup)
    expect(currentSection()).toBe('cleanup')
    run(PALETTE_COMMANDS.openHome)
    expect(currentSection()).toBe('home')
    if (EXTRAS_PAGE_READY) {
      run(PALETTE_COMMANDS.openExtras)
      expect(currentSection()).toBe('extras')
    }
    act(() => run(PALETTE_COMMANDS.newThemeTab))
    expect($dialogStack.get().at(-1)?.id).toBe(DIALOG_IDS.theme)
    expect(currentSection()).toBe('home')
    act(() => run(PALETTE_COMMANDS.organize))
    expect($dialogStack.get().at(-1)?.id).toBe(DIALOG_IDS.organize)
    expect(currentSection()).toBe('manage')
    // every command only brings the single page to the front (it mounts a DialogHost)
    expect(new Set(sdkMock.navigations)).toEqual(new Set([DESKTOP_ROUTES.home]))
    run(PALETTE_COMMANDS.refreshNow)
    await flush()
    expect(sdkMock.restCalls.map((c) => [c.path, c.opts?.method])).toContainEqual(['/refresh', 'POST'])
  })

  it('::tube-video directive in chat: a valid id becomes a card; junk renders nothing', () => {
    const directive = byArea('transcript.directives')
    expect(directive).toHaveLength(1)
    expect(directive[0].data.name).toBe(CHAT_DIRECTIVE)
    const ok = render(directive[0].data.render({ attrs: { id: 'dQw4w9WgXcQ' }, source: '', streaming: false, sessionId: null }))
    expect(ok.container.querySelector('img')?.getAttribute('src')).toContain('dQw4w9WgXcQ')
    const bad = render(directive[0].data.render({ attrs: { id: 'x"><script>' }, source: '', streaming: false, sessionId: null }))
    expect(bad.container.innerHTML).toBe('')
  })

  it('registers the locale bundles of every namespace (en and pt-BR)', () => {
    const bundles = sdkMock.i18nBundles.get(PLUGIN_ID) ?? {}
    for (const loc of ['en', 'pt-br']) {
      expect(Object.keys(bundles[loc] ?? {}).sort()).toEqual([...NAMESPACES].sort())
    }
  })

  it('labels follow the active language', () => {
    const before = byArea('palette').find((n) => n.id === PALETTE_COMMANDS.cleanup)?.data.label
    act(() => sdkMock.locale.set('pt-br'))
    const after = byArea('palette').find((n) => n.id === PALETTE_COMMANDS.cleanup)?.data.label
    expect(before).toBeTruthy()
    expect(after).toBeTruthy()
    expect(after).not.toBe(before)
  })

  it('each route, the pane and the chip render without breaking', async () => {
    const renders = [...byArea('routes'), ...byArea('panes'), ...byArea('statusBar.right')]
    for (const r of renders) {
      const view = render(r.render() as ReactElement)
      await flush()
      expect(view.container.innerHTML.length).toBeGreaterThan(0)
      view.unmount()
    }
  })

  it('status chip: the click also switches the single page to Subscriptions', async () => {
    showSection('cleanup')
    const chip = byArea('statusBar.right')[0]
    const view = render(chip.render() as ReactElement)
    await flush()
    click(view.container.querySelector('button'))
    expect(currentSection()).toBe('home')
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
  })

  it('opening a video opens the Watch section of the single page, never a center tab of its own', () => {
    expect(watchVideo('dQw4w9WgXcQ')).toBe(true)
    expect(currentSection()).toBe('watch')
    expect(sdkMock.workspaceOpens).toEqual([])
    expect(byArea('routes')).toHaveLength(1)
  })

  it('the dialog registry covers every DIALOG_IDS entry and each one opens', async () => {
    expect(Object.keys(DIALOGS).sort()).toEqual(Object.values(DIALOG_IDS).sort())
    const view = render(<DialogHost />)
    for (const id of Object.values(DIALOG_IDS)) {
      act(() => {
        if (id === 'create-tab') openDialog('create-tab', { channelIds: ['UCBJycsmduvYEL83R_U4JriQ'] })
        else openDialog(id, {})
      })
      await flush()
      expect(view.container.querySelector('[role="dialog"]')).not.toBeNull()
    }
  })

  it('minimal mascot: only announces a new video of a ⭐ channel, never on the first read', () => {
    const fav = (id: string | null) => ({
      ...STATUS,
      fav_new: [{ channel_id: 'UC1', title: 'Channel', count: 1, latest_video_id: id, latest_title: 'Video' }]
    })
    expect(mascotLines(null, fav('a'))).toEqual([])
    expect(mascotLines(fav('a'), fav('a'))).toEqual([])
    expect(mascotLines(fav('a'), fav('b'))).toEqual([{ id: 'fav:UC1', text: '⭐ Channel: Video' }])
  })

  it('unload clears the plugin context', () => {
    expect(maybePluginContext()).not.toBeNull()
    handle.dispose()
    expect(maybePluginContext()).toBeNull()
  })
})
