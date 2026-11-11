// Errors and absences the same for everyone, with the whole plugin mounted: `/status` failing, plugin
// turned off in the profile (`plugin_disabled` on every route), a route missing on this backend (transport 404, one at a
// time) and RPC unavailable (-32601). No screen throws; each shows the designed state; chip and pane do not
// enter a request loop (counted over 60 s of fake clock).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOB_POLL_MS, STATUS_POLL_MS } from '../../shared/ids'
import chromeEn from '../locales/en/chrome.json'
import cleanupEn from '../locales/en/cleanup.json'
import commonEn from '../locales/en/common.json'
import homeEn from '../locales/en/home.json'
import themeEn from '../locales/en/theme.json'
import { advance, click } from './render'
import { button } from './whole/dom'
import { DIALOG_SURFACES, PAGES, SURFACES, type SurfaceId, type WholePlugin, startPlugin } from './whole/mount'
import { cacheShapeProblems, probe } from './whole/probes'
import { World } from './whole/world'

const PLUGIN_OFF = commonEn.errors.plugin_disabled
const OPEN_DESKTOP = commonEn.open_desktop_backend
const CHIP_UNAVAILABLE = chromeEn.chip.unavailable_label

/** Cap of requests of ONE route in 60 s: the plugin's fastest poll (job/status) + a margin of 2. A loop = hundreds. */
const PER_ROUTE_60S = Math.ceil(60_000 / Math.min(STATUS_POLL_MS, JOB_POLL_MS)) + 2

let app: WholePlugin | null = null

/** A test that moves 60 s of fake clock or visits every screen (slow with the check running in parallel). */
const SLOW = 60_000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  app?.dispose()
  app = null
})

/** Mounts chip and pane and goes through every page and every dialog (like someone navigating). */
async function visitAll(a: WholePlugin, after?: (id: SurfaceId) => void) {
  await a.mount('chip')
  await a.mount('pane')
  after?.('chip')
  after?.('pane')
  for (const p of PAGES) {
    await a.mount(p)
    after?.(p)
  }
  for (const d of DIALOG_SURFACES) {
    await a.mount(`dialog:${d}`)
    after?.(`dialog:${d}`)
    a.unmount(`dialog:${d}`)
  }
}

function expectAlive(a: WholePlugin, id: SurfaceId) {
  const root = a.root(id)
  expect(root, `${id} mounted`).not.toBeNull()
  expect(root?.querySelector('[data-whole-crash]'), `${id} caiu`).toBeNull()
  expect(a.text(id).length, `${id} em branco`).toBeGreaterThan(0)
}

/** Requests per route within a `ms` window of fake clock, with chip + pane + Subscriptions mounted. */
async function requestsOver(a: WholePlugin, ms: number): Promise<Record<string, number>> {
  await a.mount('chip')
  await a.mount('pane')
  await a.mount('home')
  const start = a.world.calls.length
  for (let t = 0; t < ms; t += 1000) await advance(1000)
  const out: Record<string, number> = {}
  for (const c of a.world.calls.slice(start)) {
    const k = c.route ?? `${c.method} ${c.path}`
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function expectNoLoop(counts: Record<string, number>) {
  const over = Object.entries(counts).filter(([, n]) => n > PER_ROUTE_60S)
  expect(over, `teto ${PER_ROUTE_60S} por rota em 60 s`).toEqual([])
}

describe('/status failing', () => {
  const world = () => new World().fail('GET /status', { code: 'internal', message: 'database is locked' })

  it('no screen throws; the chip shows unavailable (no number), the rest keeps its data', async () => {
    app = startPlugin(world())
    await visitAll(app, (id) => {
      expectAlive(app as WholePlugin, id)
      if (id === 'chip') {
        expect(app?.text('chip')).toContain(CHIP_UNAVAILABLE)
        expect(app?.text('chip')).not.toMatch(/\d/)
      } else if (id === 'home') {
        // Subscriptions needs /status to know whether there are channels: says so in the subtitle and shows the tabs (designed)
        expect(app?.text('home')).toContain(homeEn.subtitle.status_error)
        expect(app?.text('home')).toContain(app?.world.tabs.find((x) => !x.builtin)?.name)
      } else {
        const r = probe(app as WholePlugin, id)
        expect(r.ok, `${id}: ${r.why}`).toBe(true)
      }
    })
    expect(app.errors).toEqual([])
  }, SLOW)

  it('chip and pane do not loop (60 s of clock)', async () => {
    app = startPlugin(world())
    const counts = await requestsOver(app, 60_000)
    expect(counts['GET /status']).toBeGreaterThan(0)
    expectNoLoop(counts)
  }, SLOW)
})

describe('plugin turned off in the profile (plugin_disabled on every route)', () => {
  const world = () => new World().everything({ code: 'plugin_disabled', message: 'plugin disabled in this profile' })

  it('each screen shows the designed error state; no false number; no exception', async () => {
    app = startPlugin(world())
    await visitAll(app, (id) => {
      const a = app as WholePlugin
      expectAlive(a, id)
      const root = a.root(id)
      const text = a.text(id)
      if (id === 'chip') {
        expect(text).toContain(CHIP_UNAVAILABLE)
        expect(text).not.toMatch(/\d/)
      } else if (id === 'pane' || id === 'home' || id === 'manage' || id === 'cleanup' || id === 'dialog:organize') {
        expect(root?.querySelector('[data-part="error"]'), `${id} without an error state: ${text.slice(0, 120)}`).not.toBeNull()
        expect(text).not.toMatch(/\b0\b/)
        if (id !== 'pane') expect(text).toContain(PLUGIN_OFF)
      }
      // off ≠ "no contact with the server": the two messages would contradict each other
      expect(text, `${id} with the server_down strip`).not.toContain(cleanupEn.banner.server_down)
    })
    expect(app.errors).toEqual([])
  }, SLOW)

  it('chip and pane do not loop (60 s of clock)', async () => {
    app = startPlugin(world())
    expectNoLoop(await requestsOver(app, 60_000))
  }, SLOW)
})

describe('route missing on this backend (transport 404, one at a time)', () => {
  const GET_ROUTES = new World().routeKeys().filter((r) => r.startsWith('GET '))

  it.each(GET_ROUTES)('without %s: no screen throws or goes blank', async (route) => {
    app = startPlugin(new World().transport(route))
    await visitAll(app, (id) => expectAlive(app as WholePlugin, id))
    expect(app.errors).toEqual([])
    // what was stored keeps the contract shape
    expect(cacheShapeProblems()).toEqual([])
  }, SLOW)

  it.each(['GET /status', 'GET /folders', 'GET /channels', 'GET /state', 'GET /tabs', 'GET /extras'])('without %s: chip and pane do not loop', async (route) => {
    app = startPlugin(new World().transport(route))
    expectNoLoop(await requestsOver(app, 60_000))
  }, SLOW)
})

describe('RPC unavailable (runtime.describe → -32601)', () => {
  const world = () => {
    const w = new World()
    w.rpc = 'unavailable'
    return w
  }

  it('the screens mount with data; asking for AI shows the designed notice (never waits for a job that does not exist)', async () => {
    app = startPlugin(world())
    await visitAll(app, (id) => {
      expectAlive(app as WholePlugin, id)
      const r = probe(app as WholePlugin, id)
      expect(r.ok, `${id}: ${r.why}`).toBe(true)
    })
    // Cleanup: scan again
    await app.mount('cleanup')
    click(button(app.root('cleanup'), cleanupEn.actions.scan))
    await app.settle()
    expect(app.text('cleanup')).toContain(OPEN_DESKTOP)
    // New topic tab: pick an idea and ask for the preview
    await app.mount('dialog:theme')
    click(button(app.root('dialog:theme'), themeEn.examples.ex1))
    click(app.root('dialog:theme')?.querySelector('[data-part="theme-primary"]') ?? null)
    await app.settle()
    expect(app.text('dialog:theme')).toContain(OPEN_DESKTOP)
    expect(app.world.rpcCalls.filter((m) => m !== 'runtime.describe')).toEqual([])
    expect(app.errors).toEqual([])
  }, SLOW)

  it('chip and pane do not loop (60 s of clock)', async () => {
    app = startPlugin(world())
    expectNoLoop(await requestsOver(app, 60_000))
  }, SLOW)
})

describe('sanity of the loop cap (negative proof)', () => {
  it('a real loop breaks the cap', () => {
    expect(() => expectNoLoop({ 'GET /status': PER_ROUTE_60S + 1 })).toThrow()
    expect(() => expectNoLoop({ 'GET /status': PER_ROUTE_60S })).not.toThrow()
    expect(SURFACES.length).toBeGreaterThan(5)
  })
})
