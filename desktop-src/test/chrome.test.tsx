// Status bar chip and ⌘K commands.
// Chip: loading, new (accent), true zero (subtle), refreshing, and ERROR ≠ 0 (plugin missing
// in this profile, no connection, contract error) — the early finding ("▶ 0 new" with the request failing) must not
// come back. Mascot without a bubble → ⭐ on the chip. ⌘K: order, labels and final icons in both languages,
// each command does what it says, "Refresh now" gives feedback. EN = PT-BR keys.
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StatusResponse } from '../../shared/api-types'
import { DESKTOP_ROUTES, DIALOG_IDS, PALETTE_COMMANDS, PLUGIN_ID } from '../../shared/ids'
import { StatusChip, chipState, failureKind, paletteCommands, paletteContribution } from '../chrome'
import { EXTRAS_PAGE_READY } from '../lib/extras'
import enChrome from '../locales/en/chrome.json'
import ptChrome from '../locales/pt-BR/chrome.json'
import { setPluginContext } from '../lib/ctx'
import { $dialogStack } from '../lib/dialogs'
import { registerLocales } from '../lib/i18n'
import { $petFallback, sayToPet } from '../lib/pet'
import { TubeApiError } from '../lib/rest'
import { $status } from '../lib/status'
import { click, flush, render } from './render'
import { listRepoFiles, readRepoFile } from './repo.mjs'
import { createMockCtx, queryClient, sdkMock } from './sdk-mock'

const NOW_S = Math.floor(Date.now() / 1000)

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    new_total: 12,
    new_by_tab: [],
    fav_new: [],
    ext_endpoint_up: true,
    last_rss_at: NOW_S - 180,
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

type Handler = (path: string, opts?: Record<string, unknown>) => unknown

function backend(statusFn: () => unknown, extra: Handler = () => ({ ok: true, data: { result: 'started' } })): void {
  sdkMock.restHandler = (path, opts) => (path.startsWith('/status') ? statusFn() : extra(path, opts))
}

const ok = (data: unknown) => ({ ok: true, data })

let handle: ReturnType<typeof createMockCtx>

beforeEach(() => {
  handle = createMockCtx(PLUGIN_ID)
  setPluginContext(handle.ctx)
  registerLocales(handle.ctx)
})

async function mountChip() {
  const view = render(<StatusChip />)
  await flush(8)
  return view
}

const chip = (root: ParentNode) => root.querySelector<HTMLElement>('[data-status-chip]')
const stateOf = (root: ParentNode) => chip(root)?.getAttribute('data-state')
const button = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-part="baritem"]')

describe('chip: estados', () => {
  it('loading: never shows a number (not even 0)', async () => {
    backend(() => new Promise(() => undefined))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('loading')
    expect(view.text()).not.toMatch(/\d/)
  })

  it('with new videos: accent count + label; clicking opens Subscriptions', async () => {
    backend(() => ok(status({ new_total: 12 })))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('new')
    expect(view.container.querySelector('[class$="baritem-count"]')?.textContent).toBe('12')
    expect(view.text()).toContain('12')
    expect(view.text()).toContain(enChrome.chip.new_other)
    expect(button(view.container)?.getAttribute('title')).toContain('12')
    click(button(view.container))
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home])
  })

  it('1 new: singular (the language\'s plural rule)', async () => {
    sdkMock.locale.set('pt-br')
    backend(() => ok(status({ new_total: 1 })))
    const view = await mountChip()
    expect(view.text()).toContain(ptChrome.chip.new_one)
    expect(view.text()).not.toContain(ptChrome.chip.new_other)
  })

  it('true zero: subtle (no accent count)', async () => {
    backend(() => ok(status({ new_total: 0 })))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('zero')
    expect(view.container.querySelector('[class$="baritem-count"]')).toBeNull()
    expect(view.text()).toContain(enChrome.chip.none)
  })

  it('refreshing: indicator, keeping the count that already exists', async () => {
    backend(() => ok(status({ new_total: 4, refresh_running: true })))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('refreshing')
    expect(view.text()).toContain('4')
    expect(view.text()).toContain(enChrome.chip.refreshing)
  })

  it('error: plugin missing in this profile (404) → "—" with the reason, NEVER 0', async () => {
    backend(() => Promise.reject(new Error("Error invoking remote method 'hermes:api': Error: 404: Not Found")))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('error')
    expect(chip(view.container)?.getAttribute('data-reason')).toBe('unavailable')
    expect(view.text()).toContain('—')
    expect(view.text()).not.toMatch(/\b0\b/)
    expect(button(view.container)?.getAttribute('title')).toContain(enChrome.chip.reason_unavailable.replace('{profile}', 'default'))
  })

  it('error: no connection → its own reason', async () => {
    backend(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9119')))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('error')
    expect(chip(view.container)?.getAttribute('data-reason')).toBe('offline')
    expect(button(view.container)?.getAttribute('title')).toContain(enChrome.chip.reason_offline)
    expect(view.text()).not.toMatch(/\d/)
  })

  it('contract error (envelope ok:false) → "—" with the error text', async () => {
    backend(() => ({ ok: false, error: { code: 'busy', message: 'locked' } }))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('error')
    expect(chip(view.container)?.getAttribute('data-reason')).toBe('error')
    expect(view.text()).not.toMatch(/\d/)
  })

  it('a query that fails AFTER a success neither keeps the old number nor becomes 0', async () => {
    let fail = false
    backend(() => (fail ? Promise.reject(new Error('fetch failed')) : ok(status({ new_total: 7 }))))
    const view = await mountChip()
    expect(stateOf(view.container)).toBe('new')
    fail = true
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await flush()
    expect(stateOf(view.container)).toBe('error')
    expect(view.text()).not.toContain('7')
    expect(view.text()).not.toMatch(/\b0\b/)
  })

  it('mascot without a bubble: ⭐ on the chip with the speech in the tooltip; clicking clears it', async () => {
    backend(() => ok(status({ new_total: 3 })))
    sdkMock.petVisible.set(false)
    sayToPet({ id: 'fav', text: 'Veritasium posted a new video' })
    const view = await mountChip()
    expect(view.container.querySelector('[data-icon="star-full"]')).not.toBeNull()
    expect(button(view.container)?.getAttribute('title')).toContain('Veritasium posted a new video')
    click(button(view.container))
    expect($petFallback.get()).toBeNull()
  })

  it('em PT-BR', async () => {
    sdkMock.locale.set('pt-br')
    backend(() => ok(status({ new_total: 12 })))
    const view = await mountChip()
    expect(view.text()).toContain(ptChrome.chip.new_other)
  })
})

describe('chipState / failureKind (pure)', () => {
  it('an error wins over old data; no data and no error = loading', () => {
    expect(chipState({ data: undefined, error: null }).kind).toBe('loading')
    expect(chipState({ data: status({ new_total: 5 }), error: new Error('x') }).kind).toBe('error')
    expect(chipState({ data: status({ new_total: 0 }), error: null }).kind).toBe('zero')
    expect(chipState({ data: status({ new_total: 2, refresh_running: true }), error: null })).toMatchObject({ kind: 'refreshing', count: 2 })
  })

  it('classifies the failure', () => {
    expect(failureKind(new TubeApiError({ code: 'internal', message: '404: Not Found' }, true))).toBe('unavailable')
    expect(failureKind(new TubeApiError({ code: 'plugin_disabled', message: 'off' }))).toBe('unavailable')
    expect(failureKind(new TubeApiError({ code: 'internal', message: 'Hermes desktop bridge unavailable' }, true))).toBe('offline')
    expect(failureKind(new TubeApiError({ code: 'internal', message: 'socket hang up' }, true))).toBe('offline')
    expect(failureKind(new TubeApiError({ code: 'busy', message: 'locked' }))).toBe('error')
  })
})

// ------------------------------------------------------------------ ⌘K

describe('⌘K', () => {
  const ORDER = [
    PALETTE_COMMANDS.openHome,
    PALETTE_COMMANDS.refreshNow,
    PALETTE_COMMANDS.newThemeTab,
    PALETTE_COMMANDS.organize,
    PALETTE_COMMANDS.cleanup,
    ...(EXTRAS_PAGE_READY ? [PALETTE_COMMANDS.openExtras] : [])
  ]

  it('final order, one per PALETTE_COMMANDS, all with an icon and a label in both languages', () => {
    const cmds = paletteCommands()
    expect(cmds.map((c) => c.id)).toEqual(ORDER)
    // Extras only becomes a command when the page exists
    const expected = Object.values(PALETTE_COMMANDS).filter((c) => c !== PALETTE_COMMANDS.openExtras || EXTRAS_PAGE_READY)
    expect([...ORDER].sort()).toEqual(expected.sort())
    const en = cmds.map((c) => c.label())
    for (const l of en) expect(l).not.toMatch(/^chrome\./)
    act(() => sdkMock.locale.set('pt-br'))
    const pt = paletteCommands().map((c) => c.label())
    for (let i = 0; i < pt.length; i++) {
      expect(pt[i]).not.toMatch(/^chrome\./)
      expect(pt[i]).not.toBe(en[i])
    }
    for (const c of cmds) {
      expect(c.icon).toBeTruthy()
      // words from both languages, whatever the active language
      expect(c.keywords.length).toBeGreaterThan(2)
    }
    const home = cmds[0]
    expect(home.keywords).toEqual(expect.arrayContaining(['youtube', 'inscrições', 'subscriptions']))
  })

  it('the original labelKey is still valid (main.tsx still reads common.palette.*)', () => {
    for (const c of paletteCommands()) expect(c.labelKey).toMatch(/^palette\./)
  })

  it('paletteContribution: the shape of the SDK\'s PaletteContribution', () => {
    const data = paletteContribution(paletteCommands()[0])
    expect(data.id).toBe(`${PLUGIN_ID}.${PALETTE_COMMANDS.openHome}`)
    expect(typeof data.label).toBe('string')
    expect(typeof data.run).toBe('function')
    expect(data.icon).toBeTruthy()
  })

  it('each command does what it says', async () => {
    const run = (id: string) => paletteCommands().find((c) => c.id === id)?.run()
    run(PALETTE_COMMANDS.openHome)
    run(PALETTE_COMMANDS.cleanup)
    run(PALETTE_COMMANDS.openExtras)
    expect(sdkMock.navigations).toEqual([DESKTOP_ROUTES.home, DESKTOP_ROUTES.cleanup, ...(EXTRAS_PAGE_READY ? [DESKTOP_ROUTES.extras] : [])])
    act(() => run(PALETTE_COMMANDS.newThemeTab))
    expect($dialogStack.get().at(-1)?.id).toBe(DIALOG_IDS.theme)
    act(() => run(PALETTE_COMMANDS.organize))
    expect($dialogStack.get().at(-1)?.id).toBe(DIALOG_IDS.organize)
    expect(sdkMock.navigations.slice(EXTRAS_PAGE_READY ? 3 : 2)).toEqual([DESKTOP_ROUTES.home, DESKTOP_ROUTES.manage])
  })

  it('Refresh now: POST /refresh {force} and visible feedback (notice + detail)', async () => {
    const posted: unknown[] = []
    backend(
      () => ok(status()),
      (path, opts) => {
        posted.push([path, opts?.method, opts?.body])
        return ok({ result: 'started' })
      }
    )
    const cmd = paletteCommands().find((c) => c.id === PALETTE_COMMANDS.refreshNow)!
    cmd.run()
    await flush()
    expect(posted).toEqual([['/refresh', 'POST', { force: true }]])
    expect(sdkMock.notifications.at(-1)).toMatchObject({ kind: 'info', message: enChrome.refresh.started })
    // live detail: refreshing → count
    $status.set(status({ refresh_running: true }))
    expect(cmd.detail?.()).toBe(enChrome.detail.refreshing)
    $status.set(status({ new_total: 12 }))
    expect(cmd.detail?.()).toContain('12')
    $status.set(null)
    expect(cmd.detail?.()).toBe('')
  })

  it('Refresh now: already running / up to date / failure', async () => {
    let result: unknown = ok({ result: 'running' })
    backend(() => ok(status()), () => result)
    const cmd = paletteCommands().find((c) => c.id === PALETTE_COMMANDS.refreshNow)!
    cmd.run()
    await flush()
    expect(sdkMock.notifications.at(-1)?.message).toBe(enChrome.refresh.running)
    result = ok({ result: 'skipped' })
    cmd.run()
    await flush()
    expect(sdkMock.notifications.at(-1)?.message).toBe(enChrome.refresh.skipped)
    result = Promise.reject(new Error('connect ECONNREFUSED'))
    cmd.run()
    await flush()
    expect(sdkMock.notifications.at(-1)?.kind).toBe('error')
  })
})

// ------------------------------------------------------------------ text

type Leaf = { [k: string]: Leaf | string | string[] }
function leafKeys(tree: Leaf, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'object' && !Array.isArray(v) ? leafKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
}

describe('chip and ⌘K text', () => {
  it('chrome.json: the same keys in EN and PT-BR, none empty', () => {
    const enKeys = leafKeys(enChrome as unknown as Leaf).sort()
    expect(enKeys.length).toBeGreaterThan(20)
    expect(leafKeys(ptChrome as unknown as Leaf).sort()).toEqual(enKeys)
    for (const tree of [enChrome, ptChrome] as unknown as Leaf[])
      for (const k of leafKeys(tree)) {
        let node: unknown = tree
        for (const p of k.split('.')) node = (node as Leaf)[p]
        expect(String(node).trim(), k).not.toBe('')
      }
  })

  it("every t('…')/tNow('chrome', '…') key used in chrome/ exists", () => {
    const enKeys = new Set(leafKeys(enChrome as unknown as Leaf))
    const files = listRepoFiles('desktop-src/chrome', ['.tsx', '.ts']).filter((f) => !f.endsWith('preview.scenarios.tsx'))
    const used = new Set<string>()
    for (const f of files) {
      const code = readRepoFile(f)
      for (const m of code.matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1])
      for (const m of code.matchAll(/\btNow\(\s*'chrome',\s*'([\w.-]+)'/g)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(10)
    expect([...used].filter((k) => !enKeys.has(k))).toEqual([])
  })
})
