// Sidebar in the harness (Chrome for Testing, temporary profile, fake range server, saved page — no network):
// 1. state with tabs and folders → "HermesTube" section in the guide, right above Subscriptions, with the counters and aligned with the
//    neighboring entries (x, width, height, text indent, font); click on a folder → pane with the videos from
//    `GET /ext/feed`; "Mark as read" → after 5 s, `POST /ext/read` once and `GET /ext/state` again;
// 2. screenshots (2×, with the guide around): ext-sidebar-{expanded,panel,mini,disconnected,empty}.{light,dark}.png
//    in the screenshots folder.
//
// The page is YouTube's guide rebuilt with the measurements taken from the real www.youtube.com (guide.ts, header): the
// YouTube app does not run in the harness (the player/Polymer JS is a 404), so the guide DOM is served ready-made, with the
// equivalent CSS. The bar's content is in a **closed** Shadow DOM: Playwright does not get in; the test reads and clicks through
// CDP (`DOM.getDocument {pierce}` sees closed roots).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, CDPSession, Page } from '@playwright/test'
import { expect, test, type StubRequest, type SwScope } from '../harness/index.ts'
import { ROOT } from '../harness/paths.ts'

const SHOTS = join(ROOT, 'docs', 'design', 'shots')
const SECTION = 'tube-guide-section'
const MINI = 'tube-guide-mini'
const PANEL = 'tube-guide-panel'

// ------------------------------------------------------------------ page: YouTube guide (real measurements)

const ICON: Record<string, string> = {
  home: '<path d="M4.5 10.2 12 4l7.5 6.2V20h-5.25v-5.5h-4.5V20H4.5z"/>',
  shorts: '<rect x="6.5" y="3.5" width="11" height="17" rx="3.5"/><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor"/>',
  subs: '<path d="M6.5 3.75h11"/><rect x="3.75" y="6.75" width="16.5" height="13" rx="2.25"/><path d="M10.25 10.6v5.3l4.4-2.65z" fill="currentColor"/>',
  you: '<circle cx="12" cy="8.5" r="3.75"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  history: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/>',
  later: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12h4"/>',
  music: '<path d="M9.5 17.5V6l9-2v11.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/>',
  film: '<rect x="3.75" y="5.75" width="16.5" height="12.5" rx="2"/><path d="M3.75 9.5h16.5M8 5.75 9.5 9.5M13 5.75l1.5 3.75"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M8 8a5.6 5.6 0 0 0 0 8m8-8a5.6 5.6 0 0 1 0 8M5.3 5.3a9.4 9.4 0 0 0 0 13.4m13.4-13.4a9.4 9.4 0 0 1 0 13.4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
}

const svg = (name: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`

const entry = (href: string | null, title: string, o: { icon?: string; avatar?: string; active?: boolean; dot?: boolean; arrow?: boolean } = {}) => `
<ytd-guide-entry-renderer${o.active ? ' active=""' : ''} line-end-style="${o.dot ? 'dot' : 'none'}"><a id="endpoint" tabindex="-1" role="link"${href ? ` href="${href}"` : ''} title="${title}">
<tp-yt-paper-item role="link" tabindex="0">
<yt-icon class="guide-icon"${o.avatar ? ' hidden=""' : ''}>${o.icon ? svg(o.icon) : ''}</yt-icon>
<yt-img-shadow height="24" width="24"${o.avatar ? ` style="--av:${o.avatar}"` : ' hidden=""'}><span>${o.avatar ? title[0] : ''}</span></yt-img-shadow>
<yt-formatted-string class="title">${title}</yt-formatted-string>
<yt-icon class="arrow-icon"${o.arrow ? '' : ' hidden=""'}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg></yt-icon>
<div id="newness-dot"></div>
</tp-yt-paper-item></a></ytd-guide-entry-renderer>`

const section = (title: string | null, items: string, id: string) => `
<ytd-guide-section-renderer data-test="${id}" guide-persistent-and-visible=""><h3${title ? '' : ' hidden=""'}><yt-formatted-string id="guide-section-title">${title ?? ''}</yt-formatted-string></h3>
<div id="items">${items}</div></ytd-guide-section-renderer>`

const miniEntry = (href: string, title: string, icon: string, active = false) =>
  `<ytd-mini-guide-entry-renderer${active ? ' is-active=""' : ''}><a id="endpoint" href="${href}" title="${title}" aria-label="${title}"><yt-icon id="icon" class="guide-icon">${svg(icon)}</yt-icon><span class="title">${title}</span></a></ytd-mini-guide-entry-renderer>`

const GUIDE_SECTIONS =
  section(null, entry('/', 'Início', { icon: 'home', active: true }) + entry('/shorts/', 'Shorts', { icon: 'shorts' }) + entry('/feed/subscriptions', 'Inscrições', { icon: 'subs' }), 'home') +
  section(
    null,
    entry('/feed/you', 'Você', { icon: 'you', arrow: true }) + entry('/feed/history', 'Histórico', { icon: 'history' }) + entry('/playlist?list=WL', 'Assistir mais tarde', { icon: 'later' }),
    'you'
  ) +
  section(
    'Inscrições',
    entry('/@Fireship', 'Fireship', { avatar: '#f4a836', dot: true }) +
      entry('/@veritasium', 'Veritasium', { avatar: '#3b82c4', dot: true }) +
      entry('/@3blue1brown', '3Blue1Brown', { avatar: '#5b6f8e' }) +
      entry('/@NoBoilerplate', 'No Boilerplate', { avatar: '#c2410c' }) +
      entry('/feed/channels', 'Todas as inscrições', { icon: 'subs' }),
    'subs'
  ) +
  section('Explorar', entry('/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ', 'Música', { icon: 'music' }) + entry('/feed/storefront', 'Filmes', { icon: 'film' }) + entry('/channel/UC4R8DWoMoI7CAwX8_LjQHig', 'Ao vivo', { icon: 'live' }), 'explore')

const CARDS = Array.from(
  { length: 12 },
  (_, i) => `<div class="card"><div class="ph" style="--h:${(i * 37) % 360}"></div><div class="cm"><span class="av"></span><span class="lines"><i style="width:${80 - ((i * 13) % 30)}%"></i><i style="width:46%"></i></span></div></div>`
).join('')

const PAGE_CSS = `
html { font-size: 10px; --bg:#fff; --fg:#0f0f0f; --fg2:#606060; --sep:rgba(0,0,0,.2); --hov:rgba(0,0,0,.05); --ph:rgba(0,0,0,.08); --dot:#065fd4; }
html[dark] { --bg:#0f0f0f; --fg:#f1f1f1; --fg2:#aaa; --sep:rgba(255,255,255,.2); --hov:rgba(255,255,255,.1); --ph:rgba(255,255,255,.1); --dot:#3ea6ff; }
body { margin:0; background:var(--bg); color:var(--fg); font-family: Roboto, Arial, sans-serif; }
ytd-app { display:block; }
#masthead-container { position:fixed; z-index:2000; top:0; left:0; right:0; height:56px; display:flex; align-items:center; gap:16px; padding:0 16px; background:var(--bg); box-sizing:border-box; }
#guide-button { width:40px; height:40px; display:flex; align-items:center; justify-content:center; color:var(--fg); }
#logo { display:flex; align-items:center; gap:4px; font: 600 18px/1 Roboto, Arial, sans-serif; letter-spacing:-.04em; }
#logo i { width:28px; height:20px; border-radius:6px; background:#f03; display:inline-block; }
#search { margin-left:auto; margin-right:auto; width:min(560px, 45vw); height:40px; border:1px solid var(--sep); border-radius:20px; box-sizing:border-box; }
tp-yt-app-drawer#guide { position:fixed; z-index:2030; top:56px; left:0; bottom:0; width:240px; display:block; overflow-y:auto; scrollbar-width:thin; background:var(--bg); }
tp-yt-app-drawer#guide:not([opened]) { display:none; }
ytd-guide-section-renderer { display:block; padding:12px; border-bottom:1px solid var(--sep); }
ytd-guide-section-renderer h3 { margin:0; }
ytd-guide-section-renderer h3[hidden] { display:none; }
#guide-section-title { display:block; padding:6px 12px 4px; font-size:16px; line-height:22px; font-weight:500; }
ytd-guide-entry-renderer { display:block; width:204px; height:40px; border-radius:10px; }
ytd-guide-entry-renderer[active] { background:var(--hov); }
ytd-guide-entry-renderer:hover { background:var(--hov); }
a#endpoint { display:flex; height:40px; min-height:40px; color:var(--fg); text-decoration:none; }
tp-yt-paper-item { display:flex; align-items:center; box-sizing:border-box; width:100%; min-height:40px; padding:0 12px; }
yt-icon.guide-icon { display:flex; width:24px; height:24px; margin-right:24px; flex:none; }
yt-icon[hidden], yt-img-shadow[hidden] { display:none !important; }
yt-img-shadow { display:flex; align-items:center; justify-content:center; width:24px; height:24px; margin-right:24px; border-radius:50%; background:var(--av); color:#fff; font:500 12px/1 Roboto, Arial, sans-serif; flex:none; }
.title { flex:1; min-width:0; font-size:14px; line-height:20px; font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
ytd-guide-entry-renderer[active] .title { font-weight:500; }
yt-icon.arrow-icon { display:flex; margin-left:8px; }
#newness-dot { display:none; width:4px; height:4px; border-radius:50%; background:var(--dot); margin:0 6px; }
ytd-guide-entry-renderer[line-end-style="dot"] #newness-dot { display:block; }
ytd-mini-guide-renderer { position:fixed; z-index:2020; top:56px; left:0; bottom:0; width:72px; padding:0 4px; box-sizing:border-box; display:block; background:var(--bg); }
ytd-mini-guide-renderer[hidden] { display:none; }
ytd-mini-guide-entry-renderer { display:block; width:64px; border-radius:10px; }
ytd-mini-guide-entry-renderer[is-active] { background:var(--hov); }
ytd-mini-guide-entry-renderer a { display:flex; flex-direction:column; align-items:center; padding:16px 0 14px; color:var(--fg); text-decoration:none; }
ytd-mini-guide-entry-renderer yt-icon { display:flex; width:24px; height:24px; margin-bottom:6px; }
ytd-mini-guide-entry-renderer .title { flex:none; font-size:10px; line-height:16px; }
#page-manager { padding:80px 24px 24px 264px; }
ytd-app[mini-guide-visible] #page-manager { padding-left:96px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:40px 16px; }
.ph { aspect-ratio:16/9; border-radius:12px; background:linear-gradient(135deg, hsl(var(--h) 25% 55% / .45), var(--ph)); }
.cm { display:flex; gap:12px; margin-top:12px; }
.av { width:36px; height:36px; border-radius:50%; background:var(--ph); flex:none; }
.lines { flex:1; display:flex; flex-direction:column; gap:8px; padding-top:2px; }
.lines i { display:block; height:12px; border-radius:6px; background:var(--ph); }
`

const LAYOUT_JS = `
(function () {
  function apply() {
    var app = document.querySelector('ytd-app'), drawer = document.querySelector('#guide'), mini = document.querySelector('ytd-mini-guide-renderer');
    if (!app || !drawer || !mini) return;
    if (innerWidth >= 1312) {
      app.setAttribute('guide-persistent-and-visible', ''); app.removeAttribute('mini-guide-visible');
      drawer.setAttribute('opened', ''); drawer.setAttribute('persistent', '');
      mini.setAttribute('hidden', ''); mini.removeAttribute('mini-guide-visible');
    } else {
      app.removeAttribute('guide-persistent-and-visible'); app.setAttribute('mini-guide-visible', '');
      drawer.removeAttribute('opened'); drawer.removeAttribute('persistent');
      mini.removeAttribute('hidden'); mini.setAttribute('mini-guide-visible', '');
    }
  }
  addEventListener('resize', apply);
  document.addEventListener('DOMContentLoaded', apply);
})();
`

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>YouTube</title><style>${PAGE_CSS}</style><script>${LAYOUT_JS}</script></head>
<body><ytd-app><div id="content">
<div id="masthead-container"><span id="guide-button">${svg('menu')}</span><span id="logo"><i></i>YouTube</span><span id="search"></span></div>
<tp-yt-app-drawer id="guide" align="start" role="navigation" position="left" opened="" persistent=""><div id="contentContainer"><div id="guide-wrapper"><div id="guide-content"><div id="guide-inner-content">
<ytd-guide-renderer id="guide-renderer"><div id="sections">${GUIDE_SECTIONS}</div></ytd-guide-renderer>
</div></div></div></div></tp-yt-app-drawer>
<ytd-mini-guide-renderer role="navigation" hidden=""><div id="items">${
  miniEntry('/', 'Início', 'home', true) + miniEntry('/shorts/', 'Shorts', 'shorts') + miniEntry('/feed/subscriptions', 'Inscrições', 'subs') + miniEntry('/feed/you', 'Você', 'you')
}</div></ytd-mini-guide-renderer>
<div id="page-manager"><div class="grid">${CARDS}</div></div>
</div></ytd-app></body></html>`

test.use({ savedPages: [{ match: (u) => u.pathname === '/', html: PAGE }] })

// ------------------------------------------------------------------ fake server data

const NOW_S = Math.floor(Date.now() / 1000)

const STATE = {
  new_total: 23,
  tabs: [
    { tab_id: 'all-new', name: 'Tudo novo', count: 23, icon: null },
    { tab_id: 'favorites', name: 'Favoritos', count: 4, icon: null },
    { tab_id: 'later', name: 'Ver depois', count: 0, icon: null }
  ],
  folders: [
    { folder_id: 'f_tech', name: 'Tecnologia', count: 14, parent_id: null },
    { folder_id: 'f_rust', name: 'Rust', count: 6, parent_id: 'f_tech' },
    { folder_id: 'f_ai', name: 'IA e dados', count: 5, parent_id: 'f_tech' },
    { folder_id: 'f_async', name: 'Async e Tokio', count: 2, parent_id: 'f_rust' },
    { folder_id: 'f_sci', name: 'Ciência', count: 7, parent_id: null },
    { folder_id: 'f_cook', name: 'Cozinha', count: 2, parent_id: null },
    { folder_id: 'f_music', name: 'Música', count: 0, parent_id: null }
  ],
  search_pending: 0,
  queue_pending: 0,
  home_on_youtube: false,
  extras_honest_thumbnails: false,
  extras_hn_lens: false,
  extras_hn_channels: false,
  extras_import_lists: false,
  refresh_running: false,
  last_rss_at: NOW_S - 600,
  language: 'pt-BR',
  device_id: 'dev_stub',
  server_time: NOW_S
}

const VIDEOS: Array<[string, string, string, number, number]> = [
  ['rUsTvid0001', 'Rust 1.91 chegou: o que mudou de verdade no compilador', 'No Boilerplate', 2, 754],
  ['fIrEvid0002', 'Construí um banco de dados em 100 segundos', 'Fireship', 5, 512],
  ['vErItas0003', 'O paradoxo que quebrou a matemática', 'Veritasium', 9, 1985],
  ['bLuEvid0004', 'Mas o que é, afinal, uma rede neural?', '3Blue1Brown', 20, 1143],
  ['jOnGvid0005', 'Crust of Rust: canais e async por dentro', 'Jon Gjengset', 30, 6420],
  ['cOmPvid0006', 'Como funciona a compressão de imagens', 'Computerphile', 47, 838]
]

function feed(query: Record<string, string>) {
  const label = query.folder === 'f_tech' ? 'Tecnologia' : query.folder ? query.folder : 'Tudo novo'
  const items = VIDEOS.map(([id, title, channel, hours, dur], i) => ({
    video: {
      id,
      channel_id: 'UCsBjURrPoezykLs9EqgamOA',
      title,
      published_at: NOW_S - hours * 3600,
      description: null,
      channel_title: channel,
      duration_s: dur,
      is_short: false,
      views: null,
      first_seen_at: NOW_S - hours * 3600,
      origin: 'rss'
    },
    channel: null,
    state: 'new',
    reaction: null,
    is_new: i < 5,
    why: { via: 'folder', label: i === 0 || i === 4 ? 'Rust' : label, detail: null },
    badges: []
  }))
  return { ok: true, data: { items, next_cursor: 'CUR_2', counts: { total: 40, new: 14 } } }
}

/** Thumbnails without network: SVG generated per id (the harness blocks i.ytimg.com; this route comes first). */
async function routeThumbs(context: BrowserContext): Promise<void> {
  await context.route('https://i.ytimg.com/**', (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[2] ?? 'x'
    let h = 0
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
    const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,38%)"/><stop offset="1" stop-color="hsl(${(h + 70) % 360},60%,22%)"/></linearGradient></defs><rect width="480" height="360" fill="url(#g)"/><circle cx="${120 + (h % 200)}" cy="180" r="70" fill="hsl(${(h + 30) % 360},70%,62%)" opacity=".55"/><rect x="250" y="${110 + (h % 60)}" width="160" height="22" rx="6" fill="#fff" opacity=".8"/><rect x="250" y="${145 + (h % 60)}" width="110" height="22" rx="6" fill="#fff" opacity=".5"/></svg>`
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body })
  })
}

// ------------------------------------------------------------------ CDP: closed Shadow DOM

interface AuditResult {
  problems: string[]
  checked: number
  minContrast: number
}

// runs in the page (tsconfig.node has no DOM): `this` = closed Shadow root
const AUDIT_JS = String.raw`function () {
  const problems = []
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return [0, 0, 0, 0]
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2], p[3] ?? 1]
  }
  const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1)
  const up = (el) => el.parentElement || (el.getRootNode() && el.getRootNode().host) || null
  const bgOf = (el) => {
    const chain = []
    for (let e = el; e; e = up(e)) chain.push(parse(getComputedStyle(e).backgroundColor))
    let acc = [255, 255, 255, 1]
    for (const c of chain.reverse()) acc = over(c, acc)
    return acc
  }
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    for (let e = el; e; e = up(e)) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false }
    return true
  }
  let checked = 0
  let minContrast = 99
  for (const el of this.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own || !visible(el)) continue
    const name = el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' "' + el.textContent.trim().slice(0, 24) + '"'
    const r = el.getBoundingClientRect()
    if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5) problems.push(name + ' off screen')
    const cs = getComputedStyle(el)
    if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') problems.push(name + ' clipped')
    if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow === 'ellipsis') problems.push(name + ' truncated with an ellipsis')
    if (el.closest('.tree[data-off]')) continue // tree deliberately muted (disconnected)
    const c = ratio(over(parse(cs.color), bgOf(el)), bgOf(el))
    checked++
    minContrast = Math.min(minContrast, c)
    if (c < 4.5) problems.push(name + ' contrast ' + c.toFixed(2))
  }
  return { problems, checked, minContrast: Math.round(minContrast * 100) / 100 }
}`

interface CdpNode {
  nodeId: number
  nodeName: string
  children?: CdpNode[]
  shadowRoots?: CdpNode[]
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

class Shadow {
  constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession
  ) {}

  static async open(page: Page): Promise<Shadow> {
    return new Shadow(page, await page.context().newCDPSession(page))
  }

  private async rootOf(tag: string): Promise<number | null> {
    const { root } = (await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: CdpNode }
    const want = tag.toUpperCase()
    const stack: CdpNode[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.nodeName === want && n.shadowRoots?.length) return n.shadowRoots[0].nodeId
      stack.push(...(n.children ?? []), ...(n.shadowRoots ?? []))
    }
    return null
  }

  async all(tag: string, selector: string): Promise<number[]> {
    const root = await this.rootOf(tag)
    if (!root) return []
    const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', { nodeId: root, selector })
    return nodeIds
  }

  private async call<T>(nodeId: number, fn: string): Promise<T> {
    const { object } = await this.cdp.send('DOM.resolveNode', { nodeId })
    const { result } = await this.cdp.send('Runtime.callFunctionOn', { objectId: object.objectId!, functionDeclaration: fn, returnByValue: true })
    await this.cdp.send('Runtime.releaseObject', { objectId: object.objectId! })
    return result.value as T
  }

  async texts(tag: string, selector: string): Promise<string[]> {
    const ids = await this.all(tag, selector)
    const out: string[] = []
    for (const id of ids) out.push(await this.call<string>(id, 'function () { return this.textContent }'))
    return out
  }

  async text(tag: string, selector: string): Promise<string | null> {
    return (await this.texts(tag, selector))[0] ?? null
  }

  async count(tag: string, selector: string): Promise<number> {
    return (await this.all(tag, selector)).length
  }

  async box(tag: string, selector: string): Promise<Box | null> {
    const [id] = await this.all(tag, selector)
    if (!id) return null
    return this.call<Box>(id, 'function () { const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }')
  }

  async attrs(tag: string, selector: string, name: string): Promise<Array<string | null>> {
    const out: Array<string | null> = []
    for (const id of await this.all(tag, selector)) out.push(await this.call<string | null>(id, `function () { return this.getAttribute(${JSON.stringify(name)}) }`))
    return out
  }

  async style(tag: string, selector: string, prop: string): Promise<string | null> {
    const [id] = await this.all(tag, selector)
    if (!id) return null
    return this.call<string>(id, `function () { return getComputedStyle(this).getPropertyValue(${JSON.stringify(prop)}) }`)
  }

  /** Audit of a Shadow root (visible text): WCAG contrast against the composite background (walks up to the page
   *  across the host), clipped text without an ellipsis and nothing off screen. */
  async audit(tag: string): Promise<AuditResult | null> {
    const root = await this.rootOf(tag)
    if (!root) return null
    const { object } = await this.cdp.send('DOM.resolveNode', { nodeId: root })
    const { result } = await this.cdp.send('Runtime.callFunctionOn', { objectId: object.objectId!, functionDeclaration: AUDIT_JS, returnByValue: true })
    await this.cdp.send('Runtime.releaseObject', { objectId: object.objectId! })
    return result.value as AuditResult
  }

  async click(tag: string, selector: string): Promise<void> {
    const b = await this.box(tag, selector)
    if (!b) throw new Error(`not found: ${tag} ${selector}`)
    await this.page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 20))
  }

  close(): Promise<void> {
    return this.cdp.detach().catch(() => undefined)
  }
}

const pageBox = (page: Page, selector: string) =>
  page.evaluate<Box | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)

const pageStyle = (page: Page, selector: string, prop: string) =>
  page.evaluate<string | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)}) : null })()`)

const setDark = (page: Page, dark: boolean) =>
  page.evaluate(`document.documentElement.${dark ? "setAttribute('dark', 'true')" : "removeAttribute('dark')"}`)

const audits: Record<string, AuditResult> = {}

test.afterAll(() => {
  writeFileSync(join(process.env.TMPDIR || '/tmp', 'sidebar-audit.json'), JSON.stringify(audits, null, 2))
})

/**
 * Screen emulation in a CDP session that stays on for the whole test: turning the session off undoes the metric and the page
 * goes back to the window size (Playwright's `setViewportSize` with the same size does not reapply).
 */
class Screen {
  private constructor(
    private readonly page: Page,
    readonly cdp: CDPSession,
    public size: { width: number; height: number }
  ) {}

  static async open(page: Page, size: { width: number; height: number }): Promise<Screen> {
    const s = new Screen(page, await page.context().newCDPSession(page), size)
    await s.set(size)
    return s
  }

  async set(size: { width: number; height: number }, scale = 1): Promise<void> {
    this.size = size
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: scale, mobile: false })
    await this.page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
  }

  /** 2× screenshot of a region in both themes; goes back to 1× and the light theme. */
  async shoot(name: string, clip: Box): Promise<void> {
    mkdirSync(SHOTS, { recursive: true })
    await this.page.emulateMedia({ reducedMotion: 'reduce' })
    try {
      for (const scheme of ['light', 'dark'] as const) {
        await setDark(this.page, scheme === 'dark')
        await expect.poll(() => this.page.evaluate<string | null>(`document.querySelector('${SECTION}, ${MINI}')?.getAttribute('data-theme') ?? null`)).toBe(scheme)
        await this.set(this.size, 2)
        await this.page.waitForTimeout(150)
        for (const tag of [SECTION, MINI, PANEL]) {
          const a = await new Shadow(this.page, this.cdp).audit(tag)
          if (!a || a.checked === 0) continue
          audits[`${name}.${scheme}.${tag}`] = a
          expect(a.problems, `${name}.${scheme} ${tag}`).toEqual([])
        }
        const shot = (await this.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })) as { data: string }
        writeFileSync(join(SHOTS, `ext-sidebar-${name}.${scheme}.png`), Buffer.from(shot.data, 'base64'))
      }
    } finally {
      await this.set(this.size, 1)
      await setDark(this.page, false)
      await this.page.emulateMedia({ reducedMotion: 'no-preference' })
    }
  }

  close(): Promise<void> {
    return this.cdp.detach().catch(() => undefined)
  }
}

async function openYouTube(page: Page, viewport = { width: 1440, height: 960 }): Promise<Shadow> {
  await page.setViewportSize(viewport)
  await page.goto('https://www.youtube.com/')
  await expect(page.locator('html')).toHaveAttribute('data-tube-ext-modules', /content\/sidebar/)
  await expect(page.locator(SECTION)).toHaveCount(1)
  return Shadow.open(page)
}

function useStub(stub: { set(key: string, reply: unknown): unknown }, state: object = STATE): void {
  stub.set('GET /ext/state', { body: { ok: true, data: state } })
  stub.set('GET /ext/queue', { body: { ok: true, data: { items: [], channels: {} } } })
  stub.set('GET /ext/feed', (req: StubRequest) => ({ body: feed(req.query) }))
  stub.set('POST /ext/read', { body: { ok: true, data: { changed: 14 } } })
}

// ------------------------------------------------------------------ scenarios

test('section in the guide with counters, aligned; pane with /ext/feed; mark as read → POST /ext/read once', async ({ page, stub, youtube, seedPairing, context }) => {
  test.setTimeout(90_000)
  useStub(stub)
  await routeThumbs(context)
  await seedPairing()
  const sh = await openYouTube(page)

  // place: right above "Subscriptions"
  expect(await page.evaluate<string | null>(`document.querySelector('${SECTION}').nextElementSibling?.getAttribute('data-test') ?? null`)).toBe('subs')
  expect(await page.evaluate<string | null>(`document.querySelector('${SECTION}').previousElementSibling?.getAttribute('data-test') ?? null`)).toBe('you')
  // content closed to the page
  expect(await page.evaluate<boolean>(`document.querySelector('${SECTION}').shadowRoot === null`)).toBe(true)

  // counters
  await expect.poll(() => sh.text(SECTION, '[data-part="total"]')).toBe('23')
  expect(await sh.texts(SECTION, '[role="treeitem"] .label')).toEqual(['Tudo novo', 'Favoritos', 'Ver depois', 'Tecnologia', 'Ciência', 'Cozinha', 'Música'])
  expect(await sh.texts(SECTION, '[data-key="t:all-new"] > .row [data-part="count"]')).toEqual(['23'])
  expect(await sh.count(SECTION, '[data-key="t:later"] > .row [data-part="count"]')).toBe(0)
  expect(await sh.texts(SECTION, '[data-key="f:f_tech"] > .row [data-part="count"]')).toEqual(['14'])

  // the built-in tabs have distinct icons (in the stroke of the others, created through the DOM)
  const tabIcons = await sh.attrs(SECTION, '[role="treeitem"][data-key^="t:"] > .row .icon', 'data-icon')
  expect(tabIcons).toEqual(['new', 'star', 'later'])
  const drawings: string[] = []
  for (const k of ['t:all-new', 't:favorites', 't:later']) drawings.push(JSON.stringify(await sh.attrs(SECTION, `[data-key="${k}"] > .row .icon svg > *`, 'd'))) // one at a time: CDP rebuilds the document on every read
  expect(new Set(drawings).size).toBe(3)

  // pixel-by-pixel alignment with the neighboring entry ("History")
  const neighbor = (await pageBox(page, 'ytd-guide-section-renderer[data-test="you"] ytd-guide-entry-renderer:nth-child(2)'))!
  const neighborTitle = (await pageBox(page, 'ytd-guide-section-renderer[data-test="you"] ytd-guide-entry-renderer:nth-child(2) .title'))!
  const neighborIcon = (await pageBox(page, 'ytd-guide-section-renderer[data-test="you"] ytd-guide-entry-renderer:nth-child(2) yt-icon.guide-icon'))!
  const ours = (await sh.box(SECTION, '[data-key="f:f_sci"] > .row'))!
  const oursLabel = (await sh.box(SECTION, '[data-key="f:f_sci"] > .row .label'))!
  const oursIcon = (await sh.box(SECTION, '[data-key="f:f_sci"] > .row .icon'))!
  const alignment = {
    row: { neighbor: [neighbor.x, neighbor.width, neighbor.height], ours: [ours.x, ours.width, ours.height] },
    icon: { neighbor: [neighborIcon.x, neighborIcon.width], ours: [oursIcon.x, oursIcon.width] },
    label: { neighbor: neighborTitle.x, ours: oursLabel.x },
    font: {
      neighbor: [await pageStyle(page, 'ytd-guide-section-renderer[data-test="you"] ytd-guide-entry-renderer:nth-child(2) .title', 'font-size'), await pageStyle(page, 'ytd-guide-section-renderer[data-test="you"] ytd-guide-entry-renderer:nth-child(2) .title', 'line-height')],
      ours: [await sh.style(SECTION, '[data-key="f:f_sci"] > .row .label', 'font-size'), await sh.style(SECTION, '[data-key="f:f_sci"] > .row .label', 'line-height')]
    },
    radius: { neighbor: await pageStyle(page, 'ytd-guide-section-renderer[data-test="you"] ytd-guide-entry-renderer:nth-child(2)', 'border-top-left-radius'), ours: await sh.style(SECTION, '[data-key="f:f_sci"] > .row', 'border-top-left-radius') },
    sectionBorder: { neighbor: await pageStyle(page, 'ytd-guide-section-renderer[data-test="you"]', 'border-bottom'), ours: await sh.style(SECTION, '[data-part="section"]', 'border-bottom') }
  }
  test.info().annotations.push({ type: 'alignment', description: JSON.stringify(alignment) })
  expect(alignment.row.ours).toEqual(alignment.row.neighbor)
  expect(alignment.icon.ours).toEqual(alignment.icon.neighbor)
  expect(alignment.label.ours).toBe(alignment.label.neighbor)
  expect(alignment.font.ours).toEqual(alignment.font.neighbor)
  expect(alignment.radius.ours).toBe(alignment.radius.neighbor)
  expect(alignment.sectionBorder.ours).toBe(alignment.sectionBorder.neighbor)

  // opens the folder (children) and clicks it → pane with the videos from /ext/feed
  await sh.click(SECTION, '[data-key="f:f_tech"] > .row [data-part="toggle"]')
  await expect.poll(() => sh.count(SECTION, '[data-key="f:f_rust"]')).toBe(1)
  const since = Date.now()
  await sh.click(SECTION, '[data-key="f:f_tech"] > .row')
  const feedReq = await stub.waitFor((r) => r.key === 'GET /ext/feed', { since })
  expect(feedReq.query).toMatchObject({ folder: 'f_tech', limit: '20' })
  await expect.poll(() => sh.count(PANEL, '[data-part="video"]')).toBe(6)
  expect(await sh.text(PANEL, '[data-part="heading"]')).toBe('Tecnologia')
  expect((await sh.texts(PANEL, '[data-part="video"] [data-part="title"]'))[0]).toBe(VIDEOS[0][1])
  expect(await sh.attrs(PANEL, '[data-part="video"]', 'href')).toEqual(VIDEOS.map(([id]) => `https://www.youtube.com/watch?v=${id}`))
  const panelBox = (await sh.box(PANEL, '[data-part="panel"]'))!
  expect(panelBox.x).toBeGreaterThanOrEqual(240) // next to the guide, without covering it
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(1440)

  // mark as read: waits 5 s (Undo visible) and sends once
  const markAt = Date.now()
  await sh.click(PANEL, '[data-part="mark"]')
  await expect.poll(() => sh.text(PANEL, '[data-part="undo-bar"] button')).toBe('Desfazer')
  await page.waitForTimeout(3000)
  expect(stub.requests({ key: 'POST /ext/read' })).toHaveLength(0)
  const read = await stub.waitFor((r) => r.key === 'POST /ext/read', { since: markAt, timeout: 8000 })
  expect(read.at - markAt).toBeGreaterThanOrEqual(4800)
  expect(read.body).toEqual({ kind: 'folder', id: 'f_tech' })
  expect(read.headers.authorization).toMatch(/^Bearer /)
  await stub.waitFor((r) => r.key === 'GET /ext/state' && r.at >= read.at)
  await page.waitForTimeout(1500)
  expect(stub.requests({ key: 'POST /ext/read' })).toHaveLength(1)

  // Esc closes
  await page.keyboard.press('Escape')
  await expect.poll(() => sh.box(PANEL, '[data-part="panel"]').then((b) => (b ? b.width : 0))).toBe(0)
  void youtube
  await sh.close()
})

test('screenshots: expanded guide, pane, mini, disconnected (light and dark)', async ({ page, stub, youtube, seedPairing, context, serviceWorker }) => {
  test.setTimeout(120_000)
  useStub(stub)
  await routeThumbs(context)
  await seedPairing()
  const sh = await openYouTube(page)
  const screen = await Screen.open(page, { width: 1440, height: 960 })
  await expect.poll(() => sh.text(SECTION, '[data-part="total"]')).toBe('23')
  await sh.click(SECTION, '[data-key="f:f_tech"] > .row [data-part="toggle"]')
  await expect.poll(() => sh.count(SECTION, '[data-key="f:f_rust"]')).toBe(1)
  await page.mouse.move(900, 700)
  await screen.shoot('expanded', { x: 0, y: 0, width: 560, height: 960 })

  // pane open on a folder
  await sh.click(SECTION, '[data-key="f:f_tech"] > .row')
  await expect.poll(() => sh.count(PANEL, '[data-part="video"]')).toBe(6)
  await page.waitForTimeout(300) // thumbnails
  await page.mouse.move(1300, 900)
  await screen.shoot('panel', { x: 0, y: 0, width: 1000, height: 960 })
  await page.keyboard.press('Escape')

  // collapsed guide (mini) with the total
  await screen.set({ width: 1100, height: 760 })
  await expect.poll(() => sh.text(MINI, '[data-part="badge"]')).toBe('23')
  await expect.poll(() => sh.box(MINI, '[data-part="mini"]').then((b) => (b ? b.width : 0))).toBe(64)
  await page.mouse.move(800, 600)
  await screen.shoot('mini', { x: 0, y: 0, width: 420, height: 520 })

  // disconnected: the server goes away; the bar keeps the tree in a muted tone
  await screen.set({ width: 1440, height: 960 })
  await stub.close()
  await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.refreshState())
  await expect.poll(() => sh.text(SECTION, '[data-part="conn"]'), { timeout: 20_000 }).toBe('Abra o Hermes para reconectar')
  expect(await sh.count(SECTION, '[role="treeitem"]')).toBeGreaterThan(5)
  await page.mouse.move(900, 700)
  await screen.shoot('disconnected', { x: 0, y: 0, width: 560, height: 960 })
  void youtube
  await screen.close()
  await sh.close()
})

test('screenshot: empty state (no tabs or folders)', async ({ page, stub, youtube, seedPairing }) => {
  useStub(stub, { ...STATE, new_total: 0, tabs: [], folders: [] })
  await seedPairing()
  const sh = await openYouTube(page)
  await expect.poll(() => sh.text(SECTION, '[data-part="empty"]')).toBe('Organize seus canais em pastas no Hermes')
  expect(await sh.count(SECTION, '[data-part="total"]')).toBe(0)
  const screen = await Screen.open(page, { width: 1440, height: 960 })
  await page.mouse.move(900, 700)
  await screen.shoot('empty', { x: 0, y: 0, width: 560, height: 760 })
  void youtube
  await screen.close()
  await sh.close()
})
