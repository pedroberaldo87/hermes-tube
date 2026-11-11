// Extension shell smoke test in the harness: loads from EXT_DIST_DIR in a Chrome for Testing with a temporary
// profile, the background talks to the stub server (range port), the content script fires on a saved page
// of https://www.youtube.com (no network) and the 30 s alarm wakes the stopped service worker.
import { ALARMS, STORAGE_KEYS } from '../../../shared/ext-messages.ts'
import { PLUGIN_ID } from '../../../shared/ids.ts'
import { expect, loadContractExamples, monitorServiceWorker, otherServicesInRange, test, type SwScope } from '../harness/index.ts'

test('extension loads: service worker, manifest and popup', async ({ serviceWorker, extensionId, page }) => {
  expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/background.js`)
  const manifest = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).chrome.runtime.getManifest())
  expect(manifest.manifest_version).toBe(3)
  expect([...(manifest.permissions as string[])].sort()).toEqual(['alarms', 'scripting', 'storage', 'tabs'])
  // own name; the description does not present itself as a YouTube/Google product (and fits the store limit)
  expect(manifest.name).toBe('HermesTube')
  expect(manifest.short_name).toBe('HermesTube')
  const description = String(manifest.description ?? '')
  expect(description.length).toBeLessThanOrEqual(132)
  expect(description).not.toMatch(/YouTube Subscriptions|official|by (YouTube|Google)/i)
  expect(description).toMatch(/not affiliated with (YouTube|Google)/i)

  await page.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await expect(page.getByTestId('conn-state')).toHaveAttribute('data-state', 'unpaired')
})

test('background calls the stub route: GET /ext/state with Bearer, cache and 30 s alarm', async ({ serviceWorker, stub, seedPairing }) => {
  expect(loadContractExamples().source).toBe('api.yaml')
  const conn = await seedPairing()

  const [req] = stub.requests({ key: 'GET /ext/state' })
  expect(req.headers.authorization).toBe(`Bearer ${conn.token}`)
  expect(req.headers.origin).toBeUndefined() // a GET from the SW with host_permissions does not send Origin

  // ExtState cache = contract example served by the stub
  const example = (loadContractExamples().routes['GET /ext/state'] as { data: unknown }).data
  const readCache = () =>
    serviceWorker.evaluate(
      async (key) => (await (globalThis as unknown as SwScope).chrome.storage.local.get(key))[key],
      STORAGE_KEYS.stateCache
    )
  await expect.poll(readCache).toMatchObject({ state: example })

  const alarms = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).chrome.alarms.getAll())
  expect(alarms.find((a) => a.name === ALARMS.state)?.periodInMinutes).toBe(0.5)

  const status = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.status())
  expect(status).toMatchObject({ state: 'connected', port: stub.port, device_id: 'dev_stub' })
})

test('popup → background → stub: connected state with the port', async ({ page, extensionId, stub, seedPairing }) => {
  await seedPairing()
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`)
  const el = page.getByTestId('conn-state')
  await expect(el).toHaveAttribute('data-state', 'connected')
  await expect(el).toContainText(String(stub.port))
})

test('content script fires on the saved page of https://www.youtube.com (no network)', async ({ page, youtube, seedPairing }) => {
  await page.goto('https://www.youtube.com/feed/channels')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-tube-ext', 'ready')
  expect(youtube.served[0]).toEqual(['https://www.youtube.com/feed/channels', 'mytube/feed-channels.synthetic.html'])
  // not paired: only the scraper attaches on /feed/channels
  await expect(html).toHaveAttribute('data-tube-ext-modules', 'content/scraper')

  // paired: the ExtState cache arrives through storage.onChanged and attaches the sidebar without reloading
  await seedPairing()
  await expect(html).toHaveAttribute('data-tube-ext-modules', /content\/sidebar/)

  // navigating to another saved page: tracker on /watch, real fixture page
  await page.goto('https://www.youtube.com/watch?v=KfODG5REyss')
  await expect(html).toHaveAttribute('data-tube-ext-modules', /content\/tracker/)
  expect(youtube.served.at(-1)).toEqual(['https://www.youtube.com/watch?v=KfODG5REyss', 'youtube/watch/normal.KfODG5REyss.html'])
  // no external request went out (the ones the saved pages tried were aborted)
  expect(youtube.blocked.every((u) => !u.startsWith('https://www.youtube.com/'))).toBe(true)
})

test.describe('real client in the browser', () => {
  test.use({ stubOptions: { pairingCode: '246810' } })

  test('discovery through the 10 ports and pairing only where pairing_open', async ({ serviceWorker, extensionId, stub }) => {
    const others = await otherServicesInRange([stub.port])
    test.skip(others.length > 0, `another plugin server in the range (${others.join(', ')}): do not burn someone else's code attempt`)

    const found = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.discover())
    expect(found).toEqual([{ port: stub.port, health: { service: PLUGIN_ID, instance: stub.instance, pairing_open: true } }])

    const res = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.pair('246810', 'harness'))
    expect(res).toMatchObject({ ok: true, data: { state: 'connected', port: stub.port } })
    const [pairReq] = stub.requests({ key: 'POST /pair/complete' })
    expect(pairReq.body).toEqual({ code: '246810', name: 'harness' })
    expect(pairReq.headers.origin).toBe(`chrome-extension://${extensionId}`) // a POST from the SW sends Origin

    // the core sees the new token: sets the alarm and fetches the state with it
    const state = await stub.waitFor((r) => r.key === 'GET /ext/state')
    expect(state.headers.authorization).toBe(`Bearer ${stub.token}`)
  })

  test('401: token refused → unauthorized', async ({ serviceWorker, stub, seedPairing }) => {
    await seedPairing()
    // the refresh triggered by pairing has to finish (refreshState joins in-flight requests)
    await expect
      .poll(() => serviceWorker.evaluate(async () => (await (globalThis as unknown as SwScope).__tubeDebug.status()).state))
      .toBe('connected')
    stub.token = 'outro-token'
    const refreshed = () =>
      serviceWorker.evaluate(async () => {
        const d = (globalThis as unknown as SwScope).__tubeDebug
        await d.refreshState()
        return (await d.status()).state
      })
    await expect.poll(refreshed).toBe('unauthorized')
    const last = stub.requests({ key: 'GET /ext/state' }).at(-1)
    expect(last?.status).toBe(401)
  })
})

test('alarm wakes the service worker stopped through CDP and calls GET /ext/state', async ({ serviceWorker, stub, seedPairing, context, extensionId }) => {
  test.setTimeout(120_000)
  await seedPairing()
  const bootBefore = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.bootAt)

  const monitor = await monitorServiceWorker(context, extensionId)
  try {
    const stoppedAt = await monitor.stop()
    await expect.poll(() => monitor.events.map((e) => e.status)).toContain('stopped')

    const req = await stub.waitFor((r) => r.key === 'GET /ext/state', { since: stoppedAt, timeout: 75_000 })
    expect(req.headers.authorization).toMatch(/^Bearer /)

    // the SW that called is another one: it restarted after the stop (the same handle points to the new SW)
    const bootAfter = await serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.bootAt)
    expect(bootAfter).toBeGreaterThan(bootBefore)
    expect(bootAfter).toBeGreaterThanOrEqual(stoppedAt)
    const seq = monitor.events.map((e) => e.status)
    expect(seq.slice(seq.indexOf('stopped'))).toEqual(expect.arrayContaining(['stopped', 'starting', 'running']))
    test.info().annotations.push({
      type: 'alarm',
      description: `stopped ${stoppedAt}; restarted ${bootAfter} (+${bootAfter - stoppedAt} ms); GET /ext/state ${req.at}; CDP ${seq.join('→')}`
    })
  } finally {
    await monitor.close()
  }
})
