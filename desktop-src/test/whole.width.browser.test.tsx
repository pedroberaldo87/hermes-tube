// @vitest-environment node
// (Chromium) live width with real layout: an already mounted preview scenario is
// resized through each container-query limit of the CSS; at each stop, the visible texts
// must be the same as the scenario opened from scratch at that width. This is what the screenshot (born at the final width)
// did not catch: when the sidebar opened, the featured card crossed 620 px and title, description and actions
// disappeared. Skips without Playwright's Chromium. No network (file:// only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CLASS_PREFIX, CSS_TOKEN } from '../lib/style'
import { buildPreview, chromiumAvailable, removeTree, tempTree } from '../preview/node.mjs'
import { type ResizeReport, liveResize } from './whole/browser.mjs'
import { containerLimits } from './whole/widths'

/** Real scenarios of the screens under test (Subscriptions, Manage, Cleanup and the dialogs). */
const SCENARIOS = ['home-comfortable', 'manage-full', 'cleanup-full', 'onboarding-pair-code', 'organize-result', 'theme-form']

let root = ''
let outdir = ''
let limits: Array<{ name: string; px: number }> = []
let reports: ResizeReport[] = []

describe.skipIf(!chromiumAvailable())('live width in Chromium', () => {
  beforeAll(async () => {
    root = tempTree({ '.keep': '' })
    outdir = `${root}/out`
    await buildPreview({ outdir })
    limits = containerLimits().map((l) => ({ name: l.name.split(CSS_TOKEN).join(CLASS_PREFIX), px: l.px }))
    reports = await liveResize({ outdir, scenarios: SCENARIOS, limits })
  }, 600_000)

  afterAll(() => {
    if (root) removeTree(root)
  })

  it('each scenario mounted and the sweep crossed real limits', () => {
    expect(reports.map((r) => r.id)).toEqual(SCENARIOS)
    for (const r of reports) {
      expect(r.errors, `${r.id}: erro de JS`).toEqual([])
      expect(r.stops.length, `${r.id}: no stop (containers: ${JSON.stringify(r.crossings)})`).toBeGreaterThan(0)
    }
    // Subscriptions has the featured card (container `card`, 620 px limit) — the original case
    const home = reports.find((r) => r.id === 'home-comfortable')
    expect(home?.crossings.some((c) => c.name.endsWith('card') && c.px === 620)).toBe(true)
  })

  it('the detector catches text that disappears only after resizing (negative proof)', async () => {
    // synthetic defect of the same class as the original: on resize, the card titles lose their box
    const inject = `addEventListener('resize', () => { const s = document.createElement('style'); s.textContent = '[data-part="card"] [class*="card-title"] { display: none }'; document.head.append(s) })`
    const [r] = await liveResize({ outdir, scenarios: ['home-comfortable'], limits, maxStops: 2, inject })
    expect(r.stops.some((s) => s.vanished.length > 0)).toBe(true)
  }, 120_000)

  it.each(SCENARIOS)('%s: live-resized shows the same text as born at that width', (id) => {
    const r = reports.find((x) => x.id === id)
    // the defect is DISAPPEARING: text visible on the born-at-width page and invisible on the resized one. Extra text on the
    // resized one is expected where the Subscriptions infinite scroll already brought the 2nd page at the larger width.
    const bad = (r?.stops ?? []).filter((s) => s.vanished.length).map((s) => ({ width: s.width, vanished: s.vanished.slice(0, 8) }))
    expect(bad).toEqual([])
    expect(r?.stops.every((s) => s.texts > 0 && s.born > 0)).toBe(true)
  })
})
