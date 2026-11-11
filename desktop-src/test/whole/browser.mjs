// (Chromium) LIVE width on an already mounted preview scenario: opens the scenario at one width,
// resizes the window through each container-query limit (the widths come from the CSS: limit +
// the window − container difference measured on the page) and, at each stop, compares the visible texts with the SAME
// scenario opened from scratch at that width. Text that shows on the born-at-that-width page and disappears on the resized one is the
// featured-card defect. The screenshot collector (takeShots) only opens new pages per width;
// this script is what was missing. No network: only file:// passes (thumbnails fall back to the placeholder, the layout does not change).
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const READY = '[data-preview-ready="true"]'

function urlOf(outdir, id) {
  return `${pathToFileURL(join(outdir, 'index.html')).href}?scenario=${encodeURIComponent(id)}&theme=light&lang=pt&shot=1`
}

async function offline(page) {
  await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()))
}

/* runs in the browser (no closures) */
function visibleTexts() {
  const root = document.querySelector('[data-preview-surface]')
  const out = []
  if (!root) return out
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // digits become # (clock, countdown): what is compared is that the text exists, not the number at that instant
    const text = (n.textContent || '').replace(/\s+/g, ' ').trim().replace(/\d/g, '#')
    if (!text) continue
    const el = n.parentElement
    if (!el) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const r = range.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    out.push(text)
  }
  return out.sort()
}

/* runs in the browser: window widths that make each named container cross each limit (each element
   with the name counts: the featured card and the grid ones have different widths) */
function crossings(limits) {
  const out = []
  const seen = new Set()
  const all = [...document.querySelectorAll('[data-preview-surface] *')]
  for (const { name, px } of limits) {
    for (const el of all) {
      if (!getComputedStyle(el).containerName.split(/\s+/).includes(name)) continue
      const delta = Math.round(window.innerWidth - el.getBoundingClientRect().width)
      const key = `${name}:${px}:${delta}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, px, below: px - 2 + delta, above: px + 2 + delta })
    }
  }
  return out
}

/** Settles: two frames, animations finished and images resolved (loaded or refused). */
async function settle(page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)))
    await frame()
    await frame()
    for (const a of document.getAnimations()) a.finish()
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && ![...document.images].every((i) => i.complete)) await new Promise((r) => setTimeout(r, 30))
    await new Promise((r) => setTimeout(r, 80))
    await frame()
  })
}

async function open(browser, outdir, id, width, errors, inject = null) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  page.on('pageerror', (e) => errors.push(`${width}px: ${String(e)}`))
  // only the negative proof uses it: a defect that exists only after resizing (the born page does not run it)
  if (inject) await page.addInitScript(inject)
  await offline(page)
  await page.goto(urlOf(outdir, id))
  await page.waitForSelector(READY)
  await settle(page)
  return page
}

function diff(a, b) {
  const rest = [...b]
  const out = []
  for (const x of a) {
    const i = rest.indexOf(x)
    if (i >= 0) rest.splice(i, 1)
    else out.push(x)
  }
  return out
}

/**
 * For each scenario: widths that cross the limits present on the page; resizes live (down and
 * up) and compares with the page born at each width. Returns the differences per stop.
 */
export async function liveResize({ outdir, scenarios, limits, minWidth = 320, maxWidth = 2400, maxStops = Infinity, inject = null }) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  // scenarios in parallel (one tab each); within a scenario, the sweep is serial
  const one = async (id) => {
    const errors = []
    const live = await open(browser, outdir, id, maxWidth, errors, inject)
    const cross = await live.evaluate(crossings, limits)
    // no named container on the page (simple dialog): crosses the limits as window widths
    const raw = cross.length ? cross.flatMap((c) => [c.above, c.below]) : limits.flatMap((l) => [l.px + 2, l.px - 2])
    const stops = [...new Set(raw)].filter((w) => w >= minWidth && w <= maxWidth).sort((a, b) => b - a).slice(0, maxStops)
    const path = [...stops, ...stops.slice(0, -1).reverse()]
    const fresh = new Map()
    const report = []
    for (const width of path) {
      await live.setViewportSize({ width, height: 900 })
      await settle(live)
      const now = await live.evaluate(visibleTexts)
      if (!fresh.has(width)) {
        const page = await open(browser, outdir, id, width, errors)
        fresh.set(width, await page.evaluate(visibleTexts))
        await page.close()
      }
      const born = fresh.get(width)
      report.push({ width, vanished: diff(born, now), extra: diff(now, born), texts: now.length, born: born.length })
    }
    await live.close()
    return { id, crossings: cross, stops: report, errors }
  }
  try {
    return await Promise.all(scenarios.map(one))
  } finally {
    await browser.close()
  }
}
