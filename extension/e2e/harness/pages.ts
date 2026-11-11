// Saved YouTube pages served through `context.route`: the browser thinks it is on
// https://www.youtube.com/…, so the manifest's content scripts fire on the real origin — no network.
//
// - Document on www.youtube.com → file from tests/fixtures/ (table below; a scenario can pass its own) or a
//   minimal `<ytd-app>` page. Other www.youtube.com resources (player JS, images, XHR) → empty 404.
// - Any other external host (i.ytimg.com, fonts, ads) → aborted. 127.0.0.1/localhost and
//   chrome-extension:// go straight through (the service worker talks to the stub server).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Route } from '@playwright/test'
import { FIXTURES } from './paths.ts'

export interface SavedPage {
  match: (url: URL) => boolean
  /** path relative to tests/fixtures/ (read-only) */
  file?: string
  /** literal HTML (a new fixture stays in the scenario file) */
  html?: string
}

export const DEFAULT_PAGES: readonly SavedPage[] = [
  { match: (u) => u.pathname === '/feed/channels', file: 'mytube/feed-channels.synthetic.html' },
  { match: (u) => u.pathname === '/results', file: 'youtube/search/en-rust-programming.relevance.html' },
  { match: (u) => u.pathname === '/watch', file: 'youtube/watch/normal.KfODG5REyss.html' },
  { match: (u) => u.pathname.startsWith('/@'), file: 'youtube/channel/handle.Fireship.html' },
  { match: (u) => u.pathname.startsWith('/channel/'), file: 'youtube/channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html' }
]

export const BLANK_YOUTUBE_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>YouTube</title></head><body><ytd-app></ytd-app></body></html>'

export interface ServedPages {
  /** served documents: [url, file or "(inline)"/"(blank)"] */
  served: Array<[string, string]>
  /** aborted external requests */
  blocked: string[]
}

/** Installs the routes on the context. `pages` come before the defaults (first `match` wins). */
export async function serveSavedPages(context: BrowserContext, pages: readonly SavedPage[] = []): Promise<ServedPages> {
  const all = [...pages, ...DEFAULT_PAGES]
  const out: ServedPages = { served: [], blocked: [] }

  await context.route('https://www.youtube.com/**', async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.resourceType() !== 'document') return route.fulfill({ status: 404, body: '' })
    const page = all.find((p) => p.match(url))
    let body = BLANK_YOUTUBE_PAGE
    let label = '(blank)'
    if (page?.html !== undefined) {
      body = page.html
      label = '(inline)'
    } else if (page?.file) {
      body = readFileSync(join(FIXTURES, page.file), 'utf8')
      label = page.file
    }
    out.served.push([url.href, label])
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
  })

  // everything else outside loopback/extension/youtube: no network
  await context.route(/^https?:\/\/(?!www\.youtube\.com\/|127\.0\.0\.1[:/]|localhost[:/])/, (route) => {
    out.blocked.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  return out
}
