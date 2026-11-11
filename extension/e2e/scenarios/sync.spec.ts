// Sync in the harness (Chrome for Testing, temporary profile, no network, never a real channel):
// 1. paired → `sync.now` → (visible) tab on /feed/channels (saved page) → the fake server receives the whole list
//    with `complete` and `channel_id` on every item → the tab closes.
// 2. synthetic /watch (12 s video generated on the page, really playing) → the tracker counts > 60 % → `sync.watch`
//    → outbox → `POST /ext/sync/watch` reaches the fake server.
// 3. not paired: `sync.now` refuses (unauthorized/unpaired) and does not open a tab.
import { ALARMS, STORAGE_KEYS } from '../../../shared/ext-messages.ts'
import { expect, test, type SwScope } from '../harness/index.ts'

const SYNTH_IDS = [
  'UCHnyfMqiRRG1u-2MsSQLbXA',
  'UCsBjURrPoezykLs9EqgamOA',
  'UCYO_jab_esuFRV4b17AJtAw',
  'UCsXVk37bltHxD1rDPwtNM8Q',
  'UCKHhA5hN2UohhFDfNXB_cvQ',
  'UCn9Erjy00mpnWeLnRqhsA1g',
  'UCLA_DiR1FfKNvjuUpBHmylQ',
  'UC9-y-6csu5WGm29I7JiwpnA',
  'UCSUu1lih2RifWkKtDOJdsBA',
  'UCj1VqrHhDte54oLgPG4xpuQ'
]

const VIDEO_ID = 'synthSyncVd'
const OWNER_ID = 'UCsBjURrPoezykLs9EqgamOA'

/** synthetic /watch: player with the same skeleton as YouTube and a silent 12 s WAV generated on the spot (blob:, no network) */
const WATCH_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic watch - YouTube</title></head>
<body><ytd-app><ytd-watch-flexy video-id="${VIDEO_ID}">
<div id="movie_player" class="html5-video-player"><video class="html5-main-video" muted playsinline></video></div>
<ytd-video-owner-renderer><a href="/channel/${OWNER_ID}">Fireship</a></ytd-video-owner-renderer>
</ytd-watch-flexy></ytd-app>
<script>
(() => {
  const sr = 8000, secs = 12, n = sr * secs
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true)
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  const video = document.querySelector('video')
  video.muted = true
  video.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
  // only plays after the content script attached the tracker (the short video cannot start before)
  const html = document.documentElement
  const go = () => {
    if (!/content\\/tracker/.test(html.getAttribute('data-tube-ext-modules') || '')) return false
    video.play().catch((e) => document.title = 'play failed: ' + e)
    return true
  }
  if (!go()) {
    const mo = new MutationObserver(() => { if (go()) mo.disconnect() })
    mo.observe(html, { attributes: true, attributeFilter: ['data-tube-ext-modules'] })
  }
})()
</script></body></html>`

test.use({ savedPages: [{ match: (u) => u.pathname === '/watch', html: WATCH_HTML }] })

const readKey = (sw: import('@playwright/test').Worker, key: string) =>
  sw.evaluate(async (k) => (await (globalThis as unknown as SwScope).chrome.storage.local.get(k))[k], key)

test('paired → sync.now → fake server receives the list with complete and ids; the (visible) tab closes', async ({
  context,
  serviceWorker,
  stub,
  youtube,
  seedPairing
}) => {
  await seedPairing()
  const since = Date.now()
  const r = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.dispatch({ type: 'sync.now', payload: {} }))
  expect(r).toEqual({ ok: true, data: { started: true } })

  const req = await stub.waitFor((x) => x.key === 'POST /ext/sync/subscriptions', { since, timeout: 45_000 })
  const body = req.body as { signal: string; channels: Array<{ channel_id: string; title: string }> }
  expect(req.headers.authorization).toBe(`Bearer ${stub.token}`)
  expect(body.signal).toBe('complete')
  expect(body.channels.map((c) => c.channel_id).sort()).toEqual([...SYNTH_IDS].sort())
  for (const c of body.channels) expect(c.channel_id, c.title).toMatch(/^UC[\w-]{22}$/)
  expect(youtube.served.map(([u]) => u)).toContain('https://www.youtube.com/feed/channels')

  await expect.poll(async () => ((await readKey(serviceWorker, 'sync_status')) as { state?: string } | undefined)?.state).toBe('ok')
  await expect.poll(() => context.pages().filter((p) => p.url().includes('/feed/channels')).length).toBe(0)
})

test('synthetic /watch: > 60 % played → event reaches POST /ext/sync/watch', async ({ page, serviceWorker, stub, youtube, seedPairing }) => {
  await seedPairing()
  void youtube
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
  await expect(page.locator('html')).toHaveAttribute('data-tube-ext-modules', /content\/tracker/)
  // the video really plays (12 s WAV): the position moves
  await expect.poll(() => page.evaluate<number>('document.querySelector("video")?.currentTime ?? 0'), { timeout: 10_000 }).toBeGreaterThan(1)

  // > 7.2 s played → the tracker sends sync.watch → background outbox (or already sent by the 30 s alarm)
  const queuedOrSent = async () =>
    (((await readKey(serviceWorker, STORAGE_KEYS.watchOutbox)) as unknown[] | undefined)?.length ?? 0) +
    stub.requests({ key: 'POST /ext/sync/watch' }).length
  try {
    await expect.poll(queuedOrSent, { timeout: 20_000 }).toBeGreaterThan(0)
  } catch (e) {
    const diag = await page.evaluate<string>(
      'JSON.stringify({t: document.querySelector("video")?.currentTime, d: document.querySelector("video")?.duration, ' +
        'ended: document.querySelector("video")?.ended, title: document.title, mods: document.documentElement.getAttribute("data-tube-ext-modules")})'
    )
    throw new Error(`no event: ${diag}\n${String(e)}`)
  }

  // state cycle (= 30 s alarm) empties the outbox
  await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.refreshState())
  const req = await stub.waitFor((x) => x.key === 'POST /ext/sync/watch', { timeout: 15_000 })
  const events = (req.body as { events: Array<{ video_id: string; watched_at: number; channel_id: string | null }> }).events
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ video_id: VIDEO_ID, channel_id: OWNER_ID })
  expect(Math.abs(events[0].watched_at - Date.now() / 1000)).toBeLessThan(60)
  await expect.poll(async () => ((await readKey(serviceWorker, STORAGE_KEYS.watchOutbox)) as unknown[] | undefined)?.length ?? 0).toBe(0)
})

test('not paired: sync.now refuses and does not open a tab', async ({ context, serviceWorker, youtube }) => {
  void youtube
  const r = (await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.dispatch({ type: 'sync.now', payload: {} }))) as {
    ok: boolean
    error?: { code: string; reason?: string }
  }
  expect(r.ok).toBe(false)
  expect(r.error).toMatchObject({ code: 'unauthorized', reason: 'unpaired' })
  await new Promise((res) => setTimeout(res, 500))
  expect(context.pages().filter((p) => p.url().includes('/feed/channels'))).toHaveLength(0)
})

// ================================================================ sync that does not depend on a background tab
//
// Synthetic /feed/channels page whose continuation **only loads when the tab is visible**: an
// IntersectionObserver on the `ytd-continuation-item-renderer` (like YouTube) and, besides it, the requirement that the tab be
// in view. The harness's headless Chrome reports every tab as `visible` and renders background tabs (measured: a tab created
// with `active:false` gave `visibilityState = visible` and the IntersectionObserver fired) — so visibility is
// **emulated** from the tab's real state in the browser: `chrome.tabs.query` → `active` of the /feed/channels tab →
// `window.__e2eSetVisible(active)` on the page (bridge below, every 150 ms). In a windowed Chrome, a background tab does not even
// fire the IntersectionObserver; here it fires but the page refuses — the effect for the scraper is the same.
// Each batch swaps the continuation element (like YouTube). The `exposeTrigger` variant puts on the element a
// `trigger()` method that loads the next batch even when hidden (what the MAIN world trigger looks for).

const BATCHES = 3
const PER_BATCH = 8
const e2eId = (n: number) => `UC${`e2eb${n}`.padStart(22, 'x')}`
const ALL_IDS = Array.from({ length: BATCHES * PER_BATCH }, (_, i) => e2eId(i + 1))

function lazyFeedHtml({ exposeTrigger = false } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Subscriptions - YouTube</title>
<script>window.ytcfg = { data_: {}, set(o) { Object.assign(this.data_, o) }, get(k) { return this.data_[k] } };
ytcfg.set({"LOGGED_IN":true});</script>
<style>ytd-channel-renderer{display:block;height:120px;border-bottom:1px solid #ccc}
ytd-continuation-item-renderer{display:block;height:48px}</style></head>
<body><ytd-app><ytd-browse page-subtype="channels"><div id="contents"></div></ytd-browse></ytd-app>
<script>
(() => {
  const BATCHES = ${BATCHES}, PER = ${PER_BATCH}, EXPOSE = ${exposeTrigger}
  const id = (n) => 'UC' + ('e2eb' + n).padStart(22, 'x')
  const item = (n) => '<ytd-channel-renderer><div id="avatar-section"><a id="main-link" href="/channel/' + id(n) + '">' +
    '<div id="avatar"><img src="https://yt3.ggpht.com/e2e' + n + '=s88"></div></a></div><div id="info-section">' +
    '<a id="channel-info" href="/channel/' + id(n) + '"><ytd-channel-name><yt-formatted-string id="text">E2E ' + n +
    '</yt-formatted-string></ytd-channel-name></a></div></ytd-channel-renderer>'
  const contents = document.getElementById('contents')
  const log = (window.__e2eLog = { io: 0, ioVisibleRefused: 0, scrollEvents: 0, loads: [], triggerCalls: 0 })
  let visible = false, intersecting = false, loading = false, loaded = 0, cont = null
  window.addEventListener('scroll', () => log.scrollEvents++, true)
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.target === cont) { intersecting = e.isIntersecting; if (intersecting) log.io++ }
    maybeLoad('io')
  })
  function addBatch() {
    const start = loaded * PER
    contents.insertAdjacentHTML('beforeend', Array.from({ length: PER }, (_, i) => item(start + i + 1)).join(''))
    loaded++
    if (cont) { io.unobserve(cont); cont.remove(); cont = null }
    intersecting = false
    if (loaded >= BATCHES) return
    cont = document.createElement('ytd-continuation-item-renderer')
    cont.innerHTML = '<tp-yt-paper-spinner active></tp-yt-paper-spinner>'
    if (EXPOSE) cont.trigger = function () { log.triggerCalls++; load('trigger') }
    contents.append(cont)
    io.observe(cont)
  }
  function load(via) {
    if (loading || !cont) return
    loading = true
    setTimeout(() => { log.loads.push(via); addBatch(); loading = false }, 300)
  }
  function maybeLoad(via) {
    if (!intersecting || !cont) return
    if (!visible) { log.ioVisibleRefused++; return }
    load(via)
  }
  window.__e2eSetVisible = (v) => { if (visible === v) return; visible = v; maybeLoad('visible') }
  addBatch()
})()
</script></body></html>`
}

type TabInfo = { id: number; url: string; active: boolean; windowId: number }
type E2eLog = { io: number; ioVisibleRefused: number; scrollEvents: number; loads: string[]; triggerCalls: number; nudge: string | null }

const tabsOf = (sw: import('@playwright/test').Worker): Promise<TabInfo[]> =>
  sw.evaluate(async () => {
    const c = (globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<TabInfo[]> } } }).chrome
    return (await c.tabs.query({})).map((t) => ({ id: t.id, url: t.url, active: t.active, windowId: t.windowId }))
  })

/**
 * Visibility bridge (emulation, see above) + record of what the page saw while alive (the tab closes at the end).
 * `snapshots` keeps the last `__e2eLog` + `data-tube-nudge` of each /feed/channels tab, in order.
 */
function visibilityBridge(context: import('@playwright/test').BrowserContext, sw: import('@playwright/test').Worker) {
  let stopped = false
  const snapshots = new Map<import('@playwright/test').Page, E2eLog & { visible: boolean }>()
  const loop = (async () => {
    while (!stopped) {
      const tabs = await tabsOf(sw).catch(() => [] as TabInfo[])
      for (const p of context.pages()) {
        if (!p.url().includes('/feed/channels')) continue
        const visible = tabs.find((t) => t.url === p.url())?.active === true
        const snap = await p
          .evaluate(
            (v) => {
              // tsconfig.node.json has no DOM lib: page scope through globalThis
              const w = globalThis as unknown as {
                __e2eSetVisible?: (v: boolean) => void
                __e2eLog?: object
                document: { documentElement: { getAttribute(n: string): string | null } }
              }
              w.__e2eSetVisible?.(v)
              return w.__e2eLog ? { ...w.__e2eLog, nudge: w.document.documentElement.getAttribute('data-tube-nudge') } : null
            },
            visible
          )
          .catch(() => null)
        if (snap) snapshots.set(p, { ...(snap as E2eLog), visible })
      }
      await new Promise((r) => setTimeout(r, 150))
    }
  })()
  return {
    snapshots,
    async stop() {
      stopped = true
      await loop
    }
  }
}

const fireSyncAlarm = (sw: import('@playwright/test').Worker) =>
  sw.evaluate(async (name) => {
    // unpacked extension: Chrome does not enforce chrome.alarms' 30 s minimum
    const c = (globalThis as unknown as { chrome: { alarms: { create(n: string, i: object): Promise<void> } } }).chrome
    await c.alarms.create(name, { when: Date.now() + 50 })
  }, ALARMS.sync)

/** the tab is born at about:blank and navigated afterwards: waits for the /feed/channels one to appear */
async function feedPage(context: import('@playwright/test').BrowserContext): Promise<import('@playwright/test').Page> {
  const find = () => context.pages().find((p) => p.url().includes('/feed/channels'))
  await expect.poll(() => find() !== undefined, { timeout: 20_000, intervals: [50] }).toBe(true)
  return find()!
}

type Status = { state: string; trigger: string; signal: string | null; reason: string | null; needs_visible?: boolean; error: { code: string } | null }
const syncStatus = async (sw: import('@playwright/test').Worker) => (await readKey(sw, STORAGE_KEYS.syncStatus)) as Status | undefined

test.describe('continuation that only loads with the visible tab', () => {
  // a single item: Playwright reads `[a, b]` as the fixture's `[value, options]` tuple
  test.use({ savedPages: [{ match: (u) => u.pathname === '/feed/channels', html: lazyFeedHtml() }] })

  test('alarm (background tab) stalls → partial + needs_visible; "sync now" (visible) → complete with all ids and focus returned', async ({
    context,
    page,
    serviceWorker,
    stub,
    youtube,
    seedPairing
  }) => {
    test.setTimeout(150_000)
    void youtube
    await seedPairing()
    await page.goto('https://www.youtube.com/')
    await page.bringToFront()
    const originUrl = page.url()
    const bridge = visibilityBridge(context, serviceWorker)
    try {
      // ---- 1. alarm: background tab
      let since = Date.now()
      await fireSyncAlarm(serviceWorker)
      const feedBg = await feedPage(context)
      await expect.poll(async () => (await tabsOf(serviceWorker)).find((t) => t.url.includes('/feed/channels'))?.active).toBe(false)
      await expect(feedBg.locator('ytd-channel-renderer')).toHaveCount(PER_BATCH)
      expect(await feedBg.locator('tube-sync-overlay').count()).toBe(0) // background: no notice
      const bgReq = await stub.waitFor((x) => x.key === 'POST /ext/sync/subscriptions', { since, timeout: 60_000 })
      const bgBody = bgReq.body as { signal: string; channels: Array<{ channel_id: string }> }
      expect(bgBody.signal).toBe('partial')
      expect(bgBody.channels.map((c) => c.channel_id).sort()).toEqual(ALL_IDS.slice(0, PER_BATCH).sort())
      await expect.poll(async () => (await syncStatus(serviceWorker))?.state).toBe('ok')
      expect(await syncStatus(serviceWorker)).toMatchObject({ trigger: 'alarm', signal: 'partial', reason: 'scroll_stalled', needs_visible: true })
      const bgSnap = bridge.snapshots.get(feedBg)
      console.log('[sync] background tab (alarm):', JSON.stringify(bgSnap))
      expect(bgSnap).toMatchObject({ visible: false, loads: [], nudge: 'none' })
      expect(bgSnap!.ioVisibleRefused).toBeGreaterThan(0) // the item entered the screen (scrollIntoView), the page refused
      expect(bgSnap!.scrollEvents).toBeGreaterThan(5) // stepped scrolling arrived as a scroll event
      // origin stays in view; no new firing
      const tabs1 = await tabsOf(serviceWorker)
      expect(tabs1.find((t) => t.url === originUrl)?.active).toBe(true)
      expect(tabs1.filter((t) => t.url.includes('/feed/channels'))).toHaveLength(0)
      await new Promise((r) => setTimeout(r, 1500))
      expect(stub.requests({ key: 'POST /ext/sync/subscriptions' }).filter((x) => x.at >= since)).toHaveLength(1)

      // ---- 2. "sync now": visible tab, notice with counter, complete, focus returned
      since = Date.now()
      const r = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.dispatch({ type: 'sync.now', payload: {} }))
      expect(r).toEqual({ ok: true, data: { started: true } })
      const feedFg = await feedPage(context)
      await expect.poll(async () => (await tabsOf(serviceWorker)).find((t) => t.url.includes('/feed/channels'))?.active).toBe(true)
      const overlay = feedFg.locator('tube-sync-overlay')
      await expect(overlay).toHaveCount(1)
      await expect(overlay.locator('[data-role="count"]')).toContainText(/\d+/)
      await expect(overlay.getByRole('button')).toHaveText('Cancel')
      const fgReq = await stub.waitFor((x) => x.key === 'POST /ext/sync/subscriptions', { since, timeout: 60_000 })
      const fgBody = fgReq.body as { signal: string; channels: Array<{ channel_id: string }> }
      expect(fgBody.signal).toBe('complete')
      expect(fgBody.channels.map((c) => c.channel_id).sort()).toEqual([...ALL_IDS].sort())
      await expect.poll(async () => (await syncStatus(serviceWorker))?.trigger).toBe('manual')
      await expect.poll(async () => (await syncStatus(serviceWorker))?.state).toBe('ok')
      expect(await syncStatus(serviceWorker)).toMatchObject({ signal: 'complete', needs_visible: false })
      const fgSnap = bridge.snapshots.get(feedFg)
      console.log('[sync] visible tab (sync now):', JSON.stringify(fgSnap))
      expect(fgSnap?.loads.length).toBe(BATCHES - 1)
      await expect.poll(async () => (await tabsOf(serviceWorker)).filter((t) => t.url.includes('/feed/channels')).length).toBe(0)
      await expect.poll(async () => (await tabsOf(serviceWorker)).find((t) => t.url === originUrl)?.active).toBe(true)
    } finally {
      await bridge.stop()
    }
  })

  test('Esc on the notice cancels: nothing sent, cancelled state, tab closed and focus returned', async ({ context, page, serviceWorker, stub, youtube, seedPairing }) => {
    test.setTimeout(90_000)
    void youtube
    await seedPairing()
    await page.goto('https://www.youtube.com/')
    await page.bringToFront()
    const originUrl = page.url()
    const since = Date.now()
    // without the visibility bridge: the list never moves, the notice stays until the user cancels
    await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.dispatch({ type: 'sync.now', payload: {} }))
    const feed = await feedPage(context)
    await expect(feed.locator('tube-sync-overlay')).toHaveCount(1)
    await expect(feed.locator('tube-sync-overlay [data-role="count"]')).toContainText(String(PER_BATCH))
    await feed.keyboard.press('Escape')
    await expect.poll(async () => (await syncStatus(serviceWorker))?.state, { timeout: 15_000 }).toBe('error')
    expect(await syncStatus(serviceWorker)).toMatchObject({ trigger: 'manual', error: { code: 'cancelled' } })
    expect(stub.requests({ key: 'POST /ext/sync/subscriptions' }).filter((x) => x.at >= since)).toHaveLength(0)
    await expect.poll(async () => (await tabsOf(serviceWorker)).filter((t) => t.url.includes('/feed/channels')).length).toBe(0)
    await expect.poll(async () => (await tabsOf(serviceWorker)).find((t) => t.url === originUrl)?.active).toBe(true)
  })
})

test.describe('MAIN world trigger when the element exposes the loading', () => {
  test.use({ savedPages: [{ match: (u) => u.pathname === '/feed/channels', html: lazyFeedHtml({ exposeTrigger: true }) }] })

  test('alarm (background tab): scrolling does not move, the continuation\'s method loads → complete', async ({ context, page, serviceWorker, stub, youtube, seedPairing }) => {
    test.setTimeout(120_000)
    void youtube
    await seedPairing()
    await page.goto('https://www.youtube.com/')
    await page.bringToFront()
    const bridge = visibilityBridge(context, serviceWorker)
    try {
      const since = Date.now()
      await fireSyncAlarm(serviceWorker)
      const feed = await feedPage(context)
      const req = await stub.waitFor((x) => x.key === 'POST /ext/sync/subscriptions', { since, timeout: 90_000 })
      const body = req.body as { signal: string; channels: Array<{ channel_id: string }> }
      const snap = bridge.snapshots.get(feed)
      console.log('[sync] background tab with the method exposed:', JSON.stringify(snap))
      expect(body.signal).toBe('complete')
      expect(body.channels.map((c) => c.channel_id).sort()).toEqual([...ALL_IDS].sort())
      expect(snap?.visible).toBe(false)
      expect(snap?.triggerCalls).toBe(BATCHES - 1)
      await expect.poll(async () => (await syncStatus(serviceWorker))?.state).toBe('ok')
      expect(await syncStatus(serviceWorker)).toMatchObject({ trigger: 'alarm', signal: 'complete', needs_visible: false })
    } finally {
      await bridge.stop()
    }
  })
})
