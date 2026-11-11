// Extension Playwright harness. Scenarios import from here instead of '@playwright/test':
//
//   import { test, expect } from '../harness/index.ts'
//   test('…', async ({ context, serviceWorker, stub, youtube, seedPairing, page }) => { … })
//
// Fixtures:
// - `extensionBuild` (worker): `npm run build:ext` into EXT_DIST_DIR (skipped with TUBE_E2E_SKIP_BUILD=1).
// - `stub`: StubServer on a free port of the EXT_PORTS range (contract examples; `stub.set` overrides).
// - `context`: `chromium.launchPersistentContext` with the extension from EXT_DIST_DIR, Chrome for Testing
//   (chromium-1248), headless, **temporary profile** (never the user's; deleted at the end).
// - `youtube`: saved pages at https://www.youtube.com/** + external network blocked (see pages.ts).
// - `serviceWorker` / `extensionId`: the loaded background.js.
// - `seedPairing(opts?)`: stores the stub's `{port, token, device_id}` in chrome.storage.local (as pairing would)
//   and waits for the first `GET /ext/state` of the alarm.
// - `stopServiceWorker()`: stops the SW through CDP (the 30 s alarm wakes it up).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test'
import { STORAGE_KEYS } from '../../../shared/ext-messages.ts'
import { EXT_DIST_DIR, extensionLaunchArgs } from '../playwright.config.ts'
import { serveSavedPages, type SavedPage, type ServedPages } from './pages.ts'
import { ROOT, chromeExecutable } from './paths.ts'
import { extensionIdOf, extensionServiceWorker, stopServiceWorker, type SwScope } from './service-worker.ts'
import { StubServer, type StubServerOptions } from './stub-server.ts'

export { expect }
export { BLANK_YOUTUBE_PAGE, DEFAULT_PAGES, serveSavedPages, type SavedPage, type ServedPages } from './pages.ts'
export {
  extensionIdOf,
  extensionServiceWorker,
  monitorServiceWorker,
  stopServiceWorker,
  type ServiceWorkerMonitor,
  type SwScope,
  type SwStatusEvent,
  type TubeDebug
} from './service-worker.ts'
export { StubServer, otherServicesInRange, type StubReply, type StubRequest } from './stub-server.ts'
export { loadContractExamples } from './contract.ts'
export { EXT_DIST_DIR }

export interface SeededConnection {
  port: number
  token: string
  device_id: string
  paired_at: number
}

type TestFixtures = {
  stubOptions: StubServerOptions
  stub: StubServer
  savedPages: readonly SavedPage[]
  context: BrowserContext
  youtube: ServedPages
  serviceWorker: Worker
  extensionId: string
  seedPairing: (opts?: { waitForState?: boolean }) => Promise<SeededConnection>
  stopServiceWorker: () => Promise<number>
}

type WorkerFixtures = { extensionBuild: string }

function buildExtension(): string {
  if (process.env.TUBE_E2E_SKIP_BUILD !== '1') {
    const r = spawnSync('npm', ['run', '-s', 'build:ext'], {
      cwd: ROOT,
      env: { ...process.env, EXT_DIST_DIR },
      encoding: 'utf8',
      timeout: 120_000
    })
    if (r.status !== 0) throw new Error(`build:ext failed:\n${r.stdout}\n${r.stderr}`)
  }
  if (!existsSync(join(EXT_DIST_DIR, 'manifest.json'))) {
    throw new Error(`extension not found in ${EXT_DIST_DIR} (run npm run build:ext with EXT_DIST_DIR)`)
  }
  return EXT_DIST_DIR
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  extensionBuild: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(buildExtension())
    },
    { scope: 'worker' }
  ],

  stubOptions: [{}, { option: true }],

  stub: async ({ stubOptions }, use) => {
    const stub = await StubServer.start(stubOptions)
    await use(stub)
    await stub.close()
  },

  savedPages: [[], { option: true }],

  context: async ({ extensionBuild }, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'tube-e2e-profile-'))
    const executablePath = chromeExecutable()
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
      args: [...extensionLaunchArgs],
      locale: 'en-US'
    })
    void extensionBuild
    try {
      await use(context)
    } finally {
      await context.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  },

  youtube: async ({ context, savedPages }, use) => {
    await use(await serveSavedPages(context, savedPages))
  },

  serviceWorker: async ({ context }, use) => {
    await use(await extensionServiceWorker(context))
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(extensionIdOf(serviceWorker))
  },

  seedPairing: async ({ serviceWorker, stub }, use) => {
    await use(async ({ waitForState = true } = {}) => {
      if (!stub.token) throw new Error('seedPairing: stub has no token')
      const conn: SeededConnection = { port: stub.port, token: stub.token, device_id: 'dev_stub', paired_at: Date.now() }
      const since = Date.now()
      await serviceWorker.evaluate(
        ([key, value]) => (globalThis as unknown as SwScope).chrome.storage.local.set({ [key]: value }),
        [STORAGE_KEYS.connection, conn] as const
      )
      if (waitForState) await stub.waitFor((r) => r.path === '/ext/state', { since })
      return conn
    })
  },

  stopServiceWorker: async ({ context, extensionId }, use) => {
    await use(() => stopServiceWorker(context, extensionId))
  }
})
