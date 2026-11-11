// Public screenshot of the extension's "HermesTube" section in YouTube's left menu (docs/screenshots/youtube-sidebar.png).
//
// Runs on the extension harness (extension/e2e/harness: Chrome for Testing with the built extension, temporary profile,
// local fake server, saved page — no network): a YouTube guide rebuilt with the real measurements, in English, the
// folders of the invented sample catalog (docs/sample-data/catalog.json) with their new-video counts, and four of its
// channels under Subscriptions (monogram avatars). Captured at 2× in the light theme, cropped to the guide and a strip of
// the page. Before saving, the visible text of the guide and of the section (closed Shadow DOM, read through CDP) is
// scanned like the preview screenshots (scripts/docs-screenshots.mjs): no Portuguese, no placeholder, no internal id,
// no real channel name, and the promised labels on screen.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CDPSession, Page } from '@playwright/test'
import { expect, test } from '../extension/e2e/harness/index.ts'
import { ROOT } from '../extension/e2e/harness/paths.ts'
import { SAMPLE_CATALOG, scanText } from './docs-screenshots.mjs'

const OUT = join(ROOT, 'docs', 'screenshots', 'youtube-sidebar.png')
const SECTION = 'tube-guide-section'
const VIEWPORT = { width: 1440, height: 1100 }

interface Sample {
  folders: Array<{ key: string; name: string }>
  channels: Array<{ id: string; title: string; handle: string; folder: string; favorite: boolean; avatar: { bg: string; fg: string; monogram: string } }>
  videos: Array<{ channel_id: string; age_hours: number }>
}
const SAMPLE = SAMPLE_CATALOG as Sample
/** New = published in the last week (as in the preview screenshots). */
const NEW = SAMPLE.videos.filter((v) => v.age_hours < 7 * 24)
const FOLDER_OF = new Map(SAMPLE.channels.map((c) => [c.id, c.folder]))
const NEW_BY_FOLDER = Object.fromEntries(SAMPLE.folders.map((f) => [f.key, NEW.filter((v) => FOLDER_OF.get(v.channel_id) === f.key).length]))
const FAVORITES = SAMPLE.channels.filter((c) => c.favorite)
const EXPECT = ['HermesTube', 'All new', 'Favorites', ...SAMPLE.folders.map((f) => f.name), 'Subscriptions', ...FAVORITES.map((c) => c.title)]

// ------------------------------------------------------------------ page: YouTube's guide in English

const ICON: Record<string, string> = {
  home: '<path d="M4.5 10.2 12 4l7.5 6.2V20h-5.25v-5.5h-4.5V20H4.5z"/>',
  shorts: '<rect x="6.5" y="3.5" width="11" height="17" rx="3.5"/><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor"/>',
  subs: '<path d="M6.5 3.75h11"/><rect x="3.75" y="6.75" width="16.5" height="13" rx="2.25"/><path d="M10.25 10.6v5.3l4.4-2.65z" fill="currentColor"/>',
  you: '<circle cx="12" cy="8.5" r="3.75"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  history: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/>',
  later: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
}

const svg = (name: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`

const entry = (href: string, title: string, o: { icon?: string; avatar?: { bg: string; fg: string; monogram: string }; active?: boolean; dot?: boolean; arrow?: boolean } = {}) => `
<ytd-guide-entry-renderer${o.active ? ' active=""' : ''} line-end-style="${o.dot ? 'dot' : 'none'}"><a id="endpoint" tabindex="-1" role="link" href="${href}" title="${title}">
<tp-yt-paper-item role="link" tabindex="0">
<yt-icon class="guide-icon"${o.avatar ? ' hidden=""' : ''}>${o.icon ? svg(o.icon) : ''}</yt-icon>
<yt-img-shadow height="24" width="24"${o.avatar ? ` style="--av:${o.avatar.bg};--avfg:${o.avatar.fg}"` : ' hidden=""'}><span>${o.avatar ? o.avatar.monogram : ''}</span></yt-img-shadow>
<yt-formatted-string class="title">${title}</yt-formatted-string>
<yt-icon class="arrow-icon"${o.arrow ? '' : ' hidden=""'}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg></yt-icon>
<div id="newness-dot"></div>
</tp-yt-paper-item></a></ytd-guide-entry-renderer>`

const section = (title: string | null, items: string, id: string) => `
<ytd-guide-section-renderer data-test="${id}" guide-persistent-and-visible=""><h3${title ? '' : ' hidden=""'}><yt-formatted-string id="guide-section-title">${title ?? ''}</yt-formatted-string></h3>
<div id="items">${items}</div></ytd-guide-section-renderer>`

// the favorite channels of the sample catalog, with their monogram avatars; no network
const GUIDE_SECTIONS =
  section(null, entry('/', 'Home', { icon: 'home', active: true }) + entry('/shorts/', 'Shorts', { icon: 'shorts' }) + entry('/feed/subscriptions', 'Subscriptions', { icon: 'subs' }), 'home') +
  section(null, entry('/feed/you', 'You', { icon: 'you', arrow: true }) + entry('/feed/history', 'History', { icon: 'history' }) + entry('/playlist?list=WL', 'Watch later', { icon: 'later' }), 'you') +
  section(
    'Subscriptions',
    FAVORITES.map((c, i) => entry(`/${c.handle}`, c.title, { avatar: c.avatar, dot: i < 2 })).join('') + entry('/feed/channels', 'All subscriptions', { icon: 'subs' }),
    'subs'
  )

const CARDS = Array.from(
  { length: 12 },
  (_, i) => `<div class="card"><div class="ph" style="--h:${(i * 37) % 360}"></div><div class="cm"><span class="av"></span><span class="lines"><i style="width:${80 - ((i * 13) % 30)}%"></i><i style="width:46%"></i></span></div></div>`
).join('')

// YouTube's guide measurements (same values as the extension's sidebar scenario)
const PAGE_CSS = `
html { font-size: 10px; --bg:#fff; --fg:#0f0f0f; --sep:rgba(0,0,0,.2); --hov:rgba(0,0,0,.05); --ph:rgba(0,0,0,.08); --dot:#065fd4; }
body { margin:0; background:var(--bg); color:var(--fg); font-family: Roboto, Arial, sans-serif; }
ytd-app { display:block; }
#masthead-container { position:fixed; z-index:2000; top:0; left:0; right:0; height:56px; display:flex; align-items:center; gap:16px; padding:0 16px; background:var(--bg); box-sizing:border-box; }
#guide-button { width:40px; height:40px; display:flex; align-items:center; justify-content:center; color:var(--fg); }
#search { margin-left:auto; margin-right:auto; width:min(560px, 45vw); height:40px; border:1px solid var(--sep); border-radius:20px; box-sizing:border-box; }
tp-yt-app-drawer#guide { position:fixed; z-index:2030; top:56px; left:0; bottom:0; width:240px; display:block; overflow-y:auto; scrollbar-width:none; background:var(--bg); }
ytd-guide-section-renderer { display:block; padding:12px; border-bottom:1px solid var(--sep); }
ytd-guide-section-renderer h3 { margin:0; }
ytd-guide-section-renderer h3[hidden] { display:none; }
#guide-section-title { display:block; padding:6px 12px 4px; font-size:16px; line-height:22px; font-weight:500; }
ytd-guide-entry-renderer { display:block; width:204px; height:40px; border-radius:10px; }
ytd-guide-entry-renderer[active] { background:var(--hov); }
a#endpoint { display:flex; height:40px; min-height:40px; color:var(--fg); text-decoration:none; }
tp-yt-paper-item { display:flex; align-items:center; box-sizing:border-box; width:100%; min-height:40px; padding:0 12px; }
yt-icon.guide-icon { display:flex; width:24px; height:24px; margin-right:24px; flex:none; }
yt-icon[hidden], yt-img-shadow[hidden] { display:none !important; }
yt-img-shadow { display:flex; align-items:center; justify-content:center; width:24px; height:24px; margin-right:24px; border-radius:50%; background:var(--av); color:var(--avfg, #fff); font:600 9px/1 Roboto, Arial, sans-serif; letter-spacing:-.2px; flex:none; }
.title { flex:1; min-width:0; font-size:14px; line-height:20px; font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
ytd-guide-entry-renderer[active] .title { font-weight:500; }
yt-icon.arrow-icon { display:flex; margin-left:8px; }
#newness-dot { display:none; width:4px; height:4px; border-radius:50%; background:var(--dot); margin:0 6px; }
ytd-guide-entry-renderer[line-end-style="dot"] #newness-dot { display:block; }
ytd-mini-guide-renderer[hidden] { display:none; }
#page-manager { padding:80px 24px 24px 264px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:40px 16px; }
.ph { aspect-ratio:16/9; border-radius:12px; background:linear-gradient(135deg, hsl(var(--h) 25% 55% / .45), var(--ph)); }
.cm { display:flex; gap:12px; margin-top:12px; }
.av { width:36px; height:36px; border-radius:50%; background:var(--ph); flex:none; }
.lines { flex:1; display:flex; flex-direction:column; gap:8px; padding-top:2px; }
.lines i { display:block; height:12px; border-radius:6px; background:var(--ph); }
`

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>YouTube</title><style>${PAGE_CSS}</style></head>
<body><ytd-app guide-persistent-and-visible=""><div id="content">
<div id="masthead-container"><span id="guide-button">${svg('menu')}</span><span id="search"></span></div>
<tp-yt-app-drawer id="guide" align="start" role="navigation" position="left" opened="" persistent=""><div id="contentContainer"><div id="guide-wrapper"><div id="guide-content"><div id="guide-inner-content">
<ytd-guide-renderer id="guide-renderer"><div id="sections">${GUIDE_SECTIONS}</div></ytd-guide-renderer>
</div></div></div></div></tp-yt-app-drawer>
<ytd-mini-guide-renderer role="navigation" hidden=""><div id="items"></div></ytd-mini-guide-renderer>
<div id="page-manager"><div class="grid">${CARDS}</div></div>
</div></ytd-app></body></html>`

test.use({ savedPages: [{ match: (u) => u.pathname === '/', html: PAGE }] })

// ------------------------------------------------------------------ fake server: the sample folders

const NOW_S = Math.floor(Date.now() / 1000)

const STATE = {
  new_total: NEW.length,
  tabs: [
    { tab_id: 'all-new', name: 'All new', count: NEW.length, icon: null },
    { tab_id: 'favorites', name: 'Favorites', count: NEW.filter((v) => FAVORITES.some((c) => c.id === v.channel_id)).length, icon: null },
    { tab_id: 'later', name: 'Watch later', count: 0, icon: null }
  ],
  folders: SAMPLE.folders.map((f) => ({ folder_id: `f_${f.key}`, name: f.name, count: NEW_BY_FOLDER[f.key], parent_id: null })),
  search_pending: 0,
  queue_pending: 0,
  home_on_youtube: false,
  extras_honest_thumbnails: false,
  extras_hn_lens: false,
  extras_hn_channels: false,
  extras_import_lists: false,
  refresh_running: false,
  last_rss_at: NOW_S - 600,
  language: 'en',
  device_id: 'dev_stub',
  server_time: NOW_S
}

// ------------------------------------------------------------------ CDP: the section's closed Shadow DOM

interface CdpNode {
  nodeId: number
  nodeName: string
  children?: CdpNode[]
  shadowRoots?: CdpNode[]
}

/** Runs `fn` (source) with `this` = the shadow root of the first `tag` element; returns its value. */
async function inShadow<T>(cdp: CDPSession, tag: string, fn: string): Promise<T | null> {
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: CdpNode }
  const stack: CdpNode[] = [root]
  let id: number | null = null
  while (stack.length && id === null) {
    const n = stack.pop()!
    if (n.nodeName === tag.toUpperCase() && n.shadowRoots?.length) id = n.shadowRoots[0].nodeId
    stack.push(...(n.children ?? []), ...(n.shadowRoots ?? []))
  }
  if (id === null) return null
  const { object } = await cdp.send('DOM.resolveNode', { nodeId: id })
  const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId!, functionDeclaration: fn, returnByValue: true })
  await cdp.send('Runtime.releaseObject', { objectId: object.objectId! })
  return result.value as T
}

/* Visible text lines of a root (rendered and not hidden; aria-hidden text is still drawn, so it counts). `this` = the root. */
const VISIBLE_TEXT = String.raw`function () {
  const up = (el) => el.parentElement || (el.getRootNode() && el.getRootNode().host) || null
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return false
    for (let e = el; e; e = up(e)) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false }
    return true
  }
  const out = []
  const w = document.createTreeWalker(this, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim()
    if (t && n.parentElement && shown(n.parentElement)) out.push(t)
  }
  return out
}`

const box = (page: Page, selector: string) =>
  page.evaluate<{ x: number; y: number; width: number; height: number } | null>(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
  )

// ------------------------------------------------------------------ the capture

test('youtube-sidebar.png: the HermesTube section above Subscriptions, sample folders with new counts (light, 2x)', async ({ page, stub, youtube, seedPairing }) => {
  test.setTimeout(90_000)
  stub.set('GET /ext/state', { body: { ok: true, data: STATE } })
  stub.set('GET /ext/queue', { body: { ok: true, data: { items: [], channels: {} } } })
  await seedPairing()
  await page.setViewportSize(VIEWPORT)
  await page.goto('https://www.youtube.com/')
  await expect(page.locator('html')).toHaveAttribute('data-tube-ext-modules', /content\/sidebar/)
  await expect(page.locator(SECTION)).toHaveCount(1)
  // the section sits right above Subscriptions
  expect(await page.evaluate<string | null>(`document.querySelector('${SECTION}').nextElementSibling?.getAttribute('data-test') ?? null`)).toBe('subs')

  // one CDP session for the whole capture: closing it would undo the 2x metrics
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 2, mobile: false })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
  await expect.poll(() => inShadow<string>(cdp, SECTION, 'function () { return this.querySelector(\'[data-part="total"]\')?.textContent ?? null }')).toBe(String(NEW.length))
  // pointer away from the guide
  await page.mouse.move(1100, 900)
  await page.waitForTimeout(300)

  // text actually on screen: the guide (page) + the section (shadow)
  const sectionText = (await inShadow<string[]>(cdp, SECTION, VISIBLE_TEXT)) ?? []
  const guideText = await page.evaluate<string[]>(
    `[...document.querySelectorAll('#guide .title, #guide #guide-section-title')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()).filter(Boolean)`
  )
  const text = [...guideText, ...sectionText].join('\n')
  const problems = scanText(text, { expect: EXPECT })
  // new-video counts on the folder rows, in the catalog's order
  const counts = await inShadow<string[]>(cdp, SECTION, 'function () { return [...this.querySelectorAll(\'[data-key^="f:f_"] > .row [data-part="count"]\')].map((e) => e.textContent.trim()) }')
  const want = SAMPLE.folders.map((f) => String(NEW_BY_FOLDER[f.key]))
  if (JSON.stringify(counts) !== JSON.stringify(want)) problems.push(`row counts: ${JSON.stringify(counts)}, expected ${JSON.stringify(want)}`)

  // crop: the guide down to the end of the Subscriptions section, plus a strip of the page
  const subs = (await box(page, 'ytd-guide-section-renderer[data-test="subs"]'))!
  const clip = { x: 0, y: 0, width: 560, height: Math.min(VIEWPORT.height, Math.ceil(subs.y + subs.height + 16)) }
  const report = { file: 'docs/screenshots/youtube-sidebar.png', viewport: VIEWPORT, clip, deviceScaleFactor: 2, problems, sectionText, guideText }
  const dir = join(process.env.TMPDIR || '/tmp', 'docs-screenshots')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sidebar-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  expect(problems).toEqual([])
  expect(subs.y + subs.height).toBeLessThanOrEqual(VIEWPORT.height)

  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })) as { data: string }
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  void youtube
  await cdp.detach().catch(() => undefined)
})
