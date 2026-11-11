// Preview, Node side: build (esbuild), screen scenario collector, copy of the app's real CSS and
// icon font, screenshots (Playwright) and an automatic audit of each screenshot (overflow, clipped text,
// contrast, layout shift, skeleton columns, weights per card, misplaced accent, missing route).
// CLI in build.mjs. The tests use the exported functions (types in node.d.mts).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { rawCssPlugin } from '../styles/esbuild-raw-css.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '..', '..')
const DESKTOP_SRC = join(REPO_ROOT, 'desktop-src')
const HOST_CSS = join(REPO_ROOT, 'ref', 'hermes-desktop', 'host-compiled.css')
const HERMES_SRC = process.env.HERMES_SRC || join(homedir(), '.hermes', 'hermes-agent')

export const DEFAULT_OUTDIR = join(process.env.TMPDIR || tmpdir(), 'preview')
export const SHOTS_DIR = join(REPO_ROOT, 'docs', 'design', 'shots')
export const WIDTHS = [360, 900, 1440]
export const THEMES = ['light', 'dark']
/** Name of the scenario file the collector discovers (outside preview/). */
export const SCENARIO_FILE = 'preview.scenarios.tsx'

const toPosix = (p) => p.split(sep).join('/')

// ------------------------------------------------------------------ file helpers (for the tests)

/** Creates a temporary tree `{ 'a/b.txt': 'content' }` under $TMPDIR; returns the root (with `/`). */
export function tempTree(files) {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tube-preview-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return toPosix(root)
}

export const removeTree = (p) => rmSync(p, { recursive: true, force: true })
export const readText = (p) => readFileSync(p, 'utf8')
export const listDir = (p) => (existsSync(p) ? readdirSync(p).sort() : [])

// ------------------------------------------------------------------ scenario collector

/** Finds `**\/preview.scenarios.tsx` under the roots (default desktop-src), outside `preview/`, `node_modules` and hidden folders. */
export function discoverScenarioFiles(roots = [DESKTOP_SRC]) {
  const out = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'preview' || name.startsWith('.')) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (name === SCENARIO_FILE) out.push(toPosix(p))
    }
  }
  for (const r of roots) walk(resolve(r))
  return [...new Set(out)].sort()
}

/** Swaps preview/scenarios.generated.ts for imports of the discovered files. */
function scenariosPlugin(files) {
  return {
    name: 'preview-scenarios',
    setup(b) {
      b.onLoad({ filter: /[\\/]preview[\\/]scenarios\.generated\.ts$/ }, () => {
        const lines = files.map((f, i) => `import * as s${i} from ${JSON.stringify(f)}`)
        const rel = (f) => (f.startsWith(toPosix(REPO_ROOT) + '/') ? f.slice(toPosix(REPO_ROOT).length + 1) : f)
        const list = files.map(
          (f, i) => `  { file: ${JSON.stringify(rel(f))}, scenarios: Array.isArray(s${i}.scenarios) ? s${i}.scenarios : [] }`
        )
        return {
          contents: `${lines.join('\n')}\nexport const SCENARIO_SOURCES = [\n${list.join(',\n')}\n]\n`,
          loader: 'ts',
          resolveDir: here,
          watchFiles: files
        }
      })
    }
  }
}

// ------------------------------------------------------------------ build

/** Finds the codicon font the app ships (read-only, outside the worktree). */
function findCodiconFont() {
  const candidates = [
    join(HERMES_SRC, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf'),
    join(HERMES_SRC, 'apps', 'desktop', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf')
  ]
  const pnpm = join(HERMES_SRC, '.build', 'webapp-workspace', 'node_modules', '.pnpm')
  if (existsSync(pnpm)) {
    for (const d of readdirSync(pnpm)) if (d.startsWith('@vscode+codicons@')) candidates.push(join(pnpm, d, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf'))
  }
  return candidates.find((p) => existsSync(p)) ?? null
}

function html({ hasHostCss }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview — visual language, kit and screen scenarios</title>
<!-- Preview outside the app. SDK controls = simple stand-ins over the tests' sdk-mock (desktop-src/preview/sdk.tsx).
     Layout, colors, typography and states = the plugin's real sheet (desktop-src/styles, mounted by lib/style.ts)
     over the app's real CSS (ref/hermes-desktop/host-compiled.css). Screen scenarios (?scenario=<id>) come from
     **/preview.scenarios.tsx, with fake in-memory rest/rpc (desktop-src/preview/scenario.ts). -->
${hasHostCss ? '<link rel="stylesheet" href="host-compiled.css">\n' : ''}<link rel="stylesheet" href="host-theme.css">
</head>
<body>
<div id="root"></div>
<script src="preview.js"></script>
</body>
</html>
`
}

/** Builds the preview in `outdir` (default $TMPDIR/preview), with the scenarios found in `scenarioRoots`. */
export async function buildPreview({ outdir = DEFAULT_OUTDIR, scenarioRoots } = {}) {
  mkdirSync(outdir, { recursive: true })
  const scenarioFiles = discoverScenarioFiles(scenarioRoots)
  await build({
    absWorkingDir: REPO_ROOT,
    entryPoints: [join(here, 'entry.mjs')],
    outfile: join(outdir, 'preview.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'react',
    minify: false,
    sourcemap: false,
    charset: 'utf8',
    // a single React (the project's), also for scenarios outside the repository (tests)
    alias: {
      '@hermes/plugin-sdk': join(here, 'sdk.tsx'),
      '@shared': join(REPO_ROOT, 'shared'),
      react: join(REPO_ROOT, 'node_modules', 'react'),
      'react-dom': join(REPO_ROOT, 'node_modules', 'react-dom')
    },
    // scenarios outside the repository (tests) resolve react & co. in the project's node_modules
    nodePaths: [join(REPO_ROOT, 'node_modules')],
    loader: { '.json': 'json' },
    plugins: [rawCssPlugin(), scenariosPlugin(scenarioFiles)],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning'
  })
  const files = ['index.html', 'preview.js', 'host-theme.css']
  copyFileSync(join(here, 'host-theme.css'), join(outdir, 'host-theme.css'))
  const hasHostCss = existsSync(HOST_CSS)
  if (hasHostCss) {
    copyFileSync(HOST_CSS, join(outdir, 'host-compiled.css'))
    files.push('host-compiled.css')
    const fontName = readFileSync(HOST_CSS, 'utf8').match(/url\(\.\/(codicon-[^)?"']+\.ttf)/)?.[1]
    const font = findCodiconFont()
    if (fontName && font) {
      copyFileSync(font, join(outdir, fontName))
      files.push(fontName)
    } else console.warn('WARNING preview: codicon font not found; icons stay blank')
  } else console.warn('WARNING preview: ref/hermes-desktop/host-compiled.css missing; preview without the app CSS')
  writeFileSync(join(outdir, 'index.html'), html({ hasHostCss }))
  // paths relative to the repository root when the file is in it; absolute outside (tests)
  const shown = scenarioFiles.map((f) => {
    const rel = toPosix(relative(REPO_ROOT, f))
    return rel.startsWith('..') ? f : rel
  })
  return { outdir, files, hasHostCss, scenarioFiles: shown }
}

/** For tests (synchronous): runs the CLI in a temporary folder and returns what was generated. */
export function runPreviewBuild() {
  const outdir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tube-d00-preview-'))
  const stdout = execFileSync(process.execPath, [join(here, 'build.mjs'), '--outdir', outdir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const files = readdirSync(outdir)
  return {
    outdir,
    stdout,
    files,
    hasHostCss: files.includes('host-compiled.css'),
    html: readFileSync(join(outdir, 'index.html'), 'utf8'),
    js: readFileSync(join(outdir, 'preview.js'), 'utf8')
  }
}

// ------------------------------------------------------------------ browser

/** Is Playwright's Chromium installed? (the screenshot tests skip without it) */
export function chromiumAvailable() {
  try {
    const require = createRequire(import.meta.url)
    const { chromium } = require('playwright')
    const exe = chromium.executablePath()
    return !!exe && existsSync(exe)
  } catch {
    return false
  }
}

/** URL of a preview page: composition (`home`) or scenario (`real-<id>`). */
function pageUrl(outdir, view, theme, lang = 'pt') {
  const base = pathToFileURL(join(outdir, 'index.html')).href
  const target = view.startsWith('real-') ? `scenario=${encodeURIComponent(view.slice(5))}` : `view=${view}`
  return `${base}?${target}&theme=${theme}&lang=${lang}&shot=1`
}

async function settle(page) {
  await page.waitForSelector('[data-preview-ready="true"]')
  // loads the lazy images: walks the page and goes back to the top
  await page.evaluate(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 40))
    const h = document.documentElement.scrollHeight
    for (let y = 0; y < h; y += 500) {
      window.scrollTo(0, y)
      await wait()
    }
    window.scrollTo(0, 0)
    // areas that scroll inside (dialog body, page): same, and back to the top
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
}

/** Lists the bundle's scenarios (read in the browser: the TSX code only exists there). */
export async function listBundledScenarios({ outdir = DEFAULT_OUTDIR } = {}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(pageUrl(outdir, 'gallery', 'light'))
    await page.waitForSelector('[data-preview-ready="true"]')
    return await page.evaluate(() => ({ entries: window.__previewScenarios ?? [], problems: window.__previewScenarioProblems ?? [] }))
  } finally {
    await browser.close()
  }
}

/** Opens a scenario and returns the page text, the missing routes (and whether the alert is visible) and JS errors. */
export async function probeScenario({ outdir = DEFAULT_OUTDIR, id, width = 900, theme = 'light', lang = 'pt' }) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(pageUrl(outdir, `real-${id}`, theme, lang))
    await settle(page)
    await page.waitForTimeout(300)
    return await page.evaluate(() => ({
      text: document.querySelector('[data-preview-surface]')?.textContent ?? '',
      missing: window.__previewMissing?.() ?? [],
      missingVisible: !!document.querySelector('[data-preview-missing]')?.getClientRects().length
    })).then((r) => ({ ...r, errors }))
  } finally {
    await browser.close()
  }
}

// ------------------------------------------------------------------ audit (runs in Chromium)

/* Run through page.evaluate: no closures. Returns problems and measurements of each composition. */
function auditPage({ prefix, view }) {
  const out = {
    overflowX: 0,
    offscreen: [],
    clipped: [],
    contrast: { checked: 0, min: 99, low: [] },
    skeleton: [],
    skeletonGrid: [],
    thumbs: {},
    avatars: {},
    iconsFont: false,
    unstyledButtons: 0,
    weights: [],
    accent: { misuse: [], primaryButtons: 0 },
    iconAlign: [],
    missing: []
  }
  // only drawn images (an avatar hidden by CSS — e.g. compact card — does not load and does not count)
  const shown = (i) => i.getClientRects().length > 0
  const imgs = [...document.querySelectorAll('img[data-thumb]')].filter(shown)
  out.thumbs = { total: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, fallback: document.querySelectorAll('[data-part="thumb-fallback"]').length }
  const avs = [...document.querySelectorAll('img[data-avatar]')].filter(shown)
  out.avatars = { total: avs.length, loaded: avs.filter((i) => i.complete && i.naturalWidth > 0).length, fallback: document.querySelectorAll('[data-part="avatar"][data-fallback]').length }
  out.iconsFont = document.fonts.check('16px codicon')
  out.unstyledButtons = [...document.querySelectorAll('[data-slot="button"]')].filter((b) => {
    const r = b.getBoundingClientRect()
    return r.width > 0 && r.height < 16
  }).length
  out.missing = (window.__previewMissing && window.__previewMissing()) || []
  const vw = document.documentElement.clientWidth
  out.overflowX = Math.max(0, document.documentElement.scrollWidth - vw)
  const kit = [...document.querySelectorAll(`[class*="${prefix}"]`)]
  const label = (el) => {
    const cls = [...el.classList].find((c) => c.startsWith(prefix)) ?? el.tagName.toLowerCase()
    return `${cls.replace(prefix, '')} "${(el.textContent || '').trim().slice(0, 40)}"`
  }
  for (const el of kit) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // decorative layer that bleeds on purpose (e.g. the stage's blurred background): clipped by its own wrapper
    if (el.closest('[data-bleed]')) continue
    if (r.right > vw + 1 && !el.closest(`.${prefix}tabbar-scroll`)) out.offscreen.push(label(el))
    const cs = getComputedStyle(el)
    const clips = cs.overflowX === 'hidden' || cs.overflow === 'hidden'
    if (clips && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.webkitLineClamp === 'none' && !el.matches(`.${prefix}sr, .${prefix}thumb, .${prefix}thumb *, .${prefix}tabbar-scroll, .${prefix}sgroup, .${prefix}count, .${prefix}avatar, [data-skeleton] *`))
      out.clipped.push(label(el))
  }
  // contrast: the kit's text leaves against the effective background
  const parse = (s) => {
    let m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] === undefined ? 1 : +m[4]]
    m = s.match(/color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+))?\)/)
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
    return null
  }
  const over = (top, under) => {
    const a = top[3]
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]
  }
  const lum = (c) => {
    const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const bgOf = (el) => {
    const stack = []
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c[3] > 0) {
        stack.push(c)
        if (c[3] >= 1) break
      }
    }
    let bg = parse(getComputedStyle(document.body).backgroundColor) || [1, 1, 1, 1]
    for (const c of stack.reverse()) bg = over(c, bg)
    return bg
  }
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
  for (const el of kit) {
    if (el.closest(`.${prefix}thumb, .${prefix}sr, [data-skeleton], [aria-hidden="true"]`)) continue
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0) continue
    const cs = getComputedStyle(el)
    let fg = parse(cs.color)
    if (!fg) continue
    const bg = bgOf(el)
    fg = over([fg[0], fg[1], fg[2], fg[3] * +cs.opacity], bg)
    const L1 = lum(fg)
    const L2 = lum(bg)
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    out.contrast.checked++
    out.contrast.min = Math.min(out.contrast.min, ratio)
    const large = parseFloat(cs.fontSize) >= 18 || (parseFloat(cs.fontSize) >= 14 && +cs.fontWeight >= 600)
    if (ratio < (large ? 3 : 4.5)) out.contrast.low.push(`${label(el)} ${ratio.toFixed(2)}:1`)
  }
  out.contrast.min = +out.contrast.min.toFixed(2)

  // skeleton × final: same variant and same width → same height. In the variants where text flows
  // (row, featured) only compares with a final with the same number of title and summary lines.
  const lines = (card, part) => {
    const el = card.querySelector(`[data-part="${part}"]`)
    if (!el) return 0
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 1
    return Math.round(el.getBoundingClientRect().height / lh)
  }
  for (const sk of document.querySelectorAll('[data-skeleton][data-part="card"]')) {
    const v = sk.getAttribute('data-variant')
    const rs = sk.getBoundingClientRect()
    if (rs.width === 0) continue
    const flowing = v === 'row' || v === 'featured'
    const twin = [...document.querySelectorAll(`[data-part="card"][data-variant="${v}"]:not([data-skeleton])`)].find(
      (c) =>
        Math.abs(c.getBoundingClientRect().width - rs.width) < 1 &&
        (!flowing ||
          (lines(c, 'title') === lines(sk, 'title') &&
            lines(c, 'excerpt') === lines(sk, 'excerpt') &&
            !!c.querySelector('[data-part="actions"][data-persistent]') === !!sk.querySelector('[data-part="actions"][data-persistent]')))
    )
    if (twin) out.skeleton.push({ part: `card:${v}`, final: +twin.getBoundingClientRect().height.toFixed(1), skeleton: +rs.height.toFixed(1) })
  }
  // height without the top rule (the 1st row of a list has none; the following ones do)
  const inner = (el) => el.getBoundingClientRect().height - parseFloat(getComputedStyle(el).borderTopWidth || '0')
  for (const part of ['channel-row', 'path-card', 'suggestion-row']) {
    const sk = document.querySelector(`[data-skeleton][data-part="${part}"]`)
    const fin = document.querySelector(`[data-part="${part}"]:not([data-skeleton])`)
    if (sk && fin) out.skeleton.push({ part, final: +inner(fin).toFixed(1), skeleton: +inner(sk).toFixed(1) })
  }
  // grid skeleton: complete rows and the same number of columns as the real grid of the same density
  const cols = (g) => getComputedStyle(g).gridTemplateColumns.split(/\s+/).filter((t) => /px$/.test(t)).length
  for (const g of document.querySelectorAll('[data-part="grid"][aria-busy="true"]')) {
    if (!g.getBoundingClientRect().width) continue
    const d = g.getAttribute('data-density')
    const real = [...document.querySelectorAll(`[role="grid"][data-density="${d}"]`)].find((r) => Math.abs(r.getBoundingClientRect().width - g.getBoundingClientRect().width) < 1)
    const n = cols(g)
    const items = g.children.length
    out.skeletonGrid.push({ density: d, columns: n, real: real ? cols(real) : null, items, complete: n > 0 && items % n === 0 })
  }

  // font weights per card: at most 2 (title + rest)
  for (const card of document.querySelectorAll('[data-part="card"]:not([data-skeleton])')) {
    const ws = new Set()
    for (const el of card.querySelectorAll('*')) {
      if (el.closest(`.${prefix}sr`) || !ownText(el)) continue
      ws.add(getComputedStyle(el).fontWeight)
    }
    if (ws.size > 2) out.weights.push(`${card.getAttribute('data-variant')} ${card.getAttribute('data-video')}: ${[...ws].sort().join('/')}`)
  }

  // accent: only on what is new and on the main action (one primary button per screen)
  const probe = document.createElement('span')
  probe.style.color = 'var(--ui-accent)'
  document.body.appendChild(probe)
  const accent = getComputedStyle(probe).color
  probe.remove()
  const allowed = [
    `.${prefix}thumb-new`,
    `.${prefix}count[data-tone="new"]`,
    `.${prefix}count[data-tone="new"] *`,
    `.${prefix}tab-count`,
    `.${prefix}tree-count`,
    `.${prefix}dot[data-tone="new"]`,
    `.${prefix}baritem-count`,
    `.${prefix}path[data-primary="true"] .${prefix}path-icon`,
    `.${prefix}path[data-primary="true"] .${prefix}path-icon *`
  ].join(', ')
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const cs = getComputedStyle(el)
    const uses = (cs.color === accent && ownText(el)) || cs.backgroundColor === accent || el.matches('i.codicon') && cs.color === accent
    if (!uses) continue
    if (el.matches('[data-slot="button"], [data-slot="button"] *')) {
      if (el.matches('[data-slot="button"]') && cs.backgroundColor === accent) out.accent.primaryButtons++
      continue
    }
    if (el.closest('[data-preview-bar]') || el.matches(allowed)) continue
    out.accent.misuse.push(label(el))
  }

  // optical alignment: icon (codicon) and neighbouring text with the center at the same height (±1.5 px)
  for (const icon of document.querySelectorAll(`[class*="${prefix}"] > i.codicon`)) {
    const parent = icon.parentElement
    const pcs = getComputedStyle(parent)
    if (!/flex|grid/.test(pcs.display) || pcs.flexDirection === 'column') continue
    const ir = icon.getBoundingClientRect()
    if (!ir.width || parent.closest('[data-skeleton]')) continue
    let textRect = null
    for (const n of parent.childNodes) {
      if (n === icon) continue
      if (n.nodeType === 3 && n.textContent.trim()) {
        const range = document.createRange()
        range.selectNodeContents(n)
        textRect = range.getClientRects()[0] ?? null
      } else if (n.nodeType === 1 && !n.matches('i.codicon, .' + prefix + 'sr') && (n.textContent || '').trim()) {
        const range = document.createRange()
        range.selectNodeContents(n)
        textRect = range.getClientRects()[0] ?? null
      }
      if (textRect) break
    }
    if (!textRect || !textRect.height) continue
    const delta = ir.top + ir.height / 2 - (textRect.top + textRect.height / 2)
    if (Math.abs(delta) > 1.5) out.iconAlign.push(`${label(parent)} ${delta.toFixed(1)}px`)
  }
  void view
  return out
}

/** List of problems (text) of a report item. Empty = ok. */
export function issuesOf(r) {
  const jumps = r.skeleton.filter((s) => Math.abs(s.final - s.skeleton) > 0.5)
  const gridSk = r.skeletonGrid.filter((g) => !g.complete || (g.real != null && g.real !== g.columns))
  return [
    r.errors.length ? `JS errors: ${r.errors.join(' | ')}` : '',
    r.missing?.length ? `scenario has no response for: ${r.missing.join(', ')}` : '',
    r.iconsFont ? '' : 'icon font (codicon) did not load',
    r.unstyledButtons ? `${r.unstyledButtons} buttons without the app style` : '',
    r.thumbs.total && r.thumbs.loaded + r.thumbs.fallback < r.thumbs.total ? `thumbnails: ${r.thumbs.loaded}/${r.thumbs.total} loaded` : '',
    r.avatars.total && r.avatars.loaded < r.avatars.total ? `avatars: ${r.avatars.loaded}/${r.avatars.total} loaded` : '',
    r.overflowX ? `horizontal scroll ${r.overflowX}px` : '',
    r.offscreen.length ? `off screen: ${r.offscreen.slice(0, 3).join(', ')}` : '',
    r.clipped.length ? `clipped text: ${r.clipped.slice(0, 3).join(', ')}` : '',
    r.contrast.low.length ? `low contrast (${r.contrast.low.length}): ${r.contrast.low.slice(0, 2).join(', ')}` : '',
    jumps.length ? `skeleton×final jump: ${jumps.map((j) => `${j.part} ${j.skeleton}→${j.final}`).join(', ')}` : '',
    gridSk.length ? `grid skeleton: ${gridSk.map((g) => `${g.density} ${g.items} items in ${g.columns} cols. (real grid ${g.real ?? '?'})`).join(', ')}` : '',
    r.weights.length ? `more than 2 weights in the card: ${r.weights.slice(0, 2).join(', ')}` : '',
    r.accent.misuse.length ? `accent out of place: ${r.accent.misuse.slice(0, 3).join(', ')}` : '',
    r.view !== 'gallery' && r.accent.primaryButtons > 1 ? `${r.accent.primaryButtons} main actions with accent (max. 1)` : '',
    r.iconAlign.length ? `icon misaligned with the text: ${r.iconAlign.slice(0, 3).join(', ')}` : ''
  ].filter(Boolean)
}

/** Takes the screenshots (light/dark × widths × compositions/scenarios) and audits each one. */
export async function takeShots({ outdir = DEFAULT_OUTDIR, views, widths = WIDTHS, widthsFor, themes = THEMES, shotsDir = SHOTS_DIR, prefix, writeReport = true }) {
  const { chromium } = await import('playwright')
  mkdirSync(shotsDir, { recursive: true })
  const browser = await chromium.launch()
  const report = []
  try {
    for (const view of views)
      for (const theme of themes)
        for (const width of widthsFor?.(view) ?? widths) {
          const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
          const errors = []
          page.on('pageerror', (e) => errors.push(String(e)))
          await page.goto(pageUrl(outdir, view, theme))
          await settle(page)
          if (view.startsWith('home')) await page.locator('[role="gridcell"]').nth(1).hover().catch(() => undefined)
          await page.waitForTimeout(view.startsWith('real-') ? 700 : 500)
          const audit = await page.evaluate(auditPage, { prefix, view })
          // JPEG q85: thumbnails are photos; a full-page PNG went over 1 MB per screenshot
          const file = `${view}.${theme}.${width}.jpg`
          await page.screenshot({ path: join(shotsDir, file), fullPage: true, type: 'jpeg', quality: 85 })
          report.push({ file, view, theme, width, errors, ...audit })
          await page.close()
        }
  } finally {
    await browser.close()
  }
  if (writeReport) writeFileSync(join(shotsDir, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}
