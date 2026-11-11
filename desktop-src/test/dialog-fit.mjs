// (Chromium) Does a preview scenario's dialog fit the window without scrolling? Opens the scenario at a given
// viewport, gives the dialog box the app's own limits (the app's `DialogContent`: centered, at most 85% of the window
// height, 16 px padding, 12 px between header and body — the preview's stand-in has no height limit) and measures the
// dialog body (`data-part="dialog-body"`, the part that scrolls) and the whole box. No network: only file:// passes.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const READY = '[data-preview-ready="true"]'

/** The app's dialog box limits (apps/desktop components/ui/dialog.tsx: `max-h-[85vh]`, `p-4`, `gap-3`). */
const HOST_DIALOG_CSS = `
[data-slot='dialog-content'] {
  position: fixed !important;
  left: 50% !important;
  top: 50% !important;
  margin: 0 !important;
  transform: translate(-50%, -50%) !important;
  max-height: 85vh !important;
  padding: 16px !important;
  gap: 12px !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}
`

function urlOf(outdir, id, lang) {
  return `${pathToFileURL(join(outdir, 'index.html')).href}?scenario=${encodeURIComponent(id)}&theme=light&lang=${lang}&shot=1`
}

/* runs in the browser (no closures) */
function measure() {
  const body = document.querySelector('[data-part="dialog-body"]')
  const box = document.querySelector('[data-slot="dialog-content"]')
  if (!body || !box) return null
  const r = box.getBoundingClientRect()
  const cut = []
  // useful content below the visible part of the body (what the fade would hide)
  const limit = body.getBoundingClientRect().bottom
  for (const el of body.querySelectorAll('button, [data-part="pair-live"], [data-part="pairing"]')) {
    const er = el.getBoundingClientRect()
    if (er.height > 0 && er.bottom > limit + 1) cut.push((el.textContent || el.getAttribute('data-part') || '').trim().slice(0, 40))
  }
  // side by side = the code column starts at the top of the setup column, to its right
  const side = document.querySelector('[data-part="pair-side"]')?.getBoundingClientRect()
  const main = document.querySelector('[data-part="pair-main"]')?.getBoundingClientRect()
  const columns = side && main ? (Math.abs(side.top - main.top) < 2 && main.left > side.right - 1 ? '2' : '1') : null
  return {
    columns,
    bodyScroll: body.scrollHeight,
    bodyClient: body.clientHeight,
    boxScroll: box.scrollHeight,
    boxClient: box.clientHeight,
    boxTop: Math.round(r.top),
    boxBottom: Math.round(r.bottom),
    viewport: window.innerHeight,
    cut
  }
}

/** For each scenario × viewport × language: the measurements (or `null` when the scenario has no dialog). */
export async function measureDialogs({ outdir, scenarios, viewports, langs = ['en'] }) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const one = async (id, viewport, lang) => {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()))
    await page.goto(urlOf(outdir, id, lang))
    await page.waitForSelector(READY)
    await page.addStyleTag({ content: HOST_DIALOG_CSS })
    await page.evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)))
      await new Promise((r) => setTimeout(r, 150))
      await frame()
      await frame()
    })
    const m = await page.evaluate(measure)
    await page.close()
    return { id, width: viewport.width, height: viewport.height, lang, errors, ...(m ?? { missing: true }) }
  }
  try {
    const jobs = []
    for (const id of scenarios) for (const v of viewports) for (const lang of langs) jobs.push(one(id, v, lang))
    return await Promise.all(jobs)
  } finally {
    await browser.close()
  }
}
