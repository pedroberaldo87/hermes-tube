// Popup in the harness (Chrome for Testing, temporary profile, fake range server, saved pages — no network):
// 1. not paired → wrong code (attempts left) → expired → right one (pasted with a hyphen) → popup "paired" and the
//    first sync reaches the fake server;
// 2. "Sync now" triggers `sync.now` (the real sync scrapes the saved page and sends the list);
// 3. disconnect (with confirmation) → `POST /ext/unpair`, local storage and alarms empty, popup goes back to the code;
// 4. problems: Hermes closed, token refused (pair again), not logged in to YouTube.
// 5. unsubscribe queue: 3 approved items → Stop in the popup → nothing else runs → Resume → finishes; and the
//    card states (progress, stopped, held for a reason, finished) in screenshots.
// Each state becomes a screenshot (ext-popup-<state>.<light|dark>.png, 2×, in the screenshots folder) and goes through an
// automatic audit: nothing overflows the popup width, no clipped text, WCAG AA contrast on all visible text.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page, Route, Worker } from '@playwright/test'
import { ALARMS, STORAGE_KEYS } from '../../../shared/ext-messages.ts'
import { expect, loadContractExamples, otherServicesInRange, test, type StubServer, type SwScope } from '../harness/index.ts'
import { ROOT } from '../harness/paths.ts'

const SHOTS = join(ROOT, 'docs', 'design', 'shots')
const AUDIT_OUT = join(process.env.TMPDIR || '/tmp', 'popup-audit.json')
const WIDTH = 344
const CODE = '481516'

test.use({ stubOptions: { pairingCode: CODE } })

// ------------------------------------------------------------------ utilities

const readAll = (sw: Worker) => sw.evaluate(() => (globalThis as unknown as SwScope).chrome.storage.local.get(null))
const writeKeys = (sw: Worker, items: Record<string, unknown>) =>
  sw.evaluate((it) => (globalThis as unknown as SwScope).chrome.storage.local.set(it), items)

/** Popup size: 344 px wide (the popup `body` has a fixed width; Chrome sizes the window to it). */
async function openPopup(page: Page, extensionId: string): Promise<void> {
  await page.setViewportSize({ width: WIDTH, height: 720 })
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`)
}

/**
 * Fake pairing server with the pairing errors and the success. The code never travels (PAKE rounds, like the real
 * server): a wrong code shows up as a confirmation that does not match, with the attempts left (`remaining`).
 */
function pairingScript(stub: StubServer) {
  const state = { mode: 'ok' as 'ok' | 'invalid' | 'expired', remaining: 3 }
  stub.set('POST /pair/complete', (req) => {
    const err = (code: string, extra: Record<string, unknown> = {}) => ({ body: { ok: false, error: { code, message: code, ...extra } } })
    if (state.mode === 'expired') return err('expired')
    const issue = () => {
      stub.pairingCode = null
      stub.token = `stub-token-popup-${Date.now()}`
      return {
        body: {
          ok: true,
          data: {
            device: { id: 'dev_popup', name: (req.body as { name?: string }).name ?? '', created_at: 1762700000, last_seen: null, revoked_at: null, origin: req.headers.origin ?? null },
            token: stub.token
          }
        }
      }
    }
    return stub.pake(req, CODE, issue, state.mode === 'invalid' ? state.remaining : 4)
  })
  return state
}

interface AuditResult {
  overflowX: number
  problems: string[]
  checkedTexts: number
  minContrast: number
}

/** Automatic visual audit (replaces eyeballing it): width, clipping, WCAG contrast.
 *  As text (runs in the page; tsconfig.node has no DOM). */
const AUDIT_JS = String.raw`(width) => {
    const problems = []
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return [0, 0, 0, 0]
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return [p[0], p[1], p[2], p[3] ?? 1]
    }
    const over = (top, bottom) => {
      const a = top[3]
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1)
    }
    const bgOf = (el) => {
      const chain = []
      for (let e = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor))
      let acc = [255, 255, 255, 1]
      for (const c of chain.reverse()) acc = over(c, acc)
      return acc
    }
    const lum = (c) => {
      const f = (v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
    }
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
      return (x + 0.05) / (y + 0.05)
    }
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.visibility === 'hidden' || cs.display === 'none' || e.classList.contains('sr-only')) return false
        if (e.tagName === 'DETAILS' && !e.open && e !== el && !el.closest('summary')) return false
      }
      return true
    }
    const overflowX = Math.max(document.body.scrollWidth, document.querySelector('main').scrollWidth) - width
    if (overflowX > 0) problems.push('page ' + overflowX + 'px wider than the popup')
    let checked = 0
    let minContrast = 99
    const els = [...document.querySelectorAll('main *')].filter((el) => {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
      return (own || el.tagName === 'INPUT') && visible(el)
    })
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const tid = el.getAttribute('data-testid')
      const name = el.tagName.toLowerCase() + (tid ? '[' + tid + ']' : el.className ? '.' + String(el.className).split(' ')[0] : '') + ' "' + (el.textContent || el.value || '').trim().slice(0, 30) + '"'
      if (r.left < -0.5 || r.right > width + 0.5) problems.push(name + ' outside the width (' + Math.round(r.left) + '–' + Math.round(r.right) + ')')
      const he = el
      if (he.scrollWidth > he.clientWidth + 1 && getComputedStyle(he).overflowX !== 'visible') problems.push(name + ' clipped')
      if (el.disabled) continue // WCAG 1.4.3: a disabled control is exempt
      if (el.tagName === 'INPUT' && !el.value) continue
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)
      const bg = bgOf(el)
      const c = ratio(over(fg, bg), bg)
      const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
      checked++
      minContrast = Math.min(minContrast, c)
      if (c < (large ? 3 : 4.5)) problems.push(name + ' contrast ' + c.toFixed(2))
    }
    return { overflowX, problems, checkedTexts: checked, minContrast: Math.round(minContrast * 100) / 100 }
}`

function audit(page: Page): Promise<AuditResult> {
  return page.evaluate<AuditResult>(`(${AUDIT_JS})(${WIDTH})`)
}

const audits: Record<string, AuditResult> = {}

/**
 * Popup screenshot in light and dark (2×), with an audit of each. Captured through CDP in the same session that fixes the
 * metric (Playwright's `locator.screenshot` goes back to 1×).
 */
async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 720, deviceScaleFactor: 2, mobile: false })
      await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
      const a = await audit(page)
      audits[`${name}.${scheme}`] = a
      expect(a.problems, `${name}.${scheme}`).toEqual([])
      const height = await page.evaluate<number>("Math.ceil(document.querySelector('main.popup').getBoundingClientRect().height)")
      const shot = (await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 },
        captureBeyondViewport: true
      })) as { data: string }
      writeFileSync(join(SHOTS, `ext-popup-${name}.${scheme}.png`), Buffer.from(shot.data, 'base64'))
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
    await cdp.detach().catch(() => undefined)
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  }
}

test.afterAll(() => {
  writeFileSync(AUDIT_OUT, JSON.stringify(audits, null, 2))
})

async function skipIfOtherHermes(stub: StubServer): Promise<void> {
  const others = await otherServicesInRange([stub.port])
  test.skip(others.length > 0, `another plugin instance in the range (${others.join(', ')}): do not burn someone else's code attempt`)
}

// ------------------------------------------------------------------ 1. pairing

test('pair: wrong code (attempts) → expired → right one pasted with a hyphen → paired + 1st sync', async ({
  page,
  extensionId,
  serviceWorker,
  stub,
  youtube
}) => {
  void youtube
  await skipIfOtherHermes(stub)
  const script = pairingScript(stub)
  await openPopup(page, extensionId)
  const main = page.getByTestId('conn-state')
  await expect(main).toHaveAttribute('data-state', 'unpaired')
  const input = page.getByTestId('code-input')
  await expect(input).toBeFocused()
  await shoot(page, 'unpaired')

  // wrong: the 6th digit submits by itself
  script.mode = 'invalid'
  await page.keyboard.type('111111')
  await expect(page.getByTestId('pair-error')).toHaveText('Wrong code. 3 attempts left.')
  await expect(main).toHaveAttribute('data-state', 'unpaired')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await page.getByTestId('where-code').locator('summary').click()
  await shoot(page, 'unpaired-error')
  await page.getByTestId('where-code').locator('summary').click()

  // expired (the field stays selected: typing replaces it)
  script.mode = 'expired'
  await input.focus()
  await input.selectText()
  await page.keyboard.type('222222')
  await expect(page.getByTestId('pair-error')).toContainText('expired')

  // right one, pasted with a hyphen
  script.mode = 'ok'
  const since = Date.now()
  await input.fill('')
  await page.keyboard.insertText('481-516')
  await expect(main).toHaveAttribute('data-state', 'connected')
  // the code itself never reached the server: the last request is round 2 of the PAKE
  const pairReqs = stub.requests({ key: 'POST /pair/complete' })
  expect(JSON.stringify(pairReqs.map((r) => r.body))).not.toContain(CODE)
  const pairReq = pairReqs[pairReqs.length - 1]
  expect((pairReq.body as { pake?: { session?: string } }).pake?.session).toBeTruthy()
  expect(pairReq.headers.origin).toBe(`chrome-extension://${extensionId}`)
  expect((pairReq.body as { name: string }).name).toMatch(/^Chrome/)
  await expect(page.getByTestId('device-name')).toHaveText((pairReq.body as { name: string }).name)

  // stored the connection + name; 30 s alarm; 1st sync reaches the server (real sync, saved page)
  const all = (await readAll(serviceWorker)) as Record<string, { token?: string; port?: number }>
  expect(all[STORAGE_KEYS.connection]).toMatchObject({ port: stub.port, token: stub.token, device_id: 'dev_popup' })
  const alarms = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).chrome.alarms.getAll())
  expect(alarms.map((a) => a.name)).toContain(ALARMS.state)
  const first = await stub.waitFor((r) => r.key === 'POST /ext/sync/subscriptions', { since, timeout: 45_000 })
  expect((first.body as { signal: string }).signal).toBe('complete')
  await expect(page.getByTestId('sync-summary')).toContainText('10 channels', { timeout: 15_000 })
  await expect(page.getByTestId('sync-summary')).toContainText('full list')
  // the token does not appear on the page
  expect(await page.content()).not.toContain(stub.token as string)
  await shoot(page, 'paired')
})

// ------------------------------------------------------------------ 2. sync now

test('"Sync now" triggers sync.now: progress, list on the server, new summary', async ({ page, extensionId, serviceWorker, stub, youtube, seedPairing }) => {
  void youtube
  await seedPairing()
  await writeKeys(serviceWorker, { pair_info: { device_name: 'Chrome — macOS', paired_at: Date.now() - 3 * 86_400_000 } })
  await openPopup(page, extensionId)
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'connected')
  await expect(page.getByTestId('sync-summary')).toContainText('Not synced yet.')

  const since = Date.now()
  await page.getByTestId('sync-now').click()
  await expect(page.getByTestId('sync-progress')).toBeVisible()
  await expect(page.getByTestId('sync-now')).toBeDisabled()
  const req = await stub.waitFor((r) => r.key === 'POST /ext/sync/subscriptions', { since, timeout: 45_000 })
  expect(req.headers.authorization).toBe(`Bearer ${stub.token}`)
  const status = (await readAll(serviceWorker))[STORAGE_KEYS.syncStatus] as { trigger: string } | undefined
  expect(status?.trigger).toBe('manual')
  await expect(page.getByTestId('sync-progress')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByTestId('sync-summary')).toContainText('10 channels')
  await expect(page.getByTestId('sync-now')).toBeEnabled()

  // screenshot of the progress with a "running" status (the real scrape finishes too fast to photograph)
  await writeKeys(serviceWorker, {
    [STORAGE_KEYS.syncStatus]: {
      state: 'running',
      trigger: 'manual',
      started_at: Date.now() - 14_000,
      finished_at: null,
      signal: null,
      reason: null,
      sent: 0,
      dropped: 0,
      report: null,
      error: null,
      last_ok_at: Date.now() - 6 * 3600_000
    }
  })
  await expect(page.getByTestId('sync-progress')).toBeVisible()
  await shoot(page, 'paired-syncing')

  // partial that needs a visible sync (needs_visible)
  await writeKeys(serviceWorker, {
    [STORAGE_KEYS.syncStatus]: {
      state: 'ok',
      trigger: 'alarm',
      started_at: Date.now() - 3600_000,
      finished_at: Date.now() - 3600_000,
      signal: 'partial',
      reason: 'scroll_stalled',
      sent: 120,
      dropped: 0,
      report: { added: 0, updated: 120, marked_ex: 0 },
      error: null,
      last_ok_at: Date.now() - 3600_000,
      needs_visible: true
    }
  })
  await expect(page.getByTestId('sync-summary')).toContainText('Needs a visible sync')
  await shoot(page, 'paired-needs-visible')
})

// ------------------------------------------------------------------ 3. disconnect

test('disconnect: confirmation, /ext/unpair, everything erased, back to the code', async ({ page, extensionId, serviceWorker, stub, seedPairing }) => {
  const conn = await seedPairing()
  await writeKeys(serviceWorker, {
    pair_info: { device_name: 'Chrome — macOS', paired_at: Date.now() - 86_400_000 },
    [STORAGE_KEYS.syncStatus]: { state: 'ok', trigger: 'alarm', started_at: Date.now() - 600_000, finished_at: Date.now() - 600_000, signal: 'complete', reason: null, sent: 412, dropped: 0, report: null, error: null, last_ok_at: Date.now() - 600_000 }
  })
  await openPopup(page, extensionId)
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'connected')
  await page.getByTestId('disconnect').click()
  await expect(page.getByTestId('disconnect-confirm')).toBeVisible()
  await expect(page.getByTestId('disconnect-cancel')).toBeFocused()
  await shoot(page, 'disconnect-confirm')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('disconnect-confirm')).toHaveCount(0)
  await expect(page.getByTestId('disconnect')).toBeFocused()
  expect(stub.requests({ key: 'POST /ext/unpair' })).toHaveLength(0)

  await page.keyboard.press('Enter') // reopens by keyboard
  await page.getByTestId('disconnect-yes').click()
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'unpaired')
  const [req] = stub.requests({ key: 'POST /ext/unpair' })
  expect(req.headers.authorization).toBe(`Bearer ${conn.token}`)
  await expect.poll(() => readAll(serviceWorker)).toEqual({})
  expect(await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).chrome.alarms.getAll())).toEqual([])
  await expect(page.getByTestId('code-input')).toBeFocused()
})

// ------------------------------------------------------------------ 4. problems

test('problem: token refused → "Pair again" leads to the code', async ({ page, extensionId, serviceWorker, stub, seedPairing }) => {
  await seedPairing()
  await writeKeys(serviceWorker, { pair_info: { device_name: 'Chrome — macOS', paired_at: Date.now() - 86_400_000 } })
  stub.token = 'revoked-elsewhere'
  await openPopup(page, extensionId)
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'unauthorized')
  await expect(page.getByTestId('problem')).toContainText('no longer recognizes this browser')
  await shoot(page, 'problem-unauthorized')
  await page.getByTestId('pair-again').click()
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'unpaired')
  await expect.poll(() => readAll(serviceWorker)).toEqual({})
})

test('problem: Hermes closed → "Open Hermes and the plugin page"', async ({ page, extensionId, serviceWorker, stub, seedPairing }) => {
  await seedPairing()
  await writeKeys(serviceWorker, { pair_info: { device_name: 'Chrome — macOS', paired_at: Date.now() - 86_400_000 } })
  await stub.close()
  test.skip((await otherServicesInRange()).length > 0, 'another plugin instance in the range answers')
  await openPopup(page, extensionId)
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'reconnect_needed')
  await expect(page.getByTestId('problem')).toContainText('Open Hermes and the plugin page')
  // nothing like "Hermes answered just now" next to "Hermes is closed"
  await expect(page.locator('main')).not.toContainText('Hermes answered')
  await expect(page.locator('main')).not.toContainText('just now')
  await shoot(page, 'problem-closed')
})

test('problem: not logged in to YouTube', async ({ page, extensionId, serviceWorker, seedPairing }) => {
  await seedPairing()
  await writeKeys(serviceWorker, {
    pair_info: { device_name: 'Chrome — macOS', paired_at: Date.now() - 86_400_000 },
    [STORAGE_KEYS.syncStatus]: {
      state: 'error',
      trigger: 'manual',
      started_at: Date.now() - 120_000,
      finished_at: Date.now() - 100_000,
      signal: null,
      reason: 'logged_out',
      sent: 0,
      dropped: 0,
      report: null,
      error: { code: 'logged_out', message: 'logged_out' },
      last_ok_at: null
    }
  })
  await openPopup(page, extensionId)
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'connected')
  await expect(page.getByTestId('problem')).toContainText('Sign in to YouTube')
  await shoot(page, 'problem-youtube')
})

// ------------------------------------------------------------------ 5. pt-BR

test('pt-BR: the three states in Hermes\'s language', async ({ page, extensionId, serviceWorker, stub, seedPairing }) => {
  // not paired (the language comes from the last cached ExtState)
  await writeKeys(serviceWorker, { [STORAGE_KEYS.stateCache]: { state: { language: 'pt-BR' }, fetched_at: Date.now() } })
  await openPopup(page, extensionId)
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'unpaired')
  await expect(page.locator('main')).toContainText('Conecte este navegador ao Hermes')
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
  await shoot(page, 'unpaired.pt-BR')

  // paired
  const base = loadContractExamples().routes['GET /ext/state'] as { data: Record<string, unknown> }
  stub.set('GET /ext/state', { body: { ok: true, data: { ...base.data, language: 'pt-BR' } } })
  await seedPairing()
  await writeKeys(serviceWorker, {
    pair_info: { device_name: 'Chrome — macOS', paired_at: Date.now() - 3 * 86_400_000 },
    [STORAGE_KEYS.syncStatus]: { state: 'ok', trigger: 'alarm', started_at: Date.now() - 300_000, finished_at: Date.now() - 300_000, signal: 'complete', reason: null, sent: 412, dropped: 0, report: null, error: null, last_ok_at: Date.now() - 300_000 }
  })
  await page.reload()
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'connected')
  await expect(page.getByTestId('sync-summary')).toContainText('412 canais')
  await shoot(page, 'paired.pt-BR')

  // problem: Hermes closed
  await stub.close()
  test.skip((await otherServicesInRange()).length > 0, 'another plugin instance in the range answers')
  await page.reload()
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'reconnect_needed')
  await expect(page.getByTestId('problem')).toContainText('O Hermes está fechado')
  await shoot(page, 'problem-closed.pt-BR')
})

// ------------------------------------------------------------------ 6. unsubscribe queue

const Q_IDS = ['UCpopqQueueAaaaaaaaaaaaa', 'UCpopqQueueBbbbbbbbbbbbb', 'UCpopqQueueCcccccccccccc']
const Q_TITLES = ['Alpha Channel', 'Bravo Channel', 'Charlie Channel']

/** synthetic channel page (same structure as queue.spec.ts): click → dialog; confirm → button becomes "Subscribe" */
function channelHtml(id: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} - YouTube</title>
<link rel="canonical" href="https://www.youtube.com/channel/${id}">
<meta property="og:url" content="https://www.youtube.com/channel/${id}">
<meta itemprop="identifier" content="${id}">
<script>window.ytcfg = { data_: {}, set(o) { Object.assign(this.data_, o) }, get(k) { return this.data_[k] } };
ytcfg.set({"LOGGED_IN":true});</script>
<script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"title":"${title}","externalId":"${id}"}}};</script>
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
  const dialog = document.querySelector('tp-yt-paper-dialog')
  document.addEventListener('click', (e) => {
    const el = e.target
    if (el.closest('#subscribe-button button')) {
      setTimeout(() => { dialog.removeAttribute('aria-hidden'); dialog.style.display = '' }, 150)
      return
    }
    if (el.closest('#confirm-button')) {
      setTimeout(() => {
        dialog.setAttribute('aria-hidden', 'true'); dialog.style.display = 'none'
        const r = document.querySelector('ytd-subscribe-button-renderer'); r.removeAttribute('subscribed')
        const b = r.querySelector('button'); b.removeAttribute('subscribed')
        b.classList.replace('yt-spec-button-shape-next--tonal', 'yt-spec-button-shape-next--filled')
        b.setAttribute('aria-label', 'Subscribe'); b.textContent = 'Subscribe'
      }, 200)
    }
  }, true)
})()
</script></body></html>`
}

async function serveChannels(context: BrowserContext): Promise<string[]> {
  const served: string[] = []
  await context.route(/^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}/, async (route: Route) => {
    if (route.request().resourceType() !== 'document') return route.fulfill({ status: 404, body: '' })
    const id = new URL(route.request().url()).pathname.split('/')[2]
    served.push(id)
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: channelHtml(id, Q_TITLES[Q_IDS.indexOf(id)] ?? 'Unknown') })
  })
  return served
}

/** fake server queue: one `approved` at a time, none while there is a `running`; `log` in order */
function queueServer(stub: StubServer) {
  const items = Q_IDS.map((channel_id, i) => ({
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
  const log: string[] = []
  const state = (loadContractExamples().routes['GET /ext/state'] as { data: Record<string, unknown> }).data
  const pending = () => items.filter((i) => i.status === 'approved').length
  stub.set('GET /ext/state', () => ({ body: { ok: true, data: { ...state, queue_pending: pending() } } }))
  stub.set('GET /ext/queue', (req) => {
    if (req.query.peek === '1') {
      // the listing for "Run now": nothing is lent
      const listed = items.filter((i) => i.status === 'approved')
      const channels = Object.fromEntries(listed.map((i) => [i.channel_id, { id: i.channel_id, title: Q_TITLES[Q_IDS.indexOf(i.channel_id)], relation: 'subscribed', url: null, handle: null }]))
      return { body: { ok: true, data: { items: listed, channels } } }
    }
    const next = items.some((i) => i.status === 'running') ? undefined : items.find((i) => i.status === 'approved')
    log.push(`get:${next?.id ?? '-'}`)
    if (!next) return { body: { ok: true, data: { items: [], channels: {} } } }
    const idx = Q_IDS.indexOf(next.channel_id)
    const channel = { id: next.channel_id, title: Q_TITLES[idx], relation: 'subscribed', url: null, handle: null }
    return { body: { ok: true, data: { items: [next], channels: { [next.channel_id]: channel } } } }
  })
  stub.set('POST /ext/queue/{id}/result', (req, params) => {
    const body = req.body as { status: string; error?: string | null }
    const it = items.find((i) => i.id === params.id)
    if (!it) return { status: 404, body: { ok: false, error: { code: 'not_found', message: 'no item' } } }
    log.push(`${body.status}:${it.id}`)
    it.status = body.status
    return { body: { ok: true, data: it } }
  })
  return { items, log, results: () => log.filter((l) => /^(done|failed):/.test(l)), runnings: () => log.filter((l) => l.startsWith('running:')) }
}

test('queue: 3 approved → Stop in the popup → nothing else runs → Resume → finishes', async ({ context, page, extensionId, serviceWorker, stub, youtube, seedPairing }) => {
  test.setTimeout(150_000)
  void youtube
  const served = await serveChannels(context)
  const q = queueServer(stub)
  await writeKeys(serviceWorker, { pair_info: { device_name: 'Chrome — macOS', paired_at: Date.now() - 86_400_000 } })
  await openPopup(page, extensionId) // the popup tab is the origin of the round
  await seedPairing() // the ExtState (queue_pending 3) lists the items: the popup asks first
  const card = page.getByTestId('queue-card')
  await expect(card).toHaveAttribute('data-state', 'waiting', { timeout: 30_000 })
  await expect(card).toContainText('3 approved unsubscribes are waiting')
  expect(q.runnings()).toEqual([])
  await page.getByTestId('queue-run-now').click()
  await expect(card).toHaveAttribute('data-state', 'running', { timeout: 30_000 })
  await expect(card).toContainText('Cancelling 1 of 3 · Alpha Channel', { timeout: 30_000 })

  // Stop in the popup (the queue tab is in view; the popup comes back to the front for the click)
  await page.bringToFront()
  await page.getByTestId('queue-stop').click()
  await expect(card).toHaveAttribute('data-state', /stopping|stopped/)
  const ctl = (await readAll(serviceWorker))[STORAGE_KEYS.queueCtl] as { stopped: boolean; by: string }
  expect(ctl).toMatchObject({ stopped: true, by: 'popup' })
  await expect(card).toHaveAttribute('data-state', 'stopped', { timeout: 30_000 })
  const doneBefore = q.results().length
  const runningBefore = q.runnings().length
  const servedBefore = served.length
  expect(doneBefore).toBeLessThan(3) // really stopped before the end
  expect(runningBefore).toBe(doneBefore) // the item in progress finished; none was left half done

  // nothing else runs: longer than the maximum pause between items (6 s) and a new ExtState
  await page.waitForTimeout(8_000)
  await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.refreshState())
  await page.waitForTimeout(1_000)
  expect(q.runnings()).toHaveLength(runningBefore)
  expect(served).toHaveLength(servedBefore)
  const left = 3 - doneBefore
  await expect(card).toContainText(`Queue stopped · ${left} left`)
  console.log('[popup queue] stopped after', doneBefore, 'item(s); log:', JSON.stringify(q.log))

  // Resume → the rest finishes, only through what GET /ext/queue delivers
  await page.getByTestId('queue-resume').click()
  await expect.poll(() => q.results().length, { timeout: 60_000, intervals: [250] }).toBe(3)
  expect(q.items.map((i) => i.status)).toEqual(['done', 'done', 'done'])
  expect(served).toEqual(Q_IDS) // each channel opened once, by id, in order
  // each `running` came right after a GET that delivered that item
  q.log.forEach((l, i) => {
    if (l.startsWith('running:')) expect(q.log.slice(0, i).lastIndexOf(`get:${l.slice(8)}`), l).toBeGreaterThanOrEqual(0)
  })
  await expect(card).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
  await expect(card).toContainText(`${left} unsubscribed`)
  expect((await readAll(serviceWorker))[STORAGE_KEYS.queueCtl]).toBeUndefined()
  console.log('[popup queue] final log:', JSON.stringify(q.log))
})

test('queue: card states (progress, stopped, held, finished) — screenshots', async ({ page, extensionId, serviceWorker, stub, seedPairing }) => {
  test.setTimeout(120_000)
  const base = (loadContractExamples().routes['GET /ext/state'] as { data: Record<string, unknown> }).data
  // nothing pending on the server: the real executor does not touch the progress this test writes
  stub.set('GET /ext/state', { body: { ok: true, data: { ...base, queue_pending: 0 } } })
  await seedPairing()
  const now = Date.now()
  const progress = (over: Record<string, unknown>) => ({
    state: 'idle',
    action: 'unsubscribe',
    index: 0,
    total: 0,
    channel_id: null,
    channel_title: null,
    done: 0,
    failed: 0,
    last: null,
    consecutive_failures: 0,
    hold_reason: null,
    hold_until: null,
    started_at: now - 10 * 60_000,
    updated_at: now + 1_000,
    message: '',
    tab_id: null,
    origin_tab_id: null,
    current: null,
    ...over
  })
  await writeKeys(serviceWorker, {
    pair_info: { device_name: 'Chrome — macOS', paired_at: now - 3 * 86_400_000 },
    [STORAGE_KEYS.syncStatus]: { state: 'ok', trigger: 'alarm', started_at: now - 300_000, finished_at: now - 300_000, signal: 'complete', reason: null, sent: 412, dropped: 0, report: null, error: null, last_ok_at: now - 300_000 },
    [STORAGE_KEYS.queueRun]: progress({ state: 'running', index: 2, total: 5, channel_id: Q_IDS[1], channel_title: 'Bravo Channel', done: 1 })
  })
  await openPopup(page, extensionId)
  const card = page.getByTestId('queue-card')
  await expect(card).toHaveAttribute('data-state', 'running')
  await expect(card).toContainText('Cancelling 2 of 5 · Bravo Channel')
  await expect(page.getByTestId('queue-stop')).toBeVisible()
  await shoot(page, 'queue-running')

  await writeKeys(serviceWorker, { [STORAGE_KEYS.queueRun]: progress({ state: 'stopped', index: 2, total: 5, done: 2, updated_at: Date.now() + 1_000 }) })
  await expect(card).toHaveAttribute('data-state', 'stopped')
  await expect(card).toContainText('Queue stopped · 3 left')
  await expect(page.getByTestId('queue-resume')).toBeVisible()
  await shoot(page, 'queue-stopped')

  const held = [
    ['logged_out', 'signed out of YouTube', 'logged_out'],
    ['challenge', 'YouTube verification', 'challenge'],
    ['failures', 'two failures in a row', 'confirm_not_found']
  ] as const
  for (const [reason, title, error] of held) {
    await writeKeys(serviceWorker, {
      [STORAGE_KEYS.queueRun]: progress({
        state: 'paused',
        hold_reason: reason,
        hold_until: Date.now() + 3600_000,
        index: 2,
        total: 4,
        done: 0,
        failed: reason === 'failures' ? 2 : 1,
        last: { queue_id: 'q_2', status: 'failed', error }
      })
    })
    await expect(card).toHaveAttribute('data-state', 'held')
    await expect(card).toContainText(title)
    await expect(page.getByTestId('queue-retry')).toBeVisible()
    await shoot(page, `queue-held-${reason.replace('_', '-')}`)
  }

  await writeKeys(serviceWorker, {
    [STORAGE_KEYS.queueLedger]: {
      q_1: { status: 'done', error: null, reported: true, at: now - 9 * 60_000 },
      q_2: { status: 'failed', error: 'wrong_channel', reported: true, at: now - 8 * 60_000 },
      q_3: { status: 'done', error: null, reported: true, at: now - 7 * 60_000 },
      q_4: { status: 'done', error: null, reported: true, at: now - 6 * 60_000 }
    },
    [STORAGE_KEYS.queueRun]: progress({ state: 'idle', index: 4, total: 4, done: 3, failed: 1, updated_at: now - 5 * 60_000 })
  })
  await expect(card).toHaveAttribute('data-state', 'done')
  await expect(card).toContainText('3 unsubscribed · 1 failed')
  await expect(page.getByTestId('queue-failures')).toContainText("The page that opened wasn't this channel")
  await shoot(page, 'queue-done')

  // pt-BR: stopped
  stub.set('GET /ext/state', { body: { ok: true, data: { ...base, queue_pending: 0, language: 'pt-BR' } } })
  await writeKeys(serviceWorker, {
    [STORAGE_KEYS.stateCache]: { state: { ...base, queue_pending: 0, language: 'pt-BR' }, fetched_at: now },
    [STORAGE_KEYS.queueRun]: progress({ state: 'stopped', index: 2, total: 5, done: 2, updated_at: Date.now() + 60_000 })
  })
  await page.reload()
  await expect(card).toContainText('Fila parada · 3 restantes')
  await shoot(page, 'queue-stopped.pt-BR')
})
