// The panel becomes a tab that closes (without disabling the plugin) and comes back through a command and a button.
//
// What the core does with the contribution (read-only checkout of hermes-agent, apps/desktop/src):
//  - adoption: `components/pane-shell/tree/store.ts` `adoptContributedPanes` — anchor = `data.dock.pane` if it is in
//    the tree; otherwise the first pane with the same `placement`; otherwise the main one. Position `dock.pos ?? 'center'`.
//  - Close on a plugin pane with ONE pane just disables the plugin (`closeTreePane`); the SDK does not export
//    `registerPaneCloser`. A `hideOnly` pane has no close gesture (tree-group.tsx `closeableTab`, store.ts
//    `isHideOnlyPane`): the app offers Show/Hide (zone menu + automatic ⌘K) and never disables the plugin.
//  - `host.revealPane` undoes Close/Hide, opens the column and brings the tab to the front; `host.paneVisibility` is the
//    truth for "on screen" (in the tree, not hidden, zone not minimized, tab active, side not collapsed).
import type { ReactElement } from 'react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PANE_ID, PLUGIN_ID } from '../../shared/ids'
import { setPluginContext } from '../lib/ctx'
import { registerLocales } from '../lib/i18n'
import { PANE_TREE_ID, RIGHT_SIDEBAR_ACTION, hidePane, paneControlsAvailable, showPane, togglePane } from '../lib/pane-visibility'
import plugin from '../main'
import { DOCK_MIGRATION_KEY, PANE_SIZE, SHOW_PANE_COMMAND } from '../panes/contribution'
import enPanes from '../locales/en/panes.json'
import ptPanes from '../locales/pt-BR/panes.json'
import { PaneToggle } from '../pages/home'
import { click, flush, render } from './render'
import { type MockCtxHandle, createMockCtx, host, sdkMock, setPaneVisible } from './sdk-mock'
import { listRepoFiles, readRepoFile } from './repo.mjs'

let handle: MockCtxHandle
const byArea = (area: string) => handle.registrations.filter((r) => r.area === area)
const pane = () => byArea('panes').find((p) => p.id === PANE_ID)

function load(seed?: (h: MockCtxHandle) => void): MockCtxHandle {
  handle = createMockCtx(PLUGIN_ID)
  seed?.(handle)
  plugin.register(handle.ctx)
  return handle
}

beforeEach(() => {
  sdkMock.restHandler = () => new Promise(() => undefined)
})

describe('panel contribution', () => {
  it('is born as a tab in the Files group: placement right + dock center anchored on files', () => {
    load()
    const data = pane()?.data
    expect(data.placement).toBe('right')
    expect(data.dock).toMatchObject({ pane: 'files', pos: 'center' })
  })

  it('same width options as Files (the column does not change size when the panel joins)', () => {
    load()
    const data = pane()?.data
    expect(PANE_SIZE).toEqual({ width: '237px', minWidth: '10rem', maxWidth: '20rem' })
    expect({ width: data.width, minWidth: data.minWidth, maxWidth: data.maxWidth }).toEqual(PANE_SIZE)
    expect(data.collapsible).toBe(true)
  })

  it('closing does not disable the plugin: the panel is hideOnly (no ✕ that disables; the app\'s Hide/Show)', () => {
    load()
    const data = pane()?.data
    expect(data.hideOnly).toBe(true)
    expect(data.uncloseable).toBeUndefined()
  })

  it('the tab title follows the language (reactive tabTitle and tabTitleText for menus/drag)', async () => {
    load()
    const data = pane()?.data
    expect(data.tabTitleText()).toBe('Subscriptions')
    const view = render(data.tabTitle() as ReactElement)
    await flush()
    expect(view.text()).toBe('Subscriptions')
    act(() => sdkMock.locale.set('pt-br'))
    expect(view.text()).toBe('Inscrições')
    expect(data.tabTitleText()).toBe('Inscrições')
  })

  it('one-time migration: the first load repositions (enforce) and writes the mark; later loads never again', () => {
    load()
    expect(pane()?.data.dock.enforce).toBe(true)
    expect(handle.storage.get(DOCK_MIGRATION_KEY)).toBe(true)
    handle.dispose()

    load((h) => h.storage.set(DOCK_MIGRATION_KEY, true))
    expect(pane()?.data.dock).toEqual({ pane: 'files', pos: 'center' })
    expect(pane()?.data.dock.enforce).toBeUndefined()
  })

  it('the panel is not re-registered on a language change (re-registering would reopen adoption)', () => {
    load()
    const before = pane()
    act(() => sdkMock.locale.set('pt-br'))
    expect(pane()).toBe(before)
  })

  it('panel id in the app tree = <plugin>:<pane> (ctx.register adds the namespace)', () => {
    expect(PANE_TREE_ID).toBe(`${PLUGIN_ID}:${PANE_ID}`)
  })

  it('the old notice ("closing disables the plugin") exists in no language and not in the code', () => {
    expect('close_hint' in enPanes).toBe(false)
    expect('close_hint' in ptPanes).toBe(false)
    const code = listRepoFiles('desktop-src', ['.ts', '.tsx'])
      .filter((f: string) => !f.startsWith('desktop-src/test/') && !f.startsWith('desktop-src/types/'))
      .filter((f: string) => readRepoFile(f).includes('close_hint'))
    expect(code).toEqual([])
    for (const loc of listRepoFiles('desktop-src/locales', ['.json'])) {
      expect(readRepoFile(loc)).not.toMatch(/turns the plugin off|desliga o plugin/i)
    }
  })

  it('unload: no contribution is left behind', () => {
    load()
    expect(byArea('panes')).toHaveLength(1)
    handle.dispose()
    expect(handle.registrations).toEqual([])
  })
})

describe('palette command: show the panel', () => {
  it('EN and PT-BR with the plugin name; running it reveals the panel', () => {
    load()
    const cmd = byArea('palette').find((p) => p.id === SHOW_PANE_COMMAND)
    expect(cmd?.data.label).toBe('HermesTube: Show channels panel')
    expect(cmd?.data.id).toBe(`${PLUGIN_ID}.${SHOW_PANE_COMMAND}`)
    expect(cmd?.data.keywords).toEqual(expect.arrayContaining(['panel', 'painel']))
    cmd?.data.run()
    expect(sdkMock.paneReveals).toEqual([PANE_TREE_ID])
    act(() => sdkMock.locale.set('pt-br'))
    expect(byArea('palette').find((p) => p.id === SHOW_PANE_COMMAND)?.data.label).toBe('HermesTube: mostrar o painel de canais')
  })

  it('Desktop without host.revealPane: no command (nothing that would not work)', () => {
    host.revealPane = undefined
    load()
    expect(byArea('palette').find((p) => p.id === SHOW_PANE_COMMAND)).toBeUndefined()
  })
})

describe('show/hide through what the SDK exposes', () => {
  beforeEach(() => {
    handle = createMockCtx(PLUGIN_ID)
    setPluginContext(handle.ctx)
    registerLocales(handle.ctx)
  })

  it('show = host.revealPane on the tree id', () => {
    expect(paneControlsAvailable()).toBe(true)
    expect(showPane()).toBe(true)
    expect(sdkMock.paneReveals).toEqual([PANE_TREE_ID])
  })

  it('hide with the panel in the right column: one ⌘J (app action) is enough', () => {
    setPaneVisible(PANE_TREE_ID, true)
    sdkMock.actionHandler = () => {
      setPaneVisible(PANE_TREE_ID, false)
      return { ok: true }
    }
    expect(hidePane()).toBe('hidden')
    expect(sdkMock.actions).toEqual([RIGHT_SIDEBAR_ACTION])
  })

  it('hide when ⌘J opened Files instead of collapsing: the second one collapses the column', () => {
    setPaneVisible(PANE_TREE_ID, true)
    let n = 0
    sdkMock.actionHandler = () => {
      if (++n === 2) setPaneVisible(PANE_TREE_ID, false)
      return { ok: true }
    }
    expect(hidePane()).toBe('hidden')
    expect(sdkMock.actions).toEqual([RIGHT_SIDEBAR_ACTION, RIGHT_SIDEBAR_ACTION])
  })

  it('panel dragged out of the right column: undoes the ⌘J (twice = previous state) and explains', () => {
    setPaneVisible(PANE_TREE_ID, true)
    sdkMock.actionHandler = () => ({ ok: true })
    expect(hidePane()).toBe('elsewhere')
    expect(sdkMock.actions).toHaveLength(2)
    expect(sdkMock.notifications.at(-1)?.message).toBe(enPanes.toggle.elsewhere)
  })

  it('the app refuses the action: does not insist', () => {
    setPaneVisible(PANE_TREE_ID, true)
    expect(hidePane()).toBe('unavailable')
    expect(sdkMock.actions).toHaveLength(1)
  })

  it('toggle: off screen shows; on screen hides', () => {
    togglePane()
    expect(sdkMock.paneReveals).toEqual([PANE_TREE_ID])
    sdkMock.actionHandler = () => {
      setPaneVisible(PANE_TREE_ID, false)
      return { ok: true }
    }
    togglePane()
    expect(sdkMock.actions).toEqual([RIGHT_SIDEBAR_ACTION])
  })

  it('Home button: state follows the screen; off → shows, on → hides; tooltip and label say what it does', async () => {
    const view = render(<PaneToggle />)
    await flush()
    const btn = () => view.container.querySelector<HTMLButtonElement>('[data-part="pane-toggle"]')
    expect(btn()?.getAttribute('aria-pressed')).toBe('false')
    expect(btn()?.getAttribute('aria-label')).toBe(enPanes.toggle.show)
    expect(btn()?.getAttribute('data-tip')).toBe(enPanes.toggle.show)
    click(btn())
    expect(sdkMock.paneReveals).toEqual([PANE_TREE_ID])
    expect(btn()?.getAttribute('aria-pressed')).toBe('true')
    expect(btn()?.getAttribute('aria-label')).toBe(enPanes.toggle.hide)
    sdkMock.actionHandler = () => {
      setPaneVisible(PANE_TREE_ID, false)
      return { ok: true }
    }
    click(btn())
    expect(sdkMock.actions).toEqual([RIGHT_SIDEBAR_ACTION])
    expect(btn()?.getAttribute('aria-pressed')).toBe('false')
    // the user closed it through the app (tab, ⌘J, menu): the button follows
    act(() => setPaneVisible(PANE_TREE_ID, true))
    expect(btn()?.getAttribute('aria-pressed')).toBe('true')
  })

  it('Home button on an old Desktop: does not show', () => {
    host.paneVisibility = undefined
    const view = render(<PaneToggle />)
    expect(view.container.querySelector('[data-part="pane-toggle"]')).toBeNull()
  })

  it('old Desktop (no paneVisibility/revealPane): nothing available, nothing called', () => {
    host.paneVisibility = undefined
    host.revealPane = undefined
    expect(paneControlsAvailable()).toBe(false)
    expect(showPane()).toBe(false)
    expect(hidePane()).toBe('unavailable')
    expect(sdkMock.actions).toEqual([])
  })
})
