#!/usr/bin/env node
// Public screenshots for the READMEs (docs/screenshots/*.png), taken from the desktop preview, and the app frames of
// the demo video.
//
//   node scripts/docs-screenshots.mjs                    → every image in SHOTS below
//   node scripts/docs-screenshots.mjs --only home,manage → just those (file name without .png)
//   node scripts/docs-screenshots.mjs --check            → no PNG written; only the text and network checks
//   node scripts/docs-screenshots.mjs --video <dir>      → the video frames (VIDEO_SHOTS, 1440×810 at 2×, light and
//                                                          dark) as <dir>/<name>.<theme>.png; <dir> must be outside
//                                                          the repository (the frames are not committed)
//
// Each image is one preview scenario (desktop-src/test/docs-screenshots/preview.scenarios.tsx: English UI, invented
// sample data from docs/sample-data/) opened in Chromium (the repository's Playwright) at 2× density, without the
// preview bar. Network: every request leaving the page is intercepted. Video thumbnails (i.ytimg.com) are answered with
// docs/sample-data/thumbs/<id>.jpg and channel avatars with an SVG of the channel's monogram; any other request is
// blocked and fails the capture with its URL, so nothing reaches YouTube or Google. At capture time the script scans
// the visible text of the page and fails if it finds Portuguese, placeholder text, internal ids, a real channel name
// (the built-in demo's list), YouTube product wording, a missing scenario route, a broken image, or if a label the
// image's alt text promises is not on screen (rules in desktop-src/test/docs-screenshots/capture.mjs). The report goes
// to $TMPDIR/docs-screenshots/ (never into the repository). The YouTube sidebar image comes from the extension
// harness instead:
//   EXT_DIST_DIR=$TMPDIR/ext-docs npx playwright test -c scripts/docs-sidebar.config.ts
// pngquant (optional) shrinks the public PNGs; without it they stay uncompressed.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SAMPLE_CATALOG, sampleAnswer, scanText } from '../desktop-src/test/docs-screenshots/capture.mjs'

export { SAMPLE_CATALOG, scanText }

const REPO_ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(REPO_ROOT, 'docs', 'screenshots')
const WORK_DIR = join(process.env.TMPDIR || tmpdir(), 'docs-screenshots')

/**
 * One entry per image. `scenario` = preview scenario id; `width`/`height` = viewport in CSS px;
 * `fullPage` = capture the whole document height; `clip` = crop to the union of the selectors' boxes plus `pad`;
 * `scrollToEnd` = an inner scroller (CSS selector) scrolled to its end before the capture;
 * `expect` = labels that must be inside the image (the alt text in the READMEs promises them);
 * `minImages` = loaded images (thumbnails and avatars) the page must show.
 */
export const SHOTS = [
  {
    name: 'home',
    scenario: 'docs-home',
    width: 1440,
    height: 900,
    minImages: 6,
    expect: ['All new', 'Favorites', 'Tech', 'Science', 'Cooking', 'Music', 'Nature', 'Wildlife Documentaries', 'New tab', 'Rebuilding a bench power supply from a dead transformer']
  },
  {
    name: 'new-tab-menu',
    scenario: 'docs-new-tab-menu',
    width: 1440,
    height: 900,
    minImages: 6,
    expect: ['Category', 'Channels', 'Topic', 'Mixed']
  },
  {
    name: 'folder-pane',
    scenario: 'docs-folder-pane',
    width: 320,
    height: 900,
    minImages: 18,
    expect: ['Tech', 'Science', 'Cooking', 'Music', 'Nature', 'Games', 'Bench Lamp Electronics', 'Tide Pool Statistics', 'Dusk Heron Hide', 'Late Night Roguelike Log']
  },
  {
    name: 'manage',
    scenario: 'docs-manage',
    width: 1440,
    height: 900,
    minImages: 12,
    expect: ['5 selected', 'Move to…', 'Add tag', 'Favorite', 'Mute', 'Mark as read', 'Bench Lamp Electronics']
  },
  {
    // the approval is "Review cancellation (n)" on the selection bar (confirmed in the next card)
    // the page is shorter than a 900 px window: a lower window, and the whole page
    name: 'cleanup',
    scenario: 'docs-cleanup',
    width: 1440,
    height: 640,
    fullPage: true,
    minImages: 3,
    expect: ['Not watched', 'Off your profile', '11 videos in 90 days, none watched', 'Late Night Roguelike Log', 'Felt Tray Almanac', 'Keep', 'Review cancellation (2)']
  },
  {
    // the dialog at its own width, with a little of the veil around it: the topic's name, the kept videos with
    // their channels and why each one fits
    name: 'theme-tab-preview',
    scenario: 'docs-topic-tab-preview',
    width: 1440,
    height: 900,
    clip: { selectors: ['[data-slot="dialog-content"]'], pad: 24 },
    minImages: 6,
    expect: ['New topic tab', 'Wildlife Documentaries', '14 videos', 'Full episode on Arctic wolves', 'Snowpatch Cameras', 'Save tab']
  },
  {
    name: 'watching-tab',
    scenario: 'docs-watching-tab',
    width: 1440,
    height: 900,
    minImages: 3,
    expect: ['A full winter with an Arctic wolf pack on the tundra', 'Snowpatch Cameras', 'Up next', 'Now playing', 'Open on YouTube']
  }
]

/** App frames of the demo video: 16:9, 1440×810 at 2×, each in the light and the dark theme. Not committed. */
export const VIDEO_SHOTS = [
  { name: 'home', scenario: 'docs-home', minImages: 6, expect: ['All new', 'Rebuilding a bench power supply from a dead transformer'] },
  { name: 'topic-tab', scenario: 'docs-topic-tab', minImages: 6, expect: ['Wildlife Documentaries', 'A full winter with an Arctic wolf pack on the tundra', 'Full episode on Arctic wolves'] },
  { name: 'topic-dialog', scenario: 'docs-topic-tab-preview', minImages: 4, expect: ['New topic tab', 'Wildlife Documentaries', 'Full episode on Arctic wolves'] },
  { name: 'manage', scenario: 'docs-manage', minImages: 12, expect: ['5 selected', 'Bench Lamp Electronics'] },
  { name: 'cleanup', scenario: 'docs-cleanup', minImages: 3, expect: ['Late Night Roguelike Log', 'Meeple Maintenance', 'Felt Tray Almanac', 'Review cancellation (2)'] },
  { name: 'player', scenario: 'docs-watching-tab', minImages: 3, expect: ['A full winter with an Arctic wolf pack on the tundra', 'Up next', 'Now playing'] }
].flatMap((s) => ['light', 'dark'].map((theme) => ({ ...s, name: `${s.name}.${theme}`, theme, width: 1440, height: 810 })))

function argOf(name) {
  const args = process.argv.slice(2)
  const i = args.indexOf(name)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : undefined
}

async function settle(page) {
  await page.waitForSelector('[data-preview-ready="true"]')
  // load lazy images: walk the page and every inner scroller, then go back to the top
  await page.evaluate(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 40))
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
      window.scrollTo(0, y)
      await wait()
    }
    window.scrollTo(0, 0)
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 1) continue
      for (let y = 0; y < el.scrollHeight; y += 300) {
        el.scrollTop = y
        await wait()
      }
      el.scrollTop = 0
    }
  })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForFunction(() => [...document.querySelectorAll('img')].every((i) => i.complete), null, { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(700)
}

/* Runs in the page: the captured region (page coordinates) — the viewport, the whole page, or the union of the
   `clip` selectors' boxes plus `pad`, inside the page. */
function regionOf({ fullPage, clip }) {
  const docW = document.documentElement.scrollWidth
  const docH = document.documentElement.scrollHeight
  if (!clip) return fullPage ? { x: 0, y: 0, width: docW, height: docH } : { x: 0, y: 0, width: innerWidth, height: innerHeight }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const sel of clip.selectors) {
    const el = document.querySelector(sel)
    if (!el) throw new Error(`clip: nothing matches ${sel}`)
    const r = el.getBoundingClientRect()
    x1 = Math.min(x1, r.left + scrollX)
    y1 = Math.min(y1, r.top + scrollY)
    x2 = Math.max(x2, r.right + scrollX)
    y2 = Math.max(y2, r.bottom + scrollY)
  }
  const pad = clip.pad ?? 0
  x1 = Math.max(0, Math.floor(x1 - pad))
  y1 = Math.max(0, Math.floor(y1 - pad))
  x2 = Math.min(docW, Math.ceil(x2 + pad))
  y2 = Math.min(docH, Math.ceil(y2 + pad))
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/* Runs in the page: visible text (rendered boxes only; `shot` = the part inside the captured region and not cut off
   by a scrolling or clipping ancestor), images (loaded and broken), routes the scenario lacked. */
function collect({ region, hidden }) {
  const visible = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  // the box an element's ancestors leave visible (overflow other than `visible` clips)
  const clipped = (el, r) => {
    let { left, top, right, bottom } = r
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const b = n.getBoundingClientRect()
      if (cs.overflowX !== 'visible') {
        left = Math.max(left, b.left)
        right = Math.min(right, b.right)
      }
      if (cs.overflowY !== 'visible') {
        top = Math.max(top, b.top)
        bottom = Math.min(bottom, b.bottom)
      }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top }
  }
  const inside = (r) =>
    r.width > 0 && r.height > 0 && r.right + scrollX > region.x && r.left + scrollX < region.x + region.width && r.bottom + scrollY > region.y && r.top + scrollY < region.y + region.height
  const all = []
  const shot = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim()
    if (!t || !n.parentElement || !visible(n.parentElement)) continue
    if (n.parentElement.closest(hidden)) continue
    all.push(t)
    const range = document.createRange()
    range.selectNodeContents(n)
    if ([...range.getClientRects()].some((r) => inside(clipped(n.parentElement, r)))) shot.push(t)
  }
  // values and placeholders of text fields are visible text too
  for (const el of document.querySelectorAll('input, textarea')) {
    if (!visible(el) || el.type === 'checkbox' || el.type === 'radio') continue
    const t = el.value || el.placeholder
    if (!t) continue
    all.push(t)
    if (inside(clipped(el, el.getBoundingClientRect()))) shot.push(t)
  }
  const imgs = [...document.querySelectorAll('img')].filter(visible)
  const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0)
  // the visible part of each loaded image inside the capture, in CSS px from the region's corner (for pixel checks)
  const boxes = loaded
    .map((i) => ({ src: i.src.replace(/^https:\/\/[^/]+/, ''), r: clipped(i, i.getBoundingClientRect()) }))
    .filter(({ r }) => inside(r))
    .map(({ src, r }) => ({ src, x: Math.round(r.left + scrollX - region.x), y: Math.round(r.top + scrollY - region.y), width: Math.round(r.width), height: Math.round(r.height) }))
  return {
    text: all.join('\n'),
    shotText: shot.join('\n'),
    images: { total: imgs.length, loaded: loaded.length, inShot: boxes.length, boxes, broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src) },
    missing: (window.__previewMissing && window.__previewMissing()) || [],
    crashed: !!document.querySelector('[data-preview-crash]')
  }
}

/**
 * Lossy palette compression with pngquant when it is installed (a 2× page with thumbnails is ~1.5 MB raw,
 * ~0.6 MB after). Without pngquant the raw PNG stays and the run says so. Returns whether it ran.
 */
function shrink(file) {
  const r = spawnSync('pngquant', ['--quality=70-95', '--speed', '1', '--strip', '--force', '--output', file, file], { encoding: 'utf8' })
  if (r.error || (r.status !== 0 && r.status !== 99)) {
    if (!warnedNoQuant) console.log('WARN pngquant not available or failed: PNGs stay uncompressed')
    warnedNoQuant = true
    return false
  }
  return r.status === 0
}
let warnedNoQuant = false

/** PNG width × height read from the IHDR chunk. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * Answers every request of the context from the sample data; anything else is aborted and kept in `blocked`.
 * Local files (the preview itself), data: and blob: go through.
 */
async function sampleNetwork(context, blocked, served) {
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (/^(file|data|blob):/.test(url)) return route.continue()
    const a = sampleAnswer(url)
    if (a.blocked) {
      blocked.push(a.blocked)
      return route.abort('blockedbyclient')
    }
    served.count++
    return route.fulfill({ status: a.status, contentType: a.contentType, body: a.body })
  })
}

async function main() {
  const videoDir = argOf('--video')
  const only = (argOf('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const checkOnly = process.argv.includes('--check')
  const all = videoDir ? VIDEO_SHOTS : SHOTS
  const shots = only.length ? all.filter((s) => only.includes(s.name) || only.includes(s.name.split('.')[0])) : all
  if (!shots.length) throw new Error(`no image matches --only ${only.join(',')}`)
  const outDir = videoDir ? resolve(videoDir) : OUT_DIR
  if (videoDir && (outDir === REPO_ROOT || outDir.startsWith(REPO_ROOT + sep))) {
    throw new Error(`--video ${videoDir}: choose a folder outside the repository (the video frames are not committed)`)
  }
  const pluginId = readFileSync(join(REPO_ROOT, 'shared', 'ids.ts'), 'utf8').match(/PLUGIN_ID\s*=\s*'([^']+)'/)?.[1] ?? ''
  // class prefix: the same as lib/style.ts (derived from PLUGIN_ID)
  const classPrefix = `${pluginId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-`

  const outdir = join(WORK_DIR, 'preview')
  mkdirSync(outdir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  const { buildPreview } = await import('../desktop-src/preview/node.mjs')
  await buildPreview({ outdir })
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const report = []
  let failed = 0
  try {
    for (const s of shots) {
      const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2 })
      const blocked = []
      const served = { count: 0 }
      await sampleNetwork(context, blocked, served)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const theme = s.theme ?? 'light'
      const url = `${pathToFileURL(join(outdir, 'index.html')).href}?scenario=${encodeURIComponent(s.scenario)}&theme=${theme}&lang=en&shot=1`
      await page.goto(url)
      await settle(page)
      if (s.scrollToEnd) {
        await page.locator(s.scrollToEnd).first().evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
        await page.waitForTimeout(500)
      }
      const region = await page.evaluate(regionOf, { fullPage: !!s.fullPage, clip: s.clip ?? null })
      // screen-reader-only text (the kit's `sr` class) is not in the image; aria-hidden text is drawn, so it counts
      const seen = await page.evaluate(collect, { region, hidden: `.${classPrefix}sr, .sr-only` })
      // the whole page must be clean; the promised labels must be inside the image
      const problems = [
        ...blocked.map((b) => `network: ${b}`),
        ...errors.map((e) => `JS error: ${e}`),
        ...seen.missing.map((m) => `scenario has no answer for ${m}`),
        ...(seen.crashed ? ['scenario crashed while rendering'] : []),
        ...seen.images.broken.map((src) => `image did not load: ${src}`),
        ...(seen.images.inShot < (s.minImages ?? 0) ? [`only ${seen.images.inShot} loaded image(s) in the image, expected at least ${s.minImages}`] : []),
        ...scanText(seen.text, { pluginId }),
        ...scanText(seen.shotText, { expect: s.expect }).filter((p) => p.startsWith('missing label'))
      ]
      const file = join(outDir, `${s.name}.png`)
      let size = null
      if (!checkOnly) {
        await page.screenshot({ path: file, type: 'png', fullPage: !!s.fullPage || !!s.clip, ...(s.clip ? { clip: region } : {}) })
        const raw = statSync(file).size
        const quantized = videoDir ? false : shrink(file)
        const buf = readFileSync(file)
        size = { ...pngSize(buf), bytes: statSync(file).size, raw, quantized }
      }
      failed += problems.length ? 1 : 0
      report.push({
        name: s.name,
        scenario: s.scenario,
        theme,
        url: url.slice(url.indexOf('?')),
        viewport: [s.width, s.height],
        region,
        size,
        images: { ...seen.images, servedFromSampleData: served.count },
        problems,
        textInImage: seen.shotText.split('\n')
      })
      const dims = size ? `${size.width}×${size.height} px, ${Math.round(size.bytes / 1024)} KB` : 'not written (--check)'
      console.log(`${problems.length ? 'FAIL' : 'OK  '} ${s.name}.png · ${s.scenario} · ${theme} · ${dims} · images ${seen.images.inShot}${problems.length ? `\n     ${problems.join('\n     ')}` : ''}`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
  mkdirSync(WORK_DIR, { recursive: true })
  const reportFile = join(WORK_DIR, videoDir ? 'video-report.json' : 'report.json')
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`${videoDir ? `video frames: ${outDir} · ` : ''}report: ${reportFile} · images with problems: ${failed}`)
  if (failed) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
