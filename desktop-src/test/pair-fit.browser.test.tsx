// @vitest-environment node
// (Chromium) The "Connect the browser extension" step fits a 1280×720 window (and so a 1440×900 one) without
// scrolling, in every state of the setup part: offered, folder ready, after the button, no bundled extension,
// and a failed folder check. Real layout: the preview scenarios with the plugin CSS over the app CSS, the dialog box
// held to the app's own limits. Skips without Playwright's Chromium. No network (file:// only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPreview, chromiumAvailable, removeTree, tempTree } from '../preview/node.mjs'
import { type DialogFit, measureDialogs } from './dialog-fit.mjs'

const SCENARIOS = ['onboarding-setup-offer', 'onboarding-setup-ready', 'onboarding-setup-done', 'onboarding-setup-manual', 'onboarding-setup-read-failed', 'onboarding-pair-code']
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 }
]

let root = ''
let fits: DialogFit[] = []

describe.skipIf(!chromiumAvailable())('pairing step fits without scrolling (Chromium)', () => {
  beforeAll(async () => {
    root = tempTree({ '.keep': '' })
    await buildPreview({ outdir: `${root}/out` })
    fits = await measureDialogs({ outdir: `${root}/out`, scenarios: SCENARIOS, viewports: VIEWPORTS, langs: ['en', 'pt'] })
  }, 600_000)

  afterAll(() => {
    if (root) removeTree(root)
  })

  it('every scenario mounted a dialog without JS errors', () => {
    expect(fits).toHaveLength(SCENARIOS.length * VIEWPORTS.length * 2)
    for (const f of fits) {
      expect(f.missing, `${f.id} ${f.width}×${f.height} ${f.lang}: no dialog`).toBeUndefined()
      expect(f.errors, `${f.id}: JS error`).toEqual([])
    }
  })

  it('two columns where the dialog is wide enough', () => {
    for (const f of fits) expect(f.columns, `${f.id} ${f.width}×${f.height} ${f.lang}`).toBe('2')
  })

  it.each(SCENARIOS)('%s: the body does not scroll and nothing useful sits below the fold', (id) => {
    for (const f of fits.filter((x) => x.id === id)) {
      const where = `${f.width}×${f.height} ${f.lang}: body ${f.bodyScroll}/${f.bodyClient}, box ${f.boxScroll}/${f.boxClient}`
      expect(f.bodyScroll, where).toBeLessThanOrEqual(f.bodyClient + 1)
      expect(f.boxScroll, where).toBeLessThanOrEqual(f.boxClient + 1)
      expect(f.boxTop, where).toBeGreaterThanOrEqual(0)
      expect(f.boxBottom, where).toBeLessThanOrEqual(f.viewport)
      expect(f.cut, where).toEqual([])
    }
  })
})
