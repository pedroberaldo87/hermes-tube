// Node side of the public screenshots (scripts/docs-screenshots.mjs and scripts/docs-sidebar.spec.ts):
//  - `scanText`: rules for the visible text of a capture (no Portuguese, placeholder, internal id, real channel name
//    or YouTube product/trademark wording; the labels the alt text promises are on screen);
//  - `sampleAnswer`: what the capture answers for each network request. Thumbnails come from
//    docs/sample-data/thumbs/<video id>.jpg and avatars are drawn from the channel's monogram in
//    docs/sample-data/catalog.json; every other request is blocked and named, so nothing reaches YouTube or Google.
// Types in capture.d.mts. Tests: capture.test.ts.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const SAMPLE_DIR = join(REPO_ROOT, 'docs', 'sample-data')

const readJson = (...p) => JSON.parse(readFileSync(join(REPO_ROOT, ...p), 'utf8'))

/** The invented sample catalog (folders, channels, videos and the topic tab). */
export const SAMPLE_CATALOG = readJson('docs', 'sample-data', 'catalog.json')

/** Titles of the real public channels of the built-in demo: none of them may appear in a public image. */
export const REAL_CHANNEL_TITLES = readJson('plugin', 'data', 'demo_channels.json').channels.map((c) => c.title)

// ------------------------------------------------------------------ visible text

const PORTUGUESE = [
  /[ãõçâêô]/i,
  /\b(não|você|vídeos?|canais|canal|pastas?|abas?|novos?|novas?|tudo|favoritos?|assistir|assistido|depois|limpeza|inscriç\w*|carregando|buscar?|ciência|tecnologia|música|notícias|culinária|aprovar|cancelar|salvar|excluir|editar|mover|nenhum|agora|ontem|hoje|semana|dias?|horas?|minutos?|visualizações|tema|assunto|motivo|ia)\b/i,
  // function words that English never uses on their own
  /\b(de|da|dos|das|em|para|com|uma|que|ao|seus|suas|sem|mais|pelo|pela|nos|nas)\b/
]
const PLACEHOLDER = [/\bTODO\b/, /\bFIXME\b/, /lorem/i, /ipsum/i, /\bundefined\b/, /\bNaN\b/, /\[object /, /\{\{|\}\}/]
const INTERNAL = [/\bUC[\w-]{22}\b/, /\b(f|tab|th|job|sg|cg)_[a-z0-9_]+\b/, /\b[a-z]+\.[a-z_]+\.[a-z_]+\b/, /@[\w.-]+\.(local|lan)\b/, /\/Users\//, /localhost|127\.0\.0\.1/]
/**
 * YouTube and Google product names and trademark signs. Plain "YouTube" stays allowed: the plugin works with
 * YouTube and says so ("Open on YouTube", "Not affiliated with YouTube").
 */
const BRAND = [/\bYouTube\s+(Premium|Music|Kids|TV|Studio|Shorts|Originals|Red)\b/i, /\bGoogle\b/i, /[™®©]/]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A real title as a whole word (exact case: "COLORS" is a channel, "colors" is a word). */
const REAL = REAL_CHANNEL_TITLES.map((t) => [t, new RegExp(`(?<![\\w])${escapeRe(t)}(?![\\w])`)])

/**
 * Problems in the visible text of one capture (empty = clean).
 * @param {string} text visible lines, joined with "\n"
 * @param {{ expect?: string[], pluginId?: string }} [options] labels that must appear; the plugin id (never on screen)
 * @returns {string[]}
 */
export function scanText(text, { expect = [], pluginId = '' } = {}) {
  const problems = []
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const short = line.slice(0, 80)
    if (PORTUGUESE.some((re) => re.test(line))) problems.push(`portuguese? "${short}"`)
    if (PLACEHOLDER.some((re) => re.test(line))) problems.push(`placeholder? "${short}"`)
    if (INTERNAL.some((re) => re.test(line))) problems.push(`internal id? "${short}"`)
    if (BRAND.some((re) => re.test(line))) problems.push(`brand wording: "${short}"`)
    for (const [title, re] of REAL) if (re.test(line)) problems.push(`real channel "${title}": "${short}"`)
    if (pluginId && line.includes(pluginId)) problems.push(`plugin id on screen: "${short}"`)
  }
  for (const label of expect) if (!text.includes(label)) problems.push(`missing label "${label}"`)
  return problems
}

// ------------------------------------------------------------------ network

const AVATARS = new Map([...SAMPLE_CATALOG.channels, ...SAMPLE_CATALOG.topic.channels].map((c) => [c.id, c.avatar]))
const VIDEO_IDS = new Set([...SAMPLE_CATALOG.videos, ...SAMPLE_CATALOG.topic.videos].map((v) => v.id))

/** Address of a sample channel's avatar, on a YouTube image host (the only kind the app loads). */
export const sampleAvatarUrl = (channelId) => `https://yt3.googleusercontent.com/sample-avatar/${channelId}=s176-c-k-c0x00ffffff-no-rj`

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A square avatar: the channel's monogram in its colors (the app crops it round). */
export function avatarSvg({ bg, fg, monogram }) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176" viewBox="0 0 176 176">' +
    `<rect width="176" height="176" fill="${xml(bg)}"/>` +
    `<text x="88" y="90" fill="${xml(fg)}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="72" font-weight="600" ` +
    `letter-spacing="-2" text-anchor="middle" dominant-baseline="central">${xml(monogram)}</text></svg>`
  )
}

/**
 * The answer to one request of the page under capture: a sample image, or `{ blocked }` with the reason and the URL.
 * `file:`, `data:` and `blob:` addresses never get here (the caller lets them through).
 * @param {string} url
 */
export function sampleAnswer(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { blocked: `blocked request (bad URL): ${url}` }
  }
  const host = u.hostname.toLowerCase()
  if (host === 'i.ytimg.com') {
    const id = u.pathname.match(/^\/vi(?:_webp)?\/([\w-]{11})\/[\w-]+\.(?:jpg|webp)$/)?.[1]
    const file = id && VIDEO_IDS.has(id) ? join(SAMPLE_DIR, 'thumbs', `${id}.jpg`) : null
    if (file && existsSync(file)) return { status: 200, contentType: 'image/jpeg', body: readFileSync(file), file }
    return { blocked: `blocked request (not a sample thumbnail): ${url}` }
  }
  if (host === 'yt3.googleusercontent.com' || host.endsWith('.ggpht.com')) {
    const id = u.pathname.match(/^\/sample-avatar\/(UC[\w-]{22})(?:=|$)/)?.[1]
    const avatar = id ? AVATARS.get(id) : undefined
    if (avatar) return { status: 200, contentType: 'image/svg+xml', body: Buffer.from(avatarSvg(avatar)), file: null }
    return { blocked: `blocked request (not a sample avatar): ${url}` }
  }
  return { blocked: `blocked request: ${url}` }
}
