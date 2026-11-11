// Queue in the harness (Chrome for Testing, temporary profile, fake server, saved pages — never a real channel):
// 0. approved items alone run nothing: the popup lists them with "Run now" / "Not now" and the toolbar badge counts
//    them; only a click on "Run now" in the popup starts the round (every scenario below clicks it).
// 1. three approved items in `GET /ext/queue` → three `/channel/<id>` pages in a **visible** tab with the notice
//    "Cancelling n of 3 · <channel>" → button click + confirmation → the button becomes "Subscribe" → three `done` → the tab
//    closes and focus goes back to the origin tab.
// 2. the middle one opens a page that claims to be another channel → `failed/wrong_channel` with **zero clicks**; the other
//    two stay `done`.
// The channel pages are synthetic (built here): classic YouTube layout structure (the same as
// tests/fixtures/mytube/subscribe-button.synthetic.html), identity in the `<head>` and a script that imitates YouTube
// (click → dialog; confirm → button swaps). Each click is recorded in Node through `context.exposeBinding`.
import type { BrowserContext, Page, Route, Worker } from '@playwright/test'
import { expect, loadContractExamples, test, type StubServer } from '../harness/index.ts'

const IDS = ['UCe2eQueueAaaaaaaaaaaaaa', 'UCe2eQueueBbbbbbbbbbbbbb', 'UCe2eQueueCccccccccccccc']
const OTHER = 'UCe2eSomeoneElseZzzzzzzz'
const TITLES = ['Alpha Channel', 'Bravo Channel', 'Charlie Channel']

/** synthetic channel page: `urlId` is the channel in the URL; `pageId` is who the page claims to be */
function channelHtml(urlId: string, pageId: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} - YouTube</title>
<link rel="canonical" href="https://www.youtube.com/channel/${pageId}">
<meta property="og:url" content="https://www.youtube.com/channel/${pageId}">
<meta itemprop="identifier" content="${pageId}">
<script>window.ytcfg = { data_: {}, set(o) { Object.assign(this.data_, o) }, get(k) { return this.data_[k] } };
ytcfg.set({"LOGGED_IN":true});</script>
<script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"title":"${title}","externalId":"${pageId}"}}};</script>
</head><body><ytd-app>
<div id="page-header"><div id="channel-header-container"><div id="inner-header-container">
  <ytd-channel-name id="channel-name"><yt-formatted-string id="text">${title}</yt-formatted-string></ytd-channel-name>
  <div id="subscribe-button"><ytd-subscribe-button-renderer subscribed><yt-button-shape>
    <button class="yt-spec-button-shape-next yt-spec-button-shape-next--tonal" subscribed aria-label="Subscribed"><span>Subscribed</span></button>
  </yt-button-shape></ytd-subscribe-button-renderer></div>
</div></div></div>
<ytd-popup-container><tp-yt-paper-dialog role="dialog" aria-hidden="true" style="display: none;"><yt-confirm-dialog-renderer>
  <div id="main"><yt-formatted-string id="text">Unsubscribe from ${title}?</yt-formatted-string><div id="buttons">
    <yt-button-renderer id="cancel-button"><yt-button-shape><button aria-label="Cancel"><span>Cancel</span></button></yt-button-shape></yt-button-renderer>
    <yt-button-renderer id="confirm-button"><yt-button-shape><button aria-label="Unsubscribe"><span>Unsubscribe</span></button></yt-button-shape></yt-button-renderer>
  </div></div>
</yt-confirm-dialog-renderer></tp-yt-paper-dialog></ytd-popup-container>
</ytd-app>
<script>
(() => {
  const id = ${JSON.stringify(urlId)}
  const report = (what) => { try { window.__e2eClick(id, what) } catch (e) {} }
  const dialog = document.querySelector('tp-yt-paper-dialog')
  document.addEventListener('click', (e) => {
    const el = e.target
    if (el.closest('#subscribe-button button')) {
      report('header')
      setTimeout(() => { dialog.removeAttribute('aria-hidden'); dialog.style.display = '' }, 150)
      return
    }
    if (el.closest('#confirm-button')) {
      report('confirm')
      setTimeout(() => {
        dialog.setAttribute('aria-hidden', 'true'); dialog.style.display = 'none'
        const r = document.querySelector('ytd-subscribe-button-renderer'); r.removeAttribute('subscribed')
        const b = r.querySelector('button'); b.removeAttribute('subscribed')
        b.classList.replace('yt-spec-button-shape-next--tonal', 'yt-spec-button-shape-next--filled')
        b.setAttribute('aria-label', 'Subscribe'); b.textContent = 'Subscribe'
      }, 200)
      return
    }
    report('other')
  }, true)
})()
</script></body></html>`
}

type Result = { id: string; status: string; error: string | null }

/** queue on the fake server: one `approved` item at a time, none while there is a `running` */
function queueServer(stub: StubServer, ids: string[]) {
  const items = ids.map((channel_id, i) => ({
    id: `q_${i + 1}`,
    channel_id,
    action: 'unsubscribe' as const,
    status: 'approved',
    approved_at: 1762700000 + i,
    approved_via: 'desktop_rpc',
    created_at: 1762700000,
    updated_at: 1762700000,
    reason: null,
    error: null,
    device_id: null as string | null
  }))
  const results: Result[] = []
  const state = (loadContractExamples().routes['GET /ext/state'] as { data: Record<string, unknown> }).data
  const pending = () => items.filter((i) => i.status === 'approved').length
  stub.set('GET /ext/state', () => ({ body: { ok: true, data: { ...state, queue_pending: pending() } } }))
  stub.set('GET /ext/queue', (req) => {
    if (req.query.peek === '1') {
      // the listing for "Run now": nothing is lent
      const listed = items.filter((i) => i.status === 'approved')
      const channels = Object.fromEntries(listed.map((i) => [i.channel_id, { id: i.channel_id, title: TITLES[ids.indexOf(i.channel_id)], relation: 'subscribed', url: null, handle: null }]))
      return { body: { ok: true, data: { items: listed, channels } } }
    }
    if (items.some((i) => i.status === 'running')) return { body: { ok: true, data: { items: [], channels: {} } } }
    const next = items.find((i) => i.status === 'approved')
    if (!next) return { body: { ok: true, data: { items: [], channels: {} } } }
    next.device_id = 'dev_stub'
    const idx = ids.indexOf(next.channel_id)
    const channel = { id: next.channel_id, title: TITLES[idx], relation: 'subscribed', url: null, handle: null }
    return { body: { ok: true, data: { items: [next], channels: { [next.channel_id]: channel } } } }
  })
  stub.set('POST /ext/queue/{id}/result', (req, params) => {
    const body = req.body as { status: string; error?: string | null }
    const it = items.find((i) => i.id === params.id)
    if (!it) return { status: 404, body: { ok: false, error: { code: 'not_found', message: 'no item' } } }
    if (body.status !== 'running') results.push({ id: it.id, status: body.status, error: body.error ?? null })
    it.status = body.status
    return { body: { ok: true, data: it } }
  })
  return { items, results }
}

const tabsOf = (sw: Worker): Promise<Array<{ id: number; url: string; active: boolean }>> =>
  sw.evaluate(async () => {
    const c = (globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<Array<{ id: number; url: string; active: boolean }>> } } }).chrome
    return (await c.tabs.query({})).map((t) => ({ id: t.id, url: t.url, active: t.active }))
  })

/** channel pages: own route registered **after** the harness's (wins); `pageIdOf` says who the page claims to be */
async function serveChannels(context: BrowserContext, pageIdOf: (urlId: string) => string): Promise<string[]> {
  const served: string[] = []
  await context.route(/^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}/, async (route: Route) => {
    const url = new URL(route.request().url())
    if (route.request().resourceType() !== 'document') return route.fulfill({ status: 404, body: '' })
    const urlId = url.pathname.split('/')[2]
    const idx = IDS.indexOf(urlId)
    served.push(urlId)
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: channelHtml(urlId, pageIdOf(urlId), TITLES[idx] ?? 'Unknown') })
  })
  return served
}

/** while the queue runs: the notice shows up in the channel tab (text read from inside the shadow DOM) */
function overlayWatcher(context: BrowserContext) {
  const seen = new Set<string>()
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      for (const p of context.pages()) {
        if (!p.url().includes('/channel/')) continue
        const text = await p
          // Playwright's locator pierces the notice's open shadow DOM
          .locator('tube-queue-overlay .card')
          .first()
          .textContent({ timeout: 200 })
          .catch(() => null)
        if (text) seen.add(text.replace(/\s+/g, ' ').trim())
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  })()
  return {
    seen,
    async stop() {
      stopped = true
      await loop
    }
  }
}

/**
 * The human click: opens the popup in its own tab, waits for the "Run now" card and clicks it. The popup tab stays
 * open and in front, so it is the round's origin tab (in Chrome the popup floats over the user's tab, which is the
 * origin there); returns its URL.
 */
async function runNow(context: BrowserContext, extensionId: string, expectLine: RegExp): Promise<string> {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await popup.bringToFront()
  await expect(popup.getByTestId('queue-line')).toHaveText(expectLine, { timeout: 30_000 })
  await popup.getByTestId('queue-run-now').click()
  return popup.url()
}

async function originPage(page: Page): Promise<string> {
  await page.goto('https://www.youtube.com/')
  await page.bringToFront()
  return page.url()
}

test('approved items alone run nothing: the popup asks first (Run now / Not now)', async ({ context, page, serviceWorker, stub, youtube, seedPairing, extensionId }) => {
  test.setTimeout(60_000)
  void youtube
  await serveChannels(context, (id) => id)
  const q = queueServer(stub, IDS)
  await originPage(page)
  await seedPairing()
  // a few ExtStates go by (the core refreshes on pairing; the popup probes again)
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await expect(popup.getByTestId('queue-line')).toHaveText(/3 approved unsubscribes are waiting/, { timeout: 30_000 })
  await expect(popup.getByTestId('queue-waiting-list')).toContainText('Alpha Channel')
  await expect(popup.getByTestId('queue-run-now')).toHaveText('Run now')
  await expect(popup.getByTestId('queue-not-now')).toHaveText('Not now')
  await popup.waitForTimeout(3000)
  expect(q.results).toEqual([])
  expect(stub.requests().filter((r) => r.key === 'POST /ext/queue/{id}/result')).toEqual([])
  expect(stub.requests().filter((r) => r.key === 'GET /ext/queue' && r.query.peek !== '1')).toEqual([])
  expect((await tabsOf(serviceWorker)).filter((t) => t.url.includes('/channel/'))).toEqual([])
  await popup.getByTestId('queue-not-now').click()
  await expect(popup.getByTestId('queue-card')).toHaveCount(0)
  expect(q.results).toEqual([])
})

test('3 approved items → 3 pages → 3 done, with notice; the tab closes and focus comes back', async ({ context, page, serviceWorker, stub, youtube, seedPairing, extensionId }) => {
  test.setTimeout(120_000)
  void youtube
  const clicks: Array<[string, string]> = []
  await context.exposeBinding('__e2eClick', (_src, id: string, what: string) => void clicks.push([id, what]))
  const served = await serveChannels(context, (id) => id)
  const q = queueServer(stub, IDS)
  await originPage(page)
  const watcher = overlayWatcher(context)
  let originUrl = ''
  try {
    await seedPairing() // the ExtState (queue_pending 3) lists the items; the click starts the round
    originUrl = await runNow(context, extensionId, /3 approved unsubscribes are waiting/)
    await expect.poll(() => q.results.length, { timeout: 60_000, intervals: [200] }).toBe(3)
  } finally {
    await watcher.stop()
  }
  console.log('[queue] results:', JSON.stringify(q.results), 'clicks:', JSON.stringify(clicks), 'notice:', JSON.stringify([...watcher.seen]))
  expect(q.results).toEqual([
    { id: 'q_1', status: 'done', error: null },
    { id: 'q_2', status: 'done', error: null },
    { id: 'q_3', status: 'done', error: null }
  ])
  expect(served).toEqual(IDS) // one page per item, by id, in order
  for (const id of IDS) expect(clicks.filter(([c]) => c === id).map(([, w]) => w)).toEqual(['header', 'confirm'])
  // the notice appeared with the progress
  expect([...watcher.seen].some((t) => /Cancelling 1 of 3 · Alpha Channel/.test(t))).toBe(true)
  expect([...watcher.seen].some((t) => /Stop/.test(t))).toBe(true)
  // one at a time: each `running` only after the previous result
  const keys = stub.requests().filter((r) => r.key === 'POST /ext/queue/{id}/result').map((r) => `${r.path.split('/')[3]}:${(r.body as { status: string }).status}`)
  expect(keys).toEqual(['q_1:running', 'q_1:done', 'q_2:running', 'q_2:done', 'q_3:running', 'q_3:done'])
  // the queue tab closes and the origin becomes the active one again
  await expect.poll(async () => (await tabsOf(serviceWorker)).filter((t) => t.url.includes('/channel/')).length).toBe(0)
  await expect.poll(async () => (await tabsOf(serviceWorker)).find((t) => t.url === originUrl)?.active).toBe(true)
  const run = await serviceWorker.evaluate(async () => {
    const c = (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } } }).chrome
    return (await c.storage.local.get('queue_run')).queue_run
  })
  expect(run).toMatchObject({ state: 'idle', done: 3, failed: 0 })
})

test('wrong_channel in the middle: zero clicks on it, the other two done', async ({ context, page, serviceWorker, stub, youtube, seedPairing, extensionId }) => {
  test.setTimeout(120_000)
  void youtube
  const clicks: Array<[string, string]> = []
  await context.exposeBinding('__e2eClick', (_src, id: string, what: string) => void clicks.push([id, what]))
  await serveChannels(context, (id) => (id === IDS[1] ? OTHER : id))
  const q = queueServer(stub, IDS)
  await originPage(page)
  await seedPairing()
  const originUrl = await runNow(context, extensionId, /3 approved unsubscribes are waiting/)
  await expect.poll(() => q.results.length, { timeout: 60_000, intervals: [200] }).toBe(3)
  console.log('[queue] results:', JSON.stringify(q.results), 'clicks:', JSON.stringify(clicks))
  expect(q.results).toEqual([
    { id: 'q_1', status: 'done', error: null },
    { id: 'q_2', status: 'failed', error: 'wrong_channel' },
    { id: 'q_3', status: 'done', error: null }
  ])
  expect(clicks.filter(([c]) => c === IDS[1])).toEqual([])
  expect(clicks.filter(([c]) => c === IDS[0]).length).toBe(2)
  expect(clicks.filter(([c]) => c === IDS[2]).length).toBe(2)
  await expect.poll(async () => (await tabsOf(serviceWorker)).filter((t) => t.url.includes('/channel/')).length).toBe(0)
  await expect.poll(async () => (await tabsOf(serviceWorker)).find((t) => t.url === originUrl)?.active).toBe(true)
})
