# Extension Playwright harness

Scenarios live in `extension/e2e/scenarios/<module>.spec.ts` and import from here:

```ts
import { test, expect, type SwScope } from '../harness/index.ts'

test('…', async ({ page, youtube, serviceWorker, stub, seedPairing }) => {
  stub.set('GET /ext/queue', { body: { ok: true, data: { items: [], channels: {} } } })
  await seedPairing()                                  // stores the stub's {port, token} and waits for the 1st GET /ext/state
  await page.goto('https://www.youtube.com/feed/channels') // saved page (tests/fixtures), content scripts fire
  await expect(page.locator('html')).toHaveAttribute('data-tube-ext', 'ready')
})
```

Run (outside `scripts/check`; ~40 s, the alarm test waits 30 s):

```
source .unit-env
EXT_DIST_DIR=$TMPDIR/ext-e2e npm run e2e            # builds the extension first (TUBE_E2E_SKIP_BUILD=1 skips it)
```

| fixture / function | what it does |
|---|---|
| `context` | `launchPersistentContext` with the extension from `EXT_DIST_DIR` (`extensionLaunchArgs` from the config), Chrome for Testing from `chromium-1248` (`TUBE_E2E_CHROME` overrides), headless, temporary profile deleted at the end — never the user's profile |
| `stub` | `StubServer` on 127.0.0.1, 1st free port of `EXT_PORTS` (skips a busy port, e.g. the real plugin). `/health`, `POST /pair/complete` (code in `stubOptions.pairingCode`), Bearer on `/ext/*` (401), `example` of each route read from `contract/api.yaml` (status from `x-error-codes`). `stub.set(route, response)`, `stub.requests()`, `stub.waitFor(pred)` |
| `stubOptions` | `test.use({ stubOptions: { pairingCode: '123456', token: '…' } })` |
| `youtube` | `context.route` serves saved pages at `https://www.youtube.com/**` (table in `pages.ts`; `test.use({ savedPages: [{ match, file \| html }] })` adds more), 404 for the rest of youtube.com, and aborts any other external host |
| `serviceWorker`, `extensionId` | the `background.js`; `serviceWorker.evaluate(() => (globalThis as unknown as SwScope).__tubeDebug.…)` (`refreshState`, `dispatch`, `status`, `discover`, `pair`) |
| `seedPairing()` | pairing without the popup: stores the stub connection in `chrome.storage.local` |
| `monitorServiceWorker(context, id)` | CDP: `stop()` stops the SW (`ServiceWorker.stopAllWorkers`) and `events` records `stopped → starting → running`; the same `Worker` points to the new SW |
| `otherServicesInRange()` | other plugin instances in the range (skip pairing tests if there are any) |

New fixtures (HTML) stay in the scenario itself (`savedPages` with `html`); `tests/fixtures/` is read-only.
Never use a real channel: unsubscribe/resubscribe only on a saved page.

## Notes (closed Shadow DOM and viewport)
- **Closed Shadow DOM** (the sidebar uses `mode: 'closed'`): Playwright does not get in. Read and click through CDP:
  `DOM.getDocument {pierce: true}` + `DOM.querySelectorAll` on the root (class `Shadow` in `scenarios/sidebar.spec.ts`).
- **Viewport through CDP:** turning the CDP session off undoes its `Emulation.setDeviceMetricsOverride`, and
  `page.setViewportSize` with the same size does not reapply it (the page goes back to 1280 × 633). Keep the session on.
